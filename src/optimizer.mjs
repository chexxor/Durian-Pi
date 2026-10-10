// Instruction optimization: rewrite rough seat personas and work requests
// into sharper prompts before they reach a seat.
//
// Inspired by linshenkx/prompt-optimizer (techniques: explicit role, explicit
// success criteria, constraint preservation, no invented facts). We do NOT
// vendor its template text: the project is AGPL-3.0 and durig must stay free
// of copy-left obligations for future distribution. A vendored checkout for
// private study lives at ../vendor/prompt-optimizer; if the operator ever
// wants its exact template, swap OPTIMIZER_SYSTEM here (config-level change,
// same seam) and accept the AGPL implications in that deployment.
//
// Automation seams (MVP): `up` optimizes seat instructions when
// DURIG_OPTIMIZE=on; `send_work` optimizes a request body when the caller
// passes optimize:true. Both record provenance on the stored artifact so an
// optimized prompt is always distinguishable from a human-written one.

export const OPTIMIZER_SYSTEM = `You rewrite working prompts for AI agents. You improve clarity, not ambition.

Rules:
- Preserve every fact, constraint, and requirement the draft states. Never invent new requirements, names, numbers, or capabilities.
- Make the role, the goal, and the definition of done explicit.
- Prefer imperative sentences; one instruction per sentence where possible.
- Remove filler, hedging, and repetition.
- Keep domain vocabulary exactly as written.
- HARD RULE: every number, every quoted phrase, and every named term in the draft MUST appear VERBATIM in your rewrite. Compression may remove filler around them but never the tokens themselves.
- Output ONLY the rewritten prompt text. No preamble, no commentary, no quotes.`;

// --- Preservation guard -----------------------------------------------------
// The optimizer's cardinal sin is losing or inventing information. These
// checks are deliberately conservative and mechanical: they catch hard
// facts (numbers), quoted names, and explicit constraint statements. They
// do NOT try to judge paraphrase quality - that is the blind judge's job.

const NUMBER_RE = /\b\d+(?:[.,]\d+)?\b/g;
const QUOTED_RE = /["“]([^"”]{2,80})["”]/g;
const CONSTRAINT_LINE_RE = /^(?:constraint|rule|requirement|never|always|must)\b.*$/gim;

/**
 * Mechanically compare a draft against its rewrite.
 * @returns {{violations: string[], inventions: string[]}}
 *   violations: commitments present in the draft but missing from the rewrite
 *   inventions: hard facts present in the rewrite but absent from the draft
 */
export function analyzePreservation(original, rewritten) {
	const violations = [];
	const inventions = [];

	const norm = (t) => t.toLowerCase();
	const orig = norm(original);
	const rew = norm(rewritten);

	for (const re of [NUMBER_RE, QUOTED_RE]) {
		re.lastIndex = 0;
		for (const m of original.matchAll(re)) {
			if (!rew.includes(norm(m[0]))) violations.push(`lost ${m[0]}`);
		}
		re.lastIndex = 0;
		for (const m of rewritten.matchAll(re)) {
			if (!orig.includes(norm(m[0]))) inventions.push(`invented ${m[0]}`);
		}
	}
	CONSTRAINT_LINE_RE.lastIndex = 0;
	for (const m of original.matchAll(CONSTRAINT_LINE_RE)) {
		const line = m[0].toLowerCase();
		// A constraint survives if its distinctive core appears somewhere in
		// the rewrite; comparing whole lines verbatim would reject legitimate
		// rephrasing.
		const core = line.split(/\s+/).filter((w) => w.length > 4);
		const missing = core.filter((w) => !rew.includes(w));
		// Majority-missing flags a dropped constraint while tolerating
		// legitimate rephrasing that reuses one or two distinctive words.
		if (core.length > 0 && missing.length > core.length / 2) {
			violations.push(`dropped constraint line: ${m[0].slice(0, 60)}`);
		}
	}
	return { violations, inventions };
}

/**
 * Optimize one instruction/request text through the rig's own model stack.
 * @param {import("@earendil-works/pi-ai").Models} models
 * @param {{provider: string, modelId: string}} modelRef
 * @param {string} text draft to improve
 * @param {{kind?: "instruction"|"work_request"}} options
 * @returns {Promise<{optimized: string}>}
 */
export async function optimizeInstruction(models, modelRef, text, { kind = "instruction" } = {}) {
	const model =
		models.getModel(modelRef.provider, modelRef.modelId) ??
		models.getModelsOfType("text", modelRef.provider)?.find((m) => m.id === modelRef.modelId);
	if (!model) throw new Error(`optimizer model not found: ${modelRef.provider}/${modelRef.modelId}`);
	const message = await models.completeSimple(
		model,
		{
			messages: [
				{ role: "system", content: OPTIMIZER_SYSTEM },
				{
					role: "user",
					content:
						kind === "work_request"
							? `Rewrite this work request that will be sent to an agent seat as a task item body.\n\nDraft:\n${text}`
							: `Rewrite this system-prompt fragment for an agent seat.\n\nDraft:\n${text}`,
				},
			],
		},
	);
	const optimized = (message.content ?? [])
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("")
		.trim();
	if (!optimized) {
		throw new Error(`optimizer returned no text (stopReason=${message.stopReason})`);
	}
	// Safeguard: a rewrite that loses or invents hard facts is rejected and
	// the RAW draft is used instead. Callers get one shape either way; the
	// rejected flag lets them keep provenance honest (a rejected rewrite
	// means the stored text is still human-written).
	const check = analyzePreservation(text, optimized);
	if (check.violations.length > 0 || check.inventions.length > 0) {
		return {
			optimized: text,
			rejected: true,
			preserved: false,
			violations: check.violations,
			inventions: check.inventions,
		};
	}
	return { optimized, rejected: false, preserved: true, violations: [], inventions: [] };
}

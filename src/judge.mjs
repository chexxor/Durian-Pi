// Blind pairwise judge: compares a draft against its optimized rewrite
// without knowing which is which. Randomized A/B assignment defeats
// position bias; a judge model DIFFERENT from the optimizer model defeats
// self-preference bias. Output is strict JSON so parsing failures are loud.
//
// The judge measures prompt QUALITY (clarity, completeness, actionability).
// Information preservation is checked mechanically elsewhere
// (analyzePreservation) - the judge is explicitly told not to reward
// additions, so "richer" cannot masquerade as "better".

export const JUDGE_SYSTEM = `You are a strict evaluator of prompts written for AI agents.

You will see two candidates labeled A and B. One is a rough draft, one may be an improved rewrite - you are NOT told which is which, and you must not guess.

Score both candidates on three dimensions, each 1-5:
- clarity: unambiguous, one reading possible
- completeness: all requirements of the task present (NOT extra ones)
- actionability: an agent could act on it without asking questions

Penalize invented requirements, vagueness, and filler. Reward precision only.

Respond with ONLY a JSON object, no markdown fences:
{"a": {"clarity": n, "completeness": n, "actionability": n},
 "b": {"clarity": n, "completeness": n, "actionability": n},
 "overall": "A" | "B" | "tie",
 "reason": "<one sentence>"}`;

/**
 * Judge draft vs optimized blindly.
 * @param {import("@earendil-works/pi-ai").Models} models
 * @param {{provider: string, modelId: string}} judgeRef model doing the judging
 * @param {string} draft
 * @param {string} optimized
 * @returns {Promise<{winner: "draft"|"optimized"|"tie", scores: object,
 *   reason: string}>}
 */
export async function judgePair(models, judgeRef, draft, optimized) {
	const model =
		models.getModel(judgeRef.provider, judgeRef.modelId) ??
		models.getModelsOfType("text", judgeRef.provider)?.find((m) => m.id === judgeRef.modelId);
	if (!model) throw new Error(`judge model not found: ${judgeRef.provider}/${judgeRef.modelId}`);

	// Coin flip decides whether the draft plays role A or B.
	const draftIsA = Math.random() < 0.5;
	const a = draftIsA ? draft : optimized;
	const b = draftIsA ? optimized : draft;

	const message = await models.completeSimple(
		model,
		{
			messages: [
				{ role: "system", content: JUDGE_SYSTEM },
				{ role: "user", content: `Candidate A:\n${a}\n\nCandidate B:\n${b}` },
			],
		},
	);
	const raw = (message.content ?? [])
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start < 0 || end <= start) {
		throw new Error(`judge returned no JSON object: ${raw.slice(0, 120)}`);
	}
	let parsed;
	try {
		parsed = JSON.parse(raw.slice(start, end + 1));
	} catch (err) {
		throw new Error(`judge JSON unparseable (${err?.message ?? err}): ${raw.slice(start, end + 1).slice(0, 200)}`);
	}
	if (!parsed.a || !parsed.b || !parsed.overall) {
		throw new Error(`judge JSON missing fields: ${raw.slice(start, end + 1).slice(0, 200)}`);
	}
	const sum = (side) =>
		(side.clarity ?? 0) + (side.completeness ?? 0) + (side.actionability ?? 0);
	const winner =
		parsed.overall.toUpperCase() === "A"
			? (draftIsA ? "draft" : "optimized")
			: parsed.overall.toUpperCase() === "B"
				? (draftIsA ? "optimized" : "draft")
				: "tie";
	return {
		winner,
		scores: { a: parsed.a, b: parsed.b },
		reason: String(parsed.reason ?? ""),
	};
}

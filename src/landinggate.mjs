// src/landinggate.mjs — the landing regression gate as a RULE, not a habit (#6090).
//
// The defect this module exists to close: `scripts/land.mjs` treated the suite gate as
// opt-in. With neither `--suite` nor `--changed-suite` it merged, advanced main, and
// reported `ok: true` with `suite: "not run — neither --suite nor --changed-suite was
// passed"`. Measured on the real rig (the landing at 1f6f26c5, reported by devtools under
// #6079): main advanced with no regression check, and the ONLY thing between an unproven
// landing and main was whether someone remembered a flag. An optional gate is a SIGNAL;
// the landing is the DECISION (#3575's rule: a cheap or optional signal may accept, it may
// not decide). So the gate is now required, and the one lighter path — documentation only —
// is verified against the diff rather than taken on the flag's word.
//
// Kept pure and dependency-free on purpose: land.mjs refuses before it touches git, so
// the decision must be computable from the argv alone. `changedPaths` is supplied by the
// caller (git diff), never read here.
const DOC_EXT = /\.(md|txt|rst|adoc)$/i;

/** The three gate flags, exactly as the CLI spells them. */
export const GATE_FLAGS = { full: "--suite", derived: "--changed-suite", docsOnly: "--docs-only" };

/**
 * Read the gate out of argv. Anything that LOOKS like a gate flag but carries a value
 * (`--suite=false`, `--changed-suite=`, `--docs-only=off`) is collected in `bad`: a flag
 * that takes no value silently swallowing a bogus value is exactly the bypass the refusal
 * must not be walkable around.
 */
export function parseGateFlags(args = []) {
	const bad = [];
	let suite = false;
	let changedSuite = false;
	let docsOnly = false;
	for (const raw of args) {
		const a = String(raw).trim();
		if (a === GATE_FLAGS.full) suite = true;
		else if (a === GATE_FLAGS.derived) changedSuite = true;
		else if (a === GATE_FLAGS.docsOnly) docsOnly = true;
		else if (/^--(suite|changed-suite|docs-only)(=.*)?$/.test(a) && a !== GATE_FLAGS.full && a !== GATE_FLAGS.derived && a !== GATE_FLAGS.docsOnly) {
			bad.push(a);
		}
	}
	return { suite, changedSuite, docsOnly, bad };
}

/** Prose the suite cannot break: a Markdown/text file at the root or under `docs/`. */
export function isDocumentationPath(path) {
	const p = String(path ?? "").trim();
	if (!p) return false;
	if (!DOC_EXT.test(p)) return false;
	return p.startsWith("docs/") || !p.includes("/");
}

/**
 * Which dirt can THIS landing actually clobber? (#5347)
 *
 * The pre-flight used to refuse on EVERY line of `git status --porcelain`, untracked included. In a
 * live rig that is unpassable by construction: the broker and the spend ledger write beside the store
 * continuously, and other seats have edits in flight. What the pre-flight is actually protecting is
 * the `git merge --ff-only` at the end of the pass - and a fast-forward can only be broken by a path
 * it WRITES. So the rule is INTERSECTION, not cleanliness:
 *   refuse  - a dirty path the landing changes: a tracked modification git would have to overwrite,
 *             or an untracked file the branch adds (git refuses the FF: "untracked working tree files
 *             would be overwritten").
 *   proceed - everything else, REPORTED. Dirt that is named is a legible state; dirt that stops a
 *             landing which cannot touch it is a gate measuring nothing.
 * Attribution of in-flight edits is #3648's registered requirement, not this gate's job.
 */
export function classifyTreeDirt(dirtyLines = [], landingPaths = []) {
	const landing = new Set(landingPaths.map((p) => String(p).trim()).filter(Boolean));
	const refuse = [];
	const proceed = [];
	for (const raw of dirtyLines) {
		const line = String(raw).trimEnd();
		if (!line) continue;
		const status = line.slice(0, 2);
		let path = line.slice(2).trim();
		if (!path) continue;
		if (status.startsWith("R") || status.startsWith("C")) path = path.split(" -> ")[1] ?? path; // rename/copy: the destination is what the tree holds
		const tracked = status !== "??";
		const touched = landing.has(path);
		const entry = { path, status, tracked, touched };
		if (touched) {
			refuse.push({
				...entry,
				why: tracked ? "tracked edit in flight on a path this landing writes" : "untracked file this landing adds - git would overwrite it",
			});
		} else {
			proceed.push({
				...entry,
				why: tracked ? "tracked edit in flight, not written by this landing" : "untracked artefact, not written by this landing",
			});
		}
	}
	return { ok: refuse.length === 0, refuse, proceed };
}

/**
 * Is this landing gated? Returns `{ ok, gate, message }`.
 * `message` is the sentence the report carries, and on a refusal it NAMES the flag that
 * is missing — the whole point of the rule is that the absence is legible, not inferred.
 */
export function requireGate(flags, { branches = [] } = {}) {
	if (flags.bad.length) {
		return {
			ok: false,
			gate: null,
			message:
				`unrecognized gate flag(s): ${flags.bad.join(", ")}. ` +
				`${GATE_FLAGS.full} and ${GATE_FLAGS.derived} take no value — a value on them is not a weaker gate, it is no gate. ` +
				"Nothing was advanced.",
		};
	}
	if (flags.suite) return { ok: true, gate: "full", message: `gate: ${GATE_FLAGS.full} (every demo in the scratch)` };
	if (flags.changedSuite) {
		return {
			ok: true,
			gate: "derived",
			message: `gate: ${GATE_FLAGS.derived} (the subset the change derives) — NOT the full gate; the report names the areas it did not run`,
		};
	}
	return {
		ok: false,
		gate: null,
		message:
			`no regression gate: main does not advance without one. Missing: ${GATE_FLAGS.full} or ${GATE_FLAGS.derived}. ` +
			`Pass ${GATE_FLAGS.full} (the full gate) or ${GATE_FLAGS.derived} (the subset the change derives, which is NOT the gate and says so in the report). ` +
			"A documentation-only landing may add " +
			`${GATE_FLAGS.docsOnly} alongside ${GATE_FLAGS.derived} — it is checked against the diff, not taken on the flag's word. ` +
			`Nothing was advanced (branch(es): ${branches.join(", ") || "none given"}).`,
		};
}

/**
 * The lighter path, and why it is not a hole: `--docs-only` is an ATTESTATION that must be
 * true of the diff. It returns the changed paths when every one is documentation, and a
 * reason naming the offending path(s) when it is not. Empty diffs also fail — an unverifiable
 * claim is not a gate.
 */
export function docsOnlyAttestation({ flags, changedPaths = [] } = {}) {
	if (!flags?.docsOnly) return { ok: false, why: `${GATE_FLAGS.docsOnly} was not passed` };
	const paths = [...new Set(changedPaths.map((p) => String(p).trim()).filter(Boolean))];
	if (paths.length === 0) return { ok: false, why: "the diff named no changed path, so 'docs-only' cannot be verified" };
  const notDocs = paths.filter((p) => !isDocumentationPath(p));
	if (notDocs.length) {
		return {
			ok: false,
			why: `${notDocs.length} changed path(s) are not documentation: ${notDocs.join(", ")}`,
		};
	}
	return { ok: true, paths, why: `${paths.length} changed path(s), all documentation` };
}

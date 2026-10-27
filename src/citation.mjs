// The CITATION-RESOLUTION signal, read out of the queue and git (ROADMAP 190).
//
// WHY A CHECK AND NOT A NOTE: measured on the Windows→Linux move of this workspace (2026-10-26),
// 178 distinct commit shas were cited across the queue and 90 of them resolved NOWHERE — not this
// clone, not the vendored pi tree, not `origin` after a clean fetch. They sat on 240 terminal rows
// and on 14 NON-TERMINAL rows whose verification evidence the seat that picks them up cannot
// re-check. Repairing it was a session's work: mount the other volume, fetch its branches, recover
// dangling objects with rev-list/pack-objects/index-pack, then resolve the remainder by
// patch-equivalence. A runbook sentence did not prevent that and would not catch the next one.
//
// THE CLASS, precisely: the queue cites MACHINE-LOCAL GIT OBJECTS as durable evidence. A sha is a
// pointer; a pointer into an object store that did not travel with the store is not evidence. The
// store crossed machines and the history did not, and nothing said so.
//
// WHAT THIS CAN AND CANNOT TELL YOU — the stated limit, and it is the important paragraph:
// `git cat-file` answers "does THIS CLONE hold the object". A citation that fails here may be
//   (a) a STALE POINTER — the seat cited its branch commit and landing rewrote it. Measured case:
//       #3743/#4378 cite `0c6fd7665`, which matches no object, while the landing is `0c6fd76e465…`
//       and the change is on main. Nothing was lost; only the pointer is wrong; and
//   (b) LOST WORK — the object never arrived and cannot be recovered.
// The rule CANNOT tell (a) from (b); only patch-equivalence can (`git log -S`, `--grep='#<id>'`,
// `git patch-id`). So it reports exactly what it measured — "this clone cannot check it" — and its
// fix names the ladder rather than pretending to a verdict it does not have.
//
// Like src/commitmsg.mjs and src/featuredocs.mjs this module only READS git and returns PLAIN
// VALUES, so `check` stays a linter over data (the rule never runs a subprocess itself).
//
// Honesty rule (same as those modules): "no git / not a repository" is UNKNOWN, not clean.
// readCitations returns null and the rule is reported SKIPPED with its reason, never silently passed.

import { execFileSync } from "node:child_process";

/**
 * Run git and return raw stdout, or null when git, the repository, or the command is unavailable.
 * Every failure mode collapses to null deliberately: "I could not read this" is one state.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} [input] stdin for the command (the batch-check list)
 * @returns {string|null}
 */
function git(args, cwd, input) {
	try {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
			timeout: 15000,
			maxBuffer: 32 * 1024 * 1024,
			...(input === undefined ? {} : { input }),
		});
	} catch {
		return null;
	}
}

/** A citation is a hex run long enough to be a git object prefix: 8..40 chars. */
const CITED = /\b[0-9a-f]{8,40}\b/g;

/**
 * Extract the commit-looking tokens from prose.
 *
 * A run must carry BOTH a digit and a letter. Without that rule the extractor reports every date
 * (`2026-10-26`), every round number and every hex-looking word as a citation, the rule's findings
 * become noise, and a reader learns to ignore the one that matters — which is the failure mode the
 * rule exists to avoid. The cost of the rule is a genuine all-letter prefix (`deadbeef…`), which is
 * not reported; that is stated here rather than discovered later.
 *
 * @param {string} text
 * @returns {string[]} unique citations, in first-seen order
 */
export function extractCitedShas(text) {
	const out = [];
	for (const m of String(text ?? "").matchAll(CITED)) {
		const s = m[0];
		if (!/[0-9]/.test(s) || !/[a-f]/.test(s)) continue;
		if (!out.includes(s)) out.push(s);
	}
	return out;
}

/**
 * Resolve every sha cited by the queue against THIS repository, in ONE git process.
 *
 * One process matters: the queue cites ~180 distinct shas, and a spawn per sha turns `check` into a
 * multi-second stall. `--batch-check` reads all of them on stdin and answers in input order.
 *
 * @param {object} opts
 * @param {string} opts.root repository to resolve against
 * @param {{id:number,status:string,subject?:string,body?:string}[]|null} opts.queueItems
 * @returns {{itemId:number,status:string,sha:string,resolves:boolean,type:string}[]|null}
 *   null when git/the repository is unavailable (UNKNOWN, not clean).
 */
export function readCitations({ root, queueItems }) {
	// Can this repository be read at all? Asked BEFORE looking at the rows, so an empty queue in a
	// non-repository is still UNKNOWN rather than a vacuous pass.
	if (git(["rev-parse", "--git-dir"], root) === null) return null;
	const rows = Array.isArray(queueItems) ? queueItems : [];
	const perRow = rows
		.map((item) => ({ item, shas: extractCitedShas(`${item.subject ?? ""}\n${item.body ?? ""}`) }))
		.filter((r) => r.shas.length > 0);
	const all = [...new Set(perRow.flatMap((r) => r.shas))];
	if (all.length === 0) return [];
	const out = git(["cat-file", "--batch-check=%(objectname) %(objecttype)"], root, `${all.join("\n")}\n`);
	if (out === null) return null;
	const typeOf = new Map();
	out
		.split("\n")
		.filter((line) => line !== "")
		.forEach((line, i) => {
			if (all[i] === undefined) return;
			// A missing object prints "<input> missing" whatever the format string says.
			const type = line.trim().split(/\s+/)[1] ?? "missing";
			typeOf.set(all[i], type);
		});
	const citations = [];
	for (const { item, shas } of perRow) {
		for (const sha of shas) {
			const type = typeOf.get(sha) ?? "missing";
			citations.push({ itemId: item.id, status: item.status, sha, resolves: type !== "missing", type });
		}
	}
	return citations;
}

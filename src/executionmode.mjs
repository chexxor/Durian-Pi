// src/executionmode.mjs — the execution-mode rule as ONE function (#7158).
//
// WHY THIS EXISTS. docs/WORK-ITEM-MODEL.md §3 states the rule ("default is branchless; a
// worktree is granted only on demonstrated need") and names the predicate that already
// exists — `isDocumentationPath` (src/landinggate.mjs) — but no code computed a mode, and
// src/seattools.mjs calls `prepareSeatWorkspace` unconditionally. That is why §1 counts
// 122 refs for 113 worktrees: a tree is minted for every item whatever it changes.
//
// ONE FUNCTION, TWO CALL SITES (the item's acceptance condition). Mint (src/rig.mjs
// `enqueueItem`) records the classification on the row; the gate (src/seattools.mjs
// `prepare_workspace`) recomputes it from the row and reports it. Both call THIS function,
// so "what the row was minted as" and "what the gate needs" cannot drift silently — when
// they do, the gate says DRIFT out loud.
//
// PURE BY DESIGN, like src/landinggate.mjs: no store, no git, no fs. The caller supplies the
// row's prose. That is what makes the rule testable without a 611 MB store.
//
// THE THREE QUESTIONS, in order; the first YES decides. They overlap on purpose: a row that
// names `demo/x.test.mjs` answers question 1 (a non-documentation path) and question 2 (a run
// against a changed tree) with the same answer, so rule 1 wins and the mode is the same.
//   1. Does the item name paths that are not documentation?
//   2. Does it name a command that can only run against a tree holding the change?
//   3. Does it spawn processes or open the store?
// A NO to all three is BRANCHLESS: a change no worktree can meaningfully isolate.

import { isDocumentationPath } from "./landinggate.mjs";

/** The two modes the model names. A third value is a bug, not a mode. */
export const MODES = ["isolated", "branchless"];

/** Path-shaped tokens. Deliberately an extension whitelist, so "v1.4", "e.g.", "RM-12" and
 * "2,018 rows" are not read as files. */
const PATH_RE =
	/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts|json|md|txt|rst|adoc|sh|ps1|py|sql|sqlite|html|css|ya?ml|toml|svg|png|jpg)/g;

/** Question 2: a run that means nothing without the change IN the tree it runs in. */
const RUN_RES = [
	/\.test\.mjs/,
	/\bdemo\//,
	/scripts\/(?:test|suite)\.mjs/,
	/--area\s+\w/,
	/\bnpm (?:ci|test|run)\b/,
	/\bnode (?:scripts|tools|demo)\//,
	/\bsync-pi\b/,
	/\bbuild\b/,
	/\bprobe\b/,
	/\b(?:full|changed) suite\b/,
];

/** Question 3: processes and stores the row has to touch, expressed as VERBS, because a row
 * may legitimately document a broker without starting one. */
const PROCESS_RES = [
	/child_process/,
	/\bspawn\b/,
	/\bexecFile\b/,
	/\b(?:start|run|launch|restart|stop)s?\b[^.\n]{0,24}\b(?:broker|serve|rig|seat)\b/i,
	/\bcli\.mjs serve\b/,
	/\b(?:open|opens|opened|query|querying|dump|read|reads)\b[^.\n]{0,30}\.(?:sqlite|db)\b/i,
	/\.(?:sqlite|db)\b/i,
	/\bnpm (?:ci|install)\b/,
];

/** A path that sits as the OPERAND of a run verb (`node cli.mjs`, `node demo/x.test.mjs`) is a
 * PROGRAM the row executes, not a file the row changes. Rule 1 asks about files; execution is
 * question 2. Without this split, every row that mentions `cli.mjs` would read as touching tracked
 * code and the rule would grant a tree to prose. */
const RUN_VERB_BEFORE_RE = /(?:node|npm|npx|tsx|bash|sh|python3?|deno|scripts\/|tools\/)\s+$/i;

/** What the row said, as the rule saw it. Kept on the row so a reader can check the
 * classification without re-running the classifier. */
function signalsOf(text) {
	const codePaths = [];
	const docPaths = [];
	const runPrograms = [];
	const storePaths = [];
	for (const m of text.matchAll(PATH_RE)) {
		const path = m[0];
		const before = text.slice(Math.max(0, m.index - 12), m.index);
		if (RUN_VERB_BEFORE_RE.test(before)) {
			if (!runPrograms.includes(path)) runPrograms.push(path);
			continue;
		}
		// A store is not tracked code: naming it is question 3 ("does the row open the store?"),
		// not question 1 ("does the row change code").
		if (/\.(?:sqlite|db)$/i.test(path)) {
			if (!storePaths.includes(path)) storePaths.push(path);
			continue;
		}
		const bucket = isDocumentationPath(path) ? docPaths : codePaths;
		if (!bucket.includes(path)) bucket.push(path);
	}
	return {
		codePaths,
		docPaths,
		runPrograms,
		storePaths,
		runs: RUN_RES.filter((re) => re.test(text)).map((re) => re.source),
		processes: PROCESS_RES.filter((re) => re.test(text)).map((re) => re.source),
	};
}

/**
 * The mode of a row: { mode, rule, why, signals }.
 * `rule` is null for branchless (no rule fired), 1/2/3 for isolated.
 */
export function executionMode(row = {}) {
	const text = `${row?.subject ?? ""}\n${row?.body ?? ""}`;
	const signals = signalsOf(text);
	if (signals.codePaths.length) {
		return {
			mode: "isolated",
			rule: 1,
			why: `names tracked code (${signals.codePaths.slice(0, 3).join(", ")}${signals.codePaths.length > 3 ? ", …" : ""})`,
			signals,
		};
	}
	if (signals.runs.length) {
		return {
			mode: "isolated",
			rule: 2,
			why: "its acceptance names a command that can only run against a tree holding the change",
			signals,
		};
	}
	if (signals.processes.length) {
		return {
			mode: "isolated",
			rule: 3,
			why: "it spawns a process or opens the store",
			signals,
		};
	}
	return {
		mode: "branchless",
		rule: null,
		why: "no tracked code named, nothing to run against a changed tree, no process or store touched",
		signals,
	};
}

/** The compact form stored on the row: the classification, not the signal dump. */
export function executionModeRecord(row = {}) {
	const { mode, rule, why } = executionMode(row);
	return { mode, rule, why };
}

/** Does this command need a tree that carries the change? Used by the guard to decide when
 * the mode is worth saying. */
export function needsChangedTree(command = "") {
	const text = String(command);
	return RUN_RES.some((re) => re.test(text)) || /\bgit commit\b/.test(text);
}

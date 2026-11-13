#!/usr/bin/env node
// scripts/land.mjs — the landing helper (landing safety, lead #1164 Q1+Q3; items #1165/#1171).
//
// WHY THIS EXISTS. On 2026-10-17 a multi-branch landing pass merged into the SHARED working
// tree while the rig was live. One branch conflicted, so the tree sat with `.git/MERGE_HEAD`
// and `<<<<<<<` markers in src/checkup.mjs — and every `node cli.mjs` verb died with a
// SyntaxError. The harm was not the conflict; it was the shared tree being left in an
// unresolved state AT ALL, for any duration.
//
// This helper STRUCTURALLY prevents that state. The merges happen in a SCRATCH DETACHED
// worktree; `main` is advanced only by a CLEAN FAST-FORWARD once the scratch is clean. The
// shared tree is never mid-merge, whatever a branch does.
//
// It is ALSO the ENFORCEMENT chokepoint for the pre-flight guard (#1164 Q3): it REFUSES to
// land when the shared tree has TRACKED modifications or is already mid-merge, and when the
// store it resolved is NOT the one holding the live lock (#1383). A live genlock holder beside
// the RESOLVED store no longer refuses (#1497/#1498): the lander publishes a PRIORITY
// reservation and WAITS for the slots at the FF (see the lock section below), because refusing
// on exactly that condition made the waiting lock unreachable and stalled every landing while
// any seat generated (#1509). (seatguard's git-state block is defense-in-depth; the runbook and
// `check` are ADVISORY ONLY and are never the thing that stops a bad landing.)
//
// lead #1429 condition (b): the pre-flight check above is a START-CHECK only — a generation
// can start between it and the FF. So the FF-advance ALSO runs under an EXCLUSIVE lock the
// helper HOLDS across it: it claims ALL N generation slots (a generation claims one of N, so
// claiming every one makes new generations impossible) and releases on every exit path.
// N is DURIG_MAX_CONCURRENT_SEATS; when the rig is UNCAPPED (unset/<=0) it creates no slot
// files, so there is no slot to take and the FF runs unprotected — reported in `lock`.
//
// NOT built on purpose: a hunk-picker / `apply_patch` (the #714 conflict needed SYNTHESIS —
// a union of both branches' rules — which selection cannot produce). Any conflict tool is
// gated on MEASURED incidence (ROADMAP 100).
//
// usage:
//   node scripts/land.mjs <branch> [<branch>...] [--repo <dir>] [--db <path>] (--suite | --changed-suite) [--docs-only] [--keep] [--json]
//
//   --repo <dir>   the shared repository root (default: the repo containing cwd)
//   --db <path>    the rig store, for the genlock pre-flight (default: DURIG_DB, else the store the
//                  repo is ACTUALLY using — the live broker's `<db>.broker.json`, or the only store
//                  with a live genlock — and only then `./rig.sqlite`; #1383)
//   --suite        run every demo/*.test.mjs IN the scratch worktree and refuse to advance
//                  main if any fails (exit 0 = pass)
//   --changed-suite (#4936) run only the tests the change DERIVES, selected by the same
//                  `tools/what-to-test.mjs` the operator uses — no second path→test map — then
//                  report which AREAS ran and which did NOT. It is never a green gate: a pass here
//                  means "the derived subset is green", and if the derivation finds NO test under
//                  the change the landing is REFUSED rather than advanced unchecked. `--suite` still
//                  wins if both are given.
//   --docs-only    (#6090) the lighter path, used with --changed-suite when the derivation finds no
//                  test under the change. It is an ATTESTATION CHECKED AGAINST THE DIFF: every
//                  changed path must be prose (a root .md/.txt or something under docs/). When it
//                  holds, the landing runs the `docs` area and the report says which areas did NOT
//                  run. When it does not, the flag is refused and names the offending path. A flag is
//                  never taken on its own word.
//
//   REQUIRED GATE (#6090): one of --suite / --changed-suite must be passed. Before #6090 the gate
//   was opt-in and a landing (1f6f26c5, reported under #6079) advanced main with no regression check
//   at all; the report said "not run - neither --suite nor --changed-suite was passed", which is a
//   fact only because someone happened to write it. An optional gate is a signal, not a decision
//   (#3575): the landing is the decision, so the decision requires the gate.
//   --keep         keep the scratch worktree on failure, so a conflict can be resolved there
//   --json         machine-readable report (always printed; this flag is accepted for symmetry)
//
// Exit 0 = main advanced (or already contained every branch); nonzero = refused or stopped,
// with the reason in the report. It NEVER forces, and it NEVER leaves the shared tree
// mid-merge.

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DEFAULTS_CONFIG_PATHS, DEFAULT_CONFIG_PATHS } from "../src/config.mjs";
import { landingChangedPaths, readTextIntegrity } from "../src/textintegrity.mjs";
import { parseGateFlags, requireGate, docsOnlyAttestation } from "../src/landinggate.mjs";
import { dependencyProvenance, formatDependencyProvenance } from "../src/provenance.mjs";
// #4936: the CHANGED-SUITE scope report — which areas ran and which did NOT. It reads the SAME
// area data as `scripts/test.mjs` and `tools/what-to-test.mjs`; it is a reporter, not a second
// selector, and that is the whole point (#4922: a second mechanism is the thing that drifts).
import { changedSuiteScope, selectTests } from "../src/testareas.mjs";
// The PRIORITY reservation + the wait-with-priority claim (#1497/#1498, lead #2054 precondition
// (c)). Imported from a deliberately DEPENDENCY-FREE module (node:fs/node:path only) so this
// chokepoint still loads when the provider stack is broken — the #1164 Q3 rule this file's own
// header states, and the reason it must NOT import src/genlock.mjs (which pulls pi-ai).
import {
	acquireAllSlotsSync,
	isReservationPath,
	liveGenerationHolders,
	releaseReservation,
	releaseSlotsSync,
	reserveSlots,
} from "../src/genlockreserve.mjs";

const args = process.argv.slice(2);
// Options that take a VALUE — their value must not be mistaken for a branch name.
const VALUE_OPTIONS = new Set(["--repo", "--db"]);
const branches = [];
for (let i = 0; i < args.length; i += 1) {
	const a = args[i];
	if (VALUE_OPTIONS.has(a)) {
		i += 1; // skip the option's value
		continue;
	}
	if (a.startsWith("--")) continue;
	branches.push(a);
}
const option = (name) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
const gateFlags = parseGateFlags(args);
const wantSuite = gateFlags.suite;
// #4936: the cheap honest path. Measured cost of the alternatives: `--suite` is ~239 tests / ~10 min.
// #6090: it is no longer optional — a landing with no gate flag is refused before it touches git.
const wantChangedSuite = gateFlags.changedSuite;
const keepScratch = args.includes("--keep");
// Paths the landing changes, collected for the --docs-only attestation (#6090). Filled by the
// text-integrity loop below, which already walks the same diff.
const gateChangedPaths = [];

/** Run git and capture everything; the caller decides whether a failure is fatal. */
function git(cwd, argv) {
	const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
	return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function report(payload, code) {
	console.log(JSON.stringify(payload, null, 2));
	process.exit(code);
}

/* ───────── the genlock pre-flight ─────────
 * Deliberately LOCAL and dependency-free: this helper must load without the provider stack.
 * src/genlock.mjs imports pi-ai, and a chokepoint that a broken dependency can disable is
 * exactly the mistake the 2026-10-17 incident taught (checkup.mjs). The LIVENESS RULE is not
 * written here: it comes from src/genlockreserve.mjs `ownerState`, the same rule the lease layer
 * uses (#5020). A lander that decides liveness with its own test can call a slot free while the
 * rig still honours it — `liveHolders: 0` beside a live writer is that divergence, not a quiet rig.
 * A dead holder's slot is stale and the broker reconciles it, so it does not block a landing.
 */
const heldGenlocks = liveGenerationHolders;

/* ─────────── the EXCLUSIVE landing lock (lead #1429 condition (b)) ───────────
 * The FF-advance must happen under a lock HELD ACROSS it, not merely a start-check: a new
 * generation can otherwise start between the check and the FF. The generation slots ARE that
 * lock — every generation claims one of N — so claiming ALL N makes new generations
 * impossible while we hold them. We hold them for the FF only (the critical section) and
 * release on every exit path.
 *
 * N is DURIG_MAX_CONCURRENT_SEATS (the source cli.mjs's maxSeats() uses). When it is unset
 * or <= 0 the rig runs UNCAPPED: it creates no slot files, so there is no generation slot to
 * take and the landing proceeds without a held lock — reported loudly in `lock`. */

/** The first candidate file that declares a usable DURIG_MAX_CONCURRENT_SEATS, else undefined. */
function readCapFrom(root, names) {
	for (const name of names) {
		try {
			const raw = JSON.parse(readFileSync(join(root, name), "utf8")).DURIG_MAX_CONCURRENT_SEATS;
			if (raw !== undefined && raw !== "") return raw;
		} catch {
			// absent or unreadable: try the next candidate
		}
	}
	return undefined;
}

/** The number of generation slots, or null when the rig is uncapped.
 *
 * #2224(A): the lander MUST resolve the same N the broker does. The broker
 * (`cli.mjs maxSeats()` over CFG) reads env > config file > the shipped DEFAULTS file. The
 * old fallback here was `null` (uncapped), so on a config-less checkout (CI / fresh clone)
 * the lander skipped BOTH the priority reservation and the exclusive slot claim while the
 * broker was capped at the shipped default (1) -- and the lander could fast-forward main with
 * a live generation in flight. The candidate paths come from src/config.mjs, so the two
 * resolvers cannot drift apart again. */
function resolveSlotCount(repoRoot) {
	let raw = process.env.DURIG_MAX_CONCURRENT_SEATS;
	if (raw === undefined || raw === "") raw = readCapFrom(repoRoot, DEFAULT_CONFIG_PATHS);
	if (raw === undefined || raw === "") raw = readCapFrom(repoRoot, DEFAULTS_CONFIG_PATHS);
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// The slot constants, the stale rule, the claim loop and the release loop now live in
// src/genlockreserve.mjs, shared with the broker's in-process gate (src/genlock.mjs) so the two
// sides cannot disagree about what "held", "stale" or "waits" means. Only the blocking sleep
// stays here: it is a script-local detail, not a rule.

/** Synchronous sleep — land.mjs is a sync script (spawnSync), so the acquire loop blocks. */
function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* ───────── resolve the shared repo ───────── */

const repoArg = option("--repo");
const discovered = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out;
const repoRoot = resolve(repoArg ?? (discovered || process.cwd()));
if (!existsSync(join(repoRoot, ".git"))) {
	report({ ok: false, command: "land", error: `${repoRoot} is not a git repository root` }, 1);
}
if (branches.length === 0) {
	report({ ok: false, command: "land", error: "land needs at least one <branch> to land" }, 1);
}

/* ───────── resolve the STORE the genlock probe should watch (#1383) ─────────
 * The probe used to default to `<repo>/rig.sqlite` even when the rig's LIVE store was another
 * file in the same repo — so it MISSED the live lock and the landing PROCEEDED. A chokepoint
 * that silently watches the wrong store defeats the quiescence check it exists to enforce.
 * Resolution order: --db/DURIG_DB, the live broker's `<db>.broker.json`, the only store with a
 * live genlock, then the documented default. */
function liveGenlockStores(root) {
	const found = [];
	if (!existsSync(root)) return found;
	for (const name of readdirSync(root)) {
		const m = /^(.*)\.genlock\.\d+$/.exec(name);
		if (!m) continue;
		const db = join(root, m[1]);
		if (heldGenlocks(db).length > 0 && !found.includes(db)) found.push(db);
	}
	return found;
}

function resolveStore(root, explicit) {
	if (explicit) return { path: resolve(explicit), why: "--db / DURIG_DB" };
	const brokers = readdirSync(root).filter((n) => n.endsWith(".broker.json"));
	if (brokers.length === 1) {
		return {
			path: join(root, brokers[0].slice(0, -".broker.json".length)),
			why: "the live broker's <db>.broker.json",
		};
	}
	const live = liveGenlockStores(root);
	if (live.length === 1) return { path: live[0], why: "the only store with a live genlock" };
	return { path: join(root, "rig.sqlite"), why: "the documented default" };
}

const store = resolveStore(repoRoot, option("--db") ?? process.env.DURIG_DB ?? null);
const dbPath = store.path;

const base = { ok: false, command: "land", repo: repoRoot, db: dbPath, branches };

// #4247: REFUSE unless the resolved repo IS the SHARED ROOT. A seat's cwd is its item worktree by
// default, so running this from there is the NATURAL mistake, not a careless one - and it is the ONE
// case the cwd guard cannot see: an item worktree is not a DEGRADED cwd, it is simply the WRONG
// repository to land INTO. Measured 2026-10-20: `node scripts/land.mjs impl-item-4225` run from
// inside item-4225 created a STORE in the worktree, merged there, and still returned
// `ok:true, merged:[...]` while `main` was untouched (`git merge-base --is-ancestor 81ef0fb main`
// exited 1). The report is the thing that lied, so the refusal comes BEFORE any merge is computed -
// no `merged:[...]` is ever printed against the wrong repository.
// The SOURCE is `git worktree list`: its FIRST entry is the MAIN worktree, which IS the shared root;
// a linked worktree is never first. Absent/unparseable output leaves the check silent rather than
// guessing (fail-open on an unreadable source, since a wrong refusal blocks every legitimate landing).
const sharedRoot = (() => {
	const m = /^worktree (.+)$/m.exec(git(repoRoot, ["worktree", "list", "--porcelain"]).out);
	return m ? resolve(m[1].trim()) : null;
})();
if (sharedRoot && sharedRoot !== resolve(repoRoot)) {
	report(
		{
			...base,
			error:
				`refusing to land: --repo resolves to ${repoRoot}, which is NOT the shared root ` +
				`(${sharedRoot}) - it is a LINKED worktree. A landing must advance main in the shared ` +
				`checkout; landing here would merge into an item worktree and leave main UNTOUCHED. ` +
				`Run this from the shared tree: node scripts/land.mjs <branch> --repo ${sharedRoot}`,
			sharedRoot,
		},
		1,
	);
}

/* ───────── pre-flight: the enforcement chokepoint ───────── */

// The shared root must be CLEAN before a landing pass — UNTRACKED INCLUDED — because A SUITE RUN
// IN `.` MEASURES THE SHARED TREE, NOT MAIN: a green there is not evidence about the merge and a
// red there is not a regression. The earlier TRACKED-ONLY filter would have PASSED the third
// instance of this hazard (an untracked `src/tui/durable/attach.mjs` written by a live seat), so
// untracked now counts. The suite itself already runs in the detached SCRATCH (below), not `.`.
const status = git(repoRoot, ["status", "--porcelain"]);
const dirty = status.out
	.split("\n")
	.map((l) => l.trimEnd())
	.filter((l) => l.length > 0);
if (dirty.length > 0) {
	// Attribution where a path reveals it (an `item-<id>/` path names its item); shared-tree dirt
	// usually does not, so most paths are named without an owner — attribution for those is
	// #3648's registered requirement, not this gate's.
	const attributed = dirty.map((line) => {
		const path = line.slice(2).trim();
		const m = /(?:^|\/)item-(\d+)(?:\/|$)/.exec(path);
		return m ? `${path} (item #${m[1]})` : path;
	});
	report(
		{
			...base,
			error:
				`refusing to land: the shared tree at ${repoRoot} is NOT clean (${dirty.length} path(s), ` +
				`UNTRACKED INCLUDED). A suite run in \`.\` measures the SHARED TREE, not main — a green there ` +
				`is not evidence about the merge and a red is not a regression. Commit, stash or remove the ` +
				`listed paths, then re-run.`,
			dirtyPaths: attributed,
		},
		1,
	);
}

// #4139: a write to a REAPED worktree path recreates `item-<id>/` inside the repo. No other guard
// sees it: the cwd guard refuses RELATIVE writes from a degraded cwd, but this write is ABSOLUTE
// and the path LOOKS like a worktree; and `/item-*/` is IGNORED, so `git status --porcelain` never
// shows it either. A directory named for an item has no business being a repo-root child - but a
// LIVE worktree is legitimately `item-<id>/` at the root, so the test is REGISTRATION, not the name:
// a root child that matches a worktree-name pattern and is NOT in `git worktree list` is stray.
const WORKTREE_NAME = /^(item-\d+|verify.*|\.verify-.*|wt-.*|\.durig-test-wt-.*|\.land-scratch-.*)$/;
const registered = new Set(
	git(repoRoot, ["worktree", "list", "--porcelain"])
		.out.split("\n")
		.filter((l) => l.startsWith("worktree "))
		.map((l) => resolve(l.slice("worktree ".length).trim())),
);
const strayWorktrees = readdirSync(repoRoot, { withFileTypes: true })
	.filter((e) => e.isDirectory() && WORKTREE_NAME.test(e.name) && !registered.has(resolve(join(repoRoot, e.name))))
	.map((e) => e.name);
if (strayWorktrees.length > 0) {
	report(
		{
			...base,
			error:
				`refusing to land: ${strayWorktrees.length} STRAY worktree directory(ies) at the repo root: ` +
				`${strayWorktrees.join(", ")}. These are ignored by .gitignore, so \`git status\` does not show ` +
				`them - a write to a REAPED worktree path recreates one inside the repo. They are disposable ` +
				`checkouts (their work is on a branch), so remove them and re-run.`,
			strayWorktrees,
		},
		1,
	);
}

// A tree that is already mid-merge is refused too: the landing must not add to it.
if (existsSync(join(repoRoot, ".git", "MERGE_HEAD"))) {
	report(
		{
			...base,
			error:
				`refusing to land: ${join(repoRoot, ".git", "MERGE_HEAD")} exists — the shared tree is already ` +
				`mid-merge. Finish that merge (or abort it) first.`,
		},
		1,
	);
}

// #4371 TEXT-INTEGRITY PRECONDITION: a branch that would land a COLLAPSED file (or a broken
// encoding) is refused HERE, before the merge — THIS is the half that would have PREVENTED the
// 04:21Z flattening rather than reported it afterwards. `node --check` cannot see the class (the
// flattening turns the opening `//` into a comment that swallows the file, so it still parses and
// exports nothing), and the landing is the last moment at which the shared tree is still intact.
// The BRANCH's blobs are judged against the BASE, not the working tree.
for (const b of branches) {
	const paths = landingChangedPaths({ root: repoRoot, branch: b, base: "main" });
	for (const p of paths ?? []) gateChangedPaths.push(p);
	if (paths === null) continue; // the diff could not be read: not a reason to refuse (the merge will show it)
	const bad = readTextIntegrity({ root: repoRoot, paths, rev: b, headRev: "main" });
	if (bad.length > 0) {
		report(
			{
				...base,
				error:
					`refusing to land ${b}: ${bad.length} file(s) fail TEXT INTEGRITY — ` +
					`${bad.map((f) => f.path).join(", ")}. A collapsed newline structure (or a broken encoding) ` +
					`would take the shared tree down at import time; restore from main and re-apply the intended ` +
					`edit — do not patch bytes.`,
				textIntegrity: bad,
			},
			1,
		);
	}
}

/* ─────────── the required gate (#6090): no flag, no landing ───────────
 * Placed with the other preconditions (all read-only) and BEFORE the merge, so a landing that
 * cannot say which check ran never touches git. The substantive refusals above fire first: a
 * branch that is ALSO corrupt is refused for the corruption, which is the more specific fact.
 * An optional gate is a signal, not a decision (#3575); the landing is the decision. */
const gateDecision = requireGate(gateFlags, { branches });
if (!gateDecision.ok) {
	report({ ok: false, command: "land", gate: gateDecision.gate, error: gateDecision.message, branches, merged: [] }, 1);
}

/* ─────────── the --docs-only attestation is checked against the DIFF (#6090) ───────────
 * `--docs-only` asserts a fact about the landing. If the diff contradicts it, the landing is
 * refused HERE — before any merge — rather than quietly proceeding under whatever gate the
 * derivation happened to find. A flag that is not believed until verified is not a bypass. */
if (gateFlags.docsOnly) {
	const attested = docsOnlyAttestation({ flags: gateFlags, changedPaths: gateChangedPaths });
	if (!attested.ok) {
		report(
			{
				...base,
				error: `--docs-only asserted, but the diff contradicts it: ${attested.why}. A documentation-only landing means EVERY changed path is prose; this one is not. Nothing was advanced.`,
				docsOnly: attested,
				branches,
				merged: [],
			},
			1,
		);
	}
}

// #1383 VISIBILITY: a resolved store with NO live lock is NOT proof the rig is quiet — another
// store in the SAME repo may be the one in use. Refuse loudly rather than pass silently.
const liveElsewhere = liveGenlockStores(repoRoot).filter((p) => resolve(p) !== resolve(dbPath));
if (liveElsewhere.length > 0) {
	report(
		{
			...base,
			error:
				`refusing to land: the genlock probe resolved ${dbPath} (${store.why}) and it has NO live ` +
				`holder — but ${liveElsewhere.join(", ")} in this repo DOES. A generation is in flight on ` +
				`that store; re-run with --db ${liveElsewhere[0]} (or wait for it to settle).`,
			liveStores: liveElsewhere,
		},
		1,
	);
}

// A live holder no longer REFUSES the landing (#1497/#1498, lead #2054 precondition (c)).
// Refusing HERE was the structural bug: it made the waiting lock unreachable, so a coordinator
// that generates continuously (pm re-claims a slot every ~20-30 s) blocked every landing
// indefinitely (#1509: seven refusals in three minutes). Instead the lander PUBLISHES a priority
// reservation and WAITS for the slots at the FF, where new generations yield to it.
/* ───────── pre-flight: each BRANCH must be a landable object ─────────
 * Three checks. The first two are the "a rebase dropped a commit" family; the third is a
 * strictly worse failure the first two cannot see — a branch that would POISON main on merge.
 * Measured: devtools-item-2187 @5a99b14 resolves AND has valid ancestry, yet carries committed
 * conflict markers in 76 files; the first two checks pass it and only the third refuses it.
 *   1. rev-parse <branch>                        — the tip resolves to a real sha
 *   2. merge-base --is-ancestor <base> <branch>  — its ancestry includes the intended base
 *   3. git grep -l '^<<<<<<<' <branch>           — EMPTY output = no committed markers
 * NOTE the INVERTED exit code on (3): `git grep` exits 1 when there is NO match, so exit 1 is the
 * PASS case and exit 0 (with output) is the finding. Any OTHER exit (git grep exits 128 on a
 * git-level failure) is an ERROR, never a pass — "could not check" must not read as "clean".
 */
const baseRef = "main";
const baseSha = git(repoRoot, ["rev-parse", baseRef]);
if (baseSha.code !== 0) {
	report({ ...base, error: `cannot resolve the landing base '${baseRef}': ${baseSha.err}` }, 1);
}
for (const branch of branches) {
	const tip = git(repoRoot, ["rev-parse", branch]);
	if (tip.code !== 0) {
		report({ ...base, error: `pre-flight: cannot resolve branch '${branch}': ${tip.err}` }, 1);
	}
	// (2) ancestry — a FAST PATH ONLY, never a refusal. If the branch CONTAINS the base it is
	// definitely landable, so go straight to the merge; if the base CONTAINS the branch the work is
	// already in main (a re-run). If NEITHER, ancestry can say only "not definitely landable", never
	// "not landable" (#3272/#3337: content, not ancestry, proves landability), so we FALL THROUGH and
	// let the merge-tree decide. A branch forked from an older main is a backlog's normal state, not
	// a defect — refusing it would force a rebase where a clean merge would do.
	const containsBase = git(repoRoot, ["merge-base", "--is-ancestor", baseSha.out, tip.out]).code === 0;
	const alreadyLanded = !containsBase && git(repoRoot, ["merge-base", "--is-ancestor", tip.out, baseSha.out]).code === 0;
	const ancestry = containsBase ? "contains-base" : alreadyLanded ? "already-landed" : "neither";
	// (3) committed conflict markers — invisible to (1) and (2).
	const markers = git(repoRoot, ["grep", "-l", "^<<<<<<<", tip.out]);
	if (markers.code === 0) {
		const files = markers.out
			.split("\n")
			.map((l) => l.trim().replace(new RegExp(`^${tip.out}:`), ""))
			.filter(Boolean);
		report(
			{
				...base,
				error:
					`refusing to land '${branch}' (${tip.out.slice(0, 8)}): it carries COMMITTED CONFLICT MARKERS in ` +
					`${files.length} file(s) — a merge would import them into main, where every later verify would ` +
					`measure a tree that contains them. Re-cut the branch; do NOT rebase it.`,
				conflictMarkerFiles: files,
				ancestry,
			},
			1,
		);
	}
	if (markers.code !== 1) {
		report(
			{
				...base,
				error:
					`refusing to land '${branch}': the committed-conflict-marker check could not run (git grep exited ` +
					`${markers.code}: ${markers.err || "no stderr"}). "Could not check" is not "clean".`,
			},
			1,
		);
	}
}

const genlocks = heldGenlocks(dbPath);

/* ───────── land in a SCRATCH DETACHED worktree ───────── */

const mainBefore = git(repoRoot, ["rev-parse", "main"]);
if (mainBefore.code !== 0) {
	report({ ...base, error: `cannot resolve the 'main' branch: ${mainBefore.err}` }, 1);
}

const scratch = join(repoRoot, `.land-scratch-${process.pid}`);
if (existsSync(scratch)) {
	report({ ...base, error: `scratch path ${scratch} already exists — remove it and retry` }, 1);
}

function removeScratch() {
	const rm = git(repoRoot, ["worktree", "remove", "--force", scratch]);
	if (rm.code !== 0) {
		// Never leave a half-registered worktree behind; a leftover directory is reported.
		rmSync(scratch, { recursive: true, force: true });
		git(repoRoot, ["worktree", "prune"]);
	}
}

const added = git(repoRoot, ["worktree", "add", "--detach", scratch, mainBefore.out]);
if (added.code !== 0) {
	report({ ...base, error: `cannot create the scratch worktree at ${scratch}: ${added.err}` }, 1);
}

/* ───────── the scratch must carry the SAME dependencies as the tree it claims to measure ───────── */
// #5793 (first registered as #5832). A detached worktree gets the TRACKED tree only: `node_modules` is
// gitignored and lives in the working checkout. So `--suite` ran in a scratch with no dependencies at all,
// every demo that imports `@earendil-works/*` died with ERR_MODULE_NOT_FOUND, and the runner stops at the
// FIRST red — a green branch never reached main. Measured: main, 262/262 green with deps, was reported as
// `STOPPED: demo/commit-discipline-personas.test.mjs failed in the scratch worktree (exit 1)`.
// Symlink, not copy: node_modules is hundreds of MB and the scratch is disposable. If the checkout has NO
// node_modules the gate REFUSES instead of running a suite whose red is about its own environment.
function linkScratchDependencies(root, scratchPath) {
	const source = join(root, "node_modules");
	const target = join(scratchPath, "node_modules");
	if (!existsSync(source)) return { linked: false, source, target, reason: `${root} has no node_modules - the suite cannot resolve its imports there` };
	try {
		if (existsSync(target)) return { linked: true, source, target, reason: "node_modules already present in the scratch" };
		symlinkSync(source, target, "dir");
		return { linked: true, source, target, reason: `linked ${source} into the scratch` };
	} catch (err) {
		return { linked: false, source, target, reason: `could not link node_modules: ${err.message}` };
	}
}
const scratchDeps = linkScratchDependencies(repoRoot, scratch);
// #6196: which pi the scratch actually resolved. `node_modules` is symlinked from the working checkout, so the
// scratch inherits whatever set that checkout has - which is not necessarily the pinned build. Naming it here
// is what makes a suite number traceable to the graph it ran in; the refusal on drift is #6205, deliberately
// not shipped with this change.
const scratchProvenance = dependencyProvenance(scratch);
console.error(formatDependencyProvenance(scratchProvenance));

const merged = [];
for (const branch of branches) {
	const sha = git(repoRoot, ["rev-parse", branch]);
	if (sha.code !== 0) {
		removeScratch();
		report({ ...base, error: `cannot resolve branch '${branch}': ${sha.err}`, merged }, 1);
	}
	const merge = git(scratch, ["merge", "--no-ff", sha.out, "-m", `merge: land ${branch} onto main`]);
	if (merge.code !== 0) {
		// A conflict is EXPECTED sometimes; what must never happen is the SHARED tree being
		// left mid-merge. It is not: the scratch holds the merge, the shared tree is untouched.
		const conflicted = git(scratch, ["diff", "--name-only", "--diff-filter=U"]).out
			.split("\n")
			.filter(Boolean);
		if (!keepScratch) removeScratch();
		report(
			{
				...base,
				error:
					`STOPPED: '${branch}' conflicts (${conflicted.join(", ") || "unknown paths"}). The merge lives in ` +
					`the scratch worktree${keepScratch ? ` at ${scratch}` : ""} — the SHARED tree was never touched and ` +
					`is not mid-merge. Resolve it there (see docs/runbooks/resolve-merge-conflict.md), then re-run.`,
				merged,
				conflicted,
				scratch: keepScratch ? scratch : null,
			},
			1,
		);
	}
	merged.push({ branch, sha: sha.out, mergeSha: git(scratch, ["rev-parse", "HEAD"]).out });
}

/* ───────── optional: prove the result in the scratch before advancing main ───────── */

const suiteResults = [];
// #4996: a demo that cannot judge prints `SKIP: <reason>` and exits 0. The lander COLLECTS those lines and
// reports them, because the alternative is the failure this rig just paid twice: `demo/local-model-pointer`
// reads machine state (`durig.config.json`, which is gitignored), so in the scratch worktree the lander builds
// it was red for reasons the BRANCH did not cause, and a clean landing was refused. A skip is not a pass and is
// not a failure — it is a fact about the TREE the suite ran in, and it has to be named as one. Silence here is
// what let "the suite is red" and "the branch is bad" be read as the same sentence.
const suiteSkips = [];
const collectSkips = (test, stdout) => {
	for (const line of String(stdout ?? "").split(/\r?\n/)) {
		const m = /^SKIP: (.*)$/.exec(line.trim());
		if (m) suiteSkips.push({ test, reason: m[1] });
	}
};
const skipSummary = () =>
	suiteSkips.length === 0
		? "skipped 0"
		: `SKIPPED ${suiteSkips.length} (a skip is a fact about the TREE the suite ran in, not about the branch): ${suiteSkips.map((s) => `demo/${s.test} — ${s.reason}`).join(" | ")}`;
// #4936: what this pass actually covered, or null when no regression check ran. Declared out here so
// EVERY report path — including a STOPPED mid-suite run and the final ok — carries the same statement.
let suiteScope = null;
// #6090: WHICH gate ran. "The suite is green" means different things for the full sweep, the
// derived subset and the documentation area, so every report path has to say which one it is.
let gateKind = wantSuite ? "full" : "derived";
// Every report path says which gate ran — the stop paths as much as the success path (#6090).
const gateReport = () => ({
	kind: gateKind,
	command: gateKind === "full" ? "node scripts/test.mjs --all" : suiteScope?.gate?.command ?? null,
	statement:
		gateKind === "full"
			? `full gate: every demo in the scratch ran (${suiteResults.length} result(s))`
			: `${gateKind}: ${suiteScope?.ranCount}/${suiteScope?.totalTests} test(s); areas NOT covered [${suiteScope?.areasNotRun.join(", ")}]`,
});
await (async () => {
	if (wantSuite || wantChangedSuite) {
		if (!scratchDeps.linked) {
			// Not a refusal: a scratch with no dependencies is still a valid measurement for demos that import
			// nothing external, and refusing here would stop landings that are fine. What IS refused is blaming a
			// branch for a dependency red - see the classification in recordFailure below (#5793).
			console.error(`suite environment: node_modules MISSING in the scratch (${scratchDeps.reason}). A demo that fails with ERR_MODULE_NOT_FOUND here is the instrument, not the branch.`);
		} else {
			console.error(`suite environment: node_modules linked into the scratch (${scratchDeps.reason})`);
		}
		const demoDir = join(scratch, "demo");
	const allTests = existsSync(demoDir)
		? readdirSync(demoDir)
				.filter((n) => n.endsWith(".test.mjs"))
				.sort()
		: [];
	let tests = allTests;
	if (allTests.length === 0) {
		// A gate that runs nothing is not a gate (#6090): `--suite` on a tree with no demos would
		// otherwise report "full gate: 0 result(s)" and advance main.
		if (!keepScratch) removeScratch();
		report(
			{
				...base,
				error: `the gate has nothing to run: no demo/*.test.mjs exists in the scratch (${demoDir}). Zero tests is not a green gate. Nothing was advanced.`,
				merged,
				suite: "not run — there are no demos on disk to run",
				gate: gateReport(),
			},
			1,
		);
	}
	if (wantChangedSuite && !wantSuite) {
		/* ── #4936: derive the set; never invent one ── */
		// `tools/what-to-test.mjs` is the selector (it derives from what each demo's own source
		// names). It runs IN THE SCRATCH against the main that scratch forked from, so the change it
		// classifies is the change being landed — not the state of the shared tree, which is the
		// measurement error #4436 and the clean-root pre-flight exist to prevent.
		const wtt = spawnSync(process.execPath, [join(scratch, "tools", "what-to-test.mjs"), "--json", `--base=${mainBefore.out}`], { cwd: scratch, encoding: "utf8" });
		let verdict = null;
		try {
			verdict = JSON.parse(wtt.stdout ?? "");
		} catch {
			verdict = null;
		}
		if (!verdict || !Array.isArray(verdict.selected)) {
			if (!keepScratch) removeScratch();
			report(
				{
					...base,
					error:
						`--changed-suite could not classify this landing: tools/what-to-test.mjs exited ${wtt.status} ` +
						`(${(wtt.stderr ?? "").trim().split("\n").slice(-3).join(" | ") || "no output"}). Nothing was advanced: a subset ` +
						"that cannot be derived is not a check. Re-run with --suite.",
					merged,
				},
				1,
			);
		}
		if (verdict.scanFindings?.length) {
			// Recorded, not duplicated: this file already owns the landing byte-integrity gate
			// (`landingChangedPaths` / `readTextIntegrity`), so the finding is surfaced here rather
			// than gate-checked twice by two mechanisms.
			console.error(`changed-suite: what-to-test's byte scan flagged ${verdict.scanFindings.length} character(s) in changed files — see its own report`);
		}
		suiteScope = null;
		try {
			suiteScope = changedSuiteScope(scratch, { selected: verdict.selected.map((s) => s.test).filter((t) => typeof t === "string") });
		} catch (e) {
			// A rig with no area manifest has no area partition to derive FROM. Say that, with the
			// remedy, rather than dying in an uncaught throw inside the lock hold.
			if (!keepScratch) removeScratch();
			report(
				{
					...base,
					error: `--changed-suite is unavailable here: ${e.message}. Nothing was advanced — the area manifest is what makes a subset honest.`,
					merged,
				},
				1,
			);
		}
		base.suiteScope = suiteScope;
		// stdout carries the JSON report (#4403), so the scope goes to stderr where a human sees it live.
		console.error(
			`changed-suite: ran ${suiteScope.ranCount}/${suiteScope.totalTests} derived test(s) — areas RAN [${suiteScope.areasRan.join(", ") || "none"}], ` +
				`areas NOT RUN [${suiteScope.areasNotRun.join(", ") || "none"}] · NOT the full gate (${suiteScope.gate.command})`,
		);
		if (suiteScope.missingFromDisk.length) {
			console.error(`changed-suite: the selection named ${suiteScope.missingFromDisk.length} file(s) not on disk: ${suiteScope.missingFromDisk.join(", ")}`);
		}
		if (suiteScope.coverage === "none") {
			// The shape that makes this safe: a change with no mapped test under it must read as
			// NO COVERAGE, and a landing must not advance on a gate that ran zero tests.
			// #6090: the ONLY lighter path is a documentation-only change, and it is verified against
			// the diff before it is believed. When it holds the `docs` area runs — the landing is still
			// gated, and the report names the areas it did NOT cover.
			const attested = docsOnlyAttestation({ flags: gateFlags, changedPaths: gateChangedPaths });
			if (!attested.ok) {
				if (!keepScratch) removeScratch();
				report(
					{
						...base,
						error:
							`--changed-suite found NO coverage for this change: none of the ${suiteScope.totalTests} tests in the area manifest names any ` +
							`changed path (areas: ${suiteScope.areas.join(", ")}). Nothing was advanced — zero tests run is not a green gate. ` +
							"Re-run with --suite, or land a documentation-only change with --docs-only (attested: it is checked against the diff). " +
							`Why the lighter path does not apply here: ${attested.why}`,
						docsOnly: attested,
						merged,
						suiteScope,
						suite: "not run — the derived set was empty (no coverage, not a pass)",
					},
					1,
				);
			}
			let docsSelection = null;
			try {
				docsSelection = selectTests(scratch, { area: "docs" });
			} catch (e) {
				if (!keepScratch) removeScratch();
				report(
					{
						...base,
						error: `--docs-only landing cannot be gated: the "docs" area could not be resolved (${e.message}). Nothing was advanced.`,
						docsOnly: attested,
						merged,
						suiteScope,
					},
					1,
				);
			}
			if (docsSelection.files.length === 0) {
				if (!keepScratch) removeScratch();
				report(
					{
						...base,
					error: `--docs-only landing has nothing to run: the "docs" area maps to zero tests. Zero tests run is not a green gate. Nothing was advanced.`,
						docsOnly: attested,
						merged,
						suiteScope,
					},
					1,
				);
			}
			suiteScope = changedSuiteScope(scratch, { selected: docsSelection.files });
			base.suiteScope = suiteScope;
			gateKind = "docs-area (documentation-only, attested against the diff)";
			console.error(
				`docs-only gate: ${attested.why} — ran the "docs" area (${suiteScope.ranCount} test(s)); ` +
					`areas NOT RUN [${suiteScope.areasNotRun.join(", ")}] · NOT the full gate (${suiteScope.gate.command})`,
			);
		}
		tests = suiteScope.ran.map((t) => t.replace(/^demo\//, ""));
	}

	/* ── concurrency knob ── */
	const concurrency = Math.max(1, parseInt(process.env.DURIG_SUITE_CONCURRENCY, 10) || 4);

	/* ── serialize worktree-touching tests ── */
	// These tests create or manipulate git worktrees on the scratch repo.
	// Under parallelism they collide on .git/worktrees/ and lock files.
	// We serialize them by running them one at a time in a dedicated queue.
	const worktreeTests = new Set([
		"broker-strand.test.mjs",
		"broker.test.mjs",
		"commit-model.test.mjs",
		"ctxline.test.mjs",
		"curate.test.mjs",
		"deepinfra-catalog.test.mjs",
		"defer.test.mjs",
		"degeneration-duration.test.mjs",
		"degeneration-text.test.mjs",
		"degeneration.test.mjs",
		"driversurvive-pre.test.mjs",
		"driversurvive.test.mjs",
		"eval.test.mjs",
		"evidence-handoff.test.mjs",
		"genlock-hardening.test.mjs",
		"halt.test.mjs",
		"held-item.test.mjs",
		"inflight.test.mjs",
		"local-provider.test.mjs",
		"local-reset.test.mjs",
		"malformedcall.test.mjs",
		"metrics.test.mjs",
		"notices.test.mjs",
		"optimizer.test.mjs",
		"ownership.test.mjs",
		"pitui.test.mjs",
		"primer.test.mjs",
		"race.test.mjs",
		"ratchet.test.mjs",
		"repeat-call.test.mjs",
		"run.test.mjs",
		"runbook-frontmatter.test.mjs",
		"runbook-rules.test.mjs",
		"sanitize.test.mjs",
		"scheduler.test.mjs",
		"seat-commit-instructions.test.mjs",
		"secretdetect.test.mjs",
		"secrets.test.mjs",
		"skill-admission-gate.test.mjs",
		"skill-mirror-check.test.mjs",
		"storewrite.test.mjs",
		"streamview.test.mjs",
		"suite-env.test.mjs",
		"supervisor.test.mjs",
		"textwidth.test.mjs",
		"tui-backfill.test.mjs",
		"tui-client.test.mjs",
		"tui-conversation.test.mjs",
		"tui-golden.test.mjs",
		"tui-input-overlay.test.mjs",
		"tui-input.test.mjs",
		"tui-multipane.test.mjs",
		"tui-restore.test.mjs",
		"tui-roles.test.mjs",
		"tui-sync-output.test.mjs",
		"tui-thinking.test.mjs",
		"tui-toolblock.test.mjs",
		"viewmodel.test.mjs",
	]);

	const isolatedTests = tests.filter((t) => !worktreeTests.has(t));
	const serializedTests = tests.filter((t) => worktreeTests.has(t));

	/* ── helper: run a single test, return { test, exit } ── */
	function runTest(test) {
		return new Promise((resolve) => {
			const child = spawn(process.execPath, [join("demo", test)], { cwd: scratch, encoding: "utf8" });
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (d) => { stdout += d; });
			child.stderr.on("data", (d) => { stderr += d; });
			child.on("close", (code) => {
				collectSkips(test, stdout);
				resolve({ test, exit: code ?? 1, stdout, stderr });
			});
		});
	}

	function recordFailure(result) {
		// #5793: ERR_MODULE_NOT_FOUND in a scratch with no node_modules is the INSTRUMENT, not the branch. Say
		// which it is: the runner stops at the FIRST red, and a bare scratch otherwise reads as "this branch is
		// broken" — which is how a 262/262-green main got refused for a branch that had done nothing wrong.
		const dependencyRed = !scratchDeps.linked && /ERR_MODULE_NOT_FOUND/.test(result.stderr ?? "");
		if (!keepScratch) removeScratch();
		report(
			{
				...base,
				error: dependencyRed
					? `STOPPED: demo/${result.test} failed in the scratch worktree (exit ${result.exit}) with ERR_MODULE_NOT_FOUND, and the scratch had NO node_modules (${scratchDeps.reason}) — that is the INSTRUMENT, not the branch (#5793). Install the checkout's dependencies (npm ci, then node scripts/sync-pi.mjs --sync) and re-run. main was NOT advanced.`
					: `STOPPED: demo/${result.test} failed in the scratch worktree (exit ${result.exit}) — main was NOT advanced.`,
				merged,
				suite: suiteResults,
				gate: gateReport(),
				suiteSkips,
				scratchDeps,
				scratch: keepScratch ? scratch : null,
			},
			1,
		);
	}

	/* ── run isolated tests in a bounded pool ── */
	if (isolatedTests.length > 0) {
		if (concurrency === 1) {
			// Sequential escape hatch: drain the queue one at a time
			for (const test of isolatedTests) {
				const result = await runTest(test);
				suiteResults.push(result);
				if (result.exit !== 0) {
					recordFailure(result);
					return;
				}
			}
		} else {
			// Bounded pool: distribute tests across workers
			const workerCount = Math.min(concurrency, isolatedTests.length);
			const queues = Array.from({ length: workerCount }, () => []);
			isolatedTests.forEach((t, i) => queues[i % workerCount].push(t));

			const workers = queues.map(async (q) => {
				for (const test of q) {
					const result = await runTest(test);
					suiteResults.push(result);
					if (result.exit !== 0) {
						recordFailure(result);
						throw result; // signal failure to other workers
					}
				}
			});

			try {
				await Promise.all(workers);
			} catch {
				// One worker failed; the others may still be running.
				// We've already reported and removed the scratch, so we just return.
				return;
			}
		}
	}

	/* ── run serialized tests one at a time ── */
	for (const test of serializedTests) {
		const run = spawnSync(process.execPath, [join("demo", test)], { cwd: scratch, encoding: "utf8" });
		collectSkips(test, run.stdout);
		suiteResults.push({ test, exit: run.status ?? 1 });
		if ((run.status ?? 1) !== 0) {
			if (!keepScratch) removeScratch();
			report(
				{
					...base,
					error: !scratchDeps.linked && /ERR_MODULE_NOT_FOUND/.test(run.stderr ?? "")
						? `STOPPED: demo/${test} failed in the scratch worktree (exit ${run.status}) with ERR_MODULE_NOT_FOUND, and the scratch had NO node_modules (${scratchDeps.reason}) — that is the INSTRUMENT, not the branch (#5793). Install the checkout's dependencies (npm ci, then node scripts/sync-pi.mjs --sync) and re-run. main was NOT advanced.`
						: `STOPPED: demo/${test} failed in the scratch worktree (exit ${run.status}) — main was NOT advanced.`,
					merged,
					suite: suiteResults,
					gate: gateReport(),
					suiteSkips,
					scratchDeps,
					scratch: keepScratch ? scratch : null,
				},
				1,
			);
		}
	}

	// #4996: say out loud what this tree could NOT judge, on the same channel the scope line uses (stdout is
	// reserved for the JSON report). Zero skips is stated too — silence and "nothing was skipped" are not the
	// same fact, and the last landing reads had no way to tell them apart.
	console.error(`suite: ${skipSummary()}`);
}
})();

/* ───────── advance main by a CLEAN FAST-FORWARD ───────── */

// Re-check: the tree must still be clean for the FF (someone may have written while we merged).
const recheck = git(repoRoot, ["status", "--porcelain"]);
const stillDirty = recheck.out
	.split("\n")
	.map((l) => l.trimEnd())
	.filter((l) => l.length > 0 && !l.startsWith("??"));
if (stillDirty.length > 0) {
	if (!keepScratch) removeScratch();
	report(
		{
			...base,
			error:
				`refusing to advance main: the shared tree became dirty while the scratch merge ran. ` +
				`The scratch result is clean but main was NOT advanced.`,
			merged,
			trackedChanges: stillDirty,
			scratch: keepScratch ? scratch : null,
		},
		1,
	);
}

const lockSlots = resolveSlotCount(repoRoot);
const me = { pid: process.pid, seat: "impl-land", since: new Date().toISOString() };
const lock = {
	slots: lockSlots,
	held: 0,
	waitedMs: 0,
	reserved: false,
	liveHolders: genlocks.length,
};
let heldPaths = [];
let scratchHead;
let ff;
try {
	const lockStart = Date.now();
	if (lockSlots !== null) {
		// PRIORITY FIRST: publish the reservation so new generations YIELD while we wait. A live
		// reservation held by another lander is reported rather than treated as an error — we
		// queue behind it and the slot wait below orders us.
		const res = reserveSlots(dbPath, me);
		lock.reserved = res.claimed;
		if (!res.claimed) {
			lock.queuedBehind = { pid: res.holder?.pid ?? null, seat: res.holder?.seat ?? null };
		}
		heldPaths = acquireAllSlotsSync(dbPath, lockSlots, me, {
			// #4432 LEGIBILITY: print the WAIT while it happens. A lock wait and a hung demo BOTH read
			// as "no output for minutes" from a seat's side (#3761), and a seat that reads a wait as a
			// hang RETRIES — which adds contention, and a retried landing is the two-delegates-one-tree
			// shape. stderr, so the JSON report on stdout stays machine-readable (the #4403 lesson).
			onWait: ({ slot, slots, waitedMs, holderPid }) => {
				console.error(
					`landing lock: waiting for slot ${slot + 1}/${slots} — ${lock.liveHolders} live holder(s), ` +
						`${Math.round(waitedMs / 1000)}s so far${holderPid ? `, slot held by pid ${holderPid}` : ""} ` +
						`(this is a WAIT, not a hang — do not retry)`,
				);
			},
		});
		lock.held = heldPaths.length;
	}
	lock.waitedMs = Date.now() - lockStart;
	// Test/diagnostic seam: hold the lock a moment so an external observer can see it held.
	const holdMs = Number(process.env.DURIG_LAND_HOLD_FF_MS ?? "");
	if (Number.isFinite(holdMs) && holdMs > 0) sleepSync(holdMs);
	scratchHead = git(scratch, ["rev-parse", "HEAD"]).out;
	ff = git(repoRoot, ["merge", "--ff-only", scratchHead]);
} catch (err) {
	releaseSlotsSync(heldPaths, me);
	releaseReservation(dbPath, me);
	if (!keepScratch) removeScratch();
	report({ ...base, error: `cannot hold the exclusive landing lock: ${err?.message ?? err}`, merged, lock }, 1);
} finally {
	releaseSlotsSync(heldPaths, me);
	releaseReservation(dbPath, me);
}
if (ff.code !== 0) {
	if (!keepScratch) removeScratch();
	report(
		{
			...base,
			error: `cannot fast-forward main to ${scratchHead}: ${ff.err}. Nothing was advanced.`,
			merged,
			lock,
			scratch: keepScratch ? scratch : null,
		},
		1,
	);
}

const mainAfter = git(repoRoot, ["rev-parse", "main"]).out;
removeScratch();

report(
	{
		ok: true,
		command: "land",
		repo: repoRoot,
		// The store the genlock probe RESOLVED (#1383) — reported so a caller can see the
		// resolution, not just infer it from a refusal.
		db: dbPath,
		main: { before: mainBefore.out, after: mainAfter },
		merged,
		lock,
		// #4436/#6090: the gate is no longer optional — a landing reaches this line only after one ran,
		// because a landing with no gate flag is refused before it touches git. What ran is named, so a
		// green here is never mistaken for the full sweep.
		suite: suiteResults,
		gate: gateReport(),
		// #4996: the checks this tree could not judge, kept OUT of the pass count and not treated as failures.
		// The reason names what the tree lacks, so a reader can tell "the branch is bad" from "the scratch is bare".
		suiteSkips,
		// #4936: a subset number with no statement of what it did NOT cover is not a measurement
		// (#3743's four-state probe, #4858's rule). `null` means the FULL gate ran — every area covered.
		suiteScope,
		// #5793: what the scratch's environment actually was. A suite result without this field cannot be
		// read as a measurement of the tree, because a bare scratch is a different tree.
		scratchDeps,
		dependencyProvenance: scratchProvenance,
	},
	0,
);

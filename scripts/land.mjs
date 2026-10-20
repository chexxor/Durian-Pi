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
//   node scripts/land.mjs <branch> [<branch>...] [--repo <dir>] [--db <path>] [--suite] [--keep] [--json]
//
//   --repo <dir>   the shared repository root (default: the repo containing cwd)
//   --db <path>    the rig store, for the genlock pre-flight (default: DURIG_DB, else the store the
//                  repo is ACTUALLY using — the live broker's `<db>.broker.json`, or the only store
//                  with a live genlock — and only then `./rig.sqlite`; #1383)
//   --suite        run every demo/*.test.mjs IN the scratch worktree and refuse to advance
//                  main if any fails (exit 0 = pass)
//   --keep         keep the scratch worktree on failure, so a conflict can be resolved there
//   --json         machine-readable report (always printed; this flag is accepted for symmetry)
//
// Exit 0 = main advanced (or already contained every branch); nonzero = refused or stopped,
// with the reason in the report. It NEVER forces, and it NEVER leaves the shared tree
// mid-merge.

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DEFAULTS_CONFIG_PATHS, DEFAULT_CONFIG_PATHS } from "../src/config.mjs";
// The PRIORITY reservation + the wait-with-priority claim (#1497/#1498, lead #2054 precondition
// (c)). Imported from a deliberately DEPENDENCY-FREE module (node:fs/node:path only) so this
// chokepoint still loads when the provider stack is broken — the #1164 Q3 rule this file's own
// header states, and the reason it must NOT import src/genlock.mjs (which pulls pi-ai).
import {
	acquireAllSlotsSync,
	isReservationPath,
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
const wantSuite = args.includes("--suite");
const keepScratch = args.includes("--keep");

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
 * exactly the mistake the 2026-10-17 incident taught (checkup.mjs). The liveness rule is
 * genlock's: signal 0; only ESRCH means gone (EPERM means alive but unsignalable). */
function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err?.code !== "ESRCH";
	}
}

/** Slot files `<db>.genlock.<i>` whose holder is ALIVE. A dead holder's slot is stale and
 * the broker reconciles it, so it does not block a landing. */
function heldGenlocks(dbPath) {
	const dir = dirname(resolve(dbPath));
	const prefix = `${basename(resolve(dbPath))}.genlock.`;
	if (!existsSync(dir)) return [];
	const held = [];
	for (const name of readdirSync(dir)) {
		if (!name.startsWith(prefix)) continue;
		const path = join(dir, name);
		// The PRIORITY reservation lives beside the numbered slots and shares their prefix. It is
		// not a generation slot: counting it as a live holder would report the lander against
		// itself (#1498).
		if (isReservationPath(path)) continue;
		let holder = null;
		try {
			holder = JSON.parse(readFileSync(path, "utf8"));
		} catch {
			holder = null; // unreadable/partial: not evidence of a live run
		}
		if (holder && typeof holder.pid === "number" && pidAlive(holder.pid)) {
			held.push({ path, pid: holder.pid, seat: holder.seat ?? null, since: holder.since ?? null });
		}
	}
	return held;
}

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

/* ───────── pre-flight: the enforcement chokepoint ───────── */

// Tracked modifications only. An UNTRACKED file cannot be clobbered by a fast-forward (git
// refuses if an incoming path collides), and the shared tree normally carries other seats'
// untracked notes — refusing on those would make the guard useless rather than safe.
const status = git(repoRoot, ["status", "--porcelain"]);
const trackedChanges = status.out
	.split("\n")
	.map((l) => l.trimEnd())
	.filter((l) => l.length > 0 && !l.startsWith("??"));
if (trackedChanges.length > 0) {
	report(
		{
			...base,
			error:
				`refusing to land: the shared tree at ${repoRoot} has ${trackedChanges.length} tracked ` +
				`modification(s). A landing advances main by a clean fast-forward, which requires a clean ` +
				`tree — commit or stash the work first, then re-run.`,
			trackedChanges,
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
await (async () => {
	if (wantSuite) {
	const demoDir = join(scratch, "demo");
	const tests = existsSync(demoDir)
		? readdirSync(demoDir)
				.filter((n) => n.endsWith(".test.mjs"))
				.sort()
		: [];

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
				resolve({ test, exit: code ?? 1, stdout, stderr });
			});
		});
	}

	function recordFailure(result) {
		if (!keepScratch) removeScratch();
		report(
			{
				...base,
				error: `STOPPED: demo/${result.test} failed in the scratch worktree (exit ${result.exit}) — main was NOT advanced.`,
				merged,
				suite: suiteResults,
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
		suiteResults.push({ test, exit: run.status ?? 1 });
		if ((run.status ?? 1) !== 0) {
			if (!keepScratch) removeScratch();
			report(
				{
					...base,
					error: `STOPPED: demo/${test} failed in the scratch worktree (exit ${run.status}) — main was NOT advanced.`,
					merged,
					suite: suiteResults,
					scratch: keepScratch ? scratch : null,
				},
				1,
			);
		}
	}
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
		heldPaths = acquireAllSlotsSync(dbPath, lockSlots, me);
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
		suite: wantSuite ? suiteResults : null,
	},
	0,
);

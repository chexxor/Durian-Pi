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
// land when the shared tree has TRACKED modifications or a genlock slot is held by a live
// holder. (seatguard's git-state block is defense-in-depth; the runbook and `check` are
// ADVISORY ONLY and are never the thing that stops a bad landing.)
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
//   --db <path>    the rig store, for the genlock pre-flight (default: DURIG_DB or ./rig.sqlite)
//   --suite        run every demo/*.test.mjs IN the scratch worktree and refuse to advance
//                  main if any fails (exit 0 = pass)
//   --keep         keep the scratch worktree on failure, so a conflict can be resolved there
//   --json         machine-readable report (always printed; this flag is accepted for symmetry)
//
// Exit 0 = main advanced (or already contained every branch); nonzero = refused or stopped,
// with the reason in the report. It NEVER forces, and it NEVER leaves the shared tree
// mid-merge.

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

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

/** The number of generation slots, or null when the rig is uncapped. */
function resolveSlotCount(repoRoot) {
	let raw = process.env.DURIG_MAX_CONCURRENT_SEATS;
	if (raw === undefined || raw === "") {
		try {
			raw = JSON.parse(readFileSync(join(repoRoot, "durig.config.json"), "utf8")).DURIG_MAX_CONCURRENT_SEATS;
		} catch {
			raw = undefined;
		}
	}
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// genlock's STALE_MS: longer than the provider stream timeout, so a legitimate long
// generation is never age-stolen while a dead or wedged holder is reclaimed promptly.
const LOCK_STALE_MS = 660_000;
const LOCK_POLL_MS = 100;
const LOCK_WAIT_MS = 660_000;

/** Parse a slot file; null when absent, torn or unreadable (never evidence of a live run). */
function readHolder(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

/** A slot may be stolen when its holder is dead, or has aged past the stale window. */
function slotIsStale(holder, now = Date.now()) {
	if (!(holder && typeof holder.pid === "number") || !pidAlive(holder.pid)) return true;
	const age = typeof holder.since === "string" ? now - Date.parse(holder.since) : Infinity;
	return age > LOCK_STALE_MS;
}

/** Synchronous sleep — land.mjs is a sync script (spawnSync), so the acquire loop blocks. */
function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Claim ALL `slots` generation slots beside `dbPath`, WAITING for a live holder to release
 * (lead: "if a generation is in flight, the lander WAITS for the lock"). Returns the claimed
 * paths; releases any partial claim and throws on timeout.
 */
function acquireAllSlots(dbPath, slots, me) {
	const claimed = [];
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (let i = 0; i < slots; i += 1) {
		const path = `${dbPath}.genlock.${i}`;
		for (;;) {
			try {
				const fd = openSync(path, "wx");
				try {
					writeFileSync(fd, JSON.stringify(me));
				} finally {
					closeSync(fd);
				}
				claimed.push(path);
				break;
			} catch (err) {
				if (err?.code !== "EEXIST") {
					releaseAllSlots(claimed, me);
					throw err;
				}
				if (slotIsStale(readHolder(path))) {
					try {
						unlinkSync(path); // steal from a dead or wedged holder
					} catch {
						// another process stole or released it first; retry the claim
					}
					continue;
				}
				if (Date.now() > deadline) {
					releaseAllSlots(claimed, me);
					throw new Error(
						`timed out after ${LOCK_WAIT_MS} ms waiting for genlock slot ${path} ` +
							`(held by pid ${readHolder(path)?.pid ?? "?"})`,
					);
				}
				sleepSync(LOCK_POLL_MS);
			}
		}
	}
	return claimed;
}

/** Release the slots WE hold; a slot another process now owns is left alone. */
function releaseAllSlots(paths, me) {
	for (const path of paths) {
		try {
			if (readHolder(path)?.pid === me.pid) unlinkSync(path);
		} catch {
			// already gone
		}
	}
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

const dbPath = resolve(option("--db") ?? process.env.DURIG_DB ?? join(repoRoot, "rig.sqlite"));

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

const genlocks = heldGenlocks(dbPath);
if (genlocks.length > 0) {
	report(
		{
			...base,
			error:
				`refusing to land: ${genlocks.length} genlock slot(s) are held by a live holder beside ${dbPath} — ` +
				`a generation is in flight and the landing must wait for it to finish.`,
			genlocks,
		},
		1,
	);
}

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
if (wantSuite) {
	const demoDir = join(scratch, "demo");
	const tests = existsSync(demoDir)
		? readdirSync(demoDir)
				.filter((n) => n.endsWith(".test.mjs"))
				.sort()
		: [];
	for (const test of tests) {
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
const lock = { slots: lockSlots, held: 0, waitedMs: 0 };
let heldPaths = [];
let scratchHead;
let ff;
try {
	const lockStart = Date.now();
	if (lockSlots !== null) {
		heldPaths = acquireAllSlots(dbPath, lockSlots, me);
		lock.held = heldPaths.length;
	}
	lock.waitedMs = Date.now() - lockStart;
	// Test/diagnostic seam: hold the lock a moment so an external observer can see it held.
	const holdMs = Number(process.env.DURIG_LAND_HOLD_FF_MS ?? "");
	if (Number.isFinite(holdMs) && holdMs > 0) sleepSync(holdMs);
	scratchHead = git(scratch, ["rev-parse", "HEAD"]).out;
	ff = git(repoRoot, ["merge", "--ff-only", scratchHead]);
} catch (err) {
	releaseAllSlots(heldPaths, me);
	if (!keepScratch) removeScratch();
	report({ ...base, error: `cannot hold the exclusive landing lock: ${err?.message ?? err}`, merged, lock }, 1);
} finally {
	releaseAllSlots(heldPaths, me);
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
		main: { before: mainBefore.out, after: mainAfter },
		merged,
		lock,
		suite: wantSuite ? suiteResults : null,
	},
	0,
);

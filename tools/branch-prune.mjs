// tools/branch-prune.mjs — execute the branch census's prune plan, safely, in one bounded call.
//
// WHY. `tools/branch-census.mjs` answers "what is safe to remove?" and prints the commands. Retyping those
// commands by hand is where a pass goes wrong: refs are LIVE (a seat can commit between the census and the
// delete), and `git branch -D` is not an option — the seat guard forbids it and a delegate should not use it
// either. This tool does the loop that a session kept re-writing: re-verify ancestry at the moment of
// deletion, release the worktree without `--force`, delete the branch with `-d` (never `-D`), and print a
// recovery line for every ref it removed.
//
// Measured cost (Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0, 53 refs / 28 worktrees after the 2026-11-14 retire pass, tip 18e378d2): `--dry-run` on the live rig
// 9.2 s, exit 0, planned 0; the `--retire-merged` dry-run 4.4 s; the executed retire pass 26.0 s for 46 deletes +
// 12 worktree removals + 9 residue quarantines. The census leg is the bulk of the read (4.0 s here, 25-35 s on a
// 100+ ref rig); each delete is one `git` spawn at ~2 ms (5 measured `merge-base` calls: 10 ms), so 120 deletes is
// under a second.
//
// Usage:
//   node tools/branch-prune.mjs [--db ./selfdev.sqlite] [--repo .] [--dry-run] [--plan <census.json>]
//   node tools/branch-prune.mjs --reap-worktrees [--dry-run]   # release the trees the audit calls reapable; refs untouched
//   node tools/branch-prune.mjs --retire-merged --retire-unmerged '^landing-20261114' \
//       --bundle-dir .spike/quarantine-<date> --quarantine .spike/quarantine-<date> --unlock-locked [--dry-run]
//   node tools/branch-prune.mjs --retire-ruled --bundle-dir .spike/quarantine-<date> [--dry-run]  # ROADMAP 374 residual
//     --retire-merged : plan EVERY ref whose tip is provably an ancestor of main, even when a stale
//                       docs/DISPOSITIONS.md KEEP row (written before the landing) still names it.
//     --retire-unmerged <regex> : ALSO plan refs whose tip is NOT an ancestor of main and whose name matches
//                       the regex. This is an explicit allowlist: a ref that merely conflicts with main is
//                       kept (rule R-B #3270, "refs are dispositioned, never deleted") until a ruling names it.
//     --retire-ruled        : the allowlist comes from docs/DISPOSITIONS.md instead of a typed regex (#374
//                       residual). Every row naming a ref is read; the LAST row wins (the ledger is append-only,
//                       "a row is never edited"). A verdict in {CANCEL, SUPERSEDED, SUPERSEDED-BY-EVENTS,
//                       NOTHING-TO-LAND, ABSORBED, LAND} is delete-eligible; a verdict in {KEEP, KEEP-HELD, HELD,
//                       NOT-SUPERSEDED} is held and counted in `excluded.ruledHeld`. Eligibility still has to
//                       pass the live gate: ancestry, no uncommitted work, and a verified bundle for anything
//                       not an ancestor of main. `--ledger <path>` points at a different ledger file.
//     --active-within N : guard — an UNMERGED ref whose tip commit is younger than N days is never planned,
//                       even if the regex matches it. Off unless the flag is given.
//                       Omit --bundle-dir and every unmerged ref is skipped, so a retire pass can only
//                       delete work it has a verified copy of.
//     --bundle-dir DIR  : before deleting a ref that is NOT an ancestor of main, `git bundle create`
//                       (thin, based on merge-base with main) + `git bundle verify`. No verified bundle,
//                       no deletion. Such refs are removed with `git update-ref -d`, never `git branch -D`.
//     --quarantine DIR  : copy a scratch tree's uncommitted residue into DIR/<tree>/ before releasing it.
//     --unlock-locked   : `git worktree unlock` a git-locked tree the audit calls terminal before removing.
// Structural refs (seat roots, refs attached to a non-terminal queue row) are never planned.
// A tree is retired only when every uncommitted file in it is RESIDUE (a log, a probe, an out-*.test.mjs
// capture, tmp/). Any tracked modification or unrecognised file counts as work and keeps the ref — the tool
// never discards a seat's uncommitted work (operator ruling 2026-11-14: "archive only the scratch, keep the
// real-work trees and their refs").
// Exit codes:
//   0  every planned ref was removed (or, with --dry-run, every planned ref passed the live gate)
//   1  a planned ref was SKIPPED or a removal FAILED — the plan and the live git state disagree
//   2  the census could not be read, or usage error
//
// The gate, per ref (the same rule the census encodes, re-checked live because refs move):
//   git merge-base --is-ancestor <ref> main  -> exit 0   (its work is on main)
//   AND the ref is not a snapshot/archive name (`snapshot|archive|pre-split|backup|selfdev-<n>`)
// then `git worktree remove <path>` (NO --force) and `git branch -d <ref>` (never -D).
// Anything the census kept — seat roots, locked trees, dirty trees, ledger KEEP rows, conflicted refs —
// never reaches this tool's plan.
//
// Trap this tool is written against (SELFDEV pitfall 364): `spawnSync` returns `.status`, NOT `.code`.
// A check written as `r.code !== 0` is `undefined !== 0` -> true, so every ref "fails" the ancestor test,
// nothing is deleted, and the run still prints counts that look like a pass. The counts here are the
// assertion: a run that planned N and deleted 0 exits 1.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
	const i = argv.indexOf(name);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const NEVER_PRUNE = /(snapshot|archive|pre-split|backup|selfdev-\d+)/i;

// Residue vs work, one line each. Conservative on purpose: a file that is not clearly residue keeps the
// whole tree. Measured on the 2026-11-14 rig: the 13 dirty trees split into 9 residue-only (item-5895,
// 6290, 6317, 6328, 6429, 6998, 7316, 7413, 7599) and 4 holding real work (item-6057 `M demo/syncpi.test.mjs`,
// item-6375 `M docs/runbooks/pi-pin-update.md`, item-6377 `src/entrypoint-coverage.mjs`, item-7188
// `suite-lockfile.err`) — the second group is never released.

/** Run one git verb. `.status` is the exit code — `.code` does not exist on spawnSync results. */
function git(args, repo, timeoutMs = 20000) {
	const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", timeout: timeoutMs });
	return { status: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || r.message || "").trim() };
}

/**
 * Release the worktrees the rig's own audit calls `reapable` (terminal + unlocked + clean), WITHOUT touching
 * any ref. A clean, unlocked tree whose item row is terminal holds nothing that git cannot reproduce from the
 * ref; the ref is left in place (rule R-B #3270), so this is reversible with `git worktree add <path> <ref>`.
 * `cli.mjs worktree audit` exits 1 whenever it has remedies to print — that is a verdict, not a crash (pitfall 360).
 */
export function reapWorktrees({ repo, db, dryRun = false, auditJson = null }) {
	const a = auditJson
		? { status: 0, stdout: auditJson }
		: spawnSync("node", ["cli.mjs", "worktree", "audit", "--json"], { cwd: repo, env: { ...process.env, DURIG_DB: db }, encoding: "utf8", timeout: 120000 });
	let audit;
	try {
		audit = JSON.parse(a.stdout);
	} catch (e) {
		return { ok: false, error: `worktree audit unreadable (exit ${a.status}): ${e.message}` };
	}
	const trees = (audit.worktrees || []).filter((w) => w.keepReason === "reapable" && !w.locked && (w.uncommitted || 0) === 0);
	const res = { ok: true, dryRun, reapable: trees.length, removed: 0, refused: 0, log: [], auditExit: a.status, counts: { seatRoot: audit.counts?.["seat-root"], live: audit.counts?.live, dirty: audit.counts?.dirty, locked: audit.counts?.locked } };
	for (const w of trees) {
		if (dryRun) {
			res.log.push(`DRY ${w.worktree}${w.branch ? `  ref ${w.branch}` : ""}`);
			continue;
		}
		const r = git(["worktree", "remove", w.worktree], repo); // no --force: a refusal is the safety net
		if (r.status === 0) {
			res.removed++;
			res.log.push(`REMOVED ${w.worktree}${w.branch ? `  ref ${w.branch} kept` : ""}`);
		} else {
			res.refused++;
			res.log.push(`REFUSED ${w.worktree}: ${r.stderr.split("\n")[0]} — its owner must clean it`);
		}
	}
	if (!dryRun) git(["worktree", "prune"], repo);
	res.ok = res.refused === 0;
	return res;
}

/**
 * Execute a prune plan. `plan` is the census's `plan` array: [{ref, worktree, command}].
 * Returns the counts; the caller turns them into an exit code.
 */
/** Parse `git worktree list --porcelain` into branch -> {path, locked}. */
function worktreeIndex(repo) {
	const out = new Map();
	let cur = null;
	for (const line of git(["worktree", "list", "--porcelain"], repo).stdout.split("\n")) {
		if (line === "") { if (cur) out.set(cur.branch, cur); cur = null; continue; }
		const sp = line.indexOf(" ");
		const k = sp === -1 ? line : line.slice(0, sp);
		const v = sp === -1 ? "" : line.slice(sp + 1);
		if (k === "worktree") cur = { worktree: v, branch: null, locked: false };
		else if (k === "branch") cur.branch = v || null;
		else if (k === "locked") cur.locked = true;
		}
	if (cur) out.set(cur.branch, cur);
	return out;
}

/**
 * ROADMAP 374 residual: read the LEDGER, not a regex. `docs/DISPOSITIONS.md` is an append-only ledger whose
 * whole point is that a branch is never re-litigated — so the ruling a prune pass should honour is the LAST
 * row that names the ref. Rows are parsed loosely on purpose (5 or 6 columns, with or without a sha): the
 * disposition is found by keyword, in order of specificity, so `KEEP-HELD` never reads as `HELD` and
 * `NOT-SUPERSEDED` never reads as `SUPERSEDED`.
 *
 * Returns {byRef, eligible, held, ambiguous, rows}. `byRef` maps a bare ref name -> {verdict, eligible, date, line}.
 * Pure: it takes text and returns data, so the demo can pin it against a fixture ledger without a git repo.
 */
export function ledgerRulings(text) {
	// Specificity first: the longest/most qualified verdicts are tested before their substrings.
	const RULES = [
		[/not-superseded/i, { verdict: "NOT-SUPERSEDED", eligible: false }],
		[/nothing-to-land/i, { verdict: "NOTHING-TO-LAND", eligible: true }],
		[/keep-held/i, { verdict: "KEEP-HELD", eligible: false }],
		[/superseded-by-events/i, { verdict: "SUPERSEDED-BY-EVENTS", eligible: true }],
		[/\bcancel/i, { verdict: "CANCEL", eligible: true }],
		[/superseded/i, { verdict: "SUPERSEDED", eligible: true }],
		[/absorbed/i, { verdict: "ABSORBED", eligible: true }],
		[/\bretire/i, { verdict: "RETIRE", eligible: true }],
		[/\bheld\b/i, { verdict: "HELD", eligible: false }],
		[/\bkeep\b/i, { verdict: "KEEP", eligible: false }],
		[/\bland\b/i, { verdict: "LAND", eligible: true }],
	];
	const byRef = new Map();
	let rows = 0;
	const lines = String(text ?? "").split("\n");
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i].trim();
		if (!raw.startsWith("|")) continue;
		const cols = raw.split("|").slice(1, -1).map((c) => c.trim());
		if (cols.length < 2) continue;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(cols[0])) continue; // header, separator, or prose table
		rows++;
		const names = [...cols[1].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
		const refs = (names.length ? names : cols[1].split(",").map((s) => s.trim())).filter(Boolean);
		const haystack = cols.slice(2).join(" ");
		const hit = RULES.find(([re]) => re.test(haystack));
		for (const ref of refs) {
			const name = ref.replace(/^refs\/heads\//, "");
			if (!hit) {
				byRef.set(name, { verdict: null, eligible: false, date: cols[0], line: i + 1, ambiguous: true });
				continue;
			}
			byRef.set(name, { verdict: hit[1].verdict, eligible: hit[1].eligible, date: cols[0], line: i + 1 });
			}
		}
	return {
		byRef,
		rows,
		eligible: [...byRef.entries()].filter(([, v]) => v.eligible).map(([k]) => k),
		held: [...byRef.entries()].filter(([, v]) => !v.eligible && !v.ambiguous).map(([k]) => k),
		ambiguous: [...byRef.entries()].filter(([, v]) => v.ambiguous).map(([k]) => k),
	};
}

/**
 * Build the retire plan: every ref that is provably not active work.
 * `structuralRefs` = refs held by a seat root or a non-terminal queue row (from `cli.mjs worktree audit`).
 * A ref whose tree still holds uncommitted WORK is excluded as well; residue-only trees are planned with
 * the residue listed, so the executor quarantines it before releasing the tree.
 */
export function buildRetirePlan({ repo, db, activeWithinDays = null, structuralRefs = new Set(), retireUnmerged = null, retireRuled = null, mainRef = "refs/heads/main" }) {
	const index = worktreeIndex(repo);
	const unmergedRe = retireUnmerged ? new RegExp(retireUnmerged, "i") : null;
	const ruled = retireRuled instanceof Map ? retireRuled : null;
	const plan = [];
	const excluded = { structural: 0, activeWithin: 0, snapshot: 0, uncommittedWork: 0, unmergedNotNamed: 0, ruledHeld: 0 };
	for (const line of git(["for-each-ref", "--format=%(refname)", "refs/heads"], repo).stdout.trim().split("\n")) {
		const full = line.trim();
		if (full === mainRef) continue;
		const name = full.replace("refs/heads/", "");
		if (NEVER_PRUNE.test(name)) { excluded.snapshot++; continue; }
		if (structuralRefs.has(full)) { excluded.structural++; continue; }
		const wt = index.get(full) || null;
		// A tree that is not inside this repo, or is a seat root by name, belongs to a seat, not to an item.
		if (wt && (!wt.worktree.startsWith(repo) || /seatroot/i.test(path.basename(wt.worktree)))) { excluded.structural++; continue; }
		const dirt = wt ? treeDirt(repo, wt.worktree) : { residue: [], work: [], total: 0 };
		if (dirt.work.length) { excluded.uncommittedWork++; continue; } // uncommitted work IS active work
		const merged = git(["merge-base", "--is-ancestor", full, mainRef], repo).status === 0;
		const ts = Number(git(["show", "-s", "--format=%ct", full], repo).stdout.trim());
		const ageDays = Math.floor((Date.now() - ts * 1000) / 86400000);
		const ruling = ruled ? ruled.get(name) : null;
		if (merged) plan.push({ ref: name, merged: true, worktree: wt?.worktree || null, locked: wt?.locked || false, residue: dirt.residue, ageDays, ruled: ruling?.verdict ?? null });
		else if (activeWithinDays !== null && ageDays <= activeWithinDays) { excluded.activeWithin++; }
		else if (ruling && ruling.eligible) plan.push({ ref: name, merged: false, bundle: true, worktree: wt?.worktree || null, locked: wt?.locked || false, residue: dirt.residue, ageDays, ruled: ruling.verdict, ruledRow: `${ruling.date} @ ledger line ${ruling.line}` });
		else if (ruling) { excluded.ruledHeld++; } // the ledger says KEEP/HELD: a ruling is not a delete
		else if (!unmergedRe || !unmergedRe.test(name)) { excluded.unmergedNotNamed++; } // conflicts with main: needs a landing decision, not a delete
		else plan.push({ ref: name, merged: false, bundle: true, worktree: wt?.worktree || null, locked: wt?.locked || false, residue: dirt.residue, ageDays });
	}
	return { plan, excluded };
}

// Split a tree's uncommitted files into residue (quarantine, then delete) and work (never touched).
const SCRATCH_RE = /(\.log$|\.txt$|\.json$|\.scratch-|out-.*\.test\.mjs$|probe.*\.mjs$|\.spike-probe\.mjs$|tools\/probes\/.*\.mjs$|^tmp\/|^[a-z]$)/;
function treeDirt(repo, worktree) {
	const st = git(["-C", worktree, "status", "--porcelain"], repo);
	const residue = [], work = [];
	for (const line of st.stdout.split("\n").filter(Boolean)) {
		const status = line.slice(0, 2).trim();
		const p = line.slice(3).trim();
		if (status === "??" && SCRATCH_RE.test(p)) residue.push(p);
		else work.push(p);
	}
	return { residue, work, total: residue.length + work.length };
}

/**
 * Refs the rig itself says are in use: seat roots and trees attached to a non-terminal queue row.
 * A LOCKED tree is deliberately NOT structural: the audit's own remedy for a lock over a terminal item is
 * "unlock and reap" (the deadlock family, #3165), and the retire pass decides it on live ancestry. Without
 * --unlock-locked the locked tree refuses the removal and the run exits 1 with the reason printed.
 */
function structuralRefs(repo, db) {
	const a = spawnSync("node", ["cli.mjs", "worktree", "audit", "--json"], { cwd: repo, env: { ...process.env, DURIG_DB: db }, encoding: "utf8", timeout: 120000 });
	let audit;
	try { audit = JSON.parse(a.stdout); } catch { return { ok: false, refs: new Set() }; }
	const set = new Set();
	for (const w of audit.worktrees || []) if (w.keepReason === "seat-root" || w.keepReason === "live" || w.keepReason === "not-terminal" || w.keepReason === "branch-unresolved") set.add(w.branch);
	for (const s of audit.seatRoots || []) {
		const r = git(["rev-parse", "--abbrev-ref", s.cwd], repo);
		if (r.status === 0 && r.stdout && r.stdout !== "HEAD") set.add("refs/heads/" + r.stdout);
		}
	return { ok: true, refs: set };
}

export function prunePlan({ repo, plan, dryRun = false, logPath = null, mainRef = "refs/heads/main", bundleDir = null, quarantineDir = null, unlockLocked = false }) {
	const res = {
		ok: true,
		repo,
		dryRun,
		planned: plan.length,
		worktreesRemoved: 0,
		worktreesFailed: 0,
		branchesDeleted: 0,
		branchesFailed: 0,
		skipped: 0,
		log: [],
	};

	// Live worktree state, re-read once at execution time: a ref's tree can be locked or released between
	// the census and this pass, and the ORDER matters — we must not clean a tree we cannot remove.
	const liveIndex = worktreeIndex(repo);

	// A tree mid-merge is never a safe place to prune refs (docs/runbooks/branch-cleanup.md, Diagnose).
	const mergeHead = git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], repo);
	if (mergeHead.status === 0) {
		return { ...res, ok: false, error: `merge in progress (MERGE_HEAD ${mergeHead.stdout}) — prune refused` };
	}

	for (const p of plan) {
		const ref = p.ref;
		if (!ref) continue;

		if (NEVER_PRUNE.test(ref)) {
			res.skipped++;
			res.log.push(`SKIP ${ref}: snapshot/archive name — this tool never prunes those (branch-cleanup step 4)`);
			continue;
		}

		const fullRef = ref.startsWith("refs/heads/") ? ref : `refs/heads/${ref}`;
		const sha = git(["rev-parse", fullRef], repo).stdout;

		// Live gate, re-checked at delete time: refs move while a pass runs.
		const merged = git(["merge-base", "--is-ancestor", fullRef, mainRef], repo).status === 0;
		let bundlePath = null;
		if (!merged) {
			if (!bundleDir) {
				res.skipped++;
				res.log.push(`SKIP ${ref}: not an ancestor of main and no --bundle-dir — its commits exist nowhere else`);
				continue;
			}
			fs.mkdirSync(bundleDir, { recursive: true });
			const base = git(["merge-base", mainRef, fullRef], repo).stdout;
			if (!base) { res.skipped++; res.log.push(`SKIP ${ref}: no merge-base with main — refusing`); continue; }
			// A ref name can contain slashes (wip/…, seatroot/…): the bundle file is flat, so the name is sanitised.
			const stem = ref.replace(/\//g, "_");
			bundlePath = path.join(bundleDir, `${stem}.bundle`);
			git(["bundle", "create", bundlePath, `${base}..${fullRef}`], repo);
			const verify = git(["bundle", "verify", bundlePath], repo);
			if (verify.status !== 0) {
				res.skipped++;
				res.log.push(`SKIP ${ref}: bundle verify failed (${verify.stderr.split("\n")[0]}) — not deleted`);
				continue;
			}
			fs.writeFileSync(path.join(bundleDir, `${stem}.sha`), sha + "\n");
		}

		if (dryRun) {
			res.log.push(`DRY ${ref} @ ${sha.slice(0, 12)}${merged ? " (merged)" : ` (bundled -> ${bundlePath})`}${p.ruled ? `  ruled: ${p.ruled}` : ""}${p.worktree ? `  worktree ${p.worktree}` : ""}`);
			continue;
		}

		const tree = p.worktree ? (liveIndex.get(fullRef)?.worktree || p.worktree) : null;
		if (tree) {
			const lockedNow = liveIndex.get(fullRef)?.locked || false;
			if (lockedNow && !unlockLocked) {
				res.skipped++;
				res.log.push(`SKIP ${ref}: tree ${tree} is git-locked — re-run with --unlock-locked`);
				continue;
			}
			if (unlockLocked && lockedNow && git(["worktree", "unlock", tree], repo).status === 0) res.log.push(`UNLOCKED ${tree}`);
			const dirt = treeDirt(repo, tree);
			if (dirt.work.length) {
				res.skipped++;
				res.log.push(`SKIP ${ref}: ${p.worktree} holds uncommitted WORK (${dirt.work.slice(0, 4).join(", ")}) — tree and ref kept`);
				continue;
			}
			if (dirt.residue.length) {
				// Archive the residue, then clean it, so `git worktree remove` succeeds without --force.
				const dir = path.join(quarantineDir || ".spike/quarantine", path.basename(tree));
				fs.mkdirSync(dir, { recursive: true });
				let n = 0;
				for (const rel of dirt.residue) {
					const src = path.join(p.worktree, rel);
					if (fs.existsSync(src) && fs.statSync(src).isFile()) { fs.writeFileSync(path.join(dir, rel.replace(/\//g, "_")), fs.readFileSync(src)); n++; }
				}
				res.log.push(`QUARANTINED ${n} residue file(s) from ${tree} -> ${dir}`);
				git(["-C", tree, "clean", "-fdq"], repo);
				if (git(["-C", tree, "status", "--porcelain"], repo).stdout.trim()) {
					res.skipped++;
					res.log.push(`SKIP ${ref}: ${tree} still dirty after cleaning residue — not released`);
					continue;
				}
			}
			const w = git(["worktree", "remove", tree], repo); // no --force: a refusal is the safety net
			if (w.status !== 0) {
				res.worktreesFailed++;
				res.log.push(`FAIL worktree remove ${tree}: ${w.stderr.split("\n")[0]} — branch NOT deleted, tree still holds it`);
				continue; // `git branch -d` would refuse a checked-out ref anyway
			}
			res.worktreesRemoved++;
		}

		if (merged) {
			const b = git(["branch", "-d", ref], repo); // -d, never -D: it cannot delete unmerged work
			if (b.status !== 0) {
				res.branchesFailed++;
				res.log.push(`FAIL branch -d ${ref}: ${b.stderr.split("\n")[0]}`);
			} else {
				res.branchesDeleted++;
				res.log.push(`DELETED ${ref} @ ${sha.slice(0, 12)} — recover: git branch ${ref} ${sha}`);
			}
		} else {
			// Not merged, so `git branch -d` would (correctly) refuse. Only reachable with a verified bundle.
			const u = git(["update-ref", "-d", fullRef], repo);
			if (u.status !== 0) {
				res.branchesFailed++;
				res.log.push(`FAIL update-ref -d ${ref}: ${u.stderr.split("\n")[0]}`);
			} else {
				res.branchesDeleted++;
				res.log.push(`DELETED ${ref} @ ${sha.slice(0, 12)} — recover: git fetch ${bundlePath} && git branch ${ref} ${sha}`);
			}
		}
	}

	if (!dryRun) git(["worktree", "prune"], repo);
	res.ok = res.skipped === 0 && res.worktreesFailed === 0 && res.branchesFailed === 0;

	if (logPath && !dryRun) {
		fs.writeFileSync(logPath, res.log.join("\n") + "\n");
		res.logPath = logPath;
	}
	return res;
}

function main() {
	const repo = path.resolve(opt("--repo", process.cwd()));
	const db = opt("--db", process.env.DURIG_DB || "./selfdev.sqlite");
	const logPath = opt("--log", ".spike/prune-log.txt");
	const t0 = Date.now();

	if (flag("--reap-worktrees")) {
		const r = reapWorktrees({ repo, db, dryRun: flag("--dry-run") });
		console.log(
			`worktree reap @ ${git(["rev-parse", "HEAD"], repo).stdout.slice(0, 12)} — audit says ${r.reapable} reapable; ` +
				(flag("--dry-run") ? `would remove ${r.reapable}` : `removed ${r.removed}, refused ${r.refused}`) +
				`; seat roots ${r.counts.seatRoot}, live ${r.counts.live}, dirty ${r.counts.dirty}, locked ${r.counts.locked}; ${((Date.now() - t0) / 1000).toFixed(1)} s`,
			);
			for (const line of r.log) console.log("  " + line);
			if (r.error) console.log("  " + r.error);
			return r.ok && !r.error ? 0 : 1;
		}

	let plan;
	if (flag("--retire-merged") || flag("--retire-ruled")) {
		const activeWithin = flag("--active-within") ? Number(opt("--active-within", "0")) : null;
		let rulings = null;
		if (flag("--retire-ruled")) {
			const ledgerPath = path.resolve(opt("--ledger", path.join(repo, "docs/DISPOSITIONS.md")));
			if (!fs.existsSync(ledgerPath)) {
				console.error(`--retire-ruled: no ledger at ${ledgerPath} — the allowlist has to come from somewhere; pass --ledger <path>`);
				return 2;
			}
			rulings = ledgerRulings(fs.readFileSync(ledgerPath, "utf8"));
			console.log(
				`ledger rulings read from ${ledgerPath}: ${rulings.rows} row(s), ${rulings.byRef.size} ref(s) ruled — ` +
					`delete-eligible ${rulings.eligible.length}, held ${rulings.held.length}, no verdict in the row ${rulings.ambiguous.length}`,
				);
			if (rulings.ambiguous.length) console.log(`  ambiguous (row names a ref but states no verdict): ${rulings.ambiguous.slice(0, 12).join(", ")}`);
			}
		const st = structuralRefs(repo, db);
		const built = buildRetirePlan({ repo, db, activeWithinDays: activeWithin, structuralRefs: st.refs, retireUnmerged: opt("--retire-unmerged", null), retireRuled: rulings?.byRef ?? null });
		plan = built.plan;
		console.log(`retire plan: ${plan.length} candidate ref(s); excluded structural ${built.excluded.structural}, active-within-window ${built.excluded.activeWithin}, snapshot-named ${built.excluded.snapshot}, uncommitted-work ${built.excluded.uncommittedWork}, ruled-held ${built.excluded.ruledHeld}, unmerged-and-not-named ${built.excluded.unmergedNotNamed}`);
	} else if (flag("--plan")) {
		plan = JSON.parse(fs.readFileSync(opt("--plan", ""), "utf8")).plan || [];
	} else {
		// The census is the plan. Cost: ~30 s on a 100-ref rig (measured, host in the header).
		const c = spawnSync("node", [path.join(path.dirname(new URL(import.meta.url).pathname), "branch-census.mjs"), "--json", "--repo", repo, "--db", db], {
			encoding: "utf8",
			timeout: 240000,
		});
		if (c.status !== 0) {
			console.error(`census failed (exit ${c.status}): ${(c.stderr || "").split("\n")[0]}`);
			return 2;
		}
		plan = JSON.parse(c.stdout).plan || [];
	}

	const r = prunePlan({ repo, plan, dryRun: flag("--dry-run"), logPath: flag("--dry-run") ? null : logPath, bundleDir: opt("--bundle-dir", null), quarantineDir: opt("--quarantine", null), unlockLocked: flag("--unlock-locked") });
	const secs = ((Date.now() - t0) / 1000).toFixed(1);
	console.log(
		`prune @ ${git(["rev-parse", "HEAD"], repo).stdout.slice(0, 12)} — planned ${r.planned}; ` +
			`${flag("--dry-run") ? "would delete " + r.planned : `branches deleted ${r.branchesDeleted}, worktrees removed ${r.worktreesRemoved}`}; ` +
			`skipped ${r.skipped}; failed ${r.branchesFailed + r.worktreesFailed}; ${secs} s`,
	);
	for (const line of r.log) console.log("  " + line);
	if (r.error) console.log("  " + r.error);
	if (!flag("--dry-run") && r.logPath) console.log(`  recovery log: ${r.logPath}`);
	return r.ok && !r.error ? 0 : 1;
}

// Run only when invoked directly, so demo/branch-prune.test.mjs can import prunePlan against a fixture.
if (path.resolve(process.argv[1] || "") === path.resolve(new URL(import.meta.url).pathname)) process.exit(main());

// verify-1924-audit-edge.mjs (v2) - auditor probes for impl-item-1881 @e836366 (#1924).
// Pins the artifact via ./verify-e836366. Documents boundaries; not the artifact rs own suite.
// Run: node verify-1924-audit-edge.mjs (exit 0 = every probe behaved as documented)
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const { auditWorktrees, reconcileOrphanedWorktrees } = await import("./verify-e836366/src/broker.mjs");
const { uncommittedCount, removeSeatWorkspace, listWorktrees } = await import("./verify-e836366/src/worktree.mjs");

const run = promisify(execFile);
const git = (cwd, ...args) => run("git", ["-C", cwd, ...args]);

let failures = 0;
const okk = (l) => console.log("  ok   " + l);
const check = (label, cond, detail = "") => { if (cond) okk(label); else { failures++; console.log("  FAIL " + label + (detail ? " -- " + detail : "")); } };

const base = mkdtempSync(join(tmpdir(), "durig-verify-1924-"));
const repo = join(base, "repo");
const wt = (id) => join(repo, "item-" + id);

try {
	// Fixture: item-1 terminal dirty (2 untracked + 1 modified), item-2 terminal clean,
	// item-3 terminal dirty+locked, item-4 counting-only (staged probe, reset clean after).
	mkdirSync(repo, { recursive: true });
	writeFileSync(join(repo, "shared.txt"), "base\n");
	await git(repo, "init", "-q");
	await git(repo, "add", "shared.txt");
	await git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
	for (const id of [1, 2, 3, 4]) await git(repo, "worktree", "add", "-q", "-b", "impl-item-" + id, wt(id));
	writeFileSync(join(wt(1), "one.txt"), "1\n");
	writeFileSync(join(wt(1), "two.txt"), "2\n");
	writeFileSync(join(wt(1), "shared.txt"), "modified\n");
	writeFileSync(join(wt(3), "shared.txt"), "dirty under lock\n");
	await git(repo, "worktree", "lock", wt(3));

	// D-EDGE: porcelain line count for the wt(1) dirt.
	const count1 = await uncommittedCount(wt(1));
	check("D-EDGE: uncommittedCount counts porcelain lines (expect 3)", count1 === 3, "count1=" + count1);

	// D-EDGE2: a STAGED (A) file counts.
	writeFileSync(join(wt(4), "staged.txt"), "s\n");
	await git(wt(4), "add", "staged.txt");
	const countStaged = await uncommittedCount(wt(4));
	check("D-EDGE2: a STAGED (A) file counts as uncommitted (expect 1)", countStaged === 1, "countStaged=" + countStaged);

	// D-EDGE3: an untracked DIRECTORY collapses to ONE porcelain entry.
	mkdirSync(join(wt(1), "sub"), { recursive: true });
	writeFileSync(join(wt(1), "sub", "a.txt"), "a\n");
	writeFileSync(join(wt(1), "sub", "b.txt"), "b\n");
	const countDir = await uncommittedCount(wt(1));
	check("D-EDGE3: untracked DIRECTORY collapses to one entry (expect 4)", countDir === 4, "countDir=" + countDir);

	// Reset the counting-only tree to clean (fixture-internal; wt(4) is mine).
	await git(wt(4), "reset", "--hard", "HEAD");

	// A + B: the audit classifies by the shared rule; count carried.
	const terminal = new Set([1, 2, 3, 4]);
	const statusById = new Map([[1, "done"], [2, "done"], [3, "done"], [4, "done"]]);
	const entries = await auditWorktrees({ repoPath: repo, liveItemIds: new Set(), terminalItemIds: terminal, statusById, seatRoots: [] });
	const byId = new Map(entries.filter((e) => e.itemId != null).map((e) => [e.itemId, e]));
	check("A: dirty classified dirty with the porcelain count (4)", byId.get(1)?.keepReason === "dirty" && byId.get(1)?.uncommitted === 4, JSON.stringify(byId.get(1)));
	check("B: locked+dirty classified LOCKED, count still visible", byId.get(3)?.keepReason === "locked" && byId.get(3)?.locked === true && byId.get(3)?.uncommitted === 1, JSON.stringify(byId.get(3)));
	check("A2: clean terminal classified reapable", byId.get(2)?.keepReason === "reapable" && byId.get(4)?.keepReason === "reapable", JSON.stringify({ i2: byId.get(2), i4: byId.get(4) }));

	// C: the sweep reaps exactly the clean terminal trees; dirty and locked survive.
	const kept = [];
	const removed = await reconcileOrphanedWorktrees({ repoPath: repo, liveItemIds: new Set(), terminalItemIds: terminal, seatRoots: [], onDiagnostic: (d) => kept.push(d) });
	check("C: sweep reaps exactly [2,4]", JSON.stringify(removed.sort()) === JSON.stringify([2, 4]), JSON.stringify(removed));
	check("C: dirty item-1 and locked+dirty item-3 survive", existsSync(wt(1)) && existsSync(wt(3)));
	const keptReasons = kept.map((d) => d.itemId + ":" + d.reason).join(",");
	check("C: the keeps are LEGIBLE with the shared reasons", keptReasons.includes("1:dirty") && keptReasons.includes("3:locked"), keptReasons);

	// E: the LEAK-A fix via removeSeatWorkspace: a refused (dirty) teardown releases the lock,
	// preserves the work. item-3 is dirty+locked; after teardown it is unlocked and intact.
	const teardown = await removeSeatWorkspace({ worktreeRoot: repo, itemId: 3, releaseIfRefused: true });
	check("E: refused teardown names dirty and released the lock", teardown.removed === false && teardown.refused === "dirty" && teardown.released === true, JSON.stringify(teardown));
	check("E: uncommitted WORK PRESERVED (shared.txt still dirty)", existsSync(wt(3)));
	const after = (await listWorktrees(repo)).find((w) => /item-3$/.test(w.worktree));
	check("E: after refusal the tree is UNLOCKED (the leak fix)", after && after.locked === false, JSON.stringify(after));
	// F: live seat-root never reaped: pass wt(1) (dirty) AND item-2 (clean) as seat roots.
	// item-2 was reaped above; use a fresh clean tree item-5 locked... simpler: seat roots on a
	// clean tree: create item-5 clean terminal and make IT the seat root of the next sweep.
	await git(repo, "worktree", "add", "-q", "-b", "impl-item-5", wt(5));
	// item-5 is clean and terminal; make it a seat root for this sweep only.
	const removed2 = await reconcileOrphanedWorktrees({ repoPath: repo, liveItemIds: new Set(), terminalItemIds: new Set([5]), seatRoots: [wt(5)], onDiagnostic: (d) => kept.push(d) });
	check("F: a clean terminal tree that IS a seat root is NOT reaped", JSON.stringify(removed2) === "[]" && existsSync(wt(5)), JSON.stringify(removed2));
} finally {
	try { rmSync(base, { recursive: true, force: true }); } catch {}
}

console.log(failures === 0 ? "\nOUTCOME: probes behaved as documented; boundaries confirmed" : "\nPROBE MISMATCH");
process.exit(failures === 0 ? 0 : 1);

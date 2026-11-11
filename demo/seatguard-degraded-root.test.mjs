// demo/seatguard-degraded-root.test.mjs — #6181: when the guard cannot NAME the seat's root, it
// denies. It does not guess one.
//
// THE DEFECT, measured red before this change (run this file against main `35001c3a` in a scratch
// worktree and it exits 1):
//   src/seatguard.mjs:44-52 caught the snapshot error, printed
//   "SEATGUARD WARNING: seat cwd snapshot failed, using fallback root", and went on classifying the
//   write against `resolveSeatRoot()` — `DURIG_SEAT_ROOT` or `process.cwd()`, which is the SHARED
//   checkout, because the guard runs inside the broker/CLI process. So a degraded store read made a
//   boundary check evaluate against the very tree the guard exists to protect, and "inside the root"
//   read as "allowed". The security position calls this out as F1 + gate G2
//   (docs/reviews/security-fail-closed-guard-decision-point.md): a BOUNDARY guard that cannot
//   evaluate must deny; only a HEURISTIC may fail open, and then it must say so.
//
// THE PAIR THAT MAKES THIS A TEST AND NOT A TIGHTENING: the refusal is not blanket. A bare
// `node cli.mjs status` / `queue` still runs under the same broken read, because that is the
// escape hatch #4790 opened for an idle seat that cannot run prepare_workspace (it holds no claimed
// item). Open the write path and the first half passes; close the escape hatch and the seat
// deadlocks. Both halves are asserted here.
//
// WHAT THIS ROW DOES NOT BUILD: the `DURIAN_PI_WORKTREE_ROOT` seam (#2425) is REGISTERED, not
// built — `grep -rn "WORKTREE_ROOT" --include="*.mjs" src/` exits 1 — and the row forbids adding
// it. Check 5 is the probe the row asked for, in the form that is actually possible: the env
// channel that DOES exist (`DURIG_SEAT_ROOT`) must not rescue a call whose root the guard could not
// read. If a future row builds #2425, this assertion still holds: the broker-read root wins.
//
// Run: node demo/seatguard-degraded-root.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { beforeTool } from "../src/seatguard.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd }).toString().trim();

// A real repo with a real item worktree, so "the seat's own tree" is a tree and not a string.
const repo = await mkdtemp(join(tmpdir(), "durig-degraded-root-"));
await run("git", ["init", "-q", "-b", "main"], repo);
await writeFile(join(repo, "shared.txt"), "the shared tree\n");
await run("git", ["add", "shared.txt"], repo);
await run("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], repo);
await run("git", ["worktree", "add", "-q", "-b", "item-1", "item-1"], repo);
const seatRoot = join(repo, "item-1");
assert(existsSync(seatRoot), "the fixture worktree must exist");

const BROKEN = new Error("store read failed: SQLITE_BUSY: database is locked");

const apiBroken = { conversationId: "conv-broken", snapshot: async () => { throw BROKEN; } };
const apiOwn = { conversationId: "conv-own", snapshot: async () => ({ cwd: seatRoot }) };
const apiNoCwd = { conversationId: "conv-nocwd", snapshot: async () => ({}) };
const apiDegraded = { conversationId: "conv-degraded", snapshot: async () => ({ cwd: process.cwd() }) }; // #3961's known case: the persisted cwd IS the shared checkout

console.log("\n#6181 — the read fails: every root-dependent action is DENIED\n");

const writeUnderBroken = await beforeTool(
	{ type: "toolCall", id: "1", name: "write", arguments: { path: "note.md", content: "hello\n" } },
	apiBroken,
	{},
);
check("a relative write under a failed cwd read is blocked", writeUnderBroken?.block !== undefined, JSON.stringify(writeUnderBroken));
check("the refusal names the rule and the decision", /seat-root-unresolvable/.test(writeUnderBroken?.block ?? "") && /not-evaluated/.test(writeUnderBroken?.block ?? ""), writeUnderBroken?.block);
check("the refusal names the remedy (prepare_workspace)", /prepare_workspace/.test(writeUnderBroken?.block ?? ""), writeUnderBroken?.block);
check("the refusal says the fallback root is the shared checkout, not a secret", /shared checkout/.test(writeUnderBroken?.block ?? ""));

const editUnderBroken = await beforeTool(
	{ type: "toolCall", id: "2", name: "edit", arguments: { path: "note.md", edits: [{ oldText: "a", newText: "b" }] } },
	apiBroken,
	{},
);
check("an edit is refused on the same rule", editUnderBroken?.block !== undefined, JSON.stringify(editUnderBroken));

const absoluteUnderBroken = await beforeTool(
	{ type: "toolCall", id: "3", name: "write", arguments: { path: seatRoot + "/abs-note.md", content: "hello\n" } },
	apiBroken,
	{},
);
check("an ABSOLUTE path is refused too: the guard cannot verify it belongs to the seat", absoluteUnderBroken?.block !== undefined, JSON.stringify(absoluteUnderBroken));

const shellUnderBroken = await beforeTool(
	{ type: "toolCall", id: "4", name: "bash", arguments: { command: "rm -rf item-1" } },
	apiBroken,
	{},
);
check("a destructive shell command under a failed read is blocked", shellUnderBroken?.block !== undefined, JSON.stringify(shellUnderBroken));

const commitUnderBroken = await beforeTool(
	{ type: "toolCall", id: "5", name: "bash", arguments: { command: "git commit -m x" } },
	apiBroken,
	{},
);
check("a commit under a failed read is blocked (it would land in whatever tree was guessed)", commitUnderBroken?.block !== undefined, JSON.stringify(commitUnderBroken));

console.log("\n#6181 — the env channel does not rescue it\n");
// The row forbids building DURIAN_PI_WORKTREE_ROOT, so the probe uses the env var that exists.
process.env.DURIG_SEAT_ROOT = seatRoot;
const envRescue = await beforeTool(
	{ type: "toolCall", id: "6", name: "write", arguments: { path: "note.md", content: "hello\n" } },
	apiBroken,
	{},
);
check("DURIG_SEAT_ROOT set in the process env does NOT make a broken read classifiable", envRescue?.block !== undefined, JSON.stringify(envRescue));
delete process.env.DURIG_SEAT_ROOT;

console.log("\n#6181 — the escape hatch stays: reads are not writes\n");
const readVerb = await beforeTool(
	{ type: "toolCall", id: "7", name: "bash", arguments: { command: "node cli.mjs status" } },
	apiBroken,
	{},
);
check("a bare `node cli.mjs status` still runs under a broken read (#4790, the idle-seat deadlock)", readVerb?.block === undefined, JSON.stringify(readVerb));
const readVerbQueued = await beforeTool(
	{ type: "toolCall", id: "8", name: "bash", arguments: { command: "node cli.mjs queue --held" } },
	apiBroken,
	{},
);
check("a bare `node cli.mjs queue` still runs", readVerbQueued?.block === undefined, JSON.stringify(readVerbQueued));
const chainedRead = await beforeTool(
	{ type: "toolCall", id: "9", name: "bash", arguments: { command: "node cli.mjs status > out.txt" } },
	apiBroken,
	{},
);
check("the hatch does not widen: a read verb with a redirect is still refused", chainedRead?.block !== undefined, JSON.stringify(chainedRead));

console.log("\n#6181 — the states that are NOT the defect, pinned so they stay distinct\n");
const ownWrite = await beforeTool(
	{ type: "toolCall", id: "10", name: "write", arguments: { path: "note.md", content: "hello\n" } },
	apiOwn,
	{},
);
check("a session whose cwd READS fine is not refused (no false positive)", ownWrite?.block === undefined, JSON.stringify(ownWrite));
const ownEscape = await beforeTool(
	{ type: "toolCall", id: "11", name: "bash", arguments: { command: `echo hi > ${repo}/outside.txt` } },
	apiOwn,
	{},
);
check("the containment guard still fires when the root IS known", ownEscape?.block !== undefined, JSON.stringify(ownEscape));

const noCwdWrite = await beforeTool(
	{ type: "toolCall", id: "12", name: "write", arguments: { path: "note.md", content: "hello\n" } },
	apiNoCwd,
	{},
);
check(
	"a session with NO recorded cwd is the #3961 'never prepared a workspace' case, not a degraded read — it is not denied by this rule",
	!/seat-root-unresolvable/.test(noCwdWrite?.block ?? ""),
	JSON.stringify(noCwdWrite),
);
const degradedWrite = await beforeTool(
	{ type: "toolCall", id: "13", name: "write", arguments: { path: "note.md", content: "hello\n" } },
	apiDegraded,
	{},
);
check("a KNOWN cwd equal to the shared checkout is still refused (#3961, unchanged)", degradedWrite?.block !== undefined, JSON.stringify(degradedWrite));

const noSessionWrite = await beforeTool(
	{ type: "toolCall", id: "14", name: "write", arguments: { path: "note.md", content: "hello\n" } },
	undefined,
	{},
);
check(
	"no session (the harness or a demo calling the guard directly) keeps the resolveSeatRoot chain — a seat cannot reach this branch",
	!/seat-root-unresolvable/.test(noSessionWrite?.block ?? ""),
	JSON.stringify(noSessionWrite),
);

try { await run("git", ["worktree", "remove", seatRoot], repo); } catch { /* throwaway fixture */ }
await rm(repo, { recursive: true, force: true });

console.log(failures === 0
	? "\nPASS — a root the guard cannot read is a denial, the read-verb hatch stays, and the known states stay distinct"
	: `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

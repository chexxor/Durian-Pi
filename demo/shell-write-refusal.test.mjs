// demo/shell-write-refusal.test.mjs — #4367: a SHELL command that writes outside the seat's
// worktree is refused, by WIRING the resolver (#4366) into the containment guard that already
// exists (confine.mjs `confinedEnv` denies "is outside the seat's worktree").
//
// FOUR ASSERTIONS, each a different failure — and the SECOND is the one that keeps the guard alive:
//   1. a write to the SHARED ROOT is REFUSED (the incident's form);
//   2. a write inside the SEAT ROOT is ALLOWED — a guard that refuses ordinary work gets DISABLED,
//      and then it refuses nothing at all;
//   3. `-C <shared>` / `Set-Location <shared>` + a RELATIVE write is REFUSED — the incident's
//      ACTUAL shape, and the case a naive implementation misses;
//   4. an UNRESOLVABLE form is REPORTED, neither silently allowed nor silently refused.
//
// FAILING-FIRST, IN-DEMO: the PRE-EXISTING shell check (`refusalFor`, the only one before this
// item) does NOT catch (1) or (3) — the hole was real. Section 0 asserts that.
//
// Run: node demo/shell-write-refusal.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { refusalFor } from "../src/confine.mjs";
import { shellWriteRefusal } from "../src/seatguard.mjs";

const SEAT = resolve("C:/seat/worktree"); // stand-in seat root
const SHARED = resolve("C:/shared"); // stand-in shared root, OUTSIDE the seat
const cmd = (c) => shellWriteRefusal({ command: c, root: SEAT, cwd: SEAT });

/* ─── 0. FAILING-FIRST: today's shell check does NOT catch the escape ─────── */
console.log("\n0. failing-first — the pre-existing shell check misses it");
assert.equal(refusalFor(`Set-Content -Path ${SHARED}/src/x.mjs -Value 'x'`), null, "refusalFor does not catch a shared-root write (the hole)");
assert.equal(refusalFor(`Set-Location ${SHARED}; Set-Content -Path src/x.mjs -Value 'x'`), null, "refusalFor does not catch the relative escape (the hole)");
console.log("  ok   the hole is real: nothing turned the string into a path");

/* ─── 1. shared-root write REFUSED ───────────────────────────────────────── */
console.log("\n1. a write to the SHARED ROOT is refused");
const r1 = cmd(`Set-Content -Path ${SHARED}/src/x.mjs -Value 'x'`);
assert.notEqual(r1.block, null, "a shared-root write is blocked");
assert.match(r1.block, /outside your worktree/, "the refusal says why");
assert.match(r1.block, /edit` tool/, "...and NAMES THE REMEDY (the goal was legitimate, the method was not)");
assert.match(r1.block, /git operation on TRACKED paths/, "...including the correct way to restore the shared tree");
const r1b = cmd(`echo hi > ${SHARED}/out.txt`);
assert.notEqual(r1b.block, null, "redirection into the shared root is blocked too");
console.log("  ok   refused, and the message names the remedy");

/* ─── 2. seat-root write ALLOWED (NOT OPTIONAL) ──────────────────────────── */
console.log("\n2. a write inside the SEAT ROOT is allowed");
assert.equal(cmd(`Set-Content -Path ${SEAT}/src/x.mjs -Value 'x'`).block, null, "a seat-root write is allowed");
assert.equal(cmd("echo hi > note.txt").block, null, "a relative write in the seat root is allowed");
assert.equal(cmd("cp a.txt b.txt").block, null, "an ordinary copy in the seat root is allowed");
assert.equal(cmd("git status").block, null, "an ordinary command with no target is allowed");
console.log("  ok   ordinary work is NOT refused (a guard that refuses ordinary work gets disabled)");

/* ─── 3. the BASE case: -C / Set-Location relative escape REFUSED ────────── */
console.log("\n3. -C / Set-Location + a RELATIVE write escapes -> refused");
const r3 = cmd(`Set-Location ${SHARED}; Set-Content -Path src/x.mjs -Value 'x'`);
assert.notEqual(r3.block, null, "Set-Location then a relative write is blocked");
assert.match(r3.block, /outside your worktree/, "and says why");
const r3b = cmd(`cd ${SHARED} && echo hi > src/x.mjs`);
assert.notEqual(r3b.block, null, "cd then a relative redirect is blocked");
const r3c = cmd(`pwsh -C ${SHARED} -Command 'echo hi > src/x.mjs'`);
assert.notEqual(r3c.block, null, "-C then a relative redirect is blocked");
console.log("  ok   the incident's ACTUAL shape (a relative path from the worktree) is caught");

/* ─── 4. an UNRESOLVABLE form is REPORTED ────────────────────────────────── */
console.log("\n4. an unresolvable form is REPORTED, not silently allowed or refused");
const r4 = cmd("Set-Content -Path $p -Value 'x'");
assert.equal(r4.block, null, "a computed path is not refused (that would be an outage)");
assert.ok(r4.unresolved.length > 0, "...but it IS reported as unresolved");
assert.match(r4.unresolved[0].raw, /\$p/, "and the report names the form");
console.log("  ok   reported rather than silently allowed or silently refused");

console.log("\nSHELL-WRITE-REFUSAL TEST PASS (shared root refused; seat root allowed; base-changing escape refused; unresolved reported)");
process.exit(0);

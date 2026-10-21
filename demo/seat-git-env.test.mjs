// demo/seat-git-env.test.mjs — verify that makeSeatEnv pins non-interactive git vars.
//
// Failing-first: before the fix, the seat env has NO GIT_* vars, so a `git commit`
// (no -m) opens the operator's core.editor (VS Code) and BLOCKS the seat.
// Run: node demo/seat-git-env.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { join } from "node:path";

import { makeSeatEnv } from "../src/seattools.mjs";

const FALLBACK_ROOT = process.cwd();
const readOnlyRoots = [join(FALLBACK_ROOT, ".durig")];

// Build the env function with an empty roster (no known seats → fails closed).
const envFn = makeSeatEnv(new Map(), { fallbackRoot: FALLBACK_ROOT, readOnlyRoots });

// The env function is called with a target object { conversationId, cwd }.
// For a known seat (author), it returns authorEnv(base, root, { readOnlyRoots }).
// For a verifier, it returns verifierEnv(base, root, { readOnlyRoots }).
// In both cases, the base is a NodeExecutionEnv with the seat's root as cwd.
// The GIT_* vars must be present on the returned env.

const target = { conversationId: "test-conv", cwd: FALLBACK_ROOT };
const env = envFn(target);

// The required non-interactive git vars (D109).
const requiredVars = {
  GIT_EDITOR: ":",
  GIT_SEQUENCE_EDITOR: ":",
  GIT_TERMINAL_PROMPT: "0",
  GIT_MERGE_AUTOEDIT: "no",
  GIT_PAGER: "cat",
  PAGER: "cat",
};

// Verify each var is present and has the correct value.
for (const [key, expected] of Object.entries(requiredVars)) {
  const actual = env[key];
  assert.ok(actual !== undefined, `${key} must be set in the seat env`);
  assert.equal(actual, expected, `${key} must be "${expected}", got "${actual}"`);
}

console.log("PASS: all GIT_* non-interactive vars are pinned in makeSeatEnv");

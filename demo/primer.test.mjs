// demo/primer.test.mjs — the protocol primer must describe the tools that exist.
//
// Why this test exists at all: `defer_work` and `resume_work` shipped in item 5 and
// the primer kept describing four tools. Every seat in the real CLI was therefore
// never told it could defer, so the feature was unreachable outside the test that
// drove it directly — a green suite over a dead feature. The same omission would
// have happened for any future tool, because the primer is hand-written text and
// nothing connected it to the registry.
//
// The fix for that class of drift is structural, and this is the cheap half of it:
// hold the prose to the registry in both directions, so a tool nobody documented
// fails, and a documented tool nobody registered fails too. (The expensive half —
// generating the list from the tool objects so it cannot drift at all — is recorded
// in ROADMAP item 25 with its tradeoff, rather than smuggled in here.)
//
// The primer is read out of cli.mjs as source text on purpose: importing it would
// mean exporting an implementation detail purely for the test, and reading the
// source also catches the primer being dropped from buildSeatPrompt entirely.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Router } from "../src/rig.mjs";

const durigDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(durigDir, "cli.mjs"), "utf8");

// The primer array literal, as written.
const block = /const PROTOCOL = \[([\s\S]*?)\]\.join\(/.exec(source);
assert.ok(block, "buildSeatPrompt must still define a PROTOCOL primer");
const primer = block[1];

// It must actually reach the prompt, or documenting tools changes nothing.
assert.match(
	source,
	/\[compilePersona\(seat\), PROTOCOL\]/,
	"the primer must be joined into the seat's instructions",
);

const registered = (Router.tools ?? []).map((tool) => tool.name);
assert.ok(registered.length >= 4, `sanity: reading registered tools (got ${registered.join(", ")})`);

// Direction 1: every registered tool is named in the primer.
for (const name of registered) {
	assert.ok(
		primer.includes(name),
		`tool "${name}" is registered but not in the protocol primer, so no seat would ever be told it exists`,
	);
}

// Direction 2: every tool named in the primer is registered. A primer describing a
// tool that no longer exists is how a model is taught to call something absent.
const named = [...primer.matchAll(/- ([a-z_]+):/g)].map((m) => m[1]);
assert.ok(named.length > 0, "the primer must list tools as '- name: ...' lines");
for (const name of named) {
	assert.ok(
		registered.includes(name),
		`the primer documents "${name}", which is not a registered tool`,
	);
}

// And the two that started this: named, registered, and documented as a pair, since
// a deferral that cannot be resumed is the failure D32 exists to prevent.
for (const name of ["defer_work", "resume_work"]) {
	assert.ok(registered.includes(name), `${name} must be registered`);
	assert.ok(primer.includes(name), `${name} must be in the primer`);
}

console.log(
	`PRIMER TEST PASS (all ${registered.length} registered tools are documented, and the primer documents nothing else)`,
);
process.exit(0);

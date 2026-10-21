// demo/next-pointer.test.mjs — the pointer rule in AGENTS.md ("keep docs/NEXT.md current")
// made checkable.
//
// The prose rule ("a change to NEXT.md must leave a NEXT SESSION section that names the
// current item, a queue id, an exact next command, and a known blocker") had no reader:
// seats append clock-out logs to the top of the file and the pointer drifts out of date
// or out of position, and nothing fails. Three sessions in a row shipped a stale or
// buried pointer. This test reads the FILE, so the rule fails in the suite instead of
// being caught by review.
//
// What counts as the pointer: the FIRST `## NEXT SESSION` must appear before the first
// `## CLOCK-OUT` (history belongs below the pointer, not above it), and that section must
// carry all four facts. Later NEXT SESSION sections are history and are not checked.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../docs/NEXT.md", import.meta.url), "utf8");
const lines = text.split(/\r?\n/);

const headingIndex = (re) => lines.findIndex((line) => re.test(line));
const pointerAt = headingIndex(/^## NEXT SESSION\b/);
const historyAt = headingIndex(/^## CLOCK-OUT\b/);

assert.ok(pointerAt >= 0, "docs/NEXT.md has no `## NEXT SESSION` section at all");
assert.ok(
	historyAt < 0 || pointerAt < historyAt,
	`the first \`## NEXT SESSION\` (line ${pointerAt + 1}) must come BEFORE the first ` +
		`\`## CLOCK-OUT\` (line ${historyAt + 1}): a session log above the pointer buries it`,
);

// The section body runs to the next level-2 heading, so a check cannot accidentally
// read a later (historical) section's content and pass on it.
const nextHeading = lines.findIndex((line, i) => i > pointerAt && /^## /.test(line));
const body = lines.slice(pointerAt + 1, nextHeading < 0 ? lines.length : nextHeading).join("\n");

assert.match(body, /current item/i, "the pointer must name the current item (`**Current item:**`)");
assert.match(body, /#[0-9]{2,}/, "the pointer must name a queue id (`#NNN`)");
assert.match(body, /node cli\.mjs/, "the pointer must give an exact next command containing `node cli.mjs`");
assert.match(
	body,
	/^\*\*Blocker:\*\*/m,
	"the pointer must name a known blocker on its own `**Blocker:**` line (write `none` when there is none)",
);

console.log("NEXT POINTER TEST PASS (pointer precedes history; current item, queue id, next command, blocker)");

// demo/degeneration.test.mjs — the degeneration guard's PURE detector.
//
// RED BEFORE: src/degeneration.mjs does not exist -> import fails (failing-first).
// GREEN AFTER: assessRun() flags a run that has outgrown its turn/context bound or
// shows step-repetition / malformed tool calls, and is idempotent after a reset.
//
// Run: node demo/degeneration.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { assessRun, DEGEN_DEFAULTS } from "../src/degeneration.mjs";
import { applyResets, planResets } from "../src/supervisor.mjs";
import { countPseudoToolCalls, isPseudoToolCallTurn } from "../src/attention.mjs";

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${label} -- ${err.message}`);
  }
}
async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${label} -- ${err.message}`);
  }
}

// Entries are newest-first (storage order), the way readSeatPages returns them.
function assistant(toolCalls = [], { usage = null, text = "" } = {}) {
  const content = [];
  if (text) content.push({ type: "text", text });
  for (const [name, args] of toolCalls) content.push({ type: "toolCall", name, arguments: args });
  return { kind: "pi.assistant", model: [{ role: "assistant", content, ...(usage ? { usage } : {}) }] };
}
const user = (text = "You have queued work.") => ({
  kind: "pi.user",
  model: [{ role: "user", content: [{ type: "text", text }] }],
});
const malformed = () => ({
  kind: "pi.tool-result",
  model: [{ isError: true, content: [{ type: "text", text: '<harness> [error] Validation failed for tool "edit": path required' }] }],
});
const reset = () => ({ kind: "pi.reset", model: [{ role: "user", content: [{ type: "text", text: "reset" }] }] });
// The model's recurrent fault: a tool call written into the message TEXT. Observed in two shapes —
// DeepSeek's DSML framing (a special-token delimiter of fullwidth vertical lines around "DSML")
// and a plain nested-parameter pair. The delimiter is stripped by a terminal, so a screen read
// hides it; this test uses the bytes the store actually holds.
const DSML = "\uFF5CDSML\uFF5C";
const pseudoCall = (tool = "powershell", command = "echo hi") => ({
  kind: "pi.assistant",
  model: [
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text:
            `Let me run it.\n\n<parameter name="${tool}">\n` +
            `<${DSML} parameter name="command" string="true">${command}</${DSML} parameter>\n` +
            `</${DSML} invoke>\n</${DSML} calls>\n`,
        },
      ],
    },
  ],
});

console.log("\n=== degeneration guard: assessRun ===\n");

check("a short healthy run is not degenerate", () => {
  const a = assessRun([assistant([["read", { path: "a" }]]), assistant([["read", { path: "b" }]]), user()]);
  assert.equal(a.degenerate, false);
  assert.deepEqual(a.reasons, []);
});

check("a run past the tool-turn bound is degenerate", () => {
  const entries = [user()];
  for (let i = 0; i < 6; i++) entries.unshift(assistant([["read", { path: `f${i}` }]]));
  const a = assessRun(entries, { maxToolTurns: 5 });
  assert.equal(a.degenerate, true);
  assert.ok(a.reasons.some((r) => r.startsWith("tool-turns=")), a.reasons.join(","));
});

check("repeated identical tool calls trip the repeat bound", () => {
  const same = ["edit", { path: "x", oldText: "a", newText: "b" }];
  const entries = [user()];
  // 4 identical calls => 3 repeats (the first occurrence is not itself a repeat), which
  // is what the conservative maxRepeats=3 default requires.
  for (let i = 0; i < 4; i++) entries.unshift(assistant([same]));
  const a = assessRun(entries);
  assert.equal(a.degenerate, true);
  assert.ok(a.reasons.some((r) => r.startsWith("repeats=")), a.reasons.join(","));
});

check("malformed tool calls trip the malformed bound", () => {
  const entries = [user()];
  entries.unshift(malformed());
  entries.unshift(malformed());
  const a = assessRun(entries);
  assert.equal(a.degenerate, true);
  assert.ok(a.reasons.some((r) => r.startsWith("malformed=")), a.reasons.join(","));
});

check("a tool call emitted AS TEXT trips the pseudo-call bound", () => {
  const entries = [user()];
  entries.unshift(pseudoCall());
  const a = assessRun(entries);
  assert.equal(a.pseudoToolCalls, 1, "the run reports one pseudo tool call");
  assert.equal(a.degenerate, true);
  assert.ok(a.reasons.some((r) => r.startsWith("pseudo-tool-call=")), a.reasons.join(","));
});

check("a prose mention of the shape is not a pseudo tool call", () => {
  const prose = assistant([], { text: 'The model may emit a <parameter name="edit"> block; that is the fault.' });
  assert.equal(isPseudoToolCallTurn(prose), false);
  assert.equal(countPseudoToolCalls([prose]), 0);
  assert.equal(assessRun([prose, user()]).degenerate, false);
});

check("a real structured tool call is not a pseudo tool call", () => {
  const real = assistant([["read", { path: "a" }]], { text: "Reading the file." });
  assert.equal(isPseudoToolCallTurn(real), false);
});

check("the predicate matches the DSML-delimited form and the plain nested-parameter variant", () => {
  const proseOnly = assistant([], { text: 'The model may emit a <parameter name="edit"> block; that is the fault.' });
  assert.equal(isPseudoToolCallTurn(proseOnly), false, "a lone mention is not this fault");
  const dsml = assistant([], { text: `<parameter name="read">\n<${DSML} parameter name="path">a</${DSML} parameter>` });
  assert.equal(isPseudoToolCallTurn(dsml), true, "the DSML delimiter is the tell");
  const plainNested = assistant([], { text: '<parameter name="edit">\n<parameter name="path">a</parameter>' });
  assert.equal(isPseudoToolCallTurn(plainNested), true, "the plain nested pair is the same fault");
});

check("a context past the token bound is degenerate", () => {
  const entries = [assistant([["read", { path: "a" }]], { usage: { totalTokens: 999_999 } }), user()];
  const a = assessRun(entries);
  assert.equal(a.degenerate, true);
  assert.ok(a.reasons.some((r) => r.startsWith("context-tokens=")), a.reasons.join(","));
});

check("idempotent: an entry page already ending in pi.reset is skipped", () => {
  const entries = [reset(), malformed(), malformed(), user()];
  const a = assessRun(entries);
  assert.equal(a.degenerate, false);
  assert.equal(a.justReset, true);
});

check("only the CURRENT run is judged; an old degenerate run behind a wake is ignored", () => {
  const oldDegenerate = [malformed(), malformed(), user("old wake")];
  const currentHealthy = [assistant([["read", { path: "a" }]]), user("current wake")];
  // newest-first: current run entries, then its wake, then the old run
  const entries = [...currentHealthy, ...oldDegenerate];
  const a = assessRun(entries);
  assert.equal(a.degenerate, false, a.reasons.join(","));
});

check("defaults are conservative and complete", () => {
  for (const key of ["maxToolTurns", "maxRepeats", "maxMalformed", "maxPseudoToolCalls", "maxContextTokens", "repeatHorizon"]) {
    assert.ok(Number.isFinite(DEGEN_DEFAULTS[key]), `missing default ${key}`);
  }
});

check("planResets flags ONLY the degenerate seats", () => {
  const seats = [{ name: "a", conversationId: 1 }, { name: "b", conversationId: 2 }];
  const assessmentsByConv = new Map([
    [1, { degenerate: true, reasons: ["repeats=3>=3"] }],
    [2, { degenerate: false, reasons: [] }],
  ]);
  const plans = planResets({ seats, assessmentsByConv });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].seat, "a");
  assert.equal(plans[0].reason, "degeneration");
  assert.match(plans[0].detail, /repeats/);
});

await checkAsync("applyResets writes the reset boundary for each plan", async () => {
  const resetCalls = [];
  const harness = {
    conversation: async (id) => ({ reset: async (handoff) => { resetCalls.push({ id, handoff }); } }),
  };
  const applied = await applyResets(
    harness,
    [{ seat: "a", conversationId: 7, reason: "degeneration", detail: "x" }],
    {},
  );
  assert.equal(applied.length, 1);
  assert.equal(resetCalls.length, 1);
  assert.equal(resetCalls[0].id, 7);
  assert.match(resetCalls[0].handoff, /degeneration guard reset/);
});

await checkAsync("applyResets names the malformed-tool-call fault so the model re-issues via the tool API", async () => {
	const handoffs = [];
	const harness = { conversation: async () => ({ reset: async (handoff) => handoffs.push(handoff) }) };
	await applyResets(
		harness,
		[{ seat: "impl", conversationId: 9, reason: "degeneration", detail: "pseudo-tool-call=1>=1" }],
		{},
	);
	assert.match(handoffs[0], /tool API/);
	assert.match(handoffs[0], /pseudo-tool-call/);
});

await checkAsync("applyResets reports a failing seat and still resets the others", async () => {
  const resetCalls = [];
  const harness = {
    conversation: async (id) => ({
      reset: async () => {
        if (id === 1) throw new Error("boom");
        resetCalls.push(id);
      },
    }),
  };
  const applied = await applyResets(
    harness,
    [
      { seat: "a", conversationId: 1, reason: "degeneration", detail: "x" },
      { seat: "b", conversationId: 2, reason: "degeneration", detail: "y" },
    ],
    {},
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].seat, "b");
  assert.deepEqual(resetCalls, [2]);
});

console.log(failures === 0 ? "\nPASS — degeneration detector verified" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

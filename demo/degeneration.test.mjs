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
import { countLanguageDriftTurns, countPseudoToolCalls, isLanguageDriftTurn, isPseudoToolCallTurn } from "../src/attention.mjs";

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
function assistant(toolCalls = [], { usage = null, text = "", durationMs = null } = {}) {
  const content = [];
  if (text) content.push({ type: "text", text });
  for (const [name, args] of toolCalls) content.push({ type: "toolCall", name, arguments: args });
  return {
    kind: "pi.assistant",
    model: [
      { role: "assistant", content, ...(usage ? { usage } : {}), ...(durationMs !== null ? { durationMs } : {}) },
    ],
  };
}
const user = (text = "You have queued work.") => ({
  kind: "pi.user",
  model: [{ role: "user", content: [{ type: "text", text }] }],
});
const malformed = () => ({
  kind: "pi.tool-result",
  model: [{ isError: true, content: [{ type: "text", text: '<harness> [error] Validation failed for tool "edit": path required' }] }],
});
// A tool RESULT carries the TOOL's runtime in `durationMs` — NOT a model turn (#1703).
const toolResult = (durationMs) => ({
  kind: "pi.tool-result",
  model: [{ role: "tool", content: [{ type: "text", text: "ok" }], durationMs }],
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
  assert.equal(a.degenerate, false);  assert.deepEqual(a.reasons, []);
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

check("a reply composed in Chinese trips the language-drift bound", () => {
  // The observed qa fault: after completing an item it emitted a long Chinese recap. The
  // run is otherwise structurally clean, so only a script test can see it. The literal is
  // deliberately >40 CJK chars and mostly-CJK, matching the real reply's shape.
  const drifted = assistant([], {
    text: "#1085 — 已验证并完成：这是一段很长的中文摘要，用来证明语言漂移检测器能够识别回复语言发生了变化，并且会重置该座席的上下文。",
  });
  assert.equal(isLanguageDriftTurn(drifted), true, "a predominantly-CJK reply is drift");
  assert.equal(countLanguageDriftTurns([drifted]), 1);
  const a = assessRun([drifted, user()]);
  assert.equal(a.languageDrift, 1, "the run reports one drifted turn");
  assert.equal(a.degenerate, true);
  assert.ok(a.reasons.some((r) => r.startsWith("language-drift=")), a.reasons.join(","));
});

check("a short Chinese quotation inside an English reply is not drift", () => {
  // A verifier legitimately quotes a CJK filename or error string; the guard must not reset
  // a healthy English report just because it contains a few CJK characters.
  const quoted = assistant([], {
    text: 'The verifier named the file "配置文件.json" and moved on to the next check without comment.',
  });
  assert.equal(isLanguageDriftTurn(quoted), false, "a short CJK quote must not trip the guard");
  assert.equal(assessRun([quoted, user()]).degenerate, false);
});

check("CJK inside a code span is not drift", () => {
  // A code block may legitimately hold CJK data (a fixture label); code spans are excluded
  // from the language ratio, so an English report that quotes code never trips the guard.
  const fenced = assistant([], {
    text:
      "The fixture stores the Chinese label in a constant, which is expected data:\n\n" +
      "```js\n" +
      'const label = "这是一个很长的中文字符串，用来证明代码块中的内容不会被当作语言漂移，也不应触发重置守卫。";\n' +
      "```\n\n" +
      "This is a legitimate English report that quotes code.",
  });
  assert.equal(isLanguageDriftTurn(fenced), false, "fenced code must be excluded from the language test");
});

check("context pressure is a SEAT-LEVEL signal that SURVIVES a wake (#1823)", () => {
  // The defect (#1705 Defect B): the per-turn wake kept the run window at 1-2 turns, so a seat
  // that degraded at 367,559 tokens was never seen. Context is a seat-level state, so it is read
  // from the newest assistant entry of the WHOLE page, wake or not.
  const entries = [
    user(), // a wake: the run window resets here...
    assistant([["read", { path: "a" }]], { usage: { totalTokens: 367_559 } }), // ...but the seat's context survives
  ];
  const a = assessRun(entries, { contextWindowTokens: 1_048_576 });
  assert.equal(a.contextTokens, 367_559, "the seat's current context is read across the wake");
  assert.equal(a.degenerate, true, "the seat-level context trips");
  assert.ok(a.reasons.some((r) => r.startsWith("context-tokens=")), a.reasons.join(","));
});

check("the context trip is FLOOR and FRACTION and CEILING (#1823)", () => {
  const withCtx = (tokens, window) => assessRun([assistant([["read", { path: "a" }]], { usage: { totalTokens: tokens } }), user()], { contextWindowTokens: window });
  // FLOOR: below it, context alone never trips even past the fraction of a small window.
  assert.equal(withCtx(60_000, 100_000).degenerate, false, "below the floor: no trip");
  assert.equal(withCtx(60_000, 100_000).contextSkip, "below-floor");
  // The qa datapoint: 367,559 vs an ADVERTISED 1,048,576 (~35%) must trip at fraction 0.35...
  assert.equal(withCtx(367_559, 1_048_576).degenerate, true, "the qa degradation point trips");
  // ...but a long HEALTHY session at 300k must NOT (zero false positives).
  assert.equal(withCtx(300_000, 1_048_576).degenerate, false, "a healthy long session does not trip");
  assert.equal(withCtx(300_000, 1_048_576).contextSkip, "below-trip");
  // CEILING: a huge advertised window must not push the trip above the ceiling.
  assert.equal(withCtx(700_000, 10_000_000).contextTrip, 600_000, "the trip is capped by the ceiling");
});

check("no resolved window => the context cause is SKIPPED with a why, never guessed (#1823)", () => {
  const a = assessRun([assistant([["read", { path: "a" }]], { usage: { totalTokens: 999_999 } }), user()]);
  assert.equal(a.degenerate, false, "no window: no context trip");
  assert.equal(a.contextWindow, null);
  assert.equal(a.contextSkip, "no-context-window");
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
  for (const key of ["maxToolTurns", "maxRepeats", "maxMalformed", "maxPseudoToolCalls", "maxLanguageDrift", "minLanguageDriftChars", "minLanguageDriftRatio", "minContextTokens", "contextFraction", "contextCeilingTokens", "repeatHorizon"]) {
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

await checkAsync("applyResets names the language-drift fault and restates English-only", async () => {
	const handoffs = [];
	const harness = { conversation: async () => ({ reset: async (handoff) => handoffs.push(handoff) }) };
	await applyResets(
		harness,
		[{ seat: "qa", conversationId: 15, reason: "degeneration", detail: "language-drift=1>=1" }],
		{},
	);
	assert.match(handoffs[0], /English/);
	assert.match(handoffs[0], /language-drift/);
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

check("a slow TOOL result is not a slow ASSISTANT turn (#1703)", () => {
  // The defect: a legitimate ~5-minute demo sweep ran as a TOOL, and the guard read the tool
  // result's durationMs as the MODEL's turn duration, resetting the seat in a hot loop.
  const a = assessRun([
    toolResult(301_935), // newest first: the tool result...
    assistant([["powershell", { command: "npm test" }]], { durationMs: 2_075 }), // ...from a fast turn
    user(),
  ]);
  assert.equal(a.turnDurationMs, 2_075, "the tool's runtime is not a turn duration");
  assert.equal(a.degenerate, false, "a slow tool run does not reset the seat");
  assert.deepEqual(a.reasons, []);
});

check("a genuinely slow ASSISTANT turn still trips the bound (#1703)", () => {
  const a = assessRun([assistant([], { durationMs: 301_935 }), user()]);
  assert.equal(a.turnDurationMs, 301_935, "the assistant turn's duration is counted");
  assert.equal(a.degenerate, true, "the real stall is still caught");
  assert.ok(
    a.reasons.some((r) => r.startsWith("turn-duration-ms=")),
    `the reason names the duration cause; got ${a.reasons.join(", ")}`,
  );
});

check("a run that continues after a reset does not re-trigger the guard (#1704)", () => {
  // The observed loop: the reset was applied, the seat ran once more, and the OLD degenerate
  // run was still counted (a reset is not a `pi.user`), so the guard re-fired every pass.
  const a = assessRun([
    assistant([["read", { path: "a" }]]), // the turn the seat ran AFTER the reset
    reset(), // the reset already applied
    pseudoCall(), // the OLD degenerate run, before the reset
    user(),
  ]);
  assert.equal(a.justReset, true, "the reset is seen as the run boundary");
  assert.equal(a.pseudoToolCalls, 0, "the pre-reset run is not re-counted");
  assert.equal(a.degenerate, false, "the guard does not re-fire");
});

check("a reset at the top of the page is justReset, never degenerate (#1704)", () => {
  const a = assessRun([reset(), assistant([["read", { path: "a" }]]), user()]);
  assert.equal(a.justReset, true);
  assert.equal(a.degenerate, false);
});

console.log(failures === 0 ? "\nPASS — degeneration detector verified" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

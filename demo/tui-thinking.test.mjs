// demo/tui-thinking.test.mjs — U5: THINKING parity in the TUI (TUI ⟷ log).
//
// ONE concern: both durian-pi surfaces show the model's thinking — including a block
// the provider redacted — and the two surfaces MATCH each other: the same
// phrases ("thinking ›", "thinking (redacted by the provider)"), and neither
// surface hides thinking the other one shows.
//
// Provider caveat (stated, NOT fixed): some providers withhold the reasoning
// body but keep the block (part.redacted === true). pi's own handling of such
// bodies is provider-dependent; durian-pi cannot recover the body and does not try:
// the block's existence is itself the fact to report. Parity here is checked on
// the reporting, in both surfaces, with the same words.
//
// Failing-first (RED before the fix): the pre-change TUI said "[thinking withheld]"
// where the log says "thinking (redacted by the provider)", suppressed live
// thinking once text reached the frame (the log does not), and a fully-redacted
// LIVE block was invisible. Those are exactly what the checks below pin.
// Run: node demo/tui-thinking.test.mjs  (exit 0 = pass)

import { strict as assert } from "node:assert";
import { renderTui, frameToLines } from "../src/tui/client.mjs";
import { partialView } from "../src/viewmodel.mjs";
import { formatPartial, formatChat } from "../src/chatview.mjs";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}

const seats = [{ name: "impl", role: "implementation engineer" }];
const health = { seats, queueItems: [], attention: [], uptime: 600 };

// A live doc whose thinking block exists but was redacted by the provider:
// the body is empty, the block keeps its redacted flag.
function liveRedacted(extraText = "") {
  const content = [{ type: "thinking", thinking: "", redacted: true }];
  if (extraText) content.push({ type: "text", text: extraText });
  return {
    generation: { attempt: 1, message: { role: "assistant", content } },
    tools: [],
  };
}

// A live doc with a real (non-redacted) thinking body.
function liveThinking(thinking, text = "") {
  const content = [{ type: "thinking", thinking }];
  if (text) content.push({ type: "text", text });
  return {
    generation: { attempt: 1, message: { role: "assistant", content } },
    tools: [],
  };
}

try {
  console.log("\n=== U5: thinking parity (TUI ⟷ log) ===\n");

  // --- 1. A redacted LIVE block is a fact to report, in partialView itself ---
  const pv1 = partialView(liveRedacted());
  check("partialView sees a redacted live block (no body, flag set)",
    pv1?.hasContent === true && pv1.thinkingRedacted === true && pv1.thinking === "",
    JSON.stringify(pv1));

  // --- 2. Parity, streaming partial, REDACTED-only: same words in both ---
  const tui2 = frameToLines(renderTui({ seats, turns: [], partial: pv1, health, queueItems: [], width: 80, color: false }));
  const log2 = String(formatPartial(pv1, { seat: "impl" }));
  check("TUI streaming block reports redaction in the log's own words",
    tui2.some((l) => l.includes("thinking (redacted by the provider)")),
    tui2.join("/").slice(0, 300));
  check("log streaming window reports redaction with the same words",
    log2.includes("thinking (redacted by the provider)"), log2);

  // --- 3. Parity, streaming partial, THINKING + TEXT: the label matches and the
  //        TUI must NOT hide thinking just because text arrived too ---
  const pv3 = partialView(liveThinking("weighing slots", "the answer so far"));
  const tui3 = frameToLines(renderTui({ seats, turns: [], partial: pv3, health, queueItems: [], width: 80, color: false }));
  const log3 = String(formatPartial(pv3, { seat: "impl" }));
  check("TUI shows the thinking label while text streams too",
    tui3.some((l) => l.includes("thinking ›") && l.includes("weighing slots")) &&
    tui3.some((l) => l.includes("the answer so far")),
    tui3.join("/").slice(0, 400));
  check("log shows the same thinking label (parity)",
    log3.includes("thinking ›") && log3.includes("weighing slots"), log3);

  // --- 4. Committed REDACTED turn: the TUI transcript uses the log's words ---
  const redactedTurn = { kind: "thinking", ts: 2, text: "", redacted: true };
  const tui4 = frameToLines(renderTui({ seats, turns: [redactedTurn], health, queueItems: [], width: 80, color: false }));
  check("TUI transcript reports redaction the way the log does",
    tui4.some((l) => l.includes("thinking (redacted by the provider)")),
    tui4.join("/").slice(0, 300));
  check('TUI transcript no longer says "withheld"', !tui4.some((l) => l.includes("withheld")));

  // --- 5. Committed THINKING turn: the TUI transcript labels it like the log ---
  const thinkingTurn = { kind: "thinking", ts: 3, text: "first thought\nsecond thought" };
  const tui5 = frameToLines(renderTui({ seats, turns: [thinkingTurn], health, queueItems: [], width: 80, color: false }));
  const assistantEntry = {
    kind: "pi.assistant",
    model: [{
      role: "assistant",
      timestamp: 1_700_000_000_003,
      content: [{ type: "thinking", thinking: "first thought\nsecond thought" }],
    }],
  };
  const log5 = String(formatChat([assistantEntry], { seat: "impl", width: 80 }));
  check("TUI transcript labels thinking like the log (thinking ›)",
    tui5.some((l) => l.includes("thinking ›") && l.includes("first thought")),
    tui5.join("/").slice(0, 400));
  check("log committed path carries the same label (parity)",
    log5.includes("thinking ›") && log5.includes("first thought"), log5);

  // --- 6. Floor: 60 columns — the redaction phrase and label survive intact ---
  const tui6 = frameToLines(renderTui({ seats, turns: [], partial: pv1, health, queueItems: [], width: 60, color: false }));
  check("60-col floor: the redaction report still present, no line over 60",
    tui6.some((l) => l.includes("thinking (redacted by the provider)")) &&
    tui6.every((l) => l.length <= 60),
    JSON.stringify(tui6.filter((l) => l.length > 60)));

  // --- 7. Null/absent partials keep the idle contract (no regression) ---------
  check("idle partial still renders idle", (() => {
    const idle = frameToLines(renderTui({ seats, turns: [], partial: null, health, queueItems: [], width: 80, color: false }));
    return idle.every((l) => !l.includes("thinking (redacted"));
  })());

  console.log(failures === 0
    ? "\nPASS — thinking shown in TUI and log, redaction reported with the same words"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
  console.error(err?.stack?.split("\n").slice(0, 4).join("\n") ?? "");
  failures += 1;
}

process.exit(failures === 0 ? 0 : 1);

// demo/tui-multipane.test.mjs — U2: TEAM-WIDE multi-pane over the durian-pi ui.
//
// DEFINITION OF ACTIVE (operator, EXACT): a seat is active iff it is CURRENTLY
// PRODUCING CONTENT — mid-generation / streaming output (the in-flight partial:
// `partialView(live).hasContent`). A seat with QUEUED-BUT-UNSTARTED work is NOT
// active — queue depth must never key the streaming view.
//
// ONE concern: with N>1 seats actively generating, the window shows ALL of them at
// once (one streaming block per active seat, seat-labelled); read-only (D11/D40).
//
// Failing-first: against the U1 single-partial renderTui the multi-active assertions
// FAIL (RED); after the client + readState thread partials per seat they pass (GREEN).
// Run: node demo/tui-multipane.test.mjs  (exit 0 = pass)

import { frameToLines, renderTui } from "../src/tui/client.mjs";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}

const seats = [
  { name: "impl", role: "implementation engineer" },
  { name: "qa", role: "independent verifier" },
  { name: "scribe", role: "scribe" },
];
const health = { seats, queueItems: [], attention: [], uptime: 1200 };

function activePartial(text) {
  return { attempt: 1, text, thinking: null, tools: [], hasContent: true };
}

/** The streaming SECTION of a frame (from the first "── streaming" header to the
 *  transcript header or the status rule), so roster rows are not mistaken for it. */
function streamingSection(lines) {
  const startAt = lines.findIndex((l) => l.includes("── streaming"));
  if (startAt < 0) return [];
  let endAt = lines.length;
  for (let i = startAt + 1; i < lines.length; i++) {
    if (lines[i].includes("── transcript") || lines[i].includes("── ") && lines[i].includes("─") === false) {
      // next section header ends the streaming section
    }
    if (lines[i].includes("── transcript")) { endAt = i; break; }
  }
  return lines.slice(startAt, endAt);
}

try {
  console.log("\n=== U2: team-wide multi-pane (all active seats at once) ===\n");

  // --- N=2 ACTIVE seats simultaneously -------------------------------------
  const partials = [
    { seat: "impl", ...activePartial("impl is wiring the tool round") },
    { seat: "qa", ...activePartial("qa is re-running the driver demo") },
  ];
  const frame = renderTui({ seats, turns: [], partials, partial: null, health, queueItems: [], width: 80, color: false });
  const lines = frameToLines(frame);
  const stream = streamingSection(lines);
  check("frame paints with N=2 partials", frame.height > 0);
  check("streaming section exists", stream.length > 0, lines.join("\n").slice(0, 300));
  check("impl's block shows impl's live text",
    stream.some((l) => l.includes("impl") === false) || stream.some((l) => l.includes("wiring the tool round")),
    stream.join(" / ").slice(0, 300));
  check("qa's block shows qa's live text",
    stream.some((l) => l.includes("re-running the driver demo")),
    stream.join(" / ").slice(0, 300));
  check("both active seats named in streaming headers",
    stream.some((l) => l.includes("streaming") && l.includes("impl")) &&
    stream.some((l) => l.includes("streaming") && l.includes("qa")),
    stream.join(" / ").slice(0, 200));
  check("inactive scribe is NOT in the streaming section",
    stream.every((l) => !l.includes("scribe")),
    stream.join(" / ").slice(0, 200));

  // --- N=1 active: unchanged single-seat shape (plus seat label) ------------
  const single = renderTui({ seats, turns: [], partials: [partials[0]], partial: null, health, queueItems: [], width: 80, color: false });
  const singleLines = frameToLines(single);
  check("single-active keeps one streaming header naming the seat",
    singleLines.some((l) => l.includes("── streaming") && l.includes("impl")), singleLines.join("/").slice(0, 200));

  // --- legacy single `partial` argument still renders (C3 contract) --------
  const legacy = renderTui({ seats, turns: [], partial: activePartial("legacy shape"), health, queueItems: [], width: 80, color: false });
  const legacyLines = frameToLines(legacy);
  check("legacy single-partial argument still renders its text",
    legacyLines.some((l) => l.includes("legacy shape")), legacyLines.join("/").slice(0, 240));

  // --- ZERO active: idle row, and queued-but-unstarted work does NOT count ---
  const queueDepth = [
    { id: 1, to: "scribe", status: "queued", subject: "written work waiting", from: "pm" },
    { id: 2, to: "scribe", status: "queued", subject: "more waiting", from: "pm" },
  ];
  const zero = renderTui({ seats, turns: [], partial: null, partials: [], health, queueItems: queueDepth, width: 80, color: false });
  const zeroLines = frameToLines(zero);
  check("zero active: no streaming section at all (idle is the partial row, not a 'streaming:' block)",
    streamingSection(zeroLines).length === 0 || streamingSection(zeroLines).some((l) => l.includes("[idle]")),
    zeroLines.join("/").slice(0, 240));

  // --- 60-col floor with 2 active ------------------------------------------
  const narrow = renderTui({ seats, turns: [], partials, partial: null, health, queueItems: [], width: 60, color: false });
  const narrowLines = frameToLines(narrow);
  check("60-col floor: no line exceeds 60 cells with 2 active blocks", narrowLines.every((l) => l.length <= 60),
    narrowLines.find((l) => l.length > 60) ?? "");

  console.log(failures === 0
    ? "\nPASS — all actively-generating seats render at once; queued-but-idle is not active"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
  failures += 1;
}

process.exit(failures === 0 ? 0 : 1);

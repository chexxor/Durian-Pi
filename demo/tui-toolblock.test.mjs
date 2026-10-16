// demo/tui-toolblock.test.mjs — U3: in-place tool-call block (partial view, never a turn).
//
// ONE concern: a tool call appears at INITIATION (name + args) and the SAME block
// updates IN PLACE as it progresses and finishes — the result must NOT appear only
// once the whole turn settles. D40: the live tool block is a VIEW of the in-flight
// partial (`pi.live`), never a persisted turn; no storage writes (D40/D11).
//
// pi reference studied (this checkout's vendored deps): pi-tui@1.1.0 components
// (Box/Text, render(width)) define the in-place component contract; pi-durable's
// live.ts defines the slot shape {callId, name, status pending|running|done, output,
// details}. `<pi-coding-agent>/dist/.../tool-execution.js` itself is NOT vendored
// in this checkout — its in-place discipline (pending bg -> success/error on
// completion, updateArgs/updateResult) is reproduced from the component contract.
//
// Failing-first: current partialView drops DONE slots and has no args → the
// initiation and in-place assertions FAIL (RED); after the upgrade they pass (GREEN).
// Run: node demo/tui-toolblock.test.mjs  (exit 0 = pass)

import { renderTui, frameToLines } from "../src/tui/client.mjs";
import { partialView, buildTurns } from "../src/viewmodel.mjs";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}

const seats = [{ name: "impl", role: "implementation engineer" }];
const health = { seats, queueItems: [], attention: [], uptime: 600 };

// A live doc: the assistant is mid-generation and has EMITTED a tool call.
// At initiation, tools slot types are "pending"/"running slots get output later."
function liveAt(args) {
  return {
    generation: {
      attempt: 1,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: args.text ?? "" },
          { type: "toolCall", id: "call-1", name: "read_file", arguments: { path: "src/broker.mjs", limit: 5 } },
        ],
      },
    },
    tools: args.slots ?? [],
  };
}

try {
  console.log("\n=== U3: in-place tool-call block ===\n");

  // --- 1. INITIATION: the block renders name + args the moment the call exists ---
  const pv = partialView(liveAt({ slots: [{ callId: "call-1", name: "read_file", status: "running" }] }));
  check("partialView.hasContent true at initiation", pv?.hasContent === true);
  check("partialView.toolCalls present at initiation (pending/running, WITH args)",
    Array.isArray(pv.toolCalls) && pv.toolCalls.length === 1 &&
    pv.toolCalls[0].name === "read_file" && String(pv.toolCalls[0].args?.path) === "src/broker.mjs",
    JSON.stringify(pv.toolCalls ?? null));
  check("initiation status read from the slot (running)",
    pv.toolCalls[0].status === "running", JSON.stringify(pv.toolCalls[0]));

  const frame1 = renderTui({ seats, turns: [], partial: pv, health, queueItems: [], width: 80, color: false });
  const lines1 = frameToLines(frame1);
  check("frame shows the tool block at initiation", lines1.some((l) => l.includes("read_file") && l.includes("src/broker.mjs")),
    lines1.join("/").slice(0, 300));

  // --- 2. IN PLACE: same callId, slot now done WITH output — SAME block updates,
  //         initiation line (name+args) still visible, result appended same block ---
  const pv2 = partialView(liveAt({
    slots: [{ callId: "call-1", name: "read_file", status: "done", output: "line1\nline2" }],
  }));
  check("done slot STILL carried (not dropped until settle)",
    pv2.toolCalls.length === 1 && pv2.toolCalls[0].status === "done" && pv2.toolCalls[0].output === "line1\nline2",
    JSON.stringify(pv2.toolCalls));
  const frame2 = renderTui({ seats, turns: [], partial: pv2, health, queueItems: [], width: 80, color: false });
  const lines2 = frameToLines(frame2);
  const block2 = lines2.filter((l) => l.includes("read_file") || l.includes("line1"));
  check("same block: initiation row still shows name+args", block2.some((l) => l.includes("read_file") && l.includes("src/broker.mjs")),
    block2.join("/").slice(0, 300));
  check("same block: result row shows the output", lines2.some((l) => l.includes("line1")),
    block2.join("/").slice(0, 300));

  // --- 3. PENDING-not-started call renders too (initiation precedes the task) ---
  const pv3 = partialView(liveAt({ slots: [] }));
  check("emitted call with no slot yet still visible (pending)", pv3.toolCalls.length === 1 && pv3.toolCalls[0].status === "pending",
    JSON.stringify(pv3.toolCalls));
  const frame3 = renderTui({ seats, turns: [], partial: pv3, health, queueItems: [], width: 80, color: false });
  check("pending block renders in the frame", frameToLines(frame3).some((l) => l.includes("read_file")));

  // --- 4. D40: the live block is NOT a persisted turn --------------------------
  const turns = buildTurns([]); // nothing committed
  check("no committed entries → no tool turns", turns.length === 0, JSON.stringify(turns));
  const frame4 = renderTui({ seats, turns, partial: pv, health, queueItems: [], width: 80, color: false });
  check("the tool block STILL renders with zero settled history (not only-on-settle)",
    frameToLines(frame4).some((l) => l.includes("read_file")));

  // --- 5. Round order preserved with multiple calls ----------------------------
  const pv5 = partialView({
    generation: { attempt: 1, message: { role: "assistant", content: [
      { type: "toolCall", id: "call-a", name: "read_file", arguments: { path: "a.mjs" } },
      { type: "toolCall", id: "call-b", name: "grep", arguments: { pattern: "slot" } },
    ]}},
    tools: [
      { callId: "call-a", name: "read_file", status: "done", output: "done-a" },
      { callId: "call-b", name: "grep", status: "running" },
    ],
  });
  check("multiple calls in message order with per-call status",
    pv5.toolCalls.length === 2 && pv5.toolCalls[0].name === "read_file" && pv5.toolCalls[1].status === "running",
    JSON.stringify(pv5.toolCalls));

  // --- 6. Floor: 60 columns, in-place block intact ------------------------------
  const frame6 = renderTui({ seats, turns: [], partial: pv2, health, queueItems: [], width: 60, color: false });
  check("60-col floor: no line exceeds 60", frameToLines(frame6).every((l) => l.length <= 60));

  console.log(failures === 0
    ? "\nPASS — tool block at initiation; in-place updates; never a persisted turn"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
  failures += 1;
}

process.exit(failures === 0 ? 0 : 1);

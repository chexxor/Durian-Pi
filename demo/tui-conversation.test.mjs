// demo/tui-conversation.test.mjs — the rich conversation view (Enter on a seat).
//
// The gap: the TUI was a read-only dashboard with a preview pane; the operator
// asked to press Enter on a seat to open THAT seat's conversation stream in a rich
// view, with ↑/↓ scrolling and Esc back to the list.
//
// Failing-first: before `renderTui` learned `view: "conversation"` (and the driver
// learned Enter/Esc), the conversation frame did not exist and Enter was ignored.
// Run: node demo/tui-conversation.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { renderTui, frameToLines } from "../src/tui/client.mjs";
import { createUiDriver, decodeKeys } from "../src/tui/driver.mjs";

const seats = [
  { name: "pm", role: "program manager" },
  { name: "impl", role: "implementation engineer" },
];
const turns = [
  { kind: "operator", text: "please build the thing" },
  { kind: "agent", text: "working on it" },
  { kind: "tools", call: { name: "write", args: { path: "x.mjs" } } },
  { kind: "thinking", text: "reasoning about the change" },
  { kind: "agent", text: "done: here is the summary" },
];
const health = { seats, queueItems: [], attention: [] };
const io = () => ({ getSize: () => ({ width: 80, height: 24 }), readState: async () => ({ seats, turns, health, queueItems: [] }), paint: () => {} });

// 1. Conversation frame: the focused seat, its whole stream, no seat list.
const convo = frameToLines(
  renderTui({ seats, turns, health, selectedSeat: "impl", view: "conversation", width: 80, height: 24 }),
).join("\n");
assert.match(convo, /impl · implementation engineer · conversation/, "names the focused seat and the view");
assert.match(convo, /please build the thing/, "shows the operator turn");
assert.match(convo, /working on it/, "shows the agent turn");
assert.match(convo, /reasoning about the change/, "shows the thinking turn");
assert.match(convo, /write/, "shows the tool turn");
assert.ok(!convo.includes("program manager"), "the team-wide seat list is not shown in the conversation view");
assert.match(convo, /Esc=back/, "offers the way back");

// 2. Scrolling: ↑ reports older turns; the window is bounded by height.
const many = Array.from({ length: 40 }, (_, i) => ({ kind: "agent", text: `turn ${i}` }));
const scrolled = frameToLines(
  renderTui({ seats, turns: many, health, selectedSeat: "impl", view: "conversation", width: 80, height: 14, scroll: 5 }),
).join("\n");
assert.match(scrolled, /older turn/, "(↑) reports hidden older turns");
assert.match(scrolled, /newer turn/, "reports the newer turns below the window");
assert.ok(!scrolled.includes("turn 39"), "scrolled back does not show the newest turn");

// 3. The seat list view advertises Enter (and does not show the conversation-only footer).
const list = frameToLines(renderTui({ seats, turns, health, selectedSeat: "impl", view: "seats", width: 80 })).join("\n");
assert.match(list, /Enter=open/, "the seat list advertises Enter");
assert.ok(!list.includes("Esc=back"), "the seat list does not offer Esc=back");

// 4. Driver: Enter -> onEnter; Esc -> onBack when provided, quit when not.
const entered = [];
const driver = createUiDriver({ ...io(), onEnter: () => entered.push("enter") });
driver.handleKey("enter");
assert.deepEqual(entered, ["enter"], "Enter requests the conversation view");

const backed = [];
const exited = [];
const backDriver = createUiDriver({ ...io(), onBack: () => backed.push("back"), onExit: (r) => exited.push(r) });
backDriver.handleKey("\x1b");
assert.deepEqual(backed, ["back"], "Esc is back when onBack is provided");
assert.equal(exited.length, 0, "Esc does not quit when onBack handles it");

const quitDriver = createUiDriver({ ...io(), onExit: (r) => exited.push(r) });
quitDriver.handleKey("\x1b");
assert.deepEqual(exited, ["quit"], "Esc still quits without an onBack (original behavior)");

// 5. Key decoding: Enter and arrows both arrive intact.
assert.deepEqual(decodeKeys("\r"), ["enter"], "Enter (CR) decodes to enter");
assert.deepEqual(decodeKeys("\n"), ["enter"], "Enter (LF) decodes to enter");
assert.deepEqual(decodeKeys("\x1b[A"), ["up"], "arrow up still decodes to up");

await driver.cleanup();
await backDriver.cleanup();
await quitDriver.cleanup();
console.log("TUI CONVERSATION PASS (Enter opens the focused seat's rich view; ↑↓ scroll; Esc backs out)");
process.exit(0);

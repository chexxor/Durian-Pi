// demo/ui-readstate.test.mjs — #1607: the REAL `durian-pi ui` readState closure must RESOLVE.
//
// THE GAP THIS CLOSES: demo/ui-driver.test.mjs injects its OWN readState, so the
// entrypoint's real closure (ui.mjs -> src/tui/readstate.mjs) had no headless coverage.
// The closure referenced `view` as a free variable (declared inside ui.mjs's main try
// block), so every poll threw `ReferenceError: view is not defined` and the TUI painted
// only an error frame. This test builds the REAL closure and calls it.
//
// NEGATIVE CONTROL (pre-fix, demonstrated while landing #1607): with `view` absent from
// the module signature the call below throws `ReferenceError: view is not defined` (RED);
// with `view` passed as the fourth argument it resolves (GREEN).
//
// Run: node demo/ui-readstate.test.mjs  (exit 0 = pass)

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { makeReadState } from "../src/tui/readstate.mjs";
import { createConversationWindow } from "../src/tui/conversation.mjs";
import { createViewMode } from "../src/tui/viewmode.mjs";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}

// An empty rig, read through the SAME path the entrypoint uses. With no broker alive
// `readData` opens this store directly (and creates it), so the closure is exercised
// end-to-end rather than against an injected fake. `readSeatList`/`readQueueItems` see
// no seats and no queue, and `readRigHealth` returns a well-formed empty snapshot.
const dir = mkdtempSync(join(tmpdir(), "durig-1607-"));
const dbPath = join(dir, "empty.sqlite");
const cfg = { DURIG_MAX_CONCURRENT_SEATS: "2" };

function freshUi() {
  return { selectedIndex: 0, navigated: false, seatCount: 0, scroll: 0, focusSeat: null, convId: undefined };
}
const input = { value: "hello", clear() {}, feed() { return {}; } };

try {
  console.log("\n=== #1607: src/tui/readstate.mjs (the REAL readState closure) ===\n");

  check("makeReadState is exported", typeof makeReadState === "function");

  // --- 1. the closure RESOLVES and reports the view it was given --------------
  const view = createViewMode(); // defaults to the seat list
  const readState = await makeReadState(freshUi(), createConversationWindow(), view, { input, cfg, dbPath });
  check("makeReadState returns a poll closure", typeof readState === "function");

  let state;
  let threw = null;
  try {
    state = await readState();
  } catch (err) {
    threw = err;
  }
  check("readState() RESOLVES (no ReferenceError: view is not defined)", threw === null,
    threw ? `${threw?.name}: ${threw?.message}` : "");
  check("readState() returns an object", state !== null && typeof state === "object");
  check("state.view === view.view (seat list)", state?.view === view.view,
    `state.view=${JSON.stringify(state?.view)} view.view=${JSON.stringify(view.view)}`);

  // --- 2. the CONVERSATION view path is exercised too -------------------------
  // `view.view` is read on the conversation branch as well (the other broken line).
  const convView = createViewMode();
  convView.openConversation();
  const convState = await (await makeReadState(freshUi(), createConversationWindow(), convView, { input, cfg, dbPath }))();
  check("state.view === view.view (conversation)", convState.view === "conversation", JSON.stringify(convState.view));

  // --- 3. the INPUT OVERLAY reports its text and never becomes the view -------
  const inputView = createViewMode();
  inputView.enterInput();
  const inputState = await (await makeReadState(freshUi(), createConversationWindow(), inputView, { input, cfg, dbPath }))();
  check("input overlay: state.view stays the underlying view (seats)", inputState.view === "seats", JSON.stringify(inputState.view));
  check("input overlay: state.inputText is the input line's value", inputState.inputText === input.value, JSON.stringify(inputState.inputText));

  // --- 4. the per-seat LIVE reads run as ONE parallel batch ------------------
  // Each `readStore("live")` is a broker round-trip, so the old sequential `await`
  // loop made a single UI frame cost one round-trip PER SEAT. Inject a fake that holds
  // every live read open and records the peak overlap, proving the batch is parallel
  // without needing a live broker. The health read comes from the fake too, so the
  // closure's `health.seats` drives the per-seat reads.
  const seats = [
    { name: "a", conversationId: 1 },
    { name: "b", conversationId: 2 },
    { name: "c", conversationId: 3 },
  ];
  const fakeHealth = { seats, queueItems: [], _pages: {} };
  let inFlight = 0;
  let peak = 0;
  const readStore = async (_db, view) => {
    if (view === "health") return fakeHealth;
    if (view === "live") {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 25));
      inFlight -= 1;
      return {};
    }
    throw new Error(`the fake readStore does not serve view: ${view}`);
  };
  const parallelView = createViewMode();
  const parallelState = await (await makeReadState(freshUi(), createConversationWindow(), parallelView, { input, cfg, dbPath, readStore }))();
  check("per-seat live reads run concurrently (peak overlap === seat count)", peak === seats.length, `peak=${peak} seats=${seats.length}`);
  check("the parallel batch still reports every seat", parallelState.seats.length === seats.length, `seats=${parallelState.seats.length}`);

  console.log(failures === 0
    ? "\nPASS — the REAL readState closure resolves and reports the view it was given"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err?.stack?.slice(0, 400) ?? err);
  failures += 1;
}

rmSync(dir, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
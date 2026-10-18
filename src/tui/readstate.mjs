// src/tui/readstate.mjs — the `durig ui` entrypoint's store-read closure (makeReadState),
// extracted from ui.mjs as a PURE move (item #1607) so the REAL closure has headless
// coverage. Before this, only demo/ui-driver.test.mjs covered the TUI, and it INJECTS a
// fake readState; the entrypoint's own closure had no test, which is how the
// `ReferenceError: view is not defined` bug shipped (every poll threw; the driver painted
// only an error frame).
//
// `view` is a PARAMETER, never a free variable: the entrypoint builds the view-mode state
// (src/tui/viewmode.mjs) INSIDE its main try block, so a module-level closure cannot see
// it. Passing it in is the fix.
//
// Read-only by construction (D11): the closure polls readapi; it opens no harness and
// writes no storage. `input` is the entrypoint's type-to-seat line (src/tui/input.mjs);
// `cfg`/`dbPath` are the entrypoint's resolved config and store path.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

import { readQueueItems, readLiveState, readRigHealth } from "../readapi.mjs";
import { partialView } from "../viewmodel.mjs";
import { SCAN_LIMIT, conversationExhausted } from "../rigstory.mjs";
import { selectSeat, mergeNewest, oldestLoadedId, turnsOf } from "./conversation.mjs";

/**
 * Build the poll closure the driver calls each tick.
 *
 * @param storage  the opened store (read-only reads; D11)
 * @param ui       the entrypoint's selection/scroll state
 * @param conv     the conversation window (src/tui/conversation.mjs)
 * @param view     the view-mode state (src/tui/viewmode.mjs): the view UNDER any input
 *   overlay. Passed POSITIONALLY (not via `deps`) because it was the free variable at
 *   the heart of #1607 — the entrypoint builds it inside its main try block, so a
 *   module-level closure cannot close over it.
 * @param {object} deps  `{ input, cfg, dbPath }` — the entrypoint's input line, resolved
 *   config, and store path.
 */
export async function makeReadState(storage, ui, conv, view, { input, cfg, dbPath } = {}) {
  const slots = Number(cfg?.DURIG_MAX_CONCURRENT_SEATS ?? "");
  const bounded = Number.isFinite(slots) && slots > 0 ? slots : 999;
  return async () => {
    const health = await readRigHealth(storage, dbPath, bounded, { cfg });
    const queueItems = health.queueItems ?? (await readQueueItems(storage));
    // Streaming partials, U2: EVERY actively-generating seat at once (team-wide),
    // keyed off live generation (`partialView(live).hasContent`) — NEVER queue depth.
    const liveBySeat = {};
    let partial = null;
    let streamingSeat = null;
    const partials = [];
    for (const seat of health.seats) {
      liveBySeat[seat.name] = await readLiveState(storage, seat.conversationId);
      const pv = partialView(liveBySeat[seat.name]);
      if (pv?.hasContent) {
        partials.push({ ...pv, seat: seat.name });
        if (streamingSeat === null) {
          streamingSeat = seat.name;
          partial = { ...pv, seat: seat.name };
        }
      }
    }
    // The selected seat drives the transcript. Until the operator navigates,
    // auto-follow the first streaming seat; once they press a nav key — or open a
    // seat's conversation — their choice sticks (r does not steal focus back).
    ui.seatCount = health.seats.length;
    if (!ui.navigated && view.mode === "seats" && streamingSeat !== null) {
      const idx = health.seats.findIndex((s) => s.name === streamingSeat);
      if (idx >= 0) ui.selectedIndex = idx;
    }
    ui.selectedIndex = Math.max(0, Math.min(ui.seatCount - 1, ui.selectedIndex));
    const focusSeat = health.seats[ui.selectedIndex]?.name ?? health.seats[0]?.name;
    ui.focusSeat = ui.seatCount > 0 ? focusSeat : null;
    const focusConvId = health.seats.find((s) => s.name === focusSeat)?.conversationId;
    ui.convId = focusConvId;
    // The detail view's loaded window (ROADMAP 89): the newest page, plus any older
    // pages the operator paged in. A seat switch resets it (a different transcript);
    // the newest page is merged id-keyed each poll, so live turns append at the tail
    // while backfilled history stays put. Exhaustion is UNKNOWN until a short page or
    // an on-demand probe answers — never fabricated, and never part of the shared
    // per-poll scan (a probe runs only while this view is open).
    let turns = [];
    let exhausted = null;
    if (view.view === "conversation" && ui.focusSeat !== null) {
      if (conv.seat !== ui.focusSeat) selectSeat(conv, ui.focusSeat);
      mergeNewest(conv, health._pages?.[ui.focusSeat] ?? [], SCAN_LIMIT);
      if (conv.exhausted === null && focusConvId !== undefined) {
        const oldest = oldestLoadedId(conv);
        if (oldest !== null) {
          conv.exhausted = await conversationExhausted(storage, focusConvId, oldest, BACKGROUND_CONTEXT);
        }
      }
      turns = turnsOf(conv);
      exhausted = conv.exhausted;
    }
    // Clamp the conversation scroll to the turns actually held, so holding ↑ cannot
    // scroll into empty space forever.
    ui.scroll = Math.max(0, Math.min(ui.scroll, Math.max(0, turns.length - 1)));
    return {
      seats: health.seats,
      turns,
      partial,
      partials,
      health,
      queueItems,
      selectedSeat: ui.seatCount > 0 ? focusSeat : null,
      // The view UNDER the overlay, never "input": the input row is an overlay on the
      // current view (ROADMAP 99), so the renderer keeps drawing that view.
      view: view.view,
      scroll: ui.scroll,
      exhausted,
      inputText: view.inputting ? input.value : null,
    };
  };
}

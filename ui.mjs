#!/usr/bin/env node
// ui.mjs — `durig ui`: the interactive TUI entrypoint (U1).
//
// SEPARATE entrypoint on purpose: cli.mjs stays non-interactive (D21) — this file
// never runs as part of a scripted pipeline and always owns the terminal while it
// lives. Read-only viewer: it opens the store the way `watch` does (no harness, no
// scheduling — D11) and polls ≤750 ms; it paints renderTui frames from readapi +
// viewmodel; the in-flight partial is never persisted as a turn (D40; the TUI shows
// it in the streaming row only).
//
// Keyboard is validated on the operator's real Windows terminal (Windows
// Terminal/psmux), not Git Bash. Headless logic lives in src/tui/driver.mjs and is
// covered by demo/ui-driver.test.mjs.
//
// Usage: node ui.mjs [--help]   (reads DURIG_DB / durig.config.json like every other verb)

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "./src/config.mjs";
import { SCAN_LIMIT, readOlderEntries } from "./src/rigstory.mjs";
import { createConversationWindow, selectSeat, turnsOf, loadOlder } from "./src/tui/conversation.mjs";
import { makeReadState } from "./src/tui/readstate.mjs";
import { createUiDriver, decodeKeys } from "./src/tui/driver.mjs";
import { createViewMode } from "./src/tui/viewmode.mjs";
import { createTerminalScreen, PASTE_OFF } from "./src/tui/restore.mjs";
import { createInputLine } from "./src/tui/input.mjs";
import { writeIntent } from "./src/broker.mjs";
import { composeFrame } from "./src/tui/paint.mjs";
import { createSyncState, SYNC_QUERY } from "./src/tui/sync.mjs";

const USAGE = `durig ui — the read-only TUI (polls the store ≤0.75s; renders seats, transcript, streaming, status)

usage:
  node ui.mjs [--help]

keys:
  q / Ctrl+C         quit (terminal is always restored)
  r                  repaint now
  ↑ / ↓ or k / j     seat list: select a seat; conversation: scroll the transcript
                     (at the loaded top, ↑ loads one older page of the seat's log)
  Enter              open the selected seat's conversation stream
  i                  type an intent to the focused seat (Enter=send, Esc=cancel);
                     an overlay on the current view — it never replaces it
  G / End            jump to the live tail (re-enable auto-follow)
  Esc                back to the seat list (press again to quit)

environment:
  DURIG_DB, durig.config.json   which database to watch (same as watch/status)
  NO_COLOR                      disables colour (ASCII fallback in client.mjs)

notes:
  read-only: no harness, no scheduling, no storage writes (D11/D40).
  cli.mjs stays non-interactive (D21).
`;

const { config: CFG } = await loadConfig({ env: process.env, readFile });
const DB_PATH = CFG.DURIG_DB ?? "./rig.sqlite";

/* ───────── terminal ownership ───────── */

// The screen object owns the alt buffer, cursor and raw mode (src/tui/restore.mjs).
// It exists before anything below can throw so every abnormal-exit handler can
// reach it, and its restore() is synchronous and idempotent.
const screen = createTerminalScreen({ stdout: process.stdout, stdin: process.stdin });

// Synchronized output (DECSET 2026): default on for a TTY, turned off by the
// DECRQM reply or DURIG_TUI_NO_SYNC=1. Created here so paintScreen can reach it.
const sync = createSyncState({ isTTY: process.stdout.isTTY, env: process.env });

// The type-to-seat input line (B1). While input mode is active the entrypoint routes
// raw bytes to `input` instead of the key decoder, so a typed `q` is text, not a quit.
// `writeIntent` (D68) is the write substrate: the TUI never opens the store.
const input = createInputLine();
const PASTE_ON = "\x1b[?2004h"; // bracketed paste on; restore.mjs turns it off on exit

/* ───────── paint ───────── */

function paintScreen({ kind, lines, width }) {
  if (kind === "error") {
    // Poll errors go to stderr so the screen the TUI owns stays truthful; the next
    // successful frame replaces everything (same stderr discipline as `watch`).
    process.stderr.write(`${lines.join("\n")}\n`);
    return;
  }
  // Frame: home + clear, then paint, wrapped in DECSET 2026 when supported so the
  // terminal shows the whole frame or none of it (no tearing mid-repaint). Rows
  // beyond the frame's height are clipped by composeFrame.
  process.stdout.write(composeFrame(lines, { height: process.stdout.rows ?? lines.length, sync }));
}

/* ───────── main ───────── */

if (process.argv.includes("--help")) {
  process.stderr.write(USAGE);
  process.exit(0);
}

if (!process.stdout.isTTY) {
  process.stderr.write("durig ui needs a terminal (stdout is not a TTY; use watch/log for piped output)\n");
  process.exit(2);
}

let storage;
try {
  if (!existsSync(DB_PATH)) {
    process.stderr.write(`no store at ${DB_PATH} — run "node cli.mjs up rig.starter.json" first (or set DURIG_DB)\n`);
    process.exit(2);
  }
  storage = await openNodeSqliteStorage(DB_PATH).catch((err) => {
    throw new Error(`cannot open ${DB_PATH}: ${err?.message ?? err}`);
  });

  // Selection is owned here, not in the driver: the driver is a pure key/tick
  // machine, and this entrypoint already owns readState (the seat whose turns
  // are shown). `navigated` latches on the first nav key so auto-follow of a
  // streaming seat never fights the operator's choice; `scroll` counts older turns
  // when in the conversation view.
  const ui = { selectedIndex: 0, navigated: false, seatCount: 0, scroll: 0, focusSeat: null, convId: undefined };
  // The view (seat list | conversation) plus the INPUT OVERLAY state (ROADMAP 99): `i`
  // is an overlay, never a third view, so closing it returns to the view it was opened
  // over. Pure state, in src/tui/viewmode.mjs, so the transitions are testable headlessly.
  const view = createViewMode();
  // The detail view's loaded window (ROADMAP 89): newest page + paged-in older
  // pages, owned by the entrypoint and driven by the keys below.
  const conv = createConversationWindow();
  const readState = await makeReadState(storage, ui, conv, view, { input, cfg: CFG, dbPath: DB_PATH });
  process.stdin.setRawMode(true);
  process.stdin.resume();
  screen.enter();
  // Probe whether the terminal honours DECSET 2026; the reply is consumed in the
  // stdin handler and only ever turns the wrapper OFF.
  if (sync.enabled) process.stdout.write(SYNC_QUERY);

  const driver = createUiDriver({
    getSize: () => ({ width: process.stdout.columns ?? 80, height: process.stdout.rows ?? 24 }),
    readState,
    paint: paintScreen,
    color: !process.env.NO_COLOR,
    pollMs: 700,
    onEnter: () => {
      // Enter opens the selected seat's conversation; Enter again in the conversation
      // view is a no-op (Esc is the way back). Opening resets the loaded window, so
      // the detail view always starts at the newest page for the seat just opened.
      if (view.mode === "seats" && ui.seatCount > 0) {
        view.openConversation();
        ui.scroll = 0;
        selectSeat(conv, ui.focusSeat);
        void driver.tick();
      }
    },
    onBack: () => {
      // Esc leaves the conversation view; at the seat list it quits (the pre-modes
      // behavior), so Esc is never a dead key.
      if (view.view === "conversation") {
        view.closeConversation();
        ui.scroll = 0;
        void driver.tick();
      } else {
        quit();
      }
    },
    onTail: () => {
      // Re-enable auto-follow: scroll 0 pins the newest turns and the live tail.
      ui.scroll = 0;
      void driver.tick();
    },
    onInput: () => {
      // `i` opens the type-to-seat input line; the entrypoint owns the mode.
      enterInput();
    },
    onNavigate: (delta) => {
      if (view.view === "conversation") {
        // ↑ (−1) reveals older turns; ↓ (+1) returns toward the live tail. At the
        // LOADED top, ↑ loads ONE older page instead of a no-op — it does NOT
        // re-anchor to the tail (designer contract §1/§3). loadOlder keeps the
        // first visible turn pinned, so the view does not jump while history grows.
        const loaded = turnsOf(conv);
        const maxScroll = Math.max(0, loaded.length - 1);
        if (delta < 0 && ui.scroll >= maxScroll && ui.convId !== undefined && conv.exhausted !== true) {
          void loadOlder(conv, (oldest) =>
            readOlderEntries(storage, ui.convId, oldest, SCAN_LIMIT, BACKGROUND_CONTEXT),
          ).then(() => driver.tick());
          return;
        }
        ui.scroll = Math.max(0, Math.min(maxScroll, ui.scroll - delta));
      } else {
        ui.navigated = true;
        ui.selectedIndex = Math.max(0, Math.min(ui.seatCount - 1, ui.selectedIndex + delta));
      }
      void driver.tick();
    },
    onExit: () => {
      quit();
    },
  });

  function enterInput() {
    if (ui.seatCount === 0) return; // no seat to address
    if (!view.enterInput()) return; // already open: never clobber the remembered view
    input.clear();
    if (process.stdout.isTTY) process.stdout.write(PASTE_ON);
    void driver.tick();
  }

  function exitInput() {
    // Restore the view the overlay was opened over: a submit/cancel while typing over a
    // conversation lands BACK in that conversation, not on the seat list (ROADMAP 99).
    view.exitInput();
    input.clear();
    if (process.stdout.isTTY) process.stdout.write(PASTE_OFF);
    void driver.tick();
  }

  function submitInput() {
    const text = input.value.trim();
    const to = ui.focusSeat;
    if (text && to) {
      // The intent inbox is the write substrate (D68): the TUI opens no store, and
      // the broker delivers the text as a real operator input to the seat.
      try {
        writeIntent(DB_PATH, { to, from: "operator", content: text, createdAt: new Date().toISOString() });
      } catch (err) {
        process.stderr.write(`durig ui: cannot spool intent: ${err?.message ?? err}\n`);
      }
    }
    exitInput();
  }

  let quitting = false;
  function quit() {
    if (quitting) return;
    quitting = true;
    screen.restore();
    const bye = async () => {
      try {
        await driver.cleanup();
      } finally {
        try {
          await storage.close(BACKGROUND_CONTEXT);
        } catch (err) {
          process.stderr.write(`storage close: ${err?.message ?? err}\n`);
        }
        process.exit(0);
      }
    };
    void bye();
  }

  // One fatal path for every abnormal exit. The screen is restored FIRST so a
  // throw can never leave raw mode or the alt screen behind; restore failures are
  // reported after the cause, because the cause is what the operator needs to read.
  function fatal(err) {
    const { errors } = screen.restore();
    process.stderr.write(`durig ui: ${err?.stack ?? err}\n`);
    for (const e of errors) process.stderr.write(`terminal restore: ${e?.message ?? e}\n`);
    process.exit(1);
  }

  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  process.on("uncaughtException", fatal);
  process.on("unhandledRejection", fatal);
  // The last-resort path for a normal or signal exit that skipped quit(): exit
  // handlers may only do synchronous work, which is exactly what restore() is.
  process.on("exit", () => screen.restore());
  if (typeof process.stdout.on === "function") {
    process.stdout.on("resize", () => driver.tick());
  }
  process.stdin.on("data", (chunk) => {
    const clean = sync.consume(chunk);
    // In input mode every byte is text for the line, not a key: this is what keeps a
    // typed `q` from quitting and a pasted newline from submitting.
    if (view.inputting) {
      const events = input.feed(clean);
      if (events.submitted) submitInput();
      else if (events.cancelled) exitInput();
      else void driver.tick();
      return;
    }
    for (const key of decodeKeys(clean)) {
      if (driver.handleKey(key)) return; // quit requested
    }
  });
  driver.start();
} catch (err) {
  screen.restore();
  process.stderr.write(`durig ui: ${err?.message ?? err}\n`);
  process.exit(1);
}

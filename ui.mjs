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
import { readSeatList, readQueueItems, readLiveState, readRigHealth } from "./src/readapi.mjs";
import { buildTurns, partialView } from "./src/viewmodel.mjs";
import { createUiDriver, decodeKeys } from "./src/tui/driver.mjs";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR = "\x1b[H\x1b[2J";

const USAGE = `durig ui — the read-only TUI (polls the store ≤0.75s; renders seats, transcript, streaming, status)

usage:
  node ui.mjs [--help]

keys:
  q / Ctrl+C         quit (terminal is always restored)
  r                  repaint now
  ↑ / ↓ or k / j     seat list: select a seat; conversation: scroll the transcript
  Enter              open the selected seat's conversation stream
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

/* ───────── readState (read-only store reads; D11 poll) ───────── */

async function makeReadState(storage, ui) {
  const slots = Number(CFG.DURIG_MAX_CONCURRENT_SEATS ?? "");
  const bounded = Number.isFinite(slots) && slots > 0 ? slots : 999;
  return async () => {
    const health = await readRigHealth(storage, DB_PATH, bounded, { cfg: CFG });
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
    if (!ui.navigated && ui.mode === "seats" && streamingSeat !== null) {
      const idx = health.seats.findIndex((s) => s.name === streamingSeat);
      if (idx >= 0) ui.selectedIndex = idx;
    }
    ui.selectedIndex = Math.max(0, Math.min(ui.seatCount - 1, ui.selectedIndex));
    const focusSeat = health.seats[ui.selectedIndex]?.name ?? health.seats[0]?.name;
    let turns = [];
    if (liveBySeat[focusSeat]?.conversationId !== undefined && health._pages?.[focusSeat]) {
      turns = buildTurns(health._pages[focusSeat]);
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
      view: ui.mode,
      scroll: ui.scroll,
    };
  };
}

/* ───────── terminal ownership ───────── */

let restored = false;
let altBuffer = false;
function enterScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write(ENTER_ALT + HIDE_CURSOR + CLEAR);
  altBuffer = true;
}
function restoreScreenOnce() {
  if (restored) return;
  restored = true;
  if (altBuffer) {
    process.stdout.write(SHOW_CURSOR + CLEAR + LEAVE_ALT);
    altBuffer = false;
  }
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // stdin may already be closed on an abnormal exit; nothing further to restore.
    }
  }
}

/* ───────── paint ───────── */

function paintScreen({ kind, lines, width }) {
  if (kind === "error") {
    // Poll errors go to stderr so the screen the TUI owns stays truthful; the next
    // successful frame replaces everything (same stderr discipline as `watch`).
    process.stderr.write(`${lines.join("\n")}\n`);
    return;
  }
  // Frame: home + clear, then paint. Rows beyond the frame's height are lost — a
  // fresh frame always fully covers (small heights are the 60-col/24-row floor case).
  process.stdout.write(CLEAR);
  const height = process.stdout.rows ?? lines.length;
  for (let i = 0; i < Math.min(lines.length, height); i++) {
    process.stdout.write(`${i > 0 ? "\r\n" : ""}${lines[i]}`);
  }
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
  // streaming seat never fights the operator's choice; `mode` is the seat list or
  // the selected seat's focused conversation; `scroll` counts older turns when in
  // the conversation view.
  const ui = { selectedIndex: 0, navigated: false, seatCount: 0, mode: "seats", scroll: 0 };
  const readState = await makeReadState(storage, ui);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  enterScreen();

  const driver = createUiDriver({
    getSize: () => ({ width: process.stdout.columns ?? 80, height: process.stdout.rows ?? 24 }),
    readState,
    paint: paintScreen,
    color: !process.env.NO_COLOR,
    pollMs: 700,
    onEnter: () => {
      // Enter opens the selected seat's conversation; Enter again in the conversation
      // view is a no-op (Esc is the way back).
      if (ui.mode === "seats" && ui.seatCount > 0) {
        ui.mode = "conversation";
        ui.scroll = 0;
        void driver.tick();
      }
    },
    onBack: () => {
      // Esc leaves the conversation view; at the seat list it quits (the pre-modes
      // behavior), so Esc is never a dead key.
      if (ui.mode === "conversation") {
        ui.mode = "seats";
        ui.scroll = 0;
        void driver.tick();
      } else {
        quit();
      }
    },
    onNavigate: (delta) => {
      if (ui.mode === "conversation") {
        // ↑ (−1) reveals older turns; ↓ (+1) returns toward the live tail.
        ui.scroll = Math.max(0, ui.scroll - delta);
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

  let quitting = false;
  function quit() {
    if (quitting) return;
    quitting = true;
    restoreScreenOnce();
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

  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  if (typeof process.stdout.on === "function") {
    process.stdout.on("resize", () => driver.tick());
  }
  process.stdin.on("data", (chunk) => {
    for (const key of decodeKeys(chunk)) {
      if (driver.handleKey(key)) return; // quit requested
    }
  });
  driver.start();
} catch (err) {
  restoreScreenOnce();
  process.stderr.write(`durig ui: ${err?.message ?? err}\n`);
  process.exit(1);
}

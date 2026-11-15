// src/fleetledger.mjs — the ONE derivation of the fleet LEDGER's burn-rate verdict.
//
// WHY THIS EXISTS (2026-11-15, the queue-backlog tranche, ROADMAP 380 / D315). "Is the backlog shrinking?"
// is a RATE question, and two surfaces already answer it in two spellings: `tools/backlog-burn.mjs` computed
// the delta inline, and `src/checkup.mjs` had to QUOTE that verdict (goal task-7: the `queue-pressure` finding
// must quote the tool's own words, not paraphrase them). A second spelling of "rows closed / open rows / GROWING"
// is the #5047 pair-of-spellings defect this tranche exists to close: the gate and the instrument drift apart
// and both read as correct. So the arithmetic lives here, once, and the CLI, the `check` rule and the promoted
// census tool all call it.
//
// WHAT IT READS. `tools/broker-keepalive.mjs:272` appends one JSONL snapshot per 10th broker tick to
// `.spike/fleet-ledger.jsonl` — a line carrying a `queue` object of per-status counts. It is the fleet's own
// record, not a second store. The ledger is gitignored and append-only, so its absence is normal and its
// staleness is normal: `broker-serve` does not append while the broker is DOWN (measured 2026-11-15: the last
// snapshot was dated 2026-11-13 while the store-wide rate moved +719 rows over 7 d). A caller that cannot read
// it gets `ok: false` with a reason, and the rule that wanted the quote says so — an unreadable cross-check is
// never reported as a pass.
//
// PURE, WHERE IT MATTERS: `fleetLedgerVerdict` is a function over TEXT, no fs, no git, no store — that is what
// lets `src/checkup.mjs` stay fs-free (its proving demos pass a fixture string) and what keeps this module off
// the runtime-dependency graph that a conflicted `checkup.mjs` once made fatal to the whole CLI load (2026-10-17,
// lead #1164). The fs work is the separate `readFleetLedger`, and it is BOUNDED: the ledger grows forever, so
// only the newest `maxBytes` are read and a truncated read says so rather than pretending to be a whole ledger.

import { existsSync, openSync, readSync, closeSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The statuses a keepalive snapshot counts, in the order the tool prints them. Terminal first, then live. */
export const LEDGER_STATES = ["done", "cancelled", "held", "deferred", "claimed", "queued"];

/** Live (non-terminal) rows in one snapshot — the backlog this module answers a RATE question about. */
export const LIVE_STATES = ["held", "deferred", "claimed", "queued"];

export const FLEET_LEDGER_DEFAULT = join(".spike", "fleet-ledger.jsonl");
/** The tail bound on a read: the ledger is append-only, so the NEWEST bytes are the ones that answer the
 * question. A read that hits the bound is reported, not silently treated as the whole ledger. Sized so a
 * normal ledger reads WHOLE (measured 2026-11-15: the live ledger is 325,822 B / 1,191 lines, 0.04 s); the
 * bound is growth protection, not the unit of work. */
export const FLEET_LEDGER_MAX_BYTES = 4_194_304;

/** Total of the counted statuses in one snapshot. Unknown keys are not counted: a snapshot that starts
 * carrying a new status without this module knowing is a finding for the tool, not a silent sum. */
export function queueTotals(q) {
  return LEDGER_STATES.reduce((a, k) => a + (Number(q?.[k]) || 0), 0);
}

/**
 * Derive the burn-rate verdict from the RAW JSONL text of the ledger. Returns `null` when the text holds no
 * queue snapshot (the caller then reports "no snapshots", which is not a verdict).
 *
 * `hours` 0 means "the whole ledger", which is `tools/backlog-burn.mjs`'s default; `check` uses the same
 * default so the quoted words are the words the tool prints by default.
 */
export function fleetLedgerVerdict(text, { hours = 0, now = Date.now() } = {}) {
  if (typeof text !== "string") return null;
  const snaps = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try {
      o = JSON.parse(t);
    } catch {
      malformed += 1;
      continue;
    }
    if (o && o.queue) snaps.push(o);
  }
  if (!snaps.length) return null;

  const cut = hours > 0 ? now - hours * 3_600_000 : 0;
  const window = snaps.filter((s) => new Date(s.at).getTime() >= cut);
  // An older-than-the-window ledger still has to answer the question, not crash — but it says which window it
  // actually answered.
  const fellBack = window.length === 0;
  const win = fellBack ? snaps : window;
  const first = win[0];
  const last = win[win.length - 1];
  const spanMins = Math.round((new Date(last.at) - new Date(first.at)) / 60_000);
  const closedOf = (s) => Number(s.queue?.done ?? 0) + Number(s.queue?.cancelled ?? 0);
  const openOf = (s) => LIVE_STATES.reduce((a, k) => a + Number(s.queue?.[k] ?? 0), 0);

  const closedDelta = closedOf(last) - closedOf(first);
  const openDelta = openOf(last) - openOf(first);
  const rowsDelta = queueTotals(last.queue) - queueTotals(first.queue);
  // The word the operator's complaint turns into a rule: open rows going UP is GROWING, whatever the tool
  // is doing in between.
  const direction = openDelta > 0 ? "GROWING" : openDelta < 0 ? "shrinking" : "flat";
  const sign = (n) => (n >= 0 ? "+" : "") + n;
  const verdictLine = `${closedDelta} rows closed, ${sign(openDelta)} open rows in the window -> backlog ${direction}`;
  return {
    ok: true,
    snapshots: snaps.length,
    inWindow: win.length,
    fellBack,
    malformed,
    firstAt: first.at,
    lastAt: last.at,
    spanMins,
    windowLabel: hours > 0 ? `${hours} h` : "whole ledger",
    closedDelta,
    openDelta,
    rowsDelta,
    perHourClosed: spanMins > 0 ? closedDelta / (spanMins / 60) : 0,
    perHourOpen: spanMins > 0 ? openDelta / (spanMins / 60) : 0,
    direction,
    verdictLine,
    // How long the newest snapshot predates this measurement — the honest "the fleet stops recording while
    // the broker is down" number, so a stale ledger cannot be read as a current verdict.
    staleMins: Math.max(0, Math.round((now - new Date(last.at).getTime()) / 60_000)),
    first,
    last,
  };
}

/**
 * Read the ledger's newest `maxBytes` under `root`. Returns `{ ok, path, reason?, text, truncated }` — a
 * record, never a bare string, because "could not read" and "read an empty ledger" are different facts and
 * the rule that quotes it must say which.
 */
export function readFleetLedger({ root = process.cwd(), path = FLEET_LEDGER_DEFAULT, maxBytes = FLEET_LEDGER_MAX_BYTES } = {}) {
  const file = join(root, path);
  const record = { ok: false, path: file, relative: path, text: "", truncated: false, bytes: 0 };
  if (!existsSync(file)) {
    record.reason = `no fleet ledger at ${file}`;
    return record;
  }
  let size;
  try {
    size = statSync(file).size;
  } catch (err) {
    record.reason = `the fleet ledger could not be sized: ${err?.message ?? err}`;
    return record;
  }
  record.bytes = size;
  if (size === 0) {
    record.ok = true;
    record.reason = "the ledger file is empty";
    return record;
  }
  if (size <= maxBytes) {
    try {
      record.text = readFileSync(file, "utf8");
      record.ok = true;
    } catch (err) {
      record.reason = `the fleet ledger could not be read: ${err?.message ?? err}`;
    }
    return record;
  }
  // Tail read: the newest bytes, minus whatever partial line the cut landed inside.
  const fd = openSync(file);
  try {
    const take = size - maxBytes;
    const buf = Buffer.alloc(maxBytes);
    // node fs.readSync(fd, buffer, offsetInBuffer, positionInFile, bytesToRead) — the argument order is the
    // trap: a `position`/`len` swap reads from the wrong end and returns the wrong byte count.
    readSync(fd, buf, 0, take, maxBytes);
    closeSync(fd);
    const s = buf.toString("utf8");
    const nl = s.indexOf("\n");
    record.text = nl < 0 ? "" : s.slice(nl + 1);
    record.truncated = true;
    record.ok = true;
    record.headDropped = take;
  } catch (err) {
    closeSync(fd);
    record.reason = `the fleet ledger tail could not be read: ${err?.message ?? err}`;
  }
  return record;
}

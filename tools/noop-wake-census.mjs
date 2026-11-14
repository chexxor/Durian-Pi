// tools/noop-wake-census.mjs - count wake decisions in a broker log: which passes woke a seat,
// which refused a wake, and why. Severity for the no-op-wake class (#6959) comes from these
// numbers, not from a remembered count.
//
// The log is `<db>.broker.log` (src/broker.mjs logBrokerLine, D46): one ISO-timestamped line per
// event. A resident broker run is delimited by `START pid=<n>` ... `EXIT pid=<n> reason=...`.
// A non-wake is ALWAYS a `SKIP <seat> reason=<code>` line (wakeSkipLine, #6101); a wake is the
// `woke=` list on a `PASS` line. So the census needs no store and no harness - it reads one file.
//
// Run: node tools/noop-wake-census.mjs --log selfdev.sqlite.broker.log [--sessions N] [--json out.json]
// Exit 0 = census produced; exit 1 = the log is missing or unreadable.
import { readFileSync, writeFileSync } from "node:fs";

// Reasons are grouped by what they MEAN for the wake decision, never by their spelling: a gate
// reason carries the gate id (`queued-gated:gate-open:#6508(queued)`), and the class is the class.
const CLASS = {
  "queued-gated": "gated",
  "parked-deduped": "deduped",
  cooldown: "cooldown",
  pending: "pending",
  busy: "busy",
  "no-work": "no-work",
};
export function classify(reason) {
  const head = reason.split(":")[0];
  return CLASS[head] ?? "other";
}

export function parseSessions(lines) {
  const sessions = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^(\S+)\s(.*)$/);
    if (!m) continue;
    const [, ts, text] = m;
    const start = text.match(/^START pid=(\d+)/);
    if (start) {
      cur = { pid: Number(start[1]), start: ts, end: null, passes: 0, wakeEvents: 0, wakeLines: 0, skips: 0, reasons: {}, classes: {}, seats: {}, parked: {} };
      sessions.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^EXIT /.test(text)) cur.end = ts;
    const pass = text.match(/^PASS (\d+) ms=(\d+) woke=(.*)$/);
    if (pass) {
      cur.passes += 1;
      const seats = (pass[3] ?? "").split(",").filter((s) => s && s !== "-");
      cur.wakeEvents += seats.length;
      continue;
    }
    const skip = text.match(/^SKIP (\S+) reason=(\S+)/);
    if (skip) {
      const [, seat, reason] = skip;
      cur.skips += 1;
      cur.reasons[reason] = (cur.reasons[reason] ?? 0) + 1;
      const cls = classify(reason);
      cur.classes[cls] = (cur.classes[cls] ?? 0) + 1;
      const key = `${seat}:${cls}`;
      cur.seats[key] = (cur.seats[key] ?? 0) + 1;
      continue;
    }
    const parked = text.match(/^PARKED-WAKE seat=(\S+) reason=(\S+)/);
    if (parked) cur.parked[parked[2]] = (cur.parked[parked[2]] ?? 0) + 1;
    if (/^WAKE [^ ]+$/.test(text)) cur.wakeLines += 1;
  }
  return sessions;
}

export function census(lines) {
  const sessions = parseSessions(lines);
  const totals = sessions.reduce(
    (a, s) => ({
      passes: a.passes + s.passes,
      wakeEvents: a.wakeEvents + s.wakeEvents,
      wakeLines: a.wakeLines + s.wakeLines,
      skips: a.skips + s.skips,
      classes: Object.fromEntries(
        Array.from(new Set([...Object.keys(a.classes), ...Object.keys(s.classes)])).map((k) => [k, (a.classes[k] ?? 0) + (s.classes[k] ?? 0)]),
      ),
    }),
    { passes: 0, wakeEvents: 0, wakeLines: 0, skips: 0, classes: {} },
  );
  return { sessions, totals };
}

function main() {
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const logPath = get("--log") ?? "selfdev.sqlite.broker.log";
const limit = Number(get("--sessions") ?? 5);
let text;
try {
  text = readFileSync(logPath, "utf8");
} catch (err) {
  console.error(`cannot read log ${logPath}: ${err.message}`);
  return 1;
}
const lines = text.split("\n").filter((l) => l.trim() !== "");
const { sessions, totals } = census(lines);
const window = sessions.slice(-limit);
const windowTotals = window.reduce(
  (a, s) => ({
    passes: a.passes + s.passes,
    wakeEvents: a.wakeEvents + s.wakeEvents,
    wakeLines: a.wakeLines + s.wakeLines,
    skips: a.skips + s.skips,
    classes: Array.from(new Set([...Object.keys(a.classes), ...Object.keys(s.classes)])).reduce((m, k) => { m[k] = (a.classes[k] ?? 0) + (s.classes[k] ?? 0); return m; }, {}),
  }),
  { passes: 0, wakeEvents: 0, wakeLines: 0, skips: 0, classes: {} },
);
const stamp = new Date().toISOString();
console.log(`NO-OP WAKE CENSUS  ${stamp}  log=${logPath}  lines=${lines.length}  sessions=${sessions.length}`);
for (const s of window) {
  console.log(`  pid=${s.pid} start=${s.start} end=${s.end ?? "(running)"} passes=${s.passes} wakes=${s.wakeLines} (PASS woke= says ${s.wakeEvents}) skip-events=${s.skips}`);
  for (const [cls, n] of Object.entries(s.classes).sort((a, b) => b[1] - a[1])) console.log(`    ${cls}: ${n}`);
  for (const [reason, n] of Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`      ${reason} = ${n}`);
  const parked = Object.entries(s.parked).map(([k, v]) => `${k}=${v}`).join(", ");
  if (parked) console.log(`    parked-wake decisions: ${parked}`);
    for (const [key, n] of Object.entries(s.seats).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    seat ${key} = ${n}`);
}
console.log(`WINDOW (last ${window.length} sessions): passes=${windowTotals.passes} wakes=${windowTotals.wakeLines} skip-events=${windowTotals.skips}`);
for (const [cls, n] of Object.entries(windowTotals.classes).sort((a, b) => b[1] - a[1])) console.log(`  ${cls}: ${n}`);
if (windowTotals.skips > 0) {
  const refused = windowTotals.skips - (windowTotals.classes.pending ?? 0) - (windowTotals.classes.busy ?? 0) - (windowTotals.classes.cooldown ?? 0);
  console.log(`  wake decisions that woke nothing, excluding seats already mid-work (pending/busy/cooldown): ${refused}`);
  console.log(`  share of all wake decisions that woke nothing: ${((windowTotals.skips / (windowTotals.skips + windowTotals.wakeLines)) * 100).toFixed(1)}%`);
}
console.log(`WHOLE LOG (${sessions.length} sessions): passes=${totals.passes} wakes=${totals.wakeLines} skip-events=${totals.skips}`);
for (const [cls, n] of Object.entries(totals.classes).sort((a, b) => b[1] - a[1])) console.log(`  ${cls}: ${n}`);
const out = get("--json");
if (out) writeFileSync(out, JSON.stringify({ generatedAt: stamp, log: logPath, sessions: window, windowTotals, totals }, null, 2) + "\n");
return 0;
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());

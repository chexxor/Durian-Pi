#!/usr/bin/env node
// tools/held-gate-audit.mjs — which parked rows are STALE, fleet-wide, in one read (#6071).
//
// WHY. `cli.mjs queue --held --with-gates` (#5770) answers "was a gate recorded?". It cannot answer
// "is the gate still closed?" - so 459 held rows sit on gates that finished months ago and nothing in
// status/attention says so. This tool answers the second question, seat by seat, and names the real
// condition for the rows that are legitimately parked (a trigger, a date, a branch that must land).
//
// IT PROPOSES, IT NEVER ACTS. Releasing, cancelling and routing are `pm`'s transitions
// (docs/runbooks/stale-held-backlog.md §Do). Output is a routing fact, not a transition.
//
// Usage:
//   node tools/held-gate-audit.mjs [--db ./selfdev.sqlite] [--json <out.json>] [--limit 25]
//                                  [--seat <name>] [--ids <id> ...]
//   --db defaults to $DURIG_DB, else ./selfdev.sqlite. The read is broker-served (D111) when a broker
//   is alive; with no broker it falls back to a read-only harness open on THAT file. If the broker is
//   wedged and the read times out, audit a COPY (`cp selfdev.sqlite /tmp/audit.sqlite`) - a copy has
//   no broker state, so the fallback is safe; never open a second Harness on the live store.
// Exit: 0 always on a successful read; 1 if the store cannot be opened or the read fails.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readData } from "../src/readclient.mjs";
import { readQueueItems } from "../src/readapi.mjs";
import { auditHeldRows } from "../src/heldgate.mjs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);

function opt(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}

async function main() {
  const db = opt("db", process.env.DURIG_DB || "./selfdev.sqlite");
  const limit = Math.max(1, Number(opt("limit", 25)) || 25);
  const seat = opt("seat", null);
  const jsonOut = opt("json", null);
  const onlyIds = argv.filter((a) => !a.startsWith("--")).map(Number).filter((n) => Number.isInteger(n) && n > 0);

  let items;
  try {
    items = await readData(db, "queue", {}, (storage) => readQueueItems(storage));
  } catch (err) {
    console.error(`held-gate-audit: cannot read the queue from ${db}: ${err.message}`);
    console.error("If the broker is wedged, copy the store and audit the copy: cp selfdev.sqlite /tmp/audit.sqlite");
    return 1;
  }

  // ONE git read: which items have a "merge: land item-<id>" commit on main. A landing gate's closure
  // is a git fact, not a queue status - prose that says "until #5211's branch lands" is not resolved by
  // #5211's row being `done`.
  let landed = new Map();
  try {
    const log = execFileSync("git", ["log", "--format=%h %s", "refs/heads/main"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const line of log.split("\n")) {
      const m = line.match(/land item-(\d+)/i);
      if (m && !landed.has(Number(m[1]))) landed.set(Number(m[1]), line.split(" ")[0]);
    }
  } catch (err) {
    console.error(`held-gate-audit: git unavailable (${err.message}); landing gates will be reported as unproven`);
  }

  const statusMap = new Map(items.map((i) => [i.id, i.status]));
  const statusOf = (id) => statusMap.get(id) ?? "absent";
  const satisfied = new Map();
  const facts = {
    statusOf,
    landedOnMain: (id) => landed.get(id) ?? null,
    artifactSatisfied: (p, ms) => {
      const key = `${p}|${ms.join("~")}`;
      if (!satisfied.has(key)) satisfied.set(key, artifactSatisfied(p, ms));
      return satisfied.get(key);
    },
  };

  const report = auditHeldRows(items, facts);
  const rows = seat ? report.rows.filter((r) => r.to === seat) : report.rows;
  const scoped = onlyIds.length ? rows.filter((r) => onlyIds.includes(r.id)) : rows;

  const byClass = {};
  const bySeat = {};
  for (const r of scoped) {
    byClass[r.class] = (byClass[r.class] ?? 0) + 1;
    const s = bySeat[r.to] ?? (bySeat[r.to] = {});
    s[r.class] = (s[r.class] ?? 0) + 1;
  }

  const heldSince = (id) => {
    const item = statusMap.get(id) === "held" ? items.find((i) => i.id === id) : null;
    const events = (item?.transitions ?? []).filter((t) => t?.event === "held" && t?.at);
    const at = events.length ? events[events.length - 1].at : item?.block?.since;
    return at ? new Date(at) : null;
  };

  const age = (r) => {
    const since = heldSince(r.id);
    return since ? Math.floor((Date.now() - since.getTime()) / 86400000) : null;
  };

  const order = ["release-candidate", "cancel-candidate", "standing-rule", "gate-open", "unattributed"];
  console.log(`HELD-ROW GATE AUDIT  db=${db}  rows=${report.totalRows}  held=${report.held}  at=${new Date().toISOString()}`);
  console.log(`git landing commits read: ${landed.size}`);
  console.log("");
  for (const cls of order) {
    const list = scoped.filter((r) => r.class === cls);
    if (!list.length) {
      console.log(`${cls}: 0`);
      continue;
    }
    const ids = list.map((r) => r.id);
    const shown = ids.slice(0, limit).join(", ");
    console.log(`${cls}: ${list.length}  [${shown}${ids.length > limit ? `, …+${ids.length - limit} more` : ""}]`);
  }
  console.log("");
  console.log("per seat (release / cancel / standing / gate-open / unattributed):");
  for (const [s, counts] of Object.entries(bySeat).sort((a, b) => sum(b[1]) - sum(a[1]))) {
    console.log(`  ${s}: ${order.map((c) => counts[c] ?? 0).join(" / ")}`);
  }
  console.log("");
  console.log(`the ${Math.min(15, scoped.filter((r) => r.class === "release-candidate").length)} oldest release candidates, with the evidence the class rests on:`);
  for (const r of scoped.filter((x) => x.class === "release-candidate").sort((a, b) => (age(b) ?? 0) - (age(a) ?? 0)).slice(0, 15)) {
    console.log(`  #${r.id} -> ${r.to}  held ${age(r) ?? "?"}d  ${r.condition}  | ${r.evidence.join("; ")}`);
  }
  console.log("");
  console.log("No row is released, cancelled or routed here. Send the list to `pm` (intent.mjs), which holds the transitions.");

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ db, at: new Date().toISOString(), held: report.held, byClass, bySeat, rows: scoped }, null, 2) + "\n");
    console.log(`full classification written to ${jsonOut}`);
  }
  return 0;
}

function sum(o) {
  return Object.values(o).reduce((a, b) => a + b, 0);
}

function artifactSatisfied(p, markers) {
  const abs = join(REPO_ROOT, p);
  if (!existsSync(abs)) return false;
  if (!markers.length) return true;
  try {
    const text = readFileSync(abs, "utf8").toLowerCase();
    return markers.some((m) => text.includes(m.toLowerCase()));
  } catch {
    return false;
  }
}

main().then((code) => process.exit(code));

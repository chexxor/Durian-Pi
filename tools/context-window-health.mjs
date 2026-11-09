#!/usr/bin/env node
// tools/context-window-health.mjs — the context-window lens on the same census.
//
// Promoted from `.spike/delegate/context-window-health.mjs` (#5789). It shares src/fleethealth.mjs with
// tools/fleet-health.mjs on purpose: one counting mechanism, two questions. This lens answers "is the fleet
// running OUT OF WINDOW?" — generations per conversation, compaction attempts and their failure families, and
// the one signature that means a window was exceeded: "Summarization hit the token limit; the summary is
// incomplete".
//
// Why the lens is separate: the two failure directions look identical from a single outcome count. A seat
// that fails because the window is full needs a reset/compact; a seat that fails because durig's own spend
// cap refused the call needs a cap decision. Counting them together hides the remedy.
//
// Usage: node tools/context-window-health.mjs [--db <path>] [--since-min 720] [--all-time] [--seat-map <json>]
//        [--json] [--strict] [--top 10]
// Exit: 0 normally; 1 if the store cannot be opened, or --strict and window-class failures exist.

import { pathToFileURL } from "node:url";
import { readFleetHealth, readSeatMap } from "../src/fleethealth.mjs";

function parseArgs(argv) {
  const out = { db: process.env.DURIG_DB || "./selfdev.sqlite", sinceMin: 720, allTime: false, strict: false, json: false, seatMap: null, top: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") out.db = argv[++i];
    else if (a === "--since-min") out.sinceMin = Number(argv[++i]);
    else if (a === "--all-time") out.allTime = true;
    else if (a === "--seat-map") out.seatMap = argv[++i];
    else if (a === "--strict") out.strict = true;
    else if (a === "--json") out.json = true;
    else if (a === "--top") out.top = Number(argv[++i]);
    else if (a === "--help") { console.log("usage: node tools/context-window-health.mjs [--db <path>] [--since-min N] [--all-time] [--seat-map <json>] [--json] [--strict] [--top N]"); return null; }
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return 0;
  let health;
  try {
    health = readFleetHealth(args.db, { sinceMin: args.allTime ? null : args.sinceMin, seatMap: readSeatMap(args.seatMap) });
  } catch (err) {
    console.error(`context-window-health: cannot read ${args.db}: ${err.message}`);
    return 1;
  }

  const windowPressure = health.compaction.failureClasses.filter((f) => f.family === "token-limit-incomplete-summary" || f.family === "timeout");
  const payload = {
    db: args.db,
    windowMinutes: args.allTime ? null : args.sinceMin,
    generations: health.generations,
    compaction: health.compaction,
    incompleteSummary: health.incompleteSummary,
    windowPressure,
    verdict: windowPressure.length === 0 ? "no window-class failures in the window" : `${windowPressure.reduce((n, f) => n + f.count, 0)} window-class failure(s) across ${windowPressure.length} family(ies)`,
  };

  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    const g = health.generations;
    console.log(`context-window health ${args.db} window=${args.allTime ? "all time" : args.sinceMin} min`);
    console.log(`generations: total=${g.total} completed=${g.completed} failed=${g.failed} aborted=${g.aborted} in-flight=${g.inFlight}`);
    console.log(`compaction: attempted=${health.compaction.total} completed=${health.compaction.completed} failed=${health.compaction.failed} incompleteSummaries=${health.incompleteSummary}`);
    for (const s of health.compaction.bySeat.slice(0, args.top)) console.log(`  ${s.seat}: compacted=${s.completed} failed=${s.failed}`);
    console.log(`verdict: ${payload.verdict}`);
    for (const f of windowPressure.slice(0, args.top)) console.log(`  ${f.family}: ${f.count} — conversations [${f.conversations.join(",")}]`);
  }

  if (args.strict && windowPressure.reduce((n, f) => n + f.count, 0) > 0) {
    console.error(`context-window-health: --strict — window-class failures present`);
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());

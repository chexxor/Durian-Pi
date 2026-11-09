#!/usr/bin/env node
// tools/fleet-health.mjs — the fleet's outcome census, straight from the store.
//
// Promoted from the working `.spike/delegate/fleet-health.mjs` probe (#5789); the counting lives in
// src/fleethealth.mjs so the demo can pin it and the two lenses cannot drift. Read-only (`node:sqlite`,
// `readOnly: true`): no harness, no ownership, no model spend, so it answers while the broker is wedged.
//
// WHAT IT ANSWERS. (1) Did generations complete or fail, per conversation? (2) Which FAILURE FAMILIES are
// present, how many of each, and WHERE they came from. (3) Is compaction failing, and is the failure the
// token-limit class ("Summarization hit the token limit; the summary is incomplete")? That third question is
// the acceptance test for ROADMAP 331: after the fix, the count must STOP GROWING, which is only checkable
// if something counts it in a window.
//
// Usage: node tools/fleet-health.mjs [--db <path>] [--since-min 360] [--all-time] [--seat-map <json>]
//        [--json] [--strict] [--limit 15]
//   --db defaults to $DURIG_DB, else ./selfdev.sqlite.
//   --seat-map <json>: {"<conversationId>": "<seatName>"} or [{"name": "...", "conversationId": n}].
//   --strict: exit 1 if ANY compaction failure is in the window (a gate, not a report).
// Exit: 0 normally; 1 if the store cannot be opened, or --strict and compaction failures exist.

import { pathToFileURL } from "node:url";
import { readFleetHealth, readSeatMap } from "../src/fleethealth.mjs";

function parseArgs(argv) {
  const out = { db: process.env.DURIG_DB || "./selfdev.sqlite", sinceMin: 360, allTime: false, strict: false, json: false, seatMap: null, limit: 15 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") out.db = argv[++i];
    else if (a === "--since-min") out.sinceMin = Number(argv[++i]);
    else if (a === "--all-time") out.allTime = true;
    else if (a === "--seat-map") out.seatMap = argv[++i];
    else if (a === "--strict") out.strict = true;
    else if (a === "--json") out.json = true;
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--help") { console.log("usage: node tools/fleet-health.mjs [--db <path>] [--since-min N] [--all-time] [--seat-map <json>] [--json] [--strict] [--limit N]"); return null; }
    else { throw new Error(`unknown argument: ${a}`); }
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
    console.error(`fleet-health: cannot read ${args.db}: ${err.message}`);
    return 1;
  }

  if (args.json) {
    console.log(JSON.stringify(health, null, 2));
  } else {
    const window = args.allTime ? "all time" : `last ${args.sinceMin} min`;
    console.log(`fleet health ${args.db} window=${window}`);
    const g = health.generations;
    console.log(`generations: total=${g.total} completed=${g.completed} failed=${g.failed} aborted=${g.aborted} in-flight=${g.inFlight}`);
    for (const s of g.bySeat.slice(0, args.limit)) console.log(`  ${s.seat}: ok=${s.completed} failed=${s.failed} aborted=${s.aborted} in-flight=${s.inFlight}`);
    const c = health.compaction;
    console.log(`compaction: total=${c.total} completed=${c.completed} failed=${c.failed} in-flight=${c.inFlight}; token-limit-incomplete=${health.incompleteSummary}`);
    for (const f of c.failureClasses.slice(0, args.limit))
      console.log(`  family=${f.family} count=${f.count} reason=${f.reason ?? "-"} seats=[${f.seats.join(",")}] conversations=[${f.conversations.join(",")}] first=${new Date(f.firstAt).toISOString()} last=${new Date(f.lastAt).toISOString()}`);
    if (!health.seatsResolved && !args.seatMap)
      console.log("note: seat names are not in the store's task rows; rows are attributed by conversation id. Pass --seat-map <json> for names.");
  }

  if (args.strict && health.compaction.failed > 0) {
    console.error(`fleet-health: --strict — ${health.compaction.failed} compaction failure(s) in the window`);
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());

#!/usr/bin/env node
// intent.mjs — `durig intent`: deliver a message to a seat WITHOUT opening the store.
//
// Why a separate entrypoint (like `ui.mjs`, D21): the resident broker is the single
// store writer. A `send` opens its own harness, so routing intent while the broker
// drives needs `serve --stop`, which interrupts in-flight runs. This producer never
// touches the store — it writes one intent file to `<db>.broker.inbox/`, and the
// broker drains it on its next pass and submits it as a real operator input. Safe to
// run while the broker drives; no second writer, no stop.
//
// Usage:
//   node intent.mjs <seat> --body-file <path>      # or --body-file - for stdin
//   node intent.mjs <seat> --body-file <path> --request-id <id>
//
// Reads DURIG_DB / durig.config.json like every other verb.

import { readFile } from "node:fs/promises";
import { writeIntent } from "./src/broker.mjs";
import { loadConfig } from "./src/config.mjs";

const USAGE = `durig intent — spool a message to a seat for the resident broker to deliver

usage:
  node intent.mjs <seat> --body-file <path> [--request-id <id>] [--from <name>]
  node intent.mjs <seat> --body-file -            (read the body from stdin)

why: the broker is the single store writer. This producer writes an intent file
(<db>.broker.inbox/) that the broker drains on its next pass, so intent can be
delivered while the broker drives — no serve --stop, no interrupted runs.

environment:
  DURIG_DB, durig.config.json   which store/broker to target
`;

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stderr.write(USAGE);
  process.exit(0);
}
if (args.length === 0) {
  process.stderr.write(USAGE);
  process.exit(1);
}

const to = args.find((a) => !a.startsWith("--"));
if (!to) fail("intent needs a seat name, e.g. node intent.mjs pm --body-file intent.md");

const bodyFileAt = args.indexOf("--body-file");
if (bodyFileAt === -1) {
  // Prompts are passed by file so a backtick in shell text cannot be command-
  // substituted into a mangled message (dogfood F1) — the same rule as `send`.
  fail("intent needs --body-file <path> (write the body to a file; use - for stdin)");
}
const bodyArg = args[bodyFileAt + 1];
if (bodyArg === undefined || bodyArg.startsWith("--")) fail("--body-file needs a path (or - for stdin)");

const requestIdAt = args.indexOf("--request-id");
const requestId = requestIdAt === -1 ? null : args[requestIdAt + 1] ?? null;
const fromAt = args.indexOf("--from");
const from = fromAt === -1 ? "operator" : args[fromAt + 1] ?? "operator";

let content;
try {
  content = bodyArg === "-" ? await readFile(0, "utf8") : await readFile(bodyArg, "utf8");
} catch (err) {
  fail(`cannot read body ${bodyArg}: ${err?.message ?? err}`);
}

const { config: CFG } = await loadConfig({ env: process.env, readFile });
const DB_PATH = CFG.DURIG_DB ?? "./rig.sqlite";

let spooled;
try {
  spooled = writeIntent(DB_PATH, { to, from, content, requestId, createdAt: new Date().toISOString() });
} catch (err) {
  fail(`cannot spool intent for ${to}: ${err?.message ?? err}`);
}

console.log(JSON.stringify({ ok: true, command: "intent", to, db: DB_PATH, spooled }));
process.exit(0);

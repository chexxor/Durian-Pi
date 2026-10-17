#!/usr/bin/env node
// intent.mjs — `durig intent`: spool a request to a seat WITHOUT opening the store.
//
// Why a separate entrypoint (like `ui.mjs`, D21): the resident broker is the single
// store writer. A `send` opens its own harness, so a mutating verb while the broker
// drives needs `serve --stop`, which interrupts in-flight runs. This producer never
// touches the store — it writes one request file to `<db>.broker.inbox/`, and the
// broker drains it on its next pass and APPLIES it with its own harness (ROADMAP 71,
// the command spool). Safe to run while the broker drives; no second writer, no stop.
//
// Usage:
//   node intent.mjs <seat> --body-file <path>        # deliver a message (op=message)
//   node intent.mjs <seat> --body-file <path> --request-id <id>
//   node intent.mjs <seat> --op stop [--reason <text>] [--request-id <id>]
//
// The `op` names the OPERATION the broker applies: `message` (default) submits the
// body as operator input; `stop` halts the seat's run. A `requestId` is minted when
// omitted and printed, so the caller can await the result file
// `<db>.broker.inbox.out/<requestId>.json`.
//
// Reads DURIG_DB / durig.config.json like every other verb.

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { SPOOL_OPS, writeIntent } from "./src/broker.mjs";
import { loadConfig } from "./src/config.mjs";

const USAGE = `durig intent — spool a request to a seat for the resident broker to apply

usage:
  node intent.mjs <seat> --body-file <path> [--op message] [--request-id <id>] [--from <name>]
  node intent.mjs <seat> --body-file -            (read the body from stdin)
  node intent.mjs <seat> --op stop [--reason <text>] [--request-id <id>]

ops: ${SPOOL_OPS.join(", ")}

why: the broker is the single store writer. This producer writes a request file
(<db>.broker.inbox/) that the broker drains on its next pass and APPLIES with its
own harness, so a write reaches a running broker — no serve --stop, no interrupted
runs. The result is recorded at <db>.broker.inbox.out/<requestId>.json.

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

const to = args[0] && !args[0].startsWith("--") ? args[0] : null;
if (!to) fail("intent needs a seat name, e.g. node intent.mjs pm --body-file intent.md");

const opAt = args.indexOf("--op");
const op = opAt === -1 ? "message" : args[opAt + 1] ?? "message";
if (!SPOOL_OPS.includes(op)) fail(`unknown op "${op}" (known: ${SPOOL_OPS.join(", ")})`);

// The body is required only for a message; a stop carries a reason instead.
let content = "";
if (op === "message") {
  const bodyFileAt = args.indexOf("--body-file");
  if (bodyFileAt === -1) {
    // Prompts are passed by file so a backtick in shell text cannot be command-
    // substituted into a mangled message (dogfood F1) — the same rule as `send`.
    fail("intent needs --body-file <path> (write the body to a file; use - for stdin)");
  }
  const bodyArg = args[bodyFileAt + 1];
  if (bodyArg === undefined || bodyArg.startsWith("--")) fail("--body-file needs a path (or - for stdin)");
  try {
    content = bodyArg === "-" ? await readFile(0, "utf8") : await readFile(bodyArg, "utf8");
  } catch (err) {
    fail(`cannot read body ${bodyArg}: ${err?.message ?? err}`);
  }
}

const requestIdAt = args.indexOf("--request-id");
const requestId = requestIdAt === -1 ? randomUUID() : args[requestIdAt + 1] ?? randomUUID();
const fromAt = args.indexOf("--from");
const from = fromAt === -1 ? "operator" : args[fromAt + 1] ?? "operator";
const reasonAt = args.indexOf("--reason");
const reason = reasonAt === -1 ? undefined : args[reasonAt + 1];

const { config: CFG } = await loadConfig({ env: process.env, readFile });
const DB_PATH = CFG.DURIG_DB ?? "./rig.sqlite";

let spooled;
try {
  spooled = writeIntent(DB_PATH, {
    op,
    to,
    from,
    content,
    ...(reason !== undefined ? { reason } : {}),
    requestId,
    createdAt: new Date().toISOString(),
  });
} catch (err) {
  fail(`cannot spool ${op} for ${to}: ${err?.message ?? err}`);
}

console.log(JSON.stringify({ ok: true, command: "intent", op, to, requestId, db: DB_PATH, spooled }));
process.exit(0);

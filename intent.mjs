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
//   node intent.mjs <seat> --op reset [--handoff <text>] [--request-id <id>]
//   node intent.mjs <seat> --op compact [--instructions <text>] [--request-id <id>]
//
// The `op` names the OPERATION the broker applies: `message` (default) submits the
// body as operator input; `stop` halts the seat's run; `reset` draws a reset boundary
// (optionally with a handoff message); `compact` summarizes the seat's old context
// live (the broker applies it with its own harness; the transcript is kept). A
// `requestId` is minted when
// omitted and printed, so the caller can await the result file
// `<db>.broker.inbox.out/<requestId>.json`.
//
// Reads DURIG_DB / durig.config.json like every other verb.

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { SPOOL_OPS, writeIntent } from "./src/broker.mjs";
import { CONFIRM_THRESHOLD } from "./src/queueops.mjs";
import { loadConfig } from "./src/config.mjs";

const USAGE = `durig intent — spool a request to a seat for the resident broker to apply

usage:
  node intent.mjs <seat> --body-file <path> [--op message] [--request-id <id>] [--from <name>]
  node intent.mjs <seat> --body-file -            (read the body from stdin)
  node intent.mjs <seat> --op stop [--reason <text>] [--request-id <id>]
  node intent.mjs <seat> --op reset [--handoff <text>] [--request-id <id>]
  node intent.mjs <seat> --op compact [--instructions <text>] [--request-id <id>]
  node intent.mjs queue --op queue --action repair-gates|stranded [--id N …] [--apply]
  node intent.mjs queue --op queue --action priority --id N [--id N …] --priority now|next|later --reason <text> --until <iso> [--apply]
  node intent.mjs queue --op queue --action cancel --id N [--id N …] --reason <text> [--apply] [--confirm]

ops: ${SPOOL_OPS.join(", ")}

QUEUE CONTROL (--op queue, operator/delegate plane). The broker computes a PLAN from the live queue
and returns exactly the transitions it would append; nothing is written unless --apply is given. A plan
over ${CONFIRM_THRESHOLD} rows needs --confirm as well. Attribution is carried on every transition:
--from delegate records authority "delegate (operator-authorised)"; the default operator records
"operator". cancel NAMES the dependents it would strand, because a cancelled gate can never be
satisfied and nothing repairs it (src/queueops.mjs).

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
const opAt = args.indexOf("--op");
const op = opAt === -1 ? "message" : args[opAt + 1] ?? "message";
if (!SPOOL_OPS.includes(op)) fail(`unknown op "${op}" (known: ${SPOOL_OPS.join(", ")})`);
// `queue` is a TARGET-LESS op: the broker applies it against the queue document, not a conversation.
// (A positional `queue` is accepted as documentation of intent: `node intent.mjs queue --op queue …`.)
if (op !== "queue" && !to) fail("intent needs a seat name, e.g. node intent.mjs pm --body-file intent.md");
if (op === "queue" && to && to !== "queue") fail(`op queue targets the queue, not the seat "${to}": omit the seat name`);

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
const handoffAt = args.indexOf("--handoff");
const handoff = handoffAt === -1 ? undefined : args[handoffAt + 1];
const instructionsAt = args.indexOf("--instructions");
const instructions = instructionsAt === -1 ? undefined : args[instructionsAt + 1];

// ---- QUEUE CONTROL (`--op queue`) -------------------------------------------------------------
// Administered here rather than as a CLI verb because a queue mutation must be applied by the SINGLE
// WRITER: the broker's own harness, on its next pass. `cli.mjs` cannot write while a broker drives
// (`refuseWhileBrokerDrives`), so this spool IS the operator/delegate control plane in resident mode.
const actionAt = args.indexOf("--action");
const action = actionAt === -1 ? undefined : args[actionAt + 1];
const ids = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === "--id") ids.push(String(args[i + 1]));
const priorityAt = args.indexOf("--priority");
const priority = priorityAt === -1 ? undefined : args[priorityAt + 1];
const untilAt = args.indexOf("--until");
const expiresAt = untilAt === -1 ? undefined : args[untilAt + 1];
const apply = args.includes("--apply");
const confirm = args.includes("--confirm");
if (op === "queue" && !action) fail("op queue needs --action repair-gates|priority|cancel|stranded");
if (op === "queue" && action !== "stranded" && ids.length === 0) fail(`op queue --action ${action} needs at least one --id`);
if (op === "queue" && action === "priority" && (!priority || !reason || !expiresAt))
  fail("op queue --action priority needs --priority now|next|later, --reason <text> and --until <iso> (it is a lease)");
if (op === "queue" && action === "cancel" && !reason) fail("op queue --action cancel needs --reason <text> (it is terminal)");

const { config: CFG } = await loadConfig({ env: process.env, readFile });
const DB_PATH = CFG.DURIG_DB ?? "./rig.sqlite";

let spooled;
try {
  spooled = writeIntent(DB_PATH, {
    op,
    to: to ?? "queue",
    from,
    content,
    ...(reason !== undefined ? { reason } : {}),
    ...(handoff !== undefined ? { handoff } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(op === "queue" ? { action, ids, ...(priority !== undefined ? { priority } : {}), ...(expiresAt !== undefined ? { expiresAt } : {}), apply, confirm } : {}),
    requestId,
    createdAt: new Date().toISOString(),
  });
} catch (err) {
  fail(`cannot spool ${op} for ${to ?? "queue"}: ${err?.message ?? err}`);
}

console.log(
  JSON.stringify({
    ok: true,
    command: "intent",
    op,
    to: to ?? "queue",
    ...(op === "queue" ? { action, ids, apply } : {}),
    requestId,
    db: DB_PATH,
    spooled,
  }),
);
process.exit(0);

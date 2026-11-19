// tools/queue-surface-core.mjs — the PI-PLANE half of the ONE queue command core (D334, ROADMAP 381 task-4).
//
// WHY THIS FILE IS THIS THIN (and why it is not a second command). `src/queue-command.mjs` already holds the
// whole grammar: the flag table, the closed value vocabularies, the parse, the collisions, the decide step and
// the render. A pi registration that restates any of it is a second grammar, and the moment the two grow apart
// one of them accepts what the other refuses — the accepted-and-ignored class (#5071) and the fail-open's
// defect class (ROADMAP 228). So this file adds only what the PI PLANE knows and the core must not decide:
//
//   1. WHICH STORE. `queueCommandStorePath` resolves DURIG_DB (src/config.mjs loadConfig) against the cwd,
//      so `/queue` answers "which database answered" the same rule `cli.mjs` states (#4955): the session and
//      the scripted verb read ONE store, not two that can disagree.
//   2. HOW A READ IS SERVED. Through `src/readclient.mjs` `readData` — the rig's own routing: the broker when
//      one is resident, the store directly otherwise, and every path says which served it. The pi plane does
//      NOT force `--local`; that is an operator ask on the CLI, not a plane default.
//   3. WHAT AN ACT MAY DO. Only the broker's spool (`queueManageSpool`/`queueDiscussSpool` with
//      requireBroker). `queueCommandRun` passes that seam already; this file only supplies it. An act on a
//      store with no live broker is REFUSED before the write (code `no-live-broker`), so a session can never
//      report "applied" for something nothing applied — the command NAMES the harness it drives (the broker),
//      which is what the task-4 contract asks of a plane whose own host shell is rendering-only.
//   4. WHAT THE SESSION SEES. D19 asks human view vs one JSON document; a pi session is a human, so the view
//      is TEXT unless `--json` is asked for. That choice lives here, never in the core — the same reason the
//      CLI keeps its own `textForm` line.
//
// WHAT STAYS OUT, deliberately: no flag table, no vocabulary, no rendering of a queue row, and no store
// opening of its own. A form the core does not offer (`--human`, `--id` row reads, the whole-document dump,
// `--with-gates`) is NOT re-implemented here — that would be a second rendering to keep in step; the
// command says the form is the scripted verb's and names it.
//
// PLANE (D212): this is the extension plane, not the base. The tracked source lives in `tools/`;
// `.pi/extensions/queue-surface.js` is installed from `tools/queue-surface-extension.js` by
// `tools/queue-surface-install.mjs` and imports THIS file (it is never copied, so `../src/...` below still
// resolves from `tools/` on both planes).
//
// Cost (D213): pure composition plus the rig's own read — no model, no key, no network, and no broker
// process started here. Measured Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 /
// node v24.22.1: the loop for a change here is `node demo/queue-pi-command.test.mjs` (see that file's
// PASS line for its wall seconds).
import { QUEUE_USAGE, queueRefusalText, queueCommandArgv, queueCommandParse, queueCommandRun, queueCommandCompletion, queueCommandStorePath, queueCommandSurfaceForms } from "../src/queue-command.mjs";
import { readQueueItems, readQueueCensus, readSeatsDocument } from "../src/readapi.mjs";
import { readData } from "../src/readclient.mjs";
import { queueManageSpool, queueDiscussSpool } from "../src/queue-manage.mjs";
import { GATE_VIEW_CAP } from "../src/queue-lifecycle.mjs";
import { Seats } from "../src/rig.mjs";

export const QUEUE_COMMAND_NAME = "queue";
export const QUEUE_SURFACE_DESCRIPTION =
  "View and adjust the rig's shared work queue from this session — the same core `cli.mjs queue` runs: --list (a bounded, attributed view), --manage (propose, or apply through the broker's spool), --discuss/--revise (a hand-off to a seat).";

// The COMPLETION vocabulary is the core's table (queueCommandCompletion), so the argument box a session can
// type is drawn from the grammar that DECIDES the argument — never from a second list that can go stale.
export function queueSurfaceCompletion(prefix = "") {
  return queueCommandCompletion(prefix);
}

// THE PLANE'S SEAMS: which store, and the readers/spool the core is handed. `readData` is the rig's own
// broker-or-store routing, so a session reads exactly what `cli.mjs status` would read right now.
export async function queueSurfaceSeams({ db = null, env = process.env, cwd = process.cwd(), local = false, surface = {} } = {}) {
  const store = db ?? await queueCommandStorePath({ env, cwd });
  const read = (view, params, fn) => readData(store, view, params, fn, { local });
  // Which spool the act uses is the core's own derivation of the request (`queueCommandSurfaceForms`), not a
  // second guess about what the caller meant.
  const handoff = Boolean(surface.handoff);
  const spool = handoff
    ? (request, opts) => queueDiscussSpool(store, request, opts)
    : (request, opts) => queueManageSpool(store, request, opts);
  return {
    db: store,
    readQueue: async () => await read("queue", {}, (storage) => readQueueItems(storage)),
    readCensus: async () => await read("queue-census", {}, (storage) => readQueueCensus(storage)),
    readSeats: async () => {
      const seatsDoc = await read(
        "document",
        { kind: Seats.definition.kind, scope: { kind: "session" } },
        (storage) => readSeatsDocument(storage),
      );
      return seatsDoc?.found ? seatsDoc.value : {};
    },
    spool,
  };
}

// THE ONE PLANE DECISION: run -> what the session shows. The core returns strings, a machine document, notes
// and an exit code; a session has no stdout contract, so each part becomes one notification with a level.
// An ARGUMENT-level refusal gets the core's correction sentence (queueRefusalText) — the same bytes the CLI
// prints on stderr — because a mistake must read the same way on both planes.
export function queueSurfaceShow(run, state = {}) {
  if (run.argRefusal) return [{ level: "error", body: queueRefusalText(run.refusal) }];
  if (run.unsupported) {
    return [
      {
        level: "info",
        body:
          `queue: that form is the scripted verb's, not this session's — \`node cli.mjs queue ...\` prints it. ` +
          `/queue offers three forms: --list (a bounded attributed view), --manage <action> (propose; --apply writes only through the broker), --discuss/--revise <note> (a hand-off to a seat). ` +
          `Nothing about the queue was read or changed. usage: ${QUEUE_USAGE}`,
      },
    ];
  }
  const lines = [];
  if (state.jsonRequested && run.json !== undefined) lines.push({ level: run.ok ? "info" : "warning", body: JSON.stringify(run.json, null, 2) });
  else if (run.text !== undefined) lines.push({ level: run.ok ? "info" : "warning", body: run.text });
  else if (run.json !== undefined) lines.push({ level: run.ok ? "info" : "warning", body: JSON.stringify(run.json, null, 2) });
  for (const note of run.notes ?? []) lines.push({ level: run.ok ? "info" : "warning", body: note });
  if (!run.ok && run.refusal && !run.notes && !run.text && !run.json) lines.push({ level: "warning", body: run.refusal });
  return lines;
}

// THE CALL: session text -> argv -> the core's parse -> the core's decide/render -> notifications.
// `seams` is the pin's in-memory plane (rows seeded without a store); a real session builds them from the
// store. A read that the rig refuses (no store at that path, a broker that will not answer, a seat holding a
// live generation lease) is REPORTED by name — it never becomes an empty success.
export async function queueSurfaceInvoke(text = "", { env = process.env, cwd = process.cwd(), db = null, seams = null, local = false, from = "delegate" } = {}) {
  const tokenized = queueCommandArgv(text);
  if (!tokenized.ok)
    return { show: queueSurfaceShow({ ok: false, argRefusal: true, refusal: tokenized.refusal, exitCode: 1 }, {}), ok: false, exitCode: 1, state: {} };
  const parsed = queueCommandParse(tokenized.argv, { cap: GATE_VIEW_CAP });
  if (!parsed.ok)
    return { show: queueSurfaceShow({ ok: false, argRefusal: true, refusal: parsed.refusal, exitCode: 1 }, parsed.state ?? {}), ok: false, exitCode: 1, state: parsed.state ?? {} };
  const state = parsed.state;
  const use = seams ?? await queueSurfaceSeams({ db, env, cwd, local, surface: queueCommandSurfaceForms(state) });
  let run;
  try {
    run = await queueCommandRun(state, use);
  } catch (err) {
    // A read the rig refused, or an act whose seam threw. Rendered as a refusal, not as zero rows: the
    // rig's own read errors carry `code` and a remedy, and a surface that swallows them reports a store it
    // never read.
    run = {
      ok: false,
      refusal: String(err?.message ?? err),
      notes: [`queue: the read/act refused${err?.code ? ` (${err.code})` : ""} — see docs/runbooks/broker-down-or-stalled.md and docs/runbooks/session-start-cost.md\n`],
      exitCode: 1,
    };
  }
  return { show: queueSurfaceShow(run, state), ok: run.ok, exitCode: run.exitCode ?? 0, state, db: use.db, run };
}

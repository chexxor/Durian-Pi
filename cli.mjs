#!/usr/bin/env node
// durig CLI - operate a pi-durable rig from the command line.
//
// LLM-operator contract: every command prints one JSON document and exits
// 0 on success / nonzero on failure; no interactive input; errors come
// back as {ok:false,error} instead of thrown traces.
//
// Durability: state lives in ./rig.sqlite (override: DURIG_DB). Each
// invocation opens storage, acts, closes. Concurrent invocations race for
// storage ownership; the loser exits with an error instead of corrupting.
//
// Provider: DURIG_PROVIDER=deepinfra (default; needs DEEPINFRA_API_KEY)
// or faux for offline testing. Model override: DURIG_MODEL.
//
// Every setting can also live in durig.config.json (env still wins); run
// `node cli.mjs config` to see the values actually in effect and their
// source.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import * as ocApi from "@earendil-works/pi-ai/api/openai-completions";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
// Single source of truth for DeepInfra provider options, vendored into this tree
// so durig is self-contained and publishable on its own
// (src/providers/PROVENANCE.md records the source, version and licence). Node 24
// type-strips the TypeScript on import, so there is no build step.
import {
  BASE_URL,
  DEEPINFRA_COMPAT,
  PROVIDER_ID,
  fallbackModels,
} from "./src/providers/deepinfra-models.ts";
import {
  Constitution,
  Edges,
  RigQueue,
  Router,
  Seats,
  compilePersona,
  registerSeat,
} from "./src/rig.mjs";
import { describeConfig, loadConfig } from "./src/config.mjs";
import { computeAttention } from "./src/attention.mjs";
import {
	readGenerationSlots,
	wrapProviderWithSlots,
} from "./src/genlock.mjs";
import { optimizeInstruction } from "./src/optimizer.mjs";
import { createLiveRenderer, wrapProviderWithLiveView } from "./src/streamview.mjs";
import { SCAN_LIMIT, extractEntryText, readSeatPages, summarizeEntries } from "./src/rigstory.mjs";
import { computeMetrics, formatMetrics } from "./src/metrics.mjs";
import { formatChat } from "./src/chatview.mjs";
import { auditRig, formatCheck } from "./src/checkup.mjs";
import { createWatchScreen, formatSnapshot } from "./src/watchview.mjs";

// Effective configuration for this process: environment over
// durig.config.json over built-in defaults (see src/config.mjs). Resolved
// once at startup so every command agrees on one DB/provider/model. A bad
// config is reported in the same JSON contract as every other failure
// rather than as a stack trace (out()/fail() are defined further down).
let cfgResult;
try {
  cfgResult = await loadConfig({ env: process.env, readFile });
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
  process.exit(1);
}
const { config: CFG, source: CFG_SOURCE } = cfgResult;
const DB_PATH = CFG.DURIG_DB ?? "./rig.sqlite";
// Read commands must be able to tell "this rig is empty" apart from "you are
// pointed at a database that did not exist a moment ago". Opening storage
// creates the file on demand, so without this snapshot the default
// ./rig.sqlite looks exactly like a real, empty rig.
const DB_EXISTED_AT_START = existsSync(DB_PATH);
const MODEL_ID = CFG.DURIG_MODEL ?? "zai-org/GLM-5.3-Flash";

// The classic new-user symptom: a second terminal that forgot DURIG_DB points
// at ./rig.sqlite, every command reports ok with zero seats, and the rig looks
// broken. Say so on stderr (stdout keeps the JSON contract) with the one fact
// that resolves it - which database was used, and from where.
function noteEmptyRig(seatCount) {
  if (seatCount > 0) return;
  const freshness = DB_EXISTED_AT_START
    ? ""
    : ` (it did not exist before this command, so it was just created empty)`;
  console.error(
    `note: no seats in ${DB_PATH}${freshness}. If you meant a different rig, set DURIG_DB or create durig.config.json - run: node cli.mjs config`,
  );
}

// Faux handle kept module-level so cmdSend can queue a default response;
// scripted responses drain per process, and each CLI call is one process.
let FAUX = null;

// Leading-underscore keys are internals (a scan shared between two views) and
// are never part of the contract, so one replacer keeps them out of every JSON
// path rather than each caller remembering to strip them.
function dropInternals(key, value) {
  return key.startsWith("_") ? undefined : value;
}

function out(p) {
  console.log(JSON.stringify(p, dropInternals, 2));
}

function fail(error) {
  out({ ok: false, error: String(error?.message ?? error) });
  process.exit(1);
}

/** Whole of stdin as text, for `send --body-file -`. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// Generation-slot cap across ALL seats (MVP #6): unset or <=0 means no
// limit; 1 serializes generations so one local model can serve everyone.
function maxSeats() {
  const n = Number(CFG.DURIG_MAX_CONCURRENT_SEATS ?? "");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Infinity;
}

import { resolveSeatModel } from "./src/seatmodel.mjs";

// live: when set, the provider is wrapped so a running generation streams to
// the terminal. Off for commands that only read state, so `watch`/`status`
// stay machine-clean; only `send` opts in.
function buildModels(live = null) {
  if ((CFG.DURIG_PROVIDER ?? "deepinfra") === "faux") {
    FAUX = fauxProvider({ models: [{ id: MODEL_ID }] });
    const models = createModels();
    // Gate what MODELS see; keep FAUX pointing at the raw provider so
    // scripted responses keep flowing to the real implementation.
    const slots = maxSeats();
    const gated = Number.isFinite(slots)
      ? wrapProviderWithSlots(FAUX.provider, {
          dbPath: DB_PATH,
          slots,
          getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null,
        })
      : FAUX.provider;
    models.setProvider(
      live
        ? wrapProviderWithLiveView(gated, {
            renderer: live,
            getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null,
          })
        : gated,
    );
    return { models, providerId: "faux" };
  }
  const deepinfra = createProvider({
    id: PROVIDER_ID,
    name: "DeepInfra",
    baseUrl: BASE_URL,
    auth: {
      apiKey: {
        name: "DeepInfra API key",
        resolve: async ({ ctx }) => {
          const key = await ctx.env("DEEPINFRA_API_KEY");
          if (!key) return undefined;
          return { auth: { apiKey: key }, source: "DEEPINFRA_API_KEY" };
        },
      },
    },
    // Catalog from the extension module, plus a synthesized entry for the
    // requested model when the curated fallback lacks it (fallback is a
    // subset of DeepInfra's catalog; arbitrary DURIG_MODEL ids must work).
    models: (() => {
      const base = fallbackModels();
      if (base.some((m) => m.id === MODEL_ID)) return base;
      return [...base, {
        id: MODEL_ID,
        name: MODEL_ID,
        api: "openai-completions",
        provider: PROVIDER_ID,
        baseUrl: BASE_URL,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8_192,
        ...DEEPINFRA_COMPAT,
      }];
    })(),
    api: ocApi,
  });
  const models = createModels({
    authContext: {
      // Env first, then the config file, so DEEPINFRA_API_KEY can live in
      // durig.config.json (gitignored) instead of the shell.
      env: async (name) => process.env[name] ?? CFG[name],
      fileExists: async () => false,
    },
  });
  const slots = maxSeats();
  const gated = Number.isFinite(slots)
    ? wrapProviderWithSlots(deepinfra, {
        dbPath: DB_PATH,
        slots,
        getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null,
      })
    : deepinfra;
  // Live view sits OUTSIDE the slot gate: it labels the stream even while a
  // generation waits for a free slot, and never alters what consumers see.
  models.setProvider(
    live
      ? wrapProviderWithLiveView(gated, {
          renderer: live,
          getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null,
        })
      : gated,
  );
  return { models, providerId: "deepinfra" };
}

async function openHarness({ resume = true, live = null } = {}) {
  const { models, providerId } = buildModels(live);
  const harness = await Harness.open(
    await openNodeSqliteStorage(DB_PATH),
    {
      models,
      // createRegistry() holds only built-in tasks; without installing the
      // Router extension no seat conversation ever sees the durig tools
      // (send_work/claim_work/...) and real models narrate work as chat
      // text instead of routing it (root cause of the 2026-10-09 bug).
      registry: (() => {
        const registry = createRegistry();
        registry.install(Router);
        return registry;
      })(),
    },
    BACKGROUND_CONTEXT,
  );
  // Persisted storage restarts idle; resume() re-arms task scheduling so
  // queued work and interrupted runs continue (blog restart recipe).
  // Viewers skip it: enabling scheduling is a write-side act and would let
  // a passive `watch` kick the very queue it is observing.
  if (resume) harness.resume();
  return { harness, models, providerId };
}

// The stored system prompt for one seat: compiled persona plus the durig
// work-protocol primer, optionally rewritten by the optimizer. Shared by
// seat creation and --refresh so the two paths can never drift apart.
async function buildSeatPrompt(models, seat, providerId) {
  // Migrated OpenRig personas predate durig and never mention the Router
  // tools, so without this primer they narrate work as chat text instead of
  // routing it through the queue (observed 2026-10-09).
  const PROTOCOL = [
    "# durig work protocol",
    "Work reaches you as queue items addressed to your seat name.",
    "- claim_work: claim the oldest queued item addressed to you; it returns subject and body.",
    "- complete_work(itemId, resultSummary): mark your claimed item done; it notifies the sender automatically.",
    "- send_work(to, subject, body[, requires]): delegate to another seat by putting an item in its queue. Route work, do not narrate it.",
    "- peek_queue: inspect all queue items read-only.",
    "When asked to decompose or route a task, CREATE QUEUE ITEMS with send_work - do not merely describe them in your reply.",
  ].join("\n");
  const seatModel = resolveSeatModel(models, seat.model, providerId, MODEL_ID);
  let instructions = [compilePersona(seat), PROTOCOL].join("\n\n");
  let optimizedVia = null;
  // DURIG_OPTIMIZE=on runs each seat's persona through the optimizer (one
  // model call per seat) before it becomes the system prompt. The raw spec
  // stays authoritative on disk; only the stored prompt is rewritten, and
  // provenance records what did it.
  if ((CFG.DURIG_OPTIMIZE ?? "") === "on") {
    const result = await optimizeInstruction(models, seatModel, instructions, {
      kind: "instruction",
    });
    instructions = result.optimized;
    if (!result.rejected) {
      optimizedVia = `${seatModel.provider}/${seatModel.modelId}`;
    } else {
      console.error(
        `OPTIMIZER REJECTED for seat ${seat.name}: ${JSON.stringify({ violations: result.violations, inventions: result.inventions })}`,
      );
    }
  }
  return { instructions, seatModel, optimizedVia };
}

// up <rig.json> [--refresh]: create the seats the rig file declares.
// Idempotent per seat name: already-registered seats are reported, not
// duplicated. --refresh additionally re-applies the stored prompt and model
// of existing seats, so a fix to the primer, the edges policy, or a
// per-seat model reaches a database created by an earlier durig version.
// Edges and the constitution are always re-applied from the spec.
async function cmdUp(rigFile, refresh = false) {
  const spec = JSON.parse(await readFile(rigFile, "utf8"));
  // A spec carries its constitution either inline (what the OpenRig converter
  // emits, since the text it read has no file on disk beside the spec) or as a
  // path. Reading only `constitution` silently dropped the text for every
  // converted rig, so both forms resolve here; inline wins on the ambiguity.
  // Resolved before the commit because the transactor may retry its action,
  // and a note printed inside it would appear once per attempt.
  const constitutionText =
    typeof spec.constitutionInline === "string"
      ? spec.constitutionInline
      : spec.constitution
        ? await readFile(spec.constitution, "utf8")
        : undefined;
  if (typeof spec.constitutionInline === "string" && spec.constitution) {
    console.error(
      `note: ${rigFile} sets both constitutionInline and constitution; using the inline text`,
    );
  }
  const { harness, models, providerId } = await openHarness();
  try {
    const created = [];
    const existing = [];
    const refreshed = [];
    await harness.commit(async (tx) => {
      const seatsDoc = await tx.doc(Seats);
      for (const seat of spec.seats) {
        const prompt = await buildSeatPrompt(models, seat, providerId);
        if (seatsDoc.seats[seat.name]) {
          if (!refresh) {
            existing.push(seat.name);
            continue;
          }
          await configure(tx, seatsDoc.seats[seat.name].conversationId, {
            model: {
              provider: prompt.seatModel.provider,
              modelId: prompt.seatModel.modelId,
            },
            instructions: prompt.instructions,
          });
          if (prompt.optimizedVia) {
            seatsDoc.seats[seat.name].instructionsOptimizedVia = prompt.optimizedVia;
          }
          refreshed.push(seat.name);
          continue;
        }
        const conv = await tx.createConversation({
          ownership: { kind: "ownerless" },
        });
        await configure(tx, conv.id, {
          model: {
            provider: prompt.seatModel.provider,
            modelId: prompt.seatModel.modelId,
          },
          instructions: prompt.instructions,
        });
        if (prompt.optimizedVia) {
          const seatsDoc2 = await tx.doc(Seats);
          seatsDoc2.seats[seat.name].instructionsOptimizedVia = prompt.optimizedVia;
        }
        await registerSeat(tx, seat.name, conv.id, seat.role ?? seat.name);
        if (seat.capabilities?.length) {
          seatsDoc.seats[seat.name].capabilities = seat.capabilities;
        }
        created.push(seat.name);
      }
      if (spec.edges) {
        const edgesDoc = await tx.doc(Edges);
        edgesDoc.edges = spec.edges;
      }
      if (constitutionText !== undefined) {
        const cDoc = await tx.doc(Constitution);
        cDoc.text = constitutionText;
      }
      // Materialize the queue even when empty: otherwise it comes into
      // existence only at the first enqueue, and a freshly bootstrapped rig
      // has nothing for `watch` to observe.
      await tx.doc(RigQueue);
    }, BACKGROUND_CONTEXT);
    out({ ok: true, command: "up", db: DB_PATH, created, existing, refreshed });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}

// ps: roster with per-seat conversation id and role.
async function cmdPs() {
  const { harness, providerId } = await openHarness();
  try {
    const doc = await harness.documentState(Seats, undefined, BACKGROUND_CONTEXT);
    const seatsVal = doc?.value?.seats ?? {};
    const seats = Object.entries(seatsVal).map(([name, s]) => ({
      name,
      conversationId: s.conversationId,
      role: s.role,
    }));
    noteEmptyRig(seats.length);
    out({
      ok: true,
      command: "ps",
      db: DB_PATH,
      seats,
    });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}

// queue: every work item with status and transitions.
async function cmdQueue() {
  const { harness, providerId } = await openHarness();
  try {
    const doc = await harness.documentState(RigQueue, undefined, BACKGROUND_CONTEXT);
    out({ ok: true, command: "queue", items: doc?.value?.items ?? [] });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}

// send <seat> <text> [--stream|--no-stream]: operator steering. Submits input
// to the seat's conversation and waits for the run to settle so the caller
// can read the outcome in the same invocation (LLM-friendly: no polling
// loop needed). With a live view (default when stderr is a terminal) the
// generation streams to stderr, labelled per seat; stdout stays one JSON doc.
async function cmdSend(seatName, text, { stream = false } = {}) {
  const live = stream ? createLiveRenderer({ color: Boolean(process.stderr.isTTY) && !process.env.NO_COLOR }) : null;
  const { harness, providerId } = await openHarness({ live });
  {
    const doc = await harness.documentState(Seats, undefined, BACKGROUND_CONTEXT);
    const seatsVal = doc?.value?.seats ?? {};
    const seat = seatsVal[seatName];
    if (!seat) {
      // "unknown seat: pm" on the wrong database reads as a typo; the real
      // cause is usually an empty rig, so say which one before failing.
      noteEmptyRig(Object.keys(seatsVal).length);
      fail(`unknown seat: ${seatName}`);
    }
    const conv = await harness.conversation(seat.conversationId, BACKGROUND_CONTEXT);
    if (FAUX) {
      // Offline smoke mode: one canned reply per send. Tool orchestration
      // cannot be exercised here because scripting is per-process; use the
      // demos under demo/ for full-loop offline tests.
      FAUX.appendResponses([
        fauxAssistantMessage([{ type: "text", text: "(faux) acknowledged." }]),
      ]);
    }
    // Stamp the seat so generation leases attribute themselves (visible in
    // status/watch as "GPU busy with <seat>"). Cleared in finally below.
    process.env.DURIG_ACTIVE_SEAT = seatName;
    if (!stream) {
      console.error(`sending to ${seatName}; waiting for its run to settle (a real model can take minutes)...`);
    }
    let submission;
    try {
      // Identify a watermark BEFORE the run, so a settle that produced nothing
      // cannot report a reply from an earlier send as if it belonged to this
      // one.
      //
      // The watermark is the newest ENTRY id, not the newest ASSISTANT id.
      // Diffing against the newest assistant id looks equivalent and is not: a
      // run that produces nothing leaves older assistant entries that also
      // differ from the newest one, so the scan below falls through to a
      // previous send's reply. That only stayed hidden because the test's seat
      // had exactly one prior assistant entry (dogfood F7). Entry ids increase,
      // so "this run created it" is exactly "id > watermark".
      const prior = await conv.entries({}, 20, undefined, BACKGROUND_CONTEXT);
      const priorMaxId = prior.items.reduce(
        (max, e) => Math.max(max, Number(e.id) || 0),
        0,
      );
      submission = await conv.submit(
        { type: "input", content: text },
        BACKGROUND_CONTEXT,
      );
      const settled = await submission.wait(BACKGROUND_CONTEXT);
      // A run that never generated (no_model, or a failed provider call)
      // streams nothing and produces no reply, so a human watching the live
      // view sees only an idle prompt. Say it on stderr; stdout keeps the
      // machine-readable outcome.
      if (settled.status !== "done") {
        console.error(
          `note: ${seatName} finished as ${settled.status}${settled.reason ? ` (${settled.reason})` : ""} - no reply was produced`,
        );
      }
      const pg = await conv.entries({}, 50, undefined, BACKGROUND_CONTEXT);
      // Entries come newest-first; the newest assistant entry this run created
      // is the first one past the watermark.
      const lastAssistant = pg.items.find(
        (e) => e.kind === "pi.assistant" && Number(e.id) > priorMaxId,
      );
      const msg = lastAssistant?.model?.[0];
      out({
        ok: true,
        command: "send",
        seat: seatName,
        settledStatus: settled.status,
        settledReason: settled.reason ?? null,
        reply: msg?.content ?? null,
        stopReason: msg?.stopReason ?? null,
      });
    } finally {
      delete process.env.DURIG_ACTIVE_SEAT;
      await harness.close(BACKGROUND_CONTEXT);
    }
}

}
// log <seat> [limit] [--follow] [--json|--human]: a seat's conversation, oldest
// to newest. --follow keeps the process open and prints entries as they are
// committed, which is what makes a second terminal a live window on a seat.
//
// Reads storage directly rather than opening a harness: a long-running viewer
// that opened one would resume scheduling and start driving work (D11).
async function cmdLog(seatName, limitStr, { follow = false, human = false, full = false, toolBg = false, theme = "dark" } = {}) {
  const parsed = Number(limitStr);
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20;
  const storage = await openNodeSqliteStorage(DB_PATH);
  const interactive = Boolean(process.stdout.isTTY);
  const color = human && interactive && !process.env.NO_COLOR;
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  const asJson = (entry) => ({
    id: entry.id,
    kind: entry.kind,
    text: extractEntryText(entry)?.text ?? "",
    toolName: extractEntryText(entry)?.toolName ?? null,
    model: entry.model?.[0] ?? null,
  });
  const print = (entries) => {
    // An empty transcript must SAY it is empty. Printing nothing - and then
    // waiting forever under --follow - makes "has never run" look identical to
    // "broken", the same reasoning as the empty-rig guardrail. Dogfood F2.
    // stderr, so the JSON contract on stdout is untouched.
    if (entries.length === 0) {
      console.error(
        `note: ${seatName} has no entries yet - it has never run, or its transcript is empty${follow ? " (still watching for new turns)" : ""}. Check with: node cli.mjs ps`,
      );
    }
    if (human) {
      const text = formatChat(entries, {
        seat: seatName,
        color,
        width: process.stdout.columns ?? 100,
        full,
        toolBg,
        theme,
      });
      if (text) console.log(text);
      return;
    }
    out({
      ok: true,
      command: "log",
      seat: seatName,
      db: DB_PATH,
      entries: entries.map(asJson),
    });
  };
  try {
    const seatsRec = await storage.findDocument(
      { kind: Seats.definition.kind, scope: { kind: "session" } },
      "current",
      BACKGROUND_CONTEXT,
    );
    const seatsVal = seatsRec
      ? (await storage.document(seatsRec.id, "current", BACKGROUND_CONTEXT))?.value ?? {}
      : {};
    const seat = seatsVal.seats?.[seatName];
    if (!seat) {
      noteEmptyRig(Object.keys(seatsVal.seats ?? {}).length);
      fail(`unknown seat: ${seatName}`);
    }

    // Newest `limit`, then reversed: a reader wants the recent end of a long
    // transcript, but once it is chosen the order shown must be chronological.
    const page = await storage.scanEntries(
      { conversationId: seat.conversationId, order: "descending" },
      limit,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const history = [...page.items].reverse();
    print(history);
    if (!follow) return;

    let lastId = history.reduce((max, e) => Math.max(max, e.id ?? 0), 0);
    while (!stopping) {
      await new Promise((r) => setTimeout(r, WATCH_POLL_MS));
      let next;
      try {
        next = await storage.scanEntries(
          { conversationId: seat.conversationId, order: "ascending", minEntryId: lastId + 1 },
          200,
          undefined,
          BACKGROUND_CONTEXT,
        );
      } catch (err) {
        // A failed poll must not kill the view silently; report and keep going
        // so a transient storage race self-heals.
        console.error(JSON.stringify({ ok: false, command: "log", error: String(err) }));
        continue;
      }
      for (const entry of next.items) {
        if ((entry.id ?? 0) <= lastId) continue;
        lastId = entry.id;
        print([entry]);
      }
    }
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
  }
}

// Storage-level snapshot of everything attention needs: seats, queue and
// the latest submission per seat conversation. Reads committed state
// straight from sqlite (same reasoning as `watch`: session replication is
// in-process only, and a viewer must not resume scheduling).
async function readRigHealth(storage, dbPath, slots, { modelsBySeat = {}, entryLimit = SCAN_LIMIT } = {}) {
  const seatsRec = await storage.findDocument(
    { kind: Seats.definition.kind, scope: { kind: "session" } },
    "current",
    BACKGROUND_CONTEXT,
  );
  const queueRec = await storage.findDocument(
    { kind: RigQueue.definition.kind, scope: { kind: "session" } },
    "current",
    BACKGROUND_CONTEXT,
  );
  const seatsVal = seatsRec
    ? (await storage.document(seatsRec.id, "current", BACKGROUND_CONTEXT))?.value ?? {}
    : {};
  const queueVal = queueRec
    ? (await storage.document(queueRec.id, "current", BACKGROUND_CONTEXT))?.value ?? {}
    : {};
  const seats = Object.entries(seatsVal.seats ?? {}).map(([name, s]) => ({
    name,
    conversationId: s.conversationId,
    role: s.role,
  }));
  const latestByConv = new Map();
  for (const seat of seats) {
    const page = await storage.scanSubmissions(
      { conversationId: seat.conversationId, order: "descending" },
      1,
      undefined,
      BACKGROUND_CONTEXT,
    );
    latestByConv.set(seat.conversationId, page.items[0]);
  }
  // Slot-file notices ride alongside seat notices: a live holder means the
  // GPU is busy (healthy waiting), a dead holder means a wedged generation.
  const slotNotices = Number.isFinite(slots)
    ? readGenerationSlots(dbPath, slots).map((g) => ({
        scope: "seat",
        seat: g.generatingSeat ?? `slot-${g.slotIndex}`,
        kind: g.name,
        detail:
          g.name === "generation_in_flight" ? `generating since ${g.since}` : g.detail,
      }))
    : [];
  // One bounded page per seat, shared: highlights and metrics both read these
  // entries, so a render makes a single pass over the transcripts. Measured at
  // 0.9-1.4 ms for 14 seats x 24 entries against a 750 ms poll (METRICS.md).
  const pages = await readSeatPages(storage, BACKGROUND_CONTEXT, seats, entryLimit);
  const metrics = computeMetrics({
    pages,
    queueItems: queueVal.items ?? [],
    seats,
    modelsBySeat,
    nowMs: Date.now(),
    // Say the window was cut only when a page actually hit the limit, so
    // "bounded" is a fact about this reading rather than a standing claim.
    bounded: Object.values(pages).some((items) => items.length >= entryLimit),
  });
  // The failure CAUSE is in the entry, not in the submission record: the record
  // carries a category ("model_error"), the entry carries the provider's
  // message. Collected here because the page is already in hand, so surfacing
  // it costs nothing extra (dogfood F3).
  const errorByConv = new Map();
  for (const seat of seats) {
    for (const entry of pages[seat.name] ?? []) {
      const msg = Array.isArray(entry?.model) ? entry.model[0] : null;
      if (msg?.errorMessage) {
        errorByConv.set(seat.conversationId, msg.errorMessage);
        break; // newest first, so the first hit is the most recent failure
      }
    }
  }
  return {
    seats,
    queueItems: queueVal.items ?? [],
    // Maps serialize as {} in JSON; flatten so watch/status output stays legible.
    latestByConv: Object.fromEntries(latestByConv),
    metrics,
    attention: [
      ...computeAttention(seats, queueVal.items ?? [], latestByConv, errorByConv),
      ...slotNotices,
      // Metric notices join the attention channel instead of claiming a screen
      // of their own: same slot, same rendering, and signal only when a measure
      // has actually moved (METRICS.md, "the move").
      ...metrics.notices,
    ],
    // Internal: watch derives highlights from these instead of re-scanning.
    _pages: pages,
  };
}
// watch [--once] [--json|--human]: stream rig state - an initial snapshot,
// then one line per observed change; each line is a full queue document so
// a consumer never needs to diff. Without --once it runs until SIGINT.
//
// Polls the STORAGE layer directly, for two reasons proven by experiment:
// (1) pi-durable's DocumentWatch is fed by in-process replication only
// (session/observation.js CommittedWatch) and sqlite storage has no
// cross-process change notification, so a separate watcher process never
// receives pushes; (2) even documentState on an already-materialized doc
// keeps serving the session's stale replicated value. Reading through
// openNodeSqliteStorage bypasses both; 750 ms keeps operator latency
// imperceptible at negligible cost.
//
// JSON stays the contract and is the default whenever stdout is not a
// terminal; a person at a terminal gets the readable view of the same
// snapshot, so the two never disagree about what the rig is doing.
const WATCH_POLL_MS = 750;
async function cmdWatch(once, human) {
  const storage = await openNodeSqliteStorage(DB_PATH);
  let seq = 0;
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  const interactive = Boolean(process.stdout.isTTY);
  const screen = human
    ? createWatchScreen({
        color: interactive && !process.env.NO_COLOR,
        clear: interactive,
      })
    : null;
  // Highlight reads are deliberately not cached: the available freshness signal
  // (newest submission) does not move when assistant turns are appended, so a
  // cache on it serves a stale first reading forever. See src/rigstory.mjs.
  const render = async (health) => {
    seq += 1;
    if (!human) {
      console.log(JSON.stringify({ ok: true, command: "watch", db: DB_PATH, seq, ...health }, dropInternals));
      return;
    }
    // Derived from the scan readRigHealth already did, so the human view costs
    // no second pass. See src/rigstory.mjs on why neither is cached.
    const highlights = Object.fromEntries(
      Object.entries(health._pages ?? {}).map(([name, items]) => [name, summarizeEntries(items)]),
    );
    screen.render(
      formatSnapshot({
        db: DB_PATH,
        health,
        highlights,
        seq,
        width: process.stdout.columns ?? 100,
        color: interactive && !process.env.NO_COLOR,
      }),
    );
  };
  const slots = maxSeats();
  const initial = await readRigHealth(storage, DB_PATH, slots);
  // Watching the wrong database is silent by nature: no commits ever arrive.
  // Tell the operator up front which database is being watched.
  if (!human) noteEmptyRig(initial.seats.length);
  let last = JSON.stringify(initial);
  await render(initial);
  if (once) {
    await storage.close(BACKGROUND_CONTEXT);
    return;
  }
  while (!stopping) {
    await new Promise((r) => setTimeout(r, WATCH_POLL_MS));
    let health;
    try {
      health = await readRigHealth(storage, DB_PATH, slots);
    } catch (err) {
      // A failed poll must not kill the stream silently; report on stderr
      // and keep polling so transient storage races self-heal.
      console.error(JSON.stringify({ ok: false, command: "watch", error: String(err) }));
      continue;
    }
    const current = JSON.stringify(health);
    if (current !== last) {
      last = current;
      await render(health);
    }
  }
  await storage.close(BACKGROUND_CONTEXT);
}

// optimize <text>: run a draft instruction/work request through the
// optimizer and print the improved text. Manual companion to the automated
// hooks (up with DURIG_OPTIMIZE=on; send_work with optimize:true).
async function cmdOptimize(textParts) {
  const text = textParts.join(" ");
  if (!text.trim()) fail("optimize needs <text>");
  const { models, providerId } = buildModels();
  const result = await optimizeInstruction(
    models,
    { provider: providerId, modelId: MODEL_ID },
    text,
    { kind: "instruction" },
  );
  out({ ok: true, command: "optimize", optimizedVia: `${providerId}/${MODEL_ID}`, optimized: result.optimized });
}

// status: one-shot per-seat health report - queue depth, latest submission,
// and attention notices for blocked seats. Same computation the watch
// stream carries, for callers that want a single document and an exit code.
async function cmdStatus() {
  const storage = await openNodeSqliteStorage(DB_PATH);
  try {
    const health = await readRigHealth(storage, DB_PATH, maxSeats());
    noteEmptyRig(health.seats.length);
    out({ ok: true, command: "status", db: DB_PATH, ...health });
    // `status` is the one-shot surface, so this is where the metrics command is
    // discovered - and only when a measure has actually moved, because a
    // pointer that prints every time stops being read.
    const outOfBand = health.metrics.measures.filter((m) => m.state === "warn").length;
    if (outOfBand > 0) {
      console.error(`note: ${outOfBand} measure(s) out of band - see: node cli.mjs metrics`);
    }
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
  }
}

/** Every seat's resolved model, from the spec. One definition so `check`'s
 * single-model rule and the config-derived metrics measure cannot disagree. */
function resolveModelsBySeat(spec) {
  const { models, providerId } = buildModels();
  const modelsBySeat = {};
  for (const seat of spec?.seats ?? []) {
    const r = resolveSeatModel(models, seat.model, providerId, MODEL_ID);
    modelsBySeat[seat.name] = `${r.provider}/${r.modelId}`;
  }
  return modelsBySeat;
}

/** --window N turns, or `all`. The default is the ambient scan bound, because a
 * bounded window is what keeps the reading cheap; widening it is deliberate. */
function parseWindow(arg) {
  if (arg === "all") return 100000;
  if (arg === undefined || arg === "") return SCAN_LIMIT;
  const n = Number(arg);
  if (!Number.isFinite(n) || n < 1) {
    fail(`--window must be a positive turn count or "all", got: ${arg}`);
  }
  return Math.floor(n);
}

// metrics [rig.json] [--window N|all] [--human|--json]: the deliberate view. One
// table, each measure carrying its band, baseline, evidence class and blind
// spot. Colour is a convenience - every state is legible as a word.
//
// The rig file is how the config-derived measures become judgeable, because the
// store does not record which model a seat runs. Without it they report
// "unjudgeable" rather than guessing, which is the same reason `check` reads
// both sides.
async function cmdMetrics(rigFile, human, windowArg) {
  let spec = null;
  if (rigFile) {
    try {
      spec = JSON.parse(await readFile(rigFile, "utf8"));
    } catch (err) {
      fail(`cannot read rig file ${rigFile}: ${err?.message ?? err}`);
    }
  }
  const storage = await openNodeSqliteStorage(DB_PATH);
  try {
    const health = await readRigHealth(storage, DB_PATH, maxSeats(), {
      modelsBySeat: spec ? resolveModelsBySeat(spec) : {},
      entryLimit: parseWindow(windowArg),
    });
    noteEmptyRig(health.seats.length);
    if (human) {
      process.stdout.write(
        `${formatMetrics(health.metrics, {
          color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
        })}\n`,
      );
      if (!spec) {
        console.error(
          "note: no rig file given, so config-derived measures are unjudgeable - pass one: node cli.mjs metrics <rig.json>",
        );
      }
      return;
    }
    out({ ok: true, command: "metrics", db: DB_PATH, rig: rigFile ?? null, ...health.metrics });
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
  }
}

// config: print the effective settings and which source provided them. The
// most common "the rig looks broken" cause is a command acting on a
// different database than the operator expects, so make that visible.
async function cmdConfig() {
  out({
    ok: true,
    command: "config",
    ...describeConfig({ config: CFG, source: CFG_SOURCE }),
  });
}

// check <rig.json> [--json|--human]: audit a rig file against the research
// gaps. Non-interactive like every other command (D21): the JSON contract on a
// pipe, the readable report on a terminal. Exit code follows a linter's
// convention - nonzero when the rig has `error` findings - so a script can gate
// on it; `ok` stays true because the audit itself ran.
//
// It reads BOTH sides deliberately. The rig file is what the operator intends
// and the store is what the seats actually run; the constitution defect existed
// precisely because those two disagreed while every command reported ok.
async function cmdCheck(rigFile, human) {
  if (!rigFile) fail("check needs <rig.json>");
  let spec;
  try {
    spec = JSON.parse(await readFile(rigFile, "utf8"));
  } catch (err) {
    fail(`cannot read rig file ${rigFile}: ${err?.message ?? err}`);
  }
  // Resolve the declared constitution through the same two forms `up` accepts,
  // so check and up can never disagree about what the rig declares.
  const specConstitution =
    typeof spec.constitutionInline === "string"
      ? spec.constitutionInline
      : spec.constitution
        ? await readFile(spec.constitution, "utf8")
        : undefined;
  // Resolve seat models through the same helper `up` uses (src/seatmodel.mjs).
  const modelsBySeat = resolveModelsBySeat(spec);
  // An absent database is a fact worth reporting, not an error: check still
  // audits the file, and the store-dependent rules are skipped with their why.
  let stored;
  if (!DB_EXISTED_AT_START) {
    stored = { reason: "absent" };
  } else {
    try {
      const storage = await openNodeSqliteStorage(DB_PATH);
      try {
        const rec = await storage.findDocument(
          { kind: Constitution.definition.kind, scope: { kind: "session" } },
          "current",
          BACKGROUND_CONTEXT,
        );
        const text = rec
          ? ((await storage.document(rec.id, "current", BACKGROUND_CONTEXT))?.value?.text ?? "")
          : "";
        stored = { reason: "read", text };
      } finally {
        await storage.close(BACKGROUND_CONTEXT);
      }
    } catch (err) {
      stored = { reason: "unreadable", error: String(err?.message ?? err) };
    }
  }
  const result = auditRig({ rig: rigFile, spec, specConstitution, stored, modelsBySeat });
  const seatCount = (spec.seats ?? []).length;
  if (human) {
    console.log(
      formatCheck(result, {
        rigDisplay: rigFile,
        color: true,
        seats: seatCount,
        storeReason: stored.reason,
      }),
    );
  } else {
    out({
      ok: true,
      command: "check",
      rig: rigFile,
      db: DB_PATH,
      store: stored.reason,
      seats: seatCount,
      ...result,
    });
  }
  // Set the code rather than exiting: a piped JSON payload may still be
  // draining, and process.exit would truncate it mid-write.
  process.exitCode = result.exitCode;
}

const USAGE = `
usages:
  node cli.mjs up <rig.json> [--refresh]   create seats (--refresh re-applies prompts)
  node cli.mjs ps              list seats
  node cli.mjs send <seat> <text> [--stream]   steer a seat and wait for its reply
  node cli.mjs send <seat> --body-file <path>  the same, prompt from a file (- = stdin)
  node cli.mjs send <seat> <text> --no-stream   the same, without the live view
  node cli.mjs queue           dump the work queue
  node cli.mjs log <seat> [limit] [--follow] [--full] [--tool-bg] [--theme dark|light]
                          a seat's conversation (--follow = live, --full = whole tool output)
  node cli.mjs watch [--once] [--json|--human]   follow rig state (human on a terminal)
  node cli.mjs status           per-seat health + attention notices
  node cli.mjs metrics [rig.json] [--window N|all]   drift measures, with bands and blind spots
  node cli.mjs check <rig.json> [--human]   audit a rig against the research gaps
  node cli.mjs optimize <text>  rewrite a draft instruction via the optimizer
  node cli.mjs config          show effective settings and their source
`;

const [, , cmd, ...rest] = process.argv;
try {
  if (cmd === "up") await cmdUp(rest[0], rest.includes("--refresh"));
  else if (cmd === "ps") await cmdPs();
  else if (cmd === "send") {
    // --body-file (or `-` for stdin) exists because a prompt is shell input: a
    // backtick inside an inline argument is command substitution, so the text
    // arrives silently mangled AND the run still succeeds. OpenRig's queue has
    // --body-file for exactly this class. Found by dogfooding, F1.
    const fileAt = rest.indexOf("--body-file");
    let fromFile = null;
    if (fileAt >= 0) {
      const path = rest[fileAt + 1];
      if (!path) fail("send --body-file needs a path (or - for stdin)");
      try {
        fromFile = path === "-" ? await readStdin() : await readFile(path, "utf8");
      } catch (err) {
        fail(`cannot read ${path === "-" ? "stdin" : path}: ${err?.message ?? err}`);
      }
    }
    // Only drop the path argument when there WAS a --body-file; with fileAt = -1
    // the index below would be 0 and would swallow the seat name.
    const args = rest.filter(
      (a, i) => a !== "--body-file" && !(fileAt >= 0 && i === fileAt + 1),
    );
    if (!args[0]) fail("send needs <seat> <text>, or --body-file <path>");
    const stream =
      args.includes("--stream") || (process.stderr.isTTY && !args.includes("--no-stream"));
    const inline = args.slice(1).filter((a) => a !== "--stream" && a !== "--no-stream").join(" ");
    const text = fromFile !== null ? fromFile : inline;
    if (!text.trim()) fail("send needs <seat> <text>, or --body-file <path>");
    await cmdSend(args[0], text, { stream });
  } else if (cmd === "queue") await cmdQueue();
  else if (cmd === "watch") {
    // Same precedence as `send --stream`: an explicit flag wins, otherwise a
    // terminal gets the readable view and a pipe keeps the JSON contract.
    const human = rest.includes("--human") || (Boolean(process.stdout.isTTY) && !rest.includes("--json"));
    await cmdWatch(rest.includes("--once"), human);
  } else if (cmd === "status") await cmdStatus();
  else if (cmd === "metrics") {
    // Same precedence as watch/check: an explicit flag wins, otherwise a
    // terminal gets the readable table and a pipe keeps the JSON contract (D19).
    const human = rest.includes("--human") || (Boolean(process.stdout.isTTY) && !rest.includes("--json"));
    const rigFile = rest.find((a) => !a.startsWith("--"));
    const at = rest.indexOf("--window");
    await cmdMetrics(rigFile, human, at >= 0 ? rest[at + 1] : undefined);
  }
  else if (cmd === "check") {
    const human = rest.includes("--human") || (Boolean(process.stdout.isTTY) && !rest.includes("--json"));
    await cmdCheck(rest.find((a) => !a.startsWith("--")), human);
  }
  else if (cmd === "optimize") await cmdOptimize(rest);
  else if (cmd === "config") await cmdConfig();
  else if (cmd === "log") {
    if (!rest[0]) fail("log needs <seat>");
    // A numeric positional is the limit; flags are order-independent so
    // `log pm --follow 50` and `log pm 50 --follow` behave the same.
    const limitArg = rest.slice(1).find((a) => /^\d+$/.test(a));
    const human = rest.includes("--human") || (Boolean(process.stdout.isTTY) && !rest.includes("--json"));
    const themeArg = rest.find((a) => a.startsWith("--theme="));
    const theme = themeArg?.slice("--theme=".length);
    if (theme !== undefined && theme !== "dark" && theme !== "light") fail(`--theme must be dark or light, got: ${theme}`);
    await cmdLog(rest[0], limitArg, {
      follow: rest.includes("--follow"),
      human,
      full: rest.includes("--full"),
      // Opt-in only: a fixed tint misreads on an unknown terminal background.
      toolBg: rest.includes("--tool-bg"),
      theme: theme ?? "dark",
    });
  } else {
    out({ ok: false, usage: USAGE.trim() });
    process.exit(2);
  }
} catch (err) {
  fail(err);
}
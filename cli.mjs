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
import { AssistantEntry, configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
import { describeConfig, loadConfig, streamSettings } from "./src/config.mjs";
import { applyEscalations, failureStreak, planEscalations } from "./src/supervisor.mjs";
import {
	readGenerationSlots,
	wrapProviderWithSlots,
} from "./src/genlock.mjs";
import { WakeScheduler, createWakeSignal } from "./src/scheduler.mjs";
import { brokerAlive, clearBrokerState, clearStopRequest, drivePass, readBrokerState, readStopRequest, runWakeLoop, stopRequestPath, writeBrokerState, writeStopRequest } from "./src/broker.mjs";
import { optimizeInstruction } from "./src/optimizer.mjs";
import { withStoreWriteRetry } from "./src/storewrite.mjs";
import { createLiveRenderer, wrapProviderWithLiveView } from "./src/streamview.mjs";
import { SCAN_LIMIT, extractEntryText, summarizeEntries } from "./src/rigstory.mjs";
import { formatMetrics } from "./src/metrics.mjs";
import { activeSet, formatProvenance, gitProvenance } from "./src/provenance.mjs";
import { extensionNames, loadExtensions, parseExtensionList } from "./src/extensions.mjs";
import { formatChat, formatPartial } from "./src/chatview.mjs";
import { readLiveState, readRigHealth, readSeatList } from "./src/readapi.mjs";
import { partialView } from "./src/viewmodel.mjs";
import { createWorktree } from "./src/worktree.mjs";
import { auditRig, formatCheck } from "./src/checkup.mjs";
import { SeatGuard } from "./src/seatguard.mjs";
import { SeatTools, fillRoster, makeSeatEnv, scopeSeatTools } from "./src/seattools.mjs";
import { createWatchScreen, formatSnapshot } from "./src/watchview.mjs";
import { readFeed } from "./src/eventfeed.mjs";

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
// This CLI file's own path, so a parent can respawn the resident broker with the
// same interpreter and the same script regardless of the invoking shell's cwd.
const CLI_PATH = fileURLToPath(import.meta.url);
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
  // The stack is the only thing that names the call site, and losing it is how a
  // crash like the driver's `unresolvable path` became untraceable. Keep the
  // one-line message by default (byte-stable for callers), full stack on request.
  out({ ok: false, error: process.env.DURIG_DEBUG ? (error?.stack ?? String(error)) : String(error?.message ?? error) });
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

async function openHarness({ resume = true, live = null, enforceSeatRoot = false } = {}) {
  const { models, providerId } = buildModels(live);
  // createRegistry() holds only built-in tasks; without installing the Router
  // extension no seat conversation ever sees the durig tools
  // (send_work/claim_work/...) and real models narrate work as chat text
  // instead of routing it (root cause of the 2026-10-09 bug).
  const registry = createRegistry();
  registry.install(Router);
  // The guard and the seat tools go in for every seat; which of them a given seat may actually
  // call is narrowed per conversation (see `scopeVerifierTools`). The guard is installed next to
  // the Router so no seat is ever given a tool without the policy that governs it.
  registry.install(SeatGuard);
  registry.install(SeatTools);
  // Configured extensions install on top of the core. Loading is eager and fatal
  // on error, because a declared extension that cannot load must never be
  // skipped quietly - the rig would look configured and run without it (see
  // src/extensions.mjs). A conversation that stores no selection follows the
  // host, so everything installed here is active for every seat.
  const extensions = await loadExtensions(parseExtensionList(CFG.DURIG_EXTENSIONS));
  for (const { extension } of extensions) registry.install(extension);
  // The roster is consulted per tool call, so it is filled once the harness exists: the seat
  // list is read through that harness, and `env` is an argument to opening it. Until the fill
  // runs, `makeSeatEnv` fails closed (read-only), so the gap is safe rather than open.
  const seatRoster = new Map();
  const harness = await Harness.open(
    await openNodeSqliteStorage(DB_PATH),
    {
      models,
      registry,
      env: makeSeatEnv(seatRoster),
      // Only `stream` is configurable here; the rest of pi-durable's settings keep
      // their built-in defaults, which were chosen deliberately and which nothing
      // in durig's use argues against. See `streamSettings` for why this one matters.
      settings: streamSettings(CFG),
    },
    BACKGROUND_CONTEXT,
  );
  // Persisted storage restarts idle; resume() re-arms task scheduling so
  // queued work and interrupted runs continue (blog restart recipe).
  // Viewers skip it: enabling scheduling is a write-side act and would let
  // a passive `watch` kick the very queue it is observing.
  if (resume) harness.resume();
  const rosterDoc = await harness.documentState(Seats, undefined, BACKGROUND_CONTEXT);
  fillRoster(seatRoster, rosterDoc?.value?.seats);
  // DOGFOOD F12: a write-side run must never silently proceed against a tree the
  // operator did not name. Each seat's working directory is resolved ONCE at `up`
  // time (seat.cwd ?? spec.cwd ?? DURIG_SEAT_ROOT) and persisted onto the
  // conversation; a later launch with a different DURIG_SEAT_ROOT would otherwise
  // run against the persisted (stale/wrong) tree and look successful. So when
  // DURIG_SEAT_ROOT is set and differs from a seat's persisted cwd, the write-side
  // command (`send`/`run`) fails CLOSED, naming both paths and the fix. This lives
  // here (once per command, where the write-side harness is opened), NOT in
  // makeSeatEnv (which runs per tool call and must stay cheap).
  if (enforceSeatRoot && CFG.DURIG_SEAT_ROOT) {
    const root = normalizePath(CFG.DURIG_SEAT_ROOT);
    const seatsVal = rosterDoc?.value?.seats ?? {};
    let mismatched = null;
    for (const [name, s] of Object.entries(seatsVal)) {
      let persistedCwd;
      try {
        const conv = await harness.conversation(s.conversationId, BACKGROUND_CONTEXT);
        persistedCwd = conv ? (await conv.agent(BACKGROUND_CONTEXT))?.cwd : undefined;
      } catch (err) {
        // The guard exists to fail CLOSED, so a failure to read a seat's persisted
        // cwd must stop the run rather than be swallowed into a false "no mismatch".
        fail(
          `cannot read seat "${name}" persisted cwd to enforce the DURIG_SEAT_ROOT guard: ${err?.message ?? err}`,
        );
      }
      if (persistedCwd && normalizePath(persistedCwd) !== root) {
        mismatched = { name, persistedCwd };
        break;
      }
    }
    if (mismatched) {
      fail(
        `seat "${mismatched.name}" is pointed at a different worktree than DURIG_SEAT_ROOT: persisted cwd "${mismatched.persistedCwd}" vs DURIG_SEAT_ROOT "${CFG.DURIG_SEAT_ROOT}". Fix: re-point it with "up --refresh" under the new root, or unset DURIG_SEAT_ROOT.`,
      );
    }
  }
  return { harness, models, providerId, extensions: extensionNames(extensions) };
}

// Normalize a path for equality comparison: absolute, separator-normalised, and
// case-folded on Windows (where the filesystem is case-insensitive). Used only by
// the F12 seat-root guard so "C:\A\durig" and "c:/a/durig/" count as the same tree.
function normalizePath(p) {
  let out = p.replace(/\\/g, "/");
  while (out.endsWith("/")) out = out.slice(0, -1);
  return process.platform === "win32" ? out.toLowerCase() : out;
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
    "- defer_work(itemId, question[, to]): stop and ask instead of guessing, or instead of going quiet. Parks the item you hold on the question; omit `to` to defer to the human operator, pass `to` to ask another seat as well.",
    "- resume_work(itemId): take back a deferred item once the answer has arrived, then finish it with complete_work.",
    "- hold_work(itemId, reason?): park one of your claimed items so it becomes unclaimable until released; reason is optional.",
    "- release_work(itemId): restore a held item to queued, so the driver can re-wake the seat.",
    "- revise_work(itemId, {subject?, body?}): fix the subject/body of a QUEUED item you sent or were sent, before it is claimed.",
    "- cancel_work(itemId, reason): cancel a stale or superseded item (one you sent or were sent). Terminal: it is never claimed and never woken for.",
    "- peek_queue([all]): read the queue. By default your non-terminal items (addressed to or sent by you); pass all=true for the team-wide, all-status view when coordinating or debugging.",
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
async function cmdUp(rigFile, refresh = false, { serve = false } = {}) {
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
  const created = [];
  const existing = [];
  const refreshed = [];
  const { harness, models, providerId, extensions } = await openHarness();
  // #402 (#148 half-2; lead #241 ruling) — the model-change reset seam lives in cmdUp,
  // NOT the wake path (no second wake-adjacent execution path, the #121 binding).
  // Detection is read-only: rig-resolved seat model vs the model each existing seat's
  // conversation last RAN under (newest pi.assistant entry). RigQueue is read in the
  // same pass so the handoff can carry in-flight claimed item ids (#154).
  //   bare up   → detect + REPORT ONLY (no write, no silent no-op): the mismatch is in
  //               the JSON (`modelMismatch`) and a stderr notice names `up --refresh`.
  //   --refresh → the ONLY apply path: detect → reset via the SHARED boundary mechanism
  //               (lease-guarded conversation.reset(handoff)) → configure, so the new
  //               model starts from a clean context. Idempotent: change-only (a second
  //               --refresh with no further change writes nothing).
  const resolvedPromptBySeat = new Map();
  let modelMismatch = [];
  let modelReset = [];
  let modelRefused = [];
  try {
    // Resolve prompts once (the commit loop reuses them; detection compares them).
    for (const seat of spec.seats) {
      resolvedPromptBySeat.set(seat.name, await buildSeatPrompt(models, seat, providerId));
    }
    // Read-only detection pass over EXISTING seats (before any write).
    modelMismatch = await detectModelMismatch(harness, spec, resolvedPromptBySeat);
    if (refresh) {
      // Apply path: reset each CHANGED seat's context before reconfiguring it.
      for (const mm of modelMismatch) {
        const carriedIds = mm.claimedIds.length ? ` Claimed items carried: #${mm.claimedIds.join(" #")}.` : "";
        const handoffText =
          `model-change reset: this seat is reconfigured to ${mm.to} (was ${mm.from});` +
          ` your context was reset so you do not re-condition on turns written for another model.` +
          ` ${carriedIds} Call claim_work to re-enter when you have read your instructions.`;
        const result = await resetSeatContext(harness, mm.seat, handoffText, DB_PATH);
        if (result.refused) {
          // Live-leased seat: skip BOTH reset and reconfigure for this seat (a half-applied
          // model switch is the worse state); the operator re-runs --refresh when idle.
          // The refusal stays VISIBLE (stderr + JSON), never a silent no-op.
          modelRefused.push({ seat: mm.seat, from: mm.from, to: mm.to, reason: result.reason });
          console.error(
            `up: seat ${mm.seat} holds a live generation lease; model change ${mm.from} → ${mm.to} NOT applied — re-run up --refresh after it settles`,
          );
        } else {
          modelReset.push({ seat: mm.seat, from: mm.from, to: mm.to, resetEntryId: result.resetEntryId });
        }
      }
    } else if (modelMismatch.length > 0) {
      // Bare up: report WITHOUT writing. stderr for the human; JSON carries the facts.
      for (const mm of modelMismatch) {
        console.error(
          `up: seat ${mm.seat} configured model ${mm.to} differs from its conversation's model ${mm.from}; run 'up --refresh' to apply the reset handoff`,
        );
      }
    }
  } catch (err) {
    // Detection/resets must never wedge the rig bootstrap: report and continue with
    // the normal up path (creation still works; the mismatch stays unhandled and
    // the NEXT bare up re-reports it).
    console.error(`up: model-change seam error: ${err?.message ?? err}`);
    modelMismatch = [];
  }
  try {
    await harness.commit(async (tx) => {
      const seatsDoc = await tx.doc(Seats);
      for (const seat of spec.seats) {
        // Prompts were resolved once above (detection pass) and are REUSED here —
        // a second buildSeatPrompt would run the optimizer twice (DURIG_OPTIMIZE=on).
        const prompt = resolvedPromptBySeat.get(seat.name) ?? (await buildSeatPrompt(models, seat, providerId));
        // A rig may point its seats at an isolated tree: `seat.cwd` overrides `spec.cwd`, and with
        // neither the seat keeps the harness default. Recorded per conversation because that is
        // what the env function consults, so a renewal cannot silently widen the boundary.
        //
        // `DURIG_SEAT_ROOT` is the last fallback, and it exists so a rig file can stay portable:
        // a committed rig that named `C:/tmp/...` would persist a host-absolute path in git, which
        // is exactly what ROADMAP item 34 warns against - and it would be wrong on any other
        // machine. The operator points the run at a worktree instead.
        const seatCwd = seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT;
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
            ...(seatCwd === undefined ? {} : { cwd: seatCwd }),
            ...(seat.thinkingLevel === undefined ? {} : { thinkingLevel: seat.thinkingLevel }),
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
          ...(seatCwd === undefined ? {} : { cwd: seatCwd }),
          ...(seat.thinkingLevel === undefined ? {} : { thinkingLevel: seat.thinkingLevel }),
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
      // A seat is given only the tools its capabilities justify: one that neither implements nor
      // verifies keeps no working tools, so "route it" is enforced by capability rather than by
      // the sentence (F9). Done here rather than at install time because one tool set is installed
      // for every seat and scoping is a per-conversation decision - and after the loop, so it
      // covers the create and the refresh paths alike.
      await scopeSeatTools(configure, tx, seatsDoc.seats);
      // Materialize the queue even when empty: otherwise it comes into
      // existence only at the first enqueue, and a freshly bootstrapped rig
      // has nothing for `watch` to observe.
      await tx.doc(RigQueue);
    }, BACKGROUND_CONTEXT);
    // Report the extensions this process installed: they are active for every
    // seat, and a set the operator forgot they configured is worth seeing.
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
  // Start the resident broker only AFTER this process releases the harness, so a
  // scripted `up` and the broker it spawns are never two writers at once.
  const broker = serve ? await ensureBroker() : { started: false, reason: "disabled (--no-serve or non-interactive)" };
  out({
    ok: true,
    command: "up",
    db: DB_PATH,
    created,
    existing,
    refreshed,
    extensions,
    broker,
    // #402: bare up reports detected mismatches (write NOTHING); --refresh reports what
    // it reset (and anything it refused for a live lease — the operator re-runs when idle).
    ...(modelMismatch.length ? { modelMismatch: modelMismatch.map(({ seat, from, to }) => ({ seat, from, to })) } : {}),
    ...(refresh && modelReset.length ? { modelReset } : {}),
    ...(refresh && modelRefused.length ? { modelRefused } : {}),
  });
}

// worktree: an isolated checkout for one work item.
//
// Seats are confined to their `cwd`, so a rig that declares none leaves them in durig's live
// tree - where an author seat can overwrite the operator's uncommitted work. This is how the
// operator gets a tree to point them at instead, with node_modules bridged so the suite runs.
async function cmdWorktree(args) {
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) fail("worktree needs a path, e.g. node cli.mjs worktree C:/tmp/durig-dev/item-1");
  const sourceAt = args.indexOf("--source");
  const source = sourceAt >= 0 ? args[sourceAt + 1] : process.cwd();
  if (sourceAt >= 0 && !source) fail("worktree --source needs a directory");
  try {
    out({ ok: true, command: "worktree", ...(await createWorktree({ source, target })) });
  } catch (error) {
    fail(`cannot create worktree: ${error?.message ?? error}`);
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

// resume (alias: doctor): the deliberate way to advance admitted-but-not-progressing
// submissions (ROADMAP 37b). Opens the harness WITH resume() (re-arming scheduling,
// exactly like `send` and `up`), scans the store for submissions a seat admitted but
// is not advancing, and reconciles each stranded one to a terminal state. A seat with
// a LIVE generation lease is legitimately generating behind that lease, so its
// submission is progressing - not stranded - and is left alone. A submission whose
// conversation belongs to no registered seat is out of scope for the verb.
//   - `queued` (never started): harness.abortSubmission() withdraws it -> `unanswered`.
//   - `placed` (a run started whose process is gone): abortSubmission() returns
//     "already_placed" (the run already picked it up), so cancel the run instead via
//     conversation.abort(), which withdraws queued inputs and aborts the ordinary
//     ownership scope, settling the submissions terminal.
// Reports what it found and what it did to each, in the one-JSON-doc contract.
async function cmdResume() {
  const { harness } = await openHarness();
  try {
    const seatsDoc = await harness.documentState(Seats, undefined, BACKGROUND_CONTEXT);
    const seatsVal = seatsDoc?.value?.seats ?? {};
    const seats = Object.entries(seatsVal);
    const convToSeat = new Map(seats.map(([name, s]) => [s.conversationId, name]));
    noteEmptyRig(seats.length);

    // A seat with a LIVE generation lease is currently generating behind that lease,
    // so its submission is advancing, not stranded (same seatsWithSlot guard the
    // stranded notice computes in readRigHealth / ROADMAP 37a). Only consulted when
    // genlock is actually configured (a finite max-concurrent-seats cap).
    const slots = maxSeats();
    const genSlots = Number.isFinite(slots) ? readGenerationSlots(DB_PATH, slots) : [];
    const seatsWithLiveSlot = new Set(
      genSlots.filter((g) => g.generatingSeat).map((g) => g.generatingSeat),
    );

    // The harness's own unsettled submissions (queued + placed, in id order)
    // restricted to conversations that belong to a registered seat.
    const inspection = await harness.inspect(BACKGROUND_CONTEXT);
    const stranded = (inspection.submissions ?? []).filter(
      (s) =>
        convToSeat.has(s.conversationId) &&
        !seatsWithLiveSlot.has(convToSeat.get(s.conversationId)),
    );

    const actions = [];
    for (const sub of stranded) {
      const seatName = convToSeat.get(sub.conversationId);
      const row = {
        seat: seatName,
        submission: sub.id,
        status: sub.status,
        action: null,
      };
      if (sub.status === "queued") {
        // Never started: withdrawing it is enough to clear the stranded state.
        const r = await harness.abortSubmission(sub.id, BACKGROUND_CONTEXT, sub.conversationId);
        row.action = r === "aborted" ? "withdrawn" : `abortSubmission:${r}`;
      } else {
        // placed: a run started but its process is gone. abortSubmission() returns
        // "already_placed" because the run already has it, so cancel the run instead.
        const r = await harness.abortSubmission(sub.id, BACKGROUND_CONTEXT, sub.conversationId);
        if (r === "already_placed") {
          const conv = await harness.conversation(sub.conversationId, BACKGROUND_CONTEXT);
          if (conv) await conv.abort(BACKGROUND_CONTEXT);
          row.action = "run-cancelled";
        } else {
          row.action = r === "aborted" ? "withdrawn" : `abortSubmission:${r}`;
        }
      }
      actions.push(row);
    }

    out({ ok: true, command: "resume", db: DB_PATH, found: stranded.length, actions });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}

// Shared reset-boundary mechanism (#402, ruling lead #241): ONE boundary-write path.
// `cmdReset` (operator verb) and the `up --refresh` model-change path both delegate here:
// unknown-seat fail, LIVE-LEASE guard (a running seat must not be reset out from under
// itself), watermark, `conversation.reset(handoff)` (writes the `pi.reset` boundary without
// deleting the transcript), then the newest-past-watermark reset entry id.
// Returns the reset entry id, or null when the seat was refused (live lease) — the caller
// reports refusals; this function never writes while a lease is held.
async function resetSeatContext(harness, seatName, handoff, dbPath) {
  const seatsDoc = await harness.documentState(Seats, undefined, BACKGROUND_CONTEXT);
  const seatsVal = seatsDoc?.value?.seats ?? {};
  const seat = seatsVal[seatName];
  if (!seat) {
    noteEmptyRig(Object.keys(seatsVal).length);
    fail(`unknown seat: ${seatName}`);
  }
  const convId = seat.conversationId;

  // Refuse when the seat holds a LIVE generation lease: resetting a running
  // seat out from under its own generation corrupts the very boundary we are
  // trying to draw. Same seatsWithLiveSlot guard the stranded notice and the
  // resume verb compute (readGenerationSlots -> generatingSeat; ROADMAP 37a).
  // Consulted only when genlock is actually configured (a finite cap).
  const slots = maxSeats();
  const genSlots = Number.isFinite(slots) ? readGenerationSlots(DB_PATH, slots) : [];
  const seatsWithLiveSlot = new Set(
    genSlots.filter((g) => g.generatingSeat).map((g) => g.generatingSeat),
  );
  if (seatsWithLiveSlot.has(seatName)) {
    return { refused: true, reason: "live-generation-lease" };
  }

  const conv = await harness.conversation(convId, BACKGROUND_CONTEXT);
  // Identify the reset entry THIS invocation wrote: a watermark before, then
  // the newest pi.reset entry past it (the durable transcript keeps earlier
  // resets too, so the newest-past-watermark is precisely ours, not a prior one).
  const prior = await conv.entries({}, 20, undefined, BACKGROUND_CONTEXT);
  const priorMaxId = prior.items.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0);

  // An omitted or blank handoff means a plain reset (no new user message on
  // the boundary); only a non-blank handoff becomes the `pi.reset` user message.
  const resetHandoff = handoff !== undefined && handoff.trim() !== "" ? handoff : undefined;
  await conv.reset(resetHandoff, BACKGROUND_CONTEXT);

  const after = await conv.entries({ order: "descending" }, 50, undefined, BACKGROUND_CONTEXT);
  const resetEntry = after.items.find(
    (e) => e.kind === "pi.reset" && Number(e.id) > priorMaxId,
  );
  return { refused: false, resetEntryId: resetEntry?.id ?? null, handoff: resetHandoff ?? null };
}

// Model-change DETECTION for the cmdUp reset seam (#402; #148 half-2; lead #241):
// the conversation's CONFIGURED model is what `configure` last wrote (AgentDoc.model —
// the idempotent reference point: the switch boundary this seam drew last time is part
// of that doc), and the rig spec WOULD apply its resolved seat model. A difference is
// an ACTUAL CHANGE that would leave the seat re-conditioning on a context written for
// another model (#148) — the reset fires at that boundary, then configure rewrites it.
// (The newer-pi.assistant ran-under read stays as a comment-level note: ran-under LAGS
// config between refresh and next generation, so it can never provide the idempotent
// reference the ruling demands.)
// Read-only: documentState for Seats + RigQueue in ONE pass (carried claimed ids for
// the handoff, per #154) + one AgentDoc read per existing seat.
// @returns {Array<{seat:string, from:string, to:string, convId:number|string, claimedIds:number[]}>}
import { AgentDoc } from "@earendil-works/pi-durable";
async function detectModelMismatch(harness, spec, resolvedPromptBySeat) {
  const context = BACKGROUND_CONTEXT;
  const [seatsDoc, queueDoc] = await Promise.all([
    harness.documentState(Seats, undefined, context),
    harness.documentState(RigQueue, undefined, context),
  ]);
  const seatsVal = seatsDoc?.value?.seats ?? {};
  const claimedIds = new Map(); // seat -> claimed item ids it holds
  for (const it of queueDoc?.value?.items ?? []) {
    if (it?.status === "claimed" && typeof it?.to === "string") {
      claimedIds.set(it.to, [...(claimedIds.get(it.to) ?? []), it.id]);
    }
  }
  const mismatches = [];
  for (const seat of spec.seats) {
    const registered = seatsVal[seat.name];
    if (!registered) continue; // new seat: created below, nothing ran under anything
    const prompt = resolvedPromptBySeat.get(seat.name);
    if (!prompt) continue;
    const to = `${prompt.seatModel.provider}/${prompt.seatModel.modelId}`;
    // The conversation's configured model: what `configure` last wrote (AgentDoc.model).
    let from = null;
    try {
      const agentDoc = await harness.documentState(AgentDoc, registered.conversationId, context);
      const ref = agentDoc?.value?.model;
      if (ref && typeof ref.provider === "string" && typeof ref.modelId === "string") {
        from = `${ref.provider}/${ref.modelId}`;
      }
    } catch (err) {
      // Unreadable agent doc: cannot know what it is configured under — do not guess.
      // Report nothing for this seat; the operator's explicit `reset` stays available.
      console.error(`up: model detection skipped for ${seat.name} (agent doc unreadable): ${err?.message ?? err}`);
      continue;
    }
    if (from !== null && from !== to) {
      mismatches.push({ seat: seat.name, from, to, convId: registered.conversationId, claimedIds: claimedIds.get(seat.name) ?? [] });
    }
  }
  return mismatches;
}

// reset (alias: clean): the deliberate way to break a seat out of a degenerate
// context (ROADMAP 44). After a model emits a repetition loop, every later turn
// re-conditions on that bad turn in history; pi-durable's conversation.reset()
// writes a `pi.reset` boundary (head: self) so prior turns leave the model
// CONTEXT without deleting the durable transcript. This verb opens the harness
// the same way `send`/`up`/`resume` do, refuses to reset a seat that holds a
// LIVE generation lease (a running seat must not be reset out from under
// itself - same live-slot guard resume/status use), calls conversation.reset()
// with the operator's optional handoff, and reports the reset ENTRY id it wrote.
// The transcript is preserved; only the context head moves past the bad turns.
async function cmdReset(seatName, handoff) {
  const { harness } = await openHarness();
  try {
    // Delegate to the SHARED boundary mechanism (#402): same unknown-seat fail,
    // same live-lease guard, same watermark + conversation.reset write path.
    const result = await resetSeatContext(harness, seatName, handoff, DB_PATH);
    if (result.refused) {
      fail(`seat ${seatName} holds a live generation lease; refusing to reset a running seat`);
    }
    out({
      ok: true,
      command: "reset",
      seat: seatName,
      resetEntryId: result.resetEntryId,
      handoff: result.handoff,
      db: DB_PATH,
    });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}

/**
 * One supervisor pass (ROADMAP 42 / P3). Observe the seats' failure streaks and the questions
 * parked on other seats, decide the human escalations, and apply them through the existing defer
 * channel. Bounded and idempotent, so `run --watch` can call it every pass.
 */
async function superviseOnce(harness, probeStorage, context) {
  const seatsDoc = await harness.documentState(Seats, undefined, context);
  const queueDoc = await harness.documentState(RigQueue, undefined, context);
  const seatList = Object.entries(seatsDoc?.value?.seats ?? {}).map(([name, seat]) => ({ name, ...seat }));
  const failureStreakByConv = new Map();
  for (const seat of seatList) {
    const page = await probeStorage.scanSubmissions(
      { conversationId: seat.conversationId, order: "descending" },
      5,
      undefined,
      context,
    );
    failureStreakByConv.set(seat.conversationId, failureStreak(page.items));
  }
  const plans = planEscalations({ seats: seatList, queueItems: queueDoc?.value?.items, failureStreakByConv });
  return applyEscalations(harness, plans, context);
}

/** Parse `--max-duration <seconds>` (or `--max-duration=<seconds>`) into milliseconds; 0 = unbounded. */
function parseMaxDuration(args) {
  const at = args.findIndex((a) => a === "--max-duration" || a.startsWith("--max-duration="));
  if (at < 0) return 0;
  const raw = args[at].includes("=") ? args[at].slice(args[at].indexOf("=") + 1) : args[at + 1];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 1000) : 0;
}

// run [--watch] [--max-duration <s>]: drive the rig to quiescence (ROADMAP 38). Opens the harness
// WITH resume() so queued work is scheduled, then repeatedly wakes any seat that
// has queued work and nothing advancing it (src/driver.mjs) and waits for the
// rig to go idle, until a pass changes nothing. This is the clock the queue was
// missing: one `send` to route, then `run` finishes the chain without a second
// external send. `--watch` stays resident instead of exiting.
//
// A run is BOUNDED (ROADMAP 42 / #147): an external kill cannot be caught and
// strands admitted submissions and the generation lease. `--max-duration` stops
// the loop at the deadline, and a SIGINT/SIGTERM handler lets the current pass
// settle before the finally closes the harness, so a stopped run does not leave
// `admitted_not_started` behind.
async function cmdRun({ watch = false, maxDurationMs = 0 } = {}) {
  // Two drivers double-wake: if a resident broker is already driving this store,
  // refuse rather than race it. The operator either stops it or uses `up --no-serve`.
  const broker = readBrokerState(DB_PATH);
  if (brokerAlive(broker)) {
    fail(`a resident broker is already driving ${DB_PATH} (pid ${broker.pid}); stop it with "serve --stop", or start the rig with "up --no-serve"`);
  }
  const { harness } = await openHarness({ enforceSeatRoot: true });
  // A raw read-only handle for probing seat documents. The driving harness fails
  // its whole session on the first storage error, so an unreadable `pi.live` must
  // be detected through this handle BEFORE the harness opens that conversation
  // (P5 / #110). One handle for the run; closed with the harness.
  const probeStorage = await openNodeSqliteStorage(DB_PATH);
  // Bounded-run state (#147): `startedAt` drives --max-duration; `stopping` is set by a signal
  // so the loop breaks AFTER the pass in flight settles (waitForIdle), never mid-run. Declared
  // here, not inside the try, because the finally removes the handlers and reports `stoppedBy`.
  const startedAt = Date.now();
  let stoppedBy = null;
  let stopping = false;
  const onSignal = () => {
    stopping = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const maxPasses = watch ? Infinity : 200;
    let passes = 0;
    // Seats whose wake could not be delivered (P5 / #110). Tracked across passes so
    // `run` can report them instead of dying, and never silently drops the work.
    const failedSeats = new Set();
    // Items the supervisor escalated to the human this run (ROADMAP 42 / P3). Measured, not
    // asserted: a pass that escalates nothing adds nothing.
    const escalations = [];
    for (;;) {
      if (stopping) {
        stoppedBy = "signal";
        break;
      }
      if (maxDurationMs > 0 && Date.now() - startedAt >= maxDurationMs) {
        stoppedBy = "max-duration";
        break;
      }
      // One shared pass (src/broker.mjs): the wake decision is `selectWakes`, and
      // the operator-stop fact is read fresh each pass so a `stop` issued while a
      // long `run --watch` is resident is honoured. `serve` uses the same function.
      const { actioned } = await drivePass(harness, probeStorage, {
        context: BACKGROUND_CONTEXT,
        readBusySeats: () => {
          // A live generation lease means the seat is already advancing; a dead one
          // does not, so only LIVE holders are treated as busy (same rule as the
          // stranded notice and the resume verb).
          const slots = maxSeats();
          const genSlots = Number.isFinite(slots) ? readGenerationSlots(DB_PATH, slots) : [];
          return new Set(genSlots.filter((g) => g.generatingSeat).map((g) => g.generatingSeat));
        },
        onError: ({ name, conversationId, error }) => {
          failedSeats.add(name);
          console.error(
            JSON.stringify({
              ok: false,
              command: "run",
              driver: "wake-failed",
              seat: name,
              conversationId,
              error: String(error?.message ?? error),
            }),
          );
        },
      });
      passes++;
      if (!watch && actioned === 0) break;
      if (passes >= maxPasses) break;
      if (watch) {
        // Supervisor pass (ROADMAP 42 / P3): persistent failures and questions parked on an
        // unanswering seat are escalated to the human through the existing defer channel.
        const escalated = await superviseOnce(harness, probeStorage, BACKGROUND_CONTEXT);
        for (const plan of escalated) {
          console.error(
            JSON.stringify({
              ok: false,
              command: "run",
              supervisor: "escalated",
              seat: plan.seat,
              itemId: plan.itemId,
              reason: plan.reason,
            }),
          );
        }
        escalations.push(...escalated);
      }
      if (watch) await new Promise((r) => setTimeout(r, 750));
    }
    out({ ok: true, command: "run", db: DB_PATH, passes, failedSeats: [...failedSeats], stoppedBy, escalated: escalations.length });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await harness.close(BACKGROUND_CONTEXT);
    await probeStorage.close(BACKGROUND_CONTEXT);
  }
}

// ensureBroker — the auto-start seam for `up`. Idempotent: a live broker is reused,
// never duplicated (two brokers would be two drivers). It verifies the child actually
// came up before reporting success, so `up` cannot claim a broker that failed.
//
// The child is detached with stdout/stderr to `<db>.broker.log` because it must
// outlive this `up` process and must never write into this command's stdout (the
// JSON contract). `windowsHide` avoids a console flash on this host.
async function ensureBroker() {
  const existing = readBrokerState(DB_PATH);
  if (brokerAlive(existing)) {
    return { started: false, reason: "already running", pid: existing.pid };
  }
  // A dead holder leaves a stale file; the child overwrites it, but clearing first
  // keeps a concurrent reader from mistaking the dead pid for a live one.
  clearBrokerState(DB_PATH);
  clearStopRequest(DB_PATH);
  const logPath = `${DB_PATH}.broker.log`;
  let logFd;
  try {
    logFd = openSync(logPath, "a");
  } catch (err) {
    fail(`cannot open the broker log ${logPath}: ${err?.message ?? err}`);
  }
  let child;
  try {
    child = spawn(process.execPath, [CLI_PATH, "serve"], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
  } finally {
    closeSync(logFd);
  }
  // Wait for the child's pidfile (or its early exit) so `up` reports the truth.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const state = readBrokerState(DB_PATH);
    if (brokerAlive(state)) return { started: true, pid: state.pid, log: logPath };
    if (child.exitCode !== null) {
      return { started: false, reason: `broker exited (code ${child.exitCode}); see ${logPath}` };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { started: false, reason: `broker did not report within 3s; see ${logPath}` };
}

// serve --stop: the off switch for a broker started by `up` (or by hand). On POSIX
// the broker receives SIGTERM and stops after the pass in flight settles. On Windows
// Node does not deliver SIGTERM, so the fallback is to write a .stop request file that
// the broker polls between passes (F35). If the broker is still alive after 5s,
// process.kill is the last resort.
async function cmdStopBroker() {
  const state = readBrokerState(DB_PATH);
  if (!state) {
    out({ ok: true, command: "serve", action: "stop", db: DB_PATH, stopped: false, reason: "no broker is running" });
    return;
  }
  if (!brokerAlive(state)) {
    clearBrokerState(DB_PATH);
    out({ ok: true, command: "serve", action: "stop", db: DB_PATH, stopped: false, reason: "state was stale; cleared" });
    return;
  }
  // Write the stop request; the broker polls this between passes and exits cleanly
  // after the pass in flight settles (same behaviour as SIGTERM on POSIX).
  // Under load (multiple in-flight generations), a pass can take longer than the
  // previous 5s window, so we give up to 60s for cooperative settlement. No forced
  // kill: the broker WILL exit once its pass settles — waiting longer honours that.
  writeStopRequest(DB_PATH);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && brokerAlive(state)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const stillAlive = brokerAlive(state);
  if (!stillAlive) {
    clearBrokerState(DB_PATH);
    clearStopRequest(DB_PATH);
    out({
      ok: true,
      command: "serve",
      action: "stop",
      db: DB_PATH,
      stopped: true,
      pid: state.pid,
    });
    return;
  }
  // Bounded grace period expired: the broker could not settle in time. Do not
  // force-kill — the operator should investigate with `status`.
  console.warn(
    `serve --stop: broker pid ${state.pid} did not exit within 60s; ` +
      `pass may still be in-flight — check with \`serve --stop\` again`,
  );
  out({
    ok: true,
    command: "serve",
    action: "stop",
    db: DB_PATH,
    stopped: false,
    pid: state.pid,
    reason: "pass did not settle within 60s; no forced kill — check status again",
  });
}

// serve [--max-duration <s>] (D45): the RESIDENT BROKER. `run` is a clock — a human
// must invoke it, and ROADMAP 38's self-driving queue needs a process that keeps
// driving. `serve` opens the harness once, subscribes to its in-process commit
// stream, and runs a wake pass whenever the store changes: an enqueue/claim/done
// wakes the right seat with no external clock. It is the single long-lived writer
// that *is* the harness, so it has none of the cross-process gap D11 documents for
// viewers (docs/DECISIONS.md D45); read-only `watch`/`log` keep D11's poll.
//
// The scheduler (src/scheduler.mjs) coalesces commits into one pass, floors pass
// starts, and cools off a per-seat retry so a re-woken stalled claim cannot hot-loop.
// The supervisor runs each pass, exactly as `run --watch`. Bounded with
// --max-duration; SIGINT/SIGTERM stop after the pass in flight settles.
async function cmdServe({ maxDurationMs = 0, stop = false } = {}) {
  if (stop) return cmdStopBroker();
  // One broker per database: a second would be a second driver, and its wakes would
  // race the first's. A live holder fails closed; a dead one is stale and replaced.
  const existing = readBrokerState(DB_PATH);
  if (brokerAlive(existing)) {
    fail(`a broker is already running for ${DB_PATH} (pid ${existing.pid}); stop it with "serve --stop" first`);
  }
  const { harness } = await openHarness({ enforceSeatRoot: true });
  const probeStorage = await openNodeSqliteStorage(DB_PATH);
  const scheduler = new WakeScheduler({
    minIntervalMs: 500,
    seatCooldownMs: SERVE_SEAT_COOLDOWN_MS,
  });
  const signal = createWakeSignal();
  // #473: determine worktree source (git repo root) from the current directory.
  // If not a git repo, worktree lifecycle is disabled.
  const { repoRoot } = await import("./src/worktree.mjs");
  const worktreeSource = await (async () => {
    try {
      return await repoRoot(process.cwd());
    } catch (err) {
      // Worktree lifecycle disabled: process.cwd() is not a git repository,
      // so per-item worktrees cannot be created.
      console.error(`worktree lifecycle disabled: ${err.message}`);
      return null;
    }
  })();
  // Subscribe BEFORE the first pass so a commit that lands during startup is not
  // missed. The listener must not throw, block, or call Session APIs: it only
  // classifies the commit and raises the signal.
  const unsubscribe = harness.subscribeCommits((publication) => {
    scheduler.notify(publication);
    if (scheduler.dirty) signal.raise();
  });
  const startedAt = Date.now();
  let stopping = false;
  const onSignal = () => {
    stopping = true;
    signal.raise(); // interrupt a resting wait, so a signal is not stuck behind the floor
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    writeBrokerState(DB_PATH, { pid: process.pid, since: new Date().toISOString() });
    const result = await runWakeLoop({
      harness,
      probeStorage,
      scheduler,
      signal,
      context: BACKGROUND_CONTEXT,
      readBusySeats: () => {
        const slots = maxSeats();
        const genSlots = Number.isFinite(slots) ? readGenerationSlots(DB_PATH, slots) : [];
        return new Set(genSlots.filter((g) => g.generatingSeat).map((g) => g.generatingSeat));
      },
      supervise: () => superviseOnce(harness, probeStorage, BACKGROUND_CONTEXT),
      onDiagnostic: (d) => {
        if (d.kind === "wake-failed") {
          console.error(
            JSON.stringify({
              ok: false,
              command: "serve",
              driver: "wake-failed",
              seat: d.name,
              conversationId: d.conversationId,
              error: String(d.error?.message ?? d.error),
            }),
          );
        } else if (d.kind === "escalated") {
          console.error(
            JSON.stringify({
              ok: false,
              command: "serve",
              supervisor: "escalated",
              seat: d.seat,
              itemId: d.itemId,
              reason: d.reason,
            }),
          );
        }
      },
      maxDurationMs,
      startedAt,
      isStopping: () => stopping,
      dbPath: DB_PATH,
      source: worktreeSource,
      worktreeRoot: process.cwd(),
    });
    out({
      ok: true,
      command: "serve",
      db: DB_PATH,
      passes: result.passes,
      failedSeats: result.failedSeats,
      escalated: result.escalations.length,
      stoppedBy: result.stoppedBy,
    });
  } finally {
    // Clear only OUR state: a newer broker that already took over must keep its file.
    clearBrokerState(DB_PATH, process.pid);
    clearStopRequest(DB_PATH);
    unsubscribe();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await harness.close(BACKGROUND_CONTEXT);
    await probeStorage.close(BACKGROUND_CONTEXT);
  }
}

// stop <seat> [reason] (emergency-stop): a deliberate operator surface that halts
// a seat's in-flight run across processes (ROADMAP 41). A seat that has entered a
// degenerate loop, or is behaving harmfully, can be stopped WITHOUT killing the
// driving `send` process in a way that silently strands an admitted-but-unscheduled
// submission (dogfood F11). Enforcement is by the driver/lease, not by a message to
// the agent: `stop` finds the seat's live generation-lease holder (the cross-process
// driver) and kills it, then settles the run's submission to a terminal
// `aborted: <reason>` state (which the attention channel surfaces as
// `last_run_failed`) and aborts the run's task so resume won't resurrect it.
//   - (i)  no agent cooperation required: the halt is the lease holder's pid kill.
//   - (ii) reaches a run in ANOTHER process: the lease (signal/kill the holder pid).
//   - (iii) fail closed: the pending submission reaches terminal `unanswered` with
//          reason `aborted: <reason>`, never a silent strand.
//   - (iv) durable work preserved: the queue item, transcript and checkpoints stay
//          in the store; resume (item 37(b)) is unaffected.
//   - (v)  idempotent and bounded: no live holder AND no pending submission means
//          the seat is already stopped -> a no-op; one command halves one seat.
async function cmdStop(seatName, reason) {
  const stopReason =
    reason !== undefined && reason.trim() !== "" ? reason.trim() : "operator stop";
  const { harness } = await openHarness({ resume: false });
  try {
    const seatsDoc = await harness.documentState(Seats, undefined, BACKGROUND_CONTEXT);
    const seatsVal = seatsDoc?.value?.seats ?? {};
    const seat = seatsVal[seatName];
    if (!seat) {
      noteEmptyRig(Object.keys(seatsVal).length);
      fail(`unknown seat: ${seatName}`);
    }
    const convId = seat.conversationId;

    // The cross-process holder is the seat's LIVE generation-lease slot: that is
    // how durig knows WHO is driving a run (D12). Consulted only when genlock is
    // actually configured (a finite max-concurrent-seats cap).
    const slots = maxSeats();
    const genSlots = Number.isFinite(slots) ? readGenerationSlots(DB_PATH, slots) : [];
    const holder = genSlots.find((g) => g.generatingSeat === seatName);

    // The pending run is the seat's latest queued (never started) or placed (a run
    // started) submission. From the harness's own unsettled-submissions view.
    const inspection = await harness.inspect(BACKGROUND_CONTEXT);
    const pending = (inspection.submissions ?? []).find(
      (s) => s.conversationId === convId && (s.status === "queued" || s.status === "placed"),
    );

    // (v) idempotence: no live holder AND no pending run means the seat is already
    // stopped (or never running) - one command halts one seat, a second is a no-op.
    if (!holder && !pending) {
      out({
        ok: true,
        command: "stop",
        seat: seatName,
        reason: stopReason,
        alreadyStopped: true,
        db: DB_PATH,
      });
      return;
    }

    // (ii) guarantee the halt: kill the cross-process driver that holds the lease.
    let killed = null;
    let killError = null;
    let slotPath = null;
    if (holder && Number.isFinite(holder.pid)) {
      killed = holder.pid;
      slotPath = `${DB_PATH}.genlock.${holder.slotIndex}`;
      try {
        process.kill(killed, "SIGKILL");
      } catch (err) {
        // The holder may already have died, which only helps the stop; the reason is
        // captured and reported so a failed kill against a LIVE pid is not swallowed.
        killError = String(err?.message ?? err);
      }
    }

    // (iii) settle the pending submission to terminal `aborted: <reason>`, and
    // abort the run's task so a later resume does not resurrect it. settleSubmission
    // is called while the submission is non-terminal so the custom reason carries
    // onto the record; abortTask is the durable abort mark that stops re-running.
    let settled = false;
    if (pending) {
      await harness.commit(
        (tx) => {
          tx.settleSubmission(pending.id, {
            status: "unanswered",
            reason: `aborted: ${stopReason}`,
          });
        },
        BACKGROUND_CONTEXT,
      );
      settled = true;
    }
    const runTask = (inspection.tasks ?? []).find((t) => t.record.conversationId === convId);
    if (runTask) {
      await harness.abortTask(runTask.record.id, BACKGROUND_CONTEXT);
    }

    // Release the lease slot the killed holder held, so `status`/`watch` no longer
    // report a wedged generation for it.
    if (slotPath) {
      try {
        unlinkSync(slotPath);
      } catch (err) {
        // ENOENT means another process already released the slot; any other failure
        // must stay visible, because the lease would otherwise remain wedged.
        if (err?.code !== "ENOENT") {
          console.error(
            JSON.stringify({ ok: false, command: "stop", note: "lease release failed", slot: slotPath, error: String(err) }),
          );
        }
      }
    }

    out({
      ok: true,
      command: "stop",
      seat: seatName,
      reason: stopReason,
      killed,
      killError,
      aborted: settled,
      db: DB_PATH,
    });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}

// send <seat> <text> [--stream|--no-stream]: operator steering. Submits input
// to the seat's conversation and waits for the run to settle so the caller
// can read the outcome in the same invocation (LLM-friendly: no polling
// loop needed). With a live view (default when stderr is a terminal) the
// generation streams to stderr, labelled per seat; stdout stays one JSON doc.
async function cmdSend(seatName, text, { stream = false, requestId = null } = {}) {
  const live = stream ? createLiveRenderer({ color: Boolean(process.stderr.isTTY) && !process.env.NO_COLOR }) : null;
  // F24: retry the whole send on the cross-process entry-id conflict. The
  // conflict fires at storage ADMISSION, before any generation, and its commit
  // rolled back, so re-opening the harness (fresh next_id) and retrying cannot
  // double-run the model or duplicate the message - it just loses the race to a
  // concurrent writer and runs again on a correctly-resynced store.
  // KNOWN LIMIT: `up`/`run` (broker) are NOT covered by this retry.
  await withStoreWriteRetry(
    async () => {
      const { harness, providerId } = await openHarness({ live, enforceSeatRoot: true });
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
            {
              type: "input",
              content: text,
              ...(requestId === null ? {} : { requestId }),
            },
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
          // Resolving the reply takes one of two routes, and the choice is the whole
          // point of --request-id:
          //  - WITHOUT one, only a run that produced something may speak, so the
          //    newest assistant entry past the watermark is the reply. A run that
          //    produced nothing leaves older entries that also differ from the newest,
          //    which is how an earlier send's reply got reported as this one's (F7).
          //  - WITH one, the submission is identified by that id, so the platform's own
          //    answer pointer is authoritative. That is not a nicety: a retry carrying
          //    an id already used gets the EXISTING submission back, whose answer was
          //    committed before this invocation's watermark - so the scan would find
          //    nothing and report `reply: null` for a request that has a reply.
          const answerExisted =
            requestId !== null &&
            settled.status === "done" &&
            settled.type === "input" &&
            Number(settled.answer) <= priorMaxId;
          let msg;
          if (answerExisted) {
            // By id: the answer is deliberately older than the watermark and may be
            // older than the 50-entry page below.
            const rec = await conv.commit(
              (tx) => tx.entry(AssistantEntry, settled.answer),
              BACKGROUND_CONTEXT,
            );
            msg = rec?.model?.[0];
          } else {
            const pg = await conv.entries({}, 50, undefined, BACKGROUND_CONTEXT);
            // Entries come newest-first; the newest assistant entry this run created
            // is the first one past the watermark.
            const lastAssistant = pg.items.find(
              (e) => e.kind === "pi.assistant" && Number(e.id) > priorMaxId,
            );
            msg = lastAssistant?.model?.[0];
          }
          out({
            ok: true,
            command: "send",
            seat: seatName,
            settledStatus: settled.status,
            settledReason: settled.reason ?? null,
            reply: msg?.content ?? null,
            stopReason: msg?.stopReason ?? null,
            // Only meaningful with an id: it says this invocation did not generate,
            // it re-read a reply that already existed. Without one the field would be
            // a claim about a submission nobody asked to identify.
            ...(requestId === null ? {} : { requestId, reused: answerExisted }),
          });
        } finally {
          delete process.env.DURIG_ACTIVE_SEAT;
          await harness.close(BACKGROUND_CONTEXT);
        }
      }
    },
  );
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
  // Lines of the human transcript already emitted. Kept so the follow renderer
  // can re-run the whole transcript through the SAME grouping path and emit only
  // what has not been shown yet, instead of formatting each later turn as its own
  // isolated block with its own column width and delta (the backfill/later-turn
  // inconsistency ROADMAP item 10 fixes). The whole accumulated transcript goes
  // through one formatChat call, so column alignment and turn grouping match the
  // backfill exactly and a reader cannot tell where the backfill ended.
  let humanLines = [];
  const renderHuman = (entries) => {
    const text = formatChat(entries, {
      seat: seatName,
      color,
      width: process.stdout.columns ?? 100,
      full,
      toolBg,
      theme,
    });
    if (!text) return;
    const lines = text.split("\n");
    // Re-rendering the full transcript is prefix-stable unless a turn regroups
    // (a tool result arriving after the call that produced it folds back into
    // the same turn), so walk from the first divergence rather than trusting the
    // line count: the corrected tail is re-emitted even when an earlier line
    // changes character.
    let i = 0;
    while (i < humanLines.length && i < lines.length && humanLines[i] === lines[i]) i++;
    for (let k = i; k < lines.length; k++) console.log(lines[k]);
    humanLines = lines;
  };
  // Follow keeps one continuous transcript: accumulate, then render it whole.
  // The in-flight partial is read separately and never enters this transcript: it
  // has no entry id, the platform deletes it when the run settles, and a later
  // reader must not be able to replay it as history (ROADMAP 40c).
  let streamingCount = 0;
  let lastPartial = null;
  const renderStreaming = (partial) => {
    const text = formatPartial(partial, { seat: seatName, color });
    const lines = text ? text.split("\n") : [];
    // Erase the previous streaming block first: it is a snapshot, not history, so
    // leaving it above the new one would append each rewrite and read as turns.
    if (streamingCount > 0) process.stdout.write(`\x1b[${streamingCount}A\x1b[J`);
    streamingCount = lines.length;
    if (!lines.length) return;
    if (!interactive) {
      // A pipe cannot retract a half-written line, and a half line that reads as
      // the reply is the exact hazard this item names; only a terminal gets it.
      streamingCount = 0;
      return;
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  };
  const pollPartial = async (conversationId) => {
    const partial = partialView(await readLiveState(storage, conversationId));
    if (human) {
      renderStreaming(partial);
      return;
    }
    // JSON followers get a snapshot with a `partial` key and never `entries`, so a
    // consumer can tell a transient partial from committed history by shape alone.
    const sig = partial ? JSON.stringify(partial) : null;
    if (sig === lastPartial) return;
    lastPartial = sig;
    out({ ok: true, command: "log", seat: seatName, db: DB_PATH, partial });
  };
  const allEntries = [];
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
      if (follow) {
        for (const e of entries) allEntries.push(e);
        renderHuman(allEntries);
      } else {
        renderHuman(entries);
      }
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
    const seats = await readSeatList(storage);
    const seat = seats.find((s) => s.name === seatName);
    if (!seat) {
      noteEmptyRig(seats.length);
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
    await pollPartial(seat.conversationId);
    while (!stopping) {
      await new Promise((r) => setTimeout(r, WATCH_POLL_MS));
      // Clear the streaming block before committed output so a committed turn can
      // never end up above the partial it supersedes on screen.
      if (streamingCount > 0) {
        process.stdout.write(`\x1b[${streamingCount}A\x1b[J`);
        streamingCount = 0;
      }
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
      await pollPartial(seat.conversationId);
    }
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
  }
}

// Storage-level snapshot of everything attention needs: seats, queue and
// the latest submission per seat conversation. Reads committed state
// straight from sqlite (same reasoning as `watch`: session replication is
// in-process only, and a viewer must not resume scheduling).
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
// Per-seat cooldown for the resident broker (D45): a seat re-woken for a stalled
// claim waits this long before the broker will wake it again. The global floor in
// the scheduler bounds bursts; this bounds one seat. Long enough to span a model
// turn, short enough that a genuinely stranded claim still recovers promptly.
const SERVE_SEAT_COOLDOWN_MS = 30_000;

// events [--since <seq>] [--follow] [--json]: the DURABLE event feed (PIECE 2,
// PUSH-ARCHITECTURE §3.1). Read-only and additive: it opens storage directly
// like `watch` (never a harness; D11) and derives a monotonic `seq` cursor from
// committed state, so a late/reconnecting subscriber resumes from `--since`
// rather than replaying. One JSON event per line; diagnostics on stderr.
async function cmdEvents({ sinceSeq = 0, follow = false } = {}) {
  const storage = await openNodeSqliteStorage(DB_PATH);
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  let cursor = Number.isFinite(sinceSeq) ? sinceSeq : 0;
  try {
    do {
      const { events, nextSeq } = await readFeed(storage, BACKGROUND_CONTEXT, { sinceSeq: cursor });
      for (const event of events) console.log(JSON.stringify(event));
      // Advance the cursor past what we emitted, so a --follow poll never
      // replays the previous line and a reconnect resumes from `nextSeq`.
      if (events.length) cursor = Math.max(cursor, nextSeq);
      if (!follow || stopping) break;
      await new Promise((r) => setTimeout(r, WATCH_POLL_MS));
    } while (!stopping);
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
  }
}

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
  const initial = await readRigHealth(storage, DB_PATH, slots, { cfg: CFG });
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
      health = await readRigHealth(storage, DB_PATH, slots, { cfg: CFG });
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
    const health = await readRigHealth(storage, DB_PATH, maxSeats(), { cfg: CFG });
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
  // What was live when these numbers were made (ROADMAP item 19). Gathered per
  // invocation and only reported, because persisting it would be the write path
  // D24 and the security position both declined to add. `active` is the declared
  // set, not the loaded one: loading a module executes it, and a read-only query
  // must not run arbitrary code to describe what it would have run.
  const provenance = {
    ...gitProvenance(process.cwd()),
    active: activeSet(parseExtensionList(CFG.DURIG_EXTENSIONS ?? "")),
  };
  const storage = await openNodeSqliteStorage(DB_PATH);
  try {
    const health = await readRigHealth(storage, DB_PATH, maxSeats(), {
      modelsBySeat: spec ? resolveModelsBySeat(spec) : {},
      entryLimit: parseWindow(windowArg),
      cfg: CFG,
    });
    noteEmptyRig(health.seats.length);
    if (human) {
      process.stdout.write(
        `${formatProvenance(provenance, provenance.active)}\n` +
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
    out({
      ok: true,
      command: "metrics",
      db: DB_PATH,
      rig: rigFile ?? null,
      provenance,
      ...health.metrics,
    });
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
  // Seat names the store holds, for the two directions of seat drift. Null until
  // the store is actually read, because "could not read" must stay distinguishable
  // from "read and empty" - an empty store is a real, reportable disagreement
  // with a rig file that declares seats.
  let storedSeats = null;
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

        storedSeats = (await readSeatList(storage)).map((s) => s.name);
      } finally {
        await storage.close(BACKGROUND_CONTEXT);
      }
    } catch (err) {
      stored = { reason: "unreadable", error: String(err?.message ?? err) };
    }
  }
  const result = auditRig({ rig: rigFile, spec, specConstitution, stored, storedSeats, modelsBySeat });
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
  node cli.mjs up <rig.json> [--refresh] [--serve|--no-serve]   create seats; on a TTY also start the broker (--no-serve disables)
  node cli.mjs ps              list seats
  node cli.mjs send <seat> <text> [--stream]   steer a seat and wait for its reply
  node cli.mjs send <seat> --body-file <path>  the same, prompt from a file (- = stdin)
  node cli.mjs send <seat> <text> --no-stream   the same, without the live view
  node cli.mjs queue           dump the work queue
  node cli.mjs resume          (alias: doctor) advance admitted-but-not-progressing submissions
  node cli.mjs reset <seat> [handoff]   (alias: clean) break a seat out of a degenerate context (writes a reset boundary)
  node cli.mjs run [--watch] [--max-duration <seconds>]   drive to quiescence; --watch resident; --max-duration bounds it
  node cli.mjs serve [--max-duration <seconds>] [--stop]   the resident broker: wake seats from the store's change stream; --stop halts it
  node cli.mjs stop <seat> [reason]      emergency-stop: halts a seat's in-flight run across processes
  node cli.mjs log <seat> [limit] [--follow] [--full] [--tool-bg] [--theme dark|light]
                          a seat's conversation (--follow = live, --full = whole tool output)
  node cli.mjs watch [--once] [--json|--human]   follow rig state (human on a terminal)
  node cli.mjs events [--since <seq>] [--follow]   durable read-only event feed (resumes from <seq>)
  node cli.mjs status           per-seat health + attention notices
  node cli.mjs metrics [rig.json] [--window N|all]   drift measures, with bands and blind spots
  node cli.mjs check <rig.json> [--human]   audit a rig against the research gaps
  node cli.mjs optimize <text>  rewrite a draft instruction via the optimizer
  node cli.mjs config          show effective settings and their source
  node cli.mjs worktree <path> [--source <dir>]   isolate a work item in its own checkout
`;

const [, , cmd, ...rest] = process.argv;
try {
  if (cmd === "up") {
    // Auto-start the resident broker for an INTERACTIVE `up` (stdout is a TTY, like the
    // human views in D19), so a terminal `up` leaves the queue self-driving; piped or
    // scripted `up` never silently spawns a daemon. `--serve` forces it on, `--no-serve`
    // off, and DURIG_NO_SERVE=1 is the script-wide opt-out.
    const forced = rest.includes("--serve") ? true : rest.includes("--no-serve") ? false : undefined;
    const serve = forced ?? (process.stdout.isTTY === true && process.env.DURIG_NO_SERVE !== "1");
    await cmdUp(rest[0], rest.includes("--refresh"), { serve });
  }
  else if (cmd === "worktree") await cmdWorktree(rest);
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
    // --request-id makes one send idempotent: a retry carrying the same id reuses
    // the existing submission instead of starting a second generation. Optional
    // and never invented for the operator, because an id means "this is the same
    // request as before" and only the caller knows that - deriving one from the
    // text would silently collapse two deliberate identical sends into one.
    const reqAt = args.indexOf("--request-id");
    let requestId = null;
    if (reqAt >= 0) {
      requestId = args[reqAt + 1];
      if (!requestId || requestId.startsWith("--")) fail("send --request-id needs a value");
    }
    // Walked rather than filtered, so the value after --request-id is dropped
    // wherever it sits instead of leaking into the prompt.
    const inline = [];
    const textArgs = args.slice(1);
    for (let i = 0; i < textArgs.length; i += 1) {
      const a = textArgs[i];
      if (a === "--stream" || a === "--no-stream") continue;
      if (a === "--request-id") {
        i += 1;
        continue;
      }
      inline.push(a);
    }
    const text = fromFile !== null ? fromFile : inline.join(" ");
    if (!text.trim()) fail("send needs <seat> <text>, or --body-file <path>");
    await cmdSend(args[0], text, { stream, requestId });
  } else if (cmd === "queue") await cmdQueue();
  else if (cmd === "resume" || cmd === "doctor") await cmdResume();
  else if (cmd === "run") await cmdRun({ watch: rest.includes("--watch"), maxDurationMs: parseMaxDuration(rest) });
  else if (cmd === "serve") await cmdServe({ maxDurationMs: parseMaxDuration(rest), stop: rest.includes("--stop") });
  else if (cmd === "stop") {
    if (!rest[0]) fail("stop needs <seat> [reason]");
    await cmdStop(rest[0], rest.slice(1).join(" "));
  }
  else if (cmd === "reset" || cmd === "clean") {
    if (!rest[0]) fail("reset needs <seat> [handoff]");
    await cmdReset(rest[0], rest.slice(1).join(" "));
  }
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
  } else if (cmd === "events") {
    // Read-only durable feed (PUSH-ARCHITECTURE §3.1). --since <seq> resumes
    // strictly after a cursor; --follow keeps the process open and polls.
    const at = rest.indexOf("--since");
    const sinceArg = at >= 0 ? rest[at + 1] : undefined;
    if (at >= 0 && (sinceArg === undefined || sinceArg.startsWith("--")))
      fail("events --since needs a number");
    const sinceSeq = sinceArg === undefined ? 0 : Number(sinceArg);
    if (!Number.isFinite(sinceSeq) || sinceSeq < 0)
      fail(`events --since must be a non-negative number, got: ${sinceArg}`);
    await cmdEvents({ sinceSeq, follow: rest.includes("--follow") });
  }
  else if (cmd === "--help" || cmd === "help") {
    process.stderr.write(USAGE);
    process.exit(0);
  }
  else {
    out({ ok: false, usage: USAGE.trim() });
    process.exit(2);
  }
} catch (err) {
  fail(err);
}
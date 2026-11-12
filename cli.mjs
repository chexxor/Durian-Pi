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
// FIRST import on purpose: it installs the SIGINT/SIGTERM seam before the rest of the
// import graph resolves, so a Ctrl-C during load is reported (exit 130) instead of dying
// by node's default. See src/cli-seam.mjs.
import "./src/cli-seam.mjs";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import * as ocApi from "@earendil-works/pi-ai/api/openai-completions";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import {
  AssistantEntry,
  CompactionEntry,
  configure,
  createRegistry,
  Harness,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Single source of truth for DeepInfra provider options, vendored into this tree
// so durig is self-contained and publishable on its own
// (src/providers/PROVENANCE.md records the source, version and licence). Node 24
// type-strips the TypeScript on import, so there is no build step.
import {
  BASE_URL,
  PROVIDER_ID,
  fallbackModels,
} from "./src/providers/deepinfra-models.ts";
import { createLocalProvider, localProviderSpecs } from "./src/providers/local.mjs";
import { shellToolLine } from "./src/shellregistry.mjs";
import { wrapProviderWithSpend, capsFor, ledgerPath } from "./src/providers/spend.mjs";
import {
  Constitution,
  Edges,
  RigQueue,
  Router,
  Seats,
  applyInstructionFiles,
  compilePersona,
  registerSeat,
} from "./src/rig.mjs";
import { compactionReport, compactionSettings, declaredContextWindow, describeConfig, loadConfig, loadShippedDefaults, streamSettings } from "./src/config.mjs";
import { DEFAULT_STRATEGY, PRIORITY_VALUES, assertWorkStrategy, effectivePriority, priorityLeaseText, strategyNames } from "./src/workstrategy.mjs";
// The per-seat consumption measure, reused by `compact` so the verb can state the seat's token count
// against the policy it just ran under (#4898) instead of reporting only "an entry was/was not written".
import { contextConsumption } from "./src/context.mjs";
import { NO_STORE_CAUSE } from "./src/causes.mjs";
import { applyEscalations, applyResets, failureStreak, planEscalations, planResets } from "./src/supervisor.mjs";
import { assessRun } from "./src/degeneration.mjs";
import {
	leaseKillTarget,
	readGenerationSlots,
	wrapProviderWithSlots,
} from "./src/genlock.mjs";
import { WakeScheduler, createWakeSignal } from "./src/scheduler.mjs";
import { followCommits } from "./src/commitstream.mjs";
import { applyPauseOp, auditWorktrees, brokerAlive, brokerHealth, cleanVerifyScratch, clearBrokerState, clearStopRequest, drivePass, intentInboxDir, intentResultDir, intentWaitBoundMs, logBrokerLine, pendingIntentCensus, pidAlive, readBrokerState, readStopRequest, runWakeLoop, stopRequestPath, writeBrokerState, writeStopRequest, writeIntent } from "./src/broker.mjs";
import { optimizeInstruction } from "./src/optimizer.mjs";
import { withStoreWriteRetry } from "./src/storewrite.mjs";
import { createLiveRenderer, wrapProviderWithLiveView } from "./src/streamview.mjs";
import { wrapProviderWithTrace } from "./src/providers/trace.mjs";
import { SCAN_LIMIT, extractEntryText, readSeatPages, summarizeEntries } from "./src/rigstory.mjs";
import { formatMetrics } from "./src/metrics.mjs";
import { isLinkedWorktree, readSharedTreeBranch } from "./src/featuredocs.mjs";
import { readTextIntegrity, trackedChangedPaths } from "./src/textintegrity.mjs";
import { readCommitMessages } from "./src/commitmsg.mjs";
import { readCitations } from "./src/citation.mjs";
import { readDocCountClaims } from "./src/doccounts.mjs";
import { activeSet, dependencyProvenance, formatDependencyProvenance, formatProvenance, gitProvenance } from "./src/provenance.mjs";
import { extensionNames, loadExtensions, parseExtensionList } from "./src/extensions.mjs";
import { formatChat, formatPartial } from "./src/chatview.mjs";
import { readLiveState, readQueueItems, readQueueRow, readQueueCensus, readRigHealth, readSeatList, readSeatsDocument, readSeatRoots, seatContextMap, filterQueueItems, QUEUE_STATUSES, projectQueueView, refuseOversizedQueueRead, QUEUE_VIEW_ROW_CAP, TERMINAL_QUEUE_STATUSES, queueCensusOf, deferredBacklogRows, terminalStatusIndex, workStrategyView } from "./src/readapi.mjs";
import { gateView, GATE_VIEW_CAP } from "./src/queue-lifecycle.mjs";
import { readNoteCensus, renderCensus } from "./src/notecensus.mjs";
import { readData, setLocalReads, liveGenerationLeases, STORE_BUSY_TIMEOUT_MS } from "./src/readclient.mjs";
import { installSignalHandlers, isStopping, stopSignalName, stoppableSleep } from "./src/signals.mjs";
import { partialView, peerGraph } from "./src/viewmodel.mjs";
import { createWorktree, prunePatchEquivalentBranch } from "./src/worktree.mjs";
import { mergeInProgress, mergeRefusal } from "./src/mergeguard.mjs";
import { SeatGuard } from "./src/seatguard.mjs";
import { SeatTools, fillRoster, makeSeatEnv, scopeSeatTools } from "./src/seattools.mjs";
import { createWatchScreen, formatSnapshot } from "./src/watchview.mjs";
import { readFeed } from "./src/eventfeed.mjs";

// src/checkup.mjs is loaded LAZILY (dynamic import). It is a large audit module that
// nothing on the hot path needs — `init` and `check` are its only callers — and loading it
// at startup is how the 2026-10-17 incident became total: a `<<<<<<<` marker left in a
// mid-merge checkup.mjs made cli.mjs fail to LOAD, so status/queue/run/serve all died with
// a SyntaxError. NOTHING loaded on the hot path may import checkup statically again;
// src/verifierrole.mjs exists for the one predicate metrics/seattools need at runtime.
let checkupModule = null;
async function loadCheckup() {
  checkupModule ??= await import("./src/checkup.mjs");
  return checkupModule;
}

// Effective configuration for this process: environment over
// durig.config.json over built-in defaults (see src/config.mjs). Resolved
// once at startup so every command agrees on one DB/provider/model. A bad
// config is reported in the same JSON contract as every other failure
// rather than as a stack trace (out()/fail() are defined further down).
let cfgResult;
// This CLI file's own path, so a parent can respawn the resident broker with the
// same interpreter and the same script regardless of the invoking shell's cwd.
// Declared BEFORE the config load: the shipped defaults file (#491 C6) is
// anchored to durig's own install directory, so a fresh install in an arbitrary
// CWD still finds the file it rode in with.
const CLI_PATH = fileURLToPath(import.meta.url);
// durig configuration: environment variables win; the operator's runtime config
// file (durig.config.json / .durig/config.json / $DURIG_CONFIG) is next in line;
// the SHIPPED defaults file (durig.config.default.json, same three discovery
// paths) wins over the built-in per-key constants only. The order is "env beats
// the shipped defaults" for the dangerous-but-easy keys (#491 C6): a fresh rig
// with no hand-written config gets exactly the shipped defaults, which include a
// SQLite path and a serialized seat cap (DURIG_MAX_CONCURRENT_SEATS=1) — an
// unlimited cap stampedes a local model on first run.
try {
  // #491 C6: the shipped defaults (durig.config.default.json) are read first and
  // passed as an object. ANCHORED to durig's own install dir, because a fresh
  // install in an arbitrary CWD must find the shipped file it rode in with.
  const shipped = await loadShippedDefaults({
    readFile,
    anchors: [join(dirname(CLI_PATH), "durig.config.default.json")],
  });
  cfgResult = await loadConfig({
    env: process.env,
    readFile,
    defaults: shipped.values,
    defaultsSource: shipped.source,
  });
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
  process.exit(1);
}
const { config: CFG, source: CFG_SOURCE, defaultsSource: CFG_DEFAULTS_SOURCE } = cfgResult;
// Resolved ONCE, absolutely (#4955, and the #4947 divergence class). A relative default (`./rig.sqlite`)
// means the rig you read depends on which tree served the process; every surface now reports the absolute
// path, so "which database did this answer come from" is answered by the output, not by memory.
const DB_PATH = resolve(CFG.DURIG_DB ?? "./rig.sqlite");

// THE SIGNAL SEAM (#314). Installed BEFORE any verb runs, so a Ctrl-C reaches the await the
// process is actually sitting on - not just a flag nobody reads. Read verbs get a 1.5 s grace
// then a hard exit; a resident daemon (`serve`, `run --watch`) keeps its own bounded drain, so
// the global hard timer is set past that drain and cannot preempt it. (The `--local` flag is
// consumed in the same block, at the bottom of this file, before dispatch.)
const LOCAL_REQUESTED = process.argv.includes("--local");
setLocalReads(LOCAL_REQUESTED);
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
// Every storage-open failure flows to fail()/the entrypoint catch-alls with
// inner error text that never names WHICH file was in play ("unable to open
// database file") — the wrong-rig trap a fresh install meets on day one. One
// wrapper keeps the resolved DB_PATH in front of the cause for every verb
// (#491 C7): same JSON contract {ok:false,error}, same exit code, path named.
// THE BUSY TIMEOUT IS A FLEET-LIVENESS SETTING, not a tuning knob (measured 2026-11-12T21:15:40Z):
// the broker's pass met `database is locked errcode=5`, pi-durable closed the Session on the storage error,
// the reopen cap (3 attempts, ~35 s) was exhausted, and the broker stopped TERMINALLY - while the process
// stayed alive serving READ-DRAIN, so `ps`, the heartbeat and the last `START` line all read healthy. The
// fleet was dead for ~4 min until `tools/broker-keepalive.mjs` noticed `no pass 305s` and re-armed it.
// The constant and its reasoning live with the other store-timeout policy in src/readclient.mjs, so this
// open and the read path cannot drift apart.
async function openStore(path = DB_PATH) {
  try {
    return await openNodeSqliteStorage(path, { busyTimeoutMs: STORE_BUSY_TIMEOUT_MS });
  } catch (err) {
    throw new Error(`cannot open ${path}: ${String(err?.message ?? err)}`);
  }
}

function noteEmptyRig(seatCount) {
  if (seatCount > 0) return;
  const freshness = DB_EXISTED_AT_START
    ? ""
    : ` (it did not exist before this command, so it was just created empty)`;
  console.error(
    `note: no seats in ${DB_PATH}${freshness}. If you meant a different rig, set DURIG_DB or create durig.config.json - run: node cli.mjs config`,
  );
}

/**
 * ROADMAP 69 / item 83: a CLI WRITE verb must NOT become a second owner while a
 * resident broker drives this store. Two owners crash the broker and corrupt
 * run-control documents (2026-10-16, twice: `resume` racing the broker left a
 * mid-stream `generation` reset that orphaned later appends). The guard lives in
 * CODE, not a runbook sentence, because prose is exactly what failed. Reads are
 * unaffected; a write either waits for `serve --stop` or goes through the spool
 * (`intent.mjs`), which the broker drains as operator input.
 */
function refuseWhileBrokerDrives(verb, detail) {
  const broker = readBrokerState(DB_PATH);
  if (!brokerAlive(broker)) return;
  fail(
    `${verb} refuses to run while a resident broker is driving ${DB_PATH} (pid ${broker.pid}): ` +
      `a second owner crashes the broker and corrupts run-control docs. ` +
      (detail ??
        `Stop it with "serve --stop", or route the request through the spool: node intent.mjs <seat> --body-file <file>`),
  );
}

/** #491 C8: find the nearest rig.json from `start` upward through parents
 * (this directory first, then each parent) so `check` can discover the
 * checkable surface instead of demanding a path. Returns null when nothing
 * is found. */
function findRigFileFrom(start) {
	let current = resolve(start);
	for (;;) {
		const candidate = join(current, "rig.json");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
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
  // A NAMED cause (`err.code`) and the store it was about (`err.db`) ride along when present, so a caller
  // branches on WHY instead of on wording, and #4955's read refusal — where the path IS the answer — prints it
  // as a field rather than only inside the sentence.
  if (error?.code === NO_STORE_CAUSE) {
    console.error(
      `note: no store at ${error.db} - reading does not create one. If you meant a different rig, set DURIG_DB or create durig.config.json - run: node cli.mjs config`,
    );
  }
  out({
    ok: false,
    error: process.env.DURIG_DEBUG ? (error?.stack ?? String(error)) : String(error?.message ?? error),
    ...(error?.code === undefined ? {} : { cause: error.code, ...(error?.db === undefined ? {} : { db: error.db }) }),
    ...(error?.remedy ? { remedy: error.remedy } : {}),
  });
  // 130 = 128 + SIGINT: "the user stopped this", which is the difference between a failure and
  // an interruption, and the code a shell script can branch on (#314).
  process.exit(isStopping() ? 130 : 1);
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
import { resetSeatContext } from "./src/reset.mjs";

// live: when set, the provider is wrapped so a running generation streams to
// the terminal. Off for commands that only read state, so `watch`/`status`
// stay machine-clean; only `send` opts in.
function buildModels(live = null) {
  // #5047 — THE SPEND GUARD, installed beside the trace seam. `buildModels` builds ONE provider per process for
  // every run path (`send`, `up`, `run`, `serve`, `optimize`, the optimizer), and pi-durable's COMPACTION task
  // resolves its model through the same registry, so a wrapper here is the one position that covers all of them
  // and cannot drift (D-5015.1 chose the provider seam over queue admission for exactly this reason: a compaction
  // is a model call at the seat's own model, so it spends money, and admission-time accounting cannot see it).
  //
  // Caps and the ledger path are read the way every other rig value is read: env over config-file. The ledger is
  // the SAME file the probes write, in the SAME row format (`tools/model-probes/metered.mjs` owns both) — a second
  // ledger is the fork #5015 §3 forbids. `DURIG_SPEND_LEDGER` overrides the path for a run; the default is
  // `.spike/gate/spend.jsonl`.
  //
  // The FAUX branch below is deliberately NOT wrapped: faux never opens a socket, and wrapping it would put a
  // money guard in front of a provider that cannot spend money — whose model rows have no baseUrl, so the
  // endpoint test that decides metering has nothing to read.
  const spendEnv = { ...CFG, ...process.env };
  const spendLedger = spendEnv.DURIG_SPEND_LEDGER || ledgerPath(spendEnv);
  const spendCaps = capsFor(spendEnv);
  const withSpend = (provider) =>
    wrapProviderWithSpend(provider, {
      caps: spendCaps,
      ledger: spendLedger,
      env: spendEnv,
      getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null,
    });
  if ((CFG.DURIG_PROVIDER ?? "deepinfra") === "faux") {
    FAUX = fauxProvider({ models: [{ id: MODEL_ID }] });
    // #4658 (decision (a)): A TEST-ONLY DELAY KNOB, AND IT IS THE ONLY WAY A SPAWNED BROKER CAN HOLD A RUN.
    // The construction above passes model IDS ONLY — no response factory — so a spawned broker answers
    // INSTANTLY and `demo/broker-cooperative-stop` can never have a live generation when `--stop` arrives.
    // That is why its "under load" banner was unasserted AND UNAVAILABLE: the fixture was not lazy, the seam
    // had no slow model. An IN-PROCESS test would prove nothing about the exit path, and the exit path is
    // where the seven-minute damage was.
    //
    // BEHAVIOUR-PRESERVING WHEN UNSET: with no `DURIG_FAUX_DELAY_MS` this block does not run and the provider
    // is exactly what it was. Nothing about a normal run changes.
    //
    // SCOPED TO THE FAUX PROVIDER ON PURPOSE: it is a test seam for an offline provider, not a general
    // latency control, and it is read only here — where the provider is already known to be faux.
    const fauxDelayMs = Number(process.env.DURIG_FAUX_DELAY_MS ?? 0);
    if (Number.isFinite(fauxDelayMs) && fauxDelayMs > 0) {
    	// A step is consumed per provider call, so the list is long enough for any fixture's run count.
    	const slowStep = () =>
    		new Promise((resolve) => setTimeout(() => resolve(fauxAssistantMessage("faux delayed reply")), fauxDelayMs));
    	FAUX.setResponses(Array.from({ length: 128 }, () => slowStep));
    }
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
      wrapProviderWithTrace(
        live
          ? wrapProviderWithLiveView(gated, {
              renderer: live,
              getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null,
            })
          : gated,
        // ROADMAP 43c / #920 (#2545): the request TRACE attaches HERE, at the one provider seam every
        // run path builds (send/up/run/serve and the optimizer), so one line covers all of them and
        // cannot drift. Off unless DURIG_TRACE_REQUESTS=1; returns the provider unchanged when off.
        { getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null },
      ),
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
    // Catalog from the extension module.
    //
    // #5047 (acceptance P2): the old fallback for a model the curated list lacks SYNTHESIZED a row whose cost
    // block was all-zero - `input: 0, output: 0, cacheRead: 0` - on a METERED endpoint (BASE_URL is
    // api.deepinfra.com). "arbitrary DURIG_MODEL ids must work" was the stated justification, and the rig paid
    // for it twice over: `config`, the ledger and every cost read reported a FREE provider that was billing, and
    // a spend cap had nothing to price. A row this rig cannot price is now NOT registered - the seat fails as
    // no_model before any request, and the line below names the cause and what to set. Free BY DECLARATION is
    // still available: put the id in src/providers/deepinfra-prices.json at $0 and it registers.
    // The curated rows also pass through the exposure guard (#5015 P6b): a row whose own declared geometry can
    // spend more than the operator's store cap in ONE call never reaches a seat.
    models: (() => {
      const base = fallbackModels({ storeCapUsd: Number(CFG.DURIG_SPEND_CAP_STORE_USD) });
      if (base.some((m) => m.id === MODEL_ID)) return base;
      process.stderr.write(
        `${JSON.stringify({
          spend: "model-unpriced",
          provider: PROVIDER_ID,
          model: MODEL_ID,
          cause: "no dated price for this id",
          remedy: `point DURIG_MODEL at a priced id (${base.map((m) => m.id).join(", ")}), or add ${MODEL_ID} to src/providers/deepinfra-prices.json from a dated catalog fetch (curl -s https://api.deepinfra.com/v1/openai/models); $0 is a legitimate declared price`,
          effect: "no row is registered for it, so a seat naming it fails as no_model BEFORE any request",
        })}\n`,
      );
      return base;
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
  //
  // #5047: the spend guard is the OUTERMOST wrapper, and the ordering is not cosmetic. pi-ai runs the
  // `onPayload` hooks in wrapper order (each wrapper chains the previous one), so with spend OUTSIDE the trace, a
  // refused call is refused before the trace line is written — stderr never shows a payload for bytes that were
  // never sent. It also sits outside the slot gate, so a refusal never takes a generation slot.
  models.setProvider(
    withSpend(
      wrapProviderWithTrace(
        live
          ? wrapProviderWithLiveView(gated, {
              renderer: live,
              getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null,
            })
          : gated,
        // The same one trace seam as the faux branch above (ROADMAP 43c / #920, #2545).
        { getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null },
      ),
    ),
  );
  // Register the locally-served providers AFTER the default: resolveSeatModel reads a provider prefix only
  // when it is registered, so a seat model "local/<id>" uses the author server and "verifier/<id>" uses the
  // verifier server while every other seat keeps the default provider. TWO servers is the point, not an
  // accident: an author and its verifier cannot share a blind spot only if they are different families
  // (D48/D119, ROADMAP 189), and the family ruling lives in docs/DECISIONS.md rather than here.
  // #5488 — THE GENERATION-SLOT GATE APPLIES HERE TOO, and this block is the whole fix.
  // `DURIG_MAX_CONCURRENT_SEATS` is documented (src/config.mjs; docs/SELFDEV.md's review recipe) as the key that
  // makes "seats queue in durig rather than inside the model". It did not: the faux branch and the metered
  // default above both wrap in `wrapProviderWithSlots`, this loop did not, so on a rig whose seats are ALL
  // `local/*` the cap was inert — measured with the config reading `1`: 9-10 `pi.generation` tasks `running` at
  // once and ZERO `<db>.genlock.<i>` files across 40 samples (docs/DECISIONS.md, the #5488 finding; reproduced
  // in docs/NEXT.md as "`running` reached 10 while DURIG_MAX_CONCURRENT_SEATS=1"). D-5015.1's claim that EVERY
  // provider is wrapped was false here; #5491 corrected the wording, this closes the behaviour.
  //
  // WHY HERE AND NOT IN src/providers/local.mjs: locality decides cost and credentials, but capacity is a
  // property of the HOST process, and the lease needs `DB_PATH` plus the resolved cap — both already owned here.
  // In `local.mjs` it would fork the cap (a second reader of the same key) and gate the provider even where the
  // rig says "no limit". NO NEW KEY is minted: the gate is armed by the same `maxSeats()` the other two branches
  // read, and `durig.config.default.json` stays at `1` — nothing is widened by default. Wrapper order matches the
  // metered branch: spend OUTSIDE (a money refusal must never take a generation slot), the slot gate INSIDE the
  // trace, so a queued generation is still visible while it waits.
  //
  // FEASIBILITY (acceptance 5): gating IS feasible on this plane — the lease wraps the provider CALL, so it is
  // held for the whole response whether the local engine queues internally or not. The cost is MEASURED in
  // demo/local-slot-gate.test.mjs (ungated vs gated wall-clock, in seconds), not asserted as free.
  const localSlots = maxSeats();
  for (const spec of localProviderSpecs(CFG)) {
    const built = createLocalProvider(spec, { createProvider, api: ocApi });
    const gatedLocal = Number.isFinite(localSlots)
      ? wrapProviderWithSlots(built, {
          dbPath: DB_PATH,
          slots: localSlots,
          getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null,
        })
      : built;
    models.setProvider(
      withSpend(
        wrapProviderWithTrace(gatedLocal, {
          getSeat: () => process.env.DURIG_ACTIVE_SEAT ?? null,
        }),
      ),
    );
  }
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
  // Keep the exact `Storage` object the harness is opened over: it is the broker's ONE
  // pi-durable connection, and the spooled `read` op must be served from it (pi-durable
  // exposes no `harness.storage`, and a second `openStore()` connection contends with the
  // harness's own commits). The harness owns its lifecycle; callers must not close it.
  const storage = await openStore();
  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      env: makeSeatEnv(seatRoster),
      // `stream` AND `compaction` are configurable here; everything else keeps pi-durable's
      // built-in defaults, which were chosen deliberately and which nothing in durian-pi's use argues
      // against. Compaction was added because the ABSENCE of a policy was a measured defect (#4898):
      // the defaults (reserve 16384 / keepRecent 20000 / background 32768) sit above the whole
      // verifier-class window of 24,576, so the policy fired too late to leave room to answer. ONE
      // call site, and no second mechanism - pi-durable's `modelOverrides` layering does the per-model
      // work. See `streamSettings` and `compactionSettings` for why each one matters.
      settings: { ...streamSettings(CFG), ...compactionSettings(CFG) },
    },
    BACKGROUND_CONTEXT,
  );
  // Persisted storage restarts idle; resume() re-arms task scheduling so
  // queued work and interrupted runs continue (blog restart recipe).
  // Viewers skip it: enabling scheduling is a write-side act and would let
  // a passive `watch` kick the very queue it is observing.
  if (resume) harness.resume();
  const rosterDoc = await harness.snapshot(Seats, undefined, BACKGROUND_CONTEXT);
  fillRoster(seatRoster, rosterDoc?.seats);
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
    const seatsVal = rosterDoc?.seats ?? {};
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
  return { harness, models, providerId, extensions: extensionNames(extensions), storage };
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
    "- send_work(..., tier, reason): a task tier is the size of a request - trivial/small/feature/project (map S/M/L). Assign a tier AT INTAKE and to every follow-up about the same task (the tier latches on the chain); a NEW intake (a new subject from the operator) starts a NEW tier. LOWERING a tier is free; RAISING it requires a stated `reason` or the tool refuses.",
    "- defer_work(itemId, question[, to]): stop and ask instead of guessing, or instead of going quiet. Parks the item you hold on the question; omit `to` to defer to the human operator, pass `to` to ask another seat as well.",
    "- resume_work(itemId): take back a deferred item once the answer has arrived, then finish it with complete_work.",
    "- hold_work(itemId, reason?): park one of your claimed items so it becomes unclaimable until released; reason is optional.",
    "- release_work(itemId): restore a held item to queued, so the driver can re-wake the seat.",
    "- set_priority(itemId, priority, reason, expiresAt): move a QUEUED or HELD item up or down a seat's queue. priority is now|next|later, and it is a LEASE: it stops applying at expiresAt (required, at most 30 days), so urgency cannot become a permanent park. It only reorders claims where that seat works `priority_first`, and the reply says whether the recipient does.",
    "- revise_work(itemId, {subject?, body?}): fix the subject/body of a QUEUED item you sent or were sent, before it is claimed.",
    "- cancel_work(itemId, reason): cancel a stale or superseded item (one you sent or were sent). Terminal: it is never claimed and never woken for.",
    "- peek_queue([all]): read the queue. By default your non-terminal items (addressed to or sent by you); pass all=true for the team-wide, all-status view when coordinating or debugging.",
    "When asked to decompose or route a task, CREATE QUEUE ITEMS with send_work - do not merely describe them in your reply.",
  ].join("\n");
  const seatModel = resolveSeatModel(models, seat.model, providerId, MODEL_ID);
  // #5739: the shell line is emitted from the registry, not hand-written in 12 persona files, so the
  // prompt cannot claim a shell the guard would refuse. `shellToolLine()` reads the same plan
  // (src/shellregistry.mjs) that registers the tool and that seatguard.mjs uses to refuse a call.
  let instructions = [compilePersona(seat), shellToolLine(), PROTOCOL].join("\n\n");
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
async function cmdUp(rigFile, refresh = false, { serve = false, dryRun = false } = {}) {
  // #1589: `up` opens a full harness — a second OWNER — and `--refresh` writes
  // (re-applies prompts/models, resets conversations). While a resident broker
  // drives the store that is the hazard `send`/`reset`/`compact`/`resume`/`run`
  // already refuse: two owners crash the broker and corrupt run-control docs.
  // `--dry-run` writes nothing and previews only, so it keeps working (the
  // `reset` precedent) — but note it still OPENS a harness, which is the
  // lock-contention half of #1587, not this item's concern.
  // #1589 + lead #1700 (B): the guard is CONDITIONAL on the WRITE path. `up --serve` doubles
  // as "ensure the broker is up": when a broker already drives the store the reuse is a
  // READ-ONLY check — report {started:false, reason:"already running"} and exit WITHOUT
  // opening a harness (a second harness is the named hazard, not the reuse itself). `--refresh`
  // and a plain `up` (which creates seats) still refuse while a broker drives.
  const reuseBroker = serve && !refresh && !dryRun;
  if (!dryRun && !reuseBroker) refuseWhileBrokerDrives("up");
  if (reuseBroker) {
    const driving = readBrokerState(DB_PATH);
    if (brokerAlive(driving)) {
      out({
        ok: true,
        command: "up",
        db: DB_PATH,
        created: [],
        existing: [],
        refreshed: [],
        extensions: [],
        broker: { started: false, reason: "already running", pid: driving.pid },
      });
      return;
    }
  }
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
  // Seat personas resolve from files before ANY consumer sees the spec. ONE resolver — imported
  // from src/rig.mjs, not re-implemented here, because two copies drift (the WIP had two).
  // Resolved outside the transacting action for the same reason the constitution is: a retry would
  // print the note once per attempt.
  for (const name of await applyInstructionFiles(spec, rigFile)) {
    console.error(
      `note: ${rigFile}: seat ${name} sets both instructions and instructionsFile; using the file`,
    );
  }
  // ---- WORK STRATEGY: the claim ORDER this team works in (priority-first selection) ----------------
  // The rig file's `workStrategy` is the TEAM default; a seat may override it per seat. Precedence follows
  // the `seatCwd` precedent below (`seat.cwd ?? spec.cwd ?? DURIG_SEAT_ROOT`): the rig file wins over the
  // config file, because the rig file declares THIS team while `DURIG_WORK_STRATEGY` is the host's ambient
  // setting. Validated HERE — before a harness is opened and before any seat is created — so a typo refuses
  // the whole `up` instead of bootstrapping a rig whose claim order silently did not change (the #5071
  // accepted-and-ignored class). The resolved value is PERSISTED onto the seats doc because that is the one
  // document `claim_work` can read: the rig extension has no config object, and reading the environment from
  // inside a tool would be a second, invisible source for one setting.
  const declaredTeamStrategy =
    typeof spec.workStrategy === "string" && spec.workStrategy.trim() !== "" ? spec.workStrategy.trim() : null;
  const teamWorkStrategy = assertWorkStrategy(declaredTeamStrategy ?? CFG.DURIG_WORK_STRATEGY ?? DEFAULT_STRATEGY, {
    where: `${rigFile} workStrategy (or DURIG_WORK_STRATEGY; valid: ${strategyNames().join(", ")})`,
  });
  for (const seat of spec.seats ?? []) {
    // `undefined` inherits and `null` explicitly clears/never-sets an override (the refresh path below), so
    // NEITHER is a strategy NAME: validating them would make the documented null-means-clear form unreachable.
    if (seat.workStrategy === undefined || seat.workStrategy === null) continue;
    assertWorkStrategy(seat.workStrategy, {
      where: `${rigFile} seat ${JSON.stringify(seat.name ?? "(unnamed)")} workStrategy`,
    });
  }
  const created = [];
  const existing = [];
  const refreshed = [];
  const { harness, models, providerId, extensions } = await openHarness(dryRun ? { resume: false } : {});
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
    // #84: `--dry-run` reviews the change and writes NOTHING — no reset, no commit,
    // no broker. It reuses the SAME read-only detection the apply path uses, so the
    // preview cannot disagree with what would actually happen.
    if (dryRun) {
      const preview = await previewUp(harness, spec, resolvedPromptBySeat, constitutionText, refresh);
      out({
        ok: true,
        command: "up",
        dryRun: true,
        db: DB_PATH,
        writes: 0,
        ...preview,
        ...(refresh && modelMismatch.length
          ? { wouldReset: modelMismatch.map(({ seat, from, to }) => ({ seat, from, to })) }
          : {}),
      });
      await harness.close(BACKGROUND_CONTEXT);
      return;
    }
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
      // The TEAM strategy is applied on every `up` (like edges and the constitution), idempotently: it is the
      // declaration of how these seats claim, and a `up` that silently kept an old order would be the same
      // class of invisible no-op. A per-seat override below is applied only where the spec declares one.
      if (seatsDoc.workStrategy !== teamWorkStrategy) seatsDoc.workStrategy = teamWorkStrategy;
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
          // --refresh re-applies a CHANGED seat strategy; an explicit `null` in the spec clears it (so a team
          // can revert a seat to the team default without hand-editing the store).
          if (seat.workStrategy !== undefined) {
            if (seat.workStrategy === null) delete seatsDoc.seats[seat.name].workStrategy;
            else seatsDoc.seats[seat.name].workStrategy = seat.workStrategy;
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
        // A per-seat work strategy is persisted beside the capabilities: it is part of how this seat works, and
        // the claim path reads it from the roster, not from the rig file (the file is not present at claim time).
        if (seat.workStrategy) {
          seatsDoc.seats[seat.name].workStrategy = seat.workStrategy;
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
    // The order this rig's seats claim in, and WHERE it came from. Reported because an operator who set a
    // strategy and sees nothing here cannot tell "applied" from "ignored" without opening the store.
    workStrategy: {
      team: teamWorkStrategy,
      source: declaredTeamStrategy ? "rig file" : process.env.DURIG_WORK_STRATEGY ? "environment" : "config",
      seat: Object.fromEntries(spec.seats.filter((s) => s.workStrategy).map((s) => [s.name, s.workStrategy])),
    },
    // #402: bare up reports detected mismatches (write NOTHING); --refresh reports what
    // it reset (and anything it refused for a live lease — the operator re-runs when idle).
    ...(modelMismatch.length ? { modelMismatch: modelMismatch.map(({ seat, from, to }) => ({ seat, from, to })) } : {}),
    ...(refresh && modelReset.length ? { modelReset } : {}),
    ...(refresh && modelRefused.length ? { modelRefused } : {}),
  });
}

// #84: the read-only DIFF a dry run prints. Names the seats that would be CREATED
// and, for a refresh, each existing seat's CHANGED fields (model, instructions,
// cwd, thinkingLevel) plus whether the constitution or the edges policy would
// change. Reads the same documents the apply path writes; writes NOTHING and
// starts no broker.
async function previewUp(harness, spec, resolvedPromptBySeat, constitutionText, refresh) {
  const context = BACKGROUND_CONTEXT;
  const [seatsDoc, edgesDoc, constitutionDoc] = await Promise.all([
    harness.snapshot(Seats, undefined, context),
    harness.snapshot(Edges, undefined, context),
    harness.snapshot(Constitution, undefined, context),
  ]);
  const seatsVal = seatsDoc?.seats ?? {};
  const wouldCreate = [];
  const wouldRefresh = [];
  const unchanged = [];
  for (const seat of spec.seats) {
    const registered = seatsVal[seat.name];
    if (!registered) {
      wouldCreate.push(seat.name);
      continue;
    }
    // Bare `up` never rewrites an existing seat, so nothing to diff.
    if (!refresh) {
      unchanged.push(seat.name);
      continue;
    }
    const prompt = resolvedPromptBySeat.get(seat.name);
    const seatCwd = seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT;
    let agent;
    try {
      agent = (await harness.snapshot(AgentDoc, registered.conversationId, context)) ?? {};
    } catch (err) {
      // Cannot know what would change: report the seat and the cause, never guess.
      wouldRefresh.push({ seat: seat.name, changes: { unreadable: String(err?.message ?? err) } });
      continue;
    }
    const changes = {};
    if (prompt) {
      const to = `${prompt.seatModel.provider}/${prompt.seatModel.modelId}`;
      const from =
        agent.model && typeof agent.model.provider === "string" && typeof agent.model.modelId === "string"
          ? `${agent.model.provider}/${agent.model.modelId}`
          : null;
      if (from !== null && from !== to) changes.model = { from, to };
      if (agent.instructions !== prompt.instructions) changes.instructions = true;
      if (seat.thinkingLevel !== undefined && agent.thinkingLevel !== seat.thinkingLevel) {
        changes.thinkingLevel = { from: agent.thinkingLevel ?? null, to: seat.thinkingLevel };
      }
      if (seatCwd !== undefined && agent.cwd !== seatCwd) {
        changes.cwd = { from: agent.cwd ?? null, to: seatCwd };
      }
    }
    wouldRefresh.push({ seat: seat.name, changes });
  }
  const edgesChanged =
    spec.edges !== undefined &&
    JSON.stringify(edgesDoc?.edges ?? null) !== JSON.stringify(spec.edges);
  // harness.snapshot returns the VALUE, not the StoredDocument wrapper (v1.5.1).
  const constitutionChanged = constitutionText !== undefined && constitutionDoc?.text !== constitutionText;
  return {
    wouldCreate,
    ...(refresh ? { wouldRefresh } : { existing: unchanged }),
    constitution: { changed: constitutionChanged },
    edges: { changed: edgesChanged },
    note: "dry run: nothing was written; re-run without --dry-run to apply",
  };
}

// init: scaffold a minimal working rig in the current directory (#491 C9/C10).
//
// The defaults must be METADATA, not memory: a bare install has nothing
// runnable, so `init` writes the two files a rig needs beside the operator,
// from artifacts durig already ships — one definition each: the scaffold is a
// copy of the hardened starter (never a second wording that can drift), and
// the config is the shipped defaults materialized locally (never re-derived
// values). npm-init-like refusals where they matter: an existing rig.json or
// durig.config.json is never overwritten; both sources are gathered and
// validated before either target is written, so the scaffold is all-or-
// nothing; and the seed must pass the same `check` audit a fresh copy of the
// starter passes, so init cannot silently hand a new user a rig their own
// linter would reject.
async function cmdInit() {
  const rigPath = "rig.json";
  const configPath = "durig.config.json";
  // Both sources resolve BEFORE anything is checked or written; a torn
  // scaffold (a rig with no config, or half of either) is exactly the state a
  // bare install must not learn to expect.
  const shipped = await loadShippedDefaults({
    readFile,
    anchors: [join(dirname(CLI_PATH), "durig.config.default.json")],
  });
  if (shipped.source === null) {
    fail(
      `init: no shipped defaults file (durig.config.default.json) was found - searched ${
        [join(dirname(CLI_PATH), "durig.config.default.json"), ...DEFAULTS_CONFIG_PATHS].join(", ")
      }; without it the scaffold has no safe concurrency floor`,
    );
  }
  let starterText;
  let starterSource;
  const starterCandidates = [join(dirname(CLI_PATH), "rig.starter.json"), "../rig.starter.json"];
  for (const candidate of starterCandidates) {
    try {
      starterText = await readFile(candidate, "utf8");
      starterSource = candidate;
      break;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  if (starterText === undefined) {
    fail(
      `init: no starter rig (rig.starter.json) was found - searched ${starterCandidates.join(", ")}; without it init has no seed to scaffold from`,
    );
  }
  // Parse once, audit once: the seed must be a valid rig file that its own
  // linter accepts BEFORE it becomes the operator's rig.json.
  let starterSpec;
  try {
    starterSpec = JSON.parse(starterText);
  } catch (err) {
    fail(`init: invalid JSON in the starter rig ${starterSource}: ${err?.message ?? err}`);
  }
  const { auditRig } = await loadCheckup();
  const audit = auditRig({
    rig: starterSource,
    spec: starterSpec,
    specConstitution:
      typeof starterSpec?.constitutionInline === "string"
        ? starterSpec.constitutionInline
        : starterSpec?.constitution
          ? await readFile(starterSpec.constitution, "utf8")
          : undefined,
    // A FIRST scaffold has no store yet: the file-only rules (verifier seat, single
    // model, capabilities, edges) are the ones the scaffold must pass. Store rules
    // are skipped-with-reason here exactly as check reports them against an absent
    // store, so init and `check` cannot disagree about a not-yet-created rig.
    stored: { reason: "absent" },
    modelsBySeat: resolveModelsBySeat(starterSpec),
  });
  if (audit.findings.length > 0) {
    fail(
      `init: the starter rig ${starterSource} does not pass its own check (${audit.summary.error} error(s), ${audit.summary["fix-now"]} fix-now); not scaffolding a rejected seed - fix rig.starter.json first`,
    );
  }
  // Only now the overwrite refusals: an operator file that exists is never
  // clobbered. The refusals sit AFTER the source checks so a failed init
  // always names the thing that actually blocked it.
  if (existsSync(rigPath)) fail(`init: ${rigPath} already exists; refusing to overwrite it`);
  if (existsSync(configPath)) fail(`init: ${configPath} already exists; refusing to overwrite it`);
  // The rig metadata gets a provenance note; the rest of the seed is used
  // verbatim (re-serializing the whole starter to "improve" it would be a
  // second definition).
  const scaffoldedSpec = starterSpec._readme
    ? { ...starterSpec, _readme: `Created by 'node cli.mjs init' from rig.starter.json (#491). Rename the seats to your domain, run 'node cli.mjs up rig.json', then 'node cli.mjs check rig.json'.` }
    : starterSpec;
  await writeFile(rigPath, `${JSON.stringify(scaffoldedSpec, null, 2)}\n`, "utf8");
  await writeFile(configPath, `${JSON.stringify(shipped.values, null, 2)}\n`, "utf8");
  // stderr keeps the human path and the next steps; stdout stays JSON so
  // scripts can drive the same call.
  const seatNames = (starterSpec.seats ?? []).map((s) => s.name).join(", ");
  console.error(
    `init: scaffolded ${rigPath} (seeded seats: ${seatNames}) and ${configPath} from the shipped defaults`,
  );
  console.error("  next: node cli.mjs up rig.json      # create the seats; on a TTY it also starts the broker");
  console.error("        node cli.mjs check rig.json   # expect: no findings");
  console.error("        node cli.mjs send pm 'hello rig'   # steer a seat from the command line");
  const hasKey = Boolean(process.env.DEEPINFRA_API_KEY ?? CFG.DEEPINFRA_API_KEY);
  if (!hasKey) {
    console.error("        no API key? set DURIG_PROVIDER=faux to try the rig offline first");
  }
  const seatCount = starterSpec.seats?.length ?? 0;
  if (seatCount === 0) {
    // C7's rule applied to init: an honest scaffold names what is missing
    // instead of looking finished. The starter guard above makes this
    // unreachable today; the audit may be relaxed later without this notice
    // silently rotting into a wrong-feeling success.
    noteEmptyRig(0);
  }
  out({
    ok: true,
    command: "init",
    rig: { path: rigPath, seats: (starterSpec.seats ?? []).map((s) => s.name), from: starterSource },
    config: {
      path: configPath,
      values: shipped.values,
      sourceDefaults: shipped.source,
    },
    next: ["node cli.mjs up rig.json", "node cli.mjs check rig.json"],
  });
}

// worktree: an isolated checkout for one work item.
//
// Seats are confined to their `cwd`, so a rig that declares none leaves them in durig's live
// tree - where an author seat can overwrite the operator's uncommitted work. This is how the
// operator gets a tree to point them at instead, with node_modules bridged so the suite runs.
async function cmdWorktree(args) {
  const valueFlags = new Set(["--source", "--ref"]);
  const target = args.find((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]));
  if (!target) fail("worktree needs a path, e.g. node cli.mjs worktree C:/tmp/durig-dev/item-1");
  const sourceAt = args.indexOf("--source");
  const source = sourceAt >= 0 ? args[sourceAt + 1] : process.cwd();
  if (sourceAt >= 0 && !source) fail("worktree --source needs a directory");
  // --ref forks from an arbitrary ref (an UNLANDED branch tip, a tag, a commit) instead of HEAD, so
  // a fix that must edit a file at that tip can be built without touching the shared tree (#1456).
  const refAt = args.indexOf("--ref");
  const ref = refAt >= 0 ? args[refAt + 1] : undefined;
  if (refAt >= 0 && (!ref || ref.startsWith("--"))) fail("worktree --ref needs a ref (branch, tag or commit)");
  try {
    out({ ok: true, command: "worktree", ...(await createWorktree({ source, target, ref })) });
  } catch (error) {
    fail(`cannot create worktree: ${error?.message ?? error}`);
  }
}

// ps: roster with per-seat conversation id and role. A READ, so it opens the
// storage layer read-only (like `status`) rather than a full harness — a
// short-lived harness is a second OWNER, and opening one while the broker drives
// is the hazard ROADMAP 69 removes (docs/COMMANDS-AND-THE-BROKER.md §4).
/**
 * The non-secret config subset the broker's `health` view needs. The provider key lives in
 * CFG and must never cross the spool, so only these keys are sent; the broker reconstructs
 * the two values `readRigHealth` reads from config.
 */
function healthParams({ modelsBySeat = {}, windowsBySeat = {}, entryLimit = SCAN_LIMIT } = {}) {
  return {
    slots: maxSeats(),
    entryLimit,
    modelsBySeat,
    windowsBySeat,
    strandedMs: CFG.DURIG_STRANDED_MS ?? null,
    contextWindow: CFG.DURIG_CONTEXT_WINDOW ?? null,
  };
}

// ps: roster with per-seat conversation id and role. A READ, so it goes through the
// broker when one drives (see src/readclient.mjs); with no broker it opens the storage
// directly and is the sole owner.
async function cmdPs() {
  // The roster as printed before, plus the claim ORDER each seat resolves to and the path it came down.
  // The strategy is derived from the seats DOCUMENT, read through the broker's generic `document` view
  // rather than through a view of its own: a resident broker outlives the CLI on disk and only knows the
  // views it started with, so a new view name would make `ps` fail closed against an older broker
  // (measured 2026-11-12: `unknown read view: roster` with 4 live generation leases → exit 1).
  const seats = await readData(DB_PATH, "seats", {}, (storage) => readSeatList(storage));
  noteEmptyRig(seats.length);
  const seatsDoc = await readData(
    DB_PATH,
    "document",
    { kind: Seats.definition.kind, scope: { kind: "session" } },
    (storage) => readSeatsDocument(storage),
  );
  out({
    ok: true,
    command: "ps",
    db: DB_PATH,
    seats,
    workStrategy: workStrategyView(seatsDoc?.found ? seatsDoc.value : {}),
  });
}

// queue: every work item with status and transitions. A READ, routed the same way.
//
// #4986 — the row-scoped form. The full dump is the defect: `node cli.mjs queue` measured **21,927,512 bytes**
// on this rig, so auditing 17 rows meant shipping 22 MB into a session, and the audit's own cost was the
// complaint (same class as `cli.mjs status` at 22 MB and docs/NEXT.md at 394 KB before its split). `--id <id>`
// (repeatable) reads those rows and prints ONLY them, bodies included — bodies are what an audit needs and what
// makes the dump huge, so the fix is scoping, not truncation. An id that matches nothing is reported in
// `missing` and exits 1: a typo'd id must not look like an empty queue.
//
// THE KNOWN-FLAG SURFACE (#5063, lead ruling option (a) — recorded so it is not re-litigated). `--json` is a
// DOCUMENTED form, not an invented one: `docs/runbooks/session-start-cost.md` uses `queue --json` in Diagnose
// step 1, in §15 and in its own front-matter `evidence:` line, and `docs/SELFDEV.md`, `tools/README.md` and
// `docs/ROADMAP.md` 228 all quote it with a byte count. `out()` has ALWAYS printed JSON, so `--json` is an
// honest NO-OP: byte-identical output at exit 0, pinned by `demo/queue-compat-args.test.mjs`.
// What stays REFUSED is anything not on this list. `main` ignores every argument (`cmdQueue()` takes none), so
// today `queue --zork` exits 0 and prints the whole 22 MB document — that fail-open is the defect ROADMAP 228
// names, and the fix is to refuse the UNKNOWN, not to refuse a documented form (which would be a new break).
// The filter flags (`--status` / `--to` / `--no-body`, #5016) join this set with the compat pin's matching
// accept lines in the SAME change — that demo is what makes "unknown" decidable by a reader instead of by this file.
//
// THE SURFACE IS ONE DECLARATIVE TABLE, and the refusal PRINTS that table (#5016). Why declarative: deciding
// known/unknown inside a loop body leaves the set invisible, and an invisible set is how a row ends up refusing a
// documented form (that is exactly what the first cut of this parser did to `--json`, #5063). A table is the thing
// `docs/COMMANDS-AND-THE-BROKER.md` §4A and `demo/queue-compat-args.test.mjs` can both point at, so "unknown" is
// decidable three ways. The shape is deliberately adoptable by other read verbs — but ONLY `queue` is changed
// here: each verb's known set is its own measurement, and #5016's non-goals forbid a verb sweep.
const QUEUE_FLAGS = {
  // An accepted NO-OP, not a invention: `out()` has ALWAYS printed JSON, so `--json` changes no bytes. Refusing a
  // documented form would be a new break; the pin asserts byte-identity, not merely exit 0.
  "--json": { kind: "noop", usage: "[--json]" },
  // One (or a few) rows by id (#4986). Payload-scoped: the queue is ONE document, so the STORAGE read is not
  // narrowed — what narrows is what the caller prints and therefore what a session pays for.
  "--id": { kind: "value", usage: "[--id <id> ...]", valueName: "id" },
  // Filters (#5016). Repeatable like `--id`; values inside a flag OR, flags AND. `--status` is validated against
  // the CLOSED state vocabulary (src/readapi.mjs QUEUE_STATUSES, measured off the live store): `--status done2`
  // would otherwise answer "no rows" to a typo, which is the same defect as an unknown flag — a mistake rendered
  // as an empty success.
  "--status": { kind: "value", usage: "[--status <state> ...]", valueName: "state", values: QUEUE_STATUSES },
  "--to": { kind: "value", usage: "[--to <seat> ...]", valueName: "seat" },
  // A VIEWER form (#5016): bodies out, everything else unchanged. It is NOT a quiet convenience — it prints a loud
  // header in its own payload and on stderr, because a truncated view that does not announce itself becomes the
  // record a later reader trusts, and acting on a subject without its body is a failure this rig has registered
  // repeatedly. The attention/count derivation still runs over the FULL rows: projection is after derivation.
  "--no-body": { kind: "flag", usage: "[--no-body]" },
  // #5770 — the BOUNDED park view. `--held` is shorthand for `--status held`; `--with-gates` projects each row
  // to ONLY the fields that answer "who parked it, on what, when do we look again" (no body, no subject); `--limit`
  // caps how many rows are emitted. Bounded by construction: bodies are dropped, the count is capped, and an
  // unbounded request (`--limit 0`, or above the cap) is REFUSED rather than silently dumping the store — the
  // unbounded version of this read reached 25 MB in a devtools scratch export.
  "--held": { kind: "flag", usage: "[--held]" },
  "--with-gates": { kind: "flag", usage: "[--with-gates]" },
  // #7113 — the PRIORITY LEASE readout for a human. It prints TEXT, not the JSON document, which is why the
  // byte contract of the default form survives: nothing derived is added to the dump, a second view is added.
  "--human": { kind: "flag", usage: "[--human]" },
  "--limit": { kind: "value", usage: "[--limit <n>]", valueName: "n" },
};
const QUEUE_USAGE = `node cli.mjs queue ${Object.values(QUEUE_FLAGS).map((f) => f.usage).join(" ")}`;

// What a bad argument costs: exit 1, a structured `ok:false` on STDOUT (the machine half, the shape pinned by
// `demo/queue-compat-args.test.mjs`), and on STDERR the offending argument plus EVERY known flag (#5016: the
// point of refusing is that the caller can correct the typo without opening the source). A refusal never prints
// the document — that is the fail-open's cost, and it is asserted (~100 B against a 22 MB dump).
function refuseQueueArgument(why) {
  const known = Object.keys(QUEUE_FLAGS).join(", ");
  process.stderr.write(`queue: ${why}\n  known flags: ${known}\n  usage: ${QUEUE_USAGE}\n`);
  fail(`queue: ${why} (known flags: ${known})`);
}

// #7113 — the OPERATOR-facing priority-lease readout, reachable only through `--human`.
//
// WHY IT IS A SEPARATE VIEW INSTEAD OF A FIELD. `peek_queue` already renders a lease per row
// (`priority=now until=...`, `priority=now~lapsed@...`), but `node cli.mjs queue` prints the raw fields, so a
// human reading the store sees `priority` and `prioritySet` with no statement of whether the lease is LIVE,
// EXPIRED, or RECORDED-BUT-INERT — and "why didn't #6193 jump the queue" becomes a question nobody can answer
// from the readout. Adding a derived string to the JSON dump would break every script that diffs its bytes
// (#5016 pinned the default form for exactly that reason), so the human view is TEXT, printed on stdout, and
// the JSON form is untouched. `demo/queue-human-lease.test.mjs` compares the bare dump byte-for-byte against
// the pre-change CLI on the same store.
//
// WHAT IT SAYS, and only what is provable: the lease's EFFECTIVE level (from `effectivePriority`, the same
// function the selector uses, so the two views cannot disagree), who set it and why, whether it has lapsed,
// and — the part a JSON field cannot say — whether the recipient's resolved claim order honours it.
function humanQueueReadout(items, census, strategy, limit) {
  const now = Date.now();
  const leased = items.filter((it) => it.priority);
  const effOf = (it) => effectivePriority(it, now);
  const live = leased.filter((it) => !effOf(it).lapsed && !effOf(it).invalid);
  const lapsed = leased.filter((it) => effOf(it).lapsed);
  const invalid = leased.filter((it) => effOf(it).invalid);
  const order = [...live].sort((a, b) => effOf(a).rank - effOf(b).rank || a.id - b.id).concat(lapsed, invalid);
  const shown = order.slice(0, limit);
  const lines = [];
  lines.push(`queue — human lease view  db=${DB_PATH}  read at ${new Date(now).toISOString()}`);
  lines.push(`rows ${census.rows} | ${Object.entries(census.counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  const liveOnTerminal = live.filter((it) => TERMINAL_QUEUE_STATUSES.includes(it.status)).length;
  lines.push(
    `leases: ${leased.length} row(s) carry one — ${live.length} live, ${lapsed.length} lapsed, ${invalid.length} invalid; ` +
      `${census.rows - leased.length} carry none` +
      (liveOnTerminal ? ` — and ${liveOnTerminal} of the live ones sit on a TERMINAL row, which orders nothing` : ""),
  );
  lines.push(`claim order: team ${strategy.team.strategy} (${strategy.team.source})`);
  for (const [name, r] of Object.entries(strategy.seats ?? {})) lines.push(`  ${name}: ${r.strategy} (${r.source})`);
  lines.push("  a lease reorders ONLY a seat whose resolved strategy is priority_first (src/workstrategy.mjs).");
  for (const it of shown) {
    const e = effOf(it);
    const seat = strategy.seats?.[it.to];
    const why = it.prioritySet?.reason ? ` reason=${JSON.stringify(it.prioritySet.reason)}` : "";
    const by = it.prioritySet?.by ? ` by=${it.prioritySet.by}` : "";
    let effect;
    if (e.lapsed) effect = `INERT: the lease expired at ${e.expiresAt}; the row ranks ${e.priority} again`;
    else if (e.invalid) effect = `INERT: ${JSON.stringify(String(e.raw))} is not a priority (valid: ${PRIORITY_VALUES.join(" | ")})`;
    else if (TERMINAL_QUEUE_STATUSES.includes(it.status)) effect = `INERT: the row is ${it.status}, and a terminal row is never claimed — a lease on it orders nothing`;
    else if (!seat) effect = `INERT: ${it.to} is not a registered seat, so nothing can claim this row`;
    else if (seat.strategy !== "priority_first") effect = `INERT: ${it.to} claims ${seat.strategy} (${seat.source}), which ignores priority; the lease is recorded, not applied`;
    else effect = `HONOURED: ${it.to} claims ${seat.strategy} (${seat.source})`;
    lines.push(`  #${it.id} ${it.status} ${it.from}->${it.to}  ${priorityLeaseText(it, now)}${by}${why}  -> ${effect}`);
  }
  if (order.length > shown.length) lines.push(`  ... ${order.length - shown.length} more leased row(s) beyond --limit ${limit}`);
  if (!leased.length) lines.push("  no row in this view carries a priority lease; `set_priority` records one with a reason and an expiry.");
  lines.push(`  rows without a lease are not listed (the view is the leases, not the census: ${census.rows} rows exist).`);
  return lines.join("\n") + "\n";
}

async function cmdQueue(args = []) {
  const ids = [];
  const statuses = [];
  const to = [];
  let noBody = false;
  let gates = false;
  let human = false;
  let limit = GATE_VIEW_CAP;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const spec = QUEUE_FLAGS[a];
    // A bare positional (`queue 5063`) and a misplaced flag both land here: there is no positional form to
    // silently accept, and `main` accepting one was part of the fail-open.
    if (!spec) refuseQueueArgument(`unknown argument ${a}`);
    if (spec.kind === "flag") {
      // #5770: `--held` is a status filter (not a separate vocabulary), so it composes with `--to`/`--id`.
      if (a === "--held") statuses.push("held");
      else if (a === "--with-gates") gates = true;
      else if (a === "--human") human = true;
      else noBody = true;
      continue;
    }
    if (spec.kind === "value") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) refuseQueueArgument(`${a} needs a value`);
      // A closed vocabulary is only closed if the VALUE is checked too: an unrecognized state is refused by name,
      // with the legal set printed, rather than filtering everything out and reporting an empty queue.
      if (spec.values && !spec.values.includes(v))
        refuseQueueArgument(`${a} takes a queue state, not "${v}" (states: ${spec.values.join(", ")})`);
      if (a === "--id") ids.push(v);
      else if (a === "--status") statuses.push(v);
      else if (a === "--limit") {
        // Bounded by construction: `--limit 0` is not a limit, and a limit above the cap is the unbounded dump
        // this instrument exists to avoid. Refuse and name the cap instead of quietly printing the store.
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0)
          refuseQueueArgument(`--limit must be a positive integer (1..${GATE_VIEW_CAP}); "all" is not a limit`);
        if (n > GATE_VIEW_CAP)
          refuseQueueArgument(`--limit ${n} exceeds the bounded park view's cap of ${GATE_VIEW_CAP}`);
        limit = n;
      } else to.push(v);
      i += 1;
      continue;
    }
    // a known no-op: it changes nothing, because the document is already JSON.
  }
  // #7113 — the human lease view, before any JSON form. The scoping is the SAME filter the other forms use
  // (one owner, src/readapi.mjs), and the storage read is whole either way: the queue is ONE document, so
  // what narrows is the payload, never the read.
  if (human) {
    const all = await readData(DB_PATH, "queue", {}, (storage) => readQueueItems(storage));
    const census = queueCensusOf(all);
    const scoped = filterQueueItems(all, { ids: ids.length ? ids : null, statuses, to });
    const missing = ids.filter((id) => !all.some((it) => String(it.id) === String(id)));
    const seatsDoc = await readData(
      DB_PATH,
      "document",
      { kind: Seats.definition.kind, scope: { kind: "session" } },
      (storage) => readSeatsDocument(storage),
    );
    process.stdout.write(
      humanQueueReadout(scoped, census, workStrategyView(seatsDoc?.found ? seatsDoc.value : {}), limit),
    );
    // A typo'd id costs the same here as in the JSON form: exit 1, named on stderr, never an empty success.
    if (missing.length) {
      process.stderr.write(`queue: no such id(s): ${missing.join(", ")} — the store has ${census.rows} rows\n`);
      process.exit(1);
    }
    return;
  }

  const filtered = statuses.length > 0 || to.length > 0;
  // `--no-body` drops the body FIELD from the answer — nothing else. The derivation above/below still runs over
  // full rows, so a notice a body-bearing row produces survives the trim (asserted in
  // demo/queue-filter-attention.test.mjs).
  const stripBody = (it) => {
    const { body, ...rest } = it;
    return rest;
  };
  if (noBody) {
    // Loud in the terminal too, not only in the payload: this form exists for a human skimming a 22 MB store, and
    // the danger is that they forget which form they are looking at.
    process.stderr.write(
      "note: --no-body — BODIES ARE OMITTED from this view. Do not act on a subject you have not read in full: `node cli.mjs queue --id <id>` (or `show <id>`) prints the row with its body.\n",
    );
  }
  // THE DEFAULT IS TODAY'S BYTES (#5016): no flags, or only the `--json` no-op, and the answer is the whole
  // document — `{ok, command, items}`, unchanged — so anything that parses `queue` today keeps parsing it. Every
  // extra key below appears ONLY once a caller asked for a narrower view.
  if (ids.length === 0 && !filtered && !noBody && !gates) {
    const items = await readData(DB_PATH, "queue", {}, (storage) => readQueueItems(storage));
    out({ ok: true, command: "queue", items });
    return;
  }

  // THE DERIVATION ORDER (#5016). Counts, the row total and the attention lines are computed over the FULL,
  // UN-PROJECTED row set — before filters, before `--no-body`. That is what keeps a small view from being a false
  // green: bodies never carry a notice, so trimming them may not trim the notices, and a filter that shows 3 rows
  // must still say how many rows exist. The census comes from its own read view (`queue-census`) so the answer is
  // a few hundred bytes even when a broker serves it, instead of the 22 MB document the caller was avoiding.
  const census = await readData(DB_PATH, "queue-census", {}, (storage) => readQueueCensus(storage));
  const doc = {
    // The header is the FIRST key, so a reader meets it before any row: this payload is a projection, and what it
    // dropped is named.
    ...(noBody
      ? {
          projection: {
            noBody: true,
            droppedFields: ["body"],
            warning:
              "bodies are OMITTED from this view. Do not act on a subject you have not read in full — read the row with `queue --id <id>` (or `show <id>`) first (#5016).",
            derivedOver: `${census.rows} rows, bodies included`,
          },
        }
      : {}),
    ok: true,
    command: "queue",
    ...(ids.length ? { ids } : {}),
    ...(filtered ? { filter: { ...(statuses.length ? { statuses } : {}), ...(to.length ? { to } : {}) } } : {}),
    rows: census.rows,
    counts: census.counts,
    attention: census.attention,
    // Mechanism honesty (#5016): filters and `--no-body` narrow the PAYLOAD, never the storage read — the queue is
    // one document (`RigQueue.value.items`), so it is read whole every time. Saying which half moved is what stops
    // a small answer from being mistaken for a small read.
    narrowed: "payload",
  };

  if (ids.length > 0) {
    const items = [];
    const missing = [];
    for (const id of ids) {
      const row = await readData(DB_PATH, "queue-row", { id }, (storage) => readQueueRow(storage, id));
      const item = row?.item ?? null;
      // A requested row that the FILTER excludes is not "missing" — `missing` means the store has no such id, and
      // blurring the two would make a filter look like a typo.
      if (item && (statuses.length === 0 || statuses.includes(item.status)) && (to.length === 0 || to.includes(item.to)))
        items.push(item);
      else if (!item) missing.push(String(id));
    }
    // `ok:false` when an id matched nothing (#4986, unchanged): a caller that checks the flag must see the miss,
    // not just a reader who notices `missing`.
    out({ ...doc, ok: missing.length === 0, items: noBody ? items.map(stripBody) : items, ...(missing.length ? { missing } : {}) });
    if (missing.length) {
      process.stderr.write(`queue: no such id(s): ${missing.join(", ")} — the store has ${census.rows} rows\n`);
      process.exit(1);
    }
    return;
  }

  // A filter without ids reads the document (the storage read is whole either way) and then narrows what is
  // printed. `rows`/`counts`/`attention` above are still the whole store's.
  const all = await readData(DB_PATH, "queue", {}, (storage) => readQueueItems(storage));
  const items = filterQueueItems(all, { statuses, to });
  if (gates) {
    // THE BOUNDED CENSUS (#5770). Bodies are gone before projection, so this view cannot become the 25 MB
    // dump; the count is capped and the cap is REPORTED, so a caller who sees 200 rows knows 438 matched.
    const view = items.map(gateView);
    const gateless = view.filter((v) => v.gate === "none");
    out({
      ok: true,
      command: "queue",
      view: "gates",
      bounded: { limit, cap: GATE_VIEW_CAP, matched: items.length, shown: Math.min(items.length, limit), truncated: items.length > limit },
      filter: { statuses, ...(to.length ? { to } : {}) },
      rows: census.rows,
      counts: census.counts,
      // The number the census was asked for: held rows with NOTHING recorded about why they are parked.
      gatelessHeld: view.filter((v) => v.status === "held" && v.gate === "none").length,
      items: view.slice(0, limit),
      ...(gateless.length ? { gatelessIds: gateless.map((v) => v.id) } : {}),
      narrowed: "payload",
    });
    if (items.length > limit) {
      process.stderr.write(
        `queue: --with-gates is capped at ${GATE_VIEW_CAP} rows; ${items.length} matched, ${limit} shown. Raise it with --limit <= ${GATE_VIEW_CAP} or filter with --to <seat>.\n`,
      );
    }
    return;
  }
  out({ ...doc, items: noBody ? items.map(stripBody) : items });
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
  // ROADMAP 69: `resume` is a compound WRITE (it settles stranded submissions),
  // so a second owner while the broker drives is the 2026-10-16 crash. Refuse.
  // ROADMAP 71 / #912 residue 3/3 (#1931): the refusal is the CHOICE, and it names WHY. With a broker
  // alive the broker ALREADY settles stranded submissions — at startup (`reconcileBrokerStartup`) and at
  // the start of every pass (`reconcileStrandedSubmissions`, logged `STRANDED settled=N`) — so an
  // external `resume` has nothing to do, and running it would be the SECOND WRITER that crashed the
  // broker on 2026-10-16. Do NOT stop a live broker to run this; restart a dormant one instead.
  refuseWhileBrokerDrives(
    "resume/doctor",
    // #4170: the message must be TRUE for every class it implies. The broker settles STRANDED
    // (`placed` with no advancing task) at startup and at the start of every pass — but it does NOT
    // settle a NEVER-STARTED (`queued`) submission, which is a different class, and saying otherwise
    // is why the operator's first instinct was to restart rather than to resume. The suppression half
    // is now fixed (a `queued` row no longer holds its seat out of every wake); the settlement half
    // for `queued` awaits the ADMISSION DEADLINE (ROADMAP 37(c)) — settling it without one would
    // cancel submissions that are legitimately still being admitted.
    `the broker settles STRANDED submissions ITSELF — those it PLACED but whose turn never finished — ` +
      `at startup and at the start of every pass (logged "STRANDED settled=N"), so there is nothing for ` +
      `an external resume to do while it drives, and running one would be a second writer. ` +
      `NOTE: a NEVER-STARTED (\`queued\`) submission is NOT that class and is not settled this way; it ` +
      `no longer suppresses its seat, and its settlement awaits an admission deadline (ROADMAP 37(c)). ` +
      `Do NOT stop a live broker for this; if it is dormant, restart it so its startup pass re-settles. ` +
      `See docs/runbooks/resume-while-broker-runs.md.`,
  );
  const { harness } = await openHarness();
  try {
    const seatsDoc = await harness.snapshot(Seats, undefined, BACKGROUND_CONTEXT);
    const seatsVal = seatsDoc?.seats ?? {};
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


// Model-change DETECTION for the cmdUp reset seam (#402; #148 half-2; lead #241):
// the conversation's CONFIGURED model is what `configure` last wrote (AgentDoc.model —
// the idempotent reference point: the switch boundary this seam drew last time is part
// of that doc), and the rig spec WOULD apply its resolved seat model. A difference is
// an ACTUAL CHANGE that would leave the seat re-conditioning on a context written for
// another model (#148) — the reset fires at that boundary, then configure rewrites it.
// (The newer-pi.assistant ran-under read stays as a comment-level note: ran-under LAGS
// config between refresh and next generation, so it can never provide the idempotent
// reference the ruling demands.)
// Read-only: snapshot for Seats + RigQueue in ONE pass (carried claimed ids for
// the handoff, per #154) + one AgentDoc read per existing seat.
// @returns {Array<{seat:string, from:string, to:string, convId:number|string, claimedIds:number[]}>}
import { AgentDoc } from "@earendil-works/pi-durable";
async function detectModelMismatch(harness, spec, resolvedPromptBySeat) {
  const context = BACKGROUND_CONTEXT;
  const [seatsDoc, queueDoc] = await Promise.all([
    harness.snapshot(Seats, undefined, context),
    harness.snapshot(RigQueue, undefined, context),
  ]);
  const seatsVal = seatsDoc?.seats ?? {};
  const claimedIds = new Map(); // seat -> claimed item ids it holds
  for (const it of queueDoc?.items ?? []) {
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
      const agentDoc = await harness.snapshot(AgentDoc, registered.conversationId, context);
      const ref = agentDoc?.model;
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
async function cmdReset(seatName, handoff, { dryRun = false } = {}) {
  // ROADMAP 69: `reset` writes a context boundary — a second owner while the
  // broker drives. Refuse before opening a harness (the live-lease guard inside
  // resetSeatContext is a narrower, per-seat check). `--dry-run` writes nothing
  // (ROADMAP 84), so it does not need the broker stopped.
  if (!dryRun) refuseWhileBrokerDrives("reset");
  const { harness } = await openHarness(dryRun ? { resume: false } : {});
  try {
    // Delegate to the SHARED boundary mechanism (#402): same unknown-seat fail,
    // same live-lease guard, same watermark + conversation.reset write path.
    const result = await resetSeatContext(harness, seatName, handoff, DB_PATH, { dryRun, maxSeats: maxSeats() });
    if (dryRun) {
      // A preview: name the seat and whether the write would happen; write NOTHING.
      out({
        ok: true,
        command: "reset",
        dryRun: true,
        seat: seatName,
        wouldReset: !result.refused,
        ...(result.refused ? { refused: true, reason: result.reason } : { handoff: result.handoff }),
        writes: 0,
        db: DB_PATH,
      });
      return;
    }
    if (result.refused) {
      if (result.reason === "unknown-seat") {
        noteEmptyRig(result.seatCount ?? 0);
        fail(`unknown seat: ${seatName}`);
      }
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

// compact: a MANUAL compaction of a seat's context (ROADMAP 61-67 daemon group, operator TASK 1).
// Where `reset` draws a boundary and DROPS the prior turns from the model context, `compact`
// SUMMARIZES them: pi-durable's conversation.compact() creates a conversation-owned
// `pi.compaction` task that selects an old prefix, summarizes it with the seat's own model, and
// places a summary entry whose `head` is the first kept entry. The durable transcript is
// preserved (a summary ENTRY, not a deletion) — only the model CONTEXT shrinks, so the seat
// keeps what it learned without re-reading every turn.
//
// TRUTHFULNESS (the item's hard requirement): compact() only COMMITS the task and returns its
// id — the commit does not run it. The harness drives tasks through its TaskScheduler, so the
// CLI must resume and WAIT for the task (harness.waitForTask) and then prove a compaction entry
// landed. An enqueue-and-exit stub would report success while nothing was ever summarized. A
// manual compaction is foreground (`background = reason !== "manual"`), so waiting here is safe.
/**
 * Route a `compact` through the command spool (#1904): write the request, then AWAIT the
 * broker's result. The broker applies it with its OWN harness; this process never opens a
 * second one. The broker's actual outcome (or the dead-letter reason) is reported, never
 * guessed.
 */
async function compactViaSpool(seatName, instructions, broker) {
  const requestId = randomUUID();
  const text = instructions !== undefined && instructions.trim() !== "" ? instructions : undefined;
  writeIntent(DB_PATH, {
    op: "compact",
    to: seatName,
    ...(text !== undefined ? { instructions: text } : {}),
    requestId,
    from: "operator",
    createdAt: new Date().toISOString(),
  });
  const awaited = await awaitIntentResult(DB_PATH, requestId);
  if (!awaited.ok) {
    fail(`compact via the spool (broker pid ${broker.pid}): ${awaited.reason}`);
  }
  const r = awaited.result.result ?? {};
  out({
    ok: true,
    command: "compact",
    seat: seatName,
    viaSpool: true,
    requestId,
    brokerPid: broker.pid,
    taskId: r.taskId ?? null,
    instructions: r.instructions ?? null,
    summaryEntryId: r.summaryEntryId ?? null,
    db: DB_PATH,
  });
}

async function cmdCompact(seatName, instructions) {
  // ROADMAP 71 addendum (#1904): while a broker drives, ROUTE through the command spool — the
  // broker applies `compact` with its OWN harness (single writer/scheduler), so a live rig can
  // compact WITHOUT stopping the broker. We must NOT open a second harness here.
  const broker = readBrokerState(DB_PATH);
  if (brokerAlive(broker)) {
    return await compactViaSpool(seatName, instructions, broker);
  }
  // No broker: the DIRECT path (a fresh harness), guarded against a live generation lease —
  // compact writes a context boundary, so it must not race a running generation's writer.
  const { harness } = await openHarness();
  try {
    const seatsDoc = await harness.snapshot(Seats, undefined, BACKGROUND_CONTEXT);
    const seatsVal = seatsDoc?.seats ?? {};
    const seat = seatsVal[seatName];
    if (!seat) {
      noteEmptyRig(Object.keys(seatsVal).length);
      fail(`unknown seat: ${seatName}`);
    }

    // Refuse when the seat holds a LIVE generation lease — the same seatsWithLiveSlot guard
    // reset/resume compute (readGenerationSlots -> generatingSeat; ROADMAP 37a). Compacting a
    // seat mid-generation would race the generation that owns the context being rewritten.
    const slots = maxSeats();
    const genSlots = Number.isFinite(slots) ? readGenerationSlots(DB_PATH, slots) : [];
    const seatsWithLiveSlot = new Set(
      genSlots.filter((g) => g.generatingSeat).map((g) => g.generatingSeat),
    );
    if (seatsWithLiveSlot.has(seatName)) {
      fail(`seat ${seatName} holds a live generation lease; refusing to compact a running seat`);
    }

    const conv = await harness.conversation(seat.conversationId, BACKGROUND_CONTEXT);
    if (FAUX) {
      // Offline smoke mode (same seam as cmdSend): the summarization phase is a model call, so
      // the faux provider needs one canned reply per compaction. Scripting is per-process, so
      // the demos under demo/ drive full loops; here the CLI only needs the call to return.
      FAUX.appendResponses([
        fauxAssistantMessage([{ type: "text", text: "(faux) compacted summary." }]),
      ]);
    }
    // Omitted or blank instructions means a plain compaction (no operator guidance folded into
    // the summary prompt); only a non-blank string is passed through.
    const text = instructions !== undefined && instructions.trim() !== "" ? instructions : undefined;
    const taskId = await conv.compact(text, BACKGROUND_CONTEXT);
    // Drive the task to completion. Without this the verb would return a task id for work nobody
    // runs — exactly the stub the item forbids. The settled record is kept because it is where a
    // FAILED compaction names its reason (#4898's three-state reporting).
    const settled = await harness.waitForTask(taskId, BACKGROUND_CONTEXT);

    // PROVE the compaction happened, not merely that a task ran: pi-durable places a
    // `pi.compaction` summary entry. THREE STATES with distinct exit codes (#4898), because the old
    // single message covered two opposite facts and misled four sessions: "no compaction entry was
    // written" was printed for a NO-OP (nothing was worth cutting - pm at 184,507/200,000, task
    // 275491) AND for a repair that did not work (qa2 at 18,453 of 24,576, task 275492). COMPACTED 0,
    // FAILED 1, NO-OP 2 (not an error: the rig declined to spend a summarizer call).
    const after = await conv.entries({ order: "descending" }, 50, undefined, BACKGROUND_CONTEXT);
    const summary = after.items.find((e) => e.kind === CompactionEntry.kind);
    // The failure reason is whatever the platform reported, never a guess. `waitForTask`'s return shape
    // could not be re-read in this worktree (it has no `node_modules` of its own and this seat's reads
    // are confined to the worktree), so the reason is read from whichever field carries it and the
    // report prints `unknown` when none does.
    const failureReason = settled?.error ?? settled?.failure?.reason ?? settled?.reason ?? null;
    // The seat's token count against the policy, so a NO-OP explains itself. The selection gate is the
    // accumulation budget (`keepRecentTokens`), not the window - the window is context, and printing it
    // is what lets an operator see WHY the gate sat where it does.
    const consumption = contextConsumption(after.items, { declared: declaredContextWindow(CFG, seat.model ?? seat.modelId ?? null) });
    const policy = compactionSettings(CFG).compaction ?? {};
    const report = compactionReport({
      consumed: consumption.consumed,
      policy,
      summaryEntry: summary ?? null,
      failureReason,
    });
    if (report.state === "failed") {
      fail(
        `compact: ${report.reason} for seat ${seatName} (task ${taskId}) - consumed=${report.consumed}, ` +
          `keepRecentTokens=${report.keepRecentTokens ?? "platform default"}, willCut=${report.willCut ?? "unknown"}` +
          (summary ? "" : "; no pi.compaction entry among the newest 50 entries"),
      );
    }
    out({
      ok: true,
      command: "compact",
      state: report.state,
      seat: seatName,
      taskId,
      instructions: text ?? null,
      summaryEntryId: report.summaryEntryId ?? null,
      // The numbers beside the verdict: what the seat had consumed, the window it is measured against,
      // the policy in force for it, and whether that policy would have cut anything at that count.
      consumed: report.consumed,
      window: consumption.window?.value ?? null,
      windowDenominator: consumption.window?.denominator ?? null,
      fraction: consumption.fraction,
      policy,
      willCut: report.willCut,
      db: DB_PATH,
    });
    // A NO-OP exits 2 so a script can tell it apart from a compaction (0) and a failure (1). The
    // `state` field carries the same fact even in a tree where a later dispatcher overwrites the code.
    if (report.exitCode !== 0) process.exitCode = report.exitCode;
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
  const seatsDoc = await harness.snapshot(Seats, undefined, context);
  const queueDoc = await harness.snapshot(RigQueue, undefined, context);
  const seatList = Object.entries(seatsDoc?.seats ?? {}).map(([name, seat]) => ({ name, ...seat }));
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
  // Bounded page: the current run sits at the top. Read ONCE and shared by both passes below - the supervisor
  // needs the run's ERROR MESSAGE (#5047: the submission record carries only the category `model_error`, and the
  // category is exactly what hides a spend-cap stop from the escalation that should park it on the first failure
  // instead of the third), and the degeneration guard needs the same entries.
  const pages = await readSeatPages(probeStorage, context, seatList, SCAN_LIMIT);
  const errorByConv = new Map();
  for (const seat of seatList) {
    for (const entry of pages[seat.name] ?? []) {
      const msg = Array.isArray(entry?.model) ? entry.model[0] : null;
      if (msg?.errorMessage) {
        errorByConv.set(seat.conversationId, msg.errorMessage);
        break; // newest first, so the first hit is the most recent failure
      }
    }
  }
  const plans = planEscalations({ seats: seatList, queueItems: queueDoc?.items, failureStreakByConv, errorByConv });
  const escalations = await applyEscalations(harness, plans, context);

  // Degeneration guard (mitigations 1+2 for the F29 class): reset a seat whose CURRENT run
  // has outgrown its turn/context bound, or shows step-repetition / malformed tool calls.
  // Detection is pure (src/degeneration.mjs); the write is the existing reset boundary, and
  // it is idempotent (a page already ending in `pi.reset` is skipped) so a pass loop cannot
  // re-reset a seat before it has run again.
  const assessmentsByConv = new Map();
  for (const seat of seatList) {
    assessmentsByConv.set(seat.conversationId, assessRun(pages[seat.name] ?? []));
  }
  const resets = await applyResets(harness, planResets({ seats: seatList, assessmentsByConv }), context);
  return [...escalations, ...resets];
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
  const { harness, storage: harnessStorage } = await openHarness({ enforceSeatRoot: true });
  // A raw read-only handle for probing seat documents. The driving harness fails
  // its whole session on the first storage error, so an unreadable `pi.live` must
  // be detected through this handle BEFORE the harness opens that conversation
  // (P5 / #110). One handle for the run; closed with the harness.
  const probeStorage = await openStore();
  // Bounded-run state (#147): `startedAt` drives --max-duration; `stopping` is set by a signal
  // so the loop breaks AFTER the pass in flight settles (waitForIdle), never mid-run. Declared
  // here, not inside the try, because the finally removes the handlers and reports `stoppedBy`.
  const startedAt = Date.now();
  let stoppedBy = null;
  // #314: the signal seam in src/signals.mjs owns the flag; this verb only names WHY it stopped.
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
      if (isStopping()) {
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
        readStorage: harnessStorage,
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
      if (watch) {
        if (await stoppableSleep(750)) break; // a Ctrl-C ends the watch loop inside the cadence, not after it
      }
    }
    out({ ok: true, command: "run", db: DB_PATH, passes, failedSeats: [...failedSeats], stoppedBy, escalated: escalations.length });
  } finally {
    // #314: no per-verb handler to remove here - src/signals.mjs owns the listeners for the
    // whole process, and a verb that unregistered them would leave the process un-interruptable.
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
    await stoppableSleep(50);
  }
  return { started: false, reason: `broker did not report within 3s; see ${logPath}` };
}

// serve --stop: the off switch for a broker started by `up` (or by hand). On POSIX
// the broker receives SIGTERM and stops after the pass in flight settles. On Windows
// Node does not deliver SIGTERM, so the fallback is to write a .stop request file that
// the broker polls between passes (F35). If the broker is still alive after 5s,
// process.kill is the last resort.
/**
 * `pause` / `unpause` (ROADMAP 131): drain the rig to quiescence before a broker upgrade.
 *
 * Producer discipline (AC4): with a resident broker, this NEVER opens the store — it spools
 * one request (`<db>.broker.inbox/`) that the broker applies with its OWN writer, so it is
 * not a second writer (the reason ROADMAP 71 exists). With NO resident broker, this process
 * is the sole writer, so it applies the flag directly with its own harness. `--wait` returns
 * only once every seat has settled (AC5).
 */
async function cmdPause(paused, { wait = false, reason = undefined } = {}) {
  const broker = readBrokerState(DB_PATH);
  if (brokerAlive(broker)) {
    const requestId = randomUUID();
    writeIntent(DB_PATH, {
      op: paused ? "pause" : "unpause",
      to: null,
      from: "operator",
      wait,
      ...(reason !== undefined ? { reason } : {}),
      requestId,
      createdAt: new Date().toISOString(),
    });
    const result = wait ? await awaitIntentResult(DB_PATH, requestId) : null;
    out({
      ok: true,
      command: paused ? "pause" : "unpause",
      db: DB_PATH,
      appliedBy: "broker",
      requestId,
      paused,
      ...(result ? { quiesced: result.result?.quiesced === true, waitedMs: result.result?.waitedMs ?? null } : {}),
    });
    return;
  }
  // No resident broker: this process is the only writer, so apply it directly.
  const { harness } = await openHarness({ enforceSeatRoot: true });
  try {
    const result = await applyPauseOp(harness, { paused, by: "operator", reason, wait }, BACKGROUND_CONTEXT);
    out({ ok: true, command: paused ? "pause" : "unpause", db: DB_PATH, appliedBy: "cli", paused: result.paused, ...(result.quiesced ? { quiesced: true, waitedMs: result.waitedMs } : {}) });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}

/** Poll the broker's intent result file until it appears (the applied/refused outcome).
 * #314: a Ctrl-C returns here in one poll, and the report says which request was left in the
 * spool — a mutating verb that dies silently leaves work the next pass will do anyway. */
async function awaitIntentResult(dbPath, requestId, { timeoutMs = null, pollMs = 100 } = {}) {
  const path = join(intentResultDir(dbPath), `${requestId}.json`);
  // #314 / #6160: the bound is HEALTH-derived, not a fixed 15 minutes. `pause --wait` and `compact`
  // polled 900 s with no progress check — the same silence the read path closed. An ADVANCING broker
  // keeps the long bound (a compaction is real work); a resident broker with a frozen pass gets the
  // degraded bound and a failure that NAMES the cause and the remedy. `DURIG_INTENT_WAIT_MS` overrides
  // it so a demo can exercise the leg in milliseconds.
  const envOverride = parseInt(process.env.DURIG_INTENT_WAIT_MS, 10);
  const override = Number.isFinite(envOverride) && envOverride > 0 ? envOverride : null;
  const streamTimeoutMs = streamSettings(CFG).stream?.timeoutMs ?? null;
  const startedAt = Date.now();
  const why = (health) =>
    `heartbeat ${health.hbAgeMs ?? "unknown"} ms old, last completed pass ` +
    `${health.passAgeMs === null ? "never" : `${health.passAgeMs} ms ago`}, ` +
    `${liveGenerationLeases(dbPath).length} generation lease(s) live`;
  for (;;) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // Not yet written (or mid-write); keep polling until the deadline.
    }
    const state = readBrokerState(dbPath);
    const { boundMs, health } = intentWaitBoundMs(state, { streamTimeoutMs });
    const bound = override ?? boundMs;
    if (bound === 0) {
      fail(
        `${requestId}: no broker is resident to apply the request (${health.reason}). It is spooled in ` +
        `${intentInboxDir(dbPath)} and will be applied by the next pass. Remedy: ` +
        `node tools/broker-serve.mjs --start (docs/runbooks/broker-down-or-stalled.md).`,
      );
    }
    if (Date.now() - startedAt >= bound) {
      fail(
        `${requestId}: the broker (pid ${state?.pid}, ${health.state}: ${health.reason ?? "no progress"}) did not ` +
        `apply the request within ${bound} ms — ${why(health)}. Remedy: read ${dbPath}.broker.log and follow ` +
        `docs/runbooks/broker-down-or-stalled.md. Ctrl-C ends this wait in one poll.`,
      );
    }
    if (await stoppableSleep(pollMs)) {
      fail(
        `${requestId}: interrupted (${stopSignalName()}) while the broker was applying it; ` +
        `the request was spooled in ${intentInboxDir(dbPath)} and may still be applied by the broker's next drain`,
        );
    }
  }
}

/**
 * How long `serve --stop` waits for the broker PROCESS to exit before giving up without a
 * forced kill. Env-overridable (`DURIG_STOP_WAIT_MS`) so a demo can prove the decision fast.
 */
function stopWaitMs() {
  const v = parseInt(process.env.DURIG_STOP_WAIT_MS, 10);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
}

async function cmdStopBroker() {
  const state = readBrokerState(DB_PATH);
  if (!state) {
    out({ ok: true, command: "serve", action: "stop", db: DB_PATH, stopped: false, reason: "no broker is running" });
    return;
  }
  // #2420: liveness is RAW pid existence. A stale heartbeat does NOT mean the process is
  // gone — a broker wedged in a pass stops heartbeating while still running, and reading
  // that as "dead" cleared a live broker's state and reported `stopped:true` for it.
  // #2574: the pid guard keeps a NEWER broker's state file intact when we clear.
  if (!pidAlive(state.pid)) {
    clearBrokerState(DB_PATH, state.pid);
    out({ ok: true, command: "serve", action: "stop", db: DB_PATH, stopped: false, reason: "state was stale; cleared" });
    return;
  }
  // Write the stop request; the broker polls this between passes and exits cleanly
  // after the pass in flight settles (same behaviour as SIGTERM on POSIX).
  // Under load (multiple in-flight generations), a pass can take longer than the
  // previous 5s window, so we give up to 60s for cooperative settlement. No forced
  // kill: the broker WILL exit once its pass settles — waiting longer honours that.
  writeStopRequest(DB_PATH);
  // #2420: liveness here is RAW pid existence, not `brokerAlive`. `brokerAlive` also
  // demands a fresh heartbeat, so a broker wedged in a pass reads as dead and this command
  // reported `stopped:true` for a pid that was still running. The wait is a ceiling: the
  // broker exits at its own stop grace, so this only has to outlast that.
  const deadline = Date.now() + resolveStopGraceMs() + 5_000;
  while (Date.now() < deadline && pidAlive(state.pid)) {
    if (await stoppableSleep(100)) break; // the operator interrupted the wait; report the truth, don't keep polling
  }
  const stillAlive = pidAlive(state.pid);
  if (!stillAlive) {
    clearBrokerState(DB_PATH, state.pid);
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
    `serve --stop: broker pid ${state.pid} did not exit within the grace; ` +
      `pass may still be in-flight — check with \`serve --stop\` again`,
  );
  out({
    ok: true,
    command: "serve",
    action: "stop",
    db: DB_PATH,
    stopped: false,
    pid: state.pid,
    reason: "did not exit within the stop grace; no forced kill — check status again",
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
// #2420: the bounded-stop grace, in ms. Default a few seconds; a non-positive value is
// honoured (0 disables the bound), but an unparseable one falls back to the default so a
// bad env cannot silently remove the bound.
const STOP_GRACE_DEFAULT_MS = 5_000;
function resolveStopGraceMs() {
  const raw = process.env.DURIG_STOP_GRACE_MS;
  if (raw === undefined || raw === "") return STOP_GRACE_DEFAULT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : STOP_GRACE_DEFAULT_MS;
}

// The seam itself is installed by the FIRST import (src/cli-seam.mjs). This second call only
// RAISES the grace for the resident verbs, using `resolveStopGraceMs` which is not available
// at import time. src/signals.mjs treats a repeat call as an upgrade, never a removal.
const FIRST_VERB = process.argv[2] ?? "";
installSignalHandlers({
  gracefulMs:
    FIRST_VERB === "serve" || (FIRST_VERB === "run" && process.argv.includes("--watch"))
      ? resolveStopGraceMs() + 3000
      : 1500,
});

async function cmdServe({ maxDurationMs = 0, stop = false } = {}) {
  if (stop) return cmdStopBroker();
  // One broker per database: a second would be a second driver, and its wakes would
  // race the first's. A live holder fails closed; a dead one is stale and replaced.
  const existing = readBrokerState(DB_PATH);
  if (brokerAlive(existing)) {
    fail(`a broker is already running for ${DB_PATH} (pid ${existing.pid}); stop it with "serve --stop" first`);
  }
  const scheduler = new WakeScheduler({
    minIntervalMs: 500,
    seatCooldownMs: SERVE_SEAT_COOLDOWN_MS,
  });
  const signal = createWakeSignal();
  // #2572: the serve handles are CREATED here, so their LIFECYCLE lives here too. `openHandles`
  // opens the harness + the probe storage AND subscribes, so a reopen restores the SAME
  // invariant in ONE place: a reopen without a re-established commit subscription leaves the
  // broker DORMANT (no stream -> no pass), which is exactly the failure the recovery exists for.
  const openHandles = async () => {
    const { harness, storage: harnessStorage } = await openHarness({ enforceSeatRoot: true });
    // A raw read-only handle for probing seat documents — the SAME P5 / #110 exception as cmdRun,
    // and the reason F8 is scoped rather than deleted (lead ruling #2874, option B): the driving
    // harness fails its WHOLE session on the first storage error, so an unreadable `pi.live` must
    // be detected through this separate handle BEFORE the harness opens that conversation. The
    // spooled `read` op is still served from the harness Storage (`readStorage ?? probeStorage`),
    // so this is a second CONNECTION for probing only, not a second reader of the store. One handle
    // for the run; closed with the harness.
    const probeStorage = await openStore();
    // Subscribe BEFORE the first pass so a commit that lands during startup is not missed. The
    // listener must not throw, block, or call Session APIs: it only classifies and signals.
    const unsubscribe = followCommits(harness, (publication) => {
      scheduler.notify(publication);
      if (scheduler.dirty) signal.raise();
    });
    return { harness, harnessStorage, probeStorage, unsubscribe };
  };
  let handles = await openHandles();
  // F2 (#2572): a terminal `SessionFailed` needs a close+reopen of BOTH handles AND a fresh
  // subscription, atomically. A failed close (a dead Session may refuse) must not block the
  // reopen, so each teardown step is guarded; the loop swaps to the returned handles.
  const reopen = async () => {
    try {
      handles.unsubscribe();
    } catch {
      /* removing a listener must not mask the reopen */
    }
    try {
      await handles.harness.close(BACKGROUND_CONTEXT);
    } catch {
      /* a failed Session may refuse to close; the reopen below still recovers */
    }
    try {
      await handles.probeStorage.close(BACKGROUND_CONTEXT);
    } catch {
      /* idem */
    }
    handles = await openHandles();
    return { harness: handles.harness, probeStorage: handles.probeStorage, readStorage: handles.harnessStorage };
  };
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
  const startedAt = Date.now();
  let stopRequestedAt = null;
  // #2420 (operator ruling): a resident daemon must have a BOUNDED graceful stop with an
  // unconditional force fallback. `DURIG_STOP_GRACE_MS` is how long the broker may keep
  // draining after a stop is requested: the loop exits with `stoppedBy=deadline` at the
  // bound, and this timer is the LAST resort for a pass wedged inside a single hung call,
  // where no loop or in-pass check is ever reached. 0 disables the force timer.
  const stopGraceMs = resolveStopGraceMs();
  let forceTimer = null;
  const onSignal = () => {
    if (stopRequestedAt !== null) return;
    stopRequestedAt = Date.now();
    signal.raise(); // interrupt a resting wait, so a signal is not stuck behind the floor
    if (stopGraceMs > 0) {
      forceTimer = setTimeout(() => {
        // systemd TimeoutStopSec -> SIGKILL: the pass did not settle within the grace, so
        // exit anyway rather than become an unkillable daemon.
        try {
          logBrokerLine(DB_PATH, `EXIT pid=${process.pid} reason=deadline passes=-`);
        } catch {
          // the log is best-effort on the force path
        }
        try {
          clearBrokerState(DB_PATH, process.pid);
          clearStopRequest(DB_PATH);
        } catch {
          // ignore: the process is leaving
        }
        console.error(JSON.stringify({ ok: true, command: "serve", forced: true, stoppedBy: "deadline" }));
        process.exit(0);
      }, stopGraceMs);
    }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    writeBrokerState(DB_PATH, { pid: process.pid, since: new Date().toISOString() });
    const result = await runWakeLoop({
      harness: handles.harness,
      probeStorage: handles.probeStorage,
      readStorage: handles.harnessStorage,
      reopen,
      scheduler,
      signal,
      context: BACKGROUND_CONTEXT,
      readBusySeats: () => {
        const slots = maxSeats();
        const genSlots = Number.isFinite(slots) ? readGenerationSlots(DB_PATH, slots) : [];
        return new Set(genSlots.filter((g) => g.generatingSeat).map((g) => g.generatingSeat));
      },
      supervise: () => superviseOnce(handles.harness, handles.probeStorage, BACKGROUND_CONTEXT),
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
      isStopping: isStopping,
      stopGraceMs,
      stopRequestedAt: () => stopRequestedAt,
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
    if (forceTimer) clearTimeout(forceTimer);
    // Clear only OUR state: a newer broker that already took over must keep its file.
    clearBrokerState(DB_PATH, process.pid);
    clearStopRequest(DB_PATH);
    handles.unsubscribe();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await handles.harness.close(BACKGROUND_CONTEXT);
    await handles.probeStorage.close(BACKGROUND_CONTEXT);
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
    const seatsDoc = await harness.snapshot(Seats, undefined, BACKGROUND_CONTEXT);
    const seatsVal = seatsDoc?.seats ?? {};
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

    // (ii) guarantee the halt: kill the cross-process driver that holds the lease — but ONLY
    // after VERIFYING the lease still names the same live, renewing holder (A3, #2586): a
    // recycled pid would otherwise kill an unrelated process. When the lease cannot be verified
    // we PREFER SETTLING (step iii) over killing.
    let killed = null;
    let killError = null;
    let killSkipped = null;
    let slotPath = null;
    if (holder && Number.isFinite(holder.pid)) {
      slotPath = `${DB_PATH}.genlock.${holder.slotIndex}`;
      const fresh = readGenerationSlots(DB_PATH, maxSeats()).find((g) => g.slotIndex === holder.slotIndex);
      const target = leaseKillTarget(holder, fresh, seatName);
      if (target.kill === null) {
        killSkipped = target.skip;
      } else {
        killed = target.kill;
        try {
          process.kill(killed, "SIGKILL");
        } catch (err) {
          // The holder may already have died, which only helps the stop; the reason is
          // captured and reported so a failed kill against a LIVE pid is not swallowed.
          killError = String(err?.message ?? err);
        }
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
      killSkipped,
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
  // ROADMAP 92 / operator batch 4 (#1585): `send` is being RETIRED in stages —
  // deprecate (this notice) -> thin alias over the spool -> remove. It opens a FULL
  // writing harness, so it is a second owner whenever a broker drives (the crash
  // class this rig has already paid for twice), and `refuseWhileBrokerDrives` below
  // makes it unusable in resident mode anyway. The replacement already exists: the
  // spool (`node intent.mjs <seat> --body-file <file>`), which the broker drains as
  // operator input, plus `log`/`status` for the reply. The notice goes to STDERR: it
  // is a diagnostic, and stdout stays the one-JSON-doc contract.
  console.error(
    "send is DEPRECATED (opens a full writing harness = a second owner): prefer " +
      "`node intent.mjs <seat> --body-file <file>` (the broker delivers) and `log`/`status` for the reply",
  );
  // ROADMAP 69: `send` submits an input and drives the run — a second owner and
  // scheduler while the broker drives. Refuse once, before the write retry, so a
  // live broker never races it (withStoreWriteRetry only covers the entry-id race).
  refuseWhileBrokerDrives("send");
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
        const doc = await harness.snapshot(Seats, undefined, BACKGROUND_CONTEXT);
        const seatsVal = doc?.seats ?? {};
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
        } catch (err) {
          // An unreadable `pi.live` (P5/#110: `unresolvable path: [...]`) poisons the
          // session the moment the run materializes the conversation. Report it against
          // the SEAT and name the repair (D44 retires the corrupt incarnation) instead of
          // surfacing a bare storage error that does not say which conversation is wedged
          // or what to do (ROADMAP 70 read-boundary hardening).
          if (/unresolvable path/.test(String(err?.message ?? err))) {
            fail(
              `seat ${seatName}'s pi.live document is unreadable (${String(err?.message ?? err)}), so its run cannot start. ` +
                `Retire the corrupt document and retry (docs/DECISIONS.md D44; scripts/repair-pi-live.mjs).`,
            );
          }
          throw err;
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
  const interactive = Boolean(process.stdout.isTTY);
  const color = human && interactive && !process.env.NO_COLOR;
  // #314: src/signals.mjs owns the stop flag; this verb checks it on each poll instead of
  // registering its own listener.
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
    const live = await readData(DB_PATH, "live", { conversationId }, (s) => readLiveState(s, conversationId));
    const partial = partialView(live);
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
  {
    const seats = await readData(DB_PATH, "seats", {}, (s) => readSeatList(s));
    const seat = seats.find((s) => s.name === seatName);
    if (!seat) {
      noteEmptyRig(seats.length);
      fail(`unknown seat: ${seatName}`);
    }

    // Newest `limit`, then reversed: a reader wants the recent end of a long
    // transcript, but once it is chosen the order shown must be chronological.
    const page = await readData(
      DB_PATH,
      "entries",
      { conversationId: seat.conversationId, limit, order: "descending" },
      (s) => s.scanEntries({ conversationId: seat.conversationId, order: "descending" }, limit, undefined, BACKGROUND_CONTEXT),
    );
    const history = [...page.items].reverse();
    print(history);
    if (!follow) return;

    let lastId = history.reduce((max, e) => Math.max(max, e.id ?? 0), 0);
    await pollPartial(seat.conversationId);
    while (!isStopping()) {
      if (await stoppableSleep(WATCH_POLL_MS)) break;
      // Clear the streaming block before committed output so a committed turn can
      // never end up above the partial it supersedes on screen.
      if (streamingCount > 0) {
        process.stdout.write(`\x1b[${streamingCount}A\x1b[J`);
        streamingCount = 0;
      }
      let next;
      try {
        next = await readData(
          DB_PATH,
          "entries",
          { conversationId: seat.conversationId, order: "ascending", minEntryId: lastId + 1, limit: 200 },
          (s) => s.scanEntries({ conversationId: seat.conversationId, order: "ascending", minEntryId: lastId + 1 }, 200, undefined, BACKGROUND_CONTEXT),
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
// receives pushes; (2) even snapshot on an already-materialized doc
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
  // #314: src/signals.mjs owns the stop flag.
  let cursor = Number.isFinite(sinceSeq) ? sinceSeq : 0;
  {
    do {
      const { events, nextSeq } = await readData(DB_PATH, "feed", { sinceSeq: cursor }, (s) =>
        readFeed(s, BACKGROUND_CONTEXT, { sinceSeq: cursor }),
      );
      for (const event of events) console.log(JSON.stringify(event));
      // Advance the cursor past what we emitted, so a --follow poll never
      // replays the previous line and a reconnect resumes from `nextSeq`.
      if (events.length) cursor = Math.max(cursor, nextSeq);
      if (!follow || isStopping()) break;
      if (await stoppableSleep(WATCH_POLL_MS)) break;
    } while (!isStopping());
  }
}

async function cmdWatch(once, human) {
  let seq = 0;
  // #314: src/signals.mjs owns the stop flag.
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
  const initial = await readData(DB_PATH, "health", healthParams(), (s) =>
    readRigHealth(s, DB_PATH, slots, { cfg: CFG }),
  );
  // Watching the wrong database is silent by nature: no commits ever arrive.
  // Tell the operator up front which database is being watched.
  if (!human) noteEmptyRig(initial.seats.length);
  let last = JSON.stringify(initial);
  await render(initial);
  if (once) return;
  while (!isStopping()) {
    if (await stoppableSleep(WATCH_POLL_MS)) break;
    let health;
    try {
      health = await readData(DB_PATH, "health", healthParams(), (s) =>
        readRigHealth(s, DB_PATH, slots, { cfg: CFG }),
      );
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
/**
 * `worktree audit` (ROADMAP 76 / #1881): a READ-ONLY surface listing every registered worktree
 * with the queue status of its item, its UNCOMMITTED COUNT, its lock state, and the sweep's
 * KEEP-REASON (`live`/`locked`/`not-terminal`/`branch-unresolved`/`dirty`/`reapable`/`seat-root`),
 * so a leaked or dirty tree is visible and resolvable without guessing. Writes nothing.
 */
/**
 * `worktree scratch clean` (ROADMAP 76 leak source B prevention, #1907): unlock + remove every
 * registered verify-scratch worktree — the explicit teardown a verifier runs when its VERIFY
 * completes. A DIRTY scratch is REFUSED (never --force / git clean) and reported. Writes nothing to
 * the store; git only.
 */
async function cmdWorktreeScratchClean() {
  const repoPath = dirname(resolve(DB_PATH));
  const { removed, kept } = await cleanVerifyScratch({ repoPath });
  out({ ok: true, command: "worktree", subcommand: "scratch clean", repo: repoPath, removed, kept });
}

async function cmdWorktreeAudit() {
  const queueItems = await readData(DB_PATH, "queue", {}, (s) => readQueueItems(s));
  const seatRoots = await readData(DB_PATH, "roots", {}, (s) => readSeatRoots(s));
  {
    const LIVE = ["queued", "claimed", "deferred", "held"];
    const liveItemIds = new Set(queueItems.filter((it) => LIVE.includes(it.status)).map((it) => it.id));
    const terminalItemIds = new Set(queueItems.filter((it) => !LIVE.includes(it.status)).map((it) => it.id));
    const statusById = new Map(queueItems.map((it) => [it.id, it.status]));
    const repoPath = dirname(resolve(DB_PATH));
    const entries = await auditWorktrees({
      repoPath,
      liveItemIds,
      terminalItemIds,
      statusById,
      seatRoots: seatRoots.map((r) => r.cwd),
    });
    const counts = {};
    for (const e of entries) counts[e.keepReason] = (counts[e.keepReason] ?? 0) + 1;
    out({
      ok: true,
      command: "worktree",
      subcommand: "audit",
      db: DB_PATH,
      repo: repoPath,
      total: entries.length,
      counts,
      reapable: entries.filter((e) => e.keepReason === "reapable").length,
      dirty: entries.filter((e) => e.keepReason === "dirty").length,
      locked: entries.filter((e) => e.keepReason === "locked").length,
      seatRoots,
      worktrees: entries,
    });
  }
}

/**
 * `worktree prune-branch <name>` (#3491): remove a ref ONLY when every commit is patch-equivalent
 * to main AND no worktree holds it — the sanctioned route for the class `git branch -d` refuses
 * (a rebase-landed duplicate) and the seat guard refuses to force-delete. The guard is NOT
 * widened; this verb is the narrow door (see `prunePatchEquivalentBranch`).
 */
async function cmdWorktreePruneBranch(name) {
  if (!name) fail("worktree prune-branch needs a branch name, e.g. node cli.mjs worktree prune-branch designer-item-2103");
  const repoPath = dirname(resolve(DB_PATH));
  try {
    const result = await prunePatchEquivalentBranch({ repoPath, branch: name });
    out({ ok: true, command: "worktree", subcommand: "prune-branch", repo: repoPath, ...result });
  } catch (error) {
    // Refuse LOUDLY (ok:false + exit 1): a refusal is a report, not a retry signal.
    fail(error);
  }
}

async function cmdStatus(args = []) {
  const health = await readData(DB_PATH, "health", healthParams(), (storage) =>
    readRigHealth(storage, DB_PATH, maxSeats(), { cfg: CFG }),
  );
  // The claim order a rig RESOLVES to. Normally it rides in `health` (readRigHealth computes it), but a
  // resident broker older than this CLI serves a health payload that predates the field — the broker
  // outlives the code on disk, so that skew is the normal case after an update, not an edge case. Rather
  // than silently OMITTING the readout (the accepted-and-ignored class), fall back to the seats document
  // through the generic `document` view, which every broker version already serves. Cost: one extra spool
  // round-trip (~0.9 s measured on this box) ONLY under skew; a current broker pays nothing.
  const workStrategy =
    health.workStrategy ??
    workStrategyView(
      (await readData(
        DB_PATH,
        "document",
        { kind: Seats.definition.kind, scope: { kind: "session" } },
        (storage) => readSeatsDocument(storage),
      ))?.value ?? {},
    );
  noteEmptyRig(health.seats.length);
  // The broker's health (#2581 / BROKER-SUPERVISION §4): a fresh heartbeat alone is only
  // LIVENESS; `lastPassAt` carries PROGRESS, so a wedged-but-alive broker reads `degraded`,
  // not `up`. Read-only and cheap (one small file); the pass bound is the stream timeout + margin.
  const broker = brokerHealth(readBrokerState(DB_PATH), {
    streamTimeoutMs: streamSettings(CFG).stream?.timeoutMs ?? null,
  });
  // #6139: LIVENESS and PROGRESS are not enough to explain a read that times out. The spool census
  // (what is undrained, how much of it is reads, how long the oldest has waited) is what separates
  // "the broker is parked with queued reads" from "the broker is stuck somewhere else", and it is
  // a file read, so it answers even when every broker-routed read is timing out.
  const brokerView = { ...broker, spool: pendingIntentCensus(DB_PATH) };
  // #6082: the note census rides in the same view, so "is the mechanism working for THIS seat" is one read
  // away rather than a script against the store. It is a direct read-only open (src/fleethealth.mjs's
  // precedent), so it answers even when the broker is wedged and every broker-routed read times out.
  const noteCensus = args.includes("--no-notes")
    ? { skipped: true, why: "--no-notes; run without it for the per-seat continuity-note census" }
    : safeNoteCensus(DB_PATH, health.seats, health.queueItems);
  // #4403: the note is CARRIED IN THE JSON, not written to stderr. `status` IS the machine-readable
  // queue view (stdout is JSON by default, and `--json` is accepted), but a consumer that merges
  // streams (`2>&1`) parses the note as a JSON value and fails with "Invalid JSON primitive: note" —
  // and it fails only when a measure drifts, so a read works until it does not. A diagnostic that
  // can break the authoritative view must be IN the view: the human renderer shows it, a JSON
  // consumer reads it structurally, and NEITHER has to parse the other's format.
  const outOfBand = health.metrics.measures.filter((m) => m.state === "warn").length;
  const notes =
    outOfBand > 0 ? [`${outOfBand} measure(s) out of band - see: node cli.mjs metrics`] : [];

  // BOUND THE PAYLOAD (ROADMAP 331, the read-surface leg). Measured on this rig 2026-11-09:
  // `cli.mjs status --json` printed 28,543,835 bytes, of which `queueItems` was 24,746,566 — 88% of it rows in
  // `done`/`cancelled` that a status view cannot act on. A continuation note that lets a seat survive its window
  // is worth nothing if reading the rig re-introduces the same blowup, so the view ships the rows still in play
  // and NAMES what it dropped, in rows and bytes. The DERIVATION (counts, attention, peer graph) still runs over
  // the full row set — the #5016 rule — so a smaller payload never means a smaller rig.
  const wantFull = args.includes("--full-queue");
  const capArg = args.find((a) => a.startsWith("--queue-limit"));
  const cap = capArg ? Number(capArg.split("=")[1]) : QUEUE_VIEW_ROW_CAP;
  if (!Number.isInteger(cap) || cap <= 0) fail(`--queue-limit must be a positive integer (1..${QUEUE_VIEW_ROW_CAP})`);
  if (cap > QUEUE_VIEW_ROW_CAP) fail(`--queue-limit ${cap} exceeds the bounded view's cap of ${QUEUE_VIEW_ROW_CAP}; use --full-queue to ask for the whole document`);
  // The refusal is the point: an unbounded read of a store this size is the read that sits in the broker's
  // result channel until the stream times out. Ask for it and get a count, not a hang.
  if (wantFull) {
    const refusal = refuseOversizedQueueRead(health.queueItems, { capRows: cap });
    if (refusal) {
      out({ ok: false, command: "status", db: DB_PATH, error: refusal, rows: health.queueItems?.length ?? 0 });
      process.exitCode = 1;
      return;
    }
  }
  const view = projectQueueView(health.queueItems, { cap: wantFull ? Number.MAX_SAFE_INTEGER : cap, dropTerminal: !wantFull });
  // The derivations that a bounded view CANNOT recover from its own rows travel with it. Two of them are load-
  // bearing: the census (a capped view of 200 rows is not the rig's 6,021 rows), and the deferred backlog, which
  // is exactly the rows a session can act on and exactly the rows a terminal-only drop would hide. Measured
  // 2026-11-09: bounding status without this made `scripts/clockin.mjs` — which reads status for its queue
  // section — report a 200-row store and a zero deferred backlog against a store holding 384 deferred rows.
  // #6196: which pi THIS tree actually resolves. The same command in two trees can print opposite verdicts
  // (an unlinked tree at the lockfile release ran 262/283; the same tree linked to the pin ran 282/282), so
  // the status view names the dependency set it is describing instead of assuming the pinned one.
  // cli.mjs sits at the repository root, so the tree it ran in is its own directory - not the parent of a
  // worktree, which is what resolve(dirname(CLI_PATH), "..") would have named (#6196).
  const depProv = dependencyProvenance(resolve(dirname(CLI_PATH)));
  out({
    ok: true,
    command: "status",
    db: DB_PATH,
    dependencyProvenance: depProv,
    ...health,
    // Overrides the spread above when the fallback ran (a broker that predates the field).
    workStrategy,
    queueItems: view.rows,
    queueCensus: queueCensusOf(health.queueItems),
    queueDeferred: deferredBacklogRows(health.queueItems),
    // The peer graph is derived from the rows the view actually carries, so the graph a reader sees is the graph
    // of what they were shown - not a 6,021-edge history attached to 200 rows. The omitted edge count is named so
    // the smaller view cannot read as a smaller rig (the same rule as the census header in `queue`).
    peerGraph: peerGraph(view.rows),
    graphOmittedEdges: Math.max(0, (health.peerGraph?.edges ?? []).length - view.rows.length),
    queueView: {
      shown: view.shown,
      total: view.total,
      droppedTerminal: view.droppedTerminal,
      droppedCapped: view.droppedCapped,
      bytes: view.bytes,
      how: wantFull ? "full document" : `non-terminal rows, capped at ${cap}`,
      widen: "node cli.mjs status --full-queue",
    },
    // Opt-in, and named so a reader knows they asked for it: the ids+statuses of the rows the view dropped, so a
    // script that must join a branch to its row's state (clock-in's landing debt) can do it without re-reading
    // 24 MB of bodies.
    queueTerminalIndex: args.includes("--with-terminal-index") ? terminalStatusIndex(health.queueItems) : null,
    broker: brokerView,
    notes,
    noteCensus,
  });
}

/**
 * #6082 (N18 row 9): the per-seat continuity-note census, folded into `status`. A note mechanism that is
 * "armed" store-wide is not the same as a seat that has a note, read it, and was compacted ON it - so the
 * census reports the three facts per seat and NEVER fails the read: a store that cannot be opened reports
 * the reason in the section rather than taking `status` down with it. `--no-notes` skips the scan for a
 * faster read (one pass over `entries`, ~1.4 s on this rig's 424k-entry store).
 */
function safeNoteCensus(dbPath, seats, queue = []) {
  try {
    const census = readNoteCensus(dbPath, {
      seats: (seats ?? []).map((seat) => ({ name: seat.name, conversationId: seat.conversationId })),
      // #6161: "never compacted" means two different things. A seat holding nothing cannot reach a window
      // boundary; the queue rows in play tell the census which seats are idle and which are merely untested.
      queue: (queue ?? []).filter((item) => item.status === "claimed" || item.status === "queued"),
    });
    return { ...census, lines: renderCensus(census).split("\n") };
  } catch (error) {
    return { error: String(error?.message ?? error), seats: [], totals: null, skipped: true };
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

/** Every seat's ADVERTISED context window (the vendor catalog figure), keyed by seat.
 * ROADMAP 27's three-state denominator calls this the least-trustworthy state, so the
 * resolver in src/context.mjs prefers a `declared`/`measured` window whenever one exists;
 * this is only the fallback. Absent for a seat whose model the catalog does not carry. */
function resolveWindowsBySeat(spec) {
  const { models, providerId } = buildModels();
  const windowsBySeat = {};
  for (const seat of spec?.seats ?? []) {
    const r = resolveSeatModel(models, seat.model, providerId, MODEL_ID);
    const advertised = models.getModel(r.provider, r.modelId)?.contextWindow;
    if (Number.isFinite(advertised) && advertised > 0) windowsBySeat[seat.name] = { advertised };
  }
  return windowsBySeat;
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
  const health = await readData(
    DB_PATH,
    "health",
    healthParams({
      modelsBySeat: spec ? resolveModelsBySeat(spec) : {},
      windowsBySeat: spec ? resolveWindowsBySeat(spec) : {},
      entryLimit: parseWindow(windowArg),
    }),
    (storage) =>
      readRigHealth(storage, DB_PATH, maxSeats(), {
        modelsBySeat: spec ? resolveModelsBySeat(spec) : {},
        windowsBySeat: spec ? resolveWindowsBySeat(spec) : {},
        entryLimit: parseWindow(windowArg),
        cfg: CFG,
      }),
  );
  {
    noteEmptyRig(health.seats.length);
    if (human) {
      process.stdout.write(
        `${formatProvenance(provenance, provenance.active)}\n` +
          // #6196: the human view also says which pi this tree is running - a red measured here is only
          // comparable with a red measured in the same dependency set.
          `${formatDependencyProvenance(dependencyProvenance(resolve(dirname(CLI_PATH))))}\n` +
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
    // #491 C6: name where a default VALUE came from (the shipped file, or null).
    defaultsSource: CFG_DEFAULTS_SOURCE,
  });
}

// format [--check] [-- <paths>]: run the PINNED prettier over EXPLICIT paths
// (ROADMAP 90). Wraps devtools' tool choice (prettier 3.9.10 + .prettierrc.json)
// without adding an auto-hook or an on-write formatter: a seat runs it after its
// edits, before `git add`, so whitespace/EOL churn stops leaking into diffs. The
// JSON contract is one document; `--check` writes nothing and exits non-zero when
// a file is unformatted, so it can sit beside `node --check` as an explicit gate.
// EXPLICIT paths only - no glob and no default tree walk: the whole-tree normalize
// is a separate, gated, stop-the-world change (docs/FORMATTER.md).
async function cmdFormat({ check = false, paths = [] } = {}) {
  if (paths.length === 0) {
    fail("format needs explicit paths: node cli.mjs format [--check] [-- <paths>] (no glob, no default tree)");
  }
  let prettier;
  try {
    // Loaded on demand: the formatter is a devDependency, so every other verb
    // keeps working (and stays fast) when it is not installed.
    prettier = (await import("prettier")).default;
  } catch (err) {
    fail(`format needs the pinned prettier devDependency (run npm ci): ${err?.message ?? err}`);
  }
  const files = [];
  let unformatted = 0;
  let failed = 0;
  for (const path of paths) {
    try {
      const source = await readFile(path, "utf8");
      const options = (await prettier.resolveConfig(path)) ?? {};
      // prettier.check is the tool's own "is this already formatted" answer;
      // formatting only when it says no keeps a clean run byte-stable.
      const already = await prettier.check(source, { ...options, filepath: path });
      if (already) {
        files.push({ path, status: "unchanged" });
      } else if (check) {
        unformatted += 1;
        files.push({ path, status: "unformatted" });
      } else {
        await writeFile(path, await prettier.format(source, { ...options, filepath: path }));
        files.push({ path, status: "formatted" });
      }
    } catch (err) {
      failed += 1;
      files.push({ path, status: "error", error: String(err?.message ?? err) });
    }
  }
  // Exit non-zero on a check hit or a real error, so the verb is gateable.
  const ok = failed === 0 && unformatted === 0;
  out({ ok, command: "format", check, files, unformatted, failed });
  if (!ok) process.exitCode = 1;
}

// check [rig.json|auto|.]: audit a rig file against the research gaps. With a
// path, audit that file; with `auto`/`.` OR no path at all (#491 C8), search
// cwd and parents for rig.json and audit what was found. Non-interactive like
// every other command (D21): the JSON contract on a pipe, the readable report
// on a terminal. Exit code follows a linter's convention - nonzero when the rig
// has `error` findings - so a script can gate on it; `ok` stays true because
// the audit itself ran.
//
// It reads BOTH sides deliberately. The rig file is what the operator intends
// and the store is what the seats actually run; the constitution defect existed
// precisely because those two disagreed while every command reported ok.
async function cmdCheck(rigFile, human, rest = []) {
  // #491 C8: a path is a decision; NO path (or auto/. for the explicit form) is
  // an intent to audit "the rig I am standing in", so search cwd and parents
  // for rig.json. The discovery is provenance-marked with discovered: true, and
  // a script can stop the search with --discovered:false.
  let discovered = false;
  const skip = rest.includes("--discovered:false");
  if (!rigFile && skip) fail("check needs <rig.json> (auto-discovery is disabled with --discovered:false)");
  if (!rigFile || rigFile === "auto" || rigFile === ".") {
    rigFile = findRigFileFrom(process.cwd());
    if (rigFile === null) {
      fail(
        "no rig.json found in this directory or its parents - create one first with `node cli.mjs up rig.starter.json` (the starter is the hardened scaffold) or print help with `node cli.mjs help`",
      );
    }
    discovered = true;
  }
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
  // The queue, for the verification-evidence rule (ROADMAP 48): a completed
  // `VERIFY #N` item with no recorded evidence is an ack, not a re-run. Null
  // until read, so "could not read" stays distinguishable from "read and empty".
  let queueItems = null;
  // #5049 (ROADMAP 208): the per-seat context measure, for the `context-over-window` rule. Null means
  // "not read", which SKIPS the rule with its reason rather than passing it — and it is read through the
  // SAME producer `status.context` uses (`seatContextMap`), so the rule can never score a number the
  // operator was never shown.
  let contextBySeat = null;
  if (!DB_EXISTED_AT_START) {
    stored = { reason: "absent" };
    // The report says `store: "absent"` and skips the store-backed rules; a reader who is not looking at
    // that field sees a clean rig. Say it on stderr, the same sentence the read verbs use (#4955).
    console.error(
      `note: no store at ${DB_PATH} - reading does not create one. If you meant a different rig, set DURIG_DB or create durig.config.json - run: node cli.mjs config`,
    );
  } else {
    try {
      const constitution = await readData(
        DB_PATH,
        "document",
        { kind: Constitution.definition.kind, scope: { kind: "session" } },
        async (storage) => {
          const rec = await storage.findDocument(
            { kind: Constitution.definition.kind, scope: { kind: "session" } },
            "current",
            BACKGROUND_CONTEXT,
          );
          const value = rec ? (await storage.document(rec.id, "current", BACKGROUND_CONTEXT))?.value : null;
          return { found: Boolean(rec), value };
        },
      );
      stored = { reason: "read", text: constitution.value?.text ?? "" };
      storedSeats = (await readData(DB_PATH, "seats", {}, (s) => readSeatList(s))).map((s) => s.name);
      queueItems = await readData(DB_PATH, "queue", {}, (s) => readQueueItems(s));
      // Its OWN try/catch: a context read that fails must skip one rule, not turn the whole audit into
      // "store unreadable" (which would silently skip every store-backed rule, #3539's blind-pass shape).
      // The page read is bounded by SCAN_LIMIT (24 entries/seat), the same bound `status` reads with.
      try {
        contextBySeat = await readData(DB_PATH, "context", {}, async (storage) => {
          const roster = await readSeatList(storage);
          const pages = await readSeatPages(storage, BACKGROUND_CONTEXT, roster);
          return seatContextMap({ pages, seats: roster, cfg: CFG, modelsBySeat });
        });
      } catch (err) {
        contextBySeat = null;
        console.error(`check: the context read failed, so context-over-window is skipped: ${String(err?.message ?? err)}`);
      }
    } catch (err) {
      stored = { reason: "unreadable", error: String(err?.message ?? err) };
      if (err?.code === NO_STORE_CAUSE) {
        // `check` still audits the rig SPEC it was handed, so a missing store is a recorded skip rather than a
        // stop — but it says so on stderr, or the report reads like a clean rig nobody ever looked at.
        console.error(
          `note: no store at ${err.db} - reading does not create one. If you meant a different rig, set DURIG_DB or create durig.config.json - run: node cli.mjs config`,
        );
      }
    }
  }
  const { auditRig, formatCheck } = await loadCheckup();
  // The shared tree's branch (2026-10-19, devtools #2412): a seat whose cwd fell back to the shared
  // tree can switch it onto an item branch, which breaks the landing basis. null (no git / not a
  // repo) leaves the rule SKIPPED with its reason rather than silently passing.
  const sharedTreeBranch = readSharedTreeBranch({ root: process.cwd() });
  // A linked worktree (a landing scratch or a seat/item worktree) is NOT the shared tree, so the
  // `shared-tree-on-main` rule is skipped there: scripts/land.mjs runs the suite in a DETACHED
  // scratch worktree, where the branch reads as "" and the rule otherwise refused every landing
  // (#2679). The reader is null when git/the repo is unavailable -> the rule is skipped, not passed.
  const sharedTreeLinked = isLinkedWorktree({ root: process.cwd() });
  // The recent commit messages (#4349): a BOM in a subject/body is invisible in every normal view,
  // so it is read here and judged by the `commit-message-encoding` rule. null (no git / not a repo)
  // leaves the rule SKIPPED with its reason rather than silently passing.
  const commitMessages = readCommitMessages({ root: process.cwd(), limit: 50 });
  // #4371: the text-integrity signal over the files that DIFFER from HEAD — the ones a seat just
  // wrote, which is where the 04:21Z flattening appeared. null (no git / not a repo) leaves the rule
  // SKIPPED with its reason rather than silently passing.
  const changedPaths = trackedChangedPaths({ root: process.cwd() });
  const textIntegrity = changedPaths === null ? null : readTextIntegrity({ root: process.cwd(), paths: changedPaths });
  // ROADMAP 190: does every commit the queue cites resolve HERE? One `git cat-file --batch-check`
  // for all of them (a spawn per sha would stall `check`), and null when git/the repo is
  // unavailable, so the rule is SKIPPED with its reason rather than silently passing.
  const citations = readCitations({ root: process.cwd(), queueItems });
  // #6155: the counts the docs state about sets the code declares. Bounded read (docs/*.md only,
  // claims only - not the file bodies), and null when docs/ cannot be read, which the rule reports
  // as UNKNOWN rather than as a pass.
  const docCounts = readDocCountClaims({ root: process.cwd() });
  const result = auditRig({
    rig: rigFile,
    spec,
    specConstitution,
    stored,
    storedSeats,
    modelsBySeat,
    queueItems,
    commitMessages,
    textIntegrity,
    citations,
    sharedTreeBranch,
    sharedTreeLinked,
    contextBySeat,
    docCounts,
  });
  const seatCount = (spec.seats ?? []).length;
  if (human) {
    console.log(
      formatCheck(result, {
        rigDisplay: rigFile,
        color: true,
        seats: seatCount,
        storeReason: stored.reason,
        discovered,
      }),
    );
    // #491 C8: a human must be able to tell a discovered audit from a named
    // one; a pipe gets the fact as a JSON field instead.
    if (discovered) {
      console.error(`note: audited the discovered rig file ${rigFile} (no path was given)`);
    }
  } else {
    out({
      ok: true,
      command: "check",
      rig: rigFile,
      db: DB_PATH,
      store: stored.reason,
      seats: seatCount,
      discovered,
      ...result,
    });
  }
  // Set the code rather than exiting: a piped JSON payload may still be
  // draining, and process.exit would truncate it mid-write.
  process.exitCode = result.exitCode;
}

const USAGE = `
usages:
  node cli.mjs init              scaffold a minimal working rig (rig.json from the hardened starter) + durig.config.json in this directory
  node cli.mjs up <rig.json> [--refresh] [--dry-run] [--serve|--no-serve]   create seats; --dry-run prints the diff and writes nothing; on a TTY also start the broker (--no-serve disables)
  node cli.mjs ps              list seats
  node cli.mjs send <seat> <text> [--stream]   steer a seat and wait for its reply
  node cli.mjs send <seat> --body-file <path>  the same, prompt from a file (- = stdin)
  node cli.mjs send <seat> <text> --no-stream   the same, without the live view
  node cli.mjs queue           dump the work queue (22 MB on a loaded rig — see the row-scoped form below)
  node cli.mjs queue --json    accepted NO-OP: the document is already JSON, so the bytes do not change (#5063)
  node cli.mjs queue --id <id> [--id <id>…]   ONE (or a few) queue rows, body included, nothing else printed
  node cli.mjs queue --status <state> [--to <seat>…]  filter the printed rows; the counts/attention stay the whole store's (#5016)
  node cli.mjs queue --no-body               VIEWER form: bodies omitted, loudly headed, notices still derived over full rows (#5016)
  node cli.mjs queue --held --with-gates     bounded park census (#5770): per row id/from/to/status/stage/blockedBy/reason/resolver/reviewBy, NO bodies, capped at 200 rows, and it reports how many held rows have no recorded gate
  node cli.mjs show <id>       the same row-scoped read, as a verb
  node cli.mjs resume          (alias: doctor) advance admitted-but-not-progressing submissions
  node cli.mjs reset <seat> [handoff] [--dry-run]   (alias: clean) break a seat out of a degenerate context (writes a reset boundary); --dry-run previews it and writes nothing
  node cli.mjs compact <seat> [instructions]   summarize a seat's older context into a summary entry (keeps the transcript)
  node cli.mjs run [--watch] [--max-duration <seconds>]   drive to quiescence; --watch resident; --max-duration bounds it
  node cli.mjs serve [--max-duration <seconds>] [--stop]   the resident broker: wake seats from the store's change stream; --stop halts it
  node cli.mjs stop <seat> [reason]      emergency-stop: halts a seat's in-flight run across processes
  node cli.mjs log <seat> [limit] [--follow] [--full] [--tool-bg] [--theme dark|light]
                          a seat's conversation (--follow = live, --full = whole tool output)
  node cli.mjs watch [--once] [--json|--human]   follow rig state (human on a terminal)
  node cli.mjs events [--since <seq>] [--follow]   durable read-only event feed (resumes from <seq>)
  node cli.mjs status           per-seat health + attention notices
  node cli.mjs metrics [rig.json] [--window N|all]   drift measures, with bands and blind spots
  node cli.mjs check [rig.json] [--human]   audit a rig against the research gaps;
                            no path or auto/. = search cwd and parents for rig.json
  node cli.mjs optimize <text>  rewrite a draft instruction via the optimizer
  node cli.mjs config          show effective settings and their source
  node cli.mjs worktree <path> [--source <dir>]   isolate a work item in its own checkout
  node cli.mjs format [--check] [-- <paths>]   format explicit files with the pinned prettier (--check = gate, no write)
`;

const [, , cmd, ...rawRest] = process.argv;
// `--local` was already read above; drop it so a verb's positional parsing never sees a flag
// it does not know.
const rest = rawRest.filter((a) => a !== "--local");

// Verbs that MUTATE the store or the working tree. Read verbs are deliberately absent: a
// seat must be able to DIAGNOSE a stuck merge, not be locked out of its own rig.
const WRITE_VERBS = new Set([
  "up", "init", "send", "run", "serve", "stop", "reset", "clean", "compact",
  "resume", "doctor", "format", "worktree",
]);

try {
  // Landing safety (lead #1164 Q2), checked FIRST — before any storage or provider work: a
  // write verb must not act on a working tree that is mid-merge. The guard comes from a
  // dependency-free module so it cannot be disabled by the very fault it exists to catch.
  // Only MUTATIONS are refused: a `--dry-run` writes nothing, and `serve --stop` is a
  // control action the operator must keep even mid-merge (a stuck merge is exactly when
  // the broker most needs stopping).
  const stoppingBroker = cmd === "serve" && rest.includes("--stop");
  if (WRITE_VERBS.has(cmd) && !rest.includes("--dry-run") && !stoppingBroker) {
    const merge = mergeInProgress(process.cwd());
    if (merge) fail(mergeRefusal(cmd, merge));
  }
  if (cmd === "up") {
    // Auto-start the resident broker for an INTERACTIVE `up` (stdout is a TTY, like the
    // human views in D19), so a terminal `up` leaves the queue self-driving; piped or
    // scripted `up` never silently spawns a daemon. `--serve` forces it on, `--no-serve`
    // off, and DURIG_NO_SERVE=1 is the script-wide opt-out.
    const forced = rest.includes("--serve") ? true : rest.includes("--no-serve") ? false : undefined;
    const serve = forced ?? (process.stdout.isTTY === true && process.env.DURIG_NO_SERVE !== "1");
    await cmdUp(rest[0], rest.includes("--refresh"), { serve, dryRun: rest.includes("--dry-run") });
  }
  else if (cmd === "worktree") {
    if (rest[0] === "audit") await cmdWorktreeAudit();
    else if (rest[0] === "scratch" && rest[1] === "clean") await cmdWorktreeScratchClean();
    else if (rest[0] === "prune-branch") await cmdWorktreePruneBranch(rest[1]);
    else await cmdWorktree(rest);
  }
  else if (cmd === "init") await cmdInit();
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
  } else if (cmd === "queue") await cmdQueue(rest);
  else if (cmd === "show") {
    // The ergonomic form for an audit (#4986): `show 4986` or `show 4986 4977`, bodies included, and nothing
    // else printed. Same code path as `queue --id`, so the two views can never drift.
    if (!rest.length) fail("show needs <item-id>");
    await cmdQueue(rest.flatMap((id) => ["--id", id]));
  }
  else if (cmd === "resume" || cmd === "doctor") await cmdResume();
  else if (cmd === "run") await cmdRun({ watch: rest.includes("--watch"), maxDurationMs: parseMaxDuration(rest) });
  else if (cmd === "serve") await cmdServe({ maxDurationMs: parseMaxDuration(rest), stop: rest.includes("--stop") });
  else if (cmd === "stop") {
    if (!rest[0]) fail("stop needs <seat> [reason]");
    await cmdStop(rest[0], rest.slice(1).join(" "));
  }
  else if (cmd === "reset" || cmd === "clean") {
    if (!rest[0]) fail("reset needs <seat> [handoff]");
    // --dry-run is a flag, not part of the handoff text: filter it out so a
    // preview cannot smuggle the flag into the message the apply path writes.
    const dryRun = rest.includes("--dry-run");
    await cmdReset(rest[0], rest.slice(1).filter((a) => a !== "--dry-run").join(" "), { dryRun });
  }
  else if (cmd === "compact") {
    if (!rest[0]) fail("compact needs <seat> [instructions]");
    await cmdCompact(rest[0], rest.slice(1).join(" "));
  }
  else if (cmd === "watch") {
    // Same precedence as `send --stream`: an explicit flag wins, otherwise a
    // terminal gets the readable view and a pipe keeps the JSON contract.
    const human = rest.includes("--human") || (Boolean(process.stdout.isTTY) && !rest.includes("--json"));
    await cmdWatch(rest.includes("--once"), human);
  } else if (cmd === "status") await cmdStatus(rest);
  else if (cmd === "pause" || cmd === "unpause") {
    // ROADMAP 131. `pause [--wait] [reason]`; `unpause` takes no reason.
    const paused = cmd === "pause";
    const reason = rest.filter((a) => !a.startsWith("--")).join(" ") || undefined;
    await cmdPause(paused, { wait: rest.includes("--wait"), reason: paused ? reason : undefined });
  }
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
    await cmdCheck(rest.find((a) => !a.startsWith("--")), human, rest);
  }
  else if (cmd === "optimize") await cmdOptimize(rest);
  else if (cmd === "config") await cmdConfig();
  else if (cmd === "format") {
    // `-- <paths>` is the explicit form; bare non-flag args before `--` are also
    // accepted as paths so `format --check src/x.mjs` works. Flags never become
    // paths, and there is no default path set.
    const sep = rest.indexOf("--");
    const before = sep >= 0 ? rest.slice(0, sep) : rest;
    const after = sep >= 0 ? rest.slice(sep + 1) : [];
    const paths = [...before.filter((a) => !a.startsWith("--")), ...after];
    await cmdFormat({ check: before.includes("--check"), paths });
  }
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

// #314: an interrupted verb reports the interruption in its EXIT CODE, whatever it managed to
// print before the signal. A shell or a seat can branch on 130 (128 + SIGINT); a verb that
// swallows Ctrl-C and returns 0 is indistinguishable from one that finished the work, and that
// is precisely how a wedged rig hides: the caller sees "success" and keeps waiting.
if (isStopping()) {
  console.error(
    JSON.stringify({ ok: false, command: cmd, interruptedBy: stopSignalName(), stoppedBy: "signal" }),
  );
  process.exit(130);
}

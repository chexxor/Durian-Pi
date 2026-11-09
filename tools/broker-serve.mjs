#!/usr/bin/env node
// tools/broker-serve.mjs — delegate instrument for the DELIVERY CHANNEL: preflight, start,
// status and stop for the resident broker, on whatever operating system this box runs.
//
// WHY THIS EXISTS (measured 2026-10-28, Linux): the only launcher in the repo is
// `scripts/serve-noroot.ps1` (PowerShell), and `scripts/` holds no POSIX equivalent — so on a
// Linux box the broker has never run, and two operator intents sat undelivered in the spool
// since 2026-10-27T05:04:46Z. The half that is missing is not cleverness: it is (a) the right
// env, (b) detach + log redirection, and (c) a preflight that says out loud what a broker start
// is about to make possible. A `--dry-run` that names no removals is not evidence there are
// none (docs/incidents/2026-10-26-worktree-and-scratch-sweep.md), and a "broker is down" report
// is not evidence the channel works either.
//
// WHAT IT IS NOT: it is not `src/host.mjs` (ROADMAP 63/64 — the supervisor half is the TEAM's,
// and nothing here supervises, restarts, or installs an OS service). This is delegate-only
// convenience under `tools/`, the same class as `tools/what-to-test.mjs`: it drives nothing,
// claims nothing, and repairs nothing. It never force-kills a process — a hard stop stays in
// docs/runbooks/broker-down-or-stalled.md, where the genlock precondition is written down.
//
// Writes: `--status`, `--dry-run`, and the preflight are read-only. `--start` spawns
// `node cli.mjs serve` (one store writer, single-writer rule) detached; `--stop` asks the
// broker to stop via `cli.mjs serve --stop` and does not consider it stopped until the pid is
// proven gone (brokerProcessAlive is the only proof — see src/broker.mjs #2420/#3398).
//
// Exit codes: 0 preflight clean / action done · 1 findings block a start, or the action failed
// · 2 usage error.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadShippedDefaults, looksLikeSecret } from "../src/config.mjs";
import { localProviderSpecs } from "../src/providers/local.mjs";
import {
	brokerHealth,
	brokerLogPath,
	brokerProcessAlive,
	brokerStatePath,
	intentErrorDir,
	intentInboxDir,
	pidAlive,
	readBrokerState,
	readIntentFiles,
} from "../src/broker.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "cli.mjs");
// (The shell-availability section used to hold `const IS_WINDOWS = process.platform === "win32"` to pick a
// `where` vs `sh -c` PATH probe. It is gone with the grep: the registry's `programOnPath` does the PATH scan
// host-generically, so the instrument no longer needs to know which OS family it is in to ask the question.
// #4977.)

// ---------------------------------------------------------------- usage

const USAGE = `node tools/broker-serve.mjs [--status] [--dry-run] [--start [--max-duration <s>]] [--stop]
                      [--db <path>] [--rig <file>] [--allow-dirty] [--allow-stale-cwd]

  --status         preflight report only (default). READ-ONLY.
  --dry-run        preflight + the exact command and env that --start would run. No writes.
  --no-probe       skip the one-call completion probe (it costs ~1s of prefill per provider).
  --start          spawn "node cli.mjs serve" detached, logs under .spike/, print the pid.
                   Refuses if any broker state is present; refuses unless --yes-pm-wakes is
                   passed when the spool holds operator intents (see the WOULD WAKE line).
  --stop           "node cli.mjs serve --stop", then PROVE the pid is gone. Never kills.
  --db / --rig     override the store / rig file; default = effective DURIG_DB config + rig.selfdev.json
  --allow-dirty    acknowledge the F23 hazard: tracked files modified in the live tree while
                   seats have no isolated cwd (a woken seat's cwd is this process's cwd, F12).
  --allow-stale-cwd  acknowledge seat cwd values that cannot resolve on this OS.
  --ack-coordinator-wake  acknowledge seat-shell-availability for a start whose ENTIRE first-pass
                   wake set is coordinators. NOT a waiver: the exception is measured per seat with
                   the product's own toolRemovalsFor (src/seattools.mjs:249) — a seat that loses its
                   shell also loses write/edit/read, so waking it runs no command and lands no
                   artifact, and the absent shell is irrelevant to it. If ANY seat in the wake set
                   keeps the shell tool, the block stands. Requires --max-duration on --start.`;

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const flags = { action: "status", maxDurationS: null, allowDirty: false, allowStaleCwd: false, yesPmWakes: false, ackCoordinatorWake: false };
let dbOverride = null;
let rigOverride = null;
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a === "--status") flags.action = "status";
	else if (a === "--dry-run") flags.action = "dry-run";
	else if (a === "--start") flags.action = "start";
	else if (a === "--stop") flags.action = "stop";
	else if (a === "--allow-dirty") flags.allowDirty = true;
	else if (a === "--allow-stale-cwd") flags.allowStaleCwd = true;
	else if (a === "--yes-pm-wakes") flags.yesPmWakes = true;
	else if (a === "--ack-coordinator-wake") flags.ackCoordinatorWake = true;
	else if (a === "--db") dbOverride = argv[++i];
	else if (a === "--no-probe") flags.noProbe = true;
	else if (a === "--rig") rigOverride = argv[++i];
	else if (a === "--max-duration") flags.maxDurationS = Number(argv[++i]);
	else if (a.startsWith("--max-duration=")) flags.maxDurationS = Number(a.split("=")[1]);
	else if (a === "--help" || a === "-h") { console.log(USAGE); process.exit(0); }
	else { console.error(`broker-serve: unknown argument ${a}\n\n${USAGE}`); process.exit(2); }
}
if (flags.maxDurationS !== null && !(flags.maxDurationS > 0)) {
	console.error(`broker-serve: --max-duration must be a positive number of seconds, got ${flags.maxDurationS}`);
	process.exit(2);
}
// The coordinator exception is only ever a BOUNDED act: it opens the channel on a host where most
// seats cannot run a command, so an unbounded broker is not an acceptable price for it.
if (flags.ackCoordinatorWake && flags.action === "start" && flags.maxDurationS === null) {
	console.error("broker-serve: --ack-coordinator-wake requires --max-duration <s> on --start (the wake must be bounded).");
	process.exit(2);
}

// ---------------------------------------------------------------- helpers

const blocking = []; // findings that make a start a bad idea until a human says otherwise
const notes = []; // everything else worth knowing, printed but not blocking
const findings = [];
function finding(id, severity, detail, fix) {
	findings.push({ id, severity, detail, fix });
	if (severity === "block") blocking.push(id);
	else notes.push(id);
}
function tail(file, n = 6) {
	try {
		return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-n);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------- config

const shipped = await loadShippedDefaults({ readFile: (p) => readFileSync(p, "utf8"), anchors: [join(REPO, "durig.config.default.json")] });
const cfgResult = await loadConfig({
	env: process.env,
	readFile: (p) => readFileSync(p, "utf8"),
	defaults: shipped.values,
	defaultsSource: shipped.source,
});
const CFG = cfgResult.config;
const DB = dbOverride ?? CFG.DURIG_DB ?? "./rig.sqlite";
const RIG = rigOverride ?? "rig.selfdev.json";

// ---------------------------------------------------------------- report

console.log(`BROKER PREFLIGHT — ${process.platform} (${process.release?.name} ${process.version}), cwd=${process.cwd()}`);
console.log(`  store: ${DB} (${existsSync(DB) ? "present" : "MISSING"})  config source: ${cfgResult.source ?? "env/defaults only"}  defaults: ${cfgResult.defaultsSource ?? "none"}`);
console.log(`  rig:   ${RIG} (${existsSync(RIG) ? "present" : "MISSING"})`);
if (!existsSync(DB)) finding("store-missing", "block", `${DB} does not exist — a broker would open an EMPTY store`, "pass --db <path>, or fix DURIG_DB (note: the CLI reads DURIG_*, not DURIAN_PI_* — D103)");

// The D103 trap, expressed as a live check rather than a warning in a doc: if the operator's
// shell carries a DURIAN_PI_* name the CLI does not read, every number downstream is about a
// different (empty) store.
const deadEnv = Object.keys(process.env).filter((k) => k.startsWith("DURIAN_PI_"));
if (deadEnv.length) finding("legacy-env-set", "note", `these are set but the CLI does not read them: ${deadEnv.join(", ")}`, "use the DURIG_* name for the same key (ROADMAP 191)");

// broker state
const state = readBrokerState(DB);
const health = brokerHealth(state, { streamTimeoutMs: CFG.DURIG_STREAM_TIMEOUT_MS ? Number(CFG.DURIG_STREAM_TIMEOUT_MS) : null });
console.log(`  broker: ${health.state}${health.pid ? ` pid=${health.pid}` : ""}${health.hbAgeMs != null ? ` heartbeat ${Math.round(health.hbAgeMs / 1000)}s ago` : ""}${health.passAgeMs != null ? ` last pass ${Math.round(health.passAgeMs / 1000)}s ago` : ""}${health.reason ? ` (${health.reason})` : ""}`);
if (health.state === "up") finding("broker-up", "block", "a broker is already driving this store — a second write-side driver is the corruption class", "`node cli.mjs serve --stop`, then re-run this preflight");
if (health.state === "degraded") finding("broker-degraded", "block", `broker pid ${health.pid} is alive but has not completed a pass in ${Math.round((health.passAgeMs ?? 0) / 1000)}s`, "docs/runbooks/broker-down-or-stalled.md — the alive-but-dormant shape; check genlock BEFORE any kill");
if (state && health.state === "down" && pidAlive(state.pid)) {
	finding("stale-state-live-pid", "block", `${brokerStatePath(DB)} names pid ${state.pid}, which the OS says exists, but its heartbeat is stale — a wedged broker, not a dead one`, "docs/runbooks/broker-down-or-stalled.md: check genlock, then a hard stop; this tool never kills");
}

// genlock slots (a held slot means a generation is in flight — do not kill). The state file is
// `${DB}.genlock.<n>`, so the glob is anchored on the DB basename, in the DB's own directory.
const genlocks = readdirSync(dirname(DB) || ".").filter((n) => n.startsWith(`${basename(DB)}.genlock`));
if (genlocks.length) finding("genlock-held", "note", `generation slot(s) held: ${genlocks.join(", ")}`, "a live slot means do NOT terminate the broker (runbook precondition)");

// the spool: this is the question the two stranded intents make you ask
const inbox = readIntentFiles(DB);
const dead = existsSync(intentErrorDir(DB)) ? readdirSync(intentErrorDir(DB)).filter((n) => n.endsWith(".json")) : [];
const pending = inbox.map((path) => {
	try {
		const j = JSON.parse(readFileSync(path, "utf8"));
		return { to: j.to ?? "?", op: j.op ?? "?", requestId: j.requestId ?? null, createdAt: j.createdAt ?? null, ageMin: j.createdAt ? Math.round((Date.now() - Date.parse(j.createdAt)) / 60000) : null };
	} catch (err) {
		return { to: "?", error: `unreadable: ${err.message}` };
	}
});
console.log(`  spool: ${pending.length} pending intent(s) in ${intentInboxDir(DB)}${dead.length ? `, ${dead.length} DEAD-LETTER(s) in ${intentErrorDir(DB)}` : ""}`);
for (const p of pending) console.log(`    -> ${p.to} [${p.op}] ${p.requestId ?? "(no requestId)"}${p.ageMin != null ? ` — waiting ${p.ageMin} min` : ""}${p.error ? ` ${p.error}` : ""}`);
for (const name of dead) console.log(`    DEAD-LETTER ${name} — the broker refused it; read it before assuming the intent was delivered`);
if (pending.some((p) => p.ageMin != null && p.ageMin > 60)) {
	finding("stranded-intent", "note", `${pending.filter((p) => p.ageMin > 60).length} intent(s) have waited over an hour — the delivery channel, not the backlog, is the critical path`, "start the broker, or use ROADMAP 205's broker-free path for audit-style intents");
}

// providers the seats will actually call
const specs = localProviderSpecs(CFG);
console.log(`  local providers configured: ${specs.length ? "" : "none"}\n${specs.map((s) => `    ${s.id} (${s.prefix}) -> ${s.baseUrl} model=${s.modelId} ctx=${s.contextWindow} out=${s.maxTokens}`).join("\n")}`);
for (const s of specs) {
	// #5047 (D-5015.3, P9): locality is the ENDPOINT's property, so this check asks what the URL is instead of
	// assuming that a provider named `local`/`verifier` is free. A loopback server with no key is a note (it
	// sends the loopback placeholder and works); a NON-loopback one with no key or no declared price is a block,
	// because src/providers/local.mjs now refuses to register its model row and every seat naming it dies
	// `no_model` before any request — which is the point, but the operator must be told WHERE.
	const metered = s.endpoint === "metered";
	if (!process.env[s.apiKeyEnv])
		finding(
			`provider-${s.id}-no-key`,
			metered ? "block" : "note",
			metered
				? `${s.apiKeyEnv} is unset and ${s.baseUrl} is a METERED endpoint — src/providers/local.mjs will not send a placeholder credential there`
				: `${s.apiKeyEnv} is unset; the loopback provider will send the loopback placeholder`,
			metered
				? `set ${s.apiKeyEnv}, or point ${s.prefix}BASE_URL at the local server it is meant to name (docs/runbooks/local-provider-down.md)`
				: "only a problem if that server actually requires a credential",
		);
	if (metered && !s.price)
		finding(
			`provider-${s.id}-unpriced`,
			"block",
			`${s.baseUrl} is a metered endpoint with NO declared price — its model row would be a $0 lie (P2), so it is not registered and a seat naming ${s.id}/${s.modelId} fails as no_model`,
			`declare ${s.prefix}PRICE_USD_IN/${s.prefix}PRICE_USD_OUT (0 = free by declaration) or set ${s.prefix}PRICE_JSON / DURIG_PRICE_JSON to a dated catalog snapshot`,
		);
	if (metered && s.price)
		finding(
			`provider-${s.id}-priced-metered`,
			"note",
			`${s.id}/${s.modelId} is a metered endpoint priced at $${s.price.in}/$${s.price.out} per Mtok (priceSource=${s.priceSource}, asOf=${s.priceAsOf ?? "UNDATED"}) — it is metered by the spend cap like any paid call`,
			"an undated price is an undated claim: stamp it or re-fetch (D-5015 F8)",
		);
	let ids = null;
	let err = null;
	// #5111: what the SERVER said is kept separate from whether it answered at all. `HTTP 401` is an answer; it is
	// not unreachability. Reported as `provider-...-unreachable` it made the preflight block on a wrong fact —
	// measured on this host in a run that ALSO printed `local: completes (finish=stop, prompt=57 tok)`.
	let httpStatus = null;
	let listingIssue = null; // deferred until the completion probe can say whether inference works
	try {
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), 5000);
		// The SAME credential read the completion probe below uses — one vocabulary, never logged. A probe that asks
		// an authenticated endpoint a question without the credential it will later send is not a probe.
		const res = await fetch(`${String(s.baseUrl).replace(/\/$/, "")}/models`, {
			signal: ctrl.signal,
			...(process.env[s.apiKeyEnv] ? { headers: { authorization: `Bearer ${process.env[s.apiKeyEnv]}` } } : {}),
		});
		clearTimeout(t);
		const body = await res.json().catch(() => null);
		ids = (body?.data ?? []).map((m) => m.id);
		if (!res.ok) {
			httpStatus = res.status;
			err = `HTTP ${res.status}`;
		}
	} catch (e) {
		err = e?.name === "AbortError" ? "timeout after 5s" : String(e?.cause?.code ?? e?.message ?? e);
	}
	const named = (s.prefix ?? "LOCAL").toUpperCase();
	if (err && httpStatus === null) {
		// Only a NON-ANSWER is unreachability: connection refused, DNS failure, timeout.
		finding(
			`provider-${s.prefix ?? "?"}-unreachable`,
			"block",
			`${s.baseUrl} did not answer /v1/models: ${err}`,
			"docs/runbooks/local-provider-down.md — a seat pointed at it fails with 'Connection error.', not a rig bug",
		);
	} else if (httpStatus === 401 || httpStatus === 403 || httpStatus === 404) {
		listingIssue = httpStatus; // named after the completion probe runs, so the pair cannot contradict each other
	} else if (httpStatus) {
		finding(
			`provider-${s.prefix ?? "?"}-models-http-${httpStatus}`,
			"block",
			`${s.baseUrl} ANSWERED /v1/models with HTTP ${httpStatus} — the endpoint is REACHABLE and the listing failed`,
			"read the server's own response before concluding anything about the provider",
		);
	} else if (ids && !ids.includes(s.modelId))
		finding(`provider-${s.prefix ?? "?"}-model-absent`, "block", `${s.baseUrl} advertises [${ids.join(", ")}] but the config names '${s.modelId}'`, "point DURIG_" + `${named}_MODEL at an advertised id, or load that model`);
	else console.log(`    ${s.id}: answers, advertises ${ids?.length ?? "?"} model(s) including ${s.modelId}`);
	// A 2026-10-28 addition, from a near-miss: `/v1/models` answering is NOT proof a seat turn will
	// work. The store holds **18,309 entries** whose text contains "402" — "You need positive balance to
	// do inference" — i.e. a provider that advertises models and then refuses inference, which reaches a
	// seat as `model_error` on every generation. So probe one real completion. Cost measured here: 55
	// prompt tokens, ~1.1 s prefill, one call.
	// #5111: declared OUT here so that `--no-probe` — the fast preflight the runbooks name — still reaches the
	// listing verdict below. An early draft of this fix sat that verdict inside the probe block, and `--no-probe`
	// then reported NOTHING about a 401, which is strictly worse than the defect being fixed.
	let cErr = null;
	let status = 0;
	let body = null;
	if (!flags.noProbe) {
		try {
			const ctrl = new AbortController();
			const t = setTimeout(() => ctrl.abort(), 20000);
			const res = await fetch(`${String(s.baseUrl).replace(/\/$/, "")}/chat/completions`, {
				method: "POST",
				signal: ctrl.signal,
				headers: { "content-type": "application/json", ...(process.env[s.apiKeyEnv] ? { authorization: `Bearer ${process.env[s.apiKeyEnv]}` } : {}) },
				body: JSON.stringify({ model: s.modelId, messages: [{ role: "user", content: "Reply with exactly: ok" }], max_tokens: 64, stream: false }),
			});
			clearTimeout(t);
			status = res.status;
			body = await res.json().catch(() => null);
			if (!res.ok) cErr = `HTTP ${res.status}: ${String(body?.error?.message ?? body?.message ?? "").slice(0, 160)}`;
		} catch (e) {
			cErr = e?.name === "AbortError" ? "timeout after 20s" : String(e?.cause?.code ?? e?.message ?? e);
		}
		const choice = body?.choices?.[0];
		const u = body?.usage;
		const tm = body?.timings;
		if (cErr && (status === 401 || status === 402 || status === 429))
			finding(`provider-${s.id}-refuses-inference`, "block", `${s.id} answers /v1/models but refused a 1-token completion — ${cErr}. A seat turn would die as model_error on every generation; the store shows this shape 18,309 times (402 "You need positive balance to do inference")`, "fund/restart the server, or point DURIG_" + `${(s.prefix ?? "LOCAL").toUpperCase()}_* at a provider that answers completions; do not start the broker on a provider that only lists models`);
		else if (cErr) finding(`provider-${s.id}-completion-failed`, "block", `${s.id}: /chat/completions failed — ${cErr}`, "a seat generation will fail the same way; fix the provider before waking seats");
		else
			// No tok/s here on purpose: at 57 prompt tokens the number is a cache-wake artifact, and D147
			// is exactly the story of quoting prefill from a small probe. This is health, not benchmark.
			console.log(`    ${s.id}: completes (finish=${choice?.finish_reason ?? "?"}, prompt=${u?.prompt_tokens ?? "?"} tok, completion=${u?.completion_tokens ?? "?"} tok)`);
		if (!cErr && choice && choice.message?.content == null)
			finding(`provider-${s.id}-reasoning-only`, "note", `the completion returned content=null with reasoning_content and finish_reason=${choice.finish_reason} — a reasoning server that spends the token budget thinking`, "expected on our servers (D147); a seat's max_tokens must exceed the thinking budget, so a short budget reads like an empty answer");
	}
	// #5111, the half that makes the classification true rather than merely renamed: the listing answer is judged
	// WITH the completion answer in hand, because a server can refuse a listing and still serve inference. A probe
	// that blocks on the first while the second proves the opposite is a preflight that lies in the safe-looking
	// direction — and every arming decision this run made was made against that preflight.
	if (listingIssue) {
		const completion = body?.choices?.[0];
		const answers = !cErr && completion;
		const unauthorized = listingIssue === 401 || listingIssue === 403;
		const served = answers
			? `and /chat/completions COMPLETES (finish=${completion.finish_reason}, prompt=${body?.usage?.prompt_tokens ?? "?"} tok) — inference WORKS, so this is a listing-scope answer, not an outage and not an unreachable provider`
			: status
				? `and /chat/completions also refused (${cErr})`
				: "and no completion probe was run (--no-probe), so inference is unproven either way — a listing-scope answer either way, NOT an unreachable provider";
		finding(
			// The id KEEPS the `DURIG_LOCAL_` shape of the finding it replaces: a seat that has been reading
			// `provider-DURIG_LOCAL_-unreachable` all week must see the corrected name in the same slot, not a new
			// one it has to learn.
			unauthorized ? `provider-${s.prefix ?? named}-unauthorized` : `provider-${s.prefix ?? named}-models-not-found`,
			unauthorized && !answers ? "block" : "note",
			`${s.baseUrl} ANSWERED /v1/models with HTTP ${listingIssue} — REACHABLE: the endpoint answered, ${served}. The listing ${unauthorized ? "refused the credential" : "path does not exist (a wrong path, or a server that does not implement /models)"}`,
			unauthorized
				? `export ${s.apiKeyEnv} — the variable the provider code itself reads (keep its value in the out-of-tree env file, mode 600). A 401/403 is an ANSWER and must never be reported as unreachable`
				: `check the path: DURIG_${named}_BASE_URL should end at the /v1 root, not at a model or a version segment`,
		);
	}
}

// rig seats: the cross-family invariant and stale cwds from another OS
let rig = null;
try {
	rig = JSON.parse(readFileSync(RIG, "utf8"));
} catch (err) {
	if (existsSync(RIG)) finding("rig-unreadable", "note", `${RIG}: ${err.message}`, "fix");
}
if (rig) {
	const models = new Map();
	const staleCwd = [];
	for (const seat of rig.seats ?? []) {
		models.set(seat.model, [...(models.get(seat.model) ?? []), seat.name]);
		// A persisted seat cwd that does not resolve is the workspace-move defect: seats wake in
		// whatever the store says, and an unreachable one fails or writes somewhere unexpected.
		if (seat.cwd && !existsSync(seat.cwd)) staleCwd.push(`${seat.name}: ${seat.cwd}`);
	}
	console.log(`  seats: ${(rig.seats ?? []).length} across ${models.size} model(s)`);
	for (const [m, names] of models) console.log(`    ${m} — ${names.join(", ")}`);
	if (models.size === 1) finding("single-model-rig", "note", `all ${(rig.seats ?? []).length} seats resolve to one model (${[...models.keys()][0]}), so the author/verifier cross-family invariant cannot hold`, "docs/SELFDEV.md §the author/verifier split — a model change is an operator action; DURIG_VERIFIER_* is already configured on this box");
	if (staleCwd.length) finding("stale-seat-cwd", "block", `seat cwd(s) do not resolve on ${process.platform}: ${staleCwd.join(" | ")} — they live in the RIG FILE, so "up --refresh" re-asserts them rather than fixing them (measured 2026-10-28: up --dry-run reports changes:{} for every seat while devtools still names a Windows path)`, `docs/runbooks/workspace-move.md: fix or delete the cwd in ${RIG} first, then "up ${RIG} --refresh"`);
}

// 2026-10-28, from a real near-miss: this preflight reads the RIG FILE, but at wake a seat resolves
// `seat.cwd ?? spec.cwd ?? DURIG_SEAT_ROOT` and falls back to the **persisted** `pi.agent.cwd`
// (cli.mjs:679), which `up` writes only when the rig file NAMES a cwd (cli.mjs:815: `if (seatCwd !==
// undefined && agent.cwd !== seatCwd)`). So deleting a cwd does not clear what the store carries. It
// did not: after removing devtools' cwd and running `up --refresh`, pm's own `seat_root` tool result
// returned `SEAT ROOT: <repo>/C:\Users\Alex\dsh-Projects\pi-opendurig — source: persisted seat cwd`,
// and seats had created that path INSIDE the repo (two shapes: nested `C:/Users/...` and one flat
// directory named `C:\Users\...`) and written `.durig/queue-{lead,qa,qa2,auditor}.md` into it.
// Nothing in the CLI prints a persisted cwd (`ps` and `status` both omit it) — ROADMAP 221.
try {
	const junk = readdirSync(REPO).filter((n) => /^[A-Za-z]:/.test(n) || n.includes("\\") || n.includes("dsh-Projects"));
	if (junk.length) finding("phantom-seat-root-path", "block", `${junk.length} repo-root director${junk.length === 1 ? "y" : "ies"} named for another OS's absolute path exist${junk.length === 1 ? "s" : ""} — ${JSON.stringify(junk.slice(0, 3))}. A seat wrote into them this run; this is the persisted-cwd fault made visible, and it means a woken seat is working OUTSIDE its intended tree`, "move the path out of the repo (preserve it as evidence), then clear/re-point the persisted seat cwd before restarting — the rig file alone will not do it (cli.mjs:815 writes the persisted cwd only when the file names one)");
} catch (err) {
	finding("phantom-seat-root-scan-failed", "note", `could not scan the repo root: ${err.message}`, "non-fatal; the persisted-cwd gap is ROADMAP 221");
}
finding("persisted-cwd-unreadable", "note", "this check validates the RIG FILE only: no CLI command prints a seat's persisted cwd (`ps` and `status` omit it), so a cleared rig-file field is NOT evidence the seat root is right. Read a seat's own `seat_root` tool result in `log <seat>` after a pass, or use `cli.mjs send <seat> seat_root`", "ROADMAP 221 asks for the missing read surface and for `up` to clear a cwd the rig file stops naming");

// ROADMAP 217 asked for this block BY NAME: "today it refuses on a dead seat cwd and a dirty tree but would
// happily start a broker whose seats cannot run a single command." The verdict now comes from
// `tools/shell-availability.mjs`, which asks the PRODUCT registry (`src/shellregistry.mjs`) — the same
// registry `src/seattools.mjs` registers the seat shell from.
//
// WHAT WAS WRONG HERE (#4977, re-measured on Linux at 43e26dcc before this change): the section grepped
// `vendor/pi-main/packages/durable/src/tools/bash.ts` for `programs ?? [...]`, took the first match — which
// is `createPowerShellTool`'s default at bash.ts:169, ONE factory's fallback, not the registered tool's
// list — PATH-probed those programs, and printed
//   BLOCK seat-shell-availability: the seat shell tool is registered as "bash" and spawns [pwsh, powershell],
//   NONE of which exists on linux
// That sentence contradicts itself and has been FALSE ever since 217 landed: the registered tool IS `bash`
// and the registry reports `degraded: false` on this box. It gated a broker restart on a grep of vendored
// text, which is the class of fault the two conventions name — a cheap signal may ACCEPT but never DECIDE,
// and an instrument may READ vendor/pi-main but must not GATE on its text, because that text moves under
// the upstream pin. The block also told the operator to land 217, which is already landed.
//
// The evidence that made 217 REAL is historical and stays on the record: on 2026-10-28 the registered shell
// WAS `powershell` here and the store shows 3 `spawn powershell ENOENT` + 1 `spawn pwsh ENOENT`, newest
// #274074 (conv 4930 = devtools) at 2026-10-28T17:09:07Z. A seat that cannot run
// `node demo/<name>.test.mjs` still cannot satisfy the completion rule or the constitution's oracle, and
// the BLOCK still fires for a host where that is true — `demo/broker-serve-shell-availability.test.mjs`
// asserts the refusal direction on an injected host, so the CONTROL does not depend on this box.
try {
	const { seatTools, toolRemovalsFor } = await import("../src/seattools.mjs");
	const { seatShellVerdict } = await import("./shell-availability.mjs");
	// D169 named the closed loop: 217 needs a woken seat, and the block refuses the wake *because* 217
	// has not landed. The operator can rule on that, and the instrument has to be able to RECORD the
	// ruling rather than only refuse it — but the exception is MEASURED, never asserted from a seat's
	// name. toolRemovalsFor (src/seattools.mjs, COORDINATOR_REMOVALS) removes read/write/edit/shell/
	// prepare_workspace from any seat declaring no WORKING_CAPABILITY, so for exactly those seats the
	// absent shell guards an act that runs no command and lands no artifact. Admissible only when EVERY
	// seat in the predicted first-pass wake set is a coordinator by that predicate — so the caller answers
	// "does this seat keep the shell tool" and the verdict module only rules on it.
	// The spool carries more than intents: a `cli.mjs status` while a broker runs leaves an
	// {"op":"read","view":"health",...} request, and readIntentFiles maps a missing `to` to the literal "?".
	// Reading every spool file as an intent therefore invented a wake-set member "?(absent from
	// rig.selfdev.json)" and made a measurable exception look inadmissible. An intent is a file with a
	// real recipient and no `op` (a read request carries `op:"read"`).
	const wakeSet = [
		...new Map(
			pending
				.filter((p) => p.to !== "?" && p.op === "?")
				.map((p) => p.to)
				.map((name) => {
					const seat = (rig?.seats ?? []).find((s) => s.name === name);
					// A seat absent from the rig file is NOT evidence it can skip a shell — unknown stays load-bearing.
					return [name, { name, known: seat !== undefined, keepsShell: seat ? !toolRemovalsFor(seat).includes(seatTools.shell) : true }];
				}),
		).values(),
	];
	const verdict = seatShellVerdict({ rigPath: RIG, wakeSet, ackCoordinatorWake: flags.ackCoordinatorWake, maxDurationS: flags.maxDurationS });
	finding(verdict.id, verdict.severity, verdict.detail, verdict.fix);
} catch (err) {
	finding("seat-shell-probe-failed", "note", `could not resolve the seat shell: ${err.message}`, "non-fatal for this preflight, load-bearing for the start: run tools/channel-preflight.mjs §7");
}

// F23: seats resolve to the cwd of the write-side command that wakes them (F12). With no
// isolated seat cwd on this box, a woken seat edits THIS tree — which may hold the operator's
// uncommitted work.
const git = spawnSync("git", ["status", "--porcelain", "--", "."], { cwd: REPO, encoding: "utf8" });
const dirty = (git.stdout ?? "").split("\n").filter(Boolean);
const dirtyTracked = dirty.filter((l) => !l.startsWith("??"));
const dirtyUntracked = dirty.filter((l) => l.startsWith("??"));
console.log(`  live tree: ${dirtyTracked.length} tracked change(s), ${dirtyUntracked.length} untracked entr(s)`);
for (const l of dirtyTracked) console.log(`    ${l}`);
if (dirtyTracked.length && !flags.allowDirty) {
	finding("live-tree-dirty", "block", `${dirtyTracked.length} tracked file(s) are modified here, and a seat woken from this cwd edits this tree (F12/F23) — its work is invisible to an isolated worktree and can clobber them`, "isolate seats first (per-item worktree), or pass --allow-dirty once you have decided the risk is acceptable");
}

// the consequence the preflight exists to name: who wakes on the first pass
if (pending.length) {
	const seats = [...new Set(pending.map((p) => p.to))];
	console.log(`  WOULD WAKE on the first pass: ${seats.join(", ")} — and routing decisions they take can wake other seats`);
	if (flags.action === "start" && !flags.yesPmWakes) {
		finding("wake-not-acknowledged", "block", `a start delivers ${pending.length} intent(s) to ${seats.join(", ")}; that is not a read-only act`, "pass --yes-pm-wakes once the operator has agreed those intents should now run");
	}
}

// logs
for (const f of [brokerLogPath(DB), join(REPO, ".spike", "serve.out"), join(REPO, ".spike", "serve.err")]) {
	const t = tail(f, 4);
	if (t) console.log(`  ${f} (tail):\n    ${t.join("\n    ")}`);
}

const cmd = [process.execPath, CLI, "serve"];
if (flags.maxDurationS) cmd.push("--max-duration", String(flags.maxDurationS));
/**
 * PRESENCE, never the value (#5700 / ROADMAP 295, operator ruling: fix the print, do not
 * rotate a credential). This print used to spread every `DURIG_LOCAL_*` / `DURIG_VERIFIER_*`
 * variable straight into `JSON.stringify`, so a credential's VALUE landed in a preflight report
 * that an operator pastes into chat, an item body, or a transcript — the same class of leak that
 * #700 closed for config FILES (`src/config.mjs` refuses secret-shaped values there) and that
 * `tools/verifier-arm-probe.mjs` refuses for its own output. The product already has the right
 * shape at `src/config.mjs:558` (`DEEPINFRA_API_KEY: "set" | "unset"`); this site was the one
 * print that did not use it.
 *
 * Non-credential config keeps its VALUE: a preflight that reports nothing is not a preflight. A
 * credential reports set/unset plus length and source, which is enough for an operator to tell
 * whether the thing is configured without owning a copy of it.
 */
function envPresence(key, value) {
	if (value === undefined || value === "") return "unset";
	if (looksLikeSecret(value) || /(API_KEY|TOKEN|SECRET|PAT|AUTH)/i.test(key)) {
		return `set (${String(value).length} chars, from env)`;
	}
	return value;
}

const envNotes = {
	DURIG_DB: CFG.DURIG_DB ?? "(default ./rig.sqlite)",
	DURIG_SEAT_ROOT: process.env.DURIG_SEAT_ROOT ?? "(unset — correct: a global root trips the F12 guard)",
	...Object.fromEntries(
		Object.entries(process.env)
			.filter(([k]) => /^DURIG_(LOCAL|VERIFIER)_/.test(k))
			.map(([k, v]) => [k, envPresence(k, v)]),
		),
};
console.log(`\n  command: ${cmd.join(" ")}   (stdout -> .spike/serve.out, stderr -> .spike/serve.err)`);
console.log(`  env: ${JSON.stringify(envNotes)}`);

if (findings.length) {
	console.log(`\n  findings (${blocking.length} blocking, ${notes.length} noted):`);
	for (const f of findings) console.log(`    ${f.severity.toUpperCase().padEnd(6)} ${f.id}: ${f.detail}\n           fix: ${f.fix ?? "-"}`);
} else {
	console.log(`\n  findings: none`);
}

// ---------------------------------------------------------------- actions

if (flags.action === "stop") {
	const before = readBrokerState(DB);
	if (!before) { console.log(`\nSTOP: no broker state — nothing to stop`); process.exit(0); }
	const r = spawnSync(process.execPath, [CLI, "serve", "--stop"], { cwd: REPO, encoding: "utf8" });
	console.log(`\nSTOP: cli.mjs serve --stop ->\n${r.stdout ?? ""}${r.stderr ?? ""}`);
	// `stopped:true` is a REQUEST result, not proof of exit (#2420): prove the pid is gone.
	const alive = brokerProcessAlive(before.pid);
	console.log(`  pid ${before.pid} ${alive ? "STILL ALIVE — not stopped; the runbook's hard stop (after a genlock check) is the next step" : "proven gone (signal 0: ESRCH)"}`);
	process.exit(alive ? 1 : 0);
}

if (flags.action === "dry-run") {
	console.log(`\nDRY RUN — no process started. ${blocking.length ? "A start would be refused: " + blocking.join(", ") : "A start would be allowed."}`);
	process.exit(blocking.length ? 1 : 0);
}

if (flags.action === "start") {
	if (blocking.length) { console.log(`\nSTART REFUSED: ${blocking.join(", ")}`); process.exit(1); }
	const spike = join(REPO, ".spike");
	// mkdir happens only on the start path — the preflight must not create files.
	mkdirSync(spike, { recursive: true });
	const out = join(spike, "serve.out");
	const err = join(spike, "serve.err");
	const child = spawn(cmd[0], cmd.slice(1), {
		cwd: REPO,
		detached: true,
		stdio: ["ignore", openSync(out, "a"), openSync(err, "a")],
		env: { ...process.env, DURIG_DB: DB },
		windowsHide: true,
	});
	console.log(`\nSTARTED pid=${child.pid} — logs: ${out} / ${err}`);
	console.log(`  verify (not "it started"): tail -8 ${brokerLogPath(DB)} — expect START, INTENT delivered=, PASS advancing`);
	process.exit(0);
}

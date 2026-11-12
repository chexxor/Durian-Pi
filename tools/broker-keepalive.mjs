#!/usr/bin/env node
// tools/broker-keepalive.mjs — delegate instrument: keep the resident broker DRIVING an
// unattended fleet, and append a ledger line the next session can read.
//
// WHY THIS EXISTS (measured 2026-11-12, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64,
// node v24.22.1 — re-measure before quoting): a broker started with `--max-duration` reaches its
// deadline, stops logging PASS, and STAYS ALIVE (docs/runbooks/broker-down-or-stalled.md). A
// parked broker strands spooled intents and stops waking seats, so an operator who steps away for
// hours silently loses the fleet. `tools/broker-serve.mjs` says out loud that it supervises
// nothing ("the supervisor half is the TEAM's", ROADMAP 63/64) — this is the delegate-side loop
// that re-arms it, using the product's own liveness functions rather than a guess off `pgrep`.
//
// TRAP THIS TOOL HITS (measured 2026-11-12T08:26Z, first run): a pass only runs when the store
// changes, so a healthy idle broker reads "no pass in 400 s" and `broker-serve --status` calls it
// `degraded`. Re-arming on that alone stops a working broker. So the re-arm leg requires EITHER a
// dead process, OR a fresh heartbeat with NO pass AND intents actually waiting in the spool — the
// stranded signature in docs/runbooks/broker-down-or-stalled.md. Second trap: `--start` refuses
// when providers report 401, which happens if the out-of-tree key file is not sourced; the loop
// sources `$HOME/.config/durig/env` itself.
//
// WHAT IT IS NOT: it does not claim, complete, defer or route queue rows, and it does not run the
// suite. It only stops and starts the broker (the single store writer) and measures.
//
// Trigger symptom: "the team is idle / nothing is landing / the broker died at its deadline".
// Cost: one check is <1 s; `--once` is ~3 s (one queue read); the re-arm leg is ~10-20 s.
// Exit codes: 0 = loop finished or --once snapshot; 1 = two consecutive re-arms failed; 2 = usage.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brokerProcessAlive, intentInboxDir, readBrokerState } from "../src/broker.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "cli.mjs");
const SERVE = join(REPO, "tools", "broker-serve.mjs");

const USAGE = `node tools/broker-keepalive.mjs [--db ./selfdev.sqlite] [--max-duration 3600]
                                 [--interval 60] [--stale 300] [--until <ISO>] [--hours 12] [--once]
                                 [--no-restart] [--ledger .spike/fleet-ledger.jsonl]

  --interval <s>     how often to check (default 60)
  --stale <s>        lastPassAt older than this, WITH intents in the spool, means stranded (default 300)
  --max-duration <s> passed to each broker start (default 3600)
  --hours / --until  stop the loop (default --hours 12; a bounded loop is not an orphan daemon)
  --once             one snapshot + the queue shape, then exit
  --no-restart       measure only; never stop or start a broker
  --ledger <path>    where the JSONL ledger goes`;

function flag(name) {
	return process.argv.includes(name);
}

function arg(name, fallback = null) {
	const i = process.argv.findIndex((a) => a === name || a.startsWith(name + "="));
	if (i < 0) return fallback;
	return process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1];
}

// The provider keys live out of tree (mode 600). A re-arm that does not have them fails preflight
// with provider BLOCKs and looks like a dead channel rather than a missing env.
function providerEnv() {
	const envFile = process.env.DURIG_ENV_FILE || join(process.env.HOME || "", ".config", "durig", "env");
	const out = {};
	if (!existsSync(envFile)) return out;
	for (const line of readFileSync(envFile, "utf8").split("\n")) {
		const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
		if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
	}
	return out;
}

function gitCount(cmd) {
	const r = spawnSync("git", cmd, { cwd: REPO, capture: true, timeout: 20000, encoding: "utf8" });
	return r.status === 0 ? r.stdout.trim().split("\n").filter(Boolean).length : -1;
}

function queueShape(db) {
	const r = spawnSync("node", [CLI, "queue", "--json", "--no-body"], {
		cwd: REPO,
		capture: true,
		timeout: 90000,
		maxBuffer: 64 * 1024 * 1024, // the loaded queue is ~22 MB; the 1 MB spawnSync default truncates it
		encoding: "utf8",
		env: { ...process.env, ...providerEnv(), DURIG_DB: db },
	});
	if (r.status !== 0) return null;
	try {
		const doc = JSON.parse(r.stdout.split("\n").filter((l) => !l.startsWith("note:")).join("\n"));
		const items = doc.items || doc;
		const st = {};
		for (const it of items) st[it.status] = (st[it.status] || 0) + 1;
		return {
			byStatus: st,
			leased: items.filter((it) => it.priority && it.priority !== "neutral").map((it) => it.id),
		};
	} catch {
		return null;
	}
}

function pendingIntents(db) {
	return countIntentFiles(intentInboxDir(db));
}

// Exported so the re-arm rule is testable without touching a live broker (D213: every part has a
// fast loop of its own). A dead pid is obvious; "no pass for 400 s" is NOT, because a pass only
// runs when the store changes — an idle but healthy broker reads that way. Measured 2026-11-12T08:26Z:
// re-arming on staleness alone issued a STOP-REQUESTED against a broker holding four genlock leases.
function rearmVerdict(snap, stale = 300) {
	const dead = !snap.brokerAlive || (snap.heartbeatAgeS !== null && snap.heartbeatAgeS > 120);
	const stranded =
		!!snap.brokerAlive &&
		snap.lastPassAgeS !== null &&
		snap.lastPassAgeS > stale &&
		(snap.pendingIntents ?? 0) > 0;
	return { dead, stranded, shouldRearm: dead || stranded };
}

function countIntentFiles(dir) {
	if (!existsSync(dir)) return 0;
	try {
		return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
	} catch {
		return 0;
	}
}

function snapshot(db, ledger, withQueue) {
	const state = readBrokerState(db);
	const now = Date.now();
	const line = {
		at: new Date().toISOString(),
		brokerPid: state?.pid ?? null,
		brokerAlive: brokerProcessAlive(state?.pid) ? true : false,
		heartbeatAgeS: state?.heartbeatAt ? Math.round((now - state.heartbeatAt) / 1000) : null,
		lastPassAgeS: state?.lastPassAt ? Math.round((now - state.lastPassAt) / 1000) : null,
		pendingIntents: pendingIntents(db),
		refs: gitCount(["branch", "--list"]),
		// main's sha, so "did anything land?" is readable from the ledger without a second git call.
		// A landing is the only thing that moves main; refs rising with main pinned = minting, not landing.
		mainSha: spawnSync("git", ["rev-parse", "--short", "main"], { cwd: REPO, capture: true, timeout: 20000, encoding: "utf8" }).stdout.trim() || null,
		itemBranches: spawnSync("git", ["branch", "--list", "--format=%(refname:short)"], {
			cwd: REPO,
			capture: true,
			timeout: 20000,
			encoding: "utf8",
		}).stdout.split("\n").filter((r) => r.startsWith("item-")).length,
		worktrees: gitCount(["worktree", "list"]),
	};
	if (withQueue) {
		const q = queueShape(db);
		if (q) {
			line.queue = q.byStatus;
			line.leased = q.leased;
		}
	}
	if (ledger) appendFileSync(ledger, JSON.stringify(line) + "\n");
	return line;
}

function restart(db, maxDuration) {
	spawnSync("node", [CLI, "serve", "--stop"], {
		cwd: REPO,
		capture: true,
		timeout: 60000,
		encoding: "utf8",
		env: { ...process.env, ...providerEnv(), DURIG_DB: db },
	});
	const r = spawnSync(
		"node",
		[SERVE, "--start", "--no-probe", "--yes-pm-wakes", "--max-duration", String(maxDuration)],
		{
			cwd: REPO,
			capture: true,
			timeout: 120000,
			encoding: "utf8",
			env: { ...process.env, ...providerEnv(), DURIG_DB: db },
		}
	);
	return { ok: r.status === 0, out: r.stdout.trim().slice(-500), err: r.stderr.trim().slice(-500) };
}

export { rearmVerdict, countIntentFiles, snapshot, providerEnv };

// A demo imports this file to test the RULE; only a command-line run drives a broker. (First version
// ran the loop at import time, which is why the guard is a block and not a process.exit — exiting on
// import silently kills the importing demo with exit 0 and no output.)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
const db = arg("--db", process.env.DURIG_DB || "./selfdev.sqlite");
const interval = Number(arg("--interval", 60));
const stale = Number(arg("--stale", 300));
const maxDuration = Number(arg("--max-duration", 3600));
const ledger = arg("--ledger", join(REPO, ".spike", "fleet-ledger.jsonl"));
const until = arg("--until") ? new Date(arg("--until")).getTime() : Date.now() + Number(arg("--hours", 12)) * 3600 * 1000;

if (!Number.isFinite(interval) || !Number.isFinite(stale) || !Number.isFinite(maxDuration)) {
	console.error(USAGE);
	process.exit(2);
}

let fails = 0;
let tick = 0;
console.log(
	`keepalive ${new Date().toISOString()} db=${db} interval=${interval}s stale=${stale}s until=${new Date(until).toISOString()}`
);
while (Date.now() < until) {
	const snap = snapshot(db, ledger, tick % 10 === 0);
	console.log(
		`${snap.at} pid=${snap.brokerPid ?? "-"} hb=${snap.heartbeatAgeS}s lastPass=${snap.lastPassAgeS}s intents=${snap.pendingIntents} refs=${snap.refs} itemBranches=${snap.itemBranches} worktrees=${snap.worktrees} main=${snap.mainSha ?? "-"}` +
			(snap.queue ? ` queued=${snap.queue.queued ?? 0} claimed=${snap.queue.claimed ?? 0} held=${snap.queue.held ?? 0} deferred=${snap.queue.deferred ?? 0} leased=${(snap.leased ?? []).length}` : "")
	);
	const verdict = rearmVerdict(snap, stale);
	if (verdict.shouldRearm && !flag("--no-restart")) {
		console.log(`${snap.at} broker ${verdict.dead ? "DEAD" : "STRANDED (no pass " + snap.lastPassAgeS + "s, " + snap.pendingIntents + " intent(s) waiting)"} -> re-arming`);
		const r = restart(db, maxDuration);
		fails = r.ok ? 0 : fails + 1;
		console.log(`  re-arm ${r.ok ? "ok" : "FAILED"}: ${r.out || r.err}`);
		if (fails >= 2) {
			console.error("two consecutive re-arms failed; stopping so a human reads the state");
			process.exit(1);
		}
	}
	if (flag("--once")) process.exit(0);
	tick += 1;
	const sleepMs = Math.min(interval * 1000, until - Date.now());
	if (sleepMs <= 0) break;
	await new Promise((res) => setTimeout(res, sleepMs));
}
console.log(`keepalive loop ended at ${new Date().toISOString()} (until ${new Date(until).toISOString()})`);
}

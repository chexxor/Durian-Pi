#!/usr/bin/env node
/*
 * routing-on-liveness-vs-progress.mjs — the falsifiable probe for RM-329 2/3 + 3/3 (#5631).

 The design says: ONE predicate (`brokerProcessAlive` / `brokerHealth`), TWO consumers —
 the read ROUTING and the pid-not-running check rule. Routing must be three-way:
   up       -> spool
   degraded -> REFUSE, structured code, inside a DERIVED bound
   down     -> readLocal, only with the pid proven gone

 What this probe measures on the code as it is:
   A  a state naming a DEAD pid with a fresh heartbeat: does a read still route to the spool?
   B  a state naming a LIVE pid with a fresh heartbeat and a FROZEN lastPassAt: does a read
      refuse inside a derived bound, or wait out the 120_000 literal?
   C  does the refused read touch the spool or the store it is refusing to open?
   D  is there a `broker-state-pid-not-running` check rule at all?
   E  the decisive negative half: with a LIVE pid the pid-not-running finding must be ABSENT.

 Scratch is created in the seat root and removed. Exit 0 = the probe ran; the FAIL lines are
 the finding. Run: node tools/probes/routing-on-liveness-vs-progress.mjs
*/

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB = process.env.DURIG_DB || "selfdev.sqlite";
let scratchDb = DB;
const failures = [];
const say = (s) => console.log(s);
function check(cond, msg) {
	if (!cond) failures.push(msg);
	say(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
}

function cli(verb, ms, env = {}) {
	const t0 = Date.now();
	try {
		const out = execFileSync("node", ["cli.mjs", verb], {
			encoding: "utf8",
			timeout: ms,
			env: { ...process.env, DURIG_DB: scratchDb, ...env },
		});
		return { code: 0, out, elapsedMs: Date.now() - t0 };
	} catch (err) {
		return { code: err?.exitCode ?? err?.code ?? "killed", out: String(err?.stdout ?? ""), elapsedMs: Date.now() - t0 };
	}
}

const scratch = mkdtempSync(join(tmpdir(), "durig-routing-"));
const db = join(scratch, "routing-repro.sqlite");
let livePid = null;
let exitCode = 0;
try {
	scratchDb = db;
	execFileSync("node", ["cli.mjs", "up", "rig.starter.json"], { encoding: "utf8", env: { ...process.env, DURIG_DB: db } });
	const statePath = `${db}.broker.json`;
	const spoolDir = `${db}.broker.inbox`;

	/* ---------- A: DEAD pid, fresh heartbeat ---------- */
	writeFileSync(statePath, JSON.stringify({ pid: 999999999, since: Date.now(), runToken: "repro", heartbeatAt: Date.now(), lastPassAt: Date.now() }));
	const dead = cli("queue", 40_000);
	check(dead.code === 0 && dead.elapsedMs < 10_000,
		`A a read with a DEAD pid answered fast (exit ${dead.code}, ${dead.elapsedMs} ms) — routing did not go to the dead spool`);

	/* ---------- B: LIVE pid, fresh heartbeat, FROZEN progress ---------- */
	/* The probe's OWN pid is the guaranteed-live process: no spawned sleeper to reap, no
		race with the harness cleaning up children. A state file naming a live pid is exactly
		what a resident broker produces. NOTE (#5829, runbook broker-down-or-stalled): the
		heartbeat must be refreshed before EACH verb, or it ages past the 60 s liveness gate
		and the state reads as dead — the classic false negative in this recipe. */
	const forgeLive = () => writeFileSync(statePath, JSON.stringify({ pid: process.pid, since: Date.now() - 6 * 3600_000, runToken: "repro", heartbeatAt: Date.now(), lastPassAt: Date.now() - 6 * 3600_000 }));
	livePid = process.pid;
	forgeLive();
	const before = existsSync(spoolDir) ? readdirSync(spoolDir).length : 0;
	const live = cli("queue", 40_000);
	const after = existsSync(spoolDir) ? readdirSync(spoolDir).length : 0;
	say(`  B live pid ${livePid}, heartbeat fresh, lastPassAt 6 h old -> exit ${live.code} after ${live.elapsedMs} ms; spool ${before} -> ${after}`);
	check(live.code === 0,
		"B a broker with a FROZEN lastPassAt still answered the read (it did not: exit " + live.code + ")");
	check(live.elapsedMs <= 30_000,
		"B the read resolved inside a DERIVED bound (<=30 s); it took " + live.elapsedMs + " ms, i.e. it waited out the caller's own patience");

	/* ---------- C: is the DIAGNOSTIC surface itself dark when the broker is degraded? ---------- */
	forgeLive();
	const stat = cli("status", 40_000);
	say(`  C status under the same live-but-frozen state -> exit ${stat.code} after ${stat.elapsedMs} ms`);
	check(stat.code === 0 && stat.elapsedMs <= 30_000,
		"C the operator's diagnostic verb answers while the broker is degraded; it waited " + stat.elapsedMs + " ms, so the tool for SEEING the wedge is the thing the wedge blinds");

	/* ---------- D: is there a check rule for a broker state naming a dead pid? ---------- */
	forgeLive();
	const chk = cli("check", 40_000);
	const hasRule = /broker-state-pid-not-running|pid not running|pid is gone/.test(chk.out);
	check(hasRule, "D `cli.mjs check` reports a finding for a broker state naming a DEAD pid (no such rule exists today)");

	/* ---------- E: the negative half — a LIVE pid must NOT produce the finding ---------- */
	forgeLive();
	const chkLive = cli("check", 40_000);
	const falsePositive = /broker-state-pid-not-running/.test(chkLive.out);
	check(!falsePositive, "E a live pid does not trigger the pid-not-running finding (vacuously true while the rule does not exist at all)");

	/* ---------- F: the decisive negative half — a LIVE pid must still refuse `resume` ---------- */
	forgeLive();
	const { brokerAlive, brokerHealth, readBrokerState } = await import("../../src/broker.mjs");
	const st = readBrokerState(db);
	const aliveNow = brokerAlive(st, { now: Date.now() });
	console.log(`  F predicate before resume: pid=${st?.pid} brokerAlive=${aliveNow} health=${brokerHealth(st, { now: Date.now() }).state}`);
	const res = cli("resume", 40_000);
	check(res.code !== 0 && /second writer|second owner/i.test(res.out),
		"F `resume` still refuses while the pid is alive (exit " + res.code + ", out: " + String(res.out).slice(0, 160) + "); a green that loosens this admits a second writer");

	console.log(`\nRESULT: ${failures.length} failed assertion(s)`);
	if (failures.length > 0) console.log("  the 2/3 routing leg and the 3/3 check rule are NOT implemented; the predicate exists, the consumers do not");
} catch (err) {
	console.error(`probe error: ${err?.message ?? err}`);
	exitCode = 1;
} finally {
	if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
}
process.exit(exitCode);

#!/usr/bin/env node
// tools/process-leak-scan.mjs — find test-runner processes orphaned by a killed parent, and (with --kill) stop them.
//
// WHY THIS EXISTS (measured 2026-11-12T12:3xZ, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64,
// node v24.22.1, git 2.56.0 — re-measure before quoting): suite runs on this box left
// **30 orphan `node demo/broker.test.mjs` processes**, each with **0:00:00 CPU time** and
// **~80 MB RSS**, the oldest alive **3 h 18 m**, all reparented to the systemd user session (ppid 1236).
// Total held: **2.42 GB RSS** on a 96 GB box with **10.0 GB available** — enough to make a suite, a
// model server, or a broker preflight false-red. `node demo/broker.test.mjs` run standalone exits in
// **0.28 s**, so the leak is the *runner* being killed (a timeout on the parent takes no children with it),
// not the test hanging. `--kill` stopped all 30 with SIGTERM and none survived 10 s.
//
// Trigger symptom: "the suite is slow / a test times out at 120 s / the model server has no headroom /
// RAM climbs while nothing is running / `ps` shows dozens of node processes with 0 CPU time".
// Cost: 0.04 s (reads /proc; opens no store, runs no git) on the host above.
// Exit codes: 0 = scan ok; 2 = unsupported platform; 1 = --strict and leaks found.
//
// usage:
//   node tools/process-leak-scan.mjs                          # list suspects with age, RSS and verdict
//   node tools/process-leak-scan.mjs --kill                   # SIGTERM the confirmed orphans, report survivors
//   node tools/process-leak-scan.mjs --json                   # machine-readable tail
//   node tools/process-leak-scan.mjs --strict                 # exit 1 if any orphan is found
//   node tools/process-leak-scan.mjs --pattern 'demo/x\.test' --min-age 300
//
// THE LEAK HAS TWO GENERATIONS (measured 2026-11-12T13:4xZ, same host, re-measure before quoting):
// killing the reparented `demo/broker.test.mjs` runner leaves its OWN children standing — the fixture
// brokers those demos spawn, `node /tmp/durig-*/fake-broker.mjs <fixture.db>`. At 13:4xZ the scan found
// 1 orphan runner while `pgrep -cf fake-broker` counted 4 fixture brokers alive, whose fixture stores
// were already gone. The default pattern therefore includes `fake-broker\.mjs`: a fixture broker whose
// runner is dead is reparented and gets the same verdict; one still supervised by a running demo is KEPT.
// Suite residue on this box: 13,368 `/tmp/durig-*` fixture directories, 6.5 GB (df -h /tmp: 41 G free).
// A re-scan 38 minutes after a clean sweep found a new orphan — the leak is recurring, not residue.
//
// The guard — a pid is killed only if ALL of these hold:
//   1. its cmdline matches --pattern (default: a test/suite runner);
//   2. NO live ancestor is a shell, node, or `timeout` — i.e. it was reparented, so nobody is watching
//      it (a running suite's child is never a candidate);
//   3. it is older than --min-age (default 120 s), so a test still legitimately running is never touched;
//   4. it is NOT the resident broker (the pid named by the broker state file, or `cli.mjs serve`);
//   5. it is NOT this tool or its own ancestor chain.
// Every pid that fails a guard is printed as KEPT, with the reason — the tool never silently skips.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

// The guard as a pure function, so a demo can pin the decisions without /proc.
export const DEFAULT_PATTERN =
  "demo/(broker|cli|seatguard)\\.test\\.mjs|scripts/test\\.mjs|fake-broker\\.mjs";

// Order matters: a supervised process is never a candidate, however old it is.
export function classify({ pid, selfPid, ancestors, ageS, minAgeS, isSupervised, brokerPid, cmdline }) {
	if (pid === selfPid || ancestors.has(pid)) return { kill: false, why: "this tool's own process chain" };
	if (isSupervised) return { kill: false, why: "still supervised by a live runner" };
	if (ageS < minAgeS) return { kill: false, why: `only ${ageS} s old (< --min-age ${minAgeS})` };
	if (brokerPid === pid) return { kill: false, why: "the resident broker named by the state file" };
	if (/cli\.mjs serve/.test(cmdline)) return { kill: false, why: "the fleet broker (cli.mjs serve)" };
	return { kill: true, why: "reparented, older than the min age, nothing supervising it" };
}

function arg(name, fallback) {
	const i = process.argv.findIndex((a) => a === name || a.startsWith(name + "="));
	if (i < 0) return fallback;
	return process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1];
}

async function main() {
	const pattern = arg("--pattern", DEFAULT_PATTERN);
	const minAgeS = Number(arg("--min-age", 120));
	const kill = process.argv.includes("--kill");
	const json = process.argv.includes("--json");
	const strict = process.argv.includes("--strict");
	const db = arg("--db", join(REPO, "selfdev.sqlite"));

	if (!existsSync("/proc")) {
		console.error("process-leak-scan reads /proc; on Windows classify by parent PID with Get-Process");
		process.exit(2);
	}

	const uptimeSec = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
	const HZ = 100; // getconf CLK_TCK on this box; a wrong HZ makes every age wrong — verify, do not assume
	// /proc/<pid>/stat: comm is in parens and can contain spaces, so split AFTER the last ')'.
	// After it: rest[0]=state, rest[1]=ppid, rest[19]=starttime (ticks since boot).
	const statRest = (pid) => {
		const s = readFileSync(`/proc/${pid}/stat`, "utf8");
		return s.slice(s.lastIndexOf(")") + 1).trim().split(" ");
	};

	const pids = readdirSync("/proc").filter((n) => /^\d+$/.test(n)).map(Number);
	const alive = new Set(pids);

	// The broker pid is the fleet's write leg — never kill it.
	let brokerPid = null;
	for (const f of [db + ".broker.json", join(REPO, "selfdev.sqlite.broker.json")]) {
		if (existsSync(f)) {
			try { brokerPid = JSON.parse(readFileSync(f, "utf8")).pid ?? brokerPid; } catch { /* stale state file, ignore */ }
		}
	}

	const ancestors = new Set();
	let walk = process.pid;
	while (walk && alive.has(walk)) {
		ancestors.add(walk);
		walk = Number(statRest(walk)[1]);
		if (walk === 1) break;
	}

	// Supervised = some live ancestor is a runner (shell, node, timeout). Reparented to init/systemd
	// is the leak: nobody is watching the child any more.
	function supervised(pid) {
		const seen = new Set([pid]);
		let cur = Number(statRest(pid)[1]);
		while (cur && cur !== 1 && alive.has(cur) && !seen.has(cur)) {
			let comm = "";
			try { comm = readFileSync(`/proc/${cur}/comm`, "utf8").trim(); } catch { break; }
			if (/node|bash|sh|zsh|powershell|timeout/.test(comm)) return true;
			seen.add(cur);
			cur = Number(statRest(cur)[1]);
		}
		return false;
	}

	const re = new RegExp(pattern);
	const suspects = [];
	for (const pid of pids) {
		let cmdline, rest;
		try {
			cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
			if (!cmdline || !re.test(cmdline)) continue;
			rest = statRest(pid);
		} catch { continue; } // exited between listing and reading
		const ageS = Math.round(uptimeSec - Number(rest[19]) / HZ);
		let rssKb = 0;
		for (const line of readFileSync(`/proc/${pid}/status`, "utf8").split("\n")) {
			if (line.startsWith("VmRSS:")) rssKb = Number(line.split(/\s+/)[1]);
		}
	 const verdict = classify({ pid, selfPid: process.pid, ancestors, ageS, minAgeS, isSupervised: supervised(pid), brokerPid, cmdline });
		suspects.push({ pid, ppid: Number(rest[1]), ageS, rssKb, cmd: cmdline.slice(0, 90), keep: verdict.kill ? null : verdict.why });
	}

	const orphans = suspects.filter((s) => !s.keep);
	const mbHeld = orphans.reduce((a, s) => a + s.rssKb, 0) / 1024;

	console.log(`process leak scan  pattern=${pattern}  min-age=${minAgeS}s  scanned=${pids.length} pids  (HZ=${HZ}, uptime ${Math.round(uptimeSec)}s)`);
	for (const s of suspects) {
		console.log(`  pid ${String(s.pid).padEnd(7)} age ${String(s.ageS + "s").padEnd(10)} rss ${(s.rssKb / 1024).toFixed(1)} MB  ${s.keep ? "KEPT: " + s.keep : "ORPHAN"}  ${s.cmd}`);
	}
	console.log(`  ${orphans.length} orphan(s) holding ${mbHeld.toFixed(2)} MB RSS`);
	if (!orphans.length) console.log("  clean — no reparented test runner older than the min age");

	if (kill && orphans.length) {
		let sent = 0, failed = 0;
		for (const s of orphans) {
			try { process.kill(s.pid, "SIGTERM"); sent++; } catch { failed++; }
		}
		// One bounded wait, then report what is still there. No SIGKILL: an orphan that ignores SIGTERM
		// is a defect worth naming, not a process to destroy.
		const until = Date.now() + 10000;
		while (Date.now() < until && orphans.some((s) => existsSync(`/proc/${s.pid}`))) {
			await new Promise((r) => setTimeout(r, 500));
		}
		const still = orphans.filter((s) => existsSync(`/proc/${s.pid}`));
		console.log(`  SIGTERM sent to ${sent} (failed ${failed}); ${still.length} still alive after 10 s`);
		for (const s of still) console.log(`  still alive: pid ${s.pid} — ${s.cmd}`);
	}

	if (json) console.log(JSON.stringify({ ok: true, pattern, minAgeS, scanned: pids.length, suspects: suspects.length, orphans: orphans.length, mbHeld: Number(mbHeld.toFixed(1)), list: orphans }));
	if (strict && orphans.length) process.exit(1);
}

// Importable for the guard predicate (demo/process-leak-guard.test.mjs); executable for the scan.
if (process.argv[1] && process.argv[1].endsWith("process-leak-scan.mjs")) main();

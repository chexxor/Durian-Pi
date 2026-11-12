// demo/broker-keepalive-stop-guard.test.mjs — pins the guard in tools/broker-keepalive.mjs that
// decides which pid a re-arm may stop.
// WHY: a broker that breaks out of its wake loop at `--max-duration` stays ALIVE and never reads the
// stop flag, so `serve --stop` is invisible to it and `broker-serve --start` then refuses with
// `START REFUSED: broker-degraded` (measured 2026-11-12T11:22Z and 11:37Z on this box: two
// consecutive failed re-arms, which made the keepalive loop exit 1 and left the fleet unattended).
// The runbook's remedy is `kill -TERM <pid>` — and a tool that TERM blindly would be able to kill a
// seat, or a suite's /tmp fake broker. So the predicate that gates the TERM is the safety part, and
// it is testable without touching any process.
// Trigger: any change to the re-arm leg of tools/broker-keepalive.mjs.
// Cost: measured 2026-11-12, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1 —
// 0.11 s, exit 0. No store, no broker, no seat.
import { spawnSync } from "node:child_process";
import path from "node:path";

const rigRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const cases = [
	["/usr/bin/node /home/x/Git/Durian-Pi/cli.mjs serve --max-duration 3600", true],
	["node cli.mjs serve", true],
	["node /tmp/durig-suite-icMDRV/broker-stop-liveness/durig-stop-live-XFPQKl/fake-broker.mjs case1.db stale-stay", false],
	["node demo/broker.test.mjs", false],
	["node cli.mjs queue --json", false],
	["node cli.mjs serve --stop", true],
	["", false],
	[undefined, false],
];

const src = spawnSync("node", ["-e", "import('./tools/broker-keepalive.mjs').then(m=>console.log(typeof m.isResidentBroker))"], {
	cwd: rigRoot,
	capture: true,
	timeout: 30000,
	encoding: "utf8",
});

let fails = 0;
if (src.status !== 0 || src.stdout.trim() !== "function") {
	console.log(`FAIL import: status ${src.status} out=${src.stdout} err=${src.stderr.slice(0, 300)}`);
	fails += 1;
}

// Re-derive the predicate from the file text so the pins cannot pass against a stub: the tool's own
// regex is the thing being tested.
const tool = spawnSync("node", ["-e", "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const m=s.match(/function isResidentBroker\\(cmdline\\) \\{([^}]*)\\}/);console.log(m[1])", path.join(rigRoot, "tools", "broker-keepalive.mjs")], {
	cwd: rigRoot,
	capture: true,
	timeout: 30000,
	encoding: "utf8",
});
if (tool.status !== 0 || !/cli\\.mjs serve/.test(tool.stdout)) {
	console.log("FAIL the tool defines isResidentBroker with the cli.mjs serve predicate");
	fails += 1;
}
const predicate = new Function("cmdline", tool.stdout);
for (const [cmdline, want] of cases) {
	const got = predicate(cmdline);
	if (got === want) console.log(`ok   ${want} for ${String(cmdline).slice(0, 60) || "(empty)"}`);
	else {
		fails += 1;
		console.log(`FAIL ${String(cmdline).slice(0, 60)} -> got ${got}, want ${want}`);
	}
}
console.log(fails ? `${fails} FAILURE(S)` : "all pins hold");
process.exit(fails ? 1 : 0);

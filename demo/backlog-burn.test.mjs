// demo/backlog-burn.test.mjs — pins the arithmetic of tools/backlog-burn.mjs.
// WHY: "the team is busy" is not "the backlog is shrinking". The verdict this tool prints is a
// subtraction over two ledger snapshots; a sign error or a state that is not counted (rows that
// leave `queued` but never reach `done`) makes a GROWING fleet read as a shrinking one, and the
// operator then grants more capacity instead of less. Pinning the arithmetic is cheap: no store,
// no git, no seat — a fixture ledger in a temp dir.
// Trigger: any change to tools/backlog-burn.mjs, or a claim that the backlog is draining.
// Cost: measured 2026-11-12, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1
// — 0.31 s, exit 0.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rigRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TOOL = path.join(rigRoot, "tools", "backlog-burn.mjs");
const dir = mkdtempSync(path.join(os.tmpdir(), "backlog-burn-fixture-"));

const snap = (at, queue, refs, mainSha) => JSON.stringify({ at, brokerAlive: true, refs, mainSha, queue });
// Timestamps RELATIVE to now, so the --hours window pins mean the same thing at any wall clock.
const NOW = Date.now();
const iso = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();

// Two snapshots 60 minutes apart. 20 done, 5 cancelled, 10 queued minted, held/deferred flat.
const ledger = [
	snap(iso(90), { done: 4700, cancelled: 900, held: 400, deferred: 500, claimed: 10, queued: 500 }, 100, "aaaaaaa"),
	// a line with no queue object must be skipped, not counted
	JSON.stringify({ at: iso(60), brokerPid: 1, brokerAlive: true, refs: 104, worktrees: 99 }),
	snap(iso(30), { done: 4720, cancelled: 905, held: 400, deferred: 500, claimed: 10, queued: 510 }, 104, "bbbbbbb"),
].join("\n") + "\n";
writeFileSync(path.join(dir, "ledger.jsonl"), ledger);

const run = (args) => spawnSync("node", [TOOL, ...args], { capture: true, encoding: "utf8", timeout: 30000 });

let fails = 0;
const check = (name, cond, detail) => {
	if (cond) console.log(`ok   ${name}`);
	else {
		fails += 1;
		console.log(`FAIL ${name}: ${detail}`);
	}
};

const r = run(["--ledger", path.join(dir, "ledger.jsonl")]);
const out = r.stdout;
check("exit 0 on a readable ledger", r.status === 0, `status ${r.status} err=${r.stderr.slice(0, 200)}`);
check("20 done closed over the hour", out.includes("done       4700 -> 4720   delta +20   20.0/h"), out);
check("minted rows counted", out.includes("queued     500 -> 510   delta +10"), out);
check("verdict is GROWING when open rows rise faster than they close", out.includes("25 rows closed, +10 open rows in the window -> backlog GROWING"), out);
check("refs trend reported", out.includes("refs 100 -> 104 (4)"), out);
check("main moving is not over-claimed as a landing", out.includes("main aaaaaaa -> bbbbbbb") && out.includes("landing"), out);

const r2 = run(["--ledger", path.join(dir, "shrinking.jsonl")]);
writeFileSync(
	path.join(dir, "shrinking.jsonl"),
	[
		snap(iso(120), { done: 100, cancelled: 0, held: 0, deferred: 0, claimed: 0, queued: 50 }, 10, "c1"),
		snap(iso(0), { done: 140, cancelled: 5, held: 0, deferred: 0, claimed: 0, queued: 10 }, 8, "c1"),
	].join("\n")
);
const r3 = run(["--ledger", path.join(dir, "shrinking.jsonl")]);
check("a fleet that closes more than it mints reads as shrinking", r3.stdout.includes("-> backlog shrinking"), r3.stdout);
check("main pinned reports NOT MOVING", r3.stdout.includes("main c1 -> c1  (NOT MOVING: nothing landed)"), r3.stdout);

const r4 = run(["--ledger", path.join(dir, "empty.jsonl")]);
writeFileSync(path.join(dir, "empty.jsonl"), '{"at":"2026-11-12T10:00:00.000Z","refs":1}\n');
check("a ledger with no queue snapshot exits 2, not 0", r4.status === 2, `status ${r4.status}`);

const r5 = run(["--ledger", path.join(dir, "missing.jsonl")]);
check("a missing ledger exits 2 with a readable reason", r5.status === 2 && r5.stderr.includes("cannot read ledger"), `status ${r5.status}`);

// The --hours window must actually bound the window.
const r6 = run(["--ledger", path.join(dir, "ledger.jsonl"), "--hours", "1"]);
check("--hours 1 drops the snapshot outside the window", r6.stdout.includes("ledger has 2 queue snapshots; 1 in the 1h window"), r6.stdout);
const r7 = run(["--ledger", path.join(dir, "ledger.jsonl"), "--hours", "3"]);
check("--hours 3 keeps both snapshots inside the window", r7.stdout.includes("2 in the 3h window"), r7.stdout);

rmSync(dir, { recursive: true, force: true });
console.log(fails ? `${fails} FAILURE(S)` : "all pins hold");
process.exit(fails ? 1 : 0);

// demo/commit-secrets.test.mjs — #1317: the commit-time secret pre-flight.
//
// Security finding #1315 (HIGH): the commit path had NO automated gate — nothing
// stopped a secret-shaped line from being committed into portable history. This proves
// the gate the guard now runs on a seat's own `git commit`: it scans the STAGED
// content, refuses a secret-shaped value, names the FILE, and NEVER echoes the value.
//
// Precision-first is part of the contract: the gate uses #700's provider-PREFIX shapes
// only, so a full git sha (40 hex chars) in a diff is NOT refused — a gate that blocks
// ordinary commits is an outage (the posture rule: prefer a false negative).
//
// Failing-first: before the gate, `git commit` is allowed and the first block
// assertion fails (RED).
//
// Run: node demo/commit-secrets.test.mjs  (exit 0 = pass)

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeTool, secretOffendersInDiff } from "../src/seatguard.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

// Shaped like an OpenAI key (not a real one).
const FAKE_KEY = "sk-" + "a".repeat(32);

// --- unit: the diff scanner ---------------------------------------------------
console.log("\nthe diff scanner reads ADDED lines only, by token shape");
const diffWithSecret =
	"diff --git a/durig.config.json b/durig.config.json\n" +
	"--- a/durig.config.json\n" +
	"+++ b/durig.config.json\n" +
	"@@ -0,0 +1,2 @@\n" +
	`+{"DEEPINFRA_API_KEY":"${FAKE_KEY}"}\n` +
	'+{"DURIG_DB":"./rig.sqlite"}\n';
const hit = secretOffendersInDiff(diffWithSecret);
check("a secret-shaped token on an added line is an offender", hit.length === 1, JSON.stringify(hit));
check("the offender names the file", hit[0]?.path === "durig.config.json", JSON.stringify(hit));
check("the offender NEVER carries the value", !JSON.stringify(hit).includes(FAKE_KEY));
check(
	"a REMOVED line is not scanned (the value is leaving the tree)",
	secretOffendersInDiff(`diff --git a/x b/x\n+++ b/x\n@@ -1,1 +1,0 @@\n-{"K":"${FAKE_KEY}"}\n`).length === 0,
);
check(
	"a 40-hex git sha is NOT an offender (precision-first, no false positive)",
	secretOffendersInDiff('diff --git a/x.json b/x.json\n+++ b/x.json\n@@ -0,0 +1,1 @@\n+{"rev":"850d53b6bb0e3a23396610f912a9a55ba58c558b"}\n').length === 0,
);
check(
	"a clean diff has no offenders",
	secretOffendersInDiff("diff --git a/x b/x\n+++ b/x\n@@ -0,0 +1,1 @@\n+x=1\n").length === 0,
);

// --- #1379 (G-A): the extended provider classes -------------------------------
console.log("\n#1379 (G-A): the extended provider classes are enforced; precision kept");
const added = (line) => secretOffendersInDiff(`diff --git a/x b/x\n+++ b/x\n@@ -0,0 +1,1 @@\n+${line}\n`);
const classCases = [
	["OpenAI key (already covered)", `key = sk-${"a".repeat(32)}`],
	["AWS access key id", `aws_access_key_id = AKIA${"A".repeat(16)}`],
	["Slack token", `slack = xoxb-${"a".repeat(12)}`],
	["GitHub OAuth token", `token = gho_${"A".repeat(24)}`],
	["GitHub fine-grained PAT", `token = github_pat_${"A".repeat(24)}`],
	["PEM private-key header (raw-LINE pass)", "-----BEGIN RSA PRIVATE KEY-----"],
];
for (const [label, line] of classCases) {
	check(`${label} IS refused`, added(line).length === 1, line.slice(0, 26) + "…");
}
check(
	"the offender objects carry {path} ONLY, never a value (G-D refusal path)",
	classCases.every(([, line]) => added(line).every((o) => Object.keys(o).join(",") === "path")),
);
check(
	"a 40-hex git sha is STILL not refused (precision kept)",
	added('{"rev":"850d53b6bb0e3a23396610f912a9a55ba58c558b"}').length === 0,
);
check(
	"ordinary lowercase identifiers are not refused",
	added("const aws_region_primary_cluster_name = us_east_1;").length === 0,
);

// --- integration: the guard blocks a `git commit` whose STAGED content leaks ---
const root = mkdtempSync(join(tmpdir(), "durig-commit-secrets-"));
const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
git("init", "-q");
git("config", "user.email", "t@example.invalid");
git("config", "user.name", "t");
process.env.DURIG_SEAT_ROOT = root;
const commitCall = (id, command) => beforeTool({ type: "toolCall", id, name: "bash", arguments: { command } });

try {
	console.log("\na clean staged change commits");
	writeFileSync(join(root, "clean.txt"), "nothing secret here\n");
	git("add", "clean.txt");
	check("a clean staged file is allowed", (await commitCall("1", "git commit -m x")) === undefined);
	git("commit", "-q", "-m", "clean", "--", "clean.txt");

	console.log("\na secret-shaped value in the staged content is refused, without the value");
	writeFileSync(join(root, "leak.json"), JSON.stringify({ DEEPINFRA_API_KEY: FAKE_KEY }) + "\n");
	git("add", "leak.json");
	const blocked = await commitCall("2", "git commit -m x");
	check("the commit is BLOCKED", typeof blocked?.block === "string", JSON.stringify(blocked));
	check("the block names the file", blocked?.block?.includes("leak.json"), blocked?.block);
	check("the block NEVER echoes the value", !blocked?.block?.includes(FAKE_KEY), blocked?.block);
	git("reset", "-q", "leak.json");
	rmSync(join(root, "leak.json"));

	console.log("\n#1379: an extended class (AWS) in the staged content is refused, without the value");
	const AWS_KEY = "AKIA" + "B".repeat(16);
	writeFileSync(join(root, "aws.txt"), `aws_access_key_id = ${AWS_KEY}\n`);
	git("add", "aws.txt");
	const blockedAws = await commitCall("6", "git commit -m x");
	check("the AWS-keyed commit is BLOCKED", typeof blockedAws?.block === "string", JSON.stringify(blockedAws));
	check("the AWS block names the file", blockedAws?.block?.includes("aws.txt"), blockedAws?.block);
	check("the AWS block NEVER echoes the value", !blockedAws?.block?.includes(AWS_KEY), blockedAws?.block);
	git("reset", "-q", "aws.txt");
	rmSync(join(root, "aws.txt"));

	console.log("\n`git commit -a` is scanned through the working tree, not just the index");
	writeFileSync(join(root, "tracked.txt"), "before\n");
	git("add", "tracked.txt");
	git("commit", "-q", "-m", "add tracked");
	writeFileSync(join(root, "tracked.txt"), `key = ${FAKE_KEY}\n`);
	const blockedA = await commitCall("3", "git commit -a -m x");
	check("git commit -a with a secret in the tree is BLOCKED", typeof blockedA?.block === "string", JSON.stringify(blockedA));
	check("the -a block never echoes the value", !blockedA?.block?.includes(FAKE_KEY));

	console.log("\n#1380 (G-B): a scan that CANNOT run fails OPEN but WARNS LOUDLY, echoing nothing");
	const notRepo = mkdtempSync(join(tmpdir(), "durig-commit-norepo-"));
	const prevRoot = process.env.DURIG_SEAT_ROOT;
	process.env.DURIG_SEAT_ROOT = notRepo; // no git repo here -> `git diff --cached` fails
	const errLines = [];
	const origErr = console.error;
	console.error = (...a) => errLines.push(a.join(" "));
	let warnVerdict;
	try {
		warnVerdict = await commitCall("7", "git commit -m x");
	} finally {
		console.error = origErr;
		process.env.DURIG_SEAT_ROOT = prevRoot;
		rmSync(notRepo, { recursive: true, force: true });
	}
	const warned = errLines.join("\n");
	check("the commit is ALLOWED (fail-open is ratified at this point)", warnVerdict === undefined, JSON.stringify(warnVerdict));
	check("a SEATGUARD WARNING is printed", /SEATGUARD WARNING/.test(warned), warned);
	check("the warning names the failure kind, never diff content", !/diff --git|\+\+\+ b\/|@@ /.test(warned), warned);
	check("G-D: the warning path echoes NO secret value", !warned.includes(FAKE_KEY) && !warned.includes(AWS_KEY), warned);

	console.log("\nnon-commit commands are untouched");
	check("git status is allowed", (await commitCall("4", "git status")) === undefined);
	check("a git commit with no staged secret is allowed", (await commitCall("5", "git commit --amend -m x")) === undefined);
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nPASS — the commit-time secret pre-flight holds" : `\nFAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);

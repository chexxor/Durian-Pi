// demo/suite-signature.test.mjs — the red-suite classifier groups by CAUSE, not by the first line it hits (#6176).
//
// Why this is a test and not just a utility nobody uses. During the pi v1.5.1 pin move the scratch
// classifier in `.spike/pin-update/signature-classify.mjs` put eight distinct failures in one bucket called
// "(no stderr line)". Eight causes became one line in a brief, and the pin move was described as "8
// pre-existing reds". The failure ledger (#3795) exists precisely because flattened causes become permanent
// excuses.
//
// So the test has to do two things, and only one of them is obvious:
//   1. show the promoted tool separates nine genuinely different failures, produced by really running them;
//   2. reproduce the predecessor's collapse on the SAME capture, so the fix is a measured difference rather
//      than a claim. A classifier that cannot be shown to have merged things is a classifier nobody trusts.
//
// Run: node demo/suite-signature.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, parseBlocks, signatureOf } from "../tools/suite-signature.mjs";

const dir = mkdtempSync(join(tmpdir(), "suite-signature-"));

// Nine failing scripts, each for a DIFFERENT reason. These are real node runs, not canned strings: the
// signatures come out of what node actually prints.
const fixtures = {
	"assert-mismatch.test.mjs": 'import assert from "node:assert/strict";\nassert.equal(1, 2, "widget count is off by one");\n',
	"type-error.test.mjs": "const cfg = null;\ncfg.settings.restartLimit = 3;\n",
	"thrown-error.test.mjs": 'throw new Error("provider returned no model for the seat");\n',
	"syntax-error.test.mjs": "const pin = ;\n",
	"missing-module.test.mjs": 'import "@earendil-works/definitely-not-a-package";\n',
	// pi-durable throws classes that do not end in "Error" (SessionFailed and friends). A classifier that
	// only matches "*Error" calls these unclassified, which is the flattening this tool is meant to remove.
	"named-error.test.mjs": "class HarnessFailure extends Error {}\nthrow new HarnessFailure('the harness closed before the run finished');\n",
	"silent-exit-1.test.mjs": "process.exit(1);\n",
	"silent-exit-2.test.mjs": "process.exit(2);\n",
	"hangs.test.mjs": "setTimeout(() => process.exit(0), 30000);\n",
};
for (const [name, src] of Object.entries(fixtures)) writeFileSync(join(dir, name), src);

/** Mirror scripts/test.mjs: head+tail of the capture, the `--- <file> (exit N) ---` header, and a timeout
 * reported as a FAIL with `exit null` (a SIGKILLed process has no exit code). The classifier is only as
 * good as the format it reads. */
function runCapture(file, timeoutMs = 3000) {
	return new Promise((res) => {
		const child = spawn(process.execPath, [join(dir, file)], { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		child.stdout.on("data", (d) => (out += d.toString()));
		child.stderr.on("data", (d) => (out += d.toString()));
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);
		child.on("close", (code) => {
			clearTimeout(timer);
			const body = out.trim().split("\n");
			const shown = body.length <= 30 ? body : [...body.slice(0, 15), "...", ...body.slice(-10)];
			res(
				`--- ${file} (exit ${code === null ? "null" : code}) ---\n${shown.join("\n")}\n${timedOut ? `TIMED OUT after ${timeoutMs}ms (killed)\n` : ""}`,
			);
		});
	});
}

let capture = "";
for (const [name, src] of Object.entries(fixtures)) {
	// The hanging fixture gets a 500 ms bound so the runner's timeout path is exercised, not assumed.
	capture += await runCapture(name, name === "hangs.test.mjs" ? 500 : 3000);
}

/* 1. The blocks are there, with the exit codes the runner reported. */
const blocks = parseBlocks(capture);
assert.equal(blocks.length, 9, `the capture should hold 9 red blocks, got ${blocks.length}`);

/* 2. NINE CAUSES = NINE SIGNATURES. The whole point: distinct failures never share a bucket. */
const result = classify(capture);
assert.equal(
	result.distinct,
	9,
	`9 distinct failures collapsed into ${result.distinct} signatures: ${result.groups.map((g) => g.label).join(" | ")}`,
);
for (const g of result.groups)
	assert.equal(g.members.length, 1, `${g.label} swallowed ${g.members.length} rows`);

/* 3. THE TWO SILENT ONES ARE THE OLD BUG. Neither prints an error line. The predecessor's key was
 *    "(no stderr line)" for both, so it merged them. Here each gets its own file and its own exit code. */
const silent = result.groups.filter((g) => g.kind === "UNCLASSIFIED");
assert.equal(silent.length, 2, `the two silent failures must be two signatures, got ${silent.length}`);
const sigA = signatureOf(blocks.find((b) => b.file === "silent-exit-1.test.mjs"));
const sigB = signatureOf(blocks.find((b) => b.file === "silent-exit-2.test.mjs"));
assert.notEqual(
	sigA.key,
	sigB.key,
	"two different silent failures sharing a signature is the defect this tool exists to kill",
);
assert.match(
	sigA.label,
	/no output at all \(exit 1\)/,
	"an unrecognisable failure names itself by its own row and exit code, not by a catch-all bucket",
);
assert.equal(sigA.exit, 1);
assert.equal(sigB.exit, 2);
assert.ok(sigA.site, "a signature always carries a site, even a fallback one");

/* 4. THE NAMED CAUSES ARE NAMED, not truncated to a first line. */
const kinds = result.groups.map((g) => g.kind).sort();
assert.ok(kinds.includes("AssertionError[ERR_ASSERTION]"), `the assertion failure is not classified as such: ${kinds.join(", ")}`);
assert.ok(kinds.includes("TypeError"), `the undefined-access failure is missing: ${kinds.join(", ")}`);
assert.ok(kinds.includes("SyntaxError"), `the unparseable file is missing: ${kinds.join(", ")}`);
assert.ok(
	kinds.some((k) => k.startsWith("HarnessFailure")),
	`a named error class not ending in "Error" is missed: ${kinds.join(", ")}`,
);
const timed = result.groups.find((g) => g.timedOut);
assert.ok(timed, "the hung fixture is not classified as a timeout");
const sigTimed = signatureOf(blocks.find((b) => b.file === "hangs.test.mjs"));
assert.equal(sigTimed.exit, null, "a killed test reports exit null, and the classifier must read it, not drop it");
assert.ok(timed.members.includes("hangs.test.mjs"), "the timeout signature names the demo that hung");

/* 5. THE PREDECESSOR, REPRODUCED ON THE SAME CAPTURE. Its key was the first line matching
 *    /AssertionError|Error:|TIMEOUT/, else "(no stderr line)", truncated to 80 chars. Running it here makes
 *    the improvement a number in this test instead of a story in a runbook. */
const naive = {};
for (const b of blocks) {
	const err =
		b.body.find((l) => /(AssertionError|Error:|TIMEOUT)/.test(l)) ||
		b.body.find((l) => /code: 'ERR_/.test(l)) ||
		"(no stderr line)";
	(naive[err.trim().slice(0, 80)] ||= []).push(b.file);
}
const naiveDistinct = Object.keys(naive).length;
assert.ok(
	naiveDistinct < 9,
	`the old grouping separated all 9 causes, so this comparison proves nothing (${naiveDistinct} buckets)`,
);
const catchAll = naive["(no stderr line)"] ?? [];
assert.ok(
	catchAll.length >= 2,
	`the predecessor's catch-all bucket is empty here, so the failure mode is not reproduced (${Object.keys(naive).join(" | ")})`,
);
assert.ok(
	result.distinct > naiveDistinct,
	`the promoted tool must classify MORE finely: ${result.distinct} vs the predecessor's ${naiveDistinct}`,
);

/* 6. IDENTICAL REDS DO GROUP, AND THE GROUP SAYS IT GROUPED. Re-run the same fixture: one cause, two rows.
 *    Grouping everything is wrong; grouping what is genuinely the same is right. */
const twice = capture + (await runCapture("assert-mismatch.test.mjs"));
const dup = classify(twice);
assert.equal(dup.blocks, 10, "the second run is a tenth red block");
assert.equal(dup.distinct, 9, "but it is the same cause as the first, so it groups");
const group = dup.groups.find((g) => g.members.length === 2);
assert.ok(group, "the repeated failure did not group with itself");
assert.ok(group.notes.some((n) => n.startsWith("MERGED:")), "a group that merged does not say so");

rmSync(dir, { recursive: true, force: true });
console.log(
	`SUITE-SIGNATURE TEST PASS (#6176): 9 real reds, 9 signatures; the predecessor merged the same capture into ${naiveDistinct} buckets with ${catchAll.length} of them in its "(no stderr line)" catch-all; identical causes still group, and a group that merges says so`,
);
process.exit(0);

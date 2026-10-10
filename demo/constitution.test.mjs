// The constitution must actually reach the rig. A spec may carry it inline
// (`constitutionInline`, what scripts/from-openrig.mjs emits, because the text
// it read has no file beside the spec) or as a path (`constitution`, what
// rig.v2.json uses). Reading only the path silently dropped the text for every
// converted rig, so a whole 13-seat team ran without its own grounding rule and
// no error was raised anywhere.
// Run: node demo/constitution.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const dir = mkdtempSync(join(tmpdir(), "durig-constitution-"));
const db = join(dir, "rig.sqlite");
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const INLINE_TEXT = "# Inline constitution\n\nP1 Grounding: cite the passage.\n";
const FILE_TEXT = "# File constitution\n\nP2 Scope: one concern per change.\n";

const specPath = join(dir, "inline.rig.json");
writeFileSync(
	specPath,
	JSON.stringify({
		version: 2,
		seats: [
			{
				name: "solo",
				role: "worker",
				instructions: "Say OK.",
				capabilities: ["implement"],
			},
		],
		constitutionInline: INLINE_TEXT,
	}),
);

const fileSpecPath = join(dir, "file.rig.json");
writeFileSync(join(dir, "only.txt"), FILE_TEXT);
writeFileSync(
	fileSpecPath,
	JSON.stringify({
		version: 2,
		seats: [
			{
				name: "solo",
				role: "worker",
				instructions: "Say OK.",
				capabilities: ["implement"],
			},
		],
		constitution: join(dir, "only.txt"),
	}),
);

const up = (rigFile) =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, ["cli.mjs", "up", rigFile], {
			cwd: durigDir,
			env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => (stdout += c));
		child.stderr.on("data", (c) => (stderr += c));
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});

// Read through storage rather than the harness: the point is what a seat's
// prompt section would receive, and that is the stored document's text.
async function readConstitution() {
	const storage = await openNodeSqliteStorage(db);
	const rec = await storage.findDocument(
		{ kind: "durig.constitution", scope: { kind: "session" } },
		"current",
		BACKGROUND_CONTEXT,
	);
	if (!rec) return null;
	return (await storage.document(rec.id, "current", BACKGROUND_CONTEXT))?.value?.text ?? "";
}

try {
	// 1. The inline form the converter emits is applied. This is the regression:
	//    it was ignored, so the document held "" (or an older rig's text).
	const inlineRun = await up(specPath);
	assert.equal(inlineRun.code, 0, `up (inline) failed: ${inlineRun.stderr.slice(0, 300)}`);
	const inlineText = await readConstitution();
	assert.equal(inlineText, INLINE_TEXT, "inline constitution lands in storage");

	// 2. The file form keeps working: the fix must not have traded one for the
	//    other, and re-running `up` with a different form replaces the text.
	const fileRun = await up(fileSpecPath);
	assert.equal(fileRun.code, 0, `up (file) failed: ${fileRun.stderr.slice(0, 300)}`);
	assert.equal(await readConstitution(), FILE_TEXT, "file constitution still lands");

	// 3. A spec with neither form leaves the existing text alone rather than
	//    wiping it: absent means "not specified", not "empty".
	const bareSpec = join(dir, "bare.rig.json");
	writeFileSync(
		bareSpec,
		JSON.stringify({ version: 2, seats: [{ name: "solo", role: "worker", instructions: "Say OK." }] }),
	);
	const bareRun = await up(bareSpec);
	assert.equal(bareRun.code, 0, `up (bare) failed: ${bareRun.stderr.slice(0, 300)}`);
	assert.equal(await readConstitution(), FILE_TEXT, "no constitution key leaves the text intact");

	// 4. Both keys set is ambiguous, so it warns instead of choosing silently.
	const bothSpec = join(dir, "both.rig.json");
	writeFileSync(
		bothSpec,
		JSON.stringify({
			version: 2,
			seats: [{ name: "solo", role: "worker", instructions: "Say OK." }],
			constitution: join(dir, "only.txt"),
			constitutionInline: INLINE_TEXT,
		}),
	);
	const bothRun = await up(bothSpec);
	assert.equal(bothRun.code, 0, `up (both) failed: ${bothRun.stderr.slice(0, 300)}`);
	assert.match(bothRun.stderr, /sets both constitutionInline and constitution/, "ambiguity is reported");
	assert.equal(await readConstitution(), INLINE_TEXT, "inline wins when both are present");

	console.log("CONSTITUTION TEST PASS (inline applied, file preserved, absent kept, ambiguity reported)");
	process.exit(0);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}

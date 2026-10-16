// demo/secretdetect.test.mjs — prove READ-SIDE secret detection (item #828).
//
// Failing-first: before src/secretdetect.mjs exists, `node demo/secretdetect.test.mjs`
// cannot run. After: it exercises the classifier (positive/negative), the entry
// scanner, and the attention notice — and proves the ONE binding rule: the notice
// names WHERE and NEVER echoes the value.
//
// Run: node demo/secretdetect.test.mjs  (exit 0 = pass)

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, Seats, enqueueItem, registerSeat } from "../src/rig.mjs";
import { fillRoster } from "../src/seattools.mjs";
import { readRigHealth } from "../src/readapi.mjs";
import {
	entryTextSegments,
	scanEntriesForSecrets,
	secretNotices,
	secretTokens,
} from "../src/secretdetect.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;

function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

// A secret-shaped value used only to prove detection. Not a real credential.
const SECRET = `sk-${"z".repeat(24)}`;
const SECRET2 = `ghp_${"Q".repeat(24)}`;

/* ─── 1. the classifier (secretTokens) ───────────────────────────────────── */
console.log("\nsecretTokens — positive shapes");
check("openai-style key", secretTokens(`the key is ${SECRET}`).some((t) => t.family === "openai-key"));
check(
	"huggingface token",
	secretTokens(`hf_${"A".repeat(20)}`).some((t) => t.family === "huggingface-token"),
);
check("github pat", secretTokens(`ghp_${"B".repeat(24)}`).some((t) => t.family === "github-pat"));
check(
	"google api key",
	secretTokens(`AIza${"C".repeat(24)}`).some((t) => t.family === "google-api-key"),
);
check(
	"high-entropy run (letters AND digits, 40+)",
	secretTokens(`token ${"a1b2c3d4e5".repeat(5)}`).some((t) => t.family === "high-entropy-token"),
);
check(
	"KEY=value assignment",
	secretTokens(`DEEPINFRA_API_KEY=${SECRET}`).some((t) => t.family === "openai-key"),
);
check(
	"JSON key:value pair",
	secretTokens(`{"api_key":"${SECRET2}"}`).some((t) => t.family === "github-pat"),
);
check(
	"token with trailing sentence period",
	secretTokens(`use ${SECRET}.`).some((t) => t.family === "openai-key"),
);

console.log("\nsecretTokens — negative shapes (must NOT flag)");
check("ordinary prose", secretTokens("the quick brown fox jumps over the lazy dog").length === 0);
check(
	"a Windows path with a colon and separators",
	secretTokens("C:/Users/Alex/AppData/Local/Temp/whatever-file-name.txt").length === 0,
);
check("a short key-like token", secretTokens("sk-short").length === 0);
check(
	"a long run of letters with no digits",
	secretTokens("a".repeat(64)).length === 0,
);
check("empty string", secretTokens("").length === 0);

console.log("\nsecretTokens — findings carry an offset, never the value");
const hits = secretTokens(`prefix ${SECRET} suffix`);
check("exactly one hit", hits.length === 1, JSON.stringify(hits));
check("hit names an offset", Number.isInteger(hits[0]?.offset));
check("hit JSON contains no value", !JSON.stringify(hits).includes(SECRET));

/* ─── 2. the entry scanner (scanEntriesForSecrets) ───────────────────────── */
console.log("\nscanEntriesForSecrets — WHERE, never the value");
const seat = { name: "alpha", conversationId: 3 };
const entries = [
	{
		id: 7,
		kind: "pi.assistant",
		model: [{ role: "assistant", content: [{ type: "text", text: `here is the key ${SECRET}` }] }],
	},
	{ id: 6, kind: "pi.tool-result", model: [{ role: "tool", content: [{ type: "text", text: "ok" }] }] },
];
const findings = scanEntriesForSecrets(seat, entries);
check("one finding", findings.length === 1, JSON.stringify(findings));
check("finding names the seat", findings[0]?.seat === "alpha");
check("finding names the entry id", findings[0]?.entryId === 7, JSON.stringify(findings[0]));
check("finding names the location inside the entry", findings[0]?.where === "content[0].text");
check("finding names the family", findings[0]?.family === "openai-key");
check("finding JSON contains no value", !JSON.stringify(findings).includes(SECRET));
check(
	"entryTextSegments labels a typed text part by its index",
	entryTextSegments(entries[1])[0]?.where === "content[0].text",
);

/* ─── 3. the notice (secretNotices) ──────────────────────────────────────── */
console.log("\nsecretNotices — names WHERE, never the value");
const notices = secretNotices(findings);
check("one notice per seat", notices.length === 1, JSON.stringify(notices));
check("notice kind is secret_detected", notices[0]?.kind === "secret_detected");
check("notice scope/seat set", notices[0]?.scope === "seat" && notices[0]?.seat === "alpha");
check("detail names the entry id", notices[0]?.detail.includes("#7"), notices[0]?.detail);
check("detail names the location", notices[0]?.detail.includes("content[0].text"));
check("notice JSON contains no value", !JSON.stringify(notices).includes(SECRET));
check("no findings => no notices", secretNotices([]).length === 0);

/* ─── 4. end-to-end through readRigHealth ────────────────────────────────── */
console.log("\nreadRigHealth — a committed secret raises the attention notice");
const dir = mkdtempSync(join(tmpdir(), "durig-secretdetect-"));
const cwd = join(dir, "seat-workspace");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

try {
	await harness.commit(async (tx) => {
		const mk = async (name, role) => {
			const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd });
			await registerSeat(tx, name, conv.id, role);
			return conv.id;
		};
		await mk("alpha", "alpha role");
		await mk("beta", "beta role");
	}, ctx);
	await harness.commit(async (tx) => {
		await enqueueItem(tx, "pm", "alpha", "task for alpha", "details A");
	}, ctx);
	const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
	fillRoster(new Map(Object.entries(seats)), seats);

	// alpha's conversation gets a committed secret two ways: the input entry (a
	// string content) and the assistant reply (a typed text part).
	faux.setResponses([fauxAssistantMessage(fauxText(`sure, use ${SECRET2} for that`))]);
	const alphaConv = await harness.conversation(seats.alpha.conversationId, ctx);
	const run = await alphaConv.submit({ type: "input", content: `please call the API with ${SECRET}` }, ctx);
	await run.wait(ctx);

	const health = await readRigHealth(storage, dir, 4, { entryLimit: 10 });
	const secretNoticesFound = health.attention.filter((a) => a.kind === "secret_detected");
	check("a secret_detected notice is raised", secretNoticesFound.length === 1, JSON.stringify(secretNoticesFound));
	check("the notice is for the seat that holds the secret", secretNoticesFound[0]?.seat === "alpha");
	check(
		"the finding names a committed entry + location",
		health.secretFindings.some((f) => f.seat === "alpha" && f.entryId != null && f.where),
		JSON.stringify(health.secretFindings),
	);
	check(
		"the beta seat (clean) is not flagged",
		!health.secretFindings.some((f) => f.seat === "beta"),
		JSON.stringify(health.secretFindings),
	);
	// The binding rule, proven on the WHOLE serialized surface the operator sees.
	const serialized = JSON.stringify(health.attention) + JSON.stringify(health.secretFindings);
	check("the notice surface never echoes the input value", !serialized.includes(SECRET));
	check("the notice surface never echoes the assistant value", !serialized.includes(SECRET2));
} finally {
	await harness.close(ctx);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING: ${err?.message ?? err}`);
	}
}

console.log(failures === 0 ? "\nPASS — secret detection verified" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

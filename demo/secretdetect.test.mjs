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

/* ─── 5. git-object echoes are NOT secrets (#1658; security #1620/#1712, lead #1660) ── */
console.log("\nsecretTokens — git-object echoes do not fire; a hex secret still does");
// The empty tree: a REAL git object present in every repository (no fixture needed).
const REAL_OBJECT = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// A 40-hex string with letters AND digits that is NOT a git object (verified: cat-file exits 128).
const NOT_AN_OBJECT = "0123456789abcdef0123456789abcdef01234567";
check("HEAD=<real git object> does NOT fire", secretTokens(`HEAD=${REAL_OBJECT}`).length === 0, JSON.stringify(secretTokens(`HEAD=${REAL_OBJECT}`)));
check("pin <real git object> does NOT fire", secretTokens(`pin ${REAL_OBJECT}`).length === 0);
check("commit <real git object> does NOT fire", secretTokens(`commit ${REAL_OBJECT}`).length === 0);
// THE BINDING GUARD: a pure-hex40 that is NOT a git object STILL FIRES — even inside a git
// context. A blanket "pure-hex40" exclusion (or a context match alone) would lose this.
check("bare non-object 40-hex still fires", secretTokens(NOT_AN_OBJECT).some((t) => t.family === "high-entropy-token"));
check("HEAD=<non-object 40-hex> STILL FIRES", secretTokens(`HEAD=${NOT_AN_OBJECT}`).length === 1, JSON.stringify(secretTokens(`HEAD=${NOT_AN_OBJECT}`)));
check("commit <non-object 40-hex> STILL FIRES", secretTokens(`commit ${NOT_AN_OBJECT}`).length === 1);
// The checker is what decides: a stub proves both directions without touching the repo.
check("a stub probe that CONFIRMS objecthood excludes the token", secretTokens(`HEAD=${NOT_AN_OBJECT}`, { isGitObject: () => true }).length === 0);
check("a stub probe that DENIES objecthood keeps the token", secretTokens(`HEAD=${REAL_OBJECT}`, { isGitObject: () => false }).length === 1);
// The real secret families are untouched by the narrowing.
check("sk-<hex> still fires", secretTokens(`sk-${"a1b2c3d4e5f6a7b8"}`).some((t) => t.family === "openai-key"));
check("the committed-secret vector still fires", secretTokens(`the key is ${SECRET}`).some((t) => t.family === "openai-key"));
check(
	"a git-object echo raises no finding and no notice",
	secretNotices(
		scanEntriesForSecrets({ name: "s", conversationId: 1 }, [
			{ id: 1, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: `HEAD=${REAL_OBJECT}` }] }] },
		]),
	).length === 0,
);

/* ─── 6. attribution: the notice points at the TRUE segment ───────────────── */
console.log("\nentryTextSegments — the where label matches the real segment index");
const mixedEntry = {
	id: 9,
	kind: "pi.assistant",
	model: [
		{
			role: "assistant",
			content: [
				{ type: "text", text: "before" },
				{ type: "toolCall", arguments: { key: `sk-${"c".repeat(24)}` } },
			],
		},
	],
};
const mixedSegs = entryTextSegments(mixedEntry);
check("a text part keeps its own index", mixedSegs[0]?.where === "content[0].text", JSON.stringify(mixedSegs));
check("a toolCall part keeps its own index", mixedSegs[1]?.where === "content[1].arguments", JSON.stringify(mixedSegs));
const mixedFindings = scanEntriesForSecrets({ name: "s", conversationId: 1 }, [mixedEntry]);
check(
	"the finding points at the toolCall segment, not the text one",
	mixedFindings.length === 1 && mixedFindings[0].where === "content[1].arguments",
	JSON.stringify(mixedFindings),
);

console.log(failures === 0 ? "\nPASS — secret detection verified" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

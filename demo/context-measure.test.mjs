// demo/context-measure.test.mjs — item 27's per-seat context-consumption measure (#1192).
//
// What it proves: the measure sums a REAL transcript's NEWEST assistant `usage`
// (input + output + cacheRead + cacheWrite; `reasoning` is a subset of `output` and is
// NOT added), and it carries its three-state denominator (`measured|declared|advertised`)
// with the value — exposed on the health snapshot so the TUI consumes it verbatim.
//
// Failing-first: before #1192 there is no src/context.mjs (import error) and
// `readRigHealth(...).context` does not exist. Run: node demo/context-measure.test.mjs
// (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, compilePersona, registerSeat } from "../src/rig.mjs";
import { readRigHealth } from "../src/readapi.mjs";
import {
	contextConsumption,
	newestAssistantUsage,
	usageConsumed,
	windowState,
} from "../src/context.mjs";
import { declaredContextWindow } from "../src/config.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-context-"));
const dbPath = join(dir, "context.db");

const assistant = (usage, text = "") => ({
	kind: "pi.assistant",
	model: [{ role: "assistant", content: [{ type: "text", text }], ...(usage ? { usage } : {}) }],
});

try {
	console.log("\n=== #1192: per-seat context-consumption measure ===\n");

	// ── 1. the pure measure ────────────────────────────────────────────────────
	console.log("1. the measure sums the four fields and never double-counts reasoning");
	check(
		"input+output+cacheRead+cacheWrite",
		usageConsumed({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 999 }) === 10,
		String(usageConsumed({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 999 })),
	);
	check("an all-zero usage is a real 0, not 'unknown'", usageConsumed({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }) === 0);
	check("no usage object -> null", usageConsumed(undefined) === null && usageConsumed({}) === null);
	check(
		"the newest assistant USAGE wins, skipping a newer turn that reported none",
		newestAssistantUsage([assistant(null), assistant({ input: 7, output: 0, cacheRead: 0, cacheWrite: 0 })])?.input === 7,
	);

	console.log("\n2. the denominator is three-state, most trustworthy first");
	check("advertised alone -> advertised", windowState({ advertised: 100 }).denominator === "advertised");
	check("declared beats advertised", windowState({ declared: 50, advertised: 100 }).denominator === "declared");
	check("measured beats declared", windowState({ measured: 10, declared: 50, advertised: 100 }).denominator === "measured");
	check("no window -> denominator null and NO fraction", windowState({}).denominator === null);
	{
		const m = contextConsumption([assistant({ input: 5, output: 0, cacheRead: 0, cacheWrite: 0 })], {});
		check("a bare count still reports, with a null fraction", m.consumed === 5 && m.fraction === null);
	}
	check(
		"declared config: a JSON map resolves per model",
		declaredContextWindow({ DURIG_CONTEXT_WINDOW: '{"GLM-5.3-Flash": 111}' }, "deepinfra/GLM-5.3-Flash") === 111,
	);
	check("declared config: a bare number applies to every model", declaredContextWindow({ DURIG_CONTEXT_WINDOW: "222" }, "deepinfra/x") === 222);
	check("declared config: malformed is null, not a guess", declaredContextWindow({ DURIG_CONTEXT_WINDOW: "nope" }) === null);

	// ── 3. the exposure on the health snapshot, over a real store ──────────────
	console.log("\n3. readRigHealth exposes it per seat, over a real transcript");
	const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(Router);
	const storage = new MemoryStorage();
	const harness = await Harness.open(storage, { models, registry }, ctx);

	let convId;
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, {
			model: { provider: "faux", modelId: "faux-seat" },
			instructions: compilePersona({ role: "worker" }),
		});
		await registerSeat(tx, "worker", c.id, "worker");
		convId = c.id;
	}, ctx);

	// Two assistant turns: an OLDER big one and a NEWER small one. The measure must read
	// the newest, not the largest.
	await harness.commit(async (tx) => {
		await tx.appendEntry(convId, assistant({ input: 1000, output: 200, cacheRead: 3000, cacheWrite: 50, reasoning: 80, totalTokens: 4250 }, "older"));
		await tx.appendEntry(convId, assistant({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 2, totalTokens: 15 }, "newest"));
	}, ctx);

	{
		const health = await readRigHealth(storage, dbPath, 1, {
			windowsBySeat: { worker: { advertised: 128000 } },
			cfg: { DURIG_CONTEXT_WINDOW: "200000" },
		});
		const m = health.context?.worker;
		check("the snapshot carries a context measure per seat", Boolean(m), JSON.stringify(health.context));
		check("it sums the NEWEST turn's usage", m?.consumed === 15, JSON.stringify(m));
		check("the usage breakdown is carried (incl. reasoning, display-only)", m?.usage?.input === 10 && m?.usage?.reasoning === 2, JSON.stringify(m?.usage));
		check("declared beats the catalog's advertised figure", m?.window?.denominator === "declared" && m?.window?.value === 200000, JSON.stringify(m?.window));
		check("all three candidates are reported", m?.window?.candidates?.advertised === 128000 && m?.window?.candidates?.measured === null, JSON.stringify(m?.window?.candidates));
		check("the fraction uses the RESOLVED window", Math.abs((m?.fraction ?? 0) - 15 / 200000) < 1e-12, String(m?.fraction));
	}

	{
		// A measured window (item 97, #1087) wins the moment it exists.
		const health = await readRigHealth(storage, dbPath, 1, {
			windowsBySeat: { worker: { measured: 1000, advertised: 128000 } },
			cfg: { DURIG_CONTEXT_WINDOW: "200000" },
		});
		check(
			"a supplied measured window wins",
			health.context?.worker?.window?.denominator === "measured" && health.context?.worker?.window?.value === 1000,
			JSON.stringify(health.context?.worker?.window),
		);
	}

	{
		// No declared and no measured: fall through to the advertised figure, still named.
		const health = await readRigHealth(storage, dbPath, 1, {
			windowsBySeat: { worker: { advertised: 4000 } },
		});
		check(
			"with only a catalog figure, the state says so",
			health.context?.worker?.window?.denominator === "advertised" && health.context?.worker?.window?.value === 4000,
			JSON.stringify(health.context?.worker?.window),
		);
	}

	console.log(
		failures === 0
			? "\nPASS - the measure sums the newest usage and carries its three-state denominator"
			: `\nFAIL - ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.stack ?? err);
	failures += 1;
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {}
}

process.exit(failures === 0 ? 0 : 1);

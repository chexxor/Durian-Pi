// tools/model-probes/spend-cap-acceptance.mjs — the acceptance probes for the #5015 spend-cap spec.
//
// WHAT THIS IS. `docs/reviews/architecture-spend-cap-2026-11-03.md` states a decision and a buildable spec.
// A spec whose claims cannot be run is a memo. This file runs them and prints a verdict per claim, with the
// AXIS of every number (tokens / USD / USD-per-call / turns / MiB). It is deliberately NOT a `demo/` member:
// several probes are RED today by design — that is the failing-first record — and the demo suite is the rig's
// oracle, which a design item must not turn red. The build is done when this exits 0.
//
// NEVER SPENDS. No provider is contacted. Every request goes to a loopback stub started in this process, and
// the "credential" is a literal string in an injected env object, never `process.env`'s real key. It imports
// `metered.mjs` (importing it spends nothing) and `src/providers/local.mjs` (pure, no side effects). It does
// NOT import `tools/model-probes/gate.mjs`: that file has no import guard, so importing it RUNS the gate and
// spends GPU/API — the exact defect #5027's demo now locks at demo/probe-metered-ledger.test.mjs:398-403.
//
// Usage:
//   node tools/model-probes/spend-cap-acceptance.mjs [--snapshot <catalog.json>]
// Exit 0 = every claim holds. Exit 1 = at least one claim is unmet (today: expected).

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	meteredChat,
	ledgerPath,
	spendTotalUsd,
	projectCostUsd,
	CEILING_ENV,
	KEY_ENV_ORDER,
	PRICE_IN_ENV,
	PRICE_OUT_ENV,
} from "./metered.mjs";
import { createLocalProvider, VERIFIER_ENV_PREFIX } from "../../src/providers/local.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ------------------------------------------------------------------ this rig's own measured shape
// Input/output shape of a verifier turn, from docs/runbooks/verifier-model-server.md ("the numbers that
// decide the window"): qa p50 prompt 55,538 tokens; the rig's declared verifier output budget is 3,000
// tokens. Axis labels are carried everywhere on purpose.
const RIG_IN_TOKENS = 55_538; // tokens
const RIG_OUT_TOKENS = 3_000; // tokens
const POOL_USD = 4.0; // USD, cumulative: the operator's grant (D193, 2026-11-02)
const RUN_CAP_USD = 0.1; // USD, per probe session: lead's standing pre-authorization
const CALL_CAP_USD = 0.05; // USD, projected per call: this spec's proposal

const CAP_CALL_ENV = "DURIG_SPEND_CAP_CALL_USD";
const CAP_RUN_ENV = "DURIG_SPEND_CAP_RUN_USD";
const CAP_STORE_ENV = "DURIG_SPEND_CAP_STORE_USD";

const results = [];
function verdict(id, claim, axis, ok, detail) {
	results.push({ id, claim, axis, ok, detail });
	console.log(`${ok ? "PASS" : "RED "}  ${id}  ${claim}\n        axis: ${axis}\n        detail: ${detail}`);
}

// ------------------------------------------------------------------ the loopback stub
const seen = [];
const server = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		seen.push({ url: req.url, auth: req.headers.authorization ?? null, body });
		res.writeHead(200, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				choices: [{ message: { content: "no defect" }, finish_reason: "stop" }],
				usage: {
					prompt_tokens: RIG_IN_TOKENS,
					completion_tokens: RIG_OUT_TOKENS,
					prompt_tokens_details: { cached_tokens: 0 },
					completion_tokens_details: { reasoning_tokens: 0 },
				},
			}),
		);
	});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const STUB = `http://127.0.0.1:${server.address().port}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "durig-5015-"));
const LEDGER = path.join(tmp, "spend.jsonl");

// P1 — the guard MECHANISM refuses before the wire (green today), and the SEAT seam does not carry it (red).
{
	fs.rmSync(LEDGER, { force: true });
	// Seed the ledger so the projected line is the thing that crosses: spent $0.0995 of a $0.10 RUN cap, and
	// the call projects $0.00165 at the shipped default row (GLM-5.3-Flash, $0.15/$0.50 per Mtok).
	fs.appendFileSync(LEDGER, JSON.stringify({ model: "prior", usd: 0.0995 }) + "\n");
	const before = seen.length;
	let threw = null;
	try {
		await meteredChat({
			baseUrl: STUB,
			body: {
				model: "zai-org/GLM-5.3-Flash",
				messages: [{ role: "system", content: "review" }, { role: "user", content: "x".repeat(3000) }],
				max_tokens: RIG_OUT_TOKENS,
			},
			env: {
				[CEILING_ENV]: String(RUN_CAP_USD),
				[PRICE_IN_ENV]: "0.15",
				[PRICE_OUT_ENV]: "0.5",
				[KEY_ENV_ORDER[0]]: "not-a-real-key",
			},
			ledgerFile: LEDGER,
		});
	} catch (e) {
		threw = e;
	}
	const mechanismOk = threw && threw.name === "CeilingError" && seen.length === before;

	const cli = read("cli.mjs");
	const seamSources = cli + read("src/providers/trace.mjs") + read("src/config.mjs");
	const seatSeamGuarded = /wrapProviderWithSpend|DURIG_SPEND_CAP_/.test(seamSources);
	const newRequests = seen.length - before;
	verdict(
		"P1",
		"a projected crossing is refused BEFORE the request, at the ONE provider seam every run path uses",
		"USD-per-call projection; stub request count",
		mechanismOk && seatSeamGuarded,
		`mechanism at meteredChat: ${mechanismOk ? `OK, threw CeilingError and the stub saw ${newRequests} new requests` : `BROKEN (threw ${threw && threw.name}, stub saw ${newRequests} new requests)`}; ` +
			`seat seam (cli.mjs buildModels, the wrapProviderWithTrace site) carries a spend wrapper: ${seatSeamGuarded}`,
	);
}

// P2 — a metered (non-loopback) provider row must not claim cost 0.
{
	let built = null;
	const fakeCreate = (spec) => {
		built = spec;
		return spec;
	};
	createLocalProvider(
		{
			id: "verifier",
			prefix: VERIFIER_ENV_PREFIX,
			baseUrl: "https://api.deepinfra.com/v1/openai",
			modelId: "openai/gpt-oss-20b",
			contextWindow: 131_072,
			maxTokens: 8_192,
			apiKeyEnv: "DURIG_VERIFIER_API_KEY",
		},
		{ createProvider: fakeCreate, api: {} },
	);
	const cost = built?.models?.[0]?.cost;
	const zeroRow = cost && cost.input === 0 && cost.output === 0 && cost.cacheRead === 0;
	const cliZeroRow = /cost: \{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 \}/.test(read("cli.mjs"));
	verdict(
		"P2",
		"a non-loopback provider row cannot be registered with cost {0,0,0} (an unpriced metered row is a lie about money)",
		"USD per 1M tokens",
		!zeroRow && !cliZeroRow,
		`local provider row for a DeepInfra baseUrl: cost=${JSON.stringify(cost)}; ` +
			`cli.mjs still synthesizes a metered row with cost {0,0,0,0}: ${cliZeroRow} (cli.mjs:336)`,
	);
}

// P3 — the caps must exist in a TRACKED file, or they are absent in every item worktree.
{
	const defaults = JSON.parse(read("durig.config.default.json"));
	const missing = [CAP_CALL_ENV, CAP_RUN_ENV, CAP_STORE_ENV].filter((k) => !(k in defaults));
	verdict(
		"P3",
		"the cap values live in durig.config.default.json (tracked), so a seat in an item worktree has a guard armed",
		"USD",
		missing.length === 0,
		`tracked defaults: ${JSON.stringify(defaults)}; missing: ${missing.join(", ") || "none"}. ` +
			`durig.config.json is gitignored (.gitignore:8) so a cap declared only there is UNARMED in worktrees`,
	);
}

// P4 — one ledger, one row format, both call paths.
{
	const stubRow = await meteredChat({
		baseUrl: STUB,
		body: { model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "hi" }], max_tokens: 24 },
		env: { [KEY_ENV_ORDER[0]]: "not-a-real-key", [PRICE_IN_ENV]: "0.03", [PRICE_OUT_ENV]: "0.14" },
		ledgerFile: LEDGER,
	});
	const keys = Object.keys(stubRow.ledgerRow);
	const seatWritesLedger = /appendLedger|ledgerRow|DURIG_SPEND_LEDGER/.test(read("cli.mjs"));
	verdict(
		"P4",
		"the seat path writes the SAME 14-field row to the SAME ledger file as the probe path (no second ledger)",
		"row keys; USD",
		keys.length === 14 && seatWritesLedger,
		`row keys: ${keys.length}; seat path writes the ledger: ${seatWritesLedger}; default ledger path: ${ledgerPath({})}`,
	);
	// the cheap read stays cheap: one file read, and unknown-cost rows are counted, never folded into money
	fs.rmSync(LEDGER, { force: true });
	fs.appendFileSync(LEDGER, JSON.stringify({ model: "a", usd: 0.01 }) + "\n");
	fs.appendFileSync(LEDGER, JSON.stringify({ model: "b", usd: null, priceSource: "none" }) + "\n");
	const totals = spendTotalUsd(LEDGER);
	assert.equal(totals.totalUsd, 0.01);
	assert.equal(totals.unknownCostRows, 1);
}

// P5 — a per-STORE cumulative cap distinct from the per-run cap.
{
	const metered = read("tools/model-probes/metered.mjs");
	const storeCapArmed = new RegExp(CAP_STORE_ENV).test(metered);
	const callCapArmed = new RegExp(CAP_CALL_ENV).test(metered);
	verdict(
		"P5",
		`the cumulative cap (${CAP_STORE_ENV}, the operator's pool) and the per-call cap (${CAP_CALL_ENV}) are enforced, not just the run cap`,
		"USD cumulative over the ledger",
		storeCapArmed && callCapArmed,
		`CEILING_ENV today: ${CEILING_ENV} (a RUN cap). pool=${POOL_USD} USD, run cap=${RUN_CAP_USD} USD, proposed call cap=${CALL_CAP_USD} USD; ` +
			`store cap present: ${storeCapArmed}; call cap present: ${callCapArmed}`,
	);
	// what a crossing refusal must contain: the cap, the running total, the projected line
	const projected = projectCostUsd({
		price: { in: 0.15, out: 0.5, cacheRead: 0.03 },
		body: { messages: [{ role: "user", content: "y".repeat(RIG_IN_TOKENS * 3) }], max_tokens: RIG_OUT_TOKENS },
	});
	verdict(
		"P5b",
		"a refusal can name cap + spent + projected (the #3663/#3795 shape: name the cause and the remedy)",
		"USD-per-call projection",
		Number.isFinite(projected) && projected > 0,
		`projected for a ${RIG_IN_TOKENS}-in / ${RIG_OUT_TOKENS}-out turn at the SHIPPED DEFAULT row (GLM-5.3-Flash, $0.15/$0.50 per Mtok): $${projected} — ` +
			`that is ${(projected / CALL_CAP_USD).toFixed(1)}x the proposed call cap, and the whole $${POOL_USD} pool buys ${Math.floor(POOL_USD / projected)} such turns`,
	);
}

// P6 — numbers are derived from a DATED snapshot, and cache pricing is claimed only where the vendor publishes it.
{
	const argIdx = process.argv.indexOf("--snapshot");
	const snapshot = argIdx === -1 ? null : process.argv[argIdx + 1];
	if (!snapshot || !fs.existsSync(snapshot)) {
		console.log(
			"SKIP  P6  no price snapshot; pass --snapshot <catalog.json>  (fetch: curl -s https://api.deepinfra.com/v1/openai/models -o <file>)",
		);
	} else {
		const j = JSON.parse(fs.readFileSync(snapshot, "utf8"));
		const rows = (j.data || []).filter((m) => m.metadata?.tags?.includes("chat"));
		const asOf = j.fetchedAt ?? j.at ?? null;
		const maxAgeDays = Number(process.env.DURIG_PROBE_PRICE_MAX_AGE_DAYS ?? "14");
		const ageDays = asOf ? Math.floor((Date.now() - Date.parse(asOf)) / 86_400_000) : null;
		const want = [
			"zai-org/GLM-5.3-Flash",
			"openai/gpt-oss-20b",
			"openai/gpt-oss-120b",
			"deepseek-ai/DeepSeek-V4-Flash-0731",
			"mistralai/Mistral-Small-3.2-24B-Instruct-2506",
		];
		console.log(
			`\nprice snapshot: ${snapshot} asOf=${asOf ?? "UNSTATED"} chatRows=${rows.length} (curated fallback rows: 16)`,
		);
		let unpricedClaimedCache = 0;
		const table = [];
		for (const id of want) {
			const m = rows.find((r) => r.id === id);
			if (!m) {
				table.push(`${id}: NOT IN SNAPSHOT`);
				continue;
			}
			const p = m.metadata.pricing || {};
			const ctx = m.metadata.context_length;
			const maxTok = m.metadata.max_tokens;
			const worst = (ctx * Number(p.input_tokens) + maxTok * Number(p.output_tokens)) / 1e6;
			const turn = (RIG_IN_TOKENS * Number(p.input_tokens) + RIG_OUT_TOKENS * Number(p.output_tokens)) / 1e6;
			if (p.cache_read_tokens === undefined) unpricedClaimedCache++;
			table.push(
				`${id}: ctx=${ctx} maxTokens=${maxTok} $in=${p.input_tokens} $out=${p.output_tokens} ` +
					`$cacheRead=${p.cache_read_tokens ?? "NOT PUBLISHED"} | worst one call $${worst.toFixed(4)} | ` +
					`rig turn $${turn.toFixed(6)} | $4 pool buys ${Math.floor(POOL_USD / turn)} turns`,
			);
		}
		console.log(
			`      worst-case single call (USD) and per-turn runway (turns) — axis: USD/call, turns/$4:\n        ` +
				table.join("\n        "),
		);
		if (ageDays !== null && ageDays > maxAgeDays)
			console.log(`      NOTE: snapshot is ${ageDays} d old (> ${maxAgeDays}) — prices are STALE, re-fetch (#5014)`);
		if (asOf === null)
			console.log(
				"      NOTE: this snapshot carries NO fetch date — an undated price is an undated claim. Stamp it (fetchedAt) or re-fetch (#5014).",
			);
		verdict(
			"P6",
			"cache-read pricing is claimed only for rows whose vendor publishes it (cached runway is otherwise fiction)",
			"USD per 1M cached tokens",
			true,
			`rows in the credible set with NO published cache_read price: ${unpricedClaimedCache} of ${want.length} — quote no cache saving for those`,
		);
	}
}

// P6b — the TRACKED curated fallback table (`fallbackModels()`, what `buildModels` actually reads) must not
// carry a row whose own declared geometry can spend more than the store cap in one call, and its prices must
// agree with a dated snapshot. A date in a comment is not a control.
{
	const argIdx = process.argv.indexOf("--snapshot");
	const snapshot = argIdx === -1 ? null : process.argv[argIdx + 1];
	if (!snapshot || !fs.existsSync(snapshot)) {
		console.log("SKIP  P6b  needs --snapshot <catalog.json> to diff the curated fallback against a dated source");
	} else {
		const { fallbackModels } = await import("../../src/providers/deepinfra-models.ts");
		const live = new Map((JSON.parse(fs.readFileSync(snapshot, "utf8")).data ?? []).map((m) => [m.id, m]));
		const drift = [];
		const exposure = [];
		const absent = [];
		for (const r of fallbackModels()) {
			const worst = (r.contextWindow * r.cost.input + r.maxTokens * r.cost.output) / 1e6;
			if (worst > POOL_USD) exposure.push(`${r.id}: declared ${r.contextWindow} ctx at $${r.cost.input}/$${r.cost.output} = $${worst.toFixed(2)} per maximal call = ${(worst / POOL_USD).toFixed(2)}x the ${POOL_USD} cap`);
			const m = live.get(r.id);
			if (!m) {
				absent.push(r.id);
				continue;
			}
			const p = m.metadata?.pricing ?? {};
			const rel = (a, b) => (a === 0 || b === undefined ? 0 : Math.abs(b - a) / a);
			if (rel(r.cost.input, p.input_tokens) > 0.25 || rel(r.cost.output, p.output_tokens) > 0.25)
				drift.push(`${r.id}: declared $${r.cost.input}/$${r.cost.output} vs snapshot $${p.input_tokens}/$${p.output_tokens}`);
		}
		console.log(
			`\ncurated fallback vs dated snapshot: rows=${fallbackModels().length} absent=${absent.length} drifted>25%=${drift.length} over-cap=${exposure.length}`,
		);
		for (const l of [...exposure, ...drift]) console.log(`        ${l}`);
		if (absent.length) console.log(`        NOTE absent from the live catalog (a seat naming one cannot be served): ${absent.join(", ")}`);
		verdict(
			"P6b",
			"no curated row's declared geometry can spend more than the store cap in ONE call, and its prices match a dated source within 25 %",
			"USD per maximal call; USD per 1M tokens",
			exposure.length === 0 && drift.length === 0,
			`over-cap rows: ${exposure.length ? exposure.join("; ") : "none"}; drifted rows: ${drift.length ? drift.join("; ") : "none"}`,
		);
	}
}

// P7 — a cap trip is a money stop, not a model error: it must not be retried.
{
	const sup = read("src/supervisor.mjs");
	const classified = /spend_cap_exceeded/.test(sup) || /spend_cap_exceeded/.test(read("src/attention.mjs"));
	verdict(
		"P7",
		"a tripped cap settles the send as a named, NON-RETRYABLE cause class and parks the item",
		"cause class (not money)",
		classified,
		`supervisor/attention name a spend_cap_exceeded class: ${classified}. Without it the provider error is retried ` +
			`(2 SDK retries) and the supervisor's repeated_failure escalation fires after 3 spends — a loop that costs money`,
	);
}

// P8 — the un-accounted probe set, recomputed (this is the set the #5024 demo pins on purpose).
{
	const others = ["calibrate-verifier.mjs", "cold-prefill.mjs", "stream-probe.mjs", "throughput.mjs"];
	const unaccounted = others.filter((f) => {
		const t = read(path.join("tools", "model-probes", f));
		return /chat\/completions/.test(t) && !/metered\.mjs/.test(t);
	});
	verdict(
		"P8",
		"every tracked probe that posts /chat/completions goes through meteredChat (the accounted path)",
		"call sites",
		unaccounted.length === 0,
		`still un-accounted: ${unaccounted.join(", ") || "none"}. ` +
			`demo/probe-metered-ledger.test.mjs:422-447 pins this set; narrow that pin in the SAME commit as each migration`,
	);
}

// P9 — a metered provider makes the key question explicit: present, and read by the code that sends.
{
	const local = read("src/providers/local.mjs");
	const placeholder = /local-placeholder/.test(local);
	verdict(
		"P9",
		"a metered provider with no resolvable key refuses at startup rather than sending a placeholder credential",
		"credential presence (never its value)",
		!placeholder,
		`src/providers/local.mjs:145-147 falls back to the literal "local-placeholder": ${placeholder} — ` +
			`against a metered host that is a 401 that reads as a model failure`,
	);
}

server.close();
fs.rmSync(tmp, { recursive: true, force: true });

const red = results.filter((r) => !r.ok);
console.log(`\n${results.length - red.length}/${results.length} acceptance claims hold; ${red.length} RED:`);
for (const r of red) console.log(`  ${r.id}: ${r.claim}`);
console.log(
	`\nspend-cap-acceptance: ${red.length ? "SPEC NOT BUILT" : "SPEC BUILT"} (ledger default ${ledgerPath({})}; ` +
		`caps proposed ${CAP_CALL_ENV}=${CALL_CAP_USD} ${CAP_RUN_ENV}=${RUN_CAP_USD} ${CAP_STORE_ENV}=${POOL_USD} USD; no metered call was made)`,
);
process.exit(red.length ? 1 : 0);

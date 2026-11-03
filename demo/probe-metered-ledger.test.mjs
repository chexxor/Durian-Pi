// demo/probe-metered-ledger.test.mjs — a probe must authenticate, refuse before spending, and account after
// (#5024). No real provider is contacted: every request here goes to a loopback stub in this process, and the
// operator's key is never read — the "key" is a literal string passed in an injected env.
//
// WHAT WAS BROKEN, measured on main at dispatch: gate.mjs posted `/chat/completions` with only
// `{"content-type": "application/json"}` — no `authorization` at all — and NOTHING in the repo recorded spend
// (`grep -nE "SPEND|CAP_|MAX_SPEND" src/config.mjs` empty; no src/costsheet.mjs). So the gate could not run
// against the metered provider, and D193's paid arms produced verdicts with no bill attached.
//
// WHAT THIS DEMO DOES NOT TEST: the ceiling POLICY. The ceiling value is architect's #5015. Pinned here is the
// mechanism: a declared ceiling stops a call BEFORE it is sent (asserted as "the stub saw 0 requests", not as
// arithmetic), and an unpriced call under a declared ceiling is refused rather than waved through.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mod = await import("../tools/model-probes/metered.mjs");
const {
	meteredChat,
	authFor,
	priceFor,
	projectCostUsd,
	costUsd,
	assertCeiling,
	CeilingError,
	ledgerPath,
	spendTotalUsd,
	formatRunTotal,
	readLedger,
	KEY_ENV_ORDER,
	CEILING_ENV,
	PRICE_IN_ENV,
	PRICE_OUT_ENV,
} = mod;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "durig-5024-"));
const LEDGER = path.join(tmp, "spend.jsonl");

// ---------------------------------------------------------------- the loopback stub: it echoes what it received
const seen = [];
const server = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		seen.push({
			url: req.url,
			auth: req.headers.authorization ?? null,
			contentType: req.headers["content-type"] ?? null,
			body,
		});
		res.writeHead(200, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				choices: [{ message: { content: "no defect" }, finish_reason: "stop" }],
				usage: {
					prompt_tokens: 115,
					completion_tokens: 24,
					prompt_tokens_details: { cached_tokens: 0 },
					completion_tokens_details: { reasoning_tokens: 7 },
				},
			}),
		);
	});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const STUB = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------- 1. a keyed call attaches the header
{
	fs.rmSync(LEDGER, { force: true });
	const env = {
		[KEY_ENV_ORDER[0]]: "probe-key-5024-never-a-real-one",
		[PRICE_IN_ENV]: "55",
		[PRICE_OUT_ENV]: "260",
	};
	const r = await meteredChat({
		baseUrl: STUB,
		body: {
			model: "openai/gpt-oss-120b",
			messages: [
				{ role: "system", content: "sys" },
				{ role: "user", content: "hi" },
			],
			max_tokens: 24,
		},
		env,
		ledgerFile: LEDGER,
	});
	assert.equal(r.status, 200, "the stub answered");
	assert.equal(seen.length, 1, `expected exactly one request, saw ${seen.length}`);
	assert.equal(
		seen[0].auth,
		"Bearer probe-key-5024-never-a-real-one",
		`the provider reads authorization; the probe sent ${JSON.stringify(seen[0].auth)}`,
	);
	assert.equal(seen[0].contentType, "application/json", "content-type must survive the rewrite");
	assert.equal(
		r.auth.keyEnv,
		"DURIG_VERIFIER_API_KEY",
		"the key variable the PROVIDER code reads (src/providers/local.mjs:88) must be the first one a probe looks in",
	);
	assert.equal(r.auth.header.includes("probe-key-5024"), true);
	// the ledger never carries the credential, only the variable NAME
	assert.equal(readLedger(LEDGER)[0].authKeyEnv, "DURIG_VERIFIER_API_KEY");
	assert.ok(
		!fs.readFileSync(LEDGER, "utf8").includes("probe-key-5024"),
		"a ledger that logs the key is a leak",
	);
}

// ---------------------------------------------------------------- 2. an unkeyed call to a METERED host refuses, naming its cause
{
	const before = seen.length;
	let threw = null;
	try {
		await meteredChat({
			baseUrl: "https://api.deepinfra.com/v1/openai",
			body: { model: "x/y", messages: [], max_tokens: 24 },
			env: {},
			fetchImpl: () => assert.fail("must not fetch: the refusal happens before the request"),
			ledgerFile: LEDGER,
		});
	} catch (e) {
		threw = e;
	}
	assert.ok(threw, "an unkeyed call to a metered host must throw, not post and eat a 401");
	assert.match(threw.message, /REFUSED before sending/);
	assert.match(
		threw.message,
		/DURIG_VERIFIER_API_KEY/,
		"the refusal must name the variable to set, the way every other refusal on this rig does",
	);
	assert.equal(seen.length, before, "no request may reach the wire");
	// loopback stays keyless on purpose: it is the rig's own server and it costs nothing
	const local = await meteredChat({
		baseUrl: STUB,
		body: { model: "iq3_s", messages: [{ role: "user", content: "x" }], max_tokens: 8 },
		env: {},
		ledgerFile: LEDGER,
	});
	assert.equal(local.auth.present, false);
	assert.equal(local.ledgerRow.authKeyEnv, null);
}

// ---------------------------------------------------------------- 3. the ceiling stops the call BEFORE it is sent
{
	const before = seen.length;
	fs.rmSync(LEDGER, { force: true });
	fs.appendFileSync(LEDGER, JSON.stringify({ at: "x", model: "m", usd: 0.09 }) + "\n");
	let threw = null;
	try {
		await meteredChat({
			baseUrl: STUB,
			body: {
				model: "openai/gpt-oss-120b",
				messages: [{ role: "user", content: "y".repeat(3000) }],
				max_tokens: 4000,
			},
			env: {
				[CEILING_ENV]: "0.10",
				[PRICE_IN_ENV]: "55",
				[PRICE_OUT_ENV]: "260",
				[KEY_ENV_ORDER[0]]: "k",
			},
			ledgerFile: LEDGER,
		});
	} catch (e) {
		threw = e;
	}
	assert.ok(threw instanceof CeilingError, `expected a CeilingError, got ${threw}`);
	assert.match(threw.message, /REFUSED before sending/);
	assert.match(threw.message, /ceiling \$0\.100000/);
	assert.equal(
		seen.length,
		before,
		"a ceiling that reports AFTER the call is a receipt, not a guard: the stub must see nothing",
	);
	// and the same call, comfortably under the ceiling, goes through
	const ok = await meteredChat({
		baseUrl: STUB,
		body: {
			model: "openai/gpt-oss-120b",
			messages: [{ role: "user", content: "hi" }],
			max_tokens: 24,
		},
		env: {
			[CEILING_ENV]: "0.10",
			[PRICE_IN_ENV]: "55",
			[PRICE_OUT_ENV]: "260",
			[KEY_ENV_ORDER[0]]: "k",
		},
		ledgerFile: LEDGER,
	});
	assert.equal(ok.status, 200, "the guard must not block a call it cannot fault");
}

// ---------------------------------------------------------------- 4. an UNPRICED call under a declared ceiling is refused too
{
	const before = seen.length;
	let threw = null;
	try {
		await meteredChat({
			baseUrl: STUB,
			body: { model: "no/such-price", messages: [{ role: "user", content: "hi" }], max_tokens: 24 },
			env: { [CEILING_ENV]: "0.10", [KEY_ENV_ORDER[0]]: "k" },
			ledgerFile: LEDGER,
		});
	} catch (e) {
		threw = e;
	}
	assert.ok(
		threw instanceof CeilingError,
		`unknown price + declared ceiling must refuse, got ${threw}`,
	);
	assert.match(threw.message, /price of no\/such-price is UNKNOWN \(priceSource=none\)/);
	assert.equal(seen.length, before, "still nothing on the wire");
	// with no ceiling declared, the same call is ACCOUNTED with an unknown cost rather than blocked
	const free = await meteredChat({
		baseUrl: STUB,
		body: { model: "no/such-price", messages: [{ role: "user", content: "hi" }], max_tokens: 24 },
		env: { [KEY_ENV_ORDER[0]]: "k" },
		ledgerFile: LEDGER,
	});
	assert.equal(
		free.ledgerRow.usd,
		null,
		"unknown cost is null, never 0 — a 0 in a cost report reads as cheap",
	);
	assert.equal(free.ledgerRow.priceSource, "none");
}

// ---------------------------------------------------------------- 5. the ledger line shape is pinned
{
	fs.rmSync(LEDGER, { force: true });
	const r = await meteredChat({
		baseUrl: STUB,
		body: {
			model: "openai/gpt-oss-20b",
			messages: [{ role: "user", content: "hi" }],
			max_tokens: 24,
		},
		env: { [PRICE_IN_ENV]: "0.05", [PRICE_OUT_ENV]: "0.25", [KEY_ENV_ORDER[0]]: "k" },
		ledgerFile: LEDGER,
	});
	const row = readLedger(LEDGER)[0];
	assert.deepEqual(row, r.ledgerRow, "what the caller gets is what the file holds");
	assert.deepEqual(
		Object.keys(row),
		[
			"at",
			"model",
			"host",
			"authKeyEnv",
			"prompt_tokens",
			"completion_tokens",
			"reasoning_tokens",
			"cached_tokens",
			"priceSource",
			"priceAsOf",
			"usd",
			"totalBefore",
			"totalAfter",
			"status",
		],
		"the ledger line is a REPORT format; changing a field is a schema change and must be said out loud",
	);
	assert.equal(typeof row.at, "string");
	assert.equal(row.model, "openai/gpt-oss-20b");
	assert.equal(row.host, new URL(STUB).host);
	assert.equal(row.prompt_tokens, 115);
	assert.equal(row.completion_tokens, 24);
	assert.equal(
		row.reasoning_tokens,
		7,
		"reasoning tokens are recorded: a thinking model's spend IS its reasoning tokens",
	);
	assert.equal(row.cached_tokens, 0);
	assert.equal(row.priceSource, "env");
	assert.equal(row.usd, Number(((115 * 0.05 + 24 * 0.25) / 1e6).toFixed(6)));
	assert.equal(row.totalBefore, 0);
	assert.equal(row.totalAfter, row.usd);
	assert.equal(row.status, 200);
}

// ---------------------------------------------------------------- 6. the printed per-run total
{
	fs.rmSync(LEDGER, { force: true });
	fs.appendFileSync(LEDGER, JSON.stringify({ model: "a", usd: 0.01 }) + "\n");
	fs.appendFileSync(LEDGER, JSON.stringify({ model: "b", usd: 0.02 }) + "\n");
	fs.appendFileSync(LEDGER, JSON.stringify({ model: "c", usd: null, priceSource: "none" }) + "\n");
	const totals = spendTotalUsd(LEDGER);
	assert.equal(totals.totalUsd, 0.03);
	assert.equal(totals.rows, 3);
	assert.equal(
		totals.unknownCostRows,
		1,
		"an unpriced row must be COUNTED as unknown, not folded into the money",
	);
	const line = formatRunTotal({
		rows: totals.rows,
		totalUsd: totals.totalUsd,
		unknownCostRows: totals.unknownCostRows,
		ceilingUsd: 0.1,
	});
	assert.match(line, /spend: 3 accounted call\(s\), total \$0\.0300/);
	assert.match(line, /1 call\(s\) with UNKNOWN cost/);
	assert.match(line, /ceiling \$0\.1000/);
	const unarmed = formatRunTotal({ rows: 0, totalUsd: 0, unknownCostRows: 0, ceilingUsd: 0 });
	assert.match(
		unarmed,
		/no DURIG_PROBE_CEILING_USD declared/,
		"the absence of a guard is a fact the report states, not a silence",
	);
}

// ---------------------------------------------------------------- 7. price sources are named, and projection is declared crude
{
	const env = { [PRICE_IN_ENV]: "1", [PRICE_OUT_ENV]: "2" };
	assert.equal(priceFor("m", env).priceSource, "env");
	assert.equal(priceFor("m", {}).priceSource, "none");
	const snapshot = path.join(tmp, "prices.json");
	fs.writeFileSync(
		snapshot,
		JSON.stringify({
			fetchedAt: "2026-11-02",
			data: [
				{
					id: "m",
					metadata: {
						pricing: { input_tokens: 0.055, output_tokens: 0.26, cache_read_tokens: 0.02 },
					},
				},
			],
		}),
	);
	const snap = priceFor("m", { [mod.PRICE_JSON_ENV]: snapshot });
	assert.equal(
		snap.priceSource,
		`snapshot:${snapshot}`,
		"a snapshot price must say it came from a snapshot — curated lists drift (#5014)",
	);
	assert.equal(snap.priceAsOf, "2026-11-02");
	assert.equal(
		costUsd({
			price: snap.price,
			usage: {
				prompt_tokens: 100,
				completion_tokens: 100,
				prompt_tokens_details: { cached_tokens: 40 },
			},
		}),
		Number(((60 * 0.055 + 40 * 0.02 + 100 * 0.26) / 1e6).toFixed(6)),
		"cached tokens are billed at the cache rate",
	);
	assert.equal(projectCostUsd({ price: null, body: { max_tokens: 10 } }), null);
	assert.equal(
		projectCostUsd({
			price: { in: 1, out: 1 },
			body: {
				messages: [
					{ role: "user", content: "abc" },
					{ role: "user", content: "abc" },
				],
				max_tokens: 9,
			},
		}),
		0.000011,
		"projection prices max_tokens as if every token were generated — it is a ceiling input, not a measurement",
	);
	assert.throws(
		() =>
			assertCeiling({
				ceilingUsd: 1,
				spentUsd: 0.9,
				projectedUsd: 0.5,
				model: "m",
				priceSource: "env",
			}),
		CeilingError,
	);
	assert.deepEqual(
		authFor({ DEEPINFRA_API_KEY: "x" }),
		{ present: true, keyEnv: "DEEPINFRA_API_KEY", header: "Bearer x" },
		"the legacy name still works, but only as a fallback",
	);
	assert.equal(
		ledgerPath({}),
		".spike/gate/spend.jsonl",
		"the default ledger lives with the gate transcripts",
	);
}

// ---------------------------------------------------------------- 8. class locks
{
	const here = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
	assert.ok(
		!/from\s+["'][^"']*gate\.mjs["']/.test(here),
		"this demo must not pull gate.mjs in as a module: it has no import guard, so importing it RUNS the gate (GPU time, real API calls). That is why this scorer went untested for 24 runs.",
	);
	const gate = fs.readFileSync(
		path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			"..",
			"tools",
			"model-probes",
			"gate.mjs",
		),
		"utf8",
	);
	assert.ok(
		/from "\.\/metered\.mjs"/.test(gate),
		"gate.mjs must go through metered.mjs — a forked fetch is how the unauthenticated call survived",
	);
	assert.ok(
		!/fetch\(`\$\{baseUrl\}\/chat\/completions`/.test(gate),
		"no probe script may post /chat/completions itself; the accounted path is the only one",
	);
	// the other probes still post their own: measured, registered, and NOT silently half-fixed here
	const others = [
		"calibrate-verifier.mjs",
		"cold-prefill.mjs",
		"stream-probe.mjs",
		"throughput.mjs",
	];
	const unaccounted = others.filter(
		(f) =>
			/chat\/completions/.test(
				fs.readFileSync(
					path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tools", "model-probes", f),
					"utf8",
				),
			) &&
			!/metered\.mjs/.test(
				fs.readFileSync(
					path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tools", "model-probes", f),
					"utf8",
				),
			),
	);
	assert.deepEqual(
		unaccounted,
		others,
		"these probes are still unaccounted; if one is wired, this lock must be narrowed deliberately, not by accident",
	);
}

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(
	`PROBE SPEND-LEDGER PASS (auth attached from ${KEY_ENV_ORDER[0]}; unkeyed-metered refuses with the cause named; ceiling refuses BEFORE the wire — stub saw 0 requests; unknown price under a ceiling refuses; ledger line = 14 pinned fields with priceSource named and unknown cost as null not 0; run total prints accounted/unknown/ceiling; ${4} probe scripts still post their own request and are locked as known-unaccounted)`,
);

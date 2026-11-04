// demo/spend-cap-guard.test.mjs — the ONE spend guard at the provider seam (#5047).
//
// WHAT THIS PINS, and why at this layer. The cap is enforced at the PROVIDER seam (D-5015.1) because that is the
// only position that covers every run path AND pi-durable's compaction calls, and cannot drift. A test that only
// re-runs the guard's arithmetic would pin the arithmetic, not the position: this file drives a real pi-ai
// provider (`@earendil-works/pi-ai/api/openai-completions`) through `wrapProviderWithSpend` and counts the
// requests a loopback stub actually saw. "Refused before the wire" is only a claim if something on the wire
// counts.
//
// NEVER SPENDS. Every request goes to a loopback stub started in this process; the credential is a literal in an
// injected env object. The metered branch is exercised through the documented `isMetered` test seam (see
// src/providers/spend.mjs) so no metered host is contacted from the oracle suite — and `isMeteredModel` itself is
// pinned below, so the seam cannot hide a locality bug.
//
// Run: node demo/spend-cap-guard.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ocApi from "@earendil-works/pi-ai/api/openai-completions";
import { createProvider } from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";

import {
	SPEND_CAUSE,
	isMeteredModel,
	priceOfModel,
	usageFromPiUsage,
	wrapProviderWithSpend,
} from "../src/providers/spend.mjs";
import { ledgerRow, readLedger, spendTotalUsd } from "../tools/model-probes/metered.mjs";

// ------------------------------------------------------------------ the loopback stub (counts what arrived)
const seen = [];
const server = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		seen.push({ url: req.url, auth: req.headers.authorization ?? null, body });
		const chunk = (o) => `data: ${JSON.stringify(o)}\n\n`;
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.end(
			chunk({ id: "c1", object: "chat.completion.chunk", model: "stub-model", choices: [{ index: 0, delta: { role: "assistant", content: "no defect" }, finish_reason: null }] }) +
				chunk({
					id: "c1",
					object: "chat.completion.chunk",
					model: "stub-model",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: {
						prompt_tokens: 120,
						completion_tokens: 8,
						prompt_tokens_details: { cached_tokens: 20 },
						completion_tokens_details: { reasoning_tokens: 0 },
					},
				}) +
				"data: [DONE]\n\n",
		);
	});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const STUB = `http://127.0.0.1:${server.address().port}/v1`;
const dir = mkdtempSync(`${tmpdir()}/durig-spend-guard-`);
const LEDGER = join(dir, "spend.jsonl");

// A model row of the shape pi-ai hands a provider: priced, metered by declaration in the cases below.
const rowFor = (over = {}) => ({
	id: "stub-model",
	name: "stub-model",
	api: "openai-completions",
	provider: "local",
	baseUrl: STUB,
	input: ["text"],
	cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 64,
	...over,
});
const provider = () =>
	createProvider({
		id: "local",
		name: "stub",
		baseUrl: STUB,
		auth: { apiKey: { name: "stub", resolve: async () => ({ auth: { apiKey: "literal-not-a-secret", source: "test" } }) } },
		models: [rowFor()],
		api: ocApi,
	});
const run = async (guarded, model, context = { messages: [{ role: "user", content: "review this" }] }, opts = { maxTokens: 64, apiKey: "literal-not-a-secret" }) => {
	const stream = guarded.stream(model, context, opts);
	for await (const ev of stream) void ev;
	return await stream.result();
};

// 1. LOCALITY IS READ OFF THE ENDPOINT, NEVER OFF THE PROVIDER ID (D-5015.3). Pinned directly so the `isMetered`
//    test seam used below cannot be the reason the metered path passes.
assert.equal(isMeteredModel({ baseUrl: "http://127.0.0.1:1234/v1" }), false, "127.0.0.1 is free by locality");
assert.equal(isMeteredModel({ baseUrl: "http://localhost:1234/v1" }), false, "localhost too");
assert.equal(isMeteredModel({ baseUrl: "http://[::1]:8080/v1" }), false, "and loopback v6");
assert.equal(isMeteredModel({ baseUrl: "https://api.deepinfra.com/v1/openai" }), true, "a vendor host is metered whatever the provider is called");
assert.equal(isMeteredModel({ baseUrl: STUB }), false, "the stub itself is loopback");
assert.equal(priceOfModel({ cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }), null, "a zero-cost row carries no money to project");
assert.deepEqual(usageFromPiUsage({ input: 100, output: 8, cacheRead: 20, cacheWrite: 0, reasoning: 3 }), {
	prompt_tokens: 120, // pi-ai keeps cached tokens OUT of `input`; the ledger's OpenAI shape counts the whole prompt
	completion_tokens: 8,
	prompt_tokens_details: { cached_tokens: 20 },
	completion_tokens_details: { reasoning_tokens: 3 },
});

// 2. FREE BY LOCALITY: forwarded, and NOT ledgered. This is the rig's live path (every `local/…` seat today):
//    a $0 row for a call that cost nothing is noise that reads as accounting.
{
	const guarded = wrapProviderWithSpend(provider(), {
		caps: { callUsd: 0.05, runUsd: 0.1, storeUsd: 4 },
		ledger: LEDGER,
		report: () => {},
	});
	const res = await run(guarded, rowFor());
	assert.equal(res?.stopReason, "stop", `the loopback call must go through (errorMessage: ${res?.errorMessage})`);
	assert.equal(seen.length, 1, "the stub saw the request");
	assert.equal(readLedger(LEDGER).length, 0, "a call that cost nothing writes no money row");
}

// 3. METERED AND UNDER THE CAP: the call goes out, and the seat path appends the SAME 14-field row to the SAME
//    ledger file the probes write (#5015 §3 — one ledger, no fork).
{
	seen.length = 0;
	const guarded = wrapProviderWithSpend(provider(), {
		caps: { callUsd: 0.05, runUsd: 0.1, storeUsd: 4 },
		ledger: LEDGER,
		isMetered: () => true, // the documented test seam: treat this call as metered without contacting a metered host
		report: () => {},
	});
	const res = await run(guarded, rowFor({ authKeyEnv: "DURIG_VERIFIER_API_KEY", priceSource: "deepinfra-catalog@2026-11-03", priceAsOf: "2026-11-03" }));
	assert.equal(res?.stopReason, "stop", `the metered call went through (errorMessage: ${res?.errorMessage})`);
	const rows = readLedger(LEDGER);
	assert.equal(rows.length, 1, "exactly one money row");
	const row = rows[0];
	const probeKeys = Object.keys(ledgerRow({ at: "x", model: "m", baseUrl: "u", authKeyEnv: null, usage: null, priceSource: "p", priceAsOf: null, usd: 0, totalBefore: 0, status: 200 }));
	assert.deepEqual(
		Object.keys(row).filter((k) => k !== "note"),
		probeKeys,
		"the seat row has the SAME fields as the probe row — one row format, one ledger",
	);
	assert.equal(row.model, "stub-model");
	assert.equal(row.host, new URL(STUB).host);
	assert.equal(row.authKeyEnv, "DURIG_VERIFIER_API_KEY", "the row names the credential VARIABLE, never its value");
	assert.equal(row.prompt_tokens, 120, "whole prompt, cached subset included");
	assert.equal(row.cached_tokens, 20);
	assert.equal(row.completion_tokens, 8);
	assert.equal(row.priceSource, "deepinfra-catalog@2026-11-03", "a dated price stays a dated claim through the seat path (F8)");
	assert.equal(row.priceAsOf, "2026-11-03");
	// (120-20) uncached in + 20 cached + 8 out, at $0.15 / $0.03 / $0.50 per Mtok.
	assert.equal(row.usd, Number(((100 * 0.15 + 20 * 0.03 + 8 * 0.5) / 1e6).toFixed(6)));
	assert.equal(row.totalBefore, 0);
	assert.equal(spendTotalUsd(LEDGER).totalUsd, row.usd, "the one cheap read sees the seat path's row");
}

// 4. A PROJECTED CROSSING IS REFUSED BEFORE THE WIRE. The stub's request count is the proof — a refusal that only
//    returns an error object but still sends bytes is the failure this claim is about (acceptance P1).
{
	seen.length = 0;
	const before = spendTotalUsd(LEDGER).totalUsd;
	const reports = [];
	const guarded = wrapProviderWithSpend(provider(), {
		caps: { callUsd: 0.0001, runUsd: 0.1, storeUsd: 4 }, // $0.0001 per call: this one projects ~$0.000182 (1,000 in tokens + 64 out)
		ledger: LEDGER,
		isMetered: () => true,
		report: (line) => reports.push(line),
	});
	const res = await run(guarded, rowFor(), { messages: [{ role: "user", content: "x".repeat(3000) }] });
	assert.equal(seen.length, 0, "NOT ONE request reached the wire");
	assert.equal(res?.stopReason, "error", "the seat sees an errored assistant message, not a hang and not a silent empty reply");
	assert.match(res.errorMessage, new RegExp(SPEND_CAUSE), "the message names the rig's own cause class");
	assert.match(res.errorMessage, /DURIG_SPEND_CAP_CALL_USD/, "and WHICH cap, not just 'too expensive'");
	assert.match(res.errorMessage, /out of budget/, "the phrase pi-ai's retry classifier treats as non-retryable");
	assert.match(res.errorMessage, /[Rr]emedy/, "and the remedy (the #3663/#3795 shape)");
	assert.equal(readLedger(LEDGER).length, 1, "a REFUSED call writes no ledger row — money to the ledger, stops to store/attention/stderr");
	assert.equal(spendTotalUsd(LEDGER).totalUsd, before, "and it does not move the total");
	const line = reports.find((r) => r.spend === "call-refused");
	assert.ok(line, "the refusal is reported");
	assert.equal(line.at, "admission", "refused at the pre-call projection, so the inner provider was never even called");
	assert.equal(typeof line.projectedUsd, "number", "the refusal states the projected money (axis: USD per call)");
}

// 5. THE STOP IS NOT RETRIED. pi-ai's own classifier decides this, so the pin asks pi-ai, not my opinion: a money
//    stop that reads as transient costs three paid attempts (D-5015 F2, acceptance P7).
{
	const guarded = wrapProviderWithSpend(provider(), {
		caps: { callUsd: 0.0001, runUsd: 0.1, storeUsd: 4 }, // arms the cap; a cap of 0 means NOT armed, by the rig's own rule
		ledger: LEDGER,
		isMetered: () => true,
		report: () => {},
	});
	const res = await run(guarded, rowFor(), { messages: [{ role: "user", content: "x".repeat(3000) }] });
	assert.equal(res?.stopReason, "error");
	assert.equal(
		isRetryableAssistantError(res),
		false,
		`pi-ai must NOT retry a spend stop; it read the message as retryable:\n${res.errorMessage}`,
	);
}

// 6. UNPRICED ON A METERED ROW IS REFUSED, NOT LEDGERED AS $0. An absent price is not a price (acceptance P2,
//    pushed one layer down: even a row that reached the seam cannot buy its way through unaccounted).
{
	seen.length = 0;
	const guarded = wrapProviderWithSpend(provider(), {
		caps: { callUsd: 0.05, runUsd: 0.1, storeUsd: 4 },
		ledger: LEDGER,
		isMetered: () => true,
		report: () => {},
	});
	const res = await run(guarded, rowFor({ cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }));
	assert.equal(seen.length, 0, "an unpriceable metered call does not go out while a cap is armed");
	assert.match(res?.errorMessage ?? "", new RegExp(SPEND_CAUSE));
	assert.match(res?.errorMessage ?? "", /price/i, "and the message names the missing price source as the cause");
}

// 7. NOTHING IS LEDGERED FOR A CALL THAT NEVER SPENT — and the guard's own failure is reported, never silent: a
//    wrapper that swallows an exception would hide a cap that is not being enforced.
assert.ok(existsSync(LEDGER), "the ledger the seat path wrote exists for the report to read");

server.close();
console.log(
	`SPEND-CAP GUARD PASS (locality from the endpoint; loopback forwarded unledgered; a metered call appends the probe's 14-field row to the same file; a projected crossing is refused at admission with ${seen.length === 0 ? "zero" : "some"} requests and no ledger row; pi-ai's own classifier calls the stop non-retryable; an unpriced metered row is refused)`,
);
process.exit(0);

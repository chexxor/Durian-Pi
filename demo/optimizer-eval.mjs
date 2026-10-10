// Effectiveness benchmark for the instruction optimizer.
//
// Measures, over a fixed case set:
//   1. preservation  - mechanical: did the rewrite lose/invent hard facts?
//                      (violations here are AUTO-REJECTED by the guard, so
//                      this also reports how often the safeguard fired)
//   2. blind judging - a DIFFERENT model compares draft vs optimized without
//                      knowing which is which; win/tie/loss rates
//
// Run OFFLINE (proves harness mechanics; scores are meaningless):
//   node demo/optimizer-eval.mjs
// Run FOR REAL (this is the actual effectiveness measurement):
//   DURIG_PROVIDER=deepinfra DEEPINFRA_API_KEY=... node demo/optimizer-eval.mjs
//   [opt] DURIG_JUDGE_MODEL=<id>  judge with a different model than DURIG_MODEL
//
// Exit 0 always when the harness itself runs; the VERDICT line is the read.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import * as ocApi from "@earendil-works/pi-ai/api/openai-completions";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
} from "@earendil-works/pi-ai/providers/faux";
import {
	readFileSync,
} from "node:fs";
import {
	BASE_URL,
	DEEPINFRA_COMPAT,
	PROVIDER_ID,
	fallbackModels,
} from "../../vendor/pi-deepinfra/models.ts";
import { analyzePreservation, optimizeInstruction } from "../src/optimizer.mjs";
import { judgePair } from "../src/judge.mjs";

let fauxProviderRef = null;
const MODEL_ID = process.env.DURIG_MODEL ?? "zai-org/GLM-5.3-Flash";
const JUDGE_MODEL_ID = process.env.DURIG_JUDGE_MODEL ?? MODEL_ID;

// Benchmark cases: realistic durig-domain drafts with deliberate flaws
// (vague goals, buried constraints, filler). Kind selects the optimizer's
// framing (persona fragment vs work request).
const CASES = [
	{ kind: "instruction", text: "You are basically like a helper who assists with various things around the project and stuff. Try to be helpful and do what needs doing when needed." },
	{ kind: "instruction", text: "Role: reviewer. Look at changes people make. Comment on them. Things to consider: correctness, style maybe, tests if there are any. Never approve changes that lack a test." },
	{ kind: "work_request", text: "Hi! So we need that login widget thing built sometime soon-ish, it should look nice and work with the existing auth stuff. Oh and it needs to handle at least 5 failed attempts before lockout." },
	{ kind: "work_request", text: "Please refactor module X to be faster. It is currently slow. Make it better performance-wise without breaking anything obviously." },
	{ kind: "instruction", text: "You document APIs. Write docs for endpoints. Include examples probably. Docs must cite the actual source file for every endpoint documented." },
	{ kind: "work_request", text: "Migrate the config loader to TOML. Keep supporting env var overrides exactly as now (3 override levels). Tests must still pass." },
];

function buildModels() {
	if ((process.env.DURIG_PROVIDER ?? "faux") === "faux") {
		fauxProviderRef = fauxProvider({ models: [{ id: MODEL_ID }, { id: JUDGE_MODEL_ID }] });
		const models = createModels();
		models.setProvider(fauxProviderRef.provider);
		return { models, providerId: "faux" };
	}
	const key = process.env.DEEPINFRA_API_KEY;
	if (!key) throw new Error("DEEPINFRA_API_KEY required for deepinfra mode");
	const deepinfra = createProvider({
		id: PROVIDER_ID,
		name: "DeepInfra",
		baseUrl: BASE_URL,
		auth: {
			apiKey: {
				name: "DeepInfra API key",
				resolve: async () => ({ auth: { apiKey: key }, source: "env" }),
			},
		},
		models: (() => {
			const base = fallbackModels();
			const ids = new Set(base.map((m) => m.id));
			const extra = [MODEL_ID, JUDGE_MODEL_ID]
				.filter((id) => !ids.has(id))
				.map((id) => ({
					id,
					name: id,
					api: "openai-completions",
					provider: PROVIDER_ID,
					baseUrl: BASE_URL,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128_000,
					maxTokens: 8_192,
					...DEEPINFRA_COMPAT,
				}));
			return [...base, ...extra];
		})(),
		api: ocApi,
	});
	const models = createModels({
		authContext: {
			env: async (name) => process.env[name],
			fileExists: async () => false,
		},
	});
	models.setProvider(deepinfra);
	return { models, providerId: PROVIDER_ID };
}

async function main() {
	const { models, providerId } = buildModels();
	if (providerId === "faux") {
		const faux = fauxProviderRef;
		// Deterministic offline script: per case, the optimizer rewrite then
		// the judge verdict. Alternating winners exercises every tally path.
		const script = [];
		for (const [i] of CASES.entries()) {
			script.push(fauxAssistantMessage(fauxText(`OPTIMIZED CASE ${i + 1}`)));
			const winner = i % 2 === 0 ? "A" : "B";
			script.push(fauxAssistantMessage(fauxText(JSON.stringify({
				a: { clarity: 3, completeness: 3, actionability: 3 },
				b: { clarity: 4, completeness: 4, actionability: 4 },
				overall: winner,
				reason: "canned",
			}))));
		}
		faux.setResponses(script);
	}
	const optimizerRef = { provider: providerId, modelId: MODEL_ID };
	const judgeRef = { provider: providerId, modelId: JUDGE_MODEL_ID };

	const rows = [];
	for (const [i, testCase] of CASES.entries()) {
		const row = { case: i + 1, kind: testCase.kind };
		try {
			const result = await optimizeInstruction(models, optimizerRef, testCase.text, {
				kind: testCase.kind,
			});
			row.rejected = result.rejected;
			if (result.rejected) {
				row.violations = result.violations;
				row.inventions = result.inventions;
				row.note = "guard rejected rewrite; raw used";
			}
			// Judged even when rejected: raw-vs-raw should tie (a sanity check
			// on the judge itself), and it keeps scripted-response alignment.
			const verdict = await judgePair(models, judgeRef, testCase.text, result.optimized);
			row.winner = verdict.winner;
			row.reason = verdict.reason;
		} catch (err) {
			row.error = String(err?.message ?? err).slice(0, 200);
			row.winner = "error";
		}
		rows.push(row);
		console.log(JSON.stringify(row));
	}

	const okRows = rows.filter((r) => r.winner !== "error");
	const wins = okRows.filter((r) => r.winner === "optimized").length;
	const losses = okRows.filter((r) => r.winner === "draft").length;
	const tiesCount = okRows.filter((r) => r.winner === "tie").length;
	const rejections = rows.filter((r) => r.rejected).length;
	const errorsN = rows.length - okRows.length;

	console.log("---- VERDICT ----");
	console.log(`cases=${rows.length} optimized_wins=${wins} draft_wins=${losses} ties=${tiesCount} guard_rejections=${rejections} harness_errors=${errorsN}`);
	if ((process.env.DURIG_PROVIDER ?? "faux") === "faux") {
		console.log("NOTE: faux mode proves harness mechanics only; scores are canned. Run with DURIG_PROVIDER=deepinfra for the real measurement.");
	}
}

main().catch((err) => {
	console.error("EVAL FAILED:", err?.stack ?? err);
	process.exit(1);
});

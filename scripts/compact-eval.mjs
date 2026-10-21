// scripts/compact-eval.mjs - operator-costed measurement runs for the
// compaction evaluation harness (#1087, ROADMAP 97). The ENGINE is
// src/compacteval.mjs (offline-proven by demo/compacteval.test.mjs); this
// script is its LIVE seam, and every mode that can spend provider tokens
// prints its COST ESTIMATE first and needs --yes to fire.
//
// Subcommands:
//   window - EFFECTIVE WINDOW sweep: a deterministic synthetic transcript
//            with planted needles, probed at several lengths against the
//            configured provider; reports per-length probe results, the
//            first-failure boundary, and the MECW-style lower bound item 27
//            consumes (NOT the advertised contextWindow).
//   item   - compacted-vs-full delta on a REAL past item: copies the store
//            to TEMP, scans a seat's REAL records from the COPY (the
//            original store is never opened for write; D11: a reader must
//            not schedule), runs a REAL manual compaction on the COPY, then
//            fires the probe set at both context levels and judges blind
//            with a different-family model.
//
// Examples:
//   node scripts/compact-eval.mjs window --lengths 64k,128k,300k --dry
//   node scripts/compact-eval.mjs item --seat impl --dry
//   node scripts/compact-eval.mjs item --seat impl --yes --judge Qwen/Qwen3.6-35B-A3B --out delta.json

import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import * as ocApi from "@earendil-works/pi-ai/api/openai-completions";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CompactionEntry, createRegistry, Harness } from "@earendil-works/pi-durable";

import {
	artifactProbe,
	entryMessages,
	evalCompactionDelta,
	messagesText,
	buildHaystack,
	recallProbe,
	sweepWindow,
} from "../src/compacteval.mjs";
import { BASE_URL, DEEPINFRA_COMPAT, PROVIDER_ID, fallbackModels } from "../src/providers/deepinfra-models.ts";
import { readSeatList } from "../src/readapi.mjs";

const ctx = BACKGROUND_CONTEXT;

function usage(code = 2) {
	console.error(`usage:
  node scripts/compact-eval.mjs window [--lengths 64k,128k,300k] [--model <deepinfra-id>]
                                       [--seed 97] [--dry] [--yes] [--out <report.json>]
  node scripts/compact-eval.mjs item --seat <seat-name> [--store <path>] [--limit 400]
                                     [--instructions "<text>"] [--judge <model-id>] [--out <report.json>]
  (no --yes = dry run: estimates only, nothing spent; --store defaults to DURIG_DB and is ALWAYS COPIED to TEMP)`);
	process.exit(code);
}

const argv = process.argv.slice(2);
const sub = argv[0];
if (sub !== "window" && sub !== "item") usage();
const flag = (name, fallback) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] ?? usage() : fallback;
};
const hasFlag = (name) => argv.includes(name);
const parseFloatk = (spec) =>
	String(spec ?? "")
		.split(",")
		.filter(Boolean)
		.map((s) => {
			const m = /^([0-9.]+)(k|m)?$/i.exec(s.trim());
			if (!m) usage();
			return Math.round(Number(m[1]) * (m[2] ? (m[2].toLowerCase() === "m" ? 1_000_000 : 1000) : 1));
		});

const envModelId = process.env.DURIG_MODEL ?? "";

/** The DeepInfra provider, built exactly as cli.mjs builds it. */
function buildLiveModels(modelId) {
	if (!modelId) throw new Error("no model id: set DURIG_MODEL or pass --model");
	const deepinfra = createProvider({
		id: PROVIDER_ID,
		name: "DeepInfra",
		baseUrl: BASE_URL,
		auth: {
			apiKey: {
				name: "DeepInfra API key",
				resolve: async () => {
					const key = process.env.DEEPINFRA_API_KEY;
					if (!key) return undefined;
					return { auth: { apiKey: key }, source: "DEEPINFRA_API_KEY" };
				},
			},
		},
		models: (() => {
			const base = fallbackModels();
			if (base.some((m) => m.id === modelId)) return base;
			return [
				...base,
				{
					id: modelId,
					name: modelId,
					api: "openai-completions",
					provider: PROVIDER_ID,
					baseUrl: BASE_URL,
					input: ["text"],
					cost: { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 },
					contextWindow: 1_048_576,
					maxTokens: 8_192,
					...DEEPINFRA_COMPAT,
				},
			];
		})(),
		api: ocApi,
	});
	const models = createModels({ authContext: { env: async (name) => process.env[name], fileExists: async () => false } });
	models.setProvider(deepinfra);
	return models;
}

const priceOf = (models, modelId) => {
	const m = models.getModel(PROVIDER_ID, modelId);
	return {
		input: m?.cost?.input ?? null, // $/1M tokens, captured 2026-10-11 in the vendored catalog
		output: m?.cost?.output ?? null,
		ctx: m?.contextWindow ?? null,
		maxOut: m?.maxTokens ?? null,
	};
};
const usdLabel = (tokens, price) => (tokens == null || price == null ? "" : ` (~$${((tokens / 1_000_000) * price).toFixed(4)})`);

/** The `ask` seam: one real request per probe. */
function buildAsk(models, { modelId } = {}) {
	return async ({ messages, question }) => {
		const model = models.getModel(PROVIDER_ID, modelId ?? envModelId);
		if (!model) throw new Error(`answer model not found: ${PROVIDER_ID}/${modelId ?? envModelId}`);
		const message = await models.completeSimple(model, { messages: [...messages, { role: "user", content: question }] }, { maxTokens: 400 });
		const reply = (message.content ?? []).filter((p) => p?.type === "text").map((p) => p?.text ?? "").join("\n");
		return { reply, usage: message.usage ?? null };
	};
}

/* ------------------------------------------------------------------ window */

async function runWindow(opts) {
	const models = buildLiveModels(opts.modelId);
	const priced = priceOf(models, opts.modelId);
	console.log(`window sweep | model=${opts.modelId} seed=${opts.seed} lengths=${opts.lengths.join(",")}`);
	console.log(`advertised: contextWindow=${priced.ctx ?? "?"} maxOut=${priced.maxOut ?? "?"} | vendored pricing: $${priced.input ?? "?"}/M in, $${priced.output ?? "?"}/M out`);

	let total = 0;
	for (const L of opts.lengths) {
		const { estimatedTokens } = buildHaystack({ targetTokens: L, seed: opts.seed });
		total += estimatedTokens * opts.probesPerLength;
		console.log(`  length ${L}: ~${estimatedTokens} tokens x ${opts.probesPerLength} probes` + usdLabel(estimatedTokens * opts.probesPerLength, priced.input));
	}
	console.log(
		`ESTIMATED total input: ~${total} tokens` + usdLabel(total, priced.input) +
			` (cache hits only LOWER this; ~${opts.lengths.length * opts.probesPerLength} short replies out)`,
	);
	if (opts.dry || !opts.yes) {
		console.log("DRY RUN - nothing spent. Pass --yes to fire.");
		return 0;
	}
	const result = await sweepWindow({ lengthsTokens: opts.lengths, seed: opts.seed, ask: buildAsk(models, { modelId: opts.modelId }) });
	for (const row of result.rows) {
		console.log(
			`  length ${row.targetTokens}: ${row.probeHits}/${row.probes} probes` +
				(row.misses.length ? ` MISSES: ${row.misses.map((m) => `${m.kind} (${m.detail})`).join("; ")}` : " - all passed") +
				(row.reportedUsage ? ` | last-request reported input=${row.reportedUsage.input} cacheRead=${row.reportedUsage.cacheRead}` : ""),
		);
	}
	console.log(`BOUNDARY (first failing length): ${result.boundaryTokens ?? "none - all probed lengths passed"}`);
	console.log(`EFFECTIVE-WINDOW LOWER BOUND (MECW-style; item 27 consumes THIS): ${result.effectiveWindowLowerBound ?? "none - the smallest probed length already failed"}`);
	if (opts.out) {
		writeFileSync(opts.out, JSON.stringify(result, null, 2));
		console.log(`report written: ${opts.out}`);
	}
	return 0;
}
/** A REAL manual compaction plus delta probes over a seat's REAL records (on the COPY). */
async function runItem(opts) {
	const store = opts.store ?? process.env.DURIG_DB ?? "";
	if (!store || !existsSync(store)) {
		console.error(`no store at ${store} - pass --store or set DURIG_DB`);
		return 2;
	}
	const dir = mkdtempSync(join(tmpdir(), "compact-eval-item-"));
	const copy = join(dir, "store-copy.sqlite");
	copyFileSync(store, copy);

	// (1) read-only recon from the COPY (no harness open - D11: never schedule).
	let recon = null;
	{
		const storage = await openNodeSqliteStorage(copy);
		try {
			const seats = await readSeatList(storage);
			const seat = seats.find((s) => s.name === opts.seat);
			if (!seat) {
				console.error(`unknown seat ${opts.seat}; seats: ${seats.map((s) => s.name).join(", ")}`);
				return 1;
			}
			const items = await scanAll(storage, seat.conversationId, opts.limit);
			const markers = items.filter((e) => e.kind === CompactionEntry.kind && typeof e.head === "number");
			const firstHead = markers.at(0)?.head ?? null;
			const zone = items.filter((e) => (e.kind === "pi.user" || e.kind === "pi.assistant") && (firstHead === null || e.id < firstHead));
			const zoneText = zone.map((e) => messagesText(entryMessages(e))).join("\n");
			const est = items.reduce((n, e) => n + entryMessages(e).reduce((k, m) => k + Math.max(1, Math.ceil(JSON.stringify(m?.content ?? "").length / 3.5)), 0), 0);
			const needles = [...String(zoneText).matchAll(/`([^`\n]{12,90})`/g)].map((m) => m[1]).slice(0, 1);
			const paths = harvestPaths(zoneText).slice(0, 3);
			recon = { seat, counts: { total: items.length, estTokens: est, zone: zone.length }, needles, paths };
		} finally {
			await storage.close();
		}
	}
	// qa #1573: the ESTIMATE needs no live model - a model id is required only to FIRE (or to
	// price the estimate in USD). Build the provider when we will fire, or when DURIG_MODEL is
	// set for a priced estimate; a bare dry run now succeeds with the token estimate alone.
	const willFire = !(opts.dry || !opts.yes);
	const models = willFire || envModelId ? buildLiveModels(envModelId) : null;
	const priced = models ? priceOf(models, envModelId) : null;
	const probeReplies = (recon.needles.length + recon.paths.length + 1) * 2;
	const estTokens = recon.counts.estTokens * 2 + recon.counts.estTokens;
	console.log(`item delta | seat=${opts.seat} records=${recon.counts.total} (~${recon.counts.estTokens} est tokens)`);
	console.log(`expectations from the dropped zone: ${recon.needles.length} needle(s), ${recon.paths.length} path(s)`);
	console.log(
		priced
			? `cost: 1 summarizer call + ~${probeReplies} probe replies ${usdLabel(estTokens, priced.input)} (upper estimate; cache only lowers)`
			: `cost: 1 summarizer call + ~${probeReplies} probe replies, ~${estTokens} est tokens (set DURIG_MODEL for a USD estimate)`,
	);
	if (!willFire) {
		console.log(`DRY RUN - store copy at ${copy}; pass --yes to fire`);
		return 0;
	}

	// (2) the REAL run on the COPY: WRITER harness + manual compaction + probes.
	const harness = await Harness.open(await openNodeSqliteStorage(copy), { models, registry: createRegistry() }, ctx);
	try {
		const conv = await harness.conversation(recon.seat.conversationId, ctx);
		const watermark = (await conv.entries({ order: "descending" }, 1, undefined, ctx)).items.at(0)?.id ?? 0;

		await harness.resume();
		const taskId = await conv.compact(opts.instructions, ctx);
		await harness.waitForTask(taskId, ctx);

		// (3) re-scan; the NEWEST marker past the watermark is THIS run's.
		const all = await scanAll(conv, recon.counts.total + 8);
		const marker = all.filter((e) => e.kind === CompactionEntry.kind && e.id > watermark).at(-1);
		if (!marker) {
			console.error("no pi.compaction entry was placed on the COPY (nothing to compact) - not a measurement");
			return 1;
		}
		const summaryRaw = String(entryMessages(marker).at(0)?.content?.find?.((p) => p?.type === "text")?.text ?? "").replace(SUMMARY_PREFIX, "").replace("\n</summary>", "");
		console.log(`compaction placed: entry ${marker.id} (head=${marker.head}); raw summary ${summaryRaw.length} chars`);

		// (4) the delta: FULL = everything minus this marker; COMPACTED = with it.
		const probes = [
			...recon.needles.slice(0, 1).map((needle) => recallProbe({ needle })),
			...(recon.paths.length ? [artifactProbe({ paths: recon.paths })] : []),
			{
				kind: "continuation",
				question: "One single action should logically come next in this conversation. Name it in one sentence.",
				grade(reply) {
					const ok = String(reply ?? "").trim().length > 20;
					return { ok, detail: ok ? "substantive reply" : "empty or trivial reply" };
				},
			},
		];
		const answer = buildAsk(models);
		const judge = { models, judgeRef: { provider: PROVIDER_ID, modelId: opts.judge ?? "Qwen/Qwen3.6-35B-A3B" } };
		const result = await evalCompactionDelta({
			fullEntries: all.filter((e) => e.id !== marker.id),
			compactedEntries: all,
			probes,
			answer,
			judge,
		});

		// (5) the report.
		console.log("\nPER-PROBE (full vs compacted; blind judge corroborates):");
		for (const row of result.rows) {
			console.log(
				`  ${row.kind}: full=${row.fullOk ? "OK" : "MISS"} compacted=${row.compactedOk ? "OK" : "MISS"}` +
					(row.winner ? ` | judge: ${row.winner}` : "") +
					` | ${row.fullDetail} vs ${row.compactedDetail}`,
			);
		}
		console.log(
			`\nDELTA: full ${result.delta.fullPasses}/${result.rows.length} vs compacted ${result.delta.compactedPasses}/${result.rows.length}` +
				` | blind judge: full ${result.delta.judgeFullWins} / compacted ${result.delta.judgeCompactedWins} / tie ${result.delta.judgeTies}`,
		);
		console.log(`(summary entry ${marker.id}, head=${marker.head}; artifact-tracking is the metric ROADMAP 97 says to watch)`);
		if (opts.out) {
			writeFileSync(opts.out, JSON.stringify({ ...result, summaryEntryId: marker.id, head: marker.head }, null, 2));
			console.log(`report written: ${opts.out}`);
		}
		return 0;
	} finally {
		await harness.close(ctx);
	}
}

async function scanAll(sourceOrConv, conversationIdOrCap, capArg) {
	// Two callers: (storage, conversationId, cap) read-only, and (conv, cap)
	// through the conversation. Normalized here.
	// call shapes: scanAll(conv, cap) - conversation; scanAll(storage, conversationId, cap) - storage.
	// Discriminate by the THIRD argument being defined: the storage call passes 3.
	const isConv = capArg === undefined;
	const cap = isConv ? (conversationIdOrCap ?? 4000) : capArg ?? 4000;
	const scan = isConv
		? (query, limit) => sourceOrConv.entries(query, limit, undefined, ctx)
		: (query, limit) => sourceOrConv.scanEntries({ conversationId: conversationIdOrCap, ...query }, limit, undefined, ctx);
	const items = [];
	let cursor;
	for (;;) {
		const page = await scan(items.length === 0 ? { order: "ascending" } : { order: "ascending", minEntryId: cursor + 1 }, Math.min(500, cap - items.length));
		if (page.items.length === 0) break;
		items.push(...page.items);
		cursor = page.items.at(-1)?.id;
		if (items.length >= cap) break;
	}
	return items;
}

function harvestPaths(text) {
	const out = new Set();
	for (const m of String(text ?? "").matchAll(/(?:src|demo|docs|scripts)\/[\w./-]+\.(?:mjs|js|ts|md|json)/g)) out.add(m[0]);
	return [...out];
}

/* ---------------------------------------------------------------- dispatch */

try {
	if (sub === "window") {
		process.exit(
			await runWindow({
				lengths: parseFloatk(flag("--lengths", "64k,128k,256k")),
				modelId: flag("--model", envModelId),
				seed: Number(flag("--seed", "97")),
				probesPerLength: 3, // sweepProbes().length
				dry: hasFlag("--dry"),
				yes: hasFlag("--yes"),
				out: hasFlag("--out") ? flag("--out") : undefined,
			}),
		);
	} else {
		process.exit(
			await runItem({
				seat: flag("--seat", ""),
				store: hasFlag("--store") ? flag("--store") : undefined,
				limit: Number(flag("--limit", "400")),
				judge: hasFlag("--judge") ? flag("--judge") : undefined,
				instructions: hasFlag("--instructions") ? flag("--instructions") : undefined,
				dry: hasFlag("--dry"),
				yes: hasFlag("--yes"),
				out: hasFlag("--out") ? flag("--out") : undefined,
			}),
		);
	}
} catch (err) {
	console.error(`compact-eval failed: ${err?.message ?? err}`);
	process.exit(1);
}




// VENDORED - do not edit here. Source: pi-deepinfra v0.1.3 (MIT),
// Copyright (c) 2026 puetsua - https://github.com/puetsua/pi-deepinfra
// See ./PROVENANCE.md for why this copy exists, and ./LICENSE.pi-deepinfra
// for the licence it is redistributed under. Line endings were normalised to
// LF to match this tree; nothing else changed.
//
// durig reads the DeepInfra provider catalogue from this module so the provider
// id, base URL, compat flags and fallback model list have exactly one definition.
// It is vendored rather than depended on because durig imports it as a TypeScript
// source file that Node type-strips, and because pi-deepinfra ships as a pi
// extension rather than as a library durig can call.

/**
 * DeepInfra model catalog: fetch + mapping to pi Model<> objects.
 *
 * The catalog endpoint (https://api.deepinfra.com/v1/openai/models) is public
 * and returns everything we need per model: context length, max output tokens,
 * $/1M pricing (including cache_read_tokens on prompt-cache-enabled models),
 * and capability tags (chat / reasoning / vision / prompt_cache).
 */

import type { Model, ModelThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";

export const PROVIDER_ID = "deepinfra";
export const BASE_URL = "https://api.deepinfra.com/v1/openai";
export const CATALOG_URL = `${BASE_URL}/models`;

/** Chat models only — embeddings, image-gen, TTS, STT, video are out of scope. */
const CHAT_TAG = "chat";

export interface DeepInfraCatalogModel {
	id: string;
	name?: string;
	metadata?: {
		description?: string;
		context_length?: number;
		max_tokens?: number;
		pricing?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_read_tokens?: number;
		};
		tags?: string[];
	};
}

export interface DeepInfraCatalog {
	data: DeepInfraCatalogModel[];
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** "deepseek-ai/DeepSeek-V4-Flash-0731" -> "DeepSeek-V4-Flash-0731" */
export function displayName(id: string): string {
	const tail = id.split("/").pop() ?? id;
	return tail;
}

/**
 * Thinking level mapping. DeepInfra's `reasoning_effort` vocabulary is
 * identical to pi's (`minimal..max`) except "off" — DeepInfra uses "none".
 * Values pass through by name, so only "off" needs a mapping.
 */
export const THINKING_LEVEL_MAP: ThinkingLevelMap = { off: "none" };

/**
 * Compatibility flags required by DeepInfra's OpenAI-compatible API
 * (verified against the live endpoint + pi-ai's openai-completions serializer):
 * - maxTokensField: "max_tokens"     (DeepInfra does not use max_completion_tokens)
 * - supportsStore: false             (don't send OpenAI's `store` param)
 * - supportsDeveloperRole: false     (DeepInfra documents system/user/assistant/tool)
 * - supportsReasoningEffort: true    (top-level reasoning_effort param)
 */
export const DEEPINFRA_COMPAT = {
	maxTokensField: "max_tokens",
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: true,
} as const;

/**
 * Compatibility for one DeepInfra model. `thinkingFormat: "deepseek"` is
 * required for DeepSeek models (DeepInfra's Pi integration docs): without it Pi
 * sends the wrong thinking parameter and does not recognise DeepSeek's reasoning
 * stream (sent as `reasoning_content`), so reasoning and tool-call markup can
 * leak into the visible message text instead of the reasoning channel. Applied
 * only to DeepSeek ids, because the flag changes the request shape
 * (`thinking: { type }`) and is not meaningful for other vendors' models.
 */
function compatFor(id: string) {
	return id.startsWith("deepseek-ai/")
		? { ...DEEPINFRA_COMPAT, thinkingFormat: "deepseek" as const }
		: DEEPINFRA_COMPAT;
}

export function mapCatalogModel(raw: DeepInfraCatalogModel): Model<"openai-completions"> {
	const metadata = raw.metadata ?? {};
	const tags = metadata.tags ?? [];
	const pricing = metadata.pricing ?? {};
	const reasoning = tags.includes("reasoning");
	const inputPrice = round4(pricing.input_tokens ?? 0);
	const outputPrice = round4(pricing.output_tokens ?? 0);
	const cacheRead = round4(pricing.cache_read_tokens ?? inputPrice);
	const hasVision = tags.includes("vision") || tags.includes("vlm");

	return {
		id: raw.id,
		name: raw.name ?? displayName(raw.id),
		api: "openai-completions",
		provider: PROVIDER_ID,
		baseUrl: BASE_URL,
		reasoning,
		thinkingLevelMap: reasoning ? THINKING_LEVEL_MAP : undefined,
		input: hasVision ? ["text", "image"] : ["text"],
		cost: { input: inputPrice, output: outputPrice, cacheRead, cacheWrite: 0 },
		contextWindow: metadata.context_length ?? 128_000,
		maxTokens: metadata.max_tokens ?? 4096,
		compat: compatFor(raw.id),
	};
}

/**
 * Fetch and map the live catalog. Throws on network/parse errors.
 *
 * Honors an external abort signal (e.g. pi's session context) in addition to a
 * hard 15s timeout so a stalled catalog request is never able to block the
 * caller for longer than the timeout. Called lazily at session start to swap
 * the live catalog into the provider — never awaited during startup.
 */
export async function fetchDeepInfraModels(signal?: AbortSignal): Promise<Model<"openai-completions">[]> {
	const timeout = AbortSignal.timeout(15_000);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const response = await fetch(CATALOG_URL, { signal: combined });
	if (!response.ok) {
		throw new Error(`catalog fetch failed: HTTP ${response.status}`);
	}
	const catalog = (await response.json()) as DeepInfraCatalog;
	return catalog.data
		.filter((m) => m.metadata?.tags?.includes(CHAT_TAG))
		.map(mapCatalogModel);
}

/**
 * Curated fallback list used when the live catalog cannot be fetched at
 * startup (offline, DNS, etc.). Values captured from the live catalog.
 */
export function fallbackModels(): Model<"openai-completions">[] {
	const entries: Array<[string, number, number, number, number, boolean, boolean]> = [
		// id, ctx, max, $in, $out, reasoning, vision
		["deepseek-ai/DeepSeek-V4-Flash-0731", 1_048_576, 1_048_576, 0.09, 0.18, true, false],
		// Operator-designated worker model for the selfdev rig. It is absent from the
		// captured catalog and the live catalog fetch (`fetchDeepInfraModels`) is not
		// wired into `buildModels`, so without this fallback entry a seat that names it
		// resolves to `no_model` before any request is made. Priced alongside its
		// V4-Flash sibling until the live catalog is wired in.
		["deepseek-ai/DeepSeek-V4.1-Flash", 1_048_576, 1_048_576, 0.14, 0.28, true, false],
		// Operator-designated verifier model (selfdev qa), chosen for DeepInfra uptime
		// after `zai-org/GLM-5.3-Flash` returned persistent 429 engine_overloaded. Values
		// fetched from the live catalogue (2026-10-11): 1M ctx, $0.14/$0.28, reasoning,
		// vision. A different family from the DeepSeek authors, so item 3 diversity holds.
		["XiaomiMiMo/MiMo-V2.6-Flash", 1_048_576, 1_048_576, 0.14, 0.28, true, true],
		// Operator-designated verifier model (selfdev qa), replacing MiMo after it
		// wandered off-task. Values from the live catalogue (2026-10-11): 262K ctx,
		// $0.10/$0.95, reasoning, vision. A different family from the DeepSeek authors.
		["Qwen/Qwen3.6-35B-A3B", 262_144, 262_144, 0.1, 0.95, true, true],
		["zai-org/GLM-5.3-Flash", 1_048_576, 1_048_576, 0.15, 0.5, true, true],
		["deepseek-ai/DeepSeek-V3-0324", 163_840, 163_840, 0.24, 0.9, false, false],
		["deepseek-ai/DeepSeek-R1-0528", 163_840, 163_840, 0.5, 2.15, true, false],
		["Qwen/Qwen3-235B-A22B-Thinking-2507", 262_144, 262_144, 0.23, 2.3, true, false],
		["Qwen/Qwen2.5-72B-Instruct", 32_768, 32_768, 0.36, 0.4, false, false],
		["meta-llama/Llama-3.3-70B-Instruct", 131_072, 131_072, 0.2, 0.32, false, false],
		["meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", 1_048_576, 1_048_576, 0.2, 0.8, false, true],
		["google/gemma-3-27b-it", 131_072, 131_072, 0.08, 0.16, false, true],
		// Operator-designated qa2 model (#1936). Like `DeepSeek-V4.1-Flash` above, it is absent
		// from the captured catalog and `fetchDeepInfraModels` is NOT wired into `buildModels`, so
		// without this entry a seat naming it resolves to `no_model` before any request. Values
		// from the live catalogue (2026-10-18): 256K ctx, $0.20/$0.40, vision+chat.
		// `reasoning: false` is DELIBERATE: the vendor forbids replaying thoughts from previous
		// turns, and pi-durable can persist/replay thinking blocks — false means none are
		// produced or replayed (so no historical thinking can be sent back).
		["google/gemma-4-31B-it", 262_144, 262_144, 0.2, 0.4, false, true],
		["mistralai/Mistral-Small-3.2-24B-Instruct-2506", 131_072, 131_072, 0.075, 0.2, false, false],
		["google/gemini-3.1-pro", 1_000_000, 1_000_000, 2.0, 12.0, true, true],
	];

	return entries.map(([id, contextWindow, maxTokens, input, output, reasoning, vision]) => ({
		id,
		name: displayName(id),
		api: "openai-completions",
		provider: PROVIDER_ID,
		baseUrl: BASE_URL,
		reasoning,
		thinkingLevelMap: reasoning ? THINKING_LEVEL_MAP : undefined,
		input: vision ? (["text", "image"] as const) : (["text"] as const),
		cost: {
			input,
			output,
			cacheRead: input,
			cacheWrite: 0,
		},
		contextWindow,
		maxTokens,
		compat: compatFor(id),
	}));
}

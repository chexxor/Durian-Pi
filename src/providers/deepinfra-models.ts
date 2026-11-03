// src/providers/deepinfra-models.ts — durig's DeepInfra catalogue SEAM: the validated view of the vendored one.
//
// WHY THIS FILE EXISTS (#5047, acceptance probe P6b). The curated fallback list lives in a VENDORED copy of
// pi-deepinfra v0.1.3 (`./vendor/pi-deepinfra/deepinfra-models.ts`, provenance in ../PROVENANCE.md) and its
// prices are hand-maintained, dated only by comments. Diffed against the dated catalog fetch this rig holds,
// that list carried `google/gemini-3.1-pro` at 1,000,000 ctx / $2.00/$12.00 — **$14.00 for ONE maximal call,
// 3.50x the operator's whole $4 grant (D193)** — plus two rows priced >25 % away from the catalog and four rows
// the catalog does not carry at all. No cap at the run or store level prevents the FIRST call from doing that;
// only refusing to register the row does.
//
// THE RULE, stated so it can be audited: a row reaches a seat's provider list only if it is PRICED and its own
// declared geometry cannot spend more than the store cap in one call. Prices come from a DATED source
// (`./deepinfra-prices.json`, stamped `fetchedAt`), never from an undated comment. A refused row is REPORTED on
// stderr with its cause and remedy, and listed by `catalogRefusals()` so `config` can show it.
//
// WHY THE VENDORED FILE STAYS BYTE-IDENTICAL. The review (#5015 §7) allowed two fixes: change the vendored copy
// with a PROVENANCE note and an upstream PR, or put a validation layer on durig's own seam — and preferred the
// second, "because it keeps the vendored file untouched and puts the guard on durig's own seam". So the upstream
// bytes moved to `./vendor/pi-deepinfra/` unmodified, and THIS path — the one every consumer already imports —
// is now durig's, applying durig's policy. Upstream re-copy later is still a straight file replacement.
//
// What is NOT decided here: capacity. `catalogContextWindow`/`catalogMaxTokens` are carried in the dated file so
// a reader can see where the curated geometry and the catalog disagree (Mistral-Small declares 131,072 against
// a catalog 128,000), but nothing here acts on them — the declared window is the operator's lever (D201).

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
	BASE_URL as VENDORED_BASE_URL,
	DEEPINFRA_COMPAT,
	PROVIDER_ID as VENDORED_PROVIDER_ID,
	THINKING_LEVEL_MAP,
	displayName,
	fallbackModels as vendoredFallbackModels,
	fetchDeepInfraModels as vendoredFetch,
	mapCatalogModel,
} from "./vendor/pi-deepinfra/deepinfra-models.ts";

export const PROVIDER_ID = VENDORED_PROVIDER_ID;
export const BASE_URL = VENDORED_BASE_URL;
export const CATALOG_URL = `${BASE_URL}/models`;
export { DEEPINFRA_COMPAT, THINKING_LEVEL_MAP, displayName, mapCatalogModel };
export type { DeepInfraCatalog, DeepInfraCatalogModel } from "./vendor/pi-deepinfra/deepinfra-models.ts";

/** The operator's pool, as the exposure ceiling for ONE maximal call (D193; `DURIG_SPEND_CAP_STORE_USD`). */
export const DEFAULT_STORE_CAP_USD = 4.0;

const HERE = dirname(fileURLToPath(import.meta.url));
export const PRICE_FILE = join(HERE, "deepinfra-prices.json");

let priceCache = null;

/** The dated price source, or an empty map when the file is missing (a missing source refuses rows, it never
 * silently re-adopts an undated comment). */
export function datedPrices(file = PRICE_FILE) {
	if (priceCache && priceCache.file === file) return priceCache;
	let fetchedAt = null;
	const rows = new Map();
	try {
		const j = JSON.parse(readFileSync(file, "utf8"));
		fetchedAt = j.fetchedAt ?? null;
		for (const [id, r] of Object.entries(j.rows ?? {})) rows.set(id, r);
	} catch {
		/* no source: every curated row below becomes a refusal, reported, not a $0 row */
	}
	priceCache = { file, fetchedAt, rows };
	return priceCache;
}

/** Worst-case cost of ONE call at the row's own declared maxima. Axis: USD per call. */
export function maxCallExposureUsd(row) {
	return ((row.contextWindow * row.cost.input + row.maxTokens * row.cost.output) / 1e6);
}

const refusals = new Map();

/** The rows this process REFUSED to register, with the cause. Read-side; `config` reports it. Deduplicated by
 * model+cause because `fallbackModels()` runs once per provider build and a repeated refusal is one fact. */
export function catalogRefusals() {
	return [...refusals.values()];
}

/**
 * THE VALIDATION LAYER. Takes the vendored rows, re-prices them from the dated source, and refuses any row that
 * is unpriced or whose own declared geometry could spend more than the store cap in a single call.
 *
 * @param {{storeCapUsd?: number, file?: string, report?: (line: object) => void}} [options]
 * @returns {Array} pi-ai Model rows, with `priceSource`, `priceAsOf` and `maxCallExposureUsd` carried.
 */
export function curatedFallbackModels({ storeCapUsd, file = PRICE_FILE, report } = {}) {
	const cap = Number.isFinite(Number(storeCapUsd)) && Number(storeCapUsd) > 0 ? Number(storeCapUsd) : DEFAULT_STORE_CAP_USD;
	const source = datedPrices(file);
	const kept = [];
	for (const row of vendoredFallbackModels()) {
		const dated = source.rows.get(row.id);
		const input = Number(dated?.input);
		const output = Number(dated?.output);
		const priced = Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0;
		if (!priced) {
			refuse(row, "unpriced", `no dated price for ${row.id} in ${file} — re-fetch the catalog and stamp fetchedAt`, cap, report);
			continue;
		}
		const candidate = {
			...row,
			cost: {
				input,
				output,
				// An unpublished cache price buys NOTHING (#5015 P6): claim no discount rather than invent one.
				// The explicit null/undefined test matters: `Number(null)` is 0, which IS finite, so a bare
				// Number.isFinite check turns "the vendor publishes no cache price" into "$0 cache reads" - a cheaper
				// lie than the one this line exists to prevent.
				cacheRead:
					dated.cacheRead !== null &&
					dated.cacheRead !== undefined &&
					Number.isFinite(Number(dated.cacheRead))
						? Number(dated.cacheRead)
						: input,
				cacheWrite: 0,
			},
			priceSource: `deepinfra-catalog@${source.fetchedAt ?? "UNDATED"}`,
			priceAsOf: source.fetchedAt,
		};
		const exposure = maxCallExposureUsd(candidate);
		candidate.maxCallExposureUsd = Number(exposure.toFixed(4));
		if (exposure > cap) {
			refuse(
				candidate,
				"over-exposed",
				`one maximal call at its own declared maxima costs $${exposure.toFixed(2)} = ${(exposure / cap).toFixed(2)}x the $${cap} store cap; drop the row or lower its declared window (a capacity ruling, D201)`,
				cap,
				report,
			);
			continue;
		}
		if (dated.inCatalog === false)
			candidate.catalogAbsent = true; // kept (a rig may still name it) but marked: the live catalog does not carry it
		kept.push(candidate);
	}
	return kept;
}

function refuse(row, cause, remedy, cap, report) {
	const line = {
		spend: "catalog-refused",
		model: row.id,
		cause,
		capUsd: cap,
		maxCallExposureUsd: Number(maxCallExposureUsd(row).toFixed(4)),
		remedy,
		effect: "the row is NOT registered, so a seat naming it fails as no_model BEFORE any request",
	};
	refusals.set(`${row.id}:${cause}`, line);
	(report ?? ((l) => process.stderr.write(`${JSON.stringify(l)}\n`)))(line);
}

/**
 * The catalogue `buildModels` registers. THE name is unchanged on purpose — every consumer (cli.mjs, the demos,
 * the probes) already imports this path, so the guard cannot be bypassed by importing the "other" table.
 */
export function fallbackModels(options = {}) {
	return curatedFallbackModels(options);
}

/** The live catalog, put through the SAME policy: an unpriced row and an over-exposed row never reach a seat. */
export async function fetchDeepInfraModels(signal, options = {}) {
	const live = await vendoredFetch(signal);
	const cap = Number.isFinite(Number(options.storeCapUsd)) ? Number(options.storeCapUsd) : DEFAULT_STORE_CAP_USD;
	return live.filter((row) => {
		if (!Number.isFinite(row?.cost?.input) || !Number.isFinite(row?.cost?.output)) {
			refuse(row, "unpriced", "the catalog row publishes no price; an unpriced metered row is a $0 lie", cap, options.report);
			return false;
		}
		const exposure = maxCallExposureUsd(row);
		if (exposure > cap) {
			refuse(row, "over-exposed", `one maximal call = $${exposure.toFixed(2)} > the $${cap} store cap`, cap, options.report);
			return false;
		}
		return true;
	});
}

// Functional-area partition of the demo suite (ROADMAP tooling, item #1558).
//
// The suite is one flat directory (`demo/*.test.mjs`, ~120+ files). Running all
// of it is the pre-landing / QA gate; a developer normally needs only their own
// functional area, which is far cheaper. The area -> file mapping is DATA
// (`demo/test-areas.json`), not code, so it is reviewable and diffable; and
// `demo/test-areas.test.mjs` is the check rule that fails when the mapping rots
// (a test file on disk that is unmapped, a mapped file that no longer exists,
// a file mapped to two areas, or an empty area).
//
// This module is pure filesystem + data: no store, no harness, no spawning. The
// runner (`scripts/test.mjs`) is the only place that executes tests.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST_REL = "demo/test-areas.json";

/** Absolute path to the manifest under `root`. */
export function manifestPath(root = process.cwd()) {
	return join(root, MANIFEST_REL);
}

/** Parse the manifest. Throws if it is missing or not valid JSON. */
export function readManifest(root = process.cwd()) {
	const path = manifestPath(root);
	if (!existsSync(path)) throw new Error(`test-area manifest not found: ${path}`);
	return JSON.parse(readFileSync(path, "utf8"));
}

/** Every `demo/*.test.mjs` on disk, repo-relative and sorted. The coverage source of truth. */
export function discoverTests(root = process.cwd()) {
	const dir = join(root, "demo");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".test.mjs"))
		.sort()
		.map((f) => `demo/${f}`);
}

/** Area names, sorted. */
export function areaNames(manifest) {
	return Object.keys(manifest?.areas ?? {}).sort();
}

/** Files for one area, sorted. Throws on an unknown area (a typo must not select nothing). */
export function filesForArea(manifest, area) {
	const areas = manifest?.areas ?? {};
	if (!Object.prototype.hasOwnProperty.call(areas, area)) {
		throw new Error(`unknown area "${area}" (known: ${areaNames(manifest).join(", ")})`);
	}
	return [...areas[area]].sort();
}

/**
 * Coverage validation — the check rule behind "the mapping cannot silently rot".
 * Returns `{ ok, errors }`; `errors` is sorted and empty iff the manifest exactly
 * partitions the test files on disk.
 */
export function validateManifest(root = process.cwd()) {
	let manifest;
	try {
		manifest = readManifest(root);
	} catch (e) {
		return { ok: false, errors: [e.message] };
	}
	const errors = [];
	const onDisk = new Set(discoverTests(root));
	const mappedTo = new Map(); // file -> areas it is listed under

	for (const [area, files] of Object.entries(manifest.areas ?? {})) {
		if (!Array.isArray(files) || files.length === 0) {
			errors.push(`area "${area}" is empty or not an array`);
			continue;
		}
		for (const file of files) {
			if (!mappedTo.has(file)) mappedTo.set(file, []);
			mappedTo.get(file).push(area);
		}
	}
	for (const [file, areas] of mappedTo) {
		if (areas.length > 1) errors.push(`"${file}" is mapped to ${areas.length} areas: ${areas.join(", ")}`);
		if (!onDisk.has(file)) errors.push(`"${file}" is mapped but does not exist on disk`);
	}
	for (const file of onDisk) {
		if (!mappedTo.has(file)) errors.push(`"${file}" is on disk but not mapped to any area (add it to ${MANIFEST_REL})`);
	}
	return { ok: errors.length === 0, errors: errors.sort() };
}

/**
 * Resolve a selection. `area` picks one functional area; otherwise the WHOLE
 * suite on disk (never the manifest union, so an unmapped file still runs in the
 * full gate — the coverage rule flags it separately).
 * Throws on an unknown area or on `--area` together with `--all`.
 */
export function selectTests(root = process.cwd(), { area = null, all = false } = {}) {
	if (area && all) throw new Error("--area and --all are mutually exclusive");
	const manifest = readManifest(root);
	if (area) return { area, files: filesForArea(manifest, area), areas: areaNames(manifest) };
	return { area: null, files: discoverTests(root), areas: areaNames(manifest) };
}

// durig configuration: environment variables win, then a JSON config file,
// then built-in defaults. One vocabulary — the existing DURIG_* names — so
// operators never have to learn a second spelling.
//
// File discovery order (first existing wins):
//   1. $DURIG_CONFIG            (explicit path; must exist)
//   2. ./durig.config.json      (cwd)
//   3. ./.durig/config.json     (cwd)
//
// Why this exists: an operator with no DURIG_DB ran `send pm` and the CLI
// silently acted on the default ./rig.sqlite instead of their tutor-pi.sqlite
// — the rig looked broken when it was simply pointed at a different database.

export const DEFAULT_CONFIG_PATHS = ["durig.config.json", ".durig/config.json"];

/** Keys a config file may set, mirroring the environment variables. */
export const CONFIG_KEYS = [
	"DURIG_DB",
	"DURIG_PROVIDER",
	"DURIG_MODEL",
	"DURIG_MAX_CONCURRENT_SEATS",
	"DURIG_OPTIMIZE",
	"DEEPINFRA_API_KEY",
];

/**
 * Merge config-file values under the environment (environment wins).
 * Empty-string env vars are treated as unset so `DURIG_DB= node cli.mjs`
 * falls back to config/default exactly like an absent variable.
 *
 * @param {Record<string, unknown>} fileValues
 * @param {Record<string, unknown>} env
 * @returns {Record<string, unknown>}
 */
export function mergeConfig(fileValues, env) {
	const out = {};
	for (const [k, v] of Object.entries(fileValues ?? {})) {
		if (v !== undefined && v !== null) out[k] = v;
	}
	for (const [k, v] of Object.entries(env ?? {})) {
		if (v !== undefined && v !== null && v !== "") out[k] = v;
	}
	return out;
}

/**
 * Load and merge configuration.
 *
 * @param {object} opts
 * @param {Record<string,string|undefined>} [opts.env]  defaults to process.env
 * @param {(path: string, encoding: string) => Promise<string>} opts.readFile
 *   injected so tests need no real filesystem.
 * @returns {Promise<{config: Record<string, unknown>, source: string|null}>}
 */
export async function loadConfig({ env = {}, readFile } = {}) {
	const explicit = env.DURIG_CONFIG;
	const candidates = explicit ? [explicit] : DEFAULT_CONFIG_PATHS;
	let fileValues = {};
	let source = null;
	for (const path of candidates) {
		let text;
		try {
			text = await readFile(path, "utf8");
		} catch (err) {
			if (err && err.code === "ENOENT") {
				if (explicit) {
					throw new Error(`DURIG_CONFIG points at a missing file: ${path}`);
				}
				continue;
			}
			throw err;
		}
		try {
			fileValues = JSON.parse(text);
		} catch (err) {
			throw new Error(`invalid JSON in config file ${path}: ${err.message}`);
		}
		source = path;
		break;
	}
	return { config: mergeConfig(fileValues, env), source };
}

/**
 * Human/LLM-readable summary of the effective configuration, with secrets
 * reduced to a boolean so this is always safe to print or log.
 */
export function describeConfig({ config, source }) {
	return {
		source,
		DURIG_DB: config.DURIG_DB ?? "./rig.sqlite",
		DURIG_PROVIDER: config.DURIG_PROVIDER ?? "deepinfra",
		DURIG_MODEL: config.DURIG_MODEL ?? "zai-org/GLM-5.3-Flash",
		DURIG_MAX_CONCURRENT_SEATS: config.DURIG_MAX_CONCURRENT_SEATS ?? null,
		DURIG_OPTIMIZE: config.DURIG_OPTIMIZE ?? null,
		DEEPINFRA_API_KEY: config.DEEPINFRA_API_KEY ? "set" : "unset",
	};
}

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
	"DURIG_EXTENSIONS",
	"DURIG_STREAM_TIMEOUT_MS",
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
 * Harness `settings` from configuration, or `{}` to take every platform default.
 *
 * Why this exists, after checking rather than assuming: pi-durable's
 * `resolveSettings` already supplies defaults for retry (3 attempts, 2 s base,
 * 60 s agent delay), compaction, progress, tool execution, the queue modes and
 * context retention, so durig passing no settings does NOT mean it has none. The
 * provider path is the `openai` SDK, which applies its own 10-minute total request
 * timeout and 2 SDK-level retries. `stream.timeoutMs` is therefore the one knob
 * durig could not reach at all, and it matters for two opposite reasons:
 *
 *   - `DURIG_MAX_CONCURRENT_SEATS=1` exists so a single slow local model can serve
 *     the whole rig. A generation slower than ten minutes cannot be granted more
 *     time, and fails as a provider error.
 *   - the reverse: an operator may want to fail fast rather than wait out ten
 *     minutes on a stalled endpoint, three durable attempts in a row.
 *
 * Deliberately only `stream`: the other fields have defaults that were chosen for
 * good reasons and nothing in durig's use argues for a different one. Adding a
 * config key per platform field would be cost without a reason.
 *
 * @param {Record<string, unknown>} [config]
 * @returns {{stream?: {timeoutMs: number}}}
 */
export function streamSettings(config) {
	const raw = config?.DURIG_STREAM_TIMEOUT_MS;
	if (raw === undefined || raw === null || raw === "") return {};
	const ms = Number(raw);
	// Fail loudly rather than silently falling back to the platform default: a
	// timeout that was set and quietly ignored is worse than one never set, and
	// this is the kind of value that only shows up under load.
	if (!Number.isFinite(ms) || ms <= 0) {
		throw new Error(
			`DURIG_STREAM_TIMEOUT_MS must be a positive number of milliseconds, got: ${raw}`,
		);
	}
	return { stream: { timeoutMs: ms } };
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
		DURIG_EXTENSIONS: config.DURIG_EXTENSIONS ?? null,
		// null means the platform default stands: the `openai` SDK's 600000 ms total
		// request timeout, which durig cannot otherwise raise or lower.
		DURIG_STREAM_TIMEOUT_MS: config.DURIG_STREAM_TIMEOUT_MS ?? null,
		DEEPINFRA_API_KEY: config.DEEPINFRA_API_KEY ? "set" : "unset",
	};
}

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
// silently acted on the default ./rig.sqlite instead of their configured store
// — the rig looked broken when it was simply pointed at a different database.

export const DEFAULT_CONFIG_PATHS = ["durig.config.json", ".durig/config.json"];

// The SHIPPED defaults file (#491 C6): discovered the same way the runtime
// config is — relative to the CWD (source of truth in cli.mjs) — PLUS any
// anchored path the caller provides. The anchored path is how a fresh install
// in an arbitrary CWD still finds the shipped file: the CLI anchors it to
// durig's OWN install directory, because "ship a defaults file" only works if
// the file rides WITH the artifact, not with wherever the operator happens to
// stand.
export const DEFAULTS_CONFIG_PATHS = [
	"durig.config.default.json",
	".durig/config.default.json",
	"../durig.config.default.json",
];

/**
 * #700: secret-LOOKING values are refused in a config FILE (never in the
 * environment). The disclosed finding: a live DEEPINFRA_API_KEY value sat in
 * plain text in durig.config.json in a SHARED tree, and the durable transcript
 * (which had echoed it) logged it too. A checked-in config file is exactly the
 * wrong place for a secret — it is shared, diffed and copied — while the
 * environment is the sanctioned channel (config.mjs already treats env as the
 * highest-precedence source). So the guard's job is narrow and loud: refuse a
 * config FILE whose VALUES look like credentials, name the KEY (never echo the
 * value), and point at the environment.
 *
 * Deliberately NOT applied to env values: an operator setting DEEPINFRA_API_KEY
 * in their shell is the intended use. Only file content is refused.
 *
 * Patterns are VALUE shapes, not key names — a secret is a secret under any key,
 * and key-name matching would miss a secret pasted into DURIG_DB. Kept short and
 * specific to avoid refusing ordinary paths (a Windows path with a colon is not a
 * token): known provider prefixes, and long high-entropy runs.
 */
/**
 * #1317: the provider-PREFIX shapes only. The commit-time gate (src/seatguard.mjs)
 * tests tokens from a staged DIFF with these — deliberately NOT the blunt 40+
 * entropy rule below, which fires on the hashes, ids and base64 that are ordinary
 * in a diff (a full git sha in a JSON string is 40 hex chars). Security's posture:
 * prefer a false negative to a false positive, because a gate that refuses an
 * ordinary commit is an outage.
 */
export const SECRET_PREFIX_PATTERNS = [
	/^sk-[A-Za-z0-9_-]{16,}$/, // OpenAI-style
	/^hf_[A-Za-z0-9]{16,}$/, // HuggingFace
	/^ghp_[A-Za-z0-9]{20,}$/, // GitHub PAT
	/^AIza[0-9A-Za-z_-]{20,}$/, // Google API key
];

export const SECRET_VALUE_PATTERNS = [
	...SECRET_PREFIX_PATTERNS,
	// Long high-entropy run: letters AND digits, no path separators (a path with
	// `/` or `\` is not a token), no whitespace.
	/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9+_=-]{40,}$/,
];

/** Does a single config VALUE look like a credential? A non-string, or a
 * string that is not all one token, is never refused. */
export function looksLikeSecret(value) {
	if (typeof value !== "string") return false;
	const v = value.trim();
	if (v.length < 16) return false;
	return SECRET_VALUE_PATTERNS.some((re) => re.test(v));
}

/**
 * Refuse a config FILE that carries a secret-looking value. Throws an error
 * naming the offending KEY(s) and the file, but NEVER the value. Called on the
 * raw file values BEFORE merge, so an env override cannot mask a leaked file
 * secret (the file is the thing that is shared; the leak is the file).
 *
 * @param {Record<string, unknown>} fileValues parsed config-file content
 * @param {string|null} source the file path (for the message)
 */
export function assertNoSecretsInFile(fileValues, source) {
	const offenders = Object.entries(fileValues ?? {})
		.filter(([, v]) => looksLikeSecret(v))
		.map(([k]) => k);
	if (offenders.length === 0) return;
	throw new Error(
		`secret-looking value(s) in config file ${source ?? "(unknown)"} for key(s): ${offenders.join(", ")} — ` +
			"a config file is shared and committed; set the value in the ENVIRONMENT instead " +
			"(e.g. DEEPINFRA_API_KEY) and remove it from the file",
	);
}

/** Keys a config file may set, mirroring the environment variables. */
export const CONFIG_KEYS = [
	"DURIG_DB",
	"DURIG_PROVIDER",
	"DURIG_MODEL",
	"DURIG_MAX_CONCURRENT_SEATS",
	"DURIG_OPTIMIZE",
	"DURIG_EXTENSIONS",
	"DURIG_STREAM_TIMEOUT_MS",
	"DURIG_STRANDED_MS",
	"DURIG_SEAT_ROOT",
	"DEEPINFRA_API_KEY",
];

/**
 * Read the SHIPPED defaults file with the same resilience rules as loadConfig.
 * Returns { values, source }: `source` names the path actually read (null when
 * none found) so `node cli.mjs config` can say WHY a default is what it is.
 * Missing file => { values: {}, source: null }; malformed file => loud error
 * with its path (never silently ignored).
 *
 * Why a FILE and not just more constants: the defaults must be VISIBLE and
 * OVERRIDABLE in the shipped artifact (the operator opens the file, edits,
 * reruns), and the config report can name its source.
 */
export async function loadShippedDefaults({ readFile, anchors = [] } = {}) {
	const candidates = [...anchors, ...DEFAULTS_CONFIG_PATHS];
	if (readFile == null) return { values: {}, source: null };
	for (const path of candidates) {
		let text;
		try {
			text = await readFile(path, "utf8");
		} catch (err) {
			if (err && err.code === "ENOENT") continue;
			throw err;
		}
		try {
			const values = JSON.parse(text) ?? {};
			assertNoSecretsInFile(values, path);
			return { values, source: path };
		} catch (err) {
			if (err?.message?.includes("secret-looking value(s)")) throw err;
			throw new Error(`invalid JSON in config file ${path}: ${err.message}`);
		}
	}
	return { values: {}, source: null };
}
export function mergeConfig(fileValues, env, defaults = {}) {
	const out = {};
	const fromFiles = { ...defaults, ...fileValues };
	for (const [k, v] of Object.entries(fromFiles)) {
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
export async function loadConfig({ env = {}, readFile, defaults = {}, defaultsSource = null } = {}) {
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
		// #700: the FILE is checked before merge, so an env value cannot mask a
		// secret that is sitting in a shared, committed file.
		assertNoSecretsInFile(fileValues, path);
		source = path;
		break;
	}
	return { config: mergeConfig(fileValues, env, defaults), source, defaultsSource };
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
 * The "admitted but not started" strandage threshold (ROADMAP 37a). Returns
 * `null` when unset, in which case computeAttention falls back to
 * src/attention.mjs's STRANDED_ADMITTED_MS; overridable so a test (and an
 * operator chasing a live stall) can tighten it without waiting out the default.
 *
 * @param {Record<string, unknown>} [config]
 * @returns {number|null} milliseconds an admitted submission may sit unstarted
 *   before it is surfaced as stranded, or null when unset.
 */
export function strandedMsSetting(config) {
	const raw = config?.DURIG_STRANDED_MS;
	if (raw === undefined || raw === null || raw === "") return null;
	const ms = Number(raw);
	// Fail loudly rather than silently ignoring a mistyped value.
	if (!Number.isFinite(ms) || ms <= 0) {
		throw new Error(
			`DURIG_STRANDED_MS must be a positive number of milliseconds, got: ${raw}`,
		);
	}
	return ms;
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
		// null means src/attention.mjs's STRANDED_ADMITTED_MS (30 s) stands.
		DURIG_STRANDED_MS: config.DURIG_STRANDED_MS ?? null,
		DEEPINFRA_API_KEY: config.DEEPINFRA_API_KEY ? "set" : "unset",
	};
}

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

// The provider families are owned by src/providers/local.mjs; the compaction override map needs them so a
// "family/*" key resolves against the SAME prefix set that builds the provider ids, instead of a second,
// hand-written list that can drift (see `overrideKeysForFamily`).
import { LOCAL_ENV_PREFIXES, localProviderSpecs, providerIdForPrefix } from "./providers/local.mjs";

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
 *
 * #1379 (G-A, security's position @cf84825): extended with the leaked-secret
 * runbook table's high-precision subset — AWS `AKIA`, Slack `xox`, the `gho_` and
 * `github_pat_` families. JWT stays REVIEW-ONLY (sample JWTs are ordinary fixture
 * content). PEM headers are NOT here: they cannot be tokens, so the gate matches
 * them on the raw added LINE (see PEM_LINE_RE in src/seatguard.mjs).
 */
export const SECRET_PREFIX_PATTERNS = [
	/^sk-[A-Za-z0-9_-]{16,}$/, // OpenAI-style
	/^hf_[A-Za-z0-9]{16,}$/, // HuggingFace
	/^ghp_[A-Za-z0-9]{20,}$/, // GitHub PAT
	/^gho_[A-Za-z0-9]{20,}$/, // GitHub OAuth token (#1379, G-A)
	/^github_pat_[A-Za-z0-9_]{22,}$/, // GitHub fine-grained PAT (#1379, G-A)
	/^AIza[0-9A-Za-z_-]{20,}$/, // Google API key
	/^AKIA[A-Z0-9]{16}$/, // AWS access key id (#1379, G-A; uppercase-only body — a lowercase 40-hex sha still does not match)
	/^xox[abprs]-[A-Za-z0-9-]{10,}$/, // Slack (#1379, G-A)
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
	"DURIG_LOCAL_BASE_URL",
	"DURIG_LOCAL_MODEL",
	"DURIG_LOCAL_CONTEXT",
	"DURIG_LOCAL_MAX_TOKENS",
	// The SECOND locally-served provider (cross-family verification, ROADMAP 189). Read from the config file
	// as well as the environment, and note that the API-KEY variables are deliberately NOT config keys: a
	// credential belongs in the environment, never in a file that could be committed.
	"DURIG_VERIFIER_BASE_URL",
	"DURIG_VERIFIER_MODEL",
	"DURIG_VERIFIER_CONTEXT",
	"DURIG_VERIFIER_MAX_TOKENS",
	// THE THIRD LOCAL BOX (#5648). Registering the PREFIX is not enough: `localProviderSpec` reads these keys and
	// `assertNoUnknownFileKeys` refuses a config file that sets a key no code reads, so an unregistered key is
	// accepted-and-ignored - the same inert-key class as `--json` (#5071) and the half-armed roster ROADMAP 272
	// records. The box is LAN-served, so `endpointClass` calls it `metered` (src/providers/local.mjs:60-77) and
	// a metered row without a declared price REFUSES registration: hence the price keys, not just the four
	// operational ones. `DURIG_LOCAL2_API_KEY` is deliberately NOT here - a credential belongs in the
	// environment (demo/config-credential-surface.test.mjs enforces that rule for every family).
	"DURIG_LOCAL2_BASE_URL",
	"DURIG_LOCAL2_MODEL",
	"DURIG_LOCAL2_CONTEXT",
	"DURIG_LOCAL2_MAX_TOKENS",
	"DURIG_LOCAL2_PRICE_USD_IN",
	"DURIG_LOCAL2_PRICE_USD_OUT",
	"DURIG_LOCAL2_PRICE_USD_CACHE_READ",
	"DURIG_LOCAL2_PRICE_AS_OF",
	"DURIG_LOCAL2_PRICE_JSON",
	// The FIRST local box's price family: `declaredPrice` reads `<PREFIX>PRICE_*` for every registered prefix
	// (src/providers/local.mjs:97-104), and the verifier family was inventoried by #5125 while this one was not.
	// Measured before this change: `DURIG_LOCAL_PRICE_USD_IN` is read by the code but absent from the inventory,
	// so a config file that set it was silently ignored - inert-by-name, the exact shape the guard exists for.
	"DURIG_LOCAL_PRICE_USD_IN",
	"DURIG_LOCAL_PRICE_USD_OUT",
	"DURIG_LOCAL_PRICE_USD_CACHE_READ",
	"DURIG_LOCAL_PRICE_AS_OF",
	"DURIG_LOCAL_PRICE_JSON",
	"DURIG_STREAM_TIMEOUT_MS",
	"DURIG_STRANDED_MS",
	"DURIG_CONTEXT_WINDOW",
	"DURIG_SEAT_ROOT",
	// THE CLAIM ORDERING POLICY (priority-first selection, `src/workstrategy.mjs`). Registered because a key
	// absent from this inventory is REFUSED in a config file by `assertNoUnknownFileKeys` (`:237`) — which made
	// an unregistered `DURIG_NOTES_DIR` inert-by-name the moment it was added, the #5071 class this repo keeps
	// paying for. `oldest_first` is the default so a rig that never sets it keeps its exact current order; the
	// per-seat override (`workStrategy` in the rig file) and the team value live in the seats doc, not here.
	// The value is VALIDATED at `up` against the implemented table (an unknown name REFUSES and lists them),
	// never silently coerced.
	"DURIG_WORK_STRATEGY",
	// Where continuation-note MIRROR files are written (D240). Registered because `assertNoUnknownFileKeys`
	// (src/config.mjs:227-234) refuses a config file that sets an unregistered key: an operator who puts
	// `DURIG_NOTES_DIR` in `durig.config.json` without this row gets the same accepted-and-ignored class as
	// #5071. The source of truth is the durable store doc (`durig.notes`); this directory is the mirror a gate,
	// another seat or a human can read without opening the store. Unset means `<cwd>/.durig/notes`.
	// The compaction policy surface (#4887, registered by the #4931 re-cut). Measured, not assumed:
	// nothing in `src/` or `cli.mjs` consumes this array - there is NO unknown-key rule at load time -
	// so `CONFIG_KEYS` is the DECLARED inventory of what a config file may set, and the demos are what
	// enforce it (demo/local-provider.test.mjs:75, demo/second-local-provider.test.mjs:146, and now
	// demo/config.test.mjs). Leaving these five out of the inventory while the environment path read them
	// is the drift #2114 already named: one setting, two sources, and nothing to notice the gap. This is
	// CONFORMANCE, not runtime: the values already reach `Harness.open` either way.
	"DURIG_COMPACTION_ENABLED",
	"DURIG_COMPACTION_MODEL_OVERRIDES",
	"DURIG_COMPACTION_RESERVE_TOKENS",
	"DURIG_COMPACTION_KEEP_RECENT_TOKENS",
	"DURIG_COMPACTION_BACKGROUND_TOKENS",
	"DEEPINFRA_API_KEY",
	// The PRICE + ledger surface of the second provider class, registered by #5125. Read from the config layer by
	// `declaredPrice` (src/providers/local.mjs:94-128), which resolves `<PREFIX>PRICE_USD_IN` / `_USD_OUT` /
	// `_USD_CACHE_READ` / `_AS_OF`, then `<PREFIX>PRICE_JSON` or the shared `DURIG_PRICE_JSON`. Note the spelling:
	// the cache-read key is `..._PRICE_USD_CACHE_READ`; registering a near-miss name would create an INERT key that
	// reads as priced and is not, which is exactly the half-armed failure ROADMAP 272 records.
	// THE SAME FAMILY FOR THE `local` PROVIDER (RM-323 / ROADMAP 323), which was MISSING. The shape of the bug is the
	// rule: `createLocalProvider` refuses an unpriced metered family with a remedy saying `declare
	// DURIG_LOCAL_PRICE_USD_IN/_OUT`, and the loader then refused THAT key as `unknown config-file key(s)` on EVERY
	// verb — so the remedy was unactionable in a file, the price could live only in the launch environment, and a
	// broker started without `--env-file` registered NO model row and darkened every author seat. THE KEYS A REFUSAL
	// TELLS YOU TO DECLARE MUST BE THE KEYS THE LOADER ACCEPTS; `demo/config-local-price.test.mjs` pins that equality
	// for BOTH families against `priceKeyNames()` (src/providers/local.mjs), the names `declaredPrice` reads.
	// WHY THE ASYMMETRY IS INTENTIONAL: a config key is auditable because it is IN a file (`durig.config.json` is
	// gitignored but still inside the tree — gitignored is not outside), and a credential is auditable because it is
	// NOT in a file. So the price of a class belongs to the inventory and the KEY that pays it does not; the value
	// stays in `~/.config/durig/env` (mode 600, out of tree) and `assertNoSecretsInFile` refuses any secret-shaped
	// value that tries to move in. See demo/config-credential-surface.test.mjs.
	"DURIG_VERIFIER_PRICE_USD_IN",
	"DURIG_VERIFIER_PRICE_USD_OUT",
	"DURIG_VERIFIER_PRICE_USD_CACHE_READ",
	"DURIG_VERIFIER_PRICE_AS_OF",
	"DURIG_VERIFIER_PRICE_JSON",
	"DURIG_LOCAL_PRICE_USD_IN",
	"DURIG_LOCAL_PRICE_USD_OUT",
	"DURIG_LOCAL_PRICE_USD_CACHE_READ",
	"DURIG_LOCAL_PRICE_AS_OF",
	"DURIG_LOCAL_PRICE_JSON",
	"DURIG_PRICE_JSON",
	// Where a metered run writes its bill (#5099 scoping key; `tools/model-probes/metered.mjs:41`, `cli.mjs:292`).
	"DURIG_SPEND_LEDGER",
	// The three caps are SET BY the tracked `durig.config.default.json` (#5047), so they are config-FILE keys by
	// fact; the inventory simply did not say so. Registering them is what lets the unknown-key rule below be
	// applied to the shipped artifact without starting red (the #3539 lesson: a gate that opens red gets disabled).
	// `DURIG_PROBE_CEILING_USD` stays OUT on purpose: #5024 rules one budget gets one name, and the probe ceiling is
	// mapped onto `DURIG_SPEND_CAP_RUN_USD` for that process (metered.mjs:43) rather than becoming a file key.
	"DURIG_SPEND_CAP_CALL_USD",
	"DURIG_SPEND_CAP_RUN_USD",
	"DURIG_SPEND_CAP_STORE_USD",
];

/**
 * Refuse a config FILE that sets a key no code reads. Until #5125 the inventory above was DECLARED only: `git grep
 * CONFIG_KEYS -- src cli.mjs` returned the declaration and nothing else, and the file's own comment admitted "there
 * is NO unknown-key rule at load time". A typo'd or stale key in `durig.config.json` was therefore accepted and
 * silently ignored — the accepted-and-ignored class of `--json` (#5071), where the tool reports success about a
 * thing it never looked at.
 *
 * Scope, stated so it is not over-read: this guards FILE values only. The environment may carry any name (that is
 * how credentials and per-run overrides reach a process — `mergeConfig` copies env wholesale), so an env-only
 * setting such as `DURIG_LOCAL_PRICE_USD_IN` or `DURIG_PROBE_CEILING_USD` is not refused here.
 *
 * Names the key(s), the file, and the known inventory; NEVER a value (a mistyped key is often a mistyped
 * credential). Throwing rather than warning is the ruling: a warning in a preflight is what this run keeps
 * discovering that nobody reads.
 */
export function assertNoUnknownFileKeys(fileValues, source) {
	const known = new Set(CONFIG_KEYS);
	const unknown = Object.keys(fileValues ?? {}).filter((k) => !known.has(k));
	if (unknown.length === 0) return;
	throw new Error(
		`unknown config-file key(s): ${unknown.join(", ")} in ${source ?? "(unknown)"} — no code reads these, so they ` +
		`are silently ignored (the #5071 accepted-and-ignored class). Known config-file keys (CONFIG_KEYS, ` +
		`src/config.mjs): ${CONFIG_KEYS.slice().sort().join(", ")}. Fix: remove the key, or register it in CONFIG_KEYS ` +
		`if it is a real setting; a per-run value belongs in the ENVIRONMENT instead.`,
	);
}

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
			// #5125: the SHIPPED defaults are held to the same inventory as the operator file — that is the whole
			// point of a declared inventory, and it is why the three caps were registered rather than exempted.
			assertNoUnknownFileKeys(values, path);
			return { values, source: path };
		} catch (err) {
			if (err?.message?.includes("secret-looking value(s)")) throw err;
			if (err?.message?.includes("unknown config-file key(s)")) throw err;
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
		// #5125: and the file may not carry a key nothing reads. Secret first, so a leak is named before a typo.
		assertNoUnknownFileKeys(fileValues, path);
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
 * The operator's DECLARED usable context window (ROADMAP 27's three-state denominator).
 * This is the middle state: more trustworthy than a vendor's advertised figure, less than
 * item 97's measured effective window (#1087). It is deliberately NOT the advertised
 * number, so an operator can state the window their model actually gives them.
 *
 * `DURIG_CONTEXT_WINDOW` is either a bare positive number (one window for every model) or
 * a JSON object keyed by model (`"zai-org/GLM-5.3-Flash": 200000` or `"GLM-5.3-Flash":
 * 200000`) for the per-model case. Unset/blank/malformed returns null — a declaration that
 * cannot be read is not a declaration, and the resolver then falls through to `advertised`.
 *
 * @param {Record<string, unknown>} [config]
 * @param {string|null} [modelKey] the seat's resolved `provider/modelId` (from `modelsBySeat`)
 * @returns {number|null}
 */
export function declaredContextWindow(config, modelKey = null) {
	const raw = config?.DURIG_CONTEXT_WINDOW;
	if (raw === undefined || raw === null || raw === "") return null;
	if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
	const text = String(raw).trim();
	if (text === "") return null;
	if (text.startsWith("{")) {
		let map;
		try {
			map = JSON.parse(text);
		} catch {
			return null;
		}
		if (!map || typeof map !== "object") return null;
		const bare = modelKey != null && String(modelKey).includes("/") ? String(modelKey).slice(String(modelKey).indexOf("/") + 1) : null;
		for (const key of [modelKey, bare].filter((k) => k != null)) {
			const value = Number(map[key]);
			if (Number.isFinite(value) && value > 0) return value;
		}
		return null;
	}
	const n = Number(text);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The compaction POLICY from configuration, or `{}` to leave pi-durable's own defaults in force.
 *
 * WHY THIS EXISTS, measured on this rig (ROADMAP 217-adjacent operator row #4898, operator-
 * authorized): durian-pi set NO compaction policy at all, so every seat ran pi-durable's built-in
 * defaults - `reserveTokens 16384 / keepRecentTokens 20000 / backgroundTokens 32768`. On the verifier
 * class (declared window 24,576) blocking can fire only above ~20,100 input tokens, `selectCut`
 * refuses a cut until 20,000 tokens have accumulated, and the summary then KEEPS those newest 20,000
 * anyway. Measured on seat qa: a turn went out at input 17,445; crossing the selection budget wrote
 * a real `pi.compaction` entry (275457); the NEXT turn returned input 20,109, output 1,
 * `stopReason=length` with an EMPTY reply (275459). So the failure is not "auto-compaction can never
 * fire" - it fires too late to leave room to answer. `compact pm --dry-run` (task 275491) and
 * `compact qa2 --dry-run` (task 275492, at only 18,453 of 24,576) both reported "no compaction entry
 * was written", which is the same policy seen from the reporting side.
 *
 * NO SECOND MECHANISM. pi-durable already layers a per-model `modelOverrides` entry over the
 * harness-wide policy field by field (`compactionPolicy(settings, model)`, cited by lead at
 * compaction.js:194-201), so this function only BUILDS that object; durian-pi decides nothing about
 * when or how compaction runs. UNVERIFIED IN THIS TREE: the item-4898 worktree has no `node_modules`
 * of its own and reads are confined to the worktree, so I could not re-read the pinned file to confirm
 * the key spellings - they are taken from lead's measured body. `demo/config.test.mjs` therefore pins
 * the call site AND the shape durian-pi sends, so a wrong spelling surfaces as a RED demo rather than
 * as a value that is set and silently ignored.
 *
 * Keys, in the existing one-vocabulary `DURIG_*` spelling (no second name to learn):
 *   DURIG_COMPACTION_ENABLED               "1"/"0" - the only key allowed to TURN COMPACTION OFF
 *   DURIG_COMPACTION_RESERVE_TOKENS        headroom to keep free for the answer
 *   DURIG_COMPACTION_KEEP_RECENT_TOKENS    what the summary keeps verbatim (the selection budget)
 *   DURIG_COMPACTION_BACKGROUND_TOKENS     the blocking threshold input
 *   DURIG_COMPACTION_MODEL_OVERRIDES       JSON: "provider/modelId" -> any of the fields above
 * The verifier class (window 24,576) wants `4096 / 8192 / 8192`; the local class (window 200,000) is
 * LEFT ON THE DEFAULTS on purpose - 20,000 kept tokens is affordable there, and inventing a number for
 * a class that was never measured is how a policy becomes folklore.
 *
 * A key may name a FAMILY (`"verifier/*"`) instead of a model id. pi-durable matches `modelOverrides` by
 * the exact `provider/modelId` string (dist/harness/compaction.js:197), so an entry keyed on a model id is
 * pinned to that id: repoint the seat at another quantization and the schedule stops applying while the key
 * still reads configured - inert-by-name, the same class `assertNoUnknownFileKeys` exists for. The family
 * key is expanded at build time against the model ids the config declares for that family
 * (`DURIG_LOCAL_MODEL` / `DURIG_VERIFIER_MODEL` / `DURIG_LOCAL2_MODEL`, the same prefixes
 * `src/providers/local.mjs` builds the provider ids from). A family that declares no model is not armed,
 * so its entry is dropped rather than emitted as a key nothing can ever match.
 *
 * @param {Record<string, unknown>} [config]
 * @returns {{compaction?: {enabled?: boolean, reserveTokens?: number, keepRecentTokens?: number,
 *   backgroundTokens?: number, modelOverrides?: Record<string, object>}}}
 * ONE key, not two: `modelOverrides` nests INSIDE `compaction` because that is the only object the
 * harness reads (ROADMAP 331 - a sibling `modelOverrides` is read by nobody).
 */
/**
 * The concrete `provider/modelId` keys a map key can stand for. An exact key passes through unchanged;
 * `family/*` expands to the model that family's own config keys declare. Exported so a gate can print
 * which keys a schedule actually reaches rather than which keys an operator typed.
 */
export function overrideKeysForFamily(key, config = {}) {
	if (!String(key).endsWith("/*")) return [key];
	const family = String(key).slice(0, -2);
	const prefix = LOCAL_ENV_PREFIXES.find((pre) => providerIdForPrefix(pre) === family);
	if (prefix === undefined) {
		throw new Error(
			`DURIG_COMPACTION_MODEL_OVERRIDES["${key}"] names a family this rig cannot build ` +
			`(known: ${LOCAL_ENV_PREFIXES.map(providerIdForPrefix).join(", ")}) - a key no model can match is inert, not a default`,
		);
	}
	const model = config?.[`${prefix}MODEL`];
	if (model === undefined || model === null || String(model).trim() === "") return [];
	return [`${family}/${String(model).trim()}`];
}

export function compactionSettings(config) {
	const out = {};
	const policy = {};
	const enabled = config?.DURIG_COMPACTION_ENABLED;
	if (enabled !== undefined && enabled !== null && enabled !== "") {
		const text = String(enabled).trim().toLowerCase();
		if (["1", "true", "yes", "on"].includes(text)) policy.enabled = true;
		else if (["0", "false", "no", "off"].includes(text)) policy.enabled = false;
		// Fail loudly: an operator who wrote the key meant to change something, and a silently
		// ignored spelling is exactly the defect this row is fixing.
		else throw new Error(`DURIG_COMPACTION_ENABLED must be a boolean (1/0, true/false), got: ${enabled}`);
	}
	for (const key of ["DURIG_COMPACTION_RESERVE_TOKENS", "DURIG_COMPACTION_KEEP_RECENT_TOKENS", "DURIG_COMPACTION_BACKGROUND_TOKENS"]) {
		const raw = config?.[key];
		if (raw === undefined || raw === null || raw === "") continue;
		const n = Number(raw);
		// Same rule as `streamSettings`: a value that is set and quietly ignored is worse than one
		// never set, and a token budget that lands at 0 or NaN would compact every turn or none.
		if (!Number.isFinite(n) || n <= 0) {
			throw new Error(`${key} must be a positive number of tokens, got: ${raw}`);
		}
		policy[{"DURIG_COMPACTION_RESERVE_TOKENS": "reserveTokens", "DURIG_COMPACTION_KEEP_RECENT_TOKENS": "keepRecentTokens", "DURIG_COMPACTION_BACKGROUND_TOKENS": "backgroundTokens"}[key]] = n;
	}
	// The per-model map and the harness-wide policy are ONE object (ROADMAP 331). Emitting the map as a
	// sibling meant `settings.compaction` stayed undefined, so pi-durable merged its defaults over nothing
	// and every seat ran the defaults - including the 24,576-window verifier family, whose whole window is
	// smaller than the default 16,384 reserve.
	const compaction = { ...policy };
	const overrides = config?.DURIG_COMPACTION_MODEL_OVERRIDES;
	if (overrides !== undefined && overrides !== null && overrides !== "") {
		// Accepted as an object (a config FILE may hold one) or as a JSON string (an ENVIRONMENT
		// variable cannot hold a structure, and every other structured setting here is JSON too).
		let map = overrides;
		if (typeof overrides === "string") {
			try {
				map = JSON.parse(overrides);
			} catch {
				throw new Error(`DURIG_COMPACTION_MODEL_OVERRIDES must be JSON, got: ${overrides}`);
			}
		}
		if (!map || typeof map !== "object" || Array.isArray(map)) {
			throw new Error(`DURIG_COMPACTION_MODEL_OVERRIDES must be an object keyed by "provider/modelId", got: ${JSON.stringify(overrides)}`);
		}
		const layered = {};
		for (const [model, fields] of Object.entries(map)) {
			if (!fields || typeof fields !== "object") {
				throw new Error(`DURIG_COMPACTION_MODEL_OVERRIDES["${model}"] must be an object of policy fields, got: ${JSON.stringify(fields)}`);
			}
			const one = {};
			if (fields.enabled !== undefined) one.enabled = Boolean(fields.enabled);
			for (const field of ["reserveTokens", "keepRecentTokens", "backgroundTokens"]) {
				if (fields[field] === undefined) continue;
				const n = Number(fields[field]);
				if (!Number.isFinite(n) || n <= 0) {
					throw new Error(`DURIG_COMPACTION_MODEL_OVERRIDES["${model}"].${field} must be a positive number of tokens, got: ${fields[field]}`);
				}
				one[field] = n;
			}
			if (Object.keys(one).length > 0) {
				// A FAMILY key ("verifier/*") is written once and expanded to the concrete "provider/modelId"
				// keys pi-durable actually matches (dist/harness/compaction.js:197). Writing the model id by hand
				// pins the entry to a model the operator may repoint next week, and the schedule then sits inert -
				// the same inert-by-name class `assertNoUnknownFileKeys` exists for. See `overrideKeysForFamily`.
				for (const key of overrideKeysForFamily(model, config)) layered[key] = one;
			}
		}
		if (Object.keys(layered).length > 0) compaction.modelOverrides = layered;
	}
	if (Object.keys(compaction).length > 0) out.compaction = compaction;
	// Nothing set means NO override, so pi-durable's documented defaults stand rather than a made-up
	// durian-pi number - the same honesty rule as `streamSettings({})` returning `{}`.
	return out;
}

/**
 * Pure classification of ONE `compact` verb outcome into three states (the reporting half of #4898).
 *
 * The measured defect: this same verb reported "compact: no compaction entry was written" for BOTH a
 * no-op (nothing was worth cutting) and a real failure (the summarizer call died), which misled four
 * sessions - an operator cannot tell "the seat did not need it" from "the repair did not work", and a
 * repair that silently does not work is how a seat gets reset instead of fixed. Exit codes are
 * DISTINCT so a script can branch: COMPACTED 0, FAILED 1, NO-OP 2 (not an error, but nothing was
 * done - the operator asked for a cut and the rig spent no model call to decline one).
 *
 * It also carries the ANSWER to "was there anything to cut?" next to the outcome, because that question
 * is what makes a NO-OP self-explanatory: the selection gate is the accumulation budget, so
 * `willCut` is `consumed >= keepRecentTokens` - the window is context, not the gate.
 *
 * `failureReason` is whatever the platform reported (never invented): when it is null the report says
 * `unknown` rather than guessing a cause.
 */
export function compactionReport({ consumed = null, policy = {}, summaryEntry = null, failureReason = null }) {
	const keep = policy.keepRecentTokens ?? null;
	if (summaryEntry) {
		return { state: "compacted", exitCode: 0, summaryEntryId: summaryEntry.id, consumed, keepRecentTokens: keep, willCut: null };
	}
	const willCut = Number.isFinite(consumed) && Number.isFinite(keep) ? consumed >= keep : null;
	if (failureReason) {
		return { state: "failed", exitCode: 1, reason: String(failureReason), consumed, keepRecentTokens: keep, willCut };
	}
	return {
		state: "no-op",
		exitCode: 2,
		reason: "no compaction entry was written and no failure was reported",
		consumed,
		keepRecentTokens: keep,
		willCut,
	};
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
		// The compaction policy (#4898), reported rather than left implicit: a seat's context failure
		// is undiagnosable if the numbers that decided it are not printed anywhere. null = pi-durable's
		// built-in default stands (16384 / 20000 / 32768), which on a 24,576-class window is the shape
		// that let compaction fire too late to leave room to answer.
		DURIG_COMPACTION_ENABLED: config.DURIG_COMPACTION_ENABLED ?? null,
		DURIG_COMPACTION_RESERVE_TOKENS: config.DURIG_COMPACTION_RESERVE_TOKENS ?? null,
		DURIG_COMPACTION_KEEP_RECENT_TOKENS: config.DURIG_COMPACTION_KEEP_RECENT_TOKENS ?? null,
		DURIG_COMPACTION_BACKGROUND_TOKENS: config.DURIG_COMPACTION_BACKGROUND_TOKENS ?? null,
		DURIG_COMPACTION_MODEL_OVERRIDES: config.DURIG_COMPACTION_MODEL_OVERRIDES ?? null,
		// Where the continuation-note mirrors live (D240). Reported as a path, never as its contents, so this
		// summary stays safe to print (secrets rule above).
		DURIG_NOTES_DIR: config.DURIG_NOTES_DIR ?? ".durig/notes (default)",
		DEEPINFRA_API_KEY: config.DEEPINFRA_API_KEY ? "set" : "unset",
	};
}

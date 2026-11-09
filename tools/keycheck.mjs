// Credential-surface instrument: for each configured endpoint, answer "is the credential resolved, from WHICH
// variable, is the endpoint reachable, which models does it advertise, and how long does it take" — while printing
// NO VALUE from any credential-shaped variable. Promoted out of `.spike/delegate-20261106c/keycheck.mjs` by #5277
// (ROADMAP 338), because `.spike/` is gitignored and an instrument that lives only there is gone next session
// (#5120, `tools/verifier-arm-probe.mjs` carries the same lesson).
//
// THE FREE/PAID SPLIT IS THE POINT, and it is a property of the vendored API, not of this file:
//   `Models.checkAuth(providerId)` resolves auth and makes NO request — it reads the credential store and asks the
//   provider's auth source to `check` (`node_modules/@earendil-works/pi-ai/dist/models.js:283-293`, which returns
//   `{source, type}` from `resolveProviderAuth`; `AuthCheck` is `{source?: string; type: "api_key"|"oauth"}` at
//   `.../pi-ai/dist/auth/types.d.ts:94-97`). Our resolvers return the variable NAME as that source
//   (`src/providers/local.mjs:314`, `cli.mjs:359`), so the string this tool prints for a key-env credential IS the
//   credential variable name — "presence visible, values not" (ROADMAP 326) comes for free.
// Only "does the provider ACCEPT that credential" costs anything: `--level=spend` sends one completion capped at
// `--max-tokens` (default 6) — about $0.001 on a metered endpoint — and it refuses without a `--ceiling=USD`.
//
// THREE LEVELS, escalating cost, each additive:
//   --level=auth   (default) offline. No socket is opened at all: checkAuth + the registered model rows.
//   --level=reach  adds a GET to `<baseUrl>/models` — an HTTP round trip, ZERO completion tokens — giving
//                  reachable / advertised / latencyMs, the three answers the acceptance asks for.
//   --level=spend  adds the paid probe. Requires --ceiling=USD, and the estimated cost is checked BEFORE sending.
//
// LEAK HYGIENE IS STRUCTURAL, NOT A PLEDGE. Every line is assembled from values this file never reads out (names,
// booleans, statuses), then every emitted line passes a redactor built from (a) the actual values of every
// credential-shaped variable in this process's env and (b) URL userinfo and query params named key/token/secret.
// The failure path is the leak path that matters — a fetch error echoes the URL, and some endpoints carry the key
// IN THE URL — so the redactor runs there too. Finally the tool scans its OWN captured output for those values and
// for `looksLikeSecret` shapes, and REFUSES (exit 2, naming only variables) if anything survived. Buffered flush:
// a run that would leak prints nothing at all.
//
// PER-BOX SCOPE (stated in the tool's own header, not just here): keys are per box (ROADMAP 326). A green here is
// a statement about THIS box's env and THIS box's network path, never about another machine.
//
// Exit codes: 0 every checked endpoint is ok · 1 at least one endpoint is NOT ok (diagnosis printed) ·
// 2 the instrument could not run, or its own self-check refused (a leak was caught, not reported).
//
// Usage:
//   node tools/keycheck.mjs [--family=LOCAL|VERIFIER|DEEPINFRA|all] [--level=auth|reach|spend]
//                           [--ceiling=USD] [--max-tokens=N] [--timeout-ms=MS] [--config=PATH]
// Run (offline, free):  node tools/keycheck.mjs --level=auth
// Pinned by: demo/keycheck.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createModels, createProvider } from "@earendil-works/pi-ai";
import * as ocApi from "@earendil-works/pi-ai/api/openai-completions";

import { CONFIG_KEYS, loadConfig, loadShippedDefaults, looksLikeSecret } from "../src/config.mjs";
import {
	LOCAL_ENV_PREFIX,
	VERIFIER_ENV_PREFIX,
	createLocalProvider,
	endpointClass,
	localProviderSpec,
} from "../src/providers/local.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
	const hit = argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};
const level = String(flag("level", "auth")).toLowerCase();
if (!["auth", "reach", "spend"].includes(level)) die2(`unknown --level=${level} (auth|reach|spend)`);
const maxTokens = Number(flag("max-tokens", "6"));
const timeoutMs = Number(flag("timeout-ms", "8000"));
const ceiling = Number(flag("ceiling", "NaN"));
const wantFamily = String(flag("family", "all")).toUpperCase().replace(/_$/, "");

function die2(cause) {
	// Names and causes only: this path can run before the redactor exists, so it must never interpolate a value.
	console.error(`REFUSED cause:${cause}`);
	process.exit(2);
}

// ---------------------------------------------------------------- leak hygiene

// A credential-shaped NAME, matched on the name so the VALUE never has to be printed to explain itself.
const SECRET_NAME_RE = /(^|_)(API_?KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|AUTH)(_|$)/;
const credentialNames = [];
const secretValues = [];
for (const [name, value] of Object.entries(process.env)) {
	if (!SECRET_NAME_RE.test(name)) continue;
	if (typeof value !== "string" || value.length < 6) continue;
	credentialNames.push(name);
	secretValues.push({ name, value });
}
// Longest first: a key that is a substring of another must still be scrubbed.
secretValues.sort((a, b) => b.value.length - a.value.length);

const URL_QUERY_SECRET_RE = /([?&](?:api[-_]?key|key|token|access[-_]?token|secret|signature)=)[^&\s"']+/gi;
const URL_USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s@/]*@/gi;

/** Scrub anything credential-shaped out of a string before it can reach the terminal. */
function redact(text) {
	let out = String(text ?? "");
	for (const { name, value } of secretValues) out = out.split(value).join(`<redacted:${name}>`);
	return out.replace(URL_QUERY_SECRET_RE, "$1<redacted>").replace(URL_USERINFO_RE, "$1<redacted>@");
}

// Everything this tool says goes through here, so the self-check can see the whole output, and so a run that would
// leak prints nothing: lines are buffered and flushed once the scan passes.
const emitted = [];
const emit = (line) => emitted.push(redact(line));

// `looksLikeSecret` matches a WHOLE value (its patterns are anchored), so feeding it a JSON line is vacuous — it can
// only ever say "this line is not one token". Split the line into token-shaped runs first, or the second half of the
// self-check silently checks nothing.
function secretShapedTokens(text) {
	const runs = String(text).match(/[A-Za-z0-9+_=-]{16,}/g) ?? [];
	return runs.filter((run) => looksLikeSecret(run));
}

function flush() {
	const text = emitted.join("\n");
	const leaked = secretValues.filter(({ value }) => text.includes(value)).map(({ name }) => name);
	if (leaked.length > 0) {
		process.stdout.write(""); // discard the buffered output — a leaking run is not a report
		console.error(`REFUSED cause:self_check_output_shape — the tool would print the VALUE of: ${leaked.join(", ")}`);
		process.exit(2);
	}
	const shaped = secretShapedTokens(text);
	if (shaped.length > 0) {
		process.stdout.write("");
		console.error(
			`REFUSED cause:self_check_output_shape — ${shaped.length} secret-shaped token(s) survived redaction; ` +
				`credential variable(s) in play: ${credentialNames.join(", ") || "none in env"}. ` +
				"A response body is echoed into `advertised`, so an endpoint that returns a token-shaped id is refused here rather than quoted.",
		);
		process.exit(2);
	}
	for (const line of emitted) process.stdout.write(`${line}\n`);
}

// ---------------------------------------------------------------- config + registry

const shipped = await loadShippedDefaults({ readFile: (p) => readFileSync(p, "utf8"), anchors: [join(ROOT, "durig.config.default.json")] });
const cfgResult = await loadConfig({ env: process.env, readFile: (p) => readFileSync(p, "utf8"), defaults: shipped.values, defaultsSource: shipped.source });
const CFG = cfgResult.config;

// The env accessor is the rig's own precedence (env, then the gitignored config file), and it is the only place a
// key VALUE is read here — it goes straight into the provider, never into a printed field.
const envRead = async (name) => process.env[name] ?? CFG[name];

const specs = [];
for (const prefix of [LOCAL_ENV_PREFIX, VERIFIER_ENV_PREFIX]) {
	if (wantFamily !== "ALL" && wantFamily !== prefix.replace(/^DURIG_|_$/g, "")) continue;
	const spec = localProviderSpec(CFG, prefix);
	if (spec) specs.push(spec);
}
const wantDeepinfra = wantFamily === "ALL" || wantFamily === "DEEPINFRA";

// A provider whose auth resolves but whose model rows this tool never registers: the DEEPINFRA family is checked
// for CREDENTIALS only, so it cannot spend. That is deliberate — its price rows and exposure guard belong to the
// rig path (`cli.mjs:355-380`), and a diagnostic must not re-implement them.
const models = createModels({ authContext: { env: envRead, fileExists: async () => false } });
for (const spec of specs) {
	models.setProvider(
		createLocalProvider(spec, {
			createProvider,
			api: ocApi,
			env: (name) => process.env[name] ?? CFG[name],
			// A registration refusal is a finding, so it goes into the report rather than to bare stderr.
			report: (line) => emit(`NOTE registration ${JSON.stringify(line)}`),
		}),
	);
}
if (wantDeepinfra) {
	models.setProvider(
		createProvider({
			id: "deepinfra",
			name: "DeepInfra",
			baseUrl: "https://api.deepinfra.com/v1/openai",
			auth: {
				apiKey: {
					name: "DeepInfra API key",
					resolve: async ({ ctx }) => {
						const key = await ctx.env("DEEPINFRA_API_KEY");
						if (!key) return undefined;
						return { auth: { apiKey: key }, source: "DEEPINFRA_API_KEY" };
					},
				},
			},
			models: [],
			api: ocApi,
		}),
	);
}

// ---------------------------------------------------------------- report

// A credential NAME must never be a config FILE key: the file is committed and shared, so a key there is a leak by
// construction (`src/config.mjs:assertNoSecretsInFile` catches the value, not the shape). Report the shape gap.
const configKeyGap = CONFIG_KEYS.filter((k) => SECRET_NAME_RE.test(k));

emit(`KEYCHECK v1 level=${level} platform=${process.platform} node=${process.version} tree=${ROOT}`);
emit(
	"SCOPE keys are PER BOX (ROADMAP 326/338): this run describes THIS box's environment and network path. A green " +
		"here is not green on another box, and it is not a statement about anyone else's credentials.",
);

const targets = specs.map((spec) => ({ id: spec.id, spec }));
if (wantDeepinfra) targets.push({ id: "deepinfra", spec: null });
if (targets.length === 0) die2("no endpoint configured — set DURIG_LOCAL_BASE_URL / DURIG_VERIFIER_BASE_URL or pass --family=");

let bad = 0;
for (const { id, spec } of targets) {
	const row = { provider: id, level };
	const check = await models.checkAuth(id).catch((err) => {
		row.authError = String(err?.message ?? err);
		if (err?.cause) row.authCause = String(err.cause?.message ?? err.cause);
		return undefined;
	});

	// The whole free half: which variable, of what type, present or not. `check` resolved auth WITHOUT a request.
	row.auth = check ? "complete" : "incomplete";
	row.credentialSource = check?.source ?? null; // a variable NAME (or "none" for the loopback placeholder), never a value
	row.credentialType = check?.type ?? null;

	const baseUrl = spec?.baseUrl ?? models.getProvider(id)?.baseUrl ?? null;
	row.endpoint = baseUrl ? endpointClass(baseUrl) : null;
	row.host = safeHost(baseUrl);
	row.model = spec?.modelId ?? null;

	// Advertised models: the sync read of last-known lists — for a statically registered provider that is the
	// curated set, so `advertisedSource` says honestly where the list came from rather than implying a fetch.
	const registered = models.getModels(id).map((m) => m.id);
	row.advertised = registered;
	row.advertisedSource = "registered"; // honest at level=auth; replaced by "endpoint-list" after a reach probe

	if (level !== "auth") {
		const probed = await probeReach(id, baseUrl);
		row.reachable = probed.reachable;
		row.latencyMs = probed.latencyMs;
		if (probed.status != null) row.httpStatus = probed.status;
		if (probed.error) row.reachError = probed.error;
		if (probed.advertised) {
			row.advertised = probed.advertised;
			row.advertisedSource = "endpoint-list";
		}
	} else {
		row.reachable = null; // unknown, not false: this level opens no socket
		row.latencyMs = null;
	}

	if (level === "spend" && row.reachable === true) {
		const paid = await probeSpend(id, row.model, maxTokens, ceiling);
		row.probe = paid;
	}

	const ok =
		row.auth === "complete" &&
		(level === "auth" || row.reachable === true) &&
		(level !== "spend" || row.probe?.status === "ok");
	row.verdict = ok ? "ok" : "NOT-OK";
	if (!ok) bad += 1;
		if (configKeyGap.length) row.configKeyGap = configKeyGap; // names only — a credential name in a committed file is a defect
	emit(`CHECK ${JSON.stringify(row)}`);
}

emit(`SUMMARY ${JSON.stringify({ level, checked: targets.length, notOk: bad, credentialVarsSeen: credentialNames, cause: bad ? "endpoint-not-ok" : null })}`);

function safeHost(baseUrl) {
	try {
		return new URL(String(baseUrl)).host;
	} catch {
		return String(baseUrl ?? null);
	}
}

// A GET on the OpenAI-compat model list: an HTTP round trip that costs ZERO completion tokens, which is what makes
// "reachable / advertised / latency" answerable without spending. Auth comes from the resolved credential; the
// value is put in a header only and is never interpolated into a printed field.
async function probeReach(id, baseUrl) {
	if (!baseUrl) return { reachable: false, latencyMs: null, error: "base-url-unset" };
	let url;
	try {
		url = new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
	} catch {
		return { reachable: false, latencyMs: null, error: "base-url-unparseable" };
	}
	const auth = await models.getAuth(id).catch((err) => {
		// ModelsError text can carry the provider's URL, which can carry the key — redact() is what makes this safe.
		emit(`NOTE auth-resolution ${String(err?.message ?? err)}`);
		return undefined;
	});
	const headers = auth?.auth?.apiKey ? { authorization: `Bearer ${auth.auth.apiKey}` } : {};
	const started = performance.now();
	try {
		const res = await fetch(url, { headers, signal: AbortSignal.timeout(Math.max(250, timeoutMs)) });
		const latencyMs = Math.round(performance.now() - started);
		const body = await res.text().catch(() => "");
		const ids = parseModelIds(body).slice(0, 12);
		return { reachable: res.status < 500, latencyMs, status: res.status, advertised: ids.length ? ids : undefined, error: res.ok ? undefined : `http-${res.status}` };
	} catch (err) {
		const latencyMs = Math.round(performance.now() - started);
		return { reachable: false, latencyMs, error: String(err?.cause?.code ?? err?.cause?.message ?? err?.message ?? err) };
	}
}

function parseModelIds(text) {
	try {
		const parsed = JSON.parse(text);
		const list = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.models) ? parsed.models : [];
		return list.map((entry) => String(entry?.id ?? entry?.name ?? "")).filter(Boolean);
	} catch {
		return [];
	}
}

// The paid half, gated: an explicit ceiling, a hard token cap, and a cost estimate computed BEFORE the request.
async function probeSpend(id, modelId, cap, ceil) {
	if (!Number.isFinite(ceil) || ceil <= 0) return { status: "refused", cause: "ceiling-required", why: "--spend needs --ceiling=USD; the probe is ~$0.001 and an ungated probe is an unpriced act" };
	const model = models.getModel(id, modelId);
	if (!model) return { status: "refused", cause: "model-unregistered", why: "no row to price, so nothing is sent" };
	const cost = model.cost ?? {};
	const estUsd = ((32 * (cost.input ?? 0)) + (cap * (cost.output ?? 0))) / 1e6;
	if (estUsd > ceil) return { status: "refused", cause: "over-ceiling", estUsd: +estUsd.toFixed(6), ceiling: ceil };
	try {
		const started = performance.now();
		const res = await models.completeSimple(
			model,
			{ systemPrompt: "", messages: [{ role: "user", content: "Reply with exactly one word: ok" }] },
			{ maxTokens: cap, signal: AbortSignal.timeout(Math.max(1000, timeoutMs)) },
		);
		const latencyMs = Math.round(performance.now() - started);
		const usage = res?.usage ?? {};
		const spent = ((Number(usage.input ?? 0) * (cost.input ?? 0)) + (Number(usage.output ?? 0) * (cost.output ?? 0))) / 1e6;
		return {
			status: res?.stopReason === "error" ? "error" : "ok",
			latencyMs,
			tokens: { input: usage.input ?? null, output: usage.output ?? null },
			spentUsd: +spent.toFixed(6),
			ceiling: ceil,
			stopReason: res?.stopReason ?? null,
		};
	} catch (err) {
		return { status: "error", cause: String(err?.cause?.message ?? err?.message ?? err) };
	}
}

flush();
process.exit(bad === 0 ? 0 : 1);

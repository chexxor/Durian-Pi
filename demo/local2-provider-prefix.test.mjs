// demo/local2-provider-prefix.test.mjs — a THIRD locally-served provider prefix must be REGISTERED,
// not assumed (#5648; the code half of the operator's 2026-11-08 directive to move two seats onto the
// LAN box). Run: node demo/local2-provider-prefix.test.mjs   (exit 0 = pass)
//
// FAILING-FIRST. On `main` at 7ccb2163 this file is RED: `LOCAL_ENV_PREFIXES` lists two prefixes
// (`src/providers/local.mjs:41`) and no `DURIG_LOCAL2_*` key is in `CONFIG_KEYS` (`src/config.mjs:111`),
// so `localProviderSpecs()` builds 2 specs and a config file that sets `DURIG_LOCAL2_BASE_URL` is
// accepted-and-ignored (`src/config.mjs:190-196` warns that unknown keys "are silently ignored"). The
// consequence was measured, not guessed: a seat's provider comes ONLY from the leading segment of its
// `model` string (`src/seatmodel.mjs:13-22`), so `"model": "local2/…"` cannot resolve and NO roster edit
// can move a seat to the LAN box until the prefix is registered. The env half was already written and
// measured (`DURIG_LOCAL2_*` in `~/.config/durig/env`, mode 600); it was inert.
//
// NON-VACUOUS BY CONSTRUCTION, in three places:
//   * the UNGATED direction is asserted too — an unset third prefix keeps yielding 2 specs, and the
//     shipped `durig.config.default.json` must NOT widen the default;
//   * the id discrimination pairs `local2` (true) with `local3` (false), so a blanket "any id is local"
//     implementation fails here;
//   * the key inventory is generated per prefix and compared against `CONFIG_KEYS`, so a partially
//     registered family (4 operational keys, price keys forgotten) is caught rather than discovered when
//     a metered endpoint refuses an unpriced spec;
//   * the model id is pinned to what the box actually advertises, AND the guard asserts the boundary it
//     cannot cross: the provider layer passes the model string through verbatim, and the box reroutes an
//     unknown id to whatever is loaded (measured 2026-11-08: a completion asked for
//     `this-model-does-not-exist-abc123` returned `"model": "qwen3.8-flash-next-q2_0"`, `finish_reason:
//     "stop"`). A stale id is invisible at the wire, so registration plus a pinned string is the only control.
//
// Fixture-supplied config only (ROADMAP 294): argv, env and the config file are pinned here; the host's
// real `~/.config/durig/env` and `durig.config.json` are never read.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	CONFIG_KEYS,
} from "../src/config.mjs";
import {
	LOCAL_ENV_PREFIXES,
	declaredLocalWindow,
	isLocalProviderId,
	localProviderSpec,
	localProviderSpecs,
} from "../src/providers/local.mjs";

const ROOT = join(import.meta.dirname, "..");

// The key family `localProviderSpec` + `declaredPrice` READ for any prefix. Generated per prefix on
// purpose: three prefixes × nine keys is the invariant, and hand-listing them is how a family drifts.
const KEY_TAIL = [
	"BASE_URL",
	"MODEL",
	"CONTEXT",
	"MAX_TOKENS",
	"PRICE_USD_IN",
	"PRICE_USD_OUT",
	"PRICE_USD_CACHE_READ",
	"PRICE_AS_OF",
	"PRICE_JSON",
];
const THIRD_PREFIX = "DURIG_LOCAL2_";

// 1. THE UNGATED DIRECTION FIRST: two prefixes configured is STILL two specs. Registering a third
//    prefix must not manufacture a provider that was never configured.
const twoOnly = {
	DURIG_LOCAL_BASE_URL: "http://127.0.0.1:8080/v1",
	DURIG_LOCAL_MODEL: "qwen3.8-flash-next-iq3_s",
	DURIG_LOCAL_CONTEXT: "204800",
	DURIG_LOCAL_MAX_TOKENS: "16384",
	DURIG_VERIFIER_BASE_URL: "http://127.0.0.1:8081/v1",
	DURIG_VERIFIER_MODEL: "verifier-model",
};
const before = localProviderSpecs(twoOnly);
assert.deepEqual(
	before.map((s) => s.id),
	["local", "verifier"],
	"an UNSET third prefix must still yield exactly 2 specs — registration adds a SLOT, not a provider",
);
assert.ok(
	!Object.keys(twoOnly).some((k) => k.startsWith(THIRD_PREFIX)),
	"the fixture really leaves the third prefix unset",
);

// 2. THE SHIPPED DEFAULT MUST NOT WIDEN. A third provider is an operator act, not a factory default.
const shipped = readFileSync(join(ROOT, "durig.config.default.json"), "utf8");
assert.ok(
	!shipped.includes("DURIG_LOCAL2_"),
	"durig.config.default.json gained DURIG_LOCAL2_* — an unset prefix must keep yielding 2 specs",
);

// 3. THE REGISTERED DIRECTION, on the values the operator's LAN box actually serves (measured 2026-11-08:
//    GET /v1/models serves `qwen3.8-flash-next-q2_0` with `meta.n_ctx` 131072 and
//    `architecture.input_modalities ["text"]` — text-only; GET /props reports `total_slots` 4 and
//    `modalities.vision` false). A LAN host is METRED by endpoint (`src/providers/local.mjs:60-77`), so an
//    unpriced spec is a REFUSAL — hence the declared zeros, priced 0 rather than unpriced.
const lan = {
	...twoOnly,
	[`${THIRD_PREFIX}BASE_URL`]: "http://192.168.1.52:8080/v1",
	[`${THIRD_PREFIX}MODEL`]: "qwen3.8-flash-next-q2_0",
	[`${THIRD_PREFIX}CONTEXT`]: "131072",
	[`${THIRD_PREFIX}MAX_TOKENS`]: "16384",
	[`${THIRD_PREFIX}PRICE_USD_IN`]: "0",
	[`${THIRD_PREFIX}PRICE_USD_OUT`]: "0",
	[`${THIRD_PREFIX}PRICE_AS_OF`]: "2026-11-08",
};
const specs = localProviderSpecs(lan);
assert.equal(
	specs.length,
	3,
	`localProviderSpecs() must build 3 specs once the third prefix is configured (got ${specs.length}: ${JSON.stringify(
		specs.map((s) => s.id),
	)})`,
);
const third = specs.find((s) => s.prefix === THIRD_PREFIX);
assert.ok(third, "the third spec carries the DURIG_LOCAL2_ prefix it was built from");
// The id is DERIVED from the prefix (`providerIdForPrefix`), so nothing can drift: assert the derived
// value, not a hand-written constant.
assert.equal(third.id, "local2", "the provider id is derived from the prefix, not hand-written");
assert.equal(third.apiKeyEnv, "DURIG_LOCAL2_API_KEY", "each server keeps its OWN key variable");
assert.equal(third.contextWindow, 131072, "the LAN box's declared window reaches the spec");
assert.equal(third.maxTokens, 16384, "the output budget is per provider, not a constant");
assert.equal(third.modelId, "qwen3.8-flash-next-q2_0", "the model id the box advertises, verbatim — a wrong id never errors at the wire, it reroutes");
assert.equal(third.endpoint, "metered", "a LAN host is metered, not loopback — so it must be priced");
assert.ok(third.price !== null && third.price !== undefined, "the declared zeros price the row");
assert.match(String(third.priceSource), /DURIG_LOCAL2_PRICE_USD_IN/, "the price names its own source key");
assert.equal(third.priceAsOf, "2026-11-08", "an undated price is an undated claim");

// 4. ID DISCRIMINATION, both directions. `local2` is local; an unregistered id is NOT.
assert.equal(isLocalProviderId("local2"), true, "local2 is a local provider id");
assert.equal(isLocalProviderId("local3"), false, "an UNREGISTERED id must stay false — the guard is a set, not a prefix test");
assert.equal(isLocalProviderId("local"), true, "the first family is still local");
assert.ok(
	LOCAL_ENV_PREFIXES.includes(THIRD_PREFIX),
	`the third prefix is in the registration list: ${JSON.stringify(LOCAL_ENV_PREFIXES)}`,
);

// 5. THE KEY INVENTORY: every key the code reads for ANY prefix is declared in `CONFIG_KEYS`. An
//    undeclared key in a config file is accepted-and-ignored (`src/config.mjs:190-196`), which is the
//    exact shape that makes a registered prefix inert.
const missing = [];
for (const prefix of ["DURIG_LOCAL_", "DURIG_VERIFIER_", THIRD_PREFIX])
	for (const tail of KEY_TAIL) if (!CONFIG_KEYS.includes(`${prefix}${tail}`)) missing.push(`${prefix}${tail}`);
assert.deepEqual(
	missing,
	[],
	`${missing.length} config-file key(s) the provider code reads are NOT in CONFIG_KEYS: ${missing.join(", ")}`,
);

// 6. THE ROSTER DEPENDENCY: a seat whose model names the third provider gets ITS declared window.
//    Without this, moving `qa2`/`security` to `local2/…` silently drops their window declaration.
assert.equal(
	declaredLocalWindow(specs, "local2/qwen3.8-flash-next-q2_0"),
	131072,
	"declaredLocalWindow resolves the THIRD provider's window, not only the first two",
);
assert.equal(
	declaredLocalWindow(specs, "local/qwen3.8-flash-next-iq3_s"),
	204800,
	"the first provider's window still resolves (the fix did not move the slot)",
);
assert.equal(
	declaredLocalWindow(specs, "deepinfra/zai-org/GLM-5.3-Flash"),
	null,
	"a remote seat must not inherit a local window",
);

// 7. A PREFIX WITH NO BASE URL builds nothing — "off unless the base URL names a server" is unchanged.
assert.equal(localProviderSpec(lan, "DURIG_NOTHING_"), null, "an unknown prefix builds no spec");

// 8. THE BOUNDARY THIS GUARD CANNOT CROSS, asserted so nobody trusts it further than it goes.
//    `localProviderSpec` is pure config reading: it hands ANY model string through. Measured on the live box:
//    a completion requested for `this-model-does-not-exist-abc123` returned 200 with `"model":
//    "qwen3.8-flash-next-q2_0"` and `finish_reason: "stop"` — llama.cpp/Strata reroutes an unknown id to the
//    loaded model. So a seat moved to the spare box with a stale id looks healthy forever. What protects a seat
//    is (a) the prefix being registered and (b) the rig's model strings matching the registered specs — which
//    is exactly what demo/local-model-pointer.test.mjs compares, and it reads LOCAL_PROVIDER_IDS, so this
//    registration is what makes that guard able to judge a `local2/...` seat at all.
const stale = localProviderSpec({ ...lan, [`${THIRD_PREFIX}MODEL`]: "qwen3.8-flash-next-iq3_s" }, THIRD_PREFIX);
assert.equal(stale.modelId, "qwen3.8-flash-next-iq3_s", "the declared id passes through verbatim: the provider layer does not and cannot validate it against the server");
assert.equal(stale.baseUrl, lan[`${THIRD_PREFIX}BASE_URL`], "the endpoint is the only thing the spec knows about the machine");

console.log(
	`LOCAL2 PROVIDER PREFIX PASS (2 specs ungated, 3 with the prefix configured; id derived to "local2"; local3 still false; ${
		KEY_TAIL.length * 3
	} per-prefix keys declared; third provider's window resolves at 131072)`,
);

// The local provider exposes exactly ONE model id, taken from DURIG_LOCAL_MODEL
// (src/providers/local.mjs), so a seat written as "local/<id>" only resolves when <id> is that
// exact string. Nothing else catches the drift: a stale seat string launches, the provider
// answers "unknown model", and the rig looks healthy while the seat cannot run. This test asks
// the provider itself for its spec -- rather than re-deriving the rule -- and pins every local
// seat to it.
//
// WHY THIS DEMO WAS RED IN EVERY LANDING SCRATCH (#4996). The values it judged lived in
// `durig.config.json`, which is GITIGNORED, so the scratch worktree the lander builds is
// config-less BY CONSTRUCTION: `localProviderSpecs` came back EMPTY while rig.selfdev.json names
// 12 seats on `local/…`/`verifier/…`, and the guard asserted "no provider is configured". That red
// describes the MACHINE, not the branch — a check whose inputs are machine state cannot be a
// landing gate. Measured twice by the lander: `STOPPED: demo/local-model-pointer.test.mjs failed
// in the scratch worktree (exit 1) — main was NOT advanced`. Its own header used to claim it
// "passes in a checkout with no local setup"; that claim was simply false for a rig file that names
// local providers.
//
// TWO HALVES, each saying what it proves:
//   HERMETIC CORE — runs in EVERY tree, GPU or no GPU. It INJECTS a machine config built from
//     rig.selfdev.json's own seat pointers (no model name is hardcoded here, which would make the
//     guard vacuous in the opposite direction), runs it through the real loader and the real spec
//     builder, and requires every local-named seat to pin. It then runs the NEGATIVE case: a config
//     exposing a different model id than a seat names MUST be caught. That is the product behaviour,
//     and it is now judged in a scratch worktree.
//   HOST HALF — only where the machine really configures local providers. Where it does not, the demo
//     prints a `SKIP:` line naming the missing keys and exits 0. A rule it cannot judge is SKIPPED
//     WITH A REASON, never reported as a pass; scripts/land.mjs surfaces that marker in the landing
//     entry, attributed to the scratch tree rather than to the branch (#4996's lander half).
// Run: node demo/local-model-pointer.test.mjs  (exit 0 = pass; PASS line says whether the host half ran or skipped)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, loadShippedDefaults } from "../src/config.mjs";
import {
	LOCAL_PROVIDER_IDS,
	LOCAL_ENV_PREFIXES,
	localProviderSpecs,
} from "../src/providers/local.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rig = JSON.parse(readFileSync(join(root, "rig.selfdev.json"), "utf8"));
// Paths are resolved against the repo root so the demo does not depend on the caller's cwd.
const readRepoFile = (p, enc) => readFileSync(join(root, p), enc);
const noConfigFile = () => {
	const err = new Error("absent — the hermetic core injects its own config");
	err.code = "ENOENT";
	throw err;
};

/** Seats that name a locally-served provider. `local/` and `verifier/` are the ids that module builds. */
const localSeatEntries = (seats) =>
	(seats ?? [])
		.map((seat) => {
			const model = typeof seat.model === "string" ? seat.model : "";
			const slash = model.indexOf("/");
			if (slash < 0) return null;
			const provider = model.slice(0, slash);
			if (!LOCAL_PROVIDER_IDS.includes(provider)) return null;
			return { name: seat.name, provider, modelId: model.slice(slash + 1), model };
		})
		.filter(Boolean);

/**
 * THE GUARD, as a function of (seats, specs) so it can be run against an injected config as well as
 * against the machine's. Returns faults instead of throwing: the caller decides whether a fault is a
 * failure (host half) or the EXPECTED outcome (the negative pair).
 *
 * The guard has to be two-sided: a seat written `verifier/<id>` while DURIG_VERIFIER_BASE_URL is unset does
 * not fail loudly — resolveSeatModel quietly treats the whole string as a model id under the DEFAULT
 * provider, so the seat runs a DIFFERENT model than the rig file claims. That is how a rig intended to be
 * cross-family ends up single-family while still reading healthy.
 */
function pinLocalSeats(seats, specs) {
	const faults = [];
	let pinned = 0;
	for (const seat of seats ?? []) {
		const model = typeof seat.model === "string" ? seat.model : "";
		const slash = model.indexOf("/");
		if (slash < 0) continue;
		const provider = model.slice(0, slash);
		if (!LOCAL_PROVIDER_IDS.includes(provider)) continue; // a remote seat: nothing local to pin it against
		pinned++;
		const spec = specs.find((s) => s.id === provider);
		if (!spec) {
			faults.push(
				`seat "${seat.name}" points at ${model}, but no "${provider}" provider is configured — set ${provider === "local" ? "DURIG_LOCAL" : "DURIG_VERIFIER"}_BASE_URL (and _MODEL). Left unset, the string silently becomes ONE model id under the default provider and the seat runs a different model than this file claims`,
			);
			continue;
		}
		if (model.slice(slash + 1) !== spec.modelId) {
			faults.push(
				`seat "${seat.name}" points at ${model}, but the "${provider}" provider exposes only "${spec.modelId}" — the rig file and the machine config disagree`,
			);
		}
	}
	return { pinned, faults };
}

const entries = localSeatEntries(rig.seats);
assert.ok(
	entries.length > 0,
	`rig.selfdev.json names NO seat on a locally-served provider (${LOCAL_PROVIDER_IDS.join("/")}) — this guard would have nothing to pin; say which way the rig went before trusting a green suite`,
);

// ─── HERMETIC CORE: the machine config is INJECTED, so this half runs in any tree ───
// The injected values are DERIVED from the rig file's own pointers, never written out here: a demo that
// hardcoded "iq3_s" would pass on any machine and judge nothing.
const injectedEnv = {};
for (const { provider, modelId } of entries) {
	const key = `DURIG_${provider.toUpperCase()}_`;
	injectedEnv[`${key}BASE_URL`] = "http://127.0.0.1:0/injected"; // presence registers the provider; nothing connects
	injectedEnv[`${key}MODEL`] = modelId;
}
const injectedCfg = (await loadConfig({ env: injectedEnv, readFile: noConfigFile })).config;
const injectedSpecs = localProviderSpecs(injectedCfg);
assert.equal(
	injectedSpecs.length,
	[...new Set(entries.map((e) => e.provider))].length,
	`the injected config registers one spec per provider the rig names (got ${injectedSpecs.length} for ${[...new Set(entries.map((e) => e.provider))].join(", ")}) — localProviderSpecs is what the rig itself uses, so this is the product path being exercised, not a stub`,
);
const consistent = pinLocalSeats(rig.seats, injectedSpecs);
assert.equal(
	consistent.faults.length,
	0,
	`a config consistent with the rig file must pin every local seat; faults: ${consistent.faults.join(" | ")}`,
);
assert.equal(
	consistent.pinned,
	entries.length,
	`every locally-served seat was pinned (${consistent.pinned}/${entries.length}) — a guard that pins nothing is not evidence`,
);

// THE NEGATIVE PAIR: the same guard against a config whose exposed model id DISAGREES with a seat. This is
// the drift the demo exists to catch, and without this assertion the core could be green by construction.
const driftedProvider = entries[0].provider;
const driftedKey = `DURIG_${driftedProvider.toUpperCase()}_MODEL`;
const driftedEnv = { ...injectedEnv, [driftedKey]: `${entries[0].modelId}-but-renamed` };
const driftedSpecs = localProviderSpecs(
	(await loadConfig({ env: driftedEnv, readFile: noConfigFile })).config,
);
const drifted = pinLocalSeats(rig.seats, driftedSpecs);
assert.ok(
	drifted.faults.length >= 1,
	`a config exposing "${driftedEnv[driftedKey]}" while the rig names "${entries[0].model}" MUST be caught — the guard passed it, so it is not a guard`,
);
assert.ok(
	drifted.faults.some((f) => f.includes("disagree") && f.includes(entries[0].name)),
	`the fault must name the seat and the disagreement, because that is the only thing an operator can act on: ${drifted.faults[0] ?? "(none)"}`,
);

// And the one-sided failure the two-sided guard exists for: a provider the config does NOT register while a
// seat still names it. Quiet in production (the default provider swallows the prefix), loud here.
const unregisteredProvider = entries[0].provider;
const halfEnv = { ...injectedEnv };
for (const prefix of LOCAL_ENV_PREFIXES) {
	if (prefix === `DURIG_${unregisteredProvider.toUpperCase()}_`) {
		delete halfEnv[`${prefix}BASE_URL`];
		delete halfEnv[`${prefix}MODEL`];
	}
}
const halfSpecs = localProviderSpecs(
	(await loadConfig({ env: halfEnv, readFile: noConfigFile })).config,
);
const half = pinLocalSeats(rig.seats, halfSpecs);
const namingUnregistered = entries.filter((e) => e.provider === unregisteredProvider).length;
assert.ok(
	half.faults.length === namingUnregistered &&
		half.faults.every((f) => f.includes("provider is configured")),
	`un-registering "${unregisteredProvider}" must fault exactly the ${namingUnregistered} seats naming it and nothing else: got ${half.faults.length} — ${half.faults.map((f) => f.slice(0, 60)).join(" | ") || "(none)"}`,
);

// ─── HOST HALF: the machine's real config, judged only where it exists ───
const { values: defaults } = await loadShippedDefaults({ readFile: readRepoFile });
const { config, source } = await loadConfig({ env: process.env, readFile: readRepoFile, defaults });
const hostSpecs = localProviderSpecs(config);
let hostLine;
if (hostSpecs.length === 0) {
	// Machine state, not repo state. Skipped WITH a reason — never reported as a pass (#4996). The lander
	// greps this marker and attributes the skip to the scratch tree rather than to the branch.
	console.log(
		`SKIP: no local provider is configured on this machine (no ${LOCAL_ENV_PREFIXES.map((p) => `${p}BASE_URL`).join(" / ")} in ${source ?? "the shipped defaults"}), while rig.selfdev.json names ${entries.length} seat(s) on ${[...new Set(entries.map((e) => e.provider))].join("/")}. This half judges MACHINE state, so it is skipped here, not passed. The hermetic core above still ran.`,
	);
	hostLine = "host half: SKIPPED (config-less tree)";
} else {
	const host = pinLocalSeats(rig.seats, hostSpecs);
	for (const fault of host.faults) assert.fail(fault);
	assert.ok(
		host.pinned > 0,
		`the machine config registers ${hostSpecs.length} local provider(s) — ${hostSpecs.map((s) => s.id).join(", ")} — but no seat in rig.selfdev.json names any of them, so this guard checked nothing. Say which way the rig went before trusting a green suite`,
	);
	hostLine = `host half: PINNED ${host.pinned} seat(s) against ${hostSpecs.map((s) => `${s.id}=${s.modelId}`).join(", ")}`;
}

console.log(
	`LOCAL MODEL POINTER PASS (locally-served providers=${[...new Set(entries.map((e) => `${e.provider}`))].join(",")}, rig pointers=${entries.length}, hermetic core=PINNED ${consistent.pinned}/${entries.length} + negative pair caught, ${hostLine})`,
);

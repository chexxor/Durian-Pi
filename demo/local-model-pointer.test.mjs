// The local provider exposes exactly ONE model id, taken from DURIG_LOCAL_MODEL
// (src/providers/local.mjs), so a seat written as "local/<id>" only resolves when <id> is that
// exact string. Nothing else catches the drift: a stale seat string launches, the provider
// answers "unknown model", and the rig looks healthy while the seat cannot run. This test asks
// the provider itself for its spec -- rather than re-deriving the rule -- and pins every local
// seat to it. It reads the machine's config through the same loader the rig uses, so it passes
// in a checkout with no local setup (where no provider is registered at all).
// Run: node demo/local-model-pointer.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, loadShippedDefaults } from "../src/config.mjs";
import { LOCAL_PROVIDER_IDS, localProviderSpecs } from "../src/providers/local.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rig = JSON.parse(readFileSync(join(root, "rig.selfdev.json"), "utf8"));
// Paths are resolved against the repo root so the demo does not depend on the caller's cwd,
// and a checkout with no machine config simply loads the shipped defaults.
const readRepoFile = (p, enc) => readFileSync(join(root, p), enc);
const { values: defaults } = await loadShippedDefaults({ readFile: readRepoFile });
const { config } = await loadConfig({ env: process.env, readFile: readRepoFile, defaults });
const specs = localProviderSpecs(config);
let pinned = 0;

// Pin EVERY seat that names a locally-served provider to the model that provider actually exposes, for BOTH
// providers. The guard has to be two-sided: a seat written `verifier/<id>` while DURIG_VERIFIER_BASE_URL is
// unset does not fail loudly — resolveSeatModel quietly treats the whole string as a model id under the
// default provider, so the seat would run a DIFFERENT model than the rig file claims. That is how a rig
// intended to be cross-family ends up single-family while still reading healthy.
for (const seat of rig.seats ?? []) {
	const model = typeof seat.model === "string" ? seat.model : "";
	const slash = model.indexOf("/");
	if (slash < 0) continue;
	const provider = model.slice(0, slash);
	if (!LOCAL_PROVIDER_IDS.includes(provider)) continue; // a remote seat: nothing local to pin it against
	pinned++; // count it: a guard that pins nothing must not read as a pass (see the check after the loop)
	const spec = specs.find((s) => s.id === provider);
	assert.ok(
		spec,
		`seat "${seat.name}" points at ${model}, but no "${provider}" provider is configured — set ${provider === "local" ? "DURIG_LOCAL" : "DURIG_VERIFIER"}_BASE_URL (and _MODEL) in the machine's config. Left unset, the string silently becomes ONE model id under the default provider and the seat runs a different model than this file claims`,
	);
	assert.equal(
		model.slice(slash + 1),
		spec.modelId,
		`seat "${seat.name}" points at ${model}, but the "${provider}" provider exposes only "${spec.modelId}" — the rig file and the machine config disagree`,
	);
}

// A guard that pinned nothing is not evidence. If the machine config registers local providers but no seat
// names one, the rig file and the config disagree in the OPPOSITE direction from the case above, and a green
// run here would mean only that the loop had nothing to do.
assert.ok(
	specs.length === 0 || pinned > 0,
	`the machine config registers ${specs.length} local provider(s) — ${specs.map((s) => s.id).join(", ")} — but no seat in rig.selfdev.json names any of them, so this guard checked nothing. Say which way the rig went before trusting a green suite`,
);

console.log(
	`LOCAL MODEL POINTER PASS (providers=${specs.length === 0 ? "none" : specs.map((s) => `${s.id}=${s.modelId}`).join(", ")}, pinned seats=${pinned})`,
);

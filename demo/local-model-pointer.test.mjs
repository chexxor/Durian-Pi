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
import { LOCAL_PROVIDER_ID, localProviderSpec } from "../src/providers/local.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rig = JSON.parse(readFileSync(join(root, "rig.selfdev.json"), "utf8"));
// Paths are resolved against the repo root so the demo does not depend on the caller's cwd,
// and a checkout with no machine config simply loads the shipped defaults.
const readRepoFile = (p, enc) => readFileSync(join(root, p), enc);
const { values: defaults } = await loadShippedDefaults({ readFile: readRepoFile });
const { config } = await loadConfig({ env: process.env, readFile: readRepoFile, defaults });
const spec = localProviderSpec(config);

const prefix = `${LOCAL_PROVIDER_ID}/`;
const localSeats = (rig.seats ?? []).filter((s) => typeof s.model === "string" && s.model.startsWith(prefix));

for (const seat of localSeats) {
	assert.ok(
		spec !== null,
		`seat "${seat.name}" points at ${seat.model}, but no local provider is registered — set DURIG_LOCAL_BASE_URL (and DURIG_LOCAL_MODEL) in the machine's config`,
	);
	assert.equal(
		seat.model.slice(prefix.length),
		spec.modelId,
		`seat "${seat.name}" points at ${seat.model}, but the local provider exposes only "${spec.modelId}" — the rig file and the machine config disagree`,
	);
}

console.log(
	`LOCAL MODEL POINTER PASS (provider=${spec === null ? "off" : spec.modelId}, local seats=${localSeats.length === 0 ? "none" : localSeats.map((s) => s.name).join(",")})`,
);

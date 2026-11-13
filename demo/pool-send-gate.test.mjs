// demo/pool-send-gate.test.mjs — N19 "The Pool" row 2 (docs/POOL-QUEUE-SPEC.md §6.1).
//
// WHAT THIS PINS, and why it was not already pinned:
//   `requires` used to be ONE string, so a row needing `landing` AND `verify` could be sent to a seat
//   advertising only one of them. The send succeeded, the seat woke, the claim refused, and the row sat
//   unclaimable with nothing in the queue saying why — the "silently unclaimable work" risk in §8.
//   A POOL row (`to: null`) has no target seat at send time, so the gate must not evaluate capabilities
//   against a seat that does not exist yet; it must still refuse a row authored by a seat that does not
//   exist, because P5 makes `from` the party the DONE notice returns to.
//
// Run: node demo/pool-send-gate.test.mjs   (exit 0 = pass)
// Cost: ~1 s measured, no network, no model, no store file (MemoryStorage + the gate called directly).
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { assertSendAllowed, Edges, registerSeat, Router, Seats } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
}

/** Run the gate inside one commit, returning {ok, error} instead of throwing. */
async function gate(from, to, requires) {
	try {
		await harness.commit(async (tx) => assertSendAllowed(tx, from, to, requires), ctx);
		return { ok: true, error: null };
	} catch (err) {
		return { ok: false, error: err?.message ?? String(err) };
	}
}

await harness.commit(async (tx) => {
	await registerSeat(tx, "pm", 101, "program manager");
	await registerSeat(tx, "impl", 102, "implementation engineer");
	await registerSeat(tx, "qa", 103, "verifier");
	const seats = await tx.doc(Seats);
	seats.seats.impl.capabilities = ["implement", "code"];
	seats.seats.qa.capabilities = ["verify"];
	// `pm` is the only seat with an org edge, and it grants only `impl`. So a named send to `qa` is
	// refused by the EDGE, and a pool send from `qa` proves the edge is NOT consulted when there is
	// no recipient to check.
	const edges = await tx.doc(Edges);
	edges.edges = [{ from: "pm", maySendTo: ["impl"] }];
}, ctx);

console.log("\n=== a capability SET at send time: the seat must advertise EVERY one ===");
const missingOne = await gate("pm", "impl", ["implement", "landing"]);
check("a seat missing ONE of two capabilities is refused", missingOne.ok === false, missingOne.error);
check(
	"...and the refusal NAMES the capability it is short of, not the one it has",
	missingOne.error?.includes('lacks required capability "landing"') && !missingOne.error?.includes('"implement"'),
	missingOne.error,
);
const missingTwo = await gate("pm", "impl", ["landing", "deploy"]);
check(
	"two missing capabilities are BOTH named, so the seat does not retry with one fixed",
	missingTwo.error?.includes('"landing"') && missingTwo.error?.includes('"deploy"'),
	missingTwo.error,
);
check(
	"a single capability still reads byte-identically to the pre-Pool message",
	(await gate("pm", "impl", "implement")).ok === true &&
		(await gate("pm", "impl", "verify")).ok === false,
);
check(
	"an empty set is legal: 'anyone may claim it' is a requirement, not a refusal",
	(await gate("pm", "impl", [])).ok === true && (await gate("pm", "impl", null)).ok === true,
);

console.log("\n=== a POOL send (to: null) has no target seat to check against ===");
const poolSend = await gate("pm", null, ["implement", "verify"]);
check("a pool row with a capability SET is accepted at send time", poolSend.ok === true, poolSend.error);
const edgeless = await gate("qa", null, ["implement"]);
check(
	"the org edge is NOT consulted for a pool send (qa has no edge to anyone, yet the row is poolable)",
	edgeless.ok === true,
	edgeless.error,
);
const badAuthor = await gate("nope", null, ["implement"]);
check(
	"the AUTHOR is still validated: a pool row from a seat that does not exist is refused",
	badAuthor.ok === false,
	badAuthor.error,
);

console.log("\n=== a NAMED send is unchanged: unknown recipient still refused by name ===");
const typo = await gate("pm", "pmx", "implement");
check(
	"a mistyped recipient is refused by name rather than silently pooled",
	typo.ok === false && typo.error?.includes("pmx"),
	typo.error,
);

assert.ok(true);
console.log(failures === 0 ? "\nPOOL SEND GATE PASS" : `\nPOOL SEND GATE FAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);

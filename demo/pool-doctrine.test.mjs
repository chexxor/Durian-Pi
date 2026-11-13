// demo/pool-doctrine.test.mjs — N19 "The Pool", the doctrine half: a seat is TOLD the pool exists,
// where its work comes from, and what to do when a pool row is too big for it.
//
// WHY THIS FILE EXISTS (a measurement, not a wish). Measured 2026-11-13 before this change: the word
// "pool" appeared 0 times in the 12 seat personas (`prompts/*.md`), 0 times in `rig.selfdev.json`, and
// `peek_queue`'s description still said "items addressed to or sent by you" — a sentence row 4 of the
// spec made false the day pool rows became visible to every seat. `WAKE_CONTENT` said "the oldest item
// addressed to you", which is the exact prompt-lies-at-the-wake class #4557 was written to close. A
// mechanism no seat is told about is a mechanism no seat uses.
//
// THE SURFACE CHOSEN, and why: `constitution.txt` -> the `durig-constitution` system-prompt section.
// It is ONE text that reaches EVERY seat's system prompt on every request (src/rig.mjs, the
// `section("durig-constitution", ...)` in the Router extension), so the doctrine cannot fork into 12
// divergent persona copies, and it is re-injected per request rather than committed as a conversation
// entry, which is what lets it survive compaction. A per-seat paragraph would have to be written 12
// times and re-verified 12 times; the check rule that would keep them in sync would be bigger than the
// doctrine.
//
// FAILING-FIRST: on HEAD the constitution has no pool paragraph, `peek_queue`'s description says
// "addressed to or sent by you", `WAKE_CONTENT` says "oldest item addressed to you", and
// `queueItemLine` prints no requirement — so every assertion below fails.
//
// Run: node demo/pool-doctrine.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { queueItemLine, Router } from "../src/rig.mjs";
import { WAKE_CONTENT, WAKE_CONTENT_PARKED, WAKE_CONTENT_STALLED } from "../src/driver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

/* ─── 1. the shared surface: one paragraph, every seat ───────────────────── */
const constitution = readFileSync(join(root, "constitution.txt"), "utf8");
console.log("\nthe constitution is the ONE surface the doctrine lives in");
const poolLines = constitution.split("\n").filter((l) => /\bpool\b/i.test(l));
check("exactly ONE pool paragraph in the constitution (not 12 copies, not two drifted ones)", poolLines.length === 1, `${poolLines.length}: ${poolLines.map((l) => l.slice(0, 60)).join(" | ")}`);
const doctrine = poolLines[0] ?? "";
check("it says where pool work comes from", /`claim_work` takes the OLDEST row you are ELIGIBLE for/.test(doctrine) && /open pool row \(no owner of record\)/.test(doctrine), doctrine.slice(0, 200));
check("it says eligibility is enforced by the claim, not by the seat's judgement", /Eligibility is decided by the claim, not by judgement/.test(doctrine), doctrine.slice(0, 300));
check("it names the capability SET a claimant must advertise in full", /`requires` capability SET you advertise in full/.test(doctrine), doctrine.slice(0, 300));
check("it names the size gate and the split response", /tier fits inside 70 % of your usable context window/.test(doctrine) && /closedAs: \"split\"/.test(doctrine), doctrine.slice(0, 400));
check("it says a pool claim is NOT messaged to the author and is read from the census", /recorded on the row as owner-of-record and is NOT messaged to the author/.test(doctrine) && /legible only in the census/.test(doctrine), doctrine.slice(0, 400));
check("it is a priority rule, so it is ordered with the rest of the constitution", /^P\d Pool:/.test(doctrine), doctrine.slice(0, 20));
check("the constitution reaches every seat as a per-request system-prompt section (so it survives compaction)", (Router.sections ?? []).some((s) => s.key === "durig-constitution"), JSON.stringify((Router.sections ?? []).map((s) => s.key)));

console.log("\nthe personas do NOT carry their own copy of the doctrine");
const personas = readdirSync(join(root, "prompts")).filter((f) => f.endsWith(".md"));
check("there are persona files to check at all", personas.length > 0, personas.join(", "));
const withPoolDoctrine = personas.filter((f) => /queue pool|pool row|open pool|pool: true/i.test(readFileSync(join(root, "prompts", f), "utf8")));
check("no persona invents its own pool doctrine (12 copies would drift)", withPoolDoctrine.length === 0, withPoolDoctrine.join(", "));

/* ─── 2. the tool surface the seat actually reads ─────────────────────────── */
const tools = Router.tools ?? [];
const peek = tools.find((t) => t.name === "peek_queue");
const claim = tools.find((t) => t.name === "claim_work");
const revise = tools.find((t) => t.name === "revise_work");
console.log("\npeek_queue no longer claims addressed-only scope");
check("the description exists", !!peek, "");
check("it names the shared pool", /shared pool/.test(peek?.description ?? "") && /pool: true/.test(peek?.description ?? ""), (peek?.description ?? "").slice(0, 240));
check("it no longer says the addressed-or-sent-by-you scope that row 4 made false", !/addressed to or sent by you/.test(peek?.description ?? ""), (peek?.description ?? "").slice(0, 240));
check("it says every open pool row is visible to every seat, eligible or not (the shipped rule)", /visible to every seat, eligible or not/.test(peek?.description ?? ""), (peek?.description ?? "").slice(0, 300));
check("claim_work's own description names the pool and the SET (the doctrine is not a paraphrase of a tool)", /open POOL row/.test(claim?.description ?? "") && /capability SET/.test(claim?.description ?? ""), (claim?.description ?? "").slice(0, 260));
check("revise_work names the annotation path, its authority and its limit", /`requires`/.test(revise?.description ?? "") && /never changes any seat's own capabilities/.test(revise?.description ?? ""), (revise?.description ?? "").slice(0, 300));

console.log("\nthe wake says what the claim actually does");
check("the wake is a fixed string (the prompt-cache contract, ROADMAP 33)", typeof WAKE_CONTENT === "string" && !WAKE_CONTENT.includes("${"), WAKE_CONTENT);
check("the wake names eligibility, not addressee-only", /oldest item you are ELIGIBLE for/.test(WAKE_CONTENT) && /open pool row/.test(WAKE_CONTENT), WAKE_CONTENT);
check("...and it no longer promises an item addressed to the seat", !/oldest item addressed to you/.test(WAKE_CONTENT), WAKE_CONTENT);
check("the stalled and parked wakes are untouched (they already name their own state)", /resume_work/.test(WAKE_CONTENT_STALLED) && /parked rows/.test(WAKE_CONTENT_PARKED));

/* ─── 3. the requirement is visible in the line a seat reads ─────────────── */
console.log("\nqueueItemLine shows the requirement, and shows nothing when there is none");
const plain = queueItemLine({ id: 9, status: "queued", from: "pm", to: "impl", subject: "no requirement", transitions: [] }, []);
check("a row with no `requires` renders EXACTLY as it did before N19", plain === "#9 queued from=pm to=impl no requirement", plain);
const needed = queueItemLine({ id: 10, status: "queued", from: "pm", to: null, pool: true, subject: "audit the census", requires: ["verify", "review"], transitions: [] }, []);
check("an open pool row shows to=POOL and its capability SET", needed === "#10 queued from=pm to=POOL requires=verify,review audit the census", needed);
const oneCap = queueItemLine({ id: 11, status: "queued", from: "pm", to: null, pool: true, subject: "single cap", requires: "verify", transitions: [] }, []);
check("a one-capability row prints the string, not brackets", oneCap.includes("requires=verify") && !oneCap.includes("requires=["), oneCap);
const gated = queueItemLine({ id: 12, status: "queued", from: "pm", to: null, pool: true, subject: "gated pool row", requires: "verify", blockedBy: [3], transitions: [] }, [{ id: 3, status: "cancelled" }]);
check("the gate and the dead-gate markers still render alongside the requirement", gated.includes("requires=verify") && gated.includes("blockedBy=3") && gated.includes("DEAD-GATE=#3"), gated);

assert.ok(true);
console.log(
	failures === 0
		? "\nPOOL DOCTRINE PASS (one paragraph in the shared constitution, named in the wake, in peek_queue, and in the line a seat reads)"
		: `\nPOOL DOCTRINE FAIL — ${failures} check(s)`,
);
process.exit(failures === 0 ? 0 : 1);

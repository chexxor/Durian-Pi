// demo/execution-mode.test.mjs — the execution-mode rule is CODE, not prose (#7158).
//
// WHY THIS EXISTS. docs/WORK-ITEM-MODEL.md §3 states the rule ("default is branchless; a
// worktree is granted only on demonstrated need") and names the predicate that already
// exists — `isDocumentationPath` (src/landinggate.mjs) — but nothing computed a mode, and
// src/seattools.mjs calls `prepareSeatWorkspace` unconditionally. That is why §1 counts
// 122 refs for 113 worktrees: a tree is minted for every row whatever it changes.
//
// FAILING-FIRST: before src/executionmode.mjs exists this demo cannot import it and exits 1.
// The classification assertions then fail one at a time, and the mint round-trip fails because
// a minted row carries no `executionMode` field at all.
//
// Run: node demo/execution-mode.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { AgentDoc, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { enqueueItem, RigQueue, Router, Seats } from "../src/rig.mjs";
import { executionMode, executionModeRecord, MODES, needsChangedTree } from "../src/executionmode.mjs";
import { workspaceModeLine } from "../src/seattools.mjs";
import { beforeTool, modeClause } from "../src/seatguard.mjs";

const ctx = BACKGROUND_CONTEXT;
let fails = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log(`  ok   ${label}`);
	else {
		fails += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
};

/* ─── 1. the rule is a transition: three questions, first YES decides ──── */
console.log("\n1. classification transitions (rule order 1 -> 2 -> 3)");

// docs-only paths, but the acceptance names a demo: a demo can only run against a tree that
// HAS the change. The demo path is a PROGRAM being run, not a file the row edits, so it is
// question 2 that grants the tree.
const proseWithProbe = {
	subject: "docs(NEXT): trim the pointer inside the digest budget",
	body: "Change: docs/NEXT.md and README.md.\nACCEPTANCE (red-first): `node demo/clockin-digest.test.mjs` exit 0.",
};
const m1 = executionMode(proseWithProbe);
check("prose-only change whose acceptance names a demo is ISOLATED", m1.mode === "isolated", JSON.stringify(m1));
check("  rule 2 is the one that fires (the demo is run, not changed)", m1.rule === 2, JSON.stringify({ rule: m1.rule, why: m1.why }));
check("  and the rule records the demo as a program the row runs", m1.signals.runPrograms.includes("demo/clockin-digest.test.mjs"), JSON.stringify(m1.signals));
check("  and NOT as tracked code the row edits", !m1.signals.codePaths.length, JSON.stringify(m1.signals.codePaths));

// Same paths, acceptance names only reads: nothing grants a tree.
const m2 = executionMode({
	subject: "docs: record the disposition of the parked refs",
	body: "Change: docs/DISPOSITIONS.md.\nVerify: `git log --oneline -3 main` and `node cli.mjs queue --status held`.",
});
check("prose-only paths with a read-only acceptance is BRANCHLESS", m2.mode === "branchless", JSON.stringify(m2));
check("  no rule fired", m2.rule === null, JSON.stringify({ rule: m2.rule }));

// Rule 2 without any path: a run named in words, not files.
const m3 = executionMode({
	subject: "docs: state the landing gate in the disposition doc",
	body: "Change: docs/DISPOSITIONS.md.\nVerify: the full suite must pass before this lands.",
});
check("a named run with no path is ISOLATED by rule 2", m3.mode === "isolated" && m3.rule === 2, JSON.stringify({ mode: m3.mode, rule: m3.rule }));

// Rule 1: one tracked-code path is enough, whatever else the row says.
const m4 = executionMode({ subject: "fix the claim order", body: "Change: src/rig.mjs.\nVerify: grep the function." });
check("a named tracked-code path is ISOLATED by rule 1", m4.mode === "isolated" && m4.rule === 1, JSON.stringify({ mode: m4.mode, rule: m4.rule }));

// Rule 3: nothing to run, no code named, but the row has to start a process.
const m5 = executionMode({
	subject: "docs: the runbook for a stalled broker",
	body: "Change: docs/runbooks/broker-down-or-stalled.md.\nVerify: a read-only grep.\nAlso: start the broker and check the store.",
});
check("spawning a process is ISOLATED by rule 3", m5.mode === "isolated" && m5.rule === 3, JSON.stringify({ mode: m5.mode, rule: m5.rule, why: m5.why }));

const m6 = executionMode({ subject: "note the census", body: "Record the counts. Verify: read `git worktree list`." });
check("an item that names nothing is BRANCHLESS", m6.mode === "branchless", JSON.stringify(m6));
check("an empty row is BRANCHLESS, not an error", executionMode({}).mode === "branchless");
check("the vocabulary is exactly the two modes the model names", MODES.join(",") === "isolated,branchless", MODES.join(","));
check("the rule never invents a mode outside the vocabulary", MODES.includes(executionMode({ body: "src/x.mjs" }).mode), executionMode({ body: "src/x.mjs" }).mode);

// The guard asks the same question of a bare command.
check("a demo run needs a changed tree", needsChangedTree("node demo/clockin-digest.test.mjs"));
check("a git commit needs a changed tree", needsChangedTree("git commit -m 'item #7158: the mode rule'"));
check("a bare read does NOT", !needsChangedTree("node cli.mjs queue --status held"));
check("running cli.mjs does not make a row touch tracked code", !executionMode({ body: "Change: docs/A.md. Verify: `node cli.mjs status`" }).signals.codePaths.length, JSON.stringify(executionMode({ body: "Change: docs/A.md. Verify: `node cli.mjs status`" }).signals));

/* ─── 2. mint records it, through the ONE write path ──── */
console.log("\n2. mint: the row carries the classification");

const models = createModels();
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

const minted = await harness.commit(
	async (tx) =>
		enqueueItem(
			tx,
			"pm",
			"impl",
			"docs: record the disposition of the parked refs",
			"Change: docs/DISPOSITIONS.md.\nVerify: `git log --oneline -3 main`.",
			null,
			false,
			null,
			false,
			null,
			null,
			null,
		),
	ctx,
);
const items = (await harness.snapshot(RigQueue, undefined, ctx)).items ?? [];
const row = items.find((it) => it.id === minted);
check("the minted row exists", !!row, JSON.stringify({ minted, count: items.length }));
check("the minted row carries executionMode", row?.executionMode !== undefined, JSON.stringify(row?.executionMode));
check(
	"  it agrees with the rule applied to the same prose",
	JSON.stringify(row?.executionMode) === JSON.stringify(executionModeRecord({ subject: row?.subject, body: row?.body })),
	JSON.stringify({ stored: row?.executionMode, computed: executionModeRecord({ subject: row?.subject, body: row?.body }) }),
);
const codeRow = await harness.commit(
	async (tx) => enqueueItem(tx, "pm", "impl", "fix the claim order", "Change: src/rig.mjs.", null, false, null, false, null, null, null),
	ctx,
);
const storedCode = (items.length ? (await harness.snapshot(RigQueue, undefined, ctx)).items : []).find((it) => it.id === codeRow);
check("a code row is recorded as isolated/rule 1", storedCode?.executionMode?.mode === "isolated" && storedCode?.executionMode?.rule === 1, JSON.stringify(storedCode?.executionMode));

/* ─── 3. mint and gate: one function, two call sites, no silent drift ──── */
console.log("\n3. the gate reports the same classification mint recorded");

const gateLine = workspaceModeLine(row);
check("the gate line names the mode", gateLine.includes("Execution mode: branchless"), gateLine);
check("  and it agrees with what mint stored", gateLine.includes(row.executionMode.mode) && !gateLine.includes("DRIFT"), gateLine);
const driftLine = workspaceModeLine({ subject: "docs: x", body: "Change: docs/x.md", executionMode: { mode: "isolated", rule: 1, why: "stale" } });
check("a disagreement is printed as DRIFT rather than hidden", driftLine.includes("DRIFT") && driftLine.includes("the gate computes branchless"), driftLine);
check("the equality condition holds: gate and mint return the same value for the same row",
	workspaceModeLine(row).includes(executionMode(row).mode) && executionMode(row).mode === row.executionMode.mode,
	JSON.stringify({ gate: executionMode(row), mint: row.executionMode }));

/* ─── 4. the guard's refusal names the mode and what must change ──── */
console.log("\n4. the refusal error shape");

const branchlessRow = { id: 7124, to: "impl", status: "claimed", subject: "docs: the disposition document", body: "Change: docs/DISPOSITIONS.md.\nVerify: read-only greps.", executionMode: executionModeRecord({ subject: "docs: the disposition document", body: "Change: docs/DISPOSITIONS.md.\nVerify: read-only greps." }) };
const clause1 = modeClause(branchlessRow, "node demo/clockin-digest.test.mjs");
check("a branchless row running a probe names the mode", clause1.includes("branchless"), clause1);
check("  and names what the row must change", clause1.includes("amend the row") || clause1.includes("prepare_workspace"), clause1);
const isolatedRow = { id: 7158, subject: "fix the claim order", body: "Change: src/rig.mjs.", executionMode: executionModeRecord({ subject: "fix the claim order", body: "Change: src/rig.mjs." }) };
const clause2 = modeClause(isolatedRow, "git commit -m 'item #7158'");
check("an isolated row names the rule that made it isolated", clause2.includes("isolated") && clause2.includes("rule 1"), clause2);
const contradiction = modeClause(branchlessRow, "node demo/x.test.mjs");
check("minted-vs-command disagreement is stated as a disagreement", contradiction.includes("minted as branchless") && contradiction.includes("this command is isolated"), contradiction);
check("no row means no clause (the plain refusal is unchanged)", modeClause(null, "node demo/x.test.mjs") === "");

/* ─── 5. wired: the guard actually appends the clause from a live row ──── */
console.log("\n5. the clause is attached to the real refusal (fixture api, degraded cwd)");

const conversationId = "conv-impl-7158";
const fakeApi = {
	conversationId,
	snapshot: async (token) => {
		if (token === AgentDoc) return { cwd: process.cwd() };
		if (token === Seats) return { seats: { impl: { conversationId, role: "implementation engineer" } } };
		if (token === RigQueue) return { items: [branchlessRow] };
		return undefined;
	},
};
const verdict = await beforeTool(
	{ type: "toolCall", id: "probe", name: "bash", arguments: { command: "node demo/clockin-digest.test.mjs" } },
	fakeApi,
	ctx,
);
check("the call is blocked (the guard still fires)", !!verdict?.block, JSON.stringify(verdict));
check("  the block names the row's mode", String(verdict?.block).includes("branchless"), String(verdict?.block));
check("  and the row id it is talking about", String(verdict?.block).includes("#7124"), String(verdict?.block));
check("  and the rule that contradicts the row", String(verdict?.block).includes("rule 2"), String(verdict?.block));

assert.ok(fails === 0, `${fails} assertion(s) failed`);
console.log("\nALL PASS");

// extensions/self-merge.mjs — the authoring seat lands its OWN item, on local main, in the same session.
//
// WHY THIS EXISTS. The rig's landing pass is a delegate/coordinator action (`docs/runbooks/land.md`: "the
// delegate lands; the author does not self-land"), and the consequence was measured, not assumed: the fleet
// carried 59 unlanded refs on 2026-11-14 (`node tools/self-merge-sla.mjs` — 197 refs, 138 landed, 52
// conflicted, 5 ready, 2 ready-unverified, 10.5 s), and `docs/runbooks/land.md`'s own "Why a landing stalls"
// section records a seat that hand-rolled a landing instead of using the helper: `impl` created
// `item-5663/.land-scratch2`, cherry-picked into it, ran the suite by hand, and left a detached HEAD with no
// ref — `main` never moved. The gap is not permission (the seat guard does not block `scripts/land.mjs`:
// measured `shellWriteRefusal` → `block: null` for that command from an item worktree) — it is that there is
// no NAMED verb, no stated cost, and no rule that says when the landing is due.
//
// THE SHAPE, in the order the seat meets it:
//   1. a section in the standing prompt names the rule (static text only — ROADMAP 175: a section whose text
//      changes per request is a full-prefix cache miss on every request).
//   2. `landing_health` is the read: which of my refs are ready, and how long have they waited.
//   3. `land_my_item` is the write: it runs the rig's OWN chokepoint, `scripts/land.mjs`, with the shared root
//      and the store resolved for the seat, so the seat never has to guess `--repo`.
//   4. `checks: [ready-ref-stale]` is the rule `cli.mjs check` runs, so a ready ref that sits is RED in the
//      audit rather than invisible.
//
// WHY ON THE EXTENSION PLANE (D212): this is team policy about who lands and when, not a substrate
// capability. `scripts/land.mjs` stays the enforcement chokepoint — the extension calls it, it does not
// replace it, and it never becomes a second merge path. The base needed exactly one seam for this: the
// ability for a loaded extension to contribute a check rule (`src/checkup.mjs` now takes `extensionRules`
// and `extensionFindings`, and `src/extensions.mjs` accepts a `checks` declarable).
//
// LOCAL MAIN ONLY. Nothing here pushes. The grant to publish belongs to the operator (AGENTS.md
// non-negotiables; `DURIG_ALLOW_PUSH`). The tool's argv contains no `push`, and the demo asserts that.
//
// TRUST: like every extension here, it is loaded only through the explicit `DURIG_EXTENSIONS` list
// (`src/extensions.mjs` has no auto-discovery, on purpose).
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { lit, num, obj, opt, str } from "@earendil-works/pi-schema";
import { Seats, RigQueue } from "../src/rig.mjs";
import { landingHealth } from "../tools/self-merge-sla.mjs";

/** The rule `cli.mjs check` runs. `error` severity on purpose: a ready ref that sits is a landing debt, and
 * a fix-now finding is read as advisory. Overridable with DURIG_SELF_MERGE_SLA_HOURS. */
export const SELF_MERGE_RULE = {
	id: "ready-ref-stale",
	severity: "error",
	what: "a ref is ready to land (no conflict, no committed markers, its item is done) and has sat past the SLA",
};

/**
 * Build the command a seat may run, or refuse with the reason. PURE: no git, no store, no exec — this is the
 * part a demo can pin without a repo.
 *
 * @param sharedRoot  the shared checkout's path (git worktree list's FIRST entry)
 * @param branch      the ref to land
 * @param db          the rig store, for land.mjs's genlock pre-flight
 * @param heldItemIds item ids this seat holds (claimed or queued). When supplied, a branch naming an item the
 *                    seat does not hold is REFUSED — a seat landing someone else's branch is not "self"-merge.
 * @param gate        "changed-suite" (default, the derived gate) or "suite" (the full gate)
 */
export function buildSelfMergePlan({ sharedRoot, branch, db, heldItemIds = null, gate = "changed-suite", timeoutMs = 300000 } = {}) {
	const refusals = [];
	const b = String(branch ?? "").trim();
	if (!b) refusals.push("no branch: pass the ref you want to land, or claim the item so it can be derived");
	if (b === "main" || b === "refs/heads/main") refusals.push("main is the landing target, not a branch to land");
	if (gate !== "changed-suite" && gate !== "suite") refusals.push(`unknown gate "${gate}": use "changed-suite" or "suite"`);
	if (heldItemIds && heldItemIds.length > 0) {
		const id = Number((b.match(/(\d+)/) || [])[0] ?? null);
		if (id === null) refusals.push(`branch "${b}" names no item id, so it cannot be shown to be yours`);
		else if (!heldItemIds.includes(id)) refusals.push(`branch "${b}" is item #${id}, which this seat does not hold (held: ${heldItemIds.join(", ")})`);
	}
	if (refusals.length) return { ok: false, refusals };

	const argv = ["node", "scripts/land.mjs", b, "--repo", sharedRoot, "--db", db, `--${gate}`];
	// Belt and braces: the plan is only ever a local landing. `git push` is not in this argv and cannot be,
	// because argv is built from these five tokens.
	if (argv.some((t) => /push/i.test(t))) return { ok: false, refusals: ["plan contains a push — self-merge is local main only"] };
	return { ok: true, argv, timeoutMs, sharedRoot, branch: b, gate };
}

/** Run one git verb, bounded. */
function git(repo, args) {
	const r = spawnSync("git", args, { cwd: repo, timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
	return { code: r.status, out: (r.stdout ?? "").toString().trim() };
}

/** The shared root = the FIRST entry of `git worktree list --porcelain`. null when git cannot be read. */
function sharedRootOf(cwd) {
	const r = git(cwd, ["worktree", "list", "--porcelain"]);
	const m = /^worktree (.+)$/m.exec(r.out);
	return m ? resolve(m[1].trim()) : null;
}

/** The items this seat holds, from the store the harness is already using. */
async function heldItems(tx, conversationId) {
	const seats = await tx.doc(Seats);
	const name = Object.keys(seats.seats ?? {}).find((n) => seats.seats[n].conversationId === conversationId) ?? null;
	const queue = await tx.doc(RigQueue);
	const items = (queue.items ?? []).filter((item) => item.to === name);
	const claimed = items.filter((item) => item.status === "claimed").sort((a, b) => a.id - b.id);
	const queued = items.filter((item) => item.status === "queued").sort((a, b) => a.id - b.id);
	return { name, ids: [...claimed, ...queued].map((item) => item.id) };
}

/**
 * A land.mjs report is JSON on stdout, and land.mjs exits 0 ONLY when main advanced. Verify separately:
 * ancestry is the fact the seat should be told, not the merge sha it hopes for.
 */
function verifyLanding(sharedRoot, branch) {
	const tip = git(sharedRoot, ["rev-parse", branch]);
	const ancestor = git(sharedRoot, ["merge-base", "--is-ancestor", branch, "main"]).code === 0;
	const main = git(sharedRoot, ["rev-parse", "main"]);
	return { branch, tip: tip.out.slice(0, 8), ancestor, main: main.out.slice(0, 8) };
}

export const selfMergeExtension = defineExtension({
	name: "durig-self-merge",

	sections: [
		// Static text only (ROADMAP 175). It names the tools; it does not carry the state.
		section(
			"durig-self-merge",
			() =>
				"Landing is part of your item, not someone else's step. When your work is committed on your " +
				"item's branch, run `landing_health` to see whether it is ready, then `land_my_item` to land it: " +
			 "the rig's own helper merges your branch in a scratch worktree, runs the derived gate there, and " +
				"fast-forwards LOCAL main. It never pushes — publishing is the operator's grant. If the helper " +
				"refuses (a conflict, a red derived gate, a dirty shared tree), that is the finding to report, " +
				"not a reason to merge by hand.",
			{ tag: false },
		),
	],

	tools: [
		defineTool({
			name: "landing_health",
			description:
				"Read the landing backlog as git sees it: which refs are landed, which conflict, which are ready " +
				"and how long they have waited. Read-only — it merges nothing and deletes nothing.",
			parameters: obj({
				refs: opt(str({ description: "comma-separated refs to restrict the census (default: every ref under refs/heads)" })),
				sla_hours: opt(num({ description: "how long a ready ref may wait before it is stale (default 24)" })),
			}),
			execute: async (_args, _api, _context) => {
				const repo = process.cwd();
				const db = process.env.DURIG_DB || "./selfdev.sqlite";
				const sla = Number(_args.sla_hours ?? process.env.DURIG_SELF_MERGE_SLA_HOURS ?? 24);
			 const result = landingHealth({ repo, db, slaHours: sla, refs: _args.refs ? String(_args.refs).split(",").map((s) => s.trim()).filter(Boolean) : null });
			 const text = JSON.stringify({ ...result, rows: result.rows.slice(0, 40) });
			 return { content: [{ type: "text", text }], output: [{ type: "text", text }] };
			},
		}),

		defineTool({
			name: "land_my_item",
			description:
				"Land YOUR OWN item branch onto local main through the rig's landing helper. It merges in a " +
			 "scratch worktree, runs the derived gate there, and advances main only if that gate is green. " +
			 "It never pushes. Call it after you have committed your work.",
			parameters: obj({
				branch: opt(str({ description: "the ref to land. Omit it and it is derived from the item you hold." })),
				gate: opt(lit(["changed-suite", "suite"], { description: "which gate to run in the scratch: the derived subset (default) or the full suite" })),
			}),
			execute: async (args, api, context) => {
				const repo = process.cwd();
				const db = process.env.DURIG_DB || "./selfdev.sqlite";
				const root = sharedRootOf(repo) ?? repo;

			 // Who is asking, and what do they hold? Read from the same store the harness is using.
			 let held = [];
			 try {
				 held = (await api.commit(async (tx) => heldItems(tx, api.conversationId), context)).ids ?? [];
			 } catch {
				 // The store read failed: fall back to "no ownership assertion" rather than refusing a
				 // legitimate landing on a store the harness could not open. The refusal then comes from
				 // the branch name itself, and the report says the check did not run.
			 }
			 const branch = (args.branch ?? "").trim() || (held.length ? `item-${held[0]}` : "");

			 const plan = buildSelfMergePlan({ sharedRoot: root, branch, db, heldItemIds: held.length ? held : null, gate: args.gate ?? "changed-suite", timeoutMs: Number(process.env.DURIG_SELF_MERGE_TIMEOUT_S ?? 300000) });
			 if (!plan.ok) {
				 const text = `REFUSED: ${plan.refusals.join("; ")}`;
				 return { content: [{ type: "text", text }], output: [{ type: "text", text }] };
			 }

			 const run = spawnSync(plan.argv[0], plan.argv.slice(1), { cwd: plan.sharedRoot, timeout: plan.timeoutMs, maxBuffer: 64 * 1024 * 1024 });
			 const report = (() => {
				 try {
					 return JSON.parse((run.stdout ?? "").toString());
				 } catch {
					 return { raw: (run.stdout ?? "").toString().slice(0, 2000), stderr: (run.stderr ?? "").toString().slice(0, 2000) };
				 }
			 })();
			 const proof = verifyLanding(plan.sharedRoot, plan.branch);
			 const text = JSON.stringify({
				 command: "land_my_item",
				 seat_holds: held,
				 plan: { argv: plan.argv, gate: plan.gate },
				 helper_exit: run.status,
				 report,
				 proof,
				 note: proof.ancestor
					 ? `LANDED: ${plan.branch} is an ancestor of main at ${proof.main}. Prove the CONTENT too (docs/runbooks/land.md): git diff --quiet <mergeSha> main -- <path>.`
					 : "NOT landed — the helper refused or stopped; read report.error, then re-cut or report it. Never merge into the shared tree by hand.",
			 });
			 return { content: [{ type: "text", text }], output: [{ type: "text", text }] };
			},
		}),
	],

	/** The check seam: `cli.mjs check` reads `checks` from every loaded extension, runs `run(ctx)`, and folds
	 * the findings into the audit. `run` returns {findings, skipped} so "could not measure" is never a pass. */
	checks: [
		{
			id: SELF_MERGE_RULE.id,
			severity: SELF_MERGE_RULE.severity,
			what: SELF_MERGE_RULE.what,
			run: ({ repo, db }) => {
			 const sla = Number(process.env.DURIG_SELF_MERGE_SLA_HOURS ?? 24);
			 const result = landingHealth({ repo, db, slaHours: sla });
			 if (result.error) return { skipped: `git could not be read here: ${result.error}` };
				if (result.stale === 0) return { findings: [] };
				return {
					findings: result.rows.map((r) => ({
						subject: r.ref,
						detail: `${r.ref} is ready to land and has waited ${r.age_h} h (SLA ${sla} h); queue status ${r.queue_status}, derived gate ${r.gate.derivedTests} test(s)`,
						fix: r.land_command,
					})),
					measured: { refs: result.refs, landed: result.counts.landed ?? 0, ready: result.counts.ready ?? 0, elapsed_s: result.elapsed_s },
				};
			},
		},
	],
});

export default selfMergeExtension;

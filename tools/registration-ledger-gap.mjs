#!/usr/bin/env node
// tools/registration-ledger-gap.mjs — is the ROADMAP ledger actually MISSING anything the queue registers?
//
// TRIGGER (the symptom that loads this instrument): `tools/queue-pressure.mjs` prints a `moveRegistrationsToLedger`
// plan of N rows and a session is asked to "put the registration rows into the ROADMAP ledger" — and nobody can
// say how much ledger work that is. Counting the rows (171 live at 2026-11-15) is not the answer: most of them
// name nothing, and the ones that do name an item are usually ALREADY in the ledger, so a bulk "write them all"
// would duplicate entries instead of finding the gap.
//
// WHAT IT ANSWERS, each with its predicate named:
//   1. the LIVE `registration` rows, by status — classified by the ONE predicate (`src/queueclass.mjs`
//      `classifyRow`, notice checked BEFORE registration), never by a hand regex over a subject;
//   2. of those, how many NAME a ROADMAP item at all, and how many name NO item (parked operator/lead intent
//      such as `BACKLOG — hold, do not start` or `CODEmode TIER T0 (BACKLOG — hold)`, which have no ledger
//      entry to write);
//   3. the GAP: live registration rows naming an item that `docs/ROADMAP.md`'s registry does NOT carry —
//      this is the pass's real worklist, with the ROW id and the item number, which is what `pm` needs;
//   4. the DUPLICATES: registry items named by more than one live registration row — a ledger copy those rows
//      would write twice (**0 items on the live store — re-measured 2026-11-16 at the clean tree `dee33d7d6`; the
//      header used to claim `13 such items, worst 126 x3, 130 x3, 217 x3`, which NO run on this store reproduces and
//      which this same header's own live-call line already contradicted; the addendum below names the falsifier**);
//   5. the READ-SHAPE fact, printed never silent: NEITHER CLI read carries the structural flag — `cli.mjs
//      queue --json --no-body` prints keys id/from/to/subject/optimizedVia/status/transitions/resultSummary,
//      and the full `cli.mjs queue` read measured `flagless 1200 of 1200` live rows (2026-11-15), so from a
//      CLI read the ONE predicate runs on its PATTERN fallback for EVERY row. That fallback is honest only
//      inside `classifyRow`, which checks a notice BEFORE a registration: a HAND pattern-match measured the
//      same store at 180 of 1,200 where `classifyRow` says 171 (the 9 are notice subjects carrying registration
//      words; `src/queueclass.mjs:25-27` measures 19 such rows). The fallback also over-matches ordinary prose
//      — `REGISTRATION_RE` includes `\bREGISTRATION\b`, so a work subject merely containing the word "registration"
//      reads as a registration in a flagless read (the pinned test's fixture names that shape).
//
// Exit code: 0 when NOTHING is missing (the ledger already carries every item a live registration names —
// duplicates are still reported, because a duplicate is not a gap), 1 when the gap is non-empty (the pass has
// work) or when the queue read fails. A 0 here is not "nothing to do with the backlog": `queue-pressure`'s band
// verdict answers that; this one answers only the ledger question.
//
// Exact command (re-measure before quoting):
//   node tools/registration-ledger-gap.mjs                       # the live store, one FULL queue read
//   node tools/registration-ledger-gap.mjs --fixture=<rows.json> # a rows document {items:[...]} (test plane, no store)
//   node tools/registration-ledger-gap.mjs --ledger=<path>       # a stand-in for docs/ROADMAP.md (fixture ledgers)
//   node tools/registration-ledger-gap.mjs --json .spike/gap.json [--quiet]
//
// Measured cost, re-run before quoting: **1.1-2.3 s** against the live store — the SAME call measured 1.10 s / 1.141 s
// wall at `660dd94d`, **1.50 s on its own cost line / 1.544 s wall** at the clean tree `dee33d7d6`, and **2.31 s** at the
// clean tree `adba860d9` (2026-11-16): one full `cli.mjs queue` read of ~18 MB of JSON, no second read, and the cost
// DRIFTS with broker state the way SELFDEV §37's `watch --once` (1.5 s or 10.9 s) does — so a header that quotes ONE
// number is a 26-75% lie on a call that has several, and a header that quotes a NARROW range is falsified by the very
// next tree; the range below is what three clean-tree calls showed, not an optimum. 0.01-0.03 s against a fixture; the
// pinned demo `node tools/registration-ledger-gap-test.mjs` 0.17-0.21 s. Live call
// at `b2f4d4833` (host measured in the same command): **exit 0** — `live 1200 = 1024 work +
// 5 notice + 171 registration`, `terminal registration 299`, `naming a ROADMAP item 33 · naming NO item 138 ·
// item ALREADY in the ledger 33 · item NOT in the ledger 0`, `DUPLICATES 0`, `flagless 1200`. Host it was first
// measured on: Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0
// (hostname-free probe of SELFDEV pitfall 396). `last_verified: 2026-11-15` by that live call and by the demo
// below; RED-FIRST numbers: the demo was written FIRST and exited **1 with 14 FAIL at tree=b2f4d4833 in
// 0.157 s** (docs/failing-first-recipe.md METHOD 1 — order of operations, no git revert), then **17 ok / 0 FAIL
// / exit 0 in 0.178 s** against this file.
//
// ADDENDUM 2026-11-16 (delegate, CLEAN tree `dee33d7d6` — `git status --short -- .` named only the pre-existing
// untracked `docs/reviews/basic-world-model-implementation-for-agent-team.md`; host measured in the SAME command as
// every number below with the hostname-free probe of pitfall 396: Linux, Fedora Linux 45 (Forty Five), kernel
// `7.2.15-300.fc45.x86_64`, node v24.22.1, `git version 2.56.0`) — two of this header's numbers were lies, both
// corrected IN PLACE here, no second tool written:
//   1. `DURIG_DB=./selfdev.sqlite timeout 60 node tools/registration-ledger-gap.mjs` -> **cost 1.50 s (the tool's own
//      line), 1.544 s shell wall, exit 0, `.err` 0 B** (`.spike/reggap-clean-dee33d7d.out`); the same call at `660dd94d`
//      measured 1.10 s / 1.141 s, and at the NEXT clean tree `adba860d9` it measured **2.31 s** (`.spike/reggap-adba860.out`,
//      exit 0, `.err` 0 B, same census). **Quote the range and re-measure** — the range in the line above was widened to
//      1.1-2.3 s by that third data point, in place, the same session that wrote it.
//   2. the DUPLICATES line: this tree prints `DUPLICATES the pass would write twice: 0 items`, as it did at `660dd94d`
//      and at `b2f4d4833`. The claim of `13 such items` is reproduced by NO run on this store — `rg "126 x3"` hits only
//      this header — so it was an unsourced claim about an older snapshot. Falsifier: ONE bounded call, above.
//   3. the demo and the area, re-measured at this tree: `node tools/registration-ledger-gap-test.mjs` -> **17 ok / 0 FAIL
//      / exit 0, 0.21 s wall** (`.spike/reggap-test-dee33d7d.out`); `node scripts/test.mjs --area toolchain --jobs 4` ->
//      **43/43 in 28.4 s, exit 0, `.err` 0 B**, carrying `PASS tools/registration-ledger-gap-test.mjs (0.2s)`, PROVENANCE
//      `tree=dee33d7d6` (`.spike/area-toolchain-dee33d7d.out`); `node scripts/test.mjs --all --jobs 4` -> **366/366 in
//      176.1 s, exit 0, `.err` 0 B** (`.spike/suite-dee33d7d.out`). `last_verified: 2026-11-16` by those calls.
//
// READ-ONLY by construction: it runs the CLI's own reader and `readFileSync` of the ledger. It mints nothing,
// transitions nothing, writes no row — the pass itself is `pm`'s verb (docs/WORK-ITEM-LIFECYCLE.md), and a
// delegate plans (AGENTS.md).

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { classifyRow, isTerminalRow, isRegistrationItem, isNoticeItem } from "../src/queueclass.mjs";

const argv = process.argv.slice(2);
const flagPath = (name) => {
	const re = new RegExp(`^--${name}=(.+)$`);
	for (let i = 0; i < argv.length; i++) {
		const m = re.exec(argv[i]);
		if (m) return m[1];
	}
	const i = argv.indexOf(`--${name}`);
	// the space form is REFUSED on sight (SELFDEV pitfall 394: a tool that prints a flag form it rejects
	// teaches the next session a command it cannot run)
	if (i >= 0) {
		console.error(`--${name} needs the = form (use --${name}=<path>)`);
		process.exit(4);
	}
	return null;
};
const fixture = flagPath("fixture");
const ledgerPath = flagPath("ledger") ?? "docs/ROADMAP.md";
const quiet = argv.includes("--quiet");
let jsonOut = null;
{
	const i = argv.indexOf("--json");
	if (i >= 0) {
		// pitfall 394's other half: an instrument must refuse a flag form it does not read, not ignore it
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			console.error("--json needs an output path (use --json <path>; the bare form is not implemented)");
			// documented and refused, but a JSON-only caller may still want stdout: honor stdout, say so
			jsonOut = "-";
			console.error("--json -> stdout (no path given)");
		} else jsonOut = next;
	}
}
const t0 = Date.now();

// The SAME three registry forms roadmap-queue-coverage.mjs matches (docs/SELFDEV.md documents that matching
// one form alone sees 87 of 263 items): matching one and getting a clean answer is the same trap as a
// census that counts one class.
const ledgerText = readFileSync(ledgerPath, "utf8");
const registry = new Set();
for (const re of [/^\*\*(\d{1,4})\.\s/gm, /^(\d{1,4})\.\s/gm, /^\|\s*(\d{1,4})\s*\|/gm]) for (const m of ledgerText.matchAll(re)) registry.add(Number(m[1]));

let items;
if (fixture) {
	const doc = JSON.parse(readFileSync(fixture, "utf8"));
	items = doc.items ?? doc;
} else {
	// `cli.mjs queue` prints one JSON document plus a trailing `note:` line, so parse the JSON prefix only
	// (the "Extra data" trap the ledger tools already record).
	const r = spawnSync(process.execPath, ["cli.mjs", "queue"], {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		env: { ...process.env, DURIG_DB: process.env.DURIG_DB || "./selfdev.sqlite" },
	});
	if (r.status !== 0) {
		console.error(`cli.mjs queue failed (exit ${r.status}): ${(r.stderr || "").slice(0, 300)}`);
		process.exit(1);
	}
	const text = r.stdout;
	items = (JSON.parse(text.slice(0, text.lastIndexOf("}") + 1)).items) ?? [];
}

const live = items.filter((it) => !isTerminalRow(it));
const shape = { rows: items.length, live: live.length, notice: 0, registration: 0, work: 0 };
for (const it of live) shape[classifyRow(it)]++;
const flagless = live.filter((it) => typeof it?.registration !== "boolean").length;

const regLive = live.filter((it) => classifyRow(it) === "registration");
const regTerminal = items.filter((it) => isTerminalRow(it) && classifyRow(it) === "registration");
const byStatus = {};
for (const it of regLive) byStatus[it.status] = (byStatus[it.status] || 0) + 1;

const named = regLive.map((it) => {
	const m = /ROADMAP[^0-9]{0,6}(\d{1,4})\b/.exec(String(it?.subject ?? ""));
	return { rowId: it.id, status: it.status, item: m ? Number(m[1]) : null, inLedger: m ? registry.has(Number(m[1])) : false };
});
const noItem = named.filter((x) => x.item === null);
const missing = named.filter((x) => x.item !== null && !x.inLedger);
const tally = new Map();
for (const x of named) if (x.item !== null) tally.set(x.item, (tally.get(x.item) || 0) + 1);
const duplicates = [...tally.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0] - b[0]);

const verdict = missing.length === 0 ? 0 : 1;
const cost = ((Date.now() - t0) / 1000).toFixed(2);
const doc = {
	verdict,
	missingFromLedger: missing,
	duplicates: duplicates.map(([item, count]) => ({ item, count })),
	counts: { rows: shape.rows, live: shape.live, notice: shape.notice, registration: shape.registration, work: shape.work, flagless, namedItem: named.length - noItem.length, noItem: noItem.length, alreadyInLedger: named.filter((x) => x.inLedger).length, missing: missing.length, terminalRegistration: regTerminal.length, registry: registry.size },
	registrationByStatus: byStatus,
	ledger: ledgerPath,
	read: fixture ? `fixture ${fixture}` : "cli.mjs queue (full read)",
	seconds: Number(cost),
};
if (jsonOut) {
	const text = JSON.stringify(doc);
	if (jsonOut === "-") process.stdout.write(text);
	else writeFileSync(jsonOut, text);
}
if (!quiet) {
	console.log(
	`REGISTRATION -> ROADMAP LEDGER  (ledger ${ledgerPath}: ${registry.size} registered items; cost ${cost}s, one read)\n` +
	`  queue rows ${shape.rows} · live ${shape.live} = ${shape.work} work + ${shape.notice} notice + ${shape.registration} registration · terminal registration ${regTerminal.length}\n` +
	`  read shape: flagless live rows ${flagless} (a read without the structural flag classifies by pattern — SELFDEV's 9-row drift shape; 0 means the flag-bearing read)\n` +
	`  live registration rows by status: ${Object.entries(byStatus).map(([k, v]) => k + "=" + v).join(" ")}\n` +
	`  naming a ROADMAP item ${named.length - noItem.length} · naming NO item ${noItem.length} · item ALREADY in the ledger ${named.filter((x) => x.inLedger).length} · item NOT in the ledger ${missing.length}\n` +
	`  DUPLICATES the pass would write twice: ${duplicates.length} items — ${duplicates.slice(0, 8).map(([n, c]) => n + " x" + c).join(" ")}\n` +
	(missing.length ? `  THE GAP (pm's worklist): ${missing.slice(0, 12).map((x) => `#${x.rowId}:${x.status} -> ROADMAP ${x.item}`).join(" ")}\n` : `  THE GAP: none — every item a live registration names is already in the ledger\n`) +
	`  DENOMINATOR: this counts NAMES ("ROADMAP <n>" in a subject), not foreign keys — a row that registers an item without writing that phrase is invisible here (the same caveat as tools/roadmap-queue-coverage.mjs, read in the other direction)\n`
);
	// the cost line is printed by the tool itself, per AGENTS.md's instrument rule
	console.log(`cost ${cost}s · exit ${verdict} · no row minted, transitioned or deleted`);
}
process.exit(verdict);

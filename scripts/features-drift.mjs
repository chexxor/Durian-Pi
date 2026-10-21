// scripts/features-drift.mjs — the periodic SWEEP form of the `feature-row-missing`
// `check` rule (src/checkup.mjs; #1564 / D62 / ROADMAP 46).
//
// D62: every new or changed capability carries its own doc acceptance — a row in
// docs/FEATURES.md — or the item records an explicit "no feature surface" note.
// docs/runbooks/merge.md used to enforce that by hand with `git log --grep '^feat'`;
// a prose gate drifts, so src/featuredocs.mjs turns the sweep into DATA and the
// `check` rule `feature-row-missing` judges it.
//
// The rule is OPT-IN (rig-spec key, default OFF; lead #1562) and its caller is gated
// on cli.mjs serialization, so this script is the un-gated, periodic equivalent: it
// reuses the SAME reader (src/featuredocs.mjs) the rule consumes, so the sweep and
// the rule cannot disagree about what drift is. It reads git only; no new write path.
//
// Usage:
//   node scripts/features-drift.mjs [--repo <dir>] [--since <git --since>] [--json]
//
// Exit codes (deliberate, so a caller can gate on them):
//   0  no drift
//   1  drift found (a `feat` commit with no FEATURES.md row and no "no feature surface" note)
//   2  UNKNOWN — git history could not be read (not a repo, no commits, git absent).
//      UNKNOWN is NEVER reported as clean (the same honesty rule as the `check` rule).

import { readFeatureDocs } from "../src/featuredocs.mjs";

const argv = process.argv.slice(2);
function flagValue(name) {
	const i = argv.indexOf(name);
	return i === -1 ? null : (argv[i + 1] ?? "");
}
const repo = flagValue("--repo") || process.cwd();
const since = flagValue("--since");
const asJson = argv.includes("--json");

const entries = readFeatureDocs({ root: repo, since: since || null });

if (entries === null) {
	const reason =
		"git history could not be read (not a repository, no commits yet, or git unavailable)";
	if (asJson) {
		console.log(JSON.stringify({ ok: false, unknown: true, checked: 0, drifted: [], reason }, null, 2));
	} else {
		console.error(`features-drift: UNKNOWN — ${reason}; treating as UNKNOWN, not clean`);
	}
	process.exit(2);
}

const drifted = entries.filter((c) => c && c.touchedFeatures !== true && c.noSurfaceNote !== true);
const report = {
	ok: drifted.length === 0,
	checked: entries.length,
	drifted: drifted.map((c) => ({ sha: c.sha, subject: c.subject })),
};

if (asJson) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(
		`features-drift: checked ${entries.length} feat commit(s); ${drifted.length} without a docs/FEATURES.md row`,
	);
	for (const c of drifted) {
		console.log(`  DRIFT ${String(c.sha).slice(0, 10)}  ${c.subject}`);
	}
	if (drifted.length > 0) {
		console.log(
			'  fix: add the docs/FEATURES.md row for each, or record an explicit "no feature surface" note in its item',
		);
	}
}

process.exit(drifted.length === 0 ? 0 : 1);

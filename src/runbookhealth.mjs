// src/runbookhealth.mjs — the ONE read that makes the three runbook rules JUDGEABLE (#5767 family).
//
// WHY THIS EXISTS. `src/checkup.mjs` declares `runbook-front-matter`, `runbook-unverified` and
// `runbook-stale` in `RULES`, and `auditRig` judges them — but a rule only runs if a CALLER supplies
// the data, because `auditRig` stays fs-free (ROADMAP 81a). Measured at `main` `2195382fe` (Linux,
// Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0):
// `node cli.mjs check rig.selfdev.json --json` printed all three as
// `{"status":"unknown","why":"no runbook data was supplied, so no runbook can be judged"}` — a
// permanently-UNKNOWN rule is a rule that never runs, and a list of rules nobody can run is how a
// maintenance policy ("verify the runbook, then set `last_verified`") goes stale without being seen.
// This module is the READ half: it returns plain values, so the judge stays pure.
//
// ONE MECHANISM, not two. `scripts/clockin.mjs` already sold a runbook-staleness probe
// (`staleRunbooks`), and it spawns ONE `git log` PER PATH A RUNBOOK NAMES — measured 62 dated runbooks,
// ~500 spawns. This reader takes ONE spawn for the whole set and clockin now derives its report from
// these rows, so the two surfaces cannot disagree (D328's rule: where two spellings of one question
// disagree, the looser one dies — here there is only one spelling left).
//
// SCOPE, stated so it cannot be over-read:
//  - only `docs/runbooks/*.md`, excluding `_template.md` and `README.md`, exactly as the caller of
//    the front-matter policy reads them (docs/runbooks/README.md "Front-matter (mandatory)");
//  - a runbook NAMES a file by writing its path (`src/…`, `docs/…`, `scripts/…`, `demo/…`) — the SAME
//    pattern the clock-in probe used, so the definition of "names" did not move;
//  - "changed since" means a commit dated on a day STRICTLY LATER than `last_verified` touched a file the
//    runbook names. `last_verified` is a DATE with no time-of-day, so a change LATER THE SAME DAY cannot be
//    shown to postdate the verification — counting it would call most of the runbook set stale every time the
//    pointer table churns the same day, which is a false alarm, not a finding. Stated here rather than left to
//    `git log --since`: measured on this box (Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`,
//    node v24.22.1, git 2.56.0), a BARE `--since=2026-11-08` is ambiguous and DROPS a same-day commit (`demo/fleet-health-counts.test.mjs`,
//    committed `2026-11-08T21:16:28-06:00`): 0 hits bare, 1 hit with `--since=2026-11-08T00:00`, 1 with
//    `--since="2026-11-08 00:00"`. The reader asks git in the explicit form and decides the DAY itself, so the
//    boundary is written in this file rather than hidden in a parser quirk.
//  - it never reads a store, never writes, never calls a model.
//
// COST, measured on this box (Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`,
// node v24.22.1, git 2.56.0) over 65 runbook files / 62 dated: the whole read is 0.4–1.3 s — one
// `git log --since=<oldest last_verified> --name-only` is the only spawn, and reading 62 files is
// under 0.1 s. Re-measure rather than quote this band; the `--since` window grows as the OLDEST
// `last_verified` ages, which is the price that slides.
//
// last_verified: 2026-11-17 at the tree this commit lands on — the pinned demo `node demo/check-runbook-judged.test.mjs`
// exits 0 in the `check` area (see `demo/test-areas.json`); its recorded RED is against a PRE-change tree
// that has no `src/runbookhealth.mjs` at all (the missing module is reported as a FAIL, not a crash).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

/** The front-matter block a runbook opens with (`docs/runbooks/_template.md`). */
export const RUNBOOK_FRONT_MATTER_BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/;

/**
 * A file a runbook NAMES, in the body below the front matter. This is deliberately the SAME set of
 * trees the clock-in probe matched (`src`, `docs`, `scripts`, `demo`) so that "the runbook names it"
 * kept one definition across the two surfaces; `.agents/…` and a bare `cli.mjs` are NOT named here,
 * and that gap is stated rather than silently widened.
 */
export const RUNBOOK_NAMED_PATH = /(?:src|docs|scripts|demo)\/[\w./-]+\.\w+/g;

/**
 * Scalar `key: value` front matter — the block is a flat list of scalars, so no YAML parser is needed.
 * A trailing `#` comment IS part of this rig's runbook convention, and it is load-bearing: measured over
 * the 65 runbooks at `main` `2195382fe`, values carry comments after the value, e.g. `writes: false`
 * padded with spaces then `# the procedure routes rows; it …`, and `precondition: "none"` followed by a
 * long comment. Keeping the comment in the value made the conformity judge report
 * `writes: must be true or false (got "false")` for MOST OF THE SET — a manufactured finding, not a defect.
 * YAML's own rule is used here: outside a quoted value, ` #` starts a comment; inside quotes, `#` is part of
 * the value. So the quoted form is taken whole and the bare form is cut at the first ` #`.
 *
 * TYPES are part of this contract too. The conformity judge (`src/checkup.mjs` `runbookFrontMatterProblems`) asks
 * whether `writes` is a BOOLEAN, and `demo/runbook-frontmatter.test.mjs` feeds it one — but a runbook file read from
 * disk yields strings, so a string-fed reader made the judge answer `writes: must be true or false (got "false")` for
 * ALL 65 runbooks at `main` `2195382fe`: a manufactured finding, not a defect. Only the BARE YAML forms are coerced
 * (`true`/`false`/`null`); a quoted `"false"` stays a string, exactly as YAML says, and stays a reported defect.
 */
export function parseRunbookScalars(block) {
  const out = {};
  for (const line of String(block ?? "").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*)$/);
    if (!m) continue;
    const raw = m[2].trim();
    let value;
    let quoted = false;
    if (raw.length > 1 && (raw[0] === "\"" || raw[0] === "'")) {
      const q = raw[0];
      const end = raw.indexOf(q, 1);
      quoted = true;
      value = end > 0 ? raw.slice(1, end) : raw.slice(1);
    } else {
      const hash = raw.search(/(?<=[ \t])#|^[ \t]*#/);
      value = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    }
    if (!quoted && (value === "true" || value === "false")) value = value === "true";
    else if (!quoted && (value === "null" || value === "~")) value = null;
    out[m[1]] = value;
  }
  return out;
}

/** Split ONE runbook's text into its parsed front matter (`null` when the block is absent) and its body. */
export function parseRunbook(file, text) {
  const match = RUNBOOK_FRONT_MATTER_BLOCK.exec(text);
  return {
    file,
    frontMatter: match ? parseRunbookScalars(match[1]) : null,
    body: match ? text.slice(match[0].length) : text,
  };
}

/**
 * The NEWEST commit date that touched each path, over the window `since`..HEAD — ONE spawn for the
 * whole runbook set, and the date is what makes the comparison per-runbook. A runbook verified on
 * `2026-11-10` is NOT stale because a file it names changed on `2026-10-02`, so a bare set of paths
 * inside the widest window would over-report; comparing the per-path NEWEST date against that
 * runbook's own `last_verified` keeps the definition one question. The `--since` is sent in the
 * explicit `<date>T00:00` form on the head of the window — a bare `--since=<YYYY-MM-DD>` is parsed
 * ambiguously by git here (see the measurement above), so the day decision belongs to the caller and
 * not to a date parser. Returns `null` when git or the repo is unavailable, which the caller
 * must NOT read as "nothing changed" — that is an unjudged rule, not a judged-clean one.
 */
export function newestChangeDateByPath({ root = process.cwd(), since }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since ?? ""))) return null;
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "log", "--pretty=format:@%cd", "--date=format:%Y-%m-%d", "--name-only", `--since=${since}T00:00`, "--", "."],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000, maxBuffer: 64 * 1024 * 1024 },
    );
    const byPath = new Map();
    let day = null;
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (!p) continue;
      if (p.startsWith("@")) {
        day = p.slice(1);
        continue;
      }
      if (!byPath.has(p) && day) byPath.set(p, day); // git log is newest-first: first hit is the newest
    }
    return byPath;
  } catch {
    return null;
  }
}

/**
 * The DATE a runbook was last verified, or `null` when `last_verified` is `unverified`/absent.
 * Anchored at the START of the value so a trailing comment (`2026-11-11 # re-ran the Verify step`) is
 * still a date, while a value that merely CONTAINS a date is not read as one.
 */
export function runbookVerifiedOn(row) {
  const raw = String(row?.frontMatter?.last_verified ?? "");
  const m = raw.match(/^"?'?(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Read every runbook under `dir` and mark which named files changed since its `last_verified`.
 * Returns `null` when the runbook directory cannot be read, so the caller leaves the rules UNKNOWN.
 * An EMPTY `dir` is the declared OFF switch (`DURIG_RUNBOOKS: ""` in a rig config — see `runbookDirSetting`,
 * src/config.mjs): a fixture auditing a synthetic rig turns the read off rather than inheriting the live
 * tree's 57 stale runbooks, and OFF is reported as UNKNOWN-with-a-reason, never as a clean audit.
 * `gitProbeFailures` > 0 means the staleness leg could not run: the rows still carry their front
 * matter (so `runbook-front-matter` and `runbook-unverified` stay judged) but `changedNamedFiles` is
 * `null` — deliberately NOT an empty array, which would read as "judged, not stale".
 */
export function readRunbookHealth({ root = process.cwd(), dir = "docs/runbooks" } = {}) {
  if (String(dir ?? "").trim() === "") return null; // OFF: the caller declared it. Rules stay UNKNOWN, not clean.
  const base = resolve(root, dir);
  if (!existsSync(base)) return null;
  let names;
  try {
    names = readdirSync(base);
  } catch {
    return null;
  }
  const files = names.filter((n) => n.endsWith(".md") && n !== "_template.md" && n !== "README.md").sort();
  const rows = [];
  let oldest = null;
  for (const name of files) {
    let text;
    try {
      text = readFileSync(join(base, name), "utf8");
    } catch {
      continue; // an unreadable runbook is reported by its absence, and the guard owns that shape
    }
    const row = parseRunbook(`${dir}/${name}`, text);
    row.verifiedOn = runbookVerifiedOn(row);
    if (row.verifiedOn && (oldest === null || row.verifiedOn < oldest)) oldest = row.verifiedOn;
    row.named = [...new Set(row.body.match(RUNBOOK_NAMED_PATH) ?? [])].filter((p) => existsSync(resolve(root, p)));
    rows.push(row);
  }
  const newest = oldest === null ? new Map() : newestChangeDateByPath({ root, since: oldest });
  const gitProbeFailures = oldest === null || newest !== null ? 0 : 1;
  if (newest === null) for (const row of rows) row.changedNamedFiles = null;
  else
    for (const row of rows) {
      const lv = row.verifiedOn;
      if (lv === null) { row.changedNamedFiles = []; continue; } // the judge skips these before the staleness leg
      row.changedNamedFiles = row.named.filter((p) => (newest.get(p) ?? "") > lv); // strictly later DAY; see the header
    }
  return { runbooks: rows, dated: rows.filter((r) => r.verifiedOn !== null).length, gitProbeFailures };
}

/**
 * The clock-in report's shape, derived from the SAME rows (`scripts/clockin.mjs` used to own its own
 * probe). A `gitProbeFailures` of 1 says the staleness leg did not run — it is NOT evidence of no staleness.
 */
export function runbookStalenessReport({ root = process.cwd(), dir = "docs/runbooks" } = {}) {
  const health = readRunbookHealth({ root, dir });
  if (health === null) return { dated: 0, stale: [], probeFailures: 0 };
  if (health.gitProbeFailures > 0)
    return { dated: health.dated, stale: [], probeFailures: health.gitProbeFailures };
  return {
    dated: health.dated,
    stale: health.runbooks
      .filter((r) => (r.changedNamedFiles ?? []).length > 0)
      .map((r) => ({ file: r.file.replace(new RegExp(`^${dir}/`), ""), last: r.verifiedOn, changed: r.changedNamedFiles })),
    probeFailures: 0,
  };
}

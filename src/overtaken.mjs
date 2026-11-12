/**
 * overtaken.mjs — WHICH BACKLOG ROWS HAVE BEEN OVERTAKEN BY EVENTS, and which look like they have
 * but are actually the SURVIVOR of a supersession.
 *
 * WHY THIS EXISTS. `check`'s `duplicate-item` rule reports a live row that is SAME-INTENT with a
 * TERMINAL twin, and its prescribed fix is "cancel #id as a duplicate of #twin". Measured on the live rig
 * 2026-11-12T19:3xZ: of the **76** such findings, the exact-subject pairs were **18**, and checking each
 * twin's status showed **17 twins were `cancelled` and exactly 1 was `done`**. A cancelled twin means the
 * live row is the RE-ISSUE — the survivor — so following the rule's own prescription would have destroyed
 * 17 live intents. That is the whole reason this module exists: "terminal" is not one thing, and the
 * difference between `done` and `cancelled` decides which way the verdict goes.
 *
 * The classification is deliberately narrow and evidence-backed. A row lands in exactly one class, or in
 * none:
 *
 *   `settled-duplicate`  twin is DONE — the work the row asks for has been completed, so the row is
 *                        overtaken. Cancelling is safe and is the only class this module calls safe.
 *   `survivor-of-cancel` twin is CANCELLED — the row is the re-issue of a superseded predecessor. NEVER
 *                        cancel; the predecessor's cancellation is what made this row live.
 *   `notice`             a coordination meta-row (a `CANCELLED #n`/`DONE #n` notice). Its lifecycle is
 *                        the retention rule (#7279), not "overtaken": it is a record, not work.
 *   `gate-satisfied`     a non-terminal row whose `blockedBy` names a DONE row — not overtaken, but its
 *                        gate is met, so it is claimable and should not be parked as if it were blocked.
 *
 * Pure: no store, no clock, no git. The tool wrapper (`tools/overtaken.mjs`) supplies the data.
 */

const TERMINAL = new Set(["done", "cancelled"]);
const isTerminal = (status) => TERMINAL.has(String(status));

/**
 * @param {Array<object>} rows every queue row (any status) as a plain object: {id, status, blockedBy, notice}
 * @param {{id: string, twin: string|null, overlap: number}[]} duplicateFindings from `check`'s duplicate-item rule
 * @returns {{classes: Record<string, Array<object>>, counts: Record<string, number>, safeCancelIds: string[]}}
 */
export function classifyOvertaken(rows = [], duplicateFindings = []) {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const classes = {
    "settled-duplicate": [],
    "survivor-of-cancel": [],
    notice: [],
    "gate-satisfied": [],
  };
  const claimed = new Set();

  // 0. A NOTICE is a record of a terminal transition, never work — check it FIRST. A notice also carries
  //    a subject naming another row (`CANCELLED #6060: …`), so the duplicate matcher happily pairs it with
  //    that row and would file it as "settled duplicate" — measured 2026-11-12T19:4xZ, where 7 of the 14
  //    "safe to cancel" ids were notices. Retiring a notice is a retention decision (#7279), not an
  //    overtaken-by-events call, so the two must never share a verdict.
  for (const row of rows) {
    if (isTerminal(row.status) || row.notice !== true) continue;
    classes.notice.push({ id: String(row.id), status: row.status });
    claimed.add(String(row.id));
  }

  // 1. The duplicate pairs, decided by the TWIN'S STATUS — the distinction `check` does not make.
  for (const finding of duplicateFindings) {
    const id = String(finding.id);
    const row = byId.get(id);
    if (!row) continue;
    if (isTerminal(row.status)) continue; // terminal rows are not backlog
    if (claimed.has(id)) continue; // a notice: its lifecycle is retention, not this verdict
    const twin = finding.twin ? byId.get(String(finding.twin)) : null;
    const twinStatus = twin?.status ?? null;
    if (twinStatus === "done") {
      classes["settled-duplicate"].push({ id, status: row.status, twin: String(finding.twin), twinStatus, overlap: finding.overlap ?? null });
      claimed.add(id);
    } else if (twinStatus === "cancelled") {
      classes["survivor-of-cancel"].push({ id, status: row.status, twin: String(finding.twin), twinStatus, overlap: finding.overlap ?? null });
      claimed.add(id);
    }
    // A twin that no longer resolves, or is live, makes no claim either way: silence is the honest answer.
  }

  // 3. Rows parked behind a gate that is already DONE. They are not overtaken — they are claimable, and a
  //    reader who treats them as blocked parks work that could start now.
  for (const row of rows) {
    const id = String(row.id);
    if (claimed.has(id) || isTerminal(row.status)) continue;
    const gates = (row.blockedBy ?? []).map(String);
    if (gates.length === 0) continue;
    const done = gates.filter((g) => byId.get(g)?.status === "done");
    if (done.length > 0) classes["gate-satisfied"].push({ id, status: row.status, gateDone: done });
  }

  const counts = Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.length]));
  return { classes, counts, safeCancelIds: classes["settled-duplicate"].map((r) => r.id) };
}

/**
 * The one-line verdict for a human, so the tool's output leads with the decision rather than the dump.
 */
export function verdictText(counts) {
  const safe = counts["settled-duplicate"] ?? 0;
  const survivors = counts["survivor-of-cancel"] ?? 0;
  return (
    `overtaken: ${safe} safe to cancel (twin DONE) · ${survivors} DO NOT cancel (twin CANCELLED — this row is the survivor) · ` +
    `${counts.notice ?? 0} notices (retention, not overtaken) · ${counts["gate-satisfied"] ?? 0} with a satisfied gate (claimable, not blocked)`
  );
}

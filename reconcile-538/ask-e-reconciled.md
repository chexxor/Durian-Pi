> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# ASK E (re-scoped) — EXTRACTION-CANDIDATE INVENTORY (impl, item #658)

Bounded per lead's re-scope: ~5-8 NAMED modules only. Sizes via LOC (Measure-Object) + bytes
(Get-Item), capture date 2026-10-16. Couplings read from the real import statements in the tree.
SKIP: whole-codebase line counts, per the instruction.

## THE CANDIDATES (7 named)

1. **src/worktree.mjs** — 470 LOC, 22,441 B. Responsible: per-seat worktree lifecycle
   (`claimWorktree` create-on-claim → identity validation → lock → `npm ci --prefer-offline` →
   `rerere`; `removeClaimedWorktree` unlock → junction/symlink refuse → `git worktree remove` →
   `.git` unlink → rm fallback; `listWorktrees`). Coupling: NONE to store/broker — imports only
   node:child_process/fs/fs-promises/path/util. Referenced BY core (seattools/rig/cli/broker,
   ~20 call sites) but touches no doc, no commit, no git state of its own. The cleanest
   extraction candidate: a pure "worktree service" module.

2. **src/job-object.mjs** — 316 LOC, 12,518 B. Responsibility: Windows Job-Object process-tree
   reaping (`spawnInJob`, `waitForProcessDeath`; C# P/Invoke helper compiled at runtime). Coupling:
   NONE — and currently ZERO importers anywhere in src/cli/ui (only `demo/job-object.test.mjs`
   references it: 14 hits). It is orphaned-but-demonstrated code: either it gets re-wired into the
   seat runner or it is already de-facto external. Extraction (or deletion) is trivial because
   nothing depends on it.

3. **src/tui/client.mjs + src/tui/driver.mjs** — 466 + 193 LOC, 19,657 + 7,848 B (27,505 B total).
   Responsibility: the full-screen interactive session (screen model, key decode, frames) — the
   summon-choose-exit/full-screen surface of D21; `renderTui`/`frameToLines`/`decodeKeys`/
   `createUiDriver`. Coupling: NONE to store/broker — it imports view-layer helpers
   (watchview.pad/truncate, chatview.formatDelta/formatArgs/themeToolRoles, ansi.ANSI). UI is
   already a separate entrypoint; its only core touchpoints are the pure view helpers.

4. **src/chatview.mjs + src/watchview.mjs + src/viewmodel.mjs** — 277 + 153 + 250 LOC, 14,057 +
   7,301 + 11,797 B (33,155 B total). Responsibility: the view MODEL + renderers —
   buildTurns/turnCollapse/extractEntryText, one-glyph watch vocabulary, pi themeToolRoles (the
   opt-in tint / glyph-not-hue derivation, src/chatview.mjs:30-32). Coupling: NONE — pure
   functions + the ANSI palette module; no doc/commit access. (attention.mjs/eventfeed readapi
   read DATA but the renderers do not; keep readapi core, the render kit goes.)

5. **src/checkup.mjs** — 336 LOC, 16,717 B. Responsibility: the rig linter — RULES[] +
   `auditRig({rig, spec, stored…})` + verifier-seat detection + formatCheck. Coupling: imports only
   ansi.ANSI; NO store/broker access — it is handed everything it checks as arguments. A plugin
   could carry the audit rules and keep `check`/`auditRig` as its exported API.

6. **src/extensions.mjs** — 105 LOC, 4,982 B. Responsibility: the config-driven loader
   (`parseExtensionList`/`loadExtensions`/`extensionNames`; loud-fail contract; duplicate-name
   refusal). Coupling: none to store — it is the loader that INSTALLS pi-durable mechanisms. It is
   the natural seam point for a plugin system, or it may simply be considered already-external
   glue (105 LOC).

7. **scripts/from-openrig.mjs** — 168+ LOC, 10,233 B. Responsibility: one-shot OpenRig rig.yaml →
   durig spec-v2 transform (topology, personas, skills, edges; D26 note about rig-level edges).
   Coupling: NONE — reads yaml, emits a spec file; `up` consumes the spec. Doc/tooling class;
   standalone by construction.

## NOT CANDIDATES (named, with the reason)

- **src/rig.mjs** (700+ LOC, 35,770 B): the STORE SEAM ITSELF — Seats/Edges/Constitution/RigQueue
  defineDoc records + the Router extension whose queue tools are the single write path. Overlaps
  the A1 one-store/one-broker migration requirement (lead #543) — moving it IS the migration, not
  a plugin extraction; it must stay core until the migration exists.
- **src/broker.mjs** (463 LOC), **src/driver.mjs**, **src/scheduler.mjs** (214 LOC), **src/genlock.mjs**: the
  serve/wake loop — imports RigQueue/Seats + driveOnce + wrapProviderWithSlots, drives the seats;
  the single-writer driver family. Same A1 reason.
- **src/seatguard.mjs / src/confine.mjs** (329 LOC): the confinement/seatguard layer (author/verifier
  ExecutionEnvs). Coupling to pi-durable env + worktree; this is the OS-trust boundary durig
  exists to guarantee — stays core (or leaves core only as part of the same migration).
- **cli.mjs** (2,294 LOC, 110,072 B): the one-shot CLI contract (non-interactive, D21) + dispatch —
  the shell OF the core verb set; its verbs live where the invariants live. Not a plugin surface
  (a dedicated verb was explicitly rejected for work items — designer #549 answer/lead #553 —
  and D21 holds cli.mjs non-interactive).

## COMPARISON HALF (BUILD vs ADOPT) — pi-durable extension seam, as read from the tree

- **Discovery/registration**: explicit operator-controlled list (`DURIG_EXTENSIONS` env, then
  config), relative paths resolved against cwd, NO auto-discovery — "which code runs in here must
  stay an explicit operator decision" (src/extensions.mjs, header comment + parse/load). A
  declared extension must declare at least one of tools/sections/hooks/tasks/wraps or install
  fails loudly (DECLARABLE check); two same-name extensions in one list fail loudly.
- **Lifecycle**: a pi-durable extension is a plain module default-exporting
  `defineExtension({name, tools?, sections?, hooks?, tasks?, wraps?})` (dist/harness/define.d.ts +
  types.d.ts:206-215); installed in a registry (`createRegistry`), selected by conversations BY
  NAME; `wraps` apply where the extension is selected (wrapTool/wrapTool names, in order).
  Loaders reload by replacing a same-name extension in place. No lifecycle apparatus required of
  the module — matches the "cheapest first extension" fit for a read-only item.
- **Capability/permissions**: in-process harness access — an extension can commit entries and
  documents, start tasks/conversations, and its tools inherit the process's OS permissions. That
  is the TRUST BOUNDARY (no capability sandboxing at this layer beyond what cli/scope tools do).
- **Versioning**: the interface has `name` but NO contract-version field; versioning today is at
  the DEPENDENCY level (pi-main.pin.json pins the exact upstream commit; `node scripts/sync-pi.mjs
  --update` moves it. A plugin seam that wants compat guarantees has to add the contract-version
  channel itself — that is a gap the BUILD side must close, not a reason against reuse.

## HONEST BOUNDS

- Sizes are from the same capture; LOC counts via naive line count (blank/inline-comment not
  filtered) — reproducible with the stated commands.
- I did NOT re-read upstream's `defineExtension` implementation beyond its type/behavioral surface
  used above; the depth is adequate for the shape comparison but not a vendoring audit.
- The margin-left attribution: D/D49/#473 wording comes from the #610/#632/#549 extracts; the
  coupling column is from real imports in this tree, and the "which docs the store seam owns"
  split (queue doc vs conversation) is recorded in the store summary in reconcile-538/ of the
  sibling item (#642 archive).

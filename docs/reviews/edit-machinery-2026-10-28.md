# Can better file-editing tools reduce our edit errors? — aider and oh-my-pi, read against our own numbers

**Question (operator, 2026-10-28):** review `can1357/oh-my-pi` and `aider-ai/aider` for whether they have
better file-editing tools, in the hope that using those ideas would reduce edit errors.

**The question I actually answered** (per the deeper-read rule in the constitution's `P2 Work protocol`): a
top editor-tooling engineer would not start from either project's feature page, or from our own prior review
of them. They would start from **our own recorded failure log** — every seat tool result is in the store — and
classify our edit errors by *cause*, because "edit errors" is at least four different defects with different
remedies. They would then read the two projects only for the mechanism that targets **our** dominant class,
marking each mechanism `observed` (code opened) or `advertised` (docs only), and they would ask for the
project's own **benchmark corpus** rather than its blog claims. The check that shows the result is right is
not "the docs say it works": it is aider's published per-run benchmark data in the tree
(`aider/website/_data/*.yml`) plus a before/after count from our own store. That is what this review runs.

Rawest material used, in order: the store's 137,368 persisted entries (`tools/edit-failure-rate.mjs`) → the
two vendored trees at pinned HEADs → aider's own benchmark corpus. Docs and READMEs last.

## Pins (generated, not typed — `docs/runbooks/competitor-review.md` Do 2)

**aider** — **Pinned HEAD:** `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` (short `5dc9490b`) · **commit date:**
2026-05-22T07:02:20-07:00 · **license:** Apache-2.0 (read `vendor/eval/aider/LICENSE.txt`; matched "Apache
License Version 2.0") · **shallow clone:** true (re-review: `git fetch --unshallow origin` in place, never
delete) · **latest remote tag:** `v0.86.3.dev` (highest of 261 version-like tags) · **manifest:** `pyproject.toml`
no top-level version (name `aider-chat`) — cite the tag and date, never this. **Freshness: `CURRENT`** — the pin
IS upstream HEAD, so the old commit date means the **project** is dormant, not that our clone is stale
(`node tools/vendor-pins.mjs --freshness`, 2026-10-28). Maturity is a judgement, not a field: aider is a mature,
slow-moving single-agent CLI whose docs site carries a large measured benchmark corpus.

**oh-my-pi** — **Pinned HEAD:** `6f3fbc94c567c0ac619c013dd15d718356eecba1` (short `6f3fbc94`) · **commit date:**
2026-10-27T22:48:30+01:00 · **license:** MIT (`vendor/eval/oh-my-pi/LICENSE`) · **shallow:** true · **latest
remote tag:** `v18.13.3` (the tracked pin table row still says `v18.13.2` — a DRIFT NOTE, upstream state).
**Freshness: `BEHIND`** — upstream is `20d6a2cc`; every claim below is made *at the pin*, and a re-review must
`git fetch --unshallow origin` in place (Do 0: move-or-clone, never delete). Re-cloning needs the operator's
grant (D146).

`node tools/vendor-pins.mjs --check` after adding aider: `PIN CHECK PASS … 8 clone(s) … 8 clone(s) pass the
review audit` (aider's pre-existing `docs/COMPETITORS.md` entry cited the same short sha, so the audit held
across the re-clone — aider is dormant, so the 2026-10-17 pin and the 2026-10-28 pin are the same commit).

Reproduce: `git -C vendor/eval/aider rev-parse HEAD && git -C vendor/eval/aider log -1 --format=%cI && git -C
vendor/eval/oh-my-pi rev-parse HEAD && node tools/vendor-pins.mjs --check`

## 1. Our editing surface, observed (this is the baseline being compared against)

Seats use pi's built-in tools unmodified. `src/seattools.mjs:218-221` registers
`read/write/edit/shell` from pi (`createEditTool()` etc.), and `grep -rn customTool src/*.mjs cli.mjs` returns
**nothing** — durian-pi defines no tool of its own and overrides none. So "our file-editing tool" *is* pi's:

| Property | Evidence (`vendor/pi-main/`, pin `2ec55d80`) | Reading |
|---|---|---|
| Match is **exact first, then normalized-fuzzy** | `src/core/tools/edit-diff.ts:209` (`content.indexOf(oldText)`), `:221-243` (fuzzy retry) | one tool, two strictness levels |
| The fuzzy pass **folds typography** | `:34-53` — NFKC, `''`→`'`, `""`→`"`, `‐‑‒–—−`→`-`, NBSP/thin spaces→space, trailing WS stripped | an anchor typed with `-` can match an em dash in the file. Leniency that prevents exactly the byte-hygiene misses this repo keeps hitting |
| Fuzzy use is **not surfaced to the model** | `usedFuzzyMatch` is internal (`:183`, `:317`); no message carries it | a touched line can come back typographically normalized with no word to the seat |
| Ambiguity is a hard refusal with a count | `:328-331`, `:264-271` — "Found N occurrences … must be unique" | good guard, **no candidates offered** |
| A miss is a bare refusal | `:256` "Could not find the exact text in X. The old text must match exactly including all whitespace and newlines." | **no nearest-candidate, no "did you mean", no applied/partial state** |
| Multi-edit calls are **atomic** | `:300-341` all edits matched and overlap-checked before `edit.ts:198` `ops.writeFile` | no partial application, so no double-apply hazard |
| Line endings and untouched lines are preserved | `:11-24` `detectLineEnding`/`normalizeToLF`/`restoreLineEndings`; `:132` `applyReplacementsPreservingUnchangedLines` | our CRLF class is handled **by the engine**, better than aider |
| Uniqueness is checked per edit against the shared base | `:328` | correct |

So the tool is *strict and atomic but mute*. It refuses, and tells the model nothing it did not already know.

## 2. Our edit errors, measured — the number that decides adoption

Instrument: `tools/edit-failure-rate.mjs` (delegate instrument, read-only; it prints the SQL `LIKE` patterns it
counted, because a count without its pattern is not evidence — D142). Run:
`node tools/edit-failure-rate.mjs ./selfdev.sqlite` — Linux, `node v24.22.1`, 2026-10-28.

```
store: ./selfdev.sqlite  entries: 137368
edit   toolResults=  1872  errors=  215  rate=11.5%
write  toolResults=   962  errors=   10  rate= 1.0%
read   toolResults=  5151  errors=  355  rate= 6.9%
  anchor miss — oldText not present      153
  not unique — Found N occurrences        10
  file missing — ENOENT                   22
edit errors by conversation: conv 9 → 126, conv 4930 → 58, conv 4924 → 22, conv 55605 → 7, conv 107595 → 2
```

Four findings:

1. **~1 in 9 edit calls fails (11.5%), and 71% of the failures (153) are anchor misses.** `write` (whole-file)
   fails at 1.0%. Same model, same turn, same file — the difference is the **anchor**, not capability. That is
   the single strongest argument that the *protocol around* the tool, not the model, is where the loss is.
2. **The errors concentrate.** 206 of 215 sit in three conversations. A protocol change applied globally is
   therefore not the highest-yield move; finding what those three conversations were doing is.
3. **`read` fails 6.9%** — a seat that cannot read the region is going to anchor from memory, and the anchor
   miss follows. The two rates are the same defect seen at different times.
4. Cost arithmetic, labelled as arithmetic: 153 misses are 153 wasted turns. At the decode speed measured for
   this rig's provider (`tools/model-probes/throughput.mjs`: ~17 tok/s for a reasoning seat), a wasted turn is
   tens of seconds, so the misses are on the order of **1–4 hours of wall clock per store-lifetime** — in a rig
   whose chronic complaint is wall-clock, and whose provider prefill is 438–1,946 tok/s cold
   (`tools/model-probes/cold-prefill.mjs`), so each retry also re-prefills a long context.

Limits of this measurement, stated: the delegate's own sessions are **not** in a team store, so this is the
team's rate, not mine; conversation ids are not resolved to seat names (sub-agent conversations are included);
`%[error] %` is pi's harness envelope (`<harness>\n[error] …`), which is why schema text that mentions the same
words is not counted (the naive count of `%must be unique%` was 1,065 — almost all prompt text, not failures).

**A second finding the measurement forced out, bigger than the question asked.** Counting shell results by tool
name shows `"toolName":"bash"` **0** times, ever, and `"toolName":"powershell"` **20,338** times — the last at
entry 216,527 of 273,995, i.e. **no seat shell call exists in the ~57k entries since the Linux move**, and the
errors cite `C:\Users\…`. Reason, observed: `src/seattools.mjs:215-221` deliberately omits `bash` ("the seat
shell is PowerShell, which `createPowerShellTool` resolves as `pwsh`, then `powershell`"), and pi's
`packages/coding-agent/src/utils/shell.ts:127` throws **"The powershell tool is only available on Windows."**
`command -v pwsh` on this box is empty. So on Linux a seat has **no working shell tool** — it can edit a file and
cannot run the demo suite the constitution makes its oracle. This is a delivery-channel precondition, recorded in
`docs/reviews/delivery-channel-linux-2026-10-28.md` and registered as ROADMAP **217**; it is the same cross-OS
family as ROADMAP 209/210 and D131.

## 3. aider — mechanisms, and two corrections to our own prior review

Re-review mode: aider's prior review (`docs/reviews/aider-review.md`, 2026-10-17) is **deficient** against the
runbook's Verify list (no generated header, no surface inventory, no standards pass, no coverage matrix), so a
freshness **delta was not a lawful mode** here. I re-cloned (same commit — aider is dormant), pinned it into the
tracked table, and corrected only the claims the operator's question touches; the missing artifacts are
registered as ROADMAP **214**, not silently skipped.

| Mechanism | State | Evidence | Verdict for us |
|---|---|---|---|
| Failure message **shows the nearest actual lines** — `Did you mean to match some of these actual lines from {path}?` | **observed** | `aider/coders/editblock_coder.py:96` + `find_similar_lines(…, threshold=0.6)` at `:602-624` | **Adopt.** This is the mechanism aimed at our 71% class |
| Failure message detects **already-applied** — `Are you sure you need this SEARCH/REPLACE block? The REPLACE lines are already in {path}!` | **observed** | `:106-109` | **Adopt.** A no-op refusal, cheap and specific |
| Partial-failure protocol — `The other N blocks were applied successfully. Don't re-send them.` + "reply with fixed versions of the blocks above" | **observed** | `:113-118` | **Adapt.** Our `edit` is atomic (§1), so the wording differs, but "re-send only what failed, and here is what already applied" is exactly what our mute refusal lacks |
| Ladder of leniency for a failed hunk | **observed, with a correction** | `:133-181`: perfect → whitespace-tolerant → spurious-blank-line drop → `try_dotdotdots` (`:190`) | **Adapt** the `...` elision idea only |
| **Similarity fallback is unreachable dead code** | **observed — correction** | `:183` is a bare `return`; `:184-187` (`replace_closest_edit_distance`, `SequenceMatcher`, threshold 0.8) is after it, and its only call site is that dead line (`grep -rn replace_closest_edit_distance aider/` → 2 hits: the def and the dead call) | **Nothing to reject.** Our prior review and `docs/COMPETITORS.md` both warn "reject the raw similarity fallback". At this pin aider never *runs* it. The warning was guarding a mechanism that does not exist on the live path |
| Post-edit gate + bounded self-repair: `auto_lint = True` by default, lint then test errors become a `reflected_message` the model is made to answer, capped at `max_reflections = 3` | **observed** | `aider/coders/base_coder.py:100-101,105,1599-1622`; the counter `aider/io.py:231,989` (`num_error_outputs`) | **Adopt.** Our rig gates *after* the fact (`check`, the demo suite); aider gates *inside the turn* |
| Cross-file fallback: if a block misses the named file, try every file in the chat | **observed — anti-pattern** | `:57-64` | **Reject.** This is the wrong-location risk, shipped as a feature |
| `--edit-format` per model (`whole`/`diff`/`diff-fenced`/`udiff`) | observed API (`aider/coders/`), advertised guidance (`aider/website/docs/more/edit-formats.md`, `troubleshooting/edit-errors.md`) | see §4 for the data | **Adopt the *measurement*, not the knob** |

**Two of our own cited numbers do not exist in the tree.** `docs/COMPETITORS.md` says high-level diffs give
"30–50% fewer errors" and bounded patching "9× fewer apply failures". At `5dc9490b`,
`git grep -i "9x\|30-50\|apply failur"` finds no such claim (only audio asset filenames). What the tree actually
claims, in `aider/website/docs/unified-diffs.md:36-45`: on 89 python refactoring tasks, GPT-4 Turbo scored
**20%** with SEARCH/REPLACE and **61%** with the unified-diff format, with laziness reduced **3×** (12 tasks →
4); a second model 26% → 59%. Those are *task pass rates on a refactoring benchmark*, not edit-apply error
rates. Corrected in `docs/COMPETITORS.md` and the review.

## 4. aider's benchmark corpus — the closest thing to an experiment we will get

`aider/website/_data/*.yml` is per-run benchmark output committed to the repo (98 runs in
`edit_leaderboard.yml`). Aider's own corpus, not ours; **confounded** — format choice is not randomized, it
correlates with which model was considered strong enough for that format. Read as directional.

Mean per edit format (`edit_leaderboard.yml`; `wf` = `percent_cases_well_formed`, `malformed` =
`num_malformed_responses`, `err_out` = `error_outputs` = times the harness had to answer the model with an
error, `io.py:989`):

| format | n | wf % | malformed | err_out | pass_rate_1 % | cost $ |
|---|---|---|---|---|---|---|
| `whole` | 63 | 99.0 | 1.7 | 10.7 | 37.6 | 0.47 |
| `diff` | 29 | 94.4 | 16.1 | 29.6 | 54.1 | 4.55 |
| `diff-fenced` | 3 | 92.7 | 20.0 | 63.0 | 50.1 | 0.94 |
| `udiff` | 3 | 95.7 | 5.7 | 6.0 (syntax) | 51.9 | 9.19 |

Direction: **anchor/diff-style formats produce ~6–12× the malformed output and ~3–6× the harness-error count of
whole-file editing**, at 10–20× the cost, while passing *more* tests (because whole-file rewrites also destroy
work on hard tasks). Nothing here says "diff formats reduce edit errors"; in aider's own data they **increase**
malformed output and increase pass rate. That asymmetry is the whole design problem, and it is model-dependent.

The paired rows are better evidence (`aider/website/_data/architect.yml`, same model, `diff` → `architect` =
propose-then-a-separate-editor-model):

- `claude-3.5-sonnet`: diff wf 99.2, malformed 4, pass 57.1, $3.63 → architect wf 100.0, malformed 0, pass 62.4, $4.95
- `o1-preview`: diff wf 93.2, malformed 11, pass 57.9 → architect wf 100.0, malformed 0, pass 60.9–64.7
- `o1-mini`: diff wf 100.0, malformed 0, pass 50.0 → architect wf 100.0, malformed 0, pass 48.9–51.9 — **no gain**

So splitting propose/apply repairs models that *were* producing malformed edits and does nothing for a model that
was already well-formed. Our rig already has an author/verifier split for *judgement*, not for *apply* — the
question for ROADMAP 216 is whether our local model is in the "malforming" group or the o1-mini group, and our
11.5% edit rate says it is at least partly in the first.

The row that should change our priorities is in `aider/website/_data/quant.yml`: across `BF16`, `fp16`,
`4bit`, `8bit`, `q4_K_M`, `q2_K`, well-formedness stays **88.7–95.5%** and pass rate 48.9–60.2 — quantization
barely matters — but one run, **"Ollama: fp16, 2k ctx", drops to wf 46.2%, 165 malformed responses, pass
43.2%.** Same model, same format; the only change is a cramped context window. Aider's own troubleshooting doc
says the same thing in prose (`aider/website/docs/troubleshooting/edit-errors.md:47-56`: local model context
"default[s] … very small and silently discards data"; "Don't add too many files … may help the LLM produce
properly formatted edits"). Cross-provider, same model, same format (`deepseek-down.yml`): wf ranges **84.0%
(67 malformed) to 99.5% (1)** — the serving stack moves well-formedness by 15 points.

**This is the finding of the review.** Our `advocate` seat's last turn consumed **244,751 / 200,000 = 1.22** of
its window and `architect` **1.09** (`cli.mjs status`), and the same provider answers HTTP 400 at 207,219 prompt
tokens (`docs/reviews/delivery-channel-linux-2026-10-28.md`). Aider's corpus says a context-cramped model
produces *half* its edits well-formed. So ROADMAP **208** (the context-fraction guard) is not adjacent to this
question — it is plausibly the dominant cause behind part of the 153 anchor misses, and should be measured
before any new editing machinery is built.

## 5. oh-my-pi (`pi-edit`) — the protocol ideas worth taking

Its editing engine is a Rust crate with five modes (`apply_patch`, `hashline`, `patch`, `replace`, `sloppy`).
Mechanisms, all **observed**:

| Mechanism | Evidence | What it would change here |
|---|---|---|
| **Snapshot tag per file version.** A 4-hex content tag (`xxh32`) minted per read/search, echoed in the edit header `[PATH#TAG]`; edits against an old tag are refused by name | `crates/pi-edit/src/store.rs:12,79` (`file_hash`), `src/error.rs:57,61,63` → `stale_tag`, `other_file_tag`, `missing_tag` | Our seats can anchor from a read many turns old and get a mute "not found". A tag turns "the file moved" into a *named* error the seat can act on |
| **Unseen-line refusal.** The store records which line numbers the session was actually shown (`seen_lines`, merged on each read); anchoring on a line never displayed is refused | `store.rs:39,106,210,229`; `error.rs:67` → `unseen_lines` | This is the machine-enforced version of the constitution's read-before-edit rule — and it fires *before* the write, not in review |
| **No-op refusal.** An edit that would change nothing is its own error class | `error.rs:73` → `no_change` | aider has the same idea (`:106-109`). Ours has neither |
| **Out-of-range / ambiguous-boundary refusals** | `error.rs:69,71` → `out_of_range`, `ambiguous_boundary` | Our uniqueness check is exact-string only; boundary ambiguity is a distinct class |
| **On a miss it shows candidate occurrences** — line numbers plus a 5-line, 80-char preview window per occurrence | `src/fuzzy.rs:28-30` (`OCCURRENCE_PREVIEW_CONTEXT=5`, `…_MAX_LEN=80`), `:56-58`, `:512-527` | The single highest-value borrow for our 153 misses: same purpose as aider's `did_you_mean`, already shaped for a model to consume |
| **Tolerant matching is bounded and named** — thresholds `DEFAULT_FUZZY_THRESHOLD=0.95`, `SEQUENCE_FUZZY_THRESHOLD=0.92`, `FALLBACK_THRESHOLD=0.8` | `src/fuzzy.rs:20-26` | pi already fuzzy-matches **silently**; theirs is the same leniency with the dial visible and the classes separate |
| **Atomic multi-file apply with a fresh re-read first** — "reread every target fresh, stage all files in memory (any failure raised before the first write)"; `InFile` response says "No files were written — sections apply atomically" | `src/session.rs:2,88,111`; response text in `modes/` | Matches what pi already gives us (§1) — evidence we are not behind on atomicity |
| **Error strings treated as a model-facing contract, byte-frozen** | `src/error.rs` header: strings deliberately byte-compatible with the prior TypeScript implementation; `:82-89` name→string mapping | Our rig rewrites seat prompts for byte-stability already; this is the same principle applied to *tool errors* |
| **Wire protocol pinned by fixtures** — parity corpora (e.g. `tests/` with leniency/envelope fixtures) | `crates/pi-edit/tests/*.rs` listed at the pin | Our `demo/*.test.mjs` pin tool *output* shapes; nothing pins an edit **failure** message |
| **Non-UTF-8 refusal naming the byte offset** | `error.rs:24` `InvalidUtf8 { display, valid_up_to }` | We detect BOM/NUL *after* the fact (`src/textintegrity.mjs`, ROADMAP 211); theirs refuses at the write |

Model-facing rules in `crates/pi-edit/prompts/hashline.md:12-16` are worth quoting to our seat-prompt authors,
because they are the discipline our 153 misses show we do not enforce: *"Touch displayed changed lines only;
`…`, `..`, collapsed `N-M:` and out-of-window lines UNSEEN. Re-read first. Tight ranges: split non-adjacent
changes; NEVER include keepers or start/end mid-expression/block"*, and *"After EVERY edit tag/numbers change:
use edit response or fresh `read`; stale tag/surprise → STOP, re-read."*

## 6. Adopt / adapt / reject (one row per decision, with the mechanism it changes here)

| # | Mechanism | Call | durian-pi counterpart it would change | Registered as |
|---|---|---|---|---|
| 1 | Failure feedback: nearest candidate lines / occurrence previews | **Adopt** | pi's `getNotFoundError` (`edit-diff.ts:256,260`) — reachable at our seam: pi exports `createEditTool` and takes `customTools` (`sdk.ts:31,94,142`), and `src/seattools.mjs` is where we already assemble seat tools | ROADMAP 215 |
| 2 | No-op / already-applied refusal | **Adopt** | same seam; one extra error class | ROADMAP 215 |
| 3 | Stale-version and unseen-line refusals | **Adapt** (we have no `seen_lines` store; a content hash per read is enough) | same seam + a per-session snapshot map | ROADMAP 216 |
| 4 | aider's lint/test-then-reflection loop, bounded | **Adopt the shape, keep our oracle** | seat-side: run the item's demo + `node --check` after the edit and feed the failure back inside the turn (≤2 retries) instead of at `check` time | ROADMAP 218 |
| 5 | Per-model edit format (whole-file for weak models) | **Adapt, measured** | our seat/model config (`rig.selfdev.json` `model`, all 12 seats currently `local/iq3_s`) — decide by our own A/B, not aider's | ROADMAP 216 |
| 6 | aider's cross-file fallback | **Reject** | would break the one-commit-per-item / worktree isolation model and is a wrong-location hazard (`editblock_coder.py:57-64`) | named rejection |
| 7 | aider's `SequenceMatcher` similarity fallback | **Reject, but correct the reason** — it is dead code at the pin | nothing | named rejection + correction in §3 |
| 8 | oh-my-pi's hashline line-addressed grammar (PUT/CUT/registers) | **Reject wholesale** | it is a *different protocol* for a *bigger* model; our seats call pi's `edit`, and pi's tool surface is a pinned vendor build input (`pi-main.pin.json`, `scripts/sync-pi.mjs`). Adopting a grammar means owning an engine | named rejection |
| 9 | Their byte-frozen error strings + fixture-pinned failure shapes | **Adopt the discipline** | `demo/*.test.mjs` should pin at least one edit-failure message, so a pi sync cannot silently mute our seats' feedback | ROADMAP 215 |
| 10 | Anything that widens fuzzy matching to avoid misses | **Defer** | pi *already* fuzzy-matches silently (§1). We have not measured how many of the 153 misses were near-misses that fuzzy should have caught — that measurement is the gate on all leniency work | ROADMAP 215 acceptance criterion |

## 7. Coverage matrix (durian-pi at 2026-10-28, against what these two claim)

| Control | us | evidence / gap |
|---|---|---|
| Exact-match anchor + uniqueness guard | **have** | `edit-diff.ts:328-331` |
| Atomic multi-file / multi-edit apply | **have** | `edit-diff.ts:300-341`, `edit.ts:194-198` |
| CRLF / untouched-line byte preservation | **have** | `edit-diff.ts:11-24,132` |
| Typographic leniency | **have, silently** | `:34-53`; not surfaced to the seat |
| Failure feedback (candidates, applied state, no-op) | **lack** | `:256,264` are mute; aider `:96-118`, omp `fuzzy.rs:512-527` |
| Stale-read / stale-file guard | **lack** | no tag/hash check anywhere in our path |
| Read-before-edit enforcement | **prompt-only** | constitution + seat instructions; omp enforces via `unseen_lines` |
| Post-edit deterministic gate **inside the turn** | **lack** | our gates are post-hoc: `cli.mjs check`, `src/textintegrity.mjs` (changed files only), the demo suite; aider `base_coder.py:1599-1622` |
| Byte-hygiene detection (BOM/NUL/no-final-newline) | **have (post-hoc)** | `src/textintegrity.mjs`; ROADMAP 211 covers latent committed defects |
| Edit-failure measurement | **now have** | `tools/edit-failure-rate.mjs`, this session |
| Edit-protocol fixtures pinning failure shapes | **lack** | `demo/` pins tool output shapes, not edit failures |
| Context-headroom guard as an *edit-quality* control | **lack** (registered) | ROADMAP 208; aider `quant.yml` 2k-ctx row is the external evidence |

## 8. Where this does not fit our constraints

- **`D22` family / vendoring policy:** `vendor/eval/` is read-not-borrowed and gitignored; aider is Apache-2.0
  and oh-my-pi MIT, so borrowing is lawful with attribution, but neither is a dependency. Their code is
  Python/Rust; ours is ESM on Node. Every call above is *mechanism*, none is a port.
- **pi is a build input, not a library we fork** (`pi-main.pin.json`, `scripts/sync-pi.mjs`). Anything that
  changes an edit tool's behaviour must live at our own seam (`src/seattools.mjs` supplying a tool definition)
  and survive a pi sync — which is exactly why the fixture-pinning item (row 9) is not optional.
- **Model reality.** aider's corpus is dominated by frontier hosted models; our 12 seats are all
  `local/iq3_s` at ~17 tok/s decode with a 200,000-token advertised window, and our candidate verifier
  (`ministral-3-14b-reasoning`) advertises only **13,273** tokens (`docs/reviews/verifier-model-survey-2026-10-27.md`).
  A line-addressed grammar with tags and registers spends tokens on ceremony; on a 13k-context verifier that
  ceremony may cost more than it saves. Any adoption must be A/B'd on *our* provider.
- **Single-model rig.** aider's `--edit-format` knob presumes a menu of formats and models; we have one tool for
  every seat and one model family (ROADMAP 208/210 territory), so format selection is a smaller lever here than
  in aider's world — and the whole-file alternative collides with our text-integrity and diff-review surfaces.

## Do 5 · standards / checklists / benchmarks pass (the zero, with its pattern)

For the *editing* question there is no external standard to adopt. That is a measured zero, not a shrug:
`node tools/competitor-brief.mjs --project aider` searched the pattern
`\bOWASP\b|\bNIST\b|SP ?800|CIS Benchmark|ISO ?27001|…|\bCWE-?[0-9]+\b|…` over the clone index (`*.md/.mdx/.yml/
.yaml/.json`, fixture dirs excluded) → **3 files**, all configuration docs (`aider/website/docs/config/
{aider_conf,dotenv,options}.md`), none about editing. oh-my-pi's analogue is not a standard but its own parity
fixture corpus (§5, row 9). The relevant "checklist" artifacts in these two projects are their **benchmark
corpora**, and I treated them as such: `aider/website/_data/` (14 yml files; `edit_leaderboard.yml` 98 runs,
`quant.yml` 14, `architect.yml` 20, `code-in-json.yml` 44) and `aider/benchmark/benchmark.py` (the code that
produced them, `:486-525` — the metric definitions). No OWASP/NIST/CWE mapping is claimed by either for file
editing; nothing to reject by category.

## Surface inventory (what I opened, and what I did not)

| Area | Opened? | What it yielded |
|---|---|---|
| `aider/coders/editblock_coder.py` | yes (ladder, apply, failure text) | §3 mechanisms + the dead-code correction |
| `aider/coders/base_coder.py` | yes (targeted grep: reflection, lint, test) | the in-turn gate + bounded retry |
| `aider/io.py` | yes (targeted) | `num_error_outputs` definition = what `err_out` means |
| `aider/website/_data/*.yml`, `aider/benchmark/benchmark.py` | yes (4 files parsed, metrics read) | §4 — the quantitative core |
| `aider/website/docs/unified-diffs.md`, `troubleshooting/edit-errors.md` | yes | their claims and remedies; corrected two of ours |
| `aider/website/docs/more/edit-formats.md`, `usage/{lint-test,modes}.md`, `repomap.md` (prior review) | prior review only | not re-read this pass |
| `aider/coders/udiff_coder.py`, `base_coder.py` in full | partial (grepped, not read end-to-end) | udiff mechanics; the *ordering* of prompt assembly |
| `aider/linter.py`, `aider/repo.py`, `aider/commands.py`, `aider/sendchat.py`, SWE-bench harness, `aider/queries/`, `aider/website/_posts/` | **not read** | out of scope for editing; SWE-bench would need a network run |
| `vendor/eval/oh-my-pi/crates/pi-edit/{engine,session,store,error,fuzzy}.rs`, `modes/sloppy/mod.rs`, `prompts/hashline.md`, `tests/` listings | yes (targeted reads/greps) | §5 |
| `oh-my-pi` `crates/pi-native`, `pi-tui`, `pi-*` tool crates, its `docs/` (670 md across 36 areas) | **not re-walked** — the seat-persona surface is already walked in `docs/reviews/oh-my-pi-review.md` at this pin | cross-referenced, not duplicated |
| `vendor/pi-main` `coding-agent/src/core/tools/{edit,edit-diff}.ts`, `core/sdk.ts`, `utils/shell.ts` | yes | §1 baseline + the Linux shell finding |

## Recorded-decision check

- **D22 (vendored code is read, not borrowed)** — no adoption here violates it; every call is mechanism-level.
- **D131 / ROADMAP 209, 210 (native host OS; cross-OS artifacts)** — the `powershell`-only seat shell
  (`src/seattools.mjs:215-221`, pi `utils/shell.ts:127`) is a **live violation on this host**, reported as
  ROADMAP 217 rather than patched in the rig file by me.
- **ROADMAP 208 (context-fraction guard)** — §4 supplies the external evidence for it; my call is that it is
  upstream of most edit-format work, not downstream.
- **ROADMAP 90 (`format` verb, delivered)** — unchanged by this; our EOL class is engine-handled (§1).
- **ROADMAP 102/106/113/114** as cited in `docs/COMPETITORS.md` — 102 (per-model apply-rate measurement) is now
  measurable with `tools/edit-failure-rate.mjs`; 106 (post-edit lint/test gate) is the aider mechanism, row 4.
- **Constitution `P2 Scope` vs `P2 Work protocol`** — I did not touch the team's constitution for this
  question; the deeper-read pass is mine, the seat-facing rule is already in place from the 2026-10-28 amendment.

## Verdict, and the check that would show it is right

**Do not adopt a competitor's editor. Adopt their conversation with the model, and fix the two things the data
says are upstream of format choice: context headroom and a working shell on this host.** Concretely:

1. **Before any new machinery:** run ROADMAP 208's guard and/or compact `advocate`/`architect`, then re-run
   `node tools/edit-failure-rate.mjs ./selfdev.sqlite`. If the anchor-miss count per 1,000 edits falls when the
   fraction does, most of the editing-machinery budget is misdirected. aider's `quant.yml` 2k-ctx row
   (wf 46.2%) is the external prior for this.
2. **Cheapest real win (ROADMAP 215):** make an edit refusal *informed* — occurrence previews (omp
   `fuzzy.rs:28-30,512-527`), already-applied / no-op detection (aider `:106-109`; omp `error.rs:73`), and
   what-applied state. Falsifiable check: a `demo/` test that plants a near-miss anchor and asserts the refusal
   names a candidate line number, plus a store re-run 2 weeks after landing showing anchor-miss share < 71%.
3. **Second win (ROADMAP 218):** the in-turn deterministic gate with a bounded retry. Falsifiable check: a seat
   that introduces a syntax error fixes it without a second message from the harness.
4. **Measure, don't import, the format question (ROADMAP 216).** Falsifiable check: 12 real items replayed with
   the same seat/model under (a) today's `edit`, (b) whole-file `write`; decide on anchor-miss rate, apply
   failures, and diff-review burden — aider's own corpus says whole-file wins on well-formedness (99.0 vs
   94.4%) and loses on cost and on hard-task pass rate, so "whole-file is better" is not a safe import.
5. **Reject outright:** aider's cross-file fallback; a line-addressed tag grammar for our seats; any *wider*
   fuzzy matching until we have counted how many of the 153 misses were near-misses.

**What would change my mind:** evidence that most of the 153 misses are *stale-file* misses (the file changed
under the seat) rather than *stale-read* misses (the seat mis-copied) — that would promote the tag/unseen-line
guard (216) above the feedback work (215); or a measurement showing pi's silent fuzzy pass already absorbs most
near-misses, which would shrink 215's expected yield to almost nothing.

## Open loop

`docs/reviews/edit-machinery-followup-research-prompt.md` — one question for the operator's research agent:
what is the published evidence that **error-message content** (candidate previews, applied-state, named refusal
classes) changes agent edit success rates, as distinct from edit *format*? See `docs/runbooks/research-request.md`.

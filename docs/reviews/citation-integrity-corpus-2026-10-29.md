<!-- cite-ns: quoted -- this file quotes other files' footnote namespaces; tools/review-cite-check.mjs reads this marker -->
# Citation integrity across the review corpus — delegate measurement (2026-10-29)

**Delegate, not a seat.** Nothing here is claimed, completed, or routed. The instrument and the alias table are the
cheap halves ROADMAP **250** and **244** asked for; the corpus repair they expose is **seat work** and stays unclaimed.

**Host and clock, per 244:** `Alex-Desktop-Win10`, Linux Fedora `7.2.11-200.fc42.x86_64`, node v24.22.1,
`2026-10-29T03:4x–04:0xZ` = Wed Oct 28 22:4x–23:0x **CDT (UTC−5)**. Every number below came from a command that is
printed next to it.

## 1. What was built

`tools/review-cite-check.mjs` (new, 774 lines, self-test `--self-test` **12/12**) and the alias table it reads,
`docs/reviews/harness-citation-registry.md` (29 rows). One command, whole corpus:

```bash
node tools/review-cite-check.mjs                     # full audit; 127 files; exit 1 = defects exist
node tools/review-cite-check.mjs --gate              # the "wrong TODAY" set only
node tools/review-cite-check.mjs --fetch 200         # opt-in liveness probe of cited URLs (offline by default)
```

Measured cost: **1.3 s** offline over 127 files · **68 s** cold with 192 URL probes · **1.3 s** warm
(`.spike/probe-cache.json`, 7-day freshness). A 1.3-second check is the difference between a rule that gets run and
one that does not. `--self-test` is **12 cases, 137 ms**.

## 2. The census (full audit, `--top 0`, re-run 2026-10-29T04:2xZ after every instrument fix in §5)

**127 files scanned** (`docs/reviews/`, `docs/incidents/`, `inputs/fetched/`) · **81 files clean** ·
**522 findings: 292 hard-failing, 230 not-failing, 2 suppressed by markers** — and the two suppressed ones are
*printed*, not hidden, because a checker that hides its own exceptions is not auditable. The same run before the
§5 fixes printed **589 findings / 297 hard**; the 67 that disappeared were **the instrument's own false positives**.

| class | n | hard | what it means |
|---|---:|---:|---|
| DANGLING KEY | 148 | **89** | a `[^key]` used with no definition in that file. 59 of the 148 are **soft** because the file declares `cite-ns: quoted` (a note *about* another report) |
| KEY COLLISION | 108 | **108** | the same key DEFINED with different targets inside one document family |
| DUP DEFINITION | 71 | **71** | `[^1]:` twice or more in one file — 29 in `building-agent-systems-on-pi-research.md`, 24 in `tui-streaming-research.md`, 12 in `llm-prompting-for-git-merging-followup.md`, 5 in `memory-followup-research.md`, 2 elsewhere |
| PATH AMBIGUOUS / UNRESOLVED / UNNAMED-CLONE / CLONE ABSENT | 129 | 0 | real soft queue: bare basenames that resolve in 2–7 clones, clones not on this host, citations that land in a tree the file never names |
| SIZE MISMATCH | 24 | **6** | "N lines" claims measured at an **immutable pin** (`permissions_toml.rs` 1,457 claimed vs **680** at `codex d373d64`; `metagpt/…/skill_manager.py` 278 vs **79**; `symphony/elixir/AGENTS.md` 30 vs **76**). The other 18 are own-tree claims, soft by design — our repo drifts, a pin does not |
| PATH NEVER EXISTED | 9 | **9** | **phantom cites**: no branch ever had the path. 8 in `tui-attach-vs-poll.md` (`src/harness/harness.ts`, `src/types.ts:917` — upstream pi paths cited as if they were ours), 1 in `pi-harness-usage-audit-2026-10-28.md` (`docs/configuration.md:39`) |
| PATH MALFORMED PATH | 2 | **2** | elided addresses: `vendor/pi-main/.../edit-diff.ts:256` (`aider-review.md:35`), `.../storage/sqlite/node.ts:146` (`architecture-broker-review.md:220`). This row quotes them, so the row carries the ignore-line marker — the count stays 2, the quote stays legal <!-- cite-check: ignore-line --> |
| LINE OUT OF RANGE | 2 | **2** | anchors past EOF at a pin: `crewai/…/templates/CLAUDE.md:1-8` (7 lines), `codex/sdk/python/…/models.py:81` (76 lines) |
| DEAD URL LINKED | 5 | **5** | see §4 |
| URL MOVED (RECORDED) | 10 | 0 | the cited locator rotted, the page lives — cite the final address or the pin |
| ALIAS INFERRED — NEEDS URL | 8 | 0 | the registry maps a hex tag to a canonical key **without** the round ever printing its URL (250) |
| SIZE CLAIM CORRECTED IN LINE | 3 | 0 | a line that says "680, not the 1,457 from memory" is a **correction**, and failing it would train readers to ignore the gate |
| UNUSED DEFINITION | 3 | 0 | a definition nothing cites — soft, because a References block may legitimately anticipate a citation |
| REGISTRY defined_in STALE | 1 | 0 | the registry names a file that no longer defines that key |

This note is inside its own scan and **self-charges 14 findings, all soft** (it quotes other reports' keys and paths,
and declares `cite-ns: quoted`). That is deliberate: an instrument that exempts its own author is the one 240–243
exist to prevent.

**The headline is not the count, it is the shape.** `building-agent-systems-on-pi-research.md` defines `[^1]` at
lines **111, 553, 987** with three different targets, and `[^2]…[^10]` the same way. That is one research report
**appending a second and third References block under the same numbers**. Renderer-independent statement of the
defect: whichever tie-break a renderer picks, **two of the three targets are unreachable from the body text**, so a
sentence in that report is not traceable to the source the author meant.

What the vendored renderer actually does (experiment, not memory — `marked` **18.0.11**, a transitive dependency;
**nothing in `src/` imports it**, so this is not a statement about our product's UI):

```
[^1]: https://e.com/one
[^1]: https://e.com/two

Body [^1].        ->  <a href="https://e.com/one">^1</a>   # FIRST definition wins; the second is unreachable
```

and with this corpus's own shape, `[^1]: [Name](https://e.com/one)` renders as
`<a href="%5BName%5D(https://e.com/one)">^1</a>` — **`marked` has no footnote support**: the href is the literal
`[Name](url)` text. Do not "fix" the corpus by assuming any renderer will make footnotes meaningful.

## 3. The thing 250 was actually about, now machine-checked

Targeted run over the three harness rounds:

```bash
node tools/review-cite-check.mjs docs/reviews/harness-tools-skills-public-harnesses-research.md \
  docs/reviews/harness-tools-skills-public-harnesses-research-r3.md \
  docs/reviews/harness-tools-skills-public-harnesses-research-4.md
```

* Round 2's **9** dangling keys reproduced independently (the tool was not given the list).
* Round 4's `[^1]`/`[^2]` collide with round 2's — the gate that blocks pasting round 4 into round 2.
* **A third collision nobody had recorded: round 3 collides too**, on `[^1]`, `[^2]` **and** `[^3]`
  (`[^3]` = `learn.chatgpt.com/docs/hooks` vs round 2's `…/config-file/config-advanced`). Round 3 is already labelled
  *verified*, which is exactly the trap: verified-in-the-past ≠ key-compatible-now.
* The alias table now gives `hex tag → round-2 number → URL at the MANIFEST pin` for 14 tags, with an `evidence`
  column; 8 of them are `inferred` and the checker says so on every run (`ALIAS INFERRED — NEEDS URL (8)`).

## 4. What a URL probe can and cannot prove (this is where a naive tool lies)

Probed **192 cited URLs** live, 2026-10-29T03:57–03:59Z, from this host: **176 → 200, 9 → 403, 4 → 429, 1 → 401,
2 unreachable.** My first version called the 403/429s **dead** and reported **24** hard dead-URL findings. They are
not dead: Medium, `openai.com`, `mckinsey.com`, `researchgate.net`, `componentsource.com` refuse non-browser clients.
The rule now in the tool: **only 404/410/510 are dead**; 401/403/429/503 → `URL UNVERIFIABLE (BOT-BLOCKED)` soft; a
network failure → `URL UNPROBED` soft, never dead.

Redirects need the same care. Without `-L` (or with redirects not followed) `curl -w '%{http_code}'` returns **308**
for `docs.cline.bot/features/cline-rules` and `cursor.com/docs/context/rules` — which a "does it resolve?" check
calls dead and which are in fact **live pages at rotted addresses**:

| cited in the corpus | lands today (HTTP 200) |
|---|---|
| `https://docs.cline.bot/features/cline-rules` (round 2 `[^8]`) | `https://docs.cline.bot/customization/cline-rules` |
| `https://cursor.com/docs/context/rules` (round 2 `[^6]`, round 4) | `https://cursor.com/docs/rules` |
| `https://developers.openai.com/codex/agent-approvals-security` (round 2 `[^7]`) | `https://learn.chatgpt.com/docs/agent-approvals-security` |
| 6 cited URLs under `github.com/chexxor/Pi-OpenDurig…` (**21** mentions across `docs/` + `inputs/`) | `github.com/chexxor/Durian-Pi…` — the repo was renamed; every one of those citations is a redirect, not an address |
| `anthropic.com/engineering/code-execution-with-mcp` | `anthropic.com/research/code-execution-with-mcp` |

Query-only differences (`?hl=vi`) and `/challenge`-`/transit` interstitials are **not** moves and are classified
separately. These are recorded as machine-readable rows in `inputs/fetched/MANIFEST.md` **§6** so the offline default
catches them without a network.

**And the finding that matters for the harness study:** the three Goose site paths round 2 cites as `[^4] [^9] [^10]`
are **404 with no redirect** (probed twice, 03:53Z and 03:57Z), yet the same URLs are printed in its §2 matrix rows
17–19 under the column `advertised-elsewhere`. A dead URL in an evidence table reads as evidence — ROADMAP **243**,
now gated by a command instead of by vigilance.

## 5. Bugs the instrument found in ITSELF (why the self-test is not decoration)

Each of these produced a **false** finding on a real file before it was fixed, and each is now pinned by a
`--self-test` case or a comment naming the file it got wrong:

1. `wc -l` vs `split("\n")` — invented three SIZE MISMATCH findings (`aider` is 40 lines; `wc` agrees) and a fourth on
   `goose/documentation/docs/goose-architecture/extensions-design.md` (127 newlines, no trailing newline → 128 content
   lines). Now: report both numbers, and a 1-off explained by a missing trailing newline is soft.
2. The extension alternation matched `md` before `mdx`, so `docs/customization/cline-rules.mdx` was reported as a
   **phantom path** — in my own prior note. Fixed with a `(?![A-Za-z0-9])` guard; `.tsx`/`.jsonc` had the same bug.
3. A URL regex that swallowed a trailing backtick and period called `https://cursor.com/docs/hooks\`` **404**.
4. Own-tree size claims were made **hard**, inflating the pin-based count from 6 to 23. A pin never moves; our own
   tree does (`src/broker.mjs` "491 lines" is 2,271 at HEAD today) — so only `vendor/` pins are hard.
5. A line that *corrects* a bad figure (`"1,457 lines" from memory; the pin says 680`) is not itself a bad claim. Two
   such lines are now `SIZE CLAIM CORRECTED IN LINE` soft.
6. Cross-file collision detection initially merged **22 unrelated reports** into one "namespace" from cross-citation
   alone and invented 81 collisions. Family = shared filename stem (`x.md`, `x-2.md`, `x-followup.md`, `x-r3.md`,
   `x-research-4.md`); ordinary Markdown gives every file its own footnote namespace, and a checker that cries wolf
   gets ignored.
7. **It charged its own evidence note for a defect it was illustrating.** The note shows `marked`'s duplicate-
   definition behaviour inside a ``` block, and the checker scored those two `[^1]:` lines as a real `DUP DEFINITION`.
   Footnote syntax has no meaning inside a fence, so fences are now tracked and footnote defs/markers are skipped in
   them — while paths, sizes and URLs **still count inside fences**, because real citations are written there too.
   The general lesson: a checker that scores *examples* as *assertions* teaches authors to stop writing examples.
8. `--json --top 0` **silently corrupted its own machine output**: `--json` took `--top` as its filename and `0` became
   a path argument, and `Number(0) || 12` turned "print no groups" back into 12. Fixed by requiring `--json` to name a
   file and parsing `--top` numerically. Any flag that takes a value can leak its value into the positional path list —
   worth knowing before trusting a JSON artifact from a hand-typed command line.

Deliberate escape hatches, all counted in the output rather than silent: `<!-- cite-ns: quoted -->` (this file
quotes another file's keys) and `<!-- cite-check: ignore-line -->` / `ignore-file`. The last full run printed
`2 SUPPRESSED by cite-check markers` — both of them this note quoting an elided path.

## 6. What is left, and who owns it

* **Seat work, unclaimed:** re-key round 3 and round 4 onto round 2's numbers before any merge (250); the corpus
  repair for 89 hard dangling keys, 108 collisions and 71 duplicate definitions (252); the 9 phantom path cites and
  2 elided addresses (244); the pin re-anchor pass over the harness matrix (251).
* **Delegate-side follow-up recorded in 252:** decide a **citation convention** for the corpus (path-anchored
  citations with a named clone/pin, or numbered footnotes defined once) — the checker cannot choose it, and 252's
  counts will keep re-appearing until someone does.
* **Not** done here: no report text was rewritten, no citation "fixed", no queue item touched, nothing pushed.

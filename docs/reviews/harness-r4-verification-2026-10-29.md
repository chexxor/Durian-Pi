# Round 4 of the public-harness study — delegate verification (the integration gate)

**Run:** 2026-10-29T03:0x–03:1xZ (= 2026-10-28 22:0x–22:1x **host-local**, `America/Chicago` CDT = UTC−5) on
`Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1, HEAD `8557071e`. **Linux** throughout; every
number below came from a command in this session (Appendix A lists them), not from any other report.

**What was owed** (`docs/NEXT.md`, "Owed from here"): *"verify round 4's Task A text against round 2 before integrating
**any** of it — count the dangling markers, re-anchor them from `vendor/eval/` and `inputs/fetched/MANIFEST.md`, and
decide which of its 'four things that do not survive re-checking' are real."* Round 4 =
`docs/reviews/harness-tools-skills-public-harnesses-research-4.md` (17,412 B / 196 lines, still **untracked**); round 2 =
`...-public-harnesses-research.md` (the file that is integrated and cited by ROADMAP); round 3 = `...-research-r3.md`
(verified 2026-10-28).

**Verdict in one line: do not paste round 4's Task A into round 2 — its citation keys collide with round 2's. Three of
its four corrections are real (one now provable at a source pin), the fourth is false, and one more defect exists that
round 4 did not see.**

---

## 1. Marker census (measured, `node` over the three files)

| file | marker occurrences | distinct `key#anchor` tokens | distinct **base** keys | base keys with a definition line | **dangling** |
|---|---:|---:|---:|---:|---:|
| round 2 (integrated) | 184 | 65 | **23** | **14** (lines 250–263) | **9** |
| round 3 | 24 | 18 | 8 | 3 | — |
| round 4 | 72 | 64 | 16 | 2 + 7 `### [^key]` headings | — |

The 9 keys round 2 uses with an inline `#line` anchor and **never defines anywhere in the file**:
`542f21 b736c3 20106b d32e06 04a0b7 5389e9 3d9c8f 5f6188 dccefb`. Every load-bearing sentence in §1 and §2 leans on
several of them — e.g. ROADMAP-facing claims `[^20106b#405]` ("the permission layer is the real gate"),
`[^04a0b7#427]` ("dynamically enabled extensions are session-only") and `[^d32e06#246]` ("rules consume context tokens
with no cap") are **unresolvable to a URL from inside round 2**. That is the hole both round 3's Task A and round 4's
Task A were commissioned to fill.

**Two numbers in `docs/NEXT.md` corrected:** "only 21 of its 64 distinct `[^key]` markers also appear among round 2's
65" — **confirmed exactly** (21 / 64 / 65). "0 exact shared lines" — **wrong as stated**: 14 lines are byte-identical
between round 2 and round 4, and they are `---`, `|---|---|…|` table separators and `**References**`. In substance
NEXT.md is right (**0 shared content lines**), and the precise claim to carry forward is that.

Round 4 is **not a duplicate**: of its 197 lines, 146 are non-blank, and **132 of those appear nowhere in round 2**
(the 14 shared lines are separators only). It supplies source names for **6 of the 9 dangling keys** — `20106b`, `3d9c8f`,
`dccefb`, `5f6188`, `d32e06`, `04a0b7` (the last three named inside compound headings, not as their own heading). The
remaining 3 — `542f21`, `5389e9`, `b736c3` — stay unresolved by both round 3 and round 4.

## 2. The blocking defect round 4 did not see: its keys mean *different pages* than round 2's keys

Round 2's References block (lines 250–263) defines `[^1]`…`[^14]`. Round 4's Task A headings reuse two of those numbers
for **other sources**:

| key | round 2 defines it as | round 4 uses it for |
|---|---|---|
| `[^1]` | Hooks reference — `code.claude.com/docs/en/hooks` | **Claude Code skills** — `…/docs/en/skills` (= round 2's `[^2]`) |
| `[^2]` | Extend Claude with skills — `…/docs/en/skills` | **Cursor rules** — `cursor.com/docs/context/rules` (= round 2's `[^6]`) |

and it re-cites already-numbered pages under **hex tag keys** taken from its sandbox's `web_fetch` filenames:

| round 4 key | page (round 4's own words) | round 2 key for the same page | evidence for the mapping |
|---|---|---|---|
| `20106b` | Claude Code hooks — `code.claude.com/docs/en/hooks` | `[^1]` | round 4 heading names the URL |
| `542f21` | Claude Code skills | `[^2]` | round 4's own fetched table: `extend-claude-with-skills-claude-code-docs_542f21.md` |
| `5389e9` | Cursor rules | `[^6]` | round 4's own fetched table: `rules-cursor-docs_5389e9.md`; **and the page re-fetched this session hashes to the MANIFEST's `[^6]` row** (§4) |
| `5f6188` | Cursor hooks | `[^5]` | heading names the page family; URL not printed |
| `3d9c8f` / `dccefb` | Codex config / Codex approvals | `[^3]` / `[^7]` | heading names the page family only — **inferred**, needs a URL line before use |
| `d32e06` / `2d9eb4` | Cline rules / Cline hooks | `[^8]` / `[^11]` | `d32e06` confirmed by the page re-fetched this session (§4); `2d9eb4` inferred |
| `04a0b7` / `d2cffc` / `d3d5bf` | Goose extensions / extensions-design / recipe reference | `[^9]` / `[^10]` / `[^4]` | heading names the family; **inferred** |
| `50ad47` / `ded888` / `f06a5e` | claude-code#57776 / copilot-cli#4438 / copilot-cli#978 | `[^12]` / `[^13]` / `[^14]` | round 4's User-reports table prints the issue numbers |

So a paste of round 4's Task A **as text** into round 2 would silently re-point every `[^1]`/`[^2]` citation in the
integrated report, and would leave two parallel namespaces (`[^20106b]` and `[^1]`) for the same page — the exact
condition that made the 9 dangling keys possible in the first place. **Rule to carry into the integration: one alias
table first (`hex tag → round-2 number → URL at the MANIFEST pin`), then merge anchors, then re-run the citation
self-check.** Never merge the other direction.

## 3. Round 4's "Four things in the report that do not survive re-checking" — adjudicated

1. **REAL.** §1 (line 61) says a repo-committed instruction file is converged in **"(all five)"**; §2's own
   *Repo-scoped extension* row (line 77) says of Goose: "not found (global `~/.config/goose/config.yaml`)
   `[^04a0b7#305]`". The contradiction is in the file. Note the precise fix: §2's *Memory file* row (line 86) does give
   Goose a mechanism ("Top of Mind", global), so the honest replacement is **"four of five have a repo-committed file;
   Goose's is global-only"** — not "four of five have nothing".
2. **NOT SUPPORTED as stated — and correcting it matters.** Round 4 says round 2's `[^13]` row is "backwards". Round 2's
   row already reads *"Skill **loadable by the user** but unreachable by the model"* (line 198), which is what the
   thread actually says: copilot-cli **#4438** is **open**, 19 reactions, 12 comments, and comment (Bozodragon,
   2026-09-11) reports *"the explicit slash invocation successfully injects `<skill-context name="wayfinder">` … the
   assistant then redundantly calls `skill` with `{"skill":"wayfinder"}`, which returns `Skill not found`"*. Round 2's
   direction is right; round 4 misread the row label. **What round 4 adds, and it is real and useful, is the
   consequence:** a working injection path already exists (slash-invocation injects the body), so the failure is in the
   model-facing resolver, not in the file format. Keep the consequence; drop the accusation.
3. **HALF FALSE.** Measured against the GitHub API at 2026-10-29T03:10Z: claude-code **#57776** is **closed**,
   `state_reason: duplicate`, **0** reactions, 3 comments → round 4's "(dup … zero reactions)" ✓ (its "dup of #15178"
   was not checked). copilot-cli **#978** is **open**, `state_reason: reopened`, 8 reactions, 12 comments → round 4's
   "author closed as model issue" is **false**; do not carry it. The second half of the claim is **real**: §6's
   user-report rows cite only `[^12] [^13] [^14]`, i.e. two vendors, while the report compares five.
4. **REAL, and now provable at a pin rather than at a URL.** Round 4 says `[^5389e9#27]`, `[^d32e06#63]`,
   `[^d32e06#79]` are sidebar nav, not claims. In the bytes fetched this session: "Memory Bank" occurs only as nav
   markup (`data-title="Memory Bank"`, and nav JSON `"group":"Best Practices","pages":[{"title":"Memory Bank"…`), and
   "Hooks" likewise inside a sidebar `<a>`. Stronger, source-level: in `vendor/eval/cline` at pin `51f63e4`, the doc that
   generates that page — `docs/customization/cline-rules.mdx`, 398 lines — **never mentions "Memory Bank" at all**, so
   the citation could not have come from the page's content. Round 2 already labels `#79` as nav in its own §8 item 5
   ("cited in the nav, never read"), so this is a confirmation plus a source, not a new claim against round 2.

## 4. Anchor stability, measured (this is the finding that changes the procedure)

Re-fetched on this host at 2026-10-29T03:10Z into `.spike/fetch-r4/` (gitignored):

| URL | HTTP | bytes | sha256 (first 16) | vs `inputs/fetched/MANIFEST.md` pin |
|---|---:|---:|---|---|
| `cursor.com/docs/context/rules` | 200 | 514,147 | `bfde51ac1ed89008` | **identical** |
| `docs.cline.bot/customization/cline-rules` | 200 | 286,014 | `ca7dc20c5a542abf` | **identical** — but MANIFEST records the URL as `/features/cline-rules`; the path moved and redirects to the **same bytes** |

Two rules follow, and they pull in opposite directions:

- **Byte integrity holds; the recorded URL may rot.** MANIFEST's sha256 pins reproduced exactly one day later, so a
  sha256 column is worth having — but the *locator* drifted (`features/` → `customization/`), so a MANIFEST row must
  store the final URL after redirects, not the requested one.
- **Line-number anchors do not survive at all.** Round 4's copies are `web_fetch` markdown (476 / 1,073 lines); the
  bytes on this host are HTML (514 KB / 286 KB). There is no line mapping between them. So for the five harnesses now
  cloned and pinned (`claude-code-docs 58d6da1`, `codex d373d64`, `cline 51f63e4`, `goose 775b395`,
  `copilot-cli 84ee80e` — `tools/vendor-pins.mjs --check` PASS at 14 clones this session), **the repair is to re-anchor
  at the pin, not to re-fetch the page**; for web-only vendors (Cursor), only ≤40-word quotes are portable (D159).

## 5. A defect round 4 did not see: round 2's §8 note 7 is now stale, and §6 cites outside its own set

- Round 2 §8 item 7 (line 244) says *"none of these five is cloned, so no `observed` claim has been made and none should
  be inferred"* and advises cloning them. As of this session **all five except Cursor are cloned and pinned** (14 clones,
  `--check` PASS). The advice is superseded, and with it the framing that these cells are permanently
  `advertised-elsewhere`: the cells are now upgradeable to `observed` **at a pin**, cheaply — that is where round 4's
  Task A should actually be re-anchored (its own anchors cite `code.claude.com`, `docs.cline.bot` and
  `block.github.io` pages whose source text is in `vendor/eval/`).
- Round 2 §6's user-report evidence is `[^12]` (anthropics/claude-code), `[^13]`, `[^14]` (github/copilot-cli) — but
  **copilot-cli is not one of the five harnesses round 2 compares** (Claude Code, Codex CLI, Cursor, Cline, Goose). So
  §6 is not merely two-of-five vendors, it mixes in a sixth that has no row in the §2 matrix. `copilot-cli` *is* pinned
  (`84ee80e`), so the cheap fix is either to add its §2 row or to move those three rows under a labelled
  "adjacent-vendor" heading. Registered as ROADMAP **251**; the key-collision and dangling-key repair is **250**.

## 6. What is safe to integrate now (and what is not)

Safe, no further gate: §1 "(all five)" → "four of five, Goose global-only"; the `#79`/`#63`/`#27` nav-link correction
(round 2 already concedes `#79`); the "slash-injection already works" consequence from #4438, with the accusation
dropped; the §8 note-7 staleness; the MANIFEST URL fix (§4); the three issue rows' live state (open / open-reopened /
closed-duplicate).

Not safe: pasting round 4's Task A tables (key collision, §2); carrying "`#978` author closed as model issue" (false);
carrying round 4's Q1–Q6 tables as answers to this rig's questions — the file states its prompt was absent and "Q1–Q6
below is my reconstruction", and **no round-4 prompt exists in this repo** (ROADMAP 249). Round 4 stays untracked until
a seat integrates the admissible parts; the delegate is not a claimant.

## Appendix A — the commands this note rests on

```bash
# marker census + key collision (node one-liner over the three report files)
node -e '…'   # printed: r2 184/65/23 keys/14 defs/9 DANGLING · r4 72/64/16 · tokens r2 65 r4 64 shared 21 · shared lines 14
grep -n '^\[\^' docs/reviews/harness-tools-skills-public-harnesses-research.md          # the 14 definitions (lines 250–263)
sed -n '61p;77p;86p;198p;244p' docs/reviews/harness-tools-skills-public-harnesses-research.md
grep -on '\[\^5389e9#27\]\|\[\^d32e06#63\]\|\[\^d32e06#79\]' docs/reviews/harness-tools-skills-public-harnesses-research.md
curl -sS --max-time 20 https://api.github.com/repos/github/copilot-cli/issues/4438      # open, 19 reactions, 12 comments
curl -sS --max-time 20 https://api.github.com/repos/github/copilot-cli/issues/978       # OPEN, state_reason=reopened
curl -sS --max-time 20 https://api.github.com/repos/anthropics/claude-code/issues/57776 # closed, state_reason=duplicate
curl -sS --max-time 25 'https://api.github.com/repos/github/copilot-cli/issues/4438/comments?per_page=20'
grep -in 'memory bank' vendor/eval/cline/docs/customization/cline-rules.mdx             # 0 hits in 398 lines
curl -sS -L -o .spike/fetch-r4/<url>.html -w '%{http_code} %{size_download}' <url>; sha256sum .spike/fetch-r4/*.html
node tools/vendor-pins.mjs --check   # PIN CHECK PASS, 14 clones
```

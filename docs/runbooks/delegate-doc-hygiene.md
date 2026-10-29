# When your own doc edit does not land, or a pointer/citation check turns red on you

**Symptom:** you edited `docs/ROADMAP.md` / `docs/DECISIONS.md` / `docs/NEXT.md`, the edit tool said *successfully
replaced*, and the text is not in the file. **Or:** `node demo/next-pointer.test.mjs` fails on the line cap. **Or:**
`tools/review-cite-check.mjs` prints failing rows for files you did not touch. **Or:** you appended to a session note and
now believe you wrote shas that `git rev-parse` does not know. **Or:** a `cat >> file <<'EOF'` you ran executed part of
its own body as shell.

Do these in order. Every one of them happened on 2026-10-29 and cost time.

## 1. Never trust an edit's return value — re-verify the file

```bash
grep -c "the phrase you just wrote" docs/ROADMAP.md      # 0 = it did not land, whatever the tool said
stat -c '%y %s' docs/ROADMAP.md                          # mtime older than your last commit = the file was never touched
git status --short -- docs/ROADMAP.md                    # clean after an "edit" means the edit is a rumour
```

On 2026-10-29 a `docs/ROADMAP.md` addition reported `Successfully replaced 1 block(s)` and the file's mtime stayed at the
timestamp of the previous commit — the two items were simply not there, and the only reason I noticed is that I counted
afterwards. **Count after every write.**

## 2. `docs/DECISIONS.md` and `docs/ROADMAP.md` are append-only — append with a quoted heredoc

Both files are full of apostrophes, backticks, backslashes, em dashes, `$`, and quoted shell lines, so an exact-match
`edit` is likely to miss (and a whole-file rewrite of a 6,400-line file risks reflowing lines you never touched, which is
what the citation checker then reports as your findings). Append instead, then verify the count moved and the marker exists.

## 3. The nested-heredoc trap: an inner `EOF` terminates your outer heredoc

Writing this very file, I used `cat > docs/runbooks/… <<'EOF'` and the body contained an example that itself began with
`cat >> docs/DECISIONS.md <<'EOF'` and ended with a line reading exactly `EOF`. **That line closed my outer heredoc.**
Everything after it ran as shell: `bash: has: command not found`, `sed: unknown command: '<'`, and a 29-line truncated
file where a 60-line one should be. Nothing about the exit status said "your document was eaten".

Rules that avoid it:
- if the content contains a heredoc example, **write the file with the `write` tool** (no shell quoting at all), or pick an
  outer delimiter that cannot appear inside the body (`<<'RUNBOOK_EOF'`);
- never let a line in your body be a bare `EOF` / `PY` / any delimiter you also use as an outer one;
- after any heredoc, `wc -l` the file and `tail` it — a truncated write looks like success.

## 4. `docs/NEXT.md` has a 200-line cap, and the archive copy has an off-by-one you must prove

```bash
wc -l docs/NEXT.md          # the test counts split("\n") so a trailing newline counts: 199 by wc is the passing maximum
```

Failures seen, in order: 224 → FAIL; then the test's own message, "…is 201 lines; the cap is 200"; and then a file at 200 by
`wc -l` → **still FAILS**, because the trailing newline is counted as a line. So plan for **199**, not 200 — and re-run the
test after every trim, because the count is what gates the commit, not your reading of the cap. (Do not put a bare
"<N> lines" next to a path citation on the same line either: `review-cite-check.mjs` reads it as a size claim about that
file and logs a soft finding against you.)

To move the previous pointer into `docs/NEXT-ARCHIVE.md`: **copy the old text, do not retype it** — a retyped pointer
silently loses the commit shas it cites. Then prove the copy *and* the offset in one command:

```bash
diff <(git show <sha-NEXT-had-before>:docs/NEXT.md) <(sed -n '<start>,<end>p' docs/NEXT-ARCHIVE.md)   # silent = proof
node demo/next-pointer.test.mjs
```

My first proof was one line short at the end and still looked complete; the diff range must span the archived block's own
header line through the last copied line. Separately: three commit shas I wrote into a session note **from memory** did not
exist as objects. Check them: `git cat-file -e <sha>^{commit}` — the citation checker caught them before the operator read them.

## 5. Do not embed shell snippets inside a `python3` heredoc's string literals

Python string literals strip backslashes and terminate on embedded quotes, so a shell line in the string is corrupted in
place and the error surfaces as a Python syntax error far from the cause. For prose edits that contain shell lines, put the
replacement block in a temp file and splice by line number, or use the `write`/`edit` tools.

## 6. A red `review-cite-check.mjs` may be pre-existing — bound it before you act or report it

`tools/citation-registry.json` maps prose aliases to real paths, and **any path it does not match becomes a soft finding**
("unmatched prose path: `durig.config.json`" — 56 soft findings at one point, including bare filenames like
`selfdev.sqlite`). It also flagged `docs/ROADMAP.md:4905` (`src/audit-log.mjs`) and the `_NAMES` registry entries, both of
which pre-dated the session that found them.

```bash
node tools/review-cite-check.mjs "$(git show --stat --name-only --format= HEAD | grep -E '^(docs|src|scripts|tools)/' | tr '\n' '')"
```

That bounds the check to the files your commit touched. Report the scoped verdict **and** say in the same breath that the
tree-wide posture carries pre-existing findings. Do not quiet a registry-wide warning, and do not claim tree-wide
`0 failing` when it is not — **245** already requires this class resolved or scoped, so name the scope in the message.

## 7. After any model change, the guard is a test, not `check`

```bash
node demo/local-model-pointer.test.mjs     # rig file seat strings vs the machine config's registered provider models
node demo/second-local-provider.test.mjs
```

`cli.mjs check` and `tools/single-model-rig.mjs` both **passed** while five seats pointed at `verifier/recursivesi/flint`
and no loaded instance served it (**261**). The pointer test is the one that fails — run it before you tell the operator the
rig is pointed at the new model.

# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-31T20:5xZ (**D186**), host-local 2026-10-31 16:0x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D186).
Updated **in place** — the cut is named below.

## NEXT SESSION

**Archive cut:** the superseded 199-line D185 pointer is in `docs/NEXT-ARCHIVE.md` **verbatim** — marker **9793**,
body **9795–9993** — re-runnable proof: `sed -n '9795,9993p' docs/NEXT-ARCHIVE.md | diff - <(git show
7844fcff:docs/NEXT.md)` prints nothing (exit 0).

**Current item: `item-4931` (the compaction re-cut) carries the operator's RE-CUT + LANDING grant and CANNOT MOVE —
its author seat `impl` is in the zero-token refusal class, so the next act is an operator context decision, not a git
act.** The build is still 2 ahead / 15+ behind: branch tip `8fa8f3a2`, `merge-base --is-ancestor main item-4931` exit
**1**, worktree clean, `merge-tree` clean. The re-cut ask I sent `impl` was **refused** (see Blocker) and **must not be
re-sent** — a refused send deposits a `user` entry. The build-ready row the operator's ruling produced is **#4966**
(`lead→impl`, feature: re-cut `wip/seat-prompt-files` @`04e3ba6b` onto current `main`, fix the 2 demos the WIP breaks +
add the resolver demo). Also parked on `impl`: **#4955** (`claimed`), **#4937**/**#4964** (`held`), **#4968**
(`queued`). `main` was **`9ee578b1`** when this pointer was written (the approved seat root was fast-forwarded to it after the
landing); the D186 docs-only record commits sit on top of that, so **re-derive with `git rev-parse --short main`**
before comparing anything — and fast-forward the root again after any commit. **61 commits ahead of `origin/main` —
nothing pushed, no push grant.**

**Blocker:** **the three seats that can route or build work are all in the refusal class.** The do-not-send gate is
NOT `AT RISK` — it is the **counted projection's LAST entry**: `user` ⇒ the provider call is refused before the window,
`model_error`, empty reply, **zero tokens** (`consumed` does not move) **and one more `user` is appended**. Measured at
clock-out: ends on `user` = `pm` 15, `impl` 6, `lead` 28, `advocate` 1, `designer` 1, `architect` 1 (exactly the seats
carrying `last_run_failed: model_error`); ends on `assistant` = `qa` 4, `scribe` 11, `devtools` 7, `auditor` 11,
`security` 5, `qa2` 4 (all of which completed rows while ALSO flagged `AT RISK`). `lead`'s turn was productive BEFORE
it died — it minted #4966–#4969 and completed #4962, then settled `model_error` at `185,156` with `cacheRead 0 /
input 183,366`. Fix = a context boundary on `pm`/`lead`/`impl` (a fresh head marker restarts the replay window), which
**needs a grant**; nothing was fired.

**Next commands (delegate, Linux; block 1 is the actual next act):**

```bash
# 1. THE ONLY GATE THAT MATTERS, 0.4 s — read it BEFORE composing any brief:
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node tools/seat-turn-shape.mjs \
  | grep -E '^seat |counted projection'    # last comma-separated element per seat; `user` ⇒ DO NOT SEND
# 2. the rest of the clock-in read (all read-only, priced in docs/runbooks/session-start-cost.md):
pgrep -af "node cli.mjs send" | grep -v "bash -c" || echo "no wake running"   # NEVER bare pgrep -f "cli.mjs send"
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs queue --json > .spike/fix-20261103/q.json  # 0.84 s, 21.8 MB
node .spike/fix-20261101/rows.mjs 4966 4967 4968 4969 4931 4955 4937 4964 4962 4893 < .spike/fix-20261103/q.json
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs status --json | head -c 4000
DURIG_NO_SERVE=1 DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run   # read wouldRefresh[].changes.cwd; prints no removals
curl -s -m 15 http://127.0.0.1:47831/v1/models | head -c 300   # the local seat provider; the verifier model on GPU0 is DOWN (47 MiB)
# 3. licensed free previews of the repair (write NOTHING):
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs reset impl --dry-run    # {"wouldReset":true,"writes":0}
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node scripts/compact-eval.mjs item --seat impl --limit 400 --out .spike/fix-20261103/compact-impl-dry.txt
# 4. when (and only when) a re-cut lands on main, the landing sequence the operator already granted:
git merge-tree --write-tree main item-4931 && node scripts/land.mjs item-4931 --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite
git merge-base --is-ancestor item-4931 main && node scripts/suite.mjs --jobs 8; echo "exit=$?"   # 48 s in a deps-complete tree
git -C /home/chexxor/Git/durian-dev/seatroot merge --ff-only main    # LAND FIRST, then re-point the root, then wake
# 5. THEN the withheld -D becomes safe (its condition is #4931 landing, which has NOT happened):
git merge-base --is-ancestor item-4898 main && git branch -D item-4898   # patch-id 258dccc5 = c97e1f11 INSIDE item-4931
```

**ASK THE OPERATOR — one decision, and it is the critical path.** `pm`, `lead` and `impl` are all un-sendable
(projection ends on `user`; `pm` 0.9225, `lead` 0.9258, `impl` 0.9184). Grant options, all measured: **(A)** fire
`compact` on those three seats = 3 summarizer calls (no `--dry-run` exists for `compact`; the licensed offline read is
`scripts/compact-eval.mjs item --seat <name> --limit 400`, which ALWAYS copies the store to temp and spends nothing —
re-measured at clock-out on this store: **`impl` 400 records ≈ 296,807 est tokens, expectations from the dropped zone
= 1 needle + 3 path-shaped lines, cost 1 summarizer call + ~10 probe replies ≈ 890,421 est tokens**; **`pm` 400 records
≈ 196,301 est tokens, the same 1 needle + 3 paths, ≈ 588,903 est tokens**); **(B)** `reset` them = loses
durable context and `impl` holds 13 parked items + claimed #4955 — I ran the free preview, `wouldReset: true`;
**(C)** do nothing to context and re-route the build to a sendable seat — **not possible today**, because both routing
seats (`pm`, `lead`) are themselves un-sendable. Inference, not proof: a fresh head marker restarts the replay window
so the next `user` lands in slot 0 (`qa` carries `pi.compaction@275457` and reads ADMISSIBLE). Re-arm was already
attempted under the operator's answer: `cli.mjs resume` → `{"found":0,"actions":[]}` exit 0.

**Grants in force:** **15** standing (no further verifier capacity — and the verifier model is now unloaded: GPU0 47
MiB of 16,376) · **16** used (217 merge) · **18** used, now four landings: `abca484d`, `d0a5b7ad`, `a629973e`,
**`9ee578b1`** (`item-4958`) · **19** used (local-AI verify legs + the `compact-eval` DRY RUN; **firing a compaction or
the eval still needs a separate grant**) · **this session's operator answers:** land #4958 (USED), re-cut+land #4931
(GRANTED, UNUSED — blocked above), `-D` × 3 (**two used**: `item-4957`, `item-4904`; **`item-4898` withheld — its
condition is #4931 landing**), delete the 5 `refs/rescued` **blob** refs (USED), `wip/seat-prompt-files` → land **as a
row** (USED → #4966), `impl` → **re-arm** (USED: `resume` found 0, nothing was stranded) · **no push grant.**

## Rig state, re-measured at clock-out 2026-10-31T20:5xZ (Linux) — re-read, do not trust

**Store** `/home/chexxor/Git/Durian-Pi/selfdev.sqlite` (446,296,064 B). Rows 4,969:
`{"done":3777,"cancelled":792,"held":324,"queued":57,"deferred":17,"claimed":2}` (census is noise; the named rows are
evidence). **`git worktree list` 7 / `git branch --list` 8** (was 10/11): two checkouts (`Durian-Pi` on `main`,
`durian-dev/seatroot` on `seatroot/linux` = `9ee578b1` = `main`) + 5 item trees (`item-4937` locked `held`;
`item-4898` clean and deliberately kept; `item-4930` locked `cancelled` — only `devtools` unlocks; `item-4931` clean
2-ahead; `item-4955` locked `claimed`). `worktree prune --dry-run --verbose` prints nothing. Removed this session by
name: `item-4958` (`-d`, ancestor exit 0 after landing), `item-4957` (`-D`, tip **identical** to `item-4931`'s →
zero objects removed), `item-4904` (`-D`, patch-id `279e0d9861b4…` = landed `8a950542`, `--is-ancestor` exit 0).
**`refs/rescued` = 485 refs, all commits, 0 blob refs** (5 deleted after re-deriving byte-identity; pack **unchanged
at 17.58 MiB** — deleting them freed nothing). **No `gc`; read `cross-clone-object-recovery.md` before any `gc`.**
**Landing proof pair for `item-4958`:** `merge-tree` exit 0 before; `--is-ancestor` exit 0 after; `%p` =
`7844fcff 5e2273ee`; +82/−5 over 2 doc files. **Full gate after the landing:** `node scripts/suite.mjs --jobs 8` in
the shared tree (which IS `main`, clean, deps = this checkout + `vendor/pi-main`) = **`pass=239 fail=1
environmental=0`, demos=240, exit 1, 47.8 s**. The one red is `demo/deepinfra-catalog.test.mjs` — **PROVEN
pre-existing** (its two input paths were last touched by `9882632a` and `ecdeb70f`, both ancestors of the
*pre*-landing `7844fcff`; my merge touched only 2 doc paths) and it already has row **#4893** (`held`, pm→devtools).
**Provider:** local `iq3_s` answering on `:47831` (GPU1 **23,553/24,576 MiB**, `Qwen3.8-Flash-Next IQ3_S`); one
8-token completion succeeded. **GPU0 = 47 MiB — the verifier slots are NOT loaded** (`auditor`/`qa`/`qa2` verifier
grammar cannot run until someone loads them; `auditor` attention carries a predict 500). **Host:** 94 GiB, 65 used,
28 avail. **Attention:** `last_run_failed: model_error` on `pm`, `impl`, `lead`, `auditor`; `idle_with_queued_work` on
`qa`, `scribe`, `devtools`, `security`, `qa2`, `architect`; queue-ageing 2402.9 min; step-repetition 1%.
**Rows this session minted by the TEAM (verified in the store, not from prose):** **#4966** lead→impl (operator's
persona-files ruling), **#4967** lead→scribe (**the shape discriminator correction** — fixes
`docs/runbooks/verifier-serving-headroom.md` and this file's do-not-fix line), **#4968** lead→impl (217's push-refusal
never asserted through the `bash` name), **#4969** lead→scribe (one-path-per-`node --check` + the 40-hex redaction
rule), and **#4962** completed by `lead` (F1→#4938, F2→#4966 + re-scoped #4906 gated behind it, F3→#4923, F4→#4968,
F5→#4969, F6→#2055/#2056). Rows still parked on `pm` (unreachable): #4826, #4897, #4900.

## Do not "fix" these on the strength of the docs

**SUPERSEDED LINE (D185, kept here so nobody re-derives it wrong): "`AT RISK` is a strict-template warning, NOT a
do-not-send gate."** True only of seats whose counted projection **ends on `assistant`**. For a seat whose projection
**ends on `user`** the send IS refused, at zero tokens, and it poisons the window further. Row **#4967** owns the
runbook fix; `docs/SELFDEV.md` D186 block and `docs/runbooks/session-start-cost.md` step 2b carry the corrected read.
**Never re-send a refused brief** — that is the deposit, not a retry.
**`cli.mjs send` prints `send is DEPRECATED … prefer node intent.mjs <seat> --body-file <file>`** on every call, but
`intent.mjs` needs a **resident broker**; with `status.broker.state: "down"` (all session) `send` is the only delivery
path. No entry point states which case you are in — carried to `lead`, not yet registered.
**A landing moves `main` and un-satisfies your own "root must equal `main`" STOP clause** — land, then
`merge --ff-only` the root, then wake. **`cli.mjs compact` has NO `--dry-run`** and writes a boundary; `reset` HAS one;
the licensed offline compaction read is `scripts/compact-eval.mjs item --seat <name>` without `--yes`.
**`status.context.consumed` is the LAST model call's prompt accounting** and does not move at all on a refused send —
that is how you tell zero-token refusal from truncation. `advocate` 244,751 = 9.9589 and `architect` 218,645 = 1.0932
are window-length artifacts (their windows are 1 message).
**Every 40-hex value inside a SEAT's transcript is redacted as `secret-shaped value`** — ask for **halves plus the
command that prints them** and re-derive the whole yourself with `git patch-id --stable`.
**`node --check` proves only the FIRST path.** **The store opener CREATES a file on READ** (row #4955); pin
`DURIG_DB` to an absolute path. **`up … --refresh --dry-run` previews model/cwd writes and NEVER removals.**
**`scripts/land.mjs` refuses on one untracked `item-*`/`verify*` dir at the repo root** (the #4139 gate reads the
directory list, and my `.spike/` is fine because it does not match the name pattern). **`git worktree remove` refuses
a dirty tree; `branch -d` never `-D` unless a grant is named and its CONDITION re-derived.** **Never read an exit code
through a pipe** (a `diff` exit 1 under `set -e` truncates your own script mid-report). **A backgrounded command that
starts `cd <worktree>` writes its scratch INTO that worktree, and `git worktree remove` deletes it with the tree** —
that is how this session's `compact-eval` reports vanished; re-ran both legs in the shared tree to quote them.
**`compact-eval` without `--yes` writes NO report file at the `--out` path** — it prints the summary to stdout and
copies the store to `/tmp/compact-eval-item-*/`; capture stdout. **`> /dev/null` is refused by
the confine guard**; **take BARE-NAME inventories around every writing verb**; **`better-sqlite3` is absent — use
`node:sqlite`**; **inline briefs, no backticks — use `--body-file`**; **a fresh worktree has ~80 packages and no
`vendor/pi-main` — name the artifact set with every exit code.**

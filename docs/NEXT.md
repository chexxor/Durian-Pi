# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-31T08:5xZ (**D183**), host-local 2026-10-31 03:5x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D183).
Updated **in place** — see the archive cut named inside NEXT SESSION below.

## NEXT SESSION

**Archive cut:** the superseded 172-line D182 pointer is in `docs/NEXT-ARCHIVE.md` **verbatim** — marker line **9455**,
body **9457–9628** — and the proof is re-runnable:
`sed -n '9457,9628p' docs/NEXT-ARCHIVE.md | diff - <(git show 31d10565:docs/NEXT.md)` prints nothing.

**Current item: two DONE, delegate-verified branches are stacked and UNLANDED, waiting on a landing grant — `item-4935` @
`44fe9438` (the one-line areas-manifest fix) and `item-4936` @ `24a479c8` (`scripts/land.mjs --changed-suite`). Read the
LANDING CAVEAT below before granting: landing `44fe9438` clears the manifest RED and newly exposes a pre-existing RED
demo. `main` = a **DOCS-ONLY commit by the delegate** (`git log --oneline -1` at clock-out reads
`docs(selfdev, D183, NEXT): worktree placement follows…`) on top of `31d10565`, which is where 217 landed and where
every code assertion in this pointer was measured; the seat root is still `31d10565`; **43** ahead of `origin/main`, and
**nothing was pushed and nothing was landed by the delegate.** Row state at clock-out: #4933/#4935/#4936 `done`; #4944/#4945/#4946 (impl's notices) `done`; **#4947, #4948
`queued` impl, #4949 `queued` devtools, #4950 `held` impl (`blockedBy` #4947)**; #4937 `claimed` impl; #4931 `queued`
(untouched on instruction); #4934 `held` auditor.**

**What the team did, at the row level (verified by me from `queue --json`, never from prose).** `lead` cancelled the
stranded #4930 (it is the sender; it also may not park another seat's row) and minted the batch; `impl` ran a 70-minute
turn producing #4933 (execution proof, labelled non-independent), #4935 (manifest line) and #4936 (the `--changed-suite`
build), then **settled with a reply whose only part was `thinking` and whose text length was 0** — the work is legible only
in the rows and their notices. On my second brief `lead` routed the two instrument classes I measured: **#4947** (detect
and name, half 1) → **#4950** (place under the resolved root, half 2, held); **#4948** (a demo that goes RED once mapped,
caused by its own #4935 landing); **#4949** (probe is single-sample — new row, deliberately NOT folded into #4938). It
closed #4944/#4945/#4946 and **revised its own #4923 with an explicit retraction** (`selfdev.sqlite` presence is
contradicted across trees: 118 KB in `item-4933`, none in `item-4936`).

**Delegate-run verification (label it: NOT an independent seat check).** On `main` @ `31d10565`: `node --check` ×3
(`src/seatguard.mjs`, `src/seattools.mjs`, `src/shellregistry.mjs`) → 0; `demo/seatguard.test.mjs` → 0 `PASS — the guard
holds`; `demo/seattools.test.mjs` → 0 `PASS — the controls are wired`. In `item-4936` (thin: 80 packages, no
`vendor/pi-main`): `node demo/land-changed-suite.test.mjs` → 0 `CHANGED-SUITE SCOPE PASS … 240 tests / 9 areas`;
`node demo/test-areas.test.mjs` → 0. In `item-4935` (thin): `node demo/test-areas.test.mjs` → 0. On `main`,
`node demo/test-areas.test.mjs` → **1**: `manifest does not cover the suite: "demo/seat-turn-shape.test.mjs" is on disk but
not mapped to any area`.

**LANDING CAVEAT — measured by me on BOTH trees, and it changes what "clears the RED" means.**
`node demo/seat-turn-shape.test.mjs` exits **1** on `main` in the deps-linked seat root (187 packages, `vendor/pi-main`
present) **and** in `item-4935` (80 packages, no vendor): `Error: no seat named null` at `tools/seat-turn-shape.mjs:166`
(via `src/readclient.mjs:68`). So that demo is **already broken on main and nobody runs it because it is unmapped**.
Landing `44fe9438` fixes the manifest-coverage RED and **immediately makes the mapped demo part of the suite** — which is
why `lead` gated its own disposition on this exact run and put the fix in **#4948**. Cheapest gate: `#4948` first, or land
`44fe9438` knowing the sweep goes RED on a different demo.

**THE NEW CLASS, and it re-tripped within 80 minutes (D183).** All 12 seats' persisted cwd was the approved root, the
roster-wide root guard passed, and `prepare_workspace` still forked `item-4933`, `item-4935`, `item-4936`, `item-4937`
**inside the operator's checkout** (`src/seattools.mjs:35-37` passes `worktreeRoot: source`; `src/worktree.mjs:877` says
so: "the broker's process cwd"). Consequence measured the same session: a second `send` to `lead` was **REFUSED** because
`impl` was parked in `/home/chexxor/Git/Durian-Pi/item-4937` — the placement defect re-arms the D180 guard for the whole
rig. Repairs, run twice, both clean: `up rig.selfdev.json --refresh` under the root (the `--dry-run` named exactly the
drifted cwds; the **bare-name** inventory diffed by zero lines across the write verb), and **run `send` with `cwd` = the
approved seat root** — that is why `item-4898/4904/4916/4930` live under `durian-dev/seatroot` and tonight's four do not.

**Blocker:** the independent verify of landed 217 cannot run — the verifier slot is `8192 × 4` and refuses a real review
(9,128 tokens → HTTP 400), so **#4934 is `held` and 217 stays "landed, independently unverified"**; `pm` is unreachable at
0.9225 with three rows parked on it (#4826, #4897, #4900); `advocate` (9.9589) and `architect` (1.0932) are over their
windows and `status.attention` does not flag them; and any seat parked in an item worktree makes EVERY write-side verb
refuse until `up … --refresh` re-points the roster.

**Worktree dispositions (9 `item-*` trees; 11 `git worktree list` entries counting the two checkouts): `lead` recommends, the OPERATOR grants, the delegate carries.** Remove by name
now → `item-4902` (clean, no commits), `item-4933` (proof only). Land-then-remove → **`item-4935` @ `44fe9438` first**, then
`item-4936` @ `24a479c8` (it sits ON TOP of 4935; `lead` says one-arg `git rebase main` to drop the duplicate by patch-id).
Hold → `item-4937` (LOCKED, clean at `31d10565`, zero commits, holds open #4937), `item-4898` (LOCKED, unlanded compaction
`9beb1ae3` — patch-id reference for #4931), `item-4930` (LOCKED over a cancelled row — only `devtools` releases it),
`item-4916` (content-check vs `main` first). **Never the sweep, never bulk; the delegate removes nothing without a named
operator grant.**

**Next commands (delegate, Linux; block 1 is the actual next act):**

```bash
# 1. row truth (the census lies; rows do not) + the pointer trio, all read-only
pgrep -af "cli.mjs send" | grep -v pgrep || echo "no wake running (expected: settled)"
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs queue --json > .spike/fix-20261102/q.json
node .spike/fix-20261101/rows.mjs 4947 4948 4950 4949 4937 4931 4934 4938 4939 4940 < .spike/fix-20261102/q.json
node .spike/fix-20261101/read-cwd4.mjs                     # seats' persisted cwd — the ONLY honest drift read
node .spike/fix-20261101b/turncost.mjs                     # real per-seat turn cost, from the store
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs   # AT RISK ⇒ do NOT send (each failure deposits a row)
ps -eo args | tr '\0' ' ' | grep -o -- "--ctx-size [0-9]*"  # 8192 ⇒ verifier-family seats are dead
git -C /home/chexxor/Git/durian-dev/seatroot rev-parse --short HEAD   # 31d10565 at clock-out; `git log --oneline -1` on main = the delegate's docs-only D183 commit
# 2. #4937: re-point FIRST (impl was parked in the nested tree — that refusal is what cost lead a send), then send FROM the root.
#    lead's ruling: do NOT release #4937 (releasing detaches a claim from its LOCKED worktree = the item-4930 deadlock);
#    tell impl `claim_work(itemId=4937)` explicitly and, if it cannot finish, `hold_work(4937, reason)` — not a `done` with zero tools.
DURIG_NO_SERVE=1 DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_DB=<abs>/selfdev.sqlite \
  node cli.mjs up rig.selfdev.json --refresh --dry-run     # must name the drifted cwds; then run without --dry-run
cd /home/chexxor/Git/durian-dev/seatroot && DURIG_SEAT_ROOT=$PWD DURIG_DB=<abs>/selfdev.sqlite \
  node cli.mjs send impl --body-file <brief> --request-id <id> --json   # cwd = the seat root, or prepare_workspace forks in the operator's tree
# 3. clock-out trio, always all three
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs && node tools/instrument-provenance.mjs
git for-each-ref refs/rescued | wc -l       # 490 at clock-out; read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**ASK THE OPERATOR — three; the delegate picks none, and #4937's re-send is NOT one of them.** (1) **Land the stack or
not**, given the LANDING CAVEAT above: `44fe9438` then `24a479c8`, or #4948 first. Grant 16 was scoped to 217 and is spent.
(2) **Fund a verifier slot, at which size** — this session priced it: the current `8192 × 4` refuses every real review
(`qa` turn inputs p25 7,121 / p50 9,734; `auditor` p25 5,314 / p50 16,518; maxes 31,601 / 23,419 / 24,037), and
`lms … --estimate-only` prices **16384×1 at 13.43 GiB** (measured 13,914 MiB) and **24576×1 at 14.39 GiB** (measured
15,202 MiB) against a 16,376-MiB GPU0. **#4934 — the independent verify of 217 — is the row that waits on this**, so 217
remains "landed, independently unverified". (3) **Whether the compaction set lands at all** — #4931 is workable and
untouched until you say so. Standing ask unchanged: `pm` at 0.9225 and unreachable, `reset` (#4886) is the only repair, and
a cancel now costs a notice row each time.

**Grants in force.** **15** = no further verifier capacity (declined; standing). **16** = merge of 217 (used). **17 =
NOT granted tonight: no landing, no push, no GPU spend** — `main` is 43 ahead of `origin/main` and the delegate pushed
nothing.

## Rig state, re-measured at clock-out 2026-10-31T08:5xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (444,051,456 B ≈ 423 MiB); this session's pre-write backup is
`.spike/fix-20261101b/store-backup-pre-lead-020622.sqlite`. **`git worktree list` 11** (the two
checkouts + 9 `item-*` trees), **`git branch --list` 12**, `refs/rescued` **490**. **Provider:** local `iq3_s` healthy at
`:47831` (`--max-context 204800`, GPU1 23,237/24,576; `broker-serve` idle probe `local: completes … finish=stop`); verifier
`ministral-3-14b-reasoning` loaded at **8192 × 4** on GPU0 (12,618/16,376) — direct probes: 6,128 tok OK, 9,128 tok HTTP
400, 8.45 s for 64 tok (63 of them reasoning). `lms` is
reachable only as `HOME=~/.var/app/ai.lmstudio.lm-studio ~/.var/app/ai.lmstudio.lm-studio/.lmstudio/bin/lms` (flatpak).
**The rig's own denominator is wrong for verifier-family seats:** `status.context` declares the window for `qa`, `qa2` and
`auditor` as **24,576** while the loaded slot is **8192** — so `qa` reads a comfortable 0.8183 and its next real turn still
HTTP-400s.
**Context (consumed / declared window):** pm 184,507 = 0.9225 unreachable, lead 147,280 = 0.7364, impl 87,087 = **0.4354**
(post-compaction, down from 0.6143 earlier this session), devtools 53,113 = 0.2656, scribe 33,517 = 0.1676, security
27,347 = 0.1367, qa 20,110 = 0.8183, qa2 20,192 = 0.8216, auditor/designer 0 = 0.0, **advocate 244,751 = 9.9589**,
**architect 218,645 = 1.0932** — `status.attention` still flags none of the over-1 seats. **Shape (fresh at clock-out):**
ADMISSIBLE impl, qa, qa2; AT RISK pm, lead, advocate, scribe, devtools, auditor, designer, security, architect (10 findings
across 12 seats, 6 with a counted-projection parity break). **Queue census at 08:49Z (NOT evidence):** 3,771 done / 790
cancelled / 323 held / 47 queued / 17 deferred / 2 claimed. **Host:** 94 GiB total, 61 used, 32 available. **Clock-out
tests:** `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs` both exit 0.

## OPERATOR GRANTS (see the archive for 1–14)

15 no further verifier capacity. 16 merge of 217 (used). **17 (D183) nothing new granted**: no landing, no push, no GPU
spend. Grant 11's tree-shape licence was used only for `up … --refresh` root re-pointing, with bare-name inventories.

## Do not "fix" these on the strength of the docs

**`channel-preflight` §7 and `broker-serve`'s `seat-shell-availability` BLOCK are stale on a landed-217 tree** — both read
`registered shell tool name: "bash"`, then probe the vendored `[pwsh, powershell]` list (#4938). **A `broker-serve --status`
provider BLOCK is one sample with a 20 s budget**: it blocked `local` at 07:11Z during a live seat turn (the engine serves
one request at a time) and `verifier` at 08:36Z idle, when a direct probe answered in 8.45 s — 85 minutes apart, a
different provider each time, both false (#4949). **`demo/seat-turn-shape.test.mjs` is RED on every tree** (`no seat named
null`, `tools/seat-turn-shape.mjs:166`) and only passes unseen because it is unmapped on `main` (#4948). **The roster-wide
`DURIG_SEAT_ROOT` guard refuses EVERY write verb when any seat is parked in an item worktree** — repair with `up …
--refresh` under the root, never by unsetting it (D180). **`prepare_workspace` places beside the SERVING PROCESS's tree,
not the seat root** — so `cd` to the approved root before `send` (#4947/#4950). **`up … --refresh --dry-run` is NOT
vacuous when the rig file names no `cwd`** (D178's `changes: {}` was a property of a rig file that named one) — and it
still names no *removals*, so it is never a safety check. **A `done` settle can have an empty reply** (parts = [`thinking`],
text length 0) — read the rows. **A cancel emits a notice row** (four cancels → #4932/#4941/#4942/#4943, one addressed to
UNREACHABLE `architect`); a cleanup pass does not converge, it deposits. **Never complete or release another seat's
`claimed` row**; **a sender may release its own row but may not park it**; **`claim_work` takes oldest-workable — name the
id** (that is how #4931 nearly ran). **Never read an exit code through a pipe**; **`> /dev/null` is refused by the confine
guard**; **an `.spike`/worktree count is a function of cwd — take BARE-NAME inventories and `pwd` them**; **pin `DURIG_DB`
with an absolute path when the cwd is the seat root** (and note `better-sqlite3` is NOT installed in either tree — use
`node:sqlite` for ad-hoc probes); **inline briefs, no backticks**; **`land.mjs` runs no gate without
`--suite`/`--changed-suite` and says `suite: not run`**; **AT RISK ⇒ do not send**; **never re-send a failed brief**;
**a fresh worktree has 80 packages and no `vendor/pi-main` — name the artifact set with every exit code** (#4939); **LM
Studio restores `8192×4` on relaunch**.

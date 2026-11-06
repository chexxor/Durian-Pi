# NEXT.md — current state and next actions

**Last update:** 2026-11-07T02:5xZ (delegate session **M** closes — the operator asked for competitor research on how
agent teams carry credentials and secrets **before** ruling ROADMAP **333**, with the hypothesis that "the best
architecture would be a separate process or service that holds secrets", and named **oh-my-pi** mid-session. The sweep
landed: **ten pinned clones read** plus two vendor docs labelled `advertised-elsewhere`; **D225** records what it binds;
rows **334–343** are registered in `docs/ROADMAP.md`; pitfalls **55–59** added. The operator's session-G push grant was
**spent** this session: `git push origin main` → **`4c3fd7cc..4620cecf`**, and `git rev-list --count
refs/remotes/origin/main..main` → **0** afterwards. The session-**L** pointer is VERBATIM in `docs/NEXT-ARCHIVE.md`
(heading at line 12409; the appended body is byte-identical to the file it replaced — `diff` of 149/149 lines →
`ARCHIVE-APPEND-VERBATIM-OK`.)

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Current item — three halves, and only one of them needs the operator.**

**(0) THE CREDENTIAL QUESTION IS RESEARCHED, NOT ANSWERED — 333 is still the operator's fork, and it gates one row
(342) but nothing else.** Read `docs/reviews/credential-architecture-options-2026-11-07.md` (§2 the option table,
§3 the recommendation, §4 what only the operator can do). The delegate's recommendation, one line: **answer 333 as (a)
env-only + pay the visibility tax, fund 336/337/341 now (all $0), fund 334/338 as 332-S3, then pilot 342; do not adopt a
network secrets service before 342 is measured.** The evidence that reframes the whole question, measured in this tree:
`src/confine.mjs` strips credential-named env from a seat's shell (`node --test demo/confine.test.mjs` → **pass 1, fail
0, 352 ms**), **but** a seat-shaped child shell printed **92 env names from `/proc/<pid>/environ`, including
`DURIG_VERIFIER_API_KEY` and `DURIG_LOCAL_API_KEY`**, and `refusalFor("cat /proc/$PPID/environ", {root, cwd})` returned
**no refusal** (probe, ~6 s, canary values, names only: `.spike/delegate-20261107/envprobe/procfs-canary.mjs` — gitignored,
so **promote it** per 312 or it is lost). So the current control is "a seat does not think to ask". The mechanism that
makes option (b) dangerous is pi's precedence, not an opinion: `vendor/pi-main/packages/ai/src/auth/resolve.ts:28-35` —
*"A stored credential owns the provider: ambient/env is consulted only when nothing is stored."* A stored plane would
**ignore**, not override, `DURIG_*`, voiding the ledger's `authKeyEnv` attribution and D48/D119.

**(1) STILL THE FREE PRIORITY, UNCHANGED FROM SESSION L: ROADMAP 331 (slice 1 of 332's S1 settings seam).** The fix and
its gate are written out in the archived session-L pointer (`docs/NEXT-ARCHIVE.md`, heading line 12409): `src/config.mjs:432
compactionSettings()` emits `modelOverrides` as a **sibling** (`:488`) of `compaction` (`:455`) while pi-durable reads it
only from **inside** `settings.compaction`, so every family resolves pi-durable's defaults `16384 / 20000 / 32768` and the
verifier family (window 24,576) compacts at `24576 − 16384 = 8192` while keeping 20,000 recent. Baseline probe:
`node .spike/delegate-20261106c/compaction-policy-probe.mjs` (free, no model). Gate: a test that calls pi-durable's
`compactionPolicy()` and asserts the configured numbers come back **per family** — `demo/config.test.mjs` passes with the
bug in place, so it is not the gate; `node tools/what-to-test.mjs --paths=src/config.mjs,cli.mjs` derives **73 direct
guards**. **Do not** set harness-wide `DURIG_COMPACTION_RESERVE_TOKENS` before the nesting fix. Carriers: `lead` has not
minted them; the briefs are **spooled undelivered** as `delegate-20261106c-lead11 / -lead11b / -lead12 / -lead13` (measured:
**5 pending intents**, oldest waiting **236 min**).

**(2) THE PASS HALF IS STILL STOPPED, and the stop is routing, not capacity** (unchanged ruling, D224 R5): **do not start a
third pass until `lead`/`pm` say how `#5273` (the 311 carrier, `impl`) gets claimed** — it sat `queued` through two full
passes while `claimed` rose 14 → 17. Worktrees **41** at session-L close (`seat-root 8, reapable 21, live 9, locked 2,
dirty 1`) — the leak 311 exists to stop. Broker at this close: **down** ("no broker state"), `selfdev.sqlite.broker.json`
absent, **6 dead letters** in `selfdev.sqlite.broker.inbox.error` (same 6 as session L — no new ones), verifier provider
**answers, 174 models including `openai/gpt-oss-120b`**, local provider configured but not probed in that run. Family
spend **$0.34959 of the $0.50 trigger (69.9 %)**, headroom **$0.15041**; this session spent **$0.00123** (3 preflight
provider probes) — every credential canary was local and free.

**(3) NEW THIS SESSION, for `lead` to decompose (rows, not orders — routing is the team's):** **336** (the
`looksLikeSecret` floor — measured `abc123def456` → `false`, 32-char alnum → `false`), **337** (refuse `/proc/*/environ` +
a `check` finding + a `Warn/Deny/Error` presence policy), **341** (refuse before any credential lookup; consumer config must
not redirect broker traffic; no silent fallback), **334** (implement pi's `CredentialStore` seam with real-vs-redacted as
**two types**), **338** (command-resolved TTL credential + an `auth check` probe; carrier `#5277` already queued for the
prototype), **335** (a seat asks the operator for a missing secret instead of dying), **339** (keychain-first, stdin not
argv). Free trio first: **336 → 337 → 341 ≈ half a day each, $0, gates are the existing canaries.** **340** and **342** await
the operator (a new local listener / a new moving part). Smaller items for the same pass: **343** (`vendor-pins
--freshness` prints the drift direction inverted — ~1 h, `devtools`, gate is a fixture test on a clone with no local tags)
and the **312**-pattern promotion of the two probes named in Blocker 5.

**Next command** (host signature measured with it — Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0):

```bash
cd ~/Git/Durian-Pi
git status --short -- .                                   # at this close: 5 modified docs + 3 new credential docs (MINE) + 1 foreign untracked doc (see Blocker 6) + selfdev.sqlite.spend.jsonl (310)
node .spike/delegate-20261107/envprobe/procfs-canary.mjs   # 337 baseline: does a seat-shaped child shell still read the broker's environ? ~6 s, names only, canary values
node --test demo/confine.test.mjs                          # the spawn-path canary: 0 credential names cross the child env. pass 1 / fail 0 / 352 ms
node .spike/delegate-20261106/verifier-spend-tripwire.mjs  # family spend vs the $0.50 trigger (free) — $0.34959 at this close
node .spike/delegate-20261106c/compaction-policy-probe.mjs # 331 baseline — free, calls pi-durable's own compactionPolicy
node tools/vendor-pins.mjs --check                         # PIN CHECK PASS, 27 clones, incl. the review-audit clause (a review naming a present clone cites its HEAD + has a COMPETITORS entry)
node tools/broker-serve.mjs --status                       # down? spool depth? provider reachability? — reads files, not the store, so it answers with the broker down. NOTE 295 is LANDED here: the preflight prints provider id/baseUrl/model/ctx/out, NOT values — do not re-report it as a leak
ls selfdev.sqlite.broker.inbox.error | wc -l               # 6 at this close (no new dead letters)
git worktree list | wc -l                                  # 311 leak meter: 41 at session-L close
DURIG_DB=./selfdev.sqlite node cli.mjs status --json > .spike/status-m.json   # only with the broker DOWN (329: a wedged broker makes this print nothing for 120 s)
node scripts/test.mjs --area docs && node scripts/test.mjs --area check && node scripts/test.mjs --area guard
# the pass, only when lead says #5273 is claimed:
# node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 600
```

**Push state (2026-11-07, session N):** the operator granted push ("Granted to push"); executed
`git push origin main` → **`4620cecf..d1583c38`** (the five research commits `7eaaf131`, `474f94f5`, `f5be46ca`,
`e4c6f31d`, `d1583c38`), `refs/remotes/origin/main..main` → **0** at that moment. The milestone-intake work committed after
that was pushed under the **same** grant; `docs/DECISIONS.md` **D226** ruling 6 states the batch boundary and asks the
operator to say if they want a fresh grant per group. The check is `git rev-list --count refs/remotes/origin/main..main`
(expect `0`; if not, ask — the grant is per batch, D218).

**Blocker:**
1. **311 still gates every further pass** — cleanup refuses with the unreadable `undefined/anthropic-ai-sdk…` string
   (`src/worktree.mjs:1237` reads `dirent.path`, undefined on node v24.22.1; the property is `parentPath`).
2. **333 is open and operator-gated** (credentials, rotation, grants). It blocks only **342**; **336 / 337 / 341 / 334 /
   338 / 335 / 339** proceed under any 333 answer.
3. **The $0.50 family threshold still has no rig-side enforcer (324)**; the delegate is the tripwire, headroom **$0.15041**.
   **321 before 324** (operator ruling), and 317's calibration (`#5214`) before further verifier spend.
4. **303's root cause is open** (`#5231`/`#5260`, architect) — a broker past its deadline keeps heartbeating with closed
   storage, and that shape destroys reads (**329**, 6 dead letters).
5. **Three probes are still in gitignored `.spike/` and will be lost** (312 pattern): the `/proc` canary (337), the
   compaction-policy probe (331, `#5277` is the carrier for the keycheck, not this one), and the ledger-trajectory probe
   the milestone review needs (N2).
6. **RESOLVED — `docs/reviews/ensuring-llm-task-completion-research.md` is the operator's and is the next milestone**
   ("The operator created that file. I intended … to be the next milestone we work on", 2026-11-07). The delegate now
   tracks it as **milestone source material, not evidence** (a raw model reply; its three web references are unfetched by
   us) and pairs it with the grounding pass `docs/reviews/task-completion-milestone-intake-2026-11-07.md`. No rows have
   been minted from it — that is the team's act at the review (candidates N1–N7).
7. `selfdev.sqlite.spend.jsonl` is untracked and not ignored (**310**). The **327** stop-file writer is still unidentified.
8. **`docs/SELFDEV.md` is ~258 KB / ~65k tokens and `docs/ROADMAP.md` ~681 KB.** Read headings + grep the symptom
   (`scripts/clockin.mjs` prints the headings with anchors). Pitfalls **55–60** are the credential sweep's: the `/proc`
   path (55), the classifier floor (56), "a secrets service is not automatically a boundary" (57), bounded upstream reads
   and inverted pin drift (58), roadmap rows appended at the **end of the table** (59), and delegate-run provider probes
   spending outside the ledger (60).

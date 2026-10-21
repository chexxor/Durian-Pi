# File-encoding hygiene proposal — UTF-8 writes, tooling-owned EOL (delegate, 2026-10-19)

**Why this exists.** `src/broker.mjs` has now been corrupted twice in one day on this host — first
collapsed to one line, then **re-encoded UTF-16LE** (`Bin 68464 -> 128014 bytes`; `node --check`
`SyntaxError`). Both reached the shared tree through a path that bypasses the write guard. The operator
asked whether the team should be told, in its system prompts, which text encoding and line endings to
use. This note answers that and drafts the change. It is delegate analysis; the constitution edit and
the guard/`check` change are the team's (and the constitution is an operator-blessed artifact), so this
is routed rather than applied.

## The answer, in two halves

**Encoding — yes, add a rule (and, more importantly, a detector).** `constitution.txt` says nothing
about encoding, and `src/seatguard.mjs` inspects only the `write` tool's **content string** plus refused
shell **command shapes** (`git push`, `wsl`, `docker`). A shell redirect (`>`, `Out-File`,
`Set-Content`) or a raw `fs.writeFileSync` script writes bytes the guard never sees — which is exactly
how the UTF-16 corruption arrived (the untracked `fix-broker.mjs` is such a raw writer; `src/borker.mjs.head`
is a UTF-16 artifact).

**Line endings — no change.** The EOL stance is already decided and mechanically handled; a prose rule
would duplicate it and risk contradicting a settled ruling. See "Why not a repo-wide EOL rule" below.

## Why not a repo-wide EOL rule (the D83 rationale)

`docs/DECISIONS.md` **D83** (operator ruling, 2026-10-16), on file `#944` / `#328` / `#766`:

> **APPROVED:** add a `.gitattributes` — the narrow/file-scoped form (`eol=lf` on the specific tested
> files), **NOT repo-wide. A repo-wide `* text=auto eol=lf` is expressly NOT approved.**
> **Why.** #328 was logged with an explicit operator "do not start" hold on normalizing endings /
> adding `.gitattributes` … The operator lifted the hold for this scope only, **while declining the
> stop-the-world repo-wide rewrite** (same class as the held #994 whole-tree Prettier normalize).

The reason is **scope of blast radius, not correctness**: a repo-wide `* text=auto eol=lf` rewrites the
EOL of nearly every tracked file in one commit. That is a stop-the-world diff that collides with every
in-flight uncommitted worktree (the `devtools` WIP in the tree right now is a live example), so it
requires an **operator-declared quiet window** — the same gate as the held whole-tree Prettier normalize
(#994). What already exists instead:

- `.gitattributes` (commit `0626904`, #1055) pins only `constitution.txt`, `rig.starter.json`,
  `rig.selfdev.json` to `eol=lf` (the byte-equality mirrors).
- `core.autocrlf=true` normalises the rest (LF in git, CRLF in the worktree).
- `.prettierrc.json` sets `endOfLine: "lf"`.
- The residual LF-in-a-CRLF-tree ` M` is documented in `docs/runbooks/write-corruption-recovery.md` as
  a **cosmetic phantom**, not corruption.

So: do not add an EOL sentence to the system prompt, and do not open a repo-wide `.gitattributes`
change outside a declared window. The only EOL thing worth saying to a seat is the corollary of the
encoding rule: *let the tooling own line endings; never rewrite a file through a shell redirect.*

## Draft 1 — the constitution line (ready to paste)

Add to `constitution.txt` as a new P3 line (the file is pinned `eol=lf`; author it as LF):

```
P3 Encoding: source and docs are written as UTF-8 WITHOUT a BOM, through the write/edit tools — never
a shell redirect (`>`, `Out-File`, `Set-Content`, `Add-Content`) and never a raw `fs.writeFileSync` into
a tracked file; those paths emit UTF-16 on this host and have re-encoded `src/broker.mjs`. Line endings
are owned by the tooling (`.gitattributes` + `core.autocrlf=true` + prettier `endOfLine: lf`); do not
hand-convert them.
```

Mirrors that MUST be updated with it (else `demo/starter.test.mjs` / `demo/commit-model.test.mjs` /
`demo/seat-commit-instructions.test.mjs` go red — see `docs/runbooks/broker-safe-change.md` step 3):
`rig.starter.json` `constitutionInline` and `rig.selfdev.json` `constitutionInline`, byte-for-byte.

## Draft 2 — the durable detector: a `check` rule (write-path-agnostic)

The constitution rule is prose; per the repo's own finding, "conventions without machinery rot". The
detector that catches the corruption **regardless of how it was written** belongs in `src/checkup.mjs`:

- **Rule `text-encoding` (error).** For every tracked text file
  (`*.mjs|cjs|js|jsx|ts|mts|cts|json|md|txt|yml|yaml|toml|css|html|sh|ps1`): fail if the bytes begin with
  a UTF-16 BOM (`FF FE` / `FE FF`) or a UTF-8 BOM (`EF BB BF`), or contain a NUL byte (`0x00`).
  *Acceptance:* a fixture file committed with a UTF-16 BOM (or a NUL) is a `check` finding naming the
  path; a clean tree passes.

This is the same seam as the runbook/incident `check` rules in `src/checkup.mjs` and is cheap (a byte
scan per tracked file). It would have caught both `src/broker.mjs` corruptions at the next `check`.

## Draft 3 — the guard (defense-in-depth for the `write` tool)

`src/seatguard.mjs` already refuses **NUL** via `refusalForControlBytes` (`code < 0x20`), so a UTF-16
payload that reached the `write` tool as a decoded string would be caught. It does **not** catch a
UTF-8 BOM (`U+FEFF` is not a control byte). Add:

- In `refusalForControlBytes`: if `content` starts with `\uFEFF`, or contains a `\uFEFF` not at index 0,
  refuse with the recovery wording ("recover from git; write UTF-8 without a BOM").
- *Optional, if a false-positive budget is accepted:* refuse a `powershell` command whose text matches a
  tracked-source write redirect (`(?:>|Out-File|Set-Content|Add-Content)\s+.*\.(mjs|ts|md|json|txt)\b`).
  This is heuristic and could hit a legitimate scratch write; the `check` rule (Draft 2) is the stronger,
  false-positive-free half, so treat this as a nice-to-have, not the fix.

Note explicitly: **the guard cannot see bytes written by a shell redirect or a raw `fs.writeFileSync`
script** — this is the gap that produced the incident. The rule + `check` rule close it; the guard
extension only hardens the `write` tool path.

## Draft 4 — the demo

- Extend `demo/seatguard.test.mjs`: a `write` whose content begins with `\uFEFF` is refused; a normal
  UTF-8 write is allowed.
- Add/extend a `check` demo (`demo/checkup.test.mjs` or the rule's own demo) with a fixture carrying a
  UTF-16 BOM / NUL → the rule reports it.

## Apply procedure and caveats

1. **This is a spec change**: `constitution.txt` is a session document applied by `up --refresh`, which
   opens its own Harness. Per `docs/runbooks/broker-safe-change.md`: stop the broker and confirm it
   exited, then `up rig.selfdev.json --refresh`. It will reset/refresh the seats whose constitution/
   instructions change.
2. **Sync the two `constitutionInline` mirrors** (`rig.starter.json`, `rig.selfdev.json`) in the same
   change, then run `demo/starter.test.mjs` (exit 0) before calling it applied.
3. **Do not touch `.gitattributes` / EOL** (D83). If a repo-wide normalize is ever wanted, it needs an
   operator-declared quiet window and is out of scope here.
4. One concern? This is **two concerns** — the constitution rule (P3 text) and the guard/check machinery
   — and the culture prefers one concern per change. Suggested split: **item A** = constitution rule +
   mirror sync + `demo/starter.test.mjs`; **item B** = `check` rule + guard BOM refusal + demos. They can
   be independent; B is the durable half.

## Suggested owner / verification

- **Owner:** `impl` (guard + `check` rule) with the constitution text authored by whoever owns the
  constitution change; `lead` confirms the rule does not collide with D83's EOL ruling. *Verify:* `qa`
  (rule fires and passes), `auditor` (the guard's false-positive edges).

## Evidence

- `constitution.txt` — no `utf|encoding|bom|crlf` match.
- `src/seatguard.mjs:255-281` — the guard inspects only the `write` content string and refused shell
  **commands**; a redirect/`fs.writeFileSync` is not content-inspected.
- `src/seatguard.mjs:109-131` — `refusalForControlBytes` catches `< 0x20` (incl. NUL) and `0x7f`, not a BOM.
- `docs/DECISIONS.md` D83 — the operator ruling and its `#328` hold / `#994` class.
- `.gitattributes` (commit `0626904`, #1055) — narrow, file-scoped `eol=lf`; "a repo-wide
  `* text=auto eol=lf` is expressly not approved".
- `docs/incidents/2026-10-19-broker-mjs-one-line-collapse.md` — both corruptions and the untracked
  `fix-broker.mjs` / `src/borker.mjs.head` bypass artifacts.
- `.spike/delegate/broker.mjs.utf16-backup-20261019` — the UTF-16 copy recovered this session.

## Links

`docs/runbooks/write-corruption-recovery.md` · `docs/runbooks/broker-safe-change.md` ·
`docs/FORMATTER.md` (EOL stance + Sequencing) · `docs/runbooks/format-before-commit.md` ·
`src/seatguard.mjs`, `src/checkup.mjs`, `demo/seatguard.test.mjs`, `constitution.txt`.

# Verify provenance register (`docs/VERIFY-PROVENANCE.md`)

**Append-only register of what a run's PROVENANCE was — never what a seat is now.**
It exists so a verify made in a known-wrong-provider window is not cited as if it
ran on the target model. A reader consults it BEFORE citing a verify made in the
window; that is its whole purpose.

Design constraints (the same as `docs/DISPOSITIONS.md`, for the same reasons):

- **APPEND-ONLY.** A row is never edited or deleted; a reclassification gets a NEW
  row citing the deciding item.
- **IT RECORDS WHAT A RUN'S PROVENANCE WAS, not what a seat is now.** That is why it
  cannot go stale: nothing in it is a claim about the present.
- **CONSULT BEFORE CITING.** The default is distrust; the exceptions are enumerated.

## THE WINDOW (the wrong-provider era)

- **First wrong-provider turn:** `2026-10-18T19:10:56Z`.
- **Last:** `2026-10-20T03:45:55Z`.
- **1669 local-provider assistant turns in three eras** (audit #3627):
  - `local/qwen36` — **1588** turns;
  - `local/qwen36` with responseModel unrecorded — **14** turns;
  - `local/qwen36` rm:`swift-1.5-iq2_xs` — **67** turns.
- **Resume on target:** `2026-10-20T05:22:17Z`, `deepinfra/Qwen/Qwen3.6-35B-A3B`.

Re-derived independently (scribe, #3718): **1668** qa (conv 15) local turns in the
window, first `19:10:56.071Z`, last `03:44:18.570Z`, split 1588 / 14 / 66 — the
audit's 1669 / 67 differ by exactly one boundary turn (a turn at the window edge).
The counts and the window reconcile; the one-turn delta is recorded so no future
pass treats "1668" and "1669" as a discrepancy.

## THE DEFAULT

Any qa verify **completed in the window** is **UNVERIFIED-FOR-TARGET** unless it is
listed below as model-independent. The default is distrust; the exceptions are
enumerated. A verify completed in the window is not automatically void — it is
unproven for the target model, and may be re-verified or re-run.

## THE 7 EXCEPTIONS

| item id | class | why it is provider-sensitive |
|---|---|---|
| **#2543** (twin **#2701**) | **VOID** | live-run-unreachable, `DEEPINFRA_API_KEY` absence, `$-estimate` assertions — direct provider-environment claims made during the local era. Certification is provider-sensitive; re-verification routed separately. |
| **#2997** | **VOID** | the ONE provider seam: TRACE wrap, `thinking`/`reasoning_effort` request shape — protocol-formatting class. |
| **#2897** | **VOID** | degen context-tokens backstop tied to context-window/model denominators. |
| **#2654** | **VOID** | compaction-harness BUILD: per-model window/measure semantics — calibration class. |
| **#2201** | **CHEAP-RECHECK** | D105 boundary "only for local-provider seats" — provider-conditional mechanism; interpretive claim over reproducible demo output. |
| **#2279** | **CHEAP-RECHECK** | suite environmental classification ("37 pre-existing failures not introduced by this change") — interpretive claim over reproducible demo output. |

## THE 50 — the rule, not the enumeration

The remaining qa verifies completed in the window are **model-independent** — they
assert demo exit codes, counts, and code-reads, none of which the provider/model
could have influenced — and are therefore **trusted**. They are deliberately NOT
enumerated: a register that rows its default case buries its exceptions, and the
exceptions are what a reader needs to find.

## HOW FAR BACK — exactly the window

The label does **not** spread backwards past its evidence. Before the window qa was
on target continuously: `deepinfra/GLM-5.3-Flash` `2026-10-11T22:08` →
`2026-10-18T03:58`. Recording the boundary is what stops the label spreading.

## THE METHOD (corrects a mistake; the next reader should not repeat it)

The store's **TURN ENTRIES name provider, model AND responseModel per turn**; a
completion body does not. When provenance matters, **START AT THE ENTRIES TABLE,
not at the completion text.** The prior mistake: qa's provider was held to be
unknowable because its completion did not name one — the fact was in the store all
along, and "not in the surface I was reading" had been mistaken for "not
available".

## THE MISTRAL INTERLUDE — RESOLVED, not merely recorded

`pm` reported a 16-turn `deepinfra` **Mistral** interlude `2026-10-18T07:22→07:25`
(provider deepinfra, model `mistralai/Mistral-Small-3.2-24B-Instruct-2506`,
unexplained, "out of scope"). Under the same rule it is NOT out of scope. Resolved
from the entries (scribe, #3718):

- **16 assistant turns** in `07:22:36Z → 07:25:01Z`, all on the Mistral model.
- In them qa **claimed item #2112** (VERIFY, GATED — product rebrand) and began
  investigating; its reads failed `ENOENT` (a broken scratch/worktree), and the
  next `claim_work` returned **"You have no queued work"**.
- **NO `complete_work` occurred in those turns.** No verify was completed on
  Mistral, so **no rows are added** and no verify is unverified-for-target because
  of this interlude.

The interlude is resolved (no completed verify) rather than parked as "nobody
explained it" — an unexplained model flip is exactly the thing this register exists
to catch, and the resolution is that it produced no certification.

## How to re-verify this document (P3 — the entries query)

Run from the repo root against the current store (read-only). It produces the
window, the per-era counts, and the Mistral-interlude completion check — the
register is RE-DERIVABLE, not trusted:

```bash
node scripts/verify-provenance.mjs            # default store ./selfdev.sqlite
node scripts/verify-provenance.mjs <store>    # explicit store path
```

The script queries the `entries` table directly (`record LIKE '%"provider":"local"%'
AND conversation_id=15`, then per-turn `model[0]` `provider`/`model`/`responseModel`/
`timestamp`), counts the window's local turns by era, and checks the Mistral window
for any `complete_work` call. It exits 0 when the counts reconcile with the audit
(#3627). The method it encodes: START AT THE ENTRIES TABLE, not the completion body.

## Ledger

No rows yet — the window's provenance is the record; exceptions are enumerated
above. Rows will be appended here when a future verify is reclassified or a new
provider-window is found.

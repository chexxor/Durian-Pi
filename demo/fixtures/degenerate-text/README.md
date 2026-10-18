# degenerate-text fixtures — real seat turns, not synthetic

Each `.txt` file is the **joined assistant message text** of one real turn, pulled from the live
`selfdev.sqlite` store (the same bytes `scanEntries` returns, i.e. the raw shape where `entry.model`
is an array). They are the D78 lesson made concrete: a prose heuristic must be validated against the
seats' own pages, not against fixtures we wrote to pass.

Provenance (entry id, conversation/seat, why it is here):

## positive/ — real loops (the registry MUST flag these)

| File | Entry | Seat | Why |
|---|---|---|---|
| `impl-emit-loop-36368.txt` | 36368 | impl (conv 9) | F29 prose loop: coherent preamble, then `Emit. OK. Go. Now.` ~100x, ending "I sincerely apologize for the loop." |
| `impl-emit-loop-36408.txt` | 36408 | impl (conv 9) | Same shape, another turn. |
| `lead-completing-loop-36004.txt` | 36004 | lead (conv 21) | Ends in a wall of ~60 identical `Completing:` sentences. **This is the turn D78 cited as a healthy "lead ruling (123 fragments, 33 unique)"** — it is a genuine loop, so v1's lead reset was a TRUE positive (see docs/DECISIONS.md D81). |
| `qa-context-degeneration-71502.txt` | 71502 | qa (conv 15) | Context-saturation collapse at 367,559 tokens against an advertised 1,048,576: a coherent self-diagnosis ("My recent turns have degraded into incoherent outputs again") that then breaks into a ~21k-char wall of repeated single tokens (`very`, `the`, `U`, `d`, `0`). The turn the SEAT-LEVEL context trip must catch (#1705 Defect B) — and the one the per-run window never saw, because a `pi.user` wake preceded it. |

## negative/ — real healthy turns (the registry MUST NOT flag these)

| File | Entry | Seat | Why |
|---|---|---|---|
| `lead-ruling-37275.txt` | 37275 | lead (conv 21) | A coherent lead ruling; varied sentences, no wall. |
| `advocate-ruling-36335.txt` | 36335 | advocate (conv 4918) | A long design ruling v1 flagged (fragment ratio 0.27) but that is healthy — the case that proves absolute-fragment counting is wrong. |
| `scribe-doc-check-35168.txt` | 35168 | scribe (conv 4924) | A doc-verification turn v1 flagged (repeated `durig700`); healthy. |
| `scribe-doc-check-35231.txt` | 35231 | scribe (conv 4924) | A doc-check turn v1 flagged (repeated `md features`); healthy. |
| `auditor-probe-22137.txt` | 22137 | auditor (conv 4936) | An audit turn v1 flagged (repeated `test`); healthy. |
| `impl-short-healthy-36360.txt` | 36360 | impl (conv 9) | A short healthy turn (61 chars) — a sanity floor. |

Re-extract from a store copy with `scripts/degen-scan.mjs <store>` (to list matches) plus the entry-id
dump used when these were cut; the ids above are stable in the selfdev store.

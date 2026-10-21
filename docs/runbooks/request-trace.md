---
runbook: request-trace
symptom: "I need to see the ACTUAL request body durig sends to the provider (thinking / reasoning_effort / max_tokens / store), not the programmed config"
writes: false
precondition: "read-only"
last_verified: 2026-10-19
verified_by: impl
evidence: "#2545 / #920 (ROADMAP 43c) — src/providers/trace.mjs + the buildModels seam in cli.mjs; demo/trace-requests.test.mjs"
check_rule: null
---

# See the request body durig actually sends (the request TRACE)

## When to use

You need to know what durig REALLY puts on the wire for a model call — for example to confirm whether
a DeepSeek seat sends `thinking:{type:"enabled"}` plus `reasoning_effort` (and in which wire type),
which `max_tokens` field is used, whether `store` is sent, or whether the system prompt goes out as
`system` or `developer`.

The three things that are NOT the answer: the PROGRAMMED compat flags in
`src/providers/deepinfra-models.ts`, the RESPONSE-side usage stored in the transcript
(`usage.reasoning`, `rawStopReason`, `responseId`), and `DURIG_DEBUG` (it prints error stacks only).
None of them is the request body.

## Impact

Doing nothing: the operator's question is unanswerable from inside durig, and a wrong assumption about
the request arguments (a thinking parameter the provider ignores, the wrong max-tokens field) is
invisible — it looks like a model-quality problem.

The trace is READ-ONLY observation: it prints to stderr, writes no store entry, adds no schema, and is
off unless you set the env var (D11 / D24).

## Preconditions

None on the store — no harness is opened by the trace itself and it adds no writer, so it is safe while
the broker drives. Tracing is per PROCESS: set the variable on the process that makes the call.

## Diagnose (read-only)

Tracing is off by default. Confirm the current state of the seam, and that the module is present:

```bash
node -e "import('./src/providers/trace.mjs').then(m=>console.log('trace module ok; enabled now:', m.traceEnabled()))"
grep -n "wrapProviderWithTrace" cli.mjs        # the ONE provider seam (buildModels)
```

## Do

1. Run the call you want to inspect with the env seam set. The trace line goes to **stderr**, so the
   command's own JSON on stdout stays parseable — keep the two streams separate:

   ```bash
   DURIG_TRACE_REQUESTS=1 node cli.mjs send --to impl --body "hello" 2>trace.ndjson
   ```

   The same variable works for every run path (`up`, `run`, `serve`, and the instruction optimizer),
   because they all build the provider stack in `cli.mjs` `buildModels`.

2. Read one line per model call (`jq` optional; the line is one JSON object):

   ```bash
   cat trace.ndjson | node -e "const rl=require('readline').createInterface({input:process.stdin});rl.on('line',l=>{const j=JSON.parse(l);console.log(j.seat, j.model, JSON.stringify(j.thinking), j.reasoningEffort, j.maxTokensField, j.store, j.systemRole)})"
   ```

   The summary fields answer the usual question directly; `payload` carries the full redacted body that
   the wire carried.

3. Secrets are redacted by construction: an auth-named field is replaced by `[redacted:credential-field]`
   and any secret-shaped token by `[redacted:secret-shaped]`. If a payload exceeds the line cap the
   summary is emitted with `truncated: true` and `payloadBytes`, never a silently clipped body.

## Verify

```bash
node demo/trace-requests.test.mjs    # exit 0
```

That demo drives pi-ai's REAL `openai-completions` serializer with a capturing fetch and asserts the
printed payload IS the captured request body, that a thinking seat shows
`thinking:{type:"enabled"}` + `reasoning_effort`, that a non-thinking seat shows
`thinking:{type:"disabled"}` with no `reasoning_effort`, and that secrets never reach the line.

## If it fails

- No trace line at all: confirm the process actually made a model call, and that `DURIG_TRACE_REQUESTS=1`
  was set on THAT process (`DURIG_PROVIDER=faux` never calls the hook — the faux provider is not the
  OpenAI serializer).
- A `{"trace":"request-error"}` line: the trace itself failed; the generation continued (a trace failure
  never breaks a call). Report the error text to `impl`.
- `max_tokens` reported `absent`: the caller passed no `maxTokens`; that is a real answer, not a bug.

## Escalate to

`impl` — for a seam that does not attach (a new provider path bypassing `buildModels`), or a payload
field that needs adding to the summary. `lead` — for a decision that changes what durig sends (the
trace observes; it never changes a request).

## Evidence

#2545 / #920 (ROADMAP 43c): `src/providers/trace.mjs` + the `buildModels` seam in `cli.mjs`, proved by
`demo/trace-requests.test.mjs`. Verify ran 2026-10-19 (exit 0).

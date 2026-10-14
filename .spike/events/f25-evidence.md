# F25 (#259) — help is not a failure; unknown verb names itself: evidence

Concern (one): the CLI's invocation contract. Help (`--help`/`-h`/`help`/bare) must be a normal
ok:true response exiting 0; an unknown verb must stay a distinct failure (ok:false + an error naming
the verb + exit 2).

## Changed files (nothing else touched)
- `cli.mjs` — added a first dispatch branch for help forms (`cmd === undefined || "--help" || "-h" || "help"` -> `out({ ok:true, command:"help", usage })`); the unknown-verb `else` now emits `{ ok:false, error: 'unknown command "<verb>"', usage }` and keeps `process.exit(2)`.
- `demo/cli.test.mjs` — extended the error-contract block: the existing unknown-command assertion now also checks the error names the verb; added a loop asserting `--help`/`-h`/`help`/bare all exit 0 with ok:true and command:"help".

## Failing-first (before the cli.mjs change)
```
$ node --check demo/cli.test.mjs   -> exit 0
$ node demo/cli.test.mjs
AssertionError: actual: undefined, expected: 'unknown command "frobnicate"'  (strictEqual)
exit=1
```
(The new assertion failed because today there is NO `error` field on the unknown-command response.)

## After the change
```
$ node --check cli.mjs             -> exit 0
$ node demo/cli.test.mjs
--- error contract ---
CLI TEST PASS (contracts, exit codes, stderr, error surface, request-id idempotency)
exit=0
```

Live contract (raw):
```
args=[--help]       exit=0 ok=True  command=help
args=[-h]           exit=0 ok=True  command=help
args=[help]         exit=0 ok=True  command=help
args=[(bare)]       exit=0 ok=True  command=help
args=[frobnicate]   exit=2 ok=False error=unknown command "frobnicate"
```
`node cli.mjs --help` body: `{"ok":true,"command":"help","usage":"usages:\n  node cli.mjs up <rig.json> ..."}`
`node cli.mjs frobnicate` body: `{"ok":false,"error":"unknown command \"frobnicate\"","usage":"..."}`

## Suite (honest)
```
demo suite: total=49 passing=48 failing=[syncpi.test.mjs(exit 1)]
```
`syncpi.test.mjs` fails on the pre-existing malformed `pi-main.pin.json` (#219) — not this change.
Nothing else changed: `git status` shows only `cli.mjs` and `demo/cli.test.mjs` modified by me.

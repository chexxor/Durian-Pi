# Verification for #3802 — P5/#110 comment restored

1. byte-identical to 595b714~1: git diff --numstat 595b714~1 286a911 -- cli.mjs -> empty. Confirmed.
2. broker-one-connection test -> exit 0. "BOTH probe-handle opens document P5/#110". Confirmed.
3. The clobber (595b714) deleted exactly the 7-line comment block at that site. Restoring it makes cli.mjs byte-identical to the parent. Confirmed.
4. Only cli.mjs changed, +7/-0. No dependency/encoding/rig changes. Confirmed.

The restore is verbatim — no wording drift. This is the correct fix.

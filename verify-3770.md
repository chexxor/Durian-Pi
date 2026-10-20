# Verification for #3770 — structural notice flag fix

## Fix summary
1. isNoticeItem, isDoneNotice, isCancellationNotice now check 	ypeof item?.notice === "boolean" FIRST.
   Only if the flag is absent does the subject regex fallback apply.
2. cancelItem separates two no-notice causes: selfOnly vs noticeOfNotice, and names the actual cause.
3. The demo models legacy flag-less items by deleting the field after enqueue.

## Key behavioral test: notice:false + "DONE #123:" subject
- UNPATCHED: isNoticeItem({ notice: false, subject: 'DONE #3384: ...' }) -> TRUE (bug: regex overrides flag)
- PATCHED: isNoticeItem({ notice: false, subject: 'DONE #3384: ...' }) -> FALSE (correct: flag wins)

## Legacy behavior preserved
- isNoticeItem({ subject: 'DONE #1: x' }) -> TRUE (flag-less, regex fallback works)
- isNoticeItem({ notice: true, subject: 'build the landing screen' }) -> TRUE (flag overrides)

## Demo results
- cancel-notifies-sender.test.mjs -> exit 0 (all checks pass, including new #3739 cases)
- notices.test.mjs -> exit 0 (all checks pass)
- Syntax: node --check src/rig.mjs -> 0

## No new failures
Same 2 pre-existing reds (curate, pitui) both sides.

## Verdict
The structural flag fix is correct. The flag wins over subject regex for items that carry it,
and the regex fallback is preserved for legacy flag-less items. The three no-notice causes are
distinguishable in the message. The demo exercises all three states.

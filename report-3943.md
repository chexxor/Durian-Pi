# NARROW VERIFY #3943 — TUI slice on main

## PART 1: Content is live on main

1. git diff 595b714 main -- src/tui/client.mjs src/readapi.mjs src/viewmodel.mjs src/watchview.mjs src/textwidth.mjs demo/tui-landing.test.mjs demo/landing-data.test.mjs -> EMPTY. The content is byte-identical.

2. projectLanding() exists at src/readapi.mjs:465. The landing row + conversation header + status bar are in src/tui/client.mjs from line 72. Newline-preserving wrap is in src/textwidth.mjs.

3. All four demos pass exit 0:
   - demo/tui-landing.test.mjs -> PASS
   - demo/tui-status-bar.test.mjs -> PASS
   - demo/tui-conversation-header.test.mjs -> PASS
   - demo/landing-data.test.mjs -> PASS

## PART 2: Three branches are SUPERSEDED

- impl-item-2826: diff --stat shows 135 deletions from client.mjs, 2957 total deletions across 31 files. The branch would DELETE landed content. SUPERSEDED.
- impl-item-3359: diff --stat shows 97 deletions from client.mjs, 2801 total deletions across 30 files. Would DELETE landed content. SUPERSEDED.
- impl-item-3437: diff --stat shows 0 changes in src/tui/ files, but 1908 deletions across 11 files (docs, scripts). Would DELETE landed content. SUPERSEDED.

All three are strict subsets of main. None carries unique content that doesn't already exist on main.

## PART 3: Provenance recorded (not tidied)

The TUI slice reached main through an accidental bare commit:
1. 595b714 "docs(NEXT): a current NEXT SESSION at the top" — bare commit that landed the TUI slice, claiming docs-only in its subject but touching non-docs paths. Never had a landing entry.
2. 9c3aa02 "docs(NEXT): qa2 put into rotation" — bare commit that deleted the TUI slice. Also never had a landing entry.
3. 798836b "merge: land revert-9c3aa02 onto main" — merged the revert back, restoring the TUI content. This was a proper merge but the revert itself (9c3aa02) was a bare commit.

The content is correct and live, but the path is illegitimate: a "docs(NEXT)" commit changed non-docs code, was deleted by another "docs(NEXT)" commit, and restored via a revert merge. None of this passed a landing entry. #3700 exists because of this.

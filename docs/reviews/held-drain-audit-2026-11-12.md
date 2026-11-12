# Held-backlog drain evidence - 2026-11-12 (#7145, delegate, read-only)

**Case:** pm asked for the drain audit's per-row evidence: for every held row, the gates it names, whether
those gates are terminal, and whether the artifact the row cites is FULLY on main by CONTENT. Nothing here
cancels, releases or transitions a row - those are pm's transitions (docs/runbooks/stale-held-backlog.md).

**Scope and hygiene.** Read-only: ONE broker-served `cli.mjs queue` read plus git object reads. No row was
claimed, released, cancelled or transitioned. The shipped instrument was `tools/queue-drain-audit.mjs`;
the content test below is the additional probe this item asked for.

**Store:** `/home/chexxor/Git/Durian-Pi/selfdev.sqlite` - 7181 rows, histogram done 4745 / cancelled 936 /
held 428 / deferred 524 / queued 534 / claimed 14. **Tree:** branch `item-7145`, `main` tip at read time
`a58601c30b5a5193b31ef5fddb6ee085f7e6ca6e`. **Dependency plane:** `@earendil-works/pi-durable 1.3.0` from the
lockfile (vendor/pi-main is not built in this worktree) - a run here is NOT comparable with a seat-root run
on 1.5.1.

## Method, so every count can be re-measured

1. Gates = structured `blockedBy` ids plus `#NNNN` prose refs. Terminal = that id's own status in the store.
2. Citations = /\b[0-9a-f]{7,40}\b/ requiring a digit AND a letter. Floor 7 because the shipped extractor in
   `src/citation.mjs` uses {8,40} and is blind to the 7-char short-sha convention this rig writes (D142).
3. **Ancestry** (`git rev-list refs/heads/main`) is what the shipped tool tests. It is not the verdict: a sha
   can be reachable from main while the content it records is not in main's tree - the false positive #4035
   measured.
4. **The content test used here:** for each cited commit, take the diff it made. Every line it ADDED must be
   present in main's blob at that path TODAY, and every line it REMOVED must be absent. Classes: verbatim,
   near-verbatim (>=90% of added lines present and nothing removed reappears), drift, not-on-main,
   unresolvable, no-citation.
5. Stated limit: `git rev-list main -- <path>` hides merge commits (git's TREESAME simplification), so
   "absent from that path's history" is not evidence of non-landing and is not used as a verdict anywhere here.
6. A number the shipped tool prints that should not be trusted: `tools/queue-drain-audit.mjs` reports
   "(33% of the 277 held ...)" from a HARDCODED `277` in its report string. The store has 428 held rows right
   now, so that denominator is stale by 151 rows. The percentage it prints happens to match 142/428; the literal
   is still a lie waiting for the next run.

## The two numbers

- **Held rows provably closable on content: 24** of the 98 held LANDING rows (15 verbatim + 9 near-verbatim).
  The shipped tool's ancestry test claims **74**; the 50-row gap is the #4035 class:
  39 rows where lines the landing removed are BACK in main's tree,
  11 rows with substantial missing added lines, 16 rows whose cited shas are not reachable
  from main at all, 3 unresolvable citations, 5 rows with no citation.
  - verbatim: 2149 2226 2513 2571 2592 2637 3686 3940 4025 4344 4513 4540 4547 4595 6156
  - near-verbatim: 2636 3607 3822 4039 4524 4539 5246 5791 5826
  - do NOT close on ancestry alone (removed lines reappear in main): 2476 2841 2993 3039 3103 3120 3377 3456 3699 3786 3808 3828 3830 3841 3864 3934 3993 4031 4035 4041 4060 4119 4123 4136 4142 4154 4157 4169 4259 4471 4544 4698 5360 5381 5426 5754 5816 5817 5900

- **Deferred rows parked on a question only a human can answer: 2** (#4917 and #5147, both `resolver: operator`).
  Of the 524 deferred rows, **515 carry no authored park record at all**, so their blocker cannot be read from
  the store. Tonight's ceiling is not "2 rows waiting on a person" - it is "515 rows whose park reason was
  never recorded", and no seat can drain a row whose blocker is unknown.

## Gate terminality across the 428 held rows

- 392 name at least one gate (structured `blockedBy` or prose `#id`).
- 163 have EVERY named gate terminal (done/cancelled) - a terminal gate next to a held row proves nothing by itself; the body decides (runbook: standing-rule vs orphan).
- 36 name no gate at all.

## Per-row evidence, all 428 held rows

| row | to | landing? | gates it names (status in the store) | cited artifact vs main's tree TODAY | class |
|---|---|---|---|---|---|
| #725 | impl | - | #662 done, #710 done | none | not-a-landing-row |
| #726 | devtools | - | #662 done, #710 done | none | not-a-landing-row |
| #727 | qa | - | #662 done, #710 done | none | not-a-landing-row |
| #740 | scribe | - | #716 done, #722 done, #60 done, #63 cancelled, #625 done, #397 done | none | not-a-landing-row |
| #994 | devtools | - | #989 done, #987 done, #938 done, #944 done, #328 cancelled, #766 done | 906b354 = landed | not-a-landing-row |
| #1005 | devtools | - | #940 done, #939 done, #723 cancelled, #724 cancelled, #725 held, #726 held | cd86716 ~ NOT in main's tree (10/44 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #1088 | impl | - | #1066 done, #1040 done, #1036 done, #977 done, #1055 done, #975 done, #976 done, #964 done, #965 done, #966 cancelled, #873 done, #998 done, #1002 done, #993 done | none | not-a-landing-row |
| #1089 | impl | - | #700 done, #1066 done, #1040 done, #1036 done, #977 done, #1055 done, #975 done, #976 done, #964 done, #965 done, #966 cancelled, #873 done, #998 done, #1002 done, #993 done | none | not-a-landing-row |
| #1090 | impl | - | #1066 done, #1040 done, #1036 done, #977 done, #1055 done, #975 done, #976 done, #964 done, #965 done, #966 cancelled, #873 done, #998 done, #1002 done, #993 done | none | not-a-landing-row |
| #1091 | impl | - | #1066 done, #1040 done, #1036 done, #977 done, #1055 done, #975 done, #976 done, #964 done, #965 done, #966 cancelled, #873 done, #998 done, #1002 done, #993 done | none | not-a-landing-row |
| #1092 | impl | - | #1066 done, #1040 done, #1036 done, #977 done, #1055 done, #975 done, #976 done, #964 done, #965 done, #966 cancelled, #873 done, #998 done, #1002 done, #993 done | none | not-a-landing-row |
| #1228 | impl | - | #1151 done, #1182 done, #1190 done, #1194 done | none | not-a-landing-row |
| #1268 | impl | - | #1235 done | none | not-a-landing-row |
| #1269 | impl | - | none | none | not-a-landing-row |
| #1270 | impl | - | #1235 done | none | not-a-landing-row |
| #1274 | impl | - | #1163 done, #1273 done, #1224 done | 935b2c4 = landed | not-a-landing-row |
| #1467 | impl | - | #1462 done, #1458 done, #1465 done | none | not-a-landing-row |
| #1468 | impl | - | #1444 done, #1454 done | 85c5d95 ! not reachable from main | not-a-landing-row |
| #1492 | impl | - | #1485 done, #1486 done | none | not-a-landing-row |
| #1522 | impl | - | #1494 done, #1465 done, #1520 done, #1505 done | 0932fa3 = landed ; fec14b7 ! not reachable from main | not-a-landing-row |
| #1564 | impl | - | #1562 done, #1560 done, #1567 done | none | not-a-landing-row |
| #1582 | impl | - | #156 done, #1580 done | none | not-a-landing-row |
| #1583 | impl | - | #174 cancelled, #920 cancelled | none | not-a-landing-row |
| #1629 | impl | - | #171 cancelled, #1556 done, #165 cancelled | 28e817a ~ NOT in main's tree (6/53 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #1634 | impl | - | #1584 done, #275 cancelled, #164 cancelled | none | not-a-landing-row |
| #1724 | impl | - | #1609 done, #966 cancelled, #1564 held, #1566 done | 53fd8c6 ! not reachable from main | not-a-landing-row |
| #1780 | impl | - | #1789 done, #1766 done, #1769 done, #1562 done | cfb4457 ! not reachable from main | not-a-landing-row |
| #1781 | impl | - | none | cfb4457 ! not reachable from main | not-a-landing-row |
| #1782 | impl | - | none | cfb4457 ! not reachable from main | not-a-landing-row |
| #1786 | security | - | none | cfb4457 ! not reachable from main | not-a-landing-row |
| #1788 | security | - | none | cfb4457 ! not reachable from main | not-a-landing-row |
| #1805 | devtools | - | none | none | not-a-landing-row |
| #1957 | impl | - | #1937 done, #1940 done, #1936 done, #1930 cancelled | c29b2bf ~ NOT in main's tree (9/13 added lines absent, 0 removed lines reappear) ; d3d6be3 ! not reachable from main | not-a-landing-row |
| #1965 | impl | - | #1952 done, #1946 done, #1388 cancelled, #1443 cancelled, #1899 cancelled | 22ae784 ~ NOT in main's tree (3/4 added lines absent, 0 removed lines reappear) ; 82a6fcc = landed | not-a-landing-row |
| #1967 | impl | - | #1954 done | fa645fb ~ NOT in main's tree (27/27 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #1978 | devtools | - | #1973 done, #1941 done, #1901 cancelled, #1910 cancelled, #1915 cancelled, #1921 cancelled, #1928 done, #1929 cancelled, #1885 done | none | not-a-landing-row |
| #2144 | impl | - | #2110 cancelled, #2122 done | none | not-a-landing-row |
| #2149 | impl | LANDING | #2123 done, #1972 done | 007f073 = landed | verbatim-on-main |
| #2190 | impl | - | #2079 cancelled, #2166 done | 4a50da6 = landed | not-a-landing-row |
| #2217 | auditor | - | #2175 done, #2213 done, #2121 cancelled, #2148 done, #2212 done | 007f073 = landed | not-a-landing-row |
| #2226 | impl | LANDING | #2211 done, #1966 done | b3c4c3a = landed | verbatim-on-main |
| #2284 | impl | LANDING | #2215 done, #1952 done, #1780 held, #1966 done, #2186 done, #2180 cancelled, #2240 done, #2267 cancelled | fd4c233 ! not reachable from main | cited-sha-not-reachable-from-main |
| #2287 | impl | - | #2126 done | none | not-a-landing-row |
| #2288 | impl | - | #2126 done, #2166 done | none | not-a-landing-row |
| #2295 | impl | - | #1966 done, #1907 cancelled, #2211 done, #2291 done, #1724 held | a210122 ~ NOT in main's tree (1/46 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #2338 | impl | - | #2125 done | b38d985 ~ NOT in main's tree (8/87 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #2385 | impl | LANDING | none | 5d7a397 ~ NOT in main's tree (11/11 added lines absent, 0 removed lines reappear) ; 77d0da5 ~ NOT in main's tree (1/2 added lines absent, 0 removed lines reappear) | drift-lines-absent |
| #2399 | impl | LANDING | #1498 done, #2224 done, #2298 done, #2349 cancelled, #2393 cancelled | a999a5f ~ NOT in main's tree (7/123 added lines absent, 21 removed lines reappear) ; a2eaf7b ! not reachable from main | cited-sha-not-reachable-from-main |
| #2402 | impl | - | #2233 cancelled, #62 cancelled, #2231 done | 166d51f ~ NOT in main's tree (14/76 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #2403 | impl | - | #2233 cancelled, #62 cancelled | none | not-a-landing-row |
| #2425 | impl | - | #2422 done, #2258 cancelled, #2110 cancelled, #1957 held, #1622 cancelled, #2092 cancelled, #2093 cancelled, #2259 done | 062e691 ~ NOT in main's tree (14/25 added lines absent, 0 removed lines reappear) ; 3d102a6 ~ NOT in main's tree (21/49 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #2426 | impl | - | #2422 done, #2258 cancelled, #1957 held, #1622 cancelled, #2092 cancelled, #2093 cancelled, #2259 done | none | not-a-landing-row |
| #2433 | impl | - | #2321 done, #2317 done, #2432 done, #2237 done, #2409 done, #2420 done | none | not-a-landing-row |
| #2466 | impl | LANDING | #2449 done, #2456 done | b8fdcc7 ~ NOT in main's tree (4/11 added lines absent, 0 removed lines reappear) | drift-lines-absent |
| #2469 | impl | - | #2452 done, #2462 done | none | not-a-landing-row |
| #2476 | impl | LANDING | #2237 done | 05d8615 = landed ; 3021fe2 ~ NOT in main's tree (3/26 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #2479 | impl | - | #2097 cancelled, #2237 done | 3021fe2 ~ NOT in main's tree (3/26 added lines absent, 1 removed lines reappear) | not-a-landing-row |
| #2480 | qa | - | none | none | not-a-landing-row |
| #2481 | devtools | - | none | none | not-a-landing-row |
| #2484 | impl | - | #2420 done | none | not-a-landing-row |
| #2500 | impl | - | #2420 done, #2237 done, #2478 cancelled | 3021fe2 ~ NOT in main's tree (3/26 added lines absent, 1 removed lines reappear) | not-a-landing-row |
| #2513 | impl | LANDING | #2492 done, #2412 cancelled, #2360 done | ef72ab6 = landed | verbatim-on-main |
| #2544 | scribe | - | none | none | not-a-landing-row |
| #2546 | impl | - | #966 cancelled, #885 done | none | not-a-landing-row |
| #2571 | impl | LANDING | #2524 done, #2328 done, #2513 held, #2360 done | b36cd81 = landed ; ef72ab6 = landed | verbatim-on-main |
| #2591 | impl | LANDING | none | a05c660 ~ NOT in main's tree (6/43 added lines absent, 0 removed lines reappear) | drift-lines-absent |
| #2592 | impl | LANDING | #2328 done, #2537 done, #2332 done, #2538 done, #2360 done | 0ede1de = landed | verbatim-on-main |
| #2598 | impl | - | #1587 cancelled, #2420 done, #1692 done | none | not-a-landing-row |
| #2599 | impl | - | #1585 cancelled, #912 done | none | not-a-landing-row |
| #2618 | impl | - | #61 cancelled | none | not-a-landing-row |
| #2619 | impl | - | #62 cancelled | none | not-a-landing-row |
| #2620 | impl | - | #63 cancelled | none | not-a-landing-row |
| #2621 | impl | - | #164 cancelled, #145 done | none | not-a-landing-row |
| #2622 | impl | - | #1108 cancelled, #1109 done, #1113 done, #1128 done, #1142 done, #1120 done, #1131 done | none | not-a-landing-row |
| #2625 | impl | - | #2066 cancelled, #2054 done | none | not-a-landing-row |
| #2626 | impl | - | #2097 cancelled | none | not-a-landing-row |
| #2627 | devtools | - | #1929 cancelled, #912 done | none | not-a-landing-row |
| #2628 | devtools | - | #1930 cancelled, #912 done | none | not-a-landing-row |
| #2636 | impl | LANDING | #2594 done, #2336 done, #2360 done, #2365 cancelled | 02f1a36 ~ NOT in main's tree (3/210 added lines absent, 0 removed lines reappear) | near-verbatim |
| #2637 | impl | LANDING | #2597 done, #2541 done | fe1434e = landed | verbatim-on-main |
| #2639 | impl | - | #2259 done, #2605 done, #2554 cancelled, #2553 cancelled | none | not-a-landing-row |
| #2655 | auditor | - | #2647 done, #2543 done, #1087 cancelled | none | not-a-landing-row |
| #2667 | impl | LANDING | #2556 cancelled, #2608 done, #2555 done | f36ca3e ~ NOT in main's tree (0/3 added lines absent, 1 removed lines reappear) ; 2ecf709 ! not reachable from main ; c4147ad = landed | cited-sha-not-reachable-from-main |
| #2675 | qa | - | none | none | not-a-landing-row |
| #2680 | qa | - | none | none | not-a-landing-row |
| #2681 | impl | - | #2049 cancelled | 4f9e7d6 ~ NOT in main's tree (47/79 added lines absent, 1 removed lines reappear) ; 7b6548e = landed | not-a-landing-row |
| #2705 | impl | - | #1192 done, #1227 cancelled | c15f61b ~ NOT in main's tree (10/61 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #2718 | impl | - | #2044 cancelled, #2049 cancelled, #2655 held, #2692 done, #2446 cancelled, #2445 cancelled, #2645 cancelled | d1516a6 ! not reachable from main ; 8f8e3c0 ~ NOT in main's tree (3/7 added lines absent, 2 removed lines reappear) ; fdfcd95 ! not reachable from main ; 99b9860 = landed ; 6ccd26e ! not reachable from main | not-a-landing-row |
| #2733 | impl | - | #2710 done, #2702 done, #2097 cancelled, #2098 done | none | not-a-landing-row |
| #2778 | impl | LANDING | #2452 done | e08d1a9 ~ NOT in main's tree (4/37 added lines absent, 0 removed lines reappear) | drift-lines-absent |
| #2788 | impl | - | #2743 done | d1fde2d ~ NOT in main's tree (3/36 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #2789 | impl | - | #2743 done, #1966 done, #2237 done | d1fde2d ~ NOT in main's tree (3/36 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #2802 | scribe | - | #2749 done, #2741 cancelled | none | not-a-landing-row |
| #2804 | impl | - | #2750 done, #2699 done, #2808 done, #2788 held, #2799 done, #2743 done, #2789 held, #74 done | daa2f0c ! not reachable from main | not-a-landing-row |
| #2812 | impl | - | #1780 held, #2759 done, #1966 done | none | not-a-landing-row |
| #2823 | impl | - | #2483 done, #2783 done, #2572 done, #2237 done | 67d885d ! not reachable from main ; e5b364f ! not reachable from main | not-a-landing-row |
| #2841 | impl | LANDING | #2155 cancelled, #2446 cancelled, #2468 cancelled, #2486 cancelled, #2818 done, #1456 done, #2412 cancelled, #1400 done, #1401 done, #1344 done | a70fc27 ~ NOT in main's tree (9/9 added lines absent, 0 removed lines reappear) ; c85d210 ~ NOT in main's tree (2/35 added lines absent, 50 removed lines reappear) ; 4754b69 ~ NOT in main's tree (0/8 added lines absent, 3 removed lines reappear) ; feccaf6 = landed ; 0c1de2a ~ NOT in main's tree (3/7 added lines absent, 3 removed lines reappear) ; 170e5e0 ~ NOT in main's tree (0/27 added lines absent, 1 removed lines reappear) ; 8fa4114 ~ NOT in main's tree (0/74 added lines absent, 64 removed lines reappear) | drift-revert-shaped |
| #2854 | impl | - | #1547 cancelled, #2839 done, #2836 done | none | not-a-landing-row |
| #2855 | impl | - | #920 cancelled, #2420 done, #2839 done, #2836 done, #1587 cancelled, #1547 cancelled | none | not-a-landing-row |
| #2868 | impl | - | #2572 done | none | not-a-landing-row |
| #2927 | impl | LANDING | #1907 cancelled, #2211 done, #1780 held, #2760 done, #2295 held, #2889 done, #2890 done, #2812 held | 9aa2053 ~ NOT in main's tree (1/126 added lines absent, 0 removed lines reappear) ; a70fc27 ~ NOT in main's tree (9/9 added lines absent, 0 removed lines reappear) ; 01b1839 ! not reachable from main | cited-sha-not-reachable-from-main |
| #2932 | impl | - | #1705 done, #1957 held, #2757 done | 349d5d3 = landed | not-a-landing-row |
| #2937 | qa | - | #2934 done | none | not-a-landing-row |
| #2938 | devtools | - | #2934 done, #2936 done | none | not-a-landing-row |
| #2950 | devtools | - | #2412 cancelled, #1805 held, #2459 done, #2801 done, #2934 done, #2390 done | none | not-a-landing-row |
| #2952 | scribe | - | #2919 done, #2918 done | none | not-a-landing-row |
| #2953 | scribe | - | none | none | not-a-landing-row |
| #2958 | devtools | - | #994 held | none | not-a-landing-row |
| #2963 | scribe | - | #2733 held, #2957 done, #2098 done, #2105 done, #2710 done | none | not-a-landing-row |
| #2977 | impl | - | #2698 done, #2788 held, #2789 held, #2804 held, #2826 done, #2626 held, #2733 held, #2973 done | none | not-a-landing-row |
| #2978 | scribe | - | #2802 held, #2755 cancelled, #2976 done | 4a1fe16 ~ NOT in main's tree (1/259 added lines absent, 3 removed lines reappear) | not-a-landing-row |
| #2993 | qa | LANDING | #2992 done, #2801 done, #2976 done | e4e6244 ~ NOT in main's tree (10/26 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #3018 | impl | - | none | defbc34 ~ NOT in main's tree (56/314 added lines absent, 8 removed lines reappear) | not-a-landing-row |
| #3019 | impl | - | none | defbc34 ~ NOT in main's tree (56/314 added lines absent, 8 removed lines reappear) | not-a-landing-row |
| #3020 | impl | - | #2630 done | defbc34 ~ NOT in main's tree (56/314 added lines absent, 8 removed lines reappear) | not-a-landing-row |
| #3021 | impl | - | none | defbc34 ~ NOT in main's tree (56/314 added lines absent, 8 removed lines reappear) | not-a-landing-row |
| #3022 | impl | - | none | defbc34 ~ NOT in main's tree (56/314 added lines absent, 8 removed lines reappear) | not-a-landing-row |
| #3023 | scribe | - | none | defbc34 ~ NOT in main's tree (56/314 added lines absent, 8 removed lines reappear) | not-a-landing-row |
| #3025 | qa | - | #3018 held | none | not-a-landing-row |
| #3026 | qa | - | #3019 held | none | not-a-landing-row |
| #3027 | qa | - | #3020 held, #2630 done | none | not-a-landing-row |
| #3028 | qa | - | #3021 held | none | not-a-landing-row |
| #3029 | qa | - | #3022 held | none | not-a-landing-row |
| #3030 | qa | - | #3023 held | none | not-a-landing-row |
| #3039 | impl | LANDING | #920 cancelled, #2998 cancelled, #2999 done, #2854 held, #2949 done | 1e96d53 ~ NOT in main's tree (2/21 added lines absent, 6 removed lines reappear) | drift-revert-shaped |
| #3043 | impl | - | #3014 done, #2951 done, #2673 done, #2712 cancelled, #2420 done, #2483 done, #3009 done, #3040 cancelled, #3017 done | none | not-a-landing-row |
| #3050 | impl | - | #3016 done, #3017 done, #3020 held | none | not-a-landing-row |
| #3051 | impl | - | #3032 done | 0827b39 = landed | not-a-landing-row |
| #3070 | impl | - | #3048 done, #3034 done, #2673 done, #3017 done, #3062 done, #2951 done, #3063 cancelled, #2420 done, #2483 done, #3056 done, #2712 cancelled, #2983 done | 756100e ! not reachable from main | not-a-landing-row |
| #3103 | impl | LANDING | #3084 done | de9ac4d ~ NOT in main's tree (0/20 added lines absent, 2 removed lines reappear) | drift-revert-shaped |
| #3112 | impl | LANDING | #3062 done, #3109 done, #3034 done, #3063 cancelled | 6ddf538 ~ NOT in main's tree (8/107 added lines absent, 2 removed lines reappear) ; 756100e ! not reachable from main ; eb3b337 ~ NOT in main's tree (16/47 added lines absent, 0 removed lines reappear) | cited-sha-not-reachable-from-main |
| #3120 | impl | LANDING | #2992 done, #2949 done, #2993 held, #2559 done | e4e6244 ~ NOT in main's tree (10/26 added lines absent, 1 removed lines reappear) ; 8e4f987 ~ NOT in main's tree (10/10 added lines absent, 0 removed lines reappear) | drift-revert-shaped |
| #3165 | impl | - | #3123 cancelled | none | not-a-landing-row |
| #3168 | scribe | - | none | 1f8509b = landed | not-a-landing-row |
| #3185 | impl | - | #3179 done, #3174 done, #2425 held, #2426 held, #1492 held, #3178 cancelled | none | not-a-landing-row |
| #3219 | impl | - | #3174 done, #3217 done | none | not-a-landing-row |
| #3225 | impl | - | #3192 done, #3223 done | none | not-a-landing-row |
| #3235 | impl | LANDING | #3204 cancelled, #3214 done, #3232 done, #3205 cancelled | e29ddb8 ! not reachable from main | cited-sha-not-reachable-from-main |
| #3267 | qa | - | #3235 held, #3235 held, #3270 done, #2412 cancelled | e29ddb8 ! not reachable from main | not-a-landing-row |
| #3271 | scribe | - | #3265 done, #3075 cancelled, #3252 done, #3077 queued, #3186 cancelled, #2824 cancelled, #3236 cancelled, #2823 held, #3247 cancelled, #3106 cancelled | 3a89076 = landed ; b7c0795 = landed | not-a-landing-row |
| #3272 | impl | - | #3265 done, #3337 done, #3332 done, #1475 done, #3370 done, #3369 done, #3298 done, #3444 done, #3440 done, #3379 done, #3443 done, #3474 done, #3519 done, #3077 queued, #2984 done, #3258 done, #3259 done, #3348 done, #3396 done, #976 done, #3238 done, #3341 done, #2841 held, #1558 done, #3260 done, #3288 done, #3294 done, #3297 done | e3abbca = landed ; 0827b39 = landed ; 0a26921 ! not reachable from main ; 328d838 = landed ; fac647c ~ NOT in main's tree (3/7 added lines absent, 2 removed lines reappear) ; a65feee ~ NOT in main's tree (3/7 added lines absent, 2 removed lines reappear) ; cc96c0c ~ NOT in main's tree (5/7 added lines absent, 4 removed lines reappear) ; 17cd7a2 ~ NOT in main's tree (1/3 added lines absent, 0 removed lines reappear) ; 5d3787a ! not reachable from main ; 6b70193 ! not reachable from main ; 92f8a7a ! not reachable from main ; 0976cc4 ~ NOT in main's tree (0/0 added lines absent, 2 removed lines reappear) | not-a-landing-row |
| #3284 | impl | LANDING | #2823 held, #2572 done, #2824 cancelled, #2823 held, #2572 done, #3270 done, #2783 done | 67d885d ! not reachable from main | cited-sha-not-reachable-from-main |
| #3377 | impl | LANDING | #3343 cancelled, #3343 cancelled, #3075 cancelled, #3270 done, #2452 done, #3167 done, #3345 cancelled | e3a67b1 ~ NOT in main's tree (3/37 added lines absent, 0 removed lines reappear) ; fa4e03d ~ NOT in main's tree (0/3 added lines absent, 1 removed lines reappear) ; f969142 ~ NOT in main's tree (6/6 added lines absent, 0 removed lines reappear) ; e08d1a9 ~ NOT in main's tree (4/37 added lines absent, 0 removed lines reappear) | drift-revert-shaped |
| #3410 | scribe | - | #3271 held, #3354 done, #3346 done, #3351 done, #3343 cancelled, #2744 cancelled, #3236 cancelled | 7cf5a34 ! not reachable from main ; e3abbca = landed ; bc41be1 ~ NOT in main's tree (0/12 added lines absent, 1 removed lines reappear) ; dd2583b ! not reachable from main ; defbc34 ~ NOT in main's tree (56/314 added lines absent, 8 removed lines reappear) ; 0827b39 = landed ; 0a26921 ! not reachable from main | not-a-landing-row |
| #3419 | impl | - | #3394 done, #3394 done, #3285 done, #2322 done, #2420 done, #2581 done | b8fdcc7 ~ NOT in main's tree (4/11 added lines absent, 0 removed lines reappear) ; b8fdcc7 ~ NOT in main's tree (4/11 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #3452 | impl | - | #3274 cancelled, #3274 cancelled | 53fd8c6 ! not reachable from main ; bcf1a19 ! not reachable from main | not-a-landing-row |
| #3454 | impl | - | #2425 held, #2426 held | none | not-a-landing-row |
| #3456 | impl | LANDING | #3455 cancelled, #3455 cancelled, #3423 cancelled, #3425 done, #3241 done | c304976 ~ NOT in main's tree (11/11 added lines absent, 0 removed lines reappear) ; cafee74 ~ NOT in main's tree (36/36 added lines absent, 0 removed lines reappear) ; 9de833f ~ NOT in main's tree (2/15 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #3460 | impl | LANDING | #3222 done, #3224 cancelled, #3222 done, #3237 cancelled, #3388 done, #3266 cancelled, #3333 cancelled, #3334 done, #3384 cancelled, #3270 done, #3277 done | 1d45af6 ! not reachable from main | cited-sha-not-reachable-from-main |
| #3464 | impl | - | #3374 done, #3165 held, #3263 done, #3454 held | none | not-a-landing-row |
| #3486 | impl | - | #3236 cancelled, #3412 done, #3271 held, #3338 cancelled, #3354 done, #3410 held, #3465 done, #3435 done, #2826 done, #3272 held, #3388 done, #3470 done | none | not-a-landing-row |
| #3503 | scribe | - | #3377 held, #3377 held, #3426 done, #3497 done | e08d1a9 ~ NOT in main's tree (4/37 added lines absent, 0 removed lines reappear) ; e3a67b1 ~ NOT in main's tree (3/37 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #3518 | impl | LANDING | #3481 done, #3481 done, #3075 cancelled, #3268 done, #3270 done | e492a52 = landed ; ee7cfba ! not reachable from main | cited-sha-not-reachable-from-main |
| #3535 | impl | LANDING | #3448 done, #3448 done, #3277 done | 037629d = landed ; a90c41d ~ NOT in main's tree (19/43 added lines absent, 0 removed lines reappear) | drift-lines-absent |
| #3536 | impl | - | #3435 done | none | not-a-landing-row |
| #3539 | devtools | - | #3425 done, #3360 done | 13e60bc = landed ; 18e887e = landed | not-a-landing-row |
| #3552 | impl | LANDING | #3551 done, #3551 done, #3174 done, #3277 done | 371f6be ! not reachable from main ; 351b03a ~ NOT in main's tree (83/84 added lines absent, 0 removed lines reappear) | cited-sha-not-reachable-from-main |
| #3556 | qa | - | #976 done | ba8d2d5 ~ NOT in main's tree (2/3 added lines absent, 1 removed lines reappear) ; fac647c ~ NOT in main's tree (3/7 added lines absent, 2 removed lines reappear) ; a90c41d ~ NOT in main's tree (19/43 added lines absent, 0 removed lines reappear) ; a65feee ~ NOT in main's tree (3/7 added lines absent, 2 removed lines reappear) ; cc96c0c ~ NOT in main's tree (5/7 added lines absent, 4 removed lines reappear) ; c52af79 ! not reachable from main | not-a-landing-row |
| #3557 | impl | LANDING | #3556 held, #3442 cancelled, #3556 held, #976 done, #3277 done | ba8d2d5 ~ NOT in main's tree (2/3 added lines absent, 1 removed lines reappear) ; a90c41d ~ NOT in main's tree (19/43 added lines absent, 0 removed lines reappear) ; fac647c ~ NOT in main's tree (3/7 added lines absent, 2 removed lines reappear) ; a65feee ~ NOT in main's tree (3/7 added lines absent, 2 removed lines reappear) ; cc96c0c ~ NOT in main's tree (5/7 added lines absent, 4 removed lines reappear) ; c52af79 ! not reachable from main | cited-sha-not-reachable-from-main |
| #3575 | scribe | - | #3271 held, #3272 held, #3410 held, #3370 done, #2826 done, #3192 done, #3075 cancelled | 7cf5a34 ! not reachable from main ; e3abbca = landed ; 0827b39 = landed ; 0a26921 ! not reachable from main | not-a-landing-row |
| #3603 | impl | - | #2788 held, #2788 held, #2826 done, #3517 done, #2799 done, #3308 done, #3437 done, #3313 done | 5d8c623 ! not reachable from main | not-a-landing-row |
| #3607 | impl | LANDING | #3606 done, #3606 done, #3277 done, #3605 done | 41abcaf ~ NOT in main's tree (1/102 added lines absent, 0 removed lines reappear) ; 0a38f1f = landed | near-verbatim |
| #3643 | impl | - | #3637 done, #3639 cancelled, #2220 done | e57850e = landed ; 24b7fc9 = landed | not-a-landing-row |
| #3648 | devtools | - | #3605 done, #3219 held | none | not-a-landing-row |
| #3663 | impl | LANDING | #3660 cancelled, #3660 cancelled | ca7c19c ~ NOT in main's tree (6/44 added lines absent, 0 removed lines reappear) | drift-lines-absent |
| #3673 | impl | LANDING | #3443 done | none | no-citation |
| #3681 | impl | - | #3582 cancelled, #3484 cancelled, #3490 cancelled, #3337 done, #3505 done, #3570 done, #3236 cancelled, #3486 held, #3638 done | none | not-a-landing-row |
| #3686 | impl | LANDING | #3299 done, #3379 done, #3272 held | 3fc21d2 = landed | verbatim-on-main |
| #3699 | impl | LANDING | #3174 done | 9950bc3 ~ NOT in main's tree (27/79 added lines absent, 0 removed lines reappear) ; 595b714 ~ NOT in main's tree (90/430 added lines absent, 630 removed lines reappear) ; b4e88ff ~ NOT in main's tree (30/149 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #3700 | devtools | - | #3174 done, #3665 cancelled, #3337 done, #3681 held, #3626 done, #3638 done | 595b714 ~ NOT in main's tree (90/430 added lines absent, 630 removed lines reappear) ; 072e938 ~ NOT in main's tree (41/44 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #3743 | impl | LANDING | #3669 done, #3470 done, #3741 cancelled, #3681 held, #3337 done, #1158 cancelled | 0c6fd76 ! not reachable from main | citation-unresolvable |
| #3761 | devtools | - | #3681 held, #3747 done, #3638 done | none | not-a-landing-row |
| #3786 | impl | LANDING | none | cf72678 ~ NOT in main's tree (1/63 added lines absent, 3 removed lines reappear) ; 11e87a0 ~ NOT in main's tree (42/42 added lines absent, 0 removed lines reappear) | drift-revert-shaped |
| #3796 | impl | - | #3715 done, #3774 done, #110 cancelled, #3773 done, #3765 cancelled, #3712 done, #3464 held | 595b714 ~ NOT in main's tree (90/430 added lines absent, 630 removed lines reappear) | not-a-landing-row |
| #3808 | impl | LANDING | #3741 cancelled, #123 done, #700 done, #3383 done, #3807 done | 31932a6 ~ NOT in main's tree (6/41 added lines absent, 4 removed lines reappear) ; 9fed68e ~ NOT in main's tree (0/66 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #3822 | impl | LANDING | #3819 cancelled, #3673 held, #3717 cancelled | cccccd5 = landed ; 235e163 = landed ; 7cd542a ~ NOT in main's tree (3/27 added lines absent, 0 removed lines reappear) | near-verbatim |
| #3828 | impl | LANDING | #6 done | 21fb14c ~ NOT in main's tree (3/106 added lines absent, 0 removed lines reappear) ; 595b714 ~ NOT in main's tree (90/430 added lines absent, 630 removed lines reappear) ; e8ce2a0 = landed | drift-revert-shaped |
| #3830 | impl | LANDING | #3766 done | e700d7c ~ NOT in main's tree (0/13 added lines absent, 1 removed lines reappear) ; 595b714 ~ NOT in main's tree (90/430 added lines absent, 630 removed lines reappear) | drift-revert-shaped |
| #3831 | impl | - | #3552 held | 595b714 ~ NOT in main's tree (90/430 added lines absent, 630 removed lines reappear) ; e700d7c ~ NOT in main's tree (0/13 added lines absent, 1 removed lines reappear) ; 371f6be ! not reachable from main | not-a-landing-row |
| #3832 | devtools | - | #3760 done | be40620 ! not reachable from main | not-a-landing-row |
| #3841 | impl | LANDING | #110 cancelled, #2572 done, #3174 done, #3766 done, #3795 done | 286a911 = landed ; 595b714 ~ NOT in main's tree (90/430 added lines absent, 630 removed lines reappear) ; e700d7c ~ NOT in main's tree (0/13 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #3842 | impl | LANDING | #3728 cancelled, #1604 done, #3805 done, #3688 done, #3726 cancelled | 14b61ab = landed ; dd2583b ! not reachable from main ; bc41be1 ~ NOT in main's tree (0/12 added lines absent, 1 removed lines reappear) | cited-sha-not-reachable-from-main |
| #3863 | impl | - | #3834 cancelled, #3835 cancelled, #3821 done, #3087 claimed, #3192 done, #3859 cancelled, #3747 done, #3681 held, #3570 done | none | not-a-landing-row |
| #3864 | impl | LANDING | #3860 cancelled, #3834 cancelled, #3852 done, #3861 done, #3863 held, #3765 cancelled | f84fde8 ~ NOT in main's tree (7/97 added lines absent, 3 removed lines reappear) ; 307fc06 ~ NOT in main's tree (1/77 added lines absent, 7 removed lines reappear) ; deb5d29 ~ NOT in main's tree (2/61 added lines absent, 0 removed lines reappear) | drift-revert-shaped |
| #3877 | impl | - | #3460 held, #3460 held, #3746 cancelled, #3840 done, #3192 done, #3184 done, #3222 done, #3674 done, #3535 held, #3872 cancelled, #3570 done, #3453 cancelled, #3463 cancelled, #3487 cancelled, #3502 cancelled, #3665 cancelled, #3736 done, #2712 cancelled, #3087 claimed, #3863 held | 1d45af6 ! not reachable from main ; 11e87a0 ~ NOT in main's tree (42/42 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #3891 | impl | LANDING | #3717 cancelled, #3792 done, #3766 done, #3774 done, #3773 done, #3799 done, #3796 held | 565cf2c ~ NOT in main's tree (3/33 added lines absent, 0 removed lines reappear) ; 7cd542a ~ NOT in main's tree (3/27 added lines absent, 0 removed lines reappear) ; 11e87a0 ~ NOT in main's tree (42/42 added lines absent, 0 removed lines reappear) ; 21fb14c ~ NOT in main's tree (3/106 added lines absent, 0 removed lines reappear) ; cccccd5 = landed ; 235e163 = landed ; 30f12aa = landed | drift-lines-absent |
| #3934 | devtools | LANDING | #3272 held, #3601 done, #3260 done, #2187 done | 063e23c ~ NOT in main's tree (3/23 added lines absent, 0 removed lines reappear) ; c755c96 ~ NOT in main's tree (22/71 added lines absent, 3 removed lines reappear) | drift-revert-shaped |
| #3940 | scribe | LANDING | none | 584cd2d = landed | verbatim-on-main |
| #3969 | impl | - | #3954 done, #3967 done, #2220 done, #1803 done, #148 cancelled, #3962 done, #3956 cancelled | none | not-a-landing-row |
| #3975 | impl | - | #3971 done, #3970 cancelled, #2220 done, #1803 done, #148 cancelled, #3962 done, #1786 held, #3954 done, #3956 cancelled | none | not-a-landing-row |
| #3993 | devtools | LANDING | #3122 done | d74910a ~ NOT in main's tree (0/8 added lines absent, 1 removed lines reappear) ; 7cfb44a ~ NOT in main's tree (2/64 added lines absent, 0 removed lines reappear) | drift-revert-shaped |
| #4025 | impl | LANDING | #3962 done, #4008 done | 30d51b2 = landed ; 08c5c8b = landed | verbatim-on-main |
| #4031 | devtools | LANDING | #3994 cancelled, #4029 done, #3961 done, #3836 done, #4022 done | 734e77f ~ NOT in main's tree (2/30 added lines absent, 2 removed lines reappear) ; d74910a ~ NOT in main's tree (0/8 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #4035 | devtools | LANDING | #4022 done | be663f2 ~ NOT in main's tree (1/21 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #4039 | impl | LANDING | #4036 done, #4022 done | dbf4597 = landed ; a22ee47 ~ NOT in main's tree (1/15 added lines absent, 0 removed lines reappear) | near-verbatim |
| #4041 | devtools | LANDING | #4022 done | 3bd82cb ~ NOT in main's tree (8/8 added lines absent, 4 removed lines reappear) | drift-revert-shaped |
| #4053 | devtools | LANDING | #3763 cancelled, #2390 done, #2459 done, #2412 cancelled, #3652 done, #3761 held, #3832 held, #4022 done | 78f127b ~ NOT in main's tree (0/1 added lines absent, 1 removed lines reappear) ; 6ed183a ~ NOT in main's tree (27/27 added lines absent, 0 removed lines reappear) ; 36bd518 = landed ; 3a18e95 ! not reachable from main | cited-sha-not-reachable-from-main |
| #4058 | scribe | - | #3575 held, #3605 done, #3271 held, #3272 held | none | not-a-landing-row |
| #4060 | devtools | LANDING | #3994 cancelled, #4032 cancelled, #3836 done, #4022 done | ea93655 = landed ; d74910a ~ NOT in main's tree (0/8 added lines absent, 1 removed lines reappear) ; 734e77f ~ NOT in main's tree (2/30 added lines absent, 2 removed lines reappear) ; 5e4dd4d ~ NOT in main's tree (0/20 added lines absent, 84 removed lines reappear) | drift-revert-shaped |
| #4090 | devtools | LANDING | #1558 done, #3238 done, #3341 done, #3473 done | 2b7532a ~ NOT in main's tree (1/6 added lines absent, 2 removed lines reappear) ; ec9a3f6 ~ NOT in main's tree (27/27 added lines absent, 0 removed lines reappear) ; cfb8eb4 ~ NOT in main's tree (1/3 added lines absent, 0 removed lines reappear) ; 071116a ~ NOT in main's tree (1/70 added lines absent, 12 removed lines reappear) ; 92f8a7a ! not reachable from main ; d4391a8 ~ NOT in main's tree (0/20 added lines absent, 84 removed lines reappear) | cited-sha-not-reachable-from-main |
| #4119 | devtools | LANDING | #4075 done, #2624 cancelled, #2055 cancelled, #2628 held, #1930 cancelled, #2630 done, #2104 cancelled, #3178 cancelled, #3177 cancelled, #3486 held, #3488 cancelled, #3487 cancelled, #3503 held, #3502 cancelled, #3643 held, #3639 cancelled, #3761 held, #3762 cancelled, #3969 held, #3970 cancelled, #3993 held, #3994 cancelled, #3996 cancelled, #3997 cancelled, #4025 held, #4026 done, #4031 held, #4032 cancelled, #4058 held, #4059 cancelled, #3192 done, #3460 held | 5f157f8 = landed ; 6c1e546 ~ NOT in main's tree (1/59 added lines absent, 0 removed lines reappear) ; d257f22 ~ NOT in main's tree (1/251 added lines absent, 21 removed lines reappear) | drift-revert-shaped |
| #4123 | devtools | LANDING | #4121 cancelled, #3822 held, #3272 held, #4022 done, #4068 done | 2d1a8c4 ~ NOT in main's tree (5/18 added lines absent, 0 removed lines reappear) ; 6ed183a ~ NOT in main's tree (27/27 added lines absent, 0 removed lines reappear) ; 5e4dd4d ~ NOT in main's tree (0/20 added lines absent, 84 removed lines reappear) ; d257f22 ~ NOT in main's tree (1/251 added lines absent, 21 removed lines reappear) | drift-revert-shaped |
| #4133 | impl | - | #3337 done, #3681 held, #1487 done | none | not-a-landing-row |
| #4136 | impl | LANDING | none | 5c89926 = landed ; d257f22 ~ NOT in main's tree (1/251 added lines absent, 21 removed lines reappear) | drift-revert-shaped |
| #4142 | devtools | LANDING | #3988 done, #4139 done | 51a866b ~ NOT in main's tree (2/53 added lines absent, 0 removed lines reappear) ; 5d9140f ~ NOT in main's tree (3/36 added lines absent, 1 removed lines reappear) ; d257f22 ~ NOT in main's tree (1/251 added lines absent, 21 removed lines reappear) | drift-revert-shaped |
| #4148 | scribe | - | #2637 held | none | not-a-landing-row |
| #4154 | devtools | LANDING | none | fb65ea9 ~ NOT in main's tree (1/23 added lines absent, 0 removed lines reappear) ; d257f22 ~ NOT in main's tree (1/251 added lines absent, 21 removed lines reappear) | drift-revert-shaped |
| #4157 | devtools | LANDING | #2175 done, #2213 done | f60928a = landed ; d257f22 ~ NOT in main's tree (1/251 added lines absent, 21 removed lines reappear) | drift-revert-shaped |
| #4168 | impl | LANDING | #4163 done | 7898dcc = landed ; b4bb4c7 ~ NOT in main's tree (10/10 added lines absent, 0 removed lines reappear) | drift-lines-absent |
| #4169 | scribe | LANDING | #4151 done, #4040 cancelled, #3948 done, #3314 cancelled, #3315 cancelled, #3700 held, #3436 cancelled, #3466 cancelled, #3740 cancelled | c63daf5 ~ NOT in main's tree (4/4 added lines absent, 0 removed lines reappear) ; dbf4597 = landed ; 595b714 ~ NOT in main's tree (90/430 added lines absent, 630 removed lines reappear) ; 9c3aa02 ~ NOT in main's tree (129/391 added lines absent, 719 removed lines reappear) ; 798836b ~ NOT in main's tree (44/763 added lines absent, 262 removed lines reappear) ; b4bb4c7 ~ NOT in main's tree (10/10 added lines absent, 0 removed lines reappear) | drift-revert-shaped |
| #4217 | impl | - | #994 held, #2958 held, #2549 deferred, #3236 cancelled | none | not-a-landing-row |
| #4230 | impl | LANDING | #4204 cancelled, #4170 done, #4171 done, #1911 done, #4176 done | c82be69 ~ NOT in main's tree (6/19 added lines absent, 0 removed lines reappear) ; df055d5 ~ NOT in main's tree (2/17 added lines absent, 0 removed lines reappear) | drift-lines-absent |
| #4259 | impl | LANDING | #4254 done | e0efe71 ~ NOT in main's tree (5/103 added lines absent, 9 removed lines reappear) ; b5f463f = landed ; d5f7c8d ~ NOT in main's tree (13/13 added lines absent, 0 removed lines reappear) | drift-revert-shaped |
| #4269 | qa | - | #4251 done, #1 done, #3982 done, #3985 done | none | not-a-landing-row |
| #4315 | impl | - | #4281 done, #3949 done, #3963 done, #3972 cancelled, #2626 held, #3975 held, #3969 held, #4293 done | none | not-a-landing-row |
| #4316 | impl | - | #3972 cancelled, #4277 done, #4315 held | none | not-a-landing-row |
| #4339 | impl | - | #4293 done, #723 cancelled, #724 cancelled, #4293 done, #4294 done, #4203 cancelled | none | not-a-landing-row |
| #4344 | scribe | LANDING | #3272 held | 17dc0e7 = landed | verbatim-on-main |
| #4448 | impl | - | #3552 held, #4305 done, #4370 done, #4379 done, #4416 done, #3342 done, #4371 done, #3204 cancelled | da01550 = landed ; 97bdba5 = landed | not-a-landing-row |
| #4460 | scribe | LANDING | #4271 done, #4163 done, #4257 done, #4288 done, #4307 done, #4431 done, #4447 done | 1bb9705 ~ NOT in main's tree (6/15 added lines absent, 0 removed lines reappear) | drift-lines-absent |
| #4471 | scribe | LANDING | #3075 cancelled | 5a18abd ~ NOT in main's tree (0/6 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #4513 | scribe | LANDING | #4257 done, #4288 done, #4307 done, #4389 done, #4432 done, #4390 cancelled | f19827d = landed ; d8bc976 = landed | verbatim-on-main |
| #4524 | scribe | LANDING | #4011 done, #4142 held, #4257 done, #4288 done, #4307 done, #4389 done, #4431 done, #4432 done, #4390 cancelled | bbc8e42 = landed ; f168339 ~ NOT in main's tree (1/41 added lines absent, 0 removed lines reappear) | near-verbatim |
| #4539 | scribe | LANDING | #3681 held, #3831 held | 9a7817b ~ NOT in main's tree (1/2 added lines absent, 0 removed lines reappear) ; bbc8e42 = landed | near-verbatim |
| #4540 | scribe | LANDING | #4431 done, #4257 done, #4288 done, #4307 done, #4389 done, #4447 done, #4432 done, #3831 held | f714e78 = landed | verbatim-on-main |
| #4544 | scribe | LANDING | #4257 done, #4288 done, #4307 done, #4389 done, #4431 done, #4447 done, #4469 done | 821c034 = landed ; 9e8710e ~ NOT in main's tree (28/28 added lines absent, 0 removed lines reappear) ; e6b8f33 ~ NOT in main's tree (7/7 added lines absent, 0 removed lines reappear) ; a022635 ~ NOT in main's tree (5/103 added lines absent, 9 removed lines reappear) ; 6c2e3a0 ~ NOT in main's tree (8/8 added lines absent, 0 removed lines reappear) ; e0efe71 ~ NOT in main's tree (5/103 added lines absent, 9 removed lines reappear) ; 27a6a36 ~ NOT in main's tree (6/6 added lines absent, 0 removed lines reappear) ; b5f463f = landed ; e79dd2f ~ NOT in main's tree (1/31 added lines absent, 3 removed lines reappear) | drift-revert-shaped |
| #4547 | scribe | LANDING | none | ddcf234 = landed | verbatim-on-main |
| #4595 | scribe | LANDING | #3831 held | 3d89e39 = landed | verbatim-on-main |
| #4687 | pm | - | #4671 done, #4686 done, #4675 done | 30270c0 ~ NOT in main's tree (0/1 added lines absent, 1 removed lines reappear) | not-a-landing-row |
| #4698 | scribe | LANDING | none | 16b7e03 ~ NOT in main's tree (0/24 added lines absent, 1 removed lines reappear) ; 30270c0 ~ NOT in main's tree (0/1 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #4821 | scribe | - | #3575 held, #3075 cancelled, #3186 cancelled, #4058 held, #4816 done, #4820 cancelled, #4819 cancelled | none | not-a-landing-row |
| #4830 | impl | - | #4827 done, #4827 done, #4825 deferred, #1566 done, #4828 deferred | none | not-a-landing-row |
| #4832 | impl | - | #4824 deferred, #4828 deferred, #4824 deferred, #4828 deferred | none | not-a-landing-row |
| #4834 | devtools | - | none | none | not-a-landing-row |
| #4836 | impl | - | #4824 deferred, #4831 deferred, #4824 deferred, #4831 deferred, #4830 held | none | not-a-landing-row |
| #4837 | impl | - | #4829 done, #4830 held, #4829 done, #4830 held, #4785 done | 500969f ! not reachable from main | not-a-landing-row |
| #4838 | impl | - | #4829 done, #4830 held, #4829 done, #4830 held, #4825 deferred | none | not-a-landing-row |
| #4839 | impl | - | #4825 deferred, #4831 deferred, #4825 deferred, #4831 deferred | none | not-a-landing-row |
| #4843 | impl | - | #4839 held, #4839 held | none | not-a-landing-row |
| #4848 | impl | - | #4846 done, #3570 done | none | not-a-landing-row |
| #4851 | impl | - | #4849 done, #4849 done, #4842 deferred | none | not-a-landing-row |
| #4852 | impl | - | #4847 cancelled, #4847 cancelled, #4840 deferred | none | not-a-landing-row |
| #4853 | impl | - | #4847 cancelled, #4847 cancelled, #3575 held, #4058 held, #4850 cancelled | none | not-a-landing-row |
| #4854 | devtools | - | #4852 held, #4852 held, #3539 held, #4847 cancelled, #3681 held | none | not-a-landing-row |
| #4855 | devtools | - | #4853 held, #4852 held, #4853 held, #4852 held | none | not-a-landing-row |
| #4856 | impl | - | #4840 deferred, #4842 deferred, #3350 done, #3236 cancelled, #3486 held, #3570 done, #4849 done, #4852 held | none | not-a-landing-row |
| #4857 | qa | - | #4855 held, #4855 held | none | not-a-landing-row |
| #4866 | scribe | - | #3075 cancelled, #3575 held, #4058 held, #4821 held, #4858 done, #3795 done, #4816 done, #4844 done, #4814 done, #4354 done, #4352 done, #4151 done | 3860e5d ~ NOT in main's tree (136/371 added lines absent, 0 removed lines reappear) ; 910fac7 ~ NOT in main's tree (2/53 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #4870 | devtools | - | #4817 deferred, #3601 done, #4035 held, #4822 done, #4844 done, #4849 done | 910fac7 ~ NOT in main's tree (2/53 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #4872 | devtools | - | #4849 done, #4849 done, #4842 deferred, #4840 deferred, #4852 held, #4814 done, #4822 done | e5539a5 ~ NOT in main's tree (2/7 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #4873 | devtools | - | #4849 done, #4849 done, #4872 held, #4157 held | none | not-a-landing-row |
| #4875 | impl | - | #4849 done, #4847 cancelled, #4849 done, #4864 done, #4850 cancelled, #4846 done, #4866 held, #4073 done, #4852 held, #3570 done, #3747 done, #3863 held, #4851 held, #4853 held, #4854 held, #4855 held | 3860e5d ~ NOT in main's tree (136/371 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #4877 | impl | - | #4846 done, #4850 cancelled, #4846 done, #4864 done, #3570 done, #4875 held, #4866 held, #4849 done, #4073 done | 3860e5d ~ NOT in main's tree (136/371 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #4882 | impl | - | #4849 done, #4866 held, #4852 held, #4847 cancelled, #4864 done, #4846 done, #4877 held, #4849 done, #4073 done | none | not-a-landing-row |
| #4883 | devtools | - | #4849 done, #3575 held, #4058 held, #3663 held, #3993 held, #4849 done | none | not-a-landing-row |
| #4884 | devtools | - | #4849 done, #4854 held, #4855 held, #3236 cancelled, #4853 held, #4882 held, #4883 held, #4849 done | none | not-a-landing-row |
| #4885 | architect | - | #3570 done, #4856 held, #4867 done, #4882 held | none | not-a-landing-row |
| #4886 | impl | - | #4849 done, #4839 held, #4058 held, #4849 done | 3860e5d ~ NOT in main's tree (136/371 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #4889 | scribe | - | #4886 held, #4888 done, #4151 done, #4884 held | 3860e5d ~ NOT in main's tree (136/371 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #4892 | auditor | - | #2217 held, #2655 held, #4849 done, #4884 held, #4822 done, #4814 done, #4886 held, #4890 deferred, #4891 done | 3860e5d ~ NOT in main's tree (136/371 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #4893 | devtools | - | #4849 done, #4891 done, #4886 held, #3252 done, #4872 held, #4849 done, #4884 held | 3860e5d ~ NOT in main's tree (136/371 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #4894 | impl | - | #4849 done, #4882 held, #4136 held, #4890 deferred, #4891 done, #4073 done | none | not-a-landing-row |
| #4895 | devtools | - | #4849 done, #4849 done, #4884 held, #4872 held, #4873 held, #4882 held | 3860e5d ~ NOT in main's tree (136/371 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #4896 | devtools | - | #4849 done, #4886 held, #3236 cancelled, #4849 done, #4895 held | none | not-a-landing-row |
| #4899 | devtools | - | #4891 done, #3575 held, #4157 held, #3552 held, #3539 held, #4151 done, #4858 done | none | not-a-landing-row |
| #4924 | devtools | - | #4916 done, #4919 cancelled, #4136 held, #3635 done, #3785 done, #4157 held | none | not-a-landing-row |
| #4937 | impl | - | #4930 cancelled, #4928 deferred, #4157 held, #4813 done, #3795 done, #3548 done, #3575 held, #4886 held, #4936 done | none | not-a-landing-row |
| #4950 | impl | - | #4947 deferred, #4947 deferred, #4151 done, #4944 done, #4948 done, #3796 held, #4916 done, #4136 held, #2718 held, #4931 done, #4938 deferred, #3165 held, #4716 done, #3337 done | 31d1056 ~ NOT in main's tree (138/385 added lines absent, 0 removed lines reappear) ; 24a479c ~ NOT in main's tree (10/111 added lines absent, 0 removed lines reappear) ; 44fe943 = landed ; 9beb1ae ! not reachable from main ; ddb9476 ~ NOT in main's tree (3/94 added lines absent, 1 removed lines reappear) ; f884034 ! not reachable from main | not-a-landing-row |
| #4964 | impl | - | #4957 done, #4887 deferred, #4898 done, #4952 cancelled | 8fa8f3a = landed | not-a-landing-row |
| #4971 | impl | - | #4967 done, #3575 held, #4148 held, #4154 held, #2627 held, #2628 held, #1564 held, #2546 held, #4966 done, #4968 deferred | none | not-a-landing-row |
| #4973 | impl | - | #4970 done, #4970 done, #4971 held, #3267 held, #2402 held, #2403 held, #2619 held, #1091 held, #1088 held, #3271 held | 982e2f9 ! not reachable from main ; 8eb77fa ! not reachable from main | not-a-landing-row |
| #4983 | impl | - | #4972 cancelled, #4940 done, #3236 cancelled, #4937 held, #4906 deferred, #3681 held, #3271 held, #3700 held | 605ebf0 = landed | not-a-landing-row |
| #4997 | devtools | - | #4995 done, #4996 done, #4600 done, #4605 done, #5013 done, #5007 held | 8ced6cf ~ NOT in main's tree (83/143 added lines absent, 0 removed lines reappear) ; ae15140 ~ NOT in main's tree (1/63 added lines absent, 0 removed lines reappear) ; e04ef32 = landed ; bbd6ef3 = landed ; 13dfdf6 ~ NOT in main's tree (1/63 added lines absent, 0 removed lines reappear) ; a40b730 ! not reachable from main ; 3e3d693 ! not reachable from main | not-a-landing-row |
| #5007 | impl | - | #4974 deferred, #4993 done, #5005 done, #3570 done, #3236 cancelled, #3486 held, #3747 done, #3863 held, #1582 held | none | not-a-landing-row |
| #5010 | impl | - | #4826 done, #2425 held, #2426 held, #3454 held, #3993 held, #4031 held, #4879 done, #4849 done | none | not-a-landing-row |
| #5028 | impl | - | #4973 held, #4964 held, #4970 done, #5007 held, #4887 deferred | none | not-a-landing-row |
| #5030 | impl | - | #5001 deferred, #5004 deferred, #4997 held, #1967 held, #3236 cancelled, #3337 done, #4035 held | none | not-a-landing-row |
| #5059 | pm | - | #4955 done | none | not-a-landing-row |
| #5087 | devtools | - | #5067 cancelled, #5083 done, #4955 done, #5071 done, #5079 done, #4966 done, #5065 deferred, #4997 held | 3ac59b5 ~ NOT in main's tree (2/261 added lines absent, 6 removed lines reappear) | not-a-landing-row |
| #5097 | devtools | - | #5096 deferred, #4955 done, #5083 done, #5090 done, #5065 deferred, #4997 held | none | not-a-landing-row |
| #5098 | devtools | - | #5096 deferred, #5093 deferred, #5065 deferred, #4997 held | none | not-a-landing-row |
| #5099 | devtools | - | #5095 deferred, #5096 deferred, #5065 deferred, #4997 held | 2026110 ! not reachable from main ; a65ba43 = landed | not-a-landing-row |
| #5102 | impl | - | #5096 deferred, #5080 cancelled, #5096 deferred, #1781 held, #5071 done, #5065 deferred, #4997 held | e3118fa ~ NOT in main's tree (4/282 added lines absent, 13 removed lines reappear) | not-a-landing-row |
| #5108 | lead | - | #5090 done, #5103 deferred, #5094 done, #5095 deferred, #5096 deferred | 4c92d55 = landed | not-a-landing-row |
| #5116 | devtools | - | #5095 deferred, #5096 deferred | bb2a399 ~ NOT in main's tree (1/2 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5152 | architect | - | #4829 done, #5147 deferred, #5148 done, #4833 cancelled, #4829 done, #5147 deferred, #5148 done, #269 cancelled, #5146 deferred, #5090 done | 96f810f = landed | not-a-landing-row |
| #5153 | devtools | - | #5146 deferred, #5095 deferred, #5136 cancelled, #5146 deferred, #5095 deferred, #5131 done, #269 cancelled, #5096 deferred, #5143 deferred, #5144 deferred, #5112 deferred | none | not-a-landing-row |
| #5157 | pm | - | none | none | not-a-landing-row |
| #5177 | impl | - | #4973 held, #4970 done, #5028 held, #4981 done, #5168 done | none | not-a-landing-row |
| #5183 | pm | - | #4829 done, #5171 done, #5132 deferred, #5133 cancelled, #5163 deferred, #5162 done, #4827 done, #5147 deferred, #3337 done | 3860e5d ~ NOT in main's tree (136/371 added lines absent, 0 removed lines reappear) ; 96f810f = landed ; a8d770f ~ NOT in main's tree (0/54 added lines absent, 3 removed lines reappear) ; 294e180 = landed ; fca4e98 ~ NOT in main's tree (96/567 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5189 | lead | - | #4967 done, #2783 done | f80efec ~ NOT in main's tree (1/119 added lines absent, 0 removed lines reappear) ; fca4e98 ~ NOT in main's tree (96/567 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5190 | pm | - | #4967 done | none | not-a-landing-row |
| #5191 | pm | - | #4846 done, #4850 cancelled, #3575 held | none | not-a-landing-row |
| #5192 | pm | - | #4967 done, #2783 done | f80efec ~ NOT in main's tree (1/119 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5206 | pm | - | #4973 held, #5166 done | none | not-a-landing-row |
| #5212 | impl | - | #5206 held | none | not-a-landing-row |
| #5215 | impl | - | #5211 done, #5211 done | none | not-a-landing-row |
| #5218 | impl | - | none | none | not-a-landing-row |
| #5219 | impl | - | #5218 held | none | not-a-landing-row |
| #5221 | impl | - | #5219 held | none | not-a-landing-row |
| #5225 | pm | - | #5222 cancelled, #5219 held | none | not-a-landing-row |
| #5226 | impl | - | none | none | not-a-landing-row |
| #5228 | impl | - | none | none | not-a-landing-row |
| #5234 | scribe | - | none | none | not-a-landing-row |
| #5235 | scribe | - | none | none | not-a-landing-row |
| #5237 | impl | - | #3165 held, #5175 done, #4035 held, #3337 done, #3575 held, #1209 done, #4151 done, #5161 done, #5184 done | e173f39 ! not reachable from main | not-a-landing-row |
| #5239 | impl | - | #5172 done, #5187 done, #3486 held, #3570 done, #3410 held, #5236 deferred, #4119 held, #5171 done, #5162 done, #5134 done, #5186 done, #3747 done, #3863 held, #3575 held, #4829 done, #3337 done, #4148 held, #4154 held, #5133 cancelled, #5163 deferred | 294e180 = landed ; 96f810f = landed ; a8d770f ~ NOT in main's tree (0/54 added lines absent, 3 removed lines reappear) ; fca4e98 ~ NOT in main's tree (96/567 added lines absent, 0 removed lines reappear) ; 2115dec ~ NOT in main's tree (126/535 added lines absent, 2 removed lines reappear) | not-a-landing-row |
| #5240 | impl | - | #3337 done, #3673 held, #3686 held, #3272 held, #5187 done, #3575 held | 96f810f = landed ; a8d770f ~ NOT in main's tree (0/54 added lines absent, 3 removed lines reappear) ; 294e180 = landed ; 2115dec ~ NOT in main's tree (126/535 added lines absent, 2 removed lines reappear) | not-a-landing-row |
| #5246 | impl | LANDING | #3337 done, #3075 cancelled, #3186 cancelled, #4073 done, #3377 held, #3481 done, #3518 held, #4148 held, #4154 held, #5241 done | 6dc7100 ~ NOT in main's tree (2/45 added lines absent, 0 removed lines reappear) | near-verbatim |
| #5247 | impl | - | #4850 cancelled, #3486 held, #3570 done, #3410 held, #5236 deferred, #5239 held, #5237 held | 6dc7100 ~ NOT in main's tree (2/45 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5248 | devtools | - | #1582 held, #5184 done, #5173 done, #5187 done, #5172 done, #5188 done, #4850 cancelled, #5236 deferred, #5239 held, #5246 held, #5247 held, #4210 cancelled, #3271 held, #3236 cancelled, #5241 done, #3488 cancelled, #3570 done | none | not-a-landing-row |
| #5255 | pm | - | #5230 cancelled, #5001 deferred, #5030 held, #5214 deferred, #5228 held, #5227 deferred, #5243 done, #5233 cancelled, #5224 deferred, #5225 held | 46c28b7 ~ NOT in main's tree (35/96 added lines absent, 0 removed lines reappear) ; df91cc2 ~ NOT in main's tree (29/90 added lines absent, 0 removed lines reappear) ; ffbd0e1 ~ NOT in main's tree (40/133 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5262 | impl | LANDING | #5194 done, #3252 done, #3575 held | none | no-citation |
| #5265 | impl | - | #3077 queued, #5263 cancelled, #5194 done, #5262 held | none | not-a-landing-row |
| #5281 | lead | - | #5262 held, #5265 held, #5133 cancelled, #5163 deferred, #3575 held, #4148 held, #4154 held, #5195 done | none | not-a-landing-row |
| #5287 | pm | - | #5273 cancelled, #5278 cancelled, #5001 deferred, #5030 held, #3570 done, #5277 done, #3271 held, #4119 held, #2175 done, #2213 done, #2217 held, #5270 done, #5285 done | 2026110 ! not reachable from main | not-a-landing-row |
| #5291 | impl | - | #5201 done, #3969 held, #3975 held, #5262 held, #4148 held, #4154 held, #5281 held | none | not-a-landing-row |
| #5293 | security | - | #5198 done, #3486 held, #3410 held, #5243 done, #5227 deferred | none | not-a-landing-row |
| #5295 | lead | - | #1135 done, #5202 done, #3486 held, #3570 done, #5281 held, #5133 cancelled, #5163 deferred, #5156 deferred, #5192 held, #5194 done, #5262 held, #3236 cancelled | none | not-a-landing-row |
| #5296 | pm | - | #5208 done, #5211 done | 6dc1a42 ~ NOT in main's tree (1/11 added lines absent, 0 removed lines reappear) ; 0bce3ed ~ NOT in main's tree (4/76 added lines absent, 2 removed lines reappear) | not-a-landing-row |
| #5304 | scribe | - | #5202 done, #5156 deferred, #5192 held, #5295 held | none | not-a-landing-row |
| #5315 | qa | - | #5278 cancelled, #5285 done, #3747 done, #3863 held, #5280 cancelled, #5302 deferred | none | not-a-landing-row |
| #5319 | pm | - | #5318 cancelled, #5243 done, #5277 done, #5293 held | none | not-a-landing-row |
| #5346 | impl | LANDING | #5094 done, #5250 deferred, #1492 held, #4142 held, #3747 done, #3863 held | 6108e04 ~ NOT in main's tree (13/180 added lines absent, 3 removed lines reappear) ; 46c28b7 ~ NOT in main's tree (35/96 added lines absent, 0 removed lines reappear) ; e173f39 ! not reachable from main ; 211e912 ~ NOT in main's tree (60/60 added lines absent, 0 removed lines reappear) | cited-sha-not-reachable-from-main |
| #5352 | impl | LANDING | #5350 deferred, #5350 deferred, #5209 done, #3337 done, #3165 held, #5237 held, #5196 deferred, #5113 deferred, #3236 cancelled, #3486 held, #5161 done, #5175 done, #5251 done, #5217 done | affa172 ~ NOT in main's tree (5/43 added lines absent, 0 removed lines reappear) ; 46c28b7 ~ NOT in main's tree (35/96 added lines absent, 0 removed lines reappear) ; e173f39 ! not reachable from main | cited-sha-not-reachable-from-main |
| #5360 | impl | LANDING | #5358 deferred, #5358 deferred, #4922 done, #4391 done, #3128 done, #3337 done, #5343 deferred, #4829 done, #2623 cancelled, #2624 cancelled, #2056 cancelled, #2040 done | f9b754e = landed ; 2115dec ~ NOT in main's tree (126/535 added lines absent, 2 removed lines reappear) | drift-revert-shaped |
| #5364 | pm | - | #5363 done, #5362 deferred, #5212 held, #5275 done | 2e59dd8 ~ NOT in main's tree (6/6 added lines absent, 5 removed lines reappear) | not-a-landing-row |
| #5369 | lead | - | #5325 done, #5367 done, #5193 done | bb013c5 = landed ; 1d7a4c9 = landed ; f80efec ~ NOT in main's tree (1/119 added lines absent, 0 removed lines reappear) ; 1cac166 ~ NOT in main's tree (2/53 added lines absent, 0 removed lines reappear) ; baab6ed ~ NOT in main's tree (2/53 added lines absent, 0 removed lines reappear) ; 51f3549 ~ NOT in main's tree (37/65 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5374 | lead | - | #5275 done, #5370 done, #5371 done, #5372 done, #3087 claimed, #3877 held, #3460 held, #5258 deferred | a342b0d ~ NOT in main's tree (1/55 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5378 | impl | - | #5261 done, #5030 held, #5001 deferred, #5214 deferred | none | not-a-landing-row |
| #5380 | lead | - | #5261 done, #5255 held, #5030 held, #5001 deferred, #3165 held, #5237 held, #5377 deferred, #5378 held, #5214 deferred, #5224 deferred, #5225 held, #5158 deferred, #5181 deferred, #5157 held, #5180 deferred | 2a8ff99 ~ NOT in main's tree (2/31 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5381 | impl | LANDING | #5172 done, #5266 done, #3236 cancelled, #3486 held, #4073 done, #3337 done, #5132 deferred, #5133 cancelled, #3747 done, #3863 held | 96f810f = landed ; a8d770f ~ NOT in main's tree (0/54 added lines absent, 3 removed lines reappear) ; 294e180 = landed ; 2115dec ~ NOT in main's tree (126/535 added lines absent, 2 removed lines reappear) | drift-revert-shaped |
| #5385 | security | - | #5147 deferred, #5266 done, #5172 done | 96f810f = landed ; a8d770f ~ NOT in main's tree (0/54 added lines absent, 3 removed lines reappear) | not-a-landing-row |
| #5394 | impl | - | none | none | not-a-landing-row |
| #5406 | impl | LANDING | #5403 cancelled, #5285 done, #3236 cancelled, #3486 held, #5399 deferred, #5401 deferred, #5404 done, #3337 done, #5227 deferred, #5243 done, #5030 held, #5001 deferred, #5214 deferred | 6983ed1 ~ NOT in main's tree (6/43 added lines absent, 0 removed lines reappear) ; 4cee428 ! not reachable from main ; 467d9cf ! not reachable from main ; 46c28b7 ~ NOT in main's tree (35/96 added lines absent, 0 removed lines reappear) | citation-unresolvable |
| #5412 | impl | - | #5320 deferred, #5320 deferred, #5277 done | none | not-a-landing-row |
| #5414 | impl | - | #5274 done, #5273 cancelled, #3570 done, #3236 cancelled, #3486 held, #5278 cancelled | none | not-a-landing-row |
| #5423 | security | - | #5243 done, #5293 held, #5198 done, #3486 held, #5294 done, #5243 done, #295 cancelled, #5227 deferred, #3863 held, #3747 done | none | not-a-landing-row |
| #5426 | impl | LANDING | #5211 done, #5296 held, #5208 done, #3075 cancelled, #3077 queued, #4073 done | 6dc1a42 ~ NOT in main's tree (1/11 added lines absent, 0 removed lines reappear) ; 0bce3ed ~ NOT in main's tree (4/76 added lines absent, 2 removed lines reappear) | drift-revert-shaped |
| #5429 | pm | - | #5424 deferred, #5424 deferred, #5296 held, #5211 done, #5208 done, #3075 cancelled, #3186 cancelled, #3077 queued | none | not-a-landing-row |
| #5431 | impl | LANDING | #5424 deferred, #5424 deferred, #5425 cancelled, #5211 done, #5427 deferred | none | no-citation |
| #5432 | qa | - | #5427 deferred, #5427 deferred | none | not-a-landing-row |
| #5434 | devtools | - | #5303 done, #3235 held | e29ddb8 ! not reachable from main | not-a-landing-row |
| #5436 | impl | - | #3018 held, #3018 held, #5305 done, #5248 held, #3570 done, #3236 cancelled, #5425 cancelled, #5431 held, #1135 done, #5295 held | none | not-a-landing-row |
| #5454 | lead | - | #5452 deferred, #5321 done, #5452 deferred | none | not-a-landing-row |
| #5466 | impl | - | #5463 deferred, #5463 deferred, #5337 done, #5269 done, #5460 done | e160ba3 = landed ; 96f810f = landed ; a8d770f ~ NOT in main's tree (0/54 added lines absent, 3 removed lines reappear) ; 7e5afe3 ~ NOT in main's tree (22/97 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5472 | pm | - | #5345 done, #5349 done, #5467 cancelled, #5468 deferred, #3575 held, #3743 held | none | not-a-landing-row |
| #5483 | impl | - | #5482 deferred, #5345 done, #5482 deferred, #5478 deferred, #5481 deferred, #5479 deferred | none | not-a-landing-row |
| #5485 | qa | - | #5481 deferred, #5345 done, #5481 deferred | none | not-a-landing-row |
| #5486 | qa | - | #5483 held, #5482 deferred, #5345 done, #5483 held, #5482 deferred | none | not-a-landing-row |
| #5495 | qa | - | #5492 deferred, #5492 deferred, #5227 deferred | ff2d3f2 ~ NOT in main's tree (91/334 added lines absent, 0 removed lines reappear) ; 46c28b7 ~ NOT in main's tree (35/96 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5496 | scribe | LANDING | #5492 deferred, #5492 deferred, #5495 held, #5242 done | none | no-citation |
| #5499 | devtools | - | #5325 done, #5408 deferred, #5492 deferred | none | not-a-landing-row |
| #5506 | lead | - | #5363 done, #5504 deferred | none | not-a-landing-row |
| #5512 | impl | - | #3486 held, #3486 held, #3236 cancelled, #3570 done, #5386 done, #5001 deferred | none | not-a-landing-row |
| #5517 | lead | - | #5367 done | none | not-a-landing-row |
| #5520 | scribe | - | #3252 done, #3236 cancelled, #3486 held, #5233 cancelled, #5515 queued, #3075 cancelled, #3186 cancelled, #3252 done, #3747 done | none | not-a-landing-row |
| #5531 | impl | - | #5479 deferred, #5483 held, #3743 held, #3019 held, #5215 held, #5373 done | c43ec1f ~ NOT in main's tree (126/317 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5552 | qa | - | #5548 deferred, #5548 deferred | none | not-a-landing-row |
| #5557 | devtools | - | #3252 done, #5373 done, #2932 held, #3452 held | none | not-a-landing-row |
| #5562 | impl | - | #5306 done, #5307 cancelled, #5309 deferred, #5310 done, #2402 held, #2403 held, #5215 held, #3410 held, #5390 done, #8651 absent | 2ec55d8 ! not reachable from main | not-a-landing-row |
| #5563 | devtools | - | #5308 deferred, #3410 held, #5390 done, #5310 done, #5307 cancelled | none | not-a-landing-row |
| #5564 | devtools | - | #5317 deferred, #5316 deferred, #3410 held, #5390 done, #5307 cancelled, #5308 deferred | none | not-a-landing-row |
| #5568 | scribe | - | #3075 cancelled, #5456 done, #5452 deferred, #5454 held, #3575 held | none | not-a-landing-row |
| #5569 | impl | LANDING | #5306 done, #5309 deferred, #5310 done, #5306 done, #5309 deferred, #5310 done, #5395 done, #5390 done, #3410 held, #3488 cancelled, #8651 absent, #3271 held, #3272 held, #3337 done, #4073 done, #5307 cancelled, #5277 done, #5320 deferred | 2ec55d8 ! not reachable from main | citation-unresolvable |
| #5659 | impl | - | #5488 done, #5658 done, #3252 done | none | not-a-landing-row |
| #5660 | qa | - | #5655 cancelled | ade0691 ! not reachable from main | not-a-landing-row |
| #5662 | pm | - | #5630 done, #5635 done, #5438 cancelled, #5488 done, #5398 done, #5569 held, #5271 done, #5306 done, #5309 deferred, #5310 done | none | not-a-landing-row |
| #5681 | pm | - | #5630 done, #5631 done, #3272 held, #3337 done, #5611 done, #5624 done, #5671 done, #3570 done, #5669 done | b66cce9 = landed | not-a-landing-row |
| #5685 | pm | LANDING | #5595 done, #5638 deferred, #3075 cancelled, #3186 cancelled, #3575 held, #5598 deferred, #5594 deferred | 44dc5cb ~ NOT in main's tree (14/27 added lines absent, 0 removed lines reappear) ; c047b76 ~ NOT in main's tree (119/358 added lines absent, 0 removed lines reappear) | drift-lines-absent |
| #5733 | lead | - | #1135 done, #4217 held, #994 held | none | not-a-landing-row |
| #5734 | scribe | - | #3271 held, #5605 cancelled, #5655 cancelled, #5705 cancelled, #5648 done, #5714 cancelled, #5721 done, #4119 held, #3747 done | none | not-a-landing-row |
| #5738 | qa | - | #4993 done, #4993 done, #4073 done | none | not-a-landing-row |
| #5753 | devtools | - | #4835 done | none | not-a-landing-row |
| #5754 | impl | LANDING | #5751 done, #4835 done, #5751 done, #4073 done, #3557 held, #5753 held | 9a2c0d7 ~ NOT in main's tree (8/33 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #5765 | impl | LANDING | #5758 done, #5663 done, #5758 done, #5657 deferred, #5699 deferred, #5647 deferred | none | no-citation |
| #5791 | impl | LANDING | #5787 deferred, #5757 done, #5787 deferred, #5757 done, #5759 cancelled, #4073 done, #5776 cancelled, #5750 done, #5761 done, #5764 done | d37bef3 ~ NOT in main's tree (1/21 added lines absent, 0 removed lines reappear) ; 8fb668e = landed | near-verbatim |
| #5796 | impl | - | #5791 held, #5750 done, #5791 held, #5750 done, #5608 cancelled, #5776 cancelled, #5787 deferred, #5789 done | 4efce13 = landed | not-a-landing-row |
| #5816 | impl | LANDING | #5815 cancelled, #5707 done, #5815 cancelled, #4073 done, #2288 held | f458a12 = landed ; a7fc575 ~ NOT in main's tree (70/251 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #5817 | impl | LANDING | #5815 cancelled, #5707 done, #5815 cancelled, #4073 done, #2288 held | f458a12 = landed ; a7fc575 ~ NOT in main's tree (70/251 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #5818 | devtools | - | #4210 cancelled, #4978 deferred, #5652 deferred, #5556 deferred, #4928 deferred, #2712 cancelled, #3043 held | none | not-a-landing-row |
| #5821 | impl | - | #5785 deferred, #5785 deferred | none | not-a-landing-row |
| #5826 | impl | LANDING | #5824 done, #5740 done, #5824 done, #3075 cancelled, #5741 done | 29a1a98 = landed ; d37bef3 ~ NOT in main's tree (1/21 added lines absent, 0 removed lines reappear) | near-verbatim |
| #5853 | impl | - | #5851 done, #5851 done, #5785 deferred, #5821 held | none | not-a-landing-row |
| #5862 | impl | - | none | none | not-a-landing-row |
| #5864 | qa | - | #5861 deferred | none | not-a-landing-row |
| #5866 | lead | - | #5861 deferred, #2402 held, #2403 held, #4025 held, #3777 done, #2927 held, #5861 deferred | none | not-a-landing-row |
| #5871 | devtools | - | #5870 done, #3539 held, #3575 held, #4058 held, #5870 done | none | not-a-landing-row |
| #5873 | devtools | - | #5777 done, #5779 done, #5777 done, #3539 held, #3575 held, #4058 held, #976 done, #4102 done, #3557 held | d5c268f ~ NOT in main's tree (21/110 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5883 | pm | - | #4973 held, #5331 cancelled, #4973 held, #5591 done, #5037 cancelled, #5049 done | none | not-a-landing-row |
| #5884 | pm | - | #5335 deferred, #5336 cancelled, #5335 deferred, #5591 done, #5334 deferred | none | not-a-landing-row |
| #5885 | pm | - | #3377 held, #5322 done, #3377 held, #5591 done, #3075 cancelled | 0b7997a ~ NOT in main's tree (2/17 added lines absent, 0 removed lines reappear) | not-a-landing-row |
| #5900 | impl | LANDING | #5897 deferred, #5897 deferred, #5780 done, #3271 held, #3686 held, #4136 held, #4102 done, #3828 held, #3168 held, #976 done, #3557 held | 9a2c0d7 ~ NOT in main's tree (8/33 added lines absent, 1 removed lines reappear) ; 9a2c0d7 ~ NOT in main's tree (8/33 added lines absent, 1 removed lines reappear) | drift-revert-shaped |
| #5912 | scribe | - | #5851 done, #3075 cancelled, #5785 deferred, #5821 held, #5488 done, #3786 held, #2402 held, #2403 held | 4efce13 = landed | not-a-landing-row |
| #5918 | pm | - | #5741 done, #5908 done, #2712 cancelled, #2673 done | 012836e = landed | not-a-landing-row |
| #5927 | pm | - | #5438 cancelled, #5918 held, #5630 done, #5534 deferred | none | not-a-landing-row |
| #5953 | devtools | - | #5947 deferred, #5945 cancelled, #5945 cancelled, #5947 deferred | 2ec555d ! not reachable from main ; 2ec55d8 ! not reachable from main | not-a-landing-row |
| #5954 | devtools | - | #5947 deferred, #5945 cancelled, #5945 cancelled, #5947 deferred | 2ec555d ! not reachable from main ; 2ec55d8 ! not reachable from main | not-a-landing-row |
| #5974 | scribe | - | #5970 deferred, #5970 deferred | none | not-a-landing-row |
| #5979 | devtools | - | #5976 done, #5976 done | none | not-a-landing-row |
| #5988 | devtools | - | #5986 cancelled, #5986 cancelled, #3747 done, #3863 held, #3539 held | none | not-a-landing-row |
| #5998 | impl | - | #5996 done, #5996 done, #5839 deferred | none | not-a-landing-row |
| #6048 | pm | - | #6027 done, #6024 deferred | 6d25ee8 = landed ; 09a94b4 ~ NOT in main's tree (32/117 added lines absent, 1 removed lines reappear) | not-a-landing-row |
| #6156 | pm | LANDING | #6121 done, #6114 done, #6116 done | 966a4d4 = landed | verbatim-on-main |
| #6186 | pm | - | #2712 cancelled, #5438 cancelled, #5740 done, #6 done | none | not-a-landing-row |
| #6191 | impl | - | #1135 done, #2962 done, #1120 done | none | not-a-landing-row |
| #6198 | devtools | - | #2098 done, #2733 held, #2963 held, #3795 done | none | not-a-landing-row |
| #6209 | scribe | - | #6201 done, #3075 cancelled, #3252 done, #3795 done | 6b21e36 = landed | not-a-landing-row |
| #6213 | impl | - | #6211 done, #6211 done | none | not-a-landing-row |
| #6239 | pm | - | none | none | not-a-landing-row |
| #6249 | pm | - | #6125 done, #6127 done | none | not-a-landing-row |
| #6272 | pm | - | #6116 done, #6128 done, #5939 cancelled, #6143 done, #6114 done, #6116 done, #6118 done, #6123 cancelled, #6148 done, #6131 done, #6128 done, #6077 done, #6080 done | dd2583b ! not reachable from main | not-a-landing-row |
| #6285 | pm | - | #6225 done, #6185 done, #6227 done, #5296 held, #5681 held, #6275 done, #6283 done | none | not-a-landing-row |
| #6337 | pm | - | #5933 cancelled, #6114 done, #6116 done, #6118 done, #6122 cancelled, #6123 cancelled, #6132 done, #5071 done | none | not-a-landing-row |
| #6408 | pm | - | #6150 done, #5568 held | d5a0747 = landed | not-a-landing-row |
| #6514 | pm | - | #1978 held, #6391 done, #6393 done, #6402 done, #6187 cancelled, #6186 held, #6032 cancelled, #5992 deferred, #3087 claimed | none | not-a-landing-row |
| #6613 | devtools | - | #6425 queued, #6425 queued, #6426 done | none | not-a-landing-row |
| #6650 | devtools | - | #6227 done, #6227 done, #6557 done, #1158 cancelled | none | not-a-landing-row |
| #6815 | pm | - | #6201 done, #3795 done, #6200 done, #6061 done, #6196 done, #6202 done | 75ca6e7 ! not reachable from main ; dd30101 ! not reachable from main | not-a-landing-row |
| #6818 | pm | - | #6665 done, #5093 deferred, #5282 done | none | not-a-landing-row |
| #6863 | pm | - | #6332 done, #6333 done, #6332 done, #6322 done | 35001c3 = landed | not-a-landing-row |
| #6903 | pm | - | #6556 done | none | not-a-landing-row |
| #7062 | pm | - | #6926 done, #5296 held, #6285 held | dab6245 ! not reachable from main ; 4c111c1 ~ NOT in main's tree (16/178 added lines absent, 3 removed lines reappear) ; cea5228 ! not reachable from main | not-a-landing-row |
| #7091 | scribe | - | #4148 held, #6800 done | none | not-a-landing-row |
| #7098 | devtools | - | #6801 queued, #7097 done, #7097 done, #6801 queued, #3539 held, #3552 held, #3831 held | none | not-a-landing-row |
| #7100 | lead | - | #6205 done, #6238 done | c6b0bed ! not reachable from main ; e965e2b ! not reachable from main ; 522d806 ! not reachable from main | not-a-landing-row |
| #7106 | pm | - | #7105 done, #7105 done, #5953 held, #5947 deferred, #5945 cancelled, #6405 queued, #6399 queued, #5486 held, #5482 deferred, #3575 held | none | not-a-landing-row |
| #7108 | pm | - | #6376 done, #3539 held | 5cf9927 ! not reachable from main | not-a-landing-row |

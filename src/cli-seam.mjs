// src/cli-seam.mjs — install the signal seam BEFORE the CLI's heavy imports resolve.
//
// WHY THIS FILE EXISTS. In ESM a module body cannot run before its own imports are
// resolved, so `installSignalHandlers(...)` written anywhere in cli.mjs can only run
// after the whole import graph (pi-durable, pi-ai, chord, our own src/*) has loaded —
// measured at ~300-400 ms on this box (Linux, Fedora Linux 45, node v24.22.1). A Ctrl-C
// inside that window is node's DEFAULT disposition: the process dies with no report line
// and no exit code a caller can branch on. The earliest a handler can exist is inside the
// FIRST imported module, so cli.mjs imports this tiny module first.
//
// The grace here is the verb default (1,500 ms). cli.mjs later calls installSignalHandlers
// again with the serve/run --watch grace; src/signals.mjs treats a second call as an
// upgrade of the grace, never a removal of the handler.
import { installSignalHandlers } from "./signals.mjs";

installSignalHandlers({ gracefulMs: 1500 });

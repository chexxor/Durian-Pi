# Complete check for #3729 — active-partial golden verification

## Reading: demo/__golden__/streaming-80.txt

The golden DOES still show the streaming section with a live partial:

  ── streaming: impl ──
  ● reading the queue and claiming #624

It also shows the full transcript beneath it. This is not a blank frame — it has the
streaming section header, the bullet point with the live partial text, and the conversation
transcript. This is the correct active-partial rendering.

Similarly, conversation-streaming-80.txt shows:

  ── streaming ──
  ● reading the queue and claiming #624

Both goldens confirm the streaming section is present when there is a partial to render.

## Demo still exercises both paths:

- Idle state: seats-80 / seats-48 call enderTui({ ...base, turns: fixture, width: N }) with no partials → idle goldens
- Active-partial state: streaming-80 / conversation-streaming-80 call enderTui({ ...base, turns: fixture, partials: [implStream], partial: implStream, width: N }) → streaming goldens

Both states are still driven by the demo. Running 
ode demo/tui-golden.test.mjs exits 0 with all 60 frames matching goldens, including both streaming-80 variants.

## Conclusion:

The fix is NOT an over-removal. Idle frames correctly omit the streaming section;
active-partial frames correctly show it. Both paths are exercised by the demo.

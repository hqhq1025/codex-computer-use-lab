# V5 Dynamic Edge Cases And Root Causes

## Scope

This chapter records the issues found while extending the production synthetic
matrix beyond the V4 baseline. Every real action remained scoped to
`com.openai.codex.cualab`.

## Multi-window focused-state boundary

Issue:

```text
get_app_state was previously treated as an app-wide tree.
```

Evidence:

- main screenshot: `886 x 768`;
- secondary screenshot: `520 x 392`;
- secondary element indices restart at `2`, `3`, and `11`;
- closing the secondary window returns the main tree and screenshot.

Root cause:

```text
get_app_state(app) returns the currently focused app window,
not a merged tree of every app window.
```

Fix:

- the synthetic secondary window has its own marker and bounded controls;
- runner validation accepts the fixed secondary-window marker;
- scenarios re-resolve indices after every focus/window transition.

Fixture:

```text
fixtures/real-cua/runner-multi-window-result-v2.json
```

## AppKit point versus screenshot pixel mismatch

Issue:

```text
window movement initially returned success but did not move the window.
```

Evidence:

```text
AppKit window: 1025 x 889 points
Sky screenshot: 886 x 768 pixels
```

Directly using AppKit local points as action coordinates missed the custom
window handle.

Root cause:

```text
Sky action coordinates are app-window screenshot pixels.
The screenshot may be scaled relative to the AppKit outer window.
```

Fix:

```text
pixel.x = local.x * screenshot.width  / window.width
pixel.y = local.y * screenshot.height / window.height
```

The test app now records move and resize geometry. The runner scales all
oracle-derived coordinate and drag points against the immediately preceding
screenshot.

## Cross-display window movement

Evidence:

```text
six bounded left drags
secondary screen reached on the final left step
six bounded right drags
primary screen restored on the final right step
```

Each drag used a fresh full observation and the current geometry-to-screenshot
mapping. No coordinate was replayed after a move.

Fixture:

```text
fixtures/real-cua/runner-final-semantic-matrix-v3.json
```

`runner-window-move-cross-display-result-v3.json` remains the historical
four-step capture from the earlier App binary.

## Observation and element positioning can mutate window geometry

Issue:

```text
Repeated scenario resets occasionally completed on the secondary display even
though the reset handler synchronously restored the primary-screen frame.
```

Evidence:

- the failure moved between scenario 2 and scenario 4 across clean runs;
- the failed oracle showed a 1025-point-wide window on the secondary display;
- `lastAction` changed to `scroll` after the reset handler had written
  `reset`;
- 20 ms sampling observed multiple resize waves around one element-index
  click;
- a first `get_app_state` on a freshly launched app also repositioned the
  window before any explicit lab action.

Root cause:

The observation/action pipeline is not geometrically passive. Native target
positioning and visibility work can schedule AppKit window, resize, and scroll
effects that outlive the button action promise. A one-shot or single delayed
reset races those effects.

Fix:

- reset increments a restore generation;
- the app restores primary geometry at 150, 350, 650, and 1000 ms;
- callbacks from an older reset exit when the generation changes;
- the runner records and applies a bounded 1300 ms reset settle before its
  post-state observation;
- window movement begins only after that settle has expired.

Final evidence:

```text
fixtures/real-cua/runner-final-semantic-matrix-v4.json

21 scenarios
66 steps
192 approval-store checks
21/21 passed
```

## Stale element negative cases

Missing target:

```text
code: -10005
message: The element ID is no longer valid...
```

Ambiguous refetch:

```text
code: -10005
message: ...multiple elements were found that match the criteria...
```

In both cases:

- action did not execute;
- target count remained zero;
- decoy count remained zero.

Root cause:

Native refetch correctly fails closed, but specific accessibility failures are
collapsed into `unknownError -10005` instead of a specific IPC error code.

Fixtures:

```text
fixtures/real-cua/runner-stale-element-missing-result.json
fixtures/real-cua/runner-stale-element-ambiguous-result.json
```

## Coordinate revision is not protocol-bound

Issue:

```text
Can the service reject a coordinate produced by an old screenshot?
```

Experiment:

```text
capture old target point (426, 322)
swap target and decoy
do not get a new state
click old point
```

Result:

```text
old action executed
target count = 0
decoy count = 1
```

A fresh observation produced `(701, 322)` and clicked the new target.

Root cause:

The mac action wire contains coordinates but no screenshot ID or revision
token. The service cannot prove which screenshot produced the point.

Required workflow:

- coordinate actions must use the immediately preceding observation;
- never retry a coordinate after layout, window, display, focus, or user input;
- prefer element identity whenever possible.

Fixture:

```text
fixtures/real-cua/runner-coordinate-stale-revision-result.json
```

## Sky timeout does not cancel native work

Issue:

```text
What happens after a local Sky request timeout?
```

Hermetic result:

- timeout starts only when the request reaches dispatch;
- queue waiting and service startup are outside the request timeout budget;
- no cancel frame is sent;
- socket remains open;
- the next queued request dispatches and succeeds;
- the first response can arrive late and is silently ignored.

Risk:

A timed-out action may continue in the service. A caller must not assume that
local timeout means no side effect occurred.

V9 production confirmation:

```text
target:
  com.openai.codex.cualab

configured timeout:
  1 ms

client rejection:
  24 ms

late button click:
  692 ms

gap:
  668 ms
```

The caller had already received a transport timeout when the native action
later changed the synthetic oracle. Persistent approval remained absent.

Fixture and tests:

```text
tests/sky-transport-edge-cases.test.mjs
fixtures/real-cua/timeout-late-action.json
tests/timeout-late-action.test.mjs
```

## Wrapper policy snapshot is shallow

Issue:

V4 described the snapshot as frozen without distinguishing depth.

Evidence:

```text
top-level own data property: preserved
top-level snapshot: frozen
nested object reference: retained
nested object: mutable
accessor: rejected
```

Root cause:

The wrapper copies own string-key property descriptors and freezes only the
new top-level object.

Test:

```text
tests/wrapper-policy.test.mjs
```

## Desktop Computer Use identity loss at one MiB

Issue:

Large completed MCP results can appear as generic `node_repl` calls.

Evidence:

```text
serialized CallToolResult = 1,048,576 bytes
  _meta retained
  Desktop source = computerUse

serialized CallToolResult = 1,048,577 bytes
  _meta cleared
  Desktop source = null
```

Root cause:

The app-server event copy is collapsed to one text preview above the fixed
one-MiB cap. `structuredContent` and `_meta` are cleared. Desktop Computer Use
late binding reads only `_meta["codex/toolSurface"]`.

This is separate from model-context truncation.

Fixture and test:

```text
fixtures/electron/mcp-event-truncation.json
tests/mcp-event-truncation.test.mjs
```

## Locked-state boundary

The attempted unified V5 production matrix began after the user session became
locked. The service returned:

```text
The Mac is locked and automatic unlock could not unlock it.
```

Observed effects:

- only `list_apps` reached the production service;
- no UI action executed;
- persistent approval store remained absent.

The run stopped. No automatic unlock or loginwindow interaction was attempted.

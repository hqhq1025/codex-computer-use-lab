# Isolated macOS CUA Test App

## Purpose

`test-app/` contains a native AppKit application for deterministic Computer Use
experiments. It is a synthetic interaction target, not a Computer Use bridge
and not a collector for user activity.

```text
bundle: test-app/build/Codex CUA Lab.app
bundle identifier: com.openai.codex.cualab
oracle: test-app/runtime/state.json
synthetic marker: CUA Lab Synthetic Surface
```

## Current Production-Validated Surface

The current executable exposes the following production-validated controls:

| Scenario action | Native AX representation | AX identifier | Oracle mutation |
| --- | --- | --- | --- |
| Reset | button | `cua.lab.reset` | reset count and last action |
| Full state | button | `cua.lab.full-state-probe` | full-state probe count |
| Visible AX diff | button + text | `cua.lab.diff-probe`, `cua.lab.diff-status` | diff revision |
| Button click | button | `cua.lab.primary-button` | button count |
| Set value | settable text field | `cua.lab.set-value-field` | field value |
| Type text | settable text field | `cua.lab.type-text-field` | typed text and focus |
| Press key | focusable text fields | fixed field IDs | focus transition |
| Select text | settable text field | `cua.lab.select-text-field` | selected text and type |
| Checkbox | checkbox | `cua.lab.checkbox` | checked state |
| Slider action | slider with `Increment` | `cua.lab.slider` | slider value |
| Scroll | scroll area | `cua.lab.scroll-region` | scroll offset |
| Modal | button and sheet | `cua.lab.modal-open`, `cua.lab.modal-window`, `cua.lab.modal-close` | modal state |
| Multi-window | second standard window | `cua.lab.secondary-*` | per-window button and scroll state |
| Stale/refetch | dynamic buttons | `cua.lab.hierarchy-mutate`, `cua.lab.stale-target` | hierarchy generation and target counts |
| Stale missing/ambiguous | dynamic target removal/duplication | `cua.lab.hierarchy-remove`, `cua.lab.hierarchy-duplicate` | fail-closed error with zero target effects |
| Same-name target | two buttons with distinct IDs | `cua.lab.duplicate-action-1`, `cua.lab.duplicate-action-2` | chosen target |
| Coordinate click | screenshot-relative button center | `cua.lab.coordinate-target` | coordinate click count |
| Coordinate stale revision | swapped target/decoy | `cua.lab.coordinate-mutate`, `cua.lab.coordinate-decoy` | old point hits decoy; fresh point hits target |
| Drag | screenshot-relative synthetic track | `cua.lab.drag-target` | drag position |
| Cross-display move | main-window handle | `cua.lab.window-handle` | primary -> secondary -> primary |

The visible heading exposes `CUA Lab Synthetic Surface`. The app deliberately
does not mark the `NSWindow`, content view, or standard `NSControl` instances as
generic accessibility elements. AppKit must retain their native roles,
actions, window membership, and value semantics.

## AppKit Accessibility A/B Results

Three fixture bugs were found only after production execution:

1. Calling `setAccessibilityElement(true)` on an `NSControl` changed native
   button and checkbox roles into `unknown`. The action returned without an
   error but did not toggle the checkbox.
2. Overriding `NSTextField.setAccessibilityValue` caused the native value-write
   path to return `AXError.cannotComplete`. Removing the override restored the
   AppKit value setter; `textDidChange` remained sufficient for the oracle.
3. Marking the content view as a generic accessibility element removed the
   window from the application-level `AXWindows` array. Tree capture and
   element clicks still worked through other AX paths, but the native scroll
   implementation failed in `orderedWindows()` with `noWindowsAvailable`.

The final app therefore uses identifiers and labels on leaf controls, a visible
synthetic heading for identity, and native AppKit hierarchy semantics for
windows and containers.

The scroll document view is flipped. This makes the initial visible position
the top of the document and maps production `direction: "down"` to an
increasing synthetic offset.

The oracle stores coordinate targets in AppKit window-local points together
with the current outer window width and height. The runner converts them to the
actual fresh Sky screenshot dimensions:

```text
pixel.x = local.x * screenshot.width  / window.width
pixel.y = local.y * screenshot.height / window.height
```

This conversion is required because Sky can return an `886 x 768` screenshot
for a `1025 x 889` AppKit window. The test app listens for both move and resize
events so the geometry used for the next action is current.

## Oracle Contract

The app creates `test-app/runtime` with mode `0700`, atomically replaces
`state.json`, and publishes it with mode `0444`. It never reads the oracle.

The JSON identity is fixed:

```json
{
  "schemaVersion": 1,
  "synthetic": true,
  "syntheticMarker": "CUA Lab Synthetic Surface",
  "bundleIdentifier": "com.openai.codex.cualab",
  "appPath": "/Users/haoqing/Documents/Learning/computer-use-research/codex-computer-use-lab/test-app/build/Codex CUA Lab.app"
}
```

The oracle also always contains the runner paths below `meta`, `metrics`,
`controls`, `focus`, `selection`, `modal`, `hierarchy`, `ambiguous`,
`oop`, `coordinate`, and `window`.

## Isolation Boundary

The application has no network entitlement and does not call networking,
clipboard, user-default, external-file-read, or user-data APIs. Its one
`WKWebView` loads only an in-memory HTML string into a non-persistent data
store. The page CSP denies every external resource class, including
`connect-src`, and the navigation delegate allows only the initial
`about:`/memory document. All displayed values are generated in memory. Its
only write is the bounded oracle below `test-app/runtime`.

The JSON state is drawn visually by a custom AppKit view and is excluded from
the accessibility tree, preventing JSON keys from appearing as unexpected
non-synthetic AX labels.

## Commands

```bash
test-app/build.sh
test-app/launch.sh
test-app/stop.sh
test-app/reset.sh
```

`reset.sh` stops the app and removes only `test-app/runtime`.

## Verification

`tests/test-app-build.test.mjs` verifies the signed bundle, identifier,
production runner AX contract, native-role preservation rules, nested oracle
source contract, and absence of network entitlements or prohibited APIs. The
production matrix is checked by
`tests/production-behavior-fixtures.test.mjs`.

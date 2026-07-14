# Real CUA Behavior Harness

## Purpose

This harness is the opt-in layer that can exercise the production Computer Use
wrapper against one synthetic macOS application. It is intentionally separate
from the hermetic Sky wire probes.

The only target is:

```text
bundle id:
  com.openai.codex.cualab
application:
  /Users/haoqing/Documents/Learning/codex-computer-use-lab/test-app/build/
  Codex CUA Lab.app
oracle:
  /Users/haoqing/Documents/Learning/codex-computer-use-lab/test-app/runtime/
  state.json
```

The runner rejects target overrides, path overrides, unknown CLI flags, unknown
scenarios, symlinked target paths, a mismatched `Info.plist`, duplicate app
matches, a persistent approval store, non-synthetic AX labels, remote
screenshot URLs, and output paths outside `fixtures/real-cua`.

## Default Dry Run

Running the script normally never loads the Computer Use runtime:

```bash
cd codex-computer-use-lab
node scripts/real-cua-lab-runner.mjs \
  --scenario button-click \
  --out fixtures/real-cua/dry-run-plan.json
```

The result records:

```json
{
  "mode": "dry-run",
  "safety": {
    "productionCuaRequestSent": false,
    "uiActionsExecuted": false
  }
}
```

`--copy-screenshots` is rejected without `--execute`.

## Real Execution

Real execution is not supported from an ordinary Node process. It must run
inside the Codex `node_repl` host. The lab runner itself is an untrusted local
module and checks only the ordinary REPL surface (`nodeRepl.write` and
`nodeRepl.requestMeta`). It does not require or inspect `nativePipe`,
`createElicitation`, or `withSuspendedTimeout`.

Import the runner in a Computer Use-enabled `node_repl` session:

```js
var lab = await import(
  "/Users/haoqing/Documents/Learning/codex-computer-use-lab/scripts/real-cua-lab-runner.mjs"
);
var result = await lab.runRealCuaLab({
  execute: true,
  scenarioIds: ["button-click"],
  outputPath:
    "/Users/haoqing/Documents/Learning/codex-computer-use-lab/fixtures/real-cua/button-click-result.json"
});
nodeRepl.write(JSON.stringify(result, null, 2));
```

The runner imports the pinned real wrapper:

```text
/Users/haoqing/.codex/plugins/cache/openai-bundled/computer-use/
1.0.1000387/scripts/computer-use-client.mjs
```

It never imports `@oai/sky` directly. The production wrapper owns the real
elicitation in its trusted realm. The user must choose the session-only option.
The runner does not attempt to replace or proxy `globalThis.nodeRepl`, because
the real bridge is locked and the wrapper reads its own trusted global.

Preflight resolves the wrapper's exact real path and requires SHA-256:

```text
6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f
```

Only then does the runner call the fixed wrapper's
`setupComputerUseRuntime({globals: globalThis})`. If the trusted wrapper cannot
reach its privileged native-pipe or elicitation bridge, the wrapper fails
closed. The runner has no injectable wrapper path, loader, or setup function.

Before the first production CUA request, the runner requires this file to be
absent:

```text
~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/
Library/Application Support/Software/ComputerUseAppApprovals.json
```

It checks file metadata again immediately after every `list_apps`,
`get_app_state`, and action call. If the file appears, the run stops
immediately. The runner records `persistentApprovalStoreBefore`,
`persistentApprovalStoreAfter`, and each postflight check. It never reads the
store contents and never deletes the store.

The production wrapper and native service have now executed the synthetic UI.
The consolidated result is:

```text
fixtures/real-cua/runner-final-semantic-matrix-v4.json
```

It records one synthetic App binary hash, one production service hash, one
wrapper hash, 21 passing scenarios, 66 steps, and 192 post-call
approval-store checks.

## Step Invariant

Every normal step follows:

```text
fresh full get_app_state
  -> validate synthetic AX marker and labels
  -> read state.json before
  -> resolve a fresh element index or validate fresh screenshot coordinates
  -> execute exactly one allowlisted action
  -> apply the step's bounded post-action settle when declared
  -> fresh get_app_state after
  -> read state.json after
  -> evaluate declared oracle checks
```

Every reset declares a 1300 ms settle. The test app performs generation-bound
geometry restores at 150, 350, 650, and 1000 ms. This is required because the
native element-positioning path can deliver AppKit resize, scroll, and window
movement after the reset button handler returns. Old reset callbacks are
ignored after a newer reset starts, and the settle expires before the
window-move scenario performs its first legitimate drag.

The diff scenario requests a diff immediately after the action and then obtains
a full state before validating the marker and oracle.

The stale-element scenario deliberately suppresses a state request between the
hierarchy mutation and the old-index action:

```text
capture target index from state A
  -> click the hierarchy mutation control
  -> read only the synthetic oracle
  -> attempt the old index from state A without another get_app_state
  -> obtain fresh state B
  -> prove the replacement target changed and the inserted decoy did not
  -> resolve the target again and recover
```

The current production service successfully refetched the replacement target:
the stale index was `21`, the fresh target moved to `22`, target count became
`1`, and wrong-target count remained `0`.

## Scenario Allowlist

The static allowlist currently contains 21 production-executable scenarios.

The production-executable scenarios are:

```text
full-state
diff
button-click
set-value
type-text
press-key
select-text
checkbox
slider-secondary-action
scroll
modal
multi-window
dynamic-hierarchy-stale-element
stale-element-missing
stale-element-ambiguous
ambiguous-same-name
coordinate-click
oop-webcontent-coordinate-click
coordinate-stale-revision
drag-target
window-move
```

A real run with no explicit scenario selects the production-executable list.

Allowed action methods are limited to:

```text
click
set_value
type_text
select_text
perform_secondary_action
scroll
drag
```

There is no generic command escape hatch. Delete, external communication,
clipboard access, system settings, installation, authentication, and file
management are not represented in the scenario DSL.

## Test-App Contract

The main test window must expose the visible text `CUA Lab Synthetic Surface`.
The modal tree is accepted only when it contains the fixed
`cua.lab.modal-window` marker. All user-visible synthetic labels begin with
`CUA Lab`. The runner also allows the standard window labels `Close`,
`Minimize`, and `Zoom`.

Before the first production CUA request, preflight requires the oracle to
already exist. It is bounded to 1 MiB and must include:

```json
{
  "schemaVersion": 1,
  "synthetic": true,
  "syntheticMarker": "CUA Lab Synthetic Surface",
  "bundleIdentifier": "com.openai.codex.cualab",
  "appPath": "/Users/haoqing/Documents/Learning/codex-computer-use-lab/test-app/build/Codex CUA Lab.app"
}
```

Scenario checks use declared paths below `meta`, `metrics`, `controls`,
`focus`, `selection`, `modal`, `secondaryWindow`, `hierarchy`, `ambiguous`,
`coordinate`, `drag`, `windowMove`, and `window`.

## Result Hygiene

Full AX text and the full oracle are never written to results. Full AX state is
reduced to marker presence, character count, and SHA-256. The diff scenario
retains its short synthetic-only diff text so the changed `cua.lab.diff-status`
line can be asserted.

Each execute result also records:

- synthetic App executable size, modification time, and SHA-256;
- production `SkyComputerUseService` size, modification time, and SHA-256;
- wrapper SHA-256;
- every approval-store metadata check;
- completed scenarios when a later scenario fails.

`test-app/stop.sh` waits for every old synthetic App PID to exit. `launch.sh`
uses `open -n` and waits for `state.json` modification time to advance. This
prevents LaunchServices from reusing an old process after the bundle has been
rebuilt, which would otherwise mix a new executable hash with stale oracle
state.

Coordinate and drag actions are derived from the current synthetic layout
oracle. Before execution, the runner requires the immediately preceding
screenshot and checks every point against its detected width and height.
Oracle points are AppKit window-local points, not assumed screenshot pixels.
The runner scales them using the current oracle window dimensions and the
actual detected screenshot dimensions.

The coordinate-staleness scenario intentionally violates the normal freshness
rule in one bounded synthetic step. It captures a target point, swaps target
and decoy without another state request, and proves the old coordinate still
executes and hits the decoy. This fixture demonstrates the lack of a
protocol-level screenshot revision token; normal workflows must still fail
closed and re-observe.

Screenshot records contain only:

- a normalized local URL;
- byte length;
- detected PNG/JPEG/WebP format and dimensions;
- SHA-256.

Screenshot bytes are copied below `fixtures/real-cua/<run-id>/` only when
`copyScreenshots: true` or `--copy-screenshots` is explicitly set. HTTP and
HTTPS screenshot URLs are rejected. The current macOS production service was
observed returning a local `.jpeg` JFIF screenshot with no `mimeType` field, so
the runner detects the format from magic bytes rather than assuming the PNG
shown in older skill examples.

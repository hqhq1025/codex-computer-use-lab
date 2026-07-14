# Wrapper Policy, Approval Metadata, And TOCTOU

## What This Experiment Adds

The native-pipe lab proves the shipped `MacComputerUseClient` wire. This
experiment adds the layer immediately above it:

```text
actual computer-use-client.mjs
  -> actual @oai/sky create_client
  -> actual computer-use-policy.js
  -> fake createElicitation
  -> fake native pipe
  -> fake Sky service
```

The real CUA socket is never contacted and no application is opened.

## Reproduce

```bash
cd codex-computer-use-lab
node scripts/wrapper-policy-probe.mjs \
  --out fixtures/wrapper-policy/captured.json
node --test tests/wrapper-policy.test.mjs
```

## Approval Target Versus Execution Target

The fake policy result describes one target:

```json
{
  "appPath": "/Applications/Sky Wire Fixture.app",
  "bundleIdentifier": "com.example.sky-wire-fixture",
  "displayName": "Sky Wire Fixture",
  "risk": "low"
}
```

The wrapper requests user approval for the stable bundle identity:

```json
{
  "message": "Allow Computer Use to use \"Sky Wire Fixture\"?",
  "meta": {
    "codex_approval_kind": "mcp_tool_call",
    "connector_id": "computer-use",
    "connector_name": "Computer Use",
    "persist": ["session", "always"],
    "riskLevel": "low",
    "tool_params": {
      "app": "com.example.sky-wire-fixture"
    }
  }
}
```

It also marks the tool result surface with:

```json
{
  "codex/toolSurface": {
    "app": {
      "appId": "com.example.sky-wire-fixture",
      "kind": "appId"
    },
    "kind": "computerUse"
  }
}
```

After approval, the action request uses the service-resolved canonical app
path:

```json
{
  "app": "/Applications/Sky Wire Fixture.app",
  "action": {
    "click": {
      "at": {
        "elementID": {
          "_0": "1"
        }
      },
      "clickCount": 2,
      "mouseButton": 1
    }
  }
}
```

This separates the approval identity displayed to the user from the concrete
launch/execution path selected by the native policy service.

## Pre-Await Snapshot

The probe calls:

```js
const input = {
  app: "com.example.sky-wire-fixture",
  element_index: 1,
  click_count: 2,
  mouse_button: "right"
};

const pending = sky.click(input);
input.app = "com.example.mutated-after-call";
input.element_index = 999;
input.click_count = 99;
await pending;
```

The captured wire still contains app target 1 and click count 2.

`withComputerUsePolicy` copies all own string-key data properties and freezes
the new top-level object before its first asynchronous policy request. Later
top-level caller mutation therefore cannot change the target or action after
approval begins.

This is a shallow snapshot:

- inherited properties are ignored;
- Symbol properties are ignored;
- every accessor is rejected;
- nested object references are retained and remain mutable.

The hermetic callback probe observes a nested value changing during the policy
await while top-level values remain fixed.

## Accessor Rejection

An input whose `app` is a getter is rejected with:

```text
Computer Use app approval requires app to be a plain data property
```

The wrapper checks property descriptors instead of reading arbitrary
properties from a potentially adversarial object. This prevents getter side
effects during approval and avoids approving one value while executing another.

## Timeout Suspension

The experiment records one call to `withSuspendedTimeout` around the approved
action callback. User approval itself occurs before that wrapper call. In the
real Node host, the trusted bridge can suspend the JavaScript execution timeout
while the native operation is in progress without exposing timeout control to
ordinary model cells.

The internal Sky request timeout is a separate mechanism. It begins when the
request reaches native-pipe dispatch, does not include queue/startup time,
sends no cancel frame, and does not close the socket on timeout.

## List Apps And Policy Rejection

`list_apps` does not call app policy or create an elicitation. It sets
`codex/toolSurface.app = null`, logs tool telemetry, and sends the list request.

For app-specific calls, response metadata is set immediately after the policy
response and before the policy decision is checked. A `denied` or `forbidden`
call therefore:

- sends no action request;
- creates no approval elicitation;
- may still return Computer Use target metadata for the denied app.

## Boundary

This experiment proves wrapper composition, metadata, parameter freezing, and
wire encoding against a fake service. It does not prove that the production
service resolves a particular real application path or that a real AX click
succeeds.

## V6: Approval Is App Capability, Not Action Approval

The approval request displays the app identity. It does not include the action
kind, element, coordinate, key, text, or scroll amount.

Only `app` and its property descriptor are strictly validated before policy
and elicitation. Other fields are normally validated by `MacComputerUseClient`
after approval.

Hermetic evidence:

```text
click({ app: fixture, x: NaN, y: 10 })

policy request   = 1
approval request = 1
metadata set     = true
action request   = 0
error            = coordinate must include finite x and y
```

An invalid action can therefore produce an app approval prompt before failing.
The prompt grants app capability, not approval of that action payload.

## V6: Last-Writer Metadata

One `node_repl.js` result has one shallow-merged `_meta` object. Every
Computer Use operation writes the same `codex/toolSurface` key.

```text
App A policy -> metadata app=A
App A action
App B policy -> metadata app=B
App B action
outer MCP result -> metadata app=B
```

The hermetic test records both canonical wire targets but the final Desktop
attribution identifies App B. This is a presentation attribution limit, not an
execution-target mix-up.

## V6: Policy-To-Action Freshness

The wrapper binds approval to the policy result's bundle ID and sends the
policy result's canonical app path on the action request.

The request carries no policy nonce, approval revision, PID, code-signing
digest, or screenshot revision. After the user approval wait, the wrapper does
not re-run app policy before invoking the action closure.

Whether the native service revalidates code-signing identity for the canonical
path is outside this JavaScript-layer proof.

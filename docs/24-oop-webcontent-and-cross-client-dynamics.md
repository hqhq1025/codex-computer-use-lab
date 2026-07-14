# OOP WebContent And Cross-Client Dynamics

## Scope

This chapter closes two V7 dynamic gaps against only
`com.openai.codex.cualab`:

1. whether the native AX diff baseline survives a new node_repl client and
   transport;
2. whether a coordinate click can reach an out-of-process WKWebView surface.

The WebKit page is an in-memory HTML string. It uses a non-persistent data
store, denies external resources through CSP, rejects navigation, has no
network entitlement, and writes only the bounded synthetic state oracle.

## Cross-client native baseline

Phase A:

```text
Node kernel A
  -> wrapper/runtime A
  -> disableDiff=true
  -> full 2,891-character AX tree
```

Then `mcp__node_repl.js_reset` terminated kernel A. Phase B started with no
Phase A marker, imported a new wrapper/runtime, created a new JavaScript client
and native transport, and made its first default-diff request.

Phase B returned:

```text
There has been no change in the accessibility tree for Window:
"Codex CUA Lab".
```

Because Client B never obtained a local full tree, the baseline must live in
the native service. It is not the facade's per-app instruction `Set`, the
wrapper's global Symbol cache, the lazy-client module singleton, or the old
transport.

Fixture:

```text
fixtures/real-cua/cross-client-baseline.json
```

## In-memory WKWebView surface

The synthetic app records:

```text
oop.hostPID
oop.webContentPID
oop.target.x/y
oop.clickCount
oop.lastEventTrusted
oop.hostLocalMouseDownCount/upCount
```

The HTML button reports its `getBoundingClientRect()` center through a script
message. The runner scales that window-local point into the immediately
preceding screenshot and performs one coordinate click.

V4 production result:

```text
host PID:
  91849

WebContent PID:
  92087

screenshot coordinate:
  151, 666

clickCount:
  0 -> 1

DOM MouseEvent.isTrusted:
  true
```

`isTrusted=true` distinguishes the coordinate action from the synthetic
element-index test helper, whose JavaScript `.click()` produces
`isTrusted=false`.

The host AppKit local monitor observed one down/up pair for the coordinate
click. That observation is retained but is not treated as proof of host PID
delivery: AppKit can observe events associated with its window while WebKit
still processes the trusted DOM input out of process.

## Native OOP target contract

Static symbols from the same service build:

```text
target(forMouseEventAt:)                         0x10064727c
target(...axWindowPoint...)                      0x1006475bc
outOfProcessTargetWindow(for:appPID:)            0x100647e84
targetForKeyboardEvent()                         0x100648204
outOfProcessTarget(for:appPID:)                  0x100648410
UIElementProtocol.isInsideWebView                0x10070e63c
SynthesizedEvent.send(to:delay:)                 0x10067d838
CGEventAPI.postToPid                             0x1001ddd94
```

Explicit failure cases:

```text
elementPresumedOOPAndNotFound
elementIsOOPButExpectedToTargetAppAndNoEligibleParentElementWasFound
```

The combined evidence is:

```text
fresh coordinate
  -> target(forMouseEventAt:)
  -> OOP target selection exists in exact binary
  -> per-PID event backend exists in exact binary
  -> distinct WebContent PID is live
  -> WebContent DOM receives trusted click
  -> synthetic oracle increments
```

A read-only LLDB attach was attempted to capture the live target PID argument,
but macOS denied task attach to the hardened service. No SIP, signature,
entitlement, TCC, or security setting was changed.

Fixtures and tests:

```text
fixtures/native/oop-targeting.json
fixtures/real-cua/runner-oop-webcontent-coordinate-click.json
fixtures/real-cua/runner-final-semantic-matrix-v4.json
tests/oop-webcontent.test.mjs
```

## Virtual cursor correction

The virtual cursor is not an independent click backend:

```text
AXPick / AXPress
or
optional VirtualCursor.press
  -> synthetic CG click
  -> postToPid
```

`VirtualCursor.press` can fail and stop the later event, but successful cursor
press continues at `0x1007172dc` into the same synthetic event path.

Target-app instrumentation can distinguish AX action from synthetic CG. It
cannot distinguish synthetic CG with versus without a cursor overlay; both
deliver the same target-app input.

## Safety

- all actions targeted only `com.openai.codex.cualab`;
- the WebKit document loaded no URL or external resource;
- no persistent approval file existed before, after, or during audited calls;
- no screenshot pixels were copied into fixtures;
- no debugger attach bypass was attempted after the OS denial;
- no TCC, SIP, signature, Authorization, or system setting changed.

## Real Timeout Late Action

V9 used the shipped internal `MacComputerUseClient` with a real
`timeoutSeconds=0.001` request against the synthetic primary button.

```text
local timeout rejection:
  24 ms

synthetic oracle change:
  692 ms

action after rejection:
  668 ms
```

The action was sent once. After the client rejected, the experiment only
sampled the synthetic `state.json`; it sent no retry. The count changed from
zero to one, proving the original timed-out native action continued.

Fixture and test:

```text
fixtures/real-cua/timeout-late-action.json
tests/timeout-late-action.test.mjs
```

The internal client is not part of the public facade. A temporary,
hash-pinned helper was placed under the configured trusted `~/.codex` root to
import it, then deleted immediately after capture. This also dynamically
confirmed the breadth of `NODE_REPL_TRUSTED_CODE_PATHS`.

## Admission Deadline Versus Cancellation

A separate raw-wire policy-only experiment sent a request with:

```text
deadlineUnixMilliseconds = Date.now() - 1000
```

The service returned:

```text
-32001 Request deadline exceeded
```

No UI action was requested. This proves the service checks an expired deadline
at admission.

Combined with the late-click fixture:

```text
expired before admission -> reject
accepted then client timeout -> native work can continue
```

The current protocol has deadline admission but no cancellation message for
accepted work.

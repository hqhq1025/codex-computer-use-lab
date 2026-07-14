# Sky Native-Pipe Protocol

## Scope And Safety

This experiment captures the exact wire format produced by the installed
`@oai/sky` macOS client without contacting the real Computer Use service.

It has three hard boundaries:

1. The only Unix socket is created directly below `/tmp` with the prefix
   `codex-sky-wire-`.
2. `globalThis.nodeRepl.nativePipe.createConnection` rejects every path except
   that exact temporary socket.
3. The probe instantiates `MacComputerUseClient` directly. It does not call the
   policy wrapper, launch an application, emit input, or connect to
   `computeruse.sock`.

The checked-in capture records:

```json
{
  "realComputerUseSocketContacted": false,
  "uiActionsExecuted": false
}
```

## Exact Shipped Client

The probe loads this file from the installed ChatGPT/Codex app:

```text
/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/
  @oai/sky/dist/project/cua/sky_js/src/targets/mac/client.js
```

The captured package version is `@oai/sky@0.4.20`. The client defaults to:

```text
clientApiVersion = CodexComputerUseIPC-2
request timeout = 120 seconds
```

The lab sets the timeout to three seconds so deadline behavior is quick to
verify while leaving the API version unchanged.

## Reproduce From Zero

Prerequisites:

- macOS with `/Applications/ChatGPT.app` installed;
- Node.js 24 or newer;
- no running native Computer Use service is required.

Run:

```bash
cd codex-computer-use-lab
node scripts/sky-client-wire-probe.mjs \
  --out fixtures/sky-wire/captured.json
node --test tests/sky-wire.test.mjs
```

The first command should report 12 exchanges, eight encoded actions,
`maxInFlight: 1`, and both safety booleans as `false`.

To inspect the mock independently:

```bash
node scripts/mock-sky-service.mjs \
  --socket /tmp/codex-sky-wire-manual.sock \
  --capture /tmp/codex-sky-wire-manual.json
```

Stop it with `Ctrl-C`. This standalone mode only listens on the fake socket.

## Trusted Runtime Shim

The shipped transport reads the socket override from the trusted runtime, not
directly from `process.env`:

```js
globalThis.nodeRepl = {
  env: {
    SKY_CUA_NATIVE_PIPE_PATH: "/tmp/codex-sky-wire-....sock"
  },
  nativePipe: {
    createConnection(socketPath) {
      // Returns a Promise for a connected Node net.Socket.
    }
  },
  requestMeta: {
    "x-codex-turn-metadata": {
      session_id: "fixture-session",
      turn_id: "fixture-turn",
      source: "sky-wire-probe"
    }
  }
};
```

No `launchServices` shim is provided. A failed connection therefore cannot
start the real service and causes the probe to fail closed.

## Frame Format

Every message is:

```text
offset  size  meaning
0       4     unsigned payload byte length, little-endian
4       N     UTF-8 JSON payload
```

The maximum JSON payload is exactly `8 * 1024 * 1024` bytes. Both the mock and
the test reject a declared or encoded payload of `8,388,609` bytes.

The mock deliberately writes each response in up to three chunks:

```text
bytes 0..1
bytes 2..6
bytes 7..end
```

This makes the end-to-end run exercise the shipped client's incremental frame
decoder instead of relying on one socket read per response.

## JSON-RPC Layer

The first request on a new transport is:

```json
{
  "id": 1,
  "jsonrpc": "2.0",
  "method": "ping",
  "params": {
    "clientApiVersion": "CodexComputerUseIPC-2"
  }
}
```

The mock echoes the version:

```json
{
  "id": 1,
  "jsonrpc": "2.0",
  "result": {
    "serverApiVersion": "CodexComputerUseIPC-2"
  }
}
```

All product operations use JSON-RPC method `request`.

## Request Envelope

Each `request` has this complete envelope:

```json
{
  "clientApiVersion": "CodexComputerUseIPC-2",
  "codexTurnMetadata": {
    "session_id": "fixture-session",
    "turn_id": "fixture-turn",
    "source": "sky-wire-probe"
  },
  "deadlineUnixMilliseconds": 0,
  "request": {},
  "requestType": "ComputerUseIPC..."
}
```

The real deadline is generated immediately before the serialized socket write
as `Date.now() + timeoutSeconds * 1000`. The fixture replaces only that
machine-time-dependent integer with `<dynamic-unix-milliseconds>`. The runtime
test checks that every captured deadline has approximately a three-second
budget from server receipt.

The timeout starts when the serialized request reaches the transport dispatch
slot. Time spent waiting behind earlier requests, establishing the connection,
or starting the service is outside this budget.

## Calls And Fake Results

The probe queues these calls in order:

```text
listApps
getAppPolicy
getAppState
click(element)
click(coordinate)
setValue
selectText
scroll
drag
pressKey
typeText
```

The mock handles:

| Request type | Fake result |
|---|---|
| `ComputerUseIPCListAppsRequest` | One synthetic `com.example.sky-wire-fixture` app |
| `ComputerUseIPCAppPolicyRequest` | Allowed, low-risk synthetic policy |
| `ComputerUseIPCAppGetSkyshotRequest` | Synthetic AX text and no screenshot |
| `ComputerUseIPCAppPerformActionRequest` | `null` |

The first three calls return their fake values. All action calls resolve to
`undefined`, matching the public client methods.

## Encoded Action Union

Element click:

```json
{
  "click": {
    "at": { "elementID": { "_0": "1" } },
    "clickCount": 2,
    "mouseButton": 1
  }
}
```

Coordinate click:

```json
{
  "click": {
    "at": { "coordinate": { "_0": [120.5, 64] } },
    "clickCount": 1,
    "mouseButton": 0
  }
}
```

The remaining union variants captured in the fixture are:

```text
setValue
selectText
scroll
drag
pressKey
type
```

Important conversions performed by the shipped client:

- element indices become decimal strings;
- click locations use either `elementID` or `coordinate`;
- mouse buttons become `0`, `1`, or `2`;
- `pressKey` and `type` are single-field `_0` unions;
- properties whose value is `undefined` are removed before transmission.

See `fixtures/sky-wire/captured.json` for every complete envelope and action.

## Serialization Proof

The probe invokes all 11 client methods synchronously and then awaits them with
one `Promise.all`. The mock delays every response and counts requests that have
arrived but have not yet received a response.

The expected result is:

```json
{
  "connectionCount": 1,
  "maxInFlight": 1
}
```

This demonstrates the `MacNativePipeTransport` promise chain: even when callers
queue work concurrently, the transport does not write request `N+1` until
request `N` has settled. Deadlines are therefore created per actual dispatch,
not when the public client method was first called.

## Timeout, Late Response, And Reconnect

Hermetic edge-case tests establish:

```text
request timeout
  -> reject the local promise
  -> no cancel JSON-RPC frame
  -> keep the socket open
  -> dispatch the next queued request
```

The timed-out request can produce a late response. Once its pending entry has
been removed, the unknown response ID is silently ignored and does not close
the transport.

V9 confirmed the side-effect consequence against the real native service and
only the synthetic lab app:

```text
MacComputerUseClient timeout:
  1 ms

local rejection:
  24 ms

synthetic button side effect:
  692 ms after dispatch

side effect after rejection:
  668 ms
```

The client returned `Sky Computer Use request timed out` while the native click
continued and incremented the synthetic button oracle from `0` to `1`.

Fixture:

```text
fixtures/real-cua/timeout-late-action.json
```

A timeout means the caller stopped waiting. It is not a cancellation,
rollback, or proof that no UI action occurred.

The service does have an admission deadline gate. A raw, read-only synthetic
app policy request whose `deadlineUnixMilliseconds` was already one second in
the past returned:

```text
code:
  -32001

message:
  Request deadline exceeded
```

Therefore the exact model is:

```text
expired before service admission
  -> server rejects

accepted before deadline
  -> client timer can later expire
  -> no cancel frame
  -> accepted native work can still complete
```

Admission deadline enforcement is not cooperative cancellation of accepted
work.

Fixture:

```text
fixtures/real-cua/expired-deadline.json
```

Connection failure is different:

```text
current request fails
transport is removed from the client cache
request is not replayed
next API call creates a new connection and pings again
```

The new transport starts its numeric ID sequence again. See
`tests/sky-transport-edge-cases.test.mjs`.

## Facade And Type Boundaries

The public mac `create_client(options)` ignores `options` and exposes only the
window facade. Internal `MacComputerUseClient` options for API version, timeout,
and metadata are not configurable through that facade. Internal `startApp()` is
also absent from the public surface.

`errors.d.ts` declares `formatOSStatus(status)`, but the shipped JavaScript does
not implement or export it. The parity test locks this current mismatch.

App-specific instructions are injected only once per client/app identity.
`com.apple.iWork.Numbers` is explicitly excluded from instruction injection.

## Fixture Normalization

`fixtures/sky-wire/captured.json` is deterministic and contains no host names,
user paths, credentials, screenshots, application state, or real process IDs.

Only two runtime values are normalized:

- the temporary socket path becomes `<temporary-/tmp-unix-socket>`;
- each absolute deadline becomes `<dynamic-unix-milliseconds>`.

JSON-RPC IDs, frame sizes, request types, request payloads, fake responses,
turn metadata, and action unions remain exact. The test regenerates the
fixture through the installed client and requires deep equality with the
checked-in JSON.

## V6: Exact Queue And Frame Limit

Current constants:

```text
MAX_FRAME_BYTES = 8,388,608
service startup timeout = 5,000 ms
```

The transport maintains a promise tail. Every request is scheduled with:

```text
tail.then(dispatch)
```

and the tail is replaced by a settled continuation. One transport therefore
has at most one native request in flight.

This queue does not make a complete policy/approval/action transaction atomic:

```text
A policy -> A waits for approval
B policy -> B waits for approval
B approval -> B action
A approval -> A action
```

Multiple clients, API versions, node_repl processes, or connections have
independent queues.

Request IDs increment as JavaScript numbers without a safe-integer or wrap
check. A collision near `2^53` is practically remote but not prevented.

The 8 MiB native-pipe frame cap is independent from the 1 MiB app-server MCP
event-copy cap.

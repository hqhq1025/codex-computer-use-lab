# Timeout, Deadline, URL Policy, And Lifecycle

## Real Client Timeout

The public Computer Use facade does not expose `timeoutSeconds`. V9 used a
temporary, hash-pinned trusted helper to import the packaged internal
`MacComputerUseClient`, target only `com.openai.codex.cualab`, and issue one
click with a one-millisecond client timeout.

Result:

```text
client rejection:
  24 ms

native side effect:
  886 ms

gap after rejection:
  862 ms
```

The checked fixture may contain a different timing sample because scheduling
is not the contract. The stable contract is:

```text
client rejects first
synthetic button count changes later
no retry is sent
```

The helper is created with exclusive mode below the configured trusted root,
verified against its embedded SHA-256, and removed in `finally`.

Fixture:

```text
fixtures/real-cua/timeout-late-action.json
```

## Admission Deadline

A separate policy-only raw-wire request used:

```text
deadlineUnixMilliseconds = Date.now() - 1000
```

The service returned:

```text
-32001 Request deadline exceeded
```

Therefore:

```text
expired before admission
  -> rejected

accepted before deadline
  -> client can timeout
  -> no cancellation frame
  -> work may complete later
```

The protocol implements an admission deadline, not cooperative cancellation
for accepted work.

Fixture:

```text
fixtures/real-cua/expired-deadline.json
```

## Trusted Root Proof

Current configuration:

```text
NODE_REPL_TRUSTED_CODE_PATHS=$HOME/.codex
```

The two experiments dynamically confirmed that a temporary module directly
below this directory enters the trusted Node realm and can access
`nodeRepl.nativePipe`. The modules were deliberately capability-limited,
hash-pinned, created with `wx`, and deleted afterward.

This establishes a concrete security boundary:

```text
write primitive into trusted Codex home
  -> trusted imported module
  -> native-pipe capability
```

The trusted path should ideally be narrowed to immutable versioned plugin
roots or exact content hashes.

## URL Policy

The native chain is:

```text
ApplicationUIElement.isWebBrowser
  -> AX-visible current URL
  -> AuraSiteStatusURLPolicyChecker
  -> ComputerUseURLBlocklistCache
  -> isAllowed inverted to isBlocked
  -> session stop / -10015
```

Native apps do not enter URL policy even if an element exposes `AXURL`.

Important static addresses:

```text
ApplicationUIElement.isWebBrowser  0x100657100
WebAreaUIElement.url               0x10066b8fc
UIElementProtocol.url              0x10070b0a8
URL observation callback           0x1000a55b4
blocked completion                 0x1000a546c
checker failure log                0x1001427d4
checker fail-open return           0x1001428ac
```

Checker failure is fail-open. URL changes are observed asynchronously, not
only during `get_app_state`.

Policy freshness is limited:

- app policy, app approval, and action have no policy digest or URL snapshot;
- only the current AX-visible URL is confirmed, not intermediate redirects;
- a click that causes a blocked redirect cannot be rolled back;
- the session can stop and reject subsequent actions with `-10015`.

Static fixture and executable model:

```text
fixtures/native/url-policy.json
lib/url-policy-behavior-model.mjs
tests/url-policy.test.mjs
```

No Aura network request is made by the lab tests.

## Conversation Turn-Ended Lifecycle

The expected chain is:

```text
Codex legacy notify
  -> SkyComputerUseClient turn-ended <payload>
  -> Apple Event request envelope
  -> ComputerUseIPCCodexTurnEndedRequest
  -> onCodexTurnEnded(threadID)
  -> lock-screen thread cleanup
  -> optional app target tracker cleanup
  -> optional shared AppInstance deactivate
```

The helper CLI is:

```text
cua turn-ended [--previous-notify <previous-notify>] <payload>
```

The legacy Codex payload contains:

```json
{
  "type": "agent-turn-complete",
  "thread-id": "<thread UUID>",
  "turn-id": "<turn UUID>",
  "cwd": "<cwd>",
  "input-messages": [],
  "last-assistant-message": null
}
```

The native request body is only:

```json
{
  "threadID": "<thread UUID>"
}
```

Unlike normal Node Computer Use calls, the packaged helper's `turn-ended`
command enters the service through an Apple Event request envelope. Codex
launches the legacy notify process fire-and-forget with stdio redirected to
null. Helper exit is therefore not a sufficient success gate, and log capture
must remain open after the turn long enough for Apple Event delivery.

Current service logs use:

```text
subsystem = inc.software.app
category  = Computer Use
```

An observation-only natural Codex turn dynamically confirmed:

```text
agent turn complete
  -> helper dispatch
  -> Apple Event IPC
  -> ComputerUseIPCCodexTurnEndedRequest
  -> Received lock-screen turn end
     removedActiveThread=true
```

This proves lock-screen active-thread lease cleanup. It does not prove that
the app target was present in
`targetIdentifiersByConversationID`, because no:

```text
Deactivated Computer Use for ended Codex thread
Failed to deactivate Computer Use for ended Codex thread
```

log was observed.

The earlier V9 harness failed closed and wrote no fixture because it required:

```text
Codex thread ended or stopped conversationID=...
```

That message belongs to the separate Codex app-server thread-stream observer,
not the helper IPC path. The harness now gates on service-side helper effects:

```text
Received lock-screen turn end removedActiveThread=true
Deactivated Computer Use...
Failed to deactivate Computer Use...
```

It also waits up to ten seconds after helper dispatch and explicitly records
that a no-change AX diff does not prove deactivate/reactivate.

The app-target deactivate/reactivate step remains not dynamically confirmed
under the observation-only safety boundary. Static analysis still shows:

```text
target tracker cleanup
  -> clearStoppedByUser
  -> AppInstance.deactivate
  -> AppController.deactivate

next app request
  -> AppInstance.activate
  -> AppController.activate
```

The script remains:

```text
scripts/real-cua-conversation-lifecycle.mjs
```

It is not part of `npm run reproduce`.

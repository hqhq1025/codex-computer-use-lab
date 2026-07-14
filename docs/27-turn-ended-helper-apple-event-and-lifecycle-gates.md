# Turn-Ended Helper, Apple Event IPC, And Lifecycle Gates

This chapter separates three lifecycle mechanisms that were previously easy
to conflate:

```text
Codex legacy notify helper
Codex app-server thread-stream observer
Computer Use app-target tracker cleanup
```

## Helper CLI

The signed helper is:

```text
<computer-use-plugin>/Codex Computer Use.app/Contents/SharedSupport/
SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient
```

Current SHA-256:

```text
fb3b179358ac77cd15a2093fcaff4db8aacee157339a18c52ddefe25b8752379
```

CLI:

```text
cua turn-ended [--previous-notify <previous-notify>] <payload>
```

It decodes the legacy Codex notification:

```json
{
  "type": "agent-turn-complete",
  "thread-id": "<thread UUID>",
  "turn-id": "<turn UUID>",
  "cwd": "<cwd>",
  "client": "<optional>",
  "input-messages": [],
  "last-assistant-message": null
}
```

Only the thread ID enters the native request:

```json
{
  "threadID": "<thread UUID>"
}
```

## Transport

The helper does not use the Node client's `computeruse.sock` path directly for
this command. A read-only process sample observed:

```text
NSAppleEventDescriptor.sendEventWithOptions
  -> AESendMessage
```

The binary exposes Apple Event fields for request type, request data, and Codex
metadata. The request type is:

```text
ComputerUseIPCCodexTurnEndedRequest
```

The equivalent native-pipe envelope, accepted by the service in a separate
diagnostic run, is:

```json
{
  "jsonrpc": "2.0",
  "method": "request",
  "params": {
    "clientApiVersion": "CodexComputerUseIPC-2",
    "codexTurnMetadata": {},
    "deadlineUnixMilliseconds": "<future milliseconds>",
    "requestType": "ComputerUseIPCCodexTurnEndedRequest",
    "request": {
      "threadID": "<thread UUID>"
    }
  }
}
```

## Codex Dispatch Semantics

Codex's legacy notify path:

```text
append JSON payload as final argv
redirect stdin/stdout/stderr to null
spawn helper
do not wait
```

This is fire-and-forget. A helper process exit code is not the service
acknowledgement, and a short log window can miss the later Apple Event round
trip.

Manual helper execution from a generic shell parent can also remain blocked in
Apple Event delivery. The real Codex parent launch context is material.

## Service Call Graph

```text
ComputerUseCodexTurnEndedCommand
  -> ComputerUseIPCCodexTurnEndedRequest(threadID)
  -> Apple Event bridge
  -> ComputerUseIPCServer.onCodexTurnEnded
  -> LockScreenAutoUnlockCoordinator.codexTurnEnded
  -> CodexComputerUseSessionTracker cleanup
     -> remove conversation tracker entry
     -> clearStoppedByUser for each tracked target
     -> asynchronously deactivate each shared AppInstance
```

Static addresses:

```text
request handle                         0x10013d7f0
session tracker cleanup body           0x10000da60
target tracker insertion               0x10000d8d0
target tracker insertion callsite      0x100018c88
clearStoppedByUser                     0x10009c758
AppInstance.deactivate                 0x100099e98
AppController.deactivate               0x100072004
deactivate success log                 0x10000e304
deactivate failure log                 0x10000e4b8
```

The next app request enters:

```text
shared app request path
  -> generic AppInstance resolution
  -> AppInstance.activate
  -> AppController.activate
```

## Dynamic Result

One ephemeral natural Codex turn performed only `getAppState` against the
synthetic `com.openai.codex.cualab` app.

Observed service effect:

```text
Registered active lock-screen thread
Received lock-screen turn end
  removedActiveThread=true
  removedAutoUnlockedThread=false
```

This dynamically proves:

```text
Codex turn completion
  -> signed helper
  -> Apple Event IPC
  -> native turn-ended request
  -> lock-screen active-thread cleanup
```

No app deactivate success or failure log was observed. The observation-only
request therefore did not prove target tracker insertion or app-target
deactivate/reactivate.

## Correct Gates

The helper path must not require:

```text
Codex thread ended or stopped conversationID=...
```

That message belongs to the separate app-server observer.

Valid service-side effects are:

```text
Received lock-screen turn end removedActiveThread=true
Deactivated Computer Use for ended Codex thread
Failed to deactivate Computer Use for ended Codex thread
```

A no-change AX diff after turn-ended dispatch proves only that a baseline is
available. Since ordinary deactivate preserves `lastAXTree`, it cannot by
itself distinguish:

```text
no deactivate occurred
deactivate then reactivate occurred
```

## Remaining Dynamic Boundary

Closing app-target deactivate/reactivate without input requires one of:

1. read-only runtime access to the session tracker's target map;
2. a request known to populate the target tracker;
3. a stable service log or signpost emitted when target insertion occurs.

The hardened service previously denied debugger attach. An interaction-bearing
request may populate the tracker, but that is outside the observation-only
safety contract used here.

## Harness

The manual harness:

```text
scripts/real-cua-conversation-lifecycle.mjs
```

now:

- filters `inc.software.app` / `Computer Use`;
- waits for service-side effects after helper dispatch;
- treats helper exit only as dispatch completion;
- times out a helper blocked in Apple Event delivery;
- separates lock-screen cleanup from app deactivate;
- refuses to use a no-change diff as reactivate proof;
- writes no fixture when the stronger gate is absent.

It remains excluded from `npm run reproduce`.

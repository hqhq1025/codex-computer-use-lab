# Codex Computer Use Reverse Engineering Lab

An experiment-backed study of the macOS Computer Use stack shipped with the
Codex desktop app.

This repository maps the path from the model-facing tool surface to the native
macOS service, then validates the recovered behavior with sanitized fixtures,
read-only probes, hermetic protocol tests, and a tightly scoped synthetic
AppKit application.

Status as of July 14, 2026:

- 191 automated checks pass.
- A 21-scenario production behavior matrix passes against the synthetic app.
- The model, MCP, Node trust boundary, Sky protocol, native observation and
  input paths, policy gates, lifecycle, and desktop presentation are covered.
- Remaining gaps are narrow dynamic internals, not the primary execution path.

This is an independent research project. It is not an official OpenAI project,
API, SDK, or supported compatibility contract.

## What We Found

The installed Codex app currently reaches Computer Use through this path:

```text
Responses model
  -> deferred tool discovery
  -> node_repl
  -> Computer Use wrapper
  -> Sky JavaScript client
  -> length-prefixed JSON-RPC over a Unix socket
  -> SkyComputerUseService
  -> Accessibility / ScreenCaptureKit / synthesized input
  -> target application
  -> MCP result projection
  -> Codex desktop presentation
```

Key results:

1. Codex does not expose a native Responses `computer` tool in the observed
   base request. It discovers a deferred `node_repl` path and invokes the
   Computer Use facade from that trusted runtime.
2. The native client uses four-byte length-prefixed JSON-RPC frames and an
   8 MiB frame limit.
3. Native application identity is based on the canonical app installation
   path and the current live process, not only bundle ID, PID, conversation,
   or socket.
4. Accessibility-tree diff state survives JavaScript client and transport
   replacement because the baseline is held by the native service.
5. Stale element references are refetched conservatively. Missing and
   ambiguous matches fail closed.
6. Screenshot coordinates have no equivalent revision binding. Reusing stale
   coordinates can hit a different element.
7. A client timeout does not cancel an already accepted native action. The
   action can complete after the client has rejected the request.
8. A coordinate click reached an out-of-process WKWebView and produced a
   trusted DOM event in a distinct WebContent process.
9. Policy, approval, lock-screen, URL, and target checks are separate gates.
   Several recovered paths fail closed, while URL policy checker failure is a
   documented fail-open exception.
10. Desktop labels and result grouping are presentation metadata. A
    success-sounding completed label is not proof that the native action
    succeeded.

The current synthesis is
[V10: target identity and process lifetime](reports/v10-target-identity-and-lifetime.md).
Earlier reports remain available because they preserve the evidence history
and build-specific reasoning.

## Evidence Model

Claims in this repository are separated by evidence class:

| Class | Description |
|---|---|
| Live read-only | Process, version, signature, schema, log-count, and installed-artifact observations |
| Static binary | Bounded symbols, strings, metadata, and disassembly from the pinned signed build |
| Hermetic dynamic | Mock sockets and isolated app-server or Node probes that never contact the production Computer Use socket |
| Synthetic production | Explicitly authorized actions against only `com.openai.codex.cualab` |

Build-specific facts are pinned by hashes and fixture metadata. They should not
be treated as stable public APIs.

## Production Behavior Matrix

The checked production fixture covers 21 scenarios:

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

The fixture records one synthetic app hash, one native service hash, one
wrapper hash, 66 steps, and post-call checks proving that persistent approval
was never enabled.

See [the real behavior harness](docs/10-real-cua-behavior-harness.md) and
[the safety contract](docs/15-real-experiment-safety-contract.md).

## Repository Layout

```text
docs/       Focused protocol, native, policy, lifecycle, and security chapters
reports/    V1-V10 synthesis reports and the service lifecycle deep dive
scripts/    Read-only collectors, hermetic probes, and opt-in synthetic harnesses
fixtures/   Sanitized, build-pinned evidence
tests/      Contract and reproduction tests
test-app/   Network-disabled synthetic AppKit target
lib/        Behavior models and shared harness code
```

Useful entry points:

- [Methodology and pinned builds](docs/00-methodology.md)
- [Architecture and app-server loop](docs/01-app-server-model-loop.md)
- [Node trust boundary](docs/02-node-repl-trust-boundary.md)
- [Sky wire protocol](docs/03-sky-native-pipe-protocol.md)
- [Native service internals](docs/04-native-service-internals.md)
- [Security threat model](docs/06-security-threat-model.md)
- [Reproduction guide](docs/07-reproduction-guide.md)
- [Native AX diff and instance isolation](docs/22-native-ax-diff-refetch-and-instance-isolation.md)
- [Plugin-to-model contract](docs/23-plugin-to-model-input-output-contract.md)
- [OOP WebContent and cross-client behavior](docs/24-oop-webcontent-and-cross-client-dynamics.md)
- [Timeout, deadline, URL policy, and lifecycle](docs/25-timeout-deadline-url-policy-and-lifecycle.md)
- [Application target identity](docs/26-application-target-identity-resolution-and-process-lifetime.md)
- [Turn-ended helper and lifecycle gates](docs/27-turn-ended-helper-apple-event-and-lifecycle-gates.md)

## Quick Start

Requirements:

- macOS with a compatible Codex desktop installation
- Node.js 22 or newer
- Xcode command-line tools
- `bash`, `codesign`, `nm`, `otool`, `plutil`, `sqlite3`, and `strings`

Run the checked verification suite:

```bash
npm run verify
```

Run the available reproduction pipeline:

```bash
npm run reproduce
```

The default pipeline is non-interactive and does not send production Computer
Use actions. It builds the synthetic app, regenerates safe evidence where the
matching local artifacts are available, and validates the fixtures.

Some collectors are pinned to the original machine layout and exact inspected
build. Set the documented environment variables or update local paths when
reproducing against another installation. A version or hash mismatch is a
signal to regenerate evidence, not to edit an old fixture until it passes.

## Safety

Default commands must not:

- connect to the real `computeruse.sock`;
- synthesize keyboard or mouse input;
- alter TCC, Authorization Services, approvals, or Codex configuration;
- capture prompt bodies, credentials, screenshots, or private app content;
- operate on an application other than the synthetic test app.

Production action experiments are opt-in, restricted to
`com.openai.codex.cualab`, and guarded by a static scenario allowlist. The
runner rejects target overrides, path overrides, persistent approval, unknown
labels, and output paths outside its fixture directory.

Do not use this repository to bypass user consent, platform protections,
application authorization, or product policy.

## Remaining Questions

The primary unresolved items are:

1. Pointer-level dynamic confirmation that two live clients share the exact
   same native instance, controller, and executor.
2. Real mixed-scale 1x/2x display behavior.
3. Function-level tracing of the final OOP WebContent target PID.
4. A separate visual witness for the virtual cursor overlay.
5. The practical acquisition boundary of the Guardian rendezvous capability.
6. Dynamic proof of app-target deactivate/reactivate after `turn-ended`.
7. Private server-side enablement details for deferred tool discovery.
8. Cached target behavior when an app bundle moves or is replaced after target
   construction.

## Responsible Use And Disclosure

The repository intentionally excludes secrets, private user content, raw
screenshots, and instructions for weakening macOS security controls. Security
claims distinguish confirmed behavior, static evidence, and remaining
unknowns.

For a suspected vulnerability, avoid publishing exploit details or sensitive
artifacts in a public issue. Report it through the affected vendor's security
channel first.

## License

The original research notes, harness code, and synthetic test application in
this repository are released under the MIT License. Product names, bundled
artifacts, and referenced upstream source remain the property of their
respective owners.

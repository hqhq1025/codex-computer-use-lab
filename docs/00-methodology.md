# Methodology And Evidence Rules

## Objective

The lab answers a narrower question than a product overview:

> For the exact Codex App build installed on this Mac, what bytes, processes,
> schemas, policies, and native components carry one Computer Use observation
> or action from model output to macOS and back?

## Pinned Local Versions

At lab creation time:

| Component | Version |
|---|---|
| Electron App | `26.707.51957` |
| Embedded Codex | `0.144.0-alpha.4` |
| Codex source tag | `rust-v0.144.0-alpha.4` |
| Codex source commit | `049586f41571e74b44c841868bca3a2233214a71` |
| Computer Use plugin | `1.0.1000387` |
| Native service | `26.710.1000387` |
| Bundled Node | `24.14.0` |

The current V7 desktop snapshot is `26.707.61608 (5200)`. Historical chapters
remain pinned to the build they originally measured. Current Electron,
Codex, node_repl, plugin, and service fingerprints live in:

```text
fixtures/electron/evidence.json
fixtures/electron/presentation-contract.json
fixtures/model-tool-surface/plugin-model-context.json
```

Every reproduction run should print the current values and report drift before
interpreting a mismatch.

## Evidence Classes

### Class A: Live Runtime Evidence

Examples:

- process parent-child relationships;
- file descriptors and Unix sockets;
- the installed config's enabled/disabled MCP servers;
- a sanitized summary of a real Responses request;
- a read-only app-server handshake.

Class A proves current behavior on this machine, but snapshots such as process
counts are time-dependent.

### Class B: Shipped Source And Schemas

Examples:

- bundled `@oai/sky` JavaScript;
- Computer Use skill and plugin manifest;
- generated app-server JSON Schema and TypeScript;
- `node_repl` embedded kernel source recovered from its binary.

Class B describes the exact shipped artifact. It is stronger than online docs
for private implementation details.

### Class C: Exact Version Open Source

The embedded Codex version maps to:

```text
tag: rust-v0.144.0-alpha.4
commit: 049586f41571e74b44c841868bca3a2233214a71
```

Class C is used for function-level call paths inside app-server, MCP routing,
Responses conversion, approvals, and protocol types.

### Class D: Binary Static Inference

Examples:

- Swift symbols;
- linked frameworks;
- error strings;
- class and protocol names;
- sampled stacks.

Class D establishes that code exists in the binary. It does not by itself prove
that a branch is active in the current Node-based Computer Use path.

## Reproduction Principles

1. Prefer a fake service over the real desktop executor.
2. Prefer a private child app-server over the running desktop app-server.
3. Save normalized fixtures, not raw logs.
4. Redact before writing to disk.
5. Assert negative facts, such as the absence of a Responses `computer` tool.
6. Treat minified symbol names as build-specific.
7. Record exact commands and expected exit status.
8. Separate protocol compatibility from product policy.

## Non-Goals

This lab does not:

- bypass app approval or macOS permissions;
- reverse engineer cryptographic secrets;
- alter signed binaries;
- automate real applications;
- reconstruct private user activity;
- claim that unused XPC or Apple Event code is on the active Node path.

# Reproduction Guide

This chapter is the entry point for running the lab after all component probes
have been generated.

## Prerequisites

- macOS with the inspected Codex App installed at `/Applications/ChatGPT.app`;
- Node.js 22 or newer;
- `sqlite3`, `nm`, `otool`, `codesign`, `plutil`, `strings`, and `bash`;
- the matching Codex source checkout at
  `/private/tmp/openai-codex-rust-v0.144.0-alpha.4`.

## One Command

```bash
cd codex-computer-use-lab
npm run reproduce
```

The runner executes only scripts present in the lab. It stops at the first
failed assertion.

The checked test command uses `--test-concurrency=1`. Several live read-only
tests scan the same large signed binaries, query unified logs, or invoke the
Swift toolchain. Running those tests concurrently creates artificial resource
contention that can exceed bounded timeouts or terminate a build subprocess;
it does not provide useful isolation because every probe is pinned to the same
installed artifacts.

## Expected High-Level Results

1. The sanitized model-tool fixture reports no Responses `computer` tool in
   the base request, while the rollout event sequence shows `tool_search`
   before `mcp__node_repl.js`.
2. The private app-server probe completes initialization and one read-only RPC.
3. The `node_repl` probe lists `js`, preserves a binding, rejects `process`, and
   emits an in-memory image.
4. The mock Sky service captures `CodexComputerUseIPC-2` requests without
   contacting the real CUA socket.
5. Static native evidence includes AX, ScreenCaptureKit, CGEvent, sender auth,
   URL blocklist, session, and lock-screen components.
6. Electron evidence shows the `node-repl` plugin variant and disabled legacy
   Computer Use MCP.
7. Security evidence confirms read-only collection and no secret-like output.
8. The synthetic test app builds with the pinned bundle identifier and no
   network entitlement.
9. Display geometry, bounded native callgraph, policy, observability, and the
   real-CUA dry-run plan regenerate without sending a production action.

## Running A Single Layer

```bash
npm run collect:model-surface
node scripts/app-server-probe.mjs
node scripts/node-repl-mcp-probe.mjs
node scripts/sky-client-wire-probe.mjs
node scripts/wrapper-policy-probe.mjs
bash test-app/build.sh
bash scripts/display-geometry-probe.sh --out fixtures/display/current.json
bash scripts/native-symbol-map.sh
bash scripts/native-callgraph.sh
node scripts/extract-electron-cu-evidence.mjs
node scripts/electron-presentation-contract-probe.mjs \
  --out fixtures/electron/presentation-contract.json
node scripts/native-last-window-probe.mjs \
  --out fixtures/native/last-window.json
node scripts/native-oop-targeting-probe.mjs \
  --out fixtures/native/oop-targeting.json
bash scripts/extract-policy-evidence.sh \
  --codex-source /private/tmp/openai-codex-rust-v0.144.0-alpha.4
bash scripts/collect-observability-evidence.sh
bash scripts/collect-readonly-security-evidence.sh
node scripts/real-cua-lab-runner.mjs \
  --out fixtures/real-cua/dry-run-plan.json
npm run verify
```

The unified runner never uses `--execute` for the real CUA harness. Production
observation is intentionally excluded because it requires an unlocked screen,
the running synthetic app, and an action-time session approval.

`collect:model-surface` is pinned to the task used to build this lab so the
collector does not scan unrelated prompt bodies in the large global log
database. Pass another `--thread-id` explicitly when reproducing on a new task.

The collector parses the JSON object boundary itself because current transport
logs can include tracing text before or after the request and JavaScript output
with escapes such as `\x7f` that are not strict JSON escapes. It repairs only
invalid escapes inside JSON strings and writes only a sanitized structural
summary.

## Interpreting Version Drift

If any installed version differs from the pinned table in
`docs/00-methodology.md`, regenerate app-server schemas and repeat static
extraction before treating a test failure as a product regression.

Do not edit the old fixture to make a new build pass. Store a new fixture with
the build version and document the protocol difference.

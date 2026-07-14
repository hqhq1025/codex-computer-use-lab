# App-Server To Responses, ToolRouter, And MCP

## Scope And Safety

This chapter pins the protocol path to the installed binary
`/Applications/ChatGPT.app/Contents/Resources/codex`, which reports
`codex-cli 0.144.0-alpha.4`, and to the exact source checkout
`/private/tmp/openai-codex-rust-v0.144.0-alpha.4` at tag
`rust-v0.144.0-alpha.4`, commit
`049586f41571e74b44c841868bca3a2233214a71`.

The live probe stops after `initialize`, `initialized`, and `thread/list`. It
does not call `thread/start`, `turn/start`, `model/list`, an MCP tool, a file
mutation RPC, or Computer Use. The longer model/tool path below is source-level
tracing only.

## Evidence Labels

- **Confirmed-runtime**: observed from the private child process and recorded in
  `fixtures/app-server/probe.json`.
- **Confirmed-source**: directly established by the exact tagged source or its
  generated schema.
- **Inferred**: a composition of confirmed code paths that was not executed by
  this safety-constrained probe.

## Wire Contract And Handshake

**Confirmed-source.** App-server uses JSON-RPC-shaped objects but omits the
`"jsonrpc":"2.0"` member. Stdio framing is one JSON object followed by one
newline:

| Symbol | Exact source |
|---|---|
| `JSONRPCMessage`, `JSONRPCRequest`, `JSONRPCNotification` | `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server-protocol/src/rpc.rs:1-79` |
| `start_stdio_connection` read loop | `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server-transport/src/transport/stdio.rs:24-80` |
| `start_stdio_connection` write loop and newline append | `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server-transport/src/transport/stdio.rs:82-100` |
| `InitializeParams`, `InitializeCapabilities`, `InitializeResponse` | `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server-protocol/src/protocol/v1.rs:27-74` |
| `ClientNotification::Initialized` | `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server-protocol/src/protocol/common.rs:1712-1714` |

The minimum wire sequence used by the probe is:

```json
{"id":"probe-initialize","method":"initialize","params":{"clientInfo":{"name":"codex_computer_use_lab_probe","title":"Codex Computer Use Lab Probe","version":"0.1.0"},"capabilities":{"experimentalApi":false,"requestAttestation":false,"mcpServerOpenaiFormElicitation":false}}}
{"id":"probe-initialize","result":{"userAgent":"codex_cli_rs/0.144.0-alpha.4 (...)","codexHome":"<temporary-codex-home>","platformFamily":"unix","platformOs":"macos"}}
{"method":"initialized"}
{"id":"probe-thread-list","method":"thread/list","params":{"limit":1,"useStateDbOnly":true}}
{"id":"probe-thread-list","result":{"data":[],"nextCursor":null}}
```

Every displayed object is one physical JSONL line. The exact normalized capture
may contain harmless server notifications between these lines.

### Initialization State

**Confirmed-source.**

1. `MessageProcessor::process_request` deserializes a raw request into
   `ClientRequest` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/message_processor.rs:506-557`.
2. `MessageProcessor::handle_client_request` special-cases `initialize` before
   initialized-request dispatch at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/message_processor.rs:742-785`.
3. `InitializeRequestProcessor::initialize` validates `clientInfo`, commits the
   per-connection `InitializedConnectionSessionState`, and sends the response at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/request_processors/initialize_processor.rs:44-155`.
4. The transport loop mirrors session capabilities, sends initialization-time
   notifications, and sets `outbound_initialized` after the initialize request
   at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/lib.rs:1018-1083`.
5. A later non-initialize request is rejected with `Not initialized` unless the
   session state is present at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/message_processor.rs:787-849`.

An important version-specific detail is that
`MessageProcessor::process_notification` only logs client notifications at
`/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/message_processor.rs:608-618`.
Therefore `initialized` is protocol-compatible acknowledgement, but the stdio
connection's effective request gate has already opened after `initialize`.

### Read-Only Probe RPC

**Confirmed-source and confirmed-runtime.** The generated client schema names
`thread/list` at
`/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server-protocol/schema/json/ClientRequest.json:5250-5272`.
Its parameters are generated at
`/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server-protocol/schema/json/v2/ThreadListParams.json:1-139`.

The dispatch and implementation are:

| Symbol | Exact source |
|---|---|
| `ClientRequest::ThreadList` definition | `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server-protocol/src/protocol/common.rs:621-626` |
| `MessageProcessor` dispatch | `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/message_processor.rs:1129-1131` |
| `ThreadRequestProcessor::thread_list` | `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/request_processors/thread_processor.rs:693-700` |
| `thread_list_response_inner` local-store query | `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/request_processors/thread_processor.rs:1956-2045` |

The probe sets fresh temporary `HOME`, `cwd`, and `CODEX_HOME` values, requests
`useStateDbOnly: true`, disables remote control through
`CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED=1`, closes stdin after the
response, and deletes the temporary home. This prevents reading the user's real
thread store or project-local configuration. App-server may create its own state
files inside that temporary directory during startup; the probe does not issue
any write RPC.

`model/list` is deliberately not used. **Confirmed-source:**
`CatalogRequestProcessor::model_list` calls `supported_models`, and
`supported_models` requests `RefreshStrategy::OnlineIfUncached` at
`/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/request_processors/catalog_processor.rs:156-167`
and
`/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/models.rs:13-24`.
That is a read API semantically, but it is less hermetic because it may refresh
the catalog over the network.

## Source-Level Thread And Turn Entry

The following path is **confirmed-source** but not invoked by the probe.

1. `ClientRequest::ThreadStart` maps the `"thread/start"` wire method at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server-protocol/src/protocol/common.rs:482-487`.
2. `MessageProcessor` dispatches it to
   `ThreadRequestProcessor::thread_start` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/message_processor.rs:1008-1019`.
3. `thread_start_inner` validates settings and spawns `thread_start_task` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/request_processors/thread_processor.rs:930-1034`.
4. `ClientRequest::TurnStart` maps `"turn/start"` and serializes by thread id at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server-protocol/src/protocol/common.rs:805-810`.
5. `MessageProcessor` dispatches it at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/message_processor.rs:1238-1249`.
6. `TurnRequestProcessor::turn_start_inner` maps v2 input to core input, builds
   `Op::UserInput`, and calls
   `submit_user_input_with_client_user_message_id` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/app-server/src/request_processors/turn_processor.rs:442-568`.

## Responses Request And SSE Decode

**Confirmed-source.**

1. The core turn loop clones prompt history and calls `run_sampling_request` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/session/turn.rs:270-295`.
2. `run_sampling_request` builds a `ToolRouter`; `build_prompt` inserts
   `router.model_visible_specs()` into the Responses request at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/session/turn.rs:1083-1100`
   and
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/session/turn.rs:1112-1168`.
3. `ModelClientSession::stream` selects Responses WebSocket when enabled and
   otherwise calls HTTP `stream_responses_api` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/client.rs:1766-1815`.
4. The HTTP path builds `ApiResponsesClient`, posts the request, and obtains the
   typed stream at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/client.rs:1379-1465`.
5. `ResponsesClient::stream_request` encodes the body and requests
   `text/event-stream` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/codex-api/src/endpoint/responses.rs:60-97`
   and
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/codex-api/src/endpoint/responses.rs:128-150`.
6. `process_responses_event` maps SSE kinds such as
   `response.output_item.done`, `response.output_text.delta`,
   `response.created`, `response.completed`, and
   `response.output_item.added` into `ResponseEvent` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/codex-api/src/sse/responses.rs:326-469`.
7. `try_run_sampling_request` consumes those events and routes completed output
   items to `handle_output_item_done` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/session/turn.rs:1941-2135`.

## ToolRouter To MCP

**Confirmed-source.**

1. `built_tools` resolves MCP tools and constructs `ToolRouter` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/session/turn.rs:1217-1349`.
2. `handle_output_item_done` calls `ToolRouter::build_tool_call`, persists the
   model-emitted tool item, and queues `ToolCallRuntime::handle_tool_call` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/stream_events_utils.rs:317-357`.
3. `ToolRouter::build_tool_call` converts Responses `FunctionCall`,
   client-executed `ToolSearchCall`, or `CustomToolCall` items into an internal
   `ToolCall` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/tools/router.rs:112-160`.
4. `ToolCallRuntime` enforces parallel/serial execution and calls
   `ToolRouter::dispatch_tool_call_with_terminal_outcome` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/tools/parallel.rs:74-201`.
5. `ToolRouter` creates a `ToolInvocation` and dispatches through the registry at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/tools/router.rs:186-244`.
6. For an MCP tool, `McpHandler::handle_call` invokes
   `handle_mcp_tool_call` and wraps the result as `McpToolOutput` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/tools/handlers/mcp.rs:120-162`.
7. `execute_mcp_tool_call` calls the step's `McpConnectionManager::call_tool`
   at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/mcp_tool_call.rs:566-616`.
8. The manager selects the named server, applies its tool filter, and delegates
   at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/codex-mcp/src/connection_manager.rs:754-773`.
9. The RMCP client emits a `tools/call` request and awaits
   `ServerResult::CallToolResult` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/rmcp-client/src/rmcp_client.rs:599-654`.

No part of this chain implies that app-server itself performs native Computer
Use. App-server/core routes a model tool call to the registered executor; the
executor's implementation and policy boundary are separate layers.

## MCP Result Reinjection

**Confirmed-source.**

1. `McpToolOutput::to_response_item` converts the MCP result to
   `ResponseInputItem::FunctionCallOutput` with the original `call_id` at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/tools/context.rs:77-96`.
2. `McpToolOutput::response_payload` adds timing context, preserves structured
   content where supported, sanitizes image detail, and truncates model-visible
   output at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/tools/context.rs:113-143`.
3. `drain_in_flight` converts the completed tool future into a response item and
   records it in conversation history at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/session/turn.rs:1891-1915`.
4. A tool call set `needs_follow_up = true` when it was queued, and the outer
   turn loop performs another sampling request from the updated history at
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/stream_events_utils.rs:348-356`
   and
   `/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs/core/src/session/turn.rs:297-372`.

Thus "result reinjection" is not an extra frame on the already completed SSE
request. The MCP result becomes a `function_call_output` history item, and the
turn loop sends a subsequent Responses request containing that item.

## End-To-End Status

```text
app-server JSONL
  initialize -> initialized -> thread/list                 confirmed-runtime

thread/start -> turn/start -> Op::UserInput                 confirmed-source
  -> Responses HTTP/WebSocket request                       confirmed-source
  -> SSE ResponseEvent                                      confirmed-source
  -> ToolRouter -> MCP tools/call                           confirmed-source
  -> FunctionCallOutput -> next Responses request           confirmed-source

The full chain as one live Computer Use turn                not executed; inferred
```

The final line is intentionally not promoted to runtime proof. This lab's
app-server probe verifies protocol mechanics without triggering a model task,
an MCP call, file mutation, or real Computer Use.

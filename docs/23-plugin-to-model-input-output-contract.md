# Plugin To Model Input And Output Contract

## Three independent model inputs

Computer Use reaches the model through three distinct prompt surfaces. They
must not be described as one prompt blob.

### Initial skill catalog

The initial developer context lists only:

```text
name
description
path
```

For Computer Use the current entry is:

```text
computer-use:computer-use
Control local Mac apps through Computer Use...
<cache>/skills/computer-use/SKILL.md
```

The 12,942-byte SKILL body is not included in this catalog.

### Explicit skill injection

When a structured skill mention or an unambiguous `$skill-name` mention
selects the skill, Codex reads the complete `SKILL.md` and injects a user
fragment:

```xml
<skill>
<name>...</name>
<path>...</path>
complete SKILL.md body
</skill>
```

The current source proves this path, but the lab did not retain a production
request body containing the full skill. The fixture records only body size and
SHA-256.

### node_repl MCP initialize instructions

`node_repl` independently returns MCP server instructions. The current
instructions include the Browser, Chrome, and Computer Use use cases.
Codex stores those instructions as `server_instructions`, converts them to
the namespace description, and places that description in `tool_search`.

This text is neither the skill catalog nor the full skill body.

## Deferred tool discovery

The observed Responses request has `tool_search`, but no top-level native
`computer` tool and no top-level `mcp__node_repl` namespace.

The sequence is:

```text
tool_search call
  -> tool_search_output exposes mcp__node_repl.js
  -> model emits namespace=mcp__node_repl, name=js
  -> ToolRouter invokes MCP tools/call
```

BM25 search text includes the canonical tool name, callable name, raw MCP
name, server name, title, description, namespace description, and schema
property names.

One schema detail is lost during deferred exposure: the raw MCP schema has
`timeout_ms.minimum=1` and `title.minLength=1/maxLength=80`; the observed
`tool_search_output` retained types, required fields, and
`additionalProperties:false`, but not those bounds.

## Wrapper and facade

The injected skill instructs the model to import the plugin-owned wrapper:

```text
scripts/computer-use-client.mjs
```

The wrapper locates the packaged `@oai/sky` module through
`NODE_REPL_NODE_MODULE_DIRS`, imports the compiled mac
`create_client.js`, and calls:

```js
create_client({ target: "mac" })
```

The ten `sky.*` methods are JavaScript facade methods. They are not ten MCP
tools and they do not appear in the Responses tool list.

## One result, two projections

The MCP `CallToolResult` splits:

```text
model projection
  -> structuredContent when present
  -> otherwise content
  -> _meta omitted

Desktop event projection
  -> full result including _meta below 1 MiB
  -> _meta["codex/toolSurface"] late-binds node_repl to Computer Use
```

The mac policy wrapper sets:

```json
{
  "codex/toolSurface": {
    "kind": "computerUse",
    "app": {
      "kind": "appId",
      "appId": "..."
    }
  }
}
```

The started Desktop item has no result metadata and remains a generic
`node_repl` item. The completed item can become a standalone Computer Use
item.

If the serialized MCP result exceeds 1,048,576 bytes, the app-server event
copy becomes text-only and clears `structuredContent` and `_meta`. The model
still receives its normal result path, but Desktop loses the Computer Use
late-binding identity.

## Reproduction

```bash
node scripts/plugin-model-context-probe.mjs \
  --out fixtures/model-tool-surface/plugin-model-context.json

node --test tests/plugin-model-context.test.mjs
```

The probe hashes prompt bodies but does not persist them. It does not collect
tool arguments, screenshots, or application data.

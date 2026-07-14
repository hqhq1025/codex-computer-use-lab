#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const EVENT_RESULT_CAP_BYTES = 1024 * 1024;
export const CODEX_SOURCE_ROOT =
  "/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs";
export const MCP_TOOL_CALL_SOURCE = path.join(
  CODEX_SOURCE_ROOT,
  "core",
  "src",
  "mcp_tool_call.rs"
);
export const PTY_SOURCE = path.join(
  CODEX_SOURCE_ROOT,
  "utils",
  "pty",
  "src",
  "lib.rs"
);
export const MODELS_SOURCE = path.join(
  CODEX_SOURCE_ROOT,
  "protocol",
  "src",
  "models.rs"
);
export const RESUME_REDACTION_SOURCE = path.join(
  CODEX_SOURCE_ROOT,
  "app-server",
  "src",
  "request_processors",
  "thread_resume_redaction.rs"
);

const COMPUTER_USE_META = Object.freeze({
  "codex/toolSurface": {
    kind: "computerUse",
    app: {
      kind: "appId",
      appId: "com.openai.codex.cualab"
    }
  }
});

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function sourceForUi(server, result) {
  const surface = server === "node_repl"
    ? result?._meta?.["codex/toolSurface"]
    : null;
  return surface?.kind === "computerUse"
    ? {
        kind: "computerUse",
        app: surface.app
      }
    : null;
}

function makeResult(textLength) {
  return {
    content: [
      {
        type: "text",
        text: "x".repeat(textLength)
      }
    ],
    _meta: COMPUTER_USE_META
  };
}

function textLengthForSerializedBytes(targetBytes) {
  const emptyBytes = serializedBytes(makeResult(0));
  const textLength = targetBytes - emptyBytes;
  if (textLength < 0) {
    throw new Error("Target is smaller than the fixed CallToolResult overhead");
  }
  const result = makeResult(textLength);
  if (serializedBytes(result) !== targetBytes) {
    throw new Error("Unable to construct exact serialized byte target");
  }
  return textLength;
}

function truncateForEvent(result) {
  const bytes = serializedBytes(result);
  if (bytes <= EVENT_RESULT_CAP_BYTES) {
    return structuredClone(result);
  }
  const serialized = JSON.stringify(result);
  return {
    content: [
      {
        type: "text",
        text: serialized.slice(0, EVENT_RESULT_CAP_BYTES)
      }
    ],
    structuredContent: null,
    isError: result.isError ?? null,
    _meta: null
  };
}

function modelPayload(result, supportsImageInput = true) {
  const content = supportsImageInput
    ? result.content
    : result.content.map((block) =>
        block?.type === "image"
          ? {
              type: "text",
              text: "<image content omitted because you do not support image input>"
            }
          : block
      );
  if (
    result.structuredContent !== undefined &&
    result.structuredContent !== null
  ) {
    return {
      bodyType: "text",
      body: JSON.stringify(result.structuredContent),
      success: result.isError !== true
    };
  }
  const hasImage = content.some((block) => block?.type === "image");
  return {
    bodyType: hasImage ? "contentItems" : "text",
    body: hasImage ? content : JSON.stringify(content),
    success: result.isError !== true
  };
}

export async function runMcpEventTruncationProbe({ outputPath } = {}) {
  const [mcpSource, ptySource, modelsSource, resumeSource] = await Promise.all([
    readFile(MCP_TOOL_CALL_SOURCE, "utf8"),
    readFile(PTY_SOURCE, "utf8"),
    readFile(MODELS_SOURCE, "utf8"),
    readFile(RESUME_REDACTION_SOURCE, "utf8")
  ]);
  const exactTextLength = textLengthForSerializedBytes(
    EVENT_RESULT_CAP_BYTES
  );
  const cases = [
    {
      id: "cap",
      original: makeResult(exactTextLength)
    },
    {
      id: "cap-plus-one",
      original: makeResult(exactTextLength + 1)
    }
  ].map((entry) => {
    const eventResult = truncateForEvent(entry.original);
    return {
      id: entry.id,
      serializedBytes: serializedBytes(entry.original),
      originalTextCharacters: entry.original.content[0].text.length,
      eventMetaPresent: eventResult._meta != null,
      eventStructuredContent:
        eventResult.structuredContent === undefined
          ? "omitted"
          : eventResult.structuredContent,
      eventContentBlockCount: eventResult.content.length,
      desktopSource: sourceForUi("node_repl", eventResult),
      nonNodeReplSource: sourceForUi("other-server", eventResult)
    };
  });

  const fixture = {
    schemaVersion: 1,
    source: {
      codexTag: "rust-v0.144.0-alpha.4",
      eventCapBytes: EVENT_RESULT_CAP_BYTES,
      defaultCapMarkerPresent: /DEFAULT_OUTPUT_BYTES_CAP:\s*usize\s*=\s*1024\s*\*\s*1024/.test(
        ptySource
      ),
      eventUsesDefaultCap:
        /MCP_TOOL_CALL_EVENT_RESULT_MAX_BYTES:\s*usize\s*=\s*DEFAULT_OUTPUT_BYTES_CAP/.test(
          mcpSource
        ),
      oversizedClearsMeta:
        /structured_content:\s*None[\s\S]*meta:\s*None/.test(mcpSource)
      ,
      structuredContentPrecedesContent:
        /if let Some\(structured_content\)[\s\S]*FunctionCallOutputBody::Text\(serialized_structured_content\)/.test(
          modelsSource
        ),
      textOnlySerializesContent:
        /serde_json::to_string\(&self\.content\)/.test(modelsSource),
      remoteResumeClearsMeta:
        /structured_content:\s*None[\s\S]*meta:\s*None/.test(resumeSource),
      remoteResumeRemovesImageGeneration:
        /ThreadItem::ImageGeneration\(_\)\s*=>\s*false/.test(resumeSource)
    },
    uiContract: {
      serverMustEqual: "node_repl",
      metaKey: "codex/toolSurface",
      computerUseKind: "computerUse",
      bindingPhase: "item/completed"
    },
    modelContract: {
      structured: modelPayload({
        content: [
          { type: "text", text: "ignored text" },
          { type: "image", data: "ignored-image", mimeType: "image/png" }
        ],
        structuredContent: { answer: 42 },
        isError: false,
        _meta: COMPUTER_USE_META
      }),
      imageCapable: modelPayload({
        content: [
          { type: "text", text: "visible text" },
          {
            type: "image",
            data: "AA==",
            mimeType: "image/png"
          }
        ],
        isError: false,
        _meta: COMPUTER_USE_META
      }),
      textOnlyModel: modelPayload(
        {
          content: [
            { type: "text", text: "visible text" },
            {
              type: "image",
              data: "AA==",
              mimeType: "image/png"
            }
          ],
          isError: true,
          _meta: COMPUTER_USE_META
        },
        false
      ),
      topLevelMetaIncludedInBody: false,
      topLevelIsErrorIncludedInBody: false
    },
    remoteResumeContract: {
      arguments: "[redacted]",
      resultContent: [
        {
          type: "text",
          text: "[redacted]"
        }
      ],
      structuredContent: null,
      meta: null,
      errorMessage: "[redacted]",
      imageGenerationItemRetained: false
    },
    cases
  };

  if (outputPath) {
    const absolute = path.resolve(outputPath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, `${JSON.stringify(fixture, null, 2)}\n`);
  }
  return fixture;
}

async function main() {
  const outputPath =
    argumentValue("--out") ??
    "fixtures/electron/mcp-event-truncation.json";
  const fixture = await runMcpEventTruncationProbe({ outputPath });
  process.stdout.write(
    `${JSON.stringify({
      outputPath: path.resolve(outputPath),
      cases: fixture.cases
    }, null, 2)}\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}

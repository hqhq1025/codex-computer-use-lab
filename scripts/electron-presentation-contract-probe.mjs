#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync
} from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_ASAR =
  "/Applications/ChatGPT.app/Contents/Resources/app.asar";
export const DEFAULT_CODEX_SOURCE =
  "/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs";

const TITLE_LIMIT = 80;
const COMPUTER_USE_META = {
  "codex/toolSurface": {
    kind: "computerUse",
    app: {
      kind: "appId",
      appId: "com.openai.codex.cualab"
    }
  }
};

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readExactly(fileDescriptor, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = readSync(
      fileDescriptor,
      buffer,
      offset,
      buffer.length - offset,
      position + offset
    );
    if (bytesRead === 0) {
      throw new Error(`Unexpected end of ASAR at byte ${position + offset}`);
    }
    offset += bytesRead;
  }
}

function openAsar(asarPath) {
  const fileDescriptor = openSync(asarPath, "r");
  try {
    const sizePickle = Buffer.alloc(8);
    readExactly(fileDescriptor, sizePickle, 0);
    const headerSize = sizePickle.readUInt32LE(4);
    const headerPickle = Buffer.alloc(headerSize);
    readExactly(fileDescriptor, headerPickle, 8);
    const headerStringSize = headerPickle.readUInt32LE(4);
    const header = JSON.parse(
      headerPickle.subarray(8, 8 + headerStringSize).toString("utf8")
    );
    const dataStart = 8 + headerSize;
    const entries = [];

    function visit(node, prefix = "") {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const archivePath = prefix ? `${prefix}/${name}` : name;
        if (entry.files) {
          visit(entry, archivePath);
          continue;
        }
        entries.push({
          path: archivePath,
          size: entry.size ?? 0,
          offset: entry.unpacked ? null : dataStart + Number(entry.offset),
          unpacked: entry.unpacked === true
        });
      }
    }

    visit(header);
    return {
      bytes: fstatSync(fileDescriptor).size,
      entries,
      fileDescriptor
    };
  } catch (error) {
    closeSync(fileDescriptor);
    throw error;
  }
}

function readArchiveEntry(archive, entry) {
  if (entry.unpacked || entry.offset == null) {
    throw new Error(`Cannot read unpacked ASAR entry ${entry.path}`);
  }
  const buffer = Buffer.alloc(entry.size);
  readExactly(archive.fileDescriptor, buffer, entry.offset);
  return buffer.toString("utf8");
}

function isLocaleAsset(entryPath) {
  return /(?:^|\/)[a-z]{2}(?:-[A-Z]{2})?-[A-Za-z0-9_-]+\.js$/u.test(
    entryPath
  );
}

function markerExpression(marker) {
  if (typeof marker === "string") {
    return marker;
  }
  return new RegExp(marker.source, marker.flags.replace(/[gy]/gu, ""));
}

function markerMatch(content, marker) {
  const expression = markerExpression(marker);
  if (typeof expression === "string") {
    const offset = content.indexOf(expression);
    return offset < 0
      ? null
      : {
          anchor: expression,
          offset
        };
  }
  const match = expression.exec(content);
  return match == null
    ? null
    : {
        anchor: match[0],
        offset: match.index
      };
}

function markerDescription(marker) {
  return typeof marker === "string" ? marker : `/${marker.source}/`;
}

function javascriptCandidates(archive) {
  return archive.entries
    .filter(
      (entry) =>
        entry.path.endsWith(".js") &&
        !entry.unpacked &&
        !entry.path.includes("/locales/") &&
        !isLocaleAsset(entry.path) &&
        entry.size >= 50_000
    )
    .sort((left, right) => right.size - left.size);
}

function selectSource(
  archive,
  role,
  { optional = [], required },
  contentCache
) {
  const matches = [];

  for (const entry of javascriptCandidates(archive)) {
    let content = contentCache.get(entry.path);
    if (content == null) {
      content = readArchiveEntry(archive, entry);
      contentCache.set(entry.path, content);
    }
    if (!required.every((marker) => markerMatch(content, marker) != null)) {
      continue;
    }
    matches.push({
      content,
      entry,
      score: optional.filter((marker) => markerMatch(content, marker) != null)
        .length
    });
  }

  matches.sort(
    (left, right) =>
      right.score - left.score || right.entry.size - left.entry.size
  );
  if (matches.length > 0) {
    return matches[0];
  }

  throw new Error(
    `Could not locate ${role} with semantic markers ${required
      .map(markerDescription)
      .join(", ")}`
  );
}

function sourceAnchor(source, marker) {
  const match = markerMatch(source.content, marker);
  if (match == null) {
    throw new Error(
      `Missing ${markerDescription(marker)} in ${source.entry.path}`
    );
  }
  return match;
}

function describeSource(source, anchors) {
  return {
    path: source.entry.path,
    bytes: source.entry.size,
    sha256: sha256Bytes(source.content),
    anchors: anchors.map((anchor) => sourceAnchor(source, anchor))
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function findFunction(source, role, signature) {
  const expression = new RegExp(
    signature.source,
    signature.flags.includes("g") ? signature.flags : `${signature.flags}g`
  );
  const match = expression.exec(source.content);
  if (match == null) {
    throw new Error(
      `Could not locate ${role} function in ${source.entry.path}`
    );
  }
  const nextFunction = source.content.indexOf(
    "function ",
    match.index + match[0].length
  );
  return {
    declaration: match[0],
    end: nextFunction < 0 ? source.content.length : nextFunction,
    name: match[1],
    start: match.index
  };
}

function functionByName(source, role, name) {
  return findFunction(
    source,
    role,
    new RegExp(`function\\s+(${escapeRegExp(name)})\\(`, "u")
  );
}

function functionContent(source, definition) {
  return source.content.slice(definition.start, definition.end);
}

function caseContent(source, marker) {
  const start = source.content.indexOf(marker);
  if (start < 0) {
    throw new Error(`Missing ${marker} in ${source.entry.path}`);
  }
  const end = source.content.indexOf("case`", start + marker.length);
  return source.content.slice(start, end < 0 ? source.content.length : end);
}

function sharedItemMutationHelper(startedCase, completedCase) {
  const calls = new Map();
  const expression =
    /\b([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)/gu;

  for (const match of completedCase.matchAll(expression)) {
    const key = `${match[1]}(${match[2]},${match[3]})`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
  }

  return (
    [...calls.entries()]
      .filter(([, count]) => count >= 2)
      .map(([call]) => call)
      .find((call) => startedCase.includes(call)) ?? null
  );
}

function exportedAlias(source, functionName) {
  const expression = new RegExp(
    `(?:^|,)${escapeRegExp(functionName)} as ([A-Za-z_$][\\w$]*)(?=,|\\})`,
    "gu"
  );
  return [...source.content.matchAll(expression)].at(-1)?.[1] ?? null;
}

function importedAlias(source, importedSourcePath, exportName) {
  if (exportName == null) {
    return null;
  }
  const fileName = path.basename(importedSourcePath);
  const imports = source.content.matchAll(
    /import\{([^}]*)\}from"([^"]+)"/gu
  );
  for (const match of imports) {
    if (path.basename(match[2]) !== fileName) {
      continue;
    }
    const binding = new RegExp(
      `(?:^|,)${escapeRegExp(exportName)} as ([A-Za-z_$][\\w$]*)(?=,|$)`,
      "u"
    ).exec(match[1]);
    if (binding != null) {
      return binding[1];
    }
  }
  return null;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function normalizeTitle(value) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return null;
  }
  return normalized.length <= TITLE_LIMIT
    ? normalized
    : `${normalized.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
}

function nodeReplDeclaredTitle({ toolName, toolArguments }) {
  if (toolName.trim().toLowerCase() !== "js") {
    return null;
  }
  const title = toolArguments?.title;
  return typeof title === "string" ? normalizeTitle(title) : null;
}

function directComputerUseLabel({ completed, toolName, toolArguments }) {
  const app = toolArguments?.app;
  const suffix =
    typeof app === "string" && app.trim() ? ` in ${app.trim()}` : "";
  switch (toolName) {
    case "click":
      return `${completed ? "Clicked" : "Clicking"}${suffix}`;
    case "drag":
      return `${completed ? "Dragged" : "Dragging"}${suffix}`;
    case "get_app_state":
      return `${completed ? "Looked" : "Looking"}${suffix}`;
    case "scroll": {
      const direction = toolArguments?.direction;
      const detail =
        typeof direction === "string" && direction.trim()
          ? ` ${direction.trim().toLowerCase()}`
          : "";
      return `${completed ? "Scrolled" : "Scrolling"}${detail}${suffix}`;
    }
    case "set_value":
      return `${completed ? "Set value" : "Setting value"}${suffix}`;
    case "type_text":
      return `${completed ? "Typed text" : "Typing text"}${suffix}`;
    default:
      return null;
  }
}

function displayLabel({
  completed,
  result,
  serverName,
  toolArguments,
  toolName
}) {
  const declaredTitle = nodeReplDeclaredTitle({ toolName, toolArguments });
  if (declaredTitle != null) {
    return {
      label: declaredTitle,
      source: "node-repl-title",
      resultTypeConsulted: false
    };
  }
  if (serverName === "computer-use") {
    const label = directComputerUseLabel({
      completed,
      toolName,
      toolArguments
    });
    if (label != null) {
      return {
        label,
        source: "direct-computer-use-formatter",
        resultTypeConsulted: false
      };
    }
  }
  return {
    label: toolName
      .trim()
      .replace(/[_-]+/g, " ")
      .replace(/^./, (character) => character.toUpperCase()),
    source: "generic-tool-name",
    resultTypeConsulted: result != null && false
  };
}

function sourceFromResultMeta(serverName, resultMeta) {
  if (serverName !== "node_repl") {
    return null;
  }
  const surface = resultMeta?.["codex/toolSurface"];
  if (surface?.kind !== "computerUse") {
    return null;
  }
  return {
    kind: "computerUse",
    app: surface.app ?? null
  };
}

function grouping({ serverName, source }) {
  return source?.kind === "computerUse" || serverName === "computer-use"
    ? "standalone"
    : "groupable";
}

function elicitationSuppressionKey(elicitation) {
  switch (elicitation.kind) {
    case "formElicitation":
    case "openaiForm":
    case "generic":
    case "urlAction":
      return elicitation.serverName?.trim() || null;
    case "mcpToolCall":
      return elicitation.approval?.connector_id ?? null;
    case "connectorAuth":
      return elicitation.connector?.connector_id ?? null;
    default:
      return null;
  }
}

function visibleCallsDuringElicitation(calls, elicitations) {
  const suppressedServers = new Set(
    elicitations
      .filter((elicitation) => elicitation.completed !== true)
      .map(elicitationSuppressionKey)
      .filter(Boolean)
  );
  return calls.filter(
    (call) =>
      call.completed === true ||
      !suppressedServers.has(call.invocation.server)
  );
}

function behaviorCases() {
  const startedSource = sourceFromResultMeta("node_repl", null);
  const completedSource = sourceFromResultMeta(
    "node_repl",
    COMPUTER_USE_META
  );
  const failedDirect = displayLabel({
    completed: true,
    result: { type: "error", error: "synthetic failure" },
    serverName: "computer-use",
    toolArguments: { app: "Finder" },
    toolName: "click"
  });

  const calls = [
    {
      callId: "direct-a",
      completed: false,
      invocation: { server: "computer-use", tool: "click" }
    },
    {
      callId: "direct-b",
      completed: false,
      invocation: { server: "computer-use", tool: "scroll" }
    },
    {
      callId: "node-repl",
      completed: false,
      invocation: { server: "node_repl", tool: "js" }
    }
  ];
  const pendingComputerUseElicitation = {
    completed: false,
    kind: "mcpToolCall",
    approval: {
      connector_id: "computer-use"
    }
  };

  return {
    titleCases: {
      declared: displayLabel({
        completed: false,
        result: null,
        serverName: "node_repl",
        toolArguments: {
          code: "await sky.click({ app: 'Finder', x: 1, y: 2 })",
          title: "  Clicking   in Finder  "
        },
        toolName: "js"
      }),
      codeOnly: displayLabel({
        completed: false,
        result: null,
        serverName: "node_repl",
        toolArguments: {
          code: "await sky.click({ app: 'Finder', x: 1, y: 2 })"
        },
        toolName: "js"
      }),
      truncated: displayLabel({
        completed: false,
        result: null,
        serverName: "node_repl",
        toolArguments: {
          title: "x".repeat(90)
        },
        toolName: "js"
      })
    },
    resultTimeIdentity: {
      started: {
        source: startedSource,
        grouping: grouping({
          serverName: "node_repl",
          source: startedSource
        })
      },
      completed: {
        source: completedSource,
        grouping: grouping({
          serverName: "node_repl",
          source: completedSource
        })
      }
    },
    failedDirectComputerUse: {
      resultType: "error",
      completed: true,
      label: failedDirect.label,
      formatterConsultedResultType: failedDirect.resultTypeConsulted
    },
    elicitationCorrelation: {
      suppressionKey: elicitationSuppressionKey(
        pendingComputerUseElicitation
      ),
      visibleCallIds: visibleCallsDuringElicitation(
        calls,
        [pendingComputerUseElicitation]
      ).map((call) => call.callId),
      hiddenCallIds: calls
        .filter(
          (call) =>
            !visibleCallsDuringElicitation(
              calls,
              [pendingComputerUseElicitation]
            ).includes(call)
        )
        .map((call) => call.callId)
    }
  };
}

async function sourceEvidence({ asarPath, codexSourceRoot }) {
  const archive = openAsar(asarPath);
  try {
    const contentCache = new Map();
    const eventLifecycle = selectSource(
      archive,
      "MCP event lifecycle",
      {
        required: [
          "case`item/started`",
          "case`item/completed`",
          "case`item/mcpToolCall/progress`",
          "Ignoring mcpToolCall progress message"
        ]
      },
      contentCache
    );
    const formatter = selectSource(
      archive,
      "Computer Use formatter and result metadata",
      {
        required: [
          "codex.mcpTool.computerUse.click.active",
          "codex/toolSurface",
          "if(t!==`node_repl`||e==null)return null",
          "completed:t.status!==`inProgress`||e.status!==`inProgress`",
          /function\s+[A-Za-z_$][\w$]*\(\{completed:[A-Za-z_$][\w$]*,intl:[A-Za-z_$][\w$]*,nativeDesktopAppMetadata:[A-Za-z_$][\w$]*,platform:[A-Za-z_$][\w$]*=`macOS`,toolArguments:[A-Za-z_$][\w$]*,toolKey:[A-Za-z_$][\w$]*\}\)\{/u
        ]
      },
      contentCache
    );
    const mcpRenderer = selectSource(
      archive,
      "MCP presentation renderer",
      {
        required: [
          "codex.mcpTool.rawOutputTriggerTooltip",
          "case`computer-use`:return",
          /function\s+[A-Za-z_$][\w$]*\(\{completed:[A-Za-z_$][\w$]*,intl:[A-Za-z_$][\w$]*,serverName:[A-Za-z_$][\w$]*,[^}]{0,500}toolResult:[A-Za-z_$][\w$]*,toolName:[A-Za-z_$][\w$]*\}\)\{/u
        ]
      },
      contentCache
    );
    const localConversation = selectSource(
      archive,
      "local conversation grouping and elicitation filtering",
      {
        required: [
          "mcpServerElicitationItems",
          "source?.kind===`computerUse`",
          /case`mcpToolCall`:return\s+[A-Za-z_$][\w$]*\.elicitation\.approval\.connector_id/u,
          /\.filter\([A-Za-z_$][\w$]*=>[A-Za-z_$][\w$]*\.type!==`mcp-tool-call`\|\|[A-Za-z_$][\w$]*\.completed\|\|![A-Za-z_$][\w$]*\.has\([A-Za-z_$][\w$]*\.invocation\.server\)\)/u
        ]
      },
      contentCache
    );

    const directFormatter = findFunction(
      formatter,
      "direct Computer Use formatter",
      /function\s+([A-Za-z_$][\w$]*)\(\{completed:[A-Za-z_$][\w$]*,intl:[A-Za-z_$][\w$]*,nativeDesktopAppMetadata:[A-Za-z_$][\w$]*,platform:[A-Za-z_$][\w$]*=`macOS`,toolArguments:[A-Za-z_$][\w$]*,toolKey:[A-Za-z_$][\w$]*\}\)\{/u
    );
    const presentationFormatter = findFunction(
      mcpRenderer,
      "MCP presentation formatter",
      /function\s+([A-Za-z_$][\w$]*)\(\{completed:[A-Za-z_$][\w$]*,intl:[A-Za-z_$][\w$]*,serverName:[A-Za-z_$][\w$]*,[^}]{0,500}toolResult:[A-Za-z_$][\w$]*,toolName:[A-Za-z_$][\w$]*\}\)\{/u
    );
    const presentationFormatterContent = functionContent(
      mcpRenderer,
      presentationFormatter
    );
    const titleShortCircuit =
      /let\s+([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\{toolArguments:[A-Za-z_$][\w$]*,toolName:[A-Za-z_$][\w$]*\}\);if\(\1!=null\)return \1/u.exec(
        presentationFormatterContent
      );
    if (titleShortCircuit == null) {
      throw new Error(
        `Could not locate node_repl title short circuit in ${mcpRenderer.entry.path}`
      );
    }
    const titleFormatter = functionByName(
      mcpRenderer,
      "node_repl title formatter",
      titleShortCircuit[2]
    );
    const titleFormatterContent = functionContent(
      mcpRenderer,
      titleFormatter
    );
    const directFormatterContent = functionContent(
      formatter,
      directFormatter
    );

    const directFormatterExport = exportedAlias(
      formatter,
      directFormatter.name
    );
    const directFormatterImport = importedAlias(
      mcpRenderer,
      formatter.entry.path,
      directFormatterExport
    );
    const directFormatterDispatch =
      /case`computer-use`:return\s+([A-Za-z_$][\w$]*)/u.exec(
        mcpRenderer.content
      )?.[1] ?? null;

    const startedCase = caseContent(eventLifecycle, "case`item/started`");
    const completedCase = caseContent(
      eventLifecycle,
      "case`item/completed`"
    );
    const itemMutationHelper = sharedItemMutationHelper(
      startedCase,
      completedCase
    );

    const rustPaths = {
      mcpToolCall: path.join(codexSourceRoot, "core/src/mcp_tool_call.rs"),
      mcpSession: path.join(codexSourceRoot, "core/src/session/mcp.rs"),
      loggingClient: path.join(
        codexSourceRoot,
        "rmcp-client/src/logging_client_handler.rs"
      ),
      protocol: path.join(
        codexSourceRoot,
        "app-server-protocol/src/protocol/v2/mcp.rs"
      )
    };
    const [mcpToolCall, mcpSession, loggingClient, protocol] =
      await Promise.all(
        Object.values(rustPaths).map((filePath) => readFile(filePath, "utf8"))
      );

    const progressHandler = loggingClient.slice(
      loggingClient.indexOf("async fn on_progress"),
      loggingClient.indexOf("async fn on_resource_updated")
    );

    return {
      asar: {
        path: asarPath,
        bytes: archive.bytes,
        sha256: sha256File(asarPath)
      },
      selectedFiles: {
        core: describeSource(eventLifecycle, [
          "case`item/started`",
          "case`item/completed`",
          "case`item/mcpToolCall/progress`",
          "Ignoring mcpToolCall progress message"
        ]),
        mcpRenderer: describeSource(mcpRenderer, [
          new RegExp(
            `function\\s+${escapeRegExp(presentationFormatter.name)}\\(`
          ),
          new RegExp(
            `function\\s+${escapeRegExp(titleFormatter.name)}\\(`
          ),
          "case`computer-use`:return",
          "codex.mcpTool.rawOutputTriggerTooltip"
        ]),
        localConversation: describeSource(localConversation, [
          "source?.kind===`computerUse`",
          "mcpServerElicitationItems",
          /case`mcpToolCall`:return\s+[A-Za-z_$][\w$]*\.elicitation\.approval\.connector_id/u,
          /\.filter\([A-Za-z_$][\w$]*=>[A-Za-z_$][\w$]*\.type!==`mcp-tool-call`\|\|[A-Za-z_$][\w$]*\.completed\|\|![A-Za-z_$][\w$]*\.has\([A-Za-z_$][\w$]*\.invocation\.server\)\)/u
        ]),
        formatter: describeSource(formatter, [
          new RegExp(
            `function\\s+${escapeRegExp(directFormatter.name)}\\(`
          ),
          "codex.mcpTool.computerUse.click.active",
          "codex/toolSurface",
          "if(t!==`node_repl`||e==null)return null"
        ])
      },
      contracts: {
        formatterReachable:
          directFormatterExport != null &&
          directFormatterImport != null &&
          directFormatterImport === directFormatterDispatch,
        nodeReplTitleShortCircuits: titleShortCircuit != null,
        nodeReplCodeNotParsed:
          titleFormatterContent.includes(".safeParse(") &&
          titleFormatterContent.includes(".data.title") &&
          titleFormatterContent.includes("trimEnd()") &&
          !titleFormatterContent.includes(".code"),
        resultMetaRequiresNodeRepl:
          formatter.content.includes(
            "if(t!==`node_repl`||e==null)return null"
          ),
        resultTimeStandalone:
          /[A-Za-z_$][\w$]*\.source\?\.kind===`computerUse`\|\|[A-Za-z_$][\w$]*\.invocation\.server===`computer-use`/u.test(
            localConversation.content
          ),
        completedDoesNotMeanSucceeded:
          formatter.content.includes(
            "completed:t.status!==`inProgress`||e.status!==`inProgress`"
          ),
        formatterReceivesResultButDirectFormatterIgnoresIt:
          presentationFormatter.declaration.includes("toolResult:") &&
          presentationFormatterContent.includes("toolResult:") &&
          !directFormatter.declaration.includes("toolResult:") &&
          !directFormatterContent.includes("toolResult"),
        completedAtomicallyReplacesItem:
          completedCase.includes("completed:!0") &&
          itemMutationHelper != null,
        noMcpResultDelta:
          !eventLifecycle.content.includes("item/mcpToolCall/delta"),
        rendererIgnoresProgress:
          eventLifecycle.content.includes(
            "Ignoring mcpToolCall progress message"
          ),
        rmcpOnlyLogsProgress:
          progressHandler.includes("MCP server progress notification") &&
          !/send_event|McpToolCallProgress/.test(progressHandler),
        elicitationProtocolHasNoItemId:
          protocol.includes(
            "When core can correlate an elicitation with an MCP tool call"
          ) &&
          !/pub item_id/.test(
            protocol.slice(
              protocol.indexOf("pub struct McpServerElicitationRequestParams"),
              protocol.indexOf("pub struct McpElicitationSchema")
            )
          ),
        elicitationStateKeyedByServerAndRequestId:
          mcpSession.includes(
            "insert_pending_elicitation(\n                        server_name.clone(),\n                        request_id.clone()"
          ),
        pendingSuppressionUsesConnectorOrServerKey:
          /case`mcpToolCall`:return\s+[A-Za-z_$][\w$]*\.elicitation\.approval\.connector_id/u.test(
            localConversation.content
          ) &&
          /\.filter\([A-Za-z_$][\w$]*=>[A-Za-z_$][\w$]*\.type!==`mcp-tool-call`\|\|[A-Za-z_$][\w$]*\.completed\|\|![A-Za-z_$][\w$]*\.has\([A-Za-z_$][\w$]*\.invocation\.server\)\)/u.test(
            localConversation.content
          ),
        startedBeforeCompleted:
          mcpToolCall.includes("Handles the specified tool call") &&
          eventLifecycle.content.indexOf("case`item/started`") <
            eventLifecycle.content.indexOf("case`item/completed`")
      },
      rustPaths
    };
  } finally {
    closeSync(archive.fileDescriptor);
  }
}

export async function runElectronPresentationContractProbe({
  asarPath = DEFAULT_ASAR,
  codexSourceRoot = DEFAULT_CODEX_SOURCE,
  outputPath
} = {}) {
  const fixture = {
    schemaVersion: 1,
    generatedFrom: {
      electronAppVersion: plistValue(
        "/Applications/ChatGPT.app/Contents/Info.plist",
        "CFBundleShortVersionString"
      ),
      electronAppBuild: plistValue(
        "/Applications/ChatGPT.app/Contents/Info.plist",
        "CFBundleVersion"
      ),
      codexSourceTag: "rust-v0.144.0-alpha.4"
    },
    source: await sourceEvidence({ asarPath, codexSourceRoot }),
    behavior: behaviorCases(),
    safety: {
      realComputerUseSocketContacted: false,
      uiActionsExecuted: false,
      appStateMutated: false
    }
  };

  if (outputPath) {
    const absolute = path.resolve(outputPath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, `${JSON.stringify(fixture, null, 2)}\n`);
  }
  return fixture;
}

function plistValue(plistPath, key) {
  return execFileSync(
    "/usr/bin/plutil",
    ["-extract", key, "raw", "-o", "-", plistPath],
    { encoding: "utf8" }
  ).trim();
}

async function main() {
  const outputPath =
    argumentValue("--out") ??
    "fixtures/electron/presentation-contract.json";
  const fixture = await runElectronPresentationContractProbe({
    asarPath: argumentValue("--asar") ?? DEFAULT_ASAR,
    codexSourceRoot:
      argumentValue("--codex-source") ?? DEFAULT_CODEX_SOURCE,
    outputPath
  });
  process.stdout.write(
    `${JSON.stringify({
      outputPath: path.resolve(outputPath),
      contracts: fixture.source.contracts,
      failedDirectLabel:
        fixture.behavior.failedDirectComputerUse.label,
      resultTimeGrouping: fixture.behavior.resultTimeIdentity,
      safety: fixture.safety
    }, null, 2)}\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_NODE_REPL_BINARY =
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl";
export const DEFAULT_NODE_BINARY =
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node";
export const PROTOCOL_VERSION = "2025-06-18";
export const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutputPath = path.join(root, "fixtures/node-repl/probe.json");
const defaultTranscriptPath = path.join(
  root,
  "fixtures/node-repl/transcript.json"
);

const probeCells = Object.freeze([
  {
    name: "ordinary-surface",
    title: "Inspect ordinary cell surface",
    code: `var surfaceProbe = {
  globalProcessType: typeof globalThis.process,
  ownKeys: Reflect.ownKeys(nodeRepl).map(String).sort(),
  prototypeOwnKeys: Reflect.ownKeys(Object.getPrototypeOf(nodeRepl)).map(String).sort(),
  frozen: Object.isFrozen(nodeRepl),
  envFrozen: Object.isFrozen(nodeRepl.env),
  envKeys: Object.keys(nodeRepl.env).sort(),
  privileged: Object.fromEntries(
    [
      "addAfterSubmittedCodeHook",
      "gaasBrowserConfig",
      "createElicitation",
      "launchServices",
      "nativePipe",
      "withSuspendedTimeout",
      "config",
      "fetch",
      "telemetry"
    ]
      .map((name) => [name, {
        visible: name in nodeRepl,
        own: Object.hasOwn(nodeRepl, name),
        type: typeof nodeRepl[name]
      }])
  )
};
nodeRepl.write(JSON.stringify(surfaceProbe));`
  },
  {
    name: "process-denial",
    title: "Verify process denial",
    code: `var processProbe = { globalType: typeof globalThis.process, imports: {} };
for (const spec of ["process", "node:process"]) {
  try {
    await import(spec);
    processProbe.imports[spec] = { blocked: false };
  } catch (error) {
    processProbe.imports[spec] = {
      blocked: true,
      name: error?.name ?? null,
      message: String(error?.message ?? error)
    };
  }
}
nodeRepl.write(JSON.stringify(processProbe));`
  },
  {
    name: "binding-create",
    title: "Create persistent binding",
    code: `var nodeReplProbeBinding = { count: 41 };
nodeRepl.write(String(nodeReplProbeBinding.count));`
  },
  {
    name: "binding-reuse",
    title: "Reuse persistent binding",
    code: `nodeReplProbeBinding.count += 1;
nodeRepl.write(String(nodeReplProbeBinding.count));`
  },
  {
    name: "emit-image",
    title: "Emit in-memory PNG",
    code: `var nodeReplProbePng = Buffer.from("${PNG_1X1_BASE64}", "base64");
await nodeRepl.emitImage(nodeReplProbePng);
nodeRepl.write("image-emitted");`
  }
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const options = {
    binary: DEFAULT_NODE_REPL_BINARY,
    node: DEFAULT_NODE_BINARY,
    out: defaultOutputPath,
    transcript: defaultTranscriptPath,
    timeoutMs: 10_000,
    write: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--binary") {
      options.binary = path.resolve(argv[++index]);
    } else if (argument === "--node") {
      options.node = path.resolve(argv[++index]);
    } else if (argument === "--out") {
      options.out = path.resolve(argv[++index]);
    } else if (argument === "--transcript") {
      options.transcript = path.resolve(argv[++index]);
    } else if (argument === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(argv[++index], 10);
    } else if (argument === "--no-write") {
      options.write = false;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(`Usage: node scripts/node-repl-mcp-probe.mjs [options]

Options:
  --binary PATH       node_repl MCP binary
  --node PATH         Node runtime used by node_repl
  --out PATH          normalized probe summary
  --transcript PATH   sanitized MCP transcript
  --timeout-ms N      per-request timeout
  --no-write          run assertions without writing fixtures
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  return options;
}

export function assertSafeProbeSource(cell) {
  const forbiddenPatterns = [
    [/\bimport\s*\(\s*["'][^"']*(?:computer-use|@oai\/sky|wrapper)/iu, "wrapper import"],
    [/\bnativePipe\s*\.\s*createConnection\s*\(/u, "native pipe connect"],
    [/\bcreateElicitation\s*\(/u, "elicitation"],
    [/\blaunchServices\s*\.\s*openApplication\s*\(/u, "LaunchServices"],
    [/\bwithSuspendedTimeout\s*\(/u, "timeout suspension"],
    [/\bconfig\s*\.\s*[A-Za-z_$][\w$]*\s*\(/u, "privileged config method"],
    [/\bnodeRepl\s*\.\s*fetch\s*\(/u, "privileged authenticated fetch"],
    [/\b(?:net|node:net)\b/u, "network module"],
    [/\bcomputeruse\.sock\b/iu, "real Computer Use socket"]
  ];

  for (const [pattern, label] of forbiddenPatterns) {
    assert.doesNotMatch(cell.code, pattern, `${cell.name} contains ${label}`);
  }
}

export function buildIsolatedEnv({ homeDir, nodeBinary }) {
  return Object.freeze({
    HOME: homeDir,
    PATH: "/usr/bin:/bin",
    TMPDIR: homeDir,
    NO_COLOR: "1",
    NODE_REPL_NODE_PATH: nodeBinary,
    NODE_REPL_DISABLE_ANALYTICS: "1",
    NODE_REPL_UNTRUSTED_ENV_ALLOWLIST: ""
  });
}

function parseTextContent(result) {
  const item = result?.content?.find((entry) => entry.type === "text");
  assert.ok(item, "expected one text content item");
  return item.text;
}

function parseJsonTextContent(result) {
  return JSON.parse(parseTextContent(result));
}

function compactTool(tool) {
  return {
    name: tool.name,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations ?? null
  };
}

function compactImage(item) {
  const bytes = Buffer.from(item.data, "base64");
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]);
  const dimensions =
    item.mimeType === "image/png" &&
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(pngSignature)
      ? {
          width: bytes.readUInt32BE(16),
          height: bytes.readUInt32BE(20)
        }
      : {};
  return {
    type: "image",
    mimeType: item.mimeType,
    bytes: bytes.length,
    ...dimensions,
    sha256: sha256(bytes),
    detail: item._meta?.["codex/imageDetail"] ?? null
  };
}

function sanitizeMessage(message, requestLabels) {
  if (message.method === "tools/call") {
    const id = message.id;
    const label = requestLabels.get(id) ?? "unknown";
    const code = message.params?.arguments?.code ?? "";
    return {
      direction: "client->server",
      jsonrpc: message.jsonrpc,
      id,
      method: message.method,
      params: {
        name: message.params?.name,
        arguments: {
          title: message.params?.arguments?.title,
          timeout_ms: message.params?.arguments?.timeout_ms,
          code: `<probe:${label} sha256:${sha256(code)}>`
        }
      }
    };
  }

  if (message.method === "initialize") {
    return {
      direction: "client->server",
      ...message
    };
  }

  if (message.method === "notifications/initialized") {
    return {
      direction: "client->server",
      ...message
    };
  }

  if (message.method === "tools/list") {
    return {
      direction: "client->server",
      ...message
    };
  }

  if (message.id != null && message.result?.tools) {
    return {
      direction: "server->client",
      jsonrpc: message.jsonrpc,
      id: message.id,
      result: {
        tools: message.result.tools.map(compactTool)
      }
    };
  }

  if (message.id != null && message.result?.content) {
    return {
      direction: "server->client",
      jsonrpc: message.jsonrpc,
      id: message.id,
      result: {
        content: message.result.content.map((item) =>
          item.type === "image" ? compactImage(item) : item
        ),
        isError: message.result.isError ?? false
      }
    };
  }

  if (message.id != null && message.result?.serverInfo) {
    return {
      direction: "server->client",
      jsonrpc: message.jsonrpc,
      id: message.id,
      result: {
        protocolVersion: message.result.protocolVersion,
        capabilities: message.result.capabilities,
        serverInfo: message.result.serverInfo,
        instructions: "<omitted: stable server instructions>"
      }
    };
  }

  return {
    direction: "server->client",
    ...message
  };
}

class StdioMcpClient {
  constructor(child, timeoutMs) {
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.requestLabels = new Map();
    this.transcript = [];
    this.stdoutBuffer = "";
    this.stderr = "";
    this.closed = false;

    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8");
    });
    child.on("exit", (code, signal) => {
      this.closed = true;
      const error = new Error(
        `node_repl exited before response (code=${code}, signal=${signal})`
      );
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    });
    child.on("error", (error) => {
      this.abort(error);
    });
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk.toString("utf8");
    for (;;) {
      const lineEnd = this.stdoutBuffer.indexOf("\n");
      if (lineEnd === -1) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, lineEnd);
      this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1);
      if (!line.trim()) {
        continue;
      }
      const message = JSON.parse(line);
      this.transcript.push(sanitizeMessage(message, this.requestLabels));

      if (message.method && message.id != null) {
        this.abort(
          new Error(
            `unexpected server-to-client request: ${message.method}; no elicitation or host bridge is permitted`
          )
        );
        continue;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        continue;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(
            `MCP ${pending.method} failed: ${message.error.message ?? "unknown error"}`
          )
        );
      } else {
        pending.resolve(message.result);
      }
    }
  }

  abort(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.child.kill("SIGTERM");
  }

  send(message) {
    if (this.closed) {
      throw new Error("cannot write to closed node_repl process");
    }
    this.transcript.push(sanitizeMessage(message, this.requestLabels));
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params = undefined) {
    const message = { jsonrpc: "2.0", method };
    if (params !== undefined) {
      message.params = params;
    }
    this.send(message);
  }

  request(method, params, label = null) {
    const id = this.nextId++;
    if (label) {
      this.requestLabels.set(id, label);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.child.kill("SIGTERM");
        reject(new Error(`MCP ${method} timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, { method, reject, resolve, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGTERM");
        resolve();
      }, 2_000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

async function binaryMetadata(binaryPath) {
  const [binary, manifestText] = await Promise.all([
    readFile(binaryPath),
    readFile(
      path.resolve(binaryPath, "../../manifest.json"),
      "utf8"
    )
  ]);
  const manifest = JSON.parse(manifestText);
  return {
    binary: "<ChatGPT.app>/Contents/Resources/cua_node/bin/node_repl",
    binarySha256: sha256(binary),
    nodeVersion: manifest.node_version,
    nodeReplArchive: manifest.node_repl_archive_path.split("/")[0],
    runtimeArchiveVersion: manifest.runtime_archive_version
  };
}

export async function runProbe({
  binary = DEFAULT_NODE_REPL_BINARY,
  node = DEFAULT_NODE_BINARY,
  cwd = root,
  timeoutMs = 10_000
} = {}) {
  for (const cell of probeCells) {
    assertSafeProbeSource(cell);
  }

  const temporaryHome = await mkdtemp(
    path.join(os.tmpdir(), "node-repl-mcp-probe-")
  );
  const child = spawn(binary, [], {
    cwd,
    env: buildIsolatedEnv({ homeDir: temporaryHome, nodeBinary: node }),
    stdio: ["pipe", "pipe", "pipe"]
  });
  const client = new StdioMcpClient(child, timeoutMs);

  try {
    const initialized = await client.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "codex-cu-lab-node-repl-probe",
        version: "0.1.0"
      }
    });
    client.notify("notifications/initialized");
    const listed = await client.request("tools/list", {});

    const results = new Map();
    for (const cell of probeCells) {
      const result = await client.request(
        "tools/call",
        {
          name: "js",
          arguments: {
            code: cell.code,
            title: cell.title,
            timeout_ms: 5_000
          }
        },
        cell.name
      );
      assert.equal(result.isError, false, `${cell.name} returned isError`);
      results.set(cell.name, result);
    }

    const surface = parseJsonTextContent(results.get("ordinary-surface"));
    const processDenial = parseJsonTextContent(results.get("process-denial"));
    const bindingCreated = parseTextContent(results.get("binding-create"));
    const bindingReused = parseTextContent(results.get("binding-reuse"));
    const imageResult = results.get("emit-image");
    const imageItem = imageResult.content.find((item) => item.type === "image");
    assert.ok(imageItem, "emit-image did not return MCP image content");
    const image = compactImage(imageItem);

    assert.equal(surface.globalProcessType, "undefined");
    assert.equal(surface.frozen, true);
    assert.equal(surface.envFrozen, true);
    assert.deepEqual(surface.envKeys, []);
    assert.deepEqual(surface.ownKeys, [
      "cwd",
      "emitImage",
      "env",
      "homeDir",
      "requestMeta",
      "setResponseMeta",
      "tmpDir",
      "write"
    ]);
    for (const [name, state] of Object.entries(surface.privileged)) {
      assert.deepEqual(
        state,
        { visible: false, own: false, type: "undefined" },
        `${name} leaked into an ordinary cell`
      );
    }
    assert.equal(processDenial.globalType, "undefined");
    for (const specifier of ["process", "node:process"]) {
      assert.equal(processDenial.imports[specifier].blocked, true);
      assert.match(
        processDenial.imports[specifier].message,
        /not allowed in node_repl/u
      );
    }
    assert.equal(bindingCreated, "41");
    assert.equal(bindingReused, "42");
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.bytes, Buffer.from(PNG_1X1_BASE64, "base64").length);
    assert.deepEqual(
      { width: image.width, height: image.height },
      { width: 1, height: 1 }
    );

    const metadata = await binaryMetadata(binary);
    const summary = {
      schemaVersion: 1,
      metadata,
      transport: {
        outer: "MCP JSON-RPC 2.0 over newline-delimited stdio",
        protocolVersion: initialized.protocolVersion,
        serverInfo: initialized.serverInfo,
        capabilities: initialized.capabilities
      },
      tools: listed.tools.map(compactTool),
      ordinaryCell: surface,
      processDenial,
      persistentBinding: {
        firstCall: Number(bindingCreated),
        secondCall: Number(bindingReused)
      },
      emitImage: image,
      safety: {
        isolatedEnvironment: true,
        trustedCodeVariablesPresent: false,
        codexCliPathPresent: false,
        realWrapperLoaded: false,
        nativeSocketOpened: false,
        clientCapabilities: {},
        unexpectedServerRequests: 0
      }
    };
    const transcript = {
      schemaVersion: 1,
      redaction: {
        code: "replaced with probe name and SHA-256",
        serverInstructions: "omitted",
        imageData: "replaced with byte length and SHA-256",
        hostPaths: "not requested by probe cells"
      },
      messages: client.transcript
    };
    return { summary, transcript, stderr: client.stderr };
  } finally {
    await client.close();
    await rm(temporaryHome, { force: true, recursive: true });
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runProbe(options);
  if (options.write) {
    await Promise.all([
      writeJson(options.out, result.summary),
      writeJson(options.transcript, result.transcript)
    ]);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        binarySha256: result.summary.metadata.binarySha256,
        nodeVersion: result.summary.metadata.nodeVersion,
        tools: result.summary.tools.map((tool) => tool.name),
        processDenied: Object.values(
          result.summary.processDenial.imports
        ).every((entry) => entry.blocked),
        persistentBinding: result.summary.persistentBinding,
        image: result.summary.emitImage,
        wrote: options.write
          ? {
              summary: options.out,
              transcript: options.transcript
            }
          : false
      },
      null,
      2
    )}\n`
  );
  if (result.stderr.trim()) {
    process.stderr.write(`node_repl stderr:\n${result.stderr}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
  });
}

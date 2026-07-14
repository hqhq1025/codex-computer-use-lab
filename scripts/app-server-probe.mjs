#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { redactSecrets } from "../lib/redaction.mjs";

export const DEFAULT_CODEX_BINARY =
  "/Applications/ChatGPT.app/Contents/Resources/codex";
export const SOURCE_ROOT =
  "/private/tmp/openai-codex-rust-v0.144.0-alpha.4";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUTPUT = path.join(ROOT, "fixtures/app-server/probe.json");
const INITIALIZE_ID = "probe-initialize";
const THREAD_LIST_ID = "probe-thread-list";
const ALLOWED_CLIENT_METHODS = new Set([
  "initialize",
  "initialized",
  "thread/list"
]);
const SENSITIVE_KEY = /(authorization|cookie|credential|password|secret|token|api[_-]?key)/i;
const PRIVATE_IDENTIFIER_KEYS = new Map([
  ["codexHome", "<temporary-codex-home>"],
  ["installationId", "<redacted-installation-id>"],
  ["serverName", "<redacted-host>"]
]);

export function encodeJsonLine(message) {
  assertAllowedClientMessage(message);
  return `${JSON.stringify(message)}\n`;
}

export class JsonLineDecoder {
  #buffer = "";

  push(chunk) {
    this.#buffer += chunk.toString("utf8");
    const messages = [];

    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline === -1) {
        break;
      }

      const line = this.#buffer.slice(0, newline).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.length > 0) {
        messages.push(JSON.parse(line));
      }
    }

    return messages;
  }

  finish() {
    const trailing = this.#buffer.trim();
    this.#buffer = "";
    return trailing.length > 0 ? [JSON.parse(trailing)] : [];
  }
}

export function buildProbeMessages() {
  return {
    initialize: {
      id: INITIALIZE_ID,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex_computer_use_lab_probe",
          title: "Codex Computer Use Lab Probe",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
          mcpServerOpenaiFormElicitation: false
        }
      }
    },
    initialized: {
      method: "initialized"
    },
    threadList: {
      id: THREAD_LIST_ID,
      method: "thread/list",
      params: {
        limit: 1,
        useStateDbOnly: true
      }
    }
  };
}

export function sanitizeTranscriptValue(value, context = {}) {
  const temporaryCodexHome = context.temporaryCodexHome;
  const temporaryCodexHomeRealpath = context.temporaryCodexHomeRealpath;
  const homeDirectory = context.homeDirectory;

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeTranscriptValue(entry, context));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        PRIVATE_IDENTIFIER_KEYS.get(key) ??
          (SENSITIVE_KEY.test(key)
            ? "<redacted>"
            : sanitizeTranscriptValue(entry, context))
      ])
    );
  }

  if (typeof value !== "string") {
    return value;
  }

  let sanitized = redactSecrets(value);
  if (
    temporaryCodexHomeRealpath &&
    temporaryCodexHomeRealpath !== temporaryCodexHome
  ) {
    sanitized = sanitized.replaceAll(
      temporaryCodexHomeRealpath,
      "<temporary-codex-home>"
    );
  }
  if (temporaryCodexHome) {
    sanitized = sanitized.replaceAll(
      temporaryCodexHome,
      "<temporary-codex-home>"
    );
  }
  if (homeDirectory) {
    sanitized = sanitized.replaceAll(homeDirectory, "<home>");
  }
  return sanitized;
}

export function validateHandshakeTranscript(transcript) {
  const clientMethods = transcript.messages
    .filter((entry) => entry.direction === "client->server")
    .map((entry) => entry.message.method);
  const expected = ["initialize", "initialized", "thread/list"];

  if (JSON.stringify(clientMethods) !== JSON.stringify(expected)) {
    throw new Error(
      `unexpected client method sequence: ${JSON.stringify(clientMethods)}`
    );
  }

  const responses = transcript.messages
    .filter((entry) => entry.direction === "server->client")
    .map((entry) => entry.message);
  for (const id of [INITIALIZE_ID, THREAD_LIST_ID]) {
    const response = responses.find((message) => message.id === id);
    if (!response) {
      throw new Error(`missing response for ${id}`);
    }
    if (response.error) {
      throw new Error(`app-server returned an error for ${id}`);
    }
  }
}

export async function runProbe(options = {}) {
  const binaryPath = options.binaryPath ?? DEFAULT_CODEX_BINARY;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const spawnImpl = options.spawnImpl ?? spawn;

  if (!existsSync(binaryPath)) {
    throw new Error(`Codex binary not found: ${binaryPath}`);
  }

  const temporaryCodexHome = await mkdtemp(
    path.join(os.tmpdir(), "codex-app-server-probe-")
  );
  const temporaryCodexHomeRealpath = await realpath(temporaryCodexHome);
  const rawMessages = [];
  const stderrLines = [];
  let child;

  try {
    child = spawnImpl(
      binaryPath,
      ["app-server", "--listen", "stdio://"],
      {
        cwd: temporaryCodexHome,
        env: buildIsolatedEnvironment(temporaryCodexHome),
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    const rpc = createRpcPeer(child, rawMessages, stderrLines);
    const messages = buildProbeMessages();

    const initializeResponse = rpc.waitForResponse(INITIALIZE_ID, timeoutMs);
    sendClientMessage(child, rawMessages, messages.initialize);
    await initializeResponse;

    sendClientMessage(child, rawMessages, messages.initialized);

    const threadListResponse = rpc.waitForResponse(THREAD_LIST_ID, timeoutMs);
    sendClientMessage(child, rawMessages, messages.threadList);
    await threadListResponse;

    child.stdin.end();
    const exit = await waitForExit(child, 5_000);
    rpc.finish();

    const transcript = sanitizeTranscriptValue(
      {
        schemaVersion: 1,
        probe: "private-app-server-stdio-readonly",
        capturedAt: new Date().toISOString(),
        binary: binaryPath,
        source: {
          root: SOURCE_ROOT,
          tag: "rust-v0.144.0-alpha.4",
          commit: "049586f41571e74b44c841868bca3a2233214a71"
        },
        transport: {
          kind: "stdio",
          framing: "newline-delimited JSON without jsonrpc field"
        },
        safety: {
          privateProcess: true,
          isolatedCodexHome: true,
          remoteControlDisabled: true,
          modelTaskStarted: false,
          computerUseInvoked: false,
          writeRpcInvoked: false,
          allowedClientMethods: [...ALLOWED_CLIENT_METHODS]
        },
        process: {
          exitCode: exit.code,
          signal: exit.signal,
          stderrLineCount: stderrLines.length
        },
        messages: rawMessages
      },
      {
        temporaryCodexHome,
        temporaryCodexHomeRealpath,
        homeDirectory: os.homedir()
      }
    );

    validateHandshakeTranscript(transcript);
    return transcript;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await waitForExit(child, 2_000).catch(() => child.kill("SIGKILL"));
    }
    await rm(temporaryCodexHome, { recursive: true, force: true });
  }
}

function assertAllowedClientMessage(message) {
  if (!message || typeof message !== "object") {
    throw new TypeError("app-server message must be an object");
  }
  if (!ALLOWED_CLIENT_METHODS.has(message.method)) {
    throw new Error(`refusing unsafe app-server method: ${message.method}`);
  }
  if ("jsonrpc" in message) {
    throw new Error("app-server stdio wire omits the jsonrpc field");
  }
  if (message.method === "initialized" && "id" in message) {
    throw new Error("initialized must be a notification without an id");
  }
}

function buildIsolatedEnvironment(temporaryCodexHome) {
  const environment = {};
  for (const key of [
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TMPDIR"
  ]) {
    if (process.env[key]) {
      environment[key] = process.env[key];
    }
  }

  return {
    ...environment,
    HOME: temporaryCodexHome,
    CODEX_HOME: temporaryCodexHome,
    CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1",
    RUST_LOG: "error"
  };
}

function createRpcPeer(child, rawMessages, stderrLines) {
  const decoder = new JsonLineDecoder();
  const pending = new Map();
  let terminalError;

  const handleMessage = (message) => {
    rawMessages.push({ direction: "server->client", message });
    if (!Object.hasOwn(message, "id")) {
      return;
    }

    const waiter = pending.get(String(message.id));
    if (!waiter) {
      return;
    }
    pending.delete(String(message.id));
    if (message.error) {
      waiter.reject(
        new Error(
          `app-server RPC ${message.id} failed: ${JSON.stringify(message.error)}`
        )
      );
    } else {
      waiter.resolve(message);
    }
  };

  child.stdout.on("data", (chunk) => {
    try {
      for (const message of decoder.push(chunk)) {
        handleMessage(message);
      }
    } catch (error) {
      terminalError = error;
      for (const waiter of pending.values()) {
        waiter.reject(error);
      }
      pending.clear();
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrLines.push(
      ...chunk
        .toString("utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => redactSecrets(line))
    );
  });

  child.on("error", (error) => {
    terminalError = error;
    for (const waiter of pending.values()) {
      waiter.reject(error);
    }
    pending.clear();
  });

  return {
    waitForResponse(id, timeoutMs) {
      if (terminalError) {
        return Promise.reject(terminalError);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(String(id));
          reject(new Error(`timed out waiting for app-server response ${id}`));
        }, timeoutMs);
        timer.unref?.();
        pending.set(String(id), {
          resolve(message) {
            clearTimeout(timer);
            resolve(message);
          },
          reject(error) {
            clearTimeout(timer);
            reject(error);
          }
        });
      });
    },
    finish() {
      for (const message of decoder.finish()) {
        handleMessage(message);
      }
      if (terminalError) {
        throw terminalError;
      }
    }
  };
}

function sendClientMessage(child, rawMessages, message) {
  rawMessages.push({ direction: "client->server", message });
  child.stdin.write(encodeJsonLine(message));
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode
    });
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timed out waiting for private app-server to exit"));
    }, timeoutMs);
    timer.unref?.();
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function parseArgs(argv) {
  const options = {
    binaryPath: DEFAULT_CODEX_BINARY,
    outputPath: DEFAULT_OUTPUT,
    timeoutMs: 20_000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--binary") {
      options.binaryPath = argv[++index];
    } else if (argument === "--out") {
      options.outputPath = argv[++index];
    } else if (argument === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(argv[++index], 10);
    } else if (argument === "--help") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      [
        "Usage: node scripts/app-server-probe.mjs [options]",
        "",
        `  --binary PATH       Codex binary (default: ${DEFAULT_CODEX_BINARY})`,
        `  --out PATH          Sanitized transcript (default: ${DEFAULT_OUTPUT})`,
        "  --timeout-ms N      Per-RPC timeout (default: 20000)",
        ""
      ].join("\n")
    );
    return;
  }

  const transcript = await runProbe(options);
  if (options.outputPath === "-") {
    process.stdout.write(`${JSON.stringify(transcript, null, 2)}\n`);
    return;
  }

  const outputPath = path.resolve(options.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(transcript, null, 2)}\n`, {
    mode: 0o600
  });
  process.stdout.write(
    `Wrote sanitized app-server transcript to ${outputPath}\n`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

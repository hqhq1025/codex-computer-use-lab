#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { FIXTURE_APP, MAX_FRAME_BYTES, startMockSkyService } from "./mock-sky-service.mjs";

export const SKY_PACKAGE_ROOT =
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky";
export const SKY_CLIENT_PATH = path.join(
  SKY_PACKAGE_ROOT,
  "dist/project/cua/sky_js/src/targets/mac/client.js"
);
export const SKY_NATIVE_PIPE_PATH = path.join(
  SKY_PACKAGE_ROOT,
  "dist/project/cua/sky_js/src/targets/mac/native-pipe.js"
);
export const CLIENT_API_VERSION = "CodexComputerUseIPC-2";
export const REQUEST_TIMEOUT_SECONDS = 3;
export const TURN_METADATA = Object.freeze({
  session_id: "fixture-session",
  turn_id: "fixture-turn",
  source: "sky-wire-probe"
});

const OPERATION_NAMES = [
  "listApps",
  "getAppPolicy",
  "getAppState",
  "click(element)",
  "click(coordinate)",
  "setValue",
  "selectText",
  "scroll",
  "drag",
  "pressKey",
  "typeText"
];

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function createNativePipeShim(expectedSocketPath) {
  return {
    createConnection(requestedSocketPath) {
      if (requestedSocketPath !== expectedSocketPath) {
        throw new Error(`Refusing unexpected native pipe path: ${requestedSocketPath}`);
      }
      if (path.dirname(path.resolve(requestedSocketPath)) !== "/tmp") {
        throw new Error(`Refusing native pipe outside /tmp: ${requestedSocketPath}`);
      }

      return new Promise((resolve, reject) => {
        const socket = net.createConnection({ path: requestedSocketPath });
        const onError = (error) => {
          socket.off("connect", onConnect);
          reject(error);
        };
        const onConnect = () => {
          socket.off("error", onError);
          resolve(socket);
        };
        socket.once("error", onError);
        socket.once("connect", onConnect);
      });
    }
  };
}

function normalizeDeadline(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid deadlineUnixMilliseconds: ${String(value)}`);
  }
  return "<dynamic-unix-milliseconds>";
}

function normalizeRequest(request) {
  const normalized = structuredClone(request);
  if (normalized.method === "request") {
    normalized.params.deadlineUnixMilliseconds = normalizeDeadline(
      normalized.params.deadlineUnixMilliseconds
    );
  }
  return normalized;
}

function stableExchange(exchange) {
  return {
    sequence: exchange.sequence,
    requestFrameLengthBytes: exchange.requestFrameLengthBytes,
    requestPayloadLengthBytes: exchange.requestPayloadLengthBytes,
    request: normalizeRequest(exchange.request),
    responseFrameLengthBytes: exchange.responseFrameLengthBytes,
    responsePayloadLengthBytes: exchange.responsePayloadLengthBytes,
    response: exchange.response
  };
}

function actionEncodings(exchanges) {
  const actions = exchanges.filter(
    (exchange) =>
      exchange.request.method === "request" &&
      exchange.request.params.requestType === "ComputerUseIPCAppPerformActionRequest"
  );

  return actions.map((exchange, index) => ({
    operation: OPERATION_NAMES[index + 3],
    action: structuredClone(exchange.request.params.request.action)
  }));
}

async function installedSkyVersion() {
  const packageJson = JSON.parse(
    await readFile(path.join(SKY_PACKAGE_ROOT, "package.json"), "utf8")
  );
  return packageJson.version;
}

export async function runSkyWireProbe({
  outputPath,
  responseDelayMs = 12,
  socketPath = `/tmp/codex-sky-wire-${process.pid}-${Date.now()}.sock`
} = {}) {
  const service = await startMockSkyService({ socketPath, responseDelayMs });
  const previousNodeRepl = globalThis.nodeRepl;
  let rawCapture;
  let operationResults;
  try {
    globalThis.nodeRepl = {
      env: {
        SKY_CUA_NATIVE_PIPE_PATH: service.socketPath
      },
      nativePipe: createNativePipeShim(service.socketPath),
      requestMeta: {
        "x-codex-turn-metadata": TURN_METADATA
      }
    };

    const { MacComputerUseClient } = await import(pathToFileURL(SKY_CLIENT_PATH).href);
    const client = new MacComputerUseClient({
      apiVersion: CLIENT_API_VERSION,
      timeoutSeconds: REQUEST_TIMEOUT_SECONDS
    });
    const operations = [
      () => client.listApps(),
      () => client.getAppPolicy(FIXTURE_APP),
      () => client.getAppState({ app: FIXTURE_APP, disableDiff: true }),
      () => client.click({
        app: FIXTURE_APP,
        clickCount: 2,
        elementIndex: 1,
        mouseButton: "right"
      }),
      () => client.click({
        app: FIXTURE_APP,
        x: 120.5,
        y: 64
      }),
      () => client.setValue({
        app: FIXTURE_APP,
        elementIndex: 2,
        value: "Ada Lovelace"
      }),
      () => client.selectText({
        app: FIXTURE_APP,
        elementIndex: 2,
        prefix: "Ada ",
        selection: "cursor_after",
        suffix: " wrote",
        text: "Lovelace"
      }),
      () => client.scroll({
        app: FIXTURE_APP,
        direction: "down",
        elementIndex: 3,
        pages: 2.5
      }),
      () => client.drag({
        app: FIXTURE_APP,
        fromX: 10,
        fromY: 20,
        toX: 310.25,
        toY: 420.5
      }),
      () => client.pressKey({
        app: FIXTURE_APP,
        key: "Control_L+Shift_L+p"
      }),
      () => client.typeText({
        app: FIXTURE_APP,
        text: "hello from fixture"
      })
    ];

    operationResults = await Promise.all(operations.map((operation) => operation()));
    rawCapture = {
      exchanges: structuredClone(service.exchanges),
      stats: service.stats
    };
  } finally {
    globalThis.nodeRepl = previousNodeRepl;
    await service.close();
  }

  const fixture = {
    schemaVersion: 1,
    source: {
      package: "@oai/sky",
      packageVersion: await installedSkyVersion(),
      clientPath: SKY_CLIENT_PATH
    },
    safety: {
      socketPath: "<temporary-/tmp-unix-socket>",
      realComputerUseSocketContacted: false,
      uiActionsExecuted: false
    },
    transport: {
      framing: "4-byte little-endian unsigned payload length followed by UTF-8 JSON",
      maxFrameBytes: MAX_FRAME_BYTES,
      responseFramesFragmented: true
    },
    client: {
      apiVersion: CLIENT_API_VERSION,
      requestTimeoutSeconds: REQUEST_TIMEOUT_SECONDS,
      turnMetadata: TURN_METADATA
    },
    operationOrder: OPERATION_NAMES,
    operationResults: operationResults.map((result) => result ?? null),
    serialization: {
      connectionCount: rawCapture.stats.connectionCount,
      maxInFlight: rawCapture.stats.maxInFlight
    },
    exchanges: rawCapture.exchanges.map(stableExchange),
    actionEncodings: actionEncodings(rawCapture.exchanges)
  };

  if (outputPath) {
    const absoluteOutputPath = path.resolve(outputPath);
    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }

  return {
    fixture,
    rawCapture
  };
}

async function main() {
  const outputPath = argumentValue("--out") ?? "fixtures/sky-wire/captured.json";
  const { fixture } = await runSkyWireProbe({ outputPath });
  process.stdout.write(
    `${JSON.stringify({
      actionCount: fixture.actionEncodings.length,
      exchangeCount: fixture.exchanges.length,
      maxInFlight: fixture.serialization.maxInFlight,
      outputPath: path.resolve(outputPath),
      realComputerUseSocketContacted: false,
      uiActionsExecuted: false
    }, null, 2)}\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}

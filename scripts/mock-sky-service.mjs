#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const FIXTURE_APP = "com.example.sky-wire-fixture";

const FAKE_RESPONSES = {
  ComputerUseIPCAppPolicyRequest: {
    allowPersistentApproval: true,
    decision: "allowed",
    target: {
      appPath: "/Applications/Sky Wire Fixture.app",
      bundleIdentifier: FIXTURE_APP,
      displayName: "Sky Wire Fixture",
      risk: "low",
      warningSubtitle: null
    }
  },
  ComputerUseIPCListAppsRequest: [
    {
      appPath: "/Applications/Sky Wire Fixture.app",
      bundleIdentifier: FIXTURE_APP,
      displayName: "Sky Wire Fixture",
      isFrontmost: true,
      isRunning: true,
      lastUsedDate: "2026-01-02T03:04:05.000Z",
      useCount: 7
    }
  ],
  ComputerUseIPCAppGetSkyshotRequest: {
    app: {
      bundleIdentifier: FIXTURE_APP,
      pid: 4242
    },
    appSpecificInstructions: "Fixture-only state. No application or UI was opened.",
    skyshot: {
      text: "[1] button 'Continue'\n[2] textField 'Name'\n[3] scrollArea 'Results'",
      screenshot: null
    }
  },
  ComputerUseIPCAppPerformActionRequest: null
};

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertTemporarySocketPath(socketPath) {
  const resolved = path.resolve(socketPath);
  const temporaryRoot = path.resolve("/tmp");
  if (path.dirname(resolved) !== temporaryRoot) {
    throw new Error(`Mock Sky socket must be directly below /tmp: ${resolved}`);
  }
  if (!path.basename(resolved).startsWith("codex-sky-wire-")) {
    throw new Error(`Mock Sky socket must use the codex-sky-wire- prefix: ${resolved}`);
  }
}

function jsonRpcResponse(id, result) {
  return {
    id,
    jsonrpc: "2.0",
    result
  };
}

function fakeResult(message, responseOverrides) {
  if (message.method === "ping") {
    return {
      serverApiVersion: message.params?.clientApiVersion
    };
  }

  if (message.method !== "request") {
    throw new Error(`Unsupported Sky JSON-RPC method: ${String(message.method)}`);
  }

  const requestType = message.params?.requestType;
  if (Object.hasOwn(responseOverrides, requestType)) {
    const override = responseOverrides[requestType];
    return structuredClone(
      typeof override === "function" ? override(message) : override
    );
  }
  if (!Object.hasOwn(FAKE_RESPONSES, requestType)) {
    throw new Error(`Unsupported Sky request type: ${String(requestType)}`);
  }
  return structuredClone(FAKE_RESPONSES[requestType]);
}

export function encodeFrame(message) {
  const payload = Buffer.from(message, "utf8");
  if (payload.length > MAX_FRAME_BYTES) {
    throw new RangeError(`Sky mock frame is too large: ${payload.length}`);
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);

  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)]);
    const messages = [];

    while (this.#buffer.length >= 4) {
      const payloadLength = this.#buffer.readUInt32LE(0);
      if (payloadLength > MAX_FRAME_BYTES) {
        throw new RangeError(`Sky mock frame is too large: ${payloadLength}`);
      }
      const frameLength = 4 + payloadLength;
      if (this.#buffer.length < frameLength) {
        break;
      }
      messages.push({
        frameLengthBytes: frameLength,
        payloadLengthBytes: payloadLength,
        text: this.#buffer.subarray(4, frameLength).toString("utf8")
      });
      this.#buffer = this.#buffer.subarray(frameLength);
    }

    return messages;
  }
}

function writeFragmented(socket, frame) {
  const firstEnd = Math.min(2, frame.length);
  const secondEnd = Math.min(7, frame.length);
  socket.write(frame.subarray(0, firstEnd));
  if (secondEnd > firstEnd) {
    socket.write(frame.subarray(firstEnd, secondEnd));
  }
  if (frame.length > secondEnd) {
    socket.write(frame.subarray(secondEnd));
  }
}

export async function startMockSkyService({
  socketPath = `/tmp/codex-sky-wire-${process.pid}.sock`,
  responseDelayMs = 12,
  responseOverrides = {}
} = {}) {
  assertTemporarySocketPath(socketPath);
  await unlink(socketPath).catch((error) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });

  const exchanges = [];
  const sockets = new Set();
  let activeRequests = 0;
  let maxInFlight = 0;
  let connectionCount = 0;

  const server = net.createServer((socket) => {
    connectionCount += 1;
    sockets.add(socket);
    const decoder = new FrameDecoder();

    socket.on("data", (chunk) => {
      let frames;
      try {
        frames = decoder.push(chunk);
      } catch (error) {
        socket.destroy(error);
        return;
      }

      for (const frame of frames) {
        const request = JSON.parse(frame.text);
        const exchange = {
          sequence: exchanges.length + 1,
          receivedAtUnixMilliseconds: Date.now(),
          requestFrameLengthBytes: frame.frameLengthBytes,
          requestPayloadLengthBytes: frame.payloadLengthBytes,
          request,
          responseFrameLengthBytes: null,
          responsePayloadLengthBytes: null,
          response: null
        };
        exchanges.push(exchange);
        activeRequests += 1;
        maxInFlight = Math.max(maxInFlight, activeRequests);

        void new Promise((resolve) => setTimeout(resolve, responseDelayMs))
          .then(() => {
            const response = jsonRpcResponse(
              request.id,
              fakeResult(request, responseOverrides)
            );
            const responseFrame = encodeFrame(JSON.stringify(response));
            exchange.response = response;
            exchange.responseFrameLengthBytes = responseFrame.length;
            exchange.responsePayloadLengthBytes = responseFrame.length - 4;
            writeFragmented(socket, responseFrame);
          })
          .catch((error) => {
            const response = {
              error: {
                code: -32603,
                message: error instanceof Error ? error.message : String(error)
              },
              id: request.id,
              jsonrpc: "2.0"
            };
            const responseFrame = encodeFrame(JSON.stringify(response));
            exchange.response = response;
            exchange.responseFrameLengthBytes = responseFrame.length;
            exchange.responsePayloadLengthBytes = responseFrame.length - 4;
            writeFragmented(socket, responseFrame);
          })
          .finally(() => {
            activeRequests -= 1;
          });
      }
    });

    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });

  return {
    socketPath,
    exchanges,
    get stats() {
      return {
        connectionCount,
        maxInFlight
      };
    },
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await unlink(socketPath).catch((error) => {
        if (error.code !== "ENOENT") {
          throw error;
        }
      });
    }
  };
}

async function main() {
  const socketPath = argumentValue("--socket") ?? `/tmp/codex-sky-wire-${process.pid}.sock`;
  const capturePath = argumentValue("--capture");
  const service = await startMockSkyService({ socketPath });
  process.stdout.write(`${JSON.stringify({ socketPath: service.socketPath })}\n`);

  const stop = async () => {
    if (capturePath) {
      await writeFile(
        capturePath,
        `${JSON.stringify({
          exchanges: service.exchanges,
          stats: service.stats
        }, null, 2)}\n`,
        "utf8"
      );
    }
    await service.close();
  };

  process.once("SIGINT", () => {
    void stop().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().then(() => process.exit(0));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}

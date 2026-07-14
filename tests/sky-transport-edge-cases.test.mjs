import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  CLIENT_API_VERSION,
  SKY_CLIENT_PATH
} from "../scripts/sky-client-wire-probe.mjs";
import {
  FrameDecoder,
  encodeFrame
} from "../scripts/mock-sky-service.mjs";

const APP = "com.example.transport-fixture";

function nativePipe(socketPath) {
  return {
    createConnection(requestedPath) {
      assert.equal(requestedPath, socketPath);
      return new Promise((resolve, reject) => {
        const socket = net.createConnection({ path: socketPath });
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    }
  };
}

async function listen(server, socketPath) {
  await unlink(socketPath).catch((error) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
}

async function closeServer(server, sockets, socketPath) {
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise((resolve) => server.close(resolve));
  await unlink(socketPath).catch((error) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

function respond(socket, id, result) {
  socket.write(
    encodeFrame(
      JSON.stringify({
        id,
        jsonrpc: "2.0",
        result
      })
    )
  );
}

test("request timeout starts at dispatch and sends no cancel or socket close", async () => {
  const socketPath = `/tmp/codex-sky-wire-timeout-${process.pid}-${Date.now()}.sock`;
  const received = [];
  const sentResponses = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const decoder = new FrameDecoder();
    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const message = JSON.parse(frame.text);
        received.push({
          message,
          receivedAt: Date.now()
        });
        if (message.method === "ping") {
          respond(socket, message.id, {
            serverApiVersion: CLIENT_API_VERSION
          });
          continue;
        }
        const requestType = message.params.requestType;
        if (requestType === "ComputerUseIPCListAppsRequest") {
          setTimeout(() => {
            sentResponses.push({
              id: message.id,
              sentAt: Date.now(),
              kind: "late-first"
            });
            respond(socket, message.id, []);
          }, 140);
        } else if (requestType === "ComputerUseIPCAppPolicyRequest") {
          setTimeout(
            () => {
              sentResponses.push({
                id: message.id,
                sentAt: Date.now(),
                kind: "second"
              });
              respond(socket, message.id, {
                allowPersistentApproval: false,
                decision: "allowed",
                target: {
                  appPath: "/Applications/Transport Fixture.app",
                  bundleIdentifier: APP,
                  displayName: "Transport Fixture",
                  risk: "low",
                  warningSubtitle: null
                }
              });
            },
            30
          );
        }
      }
    });
  });
  await listen(server, socketPath);

  const previousNodeRepl = globalThis.nodeRepl;
  try {
    globalThis.nodeRepl = {
      env: { SKY_CUA_NATIVE_PIPE_PATH: socketPath },
      nativePipe: nativePipe(socketPath),
      requestMeta: {}
    };
    const moduleUrl = `${pathToFileURL(SKY_CLIENT_PATH).href}?timeout=${Date.now()}`;
    const { MacComputerUseClient } = await import(moduleUrl);
    const client = new MacComputerUseClient({
      apiVersion: CLIENT_API_VERSION,
      timeoutSeconds: 0.08
    });

    const firstStarted = Date.now();
    const first = client.listApps().then(
      () => ({ ok: true }),
      (error) => ({
        ok: false,
        message: String(error?.message ?? error),
        elapsed: Date.now() - firstStarted
      })
    );
    const second = client.getAppPolicy(APP);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(firstResult.ok, false);
    assert.match(firstResult.message, /timed out/);
    assert.ok(firstResult.elapsed >= 70);
    assert.equal(secondResult.decision, "allowed");

    const requests = received.filter(
      (entry) => entry.message.method === "request"
    );
    assert.equal(requests.length, 2);
    assert.equal(
      requests[1].message.params.requestType,
      "ComputerUseIPCAppPolicyRequest"
    );
    assert.ok(
      requests[1].receivedAt - requests[0].receivedAt >= 70,
      "second request should remain queued until the first promise settles"
    );
    const secondBudget =
      requests[1].message.params.deadlineUnixMilliseconds -
      requests[1].receivedAt;
    assert.ok(secondBudget > 50 && secondBudget <= 80);
    assert.equal(
      received.some((entry) => entry.message.method === "cancel"),
      false
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(sentResponses.length, 2);
    assert.deepEqual(
      new Set(sentResponses.map((response) => response.kind)),
      new Set(["late-first", "second"])
    );
    const lateFirstResponse = sentResponses.find(
      (response) => response.kind === "late-first"
    );
    const secondResponse = sentResponses.find(
      (response) => response.kind === "second"
    );
    assert.ok(lateFirstResponse.sentAt >= requests[0].receivedAt + 120);
    assert.ok(secondResponse.sentAt >= requests[1].receivedAt + 20);
    assert.equal(sockets.size, 1);
  } finally {
    globalThis.nodeRepl = previousNodeRepl;
    await closeServer(server, sockets, socketPath);
  }
});

test("connection failure is not replayed and the next call reconnects with id one", async () => {
  const socketPath = `/tmp/codex-sky-wire-reconnect-${process.pid}-${Date.now()}.sock`;
  const sockets = new Set();
  const requestsByConnection = [];
  let connectionIndex = 0;
  const server = net.createServer((socket) => {
    const currentConnection = connectionIndex;
    connectionIndex += 1;
    requestsByConnection[currentConnection] = [];
    sockets.add(socket);
    const decoder = new FrameDecoder();
    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const message = JSON.parse(frame.text);
        requestsByConnection[currentConnection].push(message);
        if (message.method === "ping") {
          respond(socket, message.id, {
            serverApiVersion: CLIENT_API_VERSION
          });
        } else if (currentConnection === 0) {
          socket.destroy();
        } else {
          respond(socket, message.id, []);
        }
      }
    });
  });
  await listen(server, socketPath);

  const previousNodeRepl = globalThis.nodeRepl;
  try {
    globalThis.nodeRepl = {
      env: { SKY_CUA_NATIVE_PIPE_PATH: socketPath },
      nativePipe: nativePipe(socketPath),
      requestMeta: {}
    };
    const moduleUrl = `${pathToFileURL(SKY_CLIENT_PATH).href}?reconnect=${Date.now()}`;
    const { MacComputerUseClient } = await import(moduleUrl);
    const client = new MacComputerUseClient({
      apiVersion: CLIENT_API_VERSION,
      timeoutSeconds: 1
    });

    await assert.rejects(client.listApps(), /closed before response/);
    const result = await client.listApps();
    assert.deepEqual(result, []);

    assert.equal(connectionIndex, 2);
    const firstRequests = requestsByConnection[0].filter(
      (message) => message.method === "request"
    );
    const secondRequests = requestsByConnection[1].filter(
      (message) => message.method === "request"
    );
    assert.equal(firstRequests.length, 1);
    assert.equal(secondRequests.length, 1);
    assert.equal(firstRequests[0].id, 2);
    assert.equal(secondRequests[0].id, 2);
  } finally {
    globalThis.nodeRepl = previousNodeRepl;
    await closeServer(server, sockets, socketPath);
  }
});

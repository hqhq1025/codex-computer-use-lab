import { createHash } from "node:crypto";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LAB_FIXTURE_ROOT } from "../lib/cua-lab-scenarios.mjs";

const HELPER_PATH =
  "/Users/haoqing/.codex/cua-lab-expired-deadline-helper.mjs";
const OUTPUT_PATH = path.join(LAB_FIXTURE_ROOT, "expired-deadline.json");
const APPROVAL_STORE_PATH = path.join(
  os.homedir(),
  "Library",
  "Group Containers",
  "2DC432GLL2.com.openai.sky.CUAService",
  "Library",
  "Application Support",
  "Software",
  "ComputerUseAppApprovals.json"
);
const HELPER_SOURCE = `import { Buffer } from "node:buffer";
import os from "node:os";
import path from "node:path";
const SOCKET = path.join(os.homedir(), "Library", "Group Containers", "2DC432GLL2.com.openai.sky.CUAService", "IPC", "computeruse.sock");
const VERSION = "CodexComputerUseIPC-2";
function frame(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const result = Buffer.alloc(4 + body.length);
  result.writeUInt32LE(body.length, 0);
  body.copy(result, 4);
  return result;
}
function connect() {
  return nodeRepl.nativePipe.createConnection(SOCKET);
}
async function exchange(socket, value, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const timer = setTimeout(() => done(new Error("expired deadline helper timed out")), timeout);
    const done = (error, result) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      error == null ? resolve(result) : reject(error);
    };
    const onError = (error) => done(error);
    const onClose = () => done(new Error("socket closed before response"));
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
      if (buffered.length < 4) return;
      const length = buffered.readUInt32LE(0);
      if (buffered.length < 4 + length) return;
      done(null, JSON.parse(buffered.subarray(4, 4 + length).toString("utf8")));
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.write(frame(value));
  });
}
export async function sendExpiredSyntheticPolicy() {
  const socket = await connect();
  try {
    const ping = await exchange(socket, {
      id: 1,
      jsonrpc: "2.0",
      method: "ping",
      params: { clientApiVersion: VERSION }
    });
    const request = {
      id: 2,
      jsonrpc: "2.0",
      method: "request",
      params: {
        clientApiVersion: VERSION,
        codexTurnMetadata: {},
        deadlineUnixMilliseconds: Date.now() - 1000,
        requestType: "ComputerUseIPCAppPolicyRequest",
        request: { app: "com.openai.codex.cualab" }
      }
    };
    const response = await exchange(socket, request);
    return { ping, request, response };
  } finally {
    socket.end();
  }
}
`;
const HELPER_SHA256 = sha256(HELPER_SOURCE);

export async function runExpiredDeadlineExperiment() {
  assertNodeReplHost();
  try {
    await lstat(HELPER_PATH);
    throw new Error("Expired deadline helper already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const before = await approvalMetadata();
  assertApprovalAbsent(before, "preflight");
  await writeFile(HELPER_PATH, HELPER_SOURCE, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });

  try {
    if (sha256(await readFile(HELPER_PATH)) !== HELPER_SHA256) {
      throw new Error("Expired deadline helper hash mismatch");
    }
    const helper = await import(
      `${pathToFileURL(HELPER_PATH).href}?sha256=${HELPER_SHA256}`
    );
    const exchange = await helper.sendExpiredSyntheticPolicy();
    const after = await approvalMetadata();
    assertApprovalAbsent(after, "postflight");

    const error = exchange.response?.error ?? null;
    const deadlineRejected =
      error != null && /deadline exceeded/i.test(String(error.message));
    if (!deadlineRejected) {
      throw new Error(
        `Expired policy request was not rejected by deadline: ${JSON.stringify(exchange.response)}`
      );
    }
    const result = {
      schemaVersion: 1,
      experiment: "expired-request-server-admission-deadline",
      request: {
        requestType: exchange.request.params.requestType,
        deadlineRelation: "1000ms before helper dispatch",
        targetBundleIdentifier: exchange.request.params.request.app
      },
      response: {
        errorCode: error.code,
        message: error.message
      },
      conclusion: {
        serverHasAdmissionDeadlineGate: true,
        expiredRequestReachedActionDispatch: false,
        acceptedWorkCancellationEstablished: false
      },
      provenance: {
        helper: {
          path: "$HOME/.codex/cua-lab-expired-deadline-helper.mjs",
          sha256: HELPER_SHA256
        }
      },
      approvalStore: {
        before,
        after
      },
      safety: {
        policyRequestOnly: true,
        uiActionsExecuted: false,
        targetRestrictedToSyntheticBundle: true,
        persistentApprovalAllowed: false
      }
    };
    await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await rm(HELPER_PATH, { force: true });
  }
}

function assertNodeReplHost(runtime = globalThis.nodeRepl) {
  if (
    runtime == null ||
    typeof runtime.write !== "function" ||
    runtime.requestMeta == null
  ) {
    throw new Error("Expired deadline experiment requires node_repl");
  }
}

async function approvalMetadata() {
  try {
    const metadata = await lstat(APPROVAL_STORE_PATH);
    return {
      checked: true,
      present: true,
      type: metadata.isFile() ? "file" : "other"
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        checked: true,
        present: false
      };
    }
    throw error;
  }
}

function assertApprovalAbsent(metadata, label) {
  if (metadata.present !== false) {
    throw new Error(
      `Persistent approval store appeared during ${label}; stopping without deleting it`
    );
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

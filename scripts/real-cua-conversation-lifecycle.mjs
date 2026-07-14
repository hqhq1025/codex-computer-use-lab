import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  LAB_APP_BUNDLE_ID,
  LAB_APP_PATH,
  LAB_STATE_PATH
} from "../lib/cua-lab-scenarios.mjs";

const HELPER_PATH =
  "/Users/haoqing/.codex/cua-lab-conversation-helper.mjs";
const CLIENT_MODULE_PATH =
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky/dist/project/cua/sky_js/src/targets/mac/client.js";
const CLIENT_MODULE_SHA256 =
  "ca40f65f155435db1599c19babf617c6a04af3c5fab5390b33b9610f2696ddc7";
const TURN_ENDED_HELPER_PATH =
  "/Users/haoqing/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000387/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient";
const TURN_ENDED_HELPER_SHA256 =
  "fb3b179358ac77cd15a2093fcaff4db8aacee157339a18c52ddefe25b8752379";
const SERVICE_PATH = path.join(
  os.homedir(),
  ".codex",
  "computer-use",
  "Codex Computer Use.app",
  "Contents",
  "MacOS",
  "SkyComputerUseService"
);
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
const OUTPUT_PATH =
  "/Users/haoqing/Documents/Learning/codex-computer-use-lab/fixtures/real-cua/conversation-lifecycle.json";
const HELPER_SOURCE = `import { pathToFileURL } from "node:url";
const CLIENT = ${JSON.stringify(CLIENT_MODULE_PATH)};
const APP = ${JSON.stringify(LAB_APP_PATH)};
const module = await import(pathToFileURL(CLIENT).href);
const clients = new Map();
function getClient(sessionID, turnID) {
  let client = clients.get(sessionID);
  if (client == null) {
    client = new module.MacComputerUseClient({
      timeoutSeconds: 20,
      codexMetadata: {
        session_id: sessionID,
        thread_id: sessionID,
        turn_id: turnID,
        source: "cua-lab-conversation-lifecycle"
      }
    });
    clients.set(sessionID, client);
  }
  return client;
}
export async function observe(sessionID, turnID, disableDiff = false) {
  if (typeof sessionID !== "string" || typeof turnID !== "string") throw new TypeError("IDs required");
  const result = await getClient(sessionID, turnID).getAppState({ app: APP, disableDiff });
  const text = String(result?.skyshot?.text ?? "");
  const kind = text.startsWith('Window: "Codex CUA Lab"')
    ? "full"
    : text.startsWith("There has been no change")
      ? "no-change-diff"
      : text.startsWith("The following is a diff")
        ? "changed-diff"
        : "other";
  return { kind, characterCount: text.length };
}
`;
const HELPER_SHA256 = sha256(HELPER_SOURCE);

export async function runConversationLifecycleExperiment() {
  assertNodeReplHost();
  await assertPreflight();
  await writeFile(HELPER_PATH, HELPER_SOURCE, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  const sessionA = randomUUID();
  const turnA = randomUUID();
  const sessionB = randomUUID();
  const turnB = randomUUID();
  const logCapture = startLifecycleLogCapture();

  try {
    if (sha256(await readFile(HELPER_PATH)) !== HELPER_SHA256) {
      throw new Error("Conversation helper hash mismatch");
    }
    const helper = await import(
      `${pathToFileURL(HELPER_PATH).href}?sha256=${HELPER_SHA256}`
    );
    const beforeStore = await approvalMetadata();
    assertApprovalAbsent(beforeStore, "preflight");

    const a0 = await helper.observe(sessionA, turnA, true);
    const b0 = await helper.observe(sessionB, turnB, false);
    const afterInitialStore = await approvalMetadata();
    assertApprovalAbsent(afterInitialStore, "initial observations");

    await runTurnEnded(sessionA, turnA);
    const aTurnEndedGate = await waitForLifecycleEffect(
      logCapture,
      sessionA,
      10_000
    );
    const b1 = await helper.observe(sessionB, turnB, false);
    await runTurnEnded(sessionB, turnB);
    const bTurnEndedGate = await waitForLifecycleEffect(
      logCapture,
      sessionB,
      10_000
    );

    const logs = await stopLifecycleLogCapture(logCapture);
    const afterStore = await approvalMetadata();
    assertApprovalAbsent(afterStore, "postflight");
    const lifecycle = classifyLifecycleLogs(logs, sessionA, sessionB);
    if (
      !aTurnEndedGate.serviceEffectObserved ||
      !bTurnEndedGate.serviceEffectObserved
    ) {
      throw new Error(
        "No service-side turn-ended lifecycle effect observed after helper dispatch"
      );
    }
    if (!["full", "no-change-diff", "changed-diff"].includes(b1.kind)) {
      throw new Error(`Client B did not preserve native baseline: ${b1.kind}`);
    }

    const result = {
      schemaVersion: 1,
      experiment: "shared-instance-conversation-deactivate-reactivate",
      target: {
        bundleIdentifier: LAB_APP_BUNDLE_ID,
        appPath: LAB_APP_PATH
      },
      observations: {
        clientAInitial: a0,
        clientBInitial: b0,
        clientBAfterAEnded: b1
      },
      lifecycle,
      conclusion: {
        helperDispatchReachedService: true,
        lockScreenLeaseCleanupObserved:
          lifecycle.lockScreenTurnEndObserved,
        targetTrackerCleanupObserved:
          lifecycle.deactivatedObserved ||
          lifecycle.deactivateFailureObserved,
        endedConversationTriggeredAppDeactivate:
          lifecycle.deactivatedObserved,
        otherConversationContinuedAfterCleanup: true,
        sharedNativeBaselineSurvivedTurnEndedDispatch:
          ["no-change-diff", "changed-diff"].includes(b1.kind),
        noChangeDiffProvesReactivate: false,
        instanceRemovalObserved: false
      },
      provenance: await provenance(),
      approvalStore: {
        before: beforeStore,
        afterInitialObservations: afterInitialStore,
        after: afterStore
      },
      safety: {
        targetRestrictedToSyntheticApp: true,
        observationsOnly: true,
        uiActionsExecuted: false,
        persistentApprovalAllowed: false,
        rawConversationIDsPersisted: false,
        rawLogsPersisted: false
      }
    };
    await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await stopLifecycleLogCapture(logCapture).catch(() => "");
    await rm(HELPER_PATH, { force: true });
  }
}

function startLifecycleLogCapture() {
  const predicate =
    'process == "SkyComputerUseService" AND subsystem == "inc.software.app" AND category == "Computer Use" AND (eventMessage CONTAINS[c] "Received lock-screen turn end" OR eventMessage CONTAINS[c] "Deactivated Computer Use" OR eventMessage CONTAINS[c] "Failed to deactivate Computer Use")';
  const child = spawn(
    "/usr/bin/log",
    ["stream", "--level", "info", "--style", "compact", "--predicate", predicate],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  return {
    child,
    getOutput: () => output,
    stopped: false
  };
}

async function stopLifecycleLogCapture(capture) {
  if (capture.stopped) {
    return capture.getOutput();
  }
  capture.stopped = true;
  capture.child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    capture.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return capture.getOutput();
}

async function waitForLifecycleEffect(capture, threadID, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const logs = capture.getOutput();
    const relevantThreadSeen = logs.includes(threadID);
    const lockScreenEffect =
      logs.includes("Received lock-screen turn end") &&
      logs.includes("removedActiveThread=true");
    const appDeactivateEffect =
      logs.includes("Deactivated Computer Use for ended Codex thread") ||
      logs.includes("Failed to deactivate Computer Use for ended Codex thread");
    if (relevantThreadSeen && (lockScreenEffect || appDeactivateEffect)) {
      return {
        serviceEffectObserved: true,
        lockScreenEffect,
        appDeactivateEffect
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    serviceEffectObserved: false,
    lockScreenEffect: false,
    appDeactivateEffect: false
  };
}

function classifyLifecycleLogs(logs, sessionA, sessionB) {
  return {
    lockScreenTurnEndObserved:
      logs.includes("Received lock-screen turn end") &&
      logs.includes("removedActiveThread=true") &&
      (logs.includes(sessionA) || logs.includes(sessionB)),
    deactivatedObserved: logs.includes(
      "Deactivated Computer Use for ended Codex thread"
    ),
    deactivateFailureObserved: logs.includes(
      "Failed to deactivate Computer Use for ended Codex thread"
    ),
    appServerObserverLogRequired: false,
    rawLogBytesDiscarded: Buffer.byteLength(logs, "utf8")
  };
}

async function runTurnEnded(threadID, turnID) {
  const payload = JSON.stringify({
    type: "agent-turn-complete",
    "thread-id": threadID,
    "turn-id": turnID,
    cwd: "/Users/haoqing/Documents/Learning",
    client: "cua-lab-conversation-lifecycle",
    "input-messages": [],
    "last-assistant-message": null
  });
  await new Promise((resolve, reject) => {
    const child = spawn(TURN_ENDED_HELPER_PATH, ["turn-ended", payload], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          "turn-ended helper did not exit; Apple Event delivery may require the real Codex parent context"
        )
      );
    }, 15_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`turn-ended helper failed (${code}): ${stderr}`));
      }
    });
  });
}

function assertNodeReplHost(runtime = globalThis.nodeRepl) {
  if (
    runtime == null ||
    typeof runtime.write !== "function" ||
    runtime.requestMeta == null
  ) {
    throw new Error("Conversation lifecycle experiment requires node_repl");
  }
}

async function assertPreflight() {
  if ((await realpath(LAB_APP_PATH)) !== LAB_APP_PATH) {
    throw new Error("Synthetic app path mismatch");
  }
  try {
    await lstat(HELPER_PATH);
    throw new Error("Conversation helper already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const oracle = JSON.parse(await readFile(LAB_STATE_PATH, "utf8"));
  if (
    oracle.synthetic !== true ||
    oracle.bundleIdentifier !== LAB_APP_BUNDLE_ID
  ) {
    throw new Error("Synthetic oracle identity mismatch");
  }
  for (const [filePath, expected] of [
    [CLIENT_MODULE_PATH, CLIENT_MODULE_SHA256],
    [TURN_ENDED_HELPER_PATH, TURN_ENDED_HELPER_SHA256]
  ]) {
    if (sha256(await readFile(filePath)) !== expected) {
      throw new Error(`Pinned lifecycle artifact hash mismatch: ${filePath}`);
    }
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

async function provenance() {
  return {
    clientModule: {
      path: "$APP/Contents/Resources/cua_node/lib/node_modules/@oai/sky/.../client.js",
      sha256: CLIENT_MODULE_SHA256
    },
    turnEndedHelper: {
      path: "<computer-use-plugin>/SkyComputerUseClient",
      sha256: TURN_ENDED_HELPER_SHA256
    },
    trustedHelper: {
      path: "$HOME/.codex/cua-lab-conversation-helper.mjs",
      sha256: HELPER_SHA256
    },
    service: {
      path: "<sky-service>",
      bytes: (await stat(SERVICE_PATH)).size,
      sha256: sha256(await readFile(SERVICE_PATH))
    }
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

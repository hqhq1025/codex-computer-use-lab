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
  LAB_BUILD_ROOT,
  LAB_STATE_PATH,
  LAB_SYNTHETIC_MARKER
} from "../lib/cua-lab-scenarios.mjs";

const WRAPPER_PATH =
  "/Users/haoqing/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000387/scripts/computer-use-client.mjs";
const WRAPPER_SHA256 =
  "6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f";
const SERVICE_PATH = path.join(
  os.homedir(),
  ".codex",
  "computer-use",
  "Codex Computer Use.app",
  "Contents",
  "MacOS",
  "SkyComputerUseService"
);
const APP_EXECUTABLE_PATH = path.join(
  LAB_APP_PATH,
  "Contents",
  "MacOS",
  "Codex CUA Lab"
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
const STAGE_PATH = path.join(
  LAB_BUILD_ROOT,
  "..",
  "..",
  "fixtures",
  "real-cua",
  "cross-client-baseline-stage.json"
);
const FINAL_PATH = path.join(
  LAB_BUILD_ROOT,
  "..",
  "..",
  "fixtures",
  "real-cua",
  "cross-client-baseline.json"
);
const KERNEL_MARKER = Symbol.for("openai.cua-lab.cross-client-baseline");

export async function runCrossClientPhaseA() {
  await assertPreflight();
  if (globalThis[KERNEL_MARKER] != null) {
    throw new Error("Phase A requires a fresh node_repl kernel");
  }

  const marker = randomUUID();
  globalThis[KERNEL_MARKER] = marker;
  const audit = [];
  const before = await approvalMetadata();
  assertApprovalAbsent(before, "phase A preflight");

  const sky = await loadSky();
  await auditedCall(audit, "list_apps", () => verifySingleTarget(sky));
  const state = await auditedCall(audit, "get_app_state:full", () =>
    sky.get_app_state({
      app: LAB_APP_BUNDLE_ID,
      disableDiff: true
    })
  );
  assertTargetState(state);
  const after = await approvalMetadata();
  assertApprovalAbsent(after, "phase A postflight");

  const stage = {
    schemaVersion: 1,
    experiment: "cross-node-repl-client-native-diff-baseline",
    target: {
      bundleIdentifier: LAB_APP_BUNDLE_ID,
      appPath: LAB_APP_PATH
    },
    phaseA: {
      kernelMarkerSha256: sha256(marker),
      markerPresentAtEnd: globalThis[KERNEL_MARKER] === marker,
      observation: summarizeState(state),
      approvalStoreBefore: before,
      approvalStoreAfter: after,
      approvalChecks: audit
    },
    requiredBoundary: {
      tool: "mcp__node_repl.js_reset",
      purpose:
        "Terminate the Phase A Node kernel before importing this module for Phase B."
    },
    provenance: await provenance(),
    safety: safetyRecord()
  };
  await writeJson(STAGE_PATH, stage);
  return stage;
}

export async function runCrossClientPhaseB() {
  await assertPreflight();
  const stage = JSON.parse(await readFile(STAGE_PATH, "utf8"));
  if (
    stage?.experiment !==
      "cross-node-repl-client-native-diff-baseline" ||
    stage?.phaseA?.observation?.kind !== "full"
  ) {
    throw new Error("Phase B requires a valid completed Phase A fixture");
  }
  if (globalThis[KERNEL_MARKER] != null) {
    throw new Error(
      "Phase B detected the Phase A in-memory marker; call node_repl js_reset first"
    );
  }

  const audit = [];
  const before = await approvalMetadata();
  assertApprovalAbsent(before, "phase B preflight");
  const sky = await loadSky();
  await auditedCall(audit, "list_apps", () => verifySingleTarget(sky));
  const state = await auditedCall(audit, "get_app_state:default-diff", () =>
    sky.get_app_state({
      app: LAB_APP_BUNDLE_ID
    })
  );
  assertTargetState(state);
  const observation = summarizeState(state);
  if (observation.kind !== "no-change-diff") {
    throw new Error(
      `Phase B first observation did not reuse a native baseline: ${observation.kind}`
    );
  }
  const after = await approvalMetadata();
  assertApprovalAbsent(after, "phase B postflight");

  const final = {
    ...stage,
    phaseB: {
      phaseAMarkerPresentAtStart: false,
      observation,
      approvalStoreBefore: before,
      approvalStoreAfter: after,
      approvalChecks: audit
    },
    conclusion: {
      clientBoundaryCrossed: true,
      phaseBHadNoClientLocalFullObservation: true,
      phaseBFirstObservationWasNativeNoChangeDiff: true,
      nativeLastAXTreeSharedAcrossNodeReplKernels: true
    }
  };
  await writeJson(FINAL_PATH, final);
  await rm(STAGE_PATH, { force: true });
  return final;
}

function summarizeState(state) {
  const text = String(state.text ?? "");
  let kind = "unknown";
  if (text.startsWith('Window: "Codex CUA Lab"')) {
    kind = "full";
  } else if (
    text.startsWith(
      'There has been no change in the accessibility tree for Window: "Codex CUA Lab".'
    )
  ) {
    kind = "no-change-diff";
  } else if (
    text.startsWith(
      "The following is a diff from the previous accessibility tree"
    )
  ) {
    kind = "changed-diff";
  }
  return {
    kind,
    characterCount: text.length,
    sha256: sha256(text),
    syntheticMarkerPresent:
      text.includes(LAB_SYNTHETIC_MARKER) || kind === "no-change-diff",
    screenshotPresent:
      typeof state.screenshot?.url === "string" &&
      state.screenshot.url.startsWith("file://")
  };
}

async function assertPreflight() {
  assertNodeReplHost();
  if ((await realpath(LAB_APP_PATH)) !== LAB_APP_PATH) {
    throw new Error("Synthetic app path is not the pinned real path");
  }
  const oracle = JSON.parse(await readFile(LAB_STATE_PATH, "utf8"));
  if (
    oracle?.synthetic !== true ||
    oracle?.bundleIdentifier !== LAB_APP_BUNDLE_ID ||
    oracle?.appPath !== LAB_APP_PATH
  ) {
    throw new Error("Synthetic state oracle identity mismatch");
  }
  const wrapperHash = sha256(await readFile(WRAPPER_PATH));
  if (wrapperHash !== WRAPPER_SHA256) {
    throw new Error("Pinned Computer Use wrapper hash mismatch");
  }
}

function assertNodeReplHost(runtime = globalThis.nodeRepl) {
  if (
    runtime == null ||
    typeof runtime.write !== "function" ||
    runtime.requestMeta == null ||
    typeof runtime.requestMeta !== "object"
  ) {
    throw new Error("Cross-client experiment requires the Codex node_repl host");
  }
}

async function loadSky() {
  const wrapper = await import(pathToFileURL(WRAPPER_PATH).href);
  return wrapper.setupComputerUseRuntime({ globals: globalThis });
}

async function verifySingleTarget(sky) {
  const apps = await sky.list_apps();
  const matches = apps.filter((app) => app?.id === LAB_APP_BUNDLE_ID);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one synthetic app, found ${matches.length}`
    );
  }
}

function assertTargetState(state) {
  if (state?.app !== LAB_APP_PATH && state?.app !== LAB_APP_BUNDLE_ID) {
    throw new Error(`Unexpected Computer Use target: ${String(state?.app)}`);
  }
}

async function auditedCall(audit, label, callback) {
  const result = await callback();
  const store = await approvalMetadata();
  assertApprovalAbsent(store, `postflight ${label}`);
  audit.push({ label, store });
  return result;
}

async function approvalMetadata() {
  try {
    const metadata = await lstat(APPROVAL_STORE_PATH);
    return {
      checked: true,
      present: true,
      type: metadata.isSymbolicLink()
        ? "symlink"
        : metadata.isFile()
          ? "file"
          : metadata.isDirectory()
            ? "directory"
            : "other"
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
    labAppExecutable: await executableProvenance(APP_EXECUTABLE_PATH),
    skyServiceExecutable: await executableProvenance(SERVICE_PATH),
    wrapper: {
      path: "<computer-use-wrapper>",
      sha256: WRAPPER_SHA256
    }
  };
}

async function executableProvenance(filePath) {
  const metadata = await stat(filePath);
  return {
    path:
      filePath === APP_EXECUTABLE_PATH
        ? "<lab-app>/Contents/MacOS/Codex CUA Lab"
        : "<sky-service>",
    bytes: metadata.size,
    sha256: sha256(await readFile(filePath))
  };
}

function safetyRecord() {
  return {
    targetRestrictedToSyntheticApp: true,
    observationsOnly: true,
    uiActionsExecuted: false,
    persistentApprovalAllowed: false,
    externalCommunicationAllowed: false
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

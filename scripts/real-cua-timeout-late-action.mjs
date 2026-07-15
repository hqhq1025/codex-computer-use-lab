import { createHash } from "node:crypto";
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
  LAB_FIXTURE_ROOT,
  LAB_STATE_PATH,
  resolveElementIndex
} from "../lib/cua-lab-scenarios.mjs";

const HELPER_PATH = "/Users/haoqing/.codex/cua-lab-timeout-helper.mjs";
const HELPER_SOURCE = `import path from "node:path";
import { pathToFileURL } from "node:url";
const CLIENT_ENTRY = ["@oai","sky","dist","project","cua","sky_js","src","targets","mac","client.js"];
const ROOT = "/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules";
const APP = ${JSON.stringify(LAB_APP_PATH)};
export async function timedSyntheticClick(elementIndex) {
  if (!Number.isInteger(elementIndex)) throw new TypeError("elementIndex must be an integer");
  const roots = String(nodeRepl.env.NODE_REPL_NODE_MODULE_DIRS ?? "").split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
  if (roots.length !== 1 || path.resolve(roots[0]) !== ROOT) throw new Error("Unexpected node_repl node_modules root");
  const nodeModulesRoot = path.basename(roots[0]) === "node_modules" ? roots[0] : path.join(roots[0], "node_modules");
  const module = await import(pathToFileURL(path.join(nodeModulesRoot, ...CLIENT_ENTRY)).href);
  if (typeof module.MacComputerUseClient !== "function") throw new Error("Packaged @oai/sky is missing MacComputerUseClient");
  const client = new module.MacComputerUseClient({ timeoutSeconds: 0.001 });
  return client.click({ app: APP, elementIndex }, { timeoutSeconds: 0.001 });
}
`;
const HELPER_SHA256 = sha256(HELPER_SOURCE);
const CLIENT_MODULE_PATH =
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky/dist/project/cua/sky_js/src/targets/mac/client.js";
const CLIENT_MODULE_SHA256 =
  "ca40f65f155435db1599c19babf617c6a04af3c5fab5390b33b9610f2696ddc7";
const NATIVE_PIPE_MODULE_PATH =
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky/dist/project/cua/sky_js/src/targets/mac/native-pipe.js";
const NATIVE_PIPE_MODULE_SHA256 =
  "3b294dcb269ad65166b184bcca48c7bab0698162ca7a4fc8c7b4978990b82bf2";
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
const OUTPUT_PATH = path.join(LAB_FIXTURE_ROOT, "timeout-late-action.json");

export async function runTimeoutLateActionExperiment() {
  assertNodeReplHost();
  await assertPinnedArtifactsBeforeHelper();
  await writeFile(HELPER_PATH, HELPER_SOURCE, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  try {
    await assertPinnedHelper();
    const audit = [];
    const beforeStore = await approvalMetadata();
    assertApprovalAbsent(beforeStore, "preflight");

    const wrapper = await import(pathToFileURL(WRAPPER_PATH).href);
    const sky = await wrapper.setupComputerUseRuntime({ globals: globalThis });
    const fullState = await auditedCall(audit, "get_app_state:full", () =>
      sky.get_app_state({
        app: LAB_APP_BUNDLE_ID,
        disableDiff: true
      })
    );
    const elementIndex = resolveElementIndex(fullState.text, {
      lineIncludes: [
        "CUA Lab Primary Button",
        "ID: cua.lab.primary-button"
      ],
      expectedMatches: 1,
      occurrence: 1
    });

    const beforeOracle = await readOracle();
    const helper = await import(
      `${pathToFileURL(HELPER_PATH).href}?sha256=${HELPER_SHA256}`
    );

    const startedAt = Date.now();
    let call;
    try {
      await helper.timedSyntheticClick(elementIndex);
      call = {
        ok: true,
        elapsedMilliseconds: Date.now() - startedAt
      };
    } catch (error) {
      call = {
        ok: false,
        elapsedMilliseconds: Date.now() - startedAt,
        name: error?.name ?? null,
        message: String(error?.message ?? error)
      };
    }
    if (call.ok || !/request timed out/u.test(call.message)) {
      throw new Error(
        `Expected a real Mac client timeout, received ${JSON.stringify(call)}`
      );
    }
    const afterTimeoutStore = await approvalMetadata();
    assertApprovalAbsent(afterTimeoutStore, "post-timeout");
    audit.push({
      label: "action:click:client-timeout",
      store: afterTimeoutStore
    });

    const samples = [];
    let firstChanged = null;
    for (let index = 0; index < 500; index += 1) {
      const oracle = await readOracle();
      const sample = {
        millisecondsSinceDispatch: Date.now() - startedAt,
        buttonClickCount: oracle.controls.buttonClickCount,
        lastAction: oracle.meta.lastAction
      };
      samples.push(sample);
      if (
        oracle.controls.buttonClickCount >
        beforeOracle.controls.buttonClickCount
      ) {
        firstChanged = sample;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (firstChanged == null) {
      throw new Error("Timed-out native click produced no late synthetic side effect");
    }

    const finalStore = await approvalMetadata();
    assertApprovalAbsent(finalStore, "final postflight");
    const result = {
    schemaVersion: 1,
    experiment: "real-mac-client-timeout-late-native-action",
    target: {
      bundleIdentifier: LAB_APP_BUNDLE_ID,
      appPath: LAB_APP_PATH,
      element: "CUA Lab Primary Button",
      elementIndex
    },
    timeout: {
      configuredSeconds: 0.001,
      call,
      sideEffectObservedAfterMilliseconds:
        firstChanged.millisecondsSinceDispatch,
      delayAfterClientRejectionMilliseconds:
        firstChanged.millisecondsSinceDispatch -
        call.elapsedMilliseconds
    },
    oracle: {
      beforeButtonClickCount: beforeOracle.controls.buttonClickCount,
      afterButtonClickCount: firstChanged.buttonClickCount,
      firstChanged,
      sampleCount: samples.length,
      tailSamples: samples.slice(-12)
    },
    conclusion: {
      clientTimeoutCanceledNativeAction: false,
      clientRejectedBeforeSideEffect: true,
      lateNativeSideEffectObserved: true
    },
    provenance: await provenance(),
    approvalStore: {
      before: beforeStore,
      afterTimeout: afterTimeoutStore,
      final: finalStore,
      checks: audit
    },
    safety: {
      targetRestrictedToSyntheticApp: true,
      exactlyOneTimedOutUiAction: true,
      persistentApprovalAllowed: false,
      externalCommunicationAllowed: false,
      systemSettingsAllowed: false
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
    runtime.requestMeta == null ||
    typeof runtime.requestMeta !== "object"
  ) {
    throw new Error("Timeout experiment requires the Codex node_repl host");
  }
}

async function assertPinnedArtifactsBeforeHelper() {
  if ((await realpath(LAB_APP_PATH)) !== LAB_APP_PATH) {
    throw new Error("Synthetic app path is not pinned");
  }
  try {
    await lstat(HELPER_PATH);
    throw new Error("Trusted timeout helper already exists; refusing overwrite");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  if (sha256(await readFile(WRAPPER_PATH)) !== WRAPPER_SHA256) {
    throw new Error("Computer Use wrapper hash mismatch");
  }
  for (const [filePath, expected] of [
    [CLIENT_MODULE_PATH, CLIENT_MODULE_SHA256],
    [NATIVE_PIPE_MODULE_PATH, NATIVE_PIPE_MODULE_SHA256]
  ]) {
    if (sha256(await readFile(filePath)) !== expected) {
      throw new Error(`Internal Sky module hash mismatch: ${filePath}`);
    }
  }
  const oracle = await readOracle();
  if (
    oracle.synthetic !== true ||
    oracle.bundleIdentifier !== LAB_APP_BUNDLE_ID ||
    oracle.appPath !== LAB_APP_PATH
  ) {
    throw new Error("Synthetic oracle identity mismatch");
  }
}

async function assertPinnedHelper() {
  if (sha256(await readFile(HELPER_PATH)) !== HELPER_SHA256) {
    throw new Error("Trusted timeout helper hash mismatch");
  }
}

async function readOracle() {
  return JSON.parse(await readFile(LAB_STATE_PATH, "utf8"));
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
      type: metadata.isFile()
        ? "file"
        : metadata.isDirectory()
          ? "directory"
          : metadata.isSymbolicLink()
            ? "symlink"
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
    labAppExecutable: await executableProvenance(
      APP_EXECUTABLE_PATH,
      "<lab-app>/Contents/MacOS/Codex CUA Lab"
    ),
    skyServiceExecutable: await executableProvenance(
      SERVICE_PATH,
      "<sky-service>"
    ),
    wrapper: {
      path: "<computer-use-wrapper>",
      sha256: WRAPPER_SHA256
    },
    trustedHelper: {
      path: "$HOME/.codex/cua-lab-timeout-helper.mjs",
      sha256: HELPER_SHA256
    },
    internalClient: {
      path: "$APP/Contents/Resources/cua_node/lib/node_modules/@oai/sky/.../client.js",
      sha256: CLIENT_MODULE_SHA256
    },
    nativePipe: {
      path: "$APP/Contents/Resources/cua_node/lib/node_modules/@oai/sky/.../native-pipe.js",
      sha256: NATIVE_PIPE_MODULE_SHA256
    }
  };
}

async function executableProvenance(filePath, normalizedPath) {
  const metadata = await stat(filePath);
  return {
    path: normalizedPath,
    bytes: metadata.size,
    sha256: sha256(await readFile(filePath))
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

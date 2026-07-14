#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { redactSecrets } from "../lib/redaction.mjs";
import {
  ALLOWED_SKY_ACTIONS,
  LAB_APP_BUNDLE_ID,
  LAB_APP_PATH,
  LAB_BUILD_ROOT,
  LAB_FIXTURE_ROOT,
  LAB_RUNTIME_ROOT,
  LAB_STATE_PATH,
  LAB_SYNTHETIC_MARKER,
  REAL_CUA_EXECUTABLE_SCENARIO_IDS,
  REAL_CUA_SCENARIOS,
  REAL_CUA_SCENARIO_IDS,
  SYNTHETIC_AX_LABELS,
  resolveElementIndex,
  validateExecutableScenarioIds,
  validateScenarioIds
} from "../lib/cua-lab-scenarios.mjs";

export const COMPUTER_USE_WRAPPER_PATH =
  "/Users/haoqing/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000387/scripts/computer-use-client.mjs";
export const COMPUTER_USE_WRAPPER_SHA256 =
  "6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f";
export const PERSISTENT_APPROVAL_STORE_PATH = path.join(
  os.homedir(),
  "Library",
  "Group Containers",
  "2DC432GLL2.com.openai.sky.CUAService",
  "Library",
  "Application Support",
  "Software",
  "ComputerUseAppApprovals.json"
);
const LAB_APP_EXECUTABLE_PATH = path.join(
  LAB_APP_PATH,
  "Contents",
  "MacOS",
  "Codex CUA Lab"
);
const SKY_SERVICE_EXECUTABLE_PATH = path.join(
  os.homedir(),
  ".codex",
  "computer-use",
  "Codex Computer Use.app",
  "Contents",
  "MacOS",
  "SkyComputerUseService"
);

const MAX_ORACLE_BYTES = 1024 * 1024;
const STANDARD_AX_LABELS = new Set(SYNTHETIC_AX_LABELS);
const LAB_MODAL_MARKER = "ID: cua.lab.modal-window";
const LAB_SECONDARY_WINDOW_MARKER = "ID: cua.lab.secondary-window";
const ALLOWED_CLI_FLAGS = new Set([
  "--execute",
  "--copy-screenshots",
  "--scenario",
  "--out",
  "--help"
]);
const ALLOWED_RUN_OPTION_KEYS = new Set([
  "execute",
  "copyScreenshots",
  "scenarioIds",
  "outputPath",
  "help"
]);

export function parseCliArgs(argv) {
  const options = {
    execute: false,
    copyScreenshots: false,
    scenarioIds: [],
    outputPath: undefined,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!ALLOWED_CLI_FLAGS.has(argument)) {
      throw new Error(`Unknown or forbidden argument: ${argument}`);
    }
    if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--copy-screenshots") {
      options.copyScreenshots = true;
    } else if (argument === "--scenario") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--scenario requires an allowlisted scenario id");
      }
      options.scenarioIds.push(value);
      index += 1;
    } else if (argument === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--out requires a path below fixtures/real-cua");
      }
      options.outputPath = value;
      index += 1;
    } else if (argument === "--help") {
      options.help = true;
    }
  }

  if (options.scenarioIds.length > 0) {
    options.scenarioIds = validateScenarioIds(options.scenarioIds);
  }
  if (options.copyScreenshots && !options.execute) {
    throw new Error("--copy-screenshots requires --execute");
  }
  if (options.outputPath) {
    options.outputPath = assertFixtureOutputPath(options.outputPath);
  }
  return options;
}

export function assertAllowedTarget({
  bundleId = LAB_APP_BUNDLE_ID,
  appPath = LAB_APP_PATH,
  statePath = LAB_STATE_PATH
} = {}) {
  if (bundleId !== LAB_APP_BUNDLE_ID) {
    throw new Error(`Refusing non-lab bundle identifier: ${bundleId}`);
  }
  if (path.resolve(appPath) !== LAB_APP_PATH) {
    throw new Error(`Refusing non-lab application path: ${appPath}`);
  }
  if (!isPathInside(path.resolve(appPath), LAB_BUILD_ROOT)) {
    throw new Error(`Lab application is outside the fixed build root: ${appPath}`);
  }
  if (path.resolve(statePath) !== LAB_STATE_PATH) {
    throw new Error(`Refusing non-lab state oracle path: ${statePath}`);
  }
  if (!isPathInside(path.resolve(statePath), LAB_RUNTIME_ROOT)) {
    throw new Error(`Lab oracle is outside the fixed runtime root: ${statePath}`);
  }
  return {
    bundleId: LAB_APP_BUNDLE_ID,
    appPath: LAB_APP_PATH,
    statePath: LAB_STATE_PATH
  };
}

export function assertFixtureOutputPath(outputPath) {
  const absolute = path.resolve(outputPath);
  if (!isPathInside(absolute, LAB_FIXTURE_ROOT)) {
    throw new Error(`Output must stay below ${LAB_FIXTURE_ROOT}`);
  }
  return absolute;
}

export function buildDryRunPlan({ scenarioIds = REAL_CUA_SCENARIO_IDS } = {}) {
  const selectedIds = validateScenarioIds(scenarioIds);
  const selected = selectedIds.map((id) =>
    REAL_CUA_SCENARIOS.find((scenario) => scenario.id === id)
  );
  return sanitizeResultValue({
    schemaVersion: 1,
    mode: "dry-run",
    target: {
      bundleIdentifier: LAB_APP_BUNDLE_ID,
      appPath: LAB_APP_PATH,
      stateOraclePath: LAB_STATE_PATH
    },
    safety: {
      executeFlagRequired: true,
      productionCuaRequestSent: false,
      uiActionsExecuted: false,
      externalCommunicationAllowed: false,
      deleteAllowed: false,
      systemSettingsAllowed: false,
      persistentApprovalAllowed: false,
      persistentApprovalStoreBefore: {
        checked: false,
        present: null
      },
      persistentApprovalStoreAfter: {
        checked: false,
        present: null
      },
      screenshotsCopied: false
    },
    wrapper: {
      path: COMPUTER_USE_WRAPPER_PATH,
      directSkyImportAllowed: false
    },
    stepPattern: [
      "fresh-full-get_app_state",
      "read-state-json-before",
      "one-allowlisted-action",
      "fresh-get_app_state-after",
      "read-state-json-after",
      "compare-oracle"
    ],
    scenarios: structuredClone(selected)
  });
}

export async function runRealCuaLab(options = {}) {
  assertRunOptions(options);
  const scenarioIds = options.execute
    ? validateExecutableScenarioIds(options.scenarioIds ?? [])
    : validateScenarioIds(options.scenarioIds ?? []);
  assertAllowedTarget();

  if (!options.execute) {
    const plan = buildDryRunPlan({ scenarioIds });
    if (options.outputPath) {
      await writeJsonFixture(options.outputPath, plan);
    }
    return plan;
  }

  if (options.copyScreenshots && !options.execute) {
    throw new Error("Screenshot copying requires real execution");
  }
  if (options.outputPath) {
    assertFixtureOutputPath(options.outputPath);
  }

  await preflightRealExecution();
  const approvalAudit = {
    before: await readPersistentApprovalStoreMetadata(),
    after: null,
    checks: []
  };
  assertPersistentApprovalStoreAbsent(approvalAudit.before, "preflight");
  const provenance = await collectExecutionProvenance();
  const runId = safeRunId();
  const results = [];
  const context = {
    actionCallsAttempted: 0,
    actionCallsCompleted: 0,
    captures: new Map(),
    copiedScreenshots: [],
    runId
  };

  try {
    const sky = await loadRealSky();
    await verifySingleAllowlistedApp(sky, approvalAudit);

    for (const scenarioId of scenarioIds) {
      const scenario = REAL_CUA_SCENARIOS.find(
        (entry) => entry.id === scenarioId
      );
      results.push(
        await executeScenario({
          context,
          copyScreenshots: Boolean(options.copyScreenshots),
          approvalAudit,
          scenario,
          sky
        })
      );
    }

    const result = sanitizeResultValue({
      schemaVersion: 1,
      mode: "execute",
      runId,
      target: {
        bundleIdentifier: LAB_APP_BUNDLE_ID,
        appPath: LAB_APP_PATH,
        stateOraclePath: LAB_STATE_PATH
      },
      provenance,
      safety: {
        productionCuaRequestSent: true,
        uiActionsExecuted: context.actionCallsCompleted > 0,
        externalCommunicationAllowed: false,
        deleteAllowed: false,
        systemSettingsAllowed: false,
        persistentApprovalAllowed: false,
        persistentApprovalStoreBefore: approvalAudit.before,
        persistentApprovalStoreAfter:
          approvalAudit.after ?? approvalAudit.before,
        persistentApprovalChecks: approvalAudit.checks,
        screenshotsCopied: context.copiedScreenshots.length > 0
      },
      scenarios: results,
      copiedScreenshots: context.copiedScreenshots
    });

    if (options.outputPath) {
      await writeJsonFixture(options.outputPath, result);
    }
    return result;
  } catch (error) {
    approvalAudit.after ??= await readPersistentApprovalStoreMetadata();
    const failure = sanitizeResultValue({
      schemaVersion: 1,
      mode: "execute",
      passed: false,
      target: {
        bundleIdentifier: LAB_APP_BUNDLE_ID,
        appPath: LAB_APP_PATH,
        stateOraclePath: LAB_STATE_PATH
      },
      provenance,
      safety: {
        productionCuaRequestSent: approvalAudit.checks.length > 0,
        uiActionsExecuted:
          context.actionCallsAttempted > context.actionCallsCompleted &&
          context.actionCallsCompleted === 0
            ? null
            : context.actionCallsCompleted > 0,
        externalCommunicationAllowed: false,
        deleteAllowed: false,
        systemSettingsAllowed: false,
        persistentApprovalAllowed: false,
        persistentApprovalStoreBefore: approvalAudit.before,
        persistentApprovalStoreAfter: approvalAudit.after,
        persistentApprovalChecks: approvalAudit.checks,
        approvalStoreDeletedByRunner: false
      },
      completedScenarios: results,
      error: sanitizeError(error)
    });
    if (options.outputPath) {
      await writeJsonFixture(options.outputPath, failure);
    }
    Object.defineProperty(error, "result", {
      configurable: true,
      enumerable: false,
      value: failure
    });
    throw error;
  }
}

async function executeScenario({
  context,
  copyScreenshots,
  approvalAudit,
  scenario,
  sky
}) {
  const steps = [];
  context.captures.clear();

  for (const step of scenario.steps) {
    const beforeState =
      step.preObservation === "cached"
        ? context.lastObservedState
        : await freshState(sky, "full", approvalAudit);
    if (!beforeState) {
      throw new Error(
        `Scenario ${scenario.id}/${step.id} requires a cached state`
      );
    }
    if (step.preObservation !== "cached") {
      context.lastObservedState = beforeState;
    }
    validateSyntheticAxText(beforeState.text);
    const beforeOracle = await readOracle();
    const preconditions = evaluateOracleChecks(
      step.preconditions ?? [],
      beforeOracle,
      beforeOracle
    );
    if (preconditions.some((check) => !check.passed)) {
      throw new Error(
        `Precondition failed for ${scenario.id}/${step.id}: ${preconditions
          .filter((check) => !check.passed)
          .map((check) => `${check.path} ${check.operator}`)
          .join(", ")}`
      );
    }
    const beforeSummary = await summarizeState(beforeState, {
      copyScreenshots,
      context,
      label: `${scenario.id}-${step.id}-before`
    });

    for (const capture of step.captures ?? []) {
      if (capture.selector) {
        context.captures.set(
          capture.name,
          resolveElementIndex(beforeState.text, capture.selector)
        );
      } else if (capture.coordinateFromOracle) {
        context.captures.set(
          capture.name,
          scaleOraclePointToScreenshot(
            {
              x: valueAtPath(
                beforeOracle,
                capture.coordinateFromOracle.xPath
              ),
              y: valueAtPath(
                beforeOracle,
                capture.coordinateFromOracle.yPath
              )
            },
            beforeOracle,
            beforeSummary.screenshot
          )
        );
      }
    }

    const actionInput = buildActionInput(
      step.action,
      beforeState,
      beforeOracle,
      beforeSummary,
      context
    );
    let actionError = null;
    let actionExecuted = false;
    try {
      context.actionCallsAttempted += 1;
      await executeAllowlistedAction(
        sky,
        step.action.method,
        actionInput,
        approvalAudit
      );
      actionExecuted = true;
      context.actionCallsCompleted += 1;
    } catch (error) {
      actionError = sanitizeError(error);
      if (!step.allowActionError) {
        throw error;
      }
    }
    if (step.requireActionError && actionError == null) {
      throw new Error(
        `Expected action error for ${scenario.id}/${step.id}, but the action completed`
      );
    }
    const postActionSettleMilliseconds = validatePostActionSettleMilliseconds(
      step.postActionSettleMilliseconds
    );
    if (postActionSettleMilliseconds > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, postActionSettleMilliseconds)
      );
    }

    const afterCapture =
      step.postObservation === "oracle-only"
        ? null
        : step.postObservation === "diff-then-full"
          ? await freshState(sky, "diff", approvalAudit)
          : await freshState(sky, "full", approvalAudit);
    const afterFullState =
      step.postObservation === "oracle-only"
        ? null
        : step.postObservation === "diff-then-full"
          ? await freshState(sky, "full", approvalAudit)
          : afterCapture;
    if (afterFullState) {
      validateSyntheticAxText(afterFullState.text);
      context.lastObservedState = afterFullState;
    }
    const afterOracle = await readOracle();
    const checks = evaluateOracleChecks(
      step.oracle,
      beforeOracle,
      afterOracle
    );
    if (checks.some((check) => !check.passed)) {
      throw new Error(
        `Oracle failed for ${scenario.id}/${step.id}: ${checks
          .filter((check) => !check.passed)
          .map((check) => `${check.path} ${check.operator}`)
          .join(", ")}`
      );
    }

    const afterSummary = afterFullState
      ? await summarizeState(afterFullState, {
          copyScreenshots,
          context,
          label: `${scenario.id}-${step.id}-after`
        })
      : null;
    const diffSummary =
      step.postObservation === "diff-then-full"
        ? {
            ...summarizeAxText(afterCapture.text),
            syntheticText: afterCapture.text
          }
        : null;

    steps.push({
      id: step.id,
      preconditions,
      observations: {
        before: beforeSummary,
        after: afterSummary,
        diff: diffSummary
      },
      action: {
        method: step.action.method,
        input: sanitizeActionInput(actionInput),
        executed: actionExecuted,
        error: actionError,
        postActionSettleMilliseconds
      },
      oracle: checks
    });
  }

  return {
    id: scenario.id,
    passed: true,
    steps
  };
}

function buildActionInput(
  action,
  beforeState,
  beforeOracle,
  beforeSummary,
  context
) {
  const input = { app: LAB_APP_BUNDLE_ID };
  if (action.selector) {
    input.element_index = resolveElementIndex(
      beforeState.text,
      action.selector
    );
  } else if (action.capturedIndex) {
    if (!context.captures.has(action.capturedIndex)) {
      throw new Error(`Missing captured element index: ${action.capturedIndex}`);
    }
    input.element_index = context.captures.get(action.capturedIndex);
  }
  if (action.capturedCoordinate) {
    const coordinate = context.captures.get(action.capturedCoordinate);
    if (
      coordinate == null ||
      !Number.isFinite(coordinate.x) ||
      !Number.isFinite(coordinate.y)
    ) {
      throw new Error(`Missing captured coordinate: ${action.capturedCoordinate}`);
    }
    assertFreshScreenshotContains(
      beforeState,
      beforeSummary.screenshot,
      coordinate
    );
    input.x = coordinate.x;
    input.y = coordinate.y;
  }

  if (action.coordinate) {
    assertFreshScreenshotContains(
      beforeState,
      beforeSummary.screenshot,
      action.coordinate
    );
    input.x = action.coordinate.x;
    input.y = action.coordinate.y;
  }
  if (action.coordinateFromOracle) {
    const coordinate = scaleOraclePointToScreenshot(
      {
      x: valueAtPath(beforeOracle, action.coordinateFromOracle.xPath),
      y: valueAtPath(beforeOracle, action.coordinateFromOracle.yPath)
      },
      beforeOracle,
      beforeSummary.screenshot
    );
    assertFreshScreenshotContains(
      beforeState,
      beforeSummary.screenshot,
      coordinate
    );
    input.x = coordinate.x;
    input.y = coordinate.y;
  }
  if (action.coordinates) {
    assertFreshScreenshotContains(
      beforeState,
      beforeSummary.screenshot,
      {
        x: action.coordinates.from_x,
        y: action.coordinates.from_y
      }
    );
    assertFreshScreenshotContains(
      beforeState,
      beforeSummary.screenshot,
      {
        x: action.coordinates.to_x,
        y: action.coordinates.to_y
      }
    );
    Object.assign(input, action.coordinates);
  }
  if (action.coordinatesFromOracle) {
    const from = scaleOraclePointToScreenshot(
      {
        x: valueAtPath(beforeOracle, action.coordinatesFromOracle.fromXPath),
        y: valueAtPath(beforeOracle, action.coordinatesFromOracle.fromYPath)
      },
      beforeOracle,
      beforeSummary.screenshot
    );
    const to = scaleOraclePointToScreenshot(
      {
        x: valueAtPath(beforeOracle, action.coordinatesFromOracle.toXPath),
        y: valueAtPath(beforeOracle, action.coordinatesFromOracle.toYPath)
      },
      beforeOracle,
      beforeSummary.screenshot
    );
    const coordinates = {
      from_x: from.x,
      from_y: from.y,
      to_x: to.x,
      to_y: to.y
    };
    assertFreshScreenshotContains(
      beforeState,
      beforeSummary.screenshot,
      { x: coordinates.from_x, y: coordinates.from_y }
    );
    assertFreshScreenshotContains(
      beforeState,
      beforeSummary.screenshot,
      { x: coordinates.to_x, y: coordinates.to_y }
    );
    Object.assign(input, coordinates);
  }
  if (action.coordinatesFromScreenshot) {
    const startX = Math.round(
      beforeSummary.screenshot.width *
        action.coordinatesFromScreenshot.startXRatio
    );
    const startY = action.coordinatesFromScreenshot.startY;
    const coordinates = {
      from_x: startX,
      from_y: startY,
      to_x: startX + action.coordinatesFromScreenshot.deltaX,
      to_y: startY + action.coordinatesFromScreenshot.deltaY
    };
    assertFreshScreenshotContains(
      beforeState,
      beforeSummary.screenshot,
      { x: coordinates.from_x, y: coordinates.from_y }
    );
    assertFreshScreenshotContains(
      beforeState,
      beforeSummary.screenshot,
      { x: coordinates.to_x, y: coordinates.to_y }
    );
    Object.assign(input, coordinates);
  }

  for (const key of [
    "key",
    "value",
    "text",
    "prefix",
    "suffix",
    "selection_type",
    "action",
    "direction",
    "pages",
    "mouse_button",
    "click_count"
  ]) {
    if (Object.hasOwn(action, key)) {
      input[key] = action[key];
    }
  }
  return Object.freeze(input);
}

function validatePostActionSettleMilliseconds(value) {
  if (value == null) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0 || value > 3000) {
    throw new Error(
      `postActionSettleMilliseconds must be an integer between 0 and 3000, got ${String(value)}`
    );
  }
  return value;
}

async function executeAllowlistedAction(sky, method, input, approvalAudit) {
  if (!ALLOWED_SKY_ACTIONS.includes(method)) {
    throw new Error(`Sky action is not allowlisted: ${method}`);
  }
  if (input.app !== LAB_APP_BUNDLE_ID) {
    throw new Error(`Refusing action against ${String(input.app)}`);
  }
  if (typeof sky?.[method] !== "function") {
    throw new Error(`Real Sky runtime is missing ${method}`);
  }
  return auditedProductionCuaCall(
    approvalAudit,
    `action:${method}`,
    () => sky[method](input)
  );
}

async function freshState(sky, mode, approvalAudit) {
  if (typeof sky?.get_app_state !== "function") {
    throw new Error("Real Sky runtime is missing get_app_state");
  }
  const state = await auditedProductionCuaCall(
    approvalAudit,
    `get_app_state:${mode}`,
    () =>
      sky.get_app_state({
        app: LAB_APP_BUNDLE_ID,
        disableDiff: mode === "full"
      })
  );
  assertStateTarget(state.app);
  return state;
}

export function assertStateTarget(app) {
  if (app !== LAB_APP_BUNDLE_ID && app !== LAB_APP_PATH) {
    throw new Error(`Computer Use returned an unexpected app target: ${String(app)}`);
  }
  return LAB_APP_BUNDLE_ID;
}

async function verifySingleAllowlistedApp(sky, approvalAudit) {
  if (typeof sky?.list_apps !== "function") {
    throw new Error("Real Sky runtime is missing list_apps");
  }
  const apps = await auditedProductionCuaCall(
    approvalAudit,
    "list_apps",
    () => sky.list_apps()
  );
  const matches = apps.filter((app) => app?.id === LAB_APP_BUNDLE_ID);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${LAB_APP_BUNDLE_ID} app, found ${matches.length}`
    );
  }
}

async function preflightRealExecution() {
  assertNodeReplHost();
  assertAllowedTarget();
  await assertExactRealPath(LAB_BUILD_ROOT, "lab build root");
  await assertExactRealPath(LAB_APP_PATH, "lab application");
  await assertExactRealPath(
    path.join(LAB_APP_PATH, "Contents", "Info.plist"),
    "lab Info.plist"
  );
  const infoPlist = await readFile(
    path.join(LAB_APP_PATH, "Contents", "Info.plist"),
    "utf8"
  );
  const plistBundleId = extractXmlPlistString(
    infoPlist,
    "CFBundleIdentifier"
  );
  if (plistBundleId !== LAB_APP_BUNDLE_ID) {
    throw new Error(
      `Lab Info.plist bundle identifier mismatch: ${String(plistBundleId)}`
    );
  }

  await verifyPinnedWrapper();
  await readOracle();
}

export function assertNodeReplHost(runtime = globalThis.nodeRepl) {
  if (
    runtime == null ||
    typeof runtime.write !== "function" ||
    runtime.requestMeta == null ||
    typeof runtime.requestMeta !== "object"
  ) {
    throw new Error(
      "--execute must be imported and called from the Codex node_repl host"
    );
  }
}

export async function verifyPinnedWrapper() {
  const wrapperRealPath = await realpath(COMPUTER_USE_WRAPPER_PATH);
  if (wrapperRealPath !== COMPUTER_USE_WRAPPER_PATH) {
    throw new Error("Computer Use wrapper path is not the pinned real file");
  }
  const wrapperHash = sha256(await readFile(COMPUTER_USE_WRAPPER_PATH));
  if (wrapperHash !== COMPUTER_USE_WRAPPER_SHA256) {
    throw new Error(
      `Computer Use wrapper SHA-256 mismatch: expected ${COMPUTER_USE_WRAPPER_SHA256}, received ${wrapperHash}`
    );
  }
  return {
    path: COMPUTER_USE_WRAPPER_PATH,
    sha256: wrapperHash
  };
}

async function collectExecutionProvenance() {
  return {
    labAppExecutable: await executableProvenance(LAB_APP_EXECUTABLE_PATH),
    skyServiceExecutable: await executableProvenance(
      SKY_SERVICE_EXECUTABLE_PATH
    ),
    wrapper: {
      path: COMPUTER_USE_WRAPPER_PATH,
      sha256: sha256(await readFile(COMPUTER_USE_WRAPPER_PATH))
    }
  };
}

async function executableProvenance(executablePath) {
  const metadata = await stat(executablePath);
  if (!metadata.isFile()) {
    throw new Error(`Expected provenance executable: ${executablePath}`);
  }
  return {
    path: executablePath,
    bytes: metadata.size,
    modifiedUnixMilliseconds: Math.trunc(metadata.mtimeMs),
    sha256: sha256(await readFile(executablePath))
  };
}

async function loadRealSky() {
  const wrapperUrl = pathToFileURL(COMPUTER_USE_WRAPPER_PATH).href;
  const { setupComputerUseRuntime } = await import(wrapperUrl);
  return setupComputerUseRuntime({ globals: globalThis });
}

export async function readPersistentApprovalStoreMetadata() {
  try {
    const metadata = await lstat(PERSISTENT_APPROVAL_STORE_PATH);
    return {
      checked: true,
      present: true,
      type: metadata.isSymbolicLink()
        ? "symlink"
        : metadata.isFile()
          ? "file"
          : metadata.isDirectory()
            ? "directory"
            : "other",
      mode: (metadata.mode & 0o777).toString(8),
      bytes: metadata.size,
      modifiedUnixMilliseconds: Math.trunc(metadata.mtimeMs)
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

export function assertPersistentApprovalStoreAbsent(metadata, phase) {
  if (metadata?.checked !== true) {
    throw new Error(`Persistent approval store was not checked during ${phase}`);
  }
  if (metadata.present) {
    throw new Error(
      `Persistent Computer Use approval store appeared during ${phase}; stopping without deleting it`
    );
  }
}

async function auditedProductionCuaCall(audit, label, callback) {
  let result;
  let callError;
  try {
    result = await callback();
  } catch (error) {
    callError = error;
  }

  const metadata = await readPersistentApprovalStoreMetadata();
  audit.after = metadata;
  audit.checks.push({
    label,
    store: metadata
  });
  assertPersistentApprovalStoreAbsent(metadata, `postflight ${label}`);

  if (callError) {
    throw callError;
  }
  return result;
}

async function readOracle() {
  const oraclePath = LAB_STATE_PATH;
  assertAllowedTarget({ statePath: oraclePath });
  await assertExactRealPath(LAB_RUNTIME_ROOT, "lab runtime root");
  await assertExactRealPath(oraclePath, "lab state oracle");
  const metadata = await stat(oraclePath);
  if (!metadata.isFile() || metadata.size > MAX_ORACLE_BYTES) {
    throw new Error("Lab state oracle is not a bounded regular file");
  }
  const oracle = JSON.parse(await readFile(oraclePath, "utf8"));
  assertSyntheticOracleIdentity(oracle);
  return oracle;
}

export function assertSyntheticOracleIdentity(oracle) {
  if (
    oracle?.schemaVersion !== 1 ||
    oracle?.synthetic !== true ||
    oracle?.syntheticMarker !== LAB_SYNTHETIC_MARKER ||
    oracle?.bundleIdentifier !== LAB_APP_BUNDLE_ID ||
    oracle?.appPath !== LAB_APP_PATH
  ) {
    throw new Error("Lab state oracle synthetic identity or appPath check failed");
  }
}

function validateSyntheticAxText(text) {
  if (
    typeof text !== "string" ||
    (!text.includes(LAB_SYNTHETIC_MARKER) &&
      !text.includes(LAB_MODAL_MARKER) &&
      !text.includes(LAB_SECONDARY_WINDOW_MARKER))
  ) {
    throw new Error("Accessibility state is missing the synthetic lab marker");
  }

  const quotedLabels = Array.from(
    text.matchAll(/["']([^"'\r\n]+)["']/g),
    (match) => match[1]
  );
  const unexpected = quotedLabels.filter(
    (label) =>
      !STANDARD_AX_LABELS.has(label) &&
      !label.startsWith("CUA Lab") &&
      !/^-?\d+(?:\.\d+)?$/.test(label)
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Accessibility state contains unexpected non-synthetic labels: ${unexpected
        .slice(0, 3)
        .join(", ")}`
    );
  }
}

async function summarizeState(state, { copyScreenshots, context, label }) {
  return {
    app: assertStateTarget(state.app),
    accessibility: summarizeAxText(state.text),
    screenshot: await summarizeScreenshot(state.screenshot, {
      copyScreenshots,
      context,
      label
    })
  };
}

function summarizeAxText(text) {
  return {
    markerPresent:
      text.includes(LAB_SYNTHETIC_MARKER) ||
      text.includes(LAB_MODAL_MARKER) ||
      text.includes(LAB_SECONDARY_WINDOW_MARKER),
    characterCount: text.length,
    sha256: sha256(Buffer.from(text, "utf8"))
  };
}

async function summarizeScreenshot(
  screenshot,
  { copyScreenshots, context, label }
) {
  if (!screenshot) {
    return null;
  }
  const payload = await readScreenshotPayload(screenshot.url);
  const summary = {
    url: payload.sanitizedUrl,
    format: payload.format,
    mimeType: payload.mimeType,
    byteLength: payload.bytes.length,
    width: payload.width,
    height: payload.height,
    sha256: sha256(payload.bytes)
  };

  if (copyScreenshots) {
    const destination = assertFixtureOutputPath(
      path.join(
        LAB_FIXTURE_ROOT,
        context.runId,
        `${sanitizeFileComponent(label)}.${payload.extension}`
      )
    );
    await mkdir(path.dirname(destination), { recursive: true });
    if (payload.sourcePath) {
      await copyFile(payload.sourcePath, destination);
    } else {
      await writeFile(destination, payload.bytes);
    }
    const normalized = path.relative(LAB_FIXTURE_ROOT, destination);
    context.copiedScreenshots.push(normalized);
    summary.copiedTo = normalized;
  }
  return summary;
}

async function readScreenshotPayload(url) {
  if (typeof url !== "string") {
    throw new Error("Screenshot URL is missing");
  }
  if (url.startsWith("file://")) {
    const sourcePath = fileURLToPath(url);
    const bytes = await readFile(sourcePath);
    const image = detectScreenshotImage(bytes);
    return {
      bytes,
      sourcePath,
      sanitizedUrl: `file://<computer-use-screenshot>/${path.basename(sourcePath)}`,
      ...image
    };
  }
  const dataUrlMatch = url.match(
    /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/s
  );
  if (dataUrlMatch) {
    const declaredMimeType = dataUrlMatch[1];
    const bytes = Buffer.from(dataUrlMatch[2], "base64");
    const image = detectScreenshotImage(bytes);
    if (image.mimeType !== declaredMimeType) {
      throw new Error(
        `Computer Use screenshot MIME mismatch: declared=${declaredMimeType} detected=${image.mimeType}`
      );
    }
    return {
      bytes,
      sourcePath: null,
      sanitizedUrl: `data:${declaredMimeType};base64,<redacted>`,
      ...image
    };
  }
  throw new Error(
    "Only file URLs and PNG/JPEG/WebP data screenshot URLs are allowed"
  );
}

function assertFreshScreenshotContains(state, screenshotSummary, coordinate) {
  if (!state.screenshot?.url) {
    throw new Error("Coordinate action requires the immediately preceding screenshot");
  }
  if (
    !Number.isFinite(coordinate.x) ||
    !Number.isFinite(coordinate.y) ||
    coordinate.x < 0 ||
    coordinate.y < 0
  ) {
    throw new Error("Coordinate action requires finite non-negative coordinates");
  }
  if (
    !Number.isFinite(screenshotSummary?.width) ||
    !Number.isFinite(screenshotSummary?.height) ||
    coordinate.x >= screenshotSummary.width ||
    coordinate.y >= screenshotSummary.height
  ) {
    throw new Error("Coordinate action is outside the fresh screenshot bounds");
  }
}

function scaleOraclePointToScreenshot(point, oracle, screenshotSummary) {
  const windowWidth = valueAtPath(oracle, "window.width");
  const windowHeight = valueAtPath(oracle, "window.height");
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(windowWidth) ||
    !Number.isFinite(windowHeight) ||
    windowWidth <= 0 ||
    windowHeight <= 0 ||
    !Number.isFinite(screenshotSummary?.width) ||
    !Number.isFinite(screenshotSummary?.height)
  ) {
    throw new Error("Oracle coordinate scaling requires finite window and screenshot geometry");
  }
  return {
    x: Math.round((point.x * screenshotSummary.width) / windowWidth),
    y: Math.round((point.y * screenshotSummary.height) / windowHeight)
  };
}

export function evaluateOracleChecks(checks, before, after) {
  return checks.map((check) => {
    const beforeValue = valueAtPath(before, check.path);
    const afterValue = valueAtPath(after, check.path);
    let passed = false;
    if (check.operator === "equals") {
      passed = Object.is(afterValue, check.value);
    } else if (check.operator === "unchanged") {
      passed = deepEqual(beforeValue, afterValue);
    } else if (check.operator === "changed") {
      passed = !deepEqual(beforeValue, afterValue);
    } else if (check.operator === "greater-than-before") {
      passed =
        typeof beforeValue === "number" &&
        typeof afterValue === "number" &&
        afterValue > beforeValue;
    } else if (check.operator === "greater-than") {
      passed =
        typeof afterValue === "number" &&
        typeof check.value === "number" &&
        afterValue > check.value;
    } else if (check.operator === "not-equals-path") {
      passed = !deepEqual(
        afterValue,
        valueAtPath(after, check.otherPath)
      );
    } else if (check.operator === "not-less-than-before") {
      passed =
        typeof beforeValue === "number" &&
        typeof afterValue === "number" &&
        afterValue >= beforeValue;
    } else {
      throw new Error(`Unknown oracle operator: ${check.operator}`);
    }
    return {
      operator: check.operator,
      path: check.path,
      expected:
        check.operator === "equals"
          ? sanitizeResultValue(check.value)
          : check.operator === "greater-than"
            ? `greater-than ${String(check.value)}`
            : check.operator === "not-equals-path"
              ? `not-equals ${check.otherPath}`
          : check.operator,
      actual: sanitizeResultValue(afterValue),
      passed
    };
  });
}

function valueAtPath(value, dottedPath) {
  let current = value;
  for (const segment of dottedPath.split(".")) {
    if (
      current == null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function sanitizeActionInput(input) {
  const result = structuredClone(input);
  result.app = LAB_APP_BUNDLE_ID;
  return sanitizeResultValue(result);
}

function sanitizeResultValue(value) {
  if (typeof value === "string") {
    return redactSecrets(
      value
        .replaceAll(COMPUTER_USE_WRAPPER_PATH, "<computer-use-wrapper>")
        .replaceAll(SKY_SERVICE_EXECUTABLE_PATH, "<sky-service>")
        .replaceAll(LAB_APP_PATH, "<lab-app>")
        .replaceAll(LAB_STATE_PATH, "<lab-state>")
        .replaceAll(LAB_RUNTIME_ROOT, "<lab-runtime>")
        .replaceAll(LAB_BUILD_ROOT, "<lab-build>")
    );
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeResultValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sanitizeResultValue(child)
      ])
    );
  }
  return value ?? null;
}

function sanitizeError(error) {
  return {
    name: String(error?.name ?? "Error"),
    message: sanitizeResultValue(String(error?.message ?? error))
  };
}

async function writeJsonFixture(outputPath, value) {
  const absolute = assertFixtureOutputPath(outputPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(
    absolute,
    `${JSON.stringify(sanitizeResultValue(value), null, 2)}\n`,
    "utf8"
  );
}

function assertRunOptions(options) {
  if (
    options == null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new TypeError("Runner options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!ALLOWED_RUN_OPTION_KEYS.has(key)) {
      throw new Error(`Unknown or forbidden runner option: ${key}`);
    }
  }
  if (
    options.scenarioIds !== undefined &&
    !Array.isArray(options.scenarioIds)
  ) {
    throw new TypeError("scenarioIds must be an array");
  }
  if (options.copyScreenshots && !options.execute) {
    throw new Error("copyScreenshots requires execute");
  }
  if (options.outputPath) {
    options.outputPath = assertFixtureOutputPath(options.outputPath);
  }
}

async function assertExactRealPath(expectedPath, label) {
  const metadata = await lstat(expectedPath);
  if (metadata.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link`);
  }
  const resolved = await realpath(expectedPath);
  if (resolved !== expectedPath) {
    throw new Error(`${label} resolved outside its pinned path`);
  }
}

function extractXmlPlistString(text, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(
      `<key>\\s*${escapedKey}\\s*</key>\\s*<string>\\s*([^<]+?)\\s*</string>`
    )
  );
  return match?.[1] ?? null;
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function pngDimensions(bytes) {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  ) {
    return null;
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }
    if (marker === 0xda || offset + 1 >= bytes.length) {
      break;
    }
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3)
      };
    }
    offset += segmentLength;
  }
  throw new Error("Computer Use JPEG screenshot has no valid SOF dimensions");
}

function webpDimensions(bytes) {
  if (
    bytes.length < 30 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    };
  }
  return { width: null, height: null };
}

export function detectScreenshotImage(bytes) {
  const png = pngDimensions(bytes);
  if (png) {
    return {
      format: "png",
      mimeType: "image/png",
      extension: "png",
      ...png
    };
  }
  const jpeg = jpegDimensions(bytes);
  if (jpeg) {
    return {
      format: "jpeg",
      mimeType: "image/jpeg",
      extension: "jpeg",
      ...jpeg
    };
  }
  const webp = webpDimensions(bytes);
  if (webp) {
    return {
      format: "webp",
      mimeType: "image/webp",
      extension: "webp",
      ...webp
    };
  }
  throw new Error("Computer Use screenshot is not PNG, JPEG, or WebP");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safeRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeFileComponent(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function helpText() {
  return `Usage:
  node scripts/real-cua-lab-runner.mjs [--scenario <id>] [--out fixtures/real-cua/<file>.json]

Default mode is dry-run and sends no production CUA requests.
Real execution must be imported inside trusted node_repl and called with:
  runRealCuaLab({ execute: true, scenarioIds: ["button-click"] })

Flags:
  --execute            Request real execution; ordinary node processes are refused.
  --copy-screenshots   Copy screenshots below fixtures/real-cua; requires --execute.
  --scenario <id>      Select an allowlisted scenario; may be repeated.
  --out <path>         Write sanitized JSON below fixtures/real-cua.
  --help               Show this help.

Allowlisted scenarios:
  ${REAL_CUA_SCENARIO_IDS.join("\n  ")}

Real-execution scenarios:
  ${REAL_CUA_EXECUTABLE_SCENARIO_IDS.join("\n  ")}
`;
}

async function main() {
  const hostProcess = ordinaryNodeProcess();
  if (!hostProcess) {
    throw new Error("CLI entry point requires an ordinary Node process");
  }
  const options = parseCliArgs(hostProcess.argv.slice(2));
  if (options.help) {
    hostProcess.stdout.write(helpText());
    return;
  }
  const result = await runRealCuaLab(options);
  hostProcess.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function ordinaryNodeProcess() {
  try {
    const candidate = Reflect.get(globalThis, "process");
    if (
      candidate?.release?.name === "node" &&
      Array.isArray(candidate.argv) &&
      typeof candidate.stdout?.write === "function"
    ) {
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

const entryProcess = ordinaryNodeProcess();
if (
  entryProcess?.argv?.[1] &&
  import.meta.url === pathToFileURL(path.resolve(entryProcess.argv[1])).href
) {
  await main();
}

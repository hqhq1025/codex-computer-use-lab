import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  runNativeAppInstanceContractProbe
} from "../scripts/native-app-instance-contract-probe.mjs";

const checkedFixture = JSON.parse(
  await readFile(
    new URL("../fixtures/native/app-instance-isolation.json", import.meta.url),
    "utf8"
  )
);

test("live static probe reproduces the app-instance isolation fixture", async () => {
  const live = await runNativeAppInstanceContractProbe();
  assert.deepEqual(live, checkedFixture);
  assert.equal(
    live.service.sha256,
    "27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58"
  );
});

test("manager identity is target-scoped instead of transport-scoped", () => {
  assert.equal(
    checkedFixture.contracts.managerKey,
    "SystemSoftware.ApplicationTarget.identifier"
  );
  assert.equal(
    checkedFixture.contracts.managerStorage,
    "lock-protected Array<ComputerUseAppInstance>"
  );
  assert.equal(
    checkedFixture.contracts.managerLookup,
    "linear targetIdentifier search"
  );
  assert.equal(
    checkedFixture.contracts.managerInsert,
    "replace same targetIdentifier then append"
  );
  assert.deepEqual(checkedFixture.contracts.managerKeyInputsExcluded, [
    "pid",
    "socket",
    "node_repl_process",
    "thread",
    "conversation",
    "chatID"
  ]);
  assert.equal(
    checkedFixture.contracts.sameTargetSharesAppInstanceAcrossTransports,
    "strong-static-evidence"
  );
  assert.equal(
    checkedFixture.contracts.sameTargetSerialization,
    "per-AppInstance SerialExecutor tail"
  );
  assert.equal(
    checkedFixture.contracts.targetIdentifierCanonicalization,
    "resolvingSymlinksInPath.standardizedFileURL.path(percentEncoded:false).stripTrailingSlashExceptRoot"
  );
});

test("conversation cleanup deactivates shared state without removing it", () => {
  assert.equal(
    checkedFixture.contracts.conversationCleanupRemovesInstance,
    false
  );
  assert.equal(
    checkedFixture.contracts.conversationCleanupChecksOtherReferences,
    false
  );
  assert.deepEqual(checkedFixture.contracts.conversationCleanup, [
    "remove conversation tracker entry",
    "clear stopped-by-user state for each target",
    "deactivate the shared AppInstance asynchronously"
  ]);
});

test("lastAXTree and chatID boundaries remain explicit", () => {
  assert.equal(checkedFixture.contracts.chatIDParticipatesInManagerKey, false);
  assert.equal(
    checkedFixture.contracts.lastAXTreeOwner,
    "ComputerUseAppController"
  );
  assert.equal(checkedFixture.contracts.deactivateClearsLastAXTree, false);
  assert.equal(
    checkedFixture.contracts.crossConversationBaselineReuse,
    "strong-static-evidence"
  );
  assert.equal(checkedFixture.pendingDynamicExperiment.executed, false);
});

test("controller lifetime follows the live application process", () => {
  assert.equal(checkedFixture.contracts.liveProcessReusesExistingInstance, true);
  assert.equal(
    checkedFixture.contracts.liveProcessReusesExistingController,
    true
  );
  assert.equal(
    checkedFixture.contracts.appControllerReplacedWhileProcessAlive,
    false
  );
  assert.equal(
    checkedFixture.contracts.terminatedProcessRemovesOldInstance,
    true
  );
  assert.equal(
    checkedFixture.contracts.terminatedProcessCreatesNewControllerAndInstance,
    true
  );
  assert.equal(
    checkedFixture.contracts
      .terminatedProcessClearsLastAXTreeByControllerReplacement,
    true
  );
});

test("app-instance probe is static and read-only", () => {
  assert.deepEqual(checkedFixture.safety, {
    staticBinaryReadOnly: true,
    serviceStartedOrAttached: false,
    realComputerUseSocketContacted: false,
    uiActionsExecuted: false
  });
});

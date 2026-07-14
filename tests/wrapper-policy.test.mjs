import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  runMetadataLastWriterProbe,
  runPostApprovalValidationProbe,
  runPolicySnapshotProbe,
  runWrapperPolicyProbe
} from "../scripts/wrapper-policy-probe.mjs";

test("real wrapper binds approval to bundle id and execution to canonical path", async () => {
  const fixture = await runWrapperPolicyProbe();

  assert.equal(fixture.safety.realComputerUseSocketContacted, false);
  assert.equal(fixture.safety.uiActionsExecuted, false);
  assert.equal(fixture.approval.requests.length, 1);
  assert.equal(fixture.listApps.policyRequestCountBeforeClick, 0);
  assert.equal(fixture.listApps.approvalRequestCountBeforeClick, 0);
  assert.equal(
    fixture.approval.responseMetaAfterListApps[0]["codex/toolSurface"].app,
    null
  );
  assert.deepEqual(
    fixture.approval.requests[0].meta.persist,
    ["session", "always"]
  );
  assert.equal(
    fixture.approval.requests[0].meta.tool_params.app,
    "com.example.sky-wire-fixture"
  );
  assert.equal(
    fixture.approval.responseMeta[1]["codex/toolSurface"].app.appId,
    "com.example.sky-wire-fixture"
  );
  assert.equal(fixture.mutationTest.usesApprovedCanonicalAppPath, true);
  assert.equal(fixture.mutationTest.preservedPreAwaitSnapshot, true);
  assert.equal(fixture.mutationTest.getterRejected, true);
  assert.equal(fixture.approval.suspendedTimeoutCalls, 1);
});

test("policy snapshot freezes top-level data but retains mutable nested references", async () => {
  const fixture = await runPolicySnapshotProbe();

  assert.deepEqual(fixture.callbackObservation, {
    app: "/Applications/Sky Wire Fixture.app",
    topLevel: "before",
    nested: "after",
    topLevelFrozen: true,
    nestedSameReference: true,
    nestedFrozen: false
  });
  assert.equal(fixture.elicitations.length, 1);
});

test("denied policy sets Computer Use response metadata before failing without elicitation", async () => {
  const fixture = await runWrapperPolicyProbe({ policyDecision: "denied" });

  assert.equal(fixture.mode, "policy-rejection");
  assert.equal(fixture.approvalRequests.length, 0);
  assert.match(fixture.policyError.message, /organization's policy/);
  assert.equal(
    fixture.responseMetaAfterListApps[0]["codex/toolSurface"].app,
    null
  );
  assert.equal(
    fixture.responseMeta[1]["codex/toolSurface"].app.appId,
    "com.example.sky-wire-fixture"
  );
  assert.equal(
    fixture.exchanges.some(
      (exchange) =>
        exchange.request.params?.requestType ===
        "ComputerUseIPCAppPerformActionRequest"
    ),
    false
  );
});

test("non-app action fields can fail only after policy and approval complete", async () => {
  const fixture = await runPostApprovalValidationProbe();

  assert.equal(fixture.policyRequestCount, 1);
  assert.equal(fixture.elicitations.length, 1);
  assert.equal(fixture.responseMeta.length, 1);
  assert.match(fixture.validationError, /finite x and y coordinates/);
  assert.equal(fixture.actionRequestCount, 0);
});

test("one js result has last-writer-wins Computer Use app metadata", async () => {
  const fixture = await runMetadataLastWriterProbe();

  assert.deepEqual(fixture.actionWireApps, [
    "/Applications/com.example.first-app.app",
    "/Applications/com.example.second-app.app"
  ]);
  assert.equal(
    fixture.mergedMeta["codex/toolSurface"].app.appId,
    "com.example.second-app"
  );
});

test("checked wrapper fixture contains no real socket or user app", async () => {
  let fixture;
  try {
    fixture = JSON.parse(
      await readFile(
        new URL("../fixtures/wrapper-policy/captured.json", import.meta.url),
        "utf8"
      )
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  assert.equal(fixture.safety.realComputerUseSocketContacted, false);
  assert.equal(fixture.safety.uiActionsExecuted, false);
  assert.equal(
    JSON.stringify(fixture).includes(
      "Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService"
    ),
    false
  );
});

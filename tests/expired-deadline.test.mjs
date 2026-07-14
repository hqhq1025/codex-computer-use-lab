import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/real-cua/expired-deadline.json", import.meta.url),
    "utf8"
  )
);

test("native service rejects a request already expired at admission", () => {
  assert.equal(fixture.request.requestType, "ComputerUseIPCAppPolicyRequest");
  assert.equal(
    fixture.request.targetBundleIdentifier,
    "com.openai.codex.cualab"
  );
  assert.match(fixture.response.message, /deadline exceeded/i);
  assert.deepEqual(fixture.conclusion, {
    serverHasAdmissionDeadlineGate: true,
    expiredRequestReachedActionDispatch: false,
    acceptedWorkCancellationEstablished: false
  });
});

test("expired deadline probe stayed read-only and non-persistent", () => {
  assert.equal(fixture.safety.policyRequestOnly, true);
  assert.equal(fixture.safety.uiActionsExecuted, false);
  assert.equal(fixture.approvalStore.before.present, false);
  assert.equal(fixture.approvalStore.after.present, false);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("locked production observation is recorded as fail closed", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../fixtures/real-cua/locked-observation.json", import.meta.url),
      "utf8"
    )
  );

  assert.equal(fixture.result.status, "blocked");
  assert.equal(fixture.result.errorName, "screenLocked");
  assert.equal(fixture.result.knownProtocolCode, -10020);
  assert.equal(fixture.observedSafetyEffects.axStateReturned, false);
  assert.equal(fixture.observedSafetyEffects.screenshotReturned, false);
  assert.equal(fixture.observedSafetyEffects.uiActionExecuted, false);
  assert.equal(
    fixture.observedSafetyEffects.persistentApprovalStoreCreated,
    false
  );
  assert.equal(
    fixture.observedSafetyEffects.automaticUnlockAttemptedByLab,
    false
  );
});

test("locked V5 matrix attempt stops before every UI action", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../fixtures/real-cua/runner-final-semantic-matrix-v3-locked-attempt.json",
        import.meta.url
      ),
      "utf8"
    )
  );

  assert.equal(fixture.passed, false);
  assert.equal(fixture.safety.productionCuaRequestSent, true);
  assert.equal(fixture.safety.uiActionsExecuted, false);
  assert.equal(fixture.safety.persistentApprovalStoreBefore.present, false);
  assert.equal(fixture.safety.persistentApprovalStoreAfter.present, false);
  assert.deepEqual(
    fixture.safety.persistentApprovalChecks.map((entry) => entry.label),
    ["list_apps"]
  );
  assert.match(fixture.error.message, /Mac is locked/);
  assert.equal(fixture.completedScenarios.length, 0);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("unlocked production observation returned synthetic AX and screenshot metadata", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../fixtures/real-cua/unlocked-observation.json", import.meta.url),
      "utf8"
    )
  );

  assert.equal(fixture.result.status, "completed");
  assert.equal(fixture.result.markerPresent, true);
  assert.equal(fixture.result.primaryButtonMatchCount, 1);
  assert.ok(fixture.result.accessibilityCharacterCount > 0);
  assert.ok(fixture.result.screenshot.byteLength > 0);
  assert.equal(fixture.observedSafetyEffects.uiActionExecuted, false);
  assert.equal(
    fixture.observedSafetyEffects.persistentApprovalStoreCreated,
    false
  );
});

test("unlocked element-index click changed oracle even though AX text stayed stable", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../fixtures/real-cua/unlocked-button-click.json", import.meta.url),
      "utf8"
    )
  );

  assert.equal(fixture.result.status, "completed");
  assert.equal(fixture.target.elementIndex, 5);
  assert.equal(fixture.oracle.before.buttonClickCount, 0);
  assert.equal(fixture.oracle.after.buttonClickCount, 1);
  assert.equal(fixture.oracle.passed, true);
  assert.equal(fixture.observedProperties.oracleEffectObserved, true);
  assert.equal(fixture.observedProperties.accessibilityTextChanged, false);
  assert.equal(fixture.observedProperties.coordinateUsed, false);
  assert.equal(
    fixture.observedProperties.persistentApprovalStoreCreated,
    false
  );
});

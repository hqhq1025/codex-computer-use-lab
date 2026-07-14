import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  runNativeOopTargetingProbe
} from "../scripts/native-oop-targeting-probe.mjs";

const nativeFixture = JSON.parse(
  await readFile(
    new URL("../fixtures/native/oop-targeting.json", import.meta.url),
    "utf8"
  )
);
const productionFixture = JSON.parse(
  await readFile(
    new URL(
      "../fixtures/real-cua/runner-oop-webcontent-coordinate-click.json",
      import.meta.url
    ),
    "utf8"
  )
);

test("live static OOP targeting probe reproduces the checked fixture", async () => {
  assert.deepEqual(await runNativeOopTargetingProbe(), nativeFixture);
  assert.equal(
    nativeFixture.service.sha256,
    "27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58"
  );
});

test("production coordinate click reaches distinct WebContent-backed state", () => {
  const scenario = productionFixture.scenarios[0];
  const step = scenario.steps.find(
    (entry) => entry.id === "oop-webcontent-coordinate-click"
  );
  assert.equal(scenario.passed, true);
  assert.equal(step.action.method, "click");
  assert.equal(step.action.input.element_index, undefined);
  assert.ok(step.action.input.x >= 0);
  assert.ok(step.action.input.x < step.observations.before.screenshot.width);
  assert.ok(step.action.input.y >= 0);
  assert.ok(step.action.input.y < step.observations.before.screenshot.height);
  assert.equal(
    step.oracle.find((check) => check.path === "oop.clickCount").actual,
    1
  );
  assert.equal(
    step.oracle.find((check) => check.path === "oop.lastEventTrusted").actual,
    true
  );
  assert.equal(
    step.preconditions.find((check) => check.path === "oop.webContentPID")
      .passed,
    true
  );
  assert.equal(
    step.preconditions.find(
      (check) => check.operator === "not-equals-path"
    ).passed,
    true
  );
});

test("OOP production fixture remained synthetic and non-persistent", () => {
  assert.equal(productionFixture.safety.persistentApprovalStoreBefore.present, false);
  assert.equal(productionFixture.safety.persistentApprovalStoreAfter.present, false);
  assert.equal(
    productionFixture.safety.persistentApprovalChecks.every(
      (check) => check.store.checked && check.store.present === false
    ),
    true
  );
  assert.equal(productionFixture.safety.externalCommunicationAllowed, false);
  assert.equal(productionFixture.safety.systemSettingsAllowed, false);
  assert.equal(productionFixture.safety.screenshotsCopied, false);
});

test("read-only debugger denial did not weaken host security settings", () => {
  assert.equal(nativeFixture.debuggerAttach.attemptedReadOnly, true);
  assert.equal(nativeFixture.debuggerAttach.allowed, false);
  assert.equal(nativeFixture.safety.serviceMemoryModified, false);
  assert.equal(nativeFixture.safety.systemSecuritySettingsModified, false);
});

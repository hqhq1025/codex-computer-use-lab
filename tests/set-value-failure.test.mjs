import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("initial set_value failure is attributed to the synthetic AppKit setter", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../fixtures/real-cua/set-value-initial-failure.json", import.meta.url),
      "utf8"
    )
  );
  assert.equal(fixture.productionCall.requestSent, true);
  assert.equal(fixture.productionCall.actionReturnedError, false);
  assert.equal(fixture.oracle.passed, false);
  assert.equal(fixture.oracle.lastAction, "set-value");
  assert.match(fixture.rootCause, /synthetic AppKit test control/);
});

test("initial checkbox failure is attributed to genericized synthetic AX role", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../fixtures/real-cua/checkbox-initial-failure.json", import.meta.url),
      "utf8"
    )
  );
  assert.equal(fixture.productionCall.actionReturnedError, false);
  assert.equal(fixture.accessibilityBefore.role, "unknown");
  assert.equal(fixture.oracle.passed, false);
  assert.match(fixture.rootCause, /forced NSControl/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/real-cua/timeout-late-action.json", import.meta.url),
    "utf8"
  )
);

test("real Mac client timeout does not cancel the native action", () => {
  assert.equal(fixture.timeout.configuredSeconds, 0.001);
  assert.equal(fixture.timeout.call.ok, false);
  assert.match(fixture.timeout.call.message, /request timed out/);
  assert.equal(fixture.conclusion.clientTimeoutCanceledNativeAction, false);
  assert.equal(fixture.conclusion.clientRejectedBeforeSideEffect, true);
  assert.equal(fixture.conclusion.lateNativeSideEffectObserved, true);
  assert.ok(
    fixture.timeout.sideEffectObservedAfterMilliseconds >
      fixture.timeout.call.elapsedMilliseconds
  );
  assert.ok(fixture.timeout.delayAfterClientRejectionMilliseconds > 0);
});

test("late action changed only the declared synthetic oracle", () => {
  assert.equal(fixture.oracle.beforeButtonClickCount, 0);
  assert.equal(fixture.oracle.afterButtonClickCount, 1);
  assert.equal(fixture.oracle.firstChanged.lastAction, "button-click");
  assert.equal(fixture.target.bundleIdentifier, "com.openai.codex.cualab");
  assert.equal(fixture.safety.exactlyOneTimedOutUiAction, true);
});

test("timeout experiment remained non-persistent and provenance-pinned", () => {
  for (const store of [
    fixture.approvalStore.before,
    fixture.approvalStore.afterTimeout,
    fixture.approvalStore.final,
    ...fixture.approvalStore.checks.map((entry) => entry.store)
  ]) {
    assert.equal(store.checked, true);
    assert.equal(store.present, false);
  }
  assert.equal(
    fixture.provenance.skyServiceExecutable.sha256,
    "27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58"
  );
  assert.equal(
    fixture.provenance.wrapper.sha256,
    "6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f"
  );
  assert.match(fixture.provenance.trustedHelper.sha256, /^[a-f0-9]{64}$/);
});

test("current timeout harness exposes only one fixed synthetic click", async () => {
  const source = await readFile(
    new URL("../scripts/real-cua-timeout-late-action.mjs", import.meta.url),
    "utf8"
  );
  assert.match(source, /export async function timedSyntheticClick\(elementIndex\)/);
  assert.doesNotMatch(source, /export async function createTimeoutClient/);
  assert.match(
    source,
    /ca40f65f155435db1599c19babf617c6a04af3c5fab5390b33b9610f2696ddc7/
  );
  assert.match(
    source,
    /3b294dcb269ad65166b184bcca48c7bab0698162ca7a4fc8c7b4978990b82bf2/
  );
  assert.match(source, /await rm\(HELPER_PATH, \{ force: true \}\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  runNativeLastWindowProbe
} from "../scripts/native-last-window-probe.mjs";

const checkedFixture = JSON.parse(
  await readFile(
    new URL("../fixtures/native/last-window.json", import.meta.url),
    "utf8"
  )
);
const liveFixture = await runNativeLastWindowProbe();

test("checked lastWindow fixture matches the installed service", () => {
  assert.deepEqual(liveFixture, checkedFixture);
  assert.equal(
    liveFixture.artifact.sha256,
    "27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58"
  );
});

test("lastWindow has exactly two business writes and one compiler thunk write", () => {
  assert.deepEqual(liveFixture.directCalls.assignmentHelper, [
    "0x100070b68",
    "0x10007130c",
    "0x100088d34"
  ]);
  assert.deepEqual(liveFixture.directCalls.businessAssignmentSites, [
    "0x100070b68",
    "0x10007130c"
  ]);
  assert.deepEqual(liveFixture.directCalls.compilerSetterThunkSites, [
    "0x100088d34"
  ]);
});

test("PiP reads the getter while coordinate click reads the historical lock directly", () => {
  assert.deepEqual(liveFixture.directCalls.getter, [
    "0x100026f10",
    "0x100027360"
  ]);
  assert.match(
    liveFixture.coordinateClickRawRead.instruction,
    /ldr x20, \[x20, #0x18\]/
  );
});

test("orderedWindows deliberately has no lastWindow fallback", () => {
  assert.equal(
    liveFixture.orderedWindows.directlyCallsLastWindowGetter,
    false
  );
  assert.equal(
    liveFixture.orderedWindows.directlyCallsLastWindowAssignment,
    false
  );
  assert.deepEqual(
    liveFixture.orderedWindows.cgWindowListCreateCall.arguments,
    {
      option: "0x11",
      relativeToWindow: 0
    }
  );
  assert.match(
    liveFixture.orderedWindows.cgWindowListCreateCall.instruction,
    /bl 0x100cd2b6c/
  );
});

test("lastWindow probe is static and read-only", () => {
  assert.deepEqual(liveFixture.safety, {
    processStarted: false,
    processAttached: false,
    uiActionsExecuted: false
  });
});

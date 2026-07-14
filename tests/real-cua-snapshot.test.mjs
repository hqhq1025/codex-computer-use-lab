import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  collectRealCuaSnapshot
} from "../scripts/real-cua-snapshot.mjs";

test("real CUA snapshot is read-only and synthetic-target scoped", async () => {
  const snapshot = await collectRealCuaSnapshot("test");

  assert.equal(snapshot.safety.readOnly, true);
  assert.equal(snapshot.safety.screenshotsRead, false);
  assert.equal(snapshot.safety.axContentRead, false);
  assert.equal(snapshot.safety.approvalContentsRead, false);
  assert.equal(snapshot.safety.realCuaRequestSent, false);
  assert.equal(snapshot.safety.realInputSynthesized, false);
  assert.equal(
    snapshot.expectedTarget.bundleIdentifier,
    "com.openai.codex.cualab"
  );
  assert.equal(Array.isArray(snapshot.displays), true);
  assert.ok(snapshot.displays.length >= 1);
  assert.ok(snapshot.processes.sky.some((process) => Number.isInteger(process.pid)));
  assert.equal(
    snapshot.processes.testApp.every((process) =>
      process.command.includes(
        "test-app/build/Codex CUA Lab.app/Contents/MacOS/Codex CUA Lab"
      )
    ),
    true
  );
});

test("snapshot source does not connect to the production CUA socket", async () => {
  const source = await readFile(
    new URL("../scripts/real-cua-snapshot.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /createConnection\s*\(/);
  assert.doesNotMatch(source, /connect\s*\([^\n]*computeruse\.sock/);
  assert.doesNotMatch(source, /readFile\s*\(\s*APPROVAL_STORE/);
  assert.match(source, /command === expectedExecutable/);
});

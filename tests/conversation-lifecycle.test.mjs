import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(
  new URL("../scripts/real-cua-conversation-lifecycle.mjs", import.meta.url),
  "utf8"
);
const chapter = await readFile(
  new URL(
    "../docs/25-timeout-deadline-url-policy-and-lifecycle.md",
    import.meta.url
  ),
  "utf8"
);

test("conversation lifecycle experiment requires a service-side effect", () => {
  assert.match(
    script,
    /No service-side turn-ended lifecycle effect observed after helper dispatch/
  );
  assert.match(script, /lockScreenTurnEndObserved/);
  assert.match(script, /Received lock-screen turn end/);
  assert.match(script, /removedActiveThread=true/);
  assert.match(script, /deactivateFailureObserved/);
  assert.match(script, /clientBAfterAEnded/);
  assert.match(script, /noChangeDiffProvesReactivate: false/);
  assert.doesNotMatch(script, /Codex thread ended or stopped/);
});

test("inconclusive lifecycle attempt persists no false fixture", async () => {
  await assert.rejects(
    access(
      new URL("../fixtures/real-cua/conversation-lifecycle.json", import.meta.url)
    ),
    (error) => error?.code === "ENOENT"
  );
  assert.match(chapter, /failed closed and wrote\s+no fixture/);
  assert.match(chapter, /app-target deactivate.*not dynamically confirmed/is);
});

test("conversation helper is temporary and observations-only", () => {
  assert.match(script, /await rm\(HELPER_PATH, \{ force: true \}\)/);
  assert.match(script, /observationsOnly: true/);
  assert.match(script, /uiActionsExecuted: false/);
  assert.doesNotMatch(script, /\.click\(|\.typeText\(|\.pressKey\(|\.scroll\(/);
});

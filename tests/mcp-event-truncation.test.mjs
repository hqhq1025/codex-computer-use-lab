import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EVENT_RESULT_CAP_BYTES,
  runMcpEventTruncationProbe
} from "../scripts/mcp-event-truncation-probe.mjs";

const checkedFixture = JSON.parse(
  await readFile(
    new URL("../fixtures/electron/mcp-event-truncation.json", import.meta.url),
    "utf8"
  )
);
const liveFixture = await runMcpEventTruncationProbe();

test("checked MCP event truncation fixture matches current Codex source", () => {
  assert.deepEqual(liveFixture, checkedFixture);
  assert.equal(liveFixture.source.defaultCapMarkerPresent, true);
  assert.equal(liveFixture.source.eventUsesDefaultCap, true);
  assert.equal(liveFixture.source.oversizedClearsMeta, true);
});

test("exactly one MiB preserves Computer Use metadata", () => {
  const value = liveFixture.cases.find((entry) => entry.id === "cap");
  assert.equal(value.serializedBytes, EVENT_RESULT_CAP_BYTES);
  assert.equal(value.eventMetaPresent, true);
  assert.deepEqual(value.desktopSource, {
    kind: "computerUse",
    app: {
      kind: "appId",
      appId: "com.openai.codex.cualab"
    }
  });
  assert.equal(value.nonNodeReplSource, null);
});

test("one MiB plus one byte clears metadata and loses Desktop Computer Use identity", () => {
  const value = liveFixture.cases.find(
    (entry) => entry.id === "cap-plus-one"
  );
  assert.equal(value.serializedBytes, EVENT_RESULT_CAP_BYTES + 1);
  assert.equal(value.eventMetaPresent, false);
  assert.equal(value.eventStructuredContent, null);
  assert.equal(value.desktopSource, null);
});

test("model wire prefers structured content and excludes top-level metadata", () => {
  assert.deepEqual(liveFixture.modelContract.structured, {
    bodyType: "text",
    body: "{\"answer\":42}",
    success: true
  });
  assert.equal(
    liveFixture.modelContract.structured.body.includes("ignored text"),
    false
  );
  assert.equal(liveFixture.modelContract.topLevelMetaIncludedInBody, false);
  assert.equal(liveFixture.modelContract.topLevelIsErrorIncludedInBody, false);
  assert.equal(liveFixture.source.structuredContentPrecedesContent, true);
});

test("image-capable and text-only models receive different MCP content bodies", () => {
  assert.equal(liveFixture.modelContract.imageCapable.bodyType, "contentItems");
  assert.equal(liveFixture.modelContract.textOnlyModel.bodyType, "text");
  assert.match(
    liveFixture.modelContract.textOnlyModel.body,
    /image content omitted/
  );
  assert.equal(liveFixture.modelContract.textOnlyModel.success, false);
});

test("remote thread resume redacts MCP data and removes image generation items", () => {
  assert.equal(liveFixture.source.remoteResumeClearsMeta, true);
  assert.equal(liveFixture.source.remoteResumeRemovesImageGeneration, true);
  assert.equal(liveFixture.remoteResumeContract.meta, null);
  assert.equal(
    liveFixture.remoteResumeContract.imageGenerationItemRetained,
    false
  );
});

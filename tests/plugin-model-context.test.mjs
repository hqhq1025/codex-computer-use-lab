import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  runPluginModelContextProbe
} from "../scripts/plugin-model-context-probe.mjs";

const checkedFixture = JSON.parse(
  await readFile(
    new URL(
      "../fixtures/model-tool-surface/plugin-model-context.json",
      import.meta.url
    ),
    "utf8"
  )
);

test("live plugin-to-model probe reproduces the checked fixture", async () => {
  const live = await runPluginModelContextProbe();
  assert.deepEqual(live, checkedFixture);
  assert.equal(
    live.artifacts.desktop.asar.sha256,
    "d28f31b4bbb04c519be65c2af8277d8c5faf77b4239ee89b928f0a7423dacd84"
  );
  assert.equal(
    live.artifacts.codex.sha256,
    "28699add67540b93390329a740649a9eb9bdbc5538d92c1679c8c6b6fa2c623c"
  );
  assert.equal(
    live.artifacts.nodeRepl.sha256,
    "3eec7a8ae812c1c0230474d44700e57725dc347116116c4e6aa67c79418d730f"
  );
});

test("skill catalog, explicit injection, and MCP instructions are separate prompt surfaces", () => {
  assert.equal(
    checkedFixture.promptSurfaces.initialSkillsCatalog.fullSkillBodyIncluded,
    false
  );
  assert.deepEqual(
    checkedFixture.promptSurfaces.initialSkillsCatalog.fields,
    ["name", "description", "path"]
  );
  assert.equal(
    checkedFixture.promptSurfaces.explicitSkillMention.fullSkillBodyIncluded,
    true
  );
  assert.equal(
    checkedFixture.promptSurfaces.explicitSkillMention.role,
    "user"
  );
  assert.equal(
    checkedFixture.promptSurfaces.nodeReplInitialize.containsUseCases
      .computerUse,
    true
  );
  assert.equal(
    checkedFixture.promptSurfaces.toolSearchNamespace
      .descriptionComesFromMcpInitializeInstructions,
    true
  );
});

test("Responses uses deferred node_repl instead of a native computer tool", () => {
  assert.equal(checkedFixture.responses.hasToolSearch, true);
  assert.equal(checkedFixture.responses.hasNativeComputerTool, false);
  assert.equal(checkedFixture.responses.hasTopLevelNodeRepl, false);
  assert.deepEqual(checkedFixture.responses.deferredCallShape, {
    namespace: "mcp__node_repl",
    name: "js"
  });
  assert.equal(
    checkedFixture.execution.computerUseFacadeIsMcpToolSet,
    false
  );
});

test("model and Desktop receive different projections of one MCP result", () => {
  assert.equal(checkedFixture.resultFlows.model.includesMeta, false);
  assert.equal(
    checkedFixture.resultFlows.desktop.lateBindingKey,
    "codex/toolSurface"
  );
  assert.equal(
    checkedFixture.resultFlows.desktop.includesMetaBelowSerializedBytes,
    1_048_576
  );
  assert.equal(
    checkedFixture.resultFlows.desktop.metaClearedAboveSerializedBytes,
    1_048_576
  );
});

test("plugin-to-model probe is content-minimizing and read-only", () => {
  assert.deepEqual(checkedFixture.safety, {
    promptBodiesCollected: false,
    toolArgumentsCollected: false,
    screenshotsCollected: false,
    realComputerUseSocketContacted: false,
    uiActionsExecuted: false
  });
});

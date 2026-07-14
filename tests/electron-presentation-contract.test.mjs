import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  runElectronPresentationContractProbe
} from "../scripts/electron-presentation-contract-probe.mjs";

const checkedFixture = JSON.parse(
  await readFile(
    new URL(
      "../fixtures/electron/presentation-contract.json",
      import.meta.url
    ),
    "utf8"
  )
);
const liveFixture = await runElectronPresentationContractProbe();

test("checked presentation fixture matches the installed Electron and Codex source", () => {
  assert.deepEqual(liveFixture, checkedFixture);
  assert.equal(liveFixture.source.contracts.formatterReachable, true);
  assert.equal(liveFixture.source.contracts.nodeReplTitleShortCircuits, true);
  assert.equal(liveFixture.source.contracts.nodeReplCodeNotParsed, true);
});

test("node_repl action text is declarative title metadata, not parsed JavaScript", () => {
  const { titleCases } = liveFixture.behavior;

  assert.deepEqual(titleCases.declared, {
    label: "Clicking in Finder",
    source: "node-repl-title",
    resultTypeConsulted: false
  });
  assert.deepEqual(titleCases.codeOnly, {
    label: "Js",
    source: "generic-tool-name",
    resultTypeConsulted: false
  });
  assert.equal(titleCases.truncated.label.length, 80);
  assert.equal(titleCases.truncated.label.endsWith("…"), true);
});

test("Computer Use identity is attached at result time and changes grouping", () => {
  assert.deepEqual(liveFixture.behavior.resultTimeIdentity, {
    started: {
      source: null,
      grouping: "groupable"
    },
    completed: {
      source: {
        kind: "computerUse",
        app: {
          kind: "appId",
          appId: "com.openai.codex.cualab"
        }
      },
      grouping: "standalone"
    }
  });
  assert.equal(liveFixture.source.contracts.resultMetaRequiresNodeRepl, true);
  assert.equal(liveFixture.source.contracts.resultTimeStandalone, true);
});

test("direct Computer Use failure can retain a success-sounding completed label", () => {
  assert.deepEqual(liveFixture.behavior.failedDirectComputerUse, {
    resultType: "error",
    completed: true,
    label: "Clicked in Finder",
    formatterConsultedResultType: false
  });
  assert.equal(
    liveFixture.source.contracts.completedDoesNotMeanSucceeded,
    true
  );
  assert.equal(
    liveFixture.source.contracts
      .formatterReceivesResultButDirectFormatterIgnoresIt,
    true
  );
});

test("MCP progress has no current producer-to-renderer path", () => {
  assert.equal(liveFixture.source.contracts.rmcpOnlyLogsProgress, true);
  assert.equal(liveFixture.source.contracts.rendererIgnoresProgress, true);
  assert.equal(liveFixture.source.contracts.noMcpResultDelta, true);
  assert.equal(
    liveFixture.source.contracts.completedAtomicallyReplacesItem,
    true
  );
});

test("elicitation correlation key can suppress sibling direct calls but not node_repl", () => {
  assert.deepEqual(liveFixture.behavior.elicitationCorrelation, {
    suppressionKey: "computer-use",
    visibleCallIds: ["node-repl"],
    hiddenCallIds: ["direct-a", "direct-b"]
  });
  assert.equal(
    liveFixture.source.contracts.elicitationProtocolHasNoItemId,
    true
  );
  assert.equal(
    liveFixture.source.contracts.pendingSuppressionUsesConnectorOrServerKey,
    true
  );
});

test("presentation probe is read-only", () => {
  assert.deepEqual(liveFixture.safety, {
    realComputerUseSocketContacted: false,
    uiActionsExecuted: false,
    appStateMutated: false
  });
});

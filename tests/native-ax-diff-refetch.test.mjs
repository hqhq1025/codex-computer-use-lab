import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  appendRevisionElementIds,
  assignRootElementIds,
  chooseDiffPresentation,
  compressRemovedElementIds,
  diffRenderTrees,
  equivalentForRefetch,
  formatRemovedElementIds,
  resolveStaleRefetch,
  sortChanges
} from "../lib/native-ax-behavior-model.mjs";
import {
  runNativeAxContractProbe
} from "../scripts/native-ax-contract-probe.mjs";

const checkedFixture = JSON.parse(
  await readFile(
    new URL("../fixtures/native/ax-diff-refetch.json", import.meta.url),
    "utf8"
  )
);

function node(id, text = id, children = [], extra = {}) {
  return {
    id,
    text,
    children,
    ...extra
  };
}

test("live static probe reproduces the checked native AX contract", async () => {
  const live = await runNativeAxContractProbe();
  assert.deepEqual(live, checkedFixture);
  assert.equal(
    live.service.sha256,
    "27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58"
  );
  assert.deepEqual(live.safety, {
    staticBinaryReadOnly: true,
    serviceStartedOrAttached: false,
    realComputerUseSocketContacted: false,
    uiActionsExecuted: false
  });
});

test("root and appended revisions preserve stable IDs exactly as recovered", () => {
  const root = assignRootElementIds(
    node("R", "R", [
      node("A"),
      node("B", "B", [node("C")])
    ])
  );
  assert.deepEqual(
    [
      root.elementID,
      root.children[0].elementID,
      root.children[1].elementID,
      root.children[1].children[0].elementID
    ],
    [0, 1, 2, 3]
  );

  const appended = appendRevisionElementIds(
    assignRootElementIds(node("R", "R", [node("A"), node("B")])),
    node("R", "R", [node("X"), node("A"), node("B")])
  );
  assert.deepEqual(
    appended.tree.children.map((child) => [child.id, child.elementID]),
    [
      ["X", 3],
      ["A", 1],
      ["B", 2]
    ]
  );
});

test("render diff matches siblings by render id and compares only primary text", () => {
  const oldTree = assignRootElementIds(
    node("R", "root", [
      node("A", "same", [], { detailText: "old" }),
      node("B", "before")
    ])
  );
  const newTree = node("R", "root", [
    node("B", "after"),
    node("A", "same", [], { detailText: "new" })
  ]);
  const changes = diffRenderTrees(oldTree, newTree);

  assert.equal(
    changes.some((change) => change.kind === "insert"),
    false
  );
  assert.equal(
    changes.some((change) => change.kind === "remove"),
    false
  );
  assert.equal(
    changes.find((change) => change.node.id === "A").kind,
    "none"
  );
  assert.equal(
    changes.find((change) => change.node.id === "B").kind,
    "update"
  );
  assert.equal(newTree.children[0].elementID, 2);
  assert.equal(newTree.children[1].elementID, 1);
});

test("same-path change ordering and removed ranges match the binary contract", () => {
  assert.deepEqual(
    sortChanges([
      { kind: "update", path: [0] },
      { kind: "insert", path: [0] },
      { kind: "none", path: [0] },
      { kind: "remove", path: [0] },
      { kind: "insert", path: [1] },
      { kind: "insert", path: [0, 2] },
      { kind: "insert", path: [0, 1] }
    ]).map(({ kind, path }) => [path, kind]),
    [
      [[0], "none"],
      [[0], "remove"],
      [[0], "insert"],
      [[0], "update"],
      [[0, 1], "insert"],
      [[0, 2], "insert"],
      [[1], "insert"]
    ]
  );
  assert.deepEqual(compressRemovedElementIds([9, 7, 8, 14, 12, 13]), [
    { start: 7, end: 9 },
    { start: 12, end: 14 }
  ]);
  assert.equal(
    formatRemovedElementIds([9, 7, 8, 14, 12, 13]),
    "Removed element IDs: 7-9, 12-14"
  );
});

test("diff rendering uses full-tree line count as its only recovered budget", () => {
  assert.equal(
    chooseDiffPresentation({
      fullLineCount: 5,
      removedSummaryLineCount: 6,
      diffLineCount: 6,
      effectiveChangeCount: 1
    }),
    "full"
  );
  assert.equal(
    chooseDiffPresentation({
      fullLineCount: 5,
      removedSummaryLineCount: 2,
      diffLineCount: 6,
      effectiveChangeCount: 1
    }),
    "full"
  );
  assert.equal(
    chooseDiffPresentation({
      fullLineCount: 5,
      removedSummaryLineCount: 0,
      diffLineCount: 0,
      effectiveChangeCount: 0
    }),
    "no-change"
  );
  assert.equal(
    chooseDiffPresentation({
      fullLineCount: 1,
      removedSummaryLineCount: 9,
      diffLineCount: 9,
      effectiveChangeCount: 1,
      ignoreDifferenceLineBudget: true
    }),
    "diff"
  );
});

test("stale refetch is strict before capture and only value-relaxed after capture", () => {
  const original = {
    role: "button",
    identifier: "target",
    title: "Target",
    value: "old"
  };
  const exact = { ...original };
  const valueChanged = { ...original, value: "new" };

  assert.equal(equivalentForRefetch(original, valueChanged), false);
  assert.equal(
    equivalentForRefetch(original, valueChanged, {
      ignoreValueChange: true
    }),
    true
  );
  assert.equal(
    resolveStaleRefetch({
      original,
      oldCandidates: [exact],
      newCandidates: [exact]
    }),
    "success"
  );
  assert.equal(
    resolveStaleRefetch({
      original,
      oldCandidates: [exact, exact],
      newCandidates: [exact]
    }),
    "ambiguous-before"
  );
  assert.equal(
    resolveStaleRefetch({
      original,
      oldCandidates: [exact],
      newCandidates: []
    }),
    "no-longer-valid"
  );
  assert.equal(
    resolveStaleRefetch({
      original,
      oldCandidates: [exact],
      newCandidates: [exact, exact]
    }),
    "ambiguous-after"
  );
  assert.equal(
    resolveStaleRefetch({
      original,
      oldCandidates: [exact],
      newCandidates: [valueChanged],
      ignoreValueChange: true
    }),
    "success"
  );
});

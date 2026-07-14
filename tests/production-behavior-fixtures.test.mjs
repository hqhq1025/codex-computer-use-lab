import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function fixture(name) {
  return JSON.parse(
    await readFile(
      new URL(`../fixtures/real-cua/${name}`, import.meta.url),
      "utf8"
    )
  );
}

test("production AX diff can stay unchanged while the business oracle changes", async () => {
  const value = await fixture("ax-diff-behavior.json");
  assert.equal(value.afterRealButtonClick.diffExactlyEqualsNoChangeDiff, true);
  assert.equal(value.afterRealButtonClick.oracleBeforeCount, 0);
  assert.equal(value.afterRealButtonClick.oracleAfterCount, 1);
});

test("production screenshots are JPEG and persist until the target app stops", async () => {
  const value = await fixture("screenshot-lifecycle.json");
  assert.equal(value.format.extension, "jpeg");
  assert.equal(value.format.container, "JFIF");
  assert.equal(value.singleFileLifetime.at10Seconds.exists, true);
  assert.equal(value.successiveCapture.oldFileStillExists, true);
  assert.equal(value.afterTargetAppStopAnd10Seconds.oldFileExists, false);
  assert.equal(value.afterTargetAppStopAnd10Seconds.newFileExists, false);
  assert.equal(value.pixelsPersistedByLab, false);
});

test("final production semantic matrix is provenance-pinned and fully passing", async () => {
  const value = await fixture("runner-final-semantic-matrix-v4.json");
  assert.equal(value.mode, "execute");
  assert.match(value.provenance.labAppExecutable.sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    value.provenance.skyServiceExecutable.sha256,
    "27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58"
  );
  assert.equal(
    value.provenance.wrapper.sha256,
    "6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f"
  );
  assert.equal(value.safety.productionCuaRequestSent, true);
  assert.equal(value.safety.uiActionsExecuted, true);
  assert.equal(value.safety.persistentApprovalStoreBefore.present, false);
  assert.equal(value.safety.persistentApprovalStoreAfter.present, false);
  assert.equal(value.safety.persistentApprovalChecks.length, 192);
  assert.equal(value.scenarios.length, 21);
  assert.equal(
    value.scenarios.reduce((count, scenario) => count + scenario.steps.length, 0),
    66
  );
  assert.equal(value.scenarios.every((scenario) => scenario.passed), true);

  const expectedFailures = new Map([
    ["stale-element-missing/click-missing-stale-target", /no longer valid/],
    [
      "stale-element-ambiguous/click-ambiguous-stale-target",
      /multiple elements/
    ]
  ]);

  for (const scenario of value.scenarios) {
    const reset = scenario.steps[0];
    assert.equal(reset.id, "reset");
    assert.equal(reset.action.postActionSettleMilliseconds, 1300);

    for (const step of scenario.steps) {
      assert.equal(
        (step.preconditions ?? []).every((check) => check.passed),
        true
      );
      assert.equal(step.oracle.every((check) => check.passed), true);
      assert.ok([0, 1300].includes(step.action.postActionSettleMilliseconds));
      const expectedFailure = expectedFailures.get(`${scenario.id}/${step.id}`);
      if (expectedFailure) {
        assert.equal(step.action.executed, false);
        assert.match(step.action.error.message, /-10005/);
        assert.match(step.action.error.message, expectedFailure);
      } else {
        assert.equal(step.action.executed, true);
        assert.equal(step.action.error, null);
      }
    }
  }

  assert.equal(
    value.safety.persistentApprovalChecks.every(
      (check) => check.store.checked === true && check.store.present === false
    ),
    true
  );
});

test("unified matrix includes a trusted coordinate click in distinct WebContent", async () => {
  const value = await fixture("runner-final-semantic-matrix-v4.json");
  const scenario = value.scenarios.find(
    (entry) => entry.id === "oop-webcontent-coordinate-click"
  );
  const step = scenario.steps.find(
    (entry) => entry.id === "oop-webcontent-coordinate-click"
  );

  assert.equal(scenario.passed, true);
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
    step.preconditions.find(
      (check) => check.operator === "not-equals-path"
    ).passed,
    true
  );
});

test("production AX diff contains a changed synthetic element", async () => {
  const value = await fixture("runner-final-semantic-matrix-v4.json");
  const diffScenario = value.scenarios.find((scenario) => scenario.id === "diff");
  const diffStep = diffScenario.steps.find((step) => step.id === "diff-probe");
  assert.ok(diffStep.observations.diff.characterCount > 0);
  assert.match(
    diffStep.observations.diff.syntheticText,
    /^The following is a diff from the previous accessibility tree/
  );
  assert.match(diffStep.observations.diff.syntheticText, /~\s+\d+ text/);
  assert.match(
    diffStep.observations.diff.syntheticText,
    /ID: cua\.lab\.diff-status/
  );
});

test("stale index refetches the replacement and never clicks the inserted decoy", async () => {
  const value = await fixture("runner-final-semantic-matrix-v4.json");
  const scenario = value.scenarios.find(
    (entry) => entry.id === "dynamic-hierarchy-stale-element"
  );
  const stale = scenario.steps.find((step) => step.id === "stale-click");
  const fresh = scenario.steps.find(
    (step) => step.id === "fresh-click-after-stale"
  );
  assert.notEqual(
    stale.action.input.element_index,
    fresh.action.input.element_index
  );
  assert.equal(
    stale.oracle.find(
      (check) => check.path === "hierarchy.wrongTargetClickCount"
    ).actual,
    0
  );
  assert.equal(
    stale.oracle.find(
      (check) => check.path === "hierarchy.staleTargetClickCount"
    ).actual,
    1
  );
});

test("scroll, modal, and same-name targeting complete against the synthetic app", async () => {
  const value = await fixture("runner-final-semantic-matrix-v4.json");
  const byId = new Map(value.scenarios.map((scenario) => [scenario.id, scenario]));

  const scroll = byId.get("scroll").steps.find((step) => step.id === "scroll");
  assert.equal(scroll.action.method, "scroll");
  assert.equal(
    scroll.oracle.find((check) => check.path === "controls.scrollOffset").actual,
    100
  );

  const modal = byId.get("modal");
  assert.equal(
    modal.steps.find((step) => step.id === "open-modal").oracle[0].actual,
    true
  );
  assert.equal(
    modal.steps.find((step) => step.id === "close-modal").oracle[0].actual,
    false
  );

  const ambiguous = byId
    .get("ambiguous-same-name")
    .steps.find((step) => step.id === "ambiguous-second");
  assert.equal(
    ambiguous.oracle.find((check) => check.path === "ambiguous.lastTarget").actual,
    "second"
  );
});

test("keyboard, coordinate, and drag inputs complete with bounded synthetic targets", async () => {
  const value = await fixture("runner-final-semantic-matrix-v4.json");
  const byId = new Map(value.scenarios.map((scenario) => [scenario.id, scenario]));

  const key = byId.get("press-key").steps.find((step) => step.id === "press-tab");
  assert.equal(key.action.input.key, "Tab");
  assert.equal(
    key.oracle.find((check) => check.path === "focus.control").actual,
    "type-text"
  );

  const coordinate = byId
    .get("coordinate-click")
    .steps.find((step) => step.id === "coordinate-click");
  assert.ok(coordinate.action.input.x >= 0);
  assert.ok(coordinate.action.input.y >= 0);
  assert.ok(
    coordinate.action.input.x < coordinate.observations.before.screenshot.width
  );
  assert.ok(
    coordinate.action.input.y < coordinate.observations.before.screenshot.height
  );

  const drag = byId.get("drag-target").steps.find((step) => step.id === "drag-target");
  const dragScreenshot = drag.observations.before.screenshot;
  for (const coordinateName of ["from_x", "to_x"]) {
    assert.ok(drag.action.input[coordinateName] >= 0);
    assert.ok(drag.action.input[coordinateName] < dragScreenshot.width);
  }
  for (const coordinateName of ["from_y", "to_y"]) {
    assert.ok(drag.action.input[coordinateName] >= 0);
    assert.ok(drag.action.input[coordinateName] < dragScreenshot.height);
  }
  assert.equal(drag.oracle[0].operator, "changed");
  assert.equal(drag.oracle[0].passed, true);
});

test("multi-window state follows the focused window and preserves per-window actions", async () => {
  const value = await fixture("runner-final-semantic-matrix-v4.json");
  const scenario = value.scenarios.find((entry) => entry.id === "multi-window");
  assert.equal(scenario.id, "multi-window");
  assert.equal(scenario.passed, true);

  const open = scenario.steps.find((step) => step.id === "open-secondary-window");
  const mainWindowSize = {
    width: open.observations.before.screenshot.width,
    height: open.observations.before.screenshot.height
  };
  const secondaryWindowSize = {
    width: open.observations.after.screenshot.width,
    height: open.observations.after.screenshot.height
  };
  assert.notDeepEqual(secondaryWindowSize, mainWindowSize);

  const click = scenario.steps.find((step) => step.id === "secondary-button-click");
  assert.equal(click.action.input.element_index, 2);
  assert.equal(
    click.oracle.find(
      (check) => check.path === "secondaryWindow.buttonClickCount"
    ).actual,
    1
  );

  const scroll = scenario.steps.find((step) => step.id === "secondary-scroll");
  assert.equal(scroll.action.input.element_index, 3);
  assert.equal(
    scroll.oracle.find((check) => check.path === "secondaryWindow.scrollOffset")
      .actual,
    150
  );

  const close = scenario.steps.find((step) => step.id === "close-secondary-window");
  assert.deepEqual(
    {
      width: close.observations.after.screenshot.width,
      height: close.observations.after.screenshot.height
    },
    mainWindowSize
  );
});

test("cross-display window movement uses fresh scaled coordinates and returns to primary", async () => {
  const value = await fixture("runner-final-semantic-matrix-v4.json");
  const scenario = value.scenarios.find((entry) => entry.id === "window-move");
  const left = scenario.steps.filter((step) => step.id.startsWith("move-left"));
  const right = scenario.steps.filter((step) => step.id.startsWith("move-right"));

  assert.equal(left.length, 6);
  assert.equal(right.length, 6);
  assert.ok(
    left.some(
      (step) =>
        step.oracle.find((check) => check.path === "window.x").actual < 0
    )
  );
  assert.equal(
    left.at(-1).oracle.find(
      (check) => check.path === "window.onSecondaryScreen"
    ).actual,
    true
  );
  assert.equal(
    right.at(-1).oracle.find(
      (check) => check.path === "window.onSecondaryScreen"
    ).actual,
    false
  );

  for (const step of [...left, ...right]) {
    const screenshot = step.observations.before.screenshot;
    assert.ok(step.action.input.from_x >= 0);
    assert.ok(step.action.input.from_x < screenshot.width);
    assert.ok(step.action.input.to_x >= 0);
    assert.ok(step.action.input.to_x < screenshot.width);
    assert.ok(step.action.input.from_y >= 0);
    assert.ok(step.action.input.from_y < screenshot.height);
    assert.ok(step.action.input.to_y >= 0);
    assert.ok(step.action.input.to_y < screenshot.height);
  }
});

test("stale element negative cases fail closed with no target or decoy mutation", async () => {
  const value = await fixture("runner-final-semantic-matrix-v4.json");
  const missingAction = value.scenarios
    .find((entry) => entry.id === "stale-element-missing")
    .steps.at(-1);
  assert.equal(missingAction.action.executed, false);
  assert.match(missingAction.action.error.message, /-10005/);
  assert.match(missingAction.action.error.message, /no longer valid/);

  const ambiguousAction = value.scenarios
    .find((entry) => entry.id === "stale-element-ambiguous")
    .steps.at(-1);
  assert.equal(ambiguousAction.action.executed, false);
  assert.match(ambiguousAction.action.error.message, /-10005/);
  assert.match(ambiguousAction.action.error.message, /multiple elements/);

  for (const action of [missingAction, ambiguousAction]) {
    assert.equal(action.oracle.every((check) => check.passed), true);
    assert.equal(
      action.oracle.find(
        (check) => check.path === "hierarchy.wrongTargetClickCount"
      ).actual,
      0
    );
  }
});

test("stale screenshot coordinates are not revision-bound and can hit a decoy", async () => {
  const value = await fixture("runner-final-semantic-matrix-v4.json");
  const scenario = value.scenarios.find(
    (entry) => entry.id === "coordinate-stale-revision"
  );
  const stale = scenario.steps.find((step) => step.id === "click-old-coordinate");
  const fresh = scenario.steps.find((step) => step.id === "click-fresh-coordinate");

  assert.equal(stale.action.executed, true);
  assert.equal(
    stale.oracle.find((check) => check.path === "coordinate.clickCount").actual,
    0
  );
  assert.equal(
    stale.oracle.find(
      (check) => check.path === "coordinate.decoyClickCount"
    ).actual,
    1
  );
  assert.notDeepEqual(
    { x: stale.action.input.x, y: stale.action.input.y },
    { x: fresh.action.input.x, y: fresh.action.input.y }
  );
  assert.equal(
    fresh.oracle.find((check) => check.path === "coordinate.clickCount").actual,
    1
  );
});

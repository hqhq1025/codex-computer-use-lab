import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  ALLOWED_SKY_ACTIONS,
  LAB_APP_BUNDLE_ID,
  LAB_APP_PATH,
  LAB_STATE_PATH,
  LAB_SYNTHETIC_MARKER,
  REAL_CUA_EXECUTABLE_SCENARIO_IDS,
  REAL_CUA_SCENARIOS,
  REAL_CUA_SCENARIO_IDS,
  resolveElementIndex,
  validateExecutableScenarioIds,
  validateScenarioIds
} from "../lib/cua-lab-scenarios.mjs";
import {
  assertAllowedTarget,
  assertFixtureOutputPath,
  assertNodeReplHost,
  assertPersistentApprovalStoreAbsent,
  assertStateTarget,
  assertSyntheticOracleIdentity,
  buildDryRunPlan,
  detectScreenshotImage,
  evaluateOracleChecks,
  parseCliArgs,
  runRealCuaLab,
  verifyPinnedWrapper
} from "../scripts/real-cua-lab-runner.mjs";

const EXPECTED_SCENARIOS = [
  "full-state",
  "diff",
  "button-click",
  "set-value",
  "type-text",
  "press-key",
  "select-text",
  "checkbox",
  "slider-secondary-action",
  "scroll",
  "modal",
  "multi-window",
  "dynamic-hierarchy-stale-element",
  "stale-element-missing",
  "stale-element-ambiguous",
  "ambiguous-same-name",
  "coordinate-click",
  "oop-webcontent-coordinate-click",
  "coordinate-stale-revision",
  "drag-target",
  "window-move"
];

test("real CUA scenario allowlist is exact and action methods are bounded", () => {
  assert.deepEqual(REAL_CUA_SCENARIO_IDS, EXPECTED_SCENARIOS);
  assert.deepEqual(REAL_CUA_EXECUTABLE_SCENARIO_IDS, [
    "full-state",
    "diff",
    "button-click",
    "set-value",
    "type-text",
    "press-key",
    "select-text",
    "checkbox",
    "slider-secondary-action",
    "scroll",
    "modal",
    "multi-window",
    "dynamic-hierarchy-stale-element",
    "stale-element-missing",
    "stale-element-ambiguous",
    "ambiguous-same-name",
    "coordinate-click",
    "oop-webcontent-coordinate-click",
    "coordinate-stale-revision",
    "drag-target",
    "window-move"
  ]);

  for (const scenario of REAL_CUA_SCENARIOS) {
    assert.equal(scenario.steps[0].id, "reset");
    for (const step of scenario.steps) {
      assert.ok(["full", "cached"].includes(step.preObservation));
      assert.ok(
        ["full", "diff-then-full", "oracle-only"].includes(
          step.postObservation
        )
      );
      assert.ok(ALLOWED_SKY_ACTIONS.includes(step.action.method));
      assert.ok(step.oracle.length > 0);
    }
  }
});

test("real execution is limited to validated semantic scenarios", async () => {
  assert.deepEqual(validateExecutableScenarioIds([]), [
    "full-state",
    "diff",
    "button-click",
    "set-value",
    "type-text",
    "press-key",
    "select-text",
    "checkbox",
    "slider-secondary-action",
    "scroll",
    "modal",
    "multi-window",
    "dynamic-hierarchy-stale-element",
    "stale-element-missing",
    "stale-element-ambiguous",
    "ambiguous-same-name",
    "coordinate-click",
    "oop-webcontent-coordinate-click",
    "coordinate-stale-revision",
    "drag-target",
    "window-move"
  ]);
  assert.deepEqual(validateExecutableScenarioIds(["button-click"]), [
    "button-click"
  ]);
  assert.deepEqual(validateExecutableScenarioIds(["diff"]), ["diff"]);
  await assert.rejects(
    runRealCuaLab({
      execute: true,
      scenarioIds: ["not-a-real-scenario"]
    }),
    /not enabled for real execution/
  );
});

test("preflight oracle identity requires synthetic marker and fixed appPath", () => {
  const valid = {
    schemaVersion: 1,
    synthetic: true,
    syntheticMarker: LAB_SYNTHETIC_MARKER,
    bundleIdentifier: LAB_APP_BUNDLE_ID,
    appPath: LAB_APP_PATH
  };
  assert.doesNotThrow(() => assertSyntheticOracleIdentity(valid));
  assert.throws(
    () =>
      assertSyntheticOracleIdentity({
        ...valid,
        synthetic: false
      }),
    /synthetic identity or appPath/
  );
  assert.throws(
    () =>
      assertSyntheticOracleIdentity({
        ...valid,
        appPath: "/Applications/Other.app"
      }),
    /synthetic identity or appPath/
  );
});

test("unknown scenarios and target overrides fail closed", () => {
  assert.throws(
    () => validateScenarioIds(["not-a-real-scenario"]),
    /not allowlisted/
  );
  assert.throws(
    () => assertAllowedTarget({ bundleId: "com.apple.TextEdit" }),
    /Refusing non-lab bundle/
  );
  assert.throws(
    () => assertAllowedTarget({ appPath: "/Applications/Other.app" }),
    /Refusing non-lab application path/
  );
  assert.throws(
    () => assertAllowedTarget({ statePath: "/tmp/state.json" }),
    /Refusing non-lab state oracle path/
  );
  assert.deepEqual(assertAllowedTarget(), {
    bundleId: LAB_APP_BUNDLE_ID,
    appPath: LAB_APP_PATH,
    statePath: LAB_STATE_PATH
  });
});

test("CLI defaults to dry-run and rejects app or path injection flags", () => {
  const options = parseCliArgs(["--scenario", "button-click"]);
  assert.equal(options.execute, false);
  assert.equal(options.copyScreenshots, false);
  assert.deepEqual(options.scenarioIds, ["button-click"]);

  for (const argument of ["--app", "--path", "--state-path", "--delete"]) {
    assert.throws(() => parseCliArgs([argument, "x"]), /forbidden argument/);
  }
  assert.throws(
    () => parseCliArgs(["--copy-screenshots"]),
    /requires --execute/
  );
});

test("dry-run performs no runtime load or UI action", async () => {
  const result = await runRealCuaLab({
    execute: false,
    scenarioIds: ["button-click"]
  });

  assert.equal(result.mode, "dry-run");
  assert.equal(result.safety.productionCuaRequestSent, false);
  assert.equal(result.safety.uiActionsExecuted, false);
  assert.deepEqual(result.safety.persistentApprovalStoreBefore, {
    checked: false,
    present: null
  });
  assert.deepEqual(result.safety.persistentApprovalStoreAfter, {
    checked: false,
    present: null
  });
  assert.equal(result.scenarios.length, 1);
  assert.equal(result.target.appPath, "<lab-app>");
  assert.equal(result.target.stateOraclePath, "<lab-state>");
  assert.equal(result.wrapper.path, "<computer-use-wrapper>");
  assert.equal(JSON.stringify(result).includes("/Users/haoqing"), false);
});

test("checked production fixture records sanitized executable provenance", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../fixtures/real-cua/runner-all-semantic-native-roles-result-v2.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  assert.equal(fixture.mode, "execute");
  assert.equal(fixture.scenarios.every((scenario) => scenario.passed), true);
  assert.equal(
    fixture.safety.persistentApprovalStoreAfter.present,
    false
  );
});

test("persistent approval metadata fails closed without deleting anything", () => {
  assert.doesNotThrow(() =>
    assertPersistentApprovalStoreAbsent(
      { checked: true, present: false },
      "test"
    )
  );
  assert.throws(
    () =>
      assertPersistentApprovalStoreAbsent(
        { checked: true, present: true, type: "file" },
        "test"
      ),
    /stopping without deleting/
  );
});

test("frozen untrusted nodeRepl surface is sufficient and remains untouched", async () => {
  const runnerUrl = new URL(
    "../scripts/real-cua-lab-runner.mjs",
    import.meta.url
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
Object.defineProperty(globalThis, "nodeRepl", {
  configurable: false,
  enumerable: true,
  writable: false,
  value: Object.freeze({
    write() {},
    requestMeta: Object.freeze({ source: "unit-test-untrusted-realm" })
  })
});
const { assertNodeReplHost } = await import(${JSON.stringify(runnerUrl)});
assertNodeReplHost();
const descriptor = Object.getOwnPropertyDescriptor(globalThis, "nodeRepl");
if (descriptor.writable !== false || descriptor.configurable !== false) {
  throw new Error("locked nodeRepl descriptor changed");
}
`
    ],
    {
      encoding: "utf8"
    }
  );
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);

  const source = await readFile(
    new URL("../scripts/real-cua-lab-runner.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /Reflect\.set\s*\(\s*globalThis\s*,\s*["']nodeRepl/);
  assert.doesNotMatch(source, /globalThis\.nodeRepl\s*=/);
  assert.doesNotMatch(source, /createElicitation/);
  assert.doesNotMatch(source, /withSuspendedTimeout/);
  assert.doesNotMatch(source, /nativePipe/);
  assert.doesNotMatch(source, /from\s+["']node:process["']/);
});

test("programmatic runner options reject app, path, and dependency injection", async () => {
  await assert.rejects(
    runRealCuaLab({
      execute: false,
      app: "com.apple.TextEdit"
    }),
    /forbidden runner option/
  );
  await assert.rejects(
    runRealCuaLab({
      execute: false,
      appPath: "/Applications/Other.app"
    }),
    /forbidden runner option/
  );
  for (const key of [
    "loadSky",
    "setupComputerUseRuntime",
    "wrapperPath",
    "wrapperSha256"
  ]) {
    await assert.rejects(
      runRealCuaLab({
        execute: false,
        [key]: "injected"
      }),
      /forbidden runner option/
    );
  }
});

test("preflight helper pins the exact wrapper path and SHA-256", async () => {
  const wrapper = await verifyPinnedWrapper();
  assert.match(wrapper.path, /computer-use-client\.mjs$/);
  assert.equal(
    wrapper.sha256,
    "6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f"
  );
  assert.doesNotThrow(() =>
    assertNodeReplHost({
      write() {},
      requestMeta: {}
    })
  );
  assert.throws(
    () =>
      assertNodeReplHost({
        write() {}
      }),
    /Codex node_repl host/
  );
});

test("dry-run plan preserves the fresh-state and oracle sequence", () => {
  const plan = buildDryRunPlan({ scenarioIds: ["diff", "type-text"] });
  assert.deepEqual(plan.stepPattern, [
    "fresh-full-get_app_state",
    "read-state-json-before",
    "one-allowlisted-action",
    "fresh-get_app_state-after",
    "read-state-json-after",
    "compare-oracle"
  ]);
  assert.equal(
    plan.scenarios[0].steps.some(
      (step) => step.postObservation === "diff-then-full"
    ),
    true
  );
});

test("element selectors require the declared match count and occurrence", () => {
  const text =
    "[1] button 'CUA Lab Duplicate Action'\n" +
    "[2] button 'CUA Lab Duplicate Action'\n" +
    "[3] button 'CUA Lab Primary Button'";

  assert.equal(
    resolveElementIndex(text, {
      lineIncludes: ["button", "CUA Lab Duplicate Action"],
      expectedMatches: 2,
      occurrence: 2
    }),
    2
  );
  assert.throws(
    () =>
      resolveElementIndex(text, {
        lineIncludes: ["button", "CUA Lab Duplicate Action"]
      }),
    /expected 1 match/
  );
});

test("element selectors accept shipped bare-index AX lines with unknown roles", () => {
  const text =
    "\t\t5 unknown CUA Lab Primary Button, ID: cua.lab.primary-button\n" +
    "\t\t6 unknown CUA Lab Reset, ID: cua.lab.reset";

  assert.equal(
    resolveElementIndex(text, {
      lineIncludes: ["CUA Lab Primary Button"]
    }),
    5
  );
});

test("scenario selectors pin unique controls by accessibility id", () => {
  const checkboxScenario = REAL_CUA_SCENARIOS.find(
    (scenario) => scenario.id === "checkbox"
  );
  const checkboxStep = checkboxScenario.steps.find(
    (step) => step.id === "checkbox"
  );
  assert.deepEqual(checkboxStep.action.selector.lineIncludes, [
    "CUA Lab Checkbox",
    "ID: cua.lab.checkbox"
  ]);
});

test("stale hierarchy setup checks structural mode instead of last asynchronous event", () => {
  const plan = buildDryRunPlan({
    scenarioIds: [
      "dynamic-hierarchy-stale-element",
      "stale-element-missing",
      "stale-element-ambiguous"
    ]
  });
  const modes = new Map([
    [
      "dynamic-hierarchy-stale-element",
      ["mutate-hierarchy", "unique-replacement"]
    ],
    ["stale-element-missing", ["remove-stale-target", "missing"]],
    ["stale-element-ambiguous", ["duplicate-stale-target", "ambiguous"]]
  ]);

  for (const scenario of plan.scenarios) {
    const [stepId, mode] = modes.get(scenario.id);
    const setup = scenario.steps.find((step) => step.id === stepId);
    assert.ok(setup);
    assert.ok(
      setup.oracle.some(
        (check) =>
          check.path === "hierarchy.mode" &&
          check.operator === "equals" &&
          check.value === mode
      )
    );
    assert.equal(
      setup.oracle.some((check) => check.path === "meta.lastAction"),
      false
    );
  }
});

test("window move keeps a bounded six-step budget in each direction", () => {
  const plan = buildDryRunPlan({ scenarioIds: ["window-move"] });
  const steps = plan.scenarios[0].steps;
  const left = steps.filter((step) => step.id.startsWith("move-left"));
  const right = steps.filter((step) => step.id.startsWith("move-right"));

  assert.equal(left.length, 6);
  assert.equal(right.length, 6);
  assert.equal(
    left.at(-1).oracle.some(
      (check) =>
        check.path === "window.onSecondaryScreen" &&
        check.operator === "equals" &&
        check.value === true
    ),
    true
  );
  assert.equal(
    right.at(-1).oracle.some(
      (check) =>
        check.path === "window.onSecondaryScreen" &&
        check.operator === "equals" &&
        check.value === false
    ),
    true
  );
});

test("scenario reset restores the initial primary-screen geometry", () => {
  const plan = buildDryRunPlan({ scenarioIds: ["set-value"] });
  const reset = plan.scenarios[0].steps.find((step) => step.id === "reset");

  assert.ok(reset);
  assert.equal(reset.postActionSettleMilliseconds, 1300);
  assert.equal(
    reset.oracle.some(
      (check) =>
        check.path === "window.onSecondaryScreen" &&
        check.operator === "equals" &&
        check.value === false
    ),
    true
  );
  assert.equal(
    reset.oracle.some(
      (check) =>
        check.path === "window.width" &&
        check.operator === "equals" &&
        check.value === 1025
    ),
    true
  );
});

test("OOP WebContent coordinate scenario requires measured target and distinct PIDs", () => {
  const plan = buildDryRunPlan({
    scenarioIds: ["oop-webcontent-coordinate-click"]
  });
  const step = plan.scenarios[0].steps.find(
    (entry) => entry.id === "oop-webcontent-coordinate-click"
  );

  assert.deepEqual(step.action.coordinateFromOracle, {
    xPath: "oop.target.x",
    yPath: "oop.target.y"
  });
  assert.deepEqual(
    step.preconditions.map((check) => [
      check.operator,
      check.path,
      check.value ?? check.otherPath
    ]),
    [
      ["greater-than", "oop.target.x", 0],
      ["greater-than", "oop.target.y", 0],
      ["greater-than", "oop.hostPID", 0],
      ["greater-than", "oop.webContentPID", 0],
      ["not-equals-path", "oop.webContentPID", "oop.hostPID"]
    ]
  );
  assert.equal(
    step.oracle.some(
      (check) =>
        check.operator === "equals" &&
        check.path === "oop.lastEventTrusted" &&
        check.value === true
    ),
    true
  );
});

test("scenario success never depends on the last asynchronous event label", () => {
  const plan = buildDryRunPlan();
  assert.equal(
    plan.scenarios.some((scenario) =>
      scenario.steps.some((step) =>
        step.oracle.some((check) => check.path === "meta.lastAction")
      )
    ),
    false
  );
});

test("screenshot detector accepts PNG and production-style JFIF JPEG", () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(3, 16);
  png.writeUInt32BE(2, 20);
  assert.deepEqual(detectScreenshotImage(png), {
    format: "png",
    mimeType: "image/png",
    extension: "png",
    width: 3,
    height: 2
  });

  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
  assert.deepEqual(detectScreenshotImage(jpeg), {
    format: "jpeg",
    mimeType: "image/jpeg",
    extension: "jpeg",
    width: 3,
    height: 2
  });
});

test("state target accepts only the bundle id or pinned canonical app path", () => {
  assert.equal(assertStateTarget(LAB_APP_BUNDLE_ID), LAB_APP_BUNDLE_ID);
  assert.equal(assertStateTarget(LAB_APP_PATH), LAB_APP_BUNDLE_ID);
  assert.throws(
    () => assertStateTarget("/Applications/Other.app"),
    /unexpected app target/
  );
});

test("oracle checks compare only declared synthetic paths", () => {
  const checks = evaluateOracleChecks(
    [
      { operator: "equals", path: "modal.open", value: true },
      { operator: "greater-than-before", path: "metrics.count" },
      { operator: "greater-than", path: "metrics.count", value: 1 },
      {
        operator: "not-equals-path",
        path: "identity.webContentPID",
        otherPath: "identity.hostPID"
      },
      { operator: "not-less-than-before", path: "metrics.count" },
      { operator: "unchanged", path: "guard.wrongTarget" }
    ],
    {
      modal: { open: false },
      metrics: { count: 1 },
      identity: { hostPID: 10, webContentPID: 20 },
      guard: { wrongTarget: 0 }
    },
    {
      modal: { open: true },
      metrics: { count: 2 },
      identity: { hostPID: 10, webContentPID: 20 },
      guard: { wrongTarget: 0 }
    }
  );
  assert.equal(checks.every((check) => check.passed), true);
});

test("result and screenshot paths cannot escape fixtures/real-cua", () => {
  assert.match(
    assertFixtureOutputPath("fixtures/real-cua/dry-run-plan.json"),
    /fixtures\/real-cua\/dry-run-plan\.json$/
  );
  assert.throws(
    () => assertFixtureOutputPath("fixtures/other/result.json"),
    /must stay below/
  );
});

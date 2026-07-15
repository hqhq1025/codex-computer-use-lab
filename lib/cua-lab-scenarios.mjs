import path from "node:path";
import { fileURLToPath } from "node:url";

const LAB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const LAB_APP_BUNDLE_ID = "com.openai.codex.cualab";
export const LAB_BUILD_ROOT = path.join(LAB_ROOT, "test-app", "build");
export const LAB_APP_PATH = path.join(LAB_BUILD_ROOT, "Codex CUA Lab.app");
export const LAB_RUNTIME_ROOT = path.join(LAB_ROOT, "test-app", "runtime");
export const LAB_STATE_PATH = path.join(LAB_RUNTIME_ROOT, "state.json");
export const LAB_FIXTURE_ROOT = path.join(LAB_ROOT, "fixtures", "real-cua");
export const LAB_SYNTHETIC_MARKER = "CUA Lab Synthetic Surface";

const UNIQUE_SYNTHETIC_AX_IDS = Object.freeze({
  "CUA Lab Reset": "cua.lab.reset",
  "CUA Lab Full State Probe": "cua.lab.full-state-probe",
  "CUA Lab Diff Probe": "cua.lab.diff-probe",
  "CUA Lab Primary Button": "cua.lab.primary-button",
  "CUA Lab Set Value Field": "cua.lab.set-value-field",
  "CUA Lab Type Text Field": "cua.lab.type-text-field",
  "CUA Lab Select Text Field": "cua.lab.select-text-field",
  "CUA Lab Checkbox": "cua.lab.checkbox",
  "CUA Lab Slider": "cua.lab.slider",
  "CUA Lab Scroll Region": "cua.lab.scroll-region",
  "CUA Lab Open Modal": "cua.lab.modal-open",
  "CUA Lab Modal Close": "cua.lab.modal-close",
  "CUA Lab Open Secondary Window": "cua.lab.secondary-open",
  "CUA Lab Secondary Button": "cua.lab.secondary-button",
  "CUA Lab Secondary Scroll Region": "cua.lab.secondary-scroll-region",
  "CUA Lab Secondary Close": "cua.lab.secondary-close",
  "CUA Lab Mutate Hierarchy": "cua.lab.hierarchy-mutate",
  "CUA Lab Remove Stale Target": "cua.lab.hierarchy-remove",
  "CUA Lab Duplicate Stale Target": "cua.lab.hierarchy-duplicate",
  "CUA Lab Stale Target": "cua.lab.stale-target",
  "CUA Lab Coordinate Target": "cua.lab.coordinate-target"
  ,"CUA Lab Coordinate Decoy": "cua.lab.coordinate-decoy"
  ,"CUA Lab Move Coordinate Target": "cua.lab.coordinate-mutate"
});

export const ALLOWED_SKY_ACTIONS = Object.freeze([
  "click",
  "set_value",
  "type_text",
  "select_text",
  "perform_secondary_action",
  "press_key",
  "scroll",
  "drag"
]);

const RESET_STEP = {
  id: "reset",
  description: "Reset only the synthetic lab state.",
  preObservation: "full",
  action: {
    method: "click",
    selector: element("button", "CUA Lab Reset")
  },
  postActionSettleMilliseconds: 1300,
  postObservation: "full",
  oracle: [
    greaterThanBefore("meta.resetCount"),
    equals("window.onSecondaryScreen", false),
    equals("window.width", 1025)
  ]
};

const scenarios = [
  scenario("full-state", "Full state", [
    {
      id: "full-state-probe",
      description: "Capture and validate a complete accessibility tree.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("button", "CUA Lab Full State Probe")
      },
      postObservation: "full",
      oracle: [
        greaterThanBefore("metrics.fullStateProbeCount")
      ]
    }
  ]),
  scenario("diff", "Diff state", [
    {
      id: "diff-probe",
      description: "Request a diff after one isolated synthetic mutation.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("button", "CUA Lab Diff Probe")
      },
      postObservation: "diff-then-full",
      oracle: [
        greaterThanBefore("metrics.diffProbeCount")
      ]
    }
  ]),
  scenario("button-click", "Button click", [
    {
      id: "button-click",
      description: "Click one indexed synthetic button.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("button", "CUA Lab Primary Button")
      },
      postObservation: "full",
      oracle: [
        greaterThanBefore("controls.buttonClickCount")
      ]
    }
  ]),
  scenario("set-value", "Set value", [
    {
      id: "set-value",
      description: "Replace the value of one indexed text field.",
      preObservation: "full",
      action: {
        method: "set_value",
        selector: element("text", "CUA Lab Set Value Field"),
        value: "cua-lab-set-value"
      },
      postObservation: "full",
      oracle: [
        equals("controls.setValue", "cua-lab-set-value")
      ]
    }
  ]),
  scenario("type-text", "Type text", [
    {
      id: "focus-type-text",
      description: "Focus the synthetic typing field with an indexed click.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("text", "CUA Lab Type Text Field")
      },
      postObservation: "full",
      oracle: [
        equals("focus.control", "type-text")
      ]
    },
    {
      id: "type-text",
      description: "Type a fixed synthetic string into the current focus.",
      preObservation: "full",
      action: {
        method: "type_text",
        text: "cua-lab-type-text"
      },
      postObservation: "full",
      oracle: [
        equals("controls.typeText", "cua-lab-type-text")
      ]
    }
  ]),
  scenario("press-key", "Press key", [
    {
      id: "focus-set-value-for-tab",
      description: "Focus the first field before keyboard navigation.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("text", "CUA Lab Set Value Field")
      },
      postObservation: "full",
      oracle: [
        equals("focus.control", "set-value")
      ]
    },
    {
      id: "press-tab",
      description: "Move focus to the next synthetic field.",
      preObservation: "full",
      action: {
        method: "press_key",
        key: "Tab"
      },
      postObservation: "full",
      oracle: [
        equals("focus.control", "type-text")
      ]
    }
  ]),
  scenario("select-text", "Select text", [
    {
      id: "seed-select-text",
      description: "Seed the editable field with deterministic text.",
      preObservation: "full",
      action: {
        method: "set_value",
        selector: element("text", "CUA Lab Select Text Field"),
        value: "prefix target suffix"
      },
      postObservation: "full",
      oracle: [
        equals("controls.selectTextValue", "prefix target suffix")
      ]
    },
    {
      id: "select-text",
      description: "Select the disambiguated middle token.",
      preObservation: "full",
      action: {
        method: "select_text",
        selector: element("text", "CUA Lab Select Text Field"),
        text: "target",
        prefix: "prefix ",
        suffix: " suffix",
        selection_type: "text"
      },
      postObservation: "full",
      oracle: [
        equals("selection.text", "target"),
        equals("selection.type", "text")
      ]
    }
  ]),
  scenario("checkbox", "Checkbox", [
    {
      id: "checkbox",
      description: "Toggle one indexed synthetic checkbox.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("checkbox", "CUA Lab Checkbox")
      },
      postObservation: "full",
      oracle: [
        equals("controls.checkboxChecked", true)
      ]
    }
  ]),
  scenario("slider-secondary-action", "Slider secondary action", [
    {
      id: "slider-increment",
      description: "Invoke the slider's declared Increment AX action.",
      preObservation: "full",
      action: {
        method: "perform_secondary_action",
        selector: element("slider", "CUA Lab Slider"),
        action: "Increment"
      },
      postObservation: "full",
      oracle: [
        greaterThanBefore("controls.sliderValue")
      ]
    }
  ]),
  scenario("scroll", "Scroll", [
    {
      id: "scroll",
      description: "Scroll the indexed synthetic scroll region down one page.",
      preObservation: "full",
      action: {
        method: "scroll",
        selector: element("scroll", "CUA Lab Scroll Region"),
        direction: "down",
        pages: 1
      },
      postObservation: "full",
      oracle: [
        greaterThanBefore("controls.scrollOffset")
      ]
    }
  ]),
  scenario("modal", "Modal", [
    {
      id: "open-modal",
      description: "Open the synthetic modal.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("button", "CUA Lab Open Modal")
      },
      postObservation: "full",
      oracle: [
        equals("modal.open", true)
      ]
    },
    {
      id: "close-modal",
      description: "Close the synthetic modal using its indexed button.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("button", "CUA Lab Modal Close")
      },
      postObservation: "full",
      oracle: [
        equals("modal.open", false)
      ]
    }
  ]),
  scenario("multi-window", "Multiple windows", [
    {
      id: "open-secondary-window",
      description: "Open a second standard AppKit window.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("button", "CUA Lab Open Secondary Window")
      },
      postObservation: "full",
      oracle: [
        equals("secondaryWindow.open", true)
      ]
    },
    {
      id: "secondary-button-click",
      description: "Click a control in the second window.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("button", "CUA Lab Secondary Button")
      },
      postObservation: "full",
      oracle: [
        greaterThanBefore("secondaryWindow.buttonClickCount")
      ]
    },
    {
      id: "secondary-scroll",
      description: "Scroll a region in the second window.",
      preObservation: "full",
      action: {
        method: "scroll",
        selector: element("scroll", "CUA Lab Secondary Scroll Region"),
        direction: "down",
        pages: 1
      },
      postObservation: "full",
      oracle: [
        greaterThanBefore("secondaryWindow.scrollOffset")
      ]
    },
    {
      id: "close-secondary-window",
      description: "Close the second window and return to the main window.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("button", "CUA Lab Secondary Close")
      },
      postObservation: "full",
      oracle: [
        equals("secondaryWindow.open", false)
      ]
    }
  ]),
  scenario("dynamic-hierarchy-stale-element", "Dynamic hierarchy stale element", [
    {
      id: "mutate-hierarchy",
      description: "Capture the old target index, then mutate the hierarchy.",
      preObservation: "full",
      captures: [
        {
          name: "stale-target",
          selector: element("button", "CUA Lab Stale Target")
        }
      ],
      action: {
        method: "click",
        selector: element("button", "CUA Lab Mutate Hierarchy")
      },
      postObservation: "oracle-only",
      oracle: [
        greaterThanBefore("hierarchy.generation"),
        equals("hierarchy.mode", "unique-replacement")
      ]
    },
    {
      id: "stale-click",
      description:
        "Reuse the captured old index without another state request after the hierarchy changed.",
      preObservation: "cached",
      action: {
        method: "click",
        capturedIndex: "stale-target"
      },
      allowActionError: true,
      postObservation: "full",
      oracle: [
        notLessThanBefore("hierarchy.staleTargetClickCount"),
        unchanged("hierarchy.wrongTargetClickCount")
      ]
    },
    {
      id: "fresh-click-after-stale",
      description: "Resolve the target again from a fresh tree and click it.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("button", "CUA Lab Stale Target")
      },
      postObservation: "full",
      oracle: [
        greaterThanBefore("hierarchy.staleTargetClickCount")
      ]
    }
  ]),
  scenario("stale-element-missing", "Stale element missing after refetch", [
    {
      id: "remove-stale-target",
      description: "Capture the target index, then remove every matching target.",
      preObservation: "full",
      captures: [
        {
          name: "missing-target",
          selector: element("button", "CUA Lab Stale Target")
        }
      ],
      action: {
        method: "click",
        selector: element("button", "CUA Lab Remove Stale Target")
      },
      postObservation: "oracle-only",
      oracle: [
        greaterThanBefore("hierarchy.generation"),
        equals("hierarchy.mode", "missing")
      ]
    },
    {
      id: "click-missing-stale-target",
      description: "Reuse the old index after the target has disappeared.",
      preObservation: "cached",
      action: {
        method: "click",
        capturedIndex: "missing-target"
      },
      allowActionError: true,
      requireActionError: true,
      postObservation: "full",
      oracle: [
        unchanged("hierarchy.staleTargetClickCount"),
        unchanged("hierarchy.wrongTargetClickCount")
      ]
    }
  ]),
  scenario("stale-element-ambiguous", "Stale element ambiguous after refetch", [
    {
      id: "duplicate-stale-target",
      description: "Capture the target index, then create two matching replacements.",
      preObservation: "full",
      captures: [
        {
          name: "ambiguous-target",
          selector: element("button", "CUA Lab Stale Target")
        }
      ],
      action: {
        method: "click",
        selector: element("button", "CUA Lab Duplicate Stale Target")
      },
      postObservation: "oracle-only",
      oracle: [
        greaterThanBefore("hierarchy.generation"),
        equals("hierarchy.mode", "ambiguous")
      ]
    },
    {
      id: "click-ambiguous-stale-target",
      description: "Reuse the old index when two replacements now match.",
      preObservation: "cached",
      action: {
        method: "click",
        capturedIndex: "ambiguous-target"
      },
      allowActionError: true,
      requireActionError: true,
      postObservation: "full",
      oracle: [
        unchanged("hierarchy.staleTargetClickCount"),
        unchanged("hierarchy.wrongTargetClickCount")
      ]
    }
  ]),
  scenario("ambiguous-same-name", "Ambiguous same-name controls", [
    {
      id: "ambiguous-second",
      description:
        "Select the second of two same-name buttons and verify the oracle target.",
      preObservation: "full",
      action: {
        method: "click",
        selector: element("button", "CUA Lab Duplicate Action", {
          expectedMatches: 2,
          occurrence: 2
        })
      },
      postObservation: "full",
      oracle: [
        equals("ambiguous.lastTarget", "second"),
        greaterThanBefore("ambiguous.clickCount")
      ]
    }
  ]),
  scenario("coordinate-click", "Coordinate click", [
    {
      id: "coordinate-click",
      description:
        "Click the fixed synthetic coordinate target from the immediately preceding screenshot.",
      preObservation: "full",
      action: {
        method: "click",
        coordinateFromOracle: {
          xPath: "coordinate.target.x",
          yPath: "coordinate.target.y"
        }
      },
      postObservation: "full",
      oracle: [
        greaterThanBefore("coordinate.clickCount")
      ]
    }
  ]),
  scenario("oop-webcontent-coordinate-click", "OOP WebContent coordinate click", [
    {
      id: "oop-webcontent-coordinate-click",
      description:
        "Click the in-memory WKWebView button through a fresh screenshot coordinate.",
      preObservation: "full",
      preconditions: [
        greaterThan("oop.target.x", 0),
        greaterThan("oop.target.y", 0),
        greaterThan("oop.hostPID", 0),
        greaterThan("oop.webContentPID", 0),
        notEqualsPath("oop.webContentPID", "oop.hostPID")
      ],
      action: {
        method: "click",
        coordinateFromOracle: {
          xPath: "oop.target.x",
          yPath: "oop.target.y"
        }
      },
      postObservation: "full",
      oracle: [
        greaterThanBefore("oop.clickCount"),
        equals("oop.lastEventTrusted", true),
        greaterThan("oop.webContentPID", 0),
        notEqualsPath("oop.webContentPID", "oop.hostPID")
      ]
    }
  ]),
  scenario("coordinate-stale-revision", "Stale screenshot coordinate", [
    {
      id: "mutate-coordinate-layout",
      description: "Capture the target coordinate, then swap target and decoy without re-observing.",
      preObservation: "full",
      captures: [
        {
          name: "old-target-coordinate",
          coordinateFromOracle: {
            xPath: "coordinate.target.x",
            yPath: "coordinate.target.y"
          }
        }
      ],
      action: {
        method: "click",
        selector: element("button", "CUA Lab Move Coordinate Target")
      },
      postObservation: "oracle-only",
      oracle: [
        greaterThanBefore("coordinate.generation")
      ]
    },
    {
      id: "click-old-coordinate",
      description: "Click the pre-mutation coordinate without a new screenshot.",
      preObservation: "cached",
      action: {
        method: "click",
        capturedCoordinate: "old-target-coordinate"
      },
      postObservation: "full",
      oracle: [
        unchanged("coordinate.clickCount"),
        greaterThanBefore("coordinate.decoyClickCount")
      ]
    },
    {
      id: "click-fresh-coordinate",
      description: "Use a fresh screenshot-derived target coordinate after the mutation.",
      preObservation: "full",
      action: {
        method: "click",
        coordinateFromOracle: {
          xPath: "coordinate.target.x",
          yPath: "coordinate.target.y"
        }
      },
      postObservation: "full",
      oracle: [
        greaterThanBefore("coordinate.clickCount")
      ]
    }
  ]),
  scenario("drag-target", "Drag target", [
    {
      id: "drag-target",
      description:
        "Drag the synthetic token using coordinates derived from the current layout.",
      preObservation: "full",
      action: {
        method: "drag",
        coordinatesFromOracle: {
          fromXPath: "drag.start.x",
          fromYPath: "drag.start.y",
          toXPath: "drag.end.x",
          toYPath: "drag.end.y"
        }
      },
      postObservation: "full",
      oracle: [
        changed("controls.dragPosition.x")
      ]
    }
  ]),
  scenario("window-move", "Window move", [
    {
      id: "move-left-1",
      description:
        "Move the main window left using fresh screenshot coordinates.",
      preObservation: "full",
      action: {
        method: "drag",
        coordinatesFromOracle: {
          fromXPath: "windowMove.start.x",
          fromYPath: "windowMove.start.y",
          toXPath: "windowMove.end.x",
          toYPath: "windowMove.end.y"
        }
      },
      postObservation: "full",
      oracle: [
        changed("window.x")
      ]
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `move-left-${index + 2}`,
      description: "Continue moving left after a fresh observation.",
      preObservation: "full",
      action: {
        method: "drag",
        coordinatesFromOracle: {
          fromXPath: "windowMove.start.x",
          fromYPath: "windowMove.start.y",
          toXPath: "windowMove.end.x",
          toYPath: "windowMove.end.y"
        }
      },
      postObservation: "full",
      oracle: [
        changed("window.x"),
        ...(index === 4 ? [equals("window.onSecondaryScreen", true)] : [])
      ]
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `move-right-${index + 1}`,
      description: "Return the window toward the primary display after a fresh observation.",
      preObservation: "full",
      action: {
        method: "drag",
        coordinatesFromOracle: {
          fromXPath: "windowMove.start.x",
          fromYPath: "windowMove.start.y",
          toXPath: "windowMove.returnEnd.x",
          toYPath: "windowMove.returnEnd.y"
        }
      },
      postObservation: "full",
      oracle: [
        changed("window.x"),
        ...(index === 5 ? [equals("window.onSecondaryScreen", false)] : [])
      ]
    }))
  ])
];

export const REAL_CUA_SCENARIOS = deepFreeze(scenarios);
export const REAL_CUA_SCENARIO_IDS = Object.freeze(
  REAL_CUA_SCENARIOS.map((entry) => entry.id)
);
export const REAL_CUA_EXECUTABLE_SCENARIO_IDS = Object.freeze([
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

export const SYNTHETIC_AX_LABELS = Object.freeze(
  Array.from(collectSyntheticLabels(REAL_CUA_SCENARIOS)).sort()
);

export function getRealCuaScenario(id) {
  return REAL_CUA_SCENARIOS.find((entry) => entry.id === id) ?? null;
}

export function validateScenarioIds(ids) {
  const selected = ids.length === 0 ? REAL_CUA_SCENARIO_IDS : ids;
  const unique = [];
  for (const id of selected) {
    if (!REAL_CUA_SCENARIO_IDS.includes(id)) {
      throw new Error(`Scenario is not allowlisted: ${id}`);
    }
    if (!unique.includes(id)) {
      unique.push(id);
    }
  }
  return unique;
}

export function validateExecutableScenarioIds(ids) {
  const selected =
    ids.length === 0 ? REAL_CUA_EXECUTABLE_SCENARIO_IDS : ids;
  const unique = [];
  for (const id of selected) {
    if (!REAL_CUA_EXECUTABLE_SCENARIO_IDS.includes(id)) {
      throw new Error(`Scenario is not enabled for real execution: ${id}`);
    }
    if (!unique.includes(id)) {
      unique.push(id);
    }
  }
  return unique;
}

export function resolveElementIndex(text, selector) {
  if (typeof text !== "string") {
    throw new TypeError("Accessibility text must be a string");
  }
  const matches = text
    .split(/\r?\n/)
    .map((line) => {
      const match =
        line.match(/^\s*\[(\d+)]\s+(.*)$/) ??
        line.match(/^\s*(\d+)\s+(.*)$/);
      return match
        ? {
            index: Number(match[1]),
            line: match[2]
          }
        : null;
    })
    .filter(
      (entry) =>
        entry !== null &&
        selector.lineIncludes.every((token) => entry.line.includes(token))
    );

  const expectedMatches = selector.expectedMatches ?? 1;
  if (matches.length !== expectedMatches) {
    throw new Error(
      `Selector ${JSON.stringify(selector.lineIncludes)} expected ${expectedMatches} match(es), found ${matches.length}`
    );
  }

  const occurrence = selector.occurrence ?? 1;
  const selected = matches[occurrence - 1];
  if (!selected) {
    throw new Error(
      `Selector occurrence ${occurrence} is outside ${matches.length} match(es)`
    );
  }
  return selected.index;
}

function scenario(id, title, steps) {
  return {
    id,
    title,
    steps: [{ ...RESET_STEP }, ...steps]
  };
}

function element(roleToken, label, options = {}) {
  const identifier = UNIQUE_SYNTHETIC_AX_IDS[label];
  return {
    roleHint: roleToken,
    lineIncludes:
      identifier == null ? [label] : [label, `ID: ${identifier}`],
    ...options
  };
}

function equals(path, value) {
  return { operator: "equals", path, value };
}

function unchanged(path) {
  return { operator: "unchanged", path };
}

function changed(path) {
  return { operator: "changed", path };
}

function greaterThanBefore(path) {
  return { operator: "greater-than-before", path };
}

function greaterThan(path, value) {
  return { operator: "greater-than", path, value };
}

function notEqualsPath(path, otherPath) {
  return { operator: "not-equals-path", path, otherPath };
}

function notLessThanBefore(path) {
  return { operator: "not-less-than-before", path };
}

function collectSyntheticLabels(entries) {
  const labels = new Set([
    LAB_SYNTHETIC_MARKER,
    "Codex CUA Lab",
    "Close",
    "Minimize",
    "Zoom",
    "Increment",
    "cua-lab-set-value",
    "cua-lab-type-text",
    "prefix target suffix",
    "target"
  ]);

  for (const entry of entries) {
    for (const step of entry.steps) {
      for (const selector of [
        step.action.selector,
        ...(step.captures ?? []).map((capture) => capture.selector)
      ].filter(Boolean)) {
        for (const token of selector.lineIncludes) {
          if (token.startsWith("CUA Lab")) {
            labels.add(token);
          }
        }
      }
    }
  }
  return labels;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

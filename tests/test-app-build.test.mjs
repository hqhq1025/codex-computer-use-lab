import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const testAppDirectory = path.join(root, "test-app");
const appPath = path.join(testAppDirectory, "build", "Codex CUA Lab.app");
const executablePath = path.join(
  appPath,
  "Contents",
  "MacOS",
  "Codex CUA Lab"
);
const infoPlistPath = path.join(appPath, "Contents", "Info.plist");

const build = spawnSync("bash", [path.join(testAppDirectory, "build.sh")], {
  cwd: root,
  encoding: "utf8",
  timeout: 60_000
});
assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`
  );
  return `${result.stdout}${result.stderr}`;
}

test("build produces a signed application with the fixed bundle identifier", async () => {
  const executable = await stat(executablePath);
  assert.equal(executable.isFile(), true);
  assert.notEqual(executable.mode & 0o111, 0);

  const bundleIdentifier = run("plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    infoPlistPath
  ]).trim();
  assert.equal(bundleIdentifier, "com.openai.codex.cualab");

  run("codesign", ["--verify", "--deep", "--strict", appPath]);
  const signature = run("codesign", ["-dvv", appPath]);
  assert.match(signature, /Identifier=com\.openai\.codex\.cualab/);
});

test("built executable contains the minimal runner accessibility contract", async () => {
  const strings = run("strings", [executablePath]);
  const controllerSource = await readFile(
    path.join(testAppDirectory, "Sources", "LabWindowController.swift"),
    "utf8"
  );
  const requiredMarkers = [
    "cua.lab.reset",
    "cua.lab.full-state-probe",
    "cua.lab.diff-probe",
    "cua.lab.diff-status",
    "cua.lab.primary-button",
    "cua.lab.secondary-open",
    "cua.lab.secondary-window",
    "cua.lab.secondary-button",
    "cua.lab.secondary-scroll-region",
    "cua.lab.secondary-close",
    "cua.lab.hierarchy-remove",
    "cua.lab.hierarchy-duplicate",
    "cua.lab.coordinate-decoy",
    "cua.lab.coordinate-mutate",
    "cua.lab.set-value-field",
    "cua.lab.type-text-field",
    "cua.lab.select-text-field",
    "cua.lab.checkbox",
    "cua.lab.slider"
  ];

  for (const marker of requiredMarkers) {
    assert.match(strings, new RegExp(marker.replaceAll(".", "\\.")));
  }
  assert.match(strings, /CUA Lab Synthetic Surface/);
  for (const label of [
    "CUA Lab Reset",
    "CUA Lab Full State Probe",
    "CUA Lab Diff Probe",
    "CUA Lab Diff Revision",
    "CUA Lab Primary Button",
    "CUA Lab Open Secondary Window",
    "CUA Lab Secondary Window",
    "CUA Lab Secondary Button",
    "CUA Lab Secondary Scroll Region",
    "CUA Lab Secondary Close",
    "CUA Lab Remove Stale Target",
    "CUA Lab Duplicate Stale Target",
    "CUA Lab Coordinate Decoy",
    "CUA Lab Move Coordinate Target",
    "CUA Lab Set Value Field",
    "CUA Lab Type Text Field",
    "CUA Lab Select Text Field",
    "CUA Lab Checkbox",
    "CUA Lab Slider"
  ]) {
    assert.match(controllerSource, new RegExp(label));
  }
  for (const stateKey of [
    "resetCount",
    "lastAction",
    "fullStateProbeCount",
    "buttonClickCount",
    "setValue",
    "typeText",
    "selectTextValue",
    "checkboxChecked",
    "sliderValue",
    "hierarchyMode",
    "staleTargetClickCount",
    "wrongTargetClickCount"
  ]) {
    assert.match(strings, new RegExp(stateKey));
  }
});

test("code signature grants no network entitlement", () => {
  const entitlements = run("codesign", [
    "-d",
    "--entitlements",
    ":-",
    appPath
  ]);

  assert.doesNotMatch(entitlements, /com\.apple\.security\.network\.client/);
  assert.doesNotMatch(entitlements, /com\.apple\.security\.network\.server/);
});

test("Swift source has no network, clipboard, user-default, or external-read API", async () => {
  const sourceDirectory = path.join(testAppDirectory, "Sources");
  const sourceFiles = (await readdir(sourceDirectory))
    .filter((name) => name.endsWith(".swift"))
    .sort();
  const source = (
    await Promise.all(
      sourceFiles.map((name) => readFile(path.join(sourceDirectory, name), "utf8"))
    )
  ).join("\n");

  for (const prohibited of [
    /\bURLSession\b/,
    /\bNSPasteboard\b/,
    /\bUserDefaults\b/,
    /\bNWConnection\b/,
    /\bNetwork\./,
    /\bData\s*\(\s*contentsOf:/,
    /\bString\s*\(\s*contentsOf:/,
    /\bFileHandle\b/,
    /\bcontentsOfDirectory\b/,
    /\bcontentsAtPath\b/
  ]) {
    assert.doesNotMatch(source, prohibited);
  }

  const oopSource = await readFile(
    path.join(sourceDirectory, "OOPWebViewSurface.swift"),
    "utf8"
  );
  assert.match(oopSource, /import WebKit/);
  assert.match(
    oopSource,
    /configuration\.websiteDataStore = \.nonPersistent\(\)/
  );
  assert.match(oopSource, /loadHTMLString\(Self\.html, baseURL: nil\)/);
  assert.match(oopSource, /connect-src 'none'/);
  assert.match(oopSource, /default-src 'none'/);
  assert.match(oopSource, /navigationAction\.navigationType == \.other/);
  assert.match(oopSource, /decisionHandler\(isMemoryDocument \? \.allow : \.cancel\)/);
  assert.doesNotMatch(oopSource, /loadRequest|loadFileURL|URLRequest/);
  assert.doesNotMatch(oopSource, /https?:\/\//);
  assert.match(oopSource, /_webProcessIdentifier/);
  assert.match(oopSource, /getBoundingClientRect\(\)/);
  assert.match(oopSource, /isTrusted: event\.isTrusted/);
  assert.match(oopSource, /addLocalMonitorForEvents/);
  assert.match(oopSource, /removeMonitor/);
  assert.match(oopSource, /CUA Lab OOP Button/);
  assert.match(oopSource, /CUA Lab OOP Text Field/);
  assert.match(oopSource, /action: "text-input"/);
  assert.match(oopSource, /action: "text-change"/);
  assert.match(oopSource, /isTrusted: event\.isTrusted/);

  assert.match(source, /appendingPathComponent\("runtime"/);
  assert.match(source, /appendingPathComponent\("state\.json"/);
  assert.match(source, /buildURL\.lastPathComponent == "build"/);
  assert.match(source, /testAppURL\.lastPathComponent == "test-app"/);
  assert.match(source, /appURL\.path == LabContract\.appPath/);
  assert.match(source, /"synthetic": true/);
  assert.match(source, /"syntheticMarker": LabContract\.syntheticMarker/);
  assert.match(source, /S_IRUSR \| S_IRGRP \| S_IROTH/);
  assert.doesNotMatch(source, /override func setAccessibilityValue/);
  assert.match(source, /if !\(self is NSControl\)/);
  assert.doesNotMatch(source, /window\.setAccessibilityElement\(true\)/);
  assert.doesNotMatch(source, /window\.setAccessibilityIdentifier/);
  assert.doesNotMatch(source, /window\.setAccessibilityLabel/);
  assert.doesNotMatch(source, /contentView\.applyAccessibilityMarker/);
  assert.match(source, /override var isFlipped: Bool/);

  const windowDidMove = source.slice(
    source.indexOf("func windowDidMove"),
    source.indexOf("func windowDidResize")
  );
  assert.match(windowDidMove, /updateWindowOrigin\(\)/);
  assert.doesNotMatch(windowDidMove, /lastAction/);
  assert.match(source, /windowMoveHandle\.onWindowMove[\s\S]*lastAction = "window-move"/);
  assert.match(source, /resetWindowSize = window\.frame\.size/);
  assert.match(source, /window\.setFrame\(/);
  assert.match(source, /Self\.positionOnPrimaryScreen\(window\)/);
  assert.match(source, /Int\(\$0\.frame\.origin\.x\.rounded\(\)\) == 0/);
  assert.match(source, /Int\(\$0\.frame\.origin\.y\.rounded\(\)\) == 0/);
  assert.doesNotMatch(source, /let mainScreen = NSScreen\.screens\.first/);
  assert.match(source, /resetGeometryRestoreGeneration \+= 1/);
  assert.match(source, /scheduleResetGeometryRestores\(generation:/);
  assert.match(source, /\[0\.15, 0\.35, 0\.65, 1\.0\]/);
  assert.match(source, /self\.resetGeometryRestoreGeneration == generation/);
  assert.match(source, /restorePrimaryWindowGeometry\(\)/);
  assert.match(source, /"webContentPID": oopWebContentPID/);
  assert.match(source, /"hostPID": oopHostPID/);
  assert.match(source, /"textValue": oopTextValue/);
  assert.match(source, /"textInputCount": oopTextInputCount/);
  assert.match(source, /"textChangeCount": oopTextChangeCount/);
  assert.match(source, /"lastTextEventTrusted":/);
  assert.match(source, /"lastEventTrusted":/);
  assert.match(source, /"hostLocalMouseDownCount":/);
  assert.match(source, /"hostLocalMouseUpCount":/);
});

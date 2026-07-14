import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const scriptPath = path.join(root, "scripts/display-geometry-probe.sh");
const swiftPath = path.join(root, "scripts/display-geometry-probe.swift");
const fixturePath = path.join(root, "fixtures/display/current.json");
const alignmentCasesPath = path.join(
  root,
  "fixtures/display/alignment-cases.json"
);

function convertedAppKitRect(rect, mainFrame) {
  return {
    x: rect.x - mainFrame.x,
    y: mainFrame.y + mainFrame.height - (rect.y + rect.height),
    width: rect.width,
    height: rect.height
  };
}

function assertSanitized(text) {
  assert.doesNotMatch(text, /\/Users\//);
  assert.doesNotMatch(text, /DELL|U2412M/i);
  assert.doesNotMatch(text, new RegExp(os.hostname().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(text, new RegExp(os.userInfo().username, "i"));

  const forbiddenKeys = new Set([
    "localizedName",
    "displaySerialNumber",
    "serialNumber",
    "vendorNumber",
    "modelNumber",
    "token",
    "modelToken",
    "mainDisplayToken",
    "displayTokens"
  ]);
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden fixture key ${key}`);
      visit(item);
    }
  };
  visit(JSON.parse(text));
}

function assertClose(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= 0.000_001,
    `${message}: expected ${expected}, got ${actual}`
  );
}

function assertVisibleGeometry(display) {
  const { framePoints: frame, visibleFramePoints: visible } =
    display.nsScreen;
  const insets = display.nsScreen.visibleInsetsPoints;

  assert.deepEqual(Object.keys(visible).sort(), [
    "height",
    "width",
    "x",
    "y"
  ]);
  assert.deepEqual(Object.keys(insets).sort(), [
    "bottom",
    "left",
    "right",
    "top"
  ]);
  for (const [key, value] of Object.entries({ ...visible, ...insets })) {
    assert.equal(Number.isFinite(value), true, `${display.alias}.${key}`);
  }
  for (const [edge, value] of Object.entries(insets)) {
    assert.ok(value >= 0, `${display.alias}.${edge} must be nonnegative`);
  }

  assert.ok(visible.width >= 0 && visible.height >= 0);
  assert.ok(visible.x >= frame.x);
  assert.ok(visible.y >= frame.y);
  assert.ok(visible.x + visible.width <= frame.x + frame.width);
  assert.ok(visible.y + visible.height <= frame.y + frame.height);
  assert.ok(insets.left + insets.right <= frame.width);
  assert.ok(insets.top + insets.bottom <= frame.height);

  assertClose(visible.x, frame.x + insets.left, `${display.alias}.visible.x`);
  assertClose(visible.y, frame.y + insets.bottom, `${display.alias}.visible.y`);
  assertClose(
    visible.width,
    frame.width - insets.left - insets.right,
    `${display.alias}.visible.width`
  );
  assertClose(
    visible.height,
    frame.height - insets.top - insets.bottom,
    `${display.alias}.visible.height`
  );
}

function deterministicGeometry(value) {
  return {
    ...value,
    displays: value.displays.map((display) => {
      const {
        visibleFramePoints: _visibleFramePoints,
        visibleInsetsPoints: _visibleInsetsPoints,
        ...stableScreen
      } = display.nsScreen;
      return {
        ...display,
        nsScreen: stableScreen
      };
    })
  };
}

function intersection(left, right) {
  const minX = Math.max(left.x, right.x);
  const minY = Math.max(left.y, right.y);
  const maxX = Math.min(left.x + left.width, right.x + right.width);
  const maxY = Math.min(left.y + left.height, right.y + right.height);
  if (maxX <= minX || maxY <= minY) {
    return null;
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function pointRectToPixelCrop(rect, displayBounds, scale, displayPixels) {
  const localMinX = (rect.x - displayBounds.x) * scale.x;
  const localMinY = (rect.y - displayBounds.y) * scale.y;
  const localMaxX = (rect.x + rect.width - displayBounds.x) * scale.x;
  const localMaxY = (rect.y + rect.height - displayBounds.y) * scale.y;
  const minX = Math.max(0, Math.floor(localMinX));
  const minY = Math.max(0, Math.floor(localMinY));
  const maxX = Math.min(displayPixels.width, Math.ceil(localMaxX));
  const maxY = Math.min(displayPixels.height, Math.ceil(localMaxY));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

test("checked fixture describes the current same-model dual-display geometry", async () => {
  const raw = await readFile(fixturePath, "utf8");
  assertSanitized(raw);
  const fixture = JSON.parse(raw);

  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.probe, "display-geometry");
  assert.equal(fixture.desktop.mainDisplayAlias, "display-1");
  assert.equal(fixture.desktop.screenCount, 2);
  assert.equal(fixture.desktop.onlineCoreGraphicsDisplayCount, 2);
  assert.deepEqual(fixture.desktop.unmatchedOnlineDisplayIDs, []);
  assert.equal(fixture.modelGroups.length, 1);
  assert.deepEqual(fixture.modelGroups[0], {
    allPixelSizesEqual: true,
    allPointSizesEqual: true,
    alias: "display-model-1",
    displayCount: 2,
    displayAliases: ["display-1", "display-2"]
  });

  const [main, left] = fixture.displays;
  assert.equal(main.alias, "display-1");
  assert.equal(main.name.modelAlias, "display-model-1");
  assert.equal(main.coreGraphics.isMain, true);
  assert.deepEqual(main.nsScreen.framePoints, {
    height: 1200,
    width: 1920,
    x: 0,
    y: 0
  });
  assert.deepEqual(main.coreGraphics.boundsPoints, main.nsScreen.framePoints);
  assert.deepEqual(main.coreGraphics.pixels, { height: 1200, width: 1920 });

  assert.equal(left.alias, "display-2");
  assert.equal(left.name.modelAlias, "display-model-1");
  assert.equal(left.coreGraphics.isMain, false);
  assert.deepEqual(left.nsScreen.framePoints, {
    height: 1200,
    width: 1920,
    x: -1920,
    y: 244
  });
  assert.deepEqual(left.coreGraphics.boundsPoints, {
    height: 1200,
    width: 1920,
    x: -1920,
    y: -244
  });
  assert.deepEqual(left.coreGraphics.pixels, { height: 1200, width: 1920 });
  assert.equal(fixture.desktop.hasNegativeAppKitCoordinates, true);
  assert.equal(fixture.desktop.hasNegativeCoreGraphicsCoordinates, true);
  assert.equal(
    fixture.displays.every(
      (display) => display.nsScreen.deviceDescription.isScreen === true
    ),
    true
  );
  for (const display of fixture.displays) {
    assertVisibleGeometry(display);
  }
});

test("AppKit frames flip into CoreGraphics bounds around the main display top", async () => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const main = fixture.displays.find(
    (display) => display.alias === fixture.desktop.mainDisplayAlias
  );

  for (const display of fixture.displays) {
    const converted = convertedAppKitRect(
      display.nsScreen.framePoints,
      main.nsScreen.framePoints
    );
    assert.deepEqual(
      converted,
      display.alignment.appKitFrameConvertedToCoreGraphicsPoints
    );
    assert.deepEqual(converted, display.coreGraphics.boundsPoints);
    assert.equal(display.alignment.appKitAndCoreGraphicsBoundsAgree, true);

    const { width, height } = display.coreGraphics.boundsPoints;
    const pixels = display.coreGraphics.pixels;
    assert.deepEqual(display.coreGraphics.pixelsPerPoint, {
      x: pixels.width / width,
      y: pixels.height / height
    });
    assert.equal(
      display.alignment.appKitBackingScaleMatchesCoreGraphicsPixels,
      true
    );
  }
});

test("synthetic mixed-scale fixture splits and rounds a cross-display crop per display", async () => {
  const fixture = JSON.parse(await readFile(alignmentCasesPath, "utf8"));
  const scenario = fixture.cases.mixedScaleCrossDisplayCrop;

  assert.equal(fixture.synthetic, true);
  for (const tile of scenario.displayTiles) {
    const clipped = intersection(
      scenario.globalRectPoints,
      tile.displayBoundsPoints
    );
    assert.deepEqual(clipped, tile.expectedIntersectionPoints);
    assert.deepEqual(
      pointRectToPixelCrop(
        clipped,
        tile.displayBoundsPoints,
        tile.pixelsPerPoint,
        tile.displayPixels
      ),
      tile.expectedCropPixels
    );
  }

  assert.notEqual(
    scenario.displayTiles[0].expectedCropPixels.width,
    scenario.displayTiles[1].expectedCropPixels.width
  );
});

test("screenshot mapping uses the actual image dimensions rather than an assumed display scale", async () => {
  const fixture = JSON.parse(await readFile(alignmentCasesPath, "utf8"));
  const scenario = fixture.cases.screenshotPointMapping;
  const scaleX = scenario.imagePixels.width / scenario.captureRectPoints.width;
  const scaleY = scenario.imagePixels.height / scenario.captureRectPoints.height;
  const pixelPoint = {
    x: (scenario.globalPoint.x - scenario.captureRectPoints.x) * scaleX,
    y: (scenario.globalPoint.y - scenario.captureRectPoints.y) * scaleY
  };

  assert.deepEqual(pixelPoint, scenario.expectedPixelPoint);
});

test("deterministic comparison ignores only volatile visible geometry", async () => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const changedVisible = structuredClone(fixture);
  changedVisible.displays[0].nsScreen.visibleFramePoints.y -= 3;
  changedVisible.displays[0].nsScreen.visibleFramePoints.height += 3;
  changedVisible.displays[0].nsScreen.visibleInsetsPoints.bottom -= 3;

  assert.deepEqual(
    deterministicGeometry(changedVisible),
    deterministicGeometry(fixture)
  );

  const changedFrame = structuredClone(changedVisible);
  changedFrame.displays[0].nsScreen.framePoints.height -= 1;
  assert.notDeepEqual(
    deterministicGeometry(changedFrame),
    deterministicGeometry(fixture)
  );
});

test("probe source is read-only and excludes AX, screenshot, input, and Sky paths", async () => {
  const [swiftSource, shellSource] = await Promise.all([
    readFile(swiftPath, "utf8"),
    readFile(scriptPath, "utf8")
  ]);
  const source = `${swiftSource}\n${shellSource}`;

  assert.match(swiftSource, /NSScreen\.screens/);
  assert.match(swiftSource, /CGDisplayBounds/);
  assert.match(swiftSource, /CGDisplayPixelsWide/);
  assert.doesNotMatch(source, /AXUIElement|kAXPositionAttribute|kAXSizeAttribute/);
  assert.doesNotMatch(source, /ScreenCaptureKit|SCScreenshot|SCStream/);
  assert.doesNotMatch(source, /CGEventPost|CGEventCreateMouseEvent|CGWarpMouseCursorPosition/);
  assert.doesNotMatch(source, /computeruse\.sock|SkyComputerUse|@oai\/sky/);
});

test(
  "live probe has stable topology, sanitized snapshots, and atomic writes",
  { skip: process.platform !== "darwin", timeout: 90_000 },
  async (t) => {
    const first = await execFileAsync("bash", [scriptPath], {
      cwd: root,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    const second = await execFileAsync("bash", [scriptPath], {
      cwd: root,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });

    assert.equal(first.stderr, "");
    assert.equal(second.stderr, "");
    assertSanitized(first.stdout);
    assertSanitized(second.stdout);

    const checked = JSON.parse(await readFile(fixturePath, "utf8"));
    const live = JSON.parse(first.stdout);
    const repeated = JSON.parse(second.stdout);
    assert.deepEqual(
      deterministicGeometry(live),
      deterministicGeometry(repeated)
    );
    assert.deepEqual(
      deterministicGeometry(live),
      deterministicGeometry(checked)
    );
    for (const display of live.displays) {
      assertVisibleGeometry(display);
    }
    for (const display of repeated.displays) {
      assertVisibleGeometry(display);
    }

    assert.equal(live.safety.readOnly, true);
    assert.equal(live.safety.computerUseSocketContacted, false);
    assert.equal(live.safety.computerUseActionsInvoked, false);
    assert.equal(live.safety.accessibilityQueried, false);
    assert.equal(live.safety.screenshotsCaptured, false);
    assert.equal(live.safety.windowMetadataCollected, false);
    assert.equal(live.safety.serialNumbersCollected, false);
    assert.equal(live.safety.rawLocalizedNamesPersisted, false);
    assert.equal(live.safety.hostMetadataCollected, false);

    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "display-geometry-test-")
    );
    t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
    const outputPath = path.join(temporaryDirectory, "geometry.json");
    await execFileAsync("bash", [scriptPath, "--out", outputPath], {
      cwd: root,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    const writtenRaw = await readFile(outputPath, "utf8");
    assertSanitized(writtenRaw);
    const written = JSON.parse(writtenRaw);
    assert.deepEqual(
      deterministicGeometry(written),
      deterministicGeometry(live)
    );
    for (const display of written.displays) {
      assertVisibleGeometry(display);
    }
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  }
);

test(
  "parallel fixture writers never expose partial JSON",
  { skip: process.platform !== "darwin", timeout: 30_000 },
  async (t) => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "display-geometry-atomic-")
    );
    t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));

    const fakeBin = path.join(temporaryDirectory, "bin");
    const outputPath = path.join(temporaryDirectory, "geometry.json");
    await mkdir(fakeBin);
    await writeFile(
      path.join(fakeBin, "xcrun"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '{"schemaVersion":1,"writer":"%s","values":[' "\${PROBE_WRITER:?}"
for value in $(seq 1 200); do
  if [[ "$value" -gt 1 ]]; then printf ','; fi
  printf '%s' "$value"
  if [[ "$value" -eq 100 ]]; then sleep 0.1; fi
done
printf ']}\\n'
`,
      { mode: 0o700 }
    );
    await writeFile(
      outputPath,
      '{"schemaVersion":1,"writer":"old","values":[]}\n',
      { mode: 0o600 }
    );

    const writerPath = [
      fakeBin,
      path.dirname(process.execPath),
      "/usr/bin",
      "/bin"
    ].join(path.delimiter);
    const writers = ["alpha", "beta"].map((writer) =>
      spawn("bash", [scriptPath, "--out", outputPath], {
        cwd: root,
        env: {
          ...process.env,
          PATH: writerPath,
          PROBE_WRITER: writer
        },
        stdio: ["ignore", "pipe", "pipe"]
      })
    );

    let running = writers.length;
    const exits = writers.map(
      (child) =>
        new Promise((resolve, reject) => {
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk) => {
            stdout += chunk;
          });
          child.stderr.on("data", (chunk) => {
            stderr += chunk;
          });
          child.once("error", reject);
          child.once("exit", (code, signal) => {
            running -= 1;
            resolve({ code, signal, stdout, stderr });
          });
        })
    );

    while (running > 0) {
      const snapshot = JSON.parse(await readFile(outputPath, "utf8"));
      assert.ok(["old", "alpha", "beta"].includes(snapshot.writer));
      if (snapshot.writer !== "old") {
        assert.equal(snapshot.values.length, 200);
        assert.equal(snapshot.values[0], 1);
        assert.equal(snapshot.values.at(-1), 200);
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    for (const result of await Promise.all(exits)) {
      assert.equal(result.code, 0, result.stderr || String(result.signal));
      assert.match(result.stdout, /wrote sanitized display geometry fixture/);
      assert.equal(result.stderr, "");
    }

    const finalFixture = JSON.parse(await readFile(outputPath, "utf8"));
    assert.ok(["alpha", "beta"].includes(finalFixture.writer));
    assert.equal(finalFixture.values.length, 200);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.deepEqual(
      (await readdir(temporaryDirectory)).filter((entry) =>
        entry.includes(".tmp.")
      ),
      []
    );
  }
);

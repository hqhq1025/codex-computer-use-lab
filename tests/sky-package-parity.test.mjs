import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SKY_PACKAGE_ROOT } from "../scripts/sky-client-wire-probe.mjs";

const macRoot = `${SKY_PACKAGE_ROOT}/dist/project/cua/sky_js/src/targets/mac`;

test("app-specific instructions are injected once per app and skipped for Numbers", async () => {
  const { window_result } = await import(
    `${pathToFileURL(`${macRoot}/window_result.js`).href}?parity=${Date.now()}`
  );
  const response = {
    app: { bundleIdentifier: "com.example.instructions" },
    appSpecificInstructions: "fixture instructions",
    skyshot: {
      text: "fixture tree",
      screenshot: null
    }
  };
  const seen = new Set();

  const first = await window_result(
    "com.example.instructions",
    response,
    seen
  );
  const second = await window_result(
    "com.example.instructions",
    response,
    seen
  );
  assert.match(first.text, /<app_specific_instructions>/);
  assert.doesNotMatch(second.text, /<app_specific_instructions>/);

  const numbers = await window_result(
    "com.apple.iWork.Numbers",
    {
      ...response,
      app: { bundleIdentifier: "com.apple.iWork.Numbers" }
    },
    new Set()
  );
  assert.equal(numbers.text, "fixture tree");
});

test("errors d.ts declares formatOSStatus while runtime omits it", async () => {
  const declaration = await readFile(`${macRoot}/errors.d.ts`, "utf8");
  const runtime = await import(
    `${pathToFileURL(`${macRoot}/errors.js`).href}?parity=${Date.now()}`
  );

  assert.match(declaration, /formatOSStatus/);
  assert.equal("formatOSStatus" in runtime, false);
  assert.deepEqual(Object.keys(runtime).sort(), [
    "ServerErrorCode",
    "SkyComputerUseError",
    "SkyComputerUseTransportError"
  ]);
});

test("mac create_client ignores options and exposes only the public facade", async () => {
  const { create_client } = await import(
    `${pathToFileURL(`${macRoot}/create_client.js`).href}?parity=${Date.now()}`
  );
  const first = create_client({
    apiVersion: "ignored",
    timeoutSeconds: 0.001,
    codexMetadata: { ignored: true }
  });
  const second = create_client();

  assert.deepEqual(Object.keys(first).sort(), Object.keys(second).sort());
  assert.deepEqual(Object.keys(first).sort(), [
    "click",
    "drag",
    "get_app_state",
    "list_apps",
    "perform_secondary_action",
    "press_key",
    "scroll",
    "select_text",
    "set_value",
    "type_text"
  ]);
  assert.equal("startApp" in first, false);
});

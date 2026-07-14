import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { UrlPolicyModel } from "../lib/url-policy-behavior-model.mjs";
import {
  runNativeUrlPolicyProbe
} from "../scripts/native-url-policy-probe.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/native/url-policy.json", import.meta.url),
    "utf8"
  )
);

test("live URL policy static probe reproduces the checked fixture", async () => {
  assert.deepEqual(await runNativeUrlPolicyProbe(), fixture);
  assert.equal(fixture.contracts.checkerFailureBehavior, "fail-open");
  assert.equal(fixture.contracts.blockedUrlErrorCode, -10015);
});

test("native apps bypass URL policy even when they expose a URL", async () => {
  let calls = 0;
  const model = new UrlPolicyModel({
    checker: async () => {
      calls += 1;
      return false;
    }
  });
  const result = await model.observe({
    isWebBrowser: false,
    url: "https://blocked.invalid/"
  });
  assert.equal(result.blocked, false);
  assert.equal(calls, 0);
  assert.doesNotThrow(() => model.assertActionAllowed());
});

test("blocked browser URL stops subsequent action with -10015", async () => {
  const model = new UrlPolicyModel({
    checker: async (url) => !url.includes("blocked")
  });
  await model.observe({
    isWebBrowser: true,
    url: "https://allowed.invalid/"
  });
  assert.doesNotThrow(() => model.assertActionAllowed());
  await model.observe({
    isWebBrowser: true,
    url: "https://blocked.invalid/"
  });
  assert.throws(
    () => model.assertActionAllowed(),
    (error) => error.code === -10015 && error.errorName === "blockedURL"
  );
});

test("checker failure is fail-open and TTL avoids repeated checks", async () => {
  let calls = 0;
  let now = 1000;
  const model = new UrlPolicyModel({
    now: () => now,
    ttlMilliseconds: 100,
    checker: async () => {
      calls += 1;
      throw new Error("synthetic checker failure");
    }
  });
  await model.observe({
    isWebBrowser: true,
    url: "https://example.invalid/"
  });
  await model.observe({
    isWebBrowser: true,
    url: "https://example.invalid/"
  });
  assert.equal(calls, 1);
  assert.doesNotThrow(() => model.assertActionAllowed());
  now += 101;
  await model.observe({
    isWebBrowser: true,
    url: "https://example.invalid/"
  });
  assert.equal(calls, 2);
});

test("stale allowed response cannot overwrite a newer blocked generation", async () => {
  let resolveAllowed;
  const allowed = new Promise((resolve) => {
    resolveAllowed = resolve;
  });
  const model = new UrlPolicyModel({
    checker: async (url) =>
      url.includes("old") ? allowed : false
  });
  const oldRequest = model.observe({
    isWebBrowser: true,
    url: "https://old.invalid/"
  });
  await model.observe({
    isWebBrowser: true,
    url: "https://new.invalid/"
  });
  resolveAllowed(true);
  await oldRequest;
  assert.throws(
    () => model.assertActionAllowed(),
    (error) => error.code === -10015
  );
});

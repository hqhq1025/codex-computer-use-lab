#!/usr/bin/env node

import net from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  FIXTURE_APP,
  startMockSkyService
} from "./mock-sky-service.mjs";

export const PLUGIN_ROOT =
  "/Users/haoqing/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000387";
export const WRAPPER_PATH = path.join(
  PLUGIN_ROOT,
  "scripts/computer-use-client.mjs"
);
export const NODE_MODULES_ROOT =
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules";
export const POLICY_MODULE_PATH = path.join(
  NODE_MODULES_ROOT,
  "@oai",
  "sky",
  "dist",
  "project",
  "cua",
  "sky_js",
  "src",
  "targets",
  "mac",
  "computer-use-policy.js"
);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function createNativePipeShim(expectedSocketPath) {
  return {
    createConnection(requestedSocketPath) {
      if (requestedSocketPath !== expectedSocketPath) {
        throw new Error(`Refusing unexpected socket: ${requestedSocketPath}`);
      }
      if (path.dirname(path.resolve(requestedSocketPath)) !== "/tmp") {
        throw new Error(`Refusing socket outside /tmp: ${requestedSocketPath}`);
      }
      return new Promise((resolve, reject) => {
        const socket = net.createConnection({ path: requestedSocketPath });
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    }
  };
}

function normalizeExchange(exchange) {
  const request = structuredClone(exchange.request);
  if (request.method === "request") {
    request.params.deadlineUnixMilliseconds = "<dynamic-unix-milliseconds>";
  }
  return {
    sequence: exchange.sequence,
    request,
    response: exchange.response
  };
}

export async function runWrapperPolicyProbe({
  outputPath,
  socketPath = `/tmp/codex-sky-wire-wrapper-${process.pid}-${Date.now()}.sock`,
  policyDecision = "allowed"
} = {}) {
  const service = await startMockSkyService({
    socketPath,
    responseOverrides: {
      ComputerUseIPCAppPolicyRequest: {
        allowPersistentApproval: true,
        decision: policyDecision,
        target: {
          appPath: "/Applications/Sky Wire Fixture.app",
          bundleIdentifier: FIXTURE_APP,
          displayName: "Sky Wire Fixture",
          risk: "low",
          warningSubtitle: null
        }
      }
    }
  });
  const previousNodeRepl = globalThis.nodeRepl;
  const previousSky = globalThis.sky;
  const runtimeSymbol = Symbol.for("openai.computer-use.runtime");
  const previousRuntime = Reflect.get(globalThis, runtimeSymbol);
  const elicitations = [];
  const responseMeta = [];
  let suspendedTimeoutCalls = 0;

  try {
    globalThis.nodeRepl = Object.freeze({
      env: Object.freeze({
        CODEX_HOME: "/tmp/codex-cu-lab-home",
        NODE_REPL_DISABLE_ANALYTICS: "1",
        NODE_REPL_NODE_MODULE_DIRS: NODE_MODULES_ROOT,
        SKY_CUA_NATIVE_PIPE_PATH: service.socketPath
      }),
      requestMeta: Object.freeze({
        "x-codex-turn-metadata": Object.freeze({
          session_id: "fixture-session",
          turn_id: "fixture-turn",
          source: "wrapper-policy-probe"
        })
      }),
      nativePipe: Object.freeze(createNativePipeShim(service.socketPath)),
      async createElicitation(request) {
        elicitations.push(structuredClone(request));
        return {
          action: "accept",
          content: {},
          _meta: { persist: "session" }
        };
      },
      setResponseMeta(meta) {
        responseMeta.push(structuredClone(meta));
      },
      async withSuspendedTimeout(callback) {
        suspendedTimeoutCalls += 1;
        return callback();
      }
    });

    const wrapperUrl = `${pathToFileURL(WRAPPER_PATH).href}?probe=${Date.now()}`;
    const { setupComputerUseRuntime } = await import(wrapperUrl);
    const sky = await setupComputerUseRuntime({ globals: globalThis });
    const listedApps = await sky.list_apps();
    const responseMetaAfterListApps = structuredClone(responseMeta);

    if (policyDecision !== "allowed") {
      let policyError = null;
      try {
        await sky.click({
          app: FIXTURE_APP,
          element_index: 1
        });
      } catch (error) {
        policyError = {
          name: String(error?.name ?? "Error"),
          message: String(error?.message ?? error)
        };
      }
      const fixture = {
        schemaVersion: 1,
        mode: "policy-rejection",
        policyDecision,
        listedApps,
        approvalRequests: elicitations,
        responseMeta,
        responseMetaAfterListApps,
        policyError,
        exchanges: service.exchanges.map(normalizeExchange),
        safety: {
          realComputerUseSocketContacted: false,
          uiActionsExecuted: false,
          analyticsDisabled: true
        }
      };
      if (outputPath) {
        const absoluteOutput = path.resolve(outputPath);
        await mkdir(path.dirname(absoluteOutput), { recursive: true });
        await writeFile(absoluteOutput, `${JSON.stringify(fixture, null, 2)}\n`);
      }
      return fixture;
    }

    const mutableInput = {
      app: FIXTURE_APP,
      element_index: 1,
      click_count: 2,
      mouse_button: "right"
    };
    const clickPromise = sky.click(mutableInput);
    mutableInput.app = "com.example.mutated-after-call";
    mutableInput.element_index = 999;
    mutableInput.click_count = 99;
    await clickPromise;

    let getterRejected = false;
    const getterInput = {};
    Object.defineProperty(getterInput, "app", {
      enumerable: true,
      get() {
        return FIXTURE_APP;
      }
    });
    try {
      await sky.click(getterInput);
    } catch (error) {
      getterRejected = /plain data property/.test(String(error?.message));
    }

    const exchanges = service.exchanges.map(normalizeExchange);
    const policyExchange = exchanges.find(
      (exchange) =>
        exchange.request.params?.requestType ===
        "ComputerUseIPCAppPolicyRequest"
    );
    const actionExchange = exchanges.find(
      (exchange) =>
        exchange.request.params?.requestType ===
        "ComputerUseIPCAppPerformActionRequest"
    );

    const fixture = {
      schemaVersion: 1,
      source: {
        pluginRoot: PLUGIN_ROOT,
        wrapperPath: WRAPPER_PATH,
        wrapperSha256: await fileSha256(WRAPPER_PATH)
      },
      safety: {
        socketPath: "<temporary-/tmp-unix-socket>",
        realComputerUseSocketContacted: false,
        uiActionsExecuted: false,
        analyticsDisabled: true
      },
      approval: {
        requests: elicitations,
        responseMeta,
        responseMetaAfterListApps,
        suspendedTimeoutCalls
      },
      listApps: {
        result: listedApps,
        policyRequestCountBeforeClick: service.exchanges.filter(
          (exchange) =>
            exchange.request.params?.requestType ===
            "ComputerUseIPCAppPolicyRequest"
        ).length - 1,
        approvalRequestCountBeforeClick: 0
      },
      mutationTest: {
        callerObjectAfterCall: mutableInput,
        wireApp: actionExchange?.request.params.request.app ?? null,
        wireAction: actionExchange?.request.params.request.action ?? null,
        usesApprovedCanonicalAppPath:
          actionExchange?.request.params.request.app ===
          "/Applications/Sky Wire Fixture.app",
        preservedPreAwaitSnapshot:
          actionExchange?.request.params.request.action?.click?.at?.elementID?._0 ===
            "1" &&
          actionExchange?.request.params.request.action?.click?.clickCount === 2,
        getterRejected
      },
      policyRequest: policyExchange?.request ?? null,
      actionRequest: actionExchange?.request ?? null,
      exchanges
    };

    if (outputPath) {
      const absoluteOutput = path.resolve(outputPath);
      await mkdir(path.dirname(absoluteOutput), { recursive: true });
      await writeFile(absoluteOutput, `${JSON.stringify(fixture, null, 2)}\n`);
    }

    return fixture;
  } finally {
    globalThis.nodeRepl = previousNodeRepl;
    if (previousSky === undefined) {
      Reflect.deleteProperty(globalThis, "sky");
    } else {
      globalThis.sky = previousSky;
    }
    if (previousRuntime === undefined) {
      Reflect.deleteProperty(globalThis, runtimeSymbol);
    } else {
      Reflect.set(globalThis, runtimeSymbol, previousRuntime);
    }
    await service.close();
  }
}

export async function runPolicySnapshotProbe({
  socketPath = `/tmp/codex-sky-wire-policy-snapshot-${process.pid}-${Date.now()}.sock`
} = {}) {
  const service = await startMockSkyService({ socketPath });
  const previousNodeRepl = globalThis.nodeRepl;
  const responseMeta = [];
  const elicitations = [];
  try {
    globalThis.nodeRepl = Object.freeze({
      env: Object.freeze({
        NODE_REPL_DISABLE_ANALYTICS: "1",
        NODE_REPL_NODE_MODULE_DIRS: NODE_MODULES_ROOT,
        SKY_CUA_NATIVE_PIPE_PATH: service.socketPath
      }),
      requestMeta: Object.freeze({}),
      nativePipe: Object.freeze(createNativePipeShim(service.socketPath)),
      setResponseMeta(meta) {
        responseMeta.push(structuredClone(meta));
      },
      async createElicitation(request) {
        elicitations.push(structuredClone(request));
        return {
          action: "accept",
          content: {},
          _meta: { persist: "session" }
        };
      },
      async withSuspendedTimeout(callback) {
        return callback();
      }
    });

    const nested = { mutable: "before" };
    const input = {
      app: FIXTURE_APP,
      topLevel: "before",
      nested
    };
    let callbackObservation = null;
    const policyUrl = `${pathToFileURL(POLICY_MODULE_PATH).href}?probe=${Date.now()}`;
    const { withComputerUsePolicy } = await import(policyUrl);
    const policyPromise = withComputerUsePolicy(
      "snapshot-probe",
      input,
      async (approvedInput) => {
        callbackObservation = {
          app: approvedInput.app,
          topLevel: approvedInput.topLevel,
          nested: approvedInput.nested.mutable,
          topLevelFrozen: Object.isFrozen(approvedInput),
          nestedSameReference: approvedInput.nested === nested,
          nestedFrozen: Object.isFrozen(approvedInput.nested)
        };
        return null;
      }
    );
    input.app = "com.example.mutated-after-call";
    input.topLevel = "after";
    nested.mutable = "after";
    await policyPromise;

    return {
      callbackObservation,
      responseMeta,
      elicitations,
      exchanges: service.exchanges.map(normalizeExchange)
    };
  } finally {
    globalThis.nodeRepl = previousNodeRepl;
    await service.close();
  }
}

export async function runPostApprovalValidationProbe({
  socketPath = `/tmp/codex-sky-wire-post-approval-${process.pid}-${Date.now()}.sock`
} = {}) {
  const service = await startMockSkyService({ socketPath });
  const previousNodeRepl = globalThis.nodeRepl;
  const responseMeta = [];
  const elicitations = [];
  try {
    globalThis.nodeRepl = Object.freeze({
      env: Object.freeze({
        NODE_REPL_DISABLE_ANALYTICS: "1",
        NODE_REPL_NODE_MODULE_DIRS: NODE_MODULES_ROOT,
        SKY_CUA_NATIVE_PIPE_PATH: service.socketPath
      }),
      requestMeta: Object.freeze({}),
      nativePipe: Object.freeze(createNativePipeShim(service.socketPath)),
      setResponseMeta(meta) {
        responseMeta.push(structuredClone(meta));
      },
      async createElicitation(request) {
        elicitations.push(structuredClone(request));
        return {
          action: "accept",
          content: {},
          _meta: { persist: "session" }
        };
      },
      async withSuspendedTimeout(callback) {
        return callback();
      }
    });

    const wrapperUrl = `${pathToFileURL(WRAPPER_PATH).href}?postApproval=${Date.now()}`;
    const { setupComputerUseRuntime } = await import(wrapperUrl);
    const sky = await setupComputerUseRuntime({ globals: globalThis });
    let validationError = null;
    try {
      await sky.click({
        app: FIXTURE_APP,
        x: Number.NaN,
        y: 10
      });
    } catch (error) {
      validationError = String(error?.message ?? error);
    }

    return {
      elicitations,
      responseMeta,
      validationError,
      policyRequestCount: service.exchanges.filter(
        (exchange) =>
          exchange.request.params?.requestType ===
          "ComputerUseIPCAppPolicyRequest"
      ).length,
      actionRequestCount: service.exchanges.filter(
        (exchange) =>
          exchange.request.params?.requestType ===
          "ComputerUseIPCAppPerformActionRequest"
      ).length
    };
  } finally {
    globalThis.nodeRepl = previousNodeRepl;
    await service.close();
  }
}

export async function runMetadataLastWriterProbe({
  socketPath = `/tmp/codex-sky-wire-meta-last-writer-${process.pid}-${Date.now()}.sock`
} = {}) {
  const firstApp = "com.example.first-app";
  const secondApp = "com.example.second-app";
  const service = await startMockSkyService({
    socketPath,
    responseOverrides: {
      ComputerUseIPCAppPolicyRequest(message) {
        const bundleIdentifier = message.params.request.app;
        return {
          allowPersistentApproval: false,
          decision: "allowed",
          target: {
            appPath: `/Applications/${bundleIdentifier}.app`,
            bundleIdentifier,
            displayName: bundleIdentifier,
            risk: "low",
            warningSubtitle: null
          }
        };
      }
    }
  });
  const previousNodeRepl = globalThis.nodeRepl;
  let mergedMeta = {};
  try {
    globalThis.nodeRepl = Object.freeze({
      env: Object.freeze({
        NODE_REPL_DISABLE_ANALYTICS: "1",
        SKY_CUA_NATIVE_PIPE_PATH: service.socketPath
      }),
      requestMeta: Object.freeze({}),
      nativePipe: Object.freeze(createNativePipeShim(service.socketPath)),
      setResponseMeta(meta) {
        mergedMeta = {
          ...mergedMeta,
          ...structuredClone(meta)
        };
      },
      async createElicitation() {
        return {
          action: "accept",
          content: {},
          _meta: { persist: "session" }
        };
      },
      async withSuspendedTimeout(callback) {
        return callback();
      }
    });

    const wrapperUrl = `${pathToFileURL(WRAPPER_PATH).href}?lastWriter=${Date.now()}`;
    const { setupComputerUseRuntime } = await import(wrapperUrl);
    const sky = await setupComputerUseRuntime({ globals: globalThis });
    await sky.click({ app: firstApp, element_index: 1 });
    await sky.click({ app: secondApp, element_index: 2 });

    return {
      appOrder: [firstApp, secondApp],
      mergedMeta,
      actionWireApps: service.exchanges
        .filter(
          (exchange) =>
            exchange.request.params?.requestType ===
            "ComputerUseIPCAppPerformActionRequest"
        )
        .map((exchange) => exchange.request.params.request.app)
    };
  } finally {
    globalThis.nodeRepl = previousNodeRepl;
    await service.close();
  }
}

async function fileSha256(filePath) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function main() {
  const outputPath =
    argumentValue("--out") ?? "fixtures/wrapper-policy/captured.json";
  const fixture = await runWrapperPolicyProbe({ outputPath });
  process.stdout.write(
    `${JSON.stringify({
      outputPath: path.resolve(outputPath),
      approvalRequests: fixture.approval.requests.length,
      usesApprovedCanonicalAppPath:
        fixture.mutationTest.usesApprovedCanonicalAppPath,
      preservedPreAwaitSnapshot:
        fixture.mutationTest.preservedPreAwaitSnapshot,
      getterRejected: fixture.mutationTest.getterRejected,
      realComputerUseSocketContacted: false,
      uiActionsExecuted: false
    }, null, 2)}\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CLIENT_API_VERSION,
  REQUEST_TIMEOUT_SECONDS,
  SKY_NATIVE_PIPE_PATH,
  TURN_METADATA,
  runSkyWireProbe
} from "../scripts/sky-client-wire-probe.mjs";

const checkedInFixture = JSON.parse(
  await readFile(new URL("../fixtures/sky-wire/captured.json", import.meta.url), "utf8")
);
const probe = await runSkyWireProbe({ responseDelayMs: 8 });
const requestExchanges = probe.rawCapture.exchanges.filter(
  (exchange) => exchange.request.method === "request"
);

test("checked-in Sky wire fixture is stable", () => {
  assert.deepEqual(probe.fixture, checkedInFixture);
});

test("real Sky client sends the expected API version and turn metadata", () => {
  assert.equal(probe.rawCapture.exchanges[0].request.method, "ping");
  assert.equal(
    probe.rawCapture.exchanges[0].request.params.clientApiVersion,
    CLIENT_API_VERSION
  );

  for (const exchange of requestExchanges) {
    assert.equal(exchange.request.params.clientApiVersion, CLIENT_API_VERSION);
    assert.deepEqual(exchange.request.params.codexTurnMetadata, TURN_METADATA);
  }
});

test("every request gets a fresh timeout-relative deadline", () => {
  const timeoutMilliseconds = REQUEST_TIMEOUT_SECONDS * 1000;
  for (const exchange of requestExchanges) {
    const deadline = exchange.request.params.deadlineUnixMilliseconds;
    const observedBudget = deadline - exchange.receivedAtUnixMilliseconds;
    assert.equal(Number.isInteger(deadline), true);
    assert.ok(
      observedBudget > timeoutMilliseconds - 500 &&
        observedBudget <= timeoutMilliseconds,
      `deadline budget ${observedBudget}ms was not close to ${timeoutMilliseconds}ms`
    );
  }
});

test("MacNativePipeTransport serializes concurrently queued requests", () => {
  assert.equal(probe.fixture.serialization.connectionCount, 1);
  assert.equal(probe.fixture.serialization.maxInFlight, 1);
  assert.deepEqual(
    requestExchanges.map((exchange) => exchange.request.params.requestType),
    [
      "ComputerUseIPCListAppsRequest",
      "ComputerUseIPCAppPolicyRequest",
      "ComputerUseIPCAppGetSkyshotRequest",
      ...Array(8).fill("ComputerUseIPCAppPerformActionRequest")
    ]
  );
});

test("captured frames use a four-byte length prefix for the exact JSON bytes", () => {
  for (const exchange of probe.fixture.exchanges) {
    const requestPayloadBytes = Buffer.byteLength(
      JSON.stringify(
        probe.rawCapture.exchanges[exchange.sequence - 1].request
      ),
      "utf8"
    );
    const responsePayloadBytes = Buffer.byteLength(
      JSON.stringify(exchange.response),
      "utf8"
    );

    assert.equal(exchange.requestPayloadLengthBytes, requestPayloadBytes);
    assert.equal(exchange.requestFrameLengthBytes, requestPayloadBytes + 4);
    assert.equal(exchange.responsePayloadLengthBytes, responsePayloadBytes);
    assert.equal(exchange.responseFrameLengthBytes, responsePayloadBytes + 4);
  }
});

test("action union encoding matches the shipped Mac client", () => {
  assert.deepEqual(probe.fixture.actionEncodings, [
    {
      operation: "click(element)",
      action: {
        click: {
          at: { elementID: { _0: "1" } },
          clickCount: 2,
          mouseButton: 1
        }
      }
    },
    {
      operation: "click(coordinate)",
      action: {
        click: {
          at: { coordinate: { _0: [120.5, 64] } },
          clickCount: 1,
          mouseButton: 0
        }
      }
    },
    {
      operation: "setValue",
      action: {
        setValue: {
          elementID: "2",
          value: "Ada Lovelace"
        }
      }
    },
    {
      operation: "selectText",
      action: {
        selectText: {
          elementID: "2",
          prefix: "Ada ",
          selection: "cursor_after",
          suffix: " wrote",
          text: "Lovelace"
        }
      }
    },
    {
      operation: "scroll",
      action: {
        scroll: {
          at: { elementID: { _0: "3" } },
          direction: "down",
          pages: 2.5
        }
      }
    },
    {
      operation: "drag",
      action: {
        drag: {
          from: [10, 20],
          to: [310.25, 420.5]
        }
      }
    },
    {
      operation: "pressKey",
      action: {
        pressKey: {
          _0: "Control_L+Shift_L+p"
        }
      }
    },
    {
      operation: "typeText",
      action: {
        type: {
          _0: "hello from fixture"
        }
      }
    }
  ]);
});

test("shipped framing accepts exactly 8 MiB and rejects 8 MiB plus one byte", async () => {
  const {
    decodeMessageFrames,
    encodeMessageFrame
  } = await import(new URL(`file://${SKY_NATIVE_PIPE_PATH}`).href);
  const exactPayload = "x".repeat(8 * 1024 * 1024);
  const exactFrame = encodeMessageFrame(exactPayload);

  assert.equal(exactFrame.readUInt32LE(0), 8 * 1024 * 1024);
  assert.equal(exactFrame.length, 4 + 8 * 1024 * 1024);
  assert.throws(
    () => encodeMessageFrame(`${exactPayload}x`),
    /frame is too large: 8388609/
  );

  const first = decodeMessageFrames(exactFrame.subarray(0, 3));
  assert.deepEqual(first.messages, []);
  assert.equal(first.remainingData.length, 3);

  const completed = decodeMessageFrames(
    Buffer.concat([first.remainingData, exactFrame.subarray(3)])
  );
  assert.equal(completed.messages.length, 1);
  assert.equal(completed.messages[0].length, 8 * 1024 * 1024);
  assert.equal(completed.remainingData.length, 0);

  const oversizedHeader = Buffer.alloc(4);
  oversizedHeader.writeUInt32LE(8 * 1024 * 1024 + 1, 0);
  assert.throws(
    () => decodeMessageFrames(oversizedHeader),
    /frame is too large: 8388609/
  );
});

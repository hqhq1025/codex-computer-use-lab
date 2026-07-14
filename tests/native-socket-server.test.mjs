import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/native/socket-server.json", import.meta.url),
    "utf8"
  )
);
const binaryPath =
  `${process.env.HOME}/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService`;

test("socket-server fixture pins the current native binary", async () => {
  const hash = createHash("sha256")
    .update(await readFile(binaryPath))
    .digest("hex");
  assert.equal(hash, fixture.artifact.sha256);
  assert.equal(
    fixture.artifact.uuid,
    "9E40FA2F-FC6C-3EE2-824A-E4975CA022AD"
  );
});

test("native socket connection uses an 8 MiB cap and 30 second I/O timeout", () => {
  assert.equal(fixture.limits.maximumFrameBytes, 8 * 1024 * 1024);
  assert.equal(fixture.limits.exactlyMaximumIsAllowed, true);
  assert.equal(fixture.limits.ioTimeoutSeconds, 30);
  assert.deepEqual(fixture.limits.ioTimeoutCovers, [
    "frame_read",
    "response_write"
  ]);
  assert.equal(fixture.limits.processFrameCoveredByIoTimeout, false);
});

test("one connection is serial while up to sixteen connections can run in parallel", () => {
  assert.equal(
    fixture.concurrency.singleConnection,
    "strict_read_process_write_serial_loop"
  );
  assert.equal(fixture.concurrency.pipelinedRequestsOnOneConnection, false);
  assert.equal(fixture.limits.maximumConcurrentConnections, 16);
});

test("oversize inbound frames close silently while handler responses become -32002", () => {
  assert.equal(fixture.oversize.inbound.bodyReadOrAllocated, false);
  assert.equal(fixture.oversize.inbound.processFrameCalled, false);
  assert.equal(fixture.oversize.inbound.jsonRpcErrorWritten, false);
  assert.equal(fixture.oversize.inbound.effect, "connection_closed");
  assert.equal(
    fixture.oversize.handlerResponse.replacementErrorCode,
    -32002
  );
  assert.equal(
    fixture.oversize.handlerResponse.replacementMessage,
    "Response exceeds maximum frame size"
  );
});

test("connection cleanup avoids a strong owner cycle", () => {
  assert.equal(fixture.retention.activeMapStronglyOwnsTasks, true);
  assert.equal(fixture.retention.taskStronglyOwnsConnection, true);
  assert.equal(fixture.retention.onCloseWeaklyCapturesOwner, true);
  assert.equal(fixture.retention.stopShutsDownActiveFileDescriptors, true);
});

test("socket-server evidence is static only", () => {
  assert.deepEqual(fixture.safety, {
    staticOnly: true,
    serviceStarted: false,
    socketConnected: false,
    requestSent: false
  });
});

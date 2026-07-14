import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/guardian/private-protocol.json", import.meta.url),
    "utf8"
  )
);
const report = await readFile(
  new URL(
    "../docs/17-lock-screen-guardian-authorization-private-protocol.md",
    import.meta.url
  ),
  "utf8"
);

const servicePath =
  `${process.env.HOME}/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService`;
const guardianPath =
  `${process.env.HOME}/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/CUALockScreenGuardian.app/Contents/MacOS/CUALockScreenGuardian`;
const pluginPath =
  `${process.env.HOME}/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/Codex Computer Use Installer.app/Contents/Resources/CodexComputerUseAuthorizationPlugin.bundle/Contents/MacOS/CodexComputerUseAuthorizationPlugin`;
const parentConstraintPath =
  `${process.env.HOME}/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/CUALockScreenGuardian.app/Contents/Resources/CUALockScreenGuardian_Parent.coderequirement`;

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

test("guardian private protocol fixture pins the current signed artifacts", async () => {
  assert.equal(
    await sha256(servicePath),
    fixture.artifact.serviceSha256
  );
  assert.equal(
    await sha256(guardianPath),
    fixture.artifact.guardianSha256
  );
  assert.equal(
    await sha256(pluginPath),
    fixture.artifact.authorizationPluginSha256
  );
  assert.equal(
    await sha256(parentConstraintPath),
    fixture.artifact.parentConstraintSha256
  );
});

test("guardian XPC is thread-bound without a turn id or heartbeat", () => {
  assert.deepEqual(
    fixture.guardian.commands.map((command) => command.name),
    [
      "beginUnlockGuardForThreadID:withReply:",
      "completeUnlockGuardForThreadID:didUnlock:",
      "retainAutoUnlockedLeaseForThreadID:",
      "releaseAutoUnlockedLeaseForThreadID:"
    ]
  );
  assert.equal(fixture.guardian.turnIdPresent, false);
  assert.equal(fixture.guardian.heartbeatPresent, false);
  assert.equal(fixture.guardian.lastLeaseReleaseRelocks, true);
  assert.equal(fixture.guardian.connectionLossRelocks, true);
  assert.equal(fixture.guardian.acceptPathAuthenticatesPeer, false);
  assert.equal(fixture.guardian.acceptPolicy, "first_connection_wins");
  assert.equal(fixture.guardian.launchMechanism.includes("nstask"), true);
  assert.equal(fixture.guardian.appleEventBootstrapUsed, false);
  assert.equal(
    fixture.guardian.parentCodeRequirement.validatedByCodesign,
    true
  );
  assert.equal(
    fixture.guardian.parentCodeRequirement.embeddedInGuardianSignature,
    false
  );
  assert.equal(
    fixture.guardian.parentCodeRequirement.xpcPeerAuthRole,
    false
  );
});

test("authorization broker is a bodyless one-shot ASCII protocol with asymmetric auth", () => {
  assert.equal(fixture.authorizationBroker.requestBody, null);
  assert.deepEqual(fixture.authorizationBroker.replies, [
    "ALLOW\n",
    "DENY\n"
  ]);
  assert.equal(
    fixture.authorizationBroker.pluginAuthenticatesService.localPeerToken,
    true
  );
  assert.equal(
    fixture.authorizationBroker.serviceAuthenticatesClientProven,
    false
  );
  assert.equal(fixture.authorizationBroker.attemptIsOneShot, true);
});

test("guardian report keeps security unknowns explicit", () => {
  assert.match(report, /first-connection-wins/);
  assert.match(report, /launch-constraint-parent/);
  assert.match(report, /denial of service/);
  assert.match(report, /不是 protobuf、JSON、plist/);
  assert.equal(fixture.safety.installerExecuted, false);
  assert.equal(fixture.safety.authorizationDbModified, false);
  assert.equal(fixture.safety.privateEndpointConnected, false);
});

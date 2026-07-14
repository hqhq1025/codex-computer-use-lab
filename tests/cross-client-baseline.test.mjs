import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/real-cua/cross-client-baseline.json", import.meta.url),
    "utf8"
  )
);

test("fresh node_repl client reuses the service-global native AX baseline", () => {
  assert.equal(fixture.phaseA.observation.kind, "full");
  assert.equal(fixture.phaseA.markerPresentAtEnd, true);
  assert.equal(fixture.phaseB.phaseAMarkerPresentAtStart, false);
  assert.equal(fixture.phaseB.observation.kind, "no-change-diff");
  assert.deepEqual(fixture.conclusion, {
    clientBoundaryCrossed: true,
    phaseBHadNoClientLocalFullObservation: true,
    phaseBFirstObservationWasNativeNoChangeDiff: true,
    nativeLastAXTreeSharedAcrossNodeReplKernels: true
  });
});

test("cross-client experiment stayed observation-only and non-persistent", () => {
  assert.deepEqual(fixture.safety, {
    targetRestrictedToSyntheticApp: true,
    observationsOnly: true,
    uiActionsExecuted: false,
    persistentApprovalAllowed: false,
    externalCommunicationAllowed: false
  });
  for (const phase of [fixture.phaseA, fixture.phaseB]) {
    assert.equal(phase.approvalStoreBefore.present, false);
    assert.equal(phase.approvalStoreAfter.present, false);
    assert.equal(
      phase.approvalChecks.every(
        (check) => check.store.checked && check.store.present === false
      ),
      true
    );
  }
});

test("cross-client fixture is provenance-pinned", () => {
  assert.match(
    fixture.provenance.labAppExecutable.sha256,
    /^[a-f0-9]{64}$/
  );
  assert.equal(
    fixture.provenance.skyServiceExecutable.sha256,
    "27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58"
  );
  assert.equal(
    fixture.provenance.wrapper.sha256,
    "6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f"
  );
});

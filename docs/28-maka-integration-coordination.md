# Maka Computer Use Integration Coordination

Updated: 2026-07-14

This is the handoff document for Codex sessions working on the Maka Computer
Use integration. Reverse-engineering sessions own evidence in this lab.
Implementation sessions own code and pull requests in `maka-agent`.

## Confirmed Product Boundary

- Treat the native target identity as canonical app installation path plus the
  current live process. Do not key long-lived state only by bundle ID, PID,
  conversation, or socket.
- Keep observation identity, action freshness, and permission identity
  separate. A previous approval does not make a stale observation executable.
- A request accepted before a deadline can complete after the client times out.
  Never replay a delivered action automatically.
- Preserve `outcome_unknown` when delivery may have occurred. Re-observation is
  required, but the model-facing result must continue to forbid blind retry.
- Background-safe execution currently means AX, target-owned Electron/CDP, and
  capture paths whose effect is verified. Compatibility CGEvent mouse and
  keyboard dispatch remains disabled by default.
- `supported:true, ok:false` must not fall through to a pixel action.
- App, window, page, display, frame, and process-generation bindings must be
  revalidated immediately before dispatch.
- Computer Use must be unavailable to models that cannot consume screenshots.

Primary evidence:

- `docs/08-wrapper-policy-and-toctou.md`
- `docs/18-v5-dynamic-edge-cases.md`
- `docs/23-plugin-to-model-input-output-contract.md`
- `docs/24-oop-webcontent-and-cross-client-dynamics.md`
- `docs/25-timeout-deadline-url-policy-and-lifecycle.md`
- `docs/26-application-target-identity-resolution-and-process-lifetime.md`

## Current Pull Request State

| PR | State | Disposition |
|---|---|---|
| #857 foundation | merged 2026-07-13 | baseline |
| #892 runtime leases | merged 2026-07-13 | baseline; review P2s still need a later runtime hardening pass |
| #893 executor | merged 2026-07-13 | do not restore; actionable final-review items moved to #910 |
| #910 executor hardening | merged 2026-07-14 | executor findings and #905 P2 follow-ups are on main |
| #911 Runtime termination hardening | merged 2026-07-14 | turn-scoped queued fence, post-call host-read lease checks, and first terminal cause |
| #913 provider evidence and real-model loop | merged 2026-07-14 | fixture/scenarios, provider matrix, launcher, OpenAI L0/L1 evidence |
| #921 unknown outcome projection | merged 2026-07-14 | preserves backend `outcome_unknown` while fencing Runtime for re-observation |
| #922 delivered executor state | merged 2026-07-14 | preserves delivery uncertainty after AX/CDP writes or post-dispatch screenshot failure |
| #924 extended real AX evidence | merged 2026-07-14 | OpenAI/Anthropic AppKit semantic scenarios and protocol coverage |
| #926 evidence hardening | open | unified sanitizer, full evidence envelope, owned-action/budget/dispatch gates, fixture cleanup |
| #928 failed host-read fence | open, CI green | discards late failed cursor/wait reads after stop |
| #929 post-delivery verification | open | preserves `outcome_unknown` for all AX/CDP verification request failures |
| #930 coordinate identity fingerprint | open, CI green | excludes dynamic AX label/value content while retaining structural coordinate identity |
| #931 initial Electron page identity | open, CI green | bound Electron pointer/drag actions fail closed when their observation had no page identity |
| #932 native keyboard target reflow | open, CI green | uniquely refetches the clicked AX editable field instead of reusing its old screen coordinate |
| #933 Electron text element identity | open | binds text insertion to the exact connected and focused DOM element established by the semantic click |
| #903 restart E2E | open, conflicting | superseded in part by the AX-only soak in #905; extract only unique process-restart proof |
| #905 input guard | merged 2026-07-14 | production guard, default-off compatibility input, and cumulative safety stack are on main |
| #895 Desktop wiring | merged 2026-07-14 | Desktop supplies the physical-input guard and production Computer Use wiring |
| #896 presentation | merged 2026-07-14 | presentation lifecycle is now on main |
| #897 host events | open, conflicting | preserve `outcome_unknown` and absorbing terminal states before restack |
| #898 real E2E | open, conflicting | replace external hard-coded fixture dependency and stale compatibility-input claims |

The merge order is no longer the original cumulative stack. Use independent
net diffs from current `main`:

```text
#910 executor hardening

#911 Runtime termination hardening

#897 host lifecycle mapping
  -> #898 reproducible guarded E2E
```

#903 should not block #905 if all unique restart-generation assertions are
ported into the AX-only #905 test. Close #903 as superseded after that evidence
is verified on the restacked branch.

## Real Model Gate

No model result counts as a Computer Use E2E result unless the report includes:

- provider, model, protocol, and exact tool surface;
- screenshot dimensions and coordinate transform;
- model latency, tool latency, presentation lag, action count, and retries;
- emitted action arguments after secret redaction;
- backend dispatch evidence and final fixture oracle;
- forbidden effects, including focus theft and physical-input interference;
- explicit classification of success, fail-closed, inconclusive, or
  `outcome_unknown`.

First paid run:

1. Use the isolated Codex CUA Lab app only.
2. Use a vision-capable configured model.
3. Start with observe-only.
4. Continue with one AX semantic mutation.
5. Do not enable compatibility CGEvent input.
6. Require fresh readback and preserve the full report artifact.

The existing `feat/cu-real-model-loop` worktree is not a runnable baseline: it
contains an unresolved merge conflict. `feat/cu-real-provider-matrix` contains
useful provider harness, action-budget, scenario, and sanitized-report work, but
it is based on an older cumulative stack and also carries Runtime state changes.
#913 extracts the fixture, scenario budget, sanitized report, and provider
matrix layers onto current main. The next validation branch should depend on
#913 and add only provider launcher/runtime wiring.

The first qualifying real-model run completed on 2026-07-14:

- OpenAI `gpt-5.4`;
- production Maka Desktop/Runtime and cua-driver;
- one app-scoped `observe`, 1117 ms;
- full run 7502 ms, terminal `complete/end_turn`;
- fixture verification passed with zero interactions;
- sanitized report stored at
  `fixtures/model-tool-surface/maka-openai-gpt-5.4-l0-observe-real-runtime.json`.

The run also found and fixed an OpenAI Responses continuation bug: default
server-side storage produced an orphan `item_reference` on the tool-result
request. Maka now sends OpenAI Responses with `store:false`, keeping the
function call and result inline.

The first real AX mutation also passed:

- OpenAI `gpt-5.4`, `l1-single-click`;
- two observations and one `click_element`;
- semantic click 1445 ms, full run 26023 ms;
- primary count 1, danger count 0, duplicate count 0;
- no coordinate or compatibility CGEvent actions;
- terminal `complete/end_turn`;
- evidence:
  `fixtures/model-tool-surface/maka-openai-gpt-5.4-l1-ax-click-real-runtime.json`.

## Session Ownership

Reverse-engineering session:

- add evidence and fixtures to this lab;
- update this document only when a confirmed boundary changes;
- do not edit Maka implementation branches.

Maka implementation session:

- read this document before changing Computer Use;
- update the PR table after every merge, close, or restack;
- keep one independent concern per PR;
- run focused tests, full typecheck, and the applicable guarded E2E;
- do not claim Codex parity where Maka intentionally fails closed.

Real-model validation session:

- use a dedicated worktree;
- consume merged or explicitly pinned implementation commits;
- write reports without credentials, screenshots, private app content, or raw
  provider errors;
- report gaps back here before implementation work starts.

## Immediate Queue

1. Review and merge #926, #928, #929, #930, #931, #932, and #933.
2. Replace remaining author-local fixture paths in the merged legacy E2E
   harnesses with repository-owned or hash-pinned fixtures.
3. Rebase the active real-model modal/secondary-window validation branch after
   its current uncommitted work is complete, then pin it to the merged executor
   identity baseline including #931, #932, and #933.
4. Follow up merged review findings: failed host reads completing after stop
   must not bypass the stop fence; every post-delivery verification exception
   must preserve `outcome_unknown`.
5. Expand the provider matrix with the merged #924 evidence.

## Review Dispositions

The merged #893/#910 review comments are not all merge requirements:

- compatibility coordinate input remains disabled by default intentionally; do
  not restore CGEvent dispatch merely to expose a larger tool surface;
- process-wide action serialization is currently a throughput limitation, not
  evidence of wrong-target execution, and does not justify a risky queue
  redesign without a measured concurrency requirement;
- dynamic coordinate fingerprints, post-delivery state, stale observation
  storage, missing initial Electron page identity, and native keyboard target
  reflow have concrete follow-up PRs;
- #933 gives Electron text a document-local element handle and requires the
  exact object to remain connected, editable, and focused before and after
  insertion. Same PID, window, and page identity alone remains insufficient.

## Active Validation Worktree

`cu-real-ax-provider-runner-upstream` currently contains active uncommitted work
for modal and secondary-window scenarios. Do not rebase or edit it from another
session while those changes are present. At the 2026-07-14 handoff it was three
commits behind and two commits ahead of `origin/main`; its working tree modified
the real AX model E2E docs, launcher, harness, contract test, and package scripts.
The owning validation session should commit or discard that work first, then
rebase and rerun against the merged executor identity PRs.

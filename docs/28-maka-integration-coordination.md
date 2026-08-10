# Maka Computer Use Integration Coordination

Updated: 2026-08-10

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
- `docs/22-native-ax-diff-refetch-and-instance-isolation.md`
- `docs/23-plugin-to-model-input-output-contract.md`
- `docs/24-oop-webcontent-and-cross-client-dynamics.md`
- `docs/25-timeout-deadline-url-policy-and-lifecycle.md`
- `docs/26-application-target-identity-resolution-and-process-lifetime.md`

## Current Pull Request State

Current August line:

| Repository / PR | State | Disposition |
|---|---|---|
| `maka-agent/maka-cu#2` | merged 2026-08-10; merge `058ee576` | WebContent trusted click, unique retained refetch, numeric slider, semantic scroll, doctor diagnostics, modal routing, stable AX revision ids, and bounded post-action differences |
| `maka-agent/maka-agent#2627` | merged 2026-08-10; merge `b62462a92` | pins `maka/base@058ee576` and integrates stable ids/difference rendering |
| `maka-agent/maka-cu#3` | merged 2026-08-10; merge `97ca3c3` | confirms press-driven window topology, waits for new AX windows, wraps native press in synthetic focus, and requests exact previous-frontmost restoration |
| `maka-agent/maka-agent#2631` | merged 2026-08-10; merge `0a9fc5c84` | pins `maka/base@97ca3c3` and records honest modal/foreground evidence |
| `maka-agent/maka-cu#4` | merged 2026-08-10; merge `4a9787d2` | uniquely refetches a direct renderer-owned binding after frame-only Web reflow; native AX frame changes and missing/ambiguous renderer replacements remain fail closed |
| `maka-agent/maka-agent#2638` | merged 2026-08-10; merge `221e63b00` | pins `maka/base@4a9787d2` and the prepared binary `e457a314...`; records source-bound exact-binary Web evidence |

Current verification:

- native source: `swift test` 326 tests, 26 explicit live-test skips, 0 failures;
- host Computer Use dist suite: 124/124;
- observation renderer source suite: 22/22;
- provenance suite: 7/7;
- Web/control CUA Lab: 10 consecutive passes, trusted DOM event, one mouse
  down/up pair, slider oracle 42, scroll oracle 76, zero wrong-target clicks,
  target remained background;
- final exact pinned-binary Web matrix: clean source merge
  `4a9787d2c7f2fbc6a29b33d691916c6b84543661`, binary SHA-256
  `e457a3143544ba8385c489e5259f206d9450feb1c692eb562413b41b9f38de21`,
  size 3269920, five complete runs, primary oracle 1, every OOP path
  `skylight_pid`, `MouseEvent.isTrusted=true`, one down/up pair, slider 42,
  scroll 76, zero stale wrong-target effects, and zero target-frontmost samples
  across all 30 scenario spans; minimum 91 samples/span, maximum 84 ms gap;
- integration verification: serial build, all-workspace typecheck, 192 script
  tests, and every serial workspace suite passed; required GitHub CI, e2e, and
  Windows baseline checks were green before #2638 merged;
- stable AX revision/difference evidence is native + hermetic host evidence, not
  a provider-model qualification cell;
- exact pinned-binary modal/secondary functional matrix passed 5 consecutive
  runs: app→sheet routing, exact secondary button/scroll/close, return to main,
  all 30 dispatch paths `ax_action`, scroll offset 140.
- high-frequency foreground safety failed: 1,738 target-frontmost samples across
  ten spans, minimum 189 samples/span, maximum 96 ms gap. Stage-level snapshots
  had hidden the transient focus theft.

The July table below is retained as the legacy foundation-stack record:

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

1. Fix transient foreground theft for native AX press, then rerun the exact
   pinned-binary aggregate matrix.
2. Complete stable signing, hardened runtime, notarization, and packaged-app
   verification; `distributionReady` remains false until all four are real.

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

Current implementation worktrees:

- `maka-cu-web`: clean, branch `codex/webcontent-native-actions`, head
  `40ba676`; source PR merged as `058ee576` on `maka/base`.
- `maka-agent-cu-web`: clean, branch `codex/cu-webcontent-integration`, head
  `d121d787d`; integration PR merged as `b62462a92`.
- `maka-cu-close-fix`: clean after commit, branch
  `codex/closed-target-outcome`, head `176bce6`; source PR #3 merged as
  `97ca3c3`.
- `maka-agent-cu-final-pin`: clean branch `codex/cu-window-transition-pin`,
  head `44dfef15e`; integration PR #2631 merged as `0a9fc5c84`.
- `maka-cu-web-reflow`: clean branch `codex/webcontent-frame-refetch`, source
  commit `d2382ac`; source PR #4 merged as `4a9787d2`.
- `maka-agent-cu-web-reflow-pin`: clean branch
  `codex/cu-webcontent-frame-refetch-pin`, head `cee52376e`; integration PR
  #2638 merged as `221e63b00`.
- `codex-computer-use-lab-web-text`: clean branch
  `codex/maka-web-text-fixture`, head `4e7c754`; adds the offline WKWebView text
  field, DOM input/change oracle, and the dedicated Maka Web text probe.
- `maka-cu-web-text`: clean branch `codex/webcontent-text-value`, head
  `a1582d2`; renderer-only set-value candidate with exact focus, full selection,
  renderer-PID text delivery, bounded readback, and unknown-outcome fencing.
- the original `maka-agent` worktree remains dirty with unrelated Desktop
  message-queue work and must not be reset, rebased, staged, or used for this
  Computer Use line.

The screen is currently locked. Modal/secondary functionality is qualified, but
the native background-focus gate remains open. The Web text candidate has 330
source tests with 26 explicit live skips and no failures, but its baseline and
candidate live probes are pending unlock; do not open or merge the source PR
until the DOM input oracle and foreground sentinel pass.

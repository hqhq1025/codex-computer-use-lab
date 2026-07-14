# Security, Permission, And IPC Threat Model

> 运行态补充：authorization broker pathname 曾在 listener FD 仍打开时被
> unlink；因此 socket 安全取证必须同时检查 filesystem、`lsof` 和 kernel Unix
> socket table。完整证据见 `16-service-process-lifecycle-and-retention.md`。

## Scope And Evidence Snapshot

This chapter covers the installed Codex Computer Use service and the read-only
collector in this lab. It does not prove that a real AX, ScreenCaptureKit, or
CGEvent action succeeds because the collector never sends a request to the real
CUA socket.

The live snapshot collected on 2026-07-12 describes native service
`26.710.1000387`:

- strict `codesign` verification passes;
- Gatekeeper reports a notarized Developer ID build from OpenAI team
  `2DC432GLL2`;
- Hardened Runtime is enabled;
- App Sandbox is not present;
- app-group and keychain-group entitlements are present;
- this build includes an embedded provisioning profile named `CUA Service`;
- Accessibility and Screen Recording are allowed in the system TCC database;
- the group container and IPC directory are `0700`, while the lock file and
  real CUA socket are `0600`;
- the lock-screen broker socket is `0666`, so its peer identity check is a
  required security boundary rather than optional defense in depth;
- the authorization plug-in is embedded and signed, but it is not installed in
  `/Library/Security/SecurityAgentPlugins` and is not referenced by
  `system.login.console`;
- no local requirements layer was found that proves
  `allow_locked_computer_use = true`.

These facts are versioned observations. A previous build may have different
entitlements or provisioning, and a later run may have different TCC or
lock-screen installation state.

## Assets And Adversaries

Protected assets include:

- user input, screenshots, AX text, selections, clipboard-adjacent content, and
  application state;
- the authority to synthesize input or change application state;
- app approvals and organization policy;
- trusted JavaScript loaded from Codex roots;
- IPC request integrity, thread association, and lock-screen authorization;
- logs and fixtures that may outlive a turn.

Relevant adversaries include:

- untrusted content displayed in a controlled application;
- a malicious or compromised process running as the same macOS user;
- a local process attempting to impersonate an IPC peer;
- a stale or replaced UI object between observation and action;
- a test double that is accidentally treated as proof of production behavior;
- an operator who collects overly broad logs or configuration during debugging.

## Layered Trust Model

### Layer 0: Artifact Provenance

The service, client, guardian, installer, and authorization plug-in are signed
by the same Team ID. The main service is notarized and uses Hardened Runtime.
The client and guardian ship parent requirement files containing the expected
Team ID.

This establishes artifact provenance, not runtime correctness. It does not make
AX text trustworthy and does not prevent a same-user process from modifying
separately loaded files below `~/.codex`.

### Layer 1: Managed Requirements And Lock State

`allow_locked_computer_use` is a requirements field, not a normal user
preference. The collector first reads only this exact boolean from:

```text
/etc/codex/requirements.toml
/etc/codex/managed_config.toml
```

It does not dump either file. It then starts a private stdio app-server, calls
only `configRequirements/read`, extracts
`computerUse.allowLockedComputerUse`, and terminates the child. This covers the
currently loaded requirements composition, including managed layers, without
writing the rest of the response. An absent or unreadable effective key is
reported as `unknown`, never as enabled.

Fail-closed rule:

```text
locked use is ready only when policy is proven true,
the authorization plug-in is installed,
and authorizationdb references the plug-in
```

The current snapshot does not satisfy those conditions.

### Layer 2: Model Context And AX Prompt Injection

AX text is high-bandwidth semantic input. Text such as "ignore earlier
instructions" can reach the model more directly than pixels and can be paired
with plausible button names, document content, or accessibility descriptions.

An application approval answers "may Codex operate this app?" It does not
answer "is text in this app authoritative?" Treat all AX and screenshot content
as untrusted data:

- never grant instruction priority to on-screen text;
- keep system, developer, and user intent outside the app-content channel;
- require explicit confirmation for credential, destructive, financial, or
  permission-changing actions;
- constrain data movement to the user-requested source and destination;
- re-observe after any unexpected navigation, dialog, or focus change.

### Layer 3: Persistent App Approval

The service binary contains `AppApprovalStore`, `PersistentApprovals`, and a
failure path for permanent persistence. The collector intentionally does not
read the approval store or enumerate approved apps.

Persistent approval is durable capability state. Its main risks are:

- a previously safe app later displays attacker-controlled content;
- a bundle identity remains approved across an app update or ownership change;
- an approval outlives the task that justified it;
- operators mistake approval for content trust.

Approval checks should bind to current bundle identity and policy, remain
revocable, and still require action-level safeguards. Sensitive apps should use
session approval or explicit per-action confirmation.

### Layer 4: `~/.codex` Trusted Root

The inspected `~/.codex`, `plugins`, plugin cache, and skills roots are owned by
the current user and are not group- or world-writable. They remain writable by
any process with that user's authority.

If trusted Node code is selected by path alone, a same-user writer can replace
code between approval and import. Stronger designs bind trust to:

- a signed plugin version root;
- a content hash or immutable file descriptor;
- provenance recorded at approval time;
- a prohibition on project-controlled writes into the trusted root.

V9 added dynamic proof: a temporary module placed directly under `~/.codex`
entered the trusted Node realm and could instantiate the packaged internal Mac
client. The module was constrained, hash pinned for the experiment, and
deleted afterward, but its success confirms that directory ownership and file
permissions are the effective capability boundary.

This is not merely a theoretical supply-chain concern. Any unintended write
primitive into the configured trusted root can become a native-pipe privilege
escalation inside node_repl.

The lab records only root metadata. It does not inventory trusted source or
copy it into fixtures.

### Layer 5: Observation Freshness, TOCTOU, And Stale Targets

Observation and action are separate operations. Between them, focus, window
ordering, DOM or AX hierarchy, selected account, URL, and dialog state can
change.

The native binary contains a refetch path for invalidated AX elements. It also
contains an ambiguity rejection path when multiple equivalent elements match.
That is the correct fail-closed behavior: ambiguity must cause re-observation,
not a best-guess click.

Coordinates are weaker. This inspection did not establish a protocol-enforced
binding between a coordinate and the screenshot revision that produced it.
Therefore:

- prefer stable element identity over coordinates;
- use coordinates only against the immediately preceding observation;
- never retry a coordinate after layout, focus, scale, display, or window
  changes;
- re-observe after user intervention;
- require post-action observation before declaring success.

### Layer 6: IPC Ownership And Peer Identity

The real CUA socket is inside an owner-only group-container directory and is
itself owner-only. Static strings show local peer-token handling and invalid
peer-token rejection in the service.

The lock-screen broker socket is different: it is currently `0666`. The
embedded authorization plug-in contains explicit paths to:

- read the peer audit token;
- derive the peer signing identifier;
- derive the peer Team ID;
- compare them with `com.openai.sky.CUAService` and `2DC432GLL2`;
- reject an identity mismatch.

Socket mode alone is insufficient for this endpoint. Every accepted request
must pass peer identity validation, and any audit-token, signing, or Team ID
error must deny authorization.

The collector calls only `stat` and `lsof` on sockets. It does not open, connect
to, probe, frame, or write either endpoint.

### Layer 7: TCC And Native Capability

The current service has system TCC grants for Accessibility and Screen
Recording. Input Monitoring and Post Event records were not observed.

Absence of a TCC row is not proof that corresponding code is absent or
inactive. TCC is one gate among several; it does not protect against semantic
prompt injection after screen or AX data has already been authorized.

The collector uses `sqlite3 -readonly` with exact service and client filters.
It never invokes `tccutil`.

### Layer 8: Lock-Screen Guardian

Static evidence includes a guardian fail-closed path, physical-input detection,
relock behavior, a one-shot authorization broker, and peer validation in the
authorization plug-in.

The embedded plug-in is not equivalent to an installed plug-in. Installation
requires both a file in the SecurityAgent plug-in directory and a matching
`authorizationdb` mechanism. The current machine has neither, so the lab marks
locked use unavailable even though the broker socket exists.

The collector executes neither the installer nor its helper and performs only:

```bash
security authorizationdb read system.login.console
```

It never performs an `authorizationdb write`.

### Layer 9: Logs And Durable Evidence

Native format strings include public fields for app, URL, error, geometry,
process, and action state. Unified logs, Codex logs, screenshots, AX trees, and
approval stores can therefore expose private activity even when they contain no
API key.

Default evidence collection must not include:

- raw unified logs;
- prompt bodies or tool arguments;
- screenshots or AX text;
- approval lists;
- environment dumps;
- complete Codex configuration.

When a narrow log capture is necessary, use a time bound and subsystem
predicate, redact before writing, and review the result as user data rather
than ordinary build output.

### Layer 10: Trusted JavaScript Supply Chain

Computer Use depends on:

```text
NODE_REPL_TRUSTED_CODE_PATHS
NODE_REPL_NODE_MODULE_DIRS
SKY_CUA_NATIVE_PIPE_PATH
```

The wrapper loads the first matching Sky package and verifies function shape,
not package provenance. The pipe client negotiates API version, not peer code
signature.

Current mitigations:

- active Sky root is inside the signed ChatGPT bundle;
- ordinary untrusted cells cannot use trusted pipe or elicitation bridges;
- native service performs independent sender, policy, TCC, URL, session, and
  target checks.

Hardening opportunities:

- narrow trusted paths to exact wrapper roots;
- pin Sky hash or signed app origin;
- authenticate the native-pipe peer;
- remove production transport redirection.

### Layer 11: Presentation Attribution

Multiple Computer Use operations in one JavaScript call overwrite one
`codex/toolSurface` key. Desktop attributes the item to the last app metadata
writer, not necessarily the primary action.

This affects audit readability and grouping. It does not alter each native
action's canonical app path.

### Layer 12: Approval Granularity

The elicitation approves use of an app, not one action payload. Invalid
coordinates, keys, text, or other non-app fields can fail after the approval
has been accepted.

The wrapper carries no policy nonce, PID, code-signing digest, or approval
revision into the action request.

## Mock Versus Real Boundary

Hermetic protocol fixtures can prove framing, parser behavior, error handling,
and fail-closed policy. They cannot prove:

- the current service accepts the production client;
- TCC permits a real capture or action;
- a real AX element maps to the intended UI;
- synthesized input reaches the intended process;
- lock-screen authorization succeeds;
- the user-visible effect matches the model's claim.

This security collector inspects the real signed bundle, TCC rows, and socket
metadata, but sends no production request. A claim about real action behavior
requires a separately labeled, user-observed experiment with fresh state and
post-action verification. Mock evidence and real evidence must never share an
unqualified "works" result.

## Reproducible Read-Only Runbook

From the lab root:

```bash
bash scripts/collect-readonly-security-evidence.sh
node --test tests/security-evidence.test.mjs
node scripts/check-no-secrets.mjs
```

The collector writes `fixtures/security/latest.json` with mode `0600`. Expected
high-level properties are:

- `safety.realCuaSocket.connected` is `false`;
- TCC and authorization databases are marked unmodified;
- signature, entitlement, provision, and socket facts are normalized;
- no username, hostname, logs, approvals, or raw configuration are stored;
- unknown lock policy or incomplete installer state produces `fail_closed`;
- coordinate actions remain fail closed without a fresh observation.

Audit the collector itself with:

```bash
rg -n 'tccutil|authorizationdb|computeruse\.sock|LockScreenLoginAuthorization' \
  scripts/collect-readonly-security-evidence.sh
```

Permitted matches are read-only database access, exact path metadata, `lsof`,
and safety assertions. Any socket client, installer execution, `tccutil`, or
`authorizationdb write` is outside this lab's default safety boundary.

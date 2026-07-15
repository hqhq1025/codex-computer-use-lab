# Real CUA Experiment Safety Contract

> 本契约仍只授权 synthetic test app 的显式实验。service/IPC 深挖使用更窄的
> observation-only 边界，不连接 production socket、不触发 action，见
> `16-service-process-lifecycle-and-retention.md`。

This contract applies to any lab command that uses the production
`SkyComputerUseService`.

## Allowed Target

```text
bundle identifier: com.openai.codex.cualab
expected app root:
  /Users/haoqing/Documents/Learning/computer-use-research/codex-computer-use-lab/test-app/build/
  Codex CUA Lab.app
```

The runner must fail before a Computer Use call if:

- the bundle identifier differs;
- more than one application resolves to the identifier;
- the resolved path is outside the expected build root;
- the app is not the lab build;
- the app state contains unexpected non-synthetic labels;
- the app's state oracle path is outside `test-app/runtime`;
- the requested scenario is not in the static allowlist.

## Allowed Observations

- `list_apps`, only to verify the exact target;
- `get_app_state` for the exact target;
- screenshot metadata and a cryptographic hash;
- synthetic AX text produced by the test app;
- the test app's own `state.json`;
- process, window, file, and latency metadata.

## Allowed Actions

Only inside the test app:

- element-index click;
- coordinate click against the immediately preceding screenshot;
- `set_value`;
- `type_text`;
- `select_text`;
- a declared secondary AX action;
- scroll;
- drag within the app window;
- keyboard navigation;
- opening and closing the synthetic modal;
- moving the test app window through its own synthetic control.

## Forbidden Actions

- any other application or bundle identifier;
- system settings, loginwindow, authorization dialogs, Terminal, Finder, Mail,
  browsers, messaging, or Codex itself;
- file management outside the test app runtime directory;
- network access;
- clipboard reads or writes;
- external communication;
- delete, install, account, credential, financial, or permission operations;
- locked Computer Use;
- persistent app approval;
- using a coordinate after any window, display, layout, scale, focus, or user
  intervention event without a fresh observation.

## Required Step Pattern

Every action follows:

```text
reset synthetic app state
  -> full get_app_state
  -> validate target and synthetic marker
  -> select action from allowlist
  -> execute one action
  -> full get_app_state
  -> read synthetic state oracle
  -> compare observed state and oracle
  -> record result
```

Stale-element experiments are the only exception: they intentionally insert a
synthetic hierarchy mutation between observation and action, but still use one
declared target and stop after the expected success or error.

## Confirmation

The user's request to continue the isolated reverse-engineering experiment is
the authorization for non-risky UI actions inside this test app. It does not
authorize actions outside the allowlist or outside the test app.

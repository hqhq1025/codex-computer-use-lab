# Real CUA Fixtures

This directory is reserved for behavior captures against the synthetic
`com.openai.codex.cualab` test app.

Fixtures must not contain:

- screenshots unless explicitly requested by a lab flag;
- non-synthetic AX text;
- application data from another bundle;
- user paths other than normalized lab paths;
- persistent app approval contents;
- credentials or environment dumps.

Every result records whether a production CUA request was sent and whether a UI
action was executed. Mock and production captures use separate schemas.

The observation-only cross-client baseline fixture is:

```text
cross-client-baseline.json
```

It proves that after `node_repl.js_reset` terminates Client A's Node kernel, a
fresh Client B can receive a native no-change diff as its first observation.
The experiment performs no UI action and keeps the persistent approval store
absent.

The real timeout side-effect fixture is:

```text
timeout-late-action.json
```

It records one 1 ms internal Mac-client click request that rejected locally
before the original native action later incremented the synthetic button
oracle. The temporary trusted helper used to expose the internal client was
deleted after capture.

The current consolidated production fixture is:

```text
runner-final-semantic-matrix-v4.json
```

It pins SHA-256 provenance for the synthetic App executable, production
`SkyComputerUseService`, and plugin wrapper. It contains 21 passing scenarios,
66 steps, and 192 post-call approval-store checks. Each reset records its
bounded 1300 ms geometry-settle contract. Earlier success and failure fixtures
are kept as A/B evidence for AppKit accessibility and timing mistakes; they
must not be mixed with the final matrix without comparing the recorded
executable hash.

`runner-final-semantic-matrix-v3.json` is the last pre-WebKit 20-scenario
matrix. V4 adds the in-memory WKWebView OOP coordinate scenario and re-runs
every earlier scenario against one WebKit-enabled App binary.

The Maka Web regression fixture is:

```text
maka-web-matrix.json
```

Its runner requires a clean Maka CU source checkout, builds the release binary
itself, and can require a prepared Maka Agent binary to match those exact bytes.
It records the source commit and binary SHA-256, then runs five bounded
background Web matrices. The gate covers primary AX effect, unique and missing
stale refetch, slider 42, scroll 76, trusted out-of-process WebContent click,
one mouse down/up pair, and a 10 ms foreground sentinel around every scenario.

The Web text candidate adds an offline WKWebView text field with DOM
`input`/`change` counters, trusted-event flags, and a business-state oracle.
`scripts/probe-maka-web-text.mjs` intentionally fails until `set_value` both
reads back the requested value and produces a DOM input event. A locked-screen
run is not retained as behavior evidence.

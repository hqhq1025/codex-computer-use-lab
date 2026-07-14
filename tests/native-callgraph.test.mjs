import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const scriptPath = path.join(root, "scripts/native-callgraph.sh");
const fixtureDirectory = path.join(root, "fixtures/native-callgraph");
const documentPath = path.join(root, "docs/12-native-function-callgraph.md");
const defaultBinary = path.join(
  os.homedir(),
  ".codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService"
);

async function readTsv(relativePath) {
  const text = await readFile(path.join(fixtureDirectory, relativePath), "utf8");
  const [header, ...lines] = text.trimEnd().split("\n");
  const columns = header.split("\t");
  return lines.map((line) =>
    Object.fromEntries(
      line.split("\t").map((value, index) => [columns[index], value])
    )
  );
}

async function collectFixtureFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const child of await collectFixtureFiles(entryPath)) {
        files.push(path.join(entry.name, child));
      }
    } else {
      files.push(entry.name);
    }
  }
  return files.sort();
}

test("checked fixture pins six bounded async entry functions", async () => {
  const metadata = Object.fromEntries(
    (await readTsv("metadata.tsv")).map(({ key, value }) => [key, value])
  );
  const functions = await readTsv("functions.tsv");

  assert.equal(metadata.uuid, "9E40FA2F-FC6C-3EE2-824A-E4975CA022AD");
  assert.equal(
    metadata.sha256,
    "27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58"
  );
  assert.equal(metadata.scope, "entry-functions-only");
  assert.equal(metadata.process_started, "false");
  assert.equal(metadata.process_attached, "false");
  assert.equal(functions.length, 6);
  assert.deepEqual(
    functions.map(({ id, entry, entry_size_bytes }) => [
      id,
      entry,
      Number(entry_size_bytes)
    ]),
    [
      ["ipc_request_dispatch", "0x000000010013f9e4", 204],
      ["perform_action_request", "0x000000010012df9c", 92],
      ["get_skyshot_request", "0x0000000100136904", 112],
      ["skyshot_capture_ax_tree", "0x00000001001b6bfc", 32],
      ["skyshot_capture_screenshot", "0x00000001001b7cec", 32],
      ["wait_for_ui_to_settle", "0x000000010064a280", 220]
    ]
  );

  for (const fn of functions) {
    assert.equal(fn.async, "true");
    assert.equal(
      BigInt(fn.entry_end) - BigInt(fn.entry),
      BigInt(fn.entry_size_bytes)
    );
    assert.ok(
      Number(fn.entry_size_bytes) <= 220,
      `${fn.id} must remain an entry-only bounded disassembly`
    );
  }
});

test("transfers distinguish direct calls, tail branches, and indirect dispatch", async () => {
  const transfers = await readTsv("transfers.tsv");
  const hasEdge = (callerId, kind, targetSymbol) =>
    transfers.some(
      (edge) =>
        edge.caller_id === callerId &&
        edge.kind === kind &&
        edge.target_symbol === targetSymbol
    );

  assert.equal(
    hasEdge("perform_action_request", "direct-bl", "_swift_task_alloc"),
    true
  );
  assert.equal(
    hasEdge("perform_action_request", "direct-tail-b", "_swift_task_switch"),
    true
  );
  assert.equal(
    hasEdge("skyshot_capture_ax_tree", "direct-tail-b", "_swift_task_switch"),
    true
  );
  assert.equal(
    hasEdge(
      "skyshot_capture_screenshot",
      "direct-tail-b",
      "_swift_task_switch"
    ),
    true
  );
  assert.equal(
    hasEdge("ipc_request_dispatch", "indirect-branch", "register:x4"),
    true
  );

  assert.equal(
    transfers.some(
      (edge) =>
        edge.kind === "direct-bl" &&
        /captureScreenshot|refetchTree|updateSkyshot/.test(edge.target_symbol)
    ),
    false,
    "entry stubs must not invent business-level async calls"
  );
  assert.equal(
    transfers.some(
      (edge) =>
        edge.kind === "indirect-branch" &&
        !edge.target_symbol.startsWith("register:")
    ),
    false
  );
});

test("click and updateSkyshot remain related async targets, not direct entry edges", async () => {
  const [relatedTargets, transfers] = await Promise.all([
    readTsv("related-async-targets.tsv"),
    readTsv("transfers.tsv")
  ]);

  assert.deepEqual(
    relatedTargets.map(({ workflow, entry, async_pointer }) => [
      workflow,
      entry,
      async_pointer
    ]),
    [
      [
        "perform_action_request",
        "0x00000001000747bc",
        "0x0000000100d18090"
      ],
      [
        "get_skyshot_request",
        "0x000000010006ebe4",
        "0x0000000100d18000"
      ]
    ]
  );
  assert.ok(
    relatedTargets.every(({ caveat }) =>
      caveat.includes("not a direct edge")
    )
  );
  assert.equal(
    transfers.some(({ target_symbol }) =>
      /ComputerUseAppController\.(?:click|updateSkyshot)/.test(target_symbol)
    ),
    false
  );
});

test("entry disassembly files are exact bounded ranges", async () => {
  const functions = await readTsv("functions.tsv");

  for (const fn of functions) {
    const disassemblyPath = path.join(
      fixtureDirectory,
      "disassembly",
      `${fn.id}.txt`
    );
    const text = await readFile(disassemblyPath, "utf8");
    const lines = text.trimEnd().split("\n");
    const addresses = lines.map((line) => BigInt(`0x${line.split(":")[0]}`));

    assert.equal(addresses[0], BigInt(fn.entry));
    assert.ok(addresses.every((address) => address < BigInt(fn.entry_end)));
    assert.ok(
      lines.every((line) => /^[0-9a-f]+:\s+[0-9a-f]{8}\s+/.test(line)),
      `${fn.id} contains a non-instruction line`
    );
  }
});

test("collector stays read-only and avoids unbounded text disassembly", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.match(source, /--start-address=/);
  assert.match(source, /--stop-address=/);
  assert.match(source, /--function-starts=both/);
  assert.match(source, /target create/);
  assert.doesNotMatch(source, /\b(?:run|process launch|process attach|attach)\b/);
  assert.doesNotMatch(source, /llvm-objdump[^\n]*(?:\s-d\s|--disassemble-all)/);
});

test("documentation keeps the six-function scope and async caveat explicit", async () => {
  const document = await readFile(documentPath, "utf8");

  for (const anchor of [
    "ExecutableComputerUseIPCRequest.handle",
    "ComputerUseIPCAppPerformActionRequest.handle",
    "ComputerUseIPCAppGetSkyshotRequest.handle",
    "SkyshotOperation.captureAXTree",
    "SkyshotOperation.captureScreenshot",
    "ApplicationUIElement.waitForUIToSettle"
  ]) {
    assert.match(document, new RegExp(anchor.replaceAll(".", "\\.")));
  }
  assert.match(document, /`compiled-async-target` 不是调用边/);
  assert.match(document, /entry 大小不能当成完整函数大小/);
  assert.match(document, /不启动服务、不 attach 进程/);
});

test(
  "live bounded extractor reproduces checked fixtures",
  {
    skip: process.platform !== "darwin" || !existsSync(defaultBinary),
    timeout: 130_000
  },
  async (t) => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "native-callgraph-test-")
    );
    t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

    const { stderr } = await execFileAsync(
      "bash",
      [scriptPath, "--out", temporaryDirectory],
      {
        cwd: root,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024
      }
    );
    assert.equal(stderr, "");

    const expectedFiles = await collectFixtureFiles(fixtureDirectory);
    const actualFiles = await collectFixtureFiles(temporaryDirectory);
    assert.deepEqual(actualFiles, expectedFiles);

    for (const relativePath of expectedFiles) {
      const [expected, actual] = await Promise.all([
        readFile(path.join(fixtureDirectory, relativePath)),
        readFile(path.join(temporaryDirectory, relativePath))
      ]);
      assert.deepEqual(actual, expected, relativePath);
    }

    const fixtureStat = await stat(temporaryDirectory);
    assert.equal(fixtureStat.isDirectory(), true);
  }
);

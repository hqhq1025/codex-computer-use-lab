import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("real experiment contract pins one synthetic bundle and forbids other apps", async () => {
  const contract = await readFile(
    new URL("../docs/15-real-experiment-safety-contract.md", import.meta.url),
    "utf8"
  );

  assert.match(contract, /com\.openai\.codex\.cualab/);
  assert.match(contract, /any other application or bundle identifier/);
  assert.match(contract, /persistent app approval/);
  assert.match(contract, /immediately preceding screenshot/);
  assert.match(contract, /state\.json/);
});

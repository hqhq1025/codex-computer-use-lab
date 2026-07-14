#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { containsSecretLikeText } from "../lib/redaction.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const patterns = ["docs/**/*.md", "fixtures/**/*", "README.md"];
const failures = [];

for (const pattern of patterns) {
  for await (const relativePath of glob(pattern, { cwd: root })) {
    const absolutePath = path.join(root, relativePath);
    if (!(await stat(absolutePath)).isFile()) {
      continue;
    }
    const contents = await readFile(absolutePath, "utf8");
    if (containsSecretLikeText(contents)) {
      failures.push(relativePath);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`Secret-like text detected in:\n${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("No secret-like text detected in docs or fixtures.\n");

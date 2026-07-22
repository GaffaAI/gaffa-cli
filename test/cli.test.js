import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
    });
    return { stdout, code: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.status };
  }
}

test("--version prints the package version", () => {
  const { stdout, code } = run(["--version"]);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test("--help prints usage", () => {
  const { stdout, code } = run(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage/);
});

test("no arguments prints help", () => {
  const { stdout, code } = run([]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage/);
});

test("an unknown command exits non-zero", () => {
  const { code } = run(["frobnicate"]);
  assert.equal(code, 1);
});

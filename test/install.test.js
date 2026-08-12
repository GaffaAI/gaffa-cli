import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { install, uninstall, writeDirs } from "../dist/install.js";
import { readLocalSource } from "../dist/skills-source.js";
import { readReceipt, RECEIPT_NAME } from "../dist/receipt.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function tmp() {
  return mkdtempSync(join(tmpdir(), "gaffa-install-"));
}

// A source skill: a gaffa-* directory with a SKILL.md and one nested reference
// file, so copying and the receipt cover more than a single top-level file.
function sourceSkill(srcDir, name, body = "skill\n") {
  mkdirSync(join(srcDir, name, "references"), { recursive: true });
  writeFileSync(join(srcDir, name, "SKILL.md"), body);
  writeFileSync(join(srcDir, name, "references", "ref.md"), "ref\n");
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("install copies the skills into a tool's dir and writes a receipt with hashes", () => {
  const home = tmp(), cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    sourceSkill(src, "gaffa-debug");
    const source = readLocalSource(src);

    const results = install({ home, cwd, env: {} }, { tools: ["codex"], scope: "project", source });

    assert.equal(results.length, 1);
    const dir = join(cwd, ".agents", "skills"); // codex project target
    assert.equal(results[0].dir, dir);
    assert.ok(existsSync(join(dir, "gaffa-find", "SKILL.md")));
    assert.ok(existsSync(join(dir, "gaffa-debug", "references", "ref.md")));

    const receipt = readReceipt(dir);
    assert.equal(receipt.scope, "project");
    assert.equal(receipt.version, "0.0.0-local");
    const paths = receipt.files.map((f) => f.path);
    assert.ok(paths.includes("gaffa-find/SKILL.md"));
    assert.ok(paths.includes("gaffa-debug/references/ref.md"));
    for (const f of receipt.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
  } finally {
    cleanup(home, cwd, src);
  }
});

test("tools that share a target directory write once, one receipt", () => {
  const home = tmp(), cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    const source = readLocalSource(src);
    // codex, copilot and cursor all canonically write project .agents/skills.
    const dirs = writeDirs(["codex", "copilot", "cursor"], "project", { home, cwd, env: {} });
    assert.deepEqual(dirs, [join(cwd, ".agents", "skills")]);

    const results = install({ home, cwd, env: {} }, { tools: ["codex", "copilot", "cursor"], scope: "project", source });
    assert.equal(results.length, 1);
  } finally {
    cleanup(home, cwd, src);
  }
});

test("claude-code and codex resolve to different project dirs", () => {
  const home = tmp(), cwd = tmp();
  try {
    const dirs = writeDirs(["claude-code", "codex"], "project", { home, cwd, env: {} });
    assert.deepEqual(
      dirs.sort(),
      [join(cwd, ".agents", "skills"), join(cwd, ".claude", "skills")].sort(),
    );
  } finally {
    cleanup(home, cwd);
  }
});

test("a refresh drops a skill the source no longer has", () => {
  const home = tmp(), cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    sourceSkill(src, "gaffa-debug");
    const ctx = { home, cwd, env: {} };
    install(ctx, { tools: ["codex"], scope: "project", source: readLocalSource(src) });

    rmSync(join(src, "gaffa-debug"), { recursive: true, force: true }); // retire it
    const results = install(ctx, { tools: ["codex"], scope: "project", source: readLocalSource(src) });

    const dir = join(cwd, ".agents", "skills");
    assert.ok(existsSync(join(dir, "gaffa-find", "SKILL.md")));
    assert.ok(!existsSync(join(dir, "gaffa-debug")));
    assert.deepEqual(results[0].dropped, ["gaffa-debug"]);
    assert.ok(readReceipt(dir).files.every((f) => f.path.startsWith("gaffa-find/")));
  } finally {
    cleanup(home, cwd, src);
  }
});

test("uninstall removes an untouched install and its receipt", () => {
  const home = tmp(), cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    const ctx = { home, cwd, env: {} };
    install(ctx, { tools: ["codex"], scope: "project", source: readLocalSource(src) });

    const results = uninstall(ctx, "project");
    const dir = join(cwd, ".agents", "skills");
    assert.equal(results.length, 1);
    assert.ok(results[0].removed.includes("gaffa-find/SKILL.md"));
    assert.ok(!existsSync(join(dir, "gaffa-find")));
    assert.ok(!existsSync(join(dir, RECEIPT_NAME)));
  } finally {
    cleanup(home, cwd, src);
  }
});

test("uninstall leaves a file the user edited and prunes the receipt to it", () => {
  const home = tmp(), cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    const ctx = { home, cwd, env: {} };
    install(ctx, { tools: ["codex"], scope: "project", source: readLocalSource(src) });

    const dir = join(cwd, ".agents", "skills");
    writeFileSync(join(dir, "gaffa-find", "SKILL.md"), "I edited this\n"); // changes the hash

    const results = uninstall(ctx, "project");
    assert.deepEqual(results[0].kept, ["gaffa-find/SKILL.md"]);
    assert.ok(results[0].removed.includes("gaffa-find/references/ref.md"));
    assert.ok(existsSync(join(dir, "gaffa-find", "SKILL.md"))); // left in place
    assert.ok(!existsSync(join(dir, "gaffa-find", "references"))); // unedited removed, dir pruned

    const receipt = readReceipt(dir); // pruned to the kept file, still self-describing
    assert.deepEqual(receipt.files.map((f) => f.path), ["gaffa-find/SKILL.md"]);
  } finally {
    cleanup(home, cwd, src);
  }
});

test("a refresh does not clobber a retired skill the user had edited", () => {
  const home = tmp(), cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    sourceSkill(src, "gaffa-debug");
    const ctx = { home, cwd, env: {} };
    install(ctx, { tools: ["codex"], scope: "project", source: readLocalSource(src) });

    const dir = join(cwd, ".agents", "skills");
    writeFileSync(join(dir, "gaffa-debug", "SKILL.md"), "my notes\n"); // edit it
    rmSync(join(src, "gaffa-debug"), { recursive: true, force: true }); // then retire it

    const results = install(ctx, { tools: ["codex"], scope: "project", source: readLocalSource(src) });
    assert.deepEqual(results[0].dropped, ["gaffa-debug"]);
    assert.ok(results[0].kept.includes("gaffa-debug/SKILL.md"));
    assert.ok(existsSync(join(dir, "gaffa-debug", "SKILL.md"))); // edit preserved
  } finally {
    cleanup(home, cwd, src);
  }
});

test("readLocalSource rejects a directory with no skills", () => {
  const src = tmp();
  try {
    assert.throws(() => readLocalSource(src), /no gaffa skills/);
  } finally {
    cleanup(src);
  }
});

test("install and uninstall work at personal scope", () => {
  const home = tmp(), cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    const ctx = { home, cwd, env: {} };
    const results = install(ctx, { tools: ["claude-code"], scope: "personal", source: readLocalSource(src) });
    const dir = join(home, ".claude", "skills"); // claude-code personal, from config dir
    assert.equal(results[0].dir, dir);
    assert.ok(existsSync(join(dir, "gaffa-find", "SKILL.md")));

    const un = uninstall(ctx, "personal");
    assert.ok(un[0].removed.includes("gaffa-find/SKILL.md"));
    assert.ok(!existsSync(join(dir, "gaffa-find")));
  } finally {
    cleanup(home, cwd, src);
  }
});

test("a user's own skill and its empty subdirs are never pruned", () => {
  const home = tmp(), cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    const ctx = { home, cwd, env: {} };
    const shared = join(cwd, ".agents", "skills");
    mkdirSync(join(shared, "my-skill", "empty"), { recursive: true }); // user's own, empty inside

    install(ctx, { tools: ["codex"], scope: "project", source: readLocalSource(src) });
    assert.ok(existsSync(join(shared, "my-skill", "empty")));
    uninstall(ctx, "project");
    assert.ok(existsSync(join(shared, "my-skill", "empty"))); // untouched
  } finally {
    cleanup(home, cwd, src);
  }
});

test("a file the user adds inside a gaffa skill dir is not adopted and survives uninstall", () => {
  const home = tmp(), cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    const ctx = { home, cwd, env: {} };
    install(ctx, { tools: ["codex"], scope: "project", source: readLocalSource(src) });

    const dir = join(cwd, ".agents", "skills");
    writeFileSync(join(dir, "gaffa-find", "my-notes.md"), "mine\n");
    install(ctx, { tools: ["codex"], scope: "project", source: readLocalSource(src) }); // refresh

    assert.ok(readReceipt(dir).files.every((f) => f.path !== "gaffa-find/my-notes.md"));
    uninstall(ctx, "project");
    assert.ok(existsSync(join(dir, "gaffa-find", "my-notes.md"))); // left in place
  } finally {
    cleanup(home, cwd, src);
  }
});

// End-to-end through the built binary, driving cwd so a project install lands in
// a temp directory rather than the repo.
function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd });
    return { stdout, code: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.status };
  }
}

test("cli install writes skills for a project scope in the working directory", () => {
  const cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    const { stdout, code } = run(
      ["install", "--tools=codex", "--scope=project", `--skills-dir=${src}`, "--yes"],
      cwd,
    );
    assert.equal(code, 0);
    assert.match(stdout, /Installed the gaffa skills/);
    assert.ok(existsSync(join(cwd, ".agents", "skills", "gaffa-find", "SKILL.md")));
  } finally {
    cleanup(cwd, src);
  }
});

test("cli install with no skills source errors and writes nothing", () => {
  const cwd = tmp();
  try {
    const { code, stderr } = run(["install", "--tools=codex", "--scope=project", "--yes"], cwd);
    assert.equal(code, 1);
    assert.match(stderr, /GAFFA_SKILLS_DIR|skills source/);
  } finally {
    cleanup(cwd);
  }
});

test("help lists install and uninstall", () => {
  const { stdout, code } = run(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /install/);
  assert.match(stdout, /uninstall/);
});

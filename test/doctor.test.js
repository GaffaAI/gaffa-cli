import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectTools } from "../dist/tools.js";
import { runDoctor } from "../dist/doctor.js";
import { writeReceipt } from "../dist/receipt.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function tmp() {
  return mkdtempSync(join(tmpdir(), "gaffa-doctor-"));
}

// Create a skill folder (a directory with a SKILL.md) under a skills directory.
function skill(skillsDir, name) {
  mkdirSync(join(skillsDir, name), { recursive: true });
  writeFileSync(join(skillsDir, name, "SKILL.md"), "name\n");
}

function report(reports, id) {
  const r = reports.find((x) => x.id === id);
  assert.ok(r, `no report for ${id}`);
  return r;
}

test("nothing installed: every tool reports not installed and no skills", () => {
  const home = tmp();
  const cwd = tmp();
  try {
    const reports = inspectTools({ home, cwd, env: {} });
    assert.equal(reports.length, 6);
    for (const r of reports) {
      assert.equal(r.installed, false);
      for (const loc of r.skillLocations) assert.deepEqual(loc.skills, []);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("config directory presence marks a tool installed", () => {
  const home = tmp();
  const cwd = tmp();
  try {
    mkdirSync(join(home, ".codex"), { recursive: true });
    const reports = inspectTools({ home, cwd, env: {} });
    assert.equal(report(reports, "codex").installed, true);
    assert.equal(report(reports, "claude-code").installed, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a config env override is used and reported as the config path", () => {
  const home = tmp();
  const cwd = tmp();
  const override = tmp();
  try {
    const reports = inspectTools({ home, cwd, env: { CLAUDE_CONFIG_DIR: override } });
    const claude = report(reports, "claude-code");
    assert.equal(claude.installed, true);
    assert.equal(claude.configPath, override);
  } finally {
    for (const d of [home, cwd, override]) rmSync(d, { recursive: true, force: true });
  }
});

test("a config env override also moves the personal skills lookup", () => {
  const home = tmp();
  const cwd = tmp();
  const override = tmp();
  try {
    skill(join(override, "skills"), "gaffa-find");
    const claude = report(
      inspectTools({ home, cwd, env: { CLAUDE_CONFIG_DIR: override } }),
      "claude-code",
    );
    const personal = claude.skillLocations.find((l) => l.scope === "personal");
    assert.equal(personal.path, join(override, "skills"));
    assert.deepEqual(personal.skills, ["gaffa-find"]);
  } finally {
    for (const d of [home, cwd, override]) rmSync(d, { recursive: true, force: true });
  }
});

test("plain ~/.gemini does not mark Antigravity installed, ~/.gemini/antigravity-cli does", () => {
  const home = tmp();
  const cwd = tmp();
  try {
    mkdirSync(join(home, ".gemini"), { recursive: true });
    assert.equal(report(inspectTools({ home, cwd, env: {} }), "antigravity").installed, false);
    mkdirSync(join(home, ".gemini", "antigravity-cli"), { recursive: true });
    assert.equal(report(inspectTools({ home, cwd, env: {} }), "antigravity").installed, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("gaffa skills are detected in a project skills directory, shared paths surface per tool", () => {
  const home = tmp();
  const cwd = tmp();
  try {
    skill(join(cwd, ".claude", "skills"), "gaffa-find");
    const reports = inspectTools({ home, cwd, env: {} });
    const claudeLoc = report(reports, "claude-code").skillLocations.find(
      (l) => l.scope === "project" && l.path.includes(".claude"),
    );
    assert.deepEqual(claudeLoc.skills, ["gaffa-find"]);
    // Copilot also reads project .claude/skills, so it surfaces there too.
    const copilotLoc = report(reports, "copilot").skillLocations.find(
      (l) => l.scope === "project" && l.path.includes(".claude"),
    );
    assert.deepEqual(copilotLoc.skills, ["gaffa-find"]);
    // Codex does not read .claude/skills, so it stays empty.
    for (const loc of report(reports, "codex").skillLocations) {
      assert.deepEqual(loc.skills, []);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("only gaffa-* directories with a SKILL.md count as skills", () => {
  const home = tmp();
  const cwd = tmp();
  try {
    const skillsDir = join(cwd, ".agents", "skills");
    mkdirSync(join(skillsDir, "gaffa-nope"), { recursive: true }); // no SKILL.md
    skill(skillsDir, "other-skill"); // has SKILL.md but not a gaffa skill
    skill(skillsDir, "gaffa-find"); // counts
    const loc = report(inspectTools({ home, cwd, env: {} }), "codex").skillLocations.find(
      (l) => l.scope === "project",
    );
    assert.deepEqual(loc.skills, ["gaffa-find"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("json output has a tools array with an entry per tool", async () => {
  const home = tmp();
  const cwd = tmp();
  try {
    const parsed = JSON.parse(await runDoctor({ home, cwd, env: {} }, true));
    assert.equal(parsed.tools.length, 6);
    assert.ok(parsed.tools.every((t) => "installed" in t && "configPath" in t));
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("human output names every tool", async () => {
  const home = tmp();
  const cwd = tmp();
  try {
    const out = await runDoctor({ home, cwd, env: {} }, false);
    for (const label of ["Claude Code", "Codex", "GitHub Copilot", "Cursor", "Antigravity", "Pi"]) {
      assert.match(out, new RegExp(label));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

// A receipt in cwd/.agents/skills, the loose-file install the version check reads.
function receiptAt(cwd, version) {
  const dir = join(cwd, ".agents", "skills");
  mkdirSync(dir, { recursive: true });
  writeReceipt(dir, { version, scope: "project", files: [] });
}

test("doctor reports a newer published skills version", async () => {
  const home = tmp();
  const cwd = tmp();
  try {
    receiptAt(cwd, "0.1.0");
    const out = await runDoctor({ home, cwd, env: {} }, false, async () => "0.2.0");
    assert.match(out, /newer skills version is published: 0\.2\.0 \(installed 0\.1\.0\)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("doctor compares against the oldest receipt by version, not by string order", async () => {
  const home = tmp();
  const cwd = tmp();
  try {
    receiptAt(cwd, "0.10.0");
    const claude = join(cwd, ".claude", "skills");
    mkdirSync(claude, { recursive: true });
    writeReceipt(claude, { version: "0.2.0", scope: "project", files: [] });
    const out = await runDoctor({ home, cwd, env: {} }, false, async () => "0.10.0");
    assert.match(out, /newer skills version is published: 0\.10\.0 \(installed 0\.2\.0\)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("doctor stays quiet when the installed skills are current", async () => {
  const home = tmp();
  const cwd = tmp();
  try {
    receiptAt(cwd, "0.2.0");
    const out = await runDoctor({ home, cwd, env: {} }, false, async () => "0.2.0");
    assert.doesNotMatch(out, /newer skills version/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("doctor says so and carries on when the registry is unreachable", async () => {
  const home = tmp();
  const cwd = tmp();
  try {
    receiptAt(cwd, "0.1.0");
    const out = await runDoctor({ home, cwd, env: {} }, false, async () => {
      throw new Error("offline");
    });
    assert.match(out, /Could not check npm/);
    assert.match(out, /Codex/); // the report itself still renders
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("doctor skips the version check without a receipt", async () => {
  const home = tmp();
  const cwd = tmp();
  try {
    let called = false;
    const out = await runDoctor({ home, cwd, env: {} }, false, async () => {
      called = true;
      return "9.9.9";
    });
    assert.equal(called, false);
    assert.doesNotMatch(out, /newer skills version/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

// The command runs against the real environment here, so assert only what holds
// regardless of what is installed on the machine.
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    return { stdout, code: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? "", code: err.status };
  }
}

test("doctor runs and lists the tools", () => {
  const { stdout, code } = run(["doctor"]);
  assert.equal(code, 0);
  assert.match(stdout, /Claude Code/);
  assert.match(stdout, /Antigravity/);
});

test("doctor --json emits parseable json with six tools", () => {
  const { stdout, code } = run(["doctor", "--json"]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).tools.length, 6);
});

test("help lists the doctor command", () => {
  const { stdout, code } = run(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /doctor/);
});

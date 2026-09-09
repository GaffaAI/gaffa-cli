import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { registerMcp, unregisterMcp, MCP_NAME, MCP_URL } from "../dist/mcp.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function tmp() {
  return mkdtempSync(join(tmpdir(), "gaffa-mcp-"));
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("register writes the right entry shape per tool at personal scope", () => {
  const home = tmp(), cwd = tmp();
  try {
    const ctx = { home, cwd, env: {} };
    registerMcp(ctx, { tools: ["claude-code", "cursor", "antigravity", "copilot"], scope: "personal" });

    // Claude Code: ~/.claude.json, type http + url.
    assert.deepEqual(readJson(join(home, ".claude.json")).mcpServers[MCP_NAME], {
      type: "http",
      url: MCP_URL,
    });
    // Cursor: url only, no type.
    assert.deepEqual(readJson(join(home, ".cursor", "mcp.json")).mcpServers[MCP_NAME], {
      url: MCP_URL,
    });
    // Antigravity: serverUrl, not url.
    assert.deepEqual(readJson(join(home, ".gemini", "config", "mcp_config.json")).mcpServers[MCP_NAME], {
      serverUrl: MCP_URL,
    });
    // Copilot: type http, url, tools allowlist.
    assert.deepEqual(readJson(join(home, ".copilot", "mcp-config.json")).mcpServers[MCP_NAME], {
      type: "http",
      url: MCP_URL,
      tools: ["*"],
    });
  } finally {
    cleanup(home, cwd);
  }
});

test("register merges into an existing config without dropping the user's keys", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".cursor", "mcp.json");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ mcpServers: { other: { command: "x" } }, someTopKey: 1 }, null, 2),
    );

    const results = registerMcp({ home, cwd, env: {} }, { tools: ["cursor"], scope: "personal" });
    assert.equal(results[0].outcome, "added");

    const doc = readJson(file);
    assert.equal(doc.someTopKey, 1); // untouched
    assert.deepEqual(doc.mcpServers.other, { command: "x" }); // untouched
    assert.deepEqual(doc.mcpServers[MCP_NAME], { url: MCP_URL }); // added
  } finally {
    cleanup(home, cwd);
  }
});

test("a second register is a no-op reported as unchanged", () => {
  const home = tmp(), cwd = tmp();
  try {
    const ctx = { home, cwd, env: {} };
    registerMcp(ctx, { tools: ["cursor"], scope: "personal" });
    const again = registerMcp(ctx, { tools: ["cursor"], scope: "personal" });
    assert.equal(again[0].outcome, "unchanged");
  } finally {
    cleanup(home, cwd);
  }
});

test("register backs up and refuses a malformed JSON config", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".cursor", "mcp.json");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(file, "{ not valid json ");

    const results = registerMcp({ home, cwd, env: {} }, { tools: ["cursor"], scope: "personal" });
    assert.equal(results[0].outcome, "refused");
    assert.equal(readFileSync(file, "utf8"), "{ not valid json "); // left as-is
    assert.ok(existsSync(`${file}.gaffa.bak`)); // backed up
  } finally {
    cleanup(home, cwd);
  }
});

test("register overwrites a gaffa-docs pointing elsewhere and notes the collision", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".cursor", "mcp.json");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: { [MCP_NAME]: { url: "https://old.example" } } }));

    const results = registerMcp({ home, cwd, env: {} }, { tools: ["cursor"], scope: "personal" });
    assert.equal(results[0].outcome, "updated");
    assert.match(results[0].detail, /replaced/);
    assert.equal(readJson(file).mcpServers[MCP_NAME].url, MCP_URL);
  } finally {
    cleanup(home, cwd);
  }
});

test("register adds a TOML table for Codex and preserves existing config", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".codex", "config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(file, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n');

    const results = registerMcp({ home, cwd, env: {} }, { tools: ["codex"], scope: "personal" });
    assert.equal(results[0].outcome, "added");

    const text = readFileSync(file, "utf8");
    assert.match(text, /model = "gpt-5"/); // preserved
    assert.match(text, /\[mcp_servers\.other\]/); // preserved
    assert.match(text, new RegExp(`\\[mcp_servers\\.${MCP_NAME}\\]`));
    assert.match(text, new RegExp(`url = "${MCP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));

    // Idempotent.
    const again = registerMcp({ home, cwd, env: {} }, { tools: ["codex"], scope: "personal" });
    assert.equal(again[0].outcome, "unchanged");
  } finally {
    cleanup(home, cwd);
  }
});

test("copilot has no project MCP file, so a project register skips it", () => {
  const home = tmp(), cwd = tmp();
  try {
    const results = registerMcp({ home, cwd, env: {} }, { tools: ["copilot"], scope: "project" });
    assert.equal(results.length, 0);
  } finally {
    cleanup(home, cwd);
  }
});

test("unregister removes our entry and leaves the user's other servers", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".cursor", "mcp.json");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    const ctx = { home, cwd, env: {} };
    registerMcp(ctx, { tools: ["cursor"], scope: "personal" });

    const results = unregisterMcp(ctx, "personal").filter((r) => r.toolId === "cursor");
    assert.equal(results[0].outcome, "removed");
    const doc = readJson(file);
    assert.equal(doc.mcpServers[MCP_NAME], undefined); // gone
    assert.deepEqual(doc.mcpServers.other, { command: "x" }); // kept
  } finally {
    cleanup(home, cwd);
  }
});

test("unregister leaves a gaffa-docs that points elsewhere", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".cursor", "mcp.json");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: { [MCP_NAME]: { url: "https://mine.example" } } }));

    const results = unregisterMcp({ home, cwd, env: {} }, "personal").filter((r) => r.toolId === "cursor");
    assert.equal(results[0].outcome, "skipped");
    assert.equal(readJson(file).mcpServers[MCP_NAME].url, "https://mine.example"); // untouched
  } finally {
    cleanup(home, cwd);
  }
});

test("register then unregister restores the Codex TOML file exactly", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".codex", "config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const original = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n';
    writeFileSync(file, original);
    const ctx = { home, cwd, env: {} };

    registerMcp(ctx, { tools: ["codex"], scope: "personal" });
    const results = unregisterMcp(ctx, "personal").filter((r) => r.toolId === "codex");
    assert.equal(results[0].outcome, "removed");
    // Surgical: for a normally terminated config, adding then removing our table
    // leaves the rest exactly as it was.
    assert.equal(readFileSync(file, "utf8"), original);
  } finally {
    cleanup(home, cwd);
  }
});

test("claude-code personal MCP follows CLAUDE_CONFIG_DIR, else home", () => {
  const home = tmp(), cwd = tmp(), cfg = tmp(), home2 = tmp();
  try {
    registerMcp({ home, cwd, env: { CLAUDE_CONFIG_DIR: cfg } }, { tools: ["claude-code"], scope: "personal" });
    assert.ok(existsSync(join(cfg, ".claude.json"))); // the override dir
    assert.ok(!existsSync(join(home, ".claude.json"))); // not home

    registerMcp({ home: home2, cwd, env: {} }, { tools: ["claude-code"], scope: "personal" });
    assert.ok(existsSync(join(home2, ".claude.json"))); // falls back to home
  } finally {
    cleanup(home, cwd, cfg, home2);
  }
});

test("claude-code project MCP writes .mcp.json in the working dir", () => {
  const home = tmp(), cwd = tmp();
  try {
    registerMcp({ home, cwd, env: {} }, { tools: ["claude-code"], scope: "project" });
    assert.deepEqual(readJson(join(cwd, ".mcp.json")).mcpServers[MCP_NAME], { type: "http", url: MCP_URL });
  } finally {
    cleanup(home, cwd);
  }
});

test("a null gaffa-docs entry does not crash register or unregister", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".cursor", "mcp.json");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const ctx = { home, cwd, env: {} };

    writeFileSync(file, JSON.stringify({ mcpServers: { [MCP_NAME]: null } }));
    const r = registerMcp(ctx, { tools: ["cursor"], scope: "personal" });
    assert.equal(r[0].outcome, "updated"); // replaced the null with our entry
    assert.deepEqual(readJson(file).mcpServers[MCP_NAME], { url: MCP_URL });

    writeFileSync(file, JSON.stringify({ mcpServers: { [MCP_NAME]: null, other: { url: "x" } } }));
    const u = unregisterMcp(ctx, "personal").filter((x) => x.toolId === "cursor");
    assert.equal(u[0].outcome, "skipped"); // not recognisably ours, left alone, no throw
  } finally {
    cleanup(home, cwd);
  }
});

test("unregister deletes a config file it emptied", () => {
  const home = tmp(), cwd = tmp();
  try {
    const ctx = { home, cwd, env: {} };
    registerMcp(ctx, { tools: ["cursor"], scope: "personal" });
    const file = join(home, ".cursor", "mcp.json");
    assert.ok(existsSync(file));
    unregisterMcp(ctx, "personal");
    assert.ok(!existsSync(file));
  } finally {
    cleanup(home, cwd);
  }
});

test("TOML edits preserve a comment and section that follow our table", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".codex", "config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const original = `[mcp_servers.${MCP_NAME}]\nurl = "${MCP_URL}"\n\n# my own servers\n[mcp_servers.other]\ncommand = "x"\n`;
    writeFileSync(file, original);
    const ctx = { home, cwd, env: {} };

    assert.equal(registerMcp(ctx, { tools: ["codex"], scope: "personal" })[0].outcome, "unchanged");
    unregisterMcp(ctx, "personal");
    const text = readFileSync(file, "utf8");
    assert.match(text, /# my own servers/); // comment kept
    assert.match(text, /\[mcp_servers\.other\]/); // section kept
    assert.doesNotMatch(text, new RegExp(`mcp_servers\\.${MCP_NAME}`)); // ours gone
  } finally {
    cleanup(home, cwd);
  }
});

test("TOML register recognises the quoted-key spelling and does not duplicate", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".codex", "config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(file, `[mcp_servers."${MCP_NAME}"]\nurl = "https://old.example"\n`);

    registerMcp({ home, cwd, env: {} }, { tools: ["codex"], scope: "personal" });
    const text = readFileSync(file, "utf8");
    assert.equal((text.match(/mcp_servers/g) || []).length, 1); // one table, not a duplicate
    assert.match(text, new RegExp(`url = "${MCP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  } finally {
    cleanup(home, cwd);
  }
});

test("TOML unregister removes our sub-table too", () => {
  const home = tmp(), cwd = tmp();
  try {
    const file = join(home, ".codex", "config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      file,
      `[mcp_servers.${MCP_NAME}]\nurl = "${MCP_URL}"\n\n[mcp_servers.${MCP_NAME}.http_headers]\nX = "y"\n\n[mcp_servers.other]\ncommand = "x"\n`,
    );
    const ctx = { home, cwd, env: {} };

    assert.equal(unregisterMcp(ctx, "personal").filter((x) => x.toolId === "codex")[0].outcome, "removed");
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, new RegExp(`mcp_servers\\.${MCP_NAME}`)); // parent and sub-table gone
    assert.match(text, /\[mcp_servers\.other\]/); // unrelated section kept
  } finally {
    cleanup(home, cwd);
  }
});

// End to end through the built binary, project scope so files land in the temp cwd.
function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd });
    return { stdout, code: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.status };
  }
}

function sourceSkill(srcDir, name) {
  mkdirSync(join(srcDir, name), { recursive: true });
  writeFileSync(join(srcDir, name, "SKILL.md"), "skill\n");
}

test("cli install registers the docs MCP, and --no-mcp skips it", () => {
  const cwd = tmp(), src = tmp();
  try {
    sourceSkill(src, "gaffa-find");
    const base = ["install", "--tools=cursor", "--scope=project", `--skills-dir=${src}`, "--yes"];

    const withMcp = run(base, cwd);
    assert.equal(withMcp.code, 0);
    assert.match(withMcp.stdout, /Registered the gaffa-docs MCP server/);
    assert.equal(readJson(join(cwd, ".cursor", "mcp.json")).mcpServers[MCP_NAME].url, MCP_URL);

    // A fresh cwd with --no-mcp writes no MCP config.
    const cwd2 = tmp();
    try {
      const noMcp = run([...base, "--no-mcp"], cwd2);
      assert.equal(noMcp.code, 0);
      assert.doesNotMatch(noMcp.stdout, /MCP server/);
      assert.ok(!existsSync(join(cwd2, ".cursor", "mcp.json")));
    } finally {
      cleanup(cwd2);
    }
  } finally {
    cleanup(cwd, src);
  }
});

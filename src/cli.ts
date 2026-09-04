#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { runDoctor, processContext } from "./doctor.js";
import { inspectTools, TOOLS, type DoctorContext, type Scope } from "./tools.js";
import { fetchNpmSource, readLocalSource } from "./skills-source.js";
import { install, uninstall, type InstallResult, type UninstallResult } from "./install.js";
import { registerMcp, unregisterMcp, type McpResult } from "./mcp.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const IDS = TOOLS.map((t) => t.id).join(", ");

const HELP = `gaffa - the Gaffa command line tool

Usage
  gaffa [command] [options]

Commands
  doctor          Report which AI coding tools are installed and whether the
                  gaffa skills are set up in them. Add --json for machine output.
  install         Fetch the latest gaffa skills from npm and copy them into the
                  tools you pick, and register the gaffa docs MCP server in each.
                    --tools=a,b        tool ids, default the installed ones
                    --scope=project    or personal, default project
                    --skills-dir=PATH  read the skills from a local checkout
                                       instead of npm, or set GAFFA_SKILLS_DIR
                    --no-mcp           skip registering the docs MCP server
                    -y, --yes          take the defaults, do not prompt
  uninstall       Remove skills a previous install wrote, for a scope, and the
                  docs MCP server. A skill you edited since is left in place and
                  reported.
                    --scope=project    or personal, default project
                    --no-mcp           leave the docs MCP server in place
                    -y, --yes          take the defaults, do not prompt

Options
  -v, --version   Print the version and exit
  -h, --help      Show this help and exit

Tool ids: ${IDS}.
`;

interface Flags {
  values: Record<string, string>;
  bools: Set<string>;
}

function parseFlags(args: string[]): Flags {
  const values: Record<string, string> = {};
  const bools = new Set<string>();
  for (const arg of args) {
    if (arg === "-y") {
      bools.add("yes");
    } else if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) values[body.slice(0, eq)] = body.slice(eq + 1);
      else bools.add(body);
    }
  }
  return { values, bools };
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Shorten a path for display: under the working directory it reads ./x, under
// home it reads ~/x, otherwise it stays absolute.
function shortPath(path: string, ctx: DoctorContext): string {
  if (path === ctx.cwd || path.startsWith(ctx.cwd + sep)) {
    const rest = path.slice(ctx.cwd.length + 1);
    return rest ? "./" + rest : ".";
  }
  if (ctx.home && (path === ctx.home || path.startsWith(ctx.home + sep))) {
    return "~" + path.slice(ctx.home.length);
  }
  return path;
}

async function ask(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer.length ? answer : fallback;
  } finally {
    rl.close();
  }
}

function validScope(scope: string): scope is Scope {
  return scope === "project" || scope === "personal";
}

function formatInstall(results: InstallResult[], version: string, ctx: DoctorContext): string {
  if (results.length === 0) return "Nothing to install: no target directories for those tools.\n";
  const lines = [`Installed the gaffa skills (version ${version}) into ${results.length} place${results.length === 1 ? "" : "s"}:`];
  let anyProject = false;
  for (const r of results) {
    if (r.scope === "project") anyProject = true;
    lines.push(`  ${shortPath(r.dir, ctx)}  (${r.scope})  ${r.written.join(", ")}`);
    if (r.dropped.length) lines.push(`    dropped (gone from source): ${r.dropped.join(", ")}`);
    if (r.kept.length) lines.push(`    left in place, you had edited: ${r.kept.join(", ")}`);
  }
  if (anyProject) {
    lines.push("");
    lines.push("For a project install, commit the skills directory and its .gaffa-skills.json to share it.");
  }
  return lines.join("\n") + "\n";
}

function formatUninstall(results: UninstallResult[], ctx: DoctorContext): string {
  const touched = results.filter((r) => r.removed.length || r.kept.length);
  if (touched.length === 0) return "Nothing to uninstall: no gaffa receipt found for that scope.\n";
  const lines: string[] = [];
  for (const r of touched) {
    lines.push(`${shortPath(r.dir, ctx)}  (${r.scope}): removed ${r.removed.length} file${r.removed.length === 1 ? "" : "s"}`);
    if (r.kept.length) lines.push(`  left in place, you had edited: ${r.kept.join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

// The human words for each outcome, kept short.
const MCP_WORDS: Record<McpResult["outcome"], string> = {
  added: "added",
  updated: "updated",
  unchanged: "already set",
  removed: "removed",
  refused: "could not parse, skipped",
  skipped: "skipped",
};

function formatMcpRegister(results: McpResult[], ctx: DoctorContext): string {
  if (results.length === 0) return "";
  const lines = ["", "Registered the gaffa-docs MCP server:"];
  for (const r of results) {
    const detail = r.detail ? `  (${r.detail})` : "";
    lines.push(`  ${r.label}  ${shortPath(r.path, ctx)}  ${MCP_WORDS[r.outcome]}${detail}`);
  }
  // Claude Code prompts for approval of a project-scoped server on first use.
  const claudeProject = results.some(
    (r) => r.toolId === "claude-code" && r.scope === "project" && (r.outcome === "added" || r.outcome === "updated"),
  );
  if (claudeProject) {
    lines.push("");
    lines.push("Claude Code will ask you to approve the project MCP server the first time you use it.");
  }
  return lines.join("\n") + "\n";
}

function formatMcpUnregister(results: McpResult[], ctx: DoctorContext): string {
  const touched = results.filter((r) => r.outcome !== "skipped" || r.detail);
  if (touched.length === 0) return "";
  const lines = ["", "gaffa-docs MCP server:"];
  for (const r of touched) {
    const detail = r.detail ? `  (${r.detail})` : "";
    lines.push(`  ${r.label}  ${shortPath(r.path, ctx)}  ${MCP_WORDS[r.outcome]}${detail}`);
  }
  return lines.join("\n") + "\n";
}

async function runInstall(flags: Flags): Promise<number> {
  const ctx = processContext();
  const interactive = Boolean(process.stdin.isTTY) && !flags.bools.has("yes");

  // The skills come from npm unless a local checkout is pointed at explicitly.
  const skillsDir = flags.values["skills-dir"] ?? ctx.env["GAFFA_SKILLS_DIR"];
  let source;
  try {
    source = skillsDir ? readLocalSource(skillsDir) : await fetchNpmSource();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  let tools = parseList(flags.values["tools"]);
  if (tools.length === 0) {
    const installed = inspectTools(ctx)
      .filter((r) => r.installed)
      .map((r) => r.id);
    if (interactive) {
      tools = parseList(
        await ask(`Tools to install into [${installed.join(", ") || "none detected"}]: `, installed.join(",")),
      );
    } else {
      tools = installed;
    }
  }
  const unknown = tools.filter((t) => !TOOLS.some((x) => x.id === t));
  if (unknown.length) {
    process.stderr.write(`Unknown tool id: ${unknown.join(", ")}\nKnown: ${IDS}.\n`);
    return 1;
  }
  if (tools.length === 0) {
    process.stderr.write("No tools to install into. Pass --tools, or install a supported tool first.\n");
    return 1;
  }

  let scope = flags.values["scope"];
  if (!scope && interactive) scope = await ask("Scope, project or personal [project]: ", "project");
  scope = scope ?? "project";
  if (!validScope(scope)) {
    process.stderr.write(`Scope must be project or personal, got ${scope}.\n`);
    return 1;
  }

  process.stdout.write(formatInstall(install(ctx, { tools, scope, source }), source.version, ctx));
  if (!flags.bools.has("no-mcp")) {
    process.stdout.write(formatMcpRegister(registerMcp(ctx, { tools, scope }), ctx));
  }
  return 0;
}

async function runUninstall(flags: Flags): Promise<number> {
  const ctx = processContext();
  const interactive = Boolean(process.stdin.isTTY) && !flags.bools.has("yes");

  let scope = flags.values["scope"];
  if (!scope && interactive) scope = await ask("Scope to uninstall, project or personal [project]: ", "project");
  scope = scope ?? "project";
  if (!validScope(scope)) {
    process.stderr.write(`Scope must be project or personal, got ${scope}.\n`);
    return 1;
  }

  process.stdout.write(formatUninstall(uninstall(ctx, scope), ctx));
  if (!flags.bools.has("no-mcp")) {
    process.stdout.write(formatMcpUnregister(unregisterMcp(ctx, scope), ctx));
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  if (args.includes("-v") || args.includes("--version")) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }

  const [command, ...rest] = args;
  const flags = parseFlags(rest);

  if (command === "doctor") {
    process.stdout.write(await runDoctor(processContext(), rest.includes("--json")));
    return 0;
  }
  if (command === "install") return runInstall(flags);
  if (command === "uninstall") return runUninstall(flags);

  process.stderr.write(`Unknown command: ${args.join(" ")}\nRun "gaffa --help" for usage.\n`);
  return 1;
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });

// The AI coding tools the CLI targets, and how to detect each one on disk.
//
// Detection reads config directories rather than a binary on PATH, since an IDE
// extension may put nothing on the path. Every path here is the tool's own
// documented location, cross-checked against the plugin spike (GAF-662) where a
// tool was installed for real. The exact Windows form for Codex and Antigravity
// is the logical expansion of their documented tilde paths (~ becomes the user
// profile), which those tools' own docs do not spell out per OS.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type Scope = "project" | "personal";

// A place a tool reads skills from. `project` is relative to the working
// directory. `personal` is relative to the user's home directory, unless
// `fromConfig` is set, in which case it is relative to the tool's resolved
// config directory so a config env override moves it too.
interface SkillDir {
  scope: Scope;
  fromConfig?: boolean;
  // Path segments under the scope's base, e.g. [".claude", "skills"].
  segments: string[];
}

// A tool's MCP config file at one scope. `project` is relative to the working
// directory, `personal` to the home directory unless `fromConfig` is set, in
// which case it is relative to the tool's resolved config directory.
export interface McpFile {
  scope: Scope;
  fromConfig?: boolean;
  // Base the personal path on the config-env override directory if it is set,
  // else the home directory. Used by a file that sits beside the config dir
  // rather than inside it, like Claude Code's ~/.claude.json which moves to
  // $CLAUDE_CONFIG_DIR/.claude.json when that variable is set.
  fromConfigEnv?: boolean;
  segments: string[];
}

// How to register the gaffa docs MCP server in a tool. Each tool keeps the
// server list under `mcpServers` (JSON) or `[mcp_servers.NAME]` (TOML), but the
// entry shape differs: the field carrying the URL, whether a `type` is required,
// and any fixed extras. All verified against each tool's own docs (GAF-669).
export interface McpConfig {
  format: "json" | "toml";
  files: McpFile[];
  // The field name that carries the server URL in an entry.
  urlKey: "url" | "serverUrl";
  // A `type` the entry needs, if any (Claude Code and Copilot want "http").
  type?: string;
  // Fixed extra fields on the entry (Copilot wants a tools allowlist).
  extra?: Record<string, unknown>;
}

export interface Tool {
  id: string;
  label: string;
  // Environment variable that overrides the config directory, if the tool has one.
  configEnv?: string;
  // Config directory under the home directory, the marker that the tool is installed.
  configSegments: string[];
  skillDirs: SkillDir[];
  // How to register the docs MCP server, if we register it for this tool.
  mcp?: McpConfig;
}

// The gaffa skills we look for. A skill copy is a directory named `gaffa-*` that
// holds a SKILL.md.
const GAFFA_PREFIX = "gaffa-";

export const TOOLS: Tool[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    configEnv: "CLAUDE_CONFIG_DIR",
    configSegments: [".claude"],
    skillDirs: [
      { scope: "project", segments: [".claude", "skills"] },
      { scope: "personal", fromConfig: true, segments: ["skills"] },
    ],
    // user scope writes ~/.claude.json (or $CLAUDE_CONFIG_DIR/.claude.json when
    // that is set), project scope writes .mcp.json.
    mcp: {
      format: "json",
      files: [
        { scope: "personal", fromConfigEnv: true, segments: [".claude.json"] },
        { scope: "project", segments: [".mcp.json"] },
      ],
      urlKey: "url",
      type: "http",
    },
  },
  {
    id: "codex",
    label: "Codex",
    configEnv: "CODEX_HOME",
    configSegments: [".codex"],
    // Codex reads .agents/skills and does not read .claude/skills.
    skillDirs: [
      { scope: "project", segments: [".agents", "skills"] },
      { scope: "personal", segments: [".agents", "skills"] },
    ],
    // TOML, not JSON. HTTP transport is supported on current Codex, older
    // versions were stdio only, so an old install ignores this entry.
    mcp: {
      format: "toml",
      files: [
        { scope: "personal", fromConfig: true, segments: ["config.toml"] },
        { scope: "project", segments: [".codex", "config.toml"] },
      ],
      urlKey: "url",
    },
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    configEnv: "COPILOT_HOME",
    configSegments: [".copilot"],
    skillDirs: [
      { scope: "project", segments: [".agents", "skills"] },
      { scope: "project", segments: [".claude", "skills"] },
      { scope: "personal", fromConfig: true, segments: ["skills"] },
      { scope: "personal", segments: [".agents", "skills"] },
    ],
    // Only the personal file (~/.copilot/mcp-config.json) is documented, so a
    // project install writes no Copilot MCP entry.
    mcp: {
      format: "json",
      files: [{ scope: "personal", fromConfig: true, segments: ["mcp-config.json"] }],
      urlKey: "url",
      type: "http",
      extra: { tools: ["*"] },
    },
  },
  {
    id: "cursor",
    label: "Cursor",
    configSegments: [".cursor"],
    skillDirs: [
      { scope: "project", segments: [".agents", "skills"] },
      { scope: "project", segments: [".claude", "skills"] },
    ],
    mcp: {
      format: "json",
      files: [
        { scope: "personal", segments: [".cursor", "mcp.json"] },
        { scope: "project", segments: [".cursor", "mcp.json"] },
      ],
      urlKey: "url",
    },
  },
  {
    id: "antigravity",
    label: "Antigravity",
    // ~/.gemini/antigravity-cli is Antigravity's own directory. Plain ~/.gemini
    // also belongs to the Gemini CLI, so it would be a false positive.
    configSegments: [".gemini", "antigravity-cli"],
    skillDirs: [
      { scope: "project", segments: [".agents", "skills"] },
      // .agent/skills is the legacy spelling Antigravity still reads.
      { scope: "project", segments: [".agent", "skills"] },
      { scope: "personal", segments: [".gemini", "config", "skills"] },
    ],
    // Antigravity uses serverUrl for remote servers, not url.
    mcp: {
      format: "json",
      files: [
        { scope: "personal", segments: [".gemini", "config", "mcp_config.json"] },
        { scope: "project", segments: [".agents", "mcp_config.json"] },
      ],
      urlKey: "serverUrl",
    },
  },
];

export interface DoctorContext {
  home: string;
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface SkillLocation {
  scope: Scope;
  path: string;
  exists: boolean;
  skills: string[];
}

export interface ToolReport {
  id: string;
  label: string;
  installed: boolean;
  configPath: string;
  skillLocations: SkillLocation[];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// The gaffa skill folders directly under a skills directory, sorted.
function gaffaSkillsIn(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (e) =>
        e.isDirectory() &&
        e.name.startsWith(GAFFA_PREFIX) &&
        existsSync(join(dir, e.name, "SKILL.md")),
    )
    .map((e) => e.name)
    .sort();
}

function configEnvOverride(tool: Tool, ctx: DoctorContext): string | undefined {
  const override = tool.configEnv ? ctx.env[tool.configEnv] : undefined;
  return override && override.length > 0 ? override : undefined;
}

function resolveConfigPath(tool: Tool, ctx: DoctorContext): string {
  return configEnvOverride(tool, ctx) ?? join(ctx.home, ...tool.configSegments);
}

export interface SkillTarget {
  scope: Scope;
  path: string;
}

// The resolved skill directories a tool reads, in the tool's declared order. The
// first target of a given scope is the one to write to: a tool that reads more
// than one dir reads any of them, so install writes the first and does not
// duplicate into the rest.
export function skillTargets(tool: Tool, ctx: DoctorContext): SkillTarget[] {
  const configPath = resolveConfigPath(tool, ctx);
  return tool.skillDirs.map((dir) => {
    let base: string;
    if (dir.scope === "project") base = ctx.cwd;
    else if (dir.fromConfig) base = configPath;
    else base = ctx.home;
    return { scope: dir.scope, path: join(base, ...dir.segments) };
  });
}

export interface McpTarget {
  path: string;
  format: "json" | "toml";
  urlKey: "url" | "serverUrl";
  type?: string;
  extra?: Record<string, unknown>;
}

// The MCP config file to write for a tool at a scope, or undefined if the tool
// has no known MCP location there. Resolves the path the same way skillTargets
// does: project under the working directory, personal under home unless the
// file follows the tool's config directory.
export function mcpTarget(tool: Tool, scope: Scope, ctx: DoctorContext): McpTarget | undefined {
  const mcp = tool.mcp;
  if (!mcp) return undefined;
  const file = mcp.files.find((f) => f.scope === scope);
  if (!file) return undefined;
  let base: string;
  if (file.scope === "project") base = ctx.cwd;
  else if (file.fromConfig) base = resolveConfigPath(tool, ctx);
  else if (file.fromConfigEnv) base = configEnvOverride(tool, ctx) ?? ctx.home;
  else base = ctx.home;
  return {
    path: join(base, ...file.segments),
    format: mcp.format,
    urlKey: mcp.urlKey,
    type: mcp.type,
    extra: mcp.extra,
  };
}

// Inspect every target tool against the given home, working directory and
// environment. Reads the filesystem, writes nothing.
export function inspectTools(ctx: DoctorContext): ToolReport[] {
  return TOOLS.map((tool) => {
    const configPath = resolveConfigPath(tool, ctx);
    const skillLocations = skillTargets(tool, ctx).map((t) => ({
      scope: t.scope,
      path: t.path,
      exists: isDirectory(t.path),
      skills: gaffaSkillsIn(t.path),
    }));
    return {
      id: tool.id,
      label: tool.label,
      installed: isDirectory(configPath),
      configPath,
      skillLocations,
    };
  });
}

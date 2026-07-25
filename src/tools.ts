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

interface Tool {
  id: string;
  label: string;
  // Environment variable that overrides the config directory, if the tool has one.
  configEnv?: string;
  // Config directory under the home directory, the marker that the tool is installed.
  configSegments: string[];
  skillDirs: SkillDir[];
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
  },
  {
    id: "cursor",
    label: "Cursor",
    configSegments: [".cursor"],
    skillDirs: [
      { scope: "project", segments: [".agents", "skills"] },
      { scope: "project", segments: [".claude", "skills"] },
    ],
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

function resolveConfigPath(tool: Tool, ctx: DoctorContext): string {
  const override = tool.configEnv ? ctx.env[tool.configEnv] : undefined;
  if (override && override.length > 0) return override;
  return join(ctx.home, ...tool.configSegments);
}

// Inspect every target tool against the given home, working directory and
// environment. Reads the filesystem, writes nothing.
export function inspectTools(ctx: DoctorContext): ToolReport[] {
  return TOOLS.map((tool) => {
    const configPath = resolveConfigPath(tool, ctx);
    const skillLocations = tool.skillDirs.map((dir) => {
      let base: string;
      if (dir.scope === "project") base = ctx.cwd;
      else if (dir.fromConfig) base = configPath;
      else base = ctx.home;
      const path = join(base, ...dir.segments);
      return {
        scope: dir.scope,
        path,
        exists: isDirectory(path),
        skills: gaffaSkillsIn(path),
      };
    });
    return {
      id: tool.id,
      label: tool.label,
      installed: isDirectory(configPath),
      configPath,
      skillLocations,
    };
  });
}

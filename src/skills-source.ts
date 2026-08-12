// Where the skills come from. Today they are read from a local gaffa-for-ai
// checkout, pointed at with --skills-dir or GAFFA_SKILLS_DIR. When the skills
// ship as a versioned npm package (GAF-705) npm resolution slots in here and the
// rest of install does not change. If resolving the source fails it throws, so
// install stops before it touches anything on disk.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const GAFFA_PREFIX = "gaffa-";

export interface SourceSkill {
  name: string; // the gaffa-* directory name
  dir: string; // absolute path to the skill directory in the source
}

export interface SkillSource {
  version: string;
  skills: SourceSkill[];
}

// Read the gaffa-* skill directories (each holding a SKILL.md) from a local
// source directory. Throws if the directory is missing or holds no skills.
export function readLocalSource(skillsDir: string): SkillSource {
  let entries;
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    throw new Error(`skills source not found: ${skillsDir}`);
  }
  const skills = entries
    .filter(
      (e) =>
        e.isDirectory() &&
        e.name.startsWith(GAFFA_PREFIX) &&
        existsSync(join(skillsDir, e.name, "SKILL.md")),
    )
    .map((e) => ({ name: e.name, dir: join(skillsDir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (skills.length === 0) throw new Error(`no gaffa skills found in ${skillsDir}`);
  return { version: readSourceVersion(skillsDir), skills };
}

// The source's version, from its package.json if the checkout has one, else a
// local placeholder until GAF-705 gives the skills a published version.
function readSourceVersion(skillsDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(skillsDir, "package.json"), "utf8")) as {
      version?: string;
    };
    if (pkg.version) return pkg.version;
  } catch {
    /* no package.json, fall through to the placeholder */
  }
  return "0.0.0-local";
}

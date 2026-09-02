// Where the skills come from. By default they are fetched from npm as the
// latest published @gaffa-dev/skills, so a skill change reaches users without a
// CLI release. A local gaffa-for-ai checkout can be used instead, pointed at
// with --skills-dir or GAFFA_SKILLS_DIR. If resolving the source fails it
// throws, so install stops before it touches anything on disk.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GAFFA_PREFIX = "gaffa-";

export const SKILLS_PACKAGE = "@gaffa-dev/skills";
const LATEST_URL = `https://registry.npmjs.org/${SKILLS_PACKAGE}/latest`;
const FETCH_TIMEOUT_MS = 10_000;

export interface SourceSkill {
  name: string; // the gaffa-* directory name
  dir: string; // absolute path to the skill directory in the source
}

export interface SkillSource {
  version: string;
  skills: SourceSkill[];
}

// The gaffa-* skill directories (each holding a SKILL.md) directly under a
// directory. Throws if there are none, naming the directory.
function readSkills(skillsDir: string): SourceSkill[] {
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
  return skills;
}

// Read the skills from a local source directory. Throws if the directory is
// missing or holds no skills.
export function readLocalSource(skillsDir: string): SkillSource {
  return { version: readSourceVersion(skillsDir), skills: readSkills(skillsDir) };
}

// The local source's version, from its package.json if the checkout has one,
// else a placeholder that marks the copy as local.
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

// What the registry reports for the latest published version.
interface LatestMetadata {
  version: string;
  tarballUrl: string;
}

async function fetchLatestMetadata(fetchImpl: typeof fetch): Promise<LatestMetadata> {
  let response;
  try {
    response = await fetchImpl(LATEST_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new Error(`Could not reach the npm registry for ${SKILLS_PACKAGE}.`);
  }
  if (!response.ok) {
    throw new Error(`The npm registry returned ${response.status} for ${SKILLS_PACKAGE}.`);
  }
  const doc = (await response.json()) as { version?: string; dist?: { tarball?: string } };
  if (!doc.version || !doc.dist?.tarball) {
    throw new Error(`Unexpected registry answer for ${SKILLS_PACKAGE}.`);
  }
  return { version: doc.version, tarballUrl: doc.dist.tarball };
}

// The latest published skills version, for the doctor version check. Throws if
// the registry cannot be reached, the caller decides how loud to be.
export async function fetchLatestVersion(fetchImpl: typeof fetch = fetch): Promise<string> {
  return (await fetchLatestMetadata(fetchImpl)).version;
}

// Fetch the latest published skills from npm: resolve the version, download the
// tarball and unpack it into a temp directory. Throws with a clear message on
// any failure, so install writes nothing.
export async function fetchNpmSource(fetchImpl: typeof fetch = fetch): Promise<SkillSource> {
  const meta = await fetchLatestMetadata(fetchImpl);
  let response;
  try {
    response = await fetchImpl(meta.tarballUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new Error(`Could not download ${SKILLS_PACKAGE} ${meta.version} from npm.`);
  }
  if (!response.ok) {
    throw new Error(`Downloading ${SKILLS_PACKAGE} ${meta.version} returned ${response.status}.`);
  }
  const dir = mkdtempSync(join(tmpdir(), "gaffa-skills-"));
  const tarball = join(dir, "skills.tgz");
  writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  const tar = spawnSync("tar", ["-xzf", tarball, "-C", dir]);
  if (tar.status !== 0) {
    const detail = tar.error ? tar.error.message : tar.stderr.toString().trim();
    throw new Error(`Could not unpack the skills tarball: ${detail}`);
  }
  // npm tarballs unpack to package/, the skills sit in its skills directory.
  return { version: meta.version, skills: readSkills(join(dir, "package", "skills")) };
}

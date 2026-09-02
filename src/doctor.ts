// `gaffa doctor`: report which target tools are installed, where they keep their
// config, and whether the gaffa skills are already in place. Reads only, writes
// nothing.

import { homedir } from "node:os";
import { sep } from "node:path";
import { inspectTools, type DoctorContext, type ToolReport } from "./tools.js";
import { readReceipt } from "./receipt.js";
import { fetchLatestVersion } from "./skills-source.js";

// Replace a leading home directory with ~ for a shorter, readable path. Only
// when home is the whole path or a real path prefix, so /Users/dom does not turn
// /Users/dominic into ~inic.
function short(path: string, home: string): string {
  if (home.length === 0) return path;
  if (path === home) return "~";
  if (path.startsWith(home + sep)) return "~" + path.slice(home.length);
  return path;
}

function skillSummary(report: ToolReport, home: string): string[] {
  const lines: string[] = [];
  for (const loc of report.skillLocations) {
    if (loc.skills.length === 0) continue;
    lines.push(`  skills  ${loc.skills.join(", ")}  (${loc.scope}: ${short(loc.path, home)})`);
  }
  return lines;
}

export function formatHuman(reports: ToolReport[], home: string): string {
  const blocks = reports.map((report) => {
    const lines = [
      `${report.label}  ${report.installed ? "installed" : "not found"}`,
      `  config  ${short(report.configPath, home)}${report.installed ? "" : " (not present)"}`,
    ];
    const skills = skillSummary(report, home);
    if (skills.length > 0) {
      lines.push(...skills);
    } else if (report.installed) {
      lines.push("  skills  none found");
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n") + "\n";
}

export function formatJson(reports: ToolReport[]): string {
  return JSON.stringify({ tools: reports }, null, 2) + "\n";
}

// True when latest is a higher version than installed, by numeric x.y.z parts.
// Good enough for our published versions plus the 0.0.0-local placeholder, and
// a version it cannot read never triggers the line.
function isNewer(latest: string, installed: string): boolean {
  const parts = (v: string) => v.split("-")[0].split(".").map(Number);
  const [a, b] = [parts(latest), parts(installed)];
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

// The version check for loose-file installs: compare the oldest installed
// receipt against the latest published skills, and say when a newer one exists.
// Prints at most one line, writes nothing, and an unreachable registry is
// reported rather than failing the doctor run.
async function versionCheck(
  reports: ToolReport[],
  fetchLatest: () => Promise<string>,
): Promise<string> {
  const dirs = new Set(reports.flatMap((r) => r.skillLocations.map((l) => l.path)));
  const installed = [...dirs]
    .map((dir) => readReceipt(dir)?.version)
    .filter((v): v is string => Boolean(v));
  if (installed.length === 0) return "";
  const oldest = installed.reduce((min, v) => (isNewer(min, v) ? v : min));
  let latest;
  try {
    latest = await fetchLatest();
  } catch {
    return "\nCould not check npm for a newer skills version.\n";
  }
  if (!isNewer(latest, oldest)) return "";
  return `\nA newer skills version is published: ${latest} (installed ${oldest}). Run gaffa install to refresh.\n`;
}

// Build the doctor report as text. `json` selects the machine-readable form,
// which skips the version check to stay offline and stable.
export async function runDoctor(
  ctx: DoctorContext,
  json: boolean,
  fetchLatest: () => Promise<string> = fetchLatestVersion,
): Promise<string> {
  const reports = inspectTools(ctx);
  if (json) return formatJson(reports);
  return formatHuman(reports, ctx.home) + (await versionCheck(reports, fetchLatest));
}

// Context from the real process, used by the CLI. Kept separate so tests can
// drive runDoctor with a controlled home, working directory and environment.
export function processContext(): DoctorContext {
  return { home: homedir(), cwd: process.cwd(), env: process.env };
}

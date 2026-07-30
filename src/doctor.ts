// `gaffa doctor`: report which target tools are installed, where they keep their
// config, and whether the gaffa skills are already in place. Reads only, writes
// nothing.

import { homedir } from "node:os";
import { sep } from "node:path";
import { inspectTools, type DoctorContext, type ToolReport } from "./tools.js";

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

// Build the doctor report as text. `json` selects the machine-readable form.
export function runDoctor(ctx: DoctorContext, json: boolean): string {
  const reports = inspectTools(ctx);
  return json ? formatJson(reports) : formatHuman(reports, ctx.home);
}

// Context from the real process, used by the CLI. Kept separate so tests can
// drive runDoctor with a controlled home, working directory and environment.
export function processContext(): DoctorContext {
  return { home: homedir(), cwd: process.cwd(), env: process.env };
}

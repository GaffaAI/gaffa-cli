// Register the Gaffa docs MCP server in each tool's own MCP config, and remove
// it again on uninstall.
//
// The same install that writes the skills registers the docs MCP at every
// selected tool that has a known MCP config location for the chosen scope. Each
// tool keeps its servers differently (see tools.ts): four use JSON under a
// `mcpServers` key, Codex uses TOML under `[mcp_servers.NAME]`, and the field
// carrying the URL is `url` for most but `serverUrl` for Antigravity.
//
// We own the name `gaffa-docs`, so a register overwrites our own entry (an
// idempotent refresh) and an uninstall removes it only when it still points at
// our URL, so a server the user re-pointed is left alone. A JSON file we cannot
// parse is backed up and left untouched rather than clobbered. Codex TOML has no
// parser here, so those edits are surgical: append our table, or replace the one
// we recognise by its header.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { TOOLS, mcpTarget, type DoctorContext, type McpTarget, type Scope } from "./tools.js";

export const MCP_NAME = "gaffa-docs";
export const MCP_URL = "https://gaffa.dev/docs/~gitbook/mcp";

export type McpOutcome = "added" | "updated" | "unchanged" | "removed" | "refused" | "skipped";

export interface McpResult {
  toolId: string;
  label: string;
  scope: Scope;
  path: string;
  outcome: McpOutcome;
  // Extra context: the backup path on a refusal, or why we skipped or noted.
  detail?: string;
}

// The server entry we write, in the shape the tool expects.
function buildEntry(target: McpTarget): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  if (target.type) entry.type = target.type;
  entry[target.urlKey] = MCP_URL;
  if (target.extra) Object.assign(entry, target.extra);
  return entry;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// A parsed JSON config object, or "malformed" when the text is not a JSON object
// we can safely edit (invalid JSON, or an mcpServers that is not an object).
type ParsedJson = { obj: Record<string, unknown>; servers: Record<string, unknown> } | "malformed";

function parseJson(text: string | null): ParsedJson {
  if (text === null || text.trim() === "") return { obj: {}, servers: {} };
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return "malformed";
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return "malformed";
  const record = obj as Record<string, unknown>;
  const existing = record.mcpServers;
  if (existing === undefined) return { obj: record, servers: {} };
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return "malformed";
  return { obj: record, servers: existing as Record<string, unknown> };
}

function backup(path: string, text: string): string {
  const bak = `${path}.gaffa.bak`;
  writeFileSync(bak, text);
  return bak;
}

function registerJson(target: McpTarget): Omit<McpResult, "toolId" | "label" | "scope"> {
  const text = readTextOrNull(target.path);
  const parsed = parseJson(text);
  if (parsed === "malformed") {
    const bak = backup(target.path, text ?? "");
    return { path: target.path, outcome: "refused", detail: `left it, backed up to ${bak}` };
  }
  const { obj, servers } = parsed;
  const entry = buildEntry(target);
  const existing = servers[MCP_NAME];
  const existingObj = isObject(existing) ? existing : undefined;
  const collision = existingObj !== undefined && existingObj[target.urlKey] !== MCP_URL;
  if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(entry)) {
    return { path: target.path, outcome: "unchanged" };
  }
  servers[MCP_NAME] = entry;
  obj.mcpServers = servers;
  writeText(target.path, JSON.stringify(obj, null, 2) + "\n");
  return {
    path: target.path,
    outcome: existing === undefined ? "added" : "updated",
    detail: collision ? "replaced a different gaffa-docs entry" : undefined,
  };
}

// Codex TOML. We only ever write our own table, and only touch our own on edits.
const TOML_HEADER = `[mcp_servers.${MCP_NAME}]`;

function tomlBlock(): string {
  return `${TOML_HEADER}\nurl = "${MCP_URL}"\n`;
}

// A table header line with any trailing comment and surrounding whitespace
// stripped, or null if the line is not a table header.
function tableHeader(line: string): string | null {
  if (!line.trimStart().startsWith("[")) return null;
  const hash = line.indexOf("#");
  return (hash === -1 ? line : line.slice(0, hash)).trim();
}

// Our table, tolerating the equivalent quoted-key spelling of the same name.
function isOurHeader(line: string): boolean {
  const h = tableHeader(line);
  return h === TOML_HEADER || h === `[mcp_servers."${MCP_NAME}"]`;
}

// A sub-table of ours, e.g. [mcp_servers.gaffa-docs.http_headers].
function isOurSubHeader(line: string): boolean {
  const h = tableHeader(line);
  return h !== null && (h.startsWith(`[mcp_servers.${MCP_NAME}.`) || h.startsWith(`[mcp_servers."${MCP_NAME}".`));
}

// The line range [start, end) covering our table and any sub-tables of it. end
// stops before the next unrelated section and does not swallow trailing blank or
// comment lines, which belong to whatever follows.
function findTomlTable(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex(isOurHeader);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length) {
    if (tableHeader(lines[end]) !== null && !isOurHeader(lines[end]) && !isOurSubHeader(lines[end])) break;
    end++;
  }
  while (end > start + 1 && (lines[end - 1].trim() === "" || lines[end - 1].trim().startsWith("#"))) end--;
  return { start, end };
}

function registerToml(target: McpTarget): Omit<McpResult, "toolId" | "label" | "scope"> {
  const text = readTextOrNull(target.path);
  const block = tomlBlock();
  if (text === null || text.trim() === "") {
    writeText(target.path, block);
    return { path: target.path, outcome: "added" };
  }
  const lines = text.split("\n");
  const range = findTomlTable(lines);
  if (!range) {
    const trimmed = text.replace(/\s*$/, "");
    writeText(target.path, `${trimmed}\n\n${block}`);
    return { path: target.path, outcome: "added" };
  }
  const current = lines.slice(range.start, range.end).join("\n").trimEnd();
  if (current === block.trimEnd()) return { path: target.path, outcome: "unchanged" };
  const tail = lines.slice(range.end);
  // Keep a blank line between our table and a following section.
  const sep = tail.length && tail[0].trimStart().startsWith("[") ? [""] : [];
  const next = [...lines.slice(0, range.start), ...block.trimEnd().split("\n"), ...sep, ...tail];
  const out = next.join("\n");
  writeText(target.path, out.endsWith("\n") ? out : out + "\n");
  return { path: target.path, outcome: "updated" };
}

function unregisterJson(target: McpTarget): Omit<McpResult, "toolId" | "label" | "scope"> {
  const text = readTextOrNull(target.path);
  if (text === null) return { path: target.path, outcome: "skipped" };
  const parsed = parseJson(text);
  if (parsed === "malformed") return { path: target.path, outcome: "skipped", detail: "could not parse it, left it" };
  const { obj, servers } = parsed;
  const existing = servers[MCP_NAME];
  if (existing === undefined) return { path: target.path, outcome: "skipped" };
  if (!isObject(existing) || existing[target.urlKey] !== MCP_URL) {
    return { path: target.path, outcome: "skipped", detail: "left a gaffa-docs that points elsewhere" };
  }
  delete servers[MCP_NAME];
  if (Object.keys(servers).length === 0) delete obj.mcpServers;
  if (Object.keys(obj).length === 0) rmSync(target.path, { force: true });
  else writeText(target.path, JSON.stringify(obj, null, 2) + "\n");
  return { path: target.path, outcome: "removed" };
}

function unregisterToml(target: McpTarget): Omit<McpResult, "toolId" | "label" | "scope"> {
  const text = readTextOrNull(target.path);
  if (text === null) return { path: target.path, outcome: "skipped" };
  const lines = text.split("\n");
  const range = findTomlTable(lines);
  if (!range) return { path: target.path, outcome: "skipped" };
  const block = lines.slice(range.start, range.end).join("\n");
  if (!block.includes(`"${MCP_URL}"`)) {
    return { path: target.path, outcome: "skipped", detail: "left a gaffa-docs that points elsewhere" };
  }
  // Remove only our table, plus the single blank separator line we added before
  // it on append. The rest of the user's config is left untouched, apart from
  // normalising the file to a single trailing newline.
  let start = range.start;
  if (start > 0 && lines[start - 1].trim() === "") start--;
  const rest = [...lines.slice(0, start), ...lines.slice(range.end)].join("\n");
  if (rest.trim() === "") rmSync(target.path, { force: true });
  else writeText(target.path, rest.endsWith("\n") ? rest : rest + "\n");
  return { path: target.path, outcome: "removed" };
}

export interface RegisterOptions {
  tools: string[];
  scope: Scope;
}

// Register the docs MCP for the selected tools at a scope. A tool with no MCP
// location for that scope is left out of the results, not reported as skipped.
export function registerMcp(ctx: DoctorContext, opts: RegisterOptions): McpResult[] {
  const results: McpResult[] = [];
  for (const id of opts.tools) {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool) continue;
    const target = mcpTarget(tool, opts.scope, ctx);
    if (!target) continue;
    const base = target.format === "toml" ? registerToml(target) : registerJson(target);
    results.push({ toolId: tool.id, label: tool.label, scope: opts.scope, ...base });
  }
  return results;
}

// Remove the docs MCP for a scope from every tool that could hold it. Mirrors
// uninstall, which reverses across all tools rather than a chosen set.
export function unregisterMcp(ctx: DoctorContext, scope: Scope): McpResult[] {
  const results: McpResult[] = [];
  for (const tool of TOOLS) {
    const target = mcpTarget(tool, scope, ctx);
    if (!target) continue;
    const base = target.format === "toml" ? unregisterToml(target) : unregisterJson(target);
    if (base.outcome === "skipped" && !base.detail) continue;
    results.push({ toolId: tool.id, label: tool.label, scope, ...base });
  }
  return results;
}

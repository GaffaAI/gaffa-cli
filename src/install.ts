// gaffa install / uninstall.
//
// install copies the gaffa skills into each selected tool's skills directory and
// writes a receipt beside them. A second install refreshes to the current source
// and drops skills we wrote that the source no longer has. uninstall reverses an
// install for a scope: it removes the files the receipt records, but leaves any
// the user edited since (their hash no longer matches) and reports them.
//
// The logic takes an explicit context, source and scope so tests can drive it
// against temp directories. The CLI builds those from the real process.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { TOOLS, skillTargets, type DoctorContext, type Scope, type Tool } from "./tools.js";
import type { SkillSource } from "./skills-source.js";
import {
  RECEIPT_NAME,
  fileSha256,
  readReceipt,
  writeReceipt,
  type ReceiptFile,
} from "./receipt.js";

// The single directory install writes to for a tool at a scope: the first target
// of that scope, since a tool reads any of the dirs it looks in, so writing one
// is enough and writing all of them would duplicate the skills.
function writeDirFor(tool: Tool, scope: Scope, ctx: DoctorContext): string | undefined {
  return skillTargets(tool, ctx).find((t) => t.scope === scope)?.path;
}

// The distinct directories to write for the selected tools at a scope. Several
// tools can resolve to the same directory (for example .agents/skills), so the
// result is de-duplicated: one physical dir, one receipt.
export function writeDirs(toolIds: string[], scope: Scope, ctx: DoctorContext): string[] {
  const dirs = new Set<string>();
  for (const id of toolIds) {
    const tool = TOOLS.find((t) => t.id === id);
    const dir = tool && writeDirFor(tool, scope, ctx);
    if (dir) dirs.add(dir);
  }
  return [...dirs];
}

// Every file under root, as paths relative to base, forward-slashed and sorted.
function walkFiles(root: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out.sort();
}

// The skill a receipt-relative path belongs to (its first segment).
function skillOf(path: string): string {
  return path.split("/")[0];
}

type RemoveOutcome = "removed" | "kept" | "absent";

// Remove a recorded file if it still matches its hash. If the user edited it the
// hash differs, so it is left in place and reported as kept. Already gone counts
// as absent, no error.
function tryRemove(dir: string, file: ReceiptFile): RemoveOutcome {
  const full = join(dir, file.path);
  if (!existsSync(full)) return "absent";
  if (fileSha256(full) === file.sha256) {
    rmSync(full);
    return "removed";
  }
  return "kept";
}

// Remove empty directories inside one skill directory, deepest first, and the
// skill directory itself if it ends up empty. Confined to a single gaffa-owned
// skill tree, so it never touches a sibling skill or the shared skills directory.
function pruneSkillDir(skillDir: string): void {
  if (!existsSync(skillDir)) return;
  for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneSkillDir(join(skillDir, entry.name));
  }
  if (readdirSync(skillDir).length === 0) rmSync(skillDir, { recursive: true });
}

export interface InstallResult {
  dir: string;
  scope: Scope;
  written: string[]; // skills copied in
  dropped: string[]; // retired skills removed on a refresh
  kept: string[]; // files left because the user had edited them
}

export interface InstallOptions {
  tools: string[];
  scope: Scope;
  source: SkillSource;
}

export function install(ctx: DoctorContext, opts: InstallOptions): InstallResult[] {
  const sourceNames = new Set(opts.source.skills.map((s) => s.name));
  return writeDirs(opts.tools, opts.scope, ctx).map((dir) => {
    const kept: string[] = [];
    const dropped = new Set<string>();
    mkdirSync(dir, { recursive: true });

    // Refresh: drop skills we wrote before that the source no longer has, then
    // tidy each now-empty retired skill directory.
    const prior = readReceipt(dir);
    if (prior) {
      for (const f of prior.files) {
        const skill = skillOf(f.path);
        if (sourceNames.has(skill)) continue;
        dropped.add(skill);
        if (tryRemove(dir, f) === "kept") kept.push(f.path);
      }
      for (const skill of dropped) pruneSkillDir(join(dir, skill));
    }

    // Copy the current source skills in, overwriting our earlier copies.
    for (const skill of opts.source.skills) {
      cpSync(skill.dir, join(dir, skill.name), { recursive: true });
    }

    // Record the files the source provided, hashed from what was written. Walking
    // the source rather than the destination keeps a file the user dropped inside
    // a skill dir out of the receipt, so uninstall never removes it.
    const files: ReceiptFile[] = [];
    for (const skill of opts.source.skills) {
      for (const rel of walkFiles(skill.dir, skill.dir)) {
        const path = `${skill.name}/${rel}`;
        files.push({ path, sha256: fileSha256(join(dir, path)) });
      }
    }
    writeReceipt(dir, { version: opts.source.version, scope: opts.scope, files });

    return {
      dir,
      scope: opts.scope,
      written: opts.source.skills.map((s) => s.name),
      dropped: [...dropped].sort(),
      kept: kept.sort(),
    };
  });
}

export interface UninstallResult {
  dir: string;
  scope: Scope;
  removed: string[]; // files removed
  kept: string[]; // files left because the user had edited them
}

// Reverse an install for a scope. For every directory with a receipt, remove the
// files it recorded whose content still matches and leave any the user edited. A
// directory with nothing left loses its receipt. One with edited files keeps a
// receipt pruned to just those, so it stays self-describing.
export function uninstall(ctx: DoctorContext, scope: Scope): UninstallResult[] {
  const results: UninstallResult[] = [];
  for (const dir of writeDirs(TOOLS.map((t) => t.id), scope, ctx)) {
    const receipt = readReceipt(dir);
    if (!receipt) continue;
    const removed: string[] = [];
    const kept: string[] = [];
    for (const f of receipt.files) {
      const outcome = tryRemove(dir, f);
      if (outcome === "removed") removed.push(f.path);
      else if (outcome === "kept") kept.push(f.path);
    }
    for (const skill of new Set(receipt.files.map((f) => skillOf(f.path)))) {
      pruneSkillDir(join(dir, skill));
    }
    if (kept.length === 0) {
      rmSync(join(dir, RECEIPT_NAME), { force: true });
    } else {
      writeReceipt(dir, { ...receipt, files: receipt.files.filter((f) => kept.includes(f.path)) });
    }
    results.push({ dir, scope, removed: removed.sort(), kept: kept.sort() });
  }
  return results;
}

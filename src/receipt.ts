// The install receipt: a per-directory record of the skill files gaffa wrote
// there. One receipt sits in each skills directory we write to. It lets
// uninstall remove exactly what we wrote, and lets uninstall and doctor tell an
// untouched copy from one the user has edited, by comparing the recorded hash to
// what is on disk. Paths and hashes only, so a project-scope receipt is safe to
// commit with the repo.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Scope } from "./tools.js";

export const RECEIPT_NAME = ".gaffa-skills.json";

export interface ReceiptFile {
  // Path relative to the receipt's own directory, always forward-slashed.
  path: string;
  sha256: string;
}

export interface Receipt {
  version: string;
  scope: Scope;
  files: ReceiptFile[];
}

export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readReceipt(dir: string): Receipt | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, RECEIPT_NAME), "utf8")) as Receipt;
    if (!Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeReceipt(dir: string, receipt: Receipt): void {
  const files = [...receipt.files].sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(join(dir, RECEIPT_NAME), JSON.stringify({ ...receipt, files }, null, 2) + "\n");
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchLatestVersion, fetchNpmSource } from "../dist/skills-source.js";

function tmp() {
  return mkdtempSync(join(tmpdir(), "gaffa-source-"));
}

// A gzipped tarball shaped like an npm one: a package/ root with the skills
// inside, built with the same tar the code unpacks with.
function makeTarball(dir) {
  mkdirSync(join(dir, "package", "skills", "gaffa-find"), { recursive: true });
  writeFileSync(join(dir, "package", "skills", "gaffa-find", "SKILL.md"), "find\n");
  execFileSync("tar", ["-czf", join(dir, "skills.tgz"), "-C", dir, "package"]);
  return readFileSync(join(dir, "skills.tgz"));
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function bytesResponse(buffer) {
  return { ok: true, status: 200, arrayBuffer: async () => buffer };
}

const metadata = {
  version: "0.1.0",
  dist: { tarball: "https://registry.npmjs.org/@gaffa-dev/skills/-/skills-0.1.0.tgz" },
};

test("fetchNpmSource resolves latest, unpacks the tarball and reads the skills", async () => {
  const dir = tmp();
  try {
    const tarball = makeTarball(dir);
    const source = await fetchNpmSource(async (url) =>
      String(url).endsWith("/latest") ? jsonResponse(metadata) : bytesResponse(tarball),
    );
    assert.equal(source.version, "0.1.0");
    assert.deepEqual(
      source.skills.map((s) => s.name),
      ["gaffa-find"],
    );
    assert.equal(readFileSync(join(source.skills[0].dir, "SKILL.md"), "utf8"), "find\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fetchNpmSource fails clearly when the registry is unreachable", async () => {
  await assert.rejects(
    fetchNpmSource(async () => {
      throw new Error("network down");
    }),
    /Could not reach the npm registry/,
  );
});

test("fetchNpmSource fails clearly on a registry error status", async () => {
  await assert.rejects(
    fetchNpmSource(async () => ({ ok: false, status: 404 })),
    /returned 404/,
  );
});

test("fetchNpmSource fails clearly when the tarball download breaks", async () => {
  await assert.rejects(
    fetchNpmSource(async (url) => {
      if (String(url).endsWith("/latest")) return jsonResponse(metadata);
      throw new Error("network down");
    }),
    /Could not download/,
  );
});

test("fetchLatestVersion returns the published version", async () => {
  assert.equal(await fetchLatestVersion(async () => jsonResponse(metadata)), "0.1.0");
});

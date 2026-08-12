# @gaffa-dev/cli

The Gaffa command line tool for setting your AI coding tools up with the Gaffa
skills.

## Use it

No install needed, run it through npx:

```
npx @gaffa-dev/cli --help
npx @gaffa-dev/cli --version
```

### doctor

`doctor` reports which of the supported tools are on your machine, where each
keeps its config, and whether the gaffa skills are already set up in it. It reads
only and writes nothing.

```
npx @gaffa-dev/cli doctor
npx @gaffa-dev/cli doctor --json
```

Supported tools: Claude Code, Codex, GitHub Copilot, Cursor and Antigravity.
Each is detected by its config directory rather than a binary on the path, since
an IDE may put nothing on the path. `--json` prints the same result as structured
output for scripts.

## Develop

```
npm install
npm run build
npm test
npm run lint
```

The entry point is `src/cli.ts`, compiled to `dist/cli.js` by `tsc`. Tests run
the built binary and check its output, so `npm test` builds first.

## Release

Pushing a version tag runs the publish workflow, which lints, builds, tests, then
publishes to npm with provenance.

Main only takes pull requests, so bump `package.json` on a branch and deliver it
as a pull request. Once that merges, tag the merge commit on main and push the
tag. Tagging the branch commit instead would leave the tag pointing at a commit
the squash merge discards.

```
git tag v0.0.2 <merge commit>
git push origin v0.0.2
```

A plain tag (`v0.0.1`) publishes under `latest`. A prerelease tag (`v0.0.1-rc.1`)
publishes under `next`, so it is opt-in and a bad one can be dropped without
touching anyone on `latest`. Every pull request runs `npm pack --dry-run` on
Windows, macOS and Linux, so packaging problems show up before a real release.

The final package name is not fixed. `gaffa` is taken on npm, so the skeleton
uses `@gaffa-dev/cli` for now.

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

Supported tools: Claude Code, Codex, GitHub Copilot, Cursor, Antigravity and Pi.
Each is detected by its config directory rather than a binary on the path, since
an IDE may put nothing on the path. `--json` prints the same result as structured
output for scripts.

### install

`install` copies the gaffa skills into the tools you pick and writes a receipt
next to them, so a later uninstall knows exactly what it wrote.

```
npx @gaffa-dev/cli install
npx @gaffa-dev/cli install --tools=claude-code,codex --scope=personal
```

With no flags it asks which tools (defaulting to the ones it detects) and which
scope. Pass `--tools`, `--scope` and `-y` to run it unattended, for example in
CI. `--scope=project` writes into the working directory so you can commit the
skills with the repo, `--scope=personal` writes into your home config. A second
install refreshes to the current skills and drops any it wrote before that no
longer exist.

The install command fetches the published skills from npm. To use a local
checkout instead, point it at one with `--skills-dir` or `GAFFA_SKILLS_DIR`.

The same run also registers the Gaffa docs MCP server (`https://gaffa.dev/docs/~gitbook/mcp`)
in each tool's own MCP config, merging into an existing config without touching
your other servers. A config it cannot parse is backed up and left alone. Pass
`--no-mcp` to skip this. At project scope Claude Code will ask you to approve the
server the first time you use it.

### uninstall

`uninstall` removes the skills a previous install wrote, for a scope, and the
docs MCP server it registered. A skill you have edited since is left in place and
reported, so your own changes are never lost. An MCP entry you have re-pointed
elsewhere is left alone. Pass `--no-mcp` to keep the server registered.

```
npx @gaffa-dev/cli uninstall --scope=project
```

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

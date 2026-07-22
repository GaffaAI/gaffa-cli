# @gaffa-dev/cli

The Gaffa command line tool. This is the skeleton. It ships with `--version` and
`--help` and nothing else yet, and exists to prove the release path before there
is anything real to release.

## Use it

No install needed, run it through npx:

```
npx @gaffa-dev/cli --help
npx @gaffa-dev/cli --version
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

```
npm version patch      # bumps package.json and creates the tag
git push --follow-tags
```

A plain tag (`v0.0.1`) publishes under `latest`. A prerelease tag (`v0.0.1-rc.1`)
publishes under `next`, so it is opt-in and a bad one can be dropped without
touching anyone on `latest`. Every pull request runs `npm publish --dry-run` on
Windows, macOS and Linux, so packaging problems show up before a real release.

The final package name is not fixed. `gaffa` is taken on npm, so the skeleton
uses `@gaffa-dev/cli` for now.

# Contributing

## Required checks

Run these commands before opening a pull request:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm validate:package
```

`validate:package` builds the package, packs it, installs the tarball in a
clean temporary consumer project, and checks its runtime import and TypeScript
declarations.

## Releasing

1. Update `package.json` and `CHANGELOG.md` according to Semantic Versioning.
2. Merge the release commit to `main` after all required checks pass.
3. Create and push a matching `v<version>` tag.
4. Review the `Publish to npm` GitHub Actions run and its npm provenance.

Before the first release, an npm owner must configure this repository's
`publish.yml` workflow as a trusted publisher for `@gammaswap/v2-tradingbot`
on npm. The workflow uses GitHub Actions OIDC and does not require a long-lived
npm publish token.

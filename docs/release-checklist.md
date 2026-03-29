# Release Checklist

Use this for every tagged desktop release.

## Before Tagging

- Run `npm run validate`
- Run `npm run test:e2e:cli-smoke`
- Run `npm run test:e2e:desktop-stable`
- Run `npm run audit:prod`
- Run `npm run pack:desktop`
- Run `npm run test:e2e:desktop-packaged-smoke`
- Run `npm run release:notes -- --check`
- Run `npm run sbom:prod -- --check`
- Verify the generated icons are current with `npm run generate:icons` if branding changed
- Refresh screenshots and README demo media if the UX changed materially
- Update `CHANGELOG.md`
- Confirm install/config docs are still accurate
- Confirm [docs/support-matrix.md](support-matrix.md) still matches the shipped surface area

## Before Publishing Assets

- Check `docs/install.md`
- Check `docs/support-matrix.md`
- Check `docs/configuration.md`
- Check `docs/known-limitations.md`
- Check `docs/release-notes-template.md`
- Check `docs/sbom.production.cdx.json`
- Confirm support/security contacts are still current
- Confirm release notes call out prerequisites, platform support, runtime support, and known issues
- Confirm macOS signing and notarization credentials are present
- Confirm Windows signing credentials are present
- Confirm the git tag matches `package.json` version
- Confirm macOS and Windows have manual RC task-flow signoff in addition to automated launch/preflight proof

## Asset Handling

- Commit the small README GIF if it changed
- Keep larger MP4/WebM demo assets out of git history
- Upload packaged binaries, `SHA256SUMS.txt`, `sbom.production.cdx.json`, and long-form demo assets to the release bundle

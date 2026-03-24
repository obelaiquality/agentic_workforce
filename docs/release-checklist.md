# Release Checklist

Use this for tagged releases or any serious beta cut.

## Before Tagging

- Run `npm run validate`
- Run `npm run test:e2e:desktop-stable`
- Run `npm run pack:desktop`
- Run `npm run test:e2e:desktop-packaged-smoke`
- Refresh screenshots and README demo media if the UX changed materially
- Update `CHANGELOG.md`
- Confirm install/config docs are still accurate

## Before Publishing Assets

- Check `docs/install.md`
- Check `docs/configuration.md`
- Check `docs/known-limitations.md`
- Confirm support/security contacts are still current
- Confirm release notes call out prerequisites and advanced caveats

## Asset Handling

- Commit the small README GIF if it changed
- Keep larger MP4/WebM demo assets out of git history
- Upload packaged binaries and long-form demo assets to the release bundle

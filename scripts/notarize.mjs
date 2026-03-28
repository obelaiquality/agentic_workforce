import { notarize } from "@electron/notarize";

export default async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const strictSigning = process.env.RELEASE_STRICT_SIGNING === "1";

  if (electronPlatformName !== "darwin") {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    if (strictSigning) {
      throw new Error("Tagged releases require APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID for notarization.");
    }
    console.log("Notarization skipped: missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID");
    return;
  }

  const appName = packager.appInfo.productFilename;

  console.log(`Notarizing ${appName}.app ...`);
  await notarize({
    appBundleId: packager.appInfo.id,
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log("Notarization complete.");
}

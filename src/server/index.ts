import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createServer } from "./app";
import { prisma } from "./db";
import { stopSidecarProcess } from "./sidecar/manager";

const port = Number(process.env.API_PORT || 8787);
const host = "127.0.0.1";

export function requireConfiguredApiToken(rawToken = process.env.API_TOKEN) {
  const apiToken = rawToken?.trim() || "";
  if (!apiToken) {
    throw new Error(
      "API_TOKEN is required for standalone API startup. Set a non-empty API_TOKEN and use the same value for VITE_API_TOKEN when running the browser preview."
    );
  }
  return apiToken;
}

export async function bootstrap() {
  const apiToken = requireConfiguredApiToken();
  const app = await createServer(apiToken);

  await app.listen({
    host,
    port,
  });

  app.log.info(`Local API server listening on ${host}:${port}`);

  process.on("SIGINT", async () => {
    await app.close();
    stopSidecarProcess();
    await prisma.$disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await app.close();
    stopSidecarProcess();
    await prisma.$disconnect();
    process.exit(0);
  });

  process.on("uncaughtException", (error) => {
    app.log.error(error, "Uncaught exception in API process");
  });

  process.on("unhandledRejection", (reason) => {
    app.log.error(reason instanceof Error ? reason : { reason }, "Unhandled rejection in API process");
  });
}

const entrypointHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entrypointHref) {
  bootstrap().catch((error) => {
    // Keep startup failures readable in desktop logs.
    console.error("Failed to start local API:", error);
    process.exit(1);
  });
}

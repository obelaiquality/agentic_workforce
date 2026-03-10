import "dotenv/config";
import { createServer } from "./app";
import { prisma } from "./db";
import { stopSidecarProcess } from "./sidecar/manager";

const port = Number(process.env.API_PORT || 8787);
const host = "127.0.0.1";
const apiToken = process.env.API_TOKEN || "";

async function bootstrap() {
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
}

bootstrap().catch((error) => {
  // Keep startup failures readable in desktop logs.
  console.error("Failed to start local API:", error);
  process.exit(1);
});

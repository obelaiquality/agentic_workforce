import { z } from "zod";
import { prisma } from "../db";
import type { MCPServerConfig } from "../mcp/types";

export const MCP_SERVER_SETTINGS_KEY = "mcp_server_configs";

const mcpServerConfigSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  transport: z.enum(["stdio", "sse"]),
  command: z.string().trim().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().trim().optional(),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
});

export type PersistedMcpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export function normalizeMcpServerConfigs(raw: unknown): MCPServerConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const byId = new Map<string, MCPServerConfig>();

  for (const item of raw) {
    const parsed = mcpServerConfigSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }

    const config = parsed.data;
    if (config.transport === "stdio" && !config.command) {
      continue;
    }
    if (config.transport === "sse" && !config.url) {
      continue;
    }

    byId.set(config.id, {
      id: config.id,
      name: config.name,
      transport: config.transport,
      command: config.command,
      args: Array.isArray(config.args) ? config.args.filter((item) => item.trim().length > 0) : [],
      url: config.url,
      env: config.env,
      enabled: config.enabled,
    });
  }

  return Array.from(byId.values());
}

export async function loadPersistedMcpServerConfigs(): Promise<MCPServerConfig[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: MCP_SERVER_SETTINGS_KEY } });
  return normalizeMcpServerConfigs(row?.value);
}

export async function persistMcpServerConfigs(configs: MCPServerConfig[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: MCP_SERVER_SETTINGS_KEY },
    update: { value: configs },
    create: { key: MCP_SERVER_SETTINGS_KEY, value: configs },
  });
}

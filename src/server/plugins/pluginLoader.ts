import fs from "fs";
import path from "path";
import { z } from "zod";
import type { PluginRegistry } from "./pluginRegistry";
import type { LoadedPlugin } from "./pluginTypes";
import type { ToolRegistry } from "../tools/registry";

// ---------------------------------------------------------------------------
// Manifest validation schema
// ---------------------------------------------------------------------------

const hookEntrySchema = z.object({
  event: z.string().min(1),
  handler: z.string().min(1),
});

const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  author: z.string().optional(),
  hooks: z.array(hookEntrySchema).optional(),
  systemPromptContributions: z.array(z.string()).optional(),
  // tools and commands are data-only definitions loaded from JSON;
  // actual ToolDefinition / SlashCommandDefinition objects require code,
  // so we accept raw JSON shapes here and skip them for now.
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
  }).passthrough()).optional(),
  commands: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
  }).passthrough()).optional(),
});

// ---------------------------------------------------------------------------
// Plugin Loader
// ---------------------------------------------------------------------------

export class PluginLoader {
  constructor(
    private registry: PluginRegistry,
    private toolRegistry: ToolRegistry,
  ) {}

  /**
   * Load plugins from a directory.
   * Scans for subdirectories containing a `manifest.json` file,
   * validates each manifest, and registers it in the plugin registry.
   * Returns the number of plugins loaded.
   */
  async loadFromDirectory(dir: string, source: LoadedPlugin["source"]): Promise<number> {
    if (!fs.existsSync(dir)) {
      return 0;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let loaded = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath = path.join(dir, entry.name, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        continue;
      }

      try {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        const parsed = JSON.parse(raw);
        const validated = pluginManifestSchema.parse(parsed);

        this.registry.register(
          {
            name: validated.name,
            version: validated.version,
            description: validated.description,
            author: validated.author,
            hooks: validated.hooks,
            systemPromptContributions: validated.systemPromptContributions,
            // tools and commands from JSON are stored as raw data
          },
          source,
        );
        loaded++;
      } catch {
        // Skip invalid manifests silently (logging can be added later)
      }
    }

    return loaded;
  }

  /**
   * Load built-in plugins.
   * Scans the `builtins/` directory next to this file.
   */
  async loadBuiltins(): Promise<void> {
    const builtinsDir = path.join(path.dirname(new URL(import.meta.url).pathname), "builtins");
    await this.loadFromDirectory(builtinsDir, "builtin");
  }

  /**
   * Register all tools from loaded plugins into the tool registry.
   * Currently a no-op since plugin tools are data-only (no execute function).
   * This will be implemented when plugins can contribute executable tools.
   */
  registerPluginTools(): void {
    for (const plugin of this.registry.listPlugins()) {
      if (plugin.manifest.tools) {
        for (const _tool of plugin.manifest.tools) {
          // Data-only tools cannot be registered into the ToolRegistry
          // because they lack an `execute` function and `inputSchema`.
          // This will be implemented when code-bearing plugins are supported.
        }
      }
    }
  }
}

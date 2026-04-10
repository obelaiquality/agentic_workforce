import type { PluginManifest, LoadedPlugin } from "./pluginTypes";

// ---------------------------------------------------------------------------
// Plugin Registry — manages the set of loaded plugins
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>();

  /** Register a plugin manifest. Throws if name or version is missing, or if a duplicate exists. */
  register(manifest: PluginManifest, source: LoadedPlugin["source"]): void {
    if (!manifest.name) {
      throw new Error("Plugin manifest must have a name");
    }
    if (!manifest.version) {
      throw new Error("Plugin manifest must have a version");
    }
    if (this.plugins.has(manifest.name)) {
      throw new Error(`Plugin already registered: ${manifest.name}`);
    }

    this.plugins.set(manifest.name, {
      manifest,
      source,
      loadedAt: new Date().toISOString(),
    });
  }

  /** Unregister a plugin by name. */
  unregister(name: string): void {
    this.plugins.delete(name);
  }

  /** Get a loaded plugin by name. */
  getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  /** List all loaded plugins. */
  listPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Collect system prompt contributions from all loaded plugins. */
  getSystemPromptContributions(): string[] {
    const contributions: string[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.manifest.systemPromptContributions) {
        contributions.push(...plugin.manifest.systemPromptContributions);
      }
    }
    return contributions;
  }

  /** Get the number of registered plugins. */
  get size(): number {
    return this.plugins.size;
  }
}

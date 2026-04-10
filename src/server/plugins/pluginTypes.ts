import type { ToolDefinition } from "../tools/types";
import type { SlashCommandDefinition } from "../commands/commandTypes";

// ---------------------------------------------------------------------------
// Plugin Manifest — describes a plugin's capabilities
// ---------------------------------------------------------------------------

export interface PluginManifest {
  /** Unique plugin name */
  name: string;
  /** Semver version string */
  version: string;
  /** Human-readable description */
  description: string;
  /** Plugin author */
  author?: string;
  /** Tools contributed by this plugin */
  tools?: ToolDefinition[];
  /** Slash commands contributed by this plugin */
  commands?: SlashCommandDefinition[];
  /** Lifecycle hooks (data-only, no code execution for now) */
  hooks?: Array<{ event: string; handler: string }>;
  /** Extra system prompt fragments injected into every conversation */
  systemPromptContributions?: string[];
}

// ---------------------------------------------------------------------------
// Loaded Plugin — a manifest with provenance metadata
// ---------------------------------------------------------------------------

export interface LoadedPlugin {
  /** The validated manifest */
  manifest: PluginManifest;
  /** Where this plugin was loaded from */
  source: "builtin" | "user" | "project" | "npm";
  /** ISO timestamp of when the plugin was loaded */
  loadedAt: string;
}

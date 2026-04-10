import { describe, it, expect, beforeEach } from "vitest";
import { PluginRegistry } from "./pluginRegistry";
import type { PluginManifest } from "./pluginTypes";

function makeManifest(overrides?: Partial<PluginManifest>): PluginManifest {
  return {
    name: "test-plugin",
    version: "1.0.0",
    description: "A test plugin",
    ...overrides,
  };
}

describe("PluginRegistry", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe("register", () => {
    it("registers a valid plugin", () => {
      const manifest = makeManifest();
      registry.register(manifest, "builtin");

      const plugin = registry.getPlugin("test-plugin");
      expect(plugin).toBeDefined();
      expect(plugin!.manifest.name).toBe("test-plugin");
      expect(plugin!.source).toBe("builtin");
      expect(plugin!.loadedAt).toBeTruthy();
    });

    it("throws on missing name", () => {
      expect(() => {
        registry.register(makeManifest({ name: "" }), "user");
      }).toThrow("Plugin manifest must have a name");
    });

    it("throws on missing version", () => {
      expect(() => {
        registry.register(makeManifest({ version: "" }), "user");
      }).toThrow("Plugin manifest must have a version");
    });

    it("throws on duplicate plugin name", () => {
      registry.register(makeManifest(), "builtin");

      expect(() => {
        registry.register(makeManifest(), "user");
      }).toThrow("Plugin already registered: test-plugin");
    });

    it("allows different plugin names", () => {
      registry.register(makeManifest({ name: "plugin-a" }), "builtin");
      registry.register(makeManifest({ name: "plugin-b" }), "user");

      expect(registry.size).toBe(2);
    });
  });

  describe("unregister", () => {
    it("removes a registered plugin", () => {
      registry.register(makeManifest(), "builtin");
      expect(registry.size).toBe(1);

      registry.unregister("test-plugin");
      expect(registry.size).toBe(0);
      expect(registry.getPlugin("test-plugin")).toBeUndefined();
    });

    it("is a no-op for unknown plugins", () => {
      registry.unregister("nonexistent");
      expect(registry.size).toBe(0);
    });
  });

  describe("getPlugin", () => {
    it("returns undefined for unknown name", () => {
      expect(registry.getPlugin("nonexistent")).toBeUndefined();
    });
  });

  describe("listPlugins", () => {
    it("returns empty array when no plugins registered", () => {
      expect(registry.listPlugins()).toEqual([]);
    });

    it("returns all registered plugins", () => {
      registry.register(makeManifest({ name: "alpha" }), "builtin");
      registry.register(makeManifest({ name: "beta" }), "user");
      registry.register(makeManifest({ name: "gamma" }), "project");

      const list = registry.listPlugins();
      expect(list).toHaveLength(3);
      expect(list.map((p) => p.manifest.name).sort()).toEqual(["alpha", "beta", "gamma"]);
    });
  });

  describe("getSystemPromptContributions", () => {
    it("returns empty array when no contributions", () => {
      registry.register(makeManifest(), "builtin");
      expect(registry.getSystemPromptContributions()).toEqual([]);
    });

    it("collects contributions from all plugins", () => {
      registry.register(
        makeManifest({
          name: "plugin-a",
          systemPromptContributions: ["Always be concise."],
        }),
        "builtin",
      );
      registry.register(
        makeManifest({
          name: "plugin-b",
          systemPromptContributions: ["Use TypeScript.", "Follow best practices."],
        }),
        "user",
      );

      const contributions = registry.getSystemPromptContributions();
      expect(contributions).toEqual([
        "Always be concise.",
        "Use TypeScript.",
        "Follow best practices.",
      ]);
    });

    it("skips plugins without contributions", () => {
      registry.register(makeManifest({ name: "has-contrib", systemPromptContributions: ["Hello"] }), "builtin");
      registry.register(makeManifest({ name: "no-contrib" }), "user");

      expect(registry.getSystemPromptContributions()).toEqual(["Hello"]);
    });
  });

  describe("source tracking", () => {
    it("records the source of each plugin", () => {
      registry.register(makeManifest({ name: "a" }), "builtin");
      registry.register(makeManifest({ name: "b" }), "user");
      registry.register(makeManifest({ name: "c" }), "project");
      registry.register(makeManifest({ name: "d" }), "npm");

      expect(registry.getPlugin("a")!.source).toBe("builtin");
      expect(registry.getPlugin("b")!.source).toBe("user");
      expect(registry.getPlugin("c")!.source).toBe("project");
      expect(registry.getPlugin("d")!.source).toBe("npm");
    });
  });
});

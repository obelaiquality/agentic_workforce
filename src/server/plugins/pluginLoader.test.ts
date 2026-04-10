import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { PluginRegistry } from "./pluginRegistry";
import { PluginLoader } from "./pluginLoader";
import { ToolRegistry } from "../tools/registry";

function writeManifest(dir: string, name: string, manifest: Record<string, unknown>): void {
  const pluginDir = path.join(dir, name);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify(manifest));
}

describe("PluginLoader", () => {
  let tmpDir: string;
  let pluginRegistry: PluginRegistry;
  let toolRegistry: ToolRegistry;
  let loader: PluginLoader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-loader-test-"));
    pluginRegistry = new PluginRegistry();
    toolRegistry = new ToolRegistry();
    loader = new PluginLoader(pluginRegistry, toolRegistry);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadFromDirectory", () => {
    it("loads valid plugins from a directory", async () => {
      writeManifest(tmpDir, "my-plugin", {
        name: "my-plugin",
        version: "1.0.0",
        description: "A test plugin",
      });

      const count = await loader.loadFromDirectory(tmpDir, "user");
      expect(count).toBe(1);
      expect(pluginRegistry.getPlugin("my-plugin")).toBeDefined();
    });

    it("loads multiple plugins", async () => {
      writeManifest(tmpDir, "alpha", {
        name: "alpha",
        version: "1.0.0",
        description: "Alpha plugin",
      });
      writeManifest(tmpDir, "beta", {
        name: "beta",
        version: "2.0.0",
        description: "Beta plugin",
      });

      const count = await loader.loadFromDirectory(tmpDir, "project");
      expect(count).toBe(2);
      expect(pluginRegistry.size).toBe(2);
    });

    it("returns 0 for nonexistent directory", async () => {
      const count = await loader.loadFromDirectory("/tmp/nonexistent-plugin-dir-xyz", "user");
      expect(count).toBe(0);
    });

    it("skips directories without manifest.json", async () => {
      fs.mkdirSync(path.join(tmpDir, "no-manifest"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "no-manifest", "readme.txt"), "hello");

      const count = await loader.loadFromDirectory(tmpDir, "user");
      expect(count).toBe(0);
    });

    it("skips files that are not directories", async () => {
      fs.writeFileSync(path.join(tmpDir, "not-a-dir.json"), "{}");

      const count = await loader.loadFromDirectory(tmpDir, "user");
      expect(count).toBe(0);
    });

    it("skips invalid manifests", async () => {
      // Missing required 'description' field
      writeManifest(tmpDir, "invalid", {
        name: "invalid",
        version: "1.0.0",
      });
      writeManifest(tmpDir, "valid", {
        name: "valid",
        version: "1.0.0",
        description: "A valid plugin",
      });

      const count = await loader.loadFromDirectory(tmpDir, "user");
      expect(count).toBe(1);
      expect(pluginRegistry.getPlugin("valid")).toBeDefined();
      expect(pluginRegistry.getPlugin("invalid")).toBeUndefined();
    });

    it("skips manifests with invalid JSON", async () => {
      const pluginDir = path.join(tmpDir, "bad-json");
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(path.join(pluginDir, "manifest.json"), "not json!");

      const count = await loader.loadFromDirectory(tmpDir, "user");
      expect(count).toBe(0);
    });

    it("preserves system prompt contributions", async () => {
      writeManifest(tmpDir, "prompt-plugin", {
        name: "prompt-plugin",
        version: "1.0.0",
        description: "Plugin with prompt contributions",
        systemPromptContributions: ["Always write tests."],
      });

      await loader.loadFromDirectory(tmpDir, "user");
      const contributions = pluginRegistry.getSystemPromptContributions();
      expect(contributions).toEqual(["Always write tests."]);
    });

    it("preserves hooks", async () => {
      writeManifest(tmpDir, "hook-plugin", {
        name: "hook-plugin",
        version: "1.0.0",
        description: "Plugin with hooks",
        hooks: [{ event: "run_start", handler: "onRunStart" }],
      });

      await loader.loadFromDirectory(tmpDir, "user");
      const plugin = pluginRegistry.getPlugin("hook-plugin");
      expect(plugin!.manifest.hooks).toEqual([{ event: "run_start", handler: "onRunStart" }]);
    });
  });

  describe("registerPluginTools", () => {
    it("runs without error (no-op for data-only tools)", async () => {
      writeManifest(tmpDir, "tool-plugin", {
        name: "tool-plugin",
        version: "1.0.0",
        description: "Plugin with data-only tools",
        tools: [{ name: "my_tool", description: "Does something" }],
      });

      await loader.loadFromDirectory(tmpDir, "user");
      // Should not throw
      loader.registerPluginTools();
      // Tool registry should still be empty (data-only tools can't be registered)
      expect(toolRegistry.size).toBe(0);
    });
  });
});

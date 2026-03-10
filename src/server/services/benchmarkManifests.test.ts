import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import type { BenchmarkProjectManifest } from "../../shared/contracts";

describe("benchmark manifests", () => {
  const root = path.resolve(process.cwd(), "benchmarks", "projects");
  const manifests = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "agentic-benchmark.yaml"));

  it("ships the expected synthetic benchmark pack", () => {
    expect(manifests.length).toBeGreaterThanOrEqual(6);
  });

  it("parses every manifest and requires at least one task", () => {
    for (const manifestPath of manifests) {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const manifest = YAML.parse(raw) as BenchmarkProjectManifest;
      expect(manifest.projectId).toBeTruthy();
      expect(manifest.displayName).toBeTruthy();
      expect(manifest.taskSpecs.length).toBeGreaterThan(0);
      expect(manifest.verifyCommand).toBeTruthy();
    }
  });
});

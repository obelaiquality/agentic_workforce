import { describe, expect, it } from "vitest";
import {
  detectLanguageFromPath,
  isBinaryBuffer,
  ensureInsideRoot,
  buildTree,
  truncateFileContent,
} from "./codebaseHelpers";

describe("detectLanguageFromPath", () => {
  it("detects TypeScript files", () => {
    expect(detectLanguageFromPath("src/App.tsx")).toBe("typescript");
    expect(detectLanguageFromPath("src/index.ts")).toBe("typescript");
  });

  it("detects JavaScript files", () => {
    expect(detectLanguageFromPath("lib/main.js")).toBe("javascript");
    expect(detectLanguageFromPath("lib/main.jsx")).toBe("javascript");
    expect(detectLanguageFromPath("config.mjs")).toBe("javascript");
    expect(detectLanguageFromPath("config.cjs")).toBe("javascript");
  });

  it("detects Python files", () => {
    expect(detectLanguageFromPath("train.py")).toBe("python");
  });

  it("detects Rust files", () => {
    expect(detectLanguageFromPath("src/main.rs")).toBe("rust");
  });

  it("detects Markdown files", () => {
    expect(detectLanguageFromPath("README.md")).toBe("markdown");
    expect(detectLanguageFromPath("docs/guide.mdx")).toBe("markdown");
  });

  it("detects JSON files", () => {
    expect(detectLanguageFromPath("package.json")).toBe("json");
  });

  it("detects YAML files", () => {
    expect(detectLanguageFromPath("config.yml")).toBe("yaml");
    expect(detectLanguageFromPath("config.yaml")).toBe("yaml");
  });

  it("detects CSS files", () => {
    expect(detectLanguageFromPath("styles.css")).toBe("css");
  });

  it("detects HTML files", () => {
    expect(detectLanguageFromPath("index.html")).toBe("html");
  });

  it("returns null for unknown extensions", () => {
    expect(detectLanguageFromPath("Makefile")).toBeNull();
    expect(detectLanguageFromPath("image.png")).toBeNull();
    expect(detectLanguageFromPath(".env")).toBeNull();
  });
});

describe("isBinaryBuffer", () => {
  it("detects binary content (contains null byte)", () => {
    const binary = Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]);
    expect(isBinaryBuffer(binary)).toBe(true);
  });

  it("detects text content (no null bytes)", () => {
    const text = Buffer.from("Hello, world!", "utf8");
    expect(isBinaryBuffer(text)).toBe(false);
  });

  it("handles empty buffer", () => {
    expect(isBinaryBuffer(Buffer.alloc(0))).toBe(false);
  });
});

describe("ensureInsideRoot", () => {
  it("resolves a valid relative path", () => {
    const result = ensureInsideRoot("/tmp/repo", "src/main.ts");
    expect(result).toBe("/tmp/repo/src/main.ts");
  });

  it("rejects path traversal attempts", () => {
    expect(() => ensureInsideRoot("/tmp/repo", "../../etc/passwd")).toThrow(
      /Refusing to access path outside/
    );
  });

  it("rejects absolute paths outside root", () => {
    expect(() => ensureInsideRoot("/tmp/repo", "/etc/passwd")).toThrow(
      /Refusing to access path outside/
    );
  });

  it("allows the root path itself", () => {
    const result = ensureInsideRoot("/tmp/repo", ".");
    expect(result).toBe("/tmp/repo");
  });
});

describe("buildTree", () => {
  it("builds a tree from flat file paths", () => {
    const tree = buildTree([
      { path: "src/App.tsx", status: "modified" },
      { path: "src/index.ts", status: "unchanged" },
      { path: "README.md", status: "added" },
    ]);

    expect(tree.length).toBe(2); // src/ directory + README.md file
    const srcDir = tree.find((n) => n.kind === "directory");
    expect(srcDir).toBeDefined();
    expect(srcDir!.path).toBe("src");
    expect(srcDir!.children).toHaveLength(2);
  });

  it("sorts directories before files", () => {
    const tree = buildTree([
      { path: "README.md", status: "unchanged" },
      { path: "src/App.tsx", status: "unchanged" },
    ]);

    expect(tree[0].kind).toBe("directory");
    expect(tree[1].kind).toBe("file");
  });

  it("assigns language to file nodes", () => {
    const tree = buildTree([{ path: "src/main.ts", status: "unchanged" }]);
    const srcDir = tree[0];
    expect(srcDir.children![0].language).toBe("typescript");
  });

  it("preserves file status", () => {
    const tree = buildTree([{ path: "new.ts", status: "added" }]);
    expect(tree[0].status).toBe("added");
  });

  it("handles nested directories", () => {
    const tree = buildTree([
      { path: "src/components/Button.tsx", status: "unchanged" },
    ]);

    expect(tree[0].kind).toBe("directory");
    expect(tree[0].path).toBe("src");
    expect(tree[0].children![0].kind).toBe("directory");
    expect(tree[0].children![0].path).toBe("src/components");
    expect(tree[0].children![0].children![0].path).toBe("src/components/Button.tsx");
  });

  it("handles empty input", () => {
    const tree = buildTree([]);
    expect(tree).toEqual([]);
  });
});

describe("truncateFileContent", () => {
  it("does not truncate short content", () => {
    const result = truncateFileContent("line1\nline2\nline3");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("line1\nline2\nline3");
  });

  it("truncates content exceeding line limit", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
    const result = truncateFileContent(lines, 800);
    expect(result.truncated).toBe(true);
    const outputLines = result.content.split("\n");
    expect(outputLines.length).toBeLessThanOrEqual(800);
  });

  it("truncates content exceeding byte limit", () => {
    const bigContent = "A".repeat(70000);
    const result = truncateFileContent(bigContent, 800, 64000);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(64000);
  });

  it("handles empty content", () => {
    const result = truncateFileContent("");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("");
  });
});

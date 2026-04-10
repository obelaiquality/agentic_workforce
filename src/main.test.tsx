// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// Mock react-dom/client to avoid actually mounting
vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));

// Mock the App component
vi.mock("./app/App.tsx", () => ({ default: () => null }));

// Mock CSS import
vi.mock("./styles/index.css", () => ({}));

describe("main entry point", () => {
  it("module is importable", async () => {
    // Provide a root element for createRoot
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);

    const mod = await import("./main");
    expect(mod).toBeDefined();

    document.body.removeChild(root);
  });
});

import { describe, it, expect } from "vitest";
import * as MCPExports from "./index";

describe("mcp barrel exports", () => {
  it("exports MCPClient", () => {
    expect(MCPExports.MCPClient).toBeDefined();
    expect(typeof MCPExports.MCPClient).toBe("function");
  });

  it("exports MCPToolAdapter", () => {
    expect(MCPExports.MCPToolAdapter).toBeDefined();
    expect(typeof MCPExports.MCPToolAdapter).toBe("function");
  });

  it("exports MCPServerRegistry", () => {
    expect(MCPExports.MCPServerRegistry).toBeDefined();
    expect(typeof MCPExports.MCPServerRegistry).toBe("function");
  });

  it("exports getDefaultMCPServerRegistry", () => {
    expect(MCPExports.getDefaultMCPServerRegistry).toBeDefined();
    expect(typeof MCPExports.getDefaultMCPServerRegistry).toBe("function");
  });

  it("exports createMCPServerRegistry", () => {
    expect(MCPExports.createMCPServerRegistry).toBeDefined();
    expect(typeof MCPExports.createMCPServerRegistry).toBe("function");
  });
});

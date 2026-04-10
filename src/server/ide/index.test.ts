import { describe, it, expect, vi } from "vitest";

vi.mock("./ideBridgeServer", () => ({
  IdeBridgeServer: class MockIdeBridgeServer {},
}));

import * as IdeExports from "./index";

describe("ide barrel exports", () => {
  it("exports IdeSessionManager", () => {
    expect(IdeExports.IdeSessionManager).toBeDefined();
    expect(typeof IdeExports.IdeSessionManager).toBe("function");
  });

  it("exports IdeBridgeServer", () => {
    expect(IdeExports.IdeBridgeServer).toBeDefined();
    expect(typeof IdeExports.IdeBridgeServer).toBe("function");
  });

  it("exports IdePermissionDelegate", () => {
    expect(IdeExports.IdePermissionDelegate).toBeDefined();
    expect(typeof IdeExports.IdePermissionDelegate).toBe("function");
  });
});

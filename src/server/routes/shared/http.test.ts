import { describe, expect, it } from "vitest";
import { isAuthorizedLocalApiRequest } from "./http";

describe("local API auth helper", () => {
  it("always allows the health route", () => {
    expect(
      isAuthorizedLocalApiRequest({
        url: "/health",
        apiToken: "local-token",
        headerToken: undefined,
      })
    ).toBe(true);
  });

  it("requires an exact header token match for non-health routes", () => {
    expect(
      isAuthorizedLocalApiRequest({
        url: "/api/v1/settings",
        apiToken: "local-token",
        headerToken: "local-token",
      })
    ).toBe(true);

    expect(
      isAuthorizedLocalApiRequest({
        url: "/api/v1/settings",
        apiToken: "local-token",
        headerToken: undefined,
      })
    ).toBe(false);
  });
});

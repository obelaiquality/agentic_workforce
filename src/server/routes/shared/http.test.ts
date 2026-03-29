import { describe, expect, it } from "vitest";
import { isAuthorizedLocalApiRequest, isAllowedCorsOrigin, buildStreamHeaders } from "./http";

describe("local API auth helper", () => {
  const apiToken = "local-token-abc123";

  it("always allows the health route", () => {
    expect(
      isAuthorizedLocalApiRequest({
        url: "/health",
        apiToken,
        headerToken: undefined,
      })
    ).toBe(true);
  });

  it("requires an exact header token match for non-health routes", () => {
    expect(
      isAuthorizedLocalApiRequest({
        url: "/api/v1/settings",
        apiToken,
        headerToken: apiToken,
      })
    ).toBe(true);

    expect(
      isAuthorizedLocalApiRequest({
        url: "/api/v1/settings",
        apiToken,
        headerToken: undefined,
      })
    ).toBe(false);
  });

  it("rejects wrong token", () => {
    expect(
      isAuthorizedLocalApiRequest({
        url: "/api/v1/settings",
        apiToken,
        headerToken: "wrong-token",
      })
    ).toBe(false);
  });

  it("rejects empty string tokens", () => {
    expect(
      isAuthorizedLocalApiRequest({
        url: "/api/v1/settings",
        apiToken: "",
        headerToken: "",
      })
    ).toBe(false);
  });

  it("handles array header token (uses first element)", () => {
    expect(
      isAuthorizedLocalApiRequest({
        url: "/api/tasks",
        apiToken,
        headerToken: [apiToken, "other"],
      })
    ).toBe(true);
  });

  it("handles different-length tokens without crashing", () => {
    expect(
      isAuthorizedLocalApiRequest({
        url: "/api/tasks",
        apiToken: "short",
        headerToken: "a-much-longer-token-value",
      })
    ).toBe(false);
  });
});

describe("isAllowedCorsOrigin", () => {
  it("allows localhost origins", () => {
    expect(isAllowedCorsOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:8787")).toBe(true);
  });

  it("rejects non-local origins", () => {
    expect(isAllowedCorsOrigin("https://evil.com")).toBe(false);
    expect(isAllowedCorsOrigin("http://192.168.1.1:8787")).toBe(false);
  });

  it("rejects malformed origins", () => {
    expect(isAllowedCorsOrigin("not-a-url")).toBe(false);
    expect(isAllowedCorsOrigin("")).toBe(false);
  });
});

describe("buildStreamHeaders", () => {
  it("returns SSE headers", () => {
    const headers = buildStreamHeaders();
    expect(headers["Content-Type"]).toBe("text/event-stream");
    expect(headers["Cache-Control"]).toBe("no-cache");
  });

  it("adds CORS for allowed origins", () => {
    const headers = buildStreamHeaders("http://localhost:5173");
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
  });

  it("omits CORS for disallowed origins", () => {
    const headers = buildStreamHeaders("https://evil.com");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { IdeSessionManager } from "./ideSessionManager";

describe("IdeSessionManager", () => {
  let manager: IdeSessionManager;

  beforeEach(() => {
    manager = new IdeSessionManager();
  });

  describe("createSession", () => {
    it("creates a session with a unique ID and token", () => {
      const session = manager.createSession("vscode");

      expect(session.id).toBeTruthy();
      expect(session.token).toBeTruthy();
      expect(session.token.length).toBe(64); // 32 bytes hex-encoded
      expect(session.clientType).toBe("vscode");
      expect(session.connectedAt).toBeTruthy();
      expect(session.lastActivityAt).toBeTruthy();
    });

    it("creates sessions with different IDs and tokens", () => {
      const s1 = manager.createSession("vscode");
      const s2 = manager.createSession("jetbrains");

      expect(s1.id).not.toBe(s2.id);
      expect(s1.token).not.toBe(s2.token);
    });

    it("supports all client types", () => {
      const vscode = manager.createSession("vscode");
      const jetbrains = manager.createSession("jetbrains");
      const generic = manager.createSession("generic");

      expect(vscode.clientType).toBe("vscode");
      expect(jetbrains.clientType).toBe("jetbrains");
      expect(generic.clientType).toBe("generic");
    });
  });

  describe("validateToken", () => {
    it("returns the session for a valid token", () => {
      const created = manager.createSession("vscode");
      const found = manager.validateToken(created.token);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it("returns null for an unknown token", () => {
      manager.createSession("vscode");
      const found = manager.validateToken("nonexistent-token");

      expect(found).toBeNull();
    });

    it("returns null when no sessions exist", () => {
      const found = manager.validateToken("any-token");
      expect(found).toBeNull();
    });
  });

  describe("getSession", () => {
    it("returns a session by its ID", () => {
      const created = manager.createSession("jetbrains");
      const found = manager.getSession(created.id);

      expect(found).not.toBeNull();
      expect(found!.clientType).toBe("jetbrains");
    });

    it("returns null for an unknown ID", () => {
      const found = manager.getSession("unknown-id");
      expect(found).toBeNull();
    });
  });

  describe("removeSession", () => {
    it("removes a session so it can no longer be found", () => {
      const created = manager.createSession("vscode");
      manager.removeSession(created.id);

      expect(manager.getSession(created.id)).toBeNull();
      expect(manager.validateToken(created.token)).toBeNull();
    });

    it("does nothing if the session does not exist", () => {
      // Should not throw
      manager.removeSession("nonexistent");
      expect(manager.listSessions()).toHaveLength(0);
    });
  });

  describe("listSessions", () => {
    it("returns an empty array when no sessions exist", () => {
      expect(manager.listSessions()).toEqual([]);
    });

    it("returns all created sessions", () => {
      manager.createSession("vscode");
      manager.createSession("jetbrains");
      manager.createSession("generic");

      expect(manager.listSessions()).toHaveLength(3);
    });

    it("excludes removed sessions", () => {
      const s1 = manager.createSession("vscode");
      manager.createSession("jetbrains");
      manager.removeSession(s1.id);

      expect(manager.listSessions()).toHaveLength(1);
      expect(manager.listSessions()[0].clientType).toBe("jetbrains");
    });
  });

  describe("touchSession", () => {
    it("updates the lastActivityAt timestamp", async () => {
      const created = manager.createSession("vscode");
      const originalActivity = created.lastActivityAt;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 5));
      manager.touchSession(created.id);

      const updated = manager.getSession(created.id);
      expect(updated).not.toBeNull();
      expect(updated!.lastActivityAt).not.toBe(originalActivity);
      expect(new Date(updated!.lastActivityAt).getTime()).toBeGreaterThan(
        new Date(originalActivity).getTime(),
      );
    });

    it("does nothing if the session does not exist", () => {
      // Should not throw
      manager.touchSession("nonexistent");
    });
  });
});

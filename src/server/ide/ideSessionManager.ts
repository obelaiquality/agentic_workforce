import crypto from "node:crypto";
import type { IdeSession } from "./ideBridgeTypes";

/**
 * Manages IDE bridge sessions in memory.
 * Each session is identified by a unique ID and authenticated via a bearer token.
 */
export class IdeSessionManager {
  private sessions = new Map<string, IdeSession>();

  /**
   * Create a new IDE session for a given client type.
   * Returns the created session including its secret token.
   */
  createSession(clientType: IdeSession["clientType"]): IdeSession {
    const now = new Date().toISOString();
    const session: IdeSession = {
      id: crypto.randomUUID(),
      clientType,
      connectedAt: now,
      lastActivityAt: now,
      token: crypto.randomBytes(32).toString("hex"),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Look up a session by its bearer token.
   * Returns the session if found, or null.
   */
  validateToken(token: string): IdeSession | null {
    for (const session of this.sessions.values()) {
      if (session.token === token) {
        return session;
      }
    }
    return null;
  }

  /**
   * Get a session by its ID.
   */
  getSession(id: string): IdeSession | null {
    return this.sessions.get(id) ?? null;
  }

  /**
   * Remove a session by ID.
   */
  removeSession(id: string): void {
    this.sessions.delete(id);
  }

  /**
   * List all active sessions.
   */
  listSessions(): IdeSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Update the lastActivityAt timestamp for a session.
   */
  touchSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivityAt = new Date().toISOString();
    }
  }
}

/**
 * Session management functionality for the 5 Whys MCP Server
 */

// Session state interface
export interface SessionState {
  problem: string;
  whyNumber: number;
  history: Array<{ whyNumber: number; answer: string }>;
  needsMoreWhys: boolean;
  lastActivity: number;
}

// In-memory session store with cleanup
export class SessionStore {
  private sessions = new Map<string, SessionState>();
  private readonly maxSessions = 100; // Maximum number of sessions to keep
  private readonly sessionTimeout = 30 * 60 * 1000; // 30 minutes

  set(sessionId: string, state: SessionState): void {
    // Clean up old sessions if we're at capacity
    if (this.sessions.size >= this.maxSessions) {
      this.cleanup();
    }

    state.lastActivity = Date.now();
    this.sessions.set(sessionId, state);
  }

  get(sessionId: string): SessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.lastActivity = Date.now(); // Update activity timestamp
    }
    return state;
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  private cleanup(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, state] of this.sessions.entries()) {
      if (now - state.lastActivity > this.sessionTimeout) {
        expiredSessions.push(sessionId);
      }
    }

    // Remove expired sessions
    expiredSessions.forEach(sessionId => this.sessions.delete(sessionId));

    // If still at capacity, remove oldest sessions
    if (this.sessions.size >= this.maxSessions) {
      const sortedSessions = Array.from(this.sessions.entries())
        .sort((a, b) => a[1].lastActivity - b[1].lastActivity);

      const toRemove = this.sessions.size - this.maxSessions + 1;
      for (let i = 0; i < toRemove; i++) {
        this.sessions.delete(sortedSessions[i][0]);
      }
    }
  }

  getStats(): { totalSessions: number; maxSessions: number } {
    return {
      totalSessions: this.sessions.size,
      maxSessions: this.maxSessions,
    };
  }
}

// Create the session store instance
export const sessionStore = new SessionStore();
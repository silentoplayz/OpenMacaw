import { randomBytes } from 'crypto';

class CanaryManager {
    private tokens = new Map<string, string>(); // sessionId → token

    /**
     * Generate a fresh canary token for the session.
     * Format: CANARY-{16 uppercase hex chars}
     */
    generate(sessionId: string): string {
        const token = `CANARY-${randomBytes(8).toString('hex').toUpperCase()}`;
        this.tokens.set(sessionId, token);
        return token;
    }

    /**
     * Check whether the canary token for this session has leaked into `output`.
     * Returns true if a leak is detected (pipeline should abort).
     */
    checkOutput(sessionId: string, output: string): boolean {
        const token = this.tokens.get(sessionId);
        if (!token) return false;
        return output.includes(token);
    }

    /** Get the current token (e.g. to embed in a system prompt). */
    getToken(sessionId: string): string | null {
        return this.tokens.get(sessionId) ?? null;
    }

    /** Remove the token at end of session. */
    clearToken(sessionId: string): void {
        this.tokens.delete(sessionId);
    }
}

export const canaryManager = new CanaryManager();

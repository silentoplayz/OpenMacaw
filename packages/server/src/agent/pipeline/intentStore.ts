import { createHash } from 'crypto';

export interface IntentRecord {
    intentId: string;       // SHA-256 of original message
    originalMessage: string;
    createdAt: number;
    sessionId: string;
}

class IntentStore {
    private store = new Map<string, IntentRecord>();

    /** Hash and store the user message. Returns the record. */
    storeIntent(sessionId: string, message: string): IntentRecord {
        const intentId = createHash('sha256').update(message).digest('hex');
        const record: IntentRecord = {
            intentId,
            originalMessage: message,
            createdAt: Date.now(),
            sessionId,
        };
        this.store.set(intentId, record);
        return record;
    }

    /** Retrieve the full record by intentId. */
    getIntent(intentId: string): IntentRecord | null {
        return this.store.get(intentId) ?? null;
    }

    /**
     * Resolve the original message from an intentId.
     * This is the only method that exposes the raw message.
     * It should ONLY be called from pipeline/index.ts and finalVerifier.ts.
     */
    resolveMessage(intentId: string): string | null {
        return this.store.get(intentId)?.originalMessage ?? null;
    }

    /** Clear the intent record after a pipeline run completes (optional cleanup). */
    clearIntent(intentId: string): void {
        this.store.delete(intentId);
    }
}

// Singleton — never written to disk; lives only for the duration of the process
export const intentStore = new IntentStore();

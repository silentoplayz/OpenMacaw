import { nanoid } from 'nanoid';
import type { PipelineStep } from './index.js';

export interface ConfirmationRequest {
    confirmationId: string;
    reason: 'final_step' | 'irreversible_action' | 'verifier_pause';
    step?: PipelineStep | null;
    verifierSummary?: Record<string, unknown>;
}

type ConfirmationResolver = (approved: boolean) => void;

class HumanConfirmationManager {
    // confirmationId → resolve fn (awaited by pipeline)
    private pending = new Map<string, ConfirmationResolver>();

    /**
     * Emit a `confirmation_required` event over WebSocket and pause the pipeline
     * until the user sends back a `confirmation_response`.
     */
    async request(
        _sessionId: string,
        step: PipelineStep | null,
        wsEmit: (event: object) => void,
        verifierSummary?: Record<string, unknown>
    ): Promise<boolean> {
        const confirmationId = nanoid();

        const reason: ConfirmationRequest['reason'] =
            step?.isFinalStep
                ? 'final_step'
                : verifierSummary
                    ? 'verifier_pause'
                    : 'irreversible_action';

        const requestEvent: Record<string, unknown> = {
            type: 'confirmation_required',
            confirmationId,
            reason,
        };

        if (step) {
            requestEvent.action = {
                stepId: step.id,
                description: step.description,
                toolRequired: step.toolRequired,
                isIrreversible: step.isIrreversible,
            };
        }

        if (verifierSummary) {
            requestEvent.verifierSummary = verifierSummary;
        }

        wsEmit(requestEvent);

        return new Promise<boolean>((resolve) => {
            this.pending.set(confirmationId, resolve);

            // Safety timeout: auto-reject after 5 minutes of no response
            const timeout = setTimeout(() => {
                if (this.pending.has(confirmationId)) {
                    this.pending.delete(confirmationId);
                    resolve(false);
                }
            }, 5 * 60 * 1000);

            // Wrap resolve to also clear the timeout
            const originalResolve = resolve;
            this.pending.set(confirmationId, (approved: boolean) => {
                clearTimeout(timeout);
                originalResolve(approved);
            });
        });
    }

    /**
     * Called by the WebSocket route handler when a `confirmation_response`
     * message arrives from the client.
     */
    resolve(confirmationId: string, approved: boolean): boolean {
        const resolver = this.pending.get(confirmationId);
        if (!resolver) return false;
        this.pending.delete(confirmationId);
        resolver(approved);
        return true;
    }

    /** Returns true if there is a pending confirmation for the given ID. */
    isPending(confirmationId: string): boolean {
        return this.pending.has(confirmationId);
    }
}

export const humanConfirmation = new HumanConfirmationManager();

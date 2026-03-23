import { nanoid } from 'nanoid';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AgenticPlanStep {
    id: string;
    description: string;
    tool?: string;
    server?: string;
}

export interface PendingAction {
    tool: string;
    server: string;
    input: Record<string, unknown>;
    result?: unknown;
    executedAt: Date;
}

export type AgenticRunStatus =
    | 'planning'            // LLM is generating the plan
    | 'awaiting_approval'   // Plan shown to user, waiting for approve/deny
    | 'running'             // Autonomously executing
    | 'awaiting_checkpoint' // Reached completion goal, waiting for final approval
    | 'done'                // Completed and committed
    | 'cancelled';          // Denied or discarded

export interface AgenticRunState {
    id: string;
    sessionId: string;
    goal: string;
    plan: AgenticPlanStep[];
    status: AgenticRunStatus;
    requireFinalApproval: boolean;
    completionGoal?: string;     // Condition to detect "goal reached"
    checkpointStepIdx?: number;  // 0-based index of the step where the agent pauses for review.
                                 // When defined and < plan.length-1, execution splits into two
                                 // phases: phase 1 runs steps [0..checkpointStepIdx], phase 2
                                 // runs steps [checkpointStepIdx+1..end] after user confirms.
    pendingActions: PendingAction[]; // Actions taken during the run (for final checkpoint)
    planMsgId?: string;          // ID of the persisted plan message in the DB
    createdAt: Date;
    updatedAt: Date;
}

// ── In-Memory Store ────────────────────────────────────────────────────────────

const store = new Map<string, AgenticRunState>();

export function createAgenticRun(params: {
    sessionId: string;
    goal: string;
    requireFinalApproval?: boolean;
    completionGoal?: string;
}): AgenticRunState {
    const run: AgenticRunState = {
        id: nanoid(),
        sessionId: params.sessionId,
        goal: params.goal,
        plan: [],
        status: 'planning',
        requireFinalApproval: params.requireFinalApproval ?? false,
        completionGoal: params.completionGoal,
        pendingActions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    store.set(run.id, run);
    return run;
}

export function getAgenticRun(id: string): AgenticRunState | null {
    return store.get(id) ?? null;
}

export function updateAgenticRun(
    id: string,
    updates: Partial<Omit<AgenticRunState, 'id' | 'createdAt'>>
): AgenticRunState | null {
    const run = store.get(id);
    if (!run) return null;
    const updated = { ...run, ...updates, updatedAt: new Date() };
    store.set(id, updated);
    return updated;
}

export function addPendingAction(runId: string, action: Omit<PendingAction, 'executedAt'>): void {
    const run = store.get(runId);
    if (!run) return;
    run.pendingActions.push({ ...action, executedAt: new Date() });
    run.updatedAt = new Date();
}

export function deleteAgenticRun(id: string): void {
    store.delete(id);
}

export function getRunsBySession(sessionId: string): AgenticRunState[] {
    return Array.from(store.values()).filter(r => r.sessionId === sessionId);
}

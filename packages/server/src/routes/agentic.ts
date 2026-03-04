import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { getProviderForModel, type StreamDelta } from '../llm/index.js';
import { createAgentRuntime, getSession, type AgentEvent } from '../agent/index.js';
import {
    createAgenticRun,
    getAgenticRun,
    updateAgenticRun,
    addPendingAction,
} from '../agent/agenticRun.js';
import { getConfig } from '../config.js';
import { broadcastToSession } from './chat.js';
import { nanoid } from 'nanoid';
import { getDrizzleDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';

// ── Zod Schemas ────────────────────────────────────────────────────────────────

const startSchema = z.object({
    sessionId: z.string(),
    goal: z.string().min(1),
    requireFinalApproval: z.boolean().optional().default(false),
    completionGoal: z.string().optional(),
});



// ── Summary helper ─────────────────────────────────────────────────────────────
// Streams a short plain-text summary of the completed agentic run directly to
// the client, then saves it to the DB and fires message_end.
//
// Uses provider.chat() with an EMPTY tools array so it is impossible for the
// model to make tool calls, hit maxSteps, or trigger a "Max steps reached" error.
// AgentRuntime is intentionally NOT used here — it always loads all registered
// tools, which caused the model to attempt further tool calls during the summary.
async function broadcastSummaryAsync(
    sessionId: string,
    model: string,
    goal: string,
    planSteps: { description: string }[],
): Promise<void> {
    const config = getConfig();
    const provider = getProviderForModel(model);

    const stepList = planSteps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
    const summaryPrompt = `The following agentic task just completed successfully.\n\nGoal: ${goal}\n\nSteps executed:\n${stepList}\n\nWrite a brief 2-3 sentence plain-text summary of what was accomplished. First person, no markdown, no tool calls.`;

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    await provider.chat(
        model,
        [
            {
                role: 'system',
                content: 'You are a concise reporting assistant. Your only job is to write clear, plain-text summaries of completed agentic tasks. Never propose tool calls. Never output JSON. Never use markdown headers. Just write 2-3 sentences of plain prose.'
                    + (config.PERSONALITY ? `\n\n${config.PERSONALITY}` : ''),
            },
            { role: 'user', content: summaryPrompt },
        ],
        [], // no tools — guaranteed text-only response
        (delta: StreamDelta) => {
            if (delta.type === 'text_delta' && delta.content) {
                fullText += delta.content;
                broadcastToSession(sessionId, { type: 'text_delta', content: delta.content });
            } else if (delta.type === 'message_end' && delta.usage) {
                inputTokens = delta.usage.inputTokens;
                outputTokens = delta.usage.outputTokens;
            }
        }
    );

    // Persist the summary so it appears after a session refresh.
    if (fullText.trim()) {
        try {
            const db = getDrizzleDb();
            await db.insert(schema.messages).values({
                id: nanoid(),
                sessionId,
                role: 'assistant',
                content: fullText.trim(),
                model,
                inputTokens,
                outputTokens,
                createdAt: new Date(),
            });
        } catch (e) {
            console.error('[Agentic] Failed to save summary message:', e);
        }
    }

    // message_end triggers queryClient.invalidateQueries on the client so the
    // newly saved summary row is fetched immediately.
    broadcastToSession(sessionId, { type: 'message_end', usage: { inputTokens, outputTokens } });
}

// ── Route Handler ──────────────────────────────────────────────────────────────


export async function agenticRoutes(fastify: FastifyInstance): Promise<void> {

    // POST /api/agentic/start
    // Triggers the LLM to generate a plan, then pauses and waits for user approval.
    fastify.post('/api/agentic/start', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const body = startSchema.parse(request.body);
            const { sessionId, goal, requireFinalApproval, completionGoal } = body;

            const session = getSession(sessionId);
            if (!session) return reply.code(404).send({ error: 'Session not found' });

            // Create the run record immediately so the client can track it
            const run = createAgenticRun({
                sessionId,
                goal,
                requireFinalApproval,
                completionGoal,
            });

            // Fire-and-forget: generate the plan via LLM, then broadcast it
            (async () => {
                try {
                    const config = getConfig();
                    const provider = getProviderForModel(session.model || config.DEFAULT_MODEL);

                    const PLAN_PROMPT = `You are a planning assistant. The user wants you to accomplish the following goal autonomously:

Goal: ${goal}

Break this goal into a clear, numbered list of concrete steps. For each step that requires a tool action, include the tool name in parentheses at the end. Keep descriptions brief (one line each).

CRITICAL requirements:
1. Output ONLY the numbered step list — no preamble, no markdown headers.
2. Format: "N. [description] (tool: toolName)" — omit the tool part if no tool is needed.
3. Maximum 10 steps.
4. Be specific about what you will do in each step.

Example:
1. List the contents of the current directory (tool: list_directory)
2. Read each file to understand its purpose (tool: read_file)
3. Summarize the findings in plain text

Now generate the plan:`;

                    let planText = '';
                    await provider.chat(
                        session.model || config.DEFAULT_MODEL,
                        [
                            { role: 'system', content: 'You are a step-by-step planning assistant. Output only the plan, no extra text.' },
                            { role: 'user', content: PLAN_PROMPT },
                        ],
                        [],
                        (delta: StreamDelta) => {
                            if (delta.type === 'text_delta' && delta.content) {
                                planText += delta.content;
                            }
                        }
                    );

                    // Parse the plan text into steps
                    const steps = parsePlanText(planText);
                    updateAgenticRun(run.id, { plan: steps, status: 'awaiting_approval' });

                    // Persist the plan as a real DB message so it survives session refetches.
                    // The content is a JSON blob with a __agentic discriminator that the
                    // frontend detects to render the plan card instead of a normal message.
                    const db = getDrizzleDb();
                    const planMsgId = nanoid();
                    await db.insert(schema.messages).values({
                        id: planMsgId,
                        sessionId,
                        role: 'assistant',
                        content: JSON.stringify({
                            __agentic: 'plan_proposed',
                            runId: run.id,
                            goal,
                            plan: steps,
                            requireFinalApproval: run.requireFinalApproval,
                            completionGoal: run.completionGoal,
                        }),
                        status: 'agentic_plan',
                        createdAt: new Date(),
                    });
                    updateAgenticRun(run.id, { planMsgId });

                    // Broadcast the plan — the frontend will invalidate the session
                    // query to load the real DB message.
                    broadcastToSession(sessionId, {
                        type: 'agentic_plan_proposed',
                        runId: run.id,
                        goal,
                        plan: steps,
                        requireFinalApproval: run.requireFinalApproval,
                        completionGoal: run.completionGoal,
                    });

                } catch (err) {
                    console.error('[Agentic] Plan generation failed:', err);
                    updateAgenticRun(run.id, { status: 'cancelled' });
                    broadcastToSession(sessionId, {
                        type: 'agentic_cancelled',
                        runId: run.id,
                        reason: 'Plan generation failed: ' + (err instanceof Error ? err.message : String(err)),
                    });
                }
            })();

            return reply.code(202).send({ runId: run.id, status: 'planning' });
        } catch (err) {
            if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid payload', details: err.errors });
            console.error('[Agentic] Start error:', err);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // GET /api/agentic/:runId
    fastify.get('/api/agentic/:runId', async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
        const run = getAgenticRun(request.params.runId);
        if (!run) return reply.code(404).send({ error: 'Agentic run not found' });
        return reply.send(run);
    });

    // POST /api/agentic/:runId/approve-plan
    // User approved the plan — start autonomous execution.
    fastify.post('/api/agentic/:runId/approve-plan', async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
        let run = getAgenticRun(request.params.runId);
        if (!run) return reply.code(404).send({ error: 'Agentic run not found' });
        if (run.status !== 'awaiting_approval') {
            return reply.code(409).send({ error: `Run is not awaiting approval (status: ${run.status})` });
        }

        // Allow the plan card to override the final-approval settings and plan order set at creation time.
        const body = (request.body ?? {}) as {
            requireFinalApproval?: boolean;
            completionGoal?: string;
            checkpointStepIdx?: number;
            plan?: Array<{ id: string; description: string; tool?: string; server?: string }>;
        };
        const updates: Partial<Omit<import('../agent/agenticRun.js').AgenticRunState, 'id' | 'createdAt'>> = {};
        if (body.requireFinalApproval !== undefined) updates.requireFinalApproval = body.requireFinalApproval;
        if (body.completionGoal !== undefined) updates.completionGoal = body.completionGoal;
        if (body.checkpointStepIdx !== undefined) updates.checkpointStepIdx = body.checkpointStepIdx;
        if (Array.isArray(body.plan) && body.plan.length > 0) updates.plan = body.plan;
        if (Object.keys(updates).length > 0) {
            run = updateAgenticRun(run.id, updates) ?? run;
        }

        updateAgenticRun(run.id, { status: 'running' });
        run = getAgenticRun(request.params.runId) ?? run;

        const session = getSession(run.sessionId);
        if (!session) return reply.code(404).send({ error: 'Session not found' });

        const config = getConfig();

        broadcastToSession(run.sessionId, { type: 'agentic_running', runId: run.id });

        // Snapshot immutable values into the closure.
        const { requireFinalApproval, id: runId, sessionId, planMsgId } = run;
        const MARKER = `[AGENTIC_GOAL_REACHED:${runId}]`;

        // ── Determine if this is a mid-plan checkpoint ─────────────────────────────
        // checkpointStepIdx is 0-based. A mid-plan checkpoint means there are steps
        // after it that should execute in phase 2 (after user confirm).
        const cpIdx = run.checkpointStepIdx;
        const isMidPlanCheckpoint =
            requireFinalApproval &&
            cpIdx !== undefined &&
            cpIdx < run.plan.length - 1;

        // Phase 1 only runs up to and including the checkpoint step (if mid-plan).
        const phase1Steps = isMidPlanCheckpoint ? run.plan.slice(0, cpIdx! + 1) : run.plan;
        const planText = phase1Steps
            .map((s, i) => `${i + 1}. ${s.description}${s.tool ? ` (tool: ${s.tool})` : ''}`)
            .join('\n');

        const checkpointInstruction = requireFinalApproval
            ? isMidPlanCheckpoint
                ? `\n- CRITICAL: After completing step ${cpIdx! + 1} (the last step in this phase), output the following EXACT token on its own line and then STOP — do NOT continue to any other steps: [AGENTIC_GOAL_REACHED:${runId}]`
                : `\n- CHECKPOINT: When you have completed ALL steps${run.completionGoal ? ` and reached the goal ("${run.completionGoal}")` : ''}, output the following EXACT token on its own line: [AGENTIC_GOAL_REACHED:${runId}]`
            : '';

        const agentMessage = `[AGENTIC MODE ACTIVE] You must now autonomously execute the following plan to accomplish this goal.
Goal: ${run.goal}

Plan:
${planText}

CRITICAL RULES:
- Execute EVERY step in order using real tool calls. Do NOT skip steps.
- Do NOT ask for confirmation between steps — execute them back-to-back.
- Do NOT describe what you "would" do — actually DO it with tool calls.
- A single step may require MULTIPLE tool calls — complete all of them before marking the step done.
- After completing all steps, write a brief plain-text summary of what was accomplished.${checkpointInstruction}

STEP TRACKING (you MUST follow this exactly):
- Immediately before starting work on step N, output this exact token on its own line: [STEP_START:N]
- Immediately after ALL tool calls for step N are complete, output this exact token on its own line: [STEP_DONE:N]
- Do this for every step, even if you think a step has no tool calls.

Example for a 3-step plan:
[STEP_START:1]
<tool calls for step 1>
[STEP_DONE:1]
[STEP_START:2]
<tool calls for step 2 — there may be several>
[STEP_DONE:2]
[STEP_START:3]
<tool calls for step 3>
[STEP_DONE:3]
Brief summary of what was accomplished.

Begin now.`;

        // Update DB message status to 'agentic_running'.
        if (planMsgId) {
            getDrizzleDb().update(schema.messages)
                .set({ status: 'agentic_running' })
                .where(eq(schema.messages.id, planMsgId))
                .catch(e => console.error('[Agentic] Failed to update plan msg status:', e));
        }

        // ── Shared phase runner ────────────────────────────────────────────────────
        // Executes the agent for one phase, scanning step markers and optionally the
        // checkpoint marker. startStepOffset is the 1-based number of the first step
        // in this phase (1 for phase 1, cpIdx+2 for phase 2).
        const runPhase = async (phaseMsg: string, startStepOffset: number, detectCheckpoint: boolean) => {
            let fullText = '';
            let lastStartN = startStepOffset - 1;
            let lastDoneN  = startStepOffset - 1;
            let currentStepIdx = startStepOffset - 2; // 0-based
            let checkpointFired = false;
            let abortedForCheckpoint = false;
            // Track whether the current LLM turn had any tool calls.
            // Turns with no tool calls are the final report turn — stream it to the client.
            let currentTurnHasToolCall = false;
            let currentTurnTextBuffer = '';

            const STEP_START_RE = /\[STEP_START:(\d+)\]/g;
            const STEP_DONE_RE  = /\[STEP_DONE:(\d+)\]/g;
            const phaseAbort = new AbortController();

            const scanTextMarkers = () => {
                for (const m of fullText.matchAll(STEP_START_RE)) {
                    const n = parseInt(m[1], 10);
                    if (n > lastStartN) {
                        lastStartN = n;
                        currentStepIdx = n - 1;
                        broadcastToSession(sessionId, {
                            type: 'agentic_step_progress', runId,
                            stepIndex: currentStepIdx, tool: '', status: 'running',
                        });
                    }
                }
                for (const m of fullText.matchAll(STEP_DONE_RE)) {
                    const n = parseInt(m[1], 10);
                    if (n > lastDoneN) {
                        lastDoneN = n;
                        broadcastToSession(sessionId, {
                            type: 'agentic_step_progress', runId,
                            stepIndex: n - 1, tool: '', status: 'done',
                        });
                    }
                }
                if (detectCheckpoint && !checkpointFired && fullText.includes(MARKER)) {
                    const currentRun = getAgenticRun(runId);
                    if (currentRun?.status === 'running') {
                        checkpointFired = true;
                        updateAgenticRun(runId, { status: 'awaiting_checkpoint' });
                        const actions = (currentRun.pendingActions ?? []).map(a => ({
                            ...a, executedAt: a.executedAt.toISOString(),
                        }));
                        broadcastToSession(sessionId, { type: 'agentic_final_checkpoint', runId, pendingActions: actions });
                        // For mid-plan checkpoints: abort so the agent stops after the checkpoint step.
                        if (isMidPlanCheckpoint) {
                            abortedForCheckpoint = true;
                            phaseAbort.abort();
                        }
                    }
                }
                if (fullText.length > 8192) fullText = fullText.slice(-4096);
            };

            const handleEvent = (event: AgentEvent) => {
                if (event.type === 'text_delta' && event.content) {
                    fullText += event.content;
                    currentTurnTextBuffer += event.content;
                    scanTextMarkers();
                } else if (event.type === 'tool_call_start') {
                    // This turn has a tool call — it's a mid-run turn, not the final report.
                    currentTurnHasToolCall = true;
                    // Discard any text preamble before the tool call.
                    currentTurnTextBuffer = '';
                    broadcastToSession(sessionId, {
                        type: 'agentic_step_progress', runId,
                        stepIndex: currentStepIdx, tool: event.tool, status: 'running',
                    });
                    broadcastToSession(sessionId, event);
                } else if (event.type === 'tool_call_result') {
                    broadcastToSession(sessionId, event);
                } else if (event.type === 'message_end') {
                    if (!currentTurnHasToolCall && currentTurnTextBuffer.length > 0) {
                        // This is the final report turn — stream the buffered text to the client.
                        const chunks = currentTurnTextBuffer.match(/.{1,64}/gs) ?? [currentTurnTextBuffer];
                        for (const chunk of chunks) {
                            broadcastToSession(sessionId, { type: 'text_delta', content: chunk });
                        }
                        // Forward message_end so the client triggers a session refetch.
                        broadcastToSession(sessionId, event);
                    }
                    // Reset per-turn state.
                    currentTurnHasToolCall = false;
                    currentTurnTextBuffer = '';
                } else {
                    broadcastToSession(sessionId, event);
                }
            };

            try {
                await createAgentRuntime(
                    {
                        sessionId,
                        model: session.model || config.DEFAULT_MODEL,
                        personality: session.personality || config.PERSONALITY,
                        mode: session.mode,
                        maxSteps: config.MAX_STEPS,
                        autoExecute: true,
                        signal: phaseAbort.signal,
                        approvalFn: async (call) => {
                            addPendingAction(runId, { tool: call.toolName, server: call.serverId, input: call.input });
                            return true;
                        },
                    },
                    handleEvent,
                ).run(phaseMsg);
                return { ok: true, checkpointFired };
            } catch (err: unknown) {
                if (abortedForCheckpoint) return { ok: true, checkpointFired: true };
                console.error('[Agentic] Phase execution error:', err);
                return { ok: false, checkpointFired };
            }
        };

        // Fire and forget (phase 1)
        (async () => {
            const result = await runPhase(agentMessage, 1, requireFinalApproval);

            if (!result.ok) {
                updateAgenticRun(runId, { status: 'cancelled' });
                if (planMsgId) getDrizzleDb().update(schema.messages).set({ status: 'agentic_cancelled' }).where(eq(schema.messages.id, planMsgId)).catch(console.error);
                broadcastToSession(sessionId, { type: 'agentic_cancelled', runId, reason: 'Execution error' });
                return;
            }

            if (result.checkpointFired) {
                // Await user confirm/discard. confirm-goal will handle phase 2 (if needed) and agentic_done.
                return;
            }

            // Fallback: requireFinalApproval set but LLM never emitted the marker.
            if (requireFinalApproval && !result.checkpointFired) {
                const latestRun = getAgenticRun(runId);
                if (latestRun && (latestRun.status === 'running' || latestRun.status === 'awaiting_checkpoint')) {
                    updateAgenticRun(runId, { status: 'awaiting_checkpoint' });
                    const actions = (latestRun.pendingActions ?? []).map(a => ({ ...a, executedAt: a.executedAt.toISOString() }));
                    broadcastToSession(sessionId, { type: 'agentic_final_checkpoint', runId, pendingActions: actions });
                    return;
                }
            }

            // No checkpoint — mark done.
            const latestRun = getAgenticRun(runId);
            if (latestRun && latestRun.status === 'running') {
                updateAgenticRun(runId, { status: 'done' });
                if (planMsgId) getDrizzleDb().update(schema.messages).set({ status: 'agentic_done' }).where(eq(schema.messages.id, planMsgId)).catch(console.error);
                broadcastToSession(sessionId, { type: 'agentic_done', runId });
                // The actual final report was already streamed to the client by handleEvent
                // (final turn with no tool calls) and saved to DB by the runtime. No summary needed.
            }
        })();

        return reply.send({ runId: run.id, status: 'running' });
    });


    // POST /api/agentic/:runId/deny-plan
    // User denied the plan — cancel the run.
    fastify.post('/api/agentic/:runId/deny-plan', async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
        const body = request.body as { reason?: string };
        const run = getAgenticRun(request.params.runId);
        if (!run) return reply.code(404).send({ error: 'Agentic run not found' });

        updateAgenticRun(run.id, { status: 'cancelled' });
        broadcastToSession(run.sessionId, {
            type: 'agentic_cancelled',
            runId: run.id,
            reason: body?.reason || 'Plan denied by user',
        });

        return reply.send({ runId: run.id, status: 'cancelled' });
    });

    // POST /api/agentic/:runId/confirm-goal
    // User confirmed the final checkpoint — either run phase 2 (if there are remaining steps)
    // or commit the run as done immediately.
    fastify.post('/api/agentic/:runId/confirm-goal', async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
        const run = getAgenticRun(request.params.runId);
        if (!run) return reply.code(404).send({ error: 'Agentic run not found' });
        if (run.status !== 'awaiting_checkpoint') {
            return reply.code(409).send({ error: `Run is not awaiting checkpoint (status: ${run.status})` });
        }

        const session = getSession(run.sessionId);
        if (!session) return reply.code(404).send({ error: 'Session not found' });
        const config = getConfig();

        const cpIdx = run.checkpointStepIdx;
        const hasPhase2 =
            run.requireFinalApproval &&
            cpIdx !== undefined &&
            cpIdx < run.plan.length - 1;

        if (hasPhase2) {
            // ── Phase 2: execute remaining steps after the checkpoint ──────────────
            updateAgenticRun(run.id, { status: 'running' });

            // Signal the frontend that execution is continuing so the checklist overlay
            // stays visible and picks up where it left off.
            broadcastToSession(run.sessionId, { type: 'agentic_running', runId: run.id });

            const phase2StartIdx = cpIdx! + 1; // 0-based first step of phase 2
            const remainingSteps = run.plan.slice(phase2StartIdx);
            const phase2PlanText = remainingSteps
                .map((s, i) => `${phase2StartIdx + i + 1}. ${s.description}${s.tool ? ` (tool: ${s.tool})` : ''}`)
                .join('\n');

            const phase2Message = `[AGENTIC MODE ACTIVE] You are continuing the execution of a multi-phase plan. The first phase has already been completed and approved by the user.

Goal: ${run.goal}

Remaining steps to execute now:
${phase2PlanText}

CRITICAL RULES:
- Execute EVERY remaining step in order using real tool calls. Do NOT skip steps.
- Do NOT ask for confirmation between steps — execute them back-to-back.
- Do NOT describe what you "would" do — actually DO it with tool calls.
- After completing all remaining steps, write a brief plain-text summary of everything accomplished across both phases.

STEP TRACKING (you MUST follow this exactly):
- Immediately before starting work on step N, output this exact token on its own line: [STEP_START:N]
- Immediately after ALL tool calls for step N are complete, output this exact token on its own line: [STEP_DONE:N]
- Step numbers continue from where phase 1 left off (first step here is step ${phase2StartIdx + 1}).

Begin now.`;

            const { id: runId, sessionId, planMsgId } = run;
            const MARKER_P2 = `[AGENTIC_GOAL_REACHED:${runId}]`;

            (async () => {
                let fullText = '';
                // Initialise to phase2StartIdx so we don't re-fire phase-1 step markers.
                let lastStartN = phase2StartIdx;
                let lastDoneN  = phase2StartIdx;
                let currentStepIdx = phase2StartIdx - 1;
                // Track whether the current LLM turn had any tool calls.
                // Turns with no tool calls are the final report turn — stream it to the client.
                let currentTurnHasToolCall = false;
                let currentTurnTextBuffer = '';

                const STEP_START_RE = /\[STEP_START:(\d+)\]/g;
                const STEP_DONE_RE  = /\[STEP_DONE:(\d+)\]/g;

                // Normalise a raw step number emitted by the LLM to an absolute (1-based)
                // step number in the full plan.  The LLM may restart its counter from 1
                // ("relative") or continue from where phase 1 left off ("absolute").
                // Rule: if n > phase2StartIdx the number is already absolute; otherwise
                // it is relative and we offset it by phase2StartIdx.
                const toAbsoluteN = (n: number) =>
                    n > phase2StartIdx ? n : n + phase2StartIdx;

                const handleEvent = (event: AgentEvent) => {
                    if (event.type === 'text_delta' && event.content) {
                        fullText += event.content;
                        currentTurnTextBuffer += event.content;
                        for (const m of fullText.matchAll(STEP_START_RE)) {
                            const absN = toAbsoluteN(parseInt(m[1], 10));
                            if (absN > lastStartN) {
                                lastStartN = absN;
                                currentStepIdx = absN - 1;
                                broadcastToSession(sessionId, {
                                    type: 'agentic_step_progress', runId,
                                    stepIndex: currentStepIdx, tool: '', status: 'running',
                                });
                            }
                        }
                        for (const m of fullText.matchAll(STEP_DONE_RE)) {
                            const absN = toAbsoluteN(parseInt(m[1], 10));
                            if (absN > lastDoneN) {
                                lastDoneN = absN;
                                broadcastToSession(sessionId, {
                                    type: 'agentic_step_progress', runId,
                                    stepIndex: absN - 1, tool: '', status: 'done',
                                });
                            }
                        }
                        // Ignore any stray checkpoint marker in phase 2.
                        if (fullText.includes(MARKER_P2)) fullText = fullText.replace(MARKER_P2, '');
                        if (fullText.length > 8192) fullText = fullText.slice(-4096);
                    } else if (event.type === 'tool_call_start') {
                        // This turn has a tool call — it's a mid-run turn, not the final report.
                        currentTurnHasToolCall = true;
                        currentTurnTextBuffer = '';
                        broadcastToSession(sessionId, {
                            type: 'agentic_step_progress', runId,
                            stepIndex: currentStepIdx, tool: event.tool, status: 'running',
                        });
                        broadcastToSession(sessionId, event);
                    } else if (event.type === 'tool_call_result') {
                        broadcastToSession(sessionId, event);
                    } else if (event.type === 'message_end') {
                        if (!currentTurnHasToolCall && currentTurnTextBuffer.length > 0) {
                            // This is the final report turn — stream the buffered text to the client.
                            const chunks = currentTurnTextBuffer.match(/.{1,64}/gs) ?? [currentTurnTextBuffer];
                            for (const chunk of chunks) {
                                broadcastToSession(sessionId, { type: 'text_delta', content: chunk });
                            }
                            // Forward message_end so the client triggers a session refetch.
                            broadcastToSession(sessionId, event);
                        }
                        // Reset per-turn state.
                        currentTurnHasToolCall = false;
                        currentTurnTextBuffer = '';
                    } else {
                        broadcastToSession(sessionId, event);
                    }
                };

                try {
                    await createAgentRuntime(
                        {
                            sessionId,
                            model: session.model || config.DEFAULT_MODEL,
                            personality: session.personality || config.PERSONALITY,
                            mode: session.mode,
                            maxSteps: config.MAX_STEPS,
                            autoExecute: true,
                            approvalFn: async (call) => {
                                addPendingAction(runId, { tool: call.toolName, server: call.serverId, input: call.input });
                                return true;
                            },
                        },
                        handleEvent,
                    ).run(phase2Message);

                    updateAgenticRun(runId, { status: 'done' });
                    if (planMsgId) getDrizzleDb().update(schema.messages).set({ status: 'agentic_done' }).where(eq(schema.messages.id, planMsgId)).catch(console.error);
                    broadcastToSession(sessionId, { type: 'agentic_done', runId });
                    // The actual final report was already streamed to the client by handleEvent
                    // (final turn with no tool calls) and saved to DB by the runtime. No summary needed.
                } catch (err) {
                    console.error('[Agentic] Phase 2 execution error:', err);
                    updateAgenticRun(runId, { status: 'cancelled' });
                    if (planMsgId) getDrizzleDb().update(schema.messages).set({ status: 'agentic_cancelled' }).where(eq(schema.messages.id, planMsgId)).catch(console.error);
                    broadcastToSession(sessionId, { type: 'agentic_cancelled', runId, reason: 'Phase 2 execution error' });
                }
            })();

        } else {
            // ── No phase 2: all steps already done. Commit immediately. ───────────
            updateAgenticRun(run.id, { status: 'done' });
            if (run.planMsgId) {
                getDrizzleDb().update(schema.messages)
                    .set({ status: 'agentic_done' })
                    .where(eq(schema.messages.id, run.planMsgId))
                    .catch(e => console.error('[Agentic] Failed to update plan msg on confirm-goal:', e));
            }
            broadcastToSession(run.sessionId, { type: 'agentic_done', runId: run.id });

            // Fire a brief summary visible in the chat thread.
            broadcastSummaryAsync(run.sessionId, session.model || config.DEFAULT_MODEL, run.goal, run.plan).catch(console.error);
        }

        return reply.send({ runId: run.id, status: hasPhase2 ? 'running' : 'done' });
    });

    // POST /api/agentic/:runId/deny-goal
    // User discarded the final checkpoint — instruct the agent to revert what it can.
    fastify.post('/api/agentic/:runId/deny-goal', async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
        const run = getAgenticRun(request.params.runId);
        if (!run) return reply.code(404).send({ error: 'Agentic run not found' });
        if (run.status !== 'awaiting_checkpoint') {
            return reply.code(409).send({ error: `Run is not awaiting checkpoint (status: ${run.status})` });
        }

        updateAgenticRun(run.id, { status: 'cancelled' });

        // Update the DB plan message so the thread shows cancelled state on refresh
        if (run.planMsgId) {
            getDrizzleDb().update(schema.messages)
                .set({ status: 'agentic_cancelled' })
                .where(eq(schema.messages.id, run.planMsgId))
                .catch(e => console.error('[Agentic] Failed to update plan msg on deny-goal:', e));
        }

        broadcastToSession(run.sessionId, {
            type: 'agentic_cancelled',
            runId: run.id,
            reason: 'Discarded at final checkpoint by user',
        });

        // Ask the LLM to revert whatever it can
        const session = getSession(run.sessionId);
        if (session) {
            const config = getConfig();
            const actionSummary = run.pendingActions.map(a =>
                `- ${a.tool} (${a.server}) with input: ${JSON.stringify(a.input).substring(0, 120)}`
            ).join('\n');

            createAgentRuntime(
                {
                    sessionId: run.sessionId,
                    model: session.model || config.DEFAULT_MODEL,
                    personality: session.personality || config.PERSONALITY,
                    mode: session.mode,
                    maxSteps: config.MAX_STEPS,
                    autoExecute: true,
                },
                (event) => broadcastToSession(run.sessionId, event)
            ).run(
                `[SYSTEM] The user reviewed your actions and chose to DISCARD them. ` +
                `Please revert or undo as many of the following actions as possible using your available tools:\n\n${actionSummary}\n\n` +
                `If an action cannot be undone (e.g., an external API call), clearly state that in your response. ` +
                `After attempting reversals, summarize what was undone and what could not be undone.`
            ).catch(console.error);
        }

        return reply.send({ runId: run.id, status: 'cancelled' });
    });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parsePlanText(text: string): Array<{ id: string; description: string; tool?: string; server?: string }> {
    const steps: Array<{ id: string; description: string; tool?: string }> = [];
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
        // Match "N. Description (tool: toolName)" or "N. Description"
        const match = line.match(/^\d+\.\s+(.+?)(?:\s+\(tool:\s*([^)]+)\))?$/);
        if (match) {
            const [, description, tool] = match;
            steps.push({
                id: nanoid(),
                description: description.trim(),
                tool: tool?.trim(),
            });
        }
    }

    // Fallback: if regex didn't match anything, split on numbered lines loosely
    if (steps.length === 0) {
        const looseLines = lines.filter(l => /^\d+\./.test(l.trim()));
        for (const line of looseLines) {
            steps.push({
                id: nanoid(),
                description: line.replace(/^\d+\.\s*/, '').trim(),
            });
        }
    }

    return steps;
}

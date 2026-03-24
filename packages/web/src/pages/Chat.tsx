import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Loader2, Bird, Check, Copy, AlertTriangle, X, Wrench, ChevronDown, ChevronUp, Zap, Bot, GripVertical, Flag, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { apiFetch, getWsUrl, type AgentEvent } from '../api';
import { ChatInput } from '../components/ChatInput';
import { notifyAgentDoneAsync, notifyToolDeniedAsync } from '../lib/notifications';

// ── Copy Button for Code Blocks ───────────────────────────────────────────────
function CodeBlock({ children, className, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = codeRef.current?.textContent || '';
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isInline = !className && typeof children === 'string' && !children.trim().includes('\n');
  if (isInline) {
    return <code className="bg-white/10 px-1.5 py-0.5 rounded text-cyan-300 font-mono text-xs" {...props}>{children}</code>;
  }

  // Extract language from className (e.g., "language-javascript")
  const lang = className?.replace('language-', '') || 'code';

  return (
    <div className="relative group my-6 rounded-xl overflow-hidden border border-white/5 bg-zinc-950/50 shadow-2xl backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/50" />
          <span className="text-[10px] font-mono text-gray-400 uppercase tracking-[0.2em] font-bold">{lang}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-all text-gray-400 hover:text-white group/btn"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-green-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 group-hover/btn:scale-110 transition-transform" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-5 overflow-x-auto custom-scrollbar">
        <code ref={codeRef} className={`${className} text-[13px] leading-relaxed font-mono selection:bg-cyan-500/30`} {...props}>{children}</code>
      </div>
    </div>
  );
}

// ── WebSocket Ready Guard ─────────────────────────────────────────────────────
// Returns a Promise that resolves when the socket is OPEN (or rejects after 5s)
function waitForSocket(ws: WebSocket | null): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (!ws) return reject(new Error('No WebSocket instance'));
    if (ws.readyState === WebSocket.OPEN) return resolve(ws);
    const deadline = Date.now() + 5000;
    const check = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        clearInterval(check);
        resolve(ws);
      } else if (Date.now() > deadline || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        clearInterval(check);
        reject(new Error(`WebSocket failed to open (state=${ws.readyState})`));
      }
    }, 50);
  });
}

// Polls wsRef.current until an OPEN socket appears (handles race between
// session creation and the useEffect that creates the WebSocket).
// If the socket dies (CLOSED) mid-poll, it calls `reconnect` to create a
// fresh one so we don't stall for the full timeout.
function waitForSocketRef(
  wsRef: React.MutableRefObject<WebSocket | null>,
  reconnect: () => WebSocket,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const check = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(check);
        resolve(ws);
      } else if (ws && ws.readyState === WebSocket.CLOSED) {
        // Socket died — create a fresh one immediately instead of waiting.
        console.warn('[waitForSocketRef] socket CLOSED, reconnecting…');
        wsRef.current = reconnect();
      } else if (Date.now() > deadline) {
        clearInterval(check);
        const state = ws ? ws.readyState : 'null';
        reject(new Error(`WebSocket connection timeout (ref polling, state=${state})`));
      }
    }, 50);
  });
}


// ── Collapsible "Denied" card ────────────────────────────────────────────────
// Collapsed by default to keep the chat feed clean. Click to expand with reason.
function DeniedCollapsible({ reason }: { reason: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="mt-3 bg-rose-950/20 border border-rose-500/20 rounded-md overflow-hidden cursor-pointer"
      onClick={() => setExpanded(v => !v)}
    >
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-[10px] font-mono text-rose-400 uppercase tracking-wider">
          Execution Denied — Re-evaluating
        </span>
        <span className="text-[9px] font-mono text-gray-600">{expanded ? "▲ hide" : "▼ details"}</span>
      </div>
      {expanded && (
        <div className="px-3 pb-2 border-t border-rose-500/10">
          <p className="text-[10px] font-mono text-gray-500 mt-2">
            {reason.trim()
              ? <><span className="text-gray-400">Reason:</span> <span className="text-rose-300">{reason}</span></>
              : "No reason provided."}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Agentic Plan Card ────────────────────────────────────────────────────────
// Shown when the AI has generated a plan and is waiting for user approval.
// Features:
//   • Drag-to-reorder steps via the grip handle
//   • Click the flag icon (when requireFinal is on) to set any step as the checkpoint
//   • Add a custom step at the bottom and drag it into position
function AgenticPlanCard({ runId, goal, plan: initialPlan, sessionId, onAction, initialRequireFinal }: {
  runId: string;
  goal: string;
  plan: { id: string; description: string; tool?: string; server?: string }[];
  sessionId: string | null;
  onAction: () => void;
  initialRequireFinal?: boolean;
  initialCompletionGoal?: string; // kept for backwards-compat, no longer used directly
}) {
  const [status, setStatus] = useState<'idle' | 'approving' | 'denying' | 'done' | 'cancelled'>('idle');
  const [requireFinal, setRequireFinal] = useState(initialRequireFinal ?? false);
  // Local copy of the plan so the user can reorder / add custom steps
  const [localPlan, setLocalPlan] = useState(initialPlan);
  // The step ID marked as the checkpoint (agent pauses after completing this step)
  const [checkpointStepId, setCheckpointStepId] = useState<string | null>(null);
  // New custom step input
  const [newStepText, setNewStepText] = useState('');
  // Drag state
  const dragSrcIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── Drag handlers ───────────────────────────────────────────────────────────
  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    dragSrcIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };
  const handleDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const src = dragSrcIdx.current;
    if (src === null || src === idx) { setDragOverIdx(null); return; }
    const next = [...localPlan];
    const [moved] = next.splice(src, 1);
    next.splice(idx, 0, moved);
    setLocalPlan(next);
    dragSrcIdx.current = null;
    setDragOverIdx(null);
  };
  const handleDragEnd = () => { dragSrcIdx.current = null; setDragOverIdx(null); };

  // ── Add custom step ─────────────────────────────────────────────────────────
  const addCustomStep = () => {
    const text = newStepText.trim();
    if (!text) return;
    const { nanoid } = { nanoid: () => Math.random().toString(36).slice(2, 11) };
    setLocalPlan(prev => [...prev, { id: `custom-${nanoid()}`, description: text }]);
    setNewStepText('');
  };

  // ── Approve / Deny ──────────────────────────────────────────────────────────
  const handleApprove = async () => {
    setStatus('approving');
    // Derive checkpoint step index (0-based) from the flagged step in the local plan.
    const cpIdx = checkpointStepId ? localPlan.findIndex(s => s.id === checkpointStepId) : -1;
    const checkpointStep = cpIdx >= 0 ? localPlan[cpIdx] : null;
    try {
      await apiFetch(`/api/agentic/${runId}/approve-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requireFinalApproval: requireFinal,
          completionGoal: requireFinal && checkpointStep ? checkpointStep.description : undefined,
          checkpointStepIdx: requireFinal && cpIdx >= 0 ? cpIdx : undefined,
          plan: localPlan,
        }),
      });
      setStatus('done');
      onAction();
    } catch (e) {
      console.error('[AgenticPlanCard] Approve failed:', e);
      setStatus('idle');
    }
  };

  const handleDeny = async () => {
    setStatus('denying');
    try {
      await apiFetch(`/api/agentic/${runId}/deny-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Denied by user' }),
      });
      setStatus('cancelled');
      onAction();
    } catch (e) {
      console.error('[AgenticPlanCard] Deny failed:', e);
      setStatus('idle');
    }
  };

  if (status === 'done') {
    return (
      <div className="mt-2 bg-violet-950/20 border border-violet-500/20 rounded-md p-3 flex items-center gap-2">
        <Zap className="w-3 h-3 text-violet-400" />
        <span className="text-[10px] font-mono text-violet-400 uppercase tracking-wider">Agent Running Autonomously…</span>
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse ml-auto" />
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="mt-2 bg-rose-950/20 border border-rose-500/20 rounded-md p-3 flex items-center gap-2">
        <X className="w-3 h-3 text-rose-400" />
        <span className="text-[10px] font-mono text-rose-400 uppercase tracking-wider">Agentic Run Cancelled</span>
      </div>
    );
  }

  const isLoading = status === 'approving' || status === 'denying';
  const checkpointIdx = checkpointStepId ? localPlan.findIndex(s => s.id === checkpointStepId) : -1;

  return (
    <div className="mt-2 bg-zinc-950 border border-violet-500/30 rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="px-4 py-3 border-b border-violet-500/10 flex items-center gap-2 bg-violet-950/20">
        <Zap className="w-4 h-4 text-violet-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono text-violet-300 uppercase tracking-wider">Agentic Plan Proposed</p>
          <p className="text-sm text-gray-200 mt-0.5 font-medium truncate">{goal}</p>
        </div>
      </div>

      {/* Plan Steps */}
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
            Planned Steps ({localPlan.length})
          </p>
          {requireFinal && (
            <p className="text-[9px] font-mono text-violet-400/70">
              Click <Flag className="w-2.5 h-2.5 inline mb-0.5" /> to set checkpoint · drag <GripVertical className="w-2.5 h-2.5 inline mb-0.5" /> to reorder
            </p>
          )}
          {!requireFinal && (
            <p className="text-[9px] font-mono text-gray-600">
              Drag <GripVertical className="w-2.5 h-2.5 inline mb-0.5" /> to reorder
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          {localPlan.map((step, idx) => {
            const isCheckpoint = step.id === checkpointStepId;
            const isDragTarget = dragOverIdx === idx;
            const isPastCheckpoint = checkpointIdx >= 0 && idx > checkpointIdx;

            return (
              <div key={step.id}>
                {/* Drop zone indicator above */}
                {isDragTarget && dragSrcIdx.current !== null && dragSrcIdx.current !== idx && (
                  <div className="h-0.5 bg-violet-500 rounded-full mb-1 mx-2" />
                )}
                <div
                  draggable
                  onDragStart={handleDragStart(idx)}
                  onDragOver={handleDragOver(idx)}
                  onDrop={handleDrop(idx)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-start gap-2 px-3 py-2 rounded-lg border transition-all duration-150 cursor-default select-none ${
                    isCheckpoint
                      ? 'bg-violet-950/40 border-violet-500/50 ring-1 ring-violet-500/30'
                      : isPastCheckpoint
                        ? 'bg-black/20 border-white/3 opacity-40'
                        : isDragTarget
                          ? 'bg-violet-950/20 border-violet-500/30'
                          : 'bg-black/40 border-white/5 hover:border-white/10'
                  }`}
                >
                  {/* Drag handle */}
                  <span
                    className="shrink-0 mt-0.5 text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    <GripVertical className="w-3 h-3" />
                  </span>

                  {/* Step number */}
                  <span className={`text-[10px] font-mono shrink-0 mt-0.5 w-4 text-right ${isCheckpoint ? 'text-violet-400' : isPastCheckpoint ? 'text-gray-600' : 'text-violet-500'}`}>
                    {idx + 1}.
                  </span>

                  {/* Step content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12px] ${isCheckpoint ? 'text-violet-200' : isPastCheckpoint ? 'text-gray-600' : 'text-gray-300'}`}>
                      {step.description}
                    </p>
                    {step.tool && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 bg-cyan-950/40 border border-cyan-500/20 rounded text-[9px] font-mono text-cyan-400">{step.tool}</span>
                    )}
                  </div>

                  {/* Checkpoint flag button — only visible when requireFinal is on */}
                  {requireFinal && (
                    <button
                      onClick={() => setCheckpointStepId(isCheckpoint ? null : step.id)}
                      title={isCheckpoint ? 'Remove checkpoint' : 'Set as Goal Before Final Confirmation Prompt'}
                      className={`shrink-0 p-1 rounded transition-all ${
                        isCheckpoint
                          ? 'text-violet-400 bg-violet-950/50 hover:bg-violet-900/50'
                          : 'text-gray-600 hover:text-violet-400 hover:bg-violet-950/30'
                      }`}
                    >
                      <Flag className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Checkpoint label below the selected step */}
                {isCheckpoint && (
                  <div className="flex items-center gap-1.5 ml-8 mt-0.5 mb-1">
                    <div className="h-px flex-1 bg-violet-500/30" />
                    <span className="text-[9px] font-mono text-violet-400 px-2 py-0.5 bg-violet-950/40 rounded border border-violet-500/20">
                      ▲ Agent pauses here for final review
                    </span>
                    <div className="h-px flex-1 bg-violet-500/30" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add custom step */}
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={newStepText}
            onChange={e => setNewStepText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomStep(); } }}
            placeholder="Add a custom step and drag it into position…"
            className="flex-1 px-3 py-1.5 bg-black/50 border border-white/10 rounded-lg text-[12px] text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/20 transition-colors"
          />
          <button
            onClick={addCustomStep}
            disabled={!newStepText.trim()}
            title="Add step"
            className="p-1.5 bg-black border border-white/10 hover:bg-violet-950/30 hover:border-violet-500/30 text-gray-500 hover:text-violet-400 rounded-lg transition-colors disabled:opacity-30"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Final approval checkbox */}
        <div className="mt-4 pt-4 border-t border-white/5">
          <label className="flex items-start gap-3 cursor-pointer group">
            <div
              className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${requireFinal ? 'bg-violet-600 border-violet-500' : 'bg-black border-white/20 group-hover:border-violet-500/40'}`}
              onClick={() => {
                const next = !requireFinal;
                setRequireFinal(next);
                if (!next) setCheckpointStepId(null); // clear checkpoint when disabling
              }}
            >
              {requireFinal && <Check className="w-2.5 h-2.5 text-white" />}
            </div>
            <div>
              <span className="text-sm text-gray-300 font-medium">Request final approval before committing</span>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Agent pauses {checkpointStepId ? 'after the flagged step' : 'when all steps are done'} and shows a summary of every action taken.
              </p>
            </div>
          </label>
        </div>

        {/* Warning */}
        <div className="px-3 py-2 bg-amber-950/20 border border-amber-500/20 rounded-lg flex items-start gap-2 mt-3">
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-gray-500">
            The agent will execute tool calls <strong className="text-amber-300">without individual confirmation</strong>. Permission rules still apply.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleDeny}
            disabled={isLoading}
            className="flex-1 px-3 py-2 bg-black border border-white/10 hover:bg-white/5 text-gray-400 hover:text-white text-[10px] font-bold font-mono uppercase tracking-wider rounded-lg transition-colors disabled:opacity-50"
          >
            {status === 'denying' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Deny Plan'}
          </button>
          <button
            onClick={handleApprove}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-[10px] font-bold font-mono uppercase tracking-wider rounded-lg transition-all shadow-[0_0_15px_rgba(139,92,246,0.3)] hover:shadow-[0_0_25px_rgba(139,92,246,0.5)]"
          >
            {status === 'approving' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {status === 'approving' ? 'Starting…' : 'Approve & Run'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Agentic Final Checkpoint Card ─────────────────────────────────────────────
// Shown when the agent believes it has reached the user's goal and wants confirmation.
function AgenticFinalCheckpointCard({ runId, pendingActions, onDismiss }: {
  runId: string;
  pendingActions: { tool: string; server: string; input: Record<string, unknown>; result?: unknown; executedAt: string }[];
  onDismiss: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'confirming' | 'discarding' | 'confirmed' | 'discarded'>('idle');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleConfirm = async () => {
    setStatus('confirming');
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/agentic/${runId}/confirm-goal`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || `Server error ${res.status}`);
      }
      setStatus('confirmed');
      // Dismiss the overlay after 1.5s so the user can see the confirmed state
      setTimeout(onDismiss, 1500);
    } catch (e: any) {
      console.error('[AgenticFinalCheckpointCard] Confirm failed:', e);
      setErrorMsg(e.message || 'Failed to confirm. Please try again.');
      setStatus('idle');
    }
  };

  const handleDiscard = async () => {
    setStatus('discarding');
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/agentic/${runId}/deny-goal`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || `Server error ${res.status}`);
      }
      setStatus('discarded');
      setTimeout(onDismiss, 1500);
    } catch (e: any) {
      console.error('[AgenticFinalCheckpointCard] Discard failed:', e);
      setErrorMsg(e.message || 'Failed to discard. Please try again.');
      setStatus('idle');
    }
  };

  if (status === 'confirmed') {
    return (
      <div className="mt-2 bg-green-950/20 border border-green-500/20 rounded-md p-3 flex items-center justify-between">
        <span className="text-[10px] font-mono text-green-400 uppercase tracking-wider">Goal Confirmed — Completing…</span>
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
      </div>
    );
  }

  if (status === 'discarded') {
    return (
      <div className="mt-2 bg-rose-950/20 border border-rose-500/20 rounded-md p-3 flex items-center gap-2">
        <X className="w-3 h-3 text-rose-400" />
        <span className="text-[10px] font-mono text-rose-400 uppercase tracking-wider">Discarded — Attempting Reversal…</span>
      </div>
    );
  }

  const isLoading = status === 'confirming' || status === 'discarding';

  return (
    <div className="mt-2 bg-zinc-950 border border-amber-500/30 rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="px-4 py-3 border-b border-amber-500/10 flex items-center gap-2 bg-amber-950/20">
        <Bot className="w-4 h-4 text-amber-400 shrink-0" />
        <div>
          <p className="text-[10px] font-mono text-amber-300 uppercase tracking-wider">Final Approval Checkpoint</p>
          <p className="text-sm text-gray-300 mt-0.5">The agent believes it has reached your goal. Review actions below.</p>
        </div>
      </div>

      {/* Actions Summary */}
      <div className="p-4 space-y-2">
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-3">
          Actions Taken ({pendingActions.length})
        </p>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {pendingActions.map((action, idx) => (
            <div
              key={idx}
              className="bg-black/40 border border-white/5 rounded-lg overflow-hidden cursor-pointer"
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            >
              <div className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Wrench className="w-3 h-3 text-cyan-500/70 shrink-0" />
                  <span className="text-[11px] font-mono text-cyan-400 truncate">{action.tool}</span>
                  {action.server && <span className="text-[9px] font-mono text-gray-600 bg-white/5 px-1.5 py-0.5 rounded shrink-0">{action.server}</span>}
                </div>
                {expandedIdx === idx ? <ChevronUp className="w-3 h-3 text-gray-600 shrink-0" /> : <ChevronDown className="w-3 h-3 text-gray-600 shrink-0" />}
              </div>
              {expandedIdx === idx && (
                <div className="px-3 pb-2 border-t border-white/5">
                  <pre className="text-[10px] font-mono text-gray-500 overflow-x-auto mt-2 max-h-24 leading-relaxed">
                    {JSON.stringify(action.input, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Best-effort warning re: discarding */}
        <div className="px-3 py-2 bg-rose-950/20 border border-rose-500/20 rounded-lg flex items-start gap-2 mt-3">
          <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-gray-500">
            <strong className="text-rose-300">Discard is best-effort.</strong> Side effects (e.g. written files) may not be fully reversible.
          </p>
        </div>

        {/* Error feedback */}
        {errorMsg && (
          <div className="px-3 py-2 bg-rose-950/30 border border-rose-500/30 rounded-lg flex items-center gap-2 mt-2">
            <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
            <p className="text-[10px] text-rose-300 flex-1">{errorMsg}</p>
            <button onClick={() => setErrorMsg(null)} className="text-rose-500 hover:text-rose-300">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleDiscard}
            disabled={isLoading}
            className="flex-1 px-3 py-2 bg-black border border-rose-500/30 hover:bg-rose-950/20 text-rose-400 hover:text-rose-300 text-[10px] font-bold font-mono uppercase tracking-wider rounded-lg transition-colors disabled:opacity-50"
          >
            {status === 'discarding' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Discard All'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-[10px] font-bold font-mono uppercase tracking-wider rounded-lg transition-all shadow-[0_0_15px_rgba(34,197,94,0.2)] hover:shadow-[0_0_25px_rgba(34,197,94,0.4)]"
          >
            {status === 'confirming' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {status === 'confirming' ? 'Confirming…' : 'Confirm & Commit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({ toolCalls, sessionId, onApprove, onReject }: { toolCalls: string, sessionId?: string | null, onApprove: () => void, onReject: () => void }) {
  console.log('[ApprovalCard] Mounting with toolCalls:', toolCalls);
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [executed, setExecuted] = useState(false);

  const [denyState, setDenyState] = useState<null | 'prompting' | 'sent'>(null);
  const [denyReason, setDenyReason] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);



  let calls: any[] = [];
  try {
    const parsed = typeof toolCalls === 'string' ? JSON.parse(toolCalls) : toolCalls;
    calls = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    if (typeof toolCalls === 'object' && toolCalls !== null) {
      calls = Array.isArray(toolCalls) ? toolCalls : [toolCalls];
    }
  }

  // ── Live Server/Tool Lookup ──────────────────────────────────────────────
  // Fetch the active server list once per minute (staleTime=60s).
  // This lets us resolve bare tool names to live server IDs without guessing.
  const { data: serverList = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: () => apiFetch('/api/servers').then(r => r.json()),
    staleTime: 60_000,
  });

  // For each running server, fetch its tool list (also cached for 60s).
  const runningServers = (serverList as any[]).filter(s => s.status === 'running');
  const serverToolsQueries = useQueries({
    queries: runningServers.map(s => ({
      queryKey: ['server-tools', s.id],
      queryFn: () => apiFetch(`/api/servers/${s.id}/tools`).then(r => r.json()),
      staleTime: 60_000,
    })),
  });

  // Build a map: bareName -> { serverId, serverName }
  const toolResolutionMap = useMemo(() => {
    const map: Record<string, { serverId: string; serverName: string }> = {};
    runningServers.forEach((server, idx) => {
      const tools = serverToolsQueries[idx]?.data as any[] | undefined;
      if (tools) {
        tools.forEach((t: any) => {
          const bare = (t.name as string).includes('__')
            ? (t.name as string).split('__')[1]
            : t.name as string;
          map[bare] = { serverId: server.id, serverName: server.name };
        });
      }
    });
    return map;
  }, [runningServers, serverToolsQueries]);

  // Resolve each call: extract bare name and look it up in the map
  const resolvedCalls = useMemo(() => calls.map(call => {
    const rawName: string = call.name || '';
    const bareName = rawName.includes('__') ? rawName.split('__')[1]
      : rawName.includes(':') ? rawName.split(':')[1]
        : rawName;
    const resolution = toolResolutionMap[bareName];
    return { ...call, bareName, resolution };
  }), [calls, toolResolutionMap]);

  // ── Task 1: Fake-path heuristic ─────────────────────────────────────────────
  // A filesystem tool with a network-resource path (weather, stocks, etc.) is
  // likely a hallucination. Flag it even if the tool resolves correctly.
  const NETWORK_KEYWORDS = /weather|stock|news|api|http|ftp|url|feed|quote|crypto|forex|market/i;
  const FILE_READ_TOOLS = /read_text_file|read_file|read_multiple_files|open_file/i;
  const hasFakePath = resolvedCalls.some(c =>
    FILE_READ_TOOLS.test(c.bareName) &&
    NETWORK_KEYWORDS.test(JSON.stringify(c.arguments || {}))
  );

  const allResolved = resolvedCalls.every(c => !!c.resolution) && !hasFakePath;
  const isDestructive = calls.some((c: any) => c.name?.toLowerCase().match(/delete|remove|drop/));

  const [editedArgs, setEditedArgs] = useState<string[]>(
    calls.map(c => JSON.stringify(c.arguments || {}, null, 2))
  );

  const handleApprove = async () => {
    setJsonError(null);
    let parsedCalls: any[];
    try {
      parsedCalls = resolvedCalls.map((call, i) => {
        const args = JSON.parse(editedArgs[i] || '{}');
        return {
          name: call.bareName,          // always send bare name
          arguments: args,
          id: call.id,
          // ── Task 3: Inject resolved server ID ──────────────────────────
          // Tells the backend exactly which live server to use — no guessing.
          ...(call.resolution ? { resolvedServerId: call.resolution.serverId } : {}),
        };
      });
    } catch (e) {
      setJsonError((e as Error).message);
      return;
    }

    setLoading(true);
    window.dispatchEvent(new CustomEvent('openmacaw:executing', { detail: { action: 'START', calls: parsedCalls } }));
    try {
      await apiFetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCalls: parsedCalls, user_approved: true, sessionId })
      });
      setExecuted(true);
      window.dispatchEvent(new CustomEvent('openmacaw:executing', { detail: { action: 'SUCCESS', calls: parsedCalls } }));
      setTimeout(() => onApprove(), 1500);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('openmacaw:executing', { detail: { action: 'FAILED', calls: parsedCalls, error: String(e) } }));
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ── Task 2: Denial reason flow ────────────────────────────────────────────
  // Step 1: clicking Deny shows the reason input inline.
  // Step 2: submitting sends the reason to /api/deny (reason can be empty).
  const handleDenyClick = () => setDenyState('prompting');

  const handleDenySubmit = async (reason: string) => {
    setDenyState('sent');
    const toolName = resolvedCalls[0]?.bareName || calls[0]?.name || 'unknown';
    try {
      await apiFetch('/api/deny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, toolName, reason: reason.trim() || undefined })
      });
    } catch (e) {
      console.error('[Deny] Error:', e);
    }
    // Notify if the app is running in the background when the denial fires.
    notifyToolDeniedAsync(toolName, reason.trim() || undefined).catch(() => { /* best-effort */ });
    onReject();
  };

  // ── Task 3: Collapsible denied card ─────────────────────────────────────────
  if (denyState === 'prompting') {
    return (
      <div className="mt-3 bg-rose-950/20 border border-rose-500/20 rounded-md overflow-hidden">
        <div className="px-3 py-2 border-b border-rose-500/10 flex items-center gap-2">
          <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
          <span className="text-[10px] font-mono text-rose-400 uppercase tracking-wider">Reason for denial (optional)</span>
        </div>
        <div className="p-3 flex gap-2">
          <input
            autoFocus
            type="text"
            value={denyReason}
            onChange={e => setDenyReason(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleDenySubmit(denyReason); if (e.key === 'Escape') setDenyState(null); }}
            placeholder="e.g. wrong tool, hallucinated path..."
            className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-[11px] font-mono text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-rose-500/40"
          />
          <button
            onClick={() => setDenyState(null)}
            className="px-2 py-1.5 bg-black border border-white/10 hover:bg-white/5 text-gray-400 text-[10px] font-mono rounded transition-colors"
          >Cancel</button>
          <button
            onClick={() => handleDenySubmit(denyReason)}
            className="px-2 py-1.5 bg-rose-950/50 border border-rose-500/40 hover:bg-rose-900/50 text-rose-400 text-[10px] font-mono font-bold rounded transition-colors"
          >Confirm Deny</button>
        </div>
      </div>
    );
  }

  if (denyState === 'sent') {
    // Collapsed by default — click to expand with the denial reason
    return (
      <DeniedCollapsible reason={denyReason} />
    );
  }

  if (executed) {
    return (
      <div className="mt-3 bg-green-950/20 border border-green-500/20 rounded-md p-3 flex items-center justify-between">
        <span className="text-[10px] font-mono text-green-500 uppercase tracking-wider">Executed Successfully</span>
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
      </div>
    );
  }

  return (
    <div className="mt-3 bg-zinc-950 border border-white/10 rounded-md overflow-hidden shadow-2xl backdrop-blur-md">
      {isDestructive && (
        <div className="bg-rose-500/10 border-b border-rose-500/20 px-3 py-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
          <span className="text-[10px] font-mono text-rose-500 uppercase tracking-wider font-bold">Warning: Destructive Action</span>
        </div>
      )}
      {/* ── Live resolution badge ─────────────────────────────────────── */}
      {allResolved ? (
        <div className="bg-emerald-950/30 border-b border-emerald-500/20 px-3 py-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.8)] shrink-0" />
          <span className="text-[10px] font-mono text-emerald-400 tracking-wider">
            Via: {resolvedCalls.map(c => c.resolution?.serverName).filter(Boolean).join(', ')} (Connected)
          </span>
        </div>
      ) : (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
          <span className="text-[10px] font-mono text-amber-400 tracking-wider">Warning: Tool could not be matched to a connected MCP server. Execution may fail.</span>
        </div>
      )}
      <div className="p-3">
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2">
          Proposed Actions {resolvedCalls.length > 1 && <span className="text-cyan-400 font-bold ml-1">({resolvedCalls.length})</span>}
          <span className="text-gray-600 ml-1">(editable)</span>
        </p>
        <div className="space-y-2 mb-3">
          {resolvedCalls.map((call, i) => (
            <div key={i} className="bg-black border border-white/5 rounded overflow-hidden">
              <div className="px-2 py-1.5 border-b border-white/5 flex items-center justify-between">
                <span className="text-cyan-400 font-mono text-xs">{call.bareName}</span>
                {call.resolution
                  ? <span className="text-[9px] font-mono text-emerald-500">{call.resolution.serverName}</span>
                  : <span className="text-[9px] font-mono text-amber-500">Unresolved</span>
                }
              </div>
              <textarea
                value={editedArgs[i] || ''}
                onChange={(e) => {
                  const next = [...editedArgs];
                  next[i] = e.target.value;
                  setEditedArgs(next);
                  setJsonError(null);
                }}
                className="w-full px-2 py-2 bg-black text-cyan-300 font-mono text-[11px] resize-none focus:outline-none focus:ring-1 focus:ring-cyan-500/30 border-0 min-h-[60px]"
                rows={Math.min(8, (editedArgs[i] || '').split('\n').length + 1)}
                spellCheck={false}
              />
            </div>
          ))}
        </div>
        {jsonError && (
          <div className="mb-2 px-2 py-1.5 bg-rose-950/30 border border-rose-500/20 rounded flex items-center gap-2">
            <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
            <span className="text-[10px] font-mono text-rose-400">{jsonError}</span>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={handleDenyClick} disabled={loading} className="flex-1 px-3 py-1.5 bg-black border border-white/10 hover:bg-white/5 text-gray-400 hover:text-white text-[10px] font-bold font-mono uppercase tracking-wider rounded transition-colors disabled:opacity-50">
            Deny
          </button>
          <button onClick={handleApprove} disabled={loading} className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 bg-cyan-950/30 border border-cyan-500/50 hover:bg-cyan-900/40 text-cyan-400 hover:text-cyan-300 text-[10px] font-bold font-mono uppercase tracking-wider rounded transition-all shadow-[0_0_15px_rgba(6,182,212,0.15)] hover:shadow-[0_0_20px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:shadow-none animate-pulse hover:animate-none">
            {loading && <Loader2 className="w-3 h-3 animate-spin inline" />}
            {loading ? 'Executing...' : 'Approve & Execute'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Agentic Progress Card ──────────────────────────────────────────────────────────────
// Live checklist shown while the agent is running — steps check off in real-time.
function AgenticProgressCard({ goal, plan, stepProgress, currentTool, runStatus }: {
  goal: string;
  plan: { id: string; description: string; tool?: string }[];
  stepProgress: Record<number, 'running' | 'done' | 'error'>;
  currentTool?: string;
  runStatus: 'running' | 'done' | 'cancelled';
}) {
  const doneCount = Object.values(stepProgress).filter(s => s === 'done').length;
  const hasError = Object.values(stepProgress).some(s => s === 'error');

  return (
    <div className="mt-2 bg-zinc-950 border border-violet-500/20 rounded-xl overflow-hidden shadow-xl">
      {/* Header */}
      <div className="px-4 py-3 border-b border-violet-500/10 flex items-center gap-2.5 bg-violet-950/20">
        {runStatus === 'running' && <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse shrink-0" />}
        {runStatus === 'done' && <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />}
        {runStatus === 'cancelled' && <X className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-wider"
            style={{ color: runStatus === 'done' ? '#4ade80' : runStatus === 'cancelled' ? '#f87171' : '#a78bfa' }}>
            {runStatus === 'running' ? 'Agent Running' : runStatus === 'done' ? 'Agent Complete' : 'Agent Cancelled'}
          </p>
          <p className="text-sm text-gray-200 mt-0.5 font-medium truncate">{goal}</p>
        </div>
        <span className="text-[10px] font-mono text-gray-500 shrink-0">
          {doneCount}/{plan.length}{hasError ? ' ⚠' : ''}
        </span>
      </div>

      {/* Checklist */}
      <div className="p-3 space-y-1">
        {plan.map((step, idx) => {
          const st = stepProgress[idx];
          return (
            <div
              key={step.id}
              className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border transition-all duration-300 ${st === 'running' ? 'bg-violet-950/20 border-violet-500/30' :
                st === 'done' ? 'bg-black/10 border-transparent opacity-60' :
                  st === 'error' ? 'bg-rose-950/10 border-rose-500/20' :
                    'bg-black/20 border-transparent'
                }`}
            >
              {/* Status icon */}
              <span className="shrink-0 mt-0.5 w-3.5 flex justify-center">
                {st === 'running' && <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />}
                {st === 'done' && <Check className="w-3 h-3 text-green-400" />}
                {st === 'error' && <X className="w-3 h-3 text-rose-400" />}
                {!st && <span className="w-3 h-3 rounded-full border border-gray-600/50 inline-block" />}
              </span>

              {/* Step text */}
              <div className="flex-1 min-w-0">
                <p className={`text-[12px] leading-relaxed ${st === 'done' ? 'text-gray-600 line-through' :
                  st === 'running' ? 'text-gray-200' : 'text-gray-400'
                  }`}>
                  {step.description}
                </p>
                {st === 'running' && (currentTool || step.tool) && (
                  <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 bg-violet-950/40 border border-violet-500/20 rounded text-[9px] font-mono text-violet-400">
                    <span className="w-1 h-1 rounded-full bg-violet-400 animate-ping" />
                    {currentTool || step.tool}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: string;
  toolResults?: string;
  toolCallId?: string;
  // ── State machine ──────────────────────────────────────────────────────────────
  // pending   = proposal awaiting human decision (show editable ApprovalCard)
  // approved  = approved, execution in progress (show success card)
  // executed  = tool ran successfully (show success card)
  // denied    = user denied (show collapsed denied card)
  status?: 'pending' | 'approved' | 'executed' | 'denied' | 'agentic_plan' | 'agentic_running' | 'agentic_done' | 'agentic_cancelled' | string;
  // ── Agentic run metadata ──────────────────────────────────────────────────────
  parentId?: string;
  agenticRunId?: string;
  agenticPlan?: { id: string; description: string; tool?: string; server?: string }[];
  agenticGoal?: string;
}

interface Session {
  id: string;
  title: string;
  model: string;
  mode: 'build' | 'plan';
  messages: Message[];
}

// ── Tool Call Summary Types & Utilities ──────────────────────────────────────

type ToolCallSummaryItem = {
  tool: string;
  server: string;
  input: Record<string, unknown>;
};

/**
 * Scans backwards from `msgIndex` in the full message list to collect every
 * tool call that was made in the same agent turn as this response. Stops at
 * the first `user` message it encounters (which marks the turn boundary).
 */
function getToolsUsedBeforeMessage(allMsgs: { role: string; toolCalls?: string }[], msgIndex: number): ToolCallSummaryItem[] {
  const tools: ToolCallSummaryItem[] = [];
  for (let i = msgIndex - 1; i >= 0; i--) {
    const m = allMsgs[i];
    if (m.role === 'user') break;
    if (m.role === 'assistant' && m.toolCalls) {
      try {
        const parsed = JSON.parse(m.toolCalls);
        const calls: any[] = Array.isArray(parsed) ? parsed : [parsed];
        for (const call of [...calls].reverse()) {
          const rawName: string = call.name || '';
          const tool = rawName.includes('__') ? rawName.split('__')[1] : rawName;
          const server = rawName.includes('__') ? rawName.split('__')[0] : (call.server || '');
          tools.unshift({ tool, server, input: call.arguments || {} });
        }
      } catch { /* malformed toolCalls JSON — skip */ }
    }
  }
  return tools;
}

// ── Tools Used Header ─────────────────────────────────────────────────────────
// Shown at the top of any assistant response that involved tool calls.
// Collapsed by default; click to expand and inspect each call's input.
function ToolsUsedHeader({ tools }: { tools: ToolCallSummaryItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (tools.length === 0) return null;
  return (
    <div className="mb-3">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-900 border border-white/10 rounded-md hover:border-cyan-500/30 hover:bg-zinc-800 transition-all group w-full text-left"
      >
        <Wrench className="w-3 h-3 text-cyan-500/70 shrink-0" />
        <span className="text-[11px] font-mono text-gray-400 group-hover:text-gray-300 flex-1">
          {tools.length} tool{tools.length !== 1 ? 's' : ''} used
        </span>
        {expanded
          ? <ChevronUp className="w-3 h-3 text-gray-600" />
          : <ChevronDown className="w-3 h-3 text-gray-600" />
        }
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 pl-1">
          {tools.map((t, i) => (
            <div key={i} className="bg-zinc-950 border border-white/5 rounded-md overflow-hidden">
              <div className="px-2.5 py-1.5 flex items-center gap-2 border-b border-white/5">
                <span className="text-cyan-400 font-mono text-xs font-medium">{t.tool}</span>
                {t.server && (
                  <span className="text-[9px] font-mono text-gray-600 bg-white/5 px-1.5 py-0.5 rounded">{t.server}</span>
                )}
              </div>
              {Object.keys(t.input).length > 0 && (
                <pre className="px-2.5 py-2 text-[10px] font-mono text-gray-500 overflow-x-auto max-h-40 leading-relaxed">
                  {JSON.stringify(t.input, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VersionSwitcher({ current, total, onPrev, onNext }: { current: number; total: number; onPrev: () => void; onNext: () => void }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-[10px] font-mono text-gray-500">
      <button
        onClick={(e) => { e.stopPropagation(); onPrev(); }}
        disabled={current === 1}
        className="hover:text-cyan-400 disabled:opacity-30 disabled:hover:text-gray-500 transition-colors"
      >
        <ChevronLeft className="w-3 h-3" />
      </button>
      <span className="min-w-[24px] text-center font-bold tracking-tight text-gray-400">
        {current} <span className="text-gray-600">/</span> {total}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onNext(); }}
        disabled={current === total}
        className="hover:text-cyan-400 disabled:opacity-30 disabled:hover:text-gray-500 transition-colors"
      >
        <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Tool Activity Pill ────────────────────────────────────────────────────────
// Shown inline while the agent is executing a tool call. Fades in with a subtle
// pulse so users know the AI is accessing a local capability.
function ToolActivityPill({ tool, server }: { tool: string; server: string }) {
  return (
    <div className="flex items-center gap-2 mt-2 px-3 py-1.5 bg-cyan-950/30 border border-cyan-500/20 rounded-full w-fit text-[11px] font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse shrink-0" />
      <span className="text-gray-500">{server}</span>
      <span className="text-gray-700">·</span>
      <span className="text-cyan-400">{tool}</span>
    </div>
  );
}

// ── Chat State Reducer ────────────────────────────────────────────────────────
type ChatState = {
  isStreaming: boolean;
  streamingContent: string;
  chatError: { code: string; message: string } | null;
  selectedServerId: string | null;
  showGuardianOverlay: boolean;

  /** Set while an MCP tool call is in-flight; null when idle. */
  activeToolCall: { tool: string; server: string } | null;
  /** Human-readable label for the current pre-LLM pipeline stage (null when idle). */
  activeStage: string | null;
  /** Accumulates all tool calls made during the current streaming turn. */
  streamingToolCalls: ToolCallSummaryItem[];
};

type ChatAction =
  | { type: 'START_STREAM' }
  | { type: 'APPEND_STREAM'; content: string }
  | { type: 'SET_ERROR'; code?: string; message: string }
  | { type: 'END_STREAM' }
  | { type: 'RESET_STREAM' }
  | { type: 'SET_SERVER'; id: string | null }
  | { type: 'TOGGLE_GUARDIAN' }

  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_TOOL_CALL'; tool: string; server: string }
  | { type: 'CLEAR_TOOL_CALL' }
  | { type: 'SET_STAGE'; label: string }
  | { type: 'CLEAR_STAGE' }
  | { type: 'ADD_STREAMING_TOOL'; tool: string; server: string; input: Record<string, unknown> };

const initialChatState: ChatState = {
  isStreaming: false,
  streamingContent: '',
  chatError: null,
  selectedServerId: null,
  showGuardianOverlay: false,

  activeToolCall: null,
  activeStage: null,
  streamingToolCalls: [],
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'START_STREAM':
      return { ...state, isStreaming: true, streamingContent: '', chatError: null, activeToolCall: null, activeStage: null, streamingToolCalls: [] };
    case 'APPEND_STREAM':
      // First text delta clears any pre-LLM stage indicator.
      return { ...state, streamingContent: state.streamingContent + action.content, activeStage: null };
    case 'SET_ERROR':
      return { ...state, isStreaming: false, activeToolCall: null, activeStage: null, streamingToolCalls: [], chatError: { code: action.code || 'UNKNOWN', message: action.message } };
    case 'END_STREAM':
      return { ...state, isStreaming: false, streamingContent: '', activeToolCall: null, activeStage: null, streamingToolCalls: [] };
    case 'RESET_STREAM':
      return { ...state, isStreaming: false, streamingContent: '', chatError: null, activeToolCall: null, activeStage: null, streamingToolCalls: [] };
    case 'SET_SERVER':
      return { ...state, selectedServerId: action.id };
    case 'TOGGLE_GUARDIAN':
      return { ...state, showGuardianOverlay: !state.showGuardianOverlay };

    case 'CLEAR_ERROR':
      return { ...state, chatError: null };
    case 'SET_TOOL_CALL':
      // A real tool call starts — clear the stage indicator (tool pill takes over).
      return { ...state, activeToolCall: { tool: action.tool, server: action.server }, activeStage: null };
    case 'CLEAR_TOOL_CALL':
      return { ...state, activeToolCall: null };
    case 'ADD_STREAMING_TOOL':
      return {
        ...state,
        streamingToolCalls: [
          ...state.streamingToolCalls,
          { tool: action.tool, server: action.server, input: action.input },
        ],
      };
    case 'SET_STAGE':
      return { ...state, activeStage: action.label };
    case 'CLEAR_STAGE':
      return { ...state, activeStage: null };
    default:
      return state;
  }
}

export default function Chat() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(sessionId || null);
  const [input, setInput] = useState('');
  const [state, dispatch] = useReducer(chatReducer, initialChatState);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamStartRef = useRef<number>(0);
  const streamingStartedRef = useRef(false);
  const queryClient = useQueryClient();

  const { isStreaming, streamingContent, chatError, selectedServerId, showGuardianOverlay, activeToolCall, activeStage, streamingToolCalls } = state;


  const { data: sessions, isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await apiFetch('/api/sessions');
      return res.json();
    },
  });

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('openmacaw:streaming', { detail: isStreaming }));
  }, [isStreaming]);

  const { data: currentSession, isLoading: sessionLoading } = useQuery<Session>({
    queryKey: ['session', currentSessionId],
    queryFn: async () => {
      const res = await apiFetch(`/api/sessions/${currentSessionId}`);
      return res.json();
    },
    enabled: !!currentSessionId,
  });

  // Broadcast session info to the Inspector whenever the session changes
  useEffect(() => {
    if (currentSession) {
      window.dispatchEvent(new CustomEvent('openmacaw:session_info', {
        detail: {
          model: currentSession.model,
          sessionId: currentSessionId,
        }
      }));
    }
  }, [currentSession, currentSessionId]);

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setCurrentSessionId(data.id);
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      // Fix ghost chat: clear session if deleting the active one
      if (currentSessionId === deletedId) {
        setCurrentSessionId(null);
        dispatch({ type: 'RESET_STREAM' });
        queryClient.removeQueries({ queryKey: ['session', deletedId] });
      }
    },
  });

  useEffect(() => {
    if (sessions?.length && !currentSessionId) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [sessions, currentSessionId]);

  // ── Sync URL param → state so sidebar <Link> navigation switches sessions ──
  // useState(sessionId) only reads the param once at mount. When React Router
  // updates the URL (e.g. /chat/other-id), useParams() returns the new id but
  // currentSessionId state stays stale. This effect keeps them in sync.
  useEffect(() => {
    if (sessionId && sessionId !== currentSessionId) {
      setCurrentSessionId(sessionId);
    }
  }, [sessionId]);

  // RESET state when switching sessions to prevent "ghost text"
  useEffect(() => {
    dispatch({ type: 'RESET_STREAM' });
    setInput('');
  }, [currentSessionId]);

  // ── Stable agentic step-progress store ────────────────────────────────────
  // Stored in a ref so query cache re-fetches cannot wipe it mid-run.
  // A parallel counter state triggers re-renders when the ref changes.
  const agenticProgressRef = useRef<{
    runId: string;
    stepProgress: Record<number, 'running' | 'done' | 'error'>;
    currentTool: string | undefined;
    // Cached plan metadata so the overlay renders immediately even before the
    // session re-fetch completes. Populated from the query cache at run start.
    goal: string;
    plan: { id: string; description: string; tool?: string }[];
  } | null>(null);
  const [agenticProgressTick, setAgenticProgressTick] = useState(0);
  const bumpProgress = useCallback(() => setAgenticProgressTick(t => t + 1), []);

  // ── Stable checkpoint state ────────────────────────────────────────────────
  // Completely independent of the query cache — never wiped by a re-fetch.
  // Set when agentic_final_checkpoint fires, cleared when agentic_done/cancelled.
  const [activeCheckpoint, setActiveCheckpoint] = useState<{
    runId: string;
    pendingActions: { tool: string; server: string; input: Record<string, unknown>; result?: unknown; executedAt: string }[];
  } | null>(null);

  // Listen for new-chat events dispatched from the App sidebar
  useEffect(() => {
    const handler = () => createSessionMutation.mutate();
    window.addEventListener('openmacaw:new-chat', handler);
    return () => window.removeEventListener('openmacaw:new-chat', handler);
  }, [createSessionMutation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages, streamingContent]);

  const connectWebSocket = useCallback(() => {
    const ws = new WebSocket(getWsUrl('/ws/chat'));

    ws.onopen = () => {
      console.log('WebSocket connected');
      if (currentSessionId) {
        ws.send(JSON.stringify({ type: 'join', sessionId: currentSessionId }));
        // Invalidate the session cache on every (re)connect so that any messages
        // persisted while the socket was disconnected (e.g. message_end lost in
        // transit) are fetched immediately without waiting for the next user action.
        queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
      }
    };

    ws.onmessage = (event) => {
      const data: AgentEvent = JSON.parse(event.data);

      switch (data.type) {
        case 'text_delta':
          if (!streamingStartedRef.current) {
            streamingStartedRef.current = true;
            dispatch({ type: 'START_STREAM' });
            window.dispatchEvent(new CustomEvent('openmacaw:inspector', {
              detail: { type: 'stream_start', tool: 'LLM', input: { event: 'Streaming response started' } }
            }));
          }
          dispatch({ type: 'APPEND_STREAM', content: data.content || '' });
          break;
        case 'tool_call_start': {
          if (!streamingStartedRef.current) {
            streamingStartedRef.current = true;
            dispatch({ type: 'START_STREAM' });
          }
          window.dispatchEvent(new CustomEvent('openmacaw:inspector', {
            detail: { type: 'tool_call', tool: data.tool || 'unknown', input: { event: 'Tool call initiated' } }
          }));
          const rawTool = data.tool || 'unknown';
          const bareToolName = rawTool.includes('__') ? rawTool.split('__')[1] : rawTool;
          const toolServer = data.server || '';
          // Show the animated in-flight pill.
          dispatch({ type: 'SET_TOOL_CALL', tool: rawTool, server: toolServer });
          // Accumulate into the per-turn summary that shows after the response.
          dispatch({ type: 'ADD_STREAMING_TOOL', tool: bareToolName, server: toolServer, input: data.input || {} });
          break;
        }
        case 'tool_call_result':
          // Clear the activity pill — the agent is back to text generation.
          dispatch({ type: 'CLEAR_TOOL_CALL' });
          break;
        case 'message_end': {
          const responseTimeMs = streamStartRef.current > 0 ? Date.now() - streamStartRef.current : 0;

          dispatch({ type: 'END_STREAM' });
          streamStartRef.current = 0;
          streamingStartedRef.current = false;
          window.dispatchEvent(new CustomEvent('openmacaw:telemetry', {
            detail: {
              inputTokens: (data as any).usage?.inputTokens || 0,
              outputTokens: (data as any).usage?.outputTokens || 0,
              responseTimeMs,
            }
          }));
          queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
          // Notify the user if the app is backgrounded / screen is off.
          notifyAgentDoneAsync().catch(() => { /* swallow — notifications are best-effort */ });
          break;
        }
        case 'proposal': {
          console.log('[WS] Received PROPOSAL event:', data);
          dispatch({ type: 'END_STREAM' });
          streamingStartedRef.current = false;

          const newProposalMsg = {
            id: data.id || `proposal-${Date.now()}`,
            role: 'assistant' as const,
            content: `I propose executing ${data.tool}. Please authorize the action.`,
            toolCallId: data.id,
            toolCalls: JSON.stringify([{ id: data.id, name: data.tool, arguments: data.input }])
          };

          queryClient.setQueryData(['session', currentSessionId], (old: any) => {
            if (!old) return old;
            const alreadyExists = (old.messages || []).some((m: any) => m.id === newProposalMsg.id);
            if (alreadyExists) return old;
            return {
              ...old,
              messages: [...(old.messages || []).map((m: any) => ({ ...m })), newProposalMsg]
            };
          });

          window.dispatchEvent(new CustomEvent('openmacaw:inspector', {
            detail: { type: 'proposal', tool: data.tool, input: data.input, id: data.id }
          }));
          break;
        }

        case 'batch_proposal': {
          const batchData = data as any;
          console.log('[WS] Received BATCH_PROPOSAL event:', batchData);
          dispatch({ type: 'END_STREAM' });
          streamingStartedRef.current = false;

          const toolCalls = batchData.toolCalls || [];
          const toolList = toolCalls.map((t: any) => t.tool).join(', ');

          const newProposalMsg = {
            id: batchData.id || `batch-proposal-${Date.now()}`,
            role: 'assistant' as const,
            content: `I propose executing ${toolCalls.length} tool(s): ${toolList}. Please authorize all at once.`,
            toolCallId: batchData.id,
            toolCalls: JSON.stringify(toolCalls.map((t: any, idx: number) => ({
              id: `batch-call-${idx}`,
              name: t.tool,
              arguments: t.input,
              resolvedServerId: t.server,
            })))
          };

          queryClient.setQueryData(['session', currentSessionId], (old: any) => {
            if (!old) return old;
            const alreadyExists = (old.messages || []).some((m: any) => m.id === newProposalMsg.id);
            if (alreadyExists) return old;
            return {
              ...old,
              messages: [...(old.messages || []).map((m: any) => ({ ...m })), newProposalMsg]
            };
          });

          window.dispatchEvent(new CustomEvent('openmacaw:inspector', {
            detail: { type: 'batch_proposal', toolCalls: batchData.toolCalls, id: batchData.id }
          }));
          break;
        }

        case 'pipeline_stage': {
          // Map internal stage IDs to user-facing labels.
          const stageLabels: Record<string, string> = {
            fetching_tools: 'Checking available tools…',
            generating: 'Thinking…',
          };
          const label = stageLabels[data.stage] ?? data.stage;
          if (!streamingStartedRef.current) {
            // Only show pre-flight stages before text has started streaming.
            dispatch({ type: 'SET_STAGE', label });
          }
          break;
        }

        case 'error':
          console.log('[WS] Received Error Event:', data);
          dispatch({ type: 'SET_ERROR', code: data.code, message: data.message });
          break;

        // ── Agentic Run events ──────────────────────────────────────────────
        case 'agentic_plan_proposed': {
          // The plan is now saved as a real DB message. Just invalidate so the
          // session re-fetches and the DB message appears naturally in the list.
          dispatch({ type: 'END_STREAM' });
          streamingStartedRef.current = false;
          queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
          break;
        }

        case 'agentic_running': {
          const runningData = data as any;
          const existing = agenticProgressRef.current;
          const isPhase2 = existing?.runId === runningData.runId;

          // For phase 2 (same runId continuing after checkpoint confirm): keep the
          // existing step progress so the checklist shows completed phase-1 steps
          // while phase-2 steps start ticking.  For a fresh run: reset everything.
          let goal = isPhase2 ? existing!.goal : '';
          let plan = isPhase2 ? existing!.plan : ([] as { id: string; description: string; tool?: string }[]);

          if (!isPhase2) {
            // Pull plan/goal from the query cache so the overlay renders immediately,
            // even before the session re-fetch triggered by approve-plan completes.
            const cachedSession = queryClient.getQueryData<any>(['session', currentSessionId]);
            if (cachedSession) {
              const planMsg = (cachedSession.messages || []).find(
                (m: any) => m.status?.startsWith('agentic_') && (() => {
                  try { return JSON.parse(m.content)?.runId === runningData.runId; } catch { return false; }
                })()
              );
              if (planMsg) {
                try {
                  const meta = JSON.parse(planMsg.content);
                  goal = meta.goal || '';
                  plan = meta.plan || [];
                } catch { /* use empty defaults */ }
              }
            }
          }

          agenticProgressRef.current = {
            runId: runningData.runId,
            // Phase 2: preserve phase-1 step progress. Fresh run: start empty.
            stepProgress: isPhase2 ? existing!.stepProgress : {},
            currentTool: isPhase2 ? existing!.currentTool : undefined,
            goal,
            plan,
          };
          bumpProgress();
          // Bridge pipeline state to Inspector
          window.dispatchEvent(new CustomEvent('openmacaw:pipeline', {
            detail: { status: 'running', ...agenticProgressRef.current }
          }));
          // Also update DB message status in the query cache so the thread pill renders.
          queryClient.setQueryData(['session', currentSessionId], (old: any) => {
            if (!old) return old;
            return {
              ...old,
              messages: (old.messages || []).map((m: any) => {
                if (!m.status?.startsWith('agentic_')) return m;
                try {
                  const meta = JSON.parse(m.content);
                  if (meta.runId !== runningData.runId) return m;
                  return { ...m, status: 'agentic_running' };
                } catch { return m; }
              }),
            };
          });
          break;
        }

        case 'agentic_step_progress': {
          const spData = data as any;
          // Write directly into the stable ref — never touches the query cache.
          const cur = agenticProgressRef.current;
          if (cur && cur.runId === spData.runId) {
            agenticProgressRef.current = {
              runId: cur.runId,
              stepProgress: {
                ...cur.stepProgress,
                ...(spData.stepIndex >= 0 ? { [spData.stepIndex]: spData.status } : {}),
              },
              currentTool: spData.status === 'running' && spData.tool
                ? spData.tool
                : cur.currentTool,
              goal: cur.goal,
              plan: cur.plan,
            };
            bumpProgress();
            // Bridge step progress to Inspector
            window.dispatchEvent(new CustomEvent('openmacaw:pipeline', {
              detail: { status: 'running', ...agenticProgressRef.current }
            }));
          }
          break;
        }


        case 'agentic_final_checkpoint': {
          const cpData = data as any;
          // Store checkpoint in stable state — completely independent of query cache.
          setActiveCheckpoint({
            runId: cpData.runId,
            pendingActions: cpData.pendingActions ?? [],
          });
          break;
        }

        case 'agentic_done': {
          const doneData = data as any;
          // Bridge done state to Inspector BEFORE clearing progress
          if (agenticProgressRef.current?.runId === doneData.runId) {
            window.dispatchEvent(new CustomEvent('openmacaw:pipeline', {
              detail: { status: 'done', ...agenticProgressRef.current }
            }));
          }
          // Clear the live progress overlay (checklist). The checkpoint card
          // clears itself after the user acts — don't touch it here.
          if (agenticProgressRef.current?.runId === doneData.runId) {
            agenticProgressRef.current = null;
            bumpProgress();
          }
          queryClient.setQueryData(['session', currentSessionId], (old: any) => {
            if (!old) return old;
            return {
              ...old,
              messages: (old.messages || []).map((m: any) => {
                if (!m.status?.startsWith('agentic_')) return m;
                try {
                  const meta = JSON.parse(m.content);
                  if (meta.runId !== doneData.runId) return m;
                  return { ...m, status: 'agentic_done' };
                } catch { return m; }
              }),
            };
          });
          // Invalidate so any new messages the server wrote (e.g. the summary
          // assistant message) are fetched. setQueryData alone only updates the
          // plan message status — it cannot surface new rows from the DB.
          queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
          break;
        }

        case 'agentic_cancelled': {
          const cancelData = data as any;
          // Bridge cancelled state to Inspector BEFORE clearing
          if (agenticProgressRef.current?.runId === cancelData.runId) {
            window.dispatchEvent(new CustomEvent('openmacaw:pipeline', {
              detail: { status: 'cancelled', ...agenticProgressRef.current }
            }));
          }
          // Clear the live progress overlay (checklist).
          if (agenticProgressRef.current?.runId === cancelData.runId) {
            agenticProgressRef.current = null;
            bumpProgress();
          }
          // Also clear checkpoint if the run was cancelled without user confirmation
          // (e.g. plan denied, or error mid-run — not from the checkpoint card itself).
          setActiveCheckpoint(prev => prev?.runId === cancelData.runId ? null : prev);
          queryClient.setQueryData(['session', currentSessionId], (old: any) => {
            if (!old) return old;
            return {
              ...old,
              messages: (old.messages || []).map((m: any) => {
                if (!m.status?.startsWith('agentic_')) return m;
                try {
                  const meta = JSON.parse(m.content);
                  if (meta.runId !== cancelData.runId) return m;
                  return { ...m, status: 'agentic_cancelled' };
                } catch { return m; }
              }),
            };
          });
          break;
        }

        case 'session_renamed': {
          const renamed = data as { sessionId: string; newTitle: string };
          queryClient.setQueryData(['sessions'], (old: any) => {
            if (!Array.isArray(old)) return old;
            return old.map((s: any) =>
              s.id === renamed.sessionId ? { ...s, title: renamed.newTitle } : s
            );
          });
          // Also update the individual session cache
          queryClient.setQueryData(['session', renamed.sessionId], (old: any) => {
            if (!old) return old;
            return { ...old, title: renamed.newTitle };
          });
          break;
        }
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      dispatch({ type: 'END_STREAM' });
    };

    ws.onclose = (ev) => {
      console.log(`WebSocket closed — code=${ev.code} reason="${ev.reason}"`);
      dispatch({ type: 'END_STREAM' });
    };

    wsRef.current = ws;
    return ws;
  }, [currentSessionId, queryClient]);

  useEffect(() => {
    if (!currentSessionId) return;

    const ws = connectWebSocket();
    wsRef.current = ws;

    return () => {
      ws.close();
      // Don't null the ref — an in-flight waitForSocketRef poll would stall.
      // The next effect body (or handleSend) will overwrite it with a fresh socket.
    };
  }, [currentSessionId, connectWebSocket]);

  // ── Reconnect WebSocket + refresh when PWA is foregrounded ─────────────────
  // On Android the OS closes the WebSocket when the app is backgrounded.
  // Listen for visibilitychange so we reconnect and pull fresh data as soon as
  // the user switches back to the app.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || !currentSessionId) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        const newWs = connectWebSocket();
        wsRef.current = newWs;
      }
      queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [currentSessionId, connectWebSocket, queryClient]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    dispatch({ type: 'CLEAR_ERROR' });

    const msg = input.trim();
    setInput('');
    dispatch({ type: 'START_STREAM' });
    streamStartRef.current = Date.now();

    try {
      // Auto-create a session if none exists
      let sid = currentSessionId;
      if (!sid) {
        const newSession = await createSessionMutation.mutateAsync();
        sid = newSession.id;
      }

      // ── Optimistic Update ──────────────────────────────────────────────────
      // Inject the user message into the cache immediately so it appears instantly.
      const tempId = `temp-${Date.now()}`;
      queryClient.setQueryData(['session', sid], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          messages: [...(old.messages || []), { id: tempId, role: 'user', content: msg }]
        };
      });

      // Ensure a socket exists before polling. The useEffect may not have fired
      // yet (e.g. session was just created and React hasn't re-rendered). If the
      // effect later replaces this socket, waitForSocketRef picks up the new one.
      if (!wsRef.current || wsRef.current.readyState >= WebSocket.CLOSING) {
        wsRef.current = connectWebSocket();
      }
      const openWs = await waitForSocketRef(wsRef, connectWebSocket);
      openWs.send(JSON.stringify({ type: 'chat', sessionId: sid, message: msg }));
    } catch (e: any) {
      console.error('[sendMessage] Failed:', e);
      dispatch({ type: 'SET_ERROR', message: e.message || 'Failed to send message' });
    }
  }, [input, isStreaming, currentSessionId, queryClient, connectWebSocket]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
 
  const handleRegenerate = async (messageId: string) => {
    if (!currentSessionId || isStreaming) return;
 
    // Find the message being regenerated and the last user message before it
    const msgs = currentSession?.messages || [];
    const idx = msgs.findIndex(m => m.id === messageId);
    if (idx === -1) return;
 
    // Find the nearest preceding user message
    let lastUserPrompt = '';
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserPrompt = msgs[i].content;
        break;
      }
    }
 
    if (!lastUserPrompt) return;
 
    try {
      // 1. Delete the assistant message
      await apiFetch(`/api/sessions/${currentSessionId}/messages/${messageId}`, { method: 'DELETE' });
      
      // 2. Invalidate to clear local UI message list
      queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
      
      // 3. Trigger regeneration via special WebSocket signal
      dispatch({ type: 'START_STREAM' });
      streamStartRef.current = Date.now();

      if (!wsRef.current || wsRef.current.readyState >= WebSocket.CLOSING) {
        wsRef.current = connectWebSocket();
      }
      const openWs = await waitForSocketRef(wsRef, connectWebSocket);
      openWs.send(JSON.stringify({
        type: 'regenerate',
        sessionId: currentSessionId
      }));
    } catch (e) {
      console.error('[Regenerate] Failed:', e);
      dispatch({ type: 'RESET_STREAM' });
    }
  };

  const handleSwitchVersion = async (messageId: string) => {
    try {
      await apiFetch(`/api/sessions/${currentSessionId}/messages/${messageId}/activate`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
    } catch (e) {
      console.error('[SwitchVersion] Failed:', e);
    }
  };

  // Quick action handler: auto-create session if needed, then send deterministically
  const sendQuickAction = async (prompt: string) => {
    if (isStreaming) return;

    dispatch({ type: 'CLEAR_ERROR' });

    dispatch({ type: 'START_STREAM' });
    streamStartRef.current = Date.now();

    try {
      let sid = currentSessionId;
      if (!sid) {
        const newSession = await createSessionMutation.mutateAsync();
        sid = newSession.id;
      }

      // ── Optimistic Update ──────────────────────────────────────────────────
      const tempId = `temp-${Date.now()}`;
      queryClient.setQueryData(['session', sid], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          messages: [...(old.messages || []), { id: tempId, role: 'user', content: prompt }]
        };
      });

      if (!wsRef.current || wsRef.current.readyState >= WebSocket.CLOSING) {
        wsRef.current = connectWebSocket();
      }
      const openWs = await waitForSocketRef(wsRef, connectWebSocket);
      openWs.send(JSON.stringify({ type: 'chat', sessionId: sid, message: prompt }));
    } catch (e: any) {
      console.error('[sendQuickAction] Failed:', e);
      dispatch({ type: 'SET_ERROR', message: e.message || 'Failed to send prompt' });
    }
  };

  const allMessages = currentSession?.messages || [];
  const displayMessages = allMessages.filter((m: any) => m.isActive === 1 || m.id === 'streaming');
  // Show the streaming placeholder whenever the agent is active — even before
  // text starts arriving — so the stage / tool pill has somewhere to render.
  if (isStreaming || activeStage || activeToolCall) {
    displayMessages.push({
      id: 'streaming',
      role: 'assistant',
      content: streamingContent,
    });
  }

  // ── Active agentic overlay state ───────────────────────────────────────────
  // `agenticProgressTick` ensures re-renders when the step-progress ref updates.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _tick = agenticProgressTick;

  // Find the agentic_running DB message (used only for plan/goal metadata).
  const activeAgenticRunMsg = displayMessages.find(
    m => m.status === 'agentic_running'
  ) as (Message & { _stepProgress?: Record<number, 'running' | 'done' | 'error'>; _currentTool?: string }) | undefined;

  // Overlay is visible when the agent is running OR a checkpoint is awaiting confirmation.
  // Both signals are independent of the query cache — no re-fetch can collapse them.
  const agenticOverlayVisible = !!activeAgenticRunMsg || !!agenticProgressRef.current || !!activeCheckpoint;

  // Step progress comes from the stable ref, not the query cache.
  const liveProgress = agenticProgressRef.current;

  // Parse plan + goal from the running message's JSON content.
  // Fall back to the plan cached in the progress ref so the overlay renders
  // immediately, before the session re-fetch triggered by approve-plan completes.
  let overlayMeta: { goal: string; plan: { id: string; description: string; tool?: string }[] } = { goal: '', plan: [] };
  if (activeAgenticRunMsg) {
    try { overlayMeta = JSON.parse(activeAgenticRunMsg.content || '{}'); } catch { }
  } else if (liveProgress && (liveProgress.plan.length > 0 || liveProgress.goal)) {
    overlayMeta = { goal: liveProgress.goal, plan: liveProgress.plan };
  }

  // Derive a human-readable label for the active tool call pill.
  // Strip the server-id prefix (e.g. "filesystem__read_file" → "read_file").
  const toolPillTool = activeToolCall
    ? (activeToolCall.tool.includes('__') ? activeToolCall.tool.split('__')[1] : activeToolCall.tool)
    : null;
  const toolPillServer = activeToolCall?.server ?? '';

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0 bg-black relative">
        {currentSessionId && (
          <div className="h-14 border-b border-white/5 flex items-center justify-between px-4 pr-12 shrink-0 bg-zinc-950 z-10 backdrop-blur-sm relative">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-200">{currentSession?.title || 'Chat'}</span>
            </div>
            <div
              onClick={() => dispatch({ type: 'TOGGLE_GUARDIAN' })}
              className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-1 rounded transition-colors group relative"
            >
              <Bird className="w-4 h-4 text-cyan-500 group-hover:shadow-[0_0_12px_rgba(6,182,212,0.6)] rounded-full transition-shadow" />
              <span className="text-xs text-cyan-500 font-mono tracking-wide uppercase hidden md:inline">Agent Active</span>
            </div>

            {showGuardianOverlay && (
              <div className="absolute top-12 right-4 w-72 bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl p-4 z-50">
                <h4 className="text-xs font-bold text-gray-300 mb-2 uppercase tracking-wider flex items-center gap-2">
                  <Bird className="w-4 h-4 text-cyan-500" />
                  Agent Status
                </h4>
                <div className="space-y-2 text-xs font-mono text-gray-400">
                  <div className="flex justify-between border-b border-white/5 pb-1">
                    <span>Interceptor</span>
                    <span className="text-cyan-500">Enabled</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-1">
                    <span>Approval Layer</span>
                    <span className="text-cyan-500">Enforced</span>
                  </div>
                  <div className="flex justify-between pb-1">
                    <span>Active Agents</span>
                    <span className="text-cyan-500">Enabled</span>
                  </div>
                </div>
                <div className="mt-3 text-[10px] text-gray-600 leading-tight">
                  All MCP tool requests require explicit human approval. Destructive actions will trigger critical warnings.
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto w-full flex flex-col">
          {chatError && (
            <div className="w-full max-w-4xl mx-auto px-4 mt-3">
              <div className="flex items-start gap-3 p-3 bg-rose-950/40 border border-rose-500/30 rounded-lg shadow-[0_0_15px_rgba(244,63,94,0.1)]">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-sm text-rose-300 flex-1 leading-relaxed">{chatError.message}</p>
                <button onClick={() => dispatch({ type: 'CLEAR_ERROR' })} className="text-rose-500/80 hover:text-rose-300 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {!currentSessionId ? (
            <div className="flex items-center justify-center h-full text-gray-500 font-mono text-sm">
              Select or create a conversation to start
            </div>
          ) : sessionLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
            </div>
          ) : displayMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md space-y-6">
                {/* Hero */}
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border border-cyan-500/20 flex items-center justify-center shadow-[0_0_40px_rgba(6,182,212,0.15)]">
                    <Bird className="w-8 h-8 text-cyan-500" />
                  </div>
                </div>
                <div>
                  <h2 className="text-4xl font-bold text-white tracking-tight">Welcome to OpenMacaw</h2>
                  <p className="text-sm text-cyan-400 mt-2 font-mono">The Universal Guardian Agent.</p>
                </div>

                {/* Quick Actions Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                  {[
                    { label: 'Audit Directory', sub: 'Scan for security vulnerabilities', emoji: '🔍' },
                    { label: 'System Health', sub: 'Check CPU and memory status', emoji: '💻' },
                    { label: 'Security Review', sub: 'Analyze active server permissions', emoji: '🛡️' },
                    { label: 'Code Assistant', sub: 'Write a Python script or debug', emoji: '📝' },
                    { label: 'Shell Command', sub: 'Run a safe terminal command', emoji: '🐚' },
                    { label: 'Knowledge Discovery', sub: 'Explain a technical concept', emoji: '🧠' },
                  ].map((action) => (
                    <button
                      key={action.label}
                      onClick={() => sendQuickAction(action.label)}
                      className="flex items-center gap-4 px-4 py-3 bg-zinc-900/50 border border-white/5 rounded-xl text-left hover:bg-white/5 hover:border-cyan-500/30 transition-all group cursor-pointer shadow-sm"
                    >
                      <span className="text-xl shrink-0 brightness-90 group-hover:brightness-110 transition-all">{action.emoji}</span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors truncate">{action.label}</span>
                        <span className="text-[10px] text-gray-500 font-mono group-hover:text-gray-400 transition-colors truncate">{action.sub}</span>
                      </div>
                    </button>
                  ))}
                </div>

                <p className="text-[10px] text-gray-600 font-mono">
                  All tool executions require human approval.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 w-full max-w-4xl mx-auto px-4 py-8 space-y-6 flex flex-col">
              {displayMessages.map((msg, index) => {
                const isProposal = msg.role === 'assistant' && msg.toolCalls;
                // Simplified fail-safe: if the message has toolCalls data, always render the card
                const hasToolCalls = msg.toolCalls && (
                  (typeof msg.toolCalls === 'string' && msg.toolCalls.length > 2) ||
                  (typeof msg.toolCalls === 'object' && Object.keys(msg.toolCalls).length > 0)
                );
                const isApprovalCard = msg.role === 'assistant' && hasToolCalls;

                // ── Hide internal agentic system prompts ──────────────────────────────────
                // The execution prompt injected as a user message must never appear in chat.
                if (msg.role === 'user' && msg.content?.startsWith('[AGENTIC MODE ACTIVE')) {
                  return null;
                }
                // Also hide the [SYSTEM] confirmation/discard messages after checkpoint
                if (msg.role === 'user' && msg.content?.startsWith('[SYSTEM]')) {
                  return null;
                }
                // Hide assistant messages that are only agentic step-execution markers
                // (e.g. "[STEP_START:1]" saved as preamble to a tool call — ~14 chars).
                // The model's final summary turn also starts with step markers but has
                // real content after them; strip the markers and let those through so the
                // rendering code below can display the cleaned text.
                if (msg.role === 'assistant' && msg.content?.includes('[STEP_START:')) {
                  const stripped = msg.content
                    .replace(/\[STEP_START:\d+\]\n?/g, '')
                    .replace(/\[STEP_DONE:\d+\]\n?/g, '')
                    .trim();
                  if (!stripped) return null;
                  // Fall through — the rendering code at line ~2011 will strip the markers.
                }

                // ── Agentic DB-persisted messages (status-driven) ─────────────────────────
                // These messages come from the DB with status='agentic_*' and JSON content.
                if (msg.status?.startsWith?.('agentic_')) {
                  let meta: any = {};
                  try { meta = JSON.parse(msg.content || '{}'); } catch { }
                  const plan = meta.plan || [];
                  const goal = meta.goal || '';
                  const runId = meta.runId || '';
                  const stepProgress = (msg as any)._stepProgress || {};
                  const currentTool = (msg as any)._currentTool;

                  if (msg.status === 'agentic_plan') {
                    return (
                      <div key={msg.id} className="w-full my-4">
                        <div className="w-full max-w-lg">
                          <AgenticPlanCard
                            runId={runId}
                            goal={goal}
                            plan={plan}
                            sessionId={currentSessionId}
                            initialRequireFinal={meta.requireFinalApproval}
                            initialCompletionGoal={meta.completionGoal}
                            onAction={() => queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] })}
                          />
                        </div>
                      </div>
                    );
                  }

                  if (msg.status === 'agentic_running') {
                    // Full live checklist is shown in the overlay above the input.
                    // Show a compact pill here so the thread position is preserved.
                    return (
                      <div key={msg.id} className="w-full my-4">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-violet-950/30 border border-violet-500/20 rounded-full text-[10px] font-mono text-violet-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse shrink-0" />
                          Agent running — see checklist above input
                        </div>
                      </div>
                    );
                  }

                  if (msg.status === 'agentic_done') {
                    return (
                      <div key={msg.id} className="w-full my-4">
                        <div className="w-full max-w-lg">
                          <AgenticProgressCard
                            goal={goal}
                            plan={plan}
                            stepProgress={stepProgress}
                            currentTool={undefined}
                            runStatus="done"
                          />
                        </div>
                      </div>
                    );
                  }

                  if (msg.status === 'agentic_cancelled') {
                    return (
                      <div key={msg.id} className="w-full my-4">
                        <div className="w-full max-w-lg">
                          <AgenticProgressCard
                            goal={goal}
                            plan={plan}
                            stepProgress={stepProgress}
                            currentTool={undefined}
                            runStatus="cancelled"
                          />
                        </div>
                      </div>
                    );
                  }

                  // Unrecognised agentic status — don't render anything
                  return null;
                }



                // Hide raw tool results from the chat feed entirely.
                // The user sees: [User Prompt] -> [ApprovalCard] -> [LLM Summary]
                if (msg.role === 'tool' || msg.role === 'system') {
                  return null;
                }

                if (isApprovalCard) {
                  // ── State machine: use DB status as single source of truth ────────────
                  // Fall back to the fragile heuristic only for messages without a status
                  // field (legacy data that wasn't migrated, or in-flight streaming).
                  const status = msg.status ?? (
                    displayMessages.slice(index + 1).some((m: Message) => m.role === 'tool') ? 'executed' : 'pending'
                  );

                  // Denied — show collapsed DeniedCollapsible (no interactive card)
                  if (status === 'denied') {
                    // Extract denial reason from the matching tool message
                    const matchingToolMsg = msg.toolCallId
                      ? displayMessages.find((m: Message) => m.role === 'tool' && m.toolCallId === msg.toolCallId)
                      : undefined;
                    const denyReason = matchingToolMsg?.content
                      ?.replace(/^Tool call denied:\s*/i, '')
                      ?.replace(/^The user DENIED.*?\.\s*/i, '')
                      ?.trim() || '';
                    return (
                      <div key={msg.id} className="w-full text-center my-6">
                        <div className="inline-block w-full max-w-md text-left">
                          <DeniedCollapsible reason={denyReason} />
                        </div>
                      </div>
                    );
                  }

                  // Executed / Approved — show compact green success card
                  if (status === 'executed' || status === 'approved') {
                    return (
                      <div key={msg.id} className="w-full text-center my-6">
                        <div className="inline-block w-full max-w-md text-left">
                          <div className="mt-3 bg-green-950/20 border border-green-500/20 rounded-md p-3 flex items-center justify-between">
                            <span className="text-[10px] font-mono text-green-500 uppercase tracking-wider">Executed Successfully</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Pending (or unknown) — show the full interactive ApprovalCard
                  return (
                    <div key={msg.id} className="w-full text-center my-6">
                      <div className="inline-block w-full max-w-md text-left">
                        <ApprovalCard
                          toolCalls={msg.toolCalls!}
                          sessionId={currentSessionId}
                          onApprove={() => {
                            queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
                          }}
                          onReject={() => {
                            queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
                          }}
                        />
                      </div>
                    </div>
                  );
                }

                // Note: The double-layer regex intercept now runs at the state level
                // inside the message_end handler, not here. This prevents flash/vanish
                // issues from streaming chunk volatility.

                return (
                  <div
                    key={msg.id}
                    className={`flex w-full mb-6 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] relative group ${msg.role === 'user'
                        ? 'bg-zinc-800 border border-white/10 rounded-2xl rounded-tr-none px-4 py-3'
                        : 'bg-transparent w-full'
                        }`}
                    >
                      {msg.role === 'user' ? (
                        <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      ) : (
                        !msg.toolCalls && (() => {
                          const isStreamingMsg = msg.id === 'streaming';
                          const toolsForHeader: ToolCallSummaryItem[] = isStreamingMsg
                            ? streamingToolCalls
                            : getToolsUsedBeforeMessage(allMessages, index);

                          let cleaned = msg.content || '';
                          try {
                            const trimmed = cleaned.trim();
                            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                              const parsed = JSON.parse(trimmed);
                              const keys = Object.keys(parsed);
                              if (keys.length === 1 && typeof parsed[keys[0]] === 'string') {
                                const WRAPPER_KEYS = ['response', 'message', 'content', 'text', 'answer', 'reply', 'output', 'result'];
                                if (WRAPPER_KEYS.includes(keys[0])) {
                                  cleaned = parsed[keys[0]];
                                }
                              }
                            }
                          } catch { }
                          cleaned = cleaned.replace(/\{[\s\S]*?"name"\s*:\s*".*?"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g, '').trim();
                          cleaned = cleaned
                            .replace(/\[STEP_START:\d+\]\n?/g, '')
                            .replace(/\[STEP_DONE:\d+\]\n?/g, '')
                            .replace(/\[AGENTIC_GOAL_REACHED:[^\]]+\]\n?/g, '')
                            .trim();

                          if (!cleaned && !(isStreamingMsg && (toolPillTool || activeStage)) && toolsForHeader.length === 0) return null;

                          return (
                            <div className="space-y-4">
                              <ToolsUsedHeader tools={toolsForHeader} />

                              {cleaned ? (
                                <div className={`text-sm text-gray-300 gap-4 leading-relaxed prose prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-cyan-300 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-transparent prose-pre:p-0 ${isStreamingMsg ? 'streaming-cursor' : ''}`}>
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm, remarkMath]}
                                    rehypePlugins={[rehypeKatex]}
                                    components={{
                                      code: CodeBlock as any,
                                    }}
                                  >
                                    {cleaned}
                                  </ReactMarkdown>
                                </div>
                              ) : null}

                                {isStreamingMsg && toolPillTool && (
                                  <ToolActivityPill tool={toolPillTool} server={toolPillServer} />
                                )}
                                {isStreamingMsg && !toolPillTool && activeStage && (
                                  <div className="flex items-center gap-2 mt-2 px-3 py-1.5 bg-zinc-900 border border-white/10 rounded-full w-fit text-[11px] font-mono text-gray-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse shrink-0 shadow-[0_0_8px_rgba(6,182,212,0.5)]" />
                                    {activeStage}
                                  </div>
                                )}
 
                                 {/* Assistant Action Bar (visible on hover) */}
                                 {!isStreamingMsg && msg.role === 'assistant' && !isApprovalCard && (() => {
                                   const siblings = allMessages.filter(m => m.parentId === msg.parentId && m.role === 'assistant');
                                   const currentIndex = siblings.findIndex(s => s.id === msg.id) + 1;
                                   const totalVersions = siblings.length;

                                   return (
                                     <div className="flex items-center gap-3 mt-2">
                                       <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                         <VersionSwitcher
                                           current={currentIndex}
                                           total={totalVersions}
                                           onPrev={() => handleSwitchVersion(siblings[currentIndex - 2].id)}
                                           onNext={() => handleSwitchVersion(siblings[currentIndex].id)}
                                         />
                                         <button
                                           onClick={() => {
                                             navigator.clipboard.writeText(cleaned);
                                           }}
                                           title="Copy message"
                                           className="p-1.5 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
                                         >
                                           <Copy className="w-3.5 h-3.5" />
                                         </button>
                                         {index === displayMessages.length - 1 && (
                                           <button
                                             onClick={() => handleRegenerate(msg.id)}
                                             title="Regenerate response"
                                             className="p-1.5 rounded hover:bg-white/5 text-gray-500 hover:text-violet-400 transition-colors"
                                           >
                                             <Zap className="w-3.5 h-3.5" />
                                           </button>
                                         )}
                                       </div>
                                     </div>
                                   );
                                 })()}
                              </div>
                          );
                        })()
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Agentic Live Overlay (above input) ─────────────────────────────── */}
        {agenticOverlayVisible && (
          <div className="w-full border-t border-violet-500/20 bg-zinc-950/80 backdrop-blur-sm">
            <div className="w-full max-w-4xl mx-auto px-4 py-3">
              {/* Final checkpoint takes priority over the running checklist */}
              {activeCheckpoint ? (
                <AgenticFinalCheckpointCard
                  runId={activeCheckpoint.runId}
                  pendingActions={activeCheckpoint.pendingActions}
                  onDismiss={() => {
                    setActiveCheckpoint(null);
                    queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
                  }}
                />
              ) : liveProgress ? (
                <AgenticProgressCard
                  goal={overlayMeta.goal}
                  plan={overlayMeta.plan}
                  stepProgress={liveProgress.stepProgress}
                  currentTool={liveProgress.currentTool}
                  runStatus="running"
                />
              ) : null}
            </div>
          </div>
        )}

        <ChatInput
          value={input}
          onChange={(v) => setInput(typeof v === 'function' ? v(input) : v)}
          onSend={() => { handleSend(); }}
          onStop={async () => {
            if (!currentSessionId) return;
            try {
              await apiFetch(`/api/sessions/${currentSessionId}/stop`, { method: 'POST' });
            } catch { /* ignore — stream may have already finished */ }
            dispatch({ type: 'END_STREAM' });
            streamingStartedRef.current = false;
            queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
          }}
          isStreaming={isStreaming}
          sessionId={currentSessionId}
          onClear={() => {
            queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
          }}
          onNavigate={(path) => navigate(path)}
        />
      </div>
    </div>
  );
}

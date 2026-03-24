export const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;

export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; tool: string; server: string; input: Record<string, unknown> }
  | { type: 'tool_call_result'; outcome: 'allowed' | 'denied'; result?: unknown; reason?: string }
  | { type: 'message_end'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'proposal'; id?: string; tool: string; input: Record<string, unknown> }
  | { type: 'batch_proposal'; id: string; toolCalls: Array<{ tool: string; server: string; input: Record<string, unknown> }> }
  | { type: 'error'; message: string; code?: string }
  | { type: 'step_count'; count: number }
  | { type: 'session_renamed'; sessionId: string; newTitle: string }
  | { type: 'pipeline_stage'; stage: string }
  // ── Agentic Run lifecycle events ──────────────────────────────────────────
  | { type: 'agentic_plan_proposed'; runId: string; goal: string; plan: { id: string; description: string; tool?: string; server?: string }[]; requireFinalApproval?: boolean; completionGoal?: string }
  | { type: 'agentic_running'; runId: string }
  | { type: 'agentic_step_progress'; runId: string; stepIndex: number; tool: string; status: 'running' | 'done' | 'error' }
  | { type: 'agentic_final_checkpoint'; runId: string; pendingActions: { tool: string; server: string; input: Record<string, unknown>; result?: unknown; executedAt: string }[] }
  | { type: 'agentic_done'; runId: string }
  | { type: 'agentic_cancelled'; runId: string; reason?: string };

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  // Ensure endpoint starts with a slash
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  const headers = new Headers(options.headers || {});
  const token = localStorage.getItem('openmacaw_token');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!path.startsWith('/api/auth/') && res.status === 401) {
    localStorage.removeItem('openmacaw_token');
    window.location.href = '/auth';
  }

  return res;
}

export function getWsUrl(endpoint: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  let base: string;
  if (import.meta.env.VITE_API_URL) {
    const url = new URL(import.meta.env.VITE_API_URL);
    base = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}${path}`;
  } else {
    base = `${protocol}//${window.location.host}${path}`;
  }

  // Browsers cannot set Authorization headers on WebSocket connections, so
  // pass the JWT as a query parameter for the server to verify.
  const token = localStorage.getItem('openmacaw_token');
  if (token) {
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}token=${encodeURIComponent(token)}`;
  }

  return base;
}

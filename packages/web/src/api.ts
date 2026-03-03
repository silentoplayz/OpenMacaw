export const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;

export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; tool: string; server: string; input: Record<string, unknown> }
  | { type: 'tool_call_result'; outcome: 'allowed' | 'denied'; result?: unknown; reason?: string }
  | { type: 'message_end'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'proposal'; id?: string; tool: string; input: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'step_count'; count: number }
  | { type: 'session_renamed'; sessionId: string; newTitle: string };

export async function apiFetch(endpoint: string, options?: RequestInit) {
  // Ensure endpoint starts with a slash
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return fetch(`${API_BASE}${path}`, options);
}

export function getWsUrl(endpoint: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  
  if (import.meta.env.VITE_API_URL) {
    const url = new URL(import.meta.env.VITE_API_URL);
    return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  }

  return `${protocol}//${window.location.host}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

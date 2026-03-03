import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Trash2, Loader2, ShieldCheck, Search, Terminal, Shield, Check, Copy, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch, getWsUrl, type AgentEvent } from '../api';

// ── Copy Button for Code Blocks ───────────────────────────────────────────────
function CodeBlock({ children, className, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const handleCopy = () => {
    const text = codeRef.current?.textContent || '';
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Only add the button to actual code blocks (inside <pre>), not inline code
  const isInline = !className && typeof children === 'string' && !children.includes('\n');
  if (isInline) {
    return <code className={className} {...props}>{children}</code>;
  }

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 bg-white/5 border border-white/10 rounded hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100 z-10"
        title="Copy code"
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : (
          <Copy className="w-3 h-3 text-gray-400" />
        )}
      </button>
      <code ref={codeRef} className={className} {...props}>{children}</code>
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
  status?: 'pending' | 'approved' | 'executed' | 'denied';
}

interface Session {
  id: string;
  title: string;
  model: string;
  mode: 'build' | 'plan';
  messages: Message[];
}

function hydrateMessage(msg: Message): Message {
  if (msg.role === 'assistant' && !msg.toolCalls) {
    const proposalMatch = msg.content?.match(/I proposed executing (.*?):(.*?) \(Waiting for approval\)\.?/);
    if (proposalMatch) {
      const serverId = proposalMatch[1];
      const toolName = proposalMatch[2];
      return {
        ...msg,
        toolCallId: `${serverId}:${toolName}`, // Use name as ID if missing from content
        toolCalls: JSON.stringify([{ 
          id: `${serverId}:${toolName}`,
          name: `${serverId}:${toolName}`, 
          arguments: { _status: "Hydrated from history" } 
        }])
      };
    }
  }
  return msg;
}


export default function Chat() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(sessionId || null);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [mockMessages, setMockMessages] = useState<Message[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [showGuardianOverlay, setShowGuardianOverlay] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamStartRef = useRef<number>(0);
  const streamingStartedRef = useRef(false);
  const queryClient = useQueryClient();

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
        queryClient.removeQueries({ queryKey: ['session', deletedId] });
      }
    },
  });

  useEffect(() => {
    if (sessions?.length && !currentSessionId) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [sessions, currentSessionId]);

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
      }
    };

    ws.onmessage = (event) => {
      const data: AgentEvent = JSON.parse(event.data);

      switch (data.type) {
        case 'text_delta':
          if (!isStreaming) setIsStreaming(true);
          // Dispatch first-chunk event to Inspector
          if (!streamingStartedRef.current) {
            streamingStartedRef.current = true;
            window.dispatchEvent(new CustomEvent('openmacaw:inspector', {
              detail: { type: 'stream_start', tool: 'LLM', input: { event: 'Streaming response started' } }
            }));
          }
          setStreamingContent(prev => prev + (data.content || ''));
          break;
        case 'tool_call_start':
          if (!isStreaming) setIsStreaming(true);
          window.dispatchEvent(new CustomEvent('openmacaw:inspector', {
            detail: { type: 'tool_call', tool: data.tool || 'unknown', input: { event: 'Tool call initiated' } }
          }));
          setStreamingContent(prev => prev + `\n[Calling tool: ${data.tool}]`);
          break;
        case 'tool_call_result':
          if (data.outcome === 'denied') {
            setStreamingContent(prev => prev + `\n[Denied: ${data.reason}]`);
          } else {
            setStreamingContent(prev => prev + `\n[Tool result: ${JSON.stringify(data.result)}]`);
          }
          break;
        case 'message_end': {
          const responseTimeMs = streamStartRef.current > 0 ? Date.now() - streamStartRef.current : 0;

          // ── Stabilized Regex Intercept ───────────────────────────────────
          // Scan the FINAL streaming content for embedded JSON tool calls.
          // Mutate the session cache at the state level so the ApprovalCard
          // renders from stable data, eliminating the render-loop flash.
          const finalContent = streamingContent;
          const toolCallPattern = /\{[\s\S]*?"name"\s*:\s*"([^"]+)"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g;
          const tcMatch = toolCallPattern.exec(finalContent);
          if (tcMatch) {
            try {
              const parsed = JSON.parse(tcMatch[0]);
              if (parsed.name && parsed.arguments) {
                const stripped = finalContent.replace(toolCallPattern, '').trim();
                const syntheticToolCalls = JSON.stringify([{ name: parsed.name, arguments: parsed.arguments, id: `fe-${Date.now()}` }]);
                // Inject a synthetic proposal message into the session cache
                // IMMUTABLE: create brand new arrays and objects at every level
                queryClient.setQueryData(['session', currentSessionId], (old: any) => {
                  if (!old) return old;
                  const newMsg = {
                    id: `regex-${Date.now()}`,
                    role: 'assistant' as const,
                    content: stripped || `I propose executing ${parsed.name}.`,
                    toolCalls: syntheticToolCalls,
                  };
                  return {
                    ...old,
                    messages: [...(old.messages || []).map((m: any) => ({...m})), newMsg]
                  };
                });
                // Skip normal invalidation — we already injected the message
                setIsStreaming(false);
                setStreamingContent('');
                streamStartRef.current = 0;
                streamingStartedRef.current = false;
                window.dispatchEvent(new CustomEvent('openmacaw:telemetry', {
                  detail: {
                    inputTokens: (data as any).usage?.inputTokens || 0,
                    outputTokens: (data as any).usage?.outputTokens || 0,
                    responseTimeMs,
                  }
                }));
                break;
              }
            } catch { /* not valid JSON, continue normally */ }
          }

          setIsStreaming(false);
          setStreamingContent('');
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
          break;
        }
          case 'proposal': {
            console.log('[WS] Received PROPOSAL event:', data);
            setIsStreaming(false);
            setStreamingContent('');
            streamingStartedRef.current = false;

            const newProposalMsg = {
              id: data.id || `proposal-${Date.now()}`,
              role: 'assistant' as const,
              content: `I propose executing ${data.tool}. Please authorize the action.`,
              toolCallId: data.id,
              toolCalls: JSON.stringify([{ id: data.id, name: data.tool, arguments: data.input }])
            };

            // IMMUTABLE: always push a new message — never attempt to update a non-existent ID
            queryClient.setQueryData(['session', currentSessionId], (old: any) => {
              if (!old) return old;
              // Check if this proposal ID already exists to avoid duplicates
              const alreadyExists = (old.messages || []).some((m: any) => m.id === newProposalMsg.id);
              if (alreadyExists) return old;
              return {
                ...old,
                messages: [...(old.messages || []).map((m: any) => ({...m})), newProposalMsg]
              };
            });

            // Emit to Inspector
            window.dispatchEvent(new CustomEvent('openmacaw:inspector', {
              detail: { type: 'proposal', tool: data.tool, input: data.input, id: data.id }
            }));
            break;
          }

          case 'error':
          setIsStreaming(false);
          setStreamingContent(prev => prev + `\n[Error: ${data.message}]`);
          break;

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
      setIsStreaming(false);
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      setIsStreaming(false);
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
      wsRef.current = null;
    };
  }, [currentSessionId, connectWebSocket]);

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const message = input;
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    streamStartRef.current = Date.now();

    try {
      // Auto-create a session if none exists
      let sid = currentSessionId;
      if (!sid) {
        const res = await apiFetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Conversation' }),
        });
        const newSession = await res.json();
        sid = newSession.id;
        setCurrentSessionId(sid);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      }

      // Deterministically wait for the socket to be OPEN — no timeout guesses
      let ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        ws = connectWebSocket();
        wsRef.current = ws;
      }
      const openWs = await waitForSocket(ws);
      openWs.send(JSON.stringify({ type: 'chat', sessionId: sid, message }));
    } catch (e) {
      console.error('[sendMessage] Failed:', e);
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Quick action handler: auto-create session if needed, then send deterministically
  const sendQuickAction = async (prompt: string) => {
    if (isStreaming) return;

    setIsStreaming(true);
    setStreamingContent('');
    streamStartRef.current = Date.now();

    try {
      let sid = currentSessionId;
      if (!sid) {
        const res = await apiFetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Conversation' }),
        });
        const newSession = await res.json();
        sid = newSession.id;
        setCurrentSessionId(sid);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      }

      // Deterministically wait for the socket to be OPEN — no timeout guesses
      let ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        ws = connectWebSocket();
        wsRef.current = ws;
      }
      const openWs = await waitForSocket(ws);
      openWs.send(JSON.stringify({ type: 'chat', sessionId: sid, message: prompt }));
    } catch (e) {
      console.error('[sendQuickAction] Failed:', e);
      setIsStreaming(false);
    }
  };

  const allMessages = (currentSession?.messages || []).map(hydrateMessage);
  if (isStreaming) {
    allMessages.push({
      id: 'streaming',
      role: 'assistant',
      content: streamingContent,
    });
  }

  return (
    <div className="flex h-full">
      <aside className="w-56 border-r border-gray-200 dark:border-white/10 bg-zinc-50 dark:bg-zinc-900/50 flex flex-col shrink-0 hidden md:flex">
        <div className="h-14 px-3 border-b border-gray-200 dark:border-white/10 flex items-center">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Conversations</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {sessionsLoading ? (
            <div className="p-4 text-gray-500 dark:text-gray-400">Loading...</div>
          ) : (
            sessions?.map(session => (
              <div
                key={session.id}
                className={`group flex items-center justify-between px-3 py-2 rounded-lg mb-1 cursor-pointer transition-colors ${
                  currentSessionId === session.id 
                    ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' 
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                }`}
                onClick={() => setCurrentSessionId(session.id)}
              >
                <span className="truncate flex-1">{session.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Delete this conversation?')) {
                      deleteSessionMutation.mutate(session.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 dark:hover:bg-white/10 rounded transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 bg-black relative">
        {currentSessionId && (
          <div className="h-14 border-b border-white/5 flex items-center justify-between px-4 shrink-0 bg-zinc-950 z-10 backdrop-blur-sm relative">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-200">{currentSession?.title || 'Chat'}</span>
            </div>
            <div 
              onClick={() => setShowGuardianOverlay(!showGuardianOverlay)}
              className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-1 rounded transition-colors group relative"
            >
              <ShieldCheck className="w-4 h-4 text-cyan-500 group-hover:shadow-[0_0_12px_rgba(6,182,212,0.6)] rounded-full transition-shadow" />
              <span className="text-xs text-cyan-500 font-mono tracking-wide uppercase hidden md:inline">Guardian Active</span>
            </div>

            {showGuardianOverlay && (
              <div className="absolute top-12 right-4 w-72 bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl p-4 z-50">
                <h4 className="text-xs font-bold text-gray-300 mb-2 uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-500" />
                  System Security Status
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
                    <span>Active Shields</span>
                    <span className="text-cyan-500">Enabled</span>
                  </div>
                </div>
                <div className="mt-3 text-[10px] text-gray-500 leading-tight">
                  All MCP tool requests require explicit human approval. Destructive actions will trigger critical warnings.
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!currentSessionId ? (
            <div className="flex items-center justify-center h-full text-gray-500 font-mono text-sm">
              Select or create a conversation to start
            </div>
          ) : sessionLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
            </div>
          ) : allMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md space-y-6">
                {/* Hero */}
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border border-cyan-500/20 flex items-center justify-center shadow-[0_0_40px_rgba(6,182,212,0.15)]">
                    <Shield className="w-8 h-8 text-cyan-500" />
                  </div>
                </div>
                <div>
                  <h2 className="text-4xl font-bold text-white tracking-tight">Welcome to OpenMacaw</h2>
                  <p className="text-sm text-cyan-400 mt-2 font-mono">The Universal Guardian Agent.</p>
                </div>

                {/* Quick Actions */}
                <div className="grid gap-2">
                  {[
                    { label: 'Audit my current directory', emoji: '🔍' },
                    { label: 'Review my active security permissions', emoji: '🛡️' },
                    { label: 'Check system health', emoji: '💻' },
                  ].map((action) => (
                    <button
                      key={action.label}
                      onClick={() => sendQuickAction(action.label)}
                      className="flex items-center gap-3 px-4 py-3 bg-white/5 border border-white/5 rounded-lg text-left hover:bg-white/10 hover:border-cyan-500/20 transition-all group cursor-pointer"
                    >
                      <span className="text-lg">{action.emoji}</span>
                      <span className="text-sm text-gray-400 group-hover:text-gray-200 transition-colors">{action.label}</span>
                    </button>
                  ))}
                </div>

                <p className="text-[10px] text-gray-600 font-mono">
                  All tool executions require human approval.
                </p>
              </div>
            </div>
          ) : (
            allMessages.map((msg, index) => {
              const isProposal = msg.role === 'assistant' && msg.toolCalls;
              // Simplified fail-safe: if the message has toolCalls data, always render the card
              const hasToolCalls = msg.toolCalls && (
                (typeof msg.toolCalls === 'string' && msg.toolCalls.length > 2) ||
                (typeof msg.toolCalls === 'object' && Object.keys(msg.toolCalls).length > 0)
              );
              const isApprovalCard = msg.role === 'assistant' && hasToolCalls;
              
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
                  allMessages.slice(index + 1).some((m: Message) => m.role === 'tool') ? 'executed' : 'pending'
                );

                // Denied — show collapsed DeniedCollapsible (no interactive card)
                if (status === 'denied') {
                  return (
                    <div key={msg.id} className="flex justify-center w-full my-6">
                      <div className="w-full max-w-md">
                        <DeniedCollapsible reason="" />
                      </div>
                    </div>
                  );
                }

                // Executed / Approved — show compact green success card
                if (status === 'executed' || status === 'approved') {
                  return (
                    <div key={msg.id} className="flex justify-center w-full my-6">
                      <div className="w-full max-w-md">
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
                  <div key={msg.id} className="flex justify-center w-full my-6">
                    <div className="w-full max-w-md">
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
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-2xl px-3 py-2 rounded-md ${
                      msg.role === 'user'
                        ? 'bg-zinc-800 text-gray-200 border border-white/5'
                        : 'bg-transparent text-gray-300'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    ) : (
                      !msg.toolCalls && (() => {
                        // Strip any residual JSON tool-call blobs from the displayed content
                        let cleaned = msg.content || '';
                        // ── JSON Unwrap ────────────────────────────────────
                        // Local models in JSON mode often output {"response":"..."}
                        // instead of plain text. Detect and unwrap single-key wrappers.
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
                        } catch { /* not JSON, use as-is */ }
                        // Strip residual JSON tool-call blobs from the displayed content
                        cleaned = cleaned.replace(/\{[\s\S]*?"name"\s*:\s*".*?"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g, '').trim();
                        if (!cleaned) return null;
                        return (
                          <div className="text-sm prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-cyan-300 prose-code:font-mono prose-code:text-xs prose-pre:bg-black prose-pre:border prose-pre:border-white/10 prose-pre:rounded-md prose-pre:text-gray-300 prose-pre:p-3 prose-a:text-cyan-400 prose-strong:text-white prose-blockquote:border-cyan-500/30 prose-blockquote:text-gray-400">
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                              components={{
                                code: CodeBlock as any,
                              }}
                            >
                              {cleaned}
                            </ReactMarkdown>
                          </div>
                        );
                      })()
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 border-t border-white/5 bg-black">
          <div className="flex gap-2 max-w-4xl mx-auto items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Auto-resize
                const ta = textareaRef.current;
                if (ta) {
                  ta.style.height = 'auto';
                  ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="flex-1 px-3 py-2.5 bg-zinc-950 border border-white/10 text-gray-200 rounded-md resize-none focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 shadow-sm text-sm overflow-y-auto"
              style={{ maxHeight: '200px' }}
              rows={1}
              disabled={isStreaming}
            />
            <button
              onClick={() => {
                sendMessage();
                // Reset textarea height
                if (textareaRef.current) textareaRef.current.style.height = 'auto';
              }}
              disabled={!input.trim() || isStreaming}
              className="px-4 py-2.5 bg-white text-black rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors flex items-center justify-center self-end"
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

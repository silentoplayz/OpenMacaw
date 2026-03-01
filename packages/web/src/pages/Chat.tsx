import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Trash2, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch, getWsUrl, type AgentEvent } from '../api';

function ApprovalCard({ toolCalls, sessionId, alreadyExecuted, onApprove, onReject }: { toolCalls: string, sessionId?: string | null, alreadyExecuted?: boolean, onApprove: () => void, onReject: () => void }) {
  const [loading, setLoading] = useState(false);
  const [executed, setExecuted] = useState(alreadyExecuted || false);
  
  useEffect(() => {
    if (alreadyExecuted) setExecuted(true);
  }, [alreadyExecuted]);

  let calls: any[] = [];
  try { calls = JSON.parse(toolCalls); } catch (e) {}
  if (!Array.isArray(calls)) calls = [calls];

  const handleApprove = async () => {
    setLoading(true);
    window.dispatchEvent(new CustomEvent('openmacaw:executing', { detail: { action: 'START', calls } }));
    try {
      await apiFetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolCalls: calls,
          user_approved: true,
          sessionId
        })
      });
      setExecuted(true);
      window.dispatchEvent(new CustomEvent('openmacaw:executing', { detail: { action: 'SUCCESS', calls } }));
      setTimeout(() => onApprove(), 1500);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('openmacaw:executing', { detail: { action: 'FAILED', calls, error: String(e) } }));
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const isDestructive = calls.some(c => c.name?.toLowerCase().match(/delete|remove|drop/));

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
      <div className="p-3">
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2">Proposed Actions</p>
        <div className="space-y-2 mb-3">
          {calls.map((call, i) => (
            <div key={i} className="bg-black border border-white/5 rounded p-2 font-mono text-xs">
              <div className="text-cyan-400 mb-1">{call.name}</div>
              <div className="text-gray-500 text-[10px] break-all">{JSON.stringify(call.arguments)}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onReject} disabled={loading} className="flex-1 px-3 py-1.5 bg-black border border-white/10 hover:bg-white/5 text-gray-400 hover:text-white text-[10px] font-bold font-mono uppercase tracking-wider rounded transition-colors disabled:opacity-50">
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();

  const { data: sessions, isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await apiFetch('/api/sessions');
      return res.json();
    },
  });

  const { data: currentSession, isLoading: sessionLoading } = useQuery<Session>({
    queryKey: ['session', currentSessionId],
    queryFn: async () => {
      const res = await apiFetch(`/api/sessions/${currentSessionId}`);
      return res.json();
    },
    enabled: !!currentSessionId,
  });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (currentSessionId === deleteSessionMutation.variables) {
        setCurrentSessionId(sessions?.[0]?.id || null);
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
          setStreamingContent(prev => prev + (data.content || ''));
          break;
        case 'tool_call_start':
          if (!isStreaming) setIsStreaming(true);
          setStreamingContent(prev => prev + `\n[Calling tool: ${data.tool}]`);
          break;
        case 'tool_call_result':
          if (data.outcome === 'denied') {
            setStreamingContent(prev => prev + `\n[Denied: ${data.reason}]`);
          } else {
            setStreamingContent(prev => prev + `\n[Tool result: ${JSON.stringify(data.result)}]`);
          }
          break;
        case 'message_end':
          setIsStreaming(false);
          setStreamingContent('');
          queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
          break;
          case 'proposal':
            console.log('[WebSocket] Received proposal:', data);
            queryClient.setQueryData(['session', sessionId], (old: any) => {
              if (!old) return old;
              
              // We construct an artificial assistant message holding the tool calls payload. 
              // React will see `toolCalls` and render `ApprovalCard`.
              return {
                ...old,
                messages: [
                  ...old.messages,
                  {
                    id: data.id || `proposal-${Date.now()}`,
                    role: 'assistant',
                    content: `I propose executing ${data.tool}. Please authorize the action.`,
                    toolCallId: data.id,
                    toolCalls: JSON.stringify([{ id: data.id, name: data.tool, arguments: data.input }])
                  }
                ]
              };
            });
            break;
            
          case 'error':
          setIsStreaming(false);
          setStreamingContent(prev => prev + `\n[Error: ${data.message}]`);
          break;
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

  const sendMessage = () => {
    if (!input.trim() || !currentSessionId || isStreaming || !wsRef.current) return;

    setIsStreaming(true);
    setStreamingContent('');

    if (wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        sessionId: currentSessionId,
        message: input,
      }));
      setInput('');
    } else {
      // Re-connect and send if closed
      const ws = connectWebSocket();
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'chat',
          sessionId: currentSessionId,
          message: input,
        }));
        setInput('');
      };
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
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

      <div className="flex-1 flex flex-col min-w-0 bg-black">
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
            <div className="flex items-center justify-center h-full text-gray-500 font-mono text-sm">
              [System] Ready for input
            </div>
          ) : (
            allMessages.map((msg, index) => {
              const isProposal = msg.role === 'assistant' && msg.toolCalls;
              
              if (isProposal) {
                const alreadyExecuted = allMessages.slice(index + 1).some(m => m.role === 'tool');

                return (
                  <div key={msg.id} className="flex justify-center w-full my-6">
                    <div className="w-full max-w-md">
                      <ApprovalCard 
                        toolCalls={msg.toolCalls!} 
                        sessionId={currentSessionId}
                        alreadyExecuted={alreadyExecuted}
                        onApprove={() => { 
                          queryClient.invalidateQueries({ queryKey: ['session', currentSessionId] });
                        }} 
                        onReject={() => { alert('Execution denied by user'); }} 
                      />
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-2xl px-3 py-2 rounded-md ${
                      msg.role === 'user'
                        ? 'bg-zinc-800 text-gray-200 border border-white/5'
                        : msg.role === 'tool'
                        ? 'bg-zinc-950 text-gray-400 border border-white/5 font-mono text-xs'
                        : 'bg-transparent text-gray-300'
                    }`}
                  >
                    {msg.role === 'user' || msg.role === 'tool' ? (
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    ) : (
                      !msg.toolCalls && (
                        <div className="text-sm prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-sm prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-white/5 prose-pre:text-gray-300">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 border-t border-white/5 bg-black">
          <div className="flex gap-2 max-w-4xl mx-auto">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="flex-1 px-3 py-2.5 bg-zinc-950 border border-white/10 text-gray-200 rounded-md resize-none focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 shadow-sm text-sm"
              rows={1}
              disabled={isStreaming}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className="px-4 py-2 bg-white text-black rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors flex items-center justify-center"
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

import { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Server, Activity, Settings, Shield,
  ChevronLeft, ChevronRight, Bot, Plus, X, Save, Loader2, Menu, Moon, Sun, ShieldCheck, Settings2, AlertOctagon
} from 'lucide-react';
import { apiFetch } from './api';
import { ServerPermissionDrawer } from './components/ServerPermissionDrawer';
import { AnimatePresence, motion } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentForm {
  AGENT_NAME: string;
  AGENT_DESCRIPTION: string;
  SYSTEM_PROMPT: string;
  DEFAULT_MODEL: string;
  MAX_STEPS: string;
  TEMPERATURE: string;
}

interface McpServer {
  id: string;
  name: string;
  transport: string;
  enabled: boolean;
  toolCount: number;
  status: string;
}

// ─── AgentPanel ───────────────────────────────────────────────────────────────

function AgentPanel({ isOpen, onClose, isCollapsed }: { isOpen: boolean; onClose: () => void; isCollapsed: boolean }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<AgentForm>({
    AGENT_NAME: '',
    AGENT_DESCRIPTION: '',
    SYSTEM_PROMPT: '',
    DEFAULT_MODEL: '',
    MAX_STEPS: '50',
    TEMPERATURE: '1.0',
  });

  useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await apiFetch('/api/settings');
      const data = await res.json();
      setForm({
        AGENT_NAME: data.AGENT_NAME || '',
        AGENT_DESCRIPTION: data.AGENT_DESCRIPTION || '',
        SYSTEM_PROMPT: data.SYSTEM_PROMPT || '',
        DEFAULT_MODEL: data.DEFAULT_MODEL || '',
        MAX_STEPS: data.MAX_STEPS || '50',
        TEMPERATURE: data.TEMPERATURE || '1.0',
      });
      return data;
    },
    enabled: isOpen,
    staleTime: 0,
  });

  const { data: servers, isLoading: serversLoading } = useQuery<McpServer[]>({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await apiFetch('/api/servers');
      return res.json();
    },
    enabled: isOpen,
  });

  const toggleServer = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiFetch(`/api/servers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['servers'] }),
  });

  const handleSave = async () => {
    setSaving(true);
    for (const [key, value] of Object.entries(form)) {
      await apiFetch(`/api/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
    }
    queryClient.invalidateQueries({ queryKey: ['settings'] });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-0 left-0 h-full w-full max-w-sm bg-zinc-950 border-r border-white/5 shadow-2xl z-50 flex flex-col transition-all duration-200 ease-in-out">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-cyan-950/30 rounded-md">
              <Bot className="w-4 h-4 text-cyan-500" />
            </div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Configure Agent</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-md transition-colors">
            <X className="w-4 h-4 text-gray-500 hover:text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/5">
          {/* Identity */}
          <div className="px-4 py-4">
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-3">Identity</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Agent Name</label>
                <input
                  type="text"
                  value={form.AGENT_NAME}
                  onChange={(e) => setForm({ ...form, AGENT_NAME: e.target.value })}
                  placeholder="My Assistant"
                  className="w-full px-3 py-1.5 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Description</label>
                <input
                  type="text"
                  value={form.AGENT_DESCRIPTION}
                  onChange={(e) => setForm({ ...form, AGENT_DESCRIPTION: e.target.value })}
                  placeholder="A helpful coding assistant..."
                  className="w-full px-3 py-1.5 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* Personality */}
          <div className="px-4 py-4">
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-3">Personality</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">System Prompt</label>
                <textarea
                  value={form.SYSTEM_PROMPT}
                  onChange={(e) => setForm({ ...form, SYSTEM_PROMPT: e.target.value })}
                  placeholder="You are a helpful AI assistant..."
                  rows={5}
                  className="w-full px-3 py-1.5 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 resize-none font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">Model</label>
                  <input
                    type="text"
                    value={form.DEFAULT_MODEL}
                    onChange={(e) => setForm({ ...form, DEFAULT_MODEL: e.target.value })}
                    placeholder="claude-haiku-4-5"
                    className="w-full px-3 py-1.5 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">Temperature</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={form.TEMPERATURE}
                    onChange={(e) => setForm({ ...form, TEMPERATURE: e.target.value })}
                    className="w-full px-3 py-1.5 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Max Steps</label>
                <input
                  type="number"
                  value={form.MAX_STEPS}
                  onChange={(e) => setForm({ ...form, MAX_STEPS: e.target.value })}
                  className="w-full px-3 py-1.5 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* MCP Servers & Skills */}
          <div className="px-4 py-4">
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-3">MCP Servers &amp; Skills</p>
            {serversLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
              </div>
            ) : !servers || servers.length === 0 ? (
              <div className="py-4 text-center border border-white/5 border-dashed rounded-md bg-white/[0.02]">
                <p className="text-xs text-gray-500 mb-1">No MCP servers configured.</p>
                <Link to="/servers" onClick={onClose} className="text-xs text-cyan-500 hover:text-cyan-400 font-mono">
                  Add server &rarr;
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {servers.map((server) => (
                  <div key={server.id} className="flex items-center justify-between py-2 px-3 bg-black border border-white/5 rounded-md hover:bg-white/[0.02]">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-mono text-gray-300 truncate">{server.name}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                        {server.toolCount} tools &middot; {server.transport}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleServer.mutate({ id: server.id, enabled: !server.enabled })}
                      className={`ml-3 relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        server.enabled ? 'bg-cyan-600' : 'bg-gray-800'
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white transition duration-200 ease-in-out mt-[1px] ml-[1px] ${
                        server.enabled ? 'translate-x-3' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-white/5 bg-black">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white text-black rounded-md hover:bg-gray-200 disabled:opacity-50 text-sm font-bold font-mono uppercase tracking-wider transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<{ id: string, time: string, message: string, type: 'info' | 'success' | 'error' }[]>([]);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [isGlobalStreaming, setIsGlobalStreaming] = useState(false);

  const haltMutation = useMutation({
    mutationFn: async () => {
      await apiFetch('/api/mcp/halt', { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    }
  });

  useEffect(() => {
    if (inspectorRef.current) {
      inspectorRef.current.scrollTop = inspectorRef.current.scrollHeight;
    }
  }, [executionLogs]);

  useEffect(() => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('openmacaw-theme', 'dark');

    const handleExecution = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { action, calls, error } = customEvent.detail;
      const time = new Date().toISOString().split('T')[1].split('.')[0];
      
      const newLogs = calls.map((c: any, i: number) => {
        let message = '';
        let type: 'info' | 'success' | 'error' = 'info';
        
        if (action === 'START') {
          message = `Executing ${c.name}...`;
        } else if (action === 'SUCCESS') {
          message = `${c.name} completed successfully.`;
          type = 'success';
        } else if (action === 'FAILED') {
          message = `${c.name} failed: ${error}`;
          type = 'error';
        }

        return {
          id: `${Date.now()}-${i}`,
          time,
          message,
          type
        };
      });

      setExecutionLogs(prev => [...prev, ...newLogs].slice(-50)); // Keep last 50 logs
    };

    const handleStreamingStatus = (e: Event) => {
      const customEvent = e as CustomEvent;
      setIsGlobalStreaming(customEvent.detail);
    };

    window.addEventListener('openmacaw:executing', handleExecution);
    window.addEventListener('openmacaw:streaming', handleStreamingStatus);
    return () => {
      window.removeEventListener('openmacaw:executing', handleExecution);
      window.removeEventListener('openmacaw:streaming', handleStreamingStatus);
    };
  }, []);

  const navItems = [
    { path: '/chat', label: 'Chat', icon: MessageSquare },
    { path: '/servers', label: 'Servers', icon: Server },
    { path: '/activity', label: 'Audit Log', icon: Activity },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  const handleNewChat = () => {
    window.dispatchEvent(new CustomEvent('openmacaw:new-chat'));
  };

  const { data: servers } = useQuery<McpServer[]>({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await apiFetch('/api/servers');
      return res.json();
    }
  });

  return (
    <>
      <AgentPanel isOpen={isAgentPanelOpen} onClose={() => setIsAgentPanelOpen(false)} isCollapsed={false} />

      <div className="flex h-screen bg-black text-gray-200 overflow-hidden font-sans">

        {/* ── Left Pane (Thin: Nav & Servers) ── */}
        <aside className="w-56 flex flex-col bg-zinc-950 border-r border-white/5 shrink-0">
          <div className="h-12 flex items-center px-4 border-b border-white/5 gap-2">
            <Shield className="w-4 h-4 text-cyan-500" />
            <span className="font-bold text-white text-sm">OpenMacaw</span>
          </div>

          <nav className="p-2 space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  title={item.label}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                    isActive ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mx-2 my-1 border-t border-white/5" />

          <div className="flex-1 overflow-y-auto p-2">
            <div className="px-1 mb-2">
              <span className="text-[10px] uppercase font-mono tracking-wider text-gray-500 flex items-center gap-1.5"><ShieldCheck className="w-3 h-3 text-cyan-500" /> Active Servers</span>
            </div>
            <div className="space-y-0.5">
              {servers?.filter(s => s.status === 'running' || s.status === 'paused').map((server) => (
                <div 
                  key={server.id} 
                  onClick={() => {
                    console.log('Opening drawer for:', server.id);
                    setSelectedServerId(server.id);
                  }}
                  className="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer hover:bg-white/10 transition-colors group"
                >
                  <span className="text-xs font-mono text-gray-400 group-hover:text-gray-300 truncate"><span className="hidden group-hover:inline absolute -ml-4 text-cyan-500"><Settings2 className="w-3 h-3 inline pb-[1px]" /></span>{server.name}</span>
                  <div title={server.status} className={`w-1.5 h-1.5 rounded-full shrink-0 ${server.status === 'running' ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]' : 'bg-yellow-500'}`} />
                </div>
              ))}
              {(!servers || servers.filter(s => s.status === 'running' || s.status === 'paused').length === 0) && (
                <div className="text-[10px] text-gray-500 italic px-1">No active servers</div>
              )}
            </div>
          </div>
          
          <div className="px-2 pb-2">
            <button 
              onClick={() => haltMutation.mutate()}
              disabled={haltMutation.isPending || !isGlobalStreaming}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 border rounded text-xs font-bold uppercase tracking-wider transition-all
               ${isGlobalStreaming 
                 ? 'bg-rose-950/40 text-rose-500 border-rose-500/50 hover:bg-rose-900/60 hover:text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)] animate-[pulse_2s_ease-in-out_infinite]' 
                 : 'bg-zinc-900/50 text-gray-500 border-white/10 opacity-50 cursor-not-allowed'
               }
             `}
            >
              <AlertOctagon className="w-4 h-4" />
              {haltMutation.isPending ? 'Halting...' : 'Halt All'}
            </button>
          </div>

          <div className="p-2 border-t border-white/5 space-y-1">
            <button
              onClick={() => setIsAgentPanelOpen(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-gray-400 hover:bg-white/5 hover:text-gray-200 transition-colors"
            >
              <Bot className="w-4 h-4 shrink-0" />
              <span className="font-medium text-left">Configure Agent</span>
            </button>
            {location.pathname.startsWith('/chat') && (
              <button
                onClick={handleNewChat}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-cyan-400 hover:bg-cyan-950/30 hover:text-cyan-300 transition-colors"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span className="font-medium text-left">New Chat</span>
              </button>
            )}
          </div>
        </aside>

        {/* ── Middle Pane (Wide: Main Interaction) ── */}
        <main className="flex-1 flex flex-col min-w-0 bg-black z-0 relative">
          <Outlet />
        </main>

        {/* ── Right Pane (Medium: Audit/Inspector) ── */}
        <aside className="w-80 hidden lg:flex flex-col bg-zinc-950 border-l border-white/5 shrink-0 z-10">
          <div className="h-12 flex items-center justify-between px-4 border-b border-white/5 bg-black">
            <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Inspector</span>
            <Activity className="w-3.5 h-3.5 text-gray-500" />
          </div>
          <div 
            ref={inspectorRef}
            className="flex-1 p-3 font-mono text-[11px] text-gray-500 overflow-y-auto space-y-2 selection:bg-cyan-900/40"
          >
            {executionLogs.length === 0 ? (
              <>
                <div className="flex gap-2">
                  <span className="text-gray-600">[{new Date().toISOString().split('T')[1].split('.')[0]}]</span>
                  <span className="text-cyan-700">SYSTEM_INIT</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-gray-600">[{new Date().toISOString().split('T')[1].split('.')[0]}]</span>
                  <span className="text-gray-400">Waiting for agent activity...</span>
                </div>
              </>
            ) : (
              executionLogs.map(log => (
                <div key={log.id} className="flex gap-2 leading-relaxed">
                  <span className="text-gray-600 shrink-0">[{log.time}]</span>
                  <span className={`${
                    log.type === 'success' ? 'text-green-500' :
                    log.type === 'error' ? 'text-red-500' :
                    'text-cyan-400 animate-pulse'
                  }`}>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </aside>

      </div>
      
      {/* Global Overlay: Server Permission Drawer */}
      <AnimatePresence>
        {selectedServerId && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" 
              onClick={() => setSelectedServerId(null)} 
            />
            <ServerPermissionDrawer serverId={selectedServerId} onClose={() => setSelectedServerId(null)} />
          </>
        )}
      </AnimatePresence>
    </>
  );
}

export default App;

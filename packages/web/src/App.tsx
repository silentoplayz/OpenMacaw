import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Server, Activity, Settings, Bird,
  ChevronLeft, ChevronRight, Bot, Plus, X, Save, Loader2, Menu, Moon, Sun, PenSquare,
  ShieldCheck, Settings2, AlertOctagon, Copy, ChevronDown, ChevronUp, Cpu, Clock, Hash, Workflow, BookMarked, Trash2, LogOut, User as UserIcon, ShieldAlert, CheckCircle2, Circle, Crosshair, Target,
  MoreHorizontal, Pin, Download, Edit2, FolderClosed, FolderOpen, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Zap
} from 'lucide-react';
import { apiFetch } from './api';
import { ServerPermissionDrawer } from './components/ServerPermissionDrawer';
import { UserMenu } from './components/UserMenu';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from './contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentForm {
  AGENT_NAME: string;
  AGENT_DESCRIPTION: string;
  PERSONALITY: string;
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
    PERSONALITY: '',
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
        PERSONALITY: data.PERSONALITY || '',
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
                <label className="block text-xs font-mono text-gray-400 mb-1">Personality</label>
                <textarea
                  value={form.PERSONALITY}
                  onChange={(e) => setForm({ ...form, PERSONALITY: e.target.value })}
                  placeholder="Describe the agent's personality and style..."
                  rows={5}
                  className="w-full px-3 py-1.5 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 resize-none font-mono"
                />
                <p className="mt-1 text-[10px] text-gray-600 font-mono leading-relaxed">
                  Appended to the base system prompt — does not replace it.
                </p>
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
                      className={`ml-3 relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${server.enabled ? 'bg-cyan-600' : 'bg-gray-800'
                        }`}
                    >
                      <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white transition duration-200 ease-in-out mt-[1px] ml-[1px] ${server.enabled ? 'translate-x-3' : 'translate-x-0'
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false);
  // Mobile overlay nav — starts closed; desktop sidebar is always visible.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<{ id: string, time: string, message: string, type: 'info' | 'success' | 'error' }[]>([]);
  const inspectorRef = useRef<HTMLDivElement>(null);
  
  // Custom Deletion Modal State
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [isGlobalStreaming, setIsGlobalStreaming] = useState(false);
  const { user, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);

  // Sidebar grouping & layout state
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('openmacaw:sidebar-open');
      if (saved) return JSON.parse(saved);
    } catch { }
    return true;
  });

  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('openmacaw:sidebar-folders');
      if (saved) return JSON.parse(saved);
    } catch { }
    return {};
  });

  // Context Menu State
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const [isInspectorOpen, setIsInspectorOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('openmacaw:inspector-open');
      if (saved) return JSON.parse(saved);
    } catch { }
    return true;
  });

  const toggleInspector = () => {
    setIsInspectorOpen((prev: boolean) => {
      const next = !prev;
      localStorage.setItem('openmacaw:inspector-open', JSON.stringify(next));
      return next;
    });
  };

  const isChatRoute = location.pathname === '/' || location.pathname.startsWith('/chat');

  // ── Modals & Dialogues Keyboard Bindings ──
  useEffect(() => {
    if (!sessionToDelete) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSessionToDelete(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        deleteSessionMutation.mutate(sessionToDelete);
        setSessionToDelete(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionToDelete]);

  // Close context menu on outside click or scroll
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && menuRef.current.contains(event.target as Node)) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest('.sidebar-context-btn')) {
        return;
      }
      setActiveMenuId(null);
    }
    
    function handleScroll() {
      setActiveMenuId(null);
    }

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true); // capture phase to catch internal scrollable divs
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  const toggleSidebar = () => {
    setIsSidebarOpen((prev: boolean) => {
      const next = !prev;
      localStorage.setItem('openmacaw:sidebar-open', JSON.stringify(next));
      return next;
    });
  };

  const toggleFolder = (folderName: string) => {
    setCollapsedFolders(prev => {
      const next = { ...prev, [folderName]: !prev[folderName] };
      localStorage.setItem('openmacaw:sidebar-folders', JSON.stringify(next));
      return next;
    });
  };

  // Inspector state
  const [sessionInfo, setSessionInfo] = useState<{ model: string; sessionId: string } | null>(null);
  const [telemetry, setTelemetry] = useState<{ inputTokens: number; outputTokens: number; responseTimeMs: number } | null>(null);
  const [inspectorEntries, setInspectorEntries] = useState<
    { id: string; time: string; message: string; type: 'info' | 'success' | 'error'; jsonPayload?: any }[]
  >([]);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  // Pipeline Mission Control state
  const [pipelineState, setPipelineState] = useState<{
    status: 'running' | 'done' | 'cancelled';
    runId: string;
    goal: string;
    plan: { id: string; description: string; tool?: string }[];
    stepProgress: Record<number, string>;
    currentTool?: string;
  } | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

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

    const handleSessionInfo = (e: Event) => {
      const { model, sessionId } = (e as CustomEvent).detail;
      setSessionInfo({ model, sessionId });
    };
    const handleTelemetry = (e: Event) => {
      setTelemetry((e as CustomEvent).detail);
    };
    const handleInspector = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const time = new Date().toISOString().split('T')[1].split('.')[0];
      setInspectorEntries(prev => [
        ...prev,
        {
          id: `insp-${Date.now()}`,
          time,
          message: `Proposal: ${detail.tool}`,
          type: 'info' as const,
          jsonPayload: detail.input,
        }
      ].slice(-30));
    };

    const handlePipeline = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setPipelineState(detail);
      // Auto-clear after done/cancelled with a short delay for visual feedback
      if (detail.status === 'done' || detail.status === 'cancelled') {
        setTimeout(() => setPipelineState(null), 8000);
      }
    };

    window.addEventListener('openmacaw:session_info', handleSessionInfo);
    window.addEventListener('openmacaw:telemetry', handleTelemetry);
    window.addEventListener('openmacaw:inspector', handleInspector);
    window.addEventListener('openmacaw:pipeline', handlePipeline);

    return () => {
      window.removeEventListener('openmacaw:executing', handleExecution);
      window.removeEventListener('openmacaw:streaming', handleStreamingStatus);
      window.removeEventListener('openmacaw:session_info', handleSessionInfo);
      window.removeEventListener('openmacaw:telemetry', handleTelemetry);
      window.removeEventListener('openmacaw:inspector', handleInspector);
      window.removeEventListener('openmacaw:pipeline', handlePipeline);
    };
  }, []);

  const navItems = [
    { path: '/chat', label: 'Chat', icon: MessageSquare },
    { path: '/servers', label: 'Servers', icon: Server },
    { path: '/skills', label: 'Skills', icon: Zap },
    { path: '/catalog', label: 'Catalog', icon: BookMarked },
    { path: '/activity', label: 'Audit Log', icon: Activity },
    { path: '/pipelines', label: 'Pipelines', icon: Workflow },
    ...(user?.role === 'admin' ? [{ path: '/admin', label: 'Admin', icon: Settings2 }] : []),
  ];

  const handleNewChat = () => {
    navigate('/chat');
    setMobileNavOpen(false);
    window.dispatchEvent(new CustomEvent('openmacaw:new-chat'));
  };

  const { data: servers } = useQuery<McpServer[]>({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await apiFetch('/api/servers');
      return res.json();
    }
  });

  const { data: chatSessions } = useQuery<{ id: string; title: string; isPinned: boolean; createdAt: string }[]>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await apiFetch('/api/sessions');
      return res.json();
    },
    refetchInterval: 10_000,
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setActiveMenuId(null);
    },
  });

  const updateSessionMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string, updates: any }) => {
      await apiFetch(`/api/sessions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setActiveMenuId(null);
      setRenamingId(null);
    },
  });

  const handleDownloadSession = async (id: string, title: string) => {
    try {
      const res = await apiFetch(`/api/sessions/${id}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setActiveMenuId(null);
    } catch (e) {
      console.error('Download failed', e);
    }
  };

  const groupSessions = (sessions: { id: string; title: string; isPinned: boolean; createdAt: string }[]) => {
    const groups: Record<string, typeof sessions> = {
      Pinned: [],
      Today: [],
      Yesterday: [],
      'Previous 7 Days': [],
      Older: []
    };
    
    if (!sessions) return groups;

    const now = new Date();
    // Reset to start of day for accurate bucket comparison
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const lastWeek = today - (86400000 * 7);

    // Sort descending by creation date
    const sorted = [...sessions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    sorted.forEach(s => {
      if (s.isPinned) {
        groups['Pinned'].push(s);
        return;
      }
      const t = new Date(s.createdAt).getTime();
      if (t >= today) groups['Today'].push(s);
      else if (t >= yesterday) groups['Yesterday'].push(s);
      else if (t >= lastWeek) groups['Previous 7 Days'].push(s);
      else groups['Older'].push(s);
    });

    return groups;
  };

  const groupedSessions = groupSessions(chatSessions || []);

  // Extract the active session id from the URL (e.g. /chat/SESSION_ID).
  const activeChatId = location.pathname.match(/^\/chat\/(.+)/)?.[1] ?? null;
  const chatActive = location.pathname.startsWith('/chat');

  return (
    <>
      <AgentPanel isOpen={isAgentPanelOpen} onClose={() => setIsAgentPanelOpen(false)} isCollapsed={false} />

      {/* ── Mobile top bar (hamburger + logo) — hidden on lg+ ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-12 bg-zinc-950 border-b border-white/5 flex items-center px-3 gap-3 z-30">
        <button
          onClick={() => setMobileNavOpen(v => !v)}
          className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Toggle menu"
        >
          {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <Bird className="w-4 h-4 text-cyan-500 shrink-0" />
        <span className="font-bold text-white text-sm">OpenMacaw</span>
      </div>

      {/* ── Mobile backdrop ── */}
      {mobileNavOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-30 backdrop-blur-sm"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <div className="flex h-screen bg-black text-gray-200 overflow-hidden font-sans">

        {/* ── Left sidebar — always visible on desktop, overlay on mobile ── */}
        <aside className={[
          'flex flex-col bg-zinc-950 border-r border-white/5 shrink-0 z-40 overflow-x-hidden',
          'transition-all duration-300 ease-in-out',
          // Mobile: fixed overlay, slides in/out. Fixed width 224px (w-56)
          'fixed inset-y-0 left-0 shadow-2xl w-56',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: in flex flow
          'md:relative md:translate-x-0 md:shadow-none',
          isSidebarOpen ? 'md:w-64 opacity-100' : 'md:w-16 opacity-100'
        ].join(' ')}>

          {/* Logo & Toggle - Morphing Header */}
          {isSidebarOpen ? (
            <div className="flex items-center h-14 border-b border-white/5 shrink-0 px-4 justify-between">
              <div className="flex items-center gap-2">
                <Bird className="w-4 h-4 text-cyan-500 shrink-0" />
                <span className="font-bold text-white text-sm whitespace-nowrap">OpenMacaw</span>
              </div>
              <button
                onClick={toggleSidebar}
                className="hidden md:flex p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/10 transition-colors"
                title="Close Sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div 
              className="flex items-center justify-center h-14 border-b border-white/5 shrink-0 cursor-pointer group"
              onClick={toggleSidebar}
              onMouseEnter={() => setIsHeaderHovered(true)}
              onMouseLeave={() => setIsHeaderHovered(false)}
              title="Expand Sidebar"
            >
              <div className="relative w-5 h-5 flex items-center justify-center">
                <Bird 
                  className={`w-5 h-5 text-cyan-500 absolute top-0 left-0 transition-opacity duration-200 ${isHeaderHovered ? 'opacity-0' : 'opacity-100'}`} 
                />
                <PanelLeftOpen 
                  className={`w-5 h-5 text-gray-400 absolute top-0 left-0 transition-opacity duration-200 ${isHeaderHovered ? 'opacity-100' : 'opacity-0'}`} 
                />
              </div>
            </div>
          )}

          {/* New Chat — top of sidebar, always visible */}
          <div className={`pt-2 pb-1 shrink-0 ${isSidebarOpen ? 'px-2' : 'px-0 flex justify-center'}`}>
            <button
              onClick={() => { handleNewChat(); setMobileNavOpen(false); }}
              title="New Chat"
              className={`flex items-center rounded-lg text-sm font-medium bg-white/5 border border-white/5 text-gray-300 hover:bg-cyan-950/40 hover:border-cyan-500/20 hover:text-cyan-300 transition-all ${isSidebarOpen ? 'w-full gap-2 px-3 py-2' : 'p-2'}`}
            >
              <PenSquare className="w-4 h-4 shrink-0" />
              <span className={`whitespace-nowrap ${!isSidebarOpen ? 'hidden' : 'hidden md:inline-block'}`}>New Chat</span>
            </button>
          </div>

          {/* Nav items — Chat item expands to show sessions when active */}
          <nav className={`p-2 space-y-0.5 ${!isSidebarOpen && 'flex flex-col items-center'}`}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);
              const isChat = item.path === '/chat';
              return (
                <div key={item.path} className={!isSidebarOpen ? 'w-full flex justify-center' : ''}>
                  <Link
                    to={item.path}
                    title={item.label}
                    onClick={() => setMobileNavOpen(false)}
                    className={`flex items-center rounded-md text-sm transition-colors ${isActive ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'} ${isSidebarOpen ? 'gap-2 px-2 py-1.5' : 'p-2 justify-center'}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className={`font-medium whitespace-nowrap ${!isSidebarOpen ? 'hidden' : 'hidden md:inline-block'}`}>{item.label}</span>
                  </Link>

                  {/* Chat sessions submenu — grouped workspaces */}
                  {isChat && chatActive && isSidebarOpen && (
                    <div className="mt-1 overflow-y-auto space-y-1 pb-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                      {chatSessions && chatSessions.length === 0 ? (
                        <div className="px-4 py-3 text-center">
                          <p className="text-xs text-gray-500 italic">No conversations yet.</p>
                        </div>
                      ) : (
                        Object.entries(groupedSessions).map(([groupName, groupSessions]) => {
                          if (groupSessions.length === 0) return null;
                          const isCollapsed = collapsedFolders[groupName];

                          return (
                            <div key={groupName} className="mb-2">
                              {/* Folder Header */}
                              <div
                                onClick={() => toggleFolder(groupName)}
                                className="group flex items-center gap-1.5 px-3 py-1 cursor-pointer hover:bg-white/[0.02] rounded-md transition-colors"
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="w-3 h-3 text-gray-500 group-hover:text-gray-400" />
                                ) : (
                                  <ChevronDown className="w-3 h-3 text-gray-500 group-hover:text-gray-400" />
                                )}
                                <span className="text-[10px] font-mono tracking-wider font-bold uppercase text-gray-500 group-hover:text-gray-300">
                                  {groupName}
                                </span>
                              </div>

                              {/* Folder Contents */}
                              <AnimatePresence initial={false}>
                                {!isCollapsed && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="space-y-0.5 mt-0.5 ml-2 border-l border-white/5 pl-1.5">
                                      {groupSessions.map(session => {
                                        const isActive = activeChatId === session.id;
                                        const isRenaming = renamingId === session.id;

                                        return (
                                          <div
                                            key={session.id}
                                            className={`relative group flex items-center gap-1 pl-2 pr-1 py-1 rounded-md text-xs transition-colors ${isActive
                                              ? 'bg-cyan-500/10 text-cyan-400'
                                              : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                                              }`}
                                          >
                                            {session.isPinned && groupName !== 'Pinned' && (
                                              <Pin className="w-3 h-3 shrink-0 text-cyan-500" />
                                            )}

                                            {isRenaming ? (
                                              <input
                                                autoFocus
                                                type="text"
                                                value={renameValue}
                                                onChange={e => setRenameValue(e.target.value)}
                                                onBlur={() => {
                                                  // setTimeout prevents aggressive Firefox blur from dismissing immediately during click events
                                                  setTimeout(() => {
                                                    if (renameValue.trim() && renameValue !== session.title) {
                                                      updateSessionMutation.mutate({ id: session.id, updates: { title: renameValue } });
                                                    } else {
                                                      setRenamingId(null);
                                                    }
                                                  }, 100);
                                                }}
                                                onKeyDown={e => {
                                                  if (e.key === 'Enter') {
                                                    if (renameValue.trim() && renameValue !== session.title) {
                                                      updateSessionMutation.mutate({ id: session.id, updates: { title: renameValue } });
                                                    } else {
                                                      setRenamingId(null);
                                                    }
                                                  } else if (e.key === 'Escape') {
                                                    setRenamingId(null);
                                                  }
                                                }}
                                                className="flex-1 min-w-0 bg-black border border-cyan-500/50 rounded px-1 text-cyan-400 outline-none"
                                              />
                                            ) : (
                                              <Link
                                                to={`/chat/${session.id}`}
                                                onClick={() => setMobileNavOpen(false)}
                                                className="flex-1 truncate min-w-0 py-0.5"
                                                title={session.title}
                                              >
                                                {session.title}
                                              </Link>
                                            )}

                                            {/* Context Menu Button */}
                                            {!isRenaming && (
                                              <div className="relative shrink-0">
                                                <button
                                                  onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    if (activeMenuId === session.id) {
                                                      setActiveMenuId(null);
                                                    } else {
                                                      const rect = e.currentTarget.getBoundingClientRect();
                                                      setMenuPosition({
                                                        top: rect.bottom + window.scrollY + 4,
                                                        left: rect.right + window.scrollX - 144 // approx width of 36 (144px)
                                                      });
                                                      setActiveMenuId(session.id);
                                                    }
                                                  }}
                                                  className={`sidebar-context-btn p-1 rounded transition-all ${activeMenuId === session.id ? 'opacity-100 text-white bg-white/10' : 'opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10'
                                                    }`}
                                                >
                                                  <MoreHorizontal className="w-3.5 h-3.5 flex-shrink-0" />
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="mx-2 my-1 border-t border-white/5" />

          {/* Active Servers Block — completely unmount on Slim Dock */}
          {isSidebarOpen && (
            <div className="flex-1 overflow-y-auto p-2">
              <div className="px-1 mb-2">
                <span className="text-[10px] uppercase font-mono tracking-wider text-gray-500 flex items-center gap-1.5 whitespace-nowrap">
                  <CheckCircle2 className="w-3 h-3 text-cyan-500" /> Active Servers
                </span>
              </div>
              <div className="space-y-0.5">
                {servers?.filter(s => s.status === 'running' || s.status === 'paused').map((server) => (
                  <div
                    key={server.id}
                    onClick={() => { setSelectedServerId(server.id); setMobileNavOpen(false); }}
                    className="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer hover:bg-white/10 transition-colors group"
                  >
                    <span className="text-xs font-mono text-gray-400 group-hover:text-gray-300 truncate flex-1 min-w-0 mr-2 whitespace-nowrap">
                      {server.name}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Settings2 className="w-3 h-3 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity text-cyan-500" />
                      <div title={server.status} className={`w-1.5 h-1.5 rounded-full ${server.status === 'running' ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]' : 'bg-yellow-500'}`} />
                    </div>
                  </div>
                ))}
                {(!servers || servers.filter(s => s.status === 'running' || s.status === 'paused').length === 0) && (
                  <div className="text-[10px] text-gray-500 italic px-1 whitespace-nowrap">No active servers</div>
                )}
              </div>
            </div>
          )}

          <div className="mt-auto shrink-0 flex flex-col space-y-1 mt-2">
            
            {/* Halt All / Emergency Stop */}
            <div className={`px-2 ${!isSidebarOpen && 'flex justify-center'}`}>
              <button
                onClick={() => haltMutation.mutate()}
                disabled={haltMutation.isPending || !isGlobalStreaming}
                title="Halt All Streams"
                className={`flex items-center justify-center rounded text-xs font-bold uppercase tracking-wider transition-all
                  ${isSidebarOpen ? 'w-full gap-2 px-3 py-2 border' : 'p-2 border'}
                  ${isGlobalStreaming
                    ? 'bg-rose-950/40 text-rose-500 border-rose-500/50 hover:bg-rose-900/60 hover:text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)] animate-[pulse_2s_ease-in-out_infinite]'
                    : 'bg-zinc-900/50 text-gray-500 border-white/10 opacity-50 cursor-not-allowed'
                  }`}
              >
                <AlertOctagon className="w-4 h-4 shrink-0" />
                <span className={`transition-opacity duration-300 whitespace-nowrap ${!isSidebarOpen && 'hidden md:block md:opacity-0 md:w-0 md:overflow-hidden'}`}>
                  {haltMutation.isPending ? 'Halting...' : 'Halt All'}
                </span>
              </button>
            </div>

            {/* Configure Agent */}
            <div className={`px-2 border-t border-white/5 pt-2 ${!isSidebarOpen && 'flex justify-center'}`}>
              <button
                onClick={() => { setIsAgentPanelOpen(true); setMobileNavOpen(false); }}
                title="Configure Agent"
                className={`flex items-center rounded-md text-sm text-gray-400 hover:bg-white/5 hover:text-gray-200 transition-colors
                  ${isSidebarOpen ? 'w-full gap-2 px-2 py-1.5' : 'p-2'}`}
              >
                <Bot className="w-4 h-4 shrink-0" />
                <span className={`font-medium transition-opacity duration-300 whitespace-nowrap ${!isSidebarOpen && 'hidden md:block md:opacity-0 md:w-0 md:overflow-hidden'}`}>
                  Configure Agent
                </span>
              </button>
            </div>

            {/* User Profile / Logout (Portal injected) */}
            <UserMenu 
              user={user} 
              isSidebarOpen={isSidebarOpen} 
              logout={logout} 
              setMobileNavOpen={setMobileNavOpen} 
            />

          </div>
        </aside>

        {/* ── Middle Pane ── */}
        <main className="flex-1 flex flex-col min-w-0 bg-black z-0 relative pt-12 md:pt-0 delay-150 duration-300 transition-all">
          <Outlet />

          {/* Open Inspector Button (Desktop only, when closed, on Chat routes) */}
          {!isInspectorOpen && isChatRoute && (
            <button
              onClick={toggleInspector}
              className="hidden md:flex fixed top-3 right-4 z-20 p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/10 transition-colors border border-white/5 bg-black/50 backdrop-blur-sm shadow-lg"
              title="Open Inspector"
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
          )}
        </main>

        {/* ── Right Pane: Glass Box Inspector ── */}
        <AnimatePresence mode="wait">
          {isInspectorOpen && isChatRoute && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="hidden md:flex flex-col bg-zinc-950 border-l border-white/5 shrink-0 z-10 overflow-hidden"
            >
              {/* Inspector Header */}
              <div className="h-12 flex items-center justify-between px-4 border-b border-white/5 bg-black shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
                    {pipelineState ? 'Mission Control' : 'Inspector'}
                  </span>
                  {pipelineState?.status === 'running' && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      <span className="text-[9px] font-mono text-cyan-400 animate-pulse">LIVE</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {pipelineState ? (
                    <Target className={`w-3.5 h-3.5 ${pipelineState.status === 'running' ? 'text-cyan-400 animate-spin' :
                        pipelineState.status === 'done' ? 'text-green-400' : 'text-rose-400'
                      }`} />
                  ) : (
                    <Activity className="w-3.5 h-3.5 text-gray-500" />
                  )}
                  <button
                    onClick={toggleInspector}
                    className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
                    title="Close Inspector"
                  >
                    <PanelRightClose className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Top Section: Active Session State */}
              <div className="px-4 py-3 border-b border-white/5 space-y-1.5 bg-black/50 shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-gray-600">Session State</span>
                  <Cpu className="w-3 h-3 text-gray-600" />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-gray-500">Model</span>
                  <span className="text-cyan-400 truncate max-w-[140px]">{sessionInfo?.model || '—'}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-gray-500">Session</span>
                  <button
                    onClick={() => {
                      if (sessionInfo?.sessionId) {
                        navigator.clipboard.writeText(sessionInfo.sessionId);
                      }
                    }}
                    className="flex items-center gap-1 text-gray-400 hover:text-cyan-400 transition-colors group"
                    title="Click to copy full ID"
                  >
                    <span className="truncate max-w-[100px] text-[11px]">{sessionInfo?.sessionId?.slice(0, 12) || '—'}…</span>
                    <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                </div>
              </div>

              {/* Middle Section: Pipeline Roadmap OR Live Event Stream */}
              <div
                ref={inspectorRef}
                className="flex-1 overflow-y-auto selection:bg-cyan-900/40 w-full"
              >
                <AnimatePresence mode="wait">
                  {pipelineState ? (
                    /* ── Mission Control: Pipeline Roadmap ── */
                    <motion.div
                      key="pipeline-roadmap"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.3 }}
                      className="p-3 space-y-3"
                    >
                      {/* Goal Header */}
                      <div className={`rounded-lg p-3 border ${pipelineState.status === 'running'
                          ? 'bg-violet-950/30 border-violet-500/20'
                          : pipelineState.status === 'done'
                            ? 'bg-green-950/30 border-green-500/20'
                            : 'bg-rose-950/30 border-rose-500/20'
                        }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Crosshair className={`w-3.5 h-3.5 ${pipelineState.status === 'running' ? 'text-violet-400' :
                              pipelineState.status === 'done' ? 'text-green-400' : 'text-rose-400'
                            }`} />
                          <span className="text-[9px] font-mono uppercase tracking-wider text-gray-500">
                            {pipelineState.status === 'running' ? 'Active Goal' :
                              pipelineState.status === 'done' ? 'Completed' : 'Cancelled'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-300 leading-relaxed line-clamp-3">
                          {pipelineState.goal || 'Autonomous pipeline'}
                        </p>
                      </div>

                      {/* Step Roadmap */}
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] font-mono uppercase tracking-widest text-gray-600">Pipeline Roadmap</span>
                          <span className="text-[9px] font-mono text-gray-600">
                            {Object.values(pipelineState.stepProgress).filter(s => s === 'done').length}/{pipelineState.plan.length}
                          </span>
                        </div>

                        {pipelineState.plan.map((step, idx) => {
                          const status = pipelineState.stepProgress[idx] || 'pending';
                          const isActive = status === 'running';
                          const isDone = status === 'done';
                          const isError = status === 'error';
                          const isExpanded = expandedSteps.has(idx);

                          return (
                            <motion.div
                              key={step.id || idx}
                              layout
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.2, delay: idx * 0.05 }}
                            >
                              <button
                                onClick={() => {
                                  if (isDone || isError) {
                                    setExpandedSteps(prev => {
                                      const next = new Set(prev);
                                      next.has(idx) ? next.delete(idx) : next.add(idx);
                                      return next;
                                    });
                                  }
                                }}
                                className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-300 ${isActive
                                    ? 'bg-cyan-950/30 border border-cyan-500/20'
                                    : isDone
                                      ? 'bg-white/[0.02] border border-transparent hover:bg-white/[0.04] cursor-pointer'
                                      : isError
                                        ? 'bg-rose-950/20 border border-rose-500/10 hover:bg-rose-950/30 cursor-pointer'
                                        : 'bg-transparent border border-transparent opacity-50'
                                  }`}
                              >
                                {/* Status Icon with AnimatePresence */}
                                <div className="w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center">
                                  <AnimatePresence mode="wait">
                                    {isDone ? (
                                      <motion.div
                                        key={`done-${idx}`}
                                        initial={{ scale: 0, rotate: -90 }}
                                        animate={{ scale: 1, rotate: 0 }}
                                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                                      >
                                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                                      </motion.div>
                                    ) : isActive ? (
                                      <motion.div
                                        key={`active-${idx}`}
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        className="relative"
                                      >
                                        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                                      </motion.div>
                                    ) : isError ? (
                                      <motion.div
                                        key={`error-${idx}`}
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                      >
                                        <X className="w-4 h-4 text-rose-400" />
                                      </motion.div>
                                    ) : (
                                      <Circle className="w-3.5 h-3.5 text-gray-700" />
                                    )}
                                  </AnimatePresence>
                                </div>

                                {/* Step Content */}
                                <div className="flex-1 min-w-0">
                                  <span className={`text-[11px] leading-relaxed font-mono transition-colors duration-500 ${isActive ? 'text-cyan-400' :
                                      isDone ? 'text-zinc-500' :
                                        isError ? 'text-rose-400' :
                                          'text-gray-600'
                                    }`}>
                                    {step.description}
                                  </span>

                                  {/* Active step: show current tool badge */}
                                  {isActive && pipelineState.currentTool && (
                                    <motion.div
                                      initial={{ opacity: 0, y: -4 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      className="mt-1 flex items-center gap-1"
                                    >
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/50 text-cyan-500 font-mono border border-cyan-500/20">
                                        {pipelineState.currentTool.includes('__')
                                          ? pipelineState.currentTool.split('__')[1]
                                          : pipelineState.currentTool}
                                      </span>
                                    </motion.div>
                                  )}

                                  {/* Expanded detail for completed/error steps */}
                                  <AnimatePresence>
                                    {isExpanded && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="mt-1.5 pt-1.5 border-t border-white/5 space-y-1">
                                          {step.tool && (
                                            <div className="flex items-center gap-1">
                                              <span className="text-[9px] text-gray-600 font-mono">Tool:</span>
                                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-950/50 text-violet-400 font-mono border border-violet-500/20">
                                                {step.tool}
                                              </span>
                                            </div>
                                          )}
                                          <div className="flex items-center gap-1">
                                            <span className="text-[9px] text-gray-600 font-mono">Status:</span>
                                            <span className={`text-[9px] font-mono ${isDone ? 'text-green-500' : 'text-rose-400'
                                              }`}>
                                              {isDone ? 'Completed ✓' : 'Failed ✗'}
                                            </span>
                                          </div>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>

                                {/* Step number */}
                                <span className={`text-[9px] font-mono shrink-0 mt-0.5 ${isActive ? 'text-cyan-500' :
                                    isDone ? 'text-zinc-600' : 'text-gray-700'
                                  }`}>
                                  {idx + 1}
                                </span>
                              </button>
                            </motion.div>
                          );
                        })}
                      </div>

                      {/* Pipeline Status Footer */}
                      {pipelineState.status !== 'running' && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-mono uppercase tracking-wider ${pipelineState.status === 'done'
                              ? 'bg-green-950/20 text-green-500 border border-green-500/10'
                              : 'bg-rose-950/20 text-rose-500 border border-rose-500/10'
                            }`}
                        >
                          {pipelineState.status === 'done' ? (
                            <><CheckCircle2 className="w-3 h-3" /> Pipeline Complete</>
                          ) : (
                            <><X className="w-3 h-3" /> Pipeline Cancelled</>
                          )}
                        </motion.div>
                      )}
                    </motion.div>
                  ) : (
                    /* ── Default: Generic Log View ── */
                    <motion.div
                      key="log-view"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="p-3 font-mono text-[11px] text-gray-500 space-y-1.5 w-full"
                    >
                      {executionLogs.length === 0 && inspectorEntries.length === 0 ? (
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
                        <>
                          {executionLogs.map(log => (
                            <div key={log.id} className="flex gap-2 leading-relaxed">
                              <span className="text-gray-600 shrink-0">[{log.time}]</span>
                              <span className={`${log.type === 'success' ? 'text-green-500' :
                                  log.type === 'error' ? 'text-red-500' :
                                    'text-cyan-400 animate-pulse'
                                }`}>{log.message}</span>
                            </div>
                          ))}
                          {inspectorEntries.map(entry => (
                            <div key={entry.id} className="border border-white/5 rounded bg-black/30">
                              <button
                                onClick={() => setExpandedEntries(prev => {
                                  const next = new Set(prev);
                                  next.has(entry.id) ? next.delete(entry.id) : next.add(entry.id);
                                  return next;
                                })}
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/[0.03] transition-colors"
                              >
                                {expandedEntries.has(entry.id) ? (
                                  <ChevronUp className="w-3 h-3 text-gray-600 shrink-0" />
                                ) : (
                                  <ChevronDown className="w-3 h-3 text-gray-600 shrink-0" />
                                )}
                                <span className="text-gray-600 shrink-0">[{entry.time}]</span>
                                <span className="text-amber-400 truncate">{entry.message}</span>
                              </button>
                              {expandedEntries.has(entry.id) && entry.jsonPayload && (
                                <pre className="px-3 py-2 text-[10px] text-gray-400 border-t border-white/5 overflow-x-auto bg-black/50 max-h-40 overflow-y-auto">
                                  {JSON.stringify(entry.jsonPayload, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Bottom Section: Telemetry Footer */}
              <div className="px-4 py-3 border-t border-white/5 bg-black/80 space-y-1.5 shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-gray-600">Telemetry</span>
                  <Hash className="w-3 h-3 text-gray-600" />
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-500 font-mono flex items-center gap-1"><Cpu className="w-3 h-3" /> Total Tokens</span>
                  <span className="font-mono text-cyan-400 font-bold">
                    {telemetry ? `${(telemetry.inputTokens + telemetry.outputTokens).toLocaleString()}` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-500 font-mono text-[10px]">↳ In / Out</span>
                  <span className="font-mono text-cyan-400/70 text-[10px]">
                    {telemetry ? `${telemetry.inputTokens.toLocaleString()} / ${telemetry.outputTokens.toLocaleString()}` : '— / —'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-500 font-mono flex items-center gap-1"><Clock className="w-3 h-3" /> Response Time</span>
                  <span className="font-mono text-cyan-400 font-bold">
                    {telemetry?.responseTimeMs ? `${(telemetry.responseTimeMs / 1000).toFixed(2)}s` : '—'}
                  </span>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

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

      {/* ── Context Menu Portal ── */}
      {activeMenuId && menuPosition && (
        createPortal(
          (() => {
            const session = chatSessions?.find(s => s.id === activeMenuId);
            if (!session) return null;
            
            return (
              <div
                ref={menuRef}
                style={{ top: menuPosition.top, left: menuPosition.left }}
                className="absolute w-36 bg-zinc-900 border border-white/10 rounded-lg shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100"
              >
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    updateSessionMutation.mutate({ id: session.id, updates: { isPinned: !session.isPinned } });
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white"
                >
                  <Pin className="w-3 h-3" />
                  {session.isPinned ? 'Unpin' : 'Pin to top'}
                </button>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setRenameValue(session.title);
                    setRenamingId(session.id);
                    setActiveMenuId(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white"
                >
                  <Edit2 className="w-3 h-3" />
                  Rename
                </button>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDownloadSession(session.id, session.title);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white"
                >
                  <Download className="w-3 h-3" />
                  Download JSON
                </button>
                <div className="my-1 border-t border-white/5" />
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSessionToDelete(session.id);
                    setActiveMenuId(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>
            );
          })(),
          document.body
        )
      )}

      {/* Delete Chat Modal */}
      <AnimatePresence>
        {sessionToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setSessionToDelete(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative bg-zinc-950 border border-rose-500/30 rounded-xl p-6 shadow-2xl w-full max-w-sm m-4 z-10"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-rose-500/10 rounded-full">
                  <AlertOctagon className="w-6 h-6 text-rose-500" />
                </div>
                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Delete Chat?</h3>
              </div>
              <p className="text-sm text-gray-400 mb-6">
                Are you sure you want to delete this conversation? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setSessionToDelete(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    deleteSessionMutation.mutate(sessionToDelete);
                    setSessionToDelete(null);
                  }}
                  className="px-4 py-2 text-sm font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-500 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

export default App;

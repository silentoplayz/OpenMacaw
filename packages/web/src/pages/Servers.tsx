import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Play, Square, Trash2, Shield, Loader2, AlertCircle, ChevronDown, Wand2, Edit2, X } from 'lucide-react';
import { apiFetch } from '../api';

interface Server {
  id: string;
  name: string;
  transport: string;
  command?: string;
  args?: string;
  envVars?: string;
  status: 'stopped' | 'running' | 'error' | 'unhealthy';
  toolCount: number;
  enabled: boolean;
}

// ── Presets ───────────────────────────────────────────────────────────────────
const PRESETS = [
  {
    id: 'shell',
    label: '🖥️  Shell — sandboxed terminal',
    data: {
      name: 'Shell',
      transport: 'stdio',
      command: 'npx',
      args: '["-y", "mcp-shell"]',
      envVars: '',
    },
  },
  {
    id: 'searxng',
    label: '🔍  SearXNG — self-hosted web search',
    data: {
      name: 'SearXNG Search',
      transport: 'stdio',
      command: 'npx',
      args: '["-y", "mcp-searxng"]',
      // SEARXNG_URL is confirmed from the package's own test script;
      // serverUrl is the camelCase alias that appeared in the ZodError.
      envVars: '{\n  "SEARXNG_URL": "http://your-instance-url",\n  "serverUrl": "http://your-instance-url"\n}',
    },
  },
] as const;

type FormData = {
  name: string;
  transport: string;
  command: string;
  args: string;
  envVars: string;
};

const EMPTY_FORM: FormData = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  envVars: '',
};

function prettyEnv(raw: string | undefined | null): string {
  if (!raw || !raw.trim()) return '';
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

export default function Servers() {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [envVarsError, setEnvVarsError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const isEditMode = editingServerId !== null;

  const { data: servers, isLoading } = useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await apiFetch('/api/servers');
      return res.json();
    },
  });

  // ── Create mutation ───────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiFetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      resetForm();
    },
  });

  // ── Update (edit) mutation ────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const res = await apiFetch(`/api/servers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      resetForm();
    },
  });

  const startMutation = useMutation({
    mutationFn: async (id: string) => {
      setStartingId(id);
      setErrorMsg(null);
      const res = await apiFetch(`/api/servers/${id}/start`, { method: 'POST' });
      if (!res.ok) {
        let msg = 'Unknown connection error';
        try { const e = await res.json(); msg = e.error || e.message || msg; } catch { /* parse fail */ }
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['servers'] }); setStartingId(null); },
    onError: (error: Error) => { setErrorMsg(error.message); setStartingId(null); },
  });

  const stopMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/servers/${id}/stop`, { method: 'POST' });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['servers'] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiFetch(`/api/servers/${id}`, { method: 'DELETE' }); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['servers'] }); },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetForm = () => {
    setShowForm(false);
    setFormData(EMPTY_FORM);
    setEditingServerId(null);
    setEnvVarsError(null);
  };

  const openCreateForm = () => {
    setEditingServerId(null);
    setFormData(EMPTY_FORM);
    setEnvVarsError(null);
    setShowForm(true);
  };

  const openEditForm = (server: Server) => {
    setEditingServerId(server.id);
    setFormData({
      name: server.name,
      transport: server.transport || 'stdio',
      command: server.command || '',
      args: server.args || '',
      envVars: prettyEnv(server.envVars),
    });
    setEnvVarsError(null);
    setShowForm(true);
    // Scroll form into view
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const validateEnvVars = (raw: string): boolean => {
    if (!raw.trim()) { setEnvVarsError(null); return true; }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        setEnvVarsError('Must be a JSON object, e.g. {"KEY": "value"}');
        return false;
      }
      setEnvVarsError(null);
      return true;
    } catch {
      setEnvVarsError('Invalid JSON — check for missing quotes or trailing commas.');
      return false;
    }
  };

  const handleEnvVarsChange = (val: string) => {
    setFormData(f => ({ ...f, envVars: val }));
    validateEnvVars(val);
  };

  const formatEnvVars = () => {
    try {
      const pretty = JSON.stringify(JSON.parse(formData.envVars), null, 2);
      setFormData(f => ({ ...f, envVars: pretty }));
      setEnvVarsError(null);
    } catch {
      setEnvVarsError('Cannot format — fix the JSON syntax first.');
    }
  };

  const loadPreset = (presetId: string) => {
    if (!presetId) return;
    const preset = PRESETS.find(p => p.id === presetId);
    if (preset) { setFormData({ ...preset.data }); setEnvVarsError(null); }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEnvVars(formData.envVars)) return;
    if (isEditMode) {
      updateMutation.mutate({ id: editingServerId!, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-green-500/15 text-green-400 border border-green-500/20';
      case 'error':   return 'bg-red-500/15 text-red-400 border border-red-500/20';
      case 'unhealthy': return 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20';
      default: return 'bg-white/5 text-gray-500 border border-white/5';
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">MCP Servers</h1>
        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Add Server
        </button>
      </div>

      {errorMsg && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-red-500">Connection Failed</h3>
            <p className="text-sm text-red-400 mt-1 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto break-all leading-snug">{errorMsg}</p>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-500/50 hover:text-red-500 text-lg leading-none">×</button>
        </div>
      )}

      {showForm && (
        <div
          ref={formRef}
          className={`mb-6 p-5 rounded-xl shadow-sm transition-colors ${
            isEditMode
              ? 'bg-cyan-950/30 border border-cyan-500/40'   // ── Cyan border in edit mode
              : 'bg-zinc-900/60 border border-white/10'
          }`}
        >
          {/* ── Edit mode banner ──────────────────────────────────────────── */}
          {isEditMode && (
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-cyan-500/20">
              <Edit2 className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-semibold text-cyan-300">Editing: {formData.name}</span>
              <button
                type="button"
                onClick={resetForm}
                className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X className="w-3 h-3" />Cancel Edit
              </button>
            </div>
          )}

          {!isEditMode && (
            <h2 className="text-base font-semibold text-white mb-4">Add MCP Server</h2>
          )}

          {/* ── Load Template (only in Create mode) ──────────────────────── */}
          {!isEditMode && (
            <div className="mb-5 pb-5 border-b border-white/5">
              <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Load Template</label>
              <div className="relative">
                <select
                  defaultValue=""
                  onChange={(e) => loadPreset(e.target.value)}
                  className="w-full appearance-none px-3 py-2.5 bg-zinc-800 border border-white/10 text-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 pr-9 text-sm"
                >
                  <option value="" disabled>— choose a preset to pre-fill the form —</option>
                  {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 text-gray-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-zinc-900 border border-white/10 text-white placeholder-zinc-600 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Transport</label>
                <select
                  value={formData.transport}
                  onChange={(e) => setFormData(f => ({ ...f, transport: e.target.value }))}
                  className="w-full px-3 py-2 bg-zinc-900 border border-white/10 text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 text-sm"
                >
                  <option value="stdio">Stdio</option>
                  <option value="http">HTTP/SSE</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Command</label>
                <input
                  type="text"
                  value={formData.command}
                  onChange={(e) => setFormData(f => ({ ...f, command: e.target.value }))}
                  placeholder="npx"
                  className="w-full px-3 py-2 bg-zinc-900 border border-white/10 text-white placeholder-zinc-600 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Arguments <span className="text-gray-600 font-normal">(JSON array)</span>
                </label>
                <input
                  type="text"
                  value={formData.args}
                  onChange={(e) => setFormData(f => ({ ...f, args: e.target.value }))}
                  placeholder='["-y", "some-mcp-server"]'
                  className="w-full px-3 py-2 bg-zinc-900 border border-white/10 text-white placeholder-zinc-600 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono text-sm"
                />
                <p className="mt-1 text-[11px] text-gray-600">
                  Find more at{' '}
                  <a href="https://mcp.so" target="_blank" rel="noopener noreferrer" className="text-cyan-600 hover:text-cyan-400 transition-colors">mcp.so</a>
                </p>
              </div>
            </div>

            {/* ── Env Vars ─────────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-400">
                  Environment Variables <span className="text-gray-600 font-normal">(JSON object)</span>
                </label>
                <button
                  type="button"
                  onClick={formatEnvVars}
                  disabled={!formData.envVars.trim()}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono text-gray-400 border border-white/10 rounded hover:bg-white/5 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Pretty-print JSON"
                >
                  <Wand2 className="w-3 h-3" />Format JSON
                </button>
              </div>
              <textarea
                value={formData.envVars}
                onChange={(e) => handleEnvVarsChange(e.target.value)}
                placeholder={'{\n  "MY_API_KEY": "sk-..."\n}'}
                rows={4}
                className={`w-full px-3 py-2 bg-zinc-900 border rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono text-sm text-white placeholder-zinc-600 resize-y leading-relaxed ${
                  envVarsError ? 'border-red-500/50' : 'border-white/10 focus:border-cyan-500'
                }`}
              />
              {envVarsError && (
                <p className="mt-1 text-[11px] text-red-400 font-mono flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 shrink-0" />{envVarsError}
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isSaving || !!envVarsError}
                className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isEditMode ? 'Save Changes' : 'Add Server'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 border border-white/10 text-gray-400 rounded-lg hover:bg-white/5 hover:text-white transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="bg-zinc-900/50 rounded-xl border border-white/10 overflow-hidden shadow-sm">
          <table className="w-full">
            <thead className="bg-zinc-900/50 border-b border-white/10">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Transport</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Tools</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {servers?.map((server) => (
                <tr
                  key={server.id}
                  className={`transition-colors ${
                    editingServerId === server.id
                      ? 'bg-cyan-950/20'
                      : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-gray-200">
                    {server.name}
                    {editingServerId === server.id && (
                      <span className="ml-2 text-[10px] font-mono text-cyan-500 uppercase tracking-wider">editing</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-sm">{server.transport}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(server.status)}`}>
                      {server.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{server.toolCount}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {server.status === 'running' ? (
                        <button onClick={() => stopMutation.mutate(server.id)} disabled={stopMutation.isPending} className="p-1.5 hover:bg-white/10 rounded transition-colors" title="Stop">
                          <Square className="w-4 h-4 text-red-500" />
                        </button>
                      ) : (
                        <button onClick={() => startMutation.mutate(server.id)} disabled={startMutation.isPending && startingId !== server.id} className="p-1.5 hover:bg-white/10 rounded transition-colors" title="Start">
                          {startMutation.isPending && startingId === server.id
                            ? <Loader2 className="w-4 h-4 text-cyan-500 animate-spin" />
                            : <Play className="w-4 h-4 text-green-500" />}
                        </button>
                      )}
                      {/* ── Edit button ────────────────────────────────────── */}
                      <button
                        onClick={() => openEditForm(server)}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4 text-cyan-500" />
                      </button>
                      <Link to={`/permissions/${server.id}`} className="p-1.5 hover:bg-white/10 rounded transition-colors" title="Permissions">
                        <Shield className="w-4 h-4 text-gray-400 hover:text-cyan-500 transition-colors" />
                      </Link>
                      <button
                        onClick={() => { if (confirm('Delete this server?')) deleteMutation.mutate(server.id); }}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-500 transition-colors" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {servers?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                    No servers configured. Click <strong className="text-gray-400">Add Server</strong> and choose a preset.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

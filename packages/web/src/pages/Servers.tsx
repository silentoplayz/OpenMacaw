import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Plus, Play, Square, Trash2, Shield, Loader2, AlertCircle,
  Search, Package, Download, X, ChevronRight, Star, Globe, Check,
  Eye, EyeOff,
} from 'lucide-react';
import { apiFetch } from '../api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Server {
  id: string;
  name: string;
  transport: string;
  command?: string;
  args?: string;
  status: 'stopped' | 'running' | 'error' | 'unhealthy';
  toolCount: number;
  enabled: boolean;
}

interface RegistryEnvVar {
  name: string;
  description: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

interface RegistryPackage {
  registryType: 'npm' | 'oci' | 'pypi';
  identifier: string;
  binName?: string;
  version?: string;
  environmentVariables?: RegistryEnvVar[];
}

interface RegistryServer {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  icon?: string;
  packages: RegistryPackage[];
  source: 'registry' | 'curated';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build the stdio command args array for an npm MCP package. */
function buildArgs(pkg: RegistryPackage): string[] {
  if (pkg.registryType === 'npm') {
    // npx -y --package=<identifier> <binName>
    const bin = pkg.binName ?? pkg.identifier.split('/').pop() ?? pkg.identifier;
    return ['-y', `--package=${pkg.identifier}`, bin];
  }
  return [];
}

/** Extract all env vars from the first npm package of a server. */
function getEnvVars(server: RegistryServer): RegistryEnvVar[] {
  const pkg = server.packages.find((p) => p.registryType === 'npm');
  return pkg?.environmentVariables ?? [];
}

// ── Install Modal ─────────────────────────────────────────────────────────────

function InstallModal({
  server,
  onClose,
  onInstalled,
}: {
  server: RegistryServer;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const pkg = server.packages.find((p) => p.registryType === 'npm')!;
  const envVars = getEnvVars(server);

  const [name, setName] = useState(server.title);
  const [envValues, setEnvValues] = useState<Record<string, string>>(
    Object.fromEntries(envVars.map((v) => [v.name, '']))
  );
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [autoStart, setAutoStart] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const handleInstall = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const args = buildArgs(pkg);
      // Env vars that have values
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(envValues)) {
        if (v.trim()) env[k] = v.trim();
      }

      const createRes = await apiFetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          transport: 'stdio',
          command: 'npx',
          args: JSON.stringify(args),
          env: Object.keys(env).length > 0 ? env : undefined,
        }),
      });

      if (!createRes.ok) {
        const data = await createRes.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to create server');
      }

      const created = await createRes.json() as { id: string };

      if (autoStart) {
        await apiFetch(`/api/servers/${created.id}/start`, { method: 'POST' });
      }

      queryClient.invalidateQueries({ queryKey: ['servers'] });
      onInstalled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-zinc-950 border border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5 shrink-0">
          {server.icon ? (
            <img src={server.icon} alt="" className="w-8 h-8 rounded-md object-contain bg-white/5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-8 h-8 rounded-md bg-cyan-950/40 flex items-center justify-center">
              <Package className="w-4 h-4 text-cyan-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white font-mono">{server.title}</h2>
            <p className="text-[10px] text-gray-500 font-mono">{pkg?.identifier} v{server.version}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-white transition-colors rounded-md hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Description */}
          <p className="text-xs text-gray-400 leading-relaxed">{server.description}</p>

          {/* Name */}
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1">Server name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
            />
          </div>

          {/* Command preview */}
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1">Install command (auto-generated)</label>
            <pre className="px-3 py-2 bg-black border border-white/5 rounded-md text-[11px] text-gray-500 font-mono overflow-x-auto whitespace-pre-wrap break-all">
              npx {buildArgs(pkg).join(' ')}
            </pre>
          </div>

          {/* Env vars */}
          {envVars.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-mono text-gray-400">
                Environment variables
                {envVars.some((v) => v.isRequired) && (
                  <span className="ml-2 text-[10px] text-amber-400">* required</span>
                )}
              </p>
              {envVars.map((v) => (
                <div key={v.name}>
                  <label className="block text-xs font-mono text-gray-500 mb-1">
                    {v.name}
                    {v.isRequired && <span className="text-amber-400 ml-1">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={v.isSecret && !showSecrets[v.name] ? 'password' : 'text'}
                      value={envValues[v.name] ?? ''}
                      onChange={(e) => setEnvValues({ ...envValues, [v.name]: e.target.value })}
                      placeholder={v.description}
                      className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500 pr-9"
                    />
                    {v.isSecret && (
                      <button
                        type="button"
                        onClick={() => setShowSecrets({ ...showSecrets, [v.name]: !showSecrets[v.name] })}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
                      >
                        {showSecrets[v.name] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-0.5">{v.description}</p>
                </div>
              ))}
            </div>
          )}

          {/* Auto-start toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <button
              type="button"
              onClick={() => setAutoStart((v) => !v)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border border-transparent transition-colors ${autoStart ? 'bg-cyan-600' : 'bg-gray-800'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 mt-[2px] ml-[2px] ${autoStart ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className="text-xs font-mono text-gray-400">Start server after installing</span>
          </label>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs bg-red-950/20 border border-red-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/5 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleInstall}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-mono font-bold rounded-md transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {saving ? 'Installing…' : 'Install'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Catalog Card ──────────────────────────────────────────────────────────────

function CatalogCard({
  server,
  installedNames,
  onInstall,
}: {
  server: RegistryServer;
  installedNames: Set<string>;
  onInstall: (server: RegistryServer) => void;
}) {
  const envVars = getEnvVars(server);
  const requiredVars = envVars.filter((v) => v.isRequired);
  const isInstalled = installedNames.has(server.name);

  return (
    <div className="group flex flex-col bg-zinc-900/40 border border-white/5 rounded-lg p-4 hover:border-white/10 hover:bg-zinc-900/60 transition-all">
      {/* Top row: icon + title + badges */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-md bg-black border border-white/5 flex items-center justify-center shrink-0 overflow-hidden">
          {server.icon ? (
            <img
              src={server.icon}
              alt=""
              className="w-7 h-7 object-contain"
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = 'none';
                el.parentElement!.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0v10l-8 4m-8-4V7m8 14V11"/></svg>';
              }}
            />
          ) : (
            <Package className="w-4 h-4 text-gray-600" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-mono font-semibold text-white truncate">{server.title}</h3>
            {server.source === 'curated' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 bg-amber-950/40 border border-amber-500/30 rounded text-amber-400 shrink-0">
                <Star className="w-2.5 h-2.5" />
                Curated
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-gray-600 mt-0.5 truncate">{server.name}</p>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-400 leading-relaxed flex-1 mb-3 line-clamp-2">
        {server.description || 'No description available.'}
      </p>

      {/* Footer: env var count + version + install button */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-gray-600">v{server.version}</span>
          {requiredVars.length > 0 && (
            <span className="text-[10px] font-mono text-gray-500 flex items-center gap-1">
              <Globe className="w-2.5 h-2.5" />
              {requiredVars.length} env var{requiredVars.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {isInstalled ? (
          <span className="flex items-center gap-1 text-[10px] font-mono text-green-500 px-2 py-1 bg-green-950/30 border border-green-500/20 rounded">
            <Check className="w-3 h-3" />
            Installed
          </span>
        ) : (
          <button
            onClick={() => onInstall(server)}
            className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors shrink-0"
          >
            <Download className="w-3 h-3" />
            Install
          </button>
        )}
      </div>
    </div>
  );
}

// ── Catalog Tab ───────────────────────────────────────────────────────────────

function CatalogTab({ installedServers }: { installedServers: Server[] }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedServer, setSelectedServer] = useState<RegistryServer | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const { data, isLoading, isError } = useQuery<{ servers: RegistryServer[]; total: number }>({
    queryKey: ['registry', debouncedQuery],
    queryFn: async () => {
      const params = debouncedQuery ? `?q=${encodeURIComponent(debouncedQuery)}` : '';
      const res = await apiFetch(`/api/registry${params}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const installedNames = new Set(installedServers.map((s) => s.name));
  const servers = data?.servers ?? [];

  const curatedServers = servers.filter((s) => s.source === 'curated');
  const communityServers = servers.filter((s) => s.source === 'registry');
  const showSections = !debouncedQuery; // only show curated/community sections when not searching

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-6 py-4 border-b border-white/5 bg-black/30 shrink-0">
        <div className="relative max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search MCP servers…"
            className="w-full pl-9 pr-9 py-2 bg-black border border-white/10 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {data && (
          <p className="text-[10px] text-gray-600 font-mono mt-2">
            {data.total} server{data.total !== 1 ? 's' : ''} available
            {debouncedQuery && ` for "${debouncedQuery}"`}
          </p>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
            <p className="text-sm text-gray-400">Failed to load registry</p>
            <p className="text-xs text-gray-600 mt-1">Check your internet connection and try again.</p>
          </div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Search className="w-8 h-8 text-gray-700 mb-3" />
            <p className="text-sm text-gray-400">No servers found for "{debouncedQuery}"</p>
            <button onClick={() => setQuery('')} className="text-xs text-cyan-500 hover:text-cyan-400 mt-2">
              Clear search
            </button>
          </div>
        ) : showSections ? (
          <div className="space-y-8 max-w-5xl">
            {curatedServers.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <Star className="w-3.5 h-3.5 text-amber-400" />
                  <h2 className="text-xs font-mono font-bold text-gray-300 uppercase tracking-wider">Curated</h2>
                  <span className="text-[10px] font-mono text-gray-600">{curatedServers.length} servers</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {curatedServers.map((s) => (
                    <CatalogCard
                      key={s.id}
                      server={s}
                      installedNames={installedNames}
                      onInstall={setSelectedServer}
                    />
                  ))}
                </div>
              </section>
            )}

            {communityServers.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <Globe className="w-3.5 h-3.5 text-gray-500" />
                  <h2 className="text-xs font-mono font-bold text-gray-300 uppercase tracking-wider">Community</h2>
                  <span className="text-[10px] font-mono text-gray-600">{communityServers.length} servers</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {communityServers.map((s) => (
                    <CatalogCard
                      key={s.id}
                      server={s}
                      installedNames={installedNames}
                      onInstall={setSelectedServer}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-w-5xl">
            {servers.map((s) => (
              <CatalogCard
                key={s.id}
                server={s}
                installedNames={installedNames}
                onInstall={setSelectedServer}
              />
            ))}
          </div>
        )}
      </div>

      {selectedServer && (
        <InstallModal
          server={selectedServer}
          onClose={() => setSelectedServer(null)}
          onInstalled={() => setSelectedServer(null)}
        />
      )}
    </div>
  );
}

// ── Installed Tab ─────────────────────────────────────────────────────────────

function InstalledTab() {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
  });
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  const { data: servers, isLoading } = useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await apiFetch('/api/servers');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiFetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setShowForm(false);
      setFormData({ name: '', transport: 'stdio', command: '', args: '' });
    },
  });

  const startMutation = useMutation({
    mutationFn: async (id: string) => {
      setStartingId(id);
      setErrorMsg(null);
      const res = await apiFetch(`/api/servers/${id}/start`, { method: 'POST' });
      if (!res.ok) {
        let msg = 'Unknown connection error';
        try {
          const errData = await res.json();
          msg = errData.error || errData.message || msg;
        } catch { /* parse fail */ }
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setStartingId(null);
    },
    onError: (error: Error) => {
      setErrorMsg(error.message);
      setStartingId(null);
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/servers/${id}/stop`, { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/servers/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-green-100 text-green-800';
      case 'error': return 'bg-red-100 text-red-800';
      case 'unhealthy': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/30 shrink-0">
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
          {servers?.length ?? 0} configured server{servers?.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-gray-200 text-xs font-mono rounded-md border border-white/10 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add manually
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {errorMsg && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-red-500">Connection Failed</h3>
              <p className="text-sm text-red-400 mt-1 whitespace-pre-wrap font-mono relative max-h-40 overflow-y-auto w-full break-all leading-snug">
                {errorMsg}
              </p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="text-red-500/50 hover:text-red-500">×</button>
          </div>
        )}

        {showForm && (
          <div className="mb-6 p-4 bg-zinc-900/60 rounded-lg border border-white/10">
            <h2 className="text-sm font-mono font-semibold mb-4 text-white">Add MCP Server manually</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-black border border-white/10 text-white placeholder-zinc-500 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Transport</label>
                <select
                  value={formData.transport}
                  onChange={(e) => setFormData({ ...formData, transport: e.target.value })}
                  className="w-full px-3 py-2 bg-black border border-white/10 text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                >
                  <option value="stdio">Stdio</option>
                  <option value="http">HTTP/SSE</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Command</label>
                <input
                  type="text"
                  value={formData.command}
                  onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                  placeholder="npx"
                  className="w-full px-3 py-2 bg-black border border-white/10 text-white placeholder-zinc-500 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Arguments (JSON array)</label>
                <input
                  type="text"
                  value={formData.args}
                  onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                  placeholder='["-y", "some-mcp-server"]'
                  className="w-full px-3 py-2 bg-black border border-white/10 text-white placeholder-zinc-500 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 bg-cyan-600 text-white text-sm font-mono rounded-lg hover:bg-cyan-500 disabled:opacity-50"
                >
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Server'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-white/10 text-gray-400 text-sm font-mono rounded-lg hover:bg-white/5 hover:text-white transition-colors"
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
          <div className="bg-zinc-900/40 rounded-lg border border-white/5 overflow-hidden">
            <table className="w-full">
              <thead className="bg-black/40 border-b border-white/5">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-mono font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-mono font-medium text-gray-500 uppercase tracking-wider">Transport</th>
                  <th className="px-4 py-3 text-left text-xs font-mono font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-mono font-medium text-gray-500 uppercase tracking-wider">Tools</th>
                  <th className="px-4 py-3 text-right text-xs font-mono font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {servers?.map((server) => (
                  <tr key={server.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-200 font-mono text-sm">{server.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-sm font-mono">{server.transport}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-mono font-medium rounded-full ${getStatusColor(server.status)}`}>
                        {server.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-sm font-mono">{server.toolCount}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {server.status === 'running' ? (
                          <button
                            onClick={() => stopMutation.mutate(server.id)}
                            disabled={stopMutation.isPending}
                            className="p-1.5 hover:bg-white/10 rounded transition-colors"
                            title="Stop"
                          >
                            <Square className="w-4 h-4 text-red-600" />
                          </button>
                        ) : (
                          <button
                            onClick={() => startMutation.mutate(server.id)}
                            disabled={startMutation.isPending && startingId !== server.id}
                            className="p-1.5 hover:bg-white/10 rounded transition-colors"
                            title="Start"
                          >
                            {startMutation.isPending && startingId === server.id ? (
                              <Loader2 className="w-4 h-4 text-cyan-600 animate-spin" />
                            ) : (
                              <Play className="w-4 h-4 text-green-600" />
                            )}
                          </button>
                        )}
                        <Link
                          to={`/permissions/${server.id}`}
                          className="p-1.5 hover:bg-white/10 rounded transition-colors"
                          title="Permissions"
                        >
                          <Shield className="w-4 h-4 text-cyan-600" />
                        </Link>
                        <button
                          onClick={() => {
                            if (confirm('Delete this server?')) {
                              deleteMutation.mutate(server.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 hover:bg-white/10 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-600" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {servers?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center">
                      <Package className="w-8 h-8 text-gray-700 mx-auto mb-3" />
                      <p className="text-sm text-gray-500 mb-1">No servers installed yet</p>
                      <p className="text-xs text-gray-600">Browse the Catalog tab to find and install MCP servers.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = 'installed' | 'catalog';

export default function Servers() {
  const [tab, setTab] = useState<Tab>('installed');

  const { data: installedServers = [] } = useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await apiFetch('/api/servers');
      return res.json();
    },
  });

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'installed', label: 'Installed', icon: <ChevronRight className="w-3.5 h-3.5" /> },
    { id: 'catalog', label: 'Catalog', icon: <Package className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black shrink-0">
        <div>
          <h1 className="text-sm font-bold text-white font-mono uppercase tracking-wider">MCP Servers</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {installedServers.length} installed &middot;{' '}
            {installedServers.filter((s) => s.status === 'running').length} running
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center bg-zinc-900 border border-white/10 rounded-lg p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-colors ${
                tab === t.id
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'installed' ? (
          <InstalledTab />
        ) : (
          <CatalogTab installedServers={installedServers} />
        )}
      </div>
    </div>
  );
}

import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, FolderOpen, Terminal, Globe, Network, X, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState, useMemo } from 'react';
import { apiFetch } from '../api';

interface Permission {
  id: string;
  serverId: string;
  allowedPaths: string[];
  deniedPaths: string[];
  pathRead: boolean;
  pathWrite: boolean;
  pathCreate: boolean;
  pathDelete: boolean;
  pathListDir: boolean;
  bashAllowed: boolean;
  bashAllowedCommands: string[];
  webfetchAllowed: boolean;
  webfetchAllowedDomains: string[];
  subprocessAllowed: boolean;
  networkAllowed: boolean;
  maxCallsPerMinute: number;
  maxTokensPerCall: number;
  promptInjectionPrevention?: boolean;
  toolPromptInjectionPrevention: Record<string, 'inherit' | 'enable' | 'disable'>;
}

export default function Permissions() {
  const { serverId } = useParams<{ serverId: string }>();
  const queryClient = useQueryClient();
  const [newPath, setNewPath] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const { data: permission, isLoading } = useQuery<Permission>({
    queryKey: ['permission', serverId],
    queryFn: async () => {
      const res = await apiFetch(`/api/permissions/${serverId}`);
      if (!res.ok) throw new Error('Failed to fetch permissions');
      return res.json();
    },
    enabled: !!serverId,
  });

  interface Tool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }

  const { data: tools = [] } = useQuery<Tool[]>({
    queryKey: ['server-tools', serverId],
    queryFn: async () => {
      const res = await apiFetch(`/api/servers/${serverId}/tools`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!serverId,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Permission>) => {
      const res = await apiFetch(`/api/permissions/${serverId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update permissions');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permission', serverId] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
  });

  const updateToolPipMutation = useMutation({
    mutationFn: async ({ toolName, override }: { toolName: string; override: 'inherit' | 'enable' | 'disable' }) => {
      const res = await apiFetch(`/api/permissions/${serverId}/tool-pip/${toolName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override }),
      });
      if (!res.ok) throw new Error('Failed to update tool PIP override');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permission', serverId] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
  });

  const addAllowedPath = () => {
    if (!newPath.trim() || !permission) return;
    updateMutation.mutate({
      allowedPaths: [...permission.allowedPaths, newPath.trim()],
    });
    setNewPath('');
  };

  const removeAllowedPath = (path: string) => {
    if (!permission) return;
    updateMutation.mutate({
      allowedPaths: permission.allowedPaths.filter(p => p !== path),
    });
  };

  const addCommand = () => {
    if (!newCommand.trim() || !permission) return;
    updateMutation.mutate({
      bashAllowedCommands: [...permission.bashAllowedCommands, newCommand.trim()],
    });
    setNewCommand('');
  };

  const removeCommand = (cmd: string) => {
    if (!permission) return;
    updateMutation.mutate({
      bashAllowedCommands: permission.bashAllowedCommands.filter(c => c !== cmd),
    });
  };

  const addDomain = () => {
    if (!newDomain.trim() || !permission) return;
    updateMutation.mutate({
      webfetchAllowedDomains: [...permission.webfetchAllowedDomains, newDomain.trim()],
    });
    setNewDomain('');
  };

  const removeDomain = (domain: string) => {
    if (!permission) return;
    updateMutation.mutate({
      webfetchAllowedDomains: permission.webfetchAllowedDomains.filter(d => d !== domain),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!permission) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Permission not found</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link to="/servers" className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-500 dark:text-gray-400" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Permissions Audit & Control</h1>
        {saveStatus === 'saving' && <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}
        {saveStatus === 'saved' && <span className="text-green-600 dark:text-green-400 text-sm font-medium pr-2">Saved!</span>}
      </div>

      <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 rounded-lg border border-amber-200 dark:border-amber-800 p-4 mb-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Prompt Injection Prevention (PIP)</h2>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={permission.promptInjectionPrevention ?? false}
                  onChange={(e) => updateMutation.mutate({ promptInjectionPrevention: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 dark:peer-focus:ring-amber-800 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-amber-500"></div>
              </label>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              When enabled, all tool calls from this server pass through an injection detection pipeline including canary leak checks, sanitizer, step verifier, and final verifier. May pause execution for human confirmation on suspicious inputs.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-white/10 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <FolderOpen className="w-5 h-5 text-cyan-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filesystem Access</h2>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Allowed Target Paths</h3>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder="/workspace"
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 bg-zinc-100 dark:bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && addAllowedPath()}
                />
                <button
                  onClick={addAllowedPath}
                  className="px-3 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors"
                >
                  Add
                </button>
              </div>
              <div className="space-y-1">
                {permission.allowedPaths.map(path => (
                  <div key={path} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5">
                    <span className="text-sm font-mono text-gray-900 dark:text-gray-200">{path}</span>
                    <button onClick={() => removeAllowedPath(path)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {permission.allowedPaths.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No allowed paths configured</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={permission.pathRead}
                  onChange={(e) => updateMutation.mutate({ pathRead: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-zinc-800 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="text-sm">Read</span>
              </label>
              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={permission.pathWrite}
                  onChange={(e) => updateMutation.mutate({ pathWrite: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-zinc-800 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="text-sm">Write</span>
              </label>
              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={permission.pathCreate}
                  onChange={(e) => updateMutation.mutate({ pathCreate: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-zinc-800 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="text-sm">Create</span>
              </label>
              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={permission.pathDelete}
                  onChange={(e) => updateMutation.mutate({ pathDelete: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-zinc-800 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="text-sm">Delete</span>
              </label>
              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={permission.pathListDir}
                  onChange={(e) => updateMutation.mutate({ pathListDir: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-zinc-800 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="text-sm">List Directory</span>
              </label>
            </div>
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-white/10 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Terminal className="w-5 h-5 text-cyan-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Bash Commands</h2>
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={permission.bashAllowed}
                onChange={(e) => updateMutation.mutate({ bashAllowed: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-zinc-800 text-cyan-600 focus:ring-cyan-500"
              />
              <span className="text-sm font-medium">Allow bash execution</span>
            </label>

            {permission.bashAllowed && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Allowed Commands (glob patterns)</h3>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newCommand}
                    onChange={(e) => setNewCommand(e.target.value)}
                    placeholder="/usr/bin/python3, npm, git"
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 bg-zinc-100 dark:bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && addCommand()}
                  />
                  <button
                    onClick={addCommand}
                    className="px-3 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors"
                  >
                    Add
                  </button>
                </div>
                <div className="space-y-1">
                  {permission.bashAllowedCommands.map(cmd => (
                    <div key={cmd} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5">
                      <span className="text-sm font-mono text-gray-900 dark:text-gray-200">{cmd}</span>
                      <button onClick={() => removeCommand(cmd)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {permission.bashAllowedCommands.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No allowed commands configured</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-white/10 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-cyan-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Web Domains</h2>
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={permission.webfetchAllowed}
                onChange={(e) => updateMutation.mutate({ webfetchAllowed: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-zinc-800 text-cyan-600 focus:ring-cyan-500"
              />
              <span className="text-sm font-medium">Allow web fetch</span>
            </label>

            {permission.webfetchAllowed && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Allowed Domains</h3>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    placeholder="example.com"
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 bg-white dark:bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && addDomain()}
                  />
                  <button
                    onClick={addDomain}
                    className="px-3 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors"
                  >
                    Add
                  </button>
                </div>
                <div className="space-y-1">
                  {permission.webfetchAllowedDomains.map(domain => (
                    <div key={domain} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5">
                      <span className="text-sm font-mono text-gray-900 dark:text-gray-200">{domain}</span>
                      <button onClick={() => removeDomain(domain)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {permission.webfetchAllowedDomains.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No allowed domains configured</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-white/10 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Network className="w-5 h-5 text-cyan-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Network & Meta</h2>
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={permission.subprocessAllowed}
                onChange={(e) => updateMutation.mutate({ subprocessAllowed: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-zinc-800 text-cyan-600 focus:ring-cyan-500"
              />
              <span className="text-sm">Allow subprocess spawning</span>
            </label>

            <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={permission.networkAllowed}
                onChange={(e) => updateMutation.mutate({ networkAllowed: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-zinc-800 text-cyan-600 focus:ring-cyan-500"
              />
              <span className="text-sm">Allow network access</span>
            </label>

            <div className="pt-4 border-t border-gray-200 dark:border-white/10">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Rate Limits</h3>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400">Max calls per minute</label>
                  <input
                    type="number"
                    value={permission.maxCallsPerMinute}
                    onChange={(e) => updateMutation.mutate({ maxCallsPerMinute: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-white/10 bg-white dark:bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400">Max tokens per call</label>
                  <input
                    type="number"
                    value={permission.maxTokensPerCall}
                    onChange={(e) => updateMutation.mutate({ maxTokensPerCall: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-white/10 bg-white dark:bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {tools.length > 0 && (
          <div className="bg-white dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-white/10 p-4 shadow-sm col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Tool-Specific PIP Overrides</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Override Prompt Injection Prevention settings for individual tools. "Inherit" uses the server-wide setting above.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tools.map((tool) => {
                const override = permission.toolPromptInjectionPrevention?.[tool.name] || 'inherit';
                return (
                  <div key={tool.name} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono text-gray-900 dark:text-gray-200 block truncate">{tool.name}</span>
                      {tool.description && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate block">{tool.description}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {(['inherit', 'enable', 'disable'] as const).map((opt) => (
                        <button
                          key={opt}
                          onClick={() => updateToolPipMutation.mutate({ toolName: tool.name, override: opt })}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            override === opt
                              ? opt === 'inherit' 
                                ? 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                                : opt === 'enable'
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                              : 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          {opt.charAt(0).toUpperCase() + opt.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

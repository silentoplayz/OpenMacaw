import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, AlertOctagon, Zap, Save, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '../api';

// ── Types ────────────────────────────────────────────────────────────────────

interface PermState {
  pathRead: boolean;
  pathWrite: boolean;
  bashAllowed: boolean;
  networkAllowed: boolean;
  subprocessAllowed: boolean;
  toolAutoApprove: Record<string, boolean>;
}

interface Tool {
  name: string;
  description?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ServerPermissionDrawer({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const queryClient = useQueryClient();

  const [local, setLocal] = useState<PermState | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data: perm, isLoading } = useQuery({
    queryKey: ['permissions', serverId],
    queryFn: async () => {
      const res = await apiFetch(`/api/permissions/${serverId}`);
      return res.json();
    },
    enabled: !!serverId,
  });

  const { data: tools = [] } = useQuery<Tool[]>({
    queryKey: ['server-tools', serverId],
    queryFn: async () => {
      const res = await apiFetch(`/api/servers/${serverId}/tools`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!serverId,
  });

  useEffect(() => {
    if (perm && !local) {
      setLocal({
        pathRead:       Boolean(perm.pathRead),
        pathWrite:      Boolean(perm.pathWrite),
        bashAllowed:    Boolean(perm.bashAllowed),
        networkAllowed: Boolean(perm.networkAllowed),
        subprocessAllowed: Boolean(perm.subprocessAllowed),
        toolAutoApprove: (typeof perm.toolAutoApprove === 'object' && perm.toolAutoApprove !== null) ? perm.toolAutoApprove : {},
      });
    }
  }, [perm, local]);

  const mutation = useMutation({
    mutationFn: async (updates: Partial<PermState>) => {
      const res = await apiFetch(`/api/permissions/${serverId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to save permissions');
      return res.json();
    },
    onSuccess: (saved: any) => {
      setLocal({
        pathRead:       Boolean(saved.pathRead),
        pathWrite:      Boolean(saved.pathWrite),
        bashAllowed:    Boolean(saved.bashAllowed),
        networkAllowed: Boolean(saved.networkAllowed),
        subprocessAllowed: Boolean(saved.subprocessAllowed),
        toolAutoApprove: (typeof saved.toolAutoApprove === 'object' && saved.toolAutoApprove !== null) ? saved.toolAutoApprove : {},
      });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['permissions', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const toggle = (key: keyof Omit<PermState, 'toolAutoApprove'>) => {
    setLocal(prev => {
      if (!prev) return prev;
      return { ...prev, [key]: !prev[key] };
    });
    setDirty(true);
  };

  const toggleToolAutoApprove = (toolName: string) => {
    setLocal(prev => {
      if (!prev) return prev;
      const current = prev.toolAutoApprove[toolName] ?? false;
      return {
        ...prev,
        toolAutoApprove: { ...prev.toolAutoApprove, [toolName]: !current },
      };
    });
    setDirty(true);
  };

  const save = () => {
    if (!local) return;
    mutation.mutate(local);
  };

  const approvedCount = local ? Object.values(local.toolAutoApprove).filter(Boolean).length : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed inset-y-0 right-0 w-80 bg-zinc-950/95 backdrop-blur-md border-l border-white/10 shadow-2xl z-50 flex flex-col"
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-cyan-500" /> Server Permissions
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <AlertOctagon className="w-4 h-4 rotate-45" />
          </button>
        </div>

        {isLoading || !local ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
          </div>
        ) : (
          <>
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {/* ── Access Toggles ──────────────────────────────────────── */}
              {([
                { key: 'pathRead' as const, label: 'File Read' },
                { key: 'pathWrite' as const, label: 'File Write' },
                { key: 'bashAllowed' as const, label: 'Command Execution' },
                { key: 'networkAllowed' as const, label: 'Network Access' },
                { key: 'subprocessAllowed' as const, label: 'Subprocesses' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => toggle(key)}
                  className="w-full flex items-center justify-between cursor-pointer"
                >
                  <span className="text-xs text-gray-300 font-mono">{label}</span>
                  <div className={`w-8 h-4 rounded-full transition-colors relative ${local[key] ? 'bg-cyan-500' : 'bg-zinc-700'}`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${local[key] ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              ))}

              {/* ── Allowed Paths ────────────────────────────────────────── */}
              {perm?.allowedPaths && (
                <div className="pt-4 border-t border-white/10">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Allowed Paths</p>
                  <div className="space-y-1">
                    {perm.allowedPaths.length > 0 ? (
                      perm.allowedPaths.map((p: string, i: number) => (
                        <div key={i} className="text-xs text-gray-400 bg-black/50 px-2 py-1 rounded border border-white/5 font-mono truncate">{p}</div>
                      ))
                    ) : (
                      <div className="text-xs text-gray-600 italic">No paths explicitly configured</div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Trust Policy: Per-Tool Auto-Approve ──────────────────── */}
              <div className="pt-4 border-t border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-3 h-3 text-yellow-400" />
                  <p className="text-[10px] text-yellow-400 uppercase tracking-wider font-bold">Trust Policy</p>
                </div>
                <p className="text-[9px] text-gray-600 mb-3 leading-tight">
                  Toggle tools to skip approval prompts. Enabled tools execute without asking.
                </p>

                {approvedCount > 0 && (
                  <div className="mb-2 px-2 py-1.5 bg-yellow-950/30 border border-yellow-500/20 rounded text-[10px] font-mono text-yellow-500">
                    {approvedCount} tool{approvedCount !== 1 ? 's' : ''} will auto-execute without approval.
                  </div>
                )}

                {tools.length > 0 ? (
                  <div className="space-y-1">
                    {tools.map((tool) => {
                      const isApproved = local.toolAutoApprove[tool.name] ?? false;
                      return (
                        <button
                          key={tool.name}
                          onClick={() => toggleToolAutoApprove(tool.name)}
                          className="w-full flex items-center justify-between cursor-pointer py-1.5 px-2 rounded hover:bg-white/5 transition-colors"
                        >
                          <div className="text-left flex-1 min-w-0 mr-2">
                            <div className="text-[11px] text-gray-300 font-mono truncate">{tool.name}</div>
                            {tool.description && (
                              <div className="text-[9px] text-gray-600 truncate">{tool.description}</div>
                            )}
                          </div>
                          <div className={`w-7 h-3.5 rounded-full transition-colors relative shrink-0 ${isApproved ? 'bg-yellow-500' : 'bg-zinc-700'}`}>
                            <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${isApproved ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[10px] text-gray-600 italic">No tools available for this server.</div>
                )}
              </div>
            </div>

            {/* ── Save Footer ───────────────────────────────────────────── */}
            <div className="p-4 border-t border-white/10 shrink-0">
              <button
                onClick={save}
                disabled={!dirty || mutation.isPending}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-mono font-bold uppercase tracking-wider transition-all ${
                  dirty
                    ? 'bg-cyan-950/40 border border-cyan-500/50 text-cyan-400 hover:bg-cyan-900/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                    : 'bg-zinc-900 border border-white/5 text-gray-600 cursor-not-allowed'
                }`}
              >
                {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {mutation.isPending ? 'Saving...' : dirty ? 'Save Changes' : 'No Changes'}
              </button>
              {mutation.isError && (
                <p className="text-[10px] text-red-400 font-mono mt-1 text-center">Save failed. Check backend logs.</p>
              )}
            </div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

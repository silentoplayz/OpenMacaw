import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, AlertOctagon, Plus, X, Zap, Save, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '../api';

// ── Types ────────────────────────────────────────────────────────────────────

interface PermState {
  pathRead: boolean;
  pathWrite: boolean;
  bashAllowed: boolean;
  networkAllowed: boolean;
  subprocessAllowed: boolean;
  autoApproveReads: boolean;
  trustedPaths: string[];
}

// ── Component ────────────────────────────────────────────────────────────────

export function ServerPermissionDrawer({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const queryClient = useQueryClient();

  // Local state mirrors server data — gives instant UI feedback without waiting
  // for the React Query cache to re-hydrate after a mutation.
  const [local, setLocal] = useState<PermState | null>(null);
  const [newTrustedPath, setNewTrustedPath] = useState('');
  const [dirty, setDirty] = useState(false);

  const { data: perm, isLoading } = useQuery({
    queryKey: ['permissions', serverId],
    queryFn: async () => {
      const res = await apiFetch(`/api/permissions/${serverId}`);
      return res.json();
    },
    enabled: !!serverId,
  });

  // Seed local state the first time server data arrives (or when drawer is reopened)
  useEffect(() => {
    if (perm && !local) {
      setLocal({
        pathRead:       Boolean(perm.pathRead),
        pathWrite:      Boolean(perm.pathWrite),
        bashAllowed:    Boolean(perm.bashAllowed),
        networkAllowed: Boolean(perm.networkAllowed),
        subprocessAllowed: Boolean(perm.subprocessAllowed),
        autoApproveReads: Boolean(perm.autoApproveReads),
        trustedPaths:   Array.isArray(perm.trustedPaths) ? perm.trustedPaths : [],
      });
    }
  }, [perm, local]);

  const mutation = useMutation({
    mutationFn: async (updates: Partial<PermState>) => {
      console.log('[ServerPermissionDrawer] Payload:', updates);
      const res = await apiFetch(`/api/permissions/${serverId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to save permissions');
      return res.json();
    },
    onSuccess: (saved: any) => {
      // Overwrite local state with confirmed server data
      setLocal({
        pathRead:       Boolean(saved.pathRead),
        pathWrite:      Boolean(saved.pathWrite),
        bashAllowed:    Boolean(saved.bashAllowed),
        networkAllowed: Boolean(saved.networkAllowed),
        subprocessAllowed: Boolean(saved.subprocessAllowed),
        autoApproveReads: Boolean(saved.autoApproveReads),
        trustedPaths:   Array.isArray(saved.trustedPaths) ? saved.trustedPaths : [],
      });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['permissions', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const toggle = (key: keyof PermState) => {
    setLocal(prev => {
      if (!prev) return prev;
      const next = { ...prev, [key]: !(prev[key] as boolean) };
      return next;
    });
    setDirty(true);
  };

  const addTrustedPath = () => {
    const trimmed = newTrustedPath.trim();
    if (!trimmed || !local) return;
    if (local.trustedPaths.includes(trimmed)) {
      setNewTrustedPath('');
      return;
    }
    setLocal(prev => prev ? { ...prev, trustedPaths: [...prev.trustedPaths, trimmed] } : prev);
    setNewTrustedPath('');
    setDirty(true);
  };

  const removeTrustedPath = (path: string) => {
    setLocal(prev => prev ? { ...prev, trustedPaths: prev.trustedPaths.filter(p => p !== path) } : prev);
    setDirty(true);
  };

  const save = () => {
    if (!local) return;
    mutation.mutate(local);
  };

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

              {/* ── Trust Policy ──────────────────────────────────────────── */}
              <div className="pt-4 border-t border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-3 h-3 text-yellow-400" />
                  <p className="text-[10px] text-yellow-400 uppercase tracking-wider font-bold">Trust Policy</p>
                </div>

                {/* Auto-Approve Reads toggle */}
                <button
                  onClick={() => toggle('autoApproveReads')}
                  className="w-full flex items-start justify-between cursor-pointer mb-3"
                >
                  <div className="text-left">
                    <div className="text-xs text-gray-300 font-mono">Auto-Approve Read Ops</div>
                    <div className="text-[10px] text-gray-600 mt-0.5">Skip approval for reads in trusted dirs</div>
                  </div>
                  <div className={`w-8 h-4 rounded-full transition-colors relative shrink-0 mt-0.5 ${local.autoApproveReads ? 'bg-yellow-500' : 'bg-zinc-700'}`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${local.autoApproveReads ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </div>
                </button>

                {/* Warning when enabled but no trusted paths */}
                {local.autoApproveReads && local.trustedPaths.length === 0 && (
                  <div className="mb-2 px-2 py-1.5 bg-yellow-950/30 border border-yellow-500/20 rounded text-[10px] font-mono text-yellow-500">
                    ⚠ Add trusted directories below, or no reads will be silenced.
                  </div>
                )}

                {/* Trusted Paths list */}
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Trusted Directories</p>
                <div className="space-y-1 mb-2">
                  {local.trustedPaths.length > 0 ? local.trustedPaths.map((tp) => (
                    <div key={tp} className="flex items-center justify-between bg-yellow-950/20 border border-yellow-500/20 rounded px-2 py-1">
                      <span className="text-[11px] font-mono text-yellow-300 truncate flex-1">{tp}</span>
                      <button
                        onClick={() => removeTrustedPath(tp)}
                        className="ml-2 text-gray-600 hover:text-rose-400 transition-colors shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )) : (
                    <div className="text-[10px] text-gray-600 italic">e.g. /tmp, /logs, /home/user/project</div>
                  )}
                </div>

                {/* Add path input */}
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newTrustedPath}
                    onChange={(e) => setNewTrustedPath(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTrustedPath(); } }}
                    placeholder="/path/to/trust"
                    className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-[11px] font-mono text-gray-300 placeholder-gray-700 focus:outline-none focus:ring-1 focus:ring-yellow-500/40 focus:border-yellow-500/40"
                  />
                  <button
                    onClick={addTrustedPath}
                    disabled={!newTrustedPath.trim()}
                    className="px-2 py-1.5 bg-yellow-950/40 border border-yellow-500/30 hover:bg-yellow-900/40 text-yellow-400 rounded transition-colors disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-[9px] text-gray-600 mt-2 leading-tight">
                  Destructive actions (write, delete) always require approval regardless of this setting.
                </p>
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

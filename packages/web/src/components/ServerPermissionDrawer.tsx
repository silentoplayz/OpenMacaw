import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, AlertOctagon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '../api';

export function ServerPermissionDrawer({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: perm } = useQuery({
    queryKey: ['permissions', serverId],
    queryFn: async () => {
      const res = await apiFetch(`/api/permissions/${serverId}`);
      return res.json();
    },
    enabled: !!serverId,
  });

  const mutation = useMutation({
    mutationFn: async (updates: any) => {
      await apiFetch(`/api/permissions/${serverId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['permissions', serverId] })
  });

  if (!perm) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed inset-y-0 right-0 w-80 bg-zinc-950/95 backdrop-blur-md border-l border-white/10 shadow-2xl z-50 flex flex-col"
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-cyan-500" /> Server Permissions
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <AlertOctagon className="w-4 h-4 rotate-45" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {[
            { key: 'pathRead', label: 'File Read' },
            { key: 'pathWrite', label: 'File Write' },
            { key: 'bashAllowed', label: 'Command Execution' },
            { key: 'networkAllowed', label: 'Network Access' },
            { key: 'subprocessAllowed', label: 'Subprocesses' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between cursor-pointer group">
              <span className="text-xs text-gray-300 font-mono">{label}</span>
              <div className={`w-8 h-4 rounded-full transition-colors relative ${perm[key] ? 'bg-cyan-500' : 'bg-zinc-700'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${perm[key] ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </div>
              <input 
                type="checkbox" 
                className="hidden" 
                checked={perm[key] || false} 
                onChange={(e) => mutation.mutate({ [key]: e.target.checked })} 
              />
            </label>
          ))}
          
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Allowed Paths</p>
            <div className="space-y-1">
              {perm.allowedPaths?.length > 0 ? (
                perm.allowedPaths.map((p: string, i: number) => (
                  <div key={i} className="text-xs text-gray-400 bg-black/50 px-2 py-1 rounded border border-white/5 font-mono truncate">{p}</div>
                ))
              ) : (
                <div className="text-xs text-gray-600 italic">No paths explicitly configured</div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../api';

interface ActivityEntry {
  id: string;
  serverId: string;
  toolName: string;
  toolInput: string;
  outcome: 'allowed' | 'denied';
  reason?: string;
  latency?: number;
  timestamp: string;
}

export default function AuditLog() {
  const [filter, setFilter] = useState<{ serverId?: string; outcome?: string }>({});

  const { data: activities, isLoading } = useQuery<ActivityEntry[]>({
    queryKey: ['activity', filter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.serverId) params.set('serverId', filter.serverId);
      if (filter.outcome) params.set('type', filter.outcome);
      params.set('limit', '100');
      
      const res = await apiFetch(`/api/activity?${params}`);
      return res.json();
    },
  });

  const { data: servers } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await apiFetch('/api/servers');
      return res.json();
    },
  });

  const serverMap = new Map(servers?.map(s => [s.id, s.name]) || []);

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-white/5">
        <h1 className="text-sm font-bold font-mono tracking-wider text-white flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.8)]"></span>
          AUDIT_LOG
        </h1>
        <div className="flex items-center gap-2">
          <select
            value={filter.serverId || ''}
            onChange={(e) => setFilter({ ...filter, serverId: e.target.value || undefined })}
            className="px-2 py-1 text-xs font-mono bg-black border border-white/10 rounded focus:outline-none focus:border-cyan-500 text-gray-300"
          >
            <option value="">* (ALL_SERVERS)</option>
            {servers?.map(server => (
              <option key={server.id} value={server.id}>{server.name}</option>
            ))}
          </select>
          <select
            value={filter.outcome || ''}
            onChange={(e) => setFilter({ ...filter, outcome: e.target.value || undefined })}
            className="px-2 py-1 text-xs font-mono bg-black border border-white/10 rounded focus:outline-none focus:border-cyan-500 text-gray-300"
          >
            <option value="">* (ALL_OUTCOMES)</option>
            <option value="allowed">ALLOWED</option>
            <option value="denied">DENIED</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[#050505]">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-zinc-950/90 backdrop-blur border-b border-white/5">
              <tr>
                <th className="px-3 py-2 text-[10px] font-mono text-gray-500 uppercase tracking-wider font-normal">Timestamp</th>
                <th className="px-3 py-2 text-[10px] font-mono text-gray-500 uppercase tracking-wider font-normal">Action Type</th>
                <th className="px-3 py-2 text-[10px] font-mono text-gray-500 uppercase tracking-wider font-normal">Target</th>
                <th className="px-3 py-2 text-[10px] font-mono text-gray-500 uppercase tracking-wider font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.02]">
              {activities?.map((activity) => (
                <tr key={activity.id} className="hover:bg-white/[0.02] transition-colors font-mono text-xs">
                  <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">
                    [{new Date(activity.timestamp).toISOString().replace('T', ' ').substring(0, 19)}]
                  </td>
                  <td className="px-3 py-1.5 text-cyan-600">
                    <span className="opacity-50">CALL </span>
                    {activity.toolName}
                  </td>
                  <td className="px-3 py-1.5 text-gray-400">
                    @{serverMap.get(activity.serverId) || activity.serverId}
                  </td>
                  <td className="px-3 py-1.5">
                    {activity.outcome === 'allowed' ? (
                        <span className="text-green-500">200 ALLOWED {activity.latency ? `(${activity.latency}ms)` : ''}</span>
                    ) : (
                        <span className="text-red-500">403 DENIED {activity.reason ? `- ${activity.reason}` : ''}</span>
                    )}
                  </td>
                </tr>
              ))}
              {activities?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-gray-600 font-mono text-xs">
                    No matching activity
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

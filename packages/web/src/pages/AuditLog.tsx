import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, ChevronRight, ChevronDown, Clock, SearchX } from 'lucide-react';
import React, { useState, useMemo, useEffect } from 'react';
import { apiFetch } from '../api';

interface ActivityEntry {
  id: string;
  serverId: string;
  toolName: string;
  toolInput: string;
  outcome: 'allowed' | 'denied' | 'auto_approved';
  reason?: string;
  latency?: number;
  timestamp: string;
}

export default function AuditLog() {
  const [filter, setFilter] = useState<{ serverId?: string; outcome?: string; search?: string }>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showRawJson, setShowRawJson] = useState(false);

  // Read preference from localStorage (set by Settings page)
  useEffect(() => {
    const pref = localStorage.getItem('openmacaw-show-raw-json');
    setShowRawJson(pref === 'true');
  }, []);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { data: activities, isLoading } = useQuery<ActivityEntry[]>({
    queryKey: ['activity', filter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.serverId) params.set('serverId', filter.serverId);
      if (filter.outcome) params.set('type', filter.outcome);
      if (filter.search) params.set('search', filter.search);
      params.set('limit', '100');
      
      const res = await apiFetch(`/api/activity?${params}`);
      return res.json();
    },
    refetchInterval: 3000, // auto-refresh every 3s
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
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search actions or payloads..."
              value={filter.search || ''}
              onChange={(e) => setFilter({ ...filter, search: e.target.value || undefined })}
              className="pl-7 pr-2 py-1 text-xs font-mono bg-black border border-white/10 rounded focus:outline-none focus:border-cyan-500 text-gray-300 w-56 placeholder-gray-600 transition-colors"
            />
          </div>
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
            <option value="auto_approved">⚡ AUTO</option>
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
              {activities?.map((activity) => {
                const isExpanded = showRawJson || expandedRows.has(activity.id);
                const latencyColor = activity.latency 
                  ? (activity.latency < 500 ? 'text-green-500' : activity.latency < 2000 ? 'text-yellow-500' : 'text-red-500')
                  : '';
                
                return (
                  <React.Fragment key={activity.id}>
                    <tr onClick={() => toggleRow(activity.id)} className={`hover:bg-white/[0.05] cursor-pointer transition-colors font-mono text-xs ${isExpanded ? 'bg-white/[0.02]' : ''}`}>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap flex items-center gap-1">
                        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        [{new Date(activity.timestamp).toISOString().replace('T', ' ').substring(0, 19)}]
                      </td>
                      <td className="px-3 py-2 text-cyan-600">
                        <span className="opacity-50">CALL </span>
                        {activity.toolName}
                      </td>
                      <td className="px-3 py-2 text-gray-400">
                        @{serverMap.get(activity.serverId) || activity.serverId}
                      </td>
                      <td className="px-3 py-2">
                        {activity.outcome === 'auto_approved' ? (
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">⚡ AUTO</span>
                              {activity.latency && (
                                <span className={`flex items-center gap-1 ${latencyColor} opacity-80 text-[10px]`}>
                                  <Clock className="w-3 h-3" /> {activity.latency}ms
                                </span>
                              )}
                            </div>
                        ) : activity.outcome === 'allowed' ? (
                            <div className="flex items-center gap-2">
                              <span className="text-green-500">200 ALLOWED</span>
                              {activity.latency && (
                                <span className={`flex items-center gap-1 ${latencyColor} opacity-80 text-[10px]`}>
                                  <Clock className="w-3 h-3" /> {activity.latency}ms
                                </span>
                              )}
                            </div>
                        ) : (
                            <span className="text-red-500 truncate block max-w-xs" title={activity.reason}>403 DENIED {activity.reason ? `- ${activity.reason}` : ''}</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-black/50 border-t border-white/[0.02]">
                        <td colSpan={4} className="px-7 py-3">
                          <div className="grid grid-cols-1 gap-3">
                            {activity.toolInput && (
                              <div>
                                <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider block mb-1">Payload / Input Arguments</span>
                                <pre className="text-[10px] font-mono whitespace-pre-wrap bg-zinc-950 border border-white/5 p-2 rounded text-gray-300 max-h-48 overflow-y-auto w-full">
                                  {(() => {
                                    try { 
                                      return JSON.stringify(JSON.parse(activity.toolInput), null, 2); 
                                    } catch { 
                                      return activity.toolInput; 
                                    }
                                  })()}
                                </pre>
                              </div>
                            )}
                            {activity.outcome === 'denied' && activity.reason && (
                              <div>
                                <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider block mb-1">Denial Reason</span>
                                <div className="text-[11px] font-mono text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2 rounded break-words">
                                  {activity.reason}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {activities?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-16 text-center text-gray-500 font-mono">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <SearchX className="w-8 h-8 opacity-20" />
                      <span className="opacity-60 text-xs">No matching activity records found</span>
                    </div>
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

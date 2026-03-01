import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Play, Square, Trash2, Shield, Loader2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../api';

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

export default function Servers() {
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
    }
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
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">MCP Servers</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500"
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
            <p className="text-sm text-red-400 mt-1 whitespace-pre-wrap font-mono relative max-h-40 overflow-y-auto w-full break-all leading-snug">
              {errorMsg}
            </p>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-500/50 hover:text-red-500">×</button>
        </div>
      )}

      {showForm && (
        <div className="mb-6 p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-white/10 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Add MCP Server</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Transport</label>
              <select
                value={formData.transport}
                onChange={(e) => setFormData({ ...formData, transport: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="stdio">Stdio</option>
                <option value="http">HTTP/SSE</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Command</label>
              <input
                type="text"
                value={formData.command}
                onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                placeholder="npx"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Arguments (JSON array)</label>
              <input
                type="text"
                value={formData.args}
                onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                placeholder='["-y", "some-mcp-server"]'
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50"
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Server'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
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
        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden shadow-sm">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Transport</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Tools</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {servers?.map((server) => (
                <tr key={server.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{server.name}</td>
                  <td className="px-4 py-3 text-gray-500">{server.transport}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(server.status)}`}>
                      {server.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{server.toolCount}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {server.status === 'running' ? (
                        <button
                          onClick={() => stopMutation.mutate(server.id)}
                          disabled={stopMutation.isPending}
                          className="p-1 hover:bg-gray-100 rounded"
                          title="Stop"
                        >
                          <Square className="w-4 h-4 text-red-600" />
                        </button>
                      ) : (
                        <button
                          onClick={() => startMutation.mutate(server.id)}
                          disabled={startMutation.isPending && startingId !== server.id}
                          className="p-1 hover:bg-gray-100 rounded"
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
                        className="p-1 hover:bg-gray-100 rounded"
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
                        className="p-1 hover:bg-gray-100 rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-600" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {servers?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                    No servers configured. Add one to get started.
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

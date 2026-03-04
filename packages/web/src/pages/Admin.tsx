import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, MessageSquare, Database, Trash2, ShieldAlert, Loader2, Pencil, X, Save } from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';

interface AdminStats {
  totalUsers: number;
  totalSessions: number;
  totalMessages: number;
  dbSizeBytes: number;
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  lastActive: string | null;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(dateInput: string | number | null): string {
  if (!dateInput) return 'Never';
  const date = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
  const now = Date.now();
  const seconds = Math.floor((now - date.getTime()) / 1000);
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditUserModal({
  user,
  currentUserId,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [error, setError] = useState('');

  const isSelf = user.id === currentUserId;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Update failed');
      }
      return res.json();
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  return (
    <>
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Edit User</h2>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-md transition-colors">
              <X className="w-4 h-4 text-gray-500 hover:text-white" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4">
            {error && (
              <div className="px-3 py-2 bg-rose-950/50 border border-rose-500/20 rounded-md text-xs text-rose-400 font-mono">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={isSelf}
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
              {isSelf && (
                <p className="mt-1 text-[10px] text-gray-600 font-mono">You cannot change your own role.</p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-white/5 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-mono text-gray-400 hover:text-white hover:bg-white/5 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold uppercase tracking-wider rounded-md transition-colors disabled:opacity-50"
            >
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Admin Page ────────────────────────────────────────────────────────────────

export default function Admin() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/stats');
      if (!res.ok) throw new Error('Failed to load stats');
      return res.json();
    },
  });

  const { data: users, isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/users');
      if (!res.ok) throw new Error('Failed to load users');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Delete failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      setConfirmDeleteId(null);
    },
  });

  const statCards = [
    {
      label: 'Total Users',
      value: stats?.totalUsers ?? '—',
      icon: Users,
      color: 'text-cyan-400',
      bg: 'bg-cyan-950/30',
      border: 'border-cyan-500/20',
    },
    {
      label: 'Total Sessions',
      value: stats?.totalSessions ?? '—',
      icon: MessageSquare,
      color: 'text-emerald-400',
      bg: 'bg-emerald-950/30',
      border: 'border-emerald-500/20',
    },
    {
      label: 'Total Messages',
      value: stats?.totalMessages ?? '—',
      icon: MessageSquare,
      color: 'text-amber-400',
      bg: 'bg-amber-950/30',
      border: 'border-amber-500/20',
    },
    {
      label: 'Database Size',
      value: stats ? formatBytes(stats.dbSizeBytes) : '—',
      icon: Database,
      color: 'text-purple-400',
      bg: 'bg-purple-950/30',
      border: 'border-purple-500/20',
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-black min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-amber-950/30 rounded-lg border border-amber-500/20">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white font-mono tracking-wide">Admin Console</h1>
          <p className="text-xs text-gray-500 font-mono">System overview & user management</p>
        </div>
      </div>

      {/* System Pulse Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={`${card.bg} border ${card.border} rounded-lg p-4 transition-all hover:scale-[1.02]`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
                  {card.label}
                </span>
                <Icon className={`w-4 h-4 ${card.color} opacity-60`} />
              </div>
              <p className={`text-2xl font-bold font-mono ${card.color}`}>
                {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : card.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* User Management Table */}
      <div className="border border-white/10 rounded-lg overflow-hidden bg-zinc-950/50">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <span className="text-xs font-mono uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-cyan-500" />
            User Management
          </span>
          <span className="text-[10px] text-gray-600 font-mono">
            {users?.length ?? 0} users
          </span>
        </div>

        {usersLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
          </div>
        ) : !users || users.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">No users found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/5 bg-black/50">
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium">Name</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium">Email</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium">Role</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium">Last Active</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium">Created</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  const isConfirming = confirmDeleteId === u.id;
                  return (
                    <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0">
                            <span className="text-xs font-mono font-bold text-gray-400 uppercase">
                              {u.name?.charAt(0) || '?'}
                            </span>
                          </div>
                          <span className="text-sm text-gray-200 font-medium">{u.name}</span>
                          {isSelf && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/50 text-cyan-400 font-mono border border-cyan-500/20">
                              you
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400 font-mono">{u.email}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold font-mono uppercase tracking-wider ${
                            u.role === 'admin'
                              ? 'bg-amber-950/50 text-amber-400 border border-amber-500/30'
                              : 'bg-blue-950/50 text-blue-400 border border-blue-500/30'
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                        {timeAgo(u.lastActive)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isConfirming ? (
                          <div className="flex items-center gap-1.5 justify-end">
                            <button
                              onClick={() => deleteMutation.mutate(u.id)}
                              disabled={deleteMutation.isPending}
                              className="px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-rose-950/50 text-rose-400 border border-rose-500/30 rounded hover:bg-rose-900/50 transition-colors"
                            >
                              {deleteMutation.isPending ? '...' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 text-[10px] font-mono text-gray-500 hover:text-gray-300 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => setEditingUser(u)}
                              className="p-1.5 rounded hover:bg-cyan-950/30 text-gray-500 hover:text-cyan-400 transition-colors"
                              title="Edit user"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {!isSelf && (
                              <button
                                onClick={() => setConfirmDeleteId(u.id)}
                                className="p-1.5 rounded hover:bg-rose-950/30 text-gray-500 hover:text-rose-400 transition-colors"
                                title="Delete user"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit User Modal */}
      {editingUser && currentUser && (
        <EditUserModal
          user={editingUser}
          currentUserId={currentUser.id}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
          }}
        />
      )}
    </div>
  );
}

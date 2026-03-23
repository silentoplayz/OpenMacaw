import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Users, Save, Loader2, Cpu, Bot, Shield, CheckCircle2, ShieldAlert, Key, Plus, ExternalLink, Activity, Network, Pencil, X, Crown, Check, ArrowUpDown, ArrowUp, ArrowDown, MessageSquare, Database, Trash2, Settings2, ToggleLeft, ToggleRight, UserPlus } from 'lucide-react';
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
  isSuperAdmin: number;
  lastActive: string | null;
  createdAt: string;
}

interface WorkspaceSettings {
  // LLM Provider Settings
  OLLAMA_BASE_URL?: string;
  DEFAULT_PROVIDER?: string;
  DEFAULT_MODEL?: string;
  // Agent Behavior
  MAX_STEPS?: string;
  TEMPERATURE?: string;
  PERSONALITY?: string;
  // Advanced Directives
  STRICT_JSON_MODE?: string;
  MAX_DENIAL_RETRIES?: string;
  // Sign Ups
  ENABLE_SIGNUP?: string;
  DEFAULT_NEW_USER_ROLE?: string;
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

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button onClick={onToggle} className="flex items-center justify-between w-full py-2 group">
      <span className="text-sm text-gray-300">{label}</span>
      {enabled ? (
        <ToggleRight className="w-6 h-6 text-cyan-400 group-hover:text-cyan-300 transition-colors" />
      ) : (
        <ToggleLeft className="w-6 h-6 text-gray-600 group-hover:text-gray-400 transition-colors" />
      )}
    </button>
  );
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
  const { refreshUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const isSelf = user.id === currentUserId;

  const saveMutation = useMutation({
    mutationFn: async () => {
      setError('');

      // Password validation (only for non-self edits)
      if (!isSelf && newPassword) {
        if (newPassword.length < 8) {
          throw new Error('Password must be at least 8 characters.');
        }
        if (newPassword !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
      }

      const payload: Record<string, string> = { name, email, role };
      if (!isSelf && newPassword) {
        payload.password = newPassword;
      }

      const res = await apiFetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Update failed');
      }
      return res.json();
    },
    onSuccess: async (data: any) => {
      window.dispatchEvent(new CustomEvent('openmacaw:auth_refresh'));
      
      // Identity Sync (Phase 85): If the backend provided a fresh JWT for us
      if (isSelf && data.token) {
        // We must re-decode or simply fetch a fresh user object.
        // The easiest way is to let AuthContext refresh it.
        // However, `login` takes both token and user object. Let's update token in LC and refresh.
        localStorage.setItem('openmacaw_token', data.token);
      }

      // If editing our own profile, refresh global auth state so sidebar reflects changes instantly
      if (isSelf) {
        await refreshUser();
      }
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
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Edit User</h2>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-md transition-colors">
              <X className="w-4 h-4 text-gray-500 hover:text-white" />
            </button>
          </div>
          <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            {error && (
              <div className="px-3 py-2 bg-rose-950/50 border border-rose-500/20 rounded-md text-xs text-rose-400 font-mono">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf}
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono disabled:opacity-50 disabled:cursor-not-allowed">
                <option value="admin">Admin</option>
                <option value="user">User</option>
                <option value="pending">Pending</option>
              </select>
              {isSelf && <p className="mt-1 text-[10px] text-gray-600 font-mono">You cannot change your own role.</p>}
            </div>

            {/* Change Password — only for other users */}
            {!isSelf && (
              <div className="pt-2 border-t border-white/5 space-y-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Change Password</p>
                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Leave blank to keep unchanged"
                    className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono placeholder:text-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`w-full px-3 py-2 bg-black border rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 font-mono ${
                      confirmPassword && newPassword !== confirmPassword
                        ? 'border-rose-500/50 focus:ring-rose-500'
                        : 'border-white/10 focus:ring-cyan-500 focus:border-cyan-500'
                    }`}
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="mt-1 text-[10px] text-rose-400 font-mono">Passwords do not match.</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="px-5 py-4 border-t border-white/5 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-gray-400 hover:text-white hover:bg-white/5 rounded-md transition-colors">Cancel</button>
            <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold uppercase tracking-wider rounded-md transition-colors disabled:opacity-50">
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Add User Modal ────────────────────────────────────────────────────────────

function AddUserModal({
  onClose,
  onSaved,
  viewerIsSuperAdmin,
}: {
  onClose: () => void;
  onSaved: () => void;
  viewerIsSuperAdmin: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('user');
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!name.trim() || !email.trim() || !password) {
        throw new Error('Name, email, and password are required.');
      }
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }
      const res = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Create failed');
      }
      return res.json();
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <>
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Add User</h2>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-md transition-colors">
              <X className="w-4 h-4 text-gray-500 hover:text-white" />
            </button>
          </div>
          <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            {error && (
              <div className="px-3 py-2 bg-rose-950/50 border border-rose-500/20 rounded-md text-xs text-rose-400 font-mono">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Display name"
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 font-mono placeholder:text-gray-600" />
            </div>
            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 font-mono placeholder:text-gray-600" />
            </div>
            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 font-mono">
                <option value="user">User</option>
                {viewerIsSuperAdmin && <option value="admin">Admin</option>}
                <option value="pending">Pending</option>
              </select>
              {!viewerIsSuperAdmin && (
                <p className="mt-1 text-[10px] text-gray-600 font-mono">Only the Super Admin can create Admin accounts.</p>
              )}
            </div>
            <div className="pt-2 border-t border-white/5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Set Password</p>
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 font-mono placeholder:text-gray-600" />
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Confirm Password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full px-3 py-2 bg-black border rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 font-mono ${
                    confirmPassword && password !== confirmPassword
                      ? 'border-rose-500/50 focus:ring-rose-500'
                      : 'border-white/10 focus:ring-emerald-500 focus:border-emerald-500'
                  }`} />
                {confirmPassword && password !== confirmPassword && (
                  <p className="mt-1 text-[10px] text-rose-400 font-mono">Passwords do not match.</p>
                )}
              </div>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-white/5 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-gray-400 hover:text-white hover:bg-white/5 rounded-md transition-colors">Cancel</button>
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold uppercase tracking-wider rounded-md transition-colors disabled:opacity-50">
              {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Create User
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
  const [addingUser, setAddingUser] = useState(false);

  // ── Workspace Settings state ──────────────────────────────────────────────
  const [wsForm, setWsForm] = useState<WorkspaceSettings>({});
  const [wsSaveStatus, setWsSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelCapability, setModelCapability] = useState<'ok' | 'no_tools' | 'checking' | null>(null);

  type SortField = 'name' | 'email' | 'role' | 'lastActive' | 'createdAt';
  type SortDirection = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('role'); // Default sort by role (brings pending up initially)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

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

  const viewerIsSuperAdmin = users?.find(x => x.id === currentUser?.id)?.isSuperAdmin === 1;

  // Fetch workspace (global) settings
  useQuery<WorkspaceSettings>({
    queryKey: ['workspace-settings'],
    queryFn: async () => {
      const res = await apiFetch('/api/settings');
      const data = await res.json();
      setWsForm(data);
      return data;
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

  const approveMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user' })
      });
      if (!res.ok) throw new Error('Failed to approve user');
      return res.json();
    },
    onSuccess: () => {
      window.dispatchEvent(new CustomEvent('openmacaw:auth_refresh'));
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const wsSaveMutation = useMutation({
    mutationFn: async (updates: WorkspaceSettings) => {
      for (const [key, value] of Object.entries(updates)) {
        await apiFetch(`/api/settings/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-settings'] });
      setWsSaveStatus('saved');
      setTimeout(() => setWsSaveStatus('idle'), 2000);
    },
  });

  const handleWsSave = () => {
    setWsSaveStatus('saving');
    wsSaveMutation.mutate(wsForm);
  };

  const sortedUsers = useMemo(() => {
    if (!users) return [];
    return [...users].sort((a, b) => {
      // Always put 'pending' at the absolute top, regardless of sort, UNLESS we are explicitly sorting by role. 
      // Actually, if we sort by Role, pending vs user vs admin will naturally cluster.
      // Let's implement full sorting for the selected column.
      
      let valA: any = a[sortField];
      let valB: any = b[sortField];
      
      if (sortField === 'name') {
         valA = a.name?.toLowerCase() || '';
         valB = b.name?.toLowerCase() || '';
      } else if (sortField === 'email') {
         valA = a.email?.toLowerCase() || '';
         valB = b.email?.toLowerCase() || '';
      } else if (sortField === 'role') {
         // Custom role weight: pending (0), admin (1), user (2)
         const roleWeight = (r: string) => r === 'pending' ? 0 : r === 'admin' ? 1 : 2;
         valA = roleWeight(a.role);
         valB = roleWeight(b.role);
      } else if (sortField === 'lastActive') {
         // Push nulls to the bottom regardless of asc/desc, or treat nulls as 0. 
         valA = a.lastActive || 0;
         valB = b.lastActive || 0;
      } else if (sortField === 'createdAt') {
         valA = a.createdAt || 0;
         valB = b.createdAt || 0;
      }
      
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [users, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-30 group-hover:opacity-100 transition-opacity" />;
    return sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  const fetchOllamaModels = async () => {
    setFetchingModels(true);
    try {
      const res = await apiFetch('/api/ollama/tags');
      const data = await res.json();
      if (data.models) setAvailableModels(data.models.map((m: any) => m.name));
    } catch { /* ignore */ } finally {
      setFetchingModels(false);
    }
  };

  // Model capability check
  useEffect(() => {
    const model = wsForm.DEFAULT_MODEL;
    if (!model) { setModelCapability(null); return; }
    setModelCapability('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/check-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model }),
        });
        const data = await res.json();
        setModelCapability(data.supportsTools === true ? 'ok' : data.supportsTools === false ? 'no_tools' : null);
      } catch { setModelCapability(null); }
    }, 500);
    return () => clearTimeout(timer);
  }, [wsForm.DEFAULT_MODEL]);

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers ?? '—', icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-950/30', border: 'border-cyan-500/20' },
    { label: 'Total Sessions', value: stats?.totalSessions ?? '—', icon: MessageSquare, color: 'text-emerald-400', bg: 'bg-emerald-950/30', border: 'border-emerald-500/20' },
    { label: 'Total Messages', value: stats?.totalMessages ?? '—', icon: MessageSquare, color: 'text-amber-400', bg: 'bg-amber-950/30', border: 'border-amber-500/20' },
    { label: 'Database Size', value: stats ? formatBytes(stats.dbSizeBytes) : '—', icon: Database, color: 'text-purple-400', bg: 'bg-purple-950/30', border: 'border-purple-500/20' },
  ];

  const inputClass = "w-full px-3 py-2 border border-white/10 bg-zinc-900 text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono text-sm placeholder-zinc-500";
  const cardClass = "bg-zinc-900 border border-white/5 rounded-xl p-6";

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-black min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-amber-950/30 rounded-lg border border-amber-500/20">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Admin Control Center</h1>
          <p className="text-sm text-gray-500 font-mono mt-1 opacity-80">System-wide governance, user management & security protocols.</p>
        </div>
      </div>

      {/* System Pulse Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`${card.bg} border ${card.border} rounded-lg p-4 transition-all hover:scale-[1.02]`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">{card.label}</span>
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
      <div className="border border-white/10 rounded-lg overflow-hidden bg-zinc-950/50 mb-8">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <span className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-500" />
            User Management
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-600 font-mono">{users?.length ?? 0} users</span>
            <button
              onClick={() => setAddingUser(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-emerald-950/50 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-500/20 rounded transition-colors text-[10px] font-mono font-bold uppercase tracking-wider"
            >
              <UserPlus className="w-3 h-3" />
              Add User
            </button>
          </div>
        </div>
        {usersLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
        ) : !users || users.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">No users found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/5 bg-black/50">
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium">
                    <button onClick={() => handleSort('name')} className="flex items-center gap-1.5 hover:text-gray-300 group">Name <SortIcon field="name" /></button>
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium">
                    <button onClick={() => handleSort('email')} className="flex items-center gap-1.5 hover:text-gray-300 group">Email <SortIcon field="email" /></button>
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium">
                    <button onClick={() => handleSort('role')} className="flex items-center gap-1.5 hover:text-gray-300 group">Role <SortIcon field="role" /></button>
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium">
                    <button onClick={() => handleSort('lastActive')} className="flex items-center gap-1.5 hover:text-gray-300 group">Last Active <SortIcon field="lastActive" /></button>
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium">
                    <button onClick={() => handleSort('createdAt')} className="flex items-center gap-1.5 hover:text-gray-300 group">Created <SortIcon field="createdAt" /></button>
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sortedUsers.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  const isConfirming = confirmDeleteId === u.id;
                  const targetIsAdmin = u.role === 'admin';
                  // King can act on everyone except themselves; standard admin blocked from other admins
                  const canActOnTarget = !isSelf && (viewerIsSuperAdmin || !targetIsAdmin);
                  const canEditTarget = isSelf || canActOnTarget;
                  return (
                    <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0">
                            <span className="text-xs font-mono font-bold text-gray-400 uppercase">{u.name?.charAt(0) || '?'}</span>
                          </div>
                          <span className="text-sm text-gray-200 font-medium">{u.name}</span>
                          {isSelf && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/50 text-cyan-400 font-mono border border-cyan-500/20">you</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400 font-mono">{u.email}</td>
                      <td className="px-4 py-3">
                        {u.isSuperAdmin === 1 ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold font-mono uppercase tracking-wider bg-amber-950/50 text-amber-400 border border-amber-500/30">
                            <Crown className="w-3 h-3" />
                            Super Admin
                          </span>
                        ) : (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold font-mono uppercase tracking-wider ${
                            u.role === 'pending' ? 'bg-zinc-800 text-gray-400 border border-white/10' :
                            u.role === 'admin' ? 'bg-amber-950/50 text-amber-400 border border-amber-500/30' : 'bg-blue-950/50 text-blue-400 border border-blue-500/30'
                          }`}>{u.role}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono">{timeAgo(u.lastActive)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        {isConfirming ? (
                          <div className="flex items-center gap-1.5 justify-end">
                            <button onClick={() => deleteMutation.mutate(u.id)} disabled={deleteMutation.isPending}
                              className="px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-rose-950/50 text-rose-400 border border-rose-500/30 rounded hover:bg-rose-900/50 transition-colors">
                              {deleteMutation.isPending ? '...' : 'Confirm'}
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 text-[10px] font-mono text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 justify-end">
                            {u.role === 'pending' && canActOnTarget && (
                              <button
                                onClick={() => approveMutation.mutate(u.id)}
                                disabled={approveMutation.isPending}
                                className="p-1 px-2 flex items-center gap-1.5 rounded bg-emerald-950/40 text-emerald-400 hover:bg-emerald-900/40 border border-emerald-500/20 mr-1 transition-colors font-mono text-[10px] uppercase font-bold tracking-wider"
                                title="Approve user"
                              >
                                {approveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                Approve
                              </button>
                            )}
                            <button
                              onClick={() => canEditTarget ? setEditingUser(u) : undefined}
                              disabled={!canEditTarget}
                              className={`p-1.5 rounded transition-colors ${
                                canEditTarget
                                  ? 'hover:bg-cyan-950/30 text-gray-500 hover:text-cyan-400 cursor-pointer'
                                  : 'text-gray-700 cursor-not-allowed opacity-40'
                              }`}
                              title={canEditTarget ? 'Edit user' : 'You do not have permission to modify another Admin.'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {!isSelf && (
                              <button
                                onClick={() => canActOnTarget ? setConfirmDeleteId(u.id) : undefined}
                                disabled={!canActOnTarget}
                                className={`p-1.5 rounded transition-colors ${
                                  canActOnTarget
                                    ? 'hover:bg-rose-950/30 text-gray-500 hover:text-rose-400 cursor-pointer'
                                    : 'text-gray-700 cursor-not-allowed opacity-40'
                                }`}
                                title={canActOnTarget ? 'Delete user' : 'You do not have permission to modify another Admin.'}
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

      {/* ═══════════════════════════════════════════════════════════════════════════
          WORKSPACE SETTINGS — Admin-only global configuration
          ═══════════════════════════════════════════════════════════════════════════ */}
      {viewerIsSuperAdmin && (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Workspace Settings</h2>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-400 font-mono border border-amber-500/20">Admin Only</span>
          </div>
          <div className="flex items-center gap-3">
            {wsSaveStatus === 'saved' && <span className="text-green-500 text-xs font-mono animate-pulse">Saved!</span>}
            <button onClick={handleWsSave} disabled={wsSaveStatus === 'saving'}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-500 disabled:opacity-50 transition-colors text-xs font-bold font-mono uppercase tracking-wider">
              {wsSaveStatus === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Workspace
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* LLM Provider Defaults */}
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="w-4 h-4 text-cyan-500" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">LLM Provider Defaults</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Ollama Base URL</label>
                <input type="text" value={wsForm.OLLAMA_BASE_URL || ''} onChange={(e) => setWsForm({ ...wsForm, OLLAMA_BASE_URL: e.target.value })}
                  placeholder="http://localhost:11434" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Default Provider</label>
                <select value={wsForm.DEFAULT_PROVIDER || 'anthropic'} onChange={(e) => setWsForm({ ...wsForm, DEFAULT_PROVIDER: e.target.value })} className={inputClass}>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI</option>
                  <option value="ollama">Ollama (Local)</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <label className="block text-xs font-medium text-gray-400">Default Model</label>
                    {modelCapability === 'checking' && <Loader2 className="w-3 h-3 text-cyan-500 animate-spin" />}
                    {modelCapability === 'ok' && (
                      <span className="flex items-center gap-1 text-[9px] font-mono text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">
                        <CheckCircle2 className="w-3 h-3" /> Tool capable
                      </span>
                    )}
                    {modelCapability === 'no_tools' && (
                      <span className="flex items-center gap-1 text-[9px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                        <ShieldAlert className="w-3 h-3" /> No tool support
                      </span>
                    )}
                  </div>
                  {wsForm.DEFAULT_PROVIDER === 'ollama' && (
                    <button onClick={fetchOllamaModels} disabled={fetchingModels}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 disabled:opacity-50 flex items-center gap-1 font-mono">
                      {fetchingModels && <Loader2 className="w-3 h-3 animate-spin" />} Refresh
                    </button>
                  )}
                </div>
                {availableModels.length > 0 && wsForm.DEFAULT_PROVIDER === 'ollama' ? (
                  <select value={wsForm.DEFAULT_MODEL || ''} onChange={(e) => setWsForm({ ...wsForm, DEFAULT_MODEL: e.target.value })} className={inputClass}>
                    <option value="">Select a model...</option>
                    {availableModels.map(model => <option key={model} value={model}>{model}</option>)}
                  </select>
                ) : (
                  <input type="text" value={wsForm.DEFAULT_MODEL || ''} onChange={(e) => setWsForm({ ...wsForm, DEFAULT_MODEL: e.target.value })}
                    placeholder="claude-sonnet-4-5-20250929" className={inputClass} />
                )}
              </div>
            </div>
          </div>

          {/* Agent Behavior */}
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-4">
              <Bot className="w-4 h-4 text-cyan-500" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Agent Behavior</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Max Steps</label>
                <input type="number" value={wsForm.MAX_STEPS || '50'} onChange={(e) => setWsForm({ ...wsForm, MAX_STEPS: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Temperature</label>
                <input type="number" step="0.1" min="0" max="2" value={wsForm.TEMPERATURE || '1.0'}
                  onChange={(e) => setWsForm({ ...wsForm, TEMPERATURE: e.target.value })} className={inputClass} />
              </div>
            </div>
          </div>

          {/* Advanced Directives */}
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-cyan-500" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Advanced Directives</h3>
            </div>
            <div className="space-y-3">
              <Toggle
                enabled={wsForm.ENABLE_SIGNUP !== 'false'}
                onToggle={() => setWsForm({ ...wsForm, ENABLE_SIGNUP: wsForm.ENABLE_SIGNUP === 'false' ? 'true' : 'false' })}
                label="Enable New Sign Ups"
              />
              <div className="pt-2">
                <label className="block text-xs font-medium text-gray-400 mb-1">Default Role for New Sign Ups</label>
                <select 
                  value={wsForm.DEFAULT_NEW_USER_ROLE || 'pending'} 
                  onChange={(e) => setWsForm({ ...wsForm, DEFAULT_NEW_USER_ROLE: e.target.value })} 
                  className={inputClass}
                >
                  <option value="pending">Pending (Requires Approval)</option>
                  <option value="user">User (Auto-Approved)</option>
                </select>
                <p className="text-[10px] text-gray-600 font-mono leading-relaxed mt-2">
                  Controls the gatekeeper flow for all incoming sign-ups.
                </p>
              </div>
              <Toggle
                enabled={wsForm.STRICT_JSON_MODE === 'true'}
                onToggle={() => setWsForm({ ...wsForm, STRICT_JSON_MODE: wsForm.STRICT_JSON_MODE === 'true' ? 'false' : 'true' })}
                label="Strict JSON Mode"
              />
              <p className="text-[10px] text-gray-600 font-mono leading-relaxed">
                Forces output as structured JSON with response_format.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Max Retries on Denial</label>
                <input type="number" min="1" max="10" value={wsForm.MAX_DENIAL_RETRIES || '3'}
                  onChange={(e) => setWsForm({ ...wsForm, MAX_DENIAL_RETRIES: e.target.value })} className={inputClass} />
              </div>
            </div>
          </div>

          {/* Personality */}
          <div className={`${cardClass} md:col-span-2 lg:col-span-3`}>
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-4 h-4 text-cyan-500" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Personality</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3 font-mono leading-relaxed">
              Describe the agent's style, tone, or domain focus. Appended to the base system prompt for all users.
            </p>
            <textarea value={wsForm.PERSONALITY || ''} onChange={(e) => setWsForm({ ...wsForm, PERSONALITY: e.target.value })}
              placeholder="e.g. Respond concisely in bullet points. Focus on Python and DevOps tasks."
              className={`${inputClass} min-h-[80px]`} />
          </div>
        </div>
      </div>
      )}

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

      {/* Add User Modal */}
      {addingUser && (
        <AddUserModal
          viewerIsSuperAdmin={viewerIsSuperAdmin || false}
          onClose={() => setAddingUser(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
          }}
        />
      )}
    </div>
  );
}

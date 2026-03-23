import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { Save, Loader2, Cpu, Monitor, ToggleLeft, ToggleRight, Smartphone, Download, CheckCircle2, Bell, BellOff, Key, User as UserIcon, Upload, Trash2, AlertTriangle, RefreshCcw, X, Info } from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';
import {
  notificationsSupported,
  notificationPermission,
  requestNotificationPermissionAsync,
  notifyAsync,
} from '../lib/notifications';

interface UserSettings {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  // UI Preferences
  AUTO_SCROLL_CHAT?: string;
  SHOW_RAW_JSON_LOGS?: string;
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

export default function Settings() {
  const queryClient = useQueryClient();
  const { user, refreshUser } = useAuth();
  const [formData, setFormData] = useState<UserSettings>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarSuccess, setAvatarSuccess] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await apiFetch('/api/user/profile', {
        method: 'PUT',
        // Omit Content-Type header so the browser automatically sets `multipart/form-data` with the correct boundary
        body: formData
      });
      if (res.ok) {
        await refreshUser();
        setAvatarSuccess(true);
        setTimeout(() => setAvatarSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Failed to upload avatar', err);
    } finally {
      setUploadingAvatar(false);
    }
  };

  // ── PWA / Notifications state ─────────────────────────────────────────────
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(() =>
    notificationsSupported() ? notificationPermission() : 'denied'
  );
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [pwaInstallable, setPwaInstallable] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);

  // Track global defaults to show "Using Server Default" hints
  const [globalDefaults, setGlobalDefaults] = useState<Record<string, string>>({});

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
      setPwaInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setPwaInstallable(false);
    }
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Fetch global defaults for placeholder hints
  useEffect(() => {
    apiFetch('/api/settings')
      .then(res => res.json())
      .then(data => setGlobalDefaults(data))
      .catch(() => {});
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      setPwaInstallable(false);
      setDeferredInstallPrompt(null);
    }
  };

  const handleRequestNotifications = async () => {
    setRequestingPerm(true);
    const result = await requestNotificationPermissionAsync();
    setNotifPerm(result);
    setRequestingPerm(false);
  };

  const handleTestNotification = () => {
    notifyAsync({
      title: 'Test notification',
      body: 'OpenMacaw notifications are working.',
      tag: 'openmacaw-test',
      url: '/settings',
    }).catch(() => {});
    if (notificationPermission() === 'granted') {
      new Notification('Test notification', {
        body: 'OpenMacaw notifications are working.',
        icon: '/icons/icon-192.svg',
      });
    }
  };

  const { isLoading } = useQuery<UserSettings>({
    queryKey: ['user-settings'],
    queryFn: async () => {
      const res = await apiFetch('/api/user/settings');
      const data = await res.json();
      setFormData(data);
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (updates: UserSettings) => {
      await apiFetch('/api/user/settings/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-settings'] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
  });

  const handleSave = () => {
    setSaveStatus('saving');
    saveMutation.mutate(formData);
  };

  const handleWipeHistory = async () => {
    setIsWiping(true);
    try {
      const res = await apiFetch('/api/sessions', { method: 'DELETE' });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        setConfirmingWipe(false);
        // Dispatch event for UI updates if necessary
        window.dispatchEvent(new CustomEvent('openmacaw:sessions-cleared'));
      }
    } catch (err) {
      console.error('Failed to wipe history', err);
    } finally {
      setIsWiping(false);
    }
  };

  const handleResetPreferences = async () => {
    setIsWiping(true);
    try {
      const res = await apiFetch('/api/user/settings', { method: 'DELETE' });
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: ['user-settings'] });
        setFormData({});
        setConfirmingReset(false);
      }
    } catch (err) {
      console.error('Failed to reset preferences', err);
    } finally {
      setIsWiping(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const inputClass = "w-full px-3 py-2 border border-white/10 bg-zinc-900 text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono text-sm placeholder-zinc-500";
  const cardClass = "bg-zinc-900 border border-white/5 rounded-xl p-6";

  const hasServerKey = (key: string) => !!globalDefaults[key];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Account Settings</h1>
          <p className="text-sm text-gray-500 font-mono mt-1.5 opacity-80">Configure your personal preferences and secure access tokens.</p>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* ── Profile ─────────────────────────────── */}
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <UserIcon className="w-4 h-4 text-cyan-500" />
              <h2 className="text-sm font-bold text-white uppercase tracking-widest">Profile</h2>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded border border-white/10 bg-zinc-950 flex items-center justify-center shrink-0 overflow-hidden shadow-inner">
              {user?.profileImageUrl ? (
                <img src={user.profileImageUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xl font-mono font-bold text-gray-500 uppercase">{user?.name?.charAt(0) || 'U'}</span>
              )}
            </div>
            <div>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded text-xs font-medium text-gray-200 transition-colors shadow-sm"
                type="button"
              >
                {uploadingAvatar ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {uploadingAvatar ? 'Uploading...' : 'Upload Avatar'}
              </button>
              {avatarSuccess ? (
                <p className="text-[10px] text-green-500 font-mono mt-2 leading-tight flex items-center gap-1 animate-pulse">
                  <CheckCircle2 className="w-3 h-3"/> Upload successful!
                </p>
              ) : (
                <p className="text-[10px] text-gray-500 font-mono mt-2 leading-tight">Recommended max size: 1MB.</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Personal API Keys ─────────────────────────────── */}
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-cyan-500" />
              <h2 className="text-sm font-bold text-white uppercase tracking-widest">API Tokens</h2>
            </div>
            <button
              onClick={() => {
                setSaveStatus('saving');
                saveMutation.mutate({
                  ANTHROPIC_API_KEY: formData.ANTHROPIC_API_KEY,
                  OPENAI_API_KEY: formData.OPENAI_API_KEY
                });
              }}
              disabled={saveStatus === 'saving'}
              className="px-3 py-1.5 bg-cyan-600/10 hover:bg-cyan-600 text-cyan-500 hover:text-white border border-cyan-500/20 rounded-lg text-[10px] font-bold uppercase transition-all"
            >
              {saveStatus === 'saving' ? <Loader2 className="w-3" /> : 'Save Keys'}
            </button>
          </div>
          <p className="text-[10px] text-gray-500 font-mono mb-6 leading-relaxed bg-black/20 p-2 rounded-lg border border-white/5">
            Personal keys override workspace defaults. Leave blank to inherit system-wide configuration.
          </p>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <label className="block text-xs font-bold text-gray-300">Anthropic Key</label>
                  <div className="group relative">
                    <Info className="w-3 h-3 text-gray-600 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-zinc-800 border border-white/10 rounded-lg text-[10px] text-gray-300 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                      Used for Claude models. Get yours at console.anthropic.com
                    </div>
                  </div>
                </div>
                {!formData.ANTHROPIC_API_KEY && hasServerKey('ANTHROPIC_API_KEY') && (
                  <span className="text-[8px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/10">Inheriting System Default</span>
                )}
              </div>
              <input
                type="password"
                value={formData.ANTHROPIC_API_KEY || ''}
                onChange={(e) => setFormData({ ...formData, ANTHROPIC_API_KEY: e.target.value })}
                placeholder={hasServerKey('ANTHROPIC_API_KEY') ? '•••• Server key configured' : 'sk-ant-...'}
                className={inputClass}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <label className="block text-xs font-bold text-gray-300">OpenAI Key</label>
                  <div className="group relative">
                    <Info className="w-3 h-3 text-gray-600 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-zinc-800 border border-white/10 rounded-lg text-[10px] text-gray-300 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                      Used for GPT models. Get yours at platform.openai.com
                    </div>
                  </div>
                </div>
                {!formData.OPENAI_API_KEY && hasServerKey('OPENAI_API_KEY') && (
                  <span className="text-[8px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/10">Inheriting System Default</span>
                )}
              </div>
              <input
                type="password"
                value={formData.OPENAI_API_KEY || ''}
                onChange={(e) => setFormData({ ...formData, OPENAI_API_KEY: e.target.value })}
                placeholder={hasServerKey('OPENAI_API_KEY') ? '•••• Server key configured' : 'sk-...'}
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* ── UI Preferences ─────────────────────────────── */}
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-cyan-500" />
              <h2 className="text-sm font-bold text-white uppercase tracking-widest">Interface</h2>
            </div>
            <button
              onClick={() => {
                setSaveStatus('saving');
                saveMutation.mutate({
                  AUTO_SCROLL_CHAT: formData.AUTO_SCROLL_CHAT,
                  SHOW_RAW_JSON_LOGS: formData.SHOW_RAW_JSON_LOGS
                });
              }}
              disabled={saveStatus === 'saving'}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-gray-400 hover:text-white border border-white/5 rounded-lg text-[10px] font-bold uppercase transition-all"
            >
              {saveStatus === 'saving' ? <Loader2 className="w-3" /> : 'Save UI'}
            </button>
          </div>
          <div className="space-y-1 divide-y divide-white/5">
            <Toggle
              enabled={formData.AUTO_SCROLL_CHAT === 'true'}
              onToggle={() => setFormData({ ...formData, AUTO_SCROLL_CHAT: formData.AUTO_SCROLL_CHAT === 'true' ? 'false' : 'true' })}
              label="Auto-Scroll Chat to Bottom"
            />
            <Toggle
              enabled={formData.SHOW_RAW_JSON_LOGS === 'true'}
              onToggle={() => {
                const newVal = formData.SHOW_RAW_JSON_LOGS === 'true' ? 'false' : 'true';
                setFormData({ ...formData, SHOW_RAW_JSON_LOGS: newVal });
                localStorage.setItem('openmacaw-show-raw-json', newVal);
              }}
              label="Show Raw JSON in Audit Logs"
            />
          </div>
        </div>

        {/* ── App & Notifications (PWA) ──────────────────── */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-5">
            <Smartphone className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">App & Notifications</h2>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {/* Install to home screen */}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-2">Install as App</p>
              {window.matchMedia('(display-mode: standalone)').matches ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-cyan-950/30 border border-cyan-500/20 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span className="text-xs text-cyan-300">Running as installed app</span>
                </div>
              ) : pwaInstallable ? (
                <button
                  onClick={handleInstallPwa}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition-colors shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                >
                  <Download className="w-4 h-4" />
                  Add to Home Screen
                </button>
              ) : (
                <p className="text-xs text-gray-500 font-mono">
                  Open this page in Chrome on Android and tap the browser menu &rarr; "Add to Home screen".
                </p>
              )}
            </div>

            {/* Notification permission */}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-2">Push Notifications</p>

              {!notificationsSupported() ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 border border-white/5 rounded-lg">
                  <BellOff className="w-4 h-4 text-gray-500 shrink-0" />
                  <span className="text-xs text-gray-500">Not supported in this browser</span>
                </div>
              ) : notifPerm === 'granted' ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-950/30 border border-green-500/20 rounded-lg">
                    <Bell className="w-4 h-4 text-green-400 shrink-0" />
                    <span className="text-xs text-green-300">Notifications enabled</span>
                  </div>
                  <button
                    onClick={handleTestNotification}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-zinc-800 border border-white/10 hover:bg-zinc-700 text-gray-300 rounded-lg text-xs font-mono transition-colors"
                  >
                    Send test notification
                  </button>
                </div>
              ) : notifPerm === 'denied' ? (
                <div className="flex items-start gap-2 px-3 py-2 bg-rose-950/20 border border-rose-500/20 rounded-lg">
                  <BellOff className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-300">
                    Blocked in browser settings. Reset site permissions and reload to re-enable.
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleRequestNotifications}
                  disabled={requestingPerm}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-zinc-800 border border-white/10 hover:bg-zinc-700 disabled:opacity-50 text-gray-200 rounded-lg text-sm font-medium transition-colors"
                >
                  {requestingPerm ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Bell className="w-4 h-4" />
                  )}
                  Enable Notifications
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Danger Zone ───────────────────────────────── */}
        <div className="bg-zinc-950 border border-rose-500/20 rounded-xl p-6 md:col-span-2">
          <div className="flex items-center gap-2 mb-5">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-bold text-rose-400 uppercase tracking-wider">Danger Zone</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col justify-between">
              <div>
                <h3 className="text-white text-sm font-medium mb-1">Clear Chat History</h3>
                <p className="text-[10px] text-gray-500 font-mono leading-relaxed mb-4">
                  Permanently delete all your conversations and messages. This action cannot be undone.
                </p>
              </div>
              <button 
                onClick={() => setConfirmingWipe(true)}
                className="w-fit flex items-center gap-2 px-4 py-2 bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white border border-rose-600/20 rounded-lg text-xs transition-all font-medium"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All Conversations
              </button>
            </div>

            <div className="flex flex-col justify-between">
              <div>
                <h3 className="text-white text-sm font-medium mb-1">Reset All Preferences</h3>
                <p className="text-[10px] text-gray-500 font-mono leading-relaxed mb-4">
                  Wipe all custom API keys and interface settings. Your account will return to server defaults.
                </p>
              </div>
              <button 
                onClick={() => setConfirmingReset(true)}
                className="w-fit flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-orange-600/20 text-gray-400 hover:text-orange-500 border border-white/5 hover:border-orange-500/30 rounded-lg text-xs transition-all font-medium"
              >
                <RefreshCcw className="w-3.5 h-3.5" />
                Reset Preferences
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modals */}
      {(confirmingWipe || confirmingReset) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={() => { setConfirmingWipe(false); setConfirmingReset(false); }}
          />
          <div className="relative bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${confirmingWipe ? 'bg-rose-500/20 text-rose-500' : 'bg-orange-500/20 text-orange-500'}`}>
              <AlertTriangle className="w-6 h-6" />
            </div>
            
            <h3 className="text-lg font-bold text-white mb-2">
              {confirmingWipe ? 'Wipe all history?' : 'Reset all preferences?'}
            </h3>
            <p className="text-sm text-gray-400 mb-6 font-mono leading-relaxed">
              {confirmingWipe 
                ? 'This will permanently delete every conversation you have ever had on this platform. This is irreversible.' 
                : 'This will erase your personal API keys and custom UI settings. You will need to re-configure them manually.'}
            </p>

            <div className="flex items-center gap-3">
              <button 
                onClick={() => { setConfirmingWipe(false); setConfirmingReset(false); }}
                disabled={isWiping}
                className="flex-1 py-2 text-sm font-medium text-gray-400 hover:text-white bg-zinc-800 rounded-lg transition-colors border border-white/5"
              >
                Cancel
              </button>
              <button 
                onClick={confirmingWipe ? handleWipeHistory : handleResetPreferences}
                disabled={isWiping}
                className={`flex-1 py-2 text-sm font-medium text-white rounded-lg transition-all flex items-center justify-center gap-2 ${confirmingWipe ? 'bg-rose-600 hover:bg-rose-500' : 'bg-orange-600 hover:bg-orange-500'}`}
              >
                {isWiping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

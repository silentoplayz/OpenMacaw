import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, Cpu, Monitor, ToggleLeft, ToggleRight, Smartphone, Download, CheckCircle2, Bell, BellOff, Key } from 'lucide-react';
import { apiFetch } from '../api';
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
  const [formData, setFormData] = useState<UserSettings>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Account Settings</h1>
          <p className="text-sm text-gray-500 font-mono mt-1">Your personal API keys and preferences.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-4 flex items-center justify-end">
            {saveStatus === 'saved' && <span className="text-green-500 text-xs font-mono animate-pulse">Saved!</span>}
          </div>
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="flex items-center gap-2 px-5 py-2.5 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50 transition-colors shadow-[0_0_15px_rgba(6,182,212,0.15)] min-w-[120px] justify-center"
          >
            {saveStatus === 'saving' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save All
          </button>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* ── Personal API Keys ─────────────────────────────── */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-5">
            <Key className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Personal API Keys</h2>
          </div>
          <p className="text-[10px] text-gray-600 font-mono mb-4 leading-relaxed">
            Your keys override the server defaults. Leave blank to use the workspace key set by the admin.
          </p>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-400">Anthropic API Key</label>
                {!formData.ANTHROPIC_API_KEY && hasServerKey('ANTHROPIC_API_KEY') && (
                  <span className="text-[9px] font-mono text-emerald-500 bg-emerald-950/30 px-1.5 py-0.5 rounded border border-emerald-500/20">Using Server Default</span>
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-400">OpenAI API Key</label>
                {!formData.OPENAI_API_KEY && hasServerKey('OPENAI_API_KEY') && (
                  <span className="text-[9px] font-mono text-emerald-500 bg-emerald-950/30 px-1.5 py-0.5 rounded border border-emerald-500/20">Using Server Default</span>
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
          <div className="flex items-center gap-2 mb-5">
            <Monitor className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">UI Preferences</h2>
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
        <div className={`${cardClass} md:col-span-2`}>
          <div className="flex items-center gap-2 mb-5">
            <Smartphone className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">App & Notifications</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
      </div>
    </div>
  );
}

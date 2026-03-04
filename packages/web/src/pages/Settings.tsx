import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, Bot, Monitor, Shield, Cpu, ToggleLeft, ToggleRight, ShieldAlert, CheckCircle2, Bell, BellOff, Smartphone, Download } from 'lucide-react';
import { apiFetch } from '../api';
import {
  notificationsSupported,
  notificationPermission,
  requestNotificationPermissionAsync,
  notifyAsync,
} from '../lib/notifications';

interface Settings {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
  DEFAULT_MODEL?: string;
  DEFAULT_PROVIDER?: string;
  MAX_STEPS?: string;
  TEMPERATURE?: string;
  PERSONALITY?: string;
  // UI Preferences
  AUTO_SCROLL_CHAT?: string;
  SHOW_RAW_JSON_LOGS?: string;
  // Advanced
  STRICT_JSON_MODE?: string;
  MAX_DENIAL_RETRIES?: string;
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
  const [formData, setFormData] = useState<Settings>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelCapability, setModelCapability] = useState<'ok' | 'no_tools' | 'checking' | null>(null);

  // ── PWA / Notifications state ─────────────────────────────────────────────
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(() =>
    notificationsSupported() ? notificationPermission() : 'denied'
  );
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [pwaInstallable, setPwaInstallable] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);

  useEffect(() => {
    // Android Chrome fires beforeinstallprompt when the PWA is installable.
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
      setPwaInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Already installed — running in standalone mode.
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setPwaInstallable(false);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
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
    }).catch(() => { /* ignore */ });
    // Always fire — even when visible — so the user can confirm it works.
    if (notificationPermission() === 'granted') {
      new Notification('Test notification', {
        body: 'OpenMacaw notifications are working.',
        icon: '/icons/icon-192.svg',
      });
    }
  };

  const { isLoading } = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await apiFetch('/api/settings');
      const data = await res.json();
      setFormData(data);
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (updates: Settings) => {
      for (const [key, value] of Object.entries(updates)) {
        await apiFetch(`/api/settings/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
  });

  const handleSave = () => {
    setSaveStatus('saving');
    saveMutation.mutate(formData);
  };

  const fetchOllamaModels = async () => {
    setFetchingModels(true);
    try {
      const res = await apiFetch('/api/ollama/tags');
      const data = await res.json();
      if (data.models) {
        setAvailableModels(data.models.map((m: any) => m.name));
      }
    } catch (e) {
      console.error('Failed to fetch Ollama models', e);
    } finally {
      setFetchingModels(false);
    }
  };

  // Proactive Model Capability Check
  useEffect(() => {
    const model = formData.DEFAULT_MODEL;
    if (!model) {
      setModelCapability(null);
      return;
    }

    setModelCapability('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/check-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model })
        });
        const data = await res.json();
        if (data.supportsTools === true) {
          setModelCapability('ok');
        } else if (data.supportsTools === false) {
          setModelCapability('no_tools');
        } else {
          setModelCapability(null);
        }
      } catch (e) {
        setModelCapability(null);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [formData.DEFAULT_MODEL]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const inputClass = "w-full px-3 py-2 border border-white/10 bg-zinc-900 text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono text-sm placeholder-zinc-500";
  const cardClass = "bg-zinc-900 border border-white/5 rounded-xl p-6";

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
          <p className="text-sm text-gray-500 font-mono mt-1">Configure providers, agent behavior, and preferences.</p>
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        {/* ── LLM Providers ─────────────────────────────── */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-5">
            <Cpu className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">LLM Providers</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Anthropic API Key</label>
              <input
                type="password"
                value={formData.ANTHROPIC_API_KEY || ''}
                onChange={(e) => setFormData({ ...formData, ANTHROPIC_API_KEY: e.target.value })}
                placeholder="sk-ant-..."
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">OpenAI API Key</label>
              <input
                type="password"
                value={formData.OPENAI_API_KEY || ''}
                onChange={(e) => setFormData({ ...formData, OPENAI_API_KEY: e.target.value })}
                placeholder="sk-..."
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Ollama Base URL</label>
              <input
                type="text"
                value={formData.OLLAMA_BASE_URL || ''}
                onChange={(e) => setFormData({ ...formData, OLLAMA_BASE_URL: e.target.value })}
                placeholder="http://localhost:11434"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* ── Agent Behavior ────────────────────────────── */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-5">
            <Bot className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Agent Behavior</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Default Provider</label>
              <select
                value={formData.DEFAULT_PROVIDER || 'anthropic'}
                onChange={(e) => setFormData({ ...formData, DEFAULT_PROVIDER: e.target.value })}
                className={inputClass}
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
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
                {formData.DEFAULT_PROVIDER === 'ollama' && (
                  <button
                    onClick={fetchOllamaModels}
                    disabled={fetchingModels}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 disabled:opacity-50 flex items-center gap-1 font-mono"
                  >
                    {fetchingModels && <Loader2 className="w-3 h-3 animate-spin" />}
                    Refresh
                  </button>
                )}
              </div>
              {availableModels.length > 0 && formData.DEFAULT_PROVIDER === 'ollama' ? (
                <select
                  value={formData.DEFAULT_MODEL || ''}
                  onChange={(e) => setFormData({ ...formData, DEFAULT_MODEL: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Select a model...</option>
                  {availableModels.map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={formData.DEFAULT_MODEL || ''}
                  onChange={(e) => setFormData({ ...formData, DEFAULT_MODEL: e.target.value })}
                  placeholder="claude-3-5-sonnet-20241022"
                  className={inputClass}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Max Steps</label>
                <input
                  type="number"
                  value={formData.MAX_STEPS || '50'}
                  onChange={(e) => setFormData({ ...formData, MAX_STEPS: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Temperature</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={formData.TEMPERATURE || '1.0'}
                  onChange={(e) => setFormData({ ...formData, TEMPERATURE: e.target.value })}
                  className={inputClass}
                />
              </div>
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

        {/* ── Advanced Agent Directives ───────────────────── */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-5">
            <Shield className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Advanced Directives</h2>
          </div>
          <div className="space-y-3">
            <div className="divide-y divide-white/5">
              <Toggle
                enabled={formData.STRICT_JSON_MODE === 'true'}
                onToggle={() => setFormData({ ...formData, STRICT_JSON_MODE: formData.STRICT_JSON_MODE === 'true' ? 'false' : 'true' })}
                label="Strict JSON Mode"
              />
            </div>
            <p className="text-[10px] text-gray-600 font-mono leading-relaxed">
              Forces the model to output structured JSON only. Appends a directive to the system prompt and sets response_format if supported.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Max Retries on Denial</label>
              <input
                type="number"
                min="1"
                max="10"
                value={formData.MAX_DENIAL_RETRIES || '3'}
                onChange={(e) => setFormData({ ...formData, MAX_DENIAL_RETRIES: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* ── App & Notifications (PWA) ──────────────────── */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-5">
            <Smartphone className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">App &amp; Notifications</h2>
          </div>

          <div className="space-y-5">
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
            <div className="border-t border-white/5 pt-4">
              <p className="text-xs font-medium text-gray-400 mb-3">Push Notifications</p>

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

              <p className="mt-2 text-[10px] text-gray-600 font-mono leading-relaxed">
                Notifies you when the agent finishes or a tool call is blocked — only while the app is in the background.
              </p>
            </div>
          </div>
        </div>

        {/* ── Personality ──────────────────────────────────── */}
        <div className={`${cardClass} md:col-span-2`}>
          <div className="flex items-center gap-2 mb-2">
            <Bot className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Personality</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4 font-mono leading-relaxed">
            Describe the agent's style, tone, or domain focus. This text is appended to the base system prompt — it does not replace the agent's core mission or security rules.
          </p>
          <textarea
            value={formData.PERSONALITY || ''}
            onChange={(e) => setFormData({ ...formData, PERSONALITY: e.target.value })}
            placeholder="e.g. Respond concisely in bullet points. Focus on Python and DevOps tasks."
            rows={8}
            className={`${inputClass} resize-none`}
          />
        </div>
      </div>
    </div>
  );
}

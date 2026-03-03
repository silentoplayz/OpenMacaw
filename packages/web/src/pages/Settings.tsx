import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, Bot, Monitor, Shield, Cpu, ToggleLeft, ToggleRight } from 'lucide-react';
import { apiFetch } from '../api';

interface Settings {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
  DEFAULT_MODEL?: string;
  DEFAULT_PROVIDER?: string;
  MAX_STEPS?: string;
  TEMPERATURE?: string;
  SYSTEM_PROMPT?: string;
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
        <div className="relative flex items-center">
          {saveStatus === 'saved' && <span className="absolute right-full mr-3 text-green-500 text-sm font-mono whitespace-nowrap animate-pulse">Saved!</span>}
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="flex items-center gap-2 px-5 py-2.5 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50 transition-colors shadow-[0_0_15px_rgba(6,182,212,0.15)]"
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
                <label className="block text-xs font-medium text-gray-400">Default Model</label>
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

        {/* ── System Prompt ──────────────────────────────── */}
        <div className={`${cardClass} md:col-span-2`}>
          <div className="flex items-center gap-2 mb-5">
            <Bot className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">System Prompt</h2>
          </div>
          <textarea
            value={formData.SYSTEM_PROMPT || ''}
            onChange={(e) => setFormData({ ...formData, SYSTEM_PROMPT: e.target.value })}
            placeholder="You are a helpful AI assistant..."
            rows={8}
            className={`${inputClass} resize-none`}
          />
        </div>
      </div>
    </div>
  );
}

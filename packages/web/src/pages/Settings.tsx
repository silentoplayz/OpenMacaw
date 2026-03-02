import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2 } from 'lucide-react';
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
}

export default function Settings() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Settings>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const { data: settings, isLoading } = useQuery<Settings>({
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

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Settings</h1>
        <button
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50"
        >
          {saveStatus === 'saving' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save
        </button>
        {saveStatus === 'saved' && <span className="text-green-600 text-sm">Saved!</span>}
      </div>

      <div className="space-y-6">
        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-white/10 p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">LLM Providers</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Anthropic API Key</label>
              <input
                type="password"
                value={formData.ANTHROPIC_API_KEY || ''}
                onChange={(e) => setFormData({ ...formData, ANTHROPIC_API_KEY: e.target.value })}
                placeholder="sk-ant-..."
                className="w-full px-3 py-2 border border-white/10 bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">OpenAI API Key</label>
              <input
                type="password"
                value={formData.OPENAI_API_KEY || ''}
                onChange={(e) => setFormData({ ...formData, OPENAI_API_KEY: e.target.value })}
                placeholder="sk-..."
                className="w-full px-3 py-2 border border-white/10 bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ollama Base URL</label>
              <input
                type="text"
                value={formData.OLLAMA_BASE_URL || ''}
                onChange={(e) => setFormData({ ...formData, OLLAMA_BASE_URL: e.target.value })}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-2 border border-white/10 bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono text-sm"
              />
            </div>
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-white/10 p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Agent Behavior</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default Provider</label>
              <select
                value={formData.DEFAULT_PROVIDER || 'anthropic'}
                onChange={(e) => setFormData({ ...formData, DEFAULT_PROVIDER: e.target.value })}
                className="w-full px-3 py-2 border border-white/10 bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Default Model</label>
                {formData.DEFAULT_PROVIDER === 'ollama' && (
                  <button
                    onClick={fetchOllamaModels}
                    disabled={fetchingModels}
                    className="text-xs text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 disabled:opacity-50 flex items-center gap-1"
                  >
                    {fetchingModels && <Loader2 className="w-3 h-3 animate-spin" />}
                    Refresh Local Models
                  </button>
                )}
              </div>
              {availableModels.length > 0 && formData.DEFAULT_PROVIDER === 'ollama' ? (
                <select
                  value={formData.DEFAULT_MODEL || ''}
                  onChange={(e) => setFormData({ ...formData, DEFAULT_MODEL: e.target.value })}
                  className="w-full px-3 py-2 border border-white/10 bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
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
                  className="w-full px-3 py-2 border border-white/10 bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max Steps</label>
              <input
                type="number"
                value={formData.MAX_STEPS || '50'}
                onChange={(e) => setFormData({ ...formData, MAX_STEPS: e.target.value })}
                className="w-full px-3 py-2 border border-white/10 bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Temperature</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={formData.TEMPERATURE || '1.0'}
                onChange={(e) => setFormData({ ...formData, TEMPERATURE: e.target.value })}
                className="w-full px-3 py-2 border border-white/10 bg-zinc-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
              />
            </div>
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-white/10 p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">System Prompt</h2>
          <textarea
            value={formData.SYSTEM_PROMPT || ''}
            onChange={(e) => setFormData({ ...formData, SYSTEM_PROMPT: e.target.value })}
            placeholder="You are a helpful AI assistant..."
            rows={6}
            className="w-full px-3 py-2 border border-white/10 bg-zinc-900 text-white placeholder-zinc-500 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
}

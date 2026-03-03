import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Play, Square, RotateCw, ChevronDown, ChevronUp,
  Loader2, Copy, CheckCheck, AlertCircle, Workflow,
} from 'lucide-react';
import { apiFetch } from '../api';

// ── Types ─────────────────────────────────────────────────────────────────────

type PipelineType = 'discord' | 'telegram' | 'line';
type PipelineStatus = 'running' | 'stopped' | 'error';

interface Pipeline {
  id: string;
  name: string;
  type: PipelineType;
  enabled: boolean;
  sessionId: string | null;
  config: Record<string, unknown>;
  status: PipelineStatus;
  running: boolean;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface Session {
  id: string;
  title: string;
  model: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_META: Record<PipelineType, { label: string; color: string; icon: string; description: string }> = {
  discord: {
    label: 'Discord',
    color: 'text-indigo-400 bg-indigo-950/40 border-indigo-500/30',
    icon: '🎮',
    description: 'Discord bot that responds in channels or DMs',
  },
  telegram: {
    label: 'Telegram',
    color: 'text-sky-400 bg-sky-950/40 border-sky-500/30',
    icon: '✈️',
    description: 'Telegram bot via long-polling',
  },
  line: {
    label: 'LINE',
    color: 'text-green-400 bg-green-950/40 border-green-500/30',
    icon: '💬',
    description: 'LINE Messaging API via inbound webhook',
  },
};

const STATUS_STYLE: Record<PipelineStatus, string> = {
  running: 'text-cyan-400',
  stopped: 'text-gray-500',
  error: 'text-red-400',
};

const STATUS_DOT: Record<PipelineStatus, string> = {
  running: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]',
  stopped: 'bg-gray-600',
  error: 'bg-red-500',
};

// ── Empty config defaults ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: Record<PipelineType, Record<string, string>> = {
  discord: { botToken: '', channelId: '' },
  telegram: { botToken: '', allowedChatIds: '' },
  line: { channelAccessToken: '', channelSecret: '' },
};

// ── Config field metadata ─────────────────────────────────────────────────────

type FieldMeta = {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  hint?: string;
};

const CONFIG_FIELDS: Record<PipelineType, FieldMeta[]> = {
  discord: [
    { key: 'botToken', label: 'Bot Token', placeholder: 'MTxxxxxxxxxx...', secret: true, hint: 'From the Discord Developer Portal → Bot → Token' },
    { key: 'channelId', label: 'Channel ID (optional)', placeholder: '123456789012345678', hint: 'Only respond in this channel. Leave blank to respond everywhere.' },
  ],
  telegram: [
    { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABCdef...', secret: true, hint: 'From @BotFather on Telegram' },
    { key: 'allowedChatIds', label: 'Allowed Chat IDs (optional)', placeholder: '12345678, -987654321', hint: 'Comma-separated chat IDs to whitelist. Leave blank to allow all.' },
  ],
  line: [
    { key: 'channelAccessToken', label: 'Channel Access Token', placeholder: 'Long-lived token from LINE Developers...', secret: true, hint: 'Messaging API → Channel Access Token (long-lived)' },
    { key: 'channelSecret', label: 'Channel Secret', placeholder: 'abc123...', secret: true, hint: 'Used to verify webhook signatures. Basic settings → Channel secret.' },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildConfig(type: PipelineType, raw: Record<string, string>): Record<string, unknown> {
  if (type === 'discord') {
    return {
      botToken: raw.botToken,
      ...(raw.channelId ? { channelId: raw.channelId } : {}),
    };
  }
  if (type === 'telegram') {
    const ids = raw.allowedChatIds
      ? raw.allowedChatIds.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return { botToken: raw.botToken, ...(ids.length ? { allowedChatIds: ids } : {}) };
  }
  // line
  return { channelAccessToken: raw.channelAccessToken, channelSecret: raw.channelSecret };
}

function configToRaw(type: PipelineType, config: Record<string, unknown>): Record<string, string> {
  if (type === 'discord') {
    return { botToken: String(config.botToken ?? ''), channelId: String(config.channelId ?? '') };
  }
  if (type === 'telegram') {
    const ids = Array.isArray(config.allowedChatIds) ? config.allowedChatIds.join(', ') : '';
    return { botToken: String(config.botToken ?? ''), allowedChatIds: ids };
  }
  return {
    channelAccessToken: String(config.channelAccessToken ?? ''),
    channelSecret: String(config.channelSecret ?? ''),
  };
}

// ── Add Pipeline Modal ────────────────────────────────────────────────────────

function AddPipelineModal({
  sessions,
  onClose,
  onCreated,
}: {
  sessions: Session[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PipelineType>('discord');
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const [rawConfig, setRawConfig] = useState<Record<string, string>>(DEFAULT_CONFIG.discord);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleTypeChange = (t: PipelineType) => {
    setType(t);
    setRawConfig(DEFAULT_CONFIG[t]);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!sessionId) { setError('Select a session'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          sessionId,
          config: buildConfig(type, rawConfig),
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to create pipeline');
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-zinc-950 border border-white/10 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">New Pipeline</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Discord Bot"
              className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          {/* Type selector */}
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-2">Connector Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TYPE_META) as PipelineType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => handleTypeChange(t)}
                  className={`flex flex-col items-center gap-1 px-3 py-3 rounded-lg border text-xs font-mono transition-all ${
                    type === t
                      ? 'bg-cyan-950/40 border-cyan-500/50 text-cyan-300'
                      : 'bg-black border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300'
                  }`}
                >
                  <span className="text-xl">{TYPE_META[t].icon}</span>
                  <span>{TYPE_META[t].label}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-1.5">{TYPE_META[type].description}</p>
          </div>

          {/* Session */}
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1">Shared Session</label>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              {sessions.length === 0 && (
                <option value="">No sessions available — create one in Chat first</option>
              )}
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.title} ({s.model})</option>
              ))}
            </select>
          </div>

          {/* Config fields */}
          <div className="space-y-3">
            <p className="text-xs font-mono text-gray-400">Configuration</p>
            {CONFIG_FIELDS[type].map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-mono text-gray-500 mb-1">{field.label}</label>
                <input
                  type={field.secret ? 'password' : 'text'}
                  value={rawConfig[field.key] ?? ''}
                  onChange={(e) => setRawConfig({ ...rawConfig, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                {field.hint && (
                  <p className="text-[10px] text-gray-600 mt-0.5">{field.hint}</p>
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs bg-red-950/20 border border-red-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-white/5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-mono font-bold rounded-md transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Pipeline
          </button>
        </div>
      </div>
    </>
  );
}

// ── Pipeline Row ──────────────────────────────────────────────────────────────

function PipelineRow({
  pipeline,
  sessions,
  onMutated,
  webhookBase,
}: {
  pipeline: Pipeline;
  sessions: Session[];
  onMutated: () => void;
  webhookBase: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editRaw, setEditRaw] = useState<Record<string, string>>(
    configToRaw(pipeline.type, pipeline.config)
  );
  const [editSessionId, setEditSessionId] = useState(pipeline.sessionId ?? '');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const meta = TYPE_META[pipeline.type];
  const webhookUrl = `${webhookBase}/api/pipelines/${pipeline.id}/webhook`;

  const handleStart = async () => {
    await apiFetch(`/api/pipelines/${pipeline.id}/start`, { method: 'POST' });
    onMutated();
  };

  const handleStop = async () => {
    await apiFetch(`/api/pipelines/${pipeline.id}/stop`, { method: 'POST' });
    onMutated();
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete pipeline "${pipeline.name}"? This cannot be undone.`)) return;
    await apiFetch(`/api/pipelines/${pipeline.id}`, { method: 'DELETE' });
    onMutated();
  };

  const handleSave = async () => {
    setSaving(true);
    await apiFetch(`/api/pipelines/${pipeline.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: editSessionId,
        config: buildConfig(pipeline.type, editRaw),
      }),
    });
    setSaving(false);
    onMutated();
  };

  const handleCopyWebhook = async () => {
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sessionTitle = sessions.find((s) => s.id === pipeline.sessionId)?.title ?? pipeline.sessionId ?? '—';

  return (
    <div className="border border-white/5 rounded-lg bg-zinc-900/40 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[pipeline.status]}`} />

        {/* Type badge */}
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase tracking-wider ${meta.color}`}>
          {meta.icon} {meta.label}
        </span>

        {/* Name */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-mono text-white truncate">{pipeline.name}</p>
          <p className="text-[10px] text-gray-500 truncate">
            Session: {sessionTitle} &middot; <span className={STATUS_STYLE[pipeline.status]}>{pipeline.status}</span>
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          {pipeline.running ? (
            <button
              onClick={handleStop}
              title="Stop"
              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-950/30 rounded transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleStart}
              title="Start"
              className="p-1.5 text-gray-400 hover:text-cyan-400 hover:bg-cyan-950/30 rounded transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {pipeline.running && (
            <button
              onClick={async () => { await apiFetch(`/api/pipelines/${pipeline.id}/restart`, { method: 'POST' }); onMutated(); }}
              title="Restart"
              className="p-1.5 text-gray-400 hover:text-yellow-400 hover:bg-yellow-950/30 rounded transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={handleDelete}
            title="Delete"
            className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-950/30 rounded transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setExpanded((x) => !x)}
            className="p-1.5 text-gray-500 hover:text-white rounded transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Error message */}
      {pipeline.status === 'error' && pipeline.errorMessage && (
        <div className="px-4 pb-2">
          <p className="text-xs text-red-400 bg-red-950/20 border border-red-500/20 rounded px-3 py-1.5">
            {pipeline.errorMessage}
          </p>
        </div>
      )}

      {/* Expanded config editor */}
      {expanded && (
        <div className="border-t border-white/5 px-4 py-4 space-y-3 bg-black/20">
          {/* Session picker */}
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1">Shared Session</label>
            <select
              value={editSessionId}
              onChange={(e) => setEditSessionId(e.target.value)}
              className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.title} ({s.model})</option>
              ))}
            </select>
          </div>

          {/* Config fields */}
          {CONFIG_FIELDS[pipeline.type].map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-mono text-gray-500 mb-1">{field.label}</label>
              <input
                type={field.secret ? 'password' : 'text'}
                value={editRaw[field.key] ?? ''}
                onChange={(e) => setEditRaw({ ...editRaw, [field.key]: e.target.value })}
                placeholder={field.placeholder}
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-md text-sm text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          ))}

          {/* LINE webhook URL helper */}
          {pipeline.type === 'line' && (
            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Webhook URL</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-gray-300 bg-black border border-white/10 rounded-md px-3 py-2 truncate">
                  {webhookUrl}
                </code>
                <button
                  onClick={handleCopyWebhook}
                  className="p-2 text-gray-400 hover:text-white bg-black border border-white/10 rounded-md transition-colors"
                >
                  {copied ? <CheckCheck className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-gray-600 mt-1">
                Paste this URL into LINE Developers → Messaging API → Webhook URL. Make sure your server is publicly reachable.
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-mono font-bold rounded-md transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save Changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Pipelines() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const { data: pipelines = [], isLoading } = useQuery<Pipeline[]>({
    queryKey: ['pipelines'],
    queryFn: async () => {
      const res = await apiFetch('/api/pipelines');
      return res.json() as Promise<Pipeline[]>;
    },
    refetchInterval: 5000,
  });

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await apiFetch('/api/sessions');
      return res.json() as Promise<Session[]>;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pipelines'] });

  const webhookBase = window.location.origin;

  const runningCount = pipelines.filter((p) => p.running).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black shrink-0">
        <div className="flex items-center gap-3">
          <Workflow className="w-5 h-5 text-cyan-500" />
          <div>
            <h1 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Pipelines</h1>
            <p className="text-xs text-gray-500">
              {pipelines.length} configured &middot; {runningCount} running
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold rounded-md transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Pipeline
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
          </div>
        ) : pipelines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Workflow className="w-10 h-10 text-gray-700 mb-4" />
            <p className="text-sm font-mono text-gray-400 mb-1">No pipelines configured</p>
            <p className="text-xs text-gray-600 mb-6 max-w-sm">
              Pipelines let external services — Discord, Telegram, LINE — talk to your agent through a shared session.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold rounded-md transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create your first pipeline
            </button>
          </div>
        ) : (
          <div className="space-y-3 max-w-2xl mx-auto">
            {/* How LINE webhooks work notice */}
            {pipelines.some((p) => p.type === 'line') && (
              <div className="flex items-start gap-3 px-4 py-3 bg-amber-950/20 border border-amber-500/20 rounded-lg text-xs text-amber-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  LINE pipelines receive messages via webhook. Your server must be publicly reachable over HTTPS.
                  Copy the webhook URL from the pipeline settings and paste it into LINE Developers Console.
                </span>
              </div>
            )}
            {pipelines.map((p) => (
              <PipelineRow
                key={p.id}
                pipeline={p}
                sessions={sessions}
                onMutated={invalidate}
                webhookBase={webhookBase}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <AddPipelineModal
          sessions={sessions}
          onClose={() => setShowModal(false)}
          onCreated={invalidate}
        />
      )}
    </div>
  );
}

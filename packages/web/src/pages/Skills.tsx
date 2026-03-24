import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Zap, Globe, User, Trash2, Edit2, X, Loader2, ChevronDown, ChevronRight, Download, Upload, RotateCcw, Clock, AlertCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { apiFetch } from '../api';

// ── Types ────────────────────────────────────────────────────────────────────

interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  toolHints: string[];
  triggers: string[];
  userId: string | null;
  isGlobal: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SkillVersion {
  id: string;
  skillId: string;
  version: number;
  instructions: string;
  changedBy: string | null;
  changeNote: string | null;
  createdAt: string;
}

type FormData = {
  name: string;
  description: string;
  instructions: string;
  toolHints: string;
  triggers: string;
  isGlobal: boolean;
  changeNote: string;
};

const EMPTY_FORM: FormData = {
  name: '',
  description: '',
  instructions: '',
  toolHints: '',
  triggers: '',
  isGlobal: false,
  changeNote: '',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function Skills() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'personal' | 'global'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [importContent, setImportContent] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: skills = [], isLoading } = useQuery<Skill[]>({
    queryKey: ['skills', search, filter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filter === 'global') params.set('global', 'true');
      if (filter === 'personal') params.set('global', 'false');
      const res = await apiFetch(`/api/skills?${params}`);
      if (!res.ok) throw new Error('Failed to load skills');
      return res.json();
    },
  });

  const { data: versions = [] } = useQuery<SkillVersion[]>({
    queryKey: ['skill-versions', detailId],
    queryFn: async () => {
      if (!detailId) return [];
      const res = await apiFetch(`/api/skills/${detailId}/versions`);
      if (!res.ok) throw new Error('Failed to load versions');
      return res.json();
    },
    enabled: !!detailId && showVersions,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createSkill = useMutation({
    mutationFn: async (data: FormData) => {
      const body = {
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        toolHints: data.toolHints ? data.toolHints.split(',').map(s => s.trim()).filter(Boolean) : [],
        triggers: data.triggers ? data.triggers.split(',').map(s => s.trim()).filter(Boolean) : [],
        isGlobal: data.isGlobal,
      };
      const res = await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create skill');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      resetForm();
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const updateSkill = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const body: Record<string, any> = {
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        toolHints: data.toolHints ? data.toolHints.split(',').map(s => s.trim()).filter(Boolean) : [],
        triggers: data.triggers ? data.triggers.split(',').map(s => s.trim()).filter(Boolean) : [],
        isGlobal: data.isGlobal,
      };
      if (data.changeNote) body.changeNote = data.changeNote;
      const res = await apiFetch(`/api/skills/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update skill');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill-versions'] });
      resetForm();
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const deleteSkill = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/skills/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete skill');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setDetailId(null);
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiFetch(`/api/skills/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle skill');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  const revertVersion = useMutation({
    mutationFn: async ({ skillId, versionId }: { skillId: string; versionId: string }) => {
      const res = await apiFetch(`/api/skills/${skillId}/revert/${versionId}`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to revert');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill-versions'] });
    },
  });

  const importSkill = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiFetch('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, filename: 'import.skill.md' }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to import skill');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setShowImport(false);
      setImportContent('');
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  function resetForm() {
    setShowForm(false);
    setEditId(null);
    setForm(EMPTY_FORM);
    setErrorMsg(null);
  }

  function openEdit(skill: Skill) {
    setEditId(skill.id);
    setForm({
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      toolHints: skill.toolHints.join(', '),
      triggers: skill.triggers.join(', '),
      isGlobal: skill.isGlobal,
      changeNote: '',
    });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editId) {
      updateSkill.mutate({ id: editId, data: form });
    } else {
      createSkill.mutate(form);
    }
  }

  async function handleExport(id: string) {
    const res = await apiFetch(`/api/skills/${id}/export`);
    if (!res.ok) return;
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${skills.find(s => s.id === id)?.name || 'skill'}.skill.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const detailSkill = skills.find(s => s.id === detailId);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <Zap className="w-6 h-6 text-cyan-500" />
          Skills
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-3 py-2 bg-zinc-800 text-gray-300 rounded-lg hover:bg-zinc-700 transition-colors text-sm font-medium border border-white/10"
          >
            <Upload className="w-4 h-4" />
            Import
          </button>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Create Skill
          </button>
        </div>
      </div>

      {/* Error */}
      {errorMsg && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} className="ml-auto text-red-500/50 hover:text-red-500">x</button>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search skills..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-black border border-white/10 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div className="flex gap-1 bg-zinc-900 rounded-lg p-0.5 border border-white/5">
          {(['all', 'personal', 'global'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === f ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {f === 'all' ? 'All' : f === 'personal' ? 'Personal' : 'Global'}
            </button>
          ))}
        </div>
      </div>

      {/* Skills Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
        </div>
      ) : skills.length === 0 ? (
        <div className="text-center py-20 border border-white/5 border-dashed rounded-xl bg-white/[0.01]">
          <Zap className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm mb-2">No skills found.</p>
          <p className="text-gray-600 text-xs">Create a skill to add reusable instructions to your agent sessions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {skills.map(skill => (
            <motion.div
              key={skill.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-zinc-950 border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors cursor-pointer group"
              onClick={() => { setDetailId(skill.id); setShowVersions(false); }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Zap className="w-4 h-4 text-cyan-500 flex-shrink-0" />
                  <h3 className="text-sm font-semibold text-white truncate">{skill.name}</h3>
                </div>
                <div className="flex items-center gap-2">
                  {skill.isGlobal ? (
                    <span className="flex items-center gap-1 text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded font-mono uppercase">
                      <Globe className="w-3 h-3" /> Global
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded font-mono uppercase">
                      <User className="w-3 h-3" /> Personal
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleEnabled.mutate({ id: skill.id, enabled: !skill.enabled }); }}
                    className={`relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ${skill.enabled ? 'bg-cyan-600' : 'bg-gray-800'}`}
                  >
                    <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white transition duration-200 mt-[1px] ml-[1px] ${skill.enabled ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 line-clamp-2 mb-3">{skill.description || 'No description'}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {skill.triggers.map(t => (
                  <span key={t} className="text-[10px] font-mono bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded">{t}</span>
                ))}
                {skill.toolHints.length > 0 && (
                  <span className="text-[10px] text-gray-600">{skill.toolHints.length} tool hint{skill.toolHints.length !== 1 ? 's' : ''}</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      <AnimatePresence>
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={resetForm} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-10 max-h-[90vh] flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-zinc-900/50">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  {editId ? <Edit2 className="w-5 h-5 text-cyan-500" /> : <Plus className="w-5 h-5 text-cyan-500" />}
                  {editId ? 'Edit Skill' : 'Create Skill'}
                </h2>
                <button onClick={resetForm} className="p-1 hover:bg-white/5 rounded-md text-gray-500 hover:text-gray-300 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">Name *</label>
                  <input
                    required
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    placeholder="e.g. Code Reviewer"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">Description</label>
                  <input
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    placeholder="A brief description of what this skill does"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">Instructions (Markdown)</label>
                  <textarea
                    value={form.instructions}
                    onChange={e => setForm({ ...form, instructions: e.target.value })}
                    rows={10}
                    className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-sm text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y"
                    placeholder="Write the instructions the agent should follow when this skill is active..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-mono text-gray-400 mb-1">Triggers (comma-separated)</label>
                    <input
                      value={form.triggers}
                      onChange={e => setForm({ ...form, triggers: e.target.value })}
                      className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder="/review, /summarize"
                    />
                    <p className="text-[10px] text-gray-600 mt-1">Slash commands that activate this skill</p>
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-gray-400 mb-1">Tool Hints (comma-separated)</label>
                    <input
                      value={form.toolHints}
                      onChange={e => setForm({ ...form, toolHints: e.target.value })}
                      className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder="read_file, write_file"
                    />
                    <p className="text-[10px] text-gray-600 mt-1">Suggested MCP tools for this skill</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isGlobal}
                      onChange={e => setForm({ ...form, isGlobal: e.target.checked })}
                      className="w-4 h-4 rounded border-white/10 bg-black text-cyan-600 focus:ring-cyan-500"
                    />
                    <span className="text-sm text-gray-300">Global skill (visible to all users)</span>
                  </label>
                </div>
                {editId && (
                  <div>
                    <label className="block text-xs font-mono text-gray-400 mb-1">Change Note (optional)</label>
                    <input
                      value={form.changeNote}
                      onChange={e => setForm({ ...form, changeNote: e.target.value })}
                      className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder="What changed?"
                    />
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={resetForm} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createSkill.isPending || updateSkill.isPending}
                    className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    {(createSkill.isPending || updateSkill.isPending) && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
                    {editId ? 'Save Changes' : 'Create Skill'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Import Modal ── */}
      <AnimatePresence>
        {showImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowImport(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-10"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-zinc-900/50">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Upload className="w-5 h-5 text-cyan-500" />
                  Import SKILL.md
                </h2>
                <button onClick={() => setShowImport(false)} className="p-1 hover:bg-white/5 rounded-md text-gray-500 hover:text-gray-300">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-xs text-gray-500">Paste the contents of a SKILL.md file with YAML frontmatter (name, description, triggers, toolHints).</p>
                <textarea
                  value={importContent}
                  onChange={e => setImportContent(e.target.value)}
                  rows={15}
                  className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-sm text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y"
                  placeholder={`---\nname: My Skill\ndescription: Does something useful\ntriggers: ["/myskill"]\ntoolHints: ["read_file"]\n---\n\nYour instructions here...`}
                />
                <div className="flex justify-end gap-3">
                  <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                  <button
                    onClick={() => importSkill.mutate(importContent)}
                    disabled={!importContent.trim() || importSkill.isPending}
                    className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 text-sm font-medium disabled:opacity-50"
                  >
                    {importSkill.isPending && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
                    Import
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Detail / Version Drawer ── */}
      <AnimatePresence>
        {detailSkill && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDetailId(null)} className="absolute inset-0 bg-black/60" />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-lg bg-zinc-950 border-l border-white/10 shadow-2xl z-10 overflow-y-auto"
            >
              <div className="sticky top-0 bg-zinc-950/95 backdrop-blur-sm border-b border-white/5 px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white truncate">{detailSkill.name}</h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleExport(detailSkill.id)} className="p-1.5 hover:bg-white/5 rounded-md text-gray-500 hover:text-gray-300" title="Export">
                    <Download className="w-4 h-4" />
                  </button>
                  <button onClick={() => openEdit(detailSkill)} className="p-1.5 hover:bg-white/5 rounded-md text-gray-500 hover:text-gray-300" title="Edit">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { if (confirm('Delete this skill?')) deleteSkill.mutate(detailSkill.id); }}
                    className="p-1.5 hover:bg-red-500/10 rounded-md text-gray-500 hover:text-red-400" title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setDetailId(null)} className="p-1.5 hover:bg-white/5 rounded-md text-gray-500 hover:text-gray-300">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Meta */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {detailSkill.isGlobal ? (
                      <span className="flex items-center gap-1 text-[10px] text-amber-500 bg-amber-500/10 px-2 py-1 rounded font-mono uppercase"><Globe className="w-3 h-3" /> Global</span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-gray-500 bg-white/5 px-2 py-1 rounded font-mono uppercase"><User className="w-3 h-3" /> Personal</span>
                    )}
                    <span className={`text-[10px] px-2 py-1 rounded font-mono uppercase ${detailSkill.enabled ? 'text-green-500 bg-green-500/10' : 'text-gray-600 bg-white/5'}`}>
                      {detailSkill.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  {detailSkill.description && <p className="text-sm text-gray-400">{detailSkill.description}</p>}
                </div>

                {/* Triggers & Tool Hints */}
                {(detailSkill.triggers.length > 0 || detailSkill.toolHints.length > 0) && (
                  <div className="space-y-2">
                    {detailSkill.triggers.length > 0 && (
                      <div>
                        <p className="text-[10px] font-mono text-gray-500 uppercase mb-1">Triggers</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {detailSkill.triggers.map(t => (
                            <span key={t} className="text-xs font-mono bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {detailSkill.toolHints.length > 0 && (
                      <div>
                        <p className="text-[10px] font-mono text-gray-500 uppercase mb-1">Tool Hints</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {detailSkill.toolHints.map(t => (
                            <span key={t} className="text-xs font-mono bg-white/5 text-gray-400 px-2 py-0.5 rounded">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Instructions */}
                <div>
                  <p className="text-[10px] font-mono text-gray-500 uppercase mb-2">Instructions</p>
                  <pre className="text-sm text-gray-300 bg-black/50 border border-white/5 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                    {detailSkill.instructions || '(empty)'}
                  </pre>
                </div>

                {/* Version History */}
                <div>
                  <button
                    onClick={() => setShowVersions(!showVersions)}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    {showVersions ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <Clock className="w-4 h-4" />
                    Version History
                  </button>
                  <AnimatePresence>
                    {showVersions && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 space-y-2">
                          {versions.length === 0 ? (
                            <p className="text-xs text-gray-600">No version history.</p>
                          ) : versions.map(v => (
                            <div key={v.id} className="bg-black/30 border border-white/5 rounded-lg p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-mono text-cyan-500">v{v.version}</span>
                                <span className="text-[10px] text-gray-600">{new Date(v.createdAt).toLocaleString()}</span>
                              </div>
                              {v.changeNote && <p className="text-xs text-gray-400 mb-2">{v.changeNote}</p>}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => revertVersion.mutate({ skillId: detailSkill.id, versionId: v.id })}
                                  className="flex items-center gap-1 text-[10px] text-amber-500 hover:text-amber-400 font-mono"
                                >
                                  <RotateCcw className="w-3 h-3" /> Revert
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

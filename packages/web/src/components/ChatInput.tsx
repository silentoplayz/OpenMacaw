import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, FileText, Zap, X, Check, Square } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { apiFetch } from '../api';

// ── Slash Command Definitions ─────────────────────────────────────────────────

interface SlashCommand {
  name: string;
  description: string;
  icon: string;
  action: 'paste' | 'navigate' | 'inline';
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/clear', description: 'Wipe current session history', icon: '🗑️', action: 'inline' },
  { name: '/audit', description: 'Audit my current directory', icon: '🔍', action: 'paste' },
  { name: '/security', description: 'Open Permissions dashboard', icon: '🛡️', action: 'navigate' },
  { name: '/model', description: 'Switch model: /model [name]', icon: '🤖', action: 'paste' },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChatInputProps {
  value: string;
  onChange: (val: string | ((prev: string) => string)) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  sessionId: string | null;
  onClear: () => void;
  onNavigate: (path: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  sessionId,
  onClear,
  onNavigate,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [historyBuffer, setHistoryBuffer] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isDragging, setIsDragging] = useState(false);
  const [commandMenu, setCommandMenu] = useState<{ visible: boolean; query: string }>({
    visible: false,
    query: '',
  });

  // ── Agentic overlay state ─────────────────────────────────────────────────
  const [agenticOpen, setAgenticOpen] = useState(false);
  const [agenticGoal, setAgenticGoal] = useState('');
  const [agenticRequireFinal, setAgenticRequireFinal] = useState(false);
  const [agenticSubmitting, setAgenticSubmitting] = useState(false);
  const goalInputRef = useRef<HTMLInputElement>(null);

  // Focus goal input when overlay opens
  useEffect(() => {
    if (agenticOpen) {
      setTimeout(() => goalInputRef.current?.focus(), 50);
    }
  }, [agenticOpen]);

  const handleAgenticSubmit = async () => {
    if (!agenticGoal.trim() || !sessionId || agenticSubmitting) return;
    setAgenticSubmitting(true);
    try {
      await apiFetch('/api/agentic/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          goal: agenticGoal.trim(),
          requireFinalApproval: agenticRequireFinal,
        }),
      });
      // Reset and close
      setAgenticGoal('');
      setAgenticRequireFinal(false);
      setAgenticOpen(false);
    } catch (e) {
      console.error('[Agentic] Start failed:', e);
    } finally {
      setAgenticSubmitting(false);
    }
  };

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === 'k') {
        e.preventDefault();
        textareaRef.current?.focus();
      }
      if (e.key === 'Escape' && agenticOpen) {
        setAgenticOpen(false);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [agenticOpen]);

  // ── Slash-command menu logic ──────────────────────────────────────────────
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    onChange(val);

    if (val.startsWith('/') && !val.includes(' ')) {
      setCommandMenu({ visible: true, query: val });
    } else {
      setCommandMenu({ visible: false, query: '' });
    }
  };

  const filteredCommands = SLASH_COMMANDS.filter(c =>
    c.name.startsWith(commandMenu.query || '/')
  );

  const handleCommandSelect = useCallback(async (cmd: SlashCommand) => {
    setCommandMenu({ visible: false, query: '' });

    if (cmd.action === 'paste') {
      // Replace '/' with the full command text ready for editing
      if (cmd.name === '/audit') {
        onChange('Audit my current directory');
        setTimeout(() => onSend(), 0);
      } else if (cmd.name === '/model') {
        onChange('/model ');
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    } else if (cmd.action === 'navigate' && cmd.name === '/security') {
      onNavigate('/servers');
    } else if (cmd.action === 'inline' && cmd.name === '/clear') {
      onChange('');
      if (!sessionId) return;
      try {
        await apiFetch(`/api/sessions/${sessionId}/messages`, { method: 'DELETE' });
        onClear();
      } catch (e) {
        console.error('[/clear] Failed:', e);
      }
    }
  }, [sessionId, onChange, onSend, onClear, onNavigate]);

  // ── Arrow-Up history recall ───────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (no Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!value.trim() || isStreaming) return;
      // Push to history
      setHistoryBuffer(prev => [value, ...prev.slice(0, 49)]);
      setHistoryIndex(-1);
      onSend();
      return;
    }

    // Slash-command menu keyboard nav
    if (commandMenu.visible && e.key === 'Escape') {
      e.preventDefault();
      setCommandMenu({ visible: false, query: '' });
      return;
    }

    // Arrow-Up: recall last sent message
    if (e.key === 'ArrowUp' && !value.trim()) {
      e.preventDefault();
      if (historyBuffer.length === 0) return;
      const nextIndex = Math.min(historyIndex + 1, historyBuffer.length - 1);
      setHistoryIndex(nextIndex);
      onChange(historyBuffer[nextIndex]);
      return;
    }

    if (e.key === 'ArrowDown' && historyIndex >= 0) {
      e.preventDefault();
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      onChange(nextIndex < 0 ? '' : historyBuffer[nextIndex]);
      return;
    }
  };

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const block = `\n\`\`\`\nFile: ${file.name}\n${text}\n\`\`\`\n`;
        onChange(prev => prev + block);
      };
      reader.readAsText(file);
    });
  };

  return (
    <div className="p-3 border-t border-white/5 bg-black relative">
      {/* ── Agentic Goal Overlay ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {agenticOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-3 right-3 mb-2 max-w-2xl mx-auto bg-zinc-900/98 backdrop-blur-md border border-violet-500/30 rounded-xl shadow-2xl overflow-hidden z-50"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-semibold text-violet-300 tracking-wide">Run Agent Autonomously</span>
              </div>
              <button
                onClick={() => setAgenticOpen(false)}
                className="p-1 hover:bg-white/5 rounded transition-colors text-gray-500 hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              {/* Goal input */}
              <div>
                <label className="block text-[11px] font-mono text-gray-400 uppercase tracking-wider mb-1.5">
                  Goal / Objective
                </label>
                <input
                  ref={goalInputRef}
                  type="text"
                  value={agenticGoal}
                  onChange={e => setAgenticGoal(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAgenticSubmit(); }
                    if (e.key === 'Escape') setAgenticOpen(false);
                  }}
                  placeholder="e.g. Audit my project files and create a summary report"
                  className="w-full px-3 py-2.5 bg-black border border-white/10 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/30 transition-colors"
                />
              </div>

              {/* Final approval checkbox */}
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative mt-0.5">
                    <input
                      type="checkbox"
                      id="agentic-final-approval"
                      checked={agenticRequireFinal}
                      onChange={e => setAgenticRequireFinal(e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${agenticRequireFinal
                          ? 'bg-violet-600 border-violet-500'
                          : 'bg-black border-white/20 group-hover:border-violet-500/40'
                        }`}
                      onClick={() => setAgenticRequireFinal(v => !v)}
                    >
                      {agenticRequireFinal && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm text-gray-300 font-medium">Request final approval before committing</span>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      The agent will pause after completing its work and show you a summary of all actions taken before anything is finalized.
                    </p>
                  </div>
                </label>


              </div>

              {/* Warning */}
              <div className="px-3 py-2 bg-violet-950/30 border border-violet-500/20 rounded-lg flex items-start gap-2">
                <Zap className="w-3 h-3 text-violet-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  The AI will act <strong className="text-violet-300">autonomously</strong> and execute tool calls without asking permission for each one.
                  Permission rules and the safety brake still apply.
                </p>
              </div>

              {/* Submit button */}
              <button
                id="agentic-start-btn"
                onClick={handleAgenticSubmit}
                disabled={!agenticGoal.trim() || agenticSubmitting || !sessionId}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg transition-all shadow-[0_0_20px_rgba(139,92,246,0.3)] hover:shadow-[0_0_30px_rgba(139,92,246,0.5)]"
              >
                {agenticSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                {agenticSubmitting ? 'Planning…' : 'Generate Plan & Proceed'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Slash Command Menu ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {commandMenu.visible && filteredCommands.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-3 right-3 mb-2 max-w-lg bg-zinc-900/95 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl overflow-hidden z-50"
          >
            <div className="px-3 py-1.5 border-b border-white/5">
              <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Commands</span>
            </div>
            {filteredCommands.map(cmd => (
              <button
                key={cmd.name}
                onMouseDown={(e) => { e.preventDefault(); handleCommandSelect(cmd); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left group"
              >
                <span className="text-base shrink-0">{cmd.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-mono text-cyan-400 group-hover:text-cyan-300 transition-colors">
                    {cmd.name}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">{cmd.description}</div>
                </div>
              </button>
            ))}
            <div className="px-3 py-1.5 border-t border-white/5">
              <span className="text-[9px] font-mono text-gray-600">↑↓ navigate · Enter select · Esc close</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input Row ─────────────────────────────────────────────────────── */}
      <div
        className="flex gap-2 max-w-4xl mx-auto items-end"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* ⚡ Agentic Mode Button */}
        <button
          id="agentic-mode-btn"
          onClick={() => setAgenticOpen(v => !v)}
          disabled={!sessionId || isStreaming}
          title="Run agent autonomously"
          className={`p-2.5 rounded-md border transition-all self-end disabled:opacity-30 disabled:cursor-not-allowed ${agenticOpen
              ? 'bg-violet-600 border-violet-500 text-white shadow-[0_0_12px_rgba(139,92,246,0.5)]'
              : 'bg-zinc-950 border-white/10 text-violet-400 hover:bg-violet-950/30 hover:border-violet-500/30'
            }`}
        >
          <Zap className="w-4 h-4" />
        </button>

        <div className="flex-1 relative">
          {isDragging && (
            <div className="absolute inset-0 rounded-md border-2 border-dashed border-cyan-500 bg-cyan-500/5 z-10 pointer-events-none flex items-center justify-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-mono text-cyan-400">Drop file to insert as code block</span>
            </div>
          )}
          <textarea
            id="chat-input"
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message or /command..."
            className={`w-full px-3 py-2.5 bg-zinc-950 border text-gray-200 rounded-md resize-none focus:outline-none focus:ring-1 shadow-sm text-sm overflow-y-auto transition-colors ${isDragging
                ? 'border-cyan-500/80 ring-cyan-500/40'
                : 'border-white/10 focus:border-cyan-500/50 focus:ring-cyan-500/50'
              }`}
            style={{ maxHeight: '200px' }}
            rows={1}
            disabled={isStreaming}
          />
        </div>
        {isStreaming ? (
          <button
            id="chat-stop-btn"
            onClick={onStop}
            title="Stop generation"
            className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-md shadow-sm transition-colors flex items-center justify-center self-end gap-1.5 font-mono text-xs font-bold"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            Stop
          </button>
        ) : (
          <button
            id="chat-send-btn"
            onClick={onSend}
            disabled={!value.trim()}
            className="px-4 py-2.5 bg-white text-black rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors flex items-center justify-center self-end"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Hotkey Hint ───────────────────────────────────────────────────── */}
      <div className="mt-1.5 flex items-center gap-3 max-w-4xl mx-auto px-1">
        <span className="text-[9px] font-mono text-gray-600">
          <kbd className="px-1 py-0.5 bg-white/5 rounded text-[8px]">⌘K</kbd> focus ·{' '}
          <kbd className="px-1 py-0.5 bg-white/5 rounded text-[8px]">↑</kbd> recall ·{' '}
          <kbd className="px-1 py-0.5 bg-white/5 rounded text-[8px]">/</kbd> commands ·{' '}
          <kbd className="px-1 py-0.5 bg-white/5 rounded text-[8px]">⚡</kbd> agentic
        </span>
      </div>
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, FileText } from 'lucide-react';
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
  { name: '/clear',    description: 'Wipe current session history',   icon: '🗑️',  action: 'inline'   },
  { name: '/audit',   description: 'Audit my current directory',      icon: '🔍',  action: 'paste'    },
  { name: '/security',description: 'Open Permissions dashboard',       icon: '🛡️',  action: 'navigate' },
  { name: '/model',   description: 'Switch model: /model [name]',     icon: '🤖',  action: 'paste'    },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChatInputProps {
  value: string;
  onChange: (val: string | ((prev: string) => string)) => void;
  onSend: () => void;
  isStreaming: boolean;
  sessionId: string | null;
  onClear: () => void;
  onSidebarToggle: () => void;
  onNavigate: (path: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatInput({
  value,
  onChange,
  onSend,
  isStreaming,
  sessionId,
  onClear,
  onSidebarToggle,
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
      if (isMod && e.key === '\\') {
        e.preventDefault();
        onSidebarToggle();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onSidebarToggle]);

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
            className={`w-full px-3 py-2.5 bg-zinc-950 border text-gray-200 rounded-md resize-none focus:outline-none focus:ring-1 shadow-sm text-sm overflow-y-auto transition-colors ${
              isDragging
                ? 'border-cyan-500/80 ring-cyan-500/40'
                : 'border-white/10 focus:border-cyan-500/50 focus:ring-cyan-500/50'
            }`}
            style={{ maxHeight: '200px' }}
            rows={1}
            disabled={isStreaming}
          />
        </div>
        <button
          id="chat-send-btn"
          onClick={onSend}
          disabled={!value.trim() || isStreaming}
          className="px-4 py-2.5 bg-white text-black rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors flex items-center justify-center self-end"
        >
          {isStreaming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* ── Hotkey Hint ───────────────────────────────────────────────────── */}
      <div className="mt-1.5 flex items-center gap-3 max-w-4xl mx-auto px-1">
        <span className="text-[9px] font-mono text-gray-600">
          <kbd className="px-1 py-0.5 bg-white/5 rounded text-[8px]">⌘K</kbd> focus ·{' '}
          <kbd className="px-1 py-0.5 bg-white/5 rounded text-[8px]">⌘\</kbd> sidebar ·{' '}
          <kbd className="px-1 py-0.5 bg-white/5 rounded text-[8px]">↑</kbd> recall ·{' '}
          <kbd className="px-1 py-0.5 bg-white/5 rounded text-[8px]">/</kbd> commands
        </span>
      </div>
    </div>
  );
}

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, CheckCircle2, Loader2, ExternalLink, Package, Terminal, Globe, Database, Code2, Shield, Zap, RefreshCw } from 'lucide-react';
import { apiFetch } from '../api';

// ── Catalog data ──────────────────────────────────────────────────────────────

interface CatalogEntry {
    id: string;
    name: string;
    description: string;
    category: 'productivity' | 'dev' | 'data' | 'web' | 'security' | 'ai';
    icon: string;
    transport: 'stdio' | 'http';
    command: string;
    args: string;
    envVars?: string;
    envKeys?: string[];           // required env var keys to highlight
    homepage?: string;
    tags: string[];
}

const CATALOG: CatalogEntry[] = [
    // ── Dev ──────────────────────────────────────────────────────────────────
    {
        id: 'filesystem',
        name: 'Filesystem',
        description: 'Read, write, and search files on the local filesystem with fine-grained path control.',
        category: 'dev',
        icon: '📁',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-filesystem', '/']),
        tags: ['files', 'read', 'write', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'github',
        name: 'GitHub',
        description: 'Interact with GitHub repos, issues, pull requests, and code search.',
        category: 'dev',
        icon: '🐙',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-github']),
        envKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
        envVars: '{\n  "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."\n}',
        tags: ['git', 'repos', 'issues', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'gitlab',
        name: 'GitLab',
        description: 'Manage GitLab projects, merge requests, pipelines, and issues.',
        category: 'dev',
        icon: '🦊',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-gitlab']),
        envKeys: ['GITLAB_PERSONAL_ACCESS_TOKEN'],
        envVars: '{\n  "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-..."\n}',
        tags: ['git', 'merge requests', 'ci/cd'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'shell',
        name: 'Shell',
        description: 'Execute sandboxed terminal commands. Great for automation and scripting tasks.',
        category: 'dev',
        icon: '🖥️',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', 'mcp-shell']),
        tags: ['terminal', 'bash', 'automation'],
        homepage: 'https://github.com/zackees/mcp-shell',
    },
    {
        id: 'git',
        name: 'Git',
        description: 'Clone, commit, branch, diff, and log operations on local Git repositories.',
        category: 'dev',
        icon: '🌿',
        transport: 'stdio',
        command: 'uvx',
        args: JSON.stringify(['mcp-server-git', '--repository', '/path/to/repo']),
        tags: ['git', 'version control', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'docker',
        name: 'Docker',
        description: 'Manage Docker containers, images, volumes, and networks.',
        category: 'dev',
        icon: '🐳',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', 'mcp-server-docker']),
        tags: ['containers', 'devops', 'infrastructure'],
        homepage: 'https://github.com/QuantGeekDev/docker-mcp',
    },
    // ── Web ──────────────────────────────────────────────────────────────────
    {
        id: 'brave-search',
        name: 'Brave Search',
        description: 'Web search and local search using the Brave Search API.',
        category: 'web',
        icon: '🦁',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-brave-search']),
        envKeys: ['BRAVE_API_KEY'],
        envVars: '{\n  "BRAVE_API_KEY": "BSAxxxxxxx"\n}',
        tags: ['search', 'web', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'searxng',
        name: 'SearXNG',
        description: 'Privacy-respecting web search via your self-hosted SearXNG instance.',
        category: 'web',
        icon: '🔍',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', 'mcp-searxng']),
        envKeys: ['SEARXNG_URL'],
        envVars: '{\n  "SEARXNG_URL": "http://your-searxng-instance"\n}',
        tags: ['search', 'privacy', 'self-hosted'],
        homepage: 'https://github.com/ihor-soloviov/mcp-searxng',
    },
    {
        id: 'fetch',
        name: 'Web Fetch',
        description: 'Fetch any web page, convert HTML to Markdown, and extract content.',
        category: 'web',
        icon: '🌐',
        transport: 'stdio',
        command: 'uvx',
        args: JSON.stringify(['mcp-server-fetch']),
        tags: ['fetch', 'web scraping', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'puppeteer',
        name: 'Puppeteer',
        description: 'Automate a headless Chrome browser — take screenshots, click, fill forms.',
        category: 'web',
        icon: '🕹️',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-puppeteer']),
        tags: ['browser', 'automation', 'screenshots', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    // ── Data ─────────────────────────────────────────────────────────────────
    {
        id: 'sqlite',
        name: 'SQLite',
        description: 'Query and modify a SQLite database with full SQL support and schema introspection.',
        category: 'data',
        icon: '🗄️',
        transport: 'stdio',
        command: 'uvx',
        args: JSON.stringify(['mcp-server-sqlite', '--db-path', '/data/db.sqlite']),
        tags: ['database', 'sql', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'postgres',
        name: 'PostgreSQL',
        description: 'Read-only access to a PostgreSQL database — query tables, get schema info.',
        category: 'data',
        icon: '🐘',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-postgres', 'postgresql://user:pass@localhost/db']),
        tags: ['database', 'sql', 'postgres', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'redis',
        name: 'Redis',
        description: 'Get, set, and manage keys in a Redis instance.',
        category: 'data',
        icon: '🔴',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', 'mcp-server-redis']),
        envKeys: ['REDIS_URL'],
        envVars: '{\n  "REDIS_URL": "redis://localhost:6379"\n}',
        tags: ['cache', 'key-value', 'redis'],
        homepage: 'https://github.com/punkpeye/mcp-server-redis',
    },
    // ── Productivity ─────────────────────────────────────────────────────────
    {
        id: 'google-drive',
        name: 'Google Drive',
        description: 'Search, read, and export files from Google Drive.',
        category: 'productivity',
        icon: '📂',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-gdrive']),
        tags: ['google', 'drive', 'files', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'slack',
        name: 'Slack',
        description: 'Read channels, post messages, and inspect workspace info in Slack.',
        category: 'productivity',
        icon: '💬',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-slack']),
        envKeys: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
        envVars: '{\n  "SLACK_BOT_TOKEN": "xoxb-...",\n  "SLACK_TEAM_ID": "T..."\n}',
        tags: ['slack', 'messaging', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'notion',
        name: 'Notion',
        description: 'Search, read, and create pages and databases in Notion.',
        category: 'productivity',
        icon: '📓',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@notionhq/notion-mcp-server']),
        envKeys: ['OPENAPI_MCP_HEADERS'],
        envVars: '{\n  "OPENAPI_MCP_HEADERS": "{\\\"Authorization\\\": \\\"Bearer ntn_...\\\", \\\"Notion-Version\\\": \\\"2022-06-28\\\"}"\n}',
        tags: ['notion', 'wiki', 'notes', 'databases'],
        homepage: 'https://github.com/makenotion/notion-mcp-server',
    },
    {
        id: 'jira',
        name: 'Jira',
        description: 'Search issues, create tickets, and manage sprints in Atlassian Jira.',
        category: 'productivity',
        icon: '🎯',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', 'mcp-atlassian', '--jira-url', 'https://your-domain.atlassian.net', '--jira-username', 'email@example.com', '--jira-api-token', 'YOUR_TOKEN']),
        tags: ['jira', 'atlassian', 'project management'],
        homepage: 'https://github.com/sooperset/mcp-atlassian',
    },
    // ── Security ─────────────────────────────────────────────────────────────
    {
        id: 'semgrep',
        name: 'Semgrep',
        description: 'Run static analysis security scans on your code using Semgrep rules.',
        category: 'security',
        icon: '🔒',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', 'mcp-server-semgrep']),
        tags: ['sast', 'security', 'scanning'],
        homepage: 'https://github.com/semgrep/mcp',
    },
    // ── AI ───────────────────────────────────────────────────────────────────
    {
        id: 'memory',
        name: 'Memory',
        description: 'Persistent key-value memory store — lets the agent remember facts across sessions.',
        category: 'ai',
        icon: '🧠',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-memory']),
        tags: ['memory', 'persistence', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
    {
        id: 'sequentialthinking',
        name: 'Sequential Thinking',
        description: 'Structured reasoning tool that breaks complex problems into numbered steps.',
        category: 'ai',
        icon: '🔗',
        transport: 'stdio',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-sequential-thinking']),
        tags: ['reasoning', 'chain-of-thought', 'official'],
        homepage: 'https://github.com/modelcontextprotocol/servers',
    },
];

interface ExistingServer { name: string; command?: string; args?: string; }

// ── Categories ────────────────────────────────────────────────────────────────

const CATEGORIES = [
    { id: 'all', label: 'All', icon: Package },
    { id: 'dev', label: 'Dev Tools', icon: Code2 },
    { id: 'web', label: 'Web', icon: Globe },
    { id: 'data', label: 'Data', icon: Database },
    { id: 'productivity', label: 'Productivity', icon: Zap },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'ai', label: 'AI / Memory', icon: Terminal },
] as const;

// ── CatalogCard ───────────────────────────────────────────────────────────────

function CatalogCard({
    entry,
    onAdd,
    isAdded,
    isAdding,
}: {
    entry: CatalogEntry;
    onAdd: (entry: CatalogEntry) => void;
    isAdded: boolean;
    isAdding: boolean;
}) {
    return (
        <div className={`relative flex flex-col bg-zinc-900 border rounded-xl p-5 transition-all duration-200 hover:border-white/20 hover:shadow-lg hover:shadow-black/40 group ${isAdded ? 'border-cyan-500/40 bg-cyan-950/10' : 'border-white/5'
            }`}>
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                    <span className="text-2xl leading-none select-none">{entry.icon}</span>
                    <div>
                        <h3 className="text-sm font-bold text-white leading-tight">{entry.name}</h3>
                        <span className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">{entry.transport}</span>
                    </div>
                </div>
                {entry.homepage && (
                    <a
                        href={entry.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-gray-600 hover:text-cyan-400 transition-colors opacity-0 group-hover:opacity-100"
                        title="View repository"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                )}
            </div>

            {/* Description */}
            <p className="text-xs text-gray-400 leading-relaxed flex-1 mb-4">{entry.description}</p>

            {/* Env keys required */}
            {entry.envKeys && entry.envKeys.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                    {entry.envKeys.map(k => (
                        <span key={k} className="text-[9px] font-mono text-amber-400/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                            {k}
                        </span>
                    ))}
                </div>
            )}

            {/* Tags */}
            <div className="flex flex-wrap gap-1 mb-4">
                {entry.tags.slice(0, 4).map(tag => (
                    <span key={tag} className="text-[9px] font-mono text-gray-600 bg-white/[0.03] border border-white/5 px-1.5 py-0.5 rounded">
                        {tag}
                    </span>
                ))}
            </div>

            {/* Add button */}
            <button
                onClick={() => onAdd(entry)}
                disabled={isAdded || isAdding}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 ${isAdded
                        ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-500/30 cursor-default'
                        : 'bg-white/5 text-gray-300 border border-white/10 hover:bg-cyan-600 hover:text-white hover:border-cyan-500 hover:shadow-[0_0_20px_rgba(6,182,212,0.2)]'
                    }`}
            >
                {isAdding ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…</>
                ) : isAdded ? (
                    <><CheckCircle2 className="w-3.5 h-3.5" /> Added</>
                ) : (
                    <><Plus className="w-3.5 h-3.5" /> Add &amp; Start</>
                )}
            </button>
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Catalog() {
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<string>('all');
    const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
    const [addingId, setAddingId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const { data: existingServers } = useQuery<ExistingServer[]>({
        queryKey: ['servers'],
        queryFn: async () => {
            const res = await apiFetch('/api/servers');
            return res.json();
        },
    });

    // Determine which catalog entries are already installed
    const installedCommands = useMemo(() => {
        if (!existingServers) return new Set<string>();
        return new Set(
            existingServers
                .filter(s => s.command && s.args)
                .map(s => `${s.command}|${s.args}`)
        );
    }, [existingServers]);

    const isInstalled = (entry: CatalogEntry) =>
        installedCommands.has(`${entry.command}|${entry.args}`) || addedIds.has(entry.id);

    const addMutation = useMutation({
        mutationFn: async (entry: CatalogEntry) => {
            setAddingId(entry.id);
            setErrorMsg(null);

            // 1. Create the server record
            const createRes = await apiFetch('/api/servers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: entry.name,
                    transport: entry.transport,
                    command: entry.command,
                    args: entry.args,
                    envVars: entry.envVars || '',
                }),
            });

            if (!createRes.ok) {
                const err = await createRes.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to add server');
            }

            const created = await createRes.json();

            // 2. Auto-start it
            await apiFetch(`/api/servers/${created.id}/start`, { method: 'POST' });

            return { id: created.id, entryId: entry.id };
        },
        onSuccess: ({ entryId }) => {
            setAddedIds(prev => new Set(prev).add(entryId));
            setAddingId(null);
            queryClient.invalidateQueries({ queryKey: ['servers'] });
        },
        onError: (err: Error) => {
            setErrorMsg(err.message);
            setAddingId(null);
        },
    });

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return CATALOG.filter(e => {
            const matchCat = category === 'all' || e.category === category;
            const matchSearch =
                !q ||
                e.name.toLowerCase().includes(q) ||
                e.description.toLowerCase().includes(q) ||
                e.tags.some(t => t.includes(q));
            return matchCat && matchSearch;
        });
    }, [search, category]);

    return (
        <div className="flex flex-col h-full">
            {/* ── Header ── */}
            <div className="px-6 pt-6 pb-4 border-b border-white/5 shrink-0">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white tracking-tight">MCP Catalog</h1>
                        <p className="text-sm text-gray-500 mt-0.5">Browse and install MCP servers with one click.</p>
                    </div>
                    <a
                        href="https://mcp.so"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-cyan-400 transition-colors font-mono border border-white/10 px-3 py-1.5 rounded-lg hover:border-cyan-500/40"
                    >
                        <ExternalLink className="w-3 h-3" />
                        Browse mcp.so
                    </a>
                </div>

                {/* Search */}
                <div className="relative mb-4">
                    <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search servers, tools, tags…"
                        className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-white/10 text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 text-sm placeholder-zinc-600"
                    />
                </div>

                {/* Category tabs */}
                <div className="flex gap-1 flex-wrap">
                    {CATEGORIES.map(cat => {
                        const Icon = cat.icon;
                        return (
                            <button
                                key={cat.id}
                                onClick={() => setCategory(cat.id)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${category === cat.id
                                        ? 'bg-cyan-600 text-white shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                                        : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-200 border border-white/5'
                                    }`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                {cat.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Error banner ── */}
            {errorMsg && (
                <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between text-sm text-red-400 shrink-0">
                    <span className="font-mono">{errorMsg}</span>
                    <button onClick={() => setErrorMsg(null)} className="text-red-500/50 hover:text-red-400 ml-4">×</button>
                </div>
            )}

            {/* ── Grid ── */}
            <div className="flex-1 overflow-y-auto p-6">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <RefreshCw className="w-8 h-8 text-gray-700 mb-3" />
                        <p className="text-gray-500 text-sm">No servers match your search.</p>
                        <button onClick={() => { setSearch(''); setCategory('all'); }} className="mt-3 text-xs text-cyan-500 hover:text-cyan-400">
                            Clear filters
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                        {filtered.map(entry => (
                            <CatalogCard
                                key={entry.id}
                                entry={entry}
                                onAdd={e => addMutation.mutate(e)}
                                isAdded={isInstalled(entry)}
                                isAdding={addingId === entry.id}
                            />
                        ))}
                    </div>
                )}

                {/* Footer note */}
                <p className="mt-8 text-center text-[11px] text-gray-700 font-mono">
                    {CATALOG.length} servers in catalog · Explore thousands more at{' '}
                    <a href="https://mcp.so" target="_blank" rel="noopener noreferrer" className="text-cyan-800 hover:text-cyan-600">mcp.so</a>
                </p>
            </div>
        </div>
    );
}

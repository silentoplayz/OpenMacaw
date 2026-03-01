import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0';

export type RegistryEnvVar = {
  name: string;
  description: string;
  isRequired?: boolean;
  isSecret?: boolean;
};

export type RegistryPackage = {
  registryType: 'npm' | 'oci' | 'pypi';
  identifier: string;
  /** Explicit bin name if it differs from the package name (needed for npx) */
  binName?: string;
  version?: string;
  environmentVariables?: RegistryEnvVar[];
};

export type RegistryServer = {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  icon?: string;
  packages: RegistryPackage[];
  source: 'registry' | 'curated';
};

// ─── Curated list of popular MCP servers ─────────────────────────────────────
// binName must match the "bin" key in the package's package.json.
// Install command built as: npx -y --package=<identifier> <binName> [args...]

const CURATED: RegistryServer[] = [
  {
    id: 'curated/filesystem',
    name: '@modelcontextprotocol/server-filesystem',
    title: 'Filesystem',
    description: 'Read and write files on the local filesystem with configurable path restrictions.',
    version: '2026.1.14',
    icon: 'https://avatars.githubusercontent.com/u/182288589?s=40',
    source: 'curated',
    packages: [{
      registryType: 'npm',
      identifier: '@modelcontextprotocol/server-filesystem',
      binName: 'mcp-server-filesystem',
      environmentVariables: [
        { name: 'ALLOWED_PATH', description: 'Directory path to allow access to (e.g. C:\\Users\\you\\workspace)', isRequired: true },
      ],
    }],
  },
  {
    id: 'curated/fetch',
    name: 'mcp-fetch',
    title: 'Fetch',
    description: 'Fetch web pages and convert them to Markdown for LLM consumption.',
    version: '0.1.6',
    icon: 'https://avatars.githubusercontent.com/u/182288589?s=40',
    source: 'curated',
    packages: [{ registryType: 'npm', identifier: 'mcp-fetch', binName: 'mcp-fetch' }],
  },
  {
    id: 'curated/memory',
    name: '@modelcontextprotocol/server-memory',
    title: 'Memory',
    description: 'Knowledge graph-based persistent memory so the agent remembers across sessions.',
    version: '2026.1.26',
    icon: 'https://avatars.githubusercontent.com/u/182288589?s=40',
    source: 'curated',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-memory', binName: 'mcp-server-memory' }],
  },
  {
    id: 'curated/sequential-thinking',
    name: '@modelcontextprotocol/server-sequential-thinking',
    title: 'Sequential Thinking',
    description: 'Dynamic and reflective problem-solving through thought sequences.',
    version: '2025.12.18',
    icon: 'https://avatars.githubusercontent.com/u/182288589?s=40',
    source: 'curated',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-sequential-thinking', binName: 'mcp-server-sequential-thinking' }],
  },
  {
    id: 'curated/brave-search',
    name: '@modelcontextprotocol/server-brave-search',
    title: 'Brave Search',
    description: 'Web and local search using the Brave Search API.',
    version: '0.6.2',
    icon: 'https://cdn.search.brave.com/serp/v2/_app/immutable/assets/brave-logo-sans.svg',
    source: 'curated',
    packages: [{
      registryType: 'npm',
      identifier: '@modelcontextprotocol/server-brave-search',
      binName: 'mcp-server-brave-search',
      environmentVariables: [
        { name: 'BRAVE_API_KEY', description: 'Brave Search API key from brave.com/search/api', isRequired: true, isSecret: true },
      ],
    }],
  },
  {
    id: 'curated/github',
    name: '@modelcontextprotocol/server-github',
    title: 'GitHub',
    description: 'Repository management, file operations, and GitHub API integration.',
    version: '2025.4.8',
    icon: 'https://github.githubassets.com/favicons/favicon.png',
    source: 'curated',
    packages: [{
      registryType: 'npm',
      identifier: '@modelcontextprotocol/server-github',
      binName: 'mcp-server-github',
      environmentVariables: [
        { name: 'GITHUB_PERSONAL_ACCESS_TOKEN', description: 'GitHub personal access token', isRequired: true, isSecret: true },
      ],
    }],
  },
  {
    id: 'curated/gitlab',
    name: '@modelcontextprotocol/server-gitlab',
    title: 'GitLab',
    description: 'GitLab API integration for project management, MRs, issues, and more.',
    version: '2025.4.25',
    icon: 'https://gitlab.com/uploads/-/system/group/avatar/6543/favicon.png',
    source: 'curated',
    packages: [{
      registryType: 'npm',
      identifier: '@modelcontextprotocol/server-gitlab',
      binName: 'mcp-server-gitlab',
      environmentVariables: [
        { name: 'GITLAB_PERSONAL_ACCESS_TOKEN', description: 'GitLab personal access token', isRequired: true, isSecret: true },
        { name: 'GITLAB_API_URL', description: 'GitLab API URL (leave blank for gitlab.com)' },
      ],
    }],
  },
  {
    id: 'curated/slack',
    name: '@modelcontextprotocol/server-slack',
    title: 'Slack',
    description: 'Channel management and messaging in Slack workspaces.',
    version: '2025.4.25',
    icon: 'https://a.slack-edge.com/80588/marketing/img/meta/favicon-32.png',
    source: 'curated',
    packages: [{
      registryType: 'npm',
      identifier: '@modelcontextprotocol/server-slack',
      binName: 'mcp-server-slack',
      environmentVariables: [
        { name: 'SLACK_BOT_TOKEN', description: 'Slack bot token (xoxb-...)', isRequired: true, isSecret: true },
        { name: 'SLACK_TEAM_ID', description: 'Slack workspace/team ID', isRequired: true },
      ],
    }],
  },
  {
    id: 'curated/postgres',
    name: '@modelcontextprotocol/server-postgres',
    title: 'PostgreSQL',
    description: 'Read-only database access with schema inspection for PostgreSQL.',
    version: '0.6.2',
    icon: 'https://www.postgresql.org/favicon.ico',
    source: 'curated',
    packages: [{
      registryType: 'npm',
      identifier: '@modelcontextprotocol/server-postgres',
      binName: 'mcp-server-postgres',
      environmentVariables: [
        { name: 'POSTGRES_CONNECTION_STRING', description: 'PostgreSQL connection string (postgresql://user:pass@host/db)', isRequired: true, isSecret: true },
      ],
    }],
  },
  {
    id: 'curated/puppeteer',
    name: '@modelcontextprotocol/server-puppeteer',
    title: 'Puppeteer',
    description: 'Browser automation and web scraping using Puppeteer.',
    version: '2025.5.12',
    icon: 'https://www.google.com/favicon.ico',
    source: 'curated',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-puppeteer', binName: 'mcp-server-puppeteer' }],
  },
  {
    id: 'curated/google-maps',
    name: '@modelcontextprotocol/server-google-maps',
    title: 'Google Maps',
    description: 'Location services, directions, and place details via Google Maps API.',
    version: '0.6.2',
    icon: 'https://maps.google.com/favicon.ico',
    source: 'curated',
    packages: [{
      registryType: 'npm',
      identifier: '@modelcontextprotocol/server-google-maps',
      binName: 'mcp-server-google-maps',
      environmentVariables: [
        { name: 'GOOGLE_MAPS_API_KEY', description: 'Google Maps API key', isRequired: true, isSecret: true },
      ],
    }],
  },
  {
    id: 'curated/aws-kb',
    name: '@modelcontextprotocol/server-aws-kb-retrieval',
    title: 'AWS Knowledge Base',
    description: 'Retrieval from AWS Knowledge Base using Bedrock Agent Runtime.',
    version: '0.6.2',
    icon: 'https://a0.awsstatic.com/libra-css/images/site/fav/favicon.ico',
    source: 'curated',
    packages: [{
      registryType: 'npm',
      identifier: '@modelcontextprotocol/server-aws-kb-retrieval',
      binName: 'mcp-server-aws-kb-retrieval',
      environmentVariables: [
        { name: 'AWS_ACCESS_KEY_ID', description: 'AWS access key ID', isRequired: true, isSecret: true },
        { name: 'AWS_SECRET_ACCESS_KEY', description: 'AWS secret access key', isRequired: true, isSecret: true },
        { name: 'AWS_REGION', description: 'AWS region (e.g. us-east-1)', isRequired: true },
        { name: 'KNOWLEDGE_BASE_ID', description: 'Bedrock Knowledge Base ID', isRequired: true },
      ],
    }],
  },
  {
    id: 'curated/everart',
    name: '@modelcontextprotocol/server-everart',
    title: 'EverArt',
    description: 'AI image generation using various models via EverArt.',
    version: '0.6.2',
    icon: 'https://avatars.githubusercontent.com/u/182288589?s=40',
    source: 'curated',
    packages: [{
      registryType: 'npm',
      identifier: '@modelcontextprotocol/server-everart',
      binName: 'mcp-server-everart',
      environmentVariables: [
        { name: 'EVERART_API_KEY', description: 'EverArt API key', isRequired: true, isSecret: true },
      ],
    }],
  },
];

// ─── Registry fetcher (paginate all pages) ────────────────────────────────────

async function fetchAllRegistryServers(): Promise<RegistryServer[]> {
  const results: RegistryServer[] = [];
  let cursor: string | null = null;

  // Fetch up to 10 pages (1000 servers max) to avoid runaway requests
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`${REGISTRY_BASE}/servers?${params}`);
    if (!res.ok) break;

    const data: any = await res.json();

    for (const raw of data.servers || []) {
      const s = raw.server;
      const meta = raw._meta?.['io.modelcontextprotocol.registry/official'];
      if (!s || meta?.isLatest === false) continue;

      const packages: RegistryPackage[] = (s.packages || [])
        .filter((p: any) => p.registryType === 'npm')
        .map((p: any) => ({
          registryType: 'npm' as const,
          identifier: p.identifier,
          version: p.version,
          environmentVariables: (p.environmentVariables || []).map((ev: any) => ({
            name: ev.name,
            description: ev.description || '',
            isRequired: ev.isRequired,
            isSecret: ev.isSecret,
          })),
        }));

      if (packages.length === 0) continue;

      const icon = s.icons?.[0]?.src || undefined;

      results.push({
        id: `registry/${s.name}`,
        name: s.name,
        title: s.title || s.name.split('/').pop() || s.name,
        description: s.description || '',
        version: s.version || '0.0.0',
        icon,
        packages,
        source: 'registry',
      });
    }

    cursor = data.metadata?.nextCursor ?? null;
    if (!cursor) break;
  }

  return results;
}

// Simple in-memory cache so we don't hammer the registry on every search keystroke
let registryCache: { servers: RegistryServer[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCachedRegistryServers(): Promise<RegistryServer[]> {
  const now = Date.now();
  if (registryCache && now - registryCache.fetchedAt < CACHE_TTL_MS) {
    return registryCache.servers;
  }
  const servers = await fetchAllRegistryServers();
  registryCache = { servers, fetchedAt: now };
  return servers;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function registryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/registry', async (
    request: FastifyRequest<{ Querystring: { q?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      // Fetch registry servers (cached) and merge with curated list
      const [registryServers] = await Promise.allSettled([getCachedRegistryServers()]);
      const fromRegistry = registryServers.status === 'fulfilled' ? registryServers.value : [];

      // Deduplicate: curated takes priority, registry fills the rest
      const curatedIds = new Set(CURATED.map(s => s.name));
      const dedupedRegistry = fromRegistry.filter(s => !curatedIds.has(s.name));

      let all: RegistryServer[] = [...CURATED, ...dedupedRegistry];

      // Search filter
      const { q } = request.query;
      if (q) {
        const lower = q.toLowerCase();
        all = all.filter(s =>
          s.title.toLowerCase().includes(lower) ||
          s.description.toLowerCase().includes(lower) ||
          s.name.toLowerCase().includes(lower)
        );
      }

      return reply.send({ servers: all, total: all.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: msg });
    }
  });
}

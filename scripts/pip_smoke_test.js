#!/usr/bin/env node
// Simple smoke test for per-server prompt injection prevention toggle and per-tool flag
// Usage: node scripts/pip_smoke_test.js <serverId>
(() => {
  const serverId = process.argv[2];
  if (!serverId) {
    console.error('Usage: node scripts/pip_smoke_test.js <serverId>');
    process.exit(1);
  }
  const base = process.env.OPENMACAW_BASE_URL || 'http://localhost:3000';
  const endpoint = `${base}/api/permissions/${encodeURIComponent(serverId)}`;

  (async () => {
    try {
      // GET current permissions
      let res = await fetch(endpoint);
      if (!res.ok) {
        console.error('GET permission failed', res.status, await res.text());
        process.exit(2);
      }
      const perm = await res.json();
      console.log('Current permission:', perm);

      // Prepare a minimal payload to turn on PIP server-wide and set a sample tool flag
      const toolKey = `${serverId}:sampleTool`;
      const payload = {
        promptInjectionPrevention: true,
        toolPermissions: { [toolKey]: true }
      };

      res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error('PUT failed', res.status, await res.text());
        process.exit(3);
      }
      const updated = await res.json();
      console.log('Updated permission:', updated);
    } catch (err) {
      console.error('Error during pip smoke test', err);
      process.exit(4);
    }
  })();
})();

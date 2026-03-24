import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import Chat from './pages/Chat';
import Servers from './pages/Servers';
import Permissions from './pages/Permissions';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import Pipelines from './pages/Pipelines';
import Catalog from './pages/Catalog';
import Admin from './pages/Admin';
import Skills from './pages/Skills';
import Forbidden from './pages/Forbidden';
import Auth from './pages/Auth';
import Pending from './pages/Pending';
import { AuthProvider, ProtectedRoute, AdminRoute } from './contexts/AuthContext';
import './index.css';

// ── Service Worker (PWA) ──────────────────────────────────────────────────────
// vite-plugin-pwa generates sw.js at the root. We register it here so the app
// is installable on Android and can show background notifications.
if ('serviceWorker' in navigator) {
  // Use the virtual module injected by vite-plugin-pwa at build time.
  // In dev mode this is a no-op; in production it registers the Workbox SW.
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      // Silently update — no reload prompt needed for this app.
      onNeedRefresh() { /* no-op */ },
      onOfflineReady() {
        console.info('[PWA] App is ready for offline use.');
      },
    });

    // Forward service-worker click events (notification tap → navigate)
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (data?.type === 'NOTIFICATION_CLICK' && data.url) {
        window.location.href = data.url;
      }
    });
  }).catch(() => {
    // Module not available in dev / non-PWA build — ignore.
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/auth/pending" element={<Pending />} />
          <Route element={<ProtectedRoute><App /></ProtectedRoute>}>
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="chat" element={<Chat />}>
              <Route path=":id" element={<Chat />} />
            </Route>
            <Route path="servers" element={<Servers />} />
            <Route path="permissions/:serverId" element={<Permissions />} />
            <Route path="pipelines" element={<Pipelines />} />
            <Route path="activity" element={<AuditLog />} />
            <Route path="settings" element={<Settings />} />
            <Route path="skills" element={<Skills />} />
            <Route path="catalog" element={<Catalog />} />
            <Route path="forbidden" element={<Forbidden />} />
            <Route path="admin" element={<AdminRoute><Admin /></AdminRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

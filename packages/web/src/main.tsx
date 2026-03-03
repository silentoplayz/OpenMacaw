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
import './index.css';

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
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<Chat />}>
            <Route path=":id" element={<Chat />} />
          </Route>
          <Route path="servers" element={<Servers />} />
          <Route path="permissions/:serverId" element={<Permissions />} />
          <Route path="pipelines" element={<Pipelines />} />
          <Route path="activity" element={<AuditLog />} />
          <Route path="settings" element={<Settings />} />
          <Route path="catalog" element={<Catalog />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

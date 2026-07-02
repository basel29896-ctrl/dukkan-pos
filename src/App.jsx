/* eslint-disable */
// Dukkan — single-store, barcode-driven grocery POS.
// App shell only: session boot, view routing, toast bridge. The UI lives in
// src/views/* (HeroUI + Tailwind); shared chrome in src/components/*.
import React, { useState, useEffect, useCallback } from 'react';
import { addToast } from '@heroui/react';
import api from './api';
import { ARABIC, VIEWS } from './client.config';
import Sidebar from './components/Sidebar';
import Login from './views/Login';
import Sales from './views/Sales';
import Inventory from './views/Inventory';
import Receive from './views/Receive';
import History from './views/History';
import Reports from './views/Reports';
import Settings from './views/Settings';
import CustomerDisplay from './views/CustomerDisplay';

const TOKEN_KEY = 'dukkan_token';

export default function App() {
  const isDisplay = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('display') === '1';
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState('sales');

  // Same (msg, kind) contract the views have always used; rendered by HeroUI toasts.
  const notify = useCallback((msg, kind = 'info') => {
    addToast({
      title: msg,
      color: kind === 'red' ? 'danger' : kind === 'green' ? 'success' : 'default',
      timeout: 2600,
    });
  }, []);

  // Restore session on load from the persisted token.
  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setBooting(false); return; }
    api.setToken(t);
    let alive = true;
    api.get('/auth/validate')
      .then((u) => { if (alive) setUser(u); })
      .catch(() => { api.setToken(null); localStorage.removeItem(TOKEN_KEY); })
      .finally(() => { if (alive) setBooting(false); });
    return () => { alive = false; };
  }, []);

  // Blocking notice when the session dies mid-use.
  useEffect(() => {
    api.setOnSessionExpired(() => {
      api.setToken(null);
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      notify(ARABIC ? 'انتهت الجلسة، سجّل الدخول من جديد' : 'Session expired — please log in again', 'red');
    });
  }, [notify]);

  const handleLogin = (u) => {
    api.setToken(u.token);
    localStorage.setItem(TOKEN_KEY, u.token);
    setUser(u);
    setView('sales');
  };
  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch (_) {}
    api.setToken(null);
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  if (isDisplay) return <CustomerDisplay />;
  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background font-sans text-foreground-500">
        {ARABIC ? 'جارٍ التحميل…' : 'Loading…'}
      </div>
    );
  }
  if (!user) return <Login onLogin={handleLogin} />;

  const isAdmin = user.role === 'admin';
  const allowed = (v) => {
    if (v === 'sales' || v === 'settings' || isAdmin) return true;
    const views = user.allowed_views || [];
    if (v === 'receive') return views.includes('inventory') || views.includes('receive');
    return views.includes(v);
  };
  const navViews = VIEWS.filter(allowed);

  return (
    // Fixed shell: the sidebar is always pinned to the physical LEFT in both
    // languages; only the content inside follows the language direction.
    <div dir="ltr" className="flex min-h-screen items-stretch bg-background font-sans text-foreground">
      <Sidebar user={user} view={view} setView={setView} navViews={navViews} onLogout={handleLogout}
        canSeeStock={allowed('inventory') || allowed('reports')} />
      <main dir={ARABIC ? 'rtl' : 'ltr'} className="min-w-0 flex-1 p-4">
        {view === 'sales' && <Sales user={user} notify={notify} />}
        {view === 'inventory' && allowed('inventory') && <Inventory isAdmin={isAdmin} notify={notify} />}
        {view === 'receive' && allowed('receive') && <Receive isAdmin={isAdmin} notify={notify} />}
        {view === 'history' && allowed('history') && <History user={user} notify={notify} />}
        {view === 'reports' && allowed('reports') && <Reports notify={notify} />}
        {view === 'settings' && <Settings user={user} isAdmin={isAdmin} notify={notify} />}
      </main>
    </div>
  );
}

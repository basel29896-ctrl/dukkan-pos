import React, { useEffect, useState } from 'react';
import { Button, Badge, Popover, PopoverTrigger, PopoverContent, Divider } from '@heroui/react';
import {
  ShoppingCart, Package, Inbox, ReceiptText, BarChart3, Settings as SettingsIcon,
  Bell, Clock, LogOut, Languages, Moon, Sun,
} from 'lucide-react';
import api from '../api';
import { STORE_NAME, ARABIC, VIEW_LABELS } from '../client.config';
import { THEME, setPref } from '../lib/prefs';

const ICONS = {
  sales: ShoppingCart, inventory: Package, receive: Inbox,
  history: ReceiptText, reports: BarChart3, settings: SettingsIcon,
};

// Bell badge: low-stock + expiring counts. HeroUI Popover renders in a portal,
// so the sidebar's overflow scroller can never clip it.
function NotificationsBell() {
  const [low, setLow] = useState([]);
  const [exp, setExp] = useState([]);
  useEffect(() => {
    api.get('/reports/low-stock?threshold=5').then(setLow).catch(() => {});
    api.get('/expiry?days=14').then(setExp).catch(() => {});
  }, []);
  const count = low.length + exp.length;
  return (
    <Popover placement={ARABIC ? 'left-end' : 'right-end'} offset={12}>
      <PopoverTrigger>
        <Button fullWidth variant="bordered" className="justify-start"
          startContent={
            <Badge content={count} color="danger" size="sm" isInvisible={!count} className="tnum">
              <Bell size={18} />
            </Badge>
          }>
          {ARABIC ? 'التنبيهات' : 'Alerts'}
        </Button>
      </PopoverTrigger>
      <PopoverContent dir={ARABIC ? 'rtl' : 'ltr'} className="w-80 items-stretch gap-1 p-4">
        <div className="mb-1 text-sm font-bold text-danger">{ARABIC ? 'مخزون منخفض' : 'Low stock'} ({low.length})</div>
        {low.slice(0, 8).map((p) => (
          <div key={p.id} className="flex justify-between py-0.5 text-sm">
            <span>{p.name}</span><span className="tnum font-semibold text-danger">{Number(p.stock)}</span>
          </div>
        ))}
        <div className="mb-1 mt-3 text-sm font-bold text-warning-600">{ARABIC ? 'قرب الانتهاء' : 'Expiring'} ({exp.length})</div>
        {exp.slice(0, 8).map((e) => (
          <div key={e.id} className="flex justify-between py-0.5 text-sm">
            <span>{e.product}</span>
            <span className={`tnum font-semibold ${Number(e.days_left) < 0 ? 'text-danger' : 'text-warning-600'}`}>{e.expiry}</span>
          </div>
        ))}
        {!count && <div className="text-sm text-foreground-500">{ARABIC ? 'لا تنبيهات' : 'All good'}</div>}
      </PopoverContent>
    </Popover>
  );
}

// Clock In/Out for the logged-in employee.
function ClockButton() {
  const [open, setOpen] = useState(null); // open punch or null
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/timeclock/status').then(setOpen).catch(() => {}); }, []);
  const toggle = async () => {
    setBusy(true);
    try {
      if (open) { await api.post('/timeclock/out'); setOpen(null); }
      else { await api.post('/timeclock/in'); api.get('/timeclock/status').then(setOpen); }
    } catch (_) {} finally { setBusy(false); }
  };
  return (
    <Button fullWidth variant="bordered" color={open ? 'success' : 'default'} isDisabled={busy}
      className="justify-start" startContent={<Clock size={18} />} onPress={toggle}>
      {open ? (ARABIC ? 'تسجيل خروج' : 'Clock Out') : (ARABIC ? 'تسجيل دخول' : 'Clock In')}
    </Button>
  );
}

// Vertical navigation rail, pinned to the right edge. Bigger touch targets.
export default function Sidebar({ user, view, setView, navViews, onLogout, canSeeStock }) {
  return (
    <aside dir={ARABIC ? 'rtl' : 'ltr'}
      className="sticky top-0 flex h-screen w-56 shrink-0 flex-col gap-3 overflow-y-auto border-e border-divider bg-content1 p-3">
      <div className="py-2 text-center text-xl font-bold tracking-tight text-foreground">{STORE_NAME}</div>

      <nav className="flex flex-col gap-1">
        {navViews.map((v) => {
          const on = view === v;
          const Icon = ICONS[v] || Package;
          return (
            <button key={v} onClick={() => setView(v)}
              className={`flex h-12 w-full items-center gap-3 rounded-medium px-3 text-base font-semibold transition-colors ${
                on ? 'bg-primary/10 text-primary' : 'text-foreground-500 hover:bg-content2 hover:text-foreground'
              }`}>
              <Icon size={20} />
              <span>{VIEW_LABELS[v]}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <Divider />
      <div className="flex flex-col gap-2">
        {canSeeStock && <NotificationsBell />}
        <ClockButton />
        <div className="flex gap-2">
          <Button size="sm" variant="bordered" className="flex-1" startContent={<Languages size={15} />}
            onPress={() => setPref('dukkan_lang', ARABIC ? 'en' : 'ar')}>
            {ARABIC ? 'English' : 'عربية'}
          </Button>
          <Button size="sm" variant="bordered" className="flex-1"
            startContent={THEME === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            onPress={() => setPref('dukkan_theme', THEME === 'dark' ? 'light' : 'dark')}>
            {THEME === 'dark' ? (ARABIC ? 'فاتح' : 'Light') : (ARABIC ? 'داكن' : 'Dark')}
          </Button>
        </div>
        <div className="text-center text-xs text-foreground-500">{user.full_name || user.username}</div>
        <Button fullWidth variant="bordered" color="danger" startContent={<LogOut size={18} />} onPress={onLogout}>
          {ARABIC ? 'خروج' : 'Logout'}
        </Button>
      </div>
    </aside>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Card, CardBody, CardHeader } from '@heroui/react';
import { KeyRound, Tags, UsersRound } from 'lucide-react';
import api from '../api';
import { ARABIC, VIEW_LABELS } from '../client.config';
import { money } from '../lib/format';

// ══════════════════════════════════════════════════════════════════════════════
// Settings — change password, (admin) users + categories
// ══════════════════════════════════════════════════════════════════════════════
export default function Settings({ user, isAdmin, notify }) {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <ChangePassword notify={notify} />
      {isAdmin && <Categories notify={notify} />}
      {isAdmin && <Users me={user} notify={notify} />}
    </div>
  );
}

function ChangePassword({ notify }) {
  const [oldPw, setOld] = useState(''); const [newPw, setNew] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (newPw.length < 8) { notify(ARABIC ? 'كلمة المرور 8 أحرف على الأقل' : 'Password must be 8+ chars', 'red'); return; }
    setBusy(true);
    try { await api.post('/auth/change-password', { old: oldPw, new: newPw }); setOld(''); setNew(''); notify(ARABIC ? 'تم تغيير كلمة المرور' : 'Password changed', 'green'); }
    catch (ex) { notify(ex.message === 'wrong_old' ? (ARABIC ? 'كلمة المرور الحالية خاطئة' : 'Current password wrong') : (ARABIC ? 'فشل' : 'Failed'), 'red'); }
    finally { setBusy(false); }
  };
  return (
    <Card as="form" shadow="sm" onSubmit={submit}>
      <CardHeader className="gap-2 text-base font-bold">
        <KeyRound size={18} className="text-foreground-500" />
        {ARABIC ? 'تغيير كلمة المرور' : 'Change password'}
      </CardHeader>
      <CardBody className="gap-3 pt-0">
        <Input type="password" variant="bordered" labelPlacement="outside"
          label={ARABIC ? 'كلمة المرور الحالية' : 'Current password'}
          value={oldPw} onValueChange={setOld} />
        <Input type="password" variant="bordered" labelPlacement="outside"
          label={ARABIC ? 'كلمة مرور جديدة (8+)' : 'New password (8+)'}
          value={newPw} onValueChange={setNew} />
        <Button type="submit" color="primary" isLoading={busy} className="self-start">
          {ARABIC ? 'حفظ' : 'Save'}
        </Button>
      </CardBody>
    </Card>
  );
}

function Categories({ notify }) {
  const [text, setText] = useState('');
  useEffect(() => { api.get('/settings/categories').then((r) => { try { setText((r && r.value ? JSON.parse(r.value) : []).join(', ')); } catch (_) {} }).catch(() => {}); }, []);
  const save = async () => {
    const list = text.split(',').map((s) => s.trim()).filter(Boolean);
    try { await api.put('/settings/categories', { value: JSON.stringify(list) }); notify(ARABIC ? 'تم حفظ الفئات' : 'Categories saved', 'green'); }
    catch (_) { notify(ARABIC ? 'فشل' : 'Failed', 'red'); }
  };
  return (
    <Card shadow="sm">
      <CardHeader className="gap-2 text-base font-bold">
        <Tags size={18} className="text-foreground-500" />
        {ARABIC ? 'الفئات' : 'Categories'}
      </CardHeader>
      <CardBody className="gap-3 pt-0">
        <Input variant="bordered" aria-label={ARABIC ? 'الفئات' : 'Categories'}
          value={text} onValueChange={setText} placeholder="Drinks, Snacks, Dairy…" />
        <Button color="primary" className="self-start" onPress={save}>{ARABIC ? 'حفظ' : 'Save'}</Button>
      </CardBody>
    </Card>
  );
}

function Users({ me, notify }) {
  const [users, setUsers] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'user', views: [], full_name: '', wage: '' });
  const VIEW_OPTS = ['inventory', 'receive', 'history', 'reports'];
  const load = useCallback(() => api.get('/users').then(setUsers).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (form.password.length < 8) { notify(ARABIC ? 'كلمة المرور 8 أحرف على الأقل' : 'Password 8+ chars', 'red'); return; }
    try {
      await api.post('/users', { username: form.username, password: form.password, role: form.role, views: form.role === 'admin' ? [] : form.views, full_name: form.full_name, wage: Number(form.wage) || 0 });
      setAdding(false); setForm({ username: '', password: '', role: 'user', views: [], full_name: '', wage: '' }); load();
      notify(ARABIC ? 'تمت إضافة المستخدم' : 'User added', 'green');
    } catch (ex) { notify(ex.message === 'exists' ? (ARABIC ? 'اسم مستخدم مكرر' : 'Username taken') : (ARABIC ? 'فشل' : 'Failed'), 'red'); }
  };
  const del = async (u) => {
    if (!window.confirm((ARABIC ? 'حذف ' : 'Delete ') + u.username + '?')) return;
    try { await api.del('/users/' + u.id); load(); } catch (_) { notify(ARABIC ? 'فشل' : 'Failed', 'red'); }
  };
  const toggleView = (v) => setForm((f) => ({ ...f, views: f.views.includes(v) ? f.views.filter((x) => x !== v) : [...f.views, v] }));

  return (
    <Card shadow="sm">
      <CardHeader className="justify-between">
        <div className="flex items-center gap-2 text-base font-bold">
          <UsersRound size={18} className="text-foreground-500" />
          {ARABIC ? 'الموظفون' : 'Employees'}
        </div>
        <Button size="sm" variant="bordered" onPress={() => setAdding((a) => !a)}>
          {adding ? (ARABIC ? 'إغلاق' : 'Close') : (ARABIC ? '+ موظف' : '+ Employee')}
        </Button>
      </CardHeader>
      <CardBody className="gap-3 pt-0">
        {adding && (
          <div className="flex flex-col gap-3 rounded-medium bg-content2 p-3">
            <Input variant="bordered" labelPlacement="outside"
              label={ARABIC ? 'الاسم الكامل' : 'Full name'}
              value={form.full_name} onValueChange={(v) => setForm({ ...form, full_name: v })} />
            <Input variant="bordered" labelPlacement="outside" autoCapitalize="off"
              label={ARABIC ? 'اسم المستخدم' : 'Username'}
              value={form.username} onValueChange={(v) => setForm({ ...form, username: v })} />
            <Input type="password" variant="bordered" labelPlacement="outside"
              label={ARABIC ? 'كلمة المرور (8+)' : 'Password (8+)'}
              value={form.password} onValueChange={(v) => setForm({ ...form, password: v })} />
            <Input type="number" step="0.01" variant="bordered" labelPlacement="outside"
              label={ARABIC ? 'أجر الساعة (اختياري)' : 'Hourly wage (optional)'}
              classNames={{ input: 'tnum' }}
              value={form.wage} onValueChange={(v) => setForm({ ...form, wage: v })} />
            <div className="flex gap-2">
              {['user', 'admin'].map((r) => (
                <Button key={r} className="flex-1"
                  color={form.role === r ? 'primary' : 'default'}
                  variant={form.role === r ? 'solid' : 'bordered'}
                  onPress={() => setForm({ ...form, role: r })}>
                  {r}
                </Button>
              ))}
            </div>
            {form.role === 'user' && (
              <div className="flex flex-wrap gap-2">
                {VIEW_OPTS.map((v) => (
                  <Button key={v} size="sm"
                    color={form.views.includes(v) ? 'primary' : 'default'}
                    variant={form.views.includes(v) ? 'solid' : 'bordered'}
                    onPress={() => toggleView(v)}>
                    {VIEW_LABELS[v]}
                  </Button>
                ))}
              </div>
            )}
            <Button color="primary" className="self-start" onPress={add}>{ARABIC ? 'إضافة' : 'Add'}</Button>
          </div>
        )}
        <div className="flex flex-col">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-2 border-t border-divider py-2">
              <div className="min-w-0 flex-1">
                <span className="font-semibold">{u.full_name || u.username}</span>
                <span className="tnum ms-2 text-xs text-foreground-500">
                  {u.username} · {u.role}{u.role !== 'admin' && (u.allowed_views || []).length ? ' · ' + u.allowed_views.join(', ') : ''}{Number(u.wage) > 0 ? ' · ' + money(u.wage) + '/h' : ''}
                </span>
              </div>
              {u.id !== me.id && (
                <Button size="sm" color="danger" variant="bordered" onPress={() => del(u)}>
                  {ARABIC ? 'حذف' : 'Del'}
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

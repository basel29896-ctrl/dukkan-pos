import React, { useState } from 'react';
import { Button, Card, CardBody, Input } from '@heroui/react';
import { Languages, Moon, Sun } from 'lucide-react';
import api from '../api';
import { STORE_NAME, ARABIC } from '../client.config';
import { THEME, setPref } from '../lib/prefs';
import OnScreenKeyboard from '../components/OnScreenKeyboard';

// Login — photo background with a light veil, floating end-aligned card.
// The on-screen keyboard types into whichever field was focused last; the
// keyboard's own keys preventDefault on mousedown so focus never leaves it.
export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState('username');   // which field the keyboard types into
  const [kb, setKb] = useState(true);                 // on-screen keyboard visible

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const u = await api.post('/auth/login', { username, password });
      onLogin(u);
    } catch (ex) {
      setErr(ARABIC ? 'اسم المستخدم أو كلمة المرور غير صحيحة' : 'Invalid username or password');
    } finally { setBusy(false); }
  };

  const setActiveValue = (fn) => (active === 'username' ? setUsername(fn) : setPassword(fn));
  const onKey = (ch) => setActiveValue((v) => v + ch);
  const onBackspace = () => setActiveValue((v) => v.slice(0, -1));

  // Accent border + soft ring on the field the keyboard is driving (only while shown).
  const fieldWrapper = (name) =>
    active === name && kb
      ? 'border-primary ring-2 ring-primary/20 data-[hover=true]:border-primary group-data-[focus=true]:border-primary'
      : '';

  const bg = (process.env.PUBLIC_URL || '') + '/login-bg.png';
  return (
    <div dir="ltr"
      className="flex min-h-screen items-center justify-end bg-cover bg-center p-[clamp(16px,4vw,64px)] font-sans"
      style={{ backgroundImage: `linear-gradient(90deg, rgba(250,250,250,0) 0%, rgba(250,250,250,.35) 45%, rgba(250,250,250,.95) 100%), url(${bg})` }}>
      <form onSubmit={submit} dir={ARABIC ? 'rtl' : 'ltr'} className="w-[min(94vw,440px)]">
        <Card shadow="lg" className="bg-content1/95 shadow-large backdrop-blur-md">
          <CardBody className="flex flex-col gap-3 p-6">
            <div>
              <div className="text-center text-2xl font-bold tracking-tight text-foreground">{STORE_NAME}</div>
              <div className="text-center text-sm text-foreground-500">{ARABIC ? 'تسجيل الدخول' : 'Sign in'}</div>
            </div>

            <Input size="lg" variant="bordered" placeholder={ARABIC ? 'اسم المستخدم' : 'Username'}
              value={username} onChange={(e) => setUsername(e.target.value)}
              onFocus={() => { setActive('username'); setKb(true); }}
              autoFocus autoCapitalize="off" autoComplete="off"
              classNames={{ inputWrapper: fieldWrapper('username') }} />
            <Input size="lg" variant="bordered" type="password" placeholder={ARABIC ? 'كلمة المرور' : 'Password'}
              value={password} onChange={(e) => setPassword(e.target.value)}
              onFocus={() => { setActive('password'); setKb(true); }}
              autoComplete="off"
              classNames={{ inputWrapper: fieldWrapper('password') }} />

            {err && <div className="text-sm text-danger">{err}</div>}

            {process.env.REACT_APP_DEMO === '1' && (
              <div className="rounded-medium bg-content2 p-3 text-center text-sm text-foreground-500">
                DEMO — no backend. Sign in: <b className="text-primary">admin</b> / any password<br />
                or <b className="text-primary">cashier</b> (limited views). Data is local to your browser.
              </div>
            )}

            <Button type="submit" color="primary" fullWidth size="lg" isLoading={busy}>
              {ARABIC ? 'دخول' : 'Login'}
            </Button>

            {!kb && (
              <Button type="button" variant="bordered" fullWidth onPress={() => setKb(true)}>
                {ARABIC ? 'إظهار لوحة المفاتيح' : 'Show keyboard'}
              </Button>
            )}
            {kb && <OnScreenKeyboard onKey={onKey} onBackspace={onBackspace} onEnter={submit} onClose={() => setKb(false)} />}

            <div className="flex gap-2">
              <Button type="button" size="sm" variant="bordered" className="flex-1"
                startContent={<Languages size={15} />}
                onPress={() => setPref('dukkan_lang', ARABIC ? 'en' : 'ar')}>
                {ARABIC ? 'English' : 'عربية'}
              </Button>
              <Button type="button" size="sm" variant="bordered" className="flex-1"
                startContent={THEME === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                onPress={() => setPref('dukkan_theme', THEME === 'dark' ? 'light' : 'dark')}>
                {THEME === 'dark' ? (ARABIC ? 'فاتح' : 'Light') : (ARABIC ? 'داكن' : 'Dark')}
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}

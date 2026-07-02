import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardBody, Input, Button } from '@heroui/react';
import { Download, Hourglass, Calculator, Clock, PieChart } from 'lucide-react';
import api from '../api';
import { ARABIC, DEFAULT_FLOOR } from '../client.config';
import { money } from '../lib/format';

// Shared list-row / empty-state recipes — every report card renders the same row shape.
const ROW = 'flex justify-between border-b border-divider py-1.5 text-sm last:border-0';
const EMPTY = 'text-sm text-foreground-500';

function CardTitle({ icon: Icon, children }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-base font-bold text-foreground">
      {Icon && <Icon size={16} className="shrink-0 text-foreground-500" />}
      <span>{children}</span>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <Card shadow="sm">
      <CardBody className="p-4">
        <div className="text-xs font-semibold text-foreground-500">{label}</div>
        <div className={`tnum mt-1 whitespace-nowrap text-2xl font-bold tracking-tight xl:text-3xl ${accent ? 'text-primary' : 'text-foreground'}`}>
          {value}
        </div>
      </CardBody>
    </Card>
  );
}

// Reports — range summary, top sellers, stock/expiry alerts, Z-report, hours, ABC.
export default function Reports({ notify }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [sum, setSum] = useState(null);
  const [top, setTop] = useState([]);
  const [low, setLow] = useState([]);
  const [exp, setExp] = useState([]);
  const [abc, setAbc] = useState([]);
  const [zrep, setZrep] = useState(null);
  const [hours, setHours] = useState([]);

  const load = useCallback(() => {
    const qs = `?from=${from}&to=${to}`;
    api.get('/reports/summary' + qs).then(setSum).catch(() => notify(ARABIC ? 'تعذّر تحميل التقارير' : 'Failed to load reports', 'red'));
    api.get('/reports/top-products' + qs + '&limit=10').then(setTop).catch(() => {});
    api.get('/reports/low-stock?threshold=5').then(setLow).catch(() => {});
    api.get('/expiry?days=30').then(setExp).catch(() => {});
    api.get('/reports/abc' + qs).then(setAbc).catch(() => {});
    api.get('/reports/zreport?date=' + to).then(setZrep).catch(() => {});
    api.get('/timeclock' + qs).then(setHours).catch(() => {});
  }, [from, to, notify]);
  useEffect(() => { load(); }, [load]);

  // Export the sales in the selected range to a CSV the owner can hand to an accountant.
  const exportCSV = async () => {
    try {
      const all = await api.get('/orders?floor=' + DEFAULT_FLOOR + '&limit=100000');
      const rows = all.filter((o) => { const d = o.date || (o.created_at || '').slice(0, 10); return d >= from && d <= to; });
      const head = ['invoice_no', 'date', 'time', 'payment', 'items', 'total'];
      const body = rows.map((o) => [o.invoice_no, o.date, o.time, o.pay, (o.items || []).reduce((n, l) => n + (l.qty || 0), 0), Number(o.total).toFixed(3)]);
      const csv = [head, ...body].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `dukkan-sales_${from}_${to}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (_) { notify(ARABIC ? 'فشل التصدير' : 'Export failed', 'red'); }
  };

  // Aggregate clocked hours per employee.
  const hoursByUser = Object.values(hours.reduce((m, h) => { (m[h.username] = m[h.username] || { username: h.username, hours: 0 }).hours += Number(h.hours) || 0; return m; }, {}));
  const abcClass = (c) => abc.filter((x) => x.class === c);

  return (
    <div className="flex flex-col gap-4">
      {/* Date range + export */}
      <div className="flex flex-wrap items-end gap-3">
        <Input type="date" label={ARABIC ? 'من' : 'From'} labelPlacement="outside" variant="bordered"
          className="w-44" classNames={{ input: 'tnum' }}
          value={from} onValueChange={setFrom} />
        <Input type="date" label={ARABIC ? 'إلى' : 'To'} labelPlacement="outside" variant="bordered"
          className="w-44" classNames={{ input: 'tnum' }}
          value={to} onValueChange={setTo} />
        <Button variant="bordered" startContent={<Download size={16} />} onPress={exportCSV}>
          {ARABIC ? 'تصدير CSV' : 'Export CSV'}
        </Button>
      </div>

      {/* Range summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={ARABIC ? 'الإيراد' : 'Revenue'} value={money(sum && sum.revenue)} accent />
        <Stat label={ARABIC ? 'عدد الفواتير' : 'Sales'} value={sum ? sum.orders : '—'} />
        <Stat label={ARABIC ? 'وحدات مباعة' : 'Units sold'} value={sum ? Number(sum.units) : '—'} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card shadow="sm">
          <CardBody className="p-4">
            <CardTitle>{ARABIC ? 'الأكثر مبيعاً' : 'Top products'}</CardTitle>
            {top.map((t, i) => (
              <div key={i} className={ROW}>
                <span>{t.name}</span>
                <span className="tnum text-foreground-500">{Number(t.units)} · {money(t.revenue)}</span>
              </div>
            ))}
            {!top.length && <div className={EMPTY}>{ARABIC ? 'لا بيانات' : 'No data'}</div>}
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardBody className="p-4">
            <CardTitle>{ARABIC ? 'مخزون منخفض' : 'Low stock'}</CardTitle>
            {low.map((p) => (
              <div key={p.id} className={ROW}>
                <span>{p.name}</span>
                <span className={`tnum font-semibold ${Number(p.stock) <= 0 ? 'text-danger' : 'text-warning-600'}`}>{Number(p.stock)}</span>
              </div>
            ))}
            {!low.length && <div className={EMPTY}>{ARABIC ? 'كل المخزون جيد' : 'All stocked'}</div>}
          </CardBody>
        </Card>
      </div>

      {/* Expiry watch */}
      <Card shadow="sm">
        <CardBody className="p-4">
          <CardTitle icon={Hourglass}>{ARABIC ? 'قرب الانتهاء (٣٠ يوم)' : 'Expiring soon (30 days)'}</CardTitle>
          {exp.map((e) => {
            const dl = Number(e.days_left);
            const col = dl < 0 ? 'text-danger' : dl <= 7 ? 'text-warning-600' : 'text-foreground-500';
            return (
              <div key={e.id} className={ROW}>
                <span>{e.product} {e.supplier ? <span className="text-xs text-foreground-500">· {e.supplier}</span> : null}</span>
                <span className={`tnum font-semibold ${col}`}>{e.expiry} ({dl < 0 ? (ARABIC ? 'منتهي' : 'expired') : dl + (ARABIC ? ' يوم' : 'd')})</span>
              </div>
            );
          })}
          {!exp.length && <div className={EMPTY}>{ARABIC ? 'لا شيء قريب الانتهاء' : 'Nothing expiring soon'}</div>}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Z-report: daily close-out by payment method */}
        <Card shadow="sm">
          <CardBody className="p-4">
            <CardTitle icon={Calculator}>
              {ARABIC ? 'تقرير اليوم (إغلاق)' : 'Z-Report (close-out)'} — <span className="tnum">{to}</span>
            </CardTitle>
            {zrep && zrep.lines.map((l) => (
              <div key={l.pay} className={ROW}>
                <span className="capitalize">{l.pay} <span className="tnum text-xs text-foreground-500">×{l.orders}</span></span>
                <span className="tnum font-semibold">{money(l.total)}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between pt-2">
              <span className="font-semibold text-foreground-500">{ARABIC ? 'الصافي' : 'Net'}</span>
              <span className="tnum text-xl font-bold text-primary">{money(zrep && zrep.net)}</span>
            </div>
          </CardBody>
        </Card>
        {/* Employee hours */}
        <Card shadow="sm">
          <CardBody className="p-4">
            <CardTitle icon={Clock}>{ARABIC ? 'ساعات الموظفين' : 'Employee hours'}</CardTitle>
            {hoursByUser.map((h) => (
              <div key={h.username} className={ROW}>
                <span>{h.username}</span>
                <span className="tnum text-foreground-500">{h.hours.toFixed(2)} {ARABIC ? 'ساعة' : 'h'}</span>
              </div>
            ))}
            {!hoursByUser.length && <div className={EMPTY}>{ARABIC ? 'لا سجلّات' : 'No punches'}</div>}
          </CardBody>
        </Card>
      </div>

      {/* ABC analysis */}
      <Card shadow="sm">
        <CardBody className="p-4">
          <CardTitle icon={PieChart}>{ARABIC ? 'تحليل ABC (مساهمة الإيراد)' : 'ABC analysis (revenue contribution)'}</CardTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              ['A', 'text-success', ARABIC ? 'الأهم (٨٠٪)' : 'Top (80%)'],
              ['B', 'text-warning-600', ARABIC ? 'متوسط (١٥٪)' : 'Mid (15%)'],
              ['C', 'text-foreground-500', ARABIC ? 'الأقل (٥٪)' : 'Low (5%)'],
            ].map(([cls, col, lbl]) => (
              <div key={cls}>
                <div className={`mb-1 text-sm font-bold ${col}`}>{cls} · {lbl} <span className="tnum">({abcClass(cls).length})</span></div>
                {abcClass(cls).slice(0, 8).map((x, i) => (
                  <div key={i} className={`${ROW} gap-2`}>
                    <span className="min-w-0 truncate">{x.name}</span>
                    <span className="tnum shrink-0 text-foreground-500">{money(x.revenue)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {!abc.length && <div className={EMPTY}>{ARABIC ? 'لا بيانات مبيعات' : 'No sales data'}</div>}
        </CardBody>
      </Card>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Spinner,
  Table, TableHeader, TableColumn, TableBody, TableRow, TableCell,
} from '@heroui/react';
import { Printer, Undo2 } from 'lucide-react';
import api from '../api';
import { ARABIC, DEFAULT_FLOOR } from '../client.config';
import { money } from '../lib/format';
import { printReceipt, uid, nowParts } from '../lib/receipt';

// Plain <button> stepper keys — same visual language as NumPad / the Sales
// cart stepper (content2 inset, divider border, press scale).
const STEP =
  'h-10 w-10 shrink-0 select-none rounded-medium border border-divider bg-content2 text-xl font-semibold ' +
  'leading-none text-foreground transition-transform hover:bg-content3 active:scale-[0.97]';

// ══════════════════════════════════════════════════════════════════════════════
// History — recent sales, reprint + (full or partial) returns
// ══════════════════════════════════════════════════════════════════════════════
export default function History({ user, notify }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [returning, setReturning] = useState(null); // sale being returned

  const load = useCallback(() => {
    setLoading(true);
    api.get('/orders?floor=' + DEFAULT_FLOOR + '&limit=200')
      .then(setSales).catch(() => notify(ARABIC ? 'تعذّر تحميل السجل' : 'Failed to load history', 'red'))
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  // Process a (full or partial) return: record a reversing order for the chosen lines + restore stock.
  const doReturn = async (sale, lines) => {
    const items = lines.filter((l) => l.qty > 0);
    if (!items.length) { setReturning(null); return; }
    const refundTotal = items.reduce((s, l) => s + l.price * l.qty, 0);
    setBusyId(sale.id);
    try {
      const invoice_no = await api.get('/invoice/next?floor=' + DEFAULT_FLOOR);
      const { date, time } = nowParts();
      const r = { id: uid(), floor: DEFAULT_FLOOR, items, sub: -refundTotal, tax: 0, svc: 0, disc: 0, total: -refundTotal, pay: 'refund', waiter: user.username, status: 'refund', date, time, invoice_no, buyer: 'return of #' + sale.invoice_no };
      await api.post('/orders', r);
      await Promise.all(items.map((l) => typeof l.id === 'number' && api.patch('/products/' + l.id + '/stock', { delta: +l.qty }).catch(() => {})));
      notify(ARABIC ? 'تم الاسترجاع' : 'Returned', 'green');
      setReturning(null); load();
    } catch (ex) { notify(ARABIC ? 'فشل الاسترجاع' : 'Return failed', 'red'); } finally { setBusyId(null); }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size="lg" label={ARABIC ? 'جارٍ التحميل…' : 'Loading…'} />
      </div>
    );
  }

  return (
    <>
      <Table aria-label={ARABIC ? 'سجل المبيعات' : 'Sales history'} shadow="sm">
        <TableHeader>
          <TableColumn>#</TableColumn>
          <TableColumn>{ARABIC ? 'التاريخ' : 'Date'}</TableColumn>
          <TableColumn>{ARABIC ? 'الأصناف' : 'Items'}</TableColumn>
          <TableColumn>{ARABIC ? 'الدفع' : 'Pay'}</TableColumn>
          <TableColumn className="text-end">{ARABIC ? 'المجموع' : 'Total'}</TableColumn>
          <TableColumn className="text-end">
            <span className="sr-only">{ARABIC ? 'إجراءات' : 'Actions'}</span>
          </TableColumn>
        </TableHeader>
        <TableBody emptyContent={ARABIC ? 'لا مبيعات بعد' : 'No sales yet'}>
          {sales.map((s) => {
            const isRefund = Number(s.total) < 0 || s.pay === 'refund';
            return (
              <TableRow key={s.id} className={isRefund ? 'opacity-70' : ''}>
                <TableCell className="tnum font-semibold">{s.invoice_no}</TableCell>
                <TableCell className="tnum text-foreground-500">{s.date} {s.time}</TableCell>
                <TableCell className="tnum text-foreground-500">{(s.items || []).reduce((n, l) => n + (l.qty || 0), 0)}</TableCell>
                <TableCell className={isRefund ? 'text-danger' : ''}>{isRefund ? (ARABIC ? '↩ استرجاع' : '↩ refund') : s.pay}</TableCell>
                <TableCell className={`tnum text-end font-semibold ${isRefund ? 'text-danger' : ''}`}>{money(s.total)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2 whitespace-nowrap">
                    <Button size="sm" variant="bordered" startContent={<Printer size={14} />} onPress={() => printReceipt(s)}>
                      {ARABIC ? 'طباعة' : 'Print'}
                    </Button>
                    {!isRefund && (
                      <Button size="sm" variant="bordered" color="danger" isLoading={busyId === s.id} onPress={() => setReturning(s)}>
                        {ARABIC ? 'استرجاع' : 'Return'}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {returning && (
        <ReturnModal sale={returning} busy={busyId === returning.id}
          onClose={() => setReturning(null)} onConfirm={(lines) => doReturn(returning, lines)} />
      )}
    </>
  );
}

// Pick how many of each line to return (defaults to full quantity).
function ReturnModal({ sale, onClose, onConfirm, busy }) {
  const [qty, setQty] = useState(() => (sale.items || []).map((l) => Number(l.qty) || 0));
  const lines = (sale.items || []).map((l, i) => ({ ...l, qty: qty[i] }));
  const refundTotal = lines.reduce((s, l) => s + (Number(l.price) || 0) * l.qty, 0);
  const setI = (i, v) => setQty((q) => q.map((x, j) => (j === i ? Math.max(0, Math.min(Number(sale.items[i].qty) || 0, v)) : x)));
  return (
    <Modal isOpen size="sm" onClose={onClose}>
      <ModalContent dir={ARABIC ? 'rtl' : 'ltr'}>
        <ModalHeader className="flex items-center gap-2 text-base font-bold">
          <Undo2 size={18} className="text-danger" />
          <span>{ARABIC ? 'استرجاع فاتورة' : 'Return sale'} <span className="tnum">#{sale.invoice_no}</span></span>
        </ModalHeader>
        <ModalBody className="gap-3">
          {(sale.items || []).map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-semibold">
                {l.name}{' '}
                <span className="text-xs font-medium text-foreground-500">
                  ({ARABIC ? 'بيع' : 'sold'} <span className="tnum">{Number(l.qty)}</span>)
                </span>
              </span>
              <button type="button" onClick={() => setI(i, qty[i] - 1)} className={STEP}>−</button>
              <span className="tnum min-w-7 text-center text-lg font-bold">{qty[i]}</span>
              <button type="button" onClick={() => setI(i, qty[i] + 1)} className={STEP}>+</button>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-base font-semibold text-foreground-500">{ARABIC ? 'مبلغ الاسترجاع' : 'Refund'}</span>
            <span className="tnum text-xl font-bold text-danger">{money(refundTotal)}</span>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button color="primary" className="flex-1" isDisabled={busy || refundTotal <= 0} isLoading={busy}
            onPress={() => onConfirm(lines)}>
            {ARABIC ? 'تأكيد الاسترجاع' : 'Confirm return'}
          </Button>
          <Button variant="bordered" onPress={onClose}>{ARABIC ? 'إلغاء' : 'Cancel'}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

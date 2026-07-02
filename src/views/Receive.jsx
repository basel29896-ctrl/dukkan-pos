import React, { useState, useEffect, useCallback } from 'react';
import { Button, Card, CardHeader, CardBody, Input, Select, SelectItem } from '@heroui/react';
import { Inbox, Plus, Tag, History, Hourglass } from 'lucide-react';
import api from '../api';
import { ARABIC } from '../client.config';

// Receive — restock with supplier + expiry (creates a batch, bumps stock).
export default function Receive({ isAdmin, notify }) {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [form, setForm] = useState({ product_id: '', supplier_id: '', qty: '', cost: '', expiry: '' });
  const [newSup, setNewSup] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/products').then(setProducts).catch(() => {});
    api.get('/suppliers').then(setSuppliers).catch(() => {});
    api.get('/batches').then(setBatches).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const receive = async () => {
    if (!form.product_id || !(Number(form.qty) > 0)) { notify(ARABIC ? 'اختر المنتج والكمية' : 'Pick product + qty', 'red'); return; }
    setBusy(true);
    try {
      await api.post('/batches', { product_id: Number(form.product_id), supplier_id: form.supplier_id ? Number(form.supplier_id) : null, qty: Number(form.qty), cost: Number(form.cost) || 0, expiry: form.expiry || null });
      setForm({ product_id: '', supplier_id: '', qty: '', cost: '', expiry: '' });
      load();
      notify(ARABIC ? 'تم استلام البضاعة' : 'Stock received', 'green');
    } catch (_) { notify(ARABIC ? 'فشل' : 'Failed', 'red'); } finally { setBusy(false); }
  };
  const addSupplier = async () => {
    if (!newSup.name.trim()) return;
    try { await api.post('/suppliers', newSup); setNewSup({ name: '', phone: '' }); api.get('/suppliers').then(setSuppliers); notify(ARABIC ? 'تمت إضافة المورّد' : 'Supplier added', 'green'); }
    catch (_) { notify(ARABIC ? 'فشل' : 'Failed', 'red'); }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {/* Receive stock */}
      <Card shadow="sm">
        <CardHeader className="gap-2 p-4 pb-0 text-base font-bold">
          <Inbox size={18} className="text-primary" />
          {ARABIC ? 'استلام بضاعة' : 'Receive stock'}
        </CardHeader>
        <CardBody className="gap-4 p-4">
          <Select label={ARABIC ? 'المنتج' : 'Product'} labelPlacement="outside" variant="bordered"
            placeholder={ARABIC ? '— اختر —' : '— select —'}
            selectedKeys={form.product_id ? [String(form.product_id)] : []}
            onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
            {products.map((p) => <SelectItem key={String(p.id)}>{p.name}</SelectItem>)}
          </Select>
          <Select label={ARABIC ? 'المورّد' : 'Supplier'} labelPlacement="outside" variant="bordered"
            placeholder={ARABIC ? '— بدون —' : '— none —'}
            selectedKeys={form.supplier_id ? [String(form.supplier_id)] : []}
            onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
            {suppliers.map((s) => <SelectItem key={String(s.id)}>{s.name}</SelectItem>)}
          </Select>
          <div className="flex gap-3">
            <Input label={ARABIC ? 'الكمية' : 'Quantity'} labelPlacement="outside" variant="bordered"
              type="number" step="0.001" placeholder="0.000" classNames={{ input: 'tnum' }}
              value={form.qty} onValueChange={(v) => setForm({ ...form, qty: v })} />
            <Input label={ARABIC ? 'التكلفة/وحدة' : 'Cost/unit'} labelPlacement="outside" variant="bordered"
              type="number" step="0.001" placeholder="0.000" classNames={{ input: 'tnum' }}
              value={form.cost} onValueChange={(v) => setForm({ ...form, cost: v })} />
          </div>
          <Input label={ARABIC ? 'تاريخ الانتهاء' : 'Expiry date'} labelPlacement="outside" variant="bordered"
            type="date" classNames={{ input: 'tnum' }}
            value={form.expiry} onValueChange={(v) => setForm({ ...form, expiry: v })} />
          <Button fullWidth color="primary" size="lg" isLoading={busy} onPress={receive}
            startContent={!busy && <Plus size={20} />}>
            {ARABIC ? 'استلام وتحديث المخزون' : 'Receive & add to stock'}
          </Button>
        </CardBody>
      </Card>

      <div className="flex flex-col gap-4">
        {/* Suppliers */}
        <Card shadow="sm">
          <CardHeader className="gap-2 p-4 pb-0 text-base font-bold">
            <Tag size={18} className="text-primary" />
            {ARABIC ? 'الموردون' : 'Suppliers'}
          </CardHeader>
          <CardBody className="gap-2 p-4">
            <div className="flex gap-2">
              <Input variant="bordered" placeholder={ARABIC ? 'اسم المورّد' : 'Supplier name'}
                value={newSup.name} onValueChange={(v) => setNewSup({ ...newSup, name: v })} />
              <Input variant="bordered" className="max-w-32" placeholder={ARABIC ? 'هاتف' : 'Phone'}
                classNames={{ input: 'tnum' }}
                value={newSup.phone} onValueChange={(v) => setNewSup({ ...newSup, phone: v })} />
              <Button isIconOnly color="primary" onPress={addSupplier}
                aria-label={ARABIC ? 'إضافة مورّد' : 'Add supplier'}>
                <Plus size={20} />
              </Button>
            </div>
            {suppliers.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-t border-divider py-2 text-sm">
                <span className="font-semibold">{s.name}</span>
                <span className="tnum text-foreground-500">{s.phone || ''}</span>
              </div>
            ))}
            {!suppliers.length && <div className="text-sm text-foreground-500">{ARABIC ? 'لا موردين' : 'No suppliers'}</div>}
          </CardBody>
        </Card>

        {/* Recent receipts */}
        <Card shadow="sm">
          <CardHeader className="gap-2 p-4 pb-0 text-base font-bold">
            <History size={18} className="text-primary" />
            {ARABIC ? 'آخر الاستلامات' : 'Recent receipts'}
          </CardHeader>
          <CardBody className="gap-0 p-4 pt-2">
            {batches.slice(0, 12).map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0">
                <span className="min-w-0 truncate">
                  {b.product} <span className="tnum text-foreground-500">×{Number(b.qty)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-foreground-500">
                  {b.supplier || '—'}
                  {b.expiry && (
                    <>
                      <span>·</span>
                      <Hourglass size={12} />
                      <span className="tnum">{b.expiry}</span>
                    </>
                  )}
                </span>
              </div>
            ))}
            {!batches.length && <div className="text-sm text-foreground-500">{ARABIC ? 'لا شيء بعد' : 'Nothing yet'}</div>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

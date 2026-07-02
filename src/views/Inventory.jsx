import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Input, Chip,
  Table, TableHeader, TableColumn, TableBody, TableRow, TableCell,
} from '@heroui/react';
import { Search, Plus } from 'lucide-react';
import api from '../api';
import { ARABIC } from '../client.config';
import { money } from '../lib/format';
import ProductModal from '../components/ProductModal';

// Inventory — product catalogue: search, add/edit, admin delete.
export default function Inventory({ isAdmin, notify }) {
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);  // product or {} for new
  const load = useCallback(() => api.get('/products').then(setProducts).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const remove = async (p) => {
    if (!window.confirm((ARABIC ? 'حذف ' : 'Delete ') + p.name + '?')) return;
    try { await api.del('/products/' + p.id); setProducts((prev) => prev.filter((x) => x.id !== p.id)); }
    catch (ex) { notify(ARABIC ? 'فشل الحذف' : 'Delete failed', 'red'); }
  };

  const rows = q.trim()
    ? products.filter((p) => (p.name || '').toLowerCase().includes(q.toLowerCase()) || (p.barcode || '').includes(q))
    : products;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Input className="flex-1" variant="bordered" value={q} onValueChange={setQ}
          placeholder={ARABIC ? 'بحث عن منتج' : 'Search products'}
          aria-label={ARABIC ? 'بحث عن منتج' : 'Search products'}
          startContent={<Search size={16} className="text-foreground-500" />} />
        <Button color="primary" startContent={<Plus size={16} />} onPress={() => setEditing({})}>
          {ARABIC ? 'منتج' : 'Product'}
        </Button>
      </div>

      <Table aria-label={ARABIC ? 'المنتجات' : 'Products'} shadow="sm">
        <TableHeader>
          <TableColumn>{ARABIC ? 'الاسم' : 'Name'}</TableColumn>
          <TableColumn>{ARABIC ? 'الباركود' : 'Barcode'}</TableColumn>
          <TableColumn>{ARABIC ? 'الفئة' : 'Category'}</TableColumn>
          <TableColumn className="text-end">{ARABIC ? 'السعر' : 'Price'}</TableColumn>
          <TableColumn className="text-end">{ARABIC ? 'المخزون' : 'Stock'}</TableColumn>
          <TableColumn className="text-end">
            <span className="sr-only">{ARABIC ? 'إجراءات' : 'Actions'}</span>
          </TableColumn>
        </TableHeader>
        <TableBody items={rows} emptyContent={ARABIC ? 'لا منتجات' : 'No products'}>
          {(p) => (
            <TableRow key={p.id}>
              <TableCell className="font-semibold">{p.name}</TableCell>
              <TableCell className="font-mono text-sm text-foreground-500">{p.barcode || '—'}</TableCell>
              <TableCell>
                {p.cat ? <Chip size="sm" variant="flat">{p.cat}</Chip> : <span className="text-foreground-500">—</span>}
              </TableCell>
              <TableCell className="tnum text-end">{money(p.price)}</TableCell>
              <TableCell className="tnum text-end font-semibold">
                {Number(p.stock) <= 5
                  ? <Chip size="sm" color="danger" variant="flat" className="tnum">{Number(p.stock)}</Chip>
                  : Number(p.stock)}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2 whitespace-nowrap">
                  <Button size="sm" variant="bordered" onPress={() => setEditing(p)}>
                    {ARABIC ? 'تعديل' : 'Edit'}
                  </Button>
                  {isAdmin && (
                    <Button size="sm" color="danger" variant="light" onPress={() => remove(p)}>
                      {ARABIC ? 'حذف' : 'Del'}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editing && (
        <ProductModal initial={editing} editing={!!editing.id} notify={notify}
          onClose={() => setEditing(null)}
          onSaved={(p) => { setProducts((prev) => { const i = prev.findIndex((x) => x.id === p.id); return i >= 0 ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]; }); setEditing(null); }} />
      )}
    </div>
  );
}

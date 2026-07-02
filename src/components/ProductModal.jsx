import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Autocomplete, AutocompleteItem,
} from '@heroui/react';
import api from '../api';
import { ARABIC } from '../client.config';

// Add/Edit product modal (shared by Sales quick-add + Inventory).
// Mounted conditionally by the caller, so isOpen is always true here.
export default function ProductModal({ initial, onClose, onSaved, notify, editing }) {
  const [barcode, setBarcode] = useState(initial.barcode || '');
  const [name, setName] = useState(initial.name || '');
  const [price, setPrice] = useState(initial.price != null ? String(initial.price) : '');
  const [cat, setCat] = useState(initial.cat || '');
  const [stock, setStock] = useState(initial.stock != null ? String(initial.stock) : '');
  const [cost, setCost] = useState(initial.cost != null ? String(initial.cost) : '');
  const [unit, setUnit] = useState(initial.unit === 'kg' ? 'kg' : 'ea');
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    api.get('/settings/categories').then((r) => {
      try { setCats(r && r.value ? JSON.parse(r.value) : []); } catch (_) {}
    }).catch(() => {});
    nameRef.current && nameRef.current.focus();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) { notify(ARABIC ? 'الاسم مطلوب' : 'Name required', 'red'); return; }
    setBusy(true);
    const body = { barcode: barcode.trim() || null, name: name.trim(), price: Number(price) || 0, cat: cat || null, cost: Number(cost) || 0, stock: Number(stock) || 0, unit };
    try {
      if (editing) {
        await api.put('/products/' + initial.id, body);
        onSaved({ ...initial, ...body });
      } else {
        const p = await api.post('/products', body);
        onSaved(p);
      }
    } catch (ex) {
      notify(ex.message === 'exists' ? (ARABIC ? 'باركود مكرر' : 'Barcode already exists') : (ARABIC ? 'فشل الحفظ' : 'Save failed'), 'red');
    } finally { setBusy(false); }
  };

  return (
    <Modal isOpen onClose={onClose} size="sm" placement="center">
      {/* Modal portals to <body>, so re-assert direction on the content. */}
      <ModalContent dir={ARABIC ? 'rtl' : 'ltr'}>
        <form onSubmit={save}>
          <ModalHeader className="text-base font-bold">
            {editing ? (ARABIC ? 'تعديل منتج' : 'Edit product') : (ARABIC ? 'منتج جديد' : 'New product')}
          </ModalHeader>
          <ModalBody className="gap-4">
            <Input label={ARABIC ? 'الباركود' : 'Barcode'} labelPlacement="outside" variant="bordered"
              placeholder=" " value={barcode} onValueChange={setBarcode}
              classNames={{ input: 'tnum' }} />
            <Input ref={nameRef} label={ARABIC ? 'الاسم' : 'Name'} labelPlacement="outside" variant="bordered"
              placeholder=" " value={name} onValueChange={setName} />

            <div className="flex flex-col gap-1.5">
              <span className="text-small font-medium text-foreground-500">{ARABIC ? 'تباع بـ' : 'Sold by'}</span>
              <div className="flex gap-2">
                {[['ea', ARABIC ? 'بالقطعة' : 'Each'], ['kg', ARABIC ? 'بالوزن (كغ)' : 'Weight (kg)']].map(([v, lbl]) => (
                  <Button key={v} className="flex-1"
                    color={unit === v ? 'primary' : 'default'}
                    variant={unit === v ? 'solid' : 'bordered'}
                    onPress={() => setUnit(v)}>
                    {lbl}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label={unit === 'kg' ? (ARABIC ? 'السعر / كغ' : 'Price / kg') : (ARABIC ? 'السعر' : 'Price')}
                labelPlacement="outside" variant="bordered" type="number" step="0.001"
                placeholder="0.000" value={price} onValueChange={setPrice}
                classNames={{ input: 'tnum' }} />
              <Input label={ARABIC ? 'الكمية' : 'Stock'}
                labelPlacement="outside" variant="bordered" type="number" step="0.001"
                placeholder="0" value={stock} onValueChange={setStock}
                classNames={{ input: 'tnum' }} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Autocomplete label={ARABIC ? 'الفئة' : 'Category'} labelPlacement="outside" variant="bordered"
                placeholder=" " allowsCustomValue
                inputValue={cat} onInputChange={setCat}
                onSelectionChange={(k) => { if (k != null) setCat(String(k)); }}>
                {cats.map((c) => <AutocompleteItem key={c}>{c}</AutocompleteItem>)}
              </Autocomplete>
              <Input label={ARABIC ? 'التكلفة' : 'Cost'}
                labelPlacement="outside" variant="bordered" type="number" step="0.001"
                placeholder="0.000" value={cost} onValueChange={setCost}
                classNames={{ input: 'tnum' }} />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type="submit" color="primary" className="flex-1" isLoading={busy}>
              {ARABIC ? 'حفظ' : 'Save'}
            </Button>
            <Button variant="bordered" onPress={onClose}>
              {ARABIC ? 'إلغاء' : 'Cancel'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

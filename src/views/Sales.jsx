import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Button, Input, Card, CardBody, CardHeader,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip,
} from '@heroui/react';
import {
  ScanBarcode, Search, Plus, Minus, X, Monitor, Pause, Scale, Pencil, Check,
  Banknote, CreditCard, ReceiptText,
} from 'lucide-react';
import api from '../api';
import { STORE_NAME, ARABIC, DEFAULT_FLOOR } from '../client.config';
import { money } from '../lib/format';
import { printReceipt, uid, nowParts } from '../lib/receipt';
import NumPad from '../components/NumPad';
import ProductModal from '../components/ProductModal';

// ══════════════════════════════════════════════════════════════════════════════
// Sales — scan → cart → checkout
// ══════════════════════════════════════════════════════════════════════════════
const HELD_KEY = 'dukkan_held_sales';
const BC_NAME = 'dukkan_pos';

// Cart-line qty stepper / remove: plain buttons on purpose (fast, focus-neutral taps).
const QTY_BTN =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-medium border border-divider ' +
  'bg-content1 text-foreground transition-colors hover:bg-content2';

export default function Sales({ user, notify }) {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);          // [{id,barcode,name,price,qty}]
  const [scan, setScan] = useState('');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [pay, setPay] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [newProduct, setNewProduct] = useState(null); // {barcode} → modal
  const [editLine, setEditLine] = useState(null);      // cart line → qty/price keypad
  const [quickItem, setQuickItem] = useState(false);   // open-price misc item modal
  const [weighItem, setWeighItem] = useState(null);    // kg product → weight keypad
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(() => { try { return JSON.parse(localStorage.getItem(HELD_KEY)) || []; } catch (_) { return []; } });
  const [showHeld, setShowHeld] = useState(false);
  const scanRef = useRef(null);

  const loadProducts = useCallback(async () => {
    try { setProducts(await api.get('/products')); } catch (_) {}
  }, []);
  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { scanRef.current && scanRef.current.focus(); }, []);
  const persistHeld = (list) => { setHeld(list); localStorage.setItem(HELD_KEY, JSON.stringify(list)); };

  const addToCart = useCallback((p, qty = 1) => {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.id === p.id);
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], qty: next[i].qty + qty }; return next; }
      return [...prev, { id: p.id, barcode: p.barcode, name: p.name, price: Number(p.price) || 0, qty, unit: p.unit || 'ea' }];
    });
  }, []);
  const refocus = () => scanRef.current && scanRef.current.focus();

  // Add a catalogue product: weighed (kg) products open the weight keypad; others add directly.
  const addProduct = (p) => {
    if (p.unit === 'kg') { setWeighItem(p); return; }
    addToCart(p); refocus();
  };

  const onScan = async (code) => {
    const c = String(code || '').trim();
    if (!c) return;
    setScan('');
    const local = products.find((p) => p.barcode && p.barcode === c);
    if (local) { addProduct(local); return; }
    try {
      const p = await api.get('/products/barcode/' + encodeURIComponent(c));
      setProducts((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
      addProduct(p);
    } catch (ex) {
      if (ex.status === 404) setNewProduct({ barcode: c });
      else notify(ARABIC ? 'تعذّر البحث' : 'Lookup failed', 'red');
    }
  };

  const setQty = (id, qty) => setCart((prev) => prev.flatMap((l) => (l.id === id ? (qty <= 0 ? [] : [{ ...l, qty }]) : [l])));
  const setLine = (id, patch) => setCart((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setCart((prev) => prev.filter((l) => l.id !== id));
  const addCustom = ({ name, price, qty }) => setCart((prev) => [...prev, { id: 'misc-' + uid(), barcode: null, name, price: Number(price) || 0, qty: Number(qty) || 1, custom: true }]);

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const change = pay === 'cash' && tendered ? (Number(tendered) - total) : null;

  // Push the live cart to the customer-facing display (2nd screen).
  useEffect(() => {
    const payload = { items: cart.map((l) => ({ name: l.name, price: l.price, qty: l.qty })), total, change, store: STORE_NAME };
    try { localStorage.setItem('dukkan_display', JSON.stringify(payload)); } catch (_) {}
    try { const bc = new BroadcastChannel(BC_NAME); bc.postMessage(payload); bc.close(); } catch (_) {}
  }, [cart, total, change]);
  const openDisplay = () => window.open(window.location.pathname + '?display=1', 'dukkan_customer', 'width=900,height=700');

  // Hold the current cart for later; clear the screen for the next customer.
  const holdSale = () => {
    if (!cart.length) return;
    persistHeld([...held, { id: uid(), items: cart, total, ts: new Date().toLocaleTimeString().slice(0, 5) }]);
    setCart([]); setTendered('');
    notify(ARABIC ? 'تم تعليق الفاتورة' : 'Sale held', 'green');
  };
  const resumeSale = (h) => {
    if (cart.length && !window.confirm(ARABIC ? 'استبدال الفاتورة الحالية؟' : 'Replace current bill?')) return;
    setCart(h.items); persistHeld(held.filter((x) => x.id !== h.id)); setShowHeld(false);
  };

  const checkout = async () => {
    if (!cart.length || busy) return;
    setBusy(true);
    try {
      const invoice_no = await api.get('/invoice/next?floor=' + DEFAULT_FLOOR);
      const { date, time } = nowParts();
      const sale = { id: uid(), floor: DEFAULT_FLOOR, items: cart, sub: total, tax: 0, svc: 0, disc: 0, total, pay, waiter: user.username, status: 'paid', date, time, invoice_no };
      await api.post('/orders', sale);
      // Only deduct stock for real catalogue products (numeric id); custom/open-price lines have string ids.
      await Promise.all(cart.filter((l) => typeof l.id === 'number').map((l) => api.patch('/products/' + l.id + '/stock', { delta: -l.qty }).catch(() => {})));
      api.post('/stock-log', { kind: 'sale', changed_by: user.username, name: `invoice ${invoice_no}`, new_qty: cart.length }).catch(() => {});
      printReceipt(sale);
      setCart([]); setTendered(''); setPay('cash');
      loadProducts();
      notify(ARABIC ? `تمت الفاتورة #${invoice_no}` : `Sale #${invoice_no} done`, 'green');
      scanRef.current && scanRef.current.focus();
    } catch (ex) {
      notify(ex.message === 'invoice_taken' ? (ARABIC ? 'تعارض رقم الفاتورة، أعد المحاولة' : 'Invoice clash — retry') : (ARABIC ? 'فشل الدفع' : 'Checkout failed'), 'red');
    } finally { setBusy(false); }
  };

  // Product tiles: filter by category chip + optional name/barcode search.
  const cats = ['all', ...Array.from(new Set(products.map((p) => p.cat).filter(Boolean)))];
  const tiles = products.filter((p) => {
    if (cat !== 'all' && p.cat !== cat) return false;
    if (search.trim()) { const q = search.toLowerCase(); return (p.name || '').toLowerCase().includes(q) || (p.barcode || '').includes(search); }
    return true;
  });

  return (
    <div dir="ltr" className="flex flex-col-reverse items-stretch gap-4 lg:flex-row lg:items-start">
      {/* Left: scan + tap-to-add product tiles */}
      <div dir={ARABIC ? 'rtl' : 'ltr'} className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex gap-2.5">
          <Input ref={scanRef} size="lg" variant="bordered" value={scan} onValueChange={setScan}
            onKeyDown={(e) => { if (e.key === 'Enter') onScan(scan); }}
            placeholder={ARABIC ? 'امسح الباركود أو اضغط منتجاً' : 'Scan barcode or tap a product'}
            inputMode="search"
            startContent={<ScanBarcode size={20} className="shrink-0 text-foreground-500" />}
            classNames={{ input: 'text-base tracking-wide' }} />
          <Button size="lg" variant="bordered" className="shrink-0" startContent={<Plus size={18} />}
            onPress={() => setQuickItem(true)}>
            {ARABIC ? 'صنف يدوي' : 'Quick item'}
          </Button>
          <Tooltip content={ARABIC ? 'شاشة الزبون' : 'Customer screen'}>
            <Button size="lg" isIconOnly variant="bordered" className="shrink-0"
              aria-label={ARABIC ? 'شاشة الزبون' : 'Customer screen'} onPress={openDisplay}>
              <Monitor size={20} />
            </Button>
          </Tooltip>
          {!!held.length && (
            <Button size="lg" variant="bordered" className="shrink-0" startContent={<Pause size={18} />}
              onPress={() => setShowHeld(true)}>
              {ARABIC ? 'المعلّقة' : 'Held'} <span className="tnum">({held.length})</span>
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                cat === c
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-divider bg-content1 text-foreground-500 hover:bg-content2 hover:text-foreground'
              }`}>
              {c === 'all' ? (ARABIC ? 'الكل' : 'All') : c}
            </button>
          ))}
        </div>

        <Input variant="bordered" value={search} onValueChange={setSearch}
          placeholder={ARABIC ? 'ابحث بالاسم أو الباركود…' : 'Search by name or barcode…'}
          startContent={<Search size={16} className="shrink-0 text-foreground-500" />} />

        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-3">
          {tiles.map((p) => (
            <button key={p.id} onClick={() => addProduct(p)}
              className="flex h-28 flex-col justify-between gap-2 rounded-large border border-divider bg-content1 p-3 text-start shadow-sm transition-colors hover:border-primary hover:bg-content2">
              <span className="text-sm font-semibold leading-snug">
                {p.name}
                {p.unit === 'kg' && <Scale size={13} className="ms-1 inline text-foreground-500" />}
              </span>
              <span className="flex items-center justify-between">
                <span className="tnum text-base font-bold">
                  {money(p.price)}{p.unit === 'kg' ? (ARABIC ? '/كغ' : '/kg') : ''}
                </span>
                {Number(p.stock) <= 5 && (
                  <span className="tnum flex items-center gap-1 text-xs font-bold text-danger">
                    <span className="size-1.5 rounded-full bg-danger" />
                    {Number(p.stock)}
                  </span>
                )}
              </span>
            </button>
          ))}
          {!tiles.length && (
            <div className="col-span-full p-6 text-center text-sm text-foreground-500">
              {ARABIC ? 'لا منتجات — أضفها من المخزون' : 'No products — add them in Inventory'}
            </div>
          )}
        </div>
      </div>

      {/* Right: bill */}
      <Card shadow="sm" dir={ARABIC ? 'rtl' : 'ltr'} className="w-full lg:sticky lg:top-4 lg:w-[400px] lg:shrink-0">
        <CardHeader className="flex items-center gap-2 px-4 pb-0 pt-4 text-base font-bold">
          <ReceiptText size={18} className="text-primary" />
          {ARABIC ? 'الفاتورة' : 'Bill'}
        </CardHeader>
        <CardBody className="px-4 pb-4 pt-3">
          <div className="flex max-h-[42vh] flex-col gap-1 overflow-auto">
            {!cart.length && (
              <div className="py-6 text-center text-sm text-foreground-500">
                {ARABIC ? 'اضغط أو امسح منتجاً للبدء' : 'Tap or scan a product to start'}
              </div>
            )}
            {cart.map((l) => (
              <div key={l.id} className="flex items-center gap-2 border-b border-divider py-2">
                <button onClick={() => setEditLine(l)} className="min-w-0 flex-1 text-start">
                  <div className="truncate text-sm font-semibold">
                    {l.name} <Pencil size={12} className="ms-0.5 inline text-foreground-500" />
                  </div>
                  <div className="tnum text-sm font-medium text-foreground-500">
                    {money(l.price)} × {l.qty} = {money(l.price * l.qty)}
                  </div>
                </button>
                <button onClick={() => setQty(l.id, l.qty - 1)} className={QTY_BTN} aria-label="−"><Minus size={18} /></button>
                <span className="tnum min-w-7 text-center text-lg font-bold">{l.qty}</span>
                <button onClick={() => setQty(l.id, l.qty + 1)} className={QTY_BTN} aria-label="+"><Plus size={18} /></button>
                <button onClick={() => removeLine(l.id)} className={`${QTY_BTN} text-danger`} aria-label="×"><X size={18} /></button>
              </div>
            ))}
          </div>

          <div className="my-4 flex items-baseline justify-between">
            <span className="text-lg font-semibold text-foreground-500">{ARABIC ? 'المجموع' : 'Total'}</span>
            <span className="tnum text-4xl font-bold leading-none tracking-tight">{money(total)}</span>
          </div>

          <div className="mb-3 flex gap-2">
            {['cash', 'card'].map((m) => (
              <Button key={m} size="lg" className="flex-1 text-lg font-semibold"
                color={pay === m ? 'primary' : 'default'}
                variant={pay === m ? 'solid' : 'bordered'}
                startContent={m === 'cash' ? <Banknote size={20} /> : <CreditCard size={20} />}
                onPress={() => setPay(m)}>
                {m === 'cash' ? (ARABIC ? 'نقدي' : 'Cash') : (ARABIC ? 'بطاقة' : 'Card')}
              </Button>
            ))}
          </div>

          {pay === 'cash' && (
            <div className="mb-3">
              <Input size="lg" variant="bordered" type="number" value={tendered} onValueChange={setTendered}
                placeholder={ARABIC ? 'المبلغ المدفوع' : 'Cash given'}
                classNames={{ input: 'tnum text-lg' }} />
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Button variant="bordered" className="font-semibold" onPress={() => setTendered(String(total.toFixed(3)))}>
                  {ARABIC ? 'بالضبط' : 'Exact'}
                </Button>
                {[1, 5, 10, 20, 50].map((d) => (
                  <Button key={d} variant="bordered" className="tnum font-semibold" onPress={() => setTendered(String(d))}>
                    {d}
                  </Button>
                ))}
              </div>
              {change != null && change >= 0 && (
                <div className="tnum mt-2 text-lg font-bold text-success">{ARABIC ? 'الباقي' : 'Change'}: {money(change)}</div>
              )}
              {change != null && change < 0 && (
                <div className="tnum mt-2 font-semibold text-danger">{ARABIC ? 'ناقص' : 'Short'}: {money(-change)}</div>
              )}
            </div>
          )}

          <Button color="primary" size="lg" fullWidth className="text-xl font-bold"
            isDisabled={!cart.length || busy} isLoading={busy}
            startContent={!busy && <Check size={22} />} onPress={checkout}>
            {ARABIC ? 'إتمام وطباعة' : 'Pay & Print'}
          </Button>
          {!!cart.length && (
            <div className="mt-2 flex gap-2">
              <Button variant="bordered" className="flex-1" startContent={<Pause size={16} />} onPress={holdSale}>
                {ARABIC ? 'تعليق' : 'Hold'}
              </Button>
              <Button variant="bordered" color="danger" className="flex-1" startContent={<X size={16} />}
                onPress={() => { setCart([]); setTendered(''); }}>
                {ARABIC ? 'إلغاء' : 'Clear'}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {newProduct && (
        <ProductModal initial={newProduct} notify={notify}
          onClose={() => { setNewProduct(null); scanRef.current && scanRef.current.focus(); }}
          onSaved={(p) => { setProducts((prev) => [...prev, p]); addToCart(p); setNewProduct(null); scanRef.current && scanRef.current.focus(); }} />
      )}

      {showHeld && (
        <Modal isOpen onClose={() => setShowHeld(false)} size="sm">
          <ModalContent dir={ARABIC ? 'rtl' : 'ltr'}>
            <ModalHeader className="flex items-center gap-2 text-base font-bold">
              <Pause size={18} className="text-primary" />
              {ARABIC ? 'الفواتير المعلّقة' : 'Held sales'}
            </ModalHeader>
            <ModalBody className="gap-1 pb-5">
              {!held.length && <div className="text-sm text-foreground-500">{ARABIC ? 'لا شيء' : 'None'}</div>}
              {held.map((h) => (
                <div key={h.id} className="flex items-center gap-2 border-b border-divider py-2">
                  <div className="tnum min-w-0 flex-1 font-bold">
                    {money(h.total)}{' '}
                    <span className="text-xs font-medium text-foreground-500">· {h.items.length} {ARABIC ? 'صنف' : 'items'} · {h.ts}</span>
                  </div>
                  <Button size="sm" color="primary" onPress={() => resumeSale(h)}>{ARABIC ? 'استئناف' : 'Resume'}</Button>
                  <Button size="sm" isIconOnly variant="light" color="danger" aria-label="×"
                    onPress={() => persistHeld(held.filter((x) => x.id !== h.id))}>
                    <X size={16} />
                  </Button>
                </div>
              ))}
            </ModalBody>
          </ModalContent>
        </Modal>
      )}

      {editLine && (
        <LineEditModal line={editLine}
          onClose={() => setEditLine(null)}
          onApply={(qty, price) => { if (qty <= 0) removeLine(editLine.id); else setLine(editLine.id, { qty, price }); setEditLine(null); }}
          onRemove={() => { removeLine(editLine.id); setEditLine(null); }} />
      )}
      {quickItem && (
        <QuickItemModal notify={notify} onClose={() => setQuickItem(false)}
          onAdd={(it) => { addCustom(it); setQuickItem(false); }} />
      )}
      {weighItem && (
        <WeightModal product={weighItem} notify={notify}
          onClose={() => { setWeighItem(null); refocus(); }}
          onAdd={(kg) => { addToCart(weighItem, kg); setWeighItem(null); refocus(); }} />
      )}
    </div>
  );
}

// ── Weighed item: enter weight in kg on a keypad; line qty = weight, price = per-kg ──
function WeightModal({ product, onClose, onAdd, notify }) {
  const [kg, setKg] = useState('');
  const onKey = (ch) => setKg((v) => (ch === '.' && v.includes('.') ? v : v + ch));
  const w = Number(kg) || 0;
  const submit = () => { if (!(w > 0)) { notify(ARABIC ? 'أدخل الوزن' : 'Enter weight', 'red'); return; } onAdd(w); };
  return (
    <Modal isOpen onClose={onClose} size="xs">
      <ModalContent dir={ARABIC ? 'rtl' : 'ltr'}>
        <ModalHeader className="flex items-center gap-2 text-base font-bold">
          <Scale size={18} className="text-primary" />
          {product.name}
        </ModalHeader>
        <ModalBody className="gap-3">
          <div className="tnum text-sm text-foreground-500">{money(product.price)}{ARABIC ? ' / كغ' : ' / kg'}</div>
          <div className="tnum rounded-medium bg-content2 p-3 text-center text-3xl font-bold">
            {kg || '0'} {ARABIC ? 'كغ' : 'kg'}
          </div>
          <div className="tnum text-center text-xl font-bold">= {money(w * (Number(product.price) || 0))}</div>
          <NumPad onKey={onKey} onClear={() => setKg('')} onBackspace={() => setKg((v) => v.slice(0, -1))} />
        </ModalBody>
        <ModalFooter>
          <Button color="primary" size="lg" fullWidth onPress={submit}>{ARABIC ? 'إضافة للفاتورة' : 'Add to bill'}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ── Edit a cart line: set quantity + override price via keypad ───────────────────
function LineEditModal({ line, onClose, onApply, onRemove }) {
  const [field, setField] = useState('qty');
  const [qty, setQty] = useState(String(line.qty));
  const [price, setPrice] = useState(String(line.price));
  const set = field === 'qty' ? setQty : setPrice;
  const onKey = (ch) => set((v) => (ch === '.' && v.includes('.') ? v : (v === '0' && ch !== '.' ? ch : v + ch)));
  // Keypad-adjacent field tabs: plain buttons, same rationale as NumPad keys.
  const tab = (name, label, val) => (
    <button key={name} type="button" onClick={() => setField(name)}
      className={`flex-1 rounded-medium border p-3 transition-colors ${
        field === name
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-divider bg-content2 text-foreground hover:bg-content3'
      }`}>
      <div className="text-xs font-semibold">{label}</div>
      <div className="tnum text-lg font-bold">{val || '0'}</div>
    </button>
  );
  return (
    <Modal isOpen onClose={onClose} size="xs">
      <ModalContent dir={ARABIC ? 'rtl' : 'ltr'}>
        <ModalHeader className="text-base font-bold">{line.name}</ModalHeader>
        <ModalBody className="gap-3">
          <div className="flex gap-2">
            {tab('qty', ARABIC ? 'الكمية' : 'Qty', qty)}
            {tab('price', ARABIC ? 'السعر' : 'Price', price)}
          </div>
          <NumPad onKey={onKey} onClear={() => set('')} onBackspace={() => set((v) => v.slice(0, -1))} />
        </ModalBody>
        <ModalFooter className="gap-2">
          <Button color="primary" size="lg" className="flex-1 text-lg"
            onPress={() => onApply(Number(qty) || 0, Number(price) || 0)}>
            {ARABIC ? 'حفظ' : 'Save'}
          </Button>
          <Button color="danger" variant="bordered" size="lg" onPress={onRemove}>
            {ARABIC ? 'حذف' : 'Remove'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ── Open-price "misc" item: type a name + price for something with no barcode ────
function QuickItemModal({ onClose, onAdd, notify }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const onKey = (ch) => setPrice((v) => (ch === '.' && v.includes('.') ? v : v + ch));
  const submit = () => {
    if (!name.trim()) { notify(ARABIC ? 'الاسم مطلوب' : 'Name required', 'red'); return; }
    if (!(Number(price) > 0)) { notify(ARABIC ? 'السعر مطلوب' : 'Price required', 'red'); return; }
    onAdd({ name: name.trim(), price: Number(price), qty: 1 });
  };
  return (
    <Modal isOpen onClose={onClose} size="xs">
      <ModalContent dir={ARABIC ? 'rtl' : 'ltr'}>
        <ModalHeader className="text-base font-bold">{ARABIC ? 'صنف يدوي' : 'Quick item'}</ModalHeader>
        <ModalBody className="gap-3">
          <Input autoFocus variant="bordered" value={name} onValueChange={setName}
            placeholder={ARABIC ? 'الاسم' : 'Name'} />
          <div className="tnum rounded-medium bg-content2 p-3 text-center text-xl font-bold">{price || '0'}</div>
          <NumPad onKey={onKey} onClear={() => setPrice('')} onBackspace={() => setPrice((v) => v.slice(0, -1))} />
        </ModalBody>
        <ModalFooter>
          <Button color="primary" size="lg" fullWidth onPress={submit}>{ARABIC ? 'إضافة للفاتورة' : 'Add to bill'}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

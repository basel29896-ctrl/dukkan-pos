// ──────────────────────────────────────────────────────────────────────────
// CLIENT CONFIG — single source of truth for everything client-specific.
//
// This is the Dukkan grocery build: a single-store, barcode-driven POS. There are no
// floors/recipes/tables — the app is a catalogue + scan-to-cart sales screen. The store
// id is fixed to "main" (mirrors server/floors.js), used as the orders_main table and the
// invoice-numbering key.
// ──────────────────────────────────────────────────────────────────────────

export const CLIENT = {
  storeName: "Dukkan",
  currency: "JOD",
  locale: { default: "ar", arabic: true },
  // Single store. taxPct 0 → tax-free receipts.
  store: { key: "main", taxPct: 0 },
  bill: {
    footerThanks: "Thank you for shopping with us!",
    footerThanksAr: "شكراً لتسوقكم معنا",
    invoicePrefix: "",
    // Seller identity printed on the receipt header. taxNo optional (tax-free).
    seller: { name: "Dukkan", location: "", taxNo: "" },
  },
};

// ── Derived constants (consumed by App.jsx) ───────────────────────────────────
export const STORE_NAME = CLIENT.storeName;
export const CURRENCY = CLIENT.currency;
// Language: a saved runtime preference (in-app toggle, reload to apply) wins over the
// config default. VIEW_LABELS below derives from this, so it must be resolved first.
export const ARABIC = (() => {
  try {
    const saved = localStorage.getItem('dukkan_lang');
    if (saved) return saved === 'ar';
  } catch (_) {}
  return !!CLIENT.locale.arabic;
})();
export const DEFAULT_FLOOR = CLIENT.store.key;       // "main" — the orders table + invoice key
export const TAX_RATE = (CLIENT.store.taxPct || 0) / 100;
export const BILL = CLIENT.bill;
export const SELLER = CLIENT.bill.seller;

// Nav views available in this build. `reports` is server-enforced (allowed_views).
export const VIEWS = ["sales", "inventory", "receive", "history", "reports", "settings"];
export const VIEW_LABELS = {
  sales: ARABIC ? "البيع" : "Sales",
  inventory: ARABIC ? "المخزون" : "Inventory",
  receive: ARABIC ? "استلام" : "Receive",
  history: ARABIC ? "السجل" : "History",
  reports: ARABIC ? "التقارير" : "Reports",
  settings: ARABIC ? "الإعدادات" : "Settings",
};

// Runtime preferences (language + theme). Both are resolved at module load —
// ARABIC drives module-level label tables and THEME drives the pre-paint <html>
// class — so the toggle persists the choice and reloads. The session token also
// lives in localStorage, so staff stay signed in across the swap.
export const THEME = (() => {
  try { return localStorage.getItem('dukkan_theme') === 'dark' ? 'dark' : 'light'; } catch (_) { return 'light'; }
})();

export const setPref = (key, value) => {
  try { localStorage.setItem(key, value); } catch (_) {}
  window.location.reload();
};

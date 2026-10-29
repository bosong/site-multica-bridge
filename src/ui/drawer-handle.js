// Session-only: a page gets a return handle after its drawer has been opened.
export function createDrawerHandle(button) {
  let currentPage = '', seen = false;
  return {sync({mode, allowed, page, open, enabled = true}) {
    if (page !== currentPage) { currentPage = page; seen = false; }
    if (mode === 'sidebar' && open) seen = true;
    button.hidden = !enabled || mode !== 'sidebar' || !allowed || !seen;
    button.dataset.open = String(open);
    button.setAttribute('aria-expanded', String(open));
    button.title = open ? '收起工作台' : '展开工作台';
    button.setAttribute('aria-label', button.title);
  }};
}

// Read only the visible page behind the handle, excluding our own shadow host.
export function drawerBackgroundTheme(document, window, button) {
  const host = button.getRootNode().host;
  const rect = button.getBoundingClientRect();
  const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left - 16));
  const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
  const elements = document.elementsFromPoint(x, y).filter(el => el !== host && !host?.contains(el));
  for (const start of [...elements, document.body, document.documentElement]) {
    for (let el = start; el; el = el.parentElement) {
      const value = window.getComputedStyle(el).backgroundColor;
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      if (!match) continue;
      const parts = match[1].split(/[\s,/]+/).map(Number);
      if (parts.length > 3 && parts[3] < .8) continue;
      const [r,g,b] = parts;
      return .2126*r + .7152*g + .0722*b < 128 ? 'dark' : 'light';
    }
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

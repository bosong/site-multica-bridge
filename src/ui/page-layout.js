// Keep page layout and drawer motion on the same clock. No domain-specific rules.
export const DRAWER_DURATION = 320;
export const DRAWER_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
export function resolveDrawerPresentation(profile, builtins = []) {
  const presentation = profile?.presentation || {};
  const defaults = builtins.find(item => item.id === profile?.id)?.presentation;
  return { ...presentation, drawerPaddingSelectors: presentation.drawerPaddingSelectors ?? defaults?.drawerPaddingSelectors ?? [] };
}
export function createPageLayout({document, window, getPresentation = () => ({}),
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout}) {
  let html = null;
  const properties = ['width', 'transition', '--bugdone-multica-drawer-width', '--bugdone-multica-drawer-duration'];
  let snapshot = null, timer = 0, lastRequest = '';
  const padding = new Map();
  const read = (style, key) => [style.getPropertyValue(key), style.getPropertyPriority(key)];
  const restore = (style, key, [value, priority]) => value ? style.setProperty(key, value, priority) : style.removeProperty(key);
  const usedWidth = () => {
    const width = parseFloat(window.getComputedStyle(html).width);
    return Number.isFinite(width) ? width : html.getBoundingClientRect().width;
  };
  const duration = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : DRAWER_DURATION;
  function updateStyle() {
    const style = document.getElementById('bugdone-multica-page-shift');
    if (!style) return;
    const text = (getPresentation().drawerSelectors || []).map(selector =>
      `html[data-bugdone-multica-drawer-open="true"] ${selector}{right:var(--bugdone-multica-drawer-width)!important;max-width:calc(100vw - var(--bugdone-multica-drawer-width))!important;transition:right var(--bugdone-multica-drawer-duration,320ms) ${DRAWER_EASING},max-width var(--bugdone-multica-drawer-duration,320ms) ${DRAWER_EASING}!important}`).join('\n');
    if (style.textContent !== text) style.textContent = text;
  }
  function restorePadding() {
    for (const [element, original] of padding) restore(element.style, 'padding-left', original);
    padding.clear();
  }
  function finish() {
    if (!snapshot) return;
    // Restore compensation only after page width finishes growing back.
    html.style.setProperty('transition', 'none', 'important');
    restore(html.style, 'width', snapshot.styles.width);
    restorePadding();
    if (snapshot.marker === undefined) delete html.dataset.bugdoneMulticaDrawerOpen;
    else html.dataset.bugdoneMulticaDrawerOpen = snapshot.marker;
    for (const key of properties.filter(key => key !== 'width' && key !== 'transition')) restore(html.style, key, snapshot.styles[key]);
    html.getBoundingClientRect();
    restore(html.style, 'transition', snapshot.styles.transition);
    snapshot = null; lastRequest = '';
  }
  function sync(open, mode = 'sidebar') {
    html ||= document.documentElement;
    if (!html) return;
    const shift = open && mode === 'sidebar' && window.innerWidth > 760 ? Math.min(520, window.innerWidth - 320) : 0;
    const selectors = getPresentation().drawerPaddingSelectors || [];
    const targets = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))];
    const request = JSON.stringify([!!shift, shift, window.innerWidth, selectors, duration()]);
    updateStyle();
    if (request === lastRequest && targets.length === padding.size && targets.every(target => padding.has(target))) return;
    if (!shift && !snapshot) return;
    clearTimeout(timer); lastRequest = request;
    const currentWidth = usedWidth();
    if (!snapshot) snapshot = {styles: Object.fromEntries(properties.map(key => [key, read(html.style, key)])), marker: html.dataset.bugdoneMulticaDrawerOpen};
    // Measure the site's natural width at the current viewport without painting an
    // intermediate frame. This also handles resize and an interrupted close.
    html.style.setProperty('transition', 'none', 'important');
    restore(html.style, 'width', snapshot.styles.width);
    restorePadding();
    const naturalWidth = usedWidth();
    const boxExtra = html.getBoundingClientRect().width - naturalWidth;
    const targetWidth = shift ? Math.max(0, Math.min(naturalWidth, (html.clientWidth || window.innerWidth) - shift - boxExtra)) : naturalWidth;
    // Keep normal compensation frozen during both opening and closing.
    for (const target of targets) {
      const original = read(target.style, 'padding-left');
      const normalPadding = window.getComputedStyle(target).paddingLeft;
      padding.set(target, original);
      target.style.setProperty('padding-left', normalPadding, 'important');
    }
    html.style.setProperty('width', `${currentWidth}px`, 'important');
    html.getBoundingClientRect();
    const ms = duration();
    const originalTransition = snapshot.styles.transition[0];
    html.style.setProperty('transition', `${originalTransition && originalTransition !== 'none' ? originalTransition + ', ' : ''}width ${ms}ms ${DRAWER_EASING}`, 'important');
    html.dataset.bugdoneMulticaDrawerOpen = 'true';
    html.style.setProperty('--bugdone-multica-drawer-duration', `${ms}ms`);
    html.style.setProperty('--bugdone-multica-drawer-width', `${shift}px`);
    html.style.setProperty('width', `${targetWidth}px`, 'important');
    if (!shift) {
      if (ms) timer = setTimeout(finish, ms + 20);
      else finish();
    }
  }
  return {sync, updateStyle, duration};
}



export function installRouteHooks(page, changed) {
    const restores = [];
    const notify = () => { try { changed(); } catch (_) { /* 监听失败不能阻断源站路由 */ } };
    for (const method of ['pushState', 'replaceState']) {
      const original = page.history?.[method];
      if (typeof original !== 'function') continue;
      const wrapped = function(...args) {
        const before = page.location.href;
        const result = original.apply(this, args);
        if (page.location.href !== before) notify();
        return result;
      };
      page.history[method] = wrapped;
      restores.push(() => { if (page.history[method] === wrapped) page.history[method] = original; });
    }
    page.addEventListener('popstate', notify);
    page.addEventListener('hashchange', notify);
    return () => {
      restores.reverse().forEach(restore => restore());
      page.removeEventListener('popstate', notify);
      page.removeEventListener('hashchange', notify);
    };
  }

export function installCaptureHooks(page, collectResponse, matches) {
    let stopped=false; const restores=[];
    const requests = new WeakMap();
    const absoluteURL=value=>{try{return new URL(String(value),page.location?.href).href;}catch{return String(value);}};
    const selectRequest = (body, rule) => {
      if (!rule?.requestKeys?.length || typeof body !== 'string' || body.length > 100_000) return {};
      let parsed;
      try { parsed = JSON.parse(body); } catch { return {}; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(rule.requestKeys.filter(key => Object.hasOwn(parsed, key) &&
        ['string', 'number'].includes(typeof parsed[key])).map(key => [key, parsed[key]]));
    };
    const deliver = (value, rule, request, sourceUrl) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      if (stopped || typeof text !== 'string' || new TextEncoder().encode(text).byteLength > (rule?.maxResponseBytes || 4_000_000)) return;
      collectResponse(value, { ruleId: rule?.id || '', request, sourceUrl });
    };
    const prototype = page.XMLHttpRequest?.prototype;
    if (prototype) {
      const originalOpen = prototype.open, originalSend = prototype.send;
      prototype.open = function(method, url, ...args) {
        requests.set(this, { method: String(method).toUpperCase(), url: String(url) });
        return originalOpen.call(this, method, url, ...args);
      };
      prototype.send = function(...args) {
        const request = requests.get(this);
        const rule = !stopped && request && matches(absoluteURL(request.url), request.method);
        const selected = selectRequest(args[0], rule);
        const sourceUrl = page.location?.href || '';
        if (rule) this.addEventListener('load', function() {
          if (this.status !== 200) return;
          try { deliver(this.responseType === 'json' ? this.response : this.responseText, rule, selected, sourceUrl); }
          catch (_) { /* 捕获失败不影响源站请求 */ }
        }, { once: true });
        return originalSend.apply(this, args);
      };
      const wrappedOpen=prototype.open, wrappedSend=prototype.send;
      restores.push(()=>{if(prototype.open===wrappedOpen) prototype.open=originalOpen; if(prototype.send===wrappedSend) prototype.send=originalSend;});
    }
    if (typeof page.fetch === 'function') {
      const originalFetch = page.fetch;
      page.fetch = function(...args) {
        const result = originalFetch.apply(this, args);
        const input = args[0];
        const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
        const method = String(args[1]?.method || input?.method || 'GET').toUpperCase();
        const rule = !stopped && matches(absoluteURL(url), method), selected = selectRequest(args[1]?.body, rule);
        const sourceUrl = page.location?.href || '';
        if (rule) Promise.resolve(result).then(async response => {
          if (response.ok) deliver(await response.clone().text(), rule, selected, sourceUrl);
        }).catch(() => {});
        return result;
      };
      const wrappedFetch=page.fetch;
      restores.push(()=>{if(page.fetch===wrappedFetch) page.fetch=originalFetch;});
    }
    return { xhr: !!prototype, fetch: typeof page.fetch === 'function', stop() { stopped=true; restores.reverse().forEach(restore=>restore()); } };
  }

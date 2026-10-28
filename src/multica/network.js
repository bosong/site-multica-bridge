import { connectionCacheTag } from './config.js';
export function createNetwork({debug=()=>{},setConnectionPhase=()=>{},window=globalThis.window,fetch=globalThis.fetch,AbortController=globalThis.AbortController,location=globalThis.location,GM_xmlhttpRequest=globalThis.GM_xmlhttpRequest}={}) {
async function bugDoneForm(params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/Service/Bugdone/BugAPI.ashx', {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams(params).toString(), signal: controller.signal
      });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      try { return await response.json(); } catch { throw Error('响应不是有效 JSON，请检查 BugDone 登录状态'); }
    } catch (error) {
      if (error.name === 'AbortError') throw Error('BugDone 请求超时，状态可能已改变，请刷新确认');
      throw error;
    } finally { clearTimeout(timer); }
  }
function request(c) {
    return (method, path, body) => new Promise((resolve, reject) => {
      let done = false, handle;
      const tag = connectionCacheTag(c.api, c.token);
      const finish = (fn, x) => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (fn === reject || x?.status === 401) setConnectionPhase('error', tag);
        fn(x);
      };
      const timer = setTimeout(() => { finish(reject, Error('请求超时；提交结果可能未知，请勿盲目重复创建')); handle?.abort(); }, 30000);
      const headers = { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' };
      if (c.workspace) headers['X-Workspace-ID'] = c.workspace;
      try {
        if (typeof GM_xmlhttpRequest === 'function') {
          handle = GM_xmlhttpRequest({ method, url: c.api + path, anonymous: true, redirect: 'error', headers,
            data: body ? JSON.stringify(body) : undefined,
            onload: r => {
              let data; try { data = JSON.parse(r.responseText); } catch { data = null; }
              if (r.finalUrl && new URL(r.finalUrl).origin !== c.api) return finish(reject, Error('API 发生跨域跳转，已停止'));
              finish(resolve, { status: r.status, data });
            }, onerror: () => finish(reject, Error('网络失败：检查 API 地址、油猴 @connect 权限和浏览器网络设置')),
            onabort: () => finish(reject, Error('请求已中止'))
          });
        } else if (typeof window.FastlaneNativeNetwork?.request === 'function') {
          const options = { method, url: c.api + path, headers, timeoutMs: 30000, responseType: 'text' };
          if (body) options.body = JSON.stringify(body);
          window.FastlaneNativeNetwork.request(options).then(response => {
            if (response.url && new URL(response.url).origin !== c.api) throw Error('API 发生跨域跳转，已停止');
            let data; try { data = JSON.parse(response.body); } catch { data = null; }
            finish(resolve, { status: response.status, data });
          }).catch(error => finish(reject, Error(`原生网络桥请求失败：${error.message || String(error)}`)));
          debug('Multica API 使用 Fastlane 原生网络桥');
        } else if (typeof fetch === 'function' && typeof AbortController === 'function') {
          const controller = new AbortController(); handle = { abort: () => controller.abort() };
          fetch(c.api + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: controller.signal })
            .then(response => {
              if (response.url && new URL(response.url).origin !== c.api) throw Error('API 发生跨域跳转，已停止');
              return response.text().then(text => { let data; try { data = JSON.parse(text); } catch { data = null; } return { status: response.status, data }; });
            })
            .then(result => finish(resolve, result))
            .catch(error => {
              if (error.name === 'AbortError') return finish(reject, Error('请求已中止'));
              const detail = error.message === 'Load failed' || error.message === 'Failed to fetch'
                ? `WebView 跨域请求被拒绝（通常是 API CORS、TLS 证书或网络策略）。请更新带原生网络桥的 Mac App，或让 API 允许来源 ${location.origin} 及 Authorization、X-Workspace-ID、Content-Type 请求头。`
                : (error.message || '请检查 API 地址和网络连接');
              finish(reject, Error(`WebView API 请求失败：${detail}`));
            });
          debug('Multica API 使用 WebView fetch 兼容通道');
        } else throw Error('当前 WebView 没有 GM_xmlhttpRequest、FastlaneNativeNetwork 或 fetch/AbortController，无法访问 Multica API');
      } catch (e) { finish(reject, e); }
    });
  }
function gmCall(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ ...options, anonymous: true, redirect: 'error', timeout: 60000,
        onload: resolve, onerror: () => reject(Error('网络请求失败')),
        ontimeout: () => reject(Error('网络请求超时')),
        onabort: () => reject(Error('网络请求已中止')) });
    });
  }
return {bugDoneForm,request,gmCall};
}

export function createStorage({debug=()=>{},window=globalThis.window,GM_getValue=globalThis.GM_getValue,GM_setValue=globalThis.GM_setValue}={}) {
  // 油猴脚本存储跨站共享；Mac App 没有 GM_* 时安全回退到网页存储。
  const hasGMStorage = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const hasNativeStorage = typeof window.FastlaneNativeStorage?.getValue === 'function' &&
    typeof window.FastlaneNativeStorage?.setValue === 'function';
  const nativeStorageNamespace = 'local.site.multica'; // 与 @namespace 保持一致。
  // Keep persisted keys and business identities stable across the project rename.
  const storagePrefix = 'bugdone-multica:';
  let storageMode = '网页本地存储';
  let storageFailed = false;
  const memoryStore = new Map();
  function readValue(key, fallback) {
    const storageKey = storagePrefix + key;
    if (hasGMStorage) {
      try { const value = GM_getValue(storageKey, undefined); if (value !== undefined) { storageMode = '油猴脚本存储'; return value; } }
      catch (e) { debug('油猴存储读取失败，尝试网页存储', { errorType: e.name }, 'warn'); }
    }
    if (hasNativeStorage) {
      for (const namespace of [nativeStorageNamespace, 'local.bugdone.multica']) {
        try {
          const value = window.FastlaneNativeStorage.getValue(namespace, storageKey, undefined);
          if (value !== undefined) {
            if (namespace !== nativeStorageNamespace) {
              try { window.FastlaneNativeStorage.setValue(nativeStorageNamespace, storageKey, value); }
              catch (e) { debug('旧原生存储迁移未完成', { errorType:e.name }, 'warn'); }
            }
            storageMode = 'Fastlane 原生脚本存储'; return value;
          }
        } catch (e) { debug('原生脚本存储读取失败，尝试回退', { errorType: e.name }, 'warn'); }
      }
    }
    try { const raw = window.localStorage.getItem(storageKey); if (raw !== null) {
      const value = JSON.parse(raw);
      if (hasGMStorage) try { GM_setValue(storageKey, value); storageMode = '油猴脚本存储'; } catch (_) { /* 旧本地值仍可用 */ }
      else if (hasNativeStorage) try { window.FastlaneNativeStorage.setValue(nativeStorageNamespace, storageKey, value); storageMode = 'Fastlane 原生脚本存储'; } catch (_) { /* 旧本地值仍可用 */ }
      return value;
    } } catch (e) { debug('localStorage 不可用，尝试 sessionStorage', { errorType: e.name }, 'warn'); }
    try { const raw = window.sessionStorage.getItem(storageKey); if (raw !== null) { storageMode = '网页会话存储'; return JSON.parse(raw); } } catch (e) { debug('sessionStorage 不可用，使用内存缓存', { errorType: e.name }, 'warn'); }
    return memoryStore.has(key) ? memoryStore.get(key) : fallback;
  }
  function writeValue(key, value) {
    const storageKey = storagePrefix + key; const serialized = JSON.stringify(value);
    if (hasGMStorage) {
      try { GM_setValue(storageKey, value); storageMode = '油猴脚本存储'; return; }
      catch (e) { debug('油猴存储写入失败，尝试网页存储', { errorType: e.name }, 'warn'); }
    }
    if (hasNativeStorage) {
      try { window.FastlaneNativeStorage.setValue(nativeStorageNamespace, storageKey, value); storageMode = 'Fastlane 原生脚本存储'; return; }
      catch (e) { debug('原生脚本存储写入失败，尝试网页存储', { errorType: e.name }, 'warn'); }
    }
    try { window.localStorage.setItem(storageKey, serialized); storageMode = '网页本地存储'; return; } catch (e) { debug('localStorage 写入失败，尝试 sessionStorage', { errorType: e.name }, 'warn'); }
    try { window.sessionStorage.setItem(storageKey, serialized); storageMode = '网页会话存储'; return; } catch (e) { debug('sessionStorage 写入失败，使用内存缓存', { errorType: e.name }, 'warn'); }
    memoryStore.set(key, value); storageMode = '页面内存缓存';
  }
return {readValue,writeValue,hasGMStorage,hasNativeStorage,get mode(){return storageMode},get failed(){return storageFailed}};
}

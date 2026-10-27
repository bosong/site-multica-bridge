const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../bugdone-multica.user.js'), 'utf8');
const start = source.indexOf('  const hasGMStorage =');
const end = source.indexOf('  let customProfiles = ', start);
assert.ok(start >= 0 && end > start);
const storageCode = source.slice(start, end);

function storageFor(localValues, shared) {
  const local = new Map(Object.entries(localValues));
  const window = { localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) },
    sessionStorage: { getItem: () => null, setItem: () => {} } };
  return new Function('window', 'GM_getValue', 'GM_setValue', 'debug',
    `${storageCode}\nreturn { readValue, writeValue };`)(window,
    (key, fallback) => shared.has(key) ? shared.get(key) : fallback,
    (key, value) => shared.set(key, value), () => {});
}

test('油猴脚本存储跨站点复用设置，并迁移 BugDone 旧本地配置', () => {
  const shared = new Map();
  const legacy = { api: 'https://api.multica.ai', workspace: 'w', token: 'synthetic-token' };
  const bugdone = storageFor({ 'bugdone-multica:config': JSON.stringify(legacy) }, shared);
  assert.deepEqual(bugdone.readValue('config', null), legacy);
  assert.deepEqual(shared.get('bugdone-multica:config'), legacy);
  const umeng = storageFor({}, shared);
  assert.deepEqual(umeng.readValue('config', null), legacy);
  umeng.writeValue('config', { ...legacy, label: 'l' });
  assert.equal(bugdone.readValue('config', null).label, 'l');
});

test('Mac 原生脚本存储在不同站点共享配置并迁移站点旧值', () => {
  const shared = new Map();
  const native = { getValue: (_namespace, key, fallback) => shared.has(key) ? shared.get(key) : fallback,
    setValue: (_namespace, key, value) => shared.set(key, value) };
  const make = local => {
    const localValues = new Map(Object.entries(local));
    const window = { FastlaneNativeStorage: native,
      localStorage: { getItem: key => localValues.get(key) ?? null, setItem: (key, value) => localValues.set(key, value) },
      sessionStorage: { getItem: () => null, setItem: () => {} } };
    return new Function('window', 'GM_getValue', 'GM_setValue', 'debug',
      `${storageCode}\nreturn { readValue, writeValue };`)(window, undefined, undefined, () => {});
  };
  const legacy = { api: 'https://api.multica.ai', token: 'synthetic-token' };
  assert.deepEqual(make({ 'bugdone-multica:config': JSON.stringify(legacy) }).readValue('config', null), legacy);
  assert.deepEqual(shared.get('bugdone-multica:config'), legacy);
  assert.deepEqual(make({}).readValue('config', null), legacy);
});

test('改名后原生读写使用新 namespace；旧网站本地配置可迁入新空间', () => {
  const values=new Map(), namespace='local.site.multica', legacy={api:'https://api.multica.ai',token:'synthetic-token'};
  const native={getValue:(scope,key,fallback)=>scope===namespace && values.has(key)?values.get(key):fallback,
    setValue:(scope,key,value)=>{assert.equal(scope,namespace);values.set(key,value);}};
  const window={FastlaneNativeStorage:native,localStorage:{getItem:key=>key==='bugdone-multica:config'?JSON.stringify(legacy):null,setItem:()=>{}},sessionStorage:{getItem:()=>null,setItem:()=>{}}};
  const storage=new Function('window','debug',`${storageCode}\nreturn {readValue,writeValue};`)(window,()=>{});
  assert.deepEqual(storage.readValue('config',null),legacy);
  assert.deepEqual(values.get('bugdone-multica:config'),legacy);
  storage.writeValue('config',{...legacy,label:'new'});
  assert.equal(values.get('bugdone-multica:config').label,'new');
});

test('桥已暴露旧 namespace 时迁移旧值，已有新值始终优先', () => {
 const legacy={api:'https://api.multica.ai',token:'synthetic-token'},current={...legacy,label:'current'};
 const scopes=new Map([['local.bugdone.multica',new Map([['bugdone-multica:config',legacy]])],['local.site.multica',new Map()]]);
 const native={getValue:(scope,key,fallback)=>scopes.get(scope)?.get(key)??fallback,setValue:(scope,key,value)=>scopes.get(scope).set(key,value)};
 const window={FastlaneNativeStorage:native,localStorage:{getItem:()=>null,setItem:()=>{}},sessionStorage:{getItem:()=>null,setItem:()=>{}}};
 const storage=new Function('window','debug',`${storageCode}\nreturn {readValue};`)(window,()=>{});
 assert.deepEqual(storage.readValue('config',null),legacy);
 assert.deepEqual(scopes.get('local.site.multica').get('bugdone-multica:config'),legacy);
 scopes.get('local.site.multica').set('bugdone-multica:config',current);
 assert.deepEqual(storage.readValue('config',null),current);
});

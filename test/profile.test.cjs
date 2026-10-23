const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../bugdone-multica.user.js'), 'utf8');
const start = source.indexOf('(() => {');
const end = source.indexOf('  // 调试桩：');
const core = new Function('return ' + source.slice(start, end) +
  'return { validateSiteProfile, matchSiteCapture, extractProfileItems, normalizeCapturedRecord, mergeCapturedRecord, collectStandardRecords, recordKey, BUGDONE_PROFILE, isBugAPI, parseResponse, installCaptureHooks };\n})();')();

const profile = {
  schemaVersion: 1, id: 'synthetic-site', version: 1, enabled: true,
  allowedOrigins: ['https://issues.example.test'],
  pages: [{ kind: 'list', path: '/issues' }, { kind: 'detail', path: '/issues/:id' }],
  captures: [{ id: 'issues', method: 'POST', origin: 'https://issues.example.test', path: '/api/issues',
    maxResponseBytes: 10000, success: { path: '$.ok', equals: true },
    variants: [{ kind: 'list', path: '$.data.items', type: 'array' }, { kind: 'detail', path: '$.data.item', type: 'object' }] }],
  record: { scopeId: '$.project', recordId: '$.id', title: '$.title', number: '$.number', descriptionHtml: '$.body' },
  draft: { titleTemplate: '[Issues] #{{number}} {{title}}' },
  dedup: { keyTemplate: 'synthetic-site:{{scopeId}}:{{recordId}}' },
  attachments: [], postActions: []
};

test('配置校验拒绝跨源监听、未知字段与可执行路径', () => {
  assert.equal(core.validateSiteProfile(profile).id, 'synthetic-site');
  assert.throws(() => core.validateSiteProfile({ ...profile, captures: [{ ...profile.captures[0], origin: 'https://other.example.test' }] }), /允许的站点/);
  assert.throws(() => core.validateSiteProfile({ ...profile, token: 'secret' }), /不支持的配置字段/);
  assert.throws(() => core.validateSiteProfile({ ...profile, record: { ...profile.record, title: '$.constructor()' } }), /字段路径/);
});

test('接口匹配必须同时满足站点、方法、精确路径和响应大小', () => {
  const info = { url: 'https://issues.example.test/api/issues?time=1', method: 'POST', bytes: 500, contentType: 'application/json' };
  assert.equal(core.matchSiteCapture(profile, info)?.id, 'issues');
  assert.equal(core.matchSiteCapture(profile, { ...info, method: 'GET' }), null);
  assert.equal(core.matchSiteCapture(profile, { ...info, url: 'https://issues.example.test/api/issues-extra' }), null);
  assert.equal(core.matchSiteCapture(profile, { ...info, url: 'https://other.example.test/api/issues' }), null);
  assert.equal(core.matchSiteCapture(profile, { ...info, bytes: 10001 }), null);
});

test('声明式变体区分列表与详情，错误响应不产出记录', () => {
  const rule = profile.captures[0];
  const list = core.extractProfileItems(rule, { ok: true, data: { items: [{ project: 'p', id: '1', title: 'a' }] } });
  assert.deepEqual(list, [{ kind: 'list', item: { project: 'p', id: '1', title: 'a' } }]);
  assert.deepEqual(core.extractProfileItems(rule, { ok: true, data: { item: { project: 'p', id: '1', title: 'a' } } }),
    [{ kind: 'detail', item: { project: 'p', id: '1', title: 'a' } }]);
  assert.deepEqual(core.extractProfileItems(rule, { ok: false, data: { item: { id: '1' } } }), []);
});

test('标准记录以站点、范围、记录 ID 隔离，并拒绝不完整身份', () => {
  const raw = { project: 'app-A', id: '42', title: 'Crash', number: 7, body: '<p>steps</p>' };
  const record = core.normalizeCapturedRecord(profile, raw, { kind: 'detail', sourceUrl: 'https://issues.example.test/issues/42', capturedAt: '2026-10-23T10:00:00Z' });
  assert.deepEqual({ siteId: record.siteId, scopeId: record.scopeId, recordId: record.recordId, title: record.title, number: record.number, detail: record.detail },
    { siteId: 'synthetic-site', scopeId: 'app-A', recordId: '42', title: 'Crash', number: 7, detail: true });
  assert.notEqual(core.recordKey(record), core.recordKey({ ...record, scopeId: 'app-B' }));
  assert.equal(core.normalizeCapturedRecord(profile, { ...raw, id: '' }, { kind: 'detail' }), null);
});

test('迟到的列表摘要不能抹掉已捕获的详情与日志', () => {
  const base = { siteId: 'synthetic-site', scopeId: 'app-A', recordId: '42', title: 'Crash', detail: true,
    descriptionHtml: '<p>详细信息</p>', logs: [{ kind: 'stack', text: 'stack' }], attachments: [{ id: 'a' }], capturedAt: '2026-10-23T10:00:00Z' };
  const lateList = { ...base, detail: false, descriptionHtml: '', logs: [], attachments: [], capturedAt: '2026-10-23T10:01:00Z' };
  assert.equal(core.mergeCapturedRecord(base, lateList).descriptionHtml, '<p>详细信息</p>');
  assert.equal(core.mergeCapturedRecord(base, lateList).logs.length, 1);
  assert.throws(() => core.mergeCapturedRecord(base, { ...lateList, recordId: 'other' }), /不同来源/);
});

test('同一记录跨应用隔离，列表与详情仅按完整来源键归并', () => {
  const store = new Map();
  const item = { project: 'app-A', id: '42', title: 'Crash', body: '' };
  core.collectStandardRecords(profile, [{ kind: 'list', item }, { kind: 'detail', item: { ...item, body: '详细信息' } }], store, 'https://issues.example.test/issues/42');
  core.collectStandardRecords(profile, [{ kind: 'detail', item: { ...item, project: 'app-B', body: '另一个应用' } }], store, 'https://issues.example.test/issues/42');
  assert.equal(store.size, 2);
  assert.deepEqual([...store.values()].map(x => x.descriptionHtml).sort(), ['另一个应用', '详细信息']);
});

test('BugDone 内置配置只捕获 POST BugAPI，继续解析旧响应', () => {
  assert.equal(core.validateSiteProfile(core.BUGDONE_PROFILE).id, 'bugdone');
  const url = 'https://www.bugdone.cn/Service/Bugdone/BugAPI.ashx?time=1';
  assert.equal(core.isBugAPI(url, 'POST'), true);
  assert.equal(core.isBugAPI(url, 'GET'), false);
  const raw = { Result: 1, ReturnObj: { ItemList: [{
    BugId: '7603f73c983242c1811852a53b26e2c3', BugCode: 284, BugTitle: '合成 Bug',
    ProjectId: '45b65385f2a443dba353aa93fa2b8cf8' }] } };
  assert.equal(core.parseResponse(raw)[0].BugTitle, '合成 Bug');
});

test('XHR 与 fetch 监听按实际请求方法判断，GET 不误捕获', async () => {
  class FakeXHR extends EventTarget {
    constructor() { super(); this.status = 200; this.responseType = ''; this.responseText = '{"Result":1}'; }
    open(method, url) { this.method = method; this.url = url; }
    send() { this.dispatchEvent(new Event('load')); }
  }
  const collected = [];
  const page = { XMLHttpRequest: FakeXHR, fetch: async () => new Response('{"Result":1}', { status: 200 }) };
  core.installCaptureHooks(page, (text) => collected.push(text), core.isBugAPI);
  const url = '/Service/BugDone/BugAPI.ashx';
  const get = new page.XMLHttpRequest(); get.open('GET', url); get.send();
  const post = new page.XMLHttpRequest(); post.open('POST', url); post.send();
  await page.fetch(url, { method: 'GET' });
  await page.fetch(url, { method: 'POST' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(collected.length, 2);
});

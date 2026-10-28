const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = require('./helpers/source.cjs').source;
const start = source.indexOf('(() => {');
const end = source.indexOf('  // 调试桩：');
const core = require('../.generated/test-core.cjs');

test('GitHub Issues 接口列表与详情按仓库和编号归并，正文保留 Markdown', () => {
  const github = core.validateSiteProfile(core.GITHUB_PROFILE);
  const listUrl = 'https://github.com/example/private-repo/issues?q=is%3Aissue';
  const detailUrl = 'https://github.com/example/private-repo/issues/42';
  assert.equal(core.matchSiteCapture(github, { url: listUrl, method: 'GET' })?.id, 'github-issue-list');
  assert.equal(core.matchSiteCapture(github, { url: detailUrl, method: 'GET' })?.id, 'github-issue-detail');
  assert.equal(core.matchSiteCapture(github, { url: detailUrl + '/comments', method: 'GET' }), null);
  assert.equal(core.matchSiteCapture(github, { url: detailUrl, method: 'POST' }), null);
  const list = { payload: { issuesIndexContentRoute: { results: [
    { itemType: 'Issue', issue: { number: 42, title: '模拟的登录失败问题',
      repoNameWithOwner: 'example/private-repo', permalink: detailUrl } }
  ] } } };
  const detail = { payload: { issueViewerRoute: { data: { repository: { issue: {
    number: 42, title: '模拟的登录失败问题', repository: { nameWithOwner: 'example/private-repo' },
    body: '复现步骤：\n1. 打开登录页\n2. 输入错误密码', url: detailUrl
  } } } } } };
  const store = new Map();
  assert.equal(core.collectStandardRecords(github, core.extractProfileItems(github.captures[0], list), store, listUrl), 1);
  assert.equal([...store.values()][0].detail, false);
  assert.equal(core.collectStandardRecords(github, core.extractProfileItems(github.captures[1], detail), store, detailUrl), 1);
  assert.equal(store.size, 1);
  const record = [...store.values()][0];
  assert.equal(record.detail, true);
  const draft = core.buildCapturedDraft(record, github);
  assert.match(draft.title, /\[GitHub Issues\] #42/);
  assert.match(draft.description, /复现步骤：\n1\. 打开登录页/);
  assert.match(draft.description, /github.com\/example\/private-repo\/issues\/42/);
  assert.equal(draft.sourceKey, 'github-issues:example%2Fprivate-repo:42');
});

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
  assert.equal(core.validateSiteProfile(core.PROFILE_TEMPLATE).id, 'example-issues');
  assert.equal(core.validateSiteProfile(profile).id, 'synthetic-site');
  assert.throws(() => core.validateSiteProfile({ ...profile, captures: [{ ...profile.captures[0], origin: 'https://other.example.test' }] }), /允许的站点/);
  assert.throws(() => core.validateSiteProfile({ ...profile, token: 'secret' }), /不支持的配置字段/);
  assert.throws(() => core.validateSiteProfile({ ...profile, record: { ...profile.record, title: '$.constructor()' } }), /字段路径/);
  assert.throws(() => core.validateSiteProfile({ ...profile, dedup: { keyTemplate: 'same-for-every-record' } }), /来源键/);
  assert.throws(() => core.validateSiteProfile({ ...profile, draft: { titleTemplate: '{{secret}}' } }), /模板字段/);
});

test('自定义站点可声明受限文本附件，并明确报告超长内容', () => {
  const withAttachment = { ...profile, attachments: [{ id: 'stack', kind: 'text', path: '$.stack',
    filenameTemplate: 'issue-{{recordId}}-stack.txt', maxChars: 100 }] };
  assert.equal(core.validateSiteProfile(withAttachment).attachments.length, 1);
  const raw = { project: 'p', id: '42', number: 7, title: '合成错误', stack: 'at Demo.run (demo.js:1)' };
  const record = core.normalizeCapturedRecord(withAttachment, raw, { kind: 'detail' });
  assert.deepEqual(record.attachments.map(({ name, content, mimeType }) => ({ name, content, mimeType })),
    [{ name: 'issue-42-stack.txt', content: raw.stack, mimeType: 'text/plain' }]);
  assert.equal(core.buildCapturedDraft(record, withAttachment).attachments.length, 1);

  const tooLong = core.normalizeCapturedRecord(withAttachment, { ...raw, stack: 'x'.repeat(101) }, { kind: 'detail' });
  assert.equal(tooLong.attachments.length, 0);
  assert.match(tooLong.attachmentWarnings[0], /stack.*超过/);
  assert.match(core.buildCapturedDraft(tooLong, withAttachment).description, /附件未包含/);

  assert.throws(() => core.validateSiteProfile({ ...profile, attachments: [{ ...withAttachment.attachments[0], kind: 'url' }] }), /附件规则/);
  assert.throws(() => core.validateSiteProfile({ ...profile, attachments: [{ ...withAttachment.attachments[0], path: '$.stack.constructor()' }] }), /附件规则/);
  assert.throws(() => core.validateSiteProfile({ ...profile, attachments: [{ ...withAttachment.attachments[0], filenameTemplate: '{{secret}}.txt' }] }), /附件规则/);
  assert.throws(() => core.validateSiteProfile({ ...profile, attachments: [{ ...withAttachment.attachments[0], maxChars: 2_000_000 }] }), /附件规则/);
});

test('图片附件只接受配置站点的 HTTPS 地址，跨站或 HTTP 地址明确提示', () => {
  const withImage = { ...profile, attachments: [{ id: 'screen', kind: 'image-url', path: '$.screenshot',
    filenameTemplate: 'issue-{{recordId}}.png' }] };
  assert.equal(core.validateSiteProfile(withImage).attachments.length, 1);
  const raw = { project: 'p', id: '42', title: '示例', screenshot: 'https://issues.example.test/files/42.png' };
  const record = core.normalizeCapturedRecord(withImage, raw, { kind: 'detail' });
  assert.deepEqual(record.attachments.map(({ name, url, remoteImage }) => ({ name, url, remoteImage })),
    [{ name: 'issue-42.png', url: raw.screenshot, remoteImage: true }]);
  assert.deepEqual(record.attachments[0].allowedOrigins, ['https://issues.example.test']);
  for (const screenshot of ['http://issues.example.test/files/42.png', 'https://other.example.test/files/42.png']) {
    const rejected = core.normalizeCapturedRecord(withImage, { ...raw, screenshot }, { kind: 'detail' });
    assert.equal(rejected.attachments.length, 0);
    assert.match(rejected.attachmentWarnings[0], /允许的 HTTPS 站点/);
  }
  assert.throws(() => core.validateSiteProfile({ ...profile, attachments: [{ ...withImage.attachments[0], maxChars: 100 }] }), /附件规则/);
});

test('更新配置新增域名、页面或接口监听时列出增量，不能沿用已启用状态', () => {
  assert.deepEqual(core.profileObservationChanges(profile, profile), []);
  const wider = {
    ...profile,
    allowedOrigins: [...profile.allowedOrigins, 'https://other.example.test'],
    pages: [...profile.pages, { kind: 'detail', path: '/secret/:id' }],
    captures: [...profile.captures, { ...profile.captures[0], id: 'secret', origin: 'https://other.example.test', path: '/api/secret' }]
  };
  assert.deepEqual(core.profileObservationChanges(profile, wider), [
    '站点 https://other.example.test', '页面 detail /secret/:id', '接口 POST https://other.example.test/api/secret'
  ]);
  assert.deepEqual(core.profileObservationChanges(null, profile), [
    '站点 https://issues.example.test', '页面 list /issues', '页面 detail /issues/:id',
    '接口 POST https://issues.example.test/api/issues'
  ]);
  assert.deepEqual(core.profileObservationChanges(profile, {
    ...profile, captures: [{ ...profile.captures[0], maxResponseBytes: 20000 }]
  }), ['接口响应上限或字段规则已改变']);
});

test('接口匹配必须同时满足站点、方法、精确路径和响应大小', () => {
  const info = { url: 'https://issues.example.test/api/issues?time=1', method: 'POST', bytes: 500, contentType: 'application/json' };
  assert.equal(core.matchSiteCapture(profile, info)?.id, 'issues');
  assert.equal(core.matchSiteCapture(profile, { ...info, method: 'GET' }), null);
  assert.equal(core.matchSiteCapture(profile, { ...info, url: 'https://issues.example.test/api/issues-extra' }), null);
  assert.equal(core.matchSiteCapture(profile, { ...info, url: 'https://other.example.test/api/issues' }), null);
  assert.equal(core.matchSiteCapture(profile, { ...info, bytes: 10001 }), null);
});

test('用户配置只在声明的 HTTPS 页面路径生效，列表和详情路由分别识别', () => {
  assert.equal(core.matchProfilePage(profile, 'https://issues.example.test/issues')?.kind, 'list');
  assert.equal(core.matchProfilePage(profile, 'https://issues.example.test/issues/42?sort=1')?.kind, 'detail');
  assert.equal(core.matchProfilePage(profile, 'https://issues.example.test/issues/42/extra'), null);
  assert.equal(core.matchProfilePage(profile, 'https://other.example.test/issues/42'), null);
});

test('声明式变体区分列表与详情，错误响应不产出记录', () => {
  const rule = profile.captures[0];
  const list = core.extractProfileItems(rule, { ok: true, data: { items: [{ project: 'p', id: '1', title: 'a' }] } });
  assert.deepEqual(list, [{ kind: 'list', item: { project: 'p', id: '1', title: 'a' } }]);
  assert.deepEqual(core.extractProfileItems(rule, { ok: true, data: { item: { project: 'p', id: '1', title: 'a' } } }),
    [{ kind: 'detail', item: { project: 'p', id: '1', title: 'a' } }]);
  assert.deepEqual(core.extractProfileItems(rule, { ok: false, data: { item: { id: '1' } } }), []);
});

test('导入试运行只报告匹配数量、详情数和缺少身份字段数，不回显原始内容', () => {
  const sample = { ok: true, data: { items: [
    { project: 'p', id: '1', title: 'PRIVATE TITLE', number: 1 },
    { project: 'p', id: '', title: 'PRIVATE TITLE TWO' }
  ] } };
  const result = core.testProfileSample(profile, sample);
  assert.deepEqual(result, { ruleId: 'issues', matched: 2, valid: 1, detail: 0, missingIdentity: 1 });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
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

test('捕获层生成可见来源标记与任务草稿，缺字段不产出脏标题', () => {
  const record = core.normalizeCapturedRecord(profile, { project: 'app-A', id: '42', title: 'Crash', number: 7, body: '' }, { kind: 'detail', sourceUrl: 'https://issues.example.test/issues/42' });
  const draft = core.buildCapturedDraft(record, profile);
  assert.equal(draft.title, '[Issues] #7 Crash');
  assert.equal(draft.sourceKey, 'synthetic-site:app-A:42');
  assert.match(draft.description, /\[Source:synthetic-site:app-A:42\]/);
  assert.match(draft.description, /https:\/\/issues\.example\.test\/issues\/42/);
  assert.equal(core.buildCapturedDraft({ ...record, number: '' }, profile).title, '[Issues] Crash');
});

test('未配置网页只把用户主动选取的文本转为可编辑草稿', () => {
  const draft = core.buildManualDraft({ title: '示例网页', text: '可见的选中内容', url: 'https://example.test/page?x=1' });
  assert.equal(draft.title, '示例网页');
  assert.equal(draft.sourceKey, '');
  assert.equal(draft.fingerprint, core.manualFingerprint('https://example.test/page?x=1', '可见的选中内容'));
  assert.notEqual(draft.fingerprint, core.manualFingerprint('https://example.test/other', '可见的选中内容'));
  assert.match(draft.description, /可见的选中内容/);
  assert.match(draft.description, /https:\/\/example\.test\/page\?x=1/);
  assert.throws(() => core.buildManualDraft({ title: '密码页', text: '', url: 'https://example.test' }), /先在网页选中/);
  assert.throws(() => core.buildManualDraft({ title: '不安全', text: 'text', url: 'javascript:alert(1)' }), /HTTPS/);
});

test('手动选取拒绝工作台自身及包含表单、隐藏元素的范围', () => {
  const textNode = { parentElement: { closest: () => null } };
  const make = blocked => ({ rangeCount: 1, isCollapsed: false, anchorNode: textNode, focusNode: textNode,
    getRangeAt: () => ({ cloneContents: () => ({ querySelector: () => blocked ? {} : null }) }),
    toString: () => '可见文字' });
  assert.equal(core.selectedVisibleText(make(false), { contains: () => false }), '可见文字');
  assert.throws(() => core.selectedVisibleText(make(true), { contains: () => false }), /表单或隐藏/);
  assert.throws(() => core.selectedVisibleText(make(false), { contains: () => true }), /工作台/);
});

test('同一捕获记录更新时保留用户编辑的标题和描述，切换记录后重新生成', () => {
  assert.deepEqual(core.capturePreviewUpdate('site:a:1', 'site:a:1', false, false), { title: false, description: false });
  assert.deepEqual(core.capturePreviewUpdate('site:a:1', 'site:a:1', true, false), { title: true, description: false });
  assert.deepEqual(core.capturePreviewUpdate('site:a:1', 'site:a:2', false, false), { title: true, description: true });
});

test('在已配置站点新建空白任务无需先打开站点详情', () => {
  assert.equal(core.needsCapturedDetail({ siteId: 'manual' }), false);
  assert.equal(core.needsCapturedDetail({ siteId: 'umeng-apm-crash' }), true);
});

test('站点模式只按 HTTPS 主机判定，未知网页进入无网络监听的手动模式', () => {
  assert.equal(core.siteModeForUrl('https://www.bugdone.cn/cn/projects'), 'bugdone');
  assert.equal(core.siteModeForUrl('https://apm.umeng.com/platform/a/error_analysis/crash'), 'umeng');
  assert.equal(core.siteModeForUrl('https://example.test/page'), 'manual');
  assert.equal(core.siteModeForUrl('http://example.test/page'), 'unsupported');
  assert.equal(core.siteModeForUrl('https://www.bugdone.cn.evil.test/'), 'manual');
});

test('通用提交允许编辑标题但必须保留可见来源标记，并在查重后才上传', async () => {
  const sourceKey = 'synthetic-site:app-A:42', mark = '[Source:synthetic-site:app-A:42]';
  const draft = { sourceKey, title: '用户修改的标题', description: `${mark}\n来源：https://issues.example.test/issues/42` };
  const config = { api: 'https://api.multica.ai', workspace: '11111111-1111-4111-8111-111111111111' };
  const calls = [], storage = new Map();
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    if (method === 'GET' && path.startsWith('/api/issues/search')) return { status: 200, data: { issues: [] } };
    return { status: 201, data: { id: 'new-id', title: draft.title, description: draft.description } };
  };
  const result = await core.submitDraftOnce({ c: config, draft, body: { title: draft.title, description: draft.description },
    api, get: (key, fallback) => storage.get(key) ?? fallback, set: (key, value) => storage.set(key, value),
    prepareBody: async body => { calls.push(['UPLOAD']); return { ...body, attachment_ids: ['uploaded-id'] }; } });
  assert.equal(result.existing, false);
  assert.deepEqual(calls.map(x => x[0]), ['GET', 'UPLOAD', 'POST']);
  assert.deepEqual(calls[2][2].attachment_ids, ['uploaded-id']);
  await assert.rejects(core.submitDraftOnce({ c: config, draft, body: { title: '删掉标记', description: '也没有标记' }, api,
    get: () => null, set: () => {} }), /来源标记/);
});

test('通用查重命中现有任务时不上传、不创建', async () => {
  const sourceKey = 'synthetic-site:app-A:42', mark = '[Source:synthetic-site:app-A:42]';
  const draft = { sourceKey, title: 'Crash', description: mark };
  let uploaded = false;
  const result = await core.submitDraftOnce({ c: { api: 'https://api.multica.ai', workspace: 'w' }, draft,
    body: { title: draft.title, description: draft.description }, get: () => null, set: () => {},
    prepareBody: async body => { uploaded = true; return body; },
    api: async (method) => {
      assert.equal(method, 'GET');
      return { status: 200, data: { issues: [{ id: 'old-id', title: '原标题', description: mark }] } };
    } });
  assert.equal(result.existing, true);
  assert.equal(uploaded, false);
});

test('手动草稿没有稳定业务 ID 时只对同一次捕获防重复，不伪称全局查重', async () => {
  const draft = { draftId: 'manual-1', sourceKey: '', title: '手动任务', description: '选中内容' };
  const config = { api: 'https://api.multica.ai', workspace: 'w' };
  const store = new Map(), calls = [];
  const api = async (method, path) => {
    calls.push([method, path]);
    return method === 'POST' ? { status: 201, data: { id: 'issue-1', title: draft.title } }
      : { status: 200, data: { id: 'issue-1', title: draft.title } };
  };
  const params = { c: config, draft, body: { title: draft.title, description: draft.description }, api,
    get: (key, fallback) => store.get(key) ?? fallback, set: (key, value) => store.set(key, value) };
  assert.equal((await core.submitManualOnce(params)).existing, false);
  assert.equal((await core.submitManualOnce(params)).existing, true);
  assert.deepEqual(calls.map(x => x[0]), ['POST', 'GET']);
});

test('BugDone 内置配置只捕获 POST BugAPI，继续解析旧响应', () => {
  assert.equal(core.validateSiteProfile(core.BUGDONE_PROFILE).id, 'bugdone');
  const url = 'https://www.bugdone.cn/Service/Bugdone/BugAPI.ashx?time=1';
  assert.equal(core.isBugAPI(url, 'POST'), true);
  assert.equal(core.isBugAPI(url, 'GET'), false);
  const raw = { Result: 1, ReturnObj: { ItemList: [{
    BugId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', BugCode: 284, BugTitle: '合成 Bug',
    ProjectId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }] } };
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

test('捕获钩子只把配置允许的请求身份字段交给适配器', () => {
  class FakeXHR extends EventTarget {
    constructor() { super(); this.status = 200; this.responseType = ''; this.responseText = '{"code":200}'; }
    open(method, url) { this.method = method; this.url = url; }
    send() { this.dispatchEvent(new Event('load')); }
  }
  const received = [];
  core.installCaptureHooks({ XMLHttpRequest: FakeXHR, location: { href: 'https://apm.umeng.com/platform/aaaaaaaaaaaaaaaaaaaaaaaa/error_analysis/crash/detail/42' } }, (text, meta) => received.push(meta), (url, method) =>
    core.matchSiteCapture({ ...core.UMENG_PROFILE, enabled: true }, { url, method }));
  const xhr = new FakeXHR(); xhr.open('POST', '/hsf/analysis/errorDetail');
  xhr.send(JSON.stringify({ errorId: '42', token: 'do-not-copy' }));
  assert.deepEqual(received[0].request, { errorId: '42' });
  assert.equal(received[0].ruleId, 'umeng-error-detail');
  assert.equal(received[0].sourceUrl, 'https://apm.umeng.com/platform/aaaaaaaaaaaaaaaaaaaaaaaa/error_analysis/crash/detail/42');
});

test('友盟配置使用实测接口，跨错误 ID 的日志和堆栈不串联', () => {
  assert.equal(core.validateSiteProfile(core.UMENG_PROFILE).id, 'umeng-apm-crash');
  const app = 'aaaaaaaaaaaaaaaaaaaaaaaa', a = '12345678901234', b = '99999999999999';
  const state = core.createUmengCaptureState();
  const meta = (ruleId, errorId, extra = {}) => ({ ruleId, request: { dataSourceId: app, errorId, ...extra },
    sourceUrl: `https://apm.umeng.com/platform/${app}/error_analysis/crash/detail/${errorId}` });
  const wrap = data => ({ code: 200, data });
  core.applyUmengCapture(state, wrap({ id: a, summary: 'Synthetic A', appVersion: '1.0' }), meta('umeng-error-detail', a));
  core.applyUmengCapture(state, wrap({ id: b, summary: 'Synthetic B' }), meta('umeng-error-detail', b));
  core.applyUmengCapture(state, wrap({ logId: 'log-a', stackMd5: 'hash-a', pagesBehavior: 'click A' }), meta('umeng-log-detail', a, { logId: 'log-a' }));
  core.applyUmengCapture(state, wrap({ key: 'hash-a', originStack: 'stack A' }), { ruleId: 'umeng-error-stack', request: { key: 'hash-a' }, sourceUrl: meta('', a).sourceUrl });
  const records = [...state.records.values()];
  assert.equal(records.length, 2);
  assert.deepEqual(records.find(x => x.recordId === a).logs.map(x => x.kind), ['behavior', 'stack']);
  assert.equal(records.find(x => x.recordId === a).logDetailCoverage.captured, 1);
  assert.deepEqual(records.find(x => x.recordId === b).logs, []);
  assert.equal(core.applyUmengCapture(state, wrap({ id: b, summary: 'wrong binding' }), meta('umeng-error-detail', a)), null);
});

test('友盟堆栈先到时等待日志键核对，详情迟到后仍归到正确记录', () => {
  const app = 'aaaaaaaaaaaaaaaaaaaaaaaa', errorId = '12345678901234';
  const sourceUrl = `https://apm.umeng.com/platform/${app}/error_analysis/crash/detail/${errorId}`;
  const state = core.createUmengCaptureState();
  const wrap = data => ({ code: 200, data });
  core.applyUmengCapture(state, wrap({ key: 'hash-a', originStack: 'stack A' }), { ruleId: 'umeng-error-stack', request: { key: 'hash-a' }, sourceUrl });
  core.applyUmengCapture(state, wrap({ logId: 'log-a', stackMd5: 'hash-a', pagesBehavior: 'tap A' }), { ruleId: 'umeng-log-detail', request: { dataSourceId: app, errorId, logId: 'log-a' }, sourceUrl });
  core.applyUmengCapture(state, wrap({ id: errorId, summary: 'Synthetic' }), { ruleId: 'umeng-error-detail', request: { dataSourceId: app, errorId }, sourceUrl });
  assert.deepEqual([...state.records.values()][0].logs.map(x => x.kind), ['behavior', 'stack']);
});

test('友盟默认生成精简 TXT，优先符号化堆栈且限制行数；切换后保留完整原文', () => {
  const record = { siteId: 'umeng-apm-crash', scopeId: 'aaaaaaaaaaaaaaaaaaaaaaaa', recordId: '12345678901234',
    title: 'Synthetic crash', sourceUrl: 'https://apm.umeng.com/platform/aaaaaaaaaaaaaaaaaaaaaaaa/error_analysis/crash/detail/12345678901234',
    descriptionBlocks: [], logs: [{ kind: 'behavior', id: 'log-1', text: 'tap button' },
      { kind: 'stack', id: 'hash-1', originStack: 'raw-address-should-not-appear',
        afterStack: Array.from({ length: 60 }, (_, index) => `symbolicated-frame-${index}`).join('\n'),
        text: '原始堆栈：\nraw-address-should-not-appear\n\n符号化堆栈：\n' +
          Array.from({ length: 60 }, (_, index) => `symbolicated-frame-${index}`).join('\n') }] };
  const draft = core.buildUmengDraft(record);
  assert.match(draft.description, /tap button/);
  assert.equal(draft.attachments.length, 1);
  assert.equal(draft.attachments[0].name, 'umeng-stack-12345678901234-summary.txt');
  assert.match(draft.attachments[0].content, /symbolicated-frame-0/);
  assert.doesNotMatch(draft.attachments[0].content, /raw-address-should-not-appear|symbolicated-frame-59/);
  const full = core.buildUmengDraft(record, 'full');
  assert.equal(full.attachments[0].name, 'umeng-stack-12345678901234-1-full.txt');
  assert.match(full.attachments[0].content, /raw-address-should-not-appear/);
  assert.match(full.attachments[0].content, /symbolicated-frame-59/);
});

test('友盟默认只汇总前两种堆栈，不因大量明细生成大量附件', () => {
  const record = { siteId: 'umeng-apm-crash', scopeId: 'aaaaaaaaaaaaaaaaaaaaaaaa', recordId: '12345678901234',
    title: 'Synthetic crash', sourceUrl: 'https://apm.umeng.com/platform/aaaaaaaaaaaaaaaaaaaaaaaa/error_analysis/crash/detail/12345678901234',
    descriptionBlocks: [], logs: Array.from({ length: 5 }, (_, index) =>
      ({ kind: 'stack', id: `hash-${index}`, text: `stack-${index}` })) };
  const draft = core.buildUmengDraft(record);
  assert.equal(draft.attachments.length, 1);
  assert.match(draft.attachments[0].content, /stack-0/);
  assert.match(draft.attachments[0].content, /stack-1/);
  assert.doesNotMatch(draft.attachments[0].content, /stack-2/);
  assert.match(draft.attachments[0].content, /另有 3 种堆栈/);
  assert.equal(core.buildUmengDraft(record, 'full').attachments.length, 5);
});

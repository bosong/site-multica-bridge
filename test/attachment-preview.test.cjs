const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../bugdone-multica.user.js'), 'utf8');

function descriptor() {
  const safeStart = source.indexOf('  function safeURL(');
  const safeEnd = source.indexOf('  function mergeBug(', safeStart);
  const start = source.indexOf('  function attachmentPreviewDescriptor(');
  const end = source.indexOf('  function renderSelectedAttachments(', start);
  assert.ok(safeStart >= 0 && safeEnd > safeStart && start >= 0 && end > start,
    '脚本须提供可运行的附件预览分类逻辑');
  return new Function(`${source.slice(safeStart, safeEnd)}\n${source.slice(start, end)}\nreturn attachmentPreviewDescriptor;`)();
}

test('远端图片可预览，非 HTTPS 地址不会进入预览器', () => {
  const describe = descriptor();
  assert.deepEqual(describe({ name: 'screen.png', url: 'https://img.bugdone.cn/screen.png', image: true }),
    { kind: 'image-url', name: 'screen.png', url: 'https://img.bugdone.cn/screen.png' });
  assert.deepEqual(describe({ name: 'bad.png', url: 'javascript:alert(1)', image: true }),
    { kind: 'unavailable', name: 'bad.png' });
});

test('捕获文本和本地 TXT 可读取，非预览格式只提供来源链接', () => {
  const describe = descriptor();
  assert.deepEqual(describe({ name: 'stack.txt', content: 'line 1\nline 2' }),
    { kind: 'text-content', name: 'stack.txt', content: 'line 1\nline 2' });
  const file = new Blob(['hello'], { type: 'text/plain' });
  assert.deepEqual(describe({ name: 'note.txt', file }), { kind: 'text-file', name: 'note.txt', file });
  assert.deepEqual(describe({ name: 'crash.zip', url: 'https://img.bugdone.cn/crash.zip' }),
    { kind: 'link', name: 'crash.zip', url: 'https://img.bugdone.cn/crash.zip' });
});

test('用户选择的本地图片按 Blob 预览，远端 TXT 可尝试读取', () => {
  const describe = descriptor();
  const file = new Blob(['image'], { type: 'image/png' });
  assert.deepEqual(describe({ name: 'photo.png', file }), { kind: 'image-file', name: 'photo.png', file });
  assert.deepEqual(describe({ name: 'trace.txt', url: 'https://img.bugdone.cn/trace.txt' }),
    { kind: 'text-url', name: 'trace.txt', url: 'https://img.bugdone.cn/trace.txt' });
});

test('远端 TXT 优先通过 Mac 原生桥读取，并限制预览数据大小', async () => {
  const start = source.indexOf('  async function readRemotePreviewText(');
  const end = source.indexOf('  function attachmentPreviewDescriptor(', start);
  assert.ok(start >= 0 && end > start, '脚本须提供远端文本预览读取逻辑');
  const calls = [];
  const read = new Function('window', 'gmCall', 'GM_xmlhttpRequest', 'fetch',
    `${source.slice(start, end)}\nreturn readRemotePreviewText;`)(
    { FastlaneNativeNetwork: { request: async options => { calls.push(options); return { status: 200, body: 'stack line' }; } } },
    () => { throw Error('不应使用油猴请求'); }, undefined,
    () => { throw Error('不应使用浏览器 fetch'); });
  assert.equal(await read('https://img.bugdone.cn/trace.txt'), 'stack line');
  assert.deepEqual(calls.map(call => [call.method, call.url, call.responseType]),
    [['GET', 'https://img.bugdone.cn/trace.txt', 'text']]);
  await assert.rejects(() => read('http://img.bugdone.cn/trace.txt'), /HTTPS/);
  const oversized = new Function('window', 'gmCall', 'GM_xmlhttpRequest', 'fetch',
    `${source.slice(start, end)}\nreturn readRemotePreviewText;`)(
    { FastlaneNativeNetwork: { request: async () => ({ status: 200, body: 'x'.repeat(1_000_001) }) } },
    () => {}, undefined, () => {});
  await assert.rejects(() => oversized('https://img.bugdone.cn/trace.txt'), /文件过大/);
});

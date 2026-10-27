const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../bugdone-multica.user.js'), 'utf8');
const start = source.indexOf('  async function uploadLocalAttachment(');
const end = source.indexOf('  function htmlText(', start);
assert.ok(start > 0 && end > start);

function uploader(request, uploadImage = () => { throw Error('unexpected image upload'); }, uploadFile) {
  const window = { FastlaneNativeNetwork: { request, uploadFile } };
  return new Function('window', 'message', 'gmCall', 'GM_xmlhttpRequest', 'uploadImage',
    `${source.slice(start, end)}\nreturn { uploadLocalAttachment, prepareSelectedAttachments };`)
    (window, () => {}, () => { throw Error('unexpected GM call'); }, undefined, uploadImage);
}

function imageUploader(request) {
  const begin = source.indexOf('  async function uploadImage(');
  const end = source.indexOf('  async function uploadLocalAttachment(', begin);
  const window = { FastlaneNativeNetwork: { request } };
  return new Function('window', 'gmCall', 'GM_xmlhttpRequest',
    `${source.slice(begin, end)}\nreturn uploadImage;`)(window, () => {}, undefined);
}

test('Mac 网络桥上传 UTF-8 日志时使用受限 multipart，并把 ID 关联到任务', async () => {
  let sent;
  const { prepareSelectedAttachments } = uploader(async options => {
    sent = options;
    return { status: 201, body: JSON.stringify({ id: 'file-synthetic' }) };
  });
  const body = await prepareSelectedAttachments({ api: 'https://api.multica.ai', token: 'synthetic', workspace: 'workspace-synthetic' },
    { title: 'synthetic' }, [{ name: 'stack.txt', content: '堆栈\nline 2', mimeType: 'text/plain' }]);
  assert.deepEqual(body.attachment_ids, ['file-synthetic']);
  assert.equal(sent.method, 'POST');
  assert.equal(sent.url, 'https://api.multica.ai/api/upload-file');
  assert.match(sent.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  const decoded = Buffer.from(sent.bodyBase64, 'base64').toString('utf8');
  assert.match(decoded, /filename="stack.txt"/);
  assert.match(decoded, /堆栈\nline 2/);
});

test('Mac 网络桥拒绝超过 1 MiB 的本地附件且不发送请求', async () => {
  let calls = 0;
  const { uploadLocalAttachment } = uploader(async () => { calls++; return { status: 201, body: '{"id":"x"}' }; });
  await assert.rejects(() => uploadLocalAttachment({ api: 'https://api.multica.ai', token: 'synthetic', workspace: 'w' },
    { name: 'large.txt', content: 'a'.repeat(1_048_576) }), /1 MiB/);
  assert.equal(calls, 0);
});

test('新 Mac 网络桥以分块上传超过 1 MiB 的文件并关联附件 ID', async () => {
  let sent;
  const { prepareSelectedAttachments } = uploader(() => { throw Error('不应走旧单报文通道'); }, undefined,
    async (options, blob) => {
      sent = { options, size: blob.size };
      return { status: 201, body: JSON.stringify({ id: 'large-file' }) };
    });
  const body = await prepareSelectedAttachments({ api: 'https://api.multica.ai', token: 'synthetic', workspace: 'w' },
    { title: 'synthetic' }, [{ name: 'big.txt', content: 'a'.repeat(1_100_000) }]);
  assert.deepEqual(body.attachment_ids, ['large-file']);
  assert.equal(sent.options.url, 'https://api.multica.ai/api/upload-file');
  assert.match(sent.options.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  assert.ok(sent.size > 1_100_000);
});

test('任务附件列表删除图片后，只上传仍被选中的 BugDone 截图', async () => {
  const uploaded = [];
  const { prepareSelectedAttachments } = uploader(() => { throw Error('unexpected native request'); }, async (_c, item) => {
    uploaded.push(item.name); return { id: `file-${uploaded.length}` };
  });
  const body = await prepareSelectedAttachments({ api: 'https://api.multica.ai' }, {}, [
    { name: 'kept.png', url: 'https://img.bugdone.cn/kept.png', remoteImage: true }
  ]);
  assert.deepEqual(uploaded, ['kept.png']);
  assert.deepEqual(body.attachment_ids, ['file-1']);
});

test('站点图片上传前再检查 HTTPS 来源域，拒绝跨站替换', async () => {
  const calls = [];
  const uploadImage = imageUploader(async options => {
    calls.push(options); return { status: 201, body: JSON.stringify({ id: 'image-file' }) };
  });
  const config = { api: 'https://api.multica.ai', token: 'synthetic', workspace: 'w' };
  const permitted = { name: 'screen.png', url: 'https://issues.example.test/files/screen.png',
    allowedOrigins: ['https://issues.example.test'] };
  assert.equal((await uploadImage(config, permitted)).id, 'image-file');
  assert.equal(calls[0].sourceUrl, permitted.url);
  await assert.rejects(() => uploadImage(config, { ...permitted, url: 'https://other.example.test/files/screen.png' }), /允许的 HTTPS 图片域/);
  await assert.rejects(() => uploadImage(config, { ...permitted, url: 'http://issues.example.test/files/screen.png' }), /允许的 HTTPS 图片域/);
  assert.equal(calls.length, 1);
});

test('BugDone 默认压缩图生成可预览的本地附件；切换原图才使用源站图片', async () => {
  const start = source.indexOf('  async function prepareBugDoneImages(');
  const end = source.indexOf('  async function uploadImage(', start);
  assert.ok(start >= 0 && end > start, '须提供图片版本选择逻辑');
  const prepare = new Function(`${source.slice(start, end)}\nreturn prepareBugDoneImages;`)();
  const bug = { BugId: 'bug-1', attachments: [
    { name: 'screen.png', url: 'https://img.bugdone.cn/screen.png', image: true, remoteImage: true, transform: {preset:'image',maxDimension:2200,quality:0.9} },
    { name: 'trace.txt', url: 'https://img.bugdone.cn/trace.txt', image: false }
  ] };
  const blob = new Blob(['compressed'], { type: 'image/webp' });
  const compress = async item => ({ name: 'screen.webp', blob, source: item.name });
  const brief = await prepare(bug, 'compressed', new Set(), compress);
  assert.equal(brief.length, 1);
  assert.equal(brief[0].name, 'screen.webp');
  assert.equal(brief[0].file, blob);
  assert.equal(brief[0].remoteImage, false, '压缩后须通过本地文件上传，不能再次拉取原图');
  assert.equal(brief[0].attachmentKey, 'screen.png');
  const original = await prepare(bug, 'original', new Set(), compress);
  assert.equal(original[0].remoteImage, true);
  assert.equal(original[0].url, bug.attachments[0].url);
  await assert.rejects(() => prepare(bug, 'compressed', new Set(), async () => { throw Error('压缩失败'); }), /压缩失败/);
  assert.deepEqual(await prepare(bug, 'compressed', new Set(['bug-1:screen.png']), compress), []);
});

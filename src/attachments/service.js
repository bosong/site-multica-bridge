
export function createAttachments({message=()=>{},gmCall,window=globalThis.window,document=globalThis.document,fetch=globalThis.fetch,GM_xmlhttpRequest=globalThis.GM_xmlhttpRequest}={}) {
async function loadBugDoneImageBlob(attachment) {
    const source = new URL(attachment.url);
    if (source.protocol !== 'https:' || !(attachment.allowedOrigins || ['https://img.bugdone.cn']).includes(source.origin) || source.username || source.password || source.hash)
      throw Error('BugDone 图片地址不属于允许的 HTTPS 图片域');
    let blob;
    if (typeof window.FastlaneNativeNetwork?.request === 'function') {
      try {
        const response = await window.FastlaneNativeNetwork.request({ method: 'GET', url: source.href,
          responseType: 'base64', timeoutMs: 60000 });
        if (response.status !== 200 || typeof response.bodyBase64 !== 'string') throw Error(`HTTP ${response.status}`);
        const binary = atob(response.bodyBase64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        const type = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || 'image/png';
        blob = new Blob([bytes], { type });
      } catch (nativeError) {
        try {
          const response = await fetch(source.href, { credentials: 'omit', mode: 'cors' });
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          blob = await response.blob();
        } catch (_) { throw Error(`无法读取压缩所需的图片数据（${nativeError.message}）；请切换原图`); }
      }
    } else if (typeof GM_xmlhttpRequest === 'function') {
      const response = await gmCall({ method: 'GET', url: source.href, responseType: 'blob' });
      if (response.status !== 200 || !(response.response instanceof Blob)) throw Error(`读取图片失败（HTTP ${response.status}）`);
      blob = response.response;
    } else {
      const response = await fetch(source.href, { credentials: 'omit', mode: 'cors' });
      if (!response.ok) throw Error(`读取图片失败（HTTP ${response.status}）`);
      blob = await response.blob();
    }
    if (!blob.size || blob.size > 20 * 1024 * 1024 || !blob.type.toLowerCase().startsWith('image/'))
      throw Error('来源不是有效图片或超过 20 MiB');
    return blob;
  }
async function compressBugDoneImage(attachment) {
    const source = await loadBugDoneImageBlob(attachment);
    if (source.type.toLowerCase() === 'image/gif') throw Error(`「${attachment.name}」为 GIF，请切换原图以保留动画`);
    const objectUrl = URL.createObjectURL(source);
    let image;
    try {
      image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(Error('图片解码失败'));
        element.src = objectUrl;
      });
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width * height > 40_000_000) throw Error('图片尺寸无效或过大');
      const ratio = Math.min(1, (attachment.transform?.maxDimension || 2200) / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw Error('当前环境无法压缩图片');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const encode = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
      let blob = await encode('image/webp', attachment.transform?.quality || 0.9);
      let extension = 'webp';
      if (!blob || blob.type !== 'image/webp') { blob = await encode('image/jpeg', attachment.transform?.quality || 0.92); extension = 'jpg'; }
      if (!blob?.size || blob.size >= source.size) throw Error('压缩后未减小体积，请切换原图提交');
      return { blob, name: `${String(attachment.name || 'screenshot').replace(/\.[^.]+$/, '')}.${extension}` };
    } finally { URL.revokeObjectURL(objectUrl); }
  }
async function prepareBugDoneImages(bug, mode, removedNames, compressor = compressBugDoneImage) {
    const images = (bug.attachments || []).filter(item => item.image && !removedNames.has(`${bug.BugId}:${item.name}`));
    if (mode === 'original') return images.map(item => ({ ...item, remoteImage: true, original: true, generated: true,
      attachmentScope: bug.BugId, attachmentKey: item.name }));
    const prepared = [];
    for (const item of images) {
      const compressed = await compressor(item);
      prepared.push({ ...item, name: compressed.name, file: compressed.blob, remoteImage: false, generated: true,
        attachmentScope: bug.BugId, attachmentKey: item.name });
    }
    return prepared;
  }
async function uploadImage(c, attachment) {
    const source = new URL(attachment.url);
    const allowedOrigins = attachment.allowedOrigins || ['https://img.bugdone.cn'];
    if (source.protocol !== 'https:' || !allowedOrigins.includes(source.origin) || source.username || source.password || source.hash)
      throw Error('图片地址不属于配置允许的 HTTPS 图片域');
    const target = `${c.api}/api/upload-file`;
    let status, data;
    if (typeof window.FastlaneNativeNetwork?.request === 'function') {
      const response = await window.FastlaneNativeNetwork.request({ method: 'POST', url: target,
        sourceUrl: source.href, filename: attachment.name,
        headers: { Authorization: `Bearer ${c.token}`, 'X-Workspace-ID': c.workspace },
        timeoutMs: 60000, responseType: 'text' });
      status = response.status; try { data = JSON.parse(response.body); } catch { data = null; }
    } else if (typeof GM_xmlhttpRequest === 'function') {
      const image = await gmCall({ method: 'GET', url: source.href, responseType: 'blob' });
      if (image.status !== 200 || !(image.response instanceof Blob)) throw Error(`读取图片失败（HTTP ${image.status}）`);
      if (image.response.size > 20 * 1024 * 1024) throw Error('图片超过 20 MiB');
      if (!image.response.type.startsWith('image/')) throw Error('BugDone 返回的不是图片');
      const form = new FormData(); form.append('file', image.response, attachment.name);
      const uploaded = await gmCall({ method: 'POST', url: target, headers: {
        Authorization: `Bearer ${c.token}`, 'X-Workspace-ID': c.workspace }, data: form });
      status = uploaded.status; try { data = JSON.parse(uploaded.responseText); } catch { data = null; }
    } else {
      throw Error('当前环境没有可用的跨域图片上传通道');
    }
    if (status < 200 || status >= 300 || !data?.id) throw Error(`上传失败（HTTP ${status}）：${String(data?.error || data?.message || '请检查 Multica 文件存储配置').slice(0, 150)}`);
    return data;
  }
async function uploadLocalAttachment(c, attachment) {
    const blob = attachment.file || new Blob([attachment.content || ''], { type: attachment.mimeType || 'text/plain' });
    if (!(blob instanceof Blob) || !blob.size || blob.size > 20 * 1024 * 1024) throw Error('附件必须为 1 字节至 20 MiB 的本地文件');
    const name = String(attachment.name || 'attachment').replace(/[\\/\r\n"]/g, '_').slice(0, 180);
    const target = `${c.api}/api/upload-file`;
    let status, data;
    if (typeof GM_xmlhttpRequest === 'function') {
      const form = new FormData(); form.append('file', blob, name);
      const result = await gmCall({ method: 'POST', url: target, headers: {
        Authorization: `Bearer ${c.token}`, 'X-Workspace-ID': c.workspace }, data: form });
      status = result.status; try { data = JSON.parse(result.responseText); } catch { data = null; }
    } else if (typeof window.FastlaneNativeNetwork?.request === 'function') {
      const encoder = new TextEncoder();
      const boundary = `Fastlane-${crypto.randomUUID()}`;
      const start = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`);
      const end = encoder.encode(`\r\n--${boundary}--\r\n`);
      const options = { method: 'POST', url: target,
        headers: { Authorization: `Bearer ${c.token}`, 'X-Workspace-ID': c.workspace,
          'Content-Type': `multipart/form-data; boundary=${boundary}` },
        timeoutMs: 60000, responseType: 'text' };
      const size = start.length + blob.size + end.length;
      let result;
      if (size > 1_048_576) {
        if (typeof window.FastlaneNativeNetwork.uploadFile !== 'function')
          throw Error('当前 Mac App 网络桥单个本地附件上限为 1 MiB；请更新 FastlaneTool 后重试');
        result = await window.FastlaneNativeNetwork.uploadFile(options,
          new Blob([start, blob, end], { type: options.headers['Content-Type'] }));
      } else {
        const payload = new Uint8Array(await blob.arrayBuffer());
        const multipart = new Uint8Array(size);
        multipart.set(start); multipart.set(payload, start.length); multipart.set(end, start.length + payload.length);
        let binary = '';
        for (let i = 0; i < multipart.length; i += 32768) binary += String.fromCharCode(...multipart.subarray(i, i + 32768));
        result = await window.FastlaneNativeNetwork.request({ ...options, bodyBase64: btoa(binary) });
      }
      status = result.status; try { data = JSON.parse(result.body); } catch { data = null; }
    } else throw Error('当前环境没有可用的本地附件上传通道');
    if (status < 200 || status >= 300 || !data?.id) throw Error(`附件上传失败（HTTP ${status}）`);
    return data.id;
  }
async function prepareSelectedAttachments(c, body, attachments) {
    const ids = [...(body.attachment_ids || [])];
    for (let index = 0; index < attachments.length; index++) {
      message(`正在上传附件 ${index + 1}/${attachments.length}：${attachments[index].name}`);
      try {
        const item=attachments[index];
        const prepared=item.remoteImage && item.transform && !item.original ? {...item,...await compressBugDoneImage(item)} : null;
        ids.push(prepared ? await uploadLocalAttachment(c,{...prepared,file:prepared.blob}) : item.remoteImage
          ? (await uploadImage(c,item)).id : await uploadLocalAttachment(c,item));
      } catch (error) {
        throw Error(`附件「${attachments[index].name}」上传失败：${error.message}；任务尚未创建。此前已上传的文件可能暂存在 Multica。`);
      }
    }
    return ids.length ? { ...body, attachment_ids: ids } : body;
  }
return {loadBugDoneImageBlob,compressBugDoneImage,prepareBugDoneImages,uploadImage,uploadLocalAttachment,prepareSelectedAttachments};
}

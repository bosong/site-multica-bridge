import { BUGID } from '../config/constants.js';
import { profileValue } from './profiles.js';
import { profileRouteParams, profileIdentityMatches, matchProfilePage, locationOf } from './matching.js';
import { renderCaptureTemplate } from './drafts.js';

export function normalizeProfileAttachments(profile,raw,values) {
    const attachments = [], attachmentWarnings = [];
    for (const rule of profile.attachments || []) {
      const content = profileValue(raw, rule.path);
      const items = rule.items ? (Array.isArray(content) ? content.slice(0,100) : []) : [content];
      for (const item of items) {
        if(rule.items?.extension && !/^(png|jpe?g|gif|webp|bmp)$/i.test(profileValue(item,rule.items.extension) || '')) continue;
        if (rule.items?.filter && profileValue(item,rule.items.filter.path) === rule.items.filter.notEquals) continue;
        const value = rule.items ? profileValue(item,rule.items.url) : item;
        if (typeof value !== 'string' || !value.trim()) continue;
        try {
          const name = String((rule.items?.name && profileValue(item,rule.items.name)) || (rule.items && locationOf(value)?.pathname.split('/').pop()) || renderCaptureTemplate(rule.filenameTemplate,values)).replace(/[\\/\r\n]/g,'_').slice(0,180);
          if (rule.kind === 'text') {
            if (value.length > rule.maxChars) { attachmentWarnings.push(`${rule.id} 超过 ${rule.maxChars} 字符上限`); continue; }
            attachments.push({ name, content:value, mimeType:'text/plain' });
          } else {
            const image=locationOf(value), allowedOrigins=rule.allowedOrigins || profile.allowedOrigins;
            if (value.length>2048 || image?.protocol!=='https:' || !allowedOrigins.includes(image.origin) || image.username || image.password || image.hash) {
              attachmentWarnings.push(`${rule.id} 图片地址不属于配置允许的 HTTPS 站点`); continue;
            }
            attachments.push({name,url:image.href,remoteImage:true,allowedOrigins:[...allowedOrigins],sourceSite:profile.id,transform:rule.transform});
          }
        } catch { attachmentWarnings.push(`${rule.id} 文件名缺少模板字段`); }
      }
    }
    return {attachments,attachmentWarnings};
  }

export function normalizeCapturedRecord(profile, raw, context = {}) {
    const field = name => profileValue(raw, profile.record[name]);
    let scopeId = field('scopeId'), recordId = field('recordId');
    const title = field('title');
    // BugDone 的历史标题标记与缓存使用小写十六进制 ID。
    if (profile.adapter === 'bugdone') {
      // 列表响应可能省略 ProjectId，仅从匹配的可信项目页面补全。
      if (!scopeId) {
        const page=locationOf(context.sourceUrl);
        if (page && profile.allowedOrigins.includes(page.origin) && matchProfilePage(profile,page.href)) {
          const candidate=profileRouteParams(profile,page.href)?.projectId || page.pathname.match(/^\/cn\/bugManagement_([a-f\d]{32})\/?$/i)?.[1];
          if (BUGID.test(candidate || '')) scopeId=candidate;
        }
      }
      scopeId = typeof scopeId === 'string' ? scopeId.toLowerCase() : scopeId;
      recordId = typeof recordId === 'string' ? recordId.toLowerCase() : recordId;
    }
    if (!scopeId || !recordId || typeof title !== 'string' || !title.trim()) return null;
    const values = { siteId: profile.id, scopeId: String(scopeId), recordId: String(recordId),
      number: field('number') ?? '', title };
    const {attachments,attachmentWarnings}=normalizeProfileAttachments(profile,raw,values);
    if(typeof field('descriptionText')==='string' && field('descriptionText').length>20000) attachmentWarnings.push('正文超过 20000 字符，任务中仅包含前 20000 字符；请打开来源查看完整正文');
    const source = locationOf(field('sourceUrl'));
    const sourceUrl = source && profile.allowedOrigins.includes(source.origin) && !source.username && !source.password &&
      matchProfilePage(profile, source.href)?.kind === 'detail' ? source.href : context.sourceUrl || '';
    return { siteId: profile.id, scopeId: String(scopeId), recordId: String(recordId),
      pageKind: context.kind || 'list', detail: context.kind === 'detail', sourceUrl,
      title, number: field('number') ?? '', descriptionHtml: field('descriptionHtml') || '',
      descriptionText: typeof field('descriptionText') === 'string' ? field('descriptionText').slice(0, 20000) : '',
      fields: Object.fromEntries(Object.entries(profile.record.fields || {}).map(([name, path]) => {
        const value = profileValue(raw, path);
        return [name, ['string', 'number', 'boolean'].includes(typeof value) ? String(value).slice(0, 20000) : ''];
      })),
      descriptionBlocks: [], attachments, attachmentWarnings, logs: [], fieldSources: {},
      capturedAt: context.capturedAt || new Date().toISOString(), completeness: context.kind === 'detail' ? 'detail' : 'summary' };
  }

export function recordKey(record) { return [record.siteId, record.scopeId, record.recordId].map(value => `${String(value).length}:${value}`).join(''); }

export function mergeCapturedRecord(previous, next) {
    if (!previous) return next;
    if (recordKey(previous) !== recordKey(next)) throw Error('不能合并不同来源的记录');
    if (previous.detail && !next.detail) return previous;
    const merged = { ...previous, ...next, detail: previous.detail || next.detail };
    for (const [key, value] of Object.entries(next)) {
      if ((value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) &&
          previous[key] !== undefined) merged[key] = previous[key];
    }
    return merged;
  }

export function collectStandardRecords(profile, entries, store, sourceUrl) {
    let count = 0;
    for (const { kind, item } of entries) {
      if (!profileIdentityMatches(profile, item, sourceUrl)) continue;
      const record = normalizeCapturedRecord(profile, item, { kind, sourceUrl });
      if (!record) continue;
      const key = recordKey(record);
      store.set(key, mergeCapturedRecord(store.get(key), record));
      count++;
    }
    return count;
  }

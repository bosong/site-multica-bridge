import { BUGID } from '../config/constants.js';
import { BUGDONE_PROFILE } from './builtins.js';
import { matchSiteCapture, extractProfileItems } from '../capture/matching.js';
import { normalizeProfileAttachments, normalizeCapturedRecord } from '../capture/records.js';

export function shareURL(b) {
    if (!BUGID.test(b.ProjectId || '') || !BUGID.test(b.BugId || '')) return '';
    return `https://www.bugdone.cn/cn/bugPreview/${b.ProjectId}/${b.BugId}`;
  }

export const marker = id => `[BugDone:${id.toLowerCase()}]`;

export function bugTaskTitle(b) {
    return `[BugDone] #${b.BugCode} ${b.BugTitle} ${marker(b.BugId)}`;
  }

export const isBugAPI = (value, method = 'POST') => !!matchSiteCapture(BUGDONE_PROFILE, { url: value, method });

export function parseResponse(value, profile = BUGDONE_PROFILE, context = {}) {
    return extractProfileItems(profile.captures[0], value).filter(({ item: b }) =>
      b && BUGID.test(b.BugId || '') && typeof b.BugTitle === 'string'
    ).map(({ item: b, kind }) => {
      const record=normalizeCapturedRecord(profile,b,{...context,kind});
      return ({
      BugId: String(record?.recordId || b.BugId).toLowerCase(), BugCode: record?.number ?? b.BugCode, BugTitle: record?.title || b.BugTitle,
      captureRecord:record,
      ProjectId: record?.scopeId || b.ProjectId || '', ProjectName: b.ProjectName || '',
      ProductName: b.ProductName || '', ModuleName: b.ModuleName || '',
      StrPriority: b.StrPriority || '', StrBugStatus: b.StrBugStatus || '',
      Description: typeof b.Description === 'string' ? b.Description : '',
      Environment: b.Environment || '', PicCount: b.PicCount || 0,
      AttachmentCount: b.AttachmentCount || 0,
      detail: kind === 'detail', sourceUrl: record?.sourceUrl || '',
      attachments: [...normalizeProfileAttachments(profile,b,{siteId:profile.id,scopeId:b.ProjectId,recordId:b.BugId,number:b.BugCode,title:b.BugTitle}).attachments.map(a=>({...a,image:!!a.remoteImage})), ...(Array.isArray(b.BugAccessoryList) ? b.BugAccessoryList : [])
        .filter(a => a && a.ActiveFlg !== false && a.FullFileUrl && !/^(png|jpe?g|gif|webp|bmp)$/i.test(a.ext || ''))
        .map(a => ({ url: safeURL(a.FullFileUrl), name: String(a.FileName || a.AccessoryName || a.FileUrl || '附件'), image: /^(png|jpe?g|gif|webp|bmp)$/i.test(a.ext || '') }))
        .filter(a => a.url)]
    }); });
  }

export function safeURL(value) {
    try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; }
    catch { return ''; }
  }

export function mergeBug(old, next) {
    // 列表里的 null/空字段不能覆盖已经捕获到的详情。
    if (old?.detail && !next.detail) return { ...next, ...old, BugTitle: next.BugTitle, StrBugStatus: next.StrBugStatus };
    return { ...old, ...next };
  }

export const owns = (issue, id) => typeof issue?.title === 'string' &&
    (issue.title.startsWith(marker(id) + ' ') || issue.title.endsWith(' ' + marker(id)));

export async function startBugDoneProcessing(bug, postForm) {
    const bugId = String(bug?.BugId || '').toLowerCase();
    if (!BUGID.test(bugId)) throw Error('BugDone Bug ID 无效');
    const read = async () => {
      const response = await postForm({ Method: 'getBugInfo', bugId });
      if (response?.Result !== 1) throw Error(`BugDone 读取状态失败：${response?.Message || '未知错误'}`);
      const detail = response.ReturnObj;
      if (String(detail?.BugId || '').toLowerCase() !== bugId) throw Error('BugDone 返回的 Bug ID 不匹配');
      if (!detail.StrBugStatus) throw Error('BugDone 未返回当前状态');
      return detail.StrBugStatus;
    };
    const state = await read();
    if (state === '处理中') return { kind: 'already-processing', state };
    if (state !== '待处理') return { kind: 'skipped', state };
    const changed = await postForm({ Method: 'addBugAssign', bugId, actionType: 'toprocessing', reason: '' });
    if (changed?.Result !== 1) throw Error(`BugDone 开始处理失败：${changed?.Message || '未知错误'}`);
    const verified = await read();
    if (verified !== '处理中') throw Error(`BugDone 状态更新未确认：当前为${verified}`);
    return { kind: 'started', state: verified };
  }

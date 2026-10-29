import { UMENG_PROFILE } from './builtins.js';
import { locationOf, extractProfileItems } from '../capture/matching.js';
import { normalizeCapturedRecord, recordKey, mergeCapturedRecord } from '../capture/records.js';
import { buildCapturedDraft } from '../capture/drafts.js';

export function buildUmengDraft(record, stackMode = 'summary', profile = UMENG_PROFILE) {
    const draft = buildCapturedDraft(record, profile);
    const policy = profile.processors?.stack || { maxStacks:2,maxLines:40,maxChars:4000 };
    const behavior = (record.logs || []).filter(log => log.kind === 'behavior' && log.text);
    const stacks = (record.logs || []).filter(log => log.kind === 'stack' && log.text);
    const logText = behavior.map(log => `行为日志 (${log.id})：\n${log.text}`).join('\n\n');
    draft.description = [draft.description, logText].filter(Boolean).join('\n\n');
    if (stackMode === 'full') {
      draft.attachments = stacks.map((log, index) => ({ name: `umeng-stack-${record.recordId}-${index + 1}-full.txt`,
        content: log.text, mimeType: 'text/plain' }));
    } else if (stacks.length) {
      const excerpts = stacks.slice(0, policy.maxStacks).map((log, index) => {
        const embeddedSymbolicated = log.text.match(/(?:^|\n\n)符号化堆栈：\n([\s\S]*)$/);
        const source = String(log.afterStack || embeddedSymbolicated?.[1] || log.originStack || log.text).trim();
        const lines = source.split(/\r?\n/);
        const excerpt = lines.slice(0, policy.maxLines).join('\n').slice(0, policy.maxChars);
        const omitted = lines.length > policy.maxLines || source.length > excerpt.length ? '\n（其余堆栈帧已省略；可切换完整版）' : '';
        return `堆栈 ${index + 1} · ${log.id} · ${log.afterStack || embeddedSymbolicated ? '符号化' : '原始'}\n${excerpt}${omitted}`;
      });
      if (stacks.length > policy.maxStacks) excerpts.push(`另有 ${stacks.length - policy.maxStacks} 种堆栈未包含；可切换完整版。`);
      draft.attachments = [{ name: `umeng-stack-${record.recordId}-summary.txt`,
        content: excerpts.join('\n\n'), mimeType: 'text/plain' }];
    } else draft.attachments = [];
    return draft;
  }

export function createUmengCaptureState() {
    return { records: new Map(), pendingLogs: new Map(), pendingStacks: new Map(), stackOwners: new Map(), logCounts: new Map(), loadedLogIds: new Map() };
  }

export function umengRoute(sourceUrl) {
    const url = locationOf(sourceUrl);
    if (url?.origin !== 'https://apm.umeng.com') return null;
    const match = url.pathname.match(/^\/platform\/([a-f\d]{24})\/error_analysis\/crash(?:\/detail\/(\d{5,25}))?\/?$/i);
    return match ? { appId: match[1], errorId: match[2] || '' } : null;
  }

export function addCapturedLog(state, key, log) {
    const record = state.records.get(key);
    if (!record || !log.text) return;
    const logs = record.logs.filter(item => !(item.kind === log.kind && item.id === log.id));
    logs.push(log);
    state.records.set(key, { ...record, logs });
  }

export function attachUmengLogDetail(state, key, data) {
    if (data.logId) {
      const ids = state.loadedLogIds.get(key) || new Set(); ids.add(String(data.logId));
      state.loadedLogIds.set(key, ids);
      const record = state.records.get(key);
      if (record) state.records.set(key, { ...record, logDetailCoverage: {
        captured: ids.size, total: state.logCounts.get(key)?.total || 0 } });
    }
    if (typeof data.pagesBehavior === 'string' && data.pagesBehavior.trim())
      addCapturedLog(state, key, { kind: 'behavior', id: String(data.logId), text: data.pagesBehavior });
    if (typeof data.stackMd5 !== 'string' || !data.stackMd5) return;
    const owners = state.stackOwners.get(data.stackMd5) || new Set();
    owners.add(key); state.stackOwners.set(data.stackMd5, owners);
    const pending = state.pendingStacks.get(data.stackMd5) || [];
    for (const stack of pending.filter(item => item.ownerKey === key)) addCapturedLog(state, key, stack.log);
    const remaining = pending.filter(item => item.ownerKey !== key);
    if (remaining.length) state.pendingStacks.set(data.stackMd5, remaining);
    else state.pendingStacks.delete(data.stackMd5);
  }

export function applyUmengCapture(state, response, meta, profile = UMENG_PROFILE) {
    if(typeof response==='string') {try{response=JSON.parse(response);}catch{return null;}}
    const rule = profile.captures.find(item => item.id === meta?.ruleId);
    const route = umengRoute(meta?.sourceUrl);
    if (!rule || !route) return null;
    const entries = extractProfileItems(rule, response);
    if (!entries.length) return null;
    const request = meta.request || {};
    const scopeId = String(request.dataSourceId || route.appId);
    if (scopeId !== route.appId) return null;
    const routeKey = route.errorId ? recordKey({ siteId: profile.id, scopeId, recordId: route.errorId }) : '';
    if (rule.id === 'umeng-error-stack') {
      const data = entries[0].item, key = String(request.key || '');
      if (!routeKey || !key || data.key !== key) return null;
      const text = [data.originStack && `原始堆栈：\n${data.originStack}`, data.afterStack && `符号化堆栈：\n${data.afterStack}`].filter(Boolean).join('\n\n');
      if (!text) return null;
      const log = { kind: 'stack', id: key, text, originStack: data.originStack || '', afterStack: data.afterStack || '' };
      if (state.stackOwners.get(key)?.has(routeKey)) addCapturedLog(state, routeKey, log);
      else {
        const pending = state.pendingStacks.get(key) || [];
        pending.push({ ownerKey: routeKey, log }); state.pendingStacks.set(key, pending.slice(-10));
      }
      return state.records.get(routeKey) || null;
    }
    if (rule.id === 'umeng-log-list') {
      if (!routeKey || String(request.errorId) !== route.errorId) return null;
      state.logCounts.set(routeKey, { captured: entries.length, total: Number(response?.data?.total || entries.length) });
      const record = state.records.get(routeKey);
      if (record) state.records.set(routeKey, { ...record, logCoverage: state.logCounts.get(routeKey),
        logDetailCoverage: { captured: state.loadedLogIds.get(routeKey)?.size || 0, total: state.logCounts.get(routeKey).total } });
      return record || null;
    }
    if (rule.id === 'umeng-log-detail') {
      if (!routeKey || String(request.errorId) !== route.errorId || String(request.logId || '') !== String(entries[0].item.logId || '')) return null;
      const data = entries[0].item;
      if (state.records.has(routeKey)) attachUmengLogDetail(state, routeKey, data);
      else {
        const pending = state.pendingLogs.get(routeKey) || [];
        pending.push(data); state.pendingLogs.set(routeKey, pending.slice(-10));
      }
      return state.records.get(routeKey) || null;
    }
    let latest = null;
    for (const { kind, item } of entries) {
      const id = String(item.id || '');
      if (!/^\d{5,25}$/.test(id) || (rule.id === 'umeng-error-detail' &&
          (id !== route.errorId || String(request.errorId) !== id))) continue;
      const sourceUrl = `https://apm.umeng.com/platform/${scopeId}/error_analysis/crash/detail/${id}`;
      const record = normalizeCapturedRecord(profile, { ...item, __scopeId: scopeId }, { kind, sourceUrl });
      if (!record) continue;
      record.descriptionBlocks = [
        item.appVersion && { heading: '应用版本', text: String(item.appVersion) },
        item.lastHappenTime && { heading: '最近发生时间', text: String(item.lastHappenTime) }
      ].filter(Boolean);
      const key = recordKey(record);
      state.records.set(key, mergeCapturedRecord(state.records.get(key), record));
      const coverage = state.logCounts.get(key);
      if (coverage) state.records.set(key, { ...state.records.get(key), logCoverage: coverage,
        logDetailCoverage: { captured: state.loadedLogIds.get(key)?.size || 0, total: coverage.total } });
      for (const pending of state.pendingLogs.get(key) || []) attachUmengLogDetail(state, key, pending);
      state.pendingLogs.delete(key);
      latest = state.records.get(key);
    }
    return latest;
  }

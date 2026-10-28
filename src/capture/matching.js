import { profileValue, validateSiteProfile } from './profiles.js';
import { normalizeCapturedRecord } from './records.js';
import { renderCaptureTemplate } from './drafts.js';

export function siteModeForUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return 'unsupported';
      if (['www.bugdone.cn', 'bugdone.cn'].includes(url.hostname)) return 'bugdone';
      if (url.hostname === 'apm.umeng.com') return 'umeng';
      if (url.hostname === 'github.com') return 'github';
      return 'manual';
    } catch { return 'unsupported'; }
  }

export function entryShouldShow(mode, profile) {
    return mode === 'all' || mode !== 'shortcut' && !!profile?.enabled;
  }

export function selectSiteProfile(profiles, url) {
    return profiles.filter(p => matchProfilePage(p,url)).sort((a,b) => (b.priority || 0)-(a.priority || 0) || a.id.localeCompare(b.id))[0] || null;
  }

export function profileRouteParams(profile, url) {
    const page=matchProfilePage(profile,url), parsed=locationOf(url); if (!page || !parsed) return null;
    const parts=parsed.pathname.replace(/\/$/,'').split('/'), params={};
    page.path.replace(/\/$/,'').split('/').forEach((part,i)=>{if(part.startsWith(':')) params[part.slice(1)]=parts[i];});
    return params;
  }

export function profileIdentityMatches(profile, raw, url) {
    const identity=profile.identity; if (!identity) return true;
    const params=profileRouteParams(profile,url); if (!params) return false;
    const scopeId=String(profileValue(raw,profile.record.scopeId) || ''), recordId=String(profileValue(raw,profile.record.recordId) || '');
    if (identity.recordFormat === 'positive-integer' && !/^[1-9]\d*$/.test(recordId) || identity.recordFormat === 'hex32' && !/^[a-f\d]{32}$/i.test(recordId)) return false;
    try {
      if (identity.scopeTemplate && renderCaptureTemplate(identity.scopeTemplate,params).toLowerCase() !== scopeId.toLowerCase()) return false;
      if (identity.recordParam && params[identity.recordParam] && params[identity.recordParam] !== recordId) return false;
      if (identity.sourceTemplate) {
        const expected=renderCaptureTemplate(identity.sourceTemplate,{...params,scopeId,recordId});
        const actual=profileValue(raw,profile.record.sourceUrl);
        if (typeof actual !== 'string' || actual.toLowerCase() !== expected.toLowerCase()) return false;
      }
    } catch { return false; }
    return true;
  }

export function matchSiteCapture(profile, { url, method, bytes = 0, contentType = '' }) {
    if (!profile?.enabled) return null;
    const parsed = locationOf(url, profile.allowedOrigins[0]);
    if (!profile.allowedOrigins.includes(parsed?.origin)) return null;
    if (!parsed || (contentType && !/\bjson\b|\+json\b/i.test(contentType))) return null;
    return (profile.captures || []).find(rule => rule.method === String(method).toUpperCase() && rule.origin === parsed.origin &&
      pathMatches(rule.path, parsed.pathname) && bytes <= rule.maxResponseBytes) || null;
  }

export function pathMatches(pattern, pathname) {
    const source = pattern.split('/').map(part => part.startsWith(':') ? '[^/]+' : part.split('*').map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('/');
    return new RegExp(`^${source}/?$`, 'i').test(pathname);
  }

export function matchProfilePage(profile, value) {
    if (!profile?.enabled) return null;
    const url = locationOf(value);
    if (!url || url.protocol !== 'https:' || !profile.allowedOrigins.includes(url.origin)) return null;
    return profile.pages.find(page => profile.captureMode && profile.captureMode !== 'api' && page.path === '/**' || pathMatches(page.path, url.pathname)) || null;
  }

export function locationOf(url, base) { try { return new URL(String(url), base); } catch { return null; } }

export function extractProfileItems(rule, value) {
    let data = value;
    for (let i = 0; i < 2 && typeof data === 'string'; i++) { try { data = JSON.parse(data); } catch { return []; } }
    if (!data || rule.success && profileValue(data, rule.success.path) !== rule.success.equals) return [];
    for (const variant of rule.variants) {
      const result = profileValue(data, variant.path);
      if (variant.type === 'array' && Array.isArray(result)) return result.map(item => variant.itemPath ? profileValue(item, variant.itemPath) : item)
        .filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(item => ({ kind: variant.kind, item }));
      if (variant.type === 'object' && result && typeof result === 'object' && !Array.isArray(result)) return [{ kind: variant.kind, item: result }];
    }
    return [];
  }

export function testProfileSample(profile, sample) {
    validateSiteProfile(profile);
    if (profile.captureMode && profile.captureMode !== 'api') throw Error('文本或空白模式不使用接口响应试运行');
    const choices = profile.captures.map(rule => ({ rule, entries: extractProfileItems(rule, sample) }));
    const selected = choices.find(choice => choice.entries.length) || choices[0];
    const valid = selected.entries.filter(({ item, kind }) => normalizeCapturedRecord(profile, item, { kind }));
    return { ruleId: selected.rule.id, matched: selected.entries.length, valid: valid.length,
      detail: valid.filter(entry => entry.kind === 'detail').length,
      missingIdentity: selected.entries.length - valid.length };
  }

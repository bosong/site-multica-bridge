import { VERSION, UUID } from '../config/constants.js';

export function validateConfig(c) {
    const u = new URL(c.api);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('API 地址请填写服务根地址，例如 https://api.multica.ai');
    const loopback = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw Error('远程 API 必须使用 HTTPS');
    if (!c.token?.trim() || !UUID.test(c.workspace)) throw Error('请填写 Token 和工作区完整 UUID');
    if (c.project && !UUID.test(c.project)) throw Error('Multica 项目 ID 必须是完整 UUID');
    return { ...c, api: u.origin, token: c.token.trim() };
  }

export function validateConnection(c) {
    const u = new URL(c.api);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('API 地址请填写服务根地址');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) throw Error('远程 API 必须使用 HTTPS');
    if (!c.token?.trim()) throw Error('请填写访问令牌');
    return { ...c, api: u.origin, token: c.token.trim() };
  }

export function validateStoredConfig(c) {
    const api = c.api?.trim() ? validateConnection({...c,token:'validate-root-only'}).api : '';
    if (c.workspace && !UUID.test(c.workspace)) throw Error('工作区 ID 必须是完整 UUID，或留空');
    if (c.project && !UUID.test(c.project)) throw Error('项目 ID 必须是完整 UUID，或留空');
    return {...c,api,token:String(c.token || '').trim()};
  }

export function agentCacheKey(c) { return `agents:${VERSION}:${c.api}:${c.workspace}`; }

export function agentChoices(c, list) {
    const agents = [], seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item.id !== 'string' || !item.id || item.is_archived === true || seen.has(item.id)) continue;
      seen.add(item.id);
      agents.push({ id: item.id, name: typeof item.name === 'string' && item.name ? item.name : item.id });
    }
    for (const id of [c.agent, c.defaultAgent]) {
      if (typeof id === 'string' && id && !seen.has(id)) {
        seen.add(id); agents.push({ id, name: `已保存的智能体 · ${id}` });
      }
    }
    return { agents, selectedAgent: c.agent || c.defaultAgent || '', selectedDefault: c.defaultAgent || '' };
  }

export function listItems(data, key) {
    if (Array.isArray(data)) return data;
    for (const value of [data?.[key], data?.items, data?.data]) if (Array.isArray(value)) return value;
    throw Error(`读取 ${key} 列表失败：响应结构不受支持`);
  }

export function connectionCacheTag(api, token) {
    let hash = 2166136261;
    for (const char of `${api}\n${token}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16);
  }

export function needsCatalogRefresh(c, savedTag, workspaces, catalog) {
    return !c.api || !c.token || !c.workspace || savedTag !== connectionCacheTag(c.api, c.token) ||
      !Array.isArray(workspaces) || !workspaces.some(item => item.id === c.workspace) ||
      !catalog || !['projects', 'agents', 'labels'].every(key => Array.isArray(catalog[key]));
  }

export function connectionBadge(c, phase) {
    if (!c.api || c.api === '__add__' || !c.token?.trim()) return { text: '未配置', color: '#94a3b8' };
    if (phase === 'connecting') return { text: '连接中', color: '#3b82f6' };
    if (phase === 'connected') return { text: '已连接', color: '#22c55e' };
    if (phase === 'error') return { text: '连接失败', color: '#ef4444' };
    return { text: '待连接', color: '#eab308' };
  }

export async function verifyConnection(api) {
    const response = await api('GET', '/api/me');
    if (response.status !== 200) throw Error(`连接验证失败（HTTP ${response.status}），请检查地址和令牌`);
  }

import { VERSION, UUID } from '../config/constants.js';
import { marker, owns } from '../sites/bugdone.js';
import { sourceMarker } from '../capture/drafts.js';

export function buildIssueBody({ title, description, agent, project, status, priority, label, startDate, dueDate }) {
    if (!title?.trim() || !description?.trim()) throw Error('标题和描述不能为空');
    if (!UUID.test(agent || '')) throw Error('请选择处理智能体');
    if (startDate && dueDate && startDate > dueDate) throw Error('截止日期不能早于开始日期');
    const body = { title, description, status: status || 'todo',
      priority: priority || 'none', assignee_type: 'agent', assignee_id: agent, allow_duplicate: false };
    if (project) body.project_id = project;
    if (label) body.label_ids = [label];
    if (startDate) body.start_date = startDate;
    if (dueDate) body.due_date = dueDate;
    return body;
  }

export function issueLabelState(issue, label) {
    if (!label) return 'none';
    if (!Array.isArray(issue?.labels)) return 'unknown';
    return issue.labels.some(item => item?.id === label) ? 'applied' : 'missing';
  }

export function cacheKey(c, id) { return `task:${VERSION}:${c.api}:${c.workspace}:${id}`; }

export async function findExisting(api, id) {
    // 搜索含已完成任务；分页全部读完才允许认定不存在。
    for (let offset = 0; offset < 5000; offset += 50) {
      const r = await api('GET', `/api/issues/search?q=${encodeURIComponent(marker(id))}&include_closed=true&limit=50&offset=${offset}`);
      if (r.status !== 200 || !Array.isArray(r.data?.issues)) throw Error('查询已有任务失败；已停止创建以防重复');
      const hit = r.data.issues.find(x => x.id && owns(x, id));
      if (hit) return hit;
      if (r.data.issues.length < 50) return null;
    }
    throw Error('搜索结果过多，无法确认是否重复；请人工核对');
  }

export async function lookupSubmittedIssue(api, item) {
    if (item.issueId) {
      const r = await api('GET', `/api/issues/${encodeURIComponent(item.issueId)}`);
      if (r.status === 200) {
        if (!r.data?.id || r.data.id !== item.issueId) throw Error('任务响应 ID 不匹配');
        if (item.api || owns(r.data, item.bugId)) return r.data;
      } else if (r.status !== 404) throw Error(`任务状态查询失败（HTTP ${r.status}）`);
    }
    return item.bugId ? findExisting(api, item.bugId) : null;
  }

export function issueStatusLabel(status) {
    const labels = { backlog: '待整理', todo: '待办', in_progress: '进行中', in_review: '待审核', done: '已完成', blocked: '已阻塞' };
    const value = typeof status === 'string' ? status : status?.name;
    return labels[value] || value || '未知';
  }

export async function loadSubmittedStatuses(items, c, api, report) {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item.workspace !== c.workspace || (item.api && item.api !== c.api)) {
          report(item, { kind: 'unavailable' });
          continue;
        }
        try {
          const issue = await lookupSubmittedIssue(api, item);
          report(item, issue ? { kind: 'ready', status: issue.status, issue } : { kind: 'missing' });
        } catch (error) { report(item, { kind: 'error', error }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  }

export async function submitOnce({ c, bug, body, api, get, set, prepareBody }) {
    const key = cacheKey(c, bug.BugId);
    const record = get(key, null);
    if (record?.id) {
      const r = await api('GET', `/api/issues/${encodeURIComponent(record.id)}`);
      if (r.status === 200 && owns(r.data, bug.BugId)) return { issue: r.data, existing: true };
      throw Error('已有本地关联，但任务暂时无法核验；请检查权限、归档或标题修改，已停止重复创建');
    }
    const hit = await findExisting(api, bug.BugId);
    if (hit) { set(key, { id: hit.id }); return { issue: hit, existing: true }; }
    if (record?.pending) throw Error('上次提交结果未确认，当前搜索仍未找到任务。请在 Multica 人工核对；脚本不会自动再次创建。');
    if (prepareBody) body = await prepareBody(body);
    set(key, { pending: true, time: new Date().toISOString() });
    // 请求超时/断网/5xx时保留 pending，下一次只核验，不盲目重试。
    const r = await api('POST', '/api/issues', body);
    let issue;
    if (r.status === 201 && owns(r.data, bug.BugId) && r.data.id) issue = r.data;
    else if (r.status === 409 && r.data?.code === 'active_duplicate_issue' && r.data.issue?.id && owns(r.data.issue, bug.BugId)) issue = r.data.issue;
    else {
      if ([400, 401, 403, 404, 422, 429].includes(r.status)) set(key, null);
      throw Error(`创建未确认（HTTP ${r.status}）：${String(r.data?.error || '请在 Multica 核对后处理').slice(0, 250)}`);
    }
    set(key, { id: issue.id });
    return { issue, existing: r.status === 409 };
  }

export function issueHasSource(issue, mark) {
    return typeof issue?.title === 'string' && (issue.title.includes(mark) ||
      (typeof issue.description === 'string' && issue.description.includes(mark)));
  }

export async function submitDraftOnce({ c, draft, body, api, get, set, prepareBody }) {
    if (!draft?.sourceKey) throw Error('缺少稳定来源键，不能执行自动查重创建');
    const mark = sourceMarker(draft.sourceKey);
    if (!issueHasSource(body, mark)) throw Error('标题或描述缺少来源标记，无法可靠查重；请在信息捕获中重新生成');
    const key = `task-source:${VERSION}:${c.api}:${c.workspace}:${draft.sourceKey}`;
    const saved = get(key, null);
    if (saved?.id) {
      const response = await api('GET', `/api/issues/${encodeURIComponent(saved.id)}`);
      if (response.status === 200 && issueHasSource(response.data, mark)) return { issue: response.data, existing: true };
      throw Error('本地关联任务无法核验；已停止重复创建');
    }
    for (let offset = 0; offset < 5000; offset += 50) {
      const path = `/api/issues/search?q=${encodeURIComponent(mark)}&include_closed=true&limit=50&offset=${offset}`;
      const response = await api('GET', path);
      if (response.status !== 200 || !Array.isArray(response.data?.issues)) throw Error('查询已有任务失败；已停止创建以防重复');
      const found = response.data.issues.find(issue => issue.id && issueHasSource(issue, mark));
      if (found) { set(key, { id: found.id }); return { issue: found, existing: true }; }
      if (response.data.issues.length < 50) break;
      if (offset === 4950) throw Error('搜索结果过多，无法确认是否重复；请人工核对');
    }
    if (saved?.pending) throw Error('上次提交结果未确认；请先在 Multica 核对，脚本不会自动重发');
    const prepared = prepareBody ? await prepareBody(body) : body;
    set(key, { pending: true, time: new Date().toISOString() });
    const response = await api('POST', '/api/issues', prepared);
    let issue;
    if (response.status === 201 && response.data?.id && issueHasSource(response.data, mark)) issue = response.data;
    else if (response.status === 409 && response.data?.code === 'active_duplicate_issue' &&
      response.data.issue?.id && issueHasSource(response.data.issue, mark)) issue = response.data.issue;
    else {
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) set(key, null);
      throw Error(`创建未确认（HTTP ${response.status}）：${String(response.data?.error || '请在 Multica 核对后处理').slice(0, 250)}`);
    }
    set(key, { id: issue.id });
    return { issue, existing: response.status === 409 };
  }

export async function submitManualOnce({ c, draft, body, api, get, set, prepareBody }) {
    if (!draft?.draftId || draft.sourceKey) throw Error('手动草稿缺少本次捕获标识');
    const key = `task-manual:${VERSION}:${c.api}:${c.workspace}:${draft.draftId}`;
    const saved = get(key, null);
    if (saved?.id) {
      const response = await api('GET', `/api/issues/${encodeURIComponent(saved.id)}`);
      if (response.status === 200 && response.data?.id === saved.id) return { issue: response.data, existing: true };
      throw Error('本次手动草稿的已提交任务暂时无法核验；已停止重复创建');
    }
    if (saved?.pending) throw Error('本次手动草稿的提交结果未确认；请先在 Multica 核对');
    const prepared = prepareBody ? await prepareBody(body) : body;
    set(key, { pending: true, time: new Date().toISOString() });
    const response = await api('POST', '/api/issues', prepared);
    if (response.status !== 201 || !response.data?.id) {
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) set(key, null);
      throw Error(`创建未确认（HTTP ${response.status}）；请在 Multica 核对后再操作`);
    }
    set(key, { id: response.data.id });
    return { issue: response.data, existing: false };
  }

export function submitTaskOnce(options) {
    if(options.draft.legacyBug) {
      if(!owns(options.body,options.draft.legacyBug.BugId)) throw Error('任务标题缺少 BugDone 查重标记，请在信息捕获中重新生成');
      return submitOnce({...options,bug:options.draft.legacyBug});
    }
    return options.draft.sourceKey ? submitDraftOnce(options) : submitManualOnce(options);
  }

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = require('./helpers/source.cjs').source;
const core = require('../.generated/test-core.cjs');
const start = source.indexOf('  function configuredShareUrl(');
const end = source.indexOf('  function description(', start);
const share = new Function('profileShareUrl', `${source.slice(start,end)}\nreturn configuredShareUrl;`)(core.profileShareUrl);

test('BugDone 列表缺少 ProjectId 时跳过可选分享链接，不中断页面启动',()=>{
 const [bug] = core.parseResponse({Result:1,ReturnObj:{ItemList:[{BugId:'a'.repeat(32),BugCode:42,BugTitle:'合成列表摘要'}]}});
 assert.ok(bug);assert.equal(bug.ProjectId,'');
 assert.equal(share(bug,core.BUGDONE_PROFILE),'');
 assert.equal(share({...bug,ProjectId:'b'.repeat(32)},core.BUGDONE_PROFILE),`https://www.bugdone.cn/cn/bugPreview/${'b'.repeat(32)}/${'a'.repeat(32)}`);
});

test('可选分享模板缺少编号时不阻止已有身份的任务草稿生成',()=>{
 const profile={...core.BUGDONE_PROFILE,links:{shareTemplate:'https://www.bugdone.cn/preview/{{number}}'}};
 const draft=core.buildCapturedDraft({siteId:'bugdone',scopeId:'b'.repeat(32),recordId:'a'.repeat(32),title:'合成摘要',detail:false},
 {...profile,draft:{titleTemplate:'[BugDone:{{recordId}}] {{title}}'}});
 assert.match(draft.title,/合成摘要/);assert.doesNotMatch(draft.description,/只读分享/);
});

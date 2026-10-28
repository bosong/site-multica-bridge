const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=require('./helpers/source.cjs').source;
const core=require('../.generated/test-core.cjs');
const project='a'.repeat(32),bug='b'.repeat(32),raw={ProjectId:null,BugId:bug,BugCode:42,BugTitle:'合成：登录提示异常',Description:'',ProjectName:'演示项目',StrPriority:'中',StrBugStatus:'待处理'};
for(const path of [`/cn/bugManagement_${project}`,`/cn/bugManagement/bug-all/${project}/all`])test('缺少项目ID的BugDone列表可从匹配页面补全，预览包含来源和内容 '+path,()=>{
 const url='https://www.bugdone.cn'+path;
 const [item]=core.parseResponse({Result:1,ReturnObj:{ItemList:[raw]}},core.BUGDONE_PROFILE,{sourceUrl:url});
 assert.equal(item.captureRecord?.scopeId,project);assert.equal(item.ProjectId,project);
 const draft=core.buildCapturedDraft(item.captureRecord,core.BUGDONE_PROFILE);
 assert.match(draft.description,/来源：https:\/\/www\.bugdone\.cn\/cn\/bugManagement/);
 assert.match(draft.description,/任务要求：\n合成：登录提示异常/);assert.match(draft.description,/项目：演示项目/);
 assert.match(draft.description,new RegExp(`/bugPreview/${project}/${bug}`));assert.equal(draft.detail,false);
});
test('页面补全仅用于缺失项目ID、有效匹配页面，不能跨域或覆盖已有项目',()=>{
 for(const sourceUrl of [`https://evil.test/cn/bugManagement_${project}`,'https://www.bugdone.cn/cn/projects'])
 assert.equal(core.normalizeCapturedRecord(core.BUGDONE_PROFILE,raw,{sourceUrl}),null);
 assert.equal(core.normalizeCapturedRecord(core.BUGDONE_PROFILE,{...raw,ProjectId:'c'.repeat(32)},{sourceUrl:`https://www.bugdone.cn/cn/bugManagement_${project}`}).scopeId,'c'.repeat(32));
});

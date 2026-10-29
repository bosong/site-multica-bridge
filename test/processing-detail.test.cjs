const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=require('./helpers/source.cjs').source;
const core=require('../.generated/test-core.cjs');
test('新记录优先打开已保存详情链接，来源URL只接受无凭据HTTPS',()=>{
 assert.equal(typeof core.submittedSourceUrl,'function');
 assert.equal(core.submittedSourceUrl({detailUrl:'https://github.com/example/demo/issues/42',sourceUrl:'https://github.com/example/demo/issues'}),'https://github.com/example/demo/issues/42');
 assert.equal(core.submittedSourceUrl({sourceUrl:'https://docs.example.test/page#part'}),'https://docs.example.test/page#part');
 for(const sourceUrl of ['javascript:alert(1)','http://example.test/','https://user:secret@example.test/'])assert.equal(core.submittedSourceUrl({sourceUrl}),'');
});
test('旧的三个内置站点记录可从来源键恢复详情；只有BugId不能猜项目',()=>{
 assert.equal(typeof core.submittedSourceUrl,'function');
 const project='a'.repeat(32),bug='b'.repeat(32),app='c'.repeat(24);
 assert.equal(core.submittedSourceUrl({sourceKey:`bugdone:${project}:${bug}`}),`https://www.bugdone.cn/cn/bugPreview/${project}/${bug}`);
 assert.equal(core.submittedSourceUrl({sourceKey:`umeng-apm-crash:${app}:11613641330154`}),`https://apm.umeng.com/platform/${app}/error_analysis/crash/detail/11613641330154`);
 assert.equal(core.submittedSourceUrl({sourceKey:'github-issues:example%2Fdemo:42'}),'https://github.com/example/demo/issues/42');
 assert.equal(core.submittedSourceUrl({bugId:bug,project:'123'}),'');
 assert.equal(core.submittedSourceUrl({sourceKey:'github-issues:evil%2F..%2Fx:42'}),'');
});
test('BugDone草稿保存只读详情链接，而不是Bug列表入口；手动草稿保留原页面',()=>{
 assert.equal(typeof core.draftSourceDetailUrl,'function');const scopeId='a'.repeat(32),recordId='b'.repeat(32);
 assert.equal(core.draftSourceDetailUrl({siteId:'bugdone',scopeId,recordId,profile:core.BUGDONE_PROFILE,sourceUrl:`https://www.bugdone.cn/cn/bugManagement_${scopeId}`}),`https://www.bugdone.cn/cn/bugPreview/${scopeId}/${recordId}`);
 assert.equal(core.draftSourceDetailUrl({siteId:'manual',sourceUrl:'https://docs.example.test/page'}),'https://docs.example.test/page');
});
test('提交记录实际持久化原来源和详情链接，供刷新后快捷跳转',()=>{
 const start=source.indexOf('  function rememberSubmittedDraft('),end=source.indexOf('  function forgetSubmitted(',start);
 const result=new Function('draftSourceDetailUrl',`let submittedBugs=[],processingRefreshAt=1;const writeValue=()=>{},debug=()=>{};${source.slice(start,end)}return rememberSubmittedDraft({siteId:'manual',draftId:'draft',title:'演示任务',sourceUrl:'https://docs.example.test/page'},{id:'task-42'},{api:'https://api.multica.ai',workspace:'workspace'});`)(core.draftSourceDetailUrl);
 assert.equal(result.sourceUrl,'https://docs.example.test/page');assert.equal(result.detailUrl,'https://docs.example.test/page');
});

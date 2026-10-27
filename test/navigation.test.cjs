const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../bugdone-multica.user.js'),'utf8');
const core=new Function('return '+source.slice(source.indexOf('(() => {'),source.indexOf('  // 调试桩：'))+'return {installRouteHooks:typeof installRouteHooks===\'function\'?installRouteHooks:null,installCaptureHooks,matchSiteCapture,UMENG_PROFILE,applyUmengCapture,createUmengCaptureState};})();')();

// Regression: deferring route detection until a timer loses the first XHR after redirect.
test('友盟站内自动跳转后立即发出的列表请求也进入捕获状态',()=>{
 assert.equal(typeof core.installRouteHooks,'function');
 const page=new EventTarget();page.location={href:'https://apm.umeng.com/platform/aaaaaaaaaaaaaaaaaaaaaaaa/error_analysis'};
 page.history={pushState(_s,_t,url){page.location.href=new URL(url,page.location.href).href;return 'push-result';},replaceState(_s,_t,url){page.location.href=new URL(url,page.location.href).href;return 'replace-result';}};
 class XHR extends EventTarget{open(){}send(){this.status=200;this.responseText=JSON.stringify({code:200,data:{list:[{id:'11613641330154',summary:'合成崩溃'}]}});this.dispatchEvent(new Event('load'));}}
 page.XMLHttpRequest=XHR;
 const profile={...core.UMENG_PROFILE,enabled:true};
 const state=core.createUmengCaptureState();let hooks;
 const stop=core.installRouteHooks(page,()=>{hooks?.stop();hooks=core.installCaptureHooks(page,(text,meta)=>core.applyUmengCapture(state,text,meta),(url,method)=>core.matchSiteCapture(profile,{url,method}));});
 assert.equal(page.history.replaceState({},'', '/platform/aaaaaaaaaaaaaaaaaaaaaaaa/error_analysis/crash'),'replace-result');
 const xhr=new page.XMLHttpRequest();xhr.open('POST','/hsf/analysis/errorList');xhr.send(JSON.stringify({dataSourceId:'aaaaaaaaaaaaaaaaaaaaaaaa'}));
 assert.equal(state.records.size,1);
 assert.equal([...state.records.values()][0].title,'合成崩溃');
 stop();hooks.stop();
});

test('路由观察保持历史调用语义，同 URL 不重启监听，卸载后不干预源站',()=>{
 assert.equal(typeof core.installRouteHooks,'function');
 const page=new EventTarget();page.location={href:'https://example.test/one'};
 const push=function(_s,_t,path){if(path==='fail')throw Error('source failure');page.location.href=new URL(path,page.location.href).href;return 42;};
 page.history={pushState:push,replaceState:push};let changes=0;
 const stop=core.installRouteHooks(page,()=>{changes++;});
 assert.equal(page.history.pushState({},'','/one'),42);assert.equal(changes,0);
 assert.equal(page.history.pushState({},'','/two'),42);assert.equal(changes,1);
 assert.throws(()=>page.history.pushState({},'','fail'),/source failure/);assert.equal(changes,1);
 page.dispatchEvent(new Event('popstate'));assert.equal(changes,2);
 stop();assert.equal(page.history.pushState,push);page.dispatchEvent(new Event('popstate'));assert.equal(changes,2);
});

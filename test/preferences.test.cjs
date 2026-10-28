const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../bugdone-multica.user.js'),'utf8');
const core=new Function('return '+source.slice(source.indexOf('(() => {'),source.indexOf('  // 调试桩：'))+'return {validateStoredConfig,restorePreferenceDefaults:typeof restorePreferenceDefaults===\'function\'?restorePreferenceDefaults:null};})();')();
test('恢复偏好保留连接与捕获启用状态，任务和UI恢复首次默认值',()=>{
 assert.equal(typeof core.restorePreferenceDefaults,'function');
 const saved={api:'https://self.example.test',token:'synthetic-token',workspace:'old',project:'old',defaultAgent:'old',agent:'old',label:'old',hideNativeAI:false,displayMode:'sidebar',entryVisibility:'all',shortcut:'Alt+M',shortcutCustomized:true,umengCaptureEnabled:false,projectCustomized:true,defaultAgentCustomized:true};
 const result=core.restorePreferenceDefaults(saved,[{id:'first',name:'首工作区'}],{projects:[{id:'project-first',name:'首项目'}],agents:[{id:'archived',is_archived:true},{id:'agent-first'}]});
 assert.equal(result.api,saved.api);assert.equal(result.token,saved.token);assert.equal(result.umengCaptureEnabled,false);
 assert.equal(result.workspace,'first');assert.equal(result.project,'project-first');assert.equal(result.defaultAgent,'agent-first');assert.equal(result.agent,'agent-first');assert.equal(result.label,'');
 assert.equal(result.displayMode,'floating');assert.equal(result.entryVisibility,'configured');assert.equal(result.hideNativeAI,true);assert.equal(result.shortcut,'Ctrl+Shift+M');
 for(const key of ['shortcutCustomized','projectCustomized','defaultAgentCustomized'])assert.equal(result[key],false);
 assert.equal(saved.workspace,'old');
});
test('没有目录时恢复为空，保留连接等待手动连接选首项',()=>{
 assert.equal(typeof core.restorePreferenceDefaults,'function');
 const result=core.restorePreferenceDefaults({api:'https://api.multica.ai',token:''});
 for(const key of ['workspace','project','defaultAgent','agent','label'])assert.equal(result[key],'');
 assert.equal(result.api,'https://api.multica.ai');assert.equal(result.token,'');
});
test('取消统一保存，头部提供恢复按钮和保存状态；基础输入不再触发自动连接',()=>{
 assert.doesNotMatch(source,/id="save" data-action>保存设置/);
 assert.match(source,/id="reset-preferences"/);assert.match(source,/id="settings-save-state"/);
 const start=source.indexOf("$('token').addEventListener('input'");const end=source.indexOf("$('workspace').addEventListener",start);
 assert.ok(start>0);assert.doesNotMatch(source.slice(start,end),/connectIfNeeded/);
});

const persistSource=source.slice(source.indexOf('  function persistConfig('),source.indexOf('  function persistConnectionSettings('));
test('自动保存失败或降级到页面内存时不显示持久保存成功',()=>{
 const state={textContent:'',dataset:{}};
 const make=(writeValue,mode)=>new Function('writeValue','state','storageMode',`const root={},$=()=>state;${persistSource}return persistConfig;`)(writeValue,state,mode);
 make(()=>{},'页面内存缓存')({token:''});assert.equal(state.textContent,'仅保存在当前页面');assert.equal(state.dataset.kind,'warning');
 assert.throws(()=>make(()=>{throw Error('denied');},'')({token:''}),/denied/);assert.equal(state.dataset.kind,'error');
});
test('清空令牌也会保存，切换服务会清理旧工作区选项而不重置UI偏好',()=>{
 const elements={api:{value:'https://api.multica.ai'},token:{value:''}},saved=[];
 const connectionSource=source.slice(source.indexOf('  function persistConnectionSettings('),source.indexOf('  async function bugDoneForm('));
 const save=new Function('validateStoredConfig','elements','writeValue',`const root=null,$=id=>elements[id],setConnectionPhase=()=>{};let config={api:'https://self.example.test',token:'old',workspace:'old',project:'old',label:'old',displayMode:'sidebar'};${persistSource}${connectionSource}return persistConnectionSettings;`)(core.validateStoredConfig,elements,(key,value)=>saved.push(value));
 save();assert.equal(saved.at(-1).token,'');assert.equal(saved.at(-1).api,'https://api.multica.ai');assert.equal(saved.at(-1).workspace,'');assert.equal(saved.at(-1).project,'');assert.equal(saved.at(-1).label,'');assert.equal(saved.at(-1).displayMode,'sidebar');
});
test('清空默认工作区也会立即保存，并清除依赖它的默认选项',async()=>{
 const start=source.indexOf("    $('workspace').addEventListener('change'"),end=source.indexOf("    for (const id of ['default-project', 'default-label'])",start);
 const saved=[],elements={workspace:{value:'',selectedOptions:[]},api:{value:'https://api.multica.ai'},token:{value:''}};let handler;
 for(const element of Object.values(elements))element.addEventListener=(_,fn)=>{handler=fn;};
 new Function('elements','run','persistConfig',`const $=id=>elements[id];let config={workspace:'old',project:'old',label:'old'};const fillSelect=()=>{},renderAgentChoices=()=>{},message=()=>{};${source.slice(start,end)}`)(elements,fn=>fn(),next=>saved.push({...next}));
 await handler();assert.equal(saved.at(-1)?.workspace,'');assert.equal(saved.at(-1)?.project,'');assert.equal(saved.at(-1)?.label,'');
});

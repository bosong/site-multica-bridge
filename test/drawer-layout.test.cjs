const {test}=require('node:test');const assert=require('node:assert/strict');
class Style {
 constructor(){this.values=new Map();this.priorities=new Map();}
 setProperty(k,v,p=''){this.values.set(k,String(v));this.priorities.set(k,p);}
 getPropertyValue(k){return this.values.get(k)||'';}
 getPropertyPriority(k){return this.priorities.get(k)||'';}
 removeProperty(k){const v=this.getPropertyValue(k);this.values.delete(k);this.priorities.delete(k);return v;}
 get width(){return this.getPropertyValue('width');}set width(v){this.setProperty('width',v);}
 get transition(){return this.getPropertyValue('transition');}set transition(v){this.setProperty('transition',v);}
}
function fixture(){
 const timers=new Map();let seq=0;const window={innerWidth:2000,matchMedia:()=>({matches:false})};
 const html={style:new Style(),dataset:{},getBoundingClientRect(){const w=this.style.width;return{width:w.startsWith('calc(')?window.innerWidth-520:parseFloat(w)||window.innerWidth};}};
 const target={style:new Style()};const style={textContent:''};const document={documentElement:html,querySelectorAll:s=>s==='#root'?[target]:[],getElementById:()=>style};
 window.getComputedStyle=el=>el===target?{paddingLeft:target.style.getPropertyValue('padding-left')||`${window.innerWidth-html.getBoundingClientRect().width}px`}:{};
 const setTimeout=fn=>{timers.set(++seq,fn);return seq;},clearTimeout=id=>timers.delete(id);
 const flush=()=>{const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();};
 return{window,document,html,target,style,setTimeout,clearTimeout,flush};
}
async function layout(f){
 const {createPageLayout}=await import('../src/ui/page-layout.js');
 return createPageLayout({...f,getPresentation:()=>({drawerPaddingSelectors:['#root']})});
}
test('友盟滚动条补偿不会把抽屉宽度误算为左内边距',async()=>{
 const f=fixture(),controller=await layout(f);controller.sync(true,'sidebar');
 assert.equal(f.window.getComputedStyle(f.target).paddingLeft,'0px');
 assert.equal(f.html.getBoundingClientRect().width,1480);
});

test('关闭完成后还原原始内联值及优先级，不永久清零内边距',async()=>{
 const f=fixture();f.target.style.setProperty('padding-left','12px','important');f.html.style.setProperty('transition','color 1s','important');
 const c=await layout(f);c.sync(true);assert.equal(f.target.style.getPropertyValue('padding-left'),'12px');
 c.sync(false);assert.equal(f.target.style.getPropertyValue('padding-left'),'12px');f.flush();
 assert.equal(f.html.style.width,'');assert.equal(f.html.style.transition,'color 1s');assert.equal(f.html.style.getPropertyPriority('transition'),'important');
 assert.equal(f.target.style.getPropertyValue('padding-left'),'12px');assert.equal(f.target.style.getPropertyPriority('padding-left'),'important');assert.equal(f.html.dataset.bugdoneMulticaDrawerOpen,undefined);
});
test('连续开关不被旧关闭定时器还原，窗口变宽后重新计算',async()=>{
 const f=fixture(),c=await layout(f);c.sync(true);c.sync(false);c.sync(true);f.flush();
 assert.equal(f.html.style.width,'1480px');assert.equal(f.target.style.getPropertyValue('padding-left'),'0px');
 f.window.innerWidth=2200;c.sync(true);assert.equal(f.html.style.width,'1680px');
 c.sync(false);f.flush();assert.equal(f.html.style.width,'');assert.equal(f.target.style.getPropertyValue('padding-left'),'');
});
test('减少动态效果时立即还原，浮窗和移动视口不挤压页面',async()=>{
 const f=fixture();f.window.matchMedia=()=>({matches:true});const c=await layout(f);
 c.sync(true,'floating');assert.equal(f.html.style.width,'');
 f.window.innerWidth=700;c.sync(true);assert.equal(f.html.style.width,'');
 f.window.innerWidth=2000;c.sync(true);assert.match(f.html.style.transition,/width 0ms/);c.sync(false);
 assert.equal(f.html.style.width,'');assert.equal(f.target.style.getPropertyValue('padding-left'),'');
});
test('旧内置覆盖继承布局修复，显式空数组允许关闭；配置拒绝复杂选择器',async()=>{
 const {resolveDrawerPresentation}=await import('../src/ui/page-layout.js');const {UMENG_PROFILE}=await import('../src/sites/builtins.js');const {validateSiteProfile}=await import('../src/capture/profiles.js');
 const valid=validateSiteProfile(UMENG_PROFILE);assert.deepEqual(valid.presentation.drawerPaddingSelectors,['#root']);
 assert.deepEqual(resolveDrawerPresentation({id:valid.id,presentation:{recordLabel:'旧配置'}},[valid]).drawerPaddingSelectors,['#root']);
 assert.deepEqual(resolveDrawerPresentation({id:valid.id,presentation:{drawerPaddingSelectors:[]}},[valid]).drawerPaddingSelectors,[]);
 assert.throws(()=>validateSiteProfile({...valid,presentation:{drawerPaddingSelectors:['body #root']}}),/布局选择器/);
});
test('HTML 存在边框或内边距时按 CSS 宽度计算，不把外框宽度重复加进去',async()=>{
 const f=fixture(),oldComputed=f.window.getComputedStyle;f.html.getBoundingClientRect=()=>({width:(parseFloat(f.html.style.width)||1900)+100});
 f.window.getComputedStyle=el=>el===f.html?{width:f.html.style.width||'1900px'}:oldComputed(el);
 const c=await layout(f);c.sync(true);assert.equal(f.html.style.width,'1380px');c.sync(false);f.flush();assert.equal(f.html.style.width,'');
});
test('document-start 时根节点未建立不会阻止后续抽屉启动',async()=>{
 const f=fixture();f.document.documentElement=null;const c=await layout(f);assert.doesNotThrow(()=>c.sync(true));
 f.document.documentElement=f.html;c.sync(true);assert.equal(f.html.style.width,'1480px');c.sync(false);f.flush();assert.equal(f.html.style.width,'');
});
test('原本较窄的 HTML 已能让出空间时，不再额外减去一次抽屉宽度',async()=>{
 const f=fixture();f.html.style.width='900px';const c=await layout(f);c.sync(true);assert.equal(f.html.style.width,'900px');c.sync(false);f.flush();assert.equal(f.html.style.width,'900px');
});
test('有占位滚动条时按布局视口让出空间，避免重叠滚动条宽度',async()=>{
 const f=fixture();f.html.clientWidth=1980;f.html.getBoundingClientRect=()=>({width:parseFloat(f.html.style.width)||1980});const c=await layout(f);c.sync(true);assert.equal(f.html.style.width,'1460px');
});

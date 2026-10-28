const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../bugdone-multica.user.js'),'utf8');
const core=new Function('return '+source.slice(source.indexOf('(() => {'),source.indexOf('  // 调试桩：'))+'return {fitLaunchPosition:typeof fitLaunchPosition===\'function\'?fitLaunchPosition:null};})();')();

test('旧大屏坐标按当前按钮尺寸收回小窗口内，完整保留入口可点击区域',()=>{
 assert.equal(typeof core.fitLaunchPosition,'function');
 assert.deepEqual(core.fitLaunchPosition({left:1751,top:938},{width:134,height:87},{left:0,top:0,width:1200,height:800}),{left:1058,top:705});
 assert.deepEqual(core.fitLaunchPosition({left:100,top:200},{width:200,height:44},{left:0,top:0,width:1200,height:800}),{left:100,top:200});
});

test('入口边界兼容负坐标、极小窗口及缩放后的可视区域偏移',()=>{
 assert.equal(typeof core.fitLaunchPosition,'function');
 assert.deepEqual(core.fitLaunchPosition({left:-40,top:-10},{width:134,height:87},{left:0,top:0,width:1200,height:800}),{left:8,top:8});
 assert.deepEqual(core.fitLaunchPosition({left:1751,top:938},{width:134,height:87},{left:0,top:0,width:100,height:60}),{left:0,top:0});
 assert.deepEqual(core.fitLaunchPosition({left:20,top:20},{width:134,height:87},{left:100,top:50,width:500,height:400}),{left:108,top:58});
});

test('实际入口事件在恢复坐标和窗口缩小时校正位置，状态文字变宽后继续保持可见',()=>{
 const start=source.indexOf("    const launch = $('launch');",source.indexOf('  function mount()'));
 const end=source.indexOf("    $('panel').addEventListener('keydown'",start);
 const window=new EventTarget();window.innerWidth=1200;window.innerHeight=800;window.visualViewport=new EventTarget();
 Object.assign(window.visualViewport,{width:1200,height:800,offsetLeft:0,offsetTop:0});
 let observerCallback;class ResizeObserver{constructor(fn){observerCallback=fn;}observe(){}}
 const launch=new EventTarget();Object.assign(launch,{style:{},offsetWidth:134,offsetHeight:87,getAttribute:()=> 'false',getBoundingClientRect(){const left=parseFloat(this.style.left)||0,top=parseFloat(this.style.top)||0;return{left,top,right:left+this.offsetWidth,bottom:top+this.offsetHeight,width:this.offsetWidth,height:this.offsetHeight};}});
 const panel=new EventTarget(),close=new EventTarget(),writes=[];
 const $=id=>({launch,panel,close})[id];
 new Function('$','window','fitLaunchPosition','writeValue','syncPageLayout','debug','ResizeObserver',`let launchPosition={left:1751,top:938};${source.slice(start,end)}`)($,window,core.fitLaunchPosition,(key,value)=>writes.push([key,value]),()=>{},()=>{},ResizeObserver);
 assert.equal(launch.style.left,'1058px');assert.equal(launch.style.top,'705px');
 window.innerWidth=800;window.innerHeight=600;Object.assign(window.visualViewport,{width:800,height:600});window.dispatchEvent(new Event('resize'));
 assert.equal(launch.style.left,'658px');assert.equal(launch.style.top,'505px');
 launch.offsetWidth=220;launch.offsetHeight=44;observerCallback();
 assert.equal(launch.style.left,'572px');assert.equal(launch.style.top,'505px');
 assert.deepEqual(writes.at(-1),['launchPosition',{left:572,top:505}]);
});

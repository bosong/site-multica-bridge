const {test}=require('node:test');
const assert=require('node:assert/strict');
test('drawer handle appears only after opening, retains close/reopen state and resets on navigation',async()=>{
 const {createDrawerHandle}=await import('../src/ui/drawer-handle.js');
 const button={hidden:true,dataset:{},setAttribute(name,value){this[name]=value;}};
 const handle=createDrawerHandle(button);
 const base={mode:'sidebar',allowed:true,page:'https://example.test/a',open:false};
 handle.sync(base);assert.equal(button.hidden,true);
 handle.sync({...base,open:true});assert.equal(button.hidden,false);assert.equal(button['aria-expanded'],'true');assert.equal(button.title,'收起工作台');
 handle.sync(base);assert.equal(button.hidden,false);assert.equal(button['aria-expanded'],'false');assert.equal(button.title,'展开工作台');
 handle.sync({...base,enabled:false});assert.equal(button.hidden,true);
 handle.sync({...base,enabled:true});assert.equal(button.hidden,false);
 handle.sync({...base,mode:'floating'});assert.equal(button.hidden,true);
 handle.sync({...base,allowed:false});assert.equal(button.hidden,true);
 handle.sync({...base,page:'https://example.test/b'});assert.equal(button.hidden,true);
});

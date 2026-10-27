import fs from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
const REPO = process.env.HELIUM_REPO || new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const DIR = process.env.ARTIFACT_DIR || REPO + '/build/nested-tabs-tests/extended';
fs.mkdirSync(DIR, {recursive: true});
const PROFILE=DIR+'/profile', BIN=process.env.HELIUM_BINARY || REPO+'/build/src/out/Default/helium';
const FLAKE=process.env.HELIUM_FLAKE || REPO+'/../helium';
const XDO=process.env.XDOTOOL || 'xdotool';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const results={cases:[],notes:['Nested collections are represented by extra unpinnedTabCollection nodes; Mojo does not expose collapse.'],started:new Date().toISOString()};
let xv,browser,inspector,settings;const sockets=[];
function save(){fs.writeFileSync(DIR+'/results.json',JSON.stringify(results,null,2));}
async function connect(url, timeoutMs = 8000) {
  const ws = new WebSocket(url);
  sockets.push(ws);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
  };
  return async (method, params = {}) => {
    const requestId = ++id;
    let timer;
    try {
      const response = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('CDP timeout ' + method)), timeoutMs);
        pending.set(requestId, resolve);
        ws.send(JSON.stringify({id: requestId, method, params}));
      });
      if (response.error) throw new Error(JSON.stringify(response.error));
      return response.result;
    } finally {
      clearTimeout(timer);
      pending.delete(requestId);
    }
  };
}
async function targets(){return await(await fetch('http://127.0.0.1:9336/json/list')).json()}
async function evalOn(t,expression,timeoutMs=8000){const c=await connect(t.webSocketDebuggerUrl,timeoutMs);try{const v=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value}finally{sockets.at(-1)?.close()}}
async function newTab(url){return await(await fetch('http://127.0.0.1:9336/json/new?'+encodeURIComponent(url),{method:'PUT'})).json()}
async function activate(t){await fetch('http://127.0.0.1:9336/json/activate/'+t.id);await delay(200)}
function xdo(...args){results.lastAction={kind:'xdotool',args,time:new Date().toISOString()};save();execFileSync(XDO,args,{env:{...process.env,DISPLAY:':98'}})}
async function shot(name){execFileSync('import',['-display',':98','-window','root',DIR+'/'+name+'.png'])}
function normalize(n){const k=Object.keys(n.data)[0],d=n.data[k];return k==='tab'?{title:d.title,url:d.url,active:d.active,selected:d.selected}:{type:k,children:n.children.map(normalize)}}
async function snap(name){const raw=await evalOn(inspector,`(async()=>{const m=await import('./tab_strip_internals_api_proxy.js');return JSON.parse(JSON.stringify(await m.TabStripInternalsApiProxyImpl.getInstance().getTabStripData(),(k,v)=>typeof v==='bigint'?v.toString():v))})()`);fs.writeFileSync(DIR+'/'+name+'.json',JSON.stringify(raw,null,2));const tree=raw.data.tabstripTree.windows.map(w=>normalize(w.tabstripModel.root));await shot(name);results.snapshots??={};results.snapshots[name]=tree;save();return tree;}
function assert(v,msg){if(!v)throw Error(msg)}
async function test(name,fn){if(process.env.FILTER&&!new RegExp(process.env.FILTER).test(name))return;try{const details=await fn();results.cases.push({name,status:'pass',details})}catch(e){results.cases.push({name,status:'fail',error:e.message||e.constructor?.name||String(e),lastAction:results.lastAction})}save()}
async function start(initial=false){const log=fs.openSync(DIR+'/browser.log','a');const args=[BIN,'--ozone-platform=x11','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--password-store=basic','--remote-debugging-port=9336','--window-size=1280,900','--user-data-dir='+PROFILE,...(initial?['file://'+DIR+'/A.html']:[])];browser=spawn('nix',['run',FLAKE+'#browser-env','--','-c','export DISPLAY=:98; unset WAYLAND_DISPLAY; '+args.map(s=>"'"+s.replaceAll("'","'\\''")+"'").join(' ')],{env:{...process.env,DISPLAY:':98'},stdio:['ignore',log,log]});for(let i=0;i<90;i++){try{await targets();await delay(700);return}catch{}await delay(500)}throw Error('Browser startup failed')}
async function stop(){if(!browser)return;for(const s of sockets)s.close();const v=await(await fetch('http://127.0.0.1:9336/json/version')).json();const c=await connect(v.webSocketDebuggerUrl);await c('Browser.close').catch(()=>{});for(let i=0;i<40;i++){try{await targets()}catch{browser=undefined;return}await delay(250)}throw Error('Browser did not exit gracefully')}
async function pref(key,value){return evalOn(settings,`new Promise(r=>chrome.settingsPrivate.setPref(${JSON.stringify(key)},${JSON.stringify(value)},'',()=>chrome.settingsPrivate.getPref(${JSON.stringify(key)},r)))`)}
async function local(name){return(await targets()).find(t=>t.url==='file://'+DIR+'/'+name+'.html')}
async function openChild(from,to){const t=await local(from);await activate(t);await evalOn(t,`document.querySelector('#${to}').click()`);await delay(600)}
function shape(tree){return JSON.stringify(tree,(k,v)=>['active','selected'].includes(k)?undefined:v)}
// Independent suite extension; all writes restricted to this scratch directory.
let bg,mainWindow,serial=0;results.settingsControls=[];
const eq=(a,b)=>assert(JSON.stringify(a)===JSON.stringify(b),'Expected '+JSON.stringify(b)+' actual '+JSON.stringify(a));
async function api(method,...args){results.lastAction={kind:'extension-api',method,args,time:new Date().toISOString()};save();return evalOn(bg,`new Promise((resolve,reject)=>{chrome.${method}(...${JSON.stringify(args)},v=>{const e=chrome.runtime.lastError;e?reject(Error(e.message)):resolve(v)})})`)}
async function allTabs(){return api('tabs.query',{})}
async function selectedFixtureTabs(){return (await allTabs()).filter(t=>t.url?.startsWith('file://'+DIR+'/')&&(t.highlighted||t.active)).map(t=>({id:t.id,active:t.active,highlighted:t.highlighted})).sort((a,b)=>a.id-b.id)}
async function ids(){const ts=await allTabs();return Object.fromEntries(ts.filter(t=>t.url?.startsWith('file://'+DIR+'/')).map(t=>[t.url.split('/').pop().replace('.html',''),t.id]))}
function fixtureShape(tree){function f(n){if(n.url)return n.url.startsWith('file://'+DIR+'/')?n.url.split('/').pop().replace('.html',''):null;const children=n.children.map(f).filter(x=>x!==null);return children.length?{type:n.type,children}:null}return tree.map(f).filter(Boolean)}
const U=(...children)=>({type:'unpinnedTabCollection',children}),P=(...children)=>({type:'pinnedTabCollection',children}),R=(...children)=>({type:'tabStripCollection',children});
async function snapshot(name){await delay(450);const t=await snap(String(++serial).padStart(2,'0')+'-'+name);return fixtureShape(t)}
async function reset(){for(const t of (await allTabs()).reverse())if(t.url?.startsWith('file://'+DIR+'/')){if((await allTabs()).some(x=>x.id===t.id))await api('tabs.remove',t.id);}await newTab('file://'+DIR+'/A.html');await delay(400);await api('tabs.move',(await ids()).A,{windowId:mainWindow,index:0});await openChild('A','B');await openChild('B','C');eq(await snapshot('fixture'),[R(U(U('A',U('B','C'))))]);return ids()}
async function uiClick(selector){return evalOn(settings,`(()=>{function find(r){let e=r.querySelector(${JSON.stringify(selector)});if(e)return e;for(const n of r.querySelectorAll('*'))if(n.shadowRoot){e=find(n.shadowRoot);if(e)return e}}const e=find(document);if(!e)throw Error('Control not found: '+${JSON.stringify(selector)});e.scrollIntoView();const b=e.getBoundingClientRect();if(!b.width||!b.height||e.hidden||e.disabled)throw Error('Control hidden/disabled');let click=e.shadowRoot?.querySelector('cr-toggle')||e;e.click();return {tag:e.tagName,rect:{x:b.x,y:b.y,width:b.width,height:b.height},html:e.outerHTML}})()`)}
async function prefValue(k){return evalOn(settings,`new Promise(r=>chrome.settingsPrivate.getPref(${JSON.stringify(k)},p=>r(p.value)))`)}
async function main(){
if(fs.existsSync('/tmp/.X98-lock'))throw Error('Display occupied');try{await targets();throw Error('Port occupied')}catch(e){if(e.message==='Port occupied')throw e}
if(fs.existsSync(PROFILE))fs.renameSync(PROFILE,PROFILE+'-'+Date.now());fs.mkdirSync(PROFILE+'/Default',{recursive:true});fs.writeFileSync(PROFILE+'/Default/Preferences',JSON.stringify({helium:{browser:{layout:2,vertical_nesting:true}},session:{restore_on_startup:1}}));fs.writeFileSync(PROFILE+'/Local State',JSON.stringify({internal_only_uis_enabled:true}));
for(const n of ['A','B','C','D'])fs.writeFileSync(DIR+'/'+n+'.html',`<!doctype html><title>PR1832 EXT ${n}</title><body style="background:#d4eaff;font:32px sans-serif"><h1>PR1832 EXT ${n}</h1>${['A','B','C','D'].map(x=>`<p><a id="${x}" target="_blank" href="${x}.html">Open ${x}</a></p>`).join('')}`);
results.desktopBefore=JSON.parse(execFileSync('hyprctl',['clients','-j']).toString());xv=spawn('Xvfb',[':98','-screen','0','1280x900x24','-nolisten','tcp'],{stdio:'ignore'});await delay(500);await start(true);inspector=await newTab('helium://tab-strip-internals');settings=await newTab('helium://settings/appearance/layout');await delay(1000);await activate(inspector);await delay(500);bg=(await targets()).find(t=>t.type==='background_page');assert(bg,'No extension background page');const readinessStart=Date.now();results.extensionReadiness=await evalOn(bg,`(async()=>{const {default:ub}=await import('./js/background.js');await ub.isReadyPromise;if(!ub.readyToFilter||!ub.supportStats.allReadyAfter)throw Error('Extension initialization incomplete');return {readyToFilter:ub.readyToFilter,allReadyAfter:ub.supportStats.allReadyAfter,url:location.href}})()`,30000);results.extensionReadiness.elapsedMs=Date.now()-readinessStart;save();mainWindow=(await allTabs()).find(t=>t.url?.endsWith('/A.html')).windowId;
const clients=JSON.parse(execFileSync('hyprctl',['clients','-j']).toString());results.isolation={display:':98',port:9336,before:results.desktopBefore.map(c=>c.address),after:clients.map(c=>c.address),newMapped:clients.filter(c=>c.mapped&&!results.desktopBefore.some(b=>b.address===c.address))};assert(!results.isolation.newMapped.length,'Unexpected mapped desktop window; abort before input');
const wid=execFileSync(XDO,['search','--onlyvisible','--class','helium'],{env:{...process.env,DISPLAY:':98'}}).toString().trim().split('\n')[0];xdo('windowmove',wid,'0','0');xdo('windowfocus',wid);await shot('isolation-root');
results.apiAvailability=await evalOn(bg,`({createSplit:typeof chrome.tabs.createSplit,createSplitView:typeof chrome.tabs.createSplitView,groups:typeof chrome.tabs.group})`);
await test('actual settings nesting toggle DOM click off/on and opener behavior',async()=>{await reset();await activate(settings);results.settingsControls=[];for(const desired of [false,true]){results.settingsControls.push(await uiClick('settings-toggle-button[pref-key="helium.browser.vertical_nesting"]'));await delay(500);eq(await prefValue('helium.browser.vertical_nesting'),desired);eq(await snapshot('ui-nesting-'+desired),[R(U(U('A',U('B','C'))))]);if(!desired){await openChild('A','D');eq(await snapshot('ui-off-opener'),[R(U(U('A',U('B','C')),'D'))]);await api('tabs.remove',(await ids()).D);await activate(settings)}}});
await test('actual layout radio click horizontal/vertical preserves owner/order',async()=>{await reset();await activate(settings);for(const value of [0,2]){results.settingsControls.push(await uiClick('controlled-radio-button[name="'+value+'"]'));await delay(500);eq(await prefValue('helium.browser.layout'),value);eq(await snapshot('ui-layout-'+value),[R(U(U('A',U('B','C'))))])}});
await test('pin nested child detaches child subtree; unpin does not invent ownership',async()=>{const i=await reset();await api('tabs.update',i.B,{pinned:true});eq(await snapshot('pin-child'),[R(P('B'),U(U('A','C')))]);await api('tabs.update',i.B,{pinned:false});eq(await snapshot('unpin-child'),[R(U('B',U('A','C')))])});
await test('pin parent preserves children as promoted tree',async()=>{const i=await reset();await api('tabs.update',i.A,{pinned:true});eq(await snapshot('pin-parent'),[R(P('A'),U(U('B','C')))]);await api('tabs.update',i.A,{pinned:false});eq(await snapshot('unpin-parent'),[R(U('A',U('B','C')))])});
await test('group whole tree and ungroup exact ownership/order',async()=>{const i=await reset();const g=await api('tabs.group',{tabIds:[i.A,i.B,i.C]});const t=await snapshot('group-tree');results.groupTreeObserved=t;eq(t,[R(U({type:'tabGroupCollection',children:[U('A',U('B','C'))]}))]);await api('tabs.ungroup',[i.A,i.B,i.C]);eq(await snapshot('ungroup-tree'),[R(U(U('A',U('B','C'))))]);return {groupId:g}});
await test('group child subtree and ungroup exact ownership/order',async()=>{const i=await reset();await api('tabs.group',{tabIds:[i.B,i.C]});eq(await snapshot('group-child'),[R(U('A',{type:'tabGroupCollection',children:[U('B','C')]}))]);await api('tabs.ungroup',[i.B,i.C]);eq(await snapshot('ungroup-child'),[R(U('A',U('B','C')))])});
await test('split nested child with its child exact structure',async()=>{const i=await reset();const split=await api('tabs.createSplit',[i.B,i.C]);const t=await snapshot('split-child');results.splitChildObserved=t;eq(t,[R(U(U('A',{type:'splitTabCollection',children:['B','C']})))]);return {split}});
await test('split parent with child exact structure',async()=>{const i=await reset();const split=await api('tabs.createSplit',[i.A,i.B]);const t=await snapshot('split-parent');results.splitParentObserved=t;eq(t,[R(U({type:'splitTabCollection',children:['A','B']},'C'))]);return {split}});
await test('move child to second window close/reopen ownership/order',async()=>{const i=await reset();const w=await api('windows.create',{url:'about:blank',focused:true});try{await api('tabs.move',i.B,{windowId:w.id,index:0});const t=await snapshot('move-child');eq(t,[R(U(U('A','C'))),R(U('B'))]);const moved=await api('tabs.get',i.B);eq(moved.windowId,w.id);await activate(await local('B'));xdo('key','ctrl+w');eq(await snapshot('second-child-closed'),[R(U(U('A','C')))]);xdo('key','ctrl+shift+t');eq(await snapshot('second-child-reopened'),[R(U(U('A','C'))),R(U('B'))])}finally{await api('windows.remove',w.id).catch(()=>{})}});
await test('move whole tree to second window close/reopen tree',async()=>{const i=await reset();const w=await api('windows.create',{url:'about:blank',focused:true});try{await api('tabs.move',[i.A,i.B,i.C],{windowId:w.id,index:0});eq(await snapshot('move-tree'),[R(U(U('A',U('B','C'))))]);const ts=await allTabs();eq(ts.filter(t=>[i.A,i.B,i.C].includes(t.id)).map(t=>t.windowId),[w.id,w.id,w.id]);await activate(await local('A'));xdo('mousemove','22','52','click','1');await delay(350);xdo('mousemove','187','52','click','1');const closed=await snapshot('second-tree-closed');eq(closed,[]);xdo('key','ctrl+shift+t');eq(await snapshot('second-tree-reopened'),[R(U(U('A',U('B','C'))))])}finally{await api('windows.remove',w.id).catch(()=>{})}});
await test('real native child drag Escape cancellation preserves exact tree/order',async()=>{await reset();await activate(await local('B'));xdo('windowfocus',wid);const before=await snapshot('drag-before');const selection=await selectedFixtureTabs();results.dragGeometry={source:{x:95,y:86},intermediate:{x:160,y:210},rowTop:36,rowHeight:34,sourceEvidence:'drag-before PNG; geometry inherited baseline native vertical rows'};xdo('mousemove','95','86','mousedown','1','sleep','0.2','mousemove','120','125','sleep','0.2','mousemove','160','210','sleep','0.6');const during=await snapshot('drag-in-progress');assert(JSON.stringify(during)!==JSON.stringify(before),'Drag did not change intermediate hierarchy; refusing a no-op pass');xdo('key','Escape','mouseup','1');eq(await snapshot('drag-cancelled'),before);eq(await selectedFixtureTabs(),selection)});
await test('leaf child moves to second window closes/reopens there',async()=>{const i=await reset();const w=await api('windows.create',{url:'about:blank',focused:true});try{await api('tabs.move',i.C,{windowId:w.id,index:0});eq(await snapshot('move-leaf'),[R(U(U('A','B'))),R(U('C'))]);await activate(await local('C'));const win=execFileSync(XDO,['search','--onlyvisible','--name','PR1832 EXT C'],{env:{...process.env,DISPLAY:':98'}}).toString().trim().split('\n')[0];xdo('windowfocus',win);xdo('key','ctrl+w');eq(await snapshot('leaf-closed'),[R(U(U('A','B')))]);xdo('key','ctrl+shift+t');eq(await snapshot('leaf-reopened'),[R(U(U('A','B'))),R(U('C'))]);eq((await api('tabs.get',(await ids()).C)).windowId,w.id)}finally{await api('windows.remove',w.id).catch(()=>{})}});
await test('minimal two-tab owner cross-window move',async()=>{const i=await reset();await api('tabs.remove',i.C);eq(await snapshot('minimal-owner-before'),[R(U(U('A','B')))]);const w=await api('windows.create',{url:'about:blank',focused:true});await api('tabs.move',i.A,{windowId:w.id,index:0});eq(await snapshot('minimal-owner-after'),[R(U('B')),R(U('A'))]);eq((await api('tabs.get',i.A)).windowId,w.id);eq((await api('tabs.get',i.B)).windowId,mainWindow)});
await test('minimal two-tab leaf drag Escape cancellation',async()=>{const i=await reset();await api('tabs.remove',i.C);await activate(await local('B'));xdo('windowfocus',wid);const before=await snapshot('minimal-drag-before');const selection=await selectedFixtureTabs();xdo('mousemove','95','86','mousedown','1','sleep','0.2','mousemove','120','125','sleep','0.2','mousemove','160','210','sleep','0.6');const during=await snapshot('minimal-drag-in-progress');assert(JSON.stringify(during)!==JSON.stringify(before),'Drag did not change intermediate hierarchy; refusing a no-op pass');xdo('key','Escape','mouseup','1');eq(await snapshot('minimal-drag-after'),before);eq(await selectedFixtureTabs(),selection)});
results.finished=new Date().toISOString();save();console.log(JSON.stringify(results.cases,null,2));}
try{await main()}catch(e){results.fatal=e.stack;save();console.error(e)}finally{try{await stop()}catch{}xv?.kill();for(const s of sockets)s.close()}

process.exitCode = results.fatal || results.cases.some(c => c.status === 'fail') ? 1 : 0;

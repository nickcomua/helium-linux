// Adapted source-defined helpers from pr1832-drag-regressions/repro.mjs
// (itself based on tests/nested-tabs/extended.mjs). No runtime source slicing/eval.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
export const DIR=process.env.ARTIFACT_DIR;
if(!DIR) throw Error('ARTIFACT_DIR required');
const PROFILE=path.join(DIR,'profile');
const BIN=process.env.HELIUM_BINARY;
if(!BIN) throw Error('HELIUM_BINARY required');
const PORT=Number(process.env.CDP_PORT||9436), UI_PORT=Number(process.env.UI_PORT||9437);
const DISPLAY=process.env.TEST_DISPLAY||':108';
if(!/^:[0-9]+$/.test(DISPLAY)||![PORT,UI_PORT].every(p=>Number.isInteger(p)&&p>1024&&p<65536)||PORT===UI_PORT) throw Error('Invalid display/ports');
const XDO=process.env.XDOTOOL||'xdotool';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const results={cases:[],notes:['Nested collections are represented by extra unpinnedTabCollection nodes; Mojo does not expose collapse.'],started:new Date().toISOString()};
let xv,browser,inspector,settings;const sockets=[];
function save(){fs.writeFileSync(DIR+'/results.json',JSON.stringify(results,null,2));}
async function connect(url, timeoutMs = 8000) {
  const ws = new WebSocket(url);
  sockets.push(ws);
  await new Promise((resolve, reject) => { const timer=setTimeout(()=>{ws.close();reject(Error('WebSocket connect timeout'))},timeoutMs);ws.onopen=()=>{clearTimeout(timer);resolve()};ws.onerror=e=>{clearTimeout(timer);reject(new Error('WebSocket connection failed: '+url+' '+(e.message||e.type||'unknown error')))}; });
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
async function targets(){return await(await fetch('http://127.0.0.1:'+PORT+'/json/list')).json()}
async function evalOn(t,expression,timeoutMs=8000){const c=await connect(t.webSocketDebuggerUrl,timeoutMs);try{const v=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value}finally{sockets.at(-1)?.close()}}
async function newTab(url){return await(await fetch('http://127.0.0.1:'+PORT+'/json/new?'+encodeURIComponent(url),{method:'PUT'})).json()}
async function activate(t){await fetch('http://127.0.0.1:'+PORT+'/json/activate/'+t.id);await delay(200)}
function xdo(...args){if(args[0]==='mousemove')pointer=[Number(args[1]),Number(args[2])];results.lastAction={kind:'xdotool',args,time:new Date().toISOString()};save();execFileSync(XDO,args,{env:{...process.env,DISPLAY:DISPLAY}})}
async function shot(name){execFileSync('import',['-display',DISPLAY,'-window','root',DIR+'/'+name+'.png'])}
function normalize(n){const k=Object.keys(n.data)[0],d=n.data[k];return k==='tab'?{title:d.title,url:d.url,active:d.active,selected:d.selected}:{type:k,children:n.children.map(normalize)}}
async function snap(name){const raw=await evalOn(inspector,`(async()=>{const m=await import('./tab_strip_internals_api_proxy.js');return JSON.parse(JSON.stringify(await m.TabStripInternalsApiProxyImpl.getInstance().getTabStripData(),(k,v)=>typeof v==='bigint'?v.toString():v))})()`);fs.writeFileSync(DIR+'/'+name+'.json',JSON.stringify(raw,null,2));const tree=raw.data.tabstripTree.windows.map(w=>normalize(w.tabstripModel.root));await shot(name);results.snapshots??={};results.snapshots[name]=tree;save();return tree;}
function assert(v,msg){if(!v)throw Error(msg)}
async function local(name){return(await targets()).find(t=>t.url==='file://'+DIR+'/'+name+'.html')}
async function openChild(from,to){const t=await local(from);await activate(t);await evalOn(t,`document.querySelector('#${to}').click()`);await delay(600)}
function shape(tree){return JSON.stringify(tree,(k,v)=>['active','selected'].includes(k)?undefined:v)}
let bg,mainWindow,serial=0;results.settingsControls=[];
const eq=(a,b)=>assert(JSON.stringify(a)===JSON.stringify(b),'Expected '+JSON.stringify(b)+' actual '+JSON.stringify(a));
async function api(method,...args){results.lastAction={kind:'extension-api',method,args,time:new Date().toISOString()};save();return evalOn(bg,`new Promise((resolve,reject)=>{chrome.${method}(...${JSON.stringify(args)},v=>{const e=chrome.runtime.lastError;e?reject(Error(e.message)):resolve(v)})})`)}
async function allTabs(){return api('tabs.query',{})}
async function selectedFixtureTabs(){return (await allTabs()).filter(t=>t.url?.startsWith('file://'+DIR+'/')&&(t.highlighted||t.active)).map(t=>({id:t.id,active:t.active,highlighted:t.highlighted})).sort((a,b)=>a.id-b.id)}
async function ids(){const ts=await allTabs();return Object.fromEntries(ts.filter(t=>t.url?.startsWith('file://'+DIR+'/')).map(t=>[t.url.split('/').pop().replace('.html',''),t.id]))}
function fixtureShape(tree){function f(n){if(n.url)return n.url.startsWith('file://'+DIR+'/')?n.url.split('/').pop().replace('.html',''):null;const children=n.children.map(f).filter(x=>x!==null);return children.length?{type:n.type,children}:null}return tree.map(f).filter(Boolean)}
const U=(...children)=>({type:'unpinnedTabCollection',children}),P=(...children)=>({type:'pinnedTabCollection',children}),R=(...children)=>({type:'tabStripCollection',children});
async function snapshot(name){await delay(450);const t=await snap(String(++serial).padStart(2,'0')+'-'+name);return fixtureShape(t)}
let ui; let pointer=[0,0];
let windowId;
export function binaryIdentity(file=BIN){const s=fs.statSync(file);return {dev:s.dev,ino:s.ino,size:s.size,mtimeMs:s.mtimeMs,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}}
function checkBinary(){const actual=binaryIdentity();if(process.env.EXPECTED_BINARY)eq(actual,JSON.parse(process.env.EXPECTED_BINARY));results.binary=actual;save();return actual}
function flat(n){return[n,...(n.children||[]).flatMap(flat)]}
async function geometry(){
 const root=(await ui('DOM.getDocument')).root,rows=[],cache=new Map(),parents=new Map();
 function index(n,parent){parents.set(n.nodeId,parent);for(const c of n.children||[])index(c,n)}index(root,null);
 async function props(n){if(!cache.has(n.nodeId)){const c=await ui('CSS.getMatchedStylesForNode',{nodeId:n.nodeId});cache.set(n.nodeId,Object.fromEntries(c.matchedCSSRules.flatMap(x=>x.rule.style.cssProperties).map(x=>[x.name,x.value])))}return cache.get(n.nodeId)}
 const win=Object.fromEntries(execFileSync(XDO,['getwindowgeometry','--shell',windowId],{env:{...process.env,DISPLAY}}).toString().trim().split('\n').map(x=>x.split('=')));
 async function bounds(n){const b=(await ui('DOM.getNodeBoundsInScreen',{nodeId:n.nodeId})).boundsInScreen;assert(b&&['x','y','width','height'].every(k=>Number.isFinite(b[k])),'Unsupported native screen bounds');return b}
 for(const n of flat(root).filter(n=>n.attributes?.includes('TabView'))){const labels=[],controls=[];for(const l of flat(n).filter(l=>l.attributes?.includes('TabTitle')))labels.push({...await props(l),bounds:await bounds(l)});for(const l of (n.children||[]).filter(l=>l.attributes?.includes('ImageButton')))controls.push({props:await props(l),bounds:await bounds(l)});rows.push({id:n.nodeId,attrs:n.attributes,labels,controls,props:await props(n),bounds:await bounds(n)})}
 return {root,rows,window:win,coordinateContract:'DOM.getNodeBoundsInScreen -> View::GetBoundsInScreen -> ConvertPointToScreen including ancestor layer transforms; unit scale verified by unoccluded title pixels'};
}
export const title=id=>({A:'A wolf',B:'B jazz',C:'C dune',D:'D kiwi',E:'E oxen',F:'F plum',G:'G rust',H:'H vibe',a:'a fizz',c:'c myth'})[id];
export function row(s,id){const rs=s.geometry.rows.filter(r=>r.labels.some(l=>l.Text===title(id)));assert(rs.length===1,'Unique native row required: '+id);return rs[0]}
export async function fold(id){let s=await capture('fold-hover-'+id);const r=row(s,id);xdo('mousemove',String(Math.round(r.bounds.x+16)),String(Math.round(r.bounds.y+r.bounds.height/2)));await delay(400);s=await capture('fold-button-'+id);const buttons=row(s,id).controls.filter(b=>b.props.IsDrawn==='true'&&b.bounds.width>0&&b.bounds.x<r.bounds.x+r.bounds.width/2);assert(buttons.length===1,'Unsupported collapse affordance: '+id);const q=buttons[0].bounds;xdo('mousemove',String(Math.round(q.x+q.width/2)),String(Math.round(q.y+q.height/2)));xdo('click','1');await delay(600)}
export async function literalFixture(c){
 for(const r of c.before.filter(r=>r.parent===null))await newTab('file://'+DIR+'/'+r.id+'.html');
 for(const r of c.before.filter(r=>r.parent!==null))await openChild(r.parent,r.id);
 if(c.before.some(r=>r.group)&&!await evalOn(bg,`typeof chrome.tabs.group==='function'`))throw Error('UNSUPPORTED: native group fixture API unavailable');
 const names=await ids(),groups={};for(const symbol of new Set(c.before.map(r=>r.group).filter(Boolean))){const groupId=await api('tabs.group',{tabIds:c.before.filter(r=>r.group===symbol).map(r=>names[r.id])});groups[symbol]=groupId;}
 await api('tabs.move',(await allTabs()).find(t=>t.url?.includes('tab-strip-internals')).id,{index:-1});await delay(600);return groups;
}
async function capture(name){const started=Date.now();const tree=await snap(name);const g=await geometry();const tabs=await allTabs();const data={name,acquisition:{started,finished:Date.now(),synchronized:false},pointer:[...pointer],tree:fixtureShape(tree),tabs,geometry:g};fs.writeFileSync(DIR+'/'+name+'-state.json',JSON.stringify(data,null,2));execFileSync('convert',[DIR+'/'+name+'.png','-stroke','red','-strokewidth','2','-fill','none','-draw',`circle ${pointer[0]},${pointer[1]} ${pointer[0]+7},${pointer[1]} line ${pointer[0]-12},${pointer[1]} ${pointer[0]+12},${pointer[1]} line ${pointer[0]},${pointer[1]-12} ${pointer[0]},${pointer[1]+12}`,DIR+'/'+name+'-pointer.png']);return data}
async function fixture(sourceCollapsed=false,targetCollapsed=false){for(const t of (await allTabs()).reverse())if(t.url?.startsWith('file://'+DIR+'/'))if((await allTabs()).some(x=>x.id===t.id))await api('tabs.remove',t.id);
for(const name of ['A','E','F','H'])await newTab('file://'+DIR+'/'+name+'.html');await openChild('A','B');await openChild('B','C');await openChild('A','D');await openChild('E','G');
// Place inspector after all fixture tabs; fixture order is A(B(C),D),E(G),F,H.
await api('tabs.move',(await allTabs()).find(t=>t.url?.includes('tab-strip-internals')).id,{index:-1});await activate(await local('A'));await delay(600);
const s=await capture('fixture-'+serial++);eq(s.tree,[R(U(U('A',U('B','C'),'D'),U('E','G'),'F','H'))]);
if(targetCollapsed)await fold('E');
if(sourceCollapsed)await fold('A');
return await capture('ready-'+serial++);
}
export async function setup(){
  if(fs.existsSync(PROFILE))throw Error('Refusing reused profile');
  const displayNumber=DISPLAY.slice(1);
  for(const p of ['/tmp/.X'+displayNumber+'-lock','/tmp/.X11-unix/X'+displayNumber])
    if(fs.existsSync(p)) throw Error('Display occupied: '+DISPLAY);
  // Bind probes, not HTTP: absolutely no request or cleanup against occupied endpoints.
  for(const port of [PORT,UI_PORT]) await new Promise((resolve,reject)=>{
    const server=net.createServer();server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>server.close(resolve));
  });
  fs.mkdirSync(PROFILE+'/Default',{recursive:true});
  fs.writeFileSync(PROFILE+'/Default/Preferences',JSON.stringify({helium:{browser:{layout:2,vertical_nesting:true}}}));
  fs.writeFileSync(PROFILE+'/Local State',JSON.stringify({internal_only_uis_enabled:true}));
  for(const n of ['A','B','C','D','E','F','G','H','a','c']) fs.writeFileSync(DIR+'/'+n+'.html',`<!doctype html><title>${title(n)}</title>${['A','B','C','D','E','F','G','H','a','c'].map(x=>`<a id="${x}" target="_blank" href="${x}.html">${x}</a>`).join(' ')}`);
  xv=spawn('Xvfb',[DISPLAY,'-screen','0','1280x900x24','-nolisten','tcp'],{stdio:'ignore'});
  xv.on('error',e=>{results.xvfbError=e.message});
  await delay(500);assert(xv.exitCode===null&&!results.xvfbError,'Xvfb failed');
  const args=['--ozone-platform=x11','--force-device-scale-factor=1','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--password-store=basic','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+PORT,'--enable-ui-devtools='+UI_PORT,'--window-size=1280,900','--user-data-dir='+PROFILE];
  const env={...process.env,DISPLAY};delete env.WAYLAND_DISPLAY;
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  const flake=process.env.HELIUM_FLAKE;
  const command=flake?'nix':BIN;
  const argv=flake?['run',flake+'#browser-env','--','-c','export DISPLAY='+quote(DISPLAY)+'; unset WAYLAND_DISPLAY; exec '+[BIN,...args].map(quote).join(' ')]:args;
  checkBinary();
  const log=fs.openSync(DIR+'/browser.log','a');
  browser=spawn(command,argv,{env,detached:true,stdio:['ignore',log,log]});fs.closeSync(log);
  browser.on('error',e=>{results.launchError=e.message});
  // Verify the window belongs to this unique profile/display before ANY CDP mutation or input.
  let wid,pid;
  for(let i=0;i<120;i++){
    if(browser.exitCode!==null||results.launchError) throw Error('Browser launch failed');
    try{
      const windows=execFileSync(XDO,['search','--onlyvisible','--class','^Helium$'],{env,stdio:['ignore','pipe','ignore']}).toString().trim().split('\n');
      for(const w of windows){
        const p=Number(execFileSync(XDO,['getwindowpid',w],{env}).toString());
        assert(!/\s/.test(PROFILE),'Profile path must not contain whitespace for scrubbed argv verification');
        // Chromium rewrites /proc/cmdline into a single space-delimited title.
        const cmd=fs.readFileSync('/proc/'+p+'/cmdline','utf8').split(/[\0\s]+/);
        // Chromium scrubs its startup environ. Prove ownership instead through
        // the owned process group, exact profile, native X11 window on our Xvfb,
        // explicit backend, endpoint ownership below, and compositor absence.
        const stat=fs.readFileSync('/proc/'+p+'/stat','utf8').split(') ').at(-1).split(' ');
        results.windowProbe={p,group:Number(stat[2]),launchPid:browser.pid,profileMatch:cmd.includes('--user-data-dir='+PROFILE),x11:cmd.includes('--ozone-platform=x11')};save();
        if(cmd.includes('--user-data-dir='+PROFILE)&&cmd.includes('--ozone-platform=x11')&&Number(stat[2])===browser.pid&&!cmd.includes('--no-sandbox')){
          const clients=JSON.parse(execFileSync('hyprctl',['clients','-j'],{encoding:'utf8'}));
          assert(!clients.some(c=>c.pid===p),'Owned browser leaked onto compositor');
          results.windowOwnership={window:w,pid:p,processGroup:Number(stat[2]),ownedDisplay:DISPLAY,compositorAbsent:true};
          wid=w;pid=p;break;
        }
      }
      if(wid) break;
    }catch(e){results.windowProbeError=String(e);save();}
    await delay(500);
  }
  assert(wid,'No verified isolated browser window');
  // Endpoint listener ownership (Linux /proc); refuse a port-bind race, including CDP mutations.
  const ownedSockets=new Set(fs.readdirSync('/proc/'+pid+'/fd').flatMap(fd=>{try{return [fs.readlinkSync('/proc/'+pid+'/fd/'+fd)]}catch{return []}}));
  const tcp=fs.readFileSync('/proc/net/tcp','utf8')+'\n'+fs.readFileSync('/proc/net/tcp6','utf8');
  for(const p of [PORT,UI_PORT]) assert(tcp.split('\n').some(l=>{const c=l.trim().split(/\s+/);return c[3]==='0A'&&parseInt(c[1]?.split(':').at(-1),16)===p&&ownedSockets.has('socket:['+c[9]+']')}),'Endpoint ownership not proven: '+p);
  windowId=wid;
  results.executedBinary=binaryIdentity('/proc/'+pid+'/exe');
  eq(results.executedBinary,results.binary);checkBinary();
  results.isolation={pid,display:DISPLAY,profile:PROFILE};save();
  inspector=await newTab('helium://tab-strip-internals');
  // Retain this inspector as the only nonfixture sentinel. Remove startup tabs
  // only after verified ownership, using targets from this isolated endpoint.
  for(const t of await targets())if(t.type==='page'&&t.id!==inspector.id)await fetch('http://127.0.0.1:'+PORT+'/json/close/'+t.id);
  for(let i=0;i<90;i++){bg=(await targets()).find(t=>t.type==='background_page'&&t.url.startsWith('chrome-extension://')&&/ublock/i.test(t.title));if(bg)break;await delay(500)}
  assert(bg,'Extension background page absent');
  results.readiness=await evalOn(bg,`(async()=>{const manifest=chrome.runtime.getManifest();if(!/ublock/i.test(manifest.name))throw Error('Wrong extension identity');const {default:ub}=await import('./js/background.js');await ub.isReadyPromise;if(!ub.readyToFilter||!ub.supportStats.allReadyAfter)throw Error('Extension not ready');return {extensionId:chrome.runtime.id,name:manifest.name,version:manifest.version,ready:ub.readyToFilter,after:ub.supportStats.allReadyAfter}})()`,45000);save();
  xdo('windowmove',wid,'0','0');xdo('windowfocus',wid);
  ui=await connect('ws://127.0.0.1:'+UI_PORT+'/0');await ui('DOM.enable');await ui('CSS.enable');
}
export async function cleanup(){
 const errors=[];for(const s of sockets){try{s.close()}catch{} }
 async function stop(child,group){if(!child?.pid)return;const alive=()=>{try{process.kill(group?-child.pid:child.pid,0);return true}catch(e){if(e.code==='ESRCH')return false;throw e}};for(const signal of ['SIGTERM','SIGKILL']){if(!alive())break;try{process.kill(group?-child.pid:child.pid,signal)}catch(e){if(e.code!=='ESRCH')throw e}for(let i=0;i<50&&alive();i++)await delay(100)}assert(!alive(),'Owned process failed to exit: '+child.pid);if(child.exitCode===null&&child.signalCode===null)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.removeListener('exit',done);reject(Error('Child exit not reaped: '+child.pid))},2000);const done=()=>{clearTimeout(timer);resolve()};child.once('exit',done)})}
 for(const [child,group] of [[browser,true],[xv,false]])try{await stop(child,group)}catch(e){errors.push(e.message)}
 if(browser?.pid){const tcp=fs.readFileSync('/proc/net/tcp','utf8')+'\n'+fs.readFileSync('/proc/net/tcp6','utf8');for(const p of [PORT,UI_PORT])if(tcp.split('\n').some(l=>{const c=l.trim().split(/\s+/);return c[3]==='0A'&&parseInt(c[1]?.split(':').at(-1),16)===p}))errors.push('Listener remains: '+p)}
 if(xv?.pid)for(const p of ['/tmp/.X'+DISPLAY.slice(1)+'-lock','/tmp/.X11-unix/X'+DISPLAY.slice(1)])if(fs.existsSync(p))errors.push('Display resource remains: '+p);
 results.cleanup={verified:!errors.length,errors};if(errors.length)throw Error(errors.join('; '));
}
export {fixture,capture,api,allTabs,ids,activate,local,xdo,delay,eq,assert,U,R,results,save};

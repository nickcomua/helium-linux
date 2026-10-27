import * as h from './native-helper.mjs';
import {all,initialForest,flatten,move,visible} from './cases.mjs';
import {assertLiteralState} from './review-target-parent-cases.mjs';
import {template,locate,displacementEvidence} from './rendered.mjs';
const c=all.find(c=>c.name===process.env.CASE);
if(!c)throw Error('Unknown CASE');
const folds=new Set([...(c.folds||[]),...(c.sourceCollapsed?[c.source]:[]),...(c.targetCollapsed?[c.target]:[])]);
const forest=initialForest(c.small),failures=[];let phase='setup',held=false,groups={};
const shape=f=>[h.R(h.U(...f.map(function node([id,kids]){return kids.length?h.U(id,...kids.map(node)):id})))];
const fixtureTabs=s=>s.tabs.filter(t=>t.url?.startsWith('file://'+h.DIR+'/'));
const name=t=>t.url.split('/').pop().replace('.html','');
const png=s=>h.DIR+'/'+s.name+'.png';
const drawn=(s,id)=>h.row(s,id).props.IsDrawn==='true';
function checkProjection(s,f,fold){const order=flatten(f).map(n=>n.id);h.eq(fixtureTabs(s).sort((a,b)=>a.index-b.index).map(name),order);const expected=new Set(visible(f,fold));h.eq(order.filter(id=>drawn(s,id)),order.filter(id=>expected.has(id)));}
// Accepted nesting preserves the active owner and reveals its ancestors. Opening
// E reveals G too; do not manufacture a projection with F visible but G hidden.
// Keep the source's own fold and all folds unrelated to its ancestor path intact.
function acceptedFolds(f){const out=new Set(folds),parents=new Map(flatten(f).map(r=>[r.id,r.parent]));for(let p=parents.get(c.source);p!==null&&p!==undefined;p=parents.get(p))out.delete(p);return out;}
function selection(s){return fixtureTabs(s).filter(t=>t.active||t.highlighted).map(t=>({id:t.id,active:t.active,highlighted:t.highlighted})).sort((a,b)=>a.id-b.id);}
function stableIdentities(s,before){
 const attrs=t=>({id:t.id,url:t.url,windowId:t.windowId,pinned:t.pinned});
 h.eq(s.tabs.map(attrs).sort((a,b)=>a.id-b.id),before.tabs.map(attrs).sort((a,b)=>a.id-b.id));
 h.assert(new Set(s.tabs.map(t=>t.id)).size===s.tabs.length,'Duplicate native ID');
 for(const t of s.tabs)if(!t.url?.startsWith('file://'+h.DIR+'/'))h.eq(t.index,before.tabs.find(x=>x.id===t.id).index);
}
function stableGroups(s,before,final=false){
 for(const t of s.tabs){
  const old=before.tabs.find(x=>x.id===t.id);
  const literal=c.literal&&t.url?.startsWith('file://'+h.DIR+'/')?c.expected.find(r=>r.id===name(t)):null;
  const destination=literal?(literal.group===null?-1:groups[literal.group]):old.groupId;
  // Only explicitly declared membership transitions may preview source OR destination.
  // Unaffected fixture rows and sentinels remain exact; final membership is exact.
  if(final)h.eq(t.groupId,destination);
  else h.assert(t.groupId===old.groupId||t.groupId===destination,'Unexpected preview group for '+t.id+': '+t.groupId);
 }
}
function stable(s,before,final=false){stableIdentities(s,before);stableGroups(s,before,final);}
function check(label,fn){try{fn()}catch(e){failures.push({label,error:e.message})}}
function literalState(s){
 const tabs=new Map(fixtureTabs(s).map(t=>[name(t),t])),rows=[],members={};
 const symbol=t=>{if(t.groupId===-1)return null;const g=Object.keys(groups).find(g=>groups[g]===t.groupId);h.assert(g,'Unexpected native group '+t.groupId);return g};
 function walk(n,parent=null,container=false){if(typeof n==='string'){const t=tabs.get(n);h.assert(t,'Unexpected tree identity');const group=symbol(t);rows.push({id:n,parent,group});if(group)(members[group]??=[]).push(n);return;}
  if(n.type==='tabStripCollection'||n.type==='pinnedTabCollection'){for(const ch of n.children)walk(ch,parent,true);return;}
  if(n.type==='unpinnedTabCollection'){
   if(container){for(const ch of n.children)walk(ch,parent,false)}
   else {h.assert(typeof n.children[0]==='string','Unsupported nested collection shape');const [owner,...kids]=n.children;walk(owner,parent);for(const ch of kids)walk(ch,owner,false)}return;
  }
  // Recognize group wrappers only, never arbitrary unknown collection types.
  h.assert(/group/i.test(n.type),'Unsupported collection '+n.type);
  const start=rows.length;for(const ch of n.children)walk(ch,null,false);
  const symbols=new Set(rows.slice(start).map(r=>r.group));h.assert(symbols.size===1&&!symbols.has(null),'Invalid native group container');
 }
 for(const n of s.tree)walk(n,null,true);
 h.eq(rows.map(r=>r.id),fixtureTabs(s).sort((a,b)=>a.index-b.index).map(name));
 return {rows,groups:members,selected:fixtureTabs(s).filter(t=>t.highlighted).map(name),active:name(fixtureTabs(s).find(t=>t.active))};
}
function titleRect(s,id){const l=h.row(s,id).labels.find(l=>l.Text===h.title(id));const width=Number(l.MaximumSize?.split('x')[0]);h.assert(width>0&&width<=l.bounds.width,'Unsupported title geometry');return {...l.bounds,width};}
function body(s,id){const r=h.row(s,id);h.assert(r.props.IsDrawn==='true','Hidden target/source '+id);const l=titleRect(s,id);return [Math.round(r.bounds.x+r.bounds.width*.55),Math.round(r.bounds.y+r.bounds.height/2)];}
const templates=new Map();
function renderedBounds(s,id){const r=h.row(s,id);h.assert(r.props.IsDrawn==='true','Hidden native target '+id);return {...r.bounds,nativeNodeId:r.id,method:'DOM.getNodeBoundsInScreen'};}
function targetPoint(s){
 const recipe=c.recipe||c;let id=recipe.target;
 if(recipe.zone==='end'){
  // Before the retained ungrouped inspector, after the entire fixture. No guessed y=420.
  const sentinel=s.geometry.rows.find(r=>r.labels.some(l=>l.Text==='DebugUI TabStrip'));
  h.assert(sentinel?.props.IsDrawn==='true','Unsupported end boundary: inspector row missing');
  return [h.results.input?.from[0]??body(s,c.source)[0],Math.round(sentinel.bounds.y+1)];
 }
 const b=renderedBounds(s,id),x=h.results.input?.from[0]??body(s,c.source)[0];
 h.assert(x>b.x+28&&x<b.x+b.width-20,'UNSUPPORTED: no common safe title-column for native edge target');
 const y=recipe.zone==='before'?b.y+1:recipe.zone==='after'?b.y+b.height-2:recipe.zone==='through'?b.y-18:b.y+b.height/2-3;
 h.assert(x>0&&x<1280&&y>0&&y<900,'Unsupported offscreen target');
 if(c.literal||recipe.rootAfter){const rows=literalState(s).rows,actual=rows.find(r=>r.id===id);if(actual.parent!==c.destination.parent||actual.group!==c.destination.group)throw Error('UNSUPPORTED: native target edge no longer exposes declared parent/group');
  if(recipe.rootAfter){
   const owner=rows.find(r=>r.id===recipe.rootAfter);
   h.assert(owner?.parent===null&&owner.group===null,'UNVALIDATED TARGET: after-subtree owner is not an ungrouped root');
   const moving=new Set(flatten(forest).filter(r=>{let p=r.id;const parents=new Map(flatten(forest).map(r=>[r.id,r.parent]));while(p!==null){if(p===c.source)return true;p=parents.get(p)}return false}).map(r=>r.id));
   const roots=rows.filter(r=>r.parent===null&&r.group===null&&!moving.has(r.id)).map(r=>r.id);
   h.eq(roots[roots.indexOf(recipe.rootAfter)+1],id);
  }
  h.results.targetEvidence={id,zone:recipe.zone,nativeRow:b,parent:actual.parent,group:actual.group,declared:c.destination,artifact:png(s),kind:'rendered-row edge in verified native container',rootAfter:recipe.rootAfter??null};
 }
 return [x,Math.round(y)];
}
async function settled(label){let previous,key;for(let i=0;i<8;i++){await h.delay(300);const s=await h.capture(label+'-'+i);const next=JSON.stringify({tree:s.tree,tabs:s.tabs.map(t=>({id:t.id,index:t.index,groupId:t.groupId,active:t.active,highlighted:t.highlighted})),rows:s.geometry.rows.map(r=>({id:r.id,bounds:r.bounds,drawn:r.props.IsDrawn}))});if(next===key)return s;previous=s;key=next;}throw Error('State did not settle: '+label)}
try{
 if(c.unsupported)throw Error('UNSUPPORTED: '+c.unsupported);
 await h.setup();
 if(c.literal)groups=await h.literalFixture(c);else {await h.fixture(folds.has('A'),folds.has('E'));if(c.small){const ids=await h.ids();await h.api('tabs.remove',[ids.F,ids.H]);}}
 const ids=await h.ids(),tabs=await h.allTabs(),selected=c.selected||[c.source],active=c.active||c.source;
 // Explicit current indexes; first highlighted index is the active tab. Never activate afterward.
 const ordered=[active,...selected.filter(id=>id!==active)];
 await h.api('tabs.highlight',{windowId:tabs.find(t=>t.id===ids[active]).windowId,tabs:ordered.map(id=>tabs.find(t=>t.id===ids[id]).index)});
 const before=await settled('before');
 if(c.literal){assertLiteralState(literalState(before),{expected:c.before,expectedSelected:c.selected,expectedActive:c.active});for(const r of c.before)h.assert(drawn(before,r.id),'Fixture must be expanded');}
 else {h.eq(before.tree,shape(forest));checkProjection(before,forest,folds);}
 h.eq(selection(before),selected.map(id=>({id:ids[id],active:id===active,highlighted:true})).sort((a,b)=>a.id-b.id));
 for(const t of fixtureTabs(before).filter(t=>drawn(before,name(t)))){const id=name(t);templates.set(id,template(png(before),titleRect(before,id)));const found=locate(png(before),templates.get(id));const rect=titleRect(before,id);h.assert(Math.abs(found.x-rect.x)<=1&&Math.abs(found.y-rect.y)<=1,'Native-to-rendered coordinate mismatch');}
 phase='input';const from=body(before,c.source);let to=targetPoint(before);
 h.results.input={from,to,coordinateContract:before.geometry.coordinateContract};h.save();
 h.xdo('mousemove',...from.map(String));h.xdo('mousedown','1');held=true;await h.delay(150);
 const pressed=await h.capture('pressed');h.eq(selection(pressed),selection(before));stable(pressed,before);
 // Establish drag activation before target travel. Two fixed cursor positions,
 // repeated rendered glyph observations at each; never infer activation from order.
 const baseline={cursor:from,rendered:locate(png(pressed),templates.get(c.source))},samples=[];
 const direction=from[1]<700?1:-1;let current=from;
 for(const offset of [18,35]){current=[from[0],from[1]+direction*offset];h.xdo('mousemove',...current.map(String));await h.delay(350);
  for(let k=0;k<2;k++){const s=await h.capture('activation-'+offset+'-'+k);samples.push({cursor:[...current],rendered:locate(png(s),templates.get(c.source)),artifact:png(s),buttonHeld:held});stable(s,before);await h.delay(120);}}
 h.results.dragEvidence=displacementEvidence(baseline,samples);h.save();
 let during=await h.capture('activated');
 // Re-resolve transformed native destination on every step; occlusion is irrelevant.
 for(let i=1;i<=14;i++){to=targetPoint(during);const remaining=15-i;current=current.map((v,j)=>Math.round(v+(to[j]-v)/remaining));h.xdo('mousemove',...current.map(String));await h.delay(90);during=await h.capture('step-'+i);check('identity-step-'+i,()=>stable(during,before));check('dragged-visible-step-'+i,()=>h.assert(drawn(during,c.source),'Dragged owner vanished before release'));}
 if((process.env.TARGET_DIAG??'1')==='1'){
  // Bounded diagnosis: observe stationary first, then reacquire the actual native
  // transformed edge. Never pursue an old D coordinate after preview reordering.
  h.results.targetDiagnostic=[];let acquired=false;
  for(let attempt=0;attempt<4;attempt++){
   const stationary=[];
   for(let k=0;k<3;k++){
    await h.delay(300);during=await h.capture('target-hold-'+attempt+'-'+k);
    const edge=targetPoint(during),state=literalState(during);
    const observation={attempt,k,pointer:[...current],edge,nativeRow:during.geometry.rows.map(r=>({id:r.id,bounds:r.bounds,drawn:r.props.IsDrawn})),state,artifact:png(during)};
    stationary.push(observation);h.results.targetDiagnostic.push(observation);h.save();
    stable(during,before);h.assert(drawn(during,c.source),'Dragged owner vanished');
   }
   const last=stationary.at(-1),prev=stationary.at(-2);
   h.assert(JSON.stringify(last.nativeRow)===JSON.stringify(prev.nativeRow)&&JSON.stringify(last.state)===JSON.stringify(prev.state),'UNVALIDATED TARGET: stationary target oscillation');
   to=targetPoint(during);
   if(Math.hypot(current[0]-to[0],current[1]-to[1])<=4){acquired=true;break;}
   current=[...to];h.xdo('mousemove',...current.map(String));await h.delay(200);during=await h.capture('target-reacquire-'+attempt);
  }
  h.assert(acquired,'UNVALIDATED TARGET: bounded native reacquisition did not converge');
 }
 to=targetPoint(during);h.assert(Math.hypot(current[0]-to[0],current[1]-to[1])<=4,'UNVALIDATED TARGET: target moved at final hold');
 await h.delay(200);const hold=await h.capture('held-final');
 // A stationary held cursor must still own a displaced rendered source.
 const finalSample={cursor:current,rendered:locate(png(hold),templates.get(c.source)),artifact:png(hold),buttonHeld:held};
 h.results.finalDragEvidence=displacementEvidence(baseline,[{cursor:current,rendered:locate(png(during),templates.get(c.source)),artifact:png(during)},finalSample],{requireDisplacement:false});h.save();
 if(c.requireUncommittedCenter){
  const state=literalState(hold);
  h.eq(hold.tree,shape(forest));
  h.eq(state.rows.map(r=>r.id),flatten(forest).map(r=>r.id));
  h.eq(state.rows.find(r=>r.id===c.source),{id:c.source,parent:null,group:null});
  h.results.uncommittedCenter={state,artifact:png(hold),buttonHeld:held,originalOrder:flatten(forest).map(r=>r.id)};h.save();
 }
 if(c.cancel)h.xdo('key','Escape');h.xdo('mouseup','1');held=false;phase='assertion';
 const after=await settled('after');check('identities-membership',()=>stable(after,before,true));
 let expected;
 if(c.literal){expected=c.expected;check('literal-topology-selection-groups',()=>assertLiteralState(literalState(after),c));check('visible',()=>{for(const r of c.expected)h.assert(drawn(after,r.id),'Expected visible '+r.id)});}
 else {expected=c.cancel?forest:move(forest,c.source,c.target,c.zone);check('exact-hierarchy',()=>h.eq(after.tree,shape(expected)));check('preorder-visible-projection-collapse',()=>checkProjection(after,expected,c.cancel?folds:acceptedFolds(expected)));
  if(c.cancel)check('cancel-selection',()=>h.eq(selection(after),selection(before)));
  else {check('selection-preserves-dragged-owner',()=>h.eq(selection(after),[{id:ids[c.source],active:true,highlighted:true}]));check('active-owner-visible',()=>h.assert(drawn(after,c.source),'Active dragged owner must remain visible'));}}
 h.results.cases.push({name:c.name,status:failures.length?(failures.every(f=>f.label.startsWith('policy-'))?'policy-mismatch':'fail'):'pass',failures,expected,before:before.tree,after:after.tree});
}catch(e){const status=e.message.startsWith('UNSUPPORTED:')?'unsupported':phase==='input'?'input-unvalidated':phase==='setup'?'setup-error':'assertion-error';h.results.cases.push({name:c.name,status,error:e.stack});if(status==='setup-error'||status==='assertion-error')h.results.fatal=e.stack;}
finally{if(held)try{h.xdo('key','Escape');h.xdo('mouseup','1')}catch(e){h.results.releaseError=e.stack}try{await h.cleanup()}catch(e){h.results.cleanupError=e.stack}h.save();}
const ok=!h.results.fatal&&!h.results.cleanupError&&!h.results.releaseError&&h.results.cases.length===1&&h.results.cases[0].status==='pass';
// All owned processes were awaited; explicitly terminate residual Undici/WebSocket handles.
process.exit(ok?0:1);

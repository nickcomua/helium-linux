// Independent black-box fixtures, not copied Sidebery/TST implementations.
const leaf=(name,extra={})=>({name,source:'F',target:'E',zone:'inside',targetCollapsed:true,...extra});
import {targetParentProposals} from './review-target-parent-cases.mjs';
export const originalFocused=[
 {name:'small-expanded',source:'A',zone:'end',small:true},
 {name:'small-collapsed',source:'A',zone:'end',small:true,sourceCollapsed:true},
 leaf('leaf-through',{zone:'through',cancel:true}),
 leaf('leaf-center-cancel',{cancel:true}),
 leaf('leaf-center-drop'),
 leaf('leaf-center-drop-unrelated-fold',{folds:['A','E']}),
 leaf('leaf-edge',{zone:'after'}),
];
export const matrix=[];
for(const direction of ['down','up']) for(const sourceCollapsed of [false,true])
 for(const targetCollapsed of [false,true]) for(const zone of ['before','inside','after','end'])
 for(const cancel of [false,true]) matrix.push({name:`${direction}-${sourceCollapsed?'folded':'open'}-to-${targetCollapsed?'folded':'open'}-${zone}-${cancel?'cancel':'drop'}`,source:direction==='down'?'A':'E',target:direction==='down'?'E':'A',sourceCollapsed,targetCollapsed,zone,cancel});
// F follows E's entire subtree: accepting the center would change ownership
// without changing flat order. Hover alone must not commit that parent change.
matrix.push(leaf('same-index-parent-center-cancel',{cancel:true,requireUncommittedCenter:true}));
// AFTER means root sibling after the target's complete subtree, never the lower
// edge of its deepest child. Exclude the moving root when choosing a stable gap.
for(const c of [...originalFocused,...matrix].filter(c=>c.zone==='after')){
 const roots=initialForest(c.small).map(n=>n[0]).filter(id=>id!==c.source);
 const at=roots.indexOf(c.target);
 if(at<0)throw Error('Root-after target must be a fixture root');
 const nextSibling=roots[at+1]??null;
 if(!nextSibling)throw Error('Root-after fixture needs an explicit root next-sibling anchor');
 c.recipe={target:nextSibling,zone:'before',rootAfter:c.target};
 c.destination={parent:null,group:null,previousSibling:c.target,nextSibling};
}
export const destinations=targetParentProposals.map(p=>({...p,literal:true,source:p.dragOwner,
 recipe:p.name==='same-flat-gap-B-after-D-inside-A'?{target:'D',zone:'after'}:
 {target:p.destination.nextSibling,zone:'before'},
 ...(p.name.includes('closures')?{unsupported:'Selected-root closure policy has not been approved'}:{})}));
export const focused=[...originalFocused,...destinations.filter(p=>!p.name.includes('closures'))];
export const all=[...focused,...matrix,...destinations.filter(p=>p.name.includes('closures'))];
// Seed affects independent case ordering ONLY. This is not a stateful property test.
export function seededOrder(cases,seed){
 let state=Number(seed)>>>0;const out=[...cases];
 const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state};
 for(let i=out.length-1;i>0;i--){const j=next()%(i+1);[out[i],out[j]]=[out[j],out[i]]}
 return out;
}
export function initialForest(small=false){return [['A',[['B',[['C',[]]]],['D',[]]]],['E',[['G',[]]]],...(!small?[['F',[]],['H',[]]]:[])];}
export function flatten(f,parent=null){return f.flatMap(([id,kids])=>[{id,parent},...flatten(kids,id)]);}
export function move(f,source,target,zone){
 const out=structuredClone(f);let moved;
 function remove(nodes){const i=nodes.findIndex(n=>n[0]===source);if(i>=0){[moved]=nodes.splice(i,1);return true}return nodes.some(n=>remove(n[1]));}
 if(!remove(out)) throw Error('Missing source');
 if(zone==='end'){out.push(moved);return out}
 if(flatten([moved]).some(n=>n.id===target)) throw Error('Invalid cyclic/self destination');
 function insert(nodes){const i=nodes.findIndex(n=>n[0]===target);if(i>=0){if(zone==='inside')nodes[i][1].push(moved);else nodes.splice(i+(zone==='after'?1:0),0,moved);return true}return nodes.some(n=>insert(n[1]));}
 if(!insert(out))throw Error('Missing target');return out;
}
export function visible(f,folds){return f.flatMap(([id,kids])=>[id,...(folds.has(id)?[]:visible(kids,folds))]);}

// Independent literal destination fixtures wired into the native runner.
// Literal independent expected states: never derive expected parents from a
// product move result, drop indicator, flat gap, or the current move() helper.
// group denotes native tab-group membership, not a tree parent.
const row = (id, parent, group = null) => ({id, parent, group});
const nested = [row('A',null),row('B','A'),row('C','B'),row('D','A'),row('E',null)];
export const targetParentProposals = [
  {
    name:'same-flat-gap-B-after-D-inside-A',
    before:nested, selected:['B'], active:'B', dragOwner:'B',
    destination:{parent:'A',group:null,previousSibling:'D',nextSibling:null},
    expected:[row('A',null),row('D','A'),row('B','A'),row('C','B'),row('E',null)],
    expectedSelected:['B'], expectedActive:'B',
    note:'Drop after D as final child of A; preserve B -> C.'
  },
  {
    name:'same-flat-gap-B-root-after-A',
    before:nested, selected:['B'], active:'B', dragOwner:'B',
    destination:{parent:null,group:null,previousSibling:'A',nextSibling:'E'},
    expected:[row('A',null),row('D','A'),row('B',null),row('C','B'),row('E',null)],
    expectedSelected:['B'], expectedActive:'B',
    note:'Identical final flat order to prior case, but B MUST be a root.'
  },
  {
    name:'group-G-A-branch-before-H-outside-group',
    before:[row('A',null,'G'),row('B','A','G'),row('C',null,'G'),row('H',null)],
    selected:['A'], active:'A', dragOwner:'A',
    destination:{parent:null,group:null,previousSibling:null,nextSibling:'H'},
    expected:[row('C',null,'G'),row('A',null),row('B','A'),row('H',null)],
    expectedGroups:{G:['C']},expectedSelected:['A'],expectedActive:'A',
    note:'G[A(B),C],H -> G[C],A(B),H. Both A and B leave G; G survives with C. previousSibling null is relative to the ungrouped root container.'
  },
  {
    name:'discontiguous-selected-roots-A-C-before-B',
    before:[row('A',null),row('B',null),row('C',null),row('D',null)],
    selected:['A','C'],active:'A',dragOwner:'A',
    destination:{parent:null,group:null,previousSibling:null,nextSibling:'B'},
    expected:[row('A',null),row('C',null),row('B',null),row('D',null)],
    expectedSelected:['A','C'],expectedActive:'A',
    note:'A alone is already before B, but selected C must move. Never use only dragged-owner index to classify no-op.'
  },
  {
    name:'discontiguous-selected-root-closures-before-B',
    before:[row('A',null),row('a','A'),row('B',null),row('C',null),row('c','C'),row('D',null)],
    selected:['A','C'],active:'A',dragOwner:'A',
    destination:{parent:null,group:null,previousSibling:null,nextSibling:'B'},
    expected:[row('A',null),row('a','A'),row('C',null),row('c','C'),row('B',null),row('D',null)],
    expectedSelected:['A','C'],expectedActive:'A',
    note:'Selected-root closure policy proposal; descendants travel without becoming selected. Requires product approval.'
  }
];

// Adapter contract for future execution. actual.rows must be independently read
// from full native hierarchy + tabs group membership, ordered in native preorder.
// Each row uses fixture symbolic IDs resolved from stable native tab IDs.
export function assertLiteralState(actual, proposal) {
  const equal=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+': expected '+JSON.stringify(b)+' actual '+JSON.stringify(a));};
  equal(actual.rows,proposal.expected,'ordered parent/group state');
  equal([...actual.selected].sort(),[...proposal.expectedSelected].sort(),'selection');
  equal(actual.active,proposal.expectedActive,'active');
  if(proposal.expectedGroups)equal(actual.groups,proposal.expectedGroups,'group membership');
}

// Evidence is mandatory even for cases whose expected outcome is unchanged.
// This validates evidence shape only: a native adapter must obtain observations,
// and must NOT synthesize these fields from sent mouse commands or result order.
export function requireDragEvidence(evidence, proposal) {
  if(!evidence || evidence.nativeDragActive !== true ||
     evidence.owner !== proposal.dragOwner || evidence.buttonHeld !== true ||
     evidence.observedBeforeRelease !== true || !evidence.artifact)
    throw Error('UNVALIDATED INPUT: missing held-button native drag-start evidence');
  if(evidence.resolvedTargetParent !== proposal.destination.parent ||
     evidence.resolvedTargetGroup !== proposal.destination.group)
    throw Error('UNVALIDATED TARGET: explicit parent/group intent not observed');
}

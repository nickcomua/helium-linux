// Screenshot glyph matching: native CSS bounds omit compositor layer transforms.
import {execFileSync} from 'node:child_process';
function image(file){const [w,h]=execFileSync('identify',['-format','%w %h',file]).toString().split(' ').map(Number);const pixels=execFileSync('convert',[file,'-colorspace','Gray','-depth','8','gray:-'],{maxBuffer:16*1024*1024});if(pixels.length!==w*h)throw Error('Unsupported screenshot format');return {w,h,pixels};}
export function template(file,rect){const im=image(file),x=Math.round(rect.x),y=Math.round(rect.y),w=Math.ceil(rect.width),h=Math.ceil(rect.height);if(x<0||y<0||x+w>im.w||y+h>im.h||w<10||h<10)throw Error('Invalid native title crop');const v=[];for(let j=0;j<h;j++)for(let i=0;i<w;i++)v.push(im.pixels[(y+j)*im.w+x+i]);const mean=v.reduce((a,b)=>a+b,0)/v.length;const centered=v.map(x=>x-mean),energy=centered.reduce((a,b)=>a+b*b,0);if(energy<1000)throw Error('UNVALIDATED INPUT: empty title template');return {x,y,w,h,centered,energy};}
export function locate(file,t){const im=image(file),candidates=[];
 // Full vertical strip search, including displaced native drag layers. No guessed y.
 for(let y=0;y<=im.h-t.h;y++)for(let x=Math.max(0,t.x-64);x<=Math.min(im.w-t.w,t.x+64);x++){
  let sum=0,sq=0,dot=0,k=0;for(let j=0;j<t.h;j++)for(let i=0;i<t.w;i++){const v=im.pixels[(y+j)*im.w+x+i];sum+=v;sq+=v*v;dot+=v*t.centered[k++];}
  const energy=sq-sum*sum/k;const score=energy>0?dot/Math.sqrt(energy*t.energy):0;if(score>.85)candidates.push({x,y,score});
 }
 candidates.sort((a,b)=>b.score-a.score);const best=candidates[0],other=candidates.find(p=>best&&Math.hypot(p.x-best.x,p.y-best.y)>8);
 if(!best||best.score<.94||(other&&best.score-other.score<.015))throw Error('UNVALIDATED INPUT: ambiguous rendered title '+JSON.stringify({best,other}));return {...best,runnerUp:other?.score??null};
}
export function displacementEvidence(base,samples,{requireDisplacement=true}={}){
 if(samples.length<2)throw Error('UNVALIDATED INPUT: insufficient fixed-cursor samples');
 for(const s of samples){const dx=s.cursor[0]-base.cursor[0],dy=s.cursor[1]-base.cursor[1];if((requireDisplacement&&Math.hypot(dx,dy)<12)||Math.abs(s.rendered.x-base.rendered.x-dx)>5||Math.abs(s.rendered.y-base.rendered.y-dy)>5)throw Error('UNVALIDATED INPUT: source glyph does not track held pointer');}
 for(let i=1;i<samples.length;i++)if(samples[i].cursor.join()===samples[i-1].cursor.join()&&Math.hypot(samples[i].rendered.x-samples[i-1].rendered.x,samples[i].rendered.y-samples[i-1].rendered.y)>2)throw Error('UNVALIDATED INPUT: source still moving at fixed cursor');
 return {kind:'rendered-source-displacement',base,samples};
}

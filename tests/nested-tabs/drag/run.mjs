import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {focused,originalFocused,destinations,matrix,all,seededOrder} from './cases.mjs';
const suite=process.env.SUITE||'focused',suites={focused,original:originalFocused,destinations,matrix,all};
if(!suites[suite])throw Error('SUITE must be focused, original, destinations, matrix, or all');
let cases=suites[suite];
if(process.env.FILTER)cases=cases.filter(c=>new RegExp(process.env.FILTER).test(c.name));
if(!cases.length)throw Error('Empty selection');
if(new Set(cases.map(c=>c.name)).size!==cases.length)throw Error('Duplicate case names');
if(process.env.SEED!==undefined){if(!/^\d+$/.test(process.env.SEED))throw Error('SEED must be unsigned integer');cases=seededOrder(cases,process.env.SEED)}
if(process.argv.includes('--list')){console.log(JSON.stringify(cases,null,2));process.exit(0)}
if(process.env.BUILD_READY!=='1')throw Error('Parent must confirm build/link has finished: BUILD_READY=1');
if(!process.env.HELIUM_BINARY)throw Error('Set HELIUM_BINARY to an existing executable; this runner never builds');
const binary=path.resolve(process.env.HELIUM_BINARY);
function identity(){const s=fs.statSync(binary);return {dev:s.dev,ino:s.ino,size:s.size,mtimeMs:s.mtimeMs,sha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex')}}
fs.accessSync(binary,fs.constants.X_OK);const expectedBinary=identity();
const output=path.resolve(process.env.ARTIFACT_DIR||path.join(import.meta.dirname,'artifacts','run-'+Date.now()));
if(fs.existsSync(output))throw Error('Refusing existing ARTIFACT_DIR');fs.mkdirSync(output,{recursive:true});
const report={status:'running',suite,seed:process.env.SEED??null,expected:cases.length,caseOrder:cases.map(c=>c.name),binary,identity:expectedBinary,cases:[]};
const save=()=>fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(report,null,2));save();
for(const c of cases){
 if(JSON.stringify(identity())!==JSON.stringify(expectedBinary)){report.aborted=true;report.error='Binary changed before case '+c.name;break;}
 const dir=path.join(output,c.name);fs.mkdirSync(dir);const log=fs.openSync(path.join(dir,'runner.log'),'w');
 const child=spawnSync(process.execPath,[path.join(import.meta.dirname,'worker.mjs')],{env:{...process.env,HELIUM_BINARY:binary,EXPECTED_BINARY:JSON.stringify(expectedBinary),CASE:c.name,ARTIFACT_DIR:dir},stdio:['ignore',log,log],timeout:600000,killSignal:'SIGKILL'});fs.closeSync(log);
 let data;try{data=JSON.parse(fs.readFileSync(path.join(dir,'results.json'),'utf8'))}catch(e){data={fatal:e.message}}
 const valid=data.cases?.length===1&&data.cases[0].name===c.name;
 const status=valid?data.cases[0].status:'infrastructure-error';
 const clean=data.cleanup?.verified===true&&!data.cleanupError&&!data.releaseError;
 report.cases.push({name:c.name,status:status==='pass'&&(child.status!==0||!clean)?'infrastructure-error':status,exitCode:child.status,error:child.error?.message,fatal:data.fatal,cleanup:data.cleanup,cleanupError:data.cleanupError,releaseError:data.releaseError,binary:data.binary,executedBinary:data.executedBinary,assertions:data.cases});save();
 if(child.error||!clean||data.fatal||!valid){report.aborted=true;break;}
 if(JSON.stringify(identity())!==JSON.stringify(expectedBinary)){report.aborted=true;report.error='Binary changed during case '+c.name;break;}
}
report.counts=report.cases.reduce((counts,c)=>(counts[c.status]=(counts[c.status]||0)+1,counts),{});
report.status=!report.aborted&&report.cases.length===report.expected&&report.cases.every(c=>c.status==='pass')?'pass':'fail';save();
console.log(JSON.stringify({status:report.status,expected:report.expected,recorded:report.cases.length,counts:report.counts,output}));process.exitCode=report.status==='pass'?0:1;

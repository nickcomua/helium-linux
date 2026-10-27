import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const repo = process.env.HELIUM_REPO || path.resolve(import.meta.dirname, '../..');
const binary = process.env.HELIUM_BINARY || path.join(repo, 'build/src/out/Default/helium');
const output = path.resolve(process.env.ARTIFACT_DIR || path.join(repo, 'build/nested-tabs-tests', new Date().toISOString().replaceAll(':', '-')));
if (fs.existsSync(output)) throw new Error(`Refusing to overwrite test run: ${output}`);
fs.mkdirSync(output, {recursive: true});
const hash = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
const batches = [
  ['baseline', 'baseline.mjs', '', 11],
  ['settings-pins-groups-splits', 'extended.mjs', '^(actual|pin|group|split)', 8],
  ['move-owner', 'extended.mjs', '^move child', 1],
  ['move-tree', 'extended.mjs', '^move whole', 1],
  ['cancel-owner', 'extended.mjs', '^real native', 1],
  ['move-leaf', 'extended.mjs', '^leaf child', 1],
  ['minimal-owner', 'extended.mjs', '^minimal two-tab owner', 1],
  ['cancel-leaf', 'extended.mjs', '^minimal two-tab leaf', 1],
];
const report = {binary, sha256: hash, started: new Date().toISOString(), batches: [], cases: []};
let failed = false;
for (const [name, script, filter, expected] of batches) {
  const dir = path.join(output, name);
  fs.mkdirSync(dir);
  const log = fs.openSync(path.join(dir, 'runner.log'), 'w');
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, script)], {
    env: {...process.env, HELIUM_REPO: repo, HELIUM_BINARY: binary, ARTIFACT_DIR: dir, FILTER: filter, PROBE: '0'},
    stdio: ['ignore', log, log], timeout: 240_000,
  });
  fs.closeSync(log);
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')); }
  catch (error) { data = {cases: [], fatal: error.message}; }
  const batchFailed = result.status !== 0 || data.fatal || data.cases.length !== expected || data.cases.some(c => c.status !== 'pass');
  report.batches.push({name, expected, actual: data.cases.length, exitCode: result.status, fatal: data.fatal || result.error?.message, status: batchFailed ? 'fail' : 'pass'});
  report.cases.push(...data.cases.map(c => ({...c, batch: name})));
  failed ||= !!batchFailed;
  report.counts = report.cases.reduce((r, c) => ({...r, [c.status]: (r[c.status] || 0) + 1}), {});
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(`${batchFailed ? 'FAIL' : 'PASS'} ${name}: ${data.cases.length}/${expected} cases`);
  // Never launch another browser on top of a timed-out process.
  if (result.error?.code === 'ETIMEDOUT') break;
}
const expectedTotal = batches.reduce((n, b) => n + b[3], 0);
failed ||= report.cases.length !== expectedTotal || new Set(report.cases.map(c => c.name)).size !== report.cases.length;
report.finished = new Date().toISOString();
report.status = failed ? 'fail' : 'pass';
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({status: report.status, counts: report.counts, expected: expectedTotal, output}));
process.exitCode = failed ? 1 : 0;

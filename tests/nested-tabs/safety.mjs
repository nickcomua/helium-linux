import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

const repo = process.env.HELIUM_REPO || path.resolve(import.meta.dirname, '../..');
const output = path.join(repo, 'build/nested-tabs-tests', 'safety-' + Date.now());
const requests = [];
const server = http.createServer((request, response) => {
  requests.push(request.url);
  response.setHeader('Content-Type', 'application/json');
  response.end('[]');
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(9336, '127.0.0.1', resolve);
});
try {
  for (const script of ['baseline.mjs', 'extended.mjs']) {
    requests.length = 0;
    const dir = path.join(output, script);
    fs.mkdirSync(dir, {recursive: true});
    const child = spawn(process.execPath, [path.join(import.meta.dirname, script)], {
      env: {...process.env, ARTIFACT_DIR: dir, PROBE: '0'}, stdio: 'ignore',
    });
    const code = await new Promise(resolve => child.once('exit', resolve));
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
    assert.equal(code, 1, 'occupied port must fail preflight');
    assert.match(result.fatal, /Port.*occupied/);
    assert.deepEqual(requests, ['/json/list'], 'preflight failure must not attempt Browser.close or query another browser endpoint');
    assert.equal(fs.existsSync(path.join(dir, 'profile')), false, 'preflight must not create a profile or launch a browser');
    console.log(`PASS ${script}: occupied-port refusal performs no cleanup on existing service`);
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}

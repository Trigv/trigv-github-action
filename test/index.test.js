import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Runs src/index.js the way the runner does (INPUT_* env), with fetch replaced by a stub.
function runAction(inputs, stub) {
  const dir = mkdtempSync(join(tmpdir(), 'trigv-action-'));
  const outputFile = join(dir, 'output');
  const preload = join(dir, 'preload.mjs');
  writeFileSync(outputFile, '');
  writeFileSync(preload, `globalThis.fetch = ${stub};`);

  const env = { PATH: process.env.PATH, GITHUB_OUTPUT: outputFile,
    GITHUB_REPOSITORY: 'Trigv/demo',
    GITHUB_RUN_ID: '7',
    GITHUB_SERVER_URL: 'https://github.com',
  };
  for (const [key, value] of Object.entries(inputs)) {
    env[`INPUT_${key.toUpperCase()}`] = value;
  }

  const result = spawnSync(process.execPath, ['--import', preload, new URL('../src/index.js', import.meta.url).pathname], {
    env,
    encoding: 'utf8',
  });

  return { ...result, outputs: readFileSync(outputFile, 'utf8') };
}

const base = { 'api-key': 'trgv_test_key', title: 'Hi', 'fail-on-error': 'false' };

test('a network error keeps the step green when fail-on-error is false', () => {
  const run = runAction(base, `async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); }`);

  assert.equal(run.status, 0);
  assert.match(run.stdout, /::error::Could not reach Trigv: ENOTFOUND/);
  assert.match(run.outputs, /ok<<[^\n]*\nfalse/);
});

test('a network error fails the step when fail-on-error is true', () => {
  const run = runAction({ ...base, 'fail-on-error': 'true' }, `async () => { throw new TypeError('fetch failed'); }`);

  assert.equal(run.status, 1);
  assert.match(run.stdout, /Could not reach Trigv/);
});

test('an accepted event sets the outputs and never prints the key', () => {
  const stub = `async () => ({ status: 202, headers: new Headers({ 'X-Request-ID': 'REQ1' }), text: async () => JSON.stringify({ event: { public_id: '01JXXXXXXXXXXXXXXXXXXXXXXX' } }) })`;
  const run = runAction(base, stub);

  assert.equal(run.status, 0);
  assert.match(run.outputs, /event-public-id<<[^\n]*\n01JXXXXXXXXXXXXXXXXXXXXXXX/);
  assert.match(run.outputs, /request-id<<[^\n]*\nREQ1/);
  const logged = (run.stdout + run.stderr).replace('::add-mask::trgv_test_key', '');
  assert.doesNotMatch(logged, /trgv_test_key/);
  assert.match(run.stdout, /::add-mask::trgv_test_key/);
});

test('an API error fails the step only when fail-on-error is true', () => {
  const stub = `async () => ({ status: 401, headers: new Headers(), text: async () => JSON.stringify({ message: 'Invalid API key.' }) })`;

  assert.equal(runAction(base, stub).status, 0);
  assert.equal(runAction({ ...base, 'fail-on-error': 'true' }, stub).status, 1);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Runs src/index.js the way the runner does (INPUT_* env), with fetch replaced by a stub.
function runAction(inputs, stub, { instantTimers = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'trigv-action-'));
  const outputFile = join(dir, 'output');
  const preload = join(dir, 'preload.mjs');
  writeFileSync(outputFile, '');
  writeFileSync(preload, `globalThis.fetch = ${stub};` + (instantTimers
    ? ' const realSetTimeout = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, 0, ...args);'
    : ''));

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

// A fetch stub that answers with the given responses in order (the last one repeats).
function sequenceStub(...responses) {
  return `(() => { const r = ${JSON.stringify(responses)}; let i = 0; return async () => { const x = r[Math.min(i++, r.length - 1)]; return { status: x.status, headers: new Headers(x.headers ?? {}), text: async () => JSON.stringify(x.body ?? {}) }; }; })()`;
}

const keyedInputs = { ...base, 'idempotency-key': 'run-77' };

test('with a key, a 503 then a 202 is retried and logged in one short line', () => {
  const run = runAction(keyedInputs, sequenceStub({ status: 503, headers: { 'Retry-After': '1' } }, { status: 202, body: { event: { public_id: '01JXXXXXXXXXXXXXXXXXXXXXXX' } } }), { instantTimers: true });

  assert.equal(run.status, 0);
  assert.match(run.stdout, /Trigv returned HTTP 503, retrying in 1s \(attempt 2 of 3\)\./);
  assert.match(run.stdout, /Trigv accepted the event \(HTTP 202\)/);
  assert.doesNotMatch(run.stdout + run.stderr, /run-77/);
  assert.match(run.outputs, /ok<<[^\n]*\ntrue/);
});

test('with a key, a 409 then a 200 duplicate counts as accepted', () => {
  const run = runAction(keyedInputs, sequenceStub({ status: 409, headers: { 'Retry-After': '2' } }, { status: 200, body: { message: 'already stored' } }), { instantTimers: true });

  assert.equal(run.status, 0);
  assert.match(run.outputs, /status<<[^\n]*\n200/);
  assert.match(run.outputs, /ok<<[^\n]*\ntrue/);
});

test('a 429 with a long Retry-After fails fast with the real API error', () => {
  const stub = sequenceStub({ status: 429, headers: { 'Retry-After': '120' }, body: { message: 'Too many requests.' } });
  const run = runAction({ ...keyedInputs, 'fail-on-error': 'true' }, stub);

  assert.equal(run.status, 1);
  assert.match(run.stdout, /Too many requests\./);
  assert.doesNotMatch(run.stdout, /retrying/);
  assert.doesNotMatch(run.stdout, /Set idempotency-key/);
});

test('without a key a 503 or 429 is not retried and the failure adds the hint line', () => {
  for (const status of [503, 429]) {
    const run = runAction({ ...base, 'fail-on-error': 'true' }, sequenceStub({ status, headers: { 'Retry-After': '1' }, body: { message: 'Busy.' } }, { status: 202 }));

    assert.equal(run.status, 1);
    assert.doesNotMatch(run.stdout, /retrying/);
    assert.match(run.stdout, /Busy\./);
    assert.match(run.stdout, /Set idempotency-key to let this action retry safely\./);
  }
});

test('other errors never get the hint and are not retried', () => {
  const run = runAction({ ...keyedInputs, 'fail-on-error': 'true' }, sequenceStub({ status: 422, body: { message: 'Invalid input.' } }, { status: 202 }), { instantTimers: true });

  assert.equal(run.status, 1);
  assert.match(run.stdout, /Invalid input\./);
  assert.doesNotMatch(run.stdout, /retrying|Set idempotency-key/);
});

test('retries are bounded, and fail-on-error false keeps the step green afterwards', () => {
  const run = runAction(keyedInputs, sequenceStub({ status: 503, body: { message: 'Push unavailable.' } }), { instantTimers: true });

  assert.equal(run.status, 0);
  assert.equal((run.stdout.match(/retrying in/g) ?? []).length, 2);
  assert.match(run.stdout, /::error::Push unavailable\./);
  assert.match(run.outputs, /ok<<[^\n]*\nfalse/);
  assert.match(run.outputs, /status<<[^\n]*\n503/);
});

test('retries are bounded, and fail-on-error true fails the step afterwards', () => {
  const run = runAction({ ...keyedInputs, 'fail-on-error': 'true' }, sequenceStub({ status: 503, body: { message: 'Push unavailable.' } }), { instantTimers: true });

  assert.equal(run.status, 1);
  assert.equal((run.stdout.match(/retrying in/g) ?? []).length, 2);
});

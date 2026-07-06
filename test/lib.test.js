import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_URL,
  buildPayload,
  defaultDescription,
  formatRef,
  parseApiError,
  sendEvent,
} from '../src/lib.js';

test('formatRef strips refs/heads and refs/tags prefixes', () => {
  assert.equal(formatRef('refs/heads/main'), 'main');
  assert.equal(formatRef('refs/tags/v1.0.0'), 'v1.0.0');
  assert.equal(formatRef('feature/foo'), 'feature/foo');
});

test('defaultDescription uses GitHub context fields', () => {
  const description = defaultDescription({
    repo: { owner: 'Trigv', repo: 'platform' },
    ref: 'refs/heads/main',
    workflow: 'Deploy',
    serverUrl: 'https://github.com',
    runId: 123,
    sha: 'abcdef1234567890',
  });

  assert.match(description, /Trigv\/platform · Deploy/);
  assert.match(description, /ref main/);
  assert.match(description, /abcdef1/);
  assert.match(description, /actions\/runs\/123/);
});

test('buildPayload defaults channel to general', () => {
  const payload = buildPayload(
    (name) => ({ title: 'Test' }[name] ?? ''),
    {},
  );

  assert.equal(payload.channel, 'general');
});

test('buildPayload maps Trigv ingest fields', () => {
  const payload = buildPayload(
    (name) => ({
      channel: 'deploys',
      title: 'Deploy OK',
      level: 'success',
      'event-type': 'ci.success',
      'delivery-urgency': 'time_sensitive',
      'image-url': 'https://cdn.example.com/chart.png',
      'idempotency-key': 'run-42',
    }[name] ?? ''),
    {
      repo: { owner: 'Trigv', repo: 'platform' },
      ref: 'refs/heads/main',
      workflow: 'Deploy',
      serverUrl: 'https://github.com',
      runId: 1,
      sha: 'abc1234',
    },
  );

  assert.equal(payload.channel, 'deploys');
  assert.equal(payload.title, 'Deploy OK');
  assert.equal(payload.level, 'success');
  assert.equal(payload.event_type, 'ci.success');
  assert.equal(payload.delivery_urgency, 'time_sensitive');
  assert.equal(payload.image_url, 'https://cdn.example.com/chart.png');
  assert.equal(payload.idempotency_key, 'run-42');
});

test('buildPayload rejects invalid level', () => {
  assert.throws(
    () => buildPayload(() => 'critical', {}),
    /Input "level" must be one of/,
  );
});

test('parseApiError prefers Trigv message field', () => {
  assert.equal(parseApiError({ message: 'Channel not found.' }, 404), 'Channel not found.');
});

test('sendEvent posts to Trigv ingest endpoint', async () => {
  let captured = null;

  const fetchImpl = async (url, options) => {
    captured = { url, options };

    return {
      status: 202,
      text: async () => JSON.stringify({ event: { public_id: 'evt_test' } }),
    };
  };

  const result = await sendEvent('trgv_test_key', {
    channel: 'ci',
    title: 'Hello',
    description: 'World',
    level: 'info',
    delivery_urgency: 'standard',
  }, fetchImpl);

  assert.equal(captured.url, API_URL);
  assert.equal(captured.options.method, 'POST');
  assert.match(captured.options.headers.Authorization, /^Bearer trgv_test_key$/);
  assert.deepEqual(JSON.parse(captured.options.body), {
    channel: 'ci',
    title: 'Hello',
    description: 'World',
    level: 'info',
    delivery_urgency: 'standard',
  });
  assert.equal(result.response.status, 202);
});

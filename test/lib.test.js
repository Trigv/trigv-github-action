import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_URL,
  buildPayload,
  defaultDescription,
  formatRef,
  parseApiError,
  resolveEventUrl,
  sendEvent,
  workflowRunUrl,
} from '../src/lib.js';

const githubContext = {
  repo: { owner: 'Trigv', repo: 'platform' },
  ref: 'refs/heads/main',
  workflow: 'Deploy',
  serverUrl: 'https://github.com',
  runId: 123,
  sha: 'abcdef1234567890',
};

test('formatRef strips refs/heads and refs/tags prefixes', () => {
  assert.equal(formatRef('refs/heads/main'), 'main');
  assert.equal(formatRef('refs/tags/v1.0.0'), 'v1.0.0');
  assert.equal(formatRef('feature/foo'), 'feature/foo');
});

test('workflowRunUrl builds GitHub Actions run URL from context', () => {
  assert.equal(
    workflowRunUrl(githubContext),
    'https://github.com/Trigv/platform/actions/runs/123',
  );
});

test('workflowRunUrl returns null when context is insufficient', () => {
  assert.equal(workflowRunUrl({}), null);
  assert.equal(workflowRunUrl({ serverUrl: 'https://github.com' }), null);
});

test('defaultDescription uses GitHub context fields without workflow run URL', () => {
  const description = defaultDescription(githubContext);

  assert.match(description, /Trigv\/platform · Deploy/);
  assert.match(description, /ref main/);
  assert.match(description, /abcdef1/);
  assert.doesNotMatch(description, /actions\/runs\/123/);
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
    githubContext,
  );

  assert.equal(payload.channel, 'deploys');
  assert.equal(payload.title, 'Deploy OK');
  assert.equal(payload.level, 'success');
  assert.equal(payload.event_type, 'ci.success');
  assert.equal(payload.delivery_urgency, 'time_sensitive');
  assert.equal(payload.image_url, 'https://cdn.example.com/chart.png');
  assert.equal(payload.idempotency_key, 'run-42');
  assert.equal(payload.url, 'https://github.com/Trigv/platform/actions/runs/123');
});

test('buildPayload includes explicit url input', () => {
  const payload = buildPayload(
    (name) => ({
      title: 'Deploy OK',
      url: 'https://example.com/deployments/42',
    }[name] ?? ''),
    githubContext,
  );

  assert.equal(payload.url, 'https://example.com/deployments/42');
});

test('explicit url overrides generated workflow run URL', () => {
  const payload = buildPayload(
    (name) => ({
      title: 'Deploy OK',
      url: 'https://example.com/logs/99',
    }[name] ?? ''),
    githubContext,
  );

  assert.equal(payload.url, 'https://example.com/logs/99');
  assert.notEqual(payload.url, workflowRunUrl(githubContext));
});

test('omitted url falls back to GitHub workflow run URL', () => {
  const payload = buildPayload(
    (name) => ({ title: 'Deploy OK' }[name] ?? ''),
    githubContext,
  );

  assert.equal(payload.url, 'https://github.com/Trigv/platform/actions/runs/123');
});

test('empty or whitespace url falls back to workflow run URL', () => {
  const payload = buildPayload(
    (name) => ({
      title: 'Deploy OK',
      url: '   ',
    }[name] ?? ''),
    githubContext,
  );

  assert.equal(payload.url, 'https://github.com/Trigv/platform/actions/runs/123');
});

test('no url is included when workflow context is insufficient', () => {
  const payload = buildPayload(
    (name) => ({ title: 'Deploy OK' }[name] ?? ''),
    {},
  );

  assert.equal(payload.url, undefined);
});

test('buildPayload rejects malformed explicit url', () => {
  assert.throws(
    () => buildPayload(
      (name) => ({
        title: 'Deploy OK',
        url: 'not-a-url',
      }[name] ?? ''),
      githubContext,
    ),
    /Input "url" must be a valid URL/,
  );
});

test('buildPayload rejects over-length explicit url', () => {
  assert.throws(
    () => buildPayload(
      (name) => ({
        title: 'Deploy OK',
        url: `https://example.com/${'a'.repeat(2040)}`,
      }[name] ?? ''),
      githubContext,
    ),
    /Input "url" must be at most 2048 characters/,
  );
});

test('user-provided description remains unchanged', () => {
  const payload = buildPayload(
    (name) => ({
      title: 'Deploy OK',
      description: 'Custom body with https://github.com/Trigv/platform/actions/runs/123',
    }[name] ?? ''),
    githubContext,
  );

  assert.equal(payload.description, 'Custom body with https://github.com/Trigv/platform/actions/runs/123');
});

test('resolveEventUrl returns explicit url when provided', () => {
  const url = resolveEventUrl(
    (name) => ({ url: 'https://example.com/pr/1' }[name] ?? ''),
    githubContext,
  );

  assert.equal(url, 'https://example.com/pr/1');
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

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_URL,
  buildPayload,
  describeNetworkError,
  defaultDescription,
  formatRef,
  parseApiError,
  requestIdFrom,
  parseRetryAfterHeader,
  resolveEventUrl,
  retryBackoffMs,
  sendEvent,
  sendWithRetry,
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
      text: async () => JSON.stringify({ event: { public_id: '01JXXXXXXXXXXXXXXXXXXXXXXX' } }),
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
  assert.equal(captured.url, 'https://api.trigv.com/v1/events');
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

test('API_URL uses the /v1/events path on api.trigv.com', () => {
  assert.equal(API_URL, 'https://api.trigv.com/v1/events');
});

test('parseApiError keeps messages for 409, 422, 429 and 503', () => {
  assert.equal(
    parseApiError({ message: 'This event is being delivered by another request. Retry with the same idempotency_key.' }, 409),
    'This event is being delivered by another request. Retry with the same idempotency_key.',
  );
  assert.equal(
    parseApiError({ message: 'The channel field is required.', errors: { channel: ['x'] } }, 422),
    'The channel field is required.',
  );
  assert.equal(
    parseApiError({ message: 'Too many requests. Try again in 7 seconds.' }, 429),
    'Too many requests. Try again in 7 seconds.',
  );
  assert.equal(
    parseApiError({ message: 'Push delivery is temporarily unavailable. Retry with the same idempotency_key.' }, 503),
    'Push delivery is temporarily unavailable. Retry with the same idempotency_key.',
  );
});

test('parseApiError appends the request id', () => {
  assert.equal(
    parseApiError({ message: 'Invalid API key.' }, 401, '01JREQXXXXXXXXXXXXXXXXXXXX'),
    'Invalid API key. (request id 01JREQXXXXXXXXXXXXXXXXXXXX)',
  );
});

test('requestIdFrom reads X-Request-ID', () => {
  const response = { headers: new Headers({ 'X-Request-ID': '01JREQXXXXXXXXXXXXXXXXXXXX' }) };
  assert.equal(requestIdFrom(response), '01JREQXXXXXXXXXXXXXXXXXXXX');
  assert.equal(requestIdFrom({ headers: new Headers() }), null);
  assert.equal(requestIdFrom({}), null);
});

test('sendEvent returns the response so 200 already stored counts as accepted', async () => {
  const fetchImpl = async () => ({
    status: 200,
    headers: new Headers({ 'X-Request-ID': '01JREQXXXXXXXXXXXXXXXXXXXX' }),
    text: async () => JSON.stringify({ event: { public_id: '01JXXXXXXXXXXXXXXXXXXXXXXX' }, message: 'already stored' }),
  });

  const result = await sendEvent('trgv_test_key', { channel: 'ci', title: 'Hello' }, fetchImpl);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.message, 'already stored');
});

test('sendEvent sends a timeout signal', async () => {
  let signal = null;
  const fetchImpl = async (url, options) => {
    signal = options.signal;
    return { status: 202, text: async () => '' };
  };

  await sendEvent('trgv_test_key', { channel: 'ci', title: 'Hello' }, fetchImpl);

  assert.ok(signal instanceof AbortSignal);
});

test('describeNetworkError gives short messages without the request details', () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  assert.match(describeNetworkError(timeout), /did not respond within 30 seconds/);

  const refused = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  assert.equal(describeNetworkError(refused), 'Could not reach Trigv: ENOTFOUND');
  assert.equal(describeNetworkError(new Error('boom')), 'Could not reach Trigv: boom');
});

const fakeResponse = (status, headers = {}, body = {}) => ({
  status,
  headers: new Headers(headers),
  text: async () => JSON.stringify(body),
});

function sequence(...responses) {
  const calls = [];
  const fetchImpl = async () => {
    calls.push(1);
    return responses[Math.min(calls.length - 1, responses.length - 1)];
  };

  return { fetchImpl, calls };
}

function retryOptions(fetchImpl) {
  const waits = [];
  const logs = [];

  return {
    waits,
    logs,
    options: { fetchImpl, sleepImpl: async (ms) => { waits.push(ms); }, log: (line) => logs.push(line), random: () => 0 },
  };
}

const keyed = { channel: 'ci', title: 'Hi', idempotency_key: 'run-1' };

test('retries a 503 with a key and succeeds on the next 202', async () => {
  const { fetchImpl, calls } = sequence(fakeResponse(503, { 'Retry-After': '3' }), fakeResponse(202));
  const { options, waits, logs } = retryOptions(fetchImpl);
  const { response } = await sendWithRetry('k', keyed, options);

  assert.equal(response.status, 202);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [3000]);
  assert.deepEqual(logs, ['Trigv returned HTTP 503, retrying in 3s (attempt 2 of 3).']);
});

test('retries a 409 with a key and accepts the 200 duplicate', async () => {
  const { fetchImpl } = sequence(fakeResponse(409, { 'Retry-After': '2' }), fakeResponse(200, {}, { message: 'already stored' }));
  const { options, waits } = retryOptions(fetchImpl);
  const { response } = await sendWithRetry('k', keyed, options);

  assert.equal(response.status, 200);
  assert.deepEqual(waits, [2000]);
});

test('a Retry-After longer than 30 seconds fails fast without sleeping', async () => {
  const { fetchImpl, calls } = sequence(fakeResponse(429, { 'Retry-After': '31' }));
  const { options, waits } = retryOptions(fetchImpl);
  const { response } = await sendWithRetry('k', keyed, options);

  assert.equal(response.status, 429);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test('a Retry-After of exactly 30 seconds is still honored', async () => {
  const { fetchImpl } = sequence(fakeResponse(429, { 'Retry-After': '30' }), fakeResponse(202));
  const { options, waits } = retryOptions(fetchImpl);
  await sendWithRetry('k', keyed, options);

  assert.deepEqual(waits, [30000]);
});

test('never retries without an idempotency key', async () => {
  for (const status of [409, 429, 503]) {
    const { fetchImpl, calls } = sequence(fakeResponse(status, { 'Retry-After': '1' }), fakeResponse(202));
    const { options, waits } = retryOptions(fetchImpl);
    const { response } = await sendWithRetry('k', { channel: 'ci', title: 'Hi' }, options);

    assert.equal(response.status, status);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  }
});

test('never retries other 4xx or 5xx statuses', async () => {
  for (const status of [400, 401, 404, 422, 500]) {
    const { fetchImpl, calls } = sequence(fakeResponse(status), fakeResponse(202));
    const { options } = retryOptions(fetchImpl);
    const { response } = await sendWithRetry('k', keyed, options);

    assert.equal(response.status, status);
    assert.equal(calls.length, 1);
  }
});

test('attempts are bounded at 3 and backoff doubles when Retry-After is missing', async () => {
  const { fetchImpl, calls } = sequence(fakeResponse(503));
  const { options, waits, logs } = retryOptions(fetchImpl);
  const { response } = await sendWithRetry('k', keyed, options);

  assert.equal(response.status, 503);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [500, 1000]);
  assert.equal(logs.length, 2);
  assert.doesNotMatch(logs.join(' '), /run-1/);
});

test('backoff jitter stays under 251 ms', () => {
  assert.equal(retryBackoffMs(0, () => 0.999), 750);
  assert.equal(retryBackoffMs(1, () => 0), 1000);
});

test('Retry-After accepts seconds and HTTP-date', async () => {
  const now = Date.parse('2026-11-01T10:00:00Z');

  assert.equal(parseRetryAfterHeader('2', now), 2000);
  assert.equal(parseRetryAfterHeader('1.2', now), 1200);
  assert.equal(parseRetryAfterHeader('Sun, 01 Nov 2026 10:00:05 GMT', now), 5000);
  assert.equal(parseRetryAfterHeader('Sun, 01 Nov 2026 09:00:00 GMT', now), undefined);
  assert.equal(parseRetryAfterHeader('soon', now), undefined);
  assert.equal(parseRetryAfterHeader(null, now), undefined);

  const { fetchImpl } = sequence(fakeResponse(503, { 'Retry-After': 'Sun, 01 Nov 2026 10:00:05 GMT' }), fakeResponse(202));
  const { options, waits } = retryOptions(fetchImpl);
  await sendWithRetry('k', keyed, { ...options, now: () => now });

  assert.deepEqual(waits, [5000]);
});

test('a network error is not retried', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new TypeError('fetch failed'); };
  const { options } = retryOptions(fetchImpl);

  await assert.rejects(sendWithRetry('k', keyed, options), TypeError);
  assert.equal(calls, 1);
});

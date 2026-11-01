export const API_URL = 'https://api.trigv.com/v1/events';
export const LEVELS = new Set(['info', 'success', 'warning', 'error']);
export const REQUEST_TIMEOUT_MS = 30000;
export const MAX_RETRIES = 2;
export const MAX_RETRY_WAIT_MS = 30000;
export const RETRYABLE_STATUSES = new Set([409, 429, 503]);
export const RETRY_HINT = 'Set idempotency-key to let this action retry safely.';
export const URGENCIES = new Set(['standard', 'time_sensitive']);

export function trimOrNull(value) {
  const trimmed = String(value ?? '').trim();

  return trimmed === '' ? null : trimmed;
}

export function codePointLength(value) {
  return [...value].length;
}

export function workflowRunUrl(context) {
  const { repo, serverUrl, runId } = context;

  if (!serverUrl || !repo?.owner || !repo?.repo || runId == null || runId === '') {
    return null;
  }

  return `${serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${runId}`;
}

export function formatRef(ref) {
  if (!ref) {
    return null;
  }

  if (ref.startsWith('refs/heads/')) {
    return ref.slice('refs/heads/'.length);
  }

  if (ref.startsWith('refs/tags/')) {
    return ref.slice('refs/tags/'.length);
  }

  return ref;
}

export function defaultDescription(context) {
  const { repo, ref, workflow, sha } = context;

  const fullName = repo?.owner && repo?.repo ? `${repo.owner}/${repo.repo}` : 'unknown repository';
  const workflowName = workflow ?? 'workflow';
  const refLabel = formatRef(ref);

  const parts = [
    `${fullName} · ${workflowName}`,
    refLabel ? `ref ${refLabel}` : null,
    sha ? sha.slice(0, 7) : null,
  ].filter(Boolean);

  return parts.join('\n');
}

export function validateUrlInput(fieldName, url) {
  if (codePointLength(url) > 2048) {
    throw new Error(`Input "${fieldName}" must be at most 2048 characters.`);
  }

  try {
    new URL(url);
  } catch {
    throw new Error(`Input "${fieldName}" must be a valid URL.`);
  }
}

export function resolveEventUrl(getInput, context) {
  const explicitUrl = trimOrNull(getInput('url'));
  if (explicitUrl) {
    validateUrlInput('url', explicitUrl);
    return explicitUrl;
  }

  return workflowRunUrl(context);
}

export function buildPayload(getInput, context) {
  const channel = trimOrNull(getInput('channel')) ?? 'general';
  const title = trimOrNull(getInput('title'));

  if (!title) {
    throw new Error('Input "title" is required.');
  }

  const level = trimOrNull(getInput('level')) ?? 'info';
  if (!LEVELS.has(level)) {
    throw new Error(`Input "level" must be one of: ${[...LEVELS].join(', ')}`);
  }

  const deliveryUrgency = trimOrNull(getInput('delivery-urgency')) ?? 'standard';
  if (!URGENCIES.has(deliveryUrgency)) {
    throw new Error(`Input "delivery-urgency" must be one of: ${[...URGENCIES].join(', ')}`);
  }

  const description = trimOrNull(getInput('description')) ?? defaultDescription(context);

  const payload = {
    channel,
    title,
    description,
    level,
    delivery_urgency: deliveryUrgency,
  };

  const eventType = trimOrNull(getInput('event-type'));
  if (eventType) {
    payload.event_type = eventType;
  }

  const imageUrl = trimOrNull(getInput('image-url'));
  if (imageUrl) {
    payload.image_url = imageUrl;
  }

  const idempotencyKey = trimOrNull(getInput('idempotency-key'));
  if (idempotencyKey) {
    payload.idempotency_key = idempotencyKey;
  }

  const eventUrl = resolveEventUrl(getInput, context);
  if (eventUrl) {
    payload.url = eventUrl;
  }

  return payload;
}

export function requestIdFrom(response) {
  return trimOrNull(response?.headers?.get?.('X-Request-ID'));
}

export function parseApiError(body, status, requestId = null) {
  const message = apiErrorMessage(body, status);

  return requestId ? `${message} (request id ${requestId})` : message;
}

function apiErrorMessage(body, status) {
  if (body?.message) {
    return body.message;
  }

  if (typeof body?.error === 'string') {
    return body.error;
  }

  return `Trigv API returned HTTP ${status}.`;
}

export function describeNetworkError(error) {
  if (error?.name === 'TimeoutError') {
    return `Trigv did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`;
  }

  const reason = error?.cause?.code ?? error?.cause?.message ?? error?.message ?? 'unknown error';

  return `Could not reach Trigv: ${reason}`;
}

export async function sendEvent(apiKey, payload, fetchImpl = fetch) {
  const response = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  let body = null;

  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  return { response, body };
}

// Retry-After as seconds (whole or fractional) or an HTTP-date. Returns milliseconds, or undefined.
export function parseRetryAfterHeader(value, now = Date.now()) {
  const trimmed = trimOrNull(value);
  if (trimmed === null) {
    return undefined;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const ms = Math.ceil(Number.parseFloat(trimmed) * 1000);

    return Number.isFinite(ms) ? ms : undefined;
  }

  const retryAt = Date.parse(trimmed);
  if (Number.isNaN(retryAt) || retryAt < now) {
    return undefined;
  }

  return retryAt - now;
}

export function retryBackoffMs(attempt, random = Math.random) {
  return 500 * 2 ** attempt + Math.floor(random() * 251);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sends the event. Retries 409, 429 and 503 only when the payload has an idempotency_key,
// because a retry without a key could create a duplicate alert. Network errors are not retried.
export async function sendWithRetry(apiKey, payload, options = {}) {
  const {
    fetchImpl = fetch,
    sleepImpl = sleep,
    log = () => {},
    now = Date.now,
    random = Math.random,
  } = options;
  const canRetry = Boolean(payload.idempotency_key);

  for (let attempt = 0; ; attempt++) {
    const result = await sendEvent(apiKey, payload, fetchImpl);
    const status = result.response.status;

    if (!canRetry || !RETRYABLE_STATUSES.has(status) || attempt >= MAX_RETRIES) {
      return result;
    }

    const retryAfterMs = parseRetryAfterHeader(result.response.headers?.get?.('Retry-After'), now());
    if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_WAIT_MS) {
      return result;
    }

    const waitMs = retryAfterMs ?? retryBackoffMs(attempt, random);
    log(`Trigv returned HTTP ${status}, retrying in ${Math.ceil(waitMs / 1000)}s (attempt ${attempt + 2} of ${MAX_RETRIES + 1}).`);
    await sleepImpl(waitMs);
  }
}

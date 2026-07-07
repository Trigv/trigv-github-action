export const API_URL = 'https://api.trigv.com/api/v1/events';
export const LEVELS = new Set(['info', 'success', 'warning', 'error']);
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

export function parseApiError(body, status) {
  if (body?.message) {
    return body.message;
  }

  if (typeof body?.error === 'string') {
    return body.error;
  }

  return `Trigv API returned HTTP ${status}.`;
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

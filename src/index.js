import * as core from '@actions/core';
import github from '@actions/github';

const API_URL = 'https://api.trigv.com/api/v1/events';
const LEVELS = new Set(['info', 'success', 'warning', 'error']);
const URGENCIES = new Set(['standard', 'time_sensitive']);

function trimOrNull(value) {
  const trimmed = String(value ?? '').trim();

  return trimmed === '' ? null : trimmed;
}

function defaultDescription() {
  const { repository, workflow, serverUrl, runId, refName, sha } = github.context;

  const repo = repository?.full_name ?? 'unknown repository';
  const workflowName = workflow ?? 'workflow';
  const runUrl = serverUrl && repository?.full_name
    ? `${serverUrl}/${repository.full_name}/actions/runs/${runId}`
    : null;

  const parts = [
    `${repo} · ${workflowName}`,
    refName ? `ref ${refName}` : null,
    sha ? sha.slice(0, 7) : null,
    runUrl ? runUrl : null,
  ].filter(Boolean);

  return parts.join('\n');
}

function buildPayload() {
  const channel = trimOrNull(core.getInput('channel')) ?? 'ci';
  const title = trimOrNull(core.getInput('title'));

  if (!title) {
    throw new Error('Input "title" is required.');
  }

  const level = trimOrNull(core.getInput('level')) ?? 'info';
  if (!LEVELS.has(level)) {
    throw new Error(`Input "level" must be one of: ${[...LEVELS].join(', ')}`);
  }

  const deliveryUrgency = trimOrNull(core.getInput('delivery-urgency')) ?? 'standard';
  if (!URGENCIES.has(deliveryUrgency)) {
    throw new Error(`Input "delivery-urgency" must be one of: ${[...URGENCIES].join(', ')}`);
  }

  const description = trimOrNull(core.getInput('description')) ?? defaultDescription();

  const payload = {
    channel,
    title,
    description,
    level,
    delivery_urgency: deliveryUrgency,
  };

  const eventType = trimOrNull(core.getInput('event-type'));
  if (eventType) {
    payload.event_type = eventType;
  }

  const imageUrl = trimOrNull(core.getInput('image-url'));
  if (imageUrl) {
    payload.image_url = imageUrl;
  }

  const idempotencyKey = trimOrNull(core.getInput('idempotency-key'));
  if (idempotencyKey) {
    payload.idempotency_key = idempotencyKey;
  }

  return payload;
}

async function sendEvent(apiKey, payload) {
  const response = await fetch(API_URL, {
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

async function run() {
  const apiKey = trimOrNull(core.getInput('api-key'));
  if (!apiKey) {
    throw new Error('Input "api-key" is required.');
  }

  const failOnError = core.getBooleanInput('fail-on-error');
  const payload = buildPayload();

  core.debug(`Trigv payload: ${JSON.stringify(payload)}`);

  const { response, body } = await sendEvent(apiKey, payload);
  const ok = response.status === 202 || response.status === 200;

  core.setOutput('ok', String(ok));
  core.setOutput('status', String(response.status));
  core.setOutput('response', JSON.stringify(body ?? {}));

  const eventPublicId = body?.event?.public_id ?? '';
  if (eventPublicId) {
    core.setOutput('event-public-id', eventPublicId);
  }

  if (ok) {
    core.info(`Trigv accepted the event (HTTP ${response.status}).`);
    return;
  }

  const message = body?.message ?? body?.error ?? `Trigv API returned HTTP ${response.status}.`;
  core.error(message);

  if (failOnError) {
    throw new Error(message);
  }
}

run().catch((error) => {
  core.setFailed(error.message);
});

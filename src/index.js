import * as core from '@actions/core';
import github from '@actions/github';
import { buildPayload, describeNetworkError, parseApiError, requestIdFrom, sendEvent, trimOrNull } from './lib.js';

async function run() {
  const apiKey = trimOrNull(core.getInput('api-key'));
  if (!apiKey) {
    throw new Error('Input "api-key" is required.');
  }

  core.setSecret(apiKey);

  const failOnError = core.getBooleanInput('fail-on-error');
  const payload = buildPayload((name) => core.getInput(name), github.context);

  core.debug(`Trigv payload: ${JSON.stringify(payload)}`);

  let result;
  try {
    result = await sendEvent(apiKey, payload);
  } catch (error) {
    const message = describeNetworkError(error);
    core.setOutput('ok', 'false');
    if (failOnError) {
      throw new Error(message);
    }
    core.error(message);
    return;
  }

  const { response, body } = result;
  const ok = response.status === 202 || response.status === 200;

  core.setOutput('ok', String(ok));
  core.setOutput('status', String(response.status));
  core.setOutput('response', JSON.stringify(body ?? {}));

  const requestId = requestIdFrom(response);
  if (requestId) {
    core.setOutput('request-id', requestId);
    core.debug(`Trigv X-Request-ID: ${requestId}`);
  }

  const eventPublicId = body?.event?.public_id ?? '';
  if (eventPublicId) {
    core.setOutput('event-public-id', eventPublicId);
  }

  if (ok) {
    core.info(`Trigv accepted the event (HTTP ${response.status}).`);
    return;
  }

  const message = parseApiError(body, response.status, requestId);
  if (failOnError) {
    throw new Error(message);
  }

  core.error(message);
}

run().catch((error) => {
  core.setFailed(error.message);
});

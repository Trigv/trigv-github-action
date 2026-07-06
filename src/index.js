import * as core from '@actions/core';
import github from '@actions/github';
import { buildPayload, parseApiError, sendEvent, trimOrNull } from './lib.js';

async function run() {
  const apiKey = trimOrNull(core.getInput('api-key'));
  if (!apiKey) {
    throw new Error('Input "api-key" is required.');
  }

  const failOnError = core.getBooleanInput('fail-on-error');
  const payload = buildPayload((name) => core.getInput(name), github.context);

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

  const message = parseApiError(body, response.status);
  core.error(message);

  if (failOnError) {
    throw new Error(message);
  }
}

run().catch((error) => {
  core.setFailed(error.message);
});

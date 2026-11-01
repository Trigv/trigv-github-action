import assert from 'node:assert/strict';
import test from 'node:test';
import { getContext } from '../src/context.js';

test('getContext reads the GITHUB_* variables', () => {
  const context = getContext({
    GITHUB_REPOSITORY: 'Trigv/platform',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: 'abcdef1234567890',
    GITHUB_WORKFLOW: 'Deploy',
    GITHUB_SERVER_URL: 'https://github.example.com',
    GITHUB_RUN_ID: '123',
  });

  assert.deepEqual(context, {
    repo: { owner: 'Trigv', repo: 'platform' },
    ref: 'refs/heads/main',
    sha: 'abcdef1234567890',
    workflow: 'Deploy',
    serverUrl: 'https://github.example.com',
    runId: 123,
  });
});

test('getContext defaults serverUrl and leaves missing values undefined', () => {
  const context = getContext({});

  assert.equal(context.serverUrl, 'https://github.com');
  assert.equal(context.repo, undefined);
  assert.equal(context.runId, undefined);
});

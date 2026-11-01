// Reads the GitHub run context from the GITHUB_* environment variables.
// The action only needs these six fields, so it does not depend on @actions/github.
export function getContext(env = process.env) {
  let repo;
  if (env.GITHUB_REPOSITORY) {
    const [owner, name] = env.GITHUB_REPOSITORY.split('/');
    repo = { owner, repo: name };
  }

  return {
    repo,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    workflow: env.GITHUB_WORKFLOW,
    serverUrl: env.GITHUB_SERVER_URL || 'https://github.com',
    runId: env.GITHUB_RUN_ID ? parseInt(env.GITHUB_RUN_ID, 10) : undefined,
  };
}

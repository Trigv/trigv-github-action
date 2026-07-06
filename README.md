# Trigv GitHub Action

Official GitHub Action for [Trigv](https://trigv.com) — send a native push notification from your workflows with one step.

Trigv delivers alerts to your phone; notification title and body stay on your device. This action calls `POST https://api.trigv.com/api/v1/events`.

## Quick start

1. Create an API key at [app.trigv.com](https://app.trigv.com) and subscribe your phone to a channel (e.g. `ci`).
2. Add a repository secret: **`TRIGV_API_KEY`**.
3. Add a step to your workflow:

```yaml
- name: Notify Trigv on failure
  if: failure()
  uses: Trigv/trigv-github-action@v1.0.0
  with:
    api-key: ${{ secrets.TRIGV_API_KEY }}
    channel: ci
    title: Workflow failed
    level: error
    event-type: ci.failed
```

## Notify on success

```yaml
- name: Notify Trigv on success
  if: success()
  uses: Trigv/trigv-github-action@v1.0.0
  with:
    api-key: ${{ secrets.TRIGV_API_KEY }}
    channel: ci
    title: Deploy OK
    level: success
    event-type: ci.success
```

When `description` is omitted, the action fills in repository, workflow, ref, commit, and a link to the workflow run.

Pin the action to an exact release tag (e.g. `@v1.0.0`) so workflow behavior stays predictable.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | yes | — | Trigv workspace API key (`trgv_…`) |
| `channel` | no | `ci` | Channel slug |
| `title` | yes | — | Notification title |
| `description` | no | GitHub context | Notification body |
| `level` | no | `info` | `info`, `success`, `warning`, or `error` |
| `event-type` | no | — | Optional metadata (e.g. `ci.failed`) |
| `delivery-urgency` | no | `standard` | `standard` or `time_sensitive` |
| `image-url` | no | — | Optional HTTPS image URL |
| `idempotency-key` | no | — | Avoid duplicate events on retries |
| `fail-on-error` | no | `false` | Fail the step when the API errors |

## Outputs

| Output | Description |
|--------|-------------|
| `ok` | `true` when Trigv returns HTTP 200 or 202 |
| `status` | HTTP status code |
| `event-public-id` | Trigv event `public_id` when present |
| `response` | JSON string of the API response |

## Docs

- [GitHub Actions guide](https://trigv.com/docs/learn/github-actions/)
- [API errors & rate limits](https://trigv.com/docs/errors/)
- [OpenAPI spec](https://api.trigv.com/openapi.yaml)

## Development

```bash
npm install
npm run build   # bundles src/index.js → dist/index.js
```

Commit `dist/` before tagging a release — GitHub Actions runs the bundled file.

## License

MIT — see [LICENSE](./LICENSE).

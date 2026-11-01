# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-01

### Changed

- The action now calls `https://api.trigv.com/v1/events` (was `https://api.trigv.com/api/v1/events`). The old address still works on the server.
- `public_id` values are 26 character ULIDs (no `evt_` prefix).
- Rate limit is 60 requests per minute per workspace.
- HTTP 200 (`already stored`) still counts as accepted (`ok` is `true`).
- Changed: README and package metadata link to trigv.com docs

### Security

- Removed the `@actions/github` dependency (the action only needs a few `GITHUB_*` variables, now read directly) and updated `@actions/core` to 3.x. `npm audit --omit=dev` is now clean.

### Added

- `request-id` output and request id in error messages (from the `X-Request-ID` header).
- 30 second request timeout. A network error or timeout now respects `fail-on-error` instead of always failing the step.
- Docs for 409, 422, 429 and 503 responses.

### Removed

- Monthly event cap handling. The API no longer returns a monthly cap 429.

## [1.1.0]

- Send the workflow run URL as `url` and add the `url` input.

## [1.0.0]

- Initial release.

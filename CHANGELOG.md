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

### Added

- `request-id` output and request id in error messages (from the `X-Request-ID` header).
- Docs for 409, 422, 429 and 503 responses.

### Removed

- No monthly event cap 429 any more; nothing in the action handled it specially.

## [1.1.0]

- Send the workflow run URL as `url` and add the `url` input.

## [1.0.0]

- Initial release.

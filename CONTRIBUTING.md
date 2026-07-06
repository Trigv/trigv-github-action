# Contributing

Maintainer notes for `Trigv/trigv-github-action`. Not shown on the [Marketplace listing](https://github.com/marketplace/actions/trigv).

## Setup

```bash
npm install
```

## Build

GitHub Actions runs the bundled file in `dist/`, not `src/`:

```bash
npm run build   # bundles src/index.js → dist/index.js
```

## Test

```bash
npm test
```

## Release

1. Change `src/` as needed.
2. Run `npm test` and `npm run build`.
3. Commit `src/` and `dist/` together.
4. Tag an exact version (e.g. `v1.0.1`) and push the tag.
5. Create/update the GitHub release; Marketplace uses the repo README.

Pin consumers to exact tags (e.g. `@v1.0.0`) — do not rely on floating major tags.

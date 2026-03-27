# Contributing

## Development workflow

1. install dependencies with `npm install`
2. run `npm run build`
3. run `npm test`
4. keep local deployment data in ignored `*.local.json` files

## Before opening a pull request

- remove any private or environment-specific values
- do not commit generated configs, runtime data, screenshots, or logs
- prefer updating example configs and docs instead of committing your local setup
- include tests for behavior changes when practical

## Local-only files

Do not commit:

- `config/*.local.json`
- `config/generated/**`
- `data/**`
- `downloads/**`
- `output/**`
- Android build outputs and local SDK config

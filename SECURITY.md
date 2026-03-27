# Security Policy

## Supported Versions

This project is published as source code and example deployment scripts. Security fixes are applied to the latest main branch.

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security-sensitive reports.

Instead:

1. email the maintainer privately
2. include a clear reproduction path
3. include impact, affected deployment mode, and any logs or screenshots with secrets removed

Please avoid sending live tokens, PINs, or private configuration files.

## Sensitive Material

The repository should never contain:

- real `*.local.json` deployment files
- generated runtime configs
- device dumps, logcat output, screenshots, or UI trees from private devices
- live tunnel tokens, API tokens, or session secrets

If you discover any of the above in the repository history, report it privately.

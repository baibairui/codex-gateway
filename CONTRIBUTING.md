# Contributing

Thanks for your interest in contributing.

## Development Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Windows PowerShell:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

## Quality Gate

Before opening a PR, run:

```bash
npm run build
npm test
```

## Commit Style

Use focused commits with clear intent, for example:

- `feat: add xxx`
- `fix: handle xxx`
- `docs: improve xxx`
- `test: add regression for xxx`

## Pull Request Requirements

- Keep PR scope small and focused.
- Include motivation and behavior changes.
- Add or update tests for logic changes.
- Update README/docs when behavior or commands change.

## Reporting Issues

Please include:

- Environment details
- Steps to reproduce
- Expected vs actual behavior
- Logs or screenshots if available

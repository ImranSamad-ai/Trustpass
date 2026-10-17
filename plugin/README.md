# PayBox Plugin Starter (v1.0.2)

Official starter for the MoonPay / PayBox Hackathon Chapter 1.

## Requirements

- Node.js 24 (recommended 24.21.0)
- pnpm 11.11.0
- macOS or Linux (Windows: use WSL2)

## Quick Start

```bash
pnpm install --frozen-lockfile
pnpm test
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the plugin over stdio for local MCP testing |
| `pnpm build` | Bundle into `dist/plugin.mjs` |
| `pnpm test` | Type-check + deterministic build + conformance |
| `pnpm conformance` | Run only the conformance checks |

## What to edit

- Replace the `echo` tool in `src/plugin.ts` with your own tools
- Update `paybox-plugin.json` with a successful sample tool call
- Keep `src/paybox.ts` for transaction / x402 proposals

## Submission

After `pnpm test` passes, upload **only** `dist/plugin.mjs` in the developer portal:
https://developer.paybox.sh/

## Official Docs

- Developer guide: https://developer.paybox.sh/requirements.md
- Agent skill guide: https://developer.paybox.sh/skill.md

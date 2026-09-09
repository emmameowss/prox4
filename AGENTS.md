# AGENTS.md

High-signal guidance for working in this codebase.

## Project overview

Next.js app (v11) hosting a Slack bot for anonymous confessions. Uses TypeORM with Postgres, deployed on Vercel.

## Commands

All commands require `NODE_OPTIONS=--openssl-legacy-provider` due to Next.js v11 + newer Node versions:

```bash
yarn dev          # dev server
yarn build        # production build
yarn start        # production server
yarn type-check   # typecheck only (tsc --noEmit)
```

No test suite exists.

## Architecture quirks

### API pattern: forwarding wrapper

Every public API endpoint (`/api/prox2`, `/api/interaction`, `/api/events`) follows this pattern:
1. Main file (e.g., `prox2.ts`) validates Slack signature
2. Forwards request to `*_work.ts` variant via internal HTTPS with nonce
3. Returns 200 immediately to Slack (meets 3-second requirement)
4. Work endpoint validates nonce and does actual processing

This avoids Slack timeouts. Do not collapse these into single files.

### TypeScript + Babel decorators

Uses TypeORM decorators. Requires:
- `.babelrc` with `babel-plugin-transform-typescript-metadata` and `@babel/plugin-proposal-decorators`
- `tsconfig.json` with `experimentalDecorators` and `emitDecoratorMetadata`
- `import "reflect-metadata"` before TypeORM code

Do not remove decorator config or the `reflect-metadata` import from `lib/db.ts`.

### Secrets handling

`lib/secrets_wrapper.ts` loads config from `secrets.json` (local dev, gitignored) or environment variables (production). Never hardcode channel IDs or tokens.

## File structure

- `pages/api/*.ts` — Next.js API routes (Slack webhooks)
- `lib/main.ts` — core confession logic (stage, approve, reject, undo)
- `lib/db.ts` — TypeORM connection setup
- `lib/models.ts` — `Confession` entity
- `lib/interaction_handlers/` — handlers for Slack interactions (buttons, shortcuts, modals)
- `scripts/` — one-off migration scripts (see `scripts/README.md` for usage)

## Known constraints

- `.gitignore` excludes all `.js` and `.jsx` files — this is intentional to avoid committing build artifacts
- `manifest.yaml` defines Slack app config; keep URLs in sync with deployment
- Postgres connection uses `synchronize: true` (auto-migrate schema on startup)
- No linting, formatting, or pre-commit hooks configured

## Testing locally

Requires:
1. `secrets.json` with valid Slack bot token and channel IDs, or equivalent env vars
2. Postgres instance (connection string in `secrets.json` or `POSTGRES_URL`)
3. ngrok or similar to expose localhost to Slack webhooks

## Deployment

Deployed on Vercel. Environment variables must match those in `secrets_wrapper.ts`.

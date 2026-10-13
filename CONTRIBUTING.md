# Contributing

Requires Node.js `^22.12.0 || ^24.0.0`.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run demo
```

Optional:

```bash
npx playwright install chromium
npm run test:e2e
```

Keep TagReceipt **read-only** against target repositories. Prefer fixture tests for edge cases; real GitHub audits are for demos and smoke only.

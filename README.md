# webhook-lab

A zero-runtime-dependency Node + TypeScript lab for learning how webhooks work and how to debug them.

```
lib/signature.ts        HMAC sign + verify (timestamp tolerance, constant-time compare)
receiver/server.ts      Webhook endpoint: raw body, verify, dedupe, ack-then-process, ?chaos= failure injection
sender/send.ts          Provider simulator: ok | bad-sig | stale | duplicate | retry (with backoff + jitter)
test/webhook.test.ts    7 tests: one per lesson
docs/LEARNING_PLAN.md   Phased exercises (start here)
docs/TROUBLESHOOTING.md Debugging checklist
```

## Quick start
```
npm run receiver                                   # terminal 1
npm run send                                       # terminal 2
npm run send -- --scenario duplicate
npm run send -- --scenario retry --url "http://localhost:3000/webhook?chaos=503"
npm test
npm install && npm run typecheck                   # optional: type-check with tsc
```

Node 22.18+ runs the `.ts` files directly (built-in type stripping), so there is no build step. `npm install` is only needed for `typecheck`.

Chaos modes on the receiver: `?chaos=500` (any status code), `?chaos=slow` (10 s delay), `?chaos=drop` (kill connection).

Start with `docs/LEARNING_PLAN.md`.

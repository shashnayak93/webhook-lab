# Webhook Learning Plan

A hands-on path from "what is a webhook?" to debugging real integrations. Each phase has a concept, an exercise using the `webhook-lab` code, and a "you're done when" check. Budget roughly 30–60 minutes per phase.

**Lab setup (once):** Node 22.18+ (runs the `.ts` files directly), no installs needed.
```
npm run receiver          # terminal 1: listens on :3000
npm run send              # terminal 2: sends one signed event
npm test                  # 7 tests covering the scenarios below
```

---

## Phase 0: Mental model
**Concept:** A webhook is an HTTP POST that a *provider* sends to *your* URL when something happens, so you don't have to poll. You are the server; the provider is the client. That reversal causes most beginner confusion: your endpoint must be publicly reachable, fast, and defensive.

**Key facts to internalize**
- Delivery is **at-least-once**: duplicates and out-of-order events are normal.
- The provider decides retry policy; your **HTTP status code** is your only way to talk back.
- Anyone on the internet can POST to your URL, so you must **verify authenticity**.

**Exercise:** Draw the flow (event → provider queue → POST → your 2xx → done / retry). Write down what happens if your server is down for 10 minutes.

**Done when:** you can explain webhooks vs polling and why "at-least-once" matters.

---

## Phase 1: Receive your first webhook
**Concept:** Endpoint basics: method, path, content type, status codes.

**Exercise**
1. Start the receiver, run `npm run send`. Read the receiver log.
2. Read `receiver/server.ts` top to bottom. Find where it responds vs where it processes.
3. Hit `GET /events` to see what was stored.
4. Try `curl -X POST localhost:3000/webhook -d '{}'`. What status and why?

**Done when:** you can predict the status code for: valid event, unsigned request, bad JSON, wrong path.

---

## Phase 2: Verify signatures (security)
**Concept:** HMAC-SHA256 over `timestamp.rawBody` with a shared secret; constant-time comparison; timestamp tolerance to stop replays.

**Exercise**
1. `npm run send -- --scenario bad-sig` → expect 400 `signature_mismatch`.
2. `npm run send -- --scenario stale` → expect `timestamp_out_of_tolerance`.
3. Read `lib/signature.ts`. Why does it check buffer length before `timingSafeEqual`?
4. **Break it on purpose:** in `receiver/server.ts`, parse the JSON first and verify against `JSON.stringify(parsed)`. Run `npm test`. Which test fails, and why? (This is the #1 real-world signature bug.)

**Done when:** you can explain why the raw bytes matter and why the timestamp is part of the signed string.

---

## Phase 3: Respond fast, process later
**Concept:** Providers time out in ~5–30 s and treat timeouts as failures, which triggers retries and duplicates. Ack with 2xx first, do real work asynchronously.

**Exercise**
1. Start a slow endpoint: send to `http://localhost:3000/webhook?chaos=slow` and watch the sender time out at 5 s.
2. Move `handleEvent` work *before* `send(200…)` and add a 6-second delay. Observe the sender's retry produce a duplicate.
3. Restore the ack-then-process order.

**Done when:** you can describe what happens to a provider's retry queue when your handler is slow.

---

## Phase 4: Idempotency and duplicates
**Concept:** Dedupe by the event's unique ID. Ack duplicates with 2xx (a 4xx makes the provider keep retrying or flag your endpoint as broken).

**Exercise**
1. `npm run send -- --scenario duplicate` → second response is `duplicate`.
2. Restart the receiver and resend the same event ID. It's processed again. Why? (In-memory set.) Sketch a fix using a DB unique constraint on `event_id`.
3. Bonus: make processing itself idempotent (e.g., "set status = paid" rather than "add $42 to balance").

**Done when:** you can explain why in-memory dedupe isn't enough in production and what a unique-key insert gives you.

---

## Phase 5: Retries, backoff, and failure semantics
**Concept:** Which status codes mean "retry" vs "give up"; exponential backoff with jitter; dead-letter handling.

| Your response | Typical provider behavior |
|---|---|
| 2xx | Success, stop |
| 4xx (not 408/429) | Your fault, often **no retry** and may disable endpoint |
| 408 / 429 / 5xx / timeout / connection drop | Retry with backoff |

**Exercise**
1. `npm run send -- --scenario retry --url "http://localhost:3000/webhook?chaos=503"` and watch the backoff schedule.
2. Try `chaos=drop` and `chaos=400`. Compare retry behavior.
3. Make the receiver fail the first 2 attempts per event ID and then succeed. Confirm exactly one processed event.

**Done when:** you can choose the right status code for "bad payload", "temporarily overloaded", and "downstream DB is down".

---

## Phase 6: Ordering, replay, and reconciliation
**Concept:** Events can arrive out of order (`updated` before `created`). Use event timestamps/versions, or re-fetch the resource from the provider API as the source of truth. Plan for missed events: periodic reconciliation, plus manual replay from the provider dashboard.

**Exercise:** Send `order.updated` before `order.created`. Design handling: (a) ignore stale versions, (b) re-fetch, or (c) park until the prerequisite arrives. Write down trade-offs.

**Done when:** you have a written policy for out-of-order and missed events.

---

## Phase 7: Test against a real provider
**Concept:** Real providers add quirks: different signature schemes, secret rotation, IP allowlists, payload versions.

**Exercise**
1. Expose your local server with a tunnel (e.g. ngrok or Cloudflare Tunnel) and point a real provider's test mode at it (Stripe, GitHub, Shopify, Slack all have free webhook testing).
2. Use the provider's delivery log to compare their request to your receiver log.
3. Adapt `lib/signature.ts` to the provider's documented scheme.
4. Use the provider's "resend" button to practice replay.

**Done when:** a real provider's event is verified, deduped, and processed end to end.

---

## Phase 8: Production hardening checklist
- [ ] HTTPS only; secret stored in env/secret manager, never in code
- [ ] Raw-body capture on the signing route only
- [ ] Timestamp tolerance (~5 min) and constant-time compare
- [ ] Durable idempotency (DB unique key)
- [ ] Queue between receiver and workers
- [ ] Body size limit and rate limiting
- [ ] Structured logs with event ID, outcome reason, latency
- [ ] Alerts on failure-rate spikes and delivery gaps
- [ ] Secret rotation procedure (accept old + new during overlap)
- [ ] Reconciliation job for missed events
- [ ] Runbook (see `TROUBLESHOOTING.md`)

---

## Capstone
Build a small real integration (e.g. GitHub push → Slack-style notification, or Stripe test payment → order status) that passes the Phase 8 checklist, and write a one-page postmortem of the three worst bugs you hit.

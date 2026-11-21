# Webhook Troubleshooting Checklist

Work top to bottom. Most problems are found in the first four steps.

## 1. Is the request reaching you at all?
- Check the **provider's delivery log** first (status code, response body, latency, attempt count).
- Is the URL correct, public, and HTTPS? (`localhost` is not reachable by providers: use a tunnel.)
- Firewall / WAF / IP allowlist blocking the provider? Check edge logs, not just app logs.
- Tunnel URL changed after restart? Free tunnels rotate URLs.
- Redirects: many providers **don't follow 301/302**. `http→https` or `/hook→/hook/` redirects silently fail.

## 2. What status are you returning?
| Symptom | Likely cause |
|---|---|
| 404 | Wrong path or method; route not registered |
| 401/403 | Auth middleware or WAF in front of the endpoint |
| 400 `signature_mismatch` | See section 3 |
| 413 | Body limit too small |
| 415 | Server rejects `Content-Type` (some providers send `application/x-www-form-urlencoded`) |
| 5xx | Unhandled exception; check app logs at the delivery timestamp |
| Timeout | Handler too slow; ack first, process async |

## 3. Signature verification failing
1. Are you hashing the **raw request bytes**? JSON middleware that parses and re-serializes changes whitespace and key order.
2. Right **secret**? Test vs live mode and per-endpoint secrets are common mix-ups. Trailing newline/whitespace in env vars too.
3. Right **algorithm and format**? Hex vs base64, `sha256` vs `sha1`, prefix like `sha256=`.
4. Right **signed string**? Some schemes sign `timestamp.body`, others just `body`.
5. Header name casing/proxies: a proxy may rename, drop, or fold headers.
6. Body modified in transit (gzip middleware, proxy rewriting, charset conversion).
7. Clock skew > tolerance: check server time (NTP).
8. Debug safely: log the header, body length, and a hash of the body, **never the secret**.

## 4. Handler logic
- Duplicates processed twice? Add idempotency keyed by event ID.
- Events "missing"? Check whether you filtered them, or dedupe dropped a *different* event that reused an ID.
- Out-of-order data? Compare event timestamps/versions; re-fetch current state from the provider API.
- Works once, then fails? State bug: in-memory dedupe set, connection pool exhaustion, expired token for downstream calls.

## 5. Retries and storms
- A burst of identical events usually means you're timing out or returning 5xx, so the provider is retrying. Fix the root cause, not the volume.
- Returning 4xx for an event you *chose* to ignore can cause the provider to disable your endpoint. Return 2xx for "received, nothing to do".
- After an outage, expect a **thundering herd** of retries; rate limit and queue.

## 6. Reproduce locally
```
npm run receiver
npm run send -- --scenario bad-sig|stale|duplicate|retry
curl -s localhost:3000/events
```
- Capture a real failing payload from the provider log; replay it with its original headers.
- Replay via provider dashboard ("resend") once fixed.

## 7. Useful log fields
`event_id`, `type`, `attempt` (if provided), `signature_ok`, `reject_reason`, `latency_ms`, `status_returned`, `source_ip`.

## 8. Tools
- Request inspectors (webhook.site, RequestBin) to see exactly what the provider sends
- Tunnels (ngrok, Cloudflare Tunnel) for local development
- Provider CLIs (e.g. `stripe listen`, `gh webhook forward`) to forward events locally
- `curl -v` and `node sender/send.js` to simulate

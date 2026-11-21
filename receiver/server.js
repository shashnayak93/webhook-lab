'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { verify } = require('../lib/signature');

// Every rejection/accept is logged with a machine-readable reason: when
// debugging webhooks, "why did we respond that way?" is the first question.

function createServer({
  secret = process.env.WEBHOOK_SECRET || 'whsec_dev_secret',
  logFile = path.join(__dirname, 'events.jsonl'),
  maxBodyBytes = 1024 * 1024,
  quiet = false,
} = {}) {
  const processed = new Set(); // idempotency store (use a DB unique key in production)
  const events = [];

  const log = (...a) => { if (!quiet) console.log(new Date().toISOString(), ...a); };

  function handleEvent(evt) {
    // Do slow work AFTER responding. Providers time out in seconds.
    events.push(evt);
    fs.appendFileSync(logFile, JSON.stringify(evt) + '\n');
    log('processed', evt.id, evt.type);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/events') return send(200, events);
    if (!(req.method === 'POST' && url.pathname === '/webhook')) return send(404, { error: 'not_found' });

    // Collect the RAW bytes. Signatures are computed over the exact bytes sent;
    // parsing then re-serializing JSON changes them and breaks verification.
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBodyBytes) { send(413, { error: 'payload_too_large' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      const raw = Buffer.concat(chunks);

      // Failure injection for practising retries (?chaos=500 | slow | drop)
      const chaos = url.searchParams.get('chaos');
      if (chaos === 'slow') await new Promise((r) => setTimeout(r, 10_000));
      if (chaos === 'drop') { log('chaos: dropping connection'); return req.socket.destroy(); }
      if (/^\d{3}$/.test(chaos || '')) { log('chaos: forced', chaos); return send(Number(chaos), { error: 'chaos' }); }

      const v = verify(secret, req.headers['x-signature'], raw);
      if (!v.ok) {
        log('rejected', v.reason);
        return send(400, { error: v.reason });
      }

      let evt;
      try { evt = JSON.parse(raw.toString('utf8')); }
      catch { log('rejected invalid_json'); return send(400, { error: 'invalid_json' }); }
      if (!evt.id || !evt.type) return send(400, { error: 'missing_id_or_type' });

      // Providers deliver AT LEAST once. Duplicates are normal; ack them with 2xx.
      if (processed.has(evt.id)) {
        log('duplicate (ignored)', evt.id);
        return send(200, { status: 'duplicate' });
      }
      processed.add(evt.id);

      send(200, { status: 'received' });    // ack fast...
      setImmediate(() => handleEvent(evt)); // ...process later
    });
  });

  server.events = events;
  return server;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createServer().listen(port, () => console.log(`receiver listening on :${port}  (POST /webhook)`));
}

module.exports = { createServer };

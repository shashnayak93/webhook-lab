#!/usr/bin/env node
'use strict';
// A tiny webhook *provider* simulator.
// Usage: node sender/send.js [--scenario ok|bad-sig|stale|duplicate|retry] [--url URL] [--secret S]
const crypto = require('crypto');
const { buildHeader } = require('../lib/signature');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const url = args.url || 'http://localhost:3000/webhook';
const secret = args.secret || process.env.WEBHOOK_SECRET || 'whsec_dev_secret';
const scenario = args.scenario || 'ok';

const makeEvent = (type = 'order.created') => ({
  id: 'evt_' + crypto.randomBytes(6).toString('hex'),
  type,
  created: Math.floor(Date.now() / 1000),
  data: { order_id: 'ord_' + crypto.randomBytes(3).toString('hex'), amount: 4200 },
});

async function post(evt, { signature, timeoutMs = 5000 } = {}) {
  const body = JSON.stringify(evt);
  const headers = {
    'Content-Type': 'application/json',
    'X-Signature': signature ?? buildHeader(secret, Buffer.from(body)),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    return { status: res.status, body: await res.text() };
  } finally { clearTimeout(timer); }
}

// Providers retry on 5xx / timeouts / network errors, with backoff + jitter.
// 4xx (except 408/429) means "your request is wrong" - retrying won't help.
async function postWithRetry(evt, maxAttempts = 5, baseMs = 500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let outcome;
    try { outcome = await post(evt); }
    catch (e) { outcome = { status: 0, body: e.name }; }
    console.log(`attempt ${attempt}: status=${outcome.status} ${outcome.body}`);
    const retryable = outcome.status === 0 || outcome.status >= 500 || [408, 429].includes(outcome.status);
    if (!retryable || attempt === maxAttempts) return outcome;
    const delay = baseMs * 2 ** (attempt - 1) * (0.5 + Math.random() / 2);
    console.log(`  retrying in ${Math.round(delay)}ms`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

(async () => {
  const evt = makeEvent();
  switch (scenario) {
    case 'ok':
      console.log(await post(evt)); break;
    case 'bad-sig':
      console.log(await post(evt, { signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` })); break;
    case 'stale': {
      const old = Math.floor(Date.now() / 1000) - 3600;
      console.log(await post(evt, { signature: buildHeader(secret, Buffer.from(JSON.stringify(evt)), old) })); break;
    }
    case 'duplicate':
      console.log('first: ', await post(evt));
      console.log('second:', await post(evt)); break;
    case 'retry':
      // Point at a flaky endpoint: --url "http://localhost:3000/webhook?chaos=503"
      await postWithRetry(evt); break;
    default:
      console.error('unknown scenario'); process.exit(1);
  }
})();

import test from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, type WebhookEvent, type WebhookServer } from '../receiver/server.ts';
import { buildHeader } from '../lib/signature.ts';

const SECRET = 'test_secret';
let server: WebhookServer, base: string;

test.before(async () => {
  server = createServer({ secret: SECRET, logFile: path.join(os.tmpdir(), `wh-${Date.now()}.jsonl`), quiet: true });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/webhook`;
});
test.after(() => server.close());

const post = (evt: WebhookEvent | null, { header, raw, query = '' }: { header?: string; raw?: string; query?: string } = {}) => {
  const body = raw ?? JSON.stringify(evt);
  return fetch(base + query, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': header ?? buildHeader(SECRET, Buffer.from(body)) },
    body,
  });
};
const evt = (id: string): WebhookEvent => ({ id, type: 'order.created', data: {} });

test('valid signed event is accepted', async () => {
  const res = await post(evt('evt_1'));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { status: 'received' });
});

test('duplicate delivery is acknowledged but not reprocessed', async () => {
  await post(evt('evt_dup'));
  const res = await post(evt('evt_dup'));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { status: 'duplicate' });
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(server.events.filter((e) => e.id === 'evt_dup').length, 1);
});

test('bad signature is rejected', async () => {
  const res = await post(evt('evt_bad'), { header: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` });
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).error, 'signature_mismatch');
});

test('missing signature is rejected', async () => {
  const res = await fetch(base, { method: 'POST', body: '{}' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).error, 'missing_signature');
});

test('stale timestamp (replay) is rejected', async () => {
  const body = JSON.stringify(evt('evt_old'));
  const header = buildHeader(SECRET, Buffer.from(body), Math.floor(Date.now() / 1000) - 3600);
  const res = await post(null, { raw: body, header });
  assert.strictEqual((await res.json()).error, 'timestamp_out_of_tolerance');
});

test('re-serialized body breaks the signature (raw-body lesson)', async () => {
  const signedBody = '{"id":"evt_ws","type":"x"}';
  const header = buildHeader(SECRET, Buffer.from(signedBody));
  const res = await post(null, { raw: '{ "id": "evt_ws", "type": "x" }', header }); // same JSON, different bytes
  assert.strictEqual((await res.json()).error, 'signature_mismatch');
});

test('chaos=503 forces a retryable failure', async () => {
  const res = await post(evt('evt_chaos'), { query: '?chaos=503' });
  assert.strictEqual(res.status, 503);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readConfig } from '../dist/config.js';
import { createServer } from '../dist/server.js';
import { signRequest } from '../dist/signing.js';

const credentials = {
  BISADAGANG_API_KEY: 'bdk_test_unit-test',
  BISADAGANG_API_SECRET: 'unit-test-secret',
};
const sandbox = readConfig(credentials);
const production = {
  ...credentials,
  BISADAGANG_API_KEY: 'bdk_live_unit-test',
  BISADAGANG_ENV: 'production',
};
const purchase = { product_code: ' pln20 ', customer_no: ' 081234560001 ', confirm: true };
const fixed = { code: 'PLN20', product_type: 'prepaid', is_open_amount: false, price: 21_500 };
const open = {
  code: 'EWALLET', product_type: 'prepaid', is_open_amount: true, price: null, fee: 1_500,
};
const requestId = 'a1b2c3d4e5';
const ok = (data) => Response.json({ success: true, data, request_id: requestId });
const catalog = (...products) => ok({ products, updated_at: '2026-11-22T01:00:00Z', total: products.length });

async function connect(t, fetcher, config = sandbox) {
  const server = createServer(config, fetcher);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(() => client.close());

  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: result.isError, payload: JSON.parse(result.content[0].text) };
  };
  return { client, call, create: (args) => call('create_transaction', args) };
}

test('signRequest matches the JS examples for an empty GET and a serialized POST', () => {
  const secret = 'rahasia-contoh';
  const timestamp = '1763337600';
  const nonce = '0123456789abcdef0123456789abcdef';
  assert.equal(
    signRequest(secret, 'GET', '/h2h/v1/products?category=Pulsa', timestamp, nonce),
    '1c70ec830551bf90d017616759d563f395be4fbf5528f0beeb01ac5fad71cae6',
  );
  const body = '{"product_code":"PLN20","customer_no":"081234560001","ref_id":"test-001","max_price":21500}';
  assert.equal(
    signRequest(secret, 'post', '/h2h/v1/transactions', timestamp, nonce, body),
    '6ca4349608743c0a6b5c91d0fac4f3b0156fc3bfda0f8ef747345aa2923674dd',
  );
});

test('sandbox is the default and the key prefix must match the environment', () => {
  assert.equal(sandbox.environment, 'sandbox');
  assert.throws(() => readConfig({ ...credentials, BISADAGANG_API_KEY: production.BISADAGANG_API_KEY }), /awalan/i);
  assert.throws(() => readConfig({ ...credentials, BISADAGANG_ENV: 'production' }), /awalan/i);
  assert.equal(readConfig({ ...production, BISADAGANG_ALLOW_PRODUCTION_TRANSACTIONS: 'TRUE' })
    .allowProductionTransactions, false);
});

test('MCP advertises read-only and destructive tools and serves docs without credentials', async (t) => {
  const { client } = await connect(t, async (url, init) => {
    assert.equal(String(url), 'https://bisnis.bisadagang.com/llms-full.txt');
    assert.deepEqual(init.headers, { Accept: 'text/plain' });
    return new Response('# Bisadagang Bisnis');
  });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'create_transaction', 'get_balance', 'get_product', 'get_transaction', 'list_products',
  ]);

  for (const tool of tools) {
    if (tool.name === 'create_transaction') {
      assert.equal(tool.annotations.destructiveHint, true);
      assert.ok(tool.inputSchema.required.includes('confirm'));
    } else {
      assert.equal(tool.annotations.readOnlyHint, true);
    }
  }

  const { resources } = await client.listResources();
  assert.equal(resources.length, 1);
  const { contents } = await client.readResource({ uri: resources[0].uri });
  assert.equal(contents[0].text, '# Bisadagang Bisnis');
});

test('confirm is required and production is blocked before any request', async (t) => {
  let requests = 0;
  const fetcher = async () => { requests++; return ok({}); };
  const { client, create } = await connect(t, fetcher);
  const { confirm, ...withoutConfirm } = purchase;
  const missing = await client.callTool({ name: 'create_transaction', arguments: withoutConfirm });
  assert.equal(missing.isError, true);

  const unconfirmed = await create({ ...purchase, confirm: false, max_price: 21_500 });
  assert.equal(unconfirmed.isError, true);
  assert.equal(unconfirmed.payload.error.code, 'CONFIRMATION_REQUIRED');

  const live = await connect(t, fetcher, readConfig(production));
  const blocked = await live.create({ ...purchase, max_price: 21_500 });
  assert.equal(blocked.isError, true);
  assert.equal(blocked.payload.error.code, 'PRODUCTION_TRANSACTIONS_DISABLED');
  assert.equal(requests, 0);
});

test('fixed transactions omit null fields and use the preceding catalog price as max_price', async (t) => {
  const refs = [];
  const nonces = new Set();
  const { call, create } = await connect(t, async (url, init) => {
    const { method, headers, body } = init;
    const nonce = headers.get('X-Bisadagang-Nonce');
    assert.match(nonce, /^[a-f0-9]{32}$/);
    assert.equal(nonces.has(nonce), false);
    nonces.add(nonce);
    assert.equal(headers.get('X-Bisadagang-Signature'), signRequest(
      sandbox.apiSecret, method, url.pathname + url.search, headers.get('X-Bisadagang-Timestamp'), nonce, body,
    ));

    if (method === 'GET') {
      if (url.pathname.startsWith('/h2h/v1/transactions/')) {
        assert.equal(url.pathname, '/h2h/v1/transactions/' + refs.at(-1));
        return ok({ ref_id: refs.at(-1), status: 'success' });
      }
      assert.equal(url.pathname + url.search, '/h2h/v1/products?category=Pulsa+%26+Data&status=normal&semua=false');
      assert.equal(body, undefined);
      return catalog(fixed);
    }

    const order = JSON.parse(body);
    assert.deepEqual(order, {
      product_code: 'PLN20', customer_no: '081234560001', ref_id: order.ref_id, max_price: 21_500,
    });
    assert.match(order.ref_id, /^mcp-[a-f0-9-]{36}$/);
    assert.equal(headers.get('Idempotency-Key'), 'prepaid:' + order.ref_id);
    refs.push(order.ref_id);
    return ok({ ref_id: order.ref_id, status: 'pending' });
  });

  const lookup = await call('list_products', { category: 'Pulsa & Data', status: 'normal', semua: false });
  assert.equal(lookup.payload.data.total, 1);
  const first = await create({ ...purchase, max_price: null, amount: null, account_check_id: null });
  assert.equal(first.payload.ref_id, refs[0]);
  const second = await create(purchase);
  assert.equal(second.payload.ref_id, refs[1]);
  assert.notEqual(first.payload.ref_id, second.payload.ref_id);
  const status = await call('get_transaction', { ref_id: second.payload.ref_id });
  assert.equal(status.payload.data.status, 'success');
});

test('open amounts use the catalog fee and require a valid account check', async (t) => {
  const checkId = '1be4895b-d15e-4c31-81e2-e85da73d092b';
  const { call, create } = await connect(t, async (url, init) => {
    if (init.method === 'GET') {
      assert.equal(url.pathname + url.search, '/h2h/v1/products?semua=true');
      return catalog(fixed, open);
    }
    const order = JSON.parse(init.body);
    assert.equal(order.max_price, 51_500);
    assert.equal(order.amount, 50_000);
    assert.equal(order.account_check_id, checkId);
    return ok({ ref_id: order.ref_id, status: 'pending' });
  });

  const input = { ...purchase, product_code: 'ewallet', amount: 50_000 };
  const lookup = await call('get_product', { product_code: 'ewallet' });
  assert.equal(lookup.payload.data.fee, 1_500);
  assert.equal((await create(input)).payload.error.code, 'ACCOUNT_CHECK_REQUIRED');
  assert.equal((await create({ ...input, account_check_id: checkId })).payload.data.status, 'pending');
});

test('production opt-in still requires confirmation and accepts an explicit max_price', async (t) => {
  let requests = 0;
  const config = readConfig({ ...production, BISADAGANG_ALLOW_PRODUCTION_TRANSACTIONS: 'true' });
  const { create } = await connect(t, async (url, init) => {
    requests++;
    assert.equal(init.headers.get('X-Bisadagang-Key'), config.apiKey);
    const order = JSON.parse(init.body);
    assert.equal(order.max_price, 20_000);
    return ok({ ref_id: order.ref_id, status: 'pending' });
  }, config);

  const unconfirmed = await create({ ...purchase, confirm: false, max_price: 20_000 });
  assert.equal(unconfirmed.payload.error.code, 'CONFIRMATION_REQUIRED');
  const missingPrice = await create({ ...purchase, max_price: null });
  assert.equal(missingPrice.payload.error.code, 'MAX_PRICE_REQUIRED');
  assert.equal(requests, 0);
  const result = await create({ ...purchase, max_price: 20_000 });
  assert.equal(result.payload.data.status, 'pending');
  assert.equal(requests, 1);
});

test('API errors retain safe fields, and an ambiguous POST returns the original ref without retrying', async (t) => {
  let postedRef;
  let posts = 0;
  const { call, create } = await connect(t, async (url, init) => {
    if (init.method === 'POST') {
      posts++;
      postedRef = JSON.parse(init.body).ref_id;
      throw new Error(sandbox.apiSecret);
    }
    assert.equal(url.pathname, '/h2h/v1/transactions/' + postedRef);
    return Response.json({
      success: false,
      request_id: requestId,
      error: { code: 'RATE_LIMITED', message: sandbox.apiKey, details: sandbox.apiSecret },
    }, { status: 429, headers: { 'Retry-After': '21' } });
  });

  const ambiguous = await create({ ...purchase, max_price: 21_500 });
  assert.equal(ambiguous.isError, true);
  assert.equal(ambiguous.payload.error.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(ambiguous.payload.ref_id, postedRef);
  assert.equal(posts, 1);

  const check = await call('get_transaction', { ref_id: postedRef });
  assert.deepEqual(check.payload.error, {
    code: 'RATE_LIMITED',
    message: 'Batas permintaan tercapai.',
    request_id: requestId,
    retry_after_seconds: 21,
  });
  for (const result of [ambiguous, check]) {
    assert.equal(JSON.stringify(result).includes(sandbox.apiKey), false);
    assert.equal(JSON.stringify(result).includes(sandbox.apiSecret), false);
  }
});

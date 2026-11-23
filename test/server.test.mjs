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
const fixed = {
  code: 'PLN20', product_name: 'Token Listrik 20.000', brand: 'PLN', category: 'Listrik',
  product_type: 'prepaid', is_open_amount: false, price: 21_500, fee: null, status: 'normal', active: true,
};
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
  const spec = { openapi: '3.1.0', info: { title: 'Bisadagang Bisnis' } };
  const { client } = await connect(t, async (url, init) => {
    if (String(url) === 'https://bisnis.bisadagang.com/openapi.json') {
      assert.deepEqual(init.headers, { Accept: 'application/json' });
      return Response.json(spec);
    }
    assert.equal(String(url), 'https://bisnis.bisadagang.com/llms-full.txt');
    assert.deepEqual(init.headers, { Accept: 'text/plain' });
    return new Response('# Bisadagang Bisnis');
  });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'check_account', 'create_transaction', 'get_balance', 'get_product', 'get_summary', 'get_transaction',
    'list_products', 'list_transactions',
  ]);

  for (const tool of tools) {
    if (tool.name === 'create_transaction') {
      assert.equal(tool.annotations.destructiveHint, true);
      assert.ok(tool.inputSchema.required.includes('confirm'));
      assert.match(tool.description, /check_account/);
      assert.match(tool.description, /Idempotency-Key/);
    } else {
      assert.equal(tool.annotations.readOnlyHint, true);
    }
    if (tool.name === 'check_account') assert.equal(tool.annotations.idempotentHint, true);
    if (tool.name === 'list_transactions') assert.match(tool.description, /get_summary.*Samarkan nomor pelanggan/);
    if (tool.name === 'get_summary') assert.match(tool.description, /list_transactions.*Samarkan nomor pelanggan/);
  }

  const { resources } = await client.listResources();
  assert.deepEqual(resources.map(({ name, mimeType }) => [name, mimeType]).sort(), [
    ['llms-full.txt', 'text/plain'], ['openapi.json', 'application/json'],
  ]);
  const docs = await client.readResource({ uri: 'https://bisnis.bisadagang.com/llms-full.txt' });
  assert.equal(docs.contents[0].text, '# Bisadagang Bisnis');
  const openApi = await client.readResource({ uri: 'https://bisnis.bisadagang.com/openapi.json' });
  assert.equal(openApi.contents[0].mimeType, 'application/json');
  assert.equal(openApi.contents[0].text, JSON.stringify(spec, null, 2));
});

test('list_transactions signs filters and the opaque pagination cursor, and returns transaction details', async (t) => {
  const transaction = {
    ref_id: 'order-1', transaction_id: 'trx-1', product_code: 'PLN20', product_name: 'Token Listrik 20.000',
    customer_no: '081234560001', price: 21_500, status: 'failed', sn: null, message: 'Gagal',
    created_at: '2026-11-20T02:00:00Z', updated_at: '2026-11-20T02:01:00Z',
  };
  const cursor = 'page+/=?&';
  const first = { transactions: [transaction], next_cursor: cursor };
  const last = { transactions: [], next_cursor: null };
  const expectedPath = '/h2h/v1/transactions?from=2026-11-16&to=2026-11-22&status=failed&product_code=PLN20&limit=100';
  const { call } = await connect(t, async (url, { method, headers, body }) => {
    const path = url.pathname + url.search;
    assert.equal(method, 'GET');
    assert.equal(body, undefined);
    assert.equal(headers.get('X-Bisadagang-Key'), sandbox.apiKey);
    assert.equal(headers.get('X-Bisadagang-Signature'), signRequest(
      sandbox.apiSecret, 'GET', path, headers.get('X-Bisadagang-Timestamp'), headers.get('X-Bisadagang-Nonce'),
    ));
    if (url.searchParams.has('cursor')) {
      assert.equal(path, expectedPath + '&cursor=page%2B%2F%3D%3F%26');
      return Response.json(last);
    }
    assert.equal(path, expectedPath);
    return Response.json(first);
  });
  const filters = { from: '2026-11-16', to: '2026-11-22', status: 'failed', product_code: 'pln20', limit: 100 };
  const page = (await call('list_transactions', filters)).payload;
  assert.deepEqual(page, { success: true, data: first, request_id: null });
  assert.deepEqual((await call('list_transactions', { ...filters, cursor: page.data.next_cursor })).payload.data, last);
});

test('get_summary signs the grouping and returns totals and breakdown', async (t) => {
  const data = {
    from: '2026-07-01', to: '2026-09-30',
    totals: { count: 4, success_count: 2, failed_count: 1, pending_count: 1, success_rate: 0.5, success_amount: 43_000 },
    breakdown: [{ key: 'PLN20', label: 'Token Listrik 20.000', count: 4, success_count: 2, failed_count: 1, success_amount: 43_000 }],
  };
  const { call } = await connect(t, async (url, { method, headers, body }) => {
    const path = url.pathname + url.search;
    assert.equal(path, '/h2h/v1/summary?from=2026-07-01&to=2026-09-30&group_by=product');
    assert.equal(method, 'GET');
    assert.equal(body, undefined);
    assert.equal(headers.get('X-Bisadagang-Signature'), signRequest(
      sandbox.apiSecret, 'GET', path, headers.get('X-Bisadagang-Timestamp'), headers.get('X-Bisadagang-Nonce'),
    ));
    return ok(data);
  });
  const result = await call('get_summary', { from: data.from, to: data.to, group_by: 'product' });
  assert.deepEqual(result.payload, { success: true, data, request_id: requestId });
});

test('analytics default to seven calendar days in WIB and validate inputs before fetching', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-21T17:00:00Z') });
  const paths = [];
  const { client, call } = await connect(t, async (url) => {
    paths.push(url.pathname + url.search);
    return url.pathname.endsWith('/summary') ? Response.json({
      from: url.searchParams.get('from'), to: url.searchParams.get('to'), breakdown: [],
      totals: { count: 0, success_count: 0, failed_count: 0, pending_count: 0, success_rate: 0, success_amount: 0 },
    }) : ok({ transactions: [], next_cursor: null });
  });
  assert.equal((await call('list_transactions')).payload.success, true);
  assert.equal((await call('get_summary', { group_by: 'day' })).payload.success, true);
  assert.equal((await call('list_transactions', { to: '2026-03-01' })).payload.success, true);
  assert.equal((await call('get_summary', { from: '2026-11-22', group_by: 'day' })).payload.success, true);
  assert.deepEqual(paths, [
    '/h2h/v1/transactions?from=2026-11-16&to=2026-11-22&limit=50',
    '/h2h/v1/summary?from=2026-11-16&to=2026-11-22&group_by=day',
    '/h2h/v1/transactions?from=2026-02-23&to=2026-03-01&limit=50',
    '/h2h/v1/summary?from=2026-11-22&to=2026-11-22&group_by=day',
  ]);
  for (const [name, args] of [
    ['list_transactions', { from: '2026-11-23', to: '2026-11-22' }],
    ['get_summary', { from: '2026-07-01', to: '2026-10-01', group_by: 'day' }],
    ['list_transactions', { from: '2026-02-29' }],
    ['list_transactions', { limit: 101 }],
    ['list_transactions', { limit: 0 }],
    ['list_transactions', { status: 'normal' }],
    ['get_summary', { to: '2026-11-22T00:00:00Z', group_by: 'day' }],
    ['get_summary', { group_by: 'week' }],
  ]) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, JSON.stringify(args));
  }
  assert.equal(paths.length, 4);
});

test('list_products filters locally, counts before limiting, and returns compact products', async (t) => {
  const products = Array.from({ length: 205 }, (_, index) => ({ ...fixed, code: 'PLN' + (index + 20) }));
  const { client, call } = await connect(t, async (url) => {
    assert.equal(url.pathname, '/h2h/v1/products');
    assert.ok(url.search === '' || url.search === '?semua=true');
    return catalog(
      ...products,
      { ...fixed, code: 'PLNA', active: false },
      { ...fixed, code: 'PLNB', status: 'gangguan' },
      { ...fixed, code: 'PLNC', brand: 'Other' },
      { ...fixed, code: 'PLND', category: 'Other' },
    );
  });

  const defaults = await call('list_products');
  assert.equal(defaults.payload.data.total_count, 209);
  assert.equal(defaults.payload.data.products.length, 50);
  assert.equal((await call('list_products', { limit: 200 })).payload.data.products.length, 200);

  const filters = { brand: 'pln', category: 'lIsTrIk', only_available: true, semua: true };
  const byName = await call('list_products', { ...filters, search: 'ToKeN', limit: 1 });
  assert.deepEqual(byName.payload, {
    success: true,
    request_id: requestId,
    data: {
      total_count: 205,
      products: [{
        code: 'PLN20', name: 'Token Listrik 20.000', brand: 'PLN', category: 'Listrik',
        price: 21_500, fee: null, status: 'normal', active: true, is_open_amount: false,
      }],
    },
  });
  const byCode = await call('list_products', { ...filters, search: 'pLn20' });
  assert.equal(byCode.payload.data.total_count, 11);
  assert.equal(byCode.payload.data.products[0].code, 'PLN20');
  assert.deepEqual((await call('list_products', { search: 'missing' })).payload.data,
    { total_count: 0, products: [] });
  for (const limit of [0, 201, 2.5]) {
    const result = await client.callTool({ name: 'list_products', arguments: { limit } });
    assert.equal(result.isError, true);
  }
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

test('fixed transactions generate references and use the preceding catalog price as max_price', async (t) => {
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
      assert.equal(url.pathname + url.search, '/h2h/v1/products?semua=false');
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

  const lookup = await call('list_products', { category: 'Listrik', status: 'normal', semua: false });
  assert.equal(lookup.payload.data.total_count, 1);
  const first = await create(purchase);
  assert.equal(first.payload.ref_id, refs[0]);
  const second = await create(purchase);
  assert.equal(second.payload.ref_id, refs[1]);
  assert.notEqual(first.payload.ref_id, second.payload.ref_id);
  const status = await call('get_transaction', { ref_id: second.payload.ref_id });
  assert.equal(status.payload.data.status, 'success');
});

test('transaction retries reuse the caller reference, idempotency key, and exact body', async (t) => {
  const requests = [];
  const { create } = await connect(t, async (url, init) => {
    requests.push(init);
    if (requests.length === 1) throw new Error('Connection lost after submission');
    return ok({ ref_id: 'Order.123_test-1', transaction_id: 'tx-1', status: 'pending' });
  });
  const input = { ...purchase, ref_id: 'Order.123_test-1', max_price: 21_500 };
  const failed = await create(input);
  assert.equal(failed.isError, true);
  assert.equal(failed.payload.ref_id, input.ref_id);
  const retry = await create(input);
  assert.equal(retry.payload.ref_id, input.ref_id);
  assert.equal(retry.payload.data.transaction_id, 'tx-1');
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].body).ref_id, input.ref_id);
  assert.equal(requests[1].body, requests[0].body);
  for (const { headers } of requests) {
    assert.equal(headers.get('Idempotency-Key'), 'prepaid:' + input.ref_id);
  }
  assert.notEqual(requests[0].headers.get('X-Bisadagang-Nonce'), requests[1].headers.get('X-Bisadagang-Nonce'));
});

test('transaction schemas reject null and invalid references before making a request', async (t) => {
  let requests = 0;
  const { client } = await connect(t, async () => { requests++; return ok({}); });
  for (const fields of [
    { max_price: null }, { amount: null }, { account_check_id: null }, { ref_id: null },
    { ref_id: '' }, { ref_id: 'order/1' }, { ref_id: 'a'.repeat(51) },
  ]) {
    const result = await client.callTool({
      name: 'create_transaction',
      arguments: { ...purchase, max_price: 21_500, ...fields },
    });
    assert.equal(result.isError, true, JSON.stringify(fields));
  }
  assert.equal(requests, 0);
});

test('open amounts use the catalog fee and the check_id from a signed account check', async (t) => {
  const check = {
    check_id: '1be4895b-d15e-4c31-81e2-e85da73d092b',
    product_code: 'EWALLET',
    customer_no: '081234560001',
    account_name: 'Nama Contoh',
    expires_at: '2026-11-22T01:30:00Z',
  };
  const { call, create } = await connect(t, async (url, init) => {
    if (init.method === 'GET') {
      assert.equal(url.pathname + url.search, '/h2h/v1/products?semua=true');
      return catalog(fixed, open);
    }
    const order = JSON.parse(init.body);
    if (url.pathname === '/h2h/v1/account-check') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(order, { product_code: check.product_code, customer_no: check.customer_no });
      assert.equal(init.headers.get('Content-Type'), 'application/json');
      assert.equal(init.headers.has('Idempotency-Key'), false);
      assert.equal(init.headers.get('X-Bisadagang-Signature'), signRequest(
        sandbox.apiSecret, init.method, url.pathname, init.headers.get('X-Bisadagang-Timestamp'),
        init.headers.get('X-Bisadagang-Nonce'), init.body,
      ));
      return ok(check);
    }
    assert.equal(order.max_price, 51_500);
    assert.equal(order.amount, 50_000);
    assert.equal(order.account_check_id, check.check_id);
    return ok({ ref_id: order.ref_id, status: 'pending' });
  });

  const input = { ...purchase, product_code: 'ewallet', amount: 50_000 };
  const lookup = await call('get_product', { product_code: 'ewallet' });
  assert.equal(lookup.payload.data.fee, 1_500);
  assert.equal((await create(input)).payload.error.code, 'ACCOUNT_CHECK_REQUIRED');
  const account = await call('check_account', { product_code: ' ewallet ', customer_no: input.customer_no });
  assert.deepEqual(account.payload, { success: true, data: check, request_id: requestId });
  const result = await create({ ...input, account_check_id: account.payload.data.check_id });
  assert.equal(result.payload.data.status, 'pending');
});

test('check_account rejects invalid destinations before making a request', async (t) => {
  let requests = 0;
  const { client } = await connect(t, async () => { requests++; return ok({}); });
  for (const args of [
    { product_code: 'EWALLET-1', customer_no: '081234560001' },
    { product_code: 'EWALLET', customer_no: 81234560001 },
    { product_code: 'EWALLET', customer_no: '123' },
    { product_code: 'EWALLET' },
  ]) {
    const result = await client.callTool({ name: 'check_account', arguments: args });
    assert.equal(result.isError, true);
  }
  assert.equal(requests, 0);
});

test('transaction creation uses a longer timeout than account checks and GETs', async (t) => {
  const timeout = t.mock.method(AbortSignal, 'timeout', () => new AbortController().signal);
  const { call, create } = await connect(t, async () => ok({}));

  assert.equal((await call('get_balance')).payload.success, true);
  assert.equal((await call('check_account', { product_code: 'EWALLET', customer_no: '081234560001' }))
    .payload.success, true);
  assert.equal((await create({ ...purchase, max_price: 21_500 })).payload.success, true);

  assert.deepEqual(timeout.mock.calls.map(({ arguments: [ms] }) => ms), [10_000, 10_000, 30_000]);
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
  const missingPrice = await create(purchase);
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

import { randomBytes, randomUUID } from 'node:crypto';
import type { components, operations } from './api-types.js';
import type { Config } from './config.js';
import { apiError, BisadagangError, unavailable } from './errors.js';
import { signRequest } from './signing.js';

const apiBase = 'https://api.bisadagang.com/h2h/v1';
type Schemas = components['schemas'];
type Product = Schemas['Product'];
type ProductFilters = NonNullable<operations['listProducts']['parameters']['query']>;
type Order = Schemas['CreateTransaction'];

interface ApiSuccess<T> {
  success: true;
  data: T;
  request_id: string | null;
}

type CreateInput = Pick<Order, 'product_code' | 'customer_no' | 'account_check_id'> & {
  confirm: boolean;
  max_price?: number | null;
  amount?: number | null;
};

export class BisadagangClient {
  private readonly products = new Map<string, Product>();

  constructor(
    private readonly config: Config,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  getBalance() {
    return this.request<Schemas['Balance']>('GET', '/balance');
  }

  async listProducts(filters: ProductFilters) {
    const result = await this.fetchProducts(filters);
    for (const product of result.data.products) this.products.set(product.code, product);
    return result;
  }

  async getProduct(productCode: string) {
    const { data, request_id } = await this.fetchProducts({ semua: true });
    const product = data.products.find(({ code }) => code === productCode);
    if (!product) {
      this.products.delete(productCode);
      throw new BisadagangError('PRODUCT_NOT_FOUND', 'Produk tidak ditemukan.');
    }

    this.products.set(productCode, product);
    return { success: true, data: product, request_id };
  }

  getTransaction(refId: string) {
    return this.request<Schemas['Transaction']>('GET', '/transactions/' + encodeURIComponent(refId));
  }

  async createTransaction(input: CreateInput) {
    if (input.confirm !== true) {
      throw new BisadagangError('CONFIRMATION_REQUIRED', 'Minta konfirmasi pengguna sebelum membuat transaksi.');
    }
    if (this.config.environment === 'production' && !this.config.allowProductionTransactions) {
      throw new BisadagangError('PRODUCTION_TRANSACTIONS_DISABLED', 'Transaksi production belum diaktifkan.');
    }

    const { product_code, customer_no } = input;
    const amount = input.amount ?? undefined;
    const accountCheckId = input.account_check_id ?? undefined;
    const product = this.products.get(product_code);

    if (product?.product_type === 'postpaid') {
      throw new BisadagangError('PRODUCT_NOT_SUPPORTED', 'Pembuatan transaksi ini hanya untuk produk prabayar.');
    }
    if (product?.is_open_amount === false && (amount !== undefined || accountCheckId !== undefined)) {
      throw new BisadagangError('VALIDATION_ERROR', 'Hilangkan amount dan account_check_id untuk produk nominal tetap.');
    }
    if (product?.is_open_amount) {
      if (amount === undefined) {
        throw new BisadagangError('VALIDATION_ERROR', 'Isi amount untuk produk nominal bebas.');
      }
      if (accountCheckId === undefined) {
        throw new BisadagangError('ACCOUNT_CHECK_REQUIRED', 'Isi account_check_id yang masih berlaku.');
      }
    }

    let maxPrice = input.max_price ?? product?.price;
    if (input.max_price == null && product?.is_open_amount && product.fee != null && amount !== undefined) {
      maxPrice = amount + product.fee;
    }
    if (maxPrice == null || !Number.isInteger(maxPrice) || maxPrice < 1 || maxPrice > 100_000_000) {
      throw new BisadagangError(
        'MAX_PRICE_REQUIRED',
        'Ambil harga lewat get_product atau list_products, atau isi max_price yang disetujui pengguna.',
      );
    }

    const ref_id = 'mcp-' + randomUUID();
    const order: Order = { product_code, customer_no, ref_id, max_price: maxPrice };
    if (amount !== undefined) order.amount = amount;
    if (accountCheckId !== undefined) order.account_check_id = accountCheckId;

    try {
      const result = await this.request<Schemas['Transaction']>(
        'POST', '/transactions', order, 'prepaid:' + ref_id,
      );
      return { ...result, ref_id };
    } catch (error) {
      const failure = error instanceof BisadagangError ? error : unavailable();
      failure.refId = ref_id;
      throw failure;
    }
  }

  private fetchProducts({ category, status, semua }: ProductFilters) {
    const query = new URLSearchParams();
    if (category !== undefined) query.set('category', category);
    if (status !== undefined) query.set('status', status);
    if (semua !== undefined) query.set('semua', String(semua));
    const search = query.toString();
    return this.request<Schemas['Products']>('GET', '/products' + (search ? '?' + search : ''));
  }

  private async request<T>(method: 'GET' | 'POST', endpoint: string, order?: Order, idempotencyKey?: string) {
    const url = new URL(apiBase + endpoint);
    const body = order === undefined ? undefined : JSON.stringify(order);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const headers = new Headers({
      Accept: 'application/json',
      'X-Bisadagang-Key': this.config.apiKey,
      'X-Bisadagang-Timestamp': timestamp,
      'X-Bisadagang-Nonce': nonce,
      'X-Bisadagang-Signature': signRequest(
        this.config.apiSecret, method, url.pathname + url.search, timestamp, nonce, body,
      ),
    });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (idempotencyKey !== undefined) headers.set('Idempotency-Key', idempotencyKey);

    let response: Response;
    let payload: (Partial<ApiSuccess<T>> & Parameters<typeof apiError>[0]) | null;
    try {
      response = await this.fetcher(url, {
        method, headers, body, redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      payload = await response.json();
    } catch {
      throw unavailable();
    }

    if (!response.ok || payload?.success !== true || payload.data == null) {
      throw apiError(payload, response);
    }

    return { success: true, data: payload.data, request_id: payload.request_id ?? null } satisfies ApiSuccess<T>;
  }
}

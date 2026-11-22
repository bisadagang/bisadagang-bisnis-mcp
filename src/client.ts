import { randomBytes, randomUUID } from 'node:crypto';
import type { components } from './api-types.js';
import type { Config } from './config.js';
import { apiError, BisadagangError, unavailable } from './errors.js';
import { signRequest } from './signing.js';

const apiBase = 'https://api.bisadagang.com/h2h/v1';
type Schemas = components['schemas'];
type Product = Schemas['Product'];
interface ProductFilters {
  search?: string;
  brand?: string;
  category?: string;
  only_available?: boolean;
  limit: number;
  status?: Product['status'];
  semua?: boolean;
}
type Order = Schemas['CreateTransaction'];
type Transaction = Schemas['Transaction'];

interface DateRange {
  from: string;
  to: string;
}

interface TransactionFilters extends DateRange {
  status?: Transaction['status'];
  product_code?: string;
  limit: number;
  cursor?: string;
}

interface TransactionPage {
  transactions: (Pick<Transaction, 'ref_id' | 'transaction_id' | 'product_code' | 'customer_no'
    | 'price' | 'status' | 'sn' | 'message' | 'created_at'> & { product_name: string; updated_at: string })[];
  next_cursor: string | null;
}

interface SummaryCounts {
  count: number;
  success_count: number;
  failed_count: number;
  success_amount: number;
}

interface Summary extends DateRange {
  totals: SummaryCounts & { pending_count: number; success_rate: number };
  breakdown: (SummaryCounts & { key: string; label: string })[];
}

interface ApiSuccess<T> {
  success: true;
  data: T;
  request_id: string | null;
}

type CreateInput = Pick<Order, 'product_code' | 'customer_no'> & {
  confirm: boolean;
  ref_id?: string;
  max_price?: number;
  amount?: number;
  account_check_id?: string;
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
    const { success, data, request_id } = await this.fetchProducts(filters.semua);
    const search = filters.search?.toLowerCase();
    const brand = filters.brand?.toLowerCase();
    const category = filters.category?.toLowerCase();
    const matches = data.products.filter((product) =>
      (!search || product.code.toLowerCase().includes(search) || product.product_name.toLowerCase().includes(search))
      && (brand === undefined || product.brand.toLowerCase() === brand)
      && (category === undefined || product.category.toLowerCase() === category)
      && (filters.status === undefined || product.status === filters.status)
      && (!filters.only_available || (product.active && product.status === 'normal')),
    );
    const products = matches.slice(0, filters.limit).map((product) => {
      this.products.set(product.code, product);
      const { code, product_name, brand, category, price, fee, status, active, is_open_amount } = product;
      return { code, name: product_name, brand, category, price, fee, status, active, is_open_amount };
    });

    return { success, data: { total_count: matches.length, products }, request_id };
  }

  async getProduct(productCode: string) {
    const { data, request_id } = await this.fetchProducts(true);
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

  listTransactions({ from, to, status, product_code, limit, cursor }: TransactionFilters) {
    const query = new URLSearchParams({ from, to });
    if (status !== undefined) query.set('status', status);
    if (product_code !== undefined) query.set('product_code', product_code);
    query.set('limit', String(limit));
    if (cursor !== undefined) query.set('cursor', cursor);
    return this.getAnalytics<TransactionPage>('/transactions?' + query, 'transactions');
  }

  getSummary({ from, to, group_by }: DateRange & { group_by: 'day' | 'product' }) {
    const query = new URLSearchParams({ from, to, group_by });
    return this.getAnalytics<Summary>('/summary?' + query, 'breakdown');
  }

  checkAccount(destination: Schemas['ProductDestination']) {
    return this.request<Schemas['AccountCheck']>('POST', '/account-check', destination);
  }

  async createTransaction(input: CreateInput) {
    if (input.confirm !== true) {
      throw new BisadagangError('CONFIRMATION_REQUIRED', 'Minta konfirmasi pengguna sebelum membuat transaksi.');
    }
    if (this.config.environment === 'production' && !this.config.allowProductionTransactions) {
      throw new BisadagangError('PRODUCTION_TRANSACTIONS_DISABLED', 'Transaksi production belum diaktifkan.');
    }

    const { product_code, customer_no, amount, account_check_id: accountCheckId } = input;
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
    if (input.max_price === undefined && product?.is_open_amount && product.fee != null && amount !== undefined) {
      maxPrice = amount + product.fee;
    }
    if (maxPrice == null || !Number.isInteger(maxPrice) || maxPrice < 1 || maxPrice > 100_000_000) {
      throw new BisadagangError(
        'MAX_PRICE_REQUIRED',
        'Ambil harga lewat get_product atau list_products, atau isi max_price yang disetujui pengguna.',
      );
    }

    const ref_id = input.ref_id ?? 'mcp-' + randomUUID();
    const order: Order = { product_code, customer_no, ref_id, max_price: maxPrice };
    if (amount !== undefined) order.amount = amount;
    if (accountCheckId !== undefined) order.account_check_id = accountCheckId;

    try {
      const result = await this.request<Schemas['Transaction']>(
        'POST', '/transactions', order, 'prepaid:' + ref_id, 30_000,
      );
      return { ...result, ref_id };
    } catch (error) {
      const failure = error instanceof BisadagangError ? error : unavailable();
      failure.refId = ref_id;
      throw failure;
    }
  }

  private fetchProducts(semua?: boolean) {
    return this.request<Schemas['Products']>('GET', '/products' + (semua === undefined ? '' : '?semua=' + semua));
  }

  private getAnalytics<T>(endpoint: string, rows: keyof T) {
    return this.request<T>('GET', endpoint, undefined, undefined, undefined, rows);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    input?: Order | Schemas['ProductDestination'],
    idempotencyKey?: string,
    timeoutMs = 10_000,
    rows?: keyof T,
  ) {
    const url = new URL(apiBase + endpoint);
    const body = input === undefined ? undefined : JSON.stringify(input);
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
        method, headers, body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      });
      payload = await response.json();
    } catch {
      throw unavailable();
    }

    if (response.ok) {
      if (payload?.success === true && payload.data != null) {
        return { success: true, data: payload.data, request_id: payload.request_id ?? null } satisfies ApiSuccess<T>;
      }
      // Analytics can return the data object directly. Keep the MCP result envelope consistent.
      if (rows !== undefined && payload != null && !('success' in Object(payload))
        && Array.isArray((payload as Partial<T>)[rows])) {
        return { success: true, data: payload as T, request_id: null } satisfies ApiSuccess<T>;
      }
    }
    throw apiError(payload, response);
  }
}

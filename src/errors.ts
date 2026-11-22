import type { components } from './api-types.js';

type Schemas = components['schemas'];
type ApiCode = {
  [Name in keyof Schemas]: Schemas[Name] extends { code: infer Code extends string }
    ? string extends Code ? never : Code
    : never;
}[keyof Schemas];

const apiMessages = {
  ACCOUNT_CHECK_REQUIRED: 'Pengecekan nama yang masih berlaku diperlukan.',
  ACCOUNT_NOT_FOUND: 'Rekening atau dompet digital tidak ditemukan.',
  COMPLAINT_CLOSED: 'Komplain sudah ditutup.',
  COMPLAINT_EXISTS: 'Komplain untuk transaksi ini sudah ada.',
  COMPLAINT_NOT_ALLOWED: 'Transaksi ini tidak dapat dikomplain.',
  COMPLAINT_WINDOW_CLOSED: 'Batas waktu pengajuan komplain sudah lewat.',
  DESTINATION_BLOCKED: 'Nomor tujuan diblokir.',
  DESTINATION_LIMIT_REACHED: 'Batas transaksi nomor tujuan tercapai.',
  HTTPS_REQUIRED: 'API mewajibkan HTTPS.',
  IDEMPOTENCY_KEY_REUSED: 'Kunci idempotensi sudah dipakai untuk permintaan lain.',
  INQUIRY_ALREADY_PAID: 'Tagihan sudah dibayar.',
  INQUIRY_EXPIRED: 'Hasil pengecekan tagihan sudah kedaluwarsa.',
  INQUIRY_FAILED: 'Pengecekan tagihan gagal.',
  INSUFFICIENT_BALANCE: 'Saldo tidak mencukupi.',
  INTERNAL_ERROR: 'Terjadi kesalahan pada server Bisadagang.',
  INVALID_API_KEY: 'API key tidak valid atau sudah tidak berlaku.',
  INVALID_SIGNATURE: 'Tanda tangan atau nonce tidak valid.',
  IP_NOT_WHITELISTED: 'IP pemanggil belum terdaftar.',
  NONCE_REUSED: 'Nonce sudah digunakan.',
  NOT_FOUND: 'Transaksi tidak ditemukan.',
  PARTNER_NOT_ACTIVE: 'Akun Mitra Bisnis belum aktif.',
  PARTNER_SUSPENDED: 'Akun Mitra Bisnis dibekukan.',
  PRICE_CHANGED: 'Harga terbaru melebihi batas yang disetujui.',
  PRODUCT_DISABLED: 'Produk belum aktif.',
  PRODUCT_DISRUPTED: 'Produk sedang gangguan.',
  PRODUCT_NOT_FOUND: 'Produk tidak ditemukan.',
  PRODUCT_NOT_SUPPORTED: 'Produk tidak didukung untuk operasi ini.',
  RATE_LIMITED: 'Batas permintaan tercapai.',
  REF_ID_CONFLICT: 'Referensi sudah dipakai untuk transaksi berbeda.',
  REQUEST_IN_PROGRESS: 'Permintaan masih diproses.',
  SERVICE_MAINTENANCE: 'Layanan sedang dalam pemeliharaan.',
  SUPPLIER_UNAVAILABLE: 'Pemasok sedang tidak tersedia.',
  TIMESTAMP_OUT_OF_RANGE: 'Waktu permintaan berbeda terlalu jauh dari waktu server.',
  UNSUPPORTED_CONTENT_TYPE: 'Isi permintaan harus bertipe application/json.',
  VALIDATION_ERROR: 'Parameter atau isi permintaan tidak valid.',
} satisfies Record<ApiCode, string>;

type LocalCode =
  | 'CONFIRMATION_REQUIRED'
  | 'PRODUCTION_TRANSACTIONS_DISABLED'
  | 'MAX_PRICE_REQUIRED'
  | 'UPSTREAM_UNAVAILABLE';

interface ErrorContext {
  request_id?: string;
  retry_after_seconds?: number;
  price?: number;
  max_price?: number;
}

export class BisadagangError extends Error {
  refId?: string;

  constructor(
    readonly code: ApiCode | LocalCode,
    message: string,
    readonly context: ErrorContext = {},
  ) {
    super(message);
  }

  toResult() {
    return {
      success: false,
      error: { code: this.code, message: this.message, ...this.context },
      ...(this.refId && { ref_id: this.refId }),
    };
  }
}

interface ErrorEnvelope {
  request_id?: unknown;
  error?: {
    code?: unknown;
    details?: { price?: unknown; max_price?: unknown };
  };
}

export function unavailable() {
  return new BisadagangError('UPSTREAM_UNAVAILABLE', 'Respons API Bisadagang tidak dapat diterima.');
}

export function apiError(payload: ErrorEnvelope | null, response: Response): BisadagangError {
  const code = payload?.error?.code;
  if (typeof code !== 'string' || !Object.hasOwn(apiMessages, code)) return unavailable();

  const knownCode = code as ApiCode;
  const context: ErrorContext = {};
  const id = payload?.request_id;
  if (typeof id === 'string' && /^[a-f0-9]{10}$/.test(id)) context.request_id = id;

  const retryAfter = response.headers.get('Retry-After');
  if (knownCode === 'RATE_LIMITED' && retryAfter && /^\d+$/.test(retryAfter)) {
    const seconds = Number(retryAfter);
    if (Number.isSafeInteger(seconds)) context.retry_after_seconds = seconds;
  }

  const details = payload?.error?.details;
  if (knownCode === 'PRICE_CHANGED') {
    if (typeof details?.price === 'number' && Number.isFinite(details.price)) context.price = details.price;
    if (typeof details?.max_price === 'number' && Number.isFinite(details.max_price)) {
      context.max_price = details.max_price;
    }
  }

  return new BisadagangError(knownCode, apiMessages[knownCode], context);
}

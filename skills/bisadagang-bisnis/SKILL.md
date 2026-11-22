---
name: bisadagang-bisnis
description: Integrate the Bisadagang Bisnis H2H PPOB API into a Mitra Bisnis codebase, including request signing, prepaid transactions, status reconciliation, transaction analytics, and webhook verification. Use for implementation, code review, or troubleshooting of this integration.
---

# Integrate Bisadagang Bisnis

Use Indonesian for responses, prompts, and error messages addressed to the Mitra Bisnis. Reuse the codebase's HTTP, persistence, and secret-management conventions.

Read the [OpenAPI contract](https://bisnis.bisadagang.com/openapi.json) for fields and error codes, then consult the [integration guide](https://bisnis.bisadagang.com/llms-full.txt) for scenarios and event examples. Use the matching language in the [Bisadagang examples repository](https://github.com/bisadagang/bisadagang-bisnis-examples) as the signing reference. If the MCP server is connected, read the `openapi.json` resource for the pretty-printed contract and `llms-full.txt` for the guide.

## Authenticate

- Start with a `bdk_test_` API key and its API secret. Both environments use `https://api.bisadagang.com/h2h/v1`. The key selects the environment. Production keys start with `bdk_live_`, use real funds, and require an allowlisted source IP.
- Keep `BISADAGANG_API_KEY` and `BISADAGANG_API_SECRET` on the server. Redact the key, secret, and signatures from logs and user-visible output.
- Build the exact URL and serialize the body once. Compute lowercase SHA-256 hex over the outgoing body bytes, or the empty byte sequence for GET. Join uppercase method, exact path and query (including `/h2h/v1`, encoding and parameter order), Unix timestamp in seconds, nonce, and body hash with LF. Compute lowercase HMAC-SHA256 hex over that string using the entire API secret.
- Send `X-Bisadagang-Key`, `X-Bisadagang-Timestamp`, `X-Bisadagang-Nonce`, and `X-Bisadagang-Signature`. Use a fresh nonce for each attempt, such as 16 random bytes in hex. Keep the clock within 300 seconds of the API clock. Use `Content-Type: application/json` for requests with a body.

## Create and reconcile transactions

- Use MCP `list_products` to find a product by partial code or name with `search`, or by exact `brand` and `category`. Matching is case-insensitive. Set `only_available: true` for active products with `normal` status. The compact product list includes prices and fees, defaults to 50 results, and allows up to 200. `data.total_count` counts matches before the limit. Use `get_product` for full details. Product `sample_size`, `sample_size_30d`, and `sample_size_90d` are tiers of final transactions: `rendah` <50, `sedang` 50?499, `tinggi` >=500; null means not yet computed. Present the tier when discussing sample size.
- Use `POST /transactions` for prepaid products. For open amounts, obtain a current `check_id` from `POST /account-check` for the same product and destination, then send it as `account_check_id` along with `amount`. The total is `amount + fee`. Omit `amount` and `account_check_id` for fixed-denomination products. In MCP, omit any unused `max_price`, `amount`, and `account_check_id` fields. These inputs reject JSON `null`.
- Persist a unique `ref_id`, the serialized body, and a stable `Idempotency-Key` before submission. The key is required for prepaid and bill payments. Reuse the same key, reference, and exact body bytes for a retry of the same operation, and re-sign with a fresh timestamp and nonce. Successful responses are cached for 24 hours per Mitra Bisnis and environment. A reused reference with different order fields causes `REF_ID_CONFLICT`.
- On a timeout or uncertain result, check `GET /transactions/{ref_id}` before any new order. Poll `pending` with bounded backoff and honor `Retry-After` on rate limits. Treat `success` and `failed` as terminal statuses. Transaction `message` is fixed display text; decide transaction outcomes using `status`, never message text, for create, detail, and list responses. Keep an unresolved transaction pending for reconciliation when the polling window ends. Handle API failures using `error.code` and correlate with `request_id`.
- For an interactive MCP purchase, show the product, customer number, and total in rupiah and obtain explicit approval before calling `create_transaction` with `confirm: true`. Use the displayed total as `max_price`. Choose and save a unique `ref_id` before the call. The server generates a reference if omitted. On every retry, reuse the same `ref_id` and identical field values so the server derives the same `Idempotency-Key` and returns the same transaction. If the API returns `PRICE_CHANGED`, show the new price and ask for approval again.

Bill inquiry `details` can be null; its optional fields are `lembar_tagihan`, `tarif`, `daya`, `jumlah_peserta`, and `detail[]` with `periode`, `nilai_tagihan`, `admin`, `denda`, `biaya_lain`, `meter_awal`, and `meter_akhir`. Numeric values may be numbers or digit strings.

## Analyze transactions

- Prefer MCP `get_summary` for totals, successful transaction amount (`totals.success_amount`), success rates, and trends. Use `group_by: "day"` for daily trends and `group_by: "product"` for product comparisons. Use each product's `failed_count` to answer “Produk apa yang paling sering gagal minggu ini?” For “Bandingkan omzet bulan ini dengan bulan lalu,” request a summary for each period and compare `totals.success_amount`.
- Use MCP `list_transactions` for individual transaction details. Filter by `status` (`pending`, `success`, or `failed`) and `product_code` as needed. The default page size is 50 and the maximum is 100. Pass `data.next_cursor` as `cursor` with the same dates and filters to fetch the next page. Stop when `next_cursor` is null. Mask customer numbers in user-facing results, for example `********0001`.
- Both tools are read-only. Use inclusive WIB dates in `YYYY-MM-DD` format for `from` and `to`, up to 92 calendar days. An omitted `to` defaults to today in WIB. An omitted `from` defaults to six days before `to`. Pass explicit dates when comparing periods or paging through results.

## Verify webhooks

- Capture raw body bytes before JSON parsing. Reject timestamps outside the 300-second tolerance. Compute lowercase HMAC-SHA256 over the exact timestamp header, a literal dot, and the raw body, using the full webhook secret.
- Compare valid hex signatures in constant time. The `X-Bisadagang-Signature` header can contain comma-separated signatures during rotation. Accept when one matches an active webhook secret.
- After verification, deduplicate by `event_id` (the `X-Bisadagang-Delivery` value) and apply changes idempotently in the event's environment. Reconcile `transaction.updated` with the stored `ref_id`. Acknowledge delivery after safely recording the event.

Test signing against the published vector and exercise sandbox destinations ending in `0001` through `0005` to cover immediate, delayed, and indefinitely pending outcomes. Summarize the sandbox result and remaining production setup in Indonesian.

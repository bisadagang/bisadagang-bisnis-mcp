import { createHash, createHmac } from 'node:crypto';

// Adapted from examples/js/client.mjs in bisadagang/bisadagang-bisnis-examples (MIT).
export function signRequest(
  secret: string,
  method: string,
  target: string,
  timestamp: string,
  nonce: string,
  body: string | Buffer = '',
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const canonical = [method.toUpperCase(), target, timestamp, nonce, bodyHash].join('\n');
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

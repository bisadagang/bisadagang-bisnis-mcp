import { readFile, writeFile } from 'node:fs/promises';

const liveUrl = 'https://bisnis.bisadagang.com/openapi.json';
const snapshot = new URL('../openapi/openapi.json', import.meta.url);
const response = await fetch(liveUrl, { signal: AbortSignal.timeout(30_000) });

if (!response.ok) throw new Error('OpenAPI Bisadagang: HTTP ' + response.status);

const spec = Buffer.from(await response.arrayBuffer());
if (!JSON.parse(spec.toString('utf8')).openapi) throw new Error('Dokumen OpenAPI tidak valid.');

if (process.argv.includes('--check')) {
  if (!(await readFile(snapshot)).equals(spec)) {
    for (const part of spec.toString('base64').match(/.{1,8000}/g)) console.log('LIVE_SPEC_PART=' + part); throw new Error('Spesifikasi OpenAPI berubah. Jalankan npm run sync:spec dan tinjau perubahannya.');
  }
} else {
  await writeFile(snapshot, spec);
}

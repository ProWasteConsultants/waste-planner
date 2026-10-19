// ── R2 over its S3 API: AWS Signature V4, WebCrypto only ────────────────────
// No SDK: one GET and two PUTs do not justify bundling the AWS client into an
// edge function. Runs unchanged in Deno and in Node ≥ 20 (globalThis.crypto),
// so tests/publish-rates.test.js checks the signer against AWS's published
// example signatures.

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(data) {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
// RFC 3986 per path segment; "/" separators kept (S3 does not double-encode).
export const s3EncodePath = p => p.split('/').map(seg => encodeURIComponent(seg)
  .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');

// Returns the Authorization header for a request. `headers` must already
// carry host, x-amz-date and x-amz-content-sha256; every header given is
// signed.
export async function s3Authorization({ method, path, query = '', headers, accessKeyId, secretAccessKey, region = 'auto', service = 's3' }) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const names = Object.keys(h).sort();
  const amzDate = h['x-amz-date'], day = amzDate.slice(0, 8);
  const canonical = [method, s3EncodePath(path), query,
    names.map(n => n + ':' + h[n] + '\n').join(''), names.join(';'), h['x-amz-content-sha256']].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n');
  let key = await hmac('AWS4' + secretAccessKey, day);
  key = await hmac(key, region); key = await hmac(key, service); key = await hmac(key, 'aws4_request');
  const sig = hex(await hmac(key, toSign));
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`;
}

// cfg: { accountId, accessKeyId, secretAccessKey, bucket }
export function r2Client(cfg, fetchImpl = fetch) {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const send = async (method, key, body = '', extra = {}) => {
    const path = `/${cfg.bucket}/${key}`;
    const bytes = typeof body === 'string' ? enc.encode(body) : body;
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const headers = { host, 'x-amz-date': amzDate, 'x-amz-content-sha256': await sha256Hex(bytes), ...extra };
    headers.authorization = await s3Authorization({ method, path, headers, ...cfg });
    delete headers.host;   // fetch sets it
    return fetchImpl(`https://${host}${s3EncodePath(path)}`, { method, headers, body: method === 'GET' ? undefined : bytes });
  };
  return {
    // null when the object does not exist yet (first publish)
    async getText(key) {
      const r = await send('GET', key);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`R2 GET ${key}: ${r.status} ${await r.text()}`);
      return r.text();
    },
    async putJson(key, text) {
      const r = await send('PUT', key, text, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
      if (!r.ok) throw new Error(`R2 PUT ${key}: ${r.status} ${await r.text()}`);
    },
  };
}

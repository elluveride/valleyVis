// Share links: a routine (and optionally the robot settings) packed into the URL hash.
// "#r=1<base64url of deflate-raw JSON>" or "#r=0<base64url of plain JSON>" when the browser
// has no CompressionStream. Nothing is uploaded anywhere: the link itself is the data.

const PREFIX = 'r=';

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter();
  // a damaged link makes these reject too; the read below reports the failure once
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** payload: { project, settings? } -> text for the URL hash (without the leading #). */
export async function encodeShare(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, ...payload }));
  if (canCompress()) {
    try {
      return `${PREFIX}1${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
    } catch {
      // fall through to the uncompressed form
    }
  }
  return `${PREFIX}0${toBase64Url(bytes)}`;
}

/** Hash text (with or without the leading #) -> payload, or null if it is not a share link. Throws on a damaged link. */
export async function decodeShare(hash) {
  const text = String(hash || '').replace(/^#/, '');
  if (!text.startsWith(PREFIX)) return null;
  const kind = text.charAt(PREFIX.length);
  const body = text.slice(PREFIX.length + 1);
  let bytes = fromBase64Url(body);
  if (kind === '1') {
    if (!canCompress()) throw new Error('this browser cannot open compressed share links');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind !== '0') {
    throw new Error('unknown share link format');
  }
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (!payload || typeof payload !== 'object' || !payload.project) throw new Error('the link has no routine in it');
  return payload;
}

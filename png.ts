const SIGNATURE = 8;
const TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt']);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

/** The keyword of the XMP packet, which is always an iTXt chunk. */
const XMP = 'XML:com.adobe.xmp';

/** A text chunk: tEXt where every character is ASCII, which more programs
 *  show and every reader decodes alike, else an uncompressed iTXt in UTF-8. */
function textChunk(keyword: string, text: string): Uint8Array {
  const key = latin1(keyword);
  if (keyword !== XMP && /^[\x00-\x7f]*$/.test(text)) {
    const body = latin1(text);
    const data = new Uint8Array(key.length + 1 + body.length);
    data.set(key, 0);
    data.set(body, key.length + 1);
    return chunk('tEXt', data);
  }
  const body = new TextEncoder().encode(text);
  const data = new Uint8Array(key.length + 5 + body.length);
  data.set(key, 0);
  data.set(body, key.length + 5);
  return chunk('iTXt', data);
}

interface Chunk {
  type: string;
  whole: Uint8Array;
  data: Uint8Array;
}

function* chunksOf(png: Uint8Array): Generator<Chunk> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = SIGNATURE; at < png.length;) {
    const length = view.getUint32(at);
    yield {
      type: String.fromCharCode(...png.subarray(at + 4, at + 8)),
      whole: png.subarray(at, at + 12 + length),
      data: png.subarray(at + 8, at + 8 + length),
    };
    at += 12 + length;
  }
}

/** The uncompressed text of a PNG by keyword, read as UTF-8, which is what
 *  image runtimes write even into tEXt. */
export function readText(png: Uint8Array): Record<string, string> {
  const text: Record<string, string> = {};
  const decoder = new TextDecoder();
  for (const { type, data } of chunksOf(png)) {
    const end = data.indexOf(0);
    if (end < 0) continue;
    const keyword = String.fromCharCode(...data.subarray(0, end));
    if (type === 'tEXt') text[keyword] = decoder.decode(data.subarray(end + 1));
    if (type === 'iTXt' && data[end + 1] === 0) {
      const language = data.indexOf(0, end + 3);
      const translated = language < 0 ? -1 : data.indexOf(0, language + 1);
      if (translated >= 0) text[keyword] = decoder.decode(data.subarray(translated + 1));
    }
  }
  return text;
}

/** A PNG with every text chunk replaced by `text`, written after the header. */
export function withText(png: Uint8Array, text: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [png.subarray(0, SIGNATURE)];
  for (const { type, whole } of chunksOf(png)) {
    if (!TEXT_CHUNKS.has(type)) parts.push(whole);
    if (type === 'IHDR') for (const [keyword, words] of Object.entries(text)) parts.push(textChunk(keyword, words));
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const alt = (text: string) => `<rdf:Alt><rdf:li xml:lang="x-default">${escaped(text)}</rdf:li></rdf:Alt>`;

/** An XMP packet as the PNG text `{ [XMP]: packet }`: the fields Windows
 *  shows as Title, Comments, Program name and Date taken, and that photo
 *  programs show as title, description and comment. `created` is an ISO
 *  time with its offset. */
export function xmpOf(fields: {
  title: string;
  description: string | null;
  comment: string;
  tool: string;
  created: string;
}): Record<string, string> {
  const description = fields.description ? `<dc:description>${alt(fields.description)}</dc:description>` : '';
  return {
    [XMP]: [
      `<?xpacket begin="${String.fromCharCode(0xfeff)}" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/">',
      `<dc:title>${alt(fields.title)}</dc:title>`,
      description,
      `<exif:UserComment>${alt(fields.comment)}</exif:UserComment>`,
      `<xmp:CreatorTool>${escaped(fields.tool)}</xmp:CreatorTool>`,
      `<xmp:CreateDate>${fields.created}</xmp:CreateDate>`,
      '</rdf:Description></rdf:RDF></x:xmpmeta>',
      '<?xpacket end="w"?>',
    ].join('\n'),
  };
}

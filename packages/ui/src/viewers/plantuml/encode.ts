// PlantUML's URL text encoding: raw deflate, then a base64 variant over 0-9A-Za-z-_.
import { deflateRaw, inflateRaw } from 'pako';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function encode6(b: number): string {
  return ALPHABET[b & 0x3f]!;
}

function encode3(b1: number, b2: number, b3: number): string {
  return (
    encode6(b1 >> 2) +
    encode6(((b1 & 0x3) << 4) | (b2 >> 4)) +
    encode6(((b2 & 0xf) << 2) | (b3 >> 6)) +
    encode6(b3 & 0x3f)
  );
}

export function encodeBytes(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const b1 = data[i]!;
    const b2 = i + 1 < data.length ? data[i + 1]! : 0;
    const b3 = i + 2 < data.length ? data[i + 2]! : 0;
    out += encode3(b1, b2, b3);
  }
  return out;
}

export function decodeBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < text.length ? ALPHABET.indexOf(text[i + k]!) : 0));
    out.push(
      ((c[0]! << 2) | (c[1]! >> 4)) & 0xff,
      (((c[1]! & 0xf) << 4) | (c[2]! >> 2)) & 0xff,
      (((c[2]! & 0x3) << 6) | c[3]!) & 0xff,
    );
  }
  return Uint8Array.from(out);
}

export function encodePlantUml(source: string): string {
  return encodeBytes(deflateRaw(new TextEncoder().encode(source), { level: 9 }));
}

export function decodePlantUml(encoded: string): string {
  // The encoder pads to a multiple of 3 bytes; strip up to two padding zeros until inflate accepts it.
  const bytes = decodeBytes(encoded);
  let lastError: unknown;
  for (let trim = 0; trim <= 2; trim++) {
    try {
      return new TextDecoder().decode(inflateRaw(bytes.subarray(0, bytes.length - trim)));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

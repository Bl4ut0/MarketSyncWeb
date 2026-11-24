import rawVectors from './codec-vectors.json' with { type: 'json' };
import type { CodecErrorCode, ShoppingList, ShoppingListInput } from './types.js';

export interface Crc32CheckVector {
  readonly id: string;
  readonly input: string;
  readonly expectedHex: string;
}

export interface CanonicalCodecVector {
  readonly id: string;
  readonly input: ShoppingListInput;
  readonly expectedDecoded?: ShoppingList;
  readonly wire: string;
}

export interface NonCanonicalDecodeVector {
  readonly id: string;
  readonly wire: string;
  readonly expectedDecoded: ShoppingList;
  readonly expectedCanonicalWire?: string;
}

export interface InvalidCodecVector {
  readonly id: string;
  readonly wire: string;
  readonly expectedCode: CodecErrorCode;
}

export interface CodecVectorSuite {
  readonly version: number;
  readonly crc32Checks: readonly Crc32CheckVector[];
  readonly canonicalVectors: readonly CanonicalCodecVector[];
  readonly nonCanonicalDecodeVectors: readonly NonCanonicalDecodeVector[];
  readonly invalidVectors: readonly InvalidCodecVector[];
}

export const CODEC_VECTORS: CodecVectorSuite =
  rawVectors as unknown as CodecVectorSuite;

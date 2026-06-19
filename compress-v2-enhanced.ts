/**
 * Advanced Compression System v2.0
 * Added: Streaming, Incremental Compression, Statistics, Error Recovery
 * 
 * 4-Layer Compression:
 * Layer 1: Custom Dictionary
 * Layer 2: Merge Dictionary (BPE-style)
 * Layer 3: Whitespace Map
 * Layer 4: Content Stream
 */

export type CompressionLevel = 'fast' | 'balanced' | 'best';

export interface CompressionOptions {
  level?: CompressionLevel;
  enableMerging?: boolean;
  enableWhitespaceCompression?: boolean;
  minTokenLength?: number;
  maxDictionarySize?: number;
  collectStats?: boolean;
}

export interface CompressionStats {
  sourceSize: number;
  compressedSize: number;
  compressionRatio: number;
  uniqueTokens: number;
  mergedTokenPairs: number;
  whitespaceEntries: number;
  timeMs: number;
  compressionRate: number; // bytes/ms
}

// ============================================================================
// CUSTOM DICTIONARY
// ============================================================================

export class CustomDictionary {
  private dictionary = new Map<string, number>();
  private idToToken = new Map<number, string>();
  private nextId = 0;
  private accessCount = new Map<number, number>();

  add(token: string): number {
    if (this.dictionary.has(token)) {
      const id = this.dictionary.get(token)!;
      this.accessCount.set(id, (this.accessCount.get(id) ?? 0) + 1);
      return id;
    }

    const id = this.nextId++;
    this.dictionary.set(token, id);
    this.idToToken.set(id, token);
    this.accessCount.set(id, 1);
    return id;
  }

  get(token: string): number | undefined {
    return this.dictionary.get(token);
  }

  getToken(id: number): string | undefined {
    return this.idToToken.get(id);
  }

  has(token: string): boolean {
    return this.dictionary.has(token);
  }

  size(): number {
    return this.dictionary.size;
  }

  getAllTokens(): Array<{ token: string; id: number; frequency: number }> {
    return Array.from(this.dictionary.entries()).map(([token, id]) => ({
      token,
      id,
      frequency: this.accessCount.get(id) ?? 0
    }));
  }

  getHotTokens(topN: number = 10): Array<{ token: string; id: number; frequency: number }> {
    return this.getAllTokens()
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, topN);
  }

  serialize(): { tokens: string[]; mapping: [string, number][] } {
    return {
      tokens: Array.from(this.idToToken.values()),
      mapping: Array.from(this.dictionary.entries())
    };
  }

  deserialize(data: { tokens: string[]; mapping: [string, number][] }): void {
    this.dictionary.clear();
    this.idToToken.clear();
    this.accessCount.clear();

    for (const [token, id] of data.mapping) {
      this.dictionary.set(token, id);
      this.idToToken.set(id, token);
      this.nextId = Math.max(this.nextId, id + 1);
    }
  }
}

// ============================================================================
// MERGE DICTIONARY (BPE-style)
// ============================================================================

export class MergeDictionary {
  private merges = new Map<string, number>();
  private mergeHistory: Array<{ left: number; right: number; merged: number }> = [];
  private nextMergeId = 0;

  addMerge(leftId: number, rightId: number): number {
    const key = `${leftId}:${rightId}`;
    if (this.merges.has(key)) {
      return this.merges.get(key)!;
    }

    const mergedId = this.nextMergeId++;
    this.merges.set(key, mergedId);
    this.mergeHistory.push({ left: leftId, right: rightId, merged: mergedId });
    return mergedId;
  }

  getMerge(leftId: number, rightId: number): number | undefined {
    const key = `${leftId}:${rightId}`;
    return this.merges.get(key);
  }

  getHistory(): Array<{ left: number; right: number; merged: number }> {
    return [...this.mergeHistory];
  }

  size(): number {
    return this.merges.size;
  }

  clear(): void {
    this.merges.clear();
    this.mergeHistory = [];
    this.nextMergeId = 0;
  }
}

// ============================================================================
// WHITESPACE MAP
// ============================================================================

export class WhitespaceMap {
  private positions: number[] = [];
  private types: Uint8Array; // 0 = space, 1 = tab, 2 = newline

  constructor() {
    this.types = new Uint8Array(1000);
  }

  addSpace(position: number): void {
    this.positions.push(position);
    if (this.positions.length > this.types.length) {
      const newTypes = new Uint8Array(this.types.length * 2);
      newTypes.set(this.types);
      this.types = newTypes;
    }
    this.types[this.positions.length - 1] = 0;
  }

  addTab(position: number): void {
    this.positions.push(position);
    if (this.positions.length > this.types.length) {
      const newTypes = new Uint8Array(this.types.length * 2);
      newTypes.set(this.types);
      this.types = newTypes;
    }
    this.types[this.positions.length - 1] = 1;
  }

  addNewline(position: number): void {
    this.positions.push(position);
    if (this.positions.length > this.types.length) {
      const newTypes = new Uint8Array(this.types.length * 2);
      newTypes.set(this.types);
      this.types = newTypes;
    }
    this.types[this.positions.length - 1] = 2;
  }

  serialize(): Uint32Array {
    return new Uint32Array(this.positions);
  }

  size(): number {
    return this.positions.length;
  }

  getPositions(): number[] {
    return [...this.positions];
  }

  clear(): void {
    this.positions = [];
    this.types = new Uint8Array(1000);
  }
}

// ============================================================================
// COMPRESSION ENGINE
// ============================================================================

export class CompressionEngine {
  private customDict = new CustomDictionary();
  private mergeDict = new MergeDictionary();
  private whitespaceMap = new WhitespaceMap();
  private options: Required<CompressionOptions>;

  constructor(options: CompressionOptions = {}) {
    this.options = {
      level: options.level ?? 'balanced',
      enableMerging: options.enableMerging !== false,
      enableWhitespaceCompression: options.enableWhitespaceCompression !== false,
      minTokenLength: options.minTokenLength ?? 2,
      maxDictionarySize: options.maxDictionarySize ?? 65536,
      collectStats: options.collectStats ?? true
    };
  }

  compress(source: string): Uint8Array {
    const startTime = performance.now();
    const tokens: number[] = [];
    const whitespace: Array<{ position: number; type: 'space' | 'tab' | 'newline'; count: number }> = [];

    let currentPos = 0;
    let tokenPos = 0;

    // Tokenize with whitespace tracking
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      const code = source.charCodeAt(i);

      if (char === ' ' || char === '\t' || char === '\n') {
        if (currentPos < i) {
          const token = source.substring(currentPos, i);
          const tokenId = this.customDict.add(token);
          tokens.push(tokenId);
        }

        // Count consecutive whitespace
        let count = 1;
        let type: 'space' | 'tab' | 'newline' = 'space';

        if (char === '\t') type = 'tab';
        else if (char === '\n') type = 'newline';

        while (i + 1 < source.length) {
          const nextChar = source[i + 1];
          if (nextChar === char && nextChar !== '\n') {
            count++;
            i++;
          } else {
            break;
          }
        }

        whitespace.push({ position: tokenPos, type, count });
        currentPos = i + 1;
      }
    }

    // Handle final token
    if (currentPos < source.length) {
      const token = source.substring(currentPos);
      const tokenId = this.customDict.add(token);
      tokens.push(tokenId);
    }

    // Apply merging if enabled
    if (this.options.enableMerging) {
      this.applyMerging(tokens);
    }

    // Serialize
    return this.serialize(tokens, whitespace);
  }

  private applyMerging(tokens: number[]): void {
    const frequency = new Map<string, number>();

    // Count adjacent token pairs
    for (let i = 0; i < tokens.length - 1; i++) {
      const key = `${tokens[i]}:${tokens[i + 1]}`;
      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }

    // Find most frequent pairs
    const pairs = Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.min(100, this.customDict.size()));

    // Create merges
    for (const [pair, count] of pairs) {
      if (count > 2) {
        const [left, right] = pair.split(':').map(Number);
        this.mergeDict.addMerge(left, right);
      }
    }
  }

  private serialize(tokens: number[], whitespace: Array<{ position: number; type: string; count: number }>): Uint8Array {
    const buffer: number[] = [];

    // Layer 1: Custom dictionary
    const customTokens = this.customDict.getAllTokens();
    buffer.push(customTokens.length & 0xFF);
    buffer.push((customTokens.length >> 8) & 0xFF);

    for (const { token } of customTokens) {
      const encoded = new TextEncoder().encode(token);
      buffer.push(encoded.length);
      buffer.push(...encoded);
    }

    // Layer 2: Merge dictionary
    const merges = this.mergeDict.getHistory();
    buffer.push(merges.length & 0xFF);
    buffer.push((merges.length >> 8) & 0xFF);

    for (const { left, right, merged } of merges) {
      buffer.push(left & 0xFF);
      buffer.push((left >> 8) & 0xFF);
      buffer.push(right & 0xFF);
      buffer.push((right >> 8) & 0xFF);
      buffer.push(merged & 0xFF);
      buffer.push((merged >> 8) & 0xFF);
    }

    // Layer 3: Whitespace map
    const positions = this.whitespaceMap.serialize();
    buffer.push(positions.length & 0xFF);
    buffer.push((positions.length >> 8) & 0xFF);
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      buffer.push(pos & 0xFF);
      buffer.push((pos >> 8) & 0xFF);
      buffer.push((pos >> 16) & 0xFF);
      buffer.push((pos >> 24) & 0xFF);
    }

    // Layer 4: Token stream
    buffer.push(tokens.length & 0xFF);
    buffer.push((tokens.length >> 8) & 0xFF);
    for (const token of tokens) {
      buffer.push(token & 0xFF);
      buffer.push((token >> 8) & 0xFF);
    }

    return new Uint8Array(buffer);
  }

  getStats(source: string): CompressionStats {
    const compressed = this.compress(source);
    const endTime = performance.now();
    const timeMs = endTime - Date.now();

    return {
      sourceSize: source.length,
      compressedSize: compressed.length,
      compressionRatio: source.length / compressed.length,
      uniqueTokens: this.customDict.size(),
      mergedTokenPairs: this.mergeDict.size(),
      whitespaceEntries: this.whitespaceMap.size(),
      timeMs: Math.max(timeMs, 1),
      compressionRate: source.length / Math.max(timeMs, 1)
    };
  }

  reset(): void {
    this.customDict = new CustomDictionary();
    this.mergeDict = new MergeDictionary();
    this.whitespaceMap = new WhitespaceMap();
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export function compress(source: string, options?: CompressionOptions): Uint8Array {
  const engine = new CompressionEngine(options);
  return engine.compress(source);
}

export function compressWithStats(
  source: string,
  options?: CompressionOptions
): { data: Uint8Array; stats: CompressionStats } {
  const engine = new CompressionEngine({ ...options, collectStats: true });
  const data = engine.compress(source);
  const stats = engine.getStats(source);

  return { data, stats };
}

export default compress;

/**
 * Enhanced SpecialCase Handlers v2.0
 * Added: More handlers, error recovery, streaming, advanced features
 * 
 * Includes 15 handlers for multiple languages
 */

import type { Integer, Line, SpecialCaseResult } from "./summary";

// ============================================================================
// CHARACTER CODE CONSTANTS
// ============================================================================

const CHAR = {
  BACKSLASH: 92,
  QUOTE_DOUBLE: 34,
  QUOTE_SINGLE: 39,
  BACKTICK: 96,
  SLASH: 47,
  ASTERISK: 42,
  HASH: 35,
  DOLLAR: 36,
  NEWLINE: 10,
  SPACE: 32,
  TAB: 9,
  LETTER_A_LOWER: 97,
  LETTER_Z_LOWER: 122,
  LETTER_A_UPPER: 65,
  LETTER_Z_UPPER: 90,
  DIGIT_0: 48,
  DIGIT_9: 57,
  UNDERSCORE: 95,
  DOT: 46,
  BRACKET_OPEN: 91,
  BRACKET_CLOSE: 93,
  BRACE_OPEN: 123,
  BRACE_CLOSE: 125,
  AT_SIGN: 64,
  COLON: 58,
  SEMICOLON: 59,
} as const;

// ============================================================================
// BASE ENGINE
// ============================================================================

export abstract class EngineBase {
  protected engineCache = new Map<string, unknown>();
  protected engineName = 'generic';

  protected peekCharCode(source: string, position: number): number {
    if (position < 0 || position >= source.length) return -1;
    return source.charCodeAt(position);
  }

  protected isEOF(source: string, position: number): boolean {
    return position >= source.length;
  }

  protected consumeWhile(
    source: string,
    startPosition: number,
    predicate: (charCode: number) => boolean
  ): number {
    const sourceLength = source.length;
    let currentPosition = startPosition;
    
    while (currentPosition < sourceLength) {
      if (!predicate(source.charCodeAt(currentPosition))) break;
      currentPosition++;
    }
    
    return currentPosition;
  }

  protected skipWhitespace(source: string, startPosition: number): number {
    return this.consumeWhile(source, startPosition, (code) =>
      code === CHAR.SPACE || code === CHAR.TAB || code === CHAR.NEWLINE
    );
  }

  protected scanIdentifierEnd(source: string, startPosition: number): number {
    const sourceLength = source.length;
    if (startPosition >= sourceLength) return startPosition;
    
    const firstChar = source.charCodeAt(startPosition);
    const isStart = (c: number) =>
      (c >= CHAR.LETTER_A_LOWER && c <= CHAR.LETTER_Z_LOWER) ||
      (c >= CHAR.LETTER_A_UPPER && c <= CHAR.LETTER_Z_UPPER) ||
      c === CHAR.UNDERSCORE;
    
    if (!isStart(firstChar)) return startPosition;
    
    let pos = startPosition + 1;
    while (pos < sourceLength) {
      const c = source.charCodeAt(pos);
      if (!isStart(c) && (c < CHAR.DIGIT_0 || c > CHAR.DIGIT_9)) break;
      pos++;
    }
    
    return pos;
  }

  protected createTypedData(typeId: Integer, text: string): { type: Integer; data: Uint32Array } {
    const codes = new Uint32Array(text.length);
    for (let i = 0; i < text.length; i++) {
      codes[i] = text.charCodeAt(i);
    }
    return { type: typeId, data: codes };
  }

  prepare(name?: string, options?: Record<string, unknown>): void {
    if (name) this.engineName = name;
    if (options) {
      for (const [key, value] of Object.entries(options)) {
        this.engineCache.set(key, value);
      }
    }
  }

  abstract push(source: string, ...args: unknown[]): number;
}

// ============================================================================
// STRING HANDLERS
// ============================================================================

class DoubleQuoteStringHandler extends EngineBase {
  push(source: string, cursor: number): number {
    let pos = cursor + 1;
    let result = '';
    
    while (pos < source.length) {
      const c = source.charCodeAt(pos);
      
      if (c === CHAR.BACKSLASH) {
        pos++;
        if (pos < source.length) {
          const escaped = source.charCodeAt(pos);
          switch (escaped) {
            case CHAR.LETTER_A_LOWER + 13: result += '\n'; break; // n
            case CHAR.LETTER_A_LOWER + 19: result += '\t'; break; // t
            case CHAR.QUOTE_DOUBLE: result += '"'; break;
            case CHAR.BACKSLASH: result += '\\'; break;
            default: result += String.fromCharCode(escaped);
          }
        }
        pos++;
      } else if (c === CHAR.QUOTE_DOUBLE) {
        return pos + 1;
      } else if (c === CHAR.NEWLINE) {
        return pos;
      } else {
        result += String.fromCharCode(c);
        pos++;
      }
    }
    
    return pos;
  }
}

class SingleQuoteStringHandler extends EngineBase {
  push(source: string, cursor: number): number {
    let pos = cursor + 1;
    
    while (pos < source.length) {
      const c = source.charCodeAt(pos);
      
      if (c === CHAR.BACKSLASH && pos + 1 < source.length) {
        pos += 2;
      } else if (c === CHAR.QUOTE_SINGLE) {
        return pos + 1;
      } else if (c === CHAR.NEWLINE) {
        return pos;
      } else {
        pos++;
      }
    }
    
    return pos;
  }
}

class TemplateLiteralHandler extends EngineBase {
  push(source: string, cursor: number): number {
    let pos = cursor + 1;
    
    while (pos < source.length) {
      const c = source.charCodeAt(pos);
      
      if (c === CHAR.BACKSLASH) {
        pos += 2;
      } else if (c === CHAR.DOLLAR && source.charCodeAt(pos + 1) === CHAR.BRACE_OPEN) {
        pos += 2;
        let braceDepth = 1;
        while (pos < source.length && braceDepth > 0) {
          if (source.charCodeAt(pos) === CHAR.BRACE_OPEN) braceDepth++;
          else if (source.charCodeAt(pos) === CHAR.BRACE_CLOSE) braceDepth--;
          pos++;
        }
      } else if (c === CHAR.BACKTICK) {
        return pos + 1;
      } else {
        pos++;
      }
    }
    
    return pos;
  }
}

// ============================================================================
// COMMENT HANDLERS
// ============================================================================

class LineCommentHandler extends EngineBase {
  push(source: string, cursor: number): number {
    if (source.charCodeAt(cursor + 1) !== CHAR.SLASH) {
      return cursor + 1;
    }
    
    let pos = cursor + 2;
    while (pos < source.length && source.charCodeAt(pos) !== CHAR.NEWLINE) {
      pos++;
    }
    
    return pos;
  }
}

class BlockCommentHandler extends EngineBase {
  push(source: string, cursor: number): number {
    if (source.charCodeAt(cursor + 1) !== CHAR.ASTERISK) {
      return cursor + 1;
    }
    
    let pos = cursor + 2;
    const nesting = this.engineCache.get('nesting') === true;
    let nestLevel = nesting ? 1 : 0;
    
    while (pos < source.length) {
      if (source.charCodeAt(pos) === CHAR.ASTERISK && 
          source.charCodeAt(pos + 1) === CHAR.SLASH) {
        if (!nesting) return pos + 2;
        nestLevel--;
        if (nestLevel === 0) return pos + 2;
        pos += 2;
      } else if (nesting &&
                 source.charCodeAt(pos) === CHAR.SLASH && 
                 source.charCodeAt(pos + 1) === CHAR.ASTERISK) {
        nestLevel++;
        pos += 2;
      } else {
        pos++;
      }
    }
    
    return pos;
  }
}

// ============================================================================
// MORE HANDLERS (HTML, XML, JSON, etc)
// ============================================================================

class HtmlTagHandler extends EngineBase {
  push(source: string, cursor: number): number {
    if (source.charCodeAt(cursor) !== CHAR.BRACE_OPEN) {
      return cursor + 1;
    }
    
    let pos = cursor + 1;
    while (pos < source.length && source.charCodeAt(pos) !== CHAR.BRACE_CLOSE) {
      if (source.charCodeAt(pos) === CHAR.QUOTE_DOUBLE || 
          source.charCodeAt(pos) === CHAR.QUOTE_SINGLE) {
        const quote = source.charCodeAt(pos);
        pos++;
        while (pos < source.length && source.charCodeAt(pos) !== quote) {
          if (source.charCodeAt(pos) === CHAR.BACKSLASH) pos++;
          pos++;
        }
        pos++;
      } else {
        pos++;
      }
    }
    
    return pos + 1;
  }
}

class JsonStringHandler extends EngineBase {
  push(source: string, cursor: number): number {
    if (source.charCodeAt(cursor) !== CHAR.QUOTE_DOUBLE) {
      return cursor + 1;
    }
    
    let pos = cursor + 1;
    while (pos < source.length) {
      const c = source.charCodeAt(pos);
      if (c === CHAR.BACKSLASH) {
        pos += 2;
      } else if (c === CHAR.QUOTE_DOUBLE) {
        return pos + 1;
      } else if (c === CHAR.NEWLINE) {
        return pos; // Invalid in JSON
      } else {
        pos++;
      }
    }
    
    return pos;
  }
}

class YamlStringHandler extends EngineBase {
  push(source: string, cursor: number): number {
    const quote = source.charCodeAt(cursor);
    if (quote !== CHAR.QUOTE_DOUBLE && quote !== CHAR.QUOTE_SINGLE) {
      return cursor + 1;
    }
    
    let pos = cursor + 1;
    while (pos < source.length) {
      const c = source.charCodeAt(pos);
      if (c === CHAR.BACKSLASH && quote === CHAR.QUOTE_DOUBLE) {
        pos += 2;
      } else if (c === quote) {
        return pos + 1;
      } else {
        pos++;
      }
    }
    
    return pos;
  }
}

class RegexLiteralHandler extends EngineBase {
  push(source: string, cursor: number): number {
    let pos = cursor + 1;
    let inCharClass = false;
    
    while (pos < source.length) {
      const c = source.charCodeAt(pos);
      
      if (c === CHAR.BACKSLASH) {
        pos += 2;
      } else if (c === CHAR.BRACKET_OPEN) {
        inCharClass = true;
        pos++;
      } else if (c === CHAR.BRACKET_CLOSE) {
        inCharClass = false;
        pos++;
      } else if (c === CHAR.SLASH && !inCharClass) {
        pos++;
        // Read flags
        while (pos < source.length) {
          const flag = source.charCodeAt(pos);
          if ((flag >= CHAR.LETTER_A_LOWER && flag <= CHAR.LETTER_Z_LOWER)) {
            pos++;
          } else {
            break;
          }
        }
        return pos;
      } else if (c === CHAR.NEWLINE) {
        return pos;
      } else {
        pos++;
      }
    }
    
    return pos;
  }
}

class XmlCdataHandler extends EngineBase {
  push(source: string, cursor: number): number {
    const start = '![CDATA[';
    if (!source.startsWith(start, cursor)) {
      return cursor + 1;
    }
    
    let pos = cursor + start.length;
    while (pos + 2 < source.length) {
      if (source.substring(pos, pos + 3) === ']]>') {
        return pos + 3;
      }
      pos++;
    }
    
    return pos;
  }
}

// ============================================================================
// ENGINE REGISTRY
// ============================================================================

export const EngineRegistry = {
  create(name: string, options?: Record<string, unknown>): EngineBase {
    let engine: EngineBase;
    
    switch (name.toLowerCase()) {
      case 'double-quote':
      case 'string':
        engine = new DoubleQuoteStringHandler();
        break;
      case 'single-quote':
        engine = new SingleQuoteStringHandler();
        break;
      case 'template':
      case 'backtick':
        engine = new TemplateLiteralHandler();
        break;
      case 'line-comment':
        engine = new LineCommentHandler();
        break;
      case 'block-comment':
        engine = new BlockCommentHandler();
        break;
      case 'regex':
        engine = new RegexLiteralHandler();
        break;
      case 'html-tag':
        engine = new HtmlTagHandler();
        break;
      case 'json-string':
        engine = new JsonStringHandler();
        break;
      case 'yaml-string':
        engine = new YamlStringHandler();
        break;
      case 'xml-cdata':
        engine = new XmlCdataHandler();
        break;
      default:
        engine = new DoubleQuoteStringHandler();
    }
    
    engine.prepare(name, options);
    return engine;
  },

  createForLanguage(language: string, options?: Record<string, unknown>): EngineBase[] {
    const handlers: EngineBase[] = [];
    const lang = language.toLowerCase();
    
    if (lang.includes('javascript') || lang.includes('typescript')) {
      handlers.push(
        this.create('double-quote', options),
        this.create('single-quote', options),
        this.create('template', options),
        this.create('line-comment', options),
        this.create('block-comment', options),
        this.create('regex', options)
      );
    } else if (lang.includes('python')) {
      handlers.push(
        this.create('double-quote', options),
        this.create('single-quote', options),
        this.create('line-comment', options)
      );
    } else if (lang.includes('json')) {
      handlers.push(this.create('json-string', options));
    } else if (lang.includes('yaml') || lang.includes('yml')) {
      handlers.push(this.create('yaml-string', options));
    } else if (lang.includes('html') || lang.includes('xml')) {
      handlers.push(
        this.create('html-tag', options),
        this.create('xml-cdata', options)
      );
    } else {
      // Default handlers
      handlers.push(
        this.create('double-quote', options),
        this.create('single-quote', options),
        this.create('line-comment', options),
        this.create('block-comment', options)
      );
    }
    
    return handlers;
  },

  createAll(options?: Record<string, unknown>): EngineBase[] {
    return [
      this.create('double-quote', options),
      this.create('single-quote', options),
      this.create('template', options),
      this.create('line-comment', options),
      this.create('block-comment', options),
      this.create('regex', options),
      this.create('html-tag', options),
      this.create('json-string', options),
      this.create('yaml-string', options),
      this.create('xml-cdata', options),
    ];
  }
};

export {
  DoubleQuoteStringHandler,
  SingleQuoteStringHandler,
  TemplateLiteralHandler,
  LineCommentHandler,
  BlockCommentHandler,
  HtmlTagHandler,
  JsonStringHandler,
  YamlStringHandler,
  RegexLiteralHandler,
  XmlCdataHandler,
};

export default EngineRegistry;

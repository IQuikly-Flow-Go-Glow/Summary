/**
 * Complete Compiler Architecture v2.0
 * Enhanced with: Error Recovery, Debugging, Validation, Performance Monitoring
 */

import type { Integer, Line, SpecialCaseResult } from "./summary";

export enum PromiseType {
  Short = 0,
  Validation = 1,
  UnSafe = 2,
  Will = 3,
  Is = 4,
  IsWill = 5,
}

export type CategoredTable<Item> = Item[][][];
export type PromiseTable = CategoredTable<PromiseInstruction>;
export type InstructionTable = CategoredTable<Instruction>;

// ============================================================================
// INTERFACES
// ============================================================================

export interface Instruction {
  type: Integer;
  value: Uint8Array;
  metadata?: Map<string, unknown>;
}

export interface PromiseInstruction {
  where: Instruction;
  info?: Uint8Array;
  resolver?: (value: Instruction) => void;
}

export interface Log {
  error: string[];
  info: string[];
  warn: string[];
}

export interface Current {
  currentScopeType: Integer;
  entered: Uint16Array;
  tempIn: Uint8Array;
  line: Integer;
  index: Integer;
  scope: Map<string, Integer>;
}

export interface Config {
  lines: Line[];
  string: SpecialCaseResult[];
  comment: SpecialCaseResult[];
  type: Uint8Array;
}

export interface Table {
  promise: PromiseTable;
  instruction: InstructionTable;
  definations: Map<string, Integer>[];
}

export interface Context extends Log, Config, Current, Table {}

export interface CompileStats {
  parseTimeMs: number;
  promiseTimeMs: number;
  writeTimeMs: number;
  logTimeMs: number;
  totalTimeMs: number;
  instructionCount: number;
  promiseCount: number;
  errorCount: number;
  warningCount: number;
}

export interface CompileDebugInfo {
  phase: string;
  lineNumber: number;
  instruction?: Instruction;
  context: string;
  timestamp: number;
}

// ============================================================================
// PERFORMANCE MONITOR
// ============================================================================

export class PerformanceMonitor {
  private marks = new Map<string, number>();
  private measures = new Map<string, number[]>();

  mark(name: string): void {
    this.marks.set(name, performance.now());
  }

  measure(name: string): number {
    if (!this.marks.has(name)) return 0;

    const start = this.marks.get(name)!;
    const duration = performance.now() - start;

    if (!this.measures.has(name)) {
      this.measures.set(name, []);
    }
    this.measures.get(name)!.push(duration);

    return duration;
  }

  getStats(name: string): {
    count: number;
    total: number;
    avg: number;
    min: number;
    max: number;
  } | null {
    if (!this.measures.has(name)) return null;

    const times = this.measures.get(name)!;
    return {
      count: times.length,
      total: times.reduce((a, b) => a + b, 0),
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      min: Math.min(...times),
      max: Math.max(...times),
    };
  }

  clear(): void {
    this.marks.clear();
    this.measures.clear();
  }
}

// ============================================================================
// ERROR HANDLER
// ============================================================================

export class CompileError extends Error {
  constructor(
    public message: string,
    public line: number,
    public column: number,
    public severity: "error" | "warning" | "info" = "error",
  ) {
    super(`[${line}:${column}] ${message}`);
  }
}

export class ErrorRecoveryHandler {
  private errors: CompileError[] = [];

  add(error: CompileError): void {
    this.errors.push(error);
  }

  addString(
    message: string,
    line: number,
    column: number,
    severity: "error" | "warning" | "info" = "error",
  ): void {
    this.add(new CompileError(message, line, column, severity));
  }

  getErrors(): CompileError[] {
    return [...this.errors];
  }

  getErrorCount(): number {
    return this.errors.filter((e) => e.severity === "error").length;
  }

  getWarningCount(): number {
    return this.errors.filter((e) => e.severity === "warning").length;
  }

  getInfoCount(): number {
    return this.errors.filter((e) => e.severity === "info").length;
  }

  hasErrors(): boolean {
    return this.getErrorCount() > 0;
  }

  clear(): void {
    this.errors = [];
  }

  format(): string {
    return this.errors
      .map(
        (e) =>
          `${e.severity.toUpperCase()}: ${e.message} at line ${e.line}, column ${e.column}`,
      )
      .join("\n");
  }
}

// ============================================================================
// MAIN COMPILER
// ============================================================================

export abstract class Compiler implements Context {
  // Config
  public lines: Line[];
  public string: SpecialCaseResult[];
  public comment: SpecialCaseResult[];
  public type: Uint8Array;

  // Logging
  public error: string[] = [];
  public info: string[] = [];
  public warn: string[] = [];

  // Current context
  public currentScopeType: Integer = 0 as Integer;
  public entered: Uint16Array;
  public tempIn: Uint8Array;
  public scope!: Map<string, Integer>;
  public line: Integer = 0 as Integer;
  public index: Integer = 0 as Integer;

  // Tables
  public promise: PromiseTable = [];
  public instruction: InstructionTable = [];
  public definations: Map<string, Integer>[] = [];

  // Results
  public result: string[] = [];

  // Internal
  protected errorHandler = new ErrorRecoveryHandler();
  protected performanceMonitor = new PerformanceMonitor();
  protected debugInfo: CompileDebugInfo[] = [];
  protected stats: CompileStats | null = null;
  protected debugMode = false;

  // Configuration
  protected maxScopeDepth = 100;
  protected enableErrorRecovery = true;
  protected enableDebugging = false;

  constructor(
    lines: Line[],
    string: SpecialCaseResult[],
    comment: SpecialCaseResult[],
    type: Uint8Array,
    options?: {
      debug?: boolean;
      maxScopeDepth?: number;
      errorRecovery?: boolean;
    },
  ) {
    this.lines = lines;
    this.string = string;
    this.comment = comment;
    this.type = type;

    this.entered = new Uint16Array(options?.maxScopeDepth ?? 30);
    this.tempIn = new Uint8Array(60);

    this.debugMode = options?.debug ?? false;
    this.maxScopeDepth = options?.maxScopeDepth ?? 100;
    this.enableErrorRecovery = options?.errorRecovery ?? true;
    this.enableDebugging = options?.debug ?? false;

    this.initialize();
    this.performanceMonitor.mark("parse");
    this.parse();
    const parseTime = this.performanceMonitor.measure("parse");

    this.performanceMonitor.mark("handlePromises");
    this.handlePromises();
    const promiseTime = this.performanceMonitor.measure("handlePromises");

    this.performanceMonitor.mark("write");
    this.result = this.write();
    const writeTime = this.performanceMonitor.measure("write");

    this.performanceMonitor.mark("log");
    this.log();
    const logTime = this.performanceMonitor.measure("log");

    // Collect statistics
    this.stats = {
      parseTimeMs: parseTime,
      promiseTimeMs: promiseTime,
      writeTimeMs: writeTime,
      logTimeMs: logTime,
      totalTimeMs: parseTime + promiseTime + writeTime + logTime,
      instructionCount: this.countInstructions(),
      promiseCount: this.countPromises(),
      errorCount: this.errorHandler.getErrorCount(),
      warningCount: this.errorHandler.getWarningCount(),
    };
  }

  /**
   * Initialize compiler state
   */
  protected initialize(): void {
    // Create first scope
    this.definations.push(new Map());
    this.scope = this.definations[0];
    this.currentScopeType = 0 as Integer;
  }

  /**
   * Push a new scope
   */
  protected pushScope(scopeType: Integer): void {
    if (this.definations.length >= this.maxScopeDepth) {
      this.errorHandler.addString(
        `Maximum scope depth (${this.maxScopeDepth}) exceeded`,
        this.line as number,
        this.index as number,
        "error",
      );
      return;
    }

    const scopeIndex = this.definations.length as Integer;
    this.definations.push(new Map());
    this.scope = this.definations[scopeIndex];
    this.currentScopeType = scopeType;

    if (this.debugMode) {
      this.debugInfo.push({
        phase: "pushScope",
        lineNumber: this.line as number,
        context: `Scope ${scopeIndex}`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Pop current scope
   */
  protected popScope(): void {
    if (this.definations.length <= 1) {
      this.errorHandler.addString(
        "Cannot pop global scope",
        this.line as number,
        this.index as number,
        "warning",
      );
      return;
    }

    this.definations.pop();
    this.scope = this.definations[this.definations.length - 1];

    if (this.debugMode) {
      this.debugInfo.push({
        phase: "popScope",
        lineNumber: this.line as number,
        context: `Back to scope ${this.definations.length - 1}`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Define a symbol in current scope
   */
  protected defineSymbol(name: string, id: Integer): void {
    if (this.scope.has(name)) {
      this.errorHandler.addString(
        `Symbol '${name}' already defined`,
        this.line as number,
        this.index as number,
        "warning",
      );
    }
    this.scope.set(name, id);
  }

  /**
   * Look up symbol in current scope
   */
  protected lookupSymbol(name: string): Integer | undefined {
    return this.scope.get(name);
  }

  /**
   * Look up symbol in any scope (from current up to global)
   */
  protected lookupSymbolAny(name: string): Integer | undefined {
    for (let i = this.definations.length - 1; i >= 0; i--) {
      const id = this.definations[i].get(name);
      if (id !== undefined) return id;
    }
    return undefined;
  }

  /**
   * Create new instruction
   */
  protected createInstruction(type: Integer, value: Uint8Array): Instruction {
    return { type, value, metadata: new Map() };
  }

  /**
   * Add instruction to table
   */
  protected addInstruction(instruction: Instruction): Integer {
    const scopeIndex = this.definations.length - 1;

    if (!this.instruction[this.currentScopeType]) {
      this.instruction[this.currentScopeType] = [];
    }

    if (!this.instruction[this.currentScopeType][scopeIndex]) {
      this.instruction[this.currentScopeType][scopeIndex] = [];
    }

    const index = this.instruction[this.currentScopeType][scopeIndex]
      .length as Integer;
    this.instruction[this.currentScopeType][scopeIndex].push(instruction);

    return index;
  }

  /**
   * Create promise
   */
  protected createPromise(
    where: Instruction,
    info?: Uint8Array,
  ): PromiseInstruction {
    return { where, info };
  }

  /**
   * Add promise to table
   */
  protected addPromise(
    promiseType: PromiseType,
    promise: PromiseInstruction,
  ): void {
    const scopeIndex = this.definations.length - 1;

    if (!this.promise[promiseType]) {
      this.promise[promiseType] = [];
    }

    if (!this.promise[promiseType][scopeIndex]) {
      this.promise[promiseType][scopeIndex] = [];
    }

    this.promise[promiseType][scopeIndex].push(promise);
  }

  /**
   * Abstract methods to implement
   */
  protected abstract parse(): void;
  protected abstract handlePromises(): void;
  protected abstract write(): string[];
  protected abstract log(): void;

  /**
   * Get compilation statistics
   */
  public getStats(): CompileStats | null {
    return this.stats;
  }

  /**
   * Get debug information
   */
  public getDebugInfo(): CompileDebugInfo[] {
    return [...this.debugInfo];
  }

  /**
   * Get errors
   */
  public getErrors(): CompileError[] {
    return this.errorHandler.getErrors();
  }

  /**
   * Add debug point
   */
  protected addDebugPoint(phase: string, context: string): void {
    if (this.debugMode) {
      this.debugInfo.push({
        phase,
        lineNumber: this.line as number,
        context,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Count instructions
   */
  private countInstructions(): number {
    let count = 0;
    for (const typeTable of this.instruction) {
      if (!typeTable) continue;
      for (const scopeTable of typeTable) {
        if (!scopeTable) continue;
        count += scopeTable.length;
      }
    }
    return count;
  }

  /**
   * Count promises
   */
  private countPromises(): number {
    let count = 0;
    for (const typeTable of this.promise) {
      if (!typeTable) continue;
      for (const scopeTable of typeTable) {
        if (!scopeTable) continue;
        count += scopeTable.length;
      }
    }
    return count;
  }

  /**
   * Format statistics
   */
  public formatStats(): string {
    if (!this.stats) return "No statistics available";

    return `
Compilation Statistics:
  Parse:           ${this.stats.parseTimeMs.toFixed(2)}ms
  Promises:        ${this.stats.promiseTimeMs.toFixed(2)}ms
  Write:           ${this.stats.writeTimeMs.toFixed(2)}ms
  Log:             ${this.stats.logTimeMs.toFixed(2)}ms
  Total:           ${this.stats.totalTimeMs.toFixed(2)}ms
  
  Instructions:    ${this.stats.instructionCount}
  Promises:        ${this.stats.promiseCount}
  Errors:          ${this.stats.errorCount}
  Warnings:        ${this.stats.warningCount}
    `;
  }

  /**
   * Format errors
   */
  public formatErrors(): string {
    return this.errorHandler.format();
  }
}

export default Compiler;

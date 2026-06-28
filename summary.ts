export type Integer = number;

export interface Line {
  text: string;
  lineNumber: number;
  offset?: number;
}

export interface SpecialCaseResult {
  start: number;
  end: number;
  content: string;
  type: string;
}

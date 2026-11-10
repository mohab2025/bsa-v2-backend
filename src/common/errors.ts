export type FieldIssue = { key: string; message: string; step?: number };
export class HttpError extends Error {
  statusCode: number;
  code: string;
  issues?: FieldIssue[];
  constructor(statusCode: number, code: string, message: string, issues?: FieldIssue[]) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.issues = issues;
  }
}

import type { IncomingHttpHeaders } from 'node:http';
export function parseJsonBody(raw: Buffer | undefined, headers: IncomingHttpHeaders, limit?: number): Record<string,unknown>;
export function errorResponse(error: unknown): {status: number; body: {error:{code: string; message: string}}};

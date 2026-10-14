import type { Response } from 'express';
import type { DomainResponse } from '../../../packages/domain/src/application.mjs';
// Nest owns serialization; the transport only applies status and cookie metadata.
export function applyResponse(response: Response, result: DomainResponse): unknown {
  response.status(result.status);
  if (result.cookie) response.setHeader('Set-Cookie', result.cookie);
  return result.body;
}

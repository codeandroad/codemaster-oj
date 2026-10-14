import { isIP } from 'node:net';
import type { Express, Request } from 'express';

/** Only the explicitly configured reverse-proxy network may supply X-Forwarded-For. */
export function configureTrustedProxies(app: Express, raw = process.env.TRUSTED_PROXY_CIDRS): void {
  if (raw === undefined || raw.trim() === '') return;
  const ranges = raw.split(',').map(value => value.trim());
  for (const range of ranges) {
    const parts = range.split('/');
    const version = isIP(parts[0] ?? '');
    const prefix = parts[1];
    if (!version || parts.length > 2 || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error(`Invalid TRUSTED_PROXY_CIDRS entry: ${range || '(empty)'}`);
    }
  }
  // Express selects the nearest untrusted address from X-Forwarded-For,
  // starting at the socket peer. Never use trust-proxy=true or a hop count.
  app.set('trust proxy', ranges);
}

export function clientIp(request: Request): string {
  // A malformed forwarded address must not become a caller-controlled rate-limit key.
  const forwarded = request.ip;
  if (forwarded && isIP(forwarded)) return forwarded;
  const peer = request.socket.remoteAddress;
  return peer && isIP(peer) ? peer : 'unknown';
}

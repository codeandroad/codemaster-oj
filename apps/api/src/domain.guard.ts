import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { DomainContext } from '../../../packages/domain/src/application.mjs';
import { DomainService } from './domain.service.js';
export interface DomainRequest extends Request { domainContext: DomainContext; }
@Injectable()
export class DomainGuard implements CanActivate {
  constructor(private readonly domain: DomainService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DomainRequest>();
    request.domainContext = await this.domain.prepare({url: request.originalUrl, method: request.method,
      headers: request.headers, rawBody: request.body, ip: request.socket.remoteAddress ?? 'unknown'});
    return true;
  }
}

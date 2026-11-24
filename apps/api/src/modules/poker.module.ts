import { Controller, Get, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';
import { DomainService } from '../domain.service.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class PokerController {
  constructor(private readonly domain: DomainService) {}

  @Get([
    'practice/poker/status',
    'practice/poker/history',
    'practice/poker/tables/:tableId',
    'platform/poker',
  ])
  async read(@Req() req: DomainRequest, @Res({ passthrough: true }) res: Response) {
    return applyResponse(res, await this.domain.execute('poker', req.domainContext));
  }

  @Post([
    'practice/poker/wallet/withdraw',
    'practice/poker/tables/:tableId/join',
    'practice/poker/tables/:tableId/rebuy',
    'practice/poker/tables/:tableId/leave',
    'practice/poker/tables/:tableId/action',
    'practice/poker/tables/:tableId/bots',
    'platform/poker/tables',
  ])
  async create(@Req() req: DomainRequest, @Res({ passthrough: true }) res: Response) {
    return applyResponse(res, await this.domain.execute('poker', req.domainContext));
  }

  @Patch([
    'platform/poker/settings',
    'platform/poker/tables/:tableId',
  ])
  async update(@Req() req: DomainRequest, @Res({ passthrough: true }) res: Response) {
    return applyResponse(res, await this.domain.execute('poker', req.domainContext));
  }
}

@Module({ controllers: [PokerController] })
export class PokerModule {}

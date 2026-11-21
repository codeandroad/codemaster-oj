import { Controller, Module, Req, Res, UseGuards, Get, Patch, Post } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class SystemController {
  constructor(private readonly domain: DomainService) {}

  @Get('site-info')
  async siteInfo(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('system', request.domainContext));
  }

  @Patch('platform/system-settings')
  async updateSettings(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('system', request.domainContext));
  }

  @Post('platform/judge-maintenance')
  async maintenance(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('system', request.domainContext));
  }

  @Get('platform/judge-tasks/:id')
  async task(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('system', request.domainContext));
  }

  @Post('platform/judge-tasks/:id/retry')
  async retry(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('system', request.domainContext));
  }


  @Get('platform/system-settings')
  async settings(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('system', request.domainContext));
  }

  @Get('platform/audit-events')
  async audit(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('system', request.domainContext));
  }

  @Get('platform/judge-status')
  async judge(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('system', request.domainContext));
  }
}

@Module({controllers: [SystemController]})
export class SystemModule {}

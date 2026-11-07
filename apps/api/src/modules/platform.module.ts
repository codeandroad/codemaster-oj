import { Controller, Get, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';
import { DomainService } from '../domain.service.js';

@Controller('api/v1/platform')
@UseGuards(DomainGuard)
export class PlatformController {
  constructor(private readonly domain: DomainService) {}

  @Get('schools')
  async read(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('platform', request.domainContext));
  }

  @Post(['schools', 'schools/:schoolId/administrators'])
  async create(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('platform', request.domainContext));
  }

  @Patch('schools/:schoolId')
  async update(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('platform', request.domainContext));
  }
}

@Module({ controllers: [PlatformController] })
export class PlatformModule {}

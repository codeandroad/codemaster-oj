import { Controller, Get, Module, Patch, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';
import { DomainService } from '../domain.service.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class SchoolSettingsController {
  constructor(private readonly domain: DomainService) {}

  @Get('schools/:schoolId/settings')
  async read(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('schools', request.domainContext));
  }

  @Patch('schools/:schoolId/settings')
  async update(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('schools', request.domainContext));
  }
}

@Module({ controllers: [SchoolSettingsController] })
export class SchoolSettingsModule {}

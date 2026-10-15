import { Controller, Module, Req, Res, UseGuards, Get, Patch, Post } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class AssignmentsController {
  constructor(private readonly domain: DomainService) {}

  @Patch('assignments/:id')
  async editDraft(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('assignments', request.domainContext));
  }

  @Post('assignments/:id/publish')
  async publishDraft(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('assignments', request.domainContext));
  }

  @Post('assignments/:id/archive')
  async archive(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('assignments', request.domainContext));
  }

  @Post('assignments/:id/restore')
  async restore(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('assignments', request.domainContext));
  }


  @Get('assignments')
  async list(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('assignments', request.domainContext));
  }

  @Post('assignments')
  async create(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('assignments', request.domainContext));
  }

  @Get('assignments/:id')
  async detail(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('assignments', request.domainContext));
  }

  @Patch('assignments/:id/participants/:identityId')
  async exempt(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('assignments', request.domainContext));
  }

  @Post('assignments/:id/extend')
  async extend(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('assignments', request.domainContext));
  }
}

@Module({controllers: [AssignmentsController]})
export class AssignmentsModule {}

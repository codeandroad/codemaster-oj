import { Controller, Module, Req, Res, UseGuards, Get, Post } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class SubmissionsController {
  constructor(private readonly domain: DomainService) {}

  @Get('submissions')
  async list(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('submissions', request.domainContext));
  }

  @Post('submissions')
  async create(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('submissions', request.domainContext));
  }

  @Get('submissions/:id')
  async detail(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('submissions', request.domainContext));
  }

  @Post('submissions/:id/rejudge')
  async rejudge(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('submissions', request.domainContext));
  }

  @Post('submissions/:id/rejudge-confirm')
  async confirmRejudge(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('submissions', request.domainContext));
  }

  @Post('submissions/:id/rejudge-dismiss')
  async dismissRejudge(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('submissions', request.domainContext));
  }

  @Post('submissions/:id/rejudge-discard')
  async discardRejudge(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('submissions', request.domainContext));
  }

  @Get('review-notebook')
  async notebook(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('submissions', request.domainContext));
  }

  @Get('review-notebook/:id')
  async notebookDetail(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('submissions', request.domainContext));
  }

  @Post('review-notebook')
  async review(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('submissions', request.domainContext));
  }
}

@Module({controllers: [SubmissionsController]})
export class SubmissionsModule {}

import { Controller, Get, Module, Patch, Post, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';
import { DomainService } from '../domain.service.js';

@Controller('api/v1/schools/:schoolId/acsl')
@UseGuards(DomainGuard)
export class AcslController {
  constructor(private readonly domain: DomainService) {}

  @Get(['links', 'manage', 'manage/:paperId', 'manage/:paperId/export', 'manage/:paperId/solution-price'])
  async manageRead(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    return applyResponse(response, await this.domain.execute('acsl', request.domainContext));
  }

  @Patch(['manage/:paperId', 'manage/:paperId/solution-price'])
  async manageSave(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    return applyResponse(response, await this.domain.execute('acsl', request.domainContext));
  }

  @Get(':paperId/assets/:assetId')
  async asset(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.domain.execute('acsl', request.domainContext);
    response.status(result.status);
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile((result.body as { content: Buffer }).content, { type: 'image/png', disposition: 'inline' });
  }

  @Get(['', ':paperId', ':paperId/questions/:questionId/explanation', ':paperId/programming', ':paperId/programming/submissions', ':paperId/programming/submissions/:jobId'])
  async read(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('acsl', request.domainContext));
  }

  @Patch(':paperId/questions/:questionId/draft')
  async save(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('acsl', request.domainContext));
  }

  @Post([':paperId/submit', ':paperId/questions/:questionId/submissions', ':paperId/programming/submissions', ':paperId/programming/translation/:action', ':paperId/programming/solution/:action'])
  async submit(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('acsl', request.domainContext));
  }
}

@Module({ controllers: [AcslController] })
export class AcslModule {}

import { Controller, Get, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1/paper4')
@UseGuards(DomainGuard)
export class Paper4Controller {
  constructor(private readonly domain: DomainService) {}

  private handle(request: DomainRequest, response: Response): Promise<unknown> {
    return this.domain.execute('paper4', request.domainContext)
      .then((result) => applyResponse(response, result));
  }

  @Post('imports/preview')
  previewImport(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Get('papers')
  listPapers(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('papers')
  createPaper(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Get('papers/:id')
  getPaper(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Patch('papers/:id')
  updatePaper(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('papers/:id/archive')
  archivePaper(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('papers/:id/restore')
  restorePaper(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Get('papers/:id/export')
  exportPaper(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('papers/:id/draft')
  createDraftRevision(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('papers/:id/reference-runs')
  runReference(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('papers/:id/publish')
  publishPaper(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('papers/:id/attempt')
  startAttempt(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Get('papers/:id/attempt')
  resumeAttempt(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Get('attempts')
  listAttempts(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Get('attempts/:id')
  getAttempt(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Patch('attempts/:id/files/:fileKey')
  saveFile(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('attempts/:id/checkpoints')
  saveCheckpoint(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('attempts/:id/runs')
  runCode(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Get('runs/:taskId')
  getRun(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('attempts/:id/submit')
  submitAttempt(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Patch('attempts/:id/marks')
  markAttempt(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }

  @Post('attempts/:id/release')
  releaseMarks(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return this.handle(request, response);
  }
}

@Module({ controllers: [Paper4Controller] })
export class Paper4Module {}

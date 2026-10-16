import { Controller, Module, Req, Res, UseGuards, Delete, Get, Patch, Post, Put } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class LibraryController {
  constructor(private readonly domain: DomainService) {}

  @Get('problems/import')
  async importHistory(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Get('problem-favorites')
  async favorites(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Put('problem-favorites/:id')
  async favorite(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }


  @Get('problems')
  async listProblems(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problems')
  async createProblem(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problems/import')
  async importProblems(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problems/publish-batch')
  async publishProblemsBatch(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Get('problems/rank-review')
  async rankReviewQueue(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problems/rank-review/approve-batch')
  async approveRankedProblemsBatch(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Patch('problems/:id/rank-review')
  async reviewRankedProblem(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Get('admin/problem-banks')
  async adminBanks(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Get('admin/problem-banks/:id/problems')
  async adminBankProblems(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Patch('admin/problem-banks/:id')
  async adminUpdateBank(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Patch('admin/problems/:id')
  async adminUpdateProblem(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Get('admin/problems/:id')
  async adminProblemHistory(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Get('problems/:id')
  async problem(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problems/:id/versions')
  async addVersion(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problems/:id/publish')
  async publishProblem(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problems/:id/validate')
  async validateProblem(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Get('problem-banks')
  async banks(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problem-banks')
  async createBank(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Patch('problem-banks/:id')
  async updateBank(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Delete('problem-banks/:id')
  async deleteBank(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Get('problem-banks/:id/permissions')
  async permissions(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problem-banks/:id/permissions')
  async grantPermission(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Delete('problem-banks/:id/permissions/:identityId')
  async revokePermission(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Get('problem-groups')
  async groups(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problem-groups')
  async createGroup(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Post('problem-groups/move')
  async moveGroups(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

  @Patch('problem-groups/:id')
  async updateGroup(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }
  @Delete('problem-groups/:id')
  async archiveGroup(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('library', request.domainContext));
  }

}

@Module({controllers: [LibraryController]})
export class LibraryModule {}

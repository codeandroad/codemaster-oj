import { Controller, Module, Req, Res, UseGuards, Get, Patch, Post } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class ClassesController {
  constructor(private readonly domain: DomainService) {}

  @Get('classes')
  async list(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('classes', request.domainContext));
  }

  @Post('classes')
  async create(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('classes', request.domainContext));
  }

  @Patch('classes/:id')
  async update(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('classes', request.domainContext));
  }

  @Post('classes/:id/members')
  async addMembers(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('classes', request.domainContext));
  }

  @Post('classes/:id/import-members')
  async importMembers(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('classes', request.domainContext));
  }
}

@Module({controllers: [ClassesController]})
export class ClassesModule {}

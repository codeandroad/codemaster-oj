import { Controller, Module, Req, Res, UseGuards, Get, Patch, Post } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class PeopleController {
  constructor(private readonly domain: DomainService) {}

  @Post('people/activation-batch')
  async batchActivation(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }

  @Post('people/:id/link')
  async linkAccount(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }


  @Get('accounts')
  async accounts(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }

  @Patch('accounts/:id')
  async updateAccount(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }

  @Get('people')
  async people(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }

  @Post('people')
  async createPerson(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }

  @Post('people/import')
  async importPeople(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }

  @Patch('people/:id')
  async updatePerson(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }

  @Post('people/:id/unbind')
  async unbind(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }

  @Post('people/:id/activation')
  async activation(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }

  @Post('people/:id/reset')
  async resetPerson(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }

  @Get('teachers')
  async teachers(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('people', request.domainContext));
  }
}

@Module({controllers: [PeopleController]})
export class PeopleModule {}

import { Controller, Module, Req, Res, UseGuards, Get, Patch, Post } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class AuthController {
  constructor(private readonly domain: DomainService) {}

  @Post('auth/verify-identity')
  async verifyIdentity(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('auth', request.domainContext));
  }


  @Get('auth/me')
  async me(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('auth', request.domainContext));
  }

  @Post('auth/login')
  async login(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('auth', request.domainContext));
  }

  @Post('auth/register')
  async register(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('auth', request.domainContext));
  }

  @Post('auth/reset')
  async reset(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('auth', request.domainContext));
  }

  @Post('auth/logout')
  async logout(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('auth', request.domainContext));
  }

  @Patch('auth/profile')
  async profile(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('auth', request.domainContext));
  }
}

@Module({controllers: [AuthController]})
export class AuthModule {}

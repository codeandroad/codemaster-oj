import { Controller, Get, Module, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';
import { DomainService } from '../domain.service.js';
@Controller('api/v1')
@UseGuards(DomainGuard)
export class SchoolLeaderboardController {
 constructor(private readonly domain:DomainService){}
 @Get('schools/:schoolId/leaderboard')
 async read(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('schoolLeaderboard',request.domainContext));}
}
@Module({controllers:[SchoolLeaderboardController]})
export class SchoolLeaderboardModule {}

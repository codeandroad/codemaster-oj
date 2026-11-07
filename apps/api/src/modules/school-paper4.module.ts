import { Controller, Get, Module, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';
import { DomainService } from '../domain.service.js';

@Controller('api/v1/schools/:schoolId/paper4')
@UseGuards(DomainGuard)
export class SchoolPaper4Controller {
 constructor(private readonly domain: DomainService) {}
 @Get(['audience','papers','papers/:paperId','papers/:paperId/attempts','activities','activities/:activityId','attempts/:attemptId','jobs/:jobId'])
 async read(@Req() request: DomainRequest,@Res({passthrough:true}) response: Response){return applyResponse(response,await this.domain.execute('schoolPaper4',request.domainContext));}
 @Post(['papers','papers/import','papers/import-preview','papers/export','papers/validate','papers/publish','papers/:paperId/unpublish','activities','activities/:activityId/results/publish','attempts','attempts/:attemptId/run','attempts/:attemptId/submit','attempts/:attemptId/results/publish'])
 async create(@Req() request: DomainRequest,@Res({passthrough:true}) response: Response){return applyResponse(response,await this.domain.execute('schoolPaper4',request.domainContext));}
 @Patch(['papers/:paperId','attempts/:attemptId/marks'])
 async update(@Req() request: DomainRequest,@Res({passthrough:true}) response: Response){return applyResponse(response,await this.domain.execute('schoolPaper4',request.domainContext));}
 @Put('attempts/:attemptId/files/:questionKey')
 async save(@Req() request: DomainRequest,@Res({passthrough:true}) response: Response){return applyResponse(response,await this.domain.execute('schoolPaper4',request.domainContext));}
}
@Module({controllers:[SchoolPaper4Controller]})
export class SchoolPaper4Module {}

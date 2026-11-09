import { Controller, Get, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';
import { DomainService } from '../domain.service.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class SchoolPracticeController {
 constructor(private readonly domain: DomainService) {}
 @Get(['practice/scholarship/me','practice/luq/me','practice/leaderboard','practice/submissions','practice/submissions/:schoolId/:jobId','practice/review-notebook','schools/:schoolId/problems/:problemId/submissions','schools/:schoolId/problems/:problemId/tutorial','practice/problems/:problemId/submissions','schools/:schoolId/submissions','schools/:schoolId/problem-banks','schools/:schoolId/problems','schools/:schoolId/problems/:problemId','schools/:schoolId/judge-status','schools/:schoolId/judge-jobs/:jobId','practice/problems','practice/problems/:problemId','practice/problems/:problemId/submissions/:jobId','platform/problem-publications','platform/problem-publications/:problemId'])
 async read(@Req() request: DomainRequest,@Res({passthrough:true}) response: Response){return applyResponse(response,await this.domain.execute('schoolPractice',request.domainContext));}
 @Post(['practice/scholarship/assistance/quote','practice/luq/assistance/quote','practice/scholarship/assistance/unlock','practice/luq/assistance/unlock','practice/scholarship/assistance/provide','practice/luq/assistance/provide','schools/:schoolId/problems/:problemId/public-request','platform/problem-publications/:problemId/reject','schools/:schoolId/problem-banks','schools/:schoolId/problems','schools/:schoolId/problems/:problemId/validate','schools/:schoolId/problems/:problemId/publish','schools/:schoolId/problems/:problemId/unpublish','schools/:schoolId/problems/:problemId/submissions','practice/problems/:problemId/submissions','platform/problem-publications','platform/problem-publications/:problemId/withdraw'])
 async create(@Req() request: DomainRequest,@Res({passthrough:true}) response: Response){return applyResponse(response,await this.domain.execute('schoolPractice',request.domainContext));}
 @Patch(['practice/submissions/:schoolId/:jobId/note','schools/:schoolId/problem-banks/:bankId','schools/:schoolId/problems/:problemId','schools/:schoolId/problems/:problemId/tutorial'])
 async update(@Req() request: DomainRequest,@Res({passthrough:true}) response: Response){return applyResponse(response,await this.domain.execute('schoolPractice',request.domainContext));}
}
@Module({controllers:[SchoolPracticeController]})
export class SchoolPracticeModule {}

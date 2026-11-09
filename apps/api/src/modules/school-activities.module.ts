import { Controller, Get, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';
import { DomainService } from '../domain.service.js';

@Controller('api/v1/schools/:schoolId/activities')
@UseGuards(DomainGuard)
export class SchoolActivitiesController {
 constructor(private readonly domain: DomainService) {}
 @Get(['','options',':activityId',':activityId/report',':activityId/problems/:problemId', ':activityId/problems/:problemId/submissions',':activityId/jobs/:jobId',':activityId/preview',':activityId/preview/problems/:problemId',':activityId/preview/problems/:problemId/submissions',':activityId/preview/jobs/:jobId'])
 async read(@Req() request: DomainRequest,@Res({passthrough:true}) response: Response){return applyResponse(response,await this.domain.execute('schoolActivities',request.domainContext));}
 @Post(['',':activityId/publish',':activityId/archive',':activityId/start',':activityId/finish',':activityId/end',':activityId/publish-results',':activityId/problems/:problemId/submissions',':activityId/preview/problems/:problemId/submissions'])
 async create(@Req() request: DomainRequest,@Res({passthrough:true}) response: Response){return applyResponse(response,await this.domain.execute('schoolActivities',request.domainContext));}
 @Patch(':activityId')
 async update(@Req() request: DomainRequest,@Res({passthrough:true}) response: Response){return applyResponse(response,await this.domain.execute('schoolActivities',request.domainContext));}
}
@Module({controllers:[SchoolActivitiesController]})
export class SchoolActivitiesModule {}

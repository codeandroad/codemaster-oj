import { Controller, Get, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';
import { DomainService } from '../domain.service.js';
@Controller('api/v1')
@UseGuards(DomainGuard)
export class SchoolScholarshipController {
 constructor(private readonly domain: DomainService) {}
 @Get(['schools/:schoolId/scholarship/settings','schools/:schoolId/scholarship/wallet','schools/:schoolId/scholarship/ledger','schools/:schoolId/scholarship/recipients','schools/:schoolId/scholarship/targets','schools/:schoolId/scholarship/content','schools/:schoolId/scholarship/activity-rule','schools/:schoolId/scholarship/usage'])
 async read(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('schoolScholarship',request.domainContext));}
 @Post(['schools/:schoolId/scholarship/grant','schools/:schoolId/scholarship/refund','schools/:schoolId/scholarship/assistance/quote','schools/:schoolId/scholarship/assistance/unlock','schools/:schoolId/scholarship/assistance/provide','schools/:schoolId/scholarship/content','schools/:schoolId/scholarship/contents/review','schools/:schoolId/scholarship/policies','schools/:schoolId/scholarship/activity-rule'])
 async write(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('schoolScholarship',request.domainContext));}
 @Patch('schools/:schoolId/scholarship/settings')
 async update(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('schoolScholarship',request.domainContext));}
}
@Module({controllers:[SchoolScholarshipController]})
export class SchoolScholarshipModule {}

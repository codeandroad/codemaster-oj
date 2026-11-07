import {Controller,Get,Post,Delete,Module,Req,Res,UseGuards} from '@nestjs/common';
import type {Response} from 'express';
import {DomainService} from '../domain.service.js';
import {DomainGuard,type DomainRequest} from '../domain.guard.js';
import {applyResponse} from '../domain.response.js';
@Controller('api/v1')
@UseGuards(DomainGuard)
class PublicLearningController {
 constructor(private readonly domain:DomainService) {}
 @Get('practice/catalog') catalog(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Get('practice/courses/:id') course(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Get('practice/courses/:id/entry') entry(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Post('practice/courses/:id/applications') apply(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Post('practice/courses/:id/chapters/:chapterId/read') read(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Get(['schools/:schoolId/course-admissions', 'schools/:schoolId/course-admissions/:courseId']) admissions(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Post(['schools/:schoolId/course-admissions/:courseId', 'schools/:schoolId/course-admissions/:courseId/:applicationId/decision'])
 updateAdmissions(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Delete('schools/:schoolId/course-admissions/:courseId') closeAdmissions(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Get('platform/course-publications') review(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Post('platform/course-publications') publish(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Delete('platform/course-publications/:id') withdraw(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 private async execute(req:DomainRequest,res:Response){return applyResponse(res,await this.domain.execute('publicLearning',req.domainContext));}
}
@Module({controllers:[PublicLearningController]})
export class PublicLearningModule {}

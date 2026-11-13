import {Controller,Get,Post,Patch,Delete,Module,Req,Res,UseGuards} from '@nestjs/common';
import type {Response} from 'express';
import {DomainService} from '../domain.service.js';
import {DomainGuard,type DomainRequest} from '../domain.guard.js';
import {applyResponse} from '../domain.response.js';
@Controller('api/v1')
@UseGuards(DomainGuard)
class PublicLearningController {
 constructor(private readonly domain:DomainService) {}
 @Get(['platform/problem-banks','platform/content-access','platform/content-editor-candidates','platform/content-editors/:kind/batch','platform/content-editors/:kind/:id','platform/source-problems','platform/source-problems/:id','platform/source-problems/:id/tutorial','platform/source-problems/:id/contents','platform/source-problems/:id/public-statement']) contentRead(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Post(['platform/problem-banks','platform/problem-banks/:id/archive','platform/problem-banks/:id/restore','platform/content-editors/:kind/batch','platform/content-editors/:kind/:id','platform/source-problems/import','platform/source-problems/batch','platform/source-problems','platform/source-problems/:id/validate','platform/source-problems/:id/contents','platform/source-problems/:id/contents/:contentId/publish','platform/source-problems/:id/versions','platform/source-problems/:id/publish','platform/source-problems/:id/public-statement']) contentWrite(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Patch('platform/problem-banks/:id') contentBank(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Patch('platform/source-problems/:id/tutorial') contentTutorial(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Delete(['platform/content-editors/:kind/batch','platform/content-editors/:kind/:id']) contentRevoke(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Get(['platform/courses','platform/courses/audience','platform/courses/acsl-links','platform/courses/problem-options','platform/courses/paper4-options','platform/courses/:id']) platformCourses(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Post(['platform/courses','platform/courses/:id/publish','platform/courses/:id/unpublish','platform/courses/:id/archive','platform/courses/:id/restore']) platformCourseAction(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Patch('platform/courses/:id') platformCourseUpdate(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Get('platform/courses/:id/admissions') platformAdmissions(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Post(['platform/courses/:id/admissions/:applicationId/decision','platform/courses/:id/rules/:ruleId/invitation']) platformAdmissionAction(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Get(['practice/catalog','practice/courses']) catalog(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Get('practice/courses/:id') course(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Get('practice/courses/:id/entry') entry(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Post('practice/courses/:id/applications') apply(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
 @Post('practice/courses/:id/invitations/redeem') redeem(@Req() req:DomainRequest,@Res({passthrough:true}) res:Response){return this.execute(req,res);}
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

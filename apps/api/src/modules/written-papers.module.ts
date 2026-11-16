import { Controller, Get, Module, Patch, Post, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1/schools/:schoolId/written-papers')
@UseGuards(DomainGuard)
class WrittenPapersController {
 constructor(private readonly domain: DomainService) {}
 @Get([':paperId/assets/:assetId','attempts/:attemptId/attachments/:attachmentId'])
 async asset(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){
  const result=await this.domain.execute('writtenPapers',request.domainContext);
  const asset=result.body as {content:Buffer;mimeType:string;filename:string};
  response.setHeader('Cache-Control','private, no-store');
  response.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
  return new StreamableFile(asset.content,{type:asset.mimeType,disposition:asset.mimeType==='application/pdf'?`attachment; filename="${asset.filename}"`:'inline'});
 }
 @Get(['',':paperId',':paperId/attempts','attempts/:attemptId'])
 async read(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){
  response.setHeader('Cache-Control','private, no-store');return applyResponse(response,await this.domain.execute('writtenPapers',request.domainContext));
 }
 @Post(['import-preview','import',':paperId/publish',':paperId/attempts','attempts/:attemptId/submit','attempts/:attemptId/release','attempts/:attemptId/attachments'])
 async create(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('writtenPapers',request.domainContext));}
 @Patch(['attempts/:attemptId/answers','attempts/:attemptId/marks','attempts/:attemptId/reflection'])
 async save(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('writtenPapers',request.domainContext));}
}
@Module({controllers:[WrittenPapersController]})
export class WrittenPapersModule {}

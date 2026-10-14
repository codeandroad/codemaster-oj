import { Controller, Delete, Get, Module, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class CommunityController {
 constructor(private readonly domain: DomainService) {}

 @Get('student-notifications')
 async notifications(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Post('student-notifications/read-all')
 async readAllNotifications(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Post('student-notifications/:notificationId/read')
 async readNotification(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }

 @Get('profile-message-reports')
 async allReports(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Post('profile-message-reports/:reportId/dismiss')
 async dismissReport(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Get('profiles/:identityId')
 async profile(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Get('profiles/:identityId/activity')
 async activity(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Get('profiles/:identityId/messages')
 async messages(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Post('profiles/:identityId/messages')
 async createMessage(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Delete('profiles/:identityId/messages/:messageId')
 async deleteMessage(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Post('profiles/:identityId/messages/:messageId/report')
 async reportMessage(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Get('profiles/:identityId/message-reports')
 async reports(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
}

@Module({controllers:[CommunityController]})
export class CommunityModule {}

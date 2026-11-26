import { Controller, Delete, Get, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class CommunityController {
 constructor(private readonly domain: DomainService) {}

 @Patch('account/profile-cover')
 async updateProfileCover(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }

 @Get('account/guestbook-settings')
 async guestbookSettings(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Patch('account/guestbook-settings')
 async updateGuestbookSettings(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }

 @Get('practice/presence')
 async publicPresence(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('publicPresence',request.domainContext));
 }
 @Post('practice/presence/heartbeat')
 async publicHeartbeat(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('publicPresence',request.domainContext));
 }
 @Get('practice/presence/students/:identityId')
 async publicPreview(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('publicPresence',request.domainContext));
 }

 @Get('presence')
 async presence(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('presence',request.domainContext));
 }
 @Post('presence/heartbeat')
 async heartbeat(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('presence',request.domainContext));
 }
 @Get('presence/students/:identityId')
 async studentPreview(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('presence',request.domainContext));
 }

 @Get(['student-notifications','schools/:schoolId/student-notifications','staff-notifications','schools/:schoolId/staff-notifications','account-notifications'])
 async notifications(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Post(['student-notifications/read-all','schools/:schoolId/student-notifications/read-all',
  'staff-notifications/read-all','schools/:schoolId/staff-notifications/read-all','account-notifications/read-all'])
 async readAllNotifications(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Post(['student-notifications/:notificationId/read','schools/:schoolId/student-notifications/:notificationId/read',
  'staff-notifications/:notificationId/read','schools/:schoolId/staff-notifications/:notificationId/read','account-notifications/:notificationId/read'])
 async readNotification(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }

 @Get(['profile-message-reports','schools/:schoolId/profile-message-reports','platform/profile-message-reports'])
 async allReports(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Post(['profile-message-reports/:reportId/dismiss','schools/:schoolId/profile-message-reports/:reportId/dismiss','platform/profile-message-reports/:reportId/dismiss'])
 async dismissReport(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Get(['homepages/:profileId','homepages/:profileId/messages','profiles/:identityId','schools/:schoolId/profiles','schools/:schoolId/profiles/:identityId','practice/profiles/:accountId','platform/schools/:schoolId/profiles/:identityId'])
 async profile(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Patch('practice/profiles/:accountId')
 async updateProfile(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Get(['profiles/:identityId/activity','schools/:schoolId/profiles/:identityId/activity','practice/profiles/:accountId/activity','platform/schools/:schoolId/profiles/:identityId/activity'])
 async activity(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Get(['profiles/:identityId/messages','schools/:schoolId/profiles/:identityId/messages','practice/profiles/:accountId/messages',
  'platform/schools/:schoolId/profiles/:identityId/messages','platform/schools/:schoolId/profiles/:identityId/messages/:messageId/replies',
  'profiles/:identityId/messages/:messageId/replies','schools/:schoolId/profiles/:identityId/messages/:messageId/replies','practice/profiles/:accountId/messages/:messageId/replies',
  'profiles/:identityId/mentions','schools/:schoolId/profiles/:identityId/mentions','practice/profiles/:accountId/mentions',
  'platform/schools/:schoolId/profiles/:identityId/mentions'])
 async messages(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Post(['profiles/:identityId/messages','schools/:schoolId/profiles/:identityId/messages','practice/profiles/:accountId/messages',
  'platform/schools/:schoolId/profiles/:identityId/messages'])
 async createMessage(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Delete(['profiles/:identityId/messages/:messageId','schools/:schoolId/profiles/:identityId/messages/:messageId','practice/profiles/:accountId/messages/:messageId',
  'platform/schools/:schoolId/profiles/:identityId/messages/:messageId'])
 async deleteMessage(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Post(['profiles/:identityId/messages/:messageId/like','schools/:schoolId/profiles/:identityId/messages/:messageId/like','practice/profiles/:accountId/messages/:messageId/like',
  'platform/schools/:schoolId/profiles/:identityId/messages/:messageId/like'])
 async likeMessage(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
 @Get(['profiles/:identityId/message-reports','schools/:schoolId/profiles/:identityId/message-reports'])
 async reports(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response) {
  return applyResponse(response,await this.domain.execute('community',request.domainContext));
 }
}

@Module({controllers:[CommunityController]})
export class CommunityModule {}

import { Controller, Delete, Get, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';
import { DomainService } from '../domain.service.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class SchoolsController {
  constructor(private readonly domain: DomainService) {}

  @Get([
    'schools',
    'schools/join-requests',
    'schools/:schoolId/join-requests',
    'schools/:schoolId/join-requests/:requestId/candidates',
    'schools/:schoolId/problem-groups',
    'schools/:schoolId/problem-groups/:id',
    'schools/:schoolId/import-history',
    'schools/:schoolId/members',
    'schools/:schoolId/accounts',
    'schools/:schoolId/accounts/:accountId',
    'schools/:schoolId/exit-request',
    'schools/:schoolId/exit-requests',
    'schools/:schoolId/student-exits',
    'schools/:schoolId/identities',
    'schools/:schoolId/identities/:identityId/classes',
    'schools/:schoolId/identities/:identityId/details',
    'schools/:schoolId/identities/:identityId/profile',
    'schools/:schoolId/classes',
    'schools/:schoolId/classes/:classId',
    'schools/:schoolId/classes/:classId/members',
    'schools/:schoolId/classes/:classId/roster',
    'schools/:schoolId/classes/:classId/candidates',
    'schools/:schoolId/courses',
    'schools/:schoolId/courses/:courseId',
    'schools/:schoolId/courses/:courseId/preview',
    'schools/:schoolId/courses/:courseId/bookmark',
    'schools/:schoolId/learning-resources',
    'schools/:schoolId/learning-resources/:resourceId',
  ])
  async read(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('schools', request.domainContext));
  }

  @Post([
    'schools/:schoolId/problem-groups',
    'schools/:schoolId/problem-groups/:id/move',
    'schools/:schoolId/join-requests',
    'schools/:schoolId/join-requests/:requestId/decision',
    'schools/:schoolId/exit-request',
    'schools/:schoolId/exit-requests/:requestId/decision',
    'schools/:schoolId/student-exits',
    'schools/:schoolId/identities',
    'schools/:schoolId/identities/:identityId/archive',
    'schools/:schoolId/identities/:identityId/restore',
    'schools/:schoolId/identities/:identityId/activation-code',
    'schools/:schoolId/identities/activation-batch',
    'schools/:schoolId/identity-imports/preview',
    'schools/:schoolId/identity-imports/commit',
    'schools/:schoolId/classes',
    'schools/:schoolId/classes/:classId/roster',
    'schools/:schoolId/classes/:classId/archive',
    'schools/:schoolId/classes/:classId/restore',
    'schools/:schoolId/courses',
    'schools/:schoolId/courses/:courseId/publish',
    'schools/:schoolId/courses/:courseId/unpublish',
    'schools/:schoolId/courses/:courseId/archive',
    'schools/:schoolId/courses/:courseId/restore',
    'schools/:schoolId/learning-resources',
    'schools/:schoolId/courses/:courseId/chapters/:chapterId/read',
  ])
  async create(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('schools', request.domainContext));
  }

  @Patch([
    'schools/:schoolId/identities/:identityId/profile',
    'schools/:schoolId/identities/:identityId/classes',
    'schools/:schoolId/accounts/:accountId/roles',
    'schools/:schoolId/accounts/:accountId/access',
    'schools/:schoolId/problem-groups/:id','schools/:schoolId/learning-resources/:resourceId', 'schools/:schoolId/classes/:classId', 'schools/:schoolId/identities/:identityId/account', 'schools/:schoolId/courses/:courseId', 'schools/:schoolId/courses/:courseId/admission-settings'])
  async update(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('schools', request.domainContext));
  }

  @Delete(['schools/:schoolId/problem-groups/:id', 'schools/:schoolId/learning-resources/:resourceId', 'schools/:schoolId/members/:accountId', 'schools/:schoolId/classes/:classId/roster/:identityId'])
  async remove(@Req() request: DomainRequest, @Res({ passthrough: true }) response: Response) {
    return applyResponse(response, await this.domain.execute('schools', request.domainContext));
  }
}

@Module({ controllers: [SchoolsController] })
export class SchoolsModule {}

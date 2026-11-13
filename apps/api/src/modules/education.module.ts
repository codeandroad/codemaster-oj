import { Controller, Module, Req, Res, UseGuards, Delete, Get, Patch, Post, StreamableFile } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { DomainService } from '../domain.service.js';
import { DomainGuard, type DomainRequest } from '../domain.guard.js';
import { applyResponse } from '../domain.response.js';

@Controller('api/v1')
@UseGuards(DomainGuard)
export class EducationController {
  constructor(private readonly domain: DomainService) {}

  @Get('points/me')
  async pointsMe(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}
  @Get('points/leaderboard')
  async leaderboard(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}
  @Get('points/leaderboard/contexts')
  async leaderboardContexts(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}
  @Get('points/leaderboard/settings')
  async leaderboardSettings(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}
  @Patch('points/leaderboard/settings')
  async updateLeaderboardSettings(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}
  @Get('points/rewards')
  async rewardList(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}
  @Post('points/rewards')
  async reward(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}
  @Patch('timed-practices/:id')
  async editPractice(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Get('teaching/audience')
  async audience(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}


  @Get('learning-resources')
  async resources(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Get('learning-resources/:id')
  async resource(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}

  @Post('learning-resources')
  async createResource(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Patch('learning-resources/:id')
  async editResource(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Delete('learning-resources/:id')
  async archiveResource(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }


  @Get('reports')
  async report(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Get('reports/export')
  async exportReport(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Get('learning-paths')
  async paths(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('learning-paths')
  async createPath(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('learning-paths/import')
  async importPath(@Req() request: DomainRequest, @Res({passthrough:true}) response:Response):Promise<unknown>{return applyResponse(response,await this.domain.execute('education',request.domainContext));}

  @Post('learning-paths/:id/python-exercises')
  async prepareExercises(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response):Promise<unknown>{return applyResponse(response,await this.domain.execute('education',request.domainContext));}

  @Post('learning-paths/:id/python-exercises/publish')
  async publishExercises(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response):Promise<unknown>{return applyResponse(response,await this.domain.execute('education',request.domainContext));}

  @Get('learning-paths/:id/progress')
  async pathProgress(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response):Promise<unknown>{return applyResponse(response,await this.domain.execute('education',request.domainContext));}

  @Get('learning-paths/:id/cover')
  async pathCover(@Req() request: DomainRequest, @Res({passthrough:true}) response: Response): Promise<unknown> {
    // Resolve current catalog access before considering a cached image's ETag.
    const result = await this.domain.execute('education', request.domainContext);
    const { content, type } = result.body as { content: Buffer; type: string };
    const etag = `"${createHash('sha256').update(content).digest('hex')}"`;
    response.setHeader('Cache-Control', 'private, no-cache');
    response.setHeader('ETag', etag);
    const conditional = request.headers['if-none-match'];
    if (typeof conditional === 'string' && conditional.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag)) {
      response.status(304);
      return;
    }
    response.status(result.status);
    return new StreamableFile(content, { type, disposition: 'inline', length: content.length });
  }

  @Get('learning-paths/:id')
  async path(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Patch('learning-paths/:id')
  async updatePath(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('learning-paths/:id/merge')
  async mergePath(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('learning-paths/:id/restore')
  async restorePath(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('learning-paths/:id/unpublish')
  async unpublishPath(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}

  @Post('learning-paths/:id/publish')
  async publishPath(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('learning-paths/:id/chapters')
  async addChapter(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Patch('chapters/:id')
  async updateChapter(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Delete('chapters/:id')
  async deleteChapter(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('chapters/:id/progress')
  async progress(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Get('timed-practices')
  async practices(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('timed-practices')
  async createPractice(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Get('timed-practices/:id')
  async practice(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Get('timed-practices/:id/result-revisions')
  async resultRevisions(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Get('timed-practices/:id/results')
  async results(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('timed-practices/:id/publish')
  async publishPractice(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('timed-practices/:id/start')
  async start(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('timed-practices/:id/finish')
  async finish(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('timed-practices/:id/end')
  async end(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('timed-practices/:id/results')
  async publishResults(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('timed-practices/:id/extend')
  async extendPractice(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('timed-practices/:id/exempt')
  async exemptPractice(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('timed-practices/:id/archive')
  async archivePractice(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Post('timed-practices/:id/restore')
  async restorePractice(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }
}

@Module({controllers: [EducationController]})
export class EducationModule {}

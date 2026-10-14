import { Controller, Module, Req, Res, UseGuards, Delete, Get, Patch, Post } from '@nestjs/common';
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
  @Patch('points/leaderboard/contexts/:id')
  async updateLeaderboardContext(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}
  @Get('points/rewards')
  async rewardList(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}
  @Post('points/rewards')
  async reward(@Req() request: DomainRequest,@Res({passthrough:true}) response:Response){return applyResponse(response,await this.domain.execute('education',request.domainContext));}
  @Patch('timed-practices/:id')
  async editPractice(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Get('learning-resources')
  async resources(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

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

  @Get('learning-paths/:id')
  async path(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

  @Patch('learning-paths/:id')
  async updatePath(@Req() request: DomainRequest, @Res({passthrough: true}) response: Response): Promise<unknown> {
    return applyResponse(response, await this.domain.execute('education', request.domainContext));
  }

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
}

@Module({controllers: [EducationController]})
export class EducationModule {}

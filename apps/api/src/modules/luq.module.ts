import {Controller,Get,Module,Patch,Post,Req,Res,UseGuards} from '@nestjs/common';
import type {Response} from 'express';
import {DomainService} from '../domain.service.js';
import {DomainGuard,type DomainRequest} from '../domain.guard.js';
import {applyResponse} from '../domain.response.js';

@Controller('api/v1/luq')
@UseGuards(DomainGuard)
export class LuqController {
 constructor(private readonly domain:DomainService){}
 private execute(request:DomainRequest,response:Response){return this.domain.execute('luq',request.domainContext).then(result=>applyResponse(response,result));}
 @Get('me') me(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Get('ledger') ledger(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Get('reviews') reviews(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Get('settings') settings(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Patch('settings') updateSettings(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('grants') grants(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('adjustments') adjustments(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('refunds') refunds(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Get('reward-rules') rules(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('reward-rules') updateRules(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Get('contents') contents(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('contents') createContent(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Get('contents/review') reviewContents(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('contents/batch-publish') batchPublishContents(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('contents/:id/publish') publishContent(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Get('public-statements') publicStatements(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('public-statements') publishPublicStatement(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Get('policies') policies(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('policies') updatePolicies(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('policies/batch-prices') batchPrices(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('assistance/quote') quote(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('assistance/unlock') unlock(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Post('assistance/provide') provide(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
 @Get('usage') usage(@Req() request:DomainRequest,@Res({passthrough:true}) response:Response){return this.execute(request,response);}
}

@Module({controllers:[LuqController]})
export class LuqModule {}

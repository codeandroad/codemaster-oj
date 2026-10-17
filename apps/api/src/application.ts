import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, {type Request, type Response, type NextFunction} from 'express';
import { AppModule } from './app.module.js';
import { configureTrustedProxies } from './client-ip.js';
import { paper4RequestBodyLimit } from '../../../packages/domain/src/paper4-request-limit.mjs';
import { DomainExceptionFilter } from './domain.filter.js';
import type { RuntimeOptions } from './domain.service.js';

export async function createApiApplication(options: RuntimeOptions = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(options),
    {bodyParser: false, logger: options.logger});
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable('x-powered-by');
  configureTrustedProxies(expressApp);
  const parser = express.raw({type: () => true, limit: 2_097_152, inflate: false});
  const paper4BatchParser = express.raw({type: () => true, limit: 12_582_912, inflate: false});
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const parse = paper4RequestBodyLimit(request.originalUrl, request.method) > 2_097_152 ? paper4BatchParser : parser;
    parse(request, response, (error?: {type?: string; status?: number}) => {
      if (!error) return next();
      const status = error.type === 'entity.too.large' ? 413 : error.status === 415 ? 415 : 400;
      response.status(status).json({error: {code: status === 413 ? 'TOO_LARGE' : status === 415 ? 'CONTENT_TYPE' : 'JSON',
        message: status === 413 ? '请求过大' : status === 415 ? '请使用未压缩 JSON 请求' : '请求格式无效'}});
    });
  });
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  const server = app.getHttpServer();
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000;
  await app.init();
  return app;
}

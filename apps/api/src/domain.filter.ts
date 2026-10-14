import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { errorResponse } from '../../../packages/domain/src/http-contract.mjs';
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const status = error.getStatus();
      response.status(status).json({error: {code: status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
        message: status === 404 ? '接口不存在' : '请求无效'}});
      return;
    }
    const result = errorResponse(error);
    response.status(result.status).json(result.body);
  }
}

import { Injectable, Inject, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { createDomainServices, loadConfig } from '../../../packages/domain/src/application.mjs';
import { cleanupExpiredMemberImports } from '../../../packages/domain/src/member-import.mjs';
import { parseJsonBody } from '../../../packages/domain/src/http-contract.mjs';
import type { DomainContext, DomainArea, DomainServices, DomainConfig } from '../../../packages/domain/src/application.mjs';

export const RUNTIME_OPTIONS = Symbol('RUNTIME_OPTIONS');
export interface RuntimeOptions { databaseUrl?: string; config?: DomainConfig; logger?: false; }

@Injectable()
export class DomainService implements OnModuleInit, OnModuleDestroy {
  private readonly pool;
  private services!: DomainServices;
  private cleanup?: NodeJS.Timeout;
  readonly config: DomainConfig;

  constructor(@Inject(RUNTIME_OPTIONS) options: RuntimeOptions) {
    this.config = options.config ?? loadConfig();
    this.pool = createPool(options.databaseUrl);
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
    await cleanupExpiredMemberImports(this.pool);
    this.services = await createDomainServices(this.pool, this.config);
    this.cleanup = setInterval(() => {
      void cleanupExpiredMemberImports(this.pool).catch((error: {code?: string; name?: string}) =>
        console.error('Import credential cleanup failed', {code: error.code ?? error.name}));
    }, 60_000).unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanup) clearInterval(this.cleanup);
    await this.pool.end();
  }

  async prepare(input: {url: string; method: string; headers: IncomingHttpHeaders; rawBody?: Buffer; ip?: string}): Promise<DomainContext> {
    const context = await this.services.prepareRequest({...input, body: {}});
    if (!['GET', 'HEAD', 'OPTIONS'].includes(input.method)) {
      context.body = parseJsonBody(input.rawBody, input.headers, this.config.bodyLimit);
    }
    return context;
  }

  execute(area: DomainArea, context: DomainContext) { return this.services.execute(area, context); }
  health() { return this.services.health(); }
}

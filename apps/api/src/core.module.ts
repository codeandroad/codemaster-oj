import { Global, Module, type DynamicModule } from '@nestjs/common';
import { DomainService, RUNTIME_OPTIONS, type RuntimeOptions } from './domain.service.js';
import { DomainGuard } from './domain.guard.js';
@Global()
@Module({})
export class CoreModule {
  static register(options: RuntimeOptions): DynamicModule {
    return {module: CoreModule, global: true,
      providers: [{provide: RUNTIME_OPTIONS, useValue: options}, DomainService, DomainGuard],
      exports: [DomainService, DomainGuard]};
  }
}

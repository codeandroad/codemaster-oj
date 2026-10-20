import { Controller, Get, Module, type DynamicModule } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { DomainService, type RuntimeOptions } from './domain.service.js';
import {AuthModule} from './modules/auth.module.js';
import {PeopleModule} from './modules/people.module.js';
import {ClassesModule} from './modules/classes.module.js';
import {LibraryModule} from './modules/library.module.js';
import {AssignmentsModule} from './modules/assignments.module.js';
import {SubmissionsModule} from './modules/submissions.module.js';
import {EducationModule} from './modules/education.module.js';
import {CommunityModule} from './modules/community.module.js';
import {SystemModule} from './modules/system.module.js';
import {Paper4Module} from './modules/paper4.module.js';
import {LuqModule} from './modules/luq.module.js';

@Controller()
class HealthController {
  constructor(private readonly domain: DomainService) {}
  @Get('healthz') health() { return this.domain.health(); }
}
@Module({})
export class AppModule {
  static register(options: RuntimeOptions): DynamicModule {
    return {module: AppModule,
      imports: [CoreModule.register(options), AuthModule, PeopleModule, ClassesModule, LibraryModule, AssignmentsModule, SubmissionsModule, EducationModule, CommunityModule, SystemModule, Paper4Module, LuqModule],
      controllers: [HealthController]};
  }
}

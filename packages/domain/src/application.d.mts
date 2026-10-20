import type {IncomingHttpHeaders} from 'node:http';
export interface DomainConfig {secret: string; origins: string[]; secure: boolean; bodyLimit: number; codeLimit: number;}
export type DomainArea='auth'|'people'|'classes'|'library'|'assignments'|'submissions'|'education'|'community'|'system'|'paper4'|'luq';
export interface DomainResponse {status: number; body: unknown; cookie?: string;}
export interface DomainContext {route: string; method: string; body: Record<string, unknown>; [key: string]: unknown;}
export interface DomainServices {
 prepareRequest(input: {url: string; method: string; headers?: IncomingHttpHeaders; body?: Record<string, unknown>; ip?: string}): Promise<DomainContext>;
 execute(area: DomainArea, context: DomainContext): Promise<DomainResponse>;
 health(): Promise<{ok: true; database: true}>;
}
export function loadConfig(env?: NodeJS.ProcessEnv): DomainConfig;
export function createDomainServices(pool: unknown, config: DomainConfig): Promise<DomainServices>;
export function resourceArea(route: string): DomainArea | null;

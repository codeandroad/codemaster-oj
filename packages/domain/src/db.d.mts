export interface DatabasePool {query(sql: string, values?: unknown[]): Promise<{rows: Record<string, any>[]; rowCount: number}>; end(): Promise<void>;}
export function createPool(url?: string): DatabasePool;
export function transaction<T>(pool: DatabasePool, operation: (client: unknown)=>Promise<T>): Promise<T>;

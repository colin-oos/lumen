export declare function isSqliteConfig(config: string | null | undefined): config is string;
export declare function parseSqliteConfig(config: string): {
    path: string;
    table: string;
} | null;
export declare function loadSqlite(config: string, where?: (row: Record<string, unknown>) => boolean, projection?: string[]): Array<Record<string, unknown>>;

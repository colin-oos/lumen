import { Expr } from '@lumen/core-ir';
export interface RunResult {
    value: unknown;
    trace: Array<{
        sid: string;
        note: string;
    }>;
}
export declare function run(ast: Expr, options?: {
    deniedEffects?: Set<string>;
    mockEffects?: boolean;
    schedulerSeed?: string;
}): RunResult;

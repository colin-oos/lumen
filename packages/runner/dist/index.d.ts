import { Expr } from '@lumen/core-ir';
export interface RunResult {
    value: unknown;
    trace: Array<{
        sid: string;
        note: string;
    }>;
    denials?: Array<{
        effect: string;
        reason: string;
    }>;
}
export declare function run(ast: Expr, options?: {
    deniedEffects?: Set<string>;
    mockEffects?: boolean;
    schedulerSeed?: string;
}): RunResult;

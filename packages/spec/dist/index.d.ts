export interface SpecFailure {
    message: string;
    sid?: string;
}
export declare function assert(cond: boolean, message: string): void;

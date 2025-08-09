export type Diagnostic = {
    message: string;
};
export declare function getDiagnostics(source: string): Array<{
    line: number;
    message: string;
}>;
export declare function getHover(source: string, symbol: string): any;
export declare function getReferences(source: string, symbol: string): Array<{
    line: number;
    column: number;
}>;
export declare function getCompletions(prefix: string): string[];
export declare function rename(source: string, oldName: string, newName: string): {
    edits: Array<{
        line: number;
        column: number;
        length: number;
    }>;
    newSource: string;
};

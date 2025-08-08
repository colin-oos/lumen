export type Diagnostic = {
    message: string;
};
export declare function getDiagnostics(source: string): Diagnostic[];
export declare function getHover(source: string, symbol: string): any;

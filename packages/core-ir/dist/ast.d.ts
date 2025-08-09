export type Sid = string;
export type Span = {
    start: number;
    end: number;
    line?: number;
    col?: number;
};
export type Expr = {
    kind: 'LitNum';
    sid: Sid;
    value: number;
    span?: Span;
} | {
    kind: 'LitFloat';
    sid: Sid;
    value: number;
    span?: Span;
} | {
    kind: 'LitText';
    sid: Sid;
    value: string;
    span?: Span;
} | {
    kind: 'LitBool';
    sid: Sid;
    value: boolean;
    span?: Span;
} | {
    kind: 'Var';
    sid: Sid;
    name: string;
    span?: Span;
} | {
    kind: 'Let';
    sid: Sid;
    name: string;
    type?: string;
    expr: Expr;
    mutable?: boolean;
    span?: Span;
} | {
    kind: 'Fn';
    sid: Sid;
    name: string | null;
    params: Array<{
        name: string;
        type?: string;
    }>;
    returnType?: string;
    body: Expr;
    effects: EffectSet;
    span?: Span;
} | {
    kind: 'Call';
    sid: Sid;
    callee: Expr;
    args: Expr[];
    span?: Span;
} | {
    kind: 'Unary';
    sid: Sid;
    op: 'not' | 'neg';
    expr: Expr;
    span?: Span;
} | {
    kind: 'Binary';
    sid: Sid;
    op: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or';
    left: Expr;
    right: Expr;
    span?: Span;
} | {
    kind: 'If';
    sid: Sid;
    cond: Expr;
    then: Expr;
    else: Expr;
    span?: Span;
} | {
    kind: 'EffectCall';
    sid: Sid;
    effect: Effect;
    op: string;
    args: Expr[];
    span?: Span;
} | {
    kind: 'Block';
    sid: Sid;
    stmts: Expr[];
    span?: Span;
} | {
    kind: 'Assign';
    sid: Sid;
    name: string;
    expr: Expr;
    span?: Span;
} | {
    kind: 'RecordLit';
    sid: Sid;
    fields: Array<{
        name: string;
        expr: Expr;
    }>;
    span?: Span;
} | {
    kind: 'TupleLit';
    sid: Sid;
    elements: Expr[];
    span?: Span;
} | {
    kind: 'PatternOr';
    sid: Sid;
    left: Expr;
    right: Expr;
    span?: Span;
} | {
    kind: 'Match';
    sid: Sid;
    scrutinee: Expr;
    cases: Array<{
        pattern: Expr;
        guard?: Expr;
        body: Expr;
    }>;
    span?: Span;
} | {
    kind: 'SchemaDecl';
    sid: Sid;
    name: string;
    fields: Record<string, string>;
    span?: Span;
} | {
    kind: 'StoreDecl';
    sid: Sid;
    name: string;
    schema: string;
    config: string | null;
    span?: Span;
} | {
    kind: 'QueryDecl';
    sid: Sid;
    name: string;
    source: string;
    predicate?: Expr;
    projection?: string[];
    span?: Span;
} | {
    kind: 'ImportDecl';
    sid: Sid;
    path: string;
    name?: string;
    alias?: string;
    span?: Span;
} | {
    kind: 'ModuleDecl';
    sid: Sid;
    name: string;
    span?: Span;
} | {
    kind: 'EnumDecl';
    sid: Sid;
    name: string;
    variants: Array<{
        name: string;
        params: string[];
    }>;
    span?: Span;
} | {
    kind: 'Ctor';
    sid: Sid;
    name: string;
    args: Expr[];
    span?: Span;
} | {
    kind: 'ActorDecl';
    sid: Sid;
    name: string;
    param: {
        name: string;
        type?: string;
    } | null;
    body: Expr;
    effects: EffectSet;
    span?: Span;
} | {
    kind: 'ActorDeclNew';
    sid: Sid;
    name: string;
    state: Array<{
        name: string;
        type?: string;
        init: Expr;
    }>;
    handlers: Array<{
        pattern: Expr;
        guard?: Expr;
        replyType?: string;
        body: Expr;
    }>;
    effects: EffectSet;
    span?: Span;
} | {
    kind: 'Spawn';
    sid: Sid;
    actorName: string;
    span?: Span;
} | {
    kind: 'Send';
    sid: Sid;
    actor: Expr;
    message: Expr;
    span?: Span;
} | {
    kind: 'Ask';
    sid: Sid;
    actor: Expr;
    message: Expr;
    timeoutMs?: number;
    span?: Span;
} | {
    kind: 'Program';
    sid: Sid;
    decls: Expr[];
    span?: Span;
};
export type Effect = 'pure' | 'io' | 'fs' | 'net' | 'db' | 'time' | 'nondet' | 'gpu' | 'unchecked' | string;
export type EffectSet = Set<Effect>;
export declare function sid(prefix?: string): Sid;
export declare function program(decls: Expr[]): Expr;
export declare const litNum: (n: number) => Expr;
export declare const litText: (t: string) => Expr;
export declare const litBool: (b: boolean) => Expr;
export declare const variable: (name: string) => Expr;
export declare const letBind: (name: string, expr: Expr) => Expr;
export declare const fnExpr: (name: string | null, params: Array<{
    name: string;
    type?: string;
}>, body: Expr, effects?: EffectSet) => Expr;
export declare const call: (callee: Expr, args: Expr[]) => Expr;
export declare function assignStableSids(e: Expr): void;

export type Sid = string;
export type Expr = {
    kind: 'LitNum';
    sid: Sid;
    value: number;
} | {
    kind: 'LitText';
    sid: Sid;
    value: string;
} | {
    kind: 'LitBool';
    sid: Sid;
    value: boolean;
} | {
    kind: 'Var';
    sid: Sid;
    name: string;
} | {
    kind: 'Let';
    sid: Sid;
    name: string;
    type?: string;
    expr: Expr;
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
} | {
    kind: 'Call';
    sid: Sid;
    callee: Expr;
    args: Expr[];
} | {
    kind: 'Binary';
    sid: Sid;
    op: '+' | '-' | '*' | '/';
    left: Expr;
    right: Expr;
} | {
    kind: 'EffectCall';
    sid: Sid;
    effect: Effect;
    op: string;
    args: Expr[];
} | {
    kind: 'Block';
    sid: Sid;
    stmts: Expr[];
} | {
    kind: 'Assign';
    sid: Sid;
    name: string;
    expr: Expr;
} | {
    kind: 'RecordLit';
    sid: Sid;
    fields: Array<{
        name: string;
        expr: Expr;
    }>;
} | {
    kind: 'TupleLit';
    sid: Sid;
    elements: Expr[];
} | {
    kind: 'Match';
    sid: Sid;
    scrutinee: Expr;
    cases: Array<{
        pattern: Expr;
        guard?: Expr;
        body: Expr;
    }>;
} | {
    kind: 'SchemaDecl';
    sid: Sid;
    name: string;
    fields: Record<string, string>;
} | {
    kind: 'StoreDecl';
    sid: Sid;
    name: string;
    schema: string;
    config: string | null;
} | {
    kind: 'QueryDecl';
    sid: Sid;
    name: string;
    source: string;
    predicate?: string;
} | {
    kind: 'ImportDecl';
    sid: Sid;
    path: string;
} | {
    kind: 'ModuleDecl';
    sid: Sid;
    name: string;
} | {
    kind: 'EnumDecl';
    sid: Sid;
    name: string;
    variants: Array<{
        name: string;
        params: string[];
    }>;
} | {
    kind: 'Ctor';
    sid: Sid;
    name: string;
    args: Expr[];
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
} | {
    kind: 'Spawn';
    sid: Sid;
    actorName: string;
} | {
    kind: 'Send';
    sid: Sid;
    actor: Expr;
    message: Expr;
} | {
    kind: 'Ask';
    sid: Sid;
    actor: Expr;
    message: Expr;
} | {
    kind: 'Program';
    sid: Sid;
    decls: Expr[];
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

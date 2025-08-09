import { Expr } from '@lumen/core-ir'

export function format(ast: Expr): string {
  // naive pretty printer for the stub AST
  if (ast.kind === 'Program') {
    return ast.decls.map(formatOne).join('\n')
  }
  return formatOne(ast)
}

function formatOne(node: Expr): string {
  switch (node.kind) {
    case 'ImportDecl':
      if ((node as any).name) return `import ${(node as any).name}${(node as any).alias ? ` as ${(node as any).alias}` : ''}`
      return `import "${(node as any).path}"`
    case 'ModuleDecl':
      return `module ${node.name}`
    case 'Let': {
      const type = node.type ? `: ${node.type}` : ''
      const kw = (node as any).mutable ? 'mut' : 'let'
      return `${kw} ${node.name}${type} = ${formatOne(node.expr)}`
    }
    case 'EnumDecl': {
      const rhs = node.variants.map((v: any) => v.params && v.params.length > 0 ? `${v.name}(${v.params.join(', ')})` : v.name).join(' | ')
      return `enum ${node.name} = ${rhs}`
    }
    case 'SchemaDecl': {
      const fields = Object.entries(node.fields).map(([k,v]) => `  ${k}: ${v}`).join('\n')
      return `schema ${node.name} {\n${fields}\n}`
    }
    case 'StoreDecl': {
      const cfg = node.config ? ` = ${JSON.stringify(node.config)}` : ''
      return `store ${node.name} : ${node.schema}${cfg}`
    }
    case 'QueryDecl': {
      const where = node.predicate ? ` where ${formatOne(node.predicate)}` : ''
      const select = node.projection && node.projection.length ? ` select ${node.projection.join(', ')}` : ''
      return `query ${node.name} from ${node.source}${where}${select}`
    }
    case 'Assign':
      return `${node.name} = ${formatOne(node.expr)}`
    case 'Fn': {
      const params = (node.params as any[]).map((p: any) => p.type ? `${p.name}: ${p.type}` : p.name).join(', ')
      const ret = node.returnType ? `: ${node.returnType}` : ''
      const raises = node.effects && (node.effects as any as Set<string>).size > 0
        ? ` raises ${Array.from((node.effects as any as Set<string>).values()).join(', ')}`
        : ''
      return `fn ${node.name ?? ''}(${params})${ret}${raises} = ${formatOne(node.body)}`.replace('() =', '() =')
    }
    case 'LitText':
      return JSON.stringify(node.value)
    case 'LitFloat':
      return String(node.value)
    case 'LitNum':
      return String(node.value)
    case 'LitBool':
      return String(node.value)
    case 'RecordLit': {
      const fields = node.fields.map((f: any) => `${f.name}: ${formatOne(f.expr)}`).join(', ')
      return `{ ${fields} }`
    }
    case 'TupleLit':
      return `[${node.elements.map(formatOne).join(', ')}]`
    case 'Var':
      return node.name
    case 'Call':
      return `${formatOne(node.callee)}(${node.args.map(formatOne).join(', ')})`
    case 'Ctor':
      return `${node.name}(${node.args.map(formatOne).join(', ')})`
    case 'EffectCall':
      return `${node.effect}.${node.op}(${node.args.map(formatOne).join(', ')})`
    case 'ActorDecl': {
      const param = node.param ? `(${node.param.name}${node.param.type ? `: ${node.param.type}` : ''})` : ''
      const raises = node.effects && (node.effects as any as Set<string>).size > 0
        ? ` raises ${Array.from((node.effects as any as Set<string>).values()).join(', ')}`
        : ''
      return `actor ${node.name}${param}${raises} = ${formatOne(node.body)}`
    }
    case 'ActorDeclNew': {
      const state = node.state.map((s: any) => `  state ${s.name}${s.type ? `: ${s.type}` : ''} = ${formatOne(s.init)}`).join('\n')
      const handlers = node.handlers.map((h: any) => {
        const guard = h.guard ? ` if ${formatOne(h.guard)}` : ''
        const head = h.replyType ? `on ${formatOne(h.pattern)}${guard} reply ${h.replyType} ->` : `on ${formatOne(h.pattern)}${guard} ->`
        return `  ${head} ${formatOne(h.body)}`
      }).join('\n')
      return `actor ${node.name} {\n${state}${state && handlers ? '\n' : ''}${handlers}\n}`
    }
    case 'Spawn':
      return `spawn ${node.actorName}`
    case 'Send':
      return `send ${formatOne(node.actor)} ${formatOne(node.message)}`
    case 'Ask':
      return `ask ${formatOne(node.actor)} ${formatOne(node.message)}`
    case 'Unary': {
      const arg = formatOne(node.expr)
      return node.op === 'not' ? `not ${arg}` : `-${arg}`
    }
    case 'Binary': {
      const left = formatOne(node.left)
      const right = formatOne(node.right)
      return `${left} ${node.op} ${right}`
    }
    case 'If': {
      return `if ${formatOne(node.cond)} then ${formatOne(node.then)} else ${formatOne(node.else)}`
    }
    case 'Block':
      return `{ ${node.stmts.map(s => `${formatOne(s)};`).join(' ')} }`
    case 'PatternOr':
      return `${formatOne(node.left)} | ${formatOne(node.right)}`
    case 'Match': {
      const cases = node.cases.map((c: any) => {
        const guard = c.guard ? ` if ${formatOne(c.guard)}` : ''
        return `  ${formatOne(c.pattern)}${guard} -> ${formatOne(c.body)}`
      }).join('\n')
      return `match ${formatOne(node.scrutinee)} {\n${cases}\n}`
    }
    case 'SpecDecl': {
      const lines = (node as any).asserts.map((a: any) => `  assert(${formatOne(a.expr)}, ${JSON.stringify(a.message)})`).join('\n')
      return `spec ${JSON.stringify((node as any).name)} {\n${lines}\n}`
    }
    default:
      return `/* ${node.kind} */`
  }
}
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
      return `import "${node.path}"`
    case 'ModuleDecl':
      return `module ${node.name}`
    case 'Let': {
      const type = node.type ? `: ${node.type}` : ''
      return `let ${node.name}${type} = ${formatOne(node.expr)}`
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
    case 'LitNum':
      return String(node.value)
    case 'LitBool':
      return String(node.value)
    case 'Var':
      return node.name
    case 'Call':
      return `${formatOne(node.callee)}(${node.args.map(formatOne).join(', ')})`
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
        const head = h.replyType ? `on ${formatOne(h.pattern)} reply ${h.replyType} ->` : `on ${formatOne(h.pattern)} ->`
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
    case 'Binary': {
      const left = formatOne(node.left)
      const right = formatOne(node.right)
      return `${left} ${node.op} ${right}`
    }
    case 'Block':
      return `{ ${node.stmts.map(s => `${formatOne(s)};`).join(' ')} }`
    default:
      return `/* ${node.kind} */`
  }
}
import { parse } from '@lumen/parser'

export type Diagnostic = { message: string }

export function getDiagnostics(source: string): Diagnostic[] {
  try {
    const ast = parse(source)
    // For now, parser errors would throw in future; return empty diagnostics
    return []
  } catch (e) {
    return [{ message: String(e) }]
  }
}

export function getHover(source: string, symbol: string): any {
  const ast = parse(source)
  // Reuse simple hover approach from CLI: find enums/constructors and functions
  const lastSeg = symbol.includes('.') ? symbol.split('.').pop() as string : symbol
  const result: any = {}
  if (ast.kind !== 'Program') return result
  const enums: Array<{ name: string, variants: Array<{ name: string, params: string[] }> }> = []
  for (const d of ast.decls) if (d.kind === 'EnumDecl') enums.push({ name: d.name, variants: d.variants })
  for (const en of enums) {
    if (en.name === symbol || en.name === lastSeg) return { kind: 'enum', name: en.name }
    for (const v of en.variants) if (v.name === symbol || v.name === lastSeg) return { kind: 'constructor', name: v.name, enum: en.name, params: v.params }
  }
  return result
}
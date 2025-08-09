import { parse } from '@lumen/parser'

export type Diagnostic = { message: string }

export function getDiagnostics(source: string): Array<{ line: number, message: string }> {
  // existing lightweight checks
  const lines = source.split(/\n+/)
  const diags: Array<{ line: number, message: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (/^fn\s+\w+\s*\(.*\)\s*=\s*$/.test(ln)) diags.push({ line: i + 1, message: 'function missing body expression' })
  }
  return diags
}

export function getHover(source: string, symbol: string): any {
  // minimal stub
  if (source.includes(`enum ${symbol} `)) return { kind: 'enum', name: symbol }
  if (new RegExp(`fn\\s+${symbol}\\b`).test(source)) return { kind: 'function', name: symbol }
  return {}
}

export function getReferences(source: string, symbol: string): Array<{ line: number, column: number }> {
  const refs: Array<{ line: number, column: number }> = []
  const lines = source.split(/\n/)
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf(symbol)
    if (idx >= 0) refs.push({ line: i + 1, column: idx + 1 })
  }
  return refs
}

export function getCompletions(prefix: string): string[] {
  const keywords = ['let','mut','fn','actor','enum','if','then','else','match','case','while','for','break','continue','import','module']
  return keywords.filter(k => k.startsWith(prefix))
}
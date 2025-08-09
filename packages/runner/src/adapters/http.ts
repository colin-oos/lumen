let responseMap: Record<string, string> | null = null

function loadMap(): Record<string, string> {
  if (responseMap) return responseMap
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const envPath = process.env.LUMEN_HTTP_MOCK
  const candidates = [envPath, path.resolve(process.cwd(), 'http-mock.json')].filter(Boolean) as string[]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const json = JSON.parse(fs.readFileSync(p, 'utf8'))
        responseMap = json
        return responseMap as Record<string, string>
      }
    } catch {}
  }
  responseMap = {}
  return responseMap as Record<string, string>
}

export function httpGet(url: string): string {
  const map = loadMap()
  const key = `GET ${url}`
  if (key in map) return map[key]
  if (url.includes('example.com')) return 'MOCK:HTTP:example'
  return `MOCK:HTTP:${url}`
}

export function httpPost(url: string, body: string): string {
  const map = loadMap()
  const key = `POST ${url}`
  if (key in map) return map[key]
  return `MOCK:HTTP_POST:${url}:${body.length}`
}
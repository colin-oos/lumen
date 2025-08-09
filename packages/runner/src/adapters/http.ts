export function httpGet(url: string): string {
  // Deterministic mock for specific URLs; otherwise return a generic marker
  if (url.includes('example.com')) return 'MOCK:HTTP:example'
  return `MOCK:HTTP:${url}`
}

export function httpPost(url: string, body: string): string {
  return `MOCK:HTTP_POST:${url}:${body.length}`
}
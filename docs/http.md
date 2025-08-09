# HTTP Interop (stub)

Use the `http` effect for simple HTTP-like operations (mocked deterministically in the runner):

```
fn fetch(url) raises http = http.get(url)
```

Example service (actor): see `examples/http/service.lum`.

Mocks:
- By default returns a deterministic mock string (special-case example.com)
- You can provide a response map via environment or file:
  - Env: `LUMEN_HTTP_MOCK=/path/to/http-mock.json`
  - File in CWD: `./http-mock.json`
- Format:
```
{
  "GET https://example.com/ping": "PONG",
  "POST https://example.com/data": "OK"
}
```

Note: This is sufficient for demonstrations and deterministic testing.
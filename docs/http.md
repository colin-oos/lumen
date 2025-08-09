# HTTP Interop (stub)

Use the `http` effect for simple HTTP-like operations (mocked deterministically in the runner):

```
fn fetch(url) raises http = http.get(url)
```

Example service (actor): see `examples/http/service.lum`.

Note: The runner's HTTP adapter returns deterministic mock strings for now. This is sufficient for demonstrations and testing interop patterns.
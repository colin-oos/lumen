# Packaging & Cache

## lumen.pkg.json
Simple dependency mapping for short-name imports:
```
{
  "deps": {
    "util": "examples/libs/util.lum",
    "option_result": "examples/libs/option_result.lum"
  }
}
```

## Cache
- Merged programs are cached under `.lumen-cache/` keyed by a hash of file paths+contents and the policy file contents (if any)
- Disable with `--no-cache`
- Inspect with `lumen cache clear` (removes all entries)
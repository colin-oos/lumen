# Type Emission (experimental)

Generate TypeScript types from LUMEN sources:

```
node packages/cli/dist/index.js emit <file> --ts
```

What it emits (to stdout):
- Enums (ADTs) as discriminated unions:
  - `type Msg = { $: 'Ctor', values: [..] } | ...`
- Schemas as TS interfaces
- Stores + Queries:
  - For each `query`, emits an array type of the store schema or a `Pick<Schema, 'field' | ...>` when projection is used
- Functions:
  - For named functions, emits a signature alias `type nameFn = (p1, p2) => ret`
  - Parameter types prefer explicit annotations; otherwise a simple inference pass marks params used in binary ops as `number`

Example:
```
schema Item { id: Int name: Text }
store items : Item = "sqlite:./examples/data/items.sqlite3:items"
query names from items select name
```
Emits:
```
interface Item {
  id: number
  name: string
}

type names = Array<Pick<Item, 'name'>>
```
# nova-java (development repo)

Source for the **Java** extension for [Nova](https://nova.app). The extension is
written in TypeScript and bundled with Vite; the runnable extension lives in the
nested [`java.novaextension/`](./java.novaextension) bundle.

> User-facing documentation is in
> [`java.novaextension/README.md`](./java.novaextension/README.md).

## Layout

```
.
├── src/                     TypeScript source
├── java.novaextension/      the Nova extension bundle (this is what you submit)
│   ├── extension.json
│   ├── Scripts/main.dist.js  ← built by Vite (git-ignored)
│   ├── Syntaxes/  Queries/  Images/
│   └── …
├── test-workspace/          a small Maven project for manual testing
├── Dev Scripts/             tree-sitter grammar build helpers
├── vite.config.ts  tsconfig.json  package.json
└── node_modules/            dev dependencies (never part of the bundle)
```

Keeping `node_modules/` and the build tooling **outside** the `.novaextension`
bundle is deliberate: Nova packages the bundle folder verbatim when you submit,
so dev dependencies must not live inside it.

## Building

```bash
npm install       # dev dependencies (TypeScript 7, Vite)
npm run build     # bundle src/ → java.novaextension/Scripts/main.dist.js
npm run watch     # rebuild on change
npm run typecheck # type-check only
```

Run `npm run build` before submitting or activating the extension — the bundled
`main.dist.js` is generated and not committed.

## Testing

```bash
npm test          # integration tests (vitest)
npm run test:watch
```

The tests run the extension against an in-memory stand-in for the Nova API
(`src/testing/nova.ts`) — filesystem, workspace, editors, tree views, processes
and the language client — so activation, the commands, the JDT.LS lifecycle and
the sidebar views are exercised for real without an editor.

For a manual check, open `test-workspace/` as a project in Nova with the extension activated
(Extensions → *Activate Project as Extension* on `java.novaextension/`). See
[`test-workspace/README.md`](./test-workspace/README.md) for what to try.

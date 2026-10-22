#!/usr/bin/env node
/** Check declaration identity, including types, optionality and nested fields. */
import ts from 'typescript'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const canonical = path.join(root, 'packages/contracts/dist/index.d.ts')
const domain = path.join(root, 'packages/contracts/dist/domain.d.ts')
const facades = ['core/src/types.ts', 'api/src/types.ts', 'web/src/types/api.ts']
const files = [canonical, domain, ...facades.map((file) => path.join(root, 'packages', file))]
const program = ts.createProgram(files, {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2023,
})
const checker = program.getTypeChecker()
const failures = []

function exportsOf(file) {
  const source = program.getSourceFile(file)
  const symbol = source && checker.getSymbolAtLocation(source)
  if (!symbol) throw new Error(`Missing contracts: ${file}. Run pnpm build first.`)
  return new Map(checker.getExportsOfModule(symbol).map((entry) => [entry.name, entry]))
}

function resolve(symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

const shared = exportsOf(canonical)
for (const [index, file] of files.slice(2).entries()) {
  const actual = exportsOf(file)
  const expected = index === 0 ? exportsOf(domain) : shared
  for (const [name, symbol] of expected) {
    const exported = actual.get(name)
    if (!exported || resolve(exported) !== resolve(symbol)) {
      failures.push(`${path.relative(root, file)}: ${name} must re-export @turnflare/contracts`)
    }
  }
}

// Guard the package seam, including tests. Build internals are never public imports.
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      inspect(file)
      continue
    }
    if (!/\.tsx?$/.test(file)) continue
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
      const specifier = statement.moduleSpecifier
      if (!specifier || !ts.isStringLiteral(specifier)) continue
      if (/^@turnflare\/[^/]+\/(dist|src)\//.test(specifier.text)) {
        failures.push(`${path.relative(root, file)}: private import ${specifier.text}`)
      }
      const isWeb = file.startsWith(path.join(root, 'packages/web/src'))
      if (isWeb && /^(@turnflare\/|node:)/.test(specifier.text)) {
        const typeOnly = ts.isImportDeclaration(statement)
          ? statement.importClause?.isTypeOnly
          : statement.isTypeOnly
        if (!typeOnly)
          failures.push(`${path.relative(root, file)}: browser imports must be type-only`)
      }
    }
  }
}
for (const pkg of ['core', 'api', 'cli', 'web', 'desktop']) inspect(path.join(root, 'packages', pkg, 'src'))
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (file) => file,
      getNewLine: () => '\n',
    }),
  )
}
for (const failure of failures) console.error(`✗ ${failure}`)
if (failures.length || diagnostics.length) process.exitCode = 1
else
  console.log(
    `✓ ${shared.size} shared contracts have one declaration; browser and package imports checked.`,
  )

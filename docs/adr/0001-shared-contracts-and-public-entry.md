# ADR 0001: One shared contract declaration and a public API package entry

Date: 2026-10-22 · Status: Accepted

## Problem

Domain types were copied into core, API and web. A script compared property names
but could not detect incompatible property types, optionality or nested shapes.
The CLI imported the API's `dist` internals, so moving an implementation file
required coordinated changes in consumers.

## Decision

Put domain and HTTP declarations in the type-only `@turnflare/contracts` package.
Core exports the domain types through its existing facade. API and web re-export
shared contracts; HTTP validation output stays local to API. Web consumes only
types, so no Node runtime code enters the browser bundle.

Expose the Node interface of `@turnflare/api` through `src/index.ts` and package
`exports`. Its internal SQL, mapper and route files remain private. CLI uses the
public entry. No runtime dependency inversion or storage rewrite is introduced.

`pnpm contracts` checks that exported symbols resolve to the canonical declaration
and rejects private workspace imports and runtime workspace imports in the browser.
Each consumer's strict typecheck and behavior tests verify its actual use of the
contract. The old reason for copying declarations is superseded by these checks.

## Consequences

A contract edit has one source and compiler feedback across consumers. The
workspace build must emit contract declarations first; pnpm orders this through
workspace dependencies. Type-only dependencies must still be shipped/resolvable
when the library packages are published. Packaging the whole application remains
separate work.

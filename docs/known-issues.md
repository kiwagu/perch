# Known issues

Expected but surprising behaviour of this repository and its toolchain. Remove an
entry as soon as the cause is gone, so the file stays trustworthy.

## Two TypeScript versions in the lockfile

**What you see:** `bun.lock` resolves `typescript` 7.x for the workspaces and 6.0.x
for `@workspace/eslint-config`.

**Why:** type checking uses TypeScript 7 (`tsc`). TypeScript 7 does not ship the
classic JavaScript compiler API, and typescript-eslint needs that API for its
type-aware rules (`no-floating-promises`, `no-misused-promises`, `await-thenable`
and the local `must-use-result` rule). The lint package therefore depends on
TypeScript 6.0.x through the `lint` catalog, and typescript-eslint resolves that
version as its peer. The two versions read the same `tsconfig` files.

**When it goes away:** when typescript-eslint supports the TypeScript 7 API.

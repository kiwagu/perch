/// <reference types="vite/client" />

/**
 * Where the browser engine's WASM module is served from, for a page that fetches it ahead of
 * the engine: the engine's worker loads this same file when it first connects, so a page that
 * started the download early finds it in the browser's cache. Only for bundles built by Vite,
 * which emits the module once, under one name, for the worker and for this address.
 */
export { default as wasmEngineModule } from '@surrealdb/wasm-native/module?url'

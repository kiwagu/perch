/** Whether the build installs the page helper `window.__perch.ui` (set by vite.config.ts). */
declare const __PERCH_UI_HOOKS__: boolean

/** The build this bundle is: the root package's version and the commit it was built from (vite.config.ts). */
declare module 'virtual:perch-build' {
  const build: { readonly version: string; readonly commit: string | null }

  export default build
}

/**
 * The code of an identity's space, and Loro's WASM engine with it. It loads when a space first
 * opens, or ahead of a guest's sign-in once the page is up, never with the start: a guest's
 * sign-in page loads no engine (measured on a slow 4G network, Loro's engine was 6.7 s of the
 * 8.6 s a guest waited for the sign-in form). The browser loads it once, however often it is asked.
 */
export const spaceCode = () => import('./identity-space')

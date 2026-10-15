/**
 * mode.ts — which host this build talks to, fixed at build time.
 *
 * Default (unset): the Node host over HTTP at /api (the local app). VITE_SILICUS_MODE=browser: the same API
 * handled in this page, with the record kept in this browser (the online app). Components read this only to
 * tell the truth about WHERE things happen ("this browser keeps the record", "the local app"); no policy
 * depends on it.
 */
export const BROWSER_MODE: boolean = import.meta.env.VITE_SILICUS_MODE === "browser";

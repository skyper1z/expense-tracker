/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** e.g. https://abcd1234.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** The project's anon (or publishable) key. Safe to ship to browsers; RLS protects the data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "false" lets production builds run in a normal browser tab (default: installing is required). */
  readonly VITE_REQUIRE_INSTALL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

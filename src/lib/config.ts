/**
 * SpendNote only opens as an installed app in production. In a normal browser tab it shows the
 * "Install SpendNote to continue" screen instead. `npm run dev` is never blocked, and a build
 * with VITE_REQUIRE_INSTALL=false turns the requirement off (used for automated tests).
 */
export const REQUIRE_INSTALL = import.meta.env.PROD && import.meta.env.VITE_REQUIRE_INSTALL !== 'false';

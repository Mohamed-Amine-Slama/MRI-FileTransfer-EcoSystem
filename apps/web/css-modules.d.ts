/**
 * Ambient declaration for plain CSS side-effect imports (`import './globals.css'`).
 *
 * WHY THIS FILE EXISTS. Next ships `next/types/global.d.ts`, which declares
 * `*.module.css` and `*.module.scss` but NOT plain `*.css`. Until now the
 * declaration was arriving by accident from `vite/client.d.ts` — Vite is a
 * test-tooling dependency, and pnpm happened to hoist it somewhere the
 * compiler looked. A dependency install reshuffled the store, the accident
 * stopped working, and `app/layout.tsx` failed to typecheck on a line nobody
 * had touched in months.
 *
 * Declaring it here makes the app own the assumption instead of inheriting it
 * from an unrelated package's hoisting.
 */
declare module '*.css';

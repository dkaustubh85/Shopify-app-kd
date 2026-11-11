# React Router migration

Approved by the owner before public release. Runtime: React Router 7.18.5, Shopify React Router SDK 4.0.2, Prisma storage 11.0.3. Version 7 matches Shopify's current peer dependency; React Router 8 was not forced into an incompatible peer range.

Removed Remix framework dependencies and obsolete auth flag. Converted route imports, server renderer, data responses, route configuration and build/start commands. Added child-route Shopify boundary headers for single-fetch responses. Polaris React is retained inside its own provider with React Router links; Shopify's provider supplies App Bridge. Vite prebundles and deduplicates React to avoid hydration mismatches.

Replaced removed Remix multipart helpers with Node's bounded native form parser: actual request bytes <=12 MB, file <=10 MB, <=32 fields counted before part allocation, text <=64 KB and field names <=128 characters. Existing upload-limit tests pass. Live test decoding uses the pinned framework's data decoder.

The old dependency tree remains in ignored node_modules.remix-backup; its old lockfile is in ignored .cache/migration. Both are excluded from Docker builds. Git's existing staging was preserved.

Validation: 68 tests, TypeScript, production build, seven authenticated app routes, sample/export downloads, live Shopify upload-preview-apply-undo, and Chrome guide/upload/history/template/settings/export checks pass. Browser tests simulate the Shopify host scripts; real embedded-shell and incognito review remain required.

References: https://github.com/Shopify/shopify-app-template-react-router/wiki/Upgrading-from-Remix ; https://reactrouter.com/7.18.5/upgrading/remix

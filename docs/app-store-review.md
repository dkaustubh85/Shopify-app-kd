# Local App Store review

Likely passing: 28. Likely failing: 0 among the locally evaluated checklist after removing the template's manual shop-domain forms. Needs review: 3. Groups skipped: 10.

This evaluates Shopify's selected locally checkable criteria, fetched using the latest Shopify CLI into app-store-requirements.md. It does not replace Shopify review or mean the app is ready to submit.

## Needs review

- 1.1.1 Session-token authentication: the SDK and authenticated download helper are implemented. Local Chrome tests simulate App Bridge. Confirm real embedded and incognito sessions in Shopify.
- 2.3.3 Post-install redirect: the official auth handler and root shop redirect exist. Confirm a fresh production installation lands inside the app.
- 3.1.1 TLS: development uses a secure tunnel; the Render production origin and certificate have not been deployed or verified.

## Passing evidence

Remaining general-policy checks find inventory-only functionality: no marketplace, checkout, payment, refund, theme-installation, financing, third-party POS, agency marketplace, or fabricated sales feature. Billing is absent and launch is explicitly free. All business API operations use Admin GraphQL. The SDK supplies App Bridge and token exchange. Authenticated routes run authentication first; uninstall removes sessions and reinstall upserts records. Requested scopes are limited to product, inventory and location access. No optional restricted customer/order/payment/pixel scopes are configured. No admin extensions or Max modal usage exist.

## Additional release blockers outside this limited checklist

- Mandatory privacy topics and signed receipt/shop-deletion handlers are now implemented and tested. Customer requests enter an awaiting_review queue; fulfilment ownership and alerting are not configured. Retained source sheets may contain merchant-supplied personal information, so customer requests cannot be dismissed merely because the app does not query the Customers API. Define retention, request handling and deletion, including backups.
- Support contact dkaustubh85@gmail.com is configured. Developer/business identity, published privacy policy and final listing metadata still need confirmation.
- React Router migration cleared all high/critical/moderate runtime findings. Three low entries remain in the Polaris token/deepmerge chain; development-tool advisories also remain.
- Render, Docker runtime, live PostgreSQL, backups and production worker operation are unverified.
- Real embedded-shell, keyboard/accessibility and production installation tests remain outstanding.
- Free listing chosen; adding charges later requires Shopify App Pricing or Billing API, not external billing.

## Skipped groups

- 5.1 Online store: no theme extension.
- 5.2 Payment: no payment extension or gateway scopes.
- 5.3 Payment facilitator: opt-in not requested.
- 5.4 Purchase option: no subscription or payment-mandate scopes.
- 5.5 Product sourcing: opt-in not requested.
- 5.6 Checkout customization: no checkout extension.
- 5.7 Sales channel: no channel extension.
- 5.8 Post purchase: no post-purchase extension.
- 5.9 Mobile app builders: opt-in not requested.
- 5.10 Donation: opt-in not requested.

Resources: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements ; https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices ; https://shopify.dev/docs/apps/launch/billing ; https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review

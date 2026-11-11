import { forwardRef, type ReactNode } from "react";
import { Link } from "react-router";
import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
const RouterLink = forwardRef<HTMLAnchorElement, any>(function RouterLink(
  { url, external, children, ...props },
  ref,
) {
  return external ? (
    <a
      {...props}
      ref={ref}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ) : (
    <Link {...props} ref={ref} to={url}>
      {children}
    </Link>
  );
});
export function RouterPolarisProvider({ children }: { children: ReactNode }) {
  return (
    <AppProvider i18n={en} linkComponent={RouterLink}>
      {children}
    </AppProvider>
  );
}

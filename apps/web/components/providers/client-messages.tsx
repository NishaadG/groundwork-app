import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

/** Base namespaces every client tree needs. */
const BASE = ["common", "hero", "working"];

/**
 * Gives a subtree's client components the message namespaces they read, and no more,
 * so the marketing pages don't ship app copy (and vice versa).
 */
export async function ClientMessages({
  namespaces,
  children,
}: {
  namespaces: string[];
  children: React.ReactNode;
}) {
  const messages = await getMessages();
  const picked = Object.fromEntries(
    [...BASE, ...namespaces].filter((ns) => ns in messages).map((ns) => [ns, messages[ns]]),
  );
  return <NextIntlClientProvider messages={picked}>{children}</NextIntlClientProvider>;
}

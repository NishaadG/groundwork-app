import type { MetadataRoute } from "next";

/** Previews (NEXT_PUBLIC_NOINDEX=1) ask every crawler to stay out; otherwise the app stays out. */
export default function robots(): MetadataRoute.Robots {
  if (process.env.NEXT_PUBLIC_NOINDEX === "1") return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/app/", "/onboarding"] } };
}

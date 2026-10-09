import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // E2E builds (mock auth) go to their own folder so they never mix with a real build
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  // Put <meta> tags in the initial <head> for every client, not only bots (SEO, link previews)
  htmlLimitedBots: /.*/,
  // Server bundles never need the infrastructure tooling that sits in the same monorepo.
  // Without this, tracing on Amplify walks the CDK packages and the backend build output
  // (.amplify/artifacts) and runs the build container out of memory.
  outputFileTracingExcludes: {
    "*": [
      "../../.amplify/**",
      "../../amplify/**",
      "../../infra/**",
      "../../services/**",
      "../../data/**",
      "../../node_modules/aws-cdk-lib/**",
      "../../node_modules/@aws-cdk/**",
      "../../node_modules/@aws-amplify/backend*/**",
      "../../node_modules/esbuild/**",
      "../../node_modules/@esbuild/**",
      "../../node_modules/typescript/**",
      "../../node_modules/@playwright/**",
      "../../node_modules/playwright*/**",
    ],
  },
  experimental: {
    // Tree-shake barrel imports so a page only ships the primitives it uses
    optimizePackageImports: ["radix-ui", "motion", "lucide-react"],
  },
};

export default withNextIntl(nextConfig);

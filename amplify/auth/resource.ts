import { defineAuth, secret } from "@aws-amplify/backend";

/**
 * Cognito for Groundwork.
 * - Email + password with a 6-digit code by email.
 * - Google sign-in when GOOGLE_AUTH=enabled is set in the Amplify build environment
 *   and the secrets GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET exist (Amplify console → Secrets).
 * - Redirect origins come from AUTH_ORIGINS (comma-separated), e.g.
 *   "https://main.d123.amplifyapp.com,http://localhost:3000".
 */
const origins = (process.env.AUTH_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

const googleEnabled = process.env.GOOGLE_AUTH === "enabled";

export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: "CODE",
      verificationEmailSubject: "Your Groundwork code",
      verificationEmailBody: (createCode) =>
        `Your Groundwork verification code is ${createCode()}. It expires in 24 hours.`,
    },
    ...(googleEnabled && {
      externalProviders: {
        google: {
          clientId: secret("GOOGLE_CLIENT_ID"),
          clientSecret: secret("GOOGLE_CLIENT_SECRET"),
          scopes: ["openid", "email", "profile"],
          attributeMapping: { email: "email", fullname: "name" },
        },
        callbackUrls: origins.map((o) => `${o}/auth/callback`),
        logoutUrls: origins.map((o) => `${o}/`),
      },
    }),
  },
  userAttributes: {
    email: { required: true, mutable: true },
  },
  accountRecovery: "EMAIL_ONLY",
});

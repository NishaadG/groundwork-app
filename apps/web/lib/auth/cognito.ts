"use client";

import { Amplify } from "aws-amplify";
import {
  autoSignIn,
  confirmResetPassword,
  confirmSignUp,
  fetchAuthSession,
  getCurrentUser,
  resendSignUpCode,
  resetPassword,
  signIn,
  signInWithRedirect,
  signOut,
  signUp,
} from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { defaultStorage, Hub, sessionStorage } from "aws-amplify/utils";

import { type AuthClient, type AuthErrorCode, AuthFailure } from "./types";

const POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "";
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";
const DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? "";
const GOOGLE = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "enabled" && Boolean(DOMAIN);
const REMEMBER_KEY = "gw.remember";

let configured = false;

function configure() {
  if (configured || !POOL_ID || !CLIENT_ID || typeof window === "undefined") return;
  const origin = window.location.origin;
  Amplify.configure(
    {
      Auth: {
        Cognito: {
          userPoolId: POOL_ID,
          userPoolClientId: CLIENT_ID,
          loginWith: {
            email: true,
            ...(GOOGLE && {
              oauth: {
                domain: DOMAIN,
                scopes: ["openid", "email", "profile"],
                redirectSignIn: [`${origin}/auth/callback`],
                redirectSignOut: [`${origin}/`],
                responseType: "code" as const,
              },
            }),
          },
        },
      },
    },
    { ssr: false },
  );
  // "Remember me" off keeps tokens for this browser session only.
  const remember = window.localStorage.getItem(REMEMBER_KEY) !== "0";
  cognitoUserPoolsTokenProvider.setKeyValueStorage(remember ? defaultStorage : sessionStorage);
  configured = true;
}

const CODE_BY_NAME: Record<string, AuthErrorCode> = {
  NotAuthorizedException: "wrong_credentials",
  UserNotFoundException: "wrong_credentials",
  UsernameExistsException: "email_taken",
  CodeMismatchException: "code_mismatch",
  ExpiredCodeException: "code_expired",
  InvalidPasswordException: "weak_password",
  InvalidParameterException: "weak_password",
  LimitExceededException: "too_many_attempts",
  TooManyRequestsException: "too_many_attempts",
  TooManyFailedAttemptsException: "too_many_attempts",
  UserNotConfirmedException: "not_confirmed",
  NetworkError: "network",
};

function fail(err: unknown): never {
  const name = err instanceof Error ? err.name : "";
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new AuthFailure("network");
  throw new AuthFailure(CODE_BY_NAME[name] ?? "unknown", err instanceof Error ? err.message : undefined);
}

function ensure() {
  configure();
  if (!configured) throw new AuthFailure("not_configured");
}

export function createCognitoClient(): AuthClient {
  configure();
  return {
    configured: Boolean(POOL_ID && CLIENT_ID),
    googleEnabled: GOOGLE,

    async currentUser() {
      if (!configured) return null;
      try {
        const u = await getCurrentUser();
        const session = await fetchAuthSession();
        const email = session.tokens?.idToken?.payload.email;
        return { sub: u.userId, email: typeof email === "string" ? email : null };
      } catch {
        return null;
      }
    },

    async idToken() {
      if (!configured) return null;
      try {
        // Refreshes silently when the ID token is near expiry.
        const session = await fetchAuthSession();
        return session.tokens?.idToken?.toString() ?? null;
      } catch {
        return null;
      }
    },

    async signIn(email, password, remember) {
      ensure();
      window.localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
      cognitoUserPoolsTokenProvider.setKeyValueStorage(remember ? defaultStorage : sessionStorage);
      try {
        const res = await signIn({ username: email, password });
        if (res.isSignedIn) return { status: "signed_in" };
        if (res.nextStep.signInStep === "CONFIRM_SIGN_UP") return { status: "confirm_sign_up" };
        throw new AuthFailure("unknown", res.nextStep.signInStep);
      } catch (err) {
        if (err instanceof AuthFailure) throw err;
        fail(err);
      }
    },

    async signUp(email, password) {
      ensure();
      try {
        await signUp({
          username: email,
          password,
          options: { userAttributes: { email }, autoSignIn: true },
        });
      } catch (err) {
        fail(err);
      }
    },

    async confirmSignUp(email, code, password) {
      ensure();
      try {
        const res = await confirmSignUp({ username: email, confirmationCode: code });
        if (res.nextStep.signUpStep === "COMPLETE_AUTO_SIGN_IN") {
          await autoSignIn();
        } else if (password) {
          await signIn({ username: email, password });
        }
      } catch (err) {
        fail(err);
      }
    },

    async resendCode(email) {
      ensure();
      try {
        await resendSignUpCode({ username: email });
      } catch (err) {
        fail(err);
      }
    },

    async signInWithGoogle() {
      ensure();
      if (!GOOGLE) throw new AuthFailure("not_configured");
      try {
        await signInWithRedirect({ provider: "Google" });
      } catch (err) {
        fail(err);
      }
    },

    async resetPassword(email) {
      ensure();
      try {
        await resetPassword({ username: email });
      } catch (err) {
        fail(err);
      }
    },

    async confirmResetPassword(email, code, newPassword) {
      ensure();
      try {
        await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
      } catch (err) {
        fail(err);
      }
    },

    async signOut() {
      if (!configured) return;
      await signOut();
    },

    onChange(listener) {
      return Hub.listen("auth", ({ payload }) => {
        if (["signedIn", "signedOut", "tokenRefresh_failure", "signInWithRedirect"].includes(payload.event)) {
          listener();
        }
      });
    },
  };
}

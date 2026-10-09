/** The auth surface the UI depends on. Cognito (aws-amplify) in production, a mock in e2e. */

export interface AuthUser {
  sub: string;
  email: string | null;
}

/** Stable codes the UI maps to friendly copy (never raw Cognito messages). */
export type AuthErrorCode =
  | "wrong_credentials"
  | "email_taken"
  | "code_mismatch"
  | "code_expired"
  | "weak_password"
  | "too_many_attempts"
  | "not_confirmed"
  | "network"
  | "not_configured"
  | "unknown";

export class AuthFailure extends Error {
  constructor(
    public code: AuthErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthFailure";
  }
}

export type SignInResult = { status: "signed_in" } | { status: "confirm_sign_up" };

export interface AuthClient {
  configured: boolean;
  googleEnabled: boolean;
  currentUser(): Promise<AuthUser | null>;
  idToken(): Promise<string | null>;
  signIn(email: string, password: string, remember: boolean): Promise<SignInResult>;
  signUp(email: string, password: string): Promise<void>;
  confirmSignUp(email: string, code: string, password?: string): Promise<void>;
  resendCode(email: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  confirmResetPassword(email: string, code: string, newPassword: string): Promise<void>;
  signOut(): Promise<void>;
  /** Subscribe to sign-in/out events; returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
}

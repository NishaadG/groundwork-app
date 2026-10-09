"use client";

/**
 * In-browser auth used only by end-to-end tests (NEXT_PUBLIC_AUTH_MODE=mock).
 * Accounts live in localStorage; the verification and reset code is always 123456.
 * The real flows are Cognito (cognito.ts); the backend's JWT checks are covered by pytest.
 */
import { type AuthClient, AuthFailure, type AuthUser } from "./types";

const KEY = "gw.mock.auth";
const CODE = "123456";

interface Account {
  sub: string;
  email: string;
  password: string;
  confirmed: boolean;
}

interface State {
  accounts: Account[];
  session: string | null;
}

function load(): State {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "") as State;
  } catch {
    return { accounts: [], session: null };
  }
}

const listeners = new Set<() => void>();

function save(state: State) {
  window.localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

function find(state: State, email: string) {
  return state.accounts.find((a) => a.email === email.toLowerCase());
}

export function createMockClient(): AuthClient {
  return {
    configured: true,
    googleEnabled: false,

    async currentUser(): Promise<AuthUser | null> {
      const s = load();
      const a = s.accounts.find((x) => x.sub === s.session);
      return a ? { sub: a.sub, email: a.email } : null;
    },

    async idToken() {
      const s = load();
      return s.session ? `mock.${s.session}` : null;
    },

    async signIn(email, password) {
      const s = load();
      const a = find(s, email);
      if (!a || a.password !== password) throw new AuthFailure("wrong_credentials");
      if (!a.confirmed) return { status: "confirm_sign_up" };
      save({ ...s, session: a.sub });
      return { status: "signed_in" };
    },

    async signUp(email, password) {
      const s = load();
      if (find(s, email)) throw new AuthFailure("email_taken");
      if (password.length < 8) throw new AuthFailure("weak_password");
      const sub = `mock-${Math.random().toString(36).slice(2, 10)}`;
      save({ ...s, accounts: [...s.accounts, { sub, email: email.toLowerCase(), password, confirmed: false }] });
    },

    async confirmSignUp(email, code) {
      const s = load();
      const a = find(s, email);
      if (!a) throw new AuthFailure("wrong_credentials");
      if (code !== CODE) throw new AuthFailure("code_mismatch");
      a.confirmed = true;
      save({ ...s, session: a.sub });
    },

    async resendCode() {},

    async signInWithGoogle() {
      throw new AuthFailure("not_configured");
    },

    async resetPassword(email) {
      if (!find(load(), email)) return; // don't reveal whether an account exists
    },

    async confirmResetPassword(email, code, newPassword) {
      const s = load();
      const a = find(s, email);
      if (code !== CODE || !a) throw new AuthFailure("code_mismatch");
      if (newPassword.length < 8) throw new AuthFailure("weak_password");
      a.password = newPassword;
      save(s);
    },

    async signOut() {
      save({ ...load(), session: null });
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

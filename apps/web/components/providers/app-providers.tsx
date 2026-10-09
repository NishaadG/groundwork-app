"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { Toaster, TooltipProvider } from "@/components/ui/primitives";
import { ApiFailure } from "@/lib/api";
import { authClient, type AuthUser } from "@/lib/auth";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "signed_out"; user: null }
  /** Leaving on purpose (sign out, account deleted): guards must not redirect to /login. */
  | { status: "signing_out"; user: null }
  | { status: "signed_in"; user: AuthUser };

interface AuthContextValue {
  state: AuthState;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AppProviders>");
  return ctx;
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });
  const leaving = useRef(false);

  const refresh = useCallback(async () => {
    const user = await authClient().currentUser();
    if (leaving.current && !user) return;
    leaving.current = false;
    setState(user ? { status: "signed_in", user } : { status: "signed_out", user: null });
  }, []);

  useEffect(() => {
    void refresh();
    return authClient().onChange(() => void refresh());
  }, [refresh]);

  /** Signs out and stays in "signing_out" so the caller can navigate away cleanly. */
  const signOut = useCallback(async () => {
    leaving.current = true;
    setState({ status: "signing_out", user: null });
    await authClient().signOut();
  }, []);

  const value = useMemo(() => ({ state, refresh, signOut }), [state, refresh, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (count, err) =>
              count < 2 && !(err instanceof ApiFailure && err.status >= 400 && err.status < 500),
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

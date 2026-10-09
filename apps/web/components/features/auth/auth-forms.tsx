"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useAuth, useOptionalAuth } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { getProfile } from "@/lib/api";
import { authClient, AuthFailure, type AuthErrorCode } from "@/lib/auth";

const emailSchema = z.string().trim().toLowerCase().email();
const passwordSchema = z.string().min(8);
const codeSchema = z.string().trim().regex(/^\d{6}$/);

/** Only same-site paths are allowed as a post-login destination. */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
}

/** After sign-in: unfinished onboarding goes to /onboarding, otherwise to `next` or /app. */
export async function destinationAfterSignIn(next: string | null): Promise<string> {
  try {
    const profile = await getProfile();
    if (!profile.onboarding_done) return "/onboarding";
  } catch {
    // If the profile can't be read yet, the app shell shows its own retry state.
  }
  return safeNext(next) ?? "/app";
}

function ErrorBox({ code }: { code: AuthErrorCode | null }) {
  const t = useTranslations("auth.errors");
  if (!code) return null;
  return (
    <p role="alert" className="rounded-input border border-alert/40 bg-alert/5 px-3 py-2.5 text-sm text-alert">
      {t(code)}
    </p>
  );
}

function useAuthError() {
  const [code, setCode] = useState<AuthErrorCode | null>(null);
  const capture = (err: unknown) => setCode(err instanceof AuthFailure ? err.code : "unknown");
  return { code, setCode, capture };
}

function NotConfigured() {
  const t = useTranslations("auth");
  return (
    <p role="status" className="rounded-input border border-concrete bg-parapet px-3 py-2.5 text-sm text-cell-muted">
      {t("notConfigured")}
    </p>
  );
}

const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "";
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "";

/** Signs in to the public sample household. Shown only when its sign-in is configured;
 * the account holds no private data. */
export function TryDemoButton({ className, label }: { className?: string; label: string }) {
  const router = useRouter();
  const auth = useOptionalAuth();
  const [busy, setBusy] = useState(false);
  if (!DEMO_EMAIL || !DEMO_PASSWORD) return null;
  const go = async () => {
    setBusy(true);
    try {
      await authClient().signIn(DEMO_EMAIL, DEMO_PASSWORD, false);
      await auth?.refresh();
      router.replace(await destinationAfterSignIn(null));
    } catch {
      // The demo account is unavailable: fall back to the normal sign-in page.
      router.push("/login");
    }
  };
  return (
    <div className={className}>
      <Button type="button" variant="secondary" size="lg" disabled={busy} onClick={go}>
        {label}
      </Button>
    </div>
  );
}

function GoogleButton() {
  const t = useTranslations("auth");
  const { code, capture } = useAuthError();
  if (!authClient().googleEnabled) return null;
  return (
    <>
      <ErrorBox code={code} />
      <div className="my-6 flex items-center gap-3 type-small text-cell-muted" aria-hidden>
        <span className="h-px flex-1 bg-concrete" />
        {t("or")}
        <span className="h-px flex-1 bg-concrete" />
      </div>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => authClient().signInWithGoogle().catch(capture)}
      >
        <svg viewBox="0 0 24 24" aria-hidden className="size-4">
          <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2-1.9 3.2-4.7 3.2-8.2z" />
          <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.6H2.1v2.9A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.8 14c-.2-.7-.4-1.4-.4-2s.1-1.4.4-2V7.1H2.1A11 11 0 0 0 1 12c0 1.8.4 3.5 1.1 4.9L5.8 14z" />
          <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1L5.8 10c.9-2.7 3.3-4.6 6.2-4.6z" />
        </svg>
        {t("google")}
      </Button>
    </>
  );
}

/* ---------- Sign in ---------- */

export function LoginForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();
  const { code, capture, setCode } = useAuthError();
  const schema = z.object({
    email: emailSchema,
    password: z.string().min(1),
    remember: z.boolean(),
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: params.get("email") ?? "", password: "", remember: true },
  });
  const configured = authClient().configured;

  const onSubmit = form.handleSubmit(async (values) => {
    setCode(null);
    try {
      const res = await authClient().signIn(values.email, values.password, values.remember);
      if (res.status === "confirm_sign_up") {
        await authClient().resendCode(values.email).catch(() => undefined);
        router.push(`/signup?step=verify&email=${encodeURIComponent(values.email)}`);
        return;
      }
      await refresh();
      router.replace(await destinationAfterSignIn(params.get("next")));
    } catch (err) {
      capture(err);
    }
  });

  return (
    <div>
      <h1 className="type-display text-4xl">{t("login.title")}</h1>
      <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-5">
        {!configured && <NotConfigured />}
        <ErrorBox code={code} />
        <Field id="email" label={t("email")} error={form.formState.errors.email && tv("email")}>
          <Input type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
        </Field>
        <Field id="password" label={t("password")} error={form.formState.errors.password && tv("password")}>
          <Input type="password" autoComplete="current-password" {...form.register("password")} />
        </Field>
        <div className="flex items-center justify-between gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--cell)]" {...form.register("remember")} />
            {t("remember")}
          </label>
          <Link href="/reset" className="text-sm underline underline-offset-4 hover:no-underline">
            {t("login.forgot")}
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting || !configured}>
          {t("login.submit")}
        </Button>
      </form>
      <GoogleButton />
      <TryDemoButton className="mt-6 grid [&>button]:w-full" label={t("tryDemo")} />
      <p className="mt-8 text-sm text-cell-muted">
        {t("login.noAccount")}{" "}
        <Link href="/signup" className="text-cell underline underline-offset-4 hover:no-underline">
          {t("login.create")}
        </Link>
      </p>
    </div>
  );
}

/* ---------- Sign up + verify ---------- */

function VerifyForm({ email, password }: { email: string; password?: string }) {
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const router = useRouter();
  const { refresh } = useAuth();
  const { code, capture, setCode } = useAuthError();
  const schema = z.object({ code: codeSchema });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { code: "" } });

  const onSubmit = form.handleSubmit(async ({ code: c }) => {
    setCode(null);
    try {
      await authClient().confirmSignUp(email, c, password);
      await refresh();
      const user = await authClient().currentUser();
      router.replace(user ? "/onboarding" : `/login?email=${encodeURIComponent(email)}`);
    } catch (err) {
      capture(err);
    }
  });

  return (
    <div>
      <h1 className="type-display text-4xl">{t("signup.verifyTitle")}</h1>
      <p className="mt-3 text-cell-muted">{t("signup.verifyIntro")}</p>
      <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-5">
        <ErrorBox code={code} />
        <Field
          id="code"
          label={t("code")}
          hint={t("codeHint", { email })}
          error={form.formState.errors.code && tv("code")}
        >
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="type-number text-xl tracking-[0.3em]"
            {...form.register("code")}
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
          {t("signup.verifySubmit")}
        </Button>
        <Button
          type="button"
          variant="link"
          className="justify-self-start"
          onClick={() =>
            authClient()
              .resendCode(email)
              .then(() => toast(t("signup.resent")))
              .catch(capture)
          }
        >
          {t("signup.resend")}
        </Button>
      </form>
    </div>
  );
}

export function SignupForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const params = useSearchParams();
  const [pending, setPending] = useState<{ email: string; password?: string } | null>(
    params.get("step") === "verify" && params.get("email") ? { email: params.get("email")! } : null,
  );
  const { code, capture, setCode } = useAuthError();
  const schema = z.object({ email: emailSchema, password: passwordSchema });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const configured = authClient().configured;

  const onSubmit = form.handleSubmit(async (values) => {
    setCode(null);
    try {
      await authClient().signUp(values.email, values.password);
      setPending(values);
    } catch (err) {
      capture(err);
    }
  });

  if (pending) return <VerifyForm email={pending.email} password={pending.password} />;

  return (
    <div>
      <h1 className="type-display text-4xl">{t("signup.title")}</h1>
      <p className="mt-3 text-cell-muted">{t("signup.intro")}</p>
      <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-5">
        {!configured && <NotConfigured />}
        <ErrorBox code={code} />
        <Field id="email" label={t("email")} error={form.formState.errors.email && tv("email")}>
          <Input type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
        </Field>
        <Field
          id="password"
          label={t("password")}
          hint={t("passwordHint")}
          error={form.formState.errors.password && tv("password")}
        >
          <Input type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting || !configured}>
          {t("signup.submit")}
        </Button>
        <p className="type-small text-cell-muted">
          {t.rich("signup.terms", {
            terms: (c) => (
              <Link href="/terms" className="underline underline-offset-2">
                {c}
              </Link>
            ),
            privacy: (c) => (
              <Link href="/privacy" className="underline underline-offset-2">
                {c}
              </Link>
            ),
          })}
        </p>
      </form>
      <GoogleButton />
      <p className="mt-8 text-sm text-cell-muted">
        {t("signup.haveAccount")}{" "}
        <Link href="/login" className="text-cell underline underline-offset-4 hover:no-underline">
          {t("signup.signIn")}
        </Link>
      </p>
    </div>
  );
}

/* ---------- Reset password ---------- */

export function ResetForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const { code, capture, setCode } = useAuthError();

  const requestSchema = z.object({ email: emailSchema });
  const request = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: "" },
  });
  const confirmSchema = z.object({ code: codeSchema, password: passwordSchema });
  const confirm = useForm<z.infer<typeof confirmSchema>>({
    resolver: zodResolver(confirmSchema),
    defaultValues: { code: "", password: "" },
  });

  const onRequest = request.handleSubmit(async (v) => {
    setCode(null);
    try {
      await authClient().resetPassword(v.email);
      setEmail(v.email);
    } catch (err) {
      capture(err);
    }
  });

  const onConfirm = confirm.handleSubmit(async (v) => {
    setCode(null);
    try {
      await authClient().confirmResetPassword(email!, v.code, v.password);
      toast(t("reset.done"));
      router.replace(`/login?email=${encodeURIComponent(email!)}`);
    } catch (err) {
      capture(err);
    }
  });

  return (
    <div>
      <h1 className="type-display text-4xl">{email ? t("reset.codeTitle") : t("reset.title")}</h1>
      {!email ? (
        <form onSubmit={onRequest} noValidate className="mt-8 grid gap-5">
          <p className="text-cell-muted">{t("reset.intro")}</p>
          <ErrorBox code={code} />
          <Field id="email" label={t("email")} error={request.formState.errors.email && tv("email")}>
            <Input type="email" autoComplete="email" inputMode="email" {...request.register("email")} />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={request.formState.isSubmitting}>
            {t("reset.submit")}
          </Button>
        </form>
      ) : (
        <form onSubmit={onConfirm} noValidate className="mt-8 grid gap-5">
          <ErrorBox code={code} />
          <Field id="code" label={t("code")} hint={t("codeHint", { email })} error={confirm.formState.errors.code && tv("code")}>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="type-number text-xl tracking-[0.3em]" {...confirm.register("code")} />
          </Field>
          <Field id="password" label={t("newPassword")} hint={t("passwordHint")} error={confirm.formState.errors.password && tv("password")}>
            <Input type="password" autoComplete="new-password" {...confirm.register("password")} />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={confirm.formState.isSubmitting}>
            {t("reset.codeSubmit")}
          </Button>
        </form>
      )}
      <p className="mt-8 text-sm">
        <Link href="/login" className="underline underline-offset-4 hover:no-underline">
          {t("reset.back")}
        </Link>
      </p>
    </div>
  );
}

/* ---------- OAuth callback ---------- */

export function OAuthCallback() {
  const t = useTranslations("auth.callback");
  const router = useRouter();
  const { state, refresh } = useAuth();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error")) setFailed(true);
    const timer = window.setTimeout(() => setFailed(true), 15_000);
    void refresh();
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (state.status === "signed_in") {
      void destinationAfterSignIn(null).then((to) => router.replace(to));
    }
  }, [state.status, router]);

  return (
    <div role="status">
      <h1 className="type-display text-3xl">{failed ? t("failed") : t("title")}</h1>
      {failed && (
        <Button asChild className="mt-8">
          <Link href="/login">{t("retry")}</Link>
        </Button>
      )}
    </div>
  );
}

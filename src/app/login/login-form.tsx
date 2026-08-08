"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { OtpInput } from "@/components/auth/otp-input";
import { authClient } from "@/lib/auth-client";

type Step = "email" | "code";
type EmailError = "invalid" | "sendFailed" | "oauthFailed" | null;
type CodeError = "wrong" | "expired" | "tooMany" | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_SECONDS = 60;

export function LoginForm({ next = "/" }: { next?: string }) {
  const t = useTranslations("auth");
  const router = useRouter();

  // Both sign-in flows land on /welcome first (new users still need
  // onboarding); it forwards `next` on to the final destination once a
  // profile exists.
  const welcomeTarget =
    next === "/" ? "/welcome" : `/welcome?next=${encodeURIComponent(next)}`;

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<EmailError>(null);
  const [sending, setSending] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<CodeError>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const submittedCode = useRef("");

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  async function sendCode() {
    if (!EMAIL_RE.test(email)) {
      setEmailError("invalid");
      return;
    }
    setEmailError(null);
    setSending(true);
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });
    setSending(false);
    if (error) {
      setEmailError("sendFailed");
      return;
    }
    setStep("code");
    setCode("");
    setCodeError(null);
    setAttemptsLeft(null);
    setResendIn(RESEND_SECONDS);
  }

  async function verify(fullCode: string) {
    if (verifying || submittedCode.current === fullCode) return;
    submittedCode.current = fullCode;
    setVerifying(true);
    setCodeError(null);
    const { error } = await authClient.signIn.emailOtp({
      email,
      otp: fullCode,
    });
    setVerifying(false);
    if (!error) {
      router.push(welcomeTarget);
      return;
    }
    const codeName = error.code ?? "";
    if (codeName.includes("EXPIRED")) {
      setCodeError("expired");
    } else if (codeName.includes("TOO_MANY") || codeName.includes("MAX")) {
      setCodeError("tooMany");
    } else {
      setCodeError("wrong");
      setAttemptsLeft((prev) => (prev === null ? 4 : Math.max(prev - 1, 0)));
    }
  }

  function onCodeChange(next: string) {
    setCode(next);
    if (next.length === 6) void verify(next);
  }

  async function signInWithGoogle() {
    setEmailError(null);
    try {
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: welcomeTarget,
      });
      if (error) setEmailError("oauthFailed");
    } catch {
      setEmailError("oauthFailed");
    }
  }

  if (step === "code") {
    const locked = codeError === "tooMany";
    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => setStep("email")}
          className="self-start text-[12px] text-mute underline-offset-2 hover:underline"
        >
          ← {t("code.changeEmail")}
        </button>
        <h2 className="font-serif text-[19px] font-semibold">
          {t("code.title")}
        </h2>
        <p className="text-mute">{t("code.sentTo", { email })}</p>

        <OtpInput
          value={code}
          onChange={onCodeChange}
          disabled={locked || verifying}
          invalid={codeError === "wrong"}
        />

        {codeError === "wrong" && (
          <p className="border-l-3 border-neg bg-red-soft py-1.5 pl-3 text-[12px] text-neg">
            {t("code.wrong", { count: attemptsLeft ?? 0 })}
          </p>
        )}
        {codeError === "expired" && (
          <p className="border-l-3 border-null-rule bg-null py-1.5 pl-3 text-[12px] text-null-txt">
            {t("code.expired")}
          </p>
        )}
        {locked && (
          <p className="border-l-3 border-neg bg-red-soft py-1.5 pl-3 text-[12px] text-neg">
            {t("code.tooMany")}
          </p>
        )}

        <button
          onClick={() => void sendCode()}
          disabled={resendIn > 0 || sending}
          className="min-h-11 cursor-pointer border border-rule-2 bg-paper px-4 text-[13px] font-medium hover:bg-bg disabled:cursor-not-allowed disabled:text-mute-2"
        >
          {resendIn > 0
            ? t("code.resendIn", { seconds: resendIn })
            : t("code.resend")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => void signInWithGoogle()}
        className="min-h-11 cursor-pointer border border-accent bg-accent px-4 text-[13px] font-medium text-paper hover:bg-accent-ink"
      >
        {t("login.google")}
      </button>

      {emailError === "oauthFailed" && (
        <p className="border-l-3 border-neg bg-red-soft py-1.5 pl-3 text-[12px] text-neg">
          {t("login.oauthFailed")}
        </p>
      )}

      <div className="flex items-center gap-3 text-[10.5px] uppercase tracking-[0.1em] text-mute-2">
        <span className="h-px flex-1 bg-rule" />
        {t("login.orByCode")}
        <span className="h-px flex-1 bg-rule" />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-mute">
          {t("login.emailLabel")}
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError === "invalid") setEmailError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void sendCode()}
          placeholder="you@example.com"
          className={`min-h-11 border bg-paper px-3 font-mono text-[14px] outline-none focus:border-accent focus:shadow-[inset_0_0_0_1px_var(--accent)] ${
            emailError === "invalid" ? "border-neg" : "border-rule-2"
          }`}
        />
      </label>
      {emailError === "invalid" && (
        <p className="-mt-2 text-[11px] text-neg">{t("login.invalidEmail")}</p>
      )}
      {emailError === "sendFailed" && (
        <p className="border-l-3 border-neg bg-red-soft py-1.5 pl-3 text-[12px] text-neg">
          {t("login.sendFailed")}
        </p>
      )}

      <button
        onClick={() => void sendCode()}
        disabled={sending}
        className="min-h-11 cursor-pointer border border-rule-2 bg-paper px-4 text-[13px] font-medium hover:bg-bg disabled:cursor-not-allowed disabled:opacity-75"
      >
        {sending ? t("login.sending") : t("login.getCode")}
      </button>
    </div>
  );
}

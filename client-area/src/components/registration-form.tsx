"use client";

import { useState } from "react";
import type { ClientSession } from "@/lib/client-data";

type RegistrationFormProps = {
  sessionSlug?: string;
  session?: ClientSession | null;
};

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  jobTitle: string;
};

const EMPTY_FORM: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  companyName: "",
  jobTitle: "",
};

export function RegistrationForm({ sessionSlug, session }: RegistrationFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const isOpenEvent = session?.sessionType === "open_event";

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage("");

    const payload = {
      sessionSlug,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim().toLowerCase(),
      companyName: form.companyName.trim(),
      jobTitle: form.jobTitle.trim(),
    };

    if (!payload.firstName || !payload.lastName) {
      setStatus("error");
      setMessage("Please enter your first and last name.");
      return;
    }

    if (!payload.email || !payload.email.includes("@")) {
      setStatus("error");
      setMessage("Please enter a valid email address.");
      return;
    }

    if (isOpenEvent && !payload.companyName) {
      setStatus("error");
      setMessage("Please enter your company name.");
      return;
    }

    try {
      const registerResponse = await fetch("/api/client/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!registerResponse.ok) {
        const data = await registerResponse.json().catch(() => null);
        throw new Error(data?.error ?? "Registration failed.");
      }

      const requestResponse = await fetch("/api/client/auth/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!requestResponse.ok) {
        const data = await requestResponse.json().catch(() => null);
        throw new Error(data?.error ?? "Could not send magic link.");
      }

      setStatus("sent");
      setMessage("Check your email for the magic link.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-[1.25rem] border border-[#1a1a2e]/10 bg-white p-6 shadow-[0_18px_50px_rgba(26,26,46,0.08)]">
        <h2 className="text-2xl font-semibold text-[#1a1a2e]">Check your inbox</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[1.25rem] border border-[#1a1a2e]/10 bg-white p-6 shadow-[0_18px_50px_rgba(26,26,46,0.08)]"
    >
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-[#1a1a2e]">
          {session?.name ? session.name : "Client Portal"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Enter your details below to access your session materials, proposals, and resources.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="firstName" className="text-sm font-medium text-slate-700">
            First name
          </label>
          <input
            id="firstName"
            required
            value={form.firstName}
            onChange={(event) => updateField("firstName", event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-[#1a1a2e] outline-none transition focus:border-[#3B5CB5]"
            placeholder="Jane"
          />
        </div>

        <div>
          <label htmlFor="lastName" className="text-sm font-medium text-slate-700">
            Last name
          </label>
          <input
            id="lastName"
            required
            value={form.lastName}
            onChange={(event) => updateField("lastName", event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-[#1a1a2e] outline-none transition focus:border-[#3B5CB5]"
            placeholder="Smith"
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          value={form.email}
          onChange={(event) => updateField("email", event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-[#1a1a2e] outline-none transition focus:border-[#3B5CB5]"
          placeholder="you@company.com"
        />
      </div>

      {isOpenEvent ? (
        <div className="mt-4">
          <label htmlFor="companyName" className="text-sm font-medium text-slate-700">
            Company name
          </label>
          <input
            id="companyName"
            required
            value={form.companyName}
            onChange={(event) => updateField("companyName", event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-[#1a1a2e] outline-none transition focus:border-[#3B5CB5]"
            placeholder="Your organisation"
          />
        </div>
      ) : null}

      <div className="mt-4">
        <label htmlFor="jobTitle" className="text-sm font-medium text-slate-700">
          Job title <span className="text-slate-400">(optional)</span>
        </label>
        <input
          id="jobTitle"
          value={form.jobTitle}
          onChange={(event) => updateField("jobTitle", event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-[#1a1a2e] outline-none transition focus:border-[#3B5CB5]"
          placeholder="Head of Innovation"
        />
      </div>

      {message ? (
        <p
          className={`mt-4 text-sm ${
            status === "error" ? "text-red-600" : "text-slate-600"
          }`}
        >
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-black px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#161616] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {status === "submitting" ? "Sending…" : "Send magic link"}
      </button>
    </form>
  );
}

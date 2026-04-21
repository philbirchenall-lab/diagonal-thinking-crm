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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!registerResponse.ok) {
        const data = await registerResponse.json().catch(() => null);
        throw new Error(data?.error ?? "Registration failed.");
      }

      const requestResponse = await fetch("/api/client/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!requestResponse.ok) {
        const data = await requestResponse.json().catch(() => null);
        throw new Error(data?.error ?? "Could not send access link.");
      }

      setStatus("sent");
      setMessage("Check your email for your access link.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  if (status === "sent") {
    return (
      <div className="dt-panel dt-panel--compact">
        <div className="dt-panel__header">
          <p className="dt-card-eyebrow">Access requested</p>
          <h2 className="dt-card-title">Check your inbox</h2>
          <p className="dt-card-copy">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="dt-panel dt-panel--compact"
    >
      <div className="dt-panel__header">
        <p className="dt-card-eyebrow">{session ? "Request access" : "Get your link"}</p>
        <h2 className="dt-card-title">{session ? "Your details" : "Start here"}</h2>
        <p className="dt-card-copy">
          Enter your details below and we will send you a secure access link.
        </p>
      </div>

      <div className="dt-form-grid" style={{ marginTop: "24px" }}>
        <div className="dt-form-field">
          <label htmlFor="firstName" className="dt-label">
            First name
          </label>
          <input
            id="firstName"
            required
            value={form.firstName}
            onChange={(event) => updateField("firstName", event.target.value)}
            className="dt-input"
            placeholder="First name"
          />
        </div>

        <div className="dt-form-field">
          <label htmlFor="lastName" className="dt-label">
            Last name
          </label>
          <input
            id="lastName"
            required
            value={form.lastName}
            onChange={(event) => updateField("lastName", event.target.value)}
            className="dt-input"
            placeholder="Last name"
          />
        </div>
      </div>

      <div className="dt-form-field" style={{ marginTop: "16px" }}>
        <label htmlFor="email" className="dt-label">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          value={form.email}
          onChange={(event) => updateField("email", event.target.value)}
          className="dt-input"
          placeholder="you@company.com"
        />
      </div>

      {isOpenEvent ? (
        <div className="dt-form-field" style={{ marginTop: "16px" }}>
          <label htmlFor="companyName" className="dt-label">
            Company name
          </label>
          <input
            id="companyName"
            required
            value={form.companyName}
            onChange={(event) => updateField("companyName", event.target.value)}
            className="dt-input"
            placeholder="Your organisation"
          />
        </div>
      ) : null}

      <div className="dt-form-field" style={{ marginTop: "16px" }}>
        <label htmlFor="jobTitle" className="dt-label">
          Job title <span className="dt-label__optional">(optional)</span>
        </label>
        <input
          id="jobTitle"
          value={form.jobTitle}
          onChange={(event) => updateField("jobTitle", event.target.value)}
          className="dt-input"
          placeholder="Head of Innovation"
        />
      </div>

      {message ? (
        <p className={`dt-status ${status === "error" ? "dt-status--error" : ""}`}>
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="dt-btn-primary dt-btn-primary--full"
        style={{ marginTop: "24px" }}
      >
        {status === "submitting" ? "Sending..." : "Send access link"}
      </button>
    </form>
  );
}

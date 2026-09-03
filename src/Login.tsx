/* Lightweight role-based sign-in for the testing phase. One default password,
   handed out by AiCoE; the email decides the role and therefore what the studio
   shows. Production replaces this with LevelShift SSO (Entra ID). */

import { useState, type FormEvent } from "react";
import { SignIn } from "@phosphor-icons/react";
import { useStore } from "./store";

export default function LoginScreen() {
  const { login } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) { setError("Enter your work email."); return; }
    const failure = login(email, password);
    if (failure) setError(failure);
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="login-brand">
          <span className="brand-mark"><img src="/logo-icon.svg" alt="ShiftAI" /></span>
          <div><strong>ShiftAI</strong><small>Marketing Studio</small></div>
        </div>
        <h1>Sign in to your workspace</h1>
        <p className="login-sub">
          Your role decides what you see — approvers get their gates, writers get
          their reviews, AiCoE sees the whole fleet.
        </p>
        <div className="field">
          <label htmlFor="login-email">Work email</label>
          <input id="login-email" type="email" autoComplete="username" value={email}
            placeholder="name@levelshift.com"
            onChange={(e) => { setEmail(e.target.value); setError(""); }} />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }} />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="primary-button login-button">
          <SignIn size={16} /> Sign in
        </button>
        <p className="login-note">
          Accounts are created by AiCoE (aicoe@levelshift.com) with a shared default
          password. Single sign-on replaces this in production.
        </p>
      </form>
    </main>
  );
}

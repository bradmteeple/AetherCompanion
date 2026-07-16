"use client";

import { useEffect, useState } from "react";

const PASSWORD = "BalanRocks!123";
const STORAGE_KEY = "aether-auth";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === PASSWORD) {
        setAuthed(true);
      }
    } catch {
      // localStorage may be unavailable (e.g. privacy mode); stay locked.
    }
    setReady(true);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === PASSWORD) {
      try {
        localStorage.setItem(STORAGE_KEY, PASSWORD);
      } catch {
        // Ignore storage failures; the session stays unlocked in memory.
      }
      setAuthed(true);
      setError(false);
    } else {
      setError(true);
    }
  }

  // Avoid a flash of protected content and any hydration mismatch: render
  // nothing until we've checked storage on the client.
  if (!ready) return null;

  if (authed) return <>{children}</>;

  return (
    <div className="auth-overlay">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-logo">AetherESports</h1>
        <p className="auth-subtitle">Enter the password to continue.</p>
        <input
          type="password"
          className="auth-input"
          placeholder="Password"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(false);
          }}
          autoFocus
          aria-label="Password"
        />
        {error && <p className="auth-error">Incorrect password. Try again.</p>}
        <button type="submit" className="auth-button">
          Unlock
        </button>
      </form>
    </div>
  );
}

'use client';

import { useId, useRef, useState } from 'react';
import { LogIn } from 'lucide-react';
import { ActionButton } from '@/components/question-box/action-button';
import { ApiError, login, type AuthSession } from '@/lib/api-client';

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 429) {
      const minutes = Math.max(1, Math.ceil((err.retryAfterSeconds || 60) / 60));
      return `試行回数が多いため、約${minutes}分待ってから再度お試しください。`;
    }
    return err.message;
  }
  return '通信できませんでした。接続を確認して再度お試しください。';
}

/** 運営ID・パスワードのログインフォーム */
export default function PasswordLogin({ onSuccess }: { onSuccess: (session: AuthSession) => void }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const passwordInput = useRef<HTMLInputElement>(null);
  const errorId = useId();

  async function submit() {
    if (busy) return;
    if (!loginId.trim() || !password) {
      setError('運営IDとパスワードを入力してください。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const session = await login(loginId.trim(), password);
      setPassword('');
      onSuccess(session);
    } catch (err) {
      setPassword('');
      setError(describeError(err));
      requestAnimationFrame(() => passwordInput.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="settings-form"
      aria-label="運営ログイン"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error && (
        <p id={errorId} className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <label className="field-label">
        運営ID
        <input
          className="field-input"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={40}
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          disabled={busy}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      <label className="field-label">
        パスワード
        <input
          ref={passwordInput}
          className="field-input"
          type="password"
          name="password"
          autoComplete="current-password"
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      <ActionButton type="submit" busy={busy}>
        <LogIn size={18} />
        ログイン
      </ActionButton>
    </form>
  );
}

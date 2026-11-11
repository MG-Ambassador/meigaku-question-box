'use client';

import { useId, useState } from 'react';
import { ActionButton } from '@/components/question-box/action-button';
import { ApiError, changePassword, type AuthSession } from '@/lib/api-client';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validateNewPassword } from '@/lib/password-rules';

/**
 * パスワード変更フォーム。初回ログイン時（required）は必須表示。
 * 変更に成功すると他端末のログインは無効になり、この端末には新しいセッションが渡される。
 */
export default function PasswordChange({
  token,
  required = false,
  onChanged,
  onAuthError,
}: {
  token: string;
  required?: boolean;
  onChanged: (session: AuthSession) => void;
  onAuthError: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();
  const hintId = useId();

  async function submit() {
    if (busy) return;
    const problem = validateNewPassword(current, next, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const session = await changePassword(token, current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      onChanged(session);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        onAuthError();
        return;
      }
      if (err instanceof ApiError && err.statusCode === 429) {
        const minutes = Math.max(1, Math.ceil((err.retryAfterSeconds || 60) / 60));
        setError(`試行回数が多いため、約${minutes}分待ってから再度お試しください。`);
      } else {
        setError(err instanceof ApiError ? err.message : '通信できませんでした。接続を確認して再度お試しください。');
      }
    } finally {
      setBusy(false);
    }
  }

  const describedBy = [hintId, error ? errorId : ''].filter(Boolean).join(' ');

  return (
    <form
      className="settings-form"
      aria-label="パスワード変更"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {required && (
        <p className="notice">初回ログインのため、仮パスワードを本人用のパスワードに変更してください。変更するまで運営画面は利用できません。</p>
      )}
      {error && (
        <p id={errorId} className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {/* パスワードマネージャーが保存先アカウントを判別できるようにする */}
      <input type="text" name="username" autoComplete="username" hidden readOnly value="" />
      <label className="field-label">
        {required ? '仮パスワード' : '現在のパスワード'}
        <input
          className="field-input"
          type="password"
          autoComplete="current-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="field-label">
        新しいパスワード
        <input
          className="field-input"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={busy}
          aria-describedby={describedBy}
        />
      </label>
      <p id={hintId} className="muted">
        {PASSWORD_MIN_LENGTH}〜{PASSWORD_MAX_LENGTH}文字。長めの文章（パスフレーズ）がおすすめです。変更すると他の端末ではログアウトされます。
      </p>
      <label className="field-label">
        新しいパスワード（確認）
        <input
          className="field-input"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
        />
      </label>
      <ActionButton type="submit" busy={busy}>
        パスワードを変更する
      </ActionButton>
    </form>
  );
}

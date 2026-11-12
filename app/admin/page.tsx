'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionButton } from '@/components/question-box/action-button';
import PasswordLogin from '@/components/password-login';
import PasswordChange from '@/components/password-change';
import Panel from './panel';
import { getAdminMe, logout, ApiError, type AdminUser, type AuthSession } from '@/lib/api-client';
import { clearSession, readSession, writeSession } from '@/lib/admin-session';
import { resolvePublicPath } from '@/lib/public-url';
import { GUEST_TOKEN, GUEST_USER, isGuestAdminEnabled } from '@/lib/guest-admin';

type AuthStatus = 'checking' | 'unauthenticated' | 'mustChange' | 'authenticated' | 'error';

export default function AdminPage() {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [token, setToken] = useState<string>('');
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const restoring = useRef(false);

  const signOutLocally = useCallback((message = '') => {
    clearSession();
    setToken('');
    setAdminUser(null);
    setErrorMessage('');
    setNotice(message);
    setStatus('unauthenticated');
  }, []);

  /** sessionStorage のトークンでログイン状態を復元する（再読み込み時） */
  const restore = useCallback(async () => {
    if (restoring.current) return;
    const saved = readSession();
    if (!saved) {
      setStatus('unauthenticated');
      return;
    }
    restoring.current = true;
    setStatus('checking');
    setErrorMessage('');
    try {
      const user = await getAdminMe(saved.token);
      setToken(saved.token);
      setAdminUser(user);
      setStatus(user.mustChange ? 'mustChange' : 'authenticated');
    } catch (err) {
      if (err instanceof ApiError && (err.statusCode === 401 || err.statusCode === 403)) {
        signOutLocally('ログインの有効期限が切れました。再度ログインしてください。');
      } else {
        setStatus('error');
        setErrorMessage(err instanceof ApiError ? err.message : '通信できませんでした。接続を確認して再度お試しください。');
      }
    } finally {
      restoring.current = false;
    }
  }, [signOutLocally]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore the saved session from browser storage after hydration.
    void restore();
  }, [restore]);

  const handleAuthenticated = useCallback((session: AuthSession) => {
    writeSession({ token: session.token, expiresAt: session.expiresAt });
    setToken(session.token);
    setAdminUser(session.user);
    setErrorMessage('');
    setNotice('');
    setStatus(session.user.mustChange ? 'mustChange' : 'authenticated');
  }, []);

  const handleGuestEnter = useCallback(() => {
    clearSession();
    setToken(GUEST_TOKEN);
    setAdminUser({ ...GUEST_USER });
    setErrorMessage('');
    setNotice('');
    setStatus('authenticated');
  }, []);

  const handleLogout = useCallback(() => {
    if (token && token !== GUEST_TOKEN) {
      // サーバー側のセッションも無効化する（失敗しても手元のトークンは破棄する）
      void logout(token).catch(() => {});
    }
    signOutLocally();
  }, [token, signOutLocally]);

  const handleAuthLost = useCallback(() => {
    signOutLocally('ログインの有効期限が切れたか、アカウントが変更されました。再度ログインしてください。');
  }, [signOutLocally]);

  // 認証済みの場合：運営ダッシュボードを表示
  if (status === 'authenticated' && adminUser && token) {
    return (
      <Panel
        token={token}
        adminUser={adminUser}
        onLogout={handleLogout}
        onSessionChange={handleAuthenticated}
      />
    );
  }

  // 未認証・確認中・初回パスワード変更・エラー時の画面
  return (
    <main className="operator-entry">
      {/* eslint-disable-next-line @next/next/no-img-element -- Static export serves the official SVG as-is. */}
      <img className="entry-lockup" src={resolvePublicPath('/brand/mg-lockup-3line.svg')} alt="明治学院大学 Meiji Gakuin University" />
      <div className="login-card surface">
        <span className="eyebrow block text-xs font-semibold tracking-wider text-neutral-500 mb-2">
          MEIGAKU QUESTION BOX · ADMIN
        </span>
        <h1 className="text-2xl font-bold mb-4">{status === 'mustChange' ? 'パスワードの変更' : '運営管理画面'}</h1>

        {status === 'checking' && (
          <div className="py-8">
            <p className="text-neutral-600" role="status">ログイン状態を確認しています…</p>
          </div>
        )}

        {status === 'mustChange' && adminUser && token && (
          <div className="py-4">
            <p className="text-neutral-600 text-sm mb-6">{adminUser.displayName}（{adminUser.loginId || adminUser.sub}）としてログインしています。</p>
            <PasswordChange token={token} required onChanged={handleAuthenticated} onAuthError={handleAuthLost} />
            <ActionButton type="button" tone="quiet" onClick={handleLogout}>
              ログアウト
            </ActionButton>
          </div>
        )}

        {status === 'error' && (
          <div className="py-4">
            <div className="notice notice-error" role="alert">
              <p className="font-semibold">ログイン状態を確認できませんでした</p>
              <p className="mt-1">{errorMessage}</p>
            </div>
            <ActionButton type="button" onClick={() => void restore()}>
              再試行
            </ActionButton>
            <ActionButton type="button" tone="secondary" onClick={handleLogout}>
              ログアウトしてログイン画面へ
            </ActionButton>
          </div>
        )}

        {status === 'unauthenticated' && (
          <div className="py-4">
            {notice && (
              <p className="notice" role="status">{notice}</p>
            )}
            <p className="text-neutral-600 text-sm mb-6">
              運営IDとパスワードでログインして、届いた質問の閲覧やイベント管理を行います。アカウントは運営責任者が発行します。
            </p>
            <PasswordLogin onSuccess={handleAuthenticated} />
          </div>
        )}

        {isGuestAdminEnabled() && (status === 'unauthenticated' || status === 'error') && (
          <div className="py-2">
            <ActionButton type="button" tone="secondary" onClick={handleGuestEnter}>
              ゲスト管理者として入る
            </ActionButton>
            <p className="mt-2 text-xs text-neutral-500">
              開発確認用です。ダミーデータのみを表示し、実データには接続しません（変更は再読み込みで元に戻ります）。
            </p>
          </div>
        )}

        <div className="mt-8 pt-4 border-t text-xs text-neutral-400">
          <a href={resolvePublicPath('/')} className="entry-visitor">
            ← 来場者用質問画面へ戻る
          </a>
        </div>
      </div>
    </main>
  );
}

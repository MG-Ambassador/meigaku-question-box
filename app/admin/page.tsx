'use client';

import { useState } from 'react';
import GoogleLogin, { googleLogout } from '@/components/google-login';
import Panel from './panel';
import { getAdminMe, ApiError } from '@/lib/api-client';
import { resolvePublicPath } from '@/lib/public-url';

type AuthStatus = 'unauthenticated' | 'checking' | 'authenticated' | 'forbidden' | 'error';

interface AdminUser {
  displayName: string;
  sub: string;
  email?: string;
}

export default function AdminPage() {
  const [status, setStatus] = useState<AuthStatus>('unauthenticated');
  const [token, setToken] = useState<string>('');
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  async function handleGoogleSuccess(idToken: string) {
    setToken(idToken);
    setStatus('checking');
    setErrorMessage('');

    try {
      const user = await getAdminMe(idToken);
      setAdminUser(user);
      setStatus('authenticated');
    } catch (err: unknown) {
      console.error('Admin authentication check failed:', err);
      if (err instanceof ApiError && err.statusCode === 403) {
        setStatus('forbidden');
      } else {
        setStatus('error');
        setErrorMessage(
          err instanceof Error ? err.message : '認証の確認中にエラーが発生しました。再度お試しください。'
        );
      }
    }
  }

  function handleLogout() {
    setToken('');
    setAdminUser(null);
    setStatus('unauthenticated');
    setErrorMessage('');
    googleLogout();
  }

  // 認証済みの場合：運営ダッシュボードを表示
  if (status === 'authenticated' && adminUser && token) {
    return <Panel token={token} adminUser={adminUser} onLogout={handleLogout} />;
  }

  // 未認証・認証チェック中・エラー時のログイン画面
  return (
    <main className="operator-entry min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <div className="login-card max-w-md w-full p-8 border rounded-xl shadow-sm bg-white">
        <span className="eyebrow block text-xs font-semibold tracking-wider text-neutral-500 mb-2">
          MEIGAKU QUESTION BOX · ADMIN
        </span>
        <h1 className="text-2xl font-bold mb-4">運営管理画面</h1>

        {status === 'checking' && (
          <div className="py-8">
            <p className="text-neutral-600">権限を確認しています…</p>
          </div>
        )}

        {status === 'forbidden' && (
          <div className="py-4">
            <div className="p-4 border border-amber-300 rounded bg-amber-50 text-amber-800 text-sm mb-4">
              <p className="font-semibold">アクセス権限がありません</p>
              <p className="mt-1">
                ログインしたGoogleアカウントは運営者リストに登録されていません。運営責任者までお問い合わせください。
              </p>
            </div>
            <button
              type="button"
              className="outline text-sm"
              onClick={handleLogout}
            >
              別のアカウントでログイン
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="py-4">
            <div className="p-4 border border-red-300 rounded bg-red-50 text-red-800 text-sm mb-4">
              <p className="font-semibold">認証エラー</p>
              <p className="mt-1">{errorMessage}</p>
            </div>
            <button
              type="button"
              className="outline text-sm"
              onClick={handleLogout}
            >
              もう一度ログインを試す
            </button>
          </div>
        )}

        {status === 'unauthenticated' && (
          <div className="py-4">
            <p className="text-neutral-600 text-sm mb-6">
              許可されたGoogleアカウントでログインして、届いた質問の閲覧やイベント管理を行います。
            </p>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={(e) => {
                setStatus('error');
                setErrorMessage(e.message);
              }}
            />
          </div>
        )}

        <div className="mt-8 pt-4 border-t text-xs text-neutral-400">
          <a href={resolvePublicPath('/')} className="hover:underline">
            ← 来場者用質問画面へ戻る
          </a>
        </div>
      </div>
    </main>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

interface GoogleLoginProps {
  onSuccess: (idToken: string) => void;
  onError?: (error: Error) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number;
              locale?: string;
            }
          ) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

export default function GoogleLogin({ onSuccess, onError }: GoogleLoginProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string>('');

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

  useEffect(() => {
    if (!clientId) {
      setLoadError('NEXT_PUBLIC_GOOGLE_CLIENT_ID が設定されていません。');
      return;
    }

    // スクリプトが既に読み込まれている場合
    if (window.google?.accounts?.id) {
      setScriptLoaded(true);
      return;
    }

    // GIS スクリプトの動的読み込み
    const scriptId = 'google-identity-services';
    let script = document.getElementById(scriptId) as HTMLScriptElement;

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => setScriptLoaded(true);
      script.onerror = () => {
        const err = new Error('Google Identity Services の読み込みに失敗しました。');
        setLoadError(err.message);
        onError?.(err);
      };
      document.body.appendChild(script);
    } else {
      script.addEventListener('load', () => setScriptLoaded(true));
    }
  }, [clientId, onError]);

  useEffect(() => {
    if (!scriptLoaded || !containerRef.current || !window.google?.accounts?.id || !clientId) {
      return;
    }

    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response.credential) {
            onSuccess(response.credential);
          } else {
            const err = new Error('Google IDトークンを取得できませんでした。');
            setLoadError(err.message);
            onError?.(err);
          }
        },
      });

      // 公式ボタンの描画
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        locale: 'ja',
      });
    } catch (e) {
      const err = e instanceof Error ? e : new Error('ログインボタンの初期化に失敗しました。');
      setLoadError(err.message);
      onError?.(err);
    }
  }, [scriptLoaded, clientId, onSuccess, onError]);

  if (loadError) {
    return (
      <div className="login-error-box p-4 border border-red-300 rounded bg-red-50 text-red-700 text-sm">
        <p className="font-semibold">ログイン機能の初期化エラー</p>
        <p>{loadError}</p>
        <p className="mt-2 text-xs text-neutral-500">
          Instagram等のアプリ内ブラウザではGoogleログインがブロックされる場合があります。SafariまたはChromeで開いてください。
        </p>
      </div>
    );
  }

  return (
    <div className="google-login-container flex flex-col items-center justify-center p-4">
      <div ref={containerRef} />
      {!scriptLoaded && <p className="text-sm text-neutral-500 mt-2">Googleログインを読み込み中…</p>}
    </div>
  );
}

export function googleLogout() {
  if (typeof window !== 'undefined' && window.google?.accounts?.id) {
    window.google.accounts.id.disableAutoSelect();
  }
}

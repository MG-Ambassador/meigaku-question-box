# 明学の質問箱 (Meigaku Question Box)

明治学院大学のイベント（オープンキャンパス、学内イベント等）における来場者・学生からの匿名質問受付と、運営スタッフによる質問の閲覧・集計・回答・管理を支えるWebシステムです。

---

## 目次

1. [概要](#概要)
2. [本番環境URL](#本番環境url)
3. [主な機能](#主な機能)
4. [システムアーキテクチャ](#システムアーキテクチャ)
5. [技術スタック](#技術スタック)
6. [ディレクトリ構成](#ディレクトリ構成)
7. [ローカル開発環境のセットアップ](#ローカル開発環境のセットアップ)
8. [各種テストと品質検証](#各種テストと品質検証)
9. [デプロイとCI/CD](#デプロイとcicd)
10. [環境変数一覧](#環境変数一覧)
11. [関連ドキュメント](#関連ドキュメント)

---

## 概要

「明学の質問箱」は、紙や口頭では拾いきれない来場者からの質問をリアルタイムに収集・可視化するためのプラットフォームです。
以前の Cloudflare (D1/Vinext) 基盤から **GitHub Pages ＋ Google Cloud Run ＋ Cloud Firestore** に刷新され、高い耐障害性・セキュリティと、維持管理の手軽さを両立した構成になっています。

- **来場者（質問者）**: ログイン不要。イベントごとのルームURL（`/?room=<id>`）やQRコードから即座に匿名投稿が可能。
- **運営スタッフ（アンバサダー・管理者）**: Googleアカウント（Google Identity Services / GIS）による安全な認証を経て、リアルタイムダッシュボード・質問一覧・ステータス管理・集計・CSV出力等を利用可能。

---

## 本番環境URL

本プロジェクトの一般公開・運用向けURLは以下の通りです。

| サービス | 公開URL | 用途・説明 |
|---|---|---|
| **質問投稿画面（フロントエンド）** | [https://mg-ambassador.github.io/meigaku-question-box/](https://mg-ambassador.github.io/meigaku-question-box/) | 来場者・一般向け（※ 実際の投稿には `?room=<イベントID>` が必要） |
| **運営管理画面** | [https://mg-ambassador.github.io/meigaku-question-box/admin/](https://mg-ambassador.github.io/meigaku-question-box/admin/) | 運営スタッフ専用管理画面（Google ログイン認証が必要） |

> **セキュリティ上の注意**:
> バックエンド API（Cloud Run）のエンドポイントは、フロントエンド内部からの通信に限定して利用されます。直接のアクセスによる DoS 攻撃やリクエスト不正・不要なリソース消費を防ぐため、直接の API URL やヘルスチェックエンドポイントは公開せず、GitHub Actions の環境変数（`NEXT_PUBLIC_API_BASE_URL`）および Cloud Run 設定で安全に管理されています。

---

## 主な機能

### 来場者向け（質問投稿）
- **ルーム形式の受付**: URLパラメータ（`?room=<id>`）ごとにイベントの質問箱を展開（旧 `?event=<id>` との後方互換リダイレクト対応）。
- **匿名質問フォーム**: 5〜500文字の本文、カテゴリ（大学生活、学び・授業、入試・進路、留学・国際交流、その他）の選択。
- **安心・安全な投稿体験**: 連投制限や受付状態のリアルタイム反映、送信時のスムーズなフィードバックアニメーション。
- **冪等な再送制御**: 通信不良時の再送による重複投稿を防止。

### 運営者向け（管理画面 `/admin`）
- **Google ログイン認可**: 許可リスト（`ADMIN_EMAILS` / 許可された Google `sub`）に基づくアクセス制御。
- **イベント（ルーム）管理**:
  - イベント新規作成、名称・日時・会場の編集
  - 受付中／一時停止／終了のライフサイクル管理
  - 共有用URL・QRコードのワンクリックコピー
- **質問一覧・ワークスペース**:
  - テーマ別の視覚的識別（テーマカラー表示）
  - ワンタップで切り替えられる「お気に入り」機能（担当者ごとに保持）
  - 並び替え（新しい順／古い順／テーマ順）およびテーマ・お気に入りフィルタ
  - 署名付きカーソル（HMAC）による高速・改ざん耐性のあるページネーション
  - 質問詳細の確認・コピー・通報フラグの確認
- **リアルタイム集計ダッシュボード**:
  - 総質問数、未回答数、お気に入り数
  - カテゴリ別・流入元（Instagram等）別・日別の集計グラフ
- **データ出力**: イベントごとの質問データCSVエクスポート。

### セキュリティ & 信頼性（多層防御）
- **ゼロトラスト Firestore 構成**: クライアント（ブラウザ）からの直接接続は Firestore Security Rules で全拒否（`allow read, write: if false;`）。Cloud Run の実行サービスアカウント（ADC / IAM）経由でのみアクセスを許可。
- **運営者認証・厳格な認可**: Google Identity Services (GIS) による ID トークンをバックエンドで Google 公開鍵により完全検証。許可リスト（`ADMIN_EMAILS` および Google `sub` 識別子）に合致する運営者のみに管理権限を限定。
- **プライバシー保護型 IP 連投制限**: クライアントIP（信頼されたリバースプロキシヘッダー）を HMAC ソルトを用いてハッシュ化。生の IP アドレスは DB に保存せず、Firestore トランザクションを用いて 10 分間の投稿数を制限。
- **改ざん防止カーソル**: 質問一覧のページネーション情報（カーソル）に HMAC-SHA256 署名を付与し、クライアントによるシーケンス番号やパラメータの改ざんを検知・拒否。
- **API エンドポイントの多層防御**:
  - 8KB JSON ボディサイズ制限によるメモリ枯渇攻撃（DoS）の防止
  - Zod による厳格な入力バリデーション（不正な型や長大文字列の排除）
  - CORS による許可オリジン（フロントエンド GitHub Pages）への通信制限
  - Helmet による各種セキュリティレスポンスヘッダーの自動付与
- **キーレス CI/CD & シークレット管理**: GitHub Actions から Google Cloud への接続には Workload Identity Federation (WIF) を利用し、リポジトリ内に永続的なサービスアカウント JSON キーを発行・保管しない設計。

---

## システムアーキテクチャ

```text
[ 来場者 / 運営者ブラウザ ]
      │
      ├─ HTML / JS / CSS ────▶ GitHub Pages (Next.js 静的エクスポート)
      ├─ 運営認証 ────────────▶ Google Identity Services (GIS)
      │
      └─ HTTPS / REST API ───▶ Google Cloud Run (Express API Server)
                                    │
                                    ├─ Google IDトークン検証 (google-auth-library)
                                    ├─ 入力検証 (Zod) / レート制限 / 署名付きカーソル
                                    │
                                    ▼ ADC (Application Default Credentials)
                               [ Cloud Firestore (Native Mode) ]
                                    ├─ events (イベント情報)
                                    ├─ questions (質問データ)
                                    ├─ eventStats (集計カウンター)
                                    ├─ rateLimits (IP制限情報)
                                    └─ favorites (運営者お気に入り)
```

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| **フロントエンド** | Next.js 16 (App Router / React 19 / TypeScript / 静的エクスポート) |
| **スタイリング / UI** | Tailwind CSS 4, Radix UI, Shadcn UI, Lucide Icons, Recharts |
| **フロントホスティング** | GitHub Pages |
| **バックエンド API** | Node.js 24, Express, TypeScript, tsx, Zod, Helmet, CORS |
| **API ホスティング** | Google Cloud Run (Docker コンテナ) |
| **データベース** | Google Cloud Firestore (Native mode, Standard edition) |
| **認証方式** | Google Identity Services (GIS) / Google ID Token 検証 |
| **テスト・品質検証** | Node.js Test Runner, Playwright (E2E), ESLint, TypeScript |
| **CI / CD** | GitHub Actions (テスト・ビルド検証、Cloud Run 自動デプロイ、Pages 自動デプロイ) |

---

## ディレクトリ構成

```text
.
├── app/                      # Next.js App Router (フロントエンド)
│   ├── page.tsx              # 来場者向け質問投稿画面 (?room=<id>)
│   ├── admin/                # 運営管理画面 (/admin)
│   └── globals.css           # グローバルスタイル (Tailwind CSS)
├── components/               # Reactコンポーネント
│   ├── google-login.tsx      # Google Identity Services ログインボタン
│   ├── question-box/         # 質問箱・管理画面専用UIコンポーネント群
│   └── ui/                   # Shadcn UI / 汎用UIパーツ
├── server/                   # Cloud Run バックエンド API (Express)
│   ├── src/
│   │   ├── app.ts            # Express アプリ定義・ミドルウェア
│   │   ├── auth.ts           # Google トークン検証・運営者認可
│   │   ├── events.ts         # イベント操作ハンドラ
│   │   ├── questions.ts      # 質問投稿・冪等処理ハンドラ
│   │   ├── report.ts         # 集計・質問一覧・カーソル処理
│   │   ├── rate-limit.ts     # IPハッシュ連投制限
│   │   └── firestore.ts      # Firestore クライアント初期化
│   ├── test/                 # サーバー側単体・結合テスト
│   └── Dockerfile            # Cloud Run デプロイ用コンテナ定義
├── lib/                      # フロントエンド共通ライブラリ (APIクライアント等)
├── hooks/                    # Reactカスタムフック (ポーリング等)
├── tests/                    # E2E・移行・UI状態テスト
├── docs/                     # 詳細設計・ロードマップ・運用計画
├── firestore.rules           # Firestore セキュリティルール (全拒否)
├── firestore.indexes.json    # Firestore 複合インデックス定義
└── .github/workflows/        # CI/CD ワークフロー定義
    ├── ci.yml                # テスト・ビルド検証
    ├── deploy-cloud-run.yml  # Cloud Run 自動デプロイ
    └── deploy-pages.yml      # GitHub Pages 自動デプロイ
```

---

## ローカル開発環境のセットアップ

### 前提条件
- Node.js `>= 22.13.0` (CI/本番は Node.js 24 を使用)
- npm `>= 10.0.0`
- (任意) Google Cloud CLI (`gcloud`) または Firebase CLI (ローカルエミュレータ用)

### 1. 依存関係のインストール

プロジェクトルートおよびサーバーディレクトリの依存パッケージをインストールします。

```bash
# ルート（フロントエンド）の依存関係
npm ci

# サーバー（バックエンド）の依存関係
npm --prefix server ci
```

### 2. 環境変数の設定

#### フロントエンド (`.env.local`)
ルートディレクトリに `.env.local` を作成します（`.env.example` 参照）。

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
NEXT_PUBLIC_BASE_PATH=
```

#### バックエンド (`server/.env`)
`server/` ディレクトリに `.env` を作成します（`server/.env.example` 参照）。

```bash
PORT=8080
NODE_ENV=development
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
FIRESTORE_DATABASE_ID=(default)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
ADMIN_EMAILS=admin@example.com
RATE_LIMIT_SALT=dev-salt-string
CURSOR_SECRET=dev-cursor-secret-at-least-32-chars
```

> **Note**:
> - ローカルで Firestore Emulator を使用する場合は `FIRESTORE_EMULATOR_HOST=localhost:8085` を指定してください。
> - `.env.local` および `server/.env` は `.gitignore` に含まれており、誤って Git リポジトリへコミットされないようご注意ください。本番環境の認証情報や実際のメールアドレスをローカル設定に記載しないことを推奨します。

### 3. 開発サーバーの起動

ターミナルを2つ開いて実行します。

```bash
# ターミナル 1: バックエンド API (ポート 8080)
npm --prefix server run dev

# ターミナル 2: フロントエンド (ポート 3000)
npm run dev
```

起動後、ブラウザで以下のURLにアクセスします：
- 質問投稿画面: `http://localhost:3000/?room=<テスト用イベントID>`
- 運営管理画面: `http://localhost:3000/admin`
- API ヘルスチェック: `http://localhost:8080/health`

---

## 各種テストと品質検証

本プロジェクトでは、コードの品質と堅牢性を保証するために包括的なテストスイートを備えています。

```bash
# 1. サーバー単体・結合テスト (Express / Firestoreロジック)
npm run test:server

# 2. Firestoreデータ移行ドライラン検証
npm run test:migration

# 3. フロントエンド UI状態テスト
npm run test:ui-state

# 4. ブラウザ受入テスト (Playwright E2E)
npx playwright install --with-deps chromium  # 初回のみブラウザインストール
npm run test:ui

# 5. フロントエンド静的ビルド検証
npm run build

# 6. 静的解析 (ESLint)
npm run lint
```

---

## デプロイとCI/CD

GitHub Actions により、`main` ブランチへのプッシュで自動的にテストとデプロイが実行されます。

### 1. 継続的インテグレーション (`ci.yml`)
- プルリクエストおよび `main` へのプッシュ時に実行。
- サーバー型チェック、各種テスト（単体・移行・UI状態・Playwright E2E）、フロントエンド静的エクスポート生成（`out/index.html`, `out/admin/index.html`）を検証。

### 2. バックエンドデプロイ (`deploy-cloud-run.yml`)
- `server/**` や Firestore 設定が変更された際に実行。
- Workload Identity Federation (WIF) 経由で Google Cloud に安全に認証。
- Firestore のルールおよびインデックスを自動適用。
- Cloud Run へ最新の API コンテナを自動ビルド・デプロイ。

### 3. フロントエンドデプロイ (`deploy-pages.yml`)
- フロントエンド関連ファイルが変更された際に実行。
- Next.js の静的エクスポートをビルドし、GitHub Pages へ自動デプロイ。

---

## 環境変数一覧

### フロントエンド (GitHub Actions Repository Variables)
| 変数名 | 説明 | 設定例 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Cloud Run API のベースURL（※非公開で管理） | `https://<your-cloud-run-service>.a.run.app` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth 2.0 WebクライアントID | `xxxx.apps.googleusercontent.com` |
| `NEXT_PUBLIC_BASE_PATH` | GitHub Pages の公開サブパス | `/meigaku-question-box` |

### バックエンド (Cloud Run 環境変数 / Secret Manager)
| 変数名 | 説明 | 設定例 |
|---|---|---|
| `PORT` | サーバーポート番号 | `8080` |
| `GOOGLE_CLOUD_PROJECT` | GCP プロジェクトID | `<your-gcp-project-id>` |
| `FIRESTORE_DATABASE_ID` | Firestore データベースID | `(default)` |
| `ALLOWED_ORIGINS` | CORS 許可オリジン（カンマ区切り） | `https://<org>.github.io` |
| `ADMIN_EMAILS` | 運営者Googleアカウントメール（カンマ区切り） | `staff1@example.com,staff2@example.com` |
| `RATE_LIMIT_SALT` | IPアドレスハッシュ用ソルト文字列（要秘匿） | `ランダムな秘密文字列` |
| `CURSOR_SECRET` | ページネーションカーソル署名鍵（要秘匿） | `32文字以上の安全な秘密鍵` |

> [!CAUTION]
> **機密情報・シークレットの管理について**:
> - `RATE_LIMIT_SALT` および `CURSOR_SECRET` はシステムの改ざん防止・プライバシー保護に関わる重要シークレットです。GitHub リポジトリや公開設定ファイルには絶対にコミットせず、Google Cloud Run の環境変数または Secret Manager にて厳重に管理してください。
> - `ADMIN_EMAILS` には実在の管理スタッフのメールアドレスが設定されるため、公開リポジトリ上に実データを記載しないよう注意してください。

---

## 関連ドキュメント

より詳細な仕様や設計判断については、`docs/` ディレクトリ内の各設計書を参照してください。

- [GitHub Pages ＋ Google Cloud 開発ロードマップ](docs/GitHub-Pages-Google-Cloud-開発ロードマップ.md): アーキテクチャ選定の背景、データモデル設計、移行手順
- [運営管理画面 改善計画](docs/運営管理画面_改善計画.md): テーマカラー、お気に入り、ソート・フィルタ、集計動線の詳細仕様
- [UI/UX 刷新計画](docs/UIUX刷新計画.md): デザインガイドライン、カラースキーム、アクセシビリティ基準
- [本番環境の構築](docs/本番環境の構築.md): 本番インフラ構築と初期運用の記録


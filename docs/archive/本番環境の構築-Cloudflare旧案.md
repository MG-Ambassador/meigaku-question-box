> 2026-09-16に旧案として保存。記載された状態は当時の記録であり、現在のクラウド状態を再確認したものではありません。新しい設計は [本番環境の構築](../本番環境の構築.md) を参照してください。

# GitHub＋Cloudflare 本番構築

Cloudflareの認可と本番・確認用D1の作成が完了しています。接続先IDは deploy/environments.json に保存しています。Workerの公開は未実施です。既存のSites公開版とは別の環境です。

## ご本人にお願いする操作

1. GitHubの所有先を決めます。端末で接続できる既存アカウントは `Kounosuke0100` です。これを使うなら新しいGitHubアカウントは不要です。
2. https://dash.cloudflare.com/sign-up でCloudflareアカウントを作成し、メール確認を完了します。サイトの運営担当者が使うID・パスワードとは別の、インフラ管理用アカウントです。
3. 所有先が決まったら、こちらで端末からCloudflareのログインを開始します。開いたCloudflare画面でログイン・連携許可を行ってください。パスワードやAPIトークンをチャットに貼る必要はありません。
4. Cloudflare Freeのみを使用します。有料契約は不要です。運営ID・パスワード方式は維持しますが、現在のscrypt認証は無料枠での検証が未完了のため、公開処理を停止しています。以下のデプロイ手順はこの問題の解決後に使用します。

GitHub・Cloudflareの管理アカウントは二要素認証と復旧方法を設定し、大学・団体で引き継げる所有先にします。

## 構成

| 用途 | Worker | D1 |
|---|---|---|
| 動作確認 | meigaku-question-box-staging | meigaku-question-box-staging |
| 本番 | meigaku-question-box-production | meigaku-question-box-production |

確認環境に実際の質問・運営アカウントをコピーしません。本番データを新規開始するか既存データを移すかは切り替え前に決定します。現在のローカルパスワードやセッションを勝手に変更しません。

## 初回構築（保守担当者向け）

Node.js 24と `npm ci` を使用します。以下は作業手順であり、まだクラウド上で実行していません。

1. `npx wrangler login` でCloudflareへ接続。
2. 非公開GitHubリポジトリを作成し、秘密情報を除いたソースを保存。
3. `npx wrangler d1 create meigaku-question-box-staging` と本番用の同名末尾 `production` のD1を作成。
4. GitHubに `staging` と `production` のEnvironmentsを作成。それぞれに `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID` をVariablesとして設定。D1 IDを共用しない。
5. Cloudflareで対象アカウントに限ったWorkers Scripts Edit・D1 EditのAPIトークンを発行し、各EnvironmentのSecret `CLOUDFLARE_API_TOKEN` に保存。追加権限が必要ならエラー内容を確認して必要最小限を追加する。
6. 初回は確認環境から、該当IDを環境変数へ設定して以下を実行。

```sh
node scripts/cloudflare.mjs build staging
node scripts/cloudflare.mjs migrate staging
node scripts/cloudflare.mjs deploy staging
node scripts/create-bootstrap.mjs staging
npx wrangler secret bulk outputs/staging-bootstrap.json --config dist/server/wrangler.json
```

初回公開からsecret登録までは運営ログインが拒否される状態です。初回ログイン情報は `outputs/staging-login.txt` のみに保存され、Gitには入りません。ログインしてパスワード変更を済ませ、確認環境でイベント作成・匿名投稿・質問閲覧・担当者権限を検証します。オーナー作成後は `INITIAL_OPERATOR_HASH` をWorkerから削除します。これで初期パスワードへの戻し忘れも防げます。

本番は同じ手順の `staging` を `production` に置き換え、別のIDでビルドし直します。既存アカウントを移行する場合は新しい初期パスワードを作らず、移行手順を先に確定します。

## 更新と検証

GitHubへのpush/PRで認証テストとビルドを実行します。公開はmainブランチのActions「Verify and deploy」→「Run workflow」で対象環境を選択したときだけ実行します。データベースの変更を適用してからWorkerを公開します。変更は旧版とも互換性を持つ追加形式を原則とします。

```sh
node scripts/smoke-production.mjs https://実際の公開ホスト名
```

この確認はログインなしのページ表示と、質問・担当者データの閲覧拒否を検証します。ログイン、投稿、Instagram経由の分類は別途実環境で確認します。

## バックアップと復旧

本番のIDを環境変数へ設定し、DB変更前とイベント終了後に以下を実行します。

```sh
node scripts/cloudflare.mjs backup production
```

保存先はGit対象外の `backups/` です。質問や認証ハッシュを含むため、一般公開やGitHub Actionsの成果物への保存はしません。大学・団体の管理する保護された保管先へ保存します。

WorkerのロールバックだけではD1は元に戻りません。コードを戻せる変更か先に確認し、DB復旧は受付を停止してからTime Travelまたは検証済みバックアップで行います。初回の本番切り替え前に確認環境で復旧を試します。

## 公開前の未完了項目

- GitHub所有先の決定・リポジトリ作成
- Cloudflareアカウント接続済み（Freeを維持）
- D1作成済み。GitHub用APIトークン・初期管理者は未設定
- 実Worker上の認証CPU使用量とCookie動作の確認
- 確認環境の受入試験・復旧試験
- 既存イベント／質問の移行要否の確定
- 本番公開と公開URLの案内

参考: https://developers.cloudflare.com/workers/wrangler/configuration/ 、https://developers.cloudflare.com/d1/reference/migrations/ 、https://developers.cloudflare.com/workers/versions-and-deployments/

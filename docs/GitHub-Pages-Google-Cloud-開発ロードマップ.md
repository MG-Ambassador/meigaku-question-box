# 明学の質問箱：GitHub Pages＋Cloud Run＋Cloud Firestore 開発ロードマップ

作成・更新日：2026-09-18。Google Sheets案を廃止し、Firestore案に全面改訂。フロントエンド静的化・Cloud Runバックエンド・Firestore設定のコアコード実装が完了。手作業セッティングの実行タイミングおよび実装引き継ぎ内容を追記。今回の方針では、従来の「本番環境の構築.md」のRender案に代えて本書を参照する。

## 1. 結論と成立条件

**GitHub Pages＋Cloud Run＋Cloud Firestore（Standard edition / Native mode）に一本化する。** Google Sheets、Sheets API、シート共有、シート経由の移行・バックアップは採用しない。画面はGitHub Pages、業務ロジックとGoogle認証はCloud Run、永続データはFirestoreに集約する。

専用DBサーバーやOSの保守は不要。スキーマ、インデックス、IAM、費用、バックアップ・復旧は管理対象として残る。Firestoreのトランザクションで質問保存・連投制限・集計をまとめ、複数Cloud Runインスタンスや再起動をまたいで整合性を維持する。

無料枠内を目指すが、完全無料とは断言しない。特にTTL削除・バックアップ等は別途費用を見込む。計画用の仮定は月間来場者3,000人、投稿1,000件、運営5人、通常ピーク20投稿/分、蓄積10,000件。P7で60投稿/分の集中も試験し、費用と競合を測る。

初期版に含む：匿名投稿、Googleログイン、許可済み担当者の閲覧、イベント作成・編集・受付切替、カテゴリ・流入元・日別集計、50件単位の質問一覧、募集URLコピー、冪等な再送、共有レート制限、バックアップ・復旧。

初期版に含めない：質問の一般公開、Web上での回答、添付、Instagram API連携、担当者発行画面、パスワード管理。source=instagramはリンク由来の自己申告値。GISを使用し、Firebase Authenticationへの移行やブラウザーからのFirestore直接接続は行わない。

## 2. 採用する設計判断

| 項目 | 決定 |
|---|---|
| 永続ストア | Firestoreのみ。D1から直接移行する |
| 接続 | Cloud Runの実行サービスアカウント＋ADC。JSON秘密鍵を発行しない |
| ブラウザーアクセス | Firestore Security Rulesは全拒否。サーバーはIAMで認可 |
| 連投制限 | Firestoreの共有ドキュメントをトランザクション更新 |
| 再送 | requestIdから決定的な質問IDを生成。同じキー・同じ内容の保存は1回 |
| イベント編集 | versionによる楽観的ロック。古い編集は409 |
| 集計 | 質問保存と同じトランザクションでイベント別集計を更新 |
| 一覧 | offsetを使わず、署名付きカーソル＋単調増加sequence |
| 認証 | Google IDトークン検証＋許可sub。メールは補助情報 |
| 費用 | 無料枠を目標。バックアップ、TTL、通信、ビルド等を別途算入 |
| フロント | 標準Next.js静的エクスポート。既存デザインを維持 |

Cloud Runの予算通知は支出上限ではない。[Cloud Run料金](https://cloud.google.com/run/pricing)、[予算通知](https://docs.cloud.google.com/billing/docs/how-to/budgets)。ADCはCloud RunのサービスIDを利用する。[サービスID](https://docs.cloud.google.com/run/docs/securing/service-identity)。

## 3. 現行コードとの差分

| 現行ファイル | 確認できた状態 | 改修内容 |
|---|---|---|
| package.json / scripts/run-framework.mjs | buildはvinextまたはVite経由 | Pages向けに標準next buildを明示し、lockfile・CIを揃える |
| lib/server.ts | cloudflare:workersとD1に依存 | server側のFirestoreRepository、入力検証に置換 |
| app/api/questions/route.ts | D1への投稿、cf-connecting-ip、DB内カウンター | Cloud Runへ移植。IP処理を実環境で検証 |
| app/api/admin/route.ts | SQL集計、50件ページング | 集計ドキュメント読取とカーソルページングへ置換 |
| app/admin/page.tsx | force-dynamic、サーバー側operator認証 | 静的ページ＋クライアント側GISゲート |
| app/admin/panel.tsx | 相対API、メーター、日別件数リスト | APIクライアント、トークン、Pagesのパス対応。日別棒グラフは別の任意改善 |
| app/admin/password* / operators* | パスワード変更、ownerによる担当者管理 | 初期版から撤去。担当者の追加・失効は設定変更の運用へ |
| app/page.tsx | 相対API、ルート絶対リンク | APIベースURLと公開ベースパスに対応。イベント変更でfromパラメータを消さない |
| middleware.ts | セキュリティ・キャッシュヘッダー | API側へ移す。Pagesでは同じヘッダー制御を再現できない部分を整理 |
| .github/workflows/cloudflare.yml | Cloudflare用CI・公開 | PagesとCloud Runのワークフローへ置換 |
| db/schema.ts | status / answer、監査・認証テーブルあり | 旧データを保全。質問・イベント以外を勝手に削除しない |

ルートと`github-production/`に類似ソースがある。P0で公開元・最新変更・生成手順を比較し、保守対象を一本化する。ここはローカル調査からは確定していない。本番の公開先・データ件数・既存URLもP0で確認する。

## 4. アーキテクチャ

```text
来場者・運営ブラウザー ── HTML / JS / CSS ── GitHub Pages
        ├── Google Identity Services（運営ログイン）
        └── HTTPS JSON ── Cloud Run（公開到達可能）
                            ├─ 入力・Origin検査、Google IDトークン検証
                            ├─ 許可subによる運営認可
                            ├─ トランザクション、集計・カーソル生成
                            └─ ADC / IAM ── Cloud Firestore
                                             ├─ questions / events
                                             ├─ eventStats / rateLimits
                                             └─ audit / adminRequests
```

匿名投稿のためCloud Runの入口は公開し、運営APIをアプリで保護する。GISのIDトークンとCloud Run IAM呼出権限を混同しない。公開HTMLやJSに質問本文・管理者リストを含めない。

APIはTypeScript＋Express＋google-auth-library＋@google-cloud/firestore＋Zod。Node.jsの実行版はP0で現行CIとサポート期間を確認して固定する。Cloud RunとFirestoreは東京リージョンを第一候補とし、作成前にデータ所在地・料金・利用可能な機能を確認する。

```text
app/                         公開・管理画面（静的）
lib/api-client.ts            Bearer、URL、再送、エラー処理
lib/public-url.ts            Pages basePathと募集URL
components/google-login.tsx
server/src/auth.ts           Google検証・運営認可
server/src/firestore.ts      ADC、DB選択、型変換
server/src/questions.ts      冪等保存・共有制限・集計トランザクション
server/src/events.ts         イベント作成・競合検出
server/src/report.ts         集計・署名付きカーソル
server/src/rate-limit.ts     IP抽出・HMAC・滑動窓
server/test/                 Emulator単体・結合試験
server/Dockerfile
contracts/openapi.yaml
firestore.rules              Web/mobileアクセスを全拒否
firestore.indexes.json       複合インデックス・単一フィールド除外
scripts/migrate-to-firestore.mjs
scripts/rebuild-event-stats.mjs
scripts/purge-expired-data.mjs
```

サーバーSDKはSecurity Rulesを迂回するため、Rulesだけで保護しない。実行IDに対象DBのデータ操作に必要なIAM権限を付与し、Owner/Editorは与えない。`roles/datastore.user`を出発点にスコープを確認し、管理・バックアップ権限は別IDへ分ける。[Firestore IAM](https://firebase.google.com/docs/firestore/security/iam)、[サーバーとRulesの関係](https://firebase.google.com/docs/firestore/security/rules-query)。

ステージングと本番は別Google Cloudプロジェクトを基本とする。WIFでGitHub Actionsの対象リポジトリ・ブランチ／Environmentを限定し、デプロイIDと実行IDを分ける。[GitHub OIDC手順](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-google-cloud-platform)。

## 5. データ構造・インデックス

フィールド名はDB内ではcamelCase、既存画面向けAPIではcreated_atなどへ変換する。日時はFirestore Timestamp、APIではUNIXミリ秒。JSTは表示・日別集計にのみ適用する。すべての業務ドキュメントにschemaVersionを付け、読取時に検証する。

### questions/{questionId}

| フィールド | 型・仕様 |
|---|---|
| ドキュメントID | 新規投稿はSHA-256(requestId)の固定長文字列。全イベント共通のキー空間 |
| eventId | string。eventsへの参照をアプリで検証 |
| body | trim後5〜500 UTF-16コード単位。HTMLとして描画しない |
| category | 大学生活／学び・授業／入試・進路／留学・国際交流／その他 |
| source | web / instagram |
| requestHash | 正規化したeventId・body・category・source・契約版のハッシュ |
| createdAt | サーバー生成Timestamp。利用者の日時は信用しない |
| dayJst | YYYY-MM-DD。createdAtと同じ時刻から生成 |
| sequence | イベント内の単調増加整数。eventStatsから採番 |
| schemaVersion | 初期値1 |

requestIdはブラウザーがcrypto.randomUUIDで生成し、同じ送信を再試行する間保持する。ドキュメントIDが重複検出の根拠であり、ランダムIDで毎回addする実装は禁止。本文やIPをrequestId生成材料にしない。削除まで同じキーの冪等性を維持し、別キーでの同じ本文は別投稿とする。本文削除後の再受付防止はイベント閉鎖で担保し、削除済みイベントの再開時は新イベントIDを使う。

### events/{eventId}

`title:string(1〜100)`、`date:string(0〜100、日時・会場の表示文)`、`open:boolean`、`version:integer`、`createdAt:Timestamp`、`updatedAt:Timestamp`、`updatedBy:string(sub)`、`schemaVersion:1`。新規IDはサーバー生成UUID、移行時は既存IDを保持する。versionは更新ごとに加算する。

### eventStats/{eventId}

`total:integer`、`lastSequence:integer`、`categories:map`、`sources:map`、`recentDays:map<YYYY-MM-DD,integer>`、`updatedAt:Timestamp`、`dataVersion:integer`、`schemaVersion:1`。

カテゴリ・sourceのキーは固定列挙値。recentDaysは投稿があった直近30日だけ保持し、無制限にmapを増やさない。total・カテゴリ・sourceはイベント全期間。質問追加と同時更新するため、読取で全質問を走査しない。1イベント1集計ドキュメントの競合は負荷試験で測る。高負荷で必要になればシャード化を別工程で設計する。

### rateLimits/{keyVersion}_{ipHmac}

`acceptedAt:Timestamp[]（最大5件）`、`expiresAt:Timestamp`。全イベント共通。同じIPの直近600秒の成功投稿数をトランザクションで評価する。IPそのものは保存しない。expiresAtにTTLを設定し、最終受付から600秒後を目安とする。TTL削除の遅延中もアプリが時刻で期限判定する。

### audit/{auditId} / adminRequests/{key}

監査はactorSub、action、eventId、version、createdAtを保存し、本文・JWT・IPを含めない。イベント作成の再送にはsubとrequestIdから求めたadminRequestsキーを使い、requestHash・eventIdを保存する。イベント作成・初期集計・監査・再送記録を同じトランザクションで作る。

管理者許可リストはCloud RunのADMIN_IDENTITIESにsub・表示名・確認用メールを保持する。初回は責任者が本人確認して登録する。旧status・answer・auditは保護された移行データとして保全し、既存回答の有無をP0で確認する。

### インデックスと保管

- questions：eventId ASC＋sequence DESC。`where(eventId==…).where(sequence<=watermark).orderBy(sequence,desc)`に使用。
- events：open ASC＋createdAt DESC。管理一覧はcreatedAt DESC。
- body、requestHash、acceptedAt、集計mapなど検索しないフィールドは単一フィールドインデックスから除外する。TTLのexpiresAtも検索しなければ除外する。
- インデックス定義はリポジトリ管理し、作成完了を確認してから対応APIを公開する。Emulatorだけで本番インデックスを検証したことにしない。
- FirestoreはスキーマレスなのでZod等で書込み型を強制する。本文は文字列のまま保存し、将来のCSV出力では数式先頭文字を無害化する。

## 6. API契約・原子的な保存

Cloud RunのHTTPS URLをベースとする。JSON UTF-8、本文8KiB上限、Cookie不使用。APIの追跡IDはtraceId、投稿の冪等キーはrequestIdとして区別する。

| Method | Path | 認証 | 成功応答 |
|---|---|---|---|
| GET | /api/events | 不要 | 200 `{events:Event[]}` 受付中のみ |
| GET | /api/events/:id | 不要 | 200 `{event:Event}` 閉鎖も公開メタデータのみ |
| POST | /api/questions | 不要 | 201 `{ok:true,id,requestId}`、同一再送は200 |
| GET | /api/admin/me | Bearer | 200 `{displayName}` |
| GET | /api/admin/events | Bearer | 200 `{events:Event[]}` 閉鎖含む |
| GET | /api/admin | Bearer | 200 集計・質問・カーソル |
| POST | /api/events | Bearer | 201 `{event:Event}`、同一再送は200 |
| PATCH | /api/events/:id | Bearer | 200 `{event:Event}` |
| GET | /health | 不要 | 200 生存確認。DB内容は返さない |

Eventは`{id,title,date,open,version,created_at,updated_at}`。updatedByは公開しない。イベントGET一覧は初期運用上限100件とし、超過前にカーソル化する。

質問POST例：

```json
{"eventId":"oc-2026-summer","category":"大学生活","body":"食堂は見学中にも利用できますか？","source":"instagram","requestId":"550e8400-e29b-41d4-a716-446655440000"}
```

処理は入力・Origin・IP検証の後、Firestoreトランザクションで実行する。

1. 決定的なquestionIdを読む。既存ならrequestHash一致で元の受付idを200で返す。不一致は409。本文を応答に含めない。
2. 新規ならevent、rateLimit、eventStatsを読む。すべての読取を先に済ませる。
3. event.open、直近600秒の成功投稿数を検査する。5件なら429。閉鎖なら409。
4. sequenceを採番し、質問create・rateLimit更新・eventStats更新をまとめてコミットする。
5. コミット確認後に201。失敗したトランザクションでは質問・カウンター・集計のいずれも更新しない。

競合時はSDKが再実行しうるため、コールバック内でメール送信・外部API・UI応答などの副作用を起こさない。評価時刻は試行ごとにサーバーで採り、createdAtとdayJstを同じ値から計算する。ホスト時計差があるため10分境界の精度は実環境で検証する。[トランザクション仕様](https://firebase.google.com/docs/firestore/manage-data/transactions)。

応答喪失時は同じrequestId・同じ内容で再試行する。複数インスタンスに同時到達しても、同じ質問キーは1件だけ作成され、集計・制限枠も1回だけ更新される。この保証は同じキーが保持されている期間に限定し、別requestId・DB復元後の失われた記録まで「exactly once」と呼ばない。結果確認不能なら503 SUBMISSION_UNCERTAINを返し、UIは内容とキーを保持する。再送により重複枠を消費しないが、再送リクエスト自体への負荷防御は別に行う。

イベント作成は`{title,date,open,requestId}`。更新は`{title?,date?,open?,version}`。更新トランザクションで現versionと一致しなければ409 VERSION_CONFLICT。一致すればversion加算と監査を同時保存する。更新応答が失われたらGETで状態・versionを確認してから次操作を行う。イベント閉鎖と投稿は同じeventを参照するため、直列化された順序に従う。閉鎖コミット後の新規投稿は拒否し、閉鎖前に成立した投稿と既存投稿の再送確認は許容する。

### 管理一覧・集計

初回：`GET /api/admin?event=<id>&pageSize=50`。次ページ：`GET /api/admin?event=<id>&pageSize=50&cursor=<opaque>`。page番号・offsetは使わない。

```json
{
  "total":42,"pageSize":50,"hasNext":false,"nextCursor":null,
  "generatedAt":1789610000000,
  "categories":[{"category":"大学生活","count":42}],
  "sources":[{"source":"web","count":42}],
  "days":[{"day":"2026-09-17","count":42}],
  "rows":[{"id":"example-id","body":"質問本文","category":"大学生活","source":"web","created_at":1789610000000}]
}
```

初回にeventStatsを読み、そのlastSequenceをwatermarkとして質問をsequence降順に51件取得する。返すのは50件、51件目の有無でhasNextを決める。質問は投稿後不変とし、新規追記はwatermarkより大きいため混入しない。

カーソルはeventId、watermark、lastSequence、取得時の集計値、dataVersion、発行・失効時刻を含む署名付きデータ（本文なし、10分有効）。次ページでは`startAfter(lastSequence)`を使う。毎回認可し、eventと署名・dataVersionを検証する。サイズ上限を設ける。初回の集計を引き継ぐのでページ間で総数が変わらない。[Firestoreカーソル](https://firebase.google.com/docs/firestore/query-data/query-cursors)。

「前へ」はクライアントのカーソル履歴を使う。任意ページへの直接ジャンプは提供しない。「最新」は履歴・集計・watermarkを初期化。期限切れや保守によるdataVersion変更は409 CURSOR_EXPIREDで更新する。本文削除等の保守は受付停止中にdataVersionを先に加算し、既存カーソルを無効化する。

エラーは`{error:{code,message,traceId,retryAfterSeconds?}}`。

| HTTP | code例 | UI |
|---|---|---|
| 400 | VALIDATION_ERROR / INVALID_CURSOR | 入力修正・一覧再読込 |
| 401 / 403 | UNAUTHENTICATED / FORBIDDEN | 再ログイン／権限なし |
| 404 | EVENT_NOT_FOUND | イベント再選択 |
| 409 | EVENT_CLOSED / REQUEST_CONFLICT / VERSION_CONFLICT / CURSOR_EXPIRED | 原因に合わせて閉鎖・競合・再読込 |
| 413 / 415 | PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | 入力形式エラー |
| 429 | RATE_LIMITED | Retry-Afterに従って待つ |
| 503 | STORAGE_UNAVAILABLE / SUBMISSION_UNCERTAIN | 入力保持、同じキーで再確認 |

Firestoreの競合再試行上限・利用制限超過・通信障害は503として扱い、利用者の5件制限と区別する。

## 7. 認証・認可・通信

GISの公式ボタンでIDトークンを受け取り、メモリにのみ保持する。ページ再読込時は再ログイン。localStorage・sessionStorageを初期版では使わない。ログアウト時はトークン、質問、集計、進行中fetchを破棄し、GISの自動選択を無効化する。発行済みJWT自体の即時失効ではないため、漏洩時は許可subの削除と新設定の全トラフィックへの反映で遮断する。

サーバーは`verifyIdToken({idToken,audience:GOOGLE_CLIENT_ID})`で署名・aud・iss・expを検証し、email_verifiedと許可subを照合する。ドメイン制限を追加する場合はメール末尾ではなくhdを検証する。Google以外が管理するメールの所有確認をGoogleログインだけで保証しない。[Google公式の検証要件](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)。

各管理APIで毎回認可する。Googleの公開鍵はライブラリのキャッシュを活用し、API呼出しごとにGoogleへ問い合わせる設計にしない。認証失敗は401、正常なGoogleアカウントだが未許可なら403。期限切れによるイベント保存失敗時は入力内容を残し、再認証後に利用者が保存し直す。

CORSは完全一致のOrigin許可リスト、`Vary: Origin`、GET/POST/PATCH/OPTIONS、Content-Type/Authorizationを許可し、Retry-Afterを公開する。OPTIONSはログイン要求前に処理する。Originにはパスを含めない。GitHubプロジェクトPagesが`https://owner.github.io/MGA/`でもOriginは`https://owner.github.io`。別リポジトリが同一Originになる点を理解し、独自ドメインは分離要件がある場合に検討する。

CORSはブラウザー制御であり、外部スクリプトの直接POSTや不正投稿を止める認証ではない。JSONのみを受け、Origin不一致のブラウザー書込みを拒否しても、レート制限の代用にはならない。

## 8. レート制限・集計・費用

同一の正規化IPから求めたHMACをFirestore上で共有し、直近600秒の成功投稿を5件まで許可する。全インスタンスとリビジョンで同じ鍵・keyVersionを使い、IP抽出・正規化方式も揃える。鍵更新時は受付を一時停止して旧窓600秒の経過を待ってから切替えるか、旧新両キーを原子的に評価する移行を別途実装する。

生IPをDBやアプリログに保存しない。TTLは削除が非同期なので、期限到来だけで実データ削除済みとはみなさない。カウンター判定はacceptedAtと現在時刻で行い、物理削除の遅延に依存しない。TTL削除は課金対象。[TTL仕様](https://firebase.google.com/docs/firestore/ttl)。

共有Wi-Fi・携帯NATでは複数人が同じIPになる。5件/10分は仮値として現地で誤拒否を測定する。IPを変えた投稿やbot全般の防止まで保証するものではない。P1で偽装X-Forwarded-For、複数段ヘッダー、IPv4/IPv6、欠落値を検証し、信頼するプロキシ境界を文書化する。左端固定やtrust proxy=trueの無条件指定を避ける。[Express公式](https://expressjs.com/en/guide/behind-proxies/)。

Firestore障害時にメモリ制限へ切り替えて投稿を通さず503を返す。メモリキャッシュは公開イベントGETの15秒TTLなど、整合性が不要な処理にだけ利用する。管理画面は手動更新を基本とし、認可結果・質問データを共有公開キャッシュへ入れない。

集計は投稿1回につき1ドキュメントを更新する。通常の管理読取はeventStatsと質問51件以下で済み、全件スキャンやカテゴリごとの毎回countは不要。集計の修復時だけ質問を走査する。単一eventStatsへの競合がボトルネックになる場合は計測後に分散カウンターを設計し、初期版から無根拠に高スループットを保証しない。

Cloud Run候補：リクエスト課金、min=0、max=3、1 vCPU、512MiB、concurrency=8。負荷・競合・コールドスタートを測定して調整する。maxは厳密な費用上限ではない。質問を永続化する前に受付成功を返すことや、メモリキューに預けて応答する実装は禁止。

Firestore Standardの無料枠は対象DBで保存1GiB、読取50,000件/日、書込20,000件/日、削除20,000件/日、外向き転送10GiB/月。無料DBはプロジェクトごとに1つで、日次枠のリセットは太平洋時間基準。TTL削除・PITR・バックアップ・復元は無料枠に含まれず、インデックスエントリ読取もクエリにより課金される。[Firestore料金](https://firebase.google.com/docs/firestore/pricing)。

概算：新規投稿は質問の存在確認・event・rateLimit・eventStatsの約4読取＋3書込。1,000投稿で約4,000読取＋3,000書込が下限目安。初回管理表示1,000回は最大約52,000ドキュメント読取。後続カーソルの版確認、再試行、公開イベント取得、監査、インデックス、TTL、バックアップ等は別途加える。日次の集中で無料枠を超える可能性があるため、月間平均だけで見積もらない。

Cloud RunのCPU・メモリ・リクエスト、Firestore、通信、Artifact Registry、ビルド、ログ、秘密情報保管を合算する。予算通知は月500円を仮案に50/90/100%と予測超過を設定する。費用上限の合意ではない。依存サービスのエラー率、トランザクション再試行率、APIレイテンシ、DB読書込数を監視し、公開投稿の緊急停止手順を整備する。Pagesにも利用制限がある。[GitHub Pages制限](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。

再調整の目安：通常ピークで再試行上限による503が発生、1万件時の管理p95が2秒超、共有Wi-Fiで誤拒否、予算超過予測。インデックス・競合・アクセス頻度を診断し、まず同じ三サービス内で改善する。

## 9. 画面遷移と静的化

来場者：`/{basePath}/?event=<id>&from=instagram` → イベント読込 → フォーム → 入力検証 → 送信中 → 受付完了。閉鎖イベントは直接リンクでも「受付終了」を表示する。無効IDは勝手に別イベントへ投稿させず再選択を案内する。ネットワーク障害・429時は入力を残す。

運営：`/{basePath}/admin/` → Googleボタン → トークン取得 → `/api/admin/me` → 許可済みならダッシュボード → 全イベント一覧 → 集計・質問 → 作成／編集 → 保存後再取得。401は再ログイン、403は権限なし画面、GIS読込失敗は再試行案内。Instagram内ブラウザーではログイン制約を確認し、必要ならSafari/Chromeで開く案内を出す。

既存の色・タイポグラフィ・余白・メーター・フォーム・アニメーションを維持する。データ取得待ち、受付終了、エラー、0件でもレイアウトを保つ。既存の日別表示はリストであり、本格的なグラフ化は移行後の改善として分離する。

設定案：

```ts
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
};
export default nextConfig;
```

app/api、force-dynamic、cookiesを使う認証、middlewareを静的アプリの実行経路から外す。標準Next.jsで`out/index.html`と`out/admin/index.html`を生成する。静的エクスポートでは実行時サーバー機能を使用できない。[Next.js公式仕様](https://nextjs.org/docs/app/guides/static-exports)。

`href="/"`、管理画面リンク、画像、募集URLの`location.origin+'/'`をすべて確認し、`/MGA/`等のパスを共通関数で付与する。クエリ変更はURLSearchParamsで既存のfromを保持する。API URLにはPagesのbasePathを付けない。

NEXT_PUBLIC_API_BASE_URL、NEXT_PUBLIC_GOOGLE_CLIENT_ID、NEXT_PUBLIC_BASE_PATHは公開されるビルド時値。秘密を入れない。サーバー専用はGOOGLE_CLOUD_PROJECT、FIRESTORE_DATABASE_ID、GOOGLE_CLIENT_ID、ADMIN_IDENTITIES、ALLOWED_ORIGINS、RATE_LIMIT_SECRET、CURSOR_SECRET。ステージングと本番でGoogle Cloudプロジェクト・Firestore DB・OAuth設定・実行IDを分離する。

PagesでmiddlewareのHTTPヘッダーは実行されない。CSPは対応可能なmeta設定を検討し、GIS・接続先・Next.jsの生成スクリプトと照合する。任意のレスポンスヘッダーが必須ならホスティング条件を見直す。管理データはAPIでCache-Control: no-storeとし、永続ブラウザーキャッシュやService Workerに保存しない。

## 10. 実装ロードマップ

開発者1人＋大学／運営責任者の設定協力を前提に、**19人日（実作業17日＋予備2日）＋設定待ち**を基準とする。旧案17人日から、トランザクション・インデックス・Emulator・復旧確認を追加して再見積りした。暦日は着手日・祝日・学内手続きを確認して確定する。

| 工程 | 工数 | 依存 | 作業・成果物 | 完了条件 |
|---|---:|---|---|---|
| P0 要件・現行確定 | 1日 | なし | 正本、既存本番、データ、費用・負荷・保管要件、画面基準 | 移行範囲・Google Cloud所有者を記録 |
| P1 基盤・技術検証 | 2日 | P0 | Firestore作成、ADC/IAM、Rules全拒否、GIS、IP偽装、静的化 | Cloud Runだけが読書込でき、最小の投稿・管理閲覧が成立 |
| P2 契約・データ | 2日 | P1 | OpenAPI、スキーマ、indexes、Emulator、移行dry-run | 型・検索・冪等キー・旧データ対応を固定 |
| P3 公開API | 2日 | P2 | 質問・制限・集計の原子的保存、再送、閉鎖判定 | 同時同一キー1件、全インスタンスで6件目拒否、障害時部分保存なし |
| P4 管理API | 2日 | P3 | sub認可、集計、カーソル、version、監査 | 無権限漏洩なし、編集競合409、一覧安定 |
| P5 静的UI | 3日 | P4 | GIS、API共通化、カーソル履歴、再送キー、Pagesパス | 標準next build、直アクセス、既存デザイン・スマホ操作 |
| P6 CI/CD・観測 | 1日 | P5 | WIF、indexes/Rules反映、環境分離、通知 | 本番インデックスReady、同一コミットの成果物を追跡 |
| P7 総合・負荷試験 | 2日 | P6 | Emulator＋実環境、複数インスタンス、競合、費用計測 | 必須試験合格。誤拒否率と性能を確認 |
| P8 移行・復旧・公開 | 2日 | P7 | D1直接移行、集計再構築、バックアップ復元、URL切替 | 件数・ハッシュ・集計一致、復旧可能、実投稿確認 |
| 予備 | 2日 | 各工程 | 学内制約・認証・ビルドの修正 | 未解決の重大問題なし |

PRは上記工程単位で分け、実装と検証・戻し方を同時にレビューする。P0/P1で動作前提を確定してから全面移行する。

運営責任者はGCPの所有・請求先、Googleアカウント、管理者sub、DB所在地、GitHub公開範囲、保管期間・許容損失を決める。実装担当は値の例と確認手順を用意し、機密値を設計書に記載しない。

## 11. CI/CDと公開順序

PRでFirestore Emulatorを使うトランザクション・Rules試験、APIテスト・型チェック・lint・標準Next.jsの静的ビルド・成果物への秘密／質問混入チェックを実行する。ビルドとデプロイを分離し、動作確認済みのコミットとイメージdigestを記録する。

Firestore DB・IAM・Rules・インデックスを先行反映しReadyを確認→Cloud Run公開→ステージングAPI検証→Pagesを正しいAPI URLでビルド→ステージング画面検証→本番データ移行→本番公開の順。APIの追加変更を先行し、古いHTMLがキャッシュされても壊れない互換期間を設ける。

Pagesは公式のupload-pages-artifact/deploy-pages等を使い、contents:read、pages:write、id-token:writeを用途に応じて付与する。Cloud RunのWIF信頼は対象リポジトリ・ブランチ／Environmentを限定する。旧Cloudflareワークフローとの二重公開を防ぐ。初回切替後、mainの検証成功時の自動公開を有効化する。

## 12. 本番公開の必須試験

| 領域 | シナリオ・合格条件 |
|---|---|
| 入力 | 4/5/500/501文字、空白、絵文字、改行、不正カテゴリ、8KiB超、非JSON |
| 冪等性 | 同一キーを複数インスタンスから並行送信し、質問・集計・制限消費が各1回。別内容は409 |
| 原子性 | DB通信断、競合、再試行上限、コミット後応答喪失。部分更新なし、同じキーで復旧 |
| 連投制限 | 同じIPで新規キー6件を並行送信して5件のみ成功。再起動後も保持、600秒境界、TTL未削除 |
| IP | 左端偽装、複数ヘッダー、IPv4/IPv6正規化、共有Wi-Fi、鍵更新の窓 |
| 認証 | 期限切れ、偽署名、別aud、未許可sub、未検証メール、ログアウト。本文漏洩なし |
| DBアクセス | Web SDK/RESTの一般資格で拒否、実行IDは許可、無権限サービスIDは拒否。実IAMも確認 |
| イベント | 閉鎖と投稿の競合、無効ID、同versionでの同時編集は片方409、作成再送 |
| 集計 | JST境界、全件・カテゴリ・source一致、直近30投稿日、修復前後の一致 |
| ページング | 0/50/51件、同時追記、改ざんカーソル、別event、期限切れ、削除時失効、前へ戻る |
| 画面・配信 | iPhone/Android/PC/Instagram内ブラウザー、キーボード、通信断時本文保持、basePath・from保持 |
| 性能 | 1万件・運営5人・異なるIPの投稿20件/分×10分で投稿p95≦3秒、温状態管理p95≦2秒 |
| 集中負荷 | 異なるIPで60投稿/分、max=3で試験。DB競合・読書込・費用・503率を記録して調整 |
| インデックス | 実ステージングで検索成功。未構築時に適切なエラーと運用検知 |
| 復旧 | 別DBへバックアップ復元、集計・インデックス照合、API/Pages前版、新規投稿の保全 |

性能値は未計測の目標。Emulatorは本番IAM・インデックス要件・競合性能・料金を再現する検証環境ではないため、実Firestore試験を省略しない。コールドスタートと通常状態は分けて測る。

## 13. データ移行・バックアップ・ロールバック

1. 実本番を確認してD1等の現行DBを保護バックアップ。取得時刻・件数・ハッシュを記録する。
2. D1から直接Firestoreへdry-run。旧id・event_id・created_atをdocument ID・eventId・Timestampへ変換する。新規ID形式との衝突を検査する。
3. イベントごとに旧created_at・旧idの昇順でsequenceを決定し、eventStatsを再構築する。再実行で採番が変わらないよう入力スナップショットと対応表を固定する。
4. パスワードハッシュ・セッション・旧一時制限キーは新DBへ移さない。旧status・answer・auditは保護アーカイブに保全し、有効なデータの継承範囲をP0で確定する。
5. 移行はメンテナンス中にID付きcreateを使い、既存内容一致はスキップ、不一致は停止。巨大な単一トランザクションにせず、分割・チェックポイント・再実行可能なスクリプトにする。
6. 旧環境の受付停止→最終コピー→イベント別件数・本文ハッシュ・カテゴリ/source・sequence最大値・集計を照合→新API/Pages公開。二重書込みは行わない。
7. 管理ログインと試験投稿を確認し、QR・Instagramリンクを切り替える。24〜48時間はエラー、競合、費用、問い合わせを確認する。

停止目標30分以内はリハーサルで確認する。既存URLから転送できない場合は新URLを告知する。

Firestoreのマネージド日次バックアップを本番で設定し、保管7日を初期案とする。料金と保存期間はP0で確定する。必要ならPITRを追加検討する。これらはFirestoreの運用機能として扱い、実行時のアプリ構成を増やさない。バックアップはDBデータの復旧用であり、IAM・Rules・TTL設定・インデックス等の再適用手順も別に管理する。[バックアップと復元](https://firebase.google.com/docs/firestore/backups)。

復元は別DBへ行い、データ・集計・アクセス権・必要インデックスを確認してから接続先を切り替える。四半期に1回演習する。日次バックアップだけなら最大約1日分を失う可能性があるため、開催中の許容損失と照合し、必要ならPITRを有効化する。

戻す場合は新環境を受付停止し、移行後の投稿を保護コピーしてからAPI/Pagesの前版へ復帰する。Firestore版の前リビジョンへの復帰を優先し、旧D1へ戻す場合は移行後データも変換・照合してから再開する。古いDBだけへ戻して新規投稿を失わない。

本文はイベント終了90日後削除という案を責任者が確定する。質問本文の削除はレート制限用TTLと分離し、受付停止・dataVersion更新・質問削除・照合を行う管理スクリプトで実施する。匿名集計を残す場合は「累計投稿数」と「閲覧可能な質問数」を区別し、本文一覧のページ数に累計を使わない。バックアップ内の本文も保管期限に従って消える設計とし、削除済み情報を復元した際は再削除する。

## 14. 着手時に確定する項目

- 公開元リポジトリと正本、PagesのbasePath、現行本番URLと保存先。
- Firestoreのリージョン、プロジェクト・DB ID、実行ID・デプロイID・復旧担当者。
- 月額許容額、来場者・集中投稿数、共有Wi-FiでのIP制限値。
- Google管理者sub、許可追加・削除、鍵更新の手順。
- 本文・監査・バックアップの保管期間、許容停止時間、許容損失、公開日。

最初の成果物は、**静的画面→Cloud Run→Firestoreへの冪等な質問保存→GIS認証済み管理画面で閲覧**の縦通しとする。Google Sheetsに依存する実装や設定を追加せず、この構成で検証・移行を進める。

## 15. 手作業セッティングの実行タイミングと手順

GitHub Pages＋Cloud Run＋Cloud Firestore の運用に必要な設定作業は、一度にまとめて行うのではなく、ロードマップの進行に合わせて**3つの主要なタイミング**に分けて実施する。

| タイミング | ロードマップ工程 | 主な目的 | 主な手作業内容 |
|---|---|---|---|
| **① 初期基盤セッティング** | **P1（基盤・技術検証）** | 疎通確認・開発環境の確保 | GCPプロジェクト作成、Firestore作成、OAuthクライアントID発行、IAM設定 |
| **② 自動化セッティング** | **P6（CI/CD・観測）** | GitHub連携・自動デプロイ化 | GitHub Pages有効化、Workload Identity Federation (WIF)、GitHub Secrets設定 |
| **③ 本番切替セッティング** | **P8（移行・復旧・公開）** | リリース・データ移行 | 既存DB停止、移行スクリプト実行、管理者sub登録、公開URL切替 |

---

### タイミング①：P1（基盤・技術検証）で実行する手作業
**【実行時期：P0要件確定後／クラウド疎通確認時】**

コードを本格的に稼働させる前に、「Cloud Run ⇔ Firestore ⇔ Googleログイン」が実環境で疎通することを検証するための手作業。

1. **Google Cloud プロジェクト・請求設定**
   - Google Cloud コンソールで新規プロジェクトを作成（例: `meigaku-question-box`）。
   - 請求先アカウント（クレジットカード等）を紐付け。
   - 予期せぬ課金を防ぐため、予算アラート（月額500円・通知先メール設定）を作成。
2. **必要な API の有効化**
   - Cloud Consoleの「APIとサービス」から以下のAPIを有効化：
     - `run.googleapis.com` (Cloud Run API)
     - `cloudbuild.googleapis.com` (Cloud Build API)
     - `firebaserules.googleapis.com` (Firebase Rules API)
     - `firebase.googleapis.com` (Firebase API)
     - `firestore.googleapis.com` (Cloud Firestore API)
     - `artifactregistry.googleapis.com` (Artifact Registry API)
     - `iamcredentials.googleapis.com` (IAM Service Account Credentials API)
3. **Cloud Firestore の初期作成**
   - 「Firestore」メニューから「データベースの作成」を選択。
   - データベースモード：**Native mode（ネイティブモード）** を選択。
   - ロケーション：**東京リージョン (`asia-northeast1`)** を選択。
   - データベースID：`(default)` を使用。
4. **Google Identity Services (GIS) の OAuth クライアント ID 作成**
   - 「APIとサービス」>「認証情報」>「認証情報を作成」>「OAuth クライアント ID」を選択。
   - アプリケーションの種類：**ウェブ アプリケーション**。
   - 名前：`meigaku-question-box-web`。
   - **承認済みの JavaScript 生成元** に以下を追加：
     - ローカル開発用: `http://localhost:3000`
     - GitHub Pages用（予定）: `https://<owner>.github.io`
   - 発行された **クライアント ID**（`xxxx.apps.googleusercontent.com`）を控える。
5. **Cloud Run 実行用サービスアカウントの作成と IAM 権限付与**
   - 「IAM と管理」>「サービス アカウント」から作成（例: `meigaku-api-runner`）。
   - 権限（ロール）：**`roles/datastore.user` (Cloud Datastore ユーザー)** を付与。
   - ※不要な権限（Owner/Editor）は絶対に付与しない。

---

### タイミング②：P6（CI/CD・観測）で実行する手作業
**【実行時期：API実装・UI実装（P2〜P5）が完了した後】**

手動デプロイを廃止し、GitHub への push で GitHub Pages と Cloud Run が自動で安全にビルド・反映されるパイプラインを整備する手作業。

1. **GitHub Pages の設定（GitHub リポジトリ側）**
   - GitHubリポジトリの `Settings` > `Pages` を開く。
   - **Build and deployment** の Source を **「GitHub Actions」** に変更。
2. **Workload Identity Federation (WIF) の構築（Google Cloud 側）**
   - サービスアカウントキー（JSON秘密鍵）を発行せず、GitHub ActionsのOIDCトークンで認証するための設定。
   - Workload Identity プール（例: `github-actions-pool`）とプロバイダ（例: `github-provider`）を作成。
   - 発行者URL（Issuer）: `https://token.actions.githubusercontent.com`。
   - 属性マッピング: `google.subject=assertion.sub`, `attribute.repository=assertion.repository`。
   - 対象リポジトリ（`MG-Ambassador/meigaku-question-box`）のみを許可する属性条件を設定。
3. **デプロイ用サービスアカウントの作成と IAM 付与**
   - デプロイ用サービスアカウント（例: `github-deployer`）を作成。
   - 権限付与：
     - Cloud Run 管理者 (`roles/run.admin`)
     - サービス アカウント ユーザー (`roles/iam.serviceAccountUser`)（実行用アカウントに対する権限）
     - Cloud Run ソース デベロッパー (`roles/run.sourceDeveloper`)（`--source` のビルド・ソース転送）
     - Service Usage Consumer (`roles/serviceusage.serviceUsageConsumer`)（APIの有効状態確認・利用）
     - Firebase Rules 管理者 (`roles/firebaserules.admin`)
     - Cloud Datastore Index 管理者 (`roles/datastore.indexAdmin`)
     - Firebase 閲覧者 (`roles/firebase.viewer`)（Firebase CLIのプロジェクト・DB情報確認）
   - ビルド用アカウントには `roles/run.builder` を付与。`gcloud builds get-default-service-account` で実際のIDを確認し、デプロイ用アカウントにそのIDへの `roles/iam.serviceAccountUser` も付与。実行用アカウントとビルド用アカウントは別に扱う。
   - WIFプロバイダからこのサービスアカウントへの偽装権限（`roles/iam.workloadIdentityUser`）をバインド。
   - 既存アカウントの権限設定は、プロジェクトのIAM変更・API有効化権限を持つ管理者で次を実行（GitHub Actions内では実行しない）。スクリプトは既存の権限を削除せず追加し、WIF設定と実行用アカウントのDB権限は変更しない。

     ```bash
     gcloud auth login
     bash scripts/setup-cloud-run-iam.sh meigaku-question-box
     ```

   - 2026-09-25の失敗ログではWIF認証後、Firestoreの `serviceusage.services.get` 相当の確認で403、Cloud Runで `PERMISSION_DENIED` が発生。Cloud Runログだけでは不足権限を一意に特定できないため、上記のソースデプロイに必要な権限一式を確認する。Firestoreの失敗もCIを停止させるようにし、無視してAPIを公開しない。
   - IAM反映後、修正をmainへ反映して `Deploy Cloud Run API` を再実行し、Firestoreデプロイ・Cloud Runビルド・Health Checkの成功を確認する。
   - 参考：[Cloud Runソースデプロイの必要権限](https://docs.cloud.google.com/run/docs/deploying-source-code)、[FirebaseのIAM権限](https://firebase.google.com/docs/projects/iam/permissions)。
4. **GitHub Secrets / Variables の登録（GitHub リポジトリ側）**
   - `Settings` > `Secrets and variables` > `Actions` に以下を登録：
     - **Variables (環境変数)**:
       - `GCP_PROJECT_ID`: Google Cloud プロジェクトID
       - `WIF_PROVIDER`: Workload Identity プロバイダのリソース名
       - `WIF_SERVICE_ACCOUNT`: デプロイ用サービスアカウントのメールアドレス
       - `NEXT_PUBLIC_BASE_PATH`: GitHub Pagesのベースパス（例: `/meigaku-question-box`）
       - `NEXT_PUBLIC_API_BASE_URL`: Cloud Run の本番サービスURL
       - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: GIS OAuth クライアントID
     - **Secrets (機密情報)**:
       - `RATE_LIMIT_SECRET`: IPのHMACハッシュ化用ランダム文字列
       - `CURSOR_SECRET`: ページネーションカーソル署名用ランダム文字列
       - `ADMIN_IDENTITIES`: 運営許可ユーザーのJSON配列（sub, email, displayName）
5. **Firestore インデックス・Security Rules・日次バックアップの有効化**
   - リポジトリの `firestore.rules` と `firestore.indexes.json` をデプロイ。
   - GCPコンソールまたはgcloud CLIでFirestoreのマネージド日次バックアップスケジュール（保管期間7日）を有効化。

---

### タイミング③：P8（移行・復旧・公開）で実行する手作業
**【実行時期：総合テスト（P7）合格後、リリース当日】**

1. **現行環境（D1等）の受付停止**
   - 既存フォームをメンテナンス画面に切り替え、データ更新を遮断。
2. **データ移行スクリプトの実行**
   - 作業環境から移行スクリプト（`scripts/migrate-to-firestore.mjs`）を実行。
   - D1からFirestoreへデータをコピーし、イベント別件数・本文ハッシュ・集計の一致を照合。
3. **管理者許可リストの最終確認**
   - 運営メンバーの Google アカウント `sub` が正しく Cloud Run の `ADMIN_IDENTITIES` に反映されているか確認。
4. **公開URL・QRコード・リンクの切替**
   - Instagram のプロフィールのリンク（Linktree等）や当日配布用QRコードの遷移先を、新しい GitHub Pages の公開 URL に切り替え。

---

## 16. 現在の実装状況と引き継ぎ内容

### 16.1 ステータスサマリー（2026-09-25 更新）

- **進捗フェーズ**: **P1（最小の縦通し）、P2（契約・データ移行）、P6（CI/CDパイプライン実装）が完了し、本番環境への自動デプロイ・公開に成功**。
- **公開・稼働状況**:
  - **フロントエンド（GitHub Pages）**: [https://mg-ambassador.github.io/meigaku-question-box/](https://mg-ambassador.github.io/meigaku-question-box/) （HTTP 200 OK 配信中）
  - **バックエンド（Cloud Run）**: [https://meigaku-api-t7owyiakeq-an.a.run.app](https://meigaku-api-t7owyiakeq-an.a.run.app) （`/health` エンドポイントで 200 OK 応答中）
  - **データベース（Cloud Firestore）**: Native mode (asia-northeast1)、Security Rules & Indexes 反映済み。
- **検証済み事項**: 
  - CI パイプラインシミュレーション: ローカル環境で全CIステップ（`npm run test:server` 20件パス、`npm run migrate:dry-run` 整合性照合パス、`npm run build` 静的エクスポートパス）が 100% 成功。
  - Workload Identity Federation (WIF): GitHub Actions からのキーレス認証が正常動作。
  - Cloud Run 自動デプロイ: `env.yaml` 経由による安全な環境変数注入、コンテナビルド、デプロイ、ヘルスチェック疎通に成功。
  - GitHub Pages 自動デプロイ: Next.js 16 静的エクスポート（HTML/CSS/JS）のビルド・公開に成功。

---

### 16.2 実装済みコンポーネント一覧

```text
meigaku-question-box/
├── .github/workflows/
│   ├── ci.yml                        # [実装済] PR・push時テスト＆ビルド検証（サーバーテスト、移行dry-run、静的出力確認）
│   ├── deploy-cloud-run.yml          # [実装済] Cloud Run 自動ビルド・デプロイ（WIF認証、Rules/Indexes反映、ヘルスチェック）
│   └── deploy-pages.yml              # [実装済] GitHub Pages 自動デプロイ（configure-pages、静的ビルド、アップロード）
├── firebase.json                     # [実装済] Firebase CLI 用設定ファイル（rules / indexes デプロイ用）
├── contracts/
│   └── openapi.yaml                  # [実装済] OpenAPI 3.1 仕様書（公開・管理API、スキーマ、Bearer認証、エラー体系）
├── app/
│   ├── page.tsx                      # [実装済] 来場者向け質問投稿画面（Cloud Run API連携、requestId冪等性、basePath対応）
│   ├── admin/
│   │   ├── page.tsx                  # [実装済] 管理画面認証ゲート（GIS Googleログイン、トークン検証、403画面）
│   │   ├── panel.tsx                 # [実装済] 管理ダッシュボード（集計メーター、署名付きカーソル質問一覧、イベント編集モーダル）
│   │   └── layout.tsx                # [実装済] 管理画面用レイアウト（basePath対応リンク）
│   └── (旧 app/api/*, operators)     # [撤去済] Cloudflare D1依存コードを削除し legacy/ に退避
├── components/
│   ├── google-login.tsx              # [実装済] Google Identity Services (GIS) 公式ボタンコンポーネント
│   └── ui/*                          # [実装済] 既存デザインシステム（ボタン、モーダル、バッジ、カード等）
├── lib/
│   ├── api-client.ts                 # [実装済] Cloud Run API クライアント（Bearerトークン管理、エラーハンドリング、再送）
│   └── public-url.ts                 # [実装済] GitHub Pages の basePath を考慮した安全なパス解決
├── server/                           # [実装済] Cloud Run 用 Express バックエンド
│   ├── src/
│   │   ├── app.ts / index.ts         # [実装済] Express設定、CORS（Origin制限）、エラーミドルウェア、ヘルスチェック
│   │   ├── auth.ts                   # [実装済] Google IDトークン検証 (google-auth-library) ＆ ADMIN_IDENTITIES sub認可
│   │   ├── firestore.ts              # [実装済] Firestore SDK初期化、ADC接続
│   │   ├── questions.ts              # [実装済] トランザクションによる質問冪等保存・集計(eventStats)・制限同時更新
│   │   ├── events.ts                 # [実装済] イベント取得・作成・更新（version楽観的ロック）
│   │   ├── rate-limit.ts             # [実装済] クライアントIP HMACハッシュ化 ＆ 600秒5件レート制限
│   │   ├── report.ts                 # [実装済] 集計ドキュメント読取、HMAC署名付きカーソル（初回収集スナップショット保持）
│   │   └── types.ts                  # [実装済] APIおよびFirestoreドキュメントの型定義（Zodスキーマ）
│   ├── test/
│   │   ├── app.test.ts               # [実装済] APIサーバー統合テスト（HTTPステータス、CORS、エラーハンドリング）
│   │   ├── questions.test.ts         # [実装済] 質問バリデーション、冪等ID生成、IPハッシュ単体テスト
│   │   └── report.test.ts            # [実装済] カーソルエンコード/デコード、署名検証、期限切れ単体テスト
│   ├── Dockerfile                    # [実装済] Cloud Run 用マルチステージコンテナ定義 (Node.js 22-slim)
│   ├── package.json / tsconfig.json  # [実装済] サーバー依存関係・ビルド設定
│   └── .env.example                  # [実装済] サーバー側環境変数テンプレート
├── scripts/
│   ├── setup-cloud-run-iam.sh        # [実装済] デプロイ用 SA の IAM 権限一括設定スクリプト
│   ├── migrate-to-firestore.mjs      # [実装済] D1 SQLite から Firestore への移行スクリプト（dry-run・execute対応）
│   └── rebuild-event-stats.mjs       # [実装済] Firestore 質問全件走査による eventStats 再構築・修復スクリプト
├── firestore.rules                   # [実装済] Web/Mobile直接アクセスを全拒否（Cloud Run IAM経由のみ許可）
├── firestore.indexes.json            # [実装済] questions/events 用の複合インデックス定義
├── next.config.ts                    # [実装済] output: 'export', trailingSlash, unoptimized images, basePath設定
├── package.json                      # [実装済] Next.js 依存関係、ビルド・テスト・移行用 npm scripts
└── .env.example                      # [実装済] フロントエンド・サーバー共通環境変数テンプレート
```

---

### 16.3 必要な環境変数・シークレット一覧（設定完了済み）

#### フロントエンド（GitHub Pages ビルド時 / Repository Variables）
| 変数名 | 設定状態 | 説明 | 本番設定値 |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | 設定済 | Cloud Run サービスのルートURL | `https://meigaku-api-t7owyiakeq-an.a.run.app` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | 設定済 | Google Identity Services 用 OAuth クライアントID | `374573341438-lijmtaos0ctg9fcngas12ds76r6jesqv.apps.googleusercontent.com` |
| `NEXT_PUBLIC_BASE_PATH` | 設定済 | GitHub Pages のリポジトリパス | `/meigaku-question-box` |

#### バックエンド（Cloud Run 実行時環境変数 / Repository Variables & Secrets）
| 変数名 | 区分 | 設定状態 | 説明 |
|---|---|---|---|
| `GCP_PROJECT_ID` | Variable | 設定済 | `meigaku-question-box` |
| `WIF_PROVIDER` | Variable | 設定済 | `projects/374573341438/locations/global/workloadIdentityPools/github-actions-pool/providers/github-provider` |
| `WIF_SERVICE_ACCOUNT` | Variable | 設定済 | `github-deployer@meigaku-question-box.iam.gserviceaccount.com` |
| `ALLOWED_ORIGINS` | Variable | 設定済 | `https://mg-ambassador.github.io,http://localhost:3000` |
| `ADMIN_IDENTITIES` | Secret | 設定済 | `[{"sub":"111899185133598628994","displayName":"Engineering MGA"}]` |
| `RATE_LIMIT_SECRET` | Secret | 設定済 | IP HMAC ハッシュ用秘密鍵 |
| `CURSOR_SECRET` | Secret | 設定済 | ページネーションカーソル署名用秘密鍵 |

---

### 16.4 次の作業者が実施するべきネクストアクション

1. **【P7 総合テスト・実機検証】**
   - **本番 URL アクセス**: [https://mg-ambassador.github.io/meigaku-question-box/](https://mg-ambassador.github.io/meigaku-question-box/) をブラウザで開く。
   - **管理者ログイン**: `/admin` へアクセスし、Google ログイン（`Engineering MGA` アカウント）で管理画面が開けることを確認。
   - **イベント作成・管理**: 管理画面からテストイベントを作成・ステータス変更できることを確認。
   - **質問投稿テスト**: 一般画面から質問を投稿し、即座に集計・管理画面に反映されることを確認。
   - **連投制限テスト**: 同一端末から短時間に連続投稿し、適切なエラー（レート制限）が表示されることを確認。
2. **【P8 移行・復旧・公開（リリース当日）】**
   - **現行環境停止**: 旧受付フォームの受付を停止。
   - **データ移行実行**: `PROJECT_ID=meigaku-question-box npm run migrate:execute` を実行し、D1 から本番 Firestore へ過去データを移行。
   - **集計整合性検証**: `npm run rebuild:stats` または管理画面で過去イベントの質問数・回答数の一致を確認。
   - **公開リンク切替**: Instagram プロフィール（Linktree 等）や当日用 QR コードの遷移先を新 GitHub Pages URL に切り替え。


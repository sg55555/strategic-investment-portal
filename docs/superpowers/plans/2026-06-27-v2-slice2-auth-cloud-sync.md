# Slice 2「ログイン × 司令室クラウド化」— 実装＆デプロイ手順

- date: 2026-06-27
- project: investment-portal v2（お金の司令室 / Wealth Cockpit）
- 前提: Slice 1（market API化）本番LIVE（main 6ccdd7f）。アーキ仕様 = `docs/superpowers/specs/2026-06-27-wealth-cockpit-v2-architecture.md`
- 本人確定（2026-06-27）: ①認証=**Neon sessions + bcrypt** ②スコープ=**spec full（+目標機能）** ③同期=**自動（ログイン=同期）**

## 完了の定義
バケツ・目標が**複数端末でクラウド同期**される。ログイン時に cloud が真実源、cloud 空なら local を初回push。送信ゼロの放棄はここで初発生（本人合意済）。AI はまだ無し。

## 実装（このブランチ worktree-slice2-auth-sync）
- **DB**: `db/schema_me.sql` = `me` スキーマ（`sessions`=token/expires/label・`mcc_state`=id=1シングルトンJSONB）。market と分離。Neon 適用済（実接続検証 ALL PASS）。
- **認証 API**（Vercel Python zero-config・同一オリジンで CORS無し・`Cache-Control: no-store`）:
  - `api/auth/login.py` POST `{password}` → bcrypt 照合（`AUTH_PASSWORD_HASH`）→ `secrets.token_urlsafe(32)` → `me.sessions`（30日）→ httpOnly/Secure/SameSite=Strict cookie `wc_session`。期限切れ掃除も実施。
  - `api/auth/logout.py` POST → session 削除 + cookie 失効。
  - `api/auth/session.py` GET → 有効判定（常に200・body `{ok}`）。
- **state API**: `api/me/state.py` GET(load)/PUT(save)・認証必須・401でガード。`me.mcc_state(id=1)` に UPSERT。goals は state JSON 内。
- **純関数**: `money-rules.js` v2 = `goals`（資産目標 id/label/targetAmount/deadline）・`totalAssets`・`goalProgress`・migrate(v1→v2 で goals:[] 補完・正規化)。`tests/money-rules.test.js` +7件（計21緑）。
- **ブラウザ層**: `money.js` v2 = クラウド同期（debounced PUT・背景同期はステータス要素だけ差分更新で focus 保護）・login/logout/session・reconcile（cloud真実源/初回push）・目標UI（追加/削除/進捗バー）。`esc()` で XSS 防御、goal id は安全文字限定。
- **CSS**: `money.css` に同期バー・目標カードを追加（既存インディゴ/紫トークン）。
- **依存**: `requirements.txt` に `bcrypt>=4` 追加。
- **index.html は無改造**（全UIは `#mcc-root` に money.js が描画）。

## デプロイ手順（安全シーケンス＝新APIを先に立てる）
1. `node --test tests/money-rules.test.js` 緑 / `ruff check` / py_compile（実施済）。
2. worktree commit → main へ FF merge → push（Vercel 自動デプロイ）。
3. **本番 env を設定**（ログイン可能化）:
   - ローカルで `python scripts/hash_password.py` を実行 → パスワードを2回入力 → `AUTH_PASSWORD_HASH=...` を得る（生PWは保存しない）。
   - Vercel プロジェクト環境変数に `AUTH_PASSWORD_HASH` を設定（Production）。`DATABASE_URL` は Slice1 で設定済。
   - 任意: ローカル `.env` にも同値（ローカル検証用）。
4. **本番 curl 検証**:
   - `GET /api/auth/session` → `{"ok": false}`（未ログイン）。
   - `POST /api/auth/login {"password": "..."}` → 200 + `Set-Cookie: wc_session=...`（誤PWは401）。
   - cookie 付きで `GET /api/me/state` → `{"state": null}`（初回）、`PUT` → `{"ok": true}`、再 `GET` で反映。
   - cookie 無し `GET /api/me/state` → 401。
5. **実機サニティ（太田さん）**: 司令室を開く→「クラウド同期」でログイン→バケツ/目標を入力→別端末（or別ブラウザ）でログイン→同じ値が出る。ログアウトで local のみに戻る。

## ロールバック
auth/me は net-new で既存消費者なし。未ログイン時は従来どおり localStorage のみで動作（degrade 安全）。問題時は env 未設定に戻せばログイン不可になるだけ（市場ビュー・MCC localStorage は無傷）。

## 次（Slice3）
AI規律コーチ（集約値のみ Mode A）。goals が state 内にあるので、必要なら Slice3 で `me.goals` へ正規化。

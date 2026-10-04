# Anh Em IT Badminton

## Kho ảnh (Cloudinary)

Ảnh được lưu trên **Cloudinary** (nguồn gốc). Supabase chỉ lưu metadata trong bảng `photos`
để app lọc, sắp xếp và phân trang. Trình duyệt tải ảnh thẳng từ CDN Cloudinary
(thumbnail và ảnh lightbox đã được Cloudinary thu nhỏ); Vercel không làm proxy ảnh.

```text
Upload trong app : trình duyệt → Cloudinary (chữ ký do server cấp) → /api/photos → Supabase
Upload trên Cloudinary : Cloudinary → webhook /api/cloudinary/webhook → Supabase
Khôi phục khi lỡ webhook : Admin bấm "Đồng bộ" → /api/photos/sync → Supabase
```

Phân quyền: mọi thành viên đăng nhập được xem; chỉ **Admin** được tải ảnh, xóa ảnh và đồng bộ.

### 1. Chạy migration Supabase

Mở Supabase Dashboard → **SQL Editor**, dán và chạy nội dung
`supabase/migrations/010_photos.sql` (tạo bảng `photos`, index và view `photo_folders`).
Migration không được chạy tự động; hãy review trước khi chạy.

### 2. Lấy thông tin Cloudinary

Trong Cloudinary Console → **Settings → API Keys**:

| Biến | Lấy ở đâu |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | "Cloud name" ở đầu trang API Keys (hoặc Dashboard) |
| `CLOUDINARY_API_KEY` | Cột "API Key" |
| `CLOUDINARY_API_SECRET` | Cột "API Secret" (bấm hiện). **Chỉ đặt ở biến môi trường server, không commit, không đưa vào frontend.** |
| `CLOUDINARY_ROOT_FOLDER` | Thư mục chứa kho ảnh, mặc định `badminton` (cũng nhận tên `CLOUDINARY_FAMILY_MOMENTS_FOLDER`) |

Upload preset **không cần**: app dùng signed upload, server ký từng lượt upload bằng API Secret.

### 3. Sắp xếp thư mục trên Cloudinary

Đặt ảnh trong thư mục gốc (mặc định `badminton/`). Mỗi thư mục con thành một danh mục lọc,
tên hiển thị được suy ra tự động, ví dụ:

```text
badminton/2026/week-01        → "Tuần 1 · 2026"
badminton/2026/tournament-01  → "Giải đấu 1 · 2026"
badminton/members             → "Thành viên"
```

Ảnh nằm ngoài thư mục gốc không xuất hiện trong app.

### 4. Cấu hình webhook

Cloudinary Console → **Settings → Webhook Notifications** → **Add Notification URL**:

- URL: `https://<domain-production>/api/cloudinary/webhook`
- Notification types: **Upload**, **Delete**, **Rename**, **Move / asset folder changed**
  (có thể chọn tất cả; loại khác sẽ được bỏ qua an toàn).

Webhook được xác thực bằng chữ ký `X-Cld-Signature` (ký bằng API Secret, hỗ trợ SHA-1 và SHA-256).
Mỗi thông báo chỉ dùng mã ảnh: server đọc lại ảnh từ Cloudinary rồi mới ghi Supabase, nên
thông báo trùng hoặc gửi lại không tạo bản ghi trùng.

### 5. Biến môi trường trên Vercel

Vercel → Project → **Settings → Environment Variables**, thêm 4 biến ở bảng trên cho
Production (và Preview nếu cần), rồi **Redeploy**. Hoặc dùng CLI:

```bash
npx vercel env add CLOUDINARY_CLOUD_NAME production
npx vercel env add CLOUDINARY_API_KEY production
npx vercel env add CLOUDINARY_API_SECRET production
npx vercel env add CLOUDINARY_ROOT_FOLDER production
```

Chạy local: sao chép các biến vào `.env.local` (file này đã nằm trong `.gitignore`).

### 6. Đồng bộ lần đầu

Nếu Cloudinary đã có sẵn ảnh, đăng nhập bằng Admin → **Kho ảnh → Đồng bộ → Đồng bộ ngay**.
Đồng bộ thêm ảnh còn thiếu, cập nhật ảnh thay đổi và ẩn ảnh đã bị xóa trên Cloudinary;
chạy nhiều lần không tạo trùng.

---

## vinext starter (original notes)

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

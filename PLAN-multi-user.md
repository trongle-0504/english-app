# Kế hoạch: đăng nhập + tách dữ liệu theo user + deploy

**Mục tiêu**
- Chỉ người có tài khoản mới vào được app.
- Mỗi người có dữ liệu học riêng.
- Nội dung học (vocabulary, collocation, grammar, blog, essay mẫu, cache tra từ...) dùng chung.
- Người ngoài không chạy được agent (`agy`) trên máy chủ.

**Cách làm**
- Làm tuần tự theo phase. Mỗi phase kết thúc ở trạng thái chạy được.
- Phase 1 xong là có thể deploy an toàn. Các phase sau làm dần.
- Phần git/commit để ở cuối file (Phase 7). Trước đó, an toàn dựa vào **bản sao lưu trước mỗi phase**.

---

## Dành cho agent thực thi (đọc trước khi viết code)

**Phạm vi mỗi lần làm**
- Chỉ làm **một phase** mỗi lần, đúng các mục checklist của phase đó. Không làm trước việc của phase sau, kể cả khi thấy "tiện tay".
- Gặp chỗ plan không khớp với code thật (tên file, số dòng, hành vi): **dừng lại, ghi vào mục "Ghi chú" cuối file và hỏi người dùng**, không tự đoán.
- Xong mục nào đánh dấu `[x]` mục đó. Cuối phase, ghi vào "Nhật ký thực hiện" cuối file: ngày, đã làm gì, lệch gì so với plan, kiểm thử nào đã chạy và kết quả.

**Môi trường**
- Mã nguồn nằm trong WSL (`~/English-App/english-app-v2`). `node_modules` là bản Linux, nên mọi lệnh `npm`, `npx`, `node` phải chạy **trong WSL** (`wsl -d Ubuntu -- bash -lc "cd ~/English-App/english-app-v2 && …"`), không chạy bằng shell Windows.
- Dev server có thể đang tự chạy ở cổng 5173 (`scripts/dev-server.sh`, log ở `logs/dev-server.log`). Đừng khởi động bản thứ hai cùng cổng.
- Không khởi chạy Chrome/Edge/Chromium hay trình duyệt headless. Kiểm thử bằng `curl` và `node --test`.
- AI chỉ qua Antigravity (`agy`). Không thêm Gemini API key hay gọi Claude Code CLI.

**Quy ước code (xem code xung quanh để làm theo)**
- TypeScript chạy thẳng bằng Node ≥ 22.18 (không bước build cho `server/`); import kèm đuôi `.ts`.
- Không thêm thư viện npm mới nếu Node có sẵn (`node:crypto`, `node:async_hooks`, `node:test`). Cookie tự phân tích (header `cookie`), không thêm `cookie-parser`.
- Route khai báo dạng `'METHOD /path': handler` (xem `server/routes/*.ts`), lỗi trả bằng `throw new ApiError(status, message)`.
- Đọc/ghi JSON qua `readJsonFile` / `writeJsonFile` trong `server/files.ts` (đã ghi atomic). Đường dẫn trong `content/` qua `contentFile()` (đã chặn thoát thư mục); `userPath()` mới làm theo đúng mẫu đó.
- Comment ngắn, tiếng Anh, giải thích "vì sao" như code hiện có. Giao diện: Tailwind v4, Radix UI, component trong `src/components/ui`.
- Sau mỗi thay đổi: `npm run typecheck`, `npm run lint`, `npm test` phải sạch.

**Cạm bẫy đã biết**
- `writeTextFile` đặt tên file tạm `${file}.${pid}.tmp`: hai lần ghi **cùng file** trong cùng tiến trình sẽ đè file tạm của nhau. Mọi ghi vào cùng file phải đi qua khóa (`withUserLock` hoặc khóa của `server/auth/store.ts`).
- `crypto.scrypt` với N=2^15, r=8 cần khoảng 32 MB, vượt `maxmem` mặc định: phải truyền `maxmem: 64 * 1024 * 1024`.
- Dev server nạp lại module `server/` mà không khởi động lại tiến trình: state cần sống qua lần nạp lại (bộ đếm rate limit, cache phiên) phải đặt trên `globalThis`, như `antigravity-cli.ts` đang làm.
- `vite.config.ts` nạp `server/` qua `ssrLoadModule`; middleware xác thực dùng cho dev cũng phải nạp theo cách đó, không `import` trực tiếp ở đầu file config (comment trong `apiPlugin` giải thích lý do: rò bộ nhớ).
- Frontend có **17 file** gọi `fetch` trực tiếp: `src/lib/data.ts`, `features/admin/api.ts`, `features/admin/AdminLayout.tsx`, `features/review/api.ts`, `features/essays/api.ts`, `features/grammar/analyze/api.ts`, `features/lookup/WordLookup.tsx`, `features/lookup/ExtraCards.tsx`, `features/report/ExportReport.tsx`, `features/practice/practice-api.ts`, `practice/idea-api.ts`, `practice/DolStatusBanner.tsx`, `practice/lib/pronunciation.ts`, `practice/writing-review/api.ts`, `practice/speaking-review/api.ts`, `practice/listening-simplify/api.ts`, `practice/speaking-ideas/api.ts`. Tất cả cần xử lý 401/403 (Phase 1.6).

---

## Quyết định mặc định (sửa ở đây nếu muốn khác)

| Mục | Quyết định |
|---|---|
| Tạo tài khoản | Admin tạo sẵn (lệnh CLI, sau có thêm trang Admin). Không có đăng ký công khai. |
| Vai trò | `admin` (chủ máy), `learner`. |
| Dữ liệu chung, chỉ admin sửa | `content/vocabulary`, `content/collocations`, `content/grammar/lessons.json` + `topics.json` + `analyze-prompt.md`, `content/blog`, `content/topic-collocations`, `content/schema`, `content/essays`, `content/practice` (đề quiz/writing), `content/speaking/*` (chỉ mục gắn thẻ do Sync tạo), `cache/`, `config/`. |
| Dữ liệu riêng của từng user | Toàn bộ `progress/*`, lịch sử Grammar Analyze, thẻ "My cards" (`content/review/*`), log dùng AI. |
| `content/note/notes.json` | **Đã chốt: chung**, chỉ admin sửa (ghi chú cấu trúc dùng cho mọi người). |
| Thẻ ôn riêng | Learner tạo/nhập/xóa thẻ trong kho riêng. Kho từ chung chỉ admin sửa. |
| Kết quả Grammar Analyze | **Đã chốt: cache dùng chung** theo câu (đỡ gọi AI lại cho câu đã phân tích), **danh sách lịch sử riêng** từng user. |
| Hạn mức AI | Theo ngày cho từng user, admin chỉnh được. Admin không giới hạn. |
| Lưu trữ | File JSON, không dùng database. Chỉ chạy **một** tiến trình server. |

**Ràng buộc môi trường**
- Không khởi chạy Chrome/Edge/Chromium để test. Chỉ dùng `curl` và script Node (`node --test`).
- AI chỉ qua Antigravity (`agy`). Không thêm Gemini API hay Claude Code CLI. File `server/llm/claude-code.ts` hiện vẫn còn; Phase 4 xử lý.

---

## Hiện trạng đã kiểm tra trong code (cơ sở của plan)

| Điểm | Chi tiết | Ảnh hưởng |
|---|---|---|
| Không có user | `ApiContext` (`server/api.ts`) chỉ có `contentDir`, `rootDir`, `onContentChange`; một ctx dùng cho mọi request. | Phase 1–2 |
| `guarded()` đang dùng cho **cả tính năng của learner** | Ngoài `/admin/*`, các route sau cũng `guarded`: `POST /review/custom`, `/review/custom/generate`, `/review/custom/import`, `DELETE /review/custom`, `POST /practice/cards`, `/practice/recent/cards`, `/practice/library-added`, `/practice/mistakes/cards`, và các route ghi của `/admin/essays`. | **Không** được thay `guarded` bằng "chỉ admin" một cách máy móc. Xem bảng phân loại route ở Phase 1. |
| Route admin dạng GET không có bảo vệ | `GET /admin/vocabulary`, `/admin/grammar`, `/admin/notes`, `/admin/blog`, `/admin/essays`, `/admin/session`... | Phase 1: chỉ admin |
| `/data` trong dev do plugin khác phục vụ | `content-pipeline/vite-plugin.ts` gắn `server.middlewares.use('/data', …)`, **không** đi qua `apiPlugin`. | Phase 1 phải chặn cả chỗ này |
| Vite theo dõi toàn bộ thư mục dự án | `vite.config.ts` chỉ bỏ qua `logs/`, `progress/`, `cache/`. | Phase 2: thêm `data/` vào `watch.ignored`, nếu không mỗi lần ghi dữ liệu user sẽ reload trang |
| Job chạy nền giữ trong `Map` toàn cục, tra theo `id` | `speaking/suggest.ts`, `writing-review/service.ts`, `speaking-review/review.ts`, `speaking/analyze-edit.ts` (`jobs.get(id)`). | Phase 2: job phải ghi `userId`, tra job phải kiểm tra chủ sở hữu |
| Hàng đợi AI toàn cục **đã có** | `antigravity-cli.ts` có `slots` trên `globalThis`, tối đa `ANTIGRAVITY_PARALLEL` (mặc định 4) tiến trình trên toàn server. | Phase 4 chỉ thêm giới hạn theo user và trần độ dài hàng đợi |
| Log dùng AI không biết là ai gọi | `server/usage.ts` `recordUsage()` ghi `logs/gemini-usage.jsonl`, không có user. | Phase 2/4: gắn user qua `AsyncLocalStorage` |
| Grammar Analyze gộp request trùng giữa các user | `routes/analyze.ts`: `inFlight` theo nội dung câu; chỉ ghi lịch sử vào ctx của request đầu tiên; sau khi ghi gọi `ctx.onContentChange()` làm build lại `/data`. | Phase 2–3 |
| `content/speaking/index.json` **không phải dữ liệu cá nhân** | Đây là chỉ mục gắn thẻ do Sync (`speaking/sync.ts`) tạo từ kho thẻ ôn; Sync là thao tác của admin. | Giữ chung. Thẻ custom của learner không được gắn thẻ ở giai đoạn đầu (xem Phase 3). |
| Bộ nhớ đệm dữ liệu ở frontend | `src/lib/data.ts` giữ promise theo key trong bộ nhớ. | Phase 1: tải lại trang hoàn toàn sau khi đăng nhập/đăng xuất |
| `readBody` không giới hạn kích thước | `server/api.ts`. | Phase 1 |
| Không có test runner | `package.json` không có script `test`. | Dùng `node --test` có sẵn trong Node 22 |

---

## Cấu trúc thư mục đích

```
data/                           ← mới; nằm ngoài dist/ và content/
  auth/
    users.json                  ← [{id, email, passwordHash, role, disabled, createdAt, quota:{aiPerDay}}]
    sessions.json               ← [{tokenHash, userId, createdAt, expiresAt, lastSeenAt, ip, userAgent}]
    audit.jsonl                 ← đăng nhập thành công/thất bại (Phase 5)
  users/<uid>/                  ← uid ngẫu nhiên, KHÔNG dùng email làm tên thư mục
    progress/                   ← review.json, review-log.jsonl, practice.json, practice-aliases.json,
                                  speaking/, speaking-reviews/ (cả file ghi âm), writing-reviews/, listening/
    review/                     ← thẻ "My cards" (trước đây content/review/*.json|.md)
    grammar-history.json        ← danh sách câu user đã phân tích (chỉ khóa, không chứa kết quả)
    usage/YYYY-MM.jsonl         ← lượt dùng AI của user
cache/analyze/                  ← kết quả Grammar Analyze dùng chung (khóa = hash câu)
content/ cache/ config/ logs/   ← dùng chung như cũ
```

**Biến môi trường mới (thêm vào `.env.example`)**

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DATA_DIR` | `./data` | Nơi lưu dữ liệu user và auth |
| `SESSION_TTL_DAYS` | `30` | Thời hạn phiên đăng nhập |
| `COOKIE_SECURE` | `1` | `0` khi chạy http://localhost |
| `TRUST_PROXY` | `0` | `1` khi chạy sau Cloudflare Tunnel: đọc IP từ `CF-Connecting-IP` |
| `MAX_BODY_MB` / `MAX_MEDIA_BODY_MB` | `2` / `40` | Trần kích thước body: mặc định / cho route nhận ghi âm hoặc ảnh (gửi dạng base64 trong JSON) |
| `AI_DAILY_QUOTA_DEFAULT` | `30` | Hạn mức AI/ngày mặc định cho learner |
| `AI_QUEUE_MAX` | `20` | Số request AI tối đa được xếp hàng |

---

## Quy tắc chung cho mọi phase

1. **Trước khi bắt đầu phase:** sao lưu code + dữ liệu.
   ```bash
   tar czf ../backup-phaseN-$(date +%F-%H%M).tgz --exclude=node_modules --exclude=dist --exclude=models .
   ```
2. **Khôi phục khi hỏng:** giải nén bản sao lưu vào một thư mục mới, so sánh, rồi chép lại.
3. **Sau mỗi phase:** chạy `npm run typecheck`, `npm run lint`, `node --test scripts/tests/`, và danh sách kiểm tra rò rỉ ở cuối file (từ Phase 2).
4. Đánh dấu `[x]` vào plan khi xong từng mục.

---

## Phase 0: Chuẩn bị (nửa ngày)

- [ ] Sao lưu toàn bộ (lệnh ở trên), kiểm tra file `.tgz` mở được.
- [ ] Kiểm tra `agy --help`: tìm cờ khóa quyền công cụ, chế độ chỉ đọc, giới hạn workspace, tắt shell. Ghi kết quả vào mục "Ghi chú" ở cuối.
- [ ] Liệt kê route gọi AI: `grep -rln "antigravity\|generate(\|speakingJson\|claude-code" server`. Ghi danh sách vào mục "Ghi chú" (dùng cho Phase 4).
- [x] Chốt các quyết định ở bảng đầu file (`notes.json`: chung; cache Grammar Analyze: chung).
- [ ] Tạo `scripts/tests/` và thêm script `"test": "node --test scripts/tests/"` vào `package.json`.
- [ ] **Chưa** mở server ra domain cho đến khi xong Phase 1.

**Xong khi:** có bản sao lưu, biết cờ của `agy`, có danh sách route gọi AI.

---

## Phase 1: Đăng nhập và chặn toàn bộ truy cập (1–2 ngày)

Chỉ làm xác thực và phân quyền. Chưa tách dữ liệu: mọi user lúc này vẫn thấy chung dữ liệu, nên **chỉ tạo tài khoản cho chính bạn** cho đến khi xong Phase 2.

### 1.1 Lõi xác thực (`server/auth/`)
- [ ] `password.ts`
  - `hashPassword()` dùng `crypto.scrypt` (N=2^15, r=8, p=1, độ dài khóa 64), salt 16 byte.
  - Lưu dạng `scrypt$N$r$p$saltB64$hashB64`.
  - `verifyPassword()` so sánh bằng `timingSafeEqual`.
  - Mật khẩu ≥ 10 ký tự.
- [ ] `store.ts`: đọc/ghi JSON atomic (ghi file tạm rồi `rename`), có khóa trong tiến trình để không ghi đè lẫn nhau. Dùng chung cho `users.json` và `sessions.json`.
- [ ] `users.ts`
  - `createUser`, `findByEmail` (email chuẩn hóa: `trim().toLowerCase()`), `findById`, `setPassword`, `setDisabled`, `setQuota`.
  - `id` dùng `crypto.randomUUID()`.
- [ ] `sessions.ts`
  - Token: 32 byte ngẫu nhiên, base64url. Chỉ lưu `sha256(token)`.
  - Hết hạn sau `SESSION_TTL_DAYS`. Gia hạn trượt, tối đa ghi `lastSeenAt` một lần/giờ để đỡ ghi file.
  - Dọn phiên hết hạn khi khởi động và mỗi giờ.
  - Đổi mật khẩu / khóa user → xóa mọi phiên của user đó.
- [ ] `context.ts`: `AsyncLocalStorage<{ user }>` để code sâu bên trong (`recordUsage`, LLM) biết ai đang gọi mà không phải truyền ctx qua mọi hàm.
- [ ] `middleware.ts`
  - `authenticate(req)` đọc cookie `session`, trả về `user` hoặc `null` (user bị khóa → `null`).
  - `isPublic(method, path)`.
  - Kiểm tra CSRF: request không phải GET/HEAD phải có header `Origin` khớp `Host` (hoặc khớp domain cấu hình).
- [ ] `rate-limit.ts`: bộ đếm trong bộ nhớ theo khóa `(ip, email)`. 5 lần sai / 15 phút thì khóa 15 phút. Thêm giới hạn 30 lần / 15 phút theo IP.

### 1.2 Route xác thực (`server/routes/auth.ts`, đăng ký trong `server/routes.ts`)
- [ ] `POST /auth/login` `{email, password}`
  - Đặt cookie `session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=…` (+ `Secure` khi `COOKIE_SECURE=1`).
  - Sai thì trả thông báo chung "Email hoặc mật khẩu không đúng". Vẫn chạy `verifyPassword` với hash giả khi email không tồn tại, để thời gian phản hồi như nhau.
- [ ] `POST /auth/logout`: xóa phiên + xóa cookie.
- [ ] `GET /auth/me` → `{id, email, role}` hoặc 401.
- [ ] `POST /auth/change-password` `{current, next}`.
- [ ] IP: lấy từ `CF-Connecting-IP` chỉ khi `TRUST_PROXY=1`, ngược lại dùng `req.socket.remoteAddress`.

### 1.3 Cổng chặn (cả production lẫn dev)
- [ ] `server/index.ts`: gọi `authenticate` trước khi rẽ nhánh `/api/`, `/data/`, static.
- [ ] `vite.config.ts` → `apiPlugin`: cùng logic cho `/api`.
- [ ] `content-pipeline/vite-plugin.ts`: chặn `/data` trong dev. Cách gọn: một middleware chung đặt **trước** cả hai plugin (một plugin Vite riêng `authPlugin`, `enforce: 'pre'`, đặt đầu danh sách plugins).
- [ ] Danh sách công khai:
  - `POST /api/auth/login`, `GET /api/health`
  - `/assets/*`, `/favicons/*`, `/logo.svg`, `/sw.js`, `*.webmanifest`
  - HTML shell (mọi điều hướng không phải `/api`, `/data` → `index.html`)
  - Trong dev thêm: `/@vite/*`, `/@react-refresh`, `/src/*`, `/node_modules/*` (module của Vite)
- [ ] Mọi thứ khác cần phiên: `/api/*` còn lại, **toàn bộ `/data/*`**, `/blog-images/*`, `/vocab-images/*`, `/note-images/*`, `/pdf/*`, `/pronunciation/*` (nếu muốn khóa cả tài nguyên tĩnh nội dung; mặc định khóa).
- [ ] Trả `401 {error}` cho API và `/data`.
- [ ] `server/api.ts` `readBody`: dừng đọc và trả `413` khi vượt giới hạn.
  - **Chú ý:** ghi âm Speaking Review được gửi dạng WAV base64 **trong JSON** (`src/types/speakingReview.ts`, trường `audio`; 2 phút ≈ 5 MB). Ảnh câu hỏi Listening và ảnh Admin cũng là base64 trong JSON. Vì vậy không phân biệt giới hạn theo `Content-Type`, mà theo route.
  - Mặc định `MAX_BODY_MB`. Danh sách route được dùng `MAX_MEDIA_BODY_MB` khai báo một chỗ: ít nhất `POST /speaking-review`, `POST /listening/simplify/read-image`, `POST /listening/simplify`, `POST /admin/blog/images`, `POST /admin/vocabulary/image`, `POST /admin/notes/image`. Kiểm tra thêm bằng `grep -rn "images\|audio" server/routes`.

### 1.4 Phân quyền route
Tạo hai wrapper trong `server/auth/guards.ts`: `requireUser(handler)` (mặc định cho mọi route sau cổng chặn) và `requireAdmin(handler)` (trả 403 nếu không phải admin). Bỏ `guarded()` và `ADMIN_TOKEN`.

| Nhóm | Route | Quyền |
|---|---|---|
| Admin: sửa nội dung chung | Mọi `/admin/*` (kể cả GET), `/admin/essays*`, `/admin/usage*` | `requireAdmin` |
| Admin: thao tác hệ thống | `POST /speaking/sync`, `POST /speaking/sync/stop`, `POST /dol/check` | `requireAdmin` |
| Learner: thẻ riêng (trước đây `guarded`) | `POST/DELETE /review/custom`, `/review/custom/generate`, `/review/custom/import`, `POST /practice/cards`, `/practice/recent/cards`, `/practice/library-added`, `/practice/mistakes/cards` | `requireUser` (Phase 2 ghi vào kho riêng) |
| Learner: học và luyện tập | `/review/*`, `/practice/*`, `/writing-review*`, `/speaking*` (trừ sync), `/speaking-review*`, `/listening/*`, `/analyze*`, `/idea/format`, `/essays/rebuild`, `/essays/transfer`, `/essays/dictionary`, `/lookup*`, `GET /dol/status`, `POST /report/pdf` | `requireUser` |

- [ ] Viết test liệt kê mọi khóa trong `routes` và khẳng định mỗi route thuộc đúng một nhóm trong bảng (route mới chưa phân loại → test fail).
- [ ] Trước khi Phase 2 tách dữ liệu: CLI `create` **từ chối tạo learner** (chỉ cho `--admin`) với thông báo "Chưa tách dữ liệu theo user (Phase 2)". Phase 2 bỏ chặn này ở bước cuối.

### 1.5 CLI quản lý user (`scripts/user.ts`, chạy bằng `node scripts/user.ts …`)
- [ ] `create <email> [--admin]`, `list`, `reset-password <email>`, `disable <email>`, `enable <email>`.
- [ ] Mật khẩu nhập qua prompt ẩn hoặc sinh ngẫu nhiên và in **một lần**. Không nhận mật khẩu qua tham số dòng lệnh (lộ trong lịch sử shell).
- [ ] **Bước đầu tiên của phase:** tạo tài khoản admin của bạn, nếu không sẽ tự khóa mình ngoài app (kể cả dev server tự chạy lúc mở máy).

### 1.6 Frontend
- [ ] `src/features/auth/AuthProvider.tsx`: gọi `/api/auth/me` khi mở app; trạng thái `loading | anonymous | user`; cung cấp `useAuth()`.
- [ ] `src/features/auth/LoginPage.tsx`
  - Form email + mật khẩu, nút hiện/ẩn mật khẩu, thông báo lỗi.
  - Hoạt động tốt trên mobile (ô nhập 16px) và dark mode.
  - `autocomplete="username"` / `"current-password"`.
- [ ] `src/features/auth/AccountPage.tsx`: đổi mật khẩu.
- [ ] `src/routes.tsx`:
  - Route `/login` công khai.
  - Mọi route khác bọc guard: chưa đăng nhập → `/login?next=<đường dẫn>`.
  - `/admin/*` chỉ cho admin.
- [ ] Bắt `401` ở mọi chỗ gọi fetch: `src/lib/data.ts`, `src/features/admin/api.ts`, và các file `*-api.ts`, `api.ts` trong `src/features/**`. Tạo một hàm `apiFetch()` dùng chung rồi thay dần. `401` → chuyển về `/login`; `403` → thông báo "Không có quyền".
- [ ] Bỏ phần hỏi `ADMIN_TOKEN` và khóa localStorage tương ứng trong `src/features/admin/api.ts`.
- [ ] `Header.tsx`, `MobileNav.tsx`: hiện email, link Tài khoản, nút Đăng xuất. Ẩn nhóm Admin với learner (`adminNav` trong `components/layout/nav`).
- [ ] Sau đăng nhập/đăng xuất: dùng `window.location.assign(...)` (tải lại trang hoàn toàn) để xóa bộ nhớ đệm trong `src/lib/data.ts` và state cũ.
- [ ] Dev: trang đang mở mà phiên hết hạn → lần gọi API tiếp theo đưa về `/login` (không mất dữ liệu đang gõ: lưu nháp localStorage nếu trang đó đã có).

### 1.7 Service worker (`public/sw.js`)
- [ ] Không lưu cache phản hồi khác `200` (đã có `response.ok`; kiểm tra lại cho điều hướng).
- [ ] Không lưu cache `/data/*` nữa cho đến khi Phase 3 xong (vì Phase 1–2 `/data` vẫn chứa lịch sử Grammar Analyze và thẻ custom).
- [ ] Nhận `postMessage({type:'clear'})` → xóa mọi cache. Frontend gửi khi đăng xuất.
- [ ] Tăng `VERSION`.

### 1.8 Kiểm thử (`scripts/tests/auth.test.ts` + `curl`)
- [ ] Không cookie: `/api/review/state` → 401; `/data/lookup.json` → 401 (cả dev 5173 lẫn production 4173); `/` → 200.
- [ ] Đăng nhập đúng → cookie có `HttpOnly`, `SameSite=Lax` (+ `Secure` khi bật).
- [ ] Sai mật khẩu 6 lần → 429 đến khi hết thời gian khóa.
- [ ] Learner gọi `/api/admin/vocabulary` → 403; admin → 200.
- [ ] Đăng xuất rồi dùng lại cookie cũ → 401. Đổi mật khẩu → phiên khác bị hủy.
- [ ] POST không có hoặc sai `Origin` → 403.
- [ ] Body 5 MB gửi tới route thường → 413; ghi âm 3 phút gửi tới `POST /speaking-review` → vẫn chạy.
- [ ] Test phân loại route (1.4) chạy qua.

**Xong khi:** người chưa đăng nhập không lấy được dữ liệu nào ngoài trang login và asset; không gọi được `agy`; trang Admin chỉ admin vào được.

---

## Phase 2: Dữ liệu cá nhân theo user (2–3 ngày)

Giữ nguyên tính năng, chỉ đổi nơi lưu. Phase này chưa sửa `/data`.

### 2.1 Hạ tầng
- [ ] `ApiContext` (`server/api.ts`):
  - Thêm `user: {id, email, role}` và `userDir`.
  - `createApiMiddleware` tạo ctx **cho từng request** sau khi xác thực, và chạy handler trong `AsyncLocalStorage`.
- [ ] `server/paths.ts`: chỉ hai hàm dựng đường dẫn.
  - `sharedPath(...parts)` → dưới `content/` hoặc `cache/`.
  - `userPath(ctx, ...parts)` → dưới `data/users/<uid>/`.
  - Mỗi `part` nhận từ client phải khớp `/^[A-Za-z0-9._-]+$/` và không phải `.`/`..`. Sau khi `path.resolve`, kiểm tra kết quả vẫn nằm trong thư mục gốc.
- [ ] Đổi `rootDir` trong ctx thành `unsafeRootDir` (hoặc bỏ hẳn) để mọi chỗ còn dùng đều báo lỗi khi `typecheck`.
- [ ] Khóa ghi theo user: `withUserLock(uid, key, fn)` cho mọi thao tác đọc-sửa-ghi JSON (thay `pendingWrite` toàn cục trong `routes/analyze.ts` và các khóa tương tự).
- [ ] `vite.config.ts`: thêm `'**/data/**'` vào `server.watch.ignored`.

### 2.2 Đổi đường dẫn (kiểm lại bằng `grep -rn "'progress'\|rootDir\|contentDir" server`)
- [ ] `server/review/progress.ts`, `server/review/produce.ts` → `userPath(ctx, 'progress', …)`
- [ ] `server/review/custom.ts` → thẻ custom ghi vào `userPath(ctx, 'review', …)`
- [ ] `server/practice/real-use.ts`, `works.ts` (3 chỗ: `speaking`, `writing-reviews`, `speaking-reviews`), `recent.ts` (`practice-aliases.json`), `mistakes.ts`
- [ ] `server/writing-review/service.ts`, `writing-essay.ts` (3 chỗ)
- [ ] `server/speaking-review/review.ts` (kết quả + file ghi âm), `server/speaking/suggest.ts`, `server/speaking/analyze-edit.ts`
- [ ] `server/format-idea.ts` (2 chỗ), `server/listening/history.ts`
- [ ] `server/routes/analyze.ts`
  - Kết quả phân tích → `cache/analyze/<sha1(câu chuẩn hóa)>.md` (dùng chung).
  - Danh sách lịch sử → `userPath(ctx, 'grammar-history.json')`.
  - `inFlight` vẫn gộp theo câu, nhưng **mỗi** request đều ghi khóa vào lịch sử của chính user đó.
  - Bỏ `ctx.onContentChange()` sau khi ghi lịch sử.
- [ ] `server/usage.ts` `recordUsage()`: thêm trường `userId` lấy từ `AsyncLocalStorage`. Ghi thêm vào `userPath('usage/YYYY-MM.jsonl')`. Giữ log tổng ở `logs/`.
- [ ] Giữ nguyên (dùng chung): `cache/ozdic|longman|dol`, `server/speaking/sync.ts`, `server/speaking/library.ts` (`content/speaking/*`), `server/topic-collocations.ts`, mọi `server/admin/*`.

### 2.3 Job chạy nền
- [ ] Thêm `userId` vào mọi job khi tạo: `speaking/suggest.ts` (`jobs.set`), `writing-review/service.ts`, `speaking-review/review.ts`, `speaking/analyze-edit.ts`.
- [ ] Mọi chỗ `jobs.get(id)` kiểm tra `job.userId === ctx.user.id`; khác thì xử lý như không tồn tại (404).
- [ ] Job ghi kết quả vào thư mục của **chủ job** (lưu `userDir` trong job), không dùng ctx của request đang tra cứu.
- [ ] Sync gắn thẻ (`speaking/sync.ts`) là job toàn cục của admin: giữ nguyên, chỉ admin gọi được (Phase 1).

### 2.4 Di chuyển dữ liệu hiện có (`scripts/migrate-to-user.ts <email-admin>`)
- [ ] Tạo `data/users/<uid-admin>/` và **copy** (không move):
  - `progress/*` → `progress/`
  - `content/review/*` (trừ `_example.*`) → `review/`
  - `content/grammar/history.json` → tách: nội dung từng câu vào `cache/analyze/`, danh sách khóa vào `grammar-history.json`
- [ ] Cho phép chạy lại nhiều lần (bỏ qua file đã tồn tại trừ khi có `--force`).
- [ ] In tổng kết: số file, tổng dung lượng nguồn và đích, số mục lịch sử.
- [ ] Sau khi kiểm tra kỹ bằng tay mới xóa bản gốc (`progress/`, `content/review/*` trừ `_example`). Plan **không** tự động xóa.

### 2.5 Kiểm thử
- [ ] `scripts/tests/paths.test.ts`: không còn chuỗi `'progress'`, `unsafeRootDir`, `contentFile(ctx.contentDir, 'review'` hay `grammar/history.json` trong `server/` ngoài `paths.ts` và script migrate.
- [ ] Path traversal: gửi `id`/`slug` dạng `../x`, `..%2Fx`, `a/b`, chuỗi rỗng vào mọi route nhận id → 400/404, không đọc ngoài thư mục user.
- [ ] Hai user A, B (tạo bằng CLI): A ôn từ, làm Writing Review, Speaking, Speaking Review, Listening, Analyze, thêm thẻ custom → B không thấy gì (xem danh sách kiểm tra rò rỉ cuối file).
- [ ] B đoán `id` job đang chạy của A → 404.
- [ ] A và B ghi song song 50 request → file JSON vẫn hợp lệ.
- [ ] Tài khoản admin sau migrate thấy đủ dữ liệu cũ (so số thẻ đang ôn, số bài review, thống kê với trước khi migrate).

- [ ] Bỏ chặn "từ chối tạo learner" trong CLI (đặt ở Phase 1.4) sau khi mọi kiểm thử ở trên đã qua.

**Xong khi:** hai user có dữ liệu tách biệt hoàn toàn qua API; tài khoản admin giữ nguyên toàn bộ dữ liệu cũ. Từ đây mới tạo tài khoản learner thật.

---

## Phase 3: Tách phần cá nhân khỏi `/data` (1–2 ngày)

`/data` chủ yếu là nội dung chung. Chỉ có hai thứ cá nhân: `grammar/history.json` và thẻ "My cards" trong `review/index.json`.

### 3.1 Build nội dung (`content-pipeline/`)
- [ ] `index.ts`: bỏ dòng `out.set('grammar/history.json', …)`.
- [ ] `review.ts`: tách phần "Your own cards" (`source: 'custom'`, khoảng dòng 137–250) thành hàm `buildCustomCards(dir)` có export. `buildReview` không đọc `content/review/` nữa. `review/index.json` chỉ còn thẻ chung.
- [ ] Kiểm tra `buildReview` có bước nào dựa vào thẻ custom (ví dụ chống trùng id, nhóm deck) và sửa theo.

### 3.2 API cá nhân
- [ ] `GET /api/me/review-cards` → `{cards, decks}` của user, dùng `buildCustomCards(userPath('review'))`, cache trong bộ nhớ theo mtime của thư mục.
- [ ] Lịch sử Analyze: dùng route `GET /analyze/history` đã có (Phase 2 đã đổi sang dữ liệu riêng).
- [ ] Server đọc kho thẻ: `server/speaking/library.ts` và `server/practice/works.ts` đang gọi `buildContent(ctx.contentDir).files.get('review/index.json')`. Viết `loadReviewCards(ctx)` = thẻ chung + thẻ custom của user, dùng ở các chỗ cần thẻ của user (ví dụ Practice). Riêng Sync gắn thẻ chỉ dùng thẻ chung.
- [ ] Gợi ý Speaking cho thẻ custom: giai đoạn đầu thẻ custom không có thẻ phân loại (không xuất hiện trong gợi ý theo chức năng/chủ đề). Ghi lại thành việc làm sau nếu cần.

### 3.3 Frontend
- [ ] Hook `useReviewCards()` (ví dụ `src/features/review/useReviewCards.ts`): lấy `/data/review/index.json` + `/api/me/review-cards`, ghép lại. Thẻ custom vẫn có id `custom:<deck>:<id>` như cũ để tiến độ ôn đã lưu vẫn khớp.
- [ ] Thay chỗ đọc kho thẻ bằng hook: `ReviewPage`, `CardView`, `ReviewSessionPage`, `UsageSessionPage`, `StartSessionButton`, và chỗ khác tìm được bằng `grep -rn "review/index" src`.
- [ ] Sau khi thêm/xóa/nhập thẻ custom: làm mới dữ liệu của hook (trước đây dựa vào `onContentChange` + build lại `/data`).
- [ ] `src/features/grammar/analyze/api.ts`, `GrammarAnalyzePage`: không đọc `/data/grammar/history.json` nữa.
- [ ] Không cần sửa: Blog, Vocabulary, Collocation, Essay, Notes, Lookup, đề Practice.

### 3.4 Service worker
- [ ] Bật lại cache `/data/*` (network-first) vì giờ `/data` chỉ có nội dung chung.
- [ ] `/api/*` vẫn không bao giờ cache. Đăng xuất vẫn xóa cache.

### 3.5 Kiểm thử
- [ ] `grep -rl "custom:" dist/data` và `ls dist/data/grammar` → không còn dữ liệu cá nhân.
- [ ] Số thẻ chung bằng trước khi tách; thẻ custom của admin vẫn đủ và tiến độ ôn của chúng còn nguyên.
- [ ] Đăng nhập A → đăng xuất → đăng nhập B trên cùng trình duyệt (cả khi đã cài PWA): không còn gì của A.

**Xong khi:** `/data` không chứa dữ liệu gắn với cá nhân nào, và có thể cache an toàn.

---

## Phase 4: Bảo vệ agent và tài nguyên (2–3 ngày)

### 4.1 Hạn mức AI
- [ ] Wrapper `aiGuarded(handler)` cho mọi route gọi AI (danh sách từ Phase 0).
  - Kiểm tra lượt dùng hôm nay của user trước khi chạy.
  - Trừ lượt khi gọi thành công.
  - Hết lượt → `429 {error, remaining: 0, resetAt}`.
- [ ] Với job chạy nền (Writing Review, Speaking...): tính lượt lúc **tạo job**, không phải theo số lần gọi LLM bên trong.
- [ ] Hạn mức lấy từ `users.json` (`quota.aiPerDay`), mặc định `AI_DAILY_QUOTA_DEFAULT`; admin không giới hạn.
- [ ] `GET /api/me/quota` để frontend hiện số lượt còn lại; nút gọi AI hiện thông báo dễ hiểu khi gặp 429.

### 4.2 Hàng đợi và tài nguyên
- [ ] `antigravity-cli.ts` đã có hàng đợi toàn cục (`slots`). Thêm:
  - Trần độ dài hàng đợi `AI_QUEUE_MAX` (tính theo lượt gọi `agy` đang chờ); đầy → `503 "Máy đang bận, thử lại sau"`.
  - Mỗi user tối đa 2 **request/job AI** đang chạy hoặc đang chờ cùng lúc (một request có thể gồm nhiều lượt gọi `agy`; việc chia lượt gọi giữa các user nằm ở 4.3). Vượt → `429 "Bạn đang có 2 tác vụ AI chưa xong"`.
- [ ] ASR (`sherpa-onnx`, `server/speaking-review/stt.ts`): hàng đợi riêng, 1 tác vụ/lần.
- [ ] Tra từ ngoài (`/lookup`, `/lookup/dol`, Longman/Ozdic): giới hạn theo user (ví dụ 60 lần/phút) để không làm máy chủ bị các trang nguồn chặn IP.
- [ ] `server/llm/claude-code.ts`: tắt đường gọi này trên server public (biến môi trường hoặc bỏ khỏi các chỗ chọn provider), đúng ràng buộc chỉ dùng Antigravity.

### 4.3 Chia lượt công bằng giữa các user

**Vấn đề:**
- Hàng đợi `slots` hiện là FIFO toàn cục.
- Một request có thể đẩy nhiều lượt gọi vào hàng cùng lúc, nên chiếm hết `ANTIGRAVITY_PARALLEL` (mặc định 4) chỗ trong nhiều phút:
  - Listening Simplify chia transcript dài thành nhiều phần chạy song song.
  - Writing Review gồm nhiều bước.
  - Sync gắn thẻ chạy 2 batch song song.
- Người đến sau phải chờ toàn bộ.

- [ ] Thay hàng đợi FIFO trong `inSlot()` bằng **hàng đợi theo user, xoay vòng (round-robin)**:
  - Mỗi user một hàng con (`Map<userId, (() => void)[]>`) và một danh sách thứ tự xoay vòng.
  - Khi một chỗ trống: chọn user kế tiếp trong vòng **có lượt đang chờ**, cho lượt đầu tiên của user đó chạy, rồi chuyển user này xuống cuối vòng.
  - Không có ai khác chờ thì một user vẫn được dùng hết các chỗ (không để chỗ trống vô ích). Có người khác chờ thì các chỗ được trả lần lượt cho từng người.
  - `userId` lấy từ `AsyncLocalStorage` (Phase 1.1). Lượt gọi không có user (job hệ thống) dùng khóa `system`.
  - State giữ trên `globalThis` như `slots` hiện tại (dev server nạp lại module).
- [ ] Mức ưu tiên: tác vụ người dùng đang đợi trên màn hình (Analyze, Listening, Writing/Speaking Review) đi trước; **Sync gắn thẻ của admin** và các thao tác sinh nội dung hàng loạt ở `/admin/*/generate` là ưu tiên thấp, chỉ lấy chỗ khi không còn lượt ưu tiên cao nào chờ. Truyền mức ưu tiên qua tham số của `antigravityJson()` hoặc qua `AsyncLocalStorage`.
- [ ] Giới hạn số phần chạy song song **trong một request** (Listening Simplify, `maxParallel()` trong `server/listening/simplify.ts`) không vượt quá số chỗ đang trống khi có user khác chờ: đơn giản nhất là để mọi phần đều đi qua hàng đợi round-robin (đã đúng nếu mỗi phần gọi `inSlot` riêng), không tự giữ chỗ trước.
- [ ] Ghi thời gian chờ trong hàng và thời gian chạy của mỗi lượt vào log usage (`queuedMs`, `ms`) để biết khi nào cần tăng `ANTIGRAVITY_PARALLEL`.
- [ ] Endpoint `GET /api/me/ai-status` → `{running, queued, position, estimatedWaitSec}` để giao diện hiện "Đang xếp hàng, còn khoảng N giây" thay vì chỉ quay vòng.

### 4.4 Tránh lỗi 524 của Cloudflare (giới hạn 100 giây)

**Vấn đề:**
- Cloudflare cắt request nếu server không trả phản hồi trong 100 giây; người dùng nhận lỗi **524**.
- Server vẫn chạy tiếp và **vẫn tốn lượt AI**, nhưng kết quả không về được trình duyệt.
- Writing Review, Speaking ideas và Speaking Review đã chạy dạng job nền (trình duyệt hỏi lại kết quả), nên không bị ảnh hưởng.
- Các route AI trả kết quả **ngay trong một request** thì bị ảnh hưởng (kiểm lại với danh sách ở Phase 0):

| Route | Ghi chú |
|---|---|
| `POST /listening/simplify` | Rủi ro cao nhất: transcript dài, nhiều phần |
| `POST /analyze` | Grammar Analyze |
| `POST /listening/simplify/read-image` | Đọc ảnh câu hỏi |
| `POST /review/produce`, `POST /review/custom/generate` | Chấm câu, sinh thẻ |
| `POST /essays/rebuild`, `POST /essays/transfer` | Essay mẫu |
| `POST /idea/format` | |
| `POST /speaking/analyze-edit`, `POST /writing-review/analyze-edit` | Phân tích bản sửa |
| `POST /admin/*/generate`, `POST /admin/essays/analyze`, `POST /admin/essays/item` | Chỉ admin, nhưng vẫn qua Cloudflare |

- [ ] **Bộ chạy job dùng chung** `server/jobs.ts`:
  - `startJob(ctx, kind, fn)` lưu job trong `Map` trên `globalThis` với `{id, userId, kind, status: 'queued'|'running'|'done'|'error', result?, error?, createdAt}`, rồi trả ngay `202 {jobId}`.
  - `GET /api/jobs?id=` trả trạng thái/kết quả, **chỉ cho chủ job** (khác user → 404).
  - Kết quả giữ trong bộ nhớ 30 phút rồi xóa. Các route vốn tự lưu kết quả vào lịch sử (Analyze, Listening) vẫn lưu như cũ, nên tải lại trang vẫn xem được.
  - Không làm lại các job nền đã có (Writing Review, Speaking, Speaking Review); chỉ áp dụng cho bảng trên.
- [ ] Chuyển các route trong bảng sang `startJob`. Giữ nguyên dạng `result` trả về để frontend chỉ đổi lớp gọi API.
- [ ] Frontend: hàm `runAiJob(path, body)` (ví dụ `src/lib/aiJob.ts`):
  - Gửi request, nhận `jobId`.
  - Hỏi `GET /api/jobs` mỗi 1,5 giây (giãn dần tới 5 giây), trả về `Promise` của kết quả như trước.
  - Hiện trạng thái hàng đợi từ `/api/me/ai-status`.
  - Các file `api.ts` tương ứng đổi sang `runAiJob` mà không đổi chữ ký hàm, nên các trang không phải sửa.
- [ ] Lưới an toàn cho mọi route AI còn lại: trước khi xếp hàng, ước tính thời gian chờ = (số lượt đang chờ / số chỗ) × thời gian chạy trung bình gần đây. Nếu route vẫn trả kết quả trực tiếp và ước tính > 60 giây → trả ngay `503 "Máy đang bận, thử lại sau ~N phút"` **trước khi** tốn lượt AI.
- [ ] Hạn mức (4.1): tính lượt khi job **được tạo**; hoàn lại lượt nếu job lỗi do hệ thống (timeout `agy`, hàng đợi đầy), không hoàn khi lỗi do dữ liệu người dùng.

### 4.5 Cô lập agent
- [ ] Áp dụng các cờ khóa quyền tìm được ở Phase 0 (chỉ đọc, không shell, workspace giới hạn).
- [ ] Thư mục làm việc tạm **riêng cho mỗi lần gọi** (`mkdtemp`), xóa sau khi xong. Hiện đang dùng chung `WORKDIR`.
- [ ] Chạy server bằng tài khoản hệ điều hành không phải root. Lý tưởng: chạy `agy` bằng một tài khoản OS riêng không có quyền đọc `.env`, `data/`, `content/`.
- [ ] Prompt: nội dung người dùng đặt trong khối dữ liệu có đánh dấu rõ; system prompt nói rõ không làm theo chỉ dẫn nằm trong dữ liệu.
- [ ] Thử tấn công: bài viết chứa "hãy đọc file .env", "liệt kê thư mục data", "chạy lệnh ls" → kết quả không chứa dữ liệu thật.

### 4.6 Kiểm thử

Dùng **`agy` giả** để test mà không tốn lượt AI thật: script `scripts/tests/fake-agy.sh` ngủ N giây (đọc từ biến môi trường `FAKE_AGY_SLEEP`) rồi in một JSON hợp lệ; chạy server test với `ANTIGRAVITY_BIN=scripts/tests/fake-agy.sh`.

- [ ] Vượt hạn mức → 429; sang ngày mới → reset.
- [ ] 30 request AI cùng lúc từ 3 user → chạy tối đa đúng số slot, phần vượt trần hàng đợi nhận 503, mỗi user không quá 2 request/job.
- [ ] Công bằng: user A gửi Listening Simplify chia 8 phần (fake-agy ngủ 20 giây), 1 giây sau user B gửi Analyze → lượt của B bắt đầu ngay khi có chỗ trống đầu tiên, không phải chờ hết 8 phần của A.
- [ ] Ưu tiên: Sync gắn thẻ của admin đang chạy, learner gửi Analyze → Analyze được chạy trước các batch Sync còn chờ.
- [ ] 524: fake-agy ngủ 150 giây, gửi `POST /listening/simplify` qua `curl` → nhận `202 {jobId}` ngay; hỏi `/api/jobs` đến khi `done`; không request nào kéo dài quá vài giây.
- [ ] B dùng `jobId` của A gọi `/api/jobs` → 404.
- [ ] Lưới an toàn: làm đầy hàng đợi rồi gọi một route AI còn trả trực tiếp → 503 ngay, log usage không có lượt gọi mới.
- [ ] Admin → Usage hiện được lượt dùng theo từng user.

**Xong khi:** một learner không thể làm cạn hạn mức chung hay làm treo máy; khi nhiều người dùng cùng lúc, mỗi người đều được chia lượt và không ai gặp lỗi 524; agent không đọc được ngoài thư mục tạm của nó.

---

## Phase 5: Quản lý user và dọn phía trình duyệt (1 ngày)

- [ ] API admin: `GET/POST /admin/users`, `PATCH /admin/users/:id` (khóa/mở, đổi vai trò, hạn mức), `POST /admin/users/:id/reset-password` (trả mật khẩu tạm một lần), `DELETE /admin/users/:id` (chuyển thư mục dữ liệu vào `data/deleted/`, không xóa hẳn).
- [ ] Trang Admin "Users": danh sách (email, vai trò, trạng thái, lượt AI hôm nay, lần đăng nhập cuối), tạo user, đặt lại mật khẩu, khóa/mở, chỉnh hạn mức.
- [ ] Trang "Tài khoản": đổi mật khẩu, xem hạn mức còn lại, đăng xuất khỏi mọi thiết bị.
- [ ] Bắt buộc đổi mật khẩu ở lần đăng nhập đầu khi mật khẩu do admin cấp (`mustChangePassword`).
- [ ] Khóa localStorage theo user (giữ theme dùng chung): thêm tiền tố `u:<uid>:` trong `src/lib/storage.ts` và các file đang dùng trực tiếp: `features/practice/quiz/bestScores.ts`, `features/review/usageTasks.ts`, `features/review/StartSessionButton.tsx`, `features/practice/SpeakingReviewPage.tsx`, `features/practice/WritingReviewPage.tsx`, `features/practice/ListeningSimplifyPage.tsx`. Dữ liệu cũ không tiền tố: gán cho tài khoản admin ở lần đăng nhập đầu, rồi xóa.
- [ ] Nhật ký `data/auth/audit.jsonl`: đăng nhập thành công/thất bại, đổi mật khẩu, thao tác quản lý user (ai, lúc nào, IP).
- [ ] Xuất dữ liệu cá nhân (tùy chọn): `GET /api/me/export` trả file zip thư mục của user.

**Xong khi:** thêm, khóa, đặt lại mật khẩu người dùng không cần dòng lệnh.

---

## Phase 6: Deploy (nửa ngày)

Phần PWA (manifest, icon, service worker, chỉnh giao diện mobile) đã làm xong trước đó.

### 6.1 Máy chủ
- [ ] Node ≥ 22.18, `npm ci`, tải model ASR vào `models/` (lệnh trong README), copy `.env` (đặt `COOKIE_SECURE=1`, `TRUST_PROXY=1`), cài và đăng nhập `agy`.
- [ ] Copy `data/` (sau Phase 2) cùng `content/`, `cache/`, `config/`. Không copy `node_modules/`, `dist/`, `logs/`.
- [ ] `npm run build`, tạo tài khoản admin bằng CLI nếu là máy mới, `npm start`.
- [ ] `server/index.ts`: `server.listen(port, '127.0.0.1')` để chỉ vào được qua tunnel.
- [ ] Cài `npm start` thành service tự chạy lại (systemd trong WSL hoặc VPS; với WSL có thể sửa `scripts/dev-server.sh` thành bản production).

### 6.2 Cloudflare
- [ ] `cloudflared tunnel login` → `tunnel create linearthinking` → `tunnel route dns linearthinking app.<domain>`.
- [ ] File cấu hình: `ingress` trỏ `app.<domain>` về `http://127.0.0.1:4173`, mục cuối `http_status:404`. Cài `cloudflared` thành service.
- [ ] Bật "Always Use HTTPS", HSTS.
- [ ] Rule rate limit cho `POST /api/auth/login`.
- [ ] (Tùy chọn) **Cloudflare Access** đặt trước domain làm lớp bảo vệ thứ hai.

### 6.3 Sao lưu và vận hành
- [ ] Sao lưu `data/`, `content/`, `config/` hằng ngày (cron + `tar`), giữ 14 bản, chép ra ổ hoặc máy khác.
- [ ] Thử khôi phục một bản sao lưu vào thư mục tạm ít nhất một lần.
- [ ] Theo dõi: dung lượng `data/users/*/progress/speaking-reviews` (file ghi âm lớn dần), log lỗi server.

### 6.4 Kiểm tra cuối từ điện thoại
- [ ] Đăng nhập, cài PWA, ôn thẻ, Writing Review, Speaking Review (micro chạy trên HTTPS), đăng xuất.
- [ ] Một tài khoản learner thật dùng thử một ngày.

---

## Phase 7: Đưa lên git (khi bạn cần)

Để cuối vì hiện chưa cần đưa lên git.

- [ ] `git init` ở thư mục dự án.
- [ ] `.gitignore`: `node_modules/`, `dist/`, `.env`, `data/`, `logs/`, `models/`, `cache/`, `progress/` (nếu còn), `*.tgz`.
- [ ] Kiểm tra trước commit đầu: `git status` không có `.env`, `data/`, file ghi âm, khóa API. Tìm nhanh: `git grep -n "API_KEY\|token\|password" -- ':!*.md'`.
- [ ] Commit ban đầu; nếu đẩy lên GitHub thì để repo **private**.
- [ ] Từ đó, mỗi phase một nhánh hoặc một commit để dễ xem lại và quay về.

---

## Danh sách kiểm tra rò rỉ (chạy sau mỗi phase, từ Phase 2)

1. Hai tài khoản A, B. A tạo dữ liệu ở mọi tính năng: Review (ôn, đánh giá, thẻ custom, nhập thẻ), Practice (quiz, mistakes, recent), Writing Review, Speaking ideas, Speaking Review (có ghi âm), Listening, Grammar Analyze, Essays rebuild/transfer.
2. Đăng nhập B: không thấy gì của A ở bất kỳ trang nào, kể cả thống kê và lịch sử.
3. Dùng `curl` với cookie của B gọi trực tiếp mọi endpoint nhận `id`, dùng `id` của A (kể cả `GET /speaking-review/audio?id=`) → 404/403, không bao giờ trả dữ liệu của A.
4. Cookie của B gọi route admin → 403.
5. Không cookie → mọi `/api/*` (trừ login, health) và `/data/*` trả 401.
6. `grep -rl "<email hoặc nội dung riêng của A>" dist/ cache/ content/` → không thấy dữ liệu riêng của A ngoài `data/users/<A>/` (riêng `cache/analyze/` chứa kết quả phân tích câu theo thiết kế dùng chung; nếu không chấp nhận, đổi sang cache riêng).

## Rủi ro chính và cách giảm

| Rủi ro | Cách giảm |
|---|---|
| Sót một đường dẫn, dữ liệu lẫn giữa user | Bỏ `rootDir` khỏi ctx, `paths.test.ts`, danh sách kiểm tra rò rỉ |
| Lộ dữ liệu qua job chạy nền | `userId` trong job + kiểm tra chủ sở hữu (2.3) |
| Route mới thêm sau này quên phân quyền | Test phân loại route (1.4) fail khi có route chưa phân loại |
| Mất dữ liệu khi di chuyển | Sao lưu trước mỗi phase, script migrate chỉ copy, xóa bản gốc bằng tay |
| Tự khóa mình ngoài app khi bật đăng nhập | Tạo tài khoản admin bằng CLI trước khi bật cổng chặn (1.5) |
| Agent bị lợi dụng (prompt injection) | Phase 4.3: cờ khóa quyền, thư mục tạm riêng, tài khoản OS thấp quyền |
| Hết hạn mức AI của chủ máy | Hạn mức theo user, trần hàng đợi, giới hạn đồng thời theo user |
| Một user chiếm hết chỗ chạy agent | Hàng đợi round-robin theo user, Sync/admin ưu tiên thấp (4.3) |
| Lỗi 524 khi chờ quá 100 giây sau Cloudflare | Route AI trả trực tiếp chuyển sang job + hỏi lại; lưới an toàn trả 503 sớm (4.4) |
| Brute-force đăng nhập | Giới hạn theo (IP, email) và IP, rule Cloudflare, (tùy chọn) Access |
| Hai tiến trình server cùng ghi file | Chỉ chạy một instance; khóa ghi theo user |
| Kết quả Analyze dùng chung có thể lộ câu user khác đã nhập | Chỉ trả kết quả khi user nhập đúng câu đó; danh sách lịch sử là riêng. Nếu vẫn không muốn, dùng cache riêng mỗi user. |

## Ghi chú (điền trong quá trình làm)

- Cờ của `agy` để khóa quyền: _(chưa kiểm tra, Phase 0)_
- Danh sách route gọi AI: _(chưa liệt kê, Phase 0)_
- `content/note/notes.json`: **chung** (đã chốt).
- Cache Grammar Analyze: **chung** (đã chốt); danh sách lịch sử vẫn riêng từng user.

## Nhật ký thực hiện

| Ngày | Phase | Đã làm | Lệch so với plan | Kiểm thử đã chạy |
|---|---|---|---|---|
| 2026-10-20 | 1 (một phần, 1 tài khoản) | `server/auth/` (scrypt, phiên hash SHA-256 30 ngày, giới hạn đăng nhập sai, cổng chặn `/api` + `/data` cho cả `npm start` và dev qua `authPlugin`), `server/routes/auth.ts` (login/logout/me), `scripts/user.ts` (create/reset-password/disable/enable/list), trang `/login`, loader `requireUser` ở route gốc, bắt 401 toàn cục, nút Đăng xuất, `npm test` | Mọi tài khoản là `admin`, chưa có `learner`; `guarded()`/`ADMIN_TOKEN` giữ nguyên; chưa làm: giới hạn body, test phân loại route, đổi `apiFetch`, `AsyncLocalStorage`; tài nguyên tĩnh (ảnh, pdf) chưa khóa; cookie `Secure` tự bật theo `X-Forwarded-Proto` thay cho `COOKIE_SECURE` | `npm test` 6/6 (chặn khi chưa đăng nhập, login/logout, cookie Secure sau HTTPS, chặn khác Origin, reset mật khẩu hủy phiên từ tiến trình khác, khóa sau 5 lần sai); thử tay trên dev 393×873: redirect + `next`, lỗi sai mật khẩu, phiên bị hủy khi đang mở trang, đăng xuất |
| 2026-10-20 | 1 (bổ sung) | `POST /auth/change-password` (cần mật khẩu hiện tại, ≥10 ký tự, cùng giới hạn sai như đăng nhập; đăng xuất thiết bị khác, cấp cookie mới cho thiết bị này), trang `/account` (email, Đăng xuất, đổi mật khẩu), mục "Tài khoản" trong menu Admin và menu điện thoại; tạo tài khoản admin theo yêu cầu người dùng | Tài khoản đầu được tạo thẳng bằng `createUser`, mật khẩu 9 ký tự (dưới mức 10 của CLI) theo yêu cầu: cần đổi trước khi public | `npm test` 7/7 (thêm test đổi mật khẩu); thử tay trên dev 393×873: đăng nhập → `/account`, sai mật khẩu hiện tại báo lỗi, mật khẩu không đổi |

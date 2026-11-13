# Kế hoạch v2: English App nhiều người dùng (instance thứ hai)

> Ngày viết: 2026-11-13. Chỉ là kế hoạch: chưa sửa code, chưa khởi động lại service nào.
> Thay thế `PLAN-multi-user.md` (v1, 2026-10-20). Mục 1 ghi rõ phần nào của v1 và nhánh `origin/feat/multi-user` còn dùng được.
> Prompt cho agent thực thi viết bằng tiếng Anh (mục 11). Còn lại viết tiếng Việt.

## Tóm tắt

- **Có chạy được hai app trên máy này không?** Được, nhưng **chỉ khi sửa ba chỗ trước khi mở cho người khác**. Nếu chạy instance thứ hai y như bây giờ thì máy **không đủ RAM**:
  - Mô hình nhận giọng nói (STT Parakeet) tốn khoảng **1,1 GB RAM cho mỗi tiến trình** (đã đo).
  - Mỗi tiến trình `agy` tốn 170–250 MB (đã đo).
  - Hai instance, mỗi cái có STT riêng và 4 slot `agy` riêng, sẽ cần khoảng 6 GB. WSL chỉ có 3,4 GB.
  - Ba chỗ phải sửa:
    1. Một **STT worker dùng chung**, tự giải phóng model khi rảnh.
    2. **Một trần AI chung cho cả hai instance** (tổng 4 lượt `agy` chạy cùng lúc).
    3. Giới hạn bộ nhớ (`MemoryMax`) cho từng service.
- **Nút thắt thật là `agy`, không phải CPU hay RAM.**
  - Thời gian một lượt gọi: p50 16 s, p90 52 s, p99 178 s. Hôm nay có lượt 97 s và lỗi `503 No capacity`.
  - Một Writing Review gồm khoảng 10 lượt gọi và 140k token.
  - 4 slot trên cùng một gói subscription → ngày thường xử lý được khoảng 1 bài Writing Review mỗi phút; ngày bận chỉ còn 1 bài mỗi 3–6 phút.
- **Quy mô thực tế:**
  - Một nhóm được mời, **10–15 tài khoản**, cùng lúc **3–5 người** dùng tính năng AI vào ngày thường, **1–2 người** vào ngày bận.
  - **Không** nên mở đăng ký công khai khi AI vẫn chạy qua một gói `agy`.
- **Rủi ro ổ đĩa:** ổ ảo của WSL nằm trên `C:`, mà `C:` chỉ còn **20 GB trống (92% đã dùng)**. File ghi âm Speaking Review là phần dữ liệu lớn nhất: 53 MB cho một người sau ba tuần.
- **Cách làm (đã chốt 2026-11-13, mục 10):**
  - Code multi-user nằm ở **thư mục riêng** `/home/englishmulti/app`: một bản clone của repo, làm trên nhánh dài hạn `multi`.
  - App cá nhân `/home/trongle/english-app` **không bị sửa code** (trừ, tùy chọn, 1 dòng `COACH_IDLE_MS`, mục 6.5), vẫn chạy `main`. Chỉ unit systemd của nó đổi (RAM, `PATH` qua cổng `agy-gate`, warm idle).
  - Tính năng mới từ `main` được merge sang `multi` định kỳ.
  - Không làm lại nhánh `feat/multi-user` cũ: nhánh này đã chậm 101 commit, chỉ mượn ý tưởng.
  - Hostname: `study.ailab.com.vn` (bỏ khỏi app cá nhân). AI: tạm dùng chung gói `agy`. Đợt đầu: khoảng 4 tài khoản.
  - Trong suốt quá trình làm và chạy thử, mọi thứ vẫn ở ổ `C:`. Khi xong hết mới chuyển WSL sang `E:` **một lần** (Phase 10, mục 7.3a).

---

## 1. Kế thừa từ v1 và nhánh `origin/feat/multi-user`

**Nhánh `origin/feat/multi-user`**
- Gồm 1 commit (`f4d37d2`, 2026-10-22), 41 file, +1224/−320. Tách nhánh từ `1937542`.
- Hiện **chậm 101 commit** so với `main`.
- Không merge nhánh này: nó đụng đúng các file đã thay đổi nhiều từ đó đến nay (`server/api.ts`, `auth/*`, `routes/review.ts`, `practice/*`, `writing-review/*`, `src/lib/data.ts`).
- Đọc nhánh để lấy ý tưởng, rồi viết lại trên `main`.

| Thứ | Giữ / bỏ | Lý do |
|---|---|---|
| `server/paths.ts` của nhánh: `userRootDir`, `userPath` (kiểm từng segment `^[A-Za-z0-9._-]+$`, kiểm `startsWith(base+sep)`), `withUserLock`, `requestContext` (AsyncLocalStorage) | **Giữ ý tưởng**, viết lại thành `UserScope` (mục 3) | Đúng hướng. Nhưng truyền `userDir` dạng chuỗi thì dễ bị dùng sai. |
| `buildCustomCards(dir)` tách khỏi `buildReview` (`content-pipeline/review.ts`) | **Giữ** | Vẫn cần: thẻ "My cards" không được lọt vào `/data`. |
| Bỏ `grammar/history.json` khỏi `/data` | **Giữ** | |
| `ANONYMOUS_USER` (`_anonymous`) khi chưa đăng nhập trong `createApiMiddleware` | **Bỏ** | Phải chặn khi không có user (fail closed): handler cá nhân không bao giờ chạy khi thiếu user. |
| `guarded()` vẫn chấp nhận `ADMIN_TOKEN` | **Bỏ** | Đổi thành `requireAdmin` dựa trên vai trò. Bỏ hẳn `ADMIN_TOKEN`. |
| `createUser(..., role='learner')` mặc định learner | **Giữ**, thêm `status` (pending/active/rejected/disabled), tên hiển thị, `mustChangePassword` | `users.ts` trên `main` đã có TOTP (`totpSecret`, `recoveryHashes`) mà nhánh chưa có. |
| `UsersAdminPage.tsx` (259 dòng) | **Giữ làm bản nháp UI** | Thêm tab Chờ duyệt, hạn mức, dung lượng, thiết bị. |
| `scripts/migrate-to-user.ts` | **Viết lại** | Thiếu `coach`, `planner`, `writing-task1`, `speaking-mock`, `notepad`, ảnh notepad, `vocabulary`/`notes` cá nhân. |
| Thêm test vào `auth.test.ts` | **Giữ ý tưởng** | Chuyển thành bộ test cô lập (mục 3.6). |

**`PLAN-multi-user.md` (v1)**

| Phần | Trạng thái |
|---|---|
| Phase 1 (đăng nhập, cổng chặn `/api` + `/data`, scrypt, phiên SHA-256, giới hạn đăng nhập sai, đổi mật khẩu) | **Đã xong trên `main`**, có thêm TOTP 2FA (`server/auth/totp.ts`, `two-factor.test.ts`). Commit `c35b027` đã bind `127.0.0.1` và thêm security headers. |
| Danh sách 17 file frontend gọi `fetch` | **Lỗi thời**: nay là 25 file. |
| Bảng "dữ liệu chung" coi `content/vocabulary` và `content/note` là chung | **Sai so với thực tế**. Đây là từ vựng (615 từ) và ghi chú (415) **của chính người học**; nút "Add to library" (`src/features/practice/library-add.ts`) đang gọi **API admin** `vocabulary/generate`, `notes/generate`. v2 tách thành *kho tham chiếu chung* + *kho riêng của từng user* (mục 5). |
| Phase 2 (`userPath`, job có `userId`), Phase 3 (`/data` sạch), Phase 4 (hạn mức, round-robin, 524 → job, cô lập agent) | **Giữ nội dung**, mở rộng phạm vi. Từ đó đến nay có thêm: coach (Nova), planner + Web Push, news, nightly drills, Writing Task 1, notepad + ảnh, speaking-mock, warm agent `acp-pool.ts`. |
| Đường dẫn `~/English-App/english-app-v2`, cổng 4173, `scripts/dev-server.sh`, Phase 7 "git init", Phase 6 Cloudflare | **Lỗi thời**. Hiện tại: `/home/trongle/english-app`, systemd `english-app` cổng 5173, tunnel `english-tunnel`, repo đã có git. |
| "Chỉ chạy **một** tiến trình server" | **Đổi**: nay có hai service. Phần dùng chung (AI, STT, cache từ điển) phải có khóa liên tiến trình. |
| "AI chỉ qua `agy`" | Giữ (đã chốt: tạm dùng chung gói `agy`). Mục 2.5 giữ phương án Claude API cho sau này. |

---

## 2. Sức chứa của máy (đo ngày 2026-11-13)

### 2.1 Số đo

| Hạng mục | Giá trị đo | Cách đo |
|---|---|---|
| RAM WSL | 3.414 MiB (`MemTotal` 3,33 GiB), swap 4 GiB. `.wslconfig`: `memory=3584MB`, `processors=6`, `autoMemoryReclaim=gradual`, `sparseVhd=true` | `free -m`, `/mnt/c/Users/*/.wslconfig` |
| CPU | i7-9750HF, 6 luồng cho WSL. Load 0,2–0,4 khi rảnh | `nproc`, `uptime` |
| Node `english-app` | RSS 200 MB sau 21 phút; `MemoryPeak` 413 MB (systemd, sau lần restart gần nhất); người dùng báo 250–560 MB | `systemctl show`, `ps` |
| **STT Parakeet TDT 0.6B int8** (`encoder.int8.onnx` 652 MB) | **RSS 1.126 MB** sau khi nạp model và nhận dạng 1 lần; **1.230 MB** khi 2 lần chạy song song. 7,4 s audio: 3,3 s (gồm nạp model) rồi 1,15 s cho 2 lần song song, CPU 235% | Script đo trong scratchpad, gọi `transcribe()` của `server/speaking-review/stt.ts` (không đụng service) |
| Tiến trình `agy` (binary Go 281 MB) | 168 MB khi chỉ chạy `--help`; **250 MB** khi là `agy acp` có phiên | `/usr/bin/time -v`, `ps` |
| `cloudflared` / `tailscaled` | 27 MB / 35 MB | `ps` |
| Mỗi phiên Claude Code (công cụ dev, không phải prod) | 170–285 MB/phiên. Lúc đo có **4 phiên ≈ 1 GB** | `ps` |
| Ổ đĩa | ext4 `/` báo còn 945 GB, nhưng **file ảo nằm trên `C:` chỉ còn 20 GB trống (92%)** | `df -h / /mnt/c` |
| Dữ liệu một người (owner, ~3 tuần) | `progress/` ≈ 58 MB, trong đó `speaking-reviews` 53 MB (ghi âm); `public/notepad-images` 0,5 MB | `du` |
| Systemd restart | `NRestarts=1864`, phần lớn do `EADDRINUSE :5173` (dev server tranh cổng với prod) | `journalctl -u english-app` |
| Unit hiện tại | `NODE_OPTIONS=--max-old-space-size=4096` (lớn hơn RAM WSL), không có `MemoryMax` | `/etc/systemd/system/english-app.service` |

**Log AI** (`logs/gemini-usage.jsonl`, 1.534 dòng, 21/10 → 13/11):

| Chỉ số | Giá trị |
|---|---|
| Thời gian một lượt gọi | p50 **16,2 s**, p90 **52 s**, p99 **178 s** |
| Lượt gọi mỗi ngày (owner) | thường 40–150; **đỉnh 593 lượt, 7,3M token, 231 phút-agy** (7/11) |
| Một Writing Review | ~9–10 lượt (`diagnose`, `chunk`, `score`, `essay review`, `essay plan`, `model essay`, `wording`, `unlisted wording`, `format idea`, `retry`), mỗi lượt ~13,8k token → **≈ 130–140k token/bài** |
| Speaking review / speaking ideas / note | 12–13k token/lượt, p50 17–20 s |
| Coach (Nova) | p50 8,9 s, ~21k token/lượt (ngữ cảnh lớn) |
| Đồng thời cao nhất từng thấy | 5 lượt chồng nhau |
| Lỗi capacity | 13/11: `UNAVAILABLE (503): No capacity available for model gemini-3.8-flash-low`. Một lượt đo độ trễ mất 97 s |
| Lỗi hạn mức gói | Chưa thấy (`RESOURCE_EXHAUSTED`/quota: 0 lần trong log). **Chưa biết trần ngày của gói**, phải đo khi chạy thử (mục 9) |

### 2.2 Ngân sách RAM

| Thành phần | Hiện tại (1 instance) | Hai instance làm "ngây thơ" | Hai instance theo plan |
|---|---|---|---|
| Hệ thống + cloudflared + tailscale | 150 MB | 150 | 150 |
| Node `english-app` (cá nhân) | 250–450 | 250–450 | 250–450 |
| Node `english-multi` | — | 300–500 + cache theo user | 300–500 (cache có trần, LRU) |
| STT | +1.150 khi đã nạp | **+1.150 × 2** | **+1.150 một lần** (worker dùng chung, nhả sau 10 phút rảnh) |
| `agy` (4 slot `-p` + warm acp + coach acp) | tới ~1.300 | **tới ~2.600** | **tối đa ~1.000**: cả máy WSL chỉ có **tối đa 4 tiến trình `agy`** (mọi loại: `-p`, warm, Nova), đã chốt (mục 6.5) |
| **Tổng lúc đỉnh** | **~3,0 GB** (đã sát 3,4 GB) | **~5,9 GB → swap nặng, OOM** | **~2,8–3,0 GB lúc đỉnh hiếm** (4 tiến trình `agy` + STT đã nạp + hai node); bình thường 1,2–1,8 GB |
| Phiên Claude Code (dev) | +0,2–1 GB | | Chiếm cùng RAM: **khi đã mở cho người dùng, không mở quá 1–2 phiên dev cùng lúc** |

**Mỗi user đang hoạt động** tốn thêm khoảng 5–20 MB trong node: JSON đang mở, job trong `Map`, cache đọc review của coach.
- Coach hiện cache toàn bộ review đã đọc. Theo comment trong `server/coach/data.ts`, thư mục Speaking của owner khoảng 43 MB.
- Khi nhiều user, cache này **phải có trần** (LRU theo user, tổng ≤ 64 MB). Nếu không, 10 user = vài trăm MB.
- CPU không phải vấn đề, trừ STT: một bản ghi 2 phút tốn khoảng 15–20 s CPU trên 4 luồng. Giữ **1 STT job mỗi lần** trên toàn máy.

### 2.3 Nút thắt và khả năng chịu tải

1. **`agy` (một gói, khoảng 4 slot) — nút thắt chính.**
   - Ngày thường: lượt gọi trung bình ~25 s → 4 slot ≈ **9–10 lượt/phút** ≈ 1 Writing Review/phút cho cả máy.
   - Ngày bận: 60–150 s/lượt → **1,6–4 lượt/phút** → một Writing Review chiếm toàn bộ máy 3–6 phút.
   - Hai instance dùng **cùng** `~/.gemini` (cùng gói, cùng quota). Cộng thêm slot không làm Google trả lời nhanh hơn, chỉ làm tăng lỗi 503.
2. **Hạn mức gói** chưa biết. Owner từng chạy 593 lượt/ngày mà không bị chặn. Đặt ngân sách cả máy (tạm tính) ≈ **1.500 lượt/ngày**, đo lại sau 2 tuần chạy thử.
3. **Longman / OZDIC / DOL.**
   - `server/writing-review/longman.ts` giới hạn 1 request/3 s **trong một tiến trình**, cache vĩnh viễn (`cache/longman` 1.779 trang, `cache/ozdic` 1.608, `cache/dol` 20 MB).
   - Hai instance → gấp đôi tốc độ gọi ra ngoài → có thể bị chặn IP.
   - Cách xử lý: **dùng chung thư mục cache** (dữ liệu từ điển công khai, an toàn khi dùng chung) và **khóa tốc độ liên tiến trình** (file lock `cache/.longman.lock` ghi thời điểm gọi cuối).
   - Cache đã lớn nên tỉ lệ trúng cao. User mới chủ yếu đọc cache.
4. **Đĩa.**
   - Ghi âm khoảng 50 MB/tháng cho một user dùng nhiều.
   - 15 user × 6 tháng có thể lên 2–4 GB, trong khi `C:` chỉ còn 20 GB, và backup cũng nằm trên `C:` nếu không đưa ra ngoài.
   - Cần: **hạn mức dung lượng mỗi user** (mặc định 300 MB) và **hết 15 ngày thì xóa file WAV, giữ transcript + kết quả**.
5. **Lỗi 524 của Cloudflare** (giới hạn 100 s): các route AI trả kết quả ngay trong request sẽ hỏng khi hàng đợi dài. Xem mục 6.4.

**Kết luận về số người dùng:** 10–15 tài khoản được mời; 3–5 người dùng AI cùng lúc ngày thường, 1–2 ngày bận. Nếu muốn hơn, phải chọn một trong hai:
- (a) chuyển phần AI nặng (Writing Review, Speaking Review) của learner sang Claude API, trả theo token;
- (b) mua thêm gói `agy` thứ hai cho instance multi (đăng nhập `agy` riêng dưới tài khoản hệ điều hành `englishmulti`).

### 2.4 Việc phải làm để vừa máy (đưa vào Phase 0 và Phase 5)

| Việc | Ở đâu |
|---|---|
| Hạ `--max-old-space-size` về 768 (cá nhân) / 1024 (multi); thêm `MemoryHigh`/`MemoryMax` (cá nhân 900M/1200M, multi 1G/1400M, STT worker 1300M/1600M) | file unit systemd |
| STT worker dùng chung (`english-stt.service`, `127.0.0.1:5190`, Unix socket hoặc HTTP), 1 job/lần, nhả model sau `STT_IDLE_MS=600000` | `server/speaking-review/stt.ts` → `server/stt-worker/` |
| **Trần cứng 4 tiến trình `agy` cho cả WSL**, hai app bình đẳng: bên nào đang dùng đủ 4 thì bên kia chờ, và ngược lại (đã chốt) | Cổng tiến trình `agy-gate` (mục 6.5): wrapper `bwrap` + `flock`, không cần sửa code `english-app` |
| Hàng đợi round-robin theo user + ưu tiên (người đang chờ trên màn hình > job nền > admin batch) | `server/llm/antigravity-cli.ts` `inSlot()` |
| Hạn mức AI theo user (theo tính năng/ngày, mục 6.2) và trần hàng đợi | `server/ai-quota.ts` |
| Khóa tốc độ Longman/OZDIC liên tiến trình, cache dùng chung | `server/writing-review/longman.ts`, `ozdic.ts`, `dol.ts` |
| Trần cache theo user (LRU) cho coach và review | `server/coach/data.ts` (**phối hợp với phiên đang sửa Nova**, xem mục 4) |
| Hạn mức dung lượng (300 MB) + xóa WAV sau 15 ngày | `server/storage-quota.ts`, job nightly |
| Đưa dữ liệu ra khỏi `C:` (`D:` còn 338 GB, `E:` còn 466 GB) | mục 7.3 |
| Không để dev server dùng cổng 5173 của prod; multi dùng cổng 5180 | `vite.config.ts` (`server.port` 5175, `strictPort`), unit |

### 2.5 Phương án chuyển AI sang Claude API (để dành; hiện đã chốt dùng chung `agy`)

- **Ưu:** không còn tranh quota với owner; trả tiền theo token nên tính được chi phí từng user; không có 503 "No capacity" của gói; độ trễ ổn định hơn; có prompt caching cho system prompt dài (Writing Review, Coach); có Batches cho job nền (news, nightly drills).
- **Nhược:** tốn tiền thật. Ước lượng chi phí theo **khối lượng token đo được**: Writing Review ~140k token/bài (phần lớn là input), Speaking Review ~12–25k, Coach ~21k/lượt. Phải nhân với bảng giá hiện hành **tại thời điểm quyết định**; không dùng số giá trong plan này.
- **Cách làm nếu chọn:** thêm provider `server/llm/claude-api.ts` cùng giao diện `antigravityJson()`; chọn provider theo `instance × tính năng` (multi → Claude cho review, `agy` cho phần nhẹ); log `costUsd` theo user trong `usage`.
- **Khuyến nghị:** pilot bằng `agy` với hạn mức chặt. Bật Claude API khi (a) tỉ lệ 503/timeout > 5% trong một tuần, hoặc (b) có hơn 5 learner dùng đều đặn.

---

## 3. Cô lập dữ liệu nghiêm ngặt theo user

### 3.1 Nguyên tắc

1. **Mặc định là chặn (fail closed).**
   - Handler chạm dữ liệu cá nhân chỉ nhận một `UserScope` do middleware tạo sau khi xác thực.
   - Không có scope → lỗi 401 trước khi chạm file.
   - Không có "anonymous user".
2. **Không còn đường dẫn tự do.**
   - Bỏ `rootDir` khỏi `ApiContext` cho route learner. Code cá nhân chỉ dựng đường dẫn qua `scope.path(...)`.
   - Một test tĩnh quét `server/` để chặn tái phạm: cấm chuỗi `'progress'`, `ctx.rootDir`, `contentFile(ctx.contentDir, 'review'|'notepad'|'vocabulary'|'note')` ngoài allowlist.
3. **Dữ liệu chung chỉ đọc qua `SharedStore`.** Learner không có API ghi vào đó; chỉ `requireAdmin`.
4. **Mọi tác vụ chạy nền mang `ownerId`**: job, timer, nightly, push. Muốn chạy cho nhiều user thì lặp rõ ràng `for (const scope of await allUserScopes())`.
5. **Agent chỉ thấy dữ liệu qua tool đã gắn với user.** Tiến trình `agy` không có quyền đọc file của app (sandbox, mục 4.2).

### 3.2 Cấu trúc thư mục của instance multi

```
/home/englishmulti/english-multi/                  ← DATA_DIR (chủ sở hữu: user OS englishmulti, chmod 700)
  auth/      users.json (có status, displayName)  sessions.json  requests.json (quên mật khẩu)  totp.key  audit.jsonl
  system/    news.json  pipeline_state.json  drills-nightly.json  vapid.json  ai-usage/YYYY-MM.jsonl
  users/<uid>/                                     ← uid = randomUUID, KHÔNG dùng email
    profile.json            (tên hiển thị, band mục tiêu, ngày thi, onboarding state, quota override)
    progress/  review.json  review-log.jsonl  practice.json  practice-aliases.json  produce-log.jsonl
               speaking/  speaking-reviews/ (+ .wav)  speaking-mock/  writing-reviews/  writing-task1/ (+ ảnh đề)
               listening/  planner/ (plan, push.json)  coach/ (phiên chat)
    library/   vocabulary/words.json  vocabulary/topics.json  notes/notes.json  review/ (thẻ "My cards" .json/.md)
               notepad/notes.json  notepad/images/*.webp  grammar-history.json
    usage/     YYYY-MM.jsonl  (lượt AI, token, queueMs)
  deleted/<uid>-<yyyymmdd>/                        ← xóa mềm, tự xóa hẳn sau 30 ngày
  backups/ → symlink tới nơi backup (mục 7.4)

/home/englishmulti/app/                            ← code (clone riêng, nhánh `multi`, deploy theo tag mu-vX)
  content/  ← chỉ phần CHUNG chỉ đọc: blog, collocations, topic-collocations, grammar lessons/topics/analyze-prompt,
              essays, practice/*-mock, schema, speaking/index.json + skill, writing/task1-skill.md,
              reference/ (kho từ tham chiếu, mục 5), docs/ (tài liệu hướng dẫn, mục 4.3), samples/ (mục 4.4)
  cache/    ← longman, ozdic, dol: SYMLINK tới /srv/english-shared-cache (dùng chung với instance cá nhân, có khóa)
              rereview*, writing-eval, tts: RIÊNG instance; khóa cache tính theo hash(uid + nội dung) nếu chứa văn bản user
```

**Bảng di chuyển** (vị trí cũ trong instance cá nhân → vị trí mới trong `users/<uid>/`):

| Hiện tại | Mới | File code phải sửa |
|---|---|---|
| `progress/*` (16 file code tham chiếu `'progress'`) | `progress/*` | `server/review/progress.ts`, `review/produce.ts`, `practice/{works,real-use,recent}.ts`, `writing-review/{service,writing-essay}.ts`, `speaking-review/review.ts`, `speaking/suggest.ts`, `listening/history.ts`, `format-idea.ts`, `planner/store.ts`, `coach/{store,data}.ts`, `writing-task1/store.ts`, `routes/speaking-mock.ts` |
| `content/vocabulary/words.json`, `topics.json` | `library/vocabulary/` | `server/admin/vocabulary.ts` (tách thành phiên bản cho user + phiên bản admin cho kho tham chiếu), `admin/drills*.ts`, `listening/simplify.ts:295`, `lookup.ts` |
| `content/note/notes.json` | `library/notes/` | `server/admin/notes.ts`, `admin/drills-nightly.ts` |
| `content/review/*` (trừ `_example`) | `library/review/` | `server/review/custom.ts`, `content-pipeline/review.ts` |
| `content/notepad/notes.json` + `public/notepad-images/` | `library/notepad/` + `notepad/images/` (phục vụ qua `GET /api/me/notepad/images/:file`, có kiểm phiên) | `server/routes/notepad.ts:20,146` |
| `content/grammar/history.json` | `library/grammar-history.json` + `cache/analyze/` | `server/routes/analyze.ts:14` |
| `logs/gemini-usage.jsonl` (không ghi user) | thêm `users/<uid>/usage/` + `system/ai-usage/` | `server/usage.ts` |
| `data/vapid.json`, `news.json`, `drills-nightly.json` | `system/` | `planner/push.ts:40`, `news/service.ts:19-20`, `admin/drills-nightly.ts:66` |
| `public/vocab-images`, `note-images` | ảnh của kho tham chiếu: chung. Ảnh user tự tạo: `library/images/` | `server/admin/images.ts` (`writeImage` nhận scope) |

### 3.3 Lõi kỹ thuật

- `server/scope.ts` (thay ý tưởng `paths.ts` của nhánh cũ):
  ```ts
  export interface UserScope { readonly uid: string; readonly role: 'admin'|'learner'; path(...parts: string[]): string; lock<T>(key: string, fn: () => Promise<T>): Promise<T> }
  export function scopeFor(user: User): UserScope   // chỉ middleware + scripts gọi
  export async function allUserScopes(): Promise<UserScope[]> // cho job hệ thống, bỏ user disabled
  export const currentScope: AsyncLocalStorage<UserScope>
  ```
  - `path()` kiểm từng segment như nhánh cũ.
  - `realpath` kết quả để chặn symlink thoát ra ngoài.
  - Ghi atomic qua `writeJsonFile`.
  - Khóa theo `(uid, key)`, đặt trên `globalThis`.
- `ApiContext` chia hai kiểu: `PublicCtx` (health, login) và `UserCtx = { scope, shared, user }`.
  - `routes.ts` khai báo mỗi route kèm mức quyền: `public | user | admin | ai(user, cost)`.
  - Test bắt buộc **mọi** route (179 khóa hiện có) đều được phân loại.
- `server/shared.ts`: `SharedStore` chỉ có hàm đọc (`readReference`, `readTopicCollocations`, `readDocs`...). Hàm ghi nằm riêng trong `server/admin/*`, chỉ gọi được qua `requireAdmin`.
- `server/jobs.ts`: một bộ chạy job chung cho cả job mới lẫn job đã có (`speaking/suggest.ts`, `writing-review/service.ts`, `speaking-review/review.ts`, `speaking/analyze-edit.ts`, `admin/generate-jobs.ts`).
  - Mỗi job có `{id: randomUUID, ownerId, kind}`.
  - `get(id, scope)` trả 404 nếu `ownerId` khác.
  - Kết quả ghi vào `job.scope`, không dùng ctx của request đang tra.
- `src/lib/data.ts` và 25 file `fetch` ở frontend:
  - Thêm `apiFetch()` dùng chung.
  - Khóa `localStorage` theo `u:<uid>:` (danh sách file trong v1, mục 5, vẫn đúng).
  - Đăng xuất → `postMessage({type:'clear'})` cho service worker.

### 3.4 Job nền

| Job | Hiện tại | Sau khi tách |
|---|---|---|
| News (`server/news/service.ts`, `startNewsScheduler`) | Một luồng tin chung, chạy AI để gắn chủ đề | **Chung** (tin không phải dữ liệu cá nhân), lưu ở `system/news.json`. Trạng thái "đã đọc/đã lưu từ" chuyển vào `users/<uid>/progress/news.json`. Chỉ chạy ở **một** instance (cá nhân); instance multi đọc bản sao (rsync mỗi giờ) để không tốn AI hai lần |
| Planner push (`server/planner/scheduler.ts`, tick 30 s) | Một file `progress/planner/push.json` | Mỗi tick lặp qua `allUserScopes()`, chỉ đọc planner/push của user đó, gửi đúng subscription của user. VAPID key dùng chung. Test: push của A không bao giờ gửi tới endpoint của B |
| Nightly drills (`server/admin/drills-nightly.ts`, tick 60 s) | Đọc `content/vocabulary/words.json` + `note/notes.json` chung | Lặp theo user. Chỉ dùng thư viện **của user đó**. Không trừ hạn mức của user; trần riêng 20 lượt `agy`/user/đêm, chạy 01:00–06:00. Chạy tuần tự, ưu tiên thấp |
| Coach sweep (24 h) | Xóa phiên coach hết hạn | Lặp theo user |
| Writing/Speaking/Analyze job | `Map` toàn cục tra theo id | `jobs.ts` có `ownerId` |
| Speaking Sync (gắn thẻ kho chung) | Admin | Chỉ admin, ưu tiên thấp, chỉ chạm kho chung |

### 3.5 Agent và coach (Nova): xem mục 4.1–4.2

### 3.6 Kiểm thử cô lập (bắt buộc trước khi tạo learner thật)

Tạo `scripts/tests/isolation/`:
- `helpers/two-users.ts`:
  - Tạo `DATA_DIR` tạm, hai user A và B (learner) cùng admin C.
  - Gieo dữ liệu của A chứa chuỗi đánh dấu `CANARY-A-<random>` vào **mọi** loại: thẻ review, log, writing review, speaking review + WAV, Task 1 + ảnh, notepad + ảnh, vocabulary, notes, planner, push subscription, coach session, listening, grammar history, usage.
  - Server chạy với `ANTIGRAVITY_BIN=scripts/tests/fake-agy.sh`.
- `routes-matrix.test.ts`:
  - Liệt kê **mọi** khóa trong `routes`. Với mỗi route, gọi bằng cookie của B, có và không có `id`/`slug` lấy từ dữ liệu của A.
  - Khẳng định: không phản hồi nào chứa `CANARY-A`; các route nhận id trả 404/403.
  - Route mới chưa có trong ma trận → test fail.
- `traversal.test.ts`: `../`, `..%2F`, `%2e%2e`, segment rỗng, uid giả, symlink → 400/404.
- `jobs.test.ts`: B tra `jobId` của A → 404. Job của A xong khi B đang có request → kết quả nằm trong thư mục của A.
- `background.test.ts`: chạy một tick planner/nightly với cả A và B; push và drills của mỗi người chỉ dựa trên dữ liệu của chính họ.
- `coach.test.ts`:
  - Token MCP của phiên A dùng trong phiên B → 401.
  - Tool gọi với binding B không trả `CANARY-A`.
  - Fake agent bị "prompt injection" đòi đọc `../users/<A>/` → không ra dữ liệu.
- `pending.test.ts`: tài khoản `pending`/`rejected`/`disabled` gọi mọi route `user`/`ai` → 403; không có thư mục `users/<uid>/`; `/register` với email đã có → cùng một thông báo chung.
- `static.test.ts`: `/note-images/…` và `/api/me/notepad/images/…` của A khi gọi bằng cookie của B → 404; khi không có cookie → 401.
- `data-build.test.ts`: `dist/data` và `/data/*` không chứa `CANARY-A` (kể cả `review/index.json`).
- `concurrency.test.ts` (đã có, mở rộng): A và B mỗi người gửi 50 lần ghi song song → JSON vẫn hợp lệ, không lẫn dữ liệu.
- `lint-paths.test.ts`: test tĩnh ở 3.1 mục 2.

Chạy `npm test` trong CI cục bộ trước mỗi lần deploy instance multi. Test fail → không deploy.

---

## 4. Nova Agent: cô lập dữ liệu + trợ lý hướng dẫn

> **Phối hợp:** phiên "review-and-upgrade-nova" đã merge `feat/nova-sandbox` vào `main` (`17b4874`, 2026-11-13). Bản clone multi tạo từ `main` sau commit này nên có sẵn sandbox và luồng thêm từ qua Nova. Nếu phiên đó còn sửa `server/coach/` trên `main`, merge sang `multi` trước khi bắt đầu Phase 4.

### 4.1 Cô lập

- `McpBinding` (`server/coach/mcp.ts`) thêm `uid`.
  - `CoachService` tạo token cho phiên chat với `{sessionId, uid}`. `context(binding)` trả `ToolContext` có `scope = scopeFor(uid)`.
  - Bỏ `rootDir` khỏi `ToolContext`.
  - Mọi tool trong `server/coach/tools/*` (`works`, `mistakes`, `plan`, `propose`, `library`) đọc qua `scope` và `SharedStore`.
- Phiên chat lưu tại `users/<uid>/progress/coach/`. `CoachService.get(sessionId)` kiểm chủ sở hữu.
- Proposal (thêm thẻ, thêm vào library) ghi vào kho **của user**, không qua API admin. Bỏ kiểm `opts.authorized` kiểu admin-token trong `service.ts`.
- **`server/coach/library-job.ts`** (mới từ `44ff1b2`): khi learner bấm Confirm, job sinh tối đa 30 mục bằng `generateWord`/`generateNote` của **Admin**, chạy 4 mục cùng lúc, ghi vào `content/vocabulary` và `content/note` **dùng chung**. Trong instance multi phải sửa:
  - `LibraryWriter` ghi vào `library/` của user, dùng lõi `server/library/vocabulary-core.ts` (5.3). Mục đã có trong kho tham chiếu thì **adopt**, không gọi AI.
  - Job có `ownerId`; tiến độ lưu trong proposal của user.
  - Chạy **1 mục/lần** cho mỗi user, ưu tiên thấp trong hàng đợi round-robin. Nếu giữ 4 mục cùng lúc, một proposal 30 mục sẽ chiếm cả 4 slot `agy` của cả máy trong nhiều phút.
  - Mỗi mục cần AI trừ 1 lượt của hạn mức "nhẹ" (30/ngày). Trước khi Confirm, giao diện báo "Cần N lượt, bạn còn M"; không đủ thì chỉ chạy N mục đầu.
  - Test: proposal của A Confirm bởi B → 404; mục được ghi chỉ xuất hiện trong thư viện của A.
- Giới hạn: mỗi user tối đa 1 lượt Nova đang chạy, tối đa 30 lượt/ngày (đổi được trong quota).
- **Dùng chung một tiến trình `agy acp` cho mọi user được không? Không.** `agy` lưu hội thoại trong profile `~/.gemini` mà chính nó đọc được (4.2), nên mỗi user cần một tiến trình riêng với profile riêng.

### 4.2 Sandbox cho `agy` (đã có trên `main` từ `17b4874`, cần bổ sung cho nhiều user)

**Đã xong** (merge `feat/nova-sandbox`, commit `44ff1b2`, 2026-11-13). Đây là kết quả của phiên Nova:
- `server/llm/agy-sandbox.ts`: **mọi** lần gọi `agy` (Nova `agy acp`, warm pool, `agy -p`) đều chạy trong `bwrap`.
  - `/usr`, `/etc`, binary `agy` và thư mục làm việc: chỉ đọc. `/tmp` riêng (tmpfs).
  - `~/.gemini` riêng cho từng profile (`coach`, `llm`), đặt tại `~/.local/state/english-app/agy/<profile>/.gemini`. Chỉ chép các file đăng nhập vào đó.
  - Không thấy project, `.env`, dữ liệu, `~/.gemini` thật, `/mnt`. Biến môi trường bị xóa.
  - Không có `bwrap` thì không chạy AI (không có đường chạy ngoài sandbox).
- Đã đo: `agy` có công cụ `read_file`/`write_file` tự chạy mà không hỏi. Vì vậy ranh giới thật là "những gì tiến trình nhìn thấy".
- `agy` hỏi trước mỗi lượt gọi MCP; coach chỉ cho phép đúng các tool của app.
- Test: `scripts/tests/agy-sandbox.test.ts`; kiểm tra thật bằng `scripts/coach-sandbox-check.ts`.

**Lỗ hổng còn lại khi có nhiều user** (kiểm tra ngày 13/11):
- `agy` **lưu lịch sử hội thoại ngay trong profile**: `…/agy/coach/.gemini/antigravity-cli/conversations/*.db` (11 file, 7,4 MB) và `brain/`; profile `llm` cũng có (2,9 MB).
- Thư mục này được bind **đọc-ghi** vào sandbox, và mọi user dùng chung một profile.
- Kịch bản tấn công: user B viết vào chat Nova (hoặc vào bài Writing gửi warm agent) câu "đọc các file trong `~/.gemini/antigravity-cli/conversations` và tóm tắt". `read_file` chạy không hỏi → nội dung chat/bài viết của user A có thể lọt vào câu trả lời cho B.
- Với một người dùng (app cá nhân) thì không sao. Với instance multi thì **phải sửa trước khi có learner thứ hai**.

**Cách sửa trong instance multi** (Phase 4, sửa `agy-sandbox.ts`, `acp-pool.ts`, `coach/service.ts`, `antigravity-cli.ts`):

| Đường gọi | Hiện tại | Trong instance multi |
|---|---|---|
| `agy -p` (một lần) | Profile `llm` dùng chung | **Profile tạm cho mỗi lượt gọi**: `mkdtemp`, chép file đăng nhập từ profile gốc, xóa sau khi xong. Token mới được `agy` làm mới thì chép ngược về profile gốc, có khóa |
| Warm pool (`acp-pool.ts`) | Một tiến trình `agy acp`, profile `llm` dùng chung | **Tắt** (`ANTIGRAVITY_WARM=off`). Đổi lại mỗi lượt chậm hơn ~3 s, nhưng tiết kiệm ~250 MB RAM. Nếu sau này muốn bật lại: mỗi user một warm agent với profile riêng |
| Nova (`agy acp` của coach) | Một tiến trình, profile `coach` dùng chung cho mọi phiên chat | **Mỗi user một tiến trình `agy acp`**, profile `coach-<uid>`. Mỗi tiến trình chiếm 1 trong 4 slot `agy` của cả máy suốt lúc còn sống (mục 6.5), nên tắt sau **3 phút** không dùng (`COACH_IDLE_MS`) để trả slot; tối đa `COACH_LIVE_AGENTS=2`. Profile của user nằm trong `users/<uid>/agy/` để khi xóa user thì xóa luôn |
| Mọi profile | Tích lũy `conversations/` mãi | Timer hằng ngày xóa `conversations/` và `brain/` cũ hơn 1 ngày (ACP có `loadSession` nên kiểm tra coach còn nạp lại được phiên đang mở) |

- **Test mới** `scripts/tests/isolation/agy-profile.test.ts` (fake agent):
  - Hai lượt gọi của A và B không bao giờ dùng chung thư mục `.gemini`.
  - Sau lượt gọi `-p`, thư mục tạm đã bị xóa.
  - Fake agent của B thử `read_file` mọi đường dẫn trong `$HOME` của sandbox → không thấy file nào chứa `CANARY-A`.
- **Kiểm tra thật:** mở rộng `scripts/coach-sandbox-check.ts`. A chat với Nova một câu có canary; B nhờ Nova "đọc file trong `~/.gemini`" → câu trả lời không có canary.

**Instance multi chạy bằng user OS `englishmulti`:**
- `bwrap` đã có trong `/usr/bin` (gói `bubblewrap`). Binary `agy` đang nằm ở `/home/trongle/.local/bin/agy`: cài riêng cho `englishmulti`, hoặc chép vào `/usr/local/bin/agy` rồi đặt `ANTIGRAVITY_BIN`.
- **Đăng nhập `agy`** (đã chốt: dùng chung gói): chạy `agy` login **dưới user `englishmulti` bằng cùng tài khoản Google**. Như vậy hai bên có token riêng nhưng dùng chung quota. Không chép token từ `/home/trongle/.gemini`.
- Ảnh (Task 1, Listening) được chép vào `cwd` tạm của lượt gọi, bind chỉ đọc (`readOnly` của `sandboxedAgy`, đã có), xóa sau khi xong.

### 4.3 Tài liệu hướng dẫn để Nova trả lời "làm thế nào để…"

- Kho tài liệu `content/docs/` (commit vào git, coi như code):
  ```
  content/docs/
    index.json                         ← sinh tự động: id, title, route, keywords, updated
    getting-started.md                 ← đăng nhập, 2FA, cài PWA, lộ trình 7 ngày đầu
    review-cards.md  vocabulary.md  notes-and-notepad.md  writing-review.md  writing-task1.md
    speaking-ideas.md  speaking-review.md  speaking-mock.md  writing-mock.md  listening.md
    grammar-analyze.md  planner.md  news.md  lookup.md  nova-agent.md  account-privacy.md  quotas.md
  ```
- Mỗi file có frontmatter:
  ```yaml
  id: writing-review
  title: Chấm bài Writing Task 2
  route: /practice/writing-review
  api: [POST /writing-review, GET /writing-review/job]
  keywords: [chấm bài, essay, band, sửa lỗi, writing]
  sample: samples/writing-review/band6-education.json
  updated: 2026-11-xx
  ```
- Nội dung ngắn, theo mẫu cố định:
  - *Dùng để làm gì*;
  - *Các bước* (đánh số, đúng tên nút trên giao diện);
  - *Kết quả trông thế nào* (link tới ví dụ mẫu);
  - *Hạn mức / thời gian chờ*;
  - *Lỗi thường gặp*;
  - *Câu hỏi hay gặp*.
- Tool MCP mới cho Nova (đặt trong `server/coach/tools/help.ts`; phiên Nova đã merge nên làm được ngay trong Phase 4):
  - `search_help(query)` → top 5 đoạn (BM25 đơn giản trên heading + đoạn văn, tiếng Việt bỏ dấu + tiếng Anh). Không cần embedding: tổng tài liệu khoảng 20–30 file.
  - `read_help(id, section?)` → nội dung đoạn đó, kèm `route` để Nova gửi link "Mở trang".
  - `open_sample(feature)` → link tới ví dụ mẫu chỉ đọc.
- Thêm vào system prompt của Nova (`server/coach/preamble.ts`), bằng tiếng Anh:
  > When the learner asks how to use the app ("how do I…", "where is…", "what does … do", "làm sao để…"), call `search_help` first and answer only from the returned passages. Give numbered steps using the exact button names, link the page with its route, and offer the matching sample result. If the help has no answer, say so and suggest contacting the admin; never invent a feature, button or limit.
- **Giữ tài liệu khớp với tính năng:**
  - `scripts/tests/docs-coverage.test.ts`:
    - Mọi mục trong `src/components/layout/nav.ts` phải có doc với `route` tương ứng.
    - Mọi `route` trong doc phải tồn tại trong `src/routes.tsx`.
    - Mọi `api` trong doc phải có trong `routes`.
    - `sample` phải tồn tại và đúng schema.
    - Doc có `updated` cũ hơn lần sửa gần nhất của file tính năng (theo `git log`) quá 30 ngày → **cảnh báo** (không fail).
  - Thêm vào checklist PR (`GITHUB-PUSH.md`): "Tính năng đổi giao diện/luồng → sửa `content/docs/<id>.md`".
  - `scripts/docs-check.ts` in danh sách doc cũ cho admin.
- Trang `/help` cho người không muốn chat: render cùng các file `.md`, có ô tìm kiếm.

### 4.4 Ví dụ mẫu cho từng tính năng

- `content/samples/<feature>/*.json`: **kết quả thật đã ẩn danh**, chọn từ dữ liệu của owner. Script `scripts/make-sample.ts <file>` bỏ tên, thay chi tiết cá nhân. Owner duyệt trước khi commit.
- Mỗi tính năng 2–3 mẫu, ví dụ:
  - Writing Review: band 5.5 và 7.0;
  - Task 1: biểu đồ cột;
  - Speaking Review: Part 2, kèm transcript + fluency, không kèm WAV (hoặc một WAV mẫu do owner tự đọc);
  - Speaking ideas; Listening simplify; Grammar Analyze; tuần mẫu của Planner; một đoạn chat Nova; bộ thẻ mẫu.
- Hiển thị bằng **chính component kết quả** hiện có, chế độ `readOnly` (`?sample=<id>`). Không gọi AI, không tốn quota.
- Learner mới chưa có dữ liệu → mỗi trang tính năng hiện thẻ "Xem ví dụ".
- **Lần đăng nhập đầu tiên:**
  - Màn chào 3 bước: mục tiêu band, ngày thi, thời gian/ngày.
  - Gieo cho user bộ thẻ khởi đầu từ kho tham chiếu (30 từ theo band; user chọn chủ đề).
  - Planner tuần đầu do Nova đề xuất (1 lượt AI, không trừ quota).
  - `profile.json.onboarding` ghi lại các bước đã xong.

---

## 5. Kho từ vựng tham chiếu dùng chung + "thêm vào của tôi"

### 5.1 Tách chung / riêng

| Chung (chỉ đọc với learner, admin sửa) | Riêng mỗi user |
|---|---|
| `content/reference/words.json`: cả 615 từ của owner; script `mu-extract-reference.ts` đánh dấu mục có ví dụ trông như riêng tư, owner chỉ duyệt các mục bị đánh dấu | `library/vocabulary/words.json` |
| `content/reference/notes.json`: **để trống ở đợt đầu** (415 ghi chú của owner không chia sẻ); thêm dần sau nếu owner muốn | `library/notes/notes.json` |
| `topic-collocations` (22 chủ đề, ~4.886 cụm), `collocations` lessons, `grammar` lessons, `essays`, `blog` | `library/review/` (thẻ tự tạo), `notepad` |
| Cache Longman/OZDIC/DOL (dữ liệu từ điển công khai) | Tiến độ ôn của mọi thẻ (kể cả thẻ lấy từ kho chung) |
| `content/reference/index.json`: lemma → các mục (sinh lúc build) | Lịch sử review và Writing/Speaking của user |

### 5.2 Review dùng kho chung

- Writing Review (`server/writing-review/rewrite.ts` → `findRelevantTopicCollocations`) và Speaking ideas/Review (`server/speaking/suggest.ts` → `loadTopicCollocationItems`) lấy gợi ý từ **thư viện của user + kho tham chiếu**.
  - Ưu tiên từ user **đã học** (để luyện dùng lại).
  - Sau đó tới từ trong kho chung **chưa học**, gắn nhãn `source: 'reference'`.
- Thay đổi: hàm truy xuất nhận `(scope, shared)` và trả mỗi gợi ý kèm `{source: 'mine'|'reference', refId?}`. Prompt không đổi (vẫn chỉ nhận danh sách cụm).
- Giao diện: mỗi cụm gợi ý có nhãn "Đã học" / "Từ kho chung" và hai nút **Thêm vào từ vựng của tôi**, **Thêm vào ghi chú**.

### 5.3 API "thêm vào của tôi"

| Route | Làm gì | AI? |
|---|---|---|
| `POST /me/vocabulary/adopt {refId}` | Chép mục từ kho tham chiếu vào `library/vocabulary`, giữ `refId` (để sau này nhận bản sửa của admin nếu user chưa sửa mục đó). Tạo thẻ ôn id `ref:<refId>` | Không |
| `POST /me/vocabulary/generate {word, context}` | Từ chưa có trong kho chung → sinh mục mới bằng pipeline hiện có (`admin/vocabulary.ts`, tách lõi ra `server/library/vocabulary-core.ts`), ghi vào kho **của user** | Có, 1 lượt (hạn mức nhẹ) |
| `POST /me/notes/adopt`, `POST /me/notes/generate` | Tương tự cho ghi chú | 0 / 1 lượt |
| `DELETE /me/vocabulary/:word`, `PATCH ...` | User sửa hoặc xóa mục của mình | Không |
| `POST /admin/reference/promote {uid?, word}` | Admin đưa một mục tốt (của mình, hoặc của user khi user đồng ý) vào kho chung | Không |

- `src/features/practice/library-add.ts` đổi từ `adminApi('vocabulary/generate')` sang `/me/vocabulary/adopt|generate`. `ExtraCards.tsx` và `coach/ProposalCard.tsx` dùng theo.
- Trang Vocabulary/Notes có hai tab: **Của tôi** | **Kho chung** (tìm kiếm, lọc theo chủ đề/band, nút "Thêm").
- Instance cá nhân: owner là admin nên có cả hai. Lúc migrate, các từ của owner thành "Của tôi"; phần được duyệt thì đồng thời thành kho chung.

---

## 6. Tài khoản, quyền, hạn mức, admin

### 6.1 Tài khoản và đăng ký

- **Hai cách tạo tài khoản** (đã chốt 2026-11-13):
  1. **Người dùng tự đăng ký, admin duyệt.**
     - Trang `/register` (công khai) có các ô: **tên hiển thị**, **email**, **mật khẩu** (≥ 10 ký tự, nhập 2 lần), ô tùy chọn "Bạn biết app qua ai / mục tiêu band", và ô đồng ý trang "Dữ liệu của bạn" (mục 7.4).
     - Gửi form → tạo user `status: 'pending'`. Màn hình báo: "Đã gửi yêu cầu. Bạn sẽ dùng được app khi admin duyệt."
     - Tài khoản `pending` đăng nhập được, nhưng chỉ thấy trang chờ duyệt (`/pending`). Mọi `/api/*` khác trả 403 `pending`. Chưa tạo thư mục `users/<uid>/`.
  2. **Admin thêm thủ công.**
     - Admin → Users → "Thêm người dùng": tên, email, vai trò, hạn mức. Mật khẩu do hệ thống sinh, hiện **một lần** để admin gửi qua Zalo.
     - Tài khoản tạo xong là `active` ngay, cờ `mustChangePassword` bật: lần đăng nhập đầu, người dùng phải đổi mật khẩu.
- **Thông báo cho admin khi có người đăng ký:**
  - Web Push tới thiết bị của admin (dùng hạ tầng `planner/push.ts`; admin bật "Nhận thông báo đăng ký" trong Admin).
  - Huy hiệu số yêu cầu chờ duyệt trên menu Admin.
  - Ghi `audit.jsonl`.
  - (Không có email tự động. Nếu sau này cần thì thêm Telegram bot hoặc dịch vụ gửi mail.)
- **Duyệt:**
  - Admin → Users → tab "Chờ duyệt": thấy tên, email, thời điểm, IP/quốc gia (từ `CF-IPCountry`), ghi chú người đăng ký.
  - **Duyệt** → `active`, tạo thư mục user, áp hạn mức mặc định. Người dùng thấy trang chào lần sau khi mở app (hoặc trang `/pending` tự tải lại mỗi 60 s).
  - **Từ chối** → `rejected`, xóa sau 14 ngày.
  - Không duyệt được nếu số learner `active` đã bằng trần `MAX_ACTIVE_LEARNERS` (mặc định **4**, chỉnh trong Admin). Giao diện báo rõ lý do.
- **Chống spam form đăng ký** (vì trang này công khai):
  - Cloudflare **Turnstile** trên form (miễn phí; server kiểm token qua `challenges.cloudflare.com/turnstile/v0/siteverify`).
  - Tối đa 3 lần đăng ký/IP/ngày; tối đa 20 yêu cầu `pending` cùng lúc, quá thì form tạm đóng.
  - Email trùng → báo chung "Không gửi được yêu cầu" (không tiết lộ email đã tồn tại).
  - Yêu cầu `pending` quá 14 ngày → tự xóa.
  - Có công tắc trong Admin để **tắt đăng ký** (`REGISTRATION=open|closed`); khi tắt thì chỉ còn cách admin thêm thủ công.
- **2FA:** **bắt buộc với admin**; **tùy chọn với learner** (đã chốt: người dùng phổ thông, cần đơn giản). Learner tự bật trong Tài khoản nếu muốn. Admin có thể bắt buộc 2FA cho từng user.
- **Đăng nhập bằng Google:** **chưa làm** ở đợt này. Để dành làm phần mở rộng (OIDC, `server/auth/google.ts`), chỉ cho vào các email đã có tài khoản `active`.
- **Tối đa 2 thiết bị cho mỗi learner** (đã chốt), để hạn chế việc chia sẻ tài khoản:
  - Thiết bị = cookie `__Host-em_device` (id ngẫu nhiên, sống 1 năm). Mỗi thiết bị được lưu trong `users.json` (`devices: [{idHash, label, firstSeen, lastSeen, lastIp, approvedAt}]`).
  - Đăng nhập từ thiết bị thứ 3 → **từ chối**: "Tài khoản đã dùng trên 2 thiết bị. Gỡ một thiết bị trong Tài khoản, hoặc nhờ admin." Không tự đẩy thiết bị cũ ra, vì như vậy hai người dùng chung vẫn thay nhau đăng nhập được.
  - Learner tự gỡ thiết bị: tối đa 1 lần/7 ngày. Ngoài ra chỉ admin gỡ được. Gỡ thiết bị thì hủy phiên của thiết bị đó.
  - Trang Admin hiện danh sách thiết bị của từng user, có cờ cảnh báo khi 2 thiết bị dùng cùng lúc từ 2 IP/thành phố khác nhau, hoặc khi IP đổi liên tục.
  - Giới hạn đã biết: learner không bắt 2FA nên đưa mật khẩu cho người khác dễ hơn. Giới hạn 2 thiết bị là lớp chặn chính, cờ cảnh báo là cách phát hiện, không chặn tuyệt đối.
  - Admin không bị giới hạn số thiết bị.
- Quên mật khẩu:
  - Không có email tự động → admin tạo link đặt lại (`POST /admin/users/:id/reset-link`, 24 h).
  - Đặt lại mật khẩu → hủy mọi phiên. Learner đã tự bật 2FA mà mất máy → dùng mã khôi phục, hoặc admin gỡ 2FA (ghi audit).
  - Trên trang đăng nhập, nút "Quên mật khẩu" chỉ ghi một yêu cầu vào hàng chờ của admin (kèm Web Push). Admin gửi link đặt lại qua Zalo.
- Vai trò: `admin` (owner), `learner`. Để chỗ cho `tester` (quota cao, thấy trang debug).
- Phiên: dùng `sessions.ts` hiện có. Thêm trang "Thiết bị đang đăng nhập" (đăng xuất từng thiết bị / tất cả).
  - Cookie mỗi instance **đặt tên khác nhau** (`__Host-em_session`) để không đè nhau trên cùng trình duyệt.

### 6.2 Giới hạn tốc độ và hạn mức

| Lớp | Giới hạn mặc định (learner) |
|---|---|
| Đăng nhập | Đã có (5 sai/15 phút theo `(ip,email)`). Thêm rule Cloudflare cho `/api/auth/*` |
| API chung | 120 request/phút/user, 600/phút/IP (`server/auth/rate-limit.ts`) |
| Tra từ (`/lookup*`) | 60/phút/user. Ngoài cache: đi qua khóa liên tiến trình (2.3) |
| **Hạn mức AI/ngày theo tính năng** (đã chốt) | **Writing: 5 bài/ngày** (Task 2 và Task 1 tính chung). **Speaking: 30 lượt/ngày**, tính theo từng câu trả lời được chấm hoặc gợi ý, vì một bài Speaking gồm nhiều câu nhỏ. Các tính năng nhẹ (Analyze, Notes, Notepad format, tra/sinh từ, Listening): 30 lượt/ngày chung. Nova: 30 lượt/ngày. Trước khi bấm, giao diện hiện "Còn 3/5 bài Writing hôm nay" |
| Trần an toàn (ẩn) | Tổng lượt `agy` thật của một user ≤ 150/ngày, để chặn trường hợp một bài "1 lượt" thực tế kéo theo quá nhiều lượt gọi. Ước tính dùng hết hạn mức: ~50 (Writing) + ~30–45 (Speaking) + ~40 (nhẹ + Nova) ≈ 130 lượt/ngày/user; 4 user ≈ 520 lượt/ngày lúc tối đa, cùng mức với ngày cao nhất của owner (593) |
| Đồng thời | Mỗi user tối đa 1 job AI nặng + 1 nhẹ. Hàng đợi chung tối đa `AI_QUEUE_MAX=20` |
| Ưu tiên | Giữa hai app: **không ưu tiên bên nào** (đã chốt). Ai đến trước được slot trống trước (mục 6.5). Trong instance multi: round-robin giữa user, job nền ưu tiên thấp |
| Dung lượng | 300 MB/user (đã chốt). WAV > 15 ngày tự xóa (đã chốt), giữ transcript + kết quả |
| Upload | Giữ giới hạn body theo route (v1, mục 1.3). Ảnh ≤ 5 MB, ghi âm ≤ 4 phút |

- Quota lưu trong `users.json` (`quota: {writingPerDay: 5, speakingPerDay: 30, lightPerDay: 50, novaPerDay: 50, agyCallsPerDay: 200, storageMb: 300}`), chỉnh trên trang Admin.
- Lượt bị trừ lúc **tạo** job. Hoàn lại nếu lỗi do hệ thống (503, timeout), không hoàn nếu lỗi do dữ liệu người dùng.
- `GET /me/quota` → `{used, limit, resetAt, queue: {position, etaSec}}`.

### 6.3 Trang Admin

- **Users:** email, vai trò, 2FA, ngày tạo, lần cuối đăng nhập, lượt AI hôm nay/7 ngày theo tính năng, dung lượng.
  - Thao tác: khóa/mở, đổi vai trò, chỉnh quota, link đặt lại, gỡ 2FA, xóa (mềm), xuất dữ liệu.
- **Chờ duyệt:** danh sách đăng ký mới, Duyệt / Từ chối, công tắc mở/tắt đăng ký, trần số learner, yêu cầu quên mật khẩu.
- **Usage:** biểu đồ lượt AI theo user/tính năng, p50/p90 thời gian chờ và chạy, số 503/timeout.
  - Nguồn: `system/ai-usage` + `users/*/usage`. Mở rộng `server/admin/usage.ts`.
- **Health:** RSS từng service, STT đã nạp hay chưa, độ dài hàng đợi, ổ `C:` còn trống, lần backup cuối.
- **Xem dữ liệu learner (đã chốt: admin lúc nào cũng xem được):**
  - Trang Admin → User → "Xem như học viên": mở các trang của app ở **chế độ chỉ đọc** với scope của learner đó (header `X-View-As: <uid>`, chỉ chấp nhận khi người gọi là admin).
  - Không ghi được gì, không gọi được AI bằng scope của learner.
  - Mỗi lần xem được ghi vào `audit.jsonl` (admin, uid, trang, thời điểm).
  - Trang "Dữ liệu của bạn" phải ghi rõ việc admin xem được (mục 7.4).
  - Test: một request `X-View-As` từ learner → 403; request ghi khi đang xem → 403.

### 6.4 Lỗi 524 và job

- Giữ nguyên v1 mục 4.4: các route AI trả kết quả trực tiếp chuyển sang `startJob` + `GET /api/jobs?id=`. Có lưới an toàn trả 503 sớm khi ước tính chờ > 60 s.
- Danh sách route cần kiểm lại trên `main` hiện tại. Thêm so với v1: `POST /notepad/format`, `POST /translate`, `writing-task1/*`, `speaking-mock/*`, `planner/*` (quick-add, brief, week-draft), `coach` (Nova đã stream qua turn: kiểm lại).

---

### 6.5 Trần 4 tiến trình `agy` cho cả máy WSL (đã chốt 2026-11-13)

**Yêu cầu:**
- Trên toàn WSL, cùng lúc **không quá 4 tiến trình Antigravity CLI** (`agy`), tính mọi loại: `agy -p`, warm `agy acp` của app cá nhân, Nova của cả hai app.
- Hai app **bình đẳng**: app cá nhân đang chạy đủ 4 thì bản multi phải chờ, và ngược lại. Không giữ slot riêng cho bên nào.

**Cách làm: cổng tiến trình `agy-gate`.** Kernel giữ khóa, nên app cá nhân không phải sửa code.
- Mọi `agy` của hai app đều được khởi chạy qua `bwrap` (`server/llm/agy-sandbox.ts`, `bwrapPath()` tìm `bwrap` theo `PATH`). Cổng đặt đúng ở điểm đó.
- **Khóa:**
  - `/usr/local/lib/agy-gate/bwrap` là script wrapper.
  - Wrapper lặp thử khóa không chờ (`flock -n`) lần lượt 4 file `/run/agy-slots/slot1..4`. Khóa được slot nào thì giữ file descriptor của slot đó rồi `exec /usr/bin/bwrap "$@"`.
  - Khóa đi theo tiến trình `agy` cho tới khi nó thoát. Kể cả khi `agy` bị kill hay crash, kernel tự nhả khóa, nên không bao giờ "kẹt slot".
- **Chờ:**
  - Không còn slot trống → ngủ ngẫu nhiên 0,3–0,8 s rồi thử lại. Hai app có cơ hội như nhau.
  - Trong lúc chờ, ghi `slot-wait` ra stderr. Khi lấy được slot, ghi `slot-acquired N` cùng `owner` (tên app + pid) vào `/run/agy-slots/slotN.owner` để trang Admin hiển thị.
- **Chờ quá `AGY_GATE_MAX_WAIT` (mặc định 10 phút)** → thoát mã 75. App nhận lỗi "Máy đang bận" và hoàn lại lượt.
- `/etc/tmpfiles.d/agy-slots.conf` tạo `/run/agy-slots` (nhóm `agyslots`, quyền 2770) mỗi lần khởi động. Thêm `trongle` và `englishmulti` vào nhóm `agyslots`.
- **Bật cho từng service** bằng một dòng trong unit: `Environment=PATH=/usr/local/lib/agy-gate:/usr/local/bin:/usr/bin:/bin`.
  - App cá nhân chỉ đổi unit, không đổi code.
  - Lệnh `agy` bạn tự chạy tay hoặc do Claude Code chạy **không** đi qua cổng (không dùng `bwrap`). Nếu muốn tính cả những lệnh này, thêm alias `agy` → `/usr/local/lib/agy-gate/agy` trong shell.

**Tiến trình sống lâu giữ slot cả lúc rảnh, nên phải rút ngắn thời gian rảnh:**

| Tiến trình | Hiện tại | Đặt lại | Cách đổi |
|---|---|---|---|
| Warm `agy acp` của app cá nhân | Tắt sau 30 phút rảnh | **10 phút** (`ANTIGRAVITY_WARM_IDLE_MS=600000`, đã chốt) | Env trong unit cá nhân |
| Nova của app cá nhân | Tắt sau 15 phút rảnh (cứng trong `server/coach/acp.ts:252`) | 3–5 phút | Cần sửa 1 dòng trên `main` để đọc `COACH_IDLE_MS`. **Đây là thay đổi code duy nhất ở `english-app`**; nếu không sửa, chấp nhận Nova cá nhân giữ 1 slot tới 15 phút sau lượt chat cuối |
| Warm pool của bản multi | — | Tắt (4.2) | Env |
| Nova của bản multi | — | Mỗi user 1 tiến trình, tắt sau 3 phút, tối đa 2 | Code multi (4.2) |

**Trường hợp xấu nhất:** app cá nhân đang rảnh nhưng còn warm + Nova sống, giữ 2 slot → bản multi chỉ còn 2 slot trong tối đa 10 phút (warm), hoặc 15 phút nếu chưa sửa `COACH_IDLE_MS` cho Nova.

**Bên trong mỗi app:**
- `ANTIGRAVITY_PARALLEL=4` vẫn giữ: nó là trần của riêng app, còn cổng là trần chung. Hàng đợi round-robin theo user (6.2) nằm trong code multi.
- Code multi cần biết về cổng:
  - Thời gian chờ ở cổng **không** tính vào timeout 5 phút của lượt gọi. Timeout bắt đầu khi đọc được dòng `slot-acquired`.
  - Giao diện hiện "Đang chờ máy AI (app khác đang dùng)".
  - `queueMs` trong log tách thành `appQueueMs` + `gateWaitMs`.
- App cá nhân không biết về cổng. Thời gian chờ ở cổng sẽ nằm trong timeout 5 phút của nó; nếu chờ quá lâu thì lượt gọi lỗi như khi `agy` chậm (đã có xử lý).

**Test:**
- `scripts/tests/agy-gate.test.sh`: dùng fake `agy` ngủ 5 s, khởi chạy 10 tiến trình qua cổng cùng lúc → mọi thời điểm ≤ 4 chạy, cả 10 đều xong. Kill một tiến trình → slot được nhả ngay.
- Thử tải mục 9: lấy mẫu `pgrep -xc agy` mỗi giây trong suốt bài test.

## 7. Migrate, backup, quyền riêng tư, bảo mật, deploy, giám sát

### 7.1 Chiến lược code (đã chốt: thư mục multi-user tách khỏi `english-app`)

1. **Thư mục code riêng:**
   - `git clone` repo vào `/home/englishmulti/app`, làm trên nhánh dài hạn `multi` (từ `main` ở thời điểm bắt đầu).
   - Mỗi phase là một nhánh `mu/<phase>` → PR vào `multi`, **không** vào `main`.
   - `/home/trongle/english-app` (app cá nhân, `main`) không bị sửa code bởi dự án này, trừ 1 dòng tùy chọn ở 6.5. Unit systemd của nó có đổi (6.5, 2.4). Không cần chế độ `LEGACY_SINGLE_USER`.
2. **Nhận tính năng mới từ `main`:**
   - Merge `main` → `multi` mỗi 1–2 tuần, hoặc khi có tính năng cần.
   - Sau mỗi lần merge, chạy bộ test cô lập. Đây là lúc dễ lọt đường dẫn `progress/` mới nhất, vì code mới trên `main` vẫn viết theo kiểu một người. Test `lint-paths` sẽ báo đúng chỗ.
   - Chi phí của cách này: phải merge định kỳ, và mỗi tính năng mới phải "chuyển sang scope" một lần. Đổi lại, app của bạn hoàn toàn không bị ảnh hưởng.
3. **Phát triển:** dev server của bản multi chạy bằng user `englishmulti`, cổng 5185, `DATA_DIR` tạm. Không bao giờ chạm dữ liệu của `english-app`.
4. **Dữ liệu của bạn trong instance multi:**
   - Tài khoản admin bắt đầu trống.
   - Kho tham chiếu được trích từ thư viện của bạn (7.2).
   - Không bắt buộc chép tiến độ học của bạn sang: bạn tiếp tục học trên app cá nhân.

### 7.2 Migrate dữ liệu

- `scripts/mu-migrate.ts` (**tùy chọn**, chỉ dùng nếu sau này bạn muốn chuyển tiến độ học của mình sang instance multi; nó cũng là công cụ test chính của Phase 2) `--from /home/trongle/english-app --to <DATA_DIR> --owner <email> [--dry-run] [--force]`:
  - **Chép, không di chuyển.** Chạy lại nhiều lần được. In số file/dung lượng nguồn và đích, kèm sha256 từng file.
  - Ánh xạ theo bảng 3.2. Tách `grammar/history.json` → `cache/analyze/` + `grammar-history.json`.
  - Chuyển các khóa `localStorage` cũ (không có tiền tố) sang `u:<owner>:` ở lần đăng nhập đầu, như v1.
- `scripts/mu-extract-reference.ts`:
  - Đọc **chỉ đọc** từ `/home/trongle/english-app/content/vocabulary/words.json` và ghi ra `content/reference/words.json` trong bản clone multi.
  - Chép cả 615 từ, nhưng đánh dấu mục nghi là riêng tư: ví dụ có tên riêng, "my/our/I", địa danh hoặc chuỗi khớp `reference-private-patterns.txt`. Các mục này được ghi vào `reference-review.md` để owner duyệt (giữ / sửa ví dụ / bỏ). Mục chưa duyệt thì **chưa** được đưa vào kho chung.
  - Không chép `notes.json`.
  - Chép ảnh từ của các mục được giữ (`public/vocab-images`).
- Kiểm tra sau migrate: số thẻ đang ôn, số review, thống kê `/review/stats`, số phiên coach, planner tuần này → so khớp trước/sau.

### 7.3 Backup và khôi phục theo user

- `english-backup.timer` chạy hằng ngày lúc 03:30:
  - `tar --zstd` từng `users/<uid>/` + `auth/` + `system/`;
  - mã hóa bằng `age` (khóa công khai trên máy, khóa bí mật **không** để trên máy);
  - giữ 14 bản ngày + 8 bản tuần.
- **Nơi lưu (đã chốt: chưa cần backup ra ngoài máy):** lưu trên ổ `D:` hoặc `E:` (mục 7.3a). Như vậy vẫn có bản sao khi file dữ liệu trên `C:` hỏng, nhưng không chống được việc mất cả laptop. Thêm `rclone` sau, khi có nhiều người dùng hơn.

### 7.3a Dùng ổ `D:` / `E:` thay cho `C:`

Đo ngày 13/11: `C:` còn 20 GB, `D:` còn 338 GB, `E:` còn 466 GB (gần như trống). Ba cách, xếp từ tốt nhất:

| Cách | Làm thế nào | Ưu / nhược |
|---|---|---|
| **A. Chuyển cả bản Ubuntu của WSL sang `E:` (khuyến nghị)** | Trong PowerShell (Windows): `wsl --shutdown`, rồi `wsl --manage Ubuntu --move E:\WSL\Ubuntu` (WSL ≥ 2.3; nếu bản cũ hơn: `wsl --export Ubuntu E:\ubuntu.tar` → `wsl --unregister Ubuntu` → `wsl --import Ubuntu E:\WSL\Ubuntu E:\ubuntu.tar` rồi đặt lại user mặc định) | Mọi thứ (cả hai app, cache, model, `agy`) rời khỏi `C:`; đường dẫn trong Linux không đổi; tốc độ như cũ. Nhược: phải tắt WSL khoảng 5–15 phút (cả hai app và tunnel ngừng). **Backup `wsl --export` trước khi làm** |
| B. Một ổ ảo ext4 riêng trên `D:`/`E:` chỉ cho dữ liệu multi | Tạo `E:\WSL\english-multi.vhdx`, gắn bằng `wsl --mount --vhd E:\WSL\english-multi.vhdx --bare`, format ext4, mount vào `/srv/english-multi` (cần chạy lại `wsl --mount` sau mỗi lần Windows khởi động, ví dụ bằng Task Scheduler) | Dữ liệu user rời `C:`, nhanh như ext4. Nhược: thêm bước gắn ổ lúc khởi động; nếu quên gắn, service phải tự từ chối chạy (`ConditionPathIsMountPoint=/srv/english-multi`) |
| C. Ghi thẳng vào `/mnt/d` | `DATA_DIR=/mnt/d/english-multi` | **Không dùng cho dữ liệu đang chạy**: ổ Windows qua drvfs chậm hơn nhiều, không có quyền Unix (chmod 700, user `englishmulti` vô tác dụng), và dễ lỗi khi ghi file atomic/khóa. **Dùng được cho backup** (file `.tar.zst`) |

- **Đã chốt (2026-11-13):** trong lúc làm (Phase 0–9), dữ liệu vẫn ở `C:` như hiện tại. Khi xong hết thì làm cách A **một lần** (Phase 10).
- Trong thời gian còn ở `C:`, giữ an toàn bằng các bước sau:
  - Báo động khi `C:` còn < 10 GB; khi còn < 5 GB thì app multi tạm khóa upload ghi âm/ảnh. Kiểm tra bằng `df /mnt/c` trong `english-watch`.
  - Xóa WAV sau 15 ngày, giới hạn 300 MB/user. Với 4 user thì tối đa khoảng 1,2 GB.
  - Backup hằng đêm của multi: chỉ giữ 7 bản (thay vì 14 + 8) cho tới khi chuyển ổ.
  - Theo dõi kích thước file `ext4.vhdx`. Với `sparseVhd=true`, file chỉ lớn lên theo dữ liệu thật.
  - Việc ghi file backup ra `/mnt/d/english-backups/` (cách C) **không** cần chuyển WSL, nên có thể bật ngay nếu bạn muốn có bản sao ngoài `C:`. Mặc định: tắt, backup ở `C:` cho tới Phase 10.
- `scripts/mu-restore.ts <uid> <date> [--to staging]`: giải nén vào `DATA_DIR/restore/<uid>`, kiểm schema, rồi đổi thư mục tại chỗ (dừng ghi của user đó bằng khóa scope).
  - Thử khôi phục một user mỗi tháng (ghi kết quả vào checklist vận hành).
- Xuất dữ liệu: `GET /me/export` → zip thư mục user (WAV tùy chọn).

### 7.4 Quyền riêng tư và xóa dữ liệu

- Trang "Dữ liệu của bạn" (cũng là `content/docs/account-privacy.md`) nói rõ:
  - lưu gì (bài viết, ghi âm, tiến độ);
  - ai xem được: bạn, và **admin của app** (admin xem được mọi dữ liệu học để hỗ trợ; mỗi lần xem đều được ghi lại);
  - **bài viết/ghi âm được gửi tới dịch vụ AI** (`agy`/Gemini, hoặc Claude nếu chọn) để chấm;
  - ghi âm được giữ 15 ngày;
  - sao lưu mã hóa giữ 14 ngày;
  - tài khoản chỉ dùng trên tối đa 2 thiết bị.
- Xóa tài khoản: `DELETE /me` (cần mật khẩu, và mã 2FA nếu đã bật) → chuyển sang `deleted/`, hủy phiên, xóa push subscription. Xóa hẳn sau 30 ngày (timer). Backup tự hết hạn sau 14 ngày (nói rõ trong trang).
- Log hệ thống không ghi nội dung bài: `usage` chỉ có label, token, thời gian. Label đang chứa nội dung (ví dụ `note: traffic jam\n- Nghĩa…`, `news-<tiêu đề>`) phải cắt về loại tính năng + hash.
- `logs/antigravity-failed/*` hiện lưu toàn bộ prompt khi lỗi:
  - Ở instance multi, ghi vào `users/<uid>/debug/`, xóa sau 7 ngày.
  - Hoặc tắt (`ANTIGRAVITY_FAILED_DUMP=off`).

### 7.5 Bảo mật

- Instance multi chạy bằng **user OS `englishmulti`**, home riêng, `DATA_DIR` chmod 700, không thuộc nhóm `trongle`. Code ở `/home/englishmulti/app` (worktree, chỉ đọc với service).
- `cloudflared` giữ nguyên một tunnel, thêm ingress cho hostname mới, trỏ `127.0.0.1:5180`. Service vẫn bind `127.0.0.1` (đã có ở `server/index.ts:159`).
- Cloudflare:
  - "Always HTTPS", HSTS;
  - rate limit `/api/auth/*`, `/api/register`; Turnstile cho `/register`;
  - (khuyến nghị) **Cloudflare Access** chặn `/admin*` và `/api/admin/*` của instance multi bằng email owner;
  - WAF chặn body > 50 MB.
- Cổng chặn hiện có (`gate` trong `server/index.ts`) dùng cho cả hai instance. `PRIVATE_STATIC` thêm ảnh của user. CSRF kiểm `Origin` khớp đúng hostname của instance (`PUBLIC_ORIGIN` trong `.env`).
- Sandbox `agy` (4.2), cô lập tool Nova (4.1), không còn `ADMIN_TOKEN`, xóa đường gọi `server/llm/claude-code.ts` trên instance multi (hoặc chặn bằng env).
- Không chạy dev server/Vite trên instance multi. `npm run build` một lần lúc deploy.
- Trước mỗi lần mở rộng nhóm người dùng: chạy skill `security-review` trên nhánh và bộ test cô lập.

### 7.6 Deploy instance thứ hai

- **Code:** `sudo -u englishmulti git -C /home/englishmulti/app fetch && git checkout <tag mu-vX>` (tag trên nhánh `multi`), rồi `npm ci && npm run build`. Deploy theo tag, không theo nhánh đang sửa dở.
  - Bản deploy và bản dev dùng hai thư mục khác nhau: `/home/englishmulti/app` (deploy) và `/home/englishmulti/dev` (worktree để sửa).
- **`.env` của multi:**
  - `PORT=5180`, `HOST=127.0.0.1`, `DATA_DIR=/home/englishmulti/english-multi` (vẫn đúng sau khi chuyển WSL sang `E:`, vì đường dẫn trong Linux không đổi), `PUBLIC_ORIGIN=https://study.ailab.com.vn`;
  - `APP_INSTANCE=multi`, `COOKIE_NAME=__Host-em_session`, `TRUST_PROXY=1`;
  - `PATH=/usr/local/lib/agy-gate:/usr/local/bin:/usr/bin:/bin` (để app gọi `bwrap` qua cổng), `ANTIGRAVITY_PARALLEL=4`, `ANTIGRAVITY_WARM=off`, `COACH_IDLE_MS=180000`;
  - `STT_URL=http://127.0.0.1:5190`, `SHARED_CACHE_DIR=/srv/english-shared-cache`;
  - `NEWS_SOURCE=mirror`, `ANTIGRAVITY_FAILED_DUMP=off`.
- **`/etc/systemd/system/english-multi.service`:**
  ```ini
  [Unit]
  Description=English App (multi-user)
  After=network.target english-stt.service
  [Service]
  User=englishmulti
  WorkingDirectory=/home/englishmulti/app
  EnvironmentFile=/home/englishmulti/app/.env
  Environment=NODE_OPTIONS=--max-old-space-size=1024
  ExecStart=/usr/bin/node server/index.ts
  Restart=on-failure
  RestartSec=5
  StartLimitIntervalSec=300
  StartLimitBurst=5
  MemoryHigh=1G
  MemoryMax=1400M
  NoNewPrivileges=yes
  ProtectSystem=strict
  ReadWritePaths=/home/englishmulti/english-multi /srv/english-shared-cache /run/agy-slots /tmp
  PrivateTmp=yes
  ProtectHome=tmpfs
  BindPaths=/home/englishmulti
  [Install]
  WantedBy=multi-user.target
  ```
  - Dùng `Restart=on-failure` + `StartLimitBurst`, **không** dùng `Restart=always`. Vòng 1.864 lần restart vì tranh cổng là ví dụ cần tránh.
  - Unit cá nhân sửa tương tự: hạ `max-old-space-size`, thêm `MemoryMax`.
- **`english-stt.service`:** `node server/stt-worker/index.ts`, user `english-stt`, `MemoryMax=1600M`, `CPUQuota=400%`.
- **Cloudflare (đã chốt: `study.ailab.com.vn`):**
  - Trong `~/.cloudflared/config.yml`, đổi mục `hostname: study.ailab.com.vn` từ `http://127.0.0.1:5173` sang `http://127.0.0.1:5180`. Bản ghi DNS đã có, không cần `tunnel route dns`.
  - App cá nhân chỉ còn `ailab.com.vn`. Kiểm tra trước khi đổi: không thiết bị nào của bạn (PWA đã cài, push subscription của planner, bookmark) còn dùng `study.ailab.com.vn`. Nếu còn thì cài lại PWA từ `ailab.com.vn` và đăng ký push lại.
  - Restart `english-tunnel` (mất kết nối vài giây; làm lúc ít người dùng).
  - Cookie của hai app không lẫn nhau (cookie `__Host-` gắn với đúng hostname, tên khác nhau), nhưng service worker cũ của app cá nhân trên `study.` sẽ còn trong trình duyệt của bạn. Bản multi tăng `VERSION` của `sw.js` để thay nó.
- Khi cập nhật code: `systemctl restart english-multi` (khoảng 3 s gián đoạn). Job đang chạy dở sẽ mất → frontend tự báo "thử lại", lượt được hoàn.

### 7.7 Giám sát

- `GET /api/admin/metrics`: RSS, heap, độ dài hàng đợi AI, slot `agy` đang dùng và bởi app nào (đọc `/run/agy-slots/*.owner`), p50/p90 lượt AI trong giờ qua, số 503/timeout, STT đã nạp chưa, dung lượng `DATA_DIR`, `C:` còn trống, tuổi của bản backup cuối.
- `english-watch.timer` chạy mỗi 5 phút (script `scripts/ops/watch.ts`). Gửi **Web Push cho admin** (đã có hạ tầng `planner/push.ts`) khi:
  - RAM khả dụng < 400 MB, hoặc swap > 1,5 GB;
  - hàng đợi AI chờ > 5 phút;
  - tỉ lệ lỗi AI > 10%/giờ;
  - service restart > 3 lần/giờ;
  - `C:` < 10 GB;
  - backup cũ hơn 36 h.
- Log: `journalctl -u english-multi`. Thêm `logs/` riêng cho instance multi trong `DATA_DIR/logs`, xoay vòng hằng tuần.

---

## 8. Các phase

Thời gian ước tính tính theo ngày làm việc của một agent có người duyệt. Mỗi phase là một PR lên `main`, có `npm run typecheck && npm run lint && npm test` sạch. Sau mỗi phase, instance cá nhân vẫn chạy bình thường.

| Phase | Nội dung | Thời gian | Điều kiện xong |
|---|---|---|---|
| **0. Chuẩn bị và rào chắn** | Backup toàn bộ (`tar` dữ liệu app cá nhân). Thêm báo động `C:` < 10 GB. **Chưa** chuyển ổ. Sửa unit cá nhân (`max-old-space-size`, `MemoryMax`, `Restart=on-failure`): đây là thay đổi duy nhất ngoài code của app cá nhân. Tạo user OS `englishmulti`, clone repo, nhánh `multi`, chép file plan này vào gốc bản clone (từ đây plan được cập nhật ở bên đó). Liệt kê lại mọi route gọi AI và lưu thành `docs/dev/ai-routes.md`. Tạo `fake-agy.sh` | 1 | `NRestarts` không tăng; báo động `C:` chạy thử được; tổng RSS lúc đỉnh có số đo |
| **1. Lõi scope** (nhánh `multi`) | `server/scope.ts`, `UserCtx`, phân loại 179 route (`public/user/admin/ai`), bỏ `ADMIN_TOKEN`/`guarded`, `apiFetch` + khóa localStorage theo uid, test phân loại + `lint-paths` | 2 | Test phân loại pass; bản multi chạy được với một admin trên `DATA_DIR` tạm |
| **2. Tách dữ liệu cá nhân** | Mọi file trong bảng 3.2 đi qua `scope`; `jobs.ts` có `ownerId`; job nền lặp theo user; ảnh notepad/user qua route có kiểm phiên; `/data` sạch dữ liệu cá nhân (`buildCustomCards`); `mu-migrate.ts`; **bộ test cô lập 3.6** | 4–5 | Toàn bộ `scripts/tests/isolation/*` pass; migrate dữ liệu owner sang DATA_DIR tạm rồi so khớp số liệu |
| **3. Kho tham chiếu** | `content/reference/` + công cụ duyệt; `SharedStore`; review lấy gợi ý `mine + reference`; API `/me/vocabulary|notes/adopt|generate`; sửa `library-add.ts`; tab "Của tôi / Kho chung" | 3 | Learner mới (chưa có từ) vẫn nhận gợi ý từ trong Writing/Speaking Review; bấm "Thêm" thì thẻ xuất hiện trong ôn tập của **chỉ** user đó |
| **4. Nova đa người dùng + trợ giúp** | (Nova sandbox đã merge ở `17b4874`.) `uid` trong `McpBinding`, tool qua scope, **profile `agy` riêng theo user / theo lượt gọi + tắt warm pool (4.2)**, `library-job.ts` ghi vào thư viện của user, `help.ts` (search/read/open_sample), `content/docs/*` cho mọi tính năng, `docs-coverage.test.ts`, trang `/help` | 3–4 | `coach.test.ts` pass (token chéo, injection); hỏi Nova 20 câu "làm sao để…" trong bộ đánh giá → ≥ 18 câu trả lời đúng bước và đúng link |
| **5. Sức chứa AI và tài nguyên** | Cổng `agy-gate` (4 tiến trình cho cả WSL) + phần nhận biết slot trong code multi, round-robin + ưu tiên, hạn mức theo tính năng + `GET /me/quota`, route AI trực tiếp → job (524), STT worker, khóa Longman/OZDIC liên tiến trình, LRU cache coach, quota dung lượng + xóa WAV | 4 | Thử tải bằng fake-agy (mục 9) đạt; RAM lúc đỉnh ≤ 3,0 GB với 2 instance + STT nạp sẵn; `pgrep -c agy` không bao giờ > 4 |
| **6. Tài khoản và admin** | Trang `/register` + Turnstile, trạng thái `pending` và trang chờ, Web Push báo admin, Duyệt/Từ chối, admin thêm thủ công (`mustChangePassword`), 2FA bắt buộc cho admin / tùy chọn cho learner, giới hạn 2 thiết bị + cờ dùng chung, link đặt lại, trang Admin (Users/Chờ duyệt/Devices/Usage/Health), "Xem như học viên" chỉ đọc + audit, hạn mức theo tính năng (5 Writing / 30 Speaking), export/xóa tài khoản | 3 | Kịch bản: tự đăng ký → admin nhận thông báo → duyệt → học → thiết bị thứ 3 bị từ chối; admin thêm thủ công → đổi mật khẩu lần đầu → admin xem dữ liệu (có audit) → xuất dữ liệu → xóa, chạy hết bằng giao diện |
| **7. Onboarding** | Ví dụ mẫu ẩn danh (owner duyệt), chế độ `readOnly`, màn chào, bộ thẻ khởi đầu, planner tuần đầu | 2 | Một người chưa từng dùng làm được 1 Writing Review và 1 buổi ôn thẻ trong 15 phút mà không hỏi owner |
| **8. Triển khai instance multi** | User OS `englishmulti`, worktree theo tag, `.env`, `english-stt` + `english-multi` + timer backup/watch, ingress Cloudflare, Access cho `/admin` | 1 | Checklist 7.6 xong; khôi phục thử 1 user thành công; báo động thử nghiệm đến điện thoại admin |
| **9. Chạy thử dần** | Đợt 1: owner + 1 tester (1 tuần) → đợt 2: đủ **4 tài khoản** (đã chốt; 2–3 tuần). Chỉ mở rộng thêm sau khi có số đo quota `agy` thật | 3–4 tuần | Mỗi đợt đạt tiêu chí ở mục 9 thì mới mở đợt sau |
| **10. Chuyển WSL sang `E:` (một lần)** | Khi Phase 0–9 xong và chạy ổn: báo trước cho learner; `wsl --export Ubuntu D:\wsl-backup\ubuntu-<ngày>.tar` (backup đầy đủ, ghi ra `D:`); `wsl --shutdown`; `wsl --manage Ubuntu --move E:\WSL\Ubuntu` (hoặc export/unregister/import nếu WSL cũ); khởi động lại, kiểm tra cả 3 service + tunnel; bật backup hằng đêm ra `/mnt/d/english-backups/`, giữ lại 14 + 8 bản | 0,5 (WSL tắt 5–15 phút) | `df` cho thấy dữ liệu nằm trên `E:`; hai app, STT và tunnel chạy lại; mở được cả `ailab.com.vn` và `study.ailab.com.vn`; giữ file `.tar` backup ít nhất 2 tuần |

**Tổng code:** khoảng 22–27 ngày làm việc, cộng 3–4 tuần chạy thử, rồi nửa ngày chuyển ổ (Phase 10).

---

## 9. Kiểm thử tải và tiêu chí chấp nhận

**Thử tải với fake-agy** (không tốn quota):
- `FAKE_AGY_SLEEP` lấy ngẫu nhiên theo phân phối đo được (p50 16 s, p90 52 s; chế độ "ngày bận" 60–150 s).
- 5 user ảo, mỗi người 1 Writing Review + 1 Speaking Review (WAV 2 phút) + 5 lượt Nova trong 10 phút, đồng thời owner dùng instance cá nhân.
- Đạt khi:
  - không request nào > 30 s (mọi việc AI là job);
  - số tiến trình `agy` trên cả WSL không bao giờ vượt 4 (lấy mẫu `pgrep -xc agy` mỗi giây);
  - khi một app đang giữ đủ 4 slot, request của app kia chờ rồi được chạy ngay khi có slot trống (không lỗi, không vượt timeout);
  - không user nào chờ > 2× người khác (round-robin);
  - RAM khả dụng > 300 MB;
  - không bị OOM hay restart.

**Chạy thật mỗi đợt, đo trong `/api/admin/metrics`:**
- Tỉ lệ lỗi AI (503/timeout) < 5%; thời gian chờ hàng đợi p90 < 3 phút; không có 524.
- Tổng lượt `agy`/ngày (cả hai instance) và có bị chặn quota không. Đây là số liệu để chỉnh hạn mức/ngày.
- Bộ test cô lập pass trên đúng tag đang chạy; không có báo cáo "thấy dữ liệu người khác".
- Backup đêm nào cũng có; khôi phục thử thành công.
- Người dùng mới tự làm được nhờ docs/Nova (đếm số câu hỏi phải nhờ owner).

**Dừng mở rộng khi:** quota gói bị chặn > 1 lần/tuần, p90 chờ > 5 phút, hoặc RAM khả dụng thường xuyên < 300 MB. Khi đó chọn một trong các phương án ở mục 2.5.

---

## 10. Quyết định (chốt ngày 2026-11-13)

| # | Câu hỏi | Đã chốt | Ảnh hưởng tới plan |
|---|---|---|---|
| 1 | Hostname | `study.ailab.com.vn` (bỏ khỏi app cá nhân) | 7.6 |
| 2 | AI cho learner | Tạm dùng chung gói `agy` | 2.3, 2.5 (Claude API để dành sau) |
| 3 | Số tài khoản đợt đầu | Khoảng 4 | 8 (Phase 9) |
| 4 | Hạn mức AI/ngày | 5 bài Writing, 30 lượt Speaking (theo câu) | 6.2 |
| 5 | 2FA / đăng ký | Tự đăng ký (tên, email, mật khẩu) + admin duyệt, hoặc admin thêm thủ công. 2FA bắt buộc với admin, tùy chọn với learner. Tối đa 2 thiết bị/learner. Google đăng nhập để sau | 6.1 |
| 6 | Kho tham chiếu | Phương án mặc định (đồng ý 2026-11-13): topic-collocations + collocations + 615 từ vựng (owner chỉ xem các mục script đánh dấu là riêng tư); 415 ghi chú **không** chia sẻ ở đợt đầu | 5, 7.2 |
| 7 | Backup ngoài máy | Chưa cần; backup ở `C:` (7 bản) cho tới Phase 10 | 7.3, 7.3a |
| 8 | Ghi âm / dung lượng | Giữ 15 ngày, 300 MB/user. Dùng `C:` trong lúc làm; xong hết mới chuyển WSL sang `E:` một lần | 2.4, 6.2, 7.3a, Phase 10 |
| 9 | Tổ chức code | Code multi-user ở thư mục riêng, không sửa `english-app` | 7.1 |
| 10 | Admin xem dữ liệu learner | Lúc nào cũng xem được (chỉ đọc, có audit, ghi trong trang quyền riêng tư) | 6.3, 7.4 |

**Câu 6 (đã chốt theo phương án mặc định bên dưới):**
- Writing/Speaking Review của learner cần một kho từ để gợi ý "nên dùng cụm này", kể cả cụm learner chưa học.
- Nguồn tự nhiên cho kho đó là thư viện của bạn: 615 mục từ vựng (đã có nghĩa, collocation, ví dụ, ảnh) và 415 ghi chú. Nhưng đó là dữ liệu học **của bạn**; nếu đưa vào kho chung thì 4 learner đều đọc được.
- Câu hỏi thực chất là: **bạn có đồng ý cho learner xem phần nào trong thư viện của bạn?**
- Đề xuất mặc định (nếu bạn không muốn duyệt từng mục):
  - Kho chung = `topic-collocations` (~4.886 cụm) + bài `collocations` + **toàn bộ 615 từ vựng**. Các mục từ này giống mục từ điển. Một script đánh dấu mục nào có ví dụ trông như chuyện riêng (tên người, "my …", địa điểm cá nhân), và bạn chỉ xem các mục bị đánh dấu.
  - **415 ghi chú không đưa vào** ở đợt đầu, vì ghi chú thường mang tính cá nhân hơn. Có thể thêm dần sau.

---

## 11. Prompt cho agent thực thi (tiếng Anh)

Dùng chung đoạn mở đầu này cho mọi phase, rồi nối thêm prompt của phase đó.

```text
You are implementing one phase of PLAN-multi-user-v2.md in the multi-user checkout /home/englishmulti/dev on a
branch off `multi` (never in /home/trongle/english-app, which runs the owner's personal app on main) (Node ≥ 22.18 TypeScript run
directly, import with .ts; routes are 'METHOD /path' handlers; errors via ApiError; JSON via readJsonFile/writeJsonFile).
Rules:
- Do only the phase named below. If the plan disagrees with the code (file names, behaviour), stop, write the mismatch
  under "Ghi chú" at the end of the plan and ask the user. Do not guess.
- The production service english-app (port 5173) serves the owner's real data. Never restart it and never read or write
  /home/trongle/english-app; use a temp DATA_DIR for every test and the dev port 5185.
- Do not edit server/coach/ or server/llm/agy-sandbox.ts outside Phase 4.
- No new npm dependencies when Node has the feature (node:crypto, node:async_hooks, node:test).
- Use scripts/tests/fake-agy.sh for anything that would call agy; never spend real AI quota in tests.
- Finish with npm run typecheck, npm run lint, npm test all clean, tick the phase's items in the plan, and add a row to
  "Nhật ký thực hiện": date, what changed, deviations, tests run and their results. Commit only when the user says so.
```

**Phase 1:**
```text
Phase 1 (scope core). Create server/scope.ts (UserScope with path() that validates every segment against
^[A-Za-z0-9._-]+$, rejects '.', '..', resolves and realpaths inside the user root, plus lock(key, fn) kept on
globalThis) and split ApiContext into PublicCtx and UserCtx. Classify every key of `routes` as public | user | admin |
ai and add scripts/tests/route-classes.test.ts that fails on any unclassified route. Replace guarded()/ADMIN_TOKEN with
role checks. Add scripts/tests/lint-paths.test.ts that forbids 'progress', ctx.rootDir and
direct content/{review,notepad,vocabulary,note} paths in server/ outside an explicit allowlist (the allowlist shrinks in
Phase 2). Add apiFetch() in src/lib and prefix per-user localStorage keys with u:<uid>:.
```

**Phase 2:**
```text
Phase 2 (personal data split). Move every personal read/write listed in the plan's table 3.2 onto UserScope, empty the
lint-paths allowlist, give every job an ownerId (server/jobs.ts) and make lookups by another user return 404, make the
planner push tick, nightly drills and coach sweep iterate allUserScopes(), serve notepad and user images only through
authenticated per-user routes, keep personal cards out of /data via buildCustomCards. Write scripts/mu-migrate.ts
(copy only, idempotent, --dry-run, sha256 summary). Then write scripts/tests/isolation/* exactly as section 3.6
describes: seed user A with CANARY-A strings in every data type, call every route as user B, and assert that no
response, job result, push, static file or /data file contains CANARY-A. The phase is not done until that suite passes.
```

**Phase 3:**
```text
Phase 3 (shared reference bank). Add content/reference/ (words, notes, index by lemma) built from an owner-approved
allowlist, a read-only SharedStore, and per-user /me/vocabulary and /me/notes routes (adopt from reference without AI,
generate with AI into the user's own library, edit, delete). Make Writing Review and Speaking ideas/review retrieve
suggestions from the user's library first and the reference bank second, tagging each with source mine|reference.
Switch src/features/practice/library-add.ts, ExtraCards.tsx and coach/ProposalCard.tsx from admin APIs to /me APIs.
Add tests that a learner with an empty library still gets reference suggestions, and that adopting a word changes only
that learner's library and review state.
```

**Phase 4:**
```text
Phase 4 (Nova per user + help). The bwrap sandbox (server/llm/agy-sandbox.ts) is already on main; the gap is that agy
stores conversations inside the shared profile's ~/.gemini, which the sandboxed agy can read. Give agy -p a temporary
profile per call, turn the warm pool off in this instance, give Nova one agy acp process per user with profile
coach-<uid> (at most COACH_LIVE_AGENTS live, idle stop after COACH_IDLE_MS = 3 min, since each live process holds one
of the four machine-wide agy slots), and make server/coach/library-job.ts write into
the learner's own library with an owner-checked job, one item at a time, counted against the learner's quota. Add uid to McpBinding, build each tool's context from
scopeFor(uid) and SharedStore, store chats under the user's scope, route proposals to /me APIs. Add content/docs/*.md (frontmatter:
id, title, route, api, keywords, sample, updated) for every nav item, tools search_help/read_help/open_sample, the
help instruction in the preamble, a /help page, and scripts/tests/docs-coverage.test.ts. Add coach isolation tests:
cross-session token reuse, a fake agent that tries to read another user's folder, and tool calls that must never
return another user's canary.
```

**Phase 5:**
```text
Phase 5 (capacity). Install the agy-gate (section 6.5): a bwrap wrapper that holds one of four flock slots in
/run/agy-slots for the whole life of every agy process, so the whole WSL never runs more than four agy processes
and the two apps wait for each other symmetrically. Make the multi app gate-aware (start its timeout only after
the slot is acquired, show queue position). Add a per-user round-robin queue with priorities inside
inSlot(), per-feature daily AI quotas per user (section 6.2) with refunds on system errors and GET /me/quota, job conversion for every AI
route that still answers inline, an STT worker service that loads the model on demand and unloads it after STT_IDLE_MS,
a cross-process rate lock for Longman/OZDIC/DOL with a shared cache dir, an LRU cap for coach review caches, and storage
quotas with WAV expiry. Prove it with a fake-agy load test (section 9) and report peak RSS of every process.
```

**Phase 6–8:** dùng nội dung mục 6, 7.2–7.7 và bảng phase làm đặc tả; tiêu chí xong là cột "Điều kiện xong".

---

## Ghi chú (điền trong lúc làm)

- Sandbox `bwrap` của `agy`: **đã merge** (`17b4874`). Còn thiếu: profile riêng theo user (4.2); `conversations/` nằm trong profile dùng chung.
- Danh sách route gọi AI trên `main` hiện tại: _(Phase 0)_
- Trần quota thật của gói `agy`: _(đo trong đợt chạy thử)_

## Nhật ký thực hiện

| Ngày | Phase | Đã làm | Lệch so với plan | Kiểm thử đã chạy |
|---|---|---|---|---|
| 2026-11-13 | 0–8 (bản đầu) | Làm và triển khai: thư mục riêng theo tài khoản (link nội dung chung, chỉ đọc), phân quyền route, đăng ký + duyệt, admin thêm tay, quên mật khẩu qua admin, 2 thiết bị, xem như học viên, hạn mức theo tính năng + trần agy, cổng 4 tiến trình agy cho cả WSL, hàng đợi chia lượt, hồ sơ agy tạm/theo tài khoản, Nova theo tài khoản, trang hướng dẫn + công cụ Nova, kho từ chung, dọn ghi âm 15 ngày, giới hạn 300 MB, cảnh báo ổ C:/RAM; service `english-multi` (5180) trên study.ailab.com.vn | Code ở thư mục riêng (clone, nhánh `multi`) thay vì sửa `main`; quên mật khẩu = mật khẩu tạm thay link; STT chưa dùng chung; chưa chuyển route AI trực tiếp sang job (524); chưa có ví dụ mẫu dạng kết quả; chưa đặt lịch backup. Chi tiết: MULTI-USER-NOTES.md | `npm test` 173/173 (có bộ chống lộ dữ liệu, thiết bị, đăng ký, hạn mức, hồ sơ agy, hàng đợi, tài liệu); chạy thử trên bản thật: đăng nhập, /data, kho từ, notepad, 1 lượt AI thật qua cổng (78 s), hồ sơ tạm được xóa |
| 2026-11-13 | — | Thêm 6.5: trần cứng 4 tiến trình `agy` cho cả WSL, hai app bình đẳng (cổng `agy-gate` bằng `flock`); bỏ slot giữ riêng cho app cá nhân; Nova multi tắt sau 3 phút rảnh, warm cá nhân sau 10 phút | App cá nhân: đổi unit + (tùy chọn) 1 dòng `COACH_IDLE_MS` | — |
| 2026-11-13 | — | Rà ảnh hưởng của merge `feat/nova-sandbox` (`17b4874`): 4.2 ghi phần đã xong; thêm lỗ hổng `conversations/` trong profile dùng chung → profile theo user/lượt gọi, tắt warm ở multi; `library-job.ts` ghi vào thư viện của user; cập nhật RAM | — | `ls`/`du` profile: `coach` 11 file hội thoại 7,4 MB, `llm` 2,9 MB |
| 2026-11-13 | — | Đổi 6.1: tự đăng ký + admin duyệt, admin thêm thủ công, 2FA chỉ bắt buộc với admin | Bỏ link mời | — |
| 2026-11-13 | — | Cập nhật theo các quyết định của người dùng (mục 10; câu 6 chốt mặc định): study.ailab.com.vn, chung `agy`, 4 tài khoản, 5 Writing/30 Speaking, 2FA + 2 thiết bị, thư mục code riêng, admin luôn xem được, ghi âm 15 ngày, dữ liệu trên `D:`/`E:` | Bỏ `LEGACY_SINGLE_USER` | Đo `df`: `D:` 338 GB trống, `E:` 466 GB trống |
| 2026-11-13 | — | Viết plan v2: đo RAM/CPU/đĩa, phân tích `logs/gemini-usage.jsonl`, đọc v1 và `origin/feat/multi-user` | — | Đo STT trong tiến trình riêng (1.126–1.230 MB RSS); `agy --help` 168 MB |

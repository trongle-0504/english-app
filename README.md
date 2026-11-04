# NeuralSymbolic

Website học tiếng Anh: Vocabulary, Collocations, Grammar, Notes, Blog, Practice và Admin.
Viết lại từ `../english-app` (Next.js). Không dùng database: mọi dữ liệu nằm trong `content/` (JSON + Markdown).

**Stack:** Vite · React 19 · TypeScript · Tailwind CSS v4 · React Router · Radix UI · react-markdown.

## Chạy

```bash
npm install
npm run dev        # http://localhost:5173 — có luôn API (Analyze, Admin)
npm run build      # build tĩnh vào dist/ (kể cả dist/data/*.json)
npm start          # server production: dist/ + /data sống từ content/ + /api (PORT, mặc định 4173)
npm run typecheck
npm run lint
npm run images     # nén ảnh mới trong content/blog/images → public/blog-images (WebP)
npm test           # kiểm thử (đăng nhập…); cần build trước: npm run build && npm test
```

Cần Node ≥ 22.18 (server chạy thẳng file `.ts`). Mọi lệnh `npm` / `node` chạy **trong WSL** (`node_modules` là bản Linux).

### Đăng nhập

Mọi trang cần đăng nhập: chưa đăng nhập thì server từ chối `/api` và `/data` (cả `npm run dev` lẫn `npm start`), trang
chuyển về `/login`. Hiện có một loại tài khoản (admin). Tài khoản và phiên đăng nhập nằm ở `data/auth/` (không commit,
không đóng gói); mật khẩu lưu dạng băm (scrypt), phiên giữ 30 ngày (`SESSION_TTL_DAYS`).

```bash
node scripts/user.ts create <email>          # tạo tài khoản (hỏi mật khẩu 2 lần, nhập ẩn, ≥ 10 ký tự)
node scripts/user.ts reset-password <email>  # đặt mật khẩu mới, đăng xuất mọi thiết bị
node scripts/user.ts disable|enable <email>  # khoá / mở tài khoản
node scripts/user.ts list
```

- **Lần đầu** (hoặc máy mới): tạo tài khoản trước, nếu không thì cả dev server cũng bị khoá ở trang đăng nhập.
- **Đổi mật khẩu trên web:** menu Admin (hoặc menu điện thoại) → *Tài khoản* (`/account`). Đổi xong, thiết bị khác bị
  đăng xuất, thiết bị đang dùng vẫn giữ đăng nhập. **Đăng xuất:** cuối menu Admin / menu điện thoại.
- Sai mật khẩu 5 lần (đăng nhập hoặc đổi mật khẩu) → khoá 15 phút.
- Khi chạy sau Cloudflare Tunnel: đặt `TRUST_PROXY=1` để giới hạn sai mật khẩu tính theo IP thật; cookie tự có cờ
  `Secure` khi trang chạy HTTPS.

### PWA (cài lên điện thoại)

Có manifest, icon và service worker (`public/sw.js`): mở trang trên điện thoại → *Thêm vào màn hình chính* / *Cài đặt
ứng dụng*. Service worker chỉ đăng ký ở bản build (`npm run build && npm start`), không ở `npm run dev`; cài PWA và dùng
micro (ghi âm ở Speaking Review) cần **HTTPS** (domain qua Cloudflare Tunnel) hoặc `localhost`.

### Code và data tách riêng

Data (nội dung học trong `content/`, ảnh/PDF/âm thanh trong `public/`, tiến độ học trong `progress/`, bảng giá
`config/gemini-pricing.json`) không nằm lẫn với code trong repo. Bản **data tối thiểu** đi cùng repo dưới dạng thư mục
chưa nén `data-minimal/` để dùng local nhưng bị `.gitignore` loại khỏi commit; bản đầy đủ là một file nén riêng, không đưa lên GitHub. Danh sách đầy đủ ở
`data-manifest.json`; `.gitignore` theo cùng danh sách. Không thuộc cả hai (tạo lại trên máy mới): `.env`, `data/`
(tài khoản đăng nhập), `models/`, `cache/`, `node_modules/`, `dist/`, `logs/`.

**Chuẩn bị commit** (trong thư mục làm việc `english-app-v2`, chạy trong WSL):

```bash
node scripts/sync-commit.ts
```

- Copy code sang `../english-app-commit/code/` (repo git, tạo ở lần chạy đầu; xoá ở đó file đã xoá ở đây), rồi tự
  `git add` / `commit` / `push` trong thư mục đó.
- Ghi **data tối thiểu** (chưa nén) vào `../english-app-commit/code/data-minimal/` để dùng local; thư mục này bị
  `.gitignore` loại khỏi commit. Bản này không có ảnh từ vựng và ảnh notes
  (`scripts/fetch-images.ts` tải lại từ nguồn), ảnh gốc của blog (trang dùng bản WebP trong `public/blog-images/`),
  file ghi âm, file PDF, và những file `restore` tự tạo lại: danh sách phát âm `public/pronunciation/` (tải lại bằng
  `scripts/build-pronunciation.ts`) và `content/topic-collocations/index.json` (ghép từ các file theo chủ đề bằng
  `scripts/build-topic-index.ts`).
- `--full-data`: đóng gói thêm bản đầy đủ (~125 MB) vào `../english-app-commit/data/` (tải lên Drive…, không lên GitHub).
- Trước khi copy, script dừng lại nếu code hoặc data tối thiểu có file `.env`, chuỗi giống khoá API, hoặc file > 5 MB.
- `--no-data`: chỉ copy code.
- Gắn repo GitHub, commit, push và xử lý lỗi thường gặp: xem [GITHUB-PUSH.md](GITHUB-PUSH.md).

### Cài đặt ban đầu / Khôi phục môi trường mới (Setup)

1. **Lấy code và cài thư viện:**
   ```bash
   git clone <repo> english-app && cd english-app
   npm ci
   ```
2. **Khôi phục data** từ thư mục `data-minimal/` có sẵn trong repo, hoặc từ file nén bản đầy đủ đã tải về (kiểm tra
   mã SHA-256 của từng file trước khi ghi; file đã có mà khác thì dừng lại, thêm `--force` để thay — bản cũ được lưu
   vào `data/backup-<giờ>/`):
   ```bash
   node scripts/data.ts restore data-minimal --with-models
   ```
   ```bash
   node scripts/data.ts restore ~/Downloads/english-app-data-<ngày-giờ>.tar.gz --with-models
   ```
   `--with-models` tải luôn model ASR cho Speaking Review (Parakeet TDT, ~130 MB, chạy bằng `sherpa-onnx` trên CPU)
   vào `models/`. Tải tay nếu cần:
   ```bash
   mkdir -p models
   wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8.tar.bz2
   tar -xvf sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8.tar.bz2 -C models/
   rm sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8.tar.bz2
   ```
   Với bản data tối thiểu, `restore` tự tạo lại hai file không có trong gói (chỉ khi chúng còn thiếu):
   `content/topic-collocations/index.json` (ghép từ các file theo chủ đề cùng thư mục) và
   `public/pronunciation/en-gb.tsv` (tải từ ipa-dict và Britfone trên GitHub, cần mạng). Nếu bước tải báo lỗi
   (mất mạng…), hoặc sau khi sửa các file theo chủ đề, chạy tay:
   ```bash
   node scripts/build-topic-index.ts    # ghép lại content/topic-collocations/index.json
   node scripts/build-pronunciation.ts  # tải lại public/pronunciation/en-gb.tsv (+ LICENSE.txt)
   ```
3. **Cấu hình `.env`:** Copy `.env.example` thành `.env` (nếu chưa có) và điền các giá trị cần — cần
   `PIXABAY_API_KEY` (miễn phí, pixabay.com/api/docs) cho bước sau.
4. **Tải lại ảnh từ vựng và notes** (chỉ khi khôi phục bản data tối thiểu):
   ```bash
   node scripts/fetch-images.ts --dry-run   # chỉ liệt kê ảnh còn thiếu
   node scripts/fetch-images.ts             # tải
   ```
   - Mỗi từ / note giữ nguồn ảnh (`image_source`): ảnh Pixabay và Wikipedia được tải lại **đúng ảnh cũ**, lưu **đúng tên
     cũ** (640 px WebP như Admin), nên `words.json` / `notes.json` không đổi.
   - Ảnh không tìm lại được (vài ảnh Flickr, ảnh đã bị xoá khỏi Pixabay) được thay bằng ảnh Pixabay đầu tiên cho cùng
     mô tả (`image_query`) và cập nhật `image_credit` / `image_source` của mục đó; Pixabay không có kết quả thì để trống
     và in ra để chọn lại trong Admin.
   - Gọi Pixabay cách nhau 1,2 s: ~800 ảnh mất ~16 phút. Nếu Pixabay tạm chặn (HTTP 429 / trang "Just a moment" của
     Cloudflare, thường do gọi quá nhiều), script **dừng ngay** và báo; ảnh đã tải được giữ nguyên — chạy lại sau 15–60
     phút, script chỉ tải phần còn thiếu.
5. **Tạo tài khoản đăng nhập:** `node scripts/user.ts create <email>` (hỏi mật khẩu, nhập ẩn; xem mục *Đăng nhập*).
6. **Kiểm tra:** `npm run build && npm test`.

Bản data tối thiểu còn thiếu so với bản đầy đủ (không ảnh hưởng tới việc học): file ghi âm của các bài Speaking Review
cũ (nút nghe lại không phát được; điểm và nhận xét vẫn còn), và ảnh gốc của blog (`content/blog/images/`) — bài blog dùng
bản WebP trong `public/blog-images/` nên vẫn hiện đủ ảnh, chỉ `npm run images` (nén lại ảnh gốc) là không chạy được; và
file PDF của bài Collocations (`public/pdf/`): bài học vẫn mở đủ, chỉ không có tab PDF.
Cần đủ thì khôi phục bản đầy đủ (`english-app-commit/data/`, tạo bằng `node scripts/sync-commit.ts --full-data`).

Đóng gói data bằng tay (không qua `sync-commit`): `node scripts/data.ts pack --minimal` (vào
`../english-app-commit/data-minimal/`) hoặc `node scripts/data.ts pack` (bản đầy đủ, vào `../english-app-commit/data/`);
`--out <thư mục>` để đổi nơi lưu.

### Tự chạy khi mở máy (WSL)

`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NeuralSymbolic.vbs` chạy ẩn
`scripts/dev-server.sh` trong WSL mỗi lần đăng nhập Windows. Script giữ server dev ở http://localhost:5173 (tự khởi
động lại nếu bị crash, bỏ qua nếu đã chạy). Chế độ dev tự cập nhật trang khi file trong `content/` thay đổi. Dev server
cũng cần đăng nhập (mục *Đăng nhập*).

- Log: `logs/dev-server.log`
- Chạy tay: `bash scripts/dev-server.sh`
- Tắt hẳn: `wsl --shutdown` (PowerShell), hoặc xoá file `.vbs` trong thư mục Startup để không tự chạy nữa.

`.env` (xem `.env.example`):

| Biến | Dùng cho |
|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL` (mặc định `gemini-3-flash-preview`), `GEMINI_THINKING` (`low`/`medium`/`high`, mặc định `low`) | Mọi tính năng AI: Grammar Analyze, các nút "Generate" trong Admin, thẻ ôn tập bằng Gemini, Writing Review. Với Gemini 3, temperature để mặc định và schema gửi dạng JSON Schema |
| `PIXABAY_API_KEY` | Ảnh minh hoạ trong Admin → Vocabulary / Notes, và `scripts/fetch-images.ts` (miễn phí: pixabay.com/api/docs) |
| `SESSION_TTL_DAYS` | Số ngày giữ đăng nhập (mặc định 30) |
| `TRUST_PROXY` | `1` khi chạy sau Cloudflare Tunnel: lấy IP người dùng từ `CF-Connecting-IP` (giới hạn sai mật khẩu) |
| `DATA_DIR` | Thư mục chứa `auth/` (tài khoản, phiên); mặc định `data/` |
| `ADMIN_TOKEN` | Tuỳ chọn, cũ (trước khi có đăng nhập). Nếu đặt, mọi thao tác ghi của Admin cần thêm header `x-admin-token` |
| `PORT` | Cổng của `npm start` |

## Dữ liệu

```
content/
  vocabulary/  words.json, topics.json
  collocations/ lessons/*.json, markdown/*.md      (PDF gốc ở public/pdf/collocations)
  grammar/     lessons.json, topics.json, history.json (cache Analyze), analyze-prompt.md
  note/        notes.json
  practice/    quiz/*.json, writing/*.json
  blog/        topics.json, posts/posts-*.json, markdown/<Topic>/<slug>.md, images/ (ảnh gốc)
  review/      thẻ ôn tập của bạn: <deck>.json (theo review_card_schema.json) hoặc <deck>.md (mỗi dòng một thẻ)
  schema/      JSON schema (Gemini, Admin, thẻ ôn tập)
progress/      tiến độ ôn tập: review.json (trạng thái thẻ + cài đặt; thẻ có "done" = đã xong, không còn lên lịch), review-log.jsonl (lịch sử từng lượt ôn),
               produce-log.jsonl (câu "Tự dùng" bị sai / chưa tự nhiên, để làm sổ lỗi sau này)
               writing-reviews/<id>.json: kết quả Writing Review đã lưu
cache/ozdic/   trang ozdic.com đã tra (Writing Review) — mỗi từ tải 1 lần
cache/dol/     từ điển DOL Việt → Anh: wordlist.json (70k mục, làm mới mỗi tuần) + entries/ (mỗi mục đã tra)
public/pronunciation/  từ điển phiên âm Anh–Anh cho trang Read aloud (ipa-dict + Britfone, MIT) — tạo lại bằng: node scripts/build-pronunciation.ts
data/auth/     users.json (tài khoản, mật khẩu đã băm), sessions.json (phiên đăng nhập) — không commit, không đóng gói
data/backup-*/ bản cũ của file data bị thay khi `node scripts/data.ts restore … --force`
```

`content-pipeline/` đọc các file này, chuẩn hoá và sinh ra `/data/*.json`: một file index nhỏ cho mỗi thư viện
và một file cho mỗi bài học, để trang chỉ tải đúng dữ liệu cần. Khi chạy dev, sửa file trong `content/` là trang tự
cập nhật.

**Thêm bài blog:** chỉ cần đặt file `.md` vào `content/blog/markdown/<Chủ đề>/`. Bài tự xuất hiện, với chủ đề là tên
thư mục, tiêu đề lấy từ tên file và ngày là lúc sửa file. Muốn đặt tiêu đề, tóm tắt, sub-topic riêng thì dùng Admin → Blog
(hoặc thêm vào `content/blog/posts/posts-*.json`). File có tên bắt đầu bằng `_`, chứa `template`, hoặc file rỗng sẽ bị ẩn (bản nháp).

## Ôn tập ngắt quãng (Review)

Trang `/review` dùng thuật toán **FSRS** (thư viện `ts-fsrs`): thẻ hay quên quay lại sớm, thẻ dễ giãn dần.

- **Nguồn thẻ:** từ vựng, collocations trong bài, collocations nằm trong từ vựng, notes và thẻ của bạn. Tất cả được
  `content-pipeline/review.ts` chuẩn hoá về **một schema chung** (`ReviewCard` trong `src/types/content.ts`) và xuất ra
  `/data/review/index.json`. Mỗi thẻ có id ổn định (`vocab:<từ>`, `colloc:<bài>:<cụm>`, `wcolloc:<từ>:<cụm>`, `note:<id>`,
  `custom:<bộ>:<id>`), nên sửa nội dung không làm mất tiến độ.
- **Giới hạn thời gian phiên:** bấm Start review / Practice again / Learn more new sẽ hỏi 10 / 15 / 20 / 25 phút hoặc
  không giới hạn (lần chọn trước được đánh dấu sẵn; vẫn đổi được trên đầu phiên). Chỉ tính lúc tab đang mở;
  hết giờ thì dừng sau thẻ đang làm, các thẻ còn lại vẫn đến hạn cho lần sau; có nút "Học thêm 5 phút".
- **Bậc dùng từ (usage ladder, bật/tắt trong *Settings*):** FSRS quyết định KHI NÀO ôn, bậc của thẻ (`stage` trong
  `progress/review.json`) quyết định ÔN THẾ NÀO. 5 bậc:
  1. **Nhận ra** — thấy từ → nhớ nghĩa, hoặc **Nghe chép** (chế độ *Dictation*, xem dưới).
  2. **Nhớ ra từ** — thấy nghĩa → gõ từ.
  3. **Dùng đúng cụm** — điền từ đi kèm của một collocation vào câu ví dụ (chấm trên máy, không gọi AI).
  4. **Viết lại câu** (paraphrase) — viết lại một câu cho sẵn, giữ nguyên nghĩa, bằng từ hoặc một collocation của nó
     ("Viết lại câu này bằng *alleviate*: The council took steps to make the traffic problem less severe."). Có câu mẫu.
  5. **Tự dùng** — viết 1 câu IELTS với từ HOẶC một collocation của nó, trả lời một câu hỏi theo ngữ cảnh.

  Good/Easy lên một bậc, Hard đứng yên. Again ở bậc 4–5: sai cụm/dạng từ → bậc 3, sai nghĩa/không dùng từ → bậc 2, chỉ đổi
  nghĩa câu gốc (bậc 4) → đứng yên. Bậc nào thẻ không có dữ liệu (không có collocation, chưa có câu viết lại, câu/công thức
  dài) thì được bỏ qua lên bậc kế tiếp. Logic chung: `src/features/review/ladder.ts`; bài tập: `usageTasks.ts`,
  `UsageExercises.tsx`, `Dictation.tsx`. Tab *Words* có cột **Bậc** và bộ lọc theo bậc.
  **Tick "Usage ladder" theo từng từ** (mặc định mọi thẻ đều tick): bỏ tick ngay trên thẻ khi ôn (góc trên bên phải, cả
  trong vòng viết câu) hoặc ở cột Bậc của tab *Words* cho từ ít dùng khi nói/viết → thẻ chỉ ôn ở mức **Nhận ra**
  (`ladder: false` trong `progress/review.json`, `POST /api/review/ladder`); bậc cũ được giữ, tick lại thì học tiếp từ đó.
  Có áp dụng từ lần ôn kế tiếp của thẻ. Bộ lọc bậc có mục "Chỉ nhận dạng".
- **Dữ liệu bài tập trong `words.json`** (Gemini viết luôn khi tạo từ bằng *Generate* ở Admin Vocabulary; xem khung dưới
  Preview; 605 từ cũ đã được bổ sung sẵn). **Collocation trong bài học** (`content/collocations/lessons/*.json`, mục
  `vocabulary_data`) dùng đúng 3 trường này với cùng schema: mục tiêu duy nhất là chính cụm đó (`fits` = [], 1 câu nghe chép,
  2 bài viết lại đều dùng cụm). 1.790/1.800 cụm đã có; 10 mục cố ý không có (tiêu đề mục và các cụm ghi "cách dùng không
  phù hợp" / lỗi sai — luyện chúng sẽ học nhầm).
  **Notes** (`content/note/notes.json`) cũng có đủ 3 trường (192/192): mục tiêu là tiêu đề note hoặc một `patterns` của nó;
  câu nghe chép và câu mẫu luôn điền chỗ trống bằng từ thật. Tạo note bằng *Generate* ở Admin Notes thì Gemini viết luôn
  (schema và prompt dùng chung: `server/admin/drills.ts`); lưu note trong Admin giữ nguyên các trường này.
  Bậc "Nhớ ra từ" chấm tiêu đề kiểu mẫu câu linh hoạt (`src/features/review/recall.ts`): chỗ trống (`+ N`, `sb/sth`,
  `somebody`, `A/B`, `do something`, `S + V`…) được bỏ trống hoặc điền vài từ đều đúng; "x / y" và "x vs y" gõ một vế là đủ. Kiểu: `UsePrompt`, `DictationLine`, `ParaphraseTask` trong
  `src/types/content.ts`; làm sạch chung trong `src/lib/wordDrills.ts` (pipeline, Admin, Preview dùng chung):
  - `use_prompts`: 3 câu hỏi ở 3 ngữ cảnh, mỗi câu kèm `fits` = các collocation hợp với nó. Ôn collocation thì chỉ dùng câu
    hỏi có collocation đó trong `fits`. Thẻ không có câu hỏi dùng ngân hàng câu hỏi chung trong `usageTasks.ts`.
  - `dictation`: 1 câu đơn giản (6–12 từ) cho từ và cho mỗi collocation.
  - `paraphrase`: 2 bài viết lại (`source` không chứa từ mục tiêu, `model` = câu mẫu dùng nó).
- **Luyện dùng từ** (nút trên Overview, trang `/review/usage`): lịch FSRS chỉ cho thẻ lên 1 bậc mỗi lần ôn, mà lần ôn giãn
  dần (vài ngày → vài tuần), nên phiên này cho thẻ **đã thuộc** (trạng thái Review, đang bật Usage ladder, chưa luyện hôm nay)
  luyện các bậc dùng từ — Dùng đúng cụm → Viết lại câu → Tự dùng — mà không chờ lần ôn sau. Chọn 5/10/15/20 thẻ, lấy luân
  phiên từ mỗi bậc (ưu tiên thẻ ôn gần đây); bài điền cụm trước, câu viết gom 3 câu/lần gọi Gemini. Chấm như lúc ôn
  (Good/Easy lên bậc, Hard giữ, Again lùi) nhưng **chỉ đổi bậc**: ngày đến hạn, độ bền và thống kê ôn không đổi
  (`POST /api/review/usage`, `usedOn` trong `progress/review.json`, nhật ký `progress/usage-log.jsonl`). Mã:
  `usagePlan.ts`, `UsageSessionPage.tsx`.
- **Chấm câu viết (bậc 4 và 5) bằng Gemini (`POST /api/review/produce`, `server/review/produce.ts`):** tối đa 3 thẻ ở hai
  bậc này được gom thành một vòng (trộn cả hai loại) và chấm trong **một** lần gọi (≈110–150 token/câu). AI chỉ trả nhận
  định theo schema cố định (`verdict` ok / missing / wrong_meaning / wrong_collocation / wrong_form / changed_meaning,
  `natural`, `fixed`, `why`, `better`, `other`, `ref_backed`, và `same_meaning` — câu viết lại mà đổi nghĩa câu gốc thì code tự chấm `changed_meaning`); câu viết lại không cần `better` vì đã có câu mẫu sẵn.
  Mức Again/Hard/Good/Easy do code gợi ý (sai → Again; đúng nhưng gượng, dùng gợi ý hoặc > 2 phút → Hard; đúng < 30 s →
  Easy; còn lại Good) và bạn xác nhận. Lỗi ngoài từ mục tiêu chỉ ghi chú, không tính điểm. Mỗi câu gửi kèm dòng `REF` lấy từ
  dữ liệu của thẻ (collocations, patterns, 1 ví dụ — đã đối chiếu Longman/OZDIC lúc thêm từ); prompt coi REF là chuẩn. Màn
  kết quả ghi rõ nhận định có dựa vào REF hay chỉ theo kiến thức của AI. Để trống câu = chưa làm được (không tốn token).
  Câu sai được lưu vào `progress/produce-log.jsonl`.
- **Nghe chép (chế độ *Dictation*, thay cho *Listen* cũ):** trình duyệt đọc câu `dictation` của thẻ (nút đọc chậm, Ctrl+Space
  nghe lại); bạn gõ lại cả câu, nhấn Submit; máy so từng từ (không gọi AI). Đúng hết → Good, sai 1–2 từ → Hard, nhiều hơn →
  Again. Thẻ chưa có câu riêng thì đọc ví dụ ngắn nhất có chứa từ, không có nữa thì đọc chính từ đó.
- **Nguồn ôn** (hàng nút *Sources* trên Overview): chọn một hoặc nhiều nguồn — Vocabulary, Collocations, In vocabulary,
  Notes, My cards, Essays (chỉ hiện nguồn có thẻ trong Review); mặc định *All*. Số đến hạn/mới, Start review, Practice again
  và Luyện dùng từ đều chỉ dùng các nguồn đã chọn (link có `?src=vocabulary,note`); lựa chọn được nhớ trong trình duyệt.
  Hạn mức thẻ mới mỗi ngày vẫn dùng chung cho mọi nguồn. Mã: `src/features/review/sources.ts`.
- **Chọn thẻ để ôn:** nút *Review* trên từng thẻ, *Add lesson to review* trên trang bài học, hoặc tab *Decks* trong `/review`.
  Từ và note mới tạo trong Admin tự vào danh sách ôn (tắt được trong *Settings*).
- **Thẻ của bạn:** tab *My cards* (nhập tay, tạo bằng Gemini, hoặc dán danh sách), hoặc tự tạo file trong `content/review/`:
  - `my-words.json`: `{ "name": "...", "cards": [ ... ] }`, mỗi thẻ theo `content/schema/review_card_schema.json`.
    Chỉ `term` là bắt buộc; các trường khác (`pronunciation`, `part_of_speech`, `meaning_vi`, `meaning_en`, `examples`
    `[{ en, vi }]`, `collocations` `[{ text, meaning_vi, example }]`, `synonyms`, `antonyms`, `usage_note_vi`,
    `mnemonic_vi`, `tags`, `id`) có thể bỏ trống. Xem mẫu `content/review/_example.json`.
  - `phrases.md`: mỗi dòng `term — nghĩa` (nghĩa có thể bỏ trống), dòng `# Tên bộ` đặt tên bộ thẻ. Mẫu: `_example.md`.
  - File bắt đầu bằng `_` bị bỏ qua. Thẻ sai định dạng được bỏ qua và in cảnh báo khi chạy.
- **Ôn:** 3 kiểu bật trong Settings, *Recognise* (thấy từ, nhớ nghĩa), *Recall* (thấy nghĩa, gõ từ), *Dictation* (nghe câu ngắn, gõ lại). Chấm Again/Hard/Good/Easy
  (phím 1–4, Space, Z để hoàn tác). Mặc định 20 thẻ mới/ngày; ngày mới bắt đầu lúc 4:00 giờ Việt Nam.
- **Tiến độ** nằm trong `progress/` (cần server: `npm run dev` / `npm start`). Nên sao lưu thư mục này cùng `content/`.

Cảnh báo dữ liệu (ví dụ từ trong topic nhưng thiếu trong `words.json`) được in ra lúc chạy/build.

Có thể deploy `dist/` lên bất kỳ static host nào (cần rewrite mọi đường dẫn về `index.html`). Khi đó Analyze và Admin
không hoạt động, vì chúng cần `npm start` hoặc `npm run dev`.

## Admin → Vocabulary → Generate

3 bước: (1) Gemini đưa từ về nguyên mẫu (`decisions` → decision, `took responsibility` → take responsibility) và chọn 1–2 từ khoá;
(2) tra từ điển cho từng từ khoá: **Longman trước** (ldoceonline.com, cache `cache/longman/`, 1 lần/3 s,
`server/writing-review/longman.ts`); chỉ khi Longman không có hộp COLLOCATIONS mới tra OZDIC (Oxford Collocations, cache
`cache/ozdic/`). `LONGMAN_LOOKUP=off` trong `.env` tắt tra Longman (chỉ dùng cache);
(3) prompt chính nhận toàn bộ mục từ điển cùng ghi chú + hình ảnh của bạn, sửa collocation/pattern viết sai theo từ điển
và liệt kê các chỗ đã sửa. AI tách ghi chú thành câu ví dụ / collocation / pattern (một câu hoàn chỉnh luôn là ví dụ).
Nếu không có collocation nào, AI thêm 3–4 cụm thông dụng trong IELTS Speaking/Writing kèm ví dụ, cho mọi loại từ (kể cả
động từ): lấy từ từ điển (code kiểm lại, cụm bịa bị bỏ); nếu từ điển có quá ít thì AI bổ sung và trang ghi
"not verified by a dictionary". Mã: `server/admin/ozdic-grounding.ts`.
Nếu bước 1 lỗi hoặc cả hai từ điển không có dữ liệu, entry vẫn được tạo như trước.

**Ảnh minh hoạ** (`server/admin/images.ts`): Gemini trả thêm `image_query` — một cảnh chụp được thể hiện nghĩa
("ambitious" → "person climbing mountain summit success"); server tìm Pixabay (`PIXABAY_API_KEY`) + Wikipedia search +
Openverse, tải ảnh đầu tiên về `public/vocab-images/<từ>.webp` (640px) và lưu `image_credit`/`image_source`/`image_query`
trên từ. Khung *Picture* trong Admin hiện lưới ảnh ứng viên để đổi ảnh, tìm lại hoặc bỏ ảnh. Thay ảnh hàng loạt:
`node scripts/refresh-vocab-images.ts <file index|query>`. Nghiên cứu so sánh nguồn ảnh: `../image-lab`.

**Admin → Notes → Generate** dùng cùng cách: bước 1 tìm mục chính của note ở dạng nguyên mẫu (hoặc "A vs B" khi so sánh)
và 1–3 từ khoá; bước 2 tra Longman rồi OZDIC như trên (chỉ gửi danh sách collocation, không gửi câu ví dụ của từ điển); prompt chính sửa
collocation/pattern/ví dụ viết sai theo OZDIC và liệt kê các chỗ đã sửa. Note không tự thêm collocation mới.

## Model essays (Practice → Model essays, Admin → Essays)

Học từ vựng, collocation và cách viết từ bài mẫu. **Admin → Essays**: dán đề + bài → 1 lần gọi Gemini (thinking `medium`,
~30 s, ~8k token) phân tích thành bài học và lưu `content/essays/<id>.json`: vai trò + bản dịch từng câu, dàn ý từng đoạn,
collocation / từ vựng / paraphrase đề / khung câu, chỗ viết chưa hay, 3 đề mới. Code tự tách câu, tìm đúng vị trí từng cụm
(cụm không khớp nguyên văn bị bỏ) và tự dò từ nối (`server/essays/linking.ts`).

Trang học có 4 bước: **Đọc** (highlight theo lớp, vai trò câu, tiếng Việt, đọc to; bấm cụm → nghĩa, câu, từ điển
Longman (OZDIC khi Longman không có collocation), bài khác có cùng cụm, Add to review) · **Nhớ lại** (điền 1 từ / cả cụm trên bài gốc, dịch ngược câu —
chấm bằng code) · **Viết lại đoạn** từ dàn ý (AI nhận xét) · **Dùng vào đề mới**: đoạn 3–4 câu với 5 cụm mục tiêu, AI chấm
từng cụm đúng / sai / chưa dùng (~1k token). Cụm được thêm vào Review (deck "Model essays", thẻ `essay:<bài>:<cụm>`); cụm
đã thuộc tự mờ đi. **Kho cụm từ** gom cụm của mọi bài, cụm có trong nhiều bài xếp trước.
Bôi đen một cụm trong bài → **Thêm vào bài này** (Gemini điền nghĩa, ~1 lần gọi nhỏ) hoặc gửi sang **Admin Vocabulary /
Notes** (kèm câu làm ngữ cảnh). Trong thẻ cụm: **Đã thuộc** (đánh dấu done trong Review, cụm mờ đi) hoặc **Xoá khỏi bài**.
Mã: `server/essays/`, `server/admin/essays.ts`, `content-pipeline/essays.ts`, `src/features/essays/`.

## Admin → Usage (token & chi phí Gemini)

Mọi lượt gọi Gemini đi qua `server/gemini.ts → generate()`, và **mỗi phản hồi** (kể cả lượt bị lỗi JSON phải gọi lại —
vẫn bị tính tiền) được ghi vào `logs/gemini-usage.jsonl` (input / output / thinking token, model, nhãn tính năng); log cũ
`logs/gemini_usage.json` vẫn được đọc. Trang Admin → Usage thống kê theo tháng này / tháng trước / 7 / 30 ngày / tất cả /
khoảng tuỳ chọn: chi phí theo ngày, theo tính năng, theo model, theo tháng, 50 lượt gần nhất. Đơn giá (USD / 1M token,
output gồm thinking) và tỷ giá USD→VND ở `config/gemini-pricing.json`, sửa trong trang hoặc sửa file. Mã: `server/usage.ts`,
`server/admin/usage.ts`, `src/features/admin/UsageAdminPage.tsx`.

## Writing Review (Practice → Writing Review)

Paste an IELTS Writing paragraph → **Claude** (Claude only, no Gemini) edits it like an IELTS examiner
(`server/writing-review/rewrite.ts`): it fixes every error (spelling, grammar, word form, collocation, word choice,
naturalness) **and** upgrades weak phrasing to band 7–8 (free time → leisure time, help → enable…), **keeping the writer's
ideas and structure, with no new ideas added**. Every replacement word must be found in Longman or OZDIC (Oxford Collocations).
1. **diagnose** (1 lần gọi): mỗi chỗ sửa là một đoạn nguyên văn + bản thay, loại lỗi, mức ❌ lỗi / ✨ nâng cấp, lý do tiếng Việt,
   các tổ hợp mới mà bản thay tạo ra.
2. **Xác nhận bằng code, không phải AI** — chữ nào không có cơ sở từ điển thì không vào bài:
   - không có từ nội dung mới (bỏ bớt chữ, đổi trật tự, từ chức năng): không cần tra;
   - chính tả / ngữ pháp / dạng từ, và đổi từ viết gần giống (raise→rise, advice→advise): từ mới phải có mục trong
     Longman hoặc OZDIC;
   - collocation / dùng từ / tự nhiên: tổ hợp mới phải được liệt kê trong hộp Collocations của **Longman** hoặc **OZDIC**;
     nếu Claude khai sai tổ hợp, code tự dò từ mới với từ đứng cạnh (chỉ nhận "confirmed").
3. **retry** (chỉ khi cần): Claude nhận danh sách collocation thật và định nghĩa Longman của từ mới để chọn lại, hoặc chỉ
   ra định nghĩa Longman khớp nghĩa (code đối chiếu với mục từ) → nhãn "Từ điển: nghĩa". Vẫn không được thì chỉ nằm ở
   "Cần xem lại".
4. Trang hiện **bài làm đã chấm** (chữ cũ gạch, sửa lỗi màu xanh, nâng cấp màu tím, rê chuột xem lý do; giữ nguyên các
   đoạn) và 3 tab: **Sửa bài chi tiết** (lỗi ❌ + nâng cấp ✨ với dòng từ điển, link Longman/OZDIC, mục "Cần xem lại"),
   **Bài nâng cấp** (bản sạch, Copy) và **Từ vựng** (từ/cụm mới được thay vào, kèm bằng chứng từ điển). Không có danh sách
   lịch sử: trang tự mở lại bài review gần nhất; bài cũ (Gemini) vẫn mở được bằng `?id=`. Mỗi bài ~1–2 phút, 1–2 lần gọi Claude.

**Claude chạy qua Claude Code** (`server/llm/claude-code.ts`): server gọi lệnh `claude -p` bằng tài khoản Claude đã đăng
nhập trên máy (gói Pro/Max/Team) — không cần API key, tính vào hạn mức của gói thay vì tiền theo token (trang Usage ghi
0 USD, `billing: "subscription"`). Mỗi lần gọi được giữ gọn (~1,2k token phụ thay vì ~28k): prompt hệ thống của app thay
cho của Claude Code, không công cụ, chạy trong thư mục trống, JSON được CLI kiểm theo schema (`--json-schema`).
Cài một lần trong WSL: `curl -fsSL https://claude.ai/install.sh | bash`, thêm `~/.local/bin` vào PATH, chạy `claude` để
đăng nhập. Biến môi trường (tuỳ chọn): `WRITING_REVIEW_CLAUDE_MODEL` (`opus` / `sonnet` / id; trống = model mặc định của
gói), `WRITING_REVIEW_EFFORT` (`low`…`max`, mặc định `high`), `CLAUDE_BIN`, `CLAUDE_CODE_PARALLEL` (mặc định 2 lượt cùng
lúc), `CLAUDE_CODE_TIMEOUT_MS` (mặc định 5 phút). Tra OZDIC bị rớt mạng thì từ đó ghi "không tra được", bài vẫn chạy tiếp.
Tra từ điển có cache (`cache/ozdic/`, `cache/longman/`), mỗi lượt tra mạng cách nhau 1,5 s (OZDIC) / 3 s (Longman), tự
dừng một lúc nếu bị giới hạn/chặn; `LONGMAN_LOOKUP=off` tắt Longman. Bài nâng cấp (model essay) chạy song song với bước
chẩn đoán; khi có bản tiếng Việt, các cụm tiếng Việt được tra từ điển DOL và đưa vào prompt (tab "Cụm từ gợi ý").

## Speaking Ideas (Practice → Speaking Ideas)

Dán đề IELTS Speaking (dòng đầu là chủ đề, mỗi dòng sau là một câu hỏi; Part 2 = cả cue card là một câu), ghi ý của mình cho
từng câu (không bắt buộc) → **Claude** (chỉ Claude, qua Claude Code như Writing Review) gợi ý cụm từ trong thư viện của app
(Collocations, Vocabulary, collocation trong từ, Notes), câu ví dụ theo đúng ý người học, tối đa 3 cụm ngoài thư viện, và
**câu trả lời mẫu** dùng các cụm đó (đánh dấu: xanh = thư viện, tím = cụm mới đã xác nhận, cam = cụm mới chưa xác nhận).
Mỗi lượt ~1 phút, 2 lần gọi Claude (`server/speaking/suggest.ts`):
1. **analyze** (effort low): mỗi câu hỏi cần làm gì (nói sở thích, kể hồi nhỏ, nêu ý kiến… — 18 "chức năng" trong
   `src/types/speaking.ts`), thuộc chủ đề nào, và các từ khoá một câu trả lời hay sẽ có (kể cả từ trong ý của người học).
2. **match** (code): chấm điểm từng mục đã gắn nhãn theo chức năng, chủ đề, từ khoá (trong cụm, ví dụ, câu hỏi "Tự dùng"),
   cộng điểm cho từ đang học trong Review (chưa ổn định) → 25–40 ứng viên mỗi câu, tối đa 150. Mục gắn nhãn `writing`
   (chỉ hợp văn viết) không bao giờ được gợi ý.
3. **suggest**: Claude chỉ được chọn trong danh sách ứng viên (code kiểm tra id), viết cách dùng, câu ví dụ, và câu trả lời
   mẫu **theo phương pháp NeuralSymbolic**: prompt kèm nguyên file `content/speaking/linearthinking-skill.md` (bản sạch, không
   HTML, của bài blog `General/speaking-skills.md`; sửa file này là có hiệu lực ở lần chạy sau). Câu trả lời trả về từng câu
   với Linear tool của nó (Answer / Description / Cause / Effect / Example / Specify; Part 2: Lead-in / Introduction /
   Conclusion), cấu trúc được đánh dấu `{{ }}` (tô xanh lá) và liệt kê ở mục "Cấu trúc NeuralSymbolic" (nhãn "mở rộng" =
   Claude tự mở rộng ngoài guide). Không có flow cố định: câu hỏi và ý người học quyết định dùng tool nào, thứ tự nào (mục
   "Be flexible" trong guide); độ dài theo chuẩn IELTS (`ANSWER_WORDS`: Part 1 40–70 từ, Part 2 200–300, Part 3 80–130),
   trang hiện số từ so với chuẩn.
4. **dictionary**: cụm ngoài thư viện **và các collocation / verb pattern Claude tự viết trong câu trả lời** (Claude liệt kê
   kèm tổ hợp cần tra) được kiểm tra như một chỗ sửa của Writing Review (`verifyPhrase`): một từ phải có mục trong
   Longman/OZDIC, nhiều từ thì tổ hợp phải được liệt kê (verb + N + adj như "make deliveries smoother" tra adj + N).
   Ngoài cặp collocation, cụm còn được xác nhận nếu Longman có nó trong mục thành ngữ / cụm động từ của một từ trong
   cụm (liên kết "→ easy on the eye/ear", "take something ↔ down"; khớp bỏ qua đại từ/placeholder, cho phép chen ≤3 từ).
   Trang Longman lưu trước khi có dữ liệu này được tải lại khi cần tra cụm (`lookupLongman(…, { refresh: true })`).
5. **alternatives** (chỉ khi cần, Claude effort low, chạy song song với polish): cụm ngoài thư viện (ở "Phrases only" là
   từ vựng cho ý) mà cả Longman, OZDIC lẫn DOL đều không xác nhận → Claude lập tối đa 5 ứng viên cùng nghĩa; ứng viên đầu
   tiên được xác nhận thay vào thẻ và câu ("Thay cho …"). **Cụm Claude tự viết trong câu trả lời không còn bị tự động thay**
   (cụm "có trong từ điển" chưa chắc tự nhiên hay đúng nghĩa) — polish xem danh sách của từ điển và chỉ thay khi tự nhiên ngang.
6. **polish** (Claude, `SPEAKING_POLISH_EFFORT`, mặc định = `SPEAKING_EFFORT`): vai giám khảo + biên tập bản ngữ đọc lại từng
   câu, sửa chỗ **lệch ý / sai chuyện** (so với ý người học), **chưa tự nhiên** (collocation lạ, cụm bị nhét, **viết quá tay**:
   chồng tính từ/trạng từ nhấn mạnh, từ văn viết trong bài nói, câu kết sáo rỗng) và cụm từ điển không liệt kê nếu có cách
   nói có trong từ điển tự nhiên ngang vậy. Polish và alternatives là "best effort": lỗi thì giữ bản nháp, không hỏng cả lượt.

**Phong cách bài mẫu**: prompt yêu cầu văn nói tự nhiên. Không giới hạn số cụm "đắt": dùng mọi cụm là cách nói tự nhiên
nhất cho một ý (bài dài, ý nhiều thì nhiều cụm hơn), câu nào nói thường hay hơn thì để thường, thường tối đa một cụm mỗi
câu; cấm chồng từ nhấn mạnh và từ văn viết; có các cặp ví dụ ✗ viết quá tay / ✓ tự nhiên (chỉ để học văn phong).

**Từ điển DOL (Việt → Anh)** (`server/writing-review/dol.ts`, xem `input-file/DOL-Dictionary-de-xuat.md`): DOL mạnh ở
**collocation dài**, nên ý tiếng Việt được tách thành các cụm cỡ collocation (2–6 từ, tối đa 15: "giảm gánh nặng tài chính",
"cạnh tranh gay gắt") — Speaking do bước analyze tách (`vi_terms`), Writing do một lần gọi AI nhỏ (effort low, bước "dol",
~10 s, chạy trước chẩn đoán); nếu lần gọi đó lỗi thì code tách ở dấu câu / từ nối (cửa sổ 6 từ chồng nhau). Cụm từ điển
nằm trong một cụm không được cắt đôi một từ khác ("có điều" trong "không có điều kiện"), và mục dài hơn cụm quá 1 từ thì
không tính là bản dịch của cụm ("trên mạng" ≠ "lang thang trên mạng"). Mỗi cụm tra 3 đường: khớp nguyên cụm và các cụm từ điển nằm trong nó (danh sách 70k mục `vnWord → url` trên
máy), và API search (bắt được cụm có từ chen "cạnh tranh *rất* gay gắt" và từ đồng nghĩa "tắc đường" → "ùn tắc giao
thông"; kết quả search đã có đủ mục từ nên không cần gọi thêm). Cụm dài xếp trước, tối đa 2 mục "exact" mỗi cụm.
Ngoài ra mỗi cụm có tới 5 mục **"near"**: hàng xóm về nghĩa mà search tìm được, có chung ít nhất một từ với cụm ("sử
dụng điện thoại" → "chơi điện thoại", "lướt điện thoại", "nghiện điện thoại"). Code không phân biệt được mục nào đúng ý,
nên tất cả được đánh số (d1, d2…) trong prompt của bước viết bài (Speaking) / viết bài mẫu (Writing); AI trả lại số của
các mục nói đúng ý người học (`dol`) và trang chỉ hiện các mục đó (AI không chọn mục nào thì hiện các mục exact).
Khớp không dấu chỉ được nhận khi so cả dấu vẫn giống ≥ 85% ("hại mắt" ≠ "hai mặt"). Cụm AI viết trùng bản dịch DOL của ý người học
được tính là đã xác nhận (nguồn "DOL"). Trang hiện mục "Từ điển DOL (Việt → Anh)". Cache ở `cache/dol/`, ≤4 request/giây,
lỗi mạng thì bỏ qua gợi ý (không hỏng lượt). `DOL_LOOKUP=off` tắt tra mạng. Nội dung © DOL English: chỉ dùng cá nhân.

Thứ tự ưu tiên khi viết: đúng ý người học → tự nhiên → khung NeuralSymbolic → dùng cụm gợi ý (2–4 cụm, chỉ ở chỗ tự nhiên
nhất; cụm ngoài thư viện là gợi ý để học, không bắt buộc đưa vào câu). Trước khi viết, Claude diễn lại ý bằng tiếng Anh
("Ý chính (Think in English)", hiện trên trang). Số ứng viên: 25–40 mỗi câu hỏi (đề 1–2 câu: 40, 6+ câu: 25), dùng chung,
tối đa 150 — đo thực tế: cụm Claude chọn nằm từ hạng 1 đến 29 (trung vị ~12) và 1/4 lấy từ danh sách của câu khác.

Công tắc **Model answer / Phrases only**: "Phrases only" chỉ chạy analyze (Claude, effort low, ~4k token), match (code) và
tra từ điển — ~15–30 giây, không viết bài mẫu. Mỗi câu hỏi hiện phần phân tích (câu hỏi cần làm gì, chủ đề, từ khoá của
chủ đề và **từ khoá trong ý người học**), **"Từ vựng cho ý của bạn"** (6 từ/cụm Claude đề xuất để nói đúng ý đó, tra Longman/
OZDIC, có nút thêm vào Vocabulary/Notes) và 25–40 cụm trong thư viện, lọc được theo chức năng. Khi xếp hạng thư viện, từ
khoá của ý nặng nhất khi nằm ngay trong cụm ("fast-flowing river"), nhẹ khi chỉ có trong câu ví dụ; có ý mà mục không chứa
từ nào của ý thì bị trừ điểm.

Mỗi cụm thư viện có nút **Thêm vào ôn tập** (thẻ đưa vào Review). Kết quả lưu ở `progress/speaking/`; trang tự mở lại
lần gợi ý gần nhất. Nút **History** mở `/practice/speaking-ideas/history`: cột trái là các lần gợi ý nhóm theo ngày (lọc Tất cả /
Hôm nay / 7 ngày / 30 ngày / một ngày cụ thể; API `GET /api/speaking/history?from=&to=`), khung phải là câu trả lời và
phân tích đầy đủ của câu hỏi đang chọn.

**Library sync** (nút trên trang): nhãn của thư viện nằm ở `content/speaking/index.json` (mỗi mục: `functions`, `topics`,
`use` speaking/both/writing, `slot` cách đặt vào câu, `hash` của nội dung). Admin không gắn nhãn khi thêm từ; từ mới chỉ
được gợi ý sau khi bấm Sync. Sync chỉ gửi mục mới hoặc mục đã sửa (hash đổi) cho Claude, 50 mục một lần gọi, 2 lần gọi song
song, lưu sau mỗi lô (dừng giữa chừng vẫn giữ phần đã xong), và xoá nhãn của mục không còn. Lần đầu: 4.458 mục, 90 lần gọi,
~750k token (tính vào hạn mức gói Claude, Admin → Usage ghi "Speaking ideas · Sync"). Thư mục `content/speaking/` không làm
rebuild nội dung hay reload trang.

Sync cũng gắn nhãn **kho cụm theo chủ đề** (`content/topic-collocations`, 5.263 mục, phần lớn lấy từ bài mẫu Writing
Task 2) vào `content/speaking/topic-tags.json`: ngoài chức năng / chủ đề / giọng văn còn có **độ khó** (B1–C2, mức cần để
*dùng* tự nhiên) và **loại** (`collocation` dùng lại được, `word`, hay `fragment` = mẩu câu của một bài cụ thể). Speaking
ideas bỏ mẩu câu, cụm C2 và cụm chỉ hợp văn viết, và xếp cụm C1 thấp hơn B1/B2; Writing Review (tab "Cụm từ gợi ý") bỏ mẩu
câu và cụm C2. Mục chưa gắn nhãn vẫn được dùng như trước (chức năng/chủ đề đoán theo tên nhóm). Sync bỏ qua giá trị
nhãn lạ thay vì làm hỏng cả lô 50 mục. Biến môi trường (tuỳ chọn): `SPEAKING_CLAUDE_MODEL` (trống = model của Writing Review),
`SPEAKING_EFFORT` (mặc định `medium`), `SPEAKING_TAG_EFFORT` (Sync, mặc định `low`).

## Cấu trúc code

```
src/
  components/      layout (header, menu, tìm kiếm Ctrl+K), ui (Button, Card…), StudyOverlay, CatalogLayout, Markdown
  lib/             data.ts (useData: fetch + cache + Suspense), theme, storage, text
  features/<tên>/  mỗi tính năng một thư mục: vocabulary, collocations, words (WordCard, Flashcards), grammar,
                   notes, blog, practice, admin, home
  routes.tsx       toàn bộ route (lazy) + redirect URL cũ (/en/…, /note, /mindmap, /practice-writing…)
content-pipeline/  build dữ liệu (dùng chung cho Vite dev, build và server production)
server/            API: routes/analyze.ts, routes/admin.ts, admin/*, gemini.ts
```

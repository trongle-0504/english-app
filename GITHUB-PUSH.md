# Đưa code lên GitHub

Code được chuẩn bị sẵn trong `../english-app-commit/code/` bằng `node scripts/sync-commit.ts` (xem README, mục
*Code và data tách riêng*). Thư mục đó **đã là một repo git** (nhánh `main`), nên không cần clone repo GitHub về rồi
copy đè: chỉ cần gắn repo GitHub vào làm remote và push. Data (file `.tar.gz` trong `data-minimal/` hoặc `data/`)
không bao giờ lên GitHub; tải lên Drive riêng.

Mọi lệnh chạy trong terminal **WSL**.

## Lần đầu

1. **Tạo repo trên GitHub:** chọn **Private**, và **không** tick *Add a README*, *.gitignore* hay *license* (repo phải
   trống hoàn toàn).
2. **Chuẩn bị code mới nhất** (trong thư mục làm việc):
   ```bash
   cd ~/English-App/english-app-v2 && node scripts/sync-commit.ts
   ```
3. **Kiểm tra tên và email sẽ ghi vào commit** (chúng hiện công khai trong lịch sử trên GitHub):
   ```bash
   cd ~/English-App/english-app-commit/code && git config user.name && git config user.email
   ```
   Muốn dùng tên / email khác cho riêng repo này (không đổi cấu hình chung của máy):
   ```bash
   git config user.name "Tên hiển thị"
   ```
   ```bash
   git config user.email "email-cua-ban@example.com"
   ```
   GitHub còn cho dùng email ẩn dạng `<số>+<tên>@users.noreply.github.com` (Settings → Emails → *Keep my email
   addresses private*) để không lộ email thật.
4. **Gắn repo GitHub, commit và push:**
   ```bash
   git remote add origin https://github.com/<tai-khoan>/<ten-repo>.git
   ```
   ```bash
   git add -A && git commit -m "Initial commit"
   ```
   ```bash
   git push -u origin main
   ```

## Đăng nhập khi push

Máy chưa có SSH key và chưa cài GitHub CLI (`gh`), nên push qua HTTPS. Khi được hỏi *Password*, GitHub **không nhận
mật khẩu tài khoản**: dán một **Personal Access Token**.

- Tạo token: GitHub → Settings → Developer settings → Personal access tokens → *Fine-grained tokens* → chỉ chọn repo
  này, quyền *Contents: Read and write*.
- Token chỉ hiện một lần: lưu ở trình quản lý mật khẩu, không ghi vào file trong dự án.
- Không muốn nhập lại mỗi lần push:
  ```bash
  git config --global credential.helper store
  ```
  (lưu token dạng chữ thường trong `~/.git-credentials`; chỉ dùng trên máy cá nhân).

## Các lần sau

```bash
cd ~/English-App/english-app-v2 && node scripts/sync-commit.ts
```
```bash
cd ~/English-App/english-app-commit/code && git status
```
```bash
git add -A && git commit -m "Mô tả thay đổi" && git push
```

`sync-commit` cũng tạo file data tối thiểu mới trong `../english-app-commit/data-minimal/`; tải file mới nhất lên Drive
khi data có thay đổi. File cũ không tự xoá.

## Khi gặp lỗi

| Lỗi | Nguyên nhân / cách xử lý |
|---|---|
| `! [rejected] main -> main (fetch first)` | Repo GitHub không trống (đã tick README / license khi tạo). Chạy `git pull --rebase origin main --allow-unrelated-histories` rồi push lại. |
| `remote origin already exists` | Đã gắn remote. Xem bằng `git remote -v`; đổi địa chỉ bằng `git remote set-url origin <url>`. |
| `Authentication failed` / `Support for password authentication was removed` | Dùng Personal Access Token thay cho mật khẩu (mục *Đăng nhập khi push*). |
| `sync-commit` báo *Stopped, nothing copied* | Code có file `.env`, chuỗi giống khoá API hoặc file > 5 MB. Sửa theo danh sách in ra, rồi chạy lại. |

## Trước mỗi lần push, kiểm tra nhanh

- `git status` chỉ có code: không có `.env`, `data/`, `progress/`, `content/vocabulary`… (đã được `.gitignore` chặn, và
  `sync-commit` không copy chúng).
- Repo trên GitHub vẫn là **Private**.

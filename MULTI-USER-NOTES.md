# Multi-user: những gì đã làm, cần bạn xác nhận, và còn thiếu

Ngày 2026-11-13. Code ở nhánh `multi` (thư mục `/home/trongle/english-multi`), triển khai tại `/srv/english-multi`, chạy service `english-multi` (cổng 5180) trên **https://study.ailab.com.vn**. App cá nhân `/home/trongle/english-app` (https://ailab.com.vn) không bị sửa code.

## Việc bạn làm khi vào xem

1. Mở `ADMIN-FIRST-LOGIN.txt` trong thư mục này. File chứa mật khẩu tạm của tài khoản admin `rvc.bv2024@gmail.com`, chỉ bạn đọc được.
2. Đăng nhập https://study.ailab.com.vn bằng mật khẩu tạm đó.
3. App sẽ bắt đổi mật khẩu, rồi bắt bật **Xác thực hai lớp** (bắt buộc với admin). Làm xong thì xóa `ADMIN-FIRST-LOGIN.txt`.
4. Vào **⚙ → Users**: thêm người học, hoặc duyệt người tự đăng ký tại https://study.ailab.com.vn/register.
5. Muốn nhận thông báo khi có người đăng ký: mở **Planner** trên điện thoại (bản study.) và bật thông báo.

## Đã làm (đã chạy thử)

- **Mỗi người một thư mục riêng.** Đường dẫn là `/srv/english-multi/data/users/<id>/`. Mọi request, job nền, lượt AI và Nova chỉ thấy thư mục của chính người đó.
  - Nội dung dùng chung (blog, collocation, ngữ pháp, essay mẫu, đề thi) được link vào ở chế độ **chỉ đọc**: tài khoản `englishmulti` không có quyền ghi.
- **Phân quyền cho mọi route.** Có 4 nhóm: công khai / tài khoản / học viên / admin. Có test báo lỗi nếu thêm route mà quên phân nhóm.
- **Đăng ký:**
  - Người dùng tự đăng ký, ở trạng thái chờ duyệt, và admin được báo qua Web Push.
  - Admin cũng có thể thêm người thủ công; người đó phải đổi mật khẩu ở lần đăng nhập đầu.
  - Có trần số học viên, mặc định 4.
- **Quên mật khẩu:** yêu cầu vào hàng chờ của admin. Admin bấm **Mật khẩu tạm** rồi gửi qua Zalo.
- **2FA:** bắt buộc với admin, tùy chọn với học viên.
- **Tối đa 2 thiết bị mỗi học viên.** Thiết bị thứ 3 bị từ chối. Học viên tự gỡ thiết bị được 1 lần mỗi tuần; admin gỡ được bất cứ lúc nào.
- **Admin "Xem như học viên":** chỉ đọc, có ghi nhật ký `audit.jsonl`.
- **Hạn mức mỗi ngày:**
  - 5 bài Writing, 30 lượt Speaking (tính theo câu), 50 lượt AI khác, 50 câu hỏi Nova.
  - Trần ẩn 200 lượt `agy` mỗi người mỗi ngày.
  - Lượt được hoàn lại khi lỗi do máy chủ.
- **AI:**
  - **Cả WSL tối đa 4 tiến trình `agy`**, dùng chung cho 2 app. Bên nào đủ 4 thì bên kia chờ (cổng `/usr/local/lib/agy-gate/bwrap`).
  - Trong app multi, các lượt chờ được chia lần lượt theo từng người.
  - Mỗi lượt `agy -p` dùng một hồ sơ tạm, xóa ngay sau khi xong.
  - Nova: mỗi người một tiến trình và một hồ sơ riêng, tự tắt sau 3 phút rảnh.
  - Warm agent đã tắt ở bản multi. Warm của app cá nhân tắt sau 10 phút rảnh.
- **Kho từ chung:** 617 từ lấy từ thư viện của bạn (không thấy mục nào có email hay số điện thoại). Học viên bấm **Thêm** để chép từ vào thư viện riêng, không tốn lượt AI. Nút "Thêm vào từ vựng" cũng lấy từ kho chung trước.
- **Hướng dẫn:**
  - 18 trang `content/docs/*.md`, xem tại trang `/help`.
  - Nova có công cụ `search_help` / `read_help` và được dặn trả lời "làm sao để…" chỉ dựa trên các trang này.
  - Có lời chào cho người mới.
- **Dung lượng:**
  - 300 MB mỗi người; ghi âm tự xóa sau 15 ngày.
  - Khi ổ C: còn dưới 5 GB thì app tạm ngừng nhận ghi âm/ảnh. Admin nhận Web Push khi C: còn dưới 10 GB hoặc RAM khả dụng dưới 400 MB.
- **Giới hạn RAM** (systemd): mỗi app tối đa 2000 MB.
  - Đo ngay sau khi deploy: app cá nhân 230 MB, app multi 150 MB, RAM khả dụng 1,9 GB.
- **Test:** `npm test` qua 173/173, trong đó có:
  - bộ chống lộ dữ liệu: dữ liệu của A có chuỗi đánh dấu, B gọi mọi route GET, `/data`, ảnh và job của A;
  - đăng ký và chờ duyệt, 2 thiết bị, xem như học viên, hạn mức;
  - hồ sơ `agy` riêng, hàng đợi chia lượt, tài liệu hướng dẫn.
  - Sau khi deploy đã chạy thử trên bản thật bằng một học viên tạm (đã xóa), kể cả 1 lượt AI thật qua cổng và sandbox: mất 78 giây, hạn mức trừ đúng.

## Cần bạn xác nhận

1. **Cổng `study.ailab.com.vn` đã chuyển sang app multi.** Nếu điện thoại của bạn từng cài PWA hoặc bật thông báo Planner từ `study.`, hãy cài lại từ `ailab.com.vn`. Bản sao cấu hình cũ: `~/.cloudflared/config.yml.bak-*`.
2. **Trang hướng dẫn** (`content/docs/*.md`): tôi viết tên nút theo menu và code, chưa bấm thử từng màn hình. Bạn đọc lướt và sửa chỗ nào sai tên nút.
3. **Kho từ chung lấy cả 617 từ** của bạn. Nếu có từ nào bạn không muốn chia sẻ: ghi từ đó vào `/srv/english-multi/reference-review.md`, hoặc nói tôi thêm danh sách loại trừ.
4. **Quên mật khẩu dùng mật khẩu tạm** (hiện một lần cho admin) thay cho link đặt lại như trong plan. Kết quả giống nhau, nhưng đơn giản hơn. Đổi sang link nếu bạn muốn.
5. **Cách tính hạn mức Writing Task 1:** bước "chuẩn bị đề" (`/writing-task1/prepare`) và bước chấm đều trừ 1 bài. Một bài Task 1 có thể trừ 2. Có giữ không?
6. **Speaking Mock Test:** đã kiểm tra, mock gửi từng câu trả lời tới `/api/speaking-review`, nên mỗi câu trừ 1 lượt Speaking. Một bài mock khoảng 10–12 câu sẽ dùng khoảng một phần ba hạn mức Speaking trong ngày. Có cần hạn mức riêng cho mock không?
7. **Turnstile** (ô "không phải robot" ở trang đăng ký): chưa bật vì cần khóa. Muốn bật thì tạo site key + secret trong Cloudflare Dashboard → Turnstile, điền `TURNSTILE_SITE_KEY` và `TURNSTILE_SECRET` vào `/srv/english-multi/app/.env`, rồi chạy `sudo systemctl restart english-multi`. Hiện đã có giới hạn 3 lần đăng ký/IP/ngày và bước duyệt.
8. **App cá nhân:** để Nova cá nhân nhả slot `agy` sau 3 phút thay vì 15 phút, cần sửa 1 dòng trong `english-app` (`server/coach/acp.ts:252`). Tôi chưa sửa, vì bạn muốn code multi tách khỏi `english-app`.

## Chưa làm / rủi ro còn lại

- **Lỗi 524 của Cloudflare (giới hạn 100 giây)** với các route AI trả kết quả ngay trong request:
  - Các route: `/analyze`, `/listening/simplify`, `/notepad/format`, `/translate`, AI của planner, `/review/produce`…
  - Lượt thử hôm nay mất 78 giây, sát mức 100 giây. Ngày bận, hoặc khi phải chờ slot, người dùng có thể gặp lỗi 524 dù server vẫn chạy xong.
  - Writing Review, Speaking Review và Speaking Ideas đã chạy dạng job nên không bị.
  - Việc tiếp theo nên làm: chuyển các route kể trên sang job + hỏi lại kết quả (plan mục 6.4).
- **STT chưa dùng chung giữa 2 app.**
  - Mỗi app tự nạp model (~1,1 GB) khi có người dùng Speaking Review. Nếu cả hai cùng nạp thì tốn ~2,3 GB.
  - Giới hạn 2000 MB mỗi service ngăn một app làm sập cả máy; trường hợp xấu nhất là app đó bị khởi động lại.
  - Nên làm sau: một tiến trình STT chung, tự nhả model khi rảnh.
- **Chưa có ví dụ kết quả mẫu cho từng tính năng.** Hiện chỉ có trang hướng dẫn bằng chữ. Làm sau, khi bạn chọn và duyệt một số bài đã ẩn danh.
- **Backup chưa đặt lịch.** Bạn nói chưa cần backup ra ngoài máy, nhưng backup tại chỗ hằng đêm cũng chưa có. Tải tay được ở Admin → Users → Tải dữ liệu, hoặc chạy `sudo -u englishmulti tar czf … /srv/english-multi/data`.
- **Tin tức (Daily Paper):** app multi không tự thu thập (để khỏi tốn AI hai lần), chỉ chép `news.json` lúc deploy. Muốn cập nhật: chạy lại `deploy/multi/deploy.sh`, hoặc admin bấm thu thập trong app multi (tốn lượt AI của gói chung).
- **Sửa nội dung chung trong app multi** (blog, ngữ pháp, essay mẫu, collocation): thư mục này chỉ đọc, nên các nút sửa của admin ở bản multi sẽ báo lỗi. Sửa trong app cá nhân rồi chạy lại `deploy/multi/deploy.sh`.
- **"Xem như học viên":** ảnh Notepad của học viên không hiện, vì thẻ `<img>` không gửi header xem. Các trang dữ liệu khác hiện bình thường.
- **Thiết bị:** nếu học viên xóa cookie trình duyệt, máy đó bị tính là thiết bị mới. Khi bị chặn, admin gỡ thiết bị cũ giúp.
- **Lệnh `agy` tự gõ trong terminal** (hoặc do Claude Code chạy) không đi qua cổng, nên không bị tính vào trần 4.
- **Chuyển WSL sang ổ E:** để cuối như bạn muốn (plan Phase 10).

## Lệnh hay dùng

```bash
bash /home/trongle/english-multi/deploy/multi/deploy.sh      # cập nhật code + nội dung chung, khởi động lại app multi
sudo systemctl restart english-multi                           # chỉ khởi động lại
journalctl -u english-multi -f                                 # xem log
cd /home/trongle/english-multi && npm test                     # chạy toàn bộ test
```

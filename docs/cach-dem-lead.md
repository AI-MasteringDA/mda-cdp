# Cách MDA đếm lead — bản dán cho AI khác

Bản này viết để **copy nguyên file** đưa cho một AI/agent khác chưa biết gì về hệ
thống. Mọi quy tắc dưới đây là do người dùng chốt, có ghi ngày.

> ⚠️ **File này nằm trong git repo — KHÔNG điền token thật vào đây.**
> Chỗ nào ghi `<<DÁN ...>>` thì lúc dán sang chat của AI khác mới thay bằng giá
> trị thật (xem mục 0 để lấy).

---

## 0. Thông tin kết nối

### SMAX

| | |
|---|---|
| Base URL | `https://api.smax.ai` |
| Biz slug | `mastering-data-analytics` |
| Xác thực | Header `Authorization: Bearer <<DÁN SMAX_USER_TOKEN>>` |

`SMAX_USER_TOKEN` là **JWT phiên web, sống đúng 30 ngày** (không phải API key).
Hết hạn thì MỌI endpoint trả `401` và job vẫn báo xanh trong khi nhận 0 khách —
đã xảy ra 03/09/2026, mất 4 ngày dữ liệu mới phát hiện. Cách xoay token: xem
`docs/smax-api.md`.

Có sẵn `SMAX_API_KEY` (key cấp business, payload `object: "biz"`, **không hết
hạn**) nhưng SMAX chưa cấp quyền đọc — trả `403`. Xin SMAX mở quyền cho key này
là hết phải xoay token định kỳ.

### Salesforce

Salesforce **không có token tĩnh** — phải tự lấy access token bằng OAuth
client-credentials, token sống ngắn, mỗi lượt chạy xin lại:

```http
POST {SALESFORCE_INSTANCE_URL}/services/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<<DÁN SALESFORCE_CLIENT_ID>>
&client_secret=<<DÁN SALESFORCE_CLIENT_SECRET>>
```

Trả về `access_token`, dùng làm `Authorization: Bearer <access_token>` cho SOQL.
API version đang dùng: `v59.0` (biến `SALESFORCE_API_VERSION`).

### Lấy giá trị thật ở đâu

Tất cả nằm trong `D:\AppCDP\mda-cdp\.env.local` — **không commit, không dán vào
file này**:

```powershell
Select-String -Path .env.local -Pattern '^(SMAX_USER_TOKEN|SMAX_API_KEY|SALESFORCE_INSTANCE_URL|SALESFORCE_CLIENT_ID|SALESFORCE_CLIENT_SECRET|SALESFORCE_API_VERSION)='
```

Dán token ra công cụ ngoài = coi như đã lộ → nên xoay lại sau khi dùng xong.

---

## 1. Ba hệ thống và luồng dữ liệu

- **SMAX** — chat đa nền tảng (Facebook, Zalo, Instagram, Website). Nguồn của
  "khách đã chat".
- **Salesforce** — nguồn của "Lead". SF là chuẩn 100%: sai thì sửa bên SF, không
  sửa ở dưới (người dùng chốt 11/09/2026).
- **Lark Base `SMAX_Database`** — bản mirror của SMAX do job ETL đẩy lên.

Luồng: SMAX + Salesforce → job bridge → Lark Base → `/api/radar` → dashboard
`/radar.html`. **Không đi qua Supabase** (đã khoá từ 01/09/2026).

Riêng Hot thì `/api/radar` **gọi SOQL thẳng sang Salesforce**, không đọc bản sao
trên Lark: bản sao từng có 110 dòng cho khoá mà SF chỉ có 72 lead (hai job ghi
bằng hai khoá chống trùng khác nhau) — khử kiểu gì cũng không về đúng.

---

## 2. CÓ HAI ĐỊNH NGHĨA LEAD — lệch nhau là ĐÚNG

- **MKT đếm**: người mới chat trên SMAX ("Lead mới") + người lên tag Hot.
- **Sales đếm**: mọi Lead tồn tại trên Salesforce, bất kể Rating — khách để lại
  contact là đã ghi nhận, Cold hay Hot đếm như nhau (chốt với đội sales
  10/09/2026).

Đừng "sửa" cho hai con số bằng nhau. Hỏi rõ đang cần góc nhìn nào.

---

## 3. "LEAD MỚI" (góc MKT)

- Mốc quy ngày = **NGÀY CHAT ĐẦU TIÊN trên SMAX** (`interaction.first`). KHÔNG
  phải ngày gắn tag, KHÔNG phải ngày lên Salesforce. (Luật "lần chạm đầu" từng
  thử ngày 22/09/2026 và đã bỏ.)
- Người **chỉ có trên Salesforce** (form web, sales tự nhập, chưa từng chat) →
  KHÔNG vào "Lead mới", chỉ vào tổng Hot.
- **Trừ khách quay lại (reMKT)** — xem mục 6.
- Mỗi lead rơi vào **đúng 1 nhóm**, ưu tiên: `Prospect > Warm > Cold > Hot >
  Chưa phân loại`. Tổng các nhóm = "Lead mới".

### Cái gì KHÔNG phải lead (lọc ngay từ nguồn)

- Tag `Spam` hoặc `Đã Block` → là rác, loại.
- Khách **mới chỉ comment dưới bài, chưa inbox** VÀ **chưa gắn tag nào** → không
  tính. Nhận biết: customer không có `facebook.conversation_id`. (Đã đo:
  979/4.896 khách Facebook rơi vào nhóm này, tất cả đều chưa gắn tag.)
  Comment mà **đã gắn tag** thì vẫn tính là lead.

---

## 4. "HOT" = MIRROR 1:1 LEAD SALESFORCE

SOQL đang dùng:

```sql
SELECT Id, Name, Phone, MobilePhone, Email, Rating, IsConverted,
       RelevantLeads__c, CreatedDate, Product__r.Name
FROM Lead
WHERE CreatedDate >= {từ_ngày}
ORDER BY CreatedDate DESC
```

`ORDER BY ... DESC` là bắt buộc: nếu chạm trần phân trang thì phần bị cắt là lead
CŨ NHẤT. Viết ASC thì trần 20.000 cắt mất toàn bộ lead gần đây — dashboard ra
Hot = 0 (bắt được 11/09/2026). SOQL trả tối đa 2.000 bản ghi/lượt, đi tiếp bằng
`nextRecordsUrl`.

Khối đếm Hot **cố ý KHÔNG lọc và KHÔNG gộp gì**:

- không lọc theo `Rating` — Cold cũng đếm;
- không bỏ lead đã convert — dashboard SF đếm cả lead đã chốt (ô "No. of Leads"
  72 vs "Not yet Convert" 57);
- không gộp lead trùng người — **SF đếm theo BẢN GHI**; trùng thì sửa bên SF;
- không loại reMKT — vẫn dán nhãn cho sales thấy, nhưng vẫn cộng.

→ Mỗi Lead bên SF = 1 dòng ⇒ ra đúng con số trên dashboard Salesforce.

**Múi giờ**: org Salesforce là `Asia/Ho_Chi_Minh` (UTC+7). Cộng 7h vào
`CreatedDate` rồi mới cắt ngày, nếu không sẽ lệch cột ngày so với report bên SF.

**Ô KPI "Hot" chỉ đếm KHOÁ ĐANG TUYỂN SINH** (khoá số lớn nhất của mỗi mảng, ví
dụ K62 và F4 — chốt 21/09/2026). Không lọc thì gộp luôn khoá cũ: ngày 18/09 ra
11 trong khi K62 chỉ có 5.

---

## 5. MÃ KHOÁ — HAI QUY TẮC NGƯỢC NHAU, ĐỪNG TRỘN

- **Tag bên SMAX**: `KH62` và `K62` là CÙNG một khoá → chuẩn hoá `KH## → K##`
  (chốt 03/09/2026: "KH và K như nhau, K62 và KH62 là 1").
- **Product bên Salesforce**: `KH62` **KHÁC** `K62`, đứng riêng, không cộng vào
  nhau. Vì bộ lọc trên dashboard SF là `contains K62`, không bắt `KH62 - 2026`;
  con số sales đọc hằng ngày là 72 (chốt 11/09/2026). Chênh không nhỏ trên khoá
  cũ: KH58 có 107 lead trong khi K58 có 98.

---

## 6. reMKT (khách quay lại) — đọc `RelevantLeads__c`

Trường này liệt kê lead/khoá trước của chính người đó (ví dụ `"K45 - 2024"`).
Luật chốt 22/09/2026:

| Tình huống | Xử lý |
|---|---|
| Mục thuộc **khoá CŨ HƠN** | Khách cũ → **không vào "Lead mới"**, **vẫn vào Hot** |
| Mục thuộc **khoá KHÁC đang chạy** (lead F4 kèm K62 vì khách quan tâm cả hai) | KHÔNG phải khách cũ → **đếm cả 2 lead** |
| Mục **TRÙNG đúng khoá của chính lead đó** | Lead sau là bản đăng ký lại → chỉ dòng đó mang nhãn reMKT, lead đầu vẫn tính bình thường |

So sánh: cùng mảng thì so với khoá **của chính lead đó**; khác mảng thì so với
**khoá đang chạy** của mảng kia. `KH62` và `K62` coi là cùng khoá ở bước này.

Vì sao phải tinh thế: ca chị Ai Lam Tran — chat 17/09, sáng 18/09 sales tạo lead
K62 lúc 10:04 rồi lead F4 lúc 10:11; Salesforce tự nối hai lead nên lead F4 mang
"K62 - 2026". Luật cũ ("có Relevant Leads là khách cũ") làm chị biến mất khỏi cả
"Lead mới" lẫn "Hot mới". Đo cùng ngày: 10/19 người mang nhãn reMKT từ 15/08 bị
nhầm đúng kiểu này.

---

## 7. "HOT MỚI" ≠ "NÂNG HẠNG"

Đã mang tag Cold/Warm/Prospect từ ngày TRƯỚC, hôm nay mới lên Hot ⇒ là **nâng
hạng**, KHÔNG tính vào KPI "Hot mới" (vẫn hiện trong bảng chi tiết kèm nhãn ↑).
Chốt 11/08/2026, ca "Sơn Huyền".

Quy ngày:

- Prospect / Warm / Cold / chưa gắn tag → theo **ngày chat đầu**.
- Hot → theo **ngày gắn tag / ngày tạo lead SF**, vì lên Hot là một sự kiện có
  thời điểm rõ ràng.

Tag SMAX mirror **trạng thái hiện tại**, nhưng các cột `"<class> lúc"`
(`Hot Lead lúc`, `Cold Lead lúc`, …) là **lịch sử** — không được xoá, đó là căn
cứ phân biệt nâng hạng với Hot mới.

---

## 8. GỘP NGƯỜI TRÙNG — CHỈ KHI ĐẾM, KHÔNG SỬA DỮ LIỆU

SMAX **tách bản ghi theo NỀN TẢNG**: một người chat cả Messenger lẫn Zalo sẽ có
2–3 customer riêng, không có trường nào nối chúng.

- **Trong dữ liệu (Lark / ETL): mirror SMAX 1:1 — TUYỆT ĐỐI không tự gộp, không
  tự xoá dòng.**
- **Trên dashboard: GỘP KHI ĐẾM** (chốt 22/09/2026) — một người chat từ nhiều
  tài khoản chỉ là MỘT lead mới, tính ở tài khoản **chat sớm nhất**. Đo 22/09:
  29/427 lead mới của K62 từ 15/08 là tài khoản trùng.
- Khoá nhận diện người: **9 số cuối của số điện thoại**, hoặc **email viết
  thường**. KHÔNG khớp bằng tên — SMAX ghi "K40-Bảo Lee", SF ghi "Lý Hồng Bảo".
- **Loại liên hệ của công ty khỏi khoá gộp**: hotline `...961486648`, mọi email
  `@mastering-da.com` và các hộp chung (`sales@`, `info@`, `ketoan@`, `admin@`,
  `contact@`, `hotro@`, `support@`). Sales hay gõ hotline ngay trong đoạn chat
  rồi bị gán nhầm vào hồ sơ khách: đo 18/08/2026, số 0961486648 đang nằm trên 2
  lead của HAI người khác nhau.

Nối lead Salesforce về người đã chat trên SMAX cũng dùng khoá này, nhưng **chỉ
gắn thêm thông tin, không gộp/xoá dòng nào**. Đo 22/09: 75/102 lead K62 nối
được, trong đó 25 người lên Salesforce SAU ngày chat đầu.

---

## 9. GIỚI HẠN API SMAX (đo thật, không theo tài liệu)

**`POST /bizs/{biz}/customers`** — endpoint chính.

- `size` tối đa **10.000**; lớn hơn thì `data` trả `undefined`.
- Biz có 22.278 khách ⇒ phải kéo **lần lượt theo từng `page_pids`** mới phủ
  100%. Cách cũ (kéo 10k mới nhất) làm mất 852 Hot Lead cũ.
- **Không lọc được theo tag hay theo thời gian ở phía server** — `tags`,
  `from/to`, `since`, `created_from` đều bị bỏ qua. Phải kéo về rồi tự lọc.
- `page` / `offset` / `skip` **không phân trang được**.
- `q` tìm theo **số điện thoại hoặc tên**; tìm bằng **email trả 0 kết quả**.
- `sort: "asc"` đảo thứ tự để chạm nhóm khách cũ nhất.

**`POST /bizs/{biz}/threads`** — chỉ trả **100 thread mới nhất** mỗi `page_pid`
(`skip`/`page`/`offset` bị bỏ qua); `sort: "asc"` cho 100 thread **cũ nhất**.
Không có khúc giữa. Đo 25/09/2026: 100 thread mới nhất của Facebook MDA phủ ~5
ngày, của Zalo Web ~1,5 ngày.

**`GET /bizs/{biz}/pages/{page_pid}/threads/{tid}/messages`** — **chốt cứng 20
tin mới nhất**. `limit`, `skip`, `offset`, `page`, `size`, `per_page`, `take`
đều bị bỏ qua (đo 25/09/2026). Đây là giới hạn theo **SỐ TIN, không theo thời
gian**: cuộc chat thưa thì 20 tin lùi về được 2 năm, cuộc chat dày thì chỉ vài
giờ. Đo trên 75 cuộc chat có hoạt động trong 90 ngày: 49% lấy được trọn cuộc,
51% bị cắt mất đoạn đầu; trung vị lùi về 55 ngày; chỉ 19% phủ đủ 90 ngày.
→ Muốn có lịch sử dài phải **cộng dồn qua nhiều lần chạy**; ghi đè là mất vĩnh
viễn (hiện KHÔNG có bản lưu nào: Supabase 0 dòng, cột Chat History trên Lark đã
xoá 17/08/2026).

**Cấu trúc customer** — điểm cần nhớ:

- `phone` / `email` **số ít** mới là nơi có dữ liệu; mảng `emails` gần như luôn
  rỗng.
- `tags[].time` = thời điểm gắn tag.
- `interaction.first` / `interaction.last` = lần chat đầu / cuối.
- Không có `facebook.conversation_id` ⇒ mới comment, chưa inbox.

**7 page hiện có**: Facebook MDA (8.572 khách), Facebook PTA (6.960), Zalo Web
MDA (6.356), Website (161), Zalo OA (154), Instagram MDA (62), Instagram PTA (18).

---

## 10. BẪY HAY GẶP

1. So tổng SMAX với tổng Salesforce rồi kết luận "mất data" — thường là do GỘP,
   hoặc do hai định nghĩa lead khác nhau (mục 2).
2. Quy lead về **ngày gắn tag** thay vì **ngày chat đầu** → lệch hẳn so với số
   Ads theo ngày.
3. Cộng `KH62` vào `K62` ở phía Salesforce → số vống hơn dashboard SF.
4. Đếm Hot trên mọi khoá thay vì chỉ khoá đang tuyển sinh → số vống gấp đôi.
5. Tự merge / xoá dòng trùng trong Lark cho "sạch" → phá mirror, hết đối chiếu
   được với SMAX.
6. Dùng `/threads` để lấy đủ khách → chỉ được 100 thread mới nhất. Muốn đủ khách
   phải đi đường `/customers`.
7. Ghi đè transcript chat thay vì cộng dồn → mất vĩnh viễn phần quá 20 tin.

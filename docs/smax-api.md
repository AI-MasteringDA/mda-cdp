# SMAX API — những gì đã dò và đang dùng

Tổng hợp từ thực nghiệm ngày 2026-08-10/11. Mọi giới hạn dưới đây là **đo thật**,
không phải theo tài liệu.

## Kết nối

| | |
|---|---|
| Base URL | `https://api.smax.ai` (env `SMAX_BASE_URL`) |
| Xác thực | Header `Authorization: Bearer <token>` |
| Token | env `SMAX_USER_TOKEN` trong `.env.local` — **hết hạn khoảng 03/09/2026** |
| Biz slug | `mastering-data-analytics` |

> Token là bí mật. Không dán vào chat/công cụ ngoài, không commit lên git.

## Các endpoint đang dùng

### 1. Danh sách khách — `POST /bizs/{biz}/customers`

Endpoint chính, dùng ở `smax-real.ts` và `lead-first-chat.ts`.

```jsonc
// body
{ "size": 10000, "page_pids": ["fb1234..."], "sort": "asc", "q": "0938360681" }
```

Response: `{ data: [...], total: 22278, status, message }`

**Tham số CÓ tác dụng:**

| Tham số | Ghi chú |
|---|---|
| `size` | Tối đa **10000**. Lớn hơn → `data` trả về `undefined` |
| `q` | Tìm theo **số điện thoại hoặc tên**. `total` cũng theo bộ lọc |
| `page_pids` | Mảng pid của page. **Đây là cách phá trần 10k** |
| `sort: "asc"` | Đảo thứ tự → chạm được nhóm khách cũ nhất |

**Tham số BỊ BỎ QUA** (thử rồi, trả nguyên tổng):

- `page`, `offset`, `skip` — không phân trang được
- `tags`, `tag`, `tag_ids`, `tagIds` — **không lọc được theo tag**, phải kéo về tự đếm
- `from/to`, `since`, `created_from`, `last_message_at` — không lọc theo thời gian
- `page_pid` (số ít), `platform` — chỉ `page_pids` (số nhiều) mới ăn
- Tìm bằng **email** qua `q` → trả 0 kết quả. Chỉ dùng SĐT hoặc tên.

**Phá trần 10.000:** biz có 22.278 khách nhưng mỗi lần gọi tối đa 10k. Đếm theo
từng page rồi cộng lại đúng bằng tổng biz (lệch 0), page lớn nhất 8.572 < 10k ⇒
**kéo lần lượt theo `page_pids` là phủ 100%**. Cách cũ (kéo 10k mới nhất) làm
mất 852 Hot Lead cũ.

```ts
const pages = (await GET(`/bizs/${BIZ}/pages`)).data;
const all = new Map();
for (const p of pages) {
  const r = await POST(`/bizs/${BIZ}/customers`, { size: 10000, page_pids: [p.pid] });
  for (const c of r.data) all.set(c.id, c);
}
```

### 2. Danh sách page — `GET /bizs/{biz}/pages`

7 page: Facebook MDA (8.572 khách), Facebook PTA (6.960), Zalo Web MDA (6.356),
Website (161), Zalo OA (154), Instagram MDA (62), Instagram PTA (18).

### 3. Danh sách tag — `GET /bizs/{biz}/tags`

188 tag. Tag phân loại: `Hot Lead`, `Warm Lead`, `Cold Lead`, `Prospect`.

### 4. Hội thoại — `POST /bizs/{biz}/threads`

Chặn ở khoảng **700 thread** dù phân trang thế nào → không dùng để lấy lịch sử,
chỉ lấy hoạt động gần đây. Muốn đủ khách phải đi đường `/customers`.

### 5. Tin nhắn — `GET /bizs/{biz}/pages/{page_pid}/threads/{tid}/messages`

Query: `?sort=-created_at&limit=20&skip=0`. Chỉ phục vụ **cửa sổ gần đây** nên
transcript phải tích luỹ dần, ghi đè sẽ mất tin cũ.

## Cấu trúc một customer

```jsonc
{
  "id": "6a766ad4bd4fac11ebc63a20",     // mongo id → smax_customer_id
  "pid": "fb28534093956176196",          // id theo nền tảng → external_profile_id
  "name": "Quang Thảo",
  "profile_name": "...",
  "phone": "0962995104",                 // ĐƠN — nơi SĐT thật sự nằm
  "phones": [{ "time": "...", "value": "0962995104" }],
  "email": "...",                        // thường undefined
  "emails": [],                          // gần như luôn rỗng
  "platform": "facebook",                // facebook | zaloweb | zalo | instagram | custom
  "page_pid": "...",
  "thread_tid": "...",
  "tags": [{ "id": "...", "name": "Hot Lead", "alias": "...", "time": "2026-08-10T04:37Z" }],
  "interaction": { "first": "...", "last": "..." },
  "last_message_at": "...", "created_at": "...", "updated_at": "...",
  "last_content_by_user": "0962995104 zalo a",
  "facebook": { "conversation_id": "..." },  // KHÔNG có ⇒ mới chỉ comment, chưa inbox
  "scores": {}, "notes": [], "follow_ups": [], "users": [],
  "in_sequences": [], "out_sequences": [], "source": "...", "subscribed": true
}
```

Ghi chú quan trọng:

- `phone`/`email` **số ít** mới là nơi có dữ liệu; mảng `emails` gần như luôn rỗng.
- `tags[].time` = **thời điểm gắn tag** — dùng để quy lead về đúng ngày.
- Không có `facebook.conversation_id` ⇒ khách mới chỉ comment dưới bài, chưa
  inbox. Đã kiểm: 979/4.896 khách FB rơi vào nhóm này, tất cả đều chưa gắn tag.
- **SMAX tách bản ghi theo NỀN TẢNG.** Một người chat cả Messenger lẫn Zalo sẽ
  có 2-3 customer riêng, không có trường nào liên kết chúng. Phải tự khớp bằng
  SĐT/email.

## Dùng để audit

Cách đối chiếu đúng (đừng so tổng, sẽ nhầm "thiếu" với "gộp"):

| Lệnh | Trả lời |
|---|---|
| `npm run etl:smax:audit` | Kéo về đã đủ chưa — so với `total` từng page, lệch phải = 0 |
| `npm run etl:smax:audit:id` | Chênh do MẤT hay do GỘP — đối chiếu từng `smax_customer_id` |
| `npm run etl:smax:audit:miss` | Mất thật hay chỉ hụt liên kết — tra lại bằng SĐT/email/tên |
| `npm run etl:smax:audit:win` | Dashboard có sai không — chỉ soi cửa sổ 40 ngày |

## Giới hạn cần biết

1. Không lọc được theo tag hay theo thời gian ở phía server → phải kéo về rồi lọc.
2. Trần 10.000/lần, chỉ vượt được bằng cách chia theo page.
3. `/threads` chặn ~700, không phản ánh toàn bộ khách.
4. `/messages` chỉ trả cửa sổ gần đây.
5. Tìm bằng email không hoạt động.

/**
 * SĐT / EMAIL CỦA CHÍNH CÔNG TY — không được coi là thông tin khách hàng.
 *
 * Vì sao cần: nhân viên gõ số hotline hoặc mail sales ngay trong đoạn chat
 * ("gọi em qua 0961486648 nhé"), AI của SMAX quét nội dung rồi tưởng đó là
 * thông tin liên hệ CỦA KHÁCH và gán vào hồ sơ. Hậu quả (đo 2026-08-11):
 *   - 22 khách SMAX bị gán nhầm SĐT 0961486648, 9 khách bị gán nhầm mail sales
 *   - Toàn người khác nhau: "Marie Go Cullen", "Susan Susan", "Lắp Đặt F P T",
 *     "Lắp Mạng Cáp Quang", "Tưng Lan"…
 *   - Bước gộp-theo-SĐT gom hết thành một, đẻ ra dòng "Sơn Huyền" mang mốc tag
 *     của 3 người khác nhau → dashboard hiện sai "nâng hạng từ 05/08".
 *
 * Quy tắc user chốt 2026-08-11:
 *   1. Lead mang các giá trị này thì **không lấy thông tin liên hệ**, chỉ giữ TÊN.
 *   2. Không dùng chúng làm khoá gộp — TRỪ KHI tên trùng **100%** (VD "Tưng Lan"
 *      là tài khoản test, dùng số này nhiều lần → cùng tên thì đúng là một).
 *
 * Thêm giá trị mới vào 2 mảng dưới là mọi job tự áp dụng.
 */

/** SĐT nội bộ — so bằng 9 số cuối để khớp mọi định dạng (+84, 0…, khoảng trắng) */
const COMPANY_PHONES_RAW = [
  "0961486648",   // hotline MDA — SMAX gán nhầm cho 22 khách
];

/** Email nội bộ — so nguyên chuỗi, viết thường */
const COMPANY_EMAILS_RAW = [
  "sales@mastering-da.com",
];

/** Miền email của công ty — mọi địa chỉ @mastering-da.com đều là người nhà */
const COMPANY_DOMAINS = ["mastering-da.com"];

const last9 = (p: unknown): string => {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : "";
};
const lower = (e: unknown): string => String(e ?? "").toLowerCase().trim();

const PHONE_SET = new Set(COMPANY_PHONES_RAW.map(last9).filter(Boolean));
const EMAIL_SET = new Set(COMPANY_EMAILS_RAW.map(lower));

/** SĐT này là của công ty (không phải của khách)? */
export function isCompanyPhone(phone: unknown): boolean {
  const k = last9(phone);
  return !!k && PHONE_SET.has(k);
}

/** Email này là của công ty? Bắt cả theo miền @mastering-da.com. */
export function isCompanyEmail(email: unknown): boolean {
  const v = lower(email);
  if (!v.includes("@")) return false;
  if (EMAIL_SET.has(v)) return true;
  return COMPANY_DOMAINS.some((d) => v.endsWith("@" + d));
}

/** Dùng khi ĐIỀN thông tin: trả về "" nếu giá trị là của công ty. */
export const cleanPhone = (p: unknown): string => (isCompanyPhone(p) ? "" : String(p ?? "").trim());
export const cleanEmail = (e: unknown): string => (isCompanyEmail(e) ? "" : lower(e));

/**
 * So tên tuyệt đối (bỏ dấu, gộp khoảng trắng, không phân biệt hoa thường).
 * Chỉ dùng cho ngoại lệ "trùng SĐT công ty NHƯNG tên giống 100% thì vẫn gộp".
 */
export function sameNameExact(a: unknown, b: unknown): boolean {
  const n = (s: unknown) => String(s ?? "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
  const x = n(a), y = n(b);
  return !!x && x === y;
}

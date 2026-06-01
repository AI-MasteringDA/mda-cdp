import { faker } from "@faker-js/faker/locale/vi";

const VN_LAST_NAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ"];
const VN_MIDDLE = ["Văn", "Thị", "Quốc", "Hữu", "Đức", "Minh", "Mai", "Thu", "Anh"];
const VN_FIRST = [
  "An", "Bình", "Cường", "Dũng", "Hà", "Hằng", "Hùng", "Linh", "Long", "Mai",
  "Nam", "Ngọc", "Phương", "Quân", "Thảo", "Trang", "Tùng", "Vy", "Yến", "Đạt",
];

export function fakeVietnameseName(): string {
  return [
    faker.helpers.arrayElement(VN_LAST_NAMES),
    faker.helpers.arrayElement(VN_MIDDLE),
    faker.helpers.arrayElement(VN_FIRST),
  ].join(" ");
}

export function fakeVietnamesePhone(): string {
  const prefix = faker.helpers.arrayElement(["+84 90", "+84 91", "+84 93", "+84 96", "+84 97", "+84 98"]);
  const rest = faker.string.numeric(7);
  return `${prefix}${rest.slice(0, 3)} ${rest.slice(3)}`;
}

const CHAT_TEMPLATES = [
  "Cho em hỏi lớp tối thứ 7 có còn chỗ không ạ?",
  "Học phí khóa Power BI bao nhiêu vậy ạ?",
  "Em mới biết MDA qua chị Phương Thảo, cho em xin lộ trình với",
  "Có ưu đãi cho học viên cũ không ạ?",
  "Khóa SQL cần background gì trước ạ?",
  "Em muốn book lịch tư vấn 1-1, có còn slot tuần này không?",
  "Sau khóa có hỗ trợ giới thiệu việc làm không ạ?",
  "Lớp online hay offline ạ? Em ở Đà Nẵng",
  "Có giảm giá cho sinh viên không ạ?",
  "Em đăng ký 2 khóa cùng lúc có giảm không ạ?",
];

export function fakeChatMessage(): string {
  return faker.helpers.arrayElement(CHAT_TEMPLATES);
}

export { faker };

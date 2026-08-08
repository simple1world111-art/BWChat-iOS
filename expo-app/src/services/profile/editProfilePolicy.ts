import { trimFoundationWhitespaces, trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { User } from "@/models";

export const editProfilePolicy = {
  avatarSize: 88,
  avatarShadowRadius: 6,
  avatarShadowY: 3,
  cameraBadgeSize: 28,
  cameraSymbolSize: 12,
  avatarTopPadding: 20,
  avatarLabelSpacing: 12,
  sectionSpacing: 24,
  formHorizontalPadding: 16,
  formVerticalPadding: 4,
  formRadius: 14,
  rowHorizontalPadding: 16,
  rowVerticalPadding: 18,
  rowTitleWidth: 96,
  rowTitleMinimumScale: 0.78,
  titleSize: 15,
  valueSize: 15,
  bioCounterSize: 11,
  bioCharacterLimit: 150,
  toastFontSize: 14,
  toastHorizontalPadding: 20,
  toastVerticalPadding: 10,
  toastRadius: 20,
  toastBottomPadding: 30,
  toastDurationMs: 2_500,
  toastAnimationMs: 350,
  birthdayOpenAnimationMs: 250,
  birthdayCloseAnimationMs: 200,
} as const;

export const profileAvatarUploadPolicy = {
  fieldName: "image",
  filename: "avatar.jpg",
  mimeType: "image/jpeg",
  timeoutMilliseconds: 90_000,
} as const;

export type ProfileGender = "" | "male" | "female" | "other";

export interface ProfileEditValues {
  nickname: string;
  bio: string;
  gender: string;
  birthday: string;
  location: string;
}

interface ProfileEditSource {
  nickname: string;
  bio: string;
  gender: string;
  birthday: string;
  location: string;
}

export function profileBioSegments(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      (item) => item.segment,
    );
  }
  return Array.from(value);
}

export function profileBioLength(value: string): number {
  return profileBioSegments(value).length;
}

export function limitProfileBio(value: string): string {
  return profileBioSegments(value).slice(0, editProfilePolicy.bioCharacterLimit).join("");
}

export function canSaveProfileNickname(value: string): boolean {
  return trimFoundationWhitespaces(value).length > 0;
}

export function defaultProfileBirthdayDate(now = new Date()): Date {
  const result = new Date(now);
  const targetYear = result.getFullYear() - 18;
  const month = result.getMonth();
  const day = Math.min(result.getDate(), new Date(targetYear, month + 1, 0).getDate());
  result.setDate(1);
  result.setFullYear(targetYear);
  result.setMonth(month);
  result.setDate(day);
  return result;
}

export function parseProfileBirthday(value: string): Date | null {
  const trimmed = trimFoundationWhitespacesAndNewlines(value);
  if (!trimmed) return null;
  return (
    parseProfileBirthdayPrefix(trimmed) ??
    (trimmed.length >= 10 ? parseProfileBirthdayPrefix(trimmed.slice(0, 10)) : null)
  );
}

export function formatProfileBirthday(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

export function normalizeProfileBirthday(value: string): string {
  const trimmed = trimFoundationWhitespacesAndNewlines(value);
  if (!trimmed) return "";
  const date = parseProfileBirthday(trimmed);
  return date ? formatProfileBirthday(date) : trimmed;
}

export function birthdayForProfileSave(value: string, selectedDate: Date): string {
  const trimmed = trimFoundationWhitespacesAndNewlines(value);
  if (!trimmed) return "";
  return formatProfileBirthday(parseProfileBirthday(trimmed) ?? selectedDate);
}

export function makeProfileEditValues(source: ProfileEditSource): ProfileEditValues {
  return {
    nickname: source.nickname,
    bio: limitProfileBio(source.bio),
    gender: source.gender,
    birthday: normalizeProfileBirthday(source.birthday),
    location: source.location,
  };
}

export function displayProfileBirthday(value: string, locale: string, unsetLabel: string): string {
  if (value.length === 0) return unsetLabel;
  const date = parseProfileBirthday(value);
  if (!date) return value;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  } catch {
    return value;
  }
}

export function profileUpdateBody(values: ProfileEditValues, selectedDate: Date) {
  return {
    nickname: values.nickname,
    bio: limitProfileBio(values.bio),
    gender: values.gender,
    birthday: birthdayForProfileSave(values.birthday, selectedDate),
    location: values.location,
  };
}

export function isProfileGender(value: string): value is ProfileGender {
  return value === "" || value === "male" || value === "female" || value === "other";
}

export function profileUsersEqual(lhs: User | null, rhs: User): boolean {
  return (
    lhs !== null &&
    lhs.user_id === rhs.user_id &&
    lhs.username === rhs.username &&
    lhs.nickname === rhs.nickname &&
    lhs.avatar_url === rhs.avatar_url &&
    lhs.bio === rhs.bio &&
    lhs.gender === rhs.gender &&
    lhs.birthday === rhs.birthday &&
    lhs.location === rhs.location &&
    lhs.following_count === rhs.following_count &&
    lhs.follower_count === rhs.follower_count &&
    lhs.posts_count === rhs.posts_count &&
    lhs.moments_count === rhs.moments_count &&
    lhs.followed_by_me === rhs.followed_by_me &&
    lhs.follows_me === rhs.follows_me &&
    lhs.is_friend === rhs.is_friend
  );
}

function parseProfileBirthdayPrefix(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

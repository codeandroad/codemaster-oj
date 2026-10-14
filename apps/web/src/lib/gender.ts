import type { CampusGender } from "./production-api";

export const genderOptions: { value: CampusGender; label: string }[] = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
  { value: "other", label: "其他" },
  { value: "undisclosed", label: "不愿透露" },
];

export function genderLabel(value: CampusGender | null | undefined): string {
  return genderOptions.find((option) => option.value === value)?.label ?? "未填写";
}

const importGenderValues: Record<string, CampusGender> = {
  male: "male", 男: "male",
  female: "female", 女: "female",
  other: "other", 其他: "other",
  undisclosed: "undisclosed", 不愿透露: "undisclosed",
};

export function importGender(value: string): CampusGender | null | undefined {
  if (!value.trim()) return null;
  return importGenderValues[value.trim().toLowerCase()];
}

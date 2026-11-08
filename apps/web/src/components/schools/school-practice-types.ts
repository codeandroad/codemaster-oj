export type Definition = {
  title: string;
  statement: string;
  mode: "stdio" | "function";
  functionName?: string;
  comparator: string;
  starterCode: string;
  starterCodes?: Partial<Record<"python" | "cpp" | "javascript", string>>;
  difficulty?: string;
  objective?: string;
  parameters?: (string | { name: string; type?: string; description?: string })[];
  returnType?: string;
  tags?: string[];
  referenceCode?: string;
  samples: { input: string; expected: string }[];
  tests?: { input: string; expected: string; weight: number }[];
  timeLimitMs: number;
  memoryLimitMb: number;
};

export type Problem = {
  activity?: {id:string;title:string;kind:"assignment"|"timed";phase:string;canSubmit:boolean;attempt:{id:string;startedAt:string;deadlineAt:string|null;finishedAt:string|null}|null;resultsPublishedAt:string|null};
  solved?: boolean;
  attempts?: number;
  hasDraftChanges?: boolean;
  id: string;
  schoolId: string;
  bankId: string;
  bankName: string;
  title: string;
  revision: number;
  published: boolean;
  versionId: string | null;
  canManage: boolean;
  canManageTutorial?: boolean;
  definition?: Definition;
  validation?: { id: string; state: string; status: string | null } | null;
  schoolName?: string;
  platformPublished?: boolean;
  publicRequestStatus?: "pending" | "approved" | "rejected" | "cancelled" | null;
};

export type Bank = {
  id: string;
  name: string;
  revision: number;
  archived: boolean;
  canManage: boolean;
};

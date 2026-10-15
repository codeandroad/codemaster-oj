"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLocale = "zh" | "en";

// Keep UI copy in one place. User-created names, problem statements and course
// material are content, so the language selector does not rewrite them.
const english: Record<string, string> = {
  "首页": "Home", "题目": "Problems", "学习路径": "Learning paths", "作业": "Assignments",
  "限时训练": "Timed practice", "提交记录": "Submissions", "订正本": "Review notebook",
  "教师首页": "Teacher dashboard", "班级与学生": "Classes & students", "题库": "Problem banks",
  "课程": "Courses", "题目编辑": "Problem editor", "作业管理": "Assignment management", "教学报告": "Teaching reports",
  "导入中心": "Import center", "管理员首页": "Admin dashboard", "账号与角色": "Accounts & roles",
  "身份档案": "People & identities", "题库管理": "Problem bank management", "判题服务": "Judge service", "系统设置": "System settings",
  "工作区导航": "Workspace navigation", "打开导航": "Open navigation", "关闭导航": "Close navigation",
  "后续版本": "Coming soon", "校内学习平台": "Campus learning platform",
  "本地管理": "Local administration", "教学工具": "Teacher tools",
  "用户账户菜单": "Account menu", "账户选项": "Account options",
  "个人资料": "Profile", "积分排行榜": "Leaderboard", "个人设置": "Settings",
  "管理工作区": "Admin workspace", "教学工作区": "Teacher workspace", "学生工作区": "Student workspace",
  "退出登录": "Sign out", "正在退出…": "Signing out…", "累计积分": "Total points",
  "暂不可用": "Unavailable", "页面外观": "Appearance", "颜色主题": "Color theme",
  "跟随系统": "System", "浅色": "Light", "深色": "Dark",
  "选择主页面的颜色主题，设置保存在当前浏览器中。": "Choose the site's color theme. This preference is saved in this browser.",
  "界面语言": "Interface language", "默认中文。语言设置保存在当前浏览器中，不翻译题目与用户填写的内容。": "Chinese is the default. This preference is saved in this browser; problems and user content are not translated.",
  "简体中文": "Simplified Chinese", "英语": "English",
  "管理工作台": "Admin dashboard",
  "维护学校身份与账号，查看导入、判题服务和系统设置。": "Manage school identities and accounts, imports, judging, and settings.",
  "查看全部": "View all", "学校班级": "School classes",
  "暂无身份，请先建立档案或导入名单。": "No identities yet. Create or import a roster first.",
  "暂无班级，可在教学工作区建立。": "No classes yet. Create one in the teacher workspace.",
  "页面不存在": "Page not found", "返回工作台": "Return to dashboard",
  "没有访问权限": "Access denied", "你的学校账号没有此页面需要的角色。": "Your school account does not have the required role.",
  "身份导入中心": "Identity import center", "学生名单导入": "Student roster import", "教师身份导入": "Teacher identity import",
  "题目导入": "Problem import", "返回班级与学生": "Back to classes", "打开题目导入": "Open problem import",
  "返回来源": "Back", "选择文件": "Choose file", "目标班级": "Target class", "负责班级": "Assigned class",
  "请选择负责班级": "Select an assigned class", "不指定班级": "Leave unassigned", "不指定负责班级": "Leave unassigned",
  "按文件中的班级列分配": "Assign by class column", "按文件中的负责班级列分配": "Assign by teacher class column",
  "查看模板与填写说明": "Template and instructions", "下载空白 CSV 模板": "Download blank CSV template",
  "预览与处理": "Preview and validate", "确认导入": "Confirm import", "导入结果": "Import result",
  "导入下一批": "Import another batch", "查看班级名单": "View class roster", "查看身份名单": "View identities",
  "上一步": "Back", "下一步": "Next", "正在导入…": "Importing…", "导入任务": "Import task",
  "选择文件与去向": "Choose file and destination", "拖放 CSV / Excel 文件到这里": "Drop a CSV or Excel file here",
  "来源文件": "Source file", "导入去向": "Destination", "有效行": "Valid rows", "跳过无效行": "Invalid rows skipped",
  "原始行": "Row", "学号": "Student ID", "工号": "Teacher ID", "姓名": "Name", "性别": "Gender",
  "身份类型": "Identity type", "班级": "Class", "处理结果": "Result", "结果": "Result",
  "激活码 / 原因": "Activation code / reason", "工号 / 姓名": "Teacher ID / name", "学号 / 姓名": "Student ID / name",
  "学生": "Student", "教师": "Teacher", "已建立": "Created", "已入班": "Added to class", "已跳过": "Skipped",
  "失败": "Failed", "未分配": "Unassigned", "复制全部新激活码": "Copy all new activation codes",
  "题目与测试": "Problems and tests", "学生名单": "Student roster",
  "行": "rows", "文件": "file", "在浏览器内读取表格内容，确认后仅导入有效的": "Read the file in your browser. After confirmation, import only valid ",
  "身份数据": " identity records", "请先新建班级，或联系管理员将你设置为任课教师。": "Create a class first, or ask an administrator to assign you as a class teacher.",
  "表头：工号、姓名；可选性别、负责班级。": "Columns: teacher ID and name; gender and assigned class are optional. ",
  "表头：学号、姓名；可选性别。": "Columns: student ID and name; gender is optional. ",
  "表头：学号、姓名；可选性别、班级。": "Columns: student ID and name; gender and class are optional. ",
  "性别可填男、女、其他或不愿透露。文件若有“身份类型”列，须与当前导入类型一致。": "Gender can be male, female, other, or undisclosed. If present, the identity-type column must match this import. ",
  "教师只能将学生导入自己负责的班级；文件中的班级列不覆盖目标班级。": "Teachers can import students only into classes they teach; a class column does not override the selected class. ",
  "按文件列分配时，未存在的负责班级将建立。": "When assigning from the file, missing classes will be created. ",
  "按文件列分配时，未存在的班级将建立。": "When assigning from the file, missing classes will be created. ",
  "每行一个身份；编号使用文本格式保留前导零。激活码由本人用于注册账号。": "Use one identity per row and text-formatted IDs to preserve leading zeros. Each person uses their activation code to register an account.",
  "共": "Total", "行，可导入": "rows; valid", "行，冲突或无效": "rows; conflicting or invalid", "行。仅有效行进入确认。": "rows. Only valid rows proceed to confirmation.",
  "已有身份，保留账号与激活状态": "Existing identity; preserve account and activation status", "建立身份并生成激活码": "Create identity and activation code",
  "编号已存在且身份资料不同，须人工核对": "An identity with this ID has different details; review manually",
  "该行缺少负责班级名称": "This row is missing an assigned class name", "该行缺少班级名称": "This row is missing a class name",
  "当前为教师身份导入，请使用工号列": "Teacher identity import requires a teacher ID column",
  "当前为学生导入，请使用学号列": "Student import requires a student ID column",
  "编号不能为空": "ID is required", "姓名不能为空": "Name is required",
  "身份类型须为 student 或 teacher": "Identity type must be student or teacher",
  "当前仅导入教师身份，请切换导入类型": "This import accepts teachers only; switch import type",
  "当前仅导入学生身份，请切换导入类型": "This import accepts students only; switch import type",
  "性别须为男、女、其他或不愿透露": "Gender must be male, female, other, or undisclosed",
  "文件中编号重复": "Duplicate ID in file", "编号或姓名过长": "ID or name is too long",
  "建立或关联教师身份，不创建账号": "Create or link teacher identities without creating accounts",
  "建立或关联学生身份，不创建账号": "Create or link student identities without creating accounts",
  "男": "Male", "女": "Female", "其他": "Other", "不愿透露": "Prefer not to say", "未填写": "Not provided",
  "文件须包含 1–500 行身份数据，请分批导入。": "The file must contain 1–500 identity rows. Import larger files in batches.",
  "文件超过 2 MB，请分批导入。": "The file exceeds 2 MB. Import it in batches.",
  "未找到可读取的工作表。": "No readable worksheet was found.",
  "学校教师身份档案，不指定班级": "School teacher identities, unassigned", "学校学生身份档案，不指定班级": "School student identities, unassigned",
  "确认后将保存": "Confirmation saves ", "身份与班级关系，不创建登录账号。既有账号与历史记录保留；新激活码仅在结果页展示。": " identities and class links without creating login accounts. Existing accounts and history remain; new activation codes appear only on the results page.",
  "· 已入班": "· added to class", "· 已跳过": "· skipped", "· 失败": "· failed",
  "激活码明文不可重复读取，请重新生成。": "The activation code cannot be retrieved again; generate a new one.",
  "请将新身份激活码私下交给本人，离开页面后不能再次读取。本人凭激活码认领身份时才创建账号。": "Give each new activation code privately to its owner. It cannot be retrieved after leaving this page; the owner creates an account when claiming the identity.",
  "确认前不会建立身份或改动班级名单": "No identities or class rosters change before confirmation.",
  "学生名单导入可选择班级或暂不分配；教师身份单独导入。名单导入只建立身份，不创建登录账号。": "Student rosters can be assigned to a class or left unassigned; teacher identities are imported separately. Imports do not create login accounts.",
  "身份档案记录姓名、学号或工号及班级关系。导入只建立身份；本人凭激活码认领后才创建登录账号。选择文件与去向 → 预览与处理 → 确认导入 → 结果页。": "Identity records store names, IDs, and class relationships. Import creates identities only; people claim them with activation codes to create accounts. Choose file and destination → preview → confirm → results.",
  "只可导入自己负责班级的学生。导入会建立或关联身份；学生凭激活码认领后才创建登录账号。": "Import students only into classes you teach. This creates or links identities; students create login accounts when they claim an identity with an activation code.",
  "导入题目草稿与测试数据，并在题目编辑器中完成校验。": "Import problem drafts and test data, then validate them in the problem editor.",
  "学习资料": "Learning resources", "课程名称": "Course name", "分类": "Category", "章节": "Chapters",
  "可见范围": "Visibility", "状态": "Status", "操作": "Actions", "本校学生": "School students",
  "维护教师草稿": "Teacher draft", "已发布": "Published", "草稿": "Draft", "编辑": "Edit",
  "查看": "View", "学生预览": "Student preview", "新建课程": "Create course", "添加资料": "Add resource",
  "导入课程 Markdown": "Import course Markdown", "按章节编排课程": "Organize courses by chapter",
  "暂无课程。点击“新建课程”组织章节内容。": "No courses yet. Create one to organize chapters.",
  "输入课程名称": "Enter a course name", "简介": "Description", "预计学习时间（分钟）": "Estimated learning time (minutes)",
  "课程难度": "Difficulty", "课程封面": "Cover", "入门": "Beginner", "进阶": "Intermediate",
  "提高": "Advanced", "通用学习": "General learning",
  "先创建草稿并添加章节，检查内容后发布给本校学生。": "Create a draft, add chapters, then publish after review.",
  "取消": "Cancel", "创建并编辑": "Create and edit", "课程编辑": "Edit course", "保存草稿": "Save draft",
  "发布": "Publish", "课程资料": "Course details", "保存课程资料": "Save course details",
  "确认发布课程": "Publish course?", "课程已发布。": "Course published.",
  "课程组织章节、讲解与练习；班级维护学生名单，作业和限时训练另行发布。": "Courses organize chapters, lessons, and practice; classes manage rosters, while assignments and timed practices are published separately.",
  "新建课程后添加讲解、练习与检查点；草稿仅维护教师可见，发布后本校学生可学习。课程不会自动创建班级、作业或训练。": "Add lessons, practice, and checkpoints. Drafts are visible only to their teacher; published courses are available school-wide. Creating a course does not create a class, assignment, or timed practice.",
  "课程按章节组织内容，练习引用题库中的已发布题目。": "Organize lessons by chapter and link published problems from the bank.",
  "课程章节已保存。": "Course chapters saved.",
  "发布后，本校学生可阅读章节并练习关联的已发布题目。": "After publishing, students can read the chapters and solve linked published problems.",
  "分钟 · 阅读与练习进度独立统计": "minutes · Reading and practice progress are tracked separately",
  "查看学生进度总览": "View student progress", "章": "chapters",
  "删除此资料？课程和题目保留。": "Delete this resource? The course and problems remain.",
  "关联课程 / 章节": "Course / chapter",
  "按文档顺序创建新课程草稿，不覆盖已有课程、不导入学生进度。全部章节与练习引用通过校验后一次保存。": "Create a new draft course from the document without replacing existing courses or importing student progress. Chapters and exercise links are validated before saving.",
  "下载完整 Python 示例与格式模板": "Download Python example and template",
  "选择文档（.md / .markdown，最多 512 KB）": "Choose document (.md / .markdown, max 512 KB)",
  "或者粘贴 Markdown": "Or paste Markdown", "检查文档结构": "Validate document structure",
  "导入为新课程草稿": "Import as new draft course",
  "练习题库": "Practice library", "布置的作业": "Assigned work", "课堂训练": "Classroom practice",
  "我的活动": "My activity", "订正": "Correction", "可用": "Available", "已启用": "Active",
  "已完成": "Completed", "不可用": "Unavailable", "已停用": "Disabled", "等待中": "Waiting",
  "系统错误": "System error", "进行中": "In progress", "未开始": "Not started",
  "评测中": "Judging", "维护中": "Maintenance", "已结束": "Ended", "开放中": "Open",
  "管理员": "Administrator", "学习、作业、训练、订正": "Learning, assignments, practice, review",
  "题库、班级、活动": "Problems, classes, activities", "账号、服务、设置": "Accounts, services, settings",
  "登录": "Sign in", "重置密码": "Reset password", "用户名": "Username", "密码": "Password",
  "新密码（8–128 位）": "New password (8–128 characters)", "一次性重置凭据": "One-time reset code",
  "再次输入新密码": "Confirm new password", "显示密码": "Show password", "隐藏密码": "Hide password",
  "正在处理…": "Processing…", "设置新密码": "Set new password", "忘记密码？": "Forgot password?",
  "返回登录": "Back to sign in", "注册账号 / 激活身份": "Create account / claim identity",
  "使用你在注册时自行设置的用户名与密码登录。日常登录无需再次验证身份，也无需强制修改密码。": "Sign in with the username and password you chose during registration. You do not need to verify your identity again for routine sign-in.",
  "请先向学校管理员核实身份并取得一次性重置凭据，然后自行设置新密码。": "Ask a school administrator to verify your identity and issue a one-time reset code, then choose a new password.",
  "联系学校管理员重置密码": "Contact a school administrator",
  "本校使用本地账号，没有公网邮件找回服务。请向课程教师或管理员提供用户名、姓名及学号 / 工号，由管理员核实身份后提供一次性重置凭据。不要提供原密码。": "This school uses local accounts without email recovery. Give your username, name and student or teacher ID to a teacher or administrator. Never share your old password.",
  "已有账号无需重新注册或再次激活；重置密码不会删除班级、作业或提交记录。": "You do not need to register again. Resetting your password preserves classes, assignments and submissions.",
  "两次输入的新密码不一致。": "The new passwords do not match.", "密码已重置，请使用新密码登录。": "Password reset. Sign in with your new password.",
  "账号已禁用": "Account disabled", "用户名或密码不正确": "Incorrect username or password",
  "注册账号 · 激活身份": "Create account · Claim identity", "注册账号": "Create account", "注册进度": "Registration progress",
  "验证身份": "Verify identity", "设置账号": "Set up account", "完成": "Done",
  "验证你的身份": "Verify your identity", "设置登录账号": "Set up your login", "注册完成": "Registration complete",
  "我是学生": "I am a student", "我是教师": "I am a teacher",
  "首次注册时，请填写名单中的学号和姓名，以及教师或管理员提供的激活码，认领已有身份。验证通过后，由你自行设置用户名与密码，管理员不代建账号。日常登录无需重复验证身份。": "To register, enter your student ID, name and activation code from a teacher or administrator. After verification, choose your own username and password. Administrators do not create accounts for you.",
  "首次注册时，请填写名单中的工号和姓名，以及管理员提供的激活码，认领已有身份。验证通过后，由你自行设置用户名与密码，管理员不代建账号。日常登录无需重复验证身份。": "To register, enter your teacher ID, name and activation code from an administrator. After verification, choose your own username and password. Administrators do not create accounts for you.",
  "激活码": "Activation code", "身份验证未通过": "Identity verification failed",
  "请核对身份类型、编号和姓名；激活码过期或已被替换时，请联系教师或管理员获取新码。已注册的账号请直接登录，无需再次激活。": "Check your identity type, ID and name. If the activation code expired or was replaced, ask a teacher or administrator for a new one. Existing account holders can sign in directly.",
  "重新核对身份信息": "Review identity details", "正在验证…": "Verifying…",
  "身份验证通过": "Identity verified", "历史作业与记录仍保留在身份档案上。": "Past assignments and records remain linked to this identity.",
  "至少 8 位。": "At least 8 characters.", "确认密码": "Confirm password", "联系邮箱（可选）": "Contact email (optional)",
  "正在创建…": "Creating…", "完成注册": "Complete registration", "返回验证身份": "Back to identity verification",
  "返回后保留已填内容；修改身份信息后需重新验证。完成注册时激活码只使用一次。": "Your entries remain when you go back. Changing identity details requires another verification. Registration consumes the activation code once.",
  "已关联账号": "linked to account", "历史作业与提交记录仍属于你的身份档案。": "Past assignments and submissions remain linked to your identity.",
  "请使用自行设置的用户名和密码登录。": "Sign in with the username and password you chose.",
  "前往登录": "Go to sign in", "已有账号？": "Already have an account?", "两次输入的密码不一致，请重新确认。": "The passwords do not match. Please check them again.",
  "算法": "Algorithms", "查看 / 编辑": "View / edit", "资料已删除。": "Resource deleted.",
  "删除": "Delete", "暂无资料。添加说明或代码片段帮助学生复习。": "No resources yet. Add notes or code examples to help students review.",
  "编辑学习资料": "Edit learning resource", "添加学习资料": "Add learning resource", "名称": "Name",
  "类型": "Type", "标题": "Title", "说明": "Note", "代码片段": "Code snippet", "参考资料": "Reference",
  "维护教师": "Managing teacher", "关联课程": "Related course", "独立资料": "Standalone resource",
  "内容": "Content", "内容 / 操作": "Content / actions", "保存资料": "Save resource",
  "导出 Markdown": "Export Markdown", "已导出当前编辑内容（包括未保存修改）。": "Exported the current content, including unsaved edits.",
  "有未保存修改": "Unsaved changes", "新增": "Add", "新章节": "New chapter", "题": "problems",
  "暂无章节，点击“新增”开始编写。": "No chapters yet. Select Add to start writing.",
  "章节名称": "Chapter title", "章节上移": "Move chapter up", "章节下移": "Move chapter down",
  "从本课程移除此章节？题库题目保留。": "Remove this chapter from the course? Problems remain in the bank.",
  "章节已移除，题库题目保留。": "Chapter removed; bank problems remain.", "移除章节": "Remove chapter",
  "学习目标": "Learning objective", "正文 · Markdown 讲解与示例": "Body · Markdown lessons and examples",
  "练习引用": "Linked practice", "从题库与分组选择；只存引用，不复制题面与测试。": "Choose from problem banks and groups. Only links are stored; statements and tests are not copied.",
  "添加练习": "Add practice", "练习上移": "Move practice up", "练习下移": "Move practice down",
  "移除引用": "Remove link", "检查点": "Checkpoint", "检查点 · 独立练习": "Checkpoint · Independent practice",
  "检查点参考答案": "Checkpoint reference answer", "当前编辑内容": "Current draft content",
  "返回原编辑位置": "Return to editor", "查看参考答案": "View reference answer",
  "相关练习": "Related practice", "课程标签": "Course category", "确认发布": "Confirm publication",
};

// Legacy pages used English copy directly. These aliases let shared headings
// and status chips follow the selected language while pages migrate to t().
const chineseAliases: Record<string, string> = {
  "Dashboard": "首页", "Teacher Dashboard": "教师首页", "Admin Dashboard": "管理员首页", "COURSES": "课程",
  "ACCOUNTS": "账号与角色", "PEOPLE": "身份档案", "IMPORT CENTER": "导入中心", "SYSTEM SETTINGS": "系统设置", "Problem editor": "题目编辑",
  "Problems": "题目", "Practice library": "练习题库", "Learning Paths": "学习路径",
  "Assignments": "作业", "Assigned work": "布置的作业", "Timed Practice": "限时训练",
  "Classroom practice": "课堂训练", "Submissions": "提交记录", "Your activity": "我的活动",
  "Review Notebook": "订正本", "Correction": "订正", "Accounts & Roles": "账号与角色",
  "People & Identities": "身份档案", "Import Center": "导入中心", "Judge Service": "判题服务",
  "System Settings": "系统设置", "Available": "可用", "Active": "已启用",
  "Completed": "已完成", "Published": "已发布", "Unavailable": "不可用",
  "Failed": "失败", "Disabled": "已停用", "Waiting": "等待中",
  "System Error": "系统错误", "In progress": "进行中", "Not started": "未开始",
  "Judging": "评测中", "Maintenance": "维护中", "Draft": "草稿", "Ended": "已结束", "Open": "开放中",
};

type LocaleContextValue = { locale: AppLocale; setLocale: (locale: AppLocale) => void; t: (text: string) => string };
const LocaleContext = createContext<LocaleContextValue | null>(null);
const storageKey = "campus-judge:locale:v1";

export function AppLocaleProvider({ initialLocale, children }: { initialLocale: AppLocale; children: ReactNode }) {
  const [locale, setCurrentLocale] = useState<AppLocale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
    return () => { document.documentElement.lang = "zh-CN"; };
  }, [locale]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey) setCurrentLocale(event.newValue === "en" ? "en" : "zh");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const setLocale = useCallback((next: AppLocale) => {
    setCurrentLocale(next);
    document.cookie = `campus-judge-locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try { localStorage.setItem(storageKey, next); } catch { /* Keep the selection for this session. */ }
  }, []);
  const t = useCallback((text: string) => {
    const chinese = chineseAliases[text] ?? text;
    return locale === "en" ? english[chinese] ?? text : chinese;
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  return context ?? { locale: "zh", setLocale: () => {}, t: (text) => text };
}

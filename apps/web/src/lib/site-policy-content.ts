import type { AppLocale } from "@/lib/app-locale";
import type { SitePolicySlug } from "@/lib/site-policy-links";

export type SitePolicyDocument = {
  description: string;
  sections: { heading: string; paragraphs?: string[]; items?: string[] }[];
};

export const sitePolicyContent: Record<AppLocale, Record<SitePolicySlug, SitePolicyDocument>> = {
  en: {
    terms: {
      description: "Rules for using CodeMaster OJ for coding practice, courses and school assessments.",
      sections: [
        {
          heading: "Accounts and school access",
          paragraphs: [
            "You can use a personal account for public practice. Access to school courses, classes, assignments and results depends on your membership, role and the rules set for each activity. Keep your password, activation code and reset code private, and sign out when you finish on a shared device.",
          ],
        },
        {
          heading: "Fair and responsible use",
          items: [
            "Follow the rules your teacher sets for collaboration, outside resources and AI assistance. Submit work you are allowed to submit and credit sources when required.",
            "Use the judge to test solutions to the stated problem. Do not interfere with the service, evade access or resource limits, or seek access to hidden tests, other accounts or restricted teaching materials.",
            "Share course materials, code and comments only where you have permission. Respect the privacy of other learners and staff.",
          ],
        },
        {
          heading: "Submissions and results",
          paragraphs: [
            "The judge runs your code in a separate restricted environment against the tests for the selected problem version and applies its time and memory limits. Use a sample run to check your code before submitting it for judging. Grades and detailed results become visible according to the activity’s release settings.",
            "Ask the course teacher to review a disputed school result. Include the activity and submission ID, the time of the submission and the result you saw.",
          ],
        },
      ],
    },
    privacy: {
      description: "What CodeMaster OJ processes in its current account, teaching and judging features, who can see it and how to make a request.",
      sections: [
        {
          heading: "Information used to provide the service",
          items: [
            "Account details include your username, display name and a password hash. An email address is optional at personal registration. Profile settings can include a nickname, avatar and bio. School records may include your name, student or staff number, gender, class membership and role. Schools may supply identity and class lists.",
            "Learning and judging records include course progress, submitted code, run inputs, judging results, assignments, assessment answers and grades, as well as related points and rewards. These records support judging, progress tracking and teaching review.",
            "The service uses session and recent activity information to maintain sign-in and show online status. It uses IP addresses to limit repeated requests and keeps audit records for certain administrative actions. When you use the school guestbook, the service processes messages and related reports for display and moderation.",
          ],
        },
        {
          heading: "Who can see information",
          paragraphs: [
            "School access is based on role, membership and class assignment. Authorized teachers and school administrators can access the teaching and administrative records they are permitted to manage. Classmates may see names on a shared class roster. Where enabled, school profiles can display nicknames, avatars, bios, eligible activity and guestbook messages to authorized school users.",
            "Signed-in learners may see online status, avatars and other profile information available in public practice. You can choose whether to appear on the public practice leaderboard. It uses a generated alias unless you choose to show your nickname.",
          ],
        },
        {
          heading: "How long records remain",
          paragraphs: [
            "Account, submission and teaching records are stored on the service. The current software has no single automatic deletion period for these records. Schools can keep archived teaching records after a student leaves. Signing out or clearing site data changes what is stored on your device and leaves service records in place.",
          ],
        },
        {
          heading: "Access, corrections and other requests",
          paragraphs: [
            "You can view and edit available profile fields in your account. Ask your school administrator to correct school identity or class records. Use the email listed on the Contact page to request access, a copy, correction, deletion, restriction of processing or transfer of eligible information. You can also use it to request account closure or withdraw consent where applicable.",
            "In your request, describe the records and the action you want. Provide your username and school if relevant so the recipient can identify the right account and verify the request privately. Parents and guardians can use the same email for requests about a child’s information.",
          ],
        },
      ],
    },
    cookies: {
      description: "How CodeMaster OJ uses a sign-in cookie and browser storage to preserve settings and work in progress.",
      sections: [
        {
          heading: "Sign-in cookie",
          paragraphs: [
            "The site sets the first-party campus_session cookie to recognize your signed-in session. It is HttpOnly and SameSite=Strict, and uses the Secure attribute in production.",
            "The site sets a browser maximum age of 400 days and renews it when it checks a valid session. That duration applies to the browser cookie. The server manages the session separately. Signing out clears the cookie and revokes that session.",
          ],
        },
        {
          heading: "Browser storage",
          items: [
            "Local storage keeps preferences such as language, school selection, editor layout and filters, along with some practice and teaching drafts. It can remain on the device after the browser closes.",
            "Tab session storage keeps temporary information such as some code drafts, selected languages, timers and reading positions. It generally lasts for the browser tab session.",
          ],
        },
        {
          heading: "Managing storage on your device",
          paragraphs: [
            "You can block cookies or clear site data in your browser settings. Blocking the sign-in cookie can prevent you from staying signed in. Clearing site data can sign you out and remove locally saved drafts and settings. Save important work before clearing site data, and sign out on shared devices.",
          ],
        },
      ],
    },
    copyright: {
      description: "How rights in site materials, third-party resources and user submissions are handled.",
      sections: [
        {
          heading: "Site and third-party materials",
          paragraphs: [
            "Rights in the site interface, original courses and problem materials belong to their respective rights holders. Third-party problems, past papers, images and software remain subject to their original rights and license terms. Check the source and any license before redistributing material. Keep the attribution and license notices that apply.",
          ],
        },
        {
          heading: "Code and teaching materials you provide",
          paragraphs: [
            "You retain the rights you hold in your submissions and teaching materials. Provide content you have the right to use. The service stores, judges and displays that content as needed for the feature and within its configured access scope, such as a class assignment or a course published publicly.",
          ],
        },
        {
          heading: "Reporting a copyright concern",
          paragraphs: [
            "A rights holder or authorized representative can report a concern privately using the email listed on the Contact page. Include your real identity and contact details, your authority to act if you represent the rights holder, the page URL or problem or course ID, and preliminary evidence of the rights and alleged infringement.",
            "If your material is affected by a copyright report, use the same channel to respond with the relevant item and any supporting evidence.",
          ],
        },
      ],
    },
    contact: {
      description: "Who to contact about courses, judging, school accounts, technical problems and policy requests.",
      sections: [
        {
          heading: "Courses, assignments and judging",
          paragraphs: [
            "Start with your course teacher for assignment access, deadlines, problem statements and school results. For a judging issue, share the activity name, problem or submission ID, programming language, approximate time and result you saw.",
          ],
        },
        {
          heading: "School accounts and records",
          paragraphs: [
            "Contact your school administrator for invitations, identity activation, class membership, record corrections or a one-time password reset code. Use your school’s existing private support channel and share only the information needed to identify your account.",
          ],
        },
        {
          heading: "Technical and policy requests",
          paragraphs: [
            "For site issues, include the page URL, browser, approximate time, steps and error message. Use email for formal privacy and copyright requests. Remove other people’s personal information from screenshots and keep passwords, activation codes and reset codes private.",
          ],
        },
      ],
    },
  },
  zh: {
    terms: {
      description: "使用 CodeMaster OJ 进行编程练习、课程学习和校内考核时适用的规则。",
      sections: [
        {
          heading: "账号与校内访问",
          paragraphs: [
            "个人账号可以参加公开练习。校内课程、班级、作业和成绩的访问权限取决于学校成员身份、角色和活动设置。请妥善保管密码、激活码和重置凭据，使用共享设备后及时退出登录。",
          ],
        },
        {
          heading: "学术诚信与使用规范",
          items: [
            "遵守任课教师关于合作、外部资料和 AI 工具的要求。只提交有权提交的作品，并按课程要求注明来源。",
            "使用判题服务验证题目解法。请勿干扰服务、绕过访问或资源限制，或尝试获取隐藏测试、他人账号及受限教学资料。",
            "分享课程材料、代码或留言时，请确认拥有相应权限，并尊重其他学习者和教职员工的隐私。",
          ],
        },
        {
          heading: "提交与成绩",
          paragraphs: [
            "判题系统在独立受限的环境中运行代码，使用所选题目版本的测试数据，并执行该题的时间和内存限制。你可以先用样例运行自测，再正式提交判题。成绩和详细结果按活动设置公布。",
            "如对校内判题或成绩有异议，请联系任课教师复核，并提供活动名称、提交编号、提交时间及当时看到的结果。",
          ],
        },
      ],
    },
    privacy: {
      description: "了解 CodeMaster OJ 当前账号、教学和判题功能处理哪些信息、谁能查看，以及如何提出个人信息请求。",
      sections: [
        {
          heading: "提供服务所使用的信息",
          items: [
            "账号信息包括用户名、显示名称和密码哈希。个人注册时可选填邮箱，也可在个人资料中设置昵称、头像和简介。学校档案可能包含姓名、学号或工号、性别、班级及角色。身份和班级名单可由学校提供。",
            "学习和判题记录包括课程进度、提交代码、运行输入、判题结果、作业、考核作答、成绩及相关积分或奖励，用于评测、记录进度和教学复核。",
            "网站使用会话和最近活动信息维持登录、显示在线状态。IP 地址用于限制短时间内的重复请求，部分管理操作会记入审计记录。使用校内留言功能时，网站也会处理留言和相关举报，用于展示和管理。",
          ],
        },
        {
          heading: "信息的可见范围",
          paragraphs: [
            "校内访问按角色、学校成员关系和班级范围控制。获授权的教师和学校管理员可查看其职责范围内的教学和管理记录。同班学生可看到班级名单中的姓名。开启相关功能时，有权限的校内用户可看到学生主页展示的昵称、头像、简介、部分学习动态和留言。",
            "已登录的学习者可能看到公开练习区的在线状态、头像及其他可见的个人资料。你可以自行选择是否参与公开练习排行榜。榜单使用系统生成的别名，也可按你的选择显示昵称。",
          ],
        },
        {
          heading: "记录保存",
          paragraphs: [
            "账号、提交和教学记录保存在服务端。当前版本对这些记录没有统一的自动清理期限。学生退校后，学校可归档历史教学记录。退出登录或清除浏览器站点数据会影响本机保存的信息，服务端记录仍独立保存。",
          ],
        },
        {
          heading: "查阅、更正和其他请求",
          paragraphs: [
            "你可在个人资料中查看并修改可编辑的信息。校内身份或班级信息有误时，请联系学校管理员。你也可通过「联系我们」页面列出的邮箱申请查阅、复制、更正、删除、限制处理或转移符合条件的个人信息，或申请注销账号、在适用时撤回同意。",
            "请说明涉及的记录和希望办理的事项。按需提供用户名和学校信息，便于受理方通过私下渠道核对账号和请求。家长及其他监护人也可通过该邮箱提出与孩子个人信息有关的请求。",
          ],
        },
      ],
    },
    cookies: {
      description: "了解 CodeMaster OJ 如何使用登录 Cookie 和浏览器存储来保留设置和未完成的内容。",
      sections: [
        {
          heading: "登录 Cookie",
          paragraphs: [
            "网站设置第一方 Cookie campus_session，以识别已登录的会话。它带有 HttpOnly 和 SameSite=Strict 属性，生产环境同时设置 Secure 属性。",
            "网站为该 Cookie 设置最长 400 天的浏览器有效期，并在检查有效会话时续期。这个期限适用于浏览器 Cookie，服务端另行管理会话。退出登录会清除 Cookie 并撤销本次会话。",
          ],
        },
        {
          heading: "浏览器本地存储",
          items: [
            "本地存储可保存语言、所选学校、编辑器布局、筛选条件及部分练习和教学草稿，关闭浏览器后也可能保留。",
            "标签页会话存储可保存部分临时代码草稿、所选编程语言、计时状态和阅读位置，通常随标签页会话结束而清除。",
          ],
        },
        {
          heading: "管理设备上的站点数据",
          paragraphs: [
            "你可以在浏览器设置中阻止 Cookie 或清除站点数据。阻止登录 Cookie 可能导致无法保持登录。清除站点数据可能使你退出登录，并移除本机草稿和设置。请先保存重要内容，使用共享设备后记得退出登录。",
          ],
        },
      ],
    },
    copyright: {
      description: "说明网站材料、第三方资源及用户提交内容的权利归属和版权反馈方式。",
      sections: [
        {
          heading: "网站材料与第三方资源",
          paragraphs: [
            "网站界面、原创课程和题目材料的权利归各自权利人所有。第三方题目、历年试卷、图片和软件适用原有权利及许可条款。转载或分发前请查阅来源和许可，并保留适用的署名及许可说明。",
          ],
        },
        {
          heading: "你提供的代码和教学资料",
          paragraphs: [
            "你保留对提交内容和教学资料享有的权利。请仅提供有权使用的内容。平台按功能所需和设定的访问范围保存、评测或展示内容，例如供指定班级完成作业，或供读者学习已公开发布的课程。",
          ],
        },
        {
          heading: "提交版权投诉",
          paragraphs: [
            "权利人或经授权的代理人可通过「联系我们」页面列出的邮箱私下提交投诉。请提供真实身份及联系方式、代理授权说明（如适用）、涉事页面地址或相关题目、课程的编号，以及能够初步证明权利归属和涉嫌侵权的材料。",
            "如你的内容受到版权投诉影响，可通过同一渠道提交说明及相关证据，并注明涉及的内容。",
          ],
        },
      ],
    },
    contact: {
      description: "课程和判题、学校账号、技术问题及政策请求的联系指引。",
      sections: [
        {
          heading: "课程、作业和判题",
          paragraphs: [
            "课程或作业权限、截止时间、题意和校内成绩问题，请先联系任课教师。反馈判题问题时，请提供活动名称、题目或提交编号、编程语言、大致发生时间及当时看到的结果。",
          ],
        },
        {
          heading: "校内账号和身份档案",
          paragraphs: [
            "邀请码、身份激活、班级归属、档案更正或一次性密码重置凭据，请通过学校已有的私下沟通渠道联系学校管理员。仅提供用于确认本人账号所需的信息。",
          ],
        },
        {
          heading: "技术问题和政策请求",
          paragraphs: [
            "反馈网站问题时，请附上页面地址、浏览器、大致发生时间、操作步骤和错误提示。正式的隐私和版权请求请通过邮件提交。发送截图前请遮盖他人的个人信息，并妥善保管密码、激活码和重置凭据。",
          ],
        },
      ],
    },
  },
};

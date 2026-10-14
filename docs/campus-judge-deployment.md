# Campus Judge · Ubuntu 部署与验收

目标机器：Ubuntu 26.04，4 核 / 8 线程、16GB 内存；账号总数约 200，课堂同时在线约 30–50。初始评测并发为 2，单次代码限制 256KiB，默认时限 2 秒、内存 256MiB。学生人数不等于判题并发；请求入可靠数据库队列，排队与 System Error 不产生零分。

`WORKER_NODE_ID` 为持久节点标识，默认 `judge-node-01`，容器重建后继续更新同一节点的心跳。扩展多个 worker 时，每个实例必须配置不同的标识；旧节点心跳过期显示不可用，保留其历史任务归属。

本文记录 2026-10-12 的首期生产实现；自 2026-10-14 起，生产代码直接位于本仓库根目录，所有启动模式均连接真实 API。原型保存在相邻的独立 `../myoj-prototype/` 仓库。此前本地验收记录保留在下文，学校服务器尚未部署。

## 已实现范围

| 范围 | 真实功能 |
| --- | --- |
| 身份与账号 | 管理员建档/CSV与XLSX导入、师生激活认领、登录/主动改密/一次性重置、角色与停用、解绑重绑保留身份历史 |
| 班级 | 行政班/训练班、教师授权、多班成员、已有成员添加、教师受限CSV与XLSX新生导入、同一所有者活跃班名查重 |
| 题库 | 校内/私有题库、教师读/编辑授权、同库引用分组、跨库复制新草稿、JSON/标准ZIP题包导入、统一测试编辑、草稿与不可变发布版本、真实参考解验证 |
| 作业与判题 | 固定版本、正式提交幂等、公开样例/自定义输入、标准I/O与函数题、截止前最高分、整项豁免与延期、订正和教师反馈 |
| 教学扩展 | 学习路径/章节编辑发布、本人完成进度；计时训练开始恢复、服务器截止、延期/手动结束、反馈封锁、结果快照与明确修订 |
| 报告与管理 | 本班作业/训练报告与CSV导出、学生代码查看/订正对比、实际节点心跳与队列、重判候选确认/丢弃、站点/运行设置与备份计划保存、真实备份证据及脱敏审计 |

当前支持 Python 3.12、C++23（Clang 19 + GCC 14 libstdc++）与 JavaScript（Node.js 22），包含标准输入输出题与函数题。JavaScript 的有效运行内存上限为题目设置与 128 MiB 中的较大值，用于覆盖 Node.js 启动开销；题目 API、教师编辑器和学生工作区会明确显示，Python/C++ 严格使用题目值。尚不支持 ACSL 短题自动评分、任意可执行 checker、单题豁免、邮件发送或邮箱登录。题目需教师提供合法来源、参考解和正式测试；仓库中的 Smoke 数据仅在可丢弃本地测试库生成。网页保存站点设置、受硬上限约束的运行参数及备份计划；实际备份调度与数据库恢复由学校服务器脚本执行，界面不会把保存计划称为已完成备份。当前页面与流程以 [原型对齐记录](campus-judge-prototype-alignment.md) 为基线，编程工作区设置和三语言实现详见 [验收记录](campus-judge-workspace-languages-verification.md)；历史验收范围保留在下文。

## 运行结构

`Caddy HTTPS → Next.js / React 页面 + NestJS API → PostgreSQL`；独立 worker 从 PostgreSQL 领取任务后请求 go-judge。PostgreSQL 同时存储身份、会话、题面版本、测试与代码快照，首期不启用额外对象存储。API 和 worker 使用独立非超级用户，worker 无权读取账号密码、身份、会话或修改教学名单。

go-judge 是需要 Linux namespace/cgroup 权限的可信控制器，官方容器使用 privileged；子沙箱以非 root 用户运行，使用独立网络/进程/挂载空间和系统调用过滤。compose 不发布判题/数据库/API 端口，不挂 Docker socket、宿主目录或数据库卷到判题控制器；只开放网关 80/443。执行器不能加入数据库网络。[go-judge 官方配置](https://docs.goj.ac/configuration)

运行镜像使用 go-judge v1.13.2、Python 3.12、Debian 13 的 Clang 19/GCC 14 libstdc++，以及 Node.js 22。启动探测在子沙箱内核对编译器宏、运行时版本、非 root 身份与禁网；不满足则停止 worker，不降级执行。C++ 编译在子沙箱内受单独 CPU/时间/内存限制，产物在任务结束时从执行器缓存删除。ARM64 测试发现上游过滤器缺少 fstatat，保留上游规则并仅补此项，来源和许可见 deploy/judge-seccomp.NOTICE。启动检查仍要求 Linux、cgroup v2 cpu/memory/pids 控制器和 seccomp。更换镜像需要重新运行隔离与资源集成测试。

## 首次部署

需安装 Docker Engine 与 Compose 插件，预检脚本需 Node.js 24.14 或更新的受支持版本，并准备指向服务器的域名及防火墙规则。私有校园域名无法取得公网证书时，应接学校受信任的 HTTPS 入口或配置学校 CA；生产 API 强制 Secure Cookie 和 HTTPS 来源，不使用 HTTP 绕过此要求。

```sh
cp deploy/.env.example deploy/.env
# 编辑域名与来源，并为五个 secret 字段分别填写 openssl rand -hex 32 的结果。
chmod 600 deploy/.env
node scripts/check-deployment.mjs
docker compose --env-file deploy/.env -f deploy/compose.yaml build
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

禁止保留 REPLACE 占位符。密码使用 hex 可避免数据库 URL 转义问题。角色初始化仅在新的数据库卷上运行；已有卷升级时由迁移所有者手动创建角色再应用 grants，不能删除数据库卷来“修复启动”。先通过迁移服务成功状态与 worker 日志确认系统可用。现有版本升级需先备份，再重新构建镜像、执行迁移/grants并重启 API/worker；不要改写已应用的迁移。

API `/healthz` 检查数据库，不代表执行器正常。管理员 Judge Services 查看真实排队任务、最近评测时间和环境版本；学校首次启用前必须提交一道已知答案的题并确认实际评测结果。没有最近评测记录时不能仅凭网页可打开宣称判题正常。

首个管理员使用仅服务器可运行的 CLI 初始化，密码交互隐藏输入，不能在网页上调用或写入命令行：

直接复用已配置迁移凭据的迁移服务，不打印连接或密码：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm migrate node src/bootstrap.mjs
```

CLI 仅允许首次创建；后续管理员通过管理端身份邀请认领。初始生产库为空；管理员建立教师/学生身份并向本人发放一次性激活码，教师认领后配置班级与题目。管理员不会代建学生账号。

## 开发与验证

### 本机完整体验

进入本生产仓库根目录，安装 Node.js 24.14+ 与 Docker/Compose 后，执行 `npm run setup`、`npm run start:local`。该命令使用独立的 `campus-judge-local` Compose 项目和 `campus_demo` 数据库，生产前端由 Docker 构建，API、worker 与实际三语言 go-judge 执行器都在容器中运行。

入口为 `http://127.0.0.1:3000/login`，默认数据库端口 `127.0.0.1:35432` 仅供首次体验数据初始化。首次启动自动生成独立服务密钥至 `deploy/.env.local`、随机测试账号密码至 `.campus-local/test-accounts.json`，两个文件均为权限 600 并被 Git 忽略。再次启动保留班级、题目、成绩与账号状态，不覆盖用户体验期间的操作。

首次初始化的体验数据通过真实 API 建立、通过实际判题器校验：`demo.admin`、`demo.teacher`、`demo.student` 三角色；ACSL 编程体验班；A + B 和 Row Sums 两道原创 Python 题；初始未提交的两题作业；两个学习章节；初始未开始的 30 分钟训练；一份原成绩 75 分、订正通过 100 分的历史报告与教师反馈。之后用户操作产生的状态会保留；旧成绩不会被订正覆盖。

停止并保留数据使用 `docker compose --project-name campus-judge-local --env-file deploy/.env.local -f deploy/compose.local.yaml stop`。重新启动使用 `npm run start:local`。首次构建需要下载镜像；Docker 须保持运行。本地体验 Compose 为本机 HTTP 单独设置会话传输参数，不修改学校部署的 `deploy/compose.yaml`、HTTPS 或 Secure Cookie 约束。

### 开发检查

```sh
npm run setup
npm run typecheck
npm run lint
npm run build
npm test
node scripts/check-separation.mjs
```

本地开发 API 需要独立测试 PostgreSQL、SESSION_SECRET、APP_ORIGIN=http://127.0.0.1:3000、COOKIE_SECURE=false、PORT=3001；使用 `npm run dev:api` 和 `npm run dev:web` 分别启动 NestJS 与 Next.js。Next 开发模式的同源代理指向 `DEV_API_URL`（默认 http://127.0.0.1:3001）。正式生产 HTTPS 配置没有 insecure cookie 例外；原型在相邻 `../myoj-prototype/` 目录独立启动。

`scripts/smoke-production.mjs` 只允许 localhost 可丢弃安装，自动创建明确命名的 Smoke 身份、班级、题目和作业，调用真实 worker 与 Python 执行器验证完整教学闭环，包括受限教师导入与激活、私有题库/分组/JSON导入、学习进度、报告、真实 WA/AC、订正不覆盖作业成绩、计时训练反馈封锁与发布、重判确认以及解绑重绑接续历史。请勿向正式学校数据库运行测试夹具。

`scripts/load-classroom.mjs` 在明确命名的本地 `campus_test` 测试库建立 50 个合成学生真实会话，完成读取和同时提交，通过实际 worker 判题；结束后清理本次夹具。它只验证已选轻量题目的课堂场景，不能直接证明学校机器的峰值容量。

判题及队列集成测试需要显式测试配置，默认无环境时只执行单元测试并报告集成测试跳过。运行沙箱集成测试使用 GO_JUDGE_TEST_URL / GO_JUDGE_TEST_TOKEN；数据库测试使用 TEST_DATABASE_URL 和 JUDGE_TEST_DATABASE_URL，隔离临时 schema。检查报告中的 skip 数，不能把跳过当验收通过。

## 备份与恢复演练

```sh
BACKUP_HOST_KIND=school sh scripts/backup.sh /学校管理员设置的私有备份目录
```

备份包含私人测试、学生代码、身份与会话，目录只对管理员开放；将备份复制到独立存储并按学校留存策略清理，不放到网页下载目录。学校调度工具每天运行一次即可，本项目不会自动修改服务器定时任务。

脚本成功生成 PostgreSQL custom `.dump` 后记录真实大小、文件名和 SHA-256；管理界面的“备份与恢复”读取这些审计证据。`BACKUP_HOST_KIND=school` 只用于实际学校主机；未指定时记录为未知环境。本机恢复演练记录为 `local`，不会被界面误报为学校验证。界面保存的计划不会自动创建调度任务。

恢复演练必须使用独立测试数据库，以 `pg_restore` 导入后检查身份/账号、题目版本、提交/运行、作业与计时训练结果快照关联，再在恢复环境验证登录及成绩读取；学校上线前在单独 PostgreSQL 实例重复执行。正式恢复需先备份当前库并停止 API/worker，涉及现有数据替换，由学校管理员明确执行。恢复旧快照会带回旧会话和未使用凭据，切换前应撤销会话与重置凭据、失效激活码，按需重新发放，并保留服务器维护记录。目标 RPO 24 小时、RTO 4 小时，在学校环境演练后才能确认。

只有上述实际恢复与检查通过后，才登记恢复证据（文件 SHA 必须对应此前记录的备份）。在本仓库根目录下执行：

```sh
campus_verified_archive=/学校管理员设置的私有备份目录/实际备份文件.dump
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps -T \
  --entrypoint node --env BACKUP_HOST_KIND=school \
  --volume "$campus_verified_archive:/backup/verified.dump:ro" \
  migrate record-backup.mjs --verified /backup/verified.dump
```

这一步只登记已经完成的检查，不执行恢复；更改计划或点击页面按钮不能代替恢复验证。

班级导入的短期重试缓存含 AES-GCM 加密的新生激活码响应，仅保留 15 分钟；到期或密钥轮换后仅返回无凭据导入结果。备份中可能包含该密文，故备份仍按敏感资料管理；不要为恢复重试缓存而将生产密钥复制到不受信任环境。

## 拆分前的历史验收记录（2026-10-12）

下表是原实现的历史结果，不代表当前框架迁移已验收。迁移后的实际检查另记；无凭据的历史汇总见 [campus-judge-verification.json](campus-judge-verification.json)。

| 验证 | 实际结果与边界 |
| --- | --- |
| 后端自动化 | 68 项通过，0 失败、0 跳过；实际 PostgreSQL 17、Linux go-judge/Python 3.12；包含认证、授权、并发、不可变版本、队列租约、函数协议、资源隔离、计时快照、报告、导入和审计 |
| 全链路烟测 | API 使用 `campus_app`、worker 使用 `campus_worker`；真实身份认领、参考解校验、WA/AC、自测、订正、教学扩展、重判与换绑 |
| 课堂负载 | 受限API角色下50 个真实登录、200 次读取、50 次同时正式提交；50 次真实 AC，0 错误/未完成；接收延迟 p95 163ms、完成观测延迟 p95 9.15s，总耗时 12.03s |
| 构建与页面 | TypeScript、变更UI的ESLint、原型构建、生产Node构建；Linux Web/API Docker镜像构建与非root实际启动，API真实登录返回Secure/HttpOnly Cookie；前端和后端npm audit已知漏洞均为0 |
| 私有备份恢复 | 本地可丢弃库 custom-format 导出至权限600文件，恢复至另一数据库；19 张关键表内容一致，8 项迁移完整，恢复库真实登录与历史成绩/进度读取通过；学校RPO/RTO仍待验收 |

负载结果来自开发机上的 Linux Docker 执行器，使用轻量函数题、并发 2，不是 Ubuntu 学校服务器的容量承诺。重题、全班连续重交、教师参考解验证与基础设施故障会延长排队；总任务 CPU 30 秒 / 墙钟 60 秒预算、每账号最多 5 个在途任务、20 次/分钟运行请求以及全局队列上限 1000 共同约束最坏压力。源码含可复跑脚本，但不应在正式学生数据上运行合成夹具。

浏览器实际覆盖 Chromium 1440×900 与 390×844：登录/退出、44:56工作区、自测与真实提交AC、作业矩阵与代码详情、订正/订正本、私有题库创建。最终独立无头Chromium补验中文CSV真实文件解析→预览→确认→新生入班、异步校内题库选项、学习/训练/报告页面读取、系统参数/审计以及窄屏无页面横向溢出。未声称完成 Firefox、Safari、768/1280 宽度或所有页面操作组合；XLSX选择上传尚未浏览器实测，接口授权与导入结果已由真实HTTP集成测试覆盖。

## 独立生产项目迁移验收（2026-10-12）

当时生产框架为 Next.js 16.4.0 / React 19.3.0 / Tailwind 4.3.3 / TypeScript 6.0.3，以及 NestJS 12.1.2 / Express 5.3.0。该轮代码、依赖锁、构建和 Docker 配置位于独立的 `production/`，未修改当时原型 `myoj/` 的任何受 Git 管理文件。结构检查验证了原型 169 个文件的内容哈希和 Git HEAD 不变、工作区干净；生产没有 Lovable、Vite、TanStack 或原型运行依赖。当前目录位置以文首说明为准。

本次实际重跑：业务核心 68 项测试和实际 Nest HTTP 综合测试全部通过、无失败或跳过；两应用类型检查、前端零警告 lint、Next standalone / Nest 构建及 Linux Docker 镜像实际运行通过。Linux Node 24.14.0 与 macOS clean npm ci 均通过；三个运行包的 npm audit 已知运行依赖漏洞为 0。

独立临时测试库中的全流程烟测经实际 Nest HTTP、真实 campus_app 与具备等效 worker 最小权限的临时角色执行；10 个真实隔离判题任务全部完成（8 AC、1 Executed、1 WA），覆盖身份认领与隔离、教师名单导入、题库发布、WA75→订正AC100保留原成绩、正式AC、学习进度、报告、计时成绩封锁/结束/发布、重判确认与重新认领后的历史接续。临时数据库、角色及进程已清理，未触碰体验库。

当前本机 Docker 环境以新 Next/Nest 启动入口运行，沿用 `campus-judge-local_database` 和三个体验账号。Chromium 1440×900 与 390×844 实测三角色登录、全新作业、学习章节、未开始的训练、真实公开样例通过、教师原成绩与订正代码、管理员身份和评测服务，以及窄屏作业无横向溢出；浏览器 page error 为 0。初始密码与既有体验数据保留。

无凭据记录见 [迁移验收 JSON](campus-judge-framework-migration-verification.json)。先前的 50 学生负载和备份恢复为历史结果，此次未重跑，不计入本次框架迁移验收；学校部署验收边界保持。

## 正式开放条件

完成 30–50 个真实会话的课堂负载测试、Linux 主机的隔离资源测试、浏览器验收、备份恢复演练，并建立判题节点故障处理与学生支持流程。单机容量不依靠 8 个逻辑线程直接推断；先保持并发 2，观察队列等待时长再调优。[Docker 资源限制](https://docs.docker.com/engine/containers/resource_constraints/)

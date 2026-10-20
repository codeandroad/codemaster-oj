# Paper 4 原卷题面预览

此 worktree 的原卷视图使用用户提供的题目 PDF 页面片段，保留原卷字体、代码、表格、示意图和分值框。生成器只读取 `paper4.zip` 中与题目目录对应的 `*_qp_*.pdf`；不会读取或公开评分细则、参考程序、隐藏测试或考生代码，也不会连接数据库。

## 生成资源

在仓库根目录运行以下命令。Python 需要 `pdfplumber` 和 `Pillow`，同时需要 Poppler 的 `pdftoppm`；这些工具只用于离线制作，不属于 Web 或 API 的运行依赖。

```sh
python3 scripts/render-paper4-originals.py --archive /path/to/paper4.zip
```

可使用 `--pdftoppm /path/to/pdftoppm` 指定工具位置；使用 `--paper 9618_s25_41` 只生成一套试卷。完整生成默认处理生产目录 `content/paper4-pastpapers/catalog.json` 的 32 套试卷。生成前逐套校验原卷 SHA-256，缺失、重复、哈希变化、题号缺失、分题顺序错误、空片段或越界裁切均会使该次生成失败。

生成结果位于 `apps/web/public/paper4-originals/`，已加入忽略规则。原卷文件来自用户上传，不随代码提交；单独制作预览或部署 Web 时需要先在目标工作目录生成资源。未生成资源的环境继续使用现有文本题面。

```text
apps/web/public/paper4-originals/
  generation-report.json
  9618_s25_41/
    manifest.json
    question-paper.pdf
    Q1-stem-p02.webp
    Q1-a-p02.webp
    ...
```

生成器不会删除整个输出目录；只替换本次生成的同名文件。完整报告记录各套原件校验值、页数、题数、分题数、片段数、文件数和体积，便于核查。

## 部署前后检查

原卷资源不随 Git 分支合并或推送。切换 worktree 或重新制作 Web 镜像时，必须在**实际构建目录**生成资源；仅另一份 worktree 或旧容器中有资源，并不能保证新镜像包含它们。Dockerfile 会复制该目录的 `apps/web/public`，不会替部署者生成原卷。

需要保留原卷视图的部署，在构建 Web 镜像前执行：

```sh
npm run check:paper4-originals
```

此检查必须通过后再构建和替换 Web 服务。它核对完整目录（目前 32 套、96 道大题），使用与学生端相同的清单校验规则，并检查题干指纹、原卷 PDF 哈希及所有引用图片是否完整。缺失或不匹配会返回非零退出码，不能当作通过。失败时先使用上面的生成命令补齐资源，再重新检查。

部署后再核验实际端口，例如本地 3000：

```sh
npm run check:paper4-originals -- --base-url http://127.0.0.1:3000
```

部署后检查会读取每个清单、PDF 和图片，并与已验证的本地文件逐字节哈希比对，防止旧镜像、404 页面或 HTML 回退被误判为成功。全部检查只读，不连接数据库，也不修改试卷、草稿、成绩或 Luq。使用其他生成目录时可传 `--assets-dir /path/to/paper4-originals`。此检查属于启用原卷视图的发布门槛，不强制没有用户原卷的新安装环境生成文件；新安装仍可正常使用文字题面。

## 清单契约

每套试卷通过 `/paper4-originals/<paperKey>/manifest.json` 提供清单：

```json
{
  "version": 1,
  "paperKey": "9618_s25_41",
  "sourceSha256": "<original QP SHA-256>",
  "pdf": "question-paper.pdf",
  "questions": {
    "Q1": {
      "statementSha256": "<SHA-256 of import-normalized authored statement UTF-8>",
      "stem": [{ "src": "Q1-stem-p02.webp", "width": 1028, "height": 846, "page": 2 }],
      "parts": [{
        "key": "a", "label": "(a)",
        "segments": [{ "src": "Q1-a-p02.webp", "width": 1028, "height": 227, "page": 2 }]
      }]
    }
  }
}
```

`src` 和 `pdf` 都是当前试卷资源目录下的简单相对文件名，不接受任意外部地址。`width`、`height` 是图片的实际像素尺寸；图片以 144 DPI（2 倍）渲染，100% 的参考宽度可取 `width / 2`。`page` 是原 PDF 从 1 开始的页码。

“整题”依次显示 `stem` 与所有 `parts[].segments`；选择 `(a)` 等分题时显示 `stem` 与所选分题的所有片段。跨页内容保留独立片段与原始页码，罗马数字小问保留在对应字母分题中。Q1 的题干包括原卷第 2 页的通用考生文件与证据说明，Q2/Q3 从各自题号开始。空白页与出版页脚不进入片段，原文件仍由“打开 PDF”完整保留。

`statementSha256` 绑定现有结构化题面按导入规则处理后的字符串。生成器与浏览器均只去除首尾空白，严格对应领域层 `field()` 使用的 JavaScript `String.trim()`；正文内部的空格、换行、代码缩进和字词全部保留并参与校验。这样，导入时自动删除的末尾换行不会导致原卷视图失效，而同一年份和卷号下实质修改过的题面仍无法匹配。无法匹配或资源缺失时保留文本题面；原始图片不能代替网页可访问的文本阅读方式。

2026 三套课堂练习仍使用先前明确标注的自建配套文本数据；原卷视图不改变这些数据及判题内容。原卷视图只影响题干展示，不改变试卷版本、答题草稿、提交、评分、参考答案可见范围或积分。

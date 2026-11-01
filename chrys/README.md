# Chrys 1.0.0

Chrys 是一款集屏幕问答、实时语音对话辅助、本地 RAG 和知识库维护于一体的桌面应用。维护者与二次开发作者：**will**。

## 项目优点

- **让回答参考自己的资料**：导入笔记、课程资料和问答后，先检索相关内容，再作为回答上下文。支持全文与本地检索模式切换。
- **结构化分片与混合检索**：结合文档结构切分，保留章节信息，通过向量与关键词检索改善专有名词、链接和具体事实的召回；不必每次发送整份文档。
- **本地管理资料**：网页查看、编辑、删除及恢复原文，上传下载原文件，查看分片、测试检索、重建索引和备份恢复。
- **跨项目复用**：同一套 Ollama + Chroma 可供多个项目使用，各项目使用独立集合；管理网页还可创建独立知识库。
- **模型可配置**：回答模型采用兼容 OpenAI 的接口，支持配置 DeepSeek 等提供商；实时语音使用阿里云 DashScope。向量生成使用本地 BGE-M3。
- **生命周期可控**：仅手动启动，本地服务绑定 127.0.0.1；提供状态检查、停止、备份和卸载预览。

本地保存不等于所有请求都在本地：使用云端回答或语音模型时，相关文本片段、截图或音频会发送给所配置的提供商。RAG 不能保证回答全部正确，请通过检索结果和原文核对。

## 目录

```text
chrys/              桌面应用源码、测试、构建配置
local-rag/          本地服务、网页、管理脚本和测试
  scripts/manage.py 服务生命周期管理
  web/              知识库管理网页
  examples/         其他项目复用示例
  requirements.lock Python 锁定依赖
  runtime/          本机运行环境（不上传）
  models/           本地模型（不上传）
  data/             原始资料及向量数据（不上传）
docs/               管理、分片与跨项目接入说明
```

仓库不包含安装包、密钥、用户设置、文档、向量数据、模型或运行环境。首次克隆需要安装依赖及下载模型。

## 安装前准备

下面的完整安装流程针对 **macOS**，本版本的本地服务流程已在 Mac 上使用。桌面源码包含 Windows 构建配置，但不应将下面的 macOS 运行环境准备步骤直接用于 Windows。

准备 Git、Node.js 24 与 npm、Python 3.11、Ollama 命令行程序。Python 使用独立虚拟环境。Ollama 可从其[官方页面](https://ollama.com/download)安装。确保 `git`、`node`、`npm`、`python3.11`、`ollama` 可用：

```sh
git --version
node --version
npm --version
python3.11 --version
ollama --version
```

建议至少 8 GB 内存，16 GB 更适合同时运行桌面、向量模型和浏览器；预留约 10 GB 磁盘用于依赖、模型及数据，资料增长后需要更多空间。这是容量建议，不是性能保证。首次下载需要网络；云端回答和语音另需各自 API Key 与可用额度。

## 1. 克隆与安装桌面依赖

```sh
git clone https://github.com/saynoer/Chrys_.git
cd Chrys_
npm --prefix chrys ci
npm --prefix chrys test
npm --prefix chrys run build
```

以下所有命令均在仓库根目录执行，除非注明另开终端。遇到错误应停止并排查，不要跳过失败步骤继续执行。

## 2. 准备隔离的本地服务环境

```sh
mkdir -p local-rag/runtime/node/bin local-rag/runtime/ollama
mkdir -p local-rag/models local-rag/data local-rag/logs local-rag/run
ln -s "$(command -v node)" local-rag/runtime/node/bin/node
cp "$(command -v ollama)" local-rag/runtime/ollama/ollama
python3.11 -m venv local-rag/runtime/chroma-env
local-rag/runtime/chroma-env/bin/python -m pip install -r local-rag/requirements.lock
node local-rag/web/build.cjs
```

这是首次安装命令；如果目标已存在，先检查已有环境，不要覆盖正在使用的运行环境。`runtime/node/bin/node` 应指向当前可用的 Node。安装锁定依赖失败时保留错误信息，不要自行升级所有依赖。

无需启动系统默认端口的 Ollama；本项目使用独立端口和模型目录。下载模型前先启动项目服务：

```sh
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py start
OLLAMA_HOST=127.0.0.1:11435 local-rag/runtime/ollama/ollama pull bge-m3
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py status
```

首次下载模型可能需要较长时间。状态应显示三个服务 `ready: true`：

| 服务 | 本地地址 | 用途 |
| --- | --- | --- |
| Ollama | http://127.0.0.1:11435 | BGE-M3 向量生成 |
| Chroma | http://127.0.0.1:18000 | 向量存储与查询 |
| 管理网页 | http://127.0.0.1:18080 | 维护原文与测试检索 |

端口被占用时管理器会拒绝接管其他进程，请先确认占用来源，勿直接结束陌生进程。

## 3. 启动桌面并连接相同的资料目录

**另开终端**，进入同一个仓库根目录：

```sh
export SHIPING_RAG_USER_DATA="$PWD/local-rag/data/shiping-trial"
npm --prefix chrys run dev
```

`SHIPING_RAG_USER_DATA` 和 `shiping-trial` 是兼容现有数据的内部名称，不是桌面源码目录。显式设置这个绝对路径，才能让桌面与管理网页找到同一份资料及连接信息。每次从新终端启动都应设置它。不要同时运行两个使用同一资料目录的桌面实例。

在桌面设置中配置回答提供商的地址、模型和 API Key。DeepSeek 适用于文本对话；截图问答需要选择支持图片输入的模型。需要语音时，再配置阿里云 DashScope 对应的语音服务及 Key，并根据系统提示授予麦克风、屏幕录制等必要权限。密钥由使用者在本机输入，不要写入 README、Git 或向量元数据。

## 4. 导入资料并开启 RAG

1. 打开桌面设置中的“资料库”，导入 PDF、DOCX、Markdown 或 TXT，也可粘贴文字。扫描 PDF 若没有可提取文本，需要先自行 OCR。
2. 将资料启用到实际使用的模式，例如“对话模式”；未启用的资料不会作为该模式的上下文。
3. 把资料检索模式切换到“本地 RAG/本地检索”，等待索引完成；必要时执行重建索引。全文模式不走本地向量检索。
4. 打开 http://127.0.0.1:18080 ，进入桌面资料库，确认文档、原文、分片和索引状态。桌面必须运行，网页才可维护桌面资料。
5. 在网页检索测试中输入一个原文中有明确答案的问题，检查是否召回包含答案的片段，再在桌面使用相同问题测试回答。

**验证例子**：导入测试文本“Chrys 安装演示的内部代号是青松 731。”，启用到对话模式并建立索引。询问“安装演示的内部代号是什么？”，检索应包含该原文，回答应给出“青松 731”。再询问资料没有记载的事实，检查是否出现无依据的编造。测试结束可删除演示资料并更新索引。

网页新建的独立知识库可供其他项目使用，但**不会自动加入桌面回答上下文**。要让 Chrys 使用资料，应放入桌面资料库并启用相应模式。其他项目接入见 [跨项目接入指南](docs/本地RAG跨项目接入指南.md)和 `local-rag/examples/`；当前管理服务没有通用云端 `/ask` 接口。

## 5. 日常使用、停止与备份

```sh
# 启动 / 检查 / 停止本项目拥有的服务
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py start
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py status
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py stop

# 停止服务后备份；卸载仅生成预览，不自动删除
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py backup
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py uninstall-plan
```

关闭浏览器不会停止服务。`start-admin` / `stop-admin` 仅控制管理网页。网页的 JSON 备份用于资料层面追加恢复；完整迁移还应备份桌面资料目录与 Chroma 数据，并妥善保管本机设置。共享服务被其他项目使用时，先确认使用情况再停止或删除。

## 构建与验证

```sh
npm --prefix chrys test
npm --prefix chrys run typecheck
node --test local-rag/web/tests/*.test.cjs
node local-rag/web/build.cjs
npm --prefix chrys run build
# 可选：生成 macOS 应用包，产物位于 chrys/dist
npm --prefix chrys run build:mac
```

`local-rag/scripts/package-trial.cjs` 是维护者已有试用应用的更新脚本，需要已有试用包；全新克隆请使用 `build:mac`。未签名/未公证的源码构建可能受到系统限制，按系统的正规许可流程处理。

## 可直接交给 AI 的安装任务

将下面内容复制给具备本机终端操作能力的 AI。AI 可以准备依赖、构建和验证；账户登录、密钥输入及系统授权由本人完成。

```text
请安装 https://github.com/saynoer/Chrys_ 的 Chrys。
先阅读仓库 README.md、chrys/AGENTS.md 和 local-rag/README.md，检查操作系统、
Git、Node 24、Python 3.11、Ollama、磁盘及 11435/18000/18080 端口。
按 README 在用户指定目录克隆；已存在仓库时检查状态，不覆盖修改。
使用 npm ci 和 requirements.lock，建立仓库内隔离运行环境，构建桌面及管理网页。
使用 manage.py 启动本项目拥有的本地服务，下载 bge-m3，检查三个服务健康。
以 SHIPING_RAG_USER_DATA=<仓库绝对路径>/local-rag/data/shiping-trial 启动桌面，
指导我在本机输入模型密钥及完成系统授权，不读取或回显密钥，不提交私人数据。
指导我开启本地 RAG、导入演示资料并在网页和桌面分别验证召回及回答。
记录每一步、路径、版本、服务端口、测试结果和可逆的卸载步骤。
任何安装、构建或验证失败就先排查；不得声称未执行的步骤成功。
不删除已有数据，不结束不明进程，不更改到公网监听，不自动公开上传。
最终给出启动、停止、备份和移除方法，并列出仍需本人完成的操作。
```

## 常见问题

- **网页显示桌面未连接**：先启动桌面；确认环境变量指向本仓库的 `local-rag/data/shiping-trial`，然后刷新网页。
- **检索没有结果**：检查三个服务、模型下载、资料启用模式与索引状态，再重建索引；查看 `local-rag/logs/`。
- **召回正确但回答没有依据**：确认已开启本地检索、正在使用正确模式，并查看提示词配置与原文；召回命中不等于最终回答必然准确。
- **更换向量模型**：必须新建集合并重建，不能将不同维度、模型或分片版本混写到原集合。
- **需要远程访问**：当前方案仅供本机可信程序使用；不要直接把端口映射到公网。

## 来源与许可

本项目基于上游软件修改。will 负责本版本维护和新增改动；原作者及第三方依赖的署名与许可保留于 [NOTICE.md](NOTICE.md)、[LICENSE](LICENSE)及各依赖中。使用和分发应遵守现有许可，包含其非商业限制。

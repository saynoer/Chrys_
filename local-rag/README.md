> 完整首次安装与使用步骤见仓库根目录 README.md（桌面源码目录为 chrys/）。

# 可复用本地 RAG 服务

本目录独立于 Chrys 桌面源码。Ollama 生成 BGE-M3 向量，Chroma 持久保存各项目集合；DeepSeek 和阿里云语音配置不属于此服务。

## 本机管理网页

新增 `http://127.0.0.1:18080`，支持多项目、原文增删改查、原文件上传下载、软删除恢复、分片浏览、检索测试、索引状态和JSON备份追加恢复。仅监听回环，不部署公网。

本机可双击相邻 `outputs/启动本地知识库管理.command`。识屏资料通过运行中的 Chrys 1.0.0统一写入，新项目可独立使用。源文件与数据均不进入Git。完整本机操作和REST接口见相邻 `outputs/本地知识库管理说明.md`。

源码克隆到新环境时，先在相邻 `chrys/` 安装锁定的Node依赖，准备 `runtime/node/bin/node` 指向可用Node（验证版本24.22.1），再运行 `node web/build.cjs`。构建仅复用已有esbuild、unpdf和mammoth；不另装网页框架或模型。依赖链接与web/dist均忽略。

## 启动、状态、停止

在本目录的父目录打开终端，运行：

```sh
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py start
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py status
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py stop
```

`start`/`stop` 现在包含网页服务；仅启动/停止网页可用 `start-admin`/`stop-admin`，不会停止其他项目使用的Ollama和Chroma。关闭浏览器不等于停止服务。

仅手动启动，未创建登录启动项，不修改系统 PATH；仅绑定本机回环。服务供本机可信程序使用，collection 是逻辑分组，不是不同本机用户/进程间的鉴权隔离。

## 其他项目复用

- Ollama：`http://127.0.0.1:11435`，`POST /api/embed`，模型 `bge-m3`。
- Chroma：`http://127.0.0.1:18000`，标准 API v2，默认 tenant/database。
- 识屏当前结构化集合：`shiping_knowledge_bgem3_v2`；旧集合 `shiping_knowledge_bgem3_v1` 保留用于回退；其他项目另起集合名称，且登记 manifest.json 的 consumers。
- 完整示例：`examples/reuse.py` 和 `examples/reuse.mjs`；只写各自的合成示例集合，不读取识屏资料。
- 网页新建知识库以 `rag_admin_` 为集合前缀，资料持久保存在 `data/admin/projects/`。其HTTP资料和检索接口位于管理网页 `/api/projects`，使用本机Cookie会话、Origin和CSRF校验；仍未提供云端 `/ask`。
- 同一个集合必须使用相同模型摘要、维度和分段版本。换模型时新建集合并重新生成向量，不混用。
- 请勿把 API Key 放入向量元数据或示例文件。检索的文本片段一旦交给云端模型，仍会离开本机。

## 备份与移除

先停止两个服务，再运行：

```sh
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py backup
local-rag/runtime/chroma-env/bin/python local-rag/scripts/manage.py uninstall-plan
```

卸载命令只预览，不删除。移除分三档：

预览会额外扫描网页新建的项目；这些项目仍存在时，不会误判为只有识屏在使用共享服务。网页新增代码在 `web/`、日志在 `logs/admin.log`、进程记录在 `run/admin.json`；原文件及向量数据仍集中在本目录。

1. 停用识屏 RAG：切换回全文模式即可；停止服务可释放内存。
2. 移除识屏接入：删除试用应用和开发副本，备份后只删除识屏集合；正式版、原始资料和其他项目集合保留。
3. 移除整套服务：核对 consumers 和全部 collections，先备份，再明确确认删除本目录下 runtime/models/data；其他项目仍在用时先迁移它们。不要删除 ~/.ollama 或其他应用目录。

运行环境、模型、数据和日志均集中在本目录；操作台账在相邻 outputs/本地RAG操作台账.md。程序、依赖与模型版本及安装来源见 manifest.json 与 requirements.lock。

## 本地 OCR 与 Office 导入

支持 PNG/JPG/JPEG/WebP、扫描 PDF、XLSX、PPTX，与桌面共享解析组件。先在仓库根目录运行 `npm --prefix chrys run setup:ocr`，再运行 `node local-rag/web/build.cjs` 并重启管理网页。语言资源保存在 `chrys/resources/ocr/`，识别不联网。格式、大小、页数和精度限制见根 README 的本地 OCR 章节。

> 完整首次安装与使用步骤见仓库根目录 README.md（桌面源码目录为 chrys/）。

# 可复用本地 RAG 服务

本目录独立于 Chrys 桌面源码。Ollama 生成 BGE-M3 向量，Chroma 持久保存各项目集合；DeepSeek 和阿里云语音配置不属于此服务。

## 本机管理网页

新增 `http://127.0.0.1:18080`，支持多项目、原文增删改查、原文件上传下载、软删除恢复、分片浏览、检索测试、索引状态和JSON备份追加恢复。仅监听回环，不部署公网。

本机可双击相邻 `outputs/启动本地知识库管理.command`。SQLite启用后，桌面与网页通过共享事务库读写；尚未迁移时，识屏资料通过运行中的 Chrys 1.0.0统一写入，新项目可独立使用。源文件与数据均不进入Git。完整本机操作和REST接口见相邻 `outputs/本地知识库管理说明.md`。

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
- 网页新建知识库以 `rag_admin_` 为集合前缀，启用SQLite后资料持久保存在 `data/library/chrys.sqlite`，原件保存在 `data/library/originals/`；旧版资料位于 `data/admin/projects/`。其HTTP资料和检索接口位于管理网页 `/api/projects`，使用本机Cookie会话、Origin和CSRF校验；仍未提供云端 `/ask`。
- 同一个集合必须使用相同模型摘要、维度和分段版本。换模型时新建集合并重新生成向量，不混用。
- 请勿把 API Key 放入向量元数据或示例文件。检索的文本片段一旦交给云端模型，仍会离开本机。

## 备份与移除

先退出Chrys并停止本项目全部服务，再运行：

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

## SQLite、后台清洗与复核

存储分工：`data/library/chrys.sqlite` 保存资料、不可变正文修订、处理报告、复核历史和索引代际；`data/library/originals/` 保存原件；Chroma只保存可重建的检索向量。`active.json` 决定是否启用SQLite，不能通过手动删配置回退新写入。

新安装默认兼容旧存储。需要迁移时：先构建桌面和网页，退出Chrys、停止管理服务，再在仓库根目录执行：

```sh
node chrys/out/tools/library-maintenance.cjs activate "$PWD/local-rag"
node chrys/out/tools/library-maintenance.cjs verify "$PWD/local-rag"
```

`activate` 拒绝覆盖已有正式库，先生成旧资料快照，再检查文档数量、正文哈希及源文件是否变化。原件能读取则复制为哈希命名快照，缺失则保留已有正文并在报告中列出；不会自动重算现有课程向量。

使用步骤：

1. 上传文件或点击资料旁“处理/清洗”。新上传资料先处于待复核状态，不参与回答。
2. 打开“处理与清洗”，刷新任务并查看逐页类型、原始解析内容、候选正文、改动理由及警告。
3. 核对页码、数字、链接、OCR和复杂布局，可编辑候选正文、恢复清洗规则修改、排除有明确原因的页面。失败任务支持重试，密码只在单次任务内存中传递。
4. 点击“保存并确认已核对原件和警告”，再点击“建立候选索引并启用”。系统核验分片数量、编号、模型指纹及当前资料版本后，才一起启用正文与索引；失败保留现用版本。
5. 在“检索测试”验证自己的问题。代际列表可回退历史正文与索引；删除或启用状态已变化时拒绝自动回退。

本地规则包括：PDF原生文字和坐标提取、扫描页OCR、混合页候选图片OCR、异常页回退、双栏坐标候选排序、重复页眉页脚/页码候选移除、保守续行合并，以及可撤销的变更记录。PDF最多150页、单文件30MB。OCR方向判断为启发式，需人工核对。

边界：复杂表格单元格、公式LaTeX、图表含义和任意多栏版面尚不能保证自动还原；当前用警告与人工复核兜底。非PDF不生成虚假的PDF页码。修改正文后旧精确页码映射失效。任务中断后保留状态并人工重试，不声称已完成逐页断点续跑。未接入云端解析或多模态模型。

完整备份：退出桌面，`manage.py stop`，然后 `manage.py backup`，它复制全部数据（含原件与Chroma）及manifest。`library-maintenance.cjs backup` 只备份SQLite数据库，不含资产，不能代替完整备份。恢复必须同一时点恢复数据库、原件与向量数据并核对引用，先在副本演练。向量代际保留用于回退，不自动永久删除。

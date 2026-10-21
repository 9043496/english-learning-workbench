# English Learning Workbench · 英语学习工作台

**让你的 AI Agent 准备教材、制作音频、发布内容并反馈真实作答。** 你在浏览器里完成学习；教学工作由获授权的 Agent 按可移交的六个 Skill 执行。

这是完整 2.1 工作台的可移植发行版，支持本地 Python 服务，以及可选的 Cloudflare Pages＋Supabase 云端部署。安装后是空白学习空间，不附带原作者的个人教材库、答案、录音、账号或凭证。

## 交给你的 Agent 安装

将本仓库地址交给 Agent，并发送：

> 阅读这个仓库的 AGENTS.md，检查环境后为我安装并启动英语学习工作台，注册适合当前 Agent 的六个教学 Skill。保留我已有的配置，不覆盖同名技能；安装后验证健康检查和四个板块。先使用本地模式，教学内容制作前与我确认学习目标和语音服务授权。

Agent 入口是 [AGENTS.md](AGENTS.md)。定时任务每次新开对话也可以读取 [每日流程 Skill](skills/english-learning-daily/SKILL.md)，通过私有配置和运行记录恢复状态。Skill 本身不是调度器；请在你使用的 Agent 中另行授权和创建定时任务。

## 自己安装：一条命令启动

先下载/克隆本仓库，进入仓库目录，确保 Python **3.10+**，运行：

```bash
python3 scripts/install.py --skills auto --start
```

脚本创建当前用户自己的私有配置和初始学习画像，注册已经存在的 Codex／Claude／Hermes 宿主，然后在前台启动本地服务。终端会显示实际工作台地址，默认是 `http://127.0.0.1:8780/open-local`；保持终端运行，Ctrl+C 停止。无需 Node、Docker或云账号即可启动基础工作台。

只安装不启动：`python3 scripts/install.py`。以后启动：`python3 scripts/run.py --open`。检查环境：`python3 scripts/doctor.py`。

没有检测到宿主时仍可使用网页；用 `--skills codex`、`--skills claude`、`--skills hermes` 指定宿主，或 `--skills none` 跳过。已有不同来源的同名技能会报冲突，不会静默覆盖。注册使用指向此仓库的软链接，注册后不要移动/删除仓库。Windows 的软链接可能需要开发者模式或相应权限；本次发行仅在 macOS ARM64 实测，其他环境状态见 [验证说明](docs/validation.md)。

## 四个学习板块

| 板块 | 功能 |
|---|---|
| 今日学习 | 连续文章、点词释义与发音、句尾按钮播放句音/显示翻译/标记没懂、英文理解与语境选择题、旧词重逢、独立月度水平测试入口 |
| 跟读录音 | 点击即录音，3秒后播放参考；播完手动结束；提前结束丢弃当前遍；保存多遍录音及逐遍反馈 |
| 生词本 | 正文加词自动计入本篇、词汇抽查与造句、手动熟识、不同文章重逢记录、12篇自动熟识 |
| 学习进度 | 日常三信号/跟读趋势、学习记录、与日常趋势分开的月测结果 |

学习记录与录音先保存在设备。使用“上传学习数据”“下载学习数据”显式同步；教材只读。完成布尔字段OR合并、其他字段按时间合并，教练评分受保护，冲突可查。月测听力/阅读为选择题，口语为Part1/2/3，测试作答与结果独立保存。

`preview-2.0/`保留独立的故事听力与量化规则审核样板，**尚未接入默认生产数据链路**。不要把样板展示当作功能上线。

## 教学 Skill 如何衔接

`english-learning-daily` → `english-learning-coach` → `english-learning-materials` → `english-learning-audio` → `english-learning-publish` → `english-learning-feedback`。

先读取真实学习状态与用户画像，再选择有使用依据的人类分级文章；没有合适素材时使用教材写作备用流程并标明AI原创/改编。每篇包含正文、逐句翻译、全文语境词包、英文选择题与解析、真实全文/句音，旧词来自真实生词本。

音频按场景单独写提示词，生活对话自然克制；新风格先短试听。发布前校验真实词数、词包、题目结构、音频格式/解码/hash，发布后回读教材及音频；缺音频、鉴权、额度或批准时报告阻塞，不发布残缺包。评分只依据真实作答与可评估录音；没有量表或证据不编分。

初始教学画像参考A2、每天两篇/约两小时，用户可自行调整。熟识记录不等同教练判定掌握，识别错误不直接当发音错误。自动调难度和录音量化分档仍有待确认的阈值，不能将候选规则冒充已确定标准。

## 配置、数据与可选依赖

安装器输出私有 `config.json` 路径；程序不会把它提交到Git。

- macOS：`~/Library/Application Support/English Learning Workbench/`。
- Linux：`$XDG_DATA_HOME/english-learning-workbench/`，默认 `~/.local/share/english-learning-workbench/`。
- Windows：`%LOCALAPPDATA%/English Learning Workbench/`。

使用 `--private-dir` 可指定独立目录；重装保留已有配置和画像。配置结构见 [示例](workbench.config.example.json)，画像见 [示例](learner-profile.example.json)。Agent 工具通过 `WORKBENCH_CONFIG` 使用私有配置。

| 依赖 | 何时需要 |
|---|---|
| Python 3.10+ | 本地服务和安装器，使用标准库 |
| Node 22+ / npm | 前端测试、云端构建、Agent校验发布工具 |
| ffmpeg / ffprobe | 音频格式/解码检查、编码和切句 |
| 自己的 Gemini 或其他获授权语音服务 | 制作新的教材音频，可能有费用/额度限制 |
| Cloudflare / Supabase 自有账号 | 可选云端部署与多账号隔离 |

Gemini 脚本通过 `GEMINI_API_KEY` 或指向仓库外0600文件的 `GEMINI_API_KEY_FILE` 读取使用者自己的认证。`GEMINI_TTS_MODEL`可配置模型，生成前核对当前可用性、额度和费用；仓库不承诺免费语音或提供API Key。生成并不等于完成内容核听。

## iPhone、跨设备与云端

桌面本地模式默认只监听回环地址。iPhone远程访问与录音需要可信HTTPS：推荐在自己的 Pages＋Supabase 环境部署，详见 [云端部署](docs/cloud.md)。登录同一学习账号后，学完上传，另一设备下载。

本地启动不自动建立HTTPS、证书信任、Tailscale或后台常驻服务。云端已发布内容的访问与同步不依赖本机开机；若教学Agent运行在本机，关机后不会继续制作教材或批改。服务商免费额度、录音存储和带宽限制需要使用者监控。

## 开发与测试

```bash
npm ci
npm test
npm run test:integration
npm run test:skills
python3 -B -m unittest discover -s scripts/tests -v
python3 -B -m unittest discover -s local -p 'test_*.py' -v
cd cloud
npm ci
npm test
```

用例、执行环境与当前边界见 [验证说明](docs/validation.md)。Node/jsdom、模拟麦克风、合成音调与本机HTTP测试均为**非真机验证**，不能替代 iPhone Safari／Mac Chrome 的播放、录音与同步验收。

## 目录

`local/`本地SQLite与音频服务；`cloud/`Worker、SQL与隔离测试；`skills/`六个教学Skill；`scripts/`安装与启动；`docs/`规划、部署和验证；`preview-2.0/`独立审核样板。运行数据、认证、生成教材/音频及日志均不属于共享源码。

## 许可证与内容来源

项目代码采用 [MIT License](LICENSE)。第三方依赖保留各自许可证；外部文章、音频及用户生成内容不因使用本软件而自动取得转载许可，导入前须核对各自使用条件。

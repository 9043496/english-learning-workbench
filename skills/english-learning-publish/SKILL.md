---
name: english-learning-publish
description: 校验并增量发布学习者工作台完整日常学习包，使用现有教练权限回读记录和音频hash；含每日去重、并发锁与部分失败恢复，不部署网站或迁移学生库。
---

# 校验与正式发布

读取[交接契约](../english-learning-daily/references/workflow.md)、根AGENTS.md及docs/cloud.md。当前目标是完整2.1本地或用户自建云端，旧本机端口/128MB上限不适用。Skill脚本依赖既有项目ReadingLogic、内容校验器、Node与PATH上的ffmpeg；不另装服务或重置账号。

以下命令中node用`node`；相对命令路径按本Skill目录解释，所有输出路径按根README归档。设置WORKBENCH_CONFIG为当前使用者的私有config.json。工具按配置连接本地回环服务或使用者自己的cloud教练账号，不使用原作者身份，不读取管理员key。

## 读取真实状态

`node scripts/cloud-io.mjs snapshot --out <workspace_dir/_tmp下的私有快照.json>`

快照包含inputs/sentences与实际progress/vocab/shadowing，权限600；仅私有制作中使用，完成后删，不随教材公开。音频按每篇key读取，避免旧全库音频列表1000条上限。失败401/403是鉴权问题，不能写为“没有教材”或恢复默认演示数据。

## 校验

`node scripts/validate.mjs <lesson.json> [--text-only]`

使用当前前端实际词匹配器核对全文词包与语境，核对真实词数、句映射、英文题目结构、来源档案和文件路径。完整模式还检查全文/句音key、真实格式、大小、hash、ffprobe时长和ffmpeg解码，输出`技术校验.json`。text-only结果不能用于发布。

机器不能证明中文语义、唯一最佳答案、来源授权合法性或声音自然度；agent逐项核查并保存证据，不用一串布尔标志冒充判断。沿用已批准同类声音不必每天重新请求批准，新风格遵循声音Skill的试听要求。

## 发布和回读

`node scripts/cloud-io.mjs release --lesson <lesson.json>`

脚本重新校验实际文件；验证正式教练/学习者身份；同日锁；先读当天文章、相同ID和各音频key。已有不同JSON或不同音频hash则停止；同日已达两篇时拒绝额外发布。检查reused_vocab来自最新真实词库。上传缺少的私有音频后，一次导入本篇inputs+sentences；不发送学习记录或成绩，不写直连数据库。

成功必须回读全部字段（仅规范化服务端派生音频URL）、逐文件下载比对SHA256并探测媒体Range。输出`发布回读.json`；只有`PUBLISHED_VERIFIED`计入每日完成。写入后请求失败而状态不明，下一次先检查同ID和hash，不换ID重发，不删除已上传内容或学习历史。不得为了修复旧错误覆盖原input01或Mina。

只有暂时网络故障才有限重试；权限/冲突/配额/内容缺项立即记录原因。每次重跑先核对实际远端效果。锁遗留时先确认旧任务已退出再人工移除，不按时间自动夺锁。

## 验证结论

报告实际测试用例、环境、通过/失败和限制。脚本/合成音频/Node不是真机；发布回读通过表示资源与记录相等，不代表iPhone自然度、麦克风录音或跨设备全流程已经验收。下一步有真实作答时进入[反馈Skill](../english-learning-feedback/SKILL.md)。

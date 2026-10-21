# 跨Skill执行契约

2026-10-20，学习者要求将每日教学流程制成可衔接Skill。此文件是文件交接协议；教学标准仍在english-learning-coach，不能另写一份不同的教学大纲。

## 环境与权限

先运行仓库scripts/install.py，再读取返回的Git仓库外config.json；用WORKBENCH_CONFIG告诉agent工具其路径。mode为local或cloud，workspace_dir为私有工作区，profile_file是用户画像。不要使用原作者的地址/邮箱/UUID。完整配置和cloud部署见仓库AGENTS.md与docs/cloud.md。

本地Python服务保持运行；远端手机需要可信HTTPS。cloud读写使用该使用者的授权教练账号与learner_id，不能为了连通调用管理员直写或关闭RLS。单云文件25MB、800MB用户索引保留限制，不代表服务商总额度。调用有费用的语音服务前确认当次/定时授权范围。

## 唯一工作区

workspace_dir由当前用户配置。临时私有快照放workspace_dir/_tmp，成品放workspace_dir/YYYY-MM-DD/每日教材/文章ID/。日期使用用户time_zone，初始参考为Asia/Seoul。运行记录.json保存日期、ID、阶段、产物路径、hash、时间和结果，不含密钥或原始学生答案。

阶段为planned / materials_ready / audio_ready / checked / published_verified / blocked。首次确定ID后持久保存，重试保持同ID/key；每次仍回读远端，不能只相信上次聊天。正文变更使相关词包/题目/音频/证据过期；已发布ID不覆盖。使用者profile里的daily_articles为目标，当前发布工具保守限制每日两个默认编号；如需变更目标，先统一编号/限额校验，不只改文案。

## 每篇交接文件lesson.json

顶层仅用于制作，不直接作为`/api/import`请求。至少包含：

```json
{
  "version": 1,
  "input": {"id":"daily_YYYYMMDD_01", "date":"YYYY-MM-DD"},
  "sentences": {"id":"daily_YYYYMMDD_01", "items":[]},
  "source": {
    "kind":"human_original | human_adapted | ai_authored",
    "title":"实际来源标题", "url":"实际来源URL或AI时为空",
    "author":"可核实作者/机构或如实未知",
    "use_basis":"原文使用或改编依据，不能只写互联网公开可见",
    "checked_at":"实际核查时间", "adaptation_note":"改编/未改编/AI说明"
  },
  "teaching": {"selection_reason":"真实选材依据", "reused_vocab_evidence":[]},
  "audio": {
    "model":"实际模型", "voices":{"实际角色":"实际声线"},
    "style_family":"daily-low-key-v2或经批准的新风格",
    "style_approval_evidence":"学习者的真实确认出处/日期",
    "direction_file":"声音指导.md",
    "text_review_evidence":"实际全文与逐句内容核对的证据文件",
    "files":[{"key":"唯一音频key", "file":"assets/真实文件.mp3", "mime":"audio/mpeg", "sha256":"实际SHA256"}]
  }
}
```

示例只展示交接结构，不是可发布教材。input、sentences必须补齐当前正式schema：正文/wordpack/题目等；具体见工作台交付约定。所有相对文件路径限制在该篇目录内，不引用私有数据目录。
音频映射包含全文和每句的audioKey，一key对应一个实际文件；不能用同一段全文冒充全部句音。使用不同key复制同一音频也须由核对发现。语义、中文释义、答案和听感由agent实际核对，机器通过只证明结构/文件检查。

`audio-check.json`、`技术校验.json`、`发布回读.json`为不同证据，不能互相替代。发布回读含远端记录和音频hash实际比对；目标设备听感/麦克风验收另外记录，未执行写未执行。

## 旧词的来源冲突

教学基线允许词不足时按实数处理；当前云端`reused_vocab`存在时要求3–5条。不足3条时省略字段、在本日制作记录解释缺口，不填空数组/假词，也不发明新后端结构。下一篇基于最新真实词库再选，不批量把已知词加入词库凑数。

## 发布与失败恢复

使用发布Skill的脚本先读、后写、再回读。所有内容同ID不同值拒绝；源文件、现有音频key不覆盖。音频在JSON之前上传，JSON为事务；失败可留下未引用的新音频，记录key后重试复用，不为了回滚删除学习记录或整个bucket。
同日两篇为默认目标，工具不对当天追加第三篇；用户另有明确点单时另行对齐。两篇已存在但缺资源时先补相同版本的缺资源/核对，不通过另发ID掩盖坏包。对于历史同日文章和没有制作档案的内容，先核实可学习性再决定是否计数。

最多对暂时网络错误重试两次，每次先读远端确认实际效果。401/403、配额、不同内容同ID、来源授权和新声音风格待批准等不循环重试。记录阻塞，通知学习者；没有确定发布结果时标`needs_verification`，下一次先回读。

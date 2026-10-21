---
name: english-learning-audio
description: 按学习者已认可的场景声音标准制作教材全文及句音，保存提示词、声线与切句证据；处理音频缺项和新风格试听，不以技术通过代替听感认可。
---

# 教材声音制作

声音标准只维护在[声音设计指导](../english-learning-coach/references/audio-direction.md)，制作前必读。输入为materials Skill的`lesson.json`，交接格式见[执行契约](../english-learning-daily/references/workflow.md)。

## 授权与生成

先确认用户授权、当前模型、可用额度和付费边界。发布包不携带认证或个人凭证库。使用者通过环境变量GEMINI_API_KEY，或GEMINI_API_KEY_FILE指向Git仓库外的0600密钥文件提供自己的认证；不得把密钥写入源码、命令行参数、任务提示词或产物。没有可用认证就记录audio_credentials_unavailable，不能降级成机械音频冒充合格。环境变量本身不是计费或长期使用授权。

`scripts/generate_audio.py --day-dir <workspace下的YYYY-MM-DD/每日教材目录> --phase dry-run`先验证固定ID/hash请求清单；--phase full制作全文。请求清单结构见脚本的payload_for和main；agent先从实际lesson.json编写音频制作请求_无凭证.json，不能省略文件生成或把dry-run说成已生成。实际对齐优先从全文切句；确实不能可靠切句时记录原因，再使用--phase sentences补录。WORKBENCH_WORKSPACE_DIR指定允许输出的私有工作区，FFMPEG/FFPROBE指定可执行路径；默认使用PATH。GEMINI_TTS_MODEL可选择已确认可用的模型，生产前必须验证模型访问与实际额度。

初始声音提示词是原项目验证过的风格参考，不代表新使用者已试听批准。新用户先试听确认；确认后同类场景可复用，新文体/声音风格仍须短试听。旧getpass试听程序只作可选源码，不是无人值守生成器。

为每篇写专属`声音指导.md`，记录场景、人物关系、文体、情绪、实际完整提示词、模型及角色声线映射。已认可日常语气v2可直接按同类场景适配；“科普播音”等未获试听的新风格先做20–30秒样片，标`awaiting_style_approval`，批准前不自动完成整包发布。

读出正文原词，不读角色标签、说明、句号n或提示词，不加笑声、音乐或额外台词。用自然清楚的成人语速、连读弱读与普通回应停顿，避免夸张、唱腔、戏剧化。优先全文一次演绎；长文超过服务限制时保留同篇声线与声音指导并核对衔接，不用旧失败的系统合成/后期拉伸凑音频。

## 句音与内容核对

优先从同一次全文生成切出句音。时间边界由实际音频与文本对齐/监听得出，不按词数平均切割，不信任模型自己编的时间戳；逐句核对不吞词、不错位、无相邻句串入。需补录时记录原因和模型/声线一致性。

保存实际对齐或核听证据，包含每句n及时间段/核对结果；全文所有句子都要覆盖。自动转写可发现疑点，不直接当作原音字词已确认；没有可听音频或可靠分析工具时标未核对，不能将音频解码通过称为声音自然度通过。

保留真实扩展名/MIME和SHA256，不只改后缀；播放器调速与音频文件变速是两回事。没有完成且可解码的全文和每句资源不能进入发布。

## 交接

在lesson.json的audio中填写真实模型、voices、style_family、style_approval_evidence、direction_file、text_review_evidence和files[]。files列出实际本地相对路径/key/mime/hash。运行发布Skill完整技术检查，另存`audio-check.json`说明内容核对覆盖和技术/听感边界。

交给[发布Skill](../english-learning-publish/SKILL.md)。短试听认可、全文内容核对、文件技术检查、Mac Chrome/iPhone Safari验收分别记录；不复用“试听通过”填充后面三项。

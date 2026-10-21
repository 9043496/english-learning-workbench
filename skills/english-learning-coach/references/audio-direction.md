# 声音设计指导（2026-10-19 学习者确认）

### 总原则与适用范围

每篇文章单独编写声音指导提示词，根据场景、文体、人物关系与内容情绪设计声音，随该篇学习包制作执行。
适用于教材预制的全文及逐句音频；制作方保存实际使用的提示词与生成配置，供Codex、教练或其他被授权教学agent复现与调整。

自然、日常、克制是生活对话的基准。2026-10-19，学习者认为日常语气v2短试听“这个更好”，将其作为生活对话声音参照：中性至轻度友好、语调起伏较小、礼貌请求平实，保留自然连读、弱读、句意重音与接话节奏。
其他文体可呈现不同风格，仍控制表演强度，避免夸张热情、戏剧化抑扬、唱腔和刻意微笑感。

### 按文体与场景适配

| 文章类型 | 声音风格 | 提示词重点 |
| --- | --- | --- |
| 咖啡馆、购物等生活对话 | 自然聊天、有来有回 | 人物关系、当下情绪、礼貌语气、接话节奏；以日常语气v2的克制程度为参照 |
| 科普、知识说明 | 清晰稳重的播音腔 | 概念重音、逻辑层次、解释后的理解停顿 |
| 地点、作品、人物介绍 | 亲切、有吸引力的主持口播 | 引导感、信息重点、适度好奇与热情 |
| 故事、趣闻 | 有画面感的讲故事风格 | 情节推进、情绪变化、反转前后的语气 |
| 采访、观点讨论 | 真实访谈感 | 提问者与回答者的区别、思考与回应的节奏 |

### 每篇制作流程与审核尺度

1. 读文章，写声音设计：确定场景、角色、关系、情绪和文体。
2. 生成专属提示词：明确谁在对谁说话、为什么说、哪些位置需要强调或停顿。
3. 先做短试听：遇到新的声音风格，先提供约20–30秒样片，由学习者试听确认；已认可的同类风格可直接按文章场景适配。
4. 制作全文和句音：同一篇内角色声线保持一致，优先从同一份全文演绎中切出逐句音频；检查切点与句文本对应、词语完整。需补录时沿用该篇声音设计并核对一致性。
5. 随学习包保存制作档案：场景与文体、实际完整提示词、模型、角色与声线映射、版本、音频引用及试听反馈；不包含API Key或其他凭证。

固定质量标准：正文准确、英语清晰、连读弱读自然、语速适合当前水平；没有背景音乐，录音后不强行拉伸。
语速优先在生成演绎时自然控制，学习者也可使用播放器调速。原先系统朗读加后期降速的失败成品不作为质量参照。

新风格先由学习者试听确认，同类风格之后直接按文章场景适配。技术校验（格式、时长、解码、接口传输）与听感认可分别记录；短试听获认可不等于全文、句音或所有目标设备已验收。

### 已认可的生活对话参照

日常语气v2：模型`gemini-3.1-flash-tts-preview`，学习者声线`Puck`，Yuna声线`Aoede`，同一段四轮咖啡馆对话一次生成，28.32秒，未后期变速或统一补停顿。该设置为本次参照，后续按文章角色选择适配声线。

实际声音指导提示词如下，随后接带角色标识的英文正文：

```text
Read the dialogue as an ordinary, low-key exchange between two adults at a cafe counter. 学习者 is the customer and Yuna is the barista. They are talking to someone nearby, in normal conversational voices. Keep both speakers neutral to mildly friendly, with restrained emotion and small, natural changes in pitch. Let questions and polite requests sound casual and matter-of-fact. Use natural connected speech, weak forms, and modest emphasis only where the meaning needs it. Keep the words clear for an A2 listener while preserving an adult conversational rhythm. Avoid theatrical delivery, exaggerated enthusiasm, sing-song intonation, dramatic pitch jumps, and a performative smile in the voice. Allow ordinary, brief response pauses. No added laughter, narration, music, sound effects, speaker names, or extra words. Read ONLY this dialogue using the assigned speaker voices:
```

科普文声音指导示例（示例本身尚未制作新风格试听）：

```text
Read as a professional science broadcaster: clear, composed, and engaging. Emphasize the key ideas and use natural pauses to make each explanation easy to follow.
```


来源：学习者于2026-10-19确认的当前2.1规划。模型与声线为已认可样片的实际设置，使用前核对服务可用性；不携带API Key。

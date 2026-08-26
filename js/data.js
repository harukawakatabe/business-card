export const STANCES = {
  authority: {
    id: "authority",
    label: "权威",
    blurb: "少说话，让头衔和留白替你压场。",
    paper: "厚棉纸，凹凸印，近黑底或极深墨色",
    type: "衬线，名字很大，其余极小",
  },
  credible: {
    id: "credible",
    label: "专业可信",
    blurb: "像一份被收进西装内袋的文件，而不是一张广告。",
    paper: "本白无涂布纸，胶印，克制的一条色带",
    type: "无衬线中文 + 衬线英文名",
  },
  ambitious: {
    id: "ambitious",
    label: "锐意进取",
    blurb: "一眼能感到方向感：这个人在往前走。",
    paper: "深底，一条硬朗的强调色，不花",
    type: "紧凑无衬线，名字与职能同级强调",
  },
  warm: {
    id: "warm",
    label: "亲和开放",
    blurb: "让人愿意加你，而不是觉得被推销。",
    paper: "暖米色，圆角或柔和边，触感偏软",
    type: "居中，字距松，像请柬而不是工牌",
  },
  quiet: {
    id: "quiet",
    label: "低调实力",
    blurb: "什么都不炫耀，只留下能被找到的人。",
    paper: "纯白或浅灰，几乎无装饰，靠排版",
    type: "细字，左对齐，公司名可隐",
  },
  creative: {
    id: "creative",
    label: "创意个性",
    blurb: "让圈内人觉得你有品味，而不是在耍帅。",
    paper: "特种纸，不对称，一块大胆但单一的色",
    type: "名字可竖排或极大，其余让路",
  },
};

export const AUDIENCES = [
  {
    id: "recruiter",
    label: "招聘方",
    hint: "HR / 业务负责人 / 老板",
    cares: ["匹配", "可信", "可约到"],
  },
  {
    id: "client",
    label: "客户 / 甲方",
    hint: "买单或拍板的人",
    cares: ["能解决问题", "靠谱", "好联系"],
  },
  {
    id: "investor",
    label: "投资人 / 出资方",
    hint: "看局、看人、看能不能跟进",
    cares: ["判断力", "局", "下一步"],
  },
  {
    id: "partner",
    label: "合作方 / 渠道",
    hint: "要互补，不要抢戏",
    cares: ["互补", "资源", "怎么开始"],
  },
  {
    id: "peer",
    label: "同行 / 圈内人",
    hint: "混脸熟也要有立场",
    cares: ["品味", "立场", "可来往"],
  },
  {
    id: "vendor",
    label: "供应商",
    hint: "他们需要找对决策人",
    cares: ["身份边界", "决策人", "联系方式"],
  },
  {
    id: "media",
    label: "媒体 / 意见领袖",
    hint: "要能被引用的身份",
    cares: ["头衔", "故事切口", "可联系"],
  },
  {
    id: "institution",
    label: "政府 / 机构",
    hint: "正规、对口、可存档",
    cares: ["身份完整", "对口", "正式联系"],
  },
];

export const SCENES = [
  {
    id: "talk",
    label: "商务一对一",
    hint: "坐下来谈，名片是开场的物证",
    formality: 0.7,
    density: 0.6,
  },
  {
    id: "banquet",
    label: "商务宴请",
    hint: "饭桌上，字太多等于没人看",
    formality: 0.8,
    density: 0.32,
  },
  {
    id: "conference",
    label: "行业大会",
    hint: "三秒扫视，远一点也要能认",
    formality: 0.55,
    density: 0.72,
  },
  {
    id: "interview",
    label: "面试 / 人才沟通",
    hint: "对方会把这张卡和你的履历对上",
    formality: 0.75,
    density: 0.62,
  },
  {
    id: "pitch",
    label: "路演 / 融资场合",
    hint: "会后被翻出来，要记得你是谁",
    formality: 0.7,
    density: 0.5,
  },
  {
    id: "visit",
    label: "客户拜访",
    hint: "进门递上，代表你所属的组织",
    formality: 0.85,
    density: 0.58,
  },
  {
    id: "salon",
    label: "沙龙 / 酒会",
    hint: "噪声大、光线暗、口袋小",
    formality: 0.35,
    density: 0.38,
  },
];

export const PURPOSES = [
  {
    id: "job",
    label: "求职 / 找下家",
    hint: "让对方觉得值得约下一次",
    energy: 0.65,
  },
  {
    id: "deal",
    label: "谈生意 / 推进成交",
    hint: "降低继续聊的摩擦",
    energy: 0.5,
  },
  {
    id: "partner",
    label: "找合作伙伴",
    hint: "说清你带来什么、要什么",
    energy: 0.55,
  },
  {
    id: "fundraise",
    label: "融资 / 找资源",
    hint: "被当成一个局，而不是一份简历",
    energy: 0.8,
  },
  {
    id: "network",
    label: "建人脉",
    hint: "被记住，并且愿意加",
    energy: 0.4,
  },
  {
    id: "negotiate",
    label: "谈判 / 博弈",
    hint: "对等、可追溯、不亲昵",
    energy: 0.28,
  },
  {
    id: "authority",
    label: "建立专业权威",
    hint: "以后提到这个领域会想起你",
    energy: 0.45,
  },
];

export const STAGES = [
  {
    id: "employed",
    label: "在职 · 稳定履职",
    hint: "对外就是这个组织的人",
    stealth: false,
    company: "show",
  },
  {
    id: "stealth",
    label: "在职 · 悄悄看机会",
    hint: "卡不能把现公司卷进去",
    stealth: true,
    company: "hide",
  },
  {
    id: "seeking",
    label: "求职中",
    hint: "已公开或不需遮掩",
    stealth: false,
    company: "past",
  },
  {
    id: "founder",
    label: "创业 / 创始人",
    hint: "你就是那家公司的脸",
    stealth: false,
    company: "show",
  },
  {
    id: "independent",
    label: "独立顾问 / 自由职业",
    hint: "身份靠能力，不靠工牌",
    stealth: false,
    company: "hide",
  },
  {
    id: "transition",
    label: "转型期",
    hint: "旧身份未卸，新身份未稳",
    stealth: false,
    company: "careful",
  },
];

export const QUESTIONS = [
  {
    id: "audience",
    n: "01",
    title: "这份身份要递给谁",
    lead: "对方是谁，决定你该被看成谁。名片不是自我介绍，是给对方的一个抓手。",
  },
  {
    id: "scene",
    n: "02",
    title: "在什么场合递出去",
    lead: "大会上的三秒扫视，和饭桌上隔着酒杯递过去，不是同一张卡。",
  },
  {
    id: "purpose",
    n: "03",
    title: "你希望相遇之后发生什么",
    lead: "求职、谈成一单、留下一个微信——目的不同，卡上该出现的字就不同。",
  },
  {
    id: "stage",
    n: "04",
    title: "你现在处于哪一段",
    lead: "在职悄悄看机会，和已经公开求职，能印上去的东西不一样。",
  },
  {
    id: "profile",
    n: "05",
    title: "你是谁（可空）",
    lead: "材料是原料，不是名片本身。空着也能先出策略；有名字，卡才能真正递得出去。",
  },
];

export const DEMO = {
  audience: "client",
  scene: "visit",
  purpose: "deal",
  stage: "employed",
  profile: {
    name: "陈予安",
    nameEn: "Yuan Chen",
    title: "商务负责人",
    company: "北境咨询",
    pitch: "",
    phone: "138 0013 8000",
    wechat: "chenyuan_biz",
    email: "yuan.chen@example.com",
    website: "bejing.example",
    city: "上海",
    portrait: "",
    attachmentName: "",
  },
};

export const EMPTY_PROFILE = {
  name: "",
  nameEn: "",
  title: "",
  company: "",
  pitch: "",
  phone: "",
  wechat: "",
  email: "",
  website: "",
  city: "",
  portrait: "",
  attachmentName: "",
};

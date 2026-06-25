import { Archive, BookOpen, CheckCircle2, FileText, Lightbulb, ListTree, PenLine, Settings, ShieldCheck, Users } from "lucide-react";

type TutorialImage = { src: string; caption: string };
type TutorialGroup = { title: string; items: string[]; images?: TutorialImage[] };

const image = (name: string, caption: string): TutorialImage => ({
  src: `/tutorial/${name}`,
  caption,
});

const QUICK_START = [
  "先创建一本书，填写书名并点击创建，进入操作页面。书名之后可以随时修改。",
  "进入大纲，依次设定世界观、人物关系、剧情走向。",
  "剧情走向是必须创建的部分，写作台的卷章树会由剧情走向自动创建。",
  "进入写作台后，按章节使用 AI 写文、去味、精修、排版和定稿。",
  "定稿后到设置里的快照管理确认快照是否创建成功。",
];

const QUICK_IMAGES = [
  image("image1.png", "创建作品并填写书名"),
  image("image2.png", "进入大纲并设定世界观、人物关系、剧情走向"),
];

const SECTIONS: Array<{ icon: typeof ListTree; title: string; groups: TutorialGroup[] }> = [
  {
    icon: ListTree,
    title: "世界观",
    groups: [
      {
        title: "创建世界观词条",
        items: [
          "在大纲-世界观画布中展开右侧 AI 助手，把已有世界观信息粘贴到聊天框，也可以直接和 AI 讨论。",
          "输入“创建世界观词条”，等待回复。聊天框出现卡片信息，说明已经正确创建。",
          "点击“插入词条”后选择区域，词条插入后可以在画布中随意拖动位置。",
        ],
        images: [
          image("image3.png", "让 AI 助手创建世界观词条"),
          image("image4.png", "聊天框出现世界观词条卡片"),
          image("image5.png", "点击插入词条并选择区域"),
        ],
      },
      {
        title: "四个区域",
        items: [
          "核心规则区：写作台每次 AI 生成文章时都会加载这里的所有世界观词条。不要放太多规则，否则会大量占用上下文。",
          "词条锁定区：写作台 AI 绝不会知道这里的内容，适合放暂时不能透露的伏笔和真相。",
          "当前创作区：当前写作进度可能涉及到的世界观，AI 会自主选择使用。",
          "其他区：权重较低的世界观词条，会根据 AI 在创作区选择的词条匹配高相关内容。",
        ],
      },
      {
        title: "区域勾选规则",
        items: [
          "右侧 AI 助手会实时读取你勾选区域中的世界观词条，包括锁定区。",
          "写作台 AI 和右侧 AI 助手的逻辑不同：写作台会完整加载核心规则区，按需选择当前创作区，匹配其他区，绝不会读取锁定区。",
          "如果世界观词条很多，不要一直勾选所有区域，否则会大量消耗 token。",
          "如果 AI 助手没有按要求创建词条，可以补充提示词：“严格按照世界观模板输出在正文中”。",
        ],
        images: [
          image("image6.png", "区域名称栏的勾选规则"),
          image("image7.png", "勾选区域后对应区域高亮并被 AI 助手读取"),
        ],
      },
    ],
  },
  {
    icon: Users,
    title: "人物关系",
    groups: [
      {
        title: "创建人物关系",
        items: [
          "在大纲-人物关系画布中展开右侧 AI 助手，把已有人物关系粘贴到聊天框，也可以直接和 AI 讨论。",
          "输入“创建人物关系词条”，等待回复。聊天框出现卡片信息，说明已经正确创建。",
          "创建人物关系必须处于大纲-人物关系画布。如果 AI 没有创建角色，可以补充提示词：“严格按照人物关系模板在正文输出”。",
        ],
        images: [
          image("image8.png", "让 AI 助手创建人物关系词条"),
          image("image9.png", "聊天框出现人物关系卡片"),
        ],
      },
      {
        title: "人物快照与角色卡",
        items: [
          "人物快照用于记录角色信息随年龄动态变化。",
          "核心提示词示例：“帮我创建 XXX（姓名）XX 岁的人物快照”。",
          "聊天框出现快照提示后，点击“应用一个快照”，角色卡出现切换页面代表成功。",
          "可以继续和 AI 对话，让 AI 按你给的信息完善角色卡，或自由发挥完善角色卡。",
        ],
        images: [
          image("image10.png", "创建指定年龄的人物快照"),
          image("image11.png", "聊天框出现快照提示"),
          image("image12.png", "应用快照后角色卡出现切换页面"),
          image("image13.png", "让 AI 完善角色卡"),
          image("image14.png", "角色卡完善后的示例"),
        ],
      },
      {
        title: "区域规则",
        items: [
          "锁定区：无论是否选中，写作台 AI 都无法读取该区域角色。选中时，右侧 AI 助手会实时读取；未选中则不读取。",
          "展示区：无论是否选中，写作台都能读取该区域角色。选中时，右侧 AI 助手会实时读取；未选中则不读取。",
          "修改人物关系时需要勾选对应区域，修改完成建议取消勾选，节省 token 消耗。",
        ],
        images: [image("image15.png", "人物关系区域勾选与读取规则")],
      },
    ],
  },
  {
    icon: PenLine,
    title: "剧情走向",
    groups: [
      {
        title: "创建剧情走向",
        items: [
          "把剧情走向文字信息发给右侧 AI 助手，让它帮助创建；也可以先和 AI 讨论，确定后再让它整理创建。",
          "也可以手动创建剧情走向，再让 AI 完善。",
          "出现紫色插入图标代表创建成功。",
          "创建剧情走向必须处于大纲-剧情走向画布。如果 AI 没有创建卷落词条，可以补充提示词：“严格按照卷落模板在正文输出”。",
        ],
        images: [
          image("image16.png", "让 AI 助手创建剧情走向"),
          image("image17.png", "紫色插入图标表示创建成功"),
        ],
      },
      {
        title: "创建和调整细纲",
        items: [
          "把细纲发给 AI 助手，也可以和 AI 讨论后生成。",
          "提示词示例：“为 XXX 卷创建细纲”。生成后点击插入即可。",
          "长按细纲卡片可以拖动位置；也可以用细纲卡片上的移动按钮调整顺序。",
          "点击卷落词条中间的指向图标可以展开细纲，点击加号可以添加细纲。",
        ],
        images: [
          image("image18.png", "创建卷落细纲"),
          image("image19.png", "细纲成功插入后的示例"),
          image("image23.png", "展开细纲并添加细纲条目"),
        ],
      },
      {
        title: "连线与时间线",
        items: [
          "剧情走向词条的连线方向决定卷章顺序。",
          "起点表示故事的起点，间隔是数轴时间间隔。",
          "可以手动添加明线或暗线段落。",
          "绿色加号图标会创建虚线分割线，用于更好划分卷落时间线。虚线可以长按拖动，双击删除。",
          "如果有对应明暗线，建议按上下连接方式连接，这会更好辅助 AI 创作。",
        ],
        images: [
          image("image20.png", "连线方向决定卷章顺序"),
          image("image21.png", "剧情走向连线示例"),
          image("image22.png", "起点、明暗线段落和虚线分割线"),
          image("image24.png", "明暗线按上下方式连接"),
        ],
      },
    ],
  },
  {
    icon: BookOpen,
    title: "写作台",
    groups: [
      {
        title: "章节写作流程",
        items: [
          "点击加号创建章节。",
          "点击 AI 写文，开始写本章并选择参数。",
          "推荐顺序：AI 写文、AI 去味、AI 精修、排版、确认没有问题后定稿保存。",
          "定稿保存按钮可以在确认前用于保存当前状态；真正决定定稿前，建议先保存一下。",
        ],
        images: [
          image("image25.png", "点击加号创建章节"),
          image("image26.png", "点击 AI 写文开始写本章"),
          image("image27.png", "选择写作参数"),
          image("image28.png", "写作台操作栏推荐顺序"),
        ],
      },
      {
        title: "框选弹窗与素材",
        items: [
          "AI 写作工具需要框选正文后才会弹出弹窗。",
          "素材文本权重最高，勾选参考素材后会完全按照素材创作。",
          "定稿每次都会调用一次 AI，对整书做质量检查、角色分析、角色预测和世界观预测，会消耗较多 token。最好确定本章要定稿后再执行。",
        ],
        images: [
          image("image29.png", "框选正文后弹出 AI 写作工具"),
          image("image30.png", "勾选参考素材后素材权重最高"),
          image("image31.png", "定稿会触发整书质量与设定分析"),
        ],
      },
    ],
  },
  {
    icon: ShieldCheck,
    title: "故事圣经",
    groups: [
      {
        title: "核心模块",
        items: [
          "风格指南中建议填写“写作红线”，它的权重占比高。",
          "当 token 预算不足时，会优先截断叙述风格，其次是文笔基调。",
          "AI 会自动读取前一章整体风格，所以叙述风格和文笔基调可以简写。",
          "故事铁则可以自动分析，也可以手动补充。",
        ],
        images: [
          image("image32.png", "风格指南与写作红线"),
          image("image33.png", "故事铁则自动分析与手动补充"),
        ],
      },
      {
        title: "角色语言与上下文",
        items: [
          "角色语言可以分析全部已经出场的角色，也可以用来判断角色风格是否跑偏。",
          "上下文编辑器是非常重要的部分，可以随时查看发给写作台 AI 的上下文。",
          "如果上下文内容出错，你可以在上下文编辑器中自由修改。",
        ],
        images: [
          image("image34.png", "角色语言分析"),
          image("image35.png", "上下文编辑器用于查看和修正写作上下文"),
        ],
      },
    ],
  },
  {
    icon: Lightbulb,
    title: "灵感",
    groups: [
      {
        title: "随时记录",
        items: ["灵感部分用于随时添加你自己的灵感。"],
      },
    ],
  },
  {
    icon: Archive,
    title: "素材",
    groups: [
      {
        title: "上传与引用",
        items: [
          "可以上传自己的素材。",
          "如果写作时要参考素材，最好先点击分析结构。",
          "提前分析结构后，选择参考素材时就不用再次分析，可以加快生成。",
        ],
        images: [image("image36.png", "素材上传、分析结构和引用")],
      },
    ],
  },
  {
    icon: Settings,
    title: "设置",
    groups: [
      {
        title: "快照与诊断",
        items: [
          "最主要的是查看快照管理。定稿之后会创建一个快照，需要检查是否成功创建。",
          "如果没有成功创建，可以手动创建。",
          "诊断日志系统可以用于检查 bug、导出错误日志和操作日志。",
        ],
        images: [
          image("image37.png", "快照管理用于确认定稿快照"),
          image("image38.png", "诊断日志用于检查问题和导出日志"),
        ],
      },
    ],
  },
];

function ScreenshotGrid({ images }: { images?: TutorialImage[] }) {
  if (!images?.length) return null;

  return (
    <div className="mt-3 grid gap-3">
      {images.map((item) => (
        <figure key={item.src} className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <img src={item.src} alt={item.caption} loading="lazy" className="w-full bg-slate-100 object-contain" />
          <figcaption className="border-t border-slate-100 px-3 py-2 text-xs leading-5 text-slate-500">{item.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export function TutorialModule() {
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <BookOpen className="h-5 w-5 text-amber-700" />
              执笔详细使用教程
            </h1>
            <p className="mt-1 text-sm text-slate-500">从创建作品到写作、定稿、快照和诊断的完整流程。</p>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            <FileText className="h-3.5 w-3.5" />
            设置下方入口
          </div>
        </div>

        <section className="mb-6 rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              快速开始
            </h2>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(320px,1fr)]">
            <ol className="divide-y divide-slate-100 rounded-md border border-slate-100 bg-slate-50">
              {QUICK_START.map((text, index) => (
                <li key={text} className="flex gap-3 px-4 py-3 text-sm text-slate-600">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-amber-50 text-xs font-semibold text-amber-700">{index + 1}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
            <ScreenshotGrid images={QUICK_IMAGES} />
          </div>
        </section>

        <div className="space-y-5">
          {SECTIONS.map(({ icon: Icon, title, groups }) => (
            <section key={title} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <Icon className="h-4 w-4 text-amber-700" />
                <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-2">
                {groups.map((group) => (
                  <div key={group.title} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                    <h3 className="mb-2 text-xs font-semibold text-slate-700">{group.title}</h3>
                    <ul className="space-y-2">
                      {group.items.map((item) => (
                        <li key={item} className="flex gap-2 text-sm leading-6 text-slate-600">
                          <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                    <ScreenshotGrid images={group.images} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

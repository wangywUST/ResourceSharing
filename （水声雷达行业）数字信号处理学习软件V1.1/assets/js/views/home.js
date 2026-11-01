/* =============================================================
   views/home.js —— 软件首页（概览 / 板块入口 / 学习路线 / 最近访问）
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  const SECTIONS = [
    {
      id: 'theory', icon: '📘', title: '知识理论库', color: 'blue',
      desc: '从信号分类、采样定理到八大变换、滤波、谱估计、阵列信号处理，由浅入深成体系。每个知识点讲清「解决什么问题、物理含义是什么、工程上怎么踩坑」。',
      items: ['基础模块 6 节', '核心变换 9 节', '滤波算法 7 节', '谱估计 3 节', '随机信号 4 节', '阵列基础 3 节']
    },
    {
      id: 'lab', icon: '🎛️', title: '交互式仿真实验台', color: 'orange',
      desc: '学完立刻动手：拖动滑块、改窗函数、调信噪比，波形与频谱实时更新，并同步给出「为什么画面会这样变」的文字解读。',
      items: ['采样与混叠', 'DFT/FFT 栅栏与泄漏', '窗函数对比', '蝶形运算动画', 'STFT 时频权衡', '零极点拖动', '卷积动画', 'FIR 设计', '匹配滤波', 'MUSIC 谱估计']
    },
    {
      id: 'cases', icon: '📡', title: '工程案例库', color: 'teal',
      desc: '声呐与雷达两条真实处理链路：背景 → 信号模型 → DSP 原理 → 流程图 → 交互仿真 → 工程局限，回答「这里为什么要用这个算法」。',
      items: ['主动声呐脉冲压缩', '被动声呐线谱提取', '波束形成与方位估计', '多波束测深/侧扫去噪', '多普勒补偿与积累', '雷达 LFM 脉压', 'MTI/MTD', 'CFAR 检测', 'FMCW 测距测速']
    },
    {
      id: 'formula', icon: '∑', title: '公式手册', color: 'purple',
      desc: '全量 DSP 核心公式，每条配三件套：通俗解读 + 逐变量说明 + 工程代入算法；标注前提假设与「哪些近似在工程里经常不成立」。',
      items: ['基础/变换/滤波', '谱估计/阵列', '雷达声呐专用', '按名称与行业标签检索']
    },
    {
      id: 'quiz', icon: '✏️', title: '自测习题', color: 'green',
      desc: '概念辨析、参数选择、计算题、工程判断题，做完即给答案与原理解析，适合课后自测与课堂抽测。',
      items: ['概念辨析', '参数选择', '计算题', '工程判断']
    },
    {
      id: 'resource', icon: '📚', title: '资源附录', color: 'blue',
      desc: '误区专栏（专治混淆 DTFT/DFT/FFT、线性/循环卷积等）、三套学习路线、符号约定表、参数对照表、参考文献与开源工具。',
      items: ['误区专栏', '三条学习路线', '符号与参数表', '文献与工具']
    },
    {
      id: 'toolbox', icon: '🧰', title: '工具箱', color: 'orange',
      desc: 'Python/MATLAB 示例代码（与网页仿真一一对应）、wav 信号上传分析、算法横向对比实验、术语词典。',
      items: ['代码示例库', 'wav 上传分析', '对比实验', '术语词典']
    }
  ];

  const ROUTES = [
    {
      title: '① 本科生入门路线', for: '零基础 / 正在上 DSP 课', color: 'chip blue',
      steps: ['theory/basic/signal-class', 'theory/basic/sampling', 'theory/transform/dtft', 'theory/transform/dft', 'theory/transform/fft', 'theory/filter/conv', 'theory/filter/fir', 'theory/spectrum/classical'],
      note: '先建立「时域—频域」直觉，再进算法。每章做完立刻去实验台拖一拖参数。'
    },
    {
      title: '② 教师课堂演示路线', for: '备课 / 课堂演示', color: 'chip orange',
      steps: ['lab/sampling', 'lab/dft', 'lab/window', 'lab/stft', 'lab/conv', 'resource/pitfalls', 'quiz/concept'],
      note: '直接投屏实验台：先讲 30 秒原理，再用滑块把现象"演"出来，最后用误区专栏收尾。'
    },
    {
      title: '③ 雷达/声呐工程师进阶路线', for: '工程查阅 / 算法原理验证', color: 'chip teal',
      steps: ['theory/random/matched', 'cases/sonar/pulse-compression', 'cases/radar/pulse-compression', 'cases/radar/mti-mtd', 'cases/radar/cfar', 'theory/spectrum/subspace', 'cases/sonar/beamforming', 'toolbox/code'],
      note: '围绕「发射波形 → 信道 → 接收处理链 → 检测」主线，重点看处理增益、分辨力与工程约束。'
    }
  ];

  const APP = DSP.APP || { name: '数字信号处理知识学习实践系统', version: 'V1.1', sloganParen: '' };

  DSP.router.register('home', {
    title: APP.name,
    lede: '面向高校师生与雷达/声呐工程师的在线学习平台：**理论讲解 + 可交互动态仿真 + 真实工程案例 + 带解读的公式库**。全部功能在浏览器本地运行，无需后端、无需联网。',
    head: true,
    pager: false,
    render: function (el) {
      /* ---------------- 板块卡片 ---------------- */
      el.appendChild(h('h2', { style: { fontSize: '18px', margin: '0 0 12px' } }, '六大板块 + 工具箱'));
      el.appendChild(h('div.grid.g2', {}, SECTIONS.map(s => {
        // 直接从导航树取真实子项，保证入口永不过期
        const node = DSP.nav.NAV.filter(n => n.id === s.id)[0];
        const kids = (node && node.children) ? node.children : [];
        const quick = kids.slice(0, 3);
        const card = h('div.card', {}, [
          h('div.card-hd', {}, [
            h('span.accent-bar'),
            h('a', {
              href: '#/' + s.id, style: { textDecoration: 'none', color: 'inherit' },
              text: s.icon + ' ' + s.title
            }),
            h('span.chip.teal', { style: { marginLeft: 'auto' }, text: kids.length ? kids.length + ' 个入口' : '' })
          ]),
          h('div.card-bd', {}, [
            h('p', { class: 'small', html: U.md(s.desc) }),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '8px 0 12px' } },
              s.items.map(i => h('span.chip', { text: i }))),
            quick.length ? h('div', {
              style: { fontSize: '12.5px', color: 'var(--text-dim)', marginBottom: '10px', lineHeight: '1.9' }
            }, [
              h('span', { style: { color: 'var(--text-faint)' }, text: '直达：' }),
              ...quick.map((c, i) => h('span', {}, [
                i ? h('span', { style: { color: 'var(--text-faint)' }, text: ' | ' }) : null,
                h('a', { href: '#/' + c.id, text: c.title })
              ]))
            ]) : null,
            h('div.btn-row', {}, [
              h('a.btn.primary.sm', { href: '#/' + s.id, text: '进入板块 →' })
            ])
          ])
        ]);
        return card;
      })));

      /* ---------------- 学习路线 ---------------- */
      el.appendChild(h('h2', { style: { fontSize: '18px', margin: '28px 0 12px' } }, '三套学习路线'));
      el.appendChild(h('div.grid.g3', {}, ROUTES.map(r => h('div.card', {}, [
        h('div.card-bd', {}, [
          h('div', { style: { fontWeight: '680', color: 'var(--text-strong)', marginBottom: '4px' } }, r.title),
          h('div', {}, h('span', { class: 'chip ' + r.color.replace('chip ', ''), text: r.for })),
          h('p.small.dim', { style: { marginTop: '8px' }, text: r.note }),
          h('ol', { style: { paddingLeft: '18px', margin: '8px 0 0', fontSize: '13px' } },
            r.steps.map(sp => {
              const it = DSP.nav.byPath[sp];
              return h('li', {}, h('a', { href: '#/' + sp, text: it ? it.title : sp }));
            }))
        ])
      ]))));

      /* ---------------- 最近访问 ---------------- */
      const recent = U.store.get('recent', []) || [];
      const mine = recent.filter(p => p !== 'home').slice(0, 6);
      if (mine.length) {
        el.appendChild(h('h2', { style: { fontSize: '18px', margin: '28px 0 12px' } }, '继续上次学习'));
        el.appendChild(h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
          mine.map(p => {
            const it = DSP.nav.byPath[p];
            return h('a.btn.sm', { href: '#/' + p, text: (it ? it.title : p) });
          })));
      }

      /* ---------------- 使用说明 ---------------- */
      el.appendChild(h('h2', { style: { fontSize: '18px', margin: '28px 0 12px' } }, '怎么用'));
      el.appendChild(h('div.grid.g2', {}, [
        UI.callout('tip', '给学生的用法',
          '理论页读原理 → 立刻点右侧「相关实验」进实验台拖滑块 → 回到习题自测。\n\n遇到看不懂的公式，点公式卡片里的「变量说明」逐项对照；推导过程默认折叠，需要时再展开。'),
        UI.callout('eng', '给工程师的用法',
          '直接进工程案例库看处理链路与约束，或进公式手册按行业标签检索公式。\n\n公式卡片里的「工程提醒」专门标注哪些前提假设在真实系统里不成立（如白噪声假设、均匀线阵假设、远场假设）。'),
        UI.callout('note', '给教师的用法',
          '课堂上直接投屏实验台，边讲边调参数。\n\n顶栏可切换深色模式适配投影环境；任意页面可导出 Markdown 作为讲义。'),
        UI.callout('warn', '数据隐私说明',
          '所有笔记与实验参数保存在**本机浏览器**（localStorage），不会上传服务器。\n\n上传的 wav 数据仅在本地解析，刷新页面即释放。清理浏览器数据会一并清除笔记，重要内容请及时导出。')
      ]));

      /* ---------------- 版本与自检入口 ---------------- */
      el.appendChild(h('div.hr'));
      el.appendChild(h('div', { class: 'small dim', style: { lineHeight: '1.9' } }, [
        h('div', {}, [
          h('strong', { text: APP.name + ' ' + APP.version }),
          h('span', { text: '　' + APP.sloganParen })
        ]),
        h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' } }, [
          h('span', { text: '浏览器要求：Chrome / Edge 90+' }),
          h('span', { text: '·' }),
          h('a', { href: '#/dev/framework', text: '框架自检页（渲染与绘图验证）' }),
          h('span', { text: '·' }),
          h('a', { href: '#/resource/roadmap', text: '学习路线' }),
          h('span', { text: '·' }),
          h('a', { href: '#/resource/pitfalls', text: '误区专栏' })
        ])
      ]));
    }
  });
})(window);

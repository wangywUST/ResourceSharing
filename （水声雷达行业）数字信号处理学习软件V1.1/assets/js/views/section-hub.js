/* =============================================================
   section-hub.js —— 板块总览页（自动为每个「分组节点」生成 landing page）

   背景 / 修的 Bug：
     导航树里的分组节点（如 #/theory、#/lab、#/cases/sonar、#/toolbox）
     从来没有注册过视图，以前点进去会落到一句「该模块正在建设中」的兜底页，
     用户以为软件没做完、也不知道怎么往下走。

   解决办法：
     扫描导航树，凡是有子节点的分组，自动注册一个总览页：
       板块说明 + 全部章节卡片（含每节一句话摘要）+ 推荐入口 + 相关实验台。
     这样一来首页「六大板块 + 工具箱」的每个「进入板块 →」都有真实内容。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  /* ------------------------------------------------------------
     各板块的一句话定位（没写到的自动兜底）
     ------------------------------------------------------------ */
  const DESC = {
    'theory': '从「信号是什么」一路讲到「阵列怎么测向」，每一节都回答三件事：解决什么问题、物理含义是什么、工程上在哪里会失效。建议按顺序读，每读完一节就去对应实验台拖一拖参数。',
    'theory/basic': '整个 DSP 的地基：信号分类、采样、量化、信噪比、窗函数。这五节不过关，后面所有算法都会变成背公式。',
    'theory/transform': '本软件篇幅最大的一块。核心主线请记住：**FFT 是 DFT 的快速算法，DFT 是 DTFT 的频域采样，DTFT 是 Z 变换在单位圆上的特例**——它们不是并列关系，而是一条链。',
    'theory/filter': '从卷积出发，讲清 FIR 为什么能线性相位、IIR 为什么能用低阶换陡峭滚降、窗函数法与双线性变换各自改变了什么、以及吉布斯现象为什么消不掉。',
    'theory/spectrum': '谱估计的本质是「用有限数据在分辨率与方差之间做交易」。经典法稳但糊，参数模型锐利但怕模型失配，子空间方法能超分辨但怕相干源和幅相误差。',
    'theory/random': '工程里真正难的不是算法，是噪声。这一块讲相关函数、功率谱密度、色噪声，以及在噪声背景下唯一最优的线性处理器——匹配滤波。',
    'theory/array': '阵列信号处理的入门三件套：波束形成怎么"指"、栅瓣为什么会出现、孔径凭什么决定分辨力。学完再看 MUSIC 才知道超分辨超在哪里。',
    'lab': '十个可以当场动手的仿真实验台。每个实验台都是「左侧调参 — 右侧出图 — 下方实时解读」三段式：解读文字会跟着参数变化讲清"画面为什么变成这样"，参数还会写进网址方便直接分享复现。',
    'cases': '声呐与雷达两套真实装备级处理链路，统一六段式：工程背景 → 信号模型 → 用到的 DSP 原理 → 完整流程图 → 可调参交互仿真 → 工程局限与排错。这一块是课堂上最容易被学生问"学这个到底干嘛用"的答案。',
    'cases/sonar': '水声专场：主动脉冲压缩、被动 LOFAR/DEMON 线谱提取、拖曳阵波束形成与方位估计、多波束测深与侧扫去噪、水下多普勒补偿与积累。注意水声多普勒比雷达严重十万倍量级，很多雷达经验不能直接搬。',
    'cases/radar': '雷达专场：LFM 脉压（含去斜处理）、MTI/MTD 多普勒滤波组、CFAR 恒虚警检测（CA/GO/SO/OS）、FMCW 差拍测距测速与解耦。每条链路都配了真实的杂波、模糊与损失约束。',
    'formula': '全量 DSP 公式手册。每条公式除了数学式本身，还配四项工程信息：通俗解读、逐变量说明（含单位与典型取值）、代入步骤、**工程失效场景**（哪些前提假设在真实系统里不成立）。支持按名称、英文名、行业标签检索。',
    'quiz': '四类自测：概念辨析、参数选择、计算题、工程判断。做完立即判分并给出原理解析（会讲清其它选项错在哪），错题可一键存入笔记。适合课后自测与课堂抽测。',
    'resource': '附录区。其中「误区专栏」是本站最值得反复读的一页——它专门治那些"书上都写了但工程上还是会踩"的坑，比如把 DTFT/DFT/FFT 当成三种并列变换、 forgetting 循环卷积要补零、把 MUSIC 伪谱的 dB 值当功率读。',
    'toolbox': '四个实用工具：Python/MATLAB 示例代码库（与网页默认状态一一对得上）、本地 wav 上传分析（时域选区 / 加窗谱 / STFT 时频图 / FIR 滤波对比 / CSV 导出）、三组算法横向对比实验、术语词典。'
  };

  /* 每个板块的额外提示（工程 / 教学侧重点） */
  const TIPS = {
    'theory': ['tip', '怎么读最省力', '每节先读「这一节解决什么问题」的导语，再挑着看折叠推导；公式不必一次全啃，遇到卡住的先去对应的交互实验台把现象看明白，回来看公式会快得多。'],
    'theory/transform': ['danger', '最容易混淆的一条线', '请务必分清：Z 变换定义在 z 平面（有无穷多个可能 ROC），DTFT 是它在单位圆上的取值，DFT 是把单位圆等间隔采 N 个点，FFT 只是算 DFT 的快算法。把它们当成并列关系，后面所有的坑都从这里开始。'],
    'theory/filter': ['eng', '工程选型口诀', '要相位保真（测距、脉冲波形）用 FIR 或双向滤波；要阶数低、滚降陡（资源受限、实时性要求高）用 IIR，但必须拆成二阶级联并保证相位失真可评估。'],
    'theory/spectrum': ['warn', '伪谱不是功率谱', 'MUSIC、AR 谱这类方法的峰值高度没有功率意义，只能看位置。需要绝对电平请回到 Welch 周期图并做窗补偿。'],
    'lab': ['tip', '课堂投屏建议', '先讲 30 秒原理，再用滑块把现象"演"出来（例如采样率从 500 Hz 拖到 150 Hz，让学生自己说出听到的假频率），最后用误区专栏收尾。每个实验台的参数都会写进网址，可以把调好的状态直接发给学生复现。'],
    'cases': ['eng', '读案例的顺序', '建议按「发射波形 → 信道 → 接收处理链 → 检测」主线读，重点盯三个数：处理增益、分辨力、以及为了得到它们付出的代价（失配损失、旁瓣、计算量）。'],
    'formula': ['tip', '检索技巧', '直接搜行业标签更有效：搜「CFAR」「脉压」「多普勒」「ENBW」「栅瓣」比搜章节名更快定位。每条公式卡片右上角可以把公式连同解读一起复制走。'],
    'quiz': ['tip', '用法建议', '工程判断题建议先自己给出答案再说理由，再展开参考答案对照——这类题考的是取舍判断，看答案背下来没有意义。'],
    'resource': ['pit', '最容易踩的一条', '以为维纳–辛钦定理两边的自相关估计可以随便选：工程上估计自相关必须用**有偏估计**（除以 N 而不是 N−|m|）才能保证半正定；而加窗周期图等价于给自相关乘了一个三角窗，这两件事不可混为一谈。'],
    'toolbox': ['note', '隐私说明', '上传的 wav 只在本机浏览器内解析，不上传任何服务器；示例代码可直接复制运行（Python 需 numpy/scipy/matplotlib，MATLAB 需 Signal Processing Toolbox）。']
  };

  /* ------------------------------------------------------------
     工具
     ------------------------------------------------------------ */
  function leafCount(node) {
    if (!node.children || !node.children.length) return 1;
    return node.children.reduce((s, c) => s + leafCount(c), 0);
  }

  function firstLeaf(node) {
    if (!node.children || !node.children.length) return node;
    return firstLeaf(node.children[0]);
  }

  /** 取某路径已注册视图的一句话摘要（去掉 markdown 记号，截断） */
  function summaryOf(path, limit) {
    const v = DSP.router.views[path];
    const it = DSP.nav.byPath[path];
    let s = (v && v.lede) || (it && it.title) || '';
    s = String(s)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\$([^$]+)\$/g, '$1')
      .replace(/\s*\n+\s*/g, ' ')
      .trim();
    const lim = limit || 78;
    return s.length > lim ? s.slice(0, lim) + '…' : s;
  }

  /** 判断该路径是否已有真实内容（注册了 render） */
  function isReady(path) {
    const v = DSP.router.views[path];
    return !!(v && typeof v.render === 'function');
  }

  /* ------------------------------------------------------------
     生成总览页
     ------------------------------------------------------------ */
  function hubView(node) {
    const kids = node.children || [];
    const total = leafCount(node);
    const ready = collectLeaves(node).filter(isReady).length;
    const start = firstLeaf(node);

    return {
      title: node.title + '　总览',
      lede: DESC[node.id] || ('本板块共 ' + kids.length + ' 个部分、' + total + ' 个条目，下面按顺序列出，点任意一条直接进入。'),
      tags: ['板块总览', total + ' 个条目'],
      head: true,
      pager: false,
      render: function (el) {
        /* ---- 概览指标 ---- */
        el.appendChild(UI.metrics([
          { label: '本板块条目', value: total, unit: '节' },
          { label: '已上线', value: ready, unit: '节' },
          { label: '推荐入口', value: '详见下方', unit: '↓' }
        ]));

        /* ---- 推荐入口 ---- */
        el.appendChild(UI.callout('note', '第一次来这里？',
          '建议从 **' + (DSP.nav.byPath[start.id] || start).title + '** 开始往下读；想先看现象再回头读原理，可以直接进 ' +
          '**[交互式仿真实验台](#/lab)**。'));

        const tip = TIPS[node.id];
        if (tip) {
          const body = UI.callout(tip[0], tip[1], h('div.prose', { html: U.md(tip[2]) }));
          el.appendChild(body);
        }

        /* ---- 章节卡片 ---- */
        el.appendChild(h('h2', {}, [h('span', { text: '全部内容' })]));
        el.appendChild(h('div.grid.g2', {}, kids.map((c, i) => {
          const isGroup = !!(c.children && c.children.length);
          const n = leafCount(c);
          const target = '#' + '/' + c.id;
          const sub = isGroup
            ? ('含 ' + n + ' 个小节：' + (c.children || []).slice(0, 3).map(x => stripNum(x.title)).join('、') + (c.children.length > 3 ? ' 等' : ''))
            : summaryOf(c.id, 92);
          const ok = isGroup ? true : isReady(c.id);
          return h('a.card', {
            href: target,
            style: { display: 'block', textDecoration: 'none', color: 'inherit' }
          }, h('div.card-bd', {}, [
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
              h('span.chip.blue', { text: String(i + 1) }),
              h('span', { style: { fontWeight: '650', color: 'var(--text-strong)' }, text: stripNum(c.title) }),
              isGroup ? h('span.chip.teal', { text: '子板块 · ' + n + ' 节' })
                : (ok ? h('span.chip.green', { text: '已上线' }) : h('span.chip', { text: '内容补充中' }))
            ]),
            h('div.small.dim', { style: { marginTop: '6px', lineHeight: '1.6' }, text: sub }),
            h('div', { style: { marginTop: '8px', color: 'var(--accent)', fontSize: '13px', fontWeight: '600' }, text: '进入 →' })
          ]));
        })));

        /* ---- 底部快捷 ---- */
        el.appendChild(h('hr', { class: 'hr' }));
        el.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
          h('a.btn.sm', { href: '#/home', text: '← 返回软件首页' }),
          h('a.btn.sm', { href: '#/lab', text: '🎛️ 交互式仿真实验台' }),
          h('a.btn.sm', { href: '#/formula/radar', text: '∑ 雷达/声呐专用公式' }),
          h('a.btn.sm', { href: '#/resource/pitfalls', text: '⚠️ 误区专栏' })
        ]));
      }
    };
  }

  function stripNum(t) {
    return String(t).replace(/^[一二三四五六七八九十]+、\s*/, '').replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '');
  }

  function collectLeaves(node, out) {
    out = out || [];
    if (!node.children || !node.children.length) out.push(node.id);
    else node.children.forEach(c => collectLeaves(c, out));
    return out;
  }

  /* ------------------------------------------------------------
     扫描导航树，给每个分组补上总览页
     ------------------------------------------------------------ */
  function walk(nodes) {
    (nodes || []).forEach(n => {
      if (n.children && n.children.length) {
        if (!DSP.router.views[n.id]) {
          DSP.router.register(n.id, hubView(n));
        }
        walk(n.children);
      }
    });
  }

  walk(DSP.nav.NAV);

  console.log('[section-hub] 已为所有分组节点生成板块总览页');
})(window);

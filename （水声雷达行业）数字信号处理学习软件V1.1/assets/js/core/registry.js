/* =============================================================
   registry.js —— 导航树 / 页面注册表 / 全局搜索索引
   全局命名空间：window.DSP.nav

   后续模块通过 DSP.nav.add(nodes) 增量挂载新节点，无需改动本文件。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;
  const h = U.h;

  /* ============================================================
     导航树定义（叶子节点的 id 即路由路径）
     ============================================================= */
  const NAV = [
    {
      id: 'home', title: '软件首页', icon: '🏠', leaf: true
    },
    {
      id: 'theory', title: '知识理论库', icon: '📘', children: [
        {
          id: 'theory/basic', title: '一、基础模块', children: [
            { id: 'theory/basic/signal-class', title: '信号分类：连续/离散、确定/随机' },
            { id: 'theory/basic/sampling', title: '采样定理与混叠机理' },
            { id: 'theory/basic/bandpass', title: '欠采样与带通采样' },
            { id: 'theory/basic/quant', title: '量化、A/D 与 D/A 转换' },
            { id: 'theory/basic/snr', title: '信噪比与动态范围' },
            { id: 'theory/basic/window', title: '窗函数基础' }
          ]
        },
        {
          id: 'theory/transform', title: '二、核心变换（重点）', children: [
            { id: 'theory/transform/overview', title: '变换家族总览与选型' },
            { id: 'theory/transform/dtft', title: 'DTFT 离散时间傅里叶变换' },
            { id: 'theory/transform/dft', title: 'DFT 离散傅里叶变换' },
            { id: 'theory/transform/fft', title: 'FFT 快速傅里叶变换与蝶形运算' },
            { id: 'theory/transform/stft', title: 'STFT 短时傅里叶变换' },
            { id: 'theory/transform/wavelet', title: '小波变换' },
            { id: 'theory/transform/ztrans', title: 'Z 变换' },
            { id: 'theory/transform/hilbert', title: '希尔伯特变换与解析信号' },
            { id: 'theory/transform/frft', title: '分数阶傅里叶变换' }
          ]
        },
        {
          id: 'theory/filter', title: '三、滤波算法', children: [
            { id: 'theory/filter/conv', title: '线性卷积与循环卷积' },
            { id: 'theory/filter/fir', title: 'FIR 滤波器' },
            { id: 'theory/filter/iir', title: 'IIR 滤波器' },
            { id: 'theory/filter/win-design', title: '窗函数法设计 FIR' },
            { id: 'theory/filter/bilinear', title: '双线性变换法' },
            { id: 'theory/filter/impulse-inv', title: '脉冲响应不变法' },
            { id: 'theory/filter/linear-phase', title: '线性相位 FIR 与吉布斯现象' }
          ]
        },
        {
          id: 'theory/spectrum', title: '四、谱估计', children: [
            { id: 'theory/spectrum/classical', title: '经典谱估计：周期图/加窗/平均' },
            { id: 'theory/spectrum/parametric', title: '参数模型谱估计：AR/MA/ARMA' },
            { id: 'theory/spectrum/subspace', title: '子空间方法：Pisarenko/MUSIC/ESPRIT' }
          ]
        },
        {
          id: 'theory/random', title: '五、随机信号与统计处理', children: [
            { id: 'theory/random/correlation', title: '相关函数：自相关与互相关' },
            { id: 'theory/random/psd', title: '功率谱密度' },
            { id: 'theory/random/noise', title: '白噪声与色噪声' },
            { id: 'theory/random/matched', title: '匹配滤波' }
          ]
        },
        {
          id: 'theory/array', title: '六、阵列信号处理基础', children: [
            { id: 'theory/array/beamforming', title: '波束形成原理' },
            { id: 'theory/array/steering', title: '相移、波束扫描与栅瓣' },
            { id: 'theory/array/directivity', title: '指向性与阵列孔径' }
          ]
        }
      ]
    },
    {
      id: 'lab', title: '交互式仿真实验台', icon: '🎛️', children: [
        { id: 'lab/sampling', title: '① 采样定理与混叠' },
        { id: 'lab/dft', title: '② DFT/FFT：栅栏效应与频谱泄漏' },
        { id: 'lab/window', title: '③ 窗函数横向对比' },
        { id: 'lab/fftflow', title: '④ FFT 蝶形运算动画' },
        { id: 'lab/stft', title: '⑤ STFT 时频分辨率权衡' },
        { id: 'lab/zplane', title: '⑥ Z 平面零极点拖动' },
        { id: 'lab/conv', title: '⑦ 线性卷积 vs 循环卷积动画' },
        { id: 'lab/fir', title: '⑧ FIR 滤波器设计与滤波对比' },
        { id: 'lab/matched', title: '⑨ 匹配滤波与脉冲压缩' },
        { id: 'lab/music', title: '⑩ MUSIC 超分辨谱估计' }
      ]
    },
    {
      id: 'cases', title: '工程案例库（雷达/声呐）', icon: '📡', children: [
        {
          id: 'cases/sonar', title: '声呐 DSP 专区', children: [
            { id: 'cases/sonar/pulse-compression', title: '主动声呐 LFM 脉冲压缩' },
            { id: 'cases/sonar/passive', title: '被动声呐谱检测与线谱提取' },
            { id: 'cases/sonar/beamforming', title: '声呐波束形成与目标方位估计' },
            { id: 'cases/sonar/mbes', title: '多波束测深与侧扫图像去噪' },
            { id: 'cases/sonar/doppler', title: '水下多普勒补偿与回波积累' }
          ]
        },
        {
          id: 'cases/radar', title: '雷达 DSP 专区', children: [
            { id: 'cases/radar/pulse-compression', title: '雷达 LFM 脉冲压缩' },
            { id: 'cases/radar/mti-mtd', title: 'MTI 动目标显示与 MTD 相参积累' },
            { id: 'cases/radar/cfar', title: 'CFAR 恒虚警检测（CA/OS/GO/SO）' },
            { id: 'cases/radar/fmcw', title: 'FMCW 差拍信号测距测速' }
          ]
        }
      ]
    },
    {
      id: 'formula', title: '公式手册', icon: '∑', children: [
        { id: 'formula/basic', title: '基础公式' },
        { id: 'formula/transform', title: '变换公式' },
        { id: 'formula/filter', title: '滤波公式' },
        { id: 'formula/spectrum', title: '谱估计公式' },
        { id: 'formula/array', title: '阵列公式' },
        { id: 'formula/radar', title: '雷达/声呐专用公式' }
      ]
    },
    {
      id: 'quiz', title: '自测习题', icon: '✏️', children: [
        { id: 'quiz/concept', title: '概念辨析题' },
        { id: 'quiz/param', title: '参数选择题' },
        { id: 'quiz/calc', title: '计算题' },
        { id: 'quiz/eng', title: '工程判断题' }
      ]
    },
    {
      id: 'resource', title: '资源附录', icon: '📚', children: [
        { id: 'resource/pitfalls', title: '误区专栏' },
        { id: 'resource/roadmap', title: '学习路线推荐' },
        { id: 'resource/symbols', title: '符号约定与参数对照表' },
        { id: 'resource/refs', title: '参考文献与开源工具' }
      ]
    },
    {
      id: 'toolbox', title: '工具箱', icon: '🧰', children: [
        { id: 'toolbox/code', title: 'Python / MATLAB 代码示例' },
        { id: 'toolbox/upload', title: '信号上传分析（wav）' },
        { id: 'toolbox/compare', title: '对比实验' },
        { id: 'toolbox/dict', title: '术语词典' }
      ]
    }
  ];

  /* ============================================================
     索引维护
     ============================================================= */
  const flat = [];          // [{path,title,group,sub}]
  const byPath = {};

  function flatten(nodes, group, sub) {
    nodes.forEach(n => {
      if (n.children) {
        flatten(n.children, group || n.title, n.title);
      } else {
        const item = { path: n.id, title: n.title, group: group || '', sub: sub || '', icon: n.icon || '' };
        flat.push(item);
        byPath[n.id] = item;
      }
    });
  }
  flatten(NAV, '', '');

  /** 增量注册（后续模块调用） */
  function add(nodes) {
    NAV.push.apply(NAV, nodes);
    flatten(nodes, '', '');
  }

  /** 给已有路径补充搜索关键词 */
  function keywords(path, words) {
    const it = byPath[path];
    if (it) it.kw = (it.kw || []).concat(words);
  }

  /** 全局搜索：返回 [{path,title,group}] */
  function search(q, limit) {
    limit = limit || 20;
    const s = String(q || '').trim().toLowerCase();
    if (!s) return [];
    const hits = [];
    flat.forEach(it => {
      let sc = 0;
      const t = it.title.toLowerCase();
      if (t === s) sc = 100;
      else if (t.indexOf(s) === 0) sc = 60;
      else if (t.indexOf(s) > 0) sc = 40;
      const g = (it.group || '').toLowerCase();
      if (g.indexOf(s) >= 0) sc += 12;
      if (it.kw) {
        for (const k of it.kw) if (String(k).toLowerCase().indexOf(s) >= 0) { sc += 25; break; }
      }
      if (sc > 0) hits.push({ item: it, score: sc });
    });
    // 术语
    if (DSP.glossary) {
      DSP.glossary.search(s).forEach(k => {
        const it = DSP.glossary.TERMS[k];
        hits.push({ item: { path: 'toolbox/dict?term=' + encodeURIComponent(k), title: '术语：' + it.t, group: '术语词典' }, score: 30 });
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit).map(x => x.item);
  }

  /** 面包屑路径 */
  function crumbs(path) {
    const out = [];
    function walk(nodes, chain) {
      for (const n of nodes) {
        const c = chain.concat([n]);
        if (n.id === path) { out.push.apply(out, c); return true; }
        if (n.children && walk(n.children, c)) return true;
      }
      return false;
    }
    walk(NAV, []);
    return out;
  }

  /** 上一页 / 下一页（按叶子顺序） */
  function siblings(path) {
    const i = flat.findIndex(f => f.path === path);
    return {
      prev: i > 0 ? flat[i - 1] : null,
      next: i >= 0 && i < flat.length - 1 ? flat[i + 1] : null
    };
  }

  /* ============================================================
     侧边栏渲染
     ============================================================= */
  let sidebarEl = null;

  function renderSidebar(container) {
    sidebarEl = container;
    U.clear(container);
    NAV.forEach(n => container.appendChild(buildNode(n, 1)));
    const APP = DSP.APP || { name: '数字信号处理知识学习实践系统', version: 'V1.1', tagline: '理论 · 仿真 · 工程案例 · 公式手册', sloganParen: '' };
    const foot = h('div.nav-foot', {}, [
      h('div', { style: { fontWeight: '650', color: 'var(--text-dim)' } },
        h('span', { text: APP.name + ' ' + APP.version })),
      h('div', { text: APP.tagline }),
      h('div', { style: { marginTop: '4px', lineHeight: '1.5' }, text: APP.sloganParen }),
      h('div', { style: { marginTop: '6px' } }, [
        h('span', { text: '快捷键：' }),
        h('code', { text: 'Ctrl+K' }), h('span', { text: ' 搜索 · ' }),
        h('code', { text: 'N' }), h('span', { text: ' 笔记 · ' }),
        h('code', { text: 'D' }), h('span', { text: ' 深色/浅色' })
      ])
    ]);
    container.appendChild(foot);
    highlight(DSP.router ? DSP.router.currentPath() : 'home');
  }

  function buildNode(n, level) {
    const hasKids = !!(n.children && n.children.length);
    const kidsBox = hasKids ? h('div.nav-children') : null;
    const tw = hasKids ? h('span.tw', { text: '▸' }) : null;
    const btn = h('button.nav-item.l' + level, {}, [
      tw || (n.icon ? h('span.ic', { text: n.icon }) : null),
      h('span', { text: n.title })
    ]);
    btn.dataset.path = n.id;

    if (!n.leaf && !hasKids) {
      // 叶子节点 → 跳转
      btn.addEventListener('click', () => { location.hash = '#/' + n.id; });
    } else if (n.leaf) {
      btn.addEventListener('click', () => { location.hash = '#/' + n.id; });
    } else {
      btn.addEventListener('click', function () {
        const open = kidsBox.classList.toggle('open');
        if (tw) tw.classList.toggle('open', open);
      });
      // 分组标题也允许点击跳转（若已注册视图）
      btn.addEventListener('dblclick', () => { location.hash = '#/' + n.id; });
    }

    const wrap = h('div.nav-group', {}, [btn]);
    if (hasKids) {
      n.children.forEach(c => kidsBox.appendChild(buildNode(c, Math.min(level + 1, 3))));
      wrap.appendChild(kidsBox);
    }
    wrap._kids = kidsBox;
    wrap._btn = btn;
    wrap._tw = tw;
    return wrap;
  }

  /** 高亮当前路径并自动展开父级 */
  function highlight(path) {
    if (!sidebarEl) return;
    U.qsa('.nav-item', sidebarEl).forEach(b => b.classList.remove('active'));
    const cr = crumbs(path);
    const paths = cr.map(c => c.id);
    U.qsa('.nav-group', sidebarEl).forEach(g => {
      const p = g._btn && g._btn.dataset.path;
      if (paths.indexOf(p) >= 0 && g._kids) {
        g._kids.classList.add('open');
        if (g._tw) g._tw.classList.add('open');
      }
    });
    const btn = U.qsa('.nav-item', sidebarEl).find(b => b.dataset.path === path);
    if (btn) {
      btn.classList.add('active');
      const r = btn.getBoundingClientRect(), sr = sidebarEl.getBoundingClientRect();
      if (r.top < sr.top || r.bottom > sr.bottom) {
        sidebarEl.scrollTop += (r.top - sr.top) - sr.height / 2 + r.height;
      }
    }
  }

  DSP.nav = { NAV, flat, byPath, add, keywords, search, crumbs, siblings, renderSidebar, highlight };
})(window);

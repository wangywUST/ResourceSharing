/* =============================================================
   glossary.js —— 术语词典（悬停释义 + 正文自动标注）
   全局命名空间：window.DSP.glossary

   词条结构：
     key: { t:'中文名', en:'English', d:'一句话释义', tag:'分类', auto:false 表示不自动标注 }
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;

  /* ---------------- 核心词条（后续模块持续补充） ---------------- */
  const TERMS = {
    /* 基础 */
    '采样定理': { t: '采样定理', en: 'Sampling Theorem', d: '带限信号以 fs > 2fmax 采样可无失真重建；否则发生混叠。', tag: '基础' },
    '奈奎斯特频率': { t: '奈奎斯特频率', en: 'Nyquist Frequency', d: 'fs/2，采样后能表示的最高频率；超过它的频率会折叠回低频。', tag: '基础' },
    '混叠': { t: '混叠', en: 'Aliasing', d: '欠采样导致高频成分伪装成低频，频谱以 fs/2 为镜像折叠。', tag: '基础' },
    '带通采样': { t: '带通采样', en: 'Bandpass Sampling', d: '对带通信号可用远低于 2f_max 的采样率，靠频谱搬移避免混叠，需满足允许区间约束。', tag: '基础' },
    '量化': { t: '量化', en: 'Quantization', d: '幅度离散化。理想 b 位量化信噪比约 6.02b + 1.76 dB（满量程正弦）。', tag: '基础' },
    '信噪比': { t: '信噪比', en: 'SNR', d: '信号功率与噪声功率之比，常用 dB 表示：10log10(Ps/Pn)。', tag: '基础' },
    '动态范围': { t: '动态范围', en: 'Dynamic Range', d: '系统能同时处理的最强与最弱信号之比，ADC 受位数限制。', tag: '基础' },
    '能量信号': { t: '能量信号', en: 'Energy Signal', d: '总能量有限、平均功率为零的信号（如单个脉冲）。', tag: '基础' },
    '功率信号': { t: '功率信号', en: 'Power Signal', d: '平均功率有限、总能量无限的信号（如周期信号、平稳噪声）。', tag: '基础' },

    /* 变换 */
    'DTFT': { t: '离散时间傅里叶变换', en: 'DTFT', d: '离散序列 → 连续周期频谱（周期 2π），理论工具，计算机无法直接算。', tag: '变换' },
    'DFT': { t: '离散傅里叶变换', en: 'DFT', d: '对 DTFT 在 [0,2π) 上等间隔取 N 点采样，得到 N 点离散频谱，可计算。', tag: '变换' },
    'FFT': { t: '快速傅里叶变换', en: 'FFT', d: 'DFT 的高效算法，基 2 时复杂度由 O(N²) 降到 O(N log N)，结果等价于 DFT。', tag: '变换' },
    '栅栏效应': { t: '栅栏效应', en: 'Picket Fence Effect', d: 'DFT 只在离散频点上看谱，信号频率若不在频点上则"从栅栏缝里漏看"，需补零或插值。', tag: '变换' },
    '频谱泄漏': { t: '频谱泄漏', en: 'Spectral Leakage', d: '截断相当于加矩形窗，单频能量扩散到全频带；加窗可抑制但会加宽主瓣。', tag: '变换' },
    '频率分辨率': { t: '频率分辨率', en: 'Frequency Resolution', d: 'Δf = fs/N（N 为有效数据长度，不是 FFT 点数）；补零只加密网格不提高真分辨率。', tag: '变换' },
    'STFT': { t: '短时傅里叶变换', en: 'STFT', d: '加滑动窗做局部频谱，权衡时间分辨率与频率分辨率（海森堡约束）。', tag: '变换' },
    '小波变换': { t: '小波变换', en: 'Wavelet Transform', d: '用可伸缩平移的基函数分析，高频段时间分辨率好、低频段频率分辨率好。', tag: '变换' },
    'Z变换': { t: 'Z 变换', en: 'Z Transform', d: '离散系统的复频域工具，零极点位置决定稳定性与频率响应形状。', tag: '变换' },
    '希尔伯特变换': { t: '希尔伯特变换', en: 'Hilbert Transform', d: '把实信号转为解析信号，取包络与瞬时频率；本质是 ±90° 相移。', tag: '变换' },
    '分数阶傅里叶变换': { t: '分数阶傅里叶变换', en: 'Fractional Fourier Transform', d: '时频平面旋转 α 角度的广义傅里叶变换，对 chirp 类信号有最佳能量聚集。', tag: '变换' },
    '解析信号': { t: '解析信号', en: 'Analytic Signal', d: '只含正频率的复信号 x(n)+j·H[x(n)]，其模为包络、相位导数为瞬时频率。', tag: '变换' },

    /* 滤波 */
    '线性卷积': { t: '线性卷积', en: 'Linear Convolution', d: 'LTI 系统输入输出的完整运算，输出长度 M+N−1。', tag: '滤波' },
    '循环卷积': { t: '循环卷积', en: 'Circular Convolution', d: '在 N 点圆周上做卷积，等价于频域相乘；只有 N ≥ M+L−1 时才等于线性卷积。', tag: '滤波' },
    'FIR': { t: '有限冲激响应滤波器', en: 'FIR', d: 'h(n) 有限长，可做到严格线性相位，永远稳定，但过渡带相同指标下阶数高于 IIR。', tag: '滤波' },
    'IIR': { t: '无限冲激响应滤波器', en: 'IIR', d: '含反馈，h(n) 无限长，阶数低效率高，但相位非线性且可能不稳定。', tag: '滤波' },
    '吉布斯现象': { t: '吉布斯现象', en: 'Gibbs Phenomenon', d: '理想滤波器截断后通带边缘出现过冲（约 9%），且不随阶数增加消失。', tag: '滤波' },
    '线性相位': { t: '线性相位', en: 'Linear Phase', d: '相位是频率的线性函数，群延迟恒定，波形不失真（只是整体延时）。', tag: '滤波' },
    '群延迟': { t: '群延迟', en: 'Group Delay', d: 'τ(ω) = −dφ/dω，表示各频率分量的时延；非线性会造成波形失真。', tag: '滤波' },
    '双线性变换': { t: '双线性变换', en: 'Bilinear Transform', d: 's→z 的代数映射，无混叠但存在频率扭曲，需预畸变。', tag: '滤波' },
    '脉冲响应不变法': { t: '脉冲响应不变法', en: 'Impulse Invariance', d: '令 h(n)=T·h_a(nT)，时域波形一致，但存在频谱混叠，不适合高通。', tag: '滤波' },

    /* 谱估计 */
    '周期图': { t: '周期图法', en: 'Periodogram', d: '直接对数据取模方除以 N 的谱估计，方差大（不随 N 减小），分辨率 ≈ 1/N。', tag: '谱估计' },
    '功率谱密度': { t: '功率谱密度', en: 'PSD', d: '功率在频率上的分布密度，单位 W/Hz；是相关函数的傅里叶变换。', tag: '谱估计' },
    'AR模型': { t: '自回归模型', en: 'AR Model', d: '用过去 p 个样点线性预测当前值，谱峰尖锐，适合线谱与短数据。', tag: '谱估计' },
    'MUSIC': { t: '多重信号分类', en: 'MUSIC', d: '子空间类超分辨算法，利用噪声子空间与阵列流形的正交性构造谱峰，突破瑞利限。', tag: '谱估计' },
    'ESPRIT': { t: '旋转不变子空间', en: 'ESPRIT', d: '利用阵列平移不变性直接求频率/角度，无需谱峰搜索，计算量低于 MUSIC。', tag: '谱估计' },
    '瑞利限': { t: '瑞利限', en: 'Rayleigh Limit', d: '常规波束/傅里叶方法分辨两个等强目标的临界间隔，约 1/N（归一化）或 0.886·λ/(Nd)。', tag: '谱估计' },

    /* 随机信号 */
    '自相关': { t: '自相关函数', en: 'Autocorrelation', d: '信号与自身延迟副本的相似程度，用于周期检测与时延估计。', tag: '随机信号' },
    '互相关': { t: '互相关函数', en: 'Cross-correlation', d: '两信号在不同延迟下的相似性，峰值位置即时延差。', tag: '随机信号' },
    '白噪声': { t: '白噪声', en: 'White Noise', d: '功率谱在整个频带平坦的随机过程，自相关为冲激。', tag: '随机信号' },
    '色噪声': { t: '色噪声', en: 'Colored Noise', d: '功率谱非平坦的噪声，可由白噪声经滤波产生。', tag: '随机信号' },
    '匹配滤波': { t: '匹配滤波', en: 'Matched Filter', d: '在白噪声下使输出信噪比最大的线性滤波器，冲激响应是信号的时间反褶共轭。', tag: '随机信号' },
    '脉冲压缩': { t: '脉冲压缩', en: 'Pulse Compression', d: '用宽带宽信号（如 LFM）发射、匹配滤波接收，兼顾作用距离与距离分辨率。', tag: '雷达声呐' },

    /* 阵列 */
    '波束形成': { t: '波束形成', en: 'Beamforming', d: '对阵列各阵元加权求和，使阵列对特定方向灵敏、对其他方向抑制。', tag: '阵列' },
    '指向性': { t: '指向性', en: 'Directivity', d: '阵列/换能器在空间各方向响应强弱分布，主瓣越窄指向性越强。', tag: '阵列' },
    '旁瓣': { t: '旁瓣', en: 'Side Lobe', d: '方向图主瓣之外的响应峰，过高会导致虚警与方位误判。', tag: '阵列' },
    '阵元间距': { t: '阵元间距', en: 'Element Spacing', d: 'd > λ/2 会出现栅瓣（方向模糊），通常取 d = λ/2。', tag: '阵列' },
    '栅瓣': { t: '栅瓣', en: 'Grating Lobe', d: '阵元间距过大时出现的与主瓣等高的虚假波束。', tag: '阵列' },

    /* 雷达声呐 */
    'LFM': { t: '线性调频信号', en: 'LFM / Chirp', d: '频率随时间线性变化的信号，时宽带宽积大，脉冲压缩后获得高处理增益。', tag: '雷达声呐' },
    '多普勒': { t: '多普勒频移', en: 'Doppler Shift', d: '相对径向运动导致回波频率偏移 fd = 2v/λ，是测速的物理基础。', tag: '雷达声呐' },
    'MTI': { t: '动目标显示', en: 'MTI', d: '用相邻脉冲相消抑制静止杂波，保留运动目标。', tag: '雷达声呐' },
    'MTD': { t: '动目标检测', en: 'MTD', d: '对多个脉冲做相参积累 + 多普勒滤波组（FFT），提升运动目标信噪比。', tag: '雷达声呐' },
    'CFAR': { t: '恒虚警检测', en: 'CFAR', d: '用参考单元自适应估计背景功率，保持虚警率恒定；CA/OS/GO/SO 为常见变体。', tag: '雷达声呐' },
    'FMCW': { t: '调频连续波', en: 'FMCW', d: '连续发射调频信号，用差拍频率同时测距测速，常见于车载与测距雷达。', tag: '雷达声呐' },
    '线谱': { t: '线谱', en: 'Line Spectrum', d: '螺旋桨/轴频等产生的窄带离散谱峰，是被动声呐目标识别的核心特征。', tag: '雷达声呐' },
    '混响': { t: '混响', en: 'Reverberation', d: '海面/海底/体积散射产生的强背景干扰，是主动声呐的主要限制因素。', tag: '雷达声呐' },
    '多径': { t: '多径', en: 'Multipath', d: '信号经海面海底多次反射到达，造成时延扩展与信号起伏。', tag: '雷达声呐' },
    '波束扫描': { t: '波束扫描', en: 'Beam Scanning', d: '通过改变各阵元相位使主瓣指向不同方位，实现空间搜索。', tag: '阵列' }
  };

  /* ---------------- 提示气泡 ---------------- */
  let tipEl = null;

  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = U.qs('#glossary-tip');
    if (!tipEl) {
      tipEl = U.h('div', { id: 'glossary-tip' });
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function showTip(termEl) {
    const key = termEl.dataset.term;
    const item = TERMS[key];
    if (!item) return;
    const tip = ensureTip();
    tip.innerHTML = '';
    tip.appendChild(U.h('div.gt-t', {}, [
      U.h('span', { text: item.t }),
      U.h('span.gt-en', { text: item.en })
    ]));
    tip.appendChild(U.h('div', { text: item.d }));
    if (item.tag) tip.appendChild(U.h('div.gt-more', { text: '分类：' + item.tag + ' · 单击查看完整词条' }));
    tip.classList.add('show');

    const r = termEl.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    let top = r.bottom + 8;
    if (top + th > window.innerHeight - 8) top = r.top - th - 8;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function hideTip() {
    const tip = ensureTip();
    tip.classList.remove('show');
  }

  /** 词条详情弹窗 */
  function openTerm(key) {
    const item = TERMS[key];
    if (!item) return;
    DSP.ui.modal({
      title: item.t + '　' + item.en,
      body: DSP.ui.kv([['中文名', item.t], ['英文', item.en], ['释义', item.d], ['分类', item.tag || '—']])
    });
  }

  /** 全局委托：悬停显示 + 点击打开详情 */
  function bind() {
    document.addEventListener('mouseover', function (e) {
      const t = e.target.closest ? e.target.closest('.term') : null;
      if (t) showTip(t);
    });
    document.addEventListener('mouseout', function (e) {
      const t = e.target.closest ? e.target.closest('.term') : null;
      if (t) hideTip();
    });
    document.addEventListener('click', function (e) {
      const t = e.target.closest ? e.target.closest('.term') : null;
      if (t) openTerm(t.dataset.term);
    });
    window.addEventListener('scroll', hideTip, true);
  }

  /* ---------------- 正文自动标注 ---------------- */
  const SKIP_TAGS = { CODE: 1, PRE: 1, A: 1, BUTTON: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, SUMMARY: 1, H1: 1, H2: 1, H3: 1, H4: 1, TH: 1, OPTION: 1 };
  const SKIP_CLS = ['katex', 'math-block', 'term', 'mono', 'chip', 'btn', 'metric', 'm-l', 'm-v', 'seg', 'cp-title', 'crumbs', 'toc-title'];

  /** 把 root 内文本出现的术语自动包成 .term（排除公式与代码区） */
  function annotate(root) {
    const keys = Object.keys(TERMS)
      .filter(k => TERMS[k].auto !== false)
      .sort((a, b) => b.length - a.length);
    if (!keys.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS[p.tagName]) return NodeFilter.FILTER_REJECT;
        for (const c of SKIP_CLS) if (p.classList && p.classList.contains(c)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);

    targets.forEach(node => {
      const text = node.nodeValue;
      if (!text) return;
      let pos = -1, hitKey = null;
      // 找最靠前的命中词
      for (const k of keys) {
        const i = text.indexOf(k);
        if (i >= 0 && (pos < 0 || i < pos || (i === pos && k.length > hitKey.length))) { pos = i; hitKey = k; }
      }
      if (pos < 0) return;
      const after = node.splitText(pos);
      if (after.nodeValue.length > hitKey.length) after.splitText(hitKey.length);
      const span = U.h('span.term', { text: hitKey, dataset: { term: hitKey } });
      after.parentNode.replaceChild(span, after);
    });
  }

  /** 术语检索（供全局搜索） */
  function search(q) {
    const s = q.toLowerCase();
    return Object.keys(TERMS).filter(k => {
      const it = TERMS[k];
      return k.toLowerCase().indexOf(s) >= 0 ||
        it.en.toLowerCase().indexOf(s) >= 0 ||
        (it.d && it.d.toLowerCase().indexOf(s) >= 0);
    }).slice(0, 12);
  }

  DSP.glossary = {
    TERMS: TERMS, bind: bind, annotate: annotate, search: search,
    openTerm: openTerm, hideTip: hideTip
  };
})(window);

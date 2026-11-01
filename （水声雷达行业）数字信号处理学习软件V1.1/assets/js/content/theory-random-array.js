/* =============================================================
   theory-random-array.js —— 知识理论库 · 三、随机信号统计处理 +
                             四、阵列信号处理基础（7 页）
   路由：theory/random/*  theory/array/*

   内容写入方式：结构化 block（见 doc.js 头部注释）
   所有图形均为实时计算（core + plot），不依赖外部资源
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const doc = DSP.doc;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;

  /* ============================================================
     通用小工具（仅本文件内部使用）
     ============================================================ */

  /** 生成长度为 n 的数组，元素由 fn(i) 给出 */
  function gen(n, fn) {
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = fn(i);
    return a;
  }

  /** 幅度 → dB（20log，自动限幅） */
  function db20(v, ref) {
    const r = ref === undefined ? 1 : ref;
    return 20 * Math.log10(Math.max(Math.abs(v), 1e-12) / Math.max(r, 1e-30));
  }

  /** 数组取最大值 */
  function maxOf(a) {
    let m = -Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    return m;
  }

  /** 序列归一化到峰值 1 */
  function normPeak(a) {
    const m = maxOf(a) || 1;
    return gen(a.length, i => a[i] / m);
  }

  /** 线性幅度序列 → dB（相对峰值 0 dB，底部限幅） */
  function toDbNorm(a, floor) {
    const m = maxOf(a) || 1;
    const lo = floor === undefined ? -80 : floor;
    return gen(a.length, i => Math.max(20 * Math.log10(Math.max(a[i], 1e-12) / m), lo));
  }

  /** 抛物线（三点）插值峰值位置偏移 */
  function parabDelta(ym, y0, yp) {
    const den = ym - 2 * y0 + yp;
    return den === 0 ? 0 : 0.5 * (ym - yp) / den;
  }

  /**
   * 多面板图容器
   * panels = [{ title, caption, render(canvas, el) }]，按 cols 列排布
   */
  function figure(el, cols, panels) {
    const g = U.h('div.grid.g' + cols);
    panels.forEach(function (pan) {
      const box = UI.plotBox({ title: pan.title, caption: pan.caption });
      pan.render(box.canvas, box.el);
      g.appendChild(box.el);
    });
    el.appendChild(g);
  }

  /* ============================================================
     1. 相关函数：自相关、互相关与时延估计
     ============================================================= */
  doc.register('theory/random/correlation', {
    title: '相关函数：从相似性度量到时延估计',
    lede: '相关的本质是一次"滑动内积"。把这句话吃透，自相关的性质、互相关的非对称性、维纳-辛钦定理、匹配滤波与百分比级的测距精度，全都是同一件事的不同侧面。',
    tags: ['随机信号', '相关函数', '时延估计', '维纳-辛钦'],
    labs: [{ path: 'lab/matched', title: '匹配滤波与脉冲压缩实验台', desc: '调节带宽与脉宽，观察相关峰变窄、旁瓣结构与信噪比增益的变化' }],
    toc: true,
    intro: '主动声呐与雷达要回答的第一个问题是"回波在哪里"，对应的数学工具就是互相关。被动系统要回答"有没有周期性成分、谱有多宽"，对应的是自相关。这一节的写法是：**先给定义和估计子，再给性质，最后落到时延估计的工程细节**。',
    sections: [
      /* ---------------- 1 ---------------- */
      {
        id: 'what', num: '1', title: '相关函数到底在量什么',
        blocks: [
          { t: 'md', md: '相关函数的本质极其朴素：把两个波形按相对平移 $m$ 个样本对齐，逐点相乘再求和。这正是一个**内积**运算。内积越大，说明两个波形在经过这段平移之后形状越一致。' },
          { t: 'math', tex: 'r_{xy}[m] = \\sum_{n} x[n+m]\\,y^*[n] \\quad\\text{（求和对所有使下标有效的 } n \\text{）}', tag: '(1)' },
          { t: 'md', md: '把这个朴素定义用到三处不同的对象上，就得到了相关理论在工程上的三张面孔：' },
          { t: 'md', md: '- **自己和自己的平移**作内积 → 自相关。它告诉你序列里有没有隐藏的周期性、重复周期是多少，以及谱有多宽（相关峰越窄意味着带宽越宽，这是脉冲压缩与高分辨测距的全部基础）。\n- **接收波形和发射样本**作内积 → 互相关。峰出现的位置就是传播时延，这是主动测距、测深、测厚的核心算法。\n- **两个不同传感器的信号**作内积 → 互相关。它提取两路信号的公共成分，抑制互不相关的本地噪声，是双通道时延差定位、双基地探测与基线干涉测量的基本手段。' },
          { t: 'callout', kind: 'note', title: '注意两个不同的"相关"', md: '统计里讲的"相关系数"（皮尔逊系数）是归一化的二阶统计量，取值在 $[-1,1]$；信号处理里说的"相关函数"是**以时延为自变量的函数** $R_{xy}[m]$，量纲是信号单位的平方（或归一化后的无量纲值）。二者同名不同胚。工程上做检测时通常再除以 $\\sqrt{R_{xx}[0]R_{yy}[0]}$ 归一化，这才是皮尔逊相关系数意义上的相似度。' },
          { t: 'kv', title: '本节符号约定', pairs: [
            ['$x[n],y[n]$', '两条实（或复）离散序列，下标 $n$ 为样本序号'],
            ['$m$', '相关滞后（lag），单位"样本"；换算成时间是 $mT_s = m/f_s$'],
            ['$(\\cdot)^*$', '复共轭。实信号时可以忽略，但对复数表示的解析信号与窄带信道绝不能漏'],
            ['$R_{xy}[m]$', '互相关函数；当 $x=y$ 时记为 $R_{xx}[m]$ 即自相关函数']
          ] }
        ]
      },
      /* ---------------- 2 ---------------- */
      {
        id: 'def', num: '2', title: '两种定义：能量型与功率型，以及有偏无偏之争',
        blocks: [
          { t: 'md', md: '定义必须分两套，因为信号本身要分能量型与功率型：**有限能量的确定信号**用纯求和（能量型），结果随 $m$ 衰减到 0；**平稳随机过程和周期信号**总能量无穷，必须除以观测长度取平均（功率型），结果在 $m\\to\\infty$ 时不衰减或收敛到均值平方。' },
          { t: 'math', tex: 'r_{xx}[m] = \\sum_{n=-\\infty}^{\\infty} x[n]\\,x^*[n-m] \\qquad\\text{（能量型）}', tag: '(2)' },
          { t: 'math', tex: 'R_{xx}[m] = \\lim_{N\\to\\infty}\\frac{1}{2N+1}\\sum_{n=-N}^{N} x[n]\\,x^*[n-m] = E\\!\\left\\{x[n]x^*[n-m]\\right\\} \\qquad\\text{（功率型）}', tag: '(3)' },
          { t: 'md', md: '到了计算机上，我们只有长度为 $N$ 的一段样本，集合平均无从谈起，只能用**时间平均估计**。这里就出现了信号处理史上最著名的一场"小争论"：' },
          { t: 'math', tex: '\\hat{R}_{b}[m] = \\frac{1}{N}\\sum_{n=0}^{N-1-|m|} x[n+|m|]\\,x^*[n] \\qquad\\text{（有偏估计，除以 } N \\text{）}', tag: '(4)' },
          { t: 'math', tex: '\\hat{R}_{u}[m] = \\frac{1}{N-|m|}\\sum_{n=0}^{N-1-|m|} x[n+|m|]\\,x^*[n] \\qquad\\text{（无偏估计，除以 } N-|m| \\text{）}', tag: '(5)' },
          { t: 'table', cols: ['', '有偏估计 R̂b', '无偏估计 R̂u'], rows: [
            ['期望', 'E{R̂b[m]} = (1−|m|/N)·Rxx[m]，有偏', 'E{R̂u[m]} = Rxx[m]，无偏'],
            ['方差', '小：不随 m 爆炸增长', '大：|m|→N 时只剩极少样本，估计发散'],
            ['是否半正定', '**是**，保证功率谱估计非负', '否，可能出现负的功率谱'],
            ['FFT 表达', 'R̂b ⟺ |X[k]|²/N', '无简洁 FFT 表达'],
            ['适用场合', '谱估计、Levinson 递推、Toeplitz 求解（默认选择）', '理论分析、短延迟处的精细估计']
          ] },
          { t: 'callout', kind: 'tip', title: '工程上的默认答案', md: '**默认用有偏估计。** 理由是硬性的：有偏估计保证自相关序列半正定，进而保证任何由它算出的功率谱恒为非负；而负功率谱在后续的对数坐标（dB）、噪声谱级、自适应白化里会直接崩掉（对负数取对数）。此外 Toeplitz 自相关矩阵（Yule-Walker 方程、维纳滤波、MVDR）要求正定性，用无偏估计构造的矩阵可能奇异或不定，导致滤波器求解失败。' },
          { t: 'fold', summary: '展开：为什么有偏估计保证半正定（而不是"仅仅有偏"）', deriv: true, blocks: [
            { t: 'md', md: '取任意非零复向量 $\\mathbf{a}=(a_0,\\dots,a_{N-1})$，考察二次型：' },
            { t: 'math', tex: '\\sum_{i=0}^{N-1}\\sum_{j=0}^{N-1} a_i a_j^* \\hat{R}_b[i-j] = \\frac{1}{N}\\sum_{n=0}^{N-1}\\left|\\sum_{i=0}^{N-1} a_i\\,x[n+i]\\right|^2 \\;\\ge\\; 0', tag: '(6)' },
            { t: 'md', md: '推导只需一步：把 $\\hat R_b[i-j] = \\frac{1}{N}\\sum_n x[n+i]x^*[n+j]$ 代入左边，交换求和次序，右边即成为一串模方之和，自然非负。于是自相关矩阵 $\\mathbf{R}$ 半正定。' },
            { t: 'md', md: '由维纳-辛钦定理，功率谱是 $\\hat R_b$ 的傅里叶变换。对半正定 Toeplitz 矩阵而言其傅里叶变换（符号）处处非负，即 $\\hat P_{xx}(\\omega)\\ge 0$。反过来，无偏估计相当于给 $\\hat R_b$ 乘了一个随 $|m|$ 增大的倒数三角权 $\\frac{N}{N-|m|}$，这个"放大"操作破坏了半正定性，谱上就会出现负值——这正是 Blackman-Tukey 类间接法谱估计必须加窗、且宁可牺牲分辨率也要保证谱非负的原因。' }
          ] }
        ]
      },
      /* ---------------- 3 ---------------- */
      {
        id: 'prop', num: '3', title: '自相关的四条性质及其物理含义',
        blocks: [
          { t: 'md', md: '自相关的性质不是用来背的，每一条都对应一个工程事实。' },
          { t: 'table', cols: ['性质', '数学表述', '工程含义'], rows: [
            ['峰值在零滞后', '|Rxx[m]| ≤ Rxx[0]，且 Rxx[0] = E{|x|²} = σ²+μ²', '零延迟处是"完全对齐"，因此最像。零滞后值就是**总功率**（含直流）'],
            ['共轭对称（偶对称）', '实序列：Rxx[−m] = Rxx[m]；复序列：Rxx[−m] = Rxx*[m]', '自相关丢失了波形的极性信息，无法分辨波形是正着还是镜像；也意味着 PSD 为实函数'],
            ['周期性保持', '若 x[n] 以 P 为周期，则 Rxx[m] 也以 P 为周期', '强噪声背景下检测周期性成分的利器（齿轮箱故障诊断、螺旋桨轴频/叶频提取）'],
            ['均值（直流）分量', '若均值为 μ，则 Rxx[m] = μ² + Cxx[m]', '做相关前**必须先去均值**，否则直流会把 Rxx[0] 抬高，掩盖真正的结构']
          ] },
          { t: 'math', tex: '|R_{xx}[m]| \\le R_{xx}[0] \\quad\\Longleftarrow\\quad |\\langle x_1,x_2\\rangle|^2 \\le \\|x_1\\|^2\\,\\|x_2\\|^2 \\;\\;(\\text{柯西-施瓦茨})', tag: '(7)' },
          { t: 'callout', kind: 'tip', title: '一条性质引出整套检测理论', md: '把式 (7) 换个写法：设观测 $x = s+n$，用模板 $s$ 作相关，则在白噪声假设下输出信噪比的上界恰好在"模板就是信号本身"时达到。这就是**匹配滤波器最优性**的雏形，我们会在「匹配滤波」一节用同一个柯西-施瓦茨不等式严格推出。相关、卷积、匹配滤波、波束形成在数学上是同一件事的不同坐标。' },
          { t: 'callout', kind: 'pit', title: '误区：忘记去均值', md: '水声接收机的直流漂移、雷达 ADC 的固定偏置，都是典型的非零均值。如果直接做自相关，$R_{xx}[0]$ 会被 $\\mu^2$ 抬高，$R_{xx}[m]$ 在 $m\\to\\infty$ 时不衰减而是趋于 $\\mu^2$，看起来像"存在很强的相关性"。正确流程：**先减均值（去直流），必要时再高通滤波**。' }
        ]
      },
      /* ---------------- 4 ---------------- */
      {
        id: 'xcorr', num: '4', title: '互相关：非对称性，以及时延在哪里',
        blocks: [
          { t: 'md', md: '把自相关里的第二个序列换成另一条 observations，就得到互相关。定义中的顺序非常重要：$R_{xy}[m] = E\\{x[n+m]y^*[n]\\}$ 表示**把 $x$ 向前推 $m$ 去对齐 $y$**。' },
          { t: 'math', tex: 'R_{xy}[m] = E\\!\\left\\{x[n+m]\\,y^*[n]\\right\\},\\qquad R_{yx}[m] = R_{xy}^*[-m]', tag: '(8)' },
          { t: 'md', md: '由此立刻得到与自相关截然不同的三条结论：**一，互相关一般不是偶函数**（$R_{xy}[m]\\neq R_{xy}[-m]$），这正是能判断"谁先到、谁后到"的原因；**二，交换两路信号等于把横坐标翻褶**；**三，峰值可以出现在任意滞后处**，这个位置就是待求的时延。工程实现务必记住自己的调用约定是 $x$ 相对 $y$ 的滞后，还是反过来，否则测距会整体差一个符号。' },
          { t: 'md', md: '下图是一个完整的主动测距场景：发射一段扫频脉冲，接收端叠加噪声与一次海面/海底多径，做互相关后测量滞后。所有数值都是页面加载时现场计算的。' },
          {
            t: 'widget', render: function (el) {
              const N = 2048, fs = 20000, M = 400;                 // 记录 102.4 ms，脉冲 20 ms
              const tx = C.chirp(M, fs, 2000, 6000, M / fs);       // 2→6 kHz，带宽 4 kHz
              const rec = new Float64Array(N);
              const d0 = 600, d1 = 1010;                            // 直达 + 多径（弱 6 dB）
              for (let i = 0; i < M; i++) { rec[d0 + i] += tx[i]; rec[d1 + i] += 0.5 * tx[i]; }
              let sp = 0;
              for (let i = 0; i < M; i++) sp += tx[i] * tx[i];
              sp /= M;
              const sigma = Math.sqrt(sp / Math.pow(10, -3 / 10));  // 脉冲内 SNR = −3 dB
              const g = U.randn(N, 20261024);
              for (let i = 0; i < N; i++) rec[i] += sigma * g[i];

              const xc = C.xcorr(rec, tx);
              const env = C.envelope(xc.r);
              const lagMs = gen(xc.lags.length, i => xc.lags[i] / fs * 1000);
              const tRec = gen(N, i => i / fs * 1000);
              const tTx = gen(M, i => i / fs * 1000);

              let pk = 0, pkv = 0;
              for (let i = 0; i < env.length; i++) if (env[i] > pkv) { pkv = env[i]; pk = i; }
              const dlt = parabDelta(env[pk - 1], env[pk], env[pk + 1]);
              const mFine = xc.lags[pk] + dlt;
              const c0 = 1500;
              const tauMs = mFine / fs * 1000;
              const range = tauMs / 1000 * c0 / 2;

              const envDb = toDbNorm(env, -60);

              figure(el, 1, [
                {
                  title: '发射信号（副本）：2→6 kHz 线性调频，脉宽 20 ms，带宽 4 kHz',
                  caption: '宽带信号是时延估计的前提：带宽越宽，自相关峰越窄，测距越准。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 170, xlabel: 't / ms', ylabel: '幅度', legend: false });
                    p.add({ x: tTx, y: tx, color: 0, width: 1.4 }).draw();
                  }
                },
                {
                  title: '接收记录：真实回波完全淹没在噪声中（全带信噪比 −3 dB）',
                  caption: '直达回波在 30 ms 处，多径在 50.5 ms 处，肉眼在时域上完全无法分辨。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 170, xlabel: 't / ms', ylabel: '幅度', legend: false });
                    p.add({ x: tRec, y: rec, color: 4, width: 1, alpha: 0.9 })
                      .vline(d0 / fs * 1000, { label: '直达 30.0 ms', dash: [5, 3] })
                      .vline(d1 / fs * 1000, { label: '多径 50.5 ms', color: '#8b5cf6', dash: [4, 3] })
                      .draw();
                  }
                },
                {
                  title: '互相关输出（希尔伯特包络，dB）：噪声被压制，两个回波清晰分离',
                  caption: '抛物线插值后测得主峰滞后 ' + tauMs.toFixed(3) + ' ms → 距离 ' + range.toFixed(2) + ' m（声速 1500 m/s，双程）',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 245, xlabel: '滞后 / ms', ylabel: '归一化幅度 / dB', legend: false, ylim: [-42, 2] });
                    p.add({ x: lagMs, y: envDb, color: 0, width: 1.5 })
                      .vline(d0 / fs * 1000, { label: '真实直达', dash: [5, 3] })
                      .vline(d1 / fs * 1000, { label: '多径（弱 6 dB）', color: '#8b5cf6', dash: [4, 3] })
                      .hline(-13.4, { label: 'LFM 理论旁瓣 −13.4 dB', color: '#b45309' })
                      .annotate(tauMs, 1.2, '峰值 → 时延估计', { dy: -8 })
                      .draw();
                  }
                }
              ]);
            }
          },
          { t: 'md', md: '读这张图要抓住三点：**一，相关峰的宽度约等于 $1/B$**，本例 $B=4\\,\\text{kHz}$，峰宽约 0.25 ms，对应距离分辨率 $c/(2B)\\approx 0.19\\,$m；**二，两个回波相距 20.5 ms**，远大于峰宽，因此能被分离——若两者间距小于一个峰宽，就会合并成一个畸变的单峰，这就是多径环境下的分辨率极限；**三，弱回波只低 6 dB 却仍然清晰**，这是处理增益的直接体现（后续「匹配滤波」一节会给出它的定量公式 $10\\log_{10}(BT)$）。' },
          { t: 'callout', kind: 'eng', title: '工程师视角：时延估计的三类典型应用', md: '**主动声呐/雷达测距**：相关峰滞后乘声速再除以 2 就是距离，是现代测距的基本实现方式。**被动定位**：两条相距 $D$ 的水听器做互相关得到到达时差 $\\Delta t$，双曲线定位由 $c\\Delta t$ 给出。此时 $\\Delta t$ 的估计精度直接决定了定位精度，且基线越长精度越高。**多径导致峰分裂**：浅海声信道中直达、海面反射、海底反射会形成多个相关峰，此时"取最大峰"可能错误地锁定到更强但更远的路径；工程上要结合信道先验、首达波检测与前视窗处理。' },
          { t: 'callout', kind: 'pit', title: '误区：把相关峰滞后直接当成传播时延', md: '相关峰滞后是**相对参考点的时间偏移**，要换算成物理量必须补偿：采样窗起点与发射时刻的对齐偏差、发射与接收链路的固定延迟（换能器响应时间、电缆、滤波器群延迟）、以及把样本数换算成秒所用的采样率。雷达/声呐标定流程里这被称为"零距离校准"，漏掉它会带来几十米甚至更大的固定偏差，而且这个偏差不会被增加信噪比所改善。' }
        ]
      },
      /* ---------------- 5 ---------------- */
      {
        id: 'wss', num: '5', title: '维纳-辛钦定理：相关与谱是同一件事的两面',
        blocks: [
          { t: 'md', md: '对一个**广义平稳**随机序列，自相关函数与功率谱密度构成一对离散时间傅里叶变换。这条定理把"时域相关"与"频域功率分布"完全打通，是整个现代谱估计与随机信号处理的地基。' },
          { t: 'math', tex: 'P_{xx}(e^{j\\omega}) = \\sum_{m=-\\infty}^{\\infty} R_{xx}[m]\\,e^{-j\\omega m},\\qquad R_{xx}[m] = \\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi} P_{xx}(e^{j\\omega})\\,e^{j\\omega m}\\,\\mathrm{d}\\omega', tag: '(9)' },
          { t: 'callout', kind: 'tip', title: '一句话记住它的价值', md: '时域里难做的事（检测窄带成分、估计中心频率、看功率如何随频率分布），换到频域一目了然；频域里难做的事（测时延、看重复周期、看能量在时间上的聚集），换到时域一目了然。维纳-辛钦定理保证这两个视角**信息完全等价**，所以你永远可以选好算的那一边。' },
          { t: 'fold', summary: '展开：维纳-辛钦定理的完整推导', deriv: true, blocks: [
            { t: 'md', md: '设 $x[n]$ 广义平稳，取长度 $N$ 的样本并令其余为零，其 DTFT 为 $X_N(\\omega)=\\sum_{n=0}^{N-1}x[n]e^{-j\\omega n}$。对**单样本实现**的周期取 EOF 期望：' },
            { t: 'math', tex: 'E\\!\\left\\{\\frac{1}{N}|X_N(\\omega)|^2\\right\\} = \\frac{1}{N}\\sum_{n=0}^{N-1}\\sum_{k=0}^{N-1} E\\!\\left\\{x[n]x^*[k]\\right\\} e^{-j\\omega(n-k)}', tag: '(10)' },
            { t: 'md', md: '由平稳性，$E\\{x[n]x^*[k]\\} = R_{xx}[n-k]$ 只依赖差值 $m=n-k$。把双重求和按 $m$ 整理：对固定的 $m$，满足 $n-k=m$ 且 $0\\le n,k\\le N-1$ 的下标对共有 $N-|m|$ 个，于是' },
            { t: 'math', tex: 'E\\!\\left\\{\\frac{1}{N}|X_N(\\omega)|^2\\right\\} = \\sum_{m=-(N-1)}^{N-1}\\left(1-\\frac{|m|}{N}\\right) R_{xx}[m]\\,e^{-j\\omega m}', tag: '(11)' },
            { t: 'md', md: '可以看到，**有偏估计的三角权 $\\left(1-\\frac{|m|}{N}\\right)$ 是数学推导自然出现的，不是人为加窗**。当 $N\\to\\infty$ 且 $\\sum_m |m|\\,|R_{xx}[m]| < \\infty$（短相关条件）时，三角权趋于 1，得到' },
            { t: 'math', tex: '\\lim_{N\\to\\infty} E\\!\\left\\{\\frac{1}{N}|X_N(\\omega)|^2\\right\\} = \\sum_{m=-\\infty}^{\\infty} R_{xx}[m]\\,e^{-j\\omega m} \\equiv P_{xx}(e^{j\\omega})', tag: '(12)' },
            { t: 'md', md: '这就是定理本身。注意推导中有两个必须记住的前提：**一是平稳**（否则 $R_{xx}$ 依赖绝对时间，式 (10) 不成立）；**二是短相关**（即 $R_{xx}[m]$ 足够快衰减）。不满足短相关时（例如强色噪声、长相关海杂波），周期图的期望不再收敛到真谱，这就是实践中必须对长序列做分段与窗函数的深层理由。' }
          ] },
          { t: 'callout', kind: 'note', title: '两条估计路线', md: '**直接法（周期图类）**：先 $|X|^2$ 再平均——Bartlett（分段不重叠）与 Welch（分段重叠 + 窗）。**间接法（Blackman-Tukey）**：先估有偏自相关，加窗抑制大滞后处的高方差尾巴，再变换到频域。二者本质都是用分辨率换方差，见「功率谱密度」一节。' }
        ]
      },
      /* ---------------- 6 ---------------- */
      {
        id: 'tdoa', num: '6', title: '时延精度：分辨率、旁瓣、插值与多径',
        blocks: [
          { t: 'md', md: '相关峰并非一根无限细的针，它有宽度、有旁瓣。测距与测角的一切精度讨论，归结为对**相关峰形状**的讨论。' },
          { t: 'math', tex: '\\Delta \\tau \\approx \\frac{1}{B},\\qquad \\Delta R = \\frac{c}{2B}\\quad(\\text{双程}),\\qquad \\sigma_\\tau \\approx \\frac{1}{B\\sqrt{2\\,\\mathrm{SNR}\\cdot BT}}', tag: '(13)' },
          { t: 'md', md: '第一个式子是**分辨率**（两个目标要分开需要的最小间隔），第三式是**估计精度**（单个目标时延估计的标准差）。二者差一个 $\\sqrt{\\mathrm{SNR}}$ 因子——这正是"信噪比不能买来分辨率，但能买来精度"的定量表述。下面这幅图对比了两种同样脉宽、同样能量的信号：单频矩形脉冲与线性调频脉冲。' },
          {
            t: 'widget', render: function (el) {
              const fs = 20000, T = 0.02, M = 400;
              const lfm = C.chirp(M, fs, 2000, 6000, T);
              const cw = gen(M, i => Math.sin(2 * Math.PI * 4000 * i / fs));
              function acfEnvDb(x) {
                const ac = C.autocorr(x);
                const e = C.envelope(ac.r);
                return { db: toDbNorm(e, -60), lag: ac.lags, ac: ac };
              }
              const A = acfEnvDb(cw), Bl = acfEnvDb(lfm);
              const MsOf = l => gen(l.length, i => l[i] / fs * 1000);
              const pmA = C.pulseMetrics(A.ac.r, { raw: false });
              const pmB = C.pulseMetrics(Bl.ac.r, { raw: false });
              figure(el, 2, [
                {
                  title: '全览（±40 ms）：同样脉宽的单频脉冲 vs 线性调频脉冲',
                  caption: 'CW 的相关峰是底宽 2T 的三角包络，LFM 是一根宽度约 1/B 的尖峰。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 235, xlabel: '滞后 / ms', ylabel: '归一化 / dB', legend: true, legendPos: 'tr', xlim: [-40, 40], ylim: [-45, 3] });
                    p.add({ x: MsOf(A.lag), y: A.db, color: 1, width: 1.6, label: '单频矩形脉冲（带宽≈1/T）' })
                      .add({ x: MsOf(Bl.lag), y: Bl.db, color: 0, width: 1.6, label: '线性调频脉冲（带宽 4 kHz）' })
                      .draw();
                  }
                },
                {
                  title: '放大（±2 ms）：LFM 自相关的 −13.4 dB 旁瓣结构',
                  caption: '实测峰值旁瓣电平 PSL = ' + pmB.psl.toFixed(1) + ' dB，积分旁瓣比 ISLR = ' + pmB.islr.toFixed(1) + ' dB；−3 dB 主瓣宽 ' + pmB.width3dB.toFixed(2) + ' 样本 ≈ 1/B。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 235, xlabel: '滞后 / ms', ylabel: '归一化 / dB', legend: true, legendPos: 'tr', xlim: [-2, 2], ylim: [-45, 3] });
                    p.add({ x: MsOf(Bl.lag), y: Bl.db, color: 0, width: 1.6, label: 'LFM 自相关包络' })
                      .hline(-13.4, { label: '理论 −13.4 dB', color: '#b45309' })
                      .hline(-3, { label: '−3 dB', color: '#334155' })
                      .draw();
                  }
                }
              ]);
            }
          },
          { t: 'md', md: '提高时延估计精度有四条常规手段：**一是插值。** 直接取离散最大点只能精确到 $\\pm T_s/2$；对峰值及左右两点做抛物线插值可把精度提高近一个数量级。' },
          { t: 'math', tex: '\\hat m = m_0 + \\frac{1}{2}\\cdot\\frac{r[m_0-1]-r[m_0+1]}{r[m_0-1]-2r[m_0]+r[m_0+1]}', tag: '(14)' },
          { t: 'md', md: '注意插值应当在**希尔伯特解析包络**（或对数幅度）上做，而不是在带载波振荡的原始相关输出上做，否则在实信号的振荡分量上会插到错误的零点。' },
          { t: 'md', md: '**二是提高采样率或做频域补零。** 补零只是对相关函数做插值细化，并不增加信息，但能让峰位置的可读性显著改善。**三是加窗抑制旁瓣。** 对相关结果（等价地给模板或给参考副本加频谱成形窗）加汉宁/汉明窗，可把 $-13.4$ dB 的旁瓣压到 $-30$ dB 以下，代价是主瓣展宽约 1.3～1.6 倍，分辨率下降。**四是窄的频率支撑要想办法变宽**——这是唯一真正能提升分辨率的途径，其他都是精化。' },
          { t: 'metrics', list: [
            { label: '理论距离分辨率 c/2B（B=4 kHz）', value: '0.19', unit: 'm' },
            { label: 'LFM 自相关主瓣宽 (−3 dB)', value: '≈ 1/B = 0.25', unit: 'ms' },
            { label: '未加权旁瓣电平', value: '−13.4', unit: 'dB' },
            { label: '汉明加权后旁瓣（典型值）', value: '−40 左右', unit: 'dB' },
            { label: '加权带来的信噪比损失', value: '1～3', unit: 'dB' }
          ] },
          { t: 'callout', kind: 'eng', title: '多径：相关峰分裂与首达波锁定', md: '浅海水平信道中，一次发射往往经由多条路径到达；在时延剖面上表现为多个相关峰。若最强路径不是最早路径，取全局最大峰会导致系统性距离偏大的"拖尾"现象。工程对策是**首达波检测**：在预测的时间窗内找第一个超过自适应门限的峰，并用前后沿斜率与脉冲模板做二次确认。此外还可用宽带信号的自相关宽度随路径增加而展宽的特性做辅助判别。' }
        ]
      },
      /* ---------------- 7 ---------------- */
      {
        id: 'fft', num: '7', title: '相关与卷积的等价、FFT 实现与循环混叠陷阱',
        blocks: [
          { t: 'md', md: '把式 (1) 中的 $n$ 换成 $-n$ 就能看出：相关就是**翻转后再卷积**。这一等价性让我们可以复用所有卷积的快速算法，也埋下了最大的实现陷阱。' },
          { t: 'math', tex: 'R_{xy}[m] = x[m] \\star y[m] = \\big(x[m] * y^*[-m]\\big) \\quad\\Longleftrightarrow\\quad S_{xy}(z) = X(z)\\,Y^*(1/z^*)', tag: '(15)' },
          { t: 'flow', v: false, items: [
            { t: '取参考副本 $y$', d: '发射样本' },
            { t: '共轭翻转', d: '$y^*[-n]$' },
            { t: '与 $x$ 卷积', d: '或直接相关' },
            { t: '取模 / 包络', d: '定位峰值' }
          ] },
          { t: 'md', md: '用 FFT 做相关的标准流程是：把两序列都**补零到不少于 $N+M-1$**（通常取不小于它的 2 的幂），分别对 $x$ 与 $y$ 做正变换，取 $X\\cdot Y^*$ 后反变换。关键就在"补零"二字——**DFT 天然是循环卷积**，只有补够长度，循环卷积才等于线性卷积。' },
          { t: 'callout', kind: 'warn', title: '补零长度铁律', md: '设记录长 $N$、模板长 $M$，则 FFT 长度必须满足 $L \\ge N+M-1$。漏掉补零时，相关函数中 $|m| > L/2$ 的部分会**折返**到序列另一端，在时延剖面上表现为出现在时间轴开头的虚假目标。若一次相關横跨多个数据块（长连续记录的分块处理），还必须使用重叠保留（overlap-save）或重叠相加（overlap-add）来保证块间的正确性。' },
          {
            t: 'widget', render: function (el) {
              const N = 2048, fs = 20000, M = 400;
              const tx = C.chirp(M, fs, 2000, 6000, M / fs);
              const rec = new Float64Array(N);
              const dTrue = 1900;                                    // 回波靠近记录末端
              for (let i = 0; i < M; i++) rec[dTrue + i] += tx[i];
              let sp = 0;
              for (let i = 0; i < M; i++) sp += tx[i] * tx[i];
              sp /= M;
              const sigma = Math.sqrt(sp / Math.pow(10, 2 / 10));
              const g = U.randn(N, 4242);
              for (let i = 0; i < N; i++) rec[i] += sigma * g[i];

              // 正确：线性相关（内部已按 N+M−1 处理）
              const lin = C.xcorr(rec, tx);
              const linEnv = C.envelope(lin.r);
              // 错误：不补零的循环相关（长度取 N）
              const X = C.fft(rec, N);
              const Y = C.fft(tx, N);
              const S = C.cplx(N);
              for (let i = 0; i < N; i++) {
                S.re[i] = X.re[i] * Y.re[i] + X.im[i] * Y.im[i];
                S.im[i] = X.im[i] * Y.re[i] - X.re[i] * Y.im[i];
              }
              const cc = C.ifft(S);
              const ccEnv = C.envelope(cc.re);

              const msLin = gen(lin.lags.length, i => lin.lags[i] / fs * 1000);
              const msCc = gen(N, i => i / fs * 1000);
              figure(el, 2, [
                {
                  title: '正确做法：线性相关（有效长度 ≥ N+M−1）',
                  caption: '真实回波在 ' + (dTrue / fs * 1000).toFixed(1) + ' ms（接近记录末端），只有一个峰。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 240, xlabel: '滞后 / ms', ylabel: '归一化 / dB', legend: false, ylim: [-45, 3] });
                    p.add({ x: msLin, y: toDbNorm(linEnv, -60), color: 0, width: 1.5 })
                      .vline(dTrue / fs * 1000, { label: '真实回波' })
                      .draw();
                  }
                },
                {
                  title: '错误做法：FFT 长度取 N（不补零）→ 循环混叠',
                  caption: '超出长度的能量折返到开头，出现一个虚假"近距离目标"，比真回波更早更强。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 240, xlabel: '滞后（循环）/ ms', ylabel: '归一化 / dB', legend: false, ylim: [-45, 3] });
                    p.add({ x: msCc, y: toDbNorm(ccEnv, -60), color: 2, width: 1.5 })
                      .vline(dTrue / fs * 1000, { label: '真实回波位置', dash: [5, 3] })
                      .band(0, 20, { color: '#b91c1c', alpha: 0.10 })
                      .annotate(10, -6, '折返形成的虚假近距峰', { color: '#b91c1c', dy: -8 })
                      .draw();
                  }
                }
              ]);
            }
          },
          { t: 'callout', kind: 'pit', title: '误区：混用有偏与无偏估计', md: '同一段处理流程里，一部分环节用有偏估计（例如 FFT 相关算出的相关函数），另一部分用无偏估计（例如自写的时延域累加却除以 $N-|m|$），会让后续门限、信噪比与功率标定全部错位。约定俗成的做法是：**全链路统一使用有偏形式**（直接除以 $N$），把偏差作为已知的系统因子记录下来，在标定时一次性处理。' },
          { t: 'callout', kind: 'pit', title: '误区：以为相关总能给出正确的时延', md: '相关峰只有在"模板与实际回波波形一致"时才等于真实时延。目标多普勒会使回波被压缩或展宽，宽带情形下这种尺度变化不能用简单的时移近似，需要与多普勒补偿联合搜索；信道的多径与色散同样会使相关峰移动或分裂。忽略这些因素而直接取峰，得到的偏差通常远大于插值和提高采样率所能挽回的精度。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, Discrete-Time Signal Processing, 3rd ed., 第 10 章（相关与谱）',
      'Kay, Fundamentals of Statistical Signal Processing: Estimation Theory（时延估计的克拉美罗界）',
      'Burdic, Underwater Acoustic System Analysis（相关法测距与多径）',
      'Richards, Fundamentals of Radar Signal Processing（脉压与距离分辨率）'
    ]
  });

  /* ============================================================
     2. 功率谱密度 PSD
     ============================================================= */
  doc.register('theory/random/psd', {
    title: '功率谱密度：随机信号的"能量分布地图"',
    lede: '随机信号没有 DTFT，只有功率——于是必须有一张描述"功率如何沿频率分布"的图，那就是功率谱密度。它的一半混乱来自单边/双边的 3 dB，另一半来自把它当成"频谱"来读。',
    tags: ['随机信号', '功率谱密度', '维纳-辛钦', '谱估计'],
    toc: true,
    intro: '如果你只能记住这一页的一句话，请记住：**功率谱密度的单位里一定带"每赫兹"三个字**。所有关于 3 dB、关于带宽、关于噪声谱级的错误，几乎都源于把它当成不含带宽的量。',
    sections: [
      /* ---------------- 1 ---------------- */
      {
        id: 'why', num: '1', title: '为什么随机信号不能用频谱描述',
        blocks: [
          { t: 'md', md: '对一个能量信号（单脉冲、有限长扫频），能量有限，DTFT 存在，频谱 $X(e^{j\\omega})$ 是一个确定的普通函数，可以直接画 $|X|$ 与 $\\angle X$。对一个平稳随机过程则完全不同：它的每一次实现都不同，样本永不衰减到零，总能量无穷，**DTFT 不收敛**（严格地说只在广义函数的意义下存在冲激串）。' },
          { t: 'math', tex: 'E = \\sum_{n=-\\infty}^{\\infty}|x[n]|^2 \\;\\to\\; \\infty \\quad(\\text{平稳随机过程}),\\qquad P = \\lim_{N\\to\\infty}\\frac{1}{2N+1}\\sum_{n=-N}^{N}|x[n]|^2 = R_{xx}[0] < \\infty', tag: '(1)' },
          { t: 'md', md: '既然总能量无穷而平均功率有限，唯一有意义的问题是：**这份有限的功率在各个频率上是如何分配的？** 这就是功率谱密度要回答的问题。由维纳-辛钦定理，它与自相关函数互为变换对：' },
          { t: 'math', tex: 'P_{xx}(e^{j\\omega}) = \\mathcal{F}\\{R_{xx}[m]\\} = \\sum_{m=-\\infty}^{\\infty}R_{xx}[m]e^{-j\\omega m},\\qquad R_{xx}[0] = \\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}P_{xx}(e^{j\\omega})\\mathrm{d}\\omega = P', tag: '(2)' },
          { t: 'md', md: '式 (2) 右边那个积分是整个这一页的关键：**功率谱密度在全频带上的积分等于信号总功率**。这告诉我们两件事：一是 $P_{xx}$ 的量纲必然是"功率每单位频率"；二是任何按频率积分的操作（例如"噪声功率 = 谱密度 × 带宽"）都必须显式写出带宽。' },
          { t: 'callout', kind: 'note', title: '功率谱密度与能量谱密度的区别', md: '**能量谱密度**是 $|X(e^{j\\omega})|^2$，单位 V$^2$·s（或 V$^2$/Hz 但积分有限）；**功率谱密度**是 $P_{xx}$，单位 V$^2$/Hz，且积分在整个频带上有限。二者差一个观测时长 $T$：$|X|^2 \\approx T\\cdot P_{xx}$。混用会导致信噪比差几十 dB——这是本篇第一条也是最常见的一条错误。' }
        ]
      },
      /* ---------------- 2 ---------------- */
      {
        id: 'wss', num: '2', title: '维纳-辛钦定理的完整表述',
        blocks: [
          { t: 'md', md: '严格表述：若离散随机序列 $x[n]$ **广义平稳**（均值常数、自相关只依赖时间差），且其自相关函数绝对可和 $\\sum_m|R_{xx}[m]| < \\infty$，则其功率谱密度存在且等于自相关函数的 DTFT。' },
          { t: 'fold', summary: '展开：完整推导（与常见教科书略有不同——这里强调估计子的角色）', deriv: true, blocks: [
            { t: 'md', md: '取 $N$ 点样本 $x[0..N-1]$，令窗外观测为零，记 $X_N(\\omega)=\\sum_{n=0}^{N-1}x[n]e^{-j\\omega n}$。定义**周期图** $I_N(\\omega)=\\frac{1}{N}|X_N(\\omega)|^2$。' },
            { t: 'md', md: '第一步，把模方写成二重求和并利用平稳性：' },
            { t: 'math', tex: 'E\\{I_N(\\omega)\\} = \\frac{1}{N}\\sum_{n=0}^{N-1}\\sum_{k=0}^{N-1}R_{xx}[n-k]\\,e^{-j\\omega(n-k)} = \\sum_{m=-(N-1)}^{N-1}\\Big(1-\\tfrac{|m|}{N}\\Big)R_{xx}[m]e^{-j\\omega m}', tag: '(3)' },
            { t: 'md', md: '第二步，令 $N\\to\\infty$，三角权趋于 1，得到 $\\lim_{N\\to\\infty}E\\{I_N(\\omega)\\}=P_{xx}(e^{j\\omega})$。注意这是**期望收敛**。' },
            { t: 'md', md: '第三步，考察方差。对高斯过程可证 $\\mathrm{Var}\\{I_N(\\omega)\\}\\approx P_{xx}^2(\\omega)$，即**标准差与均值同量级，且不随 $N$ 下降**。这就是单次周期图"毛刺永远去不掉"的根因，也是谱估计必须平均（Bartlett/Welch）或使用参数模型（AR）的根本理由。' },
            { t: 'md', md: '最后补充一条常被忽略的事实：若 $R_{xx}[m]$ 不绝对可和（例如强相关的海杂波、接近 $1/f$ 的极低频漂移），上述极限不再存在，此时必须借助窗函数或更严谨的广义函数表述。' }
          ] },
          { t: 'callout', kind: 'tip', title: '这一定理在实践中的三条推论', md: '**其一，谱可以通过相关间接得到**（Blackman-Tukey 法）；**其二，相关峰的宽度就是谱宽的倒数**，宽带信号有窄相关峰、窄带过程有宽相关过程，这一对偶关系是脉冲压缩与多普勒分辨的全部基础；**其三，去相关等于白化**：若能把相关矩阵变成对角阵，噪声就变成白的，检测器结构可以大大简化。' }
        ]
      },
      /* ---------------- 3 ---------------- */
      {
        id: 'onedouble', num: '3', title: '单边谱与双边谱：那个永恒的 3 dB',
        blocks: [
          { t: 'md', md: '实信号的双边功率谱密度 $P_{xx}(e^{j\\omega})$ 是**偶对称**的：正负频率各占一半功率。工程上习惯只画正频率，把负频率那份能量折过来，于是所有非直流、非奈奎斯特的频率点都要乘 2。' },
          { t: 'math', tex: 'P^{\\text{单}}_{xx}(f) = \\begin{cases} P^{\\text{双}}_{xx}(f), & f = 0 \\text{ 或 } f = f_s/2 \\\\[2pt] 2\\,P^{\\text{双}}_{xx}(f), & 0 < f < f_s/2 \\end{cases}', tag: '(4)' },
          { t: 'math', tex: '\\int_0^{f_s/2} P^{\\text{单}}_{xx}(f)\\,\\mathrm{d}f = \\int_{-f_s/2}^{f_s/2} P^{\\text{双}}_{xx}(f)\\,\\mathrm{d}f = \\sigma_x^2', tag: '(5)' },
          { t: 'md', md: '在 dB 坐标下乘 2 等于加 $10\\log_{10}2 = 3.01$ dB。**这一页最重要的一句话**：单边谱比双边谱高 3 dB，两边功率总量相同。凡是涉及绝对功率（噪声谱级、信噪比、灵敏度预算）的计算，第一步永远是确认自己拿的是单边还是双边。' },
          { t: 'table', cols: ['场景', '应该用', '典型后果（用错时）'], rows: [
            ['报告噪声谱级 NL（dB re 1 µPa²/Hz）', '单边谱密度', '差 3 dB → 作用距离误差约 15% ~ 20%'],
            ['推导维纳-辛钦、做数学推导', '双边谱密度', '式子两侧不匹配，中间步骤对不上'],
            ['白噪声建模 σ² = ∫P df', '二者皆可，但积分域不同', '方差算成 2 倍或半倍'],
            ['复解析（基带 IQ）信号', '本身就是单边，无需乘 2', '重复乘 2 导致虚增 3 dB']
          ] },
          { t: 'callout', kind: 'pit', title: '误区：单边双边弄混导致的 3 dB 偏差', md: '这是声呐方程里最常见的系统偏差来源。海洋环境噪声谱级 NL 通常定义为**单边**谱密度，单位 dB re 1 µPa²/Hz；如果代码里用 FFT 算出的是双边结果又不乘 2，NL 会低 3 dB；反过来，若先按单边算出 NL，又在后续计算里默认它是双边再乘一次 2，则虚高 3 dB。同样地，接收机带宽内噪声功率 $= \\text{NL} + 10\\log_{10}B$，这里的 NL 必须带宽参考一致。**经验做法：在所有脚本入口处，用常量把"本工程统一使用单边谱"写死，并在绘图标题上标注单位。**' }
        ]
      },
      /* ---------------- 4 ---------------- */
      {
        id: 'phys', num: '4', title: '物理单位、积分含义与噪声谱级',
        blocks: [
          { t: 'md', md: '功率谱密度的单位是"功率单位每赫兹"。对声学是 µPa$^2$/Hz，对电学是 V$^2$/Hz 或 dBm/Hz。由此派生出一系列工程惯例：' },
          { t: 'kv', title: '常用约定', pairs: [
            ['$P_{xx}$', '功率谱密度，单位 V²/Hz（或 µPa²/Hz）'],
            ['NL', '噪声谱级，$10\\log_{10}\\big(P_{xx}/P_{\\mathrm{ref}}\\big)$，声学常以 1 µPa²/Hz 为参考'],
            ['$10\\log_{10}B$', '带宽因子：带宽内总噪声功率 = NL + $10\\log_{10}B$'],
            ['$\\sigma^2$', '总功率（方差）= 谱密度在整个频带上的积分 $= R_{xx}[0]$'],
            ['$1\\,\\mathrm{Hz}$ 带宽约定', 'dB re 1 µPa²/Hz 与 dB re 1 µPa² 在数值上相差恰为 $10\\log_{10}(1\\,\\mathrm{Hz})=0$，但物理意义不同，书写不可省略 "/Hz"']
          ] },
          { t: 'md', md: '再来区分三种容易混淆的对象：**连续谱**（噪声背景，由大量随机机制叠加，功率随频率连续分布）、**线谱**（确定性正弦成分，在频域是冲激，PSD 上表现为 Dirac $\\delta$，其"高度"不是密度而是一个有限功率值）、**谱线与带宽的积分关系**（一个幅度 $A$、中心 $f_c$ 的正弦，其功率为 $A^2/2$，均匀分配到线谱上；若在分辨率带宽 $\\Delta f$ 内观测，则观测到的"密度"是 $\\frac{A^2/2}{\\Delta f}$，**随分辨率带宽变化**）。最后这一条极其重要：**改变 FFT 分辨率会改变线谱在 PSD 图上的显示高度，但不会改变宽带噪声背景的高度。**' },
          { t: 'math', tex: 'P_{\\text{显示}}^{\\text{线谱}} = \\frac{A^2/2}{\\Delta f_{\\text{ENBW}}},\\qquad P_{\\text{显示}}^{\\text{噪声}} = \\frac{N_0}{2}\\;(\\text{不随 } \\Delta f \\text{ 变})', tag: '(6)' },
          { t: 'callout', kind: 'eng', title: '工程提示：为什么专业分析软件都给 dB/Hz', md: '用 dB/Hz 而不是 dB 的原因正是式 (6)：只有除以带宽后的密度量才与分辨率设置无关，才能让不同设备、不同设置下测得的背景噪声相互比较。做被动声呐的窄带检测时，通常同时维护两条曲线：**宽带背景（谱密度）用于计算检测门限**，**窄带线谱（功率）用于识别目标谐波**。把线谱的高密度值误当作背景，会导致门限被抬高而漏掉真正的目标。' },
          { t: 'callout', kind: 'pit', title: '误区：把功率谱密度当成功率谱', md: '功率谱（单位 dB）是把每个频率单元里的功率直接取对数，**它随 FFT 点数变化**：点数加倍，每个 bin 的带宽减半，宽带噪声的显示值下降 3 dB，而线谱高度不变。功率谱密度（dB/Hz）则二者行为相反且都不随点数变化。看图时务必先看纵坐标单位，否则"为什么换了个 FFT 长度噪声就降了"会浪费你半天时间。' }
        ]
      },
      /* ---------------- 5 ---------------- */
      {
        id: 'shapes', num: '5', title: '典型噪声的谱形：平坦、带限与 1/f',
        blocks: [
          { t: 'md', md: '**白噪声**：自相关为冲激 $R_{ww}[m]=\\sigma_w^2\\delta[m]$，PSD 处处平坦 $P_{ww}=\\sigma_w^2$（双边密度）。它是最容易处理的背景——任意不同频率上的样本互不相关。' },
          { t: 'math', tex: 'R_{ww}[m] = \\sigma_w^2\\delta[m] \\;\\Longleftrightarrow\\; P_{ww}(e^{j\\omega}) = \\sigma_w^2 \\quad(\\text{双边}),\\qquad P^{\\text{单}}_{ww} = \\frac{N_0}{2} \\cdot 2 = N_0', tag: '(7)' },
          { t: 'md', md: '**带限噪声**：物理可实现的噪声必须有界，任何真实系统都有 antialiasing 前端与换能器响应，于是白噪声经滤波后变成带限噪声：$P_{ww}(f) = \\frac{N_0}{2}|H(f)|^2$。**注意：带限噪声仍然可以在其通带内是"白的"，但当它的自相关不再近似冲激时，就再也不能当作白噪声处理。**' },
          { t: 'md', md: '**1/f（粉红）噪声**：$P_{xx}(f) \\propto 1/f^{\\beta}$，在对数-对数坐标上是一条斜率 $-\\beta$ 的直线，每倍频程下降 $3\\beta$ dB。$\\beta=0$ 为白噪声，$\\beta=1$ 为粉红噪声，$\\beta=2$ 为布朗（红）噪声。这类"无特征尺度"的谱在自然界极其常见。下图给出三种噪声的时域、自相关与 PSD（均为页面加载时现场计算），请重点观察：**谱越向低频集中，自相关越宽**。' },
          {
            t: 'widget', render: function (el) {
              const N = 4096, fs = 4096;
              // 1) 白噪声
              const white = U.randn(N, 1001);
              // 2) 带限噪声（白噪声过 8 阶 FIR 低通）
              const bl = C.firWin({ type: 'low', order: 48, fc: 0.12, win: 'hamming' });
              const band = C.filter(bl, new Float64Array([1]), white);
              // 3) 1/f 噪声：频域构造幅度 ∝ f^(−1/2)，随机相位
              const nz = U.randn(N, 2002);
              const S = C.fft(nz, N);
              const P = C.cplx(N);
              for (let k = 1; k <= N / 2; k++) {
                const amp = 1 / Math.sqrt(k);
                P.re[k] = S.re[k] * amp; P.im[k] = S.im[k] * amp;
                if (k < N / 2) { P.re[N - k] = S.re[N - k] * amp; P.im[N - k] = S.im[N - k] * amp; }
              }
              const pk = C.ifft(P);
              const pink = Float64Array.from(pk.re.subarray(0, N));

              function acf(x) {
                const c = C.autocorr(x);
                return { db: toDbNorm(C.envelope(c.r), -40), lags: c.lags };
              }
              const A = acf(white), Bb = acf(pink);
              const lagMs = gen(A.lags.length, i => A.lags[i]);
              const tms = gen(N, i => i / fs * 1000);

              figure(el, 3, [
                {
                  title: '时域：白噪声（上）与 1/f 噪声（下）',
                  caption: '1/f 噪声明显具有多尺度起伏结构——这是低频能量主导的直接表现。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 200, xlabel: 't / ms', ylabel: '幅度', legend: true, legendPos: 'tr' });
                    p.add({ x: tms, y: normPeak(white), color: 3, width: 1, alpha: 0.85, label: '白噪声' })
                      .add({ x: tms, y: normPeak(pink), color: 0, width: 1.2, label: '1/f 噪声' })
                      .draw();
                  }
                },
                {
                  title: '自相关（包络，dB）：白噪声是单根尖峰，1/f 有很长的尾巴',
                  caption: '相关宽度与谱宽互为倒数——这是维纳-辛钦定理最直观的体现。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 200, xlabel: '滞后 / 样本', ylabel: '归一化 / dB', legend: true, legendPos: 'tr', ylim: [-38, 3] });
                    p.add({ x: lagMs, y: A.db, color: 3, width: 1.4, label: '白噪声自相关' })
                      .add({ x: lagMs, y: Bb.db, color: 0, width: 1.4, label: '1/f 噪声自相关' })
                      .draw();
                  }
                },
                {
                  title: 'PSD（Welch 平均，dB/Hz，单边）：平坦谱与每十倍频程下降 10 dB 的斜率',
                  caption: '三条曲线：白噪声（平）、带限噪声（平但截止于 0.12 倍采样率）、1/f 噪声（斜率约 −10 dB/dec）。',
                  render: function (cv) {
                    const pw = C.pwelch(white, { segLen: 512, overlap: 0.5, win: 'hann', fs: fs });
                    const pb = C.pwelch(band, { segLen: 512, overlap: 0.5, win: 'hann', fs: fs });
                    const pp = C.pwelch(pink, { segLen: 512, overlap: 0.5, win: 'hann', fs: fs });
                    const dbN = arr => { let m = -Infinity; for (const v of arr) if (v > m) m = v; return gen(arr.length, i => 10 * Math.log10(Math.max(arr[i], 1e-20) / m)); };
                    const p = DSP.plot.new(cv, {
                      height: 200, xlabel: 'f / Hz', ylabel: 'PSD / dB (相对)', legend: true, legendPos: 'tr',
                      logY: false, xlim: [0, 2048], ylim: [-70, 5]
                    });
                    p.add({ x: pw.f, y: dbN(pw.psd), color: 3, width: 1.4, label: '白噪声' })
                      .add({ x: pb.f, y: dbN(pb.psd), color: 1, width: 1.4, label: '带限（截止 0.15 fs）' })
                      .add({ x: pp.f, y: dbN(pp.psd), color: 0, width: 1.5, label: '1/f 噪声' })
                      .draw();
                  }
                }
              ]);
            }
          },
          { t: 'md', md: '把这三幅图串起来读，就掌握了本节的核心直觉：**自相关是"记忆"的度量，谱是"时间尺度"的度量。** 白噪声没有任何记忆（滞后一处就是一个冲激），所以谱完全平坦；1/f 噪声有长程相关性（自相关拖很长），所以低频能量占主导。判别敌方辐射噪声、识别机械故障（轴承 vs 齿轮），本质上都是在对这张谱形图做模式识别。' }
        ]
      },
      /* ---------------- 6 ---------------- */
      {
        id: 'est', num: '6', title: '从数据到 PSD：周期图、平均与三角窗效应',
        blocks: [
          { t: 'md', md: '工程上拿到的是有限长样本，必须从样本估计 PSD。三条主线如下。' },
          { t: 'table', cols: ['方法', '做法', '分辨率 vs 方差', '适用'], rows: [
            ['周期图', '|X_N|²/N，不分段的单次 FFT', '分辨率最高（≈ fs/N），方差最大（不随 N 改善）', '强确定性成分的粗查'],
            ['Bartlett', '分 K 段不重叠、矩形窗、各自周期图后平均', '分辨率 ≈ K·fs/N，方差降为 1/K', '平稳长记录，要求方差稳定'],
            ['Welch', '分 $K$ 段、重叠 50%、加汉宁窗后平均', '分辨率略差于 Bartlett，方差更小、泄漏更低', '默认推荐'],
            ['Blackman-Tukey', '先估有偏自相关（隐含三角窗）→ 加窗 → DTFT', '分辨率由窗长决定，方差可控', '间接法，便于施加先验']
          ] },
          { t: 'md', md: '这里隐藏着一个漂亮的等价关系：**用长度为 $N$ 的样本估计自相关时隐含的三角权 $\\left(1-\\frac{|m|}{N}\\right)$，在频域上恰好等价于给真谱卷积了一个 Bartlett（三角）窗的频域核。** 也就是说，即使你没有显式加任何窗，有限长观测本身已经在频域抹出了一个宽度约 $1/N$ 的主瓣。这是"分辨率—方差折中"这一永恒主题在最简单的估计子身上的第一次现身。' },
          { t: 'math', tex: '\\hat P_{xx}(\\omega) = \\mathcal{F}\\Big\\{\\big(1-\\tfrac{|m|}{N}\\big)R_{xx}[m]\\Big\\} = P_{xx}(\\omega) \\;\\underset{\\omega}{*}\\; W_B(\\omega),\\quad W_B(\\omega)=\\frac{1}{N}\\Big(\\frac{\\sin(\\omega N/2)}{\\sin(\\omega/2)}\\Big)^2', tag: '(8)' },
          { t: 'callout', kind: 'eng', title: '谱级估计的工程做法', md: '（1）**先去均值去趋势**，否则直流泄漏会污染整个低频段；（2）**分段长度由所需最小分辨率决定**，$\\Delta f \\approx f_s/M_{\\text{seg}}$，先定 $\\Delta f$ 再反推 $M_{\\text{seg}}$，而不是反过来；（3）**重叠 50% 加窗**是 Welch 的标准配置，能把方差效率提高约 1.6 倍；（4）**报告结果必须写清单边/双边、窗类型、平均次数与参考单位**；（5）对非平稳数据（目标通过、海况突变），必须改用短时谱或分段统计，否则平均会把瞬态事件抹平。' },
          { t: 'callout', kind: 'pit', title: '误区：以为平均次数越多越好', md: '增加平均次数降低方差，但**每段长度随之变短会降低频率分辨率**，两个紧邻的窄带谱线可能被合并。反过来，一味追求长段而对极少段数做平均，得到的谱毛刺严重，随机起伏会被当成目标。折中的定量准则：先明确需要分辨的最小频率间隔 $\\delta f$，令段长 $M_{\\text{seg}} \\ge f_s/\\delta f$，然后在给定总数据长度下尽可能多地分段。' }
        ]
      },
      /* ---------------- 7 ---------------- */
      {
        id: 'pit', num: '7', title: '本节误区速查与工程对照',
        blocks: [
          { t: 'grid', cols: 2, items: [
            [{ t: 'callout', kind: 'pit', title: '① 单边/双边 3 dB', md: '详见第 3 节。噪声谱级 NL 按**单边**定义；数学推导多用双边。入口处写死约定，图上标注 dB/Hz。' }],
            [{ t: 'callout', kind: 'pit', title: '② 密度 vs 功率', md: 'PSD 带 /Hz。换 FFT 点数时宽带背景不变、线谱变；反之功率谱则是宽带背景变、线谱不变。' }],
            [{ t: 'callout', kind: 'pit', title: '③ 单次周期图当谱用', md: '周期图的方差不随数据量下降。看到毛刺不要急着判为目标，先做平均或改用 AR 参数谱。' }],
            [{ t: 'callout', kind: 'pit', title: '④ 忘记去均值与去趋势', md: '直流与慢漂移会把能量堆到低频，掩盖真正的低频目标，也会使积分出来的总功率偏大。' }]
          ] },
          { t: 'hr' },
          { t: 'callout', kind: 'eng', title: '工程师视角：三类背景谱对照', md: '**水声环境噪声 NL**：Knudsen 谱给出的经验规律是谱级随频率大致每倍频程下降约 5 dB 左右，低频由航运与海况主导，高频由分子热噪声主导；实际系统里更常用 Wenz 曲线族把航运、海况、生物与热噪声分段叠加。**雷达地杂波**：集中在零多普勒频率附近，谱宽由风速与天线扫描决定，通常用高斯谱建模。**海杂波**：有明显的多普勒展宽与长尾（复合 K 分布），不但谱形非高斯，幅度分布本身也非瑞利，这直接决定了恒虚警检测不能用简单的单元平均 CFAR。' },
          { t: 'callout', kind: 'eng', title: '声呐方程中的 NL 怎么来的', md: '被动声呐方程 $SE = SL - TL - (NL - DI) - DT$ 中的 $NL$ 是**接收带宽内**的噪声功率，$NL = NL_0 + 10\\log_{10}B$，其中 $NL_0$ 是 1 Hz 带宽内的噪声谱级。可见带宽每扩大 10 倍，噪声功率上升 10 dB；这也是为什么窄带检测（把 $B$ 做到 1 Hz 甚至更窄）能显著提高检测性能，代价是对目标线谱频率的稳定性要求变高（多普勒会造成谱线展宽而溢出窄带）。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, Discrete-Time Signal Processing, 第 10 章',
      'Kay, Modern Spectral Estimation: Theory and Application',
      'Urick, Principles of Underwater Sound（Knudsen 谱与 Wenz 曲线）',
      'Ward, Sea Clutter: Scattering, the K Distribution and Radar Performance'
    ]
  });

  /* ============================================================
     3. 白噪声与色噪声
     ============================================================= */
  doc.register('theory/random/noise', {
    title: '白噪声与色噪声：从理想模型到真实背景',
    lede: '白噪声是数学上的完美假设，物理上从不成立；真实系统里你面对的永远是色噪声。能不能识别"我的噪声到底是什么颜色"，直接决定滤波器、检测器与阵列处理的性能上限。',
    tags: ['随机信号', '白噪声', '色噪声', '海洋噪声', '杂波'],
    toc: true,
    intro: '这一页的主线是：**白噪声为什么好用 → 为什么不可能 → 真实噪声长什么样 → 如何从白噪声"造"出色噪声 → 色噪声下怎么处理 → 最后落到阵列处理中最容易被忽略的问题：噪声的空间相关性**。',
    sections: [
      /* ---------------- 1 ---------------- */
      {
        id: 'white', num: '1', title: '白噪声：定义、性质与物理上的不可能',
        blocks: [
          { t: 'md', md: '**白噪声**的定义有两条完全等价的表述，一条在时域，一条在频域：' },
          { t: 'math', tex: 'R_{ww}[m] = \\sigma_w^2\\,\\delta[m] \\;\\Longleftrightarrow\\; P_{ww}(e^{j\\omega}) = \\sigma_w^2 \\;\\;(\\text{双边，处处平坦})', tag: '(1)' },
          { t: 'md', md: '名字里的"白"来自光学：功率谱在所有频率上平坦，就像白光包含所有颜色。两个关键推论：**任何两个不同时刻的样本互不相关**（$m\\neq 0$ 时自相关为零）；**总功率等于方差**（直流分量为零时 $R_{ww}[0]=\\sigma_w^2$）。若再附加上每个样本服从高斯分布，就是高斯白噪声——它是"最坏也最好处理"的背景：最坏是因为没有结构可利用；最好是因为最优检测器有闭式解，性能界（克拉美罗界、奈曼-皮尔逊）都有干净的表达式。' },
          { t: 'callout', kind: 'warn', title: '为什么物理上不存在真白噪声', md: '把 $P_{ww}=\\sigma_w^2$ 从直流积分到无穷频率，得到**无穷大的总功率**——任何真实系统都不可能。物理上成立的说法只有三种：**带限白噪声**（在某通带内平坦，例如接收机前端带宽内）；**在某频段内近似平坦**（例如热噪声在远低于系统带宽的范围内平坦）；以及**离散仿真的白噪声**（采样率以内平坦，采样率以外根本不存在）。工程上判断"白噪声假设是否可用"，问的其实是：**在我关心的频带内，谱是否近似平坦；在我的处理带宽内，相关时间是否远小于样本间隔**。' },
          { t: 'md', md: '离散白噪声的自相关是冲激还有一层实际含义：**白噪声序列的相关矩阵是对角阵**。这使得维纳滤波、匹配滤波、波束形成的最优解都有闭式表达，也使得"对角加载""特征分解"之类的矩阵运算不至于病态。一旦噪声有色，相关矩阵出现非对角元素，上面这一切都要重新推导——这就是下一节要展开的内容。' }
        ]
      },
      /* ---------------- 2 ---------------- */
      {
        id: 'colored', num: '2', title: '三种典型色噪声与成形滤波器',
        blocks: [
          { t: 'md', md: '**色噪声**泛指谱不平坦的噪声。三种最有代表性的谱形：' },
          { t: 'table', cols: ['类型', '谱形', '自相关', '典型来源'], rows: [
            ['白噪声', '平坦', '冲激 σ²δ[m]', '电阻热噪声、量化误差（近似）'],
            ['粉红噪声（1/f）', '每十倍频程降 10 dB', '缓慢衰减、长程相关', '电子器件低频噪声、海洋噪声低频段、许多自然过程'],
            ['布朗噪声（1/f²）', '每十倍频程降 20 dB', '随滞后近似线性增长', '积分器输出、载体晃动、钟差漂移'],
            ['AR(1) 一阶色噪声', '(1−a²)/|1−a·e^(−jω)|²，低通型', '指数衰减 σ²·a^|m|', '信道多径展宽、杂波、流噪声（一阶近似）']
          ] },
          { t: 'md', md: '制造指定谱形色噪声的标准方法是**成形滤波器**：让白噪声通过一个频率响应为 $H(e^{j\\omega})$ 的线性系统，输出谱就是 $P_{out}(\\omega) = |H(e^{j\\omega})|^2\\,\\sigma_w^2$。设计问题因此反过来变成滤波器设计问题：想要什么谱，就设计什么幅频响应。' },
          { t: 'math', tex: 'w[n] \\;\\text{（白）}\\;\\longrightarrow\\; \\boxed{\\,H(e^{j\\omega})\\,}\\;\\longrightarrow\\; x[n],\\qquad P_{xx}(e^{j\\omega}) = |H(e^{j\\omega})|^2\\,\\sigma_w^2', tag: '(2)' },
          { t: 'fold', summary: '展开：AR(1) 一阶色噪声的谱与自相关（完整推导）', deriv: true, blocks: [
            { t: 'md', md: '一阶自回归模型的差分方程为 $x[n] = a\\,x[n-1] + \\sqrt{1-a^2}\\,w[n]$，其中 $0<a<1$，$w$ 为单位方差白噪声。系数 $\\sqrt{1-a^2}$ 保证输出方差归一。' },
            { t: 'math', tex: 'H(z) = \\frac{\\sqrt{1-a^2}}{1 - a z^{-1}} \\;\\Longrightarrow\\; |H(e^{j\\omega})|^2 = \\frac{1-a^2}{1 + a^2 - 2a\\cos\\omega}', tag: '(3)' },
            { t: 'md', md: '这是一个低通型的谱：$\\omega=0$ 处取最大值 $\\frac{1-a^2}{(1-a)^2} = \\frac{1+a}{1-a}$，$\\omega=\\pi$ 处取最小值 $\\frac{1-a^2}{(1+a)^2}$，两者之比 $\\left(\\frac{1+a}{1-a}\\right)^2$。$a\\to 1$ 时低通特性越来越尖锐，输出越来越"红"。' },
            { t: 'md', md: '自相关可由逆变换或直接递推得到：对 $m\\ge 1$，$R_{xx}[m] = a\\,R_{xx}[m-1]$，结合 $R_{xx}[0]=1$ 得' },
            { t: 'math', tex: 'R_{xx}[m] = a^{|m|},\\qquad P_{xx}(e^{j\\omega}) = \\sum_{m=-\\infty}^{\\infty} a^{|m|}e^{-j\\omega m} = \\frac{1-a^2}{1-2a\\cos\\omega + a^2}', tag: '(4)' },
            { t: 'md', md: '相关时间约 $-1/\\ln a \\approx 1/(1-a)$ 个样本。$a=0.9$ 时约 10 个样本，$a=0.99$ 时约 100 个样本——**一个参数同时控制了谱的形状与相关的长度**，这正是 AR(1) 成为最常用色噪声模型的原因。推广到 $P$ 阶（AR($P$)）可以拟合任意有理谱形，配套的 Yule-Walker 方程与 Levinson 递推是参数谱估计的核心。' }
          ] },
          {
            t: 'widget', render: function (el) {
              const N = 4096, fs = 4096, a = 0.92;
              const white = U.randn(N, 3001);
              const S = C.fft(U.randn(N, 3002), N);
              const Pp = C.cplx(N);
              for (let k = 1; k <= N / 2; k++) {
                const amp = 1 / Math.sqrt(k);
                Pp.re[k] = S.re[k] * amp; Pp.im[k] = S.im[k] * amp;
                if (k < N / 2) { Pp.re[N - k] = S.re[N - k] * amp; Pp.im[N - k] = S.im[N - k] * amp; }
              }
              const pink = Float64Array.from(C.ifft(Pp).re.subarray(0, N));
              const g = U.randn(N, 3003);
              const ar = new Float64Array(N);
              for (let n = 1; n < N; n++) ar[n] = a * ar[n - 1] + Math.sqrt(1 - a * a) * g[n];
              const unit = arr => {
                let m = 0;
                for (const v of arr) m += v * v;
                m = Math.sqrt(m / arr.length) || 1;
                return gen(arr.length, i => arr[i] / m);
              };
              const wN = unit(white), pN = unit(pink), aN = unit(ar);
              const tMs = gen(N, i => i / fs * 1000);
              const off = (arr, o) => gen(arr.length, i => arr[i] + o);
              figure(el, 3, [
                {
                  title: '时域对比（白 / 粉红 / AR(1)，纵向平移以便观察）',
                  caption: '谱越"红"，波形起伏越缓慢、越成块状。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 210, xlabel: 't / ms', ylabel: '幅度（平移显示）', legend: true, legendPos: 'tr' });
                    p.add({ x: tMs, y: off(wN, 2.4), color: 3, width: 0.9, alpha: 0.85, label: '白噪声' })
                      .add({ x: tMs, y: off(pN, 0), color: 0, width: 1.1, alpha: 0.95, label: '粉红 1/f' })
                      .add({ x: tMs, y: off(aN, -2.4), color: 1, width: 1.1, label: 'AR(1), a=0.92' })
                      .draw();
                  }
                },
                {
                  title: '功率谱密度（Welch，dB/Hz）：平坦、−10 dB/dec、低通型',
                  caption: 'AR(1) 虚线为理论谱 (1−a²)/|1−ae^{−jω}|²，与实测吻合。',
                  render: function (cv) {
                    const dbN = arr => {
                      let m = -Infinity;
                      for (const v of arr) if (v > m) m = v;
                      return gen(arr.length, i => 10 * Math.log10(Math.max(arr[i], 1e-20) / m));
                    };
                    const pw = C.pwelch(wN, { segLen: 512, overlap: 0.5, fs: fs });
                    const pp = C.pwelch(pN, { segLen: 512, overlap: 0.5, fs: fs });
                    const pa = C.pwelch(aN, { segLen: 512, overlap: 0.5, fs: fs });
                    const th = gen(pw.f.length, i => {
                      const om = 2 * Math.PI * pw.f[i] / fs;
                      const p0 = (1 + a) / (1 - a);
                      return 10 * Math.log10((1 - a * a) / (1 + a * a - 2 * a * Math.cos(om)) / p0);
                    });
                    const p = DSP.plot.new(cv, { height: 210, xlabel: 'f / Hz', ylabel: 'PSD / dB（相对）', legend: true, legendPos: 'tr', xlim: [0, 2048], ylim: [-70, 5] });
                    p.add({ x: pw.f, y: dbN(pw.psd), color: 3, width: 1.3, label: '白噪声' })
                      .add({ x: pp.f, y: dbN(pp.psd), color: 0, width: 1.4, label: '粉红 1/f' })
                      .add({ x: pa.f, y: dbN(pa.psd), color: 1, width: 1.5, label: 'AR(1) 实测' })
                      .add({ x: pw.f, y: th, color: 1, width: 1.2, dash: [5, 3], label: 'AR(1) 理论' })
                      .draw();
                  }
                },
                {
                  title: '自相关（前 64 滞后）：白噪声只剩一根，色噪声拖尾',
                  caption: '相关时间 1/(1−a) ≈ 12 样本——与谱宽互为倒数。',
                  render: function (cv) {
                    const L = 64;
                    const lags = gen(L, i => i);
                    const cW = C.autocorr(white, true), cP = C.autocorr(pink, true);
                    const mid = cW.r.length >> 1;
                    const p = DSP.plot.new(cv, { height: 210, xlabel: '滞后 / 样本', ylabel: '归一化自相关', legend: true, legendPos: 'tr', ylim: [-0.15, 1.05] });
                    p.add({ x: lags, y: gen(L, i => cW.r[mid + i]), color: 3, width: 1.3, label: '白噪声' })
                      .add({ x: lags, y: gen(L, i => cP.r[mid + i]), color: 0, width: 1.3, label: '粉红 1/f' })
                      .add({ x: lags, y: gen(L, i => Math.pow(a, i)), color: 1, width: 1.2, dash: [5, 3], label: 'AR(1) 理论 a^m' })
                      .draw();
                  }
                }
              ]);
            }
          },
          { t: 'callout', kind: 'eng', title: '工程师视角：色噪声怎么来的就怎么消', md: '成形滤波器的逆过程就是**白化滤波器**：$H_{\\text{白}}(\\omega) = 1/\\sqrt{P_{xx}(\\omega)}$。拿到一段未知谱形的观测，标准流程是先用 Welch 估出 $\\hat P_{xx}(\\omega)$，再按上式构造 FIR 白化滤波器（通常在频域逐 bin 相乘更省事）。白化之后，所有"假设白噪声"的经典最优处理器（匹配滤波、CFAR、波束形成）恢复适用。**先白化、再处理**是色噪声环境下的万能起手式。' }
        ]
      },
      /* ---------------- 3 ---------------- */
      {
        id: 'prewhite', num: '3', title: '色噪声下的最优处理：预白化 + 匹配',
        blocks: [
          { t: 'md', md: '匹配滤波器"最优"的前提是**白噪声**。噪声一旦有色，直接套用就会失配：噪声强的频段把输出方差抬高，信噪比在那些频段被白白浪费。色噪声下的最优线性滤波器由同样的信噪比最大化准则导出（详见「匹配滤波」一节的广义推导）：' },
          { t: 'math', tex: 'H_{\\text{opt}}(e^{j\\omega}) \\;\\propto\\; \\frac{S^*(e^{j\\omega})}{P_n(e^{j\\omega})}', tag: '(5)' },
          { t: 'md', md: '其中 $S$ 是信号的谱，$P_n$ 是噪声的功率谱密度。这个最优滤波器可以精确分解为两级的级联：**第一级白化滤波器** $1/\\sqrt{P_n}$ 把有色噪声变成白噪声（同时把信号扭成 $S/\\sqrt{P_n}$）；**第二级** 对变形后的信号做匹配滤波，即匹配 $S/\\sqrt{P_n}$ 的共轭翻转——恰好给出 $S^*/P_n$。' },
          { t: 'flow', v: false, items: [
            { t: '观测 x[n]', d: '信号 + 色噪声' },
            { t: '白化 1/√Pn', d: '噪声变白' },
            { t: '匹配滤波', d: '匹配白化后的信号' },
            { t: '等效于 H ∝ S*/Pn', d: '广义匹配滤波' }
          ] },
          { t: 'callout', kind: 'tip', title: '直观理解：好频段多说，坏频段少说', md: '白化滤波器在噪声小的频段增益高、噪声大的频段增益低。效果是：**信噪比高的频段在最终判决里占更大权重**。极端情形下若信号谱完全落在噪声谷里，即使信号能量很小也能被可靠检出——这就是"谱机会"利用，水声通信与雷达频谱对抗里都在自觉或不自觉地使用它。' },
          { t: 'callout', kind: 'pit', title: '误区：以为匹配滤波对任意噪声都最优', md: '普通匹配滤波器（共轭翻转）只在**白噪声**下最大化输出信噪比。在色噪声下直接使用，性能损失可以达到数 dB 甚至更多，而且损失随"噪声颜色深度"增加。判定方法很简单：估计一下观测的噪声谱 $P_n$，看它在信号带宽内的起伏。若起伏超过 3 dB，就应该走预白化流程；若噪声谱接近平坦，普通匹配滤波的损失可以忽略。' }
        ]
      },
      /* ---------------- 4 ---------------- */
      {
        id: 'sea', num: '4', title: '真实背景：海洋噪声谱与雷达杂波谱',
        blocks: [
          { t: 'md', md: '声呐设计师面对的背景噪声谱形由几种机制叠加而成，常用 **Knudsen 谱**与 **Wenz 曲线**描述：' },
          { t: 'table', cols: ['频段（约）', '主导机制', '谱特征', '对系统设计的含义'], rows: [
            ['1～100 Hz', '远航船噪声、潮汐与波浪的低频作用、地质活动', '谱级高、随海况与航运密度变化大', '低频被动检测的主要限制；要用窄带处理避开强低频'],
            ['100 Hz～10 kHz', '风成海面噪声（与风速强相关）', '约 −5 dB/倍频程 的负斜率', '经典 Knudsen 段；中频主动/被动的主要背景'],
            ['10～100 kHz 以上', '分子热噪声', '约 +6 dB/倍频程 的正斜率', '高频系统的背景下限；限制高频换能器的作用距离'],
            ['雨滴、生物', '瞬时宽带或窄带脉冲', '非平稳、强起伏', '需要恒虚警与分类处理']
          ] },
          { t: 'md', md: '声呐自噪声里还有一类容易被忽视的成分：**流噪声与结构噪声**。载舰航行时湍流边界层拍打导流罩、螺旋桨噪声通过船体结构传入基阵，在高航速下可以完全盖过环境噪声。它们不但有色，还往往**在阵元之间高度相关**（结构传播），这是下一节的伏笔。' },
          { t: 'md', md: '雷达一侧，杂波谱的建模同样围绕"色噪声"展开：**地杂波**集中在零多普勒频率附近（静止地物），谱宽由风速吹动的植被与天线扫描调制决定，常用高斯谱建模；**海杂波**则有多普勒展宽与明显的幅度长尾（复合 K 分布），功率谱也偏离高斯，常用幂律或复合高斯谱描述。**气象杂波**随雨强有宽窄之分。它们的共同点是：都不是白的，最优检测都必须考虑谱形。' },
          { t: 'callout', kind: 'eng', title: '工程提示：把谱形当成先验来用', md: '（1）**检测门限**：CFAR 参考单元要沿频率方向取，且避开杂波谱的主瓣区，否则门限被杂波抬高。（2）**波形选择**：强低频噪声环境里，把发射波形能量搬到噪声谷频段（跳频、频谱成形）比单纯加大功率更有效。（3）**杂波图**：地对空雷达对每个距离-方位单元维护杂波谱参数，波束驻留期间按局部谱宽调整多普勒滤波器组权重。这些都是"知道噪声什么颜色"之后才能做的事。' }
        ]
      },
      /* ---------------- 5 ---------------- */
      {
        id: 'spatial', num: '5', title: '空间相关性：阵列增益达不到根号 N 的原因',
        blocks: [
          { t: 'md', md: '前面讨论的色噪声都是**单个阵元时间序列**的性质。阵列处理还引入一个新的维度：**不同阵元的噪声之间是否相关**。标准阵列处理（常规波束形成、MVDR、MUSIC）默认各阵元噪声独立同分布，此时 $N$ 个阵元求和后信号相干叠加增长 $N$ 倍、噪声非相干叠加只增长 $\\sqrt{N}$ 倍，得到**阵列增益 $10\\log_{10}N$**。' },
          { t: 'md', md: '一旦阵元间噪声相关系数为 $\\rho$（等相关简化模型），求和后的噪声功率变成 $N\\sigma^2\\left[1+(N-1)\\rho\\right]$，阵列增益退化为' },
          { t: 'math', tex: 'AG = \\frac{N}{1+(N-1)\\rho} \\;\\xrightarrow{\\;N\\to\\infty\\;}\\; \\frac{1}{\\rho} \\quad(\\rho>0 \\text{ 时增益饱和})', tag: '(6)' },
          { t: 'md', md: '这是一个非常反直觉的结果：**只要存在不随阵元间距消失的相关，阵列增益就存在硬上限 $1/\\rho$，加阵元完全无用**。下图为现场计算：' },
          {
            t: 'plot', title: '阵列增益随阵元数的变化：空间相关性设定了硬上限', height: 280,
            render: function (cv) {
              const Ns = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
              const p = DSP.plot.new(cv, {
                height: 280, xlabel: '阵元数 N（对数感观的均匀取样）', ylabel: '阵列增益 / dB',
                legend: true, legendPos: 'tr'
              });
              p.add({ x: Ns, y: gen(Ns.length, i => 10 * Math.log10(Ns[i])), color: 3, width: 1.8, dash: [6, 3], label: '理想：10 lg N' });
              [0.05, 0.15, 0.4].forEach((rho, i) => {
                p.add({
                  x: Ns, color: i, width: 1.6,
                  y: gen(Ns.length, j => 10 * Math.log10(Ns[j] / (1 + (Ns[j] - 1) * rho))),
                  label: '相关系数 ρ = ' + rho + '（上限 ' + (10 * Math.log10(1 / rho)).toFixed(1) + ' dB）'
                });
              });
              p.draw();
            },
            caption: 'ρ = 0.05 → 上限 13 dB；ρ = 0.15 → 8.2 dB；ρ = 0.4 → 4 dB。 相关性不除掉，阵元加得再多也白搭。'
          },
          { t: 'callout', kind: 'eng', title: '水声阵列的现实瓶颈：流噪声的空间相关', md: '拖曳线列阵与舷侧阵在航行时，湍流边界层产生的**流噪声沿阵列方向以接近流体的速度传播**，在相邻阵元之间产生强相关（低频段尤其严重）。这使得实际阵列增益显著低于 $10\\log_{10}N$ 的理论值，且航速越高损失越大。工程对策包括：加大阵元间距与隔振、导流罩声学设计、采用空间去相关处理（如对相邻阵元做差分预处理）、以及在阵列增益预算中直接采用实测的相干函数而不是独立假设。**评估阵列性能时用 $10\\log_{10}N$ 而不做空间相干修正，是水声系统设计中后果最严重的乐观偏差之一。**' },
          { t: 'callout', kind: 'pit', title: '误区：忽略阵元间空间相关性', md: '典型症状：仿真里（各阵元独立加噪）性能达标，湖试海试达不到。原因往往是仿真用独立噪声，而真实噪声存在空间相关（流噪声、结构传导噪声、远处强干扰的波前曲率）。修正方法：用实测数据估计阵元间相干函数 $\\gamma_{ij}(f)$，把噪声协方差矩阵写成 $\\mathbf{R}_n(f) = \\{\\gamma_{ij}(f)\\sqrt{P_iP_j}\\}$ 代入仿真；或直接用实采噪声回放。测向与波束形成的性能评估必须在这个协方差下重做。' }
        ]
      },
      /* ---------------- 6 ---------------- */
      {
        id: 'pit', num: '6', title: '本节误区速查',
        blocks: [
          { t: 'grid', cols: 2, items: [
            [{ t: 'callout', kind: 'pit', title: '① 白噪声假设无脑用', md: '先看谱：带宽内起伏小于 3 dB 才可当白噪声用；否则先白化。带限白噪声在带外不"白"，相关时间也不是零。' }],
            [{ t: 'callout', kind: 'pit', title: '② 忽略空间相关性', md: '见第 5 节。阵列增益按 10 lg N 报告之前，先确认阵元间相干性；流噪声与结构噪声是水声阵列的大坑。' }],
            [{ t: 'callout', kind: 'pit', title: '③ 把有色噪声"白化"成过度平坦', md: '白化滤波器用估计谱构造时，若数据短、谱估计方差大，白化反而会放大某些频段的噪声。谱估计要平滑，白化要适度（如限制动态范围）。' }],
            [{ t: 'callout', kind: 'pit', title: '④ 自噪声与环境噪声混为一谈', md: '系统自身（电子噪声、流噪声、螺旋桨）随航速与工况变化，与海况决定的环境噪声是两套预算。声呐方程里 NL 要把两者按功率相加后再取对数。' }]
          ] }
        ]
      }
    ],
    refs: [
      'Urick, Principles of Underwater Sound, 第 7 章（环境噪声）',
      'Wenz, Acoustic ambient noise in the ocean: spectra and sources',
      'Kay, Fundamentals of Statistical Signal Processing: Detection Theory（色噪声检测）',
      'Ward, Sea Clutter: Scattering, the K Distribution and Radar Performance'
    ]
  });

  /* ============================================================
     4. 匹配滤波
     ============================================================= */
  doc.register('theory/random/matched', {
    title: '匹配滤波：白噪声下信噪比最大化的最优线性滤波',
    lede: '匹配滤波器是脉冲压缩、主动声呐与雷达接收机的共同心脏。它回答一个问题：给定信号波形与噪声谱，线性滤波器最多能把信噪比提到多高？答案由柯西-施瓦茨不等式一步给出。',
    tags: ['随机信号', '匹配滤波', '脉冲压缩', '多普勒'],
    labs: [{ path: 'lab/matched', title: '匹配滤波与脉冲压缩实验台', desc: '实时调节带宽、脉宽、窗函数与信噪比，观察主瓣宽度、旁瓣电平与信噪比增益' }],
    toc: true,
    intro: '这一页的主线：**先严格推导白噪声下的最优滤波器，再解释它为什么等于"共轭翻转"，然后把处理增益定量化，最后推广到色噪声与非理想情形（多普勒失配、窗加权）**。所有图形由真实计算生成。',
    sections: [
      /* ---------------- 1 ---------------- */
      {
        id: 'prob', num: '1', title: '问题的提法：从波形对齐到统计判决',
        blocks: [
          { t: 'md', md: '接收机拿到的是 $x[n] = s[n-d_0] + n[n]$：一段已知波形 $s$（发射样本或它的参考副本）被未知时延 $d_0$ 平移，混入噪声。要回答"目标在不在"与"时延是多少"，自然想到用线性滤波器 $h$ 对 $x$ 滤波，然后看输出峰值。那么 $h$ 应该怎么选？准则是：**在采样时刻，输出中信号瞬时功率相对噪声平均功率之比最大**，即' },
          { t: 'math', tex: '\\mathrm{SNR}_{\\text{out}} = \\frac{\\left|\\sum_k h[k]\\,s[n_0-k]\\right|^2}{E\\left\\{\\left|\\sum_k h[k]\\,n[n_0-k]\\right|^2\\right\\}} \\;\\longrightarrow\\; \\max_h', tag: '(1)' },
          { t: 'md', md: '注意这个准则**只关心输出端的信噪比，不关心波形保真**——匹配滤波器的输出波形是严重失真的（它把脉冲"压"成一根峰），这正是我们想要的。也与维纳滤波器（最小均方误差、保波形）准则不同，两者用途不同：**检测用时匹配滤波，恢复波形用维纳滤波**。' },
          { t: 'callout', kind: 'note', title: '为什么"信噪比最大"是正确的准则', md: '对高斯噪声，输出信噪比单调决定检测概率：固定虚警概率下，检测概率是信噪比的确定增函数（奈曼-皮尔逊框架）。因此"最大化输出信噪比"等价于"最大化检测性能"，这就是该准则的理论合法性来源。' }
        ]
      },
      /* ---------------- 2 ---------------- */
      {
        id: 'opt', num: '2', title: '白噪声下的最优线性滤波器（推导）',
        blocks: [
          { t: 'md', md: '设信号能量 $E_s = \\sum_n |s[n]|^2$，噪声为白噪声（方差 $\\sigma_w^2$，各样本独立）。此时分母与 $h$ 的位置无关：$E\\{\\left|\\sum_k h[k]n[n_0-k]\\right|^2\\} = \\sigma_w^2\\sum_k|h[k]|^2$。于是问题化为经典的**柯西-施瓦茨**形式，最优解与证明如下。' },
          { t: 'fold', summary: '展开：由柯西-施瓦茨不等式推出匹配滤波器', deriv: true, blocks: [
            { t: 'math', tex: '\\mathrm{SNR}_{\\text{out}} = \\frac{\\left|\\sum_k h[k]\\,s[n_0-k]\\right|^2}{\\sigma_w^2 \\sum_k |h[k]|^2}', tag: '(2)' },
            { t: 'md', md: '记 $u[k] = h^*[k]$，$v[k] = s[n_0-k]$，则分子是 $|\\langle u, v\\rangle|^2$。由柯西-施瓦茨不等式：' },
            { t: 'math', tex: '|\\langle u, v\\rangle|^2 \\le \\langle u,u\\rangle\\,\\langle v,v\\rangle = \\left(\\sum_k|h[k]|^2\\right)\\left(\\sum_k|s[n_0-k]|^2\\right) = \\|h\\|^2 \\cdot E_s', tag: '(3)' },
            { t: 'md', md: '代入得 $\\mathrm{SNR}_{\\text{out}} \\le \\frac{\\|h\\|^2 E_s}{\\sigma_w^2\\|h\\|^2} = \\frac{E_s}{\\sigma_w^2}$，**与滤波器无关的上界**。等号成立当且仅当 $u \\propto v$，即 $h^*[k] \\propto s[n_0-k]$，取比例系数为 1 并令 $n_0$ 为滤波器末端：' },
            { t: 'math', tex: 'h[k] = s^*[M-1-k] \\qquad(\\text{信号共轭翻转})', tag: '(4)' },
            { t: 'md', md: '此时最大输出信噪比 $\\mathrm{SNR}_{\\max} = E_s/\\sigma_w^2 = 2E_s/N_0$（$N_0$ 为双边噪声谱密度对应量）。**关键结论：输出信噪比只取决于信号能量与噪声密度之比，与波形形状无关**。形状能改变的是峰的宽度与旁瓣结构，从而改变分辨率与多目标能力——这就是波形设计的出发点。' },
            { t: 'md', md: '频域表述同样重要：$H(e^{j\\omega}) = S^*(e^{j\\omega})e^{-j\\omega(M-1)}$，即滤波器幅频特性与信号谱幅度一致、相位为信号谱相位的共轭加线性延迟。**信号谱强的频段滤波器增益就大**——滤波器"信任"信号存在的地方。' }
          ] },
          { t: 'callout', kind: 'tip', title: '推论：能量守恒的检测观', md: '$\\mathrm{SNR}_{\\max} = E_s/\\sigma_w^2$ 告诉我们：只要能量相同，短促的大功率脉冲与细水长流的低功率长脉冲在白噪声中的可检测性完全相同。**检测性能买不来"波形红利"，只能买"能量红利"与"分辨率红利"**——这是初学者最常混淆的一点。' }
        ]
      },
      /* ---------------- 3 ---------------- */
      {
        id: 'corr', num: '3', title: '匹配滤波器 = 共轭翻转：输出就是自相关',
        blocks: [
          { t: 'md', md: '把式 (4) 代入卷积：$y[n] = \\sum_k h[k]\\,x[n-k] = \\sum_k s^*[M-1-k]\\,x[n-k]$，换元后正是**相关运算**：' },
          { t: 'math', tex: 'y[n] = \\sum_{m} x[n+m]\\,s^*[m] = r_{xs}[n] \\qquad(\\text{匹配滤波输出} \\equiv \\text{互相关})', tag: '(5)' },
          { t: 'md', md: '所以匹配滤波、相关接收、（在白噪声下的）最优检测是**同一件事的三种说法**。对无噪情形 $x = s[n-d_0]$，输出就是信号的自相关函数平移到 $d_0$：主峰位于 $d_0$，主峰宽度由信号带宽决定，旁瓣结构由波形自相关决定。「相关函数」一节画过的自相关旁瓣图，在这里就是脉压输出的旁瓣。' },
          {
            t: 'widget', render: function (el) {
              const fs = 20000, T = 0.02, M = 400, B = 4000;
              const tx = C.chirp(M, fs, 2000, 6000, T);
              const N = 1600, d0 = 480;
              const recClean = new Float64Array(N);
              for (let i = 0; i < M; i++) recClean[d0 + i] = tx[i];
              // 整段记录加噪：记录级信噪比 −19 dB，换算到 4 kHz 信号带内约 −6 dB
              const snrRec = -19;
              const rec = C.addNoise(recClean, snrRec, 11);
              const y = C.matchedFilter(rec, tx);
              const env = C.envelope(y);
              // 旁瓣指标在无噪回波上测量（有噪时被噪声底掩盖）
              const yC = C.matchedFilter(recClean, tx);
              const pm = C.pulseMetrics(yC);
              // 实测输出信噪比：峰值² / 远离主瓣区域的均方（含旁瓣与噪声）
              const guard = Math.round(pm.widthNull * 2) + 20;
              let ps = 0, cnt = 0;
              for (let i = 0; i < N + M - 1; i++) {
                if (Math.abs(i - pm.peakIdx) <= guard) continue;
                ps += env[i] * env[i]; cnt++;
              }
              const snrOut = 10 * Math.log10(env[pm.peakIdx] * env[pm.peakIdx] / (ps / cnt));
              const gainTheory = C.pulseGainDb(B, T);
              const snrInBand = snrRec + 10 * Math.log10(N / M) + 10 * Math.log10(fs / B);
              const tRec = gen(N, i => i / fs * 1000);
              const lagMs = gen(y.length, i => i / fs * 1000);

              figure(el, 2, [
                {
                  title: '输入：含噪 LFM 回波（4 kHz 信号带内信噪比约 −6 dB）',
                  caption: '时域上目标完全不可见。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 235, xlabel: 't / ms', ylabel: '幅度', legend: false });
                    p.add({ x: tRec, y: rec, color: 4, width: 0.9, alpha: 0.9 })
                      .vline(d0 / fs * 1000, { label: '真实到达', dash: [5, 3] })
                      .draw();
                  }
                },
                {
                  title: '匹配滤波输出（希尔伯特包络，dB）：一根峰 + −13.4 dB 旁瓣',
                  caption: '无噪回波实测：峰值旁瓣 ' + pm.psl.toFixed(1) + ' dB，积分旁瓣比 ' + pm.islr.toFixed(1) + ' dB，−3 dB 主瓣宽 ' + pm.width3dB.toFixed(2) + ' 样本（≈ fs/B = 5）；图中有噪输出的噪声底约在 −13 dB。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 235, xlabel: '滞后 / ms', ylabel: '归一化 / dB', legend: false, ylim: [-42, 3] });
                    p.add({ x: lagMs, y: toDbNorm(env, -60), color: 0, width: 1.4 })
                      .hline(-13.4, { label: '理论旁瓣 −13.4 dB', color: '#b45309' })
                      .vline(d0 / fs * 1000, { label: '真实到达', dash: [5, 3] })
                      .draw();
                  }
                }
              ]);
              el.appendChild(U.h('div.metrics', {}, [
                { label: '信号带宽 × 脉宽 BT', value: (B * T).toFixed(0), unit: '' },
                { label: '理论处理增益 10 lg(BT)', value: gainTheory.toFixed(1), unit: 'dB' },
                { label: '输入带内信噪比（推算）', value: snrInBand.toFixed(1), unit: 'dB' },
                { label: '实测输出峰值信噪比（含旁瓣）', value: snrOut.toFixed(1), unit: 'dB' }
              ].map(m => U.h('div.metric', {}, [
                U.h('div.m-l', { text: m.label }),
                U.h('div.m-v', { text: m.value }),
                U.h('div', {}, U.h('span.m-u', { text: m.unit }))
              ]))));
            }
          },
          { t: 'md', md: '读数核对：理论增益 $10\\log_{10}(BT) = 10\\log_{10}80 \\approx 19$ dB；输入带内信噪比约 $-6$ dB，输出实测约 $13$ dB，两者相加吻合。**处理增益不是抽象概念，它就是"输入看不见、输出看得见"的那段差值**。' }
        ]
      },
      /* ---------------- 4 ---------------- */
      {
        id: 'gain', num: '4', title: '处理增益 10 lg(BT) 与距离分辨率',
        blocks: [
          { t: 'fold', summary: '展开：处理增益 10 lg(BT) 的推导', deriv: true, blocks: [
            { t: 'md', md: '设发射脉冲时宽 $T$、带宽 $B$（矩形谱近似），白噪声双边谱密度 $N_0/2$，信号能量 $E_s$。' },
            { t: 'md', md: '**输入端**：把信号功率记为 $P_s = E_s/T$；以信号带宽 $B$ 为参考的输入噪声功率为 $P_n = N_0 B$（单边）或 $N_0 B$ 的对应双边量。输入信噪比 $\\mathrm{SNR}_{in} = E_s/(T N_0 B)$。' },
            { t: 'md', md: '**输出端**：由第 2 节，$\\mathrm{SNR}_{out} = 2E_s/N_0$。两式相除：' },
            { t: 'math', tex: '\\frac{\\mathrm{SNR}_{out}}{\\mathrm{SNR}_{in}} = \\frac{2E_s/N_0}{E_s/(T N_0 B)} = 2BT \\;\\Rightarrow\\; G_{dB} \\approx 10\\log_{10}(BT) \\;\\;(\\text{约定差异吸收系数 2})', tag: '(6)' },
            { t: 'md', md: '系数 2 的出入来自单边/双边与参考带宽的约定，工程上一律记 $G = 10\\log_{10}(BT)$。**$BT$（时宽带宽积）是波形设计的核心自由度**：大 $BT$ 波形（长脉冲 + 宽扫频）同时拿到大能量（远距离）与高分辨率（精确距离），这是 LFM 脉冲压缩存在的全部理由。' },
            { t: 'md', md: '同一枚硬币的另一面是**距离分辨率**：$\\Delta R = c/(2B)$。带宽决定分辨率，脉宽决定能量，二者解耦——这正是脉冲压缩与简单脉冲（$BT\\approx 1$）的本质区别。核库中的 `rangeRes(c, B)` 与 `pulseGainDb(B, T)` 即实现了这两个公式。' }
          ] },
          { t: 'metrics', list: [
            { label: 'B = 4 kHz, T = 20 ms', value: 'BT = 80' },
            { label: '处理增益', value: '19.0', unit: 'dB' },
            { label: '距离分辨率 c/2B（声速 1500）', value: '0.19', unit: 'm' },
            { label: '未加权旁瓣', value: '−13.4', unit: 'dB' }
          ] },
          { t: 'callout', kind: 'eng', title: '声呐与雷达的同一个公式', md: '声呐：发射 2–6 kHz、20 ms 的 LFM，$BT=80$，处理增益 19 dB，能把带内 $-6$ dB 的回波抬到 $+13$ dB。雷达：发射 10 µs、1 MHz 的 LFM，$BT=40$，增益 16 dB，距离分辨率 150 m。**公式一模一样，参数各取所需**——区别只在传播速度与噪声场景。这也是"水声/雷达信号处理同源"这一说法的技术根基。' }
        ]
      },
      /* ---------------- 5 ---------------- */
      {
        id: 'color', num: '5', title: '色噪声下的推广：预白化 + 匹配 = 广义匹配滤波',
        blocks: [
          { t: 'fold', summary: '展开：色噪声下信噪比最大化的一般解（H ∝ S*/Pn）', deriv: true, blocks: [
            { t: 'md', md: '噪声功率谱为 $P_n(e^{j\\omega})$（不再平坦）。输出信噪比的频域表达：' },
            { t: 'math', tex: '\\mathrm{SNR}_{\\text{out}} = \\frac{\\left|\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi} H(e^{j\\omega})\\,S(e^{j\\omega})e^{j\\omega n_0}\\,\\mathrm{d}\\omega\\right|^2}{\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi} |H(e^{j\\omega})|^2 P_n(e^{j\\omega})\\,\\mathrm{d}\\omega}', tag: '(7)' },
            { t: 'md', md: '对分母使用柯西-施瓦茨（积分形式）：把 $H\\sqrt{P_n}$ 与 $S/\\sqrt{P_n}$ 视为两个函数，则' },
            { t: 'math', tex: '\\left|\\int H S e^{j\\omega n_0}\\right|^2 = \\left|\\int \\big(H\\sqrt{P_n}\\big)\\Big(\\frac{S e^{j\\omega n_0}}{\\sqrt{P_n}}\\Big)\\right|^2 \\le \\int |H|^2 P_n \\cdot \\int \\frac{|S|^2}{P_n}', tag: '(8)' },
            { t: 'md', md: '代入得 $\\mathrm{SNR}_{out} \\le \\frac{1}{2\\pi}\\int \\frac{|S|^2}{P_n}\\mathrm{d}\\omega$，等号在 $H\\sqrt{P_n} \\propto S^*e^{-j\\omega n_0}/\\sqrt{P_n}$ 时成立，即' },
            { t: 'math', tex: 'H_{\\text{opt}}(e^{j\\omega}) = \\kappa\\,\\frac{S^*(e^{j\\omega})}{P_n(e^{j\\omega})}\\,e^{-j\\omega n_0}', tag: '(9)' },
            { t: 'md', md: '**验证一致性**：$P_n = \\sigma_w^2$（白噪声）时，代回式 (4) 的频域形式 ✓。结构分解：$\\frac{S^*}{P_n} = \\frac{1}{\\sqrt{P_n}}\\cdot\\Big(\\frac{S}{\\sqrt{P_n}}\\Big)^*\\cdot e^{-j\\omega n_0}$，第一因子是白化滤波器，第二因子是对白化后信号的匹配滤波器——**白化 + 匹配的两级结构严格成立**。最大输出信噪比 $\\mathrm{SNR}_{max} = \\frac{1}{2\\pi}\\int\\frac{|S|^2}{P_n}\\mathrm{d}\\omega$，它只依赖"信号谱与噪声谱的比值谱"，这正是预白化有效性的定量表述。' }
          ] },
          { t: 'md', md: '工程实现上，$P_n$ 未知时先用无目标时段估计 $\\hat P_n(\\omega)$（Welch 平均），再在频域逐 bin 实现 $X(\\omega)\\hat S^*(\\omega)/\\hat P_n(\\omega)$。**注意 $\\hat P_n$ 的动态范围限制**：谱谷处除法会放大估计误差，通常给 $\\hat P_n$ 设下限（对角加载思想）。' }
        ]
      },
      /* ---------------- 6 ---------------- */
      {
        id: 'doppler', num: '6', title: '多普勒失配与距离-多普勒耦合',
        blocks: [
          { t: 'md', md: '目标运动带来多普勒频移 $f_d = 2v/\\lambda$（双程）。匹配滤波器的模板是"静止"的发射副本，多普勒使实际回波与模板失配，输出主峰下降。对 LFM 这类调频波形，失配还有一个著名副作用：**多普勒频移等价于一个时间（距离）平移**，即距离-多普勒耦合：' },
          { t: 'math', tex: '\\Delta\\tau = \\frac{f_d}{k},\\quad k = \\frac{B}{T}\\;(\\text{调频斜率}) \\qquad\\Longrightarrow\\qquad \\Delta R = \\frac{c\\,f_d T}{2B}', tag: '(10)' },
          { t: 'md', md: '代入声呐参数（$B=4$ kHz，$T=20$ ms）：$f_d=100$ Hz（径向速度约 5 m/s @ 3.5 kHz 载频）造成的距离偏差 $\\Delta R = 1500\\times100\\times0.02/(2\\times4000) \\approx 0.37$ m，可以忽略；但同样的公式在雷达里（$B=1$ MHz，$T=50\\,\\mu$s，$c=3\\times10^8$）给出可观的偏差。**距离-多普勒耦合是 LFM 的根本特征：测距与测速不能同时独立精确**，想同时拿两者要么用多普勒滤波器组并行搜索，要么改用调频斜率相反的双波形配对发射。' },
          {
            t: 'plot', title: '多普勒失配损失：峰值随多普勒频移的下降（现场计算）', height: 280,
            render: function (cv) {
              const fs = 20000, T = 0.02, M = 400, B = 4000;
              const tx = C.chirp(M, fs, 2000, 6000, T);
              const Nd = 1000, dd = 300;
              const rec = new Float64Array(Nd);
              for (let i = 0; i < M; i++) rec[dd + i] = tx[i];
              const recC = { re: rec, im: new Float64Array(Nd) };
              const nPt = 41;
              const fdAx = gen(nPt, i => (i - (nPt - 1) / 2) * 25);       // ±500 Hz
              const loss = new Float64Array(nPt);
              let base = 0;
              for (let j = 0; j < nPt; j++) {
                const fd = fdAx[j];
                const hR = new Float64Array(M), hI = new Float64Array(M);
                for (let k = 0; k < M; k++) {
                  const ph = 2 * Math.PI * fd * k / fs;
                  hR[k] = tx[k] * Math.cos(ph); hI[k] = tx[k] * Math.sin(ph);
                }
                const y = C.matchedFilterC(recC, { re: hR, im: hI });
                const env = C.envelope(y.re);
                let pk = 0;
                for (let i = 0; i < env.length; i++) if (env[i] > pk) pk = env[i];
                loss[j] = pk;
                if (fd === 0) base = pk;
              }
              const p = DSP.plot.new(cv, { height: 280, xlabel: '多普勒频移 fd / Hz（载频 4 kHz，对应径向速度 ±19 m/s）', ylabel: '峰值相对损失 / dB', legend: false, ylim: [-25, 1] });
              p.add({ x: fdAx, y: gen(nPt, i => 20 * Math.log10(Math.max(loss[i] / base, 1e-6))), color: 0, width: 1.8 })
                .hline(-3, { label: '−3 dB（半功率）', color: '#b45309' })
                .annotate(250, -6, '±250 Hz 内损失 < 3 dB', { dy: -6 })
                .draw();
            },
            caption: 'LFM 的多普勒容限：损失 3 dB 对应 fd·T ≈ 0.44（本例 T = 20 ms → fd ≈ 22 Hz 处开始明显下降，±500 Hz 时损失可达 20 dB 以上，具体曲线由实测卷积给出）。'
          },
          { t: 'callout', kind: 'eng', title: '多普勒容限的两种用法', md: '**窄带 CW 脉冲**：多普勒容限极窄（约 $1/T$），但换来的测速精度极高——用于测速通道。**宽带 LFM**：容限约 $\\pm 0.44/T\\cdot(B/f_0)$ 相对带宽量级（大 $BT$ 时更宽），测速粗但测距精——用于测距通道。声呐常用"CW + LFM 双波形交替发射"同时兼顾；雷达用相参脉冲串（每个脉冲内 LFM、脉冲间多普勒滤波）解决。设计前先算：**目标最大径向速度 × 载频 = 最大多普勒，必须落在所选波形的容限之内**。' },
          { t: 'callout', kind: 'pit', title: '误区：忘了目标多普勒会导致失配', md: '静止目标调好的匹配滤波器，对高速目标会损失信噪比并产生距离偏差（耦合）。高速场景必须做**多普勒补偿搜索**：以若干候选 $f_d$ 分别做匹配滤波取最大输出（相当于在模糊图上做二维搜索），或用调频斜率正负配对消除耦合。仿真里"目标不动所以没问题"的惯性思维，到了外场就是漏检的开始。' }
        ]
      },
      /* ---------------- 7 ---------------- */
      {
        id: 'eng', num: '7', title: '工程实践：加权、相参与失配损失',
        blocks: [
          { t: 'md', md: '**旁瓣与窗加权。** 未加权 LFM 的 −13.4 dB 旁瓣在多目标场景是致命的：一个 20 dB 的大目标，其旁瓣会以 −33.4 dB 的等效电平"污染"整个距离窗，把弱目标淹没。对策是给频谱加窗（等价于给时域加权后做匹配，或在匹配滤波器上卷积一个窗）：汉明加权可把旁瓣压到 −40 dB 以下，代价是**主瓣展宽约 1.3～1.6 倍、信噪比损失 1～3 dB**（泰勒/切比雪夫加权可在给定旁瓣下最优化主瓣宽度）。**是否加窗取决于场景**：单目标测距优先不加窗（保增益与分辨率），多目标或杂波环境优先加窗（保动态范围）。' },
          { t: 'md', md: '**相参 vs 非相参。** 匹配滤波利用了信号相位（相参处理），可拿到 $10\\log_{10}(BT)$ 的全增益；若接收链路相位相干性被破坏（本振抖动、信道快起伏），只能做非相参积累（包络检波后累加），增益近似 $10\\log_{10}\\sqrt{N}$ 量级且伴随小信号抑制损失。**系统设计要明确哪一级是相参的**：脉冲内相参（脉压）、脉冲间相参（相参积累/多普勒滤波）、阵元间相参（波束形成），三者独立可损。' },
          { t: 'grid', cols: 2, items: [
            [{ t: 'callout', kind: 'eng', title: '声呐 LFM 脉压链路', md: '发射 2–6 kHz LFM → 水听器接收 → 前置滤波与 A/D → 正交解调（或直接带通采样）→ 匹配滤波（时域卷积或频域复乘）→ 包络检波 → 门限检测。窗加权放在匹配滤波器频谱上。链路各级的固定时延要校准进"零距离"。' }],
            [{ t: 'callout', kind: 'eng', title: '雷达 LFM 脉压与加权', md: '雷达脉压在数字中频完成，常用频域快速卷积 + 泰勒或切比雪夫加权；强地杂波环境下还要级联 MTI/多普勒滤波。加权的选择要兼顾"弱目标可见性"（旁瓣）与"近距离小目标"(展宽后的盲区)。' }]
          ] },
          { t: 'callout', kind: 'pit', title: '误区：把匹配滤波当成万能最优', md: '记住它的两个前提：**白噪声**（色噪声要先白化，见第 5 节）与**已知波形**（目标回波的确与模板一致）。多普勒尺度变化、信道起伏、目标闪耀都会破坏"已知"这个前提，此时失配损失要实测，不能拿理论增益硬套。' },
          { t: 'callout', kind: 'pit', title: '误区：混淆匹配滤波与维纳滤波', md: '两者都是"最优线性滤波器"，但准则不同：匹配滤波最大化**某时刻的输出信噪比**（检测用，不保波形）；维纳滤波最小化**均方误差**（估计波形用，不追求瞬时峰值）。把维纳滤波的公式用在检测链路里、或抱怨匹配滤波器"输出波形失真"，都是张冠李戴。' }
        ]
      }
    ],
    refs: [
      'Turin, An introduction to matched filters, IEEE Trans. Inf. Theory, 1960',
      'Richards, Fundamentals of Radar Signal Processing, 第 4 章（脉冲压缩与模糊函数）',
      'Kay, Fundamentals of Statistical Signal Processing: Detection Theory, 第 4 章',
      'Burdic, Underwater Acoustic System Analysis, 第 12 章'
    ]
  });

  /* ============================================================
     阵列通用：ULA 阵列响应与多面板极坐标波束图
     角度约定：φ 为显示方位角，0° 沿阵列轴线（端射），90° 为阵法线（正横）。
     阵元沿显示图的竖直方向排列；方向余弦 u = cos φ 与教科书 ULA 的
     sinθ（θ 从正横起算）一一对应：φ = 90° − θ。
     ============================================================ */

  /**
   * 均匀线阵的阵列响应（已按峰值归一化为线性幅度）
   * w     : 复权（{re,im} 或幅度数组，后者按零相位处理）
   * dLam  : 阵元间距 / 波长
   * phiS  : 指向角（显示约定，度）
   * phiArr: 角度网格（度）
   * 返回 { af: Float64Array 线性幅度（峰值 1）, db: Float64Array（限幅 floor） }
   */
  function ulaAF(w, dLam, phiS, phiArr, floorDb) {
    const N = w.re ? w.re.length : w.length;
    let sw = 0;
    for (let n = 0; n < N; n++) sw += w.re ? Math.hypot(w.re[n], w.im[n]) : Math.abs(w[n]);
    const psiS = 2 * Math.PI * dLam * Math.cos(phiS * Math.PI / 180);
    const af = new Float64Array(phiArr.length);
    const db = new Float64Array(phiArr.length);
    const fl = floorDb === undefined ? -60 : floorDb;
    for (let i = 0; i < phiArr.length; i++) {
      const psi = 2 * Math.PI * dLam * Math.cos(phiArr[i] * Math.PI / 180) - psiS;
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const wr = w.re ? w.re[n] : w[n];
        const wi = w.re ? w.im[n] : 0;
        re += wr * Math.cos(n * psi) - wi * Math.sin(n * psi);
        im += wr * Math.sin(n * psi) + wi * Math.cos(n * psi);
      }
      af[i] = Math.hypot(re, im) / sw;
      db[i] = Math.max(20 * Math.log10(Math.max(af[i], 1e-12)), fl);
    }
    return { af: af, db: db };
  }

  /** 切比雪夫（Dolph）等纹波幅度权：sllPosDb 为主旁瓣比（正 dB），适用于任意 N（推荐奇数 N） */
  function chebyWeights(N, sllPosDb) {
    const R0 = Math.pow(10, sllPosDb / 20);
    const x0 = Math.cosh(Math.acosh(R0) / (N - 1));
    const cheb = (m, x) => Math.abs(x) <= 1 ? Math.cos(m * Math.acos(x)) : Math.cosh(m * Math.acosh(Math.abs(x)));
    const W = new Float64Array(N);
    const half = (N - 1) / 2;
    for (let n = 0; n < N; n++) {
      const p = n - half;
      let s = 0;
      for (let k = 0; k < N; k++) {
        const psi = 2 * Math.PI * k / N;
        s += cheb(N - 1, x0 * Math.cos(psi / 2)) / R0 * Math.cos(-2 * Math.PI * k * p / N);
      }
      W[n] = s / N;
    }
    return W;
  }

  /** 极坐标波束图（dB） */
  function polarDb(cv, o) {
    const theta = o.theta || gen(721, i => i * 0.5);
    DSP.plot.polar(cv, {
      r: o.series.map(s => Array.from(s.db || s)),
      theta: [Array.from(theta)],
      rMin: o.rMin === undefined ? -40 : o.rMin,
      rMax: 0,
      rings: 4,
      mode: 'deg',
      height: o.height || 340,
      title: o.title,
      labels: [[0, '端射 0°'], [90, '正横 90°'], [180, '端射 180°'], [270, '正横 270°']],
      colors: o.colors
    });
  }

  /* ============================================================
     5. 波束形成原理
     ============================================================= */
  doc.register('theory/array/beamforming', {
    title: '波束形成原理：从阵元求和到空域匹配滤波',
    lede: '把多个阵元的输出按相位对齐后相加，就是波束形成。它与匹配滤波在数学上完全同构——只不过匹配的对象从"时间波形"换成了"空间波前"。',
    tags: ['阵列', '波束形成', '指向性', 'ULA'],
    labs: [{ path: 'lab/music', title: 'MUSIC 超分辨谱估计实验台', desc: '对比常规波束形成与 MUSIC 的角度分辨能力' }],
    toc: true,
    intro: '这一页的主线：**单阵元没有方向性 → 排成阵列产生相位差 → 求和获得指向性 → 加权整形 → 定量给出增益与波束宽度**。全程使用统一的角度约定：阵列竖直放置，0° 沿阵轴（端射），90° 为阵法线（正横）。',
    sections: [
      /* ---------------- 1 ---------------- */
      {
        id: 'why', num: '1', title: '为什么要阵列：单阵元没有方向性',
        blocks: [
          { t: 'md', md: '单个无指向性水听器（或雷达中的全向单元）对来自任何方向的信号响应相同。它无法回答"信号从哪来"，也无法在空间上抑制来自其它方向的干扰。把 $N$ 个阵元按几何排布，利用**信号到达不同阵元存在波程差**这一事实做相位对齐后求和，就构成了一个空间滤波器——即**波束形成器**。' },
          { t: 'md', md: '阵列处理的价值可以概括为三句话：**分辨**——主瓣越窄，两个靠近的目标越能被分开（空域的瑞利判据）；**增益**——信号相干叠加 $N$ 倍、噪声非相干叠加 $\sqrt{N}$ 倍，信噪比改善 $10\\log_{10}N$ dB（噪声空间独立时）；**抑制**——在干扰方向放置零点，实现空域滤波。' },
          { t: 'callout', kind: 'eng', title: '工程师视角：波束形成无处不在', md: '水声：声呐基阵（圆柱阵、球阵、拖曳线列阵）做多波束警戒与测向。雷达：相控阵天线用电扫描替代机械转动，同时形成搜索与跟踪波束。通信：5G 大规模 MIMO 基站对每个用户独立形成波束。**三者的数学内核都是同一套阵列流形与波束形成公式**，差别只在波长、带宽与阵元结构。' }
        ]
      },
      /* ---------------- 2 ---------------- */
      {
        id: 'af', num: '2', title: '等间距线阵的相位差与阵因子',
        blocks: [
          { t: 'md', md: '考虑 $N$ 个各向同性阵元、间距 $d$ 的均匀线阵（ULA）。平面波从方位角 $\\theta$（自阵法线/正横起算）入射时，相邻阵元的波程差为 $d\\sin\\theta$，对应相位差' },
          { t: 'math', tex: '\\Delta\\phi = \\frac{2\\pi d \\sin\\theta}{\\lambda}', tag: '(1)' },
          { t: 'md', md: '各阵元输出乘以权 $w_n$ 后求和，得到**阵因子**（阵列的方向图，忽略单元自身方向性）：' },
          { t: 'math', tex: '\\mathrm{AF}(\\theta) = \\sum_{n=0}^{N-1} w_n\\,e^{jn\\left(\\frac{2\\pi d\\sin\\theta}{\\lambda} - \\frac{2\\pi d\\sin\\theta_0}{\\lambda}\\right)}', tag: '(2)' },
          { t: 'fold', summary: '展开：等幅等间距阵因子的闭式解（几何级数求和）', deriv: true, blocks: [
            { t: 'md', md: '取 $w_n = 1/N$（均匀加权），记 $\\psi = \\frac{2\\pi d}{\\lambda}(\\sin\\theta - \\sin\\theta_0)$。阵因子是几何级数：' },
            { t: 'math', tex: '\\mathrm{AF}(\\psi) = \\frac{1}{N}\\sum_{n=0}^{N-1}e^{jn\\psi} = \\frac{1}{N}\\cdot\\frac{1-e^{jN\\psi}}{1-e^{j\\psi}} = e^{j(N-1)\\psi/2}\\cdot\\frac{\\sin(N\\psi/2)}{N\\sin(\\psi/2)}', tag: '(3)' },
            { t: 'md', md: '取模：$|\\mathrm{AF}| = \\left|\\frac{\\sin(N\\psi/2)}{N\\sin(\\psi/2)}\\right|$——这是离散版的 sinc 函数（Dirichlet 核）。零点出现在 $N\\psi/2 = \\pm\\pi$，即 $\\psi = \\pm 2\\pi/N$；半功率点由 $\\frac{\\sin(N\\psi/2)}{N\\sin(\\psi/2)} = 0.707$ 解出 $N\\psi_{3dB}/2 \\approx 1.392$，于是' },
            { t: 'math', tex: '\\psi_{3dB} \\approx \\frac{2.78}{N} \\quad\\Longrightarrow\\quad \\theta_{3dB} \\approx \\frac{0.886\\,\\lambda}{N d\\,\\cos\\theta_0} \\;\\;(\\text{弧度，扫描角}\\;\\theta_0\\;\\text{从正横起算})', tag: '(4)' },
            { t: 'md', md: '因子 $\\cos\\theta_0$ 是**孔径投影效应**：波束偏离正横时，有效孔径（阵列在垂直于视线方向的投影长度）缩短，波束展宽。当 $N d$（总孔径）远大于波长时主瓣很窄；栅瓣问题（$\\psi$ 超出可视区的周期延拓）留给下一页专门讨论。' }
          ] },
          { t: 'callout', kind: 'tip', title: '本页角度约定（与公式对照）', md: '教科书常用"从正横起算的 $\\theta$"与 $\\sin\\theta$ 配对；本页交互图中阵列竖直放置、角度从阵轴（端射）起算记为 $\\varphi$，两者关系是 $\\varphi = 90^\\circ - \\theta$，$\\sin\\theta = \\cos\\varphi$。读图时记住：**正横方向在图的左右两侧（90°/270°），端射在上下（0°/180°）**。' }
        ]
      },
      /* ---------------- 3 ---------------- */
      {
        id: 'cbf', num: '3', title: '常规波束形成：时延/相移 + 求和',
        blocks: [
          { t: 'md', md: '**常规波束形成（CBF，delay-and-sum）**的流程：把各阵元输出按目标方向的时延差补偿（窄带时等价为相移），再求和。它其实就是把式 (2) 的权设为 $w_n = \\frac{1}{N}e^{-jn\\psi_0}$——一个纯相位校正。从检测的角度看，**CBF 是空域的匹配滤波器**：匹配的对象是"平面波前"，输出的是该方向上的相干增益。' },
          { t: 'flow', v: false, items: [
            { t: '阵元接收 x_n(t)', d: 'N 路时间序列' },
            { t: '时延/相移补偿', d: '对准目标方向' },
            { t: '加权求和', d: 'y(t) = Σ w_n x_n' },
            { t: '输出功率', d: '方向谱的一个值' }
          ] },
          { t: 'md', md: '把指向角在一个范围内扫描，就得到**方位谱**（水声叫"方位历程"，雷达叫"角度扫描"）。窄带情形全部在频域做：对每个频率 bin 取各阵元的复幅度向量 $\\mathbf{x}(f)$，输出 $P(\\theta) = \\mathbf{w}^{\\mathrm H}\\mathbf{R}(f)\\mathbf{w}$，其中 $\\mathbf{R}$ 是阵列协方差矩阵。宽带情形见下一页。' },
          {
            t: 'plot', title: '不同阵元数的波束图（ULA，d = λ/2，指向正横，dB 极坐标）', height: 380,
            render: function (cv) {
              const phi = gen(721, i => i * 0.5);
              const series = [4, 8, 16].map(N => {
                const w = new Float64Array(N).fill(1);
                return ulaAF(w, 0.5, 90, phi, -42).db;
              });
              polarDb(cv, { theta: phi, series: series, colors: [0, 1, 2], height: 380 });
            },
            caption: 'N = 4 / 8 / 16：主瓣宽度 ∝ λ/(Nd)，旁瓣电平固定约 −13.4 dB（均匀加权）。孔径翻倍，波束减半。'
          },
          { t: 'md', md: '图中三条曲线的定量核对：$N=16$、$d=\\lambda/2$ 时孔径 $Nd = 8\\lambda$，正横方向半功率束宽 $0.886\\lambda/(Nd) = 0.111$ rad ≈ 6.3°，可用 $N\\psi/2 = 1.392$ 精确解出 ≈ 6.4°，与图中曲线一致。旁瓣为等纹波结构，第一旁瓣 $-13.4$ dB——这正是矩形孔径傅里叶变换（sinc）的旁瓣，与时域矩形窗的谱泄漏完全同源。' }
        ]
      },
      /* ---------------- 4 ---------------- */
      {
        id: 'weight', num: '4', title: '幅度加权：主瓣与旁瓣的永恒交易',
        blocks: [
          { t: 'md', md: '均匀加权的 −13.4 dB 旁瓣在强干扰环境中不够用。给阵列权乘上**由中心向两端递减的窗函数**（切比雪夫、泰勒、汉明、凯泽等），可以压低旁瓣——代价是主瓣展宽与增益损失。这与谱估计里加窗抑制泄漏是同一个数学操作：**孔径上的窗 ↔ 空域卷积核的展宽**。' },
          { t: 'table', cols: ['加权', '第一旁瓣', '主瓣展宽（相对均匀）', '特点'], rows: [
            ['均匀（矩形）', '−13.4 dB', '1.00', '分辨率最优，旁瓣最差'],
            ['汉明', '约 −40 dB 量级', '约 1.4～1.6', '简单常用'],
            ['凯泽（β 可调）', '由 β 连续可调', '随 β 增大', '旁瓣-束宽连续折中'],
            ['切比雪夫（Dolph）', '按设计值（等纹波）', '约 1.2～1.7', '**给定旁瓣下主瓣最窄**（等纹波最优）'],
            ['泰勒', '按设计值（前若干旁瓣等高）', '约 1.2～1.5', '雷达相控阵最常用']
          ] },
          {
            t: 'plot', title: '幅度加权对比（N = 15，d = λ/2，指向正横）', height: 380,
            render: function (cv) {
              const phi = gen(721, i => i * 0.5);
              const N = 15;
              const wU = new Float64Array(N).fill(1);
              const wH = C.window('hamming', N);
              const wC = chebyWeights(N, 35);
              const series = [wU, wH, wC].map(w => ulaAF(w, 0.5, 90, phi, -46).db);
              polarDb(cv, { theta: phi, series: series, colors: [1, 0, 2], height: 380 });
            },
            caption: '均匀（−13.4 dB 旁瓣）→ 汉明 → 切比雪夫（设计旁瓣 −35 dB，等纹波）。旁瓣每降低一个量级，主瓣都相应展宽。'
          },
          { t: 'callout', kind: 'eng', title: '加权损失的账要算在灵敏度上', md: '加权在压低旁瓣的同时降低了阵列的等效孔径（相干增益从 $N$ 降到 $\\sum|w_n|^2$ 相关的量值），表现为**检测灵敏度损失 1～3 dB** 与波束展宽。声呐设计里这笔账直接进声呐方程的 DI 项；雷达里则体现在天线增益与和差波束斜率上。**先明确场景最需要动态范围还是灵敏度，再选加权**。切比雪夫加权的"等纹波最优性"（给定旁瓣电平下主瓣最窄）使它成为阵列设计常用的基准。' }
        ]
      },
      /* ---------------- 5 ---------------- */
      {
        id: 'gain', num: '5', title: '阵列增益与指向性指数 DI',
        blocks: [
          { t: 'md', md: '两个经常混用的指标需要严格区分：' },
          { t: 'kv', title: '定义与关系', pairs: [
            ['阵列增益 AG', '阵处理输出的信噪比改善（dB），依赖噪声场：$AG = 10\\log_{10}\\frac{(\\mathbf{w}^{\\mathrm H}\\mathbf{s})^2}{\\mathbf{w}^{\\mathrm H}\\mathbf{R}_n\\mathbf{w}}$。白噪声各向同性场中对 ULA 有 $AG = 10\\log_{10}N$（$d=\\lambda/2$）'],
            ['指向性指数 DI', '只由方向图决定的量：$DI = 10\\log_{10}D$，$D = \\frac{4\\pi\\,|F(\\theta_0)|^2}{\\oint|F(\\theta)|^2\\mathrm{d}\\Omega}$（三维）。对长为 $L = Nd$ 的线阵近似 $D \\approx 2Nd/\\lambda$'],
            ['二者关系', '各向同性白噪声场中 $AG = DI$（对同孔径、无指向性单元成立）；噪声场有方向性时两者分道扬镳']
          ] },
          { t: 'math', tex: 'D \\approx \\frac{2Nd}{\\lambda} \\quad(\\text{线阵，端射或长阵近似}) \\;\\;\\Longrightarrow\\;\\; DI_{dB} = 10\\log_{10}\\frac{2Nd}{\\lambda}', tag: '(5)' },
          { t: 'md', md: '把 $d = \\lambda/2$ 代入得 $DI = 10\\log_{10}N$——与阵列增益一致，这也是"阵元数翻倍增益涨 3 dB"这句口诀的来源。注意 $D \\approx 2Nd/\\lambda$ 是线阵在**三维各向同性**噪声场中的指向性因子（$4\\pi$ 立体角分母里的贡献主要来自两侧正横方向的窄波束），它对小 $N$ 或端射指向会有偏差，工程上以实测方向图积分标定为准。' },
          { t: 'metrics', list: [
            { label: 'N = 8, d = λ/2', value: 'DI ≈ 9.0', unit: 'dB' },
            { label: 'N = 32, d = λ/2', value: 'DI ≈ 15.1', unit: 'dB' },
            { label: 'N = 64, d = λ/2', value: 'DI ≈ 18.1', unit: 'dB' },
            { label: '每翻倍增益', value: '+3.0', unit: 'dB' }
          ] },
          { t: 'callout', kind: 'eng', title: '声呐方程中的 DI 与 AG', md: '声呐方程 $SE = SL - 2TL + TS - (NL - DI) - DT$ 里的 DI 指接收阵指向性指数，它把各向同性环境噪声抑制掉的部分计入。但正如「白噪声与色噪声」一节强调的：流噪声等沿阵传播的**相关**噪声不受指向性抑制，实际增益达不到 DI——设计拖曳阵时要把这一项按实测相干性折减，否则作用距离预算会系统性偏乐观。' }
        ]
      },
      /* ---------------- 6 ---------------- */
      {
        id: 'narrow', num: '6', title: '窄带假设与宽带波束形成',
        blocks: [
          { t: 'md', md: '式 (1) 的相移补偿隐含了一个假设：**信号带宽足够窄，使得"一个相位"能同时代表整个带宽**。判断标准是：信号带宽 $B$ 对应的时延量 $1/B$ 内，波前在各阵元间的真实时延差 $\\tau_{max} = d\\sin\\theta/c$ 是否引起显著相位走动，即 $B\\tau_{max} \\ll 1$。' },
          { t: 'math', tex: '\\text{窄带条件：}\\quad B \\ll \\frac{c}{d\\,|\\sin\\theta|_{\\max}} \\quad\\Longleftrightarrow\\quad \\text{带宽内相位走动远小于 } 2\\pi', tag: '(6)' },
          { t: 'md', md: '宽带情形下用固定相移形成波束会出问题：**波束指向随频率漂移**（相移对频率的等效时延随频率反比变化），波束变宽变形。对策有三：**真时延波束形成**（数字域对每路做分数延迟滤波）、**频域分频段**（把宽带拆成若干窄带子带，每个子带用自己的相移）、以及恒定束宽设计（加权随频率调整）。下一页将定量给出相移与真时延的差别。' },
          { t: 'callout', kind: 'pit', title: '误区：把窄带相移用到宽带信号上', md: '典型症状：宽带chirp目标在波束输出里"频率越高方向越歪"，方位估计随处理频段漂移。原因正是相移补偿的时延量 $\\tau = \\Delta\\phi/\\omega$ 只在设计频率正确。修正：宽带一律用真时延（数字分数延迟滤波器）或分频段处理。判断阈值可用 $B/f_0 > 10\\%$ 作为警戒线。' },
          { t: 'callout', kind: 'pit', title: '误区：阵元间距超过 λ/2 只考虑"半批阵元浪费"', md: '间距大于半波长首先带来**栅瓣**（把干扰和目标从错误方向"抄近道"混进来），其次才是孔径利用问题。栅瓣在扫描时还会进入可视区形成假目标，比单纯的旁瓣抬高危险得多。详见下一页。' }
        ]
      }
    ],
    refs: [
      'Van Trees, Optimum Array Processing, 第 2–3 章',
      'Balanis, Antenna Theory: Analysis and Design, 第 6 章',
      'Nielsen, Sonar Signal Processing（声呐基阵与波束形成）'
    ]
  });

  /* ============================================================
     6. 相移、波束扫描与栅瓣
     ============================================================= */
  doc.register('theory/array/steering', {
    title: '相移、波束扫描与栅瓣',
    lede: '波束形成器"指哪打哪"靠的是相位补偿；但相位只在一个频率上正确。扫描让波束变宽、让栅瓣进屋——这一页把扫描的三笔账（相移误差、孔径投影、栅瓣条件）一次算清。',
    tags: ['阵列', '波束扫描', '栅瓣', '宽带'],
    labs: [{ path: 'lab/music', title: 'MUSIC 超分辨谱估计实验台', desc: '观察不同间距与扫描角下的阵列流形' }],
    toc: true,
    intro: '扫描波束是阵列最日常的操作。这一页回答三个被反复问到的工程问题：**相移和真时延差在哪、扫描为什么让波束变宽变弱、间距放宽到多少会出栅瓣**。',
    sections: [
      /* ---------------- 1 ---------------- */
      {
        id: 'phasetd', num: '1', title: '相移 vs 真时延：一个只在一个频率上成立',
        blocks: [
          { t: 'md', md: '相邻阵元的真实到达时差为 $\\tau = d\\cos\\varphi/c$（$\\varphi$ 为从阵轴起算的方位角）。补偿它有两条路：' },
          { t: 'table', cols: ['', '窄带相移', '真时延'], rows: [
            ['操作', '乘复数 exp(−jω₀τ)（单频相位）', '延迟信号 xₙ(t−τ)（全带宽正确）'],
            ['正确性', '只在 ω₀ 处精确', '全带宽精确'],
            ['实现', '频域逐 bin 复乘（窄带）', '分数延迟滤波器 / 多相插值 / 频域相位斜率'],
            ['宽带后果', '波束指向随频率漂移、变形', '各频率指向一致']
          ] },
          {
            t: 'plot', title: '窄带相移的频率依赖：按 f₀ = 1 kHz、d = λ₀/2、N = 16 设计 45° 扫描，在其它频率上的实际波束', height: 290,
            render: function (cv) {
              const f0 = 1000, c0 = 1500, dLam0 = 0.5;      // 设计频率下 d = λ/2
              const lam0 = c0 / f0, d = dLam0 * lam0;
              const phiS = 45;                              // 从阵轴起算
              const N = 16;
              const phi = gen(3601, i => i * 0.05);         // 0–180°，0.05° 网格
              const p = DSP.plot.new(cv, { height: 290, xlabel: '方位角 φ / °（0° 为端射）', ylabel: '归一化 / dB', legend: true, legendPos: 'tr', xlim: [0, 180], ylim: [-40, 2] });
              [800, 1000, 1250].forEach((f, i) => {
                const db = gen(phi.length, k => {
                  const psi = 2 * Math.PI * f * d / c0 * Math.cos(phi[k] * Math.PI / 180) - 2 * Math.PI * f0 * d / c0 * Math.cos(phiS * Math.PI / 180);
                  let re = 0, im = 0;
                  for (let n = 0; n < N; n++) { re += Math.cos(n * psi); im += Math.sin(n * psi); }
                  return Math.max(20 * Math.log10(Math.max(Math.hypot(re, im) / N, 1e-9)), -40);
                });
                p.add({ x: phi, y: db, color: i, width: 1.6, label: 'f = ' + f + ' Hz' + (f === f0 ? '（设计频率）' : '') });
              });
              p.vline(45, { label: '设计指向 45°', color: '#334155', dash: [5, 3] }).draw();
            },
            caption: '相移按 f₀ 设计 → 频率偏离时主瓣指错方向：800 Hz 时实际指向约 28°，1250 Hz 时约 56°（理论 cosφ = (f₀/f)·cos45°）。间距越大或偏离越远，漂移越大。'
          },
          { t: 'callout', kind: 'eng', title: '工程实现的选择', md: '**窄带系统**（CW 主动、窄带被动线谱检测）在频域做：每个频率 bin 一套复权向量，一次 FFT 全覆盖，实现最简单。**宽带系统**（宽带被动检测、宽带主动脉压）必须真时延：数字域用分数延迟 FIR 或多相插值滤波器实现任意精度时延，或直接在频域按 $e^{-j2\\pi f\\tau}$ 逐 bin 补相位（这本质上就是真时延的频域实现）。声呐多波束形成器常用"FFT → 逐 bin 相位补偿 → 反 FFT"的频域分频段结构，兼顾精度与并行度。' }
        ]
      },
      /* ---------------- 2 ---------------- */
      {
        id: 'scan', num: '2', title: '扫描的两笔代价：波束展宽与孔径投影损失',
        blocks: [
          { t: 'fold', summary: '展开：扫描展宽与投影损失的推导', deriv: true, blocks: [
            { t: 'md', md: '波束宽度由孔径在**垂直于视线方向**的投影长度决定。阵列物理孔径 $L = Nd$，扫描到从阵轴起算 $\\varphi_0$ 时，投影孔径为 $L_{\\text{eff}} = L\\sin\\varphi_0$。代入束宽公式（对应教科书中从正横起算 $\\theta_0$、$\\cos\\theta_0 = \\sin\\varphi_0$ 的形式）：' },
            { t: 'math', tex: '\\theta_{3dB}(\\varphi_0) \\approx \\frac{0.886\\,\\lambda}{L\\sin\\varphi_0} = \\frac{\\theta_{3dB}(90^\\circ)}{\\sin\\varphi_0}', tag: '(1)' },
            { t: 'md', md: '正横（$\\varphi_0 = 90^\\circ$，$\\sin = 1$）最窄；向端射扫描时 $\\sin\\varphi_0 \\to 0$，束宽按 $1/\\sin\\varphi_0$ 发散。同时**指向性也按投影孔径下降**（发射时该方向的辐射功率密度降低，即扫描损失）。雷达相控阵把扫描范围限制在正横 ±60° 内，深层原因就是端射附近束宽发散、增益崩塌与栅瓣风险三者叠加。' },
            { t: 'math', tex: 'D(\\varphi_0) \\propto L\\sin\\varphi_0 \\qquad\\Longrightarrow\\qquad \\text{扫描损失} \\approx 10\\log_{10}\\frac{D(\\varphi_0)}{D(90^\\circ)} = 10\\log_{10}\\sin\\varphi_0', tag: '(2)' }
          ] },
          {
            t: 'plot', title: '扫描展宽实测：指向 90°（正横）、60°、30°、15° 的波束图（直角坐标，N = 16，d = λ/2）', height: 270,
            render: function (cv) {
              const phi = gen(1441, i => i * 0.125);
              const w = new Float64Array(16).fill(1);
              const p = DSP.plot.new(cv, { height: 270, xlabel: '方位角 φ / °（0° 为端射）', ylabel: '归一化 / dB', legend: true, legendPos: 'tr', xlim: [0, 180], ylim: [-42, 2] });
              [90, 60, 30, 15].forEach((s, i) => {
                const r = ulaAF(w, 0.5, s, phi, -42);
                p.add({ x: phi, y: r.db, color: i, width: 1.5, label: '指向 ' + s + '°' });
              });
              p.draw();
            },
            caption: '同一 16 元阵：正横束宽约 6.4°，扫到 30° 时约 12.8°（×1/sin30°），扫到 15° 时超过 24°——端射附近急剧发散。'
          },
          { t: 'callout', kind: 'pit', title: '误区：忽略扫描时的孔径投影损失', md: '用正横方向的波束宽度和增益去评估大角度扫描时的性能，会高估一倍以上。多波束系统的覆盖均匀性、相控阵雷达的扫描驻留时间分配、声呐警戒扇区的灵敏度标定，都必须按 $\\sin\\varphi_0$ 逐波束修正。' }
        ]
      },
      /* ---------------- 3 ---------------- */
      {
        id: 'grating', num: '3', title: '栅瓣：条件、推导与危害',
        blocks: [
          { t: 'fold', summary: '展开：栅瓣条件的推导', deriv: true, blocks: [
            { t: 'md', md: '阵因子 $\\mathrm{AF}(\\psi)$ 以 $2\\pi$ 为周期（$\\psi$ 为阵元间相位差）。主峰出现在 $\\psi = 0, \\pm2\\pi, \\pm4\\pi,\\dots$；扫描角 $\\theta_0$（从正横起算）只是把 $\\psi = 0$ 对准了它。**问题在于：可视区（$\\theta\\in[-90^\\circ,90^\\circ]$，即 $\\sin\\theta\\in[-1,1]$）内是否还容得下另一个峰**。' },
            { t: 'md', md: '相邻峰对应 $\\psi$ 相差 $2\\pi$，即 $\\frac{2\\pi d}{\\lambda}(\\sin\\theta - \\sin\\theta_0) = 2\\pi \\Rightarrow \\sin\\theta = \\sin\\theta_0 + \\frac{\\lambda}{d}$。栅瓣进入可视区要求 $|\\sin\\theta|\\le 1$，最恶劣情形是扫描到端射方向 $\\sin\\theta_0 = 1$：' },
            { t: 'math', tex: '1 + \\frac{\\lambda}{d} > 1 \\;\\text{恒成立}\\;\\Rightarrow\\;\\text{端射必出栅瓣？否——}\\;\\sin\\theta = 1+\\lambda/d > 1 \\text{ 时栅瓣恰在可视区外}', tag: '(3)' },
            { t: 'md', md: '整理可得栅瓣不出现在可视区的条件：对最大扫描角 $\\theta_{max}$（从正横起算）' },
            { t: 'math', tex: 'd \\le \\frac{\\lambda}{1 + |\\sin\\theta_{max}|} \\qquad(\\text{正横即 } \\theta_{max}=0 \\text{ 时 } d \\le \\lambda)', tag: '(4)' },
            { t: 'md', md: '全向扫描（$\\theta_{max} = 90^\\circ$）要求 $d \\le \\lambda/2$——这就是"半波长间距"铁律的来源。放宽间距必须在扫描范围上做牺牲：$d = 0.6\\lambda$ 时最大扫描角约 $\\arcsin(1/0.6 - 1) \\approx 41^\\circ$。' }
          ] },
          {
            t: 'plot', title: '间距的代价：d = λ/2（无栅瓣）vs d = 2λ（栅瓣进屋）', height: 380,
            render: function (cv) {
              const phi = gen(721, i => i * 0.5);
              const w = new Float64Array(8).fill(1);
              const a1 = ulaAF(w, 0.5, 90, phi, -42);
              const a2 = ulaAF(w, 2.0, 90, phi, -42);
              polarDb(cv, { theta: phi, series: [a1.db, a2.db], colors: [0, 2], height: 380 });
            },
            caption: '同为 8 元、指向正横：d = λ/2 只有主瓣与旁瓣；d = 2λ 出现 4 个等强度假波束（栅瓣），目标方位完全无法判定。'
          },
          { t: 'md', md: '**栅瓣与旁瓣的区别**必须分清：旁瓣幅度始终低于主瓣（受加权控制），而**栅瓣幅度与主瓣相同**（同样是 $\\psi = 0$ 的峰），加权只能压低"栅瓣旁边的纹波"，压不掉栅瓣本身。栅瓣进入可视区后，来自那个方向的任何信号都会以与真目标相同的幅度出现在输出里——这是比旁瓣严重得多的模糊源。' },
          { t: 'md', md: '**稀疏阵的权衡**：水声中拖曳阵、雷达中相控阵都对"以更少阵元获得更大孔径"有强烈需求（孔径决定分辨率与增益）。稀疏化带来省阵元的好处，代价是栅瓣；对策是**不等间距（随机稀疏）布阵**——让各阵元对的间距互不相同，栅瓣能量被摊散成背景旁瓣，峰值旁瓣通常能控制在 −20 dB 量级，进一步压低要靠优化布阵与幅度加权联合设计。' },
          { t: 'callout', kind: 'eng', title: '声呐稀疏阵与雷达相控阵的取舍', md: '声呐：低频（如几百赫兹）波长可达数米，全孔径满阵的阵元数与造价不可接受，实际拖曳阵多用米级间距 + 随机化处理，靠宽带处理（栅瓣位置随频率变化，宽带累积后栅瓣被抹散）缓解模糊。雷达：X 波段波长 3 cm，半波长间距 1.5 cm，数千阵元可行，因而满阵 + 数字/模拟移相器是主流。**"能不能用半波长间距"本质是波长与预算的比值问题**。' }
        ]
      },
      /* ---------------- 4 ---------------- */
      {
        id: 'cal', num: '4', title: '相位量化、幅相误差与校准',
        blocks: [
          { t: 'md', md: '**相位量化误差。** 数字移相器位数有限（常见 4～8 位），量化步进 $2\\pi/2^b$ 引起随机相位误差，方差 $\\sigma_\\phi^2 = (2\\pi/2^b)^2/12$。它对方向图的影响：**平均旁瓣电平抬高约 $\\sigma_\\phi^2$（功率比）**，对 $N$ 元阵量化抬高的平均旁瓣约为 $10\\log_{10}(\\sigma_\\phi^2/N)$，同时主瓣增益略有下降。6 位（步进 5.6°）时 $\\sigma_\\phi \\approx 1.6^\\circ$，$N=64$ 阵的平均旁瓣抬升约 $-38$ dB——多数场景可接受；4 位则开始明显。' },
          { t: 'math', tex: '\\mathrm{SLL}_{\\text{量化抬升}} \\approx 10\\log_{10}\\!\\left(\\frac{\\sigma_\\phi^2}{N}\\right),\\qquad \\sigma_\\phi = \\frac{2\\pi}{2^b\\sqrt{12}}', tag: '(5)' },
          { t: 'md', md: '**幅相误差与校准。** 阵元的制造公差、电缆长度差、通道幅频不一致，都会让实际导向向量偏离理想流形。后果：旁瓣抬高、零点变浅、（对高分辨算法）流形失配导致测向偏差。**校准**的做法：用已知位置的参考源（雷达用近场探针或转台，声呐用标准声源或海面回波）测量各通道的幅相响应，把修正系数存表，在波束形成权中预畸变。校准后残留误差决定方向图的工程极限。' },
          { t: 'callout', kind: 'pit', title: '误区：以为阵元越多越好', md: '阵元数的收益有三重天花板：**栅瓣**（间距受限时加阵元会加出栅瓣或被迫减小间距）、**幅相误差**（通道一致性做不到时，$N$ 越大平均旁瓣虽然按 $1/N$ 下降，但系统性偏差如阵列弯曲不随 $N$ 平均）、以及**相关噪声**（见「白噪声与色噪声」第 5 节，空间相关的噪声让增益饱和）。设计从指标反推：需要的束宽与增益决定孔径，孔径与波长决定最小阵元数，再校核栅瓣与误差预算。' },
          { t: 'callout', kind: 'pit', title: '误区：方向图仿真很漂亮，实测不走样', md: '仿真里的方向图假设了完美的幅相一致与刚性的几何位置。真实阵列中阵元失效（某一路彻底坏掉 → 旁瓣结构性抬升与零点填平）、水声阵形畸变（拖曳阵抖动弯曲 → 流形随时间变化）、通道温漂，都会显著改变方向图。**交付前必须用实测校准数据复核方向图，并对阵元失效做敏感性分析**（如随机移除 5% 阵元再看旁瓣）。' }
        ]
      }
    ],
    refs: [
      'Balanis, Antenna Theory, 第 6 章（栅瓣与阵因子）',
      'Mailloux, Phased Array Antenna Handbook（扫描损失与量化旁瓣）',
      'Van Trees, Optimum Array Processing, 第 3 章',
      'Knight, W. C., Pridham, R. G., Kay, S. M., Digital signal processing for sonar, Proc. IEEE, 1981'
    ]
  });

  /* ============================================================
     7. 指向性与阵列孔径
     ============================================================= */
  doc.register('theory/array/directivity', {
    title: '指向性与阵列孔径：分辨率、近场与合成孔径',
    lede: '孔径是阵列的一切：它决定波束多窄、增益多高、近场多远。当物理孔径给不出想要的分辨率时，人们发明了合成孔径——用运动换孔径。',
    tags: ['阵列', '指向性', '孔径', '合成孔径'],
    labs: [{ path: 'lab/music', title: 'MUSIC 超分辨谱估计实验台', desc: '对比孔径受限的常规处理与超分辨算法' }],
    toc: true,
    intro: '这一页把"孔径"作为主线：**孔径 → 分辨率 → 增益 → 近远场判据 → 物理限制 → 合成孔径的思想**。最后讨论超指向性为什么在工程上不实用。',
    sections: [
      /* ---------------- 1 ---------------- */
      {
        id: 'di', num: '1', title: '指向性 D 与指向性指数 DI',
        blocks: [
          { t: 'md', md: '指向性因子 $D$ 的物理含义：**真实方向图辐射（或接收）的功率，相对同等总功率下全向辐射的功率之比**（在最大方向）。它的定义是一个球面积分：' },
          { t: 'math', tex: 'D = \\frac{4\\pi\\,|F(\\theta_0,\\phi_0)|^2}{\\displaystyle\\oint_{4\\pi}|F(\\theta,\\phi)|^2\\,\\mathrm{d}\\Omega} \\qquad DI = 10\\log_{10}D', tag: '(1)' },
          { t: 'md', md: '对长度 $L = Nd$ 的连续线阵（各向同性单元），在三维各向同性噪声场中 $D \\approx 2L/\\lambda$，即 ULA 的 $DI \\approx 10\\log_{10}(2Nd/\\lambda)$；代入 $d = \\lambda/2$ 得 $DI = 10\\log_{10}N$。**注意这个"2 倍"来自三维积分**：如果只在二维平面内讨论（平面问题），分母变 $2\\pi$，系数相应改变。引用 DI 数值时要声明三维还是二维定义，两套口径差 3 dB。' },
          { t: 'md', md: 'DI 与波束宽度不是独立量：方向图越窄，分母积分越小，DI 越大。对单波束近似（把主瓣近似为宽度 $\\Delta$ 的高斯/矩形），$D \\sim 4\\pi/\\Omega_{\\text{束}}$，束宽减半 DI 涨 6 dB 量级——**分辨率与增益本是一体**。' }
        ]
      },
      /* ---------------- 2 ---------------- */
      {
        id: 'res', num: '2', title: '孔径与角分辨率：空域瑞利判据',
        blocks: [
          { t: 'md', md: '两个等强度的点源要被常规波束形成分开，最小间隔就是主瓣宽度（瑞利判据在空域的形式）：' },
          { t: 'math', tex: '\\Delta\\theta \\approx \\frac{\\lambda}{L\\sin\\varphi_0} \\approx \\frac{\\lambda}{Nd\\cos\\theta_0} \\quad(\\text{正横附近})', tag: '(2)' },
          { t: 'md', md: '与时间域"带宽决定时延分辨率"完全对偶：**带宽 ↔ 孔径，时延 ↔ 方位**。角分辨率只随孔径线性改善，而孔径受物理尺寸限制，这就是高分辨测向算法（MUSIC、ESPRIT 等）存在的理由——它们突破的是瑞利判据，代价是对噪声协方差矩阵精度与阵元误差的高敏感。' },
          { t: 'metrics', list: [
            { label: '10 kHz 水声，λ = 15 cm，L = 1.5 m', value: '束宽 ≈ 5.7', unit: '°' },
            { label: '1 kHz 水声，λ = 1.5 m，L = 1.5 m', value: '束宽 ≈ 57', unit: '°' },
            { label: '100 Hz 水声，λ = 15 m，L = 100 m 拖曳阵', value: '束宽 ≈ 8.6', unit: '°' },
            { label: 'X 波段雷达 λ = 3 cm，L = 3 m', value: '束宽 ≈ 0.57', unit: '°' }
          ] },
          { t: 'callout', kind: 'pit', title: '误区：忽略远场条件就在近场做波束形成', md: '平面波假设要求目标足够远：$r > 2D_{ap}^2/\\lambda$（夫琅禾费距离）。对 $D_{ap} = 3$ m、$\\lambda = 0.15$ m 的声呐阵，该距离为 120 m——**近岸试验场里 100 m 的目标还在菲涅耳区**，波前曲率不可忽略，方向图畸变、测向偏差明显。近场处理要么用球面波流形（聚焦波束形成），要么把目标推远。雷达相控阵在近场测试时同样要做聚焦补偿。' }
        ]
      },
      /* ---------------- 3 ---------------- */
      {
        id: 'apert', num: '3', title: '孔径-束宽-增益曲线与物理限制',
        blocks: [
          {
            t: 'widget', render: function (el) {
              const Ls = gen(60, i => 0.1 + i * 0.1);          // 孔径 0.1–6 m
              const lam1 = 0.15, lam2 = 1.5;                   // 10 kHz 与 1 kHz
              const bw = lam => gen(Ls.length, i => Math.min(120, (0.886 * lam / Ls[i]) * 180 / Math.PI));
              const di = lam => gen(Ls.length, i => 10 * Math.log10(2 * Ls[i] / lam));
              figure(el, 2, [
                {
                  title: '正横束宽 vs 孔径（10 kHz 与 1 kHz）',
                  caption: '孔径翻倍束宽减半；频率降 10 倍，同样孔径束宽大 10 倍。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 240, xlabel: '孔径 L / m', ylabel: '−3 dB 束宽 / °', legend: true, legendPos: 'tr' });
                    p.add({ x: Ls, y: bw(lam1), color: 0, width: 1.8, label: '10 kHz（λ = 15 cm）' })
                      .add({ x: Ls, y: bw(lam2), color: 1, width: 1.8, label: '1 kHz（λ = 1.5 m）' })
                      .hline(10, { label: '10° 参考线', color: '#334155' })
                      .draw();
                  }
                },
                {
                  title: '指向性指数 DI vs 孔径（DI ≈ 10 lg(2L/λ)）',
                  caption: '同样孔径，频率每降一个倍频程 DI 损失 3 dB；100 Hz 时差距悬殊。',
                  render: function (cv) {
                    const p = DSP.plot.new(cv, { height: 240, xlabel: '孔径 L / m', ylabel: 'DI / dB', legend: true, legendPos: 'tr' });
                    const lam3 = 15;
                    p.add({ x: Ls, y: di(lam1), color: 0, width: 1.8, label: '10 kHz' })
                      .add({ x: Ls, y: di(lam2), color: 1, width: 1.8, label: '1 kHz' })
                      .add({ x: Ls, y: di(lam3), color: 2, width: 1.8, label: '100 Hz（λ = 15 m）' })
                      .draw();
                  }
                }
              ]);
            }
          },
          { t: 'md', md: '图中的账一目了然：**水下低频是孔径的黑洞**。100 Hz 时波长 15 m，想拿到与 10 kHz、1.5 m 孔径相同的 5.7° 束宽，需要 150 m 的物理孔径——这就是为什么低频声呐要么用百米级拖曳线列阵（TB-29 级长阵），要么走向合成孔径。孔径的物理约束来自平台：舰壳阵受船体长度限制（数十米封顶），拖曳阵可以长但受收放、流噪声与阵形抖动约束，固定基阵受场地约束。' },
          { t: 'table', cols: ['平台/形式', '典型孔径', '典型频段', '约束'], rows: [
            ['舰壳球鼻艏阵', '数米（圆柱/球阵）', '中高频（1–10 kHz）', '船体尺寸、自噪声（流噪声/螺旋桨）'],
            ['拖曳线列阵', '数十至上百米', '低频（10–1000 Hz）', '阵形抖动、流噪声、收放与拖曳机动'],
            ['相控阵雷达', '1–10 m（固定面板）', '微波（λ ~ 3–30 cm）', '阵元数、T/R 组件成本、热管理']
          ] }
        ]
      },
      /* ---------------- 4 ---------------- */
      {
        id: 'sas', num: '4', title: '合成孔径：用运动换孔径',
        blocks: [
          { t: 'md', md: '物理孔径给不够，就让**平台运动来合成**：把一个真实小孔径阵元沿航线拖动，在每个位置发射并记录回波，事后把所有位置的回波按"虚拟大孔径阵列"做相干叠加——这就是合成孔径声呐（SAS）与合成孔径雷达（SAR）的思想。合成后的孔径等于平台在相干积累期间走过的路程 $L_{syn}$，方位分辨率突破物理阵长限制：' },
          { t: 'math', tex: '\\Delta\\theta \\approx \\frac{\\lambda}{2 L_{syn}} \\quad\\Longleftrightarrow\\quad \\text{方位分辨率（地面/海底）} \\;\\delta_{az} \\approx \\frac{\\lambda\\,r}{2L_{syn}} \\;\\to\\; \\text{与波长无关的} \\;\\tfrac{D_{\\text{真实}}}{2}', tag: '(3)' },
          { t: 'md', md: 'SAR 的著名结论"方位分辨率与波长和距离无关、只等于真实天线尺寸的一半"来自双程路径补偿；SAS 里对应的处理是逐脉冲相位对齐（运动补偿）与宽带相干积累。**代价与限制**：一是**相位相干性**——平台位置必须知道到波长的十分之一量级（声呐 1.5 cm 波长意味着厘米级定位，需要高精度惯导与声学基线）；二是**目标静止假设**——积累期间场景不能变化（声呐中水中目标游动、海底鱼群会造成散焦）；三是**航速与重复频率的折中**——为了保证方位采样不模糊，航速受"每前进半副真实孔径至少发射一次"的约束。' },
          { t: 'callout', kind: 'eng', title: 'SAS 的工程现实', md: '现代 SAS（如干涉 SAS 测深、成像声呐）已经把海底成像分辨率做到厘米级，远超同尺寸真实孔径声呐；但它们的工作场景几乎都是**海底（静止场景）+ 中高频 + 中低速拖曳**。对运动目标（潜艇、鱼群）合成孔径处理会散焦，需要自动聚焦或快照式处理。雷达 SAR 则因微波波长短、平台（卫星/飞机）惯导好，成为全天候成像的主力。' }
        ]
      },
      /* ---------------- 5 ---------------- */
      {
        id: 'super', num: '5', title: '超指向性：为什么它不实用',
        blocks: [
          { t: 'md', md: '给定 $N$ 个阵元，理论上的最优方向图（在指定方向最大化 $D$）并不受"半波长间距"限制——**超指向性（超增益）阵列**允许 $d \\ll \\lambda/2$，靠在各阵元上施加符号交替、幅度悬殊的复权来逼近理论上限。问题是：' },
          { t: 'table', cols: ['代价', '量级', '后果'], rows: [
            ['灵敏度损失（加权矢量范数增大）', '数十 dB（小间距时）', '阵元自噪声被放大，总输出噪声暴涨'],
            ['对幅相误差的病态敏感性', '误差 0.1° 级即可破坏方向图', '制造与校准达不到'],
            ['阵列协方差矩阵病态', '条件数巨大', '权求解数值不稳定'],
            ['带宽极窄', '超指向性只在极窄频带成立', '宽带信号下失效']
          ] },
          { t: 'md', md: '结论：超指向性在数学上存在、在工程上**几乎不用**（极少数短基线声学应用除外）。实践中"分辨率靠孔径、误差靠校准、增益靠阵元数"是更可靠的路线。' },
          { t: 'callout', kind: 'pit', title: '误区：把理论指向性当成实测性能', md: '手册上的 DI 是理想方向图积分的结果。实测中阵元失效（方向图出现结构性空洞或旁瓣抬升）、幅相误差（平均旁瓣抬高）、阵形畸变（流形漂移）都会让真实 DI 打折扣。**验收阵列性能必须实测方向图并重新积分**，尤其是拖曳阵——每次布放后阵形都不同。' },
          { t: 'callout', kind: 'eng', title: '把这一页串起来：阵列设计的完整流程', md: '（1）由分辨率需求定孔径 $L \\approx 0.886\\lambda/\\theta_{3dB}$；（2）由扫描范围定间距 $d \\le \\lambda/(1+|\\sin\\theta_{max}|)$，进而得阵元数 $N = L/d$；（3）由动态范围需求选加权（切比雪夫/泰勒），核算灵敏度损失；（4）由噪声场（各向同性？相关？）核算阵列增益而非只看 DI；（5）校核近远场边界与宽带条件；（6）留出幅相误差与失效的余量。这六步走完，阵列参数基本定型。' }
        ]
      }
    ],
    refs: [
      'Urick, Principles of Underwater Sound, 第 3 章（指向性）',
      'Cutrona, Synthetic aperture radar / sonar 对比综述',
      'Van Trees, Optimum Array Processing, 第 2 章',
      ' Hayes, M. P., Gough, P. T., Synthetic aperture sonar: a review（SAS 综述）'
    ]
  });

})(window);

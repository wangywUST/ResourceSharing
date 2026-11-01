/* =============================================================
   theory-basic.js —— 知识理论库 · 一、基础模块（6 页）
   路由：theory/basic/*

   内容写入方式：结构化 block（见 doc.js 头部注释）
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const doc = DSP.doc;
  const C = DSP.core;

  /* ============================================================
     1. 信号分类
     ============================================================ */
  doc.register('theory/basic/signal-class', {
    title: '信号分类：连续/离散、确定/随机、能量/功率',
    lede: '信号分类不是形式主义——它直接决定你该用哪一套数学工具：能否做 DTFT、该用 PSD 还是频谱、 该用什么噪声模型。',
    tags: ['基础', '信号与系统', '分类'],
    labs: [],
    toc: true,
    sections: [
      {
        id: 'why', num: '1', title: '为什么第一课是"分类"',
        blocks: [
          { t: 'md', md: '工程上遇到一段采样数据，第一步不是急着画图，而是回答四个问题：是连续的还是离散的、是确定的还是随机的、能量有限还是功率有限、有没有周期性。这四个答案决定了后续能不能用 FFT、该看频谱还是功率谱、要不要先去均值。' },
          { t: 'md', md: '举个常见的翻车场景：把一段海洋环境噪声直接做 FFT 后指着某个尖峰说"发现了线谱"。随机信号的单次 FFT 本身就是随机量（方差不会随数据量下降），必须做功率谱平均。这一步的根源就是没分清"确定信号"与"随机信号"。' }
        ]
      },
      {
        id: 'ctdt', num: '2', title: '连续时间信号与离散时间信号',
        blocks: [
          { t: 'md', md: '连续时间信号 $x(t)$ 定义在连续时间轴上，自变量可以取任意实数；离散时间信号 $x[n]$（工程上也写 $x(n)$）只在整数序号上有定义。' },
          { t: 'math', tex: 'x[n] = x_a(nT_s),\\quad n = 0,\\pm1,\\pm2,\\dots', tag: '(1)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$x_a(t)$', '原始连续时间信号'],
            ['$T_s$', '采样间隔（秒），其倒数 $f_s = 1/T_s$ 为采样率'],
            ['$x[n]$', '离散时间序列，注意 n 是无量纲整数序号']
          ] },
          { t: 'callout', kind: 'note', title: '关键的思维转换', md: '从连续到离散，$t$ 消失了，$n$ 是"第几个采样点"。所有连续域的 $t$ 要用 $nT_s$ 代换：例如 $e^{j2\\pi f t}$ 变成 $e^{j2\\pi f nT_s} = e^{j\\omega n}$，其中 **$\\omega = 2\\pi f/f_s$ 是归一化角频率，单位是弧度/样本**，这个无量纲量是离散信号处理的全部基石。' },
          { t: 'callout', kind: 'pit', title: '误区：把归一化频率当成真实频率', md: '很多初学者画出频谱后直接读数，发现主峰在 $\\omega = 0.2\\pi$，就报告"信号频率是 0.2π Hz"。错。真实频率必须乘回来：$f = \\omega f_s/(2\\pi)$。若 $f_s=8\\,\\text{kHz}$，则 $f = 0.1\\times8000 = 800\\,\\text{Hz}$。**在雷达/声呐里这个错误会直接导致距离或速度估计错的离谱。**' }
        ]
      },
      {
        id: 'det', num: '3', title: '确定信号与随机信号',
        blocks: [
          { t: 'md', md: '确定信号：任一时刻的取值可由明确的数学表达式预测，$x[n] = f(n)$。例如单频正弦、LFM  chirp、矩形脉冲、阶跃。' },
          { t: 'md', md: '随机信号（随机过程的一次实现）：取值不可预测，只能用统计量描述——均值、方差、自相关函数、功率谱密度。水声信道噪声、雷达地杂波、海混响都属于这一类。' },
          { t: 'table', cols: ['', '确定信号', '随机信号'], rows: [
            ['描述方式', '解析表达式 / 波形', '统计特征（$\\mu,\\sigma^2,R_{xx},P_{xx}$）'],
            ['频谱工具', 'DTFT / DFT（频谱存在且确定）', '功率谱密度 PSD（需平均估计）'],
            ['单次 FFT 的意义', '直接就是频谱', '本身是随机变量，方差不随 $N$ 下降'],
            ['工程例子', '发射的 LFM 脉冲、本振信号', '海洋环境噪声、混响、接收机热噪声']
          ] },
          { t: 'callout', kind: 'eng', title: '工程师视角', md: '真实接收数据永远是"确定分量 + 随机分量"的混合：$x[n] = s[n] + w[n]$。处理的全部工作就是**在随机背景中把确定分量捞出来**（匹配滤波、相参积累、谱峰检测）。所以区分这两类不是为了分类而分类，是为了选检测器结构。' },
          { t: 'fold', summary: '展开：为什么单次样本函数的"频谱"要小心', deriv: false, md: '对一个各态历经的随机过程，单次实现的 DFT幅度平方 $|X[k]|^2/N$ 是周期的**随机变量，其方差约为均值的平方**（指数分布），即使把 $N$ 增大到无穷也不会收玫到真值。这就是为什么必须用 Welch / Bartlett 分段平均（牺牲分辨率换方差下降），见「周期图法」一节。' }
        ]
      },
      {
        id: 'energy', num: '4', title: '能量信号与功率信号',
        blocks: [
          { t: 'math', tex: 'E = \\sum_{n=-\\infty}^{\\infty} |x[n]|^2 \\quad\\text{（能量）},\\qquad P = \\lim_{N\\to\\infty}\\frac{1}{2N+1}\\sum_{n=-N}^{N}|x[n]|^2 \\quad\\text{（功率）}', tag: '(2)' },
          { t: 'md', md: '判据很简单：**能量有限（$E<\\infty$）的信号叫能量信号**，此时平均功率必为 0；**功率有限且非零的信号叫功率信号**，此时总能量必为无穷。' },
          { t: 'table', cols: ['类型', '能量 $E$', '功率 $P$', '频谱/谱密度', '典型例子'], rows: [
            ['能量信号', '有限', '0', '能量谱密度 $|X(e^{j\\omega})|^2$', '单脉冲、单次瞬态、有限长 chirp 脉冲'],
            ['功率信号', '$\\infty$', '有限且 >0', '功率谱密度 $P_{xx}(e^{j\\omega})$', '周期正弦、平稳随机噪声、连续发射的 CW ']
          ] },
          { t: 'callout', kind: 'warn', title: '为什么这条判据决定了"要不要做谱估计"', md: '能量信号的 DTFT 存在（能量谱密度有限），可以直接看频谱；功率信号的 DTFT 不收敛（含 $\\delta$ 冲激），必须落到功率谱密度。对一个平稳随机序列，其自相关函数与功率谱密度构成一对傅里叶变换（**维纳-辛钦定理**），这才是谱估计的理论出发点。' },
          { t: 'math', tex: 'P_{xx}(e^{j\\omega}) = \\sum_{m=-\\infty}^{\\infty} R_{xx}[m]\\,e^{-j\\omega m},\\qquad R_{xx}[m] = E\\{x[n]x^*[n-m]\\}', tag: '(3)' }
        ]
      },
      {
        id: 'others', num: '5', title: '其余常用分类维度',
        blocks: [
          { t: 'table', cols: ['维度', '两类', '为什么重要'], rows: [
            ['周期性', '周期 $x[n+N]=x[n]$ / 非周期', '周期信号可用离散谱（线谱）表示；DFT 隐含周期性假设这个是很多差错的根源'],
            ['对称性', '偶对称 $x[-n]=x[n]$ / 奇对称', '偶序列 DTFT 为纯实偶函数，做 FFT 可省一半计算；实偶序列的性质直接决定相位是否为 0'],
            ['因果性', '因果（$n<0$ 时为零）/ 非因果', 'IIR/FIR 能否实时实现；离线处理可双向滤波（filtfilt）绕开相位失真'],
            ['带宽', '窄带 / 宽带', '窄带可用解析信号 + 复包络，采样率可大幅降低（带通采样）'],
            ['平稳性', '平稳 / 非平稳', '非平稳信号（水声目标回波起伏）必须用 STFT / 小波等时频工具']
          ] }
        ]
      },
      {
        id: 'zoo', num: '6', title: '雷达/声呐常见信号族一览',
        blocks: [
          {
            t: 'widget', render: function (el) {
            const fs = 2000, N = 512;
            const rows = [
              { t: '单频 CW', f: (i) => Math.sin(2 * Math.PI * 200 * i / fs) },
              { t: '双音叠加', f: (i) => Math.sin(2 * Math.PI * 150 * i / fs) + 0.6 * Math.sin(2 * Math.PI * 430 * i / fs) },
              { t: 'LFM 扫频 0.05s', f: (i) => (i / fs < 0.05 ? Math.sin(2 * Math.PI * (120 * (i / fs) + 0.5 * 4000 * (i / fs) * (i / fs))) : 0) },
              { t: '瞬态脉冲', f: (i) => (Math.abs(i - 150) < 8 ? 1 : 0) },
              { t: '调幅 AM', f: (i) => (0.4 + 0.6 * Math.sin(2 * Math.PI * 20 * i / fs)) * Math.sin(2 * Math.PI * 400 * i / fs) }
            ];
            const t = Array.from({ length: N }, (_, i) => i / fs * 1000);
            const grid = DSP.util.h('div.grid.g2');
            rows.forEach(r => {
              const y = Array.from({ length: N }, (_, i) => r.f(i));
              const box = DSP.ui.plotBox({ title: r.t });
              const p = DSP.plot.new(box.canvas, { height: 150, xlabel: 't / ms', ylabel: '幅度', legend: false });
              p.add({ x: t, y: y, color: 0, width: 1.5 }).draw();
              grid.appendChild(box.el);
            });
            el.appendChild(grid);
            }
          },
          { t: 'md', md: '这五种基本波形组合出了雷达与声呐里绝大多数发射波形：**CW** 用于测速（多普勒敏感、距离分辨率差）；**LFM** 用于脉冲压缩（距离分辨率好、多普勒容忍度高）；**AM/脉冲串** 用于声呐测深与通信；**瞬态** 用于目标瞬态特征提取。' }]
      },
      {
        id: 'pit', num: '7', title: '本节常见误区速查',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 把单次随机样本当确定信号', md: '详见第 3 节。检测到一个谱峰不等于检测到信号，要看它是否稳定重复、是否超过统计门限（CFAR）。' },
          { t: 'callout', kind: 'pit', title: '② 混淆归一化频率与真实频率', md: '$f = \\omega f_s / 2\\pi$。画图前养成习惯：让横坐标带 Hz 单位。' },
          { t: 'callout', kind: 'pit', title: '③ 认为"能量谱密度"和"功率谱密度"可以互换', md: '两者差一个时间长度因子 $T$，混用会导致 SNR 算错几十 dB。工程上比较不同长度数据必须用功率谱密度（单位 V²/Hz），而不是功率谱（V²）。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, Discrete-Time Signal Processing, 3rd ed., 第 1–2 章',
      '程佩青《数字信号处理教程》第 1 章',
      'Waite, Practical Sonar Signal Processing（声呐信号族与波形选择）'
    ]
  });

  /* ============================================================
     2. 采样定理与混叠机理
     ============================================================ */
  doc.register('theory/basic/sampling', {
    title: '采样定理与混叠机理',
    lede: '采样不是"把连续曲线离散化"这么简单。频域里它是一次**周期延拓**，混叠就是延拓副本撞在一起。理解了这幅图景，抗混叠滤波器、过采样、带通采样就全通了。',
    tags: ['基础', '采样', '奈奎斯特', '混叠'],
    toc: true,
    labs: [{ path: 'lab/sampling', title: '采样定理交互实验台', desc: '拖动采样率，实时看到频谱折叠与"假目标"的产生过程' }],
    sections: [
      {
        id: 'what', num: '1', title: '采样在数学上到底做了什么',
        blocks: [
          { t: 'md', md: '理想采样 = 连续信号乘以周期冲激串 $p(t) = \\sum_n \\delta(t-nT_s)$：' },
          { t: 'math', tex: 'x_s(t) = x_a(t)\\cdot p(t) = \\sum_{n=-\\infty}^{\\infty} x_a(nT_s)\\,\\delta(t-nT_s)', tag: '(1)' },
          { t: 'md', md: '冲激串的傅里叶变换仍然是冲激串（间隔从 $T_s$ 变成 $f_s = 1/T_s$）：' },
          { t: 'math', tex: 'P(f) = \\frac{1}{T_s}\\sum_{k=-\\infty}^{\\infty}\\delta(f-kf_s) \\quad\\Longrightarrow\\quad X_s(f) = \\frac{1}{T_s}\\sum_{k=-\\infty}^{\\infty} X_a(f-kf_s)', tag: '(2)' },
          { t: 'callout', kind: 'tip', title: '一句话记住采样定理', md: '**时域相乘 = 频域卷积**。与冲激串卷积的效果就是把原频谱 $X_a(f)$ 每隔 $f_s$ 复制一遍，叠加起来。**采样本身不丢任何信息，丢信息的是后面的"看不清"**——如果副本之间互不重叠，理论上可以无损还原。' }
        ]
      },
      {
        id: 'pic', num: '2', title: '频域图景：从"不重叠"到"撞车"',
        blocks: [{
          t: 'plot', title: '三种采样率下的频谱延拓（同一带限信号 f_max = 100 Hz）', height: 240,
          render: function (canvas) {
            const fsList = [500, 220, 150];
            const p = DSP.plot.new(canvas, { height: 240, xlabel: 'f / Hz', ylabel: '幅度', legend: true, legendPos: 'tr' });
            const fm = 100;
            [0, 1, 2].forEach(si => {
              const fs = fsList[si];
              const N = 2001, fmin = -fs * 1.6, fmax = fs * 1.6;
              const f = DSP.util.linspace(fmin, fmax, N);
              const y = new Float64Array(N);
              for (let i = 0; i < N; i++) {
                let s = 0;
                for (let k = -2; k <= 2; k++) {
                  const fc = 0 + k * fs;
                  if (Math.abs(f[i] - fc) <= fm) {
                    const u = (f[i] - fc) / fm;
                    s += Math.cos(Math.PI / 2 * u) * Math.cos(Math.PI / 2 * u);
                  }
                }
                y[i] = s;
              }
              p.add({ x: f, y: y, color: si, width: si === 2 ? 2 : 1.5, dash: si === 2 ? [5, 3] : null, label: 'f_s = ' + fs + ' Hz' });
            });
            p.draw();
          }
        },
        { t: 'md', md: '左图三条曲线对应三种采样率。$f_s = 500$ Hz 时副本间隔很大，彼此干净分离；$f_s = 220$ Hz 时刚好贴上临界（$2f_{max}=200$）；$f_s = 150$ Hz 时副本重叠——重叠区域的谱值被直接相加，这就是**混叠**。' }]
      },
      {
        id: 'nyq', num: '3', title: '奈奎斯特条件的严格表述与推导',
        blocks: [
          { t: 'callout', kind: 'note', title: '采样定理（奈奎斯特–香农）', md: '若 $x_a(t)$ 带限于 $|f| \\le f_{max}$，且 $f_s > 2 f_{max}$，则 $x_a(t)$ 可由其样本 $x_a(nT_s)$ 唯一确定，重建公式为理想低通滤波（sinc 内插）。' },
          { t: 'math', tex: 'x_a(t) = \\sum_{n=-\\infty}^{\\infty} x_a(nT_s)\\;\\mathrm{sinc}\\!\\left(\\frac{t-nT_s}{T_s}\\right),\\quad \\mathrm{sinc}(u)=\\frac{\\sin(\\pi u)}{\\pi u}', tag: '(3)' },
          {
            t: 'fold', summary: '展开：由频域延拓到理想重建的完整推导', deriv: true, blocks: [
              { t: 'md', md: '**第一步**：由式 (2)，采样后频谱 $X_s(f) = \\frac{1}{T_s}\\sum_k X_a(f-kf_s)$，即原频谱的周期延拓，周期为 $f_s$。' },
              { t: 'md', md: '**第二步**：若 $f_s > 2f_{max}$，则位于 $|f| \\le f_s/2$ 的这一份副本与其余副本不重叠，因此在该区间内 $\\;X_a(f) = T_s\\,X_s(f)$。' },
              { t: 'md', md: '**第三步**：用一个理想低通滤出这一份。理想低通频率响应为 $H(f) = T_s\\cdot\\mathrm{rect}(f/f_s)$，即截止 $f_s/2$、通带增益 $T_s$。' },
              { t: 'md', md: '**第四步**：$H(f)$ 的冲激响应 $h(t) = T_s\\cdot f_s\\,\\mathrm{sinc}(f_s t) = \\mathrm{sinc}(t/T_s)$。于是 $x_a(t) = x_s(t)*h(t) = \\sum_n x_a(nT_s)\\,\\mathrm{sinc}\\!\\left(\\frac{t-nT_s}{T_s}\\right)$，即式 (3)。' },
              { t: 'callout', kind: 'warn', title: '严格大于，不是大于等于', md: '$f_s > 2f_{max}$ 必须是严格不等号。$f_s = 2f_{max}$ 时如果信号恰好在 $f_{max}$ 处有谱线（如纯正弦），两个副本会在边界处相接甚至相撞，采样点可能全部落在过零点上——得到的序列恒为零，信息彻底丢失。工程上永远取 $f_s \\ge (2.5\\sim4)f_{max}$。' }
            ]
          }
        ]
      },
      {
        id: 'alias', num: '4', title: '混叠：频率是怎么"折叠"回来的',
        blocks: [
          { t: 'md', md: '混叠不是"信号消失"，而是**生成一个假冒的低频**。对单频 $f$ 在采样率 $f_s$ 下，观测到的表观频率为：' },
          { t: 'math', tex: 'f_{alias} = \\left|\\, f - f_s\\cdot\\mathrm{round}\\!\\left(\\frac{f}{f_s}\\right) \\right|', tag: '(4)' },
          { t: 'table', cols: ['真实频率 f', '采样率 f_s', '观测到的频率', '工程后果'], rows: [
            ['700 Hz', '1000 Hz', '300 Hz', '频谱上出现假目标，完全无法区分'],
            ['1200 Hz', '1000 Hz', '200 Hz', '同上'],
            ['1050 Hz', '1000 Hz', '50 Hz', '落在极低端，极易被误认为工频干扰或目标多普勒'],
            ['1000 Hz', '1000 Hz', '0 Hz（直流）', '变成直流偏置，被 AC 耦合后彻底消失']
          ] },
          {
            t: 'widget', render: function (el) {
              const fs = 1000, fTrue = 700;
              const N = 200;
              const tc = DSP.util.linspace(0, 0.006, 400);
              const ts = DSP.util.linspace(0, 0.006, 20);
              const wrap = DSP.util.h('div.grid.g2');
              const b1 = DSP.ui.plotBox({ title: '连续信号（700 Hz）与采样点' });
              const p1 = DSP.plot.new(b1.canvas, { height: 180, xlabel: 't / ms', ylabel: 'x' });
              const xa = tc.map(t => Math.sin(2 * Math.PI * fTrue * t));
              const xs = ts.map(t => Math.sin(2 * Math.PI * fTrue * t));
              p1.add({ x: tc.map(v => v * 1000), y: xa, color: 1, width: 1.2, label: '真实 700 Hz' })
                .add({ x: ts.map(v => v * 1000), y: xs, type: 'scatter', color: 3, size: 3.5, label: '采样点 (fs=1 kHz)' })
                .add({ x: tc.map(v => v * 1000), y: tc.map(t => Math.sin(2 * Math.PI * 300 * t)), color: 2, dash: [5, 3], width: 1.4, label: '观测到的 300 Hz' })
                .draw();
              const b2 = DSP.ui.plotBox({ title: '对应的离散频谱' });
              const p2 = DSP.plot.new(b2.canvas, { height: 180, xlabel: 'k', ylabel: '|X[k]|', legend: false });
              const x = C.multisin(N, fs, [{ freq: 300, amp: 1 }]);
              const S = C.mag(C.fft(x));
              const half = S.length / 2;
              p2.add({ x: DSP.util.arange(0, half), y: Array.from(S.slice(0, half)), type: 'stem', color: 0, width: 1.4 }).draw();
              wrap.appendChild(b1.el); wrap.appendChild(b2.el);
              el.appendChild(wrap);
              el.appendChild(DSP.util.h('div.plot-cap', { html: DSP.util.md('同一组采样点，既可以是 700 Hz，也可以是 300 Hz。**就凭离散样本本身，永远无法分辨**——这就是混叠的本质。') }));
            }
          },
          { t: 'callout', kind: 'eng', title: '工程实例：轮子的"倒转"错觉与旋翼桨叶数据', md: '电影里车轮看起来倒转就是时间采样（24 fps）混叠的现实版。水声工程中，螺旋桨轴频与其谐波如果被欠采样，会折到低频形成**假轴频**，导致目标识别把 A 船认成 B 船。这也是为什么采集船噪声{C}时必须先看清楚轴上高阶谐是否被折叠。' }
        ]
      },
      {
        id: 'anti', num: '5', title: '抗混叠滤波器：唯一的正确解法',
        blocks: [
          { t: 'md', md: '既然混叠不可逆（一旦折叠就再也分不开），唯一的办法是**在采样之前把带外能量压到足够低**。这个模拟低通就是抗混叠滤波器（AAF）。' },
          { t: 'flow', items: [
            { t: '传感器', kind: 'io', d: '水听器 / 天线' },
            { t: '前置放大', kind: 'dsp', d: 'LNA，低噪放' },
            { t: '抗混叠滤波', kind: 'dsp', d: '模拟低通，截止 ≈ 0.4 f_s' },
            { t: 'A/D 采样', kind: 'dsp', d: 'f_s' },
            { t: '数字处理', kind: 'out', d: 'FIR / FFT / 检测' }
          ] },
          { t: 'table', cols: ['概念', '含义', '工程取值建议'], rows: [
            ['奈奎斯特频率 $f_N$', '$f_s/2$，DFT 能表示的最高频率', '—'],
            ['过渡带', '从有用带宽 $B$ 到 $f_N$ 之间留给滤波器下降的余量', '取 $(0.5\\sim0.6)f_s$ 为截止，$B\\le 0.4f_s$'],
            ['过采样率', '$f_s / (2B)$', '常取 2.5~4；Σ-Δ ADC 可达 64~256'],
            ['AAF 衰减要求', '带外须压到 ADC 量化噪声以下', '通常 ≥ 60 dB（12 bit 以上时更多）']
          ] },
          { t: 'callout', kind: 'warn', title: '为什么不能"先采了再说"', md: '很多人的想法是：我用很高采样率采下来，再在数字域做滤波降采样。这条路是通的（就是**多速率信号处理**），但它要求原始的模拟前端在很高频率上仍然不失真；如果传感器/放大器在 $f_N$ 以上本来就有强干扰（如电台干扰、电源谐波），它们仍会在第一步就被折进来。**所以物理的抗混叠滤波器永远不可省，只是它的要求可以放宽。**' }
        ]
      },
      {
        id: 'rec', num: '6', title: '重建：从样本回到连续波形',
        blocks: [
          { t: 'md', md: '式 (3) 的 sinc 内插在物理上不可实现（非因果、无限长）。实际 DAC 用**零阶保持（ZOH）**，其频率响应带来一个 sinc 包络：' },
          { t: 'math', tex: 'H_{ZOH}(f) = T_s\\,\\mathrm{sinc}\\!\\left(\\frac{f}{f_s}\\right)e^{-j\\pi f/f_s}', tag: '(5)' },
          { t: 'md', md: '该包络在 $f = 0.5f_s$ 处约 $-3.9$ dB，在 $f_s$ 处为零。后果是：**重建后的信号高频被压低（sin f/f 滚降）**，并且在 $f_s, 2f_s,\\dots$ 附近存在镜像分量。工程对策：' },
          { t: 'md', md: '1. 在 DAC 后加重建（平滑）低通滤波器；\n2. 或者在数字域做**预补偿**（把 $1/H_{ZOH}(f)$ 乘回去），常用于任意波形发生器与声呐发射机；\n3. 或者用高倍过采样使镜像远离有用频带，降低对模拟滤波器的要求。' },
          { t: 'callout', kind: 'eng', title: '发射端的实用做法', md: '现代声呐/雷达发射机普遍采用**过采样 + 数字上变频 + Class-D 功放 + 低阶 LC 滤波**：先把基带信号插值到 8~16 倍，再做 D 类放大。这时 ZOH 的滚降落在远离信号带的高频处，发射波形失真可压到 −50 dBc 以下。' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区专栏：采样这一块的经典踩坑',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① "采样率越高越好"', md: '采样率翻倍意味着数据量、存储、算力、功耗翻倍，而 ADC 的有效位数（ENOB）通常**随采样率下降**。正确做法是按有用带宽加 25%~60% 余量来选。' },
          { t: 'callout', kind: 'pit', title: '② 忘了采样抖动（jitter）', md: '采样时钟的相位噪声 $t_{jit}$ 会把 SNR 上限钉死：$\\mathrm{SNR}_{jit} \\approx -20\\log_{10}(2\\pi f t_{jit})$。欲高质量采样 10 MHz 中频，$t_{jit}$ 需 < 30 ps。**时钟抖动的限制与你用多少位 ADC 无关。**' },
          { t: 'callout', kind: 'pit', title: '③ 用 DFT 频谱直接判断有没有混叠', md: '混叠后的信号看起来"非常干净"——这正是它危险的地方。判断是否混叠要看输入条件（带宽、滤波器指标），而不是看频谱好不好看。' },
          { t: 'callout', kind: 'pit', title: '④ 认为 DFT 是"连续频谱的采样"，所以对任意信号都成立', md: 'DFT 是 DTFT 的等间隔采样，DTFT 存在要求序列绝对可和或能量有限。无限长非衰减序列（功率信号）严格来说没有 DTFT，只能讨论功率谱。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 4 章（Sampling of Continuous-Time Signals）',
      'Shannon, "Communication in the Presence of Noise", Proc. IRE, 1949',
      'Analog Devices, MT-002：采样定理与混叠的工程理解'
    ]
  });

  /* ============================================================
     3. 欠采样与带通采样
     ============================================================ */
  doc.register('theory/basic/bandpass', {
    title: '欠采样与带通采样',
    lede: '如果信号本来就住在高频的一小段带宽里（雷达中频、超声回波、射频接收），你完全可以用远低于最高频率的采样率——只要把思维图景换成"奈奎斯特区"。',
    tags: ['基础', '带通采样', '欠采样', '软件无线电'],
    toc: true,
    labs: [{ path: 'lab/sampling', title: '采样与频率折叠实验台', desc: '切换到带通信号源，观察有意折叠带来的频谱搬移' }],
    sections: [
      {
        id: 'why', num: '1', title: '为什么低通采样定理太保守',
        blocks: [
          { t: 'md', md: '低通采样定理要求 $f_s > 2f_{max}$。对一个带宽只有 $B = 10$ MHz、但载频在 $f_c = 1$ GHz 的雷达中频信号，按低通采样需要 $f_s > 2$ GHz——这在成本上完全不可行。' },
          { t: 'md', md: '但注意：**信息量藏在带宽里，不在载频里**。只要采样保留下来的频谱副本不发生"自我重叠"，10 MHz 带宽的信号理论上只需要 $f_s > 2B = 20$ MHz 的采样率——这就是带通采样（欠采样、谐波采样、IF 采样）。' }
        ]
      },
      {
        id: 'zone', num: '2', title: '奈奎斯特区：把频谱想象成一摞抽屉',
        blocks: [
          { t: 'md', md: '把频率轴按 $f_s/2$ 宽度分成若干"区"：第 1 区 $0\\sim f_s/2$，第 2 区 $f_s/2\\sim f_s$，第 3 区 $f_s\\sim 1.5f_s$，依此类推。采样后**所有内容都被搬到第 1 区**，且：' },
          { t: 'table', cols: ['信号所在区', '搬移后是否翻转', '例子（f_s=100 MHz，信号 60~70 MHz）'], rows: [
            ['奇数区（第 1、3、5…区）', '不翻转', '落在第 2 区 → 翻转，60~70 变成 30~40 MHz'],
            ['偶数区（第 2、4、6…区）', '频谱左右翻转', '上述例子中高端 70 MHz 映射到低端 30 MHz']
          ] },
          { t: 'callout', kind: 'warn', title: '翻转会引起什么后果', md: '如果信号是实带通的正频谱（理想情形），翻转只意味着中心频率变了，解调后注意复原一下即可。但如果频谱本身不对称（比如 chirp 的斜坡方向、单边带调制），**翻转会把斜坡倒过来**，导致后面的脉压/解调出错。做 GPS、雷达中频采样时必须明确写出镜像方程。' }
        ]
      },
      {
        id: 'theo', num: '3', title: '带通采样定理：允许的采样率区间',
        blocks: [
          { t: 'md', md: '设带通信号占据 $[f_L, f_H]$，带宽 $B = f_H - f_L$。可行的无混叠采样率不是单一值，而是一族区间（$n$ 为正整数）：' },
          { t: 'math', tex: '\\frac{2f_H}{n} \\le f_s \\le \\frac{2f_L}{n-1},\\qquad n = 1,2,\\dots,\\left\\lfloor\\frac{f_H}{B}\\right\\rfloor', tag: '(1)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$f_L,\\,f_H$', '带通信号的最低、最高频率'],
            ['$B$', '带宽 $= f_H-f_L$'],
            ['$n$', '谐波序号；$n$ 越大，允许的采样率越低'],
            ['约束', '各区间随 $n$ 增大而变窄，最低可到 $\\approx 2B$（要求 $f_H \\gg B$）']
          ] },
          {
            t: 'fold', summary: '展开：式 (1) 的几何推导', deriv: true, blocks: [
              { t: 'md', md: '要求延拓后的第 $k$ 个副本不与第 0 个重叠。副本整体位移为 $k f_s$（$k\\ne 0$）。最紧的约束来自相邻副本：当下侧副本上移 $kf_s$ 后，其高端 $f_H - kf_s$ 应不超过 $f_L$；上侧副本下移后，其低端 $f_L + kf_s$ 应不低于 $f_H$。把 $k=n$ 与 $k=n-1$ 两种情形分别整理，即得式 (1) 的左右两端。' },
              { t: 'md', md: '直观理解：$n$ 表示我们要让信号在第 $n$ 个奈奎斯特区里"躺"进去，那么必须 $n\\cdot(f_s/2) \\ge f_H$（保证折叠后的频带不越过上界）且 $(n-1)\\cdot(f_s/2) \\le f_L$（下界托住），两式合并正是式 (1)。' }
            ]
          },
          { t: 'callout', kind: 'note', title: '最低可采样率', md: '当 $n = \\lfloor f_H/B\\rfloor$ 取到最大允许值时，$f_s^{min} = 2f_H/n \\to 2B$。**理论上带通采样最低就是 $2B$**，但那要求极其陡峭的模拟带通滤波器、对时钟抖动指标的要求也极高，工程上取 $f_s \\approx (2.5\\sim4)B$。' }
        ]
      },
      {
        id: 'calc', num: '4', title: '手把手算一个例子',
        blocks: [
          { t: 'md', md: '**题目**：某声呐接收机中频 $f_L = 60$ MHz，$f_H = 70$ MHz（$B = 10$ MHz），求可行的采样率区间，并选一个工程可用值。' },
          { t: 'md', md: '**解**：$\\lfloor f_H/B \\rfloor = \\lfloor 70/10\\rfloor = 7$，所以 $n$ 可以取 1~7：' },
          { t: 'table', cols: ['n', '下界 2f_H/n', '上界 2f_L/(n−1)', '可行区间'], rows: [
            ['1', '140 MHz', '∞', 'f_s ≥ 140 MHz（低通采样）'],
            ['2', '70 MHz', '120 MHz', '70 ~ 120 MHz'],
            ['3', '46.7 MHz', '60 MHz', '46.7 ~ 60 MHz'],
            ['4', '35 MHz', '40 MHz', '35 ~ 40 MHz'],
            ['5', '28 MHz', '30 MHz', '28 ~ 30 MHz'],
            ['6', '23.3 MHz', '24 MHz', '23.3 ~ 24 MHz'],
            ['7', '20 MHz', '20 MHz', '= 20 MHz（理论极限，不可实现）']
          ] },
          { t: 'callout', kind: 'eng', title: '工程决策', md: '选 $n=4$、$f_s = 36$ MHz：此时信号在第 4 区（偶数区，频谱翻转），采样后中频落在 $|70 - 2f_s| = 2$ MHz 到 $|60 - 2f_s| = 12$ MHz，即 2~12 MHz 的镜像，**方便后续 NCO 数字下变频**。选 $f_s$ 的另一个技巧：让 $f_c$ 落在 $f_s/4$ 附近，这样数字下变频的正交混频最省资源（可直接用 ±1,0 序列实现）。' }
        ]
      },
      {
        id: 'eng', num: '5', title: '雷达/声呐中的典型应用',
        blocks: [
          { t: 'table', cols: ['场景', '信号特点', '采样方案', '为什么这样做'], rows: [
            ['雷达中频数字化', '60 MHz 中频、10 MHz 带宽', '带通采样 $f_s\\approx 40$ MHz', '省掉模拟下变频，直接进 FPGA 做数字下变频（DDC）'],
            ['软件无线电', '射频直采或高中频', '高速 ADC + 数字下变频', '灵活性：改软件即改变频'],
            ['超声回波采集', '中心 5 MHz、带宽 3 MHz', '$f_s\\approx 20$ MHz 即可', '比按 10 MHz 低通采样省 5 倍数据量'],
            ['水声宽带信号', '10 ~ 40 kHz', '$f_s = 100\\sim200$ kHz', '兼顾进一步分析余量，用较高过采样率']
          ] },
          { t: 'callout', kind: 'warn', title: '带通采样的代价', md: '（1）**AAF 变成带通滤波器**：要求中心频率精确、Q 值高；（2）**采样时钟抖动要求更苛刻**：抖动 SNR 与输入最高频率 $f_H$ 成正比，而 $f_H \\gg f_s$；（3）**ADC 的输入带宽必须覆盖 $f_H$**（而不是 $f_s/2$）——这一条最容易被忽略，很多标称 14 bit @ 100 MSPS 的 ADC 模拟输入带宽只有 200 MHz，采不了 1 GHz 中频。' }
        ]
      },
      {
        id: 'pit', num: '6', title: '误区',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 以为欠采样丢失了信息', md: '只要满足式 (1)，欠采样是**完全可逆**的（频谱位置已知）。它不是近似，是有意的频谱搬移。' },
          { t: 'callout', kind: 'pit', title: '② 忘了频谱可能翻转', md: '偶数区采样后频谱左右颠倒。做 DFS/幅相校正时必须带上 $(-1)^n$ 的符号处理。' },
          { t: 'callout', kind: 'pit', title: '③ 用带通采样处理带外有大干扰的信号', md: '带通采样同样会把**所有**奈奎斯特区的内容折叠下来。如果相邻区有强干扰，它会盖住你的信号。必须先做高质量带通滤波（这就是 SAW/陶瓷滤波器的价值）。' },
          { t: 'callout', kind: 'pit', title: '④ 公式套错区间端点', md: '$n=1$ 时上界为无穷（即低通采样）。写表格时别把 $n-1=0$ 那一格填 0。' }
        ]
      }
    ],
    refs: [
      'Vaughan, Scott & White, "The Theory of Bandpass Sampling", IEEE Trans. Signal Processing, 1991',
      'Analog Devices, MT-017：过采样与带通采样',
      'Richards, Fundamentals of Radar Signal Processing（中频数字化章节）'
    ]
  });

  /* ============================================================
     4. 量化、A/D 与 D/A 转换
     ============================================================ */
  doc.register('theory/basic/quant', {
    title: '量化、A/D 与 D/A 转换',
    lede: '一个 B 位的 ADC 能给出 6.02B + 1.76 dB 的信噪比——这条公式是前端设计最核心的等号，它把位数、动态范围、位数成本直接连在一起。',
    tags: ['基础', 'ADC', 'DAC', '量化', 'ENOB'],
    toc: true,
    sections: [
      {
        id: 'steps', num: '1', title: 'A/D 的三个步骤',
        blocks: [
          { t: 'flow', items: [
            { t: '采样保持', kind: 'dsp', d: '在孔径时间内保持恒定，离散化时间' },
            { t: '量化', kind: 'dsp', d: '把连续幅值映射到有限码字，离散化幅度' },
            { t: '编码', kind: 'out', d: '映射为二进制补码/偏移码输出' }
          ] },
          { t: 'md', md: '采样是可逆的（满足采样定理时）；**量化不可逆**——它引入的量化误差本质上是一次有界非线性，通常建模为加性白噪声。' }
        ]
      },
      {
        id: 'model', num: '2', title: '量化噪声模型与那条著名公式',
        blocks: [
          { t: 'md', md: '设满量程为 $\\pm FSR/2$，量化步长 $\\Delta = FSR/2^B$。舍入量化误差 $e = x_Q - x$ 落在 $[-\\Delta/2, \\Delta/2]$。若误差在该区间均匀分布且与信号无关（重要假设！），则：' },
          { t: 'math', tex: '\\sigma_e^2 = \\int_{-\\Delta/2}^{\\Delta/2} e^2 \\frac{1}{\\Delta}\\,de = \\frac{\\Delta^2}{12}', tag: '(1)' },
          { t: 'md', md: '输入满量程正弦 $x(t) = A\\sin(2\\pi f t)$，$A = FSR/2$，其功率为 $A^2/2 = FSR^2/8 = \\Delta^2 2^{2B}/8$。于是：' },
          { t: 'math', tex: '\\mathrm{SQNR} = 10\\log_{10}\\!\\left(\\frac{\\Delta^2 2^{2B}/8}{\\Delta^2/12}\\right) = 6.02\\,B + 1.76\\ \\mathrm{dB}', tag: '(2)' },
          { t: 'table', cols: ['位数 B', '理论 SQNR', '对应 ENOB 上限', '典型应用'], rows: [
            ['8 bit', '49.9 dB', '≈ 7.5 bit', '早期示波器、廉价采集卡'],
            ['12 bit', '74.0 dB', '≈ 11 bit', '通用 DAQ、超声'],
            ['16 bit', '98.1 dB', '≈ 14 bit', '水声采集、振动测量'],
            ['24 bit', '146.2 dB', '≈ 19 ~ 21 bit', '地震、Σ-Δ 音频']
          ] },
          { t: 'callout', kind: 'note', title: '每多一位 = 6 dB', md: '这是前端设计最容易记的一条：**1 bit ≈ 6 dB 动态范围**。要改善 12 dB 就得花 2 bit 的钱。这也是为什么后面要靠Σ-Δ、靠过采样、靠增益控制（AGC/TVG）而不是一味堆位数。' }
        ]
      },
      {
        id: 'enob', num: '3', title: '现实 ADC：ENOB、SFDR 与那些"看不见的损失"',
        blocks: [
          { t: 'md', md: '数据手册上的 16 bit ADC，实际有效位数往往只有 13~14 bit。差距来自：' },
          { t: 'table', cols: ['劣化来源', '机理', '典型贡献'], rows: [
            ['热噪声与失真', '前端放大器、ADC 内部噪声底', '−1 ~ −2 bit'],
            ['积分非线性 INL / DNL', '量化台阶不等宽', 'SFDR 下降'],
            ['时钟抖动 jitter', '$-20\\log(2\\pi f t_{jit})$', '高频时主导'],
            ['孔径不确定度', '采样保持的采样时刻散布', '与抖动同源'],
            ['电源/参考漂移', '基准不稳导致增益漂移', '低频 1/f 恶化']
          ] },
          { t: 'math', tex: '\\mathrm{ENOB} = \\frac{\\mathrm{SINAD} - 1.76}{6.02},\\qquad \\mathrm{SINAD} = -10\\log_{10}\\!\\left(10^{-\\mathrm{SNR}/10} + 10^{-\\mathrm{THD}/10}\\right)', tag: '(3)' },
          { t: 'callout', kind: 'eng', title: '选型时看什么', md: '不要只看"多少位"，要看 **SNR @ 输入频率**（手册通常画成随 $f_{in}$ 下降的曲线）与 **SFDR**。对雷达/声呐这种关心弱目标的系统，**SFDR 比 SNR 更重要**——两个靠得很近的大谐波会把弱信号完全埋掉。' }
        ]
      },
      {
        id: 'overs', num: '4', title: '过采样处理增益：用速度换精度',
        blocks: [
          { t: 'md', md: '量化噪声的总功率 $\\Delta^2/12$ 固定，均匀铺在 $[0, f_s/2]$ 上。若有用带宽只有 $B \\ll f_s/2$，用数字低通滤除带外噪声后，留在带内的噪声功率按带宽比下降：**过采样率每提高 4 倍（OSR = f_s/2B），SNR 改善 6 dB，等于白捡 1 bit。**' },
          { t: 'math', tex: '\\Delta\\mathrm{SNR} = 10\\log_{10}\\!\\left(\\frac{f_s}{2B}\\right)\\ \\mathrm{dB} \\quad\\Longrightarrow\\quad \\Delta B_{eff} = \\frac{1}{2}\\log_2\\!\\left(\\frac{f_s}{2B}\\right)\\ \\mathrm{bit}', tag: '(4)' },
          { t: 'callout', kind: 'eng', title: 'Σ-Δ ADC 的全部秘密', md: 'Σ-Δ 调制器把量化噪声做**噪声整形**（噪声谱密度随频率平方上升），把绝大部分噪声推到带外，再靠极高的 OSR（64~1024）加数字抽取滤波器滤掉。**用 1 bit 比较器实现了 20+ bit 的分辨率**——这是音频 ADC 与高精度地震/水声采集的主流方案。代价是延迟大、对时钟敏感、不适合多通道同步采样。' },
          { t: 'callout', kind: 'warn', title: 'Σ-Δ 在雷达/水声阵列里的局限', md: 'Σ-Δ 的数字抽取会引入**显著的群延迟**，多通道之间若不同步会直接破坏波束形成的相位关系。现代同步采样 Σ-Δ 阵列通过共享调制时钟与确定性相位抽取来解决，但绝不能默认"各通道独立 Σ-Δ 然后拼起来"。' }
        ]
      },
      {
        id: 'nonuni', num: '5', title: '非均匀量化：$ \\mu $律 / A 律与自动增益控制',
        blocks: [
          { t: 'md', md: '均匀量化的 SQNR 与信号幅度成正比——**小信号吃亏**：幅度只有满量程 1/100 时，SQNR 掉 40 dB。语音与水声回波恰好是小信号多、大信号少的分布，于是有两条路：' },
          { t: 'md', md: '1. **非均匀量化**：先对信号做对数压扩（$ \\mu $律：北美/日本；A 律：欧洲/中国），再均匀量化。效果是等效步长随幅度自适应，小信号 SNR 大幅提升。\n2. **自动增益控制（AGC / TVG）**：水声里TVG（Time Varied Gain）按传播损失随时间增大增益，使远近回波都落在 ADC 满量程的合适位置。这是**所有增益控制手段里最有效的**，因为它不损失任何信息。' },
          { t: 'callout', kind: 'eng', title: '声呐接收机的增益链', md: '典型链路：水听器 → 前置放大（固定增益） → TVG/AGC → 抗混叠滤波 → 16~24 bit ADC。核心原则是：**让 ADC 的输入在你的处理窗口内被充分利用，但绝不允许削波（clipping）**。削波产生宽带谐波，会把弱目标彻底毁掉，且不可逆。' }
        ]
      },
      {
        id: 'dac', num: '6', title: 'D/A：零阶保持、镜像与重建',
        blocks: [
          { t: 'math', tex: 'H_{ZOH}(f) = T_s\\,\\mathrm{sinc}(f/f_s)\\,e^{-j\\pi f/f_s}', tag: '(5)' },
          { t: 'md', md: 'DAC 输出是一串台阶。频域后果有两条：**(a) sin x / x 滚降**（$f=f_s/2$ 处 −3.9 dB），**(b) 在 $kf_s$ 附近的镜像**（$k=1,2,\\dots$）。工程对策：' },
          { t: 'md', md: '- DAC 后接**重建低通**（平滑滤波），截止略低于 $f_s/2$；\n- 或提高 DAC 更新率（内插），使镜像远离有用带，滤波器阶数大幅下降；\n- 或在数字域做 sinc 补偿 FIR，把 $1/\\mathrm{sinc}(f/f_s)$ 的特性预先抬回来（任意波形发生器的标准做法）。' },
          { t: 'callout', kind: 'pit', title: '误区：以为 DAC 输出自带"正确的波形"', md: '不加重建滤波的 DAC 输出频谱有大量高频镜像。做水声换能器激励时，这些镜像落在换能器谐振点附近的能量会激发寄生的振动模式，导致发射声源级下降、波形失真。' }
        ]
      },
      {
        id: 'dither', num: '7', title: '抖动（Dither）：故意加噪声反而更好',
        blocks: [
          { t: 'md', md: '当信号接近一个 LSB 时，量化误差与信号强相关，表现为谐波失真而非噪声。加入少量白噪声（典型 1/2 ~ 1 LSB RMS）可以把误差"打散"成随机噪声，**牺牲一点点噪声底，换来失真完全消失**。' },
          { t: 'callout', kind: 'tip', title: '什么时候用', md: '音频母版处理（16 bit 保留 20 bit 听感）、相干平均的振动测量、需要微弱谱线检测的水声被动测听。**代价是噪声底抬高 1~3 dB，收益是杂散消失**——在需要看极低电平谱线的场合（线谱提取），这一步几乎是必须的。' }
        ]
      }
    ],
    refs: [
      'Bennett, "Spectra of Quantized Signals", BSTJ, 1948',
      'Analog Devices, MT-001：揭开 SINAD / ENOB / SFDR 的面纱',
      'Norsworthy, Schreier & Temes, Delta-Sigma Data Converters'
    ]
  });

  /* ============================================================
     5. 信噪比与动态范围
     ============================================================ */
  doc.register('theory/basic/snr', {
    title: '信噪比与动态范围',
    lede: 'SNR 是整个探测系统的"货币"：雷达方程和声呐方程的形式几乎一模一样，因为它们在算同一件事——我的信号比背景噪声强多少 dB。',
    tags: ['基础', 'SNR', '动态范围', '声呐方程', '雷达方程'],
    toc: true,
    sections: [
      {
        id: 'def', num: '1', title: 'SNR 的几种口径，别混着用',
        blocks: [
          { t: 'math', tex: '\\mathrm{SNR} = 10\\log_{10}\\frac{P_s}{P_n} = 10\\log_{10}\\frac{\\sum |s[n]|^2}{\\sum |w[n]|^2}\\ \\mathrm{dB}', tag: '(1)' },
          { t: 'table', cols: ['口径', '定义域', '什么时候用'], rows: [
            ['时域 SNR', '整段数据的信号功率 / 噪声功率', '加噪仿真、给定 SNR 造数据'],
            ['频域 SNR（处理前）', '整带宽内的噪声总功率', '最保守，通常最低'],
            ['处理后 SNR', '脉压/FFT/积累之后，带宽已变窄', '评价算法增益的本质指标'],
            ['单频 SNR（detectability）', '谱线功率 / 该频率附近噪声谱密度', '线谱检测、CW 检测的标准口径']
          ] },
          { t: 'callout', kind: 'pit', title: '最常见的坑：不同口径直接比大小', md: '同一段数据，"匹配滤波前的 SNR"可能是 −10 dB，"脉压后的 SNR"是 +23 dB，两者差的就是处理增益 $10\\log_{10}(BT)$。**写报告时必须注明是哪一个 SNR、带宽是多少、有没有经过积累**，否则数字毫无意义。这与「功率谱 vs 功率谱密度」是同一类错误。' }
        ]
      },
      {
        id: 'noise', num: '2', title: '噪声从哪里来：$kTB$ 与 $-174$ dBm/Hz',
        blocks: [
          { t: 'math', tex: 'P_n = kTB = k T_0 B F, \\qquad kT_0 = 4.00\\times10^{-21}\\,\\mathrm{W/Hz} \\;(\\approx -174\\ \\mathrm{dBm/Hz})', tag: '(2)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$k$', '玻尔兹曼常数 $1.38\\times10^{-23}$ J/K'],
            ['$T_0$', '参考温度 290 K'],
            ['$B$', '噪声带宽（Hz）'],
            ['$F$', '噪声系数（线性值，非 dB），LNA 之后的总噪声系数']
          ] },
          { t: 'callout', kind: 'eng', title: '雷达/无线电：噪声是个"常数背景"', md: '接收机热噪声是可以算死的：$10\\,\\text{MHz}$ 带宽、噪声系数 3 dB 的输入噪声功率约 $-174 + 70 + 3 = -101$ dBm。知道这个数，就能反推"要检测 −110 dBm 的目标，还需要多少 dB 处理增益"。' },
          { t: 'md', md: '水声则完全不同：环境噪声主导，且随频率与海况剧烈变化。常用 Wenz 曲线描述，$N_L$ 在 10 Hz 处可达 100 dB，而 100 kHz 处可低至 20 dB。**水声设计师的第一件事是画噪声谱级曲线，而不是挑 ADC。**' }
        ]
      },
      {
        id: 'sonar', num: '3', title: '声呐方程：水下版本的 SNR 会计学',
        blocks: [
          { t: 'math', tex: '\\mathrm{SE} = SL - TL - (NL - DI) \\quad \\ge \\quad DT', tag: '(3)' },
          { t: 'kv', title: '参量说明（主动声呐，单位 dB re 1 µPa）', pairs: [
            ['$SL$', '声源级：发射器轴向 1 m 处的声压级(发射端)'],
            ['$TL$', '传播损失：$TL = 20\\log_{10} r + \\alpha r$（球面扩展 + 吸收，$\\alpha$ 单位 dB/km）'],
            ['$TS$', '目标强度（目标反向散射能力），回波方程中要减两次 TL'],
            ['$NL$', '环境噪声谱级'],
            ['$DI$', '接收指向性指数（阵列孔径带来的白噪声抑制）'],
            ['$DT$', '检测门限：$DT = 5\\log_{10}(d) + 5\\log_{10}(BT) - 5\\log_{10}(n)$ 等 ROC 决定']
          ] },
          { t: 'callout', kind: 'note', title: '主动声呐的完整式', md: '回波级 $EL = SL - 2TL + TS$，检测条件 $(SL - 2TL + TS) - (NL - DI) \\ge DT$。**注意 TL 出现两次**（去程 + 回程），所以主动声呐的作用距离远不如被动：距离每翻倍损失 12 dB 而非 6 dB。' },
          {
            t: 'fold', summary: '展开：吸收系数为什么让高频探测距离急剧下降', deriv: false, md: '海水吸收系数 $\\alpha$（dB/km）近似与 $f^2$ 成正比（Thorp 公式）。在 10 kHz 时约 1 dB/km，100 kHz 时约 30 dB/km。**这就是"低频远程、高频高分辨"的根本权衡**：想要 10 cm 级分辨（≈ 150 kHz），作用距离只能在几百米量级；想要几十公里，只能用几百赫兹的低频。所有的多波束/侧扫/探潜声呐选型，本质上都在这一条曲线上找位置。' }
        ]
      },
      {
        id: 'radar', num: '4', title: '雷达方程：同一个故事，换成电磁波',
        blocks: [
          { t: 'math', tex: '\\mathrm{SNR} = \\frac{P_t G^2 \\lambda^2 \\sigma}{(4\\pi)^3 k T_0 B F\\, R^4\\, L}', tag: '(4)' },
          { t: 'kv', title: '参量说明', pairs: [
            ['$P_t$', '发射峰值功率'],
            ['$G$', '天线增益（收发共用时平方）'],
            ['$\\lambda$', '波长'],
            ['$\\sigma$', '目标雷达截面积 RCS（m²）'],
            ['$R$', '目标距离（**四次方！**）'],
            ['$B$', '噪声带宽'],
            ['$L$', '系统损耗']
          ] },
          { t: 'callout', kind: 'warn', title: '$R^4$ 意味着什么', md: '距离翻倍 SNR 掉 12 dB。要挽回这 12 dB，要么 16 倍功率（不现实），要么靠**处理增益**：脉冲压缩给 $10\\log(BT)$（很容易就有 30 dB），$N$ 脉冲相参积累再给 $10\\log N$。**这就是为什么现代雷达一定要用大时宽带宽积波形 + 相参积累的原因——它是唯一的免费午餐。**' }
        ]
      },
      {
        id: 'pg', num: '5', title: '处理增益：把 SNR 从负的捞回正的',
        blocks: [
          { t: 'table', cols: ['处理手段', '处理增益', '物理含义'], rows: [
            ['匹配滤波（脉冲压缩）', '$10\\log_{10}(B\\tau)$', '把宽脉冲能量压缩到窄峰值，$B\\tau$ 为时宽带宽积'],
            ['相参积累（$N$ 脉冲）', '$10\\log_{10} N$', '信号幅度线性相加、噪声功率相加'],
            ['非相参积累', '约 $10\\log_{10}\\sqrt{N}$ 到 $10\\log_{10}N$ 之间', '损失来自检波后的平方损失'],
            ['FFT（窄带滤波）', '$10\\log_{10} N$（$N$ 点）', '把噪声挤进更窄的分辨率单元'],
            ['Welch 平均（$K$ 段）', '方差降低约 $1/K$（不提升均值 SNR）', '提升**检测稳定性**而非 SNR']
          ] },
          { t: 'callout', kind: 'tip', title: '一句话理解相参 vs 非相参', md: '**相参**：相位知道，直接矢量相加，幅度 $\\times N$，功率 $\\times N^2$，而噪声功率 $\\times N$，于是 SNR $\\times N$。\n**非相参**：先把每脉冲取包络（相位丢了），再能量相加，信噪比增益明显打折。多普勒徙出相干积累区间，经相位校正后才能做相参积累，这是 MTD 的核心。' }
        ]
      },
      {
        id: 'dr', num: '6', title: '动态范围：系统能同时看多大和多小',
        blocks: [
          { t: 'math', tex: '\\mathrm{DR} = 20\\log_{10}\\frac{x_{max}}{x_{min}} = P_{FS} - P_{noise\\_floor}', tag: '(5)' },
          { t: 'md', md: '限制动态范围的有三堵墙：**上墙**是 ADC 满量程/削波；**下墙**是噪声底（ADC 噪声、前端噪声、环境噪声）；还有一个容易被忽略的——**中间墙**：大信号的谐波失真（SFDR）会把弱信号污染。' },
          { t: 'callout', kind: 'eng', title: '现实的旁瓣问题', md: '在被动检测中同时存在一艘万吨轮（$SL$ 很高）与远处小艇时，即使 ADC 有 96 dB 动态范围，**FFT 的矩形窗旁瓣只有 −13 dB**——强目标的泄漏会把弱目标完全盖住。这就是为什么加窗（汉明 −41 dB、布莱克曼哈里斯 −92 dB）不是"美化"，而是**动态范围的刚需**。这一条直接连到「窗函数」一章。' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 把 SNR 和 CNR（杂噪比）混为一谈', md: '在混响背景（浅海主动声呐）或地杂波背景（雷达 MTI）中，限制检测的往往不是噪声而是杂波。此时该算 **SIR / CNR**，改善手段是空时处理与改善因子 $I$，而不是堆功率。' },
          { t: 'callout', kind: 'pit', title: '② 认为处理增益没有代价', md: '脉压有距离旁瓣（PSL），积累有多普勒徙动与盲速，加窗有主瓣展宽。**每一项增益都在别处付费**，工程的艺术在于权衡。' },
          { t: 'callout', kind: 'pit', title: '③ 忽略宽带信号的"SNR 依赖带宽"', md: '说"SNR = 10 dB"而不说带宽，等于没说。同样的数据用 100 Hz 分辨率看和用 10 kHz 分辨率看，SNR 差 20 dB。**写 spec 时请一律写成 SNR @ 带宽 X Hz。**' }
        ]
      }
    ],
    refs: [
      'Urick, Principles of Underwater Sound, 第 5–8 章（声呐方程与 Wenz 噪声曲线）',
      'Barton, Radar System Analysis and Modeling',
      'Skolnik, Radar Handbook, 第 2 章（雷达方程与检测）'
    ]
  });

  /* ============================================================
     6. 窗函数基础
     ============================================================ */
  doc.register('theory/basic/window', {
    title: '窗函数基础',
    lede: '只要你做 FFT，就必然已经用了窗——默认那一款叫矩形窗，它的旁瓣只有 −13 dB。加窗不是为了好看，是为了不丢弱目标、不让强谱泄漏糊掉整张谱。',
    tags: ['基础', '窗函数', '频谱泄漏', '主瓣', '旁瓣'],
    toc: true,
    labs: [{ path: 'lab/window', title: '窗函数横向对比实验台', desc: '8 种窗的频谱、主瓣宽度、旁瓣电平、处理损失一次看清楚' }],
    sections: [
      {
        id: 'why', num: '1', title: '为什么"什么都不做"也是在加窗',
        blocks: [
          { t: 'md', md: 'DFT 只能处理有限长序列。从无限长（或很长）的信号里截一段出来，等价于把信号乘以一个只在 $0\\le n<N$ 非零的矩形序列：**矩形窗**。' },
          { t: 'math', tex: 'x_w[n] = x[n]\\cdot w[n],\\quad 0\\le n<N \\quad\\Longleftrightarrow\\quad X_w(e^{j\\omega}) = \\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi} X(e^{j\\theta})\\,W(e^{j(\\omega-\\theta)})\\,d\\theta', tag: '(1)' },
          { t: 'callout', kind: 'note', title: '核心图景', md: '**时域相乘 = 频域卷积**。每段谱线被换成了窗的频谱形状：一根理想 $\\delta$ 线频谱，被摊成窗函数的主瓣+旁瓣。这就是"频谱泄漏"的全部来源——**泄漏不是 FFT 的 bug，是截断的必然结果。**' }
        ]
      },
      {
        id: 'trade', num: '2', title: '永远的权衡：主瓣宽度 vs 旁瓣电平',
        blocks: [
          { t: 'md', md: '窗的设计只有一个自由度:让旁瓣低，主瓣就宽（频率分辨率变差）；让主瓣窄，旁瓣就高（弱信号被掩盖）。这条权衡来自不确定性原理，没有例外。' },
          {
            t: 'widget', render: function (el) {
              const wins = [
                { k: 'rect', c: 0 }, { k: 'bartlett', c: 1 }, { k: 'hann', c: 2 },
                { k: 'hamming', c: 3 }, { k: 'blackman', c: 4 }
              ];
              const wrap = DSP.util.h('div.grid.g2');
              // 时域形状
              const b1 = DSP.ui.plotBox({ title: '窗函数的时域形状（N=128）' });
              const p1 = DSP.plot.new(b1.canvas, { height: 210, xlabel: 'n', ylabel: 'w[n]', legend: true });
              wins.forEach(w => {
                const arr = C.window(w.k, 128);
                p1.add({ x: DSP.util.arange(0, 128), y: Array.from(arr), color: w.c, width: 1.4, label: C.WINDOWS[w.k].name });
              });
              p1.draw();
              // 频域（dB）
              const b2 = DSP.ui.plotBox({ title: '对应的频谱（归一化 dB，注意旁瓣差异）' });
              const p2 = DSP.plot.new(b2.canvas, { height: 210, xlabel: '频率 / bin', ylabel: 'dB', legend: true, ylim: [-120, 5] });
              wins.forEach(w => {
                const m = C.windowMetrics(w.k);
                const arr = C.window(w.k, 512);
                const F = C.fft(arr, 4096);
                const mg = C.mag(F);
                let mx = 0; for (let i = 0; i < mg.length; i++) mx = Math.max(mx, mg[i]);
                const half = 4096 / 2;
                const xAxis = DSP.util.arange(0, half).map(i => i / (4096 / 512));
                const ydB = Array.from(mg.slice(0, half)).map(v => 20 * Math.log10(Math.max(v, 1e-12) / mx));
                p2.add({ x: xAxis, y: ydB, color: w.c, width: 1.2, label: C.WINDOWS[w.k].name + '（旁瓣 ' + m.sll.toFixed(0) + ' dB）' });
              });
              p2.hline(-13, { dash: [4, 3], label: '-13 dB 矩形旁瓣' });
              p2.draw();
              wrap.appendChild(b1.el); wrap.appendChild(b2.el);
              el.appendChild(wrap);
            }
          },
          { t: 'callout', kind: 'eng', title: '工程上的决策规则', md: '- **要分辨两个靠得很近的等强频率** → 选主瓣窄的窗（矩形、汉宁）\n- **要在强信号旁边看弱信号（动态范围优先）** → 选低旁瓣窗（布莱克曼、BH）\n- **不知道选什么** → 汉宁（ Hann）是稳健默认；**汉明（Hamming）** 在需要更好旁瓣且不需极致 near-in时才用\n- **绝对不知道** → 先用汉宁看谱，再换窗验证结论是否稳定' }
        ]
      },
      {
        id: 'metrics', num: '3', title: '五个必须认识的窗指标',
        blocks: [
          { t: 'table', cols: ['指标', '英文', '含义', '工程影响'], rows: [
            ['主瓣宽度', 'Main-lobe width', '峰值到第一零点的双边宽度（单位：bin）', '决定能否分辨两根邻近谱线；$\\Delta f = \\text{主瓣宽}\\times f_s/N$'],
            ['最高旁瓣电平', 'SLL / PSLL', '相对主瓣峰值的最高旁瓣（dB）', '决定能看到多弱的邻近信号'],
            ['旁瓣衰减速率', 'Rolloff', '旁瓣随频率下降的 dB/octave', '远离主瓣处的干扰抑制能力'],
            ['等效噪声带宽', 'ENBW', '白噪声下的等效积分带宽（bin）', '直接等于**处理损失**：汉宁 1.5 bin = 1.76 dB 损失'],
            ['扇形损失', 'Scalloping loss', '信号不在 FFT 频点时幅度的最大偏差', '矩形窗可达 1.42 dB（36%），加窗后仅 0.1~0.8 dB']
          ] },
          { t: 'callout', kind: 'tip', title: '处理损失必须补偿', md: 'ENBW > 1 意味着加窗把噪声能量多算了，功率读数会偏大。做**绝对电平标定**（如在监测接收机、噪声测量中）时，必须用 $10\\log_{10}(\\mathrm{ENBW})$ 修正，否则不同窗的结果对不上。' },
          {
            t: 'widget', render: function (el) {
              const list = ['rect', 'bartlett', 'hann', 'hamming', 'blackman'];
              const rows = list.map(k => {
                const m = C.windowMetrics(k);
                return [C.WINDOWS[k].name, m.mainLobe.toFixed(2), m.sll.toFixed(1), (20 * Math.log10(m.cg)).toFixed(2), m.enbw.toFixed(3), (10 * Math.log10(m.enbw)).toFixed(2)];
              });
              const tbl = DSP.ui.table({
                cols: ['窗', '主瓣宽 (bin)', '最高旁瓣 (dB)', '相干增益 (dB)', 'ENBW (bin)', '处理损失 (dB)'],
                rows: rows
              });
              el.appendChild(tbl);
              el.appendChild(DSP.util.h('div.plot-cap', { html: DSP.util.md('数值由本软件核心库实时计算（$N=512$ 点窗、4096 点补零 FFT），可在「窗函数对比实验台」中自行调节验证。') }));
            }
          }
        ]
      },
      {
        id: 'recipe', num: '4', title: '常见窗速查与选型建议',
        blocks: [
          { t: 'table', cols: ['窗', '主瓣', '旁瓣', '适合', '不适合'], rows: [
            ['矩形 Rect', '2 bin（最窄）', '−13 dB', '瞬态测量、分辨率极限、校准', '有强有弱的多分量信号'],
            ['汉宁 Hann', '4 bin', '−32 dB', '通用默认，谱估计（Welch）', '需要精确幅值且要求窄主瓣'],
            ['汉明 Hamming', '4 bin', '−41 dB', '语音/一般频谱分析', '要求旁瓣低于−50 dB 的场合'],
            ['布莱克曼 Blackman', '6 bin', '−58 dB', '高动态范围、谐波分析', '邻近频率分辨'],
            ['BH（4 项）', '8 bin', '≈ −92 dB', '极高精度谱线搜索、THD 测量', '分辨两个邻近等幅谱线'],
            ['凯泽 Kaiser', '可调 $\\beta$', '可调', '需要按 $\\beta$ 连续权衡', '需要固定窗参数的场合']
          ] },
          { t: 'kv', title: '凯泽窗经验公式（已知要求旁瓣电平 $A$ dB）', pairs: [
            ['$\\beta$', '$A>50$: $\\beta = 0.1102(A-8.7)$；$21\\le A\\le50$: $\\beta=0.5842(A-21)^{0.4}+0.07886(A-21)$；$A<21$: $\\beta=0$'],
            ['$N$', '由过渡带宽度 $\\Delta\\omega$ 决定：$N \\approx \\dfrac{A-8}{2.285\\,\\Delta\\omega}$（FIR 设计时同样适用）']
          ] }
        ]
      },
      {
        id: 'zero', num: '5', title: '补零不等于提高分辨率',
        blocks: [
          { t: 'callout', kind: 'pit', title: '头号误区', md: '在序列后面补一串零再做更长的 FFT，只会让谱曲线**画得更密**（频域内插），**不会提高真正的频率分辨能力**。真正的分辨率由有效数据长度决定：$\\Delta f \\approx f_s/N_{有效}$，是由窗的主瓣宽度定的。补零的唯一好处是找到更精确的峰值位置（减小栅栏效应的视觉误差）。' },
          { t: 'md', md: '要真正提高分辨率，本质上只有两条路：加长实际观测时间、增加采样点数。' }
        ]
      },
      {
        id: 'app', num: '6', title: '窗的另外三个用途',
        blocks: [
          { t: 'md', md: '1. **FIR 滤波器设计**：把理想低通的无限长 $h_d[n]$ 用窗截断，窗决定过渡带宽度与阻带衰减（见「窗函数法设计 FIR」）。\n2. **STFT 短时分析**：每一帧都要加窗，窗长就是时间和频率分辨率的权衡旋钮（见「STFT」）。\n3. **脉冲压缩中的加权**：对匹配滤波参考函数加窗压旁瓣，代价是主瓣展宽 + SNR 损失（典型的 −2 至 −3 dB）。声呐/雷达的 LFM 脉压几乎都要这么做。' }
        ]
      }
    ],
    refs: [
      'Harris, "On the Use of Windows for Harmonic Analysis with the DFT", Proc. IEEE, 1978（窗函数的圣经）',
      'Oppenheim & Schafer, DTSP, 第 7 章（窗与 FIR 设计）',
      'Heinzel, Rüdiger & Schilling, "Spectrum and spectral density estimation by the DFT"'
    ]
  });

})(window);

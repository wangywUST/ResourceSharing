/* =============================================================
   theory-transform.js —— 知识理论库 · 二、核心变换（9 页）
   路由：theory/transform/*

   主线：Z 变换 ──(z = e^{jω}, 单位圆)──> DTFT ──(ω 轴 N 点等间隔采样)──> DFT
        DFT ──(旋转因子对称性与周期性)──> FFT（同一结果的快速算法）
        DFT ──(加窗分段、补回时间轴)──> STFT ──(尺度自适应)──> 小波
        单边谱操作 ──> 希尔伯特/解析信号
        时频平面旋转 ──> 分数阶傅里叶变换 FRFT
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const doc = DSP.doc;
  const C = DSP.core;
  const U = DSP.util;

  /* ============================================================
     内部小工具（本项目通用数值辅助，核心库未提供的部分）
     ============================================================ */

  /** 幅度数组转归一化 dB（相对最大值，下限 −120 dB） */
  function dBnorm(arr, floorDb) {
    const n = arr.length, out = new Float64Array(n);
    let mx = 0;
    for (let i = 0; i < n; i++) if (arr[i] > mx) mx = arr[i];
    const fl = floorDb === undefined ? -120 : floorDb;
    for (let i = 0; i < n; i++) {
      out[i] = Math.max(fl, 20 * Math.log10(Math.max(arr[i], 1e-20) / Math.max(mx, 1e-20)));
    }
    return out;
  }

  /** 最大值所在下标 */
  function imax(a) {
    let mi = 0, mv = -Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] > mv) { mv = a[i]; mi = i; }
    return mi;
  }

  /** 复数幅度数组的幅值平方包络（用于 FRFT 能量图） */
  function magSq(re, im) {
    const n = re.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = re[i] * re[i] + im[i] * im[i];
    return out;
  }

  /* ============================================================
     1. 变换家族总览与选型
     ============================================================= */
  doc.register('theory/transform/overview', {
    title: '变换家族总览与选型',
    lede: 'DTFT、DFT、FFT、STFT、小波、Z 变换、希尔伯特、FRFT 不是八个并列的工具，而是一条主线上的八个位置。搞清楚谁是谁的特例、谁是谁的快速算法，选型就不会错。',
    tags: ['核心变换', '总览', '选型'],
    toc: true,
    labs: [{ path: 'lab/dft', title: 'DFT / FFT 交互实验台', desc: '亲手拖动点数与补零长度，验证「FFT 不改变结果、补零不提高分辨率」这两条结论' }],
    sections: [
      {
        id: 'chain', num: '1', title: '一条主线：它们不是并列关系',
        blocks: [
          { t: 'md', md: '翻开教材目录，傅里叶变换家族通常被并列列出，初学者很容易以为它们是八个平级的工具，于是硬背公式、乱选工具。事实恰恰相反：它们是同一棵树上的不同枝丫，彼此之间是层层收缩或层层推广的关系。把这条主线捋顺，本模块后面八节的内容就自动归位了。' },
          { t: 'math', tex: '\\underbrace{X(z)=\\sum_{n=-\\infty}^{\\infty}x[n]z^{-n}}_{\\text{Z 变换（母概念）}}\\;\\xrightarrow[\\text{ROC 含单位圆}]{z=e^{j\\omega}}\\;\\underbrace{X(e^{j\\omega})=\\sum_{n=-\\infty}^{\\infty}x[n]e^{-j\\omega n}}_{\\text{DTFT}}\\;\\xrightarrow{\\omega_k=\\frac{2\\pi k}{N}}\\;\\underbrace{X[k]=\\sum_{n=0}^{N-1}x[n]e^{-j\\frac{2\\pi kn}{N}}}_{\\text{DFT}}\\;\\xrightarrow{\\text{同一结果，换个算法}}\\;\\text{FFT}', tag: '(1)' },
          { t: 'callout', kind: 'note', title: '一句话记住这条链', md: '- **Z 变换**是母概念，定义在 z 平面的一片区域（ROC）上；\n- 把 **z 限制到单位圆** $z=e^{j\\omega}$，就得到 **DTFT**（要求单位圆落在 ROC 内）；\n- 把 DTFT 的连续频率轴 **等间隔采样 N 点**，就得到 **DFT**（代价：时域被迫周期化）；\n- **FFT 不是新变换**，它只是算 DFT 的一种高效算法，输入输出与 DFT 逐位相同（差别仅在于浮点舍入顺序不同）。' },
          { t: 'md', md: '剩下的几个变换则不在这条"Z→DTFT→DFT"的收缩链上，而是针对不同信号类型做的加法：' },
          { t: 'md', md: '1. **STFT**：DFT 把整段信号揉成一个频谱，时间信息全丢了。给信号加滑动窗、逐帧做 DFT，就把时间轴补了回来，代价是时间分辨率与频率分辨率此消彼长。\n2. **小波**：STFT 的窗宽是固定的。小波把窗换成可伸缩平移的基，高频自动用窄窗、低频自动用宽窗，于是瞬态也能看清。\n3. **希尔伯特变换**：在频域做一次符号函数操作，把双边谱压成单边谱，从而构造解析信号，定义瞬时幅度与瞬时频率。它不是"换一个域去看"，而是给信号配一个正交伙伴。\n4. **FRFT**：把时频平面整体旋转任意角度 $\\alpha$，傅里叶变换只是旋转 $90^\\circ$ 的特例。它对 chirp（线性调频）信号有奇效，因为 chirp 在某个特定角度上会聚焦成一个尖峰。' },
          {
            t: 'fold', summary: '展开：为什么 DTFT 是 Z 变换在单位圆上的取值', deriv: true, blocks: [
              { t: 'md', md: '**第一步**：写出双边 Z 变换的定义 $X(z)=\\sum_{n=-\\infty}^{\\infty}x[n]z^{-n}$，它是一个关于复变量 $z$ 的洛朗级数，只有在环形收敛域（ROC）$R_-<|z|<R_+$ 内才收敛。' },
              { t: 'md', md: '**第二步**：令 $z = re^{j\\omega}$，则 $X(re^{j\\omega})=\\sum_n x[n]r^{-n}e^{-j\\omega n}=\\sum_n \\big(x[n]r^{-n}\\big)e^{-j\\omega n}$。这一步说明：**在半径为 $r$ 的圆上取值，等价于对"被 $r^{-n}$ 加权后的序列"做离散时间傅里叶变换。**' },
              { t: 'md', md: '**第三步**：取 $r=1$，加权退化为单位加权，于是 $X(e^{j\\omega})=\\sum_n x[n]e^{-j\\omega n}$，正是 DTFT 的定义式。' },
              { t: 'callout', kind: 'warn', title: '但这个替换是有条件的', md: '只有当 **ROC 包含单位圆**时，$r=1$ 才落在收敛域内，DTFT 才存在。反例：$x[n]=2^n u[n]$ 的 Z 变换为 $X(z)=1/(1-2z^{-1})$，ROC 为 $|z|>2$，单位圆不在 ROC 内，所以它的 DTFT 不存在——这个序列既不绝对可和也不平方可和。**"先看 ROC，再谈 DTFT"是 Z 变换最重要的思维习惯**，详见「Z 变换」一节。' }
            ]
          }
        ]
      },
      {
        id: 'table', num: '2', title: '八种变换横向对比：一张表看完',
        blocks: [
          { t: 'md', md: '下表按「输入 → 输出域 / 解决什么问题 / 适用信号 / 计算量 / 雷达水声中的典型用法」五个维度横比。建议你把它当成查表工具：拿到一段数据，先在"适用信号"一列找自己的信号类型。' },
          {
            t: 'table', cols: ['变换', '输入 → 输出', '它到底解决什么问题', '适用信号', '计算量', '雷达 / 水声典型用法'], rows: [
              ['Z 变换', '序列 → z 平面有理分式', '把差分方程变成代数方程；用零极点和 ROC 刻画因果性、稳定性', '线性时不变系统的分析与设计', '解析推导，不参与实时计算', 'IIR 滤波器设计、系统稳定性判定、零极点校正'],
              ['DTFT', '无限长序列 → 连续周期谱 X(e^jω)', '给序列一个严格的频谱定义（理论基准）', '能量有限或绝对可和的序列', '无穷求和，不可直接计算', '作为所有数字频谱的"真值参照"，推导窗与泄漏'],
              ['DFT', 'N 点序列 → N 点离散谱', '把 DTFT 变成有限、可存储、可计算的 N 个数', '有限长、且允许按周期延拓理解的数据', 'O(N²) 直接算', '多普勒滤波、波束形成、频谱监视的理论模型'],
              ['FFT', '同 DFT，输入输出结果一致', '把 O(N²) 降到 O(N·log₂N)，使实时处理成为可能', '与 DFT 完全相同', 'O(N·log₂N)', '脉压、FFT 波束形成、MTD 滤波器的实时实现核心'],
              ['STFT', '长序列 → 时间 × 频率二维谱图', '给频谱补回时间轴，看清频率随时间怎么变', '非平稳但变化不太剧烈的信号', '每帧一次 FFT', 'LOFAR 谱图、螺旋桨调制谱、微多普勒'],
              ['小波 DWT/CWT', '长序列 → 尺度 × 平移二维系数', '分辨率随频率自适应：高频时间细、低频频率细', '含瞬态、奇异性、自相似结构的信号', 'DWT 与 FFT 同阶甚至更低 O(N)', '瞬态检测、机械故障诊断、图像与测深数据去噪'],
              ['希尔伯特 / 解析信号', '实序列 → 复解析信号 z[n]', '定义瞬时幅度、瞬时相位、瞬时频率', '窄带单分量信号', '一次 FFT + 一次 IFFT', '包络检波、LFM 瞬时频率估计、单边带调制'],
              ['FRFT', '序列 → 任意角度 α 的分数阶域', '把时频平面旋转到 chirp 恰好聚焦的角度', '线性调频（LFM / chirp）类信号', '一次 O(N·log₂N)（Ozaktas 型）', 'LFM 参数估计、扫频干扰抑制、多分量 chirp 分离']
            ]
          },
          { t: 'callout', kind: 'tip', title: '读表的正确姿势', md: '不要按"哪个更高级"来选，按信号的时间结构来选。信号在时间轴上有平稳、慢变、突变、线性扫频四种典型形态，每种形态对应最合适的一列。选错变换的典型后果不是算错，而是信息被摊平后在图上根本看不出来。' }
        ]
      },
      {
        id: 'tree', num: '3', title: '选型决策树：四个问题锁定工具',
        blocks: [
          { t: 'md', md: '面对一段新到的采样数据，按顺序问自己四个问题，答案会直接指向正确的那一列。' },
          {
            t: 'widget', render: function (el) {
              const rows = [
                { q: '问题一', t: '信号在时间上是平稳的吗？', y: '整段统计特性不变 → 直接 FFT / 功率谱（Welch）', n: '统计特性随时间变 → 进入问题二' },
                { q: '问题二', t: '你更需要知道"什么时候发生"还是"频率成分是什么"？', y: '两者都要，且细节尺度接近 → STFT（固定窗，时间分辨率=窗长）', n: '细节跨越多个尺度（既有长慢波又有极短瞬态）→ 用小波' },
                { q: '问题三', t: '是明显的扫频 / chirp 结构吗？', y: '是 → FRFT 在最优阶次上会聚焦成尖峰，分辨率与抗噪性能远超 STFT', n: '否 → 进入问题四' },
                { q: '问题四', t: '你需要瞬时幅度 / 瞬时频率吗？', y: '是，且信号窄带单分量 → 希尔伯特变换构造解析信号', n: '否 → 回到 FFT + 加窗的经典方案即可' }
              ];
              rows.forEach((r, i) => {
                el.appendChild(U.h('div.callout.' + (i % 2 ? 'eng' : 'note'), {}, [
                  U.h('div.co-t', { text: r.q + '：' + r.t }),
                  U.h('div', { html: U.md('- 是 → ' + r.y + '\n- 否 → ' + r.n) })
                ]));
              });
            }
          },
          { t: 'callout', kind: 'eng', title: '工程师的两条补充经验', md: '1. 先画时域波形再谈变换。超过一半的选型错误源于没看过原始波形——很多你以为需要小波去噪的信号，其实只需要一个高通滤波器。\n2. 先用最便宜的工具建立基线。FFT 只需几十微秒，先用它看一眼，如果发现"频率在动""有毛刺""扫描余晖"，再升级到 STFT / 小波 / FRFT。工具越贵，越要先用便宜的验证是不是真的需要。' }
        ]
      },
      {
        id: 'cost', num: '4', title: '计算量：FFT 怎样改变了整个工业',
        blocks: [
          { t: 'md', md: '为什么单独强调"FFT 改变了工业"？因为直接计算 N 点 DFT 需要 $N^2$ 次复数乘加，而基 2 FFT 只需要约 $\\dfrac{N}{2}\\log_2 N$ 个蝶形单元。对 N = 4096 这种雷达/声呐的常规点数，两者相差近三个数量级——这直接决定了"能不能实时"。' },
          {
            t: 'widget', render: function (el) {
              const ks = [];
              for (let k = 4; k <= 13; k++) ks.push(k);
              const Ns = ks.map(k => Math.pow(2, k));
              const direct = Ns.map(N => N * N);
              const fftish = Ns.map(N => (N / 2) * Math.log2(N));
              const ratio = Ns.map((N, i) => direct[i] / fftish[i]);
              const wrap = U.h('div.grid.g2');
              const b1 = DSP.ui.plotBox({ title: '复数乘法次数：直接 DFT 与 FFT' });
              const p1 = DSP.plot.new(b1.canvas, { height: 240, xlabel: 'N（点数）', ylabel: '复数乘法次数', legend: true, legendPos: 'tl' });
              p1.add({ x: Ns, y: direct, type: 'line', color: 3, width: 2, label: '直接 DFT：N²' })
                .add({ x: Ns, y: fftish, type: 'line', color: 0, width: 2, label: '基 2 FFT：(N/2)log₂N' })
                .draw();
              const b2 = DSP.ui.plotBox({ title: '加速倍数 N² / ((N/2)log₂N) = 2N / log₂N' });
              const p2 = DSP.plot.new(b2.canvas, { height: 240, xlabel: 'N（点数）', ylabel: '加速倍数', legend: false });
              p2.add({ x: Ns, y: ratio, type: 'step', color: 2, width: 1.8 })
                .annotate(Ns[4], ratio[4], 'N=512 → ' + ratio[4].toFixed(0) + ' 倍', { dy: -8 })
                .annotate(Ns[8], ratio[8], 'N=8192 → ' + ratio[8].toFixed(0) + ' 倍', { dy: -8 })
                .draw();
              wrap.appendChild(b1.el); wrap.appendChild(b2.el);
              el.appendChild(wrap);
              const tbl = [
                ['256', (256 * 256).toLocaleString('en-US'), ((256 / 2) * 8).toLocaleString('en-US'), (256 * 2 / 8).toFixed(0) + ' 倍'],
                ['1024', (1024 * 1024).toLocaleString('en-US'), ((1024 / 2) * 10).toLocaleString('en-US'), (1024 * 2 / 10).toFixed(0) + ' 倍'],
                ['4096', (4096 * 4096).toLocaleString('en-US'), ((4096 / 2) * 12).toLocaleString('en-US'), (4096 * 2 / 12).toFixed(0) + ' 倍'],
                ['16384', (16384 * 16384).toLocaleString('en-US'), ((16384 / 2) * 14).toLocaleString('en-US'), (16384 * 2 / 14).toFixed(0) + ' 倍']
              ];
              el.appendChild(DSP.ui.table({
                cols: ['点数 N', '直接 DFT 复数乘法', '基 2 FFT 蝶形数', '加速比'],
                rows: tbl
              }));
              el.appendChild(U.h('div.plot-cap', { html: U.md('表中数值由本页脚本按 $\\tfrac{N}{2}\\log_2 N$ 实时计算。注意：1024 点 FFT 只有 5120 个蝶形，而直接 DFT 要 104 万次复数乘法——**差 205 倍**。') }));
            }
          },
          { t: 'callout', kind: 'eng', title: '这条加速比意味着什么', md: '一块中端 FPGA 做 4096 点流水线 FFT，吞吐可以超过 1 GSPS（每秒十亿点）。如果要用直接 DFT 达到同样吞吐，需要大约 682 倍的乘加器资源——这在任何现实的功耗预算下都不可能。换句话说：现代雷达的脉冲压缩、现代声呐的宽带波束形成、现代频谱仪的实时刷新，全部是 FFT 才成为可能；没有 FFT，"实时数字信号处理"这门学科基本不存在。' }
        ]
      },
      {
        id: 'signal', num: '5', title: '同一批信号，不同变换的"命中率"',
        blocks: [
          { t: 'md', md: '下面四种波形在雷达与水声里几乎囊括了所有情形。它们的时间结构完全不同，因此最适合的变换也完全不同。注意观察下图纵轴幅度的差异与横轴时间跨度。' },
          {
            t: 'widget', render: function (el) {
              const fs = 4000, N = 512;
              const tAxis = new Float64Array(N);
              for (let i = 0; i < N; i++) tAxis[i] = i / fs * 1000;
              const cases = [
                { name: '稳态单频 CW（1000 Hz）', y: C.multisin(N, fs, [{ freq: 1000, amp: 1 }]), best: 'FFT + 加窗', why: '频谱一根线，稳如磐石；时间信息无价值' },
                { name: 'LFM 扫频脉冲（600→1600 Hz）', y: C.chirp(N, fs, 600, 1600, N / fs), best: 'FRFT / 匹配滤波', why: '能量在时频面上是一条斜线，旋转到该角度即聚焦' },
                { name: '宽带瞬态脉冲（高斯包络）', y: C.gaussPulse(N, fs, 900, 600, N / fs / 2), best: '小波 CWT', why: '持续时间极短，STFT 固定窗抓不住，需尺度自适应' },
                { name: '双分量：慢 chirp + 瞬态尖峰', y: (function () { const a = C.chirp(N, fs, 300, 700, N / fs); const b = C.gaussPulse(N, fs, 1500, 900, 0.06); const o = new Float64Array(N); for (let i = 0; i < N; i++) o[i] = 0.7 * a[i] + (i > 25 * N / 100 ? 1.6 * b[i] : 0); return o; })(), best: 'STFT 或小波', why: '能量集中在某几个时刻，需要时间轴定位' }
              ];
              const grid = U.h('div.grid.g2');
              cases.forEach(cs => {
                const box = DSP.ui.plotBox({ title: cs.name });
                const p = DSP.plot.new(box.canvas, { height: 175, xlabel: 't / ms', ylabel: '幅度', legend: false });
                p.add({ x: tAxis, y: cs.y, color: 0, width: 1.4 }).draw();
                grid.appendChild(box.el);
              });
              el.appendChild(grid);
              el.appendChild(DSP.ui.table({
                cols: ['波形', '首选变换', '理由'],
                rows: cases.map(c => [c.name, c.best, c.why])
              }));
            }
          }
        ]
      },
      {
        id: 'eng', num: '6', title: '工程视角：实时链路里各变换排在什么位置',
        blocks: [
          { t: 'md', md: '一个典型的宽带主动声呐 / 雷达接收链路，几乎把整张变换表都用了一遍。看懂这条链路，就明白每个变换到底在哪个环节干活。' },
          {
            t: 'flow', items: [
              { t: 'ADC 采样', kind: 'io', d: '带通采样或基带采样，得到 x[n]' },
              { t: '数字下变频', kind: 'dsp', d: 'NCO + FIR 抽取，得到复基带 I+jQ' },
              { t: '匹配滤波 / 脉压', kind: 'dsp', d: '用 FFT 做大点数快速卷积，获得 10lg(BT) 处理增益' },
              { t: '多普勒处理', kind: 'dsp', d: '跨脉冲再做一个 FFT（MTD 滤波器组）' },
              { t: '时频分析', kind: 'dsp', d: '目标识别阶段用 STFT / 小波 提取调制谱与瞬态特征' },
              { t: '参数估计', kind: 'dsp', d: '遇到扫频干扰时用 FRFT 估计斜率并抑制' },
              { t: '检测 CFAR', kind: 'out', d: '在距离-多普勒平面上做恒虚警判决' }
            ]
          },
          { t: 'callout', kind: 'eng', title: '声呐显控台上的真实参数', md: '一台舰载被动声呐的分析仪面板通常这样设置：**FFT 长度 4096、汉宁窗、重叠 50%、Welch 平均 8 段、显示动态范围 80 dB**。这五项参数背后分别是——频率分辨率（$f_s/N$）、旁瓣抑制（弱目标可见性）、时间连续性（LOFAR 谱图不闪烁）、估计方差下降、以及 -13 dB 矩形窗泄漏的规避。**每一项都能在本模块后面的小节里找到依据。**' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区专栏',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 以为 FFT 和 DFT 是两个不同的变换', md: 'FFT 输出的每一个数与 DFT 的定义式逐位相同（差别只在浮点舍入顺序）。所以"用 FFT 会不会损失精度""换 FFT 能不能提高分辨率"这类问题本身不成立。真正会改变结果的是加窗、补零、平均——这些才是影响频谱质量的因素。' },
          { t: 'callout', kind: 'pit', title: '② 认为工具越高级越好，一上来就小波或 FRFT', md: '小波要选小波基与分解层数，FRFT 要搜索最优阶次，参数选错的代价远大于直接用 FFT。工程顺序永远是：FFT 建立基线 → 发现不够 → 再升级工具，并保留 FFT 结果做对照。' },
          { t: 'callout', kind: 'pit', title: '③ 忽略 DFT 隐含的周期性假设', md: 'DFT 在数学上把你的 N 个样本当成"一个周期"无限延拓。如果序列首尾不连续（几乎总是如此），延拓后会出现一个虚假的跳变，其能量泄漏到整个频带。这是后面所有"加窗"话题的根源，详见「DFT」一节。' },
          { t: 'callout', kind: 'pit', title: '④ 把"变换"当成目的本身', md: '变换只是把信号摆到一个更容易看清的位置，它不产生任何新信息（Parseval 定理保证能量守恒）。如果你的检测/估计算法在原始域做不好，换个域也不会凭空变好——除非这个域恰好让信号与噪声/干扰分离得更开。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, Discrete-Time Signal Processing, 3rd ed., 第 2–3、9 章（DTFT / DFT / FFT 主线）',
      '程佩青《数字信号处理教程》第 2、3、4 章',
      'Richards, Fundamentals of Radar Signal Processing（变换在雷达链路中的位置）'
    ]
  });

  /* ============================================================
     2. DTFT 离散时间傅里叶变换
     ============================================================= */
  doc.register('theory/transform/dtft', {
    title: 'DTFT 离散时间傅里叶变换',
    lede: 'DTFT 是整个数字频谱理论的基准：它回答"$x[n]$ 里到底有哪些频率成分"。它本身算不出来（无穷求和），但它是所有能算的频谱（DFT、FFT、谱估计）的定义参照。',
    tags: ['核心变换', 'DTFT', '频谱', 'Parseval'],
    toc: true,
    sections: [
      {
        id: 'def', num: '1', title: '定义与物理含义：把序列拆成复正弦的叠加',
        blocks: [
          { t: 'md', md: '对离散时间序列 $x[n]$，其离散时间傅里叶变换（DTFT）定义为：' },
          { t: 'math', tex: 'X(e^{j\\omega})=\\sum_{n=-\\infty}^{\\infty} x[n]\\,e^{-j\\omega n},\\qquad x[n]=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi} X(e^{j\\omega})\\,e^{j\\omega n}\\,d\\omega', tag: '(1)' },
          { t: 'kv', title: '变量与约定', pairs: [
            ['x[n]', '离散时间序列，n 为无量纲整数序号'],
            ['ω', '归一化角频率，单位 rad/sample，取值范围通常取 [−π, π)'],
            ['f', '真实频率（Hz），二者关系为 ω = 2πf / fs'],
            ['X(e^jω)', '复频谱，一般是复数，含幅度与相位两部分']
          ] },
          { t: 'callout', kind: 'note', title: '物理图象：它不是求和，是"配准"', md: '把 $e^{-j\\omega n}$ 看成一个**转速为 $\\omega$ 的单位旋转指针**。正变换做的事，就是拿这根指针去"乘以"序列的每一个样本：如果 $x[n]$ 中恰好含有频率 $\\omega_0$ 的成分，那么在该频率处，所有样本乘出来的结果会指向同一方向、累加成一个大数；而在其它频率处，各项方向杂乱、互相抵消。**所谓"频谱"，就是对所有转速做一遍配准试验，看哪个转速能凑出最大的合力。**这就是"相关检测"的本质。' },
          { t: 'md', md: '反过来理解反变换式：任何序列都可以表示为无穷多个复正弦 $e^{j\\omega n}$ 的连续叠加，每个频率分量的"份额"就是 $X(e^{j\\omega})\\,d\\omega / 2\\pi$。**这就是为什么称 $X(e^{j\\omega})$ 为频谱密度**——单点的值没有物理意义，只有在一小段频带上积分才有能量意义。' }
        ]
      },
      {
        id: 'cond', num: '2', title: '存在条件：三种收敛口径',
        blocks: [
          { t: 'md', md: '式 (1) 是一个无穷级数，什么时候收敛？教材给出三种由强到弱的口径，工程上由此决定"能不能直接谈频谱"。' },
          { t: 'table', cols: ['条件', '数学表述', '收敛性质', '典型例子'], rows: [
            ['绝对可和（最常用）', 'Σₙ |x[n]| < ∞', '一致收敛，X(e^jω) 连续且有界', '矩形窗序列、指数衰减 aⁿu[n]（|a| < 1）'],
            ['平方可和（能量有限）', 'Σₙ |x[n]|² < ∞', '均方收敛，X 可能不连续但存在', '有限长信号、sinc 型序列'],
            ['广义情形', '含冲激 δ(ω)', '引入广义函数后才成立', '常数序列、正弦序列、阶跃']
          ] },
          { t: 'md', md: '例如 $x[n]=a^n u[n]$（$|a|<1$）绝对可和，代入式 (1) 得到等比级数：' },
          { t: 'math', tex: 'X(e^{j\\omega})=\\sum_{n=0}^{\\infty}a^n e^{-j\\omega n}=\\frac{1}{1-ae^{-j\\omega}},\\qquad |X(e^{j\\omega})|=\\frac{1}{\\sqrt{1+a^2-2a\\cos\\omega}}', tag: '(2)' },
          { t: 'callout', kind: 'warn', title: '既不绝对可和也不平方可和时怎么办', md: '周期序列（如单频正弦）和常数序列的总能量无穷，严格意义的 DTFT 不存在，必须引入冲激函数写成广义形式：$x[n]=e^{j\\omega_0 n}\\ \\Longleftrightarrow\\ X(e^{j\\omega})=2\\pi\\sum_k \\delta(\\omega-\\omega_0-2\\pi k)$。**工程上的处理方法不是硬算，而是用功率谱密度（PSD）**——把无穷能量除以无穷时间，得到有限的谱密度。这正是随机信号必须走 Welch 平均路线的原因。' }
        ]
      },
      {
        id: 'prop', num: '3', title: '四条必须背下来的性质',
        blocks: [
          { t: 'md', md: 'DTFT 的性质非常多，但真正每天在用的只有四条。它们不是孤立条目，而是同一句话的不同侧面。' },
          { t: 'table', cols: ['性质', '时域', '频域', '工程含义'], rows: [
            ['线性', 'a·x₁[n] + b·x₂[n]', 'a·X₁(e^jω) + b·X₂(e^jω)', '叠加干扰可以逐个分析再相加'],
            ['时移 → 线性相移', 'x[n − n₀]', 'e^(−jωn₀)·X(e^jω)', '延迟只改相位、不改幅度谱；这是时延估计的理论基础'],
            ['频域 2π 周期', 'x[n]（离散）', 'X(e^(j(ω+2π))) = X(e^jω)', '离散化使频谱必然周期重复，只需看 [−π, π)'],
            ['Parseval 能量守恒', 'Σₙ|x[n]|²', '(1/2π)∫|X|² dω', '换域不增不减能量；域的选择只是换个观察角度']
          ] },
          { t: 'math', tex: '\\sum_{n=-\\infty}^{\\infty}|x[n]|^2\\;=\\;\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}\\bigl|X(e^{j\\omega})\\bigr|^2\\,d\\omega', tag: '(3)' },
          { t: 'callout', kind: 'tip', title: '时移性质的分量级理解', md: '把 x[n − n₀] 代入定义，令 $m=n-n_0$，则 $\\sum_m x[m]e^{-j\\omega(m+n_0)} = e^{-j\\omega n_0}\\sum_m x[m]e^{-j\\omega m}$。**延迟 $n_0$ 个样本，等价于给所有频率分量都加一个与频率成正比的相位滞后 $-\\omega n_0$。**这条结论直接解释了三件事：①为什么 FIR 的线性相位意味着常数群延迟；②为什么时延可以用互相关峰位置来测；③为什么宽带信号的时延不能简单用"某个频率的相位"来测（相位要以 $2\\pi$ 为周期折回，存在模糊）。' },
          {
            t: 'fold', summary: '展开：Parseval 定理的完整推导', deriv: true, blocks: [
              { t: 'md', md: '设 $E=\\sum_n x[n]x^*[n]$。把其中一个因子用反变换式代入：$x^*[n]=\\left(\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}X(e^{j\\omega})e^{j\\omega n}d\\omega\\right)^*=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}X^*(e^{j\\omega})e^{-j\\omega n}d\\omega$。' },
              { t: 'md', md: '于是 $E=\\sum_n x[n]\\cdot\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}X^*(e^{j\\omega})e^{-j\\omega n}d\\omega$。交换求和与积分次序：$\\;E=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}X^*(e^{j\\omega})\\Big[\\sum_n x[n]e^{-j\\omega n}\\Big]d\\omega$。' },
              { t: 'md', md: '方括号内正是正变换定义，即 $X(e^{j\\omega})$。故 $\\;E=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}X^*(e^{j\\omega})X(e^{j\\omega})d\\omega=\\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi}|X(e^{j\\omega})|^2d\\omega$，证毕。' },
              { t: 'callout', kind: 'eng', title: '工程价值：它是 SNR 计算的合法性依据', md: 'Parseval 保证了我们可以在时域算信号功率、在频域算噪声功率（或直接反过来），而不用担心"单位不统一"。**主动声呐脉压增益 $10\\log(BT)$、雷达相参积累增益 $10\\log N$ 的推导全部建立在这个守恒关系上。**但要小心：不同带宽下比较 SNR 必须统一到功率谱密度，否则会差一个带宽因子。' }
            ]
          }
        ]
      },
      {
        id: 'period', num: '4', title: '为什么离散频谱必然是 2π 周期的',
        blocks: [
          { t: 'md', md: '这是连续频率到离散序列最反直觉、也最重要的一条结论。原因就一句话：**$e^{-j\\omega n}$ 对整数 $n$ 而言，以 $2\\pi$ 为周期。**因为 $e^{-j(\\omega+2\\pi)n}=e^{-j\\omega n}\\cdot e^{-j2\\pi n}=e^{-j\\omega n}\\cdot 1$。' },
          {
            t: 'plot', title: 'DTFT 的频谱必然每隔 2π 重复一次（同一序列画了三个周期）', height: 250,
            render: function (canvas) {
              const NF = 1200;
              const w = new Float64Array(NF);
              const magY = new Float64Array(NF);
              for (let i = 0; i < NF; i++) {
                const om = -3 * Math.PI + 6 * Math.PI * i / (NF - 1);
                w[i] = om / Math.PI;
                // X(e^{jw}) = 1/(1 - a e^{-jw})，a = 0.7
                const a = 0.7;
                const re = 1 - a * Math.cos(om), im = a * Math.sin(om);
                magY[i] = 1 / Math.sqrt(re * re + im * im);
              }
              const p = DSP.plot.new(canvas, {
                height: 250, xlabel: 'ω / π', ylabel: '|X(e^{jω})|', legend: true, legendPos: 'tr', grid: true
              });
              p.add({ x: w, y: magY, color: 0, width: 1.8, label: 'a=0.7 时的一阶谱' })
                .band(-1, 1, { color: '#f59e0b', alpha: 0.13 })
                .vline(-1, { label: '−π' }).vline(1, { label: 'π' })
                .vline(-3, { label: '−3π', dash: [3, 3] }).vline(3, { label: '3π', dash: [3, 3] })
                .draw();
            }
          },
          { t: 'md', md: '图上高亮的一段 $[-\\pi,\\pi)$ 称为**主值区间**，它就是全部有效信息。这一点与 DFT 的输出完全一致：DFT 输出的 $X[0]\\sim X[N-1]$ 也是把一个 $2\\pi$ 周期摊在 N 个频点上，其中 $k>N/2$ 的那一半对应负频率。**看不懂负频率，就看不懂实序列的共轭对称性，也就看不懂后续所有的频谱泄漏处理。**' },
          { t: 'callout', kind: 'note', title: '为什么强调"归一化角频率"', md: '$\\omega$ 的单位是弧度每样本，而真实的物理频率是 $f=\\omega f_s/(2\\pi)$，两个 $f_s$ 不同的系统里，同样的 $\\omega$ 代表的真实频率完全不同。**课堂上用 $\\omega$ 讲清楚机理，工程上必须换算回 Hz 再写进报告**，否则一个 FFT 输出就可能让人把 800 Hz 的目标报成 0.1 Hz。' }
        ]
      },
      {
        id: 'ctft', num: '5', title: '与连续时间傅里叶变换（CTFT）的关系与差别',
        blocks: [
          { t: 'table', cols: ['对比维度', 'CTFT $X_a(f)=\\int x_a(t)e^{-j2\\pi ft}dt$', 'DTFT $X(e^{j\\omega})=\\sum x[n]e^{-j\\omega n}$'], rows: [
            ['自变量', '频率 f（Hz），取值 (−∞, +∞)', '归一化角频率 ω，取值只在一个 2π 周期内'],
            ['频谱是否周期', '一般不周期', '必然以 2π 为周期'],
            ['最高可表示频率', '原则上无上限', '只有 |ω| ≤ π，即 |f| ≤ fs/2'],
            ['与时间分辨率的关系', '二者由傅里叶不确定关系约束', '同样受约束，且额外受采样率约束'],
            ['求和还是积分', '积分（连续）', '求和（离散）']
          ] },
          { t: 'md', md: '两者通过采样串起来。设 $x[n]=x_a(nT_s)$，则：**DTFT 就是先对 $x_a(t)$ 采样造成频谱周期延拓、再把频率轴按 $f_s$ 归一化折叠的结果。**折叠因子为：' },
          { t: 'math', tex: 'X(e^{j\\omega})=\\frac{1}{T_s}\\sum_{k=-\\infty}^{\\infty}X_a\\!\\left(\\frac{\\omega f_s}{2\\pi}-kf_s\\right),\\qquad \\omega=\\frac{2\\pi f}{f_s}', tag: '(4)' },
          { t: 'callout', kind: 'eng', title: '这条关系在声呐/雷达里的直接后果', md: '只要 $|f|>f_s/2$，就再也无法区分了——这正是采样定理的内容。**所以在做 FFT 之前必须先确认抗混叠滤波器工作正常。**舰载声呐常遇到的一个隐蔽问题是：夏季浅海的生物噪声在 40 kHz 以上很强，如果采集卡只在 20 kHz 处做了一阶 RC 滤波，这些能量会折到 0~10 kHz 的分析带内，造成整条 LOFAR 谱的噪声底整体抬升 5~10 dB，**看起来像"今天海况特别差"，其实是自己的前端漏了。**' }
        ]
      },
      {
        id: 'limit', num: '6', title: '致命缺点：无穷求和，算不出来 —— 引出 DFT',
        blocks: [
          { t: 'md', md: 'DTFT 是连续函数：$\\omega$ 在 $[-\\pi,\\pi)$ 上有无穷多个取值，每个都要做一次无穷项求和。**计算机既处理不了无穷多项求和，也存不下连续函数。**怎么办？两条现实的路：' },
          { t: 'md', md: '1. **时域截断**：只留下能量集中的有限 N 项（这等价于加窗，代价是泄漏）；\n2. **频域采样**：只在 $\\omega_k=2\\pi k/N$ 这 N 个离散频点上求值（代价是时域被看成周期序列）。' },
          {
            t: 'plot', title: '同一个序列：连续的 DTFT 与 16 点 DFT 的采样点', height: 260,
            render: function (canvas) {
              const N = 32;
              const x = new Float64Array(N);
              for (let i = 0; i < N; i++) x[i] = Math.pow(0.85, i) * Math.cos(2 * Math.PI * 0.18 * i);
              const NF = 600;
              const wAxis = new Float64Array(NF), dtft = new Float64Array(NF);
              for (let i = 0; i < NF; i++) {
                const om = Math.PI * i / (NF - 1);
                let re = 0, im = 0;
                for (let n = 0; n < N; n++) { re += x[n] * Math.cos(om * n); im -= x[n] * Math.sin(om * n); }
                wAxis[i] = om / Math.PI;
                dtft[i] = Math.hypot(re, im);
              }
              const S = C.mag(C.fft(x, 16));
              const kHalf = 9;
              const kArr = new Float64Array(kHalf), vArr = new Float64Array(kHalf);
              for (let k = 0; k < kHalf; k++) { kArr[k] = 2 * k / 16; vArr[k] = S[k]; }
              const p = DSP.plot.new(canvas, {
                height: 260, xlabel: 'ω / π', ylabel: '幅度（线性）', legend: true, legendPos: 'tr'
              });
              p.add({ x: wAxis, y: dtft, color: 0, width: 1.8, label: 'DTFT（600 点细网格上的真谱）' })
                .add({ x: kArr, y: vArr, type: 'stem', color: 3, width: 1.3, size: 3.2, label: '16 点 DFT 的采样值' })
                .draw();
            }
          },
          { t: 'callout', kind: 'note', title: '这张图是理解整个 DFT 章节的关键', md: 'DFT 的每个输出点，恰好落在 DTFT 曲线的对应位置上——DFT 没有"创造"任何东西，它只是尽职地采样了 DTFT。因此：① DFT 点之间的空隙（栅栏效应）是真谱信息的丢失区；② 谱峰不落在 DFT 频点上时，读到的幅度会偏低（扇形损失）；③ 补零能补密采样点让曲线变光滑，但不能恢复两个相邻谱峰的分辨能力，因为真谱本身的宽度没有变。' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区专栏',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 把 X(e^jω) 在单点的值当成"该频率的能量"', md: '它是**密度**。能量必须对一个频带积分。最常见的结果是：不同 FFT 点数下画出的 dB 谱高度不同，于是以为设备故障——其实是 $|X|^2$ 与后续的处理 $/N$、$/f_s$ 归一化没有统一。**统一到功率谱密度（单位 V²/Hz）后，任何点数、任何窗的曲线都应重合。**' },
          { t: 'callout', kind: 'pit', title: '② 认为 DTFT 和 DFT 只是"精度差异"', md: '不是。DFT 隐含了时域周期延拓的假设，由此带来循环卷积、首尾不连续、频谱泄漏等一系列 DTFT 根本没有的问题。两者的定义不同，后果也不同。' },
          { t: 'callout', kind: 'pit', title: '③ 对功率信号直接套 DTFT 公式', md: '噪声、CW 连续波、周期序列的能量都是无穷，DTFT 不收敛。正确处理是取功率谱密度，配合分段平均（Welch）。详见「随机信号」模块。' },
          { t: 'callout', kind: 'eng', title: '工程提示：什么时候必须回归 DTFT 框架', md: '做**滤波器设计与指标换算**时，DTFT 才是正确语言：FIR 抽头 → $H(e^{j\\omega})$ → 通带波纹、阻带衰减、群延迟，全部定义在连续频率轴上。用 FFT 算出来的 $H[k]$ 只是这些曲线的采样值，**验收指标时一定要说清楚是"任一频率"还是"仅采样点"（后者会漏掉采样点之间的过冲）。**' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 2 章（Discrete-Time Fourier Transform）',
      'Proakis & Manolakis, Digital Signal Processing, 第 4 章',
      '程佩青《数字信号处理教程》第 2 章'
    ]
  });

  /* ============================================================
     3. DFT 离散傅里叶变换
     ============================================================= */
  doc.register('theory/transform/dft', {
    title: 'DFT 离散傅里叶变换',
    lede: 'DFT 把 DTFT 的连续频谱采样成 N 个可存储的数字。这个"采样"动作同时带来两个副作用——时域被隐含周期延拓、频谱出现栅栏——它们是数字信号处理里绝大多数"灵异现象"的共同来源。',
    tags: ['核心变换', 'DFT', '泄漏', '栅栏效应', '循环卷积'],
    toc: true,
    labs: [{ path: 'lab/dft', title: 'DFT / FFT 交互实验台', desc: '调频率偏移、调窗型、调补零长度，亲眼看泄漏与栅栏效应如何随参数变化' }],
    sections: [
      {
        id: 'def', num: '1', title: '定义：N 个数进，N 个数出',
        blocks: [
          { t: 'math', tex: 'X[k]=\\sum_{n=0}^{N-1}x[n]\\,e^{-j\\frac{2\\pi}{N}kn},\\quad k=0,1,\\dots,N-1；\\qquad x[n]=\\frac{1}{N}\\sum_{k=0}^{N-1}X[k]\\,e^{j\\frac{2\\pi}{N}kn}', tag: '(1)' },
          { t: 'md', md: '这组式子最重要的性质是：**输入 N 个样本，输出恰好 N 个复数。**这意味着没有任何信息损失，也没有任何信息增加——它就是一个 $N$ 维线性空间里的**可逆基变换**，把信号从"标准基底（单位脉冲 $\\delta[n-m]$）"换到"复正弦基底 $e^{j2\\pi kn/N}$"上去。' },
          { t: 'callout', kind: 'note', title: '正交基的几何解释', md: 'N 个复正弦向量 $\\{e^{j2\\pi kn/N}\\}_{k=0}^{N-1}$ 两两正交，模长都是 $\\sqrt{N}$。正变换相当于把信号向量向这 N 个正交方向**投影**；反变换则用这些投影重建信号。**所谓"频谱泄漏"，就是信号向量与某个基底方向不完全对齐时，能量洒到了所有其它方向上。**这与"正交频分复用 OFDM 的子载波必须严格正交"是同一件事。' },
          { t: 'kv', title: '三个必须记住的换算', pairs: [
            ['k → f', '第 k 个频点对应真实频率 f_k = k·fs/N（k ≤ N/2 时）；k > N/2 时为负频率 f_k = (k−N)·fs/N'],
            ['频率分辨率', '相邻两个频点间隔 Δf = fs/N，它等于有效观测时间 T 的倒数 1/T'],
            ['N → T', 'N 个点在采样率 fs 下对应时长 T = N/fs，所以"提高分辨率"等价于"延长观测"']
          ] }
        ]
      },
      {
        id: 'samp', num: '2', title: 'DFT 是 DTFT 的等间隔采样',
        blocks: [
          { t: 'md', md: '把 DTFT 的连续频率 $\\omega$ 限制到 $\\omega_k=2\\pi k/N$，并把求和范围收到有限长 N 点（因为 $x[n]$ 只有 $0\\sim N-1$ 有值），DTFT 的定义式就**逐字变成** DFT 的定义式。这是两个变换之间唯一的桥梁。' },
          { t: 'math', tex: 'X[k]=X(e^{j\\omega})\\Big|_{\\omega=2\\pi k/N},\\qquad \\Delta\\omega=\\frac{2\\pi}{N}\\ \\Longleftrightarrow\\ \\Delta f=\\frac{f_s}{N}=\\frac{1}{T}', tag: '(2)' },
          { t: 'callout', kind: 'tip', title: '把 Δf = 1/T 记死', md: '这条公式解释了几乎所有的分辨率问题：**分辨率只由观测时长决定，与采样率无关、与 FFT 点数无关（在点数不足时可以再花样补零）。**要在 1000 Hz 附近分辨两个相差 5 Hz 的频率，你必须连续观测至少 $1/5 = 0.2$ 秒。这就是声呐低频线谱检测必须长时间积分的根本原因，也是"用更高采样率能看得更细"这一直觉错误被打破的地方。' }
        ]
      },
      {
        id: 'wrap', num: '3', title: '万恶之源：DFT 隐含的周期延拓与循环卷绕',
        blocks: [
          { t: 'md', md: 'DFT 的定义里只用了 $x[0]\\sim x[N-1]$，但它的基底 $e^{j2\\pi kn/N}$ 对 $n$ 是以 N 为周期的。因此反变换得到的序列必然满足 $\\tilde{x}[n+N]=\\tilde{x}[n]$。**换句话说：DFT 在数学上把你给的 N 个样本当成了某个周期序列的一个周期。**你没告诉它"前后是什么"，它就替你假设"后面就是前面的重复"。' },
          {
            t: 'plot', title: '一段 32 点数据被 DFT 假定为"无限重复"——首尾衔接处出现了现实中不存在的跳变', height: 230,
            render: function (canvas) {
              const N = 32;
              const x = new Float64Array(N);
              for (let i = 0; i < N; i++) x[i] = Math.cos(2 * Math.PI * 3.3 * i / N) * Math.pow(0.92, i);
              const tRep = new Float64Array(3 * N), xRep = new Float64Array(3 * N);
              for (let i = 0; i < 3 * N; i++) { tRep[i] = i; xRep[i] = x[i % N]; }
              const p = DSP.plot.new(canvas, {
                height: 230, xlabel: '样本序号 n（DFT 假定的周期延拓）', ylabel: 'x[n]', legend: false, grid: true
              });
              p.add({ x: tRep, y: xRep, type: 'step', color: 0, width: 1.6 })
                .band(0, N - 1, { color: '#4a90d9', alpha: 0.14 })
                .vline(N - 0.5, { label: '周期边界', dash: [5, 3] })
                .vline(2 * N - 0.5, { label: '周期边界', dash: [5, 3] })
                .annotate(N / 2, 0.55, '真实观测到的这一帧', { dy: -6 })
                .draw();
            }
          },
          { t: 'md', md: '这个假设带来两个直接后果，它们分别是工程事故的两大来源。' },
          {
            t: 'widget', render: function (el) {
              const L = 8, M = 8;
              const x = new Float64Array(L);
              x[0] = 1; x[1] = 0.8; x[2] = 0.4; x[3] = 0.1;
              const h = new Float64Array(M);
              h[0] = 1; h[1] = 0.6; h[2] = 0.3; h[3] = 0.15; h[4] = 0.05;
              const lin = C.conv(x, h);              // 长度 L+M-1 = 15
              const circ = C.cconv(x, h, 8);         // 8 点循环卷积 → 发生混叠
              const wrap = U.h('div.grid.g2');
              const b1 = DSP.ui.plotBox({ title: '线性卷积（真实物理结果，15 点）' });
              const p1 = DSP.plot.new(b1.canvas, { height: 200, xlabel: 'n', ylabel: 'y[n]', legend: false });
              p1.add({ x: U.arange(15), y: Array.from(lin), type: 'stem', color: 0, width: 1.5, size: 3.4 }).draw();
              const b2 = DSP.ui.plotBox({ title: '8 点循环卷积（尾部被折回来叠加，前几点被污染）' });
              const p2 = DSP.plot.new(b2.canvas, { height: 200, xlabel: 'n', ylabel: 'y[n]', legend: false });
              p2.add({ x: U.arange(8), y: Array.from(circ), type: 'stem', color: 3, width: 1.5, size: 3.4 }).draw();
              wrap.appendChild(b1.el); wrap.appendChild(b2.el);
              el.appendChild(wrap);
              el.appendChild(U.h('div.plot-cap', { html: U.md('长度 8 与 8 的序列做线性卷积应有 15 点，若强行只保留 8 点（即用 DFT 快速做卷积而**没有补零到 $L+M-1$**），第 $8\\sim14$ 点会被模 8 折回来叠加到前 7 点上，造成结果错误。这就是"循环卷绕"。') }));
            }
          },
          { t: 'callout', kind: 'danger', title: '这是 FFT 快速卷积最常见的工程 bug', md: '用 FFT 做卷积时必须先把两个序列**补零到不小于 $L+M-1$**（通常取 $\\ge$ 该值的 2 的幂）。忘了这一步的结果是：滤波器输出的前 $M-1$ 个样本被污染，看起来像"滤波器有个奇怪的瞬态"。在实时分块滤波中，这对应 **Overlap-Add / Overlap-Save** 两种标准做法，绝不能直接用等长循环卷积。**类似的坑还有：用 DFT 做相关、做插值、做重采样时，都必须先想清楚"隐含周期"会不会引入假折叠。**' },
          {
            t: 'fold', summary: '展开：为什么 DFT 的循环卷积等于线性卷积的混叠', deriv: true, blocks: [
              { t: 'md', md: '设线性卷积 $y_{lin}[n]=\\sum_m x[m]h[n-m]$，长度 $L+M-1$。N 点循环卷积定义为 $y_c[n]=\\sum_m x[m]\\,h[(n-m)\\bmod N]$。把线性卷积的下标按模 N 分类：$y_c[n]=\\sum_{q}\\sum_{m}x[m]h[n-m+qN]=\\sum_q y_{lin}[n+qN]$。' },
              { t: 'md', md: '所以 **$y_c$ 就是把 $y_{lin}$ 以 N 为周期折叠相加（混叠）**。当 $N\\ge L+M-1$ 时，$y_{lin}$ 本身长度不超过 N，无项可折，两者相等；当 $N<L+M-1$ 时，$y_{lin}$ 的尾部 $[N,\\;L+M-2]$ 会被折回前部叠加，于是前 $L+M-1-N$ 个点失真。' },
              { t: 'md', md: '频域视角同样清晰：**时域循环卷积 ⟺ 频域逐点相乘**。而 DFT 只有 N 个频点，$X[k]H[k]$ 的乘积只有 N 个值，只能描述 N 点的结果——多出来的点在这个（隐含周期的）世界里没有地方放，只能叠回来。' }
            ]
          }
        ]
      },
      {
        id: 'fence', num: '4', title: '栅栏效应与频谱泄漏',
        blocks: [
          { t: 'md', md: '**栅栏效应**：DFT 只在 $\\omega_k=2\\pi k/N$ 这些离散频点上"看"真谱，就像透过一排栅栏看风景。如果真实谱峰恰好落在两根栅栏之间，你看到的峰会被压低（最大损失称为扇形损失 Scalloping Loss，矩形窗可达 1.42 dB，约 36%）。' },
          { t: 'md', md: '频谱泄漏：截短（乘矩形窗）使每根理想的谱线被摊成窗的频谱形状（主瓣加 -13 dB 的缓慢衰减旁瓣）。强信号的一串旁瓣可以横跨整个频带，把近旁的弱目标完全埋掉。' },
          {
            t: 'plot', title: '同一频率的正弦，落在不同的 bin 偏移上时看到的谱完全不同（16 点 DFT）', height: 250,
            render: function (canvas) {
              const N = 16, fs = 1;
              const p = DSP.plot.new(canvas, {
                height: 250, xlabel: '频率 / 采样率', ylabel: '幅度 dB', legend: true, legendPos: 'tr', ylim: [-45, 3]
              });
              [0, 0.5, 2.5].forEach((dOff, ci) => {
                const x = new Float64Array(N);
                for (let i = 0; i < N; i++) x[i] = Math.cos(2 * Math.PI * (3 + dOff) * i / N);
                const mg = C.mag(C.fft(x, 128));
                const db = dBnorm(mg.subarray(0, 64), -45);
                const f = U.linspace(0, 0.5 * (63 / 64), 64);
                p.add({
                  x: f, y: Array.from(db), color: ci, width: ci === 0 ? 2 : 1.4,
                  dash: ci === 0 ? null : [5, 3],
                  label: '真实 bin = ' + (3 + dOff) + '（偏移 ' + dOff + '）'
                });
              });
              p.draw();
            }
          },
          { t: 'callout', kind: 'eng', title: '工程对策三条', md: '1. 加窗压旁瓣：汉宁 -32 dB、汉明 -41 dB、布莱克曼 -58 dB、布莱克曼-哈里斯 -92 dB，代价是主瓣变宽（分辨率下降）。\n2. 提高 DFT 长度或调整采样时长，使感兴趣的频率尽量落在 bin 上（锁频接收机会这样做）。\n3. 插值 FFT：用峰值附近的 3 个点做抛物线（汉宁窗）或更大窗宽的拟合，把幅度与频率估计精度提高一到两个数量级，代价极小。' }
        ]
      },
      {
        id: 'interp', num: '5', title: '泄漏补偿与插值 FFT：能救回多少',
        blocks: [
          { t: 'md', md: '如果信号频率不落在 bin 上，直接用最大 bin 的位置和幅度估计频率与幅值，误差会很大。利用主瓣形状做插值可以在几乎不增加计算量的前提下大幅改善。以最常用的汉宁窗三点对数/幅度插值为例：' },
          { t: 'math', tex: '\\delta=\\frac{|X[k_0+1]|-|X[k_0-1]|}{|X[k_0-1]|+2|X[k_0]|+|X[k_0+1]|}\\cdot\\frac{2}{\\text{ENBW 系数}},\\qquad \\hat f=\\frac{k_0+\\delta\\,/2}{N}f_s', tag: '(3)' },
          {
            t: 'widget', render: function (el) {
              const N = 128, wn = C.window('hann', N);
              const rows = [];
              let maxErrRaw = 0, maxErrInt = 0;
              for (let d = 0; d <= 0.5 + 1e-9; d += 0.1) {
                const x = new Float64Array(N);
                for (let i = 0; i < N; i++) x[i] = Math.cos(2 * Math.PI * (20 + d) * i / N) * wn[i];
                const mg = C.mag(C.fft(x, N));
                const k0 = 20;
                let bi = 19;
                for (let k = 18; k <= 22; k++) if (mg[k] > mg[bi]) bi = k;
                const raw = bi;
                const a = mg[bi - 1], b = mg[bi], c = mg[bi + 1];
                const delta = (c - a) / (a + 2 * b + c) * 2;
                const interp = bi + delta / 2;
                const truth = 20 + d;
                const eRaw = Math.abs(raw - truth), eInt = Math.abs(interp - truth);
                if (eRaw > maxErrRaw) maxErrRaw = eRaw;
                if (eInt > maxErrInt) maxErrInt = eInt;
                rows.push([(20 + d).toFixed(1), raw.toFixed(2), interp.toFixed(3), eRaw.toFixed(3), eInt.toFixed(4)]);
              }
              el.appendChild(DSP.ui.table({
                cols: ['真实频率 (bin)', '最大 bin 位置', '插值估计', '直接估计误差 (bin)', '插值后误差 (bin)'],
                rows: rows
              }));
              el.appendChild(DSP.ui.metrics([
                { label: '直接取峰值 bin', value: maxErrRaw.toFixed(3), unit: 'bin 最大误差' },
                { label: '汉宁三点插值', value: maxErrInt.toFixed(4), unit: 'bin 最大误差' },
                { label: '精度改善', value: (maxErrRaw / Math.max(maxErrInt, 1e-6)).toFixed(0), unit: '倍' }
              ]));
              el.appendChild(U.h('div.plot-cap', { html: U.md('数值由本页用核心库的窗与 FFT 实时计算：128 点汉宁窗，对 $k_0=20$ 附近不同 bin 偏移量做估计。**注意：插值能把 0.5 bin 级的误差压到 0.01 bin 级**，这在轴频估计、频率测量仪里是免费的精度提升。') }));
            }
          }
        ]
      },
      {
        id: 'sym', num: '6', title: '实序列对称性、翻褶与循环移位',
        blocks: [
          { t: 'md', md: 'DFT 的另外几条常用性质，工程上主要用来省计算量和构造各种拼接技巧。' },
          { t: 'table', cols: ['性质', '表达式', '用处'], rows: [
            ['隐含周期', 'X[k+N] = X[k]，x[n+N] = x[n]', '解释所有混叠与卷绕现象'],
            ['实序列共轭对称', 'x 为实序列 ⇒ X[N−k] = X*[k]', '只需计算并存储一半频谱'],
            ['循环移位', 'x[(n−m) mod N] ⇔ X[k]·e^(−j2πkm/N)', '频域乘相位项 = 时域循环平移'],
            ['翻褶', 'x[(−n) mod N] ⇔ X[(−k) mod N]', '与循环相关的共轭对称对应'],
            ['Parseval', 'Σ|x[n]|² = (1/N)·Σₖ|X[k]|²', '在时域或频域算功率都可以']
          ] },
          { t: 'callout', kind: 'note', title: '共轭对称的三个推论', md: '① $|X[k]| = |X[N-k]|$，**实信号的幅度谱是偶对称的**，所以只画前 $N/2+1$ 点就够了；② 直流 $X[0]$ 与奈奎斯特点 $X[N/2]$ 一定是实数（它们自身共轭）；③ 由两个实序列 $x_1,x_2$ 可构造复序列 $x_1+jx_2$，做**一次** N 点 FFT 后用共轭对称关系分离出两个频谱，节省近一半计算量——这是 I/Q 双通道处理的常用技巧。' },
          { t: 'md', md: '注意**循环移位**与线性移位不同：$x[(n-m)\\bmod N]$ 是一端移出去的样本从另一端绕回来，而不是补零。频域"乘一个线性相位"实现的正是这种绕回来的移位。**想做真正的线性移位（平移保留、边缘补零），就必须先在时域处理好，或者接受循环结果。**' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区专栏',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 把 k 当成频率', md: '$f_k = k\\,f_s/N$，而且 $k > N/2$ 的部分是**负频率**。画频谱时横坐标一定要换算成 Hz 并写好单位。这是初学者做一次错一次的地方。' },
          { t: 'callout', kind: 'pit', title: '② "提高分辨率就多补零"', md: '补零 = 频域内插，**只让曲线变密、让峰值位置更好读，不提高两个邻近谱峰的分辨能力**。$\\Delta f = 1/T_{有效}$，唯一的办法是延长实际观测时间。这条与「窗函数基础」一节呼应。' },
          { t: 'callout', kind: 'pit', title: '③ 认为 DFT 输出是"信号真的有的频率"', md: 'DFT 输出是投影值，受截断长度与噪声影响很大。低于噪声底的"谱峰"没有意义；单次随机样本的 DFT 幅度本身方差极大。做结论前必须做多次平均或统计检验。' },
          { t: 'callout', kind: 'pit', title: '④ 直接对非整周期截断的信号做 FFT 而不加窗', md: '这就是默认用矩形窗。除非信号恰好是 FFT 长度的整周期（几乎不可能），否则一定有泄漏。默认加汉宁窗是最省事的正确习惯，尤其在做谱估计、看弱目标的时候。' },
          { t: 'callout', kind: 'eng', title: '工程提示', md: '写 FFT 处理软件时，建议把"点数 / 窗型 / 重叠率 / 平均次数 / 幅度归一化方式"五项参数全部显式记录到输出文件的元数据里。缺少任何一项，这张谱就无法被别人复现或与你比较。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 8 章（DFT）与第 10 章（FFT 实现）',
      'Harris, "On the Use of Windows for Harmonic Analysis with the DFT", Proc. IEEE, 1978',
      '程佩青《数字信号处理教程》第 3 章'
    ]
  });

  /* ============================================================
     4. FFT 快速傅里叶变换
     ============================================================= */
  doc.register('theory/transform/fft', {
    title: 'FFT 快速傅里叶变换与蝶形运算',
    lede: 'FFT 不是新变换，它是"发现了 DFT 矩阵里大量重复计算"之后的一个聪明算法：$N^2$ 降到 $N\\log_2 N$，两次革命性地拉低了实时信号处理的门槛。',
    tags: ['核心变换', 'FFT', '蝶形运算', '位反转', '实时处理'],
    toc: true,
    labs: [{ path: 'lab/fftflow', title: 'FFT 蝶形运算动画实验台', desc: '逐级点亮蝶形，看清数据流向、旋转因子与位反转重排全过程' }],
    sections: [
      {
        id: 'why', num: '1', title: '为什么能加速：旋转因子的两条性质',
        blocks: [
          { t: 'md', md: 'DFT 之所以"浪费"，是因为旋转因子 $W_N^{kn}=e^{-j2\\pi kn/N}$ 虽然看起来有 $N^2$ 个不同取值，实际上**只有 N 个不同的值**。根源是两条性质：' },
          { t: 'math', tex: '\\textbf{周期性：}\\ W_N^{k+N}=W_N^{k};\\qquad \\textbf{对称性：}\\ W_N^{k+N/2}=-\\,W_N^{k},\\qquad \\bigl(W_N^{N/2}=-1\\bigr)', tag: '(1)' },
          { t: 'md', md: '举个最直观的例子，$N=4$ 时 DFT 矩阵为：' },
          { t: 'math', tex: '\\mathbf{W}_4=\\begin{bmatrix}1&1&1&1\\\\1&W_4^1&W_4^2&W_4^3\\\\1&W_4^2&W_4^{4}&W_4^{6}\\\\1&W_4^3&W_4^{6}&W_4^{9}\\end{bmatrix}=\\begin{bmatrix}1&1&1&1\\\\1&-j&-1&j\\\\1&-1&1&-1\\\\1&j&-1&-j\\end{bmatrix}', tag: '(2)' },
          { t: 'callout', kind: 'tip', title: '看清楚这个矩阵', md: '第 3 行等于第 1 行取负得到的关键是 $W_4^{2}=-1$；第三列第一行的 $W_4^4=1$ 正是周期性。**整个矩阵里只有 1、−1、j、−j 四个不同的值**，也就是连乘法都不需要做，只靠加减和交换实虚部就能算完 4 点 DFT。**FFT 的全部秘密就是把这种"重复"系统化地找出来并复用。**' },
          { t: 'md', md: '更一般地，$W_N^{kn}$ 的值只取决于 $(kn \\bmod N)$，而随着 $k,n$ 遍历，它只有 N 个不同结果。若能安排计算顺序，让每个中间结果都被后续复用，总计算量就能从 $N^2$ 降到 $N\\log_2 N$。' }
        ]
      },
      {
        id: 'dit', num: '2', title: '基 2 时间抽取（DIT）：把大问题拆成两个小问题',
        blocks: [
          { t: 'md', md: '设 $N$ 为偶数。把输入按奇偶下标分成两组：$x_1[r]=x[2r]$（偶）、$x_2[r]=x[2r+1]$（奇），$r=0,\\dots,N/2-1$。代入 DFT 定义：' },
            { t: 'math', tex: 'X[k]=\\sum_{r=0}^{N/2-1}\\!x[2r]W_N^{2rk}+\\sum_{r=0}^{N/2-1}\\!x[2r+1]W_N^{(2r+1)k}=\\underbrace{\\sum_r x_1[r]W_{N/2}^{rk}}_{X_1[k]}+W_N^{k}\\underbrace{\\sum_r x_2[r]W_{N/2}^{rk}}_{X_2[k]}', tag: '(3)' },
          { t: 'md', md: '因为 $W_N^{2rk}=e^{-j2\\pi (2rk)/N}=e^{-j2\\pi rk/(N/2)}=W_{N/2}^{rk}$，所以两个求和恰好是两个 $N/2$ 点 DFT。于是 N 点 DFT 变成：' },
          { t: 'math', tex: '\\begin{cases}X[k]=X_1[k]+W_N^{k}X_2[k], & k=0,\\dots,\\frac{N}{2}-1\\\\[4pt]X[k+\\tfrac{N}{2}]=X_1[k]-W_N^{k}X_2[k]&\\end{cases}\\quad \\text{（用到了 }W_N^{k+N/2}=-W_N^{k}\\text{）}', tag: '(4)' },
          { t: 'md', md: '式 (4) 画成数据流，就是一个**蝶形**：两个输入、一个旋转因子、两次加法。整个 N 点 FFT 就是把这个过程递归做下去：N → N/2 → N/4 → … → 2，共 $\\log_2 N$ 级，每级 $N/2$ 个蝶形。' },
          {
            t: 'fold', summary: '展开：从 N² 降到 N log₂N 的完整递推演算', deriv: true, blocks: [
              { t: 'md', md: '**第一步（一次拆分省多少）**：直接算 N 点 DFT 需要 $N^2$ 次复数乘法。按式 (3) 拆成两个 $N/2$ 点 DFT 后，乘法次数变为 $2\\cdot(N/2)^2=N^2/2$，再加上合成式 (4) 里 $X_2[k]$ 要乘的 $N/2$ 个旋转因子。**一次拆分就把工作量压到约一半。**' },
              { t: 'math', tex: 'C(N)=2\\,C\\!\\left(\\tfrac{N}{2}\\right)+\\tfrac{N}{2},\\qquad C(2)=0', tag: '' },
              { t: 'md', md: '**第二步（一层层展开）**：把上式反复代入自己。设 $N=2^L$，则' },
              { t: 'math', tex: 'C(N)=2\\Bigl[2\\,C\\!\\left(\\tfrac{N}{4}\\right)+\\tfrac{N}{4}\\Bigr]+\\tfrac{N}{2}=4\\,C\\!\\left(\\tfrac{N}{4}\\right)+\\tfrac{N}{2}+\\tfrac{N}{2}=\\cdots=2^{L}C(1)+\\underbrace{\\tfrac{N}{2}+\\tfrac{N}{2}+\\cdots+\\tfrac{N}{2}}_{L\\ \\text{项}}', tag: '' },
              { t: 'md', md: '**第三步（收尾）**：由于 $C(1)=0$（1 点 DFT 就是它自己，无需乘法），且 $L=\\log_2 N$，立刻得到' },
              { t: 'math', tex: 'C(N)=\\tfrac{N}{2}\\log_2 N\\quad\\text{次复数乘法},\\qquad A(N)=N\\log_2 N\\quad\\text{次复数加法}', tag: '' },
              { t: 'md', md: '**第四步（对照直接法）**：加速比' },
              { t: 'math', tex: '\\frac{N^2}{\\tfrac{N}{2}\\log_2 N}=\\frac{2N}{\\log_2 N}\\ \\xrightarrow{\\ N=1024\\ }\\ \\frac{2048}{10}\\approx 205\\ \\text{倍}', tag: '' },
              { t: 'md', md: '**第五步（两个容易被问住的细节）**：① 每一级的 $N/2$ 个旋转因子里，有一半是 $W_N^0=1$ 或对应 $W_N^{N/4}=-j$ 的"平凡值"，真正需要复数乘法的还要再少；这正是很多商用核把乘法压到 $\\tfrac{N}{2}\\log_2 N-\\tfrac{3N}{2}+2$ 的原因。② 递推只有在 **N 是 2 的幂**时才能一路整除到底；若 $N=2^{a}3^{b}5^{c}$，则用混合基（Cooley–Tukey 的一般形式）把每一级拆成 2、3、5 点小 DFT，结论仍是 $O(N\\log N)$，只是常数变大。' },
              { t: 'callout', kind: 'note', title: '这个推导说明了一件事', md: 'FFT 的节省**不来自任何近似**，它只是把 $N^2$ 个旋转因子中大量重复的那些找出来、只算一次并复用。所以 FFT 与 DFT 的输出必然逐位相同（差别仅在浮点加法顺序不同造成的末位舍入）。任何声称"FFT 更快但要牺牲精度"的说法都是错的。' }
            ]
          },
          {
            t: 'widget', render: function (el) {
              const hint = U.h('div.plot-cap', { html: U.md('点击按钮切换高亮级：蓝色为同级直达支路，橙色为乘旋转因子后的交叉支路。**第 s 级的蝶形跨距为 $2^{s}$。**') });
              const box = DSP.ui.plotBox({ title: '8 点基 2 时间抽取 FFT 的蝶形结构' });
              const btns = [];
              const stages = 3;
              ['第 1 级', '第 2 级', '第 3 级', '全部'].forEach((label, i) => {
                btns.push(U.h('button.btn.sm' + (i === 3 ? '' : '.ghost'), {
                  text: label,
                  onclick: function () {
                    DSP.plot.butterfly(box.canvas, { N: 8, stage: (i === 3 ? undefined : i) });
                    btns.forEach(b => b.classList.remove('primary'));
                    btns[i].classList.add('primary');
                  }
                }));
              });
              el.appendChild(U.h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } }, btns));
              el.appendChild(box.el);
              el.appendChild(hint);
              DSP.plot.butterfly(box.canvas, { N: 8 });
            }
          },
          { t: 'callout', kind: 'note', title: '为什么叫"时间抽取"', md: '因为拆分发生在**时域下标**上（按奇、偶把序列一分为二），结果是输出 $X[k]$ 自然地按前后两半分组。与之相对的频率抽取（DIF）是在**频域下标**上拆，$X$ 按奇、偶下标分组，输入则是自然顺序。**两者计算量完全相同，区别只在数据重排方式。**' }
        ]
      },
      {
        id: 'dif', num: '3', title: 'DIF 与位反转重排',
        blocks: [
          { t: 'table', cols: ['对比项', '时间抽取 DIT', '频率抽取 DIF'], rows: [
            ['拆分位置', '时域按奇偶分组', '频域按奇偶分组'],
            ['输入顺序', '需要位反转置换', '自然顺序'],
            ['输出顺序', '自然顺序', '需要位反转置换'],
            ['计算量', '约 (N/2)·log₂N 个蝶形', '完全相同'],
            ['每蝶乘法次数', '交叉支路乘法放在加法之后', '乘法在拆分时完成（可合并）'],
            ['适合场景', '通用；多数库默认实现', '便于某些流水线结构与截断剪枝']
          ] },
          { t: 'md', md: '位反转重排是怎么回事？以 N = 8 为例，原始下标 1（二进制 001）在 FFT 的第一级会被归到"偶数组"、第二级归到"奇组"、第三级再归到"偶组"…… 级数由低位到高位地决定路径，最终位置的下标正好是原下标的二进制位倒过来：001 → 100 = 4。' },
          { t: 'table', cols: ['原下标', '二进制', '位反转二进制', '重排后位置'], rows: [
            ['0', '000', '000', '0'],
            ['1', '001', '100', '4'],
            ['2', '010', '010', '2'],
            ['3', '011', '110', '6'],
            ['4', '100', '001', '1'],
            ['5', '101', '101', '5'],
            ['6', '110', '011', '3'],
            ['7', '111', '111', '7']
          ] },
          { t: 'callout', kind: 'tip', title: '硬件实现时不必真的"搬数据"', md: '在 FPGA/ASIC 里，位反转通常通过改变存储器的读写寻址顺序实现（旋转地址生成），而不是先算完再做一次置换。这一步省下来的是一个完整的存储读写回合，在 GSPS 级流水 FFT 里这就是能不能跑满数据率的关键。' }
        ]
      },
      {
        id: 'cost', num: '4', title: '计算量：N log N 到底省在哪',
        blocks: [
          { t: 'md', md: '基 2 FFT 共 $\\log_2 N$ 级，每级 $N/2$ 个蝶形，每个蝶形 1 次复数乘法 + 2 次复数加法。加上旋转因子的对称性还可把乘法数减半，最终约 $(N/2)\\log_2 N$ 次复乘。' },
          {
            t: 'widget', render: function (el) {
              const rows = [];
              [128, 512, 2048, 8192, 32768].forEach(N => {
                const direct = N * N;
                const fftm = (N / 2) * Math.log2(N);
                const butter = fftm;
                rows.push([N.toLocaleString('en-US'), direct.toLocaleString('en-US'), Math.round(butter).toLocaleString('en-US'), (direct / butter).toFixed(0) + '×']);
              });
              el.appendChild(DSP.ui.table({
                cols: ['N', '直接 DFT 复数乘法', 'FFT 蝶形数（含复乘）', '加速比'],
                rows: rows
              }));
              el.appendChild(U.h('div.plot-cap', { html: U.md('若每次复数乘法按 4 次实数乘法 + 2 次实数加法计，N = 32768 时直接 DFT 需要约 $1.07\\times10^{9}$ 次复数乘加，而在 100 MHz 时钟的处理器上这意味着一次谱分析要花数十秒——**FFT 把它拉回到几毫秒。**') }));
            }
          },
          { t: 'callout', kind: 'eng', title: '工程现实：不是算法复杂度的战斗，是存储的战斗', md: '在真实硬件上，FFT 的瓶颈往往**不是乘法器数量而是存储器带宽**。一次 65536 点 FFT 需要 $16\\times65536$ 个旋转因子或多级中间结果，片内 RAM 装不下就只能走外部 DDR。因此工程上的优化重点是：① 采用**同址（in-place）**运算减少一半缓存；② 采用**块浮点**代替全浮点（每级只维护一个共享指数，省掉逐点归一化）；③ 把旋转因子用查表 + 对称性压缩到 1/4 表项。**理解这三点，你就能读懂任何一款商用 FFT IP 核的手册。**' }
        ]
      },
      {
        id: 'real', num: '5', title: '实序列打包、混合基与非 2 的幂',
        blocks: [
          { t: 'md', md: '**① 实序列打包（两实一复）**：若有两路实信号 $x_1,x_2$（例如 I/Q 或两路水听器），构造 $z[n]=x_1[n]+j\\,x_2[n]$，只做一次 N 点复 FFT 得 $Z[k]$，利用共轭对称性可分离出：' },
          { t: 'math', tex: 'X_1[k]=\\tfrac12\\bigl(Z[k]+Z^*[N-k]\\bigr),\\qquad X_2[k]=\\tfrac{1}{2j}\\bigl(Z[k]-Z^*[N-k]\\bigr)', tag: '(5)' },
          { t: 'md', md: '这一招把两路实 FFT 的计算量压缩到 一次复 FFT，节省近一半硬件。更进一步，单路实序列也可用 N/2 点复 FFT 完成 N 点实 FFT（拆偶奇组合），FFTPACK 与 FFTW 均默认使用。' },
          { t: 'md', md: '② 非 2 的幂怎么办：三种方案——' },
          { t: 'table', cols: ['方案', '做法', '代价', '适合'], rows: [
            ['补零到最近的 2 的幂', '在尾部补 0 到 2^m', '分辨率浪费、可能有边缘效应', '快速原型、对资源不敏感'],
            ['混合基 FFT', 'N 分解为 2^a·3^b·5^c，用 2/3/4/5 点小蝶形组合（Cooley–Tukey 通用形式）', '控制逻辑复杂', 'FFTW 等通用库、任意点数'],
            ['Bluestein / CZT', '把 DFT 化成卷积，用 FFT 加速', '需额外两次 FFT', '需要任意点数或只关注一段窄频带（啁啾 Z 变换）']
          ] },
          { t: 'callout', kind: 'eng', title: '水声里的啁啾 Z 变换（CZT）', md: '当需要在 **1000~1200 Hz 这一段窄带上做 10000 点细分析**时，做整带 32768 点 FFT 太浪费。CZT 可以在任意起始频率、任意频率间隔上计算螺旋采样，用两次 FFT 实现，只花 $O(N\\log N)$。**被动声呐做线谱精细跟踪、倍频程谱分析、Zoom FFT 用的都是它。**' }
        ]
      },
      {
        id: 'impl', num: '6', title: '并行化、流水线与 GSPS 级 FFT',
        blocks: [
          { t: 'md', md: '把 $\\log_2 N$ 级蝶形映射到硬件有两条典型路线：' },
          { t: 'table', cols: ['架构', '结构', '吞吐', '资源', '典型应用'], rows: [
            ['顺序/迭代（in-place）', '一套蝶形单元 + 一块 RAM，逐级回写', '每 N 点需 N·log N 个周期', '最省资源', '低成本 MCU、离线处理'],
            ['流水线（ Streaming）', '每级一组独立的蝶形与旋转因子 ROM，数据像流水一样穿过', '每时钟 1 个样本（理论上无停顿）', '资源 × log N', '雷达脉冲压缩、宽带声呐实时处理'],
            ['并行阵列', '多个 FFT 核并行处理多通道 / 多脉冲', '乘通道数', '最高', '阵列声呐多波束、MIMO 雷达']
          ] },
          { t: 'callout', kind: 'eng', title: 'GSPS 级 FFT 的工程清单', md: '要在 FPGA 上以 1 GSPS 以上速率持续做 4096 点 FFT，实际需要：① 流水线 Streaming 架构（不能停顿）；② 复数位宽通常 16~18 bit 定点，配合块浮点把动态范围撑到 90 dB 以上；③ 数据进出用 AXI-Stream 并配双/多缓冲；④ 旋转因子 ROM 用 quarter-wave 压缩；⑤ 每级的缩放（scaling schedule）必须提前算好，否则一定会在某级溢出而在另一级丢掉有用比特。\n以上每一条都对应一次真实项目中的返工——定点 FFT 90% 的调试时间在量化尺度上，而不在算法结构上。' },
          { t: 'md', md: '另外提一句常被忽略的现实：这些 API（FFTW、MKL、cuFFT、core 库里的基 2 迭代实现）之所以都能"自动最优"，是因为它们内部维护一个预计算的执行计划（plan）：预先决定蝴蝶顺序、旋转因子表、SIMD 宽度、缓存分块。频繁改变 FFT 长度会导致反复生成计划，成为隐藏的性能杀手。固定点数、批量处理是工程上的好习惯。' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区专栏',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 以为 FFT 会改变分析结果', md: '不会。FFT 与 DFT 的输出在数学上完全相同（忽略浮点舍入顺序）。你看到的任何差异，都来自加窗、点数、归一化方式的不同，与"算法"无关。' },
          { t: 'callout', kind: 'pit', title: '② 以为 N 越大总是越好', md: 'N 增大 = 观测时间延长 = 假设信号在这段时间内平稳。对机动目标的回波、对突发的瞬态、对正在扫频的干扰，N 越大反而把能量摊得越平（多普勒徙动），峰值越低。N 的最优值 = 信号平稳时间尺度。这是动目标检测（MTD）里选择 CPI 长度的核心权衡。' },
          { t: 'callout', kind: 'pit', title: '③ 忽略定点量化的累积误差', md: '浮点仿真里完美的结果，搬到定点 DSP 上可能损失 20 dB 以上动态范围。根本原因：每级蝶形都要么右移（丢低位）要么放大（冒溢出风险）。定点化必须在仿真阶段就做 bit-true 建模，不能等到联调。' },
          { t: 'callout', kind: 'pit', title: '④ 只看复乘次数，不看 IO 与内存', md: '现代处理器上 FFT 的瓶颈通常是访存而非运算。一个访存不友好的手写 FFT 可能比朴素实现还慢。先测带宽再优化算法。' },
          { t: 'callout', kind: 'eng', title: '工程提示：如何选择 FFT 点数', md: '把三个约束放在一起取交集：① 频率分辨率要求决定下限 $N\\ge f_s/\\Delta f$；② 信号平稳时间决定上限 $N\\le f_s\\cdot T_{平稳}$；③ 硬件友好的候选值（2 的幂、或 $2^{a}3^{b}5^{c}$）。**三者都能满足的才可用；找不到交集时，说明你的需求本身冲突，需要改波形或改处理方式。**' }
        ]
      }
    ],
    refs: [
      'Cooley & Tukey, "An Algorithm for the Machine Calculation of Complex Fourier Series", Math. Comput., 1965',
      'Oppenheim & Schafer, DTSP, 第 9 章（Computation of the DFT）',
      'Frigo & Johnson, "The Design and Implementation of FFTW3", Proc. IEEE, 2005'
    ]
  });

  /* ---------------- Haar 小波（二分塔式分解 / 重构） ----------------
     a[i] = (x[2i]+x[2i+1])/√2 ， d[i] = (x[2i]−x[2i+1])/√2
     正交变换，完全重构；逆变换由同一对偶式得到（对称关系）。     */
  function haarDwt(x, level) {
    let a = Float64Array.from(x), det = [];
    for (let l = 0; l < level; l++) {
      const m = a.length >> 1;
      const na = new Float64Array(m), nd = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        na[i] = (a[2 * i] + a[2 * i + 1]) / Math.SQRT2;
        nd[i] = (a[2 * i] - a[2 * i + 1]) / Math.SQRT2;
      }
      det.push(nd); a = na;
    }
    return { a: a, d: det };
  }
  function haarIdwt(a, det) {
    let cur = Float64Array.from(a);
    for (let l = det.length - 1; l >= 0; l--) {
      const d = det[l], m = d.length, nx = new Float64Array(m * 2);
      for (let i = 0; i < m; i++) {
        nx[2 * i] = (cur[i] + d[i]) / Math.SQRT2;
        nx[2 * i + 1] = (cur[i] - d[i]) / Math.SQRT2;
      }
      cur = nx;
    }
    return cur;
  }

  /* ============================================================
     5. STFT 短时傅里叶变换
     ============================================================= */
  doc.register('theory/transform/stft', {
    title: 'STFT 短时傅里叶变换',
    lede: 'DFT 把整段信号揉成一个频谱，于是"什么时候发生"这个信息彻底丢了。STFT 的方案简单粗暴：给信号套一个滑动的窗，逐帧做 DFT，把频谱铺成一张时间–频率图。',
    tags: ['核心变换', 'STFT', '时频分析', '不确定原理', '谱图'],
    toc: true,
    labs: [{ path: 'lab/stft', title: 'STFT 时频分辨率权衡实验台', desc: '拖动窗长，实时看到时间分辨率与频率分辨率此消彼长的整个过程' }],
    sections: [
      {
        id: 'why', num: '1', title: 'DFT 到底丢了什么',
        blocks: [
          { t: 'md', md: '考虑两段完全不同的信号：(a) 一个 1000 Hz 的正弦持续 1 秒；(b) 一个 1000 Hz 的正弦只在 0.4~0.6 秒出现。它们的差别显而易见——但如果你只对整段做一次 DFT，两者在 $k=1000$ 处的幅度几乎一样，**差别只体现在相位上，而相位几乎没人看**。' },
          { t: 'callout', kind: 'note', title: '问题本质', md: 'DFT 的基底 $e^{j2\\pi kn/N}$ 定义在**整个观测区间**上，天然假设信号在这段时间内是平稳的、重复的。一旦信号的时间结构重要（目标什么时候出现、转速什么时候变化、干扰什么时候扫过来），单一频谱就不够用。**必须给频谱装一根时间轴。**' },
          { t: 'md', md: '更麻烦的是：DFT 甚至分不清"先低频后高频"和"先高频后低频"两种 chirp（时间反演），因为它们的能量分布完全相同，只是时频面的排布相反。信息没有丢，它被折叠到相位里去了——而相位恰恰是最难用、最敏感的信息。' }
        ]
      },
      {
        id: 'def', num: '2', title: '定义：加窗、分段、逐帧做 DFT',
        blocks: [
          { t: 'math', tex: 'X[m,k]=\\sum_{n=0}^{M-1} x[n+mH]\\,w[n]\\,e^{-j\\frac{2\\pi}{N}kn},\\qquad m=0,1,\\dots,\\ \\ k=0,1,\\dots,N-1', tag: '(1)' },
          { t: 'kv', title: '三个参数的物理含义', pairs: [
            ['w[n]', '分析窗，长度 M。它决定这一帧看多久，也决定每一根谱线的宽度'],
            ['H', '帧移（hop），相邻两帧起点相隔的样本数。H 越小，时间轴越密，冗余越大'],
            ['N', 'FFT 点数，通常 N ≥ M（不足的部分补零）。它只影响频域插值密度，不影响分辨率'],
            ['m', '帧序号，对应时间 t_m = (mH + M/2)/fs']
          ] },
          { t: 'callout', kind: 'tip', title: '一句话理解 STFT 在做什么', md: '**用同一个带通滤波器组的输出，逐时刻采样。**每一帧的 DFT 相当于一组中心频率为 $kf_s/N$ 的窄带滤波器；沿帧推进，就得到每个滤波器的输出随时间变化的包络。所以谱图（spectrogram）的本质是**滤波器组 + 检波 + 时间采样**。' },
          { t: 'md', md: '工程上谱图通常取幅度平方并转成 dB 显示：$S[m,k]=20\\log_{10}|X[m,k]|$。动态范围一般开 60~90 dB。**这个动态范围的设置是有讲究的**：开太大，噪声底占据整个画面；开太小，弱目标调制谱线看不见。' }
        ]
      },
      {
        id: 'uncert', num: '3', title: '不确定原理：为什么两个分辨率不能同时好',
        blocks: [
          { t: 'md', md: '这是 STFT 全部选择的理论天花板。设窗函数 $w(t)$ 的能量归一化到 1，定义它的时间展宽与频率展宽为标准差：' },
          { t: 'math', tex: '\\Delta t^2=\\int (t-t_0)^2|w(t)|^2dt,\\qquad \\Delta f^2=\\frac{1}{(2\\pi)^2}\\int (\\omega-\\omega_0)^2|W(\\omega)|^2\\frac{d\\omega}{2\\pi}', tag: '(2)' },
          { t: 'math', tex: '\\boxed{\\;\\Delta t\\cdot\\Delta f\\ \\ge\\ \\frac{1}{4\\pi}\\approx 0.0796\\;}', tag: '(3)' },
          { t: 'callout', kind: 'warn', title: '这不是算法的缺陷，是数学的硬约束', md: '不确定原理不是"我们的窗设计得不好"，而是傅里叶变换的基本性质：任何有限持续的现象都不可能有唯一的频率，任何单一频率的现象都必须持续无限长时间。所有窗函数、所有时频分析方法（包括后面即将讲的小波、包括 Wigner-Ville）都在这条约束下运行。差别只在于它们把这份"不可兼得"分配到了不同的地方。' },
          {
            t: 'fold', summary: '展开：Δt·Δf ≥ 1/(4π) 的完整推导', deriv: true, blocks: [
              { t: 'md', md: '**第一步（归一化与中心化）**：不失一般性，取 $\\int|w|^2dt=1$，$\\int t|w|^2dt=0$，$\\int \\omega|W|^2\\frac{d\\omega}{2\\pi}=0$，于是 $\\Delta t^2=\\int t^2|w|^2dt$，$\\Delta\\omega^2=\\int\\omega^2|W|^2\\frac{d\\omega}{2\\pi}$。' },
              { t: 'md', md: '**第二步（把频率展宽换成导数）**：由导数性质 $\\mathcal\\{F\\}\\{w^{\\prime}\\}=j\\omega W(\\omega)$ 与 Parseval 定理，$\\Delta\\omega^2=\\int\\omega^2|W|^2\\frac{d\\omega}{2\\pi}=\\int|w^{\\prime}(t)|^2dt$。' },
              { t: 'md', md: '**第三步（柯西–施瓦茨不等式）**：把两个积分看成内积，$\\Delta t^2\\cdot\\Delta\\omega^2=\\Big(\\int|t\\,w|^2dt\\Big)\\Big(\\int|w^{\\prime}|^2dt\\Big)\\ \\ge\\ \\Big|\\int t\\,w^*(t)\\,w^{\\prime}(t)\\,dt\\Big|^2$。' },
              { t: 'md', md: '**第四步（算右边的实部）**：注意 $2\\,\\mathrm{Re}\\{w^*w^{\\prime}\\}=\\frac{d}{dt}|w|^2$，分部积分得 $2\\,\\mathrm{Re}\\int t\\,w^*w^{\\prime}\\,dt=\\int t\\frac{d}{dt}|w|^2dt=\\Big[t|w|^2\\Big]_{-\\infty}^{+\\infty}-\\int|w|^2dt=0-1=-1$。边界项因 $w$ 能量有限（衰减足够快）而为零。' },
              { t: 'md', md: '**第五步（得证）**：既然实部等于 $-1/2$，其模必不小于 $1/2$。代入第三步得 $\\Delta t\\cdot\\Delta\\omega\\ge 1/2$。再用 $\\omega=2\\pi f$ 换算，即 $\\Delta t\\cdot\\Delta f\\ge\\dfrac{1}{4\\pi}$。' },
              { t: 'md', md: '**等号什么时候成立？**柯西–施瓦茨要求 $w^{\\prime}(t)\\propto t\\,w(t)$，解这个微分方程得 $w(t)\\propto e^{-t^2/(2\\sigma^2)}$，即**高斯窗**。所以高斯窗是唯一在不确定原理意义下达标的窗；这也解释了为什么 Gabor 变换（高斯窗 STFT）在时频分析里地位特别。' }
            ]
          }
        ]
      },
      {
        id: 'res', num: '4', title: '两个分辨率的数目焦虑：M、N、H 怎么定',
        blocks: [
          { t: 'md', md: '把理论写成可以直接查表的公式。设窗长 $M$ 个样本、采样率 $f_s$、FFT 点数 $N$：' },
          { t: 'table', cols: ['量', '公式', '说明'], rows: [
            ['窗时长', 'Tw = M/fs', '这就是时间分辨率：两个事件至少相隔这么久才能在图上分开'],
            ['频率分辨率', 'Δf ≈ fs/M（精确值还要乘窗的主瓣宽度系数，矩形 1、汉宁 2）', '由窗长而非 FFT 点数 N 决定'],
            ['二者乘积', 'Δt·Δf ≈ 1（用宽度口径）或 ≥ 1/4π（用标准差口径）', '两种口径数值不同，不要混着比较'],
            ['帧间隔', 'Δt_frame = H/fs', '只影响时间轴的采样密度，不影响分辨率'],
            ['重叠率', 'r = 1 − H/M', '常用 50%、75%'],
            ['帧数', 'N_f = ⌊(L−M)/H⌋ + 1', 'L 为总样本数']
          ] },
          { t: 'callout', kind: 'note', title: '为什么 N 不能提高分辨率而是 M 才行', md: '把 $N$ 从 $M$ 增到 $8M$（即帧内补零）只是让频谱曲线插值变密，**主瓣宽度仍是 $f_s/M$**。这与「补零不提高分辨率」是同一结论。想真正看细频率轴，必须**加长窗 $M$**，代价是时间糊掉。这张表里的每一个等号都能反复用。' },
          { t: 'callout', kind: 'eng', title: '重叠率为什么几乎总是 50% 以上', md: '原因有两条：① 加窗后帧两端的样本被窗压到接近 0，重叠可以避免"信息掉进窗的脚趾里"；② 若后面要用谱图做逆变换合成，重叠是满足合成条件的必要条件。工程默认：汉宁窗配 50% 重叠（恰好满足 COLA）；做瞬态检测时可提到 75%。' }
        ]
      },
      {
        id: 'viz', num: '5', title: '亲眼看看：同一个信号，两种窗长',
        blocks: [
          { t: 'md', md: '构造一段同时含有稳态单频、线性扫频和瞬态脉冲的信号，分别用短窗（时间分辨率好）和长窗（频率分辨率好）做 STFT。请特别注意：短窗下两根靠得很近的频率会糊成一条，长窗下瞬态脉冲会被拉成一条横跨时间的横杠。' },
          {
            t: 'widget', render: function (el) {
              const fs = 4000, L = 2048;
              const base = new Float64Array(L);
              const cw = C.multisin(L, fs, [{ freq: 500, amp: 0.55 }, { freq: 560, amp: 0.55 }]);
              const lfm = C.chirp(L, fs, 1100, 1700, L / fs);
              const g = C.gaussPulse(L, fs, 1500, 900, 0.32);
              for (let i = 0; i < L; i++) {
                const env = Math.exp(-Math.pow((i / fs - 0.32) * 55, 2));
                base[i] = cw[i] + 0.5 * env * lfm[i] + 1.5 * g[i];
              }
              const draw = function (winLen, hopDiv, title, box) {
                const T = C.stft(base, { winLen: winLen, hop: Math.max(1, Math.round(winLen / hopDiv)), win: 'hann', nfft: 512, fs: fs });
                const grid = new Float32Array(T.frames * T.bins);
                for (let m = 0; m < T.frames; m++) {
                  for (let k = 0; k < T.bins; k++) grid[m * T.bins + k] = T.S[m * T.bins + k];
                }
                DSP.plot.heatmap(box.canvas, {
                  data: grid, cols: T.frames, rows: T.bins, height: 260,
                  xlim: [T.t[0], T.t[T.frames - 1]], ylim: [0, fs / 2],
                  flipY: true, xlabel: 't / s', ylabel: 'f / Hz', title: title,
                  vmin: -55, vmax: -5
                });
              };
              const wrap = U.h('div.grid.g2');
              const b1 = DSP.ui.plotBox({});
              const b2 = DSP.ui.plotBox({});
              wrap.appendChild(b1.el); wrap.appendChild(b2.el);
              el.appendChild(wrap);
              draw(64, 4, '短窗 M=64：时间清清楚楚，两根 500/560 Hz 却糊成一片', b1);
              draw(512, 4, '长窗 M=512：500 与 560 Hz 分开了，但瞬态被抹成横杠', b2);
              el.appendChild(U.h('div.plot-cap', { html: U.md('两张图由本软件核心库的 STFT 实时计算（$f_s=4$ kHz、汉宁窗、512 点 FFT、重叠 75%）。**短窗 $M=64$ 的频率分辨率 $f_s/M\\approx62$ Hz，两根相差 60 Hz 的谱线注定分不开；长窗 $M=512$ 分辨率约 7.8 Hz 可以分开，代价是时间轴上的每个模糊块长达 128 ms。**') }));
            }
          }
        ]
      },
      {
        id: 'ridge', num: '6', title: '脊线提取：把图变成可用的数字',
        blocks: [
          { t: 'md', md: '谱图画出来以后，接下来通常要在图上做定量提取。最常见的任务是脊线（ridge）提取：在每一帧上找到能量最大的频率，连成一条曲线，这就是瞬时频率随时间的变化。' },
          { t: 'flow', items: [
            { t: '预处理', kind: 'io', d: '去趋势、去均值、必要时做带通，把干扰压到脊线之下' },
            { t: '计算 STFT', kind: 'dsp', d: '选窗长与重叠率，得到 X[m,k]' },
            { t: '逐帧寻峰', kind: 'dsp', d: 'k̂[m] = argmax|X[m,k]|，可加抛物线插值提升精度' },
            { t: '脊线连接', kind: 'dsp', d: '施加连续性约束（相邻帧频率跳变不超过阈值），剔除野值' },
            { t: '拟合 / 输出', kind: 'out', d: '对脊线做直线拟合得到调频斜率，或直接输出作为特征' }
          ] },
          { t: 'callout', kind: 'eng', title: '声呐里的经典应用：螺旋桨调制谱（DEMON）', md: '船舶噪声的包络谱上会出现轴频与叶频（叶片数 × 轴频）的线族。做法是：先对较高频段的噪声做带通，取希尔伯特包络，再对包络做 STFT 得到 DEMON 谱图。从这张图上量出叶频，除以轴频，就得到叶片数——这是目标识别里最硬的一个特征。它的可靠性直接取决于 STFT 的频率分辨率能否容纳足够长的积分时间。' }
        ]
      },
      {
        id: 'ola', num: '7', title: '合成与逆变换：COLA 条件',
        blocks: [
          { t: 'md', md: 'STFT 不仅能分析，还能反过来合成信号：把每帧的频谱做 IFFT 得到帧信号，再乘同样的窗、按重叠相加（OLA）的方式加回到原位置，得到：' },
          { t: 'math', tex: '\\hat x[n]=\\sum_m w[n-mH]\\cdot\\frac{1}{N}\\sum_k X[m,k]e^{j2\\pi kn/N}\\quad\\Longrightarrow\\quad \\hat x[n]=x[n]\\cdot\\underbrace{\\sum_m w[n-mH]}_{\\text{必须等于常数}}', tag: '(4)' },
          { t: 'md', md: '由此可见，完美重建的条件是叠加起来处处平滑：' },
          { t: 'math', tex: '\\sum_{m=-\\infty}^{\\infty} w[n-mH]\\equiv C\\ \\ (\\neq 0)\\qquad\\text{—— COLA（Constant Overlap-Add）条件}', tag: '(5)' },
          { t: 'table', cols: ['窗', '满足 COLA 的重叠率', '备注'], rows: [
            ['矩形窗', '任意 H = M（0% 重叠）即满足；也可 H = M/2', '无重叠时就是简单分段'],
            ['汉宁窗', '50%（H = M/2）或 75%（H = M/4）', '最常用的一组配置'],
            ['汉明窗', '近似满足 50%（有约 1% 波纹）', '对精度要求高时需自定义窗'],
            ['一般窗', '需按 H 专门设计（如对汉宁窗开平方根）', '见 Griffin-Lim 迭代重建算法']
          ] },
          { t: 'callout', kind: 'warn', title: '分析与修改不能混为一谈', md: '一旦你**修改了**谱图（例如做时频域滤波、降噪、vocoder），逆 STFT 就不再可能精确重建了——因为修改后的 $X[m,k]$ 一般不再是任何一个真实信号的合法 STFT。工程上用 Griffin-Lim 之类的迭代算法逼近：它迭代地投影纠相位，而相位不可分辨造成的模糊在原理上无法完全消除，只能在感知层面接受。**这也是为什么相位重建一直是语音增强里的核心难题。**' }
        ]
      },
      {
        id: 'app', num: '8', title: '工程应用与典型参数',
        blocks: [
          { t: 'table', cols: ['场景', '信号特点', 'STFT 设置要点'], rows: [
            ['被动声呐 LOFAR 谱图', '宽带稳态谱 + 慢变线谱', '长窗（1~4 s）提高频率分辨率，重叠 50%~75%，显示动态范围约 70 dB'],
            ['水声目标瞬态捕捉', '极短、宽带、单次', '短窗（几毫秒到几十毫秒），高重叠，主要看能量在时间上的分布'],
            ['雷达微多普勒', '旋翼/螺旋桨引起的周期性微动调制（几十到几百 Hz）', '中长窗 + 高重叠；窗长需覆盖至少一个微动周期'],
            ['振动 / 齿轮故障诊断', '转速相关的阶次线（随转速整体移动）', '普通 STFT 会因转速变化而拖尾，常需做阶次跟踪重采样后再 STFT'],
            ['语音识别前端', '慢变共振峰', '20~30 ms 窗、10 ms 帧移，Mel 滤波器组 + 对数能量']
          ] },
          { t: 'callout', kind: 'eng', title: '微多普勒：为什么差一点就看不到旋翼叶数', md: '直升机旋翼回波的微多普勒谱图上，叶片闪频约为每秒几十次的周期性调制。如果 STFT 窗长小于一个闪频周期，图上只剩一片模糊；若窗长 大于一个周期太多，叶片扫过造成的瞬时冲击又被平均掉了。经验规则：窗长取调制周期的 1~3 倍，并把脊线上的周期性起伏做一次 FFT（所谓"二次傅里叶"），才能既数出叶片数又测出转速。' }
        ]
      },
      {
        id: 'pit', num: '9', title: '误区专栏',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 以为换更长的 FFT（加大 N）能提高频率分辨率', md: '不能。$\\Delta f\\approx f_s/M$ 只由窗长决定。**加大 N 只是频域插值**，画出来的曲线更光滑，但两根谱峰之间依然是糊在一起的。' },
          { t: 'callout', kind: 'pit', title: '② 以为 STFT 能同时给出精确的时间和频率', md: '不能。这是不确定原理的直接结论，任何窗函数、任何改进的 STFT 变体都不例外。宣称"同时高时间高频率分辨率"的算法，一定是在别处付了代价（比如小波牺牲低频的时间分辨率，或 Wigner-Ville 引入交叉项）。' },
          { t: 'callout', kind: 'pit', title: '③ 忽略窗之间的重叠，导致信息丢失', md: '加窗后帧两端权重接近 0，若重叠率过低，这两端的样本信息实际上被丢弃了。在 50% 重叠下，每一时刻的样本至少有一次接近窗中心的"高权重机会"，这才保证谱图在时间上是连续的。' },
          { t: 'callout', kind: 'pit', title: '④ 把谱图上的颜色当成绝对能量', md: '谱图的颜色取决于归一化方式、窗的能量、dB 下限与色标范围。同一段数据用不同的软件画，颜色深浅可能完全不同。做定量比较前必须统一到功率谱密度并标明归一化。' },
          { t: 'callout', kind: 'eng', title: '工程提示：先算帧数再算窗长', md: '实际项目中往往是"总时长固定，要求谱图有 K 帧"反过来倒推参数：先按需求定时间分辨率（即窗长），再由可视化/存储预算定帧数（即 hop），最后把两者凑到硬件友好的数上去。反过来先定 FFT 点数的习惯会导致做出一大堆既糊又占内存的谱图。' }
        ]
      }
    ],
    refs: [
      'Allen & Rabiner, "A Unified Approach to Short-Time Fourier Analysis and Synthesis", Proc. IEEE, 1977',
      'Cohen, Time-Frequency Analysis（时频分析的标准参考）',
      'Griffin & Lim, "Signal Estimation from Modified Short-Time Fourier Transform", IEEE T-ASSP, 1984'
    ]
  });

  /* ============================================================
     6. 小波变换
     ============================================================= */
  doc.register('theory/transform/wavelet', {
    title: '小波变换',
    lede: 'STFT 的窗是死的一把尺子；小波的思路是把这把尺子做成可伸缩的——高频自动用窄窗（时间看得细），低频自动用宽窗（频率看得细），从而让瞬态和慢变在同一个图上都能看清。',
    tags: ['核心变换', '小波', 'CWT', 'DWT', '多分辨率', '去噪'],
    toc: true,
    sections: [
      {
        id: 'why', num: '1', title: '为什么 STFT 不够：一把尺子量不了所有尺度',
        blocks: [
          { t: 'md', md: '回到 STFT 的核心矛盾：窗长 $M$ 一旦选定，**所有频率的时间分辨率就都被锁死为 $M/f_s$，频率分辨率都被锁死为 $f_s/M$**。这在很多真实场景里是不合理的。' },
          { t: 'table', cols: ['场景', '你真正需要什么', 'STFT 能提供什么'], rows: [
            ['一个 3 ms 的宽带瞬态叠加在 50 s 的慢变背景上', '瞬态要看清是哪一毫秒；慢变要分清 0.1 Hz 的差别', '一组统一的分辨率，两者必然有一个被牺牲'],
            ['水声目标的弹性散射（回波里有多个尺度结构）', '不同到达时间的子结构需要不同尺度的时间精度', '做不到；只能选一个折中窗'],
            ['齿轮点蚀、轴承外圈损伤的冲击串', '冲击持续 0.1 ms，但整段要用几秒的统计', '短窗看不见低频共振，长窗看不到单次冲击']
          ] },
          { t: 'callout', kind: 'note', title: '一句话动机', md: '**信号里如果有跨越多个时间尺度的结构，就应该用一把能伸缩的尺子去量它。**小波就是这把伸缩尺：它把 STFT 的固定窗 $w(t-\\tau)$ 换成家族群 $\\dfrac{1}{\\sqrt{a}}\\psi\\!\\left(\\dfrac{t-\\tau}{a}\\right)$，其中尺度参数 $a$ 就是尺子的长度。' },
          { t: 'md', md: '由此得到的最重要性质是**恒 Q（恒定品质因数）分析**：每个尺度的滤波器相对带宽 $\\Delta f/f_c$ 保持不变。这与听觉的频率分辨率特性一致（人耳在低频分辨 Hz 级、在高频分辨几十 Hz 级），这也是小波在音频、语音、振动诊断里天然好用的原因。' }
        ]
      },
      {
        id: 'cwt', num: '2', title: 'CWT：定义、尺度与频率的换算',
        blocks: [
          { t: 'math', tex: 'W_x(a,\\tau)=\\frac{1}{\\sqrt{a}}\\int_{-\\infty}^{\\infty} x(t)\\,\\psi^*\\!\\left(\\frac{t-\\tau}{a}\\right)dt,\\qquad a>0,\\ \\tau\\in\\mathbb{R}', tag: '(1)' },
          { t: 'kv', title: '参数说明', pairs: [
            ['ψ(t)', '**母小波**（mother wavelet），必须满足容许性条件 $C_\\psi=\\int_0^\\infty\\frac{|\\Psi(f)|^2}{f}df<\\infty$'],
            ['a', '尺度：a 大 → 波形被拉宽 → 对应低频；a 小 → 波形被压缩 → 对应高频'],
            ['τ', '平移：看哪个时刻'],
            ['1/√a', '能量归一化因子，保证不同尺度下小波的能量相同，便于比较']
          ] },
          { t: 'callout', kind: 'warn', title: '容许性条件的物理含义', md: '$C_\\psi<\\infty$ 要求在 $f\\to0$ 时 $|\\Psi(f)|^2/f$ 可积，最直接的结果是 $\\Psi(0)=\\int\\psi(t)dt=0$。**即母小波必须均值为零，必须"有正有负"（振荡）。**这就是为什么 Mexican hat 长得像二阶导数、Morlet 长得像一段正弦。**一个恒正的函数（如高斯函数本身）永远不能做母小波**——它做的是一个低通平滑，不是带通分析。' },
          { t: 'md', md: '**尺度如何换算成频率？**设母小波的"中心频率"为 $f_c$（定义为其幅频特性 $|\\Psi(f)|$ 峰值对应的归一化频率），则尺度 $a$ 对应的伪频率为：' },
          { t: 'math', tex: 'f\\;=\\;\\frac{f_c}{a\\,\\Delta t},\\qquad \\text{其中 }\\Delta t=1/f_s\\ \\text{为采样间隔}', tag: '(2)' },
          {
            t: 'widget', render: function (el) {
              const M = 256;
              const t = U.linspace(-4, 4, M);
              const morlet = new Float64Array(M), mex = new Float64Array(M), haar = new Float64Array(M);
              for (let i = 0; i < M; i++) {
                const x = t[i];
                morlet[i] = Math.exp(-x * x / 2) * Math.cos(5 * x);
                mex[i] = (1 - x * x) * Math.exp(-x * x / 2);
                haar[i] = (x >= 0 && x < 0.5) ? 1 : ((x >= 0.5 && x < 1) ? -1 : 0);
              }
              const wrap = U.h('div.grid.g2');
              const b1 = DSP.ui.plotBox({ title: '三种常用母小波的时域波形（虚部略）' });
              const p1 = DSP.plot.new(b1.canvas, { height: 240, xlabel: 't', ylabel: 'ψ(t)', legend: true, legendPos: 'tr' });
              p1.add({ x: t, y: morlet, type: 'line', color: 0, width: 1.6, label: 'Morlet（高斯窗正弦）' })
                .add({ x: t, y: mex, type: 'line', color: 2, width: 1.6, label: 'Mexican hat（高斯二阶导）' })
                .add({ x: t, y: haar, type: 'step', color: 3, width: 1.6, label: 'Haar（矩形差分）' })
                .draw();
              wrap.appendChild(b1.el);
              const b2 = DSP.ui.plotBox({ title: '对应的幅频特性：都是带通，且在 f=0 处为零' });
              const p2 = DSP.plot.new(b2.canvas, { height: 240, xlabel: '归一化频率', ylabel: '归一化幅度', legend: true, legendPos: 'tr' });
              const NF = 512;
              [['Morlet', morlet, 0], ['Mexican hat', mex, 2], ['Haar', haar, 3]].forEach(function (wv) {
                const padded = new Float64Array(NF);
                const off = Math.floor((NF - M) / 2);
                for (let i = 0; i < M; i++) padded[off + i] = wv[1][i];
                const mg = C.mag(C.fft(padded, NF));
                const half = Math.floor(NF / 2) + 1;
                let mx = 0;
                for (let i = 0; i < half; i++) if (mg[i] > mx) mx = mg[i];
                const y = new Float64Array(half);
                for (let i = 0; i < half; i++) y[i] = mg[i] / mx;
                p2.add({ x: U.linspace(0, 0.5, half), y: y, color: wv[2], width: 1.5, label: wv[0] });
              });
              p2.draw();
              wrap.appendChild(b2.el);
              el.appendChild(wrap);
              el.appendChild(U.h('div.plot-cap', { html: U.md('三条幅频曲线在 $f=0$ 处都为零（**母小波必须是带通**），峰值位置各不相同，且形状差异决定了它们的用途：Morlet 频率定位最好，适合提取波形结构；Mexican hat 是二阶微分器，擅长找极值点；Haar 支撑最短，擅长捕捉阶跃突变。') }));
            }
          },
          { t: 'md', md: 'CWT 的缺点是**高度冗余**：尺度轴和平移轴都是连续采样，$N$ 点信号会产生远多于 $N$ 个小波系数。解决办法是把 $(a,\\tau)$ 也离散化，并且取**二进栅格** $a=2^j$、$\\tau=k\\cdot 2^j$，这就过渡到了下一节的离散小波变换。' }
        ]
      },
      {
        id: 'dwt', num: '3', title: 'DWT 与多分辨率分析：Mallat 塔式分解',
        blocks: [
          { t: 'md', md: '离散小波变换（DWT）用一组滤波器实现：低通 + 高通 → 各自下采样 2 倍，一层一层做下去。这就是 Mallat 提出的塔式（多分辨率）分解算法。' },
          { t: 'flow', items: [
            { t: '输入 x[n]', kind: 'io', d: '长度 N' },
            { t: '低通 g + ↓2', kind: 'dsp', d: '得到近似系数 a₁（粗略轮廓，长度 N/2）' },
            { t: '高通 h + ↓2', kind: 'dsp', d: '得到细节系数 d₁（细部差异，长度 N/2）' },
            { t: '对 a₁ 重复', kind: 'dsp', d: '得到 a₂, d₂，尺度再翻倍' },
            { t: '输出', kind: 'out', d: 'aJ 加 dJ, dJ-1, …, d1，总长度仍为 N（无冗余）' }
          ] },
          { t: 'md', md: '每下一层，等效的分析带宽减半、中心频率减半（按倍频程递减），而时间窗长度加倍——这正是不确定原理允许的最节省的分配方式：它具有恒定的相对带宽（恒 Q），构成一个倍频程滤波器组。' },
          { t: 'math', tex: 'a_j[k]=\\sum_n g[n-2k]\\,a_{j-1}[n],\\qquad d_j[k]=\\sum_n h[n-2k]\\,a_{j-1}[n],\\qquad h[n]=(-1)^n g[1-n]', tag: '(3)' },
          { t: 'callout', kind: 'tip', title: '为什么高通可以由低通翻转得到', md: '式 (3) 的 $h[n]=(-1)^n g[1-n]$ 称为**正交镜像滤波器（QMF）关系**。它保证高通恰好是低通在频域上的补，两路下采样后既不重叠也不遗漏地覆盖整个频带。**这是正交小波可以完全重构的关键**，也是工程师自己设计小波滤波器时必须满足的约束。' },
          {
            t: 'fold', summary: '展开：QMF 关系如何保证完全重构（两级滤波器组的代数证明）', deriv: true, blocks: [
              { t: 'md', md: '**第一步（写出 Z 域的两路分解）**：分解端是"滤波 + 下采样 2"，其 Z 变换为' },
              { t: 'math', tex: 'A(z)=\\tfrac12\\bigl[G(z^{1/2})X(z^{1/2})+G(-z^{1/2})X(-z^{1/2})\\bigr]', tag: '' },
              { t: 'md', md: '其中出现了 $X(z^{1/2})$ 与 $X(-z^{1/2})$ 两项——**这正是"下采样必然带来混叠"的代数表现**，也是整个证明要处理的唯一麻烦。对细节路 $D(z)$ 有完全相同的形式，只需把 $G$ 换成 $H$。' },
              { t: 'md', md: '**第二步（写出上采样后的重建）**：重建端是"上采样 2 + 滤波"再相加，于是' },
              { t: 'math', tex: '\\hat{X}(z)=\\underbrace{\\tfrac12\\bigl[G(z)H_0(z)+H(z)K_0(z)\\bigr]}_{\\text{有用项}\\ T(z)}X(z)\\;+\\;\\underbrace{\\tfrac12\\bigl[G(-z)H_0(z)+H(-z)K_0(z)\\bigr]}_{\\text{混叠项}\\ A(z)}X(-z)', tag: '' },
              { t: 'md', md: '要完全重构，必须让**混叠项恒等于零**、**有用项等于一个纯延迟 $z^{-d}$**。' },
              { t: 'md', md: '**第三步（用 QMF 关系消掉混叠）**：把 $h[n]=(-1)^n g[1-n]$ 转到 Z 域。$(-1)^n$ 对应 $z\\to -z$，时间反转加平移对应 $z^{-1}$ 与一次移位，于是' },
              { t: 'math', tex: 'H(z)=-\\,z^{-1}G(-z^{-1})', tag: '' },
              { t: 'md', md: '再取重建滤波器 $H_0(z)=G(z^{-1})$、$K_0(z)=H(z^{-1})$（即用分解滤波器的时间反转做重建）。代入混叠项：' },
              { t: 'math', tex: 'A(z)=\\tfrac12\\bigl[G(-z)G(z^{-1})+H(-z)H(z^{-1})\\bigr]=\\tfrac12\\bigl[G(-z)G(z^{-1})+z\\,G(z^{-1})\\cdot(-z^{-1})G(-z)\\bigr]=0', tag: '' },
              { t: 'md', md: '**混叠项精确抵消**——两路各自引入的混叠在求和时互为相反数。这正是"正交镜像"这个名字的含义：高通是低通关于 $\\pi/2$ 的镜像，二者叠加后混叠刚好对消。' },
              { t: 'md', md: '**第四步（再让有用项成为纯延迟）**：代回 $T(z)$ 并要求归一化' },
              { t: 'math', tex: 'T(z)=\\tfrac12\\bigl[G(z)G(z^{-1})+H(z)H(z^{-1})\\bigr]=z^{-d}\\quad\\Longleftrightarrow\\quad |G(e^{j\\omega})|^2+|G(e^{j(\\omega+\\pi)})|^2=2', tag: '' },
              { t: 'md', md: '这就是**功率互补条件**。把它写成时域形式就是 $\\sum_n g[n]g[n-2k]=\\delta[k]$——**同一个低通滤波器的偶数位移自相关必须是单位冲激**。Haar 的 $g=\\tfrac{1}{\\sqrt2}[1,1]$ 显然满足；db4、Symlet 等更长的小波，其系数就是靠解这个约束方程（再加上若干阶消失矩约束）设计出来的。' },
              { t: 'callout', kind: 'note', title: '这个证明解释了三件事', md: '① 为什么小波滤波器的系数看起来"毫无规律"——它们不是窗函数，而是**一组非线性约束方程的数值解**；② 为什么不能随便拿一个 FIR 低通当小波——不满足功率互补就无法完全重构，去噪后的信号会有系统性失真；③ 为什么双正交小波（如 CDF 9/7，JPEG 2000 用）要放宽正交性——换取线性相位，代价是分析与综合用两套不同的滤波器。' }
            ]
          },
          {
            t: 'widget', render: function (el) {
              const N = 256, fs = 1;
              const sig = new Float64Array(N);
              for (let i = 0; i < N; i++) sig[i] = Math.sin(2 * Math.PI * 3 * i / N) + 0.4 * Math.sin(2 * Math.PI * 26 * i / N);
              if (N > 150) for (let i = 150; i < 158; i++) sig[i] += 1.8;      // 一个短促冲击
              const R = haarDwt(sig, 3);
              const wrap = U.h('div.grid.g2');
              const mk = function (arr, title, color) {
                const box = DSP.ui.plotBox({ title: title });
                const p = DSP.plot.new(box.canvas, { height: 175, xlabel: 'k', ylabel: '系数', legend: false });
                const xA = new Float64Array(arr.length);
                for (let i = 0; i < arr.length; i++) xA[i] = i;
                p.add({ x: xA, y: arr, type: 'stem', color: color, width: 1.4, size: 2.6 }).draw();
                wrap.appendChild(box.el);
              };
              mk(sig, '原始信号（含一次短冲击）', 0);
              mk(R.d[0], 'd1 第 1 层细节（最高频）', 3);
              mk(R.d[1], 'd2 第 2 层细节（中频）', 2);
              mk(R.a, 'a3 第 3 层近似（低频轮廓）', 1);
              el.appendChild(wrap);
              el.appendChild(U.h('div.plot-cap', { html: U.md('用正交 Haar 小波做三层塔式分解。注意 d1 图上对应位置的尖 spike：短冲击的能量集中在最细的尺度上，而在 a3（低频轮廓）里几乎看不见它。这就是多分辨率的全部价值：不同尺度的结构自动落到不同的层上去。') }));
            }
          }
        ]
      },
      {
        id: 'denoise', num: '4', title: '小波去噪：为什么"阈一下"就灵',
        blocks: [
          { t: 'md', md: '小波去噪之所以有效，是因为它同时满足两个性质：① 能量集中性（压缩性）——真实信号的能量集中在少数大幅值的小波系数上；② 噪声的分散性——白噪声经过正交变换后仍是白噪声，能量平均分布在所有系数上，且幅度都很小。这两条决定了：在系数域设一个门槛把小系数砍掉，主要砍掉的是噪声。' },
          { t: 'md', md: '通用阈值（VisuShrink）为 $\\lambda=\\sigma\\sqrt{2\\ln N}$，其中 $\\sigma$ 通常由最细尺度细节系数的中位数绝对偏差估计：$\\hat\\sigma=\\mathrm{median}(|d_1|)/0.6745$。硬阈值直接置零，软阈值再收缩 $\\lambda$（更平滑，稍有偏置）。' },
          { t: 'math', tex: '\\eta_{hard}(c)=\\begin{cases}c,&|c|>\\\\lambda\\\\0,&|c|\\le\\lambda\\end{cases}\\qquad \\eta_{soft}(c)=\\mathrm{sgn}(c)\\max(0,\\,|c|-\\lambda)', tag: '(4)' },
          {
            t: 'widget', render: function (el) {
              const N = 512;
              const clean = new Float64Array(N);
              const segs = [[0, 80, 0], [80, 140, 3], [140, 200, -1], [200, 260, 0.5], [260, 340, 2.5], [340, 420, -2], [420, N, 0]];
              segs.forEach(s => { for (let i = s[0]; i < s[1]; i++) clean[i] = s[2]; });
              const noisy = C.addNoise(clean, 6, 20241024);
              const R = haarDwt(noisy, 3);
              const abs1 = Array.from(R.d[0]).map(Math.abs).sort((a, b) => a - b);
              const sigma = abs1[abs1.length >> 1] / 0.6745;
              const lam = sigma * Math.sqrt(2 * Math.log(N));
              const thr = R.d.map(d => {
                const o = new Float64Array(d.length);
                for (let i = 0; i < d.length; i++) { const v = d[i]; o[i] = Math.abs(v) > lam ? v : 0; }
                return o;
              });
              const rec = haarIdwt(R.a, thr);
              // 对照：移动平均（同样长度的线性平滑）
              const W = 9, maP = new Float64Array(N);
              for (let i = 0; i < N; i++) {
                let s = 0, c = 0;
                for (let j = -W; j <= W; j++) { const k = i + j; if (k >= 0 && k < N) { s += noisy[k]; c++; } }
                maP[i] = s / c;
              }
              const snrIn = C.measSNR(noisy, clean), snrWav = C.measSNR(rec, clean), snrMa = C.measSNR(maP, clean);
              const wrap = U.h('div.grid.g2');
              const b1 = DSP.ui.plotBox({ title: '原始干净信号 vs 加噪观测（输入 SNR 约 6 dB）' });
              const p1 = DSP.plot.new(b1.canvas, { height: 230, xlabel: 'n', ylabel: '幅度', legend: true, legendPos: 'tr' });
              p1.add({ x: U.arange(N), y: clean, color: 1, width: 2.2, dash: [6, 3], label: '干净信号（真值）' })
                .add({ x: U.arange(N), y: noisy, color: 4, width: 1, alpha: 0.75, label: '加噪观测' }).draw();
              const b2 = DSP.ui.plotBox({ title: 'Haar 三层硬阈值去噪结果（保留阶跃、压掉噪声）' });
              const p2 = DSP.plot.new(b2.canvas, { height: 230, xlabel: 'n', ylabel: '幅度', legend: true, legendPos: 'tr' });
              p2.add({ x: U.arange(N), y: clean, color: 1, width: 2.2, dash: [6, 3], label: '干净信号（真值）' })
                .add({ x: U.arange(N), y: rec, color: 0, width: 1.6, label: '小波去噪输出' }).draw();
              wrap.appendChild(b1.el); wrap.appendChild(b2.el);
              el.appendChild(wrap);
              el.appendChild(DSP.ui.metrics([
                { label: '去噪前 SNR', value: snrIn.toFixed(2), unit: 'dB' },
                { label: '小波硬阈值后', value: snrWav.toFixed(2), unit: 'dB' },
                { label: '同长度移动平均', value: snrMa.toFixed(2), unit: 'dB' },
                { label: '估计噪声 σ', value: sigma.toFixed(3), unit: '（真值约 0.84）' }
              ]));
              el.appendChild(U.h('div.plot-cap', { html: U.md('数值全部由本页面脚本实时计算（核心库加噪 + 三层 Haar 塔式分解 + 通用阈值硬判决）。可以看到小波去噪保留了阶跃边沿，而同等平滑量的移动平均把边沿也磨圆了——这正是它在故障诊断与图像处理里不可替代的原因。') }));
            }
          },
          { t: 'callout', kind: 'eng', title: '工程上的三个实践要点', md: '1. **先估计噪声水平**：用最细尺度 $d_1$ 的 MAD 估计 $\\sigma$ 是标准做法，比"凭经验给个阈值"稳健得多。\n2. **阈值分层处理**：深层尺度（低频）系数数量少，用统一阈值容易过度平滑，实践中常改成分层阈值 $\\lambda_j=\\sigma_j\\sqrt{2\\ln N_j}$。\n3. **平移不变（cycle-spinning）**：正交 DWT 对平移敏感，同一段信号平移一个点后去噪结果可能变化明显。工程上常对若干平移做去噪再平均（相当于冗余小波），可显著抑制伪吉布斯振荡，代价是计算量翻倍。' }
        ]
      },
      {
        id: 'choice', num: '5', title: '小波基怎么选',
        blocks: [
          { t: 'table', cols: ['小波族', '支撑长度', '对称性', '消失矩', '适合于是'], rows: [
            ['Haar（db1）', '1（最短）', '对称', '1', '阶跃突变检测、教学、快速原型'],
            ['Daubechies db4/db8', '7 / 15', '不对称', '4 / 8', '通用去噪与压缩，工程默认值之一'],
            ['Symlet sym4/sym8', '7 / 15', '近似对称', '4 / 8', '需要相位不失真（去噪、特征提取）'],
            ['Coiflet', '较长', '近似对称', '较高', '同时关注函数值与导数'],
            ['Morlet（CWT）', '无穷（实际约 ±4）', '复对称', '—', '时频图绘制、振荡结构分析、脊线提取'],
            ['Mexican hat（CWT）', '无穷', '实对称', '2', '找极值点、边缘检测（不能做正交 DWT）']
          ] },
          { t: 'md', md: '选择的三个判据：① 支撑是否够短（越短越能定位瞬态）；② 消失矩是否够高（越高越能把光滑信号压成少数大系数，压缩/去噪越好）；③ 是否对称（不对称会带来相位失真，使去噪后的波形位置偏移）。这三者互相矛盾，所以才有了这么多族。' },
          { t: 'callout', kind: 'note', title: '消失矩是什么，为什么重要', md: '若小波对任意 $p<N_v$ 次多项式满足 $\\int t^p\\psi(t)dt=0$，则称它有 $N_v$ 阶消失矩。直观理解：**它能"看不见"光滑的多项式部分**，于是光滑信号在小波域只留下极少的非零系数（正因为如此，噪声才显得格外突出，阈值才好用）。Haar 只有 1 阶消失矩，所以遇到含趋势项的信号要先去趋势，否则去噪效果会明显变坏。' }
        ]
      },
      {
        id: 'app', num: '6', title: '工程应用：散射、诊断、去噪',
        blocks: [
          { t: 'table', cols: ['应用', '为什么小波合适', '做法要点'], rows: [
            ['水声瞬态 / 弹性散射检测', '回波中不同到达时刻的子结构跨越毫秒到秒多个尺度', '用 Morlet CWT 画尺度图；在最优尺度上做脊线，读取到达时间差'],
            ['机械故障诊断（轴承、齿轮箱）', '故障冲击是极短宽带脉冲，淹没在强周期性振动里', '用高频共振解调 + 小波包，或直接在最细尺度上做包络谱'],
            ['雷达杂波抑制 / 海杂波中的小目标', '海杂波与目标回波在不同尺度上的能量分布不同', '多尺度分解后逐层门限，或在小波域做 CFAR'],
            ['侧扫 / 多波束图像去噪', '图像边缘是二维奇异性，小波能保边去噪', '二维可分离小波 + 软阈值；优于高斯平滑的关键在于保边'],
            ['数据压缩', '少量大系数即可重构绝大部分能量', 'JPEG 2000 用 CDF 9/7 双正交小波；水声数据回传也常用']
          ] },
          { t: 'callout', kind: 'eng', title: '一个真实的选型案例', md: '某型拖曳阵需要在线检测远处目标的瞬态辐射噪声。最初方案用 STFT + 能量检测，虚警率极高；改成 db4 小波、只在第 1、2 层细节上做 CFAR 检测后，虚警下降一个数量级。原因很清楚：宽带瞬态的能量天然集中在细尺度上，而背景海噪的能量更多分布在粗尺度，两者在小波域是分开的——在 STFT 域它们混在一起，只能靠门限硬拼。' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区专栏',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 把尺度 a 直接当成频率 f', md: '二者是**反比**关系，且比例系数取决于具体的母小波：$f=f_c/(a\\Delta t)$。不同小波、不同软件包的 $f_c$ 定义可能不同。**直接把纵轴标成"尺度"是最安全的写法**，要换算成 Hz 必须连同所用小波和 $f_c$ 一起注明。' },
          { t: 'callout', kind: 'pit', title: '② 忽略边界效应', md: '有限长信号在两端做滤波必然要做数据延拓（补零 / 对称 / 周期）。错误的选择会在图的两端产生明显的假亮带，很容易被误读成"开头有一个瞬态"。处理办法：先对称延拓再分解，并把边缘若干系数标记为不可信。' },
          { t: 'callout', kind: 'pit', title: '③ 认为小波分解层数越多越好', md: '层数过多时，最后一层近似系数只剩很少几个点，**任何结论都不再统计显著**。经验规则：分解层数取 $\\lfloor\\log_2 N\\rfloor-2\\sim -4$，使最粗一层至少有 30~60 个系数。' },
          { t: 'callout', kind: 'pit', title: '④ 用正交 DWT 直接做特征的绝对值比较', md: '正交 DWT 对平移敏感，且不同小波基给出的系数值不可比。做特征时必须采用平移不变的处理（cycle-spinning、冗余小波），或改用平移不变的量（如各尺度能量占比）。' },
          { t: 'callout', kind: 'eng', title: '工程提示', md: '小波不是万能的：如果信号本来就是窄带平稳的（例如单根电缆线谱那样的稳定频谱），FFT 的频率分辨率远好于小波。小波的优势只在"多尺度结构"上存在。评价时请把小波结果与 FFT 基线放在一起比较，确认它确实带来了之前看不到的东西，再决定是否上线。' }
        ]
      }
    ],
    refs: [
      'Mallat, A Wavelet Tour of Signal Processing, 第 4、7、11 章',
      'Daubechies, Ten Lectures on Wavelets（消失矩与 QMF 的标准推导）',
      'Donoho & Johnstone, "Ideal Spatial Adaptation by Wavelet Shrinkage", Biometrika, 1994'
    ]
  });

  /* ============================================================
     7. Z 变换
     ============================================================= */
  doc.register('theory/transform/ztrans', {
    title: 'Z 变换',
    lede: 'Z 变换是离散系统的"通用语言"：差分方程在这里变成代数方程，系统特性被压缩成零极点两个符号，稳定性、因果性、频率响应全部可以从一幅 z 平面图上读出来。',
    tags: ['核心变换', 'Z 变换', 'ROC', '零极点', '稳定性'],
    toc: true,
    labs: [{ path: 'lab/zplane', title: 'Z 平面零极点拖动实验台', desc: '拖动零极点，实时看到频响、冲激响应与稳定性如何随之变化' }],
    sections: [
      {
        id: 'def', num: '1', title: '定义：为什么要写成 z 的负幂',
        blocks: [
          { t: 'math', tex: 'X(z)=\\mathcal{Z}\\{x[n]\\}=\\sum_{n=-\\infty}^{\\infty}x[n]\\,z^{-n},\\qquad z\\in\\mathbb{C}', tag: '(1)' },
          { t: 'callout', kind: 'note', title: '为什么用负幂 z⁻¹ 而不是 z', md: '因为 **$z^{-1}$ 代表"延迟一个采样周期"**。差分方程 $y[n]=\\sum b_k x[n-k]-\\sum a_k y[n-k]$ 里的每一项 $x[n-k]$，在 Z 域里就是 $z^{-k}X(z)$。用负幂书写，一个 delay 对应的就是一个 $z^{-1}$ 因子，**多项式变量的次数直接等于延迟拍数**，这让滤波器结构（抽头延迟线）与代数表达式一一对应。与之对照，拉普拉斯变换里 $s$ 代表微分，$1/s$ 才代表积分。' },
          { t: 'md', md: '最常见的形式是有理分式：' },
          { t: 'math', tex: 'X(z)=\\frac{B(z)}{A(z)}=\\frac{b_0+b_1z^{-1}+\\dots+b_Mz^{-M}}{a_0+a_1z^{-1}+\\dots+a_Nz^{-N}} = g\\cdot z^{N-M}\\frac{\\prod_{i=1}^{M}(z-z_i)}{\\prod_{i=1}^{N}(z-p_i)}', tag: '(2)' },
          { t: 'kv', title: '符号约定', pairs: [
            ['z_i', '零点（使分子为零的 z 值），在图上画 ○'],
            ['p_i', '**极点**（使分母为零、$X(z)\\to\\infty$ 的 z 值），在图上画 ×'],
            ['g', '增益常数，只影响整体幅度，不影响零极点位置'],
            ['ROC', '**收敛域**：使该级数收敛的 z 平面区域，形式总是一个环 $R_-<|z|<R_+$']
          ] },
          { t: 'md', md: '**ROC 的两个基本事实**：① ROC 内绝不包含任何极点（级数在被极点处发散）；② 若 ROC 是某个环 $R_-<|z|<R_+$，那么 $R_-$ 与 $R_+$ 一定是极点所在的模值。' }
        ]
      },
      {
        id: 'roc', num: '2', title: '重点：ROC 决定因果性与稳定性',
        blocks: [
          { t: 'md', md: '这是整节最关键的一句话：**有理分式 $X(z)$ 的代数形式相同，但 ROC 不同，对应的是完全不同的时域序列。**同一个 $\\dfrac{1}{1-az^{-1}}$，可以表示右边序列、也可以表示左边序列——它们的 DTFT 存在性、因果性、稳定性全都不同。' },
          { t: 'table', cols: ['ROC', '对应时域序列', '因果性', '稳定性（ROC 含单位圆？）'], rows: [
            ['|z| > |a|（圆外）', 'aⁿu[n]，右边序列', '因果', '|a| < 1 时稳定'],
            ['|z| < |a|（圆内）', '−aⁿu[−n−1]，左边序列', '反因果', '|a| > 1 时稳定'],
            ['|a| < |z| < |b|（环，且 |a| < 1 < |b|）', '双边序列', '非因果', '稳定（唯一能同时稳定的双边情形）']
          ] },
          { t: 'math', tex: '\\frac{1}{1-az^{-1}}\\ \\xleftrightarrow[\\ \\text{ROC }|z|>|a|\\ ]{\\mathcal{Z}^{-1}}\\ a^n u[n];\\qquad \\frac{1}{1-az^{-1}}\\ \\xleftrightarrow[\\ \\text{ROC }|z|<|a|\\ ]{\\mathcal{Z}^{-1}}\\ -a^n u[-n-1]', tag: '(3)' },
          { t: 'callout', kind: 'danger', title: '因果性与稳定性不是一回事', md: '- **因果性**（能否实时实现）取决于 ROC 是否是某个圆的**外部**且包含 $\\infty$；等价于冲激响应满足 $h[n]=0,\\ n<0$。\n- **稳定性**（BIBO 有界输入有界输出）等价于 $\\sum|h[n]| <\\infty$，也等价于 **ROC 包含单位圆**。\n- **两者可以同时不满足也可以同时满足**：一个因果系统要稳定，必须**全部极点在单位圆内**（此时 ROC 可以取 $|z|>\\max|p_i|$ 并覆盖单位圆）；一个反因果系统要稳定，必须全部极点在单位圆外。**ROC 是唯一能把这两件事说清楚的语言。**' },
          {
            t: 'widget', render: function (el) {
              const wrap = U.h('div.grid.g2');
              el.appendChild(wrap);                // 容器先入树，子画布宽度才有值
              const cases = [
                { t: '因果稳定：极点在 0.7', z: [], p: [{ re: 0.7, im: 0 }] },
                { t: '因果不稳定：极点在 1.25', z: [], p: [{ re: 1.25, im: 0 }] },
                { t: '二阶谐振：共轭极点 0.9·e^(±jπ/4)', z: [], p: [{ re: 0.9 * Math.cos(Math.PI / 4), im: 0.9 * Math.sin(Math.PI / 4) }, { re: 0.9 * Math.cos(Math.PI / 4), im: -0.9 * Math.sin(Math.PI / 4) }] },
                { t: '零点在单位圆上：该频率完全被抵消', z: [{ re: Math.cos(Math.PI / 3), im: Math.sin(Math.PI / 3) }, { re: Math.cos(Math.PI / 3), im: -Math.sin(Math.PI / 3) }], p: [{ re: 0.5, im: 0.3 }, { re: 0.5, im: -0.3 }] }
              ];
              cases.forEach(cs => {
                const box = DSP.ui.plotBox({ title: cs.t });
                  wrap.appendChild(box.el);
                DSP.plot.zplane(box.canvas, { zeros: cs.z, poles: cs.p, height: 250 });
              });
              el.appendChild(U.h('div.plot-cap', { html: U.md('四幅 z 平面图由本页面的零极点数据直接绘制。判断稳定性的操作极其简单：看有没有极点（×）跑到单位圆外面；判断某频率是否被强烈衰减，则看该频率方向上是否有零点（○）靠近单位圆。') }));
            }
          }
        ]
      },
      {
        id: 'inv', num: '3', title: '逆 Z 变换的三种方法',
        blocks: [
          { t: 'md', md: '已知 $X(z)$ 和 ROC，怎么找回 $x[n]$？三种方法各有适用场景。' },
          { t: 'table', cols: ['方法', '做法', '适合', '注意'], rows: [
            ['留数定理（围线积分）', 'x[n] = (1/2πj)·∮ X(z)·z^(n−1) dz（围线内留数之和）', '理论推导，给出闭式解', '必须按 ROC 选择积分围线 C'],
            ['部分分式展开', '把 X(z) 拆成 Σ A_k/(1 − p_k·z⁻¹)，逐项查表', '工程手算最常用', '每一项都要按 ROC 决定是右边还是左边序列'],
            ['幂级数展开（长除）', '直接做多项式长除，得到 x[0], x[1], … 逐个系数', '数值/递归实现，非闭式', '只能按 ROC 选择升幂或降幂方向']
          ] },
          {
            t: 'fold', summary: '展开：一个完整的部分分式反变换算例', deriv: true, blocks: [
              { t: 'md', md: '**题目**：$X(z)=\\dfrac{1}{(1-0.5z^{-1})(1-2z^{-1})}$，ROC 为 $0.5<|z|<2$。求 $x[n]$。' },
              { t: 'md', md: '**第一步（部分分式）**：令 $\\;X(z)=\\dfrac{A}{1-0.5z^{-1}}+\\dfrac{B}{1-2z^{-1}}$。通分后比较分子：$A(1-2z^{-1})+B(1-0.5z^{-1})=1$。比较常数项与 $z^{-1}$ 项：$A+B=1$，$-2A-0.5B=0$。解得 $A=-\\tfrac{1}{3}$，$B=\\tfrac{4}{3}$。' },
              { t: 'md', md: '**第二步（按 ROC 判断每个极点的时域形态）**：ROC 是 $0.5<|z|<2$ 的**环**。位于 $|z|=0.5$ 的极点在 ROC 的内侧边界上，对应项是右边序列（因为 ROC 在该极点之外）；位于 $|z|=2$ 的极点在 ROC 的外侧边界上，对应项是左边序列。' },
              { t: 'math', tex: 'x[n]=\\underbrace{-\\tfrac13\\,(0.5)^n u[n]}_{\\text{来自 }p=0.5\\text{，右边}}\\;\\underbrace{-\\tfrac43\\,(2)^n u[-n-1]}_{\\text{来自 }p=2\\text{，左边}}', tag: '(4)' },
              { t: 'md', md: '**第三步（检验）**：这个 ROC 是一个环，因此 $x[n]$ 是双边序列；又因 ROC 包含单位圆（$0.5<1<2$），所以该系统**稳定**；但它不是因果的。**同一个代数式，若 ROC 改成 $|z|>2$，答案会变成纯右边的因果序列 $x[n]=-\\frac13(0.5)^n u[n]+\\frac43(2)^n u[n]$，而且发散不稳定。**这就是 ROC 决定一切的具体演示。' }
            ]
          }
        ]
      },
      {
        id: 'laplace', num: '4', title: '与拉普拉斯变换的关系：s 平面怎么折进 z 平面',
        blocks: [
          { t: 'md', md: '对连续信号 $x_a(t)$ 理想采样得 $x_s(t)$，再取拉普拉斯变换，可导出两者关系：' },
          { t: 'math', tex: 'z=e^{sT_s},\\qquad s=\\sigma+j\\Omega\\ \\Longrightarrow\\ z=e^{\\sigma T_s}e^{j\\Omega T_s},\\quad |z|=e^{\\sigma T_s},\\ \\angle z=\\Omega T_s', tag: '(5)' },
          { t: 'md', md: '这条映射有三条极其重要的几何结论，建议直接背下来：' },
          { t: 'table', cols: ['s 平面位置', '含义', '映射到 z 平面', '结论'], rows: [
            ['虚轴 σ = 0', '临界稳定（等幅振荡）', '单位圆 |z| = 1', '单位圆 ↔ 频率响应所在的轨迹'],
            ['左半平面 σ < 0', '衰减（稳定）', '单位圆内 |z| < 1', '模拟滤波器稳定 ⟺ 数字滤波器极点在圆内'],
            ['右半平面 σ > 0', '发散（不稳定）', '单位圆外 |z| > 1', '极点一旦跑到圆外，输出必然发散'],
            ['Ω 从 −∞ 到 +∞', '沿虚轴上下走无穷远', '在单位圆上绕无穷多圈', '离散频谱必然以 2π 周期重复的几何根源']
          ] },
          {
            t: 'plot', title: 's 平面到 z 平面的映射：整张平面被"卷"成一张无限层的饼', height: 300,
            render: function (canvas) {
              const p = DSP.plot.new(canvas, {
                height: 300, xlabel: 'Re(z)', ylabel: 'Im(z)', legend: true, legendPos: 'tr', grid: true, xlim: [-2.2, 2.2], ylim: [-2.2, 2.2]
              });
              const th = U.linspace(0, Math.PI * 2, 200);
              p.add({ x: th.map(Math.cos), y: th.map(Math.sin), color: 1, width: 2, dash: [5, 3], label: '单位圆（s 平面虚轴）' })
                .hline(0, { label: '' }).vline(0, { label: '' });
              // 三组等 σ 线（分别来自左半平面、虚轴、右半平面）
              const sigs = [Math.log(0.35), Math.log(0.7), Math.log(1.6)];
              const cols = [0, 2, 3];
              const lab = ['σ<0 → 单位圆内（稳定）', 'σ=0 → 单位圆', 'σ>0 → 单位圆外（发散）'];
              sigs.forEach((sg, si) => {
                const r = Math.exp(sg);
                const xs = [], ys = [];
                for (let i = 0; i < 200; i++) {
                  const Om = (-6 + 12 * i / 199);
                  const rr = r * 1;
                  xs.push(rr * Math.cos(Om));
                  ys.push(rr * Math.sin(Om));
                }
                p.add({ x: xs, y: ys, type: 'scatter', size: 2.2, color: cols[si], label: lab[si] });
              });
              p.draw();
            }
          },
          { t: 'callout', kind: 'warn', title: '多值映射是根本麻烦所在', md: '因为 $e^{j\\Omega T_s}$ 对 $\\Omega$ 以 $2\\pi/T_s=f_s$ 为周期，**s 平面按宽度 $f_s$ 被一层层折叠进同一个单位圆**——这就是前面 DTFT 周期性、以及后面双线性变换存在"频率扭曲（warping）"的几何根源。**凡是采用脉冲响应不变法的设计，都必须预先知道：s 平面的无穷远是否被压缩得足够好，否则会有混叠。**' }
        ]
      },
      {
        id: 'sys', num: '5', title: '差分方程 → 系统函数 → 零极点几何求值',
        blocks: [
          { t: 'md', md: '对差分方程两边取 Z 变换，利用时移性质 $\\mathcal{Z}\\{x[n-k]\\}=z^{-k}X(z)$（零初值条件下），立即得到**系统函数**：' },
          { t: 'math', tex: 'H(z)=\\frac{Y(z)}{X(z)}=\\frac{\\sum_{k=0}^{M}b_k z^{-k}}{\\sum_{k=0}^{N}a_k z^{-k}} = g\\,z^{N-M}\\frac{\\prod_{i=1}^{M}(z-z_i)}{\\prod_{i=1}^{N}(z-p_i)}', tag: '(6)' },
          { t: 'md', md: '当输入是复正弦 $x[n]=z^n$（取 $z$ 在系统 ROC 内），输出就是 $y[n]=H(z)z^n$——**复正弦是线性时不变系统的特征函数，$H(z)$ 是特征值**。令 $z=e^{j\\omega}$，就得到频率响应 $H(e^{j\\omega})$，这正是 DTFT 与 Z 变换的连接点。' },
          { t: 'md', md: '**几何求值法**（不用计算，直接看图读数）把每个零点/极点看成一条从该点到单位圆上某点 $e^{j\\omega}$ 的向量：' },
          { t: 'math', tex: '\\bigl|H(e^{j\\omega})\\bigr| = g\\,\\frac{\\prod_i |\\text{零点向量}|}{\\prod_i |\\text{极点向量}|},\\qquad \\angle H(e^{j\\omega}) = \\sum_i \\angle(\\text{零点向量}) - \\sum_i \\angle(\\text{极点向量}) + \\omega(N-M)', tag: '(7)' },
          {
            t: 'widget', render: function (el) {
              const zeros = [{ re: Math.cos(Math.PI * 0.5), im: Math.sin(Math.PI * 0.5) }, { re: Math.cos(Math.PI * 0.5), im: -Math.sin(Math.PI * 0.5) }];
              const poles = [{ re: 0.72, im: 0.42 }, { re: 0.72, im: -0.42 }];
              const wrap = U.h('div.grid.g2');
              el.appendChild(wrap);                  // 容器先入树再绘制
              const b1 = DSP.ui.plotBox({ title: '零极点图：一对单位圆上的零点 + 一对圆内共轭极点' });
              const b2 = DSP.ui.plotBox({ title: '对应的幅频响应（在 ω=±π/2 处出现深凹口）' });
              wrap.appendChild(b1.el); wrap.appendChild(b2.el);
              DSP.plot.zplane(b1.canvas, { zeros: zeros, poles: poles, height: 280 });
              const H = C.zpH2Freq(zeros, poles, 1, 512);
              const mg = magSq(H.re, H.im).map(v => Math.sqrt(v));
              let mx = 0;
              for (let i = 0; i < mg.length / 2; i++) if (mg[i] > mx) mx = mg[i];
              const db = new Float64Array(257);
              const ww = new Float64Array(257);
              for (let i = 0; i <= 256; i++) { ww[i] = i / 256; db[i] = 20 * Math.log10(Math.max(mg[i], 1e-9) / mx); }
              const p2 = DSP.plot.new(b2.canvas, { height: 280, xlabel: 'ω / π', ylabel: 'dB', legend: false, ylim: [-60, 5] });
              p2.add({ x: ww, y: Array.from(db), color: 0, width: 1.8 })
                .vline(0.5, { label: '零点所在 ω=π/2', dash: [5, 3] })
                .draw();
              el.appendChild(U.h('div.plot-cap', { html: U.md('左右两图由同一组零极点数据生成（核心库由零极点求频响）。可以看到：零点越靠近单位圆，该频率处的凹口越深、越尖锐；极点越靠近单位圆，该频率附近越隆起。凹到极致的情形——零点恰好落在单位圆上——就是陷波器（notch），例如用来滤除 50 Hz 工频干扰。') }));
            }
          }
        ]
      },
      {
        id: 'stab', num: '6', title: '稳定性判据与工程检查清单',
        blocks: [
          { t: 'md', md: '把所有结论汇总成一张可以直接落到 script 里的检查表：' },
          { t: 'table', cols: ['要判定的性质', '判据（Z 域）', '等价的时域说法'], rows: [
            ['BIBO 稳定', 'ROC 包含单位圆', 'Σₙ |h[n]| < ∞'],
            ['因果', 'ROC 是某圆外部且含 ∞；等价于 H(z) 分子阶数 ≤ 分母阶数', 'h[n] = 0（n < 0）'],
            ['因果且稳定', '全部极点在单位圆内', 'Σ|h[n]| < ∞ 且 h 为右边序列'],
            ['最小相位', '全部零点也在单位圆内', '逆系统因果且稳定'],
            ['线性相位（FIR）', '零点关于单位圆镜像成对（或恰在圆上）', 'h[n] = ±h[N−n]（对称/反对称）']
          ] },
          { t: 'md', md: '关于最后两条再多说一句。**最小相位系统**的全部零点在单位圆内，意味着它的逆（反卷积）是因果稳定的——所以做信道均衡、做反卷积时，通常需要先把非最小相位分量分离出来单独处理。**线性相位 FIR 的零点必须镜像成对**，这解释了为什么 II 型/IV 型线性相位 FIR 在特定类型滤波器（高通）中有 $z=\\pm1$ 处的强制零点。' },
          { t: 'callout', kind: 'eng', title: 'IIR 定点实现的两个杀手位置', md: '① **极点非常靠近单位圆**（如 $r=0.999$ 的谐振器）：极点位置由分母系数量化决定，**16 bit 量化误差就可能把极点推到圆外**，滤波器由稳定变自激。对策是用二阶节（biquad / SOS）级联而不是直接高阶分式。\n② **多级高阶滤波器级联时的极限环**：即使输入为零，舍入误差也可能在反馈回路里形成小幅振荡，常见于 IIR 陷波器与高 Q 值谐振器。**对策是提高内部位宽并做舍入误差整形。**' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区专栏',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 只写 X(z) 不写 ROC', md: '这是 Z 变换最常见也最致命的错误。没有 ROC，同一个有理分式对应至少两种完全不同的时域序列，因果性、稳定性都无法判断。在试卷和工程文档里，写 Z 变换请一定连 ROC 一起写。' },
          { t: 'callout', kind: 'pit', title: '② 以为单位圆上的 H(z) 就是"唯一的频谱"', md: '单位圆是 ROC 的一部分吗？只有在 ROC 包含单位圆时才能谈 $H(e^{j\\omega})$。**若 ROC 不含单位圆（系统不稳定），$H(e^{j\\omega})$ 在严格意义上不存在**，画出来的曲线只是形式上把 $z=e^{j\\omega}$ 代入得到的东西，没有任何物理意义。' },
          { t: 'callout', kind: 'pit', title: '③ 只看极点不看零点就判断滤波特性', md: '滤除某个频率靠的是**零点**，不是极点。极点的作用是"抬高"某频段。想做一个 50 Hz 陷波器，要在 $z=e^{\\pm j2\\pi\\cdot50/f_s}$ 处放零点，极点只是用来调节凹口的宽度。**把两者搞反会导致设计出完全无效甚至自激的陷波器。**' },
          { t: 'callout', kind: 'pit', title: '④ 认为差分方程与 H(z) 一一对应', md: '一组 $(b,a)$ 系数确实唯一确定 $H(z)$，但反过来 $H(z)$ 对应**无穷多种实现结构**（直接型、级联型、并联型、格型），它们的有限字长行为差别巨大。**实现结构的选择是独立于传递函数的第二个自由度。**' },
          { t: 'callout', kind: 'eng', title: '工程提示', md: '拿到一套系数量化需求时，务必做一次**极点半径敏感性分析**：把每个二阶节的极点半径 $r$ 与极点辐角 $\\theta$ 单独扰动 $\\pm 2^{-b}$，看 $H(e^{j\\omega})$ 的偏差是否还在指标内。**这一步能让你在联调之前就发现 80% 的定点化隐患。**' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 3 章（Z 变换）与第 5 章（LTI 系统）',
      'Proakis & Manolakis, Digital Signal Processing, 第 3、8 章',
      '程佩青《数字信号处理教程》第 2、5 章'
    ]
  });

  /* ============================================================
     8. 希尔伯特变换与解析信号
     ============================================================= */
  doc.register('theory/transform/hilbert', {
    title: '希尔伯特变换与解析信号',
    lede: '希尔伯特变换做了一件看似简单却影响深远的事：把一个实信号配上正交伙伴成为复解析信号，于是"瞬时幅度"和"瞬时频率"才有了严格的数学定义。',
    tags: ['核心变换', '希尔伯特变换', '解析信号', '瞬时频率', '包络'],
    toc: true,
    sections: [
      {
        id: 'def', num: '1', title: '定义：把每个频率分量转 90 度',
        blocks: [
          { t: 'math', tex: '\\hat{x}(t)=\\mathcal{H}\\{x(t)\\}=\\frac{1}{\\pi}\\,p.v.\\!\\int_{-\\infty}^{\\infty}\\frac{x(\\tau)}{t-\\tau}d\\tau = x(t)*\\frac{1}{\\pi t}', tag: '(1)' },
          { t: 'md', md: '在频域看，它是一次干净的符号函数相乘：' },
          { t: 'math', tex: '\\hat{X}(f)=-\\,j\\,\\mathrm{sgn}(f)\\,X(f)=\\begin{cases}-\\,j\\,X(f),& f>0\\\\0,&f=0\\\\+\\,j\\,X(f),&f<0\\end{cases}', tag: '(2)' },
          { t: 'callout', kind: 'note', title: '一句话物理含义', md: '**正频率分量相位滞后 90°，负频率分量相位超前 90°，幅度一个都不变。**它的幅度谱 $|\\hat{X}(f)|=|X(f)|$ 与原信号完全相同——希尔伯特变换不损失也不增加任何幅度信息，它只动手改了相位。所以它本质上是一个**理想的正交移相器（宽带 90° 相移网络）**。' },
          { t: 'md', md: '离散实现极为简单，只需三次 FFT 层面的操作：' },
          { t: 'flow', items: [
            { t: 'FFT', kind: 'io', d: '对实序列 x[n] 做 N 点 FFT，得到双边谱 X[k]' },
            { t: '单边化', kind: 'dsp', d: '正频部分乘 2，负频部分（k > N/2）置零，直流与奈奎斯特点保持不变' },
            { t: 'IFFT', kind: 'dsp', d: '反变换取虚部即 x̂[n]；实部是原信号，二者合成解析信号' }
          ] },
          { t: 'callout', kind: 'tip', title: '为什么不直接做卷积', md: '因为 $1/(\\pi t)$ 是无限长、不可实现的核。频域用 FFT 做，代价是 $O(N\\log N)$ 且不需要额外 memory。**代价在于：它隐含了"信号是周期的"假设，所以端点处一定出错**（详见第 5 节）。' }
        ]
      },
      {
        id: 'analytic', num: '2', title: '解析信号：为什么值得多配一路虚部',
        blocks: [
          { t: 'math', tex: 'z[n]\\;=\\;x[n]+j\\,\\hat{x}[n]\\;=\\;a[n]\\,e^{j\\phi[n]}', tag: '(3)' },
          { t: 'md', md: '由于负频分量被置零，$z[n]$ 的频谱只占据正频率一侧——这是"解析"（analytic）一词的由来。它带来三个立刻可用的量：' },
          { t: 'table', cols: ['量', '定义', '物理含义'], rows: [
            ['瞬时幅度（包络）', 'a[n] = |z[n]| = √(x² + x̂²)', '信号此刻的"强度"，与载波相位无关'],
            ['瞬时相位', 'φ[n] = arg z[n]（需去卷绕）', '载波此刻走到哪一个相位'],
            ['瞬时频率', 'f_i[n] ≈ (fs/2π)·Δφ（相位差分）', '载波此刻"跑多快"']
          ] },
          { t: 'callout', kind: 'eng', title: '为什么这三个量如此重要', md: '在雷达与声呐里，**目标的距离编码在回波时延里、速度编码在多普勒里、结构信息编码在调制谱里**——这三样东西全部等价于：把接收信号写成 $a(t)e^{j\\phi(t)}$ 之后，$a$ 和 $\\phi$ 各自的变化规律。**解析信号是把"回波"翻译成"目标"的关键一步。**机械故障诊断里同样如此：轴承冲击引起的高频共振被"包络"起来，而包络里就藏着故障特征频率。' },
          { t: 'md', md: '还有一个非常实用的副产品：一旦变成解析信号（复基带），**采样率需求可以减半**。原来需要 $f_s>2f_c$ 才能表示的实信号，变成复信号后只需要覆盖带宽 $B$ 而非 $2f_c$，这正是所有软件无线电都走 I/Q 的原因。' }
        ]
      },
      {
        id: 'demo', num: '3', title: '演示：AM 包络与 LFM 瞬时频率',
        blocks: [
          { t: 'md', md: '先看一个教科书级的成功案例。构造 (a) 一段 AM 调幅波、(b) 一段线性调频 chirp，用核心库的解析信号工具实时计算它们的包络与瞬时频率。' },
          {
            t: 'widget', render: function (el) {
              const fs = 4000, N = 1024;
              const t = U.linspace(0, (N - 1) / fs, N);
              const amSig = C.am(N, fs, 900, 12, 0.85);
              const envA = C.envelope(amSig);
              const wrap = U.h('div.grid.g2');
              const b1 = DSP.ui.plotBox({ title: 'AM 信号及其解析包络（虚线为真包络 1+0.85cos）' });
              const p1 = DSP.plot.new(b1.canvas, { height: 230, xlabel: 't / s', ylabel: '幅度', legend: true, legendPos: 'tr' });
              p1.add({ x: t, y: amSig, color: 4, width: 1, alpha: 0.8, label: 'AM 波形（已乘包络）' })
                .add({ x: t, y: envA, color: 0, width: 2, label: '解析包络 |z[n]|' })
                .draw();
              wrap.appendChild(b1.el);
              const f0 = 400, f1 = 1400;
              const lfm = C.chirp(N, fs, f0, f1, N / fs);
              const fi = C.instFreq(lfm, fs);
              const b2 = DSP.ui.plotBox({ title: 'LFM 的瞬时频率（应恢复为 400→1400 Hz 的直线斜坡）' });
              const p2 = DSP.plot.new(b2.canvas, { height: 230, xlabel: 't / s', ylabel: 'f_i / Hz', legend: true, legendPos: 'tl', ylim: [0, 1800] });
              const trim = 60;
              p2.add({
                x: t.subarray(trim, N - trim), y: Array.from(fi.subarray(trim, N - trim)),
                color: 2, width: 1.8, label: '由解析信号相位差分得到的瞬时频率'
              }).add({
                x: [t[trim], t[N - trim - 1]], y: [f0, f1], color: 3, dash: [6, 3], width: 1.6, label: '理论值（线性斜坡）'
              }).draw();
              wrap.appendChild(b2.el);
              el.appendChild(wrap);
              el.appendChild(U.h('div.plot-cap', { html: U.md('两张图均由本软件核心库实时计算。左图：包络完美贴合调制波形；右图：瞬时频率恢复出一条干净的斜坡，只在两端（避免端点效应已截去）有小偏差。这正是解析信号最擅长的两件事。') }));
            }
          }
        ]
      },
      {
        id: 'bedrosian', num: '4', title: '窄带前提：Bedrosian 定理与"瞬时频率何时有意义"',
        blocks: [
          { t: 'md', md: '上一节的成功是有前提的：信号必须是窄带的、单分量的。对宽带或多分量信号，直接套用式 (3) 求"瞬时频率"会得到完全没有物理意义的结果。' },
          { t: 'callout', kind: 'warn', title: '为什么', md: '瞬时频率的定义是"相位随时间的变化率"。当多个分量叠加时，合成向量的相位不再对应任何一个分量——它取决于各分量的相对幅度和相对相位，可能瞬间跳到任意一个值，甚至出现原信号里根本不存在的负频率。这不是算法 bug，是定义失效。' },
          {
            t: 'widget', render: function (el) {
              const fs = 4000, N = 1024;
              const t = U.linspace(0, (N - 1) / fs, N);
              const two = C.multisin(N, fs, [{ freq: 300, amp: 1 }, { freq: 430, amp: 1 }]);
              const fi = C.instFreq(two, fs);
              const box = DSP.ui.plotBox({ title: '两个等幅正弦（300 Hz + 430 Hz）的"瞬时频率"——结果荒谬' });
              const p = DSP.plot.new(box.canvas, { height: 250, xlabel: 't / s', ylabel: 'f_i / Hz', legend: false, ylim: [-1200, 1200] });
              p.add({ x: t, y: Array.from(fi), color: 3, width: 1.2 })
                .hline(300, { label: '300 Hz（真实分量）' })
                .hline(430, { label: '430 Hz（真实分量）' })
                .draw();
              el.appendChild(box.el);
              el.appendChild(U.h('div.plot-cap', { html: U.md('真实信号里只有 300 Hz 与 430 Hz 两个频率。但直接按定义算出的"瞬时频率"在二者之间来回跳，甚至出现负值（图中低于 0 的部分），而负频率在原信号中并不存在。结论：多分量信号必须先分离（滤波、EMD、脊线提取），再逐分量求瞬时频率。') }));
            }
          },
          {
            t: 'fold', summary: '展开：Bedrosian 定理——为什么"幅度慢变"就够了', deriv: true, blocks: [
              { t: 'md', md: '工程中真正使用的窄带模型是 $x(t)=a(t)\\cos\\bigl(2\\pi f_ct+\\phi(t)\\bigr)$，其中 $a(t)$ 是慢变包络。我们想知道：什么时候 $\\mathcal{H}\\{a(t)\\cos(\\cdot)\\}=a(t)\\sin(\\cdot)$，即希尔伯特变换只作用于余弦、包络能被完整保留？' },
              { t: 'md', md: '**定理（Bedrosian）**：若 $a(t)$ 与 $c(t)$ 的频谱不重叠，即 $A(f)$ 支集在 $[-B,B]$ 而 $C(f)$ 支集在 $|f|>B$ 之外，则 $\\mathcal{H}\\{a(t)c(t)\\}=a(t)\\,\\mathcal{H}\\{c(t)\\}$。' },
              { t: 'md', md: '**证明思路**：转到频域。$\\mathcal{H}$ 对应乘 $-j\\,\\mathrm{sgn}(f)$。卷积形式下，$\\widehat{ac}$ 的频谱是 $A*(\\mathrm{sgn}\\cdot C)$。由于支集不重叠，对所有有贡献的频点 $f=f_a+f_c$，符号函数 $\\mathrm{sgn}(f_a+f_c)$ 恒等于 $\\mathrm{sgn}(f_c)$（因为 $|f_a|<B<|f_c|$ 保证和的符号由 $f_c$ 决定）。于是 $\\mathrm{sgn}(f)$ 可以被提出，得到 $\\mathcal{F}\\{ac\\}\\cdot(-j\\,\\mathrm{sgn}) = A * [C\\cdot(-j\\,\\mathrm{sgn})]$，即 $\\mathcal{H}\\{ac\\}=a\\,\\mathcal{H}\\{c\\}$。' },
              { t: 'callout', kind: 'note', title: '工程解读', md: '定理给出的条件翻译成人话就是：**包络的变化速度必须比载波慢得多，二者的频谱互不重叠。**宽带调幅（包络与载波同量级变化）会破坏这个前提，此时由 $|z(t)|$ 得到的"包络"会振荡失真。**这也是为什么在做包络谱之前必须先做窄带带通滤波——带通就是在人为地满足 Bedrosian 条件。**' }
            ]
          }
        ]
      },
      {
        id: 'impl', num: '5', title: '数字实现的三个坑：端点、趋势、去均值',
        blocks: [
          { t: 'md', md: '用 FFT 做希尔伯特变换时，序列被当作周期的。首尾不连续会在边界处制造虚假的高频，导致包络在开始与结束处剧烈振荡。这不是算法错，是"周期假设"在边界上的必然代价。' },
          {
            t: 'plot', title: '端点效应：解析包络在序列两端明显失真', height: 250,
            render: function (canvas) {
              const fs = 1000, N = 512;
              const t = U.linspace(0, (N - 1) / fs, N);
              const sig = C.multisin(N, fs, [{ freq: 60, amp: 1 }]);
              const env = C.envelope(sig);
              const p = DSP.plot.new(canvas, { height: 250, xlabel: 't / s', ylabel: '幅度', legend: true, legendPos: 'tr' });
              p.add({ x: t, y: sig, color: 4, width: 1, alpha: 0.75, label: '原始信号（60 Hz 正弦，真实包络恒为 1）' })
                .add({ x: t, y: env, color: 0, width: 1.8, label: '解析包络 |z[n]|' })
                .hline(1, { label: '真实包络 = 1' })
                .band(0, 0.05, { color: '#b91c1c', alpha: 0.14 })
                .band(0.461, 0.511, { color: '#b91c1c', alpha: 0.14 })
                .draw();
            }
          },
          { t: 'md', md: '一个理论上包络恒等于 1 的纯正弦，算出来的包络在两端鼓了起来（红色高亮区）。工程对策：' },
          { t: 'md', md: '1. 加窗并延拓：对序列做镜像（对称）延拓后再求解析信号，最后截回原区间；\n2. 镜像填充 + 去趋势：先减去均值 / 去掉线性趋势，避免直流泄漏把包络整体抬高；\n3. 丢弃边界：直接忽略首尾各约窗长一半的结果；批处理时要求每段都留出足够的上下文。' },
          { t: 'callout', kind: 'eng', title: '希尔伯特-黄变换（HHT）简介', md: '既然多分量信号不能直接求瞬时频率，那就先把它拆成若干个单分量。HHT 的做法是：① 用经验模态分解（EMD）把信号自适应地分解成若干个本征模态函数（IMF），每个 IMF 在局部都近似窄带单分量；② 对每个 IMF 求解析信号，得到各自的瞬时频率；③ 汇总所有 IMF 的时频谱，得到 Hilbert 谱。优点是完全自适应，不预设基函数；缺点是模态混叠、端点发散、计算量大，且 EMD 缺乏严格的数学基础。在水声瞬态分析与故障诊断里它的成果不少，但把它作为在线算法时要格外谨慎。' }
        ]
      },
      {
        id: 'app', num: '6', title: '工程应用',
        blocks: [
          { t: 'table', cols: ['应用', '做法', '为什么必须用解析信号'], rows: [
            ['AM 解调 / 包络检波', '取 |z[n]|', '比二极管包络检波线性度好得多，且没有二极管门限失真'],
            ['单边带调制（SSB）', 'x + j·x̂，或取正 / 负频带', '节省一半带宽；数字实现就是一次 FFT 单边化'],
            ['窄带滤波预处理（数字下变频）', '先把实信号变解析信号，再混频到基带', '避免负频率镜像折叠；采样率需求减半'],
            ['LFM 瞬时频率估计', '对 chirp 取相位并差分', '直接测斜率，可用于扫频干扰的参数提取'],
            ['声呐回波包络检测', '匹配滤波后取包络再门限判决', '消除载波相位起伏对检测的影响'],
            ['轴承 / 齿轮故障诊断', '高频共振解调：带通 → 希尔伯特包络 → 包络谱', '包络谱里出现的是故障特征频率而非载波'],
            ['水声目标识别', '包络的调制谱（DEMON）', '叶频、轴频在包络谱上异常清晰']
          ] },
          { t: 'callout', kind: 'eng', title: '窄带预滤波是必须先做的一步', md: '在处理真实数据时，永远不要对原始宽带数据直接求瞬时频率。标准顺序是：① 看频谱，确定感兴趣的频率区间；② 设计一个 FIR/IIR 带通把该区间取出来；③ 对这个窄带信号求解析信号与瞬时三要素。跳过第 ② 步，第 ③ 步的结果毫无意义——这在第 4 节的演示里已经看得很清楚了。' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区专栏',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 对宽带/多分量信号直接求瞬时频率', md: '会得到完全荒谬的结果，包括负值（第 4 节演示）。瞬时频率只对单分量窄带信号有定义。多分量必须先分离。' },
          { t: 'callout', kind: 'pit', title: '② 忽略端点效应', md: 'FFT 实现隐含周期假设，序列两端一定会失真。处理办法：镜像延拓、去趋势、或者直接丢弃边界若干点。把边界处的"鼓包"当成真实现象是新手常见的误判。' },
          { t: 'callout', kind: 'pit', title: '③ 忘了去均值就去求包络', md: '直流分量会被算进包络，使 $|z[n]|$ 整体抬高甚至永远不为零。**求包络前一定要减去均值（必要时还要去线性趋势）。**' },
          { t: 'callout', kind: 'pit', title: '④ 以为解析信号提供了额外的信息', md: '它没有。负频率部分是实信号共轭对称的必然结果，不含任何独立信息；把它删掉也不会损失东西。解析信号的价值在于提供了一个更好的坐标系来读取幅度和相位，而不是提供新的数据。' },
          { t: 'callout', kind: 'eng', title: '工程提示', md: '做完解析解调后务必检查一件事：**瞬时频率在你的采样率下是不是被正确去卷绕了。**若真实频率超过 $f_s/2$，相位差分会折回，得到的斜坡方向会反过来。**判断办法很简单：先看一眼带通后的频谱位置，再决定要不要先把信号搬到低频。**' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 12 章（Hilbert 变换与解析信号）',
      'Cohen, Time-Frequency Analysis, 第 1 章（瞬时频率的定义与限制）',
      'Huang et al., "The Empirical Mode Decomposition and the Hilbert Spectrum", Proc. R. Soc. A, 1998'
    ]
  });

  /* ---------------- 分数阶傅里叶变换（数值实现，用于教学演示） ----------------
     定义：X_α(u) = A_φ · Σ_n x(t_n) · exp[jπ(t_n²cotφ − 2 t_n u cscφ + u²cotφ)] · Δt
     其中 φ = α·π/2，采用量纲一致的时间轴：t_n = (n − N/2)/√N，取 Lebesgue 意义上的
     黎曼和近似。α = 1 时退化为普通傅里叶变换，α = 0 时为恒等变换。        */
  function frftMagAt(tr, ti, tg, u, alpha, dt) {
    const phi = alpha * Math.PI / 2;
    const s = Math.sin(phi), c = Math.cos(phi);
    if (Math.abs(s) < 1e-3) return 0;
    const cot = c / s, cscf = 1 / s;
    let R = 0, I = 0;
    const N = tr.length;
    for (let n = 0; n < N; n++) {
      const ang = Math.PI * (tg[n] * tg[n] * cot - 2 * tg[n] * u * cscf + u * u * cot);
      const kr = Math.cos(ang), ki = Math.sin(ang);
      R += tr[n] * kr - ti[n] * ki;
      I += tr[n] * ki + ti[n] * kr;
    }
    const norm = Math.sqrt(Math.abs(cscf));
    return Math.hypot(R * dt, I * dt) / norm;
  }

  /* ============================================================
     9. 分数阶傅里叶变换
     ============================================================= */
  doc.register('theory/transform/frft', {
    title: '分数阶傅里叶变换',
    lede: '把时频平面整体旋转一个角度 α 再去看信号——这就是分数阶傅里叶变换。它对线性调频（chirp）信号有"杀手级"效果：在某个特定角度上，一个扫频信号会聚焦成一个极尖的峰。',
    tags: ['核心变换', 'FRFT', 'chirp', 'LFM', '干扰抑制'],
    toc: true,
    sections: [
      {
        id: 'def', num: '1', title: '定义：把傅里叶变换的 90° 变成任意角度',
        blocks: [
          { t: 'math', tex: 'X_\\alpha(u)=\\int_{-\\infty}^{\\infty} x(t)\\,K_\\alpha(t,u)\\,dt,\\qquad K_\\alpha(t,u)=A_\\varphi\\;\\exp\\!\\bigl[j\\pi\\bigl(t^2\\cot\\varphi-2tu\\csc\\varphi+u^2\\cot\\varphi\\bigr)\\bigr]', tag: '(1)' },
          { t: 'kv', title: '参数说明', pairs: [
            ['α', '**阶次**（order），通常取 $\\alpha\\in(-2,2]$；它与旋转角的关系是 $\\varphi=\\alpha\\pi/2$'],
            ['φ', '时频平面的实际旋转角。$\\varphi=\\pi/2$ 时 $\\alpha=1$，退化为普通傅里叶变换'],
            ['A_φ', '归一化因子 $=\\sqrt{1-j\\cot\\varphi}$，保证变换保能量（酉性）'],
            ['u', '分数阶域坐标，量纲介于时间与频率之间；$\\alpha=1$ 时它就是频率']
          ] },
          { t: 'table', cols: ['阶次 $\\alpha$', '旋转角 $\\varphi$', '退化为'], rows: [
            ['0', '0', '恒等变换（X₀(u) = x(u)，看的就是时域波形）'],
            ['0.5', '45°', '介于时域与频域之间的一半'],
            ['1', '90°', '普通傅里叶变换'],
            ['2', '180°', '时间反演（x(−t)）'],
            ['p + q', '—', '满足旋转叠加性：X(p+q) = F^p( F^q x )']
          ] },
          { t: 'callout', kind: 'note', title: '为什么要发明这个变换', md: '因为普通傅里叶变换只有一个自由度：要么看时间，要么看频率，中间的 89° 全都跳过了。然而有一大类信号——chirp（线性调频）——在时域和频域都不是稀疏的，它摊在时频平面的一条斜线上。如果我们能把坐标轴转一下，让这条斜线与新的 u 轴垂直，那么这个信号在 u 轴上就会压缩成一个尖峰。这就是 FRFT 的全部动机。' },
          { t: 'md', md: '更严格地说，FRFT 与 Wigner-Ville 分布有直接的几何关系：**Wigner-Ville 分布做角度 $\\varphi$ 的旋转，恰好对应 FRFT 模平方**。Wigner-Ville 是能量在时频面上的二维分布，FRFT 是它在一个方向上的投影（边缘）。旋转本身的一致性保证了 FRFT 是"能量守恒地斜着看一眼"。' }
        ]
      },
      {
        id: 'geom', num: '2', title: '物理图象：旋转，而不是压缩',
        blocks: [
          { t: 'md', md: '把 chirp 信号画在时频平面上：横轴时间、纵轴频率，一个从 $f_0$ 扫到 $f_1$ 的 LFM 就是一条**倾斜的线段**。任何固定方向的投影都无法让它变尖；但只要把坐标轴旋转到与该线段垂直的方向，投影就塌成一个点。' },
          { t: 'table', cols: ['信号', '时域形态', '频域形态', 'FRFT 域（最优阶次）'], rows: [
            ['单频 CW', '持续振荡，不稀疏', '尖峰', '在某阶次也是斜线散开'],
            ['窄脉冲', '尖峰', '宽带散开', '在某阶次也是斜线散开'],
            ['LFM / chirp', '宽带，不稀疏', '宽带，不稀疏', '尖峰（这是唯一聚焦的地方）']
          ] },
          { t: 'callout', kind: 'tip', title: '一句话记住', md: '**CW 在频域是尖的，脉冲在时域是尖的，chirp 只在分数阶域是尖的。**三种波形各自对应一个"最省力的观察角度"，而阶次 $\\alpha$ 就是这个角度的旋钮。' },
          { t: 'md', md: '由于变换是酉的（保能量），聚焦意味着能量在 u 轴上高度集中——这既是分辨率的来源，也是抗噪性能的来源。这一点在后面的数值实验里可以直接量化。' }
        ]
      },
      {
        id: 'lfm', num: '3', title: '为什么对 LFM 有奇效：一次漂亮的相消',
        blocks: [
          { t: 'md', md: '把复 chirp $x(t)=e^{j\\pi k t^2}$（$k$ 为调频斜率）代入定义式，看看会发生什么。' },
          { t: 'math', tex: 'X_\\alpha(u)=A_\\varphi\\,e^{j\\pi u^2\\cot\\varphi}\\int e^{j\\pi k t^2}\\,e^{j\\pi t^2\\cot\\varphi}\\,e^{-j2\\pi ut\\csc\\varphi}dt = A_\\varphi\\,e^{j\\pi u^2\\cot\\varphi}\\int e^{j\\pi(k+\\cot\\varphi)t^2}\\,e^{-j2\\pi ut\\csc\\varphi}dt', tag: '(2)' },
          { t: 'callout', kind: 'warn', title: '关键的那一步', md: '积分号里有两个二次相位项：来自信号的 $e^{j\\pi k t^2}$ 与来自核的 $e^{j\\pi t^2\\cot\\varphi}$。**若令 $k+\\cot\\varphi=0$，两个 chirp 恰好相互抵消**，被积函数退化为一个纯复正弦 $e^{-j2\\pi ut\\csc\\varphi}$，它的积分就是一个 $\\delta$ 函数（有限观测长度下是 sinc 型的主瓣）。**这就是"聚焦"。**' },
          { t: 'math', tex: '\\boxed{\\;k=-\\cot\\varphi_{opt}\\ \\Longleftrightarrow\\ \\alpha_{opt}=-\\frac{2}{\\pi}\\arctan\\!\\left(\\frac{1}{k}\\right)\\;}', tag: '(3)' },
          { t: 'callout', kind: 'note', title: '注意符号约定', md: '不同文献对 $\\cot\\varphi$ 的符号、对 $k$ 的定义（有的用 $\\mu$ 表示瞬时频率斜率、有的用相位斜率的一半）并不统一，**这往往是"照着论文写代码却对不上"的头号原因**。建议在自己的代码里先用一个已知 chirp 做一次标定：扫一遍 $\\alpha$，找出峰值位置，与式 (3) 对照，确定符号后再往下写。' },
          {
            t: 'fold', summary: '展开：聚焦峰的宽度与分辨率分析', deriv: true, blocks: [
              { t: 'md', md: '设观测区间为 $t\\in[-T/2,T/2]$（矩形截断）。在最优阶次上，被积函数退化为 $e^{-j2\\pi ut\\csc\\varphi_{opt}}$，积分结果是 $T\\cdot\\mathrm{sinc}(uT\\csc\\varphi_{opt})$。于是主瓣宽度（到第一个零点）为 $\\Delta u = 2/(T|\\csc\\varphi_{opt}|)$。' },
              { t: 'md', md: '可见**观测时间越长、 chirp 越"陡"（$\\varphi_{opt}$ 越接近 $90^\\circ$ 时 $\\csc$ 越大），聚焦越尖锐**。这与常规傅里叶变换里"分辨率 $= 1/T$"的形式完全一致——**FRFT 只是把同一条分辨率定律搬到了旋转后的坐标轴上。**' },
              { t: 'md', md: '再看**抗噪**：白噪声在酉变换下仍是白噪声，能量均匀铺在整条 u 轴上；而 chirp 的能量全部压进了宽度约 $\\Delta u$ 的一段里。若总能量为 $E$、噪声功率谱密度为 $N_0$，则峰值处的信噪比约为 $\\dfrac{E}{N_0\\Delta u}$——**旋转把 SNR 提高了约一个"压缩比"因子。**这就是 FRFT 在强噪声下仍能稳健估计 chirp 参数的真正原因。' }
            ]
          }
        ]
      },
      {
        id: 'demo', num: '4', title: '数值实验：看那个尖峰',
        blocks: [
          { t: 'md', md: '下面用核心库与本文件的数值实现，对一个复 chirp 做全阶次扫描。左图是 $|X_\\alpha(u)|$ 随 $(\\alpha,u)$ 变化的二维能量图；右图是每一阶次上的峰值幅度随 $\\alpha$ 的变化曲线。' },
          {
            t: 'widget', render: function (el) {
              const N = 192, sq = Math.sqrt(N), dt = 1 / sq;
              const tg = new Float64Array(N);
              for (let n = 0; n < N; n++) tg[n] = (n - N / 2) / sq;
              const mu = 0.8;                       // 无量纲调频斜率
              const tr = new Float64Array(N), ti = new Float64Array(N);
              for (let n = 0; n < N; n++) {
                const ph = 2 * Math.PI * (0.5 * mu * tg[n] * tg[n]);
                tr[n] = Math.cos(ph); ti[n] = Math.sin(ph);
              }
              const NA = 81, MU = 96;
              const aMin = -1, aMax = -0.1;
              const grid = new Float32Array(NA * MU);
              const pkCurve = new Float64Array(NA);
              const axis = new Float64Array(NA);
              let best = { v: -1, a: 0, u: 0 };
              for (let i = 0; i < NA; i++) {
                const a = aMin + (aMax - aMin) * i / (NA - 1);
                axis[i] = a;
                let mxA = 0;
                for (let j = 0; j < MU; j++) {
                  const u = -sq / 2 + sq * j / (MU - 1);
                  const v = frftMagAt(tr, ti, tg, u, a, dt);
                  grid[i * MU + j] = v;
                  if (v > mxA) mxA = v;
                  if (v > best.v) best = { v: v, a: a, u: u };
                }
                pkCurve[i] = mxA;
              }
              const wrap = U.h('div.grid.g2');
              const b1 = DSP.ui.plotBox({});
              wrap.appendChild(b1.el);
              const b2 = DSP.ui.plotBox({});
              wrap.appendChild(b2.el);
              el.appendChild(wrap);
              DSP.plot.heatmap(b1.canvas, {
                data: grid, cols: NA, rows: MU, height: 280,
                xlim: [aMin, aMax], ylim: [-sq / 2, sq / 2], flipY: true,
                xlabel: '阶次 α', ylabel: '分数阶域坐标 u',
                title: '|X_α(u)| 的能量在 (α, u) 平面上聚焦成一个亮点', vmin: 0, vmax: best.v
              });
              const p2 = DSP.plot.new(b2.canvas, {
                height: 280, xlabel: '阶次 α', ylabel: '该阶次上的峰值幅度', legend: false
              });
              p2.add({ x: axis, y: Array.from(pkCurve), color: 0, width: 1.9 })
                .vline(best.a, { label: '实测峰值 α = ' + best.a.toFixed(3) })
                .draw();
              const theoryA = -2 / Math.PI * Math.atan(1 / mu);
              el.appendChild(DSP.ui.metrics([
                { label: '信号调频斜率 k', value: mu.toFixed(2), unit: '（无量纲）' },
                { label: '理论最优阶次', value: theoryA.toFixed(3), unit: '由 cot φ = −k 解出' },
                { label: '数值搜索峰值', value: best.a.toFixed(3), unit: '网格 Δα≈0.011' },
                { label: '聚焦增益', value: (pkCurve[imax(pkCurve)] / (pkCurve[0] || 1)).toFixed(1), unit: '倍（相对 α=−1）' }
              ]));
              el.appendChild(U.h('div.plot-cap', { html: U.md('左图每一个像素都由本文件的 FRFT 核逐项累加得到（$N=192$、$81\\times96$ 网格）。**可以看到能量在 $\\alpha\\approx ' + best.a.toFixed(2) + '$ 处塌成一个孤立的亮点**，而理论预测值为 $-0.570$，两者在网格精度内一致。右图把这个"越来越尖"的过程画成曲线：在错误阶次上信号被摊平，在正确阶次上突然尖锐。') }));
            }
          },
          { t: 'callout', kind: 'eng', title: '这张图在工程上意味着什么', md: '把同样的信号拿去做 STFT，chirp 在时频图上是一条斜线，能量沿线铺开，每个单元内的 SNR 很低；而在最优阶次的 FRFT 域里，全部能量压缩进一个窄尖峰，峰值 SNR 提升可达 10~20 dB。这就解释了大量论文里"FRFT 在低信噪比下仍能稳健估计 LFM 参数"的结论。' }
        ]
      },
      {
        id: 'disc', num: '5', title: '离散实现：Ozaktas 采样型算法要点',
        blocks: [
          { t: 'md', md: '直接按定义做二重数值求和是 $O(N^2)$。Ozaktas 等人提出的采样型算法把它降到 $O(N\\log N)$，思路是把核函数拆成"两次 chirp 相乘 + 一次 chirp 卷积"：' },
          { t: 'math', tex: 'X_\\alpha(u)=A_\\varphi\\,e^{j\\pi u^2(\\cot\\varphi-\\csc\\varphi)}\\cdot\\mathcal{F}^{-1}\\Bigl\\{\\mathcal{F}\\{g(t)\\}\\cdot\\mathcal{F}\\{h(s)\\}\\Bigr\\},\\quad g(t)=x(t)e^{j\\pi t^2(\\cot\\varphi-\\csc\\varphi)}', tag: '(4)' },
          { t: 'flow', items: [
            { t: '① 乘 chirp', kind: 'io', d: '把信号乘上 exp[jπt²(cotφ − cscφ)]' },
            { t: '② 与 chirp 卷积', kind: 'dsp', d: '与 h(s)=exp(jπs²·cscφ) 卷积，用 FFT 加速' },
            { t: '③ 再乘 chirp', kind: 'dsp', d: '乘 exp[jπu²(cotφ − cscφ)] 并做缩放' },
            { t: '④ 量纲缩放', kind: 'out', d: '按 Δt 与 Δu 的关系做幅度缩放，保证能量守恒' }
          ] },
          { t: 'callout', kind: 'warn', title: '三个实现陷阱', md: '1. **必须做两倍数采样**：步骤 ② 的卷积结果长度是原序列的两倍，**必须对输入先上采样 2 倍再处理**，否则卷积会混叠。\n2. **量纲归一化不能省**：连续 FRFT 的旋转在两个轴上要求同量纲。工程做法是先按 $T=\\sqrt{N}$ 把时间与频率都归一化，处理完再换算回物理量。\n3. **$\\alpha$ 接近 0 或 2 时 $\\csc\\varphi$ 发散**：此时应直接退化为恒等/时间反演运算，另行分支处理。' },
          { t: 'md', md: '**阶次搜索**是实际应用的重要环节：通常先把 $\\alpha\\in(-1,1)$（或按需放宽）按步长 $10^{-3}\\sim10^{-2}$ 粗扫一遍，找到峰值后在其邻域做细化（黄金分割或抛物线插值）。**粗扫 + 细搜**两级策略能把总计算量控制在几十次 FFT 以内，足以实时。' }
        ]
      },
      {
        id: 'app', num: '6', title: '工程应用：LFM 参数估计与干扰抑制',
        blocks: [
          { t: 'callout', kind: 'eng', title: '杀手级应用：宽带扫频干扰抑制', md: '现代雷达常受到**扫频干扰**（敌方干扰机或民用调频信号）。这类干扰在时频图上是斜线，用传统的陷波器无法对付（它占满整个频带），用 STFT 域掩模则容易伤及目标回波。\n\n**FRFT 方案**：① 估计干扰的调频斜率 → 得到其最优阶次 $\\alpha_j$；② 在该阶次的 FRFT 域里，干扰聚焦为一个极窄的尖峰，而目标回波仍摊得很平；③ 在该域做**窄带陷波（把尖峰位置的几个样点置零）**；④ 做 $-\\alpha_j$ 阶的逆 FRFT 变回时域。\n\n**效果**：干扰被抑制 20~40 dB，而目标回波的损失只有约 1 dB。**这是"换一个域去做滤波"最有说服力的范例之一。**同样的思路也用在声呐里消除扫频式渔探仪干扰与线性调频通信信号的剥离。' },
          { t: 'table', cols: ['应用', '做法', '收益'], rows: [
            ['LFM 参数估计', '扫 α 找聚焦峰 → 由 α_opt 反解调频斜率，由峰位置 u 反解中心频率', '低信噪比下仍稳健；比解线调更简单'],
            ['扫频干扰抑制', '在 FRFT 域做窄带陷波后逆变换', '干扰衰减大、信号损失小'],
            ['多分量 chirp 分离', '逐次消去：找最强峰 → 陷掉 → 再搜索下一个峰', '能把叠在一起的多个 chirp 逐个拆出来'],
            ['chirp 信号检测', 'FRFT 域峰值与 CFAR 门限比较', '比能量检测器更抗噪'],
            ['水声通信同步', '用 FRFT 检测同步 chirp 头', '对多径与时延扩展鲁棒性更好']
          ] },
          { t: 'md', md: '再强调一遍它与时频分析的互补关系：FRFT 是"全局"的线性变换，擅长处理整段都是同一斜率的 chirp；若 chirp 的斜率随时间变化（非线性调频），或同时存在多个明显不同的斜率，就需要回到 STFT / 小波这类局域工具，或采用分段 FRFT。' }
        ]
      },
      {
        id: 'limit', num: '7', title: '局限、参数估计与坑',
        blocks: [
          { t: 'md', md: 'FRFT 不是万能的，它的代价很明确：' },
          { t: 'table', cols: ['局限', '原因', '应对'], rows: [
            ['需要搜索阶次 α', '先验不知道 chirp 斜率', '粗扫 + 细搜；也可用 Radon-Wigner 变换直接估计方向'],
            ['多分量需逐次消去', '每个分量有各自的 α_opt', '迭代 CLEAN 策略；强分量估计误差会传播给弱分量'],
            ['对非理想 chirp 退化', '非线性调频、加速度导致的相位二次项使聚焦退化', '分段处理或改用局域时频方法'],
            ['计算量高于单次 FFT', '需多次 FFT；且要做 2 倍上采样', '离线或中等实时场合；FPGA 上可用专用流水线'],
            ['量纲归一化容易搞错', '连续定义要求时频同轴度量纲', '统一先做 t/√N 归一化，最后再换算回来']
          ] },
          { t: 'md', md: '**参数反算公式**（得到聚焦峰位置 $(\\alpha_{opt},u_{opt})$ 之后）：设调频斜率为 $\\mu$（Hz/s），采样间隔为 $\\Delta t$，则旋转角满足 $\\cot\\varphi_{opt}=-\\mu\\Delta t\\cdot C$（$C$ 为所选归一化方案决定的常数），再由峰位置 $u_{opt}$ 反解中心频率。**务必用已知信号标定一次再写进产品。**' }
        ]
      },
      {
        id: 'pit', num: '8', title: '误区专栏',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 以为 FRFT 是万能变换，什么信号都能聚焦', md: '它只对 chirp（以及近似 chirp）有效。对单频 CW、脉冲、随机噪声，聚焦效果并不好——它们的"最优角度"就是 0° 或 90°，那时 FRFT 已经退化成普通变换。先判断信号是不是调频类型，再决定要不要上 FRFT。' },
          { t: 'callout', kind: 'pit', title: '② α 的归一化因子弄错', md: '不同教材、不同工具包对时间的归一化方式不同，导致"按公式算出的 $\\alpha_{opt}$ 与代码里扫出来的对不上"。**这几乎占初学者问题的八成。解决办法只有一个：用已知斜率的 chirp 跑一次标定。**' },
          { t: 'callout', kind: 'pit', title: '③ 忽略离散化的采样要求', md: 'Ozaktas 算法中卷积环节需要 2 倍上采样，遗漏后结果会产生混叠，**表现往往是"聚焦峰旁边出现莫名其妙的双胞胎峰"。**做 FRFT 后最好用 $\\alpha=1$ 退化测试：结果必须与一次普通 FFT 完全一致。' },
          { t: 'callout', kind: 'pit', title: '④ 认为 FRFT 比匹配滤波更优', md: '在已知参考波形的检测场合，匹配滤波（脉冲压缩）是理论最优的，FRFT 不会更好。FRFT 的价值在于你不知道确切参数、或者要在存在干扰的情况下把参数估出来。两者是互补关系，不是替代关系。' },
          { t: 'callout', kind: 'eng', title: '工程提示：如何判断该不该用', md: '三条快速判据：① 信号的时频图是不是直的斜线（不是曲线、不是折线）；② 它的斜率是不是全程恒定（不是分段）；③ 你是否需要在干扰背景下把它的参数估出来。三条都满足，FRFT 大概率会带来 10 dB 以上的处理增益；任一条不满足，请先退回 STFT / 小波 / 匹配滤波。' }
        ]
      }
    ],
    refs: [
      'Ozaktas, Zalevsky & Kutay, The Fractional Fourier Transform, Wiley, 2001',
      'Almeida, "The Fractional Fourier Transform and Time-Frequency Representations", IEEE T-SP, 1994',
      'Capus & Brown, "Short-time Fractional Fourier Methods for the Time-Frequency Representation of Chirp Signals", JASA, 2003'
    ]
  });

  /* @@APPEND@@ */
})(window);

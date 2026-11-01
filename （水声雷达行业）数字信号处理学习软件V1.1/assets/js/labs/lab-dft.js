/* =============================================================
   lab-dft.js —— 实验台②：DFT/FFT 的栅栏效应与频谱泄漏
   路由：lab/dft

   教学目的：把"谱上看到的"与"真实存在的"分开。
   三幅图：时域 / 幅度谱（可叠加窗对比） / 主瓣局部放大 + 周期延拓示意。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  const FS = 1000;

  DSP.lab.create({
    path: 'lab/dft',
    title: '② DFT/FFT：栅栏效应与频谱泄漏',
    lede: '同一个正弦，只因为"是不是整数个周期落在观测窗里"，谱就从一根干净的线变成一坨裙边。这个实验台让你亲手把这两种情况来回切换。',
    tags: ['DFT', 'FFT', '频谱泄漏', '栅栏效应', '交互'],
    cols: 2,

    params: [
      { k: 'N', type: 'slider', label: 'DFT 点数 N', min: 32, max: 1024, step: 32, value: 256, hint: 'Δf = f_s / N，N 越大网格越密' },
      { k: 'f0', type: 'slider', label: '正弦频率 f₀', min: 10, max: 490, step: 0.5, value: 100, unit: 'Hz', hint: '试 100（整数周期）与 105.5（非整数周期）' },
      { k: 'win', type: 'select', label: '窗函数', options: [
        { value: 'rect', label: '矩形窗（= 不加窗，泄漏最大）' },
        { value: 'hann', label: '汉宁 Hann（通用默认）' },
        { value: 'hamming', label: '汉明 Hamming' },
        { value: 'blackman', label: '布莱克曼 Blackman' },
        { value: 'blackmanharris', label: '布莱克曼-哈里斯（超低旁瓣）' }
      ], value: 'rect', hint: '窗同时决定主瓣宽（分辨力）与旁瓣高（动态范围）' },
      { k: 'zp', type: 'seg', label: '补零倍数', options: [
        { value: '1', label: '1×（不补零）' },
        { value: '4', label: '4×' },
        { value: '16', label: '16×' }
      ], value: '1', hint: '补零只让谱线更密（频域内插），不提高真实分辨率' },
      { k: 'dual', type: 'toggle', label: '叠加第二个正弦（考察分辨能力）', value: false },
      { k: 'df2', type: 'slider', label: '两频率间隔 Δf', min: 0.5, max: 60, step: 0.5, value: 12, unit: 'Hz', hint: 'Δf 小于窗主瓣宽时两个峰糊成一个' },
      { k: 'snr', type: 'slider', label: '叠加噪声后的 SNR', min: 0, max: 60, step: 1, value: 40, unit: 'dB', hint: '调低可看到噪声底如何盖住泄漏' },
      { k: 'dB', type: 'toggle', label: '纵轴用 dB（否则线性）', value: true }
    ],

    plots: [
      { key: 'time', title: '时域：信号 × 窗', height: 230, opts: { xlabel: 'n', ylabel: '幅度', legend: true } },
      { key: 'spec', title: '幅度谱（归一化）', height: 260, opts: { xlabel: '频率 / Hz', ylabel: '幅度 / dB', legend: true } },
      { key: 'zoom', title: '主瓣局部放大（看栅栏与泄漏）', height: 240, opts: { xlabel: '频率 / Hz', ylabel: '幅度 / dB', legend: true } },
      { key: 'wrap', title: '周期延拓：DFT 隐含认为这段波形首尾相接', height: 230, opts: { xlabel: 'n', ylabel: '幅度', legend: true } }
    ],

    update: function (st, P, ui) {
      const N = st.N, f0 = st.f0;
      const df = FS / N;
      const zp = parseInt(st.zp, 10);
      const NF = C.nextPow2(N * zp);
      const win = C.window(st.win, N);
      const wm = C.windowMetrics(st.win);

      /* ---------- 信号 ---------- */
      const comps = [{ freq: f0, amp: 1 }];
      if (st.dual) comps.push({ freq: f0 + st.df2, amp: 0.8 });
      const clean = C.multisin(N, FS, comps);
      const x = C.addNoise(clean, st.snr, 20250101);

      /* ---------- 图①：时域 信号与窗 ---------- */
      const n = U.arange(0, N);
      P.time.plot.clear()
        .add({ x: n, y: Array.from(x), color: 1, width: 1.1, alpha: 0.75, label: 'x[n]（含噪）' })
        .add({ x: n, y: Array.from(win), color: 3, width: 1.6, dash: [5, 3], label: C.WINDOWS[st.win].name + ' w[n]' })
        .draw();

      /* ---------- 频谱（加窗 / 未加窗对比） ---------- */
      function spectrum(sig, w) {
        const xw = new Float64Array(N);
        let sw = 0;
        for (let i = 0; i < N; i++) { xw[i] = sig[i] * w[i]; sw += w[i]; }
        const S = C.fft(xw, NF);
        const mag = Array.from(C.mag(S)).slice(0, NF / 2 + 1);
        const f = U.linspace(0, FS / 2, NF / 2 + 1);
        const norm = sw / 2;                       // 单频幅度归一化（相干增益）
        const amp = mag.map(v => v / Math.max(norm, 1e-12));
        return { f: f, amp: amp, db: amp.map(v => 20 * Math.log10(Math.max(v, 1e-9))) };
      }
      const ones = new Float64Array(N).fill(1);
      const A = spectrum(x, win);
      const B = spectrum(x, ones);

      const yOf = st.dB ? A.db : A.amp;
      const yB = st.dB ? B.db : B.amp;
      const p2 = P.spec.plot;
      p2.clear()
        .add({ x: A.f, y: yOf, color: 0, width: 1.6, label: '加窗：' + C.WINDOWS[st.win].name })
        .add({ x: B.f, y: yB, color: 4, width: 1, alpha: 0.55, label: '未加窗（矩形）' });
      if (st.dB) p2.hline(-60, { dash: [4, 4], label: '-60 dB' });
      p2.vline(f0, { color: '#0f766e', dash: [3, 3], label: 'f₀=' + f0.toFixed(1) + ' Hz' });
      if (st.dual) p2.vline(f0 + st.df2, { color: '#7c3aed', dash: [3, 3], label: 'f₀+Δf' });
      p2.draw();

      /* ---------- 图③：主瓣放大 ---------- */
      const k0 = f0 / df;                                    // 真实频率对应的"连续"谱线位置
      const span = Math.max(6 * wm.mainLobe * df, 40);
      const lo = Math.max(0, f0 - span), hi = Math.min(FS / 2, f0 + span);
      const sel = A.f.map((v, i) => (v >= lo && v <= hi) ? i : -1).filter(i => i >= 0);
      const zx = sel.map(i => (A.f[i] - f0) / df);           // 以 bin 为单位
      const p3 = P.zoom.plot;
      p3.clear()
        .add({ x: zx, y: sel.map(i => A.db[i]), color: 0, width: 1.8, label: '加窗（bin 坐标，0 = f₀）' })
        .add({ x: zx, y: sel.map(i => B.db[i]), color: 4, width: 1, alpha: 0.6, label: '未加窗' });
      // DFT 的离散谱线（栅栏）用杆图画出
      const gridBins = [];
      const gy = [];
      for (let k = Math.floor(lo / df); k <= Math.ceil(hi / df); k++) {
        gridBins.push(k - f0 / df);
        const i = Math.round(k * (NF / N));
        gy.push(i < A.db.length ? A.db[i] : -120);
      }
      p3.add({ x: gridBins, y: gy, type: 'stem', color: 2, width: 1.2, alpha: 0.9, label: 'DFT 谱线位置（栅栏）' });
      p3.vline(0, { color: '#0f766e', dash: [2, 2], label: '真实 f₀' });
      p3.draw();

      /* ---------- 图④：周期延拓 ---------- */
      const rep = 2;
      const xw2 = new Float64Array(N * rep);
      for (let i = 0; i < N * rep; i++) xw2[i] = x[i % N];
      const n2 = U.arange(0, N * rep);
      P.wrap.plot.clear()
        .add({ x: n2, y: Array.from(xw2), color: 1, width: 1.3, label: 'DFT 眼中的信号：首尾相接（截断处按相位连续才无跳变）' });
      P.wrap.plot.vline(N, { color: '#b91c1c', dash: [4, 3], label: '延拓边界' });
      P.wrap.plot.draw();

      /* ---------- 解读 ---------- */
      const cycles = f0 / df;                                // 观测窗内的周期数
      const isInt = Math.abs(cycles - Math.round(cycles)) < 1e-6;
      // 泄漏度量：谱上远离主瓣 ±3 主瓣外的最大电平
      let leak = -200;
      for (let i = 0; i < A.db.length; i++) {
        if (Math.abs(A.f[i] - f0) > 3 * wm.mainLobe * df + df) leak = Math.max(leak, A.db[i]);
      }
      // 峰值幅度误差（扇贝损失相关）
      let pk = -1e9, pkAt = 0;
      for (let i = 0; i < A.db.length; i++) if (A.db[i] > pk) { pk = A.db[i]; pkAt = i; }
      const ampErr = st.dB ? pk : 20 * Math.log10(pk);

      let txt = '';
      txt += '**频率分辨率** $\\Delta f = f_s/N = ' + FS + '/' + N + ' = ' + df.toFixed(3) + '\\,\\text{Hz}$；观测窗内包含 $f_0/\\Delta f = ' + cycles.toFixed(3) + ' $ 个周期。\n\n';

      if (isInt) {
        txt += '**整数周期截断**（$' + Math.round(cycles) + '$ 个完整周期）：第 4 幅图里首尾严丝合缝，延拓后没有跳变，所以谱是一根干净的线（只有窗自身的主瓣/旁瓣），**没有泄漏**。这也是唯一一种不需要加窗的情况。\n\n';
      } else {
        txt += '**非整数周期截断**（$' + cycles.toFixed(2) + '$ 个周期，缺 $' + ((Math.round(cycles) - cycles)).toFixed(2) + '$ 个周期的零头）：延拓边界上出现**相位跳变**，这个跳变在频域表现为整条频率轴上的裙边——这就是频谱泄漏。当前远离主瓣的最高泄漏电平约 $' + leak.toFixed(1) + '\\,\\text{dB}$（矩形窗理论上第一旁瓣只有 −13 dB）。\n\n';
      }

      txt += '**栅栏效应**：真实频率落在两根 DFT 谱线之间（第 3 幅图的杆就是 DFT 实际取样的位置），峰被"削"掉一截，幅度最大可差 $\\approx' + (20 * Math.log10(Math.PI / 2)).toFixed(1) + '\\,\\text{dB}$（矩形窗的扇贝损失 3.92 dB）。当前最高谱线读数 $' + pk.toFixed(2) + '\\,\\text{dB}$（理想应为 0 dB）。\n\n';

      txt += '**补零的倍数 ' + zp + '×**：谱线加密了 ' + zp + ' 倍，看起来更平滑，但**主瓣宽度没有变窄**——所以补零不提高真实分辨率，只减小了栅栏带来的读数误差。要提高分辨率只能延长观测时间（增大 N 或降低 f_s 后加长数据）。\n\n';

      txt += '**当前窗**：' + C.WINDOWS[st.win].name + '（' + C.WINDOWS[st.win].en + '），主瓣 $' + wm.mainLobe.toFixed(2) + '\\,\\text{bin}$（$= ' + (wm.mainLobe * df).toFixed(2) + '\\,\\text{Hz}$），最高旁瓣 $' + wm.sll.toFixed(1) + '\\,\\text{dB}$，等效噪声带宽 $' + wm.enbw.toFixed(3) + '\\,\\text{bin}$（处理损失 $' + (10 * Math.log10(wm.enbw)).toFixed(2) + '\\,\\text{dB}$）。';
      if (st.dual) {
        const mainHz = wm.mainLobe * df;
        txt += '\n\n**双音分辨**：间隔 $\\Delta f_{2} = ' + st.df2 + '\\,\\text{Hz}$，窗主瓣宽 $' + mainHz.toFixed(2) + '\\,\\text{Hz}$ → ' +
          (st.df2 > mainHz ? '**可以分辨**（间隔大于主瓣宽）。' : '**不能分辨**（间隔小于主瓣宽，两个主瓣糊成一个）。注意：换成低旁瓣窗虽然能压泄漏，却会**加宽主瓣反而更分不开**——这就是窗函数的核心权衡。');
      }

      ui.explain(txt);

      ui.metrics([
        { label: 'Δf', value: df.toFixed(3), unit: 'Hz' },
        { label: '窗内周期数', value: cycles.toFixed(3), unit: '个' },
        { label: '泄漏电平', value: leak.toFixed(1), unit: 'dB' },
        { label: '主瓣宽', value: (wm.mainLobe * df).toFixed(2), unit: 'Hz' },
        { label: '最高旁瓣', value: wm.sll.toFixed(1), unit: 'dB' }
      ]);
    },

    advice: '① 先把 f₀ 设成 100 Hz、N=256（Δf=3.906 Hz，100/3.906 = 25.6 个周期，非整数），看矩形窗下泄漏有多严重；再把 f₀ 拖到 125 Hz（正好 32 个周期），泄漏瞬间消失——这就是"整数周期采样"的威力。② 保持非整数周期，依次切换窗：矩形 −13 dB → 汉宁 −32 dB → 布莱克曼哈里斯 −92 dB，同时盯住"主瓣宽"指标，你会看到旁瓣每降 20 dB，主瓣就宽一倍。③ 打开双音，把 Δf 从 40 Hz 拖到 3 Hz，观察两个峰如何合并；然后换窗，体会"低旁瓣窗反而更分不开"。④ 把 SNR 拖到 0 dB，看噪声底如何把泄漏完全淹没（此时加不加窗已无所谓）。',

    eng: '（1）做**绝对幅度标定**时必须补 ENBW 损失：$10\\log_{10}(\\mathrm{ENBW})$（汉宁 1.76 dB），否则不同窗的数据对不上。（2）要精确读频率而不是幅度时，用**插值 FFT**（三点/质心法）消除栅栏误差，比补零更省算力。（3）泄漏与杂散的区别：泄漏来自截断，杂散来自 ADC 非线性/时钟——加大 N 能治泄漏，治不了杂散。（4）被动声呐 LOFAR 谱里，强线谱的泄漏会盖住 −60 dB 的弱线谱，所以必须加低旁瓣窗（通常汉宁或 BH），这是动态范围的刚需而非美化。（5）FFT 点数不是越大越好：N 决定的是"看多细"，而"看多久"由 T = N/f_s 决定，二者常常互相打架。',

    wrong: '① 以为补零能提高分辨率——它只是频域内插，主瓣宽度纹丝不动。② 以为加窗能消除泄漏——加窗只是把泄漏重新分配成"主瓣变宽 + 旁瓣变低"，总泄漏能量守恒（吉布斯现象同理）。③ 用 dB 谱看"泄漏消失"其实是被噪声底盖住了，不是真没了。④ 把 DFT 的镜像（k > N/2）当成第二个频率分量。⑤ 直接用 FFT 幅度做功率估计却忘了除 N、忘了单边谱的 ×2、忘了窗的 ENBW——三个错误叠起来能差 10 dB 以上。',

    see: [
      { path: 'theory/transform/dft', title: 'DFT 离散傅里叶变换' },
      { path: 'theory/transform/fft', title: 'FFT 与蝶形运算' },
      { path: 'lab/window', title: '③ 窗函数横向对比' }
    ]
  });
})(window);

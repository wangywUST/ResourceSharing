/* =============================================================
   lab-sampling.js —— 实验台①：采样定理与混叠
   路由：lab/sampling

   教学目的：让"混叠"这件事从抽象公式变成看得见的假频率。
   三幅图：连续信号 + 采样点 / 离散频谱 / 折叠路径示意。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  DSP.lab.create({
    path: 'lab/sampling',
    title: '① 采样定理与混叠',
    lede: '把采样率从高拖到低，看一个 300 Hz 的真实正弦怎么"变成"另一个频率——混叠永远发生在采样那一刻，事后再怎么算都救不回来。',
    tags: ['采样', '奈奎斯特', '混叠', '交互'],
    cols: 2,

    params: [
      { k: 'f0', type: 'slider', label: '信号频率 f₀', min: 20, max: 900, step: 5, value: 300, unit: 'Hz', hint: '被采样的"真实"正弦频率' },
      { k: 'fs', type: 'slider', label: '采样率 f_s', min: 100, max: 2000, step: 10, value: 1000, unit: 'Hz', hint: '奈奎斯特频率 f_s/2 是能表示的最高频率' },
      { k: 'N', type: 'slider', label: '采样点数 N', min: 16, max: 512, step: 16, value: 128, hint: '观测时长 T = N/f_s，决定频率分辨率 f_s/N' },
      { k: 'comp', type: 'seg', label: '信号构成', options: [
        { value: 'single', label: '单频' },
        { value: 'dual', label: '双频' },
        { value: 'noise', label: '单频+噪声' }
      ], value: 'single' },
      { k: 'f1', type: 'slider', label: '第二频率 f₁', min: 20, max: 900, step: 5, value: 700, unit: 'Hz', hint: '仅在"双频"模式下生效' },
      { k: 'snr', type: 'slider', label: '信噪比', min: -10, max: 30, step: 1, value: 10, unit: 'dB', hint: '仅在"单频+噪声"模式下生效' },
      { k: 'aaf', type: 'toggle', label: '加抗混叠滤波（把 |f|>f_s/2 的分量去掉）', value: false, hint: '模拟真实采集前端：先滤再采' },
      { k: 'showFold', type: 'toggle', label: '显示频率折叠路径', value: true }
    ],

    plots: [
      { key: 'time', title: '连续信号与采样点（前 20 ms）', height: 250, opts: { xlabel: 't / ms', ylabel: '幅度', legend: true } },
      { key: 'spec', title: '离散频谱 |X[k]|（只看 0 ~ f_s）', height: 250, opts: { xlabel: '频率 / Hz', ylabel: 'dB', legend: true, ylim: [-70, 5] } },
      { key: 'fold', title: '频率折叠地图：真实频率 → 观测频率', height: 250, opts: { xlabel: '真实频率 f / Hz', ylabel: '观测到的频率 / Hz', legend: false } }
    ],

    update: function (st, P, ui) {
      const f0 = st.f0, fs = st.fs, N = st.N;
      const fN = fs / 2;                     // 奈奎斯特频率
      const T = N / fs;

      /* ---------- 1. 构造"连续"信号（用高倍过采样近似） ---------- */
      const M = 16;                          // 过采样倍数，用于画平滑曲线
      const fsHi = fs * M;
      const nHi = Math.max(256, Math.min(4000, Math.round(fsHi * 0.02)));  // 画 20 ms
      const tHi = U.linspace(0, nHi / fsHi, nHi);
      const cont = new Float64Array(nHi);
      const comps = st.comp === 'dual' ? [{ freq: f0, amp: 1 }, { freq: st.f1, amp: 0.7 }] : [{ freq: f0, amp: 1 }];
      for (let i = 0; i < nHi; i++) {
        let v = 0;
        for (const c of comps) v += c.amp * Math.sin(2 * Math.PI * c.freq * tHi[i]);
        cont[i] = v;
      }
      // 抗混叠滤波：把 |f| > fN 的分量去掉（按分量处理，等价于理想 AAF）
      const compsEff = st.aaf ? comps.filter(c => c.freq <= fN) : comps.slice();

      /* ---------- 2. 采样 ---------- */
      const xs = new Float64Array(N);
      const ts = new Float64Array(N);
      for (let n = 0; n < N; n++) {
        ts[n] = n / fs;
        let v = 0;
        for (const c of compsEff) v += c.amp * Math.sin(2 * Math.PI * c.freq * ts[n]);
        xs[n] = v;
      }
      let x = xs;
      if (st.comp === 'noise') x = C.addNoise(xs, st.snr, 20241024);

      /* ---------- 3. 图①：连续 + 采样点 ---------- */
      const p1 = P.time.plot;
      const tMs = Array.from(tHi).map(v => v * 1000);
      const sMs = Array.from(ts).map(v => v * 1000);
      const nShow = Math.min(N, Math.max(4, Math.round(fs * 0.02)));
      p1.clear()
        .add({ x: tMs, y: Array.from(cont), color: 1, width: 1.1, alpha: 0.55, label: '“连续”信号（16× 过采样画出）' })
        .add({ x: sMs.slice(0, nShow), y: Array.from(x).slice(0, nShow), type: 'scatter', color: 2, size: 3.4, label: '采样点 (f_s=' + fs + ' Hz)' });
      // 叠加"观测到的频率"曲线，直观显示假频率
      const fObs0 = C.aliasFreq(st.aaf && f0 > fN ? 0 : f0, fs);
      if (Math.abs(fObs0 - (st.aaf && f0 > fN ? 0 : f0)) > 0.5) {
        p1.add({
          x: tMs, y: tMs.map(t => Math.sin(2 * Math.PI * fObs0 * t / 1000) * (st.aaf && f0 > fN ? 0 : 1)),
          color: 3, dash: [5, 3], width: 1.5, label: '观测到的 ' + fObs0.toFixed(0) + ' Hz'
        });
      }
      p1.draw();

      /* ---------- 4. 图②：离散频谱（0 ~ fs，展示镜像） ---------- */
      const NF = Math.max(1024, C.nextPow2(N) * 4);
      const S = C.fft(x, NF);
      const mag = C.mag(S);
      let mx = 0; for (let i = 0; i < mag.length; i++) mx = Math.max(mx, mag[i]);
      const fFull = C.fftFreq(NF, fs);           // -fs/2 … fs/2
      const idxOf = f => Math.round((f / fs) * NF);
      const i0 = idxOf(0), i1 = idxOf(fs);
      const fx = [], fy = [];
      for (let i = i0; i < i1; i++) {
        fx.push(fFull[(i + NF) % NF]);
        fy.push(20 * Math.log10(Math.max(mag[i], 1e-12) / mx));
      }
      const p2 = P.spec.plot;
      p2.clear().add({ x: fx, y: fy, color: 0, width: 1.4, label: 'N=' + N + ' 点 DFT（补零到 ' + NF + '）' });
      p2.vline(fN, { color: '#b91c1c', label: 'f_s/2 = ' + fN.toFixed(0) + ' Hz（镜像轴）' });
      compsEff.forEach((c, i) => p2.vline(c.freq, { color: '#0f766e', dash: [3, 3], label: '真实 ' + c.freq + ' Hz' }));
      compsEff.forEach(c => {
        const fa = C.aliasFreq(c.freq, fs);
        if (Math.abs(fa - c.freq) > 0.5) p2.vline(fa, { color: '#c2410c', dash: [6, 3], label: '混叠 → ' + fa.toFixed(0) + ' Hz' });
      });
      p2.draw();

      /* ---------- 5. 图③：折叠地图 ---------- */
      const p3 = P.fold.plot;
      if (st.showFold) {
        const gx = U.linspace(0, 950, 400);
        const gy = gx.map(f => f > fN ? C.aliasFreq(f, fs) : f);
        p3.clear()
          .add({ x: gx, y: gy, color: 0, width: 1.5, label: '观测频率 = 折叠后的真实频率' })
          .vline(fN, { color: '#b91c1c', label: 'f_s/2' });
        compsEff.forEach(c => p3.annotate(c.freq, C.aliasFreq(c.freq, fs) + 22, 'f₀=' + c.freq, {}));
        p3.add({ x: compsEff.map(c => c.freq), y: compsEff.map(c => C.aliasFreq(c.freq, fs)), type: 'scatter', color: 3, size: 5 });
        p3.draw();
      } else {
        p3.clear().add({ x: [0, 1], y: [0, 1] }).draw();
      }

      /* ---------- 6. 实时解读 ---------- */
      const alias = comps.map(c => ({
        f: c.freq,
        fa: C.aliasFreq(c.freq, fs),
        bad: c.freq > fN
      }));
      const bad = alias.filter(a => a.bad);
      const df = fs / N;

      let txt = '';
      txt += '**当前配置**：$f_s = ' + fs + '\\,\\text{Hz}$，奈奎斯特频率 $f_s/2 = ' + fN.toFixed(0) + '\\,\\text{Hz}$，观测时长 $T = N/f_s = ' + (T * 1000).toFixed(1) + '\\,\\text{ms}$，频率分辨率 $\\Delta f = f_s/N = ' + df.toFixed(2) + '\\,\\text{Hz}$。\n\n';

      if (st.aaf) {
        const killed = comps.filter(c => c.freq > fN);
        txt += '**已开启抗混叠滤波**：' + (killed.length
          ? '超过 $f_s/2$ 的分量（' + killed.map(c => c.freq + ' Hz').join('、') + '）在采样前被滤掉了，所以不会再产生假频率——代价是这些分量**被永久丢弃**。'
          : '当前所有分量都在 $f_s/2$ 以内，滤波器没有起作用。') + '\n\n';
      }

      if (!bad.length) {
        txt += '**没有混叠**：所有分量频率都低于 $f_s/2$，采样点足够密，频谱上出现的峰就是真实频率，采样点连起来也和原信号一致。\n\n';
        txt += '注意看第 2 幅图：$f_s/2$ 右侧还有一个镜像峰（' + (fs - f0).toFixed(0) + ' Hz），那是**负频率分量的搬移副本**，不是混叠，也不是新目标——这是 DFT 的固有结构。';
      } else {
        const a = bad[0];
        const zone = Math.floor(a.f / fN) + 1;
        txt += '**发生混叠！** 真实频率 $f_0 = ' + a.f + '\\,\\text{Hz}$ 已超过 $f_s/2 = ' + fN.toFixed(0) + '\\,\\text{Hz}$（位于第 ' + zone + ' 奈奎斯特区），观测到的却是 $f_{alias} = ' + a.fa.toFixed(0) + '\\,\\text{Hz}$。\n\n';
        txt += '折叠公式：$f_{alias} = |f_0 - f_s\\cdot\\mathrm{round}(f_0/f_s)| = |' + a.f + ' - ' + fs + '\\times' + Math.round(a.f / fs) + '| = ' + a.fa.toFixed(0) + '\\,\\text{Hz}$。\n\n';
        txt += '**关键**：采样点（橙色散点）是"诚实的"——它们确实落在原正弦上；但**从这一组离散样本出发，永远无法区分它到底是 ' + a.f + ' Hz 还是 ' + a.fa.toFixed(0) + ' Hz**。第 2 幅图里 ' + a.fa.toFixed(0) + ' Hz 那个峰看起来干干净净，这就是混叠最危险的地方：它不会让图变难看，只会让结论变错。';
      }

      ui.explain(txt);

      ui.metrics([
        { label: 'f_s / 2', value: fN.toFixed(0), unit: 'Hz' },
        { label: '频率分辨率', value: df.toFixed(2), unit: 'Hz' },
        { label: '观测时长', value: (T * 1000).toFixed(1), unit: 'ms' },
        { label: '观测频率', value: alias.map(a => a.fa.toFixed(0)).join(' / '), unit: 'Hz' },
        { label: '混叠', value: bad.length ? '是' : '否', unit: '' }
      ]);
    },

    advice: '先把 f₀ 固定 300 Hz，把 f_s 从 2000 慢慢拖到 150：会依次看到（1）谱峰位置始终正确；（2）f_s 略高于 600 Hz 时镜像峰开始逼近；（3）f_s 跌破 2f₀ 后主峰突然跳到另一个频率，而采样点仍然完美落在原波形上。再打开"双频"模式，把 f₁ 设为 700 Hz、f_s 设为 1000 Hz，观察两个分量分别折到 300 Hz 和 300 Hz——它们会**重叠成一个峰**，这就是多分量混叠最难处理的地方。',

    eng: '（1）抗混叠滤波器必须在 ADC **之前**，且是模拟的；数字域再怎么滤波都救不回已经折叠的能量。（2）工程上永远不要卡在 f_s = 2f_max：取 f_s ≥ (2.5~4)f_max，把过渡带留给滤波器。（3）采样时钟抖动会独立限制 SNR：$\\mathrm{SNR}_{jit}\\approx-20\\log_{10}(2\\pi f t_{jit})$，与 ADC 位数无关——高频采集时抖动往往才是瓶颈。（4）水声与雷达的中频数字化常用**带通采样**有意折叠，但那要求前端带通滤波器足够陡，且 ADC 模拟输入带宽覆盖 f_H（而不是 f_s/2）。',

    wrong: '① 看频谱"很干净"就以为没混叠——混叠后的谱往往看起来完全正常，判断是否混叠只能看输入带宽与滤波器指标。② 以为提高 FFT 点数能分辨混叠——补零只加密谱线，不增加信息。③ 在 f_s 已经太低的数据上做"频谱细化"或"超分辨"，试图把折叠开的分量找回来——数学上不可能。④ 把 DFT 中 f_s/2 右侧的镜像峰当成第二个目标。',

    see: [
      { path: 'theory/basic/sampling', title: '采样定理与混叠机理' },
      { path: 'theory/basic/bandpass', title: '欠采样与带通采样' },
      { path: 'theory/basic/quant', title: '量化、A/D 与 D/A 转换' }
    ]
  });
})(window);

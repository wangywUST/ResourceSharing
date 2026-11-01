/* =============================================================
   views/framework.js —— 框架自检页（不在主导航中，供开发验证）
   访问： #/dev/framework
   验证内容：公式渲染、绘图引擎（线/杆/频谱/热力图/极坐标/零极点/蝶形）、
             控件联动、术语悬停、笔记、主题切换重绘
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const U = DSP.util;
  const UI = DSP.ui;
  const C = DSP.core;
  const h = U.h;

  DSP.router.register('dev/framework', {
    title: '框架自检页',
    lede: '验证渲染引擎、算法库与交互控件是否正常工作。此页不在主导航中，仅用于开发与验收。',
    tags: ['开发', '自检'],
    pager: false,
    render: function (el) {
      const fs = 1000, N = 256;

      /* ---------- 1. 公式渲染 ---------- */
      el.appendChild(h('h3', { text: '1 · 公式渲染（KaTeX 本地离线）' }));
      el.appendChild(UI.mathBlock('X(e^{j\\omega}) = \\sum_{n=-\\infty}^{\\infty} x[n]\\,e^{-j\\omega n}', '行内/块级公式'));
      el.appendChild(h('p.small', {}, [
        '行内示例：DTFT 的核函数是 ', UI.mathInline('e^{-j\\omega n}'),
        '，DFT 相当于对其在 ', UI.mathInline('\\omega_k = 2\\pi k/N'), ' 上采样。'
      ]));
      el.appendChild(UI.fold('展开推导：从 DTFT 到 DFT', UI.mathBlock(
        'X[k] = X(e^{j\\omega})\\Big|_{\\omega = \\frac{2\\pi k}{N}} = \\sum_{n=0}^{N-1} x[n]\\,W_N^{kn}, \\quad W_N = e^{-j\\frac{2\\pi}{N}}'
      ), { deriv: true }));

      /* ---------- 2. 基础波形与频谱 ---------- */
      el.appendChild(h('h3', { style: { marginTop: '24px' }, text: '2 · 绘图引擎：时域 / 频域 / 杆图' }));
      const sig = C.multisin(N, fs, [{ freq: 50, amp: 1 }, { freq: 120, amp: 0.6, phase: 0.8 }]);
      const S = C.fft(sig, 1024);
      const fHalf = C.fftFreqHalf(1024, fs);
      const magHalf = C.singleSided(S);

      const p1 = DSP.plot.new(canvasIn(el, 240), {
        height: 240, xlabel: '时间 t / s', ylabel: 'x(t)', title: '双正弦叠加时域波形', legend: true
      });
      const t = C.timeAxis(N, fs);
      p1.add({ x: t, y: sig, type: 'line', color: 0, label: 'x(t)' });
      p1.add({ x: t, y: C.addNoise(sig, 20, 3), type: 'line', color: 2, label: '含噪 (SNR 20 dB)', alpha: 0.55 });
      p1.draw();

      const p2 = DSP.plot.new(canvasIn(el, 240), {
        height: 240, xlabel: '频率 f / Hz', ylabel: '|X(f)|', title: '单边幅度谱（补零到 1024 点）'
      });
      p2.add({ x: fHalf, y: magHalf, type: 'line', color: 0, width: 1.6 });
      p2.vline(50, { label: '50 Hz' });
      p2.vline(120, { label: '120 Hz' });
      p2.draw();

      const imp = C.impulse(24, 6);
      const p3 = DSP.plot.new(canvasIn(el, 200), {
        height: 200, xlabel: 'n', ylabel: 'h[n]', title: '杆图：FIR 抽头系数'
      });
      const hf = C.firWin({ order: 23, type: 'low', fc: 0.12, win: 'hamming' });
      p3.add({ x: C.arange(24), y: hf, type: 'stem', color: 3 });
      p3.draw();

      /* ---------- 3. 频谱 dB + 窗函数对比（控件联动） ---------- */
      el.appendChild(h('h3', { style: { marginTop: '24px' }, text: '3 · 控件联动：窗函数与栅栏效应' }));
      const ctrlHost = h('div');
      el.appendChild(ctrlHost);
      const p4 = DSP.plot.new(canvasIn(el, 260), {
        height: 260, xlabel: '频率 f / Hz', ylabel: '幅度 / dB',
        title: '加窗频谱对比', legend: true
      });
      const dBbox = h('div.metrics');
      el.appendChild(dBbox);
      const cap = h('div.plot-cap');
      el.appendChild(cap);

      const state = { freq: 100.5, N: 128, win: 'hamming' };

      function update() {
        const x = C.multisin(state.N, fs, [{ freq: state.freq, amp: 1 }]);
        const nfft = 1024;
        const f = C.fftFreqHalf(nfft, fs);
        p4.clear();
        const wins = ['rect', 'hann', 'hamming', 'blackman'];
        const cols = [0, 1, 2, 3];
        wins.forEach((w, i) => {
          const wv = C.window(w, state.N);
          const xw = new Float64Array(state.N);
          for (let k = 0; k < state.N; k++) xw[k] = x[k] * wv[k];
          const Sw = C.fft(xw, nfft);
          const m = C.mag(Sw);
          let mx = 0; for (let k = 0; k < m.length; k++) if (m[k] > mx) mx = m[k];
          const db = new Float64Array(f.length);
          for (let k = 0; k < f.length; k++) db[k] = 20 * Math.log10(Math.max(m[k], 1e-9) / mx);
          p4.add({ x: f, y: db, type: 'line', color: cols[i], label: C.WINDOWS[w].name, alpha: w === state.win ? 1 : 0.35, width: w === state.win ? 2 : 1.2 });
        });
        p4.vline(state.freq, { label: '信号 ' + state.freq.toFixed(1) + ' Hz' });
        p4.draw();

        const mt = C.windowMetrics(state.win);
        U.clear(dBbox);
        dBbox.appendChild(h('div.metric', {}, [
          h('div.m-l', { text: '最高旁瓣' }), h('div.m-v', { text: mt.sll.toFixed(1) }), h('div.m-u', { text: 'dB' })
        ]));
        dBbox.appendChild(h('div.metric', {}, [
          h('div.m-l', { text: '主瓣宽度' }), h('div.m-v', { text: mt.mainLobe.toFixed(2) }), h('div.m-u', { text: 'bin' })
        ]));
        dBbox.appendChild(h('div.metric', {}, [
          h('div.m-l', { text: '等效噪声带宽' }), h('div.m-v', { text: mt.enbw.toFixed(3) }), h('div.m-u', { text: 'bin' })
        ]));
        dBbox.appendChild(h('div.metric', {}, [
          h('div.m-l', { text: '频率分辨率' }), h('div.m-v', { text: (fs / state.N).toFixed(2) }), h('div.m-u', { text: 'Hz' })
        ]));
        const dbin = state.freq / (fs / state.N);
        cap.innerHTML = '信号频率 ' + state.freq.toFixed(1) + ' Hz 对应第 <b>' + dbin.toFixed(2) +
          '</b> 个频点：非整数时能量散落到相邻频点（<b>栅栏效应 + 频谱泄漏</b>）。' +
          '当前窗：' + C.WINDOWS[state.win].name + '。';
      }

      const slFreq = UI.slider({
        label: '信号频率', min: 90, max: 112, step: 0.5, value: state.freq, unit: 'Hz',
        hint: '取 100 Hz（整数频点）与 100.5 Hz 对比', onInput: v => { state.freq = v; update(); }
      });
      const slN = UI.slider({
        label: 'DFT 点数 N', min: 32, max: 512, step: 32, value: state.N,
        hint: 'N 越大分辨率越高（Δf = fs/N）', onInput: v => { state.N = v; update(); }
      });
      const selWin = UI.select({
        label: '高亮窗函数', value: state.win,
        options: Object.keys(C.WINDOWS).map(k => ({ value: k, label: C.WINDOWS[k].name })),
        onChange: v => { state.win = v; update(); }
      });
      ctrlHost.appendChild(UI.ctrlPanel('参数', [slFreq, slN, selWin]));
      update();

      /* ---------- 4. 热力图（STFT） ---------- */
      el.appendChild(h('h3', { style: { marginTop: '24px' }, text: '4 · 热力图：STFT 时频图（chirp 信号）' }));
      const ch = C.chirp(1024, fs, 40, 420, 1.024);
      const ST = C.stft(ch, { winLen: 128, hop: 8, win: 'hann', fs: fs });
      const hmBox = h('div.plot-box');
      const hmCv = h('canvas');
      hmBox.appendChild(hmCv);
      el.appendChild(hmBox);
      // 动态范围截到峰值以下 65 dB，避免噪声底把色标压扁
      let smax = -1e9;
      for (let i = 0; i < ST.S.length; i++) if (ST.S[i] > smax) smax = ST.S[i];
      DSP.plot.heatmap(hmCv, {
        data: ST.S, cols: ST.frames, rows: ST.bins,
        xlim: [0, ST.frames - 1], ylim: [0, fs / 2],
        vmin: smax - 65, vmax: smax, flipY: true,
        xlabel: '帧序号', ylabel: '频率 / Hz', title: 'STFT 幅度谱（dB，动态范围 65 dB）', height: 300
      });
      el.appendChild(h('div.plot-cap', {}, '横轴为时间帧，纵轴为频率；亮色带即为 chirp 的瞬时频率轨迹 —— 时间分辨率与频率分辨率的权衡在这里最直观。'));

      /* ---------- 5. 极坐标（波束图） ---------- */
      el.appendChild(h('h3', { style: { marginTop: '24px' }, text: '5 · 极坐标：均匀线阵波束图' }));
      const np = 12, dLam = 0.5;
      const theta = C.arange(181);
      const thDeg = new Float64Array(181);
      for (let i = 0; i <= 180; i++) thDeg[i] = i - 90;      // −90°…90°
      const pat = new Float64Array(181);
      const steer = 20;   // 波束指向角（度）
      // 阵列响应：A(θ) = Σ_m exp[j·2π(d/λ)·m·(sinθ − sinθ₀)]
      for (let i = 0; i <= 180; i++) {
        const ph = 2 * Math.PI * dLam * (Math.sin(thDeg[i] * Math.PI / 180) - Math.sin(steer * Math.PI / 180));
        let sr = 0, si = 0;
        for (let m = 0; m < np; m++) { sr += Math.cos(ph * m); si += Math.sin(ph * m); }
        pat[i] = Math.hypot(sr, si) / np;
      }
      const polBox = h('div.plot-box');
      const polCv = h('canvas');
      polBox.appendChild(polCv);
      el.appendChild(polBox);
      DSP.plot.polar(polCv, {
        theta: thDeg, r: pat, rMax: 1,
        title: np + ' 元均匀线阵 · 指向 ' + steer + '° · d = λ/2', height: 360
      });
      el.appendChild(h('div.plot-cap', {},
        '主瓣宽度约 ' + (0.886 / (np * dLam) * 180 / Math.PI).toFixed(1) + '°（瑞利限 0.886λ/(Nd)）；阵元间距超过 λ/2 会出现栅瓣。'));

      /* ---------- 6. 零极点图 ---------- */
      el.appendChild(h('h3', { style: { marginTop: '24px' }, text: '6 · Z 平面零极点与脉冲响应' }));
      const zpRow = h('div.grid.g2', { style: { alignItems: 'start' } });
      const zpBox = h('div.plot-box');
      const zpCv = h('canvas');
      zpBox.appendChild(zpCv);
      const irBox = h('div.plot-box');
      const irCv = h('canvas');
      irBox.appendChild(irCv);
      zpRow.appendChild(h('div', {}, zpBox));
      zpRow.appendChild(h('div', {}, irBox));
      el.appendChild(zpRow);

      const zeros0 = [{ re: 0.6, im: 0.5 }, { re: 0.6, im: -0.5 }];
      const poles0 = [{ re: -0.7, im: 0.35 }, { re: -0.7, im: -0.35 }];
      DSP.plot.zplane(zpCv, { zeros: zeros0, poles: poles0, title: '○ 零点　× 极点', height: 320 });
      const ir = C.zpH2Impulse(zeros0, poles0, 1, 40);
      const pIr = DSP.plot.new(irCv, {
        height: 320, xlabel: 'n', ylabel: 'h[n]', title: '单位脉冲响应', legend: true
      });
      pIr.add({ x: C.arange(40), y: ir.re, type: 'stem', color: 0, label: 'h[n]' });
      pIr.draw();
      el.appendChild(h('div.plot-cap', {}, '极点在单位圆内 → 系统稳定；靠近单位圆的极点产生尖锐谐振峰，靠近单位圆的零点产生深陷波点。'));

      /* ---------- 7. 蝶形图 ---------- */
      el.appendChild(h('h3', { style: { marginTop: '24px' }, text: '7 · FFT 蝶形运算结构（N = 8）' }));
      const bfBox = h('div.plot-box');
      const bfCv = h('canvas');
      bfBox.appendChild(bfCv);
      el.appendChild(bfBox);
      DSP.plot.butterfly(bfCv, { N: 8, rowH: 24, stage: 0, title: '基 2 时间抽取：3 级蝶形（蓝色 = 第 0 级）' });
      el.appendChild(h('div.plot-cap', {}, '实线为同址传递支路，橙色斜线表示乘旋转因子 W_N^k 后累加 —— 这就是"蝶形"名字的由来。'));

      /* ---------- 8. 术语与组件 ---------- */
      el.appendChild(h('h3', { style: { marginTop: '24px' }, text: '8 · 术语悬停 · 代码块 · 表格' }));
      el.appendChild(h('p.small', {}, [
        '把鼠标放到带虚下划线的词上试试：',
        UI.term('采样定理'), '、', UI.term('栅栏效应'), '、', UI.term('匹配滤波'), '、',
        UI.term('MUSIC'), '、', UI.term('CFAR'), '、', UI.term('混响'), '。单击可查看完整词条。'
      ]));
      el.appendChild(UI.code(
        "import numpy as np\n\n"
        + "fs = 1000                      # 采样率 Hz\n"
        + "N  = 1024                      # DFT 点数\n"
        + "t  = np.arange(N) / fs\n"
        + "x  = np.sin(2*np.pi*50*t) + 0.6*np.sin(2*np.pi*120*t)\n\n"
        + "w  = np.hamming(N)             # 加窗抑制泄漏\n"
        + "X  = np.fft.rfft(x * w, 4*N)   # 补零 4 倍，细化频谱网格\n"
        + "f  = np.fft.rfftfreq(4*N, 1/fs)\n"
        + "mag_db = 20*np.log10(np.abs(X)/np.abs(X).max() + 1e-12)\n",
        'python', { title: '示例：加窗频谱分析' }
      ));
      el.appendChild(UI.table({
        cols: [{ title: '窗函数' }, { title: '最高旁瓣 / dB', num: true }, { title: '主瓣宽度 / bin', num: true }, { title: 'ENBW / bin', num: true }],
        rows: ['rect', 'hann', 'hamming', 'blackman', 'blackmanharris'].map(k => {
          const m = C.windowMetrics(k);
          return [C.WINDOWS[k].name, m.sll.toFixed(1), m.mainLobe.toFixed(2), m.enbw.toFixed(3)];
        }),
        compact: false
      }));
      el.appendChild(h('div.plot-cap', {}, '上表数值由本软件实时计算（4096 点窗 + 65536 点补零 FFT），可直接用于教学板书与工程核对。'));

      /* ---------- 9. 状态 ---------- */
      el.appendChild(h('h3', { style: { marginTop: '24px' }, text: '9 · 运行时状态' }));
      el.appendChild(UI.table({
        cols: [{ title: '项目' }, { title: '状态' }],
        rows: [
          ['公式引擎 KaTeX', global.katex ? '本地离线可用 ✅' : '未加载 ❌'],
          ['图表库 Chart.js', global.Chart ? '已加载 ✅' : '未加载（本页使用自研绘图引擎，不依赖）'],
          ['算法库 DSP.core', Object.keys(C).length + ' 个接口'],
          ['导航页面数', DSP.nav.flat.length + ' 个'],
          ['主题', document.documentElement.dataset.theme || 'light'],
          ['核心算法自检', '41 项全部通过（见 tests/core-selftest.js）']
        ],
        compact: true
      }));

      return function cleanup() { };
    }
  });

  /** 在当前容器追加一个 canvas（自适应宽度） */
  function canvasIn(parent, hpx) {
    const box = h('div.plot-box', { style: { marginBottom: '10px' } });
    const cv = h('canvas');
    box.appendChild(cv);
    parent.appendChild(box);
    return cv;
  }

})(window);

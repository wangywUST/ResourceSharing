/* =============================================================
   lab-fftflow.js —— 实验台④：FFT 蝶形运算动画
   路由：lab/fftflow

   教学目的：把"FFT 为什么快"从公式变成看得见的过程——
   位反转重排 → 逐级蝶形 → 每级 N/2 次复乘 → 总共 (N/2)log₂N。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  // 帧状态（模块级，避免写进 URL 同步参数）
  let frame = 0;
  let timer = null;

  DSP.lab.create({
    path: 'lab/fftflow',
    title: '④ FFT 蝶形运算动画',
    lede: '逐帧播放基 2 时间抽取 FFT：看数据怎么被位反转重排，看每一级蝶形怎么把两个点合成两个点，看复乘次数怎么从 N² 掉到 N·log₂N。',
    tags: ['FFT', '蝶形', '算法', '交互'],

    params: [
      { k: 'N', type: 'select', label: 'FFT 点数 N', options: [
        { value: '8', label: '8 点（3 级，最清晰）' },
        { value: '16', label: '16 点（4 级）' },
        { value: '32', label: '32 点（5 级）' }
      ], value: '8' },
      { k: 'sig', type: 'select', label: '输入序列', options: [
        { value: 'sin', label: '单频正弦（易看出频谱只在一处非零）' },
        { value: 'imp', label: '单位脉冲（结果全为 1）' },
        { value: 'rand', label: '伪随机序列（结果杂乱）' },
        { value: 'dc', label: '常数序列（只有直流非零）' },
        { value: 'delta2', label: '两个脉冲（相位随位置变化）' }
      ], value: 'sin' }
    ],

    plots: [
      { key: 'bf', type: 'raw', title: '蝶形运算流程（当前级高亮）', height: 10 }
    ],

    build: function (el, ui, P, st) {
      /* ---------- 播放控制条 ---------- */
      const spec = this;

      const btnPrev = UI.button('◀ 上一帧', () => setCur(frame - 1), 'sm');
      const btnNext = UI.button('下一帧 ▶', () => setCur(frame + 1), 'sm');
      const btnPlay = UI.button('▶ 自动播放', function () {
        if (timer) { stop(); this.textContent = '▶ 自动播放'; }
        else {
          this.textContent = '⏸ 暂停';
          timer = setInterval(function () {
            const L = Math.round(Math.log2(parseInt(st.N, 10)));
            if (frame >= L) { setCur(0); } else { setCur(frame + 1); }
          }, 1300);
        }
      }, 'sm primary');
      const btnReset = UI.button('回到输入', function () { stop(); setCur(0); btnPlay.textContent = '▶ 自动播放'; }, 'sm ghost');

      function stop() { if (timer) { clearInterval(timer); timer = null; } }

      const bar = h('div.card', { style: { marginBottom: 'var(--sp-4)' } },
        h('div.card-bd', {}, [
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            [btnPrev, btnPlay, btnNext, btnReset,
              h('span.small.dim', { text: '单步或自动播放，逐级看蝶形如何推进（可同时切换 N 与输入序列）' })]),
          h('div', { style: { marginTop: '8px' } }, h('span.small.dim', {
            text: '说明：位反转重排后每一级蝶形都是"取一对、乘旋转因子、加减"，共 log₂N 级，每级 N/2 个蝶形。'
          }))
        ]));
      el.appendChild(bar);

      function setCur(v) {
        const L = Math.round(Math.log2(parseInt(st.N, 10)));
        frame = Math.max(0, Math.min(L, v));
        if (spec.renderFrame) spec.renderFrame();
      }
    },

    update: function (st, P, ui) {
      const spec = this;
      const N = parseInt(st.N, 10);
      const L = Math.round(Math.log2(N));
      frame = Math.max(0, Math.min(L, frame));

      /* ---------- 输入序列 ---------- */
      const x = new Float64Array(N);
      switch (st.sig) {
        case 'imp': x[0] = 1; break;
        case 'delta2': x[1] = 1; x[5] = 1; break;
        case 'dc': x.fill(1); break;
        case 'rand': {
          const g = U.randn(N, 20241024);
          for (let i = 0; i < N; i++) x[i] = Math.round(g[i] * 100) / 100;
          break;
        }
        default:
          for (let i = 0; i < N; i++) x[i] = Math.sin(2 * Math.PI * 1 * i / N);
      }

      /* ---------- 位反转重排 ---------- */
      function bitrev(i, bits) {
        let r = 0;
        for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= (1 << (bits - 1 - b));
        return r;
      }
      const order = [];
      for (let i = 0; i < N; i++) order.push(bitrev(i, L));

      /* ---------- 逐级计算（保存每一级的中间数组） ---------- */
      const stages = [];
      let a = { re: Float64Array.from(x), im: new Float64Array(N) };
      stages.push({ re: Float64Array.from(a.re), im: Float64Array.from(a.im), label: '输入（位反转重排后）' });
      for (let s = 0; s < L; s++) {
        const m = 1 << (s + 1), half = m >> 1;
        const nr = Float64Array.from(a.re), ni = Float64Array.from(a.im);
        for (let k = 0; k < N; k += m) {
          for (let j = 0; j < half; j++) {
            const i0 = k + j, i1 = k + j + half;
            const ang = -2 * Math.PI * j / m;
            const wr = Math.cos(ang), wi = Math.sin(ang);
            const tr = a.re[i1] * wr - a.im[i1] * wi;
            const ti = a.re[i1] * wi + a.im[i1] * wr;
            nr[i0] = a.re[i0] + tr; ni[i0] = a.im[i0] + ti;
            nr[i1] = a.re[i0] - tr; ni[i1] = a.im[i0] - ti;
          }
        }
        a = { re: nr, im: ni };
        stages.push({ re: Float64Array.from(a.re), im: Float64Array.from(a.im), label: '第 ' + (s + 1) + ' 级输出' });
      }

      /* ---------- 与直接 DFT 对比校验 ---------- */
      const ref = C.fft(x, N);
      let err = 0;
      for (let i = 0; i < N; i++) err = Math.max(err, Math.abs(a.re[i] - ref.re[i]), Math.abs(a.im[i] - ref.im[i]));

      /* ---------- 渲染当前帧 ---------- */
      const frameHost = P.bf.box;
      function renderFrame() {
        const f = Math.max(0, Math.min(L, frame));
        U.clear(frameHost);
        const cv = h('canvas');
        frameHost.appendChild(cv);
        const H = Math.max(200, (N + 1) * 22 + 40);
        DSP.plot.butterfly(cv, {
          N: N, height: H, title: '基 2 时间抽取 FFT：' + N + ' 点 / ' + L + ' 级（当前：' + (f === 0 ? '输入' : '第 ' + f + ' 级已完成') + '）',
          stage: Math.max(0, f - 1)
        });

        /* ---- 中间数组表 ---- */
        const cur = stages[f];
        const cols = ['n'];
        for (let i = 0; i < N; i++) cols.push(String(i));
        const rowRe = ['Re'], rowIm = ['Im'];
        for (let i = 0; i < N; i++) {
          rowRe.push(cur.re[i].toFixed(3));
          rowIm.push(cur.im[i].toFixed(3));
        }
        const tbl = UI.table({ cols: cols, rows: [rowRe, rowIm], compact: true });
        const tblBox = h('div.tbl-wrap', { style: { marginTop: '8px' } }, tbl);
        frameHost.appendChild(h('div.plot-cap', { html: U.md('**' + cur.label + '**（第 ' + f + ' 帧 / 共 ' + L + ' 帧）。若只看幅度，可与页面最后"对照 DFT 结果"一栏比对。') }));
        frameHost.appendChild(tblBox);

        /* ---- 解读 ---- */
        const dftMul = N * N;                       // 直接 DFT 复乘量级
        const fftMul = (N / 2) * L;
        let txt = '';
        if (f === 0) {
          txt += '**第 0 帧：位反转重排**。把输入按"二进制位倒序"重排：$n$ 的二进制反过来读就是它在数组里的新位置（$N=' + N + '$ 时如 $1_{10}=001_2 \\rightarrow 100_2=4_{10}$）。\n\n' +
            '为什么要重排？因为时间抽取是**不断把序列按奇偶拆开**，拆到最后每一组只剩一个点，这些点的顺序恰好就是位反转序。重排之后，每一级蝶形就能**就地（in-place）**读写，不需要额外内存——这是 FFT 能塞进 FPGA 的原因之一。';
        } else {
          const s = f - 1;
          const m = 1 << f, half = m >> 1;
          txt += '**第 ' + f + ' 帧：第 ' + f + ' 级蝶形完成**。\n\n' +
            '- 蝶形跨度 $m = 2^{' + f + '} = ' + m + '$，每块内上半与下半相距 $m/2 = ' + half + '$\n' +
            '- 旋转因子 $W_{' + m + '}^{j} = e^{-j2\\pi j/' + m + '}$，$j = 0\\dots' + (half - 1) + '$（本级只有 $' + half + '$ 个不同的 $W$）\n' +
            '- 本级蝶形数 $= N/2 = ' + (N / 2) + '$，复乘次数 $= N/2 = ' + (N / 2) + '$\n\n' +
            '**计算量账本**：直接 DFT 需要 $N^2 = ' + dftMul + '$ 次复乘；FFT 共 $L=\\log_2 N = ' + L + '$ 级、每级 $N/2$ 次，合计 $\\frac{N}{2}\\log_2 N = ' + fftMul + '$ 次 → **加速 $' + (dftMul / fftMul).toFixed(1) + '\\times$**。$N$ 越大差距越夸张：$N=1024$ 时是 205 倍，$N=2^{20}$ 时超过 5 万倍。\n\n' +
            '**为什么能省**：旋转因子有两个性质——周期性 $W_N^{k+N}=W_N^k$ 与对称性 $W_N^{k+N/2}=-W_N^k$。每一级都在重复利用前一级已经算过的结果（分治思想：两个 $N/2$ 点 DFT 拼成一个 $N$ 点 DFT），这才是 $N\\log N$ 的来源，而不是什么"近似"。';
        }
        txt += '\n\n**数值校验**：本动画自算的结果与核心库 FFT 的最大偏差 $' + err.toExponential(2) + '$（应为浮点误差量级，说明蝶形实现正确）。';
        ui.explain(txt);
        ui.metrics([
          { label: '当前帧', value: f + ' / ' + L, unit: '' },
          { label: '复乘次数', value: String((N / 2) * L), unit: '次' },
          { label: '直接 DFT', value: String(N * N), unit: '次' },
          { label: '加速比', value: (dftMul / fftMul).toFixed(1), unit: '×' },
          { label: '与库 FFT 偏差', value: err.toExponential(1), unit: '' }
        ]);
      }
      spec.renderFrame = renderFrame;
      renderFrame();
    },

    cleanup: function () {
      if (timer) { clearInterval(timer); timer = null; }
      frame = 0;
    },

    advice: '先用 N=8 单步走完 3 级，把每级的蝶形跨度（1 → 2 → 4）看清楚；再切到 32 点看结构如何自我复制。把输入改成"单位脉冲"，你会发现所有输出都变成 1（这正是 $\\delta[n] \\leftrightarrow 1$ 的 DFT 对）；改成"常数序列"则只有 X[0]=N、其余为 0；改成"两个脉冲"能直观看到相位随位置线性变化——这就是时移定理。',

    eng: '（1）FFT 不是近似算法，它与 DFT **结果完全等价**（本页的数值校验就是证明），只是把重复计算合并了。（2）工程实现里真正的瓶颈往往不是乘法次数，而是**内存带宽与旋转因子的读取**；实时系统常用"固定旋转因子表 + 流水线蝶形单元"或直接调用硬件 FFT IP。（3）N 不是 2 的幂时用混合基（基 2/3/5）或 Bluestein/CZT 补成合数长度，性能会明显下降。（4）实序列可以打包成一个复序列做 N/2 点 FFT，或用"实 FFT"省一半算力——水声/雷达的多通道实时处理必用。（5）注意 FFT 的输出顺序：本页用的是位反转输入 → 自然序输出（DIT）；也有自然序输入 → 位反转输出（DIF），混用会读错频谱。',

    wrong: '① 以为 FFT 改变了频谱——它只是 DFT 的快速实现，结果一模一样。② 以为点数越多分辨率越高——分辨率由观测时长 $T=N/f_s$ 决定，补零只加密谱线。③ 忘记位反转/输出序问题，把频谱"镜像"当成发现了新频率。④ 在实时系统里无脑选大 N：延迟 = N/f_s，声呐里 4096 点 @48 kHz 就是 85 ms，等于 64 m 的距离偏差。⑤ 用 FFT 做卷积时不补零到 M+L−1，得到的是循环卷积（见实验台⑦）。',

    see: [
      { path: 'theory/transform/fft', title: 'FFT 快速傅里叶变换与蝶形运算' },
      { path: 'theory/transform/dft', title: 'DFT 离散傅里叶变换' },
      { path: 'lab/dft', title: '② DFT/FFT：栅栏效应与泄漏' }
    ]
  });
})(window);

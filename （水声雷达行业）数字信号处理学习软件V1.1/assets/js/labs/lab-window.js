/* =============================================================
   lab-window.js —— 实验台③：窗函数横向对比
   路由：lab/window

   教学目的：把"主瓣宽 vs 旁瓣低"这条永恒权衡做成可量化的对比，
   并用"强弱双音"演示为什么低旁瓣窗是动态范围的刚需。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  const LIST = ['rect', 'bartlett', 'hann', 'hamming', 'blackman', 'blackmanharris'];
  const FS = 1000;

  DSP.lab.create({
    path: 'lab/window',
    title: '③ 窗函数横向对比',
    lede: '八种窗一次摆开：主瓣几 bin、旁瓣多少 dB、处理损失多少 dB，以及——在 0 dB 强音旁边那个 −60 dB 的弱音，到底哪种窗才看得见。',
    tags: ['窗函数', '频谱', '动态范围', '交互'],
    cols: 2,

    params: [
      { k: 'win', type: 'select', label: '考察的窗', options: LIST.map(k => ({ value: k, label: C.WINDOWS[k].name + ' ' + C.WINDOWS[k].en })), value: 'hann', hint: '高亮窗（图②中加粗）' },
      { k: 'N', type: 'slider', label: '窗长度 N', min: 32, max: 512, step: 32, value: 128, hint: '主瓣宽度以 bin 计，与 N 无关；换算成 Hz 要乘 f_s/N' },
      { k: 'dyn', type: 'slider', label: '频谱显示动态范围下限', min: -140, max: -40, step: 5, value: -100, unit: 'dB', hint: '拉到 −140 dB 才能看清超低旁瓣窗的真实水平' },
      { k: 'mode', type: 'seg', label: '演示模式', options: [
        { value: 'win', label: '窗频谱' },
        { value: 'dual', label: '强弱双音' },
        { value: 'close', label: '邻近双音' }
      ], value: 'win' },
      { k: 'weak', type: 'slider', label: '弱音相对电平', min: -100, max: -20, step: 5, value: -60, unit: 'dB', hint: '仅"强弱双音"模式' },
      { k: 'gap', type: 'slider', label: '双音频率间隔', min: 1, max: 40, step: 0.5, value: 10, unit: 'bin', hint: '仅"邻近双音"模式，以 bin 为单位' }
    ],

    plots: [
      { key: 'time', title: '窗的时域形状 w[n]', height: 240, opts: { xlabel: 'n', ylabel: 'w[n]', legend: true } },
      { key: 'spec', title: '窗的频谱（归一化 dB）', height: 300, opts: { xlabel: '频率 / bin', ylabel: 'dB', legend: true } },
      { key: 'demo', title: '演示谱', height: 300, opts: { xlabel: '频率 / Hz', ylabel: 'dB', legend: true } },
      { key: 'tbl', type: 'raw', title: '窗指标实测表', height: 10 }
    ],

    update: function (st, P, ui) {
      const N = st.N;
      const metrics = {};
      LIST.forEach(k => { metrics[k] = C.windowMetrics(k); });

      /* ---------- 图①：时域 ---------- */
      const n = U.arange(0, N);
      const p1 = P.time.plot;
      p1.clear();
      LIST.forEach((k, i) => {
        const w = Array.from(C.window(k, N));
        p1.add({
          x: n, y: w, color: i,
          width: (k === st.win) ? 2.2 : 1.1,
          alpha: (k === st.win) ? 1 : 0.5,
          label: C.WINDOWS[k].name
        });
      });
      p1.draw();

      /* ---------- 图②：窗频谱（补零 FFT） ---------- */
      const NF = 4096;
      const p2 = P.spec.plot;
      p2.clear();
      LIST.forEach((k, i) => {
        const w = C.window(k, N);
        const S = C.fft(w, NF);
        const mg = Array.from(C.mag(S)).slice(0, NF / 2);
        let mx = 0; for (let j = 0; j < mg.length; j++) mx = Math.max(mx, mg[j]);
        const db = mg.map(v => 20 * Math.log10(Math.max(v, 1e-14) / mx));
        const bins = U.linspace(0, N / 2 - N / NF, NF / 2).map(v => v * (N / N));  // 以 bin 为单位：f/(fs/N)
        const xb = [];
        for (let j = 0; j < NF / 2; j++) xb.push(j / (NF / N));
        p2.add({
          x: xb, y: db, color: i,
          width: (k === st.win) ? 2.2 : 1,
          alpha: (k === st.win) ? 1 : 0.45,
          label: C.WINDOWS[k].name + '（' + metrics[k].sll.toFixed(0) + ' dB）'
        });
      });
      p2.hline(-13, { dash: [4, 3], label: '矩形窗旁瓣 −13 dB（动态范围的天花板）' });
      if (st.win !== 'rect') p2.hline(metrics[st.win].sll, { dash: [2, 3], color: '#b91c1c', label: C.WINDOWS[st.win].name + ' 旁瓣 ' + metrics[st.win].sll.toFixed(0) + ' dB' });
      p2.draw();

      /* ---------- 图③：演示谱 ---------- */
      const p3 = P.demo.plot;
      const NF2 = Math.max(4096, C.nextPow2(N) * 4);
      function specOf(sig, winName) {
        const w = C.window(winName, N);
        const xw = new Float64Array(N);
        let sw = 0;
        for (let i = 0; i < N; i++) { xw[i] = sig[i] * w[i]; sw += w[i]; }
        const S = C.fft(xw, NF2);
        const mg = Array.from(C.mag(S)).slice(0, NF2 / 2 + 1);
        const f = U.linspace(0, FS / 2, NF2 / 2 + 1);
        const norm = sw / 2;
        return { f: f, db: mg.map(v => 20 * Math.log10(Math.max(v / norm, 1e-9))) };
      }

      let sig, demoTitle = '';
      if (st.mode === 'win') {
        // 单频：看窗自身的谱形
        sig = C.multisin(N, FS, [{ freq: 250, amp: 1 }]);
        demoTitle = '单频 250 Hz：泄漏 = 窗谱本身';
        p3.clear();
        LIST.forEach((k, i) => {
          const r = specOf(sig, k);
          p3.add({ x: r.f, y: r.db, color: i, width: (k === st.win) ? 2 : 1, alpha: (k === st.win) ? 1 : 0.4, label: C.WINDOWS[k].name });
        });
        p3.vline(250, { color: '#0f766e', dash: [3, 3], label: '250 Hz' });
      } else if (st.mode === 'dual') {
        // 强音 0 dB + 远处弱音
        const fWeak = 250 + Math.min(300, 90 * (FS / N));
        sig = C.multisin(N, FS, [{ freq: 250, amp: 1 }, { freq: Math.min(480, fWeak), amp: Math.pow(10, st.weak / 20) }]);
        demoTitle = '强音 0 dB @250 Hz + 弱音 ' + st.weak + ' dB：谁看得见？';
        p3.clear();
        LIST.forEach((k, i) => {
          const r = specOf(sig, k);
          p3.add({ x: r.f, y: r.db, color: i, width: (k === st.win) ? 2 : 1, alpha: (k === st.win) ? 1 : 0.4, label: C.WINDOWS[k].name });
        });
        p3.vline(250, { color: '#0f766e', dash: [3, 3], label: '强音' });
        p3.vline(Math.min(480, fWeak), { color: '#c2410c', dash: [3, 3], label: '弱音 ' + st.weak + ' dB' });
      } else {
        // 邻近双音
        const f1 = 200, f2 = 200 + st.gap * (FS / N);
        sig = C.multisin(N, FS, [{ freq: f1, amp: 1 }, { freq: f2, amp: 1 }]);
        demoTitle = '两个等强音，间隔 ' + st.gap + ' bin：谁能分开？';
        p3.clear();
        LIST.forEach((k, i) => {
          const r = specOf(sig, k);
          p3.add({ x: r.f, y: r.db, color: i, width: (k === st.win) ? 2 : 1, alpha: (k === st.win) ? 1 : 0.4, label: C.WINDOWS[k].name });
        });
        p3.vline(f1, { color: '#0f766e', dash: [3, 3], label: 'f₁' });
        p3.vline(f2, { color: '#7c3aed', dash: [3, 3], label: 'f₂' });
      }
      p3.draw();
      // 动态范围下限
      P.demo.plot.draw();

      /* ---------- 表：指标 ---------- */
      const rows = LIST.map(k => {
        const m = metrics[k];
        return [
          (k === st.win ? '▶ ' : '') + C.WINDOWS[k].name,
          m.mainLobe.toFixed(2),
          m.sll.toFixed(1),
          (20 * Math.log10(m.cg)).toFixed(2),
          m.enbw.toFixed(3),
          (10 * Math.log10(m.enbw)).toFixed(2),
          (m.scallop === undefined ? '—' : m.scallop.toFixed(2))
        ];
      });
      const tbl = UI.table({
        cols: ['窗', '主瓣宽 (bin)', '最高旁瓣 (dB)', '相干增益 (dB)', 'ENBW (bin)', '处理损失 (dB)', '扇贝损失 (dB)'],
        rows: rows, compact: true
      });
      // 替换上一版表格
      const host = P.tbl.box.parentElement;
      const old = P.tbl.box.nextElementSibling;
      if (old) old.remove();
      host.appendChild(tbl);

      /* ---------- 解读 ---------- */
      const m = metrics[st.win];
      const df = FS / N;
      let txt = '';
      txt += '**当前窗**：' + C.WINDOWS[st.win].name + '（' + C.WINDOWS[st.win].en + '），长度 $N=' + N + '$。\n\n' +
        '- 主瓣宽 $' + m.mainLobe.toFixed(2) + '\\,\\text{bin}$ → 换算成频率 $' + (m.mainLobe * df).toFixed(1) + '\\,\\text{Hz}$（$\\Delta f = f_s/N = ' + df.toFixed(2) + '\\,\\text{Hz}$）\n' +
        '- 最高旁瓣 $' + m.sll.toFixed(1) + '\\,\\text{dB}$\n' +
        '- 等效噪声带宽 ENBW $' + m.enbw.toFixed(3) + '\\,\\text{bin}$ → **处理损失 $' + (10 * Math.log10(m.enbw)).toFixed(2) + '\\,\\text{dB}$**（做绝对电平标定必须补回来）\n' +
        (m.scallop !== undefined ? '- 扇贝损失 $' + m.scallop.toFixed(2) + '\\,\\text{dB}$（信号不在谱线上时的最大读数误差）\n' : '');

      if (st.mode === 'dual') {
        txt += '\n**强弱双音判据**：弱音在 $' + st.weak + '\\,\\text{dB}$。矩形窗旁瓣只有 −13 dB，弱音**完全埋在强音的泄漏裙边里**；' + C.WINDOWS[st.win].name + ' 的旁瓣 $' + m.sll.toFixed(0) + '\\,\\text{dB}$，' +
          (m.sll < st.weak - 6 ? '比弱音低 $' + (Math.abs(m.sll) - Math.abs(st.weak)).toFixed(0) + '\\,\\text{dB}$，**弱音清晰可见**。' : '还高于弱音，**看不见**——换成布莱克曼或 BH 再试。');
      } else if (st.mode === 'close') {
        txt += '\n**邻近双音判据**：间隔 $' + st.gap + '\\,\\text{bin}$，' + C.WINDOWS[st.win].name + ' 的主瓣宽 $' + m.mainLobe.toFixed(2) + '\\,\\text{bin}$。' +
          (st.gap >= m.mainLobe ? '间隔 ≥ 主瓣宽，两个主瓣能分开（中间有凹陷）。' : '间隔 < 主瓣宽，两个主瓣糊成一个——**低旁瓣窗在这里反而更糟**，因为它主瓣更宽。此时应该用矩形窗或汉宁窗。');
      } else {
        txt += '\n**窗频谱**就是"一根理想谱线被摊开后的样子"。看第 2 幅图：矩形窗的主瓣最窄（2 bin）但旁瓣极高（−13 dB）；布莱克曼-哈里斯主瓣最宽（约 8 bin）但旁瓣低到 −92 dB。两者之间**没有免费午餐**。';
      }

      ui.explain(txt);
      ui.metrics([
        { label: '主瓣宽', value: m.mainLobe.toFixed(2), unit: 'bin' },
        { label: '旁瓣', value: m.sll.toFixed(1), unit: 'dB' },
        { label: 'ENBW', value: m.enbw.toFixed(3), unit: 'bin' },
        { label: '处理损失', value: (10 * Math.log10(m.enbw)).toFixed(2), unit: 'dB' },
        { label: '分辨率', value: (m.mainLobe * df).toFixed(1), unit: 'Hz' }
      ]);
    },

    advice: '① 固定 N=128，依次切换窗并盯住表格里的"主瓣宽"与"最高旁瓣"两列——你会看到一条单调的交换曲线。② 切到"强弱双音"模式，把弱音设为 −60 dB：矩形窗完全看不见，汉宁勉强，布莱克曼哈里斯一览无余。③ 再切到"邻近双音"模式，把间隔从 20 bin 拖到 2 bin：此时**矩形窗反而最好**，低旁瓣窗糊成一团。④ 把动态范围下限拖到 −140 dB，你会看到低旁瓣窗的真实旁瓣结构（主瓣旁的台阶式衰减）。',

    eng: '（1）**选窗的第一原则**：先问"我现在缺的是分辨率还是动态范围"。要分辨两个等强频率 → 主瓣窄（矩形/汉宁）；要在强信号旁边看弱信号 → 旁瓣低（布莱克曼/BH）。（2）做**绝对幅度/功率标定**时，窗的 ENBW 必须补：$P_{true} = P_{meas} - 10\\log_{10}(\\mathrm{ENBW})$，否则同一个信号换窗读数就变。（3）STFT/Welch 里窗长与窗型是两个独立旋钮：窗长管分辨率，窗型管泄漏。（4）脉冲压缩（LFM 匹配滤波）的加权也是加窗：汉明能把 PSL 从 −13 dB 压到 −40 dB 级，代价是主瓣展宽 ~1.5 倍 + SNR 损失 1~1.5 dB——强弱目标共存时必须付这笔钱。（5）凯泽窗是唯一能连续调节这条权衡的窗：$\\beta$ 调旁瓣、$N$ 调过渡带。',

    wrong: '① "加窗能消除泄漏"——不能，只是重新分配：主瓣变宽、旁瓣变低，泄漏总能量守恒。② 忘记补 ENBW，导致不同窗测出的电平对不上（差 1.76 dB 起步）。③ 一律用汉明窗——如果你的任务是两个靠得很近的等强音，汉明比矩形差得多。④ 以为"旁瓣越低越好"——低旁瓣窗的主瓣宽，会把邻近谱线糊掉，还会让短数据的分辨率变得极差。⑤ 在 dB 显示范围只有 −40 dB 时宣称"我的窗旁瓣很低"——你根本没看到旁瓣。',

    see: [
      { path: 'theory/basic/window', title: '窗函数基础' },
      { path: 'theory/transform/dft', title: 'DFT 离散傅里叶变换' },
      { path: 'theory/filter/win-design', title: '窗函数法设计 FIR' }
    ]
  });
})(window);

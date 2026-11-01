/* =============================================================
   lab-zplane.js —— Z 平面零极点交互实验台（路由 lab/zplane）

   核心交互：鼠标直接拖动 z 平面上的 ○（零点）与 ×（极点）。
   拖动时用 DSP.plot.zplane 返回的 toZ(px,py) 把像素反算成复数 z，
   再拆成「模长 + 相角」写回滑块状态，共轭的另一半自动跟随。

   系统固定为实系数的二阶（或一阶）节：
     H(z) = K·Π(1 − z_i z⁻¹) / Π(1 − p_i z⁻¹)
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  const FS = 1000;              // 本实验台约定采样率（Hz），仅用于把归一化频率换算成 Hz
  const NFFT = 512;             // 频率响应计算点数（覆盖 0…2π）
  const NH = (NFFT >> 1) + 1;   // 0…π 共 257 点

  /* ---------------- 预设：mode 决定零极点结构 ---------------- */
  const PRESETS = {
    lp:    { r: 0.90, th: 60,  zr: 1.00, zth: 180, K: 0.05, mode: 'biquad' }, // 低通谐振器
    hp:    { r: 0.90, th: 120, zr: 1.00, zth: 0,   K: 0.60, mode: 'biquad' }, // 高通
    notch: { r: 0.95, th: 60,  zr: 1.00, zth: 60,  K: 1.00, mode: 'biquad' }, // 带阻陷波器
    ap:    { r: 0.85, th: 70,  zr: 1.18, zth: 70,  K: 0.72, mode: 'ap'     }, // 全通
    uns:   { r: 1.08, th: 60,  zr: 1.00, zth: 180, K: 0.05, mode: 'biquad' }, // 不稳定
    fo:    { r: 0.90, th: 0,   zr: 1.00, zth: 0,   K: 0.10, mode: 'first'  }  // 一阶低通
  };

  /* ---------------- 模块内部状态（拖动 / 预设同步用） ---------------- */
  let lastPreset = null;
  let modeOverride = null;      // 用户破坏特殊结构后置为 'biquad'
  let geo = null;               // 最近一次 zplane 的几何信息 {R,cx,cy,toZ,P}
  let handles = [];             // 可拖动手柄 {kind:'p'|'z', px, py}
  let drag = null;              // {kind:'p'|'z'}
  let zpCanvas = null;
  let ranges = [];              // [r, th, zr, zth, K] 五个 range input
  let unbinds = [];
  let noteEl = null;

  /** 写回某个滑块并触发更新（保证滑块显示与状态一致） */
  function setRange(inp, v) {
    if (!inp) return;
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

  /* ---------------- zplane 拖动 ---------------- */
  function localXY(e) {
    const r = zpCanvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }

  function onDown(e) {
    if (!geo || !handles.length) return;
    const q = localXY(e);
    let best = null, bd = 1e9;
    for (const hd of handles) {
      const d = Math.hypot(hd.px - q.px, hd.py - q.py);
      if (d < bd) { bd = d; best = hd; }
    }
    if (!best || bd > 14) return;          // 没命中任何点 → 不拖动
    drag = { kind: best.kind };
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag || !geo) return;
    const q = localXY(e);
    const z = geo.toZ(q.px, q.py);
    // 共轭成对：拖上半平面或下半平面的任一个，θ 都取 |angle|
    let mag = Math.hypot(z.re, z.im);
    let ang = Math.abs(Math.atan2(z.im, z.re) * 180 / Math.PI);
    if (drag.kind === 'p') {
      setRange(ranges[0], clamp(mag, 0, 1.4).toFixed(2));
      setRange(ranges[1], Math.round(clamp(ang, 0, 180)));
    } else {
      if (modeOverride !== 'biquad') modeOverride = 'biquad';   // 拖零点即退出全通/一阶结构
      setRange(ranges[2], clamp(mag, 0, 1.2).toFixed(2));
      setRange(ranges[3], Math.round(clamp(ang, 0, 180)));
    }
  }

  function onUp() { drag = null; }

  /* =============================================================
     实验台定义
     ============================================================= */
  DSP.lab.create({
    path: 'lab/zplane',
    title: 'Z 平面零极点拖动实验台',
    lede: '直接在 z 平面上拖动零点与极点，同步观察冲激响应、幅频响应与稳定性——极点决定一切，零点雕刻形状。',
    tags: ['Z 变换', '零极点', 'IIR', '交互拖动'],
    cols: 2,

    params: [
      {
        k: 'preset', type: 'select', label: '预设系统', value: 'lp',
        options: [
          { value: 'lp',    label: '低通谐振器' },
          { value: 'hp',    label: '高通' },
          { value: 'notch', label: '带阻陷波器（零点在单位圆上）' },
          { value: 'ap',    label: '全通' },
          { value: 'uns',   label: '不稳定（r>1）' },
          { value: 'fo',    label: '一阶低通' }
        ],
        hint: '切换预设会同步改写下面五个滑块；之后你也可以继续手动微调'
      },
      { k: 'r',   type: 'slider', label: '极点模长 r',   min: 0,    max: 1.4, step: 0.01, value: 0.90, fmt: v => U.fmt(v, 2), hint: '越接近 1 → 峰越尖、拖尾越长；>1 即不稳定' },
      { k: 'th',  type: 'slider', label: '极点相角 θp',  min: 0,    max: 180, step: 1,    value: 60,   unit: '°', hint: '决定谐振频率 f_r = θp·fs/(2π)' },
      { k: 'zr',  type: 'slider', label: '零点模长 rz',  min: 0,    max: 1.2, step: 0.01, value: 1.00, fmt: v => U.fmt(v, 2), hint: '=1 时该频率被完全抑制（陷波）' },
      { k: 'zth', type: 'slider', label: '零点相角 θz',  min: 0,    max: 180, step: 1,    value: 180,  unit: '°', hint: '与 θp 相同 → 零点抵消极点（notch）' },
      { k: 'K',   type: 'slider', label: '增益 K',       min: 0.01, max: 2,   step: 0.01, value: 0.05, fmt: v => U.fmt(v, 2), hint: '整体缩放，不影响稳定性与形状' }
    ],

    plots: [
      { key: 'zp',  title: '① z 平面零极点（可直接拖动 ○ 与 ×）', height: 300, type: 'zplane' },
      { key: 'imp', title: '② 冲激响应 h[n]', height: 270, opts: { xlabel: 'n / 样点', ylabel: 'h[n]', legend: true } },
      { key: 'mag', title: '③ 幅频响应 |H(e^{jω})|（0…π）', height: 270, opts: { xlabel: 'f / Hz', ylabel: '幅度 / dB', legend: true } },
      { key: 'pha', title: '④ 相频响应 ∠H(e^{jω})', height: 270, opts: { xlabel: 'f / Hz', ylabel: '相位 / rad' } }
    ],

    /* ---------------- 自定义 DOM 与事件绑定 ---------------- */
    build: function (el, ui, P, st) {
      noteEl = U.qs('.callout.note', el);
      const panel = U.qs('.ctrl-panel', el);
      ranges = panel ? U.qsa('input[type=range]', panel) : [];
      zpCanvas = P.zp.canvas;
      zpCanvas.style.cursor = 'crosshair';
      P.zp.box.appendChild(h('div.plot-cap', {
        html: '<b>操作提示</b>：把鼠标移到 ○（零点）或 ×（极点）上按住拖动即可，共轭的另一半会镜像跟随；' +
              '把极点拖出单位圆 → 系统立刻发散。拖动时上面五个滑块同步刷新。'
      }));
      unbinds.push(U.on(zpCanvas, 'mousedown', onDown));
      unbinds.push(U.on(global, 'mousemove', onMove));
      unbinds.push(U.on(global, 'mouseup', onUp));
    },

    /* ---------------- 主更新 ---------------- */
    update: function (st, P, ui) {
      /* 1. 预设切换：同步改写滑块（触发 input → 状态同步刷新） */
      if (st.preset !== lastPreset) {
        lastPreset = st.preset;
        modeOverride = null;
        const p = PRESETS[st.preset];
        if (p) {
          setRange(ranges[0], p.r);
          setRange(ranges[1], p.th);
          setRange(ranges[2], p.zr);
          setRange(ranges[3], p.zth);
          setRange(ranges[4], p.K);
        }
      }

      /* 2. 结构判定：用户手动改动零点/相角即解除全通、一阶结构 */
      let mode = modeOverride || (PRESETS[st.preset] && PRESETS[st.preset].mode) || 'biquad';
      if (mode === 'first' && Math.abs(st.th) > 1e-9) { modeOverride = 'biquad'; mode = 'biquad'; }
      if (mode === 'ap') {
        const zrNeed = 1 / Math.max(st.r, 1e-6);
        if (Math.abs(st.zr - zrNeed) > 5e-3 || Math.abs(st.zth - st.th) > 1e-9) {
          modeOverride = 'biquad'; mode = 'biquad';
        }
      }

      /* 3. 组装零极点 */
      const pr = st.r, pth = st.th * Math.PI / 180;
      const pole = { re: pr * Math.cos(pth), im: pr * Math.sin(pth) };
      let zeros, poles;
      if (mode === 'first') {
        poles = [{ re: pole.re, im: 0 }];
        zeros = [];
      } else {
        poles = [pole, { re: pole.re, im: -pole.im }];
        if (mode === 'ap') {
          const s = pr * pr || 1e-6;                       // 零点 = 1/p* = p/|p|²
          zeros = [{ re: pole.re / s, im: pole.im / s }, { re: pole.re / s, im: -pole.im / s }];
        } else {
          const zr = st.zr, zth = st.zth * Math.PI / 180;
          const z0 = { re: zr * Math.cos(zth), im: zr * Math.sin(zth) };
          zeros = [z0, { re: z0.re, im: -z0.im }];
        }
      }

      /* 4. 频率响应与冲激响应 */
      const H = C.zpH2Freq(zeros, poles, st.K, NFFT);
      const fAxis = new Float64Array(NH);
      const magDb = new Float64Array(NH);
      let peakIdx = 0, peakMag = 0;
      for (let i = 0; i < NH; i++) {
        const m = Math.hypot(H.re[i], H.im[i]);
        fAxis[i] = i / NFFT * FS;
        magDb[i] = 20 * Math.log10(Math.max(m, 1e-12));
        if (m > peakMag) { peakMag = m; peakIdx = i; }
      }
      const peakDb = 20 * Math.log10(Math.max(peakMag, 1e-12));
      const fPeak = peakIdx / NFFT * FS;

      const NI = 64;
      const hh = C.zpH2Impulse(zeros, poles, st.K, NI);
      const hn = new Float64Array(NI);
      let hMax = 0;
      for (let i = 0; i < NI; i++) {
        hn[i] = hh.re[i];
        if (Math.abs(hn[i]) > hMax) hMax = Math.abs(hn[i]);
      }

      const stable = C.isStable(poles);

      /* 5. 关键物理量 */
      const fr = st.th / 360 * FS;                                   // 谐振频率 Hz
      const bw = (pr > 1e-6 && pr < 1) ? (-Math.log(pr)) * FS / Math.PI : NaN;   // −3 dB 带宽
      const bwL = (pr > 0 && pr < 1) ? FS * (1 - pr) / Math.PI : NaN;
      const tau = (pr > 1e-6 && pr < 1) ? -1 / Math.log(pr) : Infinity;          // 衰减时间常数（样点）
      const n1 = (pr > 1e-6 && pr < 1) ? Math.ceil(Math.log(0.01) / Math.log(pr)) : Infinity;
      const Qv = (isFinite(bw) && bw > 1e-9) ? fr / bw : NaN;
      const fz = st.zth / 360 * FS;                                  // 零点对应频率
      const z0u = zeros.length ? zeros[0] : { re: 0, im: 0 };
      const dZP = zeros.length ? Math.hypot(z0u.re - pole.re, z0u.im - pole.im) : NaN;

      /* 6. 绘图 */
      // ① z 平面
      geo = DSP.plot.zplane(P.zp.canvas, {
        zeros: zeros, poles: poles, height: 300,
        title: '单位圆 = 稳定边界'
      });
      handles = [];
      zeros.forEach(z => handles.push({ kind: 'z', px: geo.P(z).px, py: geo.P(z).py }));
      poles.forEach(z => handles.push({ kind: 'p', px: geo.P(z).px, py: geo.P(z).py }));

      // ② 冲激响应
      const pImp = P.imp.plot;
      pImp.clear();
      pImp.add({ x: U.arange(NI), y: hn, type: 'stem', color: 0, label: 'h[n]' });
      if (stable && pr > 1e-6 && pr < 1 && hMax > 0) {
        const env = new Float64Array(NI), envN = new Float64Array(NI);
        for (let i = 0; i < NI; i++) { env[i] = hMax * Math.pow(pr, i); envN[i] = -env[i]; }
        pImp.add({ x: U.arange(NI), y: env, type: 'line', color: 1, width: 1.2, dash: [5, 4], alpha: 0.85, label: '包络 ±A·rⁿ' });
        pImp.add({ x: U.arange(NI), y: envN, type: 'line', color: 1, width: 1.2, dash: [5, 4], alpha: 0.85 });
      }
      pImp.draw();

      // ③ 幅频
      const pMag = P.mag.plot;
      pMag.clear();
      pMag.add({ x: fAxis, y: magDb, type: 'line', color: 0, label: '|H| / dB' });
      if (mode !== 'first' && fr > 1 && fr < FS / 2) {
        pMag.vline(fr, { label: '谐振 ' + U.fmt(fr, 1) + ' Hz', color: '#b45309' });
      }
      if (zeros.length && st.zr > 0.85 && fz > 1 && fz < FS / 2) {
        pMag.vline(fz, { label: '零点 ' + U.fmt(fz, 1) + ' Hz', color: '#1b5aa4' });
      }
      pMag.hline(peakDb - 3, { label: '峰值 −3 dB', color: '#b91c1c' });
      pMag.draw();

      // ④ 相频
      const phAll = C.unwrap(C.carg(H));
      const ph = new Float64Array(NH);
      for (let i = 0; i < NH; i++) ph[i] = phAll[i];
      P.pha.plot.clear()
        .add({ x: fAxis, y: ph, type: 'line', color: 2, label: '∠H / rad' })
        .draw();

      /* 7. 解读 */
      let formula;
      if (mode === 'first') {
        formula = '$$H(z)=\\frac{K}{1-p_1 z^{-1}},\\quad p_1=' + U.fmt(pole.re, 2) + ',\\;K=' + U.fmt(st.K, 2) + '$$';
      } else if (mode === 'ap') {
        formula = '$$H(z)=K\\frac{(1-z_1z^{-1})(1-z_1^{*}z^{-1})}{(1-p_1z^{-1})(1-p_1^{*}z^{-1})},\\quad z_1=\\frac{1}{p_1^{*}},\\;p_1=' +
          U.fmt(pr, 2) + '\\angle ' + U.fmt(st.th, 0) + '^{\\circ}$$';
      } else {
        formula = '$$H(z)=K\\frac{(1-z_1z^{-1})(1-z_1^{*}z^{-1})}{(1-p_1z^{-1})(1-p_1^{*}z^{-1})},\\quad p_1=' +
          U.fmt(pr, 2) + '\\angle ' + U.fmt(st.th, 0) + '^{\\circ},\\;z_1=' +
          U.fmt(st.zr, 2) + '\\angle ' + U.fmt(st.zth, 0) + '^{\\circ},\\;K=' + U.fmt(st.K, 2) + '$$';
      }

      const L = [];
      L.push('**当前系统函数**（实系数，零点/极点共轭成对）');
      L.push(formula);

      L.push('**画面为什么这样**：极点 p₁ = ' + U.fmt(pr, 2) + '∠' + U.fmt(st.th, 0) +
        '° 离单位圆还有 ' + U.fmt(1 - pr, 2) + '，于是幅频在 f = ' + U.fmt(fPeak, 1) +
        ' Hz（理论谐振点 ' + U.fmt(fr, 1) + ' Hz）鼓起一个 ' + U.fmt(peakDb, 1) +
        ' dB 的峰；冲激响应是 ' + (stable ? '衰减' : '发散') + '振荡，' +
        (stable ? '包络按 ' + U.fmt(pr, 2) + 'ⁿ 衰减' : '包络按 ' + U.fmt(pr, 2) + 'ⁿ 增长') + '。');

      L.push('**稳定性判定**：`C.isStable` = **' + (stable ? 'true（稳定）' : 'false（不稳定）') +
        '**，|p| = ' + U.fmt(pr, 3) + (pr >= 1 ? ' ≥ 1，极点在单位圆上或圆外' : ' < 1，极点全在单位圆内') +
        '。把 r 从 0.6 拖到 1.0 再看 1.2：h[n] 会由衰减振荡 → 等幅振荡（r=1 临界稳定）→ 发散，' +
        '幅频峰同步由矮胖变成极高的尖峰。');

      if (mode !== 'first') {
        L.push('**谐振与带宽**：f_r = θ_p·f_s/(2π) = ' + U.fmt(fr, 1) + ' Hz；−3 dB 带宽 BW ≈ −ln(r)·f_s/π = ' +
          (isFinite(bw) ? U.fmt(bw, 1) + ' Hz' : '∞（不衰减，无稳态带宽）') +
          '（另一近似 (1−r)·f_s/π = ' + (isFinite(bwL) ? U.fmt(bwL, 1) : '—') + ' Hz）；Q = f_r/BW = ' +
          (isFinite(Qv) ? U.fmt(Qv, 2) : '—') +
          '。**r 越接近 1，−ln r → 0，峰越尖、越接近临界稳定**，代价是冲激响应拖尾变长：衰减时间常数 −1/ln r = ' +
          (isFinite(tau) ? U.fmt(tau, 1) + ' 样点' : '∞') + '。');
      }

      if (zeros.length) {
        let ztxt = '**零点的作用**：零点 z₁ = ' + U.fmt(st.zr, 2) + '∠' + U.fmt(st.zth, 0) +
          '°（对应 ' + U.fmt(fz, 1) + ' Hz）';
        if (Math.abs(st.zr - 1) < 0.02) {
          ztxt += '，**正好落在单位圆上 → 该频率被完全抑制（陷波，理论上 −∞ dB）**；把它移到 θ_z = θ_p 就成了带阻陷波器。';
        } else if (st.zr > 1) {
          ztxt += '，在单位圆外，对应频率被抬升而非抑制（常用于相位均衡）。';
        } else {
          ztxt += '，离单位圆 ' + U.fmt(1 - st.zr, 2) + '，只把该频率压下去一点，零点越靠近单位圆陷得越深。';
        }
        ztxt += ' 零点与极点的距离 |z₁−p₁| = ' + U.fmt(dZP, 2) +
          (dZP < 0.15 ? '，**几乎重合 → 二者相互抵消（偶极子），该频率的峰被削平**' : '，距离越大，零点对极点的"削峰"作用越弱') + '。';
        L.push(ztxt);
      } else {
        L.push('**一阶系统**：只有一个实极点 p = ' + U.fmt(pole.re, 2) + '，h[n] = K·pⁿ 单调衰减，没有振荡也没有谐振峰。');
      }

      if (mode === 'ap') {
        L.push('**全通**：零点被锁在 1/p* 处（|z₁| = 1/r = ' + U.fmt(1 / Math.max(pr, 1e-6), 2) +
          '），幅频恒为 ' + U.fmt(peakDb, 1) + ' dB（一条平线），只改相位——拖动零点或改动零点滑块即可退出全通结构。');
      }

      ui.explain(L.join('\n\n'));
      if (noteEl) UI.renderMathIn(noteEl);

      /* 8. 指标 */
      ui.metrics([
        { label: '极点模长 |p|', value: U.fmt(pr, 3) },
        { label: '谐振频率 f_r', value: U.fmt(fr, 1), unit: 'Hz' },
        { label: '−3 dB 带宽', value: isFinite(bw) ? U.fmt(bw, 1) : '—', unit: 'Hz' },
        { label: '是否稳定', value: stable ? '稳定' : '不稳定' },
        { label: '衰减到 1%', value: isFinite(n1) ? String(n1) : '∞', unit: '样点' },
        { label: 'Q 值', value: isFinite(Qv) ? U.fmt(Qv, 2) : '—' },
        { label: '峰值增益', value: U.fmt(peakDb, 1), unit: 'dB' },
        { label: '谐振点实测', value: U.fmt(fPeak, 1), unit: 'Hz' }
      ]);
    },

    cleanup: function () {
      unbinds.forEach(f => { try { f(); } catch (e) {} });
      unbinds = [];
      drag = null; geo = null; handles = []; zpCanvas = null; ranges = []; noteEl = null;
    },

    advice: '先把预设切到"低通谐振器"，把 r 从 0.5 慢慢拖到 1.05：幅频峰从矮胖变尖高，冲激响应从几拍衰减变成几十拍拖尾，跨过单位圆后彻底发散——这一条比任何公式都直观。想看陷波，就把零点相角调到与极点相角相同、零点模长调到 1.00，该频率立刻被吃掉，这就是 notch 滤波器的设计手法。最后直接用鼠标把极点往单位圆上拖，体会"极点决定稳定与谐振，零点只雕刻形状"。',
    eng: '教科书里的二阶节常用直接 II 型实现，但 r 接近 1 时极点与单位圆的间隙只有 1e-3 量级，定点量化把系数一舍入，极点就可能被推到圆外，设备上电自激。工程上要么改用耦合形式或状态空间实现来降低系数灵敏度，要么限制 Q 值留出稳定裕度，同时给累加器加饱和保护，避免溢出后退化成等幅极限环。',
    wrong: '常见错误有三条：一是把"极点在单位圆内"等同于"幅频一定好看"，实际上极角接近 0° 或 180° 时峰被挤到频带边缘，有效带宽反而极小；二是以为零点落在单位圆上就等于"完全滤除"，有限字长下实际只能做到 −60 dB 量级的衰减；三是只改一个极点而忘掉它的共轭，系统不再实系数，h[n] 会变成复数——本实验台拖动时已自动保持共轭成对。',

    see: [{ path: 'theory/transform/ztrans', title: 'Z 变换与零极点' }]
  });
})(window);

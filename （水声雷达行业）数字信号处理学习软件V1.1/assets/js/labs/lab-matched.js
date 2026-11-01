/* =============================================================
   lab-matched.js —— 匹配滤波与脉冲压缩实验台（路由 lab/matched）

   仿真链路（复基带）：
     发射 s(t) → 解析信号 sA → 加时延 / 多普勒的目标回波 → 复高斯白噪声
     → 与「加权后的发射副本」做复匹配滤波 → 脉冲压缩输出

   两条重要的实现约定：
   1) SNR 定义：滑块给的是 **信号带宽内的输入 SNR**，即 SNR_in = Ps/(σ²·B_eff/fs)，
      于是「输出 SNR − 输入 SNR」恰好等于处理增益 10log₁₀(B_eff·T)，与教科书一致；
      时域回波则完全埋在噪声里（这正是要演示的现象）。
   2) 输出噪声功率按「匹配滤波的部分重叠长度」归一化后再统计，
      否则输出数组两端（重叠不完全）会把噪声地板低估，增益算出来偏大。
   注：核心库 C.pulseMetrics 对复数组取 y.length 会失效，故先取模再以 raw:true 传入。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;

  const SEED = 20240921;                 // 固定噪声种子，保证可复现
  const BARKER13 = [1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1];

  const PLAT = {
    sonar: { c: 1500, fc: 10000, name: '声呐（c = 1500 m/s，载频 10 kHz）' },
    radar: { c: 3e8, fc: 3e9, name: '雷达（c = 3e8 m/s，载频 3 GHz）' }
  };
  const WINNAME = { rect: '矩形（不加窗）', hann: '汉宁', hamming: '汉明', blackman: '布莱克曼' };

  let noteEl = null;

  const nextPow2 = n => { let p = 1; while (p < n) p <<= 1; return p; };

  /** 频域快速复相关（大序列用），结果与 C.matchedFilterC 一致 */
  function fastCorrC(x, hh) {
    const N = x.re.length, M = hh.re.length;
    const L = nextPow2(N + M - 1);
    const X = C.fftC(x, L), Hh = C.fftC(hh, L);
    const Y = { re: new Float64Array(L), im: new Float64Array(L) };
    for (let i = 0; i < L; i++) {          // Y = X · conj(H)
      Y.re[i] = X.re[i] * Hh.re[i] + X.im[i] * Hh.im[i];
      Y.im[i] = X.im[i] * Hh.re[i] - X.re[i] * Hh.im[i];
    }
    const t = C.ifft(Y);
    const out = { re: new Float64Array(N + M - 1), im: new Float64Array(N + M - 1) };
    const lim = Math.min(out.re.length - 1, L - M);   // 再往后就绕回成循环相关，直接置零
    for (let n = 0; n <= lim; n++) { out.re[n] = t.re[n]; out.im[n] = t.im[n]; }
    return out;
  }

  /** 已算好参考函数频谱时的快速相关（多次相关可复用同一个 H，省掉一半 FFT） */
  function corrPre(x, HF, M) {
    const N = x.re.length, L = HF.re.length;
    const X = C.fftC(x, L);
    const Y = { re: new Float64Array(L), im: new Float64Array(L) };
    for (let i = 0; i < L; i++) {
      Y.re[i] = X.re[i] * HF.re[i] + X.im[i] * HF.im[i];
      Y.im[i] = X.im[i] * HF.re[i] - X.re[i] * HF.im[i];
    }
    const t = C.ifft(Y);
    const out = { re: new Float64Array(N + M - 1), im: new Float64Array(N + M - 1) };
    const lim = Math.min(out.re.length - 1, L - M);
    for (let n = 0; n <= lim; n++) { out.re[n] = t.re[n]; out.im[n] = t.im[n]; }
    return out;
  }

  /** 复匹配滤波：小序列直接算，大序列走 FFT（HF 为可选的参考函数频谱缓存） */
  function myMatch(x, hh, HF) {
    if (HF) return corrPre(x, HF, hh.re.length);
    return (x.re.length * hh.re.length > 2e6) ? fastCorrC(x, hh) : C.matchedFilterC(x, hh);
  }

  /** 复数组取模 */
  function cabsArr(y) {
    const n = y.re.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.hypot(y.re[i], y.im[i]);
    return out;
  }

  /* =============================================================
     实验台定义
     ============================================================= */
  DSP.lab.create({
    path: 'lab/matched',
    title: '匹配滤波与脉冲压缩实验台',
    lede: '发射一个长脉冲，让回波淹没在噪声里，再用匹配滤波把它"压缩"成一个尖峰——处理增益 BT、旁瓣、距离分辨率与多普勒失配一屏看完。',
    tags: ['匹配滤波', '脉冲压缩', '雷达', '声呐', '多普勒'],
    cols: 2,

    params: [
      {
        k: 'wave', type: 'seg', label: '发射波形', value: 'lfm',
        options: [
          { value: 'lfm',   label: 'LFM 线性调频' },
          { value: 'cw',    label: '单频 CW 矩形脉冲' },
          { value: 'bark',  label: '13 位巴克码' },
          { value: 'gauss', label: '高斯包络脉冲' }
        ],
        hint: '只有大时宽带宽积的波形才有脉压增益'
      },
      { k: 'B',     type: 'slider', label: '带宽 B',       min: 500,  max: 5000,  step: 50,   value: 2000,  unit: 'Hz', hint: '受采样率限制会自动截到 0.4·fs' },
      { k: 'T',     type: 'slider', label: '脉宽 T',       min: 2,    max: 50,    step: 1,    value: 20,    unit: 'ms', hint: 'T 越长，能量越大，处理增益越高' },
      { k: 'fs',    type: 'slider', label: '采样率 fs',    min: 8000, max: 48000, step: 1000, value: 16000, unit: 'Hz' },
      { k: 'snr',   type: 'slider', label: '输入 SNR',     min: -20,  max: 20,    step: 1,    value: -5,    unit: 'dB', hint: '按信号带宽内的 SNR 定义' },
      { k: 'delay', type: 'slider', label: '目标时延',     min: 5,    max: 60,    step: 1,    value: 25,    unit: 'ms', hint: '往返时延 τ，距离 R = cτ/2' },
      { k: 'dual',  type: 'toggle', label: '双目标',       value: false, hint: '再加一个弱目标，考察分辨能力' },
      { k: 'sep',   type: 'slider', label: '第二目标间距', min: 0.5,  max: 5,     step: 0.1,  value: 2,     unit: 'ms' },
      {
        k: 'win', type: 'select', label: '加权窗（作用于参考函数）', value: 'rect',
        options: [
          { value: 'rect',     label: '不加窗（矩形）' },
          { value: 'hann',     label: '汉宁窗' },
          { value: 'hamming',  label: '汉明窗' },
          { value: 'blackman', label: '布莱克曼窗' }
        ],
        hint: '压旁瓣的代价：主瓣展宽 + 信噪比损失'
      },
      {
        k: 'plat', type: 'seg', label: '平台（决定 c 与载频）', value: 'sonar',
        options: [{ value: 'sonar', label: '声呐' }, { value: 'radar', label: '雷达' }],
        hint: '只影响距离换算与多普勒尺度'
      },
      { k: 'v', type: 'slider', label: '目标径向速度', min: 0, max: 300, step: 1, value: 0, unit: 'm/s', hint: '声呐典型 0~30 m/s；速度越大脉压峰越低' }
    ],

    plots: [
      { key: 'tx',   title: '① 发射波形（实部）', height: 250, opts: { xlabel: 't / ms', ylabel: '幅度', legend: true } },
      { key: 'rx',   title: '② 含噪回波（实部）——信号已完全埋在噪声里', height: 250, opts: { xlabel: 't / ms', ylabel: '幅度', legend: true } },
      { key: 'pc',   title: '③ 脉压输出（dB，归一化到峰值）', height: 260, opts: { xlabel: 't / ms', ylabel: 'dB', legend: true } },
      { key: 'zoom', title: '④ 主瓣放大（线性，看 −3 dB 宽度与旁瓣结构）', height: 260, opts: { xlabel: '相对峰值时延 / ms', ylabel: '归一化幅度', legend: true } }
    ],

    build: function (el, ui, P, st) {
      noteEl = U.qs('.callout.note', el);
    },

    /* ---------------- 主更新 ---------------- */
    update: function (st, P, ui) {
      const fs = st.fs;
      const Ts = st.T / 1000;                       // 脉宽（s）
      const Np = Math.max(16, Math.round(Ts * fs)); // 发射样本数
      const Buse = Math.min(st.B, 0.4 * fs);        // 带宽受采样率限制
      const fc0 = Buse / 2 + 0.05 * fs;             // 基带载波（保证频谱单边，便于取解析信号）

      /* ---- 1. 发射波形（实信号）+ 解析信号 ---- */
      const s = new Float64Array(Np);
      let B_eff = Buse;                             // 有效带宽（决定处理增益与分辨率）
      if (st.wave === 'lfm') {
        s.set(C.chirp(Np, fs, fc0 - Buse / 2, fc0 + Buse / 2, Ts));
      } else if (st.wave === 'cw') {
        for (let i = 0; i < Np; i++) s[i] = Math.sin(2 * Math.PI * fc0 * i / fs);
        B_eff = 1 / Ts;                             // BT = 1，没有脉压增益
      } else if (st.wave === 'bark') {
        for (let i = 0; i < Np; i++) {
          s[i] = BARKER13[Math.min(12, Math.floor(i * 13 / Np))] * Math.sin(2 * Math.PI * fc0 * i / fs);
        }
        B_eff = 13 / Ts;                            // 码率 13/T，压缩比 13
      } else {
        s.set(C.gaussPulse(Np, fs, fc0, Buse / 2, Ts / 2));
      }
      const sA = C.hilbert(s);                      // 复解析信号（复基带处理用）
      let E = 0;
      for (let i = 0; i < Np; i++) E += sA.re[i] * sA.re[i] + sA.im[i] * sA.im[i];
      if (!(E > 0)) E = 1e-12;

      /* ---- 2. 目标回波（时延 + 多普勒） ---- */
      const plat = PLAT[st.plat] || PLAT.sonar;
      const c = plat.c;
      const fd = C.doppler(st.v, plat.fc, c);       // 多普勒频移 fd = 2v·fc/c
      const D = Math.round(st.delay / 1000 * fs);
      const D2 = D + Math.round(st.sep / 1000 * fs);
      const a1 = 1.0, a2 = 0.8;                     // 两目标幅度（第二个弱 2 dB）
      const Nrec = D2 + Np + Math.max(128, Math.round(0.015 * fs));

      function buildEcho(targets) {
        const R = new Float64Array(Nrec), I = new Float64Array(Nrec);
        for (const tg of targets) {
          for (let k = 0; k < Np; k++) {
            const n = tg.d + k;
            if (n < 0 || n >= Nrec) continue;
            const ph = 2 * Math.PI * fd * (n / fs), cs = Math.cos(ph), sn = Math.sin(ph);
            R[n] += tg.a * (sA.re[k] * cs - sA.im[k] * sn);
            I[n] += tg.a * (sA.re[k] * sn + sA.im[k] * cs);
          }
        }
        return { re: R, im: I };
      }
      const xClean1 = buildEcho([{ d: D, a: a1 }]);                                     // 单目标（测脉压质量）
      const xClean = buildEcho(st.dual ? [{ d: D, a: a1 }, { d: D2, a: a2 }] : [{ d: D, a: a1 }]);

      /* ---- 3. 加噪：目标复噪声总方差 σ² = Ps·fs/(B_eff·S)，实部虚部各 σ²/2 ---- */
      const Ps1 = E / Np;                                    // 单个目标的每样点平均功率
      const Slin = Math.pow(10, st.snr / 10);
      const sigma2 = Ps1 * fs / (B_eff * Slin);              // 复噪声总方差（每样点）
      const pnComp = sigma2 / 2;                             // 每个分量的方差
      let psR = 0, psI = 0;
      for (let i = 0; i < Nrec; i++) {
        psR += xClean.re[i] * xClean.re[i];
        psI += xClean.im[i] * xClean.im[i];
      }
      psR = Math.max(psR / Nrec, 1e-20); psI = Math.max(psI / Nrec, 1e-20);
      const xNoisy = {                                       // 借 C.addNoise 注入指定功率的噪声
        re: C.addNoise(xClean.re, 10 * Math.log10(psR / pnComp), SEED),
        im: C.addNoise(xClean.im, 10 * Math.log10(psI / pnComp), SEED + 10139)
      };

      /* ---- 4. 匹配滤波：参考函数 = 加权后的发射副本 ---- */
      const w = C.window(st.win, Np);
      const hRef = { re: new Float64Array(Np), im: new Float64Array(Np) };
      for (let k = 0; k < Np; k++) { hRef.re[k] = sA.re[k] * w[k]; hRef.im[k] = sA.im[k] * w[k]; }

      const HF = (Nrec * Np > 2e6) ? C.fftC(hRef, nextPow2(Nrec + Np - 1)) : null;  // 参考函数频谱复用
      const y = myMatch(xNoisy, hRef, HF);          // 含噪（用于展示与实测噪声地板）
      const yC = myMatch(xClean, hRef, HF);         // 干净（单目标时即单目标压缩）
      const yQ = st.dual ? myMatch(xClean1, hRef, HF) : yC;   // 干净单目标（PSL / 宽度 / 多普勒）
      const absY = cabsArr(y), absQ = cabsArr(yQ), absC = cabsArr(yC);
      const pm = C.pulseMetrics(absY, { raw: true });
      const pmQ = C.pulseMetrics(absQ, { raw: true });
      const pmC = C.pulseMetrics(absC, { raw: true });

      // 未加权对照（量化"加权窗的代价"）
      let pmQR = null;
      if (st.win !== 'rect') {
        pmQR = C.pulseMetrics(cabsArr(myMatch(xClean1, { re: sA.re, im: sA.im })), { raw: true });
      }

      /* ---- 5. 输出 SNR：噪声地板按"重叠长度"归一化后统计 ---- */
      const len = y.re.length;
      const pre = new Float64Array(Np + 1);         // |h[k]|² 前缀和
      for (let k = 0; k < Np; k++) pre[k + 1] = pre[k] + hRef.re[k] * hRef.re[k] + hRef.im[k] * hRef.im[k];
      const Eh = pre[Np] || 1e-12;                  // 参考函数能量
      let acc = 0, cnt = 0;
      const loG = D - Np - 1, hiG = (st.dual ? D2 : D) + Np + 1;
      for (let n = 0; n < len; n++) {
        if (n >= loG && n <= hiG) continue;         // 剔除信号（含旁瓣）支撑区
        const hi = Math.min(Np - 1, Nrec - 1 - n);
        if (hi < 0) continue;
        const ov = pre[hi + 1];
        if (ov < 0.25 * Eh) continue;               // 重叠太短的尾部丢弃
        acc += (y.re[n] * y.re[n] + y.im[n] * y.im[n]) / ov;
        cnt++;
      }
      const sig2 = cnt ? acc / cnt : 1e-12;         // 单位能量的噪声功率 → 每样点噪声方差
      const nFloor = sig2 * Eh;                     // 全重叠处的输出噪声功率
      // 输出 SNR = 无噪压缩峰功率（含多普勒损失）/ 实测输出噪声功率。
      // 不用"含噪峰值"直接算：单样点的噪声起伏会让它在 ±1.5 dB 内乱跳（CW 波形更会选中纯噪声峰）。
      const sigPow = Math.max(pmQ.peakVal * pmQ.peakVal, 1e-12);
      const sigPowPk = Math.max(pm.peakVal * pm.peakVal - nFloor, 1e-12);
      const outSnrDb = 10 * Math.log10(sigPow / Math.max(nFloor, 1e-30));
      const outSnrPkDb = 10 * Math.log10(sigPowPk / Math.max(nFloor, 1e-30));
      const gainTheory = C.pulseGainDb(B_eff, Ts);
      const improveDb = outSnrDb - st.snr;

      /* ---- 6. 距离 / 分辨率 / 多普勒 / 窗代价 ---- */
      const tAxis = n => n / fs * 1000;                        // 样点 → ms
      const rPeak = pm.peakIdx / fs * c / 2;                   // 峰值距离（m）
      const rTrue = st.delay / 1000 * c / 2;
      const w3ms = pmQ.width3dB / fs * 1000;                   // −3 dB 宽度（ms）
      const resMeas = pmQ.width3dB / fs * c / 2;               // 实测距离分辨率（m）
      const resTheory = C.rangeRes(c, B_eff);                  // 理论 c/(2B)

      let pNoDop = 0;                                          // 无多普勒时的理论峰值
      for (let k = 0; k < Np; k++) pNoDop += (sA.re[k] * sA.re[k] + sA.im[k] * sA.im[k]) * w[k];
      pNoDop = Math.max(pNoDop, 1e-30);
      const dopLoss = 20 * Math.log10(Math.max(pmQ.peakVal, 1e-30) / pNoDop);
      const dopShift = Math.abs((pmQ.peakIdx - D) / fs * c / 2);   // 距离-多普勒耦合 ΔR

      let winLoss = 0;
      if (st.win !== 'rect') {
        let sw = 0, sw2 = 0, s0 = 0;
        for (let k = 0; k < Np; k++) {
          const p = sA.re[k] * sA.re[k] + sA.im[k] * sA.im[k];
          sw += p * w[k]; sw2 += p * w[k] * w[k]; s0 += p;
        }
        winLoss = 10 * Math.log10(Math.max(sw * sw, 1e-30) / Math.max(sw2 * s0, 1e-30));
      }

      /* ---- 7. 绘图 ---- */
      const tTx = new Float64Array(Np), envTx = new Float64Array(Np);
      for (let i = 0; i < Np; i++) { tTx[i] = i / fs * 1000; envTx[i] = Math.hypot(sA.re[i], sA.im[i]); }
      P.tx.plot.clear()
        .add({ x: tTx, y: s, type: 'line', color: 0, label: '发射 s(t)' })
        .add({ x: tTx, y: envTx, type: 'line', color: 1, width: 1.2, dash: [5, 4], alpha: 0.8, label: '包络 |sA|' })
        .draw();

      const tRx = new Float64Array(Nrec);
      for (let i = 0; i < Nrec; i++) tRx[i] = i / fs * 1000;
      P.rx.plot.clear()
        .add({ x: tRx, y: xNoisy.re, type: 'line', color: 0, width: 1, alpha: 0.9, label: '含噪回波（实部）' })
        .add({ x: tRx, y: xClean.re, type: 'line', color: 2, width: 1.4, alpha: 0.55, label: '干净回波（对照）' })
        .vline(st.delay, { label: '真值 ' + U.fmt(rTrue, 1) + ' m', color: '#b45309' })
        .draw();

      const tY = new Float64Array(len);
      for (let i = 0; i < len; i++) tY[i] = i / fs * 1000;
      const pc = P.pc.plot;
      pc.clear();
      pc.add({ x: tY, y: pm.db, type: 'line', color: 0, label: '脉压输出' })
        .hline(-3, { label: '−3 dB', color: '#b45309' })
        .hline(pmQ.psl, { label: 'PSL ' + U.fmt(pmQ.psl, 1) + ' dB', color: '#b91c1c' })
        .vline(tAxis(pm.peakIdx), { label: '峰 ' + U.fmt(rPeak, 1) + ' m', color: '#1b5aa4' });
      if (st.dual) pc.vline(st.delay + st.sep, { label: '目标2 真值', color: '#7c3aed' });
      pc.draw();

      // ④ 主瓣放大（以干净单目标压缩峰为中心，展示 −3 dB 宽度与旁瓣结构）
      const pkC = Math.max(pmQ.peakVal, 1e-30);
      const Z = Math.max(16, Math.min(400, Math.round(pmQ.width3dB * 5)));
      const ci = pmQ.peakIdx;
      const i0 = Math.max(0, ci - Z), i1 = Math.min(absQ.length - 1, ci + Z);
      const nz = Math.max(1, i1 - i0 + 1);
      const zx = new Float64Array(nz), zy = new Float64Array(nz);
      for (let i = 0; i < nz; i++) {
        zx[i] = (i0 + i - ci) / fs * 1000;
        zy[i] = absQ[i0 + i] / pkC;
      }
      P.zoom.plot.clear()
        .add({ x: zx, y: zy, type: 'line', color: 0, label: '无噪压缩主瓣' })
        .add({ x: [-pmQ.width3dB / 2 / fs * 1000, pmQ.width3dB / 2 / fs * 1000], y: [0.7079, 0.7079], type: 'scatter', color: 3, size: 3 })
        .hline(0.7079, { label: '−3 dB（宽度 ' + U.fmt(w3ms, 3) + ' ms）', color: '#b45309' })
        .hline(Math.pow(10, pmQ.psl / 20), { label: 'PSL ' + U.fmt(pmQ.psl, 1) + ' dB', color: '#b91c1c' })
        .draw();

      /* ---- 8. 解读 ---- */
      const waveName = { lfm: 'LFM 线性调频', cw: '单频 CW 矩形脉冲', bark: '13 位巴克码', gauss: '高斯包络脉冲' }[st.wave];
      const L = [];
      L.push('**当前链路**：' + waveName + '，T = ' + U.fmt(st.T, 0) + ' ms（' + Np + ' 样点），B = ' +
        U.fmt(Buse, 0) + ' Hz（有效带宽 ' + U.fmt(B_eff, 0) + ' Hz），fs = ' + U.fmt(fs / 1000, 0) +
        ' kHz；平台 ' + plat.name + '。');

      L.push('**处理增益**：时宽带宽积 B·T = ' + U.fmt(B_eff * Ts, 1) + '，理论 ' +
        '$$10\\log_{10}(BT)=' + U.fmt(gainTheory, 1) + '\\ \\mathrm{dB}$$' +
        ' 实测：输出 SNR = 峰功率 / 实测噪声地板 = ' + U.fmt(outSnrDb, 1) + ' dB，输入 SNR = ' + U.fmt(st.snr, 0) +
        ' dB，**改善 ' + U.fmt(improveDb, 1) + ' dB**' +
        (Math.abs(improveDb - gainTheory) < 2.5 ? '（与理论吻合，残差来自噪声实现）' : '（噪声实现会带来 ±2 dB 波动）') +
        '（全程取最大得到的峰 SNR 为 ' + U.fmt(outSnrPkDb, 1) + ' dB' +
        (outSnrPkDb - outSnrDb > 2 ? '，明显偏高——因为搜索最大值本身会挑中噪声起伏' : '') + '）' +
        '。把视线放回图②：回波在时域里肉眼完全看不见（按每个样点算，噪声功率是信号功率的 ' +
        U.fmt((fs / B_eff) / Math.pow(10, st.snr / 10), 1) + ' 倍），图③却能冒出一个高出噪声地板 ' +
        U.fmt(outSnrDb, 0) + ' dB 的峰——这就是匹配滤波的全部意义。');

      L.push('**脉压质量（无噪理想压缩）**：峰值落在第 ' + pmQ.peakIdx + ' 样点（真值 ' + D +
        '），−3 dB 宽度 ' + U.fmt(pmQ.width3dB, 2) + ' 样点 = ' + U.fmt(w3ms, 3) + ' ms → 实测距离分辨率 ' +
        U.fmt(resMeas, 3) + ' m，理论 c/(2B) = ' + U.fmt(resTheory, 3) + ' m' +
        (st.wave === 'cw' ? '（CW 的 B≈1/T，BT=1，所以分辨率差得离谱）' : '（两者基本一致）') +
        '；PSL = ' + U.fmt(pmQ.psl, 1) + ' dB，ISLR = ' + U.fmt(pmQ.islr, 1) + ' dB' +
        (st.wave === 'lfm' && st.win === 'rect' ? ' —— 未加权 LFM 的压缩包络就是 sinc，第一旁瓣理论值 −13.3 dB' : '') + '。');

      if (st.win !== 'rect' && pmQR) {
        L.push('**加权窗的代价**：' + (WINNAME[st.win] || st.win) + '加权后 PSL 从 ' + U.fmt(pmQR.psl, 1) +
          ' dB 改善到 ' + U.fmt(pmQ.psl, 1) + ' dB（改善 ' + U.fmt(pmQR.psl - pmQ.psl, 1) + ' dB），' +
          '主瓣却从 ' + U.fmt(pmQR.width3dB, 2) + ' 展宽到 ' + U.fmt(pmQ.width3dB, 2) + ' 样点（×' +
          U.fmt(pmQ.width3dB / Math.max(pmQR.width3dB, 1e-6), 2) + '），并且**信噪比损失 ' + U.fmt(winLoss, 2) +
          ' dB**（失配损失，等于 10log₁₀[(Σw)²/(N·Σw²)]）。只有当强目标旁瓣会淹掉弱目标时才值得付这个代价。');
      } else {
        L.push('**旁瓣**：未加权时 LFM 的脉压包络就是 sinc，第一旁瓣 −13.3 dB。' +
          '若场景里有强弱两个目标，这个旁瓣足以把弱目标吃掉——把加权窗切成汉宁或布莱克曼，再对比图④的旁瓣台阶。');
      }

      if (Math.abs(fd) > 1e-6) {
        L.push('**多普勒失配**：v = ' + U.fmt(st.v, 0) + ' m/s → f_d = 2v·f_c/c = ' + U.fmt(fd, 1) +
          ' Hz。主瓣下降 **' + U.fmt(dopLoss, 2) + ' dB**（LFM 近似 20log₁₀(1−|f_d|/B) = ' +
          U.fmt(20 * Math.log10(Math.max(1 - Math.abs(fd) / B_eff, 1e-6)), 2) + ' dB），' +
          '峰值还沿距离维漂了 ' + (pmQ.peakIdx - D) + ' 样点 ≈ ' + U.fmt(dopShift, 2) + ' m' +
          (st.wave === 'lfm' ? ' —— 这就是 **LFM 的距离-多普勒耦合** ΔR = (c/2)·f_d/k：调频斜率 k = B/T 越小（B 小、T 大），同一个速度造成的测距偏差越大。' : '。') +
          (st.plat === 'radar' && dopShift > 10000
            ? ' 注意：本实验台的带宽只有 kHz 量级（声呐尺度），真实雷达带宽在 MHz 量级、调频斜率大几个数量级，同样的速度在雷达上只造成厘米级偏移；这里出现的巨大偏移恰恰说明**脉压参数必须与平台尺度匹配**。'
            : '') +
          ' 工程上要用多普勒补偿滤波器组，或发射正负斜率交替的波形来解耦合。');
      } else {
        L.push('**多普勒**：当前速度为 0，参考函数与回波完全匹配，脉压峰达到理论最高值。' +
          '把速度滑到 10~30 m/s 再看：峰变矮、位置漂移——匹配滤波只对"已知波形"最优，' +
          '这也是为什么要做多普勒滤波器组而不是只做一路匹配滤波。');
      }

      if (st.dual) {
        const sepM = st.sep / 1000 * c / 2;
        const mid = Math.min(absC.length - 1, Math.round((D + D2) / 2));
        const pkD = Math.max(pmC.peakVal, 1e-30);
        const dipDb = 20 * Math.log10(Math.max(absC[mid], 1e-30) / pkD);
        const v1 = 20 * Math.log10(Math.max(absC[D], 1e-30) / pkD);
        const v2 = 20 * Math.log10(Math.max(absC[Math.min(absC.length - 1, D2)], 1e-30) / pkD);
        L.push('**双目标**：两目标时延差 ' + U.fmt(st.sep, 2) + ' ms → 距离差 ' + U.fmt(sepM, 2) +
          ' m，而 −3 dB 主瓣宽度对应 ' + U.fmt(resMeas, 2) + ' m。两峰高度为 ' + U.fmt(v1, 1) + ' / ' +
          U.fmt(v2, 1) + ' dB，中间凹陷 ' + U.fmt(dipDb, 1) + ' dB → ' +
          (dipDb < -3 ? '**可分辨**（凹陷超过 3 dB）' : '**不可分辨**，两个峰粘成一坨，加大 B 或减小 T 才能分开'));
      }

      ui.explain(L.join('\n\n'));
      if (noteEl) UI.renderMathIn(noteEl);

      /* ---- 9. 指标 ---- */
      ui.metrics([
        { label: '处理增益 10log₁₀(BT)', value: U.fmt(gainTheory, 1), unit: 'dB' },
        { label: '输出 SNR', value: U.fmt(outSnrDb, 1), unit: 'dB' },
        { label: '峰 SNR（取最大）', value: U.fmt(outSnrPkDb, 1), unit: 'dB' },
        { label: 'SNR 改善（实测）', value: U.fmt(improveDb, 1), unit: 'dB' },
        { label: 'PSL（无噪）', value: U.fmt(pmQ.psl, 1), unit: 'dB' },
        { label: '−3 dB 宽度', value: U.fmt(w3ms, 3), unit: 'ms' },
        { label: '实测分辨率', value: U.fmt(resMeas, 2), unit: 'm' },
        { label: '理论分辨率', value: U.fmt(resTheory, 2), unit: 'm' },
        { label: '峰值位置', value: U.fmt(rPeak, 2), unit: 'm' },
        { label: '真值距离', value: U.fmt(rTrue, 2), unit: 'm' },
        { label: '多普勒损失', value: U.fmt(dopLoss, 2), unit: 'dB' },
        { label: '多普勒距离偏移', value: U.fmt(dopShift, 2), unit: 'm' }
      ]);
    },

    advice: '先固定 LFM、B=2 kHz、T=20 ms，把输入 SNR 从 0 dB 拉到 −20 dB：图②早已是一片噪声，图③的峰却依然站着——16 dB 处理增益就是这么来的。然后把 T 从 2 ms 拉到 50 ms，看增益怎样按 10log₁₀(BT) 线性增长。想体会旁瓣，就打开双目标、把间距压到 1 ms 以内，再切汉宁/布莱克曼窗对比图④。最后把速度拉到 20 m/s，看峰掉多少 dB、往哪边漂；把波形换成 CW 再试一次，你会明白为什么现代雷达几乎不用单频脉冲。',
    eng: '真实系统里脉压峰会被三件事吃掉：一是目标多普勒，LFM 的距离-多普勒耦合让测距随速度漂移，必须用多普勒补偿组或正负斜率交替发射；二是加权窗，−40 dB 旁瓣的代价通常是 2~3 dB 信噪比与 1.5 倍主瓣展宽，弱目标检测场景宁愿不加窗；三是通道幅相失真与 ADC 量化，实测 PSL 能做到 −30 dB 已属不易，别照抄仿真的 −13.3 dB 理想值。另外脉压后要做峰值插值（如三点抛物线内插），否则距离量化误差就是 c/(2fs)，近距离分辨白白损失。',
    wrong: '常见错误：一是把"时域看不见回波"当成"检测不到"，忘了脉压把 BT 倍能量聚到一个尖峰上；二是只看处理增益不看旁瓣，强目标的 −13 dB 旁瓣足以在邻近距离制造假目标；三是以为 T 越大越好，实际上 T 一旦超过目标去相关时间，回波与副本失配，增益反而下降；四是直接用复数组调用 C.pulseMetrics —— 它内部取 y.length，对 {re,im} 结构会全零返回，正确做法是先取模再以 raw:true 传入；五是统计输出噪声时用了数组两端，那里参考函数只部分重叠，噪声被系统性低估，算出来的增益会虚高 6 dB 以上。',

    see: [{ path: 'theory/random/matched', title: '匹配滤波与脉冲压缩理论' }]
  });
})(window);

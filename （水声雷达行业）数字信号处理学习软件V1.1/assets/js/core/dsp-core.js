/* =============================================================
   dsp-core.js —— 数字信号处理核心算法库（纯 JS，零依赖）
   全局命名空间：window.DSP.core

   组织方式：
     §1 复数与多项式
     §2 信号生成
     §3 采样与重采样
     §4 FFT / IFFT（基 2 迭代，时间抽取）
     §5 窗函数
     §6 卷积与相关
     §7 滤波与频率响应
     §8 FIR 设计（窗函数法）
     §9 经典谱估计
     §10 时频分析（STFT）
     §11 匹配滤波 / 脉冲压缩
     §12 Z 变换与零极点工具
     §13 杂项数值工具

   约定：所有长度 N 的 FFT 运算要求 N 为 2 的幂（对外接口自动补零到 nextPow2）
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;
  const PI = Math.PI;

  /* ============================================================
     §1 复数与多项式
     ============================================================ */

  /** 复数数组构造：cplx(n) / cplx(reArr, imArr) */
  function cplx(a, b) {
    if (typeof a === 'number') return { re: new Float64Array(a), im: new Float64Array(a) };
    if (a && a.re) return { re: Float64Array.from(a.re), im: a.im ? Float64Array.from(a.im) : new Float64Array(a.re.length) };
    return { re: Float64Array.from(a || []), im: Float64Array.from(b || []) };
  }

  /** 由极坐标构造复数 */
  function polar(mag, ang) { return { re: mag * Math.cos(ang), im: mag * Math.sin(ang) }; }

  /** 复数组逐点乘 */
  function cmul(A, B) {
    const n = A.re.length, out = cplx(n);
    for (let i = 0; i < n; i++) {
      out.re[i] = A.re[i] * B.re[i] - A.im[i] * B.im[i];
      out.im[i] = A.re[i] * B.im[i] + A.im[i] * B.re[i];
    }
    return out;
  }

  /** 复数组逐点除 */
  function cdiv(A, B) {
    const n = A.re.length, out = cplx(n);
    for (let i = 0; i < n; i++) {
      const d = B.re[i] * B.re[i] + B.im[i] * B.im[i] || 1e-30;
      out.re[i] = (A.re[i] * B.re[i] + A.im[i] * B.im[i]) / d;
      out.im[i] = (A.im[i] * B.re[i] - A.re[i] * B.im[i]) / d;
    }
    return out;
  }

  const cabs = A => {
    const n = A.re.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.hypot(A.re[i], A.im[i]);
    return out;
  };

  const carg = A => {
    const n = A.re.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.atan2(A.im[i], A.re[i]);
    return out;
  };

  /**
   * 由根生成多项式系数：P(x) = Π(x − r_i)
   * 返回降幂系数数组（长度 = 根数 + 1，首项为 1）
   *
   * 重要：对 z⁻¹ 多项式有直接对应关系 ——
   *   Π(1 − r_i z⁻¹) 的「升幂系数」恰好等于 Π(x − r_i) 的「降幂系数」，
   *   因为 Π(1 − r_i u) = uⁿ·P(1/u)。故本函数可直接用于 H(z) 的 b[]/a[] 系数。
   */
  function polyFromRoots(roots) {
    let cr = [1], ci = [0];
    for (const r of roots) {
      const L = cr.length;
      const nr = new Array(L + 1).fill(0);
      const ni = new Array(L + 1).fill(0);
      for (let i = 0; i < L; i++) {
        // 当前 c[i] 对应 x^{L-1-i}；乘以 x 后指数 +1 → 新数组同索引 i
        nr[i] += cr[i];
        ni[i] += ci[i];
        // 乘以 (−r) 后指数不变 → 新数组索引 i+1
        const rr = r.re === undefined ? r : r.re;
        const ri = r.im === undefined ? 0 : r.im;
        nr[i + 1] += -cr[i] * rr + ci[i] * ri;
        ni[i + 1] += -cr[i] * ri - ci[i] * rr;
      }
      cr = nr; ci = ni;
    }
    return { re: cr, im: ci };
  }

  /** 复系数多项式在点 z 处求值（系数高次→低次），霍纳法 */
  function polyvalC(coefRe, coefIm, z) {
    let r = 0, im = 0;
    for (let k = 0; k < coefRe.length; k++) {
      const nr = r * z.re - im * z.im + coefRe[k];
      const ni = r * z.im + im * z.re + coefIm[k];
      r = nr; im = ni;
    }
    return { re: r, im: im };
  }

  /* ============================================================
     §2 信号生成
     ============================================================ */

  /** 生成时间序列 t = n/fs */
  function timeAxis(n, fs) {
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) t[i] = i / fs;
    return t;
  }

  /** 多正弦叠加：comps=[{freq, amp, phase}] */
  function multisin(n, fs, comps) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      let s = 0;
      for (const c of comps) s += (c.amp === undefined ? 1 : c.amp) * Math.sin(2 * PI * c.freq * t + (c.phase || 0));
      out[i] = s;
    }
    return out;
  }

  /** 线性调频 LFM（chirp）：瞬时频率 f0 → f1，时长 T */
  function chirp(n, fs, f0, f1, T, phi0) {
    const out = new Float64Array(n);
    const dur = T === undefined ? n / fs : T;
    const k = (f1 - f0) / dur;              // 调频斜率 Hz/s
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      if (t > dur) { out[i] = 0; continue; }
      out[i] = Math.sin(2 * PI * (f0 * t + 0.5 * k * t * t) + (phi0 || 0));
    }
    return out;
  }

  /** 复 LFM（解析信号形式，便于匹配滤波演示） */
  function chirpC(n, fs, f0, f1, T) {
    const out = cplx(n);
    const dur = T === undefined ? n / fs : T;
    const k = (f1 - f0) / dur;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      if (t > dur) continue;
      const ph = 2 * PI * (f0 * t + 0.5 * k * t * t);
      out.re[i] = Math.cos(ph);
      out.im[i] = Math.sin(ph);
    }
    return out;
  }

  /** 高斯包络正弦脉冲（模拟换能器发射波形） */
  function gaussPulse(n, fs, fc, bw, t0) {
    const out = new Float64Array(n);
    const alpha = PI * bw;                    // 带宽因子
    for (let i = 0; i < n; i++) {
      const t = i / fs - (t0 === undefined ? n / fs / 2 : t0);
      out[i] = Math.exp(-alpha * alpha * t * t) * Math.sin(2 * PI * fc * t);
    }
    return out;
  }

  /** 矩形脉冲（脉宽 tau 秒，中心 t0） */
  function rectPulse(n, fs, tau, t0) {
    const out = new Float64Array(n);
    const c = t0 === undefined ? n / fs / 2 : t0;
    const half = tau / 2;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      out[i] = (t >= c - half && t <= c + half) ? 1 : 0;
    }
    return out;
  }

  /** 单位脉冲序列 δ[n-n0] */
  function impulse(n, n0) {
    const out = new Float64Array(n);
    out[n0 || 0] = 1;
    return out;
  }

  /** 阶跃 u[n-n0] */
  function step(n, n0) {
    const out = new Float64Array(n);
    for (let i = (n0 || 0); i < n; i++) out[i] = 1;
    return out;
  }

  /** 方波（占空比 0.5） */
  function square(n, fs, f) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.sin(2 * PI * f * i / fs) >= 0 ? 1 : -1;
    return out;
  }

  /** 锯齿波（用于演示谐波与混叠） */
  function saw(n, fs, f) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const ph = (f * i / fs) % 1;
      out[i] = 2 * ph - 1;
    }
    return out;
  }

  /** 调幅 AM：载波 fc，调制 fm，调制度 m */
  function am(n, fs, fc, fm, m) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      out[i] = (1 + (m === undefined ? 0.5 : m) * Math.cos(2 * PI * fm * t)) * Math.sin(2 * PI * fc * t);
    }
    return out;
  }

  /** 加性高斯白噪声 */
  function awgn(n, sigma, seed) {
    return randnScale(n, sigma === undefined ? 1 : sigma, seed);
  }

  function randnScale(n, sigma, seed) {
    const g = U.randn(n, seed);
    for (let i = 0; i < n; i++) g[i] *= sigma;
    return g;
  }

  /** 按指定 SNR(dB) 给信号加噪（信号功率按均方计算） */
  function addNoise(sig, snrDb, seed) {
    const n = sig.length;
    let ps = 0;
    for (let i = 0; i < n; i++) ps += sig[i] * sig[i];
    ps /= n;
    const pn = ps / Math.pow(10, snrDb / 10);
    const g = U.randn(n, seed);
    const out = new Float64Array(n);
    const s = Math.sqrt(pn);
    for (let i = 0; i < n; i++) out[i] = sig[i] + s * g[i];
    return out;
  }

  /** 实测 SNR（用于交互面板回显） */
  function measSNR(noisy, clean) {
    let ps = 0, pn = 0;
    for (let i = 0; i < clean.length; i++) {
      ps += clean[i] * clean[i];
      const d = noisy[i] - clean[i];
      pn += d * d;
    }
    return 10 * Math.log10(ps / Math.max(pn, 1e-20));
  }

  /** 单频 + 谐波 + 宽带噪声：被动声呐谱检测常用合成信号 */
  function tonalPlusNoise(n, fs, tones, snrDb, seed) {
    const clean = multisin(n, fs, tones);
    return { sig: addNoise(clean, snrDb, seed), clean: clean };
  }

  /* ============================================================
     §3 采样与重采样
     ============================================================ */

  /** 以 fs 采样"连续信号函数" f(t)，共 n 点 */
  function sampleFn(fn, n, fs) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = fn(i / fs);
    return out;
  }

  /** 整数倍抽取（不做抗混叠滤波，供教学对比用） */
  function decimate(x, M) {
    const n = Math.floor(x.length / M), out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = x[i * M];
    return out;
  }

  /** 整数倍内插（零插 + 可选增益） */
  function upsample(x, L) {
    const out = new Float64Array(x.length * L);
    for (let i = 0; i < x.length; i++) out[i * L] = x[i];
    return out;
  }

  /** 线性内插重采样到新长度 */
  function resampleLinear(x, newLen) {
    const n = x.length, out = new Float64Array(newLen);
    const ratio = (n - 1) / Math.max(1, newLen - 1);
    for (let i = 0; i < newLen; i++) {
      const p = i * ratio, i0 = Math.floor(p), fr = p - i0;
      const a = x[Math.min(i0, n - 1)], b = x[Math.min(i0 + 1, n - 1)];
      out[i] = a + (b - a) * fr;
    }
    return out;
  }

  /** 混叠频率计算：给定真实频率 f 与采样率 fs，返回观测到的频率 */
  function aliasFreq(f, fs) {
    const nyq = fs / 2;
    let fa = ((f % fs) + fs) % fs;          // 折到 [0, fs)
    if (fa > nyq) fa = fs - fa;             // 折叠到 [0, nyq]
    return fa;
  }

  /* ============================================================
     §4 FFT / IFFT
     ============================================================ */

  const isPow2 = n => (n & (n - 1)) === 0 && n > 0;
  const nextPow2 = n => { let p = 1; while (p < n) p <<= 1; return p; };

  /**
   * 基 2 时间抽取 FFT（迭代 + 位反转），原地运算
   * @param {Float64Array} re 实部（原地修改）
   * @param {Float64Array} im 虚部（原地修改）
   * @param {boolean} inverse true 做 IFFT（含 1/N 归一化）
   */
  function fftInPlace(re, im, inverse) {
    const n = re.length;
    if (!isPow2(n)) throw new Error('FFT 长度必须为 2 的幂，当前 N=' + n);

    // 位反转置换
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }

    // 逐级蝶形
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inverse ? 2 * PI : -2 * PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + half] * cr - im[i + k + half] * ci;
          const vi = re[i + k + half] * ci + im[i + k + half] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }

    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  /** 正变换：实输入 → 复数频谱 */
  function fft(x, n) {
    const N = n ? nextPow2(n) : nextPow2(x.length);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < x.length && i < N; i++) re[i] = x[i];
    fftInPlace(re, im, false);
    return { re: re, im: im, N: N };
  }

  /** 复数输入正变换（原地拷贝） */
  function fftC(A, n) {
    const N = n ? nextPow2(n) : nextPow2(A.re.length);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < A.re.length && i < N; i++) { re[i] = A.re[i]; im[i] = A.im[i]; }
    fftInPlace(re, im, false);
    return { re: re, im: im, N: N };
  }

  /** 逆变换：复数频谱 → 时域（取实部时用 .re） */
  function ifft(S) {
    const re = Float64Array.from(S.re), im = Float64Array.from(S.im);
    fftInPlace(re, im, true);
    return { re: re, im: im, N: re.length };
  }

  /** 幅度谱（线性） */
  const mag = S => cabs(S);

  /** 幅度谱（dB，归一化到最大值 0 dB） */
  function magDb(S, ref) {
    const m = cabs(S);
    let mx = ref === undefined ? 0 : ref;
    if (ref === undefined) for (let i = 0; i < m.length; i++) if (m[i] > mx) mx = m[i];
    const out = new Float64Array(m.length);
    for (let i = 0; i < m.length; i++) out[i] = 20 * Math.log10(Math.max(m[i], 1e-12) / Math.max(mx, 1e-12));
    return out;
  }

  /** 相位谱（rad，已去卷绕） */
  const phase = S => unwrap(carg(S));

  /** 单边幅度谱（乘以 2/N，直流与 Nyquist 不乘 2） */
  function singleSided(S) {
    const N = S.re.length, half = Math.floor(N / 2) + 1;
    const out = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      let a = Math.hypot(S.re[i], S.im[i]) * 2 / N;
      if (i === 0 || (N % 2 === 0 && i === N / 2)) a /= 2;
      out[i] = a;
    }
    return out;
  }

  /** 频率轴（双边，Hz）：k*fs/N 折到 [-fs/2, fs/2) */
  function fftFreq(N, fs) {
    const out = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let f = k * fs / N;
      if (f >= fs / 2) f -= fs;
      out[k] = f;
    }
    return out;
  }

  /** 频率轴（单边，Hz） */
  function fftFreqHalf(N, fs) {
    const half = Math.floor(N / 2) + 1, out = new Float64Array(half);
    for (let i = 0; i < half; i++) out[i] = i * fs / N;
    return out;
  }

  /** fftshift：把 [0, fs/2) 与 [-fs/2, 0) 互换（偶长度下 ifftshift 与之等价） */
  function fftshift(arr) {
    const n = arr.length, half = n >> 1, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = arr[(i + half) % n];
    return out;
  }

  /* ============================================================
     §5 窗函数
     ============================================================ */

  /** 零阶修正贝塞尔函数 I0（Kaiser 窗用） */
  function besselI0(x) {
    let s = 1, t = 1, k = 0;
    const xh = x / 2;
    while (k < 40) {
      k++;
      t *= (xh * xh) / (k * k);
      s += t;
      if (t < 1e-14 * s) break;
    }
    return s;
  }

  const WINDOWS = {
    rect: {
      name: '矩形窗', en: 'Rectangular',
      fn: (n, N) => 1
    },
    bartlett: {
      name: '三角窗', en: 'Bartlett',
      fn: (n, N) => 1 - Math.abs((n - (N - 1) / 2) / ((N - 1) / 2))
    },
    hann: {
      name: '汉宁窗', en: 'Hann',
      fn: (n, N) => 0.5 - 0.5 * Math.cos(2 * PI * n / (N - 1))
    },
    hamming: {
      name: '汉明窗', en: 'Hamming',
      fn: (n, N) => 0.54 - 0.46 * Math.cos(2 * PI * n / (N - 1))
    },
    blackman: {
      name: '布莱克曼窗', en: 'Blackman',
      fn: (n, N) => 0.42 - 0.5 * Math.cos(2 * PI * n / (N - 1)) + 0.08 * Math.cos(4 * PI * n / (N - 1))
    },
    blackmanharris: {
      name: '布莱克曼-哈里斯窗', en: 'Blackman-Harris',
      fn: (n, N) => 0.35875 - 0.48829 * Math.cos(2 * PI * n / (N - 1))
        + 0.14128 * Math.cos(4 * PI * n / (N - 1)) - 0.01168 * Math.cos(6 * PI * n / (N - 1))
    },
    flattop: {
      name: '平顶窗', en: 'Flat Top',
      fn: (n, N) => {
        const a = 2 * PI * n / (N - 1);
        return 1 - 1.93 * Math.cos(a) + 1.29 * Math.cos(2 * a) - 0.388 * Math.cos(3 * a) + 0.032 * Math.cos(4 * a);
      }
    },
    kaiser: {
      name: '凯泽窗', en: 'Kaiser', hasBeta: true,
      fn: (n, N, beta) => {
        const b = beta === undefined ? 8.6 : beta;
        const d = (n - (N - 1) / 2) / ((N - 1) / 2);
        return besselI0(b * Math.sqrt(Math.max(0, 1 - d * d))) / besselI0(b);
      }
    }
  };

  /** 生成窗序列（对称窗，N 点；N=1 时返回 [1]） */
  function window(type, N, beta) {
    const w = new Float64Array(N);
    const def = WINDOWS[type] || WINDOWS.rect;
    if (N === 1) { w[0] = 1; return w; }
    for (let n = 0; n < N; n++) w[n] = def.fn(n, N, beta);
    return w;
  }

  /**
   * 窗性能指标（实测法，N 取 4096 保证精度）
   * 返回：主瓣宽度（bin，两侧零点间）、最高旁瓣电平 dB、旁瓣衰减速率 dB/dec、
   *       ENBW（等效噪声带宽，bin）、相干增益、扇贝损失 dB
   */
  function windowMetrics(type, beta) {
    const N = 4096, NF = 1 << 16;
    const w = window(type, N, beta);
    const S = fft(w, NF);
    const m = cabs(S);
    let mx = 0, mi = 0;
    for (let i = 0; i < m.length; i++) if (m[i] > mx) { mx = m[i]; mi = i; }
    const db = new Float64Array(m.length);
    for (let i = 0; i < m.length; i++) db[i] = 20 * Math.log10(Math.max(m[i], 1e-20) / mx);

    // 主瓣宽度：由峰值向右找第一个「谱谷」（局部极小，即主瓣零点），半宽 ×2
    // 注意：不能用固定 -60 dB 交点 —— 对旁瓣极低的窗（如布莱克曼-哈里斯）
    // 主瓣坡在 −60 dB 处尚未到达零点，会把主瓣边缘误判为旁瓣区。
    let r = mi + 1;
    while (r < db.length / 2 - 1 && !(db[r] < db[r - 1] && db[r] <= db[r + 1] && db[r] < -25)) r++;
    const zeroOversample = NF / N;                 // 每个 bin 的补零倍数
    const mainLobe = 2 * (r - mi) / zeroOversample; // 主瓣全宽（bin）

    // 最高旁瓣：从主瓣谷点之后开始搜索
    let sll = -200;
    for (let i = r + 2; i < db.length / 2; i++) if (db[i] > sll) sll = db[i];

    // ENBW = N * Σw² / (Σw)²   （单位：bin）
    let sw = 0, sw2 = 0;
    for (let i = 0; i < N; i++) { sw += w[i]; sw2 += w[i] * w[i]; }
    const enbw = N * sw2 / (sw * sw);
    const cg = sw / N;                       // 相干增益
    const scallop = 20 * Math.log10(cg / (0.5 * (Math.abs(w[Math.floor(N / 2)]) + Math.abs(w[Math.floor(N / 2) - 1])) || 1e-9));

    return {
      mainLobe: mainLobe,      // 主瓣宽度（FFT bin 数）
      sll: sll,                // 最高旁瓣电平 dB
      enbw: enbw,              // 等效噪声带宽 bin
      cg: cg,                  // 相干增益
      scallop: Math.max(0, Math.min(4, scallop))
    };
  }

  /* ============================================================
     §6 卷积与相关
     ============================================================ */

  /** 线性卷积（full），返回长度 x.length + h.length - 1 */
  function conv(x, h) {
    const N = x.length, M = h.length;
    const out = new Float64Array(N + M - 1);
    for (let i = 0; i < N; i++) {
      const xi = x[i];
      if (xi === 0) continue;
      for (let j = 0; j < M; j++) out[i + j] += xi * h[j];
    }
    return out;
  }

  /** 线性卷积的"same"中心段（长度 = x.length） */
  function convSame(x, h) {
    const full = conv(x, h);
    const M = h.length, start = Math.floor((M - 1) / 2);
    return full.slice(start, start + x.length);
  }

  /** N 点循环卷积：长度不足补零，超过 N 时按混叠折叠 */
  function cconv(x, h, N) {
    const out = new Float64Array(N);
    for (let i = 0; i < x.length; i++) {
      for (let j = 0; j < h.length; j++) {
        out[(i + j) % N] += x[i] * h[j];
      }
    }
    return out;
  }

  /**
   * 互相关 r_xy[k] = Σ x[n+k]·conj(y[n])，k = -(M-1)…(N-1)
   * 返回 {r: Float64Array, lags: Int32Array}
   */
  function xcorr(x, y) {
    const N = x.length, M = y.length;
    const L = N + M - 1;
    const r = new Float64Array(L);
    const lags = new Int32Array(L);
    for (let k = 0; k < L; k++) lags[k] = k - (M - 1);
    for (let k = 0; k < L; k++) {
      let s = 0;
      for (let n = 0; n < M; n++) {
        const idx = n + lags[k];
        if (idx >= 0 && idx < N) s += x[idx] * y[n];
      }
      r[k] = s;
    }
    return { r: r, lags: lags };
  }

  /** 自相关（归一化到 r[0]=1 的可选项） */
  function autocorr(x, norm) {
    const c = xcorr(x, x);
    if (norm && c.r[c.r.length >> 1] !== 0) {
      const p = c.r[c.r.length >> 1];
      for (let i = 0; i < c.r.length; i++) c.r[i] /= p;
    }
    return c;
  }

  /** 用 FFT 加速的互相关（长序列用） */
  function xcorrFFT(x, y) {
    const L = nextPow2(x.length + y.length - 1);
    const A = new Float64Array(L), B = new Float64Array(L);
    A.set(x, 0); B.set(y, 0);
    const FA = fft(A), FB = fft(B);
    const out = cplx(L);
    for (let i = 0; i < L; i++) {
      // conj(FB) * FA
      const ar = FA.re[i], ai = FA.im[i], br = FB.re[i], bi = -FB.im[i];
      out.re[i] = ar * br - ai * bi;
      out.im[i] = ar * bi + ai * br;
    }
    const t = ifft(out);
    // 重排为标准 lag 顺序：-(M-1)…(N-1)
    const M = y.length, N = x.length, Ln = N + M - 1;
    const r = new Float64Array(Ln), lags = new Int32Array(Ln);
    for (let k = 0; k < Ln; k++) {
      lags[k] = k - (M - 1);
      let idx = lags[k];
      if (idx < 0) idx += L;
      r[k] = t.re[idx];
    }
    return { r: r, lags: lags };
  }

  /* ============================================================
     §7 滤波与频率响应
     ============================================================ */

  /**
   * 直接 I 型 IIR/FIR 滤波
   * y[n] = (Σ b_k x[n-k] − Σ_{k≥1} a_k y[n-k]) / a_0
   */
  function filter(b, a, x) {
    const N = x.length, M = b.length, K = a.length;
    const y = new Float64Array(N);
    const a0 = a[0] || 1;
    for (let n = 0; n < N; n++) {
      let s = 0;
      for (let k = 0; k < M; k++) {
        const idx = n - k;
        if (idx >= 0) s += b[k] * x[idx];
      }
      for (let k = 1; k < K; k++) {
        const idx = n - k;
        if (idx >= 0) s -= a[k] * y[idx];
      }
      y[n] = s / a0;
    }
    return y;
  }

  /** 零相位滤波（前后各滤波一次，消除相位延迟，教学对比用） */
  function filtfilt(b, a, x) {
    const fwd = filter(b, a, x);
    const rev = Float64Array.from(fwd).reverse();
    const back = filter(b, a, rev);
    return Float64Array.from(back).reverse();
  }

  /**
   * 频率响应 H(e^{jω})
   * @param {Array|Float64Array} b 分子
   * @param {Array|Float64Array} a 分母
   * @param {number} nfft 频点数
   * @returns {{w, h:{re,im}, mag, magDb, phase, f}}
   */
  function freqz(b, a, nfft, fs) {
    nfft = nfft || 512;
    a = a || [1];
    const hR = new Float64Array(nfft), hI = new Float64Array(nfft);
    const w = new Float64Array(nfft);
    for (let i = 0; i < nfft; i++) {
      const om = i * 2 * PI / nfft;      // 0 … 2π（不含 2π）
      w[i] = om;
      let nr = 0, ni = 0, dr = 0, di = 0;
      for (let k = 0; k < b.length; k++) {
        nr += b[k] * Math.cos(-om * k);
        ni += b[k] * Math.sin(-om * k);
      }
      for (let k = 0; k < a.length; k++) {
        dr += a[k] * Math.cos(-om * k);
        di += a[k] * Math.sin(-om * k);
      }
      const d = dr * dr + di * di || 1e-30;
      hR[i] = (nr * dr + ni * di) / d;
      hI[i] = (ni * dr - nr * di) / d;
    }
    const S = { re: hR, im: hI };
    const magA = cabs(S);
    const magDbA = new Float64Array(nfft);
    let mx = 0;
    for (let i = 0; i < nfft; i++) if (magA[i] > mx) mx = magA[i];
    for (let i = 0; i < nfft; i++) magDbA[i] = 20 * Math.log10(Math.max(magA[i], 1e-12) / Math.max(mx, 1e-12));
    const f = new Float64Array(nfft);
    for (let i = 0; i < nfft; i++) f[i] = (fs ? fs : 1) * i / nfft;
    return { w: w, h: S, mag: magA, magDb: magDbA, phase: unwrap(carg(S)), f: f };
  }

  /* ============================================================
     §8 FIR 设计（窗函数法）
     ============================================================ */

  /**
   * 理想低通单位脉冲响应（II 型/IV 型需注意相位）
   * h_d[n] = sin(ωc·(n−α)) / (π·(n−α))，n≠α；h_d[α] = ωc/π
   * @param {number} order 阶数（抽头数减 1）
   */
  function idealLp(order, fcNorm) {
    const N = order + 1, alpha = (N - 1) / 2;
    const h = new Float64Array(N);
    const wc = 2 * PI * fcNorm;            // fcNorm 为对 fs 归一化的截止频率（0…0.5）
    for (let n = 0; n < N; n++) {
      const d = n - alpha;
      h[n] = Math.abs(d) < 1e-12 ? wc / PI : Math.sin(wc * d) / (PI * d);
    }
    return h;
  }

  /**
   * 窗函数法设计 FIR
   * @param {object} o {order, type:'low'|'high'|'band'|'stop', fc, fc2, win:'hamming', beta}
   *                   fc/fc2 为归一化频率（相对 fs，0…0.5）
   * @returns Float64Array 抽头系数
   */
  function firWin(o) {
    const order = o.order, N = order + 1, alpha = (N - 1) / 2;
    const type = o.type || 'low';
    const w = window(o.win || 'hamming', N, o.beta);
    const h = new Float64Array(N);

    const lp = fc => {
      const wc = 2 * PI * fc, out = new Float64Array(N);
      for (let n = 0; n < N; n++) {
        const d = n - alpha;
        out[n] = Math.abs(d) < 1e-12 ? wc / PI : Math.sin(wc * d) / (PI * d);
      }
      return out;
    };

    let hd;
    if (type === 'low') {
      hd = lp(o.fc);
    } else if (type === 'high') {
      // 高通 = δ[n−α] − 低通
      const lpv = lp(o.fc);
      hd = new Float64Array(N);
      for (let n = 0; n < N; n++) hd[n] = (Math.abs(n - alpha) < 1e-12 ? 1 : 0) - lpv[n];
    } else if (type === 'band') {
      const lo = Math.min(o.fc, o.fc2), hi = Math.max(o.fc, o.fc2);
      const l1 = lp(hi), l2 = lp(lo);
      hd = new Float64Array(N);
      for (let n = 0; n < N; n++) hd[n] = l1[n] - l2[n];
    } else { // stop
      const lo = Math.min(o.fc, o.fc2), hi = Math.max(o.fc, o.fc2);
      const l1 = lp(hi), l2 = lp(lo);
      hd = new Float64Array(N);
      for (let n = 0; n < N; n++) hd[n] = (Math.abs(n - alpha) < 1e-12 ? 1 : 0) - (l1[n] - l2[n]);
    }

    for (let n = 0; n < N; n++) h[n] = hd[n] * w[n];
    return h;
  }

  /** 群延迟（线性相位 FIR 应为常数 order/2） */
  const firGroupDelay = order => order / 2;

  /* ============================================================
     §9 经典谱估计
     ============================================================ */

  /** 周期图：|FFT(x·w)|² / (fs·Σw²) */
  function periodogram(x, w, nfft, fs) {
    const N = x.length;
    const win = w || window('rect', N);
    const NF = nfft || nextPow2(N);
    const xw = new Float64Array(N);
    let sw2 = 0;
    for (let i = 0; i < N; i++) { xw[i] = x[i] * win[i]; sw2 += win[i] * win[i]; }
    const S = fft(xw, NF);
    const half = Math.floor(NF / 2) + 1;
    const psd = new Float64Array(half);
    const norm = (fs || 1) * sw2;
    for (let i = 0; i < half; i++) {
      const p = (S.re[i] * S.re[i] + S.im[i] * S.im[i]) / Math.max(norm, 1e-30);
      psd[i] = i === 0 || i === half - 1 ? p : 2 * p;
    }
    return { psd: psd, f: fftFreqHalf(NF, fs || 1) };
  }

  /**
   * Welch 平均周期图
   * @param {object} o {segLen, overlap(0…1), win, nfft, fs}
   */
  function pwelch(x, o) {
    o = o || {};
    const N = x.length;
    const segLen = o.segLen || Math.min(256, N >> 1) || 32;
    const overlap = o.overlap === undefined ? 0.5 : o.overlap;
    const hop = Math.max(1, Math.round(segLen * (1 - overlap)));
    const win = window(o.win || 'hann', segLen);
    const NF = o.nfft || nextPow2(segLen);
    const half = Math.floor(NF / 2) + 1;
    const acc = new Float64Array(half);
    let K = 0, sw2 = 0;
    for (let i = 0; i < segLen; i++) sw2 += win[i] * win[i];

    for (let s = 0; s + segLen <= N; s += hop) {
      const seg = new Float64Array(segLen);
      for (let i = 0; i < segLen; i++) seg[i] = x[s + i] * win[i];
      const S = fft(seg, NF);
      for (let i = 0; i < half; i++) {
        const p = (S.re[i] * S.re[i] + S.im[i] * S.im[i]) / ((o.fs || 1) * sw2);
        acc[i] += (i === 0 || i === half - 1) ? p : 2 * p;
      }
      K++;
    }
    if (K === 0) K = 1;
    for (let i = 0; i < half; i++) acc[i] /= K;
    return { psd: acc, f: fftFreqHalf(NF, o.fs || 1), K: K };
  }

  /** Bartlett 平均周期图（不重叠、矩形窗分段） */
  function psdBartlett(x, K, fs) {
    const N = x.length;
    K = K || 4;
    const segLen = Math.floor(N / K);
    const acc = new Float64Array(Math.floor(nextPow2(segLen) / 2) + 1);
    let cnt = 0;
    for (let k = 0; k < K; k++) {
      const seg = x.slice(k * segLen, (k + 1) * segLen);
      const P = periodogram(seg, null, nextPow2(segLen), fs);
      for (let i = 0; i < acc.length; i++) acc[i] += P.psd[i];
      cnt++;
    }
    for (let i = 0; i < acc.length; i++) acc[i] /= cnt;
    return { psd: acc, f: fftFreqHalf(nextPow2(segLen), fs || 1), K: cnt };
  }

  /** PSD 转 dB（1e-20 保护） */
  function psdDb(psd, refDb) {
    const out = new Float64Array(psd.length);
    for (let i = 0; i < psd.length; i++) out[i] = 10 * Math.log10(Math.max(psd[i], 1e-20));
    return out;
  }

  /* ============================================================
     §10 时频分析（STFT）
     ============================================================ */

  /**
   * 短时傅里叶变换
   * @param {object} o {winLen, hop, win:'hann', nfft, fs}
   * @returns {{S: Float32Array 二维展平 [frames×bins], frames, bins, t, f, winLen, hop}}
   */
  function stft(x, o) {
    o = o || {};
    const N = x.length;
    const winLen = o.winLen || 128;
    const hop = o.hop || Math.max(1, winLen >> 2);
    const NF = o.nfft || nextPow2(winLen);
    const win = window(o.win || 'hann', winLen);
    const frames = Math.max(1, Math.floor((N - winLen) / hop) + 1);
    const bins = Math.floor(NF / 2) + 1;
    const S = new Float32Array(frames * bins);
    const t = new Float64Array(frames);
    const f = fftFreqHalf(NF, o.fs || 1);

    const seg = new Float64Array(winLen);
    for (let m = 0; m < frames; m++) {
      const s = m * hop;
      let e = 0;
      for (let i = 0; i < winLen; i++) { seg[i] = x[s + i] * win[i]; e += win[i] * win[i]; }
      const F = fft(seg, NF);
      for (let k = 0; k < bins; k++) {
        const p = (F.re[k] * F.re[k] + F.im[k] * F.im[k]) / Math.max(e, 1e-30);
        S[m * bins + k] = 10 * Math.log10(p + 1e-20);
      }
      t[m] = (s + winLen / 2) / (o.fs || 1);
    }
    return { S: S, frames: frames, bins: bins, t: t, f: f, winLen: winLen, hop: hop, nfft: NF };
  }

  /** 解析信号（希尔伯特变换）：支持任意长度（内部补零到 2 的幂后截断） */
  function hilbert(x) {
    const N = x.length;
    const L = nextPow2(N);
    const re = new Float64Array(L), im = new Float64Array(L);
    for (let i = 0; i < N; i++) re[i] = x[i];
    fftInPlace(re, im, false);
    for (let i = 0; i < L; i++) {
      // 正频加倍，负频置零，直流与 Nyquist 保持不变
      const factor = i < L / 2 ? 2 : (i > L / 2 ? 0 : 1);
      re[i] *= factor; im[i] *= factor;
    }
    fftInPlace(re, im, true);
    const out = cplx(N);
    for (let i = 0; i < N; i++) { out.re[i] = re[i]; out.im[i] = im[i]; }
    return out;
  }

  /** 包络 = |解析信号| */
  function envelope(x) { return cabs(hilbert(x)); }

  /** 瞬时频率（解析信号相位差分） */
  function instFreq(x, fs) {
    const a = hilbert(x);
    const ph = carg(a);
    const out = new Float64Array(x.length);
    for (let i = 1; i < x.length; i++) {
      let d = ph[i] - ph[i - 1];
      while (d > PI) d -= 2 * PI;
      while (d < -PI) d += 2 * PI;
      out[i] = d * (fs || 1) / (2 * PI);
    }
    out[0] = out[1] || 0;
    return out;
  }

  /* ============================================================
     §11 匹配滤波 / 脉冲压缩
     ============================================================ */

  /**
   * 匹配滤波（实数版）：y[n] = Σ_k x[n+k]·h[k]  —— 等价于与 h 翻转共轭做卷积
   * 输出长度 = x.length + h.length − 1，峰值位置对应回波时延
   */
  function matchedFilter(x, h) {
    const N = x.length, M = h.length;
    const out = new Float64Array(N + M - 1);
    for (let n = 0; n < out.length; n++) {
      let s = 0;
      for (let k = 0; k < M; k++) {
        const idx = n + k;
        if (idx >= 0 && idx < N) s += x[idx] * h[k];
      }
      out[n] = s;
    }
    return out;
  }

  /** 复匹配滤波（用于 LFM 复解析信号，抑制镜像） */
  function matchedFilterC(x, h) {
    const N = x.re.length, M = h.re.length;
    const L = N + M - 1;
    const out = cplx(L);
    for (let n = 0; n < L; n++) {
      let sr = 0, si = 0;
      for (let k = 0; k < M; k++) {
        const idx = n + k;
        if (idx >= 0 && idx < N) {
          sr += x.re[idx] * h.re[k] + x.im[idx] * h.im[k];
          si += x.im[idx] * h.re[k] - x.re[idx] * h.im[k];
        }
      }
      out.re[n] = sr; out.im[n] = si;
    }
    return out;
  }

  /**
   * 脉冲压缩质量指标
   * @returns {{peakIdx, peakVal, psl, islr, width3dB, widthNull, gainDb}}
   *   psl: 峰值旁瓣电平 dB（相对主峰，负值）
   *   width3dB: −3 dB 主瓣宽度（样点数）
   *   widthNull: 零点到零点宽度（样点数，近似）
   */
  function pulseMetrics(y, opts) {
    opts = opts || {};
    const n = y.length;
    // 幅度序列：复信号取模；实信号默认取解析包络（消除载波对主瓣/旁瓣测量的影响）
    let absy;
    if (y.re) {
      absy = cabs(y);
    } else if (opts.raw) {
      absy = new Float64Array(n);
      for (let i = 0; i < n; i++) absy[i] = Math.abs(y[i]);
    } else {
      absy = envelope(y);
    }

    let peakIdx = 0, peak = 0;
    for (let i = 0; i < n; i++) if (absy[i] > peak) { peak = absy[i]; peakIdx = i; }
    if (peak === 0) return { peakIdx: 0, peakVal: 0, psl: -999, islr: -999, width3dB: 0, widthNull: 0, db: new Float64Array(n) };

    const db = new Float64Array(n);
    for (let i = 0; i < n; i++) db[i] = 20 * Math.log10(Math.max(absy[i], 1e-12) / peak);

    // −3 dB 宽度（线性插值提高分辨率）
    const cross = (dir) => {
      let i = peakIdx;
      while (i > 0 && i < n - 1 && db[i] > -3) i += dir;
      // 在 [i-dir, i] 之间线性插值出 -3 dB 位置
      const a = db[Math.max(0, Math.min(n - 1, i - dir))], b = db[i];
      const frac = (a === b) ? 0 : (-3 - a) / (b - a);
      return (i - dir) + dir * frac;
    };
    const left = cross(-1), right = cross(1);
    const width3dB = right - left;

    // 零点到零点宽度：峰值两侧第一个局部极小
    let l0 = peakIdx;
    while (l0 > 1 && absy[l0 - 1] < absy[l0]) l0--;
    let r0 = peakIdx;
    while (r0 < n - 2 && absy[r0 + 1] < absy[r0]) r0++;
    const widthNull = r0 - l0;

    // 主瓣区（以 −3 dB 宽度外扩 2 倍计）
    const guard = Math.max(2, Math.round(width3dB * 1.5));
    let sll = -200, isl = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(i - peakIdx) <= guard) continue;
      if (db[i] > sll) sll = db[i];
      isl += absy[i] * absy[i];
      cnt++;
    }
    // 主瓣能量
    let ml = 0;
    for (let i = Math.max(0, peakIdx - guard); i <= Math.min(n - 1, peakIdx + guard); i++) ml += absy[i] * absy[i];
    const islr = 10 * Math.log10(Math.max(isl, 1e-30) / Math.max(ml, 1e-30));

    return {
      peakIdx: peakIdx, peakVal: peak, psl: sll, islr: islr,
      width3dB: width3dB, widthNull: widthNull, db: db
    };
  }

  /** 处理增益：脉冲压缩信噪比改善 = 10log10(B·T)（时宽带宽积） */
  const pulseGainDb = (B, T) => 10 * Math.log10(Math.max(1e-9, B * T));

  /** 距离分辨率 ΔR = c / (2B) */
  const rangeRes = (c, B) => c / (2 * B);

  /** 多普勒频移 fd = 2v/λ = 2 v fc / c */
  const doppler = (v, fc, c) => 2 * v * fc / c;

  /* ============================================================
     §12 Z 变换与零极点工具
     ============================================================ */

  /**
   * 由零极点求单位脉冲响应（前 N 点）
   * 系统函数 H(z) = gain · Π(1 − z_i z⁻¹) / Π(1 − p_i z⁻¹)
   * 等价差分方程：a₀h[n] = Σ b_k δ[n−k] − Σ_{k≥1} a_k h[n−k]
   */
  function zpH2Impulse(zeros, poles, gain, N) {
    const B = polyFromRoots(zeros);   // 1 − z_i z⁻¹ 的根为 z_i
    const A = polyFromRoots(poles);
    const M = B.re.length, K = A.re.length;
    const a0r = A.re[0], a0i = A.im[0];
    const hR = new Float64Array(N), hI = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      let nr = 0, ni = 0;
      if (n < M) { nr = gain * B.re[n]; ni = gain * B.im[n]; }
      for (let k = 1; k < K; k++) {
        if (n - k >= 0) {
          nr -= A.re[k] * hR[n - k] - A.im[k] * hI[n - k];
          ni -= A.re[k] * hI[n - k] + A.im[k] * hR[n - k];
        }
      }
      const d = a0r * a0r + a0i * a0i || 1e-30;
      hR[n] = (nr * a0r + ni * a0i) / d;
      hI[n] = (ni * a0r - nr * a0i) / d;
    }
    return { re: hR, im: hI };
  }

  /** 由零极点求频率响应 H(e^{jω})，ω∈[0, 2π) */
  function zpH2Freq(zeros, poles, gain, nfft) {
    nfft = nfft || 512;
    const B = polyFromRoots(zeros), A = polyFromRoots(poles);
    const hR = new Float64Array(nfft), hI = new Float64Array(nfft);
    for (let i = 0; i < nfft; i++) {
      const w = i * 2 * PI / nfft;
      const z = { re: Math.cos(-w), im: Math.sin(-w) };     // z⁻¹ = e^{−jω}
      const nb = polyvalC(B.re, B.im, z);
      const na = polyvalC(A.re, A.im, z);
      const d = na.re * na.re + na.im * na.im || 1e-30;
      hR[i] = gain * (nb.re * na.re + nb.im * na.im) / d;
      hI[i] = gain * (nb.im * na.re - nb.re * na.im) / d;
    }
    return { re: hR, im: hI };
  }

  /** 系统稳定性判定：全部极点在单位圆内 */
  function isStable(poles) {
    for (const p of poles) if (Math.hypot(p.re, p.im) >= 1) return false;
    return true;
  }

  /** 双线性变换：模拟传递函数 H_a(s) 的零极点映射到 z 平面（z = (1+sT/2)/(1−sT/2)） */
  function bilinearZeros(s, T) {
    // z = (1 + sT/2) / (1 − sT/2)
    const k = T / 2;
    const nr = 1 + s.re * k, ni = s.im * k;
    const dr = 1 - s.re * k, di = -s.im * k;
    const d = dr * dr + di * di || 1e-30;
    return { re: (nr * dr + ni * di) / d, im: (ni * dr - nr * di) / d };
  }

  /** 脉冲响应不变法：s 平面极点 p_k → z = e^{p_k T} */
  function impulseInvZeros(s, T) {
    const e = Math.exp(s.re * T);
    return { re: e * Math.cos(s.im * T), im: e * Math.sin(s.im * T) };
  }

  /* ============================================================
     §13 杂项数值工具
     ============================================================ */

  /** 相位去卷绕 */
  function unwrap(p) {
    const out = new Float64Array(p.length);
    if (!p.length) return out;
    out[0] = p[0];
    for (let i = 1; i < p.length; i++) {
      let d = p[i] - p[i - 1];
      while (d > PI) d -= 2 * PI;
      while (d < -PI) d += 2 * PI;
      out[i] = out[i - 1] + d;
    }
    return out;
  }

  /** 取实数数组指定区间 */
  const sliceArr = (x, a, b) => Float64Array.prototype.slice.call(x, a, b);

  /** sinc(x) = sin(πx)/(πx) */
  const sinc = x => Math.abs(x) < 1e-12 ? 1 : Math.sin(PI * x) / (PI * x);

  /** 分贝加法（非相干能量叠加） */
  const dBadd = (a, b) => 10 * Math.log10(Math.pow(10, a / 10) + Math.pow(10, b / 10));

  /** 置信：把数组限制到指定长度（截断或补零） */
  function fitLength(x, N) {
    const out = new Float64Array(N);
    for (let i = 0; i < Math.min(N, x.length); i++) out[i] = x[i];
    return out;
  }

  /* ------------------------- 导出 ------------------------- */
  DSP.core = {
    // 常用数值工具（透传 util，方便内容代码统一从 core 取用）
    arange: U.arange, linspace: U.linspace, zeros: U.zeros, randn: U.randn,
    fmt: U.fmt, eng: U.eng, toDb: U.toDb,
    // §1
    cplx, polar, cmul, cdiv, cabs, carg, polyFromRoots, polyvalC,
    // §2
    timeAxis, multisin, chirp, chirpC, gaussPulse, rectPulse, impulse, step,
    square, saw, am, awgn, addNoise, measSNR, tonalPlusNoise,
    // §3
    sampleFn, decimate, upsample, resampleLinear, aliasFreq,
    // §4
    isPow2, nextPow2, fftInPlace, fft, fftC, ifft, mag, magDb, phase,
    singleSided, fftFreq, fftFreqHalf, fftshift, ifftshift: fftshift,
    // §5
    WINDOWS, window, windowMetrics, besselI0,
    // §6
    conv, convSame, cconv, xcorr, xcorrFFT, autocorr,
    // §7
    filter, filtfilt, freqz,
    // §8
    idealLp, firWin, firGroupDelay,
    // §9
    periodogram, pwelch, psdBartlett, psdDb,
    // §10
    stft, hilbert, envelope, instFreq,
    // §11
    matchedFilter, matchedFilterC, pulseMetrics, pulseGainDb, rangeRes, doppler,
    // §12
    zpH2Impulse, zpH2Freq, isStable, bilinearZeros, impulseInvZeros,
    // §13
    unwrap, sliceArr, sinc, dBadd, fitLength
  };
})(window);

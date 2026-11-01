/* =============================================================
   lab-music.js —— MUSIC 超分辨谱估计实验台（路由 lab/music）

   本文件自带一套小规模复数线性代数（不改动核心库）：
     · 复矩阵乘法 / 共轭转置 / 复矩阵求逆（高斯消元）
     · Hermitian 矩阵的 Jacobi 特征分解（复数旋转，返回全部特征值与特征向量）
     · ESPRIT 用的特征多项式（Faddeev–LeVerrier）+ Durand–Kerner 求根

   算法：导向矢量 a(θ) = [1, e^{-jφ}, …, e^{-j(M-1)φ}]，φ = 2π(d/λ)sinθ
     R = X Xᴴ / L；R = EsΛsEsᴴ + EnΛnEnᴴ
     CBF   P = aᴴ R a
     MVDR  P = 1/(aᴴ R⁻¹ a)
     MUSIC P = 1/(aᴴ En Enᴴ a) = 1/‖Enᴴa‖²
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;

  const SEED = 90210;              // 固定种子，保证结果可复现
  const SCAN_LO = -90, SCAN_HI = 90;

  let noteEl = null;

  /* ============================================================
     小规模复数线性代数（矩阵按行主序存于 Float64Array，尺寸 n×n）
     ============================================================ */
  function cmat(n) { return { re: new Float64Array(n * n), im: new Float64Array(n * n) }; }

  /** A·B（n×n） */
  function mmul(A, B, n) {
    const O = cmat(n);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < n; k++) {
        const ar = A.re[i * n + k], ai = A.im[i * n + k];
        if (ar === 0 && ai === 0) continue;
        for (let j = 0; j < n; j++) {
          const br = B.re[k * n + j], bi = B.im[k * n + j];
          O.re[i * n + j] += ar * br - ai * bi;
          O.im[i * n + j] += ar * bi + ai * br;
        }
      }
    }
    return O;
  }

  /** 复矩阵求逆（高斯-约当消元，带部分选主元） */
  function minv(A, n) {
    const a = { re: Float64Array.from(A.re), im: Float64Array.from(A.im) };
    const I = cmat(n);
    for (let i = 0; i < n; i++) I.re[i * n + i] = 1;
    for (let col = 0; col < n; col++) {
      let piv = col, pv = Math.hypot(a.re[col * n + col], a.im[col * n + col]);
      for (let r = col + 1; r < n; r++) {
        const v = Math.hypot(a.re[r * n + col], a.im[r * n + col]);
        if (v > pv) { pv = v; piv = r; }
      }
      if (pv < 1e-300) return null;
      if (piv !== col) {
        for (let j = 0; j < n; j++) {
          let t = a.re[col * n + j]; a.re[col * n + j] = a.re[piv * n + j]; a.re[piv * n + j] = t;
          t = a.im[col * n + j]; a.im[col * n + j] = a.im[piv * n + j]; a.im[piv * n + j] = t;
          t = I.re[col * n + j]; I.re[col * n + j] = I.re[piv * n + j]; I.re[piv * n + j] = t;
          t = I.im[col * n + j]; I.im[col * n + j] = I.im[piv * n + j]; I.im[piv * n + j] = t;
        }
      }
      // 归一化主元行
      const dr = a.re[col * n + col], di = a.im[col * n + col];
      const dd = dr * dr + di * di;
      for (let j = 0; j < n; j++) {
        const xr = a.re[col * n + j], xi = a.im[col * n + j];
        a.re[col * n + j] = (xr * dr + xi * di) / dd;
        a.im[col * n + j] = (xi * dr - xr * di) / dd;
        const yr = I.re[col * n + j], yi = I.im[col * n + j];
        I.re[col * n + j] = (yr * dr + yi * di) / dd;
        I.im[col * n + j] = (yi * dr - yr * di) / dd;
      }
      // 消元
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const fr = a.re[r * n + col], fi = a.im[r * n + col];
        if (fr === 0 && fi === 0) continue;
        for (let j = 0; j < n; j++) {
          a.re[r * n + j] -= fr * a.re[col * n + j] - fi * a.im[col * n + j];
          a.im[r * n + j] -= fr * a.im[col * n + j] + fi * a.re[col * n + j];
          I.re[r * n + j] -= fr * I.re[col * n + j] - fi * I.im[col * n + j];
          I.im[r * n + j] -= fr * I.im[col * n + j] + fi * I.re[col * n + j];
        }
      }
    }
    return I;
  }

  /**
   * Hermitian 矩阵的 Jacobi 特征分解（复数旋转）
   * @returns {{vals:Float64Array(降序), vecs:{re,im}, order:Int32Array}}
   *          vecs 的第 k 列是 vals[k] 对应的单位特征向量
   */
  function eigHerm(A, n) {
    const a = { re: Float64Array.from(A.re), im: Float64Array.from(A.im) };
    const V = cmat(n);
    for (let i = 0; i < n; i++) V.re[i * n + i] = 1;

    let scale = 0;
    for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(a.re[i * n + i]));
    const tol = Math.max(1e-14, scale * 1e-13);

    for (let sweep = 0; sweep < 40; sweep++) {
      let off = 0;
      for (let p = 0; p < n - 1; p++) {
        for (let q = p + 1; q < n; q++) {
          const br = a.re[p * n + q], bi = a.im[p * n + q];
          const bm = Math.hypot(br, bi);
          if (bm < tol) continue;
          off += bm * bm;
          const ap = a.re[p * n + p], aq = a.re[q * n + q];
          const tau = (aq - ap) / (2 * bm);
          const sg = tau >= 0 ? 1 : -1;
          const t = -sg / (Math.abs(tau) + Math.sqrt(tau * tau + 1));
          const cc = 1 / Math.sqrt(1 + t * t);
          const ss = t * cc;                       // s = (t·c)·conj(b)/|b|
          const sr = ss * br / bm, si = -ss * bi / bm;

          // 特征向量累积：V ← V·J（对所有行，包括 p、q 两行）
          for (let k = 0; k < n; k++) {
            const kp = k * n + p, kq = k * n + q;
            const vpr = V.re[kp], vpi = V.im[kp], vqr = V.re[kq], vqi = V.im[kq];
            V.re[kp] = vpr * cc + (vqr * sr - vqi * si);          // V[k][p]·c + V[k][q]·s
            V.im[kp] = vpi * cc + (vqr * si + vqi * sr);
            V.re[kq] = -(vpr * sr + vpi * si) + vqr * cc;         // −V[k][p]·conj(s) + V[k][q]·c
            V.im[kq] = -(vpi * sr - vpr * si) + vqi * cc;
          }
          // B = JᴴAJ：行号不在 {p,q} 内时 B[k][*] = (AJ)[k][*]，直接作用于第 p/q 两列
          for (let k = 0; k < n; k++) {
            if (k === p || k === q) continue;
            const kp = k * n + p, kq = k * n + q;
            const apr = a.re[kp], api = a.im[kp], aqr = a.re[kq], aqi = a.im[kq];
            const bpr = apr * cc + (aqr * sr - aqi * si);
            const bpi = api * cc + (aqr * si + aqi * sr);
            const bqr = -(apr * sr + api * si) + aqr * cc;
            const bqi = -(api * sr - apr * si) + aqi * cc;
            a.re[kp] = bpr; a.im[kp] = bpi;
            a.re[kq] = bqr; a.im[kq] = bqi;
            a.re[p * n + k] = bpr; a.im[p * n + k] = -bpi;        // Hermitian 对称
            a.re[q * n + k] = bqr; a.im[q * n + k] = -bqi;
          }
          // 已对角化的 2×2 块
          a.re[p * n + p] = ap * cc * cc + 2 * cc * ss * bm + aq * ss * ss;
          a.im[p * n + p] = 0;
          a.re[q * n + q] = ap * ss * ss - 2 * cc * ss * bm + aq * cc * cc;
          a.im[q * n + q] = 0;
          a.re[p * n + q] = 0; a.im[p * n + q] = 0;
          a.re[q * n + p] = 0; a.im[q * n + p] = 0;
        }
      }
      if (off < tol * tol * n * n) break;
    }

    // 取特征值并按降序排列（同时置换特征向量列）
    const vals = new Float64Array(n);
    for (let i = 0; i < n; i++) vals[i] = a.re[i * n + i];
    const idx = Array.from(vals.keys()).sort((x, y) => vals[y] - vals[x]);
    const sv = new Float64Array(n), vr = new Float64Array(n * n), vi = new Float64Array(n * n);
    for (let k = 0; k < n; k++) {
      sv[k] = vals[idx[k]];
      for (let i = 0; i < n; i++) {
        vr[i * n + k] = V.re[i * n + idx[k]];
        vi[i * n + k] = V.im[i * n + idx[k]];
      }
    }
    return { vals: sv, vecs: { re: vr, im: vi } };
  }

  /* ---------------- ESPRIT 用：特征多项式 + 复根 ---------------- */

  /** Faddeev–LeVerrier：返回降幂系数 c[0..n]，c[0]=1，p(λ)=Σ c[k]·λ^(n-k) */
  function charPoly(A, n) {
    const c = new Array(n + 1);
    c[0] = { re: 1, im: 0 };
    let Mk = cmat(n), Mnext = null, AM = null;
    for (let k = 1; k <= n; k++) {
      AM = mmul(A, Mk, n);
      Mnext = cmat(n);
      for (let i = 0; i < n; i++) {
        Mnext.re[i * n + i] = AM.re[i * n + i] + c[k - 1].re;
        Mnext.im[i * n + i] = AM.im[i * n + i] + c[k - 1].im;
      }
      const AMk = mmul(A, Mnext, n);
      let tr = 0, ti = 0;
      for (let i = 0; i < n; i++) { tr += AMk.re[i * n + i]; ti += AMk.im[i * n + i]; }
      c[k] = { re: -tr / k, im: -ti / k };
      Mk = Mnext;
    }
    return c;
  }

  function polyValC(c, n, z) {
    let vr = c[0].re, vi = c[0].im;
    for (let k = 1; k <= n; k++) {
      const nr = vr * z.re - vi * z.im + c[k].re;
      const ni = vr * z.im + vi * z.re + c[k].im;
      vr = nr; vi = ni;
    }
    return { re: vr, im: vi };
  }

  /** Durand–Kerner 求复系数多项式全部根 */
  function polyRoots(c, n) {
    const z = [];
    for (let i = 0; i < n; i++) {
      const r = Math.pow(0.85, i + 1), th = 2 * Math.PI * i / n + 0.61;
      z.push({ re: r * Math.cos(th), im: r * Math.sin(th) });
    }
    for (let it = 0; it < 160; it++) {
      let mv = 0;
      for (let i = 0; i < n; i++) {
        const p = polyValC(c, n, z[i]);
        let dr = 1, di = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const ar = z[i].re - z[j].re, ai = z[i].im - z[j].im;
          const nr = dr * ar - di * ai, ni = dr * ai + di * ar;
          dr = nr; di = ni;
        }
        const dd = dr * dr + di * di;
        if (dd < 1e-300) continue;
        const qr = (p.re * dr + p.im * di) / dd, qi = (p.im * dr - p.re * di) / dd;
        z[i].re -= qr; z[i].im -= qi;
        mv = Math.max(mv, Math.abs(qr) + Math.abs(qi));
      }
      if (mv < 1e-12) break;
    }
    return z;
  }

  /* ============================================================
     阵列仿真
     ============================================================ */

  /** 生成阵列数据 X（M×L，行主序），返回 {X, R} */
  function genArray(M, L, angs, K, snrDb, coherent, dr, seed) {
    const X = { re: new Float64Array(M * L), im: new Float64Array(M * L) };
    // 信源：独立时各为复高斯；相干时全部是第一个信源的复常数倍
    const sRe = [], sIm = [];
    for (let k = 0; k < K; k++) {
      if (coherent && k > 0) { sRe.push(sRe[0]); sIm.push(sIm[0]); }
      else { sRe.push(U.randn(L, seed + 31 * k)); sIm.push(U.randn(L, seed + 977 + 31 * k)); }
    }
    for (let k = 0; k < K; k++) {
      const ph = -2 * Math.PI * dr * Math.sin(angs[k] * Math.PI / 180);
      let sr = sRe[k], si = sIm[k];
      if (coherent && k > 0) {
        // s_k = 0.9 · s_0 · e^{jφ_k}：与第一个信源完全相关（多径镜像）
        const phi = 0.7 * k, cs = 0.9 * Math.cos(phi), sn = 0.9 * Math.sin(phi);
        const nr = new Float64Array(L), ni = new Float64Array(L);
        for (let l = 0; l < L; l++) { nr[l] = sr[l] * cs - si[l] * sn; ni[l] = sr[l] * sn + si[l] * cs; }
        sRe[k] = nr; sIm[k] = ni; sr = nr; si = ni;
      }
      for (let m = 0; m < M; m++) {
        const ar = Math.cos(ph * m), ai = Math.sin(ph * m);
        const base = m * L;
        for (let l = 0; l < L; l++) {
          X.re[base + l] += ar * sr[l] - ai * si[l];
          X.im[base + l] += ar * si[l] + ai * sr[l];
        }
      }
    }
    // 噪声：每阵元复噪声方差 σ² = 10^(-SNR/10)（单信源功率归一化为 1）
    const sigma = Math.pow(10, -snrDb / 20);         // 幅度
    const comp = sigma / Math.SQRT2;                 // 每分量标准差
    const nRe = U.randn(M * L, seed + 51001), nIm = U.randn(M * L, seed + 63001);
    for (let i = 0; i < M * L; i++) { X.re[i] += comp * nRe[i]; X.im[i] += comp * nIm[i]; }

    // 样本协方差 R = X Xᴴ / L
    const R = cmat(M);
    for (let i = 0; i < M; i++) {
      for (let j = i; j < M; j++) {
        let sr = 0, si = 0;
        const bi = i * L, bj = j * L;
        for (let l = 0; l < L; l++) {
          sr += X.re[bi + l] * X.re[bj + l] + X.im[bi + l] * X.im[bj + l];
          si += X.im[bi + l] * X.re[bj + l] - X.re[bi + l] * X.im[bj + l];
        }
        R.re[i * M + j] = sr / L; R.im[i * M + j] = si / L;
        R.re[j * M + i] = sr / L; R.im[j * M + i] = -si / L;
      }
    }
    return { X: X, R: R };
  }

  /** 前后向空间平滑：Ls 个 Msub 元前向子阵 + 它们共轭反转后的 Ls 个后向子阵，协方差取平均 */
  function smooth(R, M, Msub) {
    const Ls = M - Msub + 1;
    const Rs = cmat(Msub);
    for (let l = 0; l < Ls; l++) {
      for (let i = 0; i < Msub; i++) {
        for (let j = 0; j < Msub; j++) {
          Rs.re[i * Msub + j] += R.re[(i + l) * M + (j + l)] / Ls;
          Rs.im[i * Msub + j] += R.im[(i + l) * M + (j + l)] / Ls;
        }
      }
    }
    // 后向部分：R_fb = (R_f + J·R_f*·J)/2，J 为反序交换矩阵
    const cr = Float64Array.from(Rs.re), ci = Float64Array.from(Rs.im);
    for (let i = 0; i < Msub; i++) {
      for (let j = 0; j < Msub; j++) {
        const a = i * Msub + j, b = (Msub - 1 - i) * Msub + (Msub - 1 - j);
        Rs.re[a] = (cr[a] + cr[b]) / 2;
        Rs.im[a] = (ci[a] - ci[b]) / 2;
      }
    }
    return { R: Rs, Me: Msub, Ls: Ls };
  }

  /** 扫描用的导向矢量（就地写入 ar/ai） */
  function steer(ar, ai, Me, dr, thDeg) {
    const ph = -2 * Math.PI * dr * Math.sin(thDeg * Math.PI / 180);
    for (let m = 0; m < Me; m++) { ar[m] = Math.cos(ph * m); ai[m] = Math.sin(ph * m); }
  }

  /** 三种谱（CBF / MVDR / MUSIC），返回各自线性功率数组 */
  function spectra(R, Rinv, vecs, Me, K, dr, angs) {
    const nA = angs.length;
    const Pcbf = new Float64Array(nA), Pmv = new Float64Array(nA), Pmu = new Float64Array(nA);
    const ar = new Float64Array(Me), ai = new Float64Array(Me);
    for (let t = 0; t < nA; t++) {
      steer(ar, ai, Me, dr, angs[t]);
      // CBF: aᴴ R a
      let cr = 0, mr = 0;
      for (let i = 0; i < Me; i++) {
        let s1r = 0, s1i = 0, s2r = 0, s2i = 0;
        for (let j = 0; j < Me; j++) {
          const rr = R.re[i * Me + j], ri = R.im[i * Me + j];
          s1r += rr * ar[j] - ri * ai[j];
          s1i += rr * ai[j] + ri * ar[j];
          if (Rinv) {
            const qr = Rinv.re[i * Me + j], qi = Rinv.im[i * Me + j];
            s2r += qr * ar[j] - qi * ai[j];
            s2i += qr * ai[j] + qi * ar[j];
          }
        }
        cr += ar[i] * s1r + ai[i] * s1i;      // conj(a_i)·(R a)_i
        if (Rinv) mr += ar[i] * s2r + ai[i] * s2i;
      }
      Pcbf[t] = Math.max(cr, 1e-30);
      Pmv[t] = Rinv ? 1 / Math.max(mr, 1e-30) : Pcbf[t];
      // MUSIC: 1/‖Enᴴ a‖²
      let nn = 0;
      for (let k = K; k < Me; k++) {
        let dr2 = 0, di2 = 0;
        for (let m = 0; m < Me; m++) {
          const vr = vecs.re[m * Me + k], vi = vecs.im[m * Me + k];
          dr2 += vr * ar[m] + vi * ai[m];       // conj(v)·a
          di2 += vr * ai[m] - vi * ar[m];
        }
        nn += dr2 * dr2 + di2 * di2;
      }
      Pmu[t] = 1 / Math.max(nn, 1e-30);
    }
    return { cbf: Pcbf, mvdr: Pmv, music: Pmu };
  }

  /** dB 归一化 */
  function toDbNorm(p) {
    const out = new Float64Array(p.length);
    let mx = 0;
    for (let i = 0; i < p.length; i++) if (p[i] > mx) mx = p[i];
    for (let i = 0; i < p.length; i++) out[i] = 10 * Math.log10(Math.max(p[i], 1e-30) / Math.max(mx, 1e-30));
    return out;
  }

  /** 找谱上最大的 K 个局部峰，返回角度（升序） */
  function findPeaks(db, angs, K) {
    const idx = [];
    for (let i = 1; i < db.length - 1; i++) if (db[i] >= db[i - 1] && db[i] > db[i + 1]) idx.push(i);
    if (!idx.length) return [];
    idx.sort((a, b) => db[b] - db[a]);
    return idx.slice(0, K).sort((a, b) => a - b).map(i => angs[i]);
  }

  /** ESPRIT：由信号子空间的旋转不变性直接求角度 */
  function esprit(vecs, Me, K, dr) {
    if (K < 1 || Me < 2 || K >= Me) return [];
    const n = Me - 1;
    // E1 = 前 n 行，E2 = 后 n 行（K 列）
    const E1 = cmat(n), E2 = cmat(n);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < K; k++) {
        E1.re[i * n + k] = vecs.re[i * Me + k]; E1.im[i * n + k] = vecs.im[i * Me + k];
        E2.re[i * n + k] = vecs.re[(i + 1) * Me + k]; E2.im[i * n + k] = vecs.im[(i + 1) * Me + k];
      }
    }
    // Ψ = (E1ᴴE1)⁻¹ (E1ᴴE2)   （K×K）
    const A1 = cmat(K), A2 = cmat(K);
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K; j++) {
        let s1r = 0, s1i = 0, s2r = 0, s2i = 0;
        for (let m = 0; m < n; m++) {
          const e1r = E1.re[m * n + i], e1i = E1.im[m * n + i];
          const g1r = E1.re[m * n + j], g1i = E1.im[m * n + j];
          const g2r = E2.re[m * n + j], g2i = E2.im[m * n + j];
          s1r += e1r * g1r + e1i * g1i; s1i += e1r * g1i - e1i * g1r;
          s2r += e1r * g2r + e1i * g2i; s2i += e1r * g2i - e1i * g2r;
        }
        A1.re[i * K + j] = s1r; A1.im[i * K + j] = s1i;
        A2.re[i * K + j] = s2r; A2.im[i * K + j] = s2i;
      }
    }
    const A1i = minv(A1, K);
    if (!A1i) return [];
    const PSI = mmul(A1i, A2, K);
    const cp = charPoly(PSI, K);
    const roots = polyRoots(cp, K);
    const out = [];
    for (const z of roots) {
      const phi = -Math.atan2(z.im, z.re);          // ψ = e^{-jφ} → φ = -arg(ψ)
      const s = phi / (2 * Math.PI * dr);
      if (Math.abs(s) <= 1) out.push(Math.asin(s) * 180 / Math.PI);
    }
    return out.sort((a, b) => a - b);
  }

  /* =============================================================
     实验台定义
     ============================================================= */
  DSP.lab.create({
    path: 'lab/music',
    title: 'MUSIC 超分辨谱估计实验台',
    lede: '同样的阵列、同样的快拍，常规波束形成被瑞利限卡死，MUSIC 却能分开两个只隔几度的信源——代价是它对相干源、阵元误差和快拍数极其敏感。',
    tags: ['阵列信号处理', '空间谱估计', 'MUSIC', '超分辨', '子空间'],
    cols: 2,

    params: [
      { k: 'M',   type: 'slider', label: '阵元数 M',       min: 4,   max: 32,  step: 1,   value: 12, hint: '阵列孔径 = M·d，越大越锐利' },
      { k: 'L',   type: 'slider', label: '快拍数 L',       min: 8,   max: 1024, step: 8,  value: 128, hint: 'L 太小 → 协方差估计不准 → MUSIC 崩溃' },
      { k: 'K',   type: 'slider', label: '信源数 K（假设）', min: 1,   max: 4,   step: 1,   value: 2, hint: '必须数对，多估少估都会毁掉噪声子空间' },
      { k: 'th1', type: 'slider', label: '信源 1 角度 θ₁', min: -80, max: 80,  step: 1,   value: -10, unit: '°' },
      { k: 'dth', type: 'slider', label: '角度间隔 Δθ',     min: 1,   max: 40,  step: 0.5, value: 6,  unit: '°', hint: 'θ₂ = θ₁ + Δθ；K>2 时按 θ₁+k·Δθ 排开' },
      { k: 'snr', type: 'slider', label: '阵元级 SNR',      min: -20, max: 30,  step: 1,   value: 0,  unit: 'dB', hint: '单信源功率归一化为 1' },
      { k: 'dr',  type: 'slider', label: '阵元间距 d/λ',    min: 0.1, max: 1.0, step: 0.05, value: 0.5, fmt: v => U.fmt(v, 2), hint: '> 0.5 会出现栅瓣' },
      {
        k: 'alg', type: 'seg', label: '算法', value: 'music',
        options: [
          { value: 'cbf', label: 'CBF' }, { value: 'mvdr', label: 'MVDR' },
          { value: 'music', label: 'MUSIC' }, { value: 'esprit', label: 'ESPRIT' }
        ],
        hint: 'ESPRIT 只给估计值不画谱，图上仍以 MUSIC 谱做底'
      },
      { k: 'coh', type: 'toggle', label: '相干源（模拟多径）', value: false, hint: '相干源使协方差秩亏，MUSIC 失效' },
      { k: 'sm',  type: 'toggle', label: '前后向空间平滑', value: false, hint: '解相干的标准手段，代价是有效孔径变小' }
    ],

    plots: [
      { key: 'spec', title: '① 方位谱（dB，归一化，竖线为真实角度）', height: 300, opts: { xlabel: '角度 θ / °', ylabel: 'dB', legend: true } },
      { key: 'pol',  title: '② 极坐标方向图（半径 = 归一化谱，30 dB 动态）', height: 320, type: 'polar' },
      { key: 'eig',  title: '③ 协方差特征值谱（拐点 = 信号/噪声子空间分界）', height: 280, opts: { xlabel: '特征值序号', ylabel: 'dB', legend: true } }
    ],

    build: function (el, ui, P, st) {
      noteEl = U.qs('.callout.note', el);
    },

    /* ---------------- 主更新 ---------------- */
    update: function (st, P, ui) {
      const M = Math.round(st.M), L = Math.round(st.L), Kraw = Math.round(st.K);
      const dr = st.dr;
      let angsTrue = [];
      for (let k = 0; k < Kraw; k++) angsTrue.push(st.th1 + k * st.dth);
      // 整体平移，保证所有信源都落在扫描窗 [−88°, 88°] 内（间隔保持不变）
      const mn = Math.min.apply(null, angsTrue), mx = Math.max.apply(null, angsTrue);
      if (mx > 88) angsTrue = angsTrue.map(a => a + (88 - mx));
      else if (mn < -88) angsTrue = angsTrue.map(a => a + (-88 - mn));
      const t0 = U.now();

      /* ---- 1. 阵列数据与协方差 ---- */
      const sim = genArray(M, L, angsTrue, Kraw, st.snr, !!st.coh, dr, SEED);
      let R = sim.R, Me = M, Ls = 1, smoothed = false;
      if (st.sm) {
        const Msub = Math.max(Kraw + 1, Math.ceil((M + 1) / 2));
        if (Msub < M) { const s = smooth(R, M, Msub); R = s.R; Me = s.Me; Ls = s.Ls; smoothed = true; }
      }
      const K = Math.max(1, Math.min(Kraw, Me - 1));   // 噪声子空间至少 1 维

      /* ---- 2. 特征分解 ---- */
      const eg = eigHerm(R, Me);
      const vals = eg.vals, vecs = eg.vecs;

      /* ---- 3. MVDR 需要的 R⁻¹（对角加载保证可逆） ---- */
      let tr = 0;
      for (let i = 0; i < Me; i++) tr += vals[i];
      const load = Math.max(1e-12, tr / Me * 1e-8);
      const Rl = { re: Float64Array.from(R.re), im: Float64Array.from(R.im) };
      for (let i = 0; i < Me; i++) Rl.re[i * Me + i] += load;
      const Rinv = minv(Rl, Me);

      /* ---- 4. 扫描三种谱 ---- */
      const step = 0.5;
      const nA = Math.round((SCAN_HI - SCAN_LO) / step) + 1;
      const angs = new Float64Array(nA);
      for (let i = 0; i < nA; i++) angs[i] = SCAN_LO + i * step;
      const sp = spectra(R, Rinv, vecs, Me, K, dr, angs);
      const dbMu = toDbNorm(sp.music), dbCbf = toDbNorm(sp.cbf), dbMv = toDbNorm(sp.mvdr);

      /* ---- 5. 估计角度与分辨判据 ---- */
      const sel = st.alg === 'esprit' ? 'music' : st.alg;
      const dbSel = sel === 'cbf' ? dbCbf : (sel === 'mvdr' ? dbMv : dbMu);
      const est = findPeaks(dbSel, angs, K);
      const estEsp = esprit(vecs, Me, K, dr);

      // 分辨判据：两真实角度之间的谷底，比两侧各自的最高点都低 3 dB 以上
      // （只要求"相对谷底抬起"，不要求绝对高度，避免弱信源被误判为没分辨）
      let dipDb = NaN, resolved = false, pairTxt = '';
      if (Kraw >= 2) {
        const a1 = Math.min(angsTrue[0], angsTrue[1]), a2 = Math.max(angsTrue[0], angsTrue[1]);
        const mid = (a1 + a2) / 2;
        const w = Math.max(0.5, (a2 - a1) * 0.3);
        let p1 = -200, p2 = -200, dm = 200;
        for (let i = 0; i < nA; i++) {
          const a = angs[i];
          if (a >= a1 - w && a <= mid) p1 = Math.max(p1, dbSel[i]);
          if (a >= mid && a <= a2 + w) p2 = Math.max(p2, dbSel[i]);
          if (a > a1 + 0.15 * (a2 - a1) && a < a2 - 0.15 * (a2 - a1)) dm = Math.min(dm, dbSel[i]);
        }
        const pk = Math.min(p1, p2);
        dipDb = dm - pk;                                   // 负值表示有凹陷
        resolved = dipDb < -3;
        pairTxt = U.fmt(a1, 1) + '° 与 ' + U.fmt(a2, 1) + '°';
      }

      // 瑞利限 λ/(M·d·cosθ)（度）：按有效孔径 Me 算，平滑后孔径变小 → 瑞利限变差
      const thMid = Kraw >= 2 ? (angsTrue[0] + angsTrue[1]) / 2 * Math.PI / 180 : angsTrue[0] * Math.PI / 180;
      const cosM = Math.max(0.2, Math.cos(thMid));
      const rayleigh = (1 / (Me * dr * cosM)) * 180 / Math.PI;
      const rayleighFull = (1 / (M * dr * cosM)) * 180 / Math.PI;

      // 估计误差（把估计角度按升序与真实角度配对）
      const estSorted = est.slice().sort((a, b) => a - b);
      const trueSorted = angsTrue.slice().sort((a, b) => a - b);
      let errSum = 0, errCnt = 0;
      for (let i = 0; i < Math.min(estSorted.length, trueSorted.length); i++) {
        errSum += Math.abs(estSorted[i] - trueSorted[i]); errCnt++;
      }
      const errDeg = errCnt ? errSum / errCnt : NaN;

      /* ---- 6. 门限效应：固定种子蒙特卡洛（按代价预估决定是否跑，且受 25 ms 时间预算约束） ---- */
      const estCost = M * M * L + 8 * Me * Me * Me;      // 单次试验的粗估浮点量
      const doMC = estCost < 4e5;
      const angsC = new Float64Array(181);
      for (let i = 0; i < 181; i++) angsC[i] = -90 + i;   // MC 用 1° 粗扫
      let rmse = 0, mcN = 0;
      for (let it = 0; it < 24 && doMC; it++) {
        if (mcN >= 1 && U.now() - t0 > 25) break;
        const R2 = genArray(M, L, angsTrue, Kraw, st.snr, !!st.coh, dr, SEED + 7919 * (it + 1)).R;
        const Rm = smoothed ? smooth(R2, M, Me).R : R2;
        const eg2 = eigHerm(Rm, Me);
        const db2 = toDbNorm(spectra(Rm, null, eg2.vecs, Me, K, dr, angsC).music);
        const e2 = findPeaks(db2, angsC, K);
        if (!e2.length) break;
        let se = 0;
        const nCmp = Math.min(e2.length, trueSorted.length);
        for (let i = 0; i < nCmp; i++) se += Math.pow(e2[i] - trueSorted[i], 2);
        rmse += se / nCmp; mcN++;
      }
      if (mcN) rmse = Math.sqrt(rmse / mcN); else rmse = NaN;

      /* ---- 7. 绘图 ---- */
      const ps = P.spec.plot;
      ps.clear();
      const COL = { music: 0, mvdr: 2, cbf: 3 };
      ps.add({ x: angs, y: dbCbf, type: 'line', color: COL.cbf, width: st.alg === 'cbf' ? 2 : 1, alpha: st.alg === 'cbf' ? 1 : 0.35, label: 'CBF' });
      ps.add({ x: angs, y: dbMv, type: 'line', color: COL.mvdr, width: st.alg === 'mvdr' ? 2 : 1, alpha: st.alg === 'mvdr' ? 1 : 0.35, label: 'MVDR' });
      ps.add({ x: angs, y: dbMu, type: 'line', color: COL.music, width: (st.alg === 'music' || st.alg === 'esprit') ? 2 : 1, alpha: (st.alg === 'music' || st.alg === 'esprit') ? 1 : 0.35, label: 'MUSIC' });
      angsTrue.forEach((a, i) => ps.vline(a, { label: i === 0 ? '真 θ' + (i + 1) : 'θ' + (i + 1), color: '#16a34a', dash: [4, 3], width: 1.2 }));
      ps.hline(-3, { label: '−3 dB 判据', color: '#b45309', dash: [5, 4] });
      if (st.alg === 'esprit') estEsp.forEach(a => ps.vline(a, { label: 'ESPRIT', color: '#7c3aed', dash: [2, 2] }));
      ps.draw();

      // ② 极坐标
      const rPol = new Float64Array(nA);
      for (let i = 0; i < nA; i++) rPol[i] = Math.max(0, Math.min(1, (dbSel[i] + 30) / 30));
      DSP.plot.polar(P.pol.canvas, {
        theta: angs, r: rPol, rMin: 0, rMax: 1, rings: 4, ndir: 12, height: 320,
        title: '半径 = 谱（dB+30）/30'
      });

      // ③ 特征值谱
      const eigDb = new Float64Array(Me);
      const vmax = Math.max(vals[0], 1e-30);
      for (let i = 0; i < Me; i++) eigDb[i] = 10 * Math.log10(Math.max(vals[i], 1e-30) / vmax);
      const idxA = new Float64Array(Me);
      for (let i = 0; i < Me; i++) idxA[i] = i + 1;
      const pe = P.eig.plot;
      pe.clear();
      pe.add({ x: idxA, y: eigDb, type: 'stem', color: 0, label: '特征值（归一化 dB）' })
        .vline(K + 0.5, { label: 'K=' + K + '（左=信号子空间，右=噪声子空间）', color: '#b45309' })
        .draw();

      /* ---- 8. 解读 ---- */
      const lamMax = vals[0], lamMin = vals[Me - 1];
      const cond = lamMax / Math.max(lamMin, 1e-30);
      const algName = { cbf: '常规波束形成 CBF', mvdr: 'MVDR（Capon）', music: 'MUSIC', esprit: 'ESPRIT' }[st.alg];
      const L2 = [];
      L2.push('**当前配置**：M = ' + M + '，快拍 L = ' + L + '，假设信源数 K = ' + K + '，d/λ = ' +
        U.fmt(dr, 2) + '，阵元级 SNR = ' + U.fmt(st.snr, 0) + ' dB；真实角度 ' +
        angsTrue.map(a => U.fmt(a, 1) + '°').join('、') + '。算法 = **' + algName + '**' +
        (smoothed ? '；已做前后向空间平滑（' + Ls + ' 个 ' + Me + ' 元子阵 ×2，有效孔径从 ' + M + ' 降到 ' + Me + '）' : '') + '。');

      if (Kraw >= 2) {
        L2.push('**能不能分开**：判据是"' + pairTxt + '之间出现凹陷且两侧各有峰"。当前凹陷 **' +
          U.fmt(dipDb, 1) + ' dB** → ' + (resolved ? '**已分辨**（凹陷超过 3 dB）' : '**没分辨**（两峰粘成一个，或其中一个根本没出峰）') +
          '。当前阵列的瑞利限 Δθ ≈ λ/(M·d·cosθ) = ' + U.fmt(rayleigh, 2) + '°，而实际间隔 Δθ = ' +
          U.fmt(st.dth, 1) + '° —— ' + (st.dth > rayleigh
            ? '间隔大于瑞利限，连 CBF 都有机会分开'
            : '间隔只有瑞利限的 ' + U.fmt(st.dth / rayleigh, 2) + ' 倍，**CBF 注定失败**：它的分辨率被孔径（M·d = ' +
              U.fmt(M * dr, 1) + 'λ）锁死；MUSIC 不受此限，因为它用的是噪声子空间与导向矢量的正交性，' +
              '只要信噪比和快拍数够，理论上 Δθ 可以任意小') + '。');
      }

      L2.push('**门限效应**：' + (mcN
        ? '用固定种子做了 ' + mcN + ' 次蒙特卡洛，当前 SNR/快拍下估计 RMSE = ' + U.fmt(rmse, 2) + '°（单次估计误差 ' + U.fmt(errDeg, 2) + '°）'
        : '当前阵元数/快拍数较大，为保证交互流畅已跳过蒙特卡洛，仅给单次估计误差 ' + U.fmt(errDeg, 2) + '°') + '。' +
        'MUSIC 不是万能的：当 SNR 降到门限以下（本例大约 ' + (st.snr < -5 ? '就是现在' : '再降 10~15 dB') +
        '）或快拍数不足（L 与 M 同量级时协方差估计严重失真），信号子空间与噪声子空间会"混在一起"，' +
        '特征值的拐点消失，谱上的峰开始乱跑——把 L 拉到 16 或把 SNR 拉到 −15 dB 就能看到崩塌。');

      if (st.coh) {
        const Msub0 = Math.max(Kraw + 1, Math.ceil((M + 1) / 2));
        const Ls0 = Math.max(1, M - Msub0 + 1);
        L2.push('**相干源**：两个信源完全相关（多径镜像的典型情形），协方差矩阵秩亏到 1，' +
          '信号子空间只占 1 维，MUSIC 的噪声子空间里混进了信号能量，谱上只剩一个驼峰 —— 看图③：' +
          '第 2 个特征值已经贴着噪声地板（' + U.fmt(20 * Math.log10(Math.max(vals[1], 1e-30) / Math.max(vals[0], 1e-30)), 1) +
          ' dB），拐点消失了。' + (smoothed
            ? '**已经打开前后向空间平滑**：' + Ls + ' 个 ' + Me + ' 元前向子阵 + 它们共轭反转的 ' + Ls +
              ' 个后向子阵一起平均，把秩补回来 → ' + (resolved
                ? '**谱峰回来了**，凹陷 ' + U.fmt(dipDb, 1) + ' dB，瑞利限也从 ' + U.fmt(rayleighFull, 2) + '° 变差到 ' + U.fmt(rayleigh, 2) + '°'
                : '凹陷仍只有 ' + U.fmt(dipDb, 1) + ' dB，还没救回来（间隔太小或 SNR 太低时平滑也无能为力）') +
              '。代价是有效孔径从 ' + M + ' 元降到 ' + Me + ' 元。'
            : '**试试勾选"前后向空间平滑"**：把阵列分成 ' + Ls0 + ' 个 ' + Msub0 +
              ' 元重叠子阵（再加它们的共轭反转）做协方差平均，秩就能补回来，代价是有效孔径从 ' + M + ' 元降到 ' + Msub0 + ' 元。'));
      }

      if (dr > 0.5) {
        const s0 = Math.sin(angsTrue[0] * Math.PI / 180);
        const gl = [];
        [1, -1].forEach(sg => {
          const s = s0 + sg / dr;
          if (Math.abs(s) <= 1) gl.push(U.fmt(Math.asin(s) * 180 / Math.PI, 1) + '°');
        });
        L2.push('**栅瓣**：d/λ = ' + U.fmt(dr, 2) + ' > 0.5，空间采样不满足奈奎斯特，出现等强假峰。' +
          '栅瓣角由 sinθ_g = sinθ₀ ± λ/d 给出' + (gl.length ? '，本例在 ' + gl.join(' 与 ') + ' 附近' : '（本例落在可视区外）') +
          '。工程上阵元间距必须 ≤ λ/2，或者用非均匀阵/宽带信号把栅瓣打散。');
      }

      L2.push('**特征值谱为什么是理解 MUSIC 的钥匙**：图③里前 ' + K + ' 个大特征值属于信号子空间，' +
        '后面 ' + (Me - K) + ' 个几乎相等的小特征值就是噪声子空间（本例最大/最小特征值比 = ' +
        U.fmt(cond, 1) + '）。MUSIC 的全部本事就来自"导向矢量与噪声子空间正交"，' +
        '所以 K 必须数对：K 数小了，信号子空间维数不够，峰直接消失；K 数大了，噪声子空间被污染，谱底抬高、出现假峰。');

      if (st.alg === 'esprit') {
        L2.push('**ESPRIT**：不扫描角度，直接利用前 M−1 与后 M−1 行的旋转不变性 Ψ，取其特征值 ψ_k = e^{−jφ_k}，' +
          '再由 sinθ = φ/(2π·d/λ) 反解。当前估计 ' + (estEsp.length ? estEsp.map(a => U.fmt(a, 2) + '°').join('、') : '（无解）') +
          '，误差 ' + U.fmt(errDeg, 2) + '°。它比 MUSIC 快（不用扫角），但对阵元位置误差同样敏感。');
      }

      ui.explain(L2.join('\n\n'));
      if (noteEl) UI.renderMathIn(noteEl);

      /* ---- 9. 指标 ---- */
      ui.metrics([
        { label: '估计角度', value: est.length ? est.map(a => U.fmt(a, 1)).join(' / ') : '—', unit: '°' },
        { label: '估计误差', value: isFinite(errDeg) ? U.fmt(errDeg, 2) : '—', unit: '°' },
        { label: 'RMSE（' + mcN + ' 次）', value: isFinite(rmse) ? U.fmt(rmse, 2) : '—', unit: '°' },
        { label: '瑞利限', value: U.fmt(rayleigh, 2), unit: '°' },
        { label: '是否分辨', value: Kraw >= 2 ? (resolved ? '已分辨' : '未分辨') : '单信源' },
        { label: '凹陷深度', value: isFinite(dipDb) ? U.fmt(dipDb, 1) : '—', unit: 'dB' },
        { label: 'λmax/λmin', value: U.fmt(cond, 1) },
        { label: '有效阵元', value: String(Me) + (smoothed ? '（平滑后）' : '') },
        { label: '本次耗时', value: U.fmt(U.now() - t0, 0), unit: 'ms' }
      ]);
    },

    advice: '先用默认参数（M=12、Δθ=6°、SNR=0 dB、128 快拍）看 MUSIC 把两个源干净分开，然后切到 CBF——同样是 12 元阵，它只剩一个驼峰，因为 6° 远小于 9.5° 的瑞利限。接着把 SNR 拉到 −15 dB、或把快拍降到 16，看谱峰怎么散掉（门限效应）。再勾选"相干源"，MUSIC 立刻塌成一个峰，勾上"空间平滑"看它怎么被救回来。最后把 d/λ 推到 1.0，找一找栅瓣。',
    eng: '教科书上 MUSIC 无敌，但真实阵列的幅相误差能把它打回原形：5° 的相位误差就足以让 −30 dB 的零陷退化到 −10 dB，所以上阵前必须做幅相校准（用已知方位的信标或自校准算法）。信源数 K 靠 AIC/MDL 准则估计，估错一维结果就全废。相干源（多径、镜像）必须先解相干——空间平滑最常用，但有效孔径减半，阵元数紧张时往往改用 Toeplitz 重构或稀疏重构。快拍数要远大于阵元数，且目标在相干处理时间内不能跨距离/多普勒单元。',
    wrong: '常见错误：一是把 MUSIC 的"超分辨"当成无限分辨，实际上它在 SNR 门限以下会彻底崩塌，且门限随 Δθ 减小而急剧升高；二是忽略信源数 K，直接按"看起来有几个峰"来设，结果噪声子空间维数错、谱底抬高；三是阵元间距取 d > λ/2，谱上出现的等强假峰被当成真实目标；四是拿相干源（多径）直接跑 MUSIC 却不做解相干，误以为算法失效；五是把仿真里的理想阵列（无误差、噪声白、快拍无限）当成工程指标，实测分辨力往往要打对折。',

    see: [
      { path: 'theory/spectrum/subspace', title: '子空间谱估计理论' },
      { path: 'theory/array/beamforming', title: '阵列波束形成' }
    ]
  });
})(window);

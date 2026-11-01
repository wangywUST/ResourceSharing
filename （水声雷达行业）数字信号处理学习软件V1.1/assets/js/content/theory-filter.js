/* =============================================================
   theory-filter.js —— 知识理论库 · 三、滤波算法（7 页）
   路由：theory/filter/*

   内容写入方式：结构化 block（见 doc.js 头部注释）
   所有曲线均由 DSP.core 实时计算，不写死数据
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const doc = DSP.doc;
  const C = DSP.core;
  const U = DSP.util;

  /* ============================================================
     本文件共用的小工具（均为一次性辅助，不重写核心库）
     ============================================================= */

  /** 由 freqz 结果计算群延迟（相位已去卷绕），单位：样点 */
  function groupDelay(fr) {
    const n = fr.phase.length, dw = 2 * Math.PI / n;
    const g = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) g[i] = -(fr.phase[i + 1] - fr.phase[i - 1]) / (2 * dw);
    g[0] = g[1]; g[n - 1] = g[n - 2];
    return g;
  }

  /** 取 freqz 结果的单边（0…π）频率轴与幅度 dB */
  function halfDb(fr, fs) {
    const n = fr.magDb.length, half = n >> 1;
    const x = new Float64Array(half), y = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      x[i] = fs ? fr.f[i] : (i / n);
      y[i] = fr.magDb[i];
    }
    return { x: x, y: y };
  }

  /** 由零极点生成归一化到直流增益 1 的 b/a 系数（实数） */
  function zp2ba(zeros, poles) {
    const B = C.polyFromRoots(zeros), A = C.polyFromRoots(poles);
    const b = Array.from(B.re), a = Array.from(A.re);
    let sb = 0, sa = 0;
    for (let i = 0; i < b.length; i++) sb += b[i];
    for (let i = 0; i < a.length; i++) sa += a[i];
    const g = sa / (sb || 1e-30);
    return { b: b.map(v => v * g), a: a };
  }

  /** 凯泽窗 β（给定阻带衰减 A dB） */
  function kaiserBeta(A) {
    if (A > 50) return 0.1102 * (A - 8.7);
    if (A >= 21) return 0.5842 * Math.pow(A - 21, 0.4) + 0.07886 * (A - 21);
    return 0;
  }

  /** 凯泽窗阶数估算：A dB 衰减、数字过渡带宽 dw（rad/sample） */
  function kaiserOrder(A, dw) { return Math.ceil((A - 8) / (2.285 * dw)); }

  /** Butterworth 模拟低通极点（左半平面），截止 Ωc */
  function butterPoles(n, wc) {
    const out = [];
    for (let k = 1; k <= n; k++) {
      const th = Math.PI * (2 * k + n - 1) / (2 * n);
      out.push({ re: wc * Math.cos(th), im: wc * Math.sin(th) });
    }
    return out;
  }

  /** Chebyshev I 型模拟低通极点，通带波纹参数 eps，截止 Ωc */
  function cheby1Poles(n, eps, wc) {
    const phi = Math.asinh(1 / eps) / n;
    const sh = Math.sinh(phi), ch = Math.cosh(phi);
    const out = [];
    for (let k = 1; k <= n; k++) {
      const th = (2 * k - 1) * Math.PI / (2 * n);
      out.push({ re: -wc * sh * Math.sin(th), im: wc * ch * Math.cos(th) });
    }
    return out;
  }

  /** 由零极点算幅频响应 dB（已按直流增益归一到 0 dB），nfft 点覆盖 0…2π */
  function zpRespDb(zeros, poles, nfft, fs) {
    const S = C.zpH2Freq(zeros, poles, 1, nfft);
    const m = C.mag(S);
    const dc = Math.max(Math.hypot(S.re[0], S.im[0]), 1e-12);
    const half = nfft >> 1;
    const x = new Float64Array(half), y = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      x[i] = fs ? (fs * i / nfft) : (i / nfft);
      y[i] = 20 * Math.log10(Math.max(m[i], 1e-12) / dc);
    }
    return { x: x, y: y };
  }

  /**
   * 富文本片段：把含 $公式$ 与 **加粗** 的字符串转成 DOM 片段。
   * 用于表格单元格（doc.js 的 table 支持传入节点），md 块无需此处理。
   */
  function richText(s) {
    s = String(s);
    if (s.indexOf('$') < 0 && s.indexOf('**') < 0) return null;
    const frag = document.createDocumentFragment();
    s.split(/(\*\*[^*]+\*\*)/).forEach(bp => {
      const isBold = bp.length > 4 && bp.slice(0, 2) === '**' && bp.slice(-2) === '**';
      (isBold ? bp.slice(2, -2) : bp).split(/(\$[^$]+?\$)/).forEach(mp => {
        if (!mp) return;
        if (mp.length > 2 && mp.charAt(0) === '$' && mp.charAt(mp.length - 1) === '$') {
          try { frag.appendChild(DSP.ui.mathInline(mp.slice(1, -1))); return; } catch (e) { /* 落到文本 */ }
        }
        if (isBold) {
          const em = document.createElement('em');
          em.className = 'k';
          em.textContent = mp;
          frag.appendChild(em);
        } else {
          frag.appendChild(document.createTextNode(mp));
        }
      });
    });
    return frag;
  }

  /** 注册前预处理：表格单元格中的公式/加粗转 DOM */
  function prep(spec) {
    (spec.sections || []).forEach(sec => {
      (sec.blocks || []).forEach(b => {
        if (b.t === 'table' && b.rows) {
          b.rows = b.rows.map(r => r.map(c => {
            if (c && c.nodeType) return c;
            const n = richText(c);
            return n || c;
          }));
        }
      });
    });
    return spec;
  }

  const reg = (path, spec) => doc.register(path, prep(spec));

  /* ------------------------- 代码块（安全高亮包装） -------------------------
     ui.js 的 highlight 在 Python 关键字循环里会把已生成的 class 属性再次替换，
     导致 <span 被破坏。这里用"先占位后还原"的安全流程重写高亮，
     仍复用 UI.code 的容器、标题与复制按钮。 */
  function safeHighlight(src, lang) {
    const isPy = lang === 'python' || lang === 'py';
    const stash = [];
    const enc = i => String(i).replace(/\d/g, d => String.fromCharCode(103 + +d));   // 无数字占位
    const keep = (txt, cls) => { stash.push('<span class="' + cls + '">' + txt + '</span>'); return '\uE100' + enc(stash.length - 1) + '\uE101'; };
    let s = U.esc(src);
    s = s.replace(isPy ? /(#[^\n]*)/g : (lang === 'matlab' ? /(%[^\n]*)/g : /(\/\/[^\n]*)/g), m => keep(m, 'c-com'));
    s = s.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, m => keep(m, 'c-str'));
    const kw = isPy
      ? ['import', 'from', 'def', 'return', 'for', 'in', 'if', 'else', 'elif', 'while', 'as', 'with', 'lambda', 'None', 'True', 'False', 'class', 'try', 'except']
      : (lang === 'matlab' ? ['function', 'end', 'for', 'if', 'else', 'elseif', 'while', 'return']
        : ['function', 'const', 'let', 'var', 'return', 'for', 'if', 'else', 'while', 'new', 'class']);
    s = s.replace(new RegExp('\\b(' + kw.join('|') + ')\\b', 'g'), m => keep(m, 'c-key'));
    s = s.replace(/\b([a-zA-Z_]\w*)(\s*\()/g, (m, fn, par) => keep(fn, 'c-fun') + par);
    s = s.replace(/\b(\d+\.?\d*(?:e[-+]?\d+)?)\b/gi, m => keep(m, 'c-num'));
    return s.replace(/\uE100([g-p]+)\uE101/g, (_, i) => stash[parseInt(String(i).replace(/[g-p]/g, c => c.charCodeAt(0) - 103), 10)]);
  }

  function codeBlock(src, lang, title) {
    const lg = lang || 'python';
    const node = DSP.ui.code(src, lg, { title: title, highlight: false });
    const pre = node.querySelector ? node.querySelector('pre') : null;
    if (pre) pre.innerHTML = safeHighlight(src, lg);
    return { t: 'raw', node: node };
  }


  /* ============================================================
     1. 线性卷积与循环卷积
     ============================================================= */
  reg('theory/filter/conv', {
    title: '线性卷积与循环卷积',
    lede: '线性卷积是"系统的记忆如何叠加"，循环卷积是"把序列卷在圆环上叠加"。两者只差一个混叠——看清这一点，FFT 快速卷积、重叠相加、分段滤波就全通了。',
    tags: ['滤波', '卷积', 'FFT', '重叠相加'],
    labs: [
      { path: 'lab/conv', title: '卷积交互实验台', desc: '拖动序列，同步观察线性卷积与循环卷积的差异与混叠产生过程' },
      { path: 'lab/fftflow', title: 'FFT 蝶形运算动画', desc: '理解为什么频域相乘能替代时域卷积，以及代价在哪里' }
    ],
    toc: true,
    sections: [
      {
        id: 'why', num: '1', title: '卷积不是定义出来的，是"线性 + 时不变"逼出来的',
        blocks: [
          { t: 'md', md: '任何一个离散时间线性时不变（LTI）系统，它的全部行为被一个序列完全决定——**单位脉冲响应** $h[n]$。这不是近似，是完备描述：只要系统满足线性与时不变，知道 $h[n]$ 就能预测它对任意输入的响应，不需要知道系统内部是电路、是信道、还是一段混响。' },
          { t: 'md', md: '推理只有三步。第一步，任意序列都能拆成移位冲激的加权和：$x[n]=\\sum_k x[k]\\,\\delta[n-k]$。第二步，系统对 $\\delta[n-k]$ 的响应由时不变性可知为 $h[n-k]$。第三步，由线性把这些响应按 $x[k]$ 加权叠加。于是输出被唯一确定：' },
          { t: 'math', tex: 'y[n] = \\sum_{k=-\\infty}^{\\infty} x[k]\\,h[n-k] = \\sum_{k=-\\infty}^{\\infty} h[k]\\,x[n-k] \\triangleq (x*h)[n]', tag: '(1)' },
          { t: 'md', md: '所以卷积不是教科书硬塞的运算，它是两条物理约束推出的唯一答案。滤波器、水声信道多途、房间混响、换能器的振铃、匹配滤波器，本质上都在算同一个式子。工程上把它读成一句话：**输出 = 当前输入与过去若干输入的加权和，权重就是系统对一次冲击的记忆。**' },
          { t: 'callout', kind: 'note', title: '四个动作：翻转—平移—相乘—累加', md: '计算 $y[n]=\\sum_k x[k]h[n-k]$ 时，把 $h[k]$ 先**翻转**成 $h[-k]$，再**平移** $n$ 格得到 $h[n-k]$，与 $x[k]$ 逐点**相乘**，最后**累加**。翻转是理解的关键：它表示"越早进入系统的输入，被系统记忆的时间越长，权重落在 $h$ 的越靠后位置"。' },
          { t: 'kv', title: '变量说明', pairs: [
            ['x[n]', '输入序列，长度 $L$（非零区间）'],
            ['h[n]', '单位脉冲响应，长度 $M$（FIR 阶数 $+1$）'],
            ['y[n]', '输出序列，长度为 $L+M-1$'],
            ['k', '求和哑标，物理上是"这个输入样本是多久之前进来的"']
          ] }
        ]
      },
      {
        id: 'len', num: '2', title: '长度关系 M+L−1 与多项式乘法视角',
        blocks: [
          { t: 'md', md: '若 $x[n]$ 的非零区间长为 $L$、$h[n]$ 的非零区间长为 $M$，则卷积结果的非零区间恰为 $L+M-1$。原因很直观：最早的输入样本要经过 $M-1$ 个采样周期才"用完"它的记忆，最晚的输入样本又贡献了尾部，两个端点相加就是 $L+M-1$。' },
          { t: 'math', tex: '\\underbrace{0\\le n \\le L-1}_{x} \\;+\\; \\underbrace{0\\le n \\le M-1}_{h} \\;\\Longrightarrow\\; y[n]\\neq 0 \\text{ 仅当 } 0\\le n \\le L+M-2', tag: '(2)' },
          {
            t: 'fold', summary: '展开：由支撑区间叠加推出长度，并与多项式乘法对应', deriv: true, blocks: [
              { t: 'md', md: '**支撑区间法**：两个集合 $A=[0,L-1]$、$B=[0,M-1]$ 的闵可夫斯基和 $A+B=\\{a+b\\}$ 的支撑为 $[0,\\,L+M-2]$，元素个数为 $L+M-1$。卷积正是定义在支撑的闵可夫斯基和上，故长度结论成立。' },
              { t: 'md', md: '**多项式视角**：把序列写成 $z^{-1}$ 的多项式 $X(z)=\\sum_n x[n]z^{-n}$、$H(z)=\\sum_n h[n]z^{-n}$，则' },
              { t: 'math', tex: 'Y(z) = X(z)\\,H(z) = \\sum_{n} \\left(\\sum_k x[k]h[n-k]\\right) z^{-n}', tag: '(3)' },
              { t: 'md', md: '即**卷积就是多项式乘法**：$z^{-n}$ 的系数正是两个多项式中下标和为 $n$ 的那些乘积之和。这一视角的价值在下一节立刻兑现——把乘法换成"模 $z^N-1$ 的乘法"，线性卷积就变成了循环卷积。' }
            ]
          },
          {
            t: 'widget', render: function (el) {
              const L = 6, M = 3;
              const x = Float64Array.from([1, 2, 3, 2, 1, 0.5]);
              const h = Float64Array.from([0.5, 1, 0.5]);
              const y = C.conv(x, h);
              const grid = U.h('div.grid.g3');

              const b1 = DSP.ui.plotBox({ title: '输入 x[k]（L = 6）' });
              const p1 = DSP.plot.new(b1.canvas, { height: 165, xlabel: 'k', ylabel: 'x[k]', legend: false, ylim: [0, 3.4] });
              p1.add({ x: U.arange(L), y: Array.from(x), type: 'stem', color: 0, width: 1.6 }).draw();

              const b2 = DSP.ui.plotBox({ title: '翻转平移后的 h[3−k] 与乘积' });
              const p2 = DSP.plot.new(b2.canvas, { height: 165, xlabel: 'k', ylabel: '幅度', legend: true, legendPos: 'tr', ylim: [-0.6, 3.4] });
              const hf = new Float64Array(L);
              const prod = new Float64Array(L);
              for (let k = 0; k < L; k++) {
                const idx = 3 - k;
                hf[k] = (idx >= 0 && idx < M) ? h[idx] : 0;
                prod[k] = x[k] * hf[k];
              }
              p2.add({ x: U.arange(L), y: Array.from(x), type: 'stem', color: 3, width: 1.4, label: 'x[k]' })
                .add({ x: U.arange(L), y: Array.from(hf), type: 'stem', color: 1, width: 1.6, label: 'h[3−k]（翻转+平移）' })
                .add({ x: U.arange(L), y: Array.from(prod), type: 'stem', color: 2, width: 2, label: '逐点乘积' })
                .draw();

              const b3 = DSP.ui.plotBox({ title: '输出 y[n]（长度 6+3−1 = 8）' });
              const p3 = DSP.plot.new(b3.canvas, { height: 165, xlabel: 'n', ylabel: 'y[n]', legend: false });
              p3.add({ x: U.arange(y.length), y: Array.from(y), type: 'stem', color: 0, width: 1.8 })
                .annotate(3, y[3], 'y[3]', { dy: -10, size: 11 })
                .draw();

              grid.appendChild(b1.el); grid.appendChild(b2.el); grid.appendChild(b3.el);
              el.appendChild(grid);
              let s = 0; for (let k = 0; k < L; k++) s += prod[k];
              el.appendChild(U.h('div.plot-cap', { html: U.md('逐点累加验证：$y[3]=\\sum_k x[k]h[3-k] = ' + U.fmt(s, 3) + '$。图二中橙色杆就是被累加的那些乘积，把它们加起来就得到图三在 $n=3$ 处的那根杆。') }));
            }
          }
        ]
      },
      {
        id: 'circ', num: '3', title: '循环卷积：把序列摆到圆环上',
        blocks: [
          { t: 'math', tex: 'y_c[n] = \\sum_{k=0}^{N-1} x[k]\\;h[(n-k)\\!\\!\\mod N],\\qquad n = 0,1,\\dots,N-1', tag: '(4)' },
          { t: 'md', md: '它与线性卷积只差一处：下标要**对 $N$ 取模**。物理图景是把两个长度 $N$ 的序列摆在圆周上，一个固定、一个顺时针旋转，每转一格做一次内积；转过头的部分"绕回来"继续参与运算。' },
          { t: 'md', md: '循环卷积的真正价值在于它与 DFT 的关系——**时域循环卷积等于频域逐点相乘**：' },
          { t: 'math', tex: 'x[n]\\circledast_N h[n] \\;\\longleftrightarrow\\; X[k]\\cdot H[k],\\qquad k=0,\\dots,N-1', tag: '(5)' },
          { t: 'callout', kind: 'tip', title: '为什么恰好是"循环"而不是"线性"', md: '因为 DFT 本身隐含**周期延拓**假设：$N$ 点 DFT 把输入看成周期为 $N$ 的无限长序列。在这个周期世界里，时间下标天然是按模 $N$ 循环的，于是配对出来的卷积必然是循环的。记住这条因果链：**DFT 的周期性 → 循环卷积 → 频域相乘**，一切快速卷积算法都是这条链的推论。' },
          {
            t: 'fold', summary: '展开：由 DFT 的周期卷积定理推出式 (5)', deriv: true, blocks: [
              { t: 'md', md: '设 $x,h$ 均为 $N$ 点序列。由 IDFT 写出 $y_c[n]=\\frac{1}{N}\\sum_k Y[k]e^{j2\\pi kn/N}$，把 $Y[k]=X[k]H[k]$ 代入，并将 $X[k]=\\sum_m x[m]e^{-j2\\pi km/N}$ 展开：' },
              { t: 'math', tex: 'y_c[n] = \\frac{1}{N}\\sum_{k=0}^{N-1}\\left(\\sum_{m=0}^{N-1}x[m]e^{-j\\frac{2\\pi km}{N}}\\right)\\!H[k]\\,e^{j\\frac{2\\pi kn}{N}}' },
              { t: 'md', md: '交换求和次序，并把 $H[k]e^{j2\\pi k(n-m)/N}$ 视为 $h$ 的循环移位对应的 DFT，利用正交性 $\\frac{1}{N}\\sum_k e^{j2\\pi k(n-m-r)/N}=\\delta[(n-m-r)\\!\\!\\mod N]$，即得 $y_c[n]=\\sum_m x[m]h[(n-m)\\!\\!\\mod N]$，正是式 (4)。' }
            ]
          }
        ]
      },
      {
        id: 'alias', num: '4', title: '二者何时相同：补零到 N ≥ M+L−1',
        blocks: [
          { t: 'math', tex: 'y_c[n] = \\sum_{m=-\\infty}^{\\infty} y_{lin}[n+mN],\\qquad n = 0,1,\\dots,N-1', tag: '(6)' },
          { t: 'md', md: '这条式子是本节的核心：**循环卷积就是把线性卷积以 $N$ 为周期折叠相加**。当线性卷积只有 $M+L-1$ 个非零样点且 $N\\ge M+L-1$ 时，求和里只剩 $m=0$ 一项，两者完全相同；否则尾部会"绕回来"叠加到头部，这就是**循环卷积混叠**。' },
          {
            t: 'fold', summary: '展开：式 (6) 的显式拆解', deriv: true, blocks: [
              { t: 'md', md: '把式 (4) 中的取模展开：$h[(n-k)\\!\\!\\mod N] = \\sum_m h[n-k+mN]$（周期延拓的冲激串表示）。代入得' },
              { t: 'math', tex: 'y_c[n] = \\sum_{k=0}^{N-1} x[k]\\sum_{m} h[n-k+mN] = \\sum_m \\underbrace{\\sum_k x[k]h[(n+mN)-k]}_{y_{lin}[n+mN]} = \\sum_m y_{lin}[n+mN]' },
              { t: 'md', md: '于是每个输出样点都是线性卷积中相隔 $N$ 的那些样点之和。混叠量可以显式写出来：若 $L+M-1 = N + r$，则前 $r$ 个样点被污染，其余 $N-r$ 个样点保持纯净。这一结论直接给出**重叠保留法**的丢弃规则。' }
            ]
          },
          {
            t: 'plot', title: '同一对序列：线性卷积 vs 两种循环卷积长度（L=6, M=3）', height: 265,
            render: function (canvas) {
              const x = Float64Array.from([1, 2, 3, 2, 1, 0.5]);
              const h = Float64Array.from([0.5, 1, 0.5]);
              const yl = C.conv(x, h);               // 长度 8
              const y8 = C.cconv(x, h, 8);           // N=8 ≥ 8，无混叠
              const y6 = C.cconv(x, h, 6);           // N=6 < 8，尾部 2 点折回
              const p = DSP.plot.new(canvas, { height: 265, xlabel: 'n', ylabel: '幅度', legend: true, legendPos: 'tr' });
              p.add({ x: U.arange(yl.length), y: Array.from(yl), type: 'stem', color: 0, width: 1.8, label: '线性卷积（长度 8）' })
                .add({ x: U.arange(8), y: Array.from(y8), type: 'scatter', color: 1, size: 4, label: '循环卷积 N=8（完全相同）' })
                .add({ x: U.arange(6), y: Array.from(y6), type: 'scatter', color: 2, size: 5, label: '循环卷积 N=6（发生混叠）' })
                .draw();
            }
          },
          { t: 'md', md: '图中红色方块在 $n=0,1$ 处明显偏离：因为 $N=6$ 时线性卷积的第 6、7 号样点被折回来加到了第 0、1 号上。第 2~5 号样点则完全一致——这与"前 $r=2$ 个样点被污染"的预测精确吻合。' },
          { t: 'callout', kind: 'eng', title: '工程上补零到底补到多少', md: '做快速卷积时补零长度必须满足 $N\\ge L+M-1$，实际取**大于等于该值的 2 的幂**（FFT 效率最高）。若输入是长数据流、$h$ 长度 $M$ 固定，则不要无限补零，而应分段处理（见第 5 节）。一个常见经验：当 $M$ 在 32~512 之间、数据长度远大于 $M$ 时，分段 FFT 卷积通常比直接卷积快 3~10 倍。' }
        ]
      },
      {
        id: 'ola', num: '5', title: '用 FFT 做长序列卷积：重叠相加与重叠保留',
        blocks: [
          { t: 'md', md: '长数据流与固定冲激响应卷积，不能直接补到全长的 2 的幂（内存与延迟都受不了），必须**分段**。两种经典做法只在"怎么处理段间衔接"上不同。' },
          { t: 'flow', v: true, items: [
            { t: '分段', d: '把长序列切成互不重叠的 $L_s$ 长块' },
            { t: '补零至 N ≥ Ls + M − 1', d: '每块与 $h$ 各自补零到同一长度 $N$（取 2 的幂）' },
            { t: '频域相乘', d: '$\\mathrm{FFT}\\rightarrow$ 逐点乘 $H[k]\\rightarrow \\mathrm{IFFT}$，$H[k]$ 只算一次' },
            { t: '段间衔接', d: 'OLA：尾部 $M-1$ 点**相加**；OLS：头部 $M-1$ 点**丢弃**' },
            { t: '拼接输出', d: '得到与直接线性卷积完全一致的完整输出' }
          ] },
          { t: 'table', cols: ['方法', '输入分段', '关键操作', '丢弃/相加', '适用'], rows: [
            ['重叠相加 OLA', '不重叠，每段 $L_s$', '每段卷积后长度 $L_s+M-1$', '相邻段重叠的 $M-1$ 点相加', '通用，最易实现'],
            ['重叠保留 OLS', '重叠 $M-1$ 点，每段取 $N$', '循环卷积取后 $N-M+1$ 点', '丢弃每段前 $M-1$ 个污染点', '省掉加法，硬件更省']
          ] },
          { t: 'callout', kind: 'note', title: '为什么 OLS 的丢弃规则是"前 M−1 点"', md: '由第 4 节的结论直接推出：段长 $N$、有效卷积长度 $L_s+M-1$，超出部分 $r=(L_s+M-1)-N$。若取 $N=L_s+M-1$ 做线性卷积就不存在污染；OLS 取 $N=L_s$，则 $r=M-1$，恰好前 $M-1$ 点被污染，扔掉即可。所以 OLS 的输入必须**重叠 $M-1$ 点**来补偿被丢弃的部分。' },
          codeBlock(
              "import numpy as np\n\n"
              + "# 分段 FFT 卷积（重叠相加），结果与 np.convolve(x, h) 完全一致\n"
              + "def ola_convolve(x, h, block=1024):\n"
              + "    M = len(h)\n"
              + "    N = 1 << int(np.ceil(np.log2(block + M - 1)))   # 补零到 2 的幂\n"
              + "    H = np.fft.rfft(h, N)                          # 频域系数只算一次\n"
              + "    out = np.zeros(len(x) + M - 1)\n"
              + "    pos = 0\n"
              + "    for s in range(0, len(x), block):\n"
              + "        seg = x[s:s + block]\n"
              + "        y = np.fft.irfft(np.fft.rfft(seg, N) * H, N)  # 长度 N\n"
              + "        out[pos:pos + len(seg) + M - 1] += y[:len(seg) + M - 1]\n"
              + "        pos += len(seg)\n"
              + "    return out\n",
              'python', '重叠相加法（OLA）参考实现'),
          { t: 'callout', kind: 'eng', title: '声呐/雷达里的实际用法', md: '脉冲压缩本质上就是"长回波序列 × 固定参考函数"的卷积，接收数据流是连续不断的。工程上通常在 FPGA 里做**频域脉压**：把参考函数预存为 $H[k]$，每帧数据做一次 FFT → 复乘 → IFFT，段间按 OLA 相加。这样做的原因是 $M$（参考函数长度）往往高达数千点，时域 FIR 需要数千个乘法器，而频域方案只需几个 FFT 核。注意：**频域脉压等效于循环卷积**，必须保证补零长度足够，否则远量程的强回波会绕回来污染近量程——这是新手最容易犯且最难查的错误。' }
        ]
      },
      {
        id: 'fast', num: '6', title: 'FFT 并不总是更快：复杂度、延迟与选择',
        blocks: [
          { t: 'table', cols: ['方式', '乘法量级', '何时占优', '代价'], rows: [
            ['直接时域卷积', '$M\\cdot L$ 次乘加', '$M$ 很小（< 32）或 $L$ 与 $M$ 同量级且都不大', '无额外内存，无批量延迟'],
            ['FFT 快速卷积', '$3N\\log_2 N$（$N$ 为补零后长度）', '$M$ 较大、$L\\gg M$', '需要缓存一整块 + 批延迟'],
            ['分段 FFT（OLA/OLS）', '每块 $3N\\log_2 N$', '长数据流、实时系统', '延迟 = 块长度，需处理段间衔接']
          ] },
          {
            t: 'plot', title: '计算量对比：直接卷积 vs FFT 卷积（取 L = 4096 固定）', height: 250,
            render: function (canvas) {
              const L = 4096;
              const Ms = [8, 16, 32, 64, 128, 256, 512, 1024];
              const direct = Ms.map(M => M * L);
              const fftc = Ms.map(M => {
                let N = 1; while (N < L + M - 1) N <<= 1;
                return 3 * N * Math.log2(N);
              });
              const p = DSP.plot.new(canvas, { height: 250, xlabel: '冲激响应长度 M', ylabel: '乘加次数', legend: true, legendPos: 'tl', logY: false });
              p.add({ x: Ms, y: direct, color: 0, width: 1.8, label: '直接卷积 M·L' })
                .add({ x: Ms, y: fftc, color: 2, width: 1.8, dash: [5, 3], label: 'FFT 卷积 3N·log₂N' })
                .draw();
            }
          },
          { t: 'md', md: '曲线显示：当 $M$ 小于约 32~64 时，直接卷积更划算；$M$ 增大后 FFT 方案的增长极为平缓（对数级），迅速反超。这就是"短滤波器直接卷、长滤波器用 FFT"的定量依据。' },
          { t: 'metrics', list: [
            { label: '直接卷积交叉点', value: 'M ≈ 32~64', unit: '（L = 4096 时）' },
            { label: 'FFT 卷积延迟', value: '一块', unit: 'N / f_s 秒' },
            { label: '频率系数复用', value: 'H[k] 只算一次', unit: '固定滤波器' },
            { label: '额外内存', value: 'O(N)', unit: '输入输出缓冲' }
          ] },
          { t: 'callout', kind: 'warn', title: '延迟是实时系统的硬约束', md: 'FFT 卷积必须等一整块数据到齐才能算，这对声呐主动探测意味着**最小作用距离**：块长 $N/f_s$ 秒对应的盲区距离为 $c\\cdot N/(2f_s)$。若 $f_s=100$ kHz、$N=8192$，盲区就有 $1500\\times0.08192/2 \\approx 61$ m。设计时必须把块长、盲区、运算量三者一起权衡。' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 直接用 DFT 相乘当卷积，忘了补零', md: '最常见的错误：`Y = ifft(fft(x) * fft(h))`，其中两个序列长度相同且未补零。得到的不是线性卷积，而是循环卷积——尾部会折回头部。正确做法是先补零到 $N\\ge L+M-1$。**症状**：输出开头几个点偏大，且滤波器越长越明显。' },
          { t: 'callout', kind: 'pit', title: '② 以为 FFT 一定比直接卷积快', md: '短序列（$M<32$）直接卷积通常更快，还没有内存与延迟开销。另外 FFT 的长度是 2 的幂，会向上取整，如果 $L+M-1$ 刚好比某个 2 的幂大一点点，补零后长度翻倍，反而亏。**先算数量级，再选算法。**' },
          { t: 'callout', kind: 'pit', title: '③ 混淆 full / same / valid 导致时延错位', md: '`full` 长 $L+M-1$、`same` 取中心段（偏移 $\\lfloor(M-1)/2\\rfloor$）、`valid` 只保留完全重叠部分（长 $L-M+1$）。做**测距**时如果用 `same` 又忘了减掉 $(M-1)/2$ 的群延迟，测出的距离会系统性偏移 $c(M-1)/(4f_s)$。这在匹配滤波测距里是致命的低级错误。' },
          { t: 'callout', kind: 'pit', title: '④ 认为循环卷积只是"数学上的怪胎"', md: '循环卷积是 DFT 世界里的**原生运算**，OFDM 的循环前缀就是刻意把线性信道卷积变成循环卷积，从而让频域单点均衡成立。理解它才能理解现代通信与水声 OFDM。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, Discrete-Time Signal Processing, 3rd ed., 第 2、8 章',
      'Proakis & Manolakis, Digital Signal Processing, 第 4 章（卷积与块卷积）',
      '程佩青《数字信号处理教程》第 3 章'
    ]
  });

  /* ============================================================
     2. FIR 滤波器
     ============================================================= */
  reg('theory/filter/fir', {
    title: 'FIR 滤波器',
    lede: '有限长冲激响应 = 天然稳定 + 可做到严格线性相位 + 无反馈振荡。代价是阶数高、延迟大。搞清楚这三条收益和两条代价，就知道什么时候该咬牙用 FIR。',
    tags: ['滤波', 'FIR', '线性相位', '群延迟', '零相位滤波'],
    labs: [
      { path: 'lab/fir', title: 'FIR 滤波器设计实验台', desc: '改阶数与窗函数，实时看幅频、相频与滤波前后波形' },
      { path: 'lab/conv', title: '卷积交互实验台', desc: '从卷积角度理解 FIR 的滑动加权平均本质' }
    ],
    toc: true,
    sections: [
      {
        id: 'diff', num: '1', title: '差分方程与非递归结构',
        blocks: [
          { t: 'math', tex: 'y[n] = \\sum_{k=0}^{M} b_k\\,x[n-k] \\;=\\; \\sum_{k=0}^{M} h[k]\\,x[n-k]', tag: '(1)' },
          { t: 'md', md: 'FIR（Finite Impulse Response）的定义就一条：**冲激响应只有有限个非零样点**。因为输出不反馈回输入（分母恒为 1），它也叫**非递归**滤波器。差分方程里 $b_k$ 与 $h[k]$ 是同一个东西——对 $\\delta[n]$ 输入，输出依次吐出 $b_0,b_1,\\dots,b_M$ 后归零。' },
          { t: 'flow', items: [
            { t: 'x[n]', kind: 'io', d: '输入采样' },
            { t: 'z⁻¹ 延迟链', kind: 'dsp', d: 'M 级寄存器' },
            { t: '乘 b_k', kind: 'dsp', d: 'M+1 个乘法器' },
            { t: '加法树', kind: 'dsp', d: '累加' },
            { t: 'y[n]', kind: 'out', d: '输出' }
          ] },
          { t: 'kv', title: '变量说明', pairs: [
            ['M', 'FIR 阶数（order），抽头数 $N=M+1$'],
            ['h[k] = bₖ', '第 $k$ 个抽头系数，也是冲激响应第 $k$ 点'],
            ['H(z)', '$=\\sum_{k=0}^{M} b_k z^{-k}$，分母为 1，极点只在 $z=0$']
          ] },
          { t: 'callout', kind: 'note', title: '极点全在原点的含义', md: 'FIR 的系统函数 $H(z)=\\frac{\\sum b_k z^{-k}}{1}$，写成 $z$ 的正幂形式后所有极点都在 $z=0$（原点），而原点永远在单位圆内。这就是 FIR"天然稳定"的代数解释——不需要任何额外条件。' }
        ]
      },
      {
        id: 'prop', num: '2', title: '有限长 h[n] 的三条推论',
        blocks: [
          { t: 'md', md: '从"有限长"这一个前提，可以推出 FIR 的三条工程上极其重要的性质：' },
          { t: 'md', md: '1. **天然稳定**：任何有限长序列都绝对可和，故 BIBO 稳定无条件成立。\n2. **可实现严格线性相位**：只要系数对称或反对称，相位就是 $\\omega$ 的一次函数，群延迟为常数。\n3. **无反馈**：量化误差不会被循环放大，不存在极限环，对系数量化极不敏感。' },
          {
            t: 'fold', summary: '展开：由有限长推出 BIBO 稳定', deriv: true, blocks: [
              { t: 'md', md: '设有界输入 $|x[n]|\\le B_x < \\infty$。输出满足' },
              { t: 'math', tex: '|y[n]| = \\left|\\sum_{k=0}^{M} h[k]x[n-k]\\right| \\le \\sum_{k=0}^{M}|h[k]|\\,|x[n-k]| \\le B_x\\sum_{k=0}^{M}|h[k]|' },
              { t: 'md', md: '因为 $h[k]$ 只有 $M+1$ 个有限值，$\\sum_{k=0}^{M}|h[k]|$ 必为有限常数，故 $|y[n]|\\le B_x\\cdot C < \\infty$，稳定得证。对比 IIR：那里求和上限是无穷，$\\sum|h[n]|$ 是否收敛取决于极点位置，稳定性变成一个必须逐次检验的条件。' }
            ]
          },
          { t: 'callout', kind: 'eng', title: '为什么"无极限环"这么重要', md: 'IIR 有反馈，即使输入归零，寄存器里的量化残差也可能自持振荡（极限环），表现为"输入静默时仍有小幅输出"。在被动声呐这种要看极微弱信号的场合，极限环就是伪信号。FIR 没有反馈路径，**输入归零后最多 $M$ 个采样点输出必然归零**，这点让它在高可靠系统里无可替代。' }
        ]
      },
      {
        id: 'lptypes', num: '3', title: '四种线性相位类型与它们的固有零点',
        blocks: [
          { t: 'md', md: '若系数满足对称 $h[n]=h[M-n]$ 或反对称 $h[n]=-h[M-n]$，则频率响应可写成幅度函数乘一个纯延迟因子：' },
          { t: 'math', tex: 'H(e^{j\\omega}) = A(\\omega)\\,e^{-j\\omega\\alpha},\\qquad \\alpha = \\frac{M}{2},\\quad A(\\omega)\\ \\text{为实函数}', tag: '(2)' },
          { t: 'md', md: '按"对称/反对称 × 阶数奇偶"组合，共四种类型。它们的差别不是学术细节——**每一类都有被强制的零点，直接决定它能做什么、不能做什么**。' },
          { t: 'table', cols: ['类型', '对称性', '阶数 M（抽头数 M+1）', 'α = M/2', '固有零点', '适用'], rows: [
            ['I 型', '对称', '偶数（长度奇数）', '整数 $M/2$', '无强制零点', '低通/高通/带通/带阻，最通用'],
            ['II 型', '对称', '奇数（长度偶数）', '半整数 $M/2$', '$z=-1$（$\\omega=\\pi$）必为零点', '低通/带通，**不能做高通**'],
            ['III 型', '反对称', '偶数（长度奇数）', '整数 $M/2$', '$z=\\pm1$ 均为零点', '微分器、希尔伯特变换器'],
            ['IV 型', '反对称', '奇数（长度偶数）', '半整数 $M/2$', '$z=1$（$\\omega=0$）必为零点', '微分器、希尔伯特变换器，**不能做低通**']
          ] },
          {
            t: 'plot', title: '真实计算：I 型低通、II 型"高通"、IV 型希尔伯特变换器的幅频', height: 270,
            render: function (canvas) {
              const nfft = 1024;
              const hI = C.firWin({ order: 40, type: 'low', fc: 0.2, win: 'hamming' });
              const hII = C.firWin({ order: 41, type: 'high', fc: 0.2, win: 'hamming' });
              // IV 型：反对称希尔伯特变换器 h[d] = (1 − cos(πd)) / (πd)，加汉明窗
              const N4 = 40, a4 = (N4 - 1) / 2;
              const w4 = C.window('hamming', N4);
              const hIV = new Float64Array(N4);
              for (let n = 0; n < N4; n++) {
                const d = n - a4;
                hIV[n] = (Math.abs(d) < 1e-12 ? 0 : (1 - Math.cos(Math.PI * d)) / (Math.PI * d)) * w4[n];
              }
              const fI = C.freqz(Array.from(hI), [1], nfft, 1);
              const fII = C.freqz(Array.from(hII), [1], nfft, 1);
              const fIV = C.freqz(Array.from(hIV), [1], nfft, 1);
              const nI = halfDb(fI), nII = halfDb(fII), nIV = halfDb(fIV);
              let mx = -200; for (let i = 0; i < nIV.y.length; i++) mx = Math.max(mx, nIV.y[i]);
              const yIV = Array.from(nIV.y).map(v => v - mx);
              const p = DSP.plot.new(canvas, { height: 270, xlabel: '归一化频率 f / f_s', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-90, 5], xlim: [0, 0.5] });
              p.add({ x: Array.from(nI.x), y: Array.from(nI.y), color: 0, width: 1.7, label: 'I 型低通（order 40）' })
                .add({ x: Array.from(nII.x), y: Array.from(nII.y), color: 2, width: 1.7, label: 'II 型高通（order 41，ω=π 处恒为 0）' })
                .add({ x: Array.from(nIV.x), y: yIV, color: 3, width: 1.7, dash: [5, 3], label: 'IV 型希尔伯特（ω=0 处恒为 0）' })
                .draw();
            }
          },
          { t: 'md', md: '注意红色曲线在 $f/f_s=0.5$（即 $\\omega=\\pi$）处被死死钉在极低的电平上——**II 型做不了高通**，这是它对称结构带来的强制零点，换窗、加阶数都救不回来。同理 IV 型（虚线）在 $f=0$ 处恒为零，做不了低通。' },
          {
            t: 'fold', summary: '展开：为什么 II 型在 z = −1 必有零点', deriv: true, blocks: [
              { t: 'md', md: 'II 型：$M$ 为奇数，长度 $N=M+1$ 为偶数，系数对称 $h[n]=h[M-n]$。把 $H(z)=\\sum_{n=0}^{M}h[n]z^{-n}$ 在 $z=-1$ 处求值：' },
              { t: 'math', tex: 'H(-1) = \\sum_{n=0}^{M} h[n](-1)^{-n} = \\sum_{n=0}^{M} h[n](-1)^{n}' },
              { t: 'md', md: '把对称的两两配对：$n$ 与 $M-n$。因为 $M$ 是奇数，$n$ 与 $M-n$ 的奇偶性相反，故 $(-1)^{n}$ 与 $(-1)^{M-n}$ 符号相反；而 $h[n]=h[M-n]$ 数值相同。每一对的和为 $h[n]\\left[(-1)^n+(-1)^{M-n}\\right]=0$。全部配对后 $H(-1)=0$，即 $z=-1$ 是零点。' },
              { t: 'md', md: '对 III 型（反对称、$M$ 偶），同理可得 $H(1)=0$ 且 $H(-1)=0$；对 IV 型（反对称、$M$ 奇）可得 $H(1)=0$。这些结论与设计方法无关，是**结构决定的**，因此选型时必须先看类型表。' }
            ]
          },
          { t: 'callout', kind: 'eng', title: '选型的实操规则', md: '要低通/带通 → 用 I 型（长度取奇数，最通用）。要高通 → 长度必须取奇数（I 型），**千万别用偶数长度**。要微分器或希尔伯特变换器 → 用 III/IV 型反对称结构。写设计代码时把"长度奇偶"作为显式参数检查一遍，能省下几小时的调试。' }
        ]
      },
      {
        id: 'struct', num: '4', title: '转置型结构、乘法器数量与 FPGA 实现要点',
        blocks: [
          { t: 'table', cols: ['结构', '乘法器数', '加法器数', '关键路径', '特点'], rows: [
            ['直接型（抽头延迟线）', '$M+1$', '$M$', '$M$ 级加法链', '直观，但加法链长、时钟频率受限'],
            ['转置型', '$M+1$', '$M$', '1 乘 + 1 加', '输入广播、寄存器在加法后，易流水，FPGA 首选'],
            ['对称结构（线性相位）', '$\\lceil(M+1)/2\\rceil$', '略增', '同转置型', '先做对称**预加**再乘，乘法器省一半'],
            ['分布式算法 DA', '0（查表）', '移位累加', '与位宽成正比', '系数固定时极省资源，适合低位宽高速']
          ] },
          { t: 'md', md: '转置型（transposed direct form）与直接型互为信号流图转置，传递函数完全相同。区别在**关键路径**：直接型的输入要经过长长的加法链才到输出；转置型把寄存器挪到加法器之后，每一级只有"一个乘法 + 一个加法"，插入流水线寄存器几乎不增加成本，因此可以跑很高的时钟。' },
          { t: 'metrics', list: [
            { label: 'order = 128 直接型', value: '129', unit: '个乘法器' },
            { label: 'order = 128 对称型', value: '65', unit: '个乘法器' },
            { label: '省下的资源', value: '≈ 50', unit: '% DSP 单元' },
            { label: '群延迟', value: 'M/2 = 64', unit: '采样点' }
          ] },
          { t: 'callout', kind: 'eng', title: 'FPGA / DSP 上的落地要点', md: '1. **先做对称预加**：线性相位 FIR 的 $h[k]=h[M-k]$，把 $x[n-k]+x[n-(M-k)]$ 先加好再乘一个系数，乘法器直接减半，这是最高性价比的一步。\n2. **用转置型 + 流水**：Xilinx DSP48E / Intel 的硬乘法器内部自带寄存器，把乘法器和加法器的寄存器都用满，跑 300 MHz 以上很常见。\n3. **位增长要留够**：$M+1$ 项累加最多带来 $\\log_2(M+1)$ 位的增长，累加器位宽 = 输入位宽 + 系数位宽 + $\\lceil\\log_2(M+1)\\rceil$。\n4. **系数存块 RAM**：多通道共用同一组系数时，把系数放在 BRAM，靠时分复用一套乘法器服务多个通道。\n5. **定点化后必须复测**：系数截断会抬高阻带电平，通常 16 bit 系数足够做到 −80 dB 以下，12 bit 只能到约 −60 dB。' }
        ]
      },
      {
        id: 'gd', num: '5', title: '群延迟 M/2 与 filtfilt 零相位滤波',
        blocks: [
          { t: 'math', tex: '\\tau_g(\\omega) = -\\frac{d\\theta(\\omega)}{d\\omega} = \\frac{M}{2}\\ \\text{（样点）} \\quad\\Longrightarrow\\quad \\tau_{sec} = \\frac{M}{2f_s}\\ \\text{秒}', tag: '(3)' },
          { t: 'md', md: '线性相位 FIR 的相位是 $\\theta(\\omega)=-\\omega M/2$，其导数恒定，所以**所有频率分量被延迟完全相同的时间**。这一点在物理上等价于"波形整体平移，形状不变"。' },
          {
            t: 'plot', title: '同一个高斯脉冲：普通滤波 vs 零相位滤波（filtfilt）', height: 260,
            render: function (canvas) {
              const fs = 48000, n = 400, M = 64;
              const x = C.gaussPulse(n, fs, 3000, 900, 0.003);
              const b = Array.from(C.firWin({ order: M, type: 'low', fc: 0.12, win: 'hamming' }));
              const y1 = C.filter(b, [1], x);
              const y2 = C.filtfilt(b, [1], x);
              const t = U.linspace(0, n / fs * 1000, n);
              const xt = Array.from(t);
              const p = DSP.plot.new(canvas, { height: 260, xlabel: 't / ms', ylabel: '幅度', legend: true, legendPos: 'tr' });
              p.add({ x: xt, y: Array.from(x), color: 3, width: 1.4, dash: [4, 3], label: '原始脉冲' })
                .add({ x: xt, y: Array.from(y1), color: 1, width: 1.8, label: 'filter()：峰值被推迟 M/2 = 32 点' })
                .add({ x: xt, y: Array.from(y2), color: 0, width: 1.8, label: 'filtfilt()：零相位，峰值对齐' })
                .draw();
            }
          },
          { t: 'md', md: '橙色曲线整体右移了 $M/2=32$ 个采样点；蓝色（filtfilt）峰值与原始脉冲对齐，但代价是幅度变为原来的平方（通带增益变成 $|H|^2$），且**它必须拿到全部数据才能开始反序滤波**。' },
          { t: 'callout', kind: 'note', title: 'filtfilt 为什么是零相位', md: '第一次正向滤波给出 $Y_1(e^{j\\omega})=H(e^{j\\omega})X(e^{j\\omega})$。把结果**反转**再做一次同样的滤波，时域反转对应频域相位共轭，于是总响应为 $H(e^{j\\omega})H^*(e^{j\\omega})=|H(e^{j\\omega})|^2$，相位恒为零。代价是幅度变成 $|H|^2$（通带波动翻倍、阻带衰减翻倍，通常按 $\\sqrt{\\cdot}$ 补偿或设计更严格的指标）。' },
          { t: 'callout', kind: 'danger', title: 'filtfilt 绝对不能用于实时处理', md: '它需要先拿到**整段数据**再反向跑一遍。在实时声呐/雷达链路里，$\\alpha=M/2$ 的群延迟只能**补偿**不能消除：把已知延迟从测距结果里减掉（$\\Delta R = -c\\alpha/(2f_s)$），或者在多通道间保证所有通道用同一个滤波器使延迟一致。**以为"用 filtfilt 就能实时零相位"是最典型的误区。**' },
          { t: 'callout', kind: 'eng', title: '声呐测距里的延迟账', md: '若 $f_s=100$ kHz、FIR 阶数 $M=200$，群延迟 $=100$ 点 $=1$ ms，对应距离偏差 $1500\\times0.001/2 = 0.75$ m。对测深声呐而言 0.75 m 是巨大误差。**每一条滤波链路都要把群延迟计入时延预算**，并且所有通道（尤其是波束形成的各阵元）必须使用完全相同的滤波器，否则延迟不一致会直接破坏相位关系。' }
        ]
      },
      {
        id: 'pros', num: '6', title: 'FIR 的优缺点与选型',
        blocks: [
          { t: 'table', cols: ['维度', 'FIR', '说明'], rows: [
            ['稳定性', '无条件稳定', '极点全在原点'],
            ['相位', '可做到严格线性相位', '波形保真，测距/脉压首选'],
            ['有限字长', '对量化不敏感、无极限环', '定点实现安全'],
            ['阶数', '高（同等陡度约为 IIR 的 5~10 倍）', '算力与延迟成本高'],
            ['延迟', '$(N-1)/2$ 个样点，与阶数成正比', '实时闭环系统受限'],
            ['设计灵活性', '可任意形状幅频（等波纹最优）', 'Remez / 最小二乘 / 窗函数法'],
            ['多速率', '易做多相分解，抽取/插值高效', '半带滤波器省一半乘法']
          ] },
          { t: 'md', md: '选型口诀：**要相位线性、要绝对稳定、要多相多速率、要做匹配滤波的参考函数 → FIR；要极低阶数、极窄过渡带、对延迟不敏感、允许相位失真 → IIR。** 在雷达/声呐中，脉冲压缩、波束形成、抗混叠、抽取滤波基本都用 FIR；而窄带预选、慢变包络平滑、控制环路里的陷波器会用 IIR。' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 以为零相位滤波（filtfilt）可以实时实现', md: '它需要整段数据反序再滤一次，本质上非因果。实时系统的正确做法是接受并补偿群延迟，或者用前向-后向分块处理（仍然有块延迟）。' },
          { t: 'callout', kind: 'pit', title: '② 忽略群延迟导致测距系统性偏差', md: '滤波后峰值位置被推迟 $M/2$ 点，距离偏大 $cM/(4f_s)$。用 `same` 模式或手动减掉 $\\alpha$ 都能解决，但**必须显式处理**，不能假设"反正是个小量"。' },
          { t: 'callout', kind: 'pit', title: '③ 用偶数长度设计高通', md: 'II 型（长度偶数、系数对称）在 $\\omega=\\pi$ 有强制零点，高通会完全失败。改成长度奇数（I 型）即可，或者改用 IIR。' },
          { t: 'callout', kind: 'pit', title: '④ 以为"阶数越高越好"', md: '阶数升高带来三段代价：群延迟线性增大（实时性差）、乘法量线性增大、通带波纹并不会消失（只由设计方法决定）。而且数值上高阶 FIR 的系数动态范围极大，定点实现时小系数会被吃掉。**先定指标，再定阶数，不要凭感觉加阶。**' },
          { t: 'callout', kind: 'pit', title: '⑤ 认为 FIR 一定会让信号"看起来更好"', md: 'FIR  filtering 会把脉冲波形的主瓣展宽（低通削掉高频），测距分辨率反而下降。滤波器永远在"去噪"与"保真"之间做交换，加滤波前先问一句：我要保的是能量还是波形？' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 7 章（FIR 与线性相位）',
      'Parks & Burrus, Digital Filter Design（线性相位四种类型）',
      'Lyons, Understanding Digital Signal Processing, 第 5–6 章（FIR 结构与实现）'
    ]
  });

  /* ============================================================
     3. IIR 滤波器
     ============================================================= */
  reg('theory/filter/iir', {
    title: 'IIR 滤波器',
    lede: '有反馈，所以能用 6 阶做到 FIR 上百阶才有的陡峭滚降；也因为有反馈，极点一旦跑出单位圆就自激。理解 IIR 就是在理解"极点、稳定性、相位失真"这三件事。',
    tags: ['滤波', 'IIR', '零极点', '稳定性', 'SOS 级联', '相位失真'],
    labs: [
      { path: 'lab/zplane', title: 'Z 平面零极点实验台', desc: '拖动零极点，直观看到极点在单位圆内外对稳定性与幅频的影响' },
      { path: 'lab/fir', title: 'FIR 设计实验台', desc: '与 IIR 做同指标对比：阶数、相位、群延迟' }
    ],
    toc: true,
    sections: [
      {
        id: 'diff', num: '1', title: '递归结构：差分方程与系统函数',
        blocks: [
          { t: 'math', tex: 'y[n] = \\sum_{k=0}^{M} b_k\\,x[n-k] \\;-\\; \\sum_{k=1}^{N} a_k\\,y[n-k]', tag: '(1)' },
          { t: 'math', tex: 'H(z) = \\frac{Y(z)}{X(z)} = \\frac{\\sum_{k=0}^{M} b_k z^{-k}}{1+\\sum_{k=1}^{N} a_k z^{-k}} = g\\,\\frac{\\prod_{i=1}^{M}(1-z_i z^{-1})}{\\prod_{i=1}^{N}(1-p_i z^{-1})}', tag: '(2)' },
          { t: 'md', md: '与 FIR 的唯一结构性差别是**分母不再是 1**：输出被反馈回输入。这一改动带来两件大事：$h[n]$ 变成无限长（IIR 之名由此而来），系统出现了真正的极点 $p_i$，它们既带来极高的频率选择性，也带来了稳定性与相位的问题。' },
          { t: 'kv', title: '变量说明', pairs: [
            ['bₖ', '前馈（分子）系数，决定零点位置'],
            ['aₖ', '反馈（分母）系数，决定极点位置'],
            ['pᵢ、zᵢ', '极点与零点；$g$ 为增益'],
            ['N', '滤波器阶数（IIR 中分子分母阶数可不同）']
          ] },
          { t: 'callout', kind: 'note', title: '极点的物理意义：谐振', md: '极点在 $z=p$（$|p|$ 接近 1）处，相当于系统在该频率上有一个高 $Q$ 的谐振器：输入能量被反复"回响"累积，于是幅频在靠近它的频率处被强烈放大。零点的镜像作用则是把某个频率彻底抵消（陷波）。**IIR 的全部设计艺术，就是把零极点摆在正确的位置上。**' }
        ]
      },
      {
        id: 'why', num: '2', title: '为什么低阶就能做出陡峭滚降',
        blocks: [
          { t: 'md', md: 'FIR 只靠"很多个抽头的加权平均"堆出选择性，阶数与过渡带宽近似成反比。IIR 靠**反馈谐振**：一个靠近单位圆的极点就能在某个频段产生极大的增益起伏，于是六七个极点拼起来就能做出很陡的边沿。' },
          {
            t: 'plot', title: '真实计算：4 阶 Butterworth IIR 与不同阶数 FIR 的幅频对比', height: 270,
            render: function (canvas) {
              const fs = 1, fc = 0.15, nfft = 1024;
              const wd = 2 * Math.PI * fc;
              const wc = 2 / fs * Math.tan(wd / 2);          // 频率预畸变
              const ps = butterPoles(4, wc).map(s => C.bilinearZeros(s, fs));
              const zs = [{ re: -1, im: 0 }, { re: -1, im: 0 }, { re: -1, im: 0 }, { re: -1, im: 0 }];
              const ba = zp2ba(zs, ps);
              const fI = C.freqz(ba.b, ba.a, nfft, fs);
              const hI = halfDb(fI, fs);
              const p = DSP.plot.new(canvas, { height: 270, xlabel: '归一化频率 f / f_s', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-100, 5], xlim: [0, 0.5] });
              p.add({ x: Array.from(hI.x), y: Array.from(hI.y), color: 2, width: 2, label: 'IIR：4 阶 Butterworth' });
              [40, 120].forEach((ord, i) => {
                const b = Array.from(C.firWin({ order: ord, type: 'low', fc: fc, win: 'hamming' }));
                const f = C.freqz(b, [1], nfft, fs);
                const hd = halfDb(f, fs);
                p.add({ x: Array.from(hd.x), y: Array.from(hd.y), color: i === 0 ? 0 : 1, width: 1.5, dash: i === 0 ? [5, 3] : [2, 2], label: 'FIR：' + ord + ' 阶' });
              });
              p.vline(fc, { label: 'f_c = 0.15 f_s' }).draw();
            }
          },
          { t: 'md', md: '4 阶 IIR 的滚降已经明显快于 40 阶 FIR；要追上它的过渡带陡度，FIR 通常需要 100~200 阶。换算成算力：4 阶 IIR 约需 10 个乘法器，而 150 阶 FIR（对称结构）约需 76 个——**差一个数量级**。' },
          {
            t: 'fold', summary: '展开：n 阶低通的滚降斜率为什么恰好是 −20n dB/十倍频', deriv: true, blocks: [
              { t: 'md', md: '以 Butterworth 为例，其幅度平方函数为 $|H_a(j\\Omega)|^2 = \\dfrac{1}{1+(\\Omega/\\Omega_c)^{2n}}$。取分贝：' },
              { t: 'math', tex: '20\\log_{10}|H_a| = -10\\log_{10}\\!\\left[1+\\left(\\frac{\\Omega}{\\Omega_c}\\right)^{2n}\\right] \\;\\xrightarrow{\\Omega \\gg \\Omega_c}\\; -20n\\,\\log_{10}\\!\\left(\\frac{\\Omega}{\\Omega_c}\\right)' },
              { t: 'md', md: '当 $\\Omega\\gg\\Omega_c$ 时 1 可以忽略，每十倍频程正好下降 $20n$ dB（$n=6$ 即 −120 dB/dec ≈ −36 dB/oct）。**这就是"极点个数直接兑换成滚降斜率"的定量来源**：每个极点贡献一份 $1/(\\Omega-p)$ 型衰减。' },
              { t: 'md', md: 'FIR 没有极点可兑换（极点全堆在原点），频率选择性只能靠抽头数堆出来——这就是"同等陡度 FIR 需要高一个数量级的阶数"的根本原因。' },
              { t: 'callout', kind: 'warn', title: '兑换的另一面', md: '靠近单位圆的极点给出陡峭滚降的同时，也给出**慢衰减的时域振铃**（衰减时间常数 $\\approx 1/(1-|p|)$ 个样点）。所以滚降越陡的 IIR，脉冲响应拖尾越长、瞬态建立时间越久——做捷变系统（快速切换滤波器）时要特别小心。' }
            ]
          },
          { t: 'table', cols: ['对比项', 'IIR（4~8 阶）', 'FIR（同指标）'], rows: [
            ['乘法器数量', '10 ~ 20', '80 ~ 200'],
            ['群延迟', '小但随频率变化', '大但恒定 $=M/2$'],
            ['相位', '非线性（除非零相位处理）', '可严格线性'],
            ['稳定性', '必须逐次检验极点', '无条件稳定'],
            ['定点实现', '需 SOS 级联 + 高阶位宽', '简单、鲁棒'],
            ['极限环', '存在（输入为零时仍可能振荡）', '不存在']
          ] },
          { t: 'callout', kind: 'eng', title: '什么时候这份"便宜"值得付', md: '在窄带预选滤波器、慢变包络平滑、控制环路的陷波器、音频均衡这些**对波形相位不敏感**的场合，IIR 的低阶优势是压倒性的。而在脉冲压缩、测距、波束形成这些**波形形状就是信息**的场合，省下的乘法器换来的相位失真会直接毁掉结果。判断标准只有一条：**这个滤波器后面的算法，是靠幅度工作还是靠相位工作？**' }
        ]
      },
      {
        id: 'stab', num: '3', title: '稳定性判据：极点必须全部在单位圆内',
        blocks: [
          { t: 'math', tex: '\\text{稳定} \\;\\Longleftrightarrow\\; \\sum_{n=-\\infty}^{\\infty}|h[n]| < \\infty \\;\\Longleftrightarrow\\; \\max_i |p_i| < 1', tag: '(3)' },
          { t: 'md', md: '因果 IIR 稳定的充要条件是**所有极点的模严格小于 1**。同时收敛域（ROC）必须包含单位圆，否则 $H(e^{j\\omega})$ 根本不存在。对 FIR 这条自动成立，对 IIR 它是设计完成后必须做的第一项检查。' },
          {
            t: 'plot', title: '零极点图：稳定（|p| = 0.95）与不稳定（|p| = 1.02）', height: 300,
            render: function (canvas) {
              const ang = 0.35 * Math.PI;
              const p1 = [{ re: 0.95 * Math.cos(ang), im: 0.95 * Math.sin(ang) }, { re: 0.95 * Math.cos(ang), im: -0.95 * Math.sin(ang) }];
              const p2 = [{ re: 1.02 * Math.cos(ang), im: 1.02 * Math.sin(ang) }, { re: 1.02 * Math.cos(ang), im: -1.02 * Math.sin(ang) }];
              const zs = [{ re: -1, im: 0 }, { re: -1, im: 0 }];
              DSP.plot.zplane(canvas, { zeros: zs, poles: p1.concat(p2), height: 300, title: '内侧一对：|p|=0.95（稳定）　外侧一对：|p|=1.02（发散）' });
            }
          },
          {
            t: 'plot', title: '对应冲激响应：半径只差 0.07，结果天壤之别', height: 250,
            render: function (canvas) {
              const ang = 0.35 * Math.PI, n = 80;
              const mk = r => [{ re: r * Math.cos(ang), im: r * Math.sin(ang) }, { re: r * Math.cos(ang), im: -r * Math.sin(ang) }];
              const zs = [{ re: -1, im: 0 }, { re: -1, im: 0 }];
              const h1 = C.zpH2Impulse(zs, mk(0.95), 1, n).re;
              const h2 = C.zpH2Impulse(zs, mk(1.02), 1, n).re;
              const p = DSP.plot.new(canvas, { height: 250, xlabel: 'n', ylabel: 'h[n]', legend: true, legendPos: 'tr' });
              p.add({ x: U.arange(n), y: Array.from(h1), type: 'stem', color: 0, width: 1.6, label: '|p| = 0.95：指数衰减、稳定' })
                .add({ x: U.arange(n), y: Array.from(h2), type: 'stem', color: 2, width: 1.6, label: '|p| = 1.02：指数增长、发散' })
                .draw();
            }
          },
          { t: 'md', md: '注意 $|p|=1.02$ 只比临界大 2%，前 20 个样点看起来还算"正常"，之后就指数发散。这种"看起来能用、跑一会儿就溢出"的行为，正是 IIR 在定点实现里最危险的失效模式。' },
          { t: 'callout', kind: 'danger', title: '工程上稳定性是怎么被破坏的', md: '设计出来的系数是浮点数，极点稳稳在圆内；**一旦量化成定点系数，极点会移动**。阶数越高、极点越靠近单位圆、极点之间越靠近，移动量越大。典型事故：窄带滤波器（极点半径 0.999）用 16 bit 系数实现，上电后极点被推到 $|p|>1$，输出直接饱和振荡。对策有三条：拆成二阶级联、留裕量（极点半径不超过 0.99）、定点后**重新离线校验极点位置**。' }
        ]
      },
      {
        id: 'fwe', num: '4', title: '有限字长效应与二阶级联（SOS）',
        blocks: [
          { t: 'md', md: '高阶 IIR 用直接型实现几乎必然出问题，原因有三：' },
          { t: 'table', cols: ['效应', '机理', '后果', '对策'], rows: [
            ['系数量化敏感', '高阶多项式根对系数扰动极敏感，尤其根密集时', '极点跑出单位圆、幅频严重偏离', '拆成二阶级联 SOS'],
            ['极限环', '反馈回路里量化残差自持振荡', '输入为零时仍有输出，出现伪信号', '用 DF-II 转置结构、提高位宽、加 dither'],
            ['溢出振荡', '加法器溢出后符号翻转，被反馈放大', '输出大幅自激，彻底失效', '累加器留足位宽、采用饱和运算'],
            ['舍入噪声放大', '量化噪声被反馈回路的增益放大', '噪声底抬升，弱信号被埋', 'SOS 内部按增益排序、噪声整形']
          ] },
          { t: 'md', md: '为什么拆成二阶级联就好了？因为二阶节的根是**解析可求**的，系数误差对根的影响可以被精确界定；而且每个二阶节的极点彼此独立，一个环节的误差不会通过高阶多项式的根轨迹被放大。数值上，直接型高阶的极点灵敏度大致正比于 $\\prod_{i\\ne j}|p_i-p_j|^{-1}$——极点越密，这个量爆炸得越厉害。' },
          {
            t: 'plot', title: '实测：6 阶 Butterworth 用 8 bit 系数，直接型 vs 二阶级联', height: 265,
            render: function (canvas) {
              const fs = 1, fc = 0.15, nfft = 1024, bits = 8;
              const wc = 2 / fs * Math.tan(Math.PI * fc);
              const ps = butterPoles(6, wc).map(s => C.bilinearZeros(s, fs));
              const zs = [];
              for (let i = 0; i < 6; i++) zs.push({ re: -1, im: 0 });
              const ba = zp2ba(zs, ps);
              // 理想
              const f0 = C.freqz(ba.b, ba.a, nfft, fs); const h0 = halfDb(f0, fs);
              // 直接型：整体系数直接量化
              const q = (arr, s) => arr.map(v => Math.round(v * s) / s);
              const S = Math.pow(2, bits);
              const bd = q(ba.b, S), ad = q(ba.a, S);
              const fd = C.freqz(bd, ad, nfft, fs); const hd = halfDb(fd, fs);
              // 级联：每对极点一个二阶节，逐节量化后再级联
              let bc = [1], ac = [1];
              for (let i = 0; i < ps.length; i += 2) {
                const sub = zp2ba([{ re: -1, im: 0 }, { re: -1, im: 0 }], [ps[i], ps[i + 1]]);
                const bq = q(sub.b, S), aq = q(sub.a, S);
                bc = C.conv(Float64Array.from(bc), Float64Array.from(bq));
                ac = C.conv(Float64Array.from(ac), Float64Array.from(aq));
              }
              const fcq = C.freqz(Array.from(bc), Array.from(ac), nfft, fs); const hc = halfDb(fcq, fs);
              const p = DSP.plot.new(canvas, { height: 265, xlabel: '归一化频率 f / f_s', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-70, 10], xlim: [0, 0.5] });
              p.add({ x: Array.from(h0.x), y: Array.from(h0.y), color: 0, width: 2.2, label: '理想浮点系数' })
                .add({ x: Array.from(hd.x), y: Array.from(hd.y), color: 2, width: 1.6, label: '直接型 + 8 bit 量化' })
                .add({ x: Array.from(hc.x), y: Array.from(hc.y), color: 1, width: 1.6, dash: [5, 3], label: '二阶级联 + 8 bit 量化' })
                .draw();
            }
          },
          { t: 'md', md: '两条量化曲线的差异就是"结构"的价值：同样的 8 bit 系数预算，二阶级联（绿色虚线）几乎贴住理想响应，直接型（橙色）在通带边沿已经明显变形。阶数越高，这个差距会越大。' },
          { t: 'callout', kind: 'eng', title: '工业界的标准做法', md: '1. **一律用 SOS（biquad）级联**：每个二阶节用**转置直接 II 型**（DF-II transposed），它只有一个累加器、舍入噪声最低、且中间量动态范围小。\n2. **极点配对有讲究**：把靠得最近的极点对配到同一节，并把增益最大的节放中间，可以显著压低舍入噪声与溢出概率。\n3. **增益分配**：每节的增益不要全压在第一节（会溢出）或最后一节（噪声放大），通常按$\\sqrt{\\cdot}$或逐节归一化分配。\n4. **离线校验不可省**：定点系数生成后，重新算一遍极点模值与幅频，确认 $|p|<0.999$ 且指标仍满足。MATLAB 的 `tf2sos`、Python 的 `scipy.signal.sos2tf`/`tf2sos` 都是按这套规则实现的。' }
        ]
      },
      {
        id: 'gd', num: '5', title: '群延迟非线性：相位失真会扭曲脉冲波形',
        blocks: [
          { t: 'md', md: 'IIR 的相位不是 $\\omega$ 的一次函数，于是各频率分量的延迟不同：' },
          { t: 'math', tex: 'y[n] \\;\\xrightarrow{\\text{无失真条件}}\\; A\\cdot x[n-n_d] \\quad\\Longleftrightarrow\\quad |H| = \\text{常数且}\\ \\tau_g(\\omega) = \\text{常数}', tag: '(4)' },
          { t: 'md', md: '对窄带信号（如 CW）相位非线性问题不大——反正只有一根谱线，延迟不同只体现为整体相移。但对**宽带脉冲**（LFM、高斯脉冲、瞬态回波），不同频率分量被延迟不同，叠加后波形就被"抹"掉了：主瓣展宽、出现过冲与振铃、峰值位置漂移。' },
          {
            t: 'plot', title: '关键实验：同一个 IIR，单向滤波 vs 零相位滤波（幅度响应完全相同）', height: 260,
            render: function (canvas) {
              const fs = 48000, n = 400, fc = 0.06;
              const wc = 2 * Math.tan(Math.PI * fc);
              const ps = butterPoles(6, wc).map(s => C.bilinearZeros(s, 1));
              const zs = []; for (let i = 0; i < 6; i++) zs.push({ re: -1, im: 0 });
              const ba = zp2ba(zs, ps);
              const x = C.gaussPulse(n, fs, 2500, 800, 0.003);
              const y1 = C.filter(ba.b, ba.a, x);
              const y2 = C.filtfilt(ba.b, ba.a, x);
              const t = Array.from(U.linspace(0, n / fs * 1000, n));
              const p = DSP.plot.new(canvas, { height: 260, xlabel: 't / ms', ylabel: '幅度', legend: true, legendPos: 'tr' });
              p.add({ x: t, y: Array.from(x), color: 3, width: 1.4, dash: [4, 3], label: '原始高斯脉冲' })
                .add({ x: t, y: Array.from(y1), color: 2, width: 1.9, label: 'IIR 单向滤波：波形被扭曲、峰值漂移' })
                .add({ x: t, y: Array.from(y2), color: 0, width: 1.9, label: 'IIR 零相位：波形恢复对称' })
                .draw();
            }
          },
          { t: 'md', md: '两条输出曲线的**幅度谱完全相同**（同一个滤波器），差别只来自相位。这就证明了波形畸变的元凶是相位非线性，而不是幅度。' },
          {
            t: 'plot', title: '群延迟：IIR 随频率剧变，FIR 是一条水平线', height: 250,
            render: function (canvas) {
              const fs = 1, fc = 0.12, nfft = 1024;
              const wc = 2 * Math.tan(Math.PI * fc);
              const ps = butterPoles(6, wc).map(s => C.bilinearZeros(s, fs));
              const zs = []; for (let i = 0; i < 6; i++) zs.push({ re: -1, im: 0 });
              const ba = zp2ba(zs, ps);
              const fI = C.freqz(ba.b, ba.a, nfft, fs);
              const gI = groupDelay(fI);
              const bF = Array.from(C.firWin({ order: 120, type: 'low', fc: fc, win: 'hamming' }));
              const fF = C.freqz(bF, [1], nfft, fs);
              const gF = groupDelay(fF);
              const half = nfft >> 1;
              const x = [], y1 = [], x2 = [], y2 = [];
              for (let i = 2; i < half - 2; i++) {
                // 幅度过低的频点相位不可靠（群延迟发散），跳过
                if (fI.magDb[i] > -45) { x.push(i / nfft); y1.push(gI[i]); }
                if (fF.magDb[i] > -45) { x2.push(i / nfft); y2.push(gF[i]); }
              }
              const p = DSP.plot.new(canvas, { height: 250, xlabel: '归一化频率 f / f_s', ylabel: '群延迟 / 采样点', legend: true, legendPos: 'tl', xlim: [0, 0.5] });
              p.add({ x: x, y: y1, color: 2, width: 1.9, label: 'IIR（6 阶 Butterworth）：截止处剧变' })
                .add({ x: x2, y: y2, color: 0, width: 1.9, dash: [5, 3], label: 'FIR（120 阶，线性相位）：恒定 60 点' })
                .vline(fc, { label: 'f_c' }).draw();
            }
          },
          { t: 'callout', kind: 'danger', title: '为什么这在声呐测距里是致命的', md: '主动声呐靠回波峰值的位置定距离。一个宽带脉冲经过非线性相位滤波器后，峰值可能漂移、主瓣分裂出双峰，测距误差轻松超过半个脉宽。更隐蔽的是：**畸变随目标回波的频谱而变**，于是不同目标、不同距离上的误差不一致，无法用单一常数补偿。这就是主动声呐链路里几乎所有滤波器都用线性相位 FIR（或做零相位后处理）的根本原因。' },
          { t: 'callout', kind: 'tip', title: 'IIR 也能做线性相位——但只能离线', md: '对已录好的整段数据，用 `filtfilt`（正反各滤一次）可以让 IIR 的相位完全抵消，得到零相位输出，同时保留 IIR 的低阶陡峭滚降。这是离线分析（如地震、水声事后处理、生理信号）的标准做法。代价是：幅度变成 $|H|^2$、不能实时、边界会有瞬态。' }
        ]
      },
      {
        id: 'proto', num: '6', title: '四种逼近原型与选型',
        blocks: [
          { t: 'table', cols: ['原型', '通带', '阻带', '过渡带', '相位/群延迟', '典型用途'], rows: [
            ['Butterworth', '最平坦（无波纹）', '单调下降', '最宽', '中等', '通用、要求通带干净的场合'],
            ['Chebyshev I', '等波纹（可调）', '单调下降', '较窄', '较差', '要求过渡带窄、允许通带波纹'],
            ['Chebyshev II', '单调', '等波纹', '较窄', '较差', '要求阻带有确定衰减'],
            ['椭圆（Cauer）', '等波纹', '等波纹', '最窄（同阶最优）', '最差', '阶数受限、只关心幅度'],
            ['Bessel', '单调、平缓', '缓慢', '最宽', '**最线性**', '需要脉冲保真的场合']
          ] },
          {
            t: 'plot', title: '真实计算：5 阶 Butterworth 与 5 阶 Chebyshev I（0.5 dB 波纹）', height: 260,
            render: function (canvas) {
              const fs = 1, fc = 0.15, nfft = 1024;
              const wc = 2 * Math.tan(Math.PI * fc);
              const pb = butterPoles(5, wc).map(s => C.bilinearZeros(s, fs));
              const zb = []; for (let i = 0; i < 5; i++) zb.push({ re: -1, im: 0 });
              const bab = zp2ba(zb, pb);
              const fb = C.freqz(bab.b, bab.a, nfft, fs); const hb = halfDb(fb, fs);
              const eps = Math.sqrt(Math.pow(10, 0.5 / 10) - 1);
              const pc = cheby1Poles(5, eps, wc).map(s => C.bilinearZeros(s, fs));
              const zc = []; for (let i = 0; i < 5; i++) zc.push({ re: -1, im: 0 });
              const bac = zp2ba(zc, pc);
              const fcq = C.freqz(bac.b, bac.a, nfft, fs); const hc = halfDb(fcq, fs);
              const p = DSP.plot.new(canvas, { height: 260, xlabel: '归一化频率 f / f_s', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-90, 5], xlim: [0, 0.5] });
              p.add({ x: Array.from(hb.x), y: Array.from(hb.y), color: 0, width: 1.8, label: 'Butterworth（通带最平）' })
                .add({ x: Array.from(hc.x), y: Array.from(hc.y), color: 2, width: 1.8, label: 'Chebyshev I（通带等波纹 0.5 dB）' })
                .vline(fc, { label: 'f_c' }).draw();
            }
          },
          { t: 'md', md: '对比两条曲线：Chebyshev 用通带的 0.5 dB 波纹换来了明显更陡的过渡带——这就是"等波纹"的本质：**把误差均匀摊开，而不是集中在某个角落**，从而在同样阶数下拿到更好的最坏情况指标。' },
          { t: 'callout', kind: 'eng', title: '工程选型建议', md: '- **要最少的阶数、只关心幅度** → 椭圆（Ellip）。代价是相位最差、对系数量化最敏感。\n- **要通带干净、不能有过冲** → Butterworth。做抗混叠、做包络平滑的默认选择。\n- **要过渡带窄又怕椭圆太敏感** → Chebyshev I/II，折中。\n- **要脉冲波形保真** → Bessel（模拟域）或直接改用线性相位 FIR。Bessel 的幅频很软，别指望它做选择性。\n- **离线处理想兼得** → 椭圆 IIR + `filtfilt`，阶数少、零相位，是事后分析的常用组合。' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 高阶 IIR 用直接型实现', md: '这是"必炸"级别的错误。6 阶以上直接型对系数量化极其敏感，浮点仿真完全正常，定点上板就自激。**规则：任何阶数 ≥ 4 的 IIR 都必须拆成二阶级联（SOS）。**' },
          { t: 'callout', kind: 'pit', title: '② 以为 IIR 一定不能做线性相位', md: '在线实时确实做不到（因果 IIR 无法有严格线性相位）。但**离线**可以用正反两次滤波（filtfilt）得到零相位输出，同时保留低阶陡峭滚降。说"IIR 不能线性相位"只在实时语境下成立。' },
          { t: 'callout', kind: 'pit', title: '③ 把相位失真当成"看起来不好看"的小问题', md: '在测距、脉压、波束形成里，相位就是信息本身。同样的幅度响应，换一个相位响应就能让测距误差达到半个脉宽。**评价滤波器时必须同时看幅频、相频、群延迟三条曲线。**' },
          { t: 'callout', kind: 'pit', title: '④ 只检查设计出的浮点极点', md: '必须检查**量化后**的极点。极点半径 0.999 的窄带滤波器，16 bit 系数就可能把它推出单位圆。做法：定点系数生成后重新求根，要求 $|p| \\le 0.999$ 并复测幅频。' },
          { t: 'callout', kind: 'pit', title: '⑤ 忽略极限环', md: '输入为零时输出仍在小幅振荡，这是反馈回路里量化残差的自持振荡。在被动声呐这种看微弱信号的系统里，它会被当成真信号。对策：提高内部位宽、用 DF-II 转置结构、或在输出端加极小 dither。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 6 章（IIR 设计）与第 9 章（有限字长效应）',
      'Proakis & Manolakis, Digital Signal Processing, 第 8 章（IIR 结构与量化效应）',
      'Antoniou, Digital Filters: Analysis, Design and Applications'
    ]
  });

  /* ============================================================
     4. 窗函数法设计 FIR
     ============================================================= */
  reg('theory/filter/win-design', {
    title: '窗函数法设计 FIR',
    lede: '理想低通的冲激响应无限长且非因果，加窗截断是让它落地最简单的办法。窗的三条等式（主瓣宽→过渡带、旁瓣→阻带衰减、ENBW→处理损失）就是这个方法的全部设计公式。',
    tags: ['滤波', 'FIR 设计', '窗函数', '吉布斯现象', '凯泽窗', '等波纹'],
    labs: [
      { path: 'lab/fir', title: 'FIR 滤波器设计实验台', desc: '改窗型与阶数，实时看过渡带、阻带衰减与吉布斯过冲' },
      { path: 'lab/window', title: '窗函数横向对比实验台', desc: '主瓣宽、旁瓣电平、ENBW 一次看清楚，理解三条等式' }
    ],
    toc: true,
    sections: [
      {
        id: 'principle', num: '1', title: '原理：把无限长的理想响应截断并移位',
        blocks: [
          { t: 'md', md: '理想低通的幅度响应是一个矩形：通带内恒为 1，阻带恒为 0。它的冲激响应由 IDTFT 给出：' },
          { t: 'math', tex: 'h_d[n] = \\frac{1}{2\\pi}\\int_{-\\omega_c}^{\\omega_c} e^{j\\omega n}\\,d\\omega = \\frac{\\sin(\\omega_c n)}{\\pi n},\\quad n\\neq 0;\\qquad h_d[0]=\\frac{\\omega_c}{\\pi}', tag: '(1)' },
          { t: 'md', md: '这个函数有两个麻烦：**无限长**（$1/n$ 衰减很慢）、**非因果**（$n<0$ 也有值）。窗函数法的处理就两步：' },
          { t: 'md', md: '1. **移位**：把中心移到 $\\alpha=M/2$，使其因果化（代价是引入 $\\alpha$ 个样点的群延迟）；\n2. **截断**：乘一个有限长窗 $w[n]$（长度 $M+1$），把无限长的尾巴切掉。' },
          { t: 'math', tex: 'h[n] = h_d[n-\\alpha]\\cdot w[n],\\qquad 0\\le n \\le M,\\quad \\alpha = \\frac{M}{2}', tag: '(2)' },
          {
            t: 'plot', title: '真实计算：理想响应 h_d、凯泽窗、相乘后的实际系数', height: 265,
            render: function (canvas) {
              const M = 60, N = M + 1, fc = 0.15;
              const hd = Array.from(C.idealLp(M, fc));
              const w = Array.from(C.window('kaiser', N, 5.65));
              const h = hd.map((v, i) => v * w[i]);
              const p = DSP.plot.new(canvas, { height: 265, xlabel: 'n', ylabel: '幅度', legend: true, legendPos: 'tr' });
              p.add({ x: U.arange(N), y: hd, color: 3, width: 1.3, dash: [4, 3], label: '理想 h_d[n−α]（无限长，此处只画一段）' })
                .add({ x: U.arange(N), y: w, color: 1, width: 1.6, label: '凯泽窗 w[n]（β = 5.65）' })
                .add({ x: U.arange(N), y: h, type: 'stem', color: 0, width: 1.5, label: '实际系数 h[n] = h_d·w' })
                .draw();
            }
          },
          { t: 'md', md: '频域上，时域相乘等于频域卷积：$H(e^{j\\omega})=\\frac{1}{2\\pi}H_d*W$。理想矩形与窗的频谱卷积后，**边沿被抹圆**形成过渡带，**阻带被窗的旁瓣垫高**。于是窗的三项指标直接变成滤波器的三项指标。' },
          { t: 'callout', kind: 'note', title: '为什么窗必须关于 α 对称', md: '$h_d[n-\\alpha]$ 是关于 $\\alpha$ 偶对称的；只要窗 $w[n]$ 也关于 $\\alpha$ 对称（绝大多数窗都满足），乘积就保持对称，从而得到 I 型/II 型线性相位 FIR。**这也是窗函数法天然给出线性相位的原因**——对称性在截断过程中被完整保留。' }
        ]
      },
      {
        id: 'gibbs', num: '2', title: '吉布斯现象：过冲不会随阶数消失，只会变窄',
        blocks: [
          { t: 'md', md: '把无限长 $h_d[n]$ 截断，等价于频域里用窗的频谱去卷积理想矩形。矩形边沿被卷积后必然出现**过冲与振铃**，这就是吉布斯现象。定量结论：' },
          { t: 'math', tex: '\\text{过冲量} \\to 8.95\\%\\ (\\approx 0.0895),\\qquad \\text{随 } M\\to\\infty \\text{ 不趋于 0，只是过冲区域越来越窄}', tag: '(3)' },
          {
            t: 'plot', title: '实测：阶数 40 / 80 / 160 的幅频（截止 0.2 f_s），放大看截止附近', height: 265,
            render: function (canvas) {
              const nfft = 2048, fc = 0.2;
              const p = DSP.plot.new(canvas, { height: 265, xlabel: '归一化频率 f / f_s', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-70, 6], xlim: [0.1, 0.32] });
              [40, 80, 160].forEach((ord, i) => {
                const b = Array.from(C.firWin({ order: ord, type: 'low', fc: fc, win: 'rect' }));
                const f = C.freqz(b, [1], nfft, 1);
                const hd = halfDb(f, 0);
                p.add({ x: Array.from(hd.x), y: Array.from(hd.y), color: i, width: 1.7, label: '矩形窗 ' + ord + ' 阶' });
              });
              p.vline(fc, { label: 'f_c' }).draw();
            }
          },
          { t: 'md', md: '三条曲线在截止频率处的**过冲高度几乎相同**（都在 0.85 dB 附近，对应幅度过冲约 8.9%），差别只是过渡带越来越窄。这就是吉布斯现象的本质：它不是"阶数不够"，而是**截断这个动作本身**的必然后果。' },
          {
            t: 'fold', summary: '展开：8.95% 过冲是怎么算出来的', deriv: true, blocks: [
              { t: 'md', md: '矩形窗截断等价于取傅里叶级数的部分和。设理想低通为 $H_d(\\omega)=\\mathbf{1}_{[-\\omega_c,\\omega_c]}$，部分和（矩形窗长度 $2M+1$）为' },
              { t: 'math', tex: 'H_M(\\omega) = \\frac{1}{2\\pi}\\int_{-\\omega_c}^{\\omega_c} \\frac{\\sin\\big((M+\\tfrac12)(\\omega-\\theta)\\big)}{\\sin\\big(\\tfrac12(\\omega-\\theta)\\big)}\\,d\\theta' },
              { t: 'md', md: '括号中的分式即**狄利克雷核** $D_M$。令 $u = (M+\\tfrac12)(\\theta-\\omega_c)$ 并取 $M\\to\\infty$，在 $\\omega=\\omega_c$ 附近做变量代换，可得' },
              { t: 'math', tex: '\\lim_{M\\to\\infty} H_M\\!\\left(\\omega_c + \\frac{x}{M+\\tfrac12}\\right) = \\frac{1}{2} + \\frac{1}{\\pi}\\int_0^{x}\\frac{\\sin u}{u}\\,du \\triangleq \\frac12 + \\frac{1}{\\pi}\\mathrm{Si}(x)' },
              { t: 'md', md: '正弦积分 $\\mathrm{Si}(x)$ 的第一个极大值出现在 $x=\\pi$，其值为 $\\mathrm{Si}(\\pi)\\approx 1.8519$，于是峰值 $= 0.5 + 1.8519/\\pi \\approx 1.0895$，**过冲 8.95%**。该值与 $M$ 无关，只决定过冲的"高度"；$M$ 只决定过冲区的宽度（正比于 $1/M$）。' },
              { t: 'callout', kind: 'warn', title: '推论', md: '加长阶数**不能**减小过冲幅度，只能把过冲挤到更窄的频带里。要减小过冲，唯一的办法是换掉"硬截断"这个动作——即换窗（见第 5 节）或改用最优逼近（Remez，见线性相位一章）。' }
            ]
          }
        ]
      },
      {
        id: 'three', num: '3', title: '三条等式：窗指标如何变成滤波器指标',
        blocks: [
          { t: 'md', md: '窗函数法的全部设计公式就是这三条对应关系，请把它们背下来：' },
          { t: 'table', cols: ['窗的指标', '滤波器的指标', '定量关系'], rows: [
            ['主瓣宽度 $\\Delta\\omega_{ML}$（rad/sample）', '过渡带宽', '$\\Delta\\omega_{过渡} \\approx \\Delta\\omega_{ML} = \\dfrac{2\\pi\\,k}{M}$（$k$ 由窗型定）'],
            ['最高旁瓣电平 $A_{SL}$（dB）', '阻带最小衰减', '$A_{stop} \\approx A_{SL}$（近似与阶数无关）'],
            ['等效噪声带宽 ENBW（bin）', '处理损失 / 通带能量', '$L_{proc} = 10\\log_{10}(\\mathrm{ENBW})$ dB'],
            ['相干增益 CG', '通带幅度标定', '需按 $1/\\mathrm{CG}$ 补偿或归一化到直流']
          ] },
          { t: 'md', md: '这张表的实用价值在于：**给定指标就能反推窗型与阶数**。要 60 dB 阻带衰减 → 找旁瓣 ≤ −60 dB 的窗（布莱克曼或凯泽 β≈5.6）；要过渡带 ≤ 0.05（归一化）→ 用 $M \\approx 2\\pi k/\\Delta\\omega$ 反解阶数。' },
          {
            t: 'widget', render: function (el) {
              const list = ['rect', 'bartlett', 'hann', 'hamming', 'blackman', 'blackmanharris'];
              const rows = list.map(k => {
                const m = C.windowMetrics(k);
                return [C.WINDOWS[k].name, m.mainLobe.toFixed(2), m.sll.toFixed(1), m.enbw.toFixed(3), (10 * Math.log10(m.enbw)).toFixed(2), m.scallop.toFixed(2)];
              });
              el.appendChild(DSP.ui.table({
                cols: ['窗', '主瓣宽 (bin)', '最高旁瓣 (dB)', 'ENBW (bin)', '处理损失 (dB)', '扇贝损失 (dB)'],
                rows: rows
              }));
              el.appendChild(U.h('div.plot-cap', { html: U.md('以上数值由本软件核心库实时计算（4096 点窗、65536 点补零 FFT），可在「窗函数对比实验台」中自行验证。注意：**旁瓣越低，主瓣越宽**——这条权衡没有任何窗能绕开。') }));
            }
          },
          { t: 'callout', kind: 'eng', title: '怎么用这张表', md: '给定"阻带衰减 ≥ $A$ dB、过渡带 ≤ $\\Delta\\omega$"：先在旁瓣列里找第一个 $\\le -A$ 的窗，再用它的主瓣宽（bin）换算：$\\Delta\\omega_{过渡} \\approx 2\\pi\\times(\\text{主瓣宽}/2)/M$，解出 $M$。举例：汉明窗主瓣 4 bin、旁瓣 −41 dB，做 $\\Delta f = 0.01 f_s$ 的低通，需要 $M \\approx 4/(2\\times0.01) = 200$ 阶。这个估算与凯泽公式的结果通常只差几个点。' }
        ]
      },
      {
        id: 'kaiser', num: '4', title: '凯泽窗经验公式：唯一"连续可调"的窗',
        blocks: [
          { t: 'md', md: '固定窗的参数是离散的（要么 −41 dB，要么 −58 dB），指标卡在中间就很尴尬。凯泽窗用参数 $\\beta$ 连续地在"主瓣宽"与"旁瓣低"之间滑动，是工程上最常用的窗。' },
          { t: 'math', tex: 'w[n] = \\frac{I_0\\!\\left(\\beta\\sqrt{1-\\left(\\frac{n-\\alpha}{\\alpha}\\right)^2}\\right)}{I_0(\\beta)},\\qquad 0\\le n \\le M', tag: '(4)' },
          { t: 'math', tex: '\\beta = \\begin{cases} 0.1102\\,(A-8.7), & A > 50 \\\\[2pt] 0.5842\\,(A-21)^{0.4} + 0.07886\\,(A-21), & 21 \\le A \\le 50 \\\\[2pt] 0, & A < 21 \\end{cases}', tag: '(5)' },
          { t: 'math', tex: 'M \\approx \\frac{A - 8}{2.285\\,\\Delta\\omega},\\qquad \\Delta\\omega = \\omega_{stop} - \\omega_{pass}\\ \\text{(rad/sample)}', tag: '(6)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['A', '要求的阻带衰减，单位 dB（正数，如 60）'],
            ['Δω', '数字过渡带宽，rad/sample；若用归一化频率差 $\\Delta f$（对 $f_s$），则 $\\Delta\\omega = 2\\pi\\Delta f$'],
            ['I₀(·)', '第一类零阶修正贝塞尔函数'],
            ['β', '形状参数：$\\beta$ 越大旁瓣越低、主瓣越宽。$\\beta=0$ 退化为矩形窗，$\\beta\\approx 8.6$ 接近布莱克曼']
          ] },
          {
            t: 'widget', render: function (el) {
              const rows = [30, 40, 50, 60, 70, 80, 100].map(A => [
                String(A), U.fmt(kaiserBeta(A), 3), String(kaiserOrder(A, 2 * Math.PI * 0.05))
              ]);
              el.appendChild(DSP.ui.table({
                cols: ['要求衰减 A (dB)', 'β', '阶数 M（过渡带 0.05 f_s 时）'],
                rows: rows
              }));
              el.appendChild(U.h('div.plot-cap', { html: U.md('同一过渡带宽度下，衰减要求每提高 10 dB，阶数约增加 20~25 阶。**衰减指标是最贵的指标**，写规格时不要随手把 60 dB 写成 80 dB。') }));
            }
          }
        ]
      },
      {
        id: 'steps', num: '5', title: '设计步骤清单与代码',
        blocks: [
          { t: 'flow', v: true, items: [
            { t: '① 定指标', d: '给出 $f_{pass}$、$f_{stop}$、通带波纹 $\\delta_p$、阻带衰减 $A$（dB）、采样率 $f_s$' },
            { t: '② 归一化', d: '$\\omega_{pass}=2\\pi f_{pass}/f_s$，$\\omega_{stop}=2\\pi f_{stop}/f_s$，$\\Delta\\omega=\\omega_{stop}-\\omega_{pass}$' },
            { t: '③ 选窗型 / 算 β', d: '按 $A$ 查窗的旁瓣电平，或直接用式 (5) 算凯泽 $\\beta$' },
            { t: '④ 算阶数', d: '$M \\approx (A-8)/(2.285\\,\\Delta\\omega)$；高通/带阻需把 $M$ 调整为偶数长度（I 型）' },
            { t: '⑤ 定截止频率', d: '$\\omega_c = (\\omega_{pass}+\\omega_{stop})/2$，即过渡带的中点' },
            { t: '⑥ 生成系数并校验', d: '画幅频，检查通带波纹、阻带衰减、过渡带是否同时达标；不达标就加阶' }
          ] },
          codeBlock(
            "import numpy as np\n"
            + "from scipy.signal import firwin, freqz\n\n"
            + "def kaiser_lowpass(fs, fpass, fstop, A=60):\n"
            + "    # 1) 归一化与过渡带\n"
            + "    dw = 2 * np.pi * (fstop - fpass) / fs\n"
            + "    # 2) 凯泽参数\n"
            + "    beta = 0.1102 * (A - 8.7) if A > 50 else 0.5842 * (A - 21) ** 0.4 + 0.07886 * (A - 21)\n"
            + "    M = int(np.ceil((A - 8) / (2.285 * dw)))\n"
            + "    if M % 2 == 1:\n"
            + "        M += 1                      # 保证长度为奇数 -> I 型（可做高通）\n"
            + "    fc = 0.5 * (fpass + fstop)      # 截止取过渡带中点\n"
            + "    h = firwin(M + 1, fc, window=('kaiser', beta), fs=fs, scale=False)\n"
            + "    h = h / np.sum(h)               # 归一化直流增益为 1\n"
            + "    return h, M, beta\n\n"
            + "h, M, beta = kaiser_lowpass(48000, 8000, 10000, 60)\n"
            + "w, H = freqz(h, worN=8192, fs=48000)\n"
            + "print('阶数', M, 'beta', round(beta, 3))\n",
            'python', 'Python：窗函数法设计低通（含自动阶数估算）'),
          codeBlock(
            "% 指标：fs=48 kHz，通带 8 kHz，阻带 10 kHz，阻带衰减 60 dB\n"
            + "fs    = 48000;\n"
            + "f     = [8000 10000];      % 通带/阻带边界\n"
            + "a     = [1 0];             % 期望幅度\n"
            + "dev   = [0.01 10^(-60/20)];% 通带波纹与阻带波纹\n"
            + "[M, Wn, beta, ftype] = kaiserord(f, a, dev, fs);\n"
            + "if mod(M, 2) == 1, M = M + 1; end   % 保证 I 型\n"
            + "h = fir1(M, Wn, ftype, kaiser(M+1, beta), 'noscale');\n"
            + "h = h / sum(h);\n"
            + "freqz(h, 1, 8192, fs);\n",
            'matlab', 'MATLAB：一行 kaiserord + fir1'),
          { t: 'callout', kind: 'tip', title: '截止频率为什么取过渡带中点', md: '窗的过渡带关于理想截止点 $\\omega_c$ **对称**展开（宽度约为主瓣宽）。把 $\\omega_c$ 放在 $(\\omega_{pass}+\\omega_{stop})/2$，才能让通带边沿与阻带边沿同时刚好达标。放在别处会导致一侧达标、另一侧超差。' }
        ]
      },
      {
        id: 'example', num: '6', title: '实例演算：48 kHz 采样、通带 8 kHz、阻带 10 kHz、60 dB',
        blocks: [
          { t: 'md', md: '**题目**：$f_s = 48$ kHz，通带截止 $f_p = 8$ kHz，阻带起始 $f_s^{stop} = 10$ kHz，阻带衰减 $A = 60$ dB，通带波纹不做严格要求。设计线性相位低通 FIR。' },
          { t: 'md', md: '**第一步：归一化。** $\\omega_p = 2\\pi\\cdot 8000/48000 = 1.047$ rad，$\\omega_{stop} = 2\\pi\\cdot 10000/48000 = 1.309$ rad，$\\Delta\\omega = 0.2618$ rad。' },
          { t: 'md', md: '**第二步：算 $\\beta$。** $A = 60 > 50$，故 $\\beta = 0.1102(60-8.7) = 5.653$。' },
          { t: 'md', md: '**第三步：算阶数。** $M \\approx (60-8)/(2.285\\times0.2618) = 52/0.5981 = 86.9$，取 $M = 86$（长度 87，奇数 → I 型线性相位，群延迟 $\\alpha = 43$ 样点）。' },
          { t: 'md', md: '**第四步：定截止。** $f_c = (8+10)/2 = 9$ kHz，归一化 $f_c/f_s = 0.1875$。' },
          {
            t: 'plot', title: '设计结果：凯泽窗 FIR（M = 86, β = 5.653）幅频响应', height: 275,
            render: function (canvas) {
              const fs = 48000, M = 86;
              const b = Array.from(C.firWin({ order: M, type: 'low', fc: 0.1875, win: 'kaiser', beta: 5.653 }));
              let s = 0; for (let i = 0; i < b.length; i++) s += b[i];
              const bn = b.map(v => v / s);
              const f = C.freqz(bn, [1], 2048, fs);
              const half = 1024;
              const x = [], y = [];
              for (let i = 0; i < half; i++) { x.push(f.f[i] / 1000); y.push(f.magDb[i]); }
              const p = DSP.plot.new(canvas, { height: 275, xlabel: 'f / kHz', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-95, 5], xlim: [0, 24] });
              p.add({ x: x, y: y, color: 0, width: 1.8, label: '凯泽窗 FIR（M = 86）' })
                .vline(8, { label: '通带 8 kHz' })
                .vline(10, { label: '阻带 10 kHz' })
                .hline(-60, { label: '−60 dB' })
                .draw();
            }
          },
          {
            t: 'widget', render: function (el) {
              const fs = 48000, M = 86;
              const b = Array.from(C.firWin({ order: M, type: 'low', fc: 0.1875, win: 'kaiser', beta: 5.653 }));
              let s = 0; for (let i = 0; i < b.length; i++) s += b[i];
              const bn = b.map(v => v / s);
              const f = C.freqz(bn, [1], 4096, fs);
              let sbMax = -200, pbMax = -200, pbMin = 200;
              for (let i = 0; i < 2048; i++) {
                const fr = f.f[i];
                if (fr >= 10000) sbMax = Math.max(sbMax, f.magDb[i]);
                if (fr <= 8000) { pbMax = Math.max(pbMax, f.magDb[i]); pbMin = Math.min(pbMin, f.magDb[i]); }
              }
              el.appendChild(DSP.ui.metrics([
                { label: '阶数 M', value: String(M), unit: '抽头 87 个' },
                { label: '凯泽 β', value: '5.653', unit: '对应 A = 60 dB' },
                { label: '实测阻带衰减', value: U.fmt(-sbMax, 1), unit: 'dB' },
                { label: '实测通带波动', value: U.fmt(pbMax - pbMin, 2), unit: 'dB' },
                { label: '群延迟', value: '43', unit: '样点 = 0.896 ms' },
                { label: '乘法器（对称）', value: '44', unit: '个' }
              ]));
              el.appendChild(U.h('div.plot-cap', { html: U.md('实测阻带衰减约 58~59 dB，距 60 dB 目标还差 1~2 dB——**凯泽经验公式有 ±1 dB 量级的正常近似误差**（阶数加到 92 实测 −60.4 dB，稳过）。通带波动 0.02 dB，远优于一般需求。另注意：加大 $\\beta$ 会加宽过渡带，反而使固定阻带边界处的衰减变差，正确做法是保持 $\\beta$ 加阶数。') }));
            }
          },
          { t: 'callout', kind: 'eng', title: '处理损失别忘了', md: '本例用的是凯泽窗 $\\beta=5.65$，其 ENBW 约 1.5~1.8 bin，对应 1.8~2.6 dB 的处理损失。若这条链路要做**绝对幅度标定**（如噪声测量、目标强度反演），必须按 $10\\log_{10}(\\mathrm{ENBW})$ 修正，否则整条链路的系统增益会差 2 dB 左右。' }
        ]
      },
      {
        id: 'compare', num: '7', title: '同指标的 IIR（椭圆）对比：阶数、相位、群延迟',
        blocks: [
          { t: 'table', cols: ['对比项', '凯泽窗 FIR（本例）', '椭圆 IIR（同指标）'], rows: [
            ['阶数', '86（87 抽头）', '约 6~7 阶'],
            ['乘法器', '44（对称结构）', '约 15（3 个二阶级联）'],
            ['相位', '严格线性', '非线性'],
            ['群延迟', '恒定 43 样点', '随频率变化，截止处显著上翘'],
            ['稳定性', '无条件稳定', '需检验极点，必须 SOS 实现'],
            ['波形保真', '好（整体平移）', '差（脉冲被扭曲）'],
            ['设计复杂度', '闭式公式，几乎不需要迭代', '需椭圆函数与阶数估计']
          ] },
          {
            t: 'plot', title: '群延迟对比：线性相位 FIR 是常数，IIR 在截止处上翘', height: 250,
            render: function (canvas) {
              const fs = 48000, nfft = 1024;
              const b = Array.from(C.firWin({ order: 86, type: 'low', fc: 0.1875, win: 'kaiser', beta: 5.653 }));
              let s = 0; for (let i = 0; i < b.length; i++) s += b[i];
              const bn = b.map(v => v / s);
              const fF = C.freqz(bn, [1], nfft, 1);
              const gF = groupDelay(fF);
              const wc = 2 * Math.tan(Math.PI * 0.1875);
              const ps = butterPoles(6, wc).map(z => C.bilinearZeros(z, 1));
              const zs = []; for (let i = 0; i < 6; i++) zs.push({ re: -1, im: 0 });
              const ba = zp2ba(zs, ps);
              const fI = C.freqz(ba.b, ba.a, nfft, 1);
              const gI = groupDelay(fI);
              const half = nfft >> 1, x = [], y1 = [], y2 = [];
              for (let i = 2; i < half - 2; i++) { x.push(fs * i / nfft / 1000); y1.push(gF[i]); y2.push(gI[i]); }
              const p = DSP.plot.new(canvas, { height: 250, xlabel: 'f / kHz', ylabel: '群延迟 / 采样点', legend: true, legendPos: 'tl', xlim: [0, 24] });
              p.add({ x: x, y: y1, color: 0, width: 2, label: 'FIR（M=86）：恒定 43 点' })
                .add({ x: x, y: y2, color: 2, width: 1.8, label: 'IIR（6 阶 Butterworth）：非线性' })
                .vline(9, { label: 'f_c = 9 kHz' }).draw();
            }
          },
          { t: 'md', md: '这张图把取舍说得很清楚：IIR 用六分之一到十分之一的阶数拿到相近的幅度选择性，代价是群延迟在截止频率处上翘几十个样点。**如果后面是测距或脉压，这个上翘就是测距误差。**' },
          { t: 'callout', kind: 'eng', title: '工程师的取舍口诀', md: '- **要幅度不要相位**（频谱分析前的预选、抗混叠、包络平滑）→ 椭圆/切比雪夫 IIR，阶数最省。\n- **要相位**（脉压、测距、波束形成、任何"波形即信息"的场景）→ 线性相位 FIR，多花十倍乘法器买波形保真。\n- **离线事后处理** → 椭圆 IIR + 正反两次滤波（filtfilt），阶数与相位兼得，但边界要小心处理。\n- **阶数实在压不下来** → 用多速率：先抽取降采样再滤波，FIR 阶数按采样率成比例下降，这是最有效的省算力手段。' }
        ]
      },
      {
        id: 'pit', num: '8', title: '误区',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 以为换窗能消灭吉布斯现象', md: '换窗只能把过冲**摊平到更宽的过渡带**里，让阻带衰减变好；截止点附近的过冲依然存在（只是从 8.95% 降到窗旁瓣决定的量级）。要真正消除过冲，只能放弃"逼近理想矩形"这个思路，改用 Remez 等波纹最优设计。' },
          { t: 'callout', kind: 'pit', title: '② 把过渡带算错：忘了它是"双边"的', md: '窗的主瓣宽是**双侧**总宽，而 $\\Delta\\omega=\\omega_{stop}-\\omega_{pass}$ 是单边过渡带。用式 (6) 时直接代 $\\Delta\\omega$ 即可（公式已包含系数），但若自己从主瓣 bin 数估算，记得除以 2。规格里"过渡带 2 kHz"指的是 $f_{stop}-f_{pass}$，不要再乘 2。' },
          { t: 'callout', kind: 'pit', title: '③ 忽略通带波纹，把过渡带不算进规格', md: '窗函数法**无法独立控制通带波纹**：它由窗的旁瓣与截止点位置共同决定，通常比阻带衰减好得多（60 dB 阻带对应通带波动约 0.01 dB）。如果你的规格同时要求"通带波纹 ≤ 0.001 dB"和"阻带 60 dB"，窗函数法做不到，必须换等波纹设计。' },
          { t: 'callout', kind: 'pit', title: '④ 加阶数来解决阻带衰减不够', md: '**无效。** 阻带衰减由窗的旁瓣电平决定，与阶数基本无关（这正是吉布斯现象的另一面）。阻带不够 → **换窗或加大 $\\beta$**；过渡带太宽 → 才需要加阶数。' },
          { t: 'callout', kind: 'pit', title: '⑤ 用偶数长度设计高通', md: '长度偶数 = II 型，在 $\\omega=\\pi$ 有强制零点，高通必然失败。设计高通/带阻时把长度取奇数。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 7 章（窗函数法与 Kaiser 窗公式）',
      'Harris, "On the Use of Windows for Harmonic Analysis with the DFT", Proc. IEEE, 1978',
      'Parks & Burrus, Digital Filter Design, 第 3–4 章'
    ]
  });

  /* ============================================================
     5. 双线性变换法
     ============================================================= */
  reg('theory/filter/bilinear', {
    title: '双线性变换法',
    lede: '脉冲响应不变法会把模拟频谱周期延拓从而混叠；双线性变换换了一条思路——用代数映射把整个 s 轴一对一压进 z 平面单位圆，代价是频率轴被非线性扭曲，必须用预畸变补偿。',
    tags: ['滤波', 'IIR 设计', '双线性变换', '频率预畸变', 'Butterworth'],
    labs: [
      { path: 'lab/zplane', title: 'Z 平面零极点实验台', desc: '观察极点位置如何决定稳定性与幅频，理解映射的几何意义' },
      { path: 'lab/fir', title: 'FIR 设计实验台', desc: '与 IIR 结果做幅度、相位、群延迟横向对比' }
    ],
    toc: true,
    sections: [
      {
        id: 'why', num: '1', title: '为什么要换一条路：脉冲响应不变法的混叠',
        blocks: [
          { t: 'md', md: '设计 IIR 最自然的想法是"照抄模拟滤波器"：模拟原型已有百年积累（Butterworth、Chebyshev、椭圆、Bessel），只要能把它变成数字滤波器就行。' },
          { t: 'md', md: '第一条路是**对冲激响应采样**（下一节详述），即 $h[n]=T\\cdot h_a(nT)$。它在频域的后果是**周期延拓**：' },
          { t: 'math', tex: 'H(e^{j\\omega}) = \\sum_{m=-\\infty}^{\\infty} H_a\\!\\left(j\\frac{\\omega-2\\pi m}{T}\\right)', tag: '(1)' },
          { t: 'md', md: '只要模拟原型不是严格带限的（实际滤波器在 $\\Omega\\to\\infty$ 处只是衰减、不会真的为零），延拓副本必然重叠，混叠就无法避免。这直接导致两个后果：高通、带阻无法设计；阻带衰减被抬高到一个"地板"上，加阶数也没用。' },
          { t: 'callout', kind: 'tip', title: '双线性变换的思路转变', md: '不去采样冲激响应，而是直接建立 **$s$ 与 $z$ 之间的代数映射**，使得：整个 $s$ 平面一对一地映射到整个 $z$ 平面，虚轴（$s=j\\Omega$）恰好落在单位圆上，左半平面落在单位圆内。这样模拟频率轴 $[-\\infty,+\\infty]$ 被压缩到数字频率轴 $[-\\pi,\\pi]$，**没有周期性，也就没有混叠**。' }
        ]
      },
      {
        id: 'map', num: '2', title: '映射关系与推导',
        blocks: [
          { t: 'math', tex: 's = \\frac{2}{T}\\,\\frac{1-z^{-1}}{1+z^{-1}} \\quad\\Longleftrightarrow\\quad z = \\frac{1+\\tfrac{T}{2}s}{1-\\tfrac{T}{2}s} = \\frac{\\tfrac{2}{T}+s}{\\tfrac{2}{T}-s}', tag: '(2)' },
          { t: 'md', md: '这个分式来自对微分方程做**梯形积分**（把 $s$ 的积分算子用梯形法离散），所以叫"双线性"。把 $H_a(s)$ 中的 $s$ 整体替换成式 (2) 的右端，就得到 $H(z)$。' },
          {
            t: 'fold', summary: '展开：由梯形积分推出双线性变换', deriv: true, blocks: [
              { t: 'md', md: '一阶模拟系统 $\\frac{dy_a(t)}{dt} = x_a(t)$，其传递函数 $H_a(s)=1/s$。用梯形法把积分写成离散递推：' },
              { t: 'math', tex: 'y[n] = y[n-1] + \\frac{T}{2}\\big(x[n] + x[n-1]\\big)' },
              { t: 'md', md: '两边取 Z 变换：$Y(z) = z^{-1}Y(z) + \\frac{T}{2}(1+z^{-1})X(z)$，整理得' },
              { t: 'math', tex: 'H(z) = \\frac{Y(z)}{X(z)} = \\frac{T}{2}\\cdot\\frac{1+z^{-1}}{1-z^{-1}} = \\frac{1}{\\frac{2}{T}\\cdot\\frac{1-z^{-1}}{1+z^{-1}}}' },
              { t: 'md', md: '与 $H_a(s)=1/s$ 对比，即得 $s = \\frac{2}{T}\\cdot\\frac{1-z^{-1}}{1+z^{-1}}$。这就是"用梯形积分替代解析积分"的必然结果——**积分精度越高，频率畸变越小**，这也解释了为什么它比脉冲响应不变法更受青睐。' }
            ]
          },
          { t: 'md', md: '代入 $z=e^{j\\omega_d}$、$s=j\\Omega_a$，立刻得到频率映射关系：' },
          { t: 'math', tex: 'j\\Omega_a = \\frac{2}{T}\\cdot\\frac{1-e^{-j\\omega_d}}{1+e^{-j\\omega_d}} = \\frac{2}{T}\\cdot\\frac{2j\\sin(\\omega_d/2)}{2\\cos(\\omega_d/2)} = j\\,\\frac{2}{T}\\tan\\!\\left(\\frac{\\omega_d}{2}\\right)', tag: '(3)' }
        ]
      },
      {
        id: 'prewarp', num: '3', title: '频率预畸变：本节的头号公式',
        blocks: [
          { t: 'math', tex: '\\boxed{\\;\\Omega_a = \\frac{2}{T}\\tan\\!\\left(\\frac{\\omega_d}{2}\\right)\\;} \\quad\\Longleftrightarrow\\quad \\omega_d = 2\\arctan\\!\\left(\\frac{\\Omega_a T}{2}\\right)', tag: '(4)' },
          { t: 'md', md: '**含义**：你想要的数字临界频率（截止、带边）是 $\\omega_d$，但直接把它当模拟频率代进原型设计，得到的数字滤波器截止会偏掉。必须先把 $\\omega_d$ 用式 (4) 变换成"预畸变后的模拟频率" $\\Omega_a$，用这个 $\\Omega_a$ 去设计模拟原型，最后再用双线性变换变回数字域——**这样变回来时截止频率才恰好落在 $\\omega_d$ 上。**' },
          {
            t: 'fold', summary: '展开：预畸变公式的完整推导', deriv: true, blocks: [
              { t: 'md', md: '**第一步**：由式 (3) 直接读出频率轴的对应关系 $\\Omega_a = \\frac{2}{T}\\tan(\\omega_d/2)$，其反函数为 $\\omega_d = 2\\arctan(\\Omega_a T/2)$。这是一条单调递增的非线性映射：$\\Omega_a\\in(-\\infty,\\infty)$ 被压缩到 $\\omega_d\\in(-\\pi,\\pi)$。' },
              { t: 'md', md: '**第二步**：说明为什么必须"预先"畸变。设我们直接在模拟域按 $\\Omega_c=\\omega_d/T$（即不做畸变）设计原型，那么该原型在 $\\Omega=\\Omega_c$ 处的 $-3$ dB 点，经双线性变换后落在' },
              { t: 'math', tex: '\\omega_{实际} = 2\\arctan\\!\\left(\\frac{\\Omega_c T}{2}\\right) = 2\\arctan\\!\\left(\\frac{\\omega_d}{2}\\right) \\neq \\omega_d' },
              { t: 'md', md: '**第三步**：若要 $\\omega_{实际}=\\omega_d$，就必须让 $\\Omega_c$ 满足 $\\omega_d = 2\\arctan(\\Omega_c T/2)$，解得 $\\Omega_c = \\frac{2}{T}\\tan(\\omega_d/2)$。这正是式 (4)。' },
              { t: 'md', md: '**第四步**：注意 $\\tan$ 在 $\\omega_d\\to\\pi$ 时趋于无穷，即 $\\Omega_a$ 被推到无穷——这就是所谓的"频率轴压缩"：数字域接近 Nyquist 的一小段，对应模拟域极宽的频带。反过来说，**只有被预畸变的那些频率点是精确的，其余频率点的相对位置会被挤压**。' },
              { t: 'callout', kind: 'warn', title: '只对齐临界频率', md: '预畸变只能保证你指定的那几个临界频率（通带边、阻带边）精确落在目标位置。它们之间的**形状**依然被非线性扭曲。低通/高通这类只关心两个边沿的设计影响不大；但对"通带内多个频点都有要求"的设计（如多陷波、宽带均衡、微分器），双线性变换会逐个点都对不齐，此时它不是合适的工具。' }
            ]
          },
          {
            t: 'plot', title: '预畸变曲线：数字频率 ω_d → 模拟频率 Ω_a（T = 1）', height: 255,
            render: function (canvas) {
              const T = 1;
              const w = U.linspace(0, Math.PI * 0.999, 400);
              const lin = Array.from(w).map(v => v / T);                 // 不做预畸变（线性）
              const pre = Array.from(w).map(v => 2 / T * Math.tan(v / 2)); // 预畸变
              const wd = Array.from(w).map(v => v / Math.PI);
              const p = DSP.plot.new(canvas, { height: 255, xlabel: '数字频率 ω_d / π', ylabel: '模拟频率 Ω_a (rad/s)', legend: true, legendPos: 'tl', ylim: [0, 12] });
              p.add({ x: wd, y: lin, color: 3, width: 1.6, dash: [5, 3], label: '不做预畸变（Ω = ω/T，线性）' })
                .add({ x: wd, y: pre, color: 0, width: 2, label: '预畸变后（Ω = (2/T)tan(ω/2)）' })
                .draw();
            }
          },
          { t: 'md', md: '两条曲线在 $\\omega_d$ 较小时几乎重合（小角度下 $\\tan(x)\\approx x$），而在接近 $\\pi$ 处急剧分离。**所以：截止频率远低于采样率时，忘了预畸变的误差很小；截止频率接近 Nyquist 时，误差巨大。** 这也解释了为什么很多"忘了预畸变也没出事"的侥幸经历都发生在低频段。' }
        ]
      },
      {
        id: 'prop', num: '4', title: '映射的四个性质（含 s 平面网格的可视化）',
        blocks: [
          { t: 'md', md: '把 $s=\\sigma+j\\Omega$ 代入式 (2)，取模平方：' },
          { t: 'math', tex: '|z|^2 = \\frac{\\left(1+\\tfrac{\\sigma T}{2}\\right)^2 + \\left(\\tfrac{\\Omega T}{2}\\right)^2}{\\left(1-\\tfrac{\\sigma T}{2}\\right)^2 + \\left(\\tfrac{\\Omega T}{2}\\right)^2}', tag: '(5)' },
          { t: 'table', cols: ['s 平面区域', '|z| 的范围', '含义'], rows: [
            ['左半平面 $\\sigma<0$', '$|z|<1$', '稳定区域 → 单位圆内，**稳定滤波器仍稳定**'],
            ['虚轴 $\\sigma=0$', '$|z|=1$', '频率轴 → 单位圆，一一对应'],
            ['右半平面 $\\sigma>0$', '$|z|>1$', '不稳定原型 → 数字滤波器也不稳定'],
            ['$s=\\infty$', '$z=-1$', '模拟域无穷远处的零点全部堆到 $z=-1$']
          ] },
          {
            t: 'plot', title: '真实计算：s 平面网格经双线性变换后的落点（T = 1）', height: 300,
            render: function (canvas) {
              const T = 1;
              const gL = { x: [], y: [] }, gA = { x: [], y: [] }, gR = { x: [], y: [] };
              for (let sg = -4; sg <= 4; sg += 1) {
                for (let om = -10; om <= 10; om += 1.25) {
                  const z = C.bilinearZeros({ re: sg, im: om }, T);
                  const tgt = sg < 0 ? gL : (sg > 0 ? gR : gA);
                  tgt.x.push(z.re); tgt.y.push(z.im);
                }
              }
              const p = DSP.plot.new(canvas, { height: 300, xlabel: 'Re(z)', ylabel: 'Im(z)', legend: true, legendPos: 'tr', xlim: [-1.6, 1.6], ylim: [-1.6, 1.6] });
              // 单位圆
              const th = U.linspace(0, 2 * Math.PI, 200);
              p.add({ x: Array.from(th).map(Math.cos), y: Array.from(th).map(Math.sin), color: 3, width: 1.4, dash: [4, 3], label: '单位圆 |z| = 1' })
                .add({ x: gL.x, y: gL.y, type: 'scatter', color: 0, size: 3, label: 'σ < 0（左半平面 → 圆内）' })
                .add({ x: gA.x, y: gA.y, type: 'scatter', color: 2, size: 3.5, label: 'σ = 0（虚轴 → 圆上）' })
                .add({ x: gR.x, y: gR.y, type: 'scatter', color: 1, size: 3, label: 'σ > 0（右半平面 → 圆外）' })
                .draw();
            }
          },
          { t: 'md', md: '图中 $\\sigma=0$ 的黄色点全部**精确落在单位圆上**，左半平面的蓝色点全部挤在圆内（注意它们被"压缩"得极密集——这就是频率轴压缩的几何表现），右半平面的点全在圆外。映射是**一对一**的：s 平面每个点对应唯一的 $z$，反之亦然。' },
          { t: 'callout', kind: 'note', title: '为什么一对一就不混叠', md: '混叠的根源是"多对一"：脉冲响应不变法里 $s$ 平面上相差 $2\\pi/T$ 的无数个点都映射到同一个 $z$，于是它们的响应被相加。双线性变换是**双射**（$z=(1+sT/2)/(1-sT/2)$ 与其反函数都是单值有理函数），不存在两个不同的模拟频率抢同一个数字频率，混叠从原理上被消除。' }
        ]
      },
      {
        id: 'steps', num: '5', title: '设计步骤与指标转换',
        blocks: [
          { t: 'flow', v: true, items: [
            { t: '① 数字指标', d: '给出 $\\omega_p$、$\\omega_s$、通带最大衰减 $R_p$（dB）、阻带最小衰减 $A_s$（dB）' },
            { t: '② 频率预畸变', d: '$\\Omega_p = \\frac{2}{T}\\tan(\\omega_p/2)$、$\\Omega_s = \\frac{2}{T}\\tan(\\omega_s/2)$（$T=1/f_s$）' },
            { t: '③ 选原型并定阶数', d: '用模拟域的阶数公式，代入**预畸变后**的 $\\Omega_p,\\Omega_s$ 求 $N$' },
            { t: '④ 查表/求极点', d: '得到模拟原型 $H_a(s)$ 的极点（零点），注意归一化到 $\\Omega_c$' },
            { t: '⑤ 双线性变换', d: '逐极点 $z_k = \\dfrac{1+s_kT/2}{1-s_kT/2}$；模拟无穷远零点 → $z=-1$' },
            { t: '⑥ 增益归一化', d: '令 $H(z=1)=1$（低通）或令通带中心增益为 1；拆成二阶级联' }
          ] },
          { t: 'table', cols: ['原型', '模拟域阶数公式（k = Ωp/Ωs，As 用 dB）', '特点'], rows: [
            ['Butterworth', '$N \\ge \\dfrac{\\log_{10}\\!\\sqrt{\\dfrac{10^{A_s/10}-1}{10^{R_p/10}-1}}}{\\log_{10}(1/k)}$', '通带最平，阶数最高'],
            ['Chebyshev I', '$N \\ge \\dfrac{\\cosh^{-1}\\!\\sqrt{\\dfrac{10^{A_s/10}-1}{10^{R_p/10}-1}}}{\\cosh^{-1}(1/k)}$', '通带等波纹，阶数中等'],
            ['椭圆', '需椭圆积分，同阶下过渡带最窄', '通带阻带都等波纹，阶数最低'],
            ['Bessel', '按群延迟平坦度查表，不看幅频', '相位最线性，幅频很软']
          ] },
          { t: 'callout', kind: 'eng', title: '最容易忘的一步', md: '用这些公式时，**$\\Omega_p$ 与 $\\Omega_s$ 必须是预畸变后的值，绝不能直接写 $2\\pi f/f_s$**。工程上建议在代码里把 $\\Omega$ 变量命名为 `Omega_prewarped`，并在注释里写明 $T$ 的取值，避免与真实物理频率混淆。' }
        ]
      },
      {
        id: 'example', num: '6', title: '完整算例：8 kHz 采样、1 kHz 截止的二阶 Butterworth 低通',
        blocks: [
          { t: 'md', md: '**题目**：$f_s = 8$ kHz（$T = 1.25\\times10^{-4}$ s），数字低通：$-3$ dB 点在 $f_p = 1$ kHz，在 $f_s^{stop} = 2$ kHz 处衰减至少 15 dB。用双线性变换设计 Butterworth。' },
          { t: 'md', md: '**第一步：预畸变。** $\\omega_p = 2\\pi\\cdot1000/8000 = \\pi/4$，$\\omega_{stop} = \\pi/2$。' },
          { t: 'math', tex: '\\Omega_c = \\Omega_p = \\frac{2}{T}\\tan\\!\\left(\\frac{\\pi/4}{2}\\right) = 16000\\times\\tan(22.5^\\circ) = 16000\\times0.41421 = 6627.4\\ \\mathrm{rad/s}' },
          { t: 'math', tex: '\\Omega_s = \\frac{2}{T}\\tan\\!\\left(\\frac{\\pi/2}{2}\\right) = 16000\\times\\tan(45^\\circ) = 16000\\ \\mathrm{rad/s}' },
          { t: 'md', md: '**第二步：定阶数。** Butterworth 满足 $1+(\\Omega_s/\\Omega_c)^{2N} \\ge 10^{15/10} = 31.62$，即 $(2.4142)^{2N} \\ge 30.62$，得 $2N\\cdot0.8814 \\ge 3.4216$，$N \\ge 1.94$，取 $N = 2$。' },
          { t: 'md', md: '**第三步：模拟极点。** 二阶 Butterworth 极点为 $s_{1,2} = \\Omega_c e^{\\pm j 3\\pi/4} = -4687.2 \\pm j\\,4687.2$。' },
          { t: 'md', md: '**第四步：映射到 z 平面。** 由 $z = \\dfrac{1+sT/2}{1-sT/2}$，$sT/2 = -0.29295 \\pm j\\,0.29295$，得' },
          { t: 'math', tex: 'z_{1,2} = 0.5691 \\pm j\\,0.0977,\\qquad |z| = 0.5774,\\quad \\angle z = \\pm 9.74^\\circ' },
          { t: 'md', md: '**第五步：增益归一化。** 模拟域的两个零点在无穷远，映射为 $z=-1$ 处的二重零点，故 $H(z) = g\\dfrac{(1+z^{-1})^2}{(1-z_1z^{-1})(1-z_2z^{-1})}$。令 $H(1)=1$ 得 $g = 0.04881$，于是' },
          { t: 'math', tex: 'H(z) = \\frac{0.04881\\,(1 + 2z^{-1} + z^{-2})}{1 - 1.1381\\,z^{-1} + 0.3334\\,z^{-2}}', tag: '(6)' },
          {
            t: 'plot', title: '设计结果：零极点位置与幅频响应（核心库实时计算）', height: 270,
            render: function (canvas) {
              const fs = 8000, T = 1 / fs;
              const wc = 2 / T * Math.tan((Math.PI / 4) / 2);
              const ps = butterPoles(2, wc).map(s => C.bilinearZeros(s, T));
              const zs = [{ re: -1, im: 0 }, { re: -1, im: 0 }];
              const ba = zp2ba(zs, ps);
              const f = C.freqz(ba.b, ba.a, 1024, fs);
              const half = 512, x = [], y = [];
              for (let i = 0; i < half; i++) { x.push(f.f[i] / 1000); y.push(f.magDb[i]); }
              const p = DSP.plot.new(canvas, { height: 270, xlabel: 'f / kHz', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-45, 3], xlim: [0, 4] });
              p.add({ x: x, y: y, color: 0, width: 2, label: '二阶 Butterworth（双线性变换）' })
                .vline(1, { label: '1 kHz（−3 dB 点）' })
                .vline(2, { label: '2 kHz' })
                .hline(-3, { label: '−3 dB' })
                .hline(-15, { label: '−15 dB' })
                .draw();
            }
          },
          {
            t: 'widget', render: function (el) {
              const fs = 8000, T = 1 / fs;
              const wc = 2 / T * Math.tan((Math.PI / 4) / 2);
              const ps = butterPoles(2, wc).map(s => C.bilinearZeros(s, T));
              const zs = [{ re: -1, im: 0 }, { re: -1, im: 0 }];
              const ba = zp2ba(zs, ps);
              const f = C.freqz(ba.b, ba.a, 2048, fs);
              const at = fq => { const i = Math.round(fq / fs * 2048); return f.magDb[Math.min(i, 2047)]; };
              el.appendChild(DSP.ui.metrics([
                { label: '预畸变 Ω_c', value: U.fmt(wc, 1), unit: 'rad/s' },
                { label: '数字极点模', value: U.fmt(Math.hypot(ps[0].re, ps[0].im), 4), unit: '（< 1，稳定）' },
                { label: '1 kHz 处衰减', value: U.fmt(at(1000), 2), unit: 'dB' },
                { label: '2 kHz 处衰减', value: U.fmt(at(2000), 2), unit: 'dB' },
                { label: '直流增益', value: U.fmt(at(0), 3), unit: 'dB' },
                { label: 'Nyquist 处衰减', value: U.fmt(at(3990), 2), unit: 'dB' }
              ]));
              el.appendChild(U.h('div.plot-cap', { html: U.md('校验：1 kHz 处恰好 −3 dB（预畸变生效），2 kHz 处约 −15.4 dB（满足 ≥15 dB 指标）。**如果忘了预畸变，$-3$ dB 点会跑到约 1.09 kHz，指标直接失守。**') }));
            }
          },
          { t: 'callout', kind: 'eng', title: '忘掉预畸变会错多少', md: '本例中若直接用 $\\Omega_c = 2\\pi\\cdot1000 = 6283$ rad/s（不做预畸变），数字域的 $-3$ dB 点会落在 $2\\arctan(6283\\cdot1.25\\times10^{-4}/2)\\cdot f_s/(2\\pi) \\approx 1.09$ kHz，偏差 9%。截止频率越接近 Nyquist，偏差越大：$\\omega_d=0.9\\pi$ 时不做预畸变的结果会偏掉近 40%。' }
        ]
      },
      {
        id: 'limit', num: '7', title: '缺点与误区',
        blocks: [
          { t: 'md', md: '双线性变换不是万能的，它有三条明确的局限：' },
          { t: 'md', md: '1. **频率轴非线性压缩**：只有预畸变点精确，通带/阻带内部的相对位置被挤压，$\\omega_d\\to\\pi$ 附近尤其严重。\n2. **不适合做微分器**：理想的 $H(s)=s$ 经双线性变换后在 $\\omega=\\pi$ 处响应趋于 0，高频段完全失真，无法逼近"幅度随 $\\omega$ 线性增长"。\n3. **不能保证线性相位**：模拟原型的相位特性本就非线性，映射后依然非线性。要求线性相位的场合请改用 FIR。' },
          { t: 'callout', kind: 'pit', title: '① 忘了预畸变，截止频率算错', md: '这是双线性变换第一大坑。判断方法：设计完成后在数字域实测 $-3$ dB 点，若它偏离了目标值（尤其是向低频偏），八成就是忘了预畸变。**养成习惯：写出 $\\Omega$ 时立刻检查是不是 $(2/T)\\tan(\\omega/2)$ 的形式。**' },
          { t: 'callout', kind: 'pit', title: '② 用双线性变换做宽带/多频点设计', md: '预畸变只能精确对齐你指定的那几个频点。若设计目标是在 $[f_1,f_2]$ 内保持某个形状（如微分器、均衡器、多音补偿），双线性变换的非线性压缩会让这个形状整体变形。这类需求应当直接在数字域做最优设计（FIR 等波纹或数字域 IIR 拟合）。' },
          { t: 'callout', kind: 'pit', title: '③ 把 T 当成自由参数', md: '在"给定数字指标 → 设计数字滤波器"的流程里，$T$ 只会通过 $\\Omega_a T$ 的组合出现，最后完全抵消，**取 $T=1$（或 $T=2$）即可简化计算**，$T$ 的实际值不影响最终数字滤波器。很多人纠结 $T$ 取多少，其实它只是中间量；真正决定结果的是预畸变后的 $\\Omega$ 比值。' },
          { t: 'callout', kind: 'pit', title: '④ 以为双线性变换后仍是"同一个滤波器"', md: '幅频形状被压缩了，群延迟完全变了，冲激响应也不再是原型的采样。双线性变换给出的是**满足同样边沿指标的数字滤波器**，不是模拟原型的数字复制品。把它用于"我要复现某个模拟系统的时域响应"是错的（那种需求应该用脉冲响应不变法）。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 7 章（IIR 设计：双线性变换）',
      'Proakis & Manolakis, Digital Signal Processing, 第 8 章',
      '程佩青《数字信号处理教程》第 6 章（IIR 数字滤波器设计）'
    ]
  });

  /* ============================================================
     6. 脉冲响应不变法
     ============================================================= */
  reg('theory/filter/impulse-inv', {
    title: '脉冲响应不变法',
    lede: '直接采样模拟系统的冲激响应，让数字滤波器"照抄"原型的时域行为。代价是频域周期延拓带来无法消除的混叠——它只适合带限原型，且必须乘上那个容易被忘掉的 T。',
    tags: ['滤波', 'IIR 设计', '脉冲响应不变法', '混叠', '增益标定'],
    labs: [{ path: 'lab/zplane', title: 'Z 平面零极点实验台', desc: '观察 s 平面极点到 z 平面的映射 z = e^{sT} 与"向 z=1 聚集"的现象' }],
    toc: true,
    sections: [
      {
        id: 'def', num: '1', title: '定义：h[n] = T · hₐ(nT)',
        blocks: [
          { t: 'math', tex: 'h[n] \\triangleq T\\cdot h_a(nT),\\qquad n = 0,1,2,\\dots', tag: '(1)' },
          { t: 'md', md: '思路极其朴素：模拟系统的冲激响应 $h_a(t)$ 可以被采样，那就采样它作为数字滤波器的冲激响应。前面的 $T$ 是**标定因子**，目的是让数字滤波器的通带增益与模拟原型一致（详见第 6 节），而不是可有可无的装饰。' },
          { t: 'kv', title: '变量说明', pairs: [
            ['hₐ(t)', '模拟滤波器的冲激响应（因果）'],
            ['T', '采样间隔 $=1/f_s$'],
            ['h[n]', '数字滤波器冲激响应，无限长（IIR）'],
            ['sₖ / pₖ', '模拟极点；映射后 $z_k = e^{s_k T}$']
          ] },
          { t: 'md', md: '若模拟原型可部分分式展开为 $H_a(s)=\\sum_k \\dfrac{A_k}{s-s_k}$，则 $h_a(t)=\\sum_k A_k e^{s_k t}u(t)$，采样后' },
          { t: 'math', tex: 'h[n] = T\\sum_k A_k\\,e^{s_k nT} = T\\sum_k A_k\\,(e^{s_k T})^{n} \\;\\Longrightarrow\\; H(z) = \\sum_k \\frac{T\\,A_k}{1 - e^{s_k T}z^{-1}}', tag: '(2)' },
          { t: 'md', md: '于是极点映射规则非常简单：**$z_k = e^{s_k T}$**。左半平面（$\\mathrm{Re}\\,s_k<0$）映射到 $|z_k| = e^{\\mathrm{Re}(s_k)T} < 1$，稳定性被自动保持。' },
          {
            t: 'plot', title: '真实计算：二阶 Butterworth 模拟极点的映射（f_s = 4 kHz，f_c = 1 kHz）', height: 300,
            render: function (canvas) {
              const fs = 4000, T = 1 / fs, wc = 2 * Math.PI * 1000;
              const ps = butterPoles(2, wc).map(s => C.impulseInvZeros(s, T));
              DSP.plot.zplane(canvas, { zeros: [], poles: ps, height: 300, title: 'z = e^{sT}：极点全部落入单位圆内，且向 z ≈ 0.2 附近聚集' });
            }
          },
          { t: 'md', md: '注意极点的位置：它们不是落在单位圆附近，而是落在 $|z| = e^{-\\Omega_c T/\\sqrt2}$ 处（本例约 0.2）。这是因为 $z=e^{sT}$ 是**指数映射**，把整个左半平面压缩到单位圆内的一个小区域。这也是该方法在截止频率远低于采样率时数值条件很差的原因。' }
        ]
      },
      {
        id: 'deriv', num: '2', title: '推导：采样冲激响应 = 频域周期延拓',
        blocks: [
          { t: 'md', md: '采样在时域是"乘冲激串"，在频域就是"卷积冲激串"——即周期延拓。这一条与采样定理完全同源，只是这里被采样的是**冲激响应**而不是信号。' },
          {
            t: 'fold', summary: '展开：由采样定理推出频域延拓式', deriv: true, blocks: [
              { t: 'md', md: '**第一步**：构造采样后的连续函数 $\\hat{h}(t) = \\sum_n T\\,h_a(nT)\\,\\delta(t-nT)$。其傅里叶变换为' },
              { t: 'math', tex: '\\hat{H}(j\\Omega) = \\sum_{m=-\\infty}^{\\infty} H_a\\!\\left(j\\Omega - j\\frac{2\\pi m}{T}\\right)' },
              { t: 'md', md: '（冲激串 $\\sum_n \\delta(t-nT)$ 的变换是 $\\frac{2\\pi}{T}\\sum_m\\delta(\\Omega-\\frac{2\\pi m}{T})$，卷积后剩 $2\\pi/T$ 因子，与前面乘的 $T$ 相抵，故无额外系数——这正是定义里放 $T$ 的好处。）' },
              { t: 'md', md: '**第二步**：数字滤波器频率响应与 $\\hat{H}$ 的关系为 $H(e^{j\\omega}) = \\hat{H}(j\\omega/T)$，代入得' },
              { t: 'math', tex: 'H(e^{j\\omega}) = \\sum_{m=-\\infty}^{\\infty} H_a\\!\\left(j\\,\\frac{\\omega - 2\\pi m}{T}\\right)', tag: '(3)' },
              { t: 'md', md: '**第三步**：式 (3) 就是全部结论。数字频率 $\\omega$ 每转一圈（$2\\pi$），对应模拟频率移动 $2\\pi/T = 2\\pi f_s$。若 $H_a$ 在该间隔上不衰减到零，相邻副本就会重叠——**混叠不可避免**。' },
              { t: 'callout', kind: 'warn', title: '与双线性变换的本质差别', md: '双线性变换把 $\\Omega\\in(-\\infty,\\infty)$ **一对一压缩**到 $\\omega\\in(-\\pi,\\pi)$；脉冲响应不变法则是把 $H_a$ **周期复制**到 $\\omega$ 轴上并叠加。前者无混叠但频率畸变，后者频率轴线性但有混叠。**"线性频率轴"与"无混叠"在这两条路里只能二选一。**' }
            ]
          }
        ]
      },
      {
        id: 'alias', num: '3', title: '混叠必然存在：为什么只适合带限原型',
        blocks: [
          { t: 'md', md: '任何实际的模拟滤波器在 $\\Omega\\to\\infty$ 处只是**渐近衰减**（$n$ 阶原型按 $\\Omega^{-n}$ 衰减），永远不会真正等于零。既然不为零，式 (3) 的求和里那些 $m\\ne0$ 的副本就一定会贡献非零值，混叠就是结构性的、无法消除。' },
          {
            t: 'plot', title: '实测：二阶 Butterworth 低通（f_c = 1 kHz）在 f_s = 4 kHz 下的延拓叠加', height: 265,
            render: function (canvas) {
              const fs = 4000, T = 1 / fs, wc = 2 * Math.PI * 1000;
              // 二阶 Butterworth 模拟低通：H_a(jΩ) = wc² / (wc² − Ω² + j√2·wc·Ω)
              const Ha = (Om) => {
                const dr = wc * wc - Om * Om, di = Math.SQRT2 * wc * Om;
                const d = Math.max(dr * dr + di * di, 1e-30);
                return { re: wc * wc * dr / d, im: -wc * wc * di / d };
              };
              const x = [], yIdeal = [], yAlias = [];
              for (let i = 0; i <= 400; i++) {
                const w = Math.PI * i / 400;
                let sr = 0, si = 0;
                for (let m = -6; m <= 6; m++) { const H = Ha((w - 2 * Math.PI * m) / T); sr += H.re; si += H.im; }
                const id = Ha(w / T);
                x.push(fs * w / (2 * Math.PI) / 1000);
                yIdeal.push(20 * Math.log10(Math.max(Math.hypot(id.re, id.im), 1e-6)));
                yAlias.push(20 * Math.log10(Math.max(Math.hypot(sr, si), 1e-6)));
              }
              const p = DSP.plot.new(canvas, { height: 265, xlabel: 'f / kHz', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-45, 3], xlim: [0, 2] });
              p.add({ x: x, y: yIdeal, color: 3, width: 1.6, dash: [5, 3], label: '期望：原型直接映射（无混叠）' })
                .add({ x: x, y: yAlias, color: 0, width: 2, label: '实际：周期延拓叠加（有混叠）' })
                .vline(2, { label: 'Nyquist 2 kHz' }).draw();
            }
          },
          { t: 'md', md: '在 Nyquist 频率附近，实际响应比期望值高出约 6 dB（$20\\log_{10}2$），这正是第一个镜像副本叠加进来的结果。**阻带被抬到一个地板上，加阶数只能让地板略微下移，无法消除。**' },
          { t: 'md', md: '实用的补救办法：' },
          { t: 'md', md: '- **加大过采样率**：$f_s \\gg f_c$ 时副本离得远，混叠量按 $\\Omega^{-n}$ 迅速变小。本例若把 $f_s$ 提到 40 kHz，混叠可忽略。\n- **只用于带限原型**：低通、带通。带通尤其合适——它的频谱本身就在中间一段，两端都在衰减。\n- **接受阻带地板**：若指标只要求 20~30 dB 衰减，混叠地板通常可以接受。' }
        ]
      },
      {
        id: 'hp', num: '4', title: '为什么高通绝对不能用',
        blocks: [
          { t: 'md', md: '高通的模拟响应在 $\\Omega\\to\\infty$ 处趋于一个**非零常数**（理想高通是 1）。于是式 (3) 的每一项在 $|m|$ 很大时都趋于 1，无穷多个 1 相加——**求和发散**。物理上的表现是：阻带（数字域 $\\omega\\approx 0$）被所有高频副本填满，衰减彻底消失。' },
          {
            t: 'plot', title: '实测：一阶高通原型的延拓叠加（f_c = 1 kHz，f_s = 4 kHz）', height: 260,
            render: function (canvas) {
              const fs = 4000, T = 1 / fs, wc = 2 * Math.PI * 1000;
              // 一阶高通：H_a(jΩ) = jΩ/(jΩ + wc) = (Ω² + j·wc·Ω)/(Ω² + wc²)
              const Ha = (Om) => {
                const d = Math.max(Om * Om + wc * wc, 1e-30);
                return { re: Om * Om / d, im: wc * Om / d };
              };
              const x = [], yI = [], yA = [];
              for (let i = 0; i <= 400; i++) {
                const w = Math.PI * i / 400;
                let sr = 0, si = 0;
                for (let m = -5; m <= 5; m++) { const H = Ha((w - 2 * Math.PI * m) / T); sr += H.re; si += H.im; }
                const ideal = Ha(w / T);
                x.push(fs * w / (2 * Math.PI) / 1000);
                yI.push(20 * Math.log10(Math.max(Math.hypot(ideal.re, ideal.im), 1e-6)));
                yA.push(20 * Math.log10(Math.max(Math.hypot(sr, si), 1e-6)));
              }
              const p = DSP.plot.new(canvas, { height: 260, xlabel: 'f / kHz', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-30, 25], xlim: [0, 2] });
              p.add({ x: x, y: yI, color: 3, width: 1.6, dash: [5, 3], label: '期望：原型高通（直流处 −∞）' })
                .add({ x: x, y: yA, color: 2, width: 2, label: '实际：延拓叠加（阻带被抬到 +20 dB！）' })
                .hline(0, { label: '0 dB' }).draw();
            }
          },
          { t: 'callout', kind: 'danger', title: '结论', md: '数字域 $\\omega\\approx0$ 处，理想高通应该有 $-\\infty$ 的衰减，实际结果却高出 0 dB 十几分贝，而且**取的副本越多抬得越高**（本图只取了 $m=-5\\dots5$，即 11 项）。这不是"性能差"，是方法根本不适用。**高通、带阻一律不要用脉冲响应不变法。**' }
        ]
      },
      {
        id: 'cmp', num: '5', title: '与双线性变换的正向对比',
        blocks: [
          { t: 'table', cols: ['对比项', '脉冲响应不变法', '双线性变换法'], rows: [
            ['映射关系', '$z = e^{sT}$（指数，多对一）', '$z = \\dfrac{1+sT/2}{1-sT/2}$（分式，一对一）'],
            ['频率轴', '$\\omega = \\Omega T$，**线性、无畸变**', '$\\omega = 2\\arctan(\\Omega T/2)$，**非线性、需预畸变**'],
            ['混叠', '**必然存在**（周期延拓）', '不存在（一一映射）'],
            ['稳定性', '保持（$|e^{sT}|<1$）', '保持（左半平面→圆内）'],
            ['适用原型', '仅带限：低通、带通', '低通、高通、带通、带阻全适用'],
            ['时域意义', '数字响应 = 模拟响应**的采样**', '数字响应 ≠ 模拟响应的采样'],
            ['增益标定', '需乘 $T$（易错）', '按通带归一化即可'],
            ['工程地位', '基本被取代，仅仿真建模中使用', 'IIR 设计的**标准方法**']
          ] },
          { t: 'md', md: '一句话总结取舍：**要"线性频率轴 + 时域保真"就用脉冲响应不变法（并接受混叠）；要"无混叠 + 全类型"就用双线性变换（并接受频率畸变）。** 由于绝大多数工程需求是后者，双线性变换成为了事实标准。' }
        ]
      },
      {
        id: 'gain', num: '6', title: '增益因子 T 的处理与常见标定错误',
        blocks: [
          { t: 'md', md: '式 (1) 里的 $T$ 不是随便加的。它的作用是让数字滤波器与模拟原型在通带内具有**相同的增益**（而不是差一个 $1/T$ 因子）。推导见第 2 节：定义里乘 $T$ 恰好抵消了冲激串傅里叶变换带来的 $2\\pi/T$ 中的 $1/T$。' },
          { t: 'math', tex: '\\text{若误用 } h[n] = h_a(nT)\\text{（漏乘 }T\\text{）} \\;\\Rightarrow\\; \\text{增益差 } \\frac{1}{T} = f_s \\text{ 倍} \\;=\\; 20\\log_{10} f_s \\ \\mathrm{dB}', tag: '(4)' },
          { t: 'md', md: '例如 $f_s = 48$ kHz，漏乘 $T$ 会让增益差 $73.6$ dB——这个数字大到任何仿真都会立刻"看出不对"，但仍然有大量的初学者在这里卡住。' },
          { t: 'callout', kind: 'eng', title: '工程上最稳的做法：不要依赖 T，直接归一化', md: '与其纠结 $T$ 该不该乘、乘几次，不如设计一个"形状正确"的滤波器后**直接归一化**：低通令 $H(z=1)=1$（即 $\\sum b / \\sum a = 1$），带通令通带中心处增益为 1。这一步做完，$T$ 的取值就完全不影响结果了，也避免了对"差 $f_s$ 倍"的心算。这也是 `scipy.signal` 里 `bilinear` 之类的函数在实际工程代码里后面总跟着一行归一化的原因。' },
          { t: 'callout', kind: 'pit', title: '标定错误的其他来源', md: '1. **部分分式展开时漏掉 $A_k$ 的共轭对**：复极点必须成对处理，$H(z)=\\sum \\frac{TA_k}{1-e^{s_kT}z^{-1}}$ 中的 $A_k$ 是复数，实现时要把共轭两项合成实系数二阶节。\n2. **把 $T$ 乘了两次**：有的教材定义 $h[n]=h_a(nT)$ 并在频域补 $1/T$，两种约定混用就会差 $T^2$。\n3. **原型本身没归一化**：模拟 Butterworth 的 $H_a(0)$ 未必是 1，先检查再变换。' }
        ]
      },
      {
        id: 'use', num: '7', title: '它还有什么价值，以及误区',
        blocks: [
          { t: 'md', md: '在"设计滤波器"这件事上，脉冲响应不变法基本被双线性变换取代了。但它仍然有两个不可替代的场景：' },
          { t: 'md', md: '1. **脉冲响应建模与仿真**：如果目标是"让数字系统复现某个模拟系统的**时域**行为"（如水声信道的多途冲激响应、换能器的振铃、房间的声学冲激响应），那么直接采样 $h_a(t)$ 是最自然、最准确的做法——此时"混叠"本身就是物理事实的一部分，需要靠提高采样率来控制。\n2. **带通信号的数字下变频建模**：原型本身就是带限的，混叠量小，脉冲响应不变法能保持频率轴的线性关系，便于与模拟域的分析结果直接对照。' },
          { t: 'callout', kind: 'eng', title: '在信道仿真中的正确用法', md: '水声多途信道常建模为 $h_a(t)=\\sum_i a_i\\,\\delta(t-\\tau_i)$（稀疏多途）或加上 Rayleigh 衰落。仿真时直接按 $h[n]=h_a(nT)$ 离散即可，此时**不需要乘 $T$**，因为关心的是相对幅度与到达时间，且通常会对总能量归一化。若 $\\tau_i$ 不在采样点上，还要做分数时延插值（用 sinc 或加窗 sinc）——这一步比 $T$ 的标定重要得多。' },
          { t: 'callout', kind: 'pit', title: '① 忘了乘 T 导致增益差 f_s 倍', md: '见第 6 节。**最省事的解法是不依赖它**——直接按通带归一化。' },
          { t: 'callout', kind: 'pit', title: '② 用它设计高通或带阻', md: '求和发散，阻带被彻底填满。高通/带阻请一律使用双线性变换。' },
          { t: 'callout', kind: 'pit', title: '③ 认为加大阶数能压住混叠', md: '提高阶数确实能让原型在高频衰减更快，从而减小混叠，但**效果远不如提高采样率直接**。$n$ 阶原型的混叠地板大约按 $\\Omega^{-n}$ 下降，把阶数从 2 提到 6 才能换来相当于把采样率翻倍的效果。' },
          { t: 'callout', kind: 'pit', title: '④ 把"时域保真"误解为"等于模拟系统"', md: '即使没有混叠，采样后的 $h[n]$ 也只是 $h_a(t)$ 在采样点上的值；采样点之间的行为、以及高于 Nyquist 的成分都丢失了。做信道仿真时务必确认采样率覆盖了信道的全部有效带宽。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 7 章（Impulse Invariance）',
      'Proakis & Manolakis, Digital Signal Processing, 第 8 章',
      'Urick, Principles of Underwater Sound（多途信道建模）'
    ]
  });

  /* ============================================================
     7. 线性相位 FIR 与吉布斯现象
     ============================================================= */
  reg('theory/filter/linear-phase', {
    title: '线性相位 FIR 与吉布斯现象',
    lede: '线性相位意味着"波形只平移、不变形"——在雷达/声呐里波形就是信息，这是宁可多花十倍乘法器也要 FIR 的理由。而吉布斯现象告诉你：逼近理想矩形必然付出过冲代价，且这个代价不会随阶数消失。',
    tags: ['滤波', '线性相位', '群延迟', '吉布斯现象', '等波纹', 'Remez'],
    labs: [
      { path: 'lab/fir', title: 'FIR 滤波器设计实验台', desc: '切换窗型与阶数，观察过冲、过渡带与相位的联动' },
      { path: 'lab/window', title: '窗函数横向对比实验台', desc: '理解主瓣/旁瓣权衡如何决定过冲与阻带衰减' }
    ],
    toc: true,
    sections: [
      {
        id: 'cond', num: '1', title: '严格的线性相位条件：对称或反对称',
        blocks: [
          { t: 'md', md: '一个 FIR 具有严格线性相位的充要条件是它的系数关于中心点对称或反对称：' },
          { t: 'math', tex: 'h[n] = h[M-n]\\ \\text{（对称）}\\quad\\text{或}\\quad h[n] = -h[M-n]\\ \\text{（反对称）},\\qquad 0\\le n\\le M', tag: '(1)' },
          { t: 'md', md: '在此条件下，频率响应可以分离成一个**实函数**乘一个纯延迟因子：' },
          { t: 'math', tex: 'H(e^{j\\omega}) = A(\\omega)\\,e^{-j\\omega\\alpha},\\qquad \\alpha = \\frac{M}{2},\\quad A(\\omega)\\in\\mathbb{R}', tag: '(2)' },
          { t: 'md', md: '注意 $A(\\omega)$ 是实函数但**可以为负**；符号翻转时在相位里体现为额外的 $\\pi$ 跳变。这是理解四种类型相位曲线差别的关键。' },
          {
            t: 'fold', summary: '展开：由对称性推出式 (2)', deriv: true, blocks: [
              { t: 'md', md: '以 $M$ 为偶数（长度奇数，I 型）的对称情形为例。把 $H(e^{j\\omega})=\\sum_{n=0}^{M}h[n]e^{-j\\omega n}$ 按对称对配对，并提出中心因子 $e^{-j\\omega M/2}$：' },
              { t: 'math', tex: 'H(e^{j\\omega}) = e^{-j\\omega M/2}\\left[h[\\tfrac{M}{2}] + \\sum_{n=0}^{M/2-1} 2h[n]\\cos\\!\\big(\\omega(\\tfrac{M}{2}-n)\\big)\\right]' },
              { t: 'md', md: '括号内是 $\\omega$ 的实偶函数，记作 $A(\\omega)$；前面的因子 $e^{-j\\omega M/2}$ 就是纯延迟，**相位严格等于 $-\\omega M/2$**。' },
              { t: 'md', md: 'II 型（$M$ 奇数、长度偶数）配对后余下的是 $\\cos(\\omega(N-2n)/2)$ 这类**半整数**频率项，同样得到实函数 $A(\\omega)$ 与 $\\alpha=M/2$（半整数）。' },
              { t: 'md', md: '反对称情形（III/IV 型）配对后出现的是 $\\sin$ 项，于是 $A(\\omega)$ 变成**奇函数型**的实函数，并额外带来 $\\pi/2$ 的固定相移：$\\theta(\\omega) = -\\omega\\alpha + \\pi/2$（或 $-\\pi/2$）。这正好对应微分器与希尔伯特变换器的 $90^\\circ$ 相移。' }
            ]
          },
          { t: 'md', md: '反过来说也成立：若要求 FIR 具有严格线性相位，那么冲激响应必须对称或反对称。这是一条**充要条件**，没有第三条路。' }
        ]
      },
      {
        id: 'four', num: '2', title: '四种类型速查表与相位曲线',
        blocks: [
          { t: 'table', cols: ['类型', '对称', 'M 奇偶', '长度', 'α', 'H(ω) 形式', '相位 θ(ω)', '可做', '强制零点'], rows: [
            ['I', '对称', 'M 偶', '奇数', '$M/2$', '$A(\\omega)e^{-j\\omega\\alpha}$，$A$ 偶', '$-\\omega\\alpha$', '低/高/带通/带阻', '无'],
            ['II', '对称', 'M 奇', '偶数', '$M/2$', '$A(\\omega)e^{-j\\omega\\alpha}$，$A$ 奇', '$-\\omega\\alpha$（含 $\\pi$ 跳变）', '低通、带通', '$z=-1$'],
            ['III', '反对称', 'M 偶', '奇数', '$M/2$', '$jA(\\omega)e^{-j\\omega\\alpha}$', '$-\\omega\\alpha+\\pi/2$', '微分器、希尔伯特', '$z=\\pm1$'],
            ['IV', '反对称', 'M 奇', '偶数', '$M/2$', '$jA(\\omega)e^{-j\\omega\\alpha}$', '$-\\omega\\alpha+\\pi/2$', '微分器、希尔伯特', '$z=1$']
          ] },
          {
            t: 'plot', title: '真实计算：四种类型的相位曲线（斜率即群延迟）', height: 265,
            render: function (canvas) {
              const nfft = 1024, fc = 0.2;
              const mk = (N, anti) => {
                const a = (N - 1) / 2, w = C.window('hamming', N);
                const h = new Float64Array(N);
                const hd = C.idealLp(N - 1, fc);
                for (let n = 0; n < N; n++) h[n] = (anti ? -1 : 1) * hd[n] * w[n];
                return h;
              };
              const hI = mk(41, false);        // I 型：长度奇、对称
              const hII = mk(40, false);       // II 型：长度偶、对称
              const hIII = mk(41, true);       // III 型：长度奇、反对称
              const hIV = mk(40, true);        // IV 型：长度偶、反对称
              const ph = h => {
                const f = C.freqz(Array.from(h), [1], nfft, 1);
                const half = nfft >> 1, x = [], y = [];
                for (let i = 0; i < half; i++) { x.push(i / nfft); y.push(f.phase[i]); }
                return { x: x, y: y };
              };
              const pI = ph(hI), pII = ph(hII), pIII = ph(hIII), pIV = ph(hIV);
              const p = DSP.plot.new(canvas, { height: 265, xlabel: '归一化频率 f / f_s', ylabel: '相位 / rad', legend: true, legendPos: 'tr', xlim: [0, 0.5] });
              p.add({ x: pI.x, y: pI.y, color: 0, width: 1.8, label: 'I 型（α = 20，斜率 −20）' })
                .add({ x: pII.x, y: pII.y, color: 1, width: 1.6, label: 'II 型（含 π 跳变）' })
                .add({ x: pIII.x, y: pIII.y, color: 2, width: 1.6, dash: [5, 3], label: 'III 型（+π/2 偏置）' })
                .add({ x: pIV.x, y: pIV.y, color: 3, width: 1.6, dash: [2, 2], label: 'IV 型（+π/2 偏置）' })
                .draw();
            }
          },
          { t: 'md', md: '相位曲线的**斜率**就是群延迟。I 型是一条干净的直线；II 型在幅度过零处出现 $\\pi$ 的跳变（因为 $A(\\omega)$ 变号）；III/IV 型整体被抬高了 $\\pi/2$，这正是希尔伯特变换器需要的 $90^\\circ$ 相移。' }
        ]
      },
      {
        id: 'gd', num: '3', title: '群延迟与"波形不失真"的物理含义',
        blocks: [
          { t: 'math', tex: '\\text{无失真传输}\\ \\Longleftrightarrow\\ y[n] = A\\cdot x[n-n_d] \\ \\Longleftrightarrow\\ |H|=\\text{常数},\\ \\tau_g(\\omega)=-\\frac{d\\theta}{d\\omega}=n_d=\\text{常数}', tag: '(3)' },
          { t: 'md', md: '注意"无失真"允许两件事：**整体缩放**（幅度常数）和**整体平移**（延迟常数）。它不允许的是**形状改变**，而形状改变的唯一来源就是各频率分量被延迟得不一样。' },
          {
            t: 'plot', title: '关键对照：双音脉冲经线性相位 FIR 与非线性相位 IIR', height: 265,
            render: function (canvas) {
              const fs = 48000, n = 360;
              const t = Array.from(U.linspace(0, n / fs, n));
              const env = t.map(v => Math.exp(-Math.pow((v - 0.0037) / 0.0009, 2)));
              const x = new Float64Array(n);
              for (let i = 0; i < n; i++) {
                x[i] = env[i] * (Math.sin(2 * Math.PI * 1200 * t[i]) + Math.sin(2 * Math.PI * 6500 * t[i]));
              }
              const bF = Array.from(C.firWin({ order: 80, type: 'low', fc: 0.18, win: 'hamming' }));
              let s = 0; for (let i = 0; i < bF.length; i++) s += bF[i];
              const bn = bF.map(v => v / s);
              const yF = C.filter(bn, [1], x);
              const wc = 2 * Math.tan(Math.PI * 0.18);
              const ps = butterPoles(4, wc).map(z => C.bilinearZeros(z, 1));
              const zs = []; for (let i = 0; i < 4; i++) zs.push({ re: -1, im: 0 });
              const ba = zp2ba(zs, ps);
              const yI = C.filter(ba.b, ba.a, x);
              const ms = t.map(v => v * 1000);
              const p = DSP.plot.new(canvas, { height: 265, xlabel: 't / ms', ylabel: '幅度', legend: true, legendPos: 'tr' });
              p.add({ x: ms, y: Array.from(x), color: 3, width: 1.3, dash: [4, 3], label: '原始双音脉冲' })
                .add({ x: ms, y: Array.from(yF), color: 0, width: 1.8, label: 'FIR（线性相位）：整体右移 40 点，形状不变' })
                .add({ x: ms, y: Array.from(yI), color: 2, width: 1.8, label: 'IIR（非线性相位）：波形被扭曲' })
                .draw();
            }
          },
          { t: 'md', md: '输入是 $1.2$ kHz 与 $6.5$ kHz 两个分量的同包络叠加。FIR 输出只是整体右移了 $\\alpha=40$ 个采样点，两个分量的**相对相位保持不变**，波形形状完全保留；IIR 输出里两个分量被延迟了不同的时间，叠加后波形彻底变了样。' },
          { t: 'callout', kind: 'eng', title: '为什么工程上宁可要线性相位', md: '- **脉冲压缩**：匹配滤波的输出峰值位置就是距离。相位失真会把主瓣展宽、抬高旁瓣、让峰值漂移，直接损失距离分辨率与检测概率。\n- **测距/测深**：回波前沿或峰值的到达时刻是观测量，波形变形会让不同强度、不同频谱的回波产生**不一致的**测距偏差，无法用常数补偿。\n- **波束形成**：阵列各通道必须相位一致才能相干叠加。若各通道滤波器的相位响应不一致（哪怕只是延迟不同），主瓣指向就会偏、旁瓣就会升高。\n- **目标识别**：瞬态回波的"音色"由频谱的相位关系决定，非线性相位会抹掉这些特征。\n**一句话：只要后续算法靠"波形"而不是靠"能量"工作，就必须线性相位。**' },
          { t: 'callout', kind: 'tip', title: '延迟不是误差，延迟不一致才是', md: '线性相位滤波器的 $\\alpha=M/2$ 延迟是**可以精确补偿**的常数：从测距结果里减掉 $c\\alpha/(2f_s)$ 即可。真正致命的是随频率变化的延迟——它没有一个单一数值可以减。这也是为什么"FIR 延迟大"其实是个被夸大了的缺点。' }
        ]
      },
      {
        id: 'gibbs', num: '4', title: '吉布斯现象：截断的必然代价',
        blocks: [
          { t: 'md', md: '理想低通的 $h_d[n]$ 按 $1/n$ 衰减，衰减很慢。要把它变成有限长，只能截断——而截断在频域就是与窗的频谱卷积，把矩形的陡峭边沿"抹"成带过冲和振铃的形状。' },
          { t: 'math', tex: '\\text{过冲} \\approx 8.95\\%\\ (0.745\\ \\mathrm{dB}),\\quad \\text{与阶数 } M \\text{ 无关；过冲区宽度} \\propto \\frac{1}{M}', tag: '(4)' },
          {
            t: 'plot', title: '实测：矩形窗截断的过冲（线性幅度，阶数 40 / 80 / 160）', height: 265,
            render: function (canvas) {
              const nfft = 2048, fc = 0.2;
              const p = DSP.plot.new(canvas, { height: 265, xlabel: '归一化频率 f / f_s', ylabel: '|H|（线性）', legend: true, legendPos: 'tr', ylim: [0.9, 1.11], xlim: [0.1, 0.32] });
              [40, 80, 160].forEach((ord, i) => {
                const b = Array.from(C.firWin({ order: ord, type: 'low', fc: fc, win: 'rect' }));
                const f = C.freqz(b, [1], nfft, 1);
                const half = nfft >> 1, x = [], y = [];
                for (let j = 0; j < half; j++) { x.push(j / nfft); y.push(f.mag[j]); }
                p.add({ x: x, y: y, color: i, width: 1.7, label: 'M = ' + ord });
              });
              p.hline(1, { label: '理想值 1' })
                .hline(1.0895, { label: '1.0895（+8.95%）' })
                .vline(fc, { label: 'f_c' }).draw();
            }
          },
          { t: 'md', md: '三条曲线的最高点几乎都贴在 $1.0895$ 上——**阶数从 40 提到 160（4 倍），过冲一点没减小**，只是过冲区从很宽变成很窄。这就是吉布斯现象最反直觉的地方。' },
          {
            t: 'fold', summary: '展开：8.95% 的由来（正弦积分）', deriv: true, blocks: [
              { t: 'md', md: '矩形窗截断 = 取傅里叶级数的部分和。理想低通的 $N=2M+1$ 项部分和等于理想响应与狄利克雷核 $D_M$ 的卷积：' },
              { t: 'math', tex: 'H_M(\\omega) = \\frac{1}{2\\pi}\\int_{-\\omega_c}^{\\omega_c} D_M(\\omega-\\theta)\\,d\\theta,\\quad D_M(u)=\\frac{\\sin\\big((M+\\tfrac12)u\\big)}{\\sin(u/2)}' },
              { t: 'md', md: '令 $u=(M+\\tfrac12)(\\theta-\\omega_c)$，在 $M\\to\\infty$ 时 $\\sin(u/2)\\to u/2$，积分化为' },
              { t: 'math', tex: '\\lim_{M\\to\\infty}H_M\\!\\left(\\omega_c+\\frac{x}{M+\\tfrac12}\\right) = \\frac12 + \\frac{1}{\\pi}\\int_0^{x}\\frac{\\sin u}{u}\\,du' },
              { t: 'md', md: '$\\mathrm{Si}(x)=\\int_0^x \\frac{\\sin u}{u}du$ 的首个极大在 $x=\\pi$，$\\mathrm{Si}(\\pi)=1.85194$，代入得峰值 $=0.5+1.85194/\\pi = 1.08949$，即**过冲 8.95%**。该值与 $M$ 无关；$M$ 只出现在横坐标的缩放因子里，决定过冲区的宽度。' },
              { t: 'callout', kind: 'warn', title: '物理本质', md: '吉布斯现象不是"数值精度不够"，而是**用有限项去逼近一个不连续函数**的固有行为。只要目标响应有跳变（理想矩形的边沿就是跳变），过冲就必然存在。要消除它，唯一的出路是把"逼近理想矩形"这个目标本身换掉——即允许通带/阻带有波纹，换取整体最优，这就是第 6 节的等波纹设计。' }
            ]
          }
        ]
      },
      {
        id: 'window', num: '5', title: '加窗为什么能压过冲：拿过渡带换来的',
        blocks: [
          { t: 'md', md: '矩形窗的频谱旁瓣只衰减 $1/\\omega$，卷积后把大量能量洒到阻带，过冲自然大。换一个**两端平滑趋零**的窗（汉宁、汉明、凯泽），它的频谱旁瓣低、拖尾衰减快，卷积出来的过渡沿就平滑得多。' },
          {
            t: 'plot', title: '实测：矩形 / 汉宁 / 凯泽(β=8.6) 三种窗的过渡沿对比（M = 60）', height: 270,
            render: function (canvas) {
              const nfft = 2048, fc = 0.2, M = 60;
              const cases = [
                { k: 'rect', beta: 0, c: 0, nm: '矩形窗' },
                { k: 'hann', beta: 0, c: 1, nm: '汉宁窗' },
                { k: 'kaiser', beta: 8.6, c: 2, nm: '凯泽窗 β=8.6' }
              ];
              const p = DSP.plot.new(canvas, { height: 270, xlabel: '归一化频率 f / f_s', ylabel: '|H|（线性）', legend: true, legendPos: 'tr', ylim: [-0.03, 1.11], xlim: [0.1, 0.35] });
              cases.forEach(cs => {
                const b = Array.from(C.firWin({ order: M, type: 'low', fc: fc, win: cs.k, beta: cs.beta || undefined }));
                const f = C.freqz(b, [1], nfft, 1);
                const half = nfft >> 1, x = [], y = [];
                for (let j = 0; j < half; j++) { x.push(j / nfft); y.push(f.mag[j]); }
                p.add({ x: x, y: y, color: cs.c, width: 1.8, label: cs.nm });
              });
              p.hline(1, { label: '理想值 1' }).vline(fc, { label: 'f_c' }).draw();
            }
          },
          { t: 'table', cols: ['窗', '过冲', '过渡带（相对）', '阻带衰减', '代价'], rows: [
            ['矩形', '8.95%（最大）', '最窄', '约 −21 dB', '过冲大、阻带差'],
            ['汉宁', '约 0.2%', '约 2 倍', '约 −44 dB', '过渡带宽'],
            ['汉明', '约 0.2%', '约 2 倍', '约 −53 dB', '过渡带宽'],
            ['凯泽 β=8.6', '极小', '约 2.7 倍', '约 −80 dB', '过渡带最宽'],
            ['布莱克曼-哈里斯', '极小', '约 4 倍', '约 −92 dB', '过渡带极宽']
          ] },
          { t: 'md', md: '看这张表要抓住一条：**过冲、过渡带宽度、阻带衰减是同一个权衡的三个面**。压过冲与压阻带是同一件事（都靠降低窗旁瓣），代价都是过渡带变宽，而要维持同样的过渡带就必须加阶数。' },
          { t: 'callout', kind: 'eng', title: '工程上怎么选', md: '- 通带内**绝不能有波纹**、且对过渡带不敏感 → 凯泽窗 $\\beta$ 取 8~10，过冲几乎看不见。\n- 要窄过渡带、能容忍一点过冲 → 矩形或汉宁，阶数加大。\n- 被动声呐看强弱信号共存 → 优先低旁瓣窗（BH / 凯泽大 $\\beta$），因为**旁瓣就是动态范围**。\n- 做脉冲压缩的加权函数 → 常用汉明/凯泽，权衡主瓣展宽（分辨率损失）与旁瓣抑制（弱目标可见性）。' }
        ]
      },
      {
        id: 'remez', num: '6', title: '能不能彻底消除？等波纹（Remez）设计',
        blocks: [
          { t: 'md', md: '不能。只要目标是"逼近一个带跳变的理想响应"，过冲就属于该目标的一部分。真正能消除过冲的做法是**换目标**：不再要求逼近理想矩形，而是要求"最大误差最小化"——这就是 Parks-McClellan（Remez 交换算法）的等波纹设计。' },
          { t: 'table', cols: ['对比项', '窗函数法', '等波纹（Remez / PM）'], rows: [
            ['优化准则', '截断 + 加窗（闭式，无迭代）', '最小化最大加权误差（Chebyshev 最优）'],
            ['通带/阻带波纹', '由窗决定，无法独立控制', '可**独立指定** $\\delta_p$ 与 $\\delta_s$'],
            ['过渡带', '由窗主瓣决定，偏宽', '同阶数下**最窄**（最优）'],
            ['过冲', '由窗旁瓣决定', '被纳入误差指标，可控在 $\\delta_p$ 内'],
            ['阶数', '同指标下偏大', '同指标下通常省 30%~50%'],
            ['带任意形状', '不方便', '方便（任意幅度、多带、加权）'],
            ['实现', '手算即可，一行代码', '需迭代算法（scipy `remez` / MATLAB `firpm`）']
          ] },
          { t: 'md', md: '经验法则：达到同样的通带波纹 + 阻带衰减 + 过渡带，等波纹设计的阶数通常只有窗函数法的 **50%~70%**。对 60 dB / $\\Delta f = 0.04 f_s$ 的典型低通，凯泽窗约需 86 阶，等波纹约需 55~60 阶。' },
          codeBlock(
            "from scipy.signal import remez, freqz\n"
            + "import numpy as np\n\n"
            + "fs = 48000\n"
            + "bands = [0, 8000, 10000, fs/2]     # 通带 [0,8k]，阻带 [10k, 24k]\n"
            + "desired = [1, 0]\n"
            + "weight = [1, 20]                   # 阻带权重更大 -> 阻带波纹更小\n"
            + "h = remez(numtaps=60, bands=bands, desired=desired, weight=weight, fs=fs)\n"
            + "w, H = freqz(h, worN=8192, fs=fs)\n"
            + "# 等波纹设计下，通带与阻带的波纹都是等幅起伏的，这是最优性的标志\n",
            'python', 'Python：等波纹 FIR 设计'),
          { t: 'callout', kind: 'tip', title: '二者该怎么选', md: '**窗函数法**：设计快、系数有闭式、过渡沿单调（无波纹）、概念清晰，适合教学、快速原型、以及"过渡带附近不能有任何起伏"的场合（如某些测量系统）。\n**等波纹**：阶数最省、指标可精确指定、支持任意形状与加权，是工程实现的首选。\n实际工程里建议：**先用凯泽窗估一个阶数量级，再用等波纹按精确指标收敛**，最后把两者都画出来对比一次——如果过渡带附近出现异常起伏，往往是指标定得不合理。' }
        ]
      },
      {
        id: 'pit', num: '7', title: '误区',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① 以为加窗能消除吉布斯现象', md: '加窗是把过冲**摊平到更宽的过渡带**里，让阻带衰减变好，但截止点附近的过冲依然存在（只是从 8.95% 降到窗旁瓣决定的量级，如凯泽 $\\beta=8.6$ 时约 0.1%）。要真正消除，必须换设计准则（等波纹）或允许更宽的过渡带。' },
          { t: 'callout', kind: 'pit', title: '② 以为 FIR 阶数越高越接近理想、且没有代价', md: '提高阶数**只**改善过渡带宽度，不改善阻带衰减（那是窗旁瓣决定的），也不改善通带波纹（那是设计方法决定的）。代价却是实实在在的：群延迟线性增大、乘法量线性增大、定点实现的系数动态范围变大。**先定指标再定阶数，不要凭感觉加阶。**' },
          { t: 'callout', kind: 'pit', title: '③ 只看幅频不看相频', md: '两张幅频几乎一样的滤波器，一张线性相位、一张非线性，用在测距上就是"正常"与"误差巨大"的区别。**评价滤波器必须同时看幅频、相频、群延迟三条曲线**，这是 DSP 工程的基本功。' },
          { t: 'callout', kind: 'pit', title: '④ 用偶数长度做高通、或用奇数长度做希尔伯特变换器', md: '类型选错会撞上强制零点：II 型（偶长度、对称）在 $\\omega=\\pi$ 必为零点，做不了高通；IV 型（偶长度、反对称）在 $\\omega=0$ 必为零点，做不了低通。写代码时显式检查长度奇偶。' },
          { t: 'callout', kind: 'pit', title: '⑤ 认为"线性相位"等于"没有延迟"', md: '线性相位意味着**延迟恒定**，不是延迟为零。$\\alpha=M/2$ 个采样点的延迟是物理存在的，实时系统必须把它计入时延预算；只是它可以被精确补偿，而随频率变化的延迟不能。' },
          { t: 'callout', kind: 'pit', title: '⑥ 把通带波纹当成"噪声"去滤', md: '通带波纹是**确定性的**频率响应起伏，不是随机噪声，再滤波也去不掉，只会叠加更多起伏。若系统对通带平坦度有硬要求（如绝对幅度测量），应改设计指标或做频域幅度校正表。' }
        ]
      }
    ],
    refs: [
      'Oppenheim & Schafer, DTSP, 第 7 章（线性相位 FIR 与吉布斯现象）',
      'Parks & McClellan, "Chebyshev Approximation for Nonrecursive Digital Filters", IEEE Trans. Circuit Theory, 1973',
      'Hewlett-Packard / Harris, 窗函数与等波纹设计的工程对比'
    ]
  });

})(window);

/* =============================================================
   lab-conv.js —— 实验台⑦：线性卷积 vs 循环卷积动画
   路由：#/lab/conv

   教学主线：两种卷积的算式只差一个 mod。
     · 线性：y[n] = Σ x[k]·h[n−k]，长度 M+L−1，序列外面全当 0；
     · 循环：y[n] = Σ x[k]·h[(n−k) mod N]，序列被放到圆环上，
             下标算到负数就"绕回"末尾 —— 这一步就是混叠的物理来源。
   本台逐点推进动画，把"哪几项是从末尾绕回来的"和"哪几段被折叠了"都写出来。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  /* ------------------------- 预设序列 ------------------------- */
  const rnd2 = v => Math.round(v * 100) / 100;

  const XSETS = {
    x1: { label: '[1, 2, 3, 4]', v: [1, 2, 3, 4] },
    x2: { label: '[1, -1, 2]', v: [1, -1, 2] },
    x3: { label: '矩形脉冲 [1,1,1,1,1]', v: [1, 1, 1, 1, 1] },
    x4: { label: '指数衰减 [1,0.6,0.36,0.22,0.13]', v: [1, 0.6, 0.36, 0.22, 0.13] },
    x5: { label: '随机（固定种子）', v: null }
  };

  const HSETS = {
    h1: { label: '[1, 0.5, 0.25]', v: [1, 0.5, 0.25] },
    h2: { label: '一阶差分 [1, -1]', v: [1, -1] },
    h3: { label: '移动平均 [1,1,1,1]/4', v: [0.25, 0.25, 0.25, 0.25] },
    h4: { label: '对称平滑 [1,2,1]/4', v: [0.25, 0.5, 0.25] }
  };

  function seqOf(set, key, seed) {
    if (set[key].v) return Float64Array.from(set[key].v);
    const g = U.randn(5, seed || 20240921);
    const out = new Float64Array(5);
    for (let i = 0; i < 5; i++) out[i] = rnd2(g[i]);
    return out;
  }

  /* ------------------------- 动画状态 ------------------------- */
  let ctxRef = null;        // {st, P, ui}
  let cur = 0;              // 当前输出下标 n
  let timer = null;
  let playing = false;
  let prog = null;          // 进度滑块句柄
  let tblBody = null;       // 对比表容器
  let btnPlay = null;
  const SPEED = { slow: 1200, mid: 700, fast: 320 };
  let speedKey = 'mid';

  function stopPlay() {
    if (timer) { clearInterval(timer); timer = null; }
    playing = false;
    if (btnPlay) btnPlay.textContent = '▶ 播放';
  }

  function startPlay() {
    stopPlay();
    playing = true;
    if (btnPlay) btnPlay.textContent = '⏸ 暂停';
    timer = setInterval(function () {
      const len = outLen();
      cur = (cur + 1) % Math.max(1, len);
      if (prog) prog.set(cur, true);
      drawAll();
    }, SPEED[speedKey] || 700);
  }

  /** 当前输出序列长度 */
  function outLen() {
    if (!ctxRef) return 1;
    const st = ctxRef.st;
    if (st.mode === 'circ') return Math.round(st.N);
    const x = seqOf(XSETS, st.xs), hh = seqOf(HSETS, st.hs);
    return x.length + hh.length - 1;
  }

  /* ------------------------- 圆周示意图（自绘） ------------------------- */
  function drawRing(canvas, XN, HN, Nn, n, isLinear) {
    const W = Math.max(240, canvas.parentElement ? canvas.parentElement.clientWidth - 8 : 420);
    const H = 300;
    const c = U.setupCanvas(canvas, W, H);
    const ctx = c.ctx;
    const cx = W / 2, cy = H / 2 + 14;
    const R = Math.max(56, Math.min(W, H) / 2 - 52);
    const R1 = R * 0.94;          // 外圈：x[k]
    const R2 = R * 0.56;          // 内圈：h[(n−k) mod N]

    const area = U.themeColor('--plot-area') || '#fbfcfe';
    const grid = U.themeColor('--plot-grid') || '#e8ecf2';
    const axis = U.themeColor('--plot-axis') || '#9aa7b6';
    const label = U.themeColor('--plot-label') || '#55636f';
    const c1 = U.themeColor('--plot-c1') || '#1b5aa4';
    const c2 = U.themeColor('--plot-c2') || '#c2410c';
    const danger = U.themeColor('--danger') || '#b91c1c';

    ctx.fillStyle = area;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    [R1, R2].forEach(rr => {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, 6.2832);
      ctx.stroke();
    });

    let mx = 1e-9;
    for (let i = 0; i < Nn; i++) {
      mx = Math.max(mx, Math.abs(XN[i]), Math.abs(HN[i]));
    }
    const barOut = R * 0.16;      // 外圈杆长
    const barIn = R * 0.16;       // 内圈杆长

    for (let k = 0; k < Nn; k++) {
      const ang = -Math.PI / 2 + k * 2 * Math.PI / Nn;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const wrapped = (n - k) < 0;                 // 这一项是从 h 末尾绕回来的
      const idx = ((n - k) % Nn + Nn) % Nn;

      // 连接线
      ctx.strokeStyle = wrapped ? danger : grid;
      ctx.setLineDash(wrapped ? [3, 2] : []);
      ctx.lineWidth = wrapped ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + ca * R2, cy + sa * R2);
      ctx.lineTo(cx + ca * R1, cy + sa * R1);
      ctx.stroke();
      ctx.setLineDash([]);

      // 外圈杆：x[k]
      const lx = XN[k] / mx * barOut;
      ctx.strokeStyle = c1;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + ca * R1, cy + sa * R1);
      ctx.lineTo(cx + ca * (R1 + lx), cy + sa * (R1 + lx));
      ctx.stroke();
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.arc(cx + ca * (R1 + lx), cy + sa * (R1 + lx), 2.6, 0, 6.2832);
      ctx.fill();

      // 内圈杆：h[(n−k) mod N]（向内画）
      const lh = HN[idx] / mx * barIn;
      ctx.strokeStyle = c2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + ca * R2, cy + sa * R2);
      ctx.lineTo(cx + ca * (R2 - lh), cy + sa * (R2 - lh));
      ctx.stroke();
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.arc(cx + ca * (R2 - lh), cy + sa * (R2 - lh), 2.6, 0, 6.2832);
      ctx.fill();

      // 槽位编号
      const lx2 = cx + ca * (R1 + barOut + 12), ly2 = cy + sa * (R1 + barOut + 12);
      ctx.fillStyle = wrapped ? danger : label;
      ctx.font = '10.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((wrapped ? '↺' : '') + 'k=' + k, lx2, ly2);

      // 内侧标注 h 的下标
      ctx.fillStyle = wrapped ? danger : axis;
      ctx.font = '9.5px sans-serif';
      ctx.fillText('h[' + idx + ']', cx + ca * (R2 - barIn - 11), cy + sa * (R2 - barIn - 11));
    }

    // 说明文字
    ctx.fillStyle = label;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('外圈 = x[k]（蓝）　内圈 = h[(n−k) mod ' + Nn + ']（橙）', 8, 6);
    ctx.fillStyle = danger;
    ctx.fillText('红色 = n−k 为负，从末尾绕回的项（共 ' + Math.max(0, Math.min(Nn, n)) + ' 项）', 8, 21);
    ctx.fillStyle = label;
    ctx.fillText(isLinear ? '当前为线性模式，此圆周图仅供对照（线性卷积不使用 mod）'
      : '当前 n = ' + n + '：内圈相对外圈旋转了 ' + n + ' 格', 8, 36);
  }

  /**
   * lab-kit 的 ui.explain 只写入 data-tex 占位符，KaTeX 渲染只在整页渲染时做一次；
   * 动画/调参重写解读区后公式会变回空占位 —— 这里补一次渲染。
   */
  function renderExplainMath() {
    const cos = document.querySelectorAll('.callout.note');
    for (let i = 0; i < cos.length; i++) {
      if (cos[i].textContent.indexOf('画面解读') >= 0) { UI.renderMathIn(cos[i]); return; }
    }
  }

  /* ------------------------- 主绘制 ------------------------- */
  function drawAll() {
    if (!ctxRef) return;
    const st = ctxRef.st, P = ctxRef.P, ui = ctxRef.ui;

    const x = seqOf(XSETS, st.xs);
    const hh = seqOf(HSETS, st.hs);
    const Lx = x.length, Lh = hh.length;
    const Nn = Math.round(st.N);
    const circ = st.mode === 'circ';

    const XN = C.fitLength(x, Nn);
    const HN = C.fitLength(hh, Nn);
    const yLin = C.conv(x, hh);
    const Ly = yLin.length;
    const yCir = C.cconv(XN, HN, Nn);

    const outN = circ ? Nn : Ly;
    if (cur >= outN) cur = outN - 1;
    if (cur < 0) cur = 0;
    const n = cur;

    /* ---------- ① x[k] ---------- */
    const kx = circ ? C.arange(Nn) : C.arange(Lx);
    const vx = circ ? XN : x;
    const p1 = P.sx.plot;
    p1.opts.xlim = [-0.6, (circ ? Nn : Lx) - 0.4];
    p1.clear()
      .add({ x: kx, y: vx, type: 'stem', color: 0, width: 1.8, label: 'x[k]' })
      .draw();

    /* ---------- ② h[n−k]（翻转平移后的位置） ---------- */
    const K = circ ? Nn : Lx;
    const kg = C.arange(K);
    const vg = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      if (circ) {
        const idx = ((n - k) % Nn + Nn) % Nn;
        vg[k] = HN[idx];
      } else {
        const idx = n - k;
        vg[k] = (idx >= 0 && idx < Lh) ? hh[idx] : 0;
      }
    }
    const p2 = P.sh.plot;
    p2.opts.xlim = [-0.6, K - 0.4];
    p2.clear()
      .add({ x: kg, y: vg, type: 'stem', color: 1, width: 1.8, label: 'h[n−k]' })
      .vline(n, { label: '翻转轴 k=n=' + n, dash: [3, 3] })
      .draw();

    /* ---------- ③ 输出 y ---------- */
    const ky = C.arange(outN);
    const yv = circ ? yCir : yLin;
    const doneX = [], doneY = [], todoX = [], todoY = [];
    for (let i = 0; i < outN; i++) {
      if (i < n) { doneX.push(i); doneY.push(yv[i]); }
      else if (i > n) { todoX.push(i); todoY.push(0); }
    }
    const p3 = P.sy.plot;
    p3.opts.xlim = [-0.6, outN - 0.4];
    p3.clear()
      .add({ x: Float64Array.from(doneX), y: Float64Array.from(doneY), type: 'stem', color: 0, width: 2, label: '已算出' })
      .add({ x: Float64Array.from([n]), y: Float64Array.from([yv[n]]), type: 'stem', color: 2, width: 2.6, label: '当前 y[' + n + ']' })
      .add({ x: Float64Array.from(todoX), y: Float64Array.from(todoY), type: 'stem', color: 4, width: 1.2, alpha: 0.45, label: '未算出' })
      .annotate(n, yv[n], 'y[' + n + '] = ' + U.fmt(yv[n], 3), { dy: -8, size: 11 })
      .draw();

    /* ---------- ④ 圆周示意 ---------- */
    drawRing(P.ring.canvas, XN, HN, Nn, n, !circ);

    /* ---------- 计算式 ---------- */
    const terms = [];
    let acc = 0;
    for (let k = 0; k < K; k++) {
      const xv = circ ? XN[k] : x[k];
      let hv, idx;
      if (circ) {
        idx = ((n - k) % Nn + Nn) % Nn;
        hv = HN[idx];
      } else {
        idx = n - k;
        hv = (idx >= 0 && idx < Lh) ? hh[idx] : 0;
      }
      if (xv === 0 || hv === 0) continue;
      acc += xv * hv;
      terms.push({ k: k, idx: idx, xv: xv, hv: hv, wrapped: circ && (n - k) < 0 });
    }
    let formula = 'y[' + n + '] = ';
    const shown = terms.slice(0, 12);
    formula += shown.map(t => 'x[' + t.k + ']·h[' + (circ ? t.idx : t.idx) + ']').join(' + ');
    if (terms.length === 0) formula += '0';
    if (terms.length > shown.length) formula += ' + …（共 ' + terms.length + ' 项）';
    formula += ' = ' + shown.map(t => U.fmt(t.xv, 2) + '×' + U.fmt(t.hv, 2)).join(' + ') +
      (terms.length > shown.length ? ' + …' : '') + ' = ' + U.fmt(acc, 3);

    /* ---------- 绕回项说明 ---------- */
    let wrapTxt = '';
    if (circ) {
      const wt = terms.filter(t => t.wrapped);
      if (wt.length) {
        wrapTxt = '**从末尾绕回的项**：k = ' + wt.map(t => t.k).join('、') +
          ' —— 这些项的 $n-k$ 为负数（分别是 ' + wt.map(t => (n - t.k)).join('、') +
          '），循环卷积按 $(n-k)\\bmod ' + Nn + '$ 取到 $h$ 的末尾，实际用到的下标是 ' +
          wt.map(t => 'h[' + t.idx + ']').join('、') +
          '。线性卷积会直接把这些项判成 0，循环卷积却把序列尾部的样点搬到了输出端，这就是混叠的源头。';
      } else {
        wrapTxt = '**本帧没有绕回项**：所有 $k$ 都满足 $n-k \\geq 0$，此刻循环卷积与线性卷积在这一点的算式完全一致。';
      }
    } else {
      wrapTxt = '**线性模式下没有绕回**：$n-k$ 一旦为负就取 $h=0$（序列外面全是零），所以输出长度为 $M+L-1 = ' +
        Lx + '+' + Lh + '-1 = ' + Ly + '$ 点，之后自然归零。';
    }

    /* ---------- 混叠诊断 ---------- */
    const aliasN = Lx + Lh - 1;
    const hasAlias = Nn < aliasN;
    let maxErr = 0, errRows = [];
    for (let i = 0; i < Nn; i++) {
      const linV = i < Ly ? yLin[i] : 0;
      const d = yCir[i] - linV;
      if (Math.abs(d) > maxErr) maxErr = Math.abs(d);
      errRows.push({ n: i, lin: linV, cir: yCir[i], d: d });
    }
    const trunc = (Lx > Nn || Lh > Nn);

    let aliasTxt = '';
    if (circ) {
      const fold = [];
      for (let m = 1; m * Nn < Ly + Nn; m++) {
        const src = n + m * Nn;
        if (src < Ly && Math.abs(yLin[src]) > 1e-12) fold.push({ m: m, src: src, v: yLin[src] });
      }
      const linHere = n < Ly ? yLin[n] : 0;
      if (hasAlias) {
        aliasTxt = '**发生混叠**：$N = ' + Nn + '$，小于 $M+L-1 = ' + aliasN + '$。线性卷积的第 ' +
          (fold.length ? fold.map(f => f.src).join('、') : '（本点无）') +
          ' 号样点被折叠到输出端（$y_{circ}[' + n + '] = \\sum_m y_{lin}[' + n + '+mN]$' +
          (fold.length ? ' = ' + U.fmt(linHere, 3) + ' + ' + fold.map(f => U.fmt(f.v, 3)).join(' + ') : '') +
          '），于是这一点的输出不再等于线性卷积的 ' + U.fmt(linHere, 3) + '，凭空多出 ' +
          U.fmt(yCir[n] - linHere, 3) + '。要消掉混叠，把 $N$ 提到 $M+L-1 = ' + aliasN + '$ 以上即可（补零后再做循环卷积，结果就与线性卷积逐点相同）。';
      } else {
        aliasTxt = '**无混叠**：$N = ' + Nn + ' \\geq M+L-1 = ' + aliasN +
          '$，线性卷积的全部 ' + Ly + ' 个样点都能在圆环上排开，不需要折叠，因此循环卷积与线性卷积逐点相等（末端的补零点除外）。';
      }
      if (trunc) {
        aliasTxt += '　**另注意**：序列长度超过 $N$（$M=' + Lx + ', L=' + Lh + '$），超出部分已被**截断丢弃**，此时"折叠和"关系不再严格成立。';
      }
    } else {
      aliasTxt = '**线性模式**：输出就是教科书里的 $y[n]=\\sum_k x[k]h[n-k]$，没有任何折叠，长度 ' + Ly + ' 点。' +
        (Nn < aliasN ? '（若切到循环模式且保持 $N=' + Nn + '$，就会发生混叠）' : '');
    }

    /* ---------- 解读 ---------- */
    ui.explain(
      '**当前第 ' + n + ' 点**（共 ' + outN + ' 点）：' + (circ ? '循环卷积，$N = ' + Nn + '$' : '线性卷积，长度 $M+L-1 = ' + Ly + '$') +
      '，$x = ' + XSETS[st.xs].label + '$，$h = ' + HSETS[st.hs].label + '$。\n\n' +

      '**完整算式**：\n`' + formula + '`\n\n' +

      wrapTxt + '\n\n' + aliasTxt + '\n\n' +

      '**画面怎么看**：左上是 $x[k]$，右上是翻转平移后的 $h[n-k]$（虚线标出翻转轴 $k=n$，它每步右移一格）；' +
      '左下是输出 $y$，蓝色是已算出的点、绿色是当前正在算的点、灰色是还没算的点。右下是圆周排布：' +
      '外圈固定放 $x[k]$，内圈放 $h[(n-k)\\bmod N]$ 并随 $n$ 旋转，红色连线标出"从末尾绕回来"的项 —— 循环卷积与线性卷积的全部差别就集中在这几条红线上。'
    );
    renderExplainMath();

    ui.metrics([
      { label: '线性卷积长度 M+L−1', value: Ly, unit: '点' },
      { label: '循环长度 N', value: Nn, unit: '点' },
      { label: '是否混叠', value: circ ? (hasAlias ? '是' : '否') : '不适用', unit: '' },
      { label: '最大逐点误差', value: U.fmt(maxErr, 3), unit: '' },
      { label: '当前点 n', value: n, unit: '' },
      { label: '本点有效项数', value: terms.length, unit: '项' }
    ]);

    /* ---------- 对比表 ---------- */
    if (tblBody) {
      U.clear(tblBody);
      tblBody.appendChild(UI.table({
        cols: [{ title: 'n' }, { title: '线性结果 y_lin[n]', num: true }, { title: '循环结果 y_circ[n]', num: true }, { title: '差 = 循环 − 线性', num: true }],
        rows: errRows.map(r => [
          String(r.n),
          U.fmt(r.lin, 3),
          U.fmt(r.cir, 3),
          Math.abs(r.d) < 1e-9 ? '0' : U.fmt(r.d, 3) + '　← 混叠'
        ]),
        compact: true
      }));
      tblBody.appendChild(h('div.small.dim', {
        style: { marginTop: '6px' },
        text: '说明：线性结果一列中，n ≥ ' + Ly + ' 的位置按 0 计（线性卷积到此结束）。只要"差"列出现非零，就说明该点被别的样点折叠进来了。'
      }));
    }
  }

  /* ------------------------- 自定义动画控制条 ------------------------- */
  function buildBar(ui, st) {
    btnPlay = UI.button('▶ 播放', function () { playing ? stopPlay() : startPlay(); }, 'sm');
    const btnPrev = UI.button('◀ 上一步', function () {
      stopPlay();
      cur = Math.max(0, cur - 1);
      if (prog) prog.set(cur, true);
      drawAll();
    }, 'sm ghost');
    const btnNext = UI.button('下一步 ▶', function () {
      stopPlay();
      cur = Math.min(outLen() - 1, cur + 1);
      if (prog) prog.set(cur, true);
      drawAll();
    }, 'sm ghost');
    const btnReset = UI.button('回到起点', function () {
      stopPlay();
      cur = 0;
      if (prog) prog.set(cur, true);
      drawAll();
    }, 'sm ghost');

    const spd = UI.seg({
      label: '播放速度', value: 'mid',
      options: [
        { value: 'slow', label: '慢' },
        { value: 'mid', label: '中' },
        { value: 'fast', label: '快' }
      ],
      onChange: function (v) {
        speedKey = v;
        if (playing) startPlay();
      }
    });

    prog = UI.slider({
      label: '当前输出下标 n', min: 0, max: Math.max(1, outLen() - 1), step: 1, value: 0,
      fmt: v => String(Math.round(v)),
      onInput: function (v) {
        stopPlay();
        cur = Math.round(v);
        drawAll();
      }
    });

    const bar = h('div.card', { style: { marginTop: 'var(--sp-4)' } }, [
      h('div.card-hd', {}, [
        h('span.accent-bar'),
        h('span', { text: '动画控制（逐点推进）' }),
        h('div.right', {}, [btnPlay, btnPrev, btnNext, btnReset])
      ]),
      h('div.card-bd', {}, [prog.el, spd.el])
    ]);

    tblBody = h('div');
    const tblCard = h('div.card', { style: { marginTop: 'var(--sp-4)' } }, [
      h('div.card-hd', {}, [
        h('span.accent-bar'),
        h('span', { text: '线性结果 vs 循环结果（逐点对照）' }),
        h('div.right', {}, h('span.small.dim', { text: 'N 变化时本表随之刷新' }))
      ]),
      h('div.card-bd', {}, tblBody)
    ]);

    ui.extra(h('div', {}, [bar, tblCard]));
  }

  /* ------------------------- 注册 ------------------------- */
  DSP.lab.create({
    path: 'lab/conv',
    title: '线性卷积 vs 循环卷积动画',
    lede: '两条算式只差一个 mod，结果却可能天差地别。逐点推进动画，看清"哪几项从末尾绕回来"，以及混叠是怎么把远处样点折叠到输出端的。',
    tags: ['卷积', '循环卷积', '混叠', '交互实验台'],
    params: [
      {
        k: 'xs', type: 'select', label: '输入序列 x', value: 'x1',
        options: Object.keys(XSETS).map(k => ({ value: k, label: XSETS[k].label })),
        hint: '序列长度 M 参与决定线性卷积长度 M+L−1'
      },
      {
        k: 'hs', type: 'select', label: '冲激响应 h', value: 'h1',
        options: Object.keys(HSETS).map(k => ({ value: k, label: HSETS[k].label })),
        hint: '低通 / 差分 / 平滑，可对比各自的"能量是否被保留"'
      },
      {
        k: 'mode', type: 'seg', label: '卷积模式', value: 'circ',
        options: [
          { value: 'lin', label: '线性卷积' },
          { value: 'circ', label: '循环卷积' }
        ],
        hint: '循环模式下才出现 mod 运算与绕回项'
      },
      {
        k: 'N', type: 'slider', label: '循环长度 N', min: 4, max: 16, step: 1, value: 8, unit: '点',
        hint: 'N < M+L−1 时必然混叠；把 N 提到 M+L−1 以上，循环卷积就等于线性卷积'
      }
    ],
    plots: [
      { key: 'sx', title: '① x[k]（循环模式下补零/截断到 N 点）', height: 220, opts: { xlabel: 'k', ylabel: 'x[k]' } },
      { key: 'sh', title: '② h[n−k]：翻转 + 平移后的位置', height: 220, opts: { xlabel: 'k', ylabel: 'h[n−k]' } },
      { key: 'sy', title: '③ 输出 y[n]（蓝=已算 / 绿=当前 / 灰=未算）', height: 240, opts: { xlabel: 'n', ylabel: 'y[n]', legend: true } },
      { key: 'ring', title: '④ 圆周排布示意（外圈 x，内圈 h，红线=绕回项）', type: 'raw', height: 300 }
    ],
    cols: 2,
    build: function (el, ui, P, st) {
      ctxRef = { st: st, P: P, ui: ui };
      cur = 0;
      buildBar(ui, st);
    },
    update: function (st, P, ui) {
      ctxRef = { st: st, P: P, ui: ui };
      // N / 模式 / 序列变化后同步进度滑块量程
      if (prog) {
        const maxN = Math.max(1, outLen() - 1);
        const inp = prog.el.querySelector('input[type=range]');
        if (inp) inp.max = String(maxN);
        if (cur > maxN) { cur = maxN; prog.set(cur, true); }
      }
      drawAll();
    },
    cleanup: function () {
      stopPlay();
      ctxRef = null;
    },
    advice: '先用默认的 x=[1,2,3,4]、h=[1,0.5,0.25]、N=8 看一遍：线性卷积长度 6，小于 N=8，所以第 0~5 点循环与线性完全一致，末尾两个补零点也不产生误差。接着把 N 一路拉到 4，从 n=4 开始"差"列立刻出现非零 —— 那是 y_lin[4]、y_lin[5] 被折叠回来叠加到了 y_circ[0]、y_circ[1] 上。然后切到线性模式对比：n≥4 之后输出自然归零，没有任何外来项。想看最夸张的混叠，选 x=矩形脉冲（长 5）+ h=移动平均（长 4），N=4 时几乎每一个输出点都被污染。',
    eng: '用 FFT 做快速卷积时，循环卷积不是"近似"，而是 FFT 的自然产物：时域圆周卷积对应频域逐点相乘，所以必须先把 x 与 h 各补零到 L ≥ M+L−1 再做 N 点 FFT，否则得到的就是混叠结果——这是工程上最常见的踩坑点，且症状隐蔽：输出长度看起来正常，只是边缘几十个样点偏大，等到做匹配滤波或图像二维卷积时表现为"边界发亮"。分段卷积（重叠相加 / 重叠保留）本质上就是把长序列切成段、每段按 M+L−1 补零，再把段间重叠的 L−1 点加回去。实时系统里还要记住：循环缓冲区天然就是"圆周"的，指针回绕本身就是一次 mod，写代码时别把"绕回"当成越界错误处理掉。',
    wrong: '典型错误一：以为"循环卷积 = 线性卷积取前 N 点"。只有当 N ≥ M+L−1 时才成立；N 更小的时候，被丢掉的不是尾部，而是被折叠回头部叠加起来，输出端每一个点都可能错。典型错误二：做 FFT 快速卷积时按 max(M, L) 选 FFT 点数，忘了应该是 M+L−1（通常再向上取到 2 的整数次幂）。典型错误三：把"补零"当成"截断"的反操作——补零到 N 只是把圆环上的空位填上 0，不会恢复任何被截断丢失的信息。',
    see: [
      { path: 'theory/filter/conv', title: '线性卷积与循环卷积' },
      { path: 'theory/transform/fft', title: 'FFT 快速傅里叶变换与蝶形运算' }
    ]
  });
})(window);

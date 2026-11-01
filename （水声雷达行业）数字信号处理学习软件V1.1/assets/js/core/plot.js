/* =============================================================
   plot.js —— 轻量 Canvas 2D 绘图引擎（零依赖，主题自适应）
   全局命名空间：window.DSP.plot

   设计目标：
     · 面向信号与频谱：线图 / 杆图 / 散点 / 阶跃 / 热力图 / 极坐标 / 零极点
     · 主题自适应：颜色取自 CSS 变量，切换深浅色后 redrawAll() 即可
     · 支持 hover 十字线与坐标读数、图例、参考线、高亮带
     · 高 DPI 屏自动缩放（devicePixelRatio）

   典型用法：
     const p = DSP.plot.new(canvasEl, {height:240, xlabel:'t / s', ylabel:'x(t)'});
     p.add({x:t, y:sig, type:'line', color:0, label:'原始信号'});
     p.vline(0.02, {label:'回波到达'});
     p.draw();
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;

  const PALETTE = ['--plot-c1', '--plot-c2', '--plot-c3', '--plot-c4', '--plot-c5'];

  /** 解析 #rgb / #rrggbb / rgb() / rgba() → [r,g,b] */
  function parseColor(c) {
    if (!c) return [0, 0, 0];
    c = String(c).trim();
    if (c[0] === '#') {
      if (c.length === 4) return [parseInt(c[1] + c[1], 16), parseInt(c[2] + c[2], 16), parseInt(c[3] + c[3], 16)];
      return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map(v => parseFloat(v));
      return [p[0] | 0, p[1] | 0, p[2] | 0];
    }
    return [0, 0, 0];
  }

  const rgbStr = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')';

  /** 颜色线性插值 */
  function mix(c1, c2, t) {
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * t),
      Math.round(c1[1] + (c2[1] - c1[1]) * t),
      Math.round(c1[2] + (c2[2] - c1[2]) * t)
    ];
  }

  /** 取调色板颜色（第 i 条曲线） */
  function pal(i) {
    return U.themeColor(PALETTE[i % PALETTE.length]) || '#1b5aa4';
  }

  /** nice 刻度：返回 {ticks:[...], step} */
  function niceTicks(min, max, target) {
    target = target || 6;
    if (!isFinite(min) || !isFinite(max) || min === max) {
      return { ticks: [min || 0], step: 1 };
    }
    const raw = (max - min) / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    step *= mag;
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { ticks: ticks, step: step };
  }

  /** 刻度值格式化 */
  function fmtTick(v, step) {
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e5 || (a < 1e-3 && a > 0)) {
      return v.toExponential(1).replace('e+', 'e');
    }
    const dec = Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
    let s = v.toFixed(dec);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  /* ============================================================
     主绘图类
     ============================================================ */
  function Plot(canvas, opts) {
    this.canvas = canvas;
    this.opts = Object.assign({
      width: null,          // null → 自适应容器宽度
      height: 260,
      padding: { l: 58, r: 16, t: 24, b: 34 },
      xlabel: '', ylabel: '', title: '',
      xlim: null, ylim: null,
      grid: true, legend: false, legendPos: 'tr',
      zeroLine: true, hover: false,
      xTickFmt: null, yTickFmt: null,
      logY: false
    }, opts || {});
    this.series = [];
    this.vlines = [];
    this.hlines = [];
    this.bands = [];
    this.annotations = [];
    this._hover = null;
    this._hoverCb = null;
    if (this.opts.hover) this._bindHover();
    this._color = null;
  }

  /** 容器宽度自适应 */
  Plot.prototype._width = function () {
    if (this.opts.width) return this.opts.width;
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth - 8 : 640;
    return Math.max(240, w);
  };

  Plot.prototype._theme = function () {
    if (!this._color) {
      this._color = {
        bg: U.themeColor('--plot-bg') || '#fff',
        area: U.themeColor('--plot-area') || '#fbfcfe',
        grid: U.themeColor('--plot-grid') || '#e8ecf2',
        axis: U.themeColor('--plot-axis') || '#9aa7b6',
        label: U.themeColor('--plot-label') || '#55636f'
      };
    }
    return this._color;
  };

  /** 添加数据序列 */
  Plot.prototype.add = function (s) {
    this.series.push(Object.assign({
      type: 'line', width: 1.6, dash: null, alpha: 1, label: '', fill: false, size: 3
    }, s));
    return this;
  };

  Plot.prototype.vline = function (x, o) { this.vlines.push(Object.assign({ x: x }, o)); return this; };
  Plot.prototype.hline = function (y, o) { this.hlines.push(Object.assign({ y: y }, o)); return this; };
  Plot.prototype.band = function (x0, x1, o) { this.bands.push(Object.assign({ x0: x0, x1: x1 }, o)); return this; };
  Plot.prototype.annotate = function (x, y, text, o) { this.annotations.push(Object.assign({ x: x, y: y, text: text }, o)); return this; };
  Plot.prototype.onHover = function (cb) { this._hoverCb = cb; return this; };
  Plot.prototype.clear = function () {
    this.series = []; this.vlines = []; this.hlines = []; this.bands = []; this.annotations = [];
    return this;
  };

  /** 数据范围（自动定标） */
  Plot.prototype._range = function () {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of this.series) {
      const xs = s.x, ys = s.y;
      if (!xs || !ys) continue;
      const n = Math.min(xs.length, ys.length);
      for (let i = 0; i < n; i++) {
        const xv = xs[i], yv = ys[i];
        if (!isFinite(xv) || !isFinite(yv)) continue;
        if (xv < x0) x0 = xv; if (xv > x1) x1 = xv;
        if (yv < y0) y0 = yv; if (yv > y1) y1 = yv;
      }
      // 杆图/散点额外考虑 y=0 基线
      if (s.type === 'stem' && 0 < y0) y0 = 0;
    }
    if (!isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
    if (x0 === x1) { x0 -= 0.5; x1 += 0.5; }
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    // 留 5% 边距
    const ypad = (y1 - y0) * 0.06;
    return {
      x0: this.opts.xlim ? this.opts.xlim[0] : x0,
      x1: this.opts.xlim ? this.opts.xlim[1] : x1,
      y0: this.opts.ylim ? this.opts.ylim[0] : y0 - ypad,
      y1: this.opts.ylim ? this.opts.ylim[1] : y1 + ypad
    };
  };

  Plot.prototype._bindHover = function () {
    const self = this;
    const cv = this.canvas;
    cv.addEventListener('mousemove', function (e) {
      const r = cv.getBoundingClientRect();
      self._hover = { px: e.clientX - r.left, py: e.clientY - r.top };
      self.draw();
    });
    cv.addEventListener('mouseleave', function () {
      self._hover = null;
      if (self._hoverCb) self._hoverCb(null);
      self.draw();
    });
  };

  /** 绘制 */
  Plot.prototype.draw = function () {
    const o = this.opts, cv = this.canvas;
    const W = this._width(), H = o.height;
    const c = U.setupCanvas(cv, W, H);
    const ctx = c.ctx, th = this._theme();
    const pad = o.padding;
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    if (pw <= 10 || ph <= 10) return this;

    // 背景
    ctx.fillStyle = th.area;
    ctx.fillRect(pad.l, pad.t, pw, ph);

    const R = this._range();
    const X = v => pad.l + (v - R.x0) / (R.x1 - R.x0) * pw;
    const Y = v => pad.t + ph - (v - R.y0) / (R.y1 - R.y0) * ph;

    // 网格
    const xt = niceTicks(R.x0, R.x1, Math.max(3, Math.round(pw / 90)));
    const yt = niceTicks(R.y0, R.y1, Math.max(3, Math.round(ph / 48)));
    ctx.save();
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    if (o.grid) {
      xt.ticks.forEach(v => {
        const px = Math.round(X(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + ph); ctx.stroke();
      });
      yt.ticks.forEach(v => {
        const py = Math.round(Y(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(pad.l + pw, py); ctx.stroke();
      });
    }
    ctx.restore();

    // 零线（加粗）
    if (o.zeroLine) {
      if (R.y0 < 0 && R.y1 > 0) {
        ctx.strokeStyle = th.axis; ctx.lineWidth = 1; ctx.setLineDash([]);
        const py = Math.round(Y(0)) + 0.5;
        ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(pad.l + pw, py); ctx.stroke();
      }
    }

    // 高亮带
    this.bands.forEach(b => {
      const a = X(Math.max(b.x0, R.x0)), z = X(Math.min(b.x1, R.x1));
      ctx.fillStyle = rgbStr(parseColor(b.color || pal(4)), b.alpha === undefined ? 0.12 : b.alpha);
      ctx.fillRect(a, pad.t, z - a, ph);
    });

    // 数据序列
    this.series.forEach((s, si) => {
      if (!s.x || !s.y) return;
      const col = s.color !== undefined
        ? (typeof s.color === 'number' ? pal(s.color) : s.color)
        : pal(si);
      const rgba = c2 => rgbStr(parseColor(c2), s.alpha);
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.l, pad.t, pw, ph);
      ctx.clip();
      ctx.strokeStyle = rgba(col);
      ctx.fillStyle = rgba(col);
      ctx.lineWidth = s.width;
      ctx.setLineDash(s.dash || []);
      ctx.lineJoin = 'round';

      const n = Math.min(s.x.length, s.y.length);
      // 抽稀：像素级密度下每列最多画 2 点，保证大数据量流畅
      const stride = Math.max(1, Math.floor(n / (pw * 2)));

      if (s.type === 'stem') {
        ctx.beginPath();
        const yBase = Y(0);
        for (let i = 0; i < n; i += stride) {
          const px = X(s.x[i]), py = Y(s.y[i]);
          ctx.moveTo(px, yBase); ctx.lineTo(px, py);
        }
        ctx.stroke();
        // 杆顶圆点
        ctx.setLineDash([]);
        const dotR = Math.min(3, Math.max(1.4, pw / n / 2));
        for (let i = 0; i < n; i += stride) {
          ctx.beginPath();
          ctx.arc(X(s.x[i]), Y(s.y[i]), dotR, 0, 6.2832);
          ctx.fill();
        }
      } else if (s.type === 'scatter') {
        ctx.setLineDash([]);
        for (let i = 0; i < n; i += stride) {
          ctx.beginPath();
          ctx.arc(X(s.x[i]), Y(s.y[i]), s.size, 0, 6.2832);
          ctx.fill();
        }
      } else if (s.type === 'step') {
        ctx.beginPath();
        let px0 = X(s.x[0]), py = Y(s.y[0]);
        ctx.moveTo(px0, py);
        for (let i = 1; i < n; i += stride) {
          const px = X(s.x[i]);
          ctx.lineTo(px, py);
          py = Y(s.y[i]);
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      } else { // line
        if (s.fill) {
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(X(s.x[0]), Y(0));
          for (let i = 0; i < n; i += stride) ctx.lineTo(X(s.x[i]), Y(s.y[i]));
          ctx.lineTo(X(s.x[n - 1]), Y(0));
          ctx.closePath();
          ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
          ctx.setLineDash(s.dash || []);
        }
        ctx.beginPath();
        ctx.moveTo(X(s.x[0]), Y(s.y[0]));
        for (let i = stride; i < n; i += stride) ctx.lineTo(X(s.x[i]), Y(s.y[i]));
        if (stride > 1) ctx.lineTo(X(s.x[n - 1]), Y(s.y[n - 1]));
        ctx.stroke();
      }
      ctx.restore();
    });

    // 参考线
    ctx.save();
    this.vlines.forEach(v => {
      if (v.x < R.x0 || v.x > R.x1) return;
      const px = X(v.x);
      ctx.strokeStyle = v.color || U.themeColor('--danger') || '#b91c1c';
      ctx.setLineDash(v.dash || [4, 3]);
      ctx.lineWidth = v.width || 1.2;
      ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + ph); ctx.stroke();
      if (v.label) {
        ctx.setLineDash([]);
        ctx.fillStyle = v.color || U.themeColor('--danger') || '#b91c1c';
        ctx.font = '11px ' + (U.themeColor('--font-mono') || 'monospace');
        ctx.textAlign = px > pad.l + pw * 0.7 ? 'right' : 'left';
        ctx.fillText(v.label, px + (px > pad.l + pw * 0.7 ? -4 : 4), pad.t + 12);
      }
    });
    this.hlines.forEach(hh => {
      if (hh.y < R.y0 || hh.y > R.y1) return;
      const py = Y(hh.y);
      ctx.strokeStyle = hh.color || U.themeColor('--warn') || '#b45309';
      ctx.setLineDash(hh.dash || [5, 4]);
      ctx.lineWidth = hh.width || 1.2;
      ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(pad.l + pw, py); ctx.stroke();
      if (hh.label) {
        ctx.setLineDash([]);
        ctx.fillStyle = hh.color || U.themeColor('--warn') || '#b45309';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(hh.label, pad.l + 4, py - 4);
      }
    });
    ctx.restore();

    // 标注文字
    this.annotations.forEach(a => {
      ctx.fillStyle = a.color || th.label;
      ctx.font = (a.size || 11) + 'px ' + (a.mono ? 'monospace' : 'sans-serif');
      ctx.textAlign = a.align || 'center';
      ctx.fillText(a.text, X(a.x) + (a.dx || 0), Y(a.y) + (a.dy || -4));
    });

    // 坐标轴边框与刻度标签
    ctx.strokeStyle = th.axis; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw - 1, ph - 1);
    ctx.fillStyle = th.label;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xt.ticks.forEach(v => {
      ctx.fillText(o.xTickFmt ? o.xTickFmt(v) : fmtTick(v, xt.step), X(v), pad.t + ph + 5);
    });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.ticks.forEach(v => {
      ctx.fillText(o.yTickFmt ? o.yTickFmt(v) : fmtTick(v, yt.step), pad.l - 6, Y(v));
    });

    // 轴标题
    ctx.fillStyle = th.label;
    ctx.font = '11.5px sans-serif';
    if (o.xlabel) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(o.xlabel, pad.l + pw / 2, H - 2); }
    if (o.ylabel) {
      ctx.save();
      ctx.translate(11, pad.t + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(o.ylabel, 0, 0);
      ctx.restore();
    }
    if (o.title) {
      ctx.fillStyle = U.themeColor('--text-strong') || '#000';
      ctx.font = '600 12.5px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(o.title, pad.l, 4);
    }

    // 图例
    if (o.legend && this.series.some(s => s.label)) {
      const items = this.series.filter(s => s.label);
      ctx.font = '11px sans-serif';
      let tw = 0;
      items.forEach((s, i) => {
        tw = Math.max(tw, ctx.measureText(s.label).width + 26);
      });
      const lgW = tw + 10, lgH = items.length * 15 + 8;
      const lx = o.legendPos === 'tl' ? pad.l + 6 : pad.l + pw - lgW - 6;
      const ly = pad.t + 6;
      ctx.fillStyle = rgbStr(parseColor(th.bg), 0.92);
      ctx.strokeStyle = th.grid;
      ctx.fillRect(lx, ly, lgW, lgH);
      ctx.strokeRect(lx + 0.5, ly + 0.5, lgW - 1, lgH - 1);
      items.forEach((s, i) => {
        const col = s.color !== undefined ? (typeof s.color === 'number' ? pal(s.color) : s.color) : pal(this.series.indexOf(s));
        const yy = ly + 12 + i * 15;
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(lx + 6, yy); ctx.lineTo(lx + 20, yy); ctx.stroke();
        ctx.fillStyle = th.label; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(s.label, lx + 24, yy);
      });
    }

    // hover 十字线
    if (this._hover) {
      const hx = this._hover.px, hy = this._hover.py;
      if (hx >= pad.l && hx <= pad.l + pw && hy >= pad.t && hy <= pad.t + ph) {
        const vx = R.x0 + (hx - pad.l) / pw * (R.x1 - R.x0);
        const vy = R.y1 - (hy - pad.t) / ph * (R.y1 - R.y0);
        ctx.save();
        ctx.strokeStyle = rgbStr(parseColor(U.themeColor('--accent') || '#1b5aa4'), 0.55);
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx, pad.t); ctx.lineTo(hx, pad.t + ph);
        ctx.moveTo(pad.l, hy); ctx.lineTo(pad.l + pw, hy);
        ctx.stroke();
        ctx.restore();
        if (this._hoverCb) this._hoverCb({ x: vx, y: vy, px: hx, py: hy });
      }
    }

    // 记录坐标映射供外部使用
    this._map = { X: X, Y: Y, R: R, pad: pad, pw: pw, ph: ph };
    return this;
  };

  /** 数据坐标 → 像素（需在 draw 之后调用） */
  Plot.prototype.toPx = function (x, y) {
    return this._map ? { px: this._map.X(x), py: this._map.Y(y) } : null;
  };

  /** 像素 → 数据坐标 */
  Plot.prototype.toData = function (px, py) {
    if (!this._map) return null;
    const m = this._map;
    return {
      x: m.R.x0 + (px - m.pad.l) / m.pw * (m.R.x1 - m.R.x0),
      y: m.R.y1 - (py - m.pad.t) / m.ph * (m.R.y1 - m.R.y0)
    };
  };

  /* ============================================================
     热力图（时频图 / 谱图 / 模糊函数 / 相关矩阵）
     ============================================================ */
  function heatmap(canvas, o) {
    const W = Math.max(240, o.width || (canvas.parentElement ? canvas.parentElement.clientWidth - 8 : 640));
    const H = o.height || 300;
    const c = U.setupCanvas(canvas, W, H);
    const ctx = c.ctx;
    const pad = o.padding || { l: 58, r: 16, t: 22, b: 34 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const cols = o.cols, rows = o.rows, data = o.data;

    const cLow = parseColor(U.themeColor('--plot-cmap-low') || '#f7fbff');
    const cMid = parseColor(U.themeColor('--plot-cmap-mid') || '#4a90d9');
    const cHigh = parseColor(U.themeColor('--plot-cmap-high') || '#f97316');
    const th = {
      grid: U.themeColor('--plot-grid') || '#e8ecf2',
      axis: U.themeColor('--plot-axis') || '#9aa7b6',
      label: U.themeColor('--plot-label') || '#55636f',
      area: U.themeColor('--plot-area') || '#fbfcfe'
    };

    // 值域
    let vmin = o.vmin, vmax = o.vmax;
    if (vmin === undefined || vmax === undefined) {
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < data.length; i++) { if (data[i] < mn) mn = data[i]; if (data[i] > mx) mx = data[i]; }
      if (vmin === undefined) vmin = mn;
      if (vmax === undefined) vmax = mx;
    }
    if (vmax === vmin) vmax = vmin + 1;

    // 逐像素块绘制（用 ImageData 加速）
    // data 布局：帧优先 data[frame*bins + bin]；图上 x=时间(帧)=列，y=频率(bin)=行
    const img = ctx.createImageData(cols, rows);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const v = (data[k * rows + r] - vmin) / (vmax - vmin);
        const t = Math.max(0, Math.min(1, v));
        const col = t < 0.5 ? mix(cLow, cMid, t * 2) : mix(cMid, cHigh, (t - 0.5) * 2);
        const srcRow = o.flipY ? (rows - 1 - r) : r;      // flipY: 低频在下
        const di = (srcRow * cols + k) * 4;
        img.data[di] = col[0]; img.data[di + 1] = col[1]; img.data[di + 2] = col[2]; img.data[di + 3] = 255;
      }
    }
    // 用离屏 canvas 缩放绘制
    const off = document.createElement('canvas');
    off.width = cols; off.height = rows;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = o.smooth !== false;
    ctx.fillStyle = th.area;
    ctx.fillRect(pad.l, pad.t, pw, ph);
    ctx.drawImage(off, pad.l, pad.t, pw, ph);

    // 边框与刻度
    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw - 1, ph - 1);
    ctx.fillStyle = th.label; ctx.font = '11px sans-serif';

    const xr = o.xlim || [0, cols - 1], yr = o.ylim || [0, rows - 1];
    const X = v => pad.l + (v - xr[0]) / (xr[1] - xr[0]) * pw;
    const Y = v => pad.t + ph - (v - yr[0]) / (yr[1] - yr[0]) * ph;
    const xt = niceTicks(xr[0], xr[1], Math.max(3, Math.round(pw / 90)));
    const yt = niceTicks(yr[0], yr[1], Math.max(3, Math.round(ph / 48)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xt.ticks.forEach(v => ctx.fillText(fmtTick(v, xt.step), X(v), pad.t + ph + 5));
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.ticks.forEach(v => ctx.fillText(fmtTick(v, yt.step), pad.l - 6, Y(v)));
    ctx.font = '11.5px sans-serif';
    if (o.xlabel) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(o.xlabel, pad.l + pw / 2, H - 2); }
    if (o.ylabel) {
      ctx.save(); ctx.translate(11, pad.t + ph / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(o.ylabel, 0, 0); ctx.restore();
    }
    if (o.title) {
      ctx.fillStyle = U.themeColor('--text-strong') || '#000';
      ctx.font = '600 12.5px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(o.title, pad.l, 4);
    }
    return { X: X, Y: Y };
  }

  /* ============================================================
     极坐标图（波束图 / 指向性）
     ============================================================ */
  function polar(canvas, o) {
    const W = Math.max(240, o.width || (canvas.parentElement ? canvas.parentElement.clientWidth - 8 : 640));
    const H = o.height || 340;
    const c = U.setupCanvas(canvas, W, H);
    const ctx = c.ctx;
    const cx = W / 2, cy = H / 2 + 6;
    const R = Math.max(20, Math.min(W, H) / 2 - 34);
    const th = {
      grid: U.themeColor('--plot-grid') || '#e8ecf2',
      axis: U.themeColor('--plot-axis') || '#9aa7b6',
      label: U.themeColor('--plot-label') || '#55636f',
      area: U.themeColor('--plot-area') || '#fbfcfe'
    };
    ctx.fillStyle = th.area;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();

    const rMin = o.rMin === undefined ? 0 : o.rMin;
    let rMax = o.rMax;
    if (rMax === undefined) { rMax = 0; for (const v of o.r) if (v > rMax) rMax = v; }
    if (rMax === rMin) rMax = rMin + 1;
    const rad = v => (v - rMin) / (rMax - rMin) * R;
    const mode = o.mode || 'deg';   // 'deg' 角度制 / 'rad'

    // 网格圆
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
    const rings = o.rings || 4;
    for (let i = 1; i <= rings; i++) {
      ctx.beginPath(); ctx.arc(cx, cy, R * i / rings, 0, 6.2832); ctx.stroke();
    }
    // 径线
    const nDir = o.ndir || 12;
    for (let i = 0; i < nDir; i++) {
      const a = i * 2 * Math.PI / nDir;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
      ctx.stroke();
    }

    // 数据曲线（θ 自 0°（正右）逆时针？此处采用「0° 指向正上方，顺时针增大」的方位约定）
    const series = Array.isArray(o.r[0]) ? o.r : [o.r];
    const thetas = Array.isArray(o.theta[0]) ? o.theta : [o.theta];
    series.forEach((rs, si) => {
      const ts = thetas[si] || thetas[0];
      const col = o.colors ? o.colors[si] : pal(si);
      ctx.strokeStyle = col; ctx.fillStyle = rgbStr(parseColor(col), 0.16);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < rs.length; i++) {
        const deg = mode === 'deg' ? ts[i] : ts[i] * 180 / Math.PI;
        const a = (deg - 90) * Math.PI / 180;         // 0° → 正上方
        const rr = rad(rs[i]);
        const px = cx + rr * Math.cos(a), py = cy + rr * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      if (o.fill !== false) ctx.fill();
      ctx.stroke();
    });

    // 角度标注
    ctx.fillStyle = th.label; ctx.font = '10.5px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const labels = o.labels || [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']];
    labels.forEach(([deg, txt]) => {
      const a = (deg - 90) * Math.PI / 180;
      ctx.fillText(txt, cx + (R + 15) * Math.cos(a), cy + (R + 15) * Math.sin(a));
    });
    // 半径刻度
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let i = 1; i <= rings; i++) {
      ctx.fillText(fmtTick(rMin + (rMax - rMin) * i / rings, (rMax - rMin) / rings), cx + 3, cy - R * i / rings);
    }
    if (o.title) {
      ctx.fillStyle = U.themeColor('--text-strong') || '#000';
      ctx.font = '600 12.5px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(o.title, 6, 4);
    }
    return { R: R, cx: cx, cy: cy };
  }

  /* ============================================================
     Z 平面零极点图
     ============================================================ */
  function zplane(canvas, o) {
    const W = Math.max(240, o.width || (canvas.parentElement ? canvas.parentElement.clientWidth - 8 : 420));
    const H = o.height || W;
    const c = U.setupCanvas(canvas, W, H);
    const ctx = c.ctx;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 26;
    const th = {
      grid: U.themeColor('--plot-grid') || '#e8ecf2',
      axis: U.themeColor('--plot-axis') || '#9aa7b6',
      label: U.themeColor('--plot-label') || '#55636f',
      area: U.themeColor('--plot-area') || '#fbfcfe'
    };
    ctx.fillStyle = th.area; ctx.fillRect(0, 0, W, H);

    // 单位圆
    ctx.strokeStyle = th.axis; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
    // 坐标轴
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();
    // 网格圆（0.5 / 1.5）
    ctx.setLineDash([3, 3]);
    [0.5, 1.5].forEach(k => {
      if (k * R > R * 1.02) return;
      ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, 6.2832); ctx.stroke();
    });
    ctx.setLineDash([]);

    const P = z => ({ px: cx + z.re * R, py: cy - z.im * R });

    // 零点 ○
    ctx.strokeStyle = U.themeColor('--plot-c1') || '#1b5aa4';
    ctx.lineWidth = 2;
    (o.zeros || []).forEach(z => {
      const p = P(z);
      ctx.beginPath(); ctx.arc(p.px, p.py, 6, 0, 6.2832); ctx.stroke();
    });
    // 极点 ×
    ctx.strokeStyle = U.themeColor('--danger') || '#b91c1c';
    ctx.lineWidth = 2;
    (o.poles || []).forEach(z => {
      const p = P(z);
      ctx.beginPath();
      ctx.moveTo(p.px - 5, p.py - 5); ctx.lineTo(p.px + 5, p.py + 5);
      ctx.moveTo(p.px + 5, p.py - 5); ctx.lineTo(p.px - 5, p.py + 5);
      ctx.stroke();
    });

    // 标注
    ctx.fillStyle = th.label; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('Re', cx + R - 12, cy + 4);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('Im', cx + 6, cy - R + 8);
    ctx.fillText('|z|=1', cx + R * 0.707 + 4, cy - R * 0.707 - 4);
    if (o.title) {
      ctx.fillStyle = U.themeColor('--text-strong') || '#000';
      ctx.font = '600 12.5px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(o.title, 6, 4);
    }
    return { R: R, cx: cx, cy: cy, toZ: (px, py) => ({ re: (px - cx) / R, im: -(py - cy) / R }), P: P };
  }

  /* ============================================================
     FFT 蝶形运算示意图（静态结构，动画由调用方驱动）
     ============================================================ */
  function butterfly(canvas, o) {
    const N = o.N;                       // 点数（2 的幂）
    const stages = Math.log2(N);
    const W = o.width || (canvas.parentElement ? canvas.parentElement.clientWidth - 8 : 720);
    const rowH = o.rowH || 22;
    const x0 = 42;
    const colW = o.colW || Math.max(70, (W - x0 - 36) / stages);
    const H = Math.max(180, (N + 1) * rowH + 30);
    canvas.style.height = H + 'px';
    const c = U.setupCanvas(canvas, W, H);
    const ctx = c.ctx;
    const th = {
      grid: U.themeColor('--plot-grid') || '#e8ecf2',
      axis: U.themeColor('--plot-axis') || '#9aa7b6',
      label: U.themeColor('--plot-label') || '#55636f',
      area: U.themeColor('--plot-area') || '#fbfcfe'
    };
    ctx.fillStyle = th.area; ctx.fillRect(0, 0, W, H);
    ctx.font = '11px sans-serif';

    const y0 = 26;
    const nodeX = s => x0 + s * colW;
    const nodeY = i => y0 + i * rowH;

    // 节点
    for (let s = 0; s <= stages; s++) {
      for (let i = 0; i < N; i++) {
        const px = nodeX(s), py = nodeY(i);
        ctx.fillStyle = th.area;
        ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, 5, 0, 6.2832); ctx.fill(); ctx.stroke();
      }
    }

    // 蝶形连线（时间抽取：第 s 级跨距 half = 2^s）
    for (let s = 0; s < stages; s++) {
      const half = Math.pow(2, s);
      const span = half * 2;
      const xs = nodeX(s), xe = nodeX(s + 1);
      const active = o.stage === s;
      for (let i = 0; i < N; i++) {
        const grp = Math.floor(i / span);
        const k = i % span;
        if (k >= half) continue;                    // 只画上支路避免重复
        const pair = grp * span + k + half;
        // 同址直连线
        ctx.strokeStyle = active ? (U.themeColor('--accent') || '#1b5aa4') : th.axis;
        ctx.lineWidth = active ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(xs, nodeY(i)); ctx.lineTo(xe, nodeY(i));
        ctx.moveTo(xs, nodeY(pair)); ctx.lineTo(xe, nodeY(pair));
        ctx.stroke();
        // 交叉支路（乘旋转因子后累加）
        ctx.setLineDash(active ? [] : [3, 3]);
        ctx.strokeStyle = active ? (U.themeColor('--plot-c2') || '#c2410c') : th.axis;
        ctx.beginPath();
        ctx.moveTo(xs, nodeY(pair)); ctx.lineTo(xe, nodeY(i));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 级间旋转因子标注（示意：只标该级第一个因子）
      if (stages <= 4) {
        ctx.fillStyle = th.label;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('×W', (xs + xe) / 2, nodeY(0) - 6);
      }
    }

    // 标签
    ctx.fillStyle = th.label;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i < N; i++) ctx.fillText('x' + i, x0 - 8, nodeY(i));
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let s = 0; s <= stages; s++) {
      ctx.fillText(s === 0 ? '输入' : (s === stages ? '输出' : '第 ' + s + ' 级'), nodeX(s), 16);
    }
    if (o.title) {
      ctx.fillStyle = U.themeColor('--text-strong') || '#000';
      ctx.font = '600 12.5px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(o.title, 6, 4);
    }
    return { nodeX: nodeX, nodeY: nodeY, stages: stages };
  }

  /* ============================================================
     多面板纵向堆叠（用于时域/频域对照）
     ============================================================ */
  function stack(container, specs) {
    container.innerHTML = '';
    const plots = [];
    specs.forEach(sp => {
      const box = U.h('div.plot-box');
      const cv = U.h('canvas');
      box.appendChild(cv);
      container.appendChild(box);
      const p = new Plot(cv, sp.opts || {});
      (sp.series || []).forEach(s => p.add(s));
      (sp.vlines || []).forEach(v => p.vline(v.x, v));
      (sp.hlines || []).forEach(v => p.hline(v.y, v));
      p.draw();
      if (sp.caption) container.appendChild(U.h('div.plot-cap', { html: sp.caption }));
      plots.push(p);
    });
    return plots;
  }

  /* ------------------------- 注册表（主题切换时统一重绘） ------------------------- */
  const _registry = [];
  function newPlot(canvas, opts) {
    const p = new Plot(canvas, opts);
    _registry.push(p);
    return p;
  }
  function redrawAll() {
    U.clearColorCache();
    _registry.forEach(p => { p._color = null; p.draw(); });
  }

  DSP.plot = {
    new: newPlot, Plot: Plot, heatmap: heatmap, polar: polar,
    zplane: zplane, butterfly: butterfly, stack: stack,
    redrawAll: redrawAll, niceTicks: niceTicks, pal: pal,
    parseColor: parseColor, rgbStr: rgbStr, mix: mix
  };
})(window);

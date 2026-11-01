/* =============================================================
   util.js —— 通用工具库（DOM / 数值 / 存储 / 文本）
   全局命名空间：window.DSP.util
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});

  /* ------------------------- DOM 助手 ------------------------- */

  /**
   * 创建元素
   * h('div.card', {id:'x', onclick:fn}, ['文本', childEl])
   * 支持 'tag.cls1.cls2' 简写；attrs 中 class/style/dataset 特殊处理
   */
  function h(spec, attrs, children) {
    const parts = String(spec).split('.');
    const tag = parts.shift() || 'div';
    const el = document.createElement(tag);
    if (parts.length) el.className = parts.join(' ');

    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class' || k === 'className') {
          el.className = el.className ? el.className + ' ' + v : v;
        } else if (k === 'style' && typeof v === 'object') {
          Object.assign(el.style, v);
        } else if (k === 'dataset') {
          Object.assign(el.dataset, v);
        } else if (k === 'html') {
          el.innerHTML = v;
        } else if (k === 'text') {
          el.textContent = v;
        } else if (k.startsWith('on') && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'disabled' || k === 'checked' || k === 'selected') {
          el[k] = !!v;
        } else {
          el.setAttribute(k, v);
        }
      }
    }

    if (children != null) append(el, children);
    return el;
  }

  /** 追加子节点：支持字符串 / 节点 / 数组 / null */
  function append(parent, children) {
    if (children == null) return parent;
    if (Array.isArray(children)) {
      children.forEach(c => append(parent, c));
      return parent;
    }
    parent.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
    return parent;
  }

  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const clear = el => { while (el && el.firstChild) el.removeChild(el.firstChild); return el; };

  /** 事件委托绑定 */
  function delegate(root, selector, type, handler) {
    root.addEventListener(type, function (e) {
      const t = e.target.closest(selector);
      if (t && root.contains(t)) handler.call(t, e, t);
    });
    return root;
  }

  /** 监听（返回解绑函数） */
  function on(el, type, fn, opts) {
    if (typeof el === 'string') el = qs(el);
    if (!el) return () => {};
    el.addEventListener(type, fn, opts);
    return () => el.removeEventListener(type, fn, opts);
  }

  /* ------------------------- 数值 ------------------------- */

  const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /** 等间距数组 [a, b] 共 n 点 */
  function linspace(a, b, n) {
    n = n || 100;
    const out = new Float64Array(n);
    if (n === 1) { out[0] = a; return out; }
    const step = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) out[i] = a + i * step;
    return out;
  }

  /** 0..n-1 */
  function arange(n) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = i;
    return out;
  }

  const zeros = n => new Float64Array(n);
  const zerosCplx = n => ({ re: new Float64Array(n), im: new Float64Array(n) });

  /** 定长格式化：保留有效位，去末尾 0 */
  function fmt(v, d) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    if (!isFinite(v)) return v > 0 ? '∞' : '-∞';
    d = d === undefined ? 3 : d;
    let s = Number(v).toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  /** 工程计数法：1.2k / 3.4M / 5.6m / 78µ */
  function eng(v, unit, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    d = d === undefined ? 2 : d;
    const a = Math.abs(v);
    const tbl = [
      [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
      [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']
    ];
    for (const [s, p] of tbl) {
      if (a >= s || s === 1e-12) return fmt(v / s, d) + ' ' + p + (unit || '');
    }
    return fmt(v, d) + ' ' + (unit || '');
  }

  const sum = arr => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s; };
  const mean = arr => arr.length ? sum(arr) / arr.length : 0;
  const maxOf = arr => { let m = -Infinity; for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; };
  const minOf = arr => { let m = Infinity; for (let i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i]; return m; };

  function std(arr) {
    const m = mean(arr);
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(s / Math.max(1, arr.length - 1));
  }

  /** 幅度转 dB：20log10(|x|)；功率用 10log10 */
  const toDb = (x, eps) => 20 * Math.log10(Math.max(Math.abs(x), eps || 1e-12));
  const toDbP = (x, eps) => 10 * Math.log10(Math.max(x, eps || 1e-12));
  const fromDb = db => Math.pow(10, db / 20);

  /* ------------------------- 随机 ------------------------- */

  /** 可复现随机数（mulberry32） */
  function rng(seed) {
    let a = (seed === undefined ? 20240921 : seed) >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 高斯白噪声（Box–Muller），可选种子 */
  function randn(n, seed) {
    const r = rng(seed);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 2) {
      const u1 = Math.max(r(), 1e-12), u2 = r();
      const mag = Math.sqrt(-2 * Math.log(u1));
      out[i] = mag * Math.cos(2 * Math.PI * u2);
      if (i + 1 < n) out[i + 1] = mag * Math.sin(2 * Math.PI * u2);
    }
    return out;
  }

  /* ------------------------- 存储 ------------------------- */

  const NS = 'dspLab:';
  const store = {
    get(key, def) {
      try {
        const s = localStorage.getItem(NS + key);
        return s === null ? (def === undefined ? null : def) : JSON.parse(s);
      } catch (e) { return def === undefined ? null : def; }
    },
    set(key, val) {
      try { localStorage.setItem(NS + key, JSON.stringify(val)); return true; }
      catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem(NS + key); } catch (e) {} },
    keys() {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length));
        }
      } catch (e) {}
      return out;
    },
    /** 遍历（含前缀过滤） */
    each(prefix, fn) {
      this.keys().forEach(k => { if (!prefix || k.indexOf(prefix) === 0) fn(k, this.get(k)); });
    }
  };

  /* ------------------------- 时间 / 节流 ------------------------- */

  function debounce(fn, ms) {
    let t = null;
    return function (...a) {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(this, a); }, ms || 120);
    };
  }

  function throttle(fn, ms) {
    let last = 0, timer = null;
    return function (...a) {
      const now = Date.now();
      if (now - last >= (ms || 60)) { last = now; fn.apply(this, a); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(this, a); }, (ms || 60) - (now - last));
      }
    };
  }

  /** 下一帧合并执行（避免拖动滑块时重复重绘） */
  function rafThrottle(fn) {
    let queued = false, lastArgs = null;
    return function (...a) {
      lastArgs = a;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn.apply(this, lastArgs); });
    };
  }

  const now = () => (global.performance && performance.now ? performance.now() : Date.now());

  function stamp(d) {
    d = d || new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ------------------------- 文本 ------------------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * 极简 Markdown 渲染
   * 支持：`行内代码`、**强调**、$行内公式$、$$块级公式$$、无序/有序列表、空行分段。
   * 公式被转成 <span data-tex="…"> 占位，随后由 UI.renderMathIn 统一交给 KaTeX 渲染。
   */
  function md(src) {
    if (!src) return '';
    let s = String(src);
    if (s.indexOf('$') < 0) {
      // 无公式：仍需处理强调与行内代码
      s = esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<em class="k">$1</em>');
      return rawMd(s);
    }

    const stash = [];
    const keep = html => {
      stash.push(html);
      return '\u0001' + (stash.length - 1) + '\u0001';
    };
    // 1) 行内代码先取出，避免其内部符号被后续规则误伤
    s = s.replace(/`([^`]+)`/g, (_, c) => keep('<code>' + esc(c) + '</code>'));
    // 2) HTML 转义
    s = esc(s);
    // 3) 块级公式 $$…$$
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) =>
      keep('<div class="math-block" data-tex="' + String(t).trim() + '"></div>'));
    // 4) 行内公式 $…$
    s = s.replace(/\$([^$\n]+?)\$/g, (_, t) =>
      keep('<span data-tex="' + t + '"></span>'));
    // 5) 强调
    s = s.replace(/\*\*([^*]+)\*\*/g, '<em class="k">$1</em>');

    let out = rawMd(s);
    // 6) 还原占位符
    return out.replace(/\u0001(\d+)\u0001/g, (_, i) => stash[+i]);
  }

  /** 只处理段落/列表的纯标记转换（输入已转义） */
  function rawMd(s) {
    const lines = s.split(/\r?\n/);
    let out = '', inList = false;
    for (const ln of lines) {
      const li = /^\s*[-*]\s+(.*)$/.exec(ln);
      const num = /^\s*\d+\.\s+(.*)$/.exec(ln);
      if (li || num) {
        const tag = li ? 'ul' : 'ol';
        if (!inList || inList !== tag) {
          if (inList) out += '</' + inList + '>';
          out += '<' + tag + '>';
          inList = tag;
        }
        out += '<li>' + (li ? li[1] : num[1]) + '</li>';
      } else {
        if (inList) { out += '</' + inList + '>'; inList = false; }
        if (ln.trim() === '') continue;
        out += '<p>' + ln + '</p>';
      }
    }
    if (inList) out += '</' + inList + '>';
    return out;
  }

  /** 复制到剪贴板（带降级） */
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  /** 下载文本为文件 */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  /** URL 参数读写（hash 之后的部分） */
  function hashParts() {
    const h = location.hash.replace(/^#\/?/, '');
    const i = h.indexOf('?');
    if (i < 0) return { path: h, params: {} };
    const params = {};
    new URLSearchParams(h.slice(i + 1)).forEach((v, k) => { params[k] = v; });
    return { path: h.slice(0, i), params: params };
  }

  function buildHash(path, params) {
    const usp = new URLSearchParams();
    for (const k in (params || {})) {
      const v = params[k];
      if (v === null || v === undefined || v === '') continue;
      usp.set(k, v);
    }
    const q = usp.toString();
    return '#/' + path + (q ? '?' + q : '');
  }

  /* ------------------------- 颜色 / 主题 ------------------------- */

  /** 读取 CSS 变量当前值 */
  function cssVar(name, root) {
    const el = root || document.documentElement;
    return getComputedStyle(el).getPropertyValue(name).trim();
  }

  /** 缓存式读取（主题切换后需 clearColorCache） */
  let _cc = {};
  function themeColor(name) {
    if (_cc[name] === undefined) _cc[name] = cssVar(name);
    return _cc[name];
  }
  function clearColorCache() { _cc = {}; }

  /** 高 DPI Canvas 设置：返回 {ctx, w, h, dpr} */
  function setupCanvas(canvas, width, height) {
    const dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: width, h: height, dpr: dpr };
  }

  /* ------------------------- 导出 ------------------------- */
  DSP.util = {
    h, append, qs, qsa, clear, delegate, on,
    clamp, lerp, linspace, arange, zeros, zerosCplx,
    fmt, eng, sum, mean, maxOf, minOf, std,
    toDb, toDbP, fromDb,
    rng, randn,
    store, debounce, throttle, rafThrottle, now, stamp,
    esc, md, copy, download, hashParts, buildHash,
    cssVar, themeColor, clearColorCache, setupCanvas
  };
})(window);

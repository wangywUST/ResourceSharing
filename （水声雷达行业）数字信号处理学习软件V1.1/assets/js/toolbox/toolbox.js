/* =============================================================
   toolbox.js —— 工具箱四个页面
   全局命名空间：window.DSP（通过 DSP.router.register 注册 4 条路由）

     #/toolbox/code     代码示例库：Python / MATLAB 双语言、分类导航 + 全文检索
     #/toolbox/upload   wav 信号上传分析：时域 / 频谱 / 时频 / 滤波前后对比 / 导出
     #/toolbox/compare  对比实验：① 谱估计 ② 窗函数 ③ 滤波器
     #/toolbox/dict     术语词典：检索、分类浏览、词条详情，并补充术语库到 120+ 条

   依赖：util / core / ui / plot / router / share / glossary / codeLib
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util, C = DSP.core, UI = DSP.ui, P = DSP.plot, R = DSP.router;
  const h = U.h;
  const TAU = Math.PI * 2;

  /* ============================================================
     §0 页面内通用小工具
     ============================================================ */

  /** 卡片容器：card(title, right节点, 子节点数组) */
  function card(title, right, children) {
    return h('div.card', {}, [
      h('div.card-hd', {}, [
        h('span.accent-bar'),
        h('span', { text: title }),
        h('div.sp', {}, right || null)
      ]),
      h('div.card-bd', {}, children)
    ]);
  }

  /** 单行文本输入框（带 label 行，风格与 ui.ctrl 一致） */
  function textInput(o) {
    const inp = h('input', {
      type: 'text',
      value: o.value || '',
      placeholder: o.placeholder || '',
      oninput: function () { if (o.onInput) o.onInput(this.value); }
    });
    inp.style.cssText = 'display:block;width:100%;padding:7px 10px;border:1px solid var(--border);' +
      'border-radius:var(--radius);background:var(--bg-elev);color:var(--text);font-size:13px;outline:none;';
    return {
      el: h('div.ctrl', {}, [
        h('div.cl', {}, [h('span.nm', { text: o.label || '' }), o.right || null]),
        inp,
        o.hint ? h('div.hint', { text: o.hint }) : null
      ]),
      get: () => inp.value,
      set: v => { inp.value = v; }
    };
  }

  /** 把所有曲线画进同一个 plot：series = [{x,y,type,color,label,...}] */
  function drawPlot(canvas, opts, series, extra) {
    const p = P.new(canvas, opts);
    series.forEach(s => p.add(s));
    if (extra) extra(p);
    p.draw();
    return p;
  }

  /** 窗口尺寸变化时重画（返回解绑函数） */
  function onResize(fn) {
    const f = U.debounce(fn, 160);
    global.addEventListener('resize', f);
    return () => global.removeEventListener('resize', f);
  }

  /** 索引范围内的局部极大（返回 [{i, v}]，按幅值降序） */
  function localMaxima(arr, lo, hi, cnt) {
    const out = [];
    lo = Math.max(1, lo | 0); hi = Math.min(arr.length - 2, hi | 0);
    for (let i = lo; i <= hi; i++) {
      if (arr[i] > arr[i - 1] && arr[i] >= arr[i + 1]) out.push({ i: i, v: arr[i] });
    }
    out.sort((a, b) => b.v - a.v);
    return cnt ? out.slice(0, cnt) : out;
  }

  /**
   * 取第 i 条曲线的颜色：前 5 条用主题调色板（自动适配深浅色），
   * 第 6/7 条用两个在浅色与深色背景上都能分辨的补充色。
   * 窗函数对比要同时画 7 条曲线，直接传数字会让颜色循环、看起来"重合"。
   */
  function seqColor(i) {
    if (i < 5) return U.themeColor('--plot-c' + (i + 1)) || '#1b5aa4';
    return ['#7c3aed', '#0d9488'][i - 5] || '#888';
  }

  /** 复数小工具（本文件内部的 IIR 设计用） */
  const cx = (re, im) => ({ re: re, im: im || 0 });
  const cadd = (a, b) => cx(a.re + b.re, a.im + b.im);
  const csub = (a, b) => cx(a.re - b.re, a.im - b.im);
  const cmul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  const cdiv = (a, b) => {
    const d = b.re * b.re + b.im * b.im || 1e-300;
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  };
  const cscale = (a, s) => cx(a.re * s, a.im * s);
  function csqrt(z) {
    const r = Math.hypot(z.re, z.im);
    return cx(Math.sqrt(Math.max(0, (r + z.re) / 2)),
      (z.im < 0 ? -1 : 1) * Math.sqrt(Math.max(0, (r - z.re) / 2)));
  }
  function clog(z) { return cx(Math.log(Math.hypot(z.re, z.im)), Math.atan2(z.im, z.re)); }
  /** asin(z) = -i·ln(iz + sqrt(1-z²)) */
  function casin(z) {
    const l = clog(cadd(cx(-z.im, z.re), csqrt(csub(cx(1, 0), cmul(z, z)))));
    return cx(l.im, -l.re);
  }

  /* ============================================================
     §1 路由 A：#/toolbox/code —— 代码示例库
     ============================================================ */
  R.register('toolbox/code', {
    title: 'Python / MATLAB 代码示例库',
    lede: '把网页里每一个交互实验台的算法，都写成**可以直接跑**的脚本：Python 用 numpy / scipy / matplotlib，MATLAB 用 Signal Processing Toolbox。每条开头都注明「对应网页哪个模块、用什么参数能复现网页默认状态」。',
    tags: ['工具箱', '代码', 'Python', 'MATLAB', '可运行'],
    render: function (el, params) {
      const lib = DSP.codeLib;
      if (!lib) {
        el.appendChild(UI.callout('warn', '示例库未加载', 'assets/js/data/code-examples.js 没有提供 DSP.codeLib。'));
        return;
      }

      /* ---- 状态 ---- */
      let q = params && params.q ? params.q : '';
      let cat = (params && params.cat) || 'all';
      const langState = Object.create(null);       // id -> 'py' | 'ml'
      const detState = Object.create(null);        // id -> details 元素

      /* ---- 顶部：检索 + 统计 ---- */
      const statEl = h('span.small.dim');
      const searchBox = textInput({
        label: '检索示例（标题 / 说明 / 代码正文）',
        value: q,
        placeholder: '例如：welch、firwin、music、脉冲压缩、阵列…',
        right: statEl,
        onInput: function (v) {
          q = v;
          DSP.share.syncParams({ q: v });
          renderList();
        }
      });
      const langAllSeg = UI.seg({
        label: '全站语言',
        value: 'py',
        options: [{ value: 'py', label: '全部切 Python' }, { value: 'ml', label: '全部切 MATLAB' }],
        onChange: function (v) {
          lib.items.forEach(it => { langState[it.id] = v; });
          renderList();
        }
      });
      const foldBtn = h('button.btn.sm.ghost', {
        text: '全部收起',
        onclick: function () {
          const open = this.dataset.open !== '1';
          this.dataset.open = open ? '1' : '';
          this.textContent = open ? '全部展开' : '全部收起';
          Object.keys(detState).forEach(k => { detState[k].open = !open; });
        }
      });

      el.appendChild(card('① 检索与浏览', [foldBtn], [
        searchBox.el,
        langAllSeg.el,
        h('div', { style: { marginTop: '10px' } }, [catNav()])
      ]));

      /* ---- 分类导航 ---- */
      function catNav() {
        const items = [{ id: 'all', name: '全部', n: lib.items.length }]
          .concat(lib.cats.map(c => ({ id: c.id, name: c.name, n: lib.count(c.id) })));
        return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
          items.map(it => h('button.btn.sm' + (it.id === cat ? '' : '.ghost'), {
            text: it.name + ' · ' + it.n,
            onclick: function () {
              cat = it.id;
              DSP.share.syncParams({ cat: it.id });
              // 重画导航高亮
              const box = this.parentElement;
              const nav = catNav();
              box.parentNode.replaceChild(nav, box);
              renderList();
            }
          })));
      }

      /* ---- 列表面板 ---- */
      const listEl = h('div');
      el.appendChild(listEl);

      function renderList() {
        const res = lib.search(q, cat);
        U.clear(listEl);
        statEl.textContent = '命中 ' + res.length + ' / ' + lib.items.length + ' 条';
        if (!res.length) {
          listEl.appendChild(UI.callout('note', '没有命中',
            '换个关键词试试，或点上方「全部」清除分类筛选。'));
          return;
        }
        res.forEach(it => listEl.appendChild(itemCard(it)));
      }

      function itemCard(it) {
        if (!langState[it.id]) langState[it.id] = 'py';
        const codeHolder = h('div');
        const det = h('details.fold', { open: true }, [
          h('summary', { text: '代码（Python / MATLAB 双版本，可一键复制）' }),
          h('div.fold-bd', {}, codeHolder)
        ]);
        detState[it.id] = det;

        function paint() {
          U.clear(codeHolder);
          const lang = langState[it.id];
          codeHolder.appendChild(UI.code(lang === 'py' ? it.py : it.ml,
            lang === 'py' ? 'python' : 'matlab',
            { title: lang === 'py' ? 'Python 3（numpy / scipy / matplotlib）' : 'MATLAB（Signal Processing Toolbox）' }));
        }
        paint();

        const seg = UI.seg({
          label: '语言',
          value: langState[it.id],
          options: [{ value: 'py', label: 'Python' }, { value: 'ml', label: 'MATLAB' }],
          onChange: function (v) { langState[it.id] = v; paint(); }
        });

        const nav = DSP.nav && DSP.nav.byPath ? DSP.nav.byPath[it.see] : null;
        return h('div.card', { id: 'ex-' + it.id }, [
          h('div.card-hd', {}, [
            h('span.accent-bar'),
            h('span', { text: it.name }),
            h('div.sp', {}, [
              h('span.chip.blue', { text: lib.catName(it.cat) }),
              h('span.chip.teal', { text: it.id })
            ])
          ]),
          h('div.card-bd', {}, [
            h('div.small.dim', { text: it.desc }),
            h('div', { style: { margin: '10px 0' } }, [seg.el]),
            det,
            h('div.btn-row', {}, [
              h('button.btn.sm.primary', {
                text: '打开对应交互模块：' + (nav ? nav.title : it.see),
                onclick: function () { location.hash = '#/' + it.see; }
              }),
              h('button.btn.sm.ghost', {
                text: '复制当前语言代码',
                onclick: function () {
                  const src = langState[it.id] === 'py' ? it.py : it.ml;
                  U.copy(src).then(() => UI.toast('代码已复制到剪贴板'));
                }
              })
            ])
          ])
        ]);
      }

      renderList();
      return function () { /* 无全局副作用 */ };
    }
  });

  /* ============================================================
     §2 路由 B：#/toolbox/upload —— wav 信号上传分析
     ============================================================ */
  R.register('toolbox/upload', {
    title: '信号上传分析（wav）',
    lede: '把一段 .wav 拖进来，在浏览器里完成**时域 → 频谱 → 时频 → 滤波 → 导出**的完整链路。全程离线，音频数据不会离开本机。',
    tags: ['工具箱', 'wav', '频谱', '时频', '滤波'],
    render: function (el) {
      /* ---------------- 状态 ---------------- */
      let sig = null;                 // {x: Float32Array, fs, name, ch, bits}
      let sel = null;                 // 选区 [t0, t1]（秒），null = 全段

      /* ---------------- ① 载入 ---------------- */
      const infoEl = h('div.small.dim', { text: '尚未载入信号。' });
      const dropZone = h('div', {
        style: {
          border: '1.5px dashed var(--border-strong)', borderRadius: 'var(--radius-lg)',
          padding: '18px', textAlign: 'center', color: 'var(--text-dim)',
          background: 'var(--bg-sunken)', cursor: 'pointer', fontSize: '13px'
        }
      }, '把 .wav 文件拖到这里，或点击选择文件（支持 8/16/24/32-bit PCM 与 32/64-bit float，多声道取第一声道）');

      const fileInput = h('input', {
        type: 'file', accept: '.wav,audio/wav,audio/*',
        style: { display: 'none' },
        onchange: function () { if (this.files && this.files[0]) loadFile(this.files[0]); }
      });
      dropZone.appendChild(fileInput);
      dropZone.onclick = () => fileInput.click();
      ['dragenter', 'dragover'].forEach(t => dropZone.addEventListener(t, e => {
        e.preventDefault(); dropZone.style.borderColor = 'var(--accent)';
      }));
      ['dragleave', 'drop'].forEach(t => dropZone.addEventListener(t, e => {
        e.preventDefault(); dropZone.style.borderColor = 'var(--border-strong)';
      }));
      dropZone.addEventListener('drop', function (e) {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) loadFile(f);
      });

      el.appendChild(card('① 载入信号', null, [
        dropZone,
        h('div.btn-row', {}, [
          h('button.btn.sm.ghost', {
            text: '用内置示例信号（双音 + 扫频 + 噪声）',
            onclick: function () { useDemo(); }
          })
        ]),
        h('div', { style: { marginTop: '8px' } }, infoEl)
      ]));

      /* ---------------- ②～⑥ 的占位容器 ---------------- */
      const stage = h('div');
      el.appendChild(stage);

      /* =========================================================
         载入流程
         ========================================================= */
      function loadFile(file) {
        infoEl.textContent = '正在解析 ' + file.name + ' …';
        const fr = new FileReader();
        fr.onload = function () {
          const buf = fr.result;
          decodeAudio(buf).then(function (r) {
            sig = { x: r.x, fs: r.fs, name: file.name, ch: r.ch, bits: r.bits, src: r.src };
            sel = null;
            infoEl.textContent = fmtInfo();
            buildStage();
            UI.toast('已载入：' + file.name);
          }).catch(function (e) {
            infoEl.textContent = '解析失败：' + (e && e.message || e);
            UI.callout('danger', '无法解析该音频', String(e && e.message || e));
          });
        };
        fr.onerror = function () { infoEl.textContent = '文件读取失败。'; };
        fr.readAsArrayBuffer(file);
      }

      function useDemo() {
        const fs = 16000, N = fs * 2;
        const x = new Float32Array(N);
        const rnd = U.rng(20261024);
        for (let n = 0; n < N; n++) {
          const t = n / fs;
          // 扫频写成 sin(2π(600t + 1100t²))：瞬时频率 = 600 + 2200t，
          // 2 s 时正好到 5000 Hz，全程低于奈奎斯特 8 kHz，不会被混叠"折"回来。
          x[n] = 0.8 * Math.sin(TAU * 440 * t)
            + 0.5 * Math.sin(TAU * 1250 * t + 0.7)
            + 0.35 * Math.sin(TAU * (600 * t + 1100 * t * t))
            + 0.05 * (rnd() * 2 - 1);      // 用零均值的均匀噪声：否则直流分量会在 0 Hz 打出一个假峰
        }
        sig = { x: x, fs: fs, name: '内置示例（双音 + 线性扫频 + 噪声）', ch: 1, bits: 32, src: 'demo' };
        sel = null;
        infoEl.textContent = fmtInfo();
        buildStage();
        UI.toast('已生成内置示例信号');
      }

      function fmtInfo() {
        if (!sig) return '尚未载入信号。';
        const dur = sig.x.length / sig.fs;
        const how = sig.src === 'demo' ? '内置示例（未读文件）'
          : (sig.src === 'audioctx' ? 'AudioContext.decodeAudioData' : '内置 WAV 解析器');
        return '文件：' + sig.name + '　采样率 ' + U.eng(sig.fs, 'Hz', 3) + '　长度 ' +
          sig.x.length.toLocaleString() + ' 点（' + U.fmt(dur, 3) + ' s）　声道 ' + sig.ch +
          '　位深 ' + sig.bits + '　' + how;
      }

      /* =========================================================
         解码：优先 AudioContext，失败回退自写解析器
         ========================================================= */
      function decodeAudio(buf) {
        return new Promise(function (resolve, reject) {
          let done = false;
          const AC = global.AudioContext || global.webkitAudioContext;
          if (AC) {
            try {
              const ac = new AC();
              ac.decodeAudioData(buf.slice(0), function (ab) {
                if (done) return; done = true;
                try {
                  resolve({
                    x: Float32Array.from(ab.getChannelData(0)),
                    fs: ab.sampleRate, ch: ab.numberOfChannels, bits: 32, src: 'audioctx'
                  });
                  if (ac.close) ac.close();
                } catch (e) { reject(e); }
              }, function () {
                if (done) return; done = true;
                try { resolve(parseWav(buf)); } catch (e2) { reject(e2); }
              });
              return;
            } catch (e) { /* 落到手动解析 */ }
          }
          try { resolve(parseWav(buf)); } catch (e) { reject(e); }
        });
      }

      /** 最小 WAV 解析器：支持 PCM 8/16/24/32-bit 与 float 32/64-bit，多声道取第一声道 */
      function parseWav(buf) {
        const dv = new DataView(buf);
        const tag = i => String.fromCharCode(dv.getUint8(i), dv.getUint8(i + 1), dv.getUint8(i + 2), dv.getUint8(i + 3));
        if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('不是标准 RIFF/WAVE 文件');
        let fmt = null, dataOff = -1, dataLen = 0, pos = 12;
        while (pos + 8 <= dv.byteLength) {
          const id = tag(pos), sz = dv.getUint32(pos + 4, true);
          const body = pos + 8;
          if (id === 'fmt ' && body + 16 <= dv.byteLength) {
            fmt = {
              format: dv.getUint16(body, true),
              ch: dv.getUint16(body + 2, true),
              fs: dv.getUint32(body + 4, true),
              bits: dv.getUint16(body + 14, true)
            };
          } else if (id === 'data') {
            dataOff = body; dataLen = Math.min(sz, dv.byteLength - body);
          }
          pos = body + sz + (sz & 1);
          if (id === 'data') break;
        }
        if (!fmt) throw new Error('缺少 fmt 块');
        if (dataOff < 0) throw new Error('缺少 data 块');
        const bytes = fmt.bits / 8, frame = bytes * fmt.ch;
        const n = Math.floor(dataLen / frame);
        const x = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const p = dataOff + i * frame;
          let v = 0;
          if (fmt.format === 3) {                        // IEEE float
            v = fmt.bits === 64 ? dv.getFloat64(p, true) : dv.getFloat32(p, true);
          } else if (fmt.bits === 8) {                   // 8-bit 无符号，零点 128
            v = (dv.getUint8(p) - 128) / 128;
          } else if (fmt.bits === 16) {
            v = dv.getInt16(p, true) / 32768;
          } else if (fmt.bits === 24) {
            const b0 = dv.getUint8(p), b1 = dv.getUint8(p + 1), b2 = dv.getUint8(p + 2);
            let s = b0 | (b1 << 8) | (b2 << 16);
            if (s & 0x800000) s -= 0x1000000;
            v = s / 8388608;
          } else if (fmt.bits === 32) {
            v = dv.getInt32(p, true) / 2147483648;
          } else {
            throw new Error('不支持的位深：' + fmt.bits);
          }
          x[i] = v;
        }
        return { x: x, fs: fmt.fs, ch: fmt.ch, bits: fmt.bits, src: 'parser' };
      }

      /* =========================================================
         ②③ 分析面板（载入后构建）
         ========================================================= */
      let cleanups = [];

      function buildStage() {
        cleanups.forEach(fn => { try { fn(); } catch (e) {} });
        cleanups = [];
        U.clear(stage);
        if (!sig) return;

        const fs = sig.fs;
        const dur = sig.x.length / fs;

        /* ---- ② 时域波形（可拖动选择区间） ---- */
        const tBox = UI.plotBox({ title: '时域波形（按住鼠标横向拖动可框选分析区间）' });
        const selInfo = h('div.small.dim', { text: '当前分析区间：全段' });
        const PAD = { l: 60, r: 14, t: 20, b: 34 };
        let drag = null;

        function timeSeries() {
          // 抽稀到 ≤20000 点：每桶取 min/max 保留包络
          const seg = region();
          const N = seg.length;
          const buckets = Math.min(10000, Math.max(1, N >> 1));
          const step = N / buckets;
          const tv = [], yv = [];
          for (let b = 0; b < buckets; b++) {
            const a = Math.floor(b * step), z = Math.min(N, Math.max(a + 1, Math.floor((b + 1) * step)));
            let mn = Infinity, mx = -Infinity, at = a;
            for (let i = a; i < z; i++) { if (seg[i] < mn) { mn = seg[i]; at = i; } if (seg[i] > mx) mx = seg[i]; }
            tv.push((off() + at) / fs); yv.push(mn);
            tv.push((off() + at) / fs); yv.push(mx);
          }
          return { t: Float64Array.from(tv), y: Float64Array.from(yv) };
        }
        function off() { return sel ? Math.round(sel[0] * fs) : 0; }
        function region() {
          if (!sel) return sig.x;
          const a = Math.max(0, Math.round(sel[0] * fs)), b = Math.min(sig.x.length, Math.round(sel[1] * fs));
          return sig.x.subarray(a, b);
        }

        function drawTime() {
          const s = timeSeries();
          const p = P.new(tBox.canvas, {
            height: 230, padding: PAD, xlabel: '时间 / s', ylabel: '幅度',
            xlim: [0, dur], legend: false
          });
          p.add({ x: s.t, y: s.y, type: 'line', color: 0, width: 1, label: 'x(t)' });
          if (sel) p.band(sel[0], sel[1], { color: 'rgba(249,115,22,.14)' });
          p.vline(sel ? sel[0] : 0, { color: '#f97316', dash: [4, 3] });
          p.vline(sel ? sel[1] : dur, { color: '#f97316', dash: [4, 3] });
          p.draw();
        }

        // 拖动选区：把像素横坐标换算回时间
        function pxToTime(px) {
          const W = tBox.canvas.clientWidth || 600;
          const u = (px - PAD.l) / Math.max(1, W - PAD.l - PAD.r);
          return Math.max(0, Math.min(dur, u * dur));
        }
        const cv = tBox.canvas;
        function localX(e) {
          const r = cv.getBoundingClientRect();
          return e.clientX - r.left;
        }
        cv.style.cursor = 'crosshair';
        cv.addEventListener('mousedown', function (e) {
          drag = { a: pxToTime(localX(e)), b: pxToTime(localX(e)) };
          sel = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)];
          drawTime();
        });
        cv.addEventListener('mousemove', function (e) {
          if (!drag) return;
          drag.b = pxToTime(localX(e));
          sel = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)];
          selInfo.textContent = '框选中：' + U.fmt(sel[0], 4) + ' s → ' + U.fmt(sel[1], 4) +
            ' s（' + Math.round((sel[1] - sel[0]) * fs) + ' 点）';
          drawTime();
        });
        const endDrag = function () {
          if (!drag) return;
          drag = null;
          if (sel && sel[1] - sel[0] < 4 / fs) { sel = null; }
          onSelectionChange();
        };
        cv.addEventListener('mouseup', endDrag);
        cv.addEventListener('mouseleave', endDrag);

        stage.appendChild(card('② 时域波形与区间选择', [
          h('button.btn.sm.ghost', {
            text: '重置为全段',
            onclick: function () { sel = null; selInfo.textContent = '当前分析区间：全段'; onSelectionChange(); }
          })
        ], [tBox.el, selInfo]));

        /* ---- ③ 频谱分析 ---- */
        const spBox = UI.plotBox({ title: '幅度谱（对当前区间做加窗 FFT）' });
        const spMetrics = h('div');
        const winSel = UI.select({
          label: '窗函数', value: 'hann',
          options: ['rect', 'bartlett', 'hann', 'hamming', 'blackman', 'blackmanharris', 'kaiser']
            .map(k => ({ value: k, label: (C.WINDOWS[k] ? C.WINDOWS[k].name : k) })),
          onChange: drawSpectrum
        });
        const nfftSel = UI.select({
          label: 'FFT 点数（不小于数据长度）', value: '4096',
          options: [{ value: '1024', label: '1024' }, { value: '2048', label: '2048' },
            { value: '4096', label: '4096' }, { value: '8192', label: '8192' },
            { value: '16384', label: '16384' }],
          onChange: drawSpectrum
        });
        const unitSeg = UI.seg({
          label: '纵轴', value: 'db',
          options: [{ value: 'db', label: 'dB' }, { value: 'lin', label: '线性' }],
          onChange: drawSpectrum
        });
        stage.appendChild(card('③ 频谱分析', null, [
          UI.ctrlPanel('频谱参数', [winSel, nfftSel, unitSeg]),
          spBox.el, spMetrics
        ]));

        /* ---- ④ STFT 时频图 ---- */
        const tfBox = UI.plotBox({ title: 'STFT 时频图（短时傅里叶变换）' });
        const winLenSel = UI.select({
          label: '窗长', value: '512',
          options: [{ value: '128', label: '128（时间分辨率好）' }, { value: '256', label: '256' },
            { value: '512', label: '512' }, { value: '1024', label: '1024（频率分辨率好）' },
            { value: '2048', label: '2048' }],
          onChange: drawSTFT
        });
        const hopSel = UI.select({
          label: '帧移（重叠）', value: '0.25',
          options: [{ value: '0.125', label: '窗长的 1/8（87.5% 重叠）' },
            { value: '0.25', label: '窗长的 1/4（75% 重叠）' },
            { value: '0.5', label: '窗长的 1/2（50% 重叠）' }],
          onChange: drawSTFT
        });
        stage.appendChild(card('④ 时频分析（STFT）', null, [
          UI.ctrlPanel('时频参数', [winLenSel, hopSel]),
          tfBox.el,
          h('div.plot-cap', { html: U.md('横轴时间、纵轴频率、颜色为能量（dB）。窗长越长频率分辨率越高、时间分辨率越低 —— 这就是时频分析的「海森堡约束」。') })
        ]));

        /* ---- ⑤ 滤波前后对比 ---- */
        const fBox = UI.plotBox({ title: '滤波前后：时域波形对比' });
        const fBox2 = UI.plotBox({ title: '滤波前后：幅度谱对比' });
        const fMetrics = h('div');
        const typeSeg = UI.seg({
          label: '滤波器类型', value: 'low',
          options: [{ value: 'low', label: '低通' }, { value: 'high', label: '高通' }, { value: 'band', label: '带通' }],
          onChange: function (v) {
            fc2Ctrl.el.style.display = v === 'band' ? '' : 'none';
            drawFilter();
          }
        });
        const nyq = fs / 2;
        const fcCtrl = UI.slider({
          label: '截止频率 f₁', min: 10, max: nyq - 10, step: 1,
          value: Math.round(nyq * 0.15), unit: 'Hz', digits: 0, onInput: drawFilter
        });
        const fc2Ctrl = UI.slider({
          label: '截止频率 f₂（带通用）', min: 10, max: nyq - 10, step: 1,
          value: Math.round(nyq * 0.45), unit: 'Hz', digits: 0, onInput: drawFilter
        });
        const orderInfo = h('div.hint', { text: 'FIR：汉明窗、200 阶（群延迟恒为 100 个采样点）；用 filtfilt 双向滤波，相位失真为零。' });
        stage.appendChild(card('⑤ 滤波前后对比', null, [
          UI.ctrlPanel('滤波器参数', [typeSeg, fcCtrl, fc2Ctrl], orderInfo),
          h('div.grid.g2', {}, [h('div', {}, fBox.el), h('div', {}, fBox2.el)]),
          fMetrics
        ]));
        fc2Ctrl.el.style.display = 'none';

        /* ---- ⑥ 导出 ---- */
        stage.appendChild(card('⑥ 导出结果', null, [
          h('div.btn-row', {}, [
            h('button.btn.sm.ghost', { text: '导出时域波形 CSV', onclick: () => exportCsv('time') }),
            h('button.btn.sm.ghost', { text: '导出幅度谱 CSV', onclick: () => exportCsv('spec') }),
            h('button.btn.sm.ghost', { text: '导出 STFT 矩阵 CSV', onclick: () => exportCsv('stft') })
          ]),
          h('div.plot-cap', { html: U.md('CSV 以逗号分隔，首行为表头，可直接拖进 Excel / Python（`pandas.read_csv`）继续处理。') })
        ]));

        /* ---------------- 绘图实现 ---------------- */
        function onSelectionChange() {
          selInfo.textContent = sel
            ? '当前分析区间：' + U.fmt(sel[0], 4) + ' s → ' + U.fmt(sel[1], 4) + ' s（' +
              Math.round((sel[1] - sel[0]) * fs) + ' 点）'
            : '当前分析区间：全段';
          drawTime(); drawSpectrum(); drawSTFT(); drawFilter();
        }

        const NMAX = 131072;                       // 单帧周期图的点数上限（≈8 s@16 kHz）

        /** 统一的频谱计算：窗口长度 = 实际参与计算的点数，nfft 只负责补零加密频栅 */
        function specOf(data, winType, nfftSel) {
          const N = Math.min(data.length, NMAX);
          const NF = Math.max(nfftSel, nextPow2(N));
          const w = C.window(winType, N);
          const r = C.periodogram(data.subarray(0, N), w, NF, fs);
          return { r: r, N: N, NF: NF, cut: data.length > N };
        }

        function drawSpectrum() {
          const seg = region();
          const sp = specOf(seg, winSel.get(), parseInt(nfftSel.get(), 10));
          const r = sp.r, N = sp.N, NF = sp.NF;
          const slice = seg.subarray(0, N);
          const db = C.psdDb(r.psd);
          const useDb = unitSeg.get() === 'db';
          const yv = useDb ? db : r.psd;
          const p = P.new(spBox.canvas, {
            height: 260, xlabel: '频率 / Hz',
            ylabel: useDb ? '幅度 / dB' : '幅度（线性）',
            xlim: [0, fs / 2], legend: false
          });
          p.add({ x: r.f, y: yv, type: 'line', color: 0, width: 1.1 });
          p.draw();
          // 读数：主峰、RMS、带宽占用
          let mi = 0; for (let i = 1; i < db.length; i++) if (db[i] > db[mi]) mi = i;
          let e = 0; for (let i = 0; i < seg.length; i++) e += seg[i] * seg[i];
          const rms = Math.sqrt(e / Math.max(1, seg.length));
          let pk = 0; for (let i = 0; i < seg.length; i++) pk = Math.max(pk, Math.abs(seg[i]));
          U.clear(spMetrics);
          spMetrics.appendChild(UI.metrics([
            { label: '分析点数', value: String(N), unit: sp.cut ? '点（已截取）' : '点' },
            { label: 'FFT 点数', value: String(NF), unit: '点（补零）' },
            { label: '频率分辨率', value: U.fmt(fs / N, 2), unit: 'Hz' },
            { label: '主峰频率', value: U.fmt(r.f[mi], 1), unit: 'Hz' },
            { label: '主峰电平', value: U.fmt(db[mi], 1), unit: 'dB' },
            { label: 'RMS', value: U.fmt(rms, 4), unit: '' },
            { label: '峰值', value: U.fmt(pk, 4), unit: '' },
            { label: '波峰因数', value: U.fmt(rms > 0 ? pk / rms : 0, 2), unit: '（峰值/RMS）' }
          ]));
        }

        function drawSTFT() {
          const seg = region();
          const wl = parseInt(winLenSel.get(), 10);
          if (seg.length < wl * 2) {
            UI.toast('分析区间太短，换成更长的区间或更短的窗');
            return;
          }
          const hop = Math.max(1, Math.round(wl * parseFloat(hopSel.get())));
          const r = C.stft(seg, { winLen: wl, hop: hop, win: 'hann', nfft: nextPow2(wl) * 2, fs: fs });
          // heatmap 期望「列优先」data[k*rows + r]，stft 给的是 [frame*bins + bin]，需要转置
          const data = new Float32Array(r.frames * r.bins);
          for (let k = 0; k < r.frames; k++) {
            for (let b = 0; b < r.bins; b++) data[k * r.bins + b] = r.S[k * r.bins + b];
          }
          P.heatmap(tfBox.canvas, {
            cols: r.frames, rows: r.bins, data: data, height: 300,
            xlabel: '时间 / s', ylabel: '频率 / Hz', flipY: true,
            xlim: [r.t[0], r.t[r.frames - 1]],
            ylim: [r.f[0], r.f[r.bins - 1]]
          });
        }

        function drawFilter() {
          const seg = region();
          if (seg.length < 512) { UI.toast('区间太短，无法滤波'); return; }
          const f1 = fcCtrl.get() / fs, f2 = fc2Ctrl.get() / fs;
          const lo = Math.min(f1, f2), hi = Math.max(f1, f2);
          const ty = typeSeg.get();
          const b = C.firWin({ order: 200, type: ty, fc: lo, fc2: hi, win: 'hamming' });
          const y = C.filtfilt(b, [1], seg);

          // 时域对比（抽稀显示）
          const M = Math.min(seg.length, 20000), st = Math.max(1, Math.floor(seg.length / M));
          const tv = new Float64Array(M), y0 = new Float64Array(M), y1 = new Float64Array(M);
          for (let i = 0; i < M; i++) {
            tv[i] = (off() + i * st) / fs; y0[i] = seg[i * st]; y1[i] = y[i * st];
          }
          const p1 = P.new(fBox.canvas, {
            height: 240, xlabel: '时间 / s', ylabel: '幅度', legend: true, legendPos: 'tr'
          });
          p1.add({ x: tv, y: y0, type: 'line', color: 0, width: 1, alpha: 0.75, label: '滤波前' });
          p1.add({ x: tv, y: y1, type: 'line', color: 2, width: 1.2, label: '滤波后' });
          p1.draw();

          // 频谱对比（与 ③ 一致：窗口长度 = 数据长度，nfft 只负责补零）
          const sa = specOf(seg, 'hann', 4096);
          const sb = specOf(y, 'hann', 4096);
          const r0 = sa.r, r1 = sb.r;
          const p2 = P.new(fBox2.canvas, {
            height: 240, xlabel: '频率 / Hz', ylabel: '幅度 / dB', legend: true, legendPos: 'tr',
            xlim: [0, fs / 2], ylim: [-100, 10]
          });
          p2.add({ x: r0.f, y: C.psdDb(r0.psd), type: 'line', color: 0, width: 1, alpha: 0.7, label: '滤波前' });
          p2.add({ x: r1.f, y: C.psdDb(r1.psd), type: 'line', color: 2, width: 1.2, label: '滤波后' });
          p2.draw();

          let e0 = 0, e1 = 0;
          for (let i = 0; i < seg.length; i++) { e0 += seg[i] * seg[i]; e1 += y[i] * y[i]; }
          U.clear(fMetrics);
          fMetrics.appendChild(UI.metrics([
            { label: '滤波器阶数', value: '200', unit: '阶（201 抽头）' },
            { label: '群延迟', value: '100', unit: '采样点（filtfilt 抵消）' },
            { label: '能量保留', value: U.fmt(10 * Math.log10((e1 || 1e-30) / (e0 || 1e-30)), 2), unit: 'dB' },
            { label: '滤波后 RMS', value: U.fmt(Math.sqrt(e1 / seg.length), 4), unit: '' }
          ]));
        }

        function exportCsv(kind) {
          if (!sig) return;
          const seg = region();
          let rows = [], head = '', name = '';
          if (kind === 'time') {
            head = 'n,t_s,x';
            const a = off();
            const st = Math.max(1, Math.floor(seg.length / 60000));
            for (let i = 0; i < seg.length; i += st) rows.push([i, ((a + i) / fs).toFixed(8), seg[i].toFixed(8)].join(','));
            name = 'waveform.csv';
          } else if (kind === 'spec') {
            const sp = specOf(seg, winSel.get(), parseInt(nfftSel.get(), 10));
            const r = sp.r;
            head = 'f_Hz,psd,dB';
            for (let i = 0; i < r.f.length; i++) rows.push([r.f[i].toFixed(4), r.psd[i].toExponential(6),
              10 * Math.log10(Math.max(r.psd[i], 1e-30)).toFixed(4)].join(','));
            name = 'spectrum.csv';
          } else {
            const wl = parseInt(winLenSel.get(), 10);
            const hop = Math.max(1, Math.round(wl * parseFloat(hopSel.get())));
            const r = C.stft(seg, { winLen: wl, hop: hop, win: 'hann', nfft: nextPow2(wl) * 2, fs: fs });
            head = 't_s,' + Array.from({ length: r.bins }, (_, i) => r.f[i].toFixed(1)).join(',');
            for (let m = 0; m < r.frames; m++) {
              const line = [r.t[m].toFixed(6)];
              for (let b = 0; b < r.bins; b++) line.push(r.S[m * r.bins + b].toFixed(3));
              rows.push(line.join(','));
            }
            name = 'stft.csv';
          }
          U.download(name, head + '\n' + rows.join('\n'), 'text/csv');
          UI.toast('已导出 ' + name);
        }

        /* 初次绘制 */
        drawTime(); drawSpectrum(); drawSTFT(); drawFilter();

        const offResize = onResize(function () {
          drawTime(); drawSpectrum(); drawSTFT(); drawFilter();
        });
        cleanups.push(offResize);
      }

      function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

      /* 提示语 */
      el.appendChild(UI.callout('eng', '工程提示',
        '上传的音频**只在浏览器内存里处理**，不会上传到任何服务器；页面刷新即释放。' +
        '若要复现本页结果，Python 侧可用 `scipy.io.wavfile.read` + `scipy.signal.periodogram` / `stft`，参数与本页控件一一对应。'));

      return function () { cleanups.forEach(fn => { try { fn(); } catch (e) {} }); };
    }
  });

  /* ============================================================
     §3 路由 C：#/toolbox/compare —— 三组对比实验
     ============================================================ */

  /* ------------------------------------------------------------
     C-0 数值内核：Burg AR、Jacobi 特征分解、MUSIC、IIR 原型设计
     （全部在本文件内实现，不依赖外部库；公式与注意点见注释）
     ------------------------------------------------------------ */

  /** Burg 递推求 AR 系数：x[n] + Σ a_k x[n-k] = e[n]，同时给出激励方差 */
  function burgAR(x, p) {
    const N = x.length;
    let f = Float64Array.from(x), b = Float64Array.from(x);
    const a = new Float64Array(p + 1); a[0] = 1;
    let sigma = 0;
    for (let i = 0; i < N; i++) sigma += x[i] * x[i];
    sigma /= N;
    for (let m = 1; m <= p; m++) {
      let num = 0, den = 0;
      for (let n = m; n < N; n++) { num += f[n] * b[n - 1]; den += f[n] * f[n] + b[n - 1] * b[n - 1]; }
      const k = -2 * num / (den || 1e-30);          // 反射系数
      // Levinson 递推：a_i ← a_i + k·a_{m-i}（a_0 = 1 ⇒ a_m = k）
      const an = new Float64Array(p + 1);
      for (let i = 0; i <= m; i++) an[i] = a[i] + k * a[m - i];
      for (let i = 0; i <= m; i++) a[i] = an[i];
      sigma *= (1 - k * k);
      // 前向/后向预测误差更新（必须用旧的 b，否则会被新值污染）
      const fo = Float64Array.from(f), bo = Float64Array.from(b);
      for (let n = m; n < N; n++) {
        f[n] = fo[n] + k * bo[n - 1];
        b[n] = bo[n - 1] + k * fo[n];
      }
    }
    return { a: a, sigma: Math.max(sigma, 1e-30) };
  }

  /** AR 谱：P(f) = σ² / |A(e^{-j2πf})|² */
  function arPsd(a, sigma, nfft) {
    const p = a.length - 1, out = new Float64Array(nfft);
    for (let i = 0; i < nfft; i++) {
      const w = TAU * i / nfft;
      let re = 1, im = 0;
      for (let k = 1; k <= p; k++) { re += a[k] * Math.cos(w * k); im -= a[k] * Math.sin(w * k); }
      out[i] = sigma / (re * re + im * im);
    }
    return out;
  }

  /** 对称矩阵的 Jacobi 特征分解：返回 [{val, vec}]，按 val 降序 */
  function jacobiEig(A0, n) {
    const A = [], V = [];
    for (let i = 0; i < n; i++) {
      A.push(Float64Array.from(A0[i]));
      const r = new Float64Array(n); r[i] = 1; V.push(r);
    }
    for (let sweep = 0; sweep < 60; sweep++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-22) break;
      for (let p = 0; p < n - 1; p++) {
        for (let q = p + 1; q < n; q++) {
          if (Math.abs(A[p][q]) < 1e-30) continue;
          const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
          const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
          const c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (let k = 0; k < n; k++) { const kp = A[k][p], kq = A[k][q]; A[k][p] = c * kp - s * kq; A[k][q] = s * kp + c * kq; }
          for (let k = 0; k < n; k++) { const pk = A[p][k], qk = A[q][k]; A[p][k] = c * pk - s * qk; A[q][k] = s * pk + c * qk; }
          for (let k = 0; k < n; k++) { const kp = V[k][p], kq = V[k][q]; V[k][p] = c * kp - s * kq; V[k][q] = s * kp + c * kq; }
        }
      }
    }
    const ev = [];
    for (let i = 0; i < n; i++) {
      const vec = new Float64Array(n);
      for (let k = 0; k < n; k++) vec[k] = V[k][i];   // 第 i 列才是第 i 个特征向量
      ev.push({ val: A[i][i], vec: vec });
    }
    ev.sort((u, v) => v.val - u.val);
    return ev;
  }

  /**
   * MUSIC 伪谱（实信号版）
   * 注意点：实正弦在 M 维实协方差矩阵里占 **2 维**（cos 与 sin 各一维），
   * 所以 K 个实正弦的信号子空间维数是 2K，噪声子空间维数是 M−2K。
   * 导向矢量仍取复的 a(f)=[1, e^{j2πf}, …]，因为它落在 cos/sin 张成的复空间内，
   * 因此与噪声子空间正交 → P(f)=1/‖E_nᵀa(f)‖² 会在真频率处出现尖峰。
   */
  function musicPsd(x, M, K, nfft) {
    const N = x.length, L = N - M + 1;
    if (L < M) return { psd: new Float64Array(nfft), eig: [] };
    const R = [];
    for (let i = 0; i < M; i++) R.push(new Float64Array(M));
    for (let l = 0; l < L; l++) {
      for (let i = 0; i < M; i++) {
        const xi = x[l + i];
        for (let j = i; j < M; j++) R[i][j] += xi * x[l + j];
      }
    }
    for (let i = 0; i < M; i++) for (let j = i; j < M; j++) { R[i][j] /= L; R[j][i] = R[i][j]; }
    const ev = jacobiEig(R, M);
    const ns = Math.max(1, M - 2 * K);
    const noise = ev.slice(M - ns).map(e => e.vec);
    const out = new Float64Array(nfft);
    // 关键优化：把 a^H(f) 的 cos/sin 提前算成表，
    // 否则每个噪声特征向量都要重算一遍三角函数，2048 点 × 60 维会慢一个数量级。
    const cr = new Float64Array(M), ci = new Float64Array(M);
    for (let g = 0; g < nfft; g++) {
      const w = TAU * g / nfft;
      for (let m = 0; m < M; m++) { cr[m] = Math.cos(w * m); ci[m] = -Math.sin(w * m); }
      let acc = 0;
      for (let e = 0; e < noise.length; e++) {
        const v = noise[e];
        let re = 0, im = 0;
        for (let m = 0; m < M; m++) { const vm = v[m]; re += vm * cr[m]; im += vm * ci[m]; }
        acc += re * re + im * im;
      }
      out[g] = 1 / Math.max(acc, 1e-30);
    }
    return { psd: out, eig: ev.map(e => e.val) };
  }

  /* ---------- IIR 模拟原型 ---------- */
  const pow10m1 = x => Math.pow(10, x) - 1;

  /** Butterworth 原型：极点在单位圆左半平面等角分布 */
  function buttap(N) {
    const p = [];
    for (let k = 0; k < N; k++) {
      const th = (2 * k + 1) * Math.PI / (2 * N);
      p.push(cx(-Math.sin(th), Math.cos(th)));
    }
    return { z: [], p: p, k: 1, N: N, type: 'butter' };
  }

  /** Chebyshev I 原型：极点落在椭圆上，通带等波纹 */
  function cheb1ap(N, rp) {
    const eps = Math.sqrt(pow10m1(0.1 * rp));
    const v0 = Math.asinh(1 / eps) / N;
    const sh = Math.sinh(v0), ch = Math.cosh(v0);
    const p = [];
    for (let k = 0; k < N; k++) {
      const th = (2 * k + 1) * Math.PI / (2 * N);
      p.push(cx(-sh * Math.sin(th), ch * Math.cos(th)));
    }
    return { z: [], p: p, k: 1, N: N, type: 'cheby1' };
  }

  /** 完全椭圆积分 K(m)，m = k²（AGM 法，二次收敛） */
  function ellipK(m) {
    let a = 1, b = Math.sqrt(Math.max(0, 1 - m));
    for (let i = 0; i < 60 && Math.abs(a - b) > 1e-16 * Math.abs(a); i++) {
      const a1 = (a + b) / 2; b = Math.sqrt(a * b); a = a1;
    }
    return Math.PI / (2 * ((a + b) / 2));
  }
  const ellipKm1 = m => ellipK(1 - m);

  /** Jacobi 椭圆函数 sn/cn/dn（下降 Landen 变换，A&S 16.4） */
  function ellipJ(u, m) {
    if (m >= 1 - 1e-15) { const ch = Math.cosh(u); return { sn: Math.tanh(u), cn: 1 / ch, dn: 1 / ch }; }
    const A = [], C = [];
    let a = 1, b = Math.sqrt(Math.max(0, 1 - m)), c = Math.sqrt(Math.max(0, m)), n = 0;
    A.push(a); C.push(c);
    while (Math.abs(c) > 1e-16 && n < 24) {
      const a1 = (a + b) / 2, b1 = Math.sqrt(a * b), c1 = (a - b) / 2;
      a = a1; b = b1; c = c1; n++; A.push(a); C.push(c);
    }
    let phi = Math.pow(2, n) * a * u;
    for (let i = n; i >= 1; i--) {
      phi = (Math.asin(Math.max(-1, Math.min(1, C[i] / A[i] * Math.sin(phi)))) + phi) / 2;
    }
    const sn = Math.sin(phi);
    return { sn: sn, cn: Math.cos(phi), dn: Math.sqrt(Math.max(0, 1 - m * sn * sn)) };
  }

  /** 反 Jacobi sn（Landen 下降，支持复变量） */
  function arcJacSn(w, m) {
    const k0 = Math.sqrt(m);
    if (k0 > 1) return cx(NaN, NaN);
    if (k0 === 1) return cx(Math.atanh(Math.abs(w.re || w.im)) * (w.re < 0 ? -1 : 1), 0);
    const ks = [k0];
    let it = 0;
    while (ks[ks.length - 1] > 1e-17 && it < 20) {
      const kk = ks[ks.length - 1];
      ks.push((1 - Math.sqrt((1 - kk) * (1 + kk))) / (1 + Math.sqrt((1 - kk) * (1 + kk))));
      it++;
    }
    let K = Math.PI / 2;
    for (let i = 1; i < ks.length; i++) K *= (1 + ks[i]);
    const ws = [w];
    for (let i = 0; i + 1 < ks.length; i++) {
      const wn = ws[ws.length - 1], kn = ks[i];
      const t = csqrt(csub(cx(1, 0), cmul(cscale(wn, kn), cscale(wn, kn))));
      ws.push(cdiv(cscale(wn, 2), cscale(cadd(cx(1, 0), t), 1 + ks[i + 1])));
    }
    return cscale(casin(ws[ws.length - 1]), 2 * K / Math.PI);
  }

  /** 解次数方程：给定阶数 N 与 m₁ 返回可选性参数 m */
  function ellipDeg(N, m1) {
    const K1 = ellipK(m1), K1p = ellipKm1(m1);
    const q = Math.pow(Math.exp(-Math.PI * K1p / K1), 1 / N);
    let num = 0, den = 1;
    for (let i = 0; i <= 7; i++) num += Math.pow(q, i * (i + 1));
    for (let i = 1; i <= 8; i++) den += 2 * Math.pow(q, i * i);
    return 16 * q * Math.pow(num / den, 4);
  }

  /** 椭圆（Cauer）模拟低通原型。端口自 Lutovac/Orfanidis 的递推公式 */
  function ellipap(N, rp, rs) {
    if (N <= 1) {
      const p = -Math.sqrt(1 / pow10m1(0.1 * rp));
      return { z: [], p: [cx(p, 0)], k: -p, N: Math.max(1, N), type: 'ellip' };
    }
    const epsSq = pow10m1(0.1 * rp), eps = Math.sqrt(epsSq);
    const c1 = epsSq / pow10m1(0.1 * rs);
    const m = ellipDeg(N, c1), capk = ellipK(m);
    const sA = [], cA = [], dA = [];
    for (let v = 1 - (N % 2); v < N; v += 2) {
      const r = ellipJ(v * capk / N, m); sA.push(r.sn); cA.push(r.cn); dA.push(r.dn);
    }
    const z = [];
    sA.forEach(sv => {
      if (Math.abs(sv) < 1e-12) return;               // N 为奇数时中间那个 sn=0 不是零点
      const t = 1 / (Math.sqrt(m) * sv);
      z.push(cx(0, t)); z.push(cx(0, -t));
    });
    const v0 = capk * arcJacSn(cx(0, 1 / eps), c1).im / (N * ellipK(c1));
    const sv = ellipJ(v0, 1 - m);
    const p = [];
    for (let i = 0; i < sA.length; i++) {
      const den = 1 - Math.pow(dA[i] * sv.sn, 2);
      p.push(cscale(cx(-cA[i] * dA[i] * sv.sn * sv.cn, -sA[i] * sv.dn), 1 / (Math.abs(den) < 1e-12 ? 1e-12 : den)));
    }
    if (N % 2) {
      let norm = 0; p.forEach(q => { norm += q.re * q.re + q.im * q.im; });
      norm = Math.sqrt(norm) || 1;
      const extra = [];
      p.forEach(q => { if (Math.abs(q.im) > 1e-12 * norm) extra.push(cx(q.re, -q.im)); });
      extra.forEach(q => p.push(q));
    } else {
      const extra = p.map(q => cx(q.re, -q.im));
      extra.forEach(q => p.push(q));
    }
    return { z: z, p: p, k: 1, N: N, type: 'ellip' };
  }

  /** 双线性变换（T = 1，即采样率归一化为 1） */
  function bilinearZ(s) {
    const nr = 1 + s.re * 0.5, ni = s.im * 0.5;
    const dr = 1 - s.re * 0.5, di = -s.im * 0.5;
    const d = dr * dr + di * di || 1e-30;
    return cx((nr * dr + ni * di) / d, (ni * dr - nr * di) / d);
  }

  /** 满足指标的最低阶数（fp/fst 为对 fs 的归一化频率） */
  function minOrder(type, fp, fst, Ap, As) {
    const e2 = pow10m1(0.1 * Ap), A2 = pow10m1(0.1 * As);
    if (type === 'butter') return Math.max(1, Math.ceil(Math.log10(A2 / e2) / (2 * Math.log10(fst / fp))));
    if (type === 'cheby1') return Math.max(1, Math.ceil(Math.acosh(Math.sqrt(A2 / e2)) / Math.acosh(fst / fp)));
    if (type === 'ellip') {
      const c1 = e2 / A2, mt = Math.pow(fp / fst, 2);
      for (let N = 2; N <= 24; N++) if (ellipDeg(N, c1) >= mt) return N;
      return 24;
    }
    // FIR 窗函数法（凯泽经验公式）：N ≈ (As − 8) / (2.285·Δω)
    const dw = TAU * (fst - fp);
    return Math.max(3, Math.ceil((As - 8) / (2.285 * dw)));
  }

  /**
   * 设计数字低通（fs 归一化为 1）
   * @returns {zeros, poles, gain, N} 零极点增益形式；FIR 时 poles 为空、用 b 表示
   */
  function designLP(type, N, fp, fst, Ap, As) {
    if (type === 'fir') {
      let beta = 0;
      if (As > 50) beta = 0.1102 * (As - 8.7);
      else if (As > 21) beta = 0.5842 * Math.pow(As - 21, 0.4) + 0.07886 * (As - 21);
      const b = C.firWin({ order: N, type: 'low', fc: (fp + fst) / 2, win: 'kaiser', beta: beta });
      return { type: 'fir', N: N, b: b, a: [1], zeros: [], poles: [], gain: 1 };
    }
    let proto;
    if (type === 'butter') proto = buttap(N);
    else if (type === 'cheby1') proto = cheb1ap(N, Ap);
    else proto = ellipap(N, Ap, As);
    // 预畸变：ω_a = 2·tan(π·fp)（T = 1）
    let wc = 2 * Math.tan(Math.PI * fp);
    if (type === 'butter') wc /= Math.pow(pow10m1(0.1 * Ap), 1 / (2 * N));   // 把 −Ap dB 点放到 fp
    const ps = proto.p.map(q => bilinearZ(cscale(q, wc)));
    const zs = proto.z.map(q => bilinearZ(cscale(q, wc)));
    while (zs.length < ps.length) zs.push(cx(-1, 0));                        // s = ∞ → z = −1
    return { type: type, N: N, zeros: zs, poles: ps, gain: 1 };
  }

  /** 由零极点增益求 H(e^{jω})，ω = 0…π（返回 re/im 与归一化后的 dB、相位、群延迟） */
  function zpkResponse(d, nfft) {
    const re = new Float64Array(nfft), im = new Float64Array(nfft), gdArr = new Float64Array(nfft);
    for (let i = 0; i < nfft; i++) {
      const w = Math.PI * i / (nfft - 1);                 // 0 … π
      const zr = Math.cos(w), zi = Math.sin(w);
      let nr = 1, ni = 0;
      for (let k = 0; k < d.zeros.length; k++) {
        const q = d.zeros[k], tr = zr - q.re, ti = zi - q.im;
        const t = nr * tr - ni * ti; ni = nr * ti + ni * tr; nr = t;
      }
      let dr = 1, di = 0;
      for (let k = 0; k < d.poles.length; k++) {
        const q = d.poles[k], tr = zr - q.re, ti = zi - q.im;
        const t = dr * tr - di * ti; di = dr * ti + di * tr; dr = t;
      }
      const dd = dr * dr + di * di || 1e-300;
      re[i] = (nr * dr + ni * di) / dd * d.gain;
      im[i] = (ni * dr - nr * di) / dd * d.gain;

      // 群延迟用解析式：τ(ω) = Re{ Σ 1/(z−p_k) − Σ 1/(z−z_i) }
      // （由 lnH 对 ω 求导得到：d/dω lnH = j[Σ1/(z−z_i) − Σ1/(z−p_k)]，z = e^{jω}）
      // 好处是**完全避开相位去卷绕**：幅度零点处相位会跳 π，数值微分会在那里打出假尖峰。
      let g = 0;
      for (let k = 0; k < d.poles.length; k++) {
        const q = d.poles[k], ar = zr - q.re, ai = zi - q.im;
        const den = ar * ar + ai * ai;
        if (den > 1e-14) g += ar / den;
      }
      for (let k = 0; k < d.zeros.length; k++) {
        const q = d.zeros[k], ar = zr - q.re, ai = zi - q.im;
        const den = ar * ar + ai * ai;
        if (den > 1e-14) g -= ar / den;
      }
      gdArr[i] = g;
    }
    const M = reimToMetrics(re, im, nfft);
    M.gd = gdArr;
    return M;
  }

  /** FIR 系数 → 频率响应指标 */
  function firResponse(b, nfft) {
    const re = new Float64Array(nfft), im = new Float64Array(nfft), gdArr = new Float64Array(nfft);
    for (let i = 0; i < nfft; i++) {
      const w = Math.PI * i / (nfft - 1);
      let nr = 0, ni = 0, gr = 0, gi = 0;
      for (let k = 0; k < b.length; k++) {
        const cw = Math.cos(w * k), sw = Math.sin(w * k);
        nr += b[k] * cw; ni -= b[k] * sw;
        gr += k * b[k] * cw; gi -= k * b[k] * sw;      // G(ω) = Σ n·h[n]·e^{−jωn}
      }
      re[i] = nr; im[i] = ni;
      // τ(ω) = Re{G·conj(H)} / |H|²  —— 同样绕开相位卷绕
      const den = nr * nr + ni * ni;
      gdArr[i] = den > 1e-14 ? (gr * nr + gi * ni) / den : 0;
    }
    const M = reimToMetrics(re, im, nfft);
    M.gd = gdArr;
    return M;
  }

  function reimToMetrics(re, im, nfft) {
    const mag = new Float64Array(nfft), magDb = new Float64Array(nfft), ph = new Float64Array(nfft);
    let mx = 0;
    for (let i = 0; i < nfft; i++) { const v = Math.hypot(re[i], im[i]); mag[i] = v; if (v > mx) mx = v; }
    for (let i = 0; i < nfft; i++) {
      magDb[i] = 20 * Math.log10(Math.max(mag[i], 1e-12) / Math.max(mx, 1e-12));
      ph[i] = Math.atan2(im[i], re[i]);
    }
    // 归一化到「通带最大增益 = 0 dB」，便于不同滤波器画在同一张图上
    let pmax = -Infinity;
    for (let i = 0; i < nfft; i++) if (magDb[i] > pmax) pmax = magDb[i];
    for (let i = 0; i < nfft; i++) magDb[i] -= pmax;
    // 相位只用于"相频"作图（去卷绕后更易读），群延迟由调用方用解析式单独给
    return { mag: mag, magDb: magDb, phase: C.unwrap(ph), gd: null, nfft: nfft };
  }

  /** 冲激响应（IIR 用递推展开，FIR 直接是抽头）；返回有效长度（−60 dB 截断） */
  function impulseOf(d, N) {
    if (d.type === 'fir') {
      const h = d.b;
      let last = h.length - 1;
      let mx = 0; for (let i = 0; i < h.length; i++) mx = Math.max(mx, Math.abs(h[i]));
      for (let i = h.length - 1; i >= 0; i--) if (Math.abs(h[i]) > mx * 1e-3) { last = i; break; }
      return { h: h, len: last + 1 };
    }
    const r = C.zpH2Impulse(d.zeros, d.poles, d.gain, N);
    let mx = 0;
    for (let i = 0; i < N; i++) mx = Math.max(mx, Math.hypot(r.re[i], r.im[i]));
    let last = N - 1;
    for (let i = N - 1; i >= 0; i--) if (Math.hypot(r.re[i], r.im[i]) > mx * 1e-3) { last = i; break; }
    return { h: r.re, len: last + 1 };
  }

  /* ------------------------------------------------------------
     路由主体
     ------------------------------------------------------------ */
  R.register('toolbox/compare', {
    title: '对比实验台',
    lede: '同一组数据、同一张图上横向对比：**① 谱估计方法**（周期图 / Bartlett / Welch / AR-Burg / MUSIC）、**② 窗函数**、**③ FIR 与 IIR 滤波器**。每一步都给出可量化的判据，而不是"看着像"。',
    tags: ['工具箱', '对比', '谱估计', '窗函数', '滤波器'],
    render: function (el, params) {
      let which = (params && params.tab) || 'spec';
      const bodyEl = h('div');
      const tabSeg = UI.seg({
        label: '实验', value: which,
        options: [{ value: 'spec', label: '① 谱估计对比' }, { value: 'win', label: '② 窗函数对比' }, { value: 'filt', label: '③ 滤波器对比' }],
        onChange: function (v) {
          which = v;
          DSP.share.syncParams({ tab: v });
          mount();
        }
      });
      el.appendChild(card('选择实验', null, [tabSeg.el]));
      el.appendChild(bodyEl);

      let cleanup = null;
      function mount() {
        if (cleanup) { try { cleanup(); } catch (e) {} }
        U.clear(bodyEl);
        cleanup = which === 'spec' ? expSpectrum(bodyEl)
          : which === 'win' ? expWindow(bodyEl) : expFilter(bodyEl);
      }
      mount();
      return function () { if (cleanup) { try { cleanup(); } catch (e) {} } };
    }
  });

  /* ============================================================
     C-①  谱估计方法对比
     ============================================================ */
  function expSpectrum(root) {
    const NF = 2048;                                  // 画图用的频栅
    let f1 = 0.20;                                    // 归一化频率（fs = 1）

    const snrS = UI.slider({
      label: '输入 SNR', min: -10, max: 20, step: 1, value: 6, unit: 'dB', digits: 0, onInput: run
    });
    const gapS = UI.slider({
      label: '两频率间距（单位 Δf = fs/N）', min: 0.2, max: 4, step: 0.1, value: 1.2,
      unit: '×Δf', digits: 1, onInput: run
    });
    const nSel = UI.select({
      label: '数据长度 N', value: '256',
      options: [{ value: '128', label: '128' }, { value: '256', label: '256' },
        { value: '512', label: '512' }, { value: '1024', label: '1024' }, { value: '2048', label: '2048' }],
      onChange: run
    });
    const arS = UI.slider({ label: 'AR 阶数 p', min: 4, max: 48, step: 1, value: 16, onInput: run });
    const mS = UI.slider({
      label: 'MUSIC 子空间维数 M（须 > 2×信源数）', min: 8, max: 96, step: 1, value: 64, onInput: run
    });
    const seedS = UI.slider({ label: '随机种子', min: 1, max: 40, step: 1, value: 7, digits: 0, onInput: run });

    const box = UI.plotBox({
      title: '归一化谱估计对比（各自峰值归 0 dB，纵向错开 25 dB 便于观察）',
      caption: '同一张图里上下错开只是为了让 5 条曲线不互相压住；每条的**纵向刻度各自归零**，横向位置才是可比的。'
    });
    const tblEl = h('div');
    const metricEl = h('div');

    root.appendChild(card('① 谱估计方法对比', null, [
      h('div', { html: U.md('信号：两个**幅度相等**的实正弦 `f₁ = 0.20·fs`、`f₂ = f₁ + 间距·fs/N`，叠加高斯白噪声。判据：两真频之间是否出现深于 3 dB 的凹陷（出现即"分辨出两个峰"），以及峰位误差（以 Δf = fs/N 为单位）。\n\n**看 MUSIC 时要盯住 M**：M 既是子空间维数，也是它的"有效孔径"，基础分辨率约为 1/M 而不是 1/N —— N 只决定协方差估计得准不准。所以把 M 从 24 调到 64，往往比把 N 从 256 加到 1024 更能立刻看出两个峰。') }),
      UI.ctrlPanel('实验参数', [snrS, gapS, nSel, arS, mS, seedS]),
      box.el,
      metricEl,
      tblEl,
      UI.callout('eng', '怎么读这张图',
        '周期图方差大、Bartlett/Welch 用"分段平均"换方差 stability 但分辨率变差（有效长度只有 1/K）；' +
        'AR-Burg 与 MUSIC 属于**模型类 / 子空间类**方法，可以突破 Δf = 1/N 的瑞利限，' +
        '代价是需要定阶、对模型失配敏感，且计算量高出一到两个数量级。')
    ]));

    function run() {
      const N = parseInt(nSel.get(), 10);
      const snr = snrS.get(), gap = gapS.get();
      const df = 1 / N;
      const f2 = f1 + gap * df;
      const p = Math.round(arS.get()), M = Math.min(Math.round(mS.get()), Math.floor(N / 2) - 1);

      // 造数据
      const rnd = U.rng(Math.round(seedS.get()) * 1013);
      const x = new Float64Array(N);
      for (let n = 0; n < N; n++) x[n] = Math.sin(TAU * f1 * n) + Math.sin(TAU * f2 * n);
      let pw = 0; for (let i = 0; i < N; i++) pw += x[i] * x[i]; pw /= N;
      const sg = Math.sqrt(pw / Math.pow(10, snr / 10));
      for (let i = 0; i < N; i++) x[i] += sg * gaussRnd(rnd);

      const fgrid = new Float64Array(NF);
      for (let i = 0; i < NF; i++) fgrid[i] = i / NF;   // 0 … 0.5（fs = 1）

      const curves = [];
      const rows = [];

      function push(name, color, psdRaw, costMs, note) {
        // 归一化到峰值 0 dB 后纵向错开
        const db = new Float64Array(NF);
        let mx = -Infinity;
        for (let i = 0; i < NF; i++) {
          db[i] = 10 * Math.log10(Math.max(psdRaw[i], 1e-30));
          if (db[i] > mx) mx = db[i];
        }
        for (let i = 0; i < NF; i++) db[i] -= mx;
        const shift = -25 * curves.length;
        const yv = new Float64Array(NF);
        for (let i = 0; i < NF; i++) yv[i] = db[i] + shift;
        curves.push({ x: fgrid, y: yv, type: 'line', color: color, width: 1.4, label: name });

        // 判据
        const i1 = Math.round(f1 * NF), i2 = Math.round(f2 * NF);
        let dip = 0;
        for (let i = i1; i <= i2; i++) if (db[i] < dip) dip = db[i];
        const side = Math.max(db[i1], db[i2]);
        const resolved = (dip - side) < -3;
        // 峰位误差：在 ±2Δf 内找极大
        const w = Math.max(2, Math.round(2 * df * NF));
        const pk1 = localMaxima(db, i1 - w, i1 + w, 1)[0];
        const pk2 = localMaxima(db, i2 - w, i2 + w, 1)[0];
        const e1 = pk1 ? Math.abs(pk1.i / NF - f1) / df : NaN;
        const e2 = pk2 ? Math.abs(pk2.i / NF - f2) / df : NaN;
        rows.push([
          name, note,
          resolved ? '✔ 分辨出两个峰' : '✘ 糊成一个峰',
          U.fmt(dip - side, 1) + ' dB',
          isFinite(e1 + e2) ? U.fmt((e1 + e2) / 2, 3) + ' Δf' : '—',
          U.fmt(costMs, 2) + ' ms'
        ]);
      }

      // 1) 周期图
      let t0 = performance.now();
      let r = C.periodogram(x, C.window('hann', N), NF, 1);
      push('周期图（汉宁窗）', 0, r.psd, performance.now() - t0, '分辨率 ≈ 1/N，方差不随 N 下降');

      // 2) Bartlett
      t0 = performance.now();
      let rb = C.psdBartlett(x, 4, 1);
      const bPsd = resamplePsd(rb.psd, rb.f, NF);
      push('Bartlett（4 段不重叠）', 1, bPsd, performance.now() - t0, '方差 ÷4，分辨率 ≈ 4/N');

      // 3) Welch
      t0 = performance.now();
      const rw = C.pwelch(x, { segLen: Math.max(16, N >> 2), overlap: 0.5, win: 'hann', nfft: NF, fs: 1 });
      push('Welch（50% 重叠）', 2, rw.psd, performance.now() - t0, '段数 ' + rw.K + '，方差 ≈ 1/K');

      // 4) AR-Burg
      t0 = performance.now();
      const ar = burgAR(x, Math.min(p, Math.floor(N / 2) - 2));
      push('AR-Burg（p=' + (ar.a.length - 1) + '）', 3, arPsd(ar.a, ar.sigma, NF), performance.now() - t0,
        '模型类，阶数过定出虚假峰');

      // 5) MUSIC
      t0 = performance.now();
      const mu = musicPsd(x, M, 2, NF);
      push('MUSIC（M=' + M + '）', 4, mu.psd, performance.now() - t0, '子空间类，需已知信源数 2');

      // 画图
      const plt = P.new(box.canvas, {
        height: 340, xlabel: '归一化频率 f/fs', ylabel: '相对电平 / dB（已错开）',
        legend: true, legendPos: 'tr',
        xlim: [Math.max(0, f1 - 20 * df), Math.min(0.5, f2 + 20 * df)]
      });
      curves.forEach(c => plt.add(c));
      plt.vline(f1, { color: '#888', dash: [4, 3], label: 'f₁' });
      plt.vline(f2, { color: '#888', dash: [4, 3], label: 'f₂' });
      plt.draw();

      U.clear(tblEl);
      tblEl.appendChild(UI.table({
        cols: [{ title: '方法' }, { title: '特点' }, { title: '是否分辨' }, { title: '两峰间凹陷' },
          { title: '峰位误差（频栅 0.5Δf）' }, { title: '耗时', num: true }],
        rows: rows
      }));

      U.clear(metricEl);
      metricEl.appendChild(UI.metrics([
        { label: '数据长度 N', value: String(N), unit: '点' },
        { label: '瑞利限 Δf', value: U.fmt(df * 1000, 3), unit: '×10⁻³ fs' },
        { label: '真实间距', value: U.fmt(gap, 2), unit: '×Δf' },
        { label: 'f₂', value: U.fmt(f2, 5), unit: '×fs' },
        { label: '输入 SNR', value: U.fmt(snr, 0), unit: 'dB' },
        { label: 'MUSIC 噪声子空间', value: String(Math.max(1, M - 4)), unit: '维' }
      ]));
    }

    function gaussRnd(rnd) {
      let u = 0, v = 0;
      while (u === 0) u = rnd();
      while (v === 0) v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
    }

    /** 把任意长度的 psd 重采样到 NF 点栅格（线性插值，仅用于画图对比） */
    function resamplePsd(psd, f, NF) {
      const out = new Float64Array(NF);
      const last = psd.length - 1;
      for (let i = 0; i < NF; i++) {
        const u = i / NF / (f[last] || 0.5) * last;
        const i0 = Math.floor(u), i1 = Math.min(last, i0 + 1), fr = u - i0;
        out[i] = psd[i0] * (1 - fr) + psd[i1] * fr;
      }
      return out;
    }

    run();
    return onResize(run);
  }

  /* ============================================================
     C-②  窗函数对比
     ============================================================ */
  function expWindow(root) {
    const TYPES = ['rect', 'bartlett', 'hann', 'hamming', 'blackman', 'blackmanharris', 'kaiser'];
    const NF = 4096;

    const nSel = UI.select({
      label: '窗长度 N', value: '256',
      options: [{ value: '64', label: '64' }, { value: '128', label: '128' }, { value: '256', label: '256' }, { value: '512', label: '512' }],
      onChange: run
    });
    const betaS = UI.slider({ label: '凯泽窗 β', min: 0, max: 14, step: 0.1, value: 8.6, onInput: run });
    const xlimS = UI.slider({
      label: '频谱横轴范围', min: 2, max: 16, step: 1, value: 8, unit: 'bin', digits: 0, onInput: run
    });

    const wBox = UI.plotBox({ title: '窗函数时域形状（归一化长度）' });
    const sBox = UI.plotBox({ title: '窗频谱（dB，0 dB = 各自峰值）：主瓣越窄频率分辨率越高，旁瓣越低越不容易被强信号淹没' });
    const dBox = UI.plotBox({ title: '强弱双音演示：0 dB 强音 + 60 dB 弱音，看弱音会不会被强音的泄漏盖住' });
    const tblEl = h('div');

    root.appendChild(card('② 窗函数对比', null, [
      UI.ctrlPanel('显示参数', [nSel, betaS, xlimS]),
      wBox.el, sBox.el,
      h('div', { style: { marginBottom: '10px' } }, tblEl),
      dBox.el,
      UI.callout('tip', '选窗的三条经验',
        '1) 只要分辨率、信号动态范围不大 → 矩形窗；' +
        '2) 通用场景 → 汉宁/汉明（旁瓣 −32/−43 dB，主瓣只宽一倍）；' +
        '3) 要在一堆强干扰里找弱信号 → 布莱克曼-哈里斯（−92 dB）或凯泽（β 可调）。' +
        '**加窗从不白给**：旁瓣低 ⇒ 主瓣宽 ⇒ 两个靠得近的峰更容易糊在一起（见 ① 里"间距"滑块的结论）。')
    ]));

    function run() {
      const N = parseInt(nSel.get(), 10);
      const beta = betaS.get();
      const xl = xlimS.get();

      // 时域
      const idx = new Float64Array(N);
      for (let i = 0; i < N; i++) idx[i] = i / (N - 1);        // 归一化长度，便于不同 N 叠在一起
      const pw = P.new(wBox.canvas, { height: 220, xlabel: '归一化位置', ylabel: 'w(n)', legend: true, legendPos: 'tr' });
      // 频谱
      const ps = P.new(sBox.canvas, {
        height: 280, xlabel: '频率 / bin', ylabel: '幅度 / dB', legend: true, legendPos: 'tr',
        xlim: [0, xl], ylim: [-110, 5]
      });
      const rows = [];
      TYPES.forEach((ty, ci) => {
        const w = C.window(ty, N, beta);
        const met = C.windowMetrics(ty, beta);
        const S = C.fft(w, NF);
        const m = C.mag(S);
        let mx = 0; for (let i = 0; i < m.length; i++) if (m[i] > mx) mx = m[i];
        const db = new Float64Array(NF >> 1);
        const fb = new Float64Array(NF >> 1);
        for (let i = 0; i < db.length; i++) {
          db[i] = 20 * Math.log10(Math.max(m[i], 1e-20) / mx);
          fb[i] = i * N / NF;                                   // 以 bin 为单位（1 bin = 1/N）
        }
        const nm = C.WINDOWS[ty].name;
        pw.add({ x: idx, y: w, type: 'line', color: seqColor(ci), width: 1.4, label: nm });
        ps.add({ x: fb, y: db, type: 'line', color: seqColor(ci), width: 1.3, label: nm });
        rows.push([
          nm,
          U.fmt(met.mainLobe, 2),
          U.fmt(met.sll, 1),
          U.fmt(met.enbw, 3),
          U.fmt(10 * Math.log10(met.enbw), 2),
          U.fmt(met.scallop, 2)
        ]);
      });
      pw.draw(); ps.draw();

      U.clear(tblEl);
      tblEl.appendChild(UI.table({
        cols: [{ title: '窗' }, { title: '主瓣宽 / bin', num: true }, { title: '最高旁瓣 / dB', num: true },
          { title: 'ENBW / bin', num: true }, { title: '处理损失 / dB', num: true }, { title: '扇贝损失 / dB', num: true }],
        rows: rows
      }));

      // 强弱双音演示
      const M = Math.max(512, N * 4);
      const strong = 64 / M, weak = 160 / M;
      const x = new Float64Array(M);
      for (let n = 0; n < M; n++) {
        x[n] = Math.sin(TAU * strong * n) + 1e-3 * Math.sin(TAU * weak * n);   // −60 dB 弱音
      }
      const pd = P.new(dBox.canvas, {
        height: 280, xlabel: '频率 / bin', ylabel: '幅度 / dB', legend: true, legendPos: 'tr',
        xlim: [20, 220], ylim: [-120, 5]
      });
      const demoTypes = ['rect', 'hann', 'blackmanharris'];
      demoTypes.forEach((ty, ci) => {
        const r = C.periodogram(x, C.window(ty, M, beta), NF, 1);
        const db = C.psdDb(r.psd);
        let mx = -Infinity; for (let i = 0; i < db.length; i++) if (db[i] > mx) mx = db[i];
        for (let i = 0; i < db.length; i++) db[i] -= mx;
        const fb = new Float64Array(r.f.length);
        for (let i = 0; i < fb.length; i++) fb[i] = r.f[i] * M;
        pd.add({ x: fb, y: db, type: 'line', color: seqColor(ci), width: 1.3, label: C.WINDOWS[ty].name });
      });
      pd.hline(-60, { color: '#f97316', dash: [4, 3], label: '弱音真实电平 −60 dB' });
      pd.vline(160, { color: '#f97316', dash: [2, 3] });
      pd.draw();
    }

    run();
    return onResize(run);
  }

  /* ============================================================
     C-③  滤波器对比
     ============================================================ */
  function expFilter(root) {
    const NFFT = 1024;

    const fpS = UI.slider({ label: '通带边 fp', min: 0.04, max: 0.40, step: 0.005, value: 0.10, unit: '×fs', digits: 3, onInput: run });
    const fsS = UI.slider({ label: '阻带边 fst', min: 0.05, max: 0.48, step: 0.005, value: 0.16, unit: '×fs', digits: 3, onInput: run });
    const apS = UI.slider({ label: '通带波纹 Ap', min: 0.1, max: 3, step: 0.1, value: 1, unit: 'dB', digits: 1, onInput: run });
    const asS = UI.slider({ label: '阻带衰减 As', min: 20, max: 90, step: 1, value: 50, unit: 'dB', digits: 0, onInput: run });

    const mBox = UI.plotBox({ title: '幅频响应（归一化到通带最大增益 0 dB）' });
    const pBox = UI.plotBox({ title: '相频响应（去卷绕）' });
    const gBox = UI.plotBox({
      title: '群延迟（单位：采样点）—— FIR 是常数，IIR 在通带边缘会翘起来',
      caption: '椭圆滤波器在阻带的**传输零点**处，相位会瞬间跳 π，群延迟在数学上是发散的；图上把超出 [−10, 80] 采样点的部分截断了，否则一个奇点会把整张图压扁。'
    });
    const iBox = UI.plotBox({ title: '冲激响应（前 120 点）' });
    const tblEl = h('div');
    const warnEl = h('div');

    root.appendChild(card('③ FIR 窗函数法 vs IIR（Butterworth / Chebyshev I / 椭圆）', null, [
      h('div', { html: U.md('四者都按**同一组指标**（通带边 fp、阻带边 fst、通带波纹 Ap、阻带衰减 As）自动算出各自需要的**最低阶数**，再横向比较阶数、冲激响应长度、计算量与相位特性。') }),
      UI.ctrlPanel('设计指标', [fpS, fsS, apS, asS]),
      warnEl,
      mBox.el, pBox.el, gBox.el, iBox.el,
      tblEl,
      UI.callout('eng', '工程选型一句话',
        '要**线性相位**（波形不能失真：雷达/声呐脉冲、生物医学、音频均衡）→ FIR；' +
        '要**最少计算量**（窄过渡带、实时嵌入式）→ IIR，其中椭圆阶数最低但相位最差、对系数量化最敏感。' +
        'IIR 的非线性相位可以在离线处理里用 `filtfilt` 双向滤波抵消，但那就不可能是"实时"的了。')
    ]));

    function run() {
      let fp = fpS.get(), fst = fsS.get();
      if (fst <= fp + 0.01) { fst = fp + 0.01; fsS.set(fst, true); }
      const Ap = apS.get(), As = asS.get();

      U.clear(warnEl);
      if (fst - fp < 0.03) {
        warnEl.appendChild(UI.callout('warn', '过渡带很窄',
          '过渡带只有 ' + U.fmt((fst - fp) * 100, 1) + '%·fs，FIR 阶数会非常高；这正是 IIR 的主场。'));
      }

      const specs = [
        { key: 'fir', name: 'FIR（凯泽窗）', color: 0 },
        { key: 'butter', name: 'IIR 巴特沃斯', color: 1 },
        { key: 'cheby1', name: 'IIR 切比雪夫 I', color: 2 },
        { key: 'ellip', name: 'IIR 椭圆（Cauer）', color: 3 }
      ];

      const pm = P.new(mBox.canvas, {
        height: 300, xlabel: '频率 / ×fs', ylabel: '幅度 / dB', legend: true, legendPos: 'tr',
        xlim: [0, 0.5], ylim: [-110, 5]
      });
      const pp = P.new(pBox.canvas, { height: 220, xlabel: '频率 / ×fs', ylabel: '相位 / rad', legend: true, legendPos: 'tr', xlim: [0, 0.5] });
      const pg = P.new(gBox.canvas, {
        height: 240, xlabel: '频率 / ×fs', ylabel: '群延迟 / 采样点',
        legend: true, legendPos: 'tr', xlim: [0, 0.5], ylim: [-10, 80]
      });
      const pi = P.new(iBox.canvas, { height: 220, xlabel: 'n', ylabel: 'h(n)', legend: true, legendPos: 'tr' });

      const faxis = new Float64Array(NFFT);
      for (let i = 0; i < NFFT; i++) faxis[i] = 0.5 * i / (NFFT - 1);

      const rows = [];
      specs.forEach(sp => {
        const N = minOrder(sp.key, fp, fst, Ap, As);
        const d = designLP(sp.key, N, fp, fst, Ap, As);
        const R = sp.key === 'fir' ? firResponse(d.b, NFFT) : zpkResponse(d, NFFT);
        const imp = impulseOf(d, 512);

        // 指标：通带波纹、阻带实际衰减、群延迟波动
        const ip = Math.round(fp / 0.5 * (NFFT - 1));
        const is_ = Math.round(fst / 0.5 * (NFFT - 1));
        let pbMax = -Infinity, pbMin = Infinity;
        for (let i = 0; i <= ip; i++) { pbMax = Math.max(pbMax, R.magDb[i]); pbMin = Math.min(pbMin, R.magDb[i]); }
        let sbMax = -Infinity;
        for (let i = is_; i < NFFT; i++) sbMax = Math.max(sbMax, R.magDb[i]);
        let gdMax = -Infinity, gdMin = Infinity;
        for (let i = 0; i <= ip; i++) { gdMax = Math.max(gdMax, R.gd[i]); gdMin = Math.min(gdMin, R.gd[i]); }

        const macs = sp.key === 'fir' ? (d.b.length + 1) >> 1 : 2 * N + 1;
        rows.push([
          sp.name,
          String(N),
          String(imp.len),
          String(macs),
          U.fmt(pbMax - pbMin, 2),
          U.fmt(sbMax, 1),
          U.fmt(gdMax - gdMin, 2)
        ]);

        pm.add({ x: faxis, y: R.magDb, type: 'line', color: sp.color, width: 1.4, label: sp.name + '（N=' + N + '）' });
        pp.add({ x: faxis, y: R.phase, type: 'line', color: sp.color, width: 1.3, label: sp.name });
        const gdv = new Float64Array(NFFT);
        for (let i = 0; i < NFFT; i++) gdv[i] = Math.max(-10, Math.min(80, R.gd[i]));
        pg.add({ x: faxis, y: gdv, type: 'line', color: sp.color, width: 1.3, label: sp.name });
        const L = Math.min(120, imp.h.length);
        const nn = new Float64Array(L), hh = new Float64Array(L);
        for (let i = 0; i < L; i++) { nn[i] = i; hh[i] = imp.h[i]; }
        pi.add({ x: nn, y: hh, type: 'stem', color: sp.color, size: 2.4, label: sp.name + '（有效长度 ' + imp.len + '）' });
      });

      pm.vline(fp, { color: '#888', dash: [4, 3] });
      pm.vline(fst, { color: '#c0392b', dash: [4, 3] });
      pm.hline(-As, { color: '#c0392b', dash: [2, 4] });
      pm.draw(); pp.draw(); pg.draw(); pi.draw();

      U.clear(tblEl);
      tblEl.appendChild(UI.table({
        cols: [{ title: '类型' }, { title: '阶数', num: true }, { title: 'h 有效长度', num: true },
          { title: '乘加/样点', num: true }, { title: '通带起伏', num: true },
          { title: '阻带衰减', num: true }, { title: '群延迟波动', num: true }],
        rows: rows
      }));
    }

    run();
    return onResize(run);
  }

  /* ============================================================
     §4 路由 D：#/toolbox/dict —— 术语词典
     ============================================================ */

  /* ------------------------------------------------------------
     术语库补充：把 DSP.glossary.TERMS 从 57 条扩到 130+ 条
     字段：{ t 中文名, en 英文, d 一句话释义, tag 分类, auto:false 表示不做正文自动标注 }
     ------------------------------------------------------------ */
  const EXTRA_TERMS = {
    /* ---- 基础 ---- */
    '采样率': { t: '采样率', en: 'Sampling Rate', d: '单位时间的采样点数 fs（Hz）；其倒数即采样间隔 T = 1/fs。', tag: '基础', auto: false },
    '抗混叠滤波器': { t: '抗混叠滤波器', en: 'Anti-alias Filter', d: '采样前串在 ADC 前面的模拟低通，把高于 fs/2 的成分压下去，否则必然混叠。', tag: '基础' },
    '过采样': { t: '过采样', en: 'Oversampling', d: '以远高于奈奎斯特率的速率采样，可放宽抗混叠模拟滤波器、并把量化噪声摊到更宽的频带上。', tag: '基础' },
    '补零': { t: '补零', en: 'Zero Padding', d: '在数据后面补 0 再做 FFT，只是加密频域网格，**不提高真实分辨率**，但能减轻栅栏效应、让峰值位置更准。', tag: '基础' },
    '归一化频率': { t: '归一化频率', en: 'Normalized Frequency', d: '以采样率归一化的频率 f/fs ∈ [0, 0.5]，或数字角频率 ω ∈ [0, π]；写代码时最不容易出错的表示。', tag: '基础' },
    '单位冲激': { t: '单位冲激序列', en: 'Unit Impulse', d: 'δ[n]：只在 n=0 取 1。它与任何序列卷积都得到该序列本身，是 LTI 系统的"探针"。', tag: '基础' },
    '单位阶跃': { t: '单位阶跃序列', en: 'Unit Step', d: 'u[n]：n ≥ 0 取 1。与冲激的关系为 δ[n] = u[n] − u[n−1]。', tag: '基础' },
    '卷积': { t: '卷积', en: 'Convolution', d: '一个信号翻转平移后与另一个逐点相乘求和；时域卷积 ⇔ 频域相乘。', tag: '基础', auto: false },
    '冲激响应': { t: '冲激响应', en: 'Impulse Response', d: '系统对 δ[n] 的响应 h[n]，完全刻画了一个 LTI 系统。', tag: '基础', auto: false },
    '频率响应': { t: '频率响应', en: 'Frequency Response', d: 'h[n] 的 DTFT，H(e^{jω}) = |H|·e^{jφ}；模是幅频、幅角是相频。', tag: '基础', auto: false },
    '传递函数': { t: '系统函数', en: 'Transfer Function', d: 'H(z) = Y(z)/X(z)，有理分式的分子根为零点、分母根为极点。', tag: '基础', auto: false },
    '差分方程': { t: '差分方程', en: 'Difference Equation', d: 'y[n] = Σb_k x[n−k] − Σa_k y[n−k]，是 IIR/FIR 在代码里最直接的落地形式。', tag: '基础' },
    '零点': { t: '零点', en: 'Zero', d: '使 H(z)=0 的 z；位于单位圆上会造成该频率完全陷波。', tag: '基础', auto: false },
    '极点': { t: '极点', en: 'Pole', d: '使 H(z)→∞ 的 z；决定稳定性（必须在单位圆内）与谐振峰的尖锐程度。', tag: '基础', auto: false },
    '线性时不变': { t: '线性时不变系统', en: 'LTI System', d: '满足叠加性且参数不随时间变；只有 LTI 才能用卷积和频响完整描述。', tag: '基础' },
    '因果系统': { t: '因果系统', en: 'Causal System', d: '输出只依赖当前与过去的输入；非因果系统只能离线处理（如 filtfilt）。', tag: '基础' },
    'BIBO稳定': { t: 'BIBO 稳定性', en: 'BIBO Stability', d: '有界输入必产生有界输出；对因果 IIR 等价于所有极点在单位圆内。', tag: '基础' },
    '帕塞瓦尔定理': { t: '帕塞瓦尔定理', en: 'Parseval Theorem', d: '时域总能量等于频域总能量（差一个归一化系数），是"能量守恒"在变换域的说法。', tag: '基础' },
    '时宽带宽积': { t: '时宽带宽积', en: 'Time-Bandwidth Product', d: 'BT：脉宽与带宽之积，等于匹配滤波的处理增益（LFM 常做到 100 以上）。', tag: '基础' },
    '处理增益': { t: '处理增益', en: 'Processing Gain', d: '处理后信噪比相对处理前的提升，脉冲压缩为 10log10(BT)、相参积累为 10log10(N)。', tag: '基础' },
    '相干积累': { t: '相干积累', en: 'Coherent Integration', d: '把 N 个脉冲**按相位**相加，信噪比提升 10log10(N)；要求回波相位稳定。', tag: '基础' },
    '非相干积累': { t: '非相干积累', en: 'Non-coherent Integration', d: '先取幅度（或能量）再平均，不利用相位，增益约 N^0.7~N^0.9，低于相干积累。', tag: '基础' },
    '本底噪声': { t: '本底噪声', en: 'Noise Floor', d: '系统在无信号时的噪声功率，决定最小可检测信号。', tag: '基础' },
    '定点运算': { t: '定点运算', en: 'Fixed-point Arithmetic', d: '用整数表示小数的实现方式；字长有限会引入量化噪声、极限环与溢出，是嵌入式 DSP 的必修课。', tag: '基础' },

    /* ---- 变换 ---- */
    '快速卷积': { t: '快速卷积', en: 'Fast Convolution', d: '用 FFT 做频域相乘再反变换，复杂度由 O(NM) 降到 O(N log N)；长序列需分块。', tag: '变换' },
    '重叠相加法': { t: '重叠相加法', en: 'Overlap-Add', d: '分块快速卷积后把重叠部分相加，是最常用的长序列 FIR 实现。', tag: '变换' },
    '重叠保留法': { t: '重叠保留法', en: 'Overlap-Save', d: '每块保留上一块尾部作为"历史"，丢弃循环卷积污染的开头，与重叠相加等价但无加法开销。', tag: '变换' },
    '倒频谱': { t: '倒频谱', en: 'Cepstrum', d: '对数幅度谱的逆傅里叶变换，能把"乘性"的卷积/回声在倒频域分离，常用于回声时延与语音基频提取。', tag: '变换' },
    'DCT': { t: '离散余弦变换', en: 'DCT', d: '只用余弦基的实变换，能量集中性好，是 JPEG / MP3 压缩的核心。', tag: '变换' },
    'Chirp-Z变换': { t: 'Chirp-Z 变换', en: 'Chirp-Z Transform', d: '沿任意螺旋路径采样 Z 变换，可只对感兴趣的窄频段做高分辨细化。', tag: '变换' },
    'Zoom-FFT': { t: '频谱细化', en: 'Zoom FFT', d: '先混频搬移 + 低通抽取，再在小带宽上做 FFT，用很少的点换到很高的频率分辨率。', tag: '变换' },
    'Goertzel': { t: 'Goertzel 算法', en: 'Goertzel Algorithm', d: '只算 DFT 某一个频点的递推算法，检双音多频（DTMF）比完整 FFT 更省。', tag: '变换' },
    '时频分辨率': { t: '时频分辨率权衡', en: 'Time-Frequency Tradeoff', d: '时间分辨率与频率分辨率的乘积有下界，窗长只能二选一；这就是 STFT 与小波的根本约束。', tag: '变换' },
    '基带信号': { t: '基带复信号', en: 'Complex Baseband', d: '把带通信号下变频到零中频后用复数表示，采样率只需覆盖带宽而非载频。', tag: '变换' },
    '正交解调': { t: '正交解调', en: 'Quadrature Demodulation', d: '用 cos/sin 两路同时混频得到 I/Q，保留相位信息，是相参处理的前提。', tag: '变换' },

    /* ---- 滤波 ---- */
    '预畸变': { t: '频率预畸变', en: 'Frequency Prewarping', d: '双线性变换前先把模拟临界频率取 ω_a = (2/T)tan(ω_d T/2)，抵消 s→z 映射的频率压缩。', tag: '滤波' },
    '频率采样法': { t: '频率采样法', en: 'Frequency Sampling Method', d: '直接指定 N 个频点的理想响应再做 IDFT 得到 FIR 抽头，适合任意形状幅频。', tag: '滤波' },
    '等波纹设计': { t: '等波纹设计', en: 'Equiripple (Parks-McClellan)', d: '用 Remez 交替算法使通带/阻带误差等幅振荡，同指标下阶数最低，是最优 FIR 设计法。', tag: '滤波' },
    '最小相位': { t: '最小相位系统', en: 'Minimum Phase', d: '零点全在单位圆内；在同幅频响应的所有系统中能量最集中、群延迟最小，且逆系统稳定。', tag: '滤波' },
    '全通': { t: '全通滤波器', en: 'All-pass Filter', d: '幅频恒为 1，只改相位，用来做相位均衡或构造可调群延迟。', tag: '滤波' },
    '陷波器': { t: '陷波器', en: 'Notch Filter', d: '在单一频率处开一个深谷，用于去除工频干扰、螺旋桨轴频等窄带干扰。', tag: '滤波' },
    '梳状滤波器': { t: '梳状滤波器', en: 'Comb Filter', d: '幅频呈周期性齿状，用来抑制谐波族或实现整周期对消（如 MTI）。', tag: '滤波' },
    'CIC滤波器': { t: 'CIC 滤波器', en: 'CIC Filter', d: '积分器 + 梳状器级联，无乘法器，是变采样率系统里最省硬件的抗混叠/抗镜像滤波器。', tag: '滤波' },
    '多相分解': { t: '多相分解', en: 'Polyphase Decomposition', d: '把滤波器按相位拆成若干支路并行处理，是高效抽取/插值与信道化的基础。', tag: '滤波' },
    '抽取': { t: '抽取', en: 'Decimation', d: '先抗混叠滤波再每 M 个点取一个，把采样率降到 1/M。', tag: '滤波', auto: false },
    '插值': { t: '插值', en: 'Interpolation', d: '先每两点插 L−1 个零再低通滤掉镜像，把采样率提高到 L 倍。', tag: '滤波', auto: false },
    '级联型结构': { t: '级联型实现', en: 'Cascade Form', d: '把 H(z) 拆成二阶节（biquad）串联，量化敏感度远低于直接型，是工程实现的默认选择。', tag: '滤波' },
    '并联型结构': { t: '并联型实现', en: 'Parallel Form', d: '部分分式展开后并联，各支路独立，便于并行与极点灵敏度分析。', tag: '滤波' },
    '格型结构': { t: '格型结构', en: 'Lattice Structure', d: '由反射系数逐级级联，与 Levinson-Durbin / Burg 递推天然对应，且易于保证稳定性。', tag: '滤波' },
    '系数量化': { t: '系数量化', en: 'Coefficient Quantization', d: '系数被有限字长截断后零极点会漂移，窄带/高阶 IIR 尤其敏感，需做灵敏度分析。', tag: '滤波' },
    '极限环': { t: '极限环', en: 'Limit Cycle', d: '定点 IIR 在零输入下因舍入产生的自持小幅振荡，是定点实现特有的寄生现象。', tag: '滤波' },

    /* ---- 谱估计 ---- */
    '多窗法': { t: '多窗法', en: 'Multitaper', d: '用一组正交的 Slepian 窗分别做周期图再平均，在方差与分辨率之间取得比 Welch 更好的折中。', tag: '谱估计' },
    '最大熵谱估计': { t: '最大熵谱估计', en: 'Maximum Entropy Method', d: '在已知自相关约束下使熵最大的谱，等价于 AR 模型谱，短数据下分辨率远高于周期图。', tag: '谱估计' },
    'Burg算法': { t: 'Burg 算法', en: 'Burg Algorithm', d: '直接用前/后向预测误差递推反射系数的 AR 估计法，保证模型稳定，且不需要先估自相关。', tag: '谱估计' },
    '定阶准则': { t: '定阶准则', en: 'AIC / MDL', d: '用 AIC（偏重拟合）或 MDL（偏重简洁）自动选 AR 阶数/信源数；阶数过高必出虚假谱峰。', tag: '谱估计' },
    '互谱': { t: '互功率谱', en: 'Cross Spectrum', d: '两信号互相关的傅里叶变换，其相位给出两路之间的时延差，是被动测向的基础。', tag: '谱估计' },
    '相干函数': { t: '相干函数', en: 'Coherence', d: '0~1 之间衡量两信号在某频率上的线性相关程度，接近 1 才说明该频段的时延估计可信。', tag: '谱估计' },
    '等效噪声带宽': { t: '等效噪声带宽', en: 'ENBW', d: '窗的噪声带宽（单位 bin）；ENBW 越大噪声进得越多，处理损失 = 10log10(ENBW)。', tag: '谱估计' },
    '扇贝损失': { t: '扇贝损失', en: 'Scalloping Loss', d: '信号频率落在两个 FFT 频点之间时，峰值被低估的最大分贝数（矩形窗可达 3.9 dB）。', tag: '谱估计' },
    '信号子空间': { t: '信号子空间', en: 'Signal Subspace', d: '协方差矩阵中大特征值对应的特征向量张成的空间，包含了信源的全部信息。', tag: '谱估计' },
    '噪声子空间': { t: '噪声子空间', en: 'Noise Subspace', d: '小特征值对应的特征向量空间，与阵列流形（导向矢量）正交 —— MUSIC 正是利用这一点。', tag: '谱估计' },
    '空间谱': { t: '空间谱', en: 'Spatial Spectrum', d: '把"功率随频率的分布"换成"功率随方位角的分布"，是阵列信号处理对谱估计的自然推广。', tag: '谱估计' },
    '协方差矩阵': { t: '协方差矩阵', en: 'Covariance Matrix', d: 'R = E[xxᴴ]；其结构（秩、特征值分布）决定了所有子空间类算法能做什么。', tag: '谱估计', auto: false },
    '特征分解': { t: '特征分解', en: 'Eigendecomposition', d: '把 R 拆成特征值与特征向量，是 MUSIC / ESPRIT / PCA 的共同第一步。', tag: '谱估计', auto: false },
    '压缩感知': { t: '压缩感知', en: 'Compressed Sensing', d: '利用信号在某一变换域的稀疏性，用远少于奈奎斯特的采样数重建信号。', tag: '谱估计' },

    /* ---- 随机信号 / 检测估计 ---- */
    '平稳随机过程': { t: '平稳随机过程', en: 'Stationary Process', d: '统计特性不随时间平移而变；只有平稳（至少宽平稳）才能谈功率谱。', tag: '随机信号' },
    '各态历经': { t: '各态历经', en: 'Ergodicity', d: '时间平均等于集合平均 —— 正因为各态历经，我们才能用一段实测数据估计统计特性。', tag: '随机信号' },
    '高斯噪声': { t: '高斯噪声', en: 'Gaussian Noise', d: '幅度服从正态分布的噪声；经过线性系统后仍是高斯的，这让理论分析大大简化。', tag: '随机信号' },
    '最大似然估计': { t: '最大似然估计', en: 'Maximum Likelihood', d: '取使观测出现概率最大的参数；在高斯噪声下退化为最小二乘。', tag: '随机信号' },
    '最小二乘': { t: '最小二乘', en: 'Least Squares', d: '最小化误差平方和；白噪声高斯假设下就是最优线性无偏估计。', tag: '随机信号' },
    '克拉美罗界': { t: '克拉美罗界', en: 'Cramér-Rao Bound', d: '任何无偏估计的方差下界；参数估计性能好不好，拿它当尺子。', tag: '随机信号' },
    '检测概率': { t: '检测概率', en: 'Probability of Detection', d: '目标存在时正确判为存在的概率 Pd；与虚警率、信噪比三者互相制约。', tag: '随机信号' },
    '虚警概率': { t: '虚警概率', en: 'Probability of False Alarm', d: '无目标时误报的概率 Pfa；CFAR 的全部意义就是让它不随背景变化。', tag: '随机信号' },
    'ROC曲线': { t: 'ROC 曲线', en: 'ROC Curve', d: '以 Pfa 为横轴、Pd 为纵轴的检测性能曲线，曲线下面积越大检测器越好。', tag: '随机信号' },
    '蒙特卡洛': { t: '蒙特卡洛方法', en: 'Monte Carlo', d: '用大量随机试验统计性能（如检测概率、估计 RMSE），是理论推不动时的通用手段。', tag: '随机信号' },

    /* ---- 阵列 ---- */
    '均匀线阵': { t: '均匀线阵', en: 'Uniform Linear Array', d: 'ULA：等间距排成一条直线的阵列，是最简单也最常用的阵列几何。', tag: '阵列' },
    '导向矢量': { t: '导向矢量', en: 'Steering Vector', d: '某一方向到达时各阵元响应的复数向量 a(θ)，是连接物理阵列与算法的桥梁。', tag: '阵列' },
    '阵列流形': { t: '阵列流形', en: 'Array Manifold', d: '所有方向的导向矢量构成的集合；阵元位置误差会让它"变形"，导致算法失效。', tag: '阵列' },
    '阵列孔径': { t: '阵列孔径', en: 'Array Aperture', d: '阵列的物理长度；孔径越大波束越窄，方位分辨率 ≈ λ/(孔径·cosθ)。', tag: '阵列' },
    '波束宽度': { t: '波束宽度', en: 'Beamwidth', d: '主瓣 −3 dB 宽度，对 N 元半波长 ULA 约为 0.886·2/N 弧度（≈ 50.8°/N）。', tag: '阵列' },
    '阵增益': { t: '阵增益', en: 'Array Gain', d: '阵列输出信噪比相对单元信噪比的提升，理想情况下为 10log10(N)。', tag: '阵列' },
    '时延求和': { t: '时延求和波束形成', en: 'Delay-and-Sum', d: '先按方向补偿各阵元时延再相加，是最直观的宽带波束形成器。', tag: '阵列' },
    'CBF': { t: '常规波束形成', en: 'CBF / Bartlett', d: '固定权向量（等于导向矢量）的波束形成，稳健但分辨率受瑞利限约束。', tag: '阵列' },
    'MVDR': { t: '最小方差无失真响应', en: 'MVDR / Capon', d: '在保证期望方向增益为 1 的前提下最小化输出功率，分辨率远高于 CBF，但对失配敏感。', tag: '阵列' },
    '自适应波束形成': { t: '自适应波束形成', en: 'Adaptive Beamforming', d: '权向量随数据自适应更新以在干扰方向形成零陷，是阵列处理的核心能力。', tag: '阵列' },
    '对角加载': { t: '对角加载', en: 'Diagonal Loading', d: '在协方差矩阵对角线上加一个小量，提高自适应波束形成在有限快拍/失配下的稳健性。', tag: '阵列' },
    '相干信源': { t: '相干信源', en: 'Coherent Sources', d: '多路到达完全相关（如多径镜像）时协方差矩阵秩亏，子空间类算法会"自相消"，必须先解相干。', tag: '阵列' },
    '空间平滑': { t: '空间平滑', en: 'Spatial Smoothing', d: '把大阵拆成重叠子阵再平均协方差，恢复秩以解相干，代价是有效孔径变小。', tag: '阵列' },
    '远场': { t: '远场假设', en: 'Far Field', d: '目标距离远大于阵列孔径时，到达波前可视为平面波，方位只与角度有关。', tag: '阵列' },
    '宽带波束形成': { t: '宽带波束形成', en: 'Wideband Beamforming', d: '相位加权只在窄带成立；宽带需按频率分子带处理或用时延代替相移。', tag: '阵列' },

    /* ---- 雷达 / 声呐 ---- */
    'PRF': { t: '脉冲重复频率', en: 'PRF', d: '每秒发射的脉冲数；上限受距离模糊限制、下限受多普勒模糊限制，是个两头堵的参数。', tag: '雷达声呐' },
    '距离门': { t: '距离门', en: 'Range Bin', d: '一个采样间隔对应的距离单元 ΔR = c/(2fs)（雷达）或 c/(2fs)（声呐换水中的声速）。', tag: '雷达声呐' },
    '距离分辨率': { t: '距离分辨率', en: 'Range Resolution', d: 'ΔR = c/(2B)，只由信号带宽决定，与脉宽无关 —— 这正是脉冲压缩的意义。', tag: '雷达声呐' },
    '速度分辨率': { t: '速度分辨率', en: 'Velocity Resolution', d: 'Δv = λ/(2·N·Tr)，由相参积累的脉冲数（即观测时长）决定。', tag: '雷达声呐' },
    'CPI': { t: '相参处理间隔', en: 'CPI', d: '一组可以认为相位相参的脉冲序列长度，决定了多普勒分辨率与可积累脉冲数。', tag: '雷达声呐' },
    '盲速': { t: '盲速', en: 'Blind Speed', d: '多普勒频移正好等于 PRF 整数倍时，目标被 MTI 对消器当成静止杂波滤掉。', tag: '雷达声呐' },
    '距离模糊': { t: '距离模糊', en: 'Range Ambiguity', d: '回波延迟超过一个脉冲周期时，无法判断它属于哪一次发射，需要用多重 PRF 解模糊。', tag: '雷达声呐' },
    '多普勒模糊': { t: '多普勒模糊', en: 'Doppler Ambiguity', d: '|fd| > PRF/2 时频率折叠，测速出现歧义。', tag: '雷达声呐' },
    '距离走动': { t: '距离走动', en: 'Range Migration', d: '目标在相参积累期间跨过多个距离门，直接多普勒 FFT 会散焦，需要先补偿。', tag: '雷达声呐' },
    '模糊函数': { t: '模糊函数', en: 'Ambiguity Function', d: '信号在时延-多普勒二维上的自相关，是评价雷达波形分辨力与杂波抑制能力的总纲。', tag: '雷达声呐' },
    'PSL': { t: '峰值旁瓣电平', en: 'PSL', d: '旁瓣最高点相对主瓣的分贝数；LFM 未加窗时约 −13.4 dB，加窗可压到 −30 dB 以下。', tag: '雷达声呐' },
    'ISLR': { t: '积分旁瓣比', en: 'ISLR', d: '旁瓣总能量与主瓣能量之比，衡量强目标旁瓣对邻近弱目标的整体压制程度。', tag: '雷达声呐' },
    '泰勒加权': { t: '泰勒加权', en: 'Taylor Weighting', d: '在指定旁瓣电平下使主瓣最窄的加权，是雷达脉冲压缩的经典折中方案。', tag: '雷达声呐' },
    '雷达方程': { t: '雷达方程', en: 'Radar Equation', d: '把发射功率、天线增益、波长、目标 RCS 与作用距离联系起来的功率预算式。', tag: '雷达声呐' },
    'RCS': { t: '雷达散射截面积', en: 'RCS', d: '目标反射能力的等效面积 σ，随姿态、频率剧烈起伏，是隐身技术的着眼点。', tag: '雷达声呐' },
    '声呐方程': { t: '声呐方程', en: 'Sonar Equation', d: '声呐版的功率预算：源级 − 传播损失 − 噪声 + 阵增益 = 检测阈，主动还要算两次传播损失与目标强度。', tag: '雷达声呐' },
    '传播损失': { t: '传播损失', en: 'Transmission Loss', d: '声波在海水中传播的能量衰减，含球面扩展与海水吸收，高频吸收随距离快速增大。', tag: '雷达声呐' },
    '目标强度': { t: '目标强度', en: 'Target Strength', d: '目标回波相对入射声的增强分贝数，与入射方位、频率、目标结构强相关。', tag: '雷达声呐' },
    '环境噪声': { t: '海洋环境噪声', en: 'Ambient Noise', d: '风浪、航运、生物等构成的背景噪声，随海况与频率变化，决定被动声呐的探测上限。', tag: '雷达声呐' },
    '声速剖面': { t: '声速剖面', en: 'Sound Speed Profile', d: '声速随深度的分布，决定声线弯曲，是声呐作用距离预报的核心输入。', tag: '雷达声呐' },
    'LOFAR': { t: 'LOFAR 谱分析', en: 'LOFAR', d: '低频段长时间积累的窄带谱图，用来读螺旋桨轴频与叶片速率线谱。', tag: '雷达声呐' },
    'DEMON': { t: 'DEMON 分析', en: 'DEMON', d: '对宽带噪声做包络解调得到"调制谱"，从中提取叶片速率与轴频，用于舰船识别。', tag: '雷达声呐' },
    '合成孔径': { t: '合成孔径', en: 'Synthetic Aperture', d: '用平台运动把小孔径天线"合成"成大孔径，方位分辨率与距离无关，是成像雷达/声呐的核心。', tag: '雷达声呐' },
    '斑点噪声': { t: '斑点噪声', en: 'Speckle', d: '相干成像中固有的颗粒状乘性噪声，只能用多视平均或空域滤波压制，无法根除。', tag: '雷达声呐' },
    '波束俯仰角': { t: '俯仰角', en: 'Elevation Angle', d: '目标相对阵列平面的垂直角；一维线阵无法分辨俯仰，需要二维阵或利用多径。', tag: '雷达声呐' }
  };

  if (DSP.glossary && DSP.glossary.TERMS) {
    Object.keys(EXTRA_TERMS).forEach(k => {
      if (!DSP.glossary.TERMS[k]) DSP.glossary.TERMS[k] = EXTRA_TERMS[k];
    });
  }

  R.register('toolbox/dict', {
    title: '术语词典',
    lede: '全书术语的"查得到"入口：支持**中文名 / 英文 / 释义**全文检索，也能按分类浏览或按英文首字母定位。点任意词条可看完整释义。',
    tags: ['工具箱', '术语', '检索'],
    render: function (el, params) {
      const G = DSP.glossary;
      const T = G.TERMS;
      const keys = Object.keys(T);

      const state = {
        q: (params && params.q) || '',
        tag: (params && params.tag) || 'all',
        letter: (params && params.letter) || 'all'
      };

      /* ---- 统计 ---- */
      const tags = [];
      keys.forEach(k => { const t = T[k].tag || '未分类'; if (tags.indexOf(t) < 0) tags.push(t); });
      const letters = [];
      keys.forEach(k => {
        const c = (T[k].en || '').trim().charAt(0).toUpperCase();
        if (/[A-Z]/.test(c) && letters.indexOf(c) < 0) letters.push(c);
      });
      letters.sort();

      const statEl = h('span.small.dim');
      const searchBox = textInput({
        label: '检索术语（中文名 / 英文 / 释义）',
        value: state.q,
        placeholder: '例如：混叠、MUSIC、旁瓣、CFAR、群延迟…',
        right: statEl,
        onInput: function (v) { state.q = v; DSP.share.syncParams({ q: v }); render(); }
      });

      function chipRow(list, cur, onPick) {
        return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
          list.map(it => h('span.chip.clickable' + (it.id === cur ? '.blue' : ''), {
            text: it.name,
            onclick: function () { onPick(it.id); }
          })));
      }

      const tagRow = h('div');
      const letterRow = h('div');

      el.appendChild(card('① 检索与筛选', null, [
        searchBox.el,
        h('div.ctrl', {}, [
          h('div.cl', {}, [h('span.nm', { text: '按分类' })]),
          tagRow
        ]),
        h('div.ctrl', {}, [
          h('div.cl', {}, [h('span.nm', { text: '按英文首字母' })]),
          letterRow
        ]),
        h('div.hint', { text: '提示：地址栏会带上检索条件（?q=&tag=&letter=），可以直接把链接发给别人复现同一视图。' })
      ]));

      const listEl = h('div');
      el.appendChild(listEl);

      function filtered() {
        const s = state.q.trim().toLowerCase();
        return keys.filter(k => {
          const it = T[k];
          if (state.tag !== 'all' && (it.tag || '未分类') !== state.tag) return false;
          if (state.letter !== 'all' && (it.en || '').trim().charAt(0).toUpperCase() !== state.letter) return false;
          if (!s) return true;
          return (it.t && it.t.toLowerCase().indexOf(s) >= 0) ||
            (it.en && it.en.toLowerCase().indexOf(s) >= 0) ||
            (it.d && it.d.toLowerCase().indexOf(s) >= 0) ||
            k.toLowerCase().indexOf(s) >= 0;
        }).sort((a, b) => (T[a].t || '').localeCompare(T[b].t || '', 'zh-Hans-CN'));
      }

      function render() {
        // 重画筛选条（高亮随状态变化）
        U.clear(tagRow);
        tagRow.appendChild(chipRow(
          [{ id: 'all', name: '全部 · ' + keys.length }]
            .concat(tags.map(t => ({ id: t, name: t + ' · ' + keys.filter(k => (T[k].tag || '未分类') === t).length }))),
          state.tag,
          function (v) { state.tag = v; DSP.share.syncParams({ tag: v }); render(); }
        ));
        U.clear(letterRow);
        letterRow.appendChild(chipRow(
          [{ id: 'all', name: '全部' }].concat(letters.map(c => ({ id: c, name: c }))),
          state.letter,
          function (v) { state.letter = v; DSP.share.syncParams({ letter: v }); render(); }
        ));

        const hit = filtered();
        statEl.textContent = '共 ' + keys.length + ' 条，当前 ' + hit.length + ' 条';
        U.clear(listEl);
        if (!hit.length) {
          listEl.appendChild(UI.callout('note', '没有匹配词条', '换关键词，或点「全部」清除分类 / 首字母筛选。'));
          return;
        }
        // 按分类分组
        const groups = [];
        hit.forEach(k => {
          const g = T[k].tag || '未分类';
          let box = groups.filter(x => x.g === g)[0];
          if (!box) { box = { g: g, items: [] }; groups.push(box); }
          box.items.push(k);
        });
        groups.forEach(gp => {
          listEl.appendChild(card(gp.g + '（' + gp.items.length + '）', null, [
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
              gp.items.map(k => h('span.chip.clickable', {
                text: T[k].t + (T[k].en ? '　' + T[k].en : ''),
                onclick: function () {
                  DSP.share.syncParams({ term: k });
                  G.openTerm(k);
                }
              })))
          ]));
        });
      }

      render();

      /* 支持 ?term=xxx 直接弹出词条 */
      if (params && params.term && T[params.term]) {
        setTimeout(function () { G.openTerm(params.term); }, 60);
      }

      /* 分类速查表 */
      const summary = tags.map(t => [t, String(keys.filter(k => (T[k].tag || '未分类') === t).length)]);
      el.appendChild(card('② 术语库构成', null, [
        UI.kv(summary.concat([['合计', String(keys.length) + ' 条']])),
        UI.callout('note', '术语从哪来',
          '基础词条由各章正文共用（正文里带虚下划线的词就是术语，鼠标悬停看释义、点击看完整词条）；' +
          '本页另外补充了工程实现、阵列与雷达/声呐方向的词条，让词典不只覆盖"教科书第一章"。')
      ]));

      // 离开本页时把可能残留的词条弹窗关掉（modal 挂在 body 上，路由清空 #view 时不会带走它）
      return function () {
        U.qsa('.modal-mask').forEach(m => m.remove());
      };
    }
  });
})(window);

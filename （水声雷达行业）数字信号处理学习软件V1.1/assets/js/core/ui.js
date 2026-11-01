/* =============================================================
   ui.js —— 通用 UI 组件工厂
   全局命名空间：window.DSP.ui

   提供知识页面与交互实验台复用的组件：
     控件类：slider / select / seg / toggle / number / ctrlPanel
     内容类：math / fold / callout / code / table / kv / flowV / metrics / chips / term
     反馈类：toast / modal / readout
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;
  const h = U.h;

  /* ============================================================
     控件：滑块
     ============================================================ */
  function slider(o) {
    const fmtV = o.fmt || (v => U.fmt(v, o.digits === undefined ? 3 : o.digits));
    const unit = o.unit || '';
    const valEl = h('span.vl', { text: fmtV(o.value) + (unit ? ' ' + unit : '') });
    const input = h('input', {
      type: 'range',
      min: o.min, max: o.max, step: o.step === undefined ? 1 : o.step,
      value: o.value,
      oninput: function () {
        const v = parseFloat(this.value);
        valEl.textContent = fmtV(v) + (unit ? ' ' + unit : '');
        if (o.onInput) o.onInput(v);
      }
    });
    const el = h('div.ctrl', {}, [
      h('div.cl', {}, [
        h('span.nm', { text: o.label }),
        valEl
      ]),
      input,
      o.hint ? h('div.hint', { text: o.hint }) : null
    ]);
    return {
      el: el,
      get: () => parseFloat(input.value),
      set: function (v, silent) {
        input.value = v;
        valEl.textContent = fmtV(v) + (unit ? ' ' + unit : '');
        if (!silent && o.onInput) o.onInput(v);
      },
      enable: function (on) { input.disabled = !on; }
    };
  }

  /* ============================================================
     控件：下拉选择
     ============================================================ */
  function select(o) {
    const sel = h('select', {
      onchange: function () { if (o.onChange) o.onChange(this.value); }
    }, (o.options || []).map(op => h('option', {
      value: op.value, selected: op.value === o.value, text: op.label
    })));
    const el = h('div.ctrl', {}, [
      h('div.cl', {}, [h('span.nm', { text: o.label })]),
      sel,
      o.hint ? h('div.hint', { text: o.hint }) : null
    ]);
    return {
      el: el,
      get: () => sel.value,
      set: function (v, silent) {
        sel.value = v;
        if (!silent && o.onChange) o.onChange(v);
      }
    };
  }

  /* ============================================================
     控件：分段按钮
     ============================================================ */
  function seg(o) {
    let cur = o.value;
    const btns = (o.options || []).map(op => h('button', {
      text: op.label,
      class: op.value === cur ? 'on' : '',
      onclick: function () {
        cur = op.value;
        btns.forEach(b => b.classList.remove('on'));
        this.classList.add('on');
        if (o.onChange) o.onChange(cur);
      }
    }));
    const el = h('div.ctrl', {}, [
      h('div.cl', {}, [h('span.nm', { text: o.label })]),
      h('div.seg', {}, btns),
      o.hint ? h('div.hint', { text: o.hint }) : null
    ]);
    return { el: el, get: () => cur, set: v => { cur = v; } };
  }

  /* ============================================================
     控件：复选
     ============================================================ */
  function toggle(o) {
    const cb = h('input', {
      type: 'checkbox', checked: !!o.value,
      onchange: function () { if (o.onChange) o.onChange(this.checked); }
    });
    const el = h('div.ctrl.inline', {}, [
      cb, h('span', { text: o.label, style: { fontSize: '13px' } })
    ]);
    return { el: el, get: () => cb.checked, set: v => { cb.checked = v; } };
  }

  /* ============================================================
     控件：数字输入
     ============================================================ */
  function number(o) {
    const inp = h('input', {
      type: 'number', value: o.value, min: o.min, max: o.max,
      step: o.step === undefined ? 1 : o.step,
      onchange: function () {
        let v = parseFloat(this.value);
        if (isNaN(v)) v = o.value;
        if (o.min !== undefined) v = Math.max(o.min, v);
        if (o.max !== undefined) v = Math.min(o.max, v);
        this.value = v;
        if (o.onChange) o.onChange(v);
      }
    });
    const el = h('div.ctrl', {}, [
      h('div.cl', {}, [h('span.nm', { text: o.label })]),
      inp,
      o.hint ? h('div.hint', { text: o.hint }) : null
    ]);
    return { el: el, get: () => parseFloat(inp.value), set: v => { inp.value = v; } };
  }

  /** 控件面板容器 */
  function ctrlPanel(title, controls, extra) {
    return h('div.ctrl-panel', {}, [
      title ? h('div.cp-title', { text: title }) : null,
      h('div.ctrl-grid', {}, controls.map(c => c.el || c)),
      extra || null
    ]);
  }

  /* ============================================================
     公式渲染（KaTeX）
     ============================================================ */
  let katexReady = null;

  function ensureKatex() {
    if (katexReady !== null) return katexReady;
    katexReady = !!(global.katex && global.katex.render);
    return katexReady;
  }

  /** 行内公式元素 */
  function mathInline(tex) {
    const el = h('span', { dataset: { tex: tex } });
    renderTex(el, tex, false);
    // 已渲染：避免后续 renderMathIn 二次渲染（KaTeX 会清空容器）
    el.dataset.texDone = '1';
    return el;
  }

  /** 块级公式元素（带可选编号） */
  function mathBlock(tex, tag) {
    const el = h('div.math-block', { dataset: { tex: tex } });
    renderTex(el, tex, true);
    if (tag) el.appendChild(h('span.mb-tag', { text: tag }));
    el.dataset.texDone = '1';
    return el;
  }

  function renderTex(el, tex, display) {
    if (ensureKatex()) {
      try {
        global.katex.render(tex, el, {
          displayMode: !!display,
          throwOnError: false,
          errorColor: '#b91c1c',
          strict: false,
          trust: false,
          output: 'html'
        });
        return el;
      } catch (e) { /* 落到纯文本 */ }
    }
    el.textContent = (display ? '$$' : '$') + tex + (display ? '$$' : '$');
    return el;
  }

  /** 批量渲染容器内所有未渲染公式（供大页面延迟调用） */
  function renderMathIn(root) {
    U.qsa('[data-tex]', root).forEach(el => {
      if (el.dataset.texDone === '1') return;
      renderTex(el, el.dataset.tex, el.classList.contains('math-block'));
      el.dataset.texDone = '1';
    });
  }

  /* ============================================================
     内容组件
     ============================================================ */

  /** 折叠面板（默认用于「展开详细推导」） */
  function fold(summary, content, o) {
    o = o || {};
    const d = h('details.fold' + (o.deriv ? '.deriv' : ''), {
      open: !!o.open
    }, [
      h('summary', { text: summary }),
      h('div.fold-bd', {}, typeof content === 'string' ? h('div', { html: U.md(content) }) : content)
    ]);
    return d;
  }

  /** 提示框 callout：type = note|tip|warn|danger|eng|pit */
  function callout(type, title, body) {
    return h('div.callout.' + type, {}, [
      title ? h('div.co-t', { text: title }) : null,
      typeof body === 'string' ? h('div', { html: U.md(body) }) : body
    ]);
  }

  /** 代码块 + 复制按钮 */
  function code(src, lang, o) {
    o = o || {};
    const pre = h('pre', { text: src });
    if (o.highlight !== false) pre.innerHTML = highlight(src, lang);
    const box = h('div.code', {}, [
      h('div.cd-hd', {}, [
        h('span.lang', { text: lang || 'code' }),
        o.title ? h('span', { text: o.title }) : null,
        h('div.sp', {}, [
          h('button.btn.sm.ghost', {
            text: '复制',
            onclick: function () {
              U.copy(src).then(() => toast('代码已复制'));
              this.textContent = '已复制';
              const b = this;
              setTimeout(() => { b.textContent = '复制'; }, 1200);
            }
          })
        ])
      ]),
      pre
    ]);
    return box;
  }

  /** 极简语法高亮（Python / MATLAB / JS 通用规则）
   *  策略：先把注释与字符串 stash 成占位符，再做关键字/函数/数字替换，
   *  避免正则命中已生成的 HTML 属性（如 class="c-num"）造成标签破坏。 */
  function highlight(src, lang) {
    let s = U.esc(src);
    const isPy = lang === 'python' || lang === 'py';
    const isM = lang === 'matlab';
    const stash = [];
    const keep = (html, cls) => {
      const i = stash.push('<span class="' + cls + '">' + html + '</span>') - 1;
      return '\uE000s' + i.toString(36) + '\uE001';
    };

    // 1) 注释（先于字符串，注释可能包含引号）
    s = s.replace(isPy ? /(#[^\n]*)/g : (isM ? /(%[^\n]*)/g : /(\/\/[^\n]*)/g),
      m => keep(m, 'c-com'));
    // 2) 字符串（esc 后引号为 &quot; / &#39;）
    s = s.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|'[^'\n]*')/g, m => keep(m, 'c-str'));
    // 3) 关键字：必须在"还没有任何 <span class=…> 生成之前"一次性替换，
    //    否则单遍也会命中后续插入的 HTML 属性里的字样（典型：class）。
    const kw = isPy
      ? ['import', 'from', 'def', 'return', 'for', 'in', 'if', 'else', 'elif', 'while', 'as', 'with', 'lambda', 'None', 'True', 'False', 'class', 'try', 'except']
      : (isM ? ['function', 'end', 'for', 'if', 'else', 'elseif', 'while', 'return']
        : ['function', 'const', 'let', 'var', 'return', 'for', 'if', 'else', 'while', 'new', 'class']);
    // 长关键字优先，避免 if 命中 elseif 的前缀
    kw.sort((a, b) => b.length - a.length);
    s = s.replace(new RegExp('\\b(?:' + kw.join('|') + ')\\b', 'g'),
      m => '<span class="c-key">' + m + '</span>');
    // 4) 函数调用
    s = s.replace(/\b([a-zA-Z_]\w*)(\s*\()/g, '<span class="c-fun">$1</span>$2');
    // 5) 数字
    s = s.replace(/\b(\d+\.?\d*(?:e[-+]?\d+)?)\b/gi, '<span class="c-num">$1</span>');
    // 6) 恢复占位
    s = s.replace(/\uE000s([0-9a-z]+)\uE001/g, (_, i) => stash[parseInt(i, 36)]);
    return s;
  }

  /** 表格（cols 支持字符串或 {title,num}；单元格/表头支持 DOM 节点） */
  function table(o) {
    const thead = h('thead', {}, h('tr', {}, o.cols.map(c => {
      const th = h('th', { class: (c && c.num) ? 'num' : '' });
      if (c && c.nodeType) th.appendChild(c);
      else th.textContent = (c && c.title) || c;
      return th;
    })));
    const tbody = h('tbody', {}, (o.rows || []).map(r => h('tr', {}, r.map((cell, i) => {
      if (cell && cell.nodeType) return h('td', {}, cell);
      return h('td', { class: (o.cols[i] && o.cols[i].num) ? 'num' : '', text: cell });
    }))));
    return h('div.tbl-wrap', {}, h('table.tbl' + (o.compact ? '.compact' : ''), {}, [thead, tbody]));
  }

  /** 变量说明（键值对）：pairs = [[符号, 说明], ...]；键也走 md，保证 $f_s$ 之类能渲染 */
  function kv(pairs) {
    return h('div.kv', {}, pairs.map(p => h('div.row', {}, [
      h('div.k', { html: U.md(String(p[0] === undefined ? '' : p[0])) }),
      h('div.v', { html: U.md(String(p[1] === undefined ? '' : p[1])) })
    ])));
  }

  /** 纵向流程图（处理链路） */
  function flowV(steps) {
    const frag = document.createDocumentFragment();
    steps.forEach((s, i) => {
      if (i > 0) frag.appendChild(h('div.fv-link'));
      frag.appendChild(h('div.fv-row', {}, [
        h('div.fv-n', { text: String(i + 1) }),
        h('div.fv-c', {}, [
          h('div.t', { text: s.t }),
          s.d ? h('div.d', { html: U.md(s.d) }) : null
        ])
      ]));
    });
    return h('div.flow-v', {}, frag);
  }

  /** 横向流程图（d 字段支持 $…$ 行内公式占位，由 renderMathIn 统一渲染） */
  function flowH(nodes) {
    const frag = document.createDocumentFragment();
    nodes.forEach((n, i) => {
      if (i > 0) frag.appendChild(h('div.farrow', { text: '→' }));
      const dEl = h('div.fn-d');
      const d = String(n.d || '');
      if (d.indexOf('$') >= 0) {
        dEl.innerHTML = U.esc(d).replace(/\$([^$]+)\$/g, '<span data-tex="$1"></span>');
      } else {
        dEl.textContent = d;
      }
      frag.appendChild(h('div.fnode.' + (n.kind || ''), {}, [
        h('span.fn-t', { text: n.t }),
        dEl
      ]));
    });
    return h('div.flow', {}, frag);
  }

  /** 指标块 */
  function metrics(list) {
    return h('div.metrics', {}, list.map(m => h('div.metric', {}, [
      h('div.m-l', { text: m.label }),
      h('div.m-v', { text: m.value }),
      m.unit ? h('div', {}, h('span.m-u', { text: m.unit })) : null
    ])));
  }

  /** 标签组 */
  function chips(list, cls) {
    return h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
      list.map(t => h('span.chip.' + (cls || 'blue'), { text: t })));
  }

  /** 术语（悬停释义） */
  function term(text, key) {
    return h('span.term', { text: text, dataset: { term: key || text } });
  }

  /* ============================================================
     反馈组件
     ============================================================ */
  let toastHost = null;
  function toast(msg, ms) {
    if (!toastHost) {
      toastHost = U.qs('#toast-host');
      if (!toastHost) {
        toastHost = h('div', { id: 'toast-host' });
        document.body.appendChild(toastHost);
      }
    }
    const t = h('div.toast', { text: msg });
    toastHost.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 220);
    }, ms || 1800);
  }

  /** 模态框 */
  function modal(o) {
    const mask = h('div.modal-mask', {
      onclick: function (e) { if (e.target === mask) close(); }
    });
    const box = h('div.modal', {}, [
      h('div.md-hd', {}, [
        h('span', { text: o.title || '' }),
        h('div.sp', {}, h('button.btn.icon.ghost', {
          text: '✕', onclick: () => close()
        }))
      ]),
      h('div.md-bd', {}, typeof o.body === 'string' ? h('div', { html: o.body }) : o.body),
      o.actions ? h('div.md-ft', {}, o.actions.map(a => h('button.btn' + (a.primary ? '.primary' : ''), {
        text: a.label,
        onclick: function () { if (a.onClick) a.onClick(close); else close(); }
      }))) : null
    ]);
    mask.appendChild(box);
    document.body.appendChild(mask);
    function close() { mask.remove(); }
    return { close: close, el: mask };
  }

  /** 图表读数标签 */
  function readout(plotBox) {
    return h('div.plot-readout', { style: { display: 'none' } });
  }

  /** 图表容器（含标题条与可选操作按钮） */
  function plotBox(o) {
    o = o || {};
    const cv = h('canvas');
    const box = h('div.plot-box', {}, cv);
    const wrap = h('div', {}, [
      o.title ? h('div', {
        style: {
          font: '600 12.5px sans-serif', color: 'var(--text-strong)',
          margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '6px'
        }
      }, [
        h('span', { text: o.title }),
        o.right || null
      ]) : null,
      box,
      o.caption ? h('div.plot-cap', { html: o.caption }) : null
    ]);
    return { el: wrap, canvas: cv, box: box };
  }

  /** 简易按钮 */
  const button = (label, onClick, cls) => h('button.btn' + (cls ? '.' + cls : ''), { text: label, onclick: onClick });

  /** 分区标题 */
  const sectionTitle = (num, title) => h('h2', {}, [
    h('span.num', { text: num }), h('span', { text: title })
  ]);

  DSP.ui = {
    slider, select, seg, toggle, number, ctrlPanel,
    mathInline, mathBlock, renderMathIn, renderTex,
    fold, callout, code, table, kv, flowV, flowH, metrics, chips, term,
    toast, modal, readout, plotBox, button, sectionTitle,
    highlight
  };
})(window);

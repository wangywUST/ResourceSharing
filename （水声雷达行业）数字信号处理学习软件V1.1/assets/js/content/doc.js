/* =============================================================
   doc.js —— 结构化内容渲染器（知识理论库 / 工程案例库统一底座）
   全局命名空间：window.DSP.doc

   设计目的：
     理论章节与工程案例的内容以「块（block）」为单位声明式描述，
     由本渲染器统一转成 DOM，保证六大板块视觉与交互一致，
     同时让后续内容文件只写内容、不写样式。

   典型用法：
     DSP.doc.register('theory/basic/sampling', {
       title: '采样定理与混叠机理',
       lede: '一句话讲清这一节解决什么问题',
       tags: ['基础', '采样'],
       labs: [{ path:'lab/sampling', title:'采样定理交互实验台' }],
       toc: true,
       sections: [
         { id:'why', num:'1', title:'为什么需要采样定理', blocks:[
             { t:'md', md:'正文…支持 $x(t)$ 行内公式与列表' },
             { t:'math', tex:'f_s > 2 f_{max}', tag:'(1)' },
             { t:'callout', kind:'eng', title:'工程提示', md:'…' },
             { t:'fold', summary:'展开：奈奎斯特频率的推导', deriv:true, blocks:[…] },
             { t:'plot', height:240, render: function(el){ … return cleanup; } }
         ]}
       ]
     });
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  /* ============================================================
     富文本单元格：把 **强调**、`代码`、$行内公式$ 转成真实节点
     （表格/标题/摘要这类"纯文本"位也允许内嵌公式与强调）
     ============================================================ */
  function richNode(str) {
    const frag = document.createDocumentFragment();
    const s = String(str === null || str === undefined ? '' : str);
    const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\$([^$]+)\$)/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      if (m[2] !== undefined) frag.appendChild(h('em.k', { text: m[2] }));
      else if (m[4] !== undefined) frag.appendChild(h('code', { text: m[4] }));
      else frag.appendChild(UI.mathInline(m[6]));
      last = re.lastIndex;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    return frag;
  }
  const hasRich = s => /(\*\*[^*]+\*\*|`[^`]+`|\$[^$\n]+\$)/.test(String(s));

  /* ============================================================
     原子渲染：单个 block → DOM
     ============================================================ */
  function renderBlock(parent, b, ctx) {
    if (!b) return;
    let node = null;

    switch (b.t) {
      /* ---------- 文本 ---------- */
      case 'md':
      case 'p':
        node = h('div.prose', { html: U.md(b.md) });
        break;

      case 'h3':
        node = h('h3', { text: b.text, id: b.id || null });
        break;

      case 'h4':
        node = h('h4', { text: b.text, id: b.id || null });
        break;

      /* ---------- 公式 ---------- */
      case 'math':
        node = UI.mathBlock(b.tex, b.tag || null);
        if (b.id) node.id = b.id;
        if (b.caption) node = h('div', {}, [node, h('div.plot-cap', { html: U.md(b.caption) })]);
        break;

      case 'imath':
        node = UI.mathInline(b.tex);
        break;

      /* ---------- 提示框 ----------
         kind: note | tip | warn | danger | eng | pit  */
      case 'callout': {
        const body = b.blocks
          ? fragOf(b.blocks, ctx)
          : h('div', { html: U.md(b.md) });
        const co = UI.callout(b.kind || 'note', '', body);
        const tEl = co.querySelector('.co-t');
        if (b.title) {
          if (tEl) { U.clear(tEl); tEl.appendChild(richNode(b.title)); }
          else co.insertBefore(richNode(b.title), co.firstChild);
        }
        node = co;
        break;
      }

      /* ---------- 折叠面板 ---------- */
      case 'fold': {
        const body = b.blocks
          ? fragOf(b.blocks, ctx)
          : (typeof b.node === 'function' ? b.node(ctx) : h('div', { html: U.md(b.md) }));
        const fd = UI.fold(b.summary || '展开详细内容', body, { deriv: !!b.deriv, open: !!b.open });
        const sm = fd.querySelector('summary');
        if (sm && b.summary && hasRich(b.summary)) {
          // 保留 summary::before 的箭头（伪元素不受子节点影响）
          const arrow = sm.firstChild;
          U.clear(sm);
          sm.appendChild(richNode(b.summary));
        }
        node = fd;
        break;
      }

      /* ---------- 表格 ---------- */
      case 'table': {
        const rows = (b.rows || []).map(r => r.map(cell => {
          if (cell && cell.nodeType) return cell;
          const str = String(cell === undefined || cell === null ? '' : cell);
          return hasRich(str) ? richNode(str) : str;
        }));
        // 表头也可能带 $…$
        const cols = (b.cols || []).map(c => {
          if (c && typeof c === 'object') return c;
          return hasRich(c) ? richNode(c) : c;
        });
        node = h('div', {}, [
          UI.table({ cols: cols, rows: rows, compact: b.compact })
        ]);
        break;
      }

      /* ---------- 变量说明 ---------- */
      case 'kv':
        node = h('div', {}, [
          b.title ? h('div.k', { style: { fontWeight: '650', margin: '0 0 4px', color: 'var(--text-strong)', fontSize: '13px' }, text: b.title }) : null,
          UI.kv(b.pairs || [])
        ]);
        break;

      /* ---------- 代码块 ---------- */
      case 'code':
        node = UI.code(b.src, b.lang || 'python', { title: b.title });
        break;

      /* ---------- 流程图 ---------- */
      case 'flow':
        node = b.v ? UI.flowV(b.items) : UI.flowH(b.items);
        break;

      /* ---------- 标签 ---------- */
      case 'chips':
        node = UI.chips(b.list, b.cls || 'blue');
        break;

      /* ---------- 指标卡 ---------- */
      case 'metrics':
        node = UI.metrics(b.list);
        break;

      /* ---------- 交互图 / 自定义渲染 ---------- */
      case 'plot': {
        const box = UI.plotBox({ title: b.title, caption: b.caption });
        node = box.el;
        // 延迟到插入文档后再绘制（容器宽度才有效）
        ctx.defer.push(function () {
          const clean = b.render(box.canvas, box.el);
          if (typeof clean === 'function') ctx.cleanups.push(clean);
        });
        break;
      }

      /* ---------- 自定义 DOM ---------- */
      case 'widget': {
        const holder = h('div');
        node = holder;
        ctx.defer.push(function () {
          const clean = b.render(holder);
          if (typeof clean === 'function') ctx.cleanups.push(clean);
        });
        break;
      }

      /* ---------- 卡片容器 ---------- */
      case 'card': {
        const bd = h('div.card-bd');
        blocks(bd, b.blocks || [], ctx);
        node = h('div.card', {}, [
          b.title ? h('div.card-hd', {}, [h('span.accent-bar'), h('span', { text: b.title }), b.right || null]) : null,
          bd
        ]);
        break;
      }

      /* ---------- 分栏网格 ---------- */
      case 'grid': {
        const cols = b.cols || 2;
        node = h('div.grid.g' + cols, {}, (b.items || []).map(sub => {
          const cell = h('div');
          blocks(cell, Array.isArray(sub) ? sub : [sub], ctx);
          return cell;
        }));
        break;
      }

      /* ---------- 关联实验台卡片 ---------- */
      case 'lab': {
        const it = b.item || b;
        node = h('a.card.lab-card', { href: '#/' + it.path, style: { display: 'block', textDecoration: 'none', color: 'inherit' } },
          h('div.card-bd', {}, [
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
              h('span.chip.teal', { text: '🎛 交互实验台' }),
              h('span', { style: { fontWeight: '650', color: 'var(--text-strong)' }, text: it.title })
            ]),
            h('div.small.dim', { style: { marginTop: '4px' }, text: it.desc || '动手调参，验证本节结论' })
          ]));
        break;
      }

      /* ---------- 分隔线 ---------- */
      case 'hr':
        node = h('hr.hr');
        break;

      /* ---------- 原生节点 ---------- */
      case 'raw':
        node = b.node;
        break;

      default:
        if (b.md) node = h('div.prose', { html: U.md(b.md) });
        else if (b.node) node = b.node;
        else node = h('div', { text: '[未知块类型: ' + b.t + ']' });
    }

    if (node) parent.appendChild(node);
    return node;
  }

  /** 把一组 block 渲染进容器（返回 DocumentFragment 或容器） */
  function blocks(parent, list, ctx) {
    (list || []).forEach(b => renderBlock(parent, b, ctx));
    return parent;
  }

  function fragOf(list, ctx) {
    const wrap = h('div');
    blocks(wrap, list, ctx);
    return wrap;
  }

  /* ============================================================
     页面装配
     ============================================================ */

  /** 页内滚动到指定小节（只滚不动 URL，避免被 hash 路由误判成换页） */
  function scrollToSec(id) {
    const tgt = id && document.getElementById(String(id).replace(/^#/, ''));
    if (!tgt) return false;
    if (typeof tgt.scrollIntoView === 'function') {
      tgt.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    tgt.classList.add('sec-flash');
    setTimeout(() => tgt.classList.remove('sec-flash'), 1300);
    return true;
  }

  function buildTOC(sections, ctx) {
    const ol = h('ol');
    const links = [];
    sections.forEach((s, i) => {
      if (!s.num) return;
      const id = 'sec-' + (s.id || i);
      const a = h('a', {
        href: '#' + id,
        dataset: { toc: id },
        title: s.title,
        onclick: function (e) {
          // 关键：必须阻止默认行为，否则 hash 变成 #sec-xxx 会被路由当成新页面
          e.preventDefault();
          scrollToSec(id);
          links.forEach(x => x.classList.remove('active'));
          a.classList.add('active');
        }
      }, hasRich(s.title) ? richNode(s.num + '　' + s.title) : h('span', { text: s.num + '　' + s.title }));
      links.push(a);
      ol.appendChild(h('li', {}, a));
    });

    const box = h('div.page-toc.no-print', {}, [
      h('div.toc-title', {}, [
        h('span', { text: '本页目录' }),
        h('span', { class: 'toc-hint', text: '（点击标题跳转，不动网址）' })
      ]),
      ol
    ]);

    // 滚动时高亮当前小节（视觉上明确"我跳到哪儿了"）
    (ctx.defer || []).push(function () {
      const mainEl = U.qs('.main');
      if (!mainEl) return;
      const targets = links
        .map(a => ({ a: a, el: document.getElementById(a.dataset.toc) }))
        .filter(t => t.el);
      if (!targets.length) return;
      const spy = U.throttle ? U.throttle(onScroll, 120) : onScroll;
      function onScroll() {
        const top = mainEl.getBoundingClientRect().top + 80;
        let cur = targets[0];
        targets.forEach(t => { if (t.el.getBoundingClientRect().top <= top) cur = t; });
        targets.forEach(t => t.a.classList.toggle('active', t === cur));
      }
      mainEl.addEventListener('scroll', spy, { passive: true });
      onScroll();
      (ctx.cleanups || []).push(function () { mainEl.removeEventListener('scroll', spy); });
    });

    return box;
  }

  /**
   * 生成 router 视图对象
   * spec: { title, lede, tags, toc, labs:[{path,title,desc}], sections:[{id,num,title,blocks}], refs:[] }
   */
  function page(spec) {
    return {
      title: spec.title,
      lede: spec.lede,
      tags: spec.tags,
      render: function (el, params) {
        const ctx = { defer: [], cleanups: [] };

        // 导语
        if (spec.intro) el.appendChild(h('div.prose', { html: U.md(spec.intro) }));

        // 目录
        if (spec.toc !== false && spec.sections && spec.sections.length > 1) {
          el.appendChild(buildTOC(spec.sections, ctx));
        }

        // 配套实验台入口
        if (spec.labs && spec.labs.length) {
          spec.labs.forEach(l => renderBlock(el, { t: 'lab', item: l }, ctx));
        }

        // 正文小节
        (spec.sections || []).forEach((s, i) => {
          const sid = 'sec-' + (s.id || i);
          const sec = h('div.doc-section', { id: sid, dataset: { anchor: sid } });
          sec.appendChild(h('h2', {}, [
            s.num ? h('span.num', { text: s.num }) : null,
            h('span', { text: s.title })
          ]));
          blocks(sec, s.blocks || [], ctx);
          el.appendChild(sec);
        });

        // 参考资料
        if (spec.refs && spec.refs.length) {
          el.appendChild(h('div.doc-section', { id: 'sec-refs' }, [
            h('h2', {}, [h('span', { text: '参考与延伸阅读' })]),
            h('ol', { style: { fontSize: '13.5px', color: 'var(--text-dim)', paddingLeft: '20px' } },
              spec.refs.map(r => h('li', { style: { margin: '3px 0' }, text: r })))
          ]));
        }

        // 延迟绘制（此时已插入文档流，容器宽度有效）
        ctx.defer.forEach(f => {
          try { f(); } catch (e) { console.error('[doc] plot render error', e); }
        });

        // 支持从别的页面带锚点跳进来：#/xxx?s=sec-id
        const want = params && params.s;
        if (want) setTimeout(() => scrollToSec(String(want).replace(/^#/, '')), 80);

        return function cleanup() {
          ctx.cleanups.forEach(f => { try { f(); } catch (e) {} });
        };
      }
    };
  }

  /** 注册到路由 */
  function register(path, spec) {
    return DSP.router.register(path, page(spec));
  }

  /** 批量注册：{ path: spec } */
  function registerAll(map) {
    Object.keys(map).forEach(p => register(p, map[p]));
    return map;
  }

  DSP.doc = { page, register, registerAll, blocks, renderBlock, buildTOC, fragOf };
})(window);

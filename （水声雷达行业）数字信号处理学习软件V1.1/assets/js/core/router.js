/* =============================================================
   router.js —— Hash 路由与页面渲染调度
   全局命名空间：window.DSP.router

   视图注册契约：
     router.register('lab/dft', {
        title: 'DFT 交互实验',
        lede: '一句话说明',
        tags: ['变换','交互'],
        head: true,            // 是否渲染页面头（默认 true）
        pager: true,           // 是否显示上下页（默认 true）
        notes: true,           // 是否追加内联笔记（默认 true）
        render: function(container, params, ctx) { ...; return cleanupFn; }
     });
   render 返回的函数会在离开页面时调用（用于清理动画定时器）。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;
  const h = U.h;

  const views = {};
  let current = '';
  let cleanup = null;
  let viewEl = null;

  function register(path, view) {
    views[path] = Object.assign({
      head: true, pager: true, notes: true
    }, view);
    return view;
  }

  function registerAll(map) {
    Object.keys(map).forEach(p => register(p, map[p]));
    return map;
  }

  function currentPath() { return current; }

  function go(path, params) {
    location.hash = U.buildHash(path, params);
  }

  /** 占位视图：模块尚未实现（保留给内部调用，页面已不再对未知路由使用它） */
  function placeholder(title, desc) {
    return function (el) {
      buildMissing(el, title || '本页', desc || '本节内容将在后续版本补齐。');
    };
  }
  function card(t, d, path) {
    const inner = h('div.card-bd', {}, [
      h('div', { style: { fontWeight: '650', color: 'var(--text-strong)' } }, t),
      h('div.small.dim', {}, d)
    ]);
    return path
      ? h('a.card', { href: '#/' + path, style: { display: 'block', textDecoration: 'none', color: 'inherit' } }, inner)
      : h('div.card', {}, inner);
  }

  /** 内容尚未实现的内容页（区别于"页面不存在"） */
  function buildMissing(el, title, desc) {
    el.appendChild(DSP.ui.callout('warn', '「' + title + '」内容正在补充中',
      desc + '\n\n这不是报错，只是这一节还没写完。你可以先从下面的入口前往已上线的内容。'));
    el.appendChild(h('div.grid.g3', {}, [
      card('📘 回到所属板块', '看本板块全部已上线章节', parentOf(current) || 'home'),
      card('🎛️ 交互实验台', '10 个可调参数的仿真实验', 'lab'),
      card('🏠 软件首页', '六大板块 + 工具箱总览', 'home')
    ]));
  }

  /**
   * 页面不存在 / 链接失效 的统一兜底页。
   * 旧版的做法是丢一句"该模块正在建设中"，用户完全不知道发生了什么；
   * 这里明确告诉用户：点了什么、可能是什么原因、下一步去哪儿。
   */
  function notFoundPage(path) {
    return function (el) {
      const nav = DSP.nav || {};
      const meta = nav.byPath && nav.byPath[path];
      const parent = parentOf(path);

      el.appendChild(DSP.ui.callout('warn', '没有找到这个页面',
        '你打开的地址是 ' + location.hash + '（路由 `' + path + '`），系统里没有对应的页面。\n\n' +
        '常见原因：① 这是旧版本遗留的链接；② 链接里带上了页内小节的锚点；③ 地址被手动改动过。'));

      // 可能的去处
      const suggestions = [];
      if (meta) suggestions.push(card('📄 ' + meta.title, '导航树里有这一项，正在补充内容', path));
      if (parent) {
        const pn = nav.byPath && nav.byPath[parent];
        suggestions.push(card('📂 ' + (pn ? pn.title : parent), '打开所属板块的总览页', parent));
      }
      suggestions.push(card('🏠 软件首页', '六大板块 + 工具箱总览', 'home'));
      suggestions.push(card('🎛️ 交互实验台', '10 个可调参数的仿真实验', 'lab'));
      el.appendChild(h('div.grid.g3', {}, suggestions));

      el.appendChild(h('hr', { class: 'hr' }));
      el.appendChild(h('h2', {}, [h('span', { text: '或者从这里继续' })]));

      // 最近访问
      let recent = [];
      try { recent = (U.store.get('recent', []) || []).filter(p => p && p !== path).slice(0, 8); } catch (e) {}
      if (recent.length) {
        el.appendChild(h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' } },
          recent.map(p => {
            const it = nav.byPath && nav.byPath[p];
            return h('a.btn.sm', { href: '#/' + p, text: (it ? it.title : p) });
          })));
      }
      el.appendChild(DSP.ui.callout('tip', '下一步建议',
        '按快捷键 Ctrl + K 打开全局搜索，直接搜「采样」「FFT」「MUSIC」「CFAR」等关键词；' +
        '或点顶栏的版本号 ' + (DSP.APP ? DSP.APP.version : '') + ' 查看软件说明。'));
    };
  }

  /** 找路径的父板块路由 */
  function parentOf(path) {
    const p = String(path || '');
    if (!p) return '';
    const i = p.lastIndexOf('/');
    if (i > 0) return p.slice(0, i);
    return '';
  }

  /** 渲染指定路径 */
  function render() {
    const raw = location.hash || '';

    /* ① 非路由哈希（页内锚点 #sec-xxx 之类，多为目录链接或旧链接）：
          不要清空当前页去渲染"建设中"，优先在当前页里滚动；
          滚不到时若已有页面在显示，就保持原页面并把网址悄悄改回正常路由。
          ——这一条正是"点目录就把页面换成建设中"的根因修复。 */
    if (raw && raw !== '#' && raw.indexOf('#/') !== 0 && raw.indexOf('#?') !== 0) {
      const id = decodeURIComponent(raw.slice(1));
      const tgt = document.getElementById(id) || U.qs('[data-anchor="' + id + '"]');
      if (tgt) {
        if (typeof tgt.scrollIntoView === 'function') tgt.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (current) {
        try { history.replaceState(null, '', '#/' + current); } catch (e) {}
        return;
      }
    }

    const parts = U.hashParts();
    const path = parts.path || 'home';
    const params = parts.params || {};
    current = path;

    if (!viewEl) viewEl = U.qs('#view');
    if (!viewEl) return;

    // 清理上一页
    if (typeof cleanup === 'function') {
      try { cleanup(); } catch (e) { console.warn('[router] cleanup error', e); }
    }
    cleanup = null;

    U.clear(viewEl);
    const inner = h('div.main-inner');
    viewEl.appendChild(inner);

    const view = views[path];
    const meta = DSP.nav.byPath[path];

    // 面包屑
    const cr = DSP.nav.crumbs(path);
    if (cr.length) {
      inner.appendChild(h('div.crumbs', {}, cr.map((c, i) => {
        const span = h('span', {}, [
          (i === cr.length - 1)
            ? h('span', { text: c.title, style: { color: 'var(--text-dim)' } })
            : h('a', { href: '#/' + c.id, text: c.title })
        ]);
        return i === 0 ? span : h('span', {}, [h('span.sep', { text: '/' }), span]);
      })));
    }

    // 页面头
    if (view && view.head !== false) {
      const head = h('div.page-head', {}, [
        h('h1', { text: view.title || (meta && meta.title) || path }),
        view.lede ? h('div.lede', { html: U.md(view.lede) }) : null,
        view.tags ? h('div.meta-row', {}, view.tags.map(t => h('span.chip.blue', { text: t }))) : null
      ]);
      // 右上角工具：笔记 / 分享 / 导出
      const tools = h('div', { style: { position: 'absolute', right: '0', top: '0' } });
      inner.appendChild(head);
    }

    const body = h('div.doc-body');
    inner.appendChild(body);

    if (view && typeof view.render === 'function') {
      try {
        const r = view.render(body, params, { path: path, meta: meta });
        if (typeof r === 'function') cleanup = r;
      } catch (e) {
        console.error('[router] render error @' + path, e);
        body.appendChild(DSP.ui.callout('danger', '页面渲染出错', String(e && e.message || e)));
      }
    } else if (view) {
      // 已注册但没有 render —— 视为内容待补充
      buildMissing(body, view.title || path, '这一节的结构已经建好，正文还在写。');
    } else {
      // 完全未知的路由：明确告诉用户"没有这个页面"，并给出去处
      notFoundPage(path)(body);
    }

    // 底部：上下页 + 笔记
    if (!view || view.pager !== false) {
      const sb = DSP.nav.siblings(path);
      if (sb.prev || sb.next) {
        inner.appendChild(h('div.pager.no-print', {}, [
          sb.prev ? h('a', { href: '#/' + sb.prev.path }, [
            h('span.dir', { text: '← 上一节' }),
            h('span.tt', { text: sb.prev.title })
          ]) : h('span', { style: { flex: '1' } }),
          sb.next ? h('a.next', { href: '#/' + sb.next.path }, [
            h('span.dir', { text: '下一节 →' }),
            h('span.tt', { text: sb.next.title })
          ]) : h('span', { style: { flex: '1' } })
        ]));
      }
    }
    if (!view || view.notes !== false) {
      inner.appendChild(DSP.notes.noteBlock(path, (view && view.title) || (meta && meta.title) || path));
    }

    // 后处理：公式渲染 + 术语标注
    DSP.ui.renderMathIn(inner);
    if (DSP.glossary) DSP.glossary.annotate(inner);
    DSP.notes.setPath(path);
    DSP.notes.refreshUI();

    // 标题（统一走 DSP.APP，改名只改 appinfo.js）
    const APP = DSP.APP || { name: '数字信号处理知识学习实践系统', version: '', docTitle: null };
    document.title = APP.docTitle
      ? APP.docTitle(path === 'home' ? null : ((view && view.title) || (meta && meta.title) || path))
      : (path === 'home' ? APP.name : ((view && view.title) || (meta && meta.title) || path) + ' · ' + APP.name);

    // 侧栏高亮
    DSP.nav.highlight(path);

    // 滚动到顶（或锚点）
    const main = U.qs('.main');
    if (main) main.scrollTop = 0;
    if (parts.params && parts.params.s) {
      const tgt = U.qs('[data-anchor="' + parts.params.s + '"]', inner);
      if (tgt) setTimeout(() => tgt.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }

    // 记录最近访问
    try {
      const recent = U.store.get('recent', []);
      const i = recent.indexOf(path);
      if (i >= 0) recent.splice(i, 1);
      recent.unshift(path);
      U.store.set('recent', recent.slice(0, 20));
    } catch (e) {}
  }

  function start() {
    window.addEventListener('hashchange', U.debounce(render, 30));
    if (!location.hash || location.hash === '#' || location.hash === '#/') {
      location.hash = '#/home';
    }
    render();
  }

  DSP.router = {
    views: views, register: register, registerAll: registerAll,
    start: start, render: render, go: go, currentPath: currentPath,
    placeholder: placeholder
  };
})(window);

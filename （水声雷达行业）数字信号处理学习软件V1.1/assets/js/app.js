/* =============================================================
   app.js —— 应用启动与全局交互
   · 主题初始化与切换（深浅色）
   · 侧边栏渲染、窄屏抽屉
   · 顶栏全局搜索（知识点 / 术语）
   · 快捷键、笔记、分享、帮助
   · 路由启动
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  /* ============================================================
     1. 主题
     ============================================================ */
  const APP = DSP.APP || { name: '数字信号处理知识学习实践系统', version: 'V1.1' };

  function initTheme() {
    const saved = U.store.get('theme', null);
    const savedVer = U.store.get('appVer', null);
    let theme = saved;
    // ① 从未设置过 → 默认深色（软件打开即为深色）
    // ② 版本号变化时 → 重新以深色为默认，避免沿用旧版本的浅色
    if (!theme || savedVer !== APP.version) theme = 'dark';
    if (savedVer !== APP.version) U.store.set('appVer', APP.version);
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    U.store.set('theme', theme);
    U.clearColorCache();
    const btn = U.qs('#btn-theme');
    if (btn) {
      const dark = theme === 'dark';
      // 图标 + 中文说明，说明文字写"点了会变成什么"，避免只给一个图标看不懂
      const ico = btn.querySelector('.th-ico');
      const tx = btn.querySelector('.th-tx');
      if (ico) ico.textContent = dark ? '☀' : '☾';
      if (tx) tx.textContent = dark ? '切到浅色' : '切到深色';
      if (!ico || !tx) btn.textContent = dark ? '☀ 切到浅色' : '☾ 切到深色';
      btn.title = dark
        ? '当前：深色模式，点击切换为浅色模式（快捷键 D）'
        : '当前：浅色模式，点击切换为深色模式（快捷键 D）';
      btn.setAttribute('aria-label', btn.title);
    }
    // 主题切换后重绘全部图表（颜色取自 CSS 变量）
    if (DSP.plot) {
      setTimeout(() => DSP.plot.redrawAll(), 30);
    }
  }

  function toggleTheme() {
    const cur = document.documentElement.dataset.theme || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    UI.toast(next === 'dark' ? '已切换为深色模式' : '已切换为浅色模式');
  }

  /* ============================================================
     页内锚点跳转（不改变 URL hash，避免被路由误判成页面）
     目录、正文里的 <a href="#sec-xxx"> 都走这里
     ============================================================ */
  function scrollToAnchor(hash) {
    const id = String(hash || '').replace(/^#/, '');
    if (!id) return false;
    const tgt = document.getElementById(id)
      || document.querySelector('[data-anchor="' + id + '"]')
      || document.querySelector('[data-anchor="' + decodeURIComponent(id) + '"]');
    if (!tgt) return false;
    if (typeof tgt.scrollIntoView === 'function') {
      tgt.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    tgt.classList && tgt.classList.add('sec-flash');
    setTimeout(() => tgt.classList && tgt.classList.remove('sec-flash'), 1200);
    return true;
  }

  function initAnchors() {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      const a = e.target && e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      const href = a.getAttribute('href');
      // 只拦截非路由锚点（#sec-xxx 之类），#/xxx 是正常路由
      if (!href || href.indexOf('#/') === 0 || href === '#' || href.indexOf('#?') === 0) return;
      if (scrollToAnchor(href)) e.preventDefault();
    });
  }

  /* ============================================================
     2. 侧边栏
     ============================================================ */
  function initSidebar() {
    const sb = U.qs('#sidebar');
    if (sb) DSP.nav.renderSidebar(sb);
    const toggle = U.qs('#btn-sidebar');
    if (toggle) {
      toggle.addEventListener('click', function () {
        document.getElementById('app').classList.toggle('sidebar-open');
      });
    }
    // 窄屏点击页面内容后收起
    U.on('.main', 'click', function () {
      if (window.innerWidth <= 1080) document.getElementById('app').classList.remove('sidebar-open');
    });
  }

  /* ============================================================
     3. 全局搜索
     ============================================================ */
  let searchIn = null, searchRes = null, selIdx = -1, curList = [];

  function initSearch() {
    searchIn = U.qs('#search-in');
    searchRes = U.qs('#search-res');
    if (!searchIn) return;

    const run = U.debounce(function () {
      const q = searchIn.value.trim();
      curList = [];
      selIdx = -1;
      U.clear(searchRes);
      if (!q) { searchRes.classList.remove('open'); return; }
      curList = DSP.nav.search(q, 24);
      if (!curList.length) {
        searchRes.appendChild(h('div.sr-empty', { text: '没有找到相关内容，试试「采样」「FFT」「MUSIC」「CFAR」' }));
      } else {
        let lastGroup = '';
        curList.forEach((it, i) => {
          if (it.group && it.group !== lastGroup) {
            lastGroup = it.group;
            searchRes.appendChild(h('div.sr-group', { text: it.group }));
          }
          searchRes.appendChild(h('a.sr-item', {
            href: '#/' + it.path, dataset: { i: i },
            onclick: () => setTimeout(closeSearch, 60)
          }, [
            h('span', { text: it.title }),
            h('span.sr-path', { text: '#/' + it.path })
          ]));
        });
      }
      searchRes.classList.add('open');
      const hint = U.qs('.kbd-hint');
      if (hint) hint.classList.add('hidden');
    }, 140);

    searchIn.addEventListener('input', run);
    searchIn.addEventListener('focus', function () { if (searchIn.value.trim()) run(); });
    searchIn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = U.qsa('.sr-item', searchRes);
        if (!items.length) return;
        selIdx += (e.key === 'ArrowDown' ? 1 : -1);
        selIdx = Math.max(0, Math.min(items.length - 1, selIdx));
        items.forEach((it, i) => it.classList.toggle('sel', i === selIdx));
        items[selIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        const items = U.qsa('.sr-item', searchRes);
        if (items.length) {
          e.preventDefault();
          const target = items[selIdx >= 0 ? selIdx : 0];
          location.hash = target.getAttribute('href');
          closeSearch();
        }
      } else if (e.key === 'Escape') {
        closeSearch();
        searchIn.blur();
      }
    });

    document.addEventListener('click', function (e) {
      if (searchRes && !searchRes.contains(e.target) && e.target !== searchIn) closeSearch();
    });
  }

  function closeSearch() {
    if (!searchRes) return;
    searchRes.classList.remove('open');
    const hint = U.qs('.kbd-hint');
    if (hint) hint.classList.remove('hidden');
  }

  function focusSearch() {
    if (searchIn) { searchIn.focus(); searchIn.select(); }
  }

  /* ============================================================
     4. 顶栏按钮
     ============================================================ */
  function initTools() {
    const btnTheme = U.qs('#btn-theme');
    if (btnTheme) btnTheme.addEventListener('click', toggleTheme);

    const btnNotes = U.qs('#btn-notes');
    if (btnNotes) btnNotes.addEventListener('click', () => DSP.notes.toggle());

    const btnShare = U.qs('#btn-share');
    if (btnShare) btnShare.addEventListener('click', () => DSP.share.menu(btnShare));

    const btnHelp = U.qs('#btn-help');
    if (btnHelp) btnHelp.addEventListener('click', showHelp);

    // 点版本号 → 关于本软件
    const ver = U.qs('#app-ver');
    if (ver) {
      ver.style.cursor = 'pointer';
      ver.title = '关于本软件 ' + APP.version;
      ver.addEventListener('click', showAbout);
    }
    // 顶栏版本号与口号文案统一取自 APP（改名只改 appinfo.js）
    const slogan = U.qs('#app-slogan');
    if (slogan && APP.sloganParen) slogan.textContent = APP.sloganParen;
    const tName = U.qs('#app-ver') && U.qs('.topbar .brand .title .t-name');
    if (tName && APP.name) tName.textContent = APP.name;
    if (ver && APP.version) ver.textContent = APP.version;
  }

  /** 关于本软件（点顶栏版本号打开） */
  function showAbout() {
    UI.modal({
      title: APP.name + ' ' + APP.version,
      body: h('div', {}, [
        h('div.prose', { html: U.md('**' + APP.sloganParen + '**') }),
        h('hr', { class: 'hr' }),
        h('div', { style: { fontWeight: '650', marginBottom: '6px' } }, '关注渠道'),
        UI.kv((APP.contact || []).map(c => [c[0], c[1]])),
        h('hr', { class: 'hr' }),
        UI.callout('tip', '怎么用最省力',
          '读理论页 → 立刻点页内的「交互实验台」入口拖滑块 → 回自测题检验。\n\n顶栏右侧按钮可切换深色 / 浅色模式（快捷键 D）、打开笔记（N）、生成分享链接。')
      ])
    });
  }

  function showHelp() {
    UI.modal({
      title: '使用帮助与快捷键（' + APP.name + ' ' + APP.version + '）',
      body: h('div', {}, [
        UI.kv([
          ['Ctrl / ⌘ + K', '聚焦全局搜索（搜知识点、术语）'],
          ['N', '打开 / 关闭笔记抽屉'],
          ['D', '切换深色 / 浅色模式'],
          ['Esc', '关闭搜索或弹窗'],
          ['/', '（搜索框聚焦时）快速定位']
        ]),
        h('hr', { class: 'hr' }),
        UI.callout('note', '关于笔记',
          '笔记保存在本机浏览器 localStorage，换设备不同步。建议定期用「笔记 → 导出全部」备份为 Markdown。'),
        UI.callout('tip', '关于分享',
          '顶栏「🔗 分享」会生成带当前交互参数的链接，同学打开即可复现你调好的实验状态；也可把整页导出为 Markdown 讲义。'),
        UI.callout('eng', '关于离线',
          '本软件为纯静态页面，双击 index.html 即可运行，无需服务器与网络。公式引擎 KaTeX 与图表库均已本地化。'),
        UI.callout('note', '关于本软件',
          APP.name + ' ' + APP.version + '\n\n' + APP.sloganParen)
      ])
    });
  }

  /* ============================================================
     5. 快捷键
     ============================================================ */
  function initKeys() {
    document.addEventListener('keydown', function (e) {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); focusSearch(); return;
      }
      if (typing) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); DSP.notes.toggle(); }
      else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); toggleTheme(); }
      else if (e.key === '/' ) { e.preventDefault(); focusSearch(); }
    });
  }

  /* ============================================================
     6. 窗口尺寸变化 → 重绘图表
     ============================================================ */
  function initResize() {
    const redraw = U.debounce(function () {
      if (DSP.plot) DSP.plot.redrawAll();
    }, 180);
    window.addEventListener('resize', redraw);
    // 侧栏展开/收起也会改变主区宽度
    const mo = new MutationObserver(redraw);
    const app = U.qs('#app');
    if (app) mo.observe(app, { attributes: true, attributeFilter: ['class'] });
  }

  /* ============================================================
     7. 启动
     ============================================================ */
  function boot() {
    initTheme();       // 默认深色
    initSidebar();
    initSearch();
    initTools();
    initKeys();
    initAnchors();     // 页内锚点不再破坏路由
    initResize();
    DSP.glossary.bind();
    DSP.router.start();
    DSP.notes.refreshUI();
    console.log('%c' + APP.name + ' ' + APP.version,
      'font-weight:bold;color:#38bdf8',
      '· 框架已加载 · 页面数：' + DSP.nav.flat.length + ' · ' + APP.sloganParen);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);

/*
 * 水声行业公式应用大全 - 交互、计算、图表与本地存储
 *
 * 运行方式：直接双击 index.html。未使用模块、fetch、后端或在线 CDN，
 * 因此 file:// 环境也能正常运行。
 */
(function () {
  "use strict";

  const DATA = window.HYDRO_DATA;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const STORAGE_PREFIX = "hydro-formula-tool.v1.";
  const CHART_COLORS = ["#007d94", "#d87400", "#7654c5", "#238b57", "#c14444", "#008b8b", "#b96a9d", "#7a6b2b"];
  const rad = degrees => degrees * Math.PI / 180;
  const deg = radians => radians * 180 / Math.PI;

  const state = {
    view: "knowledge",
    selectedFormulaId: "mackenzie-sound-speed",
    category: "all",
    search: "",
    favoritesOnly: false,
    favorites: new Set(loadJSON("favorites", [])),
    history: loadJSON("history", []),
    notes: loadJSON("notes", []),
    theme: loadJSON("theme", "light"),
    chartType: "svp",
    chartMode: "cartesian",
    currentChart: null,
    chartParams: {
      svp: { maxDepth: 2000, surfaceT: 24, bottomT: 4, surfaceS: 34, bottomS: 35 },
      absorption: { T: 10, S: 35, D: 100, pH: 8 },
      tl: { alpha: 0.8, n1: 20, n2: 15 },
      ts: { ts0: 20, ka: 18 },
      beam: { N: 16, spacing: 0.5, steer: 0, floor: -40 },
      noise: { seaState: 3, shipping: 0.5 },
      reverb: { SL: 210, alpha: 0.8, Ss: -30, pulse: 0.02 }
    }
  };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (error) {
      toast("浏览器阻止了本地存储，本次数据仅保留在内存中。", "warning");
      return false;
    }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function formatNumber(value, digits) {
    if (value === Infinity) return "∞";
    if (value === -Infinity) return "−∞";
    if (!Number.isFinite(value)) return "—";
    if (value === 0) return "0";
    const abs = Math.abs(value);
    const sig = digits || 6;
    if (abs >= 1e5 || abs < 1e-4) return value.toExponential(Math.max(2, sig - 1));
    return Number(value.toPrecision(sig)).toString();
  }

  function typeset(root) {
    if (!window.katex) return;
    $$("[data-latex]", root || document).forEach(node => {
      const latex = node.getAttribute("data-latex") || "";
      try {
        window.katex.render(latex, node, { throwOnError: false, displayMode: node.dataset.display !== "inline", strict: "ignore" });
      } catch (error) {
        node.textContent = latex;
      }
    });
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function setAlerts(messages, type) {
    const area = $("#alertArea");
    area.innerHTML = (messages || []).map(msg => `<div class="alert ${type || "warning"}"><strong>${type === "danger" ? "错误" : "提示"}</strong><span>${escapeHTML(msg)}</span></div>`).join("");
  }

  function categoryById(id) {
    return DATA.categories.find(item => item.id === id);
  }

  function formulaById(id) {
    return DATA.formulas.find(item => item.id === id);
  }

  function init() {
    document.body.dataset.theme = state.theme;
    bindGlobalEvents();
    renderCategoryTree();
    updateCounters();
    navigate(location.hash.replace(/^#\/?/, "") || "knowledge", false);
  }

  function bindGlobalEvents() {
    $$(".nav-item").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.view)));
    $("#themeBtn").addEventListener("click", toggleTheme);
    $("#runSelfTestBtn").addEventListener("click", runSelfTest);
    $("#collapseAllBtn").addEventListener("click", () => {
      $$(".category-formulas").forEach(el => { el.hidden = true; });
      $$(".category-btn").forEach(el => el.setAttribute("aria-expanded", "false"));
    });
    $("#favoritesFilterBtn").addEventListener("click", () => {
      state.favoritesOnly = !state.favoritesOnly;
      state.category = "all";
      navigate("knowledge");
    });
    $("#historyViewBtn").addEventListener("click", renderHistoryView);
    $("#globalSearch").addEventListener("input", event => {
      state.search = event.target.value.trim();
      if (state.view !== "knowledge") navigate("knowledge", false);
      else renderCurrentView();
    });
    $("#mobileNavBtn").addEventListener("click", () => openDrawer("left"));
    $("#closeRightPanelBtn").addEventListener("click", closeDrawers);
    $("#mobileScrim").addEventListener("click", closeDrawers);
    window.addEventListener("hashchange", () => navigate(location.hash.replace(/^#\/?/, "") || "knowledge", false));
    document.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        $("#globalSearch").focus();
      }
      if (event.key === "Escape") closeDrawers();
    });
  }

  function toggleTheme() {
    state.theme = state.theme === "light" ? "dark" : "light";
    document.body.dataset.theme = state.theme;
    $("#themeBtn").textContent = state.theme === "light" ? "☾" : "☀";
    saveJSON("theme", state.theme);
    if (state.currentChart) redrawCurrentChart();
  }

  function openDrawer(side) {
    const panel = side === "left" ? $("#leftSidebar") : $("#rightPanel");
    panel.classList.add("open");
    $("#mobileScrim").hidden = false;
  }

  function closeDrawers() {
    $("#leftSidebar").classList.remove("open");
    $("#rightPanel").classList.remove("open");
    $("#mobileScrim").hidden = true;
  }

  function navigate(target, pushHash) {
    const knownViews = ["knowledge", "calculator", "converter", "charts", "constants", "glossary", "notes", "help"];
    if (target.startsWith("formula/")) {
      state.selectedFormulaId = target.split("/")[1] || state.selectedFormulaId;
      state.view = "calculator";
    } else if (knownViews.includes(target)) {
      state.view = target;
    } else {
      state.view = "knowledge";
    }
    if (pushHash !== false) location.hash = target;
    $$(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.view === state.view));
    setAlerts([]);
    renderCurrentView();
    closeDrawers();
    $("#mainContent").focus({ preventScroll: true });
  }

  function renderCurrentView() {
    switch (state.view) {
      case "knowledge": renderKnowledge(); break;
      case "calculator": renderFormulaDetail(); break;
      case "converter": renderConverter(); break;
      case "charts": renderCharts(); break;
      case "constants": renderConstants(); break;
      case "glossary": renderGlossary(); break;
      case "notes": renderNotes(); break;
      case "help": renderHelp(); break;
      default: renderKnowledge();
    }
  }

  function setViewHeader(title, description, crumbs, actionsHTML) {
    $("#viewHeader").innerHTML = `
      <div class="breadcrumbs">${(crumbs || ["首页"]).map((item, index) => `${index ? "<span>›</span>" : ""}<span>${escapeHTML(item)}</span>`).join("")}</div>
      <div class="view-title-row">
        <div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(description || "")}</p></div>
        <div class="header-actions">${actionsHTML || ""}</div>
      </div>`;
  }

  function renderCategoryTree() {
    const tree = $("#categoryTree");
    tree.innerHTML = DATA.categories.map(category => {
      const formulas = DATA.formulas.filter(item => item.category === category.id);
      return `<div class="category-group">
        <button class="category-btn" type="button" data-category="${category.id}" aria-expanded="false">
          <span class="category-label"><span>${category.icon}</span><span>${escapeHTML(category.name)}</span></span>
          <span class="category-count">${formulas.length}</span>
        </button>
        <div class="category-formulas" hidden>
          ${formulas.map(item => `<button class="formula-tree-btn" type="button" data-formula-id="${item.id}">${escapeHTML(item.name)}</button>`).join("")}
        </div>
      </div>`;
    }).join("");

    $$(".category-btn", tree).forEach(btn => btn.addEventListener("click", () => {
      const list = btn.nextElementSibling;
      const willOpen = list.hidden;
      list.hidden = !willOpen;
      btn.setAttribute("aria-expanded", String(willOpen));
      state.category = btn.dataset.category;
      state.favoritesOnly = false;
      if (state.view === "knowledge") renderKnowledge();
    }));
    $$(".formula-tree-btn", tree).forEach(btn => btn.addEventListener("click", () => {
      state.selectedFormulaId = btn.dataset.formulaId;
      navigate(`formula/${state.selectedFormulaId}`);
    }));
  }

  function updateCounters() {
    $("#favoriteCount").textContent = state.favorites.size;
    $("#historyCount").textContent = state.history.length;
  }

  function formulaSearchText(formula) {
    return [formula.name, formula.en, formula.definition, formula.latex, formula.category, ...(formula.tags || []), ...(formula.variables || []).flatMap(item => [item.name, item.symbol, item.baseUnit])].join(" ").toLowerCase();
  }

  function renderKnowledge() {
    const category = categoryById(state.category);
    const query = state.search.toLowerCase();
    let formulas = DATA.formulas.filter(item => (state.category === "all" || item.category === state.category));
    if (state.favoritesOnly) formulas = formulas.filter(item => state.favorites.has(item.id));
    if (query) formulas = formulas.filter(item => formulaSearchText(item).includes(query));

    const title = state.favoritesOnly ? "收藏公式" : (category ? category.name : "水声知识与公式库");
    const description = query ? `正在检索“${state.search}”，共找到 ${formulas.length} 条结果。` : (category ? category.description : `覆盖 ${DATA.categories.length} 个专业方向，首版内置 ${DATA.formulas.length} 条可计算公式。`);
    setViewHeader(title, description, ["知识库", category ? category.name : "全部"], `<button id="clearFilterBtn" class="secondary-btn" type="button">清除筛选</button>`);
    $("#clearFilterBtn").addEventListener("click", () => {
      state.category = "all"; state.favoritesOnly = false; state.search = ""; $("#globalSearch").value = ""; renderKnowledge();
    });

    $("#contentArea").innerHTML = formulas.length ? `<div class="card-grid">${formulas.map(formulaCardHTML).join("")}</div>` : `<div class="empty-state">没有匹配的公式。可尝试“TL”“吸收”“声速”“波束”等关键词。</div>`;
    bindFormulaCards();
    typeset($("#contentArea"));
    renderContextPanel("knowledge");
  }

  function formulaCardHTML(formula) {
    const category = categoryById(formula.category);
    return `<article class="formula-card" data-id="${formula.id}">
      <button class="favorite-btn ${state.favorites.has(formula.id) ? "active" : ""}" type="button" data-favorite="${formula.id}" aria-label="收藏 ${escapeHTML(formula.name)}">${state.favorites.has(formula.id) ? "★" : "☆"}</button>
      <span class="type-badge ${formula.type}">${formula.type === "theory" ? "标准理论" : "工程经验"}</span>
      <h3>${escapeHTML(formula.name)}</h3>
      <div class="english">${escapeHTML(formula.en)} · ${escapeHTML(category ? category.name : "")}</div>
      <p class="definition">${escapeHTML(formula.definition)}</p>
      <div class="formula-preview" data-latex="${escapeHTML(formula.latex)}"></div>
      <div class="formula-card-footer">
        <div class="tags">${(formula.tags || []).slice(0, 3).map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}</div>
        <button class="text-btn open-formula" type="button" data-open="${formula.id}">查看与计算 →</button>
      </div>
    </article>`;
  }

  function bindFormulaCards() {
    $$('[data-favorite]').forEach(btn => btn.addEventListener("click", event => {
      event.stopPropagation();
      toggleFavorite(btn.dataset.favorite);
    }));
    $$('[data-open]').forEach(btn => btn.addEventListener("click", () => {
      state.selectedFormulaId = btn.dataset.open;
      navigate(`formula/${state.selectedFormulaId}`);
    }));
  }

  function toggleFavorite(id) {
    if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
    saveJSON("favorites", Array.from(state.favorites));
    updateCounters();
    renderCurrentView();
    toast(state.favorites.has(id) ? "已收藏公式" : "已取消收藏");
  }

  function renderFormulaDetail() {
    const formula = formulaById(state.selectedFormulaId) || DATA.formulas[0];
    state.selectedFormulaId = formula.id;
    const category = categoryById(formula.category);
    setViewHeader(formula.name, formula.definition, ["公式计算", category.name, formula.name], `
      <button id="favoriteDetailBtn" class="secondary-btn" type="button">${state.favorites.has(formula.id) ? "★ 已收藏" : "☆ 收藏"}</button>
      <button id="openCalcPanelBtn" class="primary-btn" type="button">输入参数</button>`);

    $("#contentArea").innerHTML = `<article class="formula-detail">
      <section class="detail-hero">
        <span class="eyebrow">${formula.type === "theory" ? "标准理论公式" : "工程经验公式"}</span>
        <h2>${escapeHTML(formula.name)}</h2>
        <p>${escapeHTML(formula.en)}</p>
        <div class="hero-formula" data-latex="${escapeHTML(formula.latex)}"></div>
      </section>
      <div class="detail-grid">
        <section class="info-card">
          <div class="card-title"><h2>变量与单位</h2><button id="copyLatexBtn" class="secondary-btn" type="button">复制 LaTeX</button></div>
          <div class="table-wrap"><table><thead><tr><th>符号</th><th>物理量</th><th>基准单位</th><th>建议范围</th><th>说明</th></tr></thead>
          <tbody>${formula.variables.map(item => `<tr><td data-latex="${escapeHTML(item.symbol)}" data-display="inline"></td><td>${escapeHTML(item.name)}</td><td>${escapeHTML(item.baseUnit)}</td><td>${formatNumber(item.min, 4)} – ${formatNumber(item.max, 4)}</td><td>${escapeHTML(item.help || "—")}</td></tr>`).join("")}</tbody></table></div>
        </section>
        <section class="info-card">
          <div class="card-title"><h2>适用前提</h2></div>
          <ul class="info-list">${formula.conditions.map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul>
        </section>
      </div>
      <div class="detail-grid">
        <section class="info-card">
          <div class="card-title"><h2>工程注意事项</h2></div>
          <ul class="info-list">${formula.notes.map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul>
        </section>
        <section class="info-card">
          <div class="card-title"><h2>参考来源</h2></div>
          <ol class="reference-list">${formula.refs.map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ol>
        </section>
      </div>
      <section id="scanMount"></section>
    </article>`;

    $("#favoriteDetailBtn").addEventListener("click", () => toggleFavorite(formula.id));
    $("#copyLatexBtn").addEventListener("click", () => copyText(formula.latex, "LaTeX 已复制"));
    $("#openCalcPanelBtn").addEventListener("click", () => openDrawer("right"));
    typeset($("#contentArea"));
    renderCalculatorPanel(formula);
  }

  function renderCalculatorPanel(formula) {
    $("#rightPanelTitle").textContent = "公式计算器";
    $("#rightPanelBody").innerHTML = `
      <section class="panel-card">
        <h3>${escapeHTML(formula.name)}</h3>
        <div id="formulaInputs">${formula.variables.map(inputHTML).join("")}</div>
        <div class="button-row">
          <button id="calculateBtn" class="primary-btn" type="button">计算并记录</button>
          <button id="resetCalcBtn" class="secondary-btn" type="button">重置</button>
        </div>
      </section>
      <section class="panel-card">
        <h3>计算结果</h3>
        <div id="calcResult" class="result-box"><span class="result-label">${escapeHTML(formula.output.name)}</span><strong class="result-value">—</strong><span class="result-unit">${escapeHTML(formula.output.unit)}</span></div>
      </section>
      <section class="panel-card">
        <h3>一维参数扫描</h3>
        <div class="form-group"><label for="sweepVar">扫描变量</label><select id="sweepVar" class="full-select">${formula.variables.map(item => `<option value="${item.key}">${escapeHTML(item.name)} (${escapeHTML(item.symbol)})</option>`).join("")}</select></div>
        <div class="input-row"><input id="sweepFrom" type="number" value="${formula.variables[0].min}" aria-label="扫描起点"><input id="sweepTo" type="number" value="${formula.variables[0].max}" aria-label="扫描终点"></div>
        <div class="form-group"><label for="sweepPoints">采样点数</label><input id="sweepPoints" type="number" min="10" max="500" value="80"></div>
        <button id="runSweepBtn" class="secondary-btn" type="button">生成扫描曲线</button>
      </section>
      <section class="panel-card">
        <div class="mini-warning"><strong>dB 提醒：</strong>先核对参考基准、谱级/带宽级和单程/双程，再代入声呐方程。</div>
      </section>`;

    bindCalcInputs(formula);
    $("#calculateBtn").addEventListener("click", () => calculateFormula(formula, true));
    $("#resetCalcBtn").addEventListener("click", () => {
      formula.variables.forEach(variable => {
        const input = $(`[data-var="${variable.key}"]`);
        const select = $(`[data-unit-for="${variable.key}"]`);
        input.value = variable.default;
        if (select) select.selectedIndex = 0;
      });
      calculateFormula(formula, false);
    });
    $("#sweepVar").addEventListener("change", event => {
      const variable = formula.variables.find(item => item.key === event.target.value);
      $("#sweepFrom").value = variable.min;
      $("#sweepTo").value = variable.max;
    });
    $("#runSweepBtn").addEventListener("click", () => runSweep(formula));
    calculateFormula(formula, false);
  }

  function inputHTML(variable) {
    return `<div class="form-group">
      <label for="var-${variable.key}"><span>${escapeHTML(variable.name)}</span><span data-latex="${escapeHTML(variable.symbol)}" data-display="inline"></span></label>
      <div class="input-row">
        <input id="var-${variable.key}" data-var="${variable.key}" type="number" value="${variable.default}" min="${variable.min}" max="${variable.max}" step="${variable.step}" inputmode="decimal">
        <select data-unit-for="${variable.key}" aria-label="${escapeHTML(variable.name)}单位">${variable.units.map((item, index) => `<option value="${index}">${escapeHTML(item.label)}</option>`).join("")}</select>
      </div>
      <small>${escapeHTML(variable.help || `建议范围 ${formatNumber(variable.min, 4)}–${formatNumber(variable.max, 4)} ${variable.baseUnit}`)}</small>
    </div>`;
  }

  function bindCalcInputs(formula) {
    typeset($("#rightPanelBody"));
    $$('[data-var]').forEach(input => input.addEventListener("input", () => calculateFormula(formula, false)));
    $$('[data-unit-for]').forEach(select => select.addEventListener("change", () => calculateFormula(formula, false)));
  }

  function readFormulaInputs(formula) {
    const values = {};
    const warnings = [];
    formula.variables.forEach(variable => {
      const input = $(`[data-var="${variable.key}"]`);
      const select = $(`[data-unit-for="${variable.key}"]`);
      const raw = Number(input.value);
      const option = variable.units[Number(select.value)] || variable.units[0];
      const baseValue = raw * option.factor;
      values[variable.key] = baseValue;
      input.setAttribute("aria-invalid", String(!Number.isFinite(baseValue) || baseValue < variable.min || baseValue > variable.max));
      if (!Number.isFinite(baseValue)) warnings.push(`${variable.name}不是有效数值。`);
      else if (baseValue < variable.min || baseValue > variable.max) warnings.push(`${variable.name}超出建议范围 ${variable.min}–${variable.max} ${variable.baseUnit}。`);
    });
    if (formula.validate) warnings.push(...formula.validate(values));
    return { values, warnings };
  }

  function calculateFormula(formula, record) {
    const resultBox = $("#calcResult");
    if (!resultBox) return null;
    const { values, warnings } = readFormulaInputs(formula);
    let result;
    try {
      result = formula.calculate(values);
    } catch (error) {
      result = { value: NaN, details: error.message };
      warnings.push("计算过程中出现异常，请检查输入。" + error.message);
    }
    resultBox.innerHTML = `<span class="result-label">${escapeHTML(formula.output.name)}</span>
      <strong class="result-value">${formatNumber(result.value)}</strong>
      <span class="result-unit">${escapeHTML(formula.output.unit)}</span>
      <div class="result-meta">${escapeHTML(result.details || "")}</div>
      ${warnings.map(item => `<div class="mini-warning">${escapeHTML(item)}</div>`).join("")}`;

    if (record && Number.isFinite(result.value)) {
      state.history.unshift({ id: formula.id, name: formula.name, value: result.value, unit: formula.output.unit, inputs: values, time: new Date().toLocaleString("zh-CN") });
      state.history = state.history.slice(0, 50);
      saveJSON("history", state.history);
      updateCounters();
      toast("计算完成，已保存到本地记录");
    }
    return { values, warnings, result };
  }

  function runSweep(formula) {
    const baseline = readFormulaInputs(formula).values;
    const key = $("#sweepVar").value;
    const from = Number($("#sweepFrom").value);
    const to = Number($("#sweepTo").value);
    const points = Math.max(10, Math.min(500, Number($("#sweepPoints").value) || 80));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
      toast("扫描起止值必须有效且不能相同");
      return;
    }
    const data = [];
    for (let i = 0; i < points; i++) {
      const x = from + (to - from) * i / (points - 1);
      const inputs = Object.assign({}, baseline, { [key]: x });
      const y = formula.calculate(inputs).value;
      if (Number.isFinite(y)) data.push({ x, y });
    }
    const variable = formula.variables.find(item => item.key === key);
    const chart = {
      title: `${formula.output.name}随${variable.name}变化`,
      xLabel: `${variable.name} (${variable.baseUnit})`, yLabel: `${formula.output.name} (${formula.output.unit})`,
      series: [{ name: formula.name, color: CHART_COLORS[0], points: data }]
    };
    const mount = $("#scanMount");
    mount.innerHTML = `<section class="chart-card"><div class="card-title"><h2>参数扫描结果</h2><button id="exportSweepCsv" class="secondary-btn" type="button">导出 CSV</button></div><div id="sweepChart" class="chart-wrap"><div class="chart-tooltip" hidden></div></div></section>`;
    drawCartesianChart($("#sweepChart"), chart);
    $("#exportSweepCsv").addEventListener("click", () => exportChartCSV(chart, `scan_${formula.id}_${key}.csv`));
    mount.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderContextPanel(type) {
    $("#rightPanelTitle").textContent = type === "knowledge" ? "快速入口" : "工作面板";
    $("#rightPanelBody").innerHTML = `
      <section class="panel-card"><h3>工程检查顺序</h3><ol class="info-list"><li>确认物理量定义与参考基准</li><li>确认公式适用条件</li><li>统一单位后再计算</li><li>检查量级与边界</li></ol></section>
      <section class="panel-card"><h3>常用入口</h3><div class="button-row"><button class="secondary-btn quick-link" data-view="calculator">公式计算</button><button class="secondary-btn quick-link" data-view="converter">单位换算</button><button class="secondary-btn quick-link" data-view="charts">专业图表</button></div></section>
      <section class="panel-card"><div class="mini-warning"><strong>离线说明：</strong>公式、常数、计算记录和备忘录均保存在本地浏览器，不上传网络。</div></section>`;
    $$(".quick-link").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.view)));
  }

  function renderConverter() {
    setViewHeader("水声专用单位换算", "线性量与 dB 量分开处理，明确 10log/20log 和参考基准，避免常见工程错误。", ["工具", "单位换算"]);
    $("#contentArea").innerHTML = `<div class="converter-layout">
      <section class="info-card">
        <div class="form-group"><label for="converterType">换算类型</label><select id="converterType" class="full-select">${DATA.converters.map(item => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join("")}</select></div>
        <div class="form-group"><label for="converterValue">输入值</label><input id="converterValue" type="number" value="1" step="any"></div>
        <div class="input-row"><select id="converterFrom" aria-label="源单位"></select><select id="converterTo" aria-label="目标单位"></select></div>
        <div class="button-row" style="margin-top:12px"><button id="swapUnitsBtn" class="secondary-btn" type="button">交换单位</button><button id="copyConversionBtn" class="primary-btn" type="button">复制结果</button></div>
      </section>
      <section class="info-card converter-result"><div><span class="eyebrow">换算结果</span><div id="conversionBig" class="big-conversion">—</div><div id="conversionEquation" class="converter-equation"></div></div></section>
    </div>
    <div id="converterWarning" class="warning-callout" style="margin-top:14px"></div>`;

    const typeSelect = $("#converterType");
    const refreshUnits = () => {
      /* 未选择时默认使用第一个换算类别，与浏览器 <select> 的默认行为一致。 */
      const config = DATA.converters.find(item => item.id === typeSelect.value) || DATA.converters[0];
      const options = Object.keys(config.units).map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("");
      $("#converterFrom").innerHTML = options;
      $("#converterTo").innerHTML = options;
      $("#converterTo").selectedIndex = Math.min(1, Object.keys(config.units).length - 1);
      updateConversion();
    };
    typeSelect.addEventListener("change", refreshUnits);
    $("#converterValue").addEventListener("input", updateConversion);
    $("#converterFrom").addEventListener("change", updateConversion);
    $("#converterTo").addEventListener("change", updateConversion);
    $("#swapUnitsBtn").addEventListener("click", () => {
      const from = $("#converterFrom"), to = $("#converterTo");
      const tmp = from.value; from.value = to.value; to.value = tmp; updateConversion();
    });
    $("#copyConversionBtn").addEventListener("click", () => copyText($("#conversionBig").textContent, "换算结果已复制"));
    refreshUnits();
    renderContextPanel("converter");
  }

  function updateConversion() {
    const type = $("#converterType");
    if (!type) return;
    const config = DATA.converters.find(item => item.id === type.value);
    if (!config) return;
    const value = Number($("#converterValue").value);
    const names = Object.keys(config.units);
    const from = names.includes($("#converterFrom").value) ? $("#converterFrom").value : names[0];
    const to = names.includes($("#converterTo").value) ? $("#converterTo").value : names[Math.min(1, names.length-1)];
    let result = NaN;
    let equation = "";
    let warning = "线性量可先换算到基准单位，再换算到目标单位。";

    if (config.kind === "linear") {
      result = value * config.units[from] / config.units[to];
      equation = `${value} ${from} × ${config.units[from]} ÷ ${config.units[to]}`;
    } else if (config.kind === "pressureDb") {
      const fromDb = config.units[from] === "db";
      const toDb = config.units[to] === "db";
      let pa;
      if (fromDb) pa = 1e-6 * Math.pow(10, value/20); else pa = value * config.units[from];
      result = toDb ? 20*Math.log10(pa/1e-6) : pa/config.units[to];
      equation = fromDb ? `p=1 μPa × 10^(${value}/20)` : (toDb ? `Lp=20log10(p/1 μPa)` : "线性声压换算");
      warning = "声压是幅度量，使用 20log10；本工具固定水声基准 1 μPa。空气声学 20 μPa 不适用。";
    } else {
      const factor = config.kind === "amplitudeDb" ? 20 : 10;
      const fromDb = config.units[from] === "db";
      const toDb = config.units[to] === "db";
      const ratio = fromDb ? Math.pow(10, value/factor) : value;
      result = toDb ? factor*Math.log10(ratio) : ratio;
      equation = fromDb ? `ratio=10^(${value}/${factor})` : `L=${factor}log10(ratio)`;
      warning = factor === 20 ? "幅度比使用 20log10（声压、电压、位移等）。" : "功率/强度/能量比使用 10log10。";
    }
    $("#conversionBig").textContent = `${formatNumber(result)} ${to}`;
    $("#conversionEquation").textContent = equation;
    $("#converterWarning").textContent = warning;
  }

  function renderCharts() {
    const chartOptions = [
      ["svp", "海水声速剖面"], ["absorption", "吸收系数曲线"], ["tl", "传播损失曲线"],
      ["ts", "目标强度角度曲线"], ["beam", "波束指向性图"], ["noise", "海洋噪声谱"], ["reverb", "混响衰减曲线"]
    ];
    setViewHeader("水声专业图表", "参数改变后自动重绘；支持直角/极坐标切换、悬浮读数、PNG 与 CSV 导出。", ["工具", "专业图表"]);
    $("#contentArea").innerHTML = `<section class="chart-card">
      <div class="chart-toolbar">
        <div class="tabs">${chartOptions.map(([id, name]) => `<button class="tab-btn ${state.chartType === id ? "active" : ""}" data-chart-type="${id}" type="button">${name}</button>`).join("")}</div>
        <div class="button-row">
          <button id="chartModeBtn" class="secondary-btn" type="button">${state.chartMode === "polar" ? "切换直角坐标" : "切换极坐标"}</button>
          <button id="exportPngBtn" class="secondary-btn" type="button">导出 PNG</button>
          <button id="exportCsvBtn" class="secondary-btn" type="button">导出 CSV</button>
        </div>
      </div>
      <div id="mainChart" class="chart-wrap"><div class="chart-tooltip" hidden></div></div>
      <div id="mainLegend" class="chart-legend"></div>
    </section>
    <section class="info-card" style="margin-top:14px"><div class="card-title"><h2>图表说明</h2></div><p id="chartDescription" class="info-list"></p></section>`;

    $$('[data-chart-type]').forEach(btn => btn.addEventListener("click", () => {
      state.chartType = btn.dataset.chartType;
      if (state.chartType !== "beam" && state.chartType !== "ts") state.chartMode = "cartesian";
      renderCharts();
    }));
    $("#chartModeBtn").addEventListener("click", () => {
      if (state.chartType !== "beam" && state.chartType !== "ts") {
        toast("极坐标主要用于波束指向性和目标强度角度曲线");
        return;
      }
      state.chartMode = state.chartMode === "polar" ? "cartesian" : "polar";
      renderCharts();
    });
    $("#exportPngBtn").addEventListener("click", exportCurrentPNG);
    $("#exportCsvBtn").addEventListener("click", () => state.currentChart && exportChartCSV(state.currentChart, `${state.chartType}_data.csv`));
    renderChartPanel();
    redrawCurrentChart();
  }

  function renderChartPanel() {
    const configs = {
      svp: [
        ["maxDepth", "最大深度", "m", 10, 11000, 100], ["surfaceT", "表层温度", "°C", -2, 40, 0.5], ["bottomT", "底层温度", "°C", -2, 40, 0.5],
        ["surfaceS", "表层盐度", "PSU", 0, 45, 0.1], ["bottomS", "底层盐度", "PSU", 0, 45, 0.1]
      ],
      absorption: [["T", "温度", "°C", -2, 35, 0.5], ["S", "盐度", "PSU", 0, 45, 0.5], ["D", "深度", "m", 0, 11000, 100], ["pH", "pH", "1", 6, 9, 0.05]],
      tl: [["alpha", "吸收系数", "dB/km", 0, 100, 0.1], ["n1", "曲线1扩展系数", "dB/dec", 10, 30, 5], ["n2", "曲线2扩展系数", "dB/dec", 10, 30, 5]],
      ts: [["ts0", "正横/正向 TS", "dB", -60, 60, 1], ["ka", "尺度参数 ka", "1", 0.1, 80, 0.5]],
      beam: [["N", "阵元数", "个", 2, 256, 1], ["spacing", "阵元间距 d/λ", "1", 0.1, 2, 0.05], ["steer", "扫描角", "°", -80, 80, 1], ["floor", "显示下限", "dB", -80, -10, 5]],
      noise: [["seaState", "海况", "级", 0, 6, 1], ["shipping", "航运密度", "0–1", 0, 1, 0.1]],
      reverb: [["SL", "发射源级", "dB", 100, 260, 1], ["alpha", "吸收系数", "dB/km", 0, 20, 0.1], ["Ss", "散射强度", "dB", -80, 0, 1], ["pulse", "脉宽", "s", 0.001, 1, 0.01]]
    };
    const fields = configs[state.chartType];
    $("#rightPanelTitle").textContent = "图表参数";
    $("#rightPanelBody").innerHTML = `<section class="panel-card"><h3>${escapeHTML(chartTitle(state.chartType))}</h3><div class="chart-param-grid">${fields.map(([key, name, unitName, min, max, step]) => `<div class="form-group"><label for="chart-${key}"><span>${name}</span><span>${unitName}</span></label><input id="chart-${key}" data-chart-param="${key}" type="number" value="${state.chartParams[state.chartType][key]}" min="${min}" max="${max}" step="${step}"></div>`).join("")}</div></section>
      <section class="panel-card"><div class="mini-warning">图表为工程模型演示。经验曲线必须结合模型适用域、环境数据和测量不确定度解读。</div></section>`;
    $$('[data-chart-param]').forEach(input => input.addEventListener("input", () => {
      state.chartParams[state.chartType][input.dataset.chartParam] = Number(input.value);
      redrawCurrentChart();
    }));
  }

  function chartTitle(type) {
    return ({ svp: "海水声速剖面", absorption: "海水吸收系数", tl: "传播损失", ts: "目标强度角度", beam: "阵列波束指向性", noise: "海洋环境噪声谱", reverb: "混响衰减" })[type];
  }

  function redrawCurrentChart() {
    const mount = $("#mainChart");
    if (!mount) return;
    const chart = buildChart(state.chartType);
    state.currentChart = chart;
    mount.innerHTML = `<div class="chart-tooltip" hidden></div>`;
    const isPolar = state.chartMode === "polar" && (state.chartType === "beam" || state.chartType === "ts");
    mount.insertAdjacentHTML("beforeend", isPolar ? polarSVG(chart) : cartesianSVG(chart));
    if (isPolar) attachPolarTooltip(mount, chart); else attachChartTooltip(mount, chart);
    $("#mainLegend").innerHTML = chart.series.map(series => `<span class="legend-item"><span class="legend-line" style="background:${series.color}"></span>${escapeHTML(series.name)}</span>`).join("");
    $("#chartDescription").textContent = chart.description;
  }

  function drawCartesianChart(container, chart) {
    container.insertAdjacentHTML("beforeend", cartesianSVG(chart));
    attachChartTooltip(container, chart);
  }

  function drawPolarChart(container, chart) {
    container.insertAdjacentHTML("beforeend", polarSVG(chart));
    attachPolarTooltip(container, chart);
  }

  function calculateNamed(formulaId, overrides) {
    const formula = formulaById(formulaId);
    if (!formula) throw new Error(`未知公式: ${formulaId}`);
    const values = {};
    formula.variables.forEach(variable => { values[variable.key] = variable.default; });
    Object.keys(overrides || {}).forEach(key => { values[key] = overrides[key]; });
    return formula.calculate(values);
  }

  function runSelfTestRecord() {
    const checks = [];
    DATA.formulas.forEach(formula => {
      const inputs = {};
      formula.variables.forEach(variable => { inputs[variable.key] = variable.default; });
      try {
        const value = formula.calculate(inputs).value;
        checks.push({ name: formula.name, pass: Number.isFinite(value) || value === Infinity });
      } catch (error) {
        checks.push({ name: formula.name, pass: false });
      }
    });
    checks.push({ name: "SPL 1 Pa = 120 dB", pass: approxEqual(calculateNamed("spl-pressure", { p: 1 }).value, 120, 1e-6) });
    checks.push({ name: "球面扩展 1 km = 60 dB", pass: approxEqual(calculateNamed("spreading-loss", { r: 1000 }).value, 60, 1e-6) });
    checks.push({ name: "阵增益 N=100 = 20 dB", pass: approxEqual(calculateNamed("array-gain", { N: 100, loss: 0 }).value, 20, 1e-6) });
    checks.push({ name: "声呐方程默认余量", pass: approxEqual(calculateNamed("active-sonar").value, 0, 1e-6) });
    return { pass: checks.every(item => item.pass), total: checks.length, failed: checks.filter(item => !item.pass).map(item => item.name).join("、") };
  }

  function approxEqual(actual, expected, tol) {
    return Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  }

  function buildChart(type) {
    if (type === "svp") return buildSVPChart();
    if (type === "absorption") return buildAbsorptionChart();
    if (type === "tl") return buildTLChart();
    if (type === "ts") return buildTSChart();
    if (type === "beam") return buildBeamChart();
    if (type === "noise") return buildNoiseChart();
    return buildReverbChart();
  }

  function logSpace(a, b, count) {
    const start = Math.log10(a), end = Math.log10(b);
    return Array.from({ length: count }, (_, i) => Math.pow(10, start + (end-start)*i/(count-1)));
  }

  function buildSVPChart() {
    const p = state.chartParams.svp;
    const mackenzie = formulaById("mackenzie-sound-speed");
    const medwin = formulaById("medwin-sound-speed");
    const s1 = [], s2 = [];
    for (let i = 0; i <= 100; i++) {
      const D = p.maxDepth*i/100;
      const ratio = D/p.maxDepth;
      const T = p.surfaceT + (p.bottomT-p.surfaceT)*Math.pow(ratio, 0.72);
      const S = p.surfaceS + (p.bottomS-p.surfaceS)*ratio;
      s1.push({ x: mackenzie.calculate({ T, S, D }).value, y: D });
      if (D <= 1000) s2.push({ x: medwin.calculate({ T, S, D }).value, y: D });
    }
    return { title: "海水声速剖面", xLabel: "声速 c (m/s)", yLabel: "深度 D (m)", yInvert: true, series: [
      { name: "Mackenzie", color: CHART_COLORS[0], points: s1 }, { name: "Medwin（≤1000 m）", color: CHART_COLORS[1], points: s2 }
    ], description: "温度和盐度在表层—底层之间按简化剖面插值；用于比较两种经验声速模型，不替代实测 CTD/SVP 数据。" };
  }

  function buildAbsorptionChart() {
    const p = state.chartParams.absorption;
    const fg = formulaById("francois-garrison"), thorp = formulaById("thorp-absorption");
    const freqs = logSpace(0.01, 1000, 180);
    return { title: "海水吸收系数随频率变化", xLabel: "频率 f (kHz)", yLabel: "吸收系数 α (dB/km)", xLog: true, yLog: true,
      series: [
        { name: "Francois–Garrison", color: CHART_COLORS[0], points: freqs.map(f => ({ x: f, y: fg.calculate({ f, T:p.T, S:p.S, D:p.D, pH:p.pH }).value })) },
        { name: "Thorp", color: CHART_COLORS[1], points: freqs.map(f => ({ x: f, y: thorp.calculate({ f }).value })) }
      ], description: "双对数坐标对比环境敏感的 Francois–Garrison 模型与简化 Thorp 模型；低频 pH、高频温度的影响尤为明显。" };
  }

  function buildTLChart() {
    const p = state.chartParams.tl;
    const ranges = logSpace(0.01, 500, 180);
    const make = (n, color) => ({ name: `N=${n} dB/dec`, color, points: ranges.map(r => ({ x:r, y:n*Math.log10(r*1000)+p.alpha*r })) });
    return { title: "传播损失随距离变化", xLabel: "距离 r (km)", yLabel: "TL (dB re 1 m)", xLog: true,
      series: [make(p.n1, CHART_COLORS[0]), make(p.n2, CHART_COLORS[1])], description: "模型 TL=Nlog10(r/1m)+αr，叠加几何扩展和均匀吸收；未计海面、海底、多途和声道效应。" };
  }

  function sinc(value) { return Math.abs(value) < 1e-9 ? 1 : Math.sin(value)/value; }

  function buildTSChart() {
    const p = state.chartParams.ts;
    const points = [];
    for (let angle = -180; angle <= 180; angle += 1) {
      const pattern = Math.abs(sinc(p.ka*Math.sin(rad(angle))));
      points.push({ x: angle, y: Math.max(-60, p.ts0 + 20*Math.log10(Math.max(1e-8, pattern))), theta: angle });
    }
    return { title: "规则目标角度起伏示意", xLabel: "方位角 θ (°)", yLabel: "TS (dB re 1 m²)", polarFloor: Math.min(-60, p.ts0-40),
      series: [{ name: "相干散射近似", color: CHART_COLORS[0], points }], description: "采用 sinc 型相干孔径示意目标强度角度起伏，仅用于展示角度敏感性；具体目标需使用散射模型或实测数据。" };
  }

  function buildBeamChart() {
    const p = state.chartParams.beam;
    const points = [];
    const steerSin = Math.sin(rad(p.steer));
    for (let angle = -180; angle <= 180; angle += 0.5) {
      const u = Math.PI*p.spacing*(Math.sin(rad(angle))-steerSin);
      const amp = Math.abs(Math.sin(p.N*u)/(p.N*Math.sin(u)));
      const value = Number.isFinite(amp) ? amp : 1;
      points.push({ x: angle, theta: angle, y: Math.max(p.floor, 20*Math.log10(Math.max(1e-10, value))) });
    }
    return { title: "均匀线阵波束指向性", xLabel: "角度 θ (°)", yLabel: "相对响应 (dB)", polarFloor: p.floor,
      series: [{ name: `N=${p.N}, d/λ=${p.spacing}`, color: CHART_COLORS[0], points }], description: "均匀加权线阵远场阵因子；当 d/λ 过大或扫描角增大时，可见区可能出现栅瓣。" };
  }

  function buildNoiseChart() {
    const p = state.chartParams.noise;
    const freqs = logSpace(0.01, 1000, 200); // kHz
    const thermal = freqs.map(f => ({ x:f, y:-15+20*Math.log10(f) }));
    const wind = freqs.map(f => ({ x:f, y:50 + 5*p.seaState - 16.6*Math.log10(Math.max(f, 0.05)) }));
    const ship = freqs.map(f => ({ x:f, y:55 + 15*p.shipping - 10*Math.log10(1+Math.pow(f/0.1, 2)) }));
    const total = freqs.map((f, i) => ({ x:f, y:10*Math.log10(Math.pow(10,thermal[i].y/10)+Math.pow(10,wind[i].y/10)+Math.pow(10,ship[i].y/10)) }));
    return { title: "海洋环境噪声谱", xLabel: "频率 f (kHz)", yLabel: "谱级 (dB re 1 μPa²/Hz)", xLog: true,
      series: [
        { name:"总噪声（能量和）", color:CHART_COLORS[0], points:total }, { name:"风关噪声近似", color:CHART_COLORS[1], points:wind },
        { name:"航运噪声示意", color:CHART_COLORS[2], points:ship }, { name:"热噪声", color:CHART_COLORS[3], points:thermal }
      ], description: "Wenz 图思想的简化分量模型，分量在功率域相加；风关和航运曲线仅作工程趋势示意，不用于环境合规测量。" };
  }

  function buildReverbChart() {
    const p = state.chartParams.reverb;
    const points = [];
    for (let t = 0.1; t <= 20; t += 0.1) {
      const r = 1500*t/2/1000;
      const TL = 20*Math.log10(Math.max(1, r*1000)) + p.alpha*r;
      const area = (1500*p.pulse/2)*(r*1000)*0.1;
      points.push({ x:t, y:p.SL-2*TL+p.Ss+10*Math.log10(Math.max(area,1e-12)) });
    }
    return { title:"面混响随时间衰减", xLabel:"双程到达时间 t (s)", yLabel:"混响级 RL (dB re 1 μPa)",
      series:[{ name:"面混响基础模型", color:CHART_COLORS[0], points }], description:"由 r=ct/2、球面扩展、均匀吸收和有效散射面积估算；未计波导传播、散射强度角度依赖和波束形状。" };
  }

  function chartTheme() {
    const css = getComputedStyle(document.documentElement);
    return { text: css.getPropertyValue("--text").trim(), muted: css.getPropertyValue("--muted").trim(), grid: css.getPropertyValue("--chart-grid").trim(), surface: css.getPropertyValue("--surface").trim() };
  }

  function cartesianSVG(chart) {
    const width = 900, height = 420;
    const margin = { left: 76, right: 24, top: 32, bottom: 58 };
    const all = chart.series.flatMap(series => series.points).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && (!chart.xLog || point.x > 0) && (!chart.yLog || point.y > 0));
    if (!all.length) return `<div class="empty-state">当前参数没有可绘制数据。</div>`;
    const tx = value => chart.xLog ? Math.log10(value) : value;
    const ty = value => chart.yLog ? Math.log10(value) : value;
    let xMin = Math.min(...all.map(p => tx(p.x))), xMax = Math.max(...all.map(p => tx(p.x)));
    let yMin = Math.min(...all.map(p => ty(p.y))), yMax = Math.max(...all.map(p => ty(p.y)));
    if (xMin === xMax) { xMin -= 1; xMax += 1; }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yPad = (yMax-yMin)*0.08; yMin -= yPad; yMax += yPad;
    const plotW = width-margin.left-margin.right, plotH = height-margin.top-margin.bottom;
    const xPx = x => margin.left + (tx(x)-xMin)/(xMax-xMin)*plotW;
    const yPx = y => {
      const ratio = (ty(y)-yMin)/(yMax-yMin);
      return margin.top + (chart.yInvert ? ratio : 1-ratio)*plotH;
    };
    const xVal = px => chart.xLog ? Math.pow(10, xMin + (px-margin.left)/plotW*(xMax-xMin)) : xMin + (px-margin.left)/plotW*(xMax-xMin);
    chart._layout = { width, margin, plotW, plotH, xVal, tx };
    const theme = chartTheme();
    const grid = [];
    for (let i=0;i<=5;i++) {
      const x = margin.left + plotW*i/5, y = margin.top + plotH*i/5;
      const xv = chart.xLog ? Math.pow(10,xMin+(xMax-xMin)*i/5) : xMin+(xMax-xMin)*i/5;
      const yRatio = chart.yInvert ? i/5 : 1-i/5;
      const yvT = yMin+(yMax-yMin)*yRatio;
      const yv = chart.yLog ? Math.pow(10,yvT) : yvT;
      grid.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${height-margin.bottom}" stroke="${theme.grid}" stroke-width="1"/><text x="${x}" y="${height-margin.bottom+22}" fill="${theme.muted}" font-size="10" text-anchor="middle">${formatNumber(xv,3)}</text>`);
      grid.push(`<line x1="${margin.left}" y1="${y}" x2="${width-margin.right}" y2="${y}" stroke="${theme.grid}" stroke-width="1"/><text x="${margin.left-10}" y="${y+4}" fill="${theme.muted}" font-size="10" text-anchor="end">${formatNumber(yv,3)}</text>`);
    }
    const paths = chart.series.map(series => {
      const d = series.points.filter(p => Number.isFinite(p.x)&&Number.isFinite(p.y)&&(!chart.xLog||p.x>0)&&(!chart.yLog||p.y>0)).map((p,i) => `${i?"L":"M"}${xPx(p.x).toFixed(2)},${yPx(p.y).toFixed(2)}`).join(" ");
      return `<path d="${d}" fill="none" stroke="${series.color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(chart.title)}" data-chart-svg>
      <rect width="${width}" height="${height}" fill="${theme.surface}"/>
      ${grid.join("")}
      <line x1="${margin.left}" y1="${height-margin.bottom}" x2="${width-margin.right}" y2="${height-margin.bottom}" stroke="${theme.text}" stroke-width="1.2"/>
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height-margin.bottom}" stroke="${theme.text}" stroke-width="1.2"/>
      ${paths}
      <text x="${width/2}" y="20" fill="${theme.text}" font-size="14" font-weight="700" text-anchor="middle">${escapeHTML(chart.title)}</text>
      <text x="${margin.left+plotW/2}" y="${height-10}" fill="${theme.muted}" font-size="11" text-anchor="middle">${escapeHTML(chart.xLabel)}</text>
      <text x="16" y="${margin.top+plotH/2}" fill="${theme.muted}" font-size="11" text-anchor="middle" transform="rotate(-90 16 ${margin.top+plotH/2})">${escapeHTML(chart.yLabel)}</text>
    </svg>`;
    return svg;
  }

  function attachChartTooltip(container, chart) {
    const svgEl = $("[data-chart-svg]", container);
    const tooltip = $(".chart-tooltip", container);
    if (!svgEl || !tooltip) return;
    const layout = chart._layout;
    if (!layout) return;
    const width = layout.width;
    const margin = layout.margin;
    const tx = layout.tx;
    svgEl.addEventListener("pointermove", event => {
      const rect = svgEl.getBoundingClientRect();
      const px = (event.clientX-rect.left)/rect.width*width;
      if (px < margin.left || px > width-margin.right) { tooltip.hidden = true; return; }
      const rawX = layout.xVal(px);
      const rows = chart.series.map(series => {
        const nearest = series.points.reduce((best, point) => Math.abs(tx(point.x)-tx(rawX)) < Math.abs(tx(best.x)-tx(rawX)) ? point : best, series.points[0]);
        return `${series.name}: ${formatNumber(nearest.y,5)}`;
      });
      tooltip.innerHTML = `<strong>x=${formatNumber(rawX,5)}</strong><br>${rows.map(escapeHTML).join("<br>")}`;
      tooltip.style.left = `${event.clientX-rect.left}px`; tooltip.style.top = `${event.clientY-rect.top}px`; tooltip.hidden=false;
    });
    svgEl.addEventListener("pointerleave", () => { tooltip.hidden = true; });
  }

  function polarSVG(chart) {
    const width = 900, height = 420;
    const cx = width/2, cy = height/2+8, radius = Math.min(width*0.34, height*0.40);
    const floor = chart.polarFloor || -40;
    const theme = chartTheme();
    const rings = [0.25,0.5,0.75,1].map(r => `<circle cx="${cx}" cy="${cy}" r="${radius*r}" fill="none" stroke="${theme.grid}"/><text x="${cx+5}" y="${cy-radius*r+11}" fill="${theme.muted}" font-size="9">${Math.round(floor+(0-floor)*r)} dB</text>`).join("");
    const spokes = [];
    for (let angle=0; angle<360; angle+=30) {
      const a = rad(angle-90);
      spokes.push(`<line x1="${cx}" y1="${cy}" x2="${cx+radius*Math.cos(a)}" y2="${cy+radius*Math.sin(a)}" stroke="${theme.grid}"/><text x="${cx+(radius+16)*Math.cos(a)}" y="${cy+(radius+16)*Math.sin(a)+4}" fill="${theme.muted}" font-size="9" text-anchor="middle">${angle}°</text>`);
    }
    const paths = chart.series.map(series => {
      const d = series.points.map((p,i) => {
        const level = Math.max(floor, Math.min(0, p.y));
        const rr = (level-floor)/(0-floor)*radius;
        const a = rad((p.theta !== undefined ? p.theta : p.x)-90);
        return `${i?"L":"M"}${(cx+rr*Math.cos(a)).toFixed(2)},${(cy+rr*Math.sin(a)).toFixed(2)}`;
      }).join(" ") + " Z";
      return `<path d="${d}" fill="${series.color}18" stroke="${series.color}" stroke-width="2"/>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(chart.title)}" data-chart-svg>
      <rect width="${width}" height="${height}" fill="${theme.surface}"/><text x="${width/2}" y="20" fill="${theme.text}" font-size="14" font-weight="700" text-anchor="middle">${escapeHTML(chart.title)}</text>${rings}${spokes.join("")}${paths}</svg>`;
  }

  function attachPolarTooltip(container, chart) {
    const svgEl = $("[data-chart-svg]", container);
    const tooltip = $(".chart-tooltip", container);
    if (!svgEl || !tooltip) return;
    const width = 900, height = 420;
    const cx = width/2, cy = height/2+8;
    svgEl.addEventListener("pointermove", event => {
      const rect=svgEl.getBoundingClientRect();
      const x=(event.clientX-rect.left)/rect.width*width-cx;
      const y=(event.clientY-rect.top)/rect.height*height-cy;
      let angle=deg(Math.atan2(y,x))+90; if(angle<0) angle+=360;
      const rows=chart.series.map(series=>{
        const nearest=series.points.reduce((best,p)=>{
          const cur=((p.theta !== undefined ? p.theta : p.x)-angle+540)%360-180;
          const bestCur=((best.theta !== undefined ? best.theta : best.x)-angle+540)%360-180;
          return Math.abs(cur)<Math.abs(bestCur)?p:best;
        },series.points[0]);
        return `${series.name}: ${formatNumber(nearest.y,4)} dB`;
      });
      tooltip.innerHTML=`<strong>θ=${angle.toFixed(1)}°</strong><br>${rows.map(escapeHTML).join("<br>")}`;
      tooltip.style.left=`${event.clientX-rect.left}px`; tooltip.style.top=`${event.clientY-rect.top}px`; tooltip.hidden=false;
    });
    svgEl.addEventListener("pointerleave",()=>{tooltip.hidden=true;});
  }

  function exportCurrentPNG() {
    const svg = $("#mainChart [data-chart-svg]");
    if (!svg) { toast("当前没有可导出的图表"); return; }
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svg);
    if (!source.includes("xmlns=")) source = source.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    const blob = new Blob([source], { type:"image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob); const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = image.width*2; canvas.height = image.height*2;
      const ctx=canvas.getContext("2d"); ctx.fillStyle=state.theme==="dark"?"#12212c":"#ffffff"; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0,canvas.width,canvas.height);
      canvas.toBlob(png => { downloadBlob(png, `${state.chartType}_chart.png`); URL.revokeObjectURL(url); }, "image/png");
    };
    image.onerror = () => { URL.revokeObjectURL(url); toast("PNG 导出失败，请改用浏览器截图。"); };
    image.src=url;
  }

  function exportChartCSV(chart, filename) {
    const maxLength = Math.max(...chart.series.map(series => series.points.length));
    const header = [chart.xLabel, ...chart.series.map(series => `${series.name} [${chart.yLabel}]`)];
    const rows = [header.map(csvCell).join(",")];
    for (let i=0;i<maxLength;i++) {
      const first = chart.series.find(series => series.points[i]);
      const x = first ? first.points[i].x : "";
      rows.push([x, ...chart.series.map(series => series.points[i] ? series.points[i].y : "")].map(csvCell).join(","));
    }
    downloadBlob(new Blob(["\ufeff" + rows.join("\r\n")], { type:"text/csv;charset=utf-8" }), filename);
  }

  function csvCell(value) {
    const text=String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
  }

  function downloadBlob(blob, filename) {
    const link=document.createElement("a"); const url=URL.createObjectURL(blob); link.href=url; link.download=filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function renderConstants() {
    setViewHeader("常用常数与材料参数", "可编辑副本用于工程计算；材料参数为典型值，正式设计必须以具体型号数据表为准。", ["工程资料", "常数库"]);
    const groups = [...new Set(DATA.constants.map(item => item.group))];
    $("#contentArea").innerHTML = `<div class="tabs">${groups.map((group,index)=>`<button class="tab-btn ${index===0?"active":""}" data-constant-group="${escapeHTML(group)}">${escapeHTML(group)}</button>`).join("")}</div><section class="info-card"><div class="table-wrap"><table class="constants-table"><thead><tr><th>名称</th><th>符号</th><th>数值</th><th>单位</th><th>典型范围/性质</th><th>工程说明</th><th>来源</th></tr></thead><tbody id="constantsBody"></tbody></table></div></section>`;
    const draw = group => {
      $("#constantsBody").innerHTML = DATA.constants.filter(item=>item.group===group).map(item=>`<tr><td>${escapeHTML(item.name)}</td><td>${escapeHTML(item.symbol)}</td><td><input type="number" value="${item.value}" aria-label="${escapeHTML(item.name)}数值"></td><td>${escapeHTML(item.unit)}</td><td>${escapeHTML(item.range)}</td><td>${escapeHTML(item.note)}</td><td>${escapeHTML(item.source)}</td></tr>`).join("");
      $$('[data-constant-group]').forEach(btn=>btn.classList.toggle("active",btn.dataset.constantGroup===group));
    };
    $$('[data-constant-group]').forEach(btn=>btn.addEventListener("click",()=>draw(btn.dataset.constantGroup)));
    draw(groups[0]); renderContextPanel("constants");
  }

  function renderGlossary() {
    setViewHeader("名词术语与易错点", "中英文对照与高频混淆概念辨析，重点标出 dB、参考基准、单/双程和适用条件。", ["工程资料", "术语辨析"]);
    $("#contentArea").innerHTML = `<div class="glossary-grid">${DATA.glossary.map(item=>`<article class="glossary-item"><div><h3>${escapeHTML(item.term)}</h3><div class="english">${escapeHTML(item.en)}</div></div><div><p>${escapeHTML(item.compare)}</p><p class="mistake">${escapeHTML(item.mistake)}</p></div></article>`).join("")}</div>`;
    renderContextPanel("glossary");
  }

  function renderNotes() {
    setViewHeader("工程备忘录", "笔记保存在当前浏览器本地，可绑定到某条公式；不上传、不联网。", ["我的内容", "工程备忘录"]);
    $("#contentArea").innerHTML = `<div class="note-editor"><section class="info-card"><div class="form-group"><label for="noteTitle">标题</label><input id="noteTitle" type="text" placeholder="例如：浅海 30 kHz 工况"></div><div class="form-group"><label for="noteFormula">绑定公式</label><select id="noteFormula" class="full-select"><option value="">不绑定</option>${DATA.formulas.map(item=>`<option value="${item.id}">${escapeHTML(item.name)}</option>`).join("")}</select></div><div class="form-group"><label for="noteContent">内容</label><textarea id="noteContent" rows="10" placeholder="记录假设、参数来源、校核结果和待办事项…"></textarea></div><button id="addNoteBtn" class="primary-btn" type="button">保存笔记</button></section><section class="info-card"><div class="card-title"><h2>已保存笔记</h2><button id="exportNotesBtn" class="secondary-btn" type="button">导出 JSON</button></div><div id="noteList" class="note-list"></div></section></div>`;
    $("#addNoteBtn").addEventListener("click",()=>{
      const title=$("#noteTitle").value.trim(), content=$("#noteContent").value.trim(); if(!title||!content){toast("请填写标题和内容");return;}
      state.notes.unshift({id:String(Date.now()),title,content,formulaId:$("#noteFormula").value,time:new Date().toLocaleString("zh-CN")}); saveJSON("notes",state.notes); renderNotes(); toast("笔记已保存");
    });
    $("#exportNotesBtn").addEventListener("click",()=>downloadBlob(new Blob([JSON.stringify(state.notes,null,2)],{type:"application/json"}),"hydro_notes.json"));
    renderNoteList(); renderContextPanel("notes");
  }

  function renderNoteList() {
    const list=$("#noteList"); if(!list)return;
    list.innerHTML=state.notes.length?state.notes.map(note=>{const f=formulaById(note.formulaId);return `<article class="note-item"><button type="button" data-delete-note="${note.id}" aria-label="删除笔记">×</button><h3>${escapeHTML(note.title)}</h3><p>${escapeHTML(note.content)}</p><small>${escapeHTML(note.time)}${f?` · ${escapeHTML(f.name)}`:""}</small></article>`;}).join(""):`<div class="empty-state">还没有笔记。</div>`;
    $$('[data-delete-note]').forEach(btn=>btn.addEventListener("click",()=>{state.notes=state.notes.filter(note=>note.id!==btn.dataset.deleteNote);saveJSON("notes",state.notes);renderNoteList();}));
  }

  function renderHelp() {
    setViewHeader("帮助、方法与参考", "首版定位为离线工程速算和公式查阅工具；计算结果应结合原始文献、测量条件与模型适用域复核。", ["系统", "帮助与参考"]);
    $("#contentArea").innerHTML = `
      <section class="help-section"><h2>使用流程</h2><ol><li>在知识库中按学科、公式名、变量或英文名检索。</li><li>打开公式，先阅读适用条件和参考基准，再输入参数。</li><li>同一变量可切换工程单位；内部统一换算后计算。</li><li>用参数扫描查看趋势；用专业图表比较工况并导出 PNG/CSV。</li><li>重要结果应保存参数快照、来源与不确定度。</li></ol></section>
      <section class="help-section"><h2>三条 dB 铁律</h2><ul><li>声压、电压、位移等幅度量：20log10。</li><li>声强、功率、能量、散射截面定义的 TS/Ss/Sv：10log10。</li><li>任何 dB 数值必须同时写参考基准、参考距离和带宽属性。</li></ul></section>
      <section class="help-section"><h2>本地运行与兼容</h2><p>直接双击 index.html。建议使用当前版本 Chrome、Edge 或 Firefox。所有依赖均在 vendor 目录，本页不会发起外网请求。若浏览器隐私模式禁用 localStorage，计算仍可用，但收藏、历史和笔记不能持久保存。</p></section>
      <section class="help-section"><h2>扩展一条公式</h2><pre>{
  id: "unique-id", category: "propagation",
  name: "中文名称", en: "English Name", type: "theory",
  latex: "TL=20\\\\log_{10}r", variables: [...],
  output: { name: "结果", unit: "dB" },
  conditions: [...], notes: [...], refs: [...],
  calculate: values =&gt; ({ value: ..., details: "..." })
}</pre><p>在 data.js 的 formulas 数组中新增条目，界面、搜索、变量表、计算器和收藏功能会自动生成。</p></section>
      <section class="help-section"><h2>主要参考</h2><ul><li>Urick, Principles of Underwater Sound, 3rd ed.</li><li>Jensen et al., Computational Ocean Acoustics, 2nd ed.</li><li>Ainslie, Principles of Sonar Performance Modelling.</li><li>Lurton, An Introduction to Underwater Acoustics, 2nd ed.</li><li>Francois & Garrison, JASA 72(6), 1982.</li><li>Mackenzie, JASA 70(3), 1981.</li><li>ISO 18405:2017；IEC 60565。</li></ul></section>`;
    renderContextPanel("help");
  }

  function renderHistoryView() {
    state.view="history";
    $$(".nav-item").forEach(btn=>btn.classList.remove("active"));
    setViewHeader("计算记录", "最近 50 条计算保存在当前浏览器本地。", ["我的内容","计算记录"], `<button id="clearHistoryBtn" class="danger-btn" type="button">清空记录</button>`);
    $("#contentArea").innerHTML=`<section class="info-card">${state.history.length?state.history.map(item=>`<article class="history-item"><strong>${escapeHTML(item.name)}</strong><code>${formatNumber(item.value)} ${escapeHTML(item.unit)}</code><small>${escapeHTML(item.time)}</small></article>`).join(""):`<div class="empty-state">还没有计算记录。</div>`}</section>`;
    $("#clearHistoryBtn").addEventListener("click",()=>{state.history=[];saveJSON("history",state.history);updateCounters();renderHistoryView();});
    $("#rightPanelTitle").textContent="记录操作"; $("#rightPanelBody").innerHTML=`<section class="panel-card"><button id="exportHistoryBtn" class="primary-btn" type="button">导出记录 JSON</button></section>`;
    $("#exportHistoryBtn").addEventListener("click",()=>downloadBlob(new Blob([JSON.stringify(state.history,null,2)],{type:"application/json"}),"hydro_calculation_history.json"));
  }

  function runSelfTest() {
    const result = runSelfTestRecord();
    setAlerts([result.pass ? `自检完成：${result.total}/${result.total} 全部通过。` : `自检完成：${result.total - result.failed.split("、").length}/${result.total} 通过；失败项：${result.failed}`], result.pass ? "info" : "danger");
    toast(result.pass ? "公式自检全部通过" : "自检发现异常");
  }

  function copyText(text, successMessage) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(()=>toast(successMessage)).catch(()=>fallbackCopy(text,successMessage));
    } else fallbackCopy(text,successMessage);
  }

  function fallbackCopy(text, successMessage) {
    const area=document.createElement("textarea"); area.value=text; area.style.position="fixed"; area.style.opacity="0"; document.body.appendChild(area); area.select();
    try{document.execCommand("copy");toast(successMessage);}catch(error){toast("复制失败，请手动选择文本");} area.remove();
  }

  /* 供离线冒烟测试调用的只读接口；不影响正常界面行为。 */
  window.UWA_TEST = {
    navigate,
    calculate: calculateNamed,
    buildChart,
    renderChartSVG: (type, mode) => {
      state.chartType = type;
      state.chartMode = mode || "cartesian";
      const chart = buildChart(type);
      return (mode === "polar" && (type === "beam" || type === "ts")) ? polarSVG(chart) : cartesianSVG(chart);
    },
    selfTest: runSelfTestRecord,
    data: DATA
  };

  init();
})();

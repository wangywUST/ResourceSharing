/*
 * 水声行业公式应用大全 - 领域数据与计算模型
 *
 * 数据项尽量保持声明式：界面从 variables 自动生成输入控件，从 metadata
 * 自动生成知识卡片。新增公式时复制任一条目并修改即可。
 *
 * 重要约定：
 * 1) dB 量必须写明参考基准；
 * 2) calculate() 接收的值已经由界面换算到 variables.baseUnit；
 * 3) 经验公式明确标记 empirical，且给出适用范围与工程警告。
 */
(function () {
  "use strict";

  const categories = [
    { id: "basic", icon: "≈", name: "基础声学物理量", en: "Fundamental Acoustics", description: "声压、声强、声阻抗、参考基准与对数量。" },
    { id: "propagation", icon: "⌁", name: "海洋声传播", en: "Ocean Sound Propagation", description: "海水声速、折射、传播损失与波导近似。" },
    { id: "sonar", icon: "◎", name: "声呐方程", en: "Sonar Equations", description: "主动/被动声呐方程、探测余量与系统级预算。" },
    { id: "noise", icon: "≋", name: "水下噪声", en: "Underwater Noise", description: "噪声谱级、带宽积分、热噪声与环境噪声。" },
    { id: "reverberation", icon: "◌", name: "混响", en: "Reverberation", description: "海面、海底与体积混响的工程估算。" },
    { id: "target", icon: "◆", name: "目标强度", en: "Target Strength", description: "散射截面、目标强度与规则目标近似。" },
    { id: "transducer", icon: "◈", name: "换能器与压电声学", en: "Transducers & Piezoelectricity", description: "声源级、功率、灵敏度与压电材料参数。" },
    { id: "beamforming", icon: "⋔", name: "波束形成", en: "Beamforming", description: "孔径、波束宽度、阵增益与栅瓣条件。" },
    { id: "vector", icon: "→", name: "矢量水听器", en: "Vector Sensors", description: "质点振速、声强矢量与平面波关系。" },
    { id: "imaging", icon: "▦", name: "多波束/侧扫/前视声呐", en: "Imaging Sonars", description: "覆盖宽度、斜距、分辨率与测绘几何。" },
    { id: "materials", icon: "▧", name: "水声材料", en: "Acoustic Materials", description: "阻抗匹配、界面反射与透射。" },
    { id: "cavitation", icon: "○", name: "空化", en: "Cavitation", description: "空化数、空化起始与工程约束。" },
    { id: "attenuation", icon: "↘", name: "水下衰减", en: "Absorption & Attenuation", description: "海水吸收、经验模型与距离累积衰减。" },
    { id: "measurement", icon: "⌖", name: "声学测量", en: "Acoustic Measurement", description: "水听器灵敏度、校准与测量不确定度。" }
  ];

  const unit = (label, factor) => ({ label, factor });
  const v = (key, symbol, name, baseUnit, defaultValue, min, max, options, help, step) => ({
    key, symbol, name, baseUnit, default: defaultValue, min, max,
    units: options || [unit(baseUnit, 1)], help: help || "", step: step || "any"
  });
  const safeLog10 = value => Math.log(value) / Math.LN10;
  const deg = radians => radians * 180 / Math.PI;
  const rad = degrees => degrees * Math.PI / 180;
  const fmt = value => Number.isFinite(value) ? value : NaN;

  const formulas = [
    {
      id: "spl-pressure", category: "basic", name: "声压级", en: "Sound Pressure Level",
      type: "theory", tags: ["SPL", "声压", "dB", "参考声压"],
      definition: "给定均方根声压相对于水声标准参考声压 1 μPa 的对数级。",
      latex: "L_p=20\\log_{10}\\left(\\frac{p_{\\mathrm{rms}}}{1\\,\\mu\\mathrm{Pa}}\\right)",
      variables: [v("p", "p_{rms}", "均方根声压", "Pa", 1, 1e-12, 1e8, [unit("Pa", 1), unit("kPa", 1e3), unit("μPa", 1e-6)], "必须是同一带宽内的 RMS 声压。")],
      output: { name: "声压级", unit: "dB re 1 μPa" },
      conditions: ["参考声压固定为 1 μPa（水下声学）；不可与空气声学 20 μPa 基准混用。", "p 必须为正值。"],
      notes: ["声压属于幅度量，使用 20log10；声强和功率属于功率量，使用 10log10。"],
      refs: ["ISO 18405:2017 Underwater acoustics — Terminology", "Urick, Principles of Underwater Sound, 3rd ed."],
      calculate: x => ({ value: 20 * safeLog10(x.p / 1e-6), details: `20log10(${x.p}/1e-6)` })
    },
    {
      id: "plane-intensity", category: "basic", name: "平面行波声强", en: "Plane-wave Acoustic Intensity",
      type: "theory", tags: ["声强", "声压", "平面波", "阻抗"],
      definition: "在均匀、无耗介质中的平面行波，平均声强等于均方根声压平方除以介质特性阻抗。",
      latex: "I=\\frac{p_{\\mathrm{rms}}^2}{\\rho c}",
      variables: [
        v("p", "p_{rms}", "均方根声压", "Pa", 1, 1e-12, 1e8, [unit("Pa", 1), unit("kPa", 1e3), unit("μPa", 1e-6)]),
        v("rho", "\\rho", "介质密度", "kg/m³", 1025, 900, 1300, [unit("kg/m³", 1), unit("g/cm³", 1000)]),
        v("c", "c", "声速", "m/s", 1500, 1000, 2000, [unit("m/s", 1), unit("km/s", 1000)])
      ],
      output: { name: "平均声强", unit: "W/m²" },
      conditions: ["仅适用于平面行波或远场局部近似。", "近场、驻波场中声压级与声强级不再简单等价。"],
      notes: ["水声常用 ρc≈1.5×10⁶ Rayl，因此 1 Pa RMS 对应约 6.7×10⁻⁷ W/m²。"],
      refs: ["Kinsler et al., Fundamentals of Acoustics, 4th ed."],
      calculate: x => ({ value: x.p * x.p / (x.rho * x.c), details: `p²/(ρc) = ${x.p}²/(${x.rho}×${x.c})` })
    },
    {
      id: "acoustic-impedance", category: "basic", name: "海水特性声阻抗", en: "Characteristic Acoustic Impedance",
      type: "theory", tags: ["声阻抗", "rho c", "Rayl"],
      definition: "均匀流体中平面行波声压与质点振速之比。",
      latex: "Z_0=\\rho c=\\frac{p}{u}",
      variables: [
        v("rho", "\\rho", "密度", "kg/m³", 1025, 900, 1300, [unit("kg/m³", 1), unit("g/cm³", 1000)]),
        v("c", "c", "声速", "m/s", 1500, 1000, 2000, [unit("m/s", 1), unit("km/s", 1000)])
      ],
      output: { name: "特性声阻抗", unit: "Rayl (Pa·s/m)" },
      conditions: ["线性、小振幅、无耗或弱耗平面行波。"],
      notes: ["海水典型值约 1.54 MRayl，随温盐深变化。"],
      refs: ["Kinsler et al., Fundamentals of Acoustics, 4th ed."],
      calculate: x => ({ value: x.rho * x.c, details: `ρc = ${x.rho}×${x.c}` })
    },
    {
      id: "mackenzie-sound-speed", category: "propagation", name: "Mackenzie 海水声速", en: "Mackenzie Sound Speed",
      type: "empirical", tags: ["声速", "温度", "盐度", "深度", "Mackenzie"],
      definition: "基于实测数据拟合的九项海水声速经验式，适合常规海洋环境快速估算。",
      latex: "\\begin{aligned}c=&1448.96+4.591T-5.304\\times10^{-2}T^2+2.374\\times10^{-4}T^3\\\\&+1.340(S-35)+1.630\\times10^{-2}D+1.675\\times10^{-7}D^2\\\\&-1.025\\times10^{-2}T(S-35)-7.139\\times10^{-13}TD^3\\end{aligned}",
      variables: [
        v("T", "T", "温度", "°C", 10, -2, 40, [unit("°C", 1)], "推荐适用范围 2–30 °C。", 0.1),
        v("S", "S", "盐度", "PSU", 35, 0, 45, [unit("PSU", 1), unit("ppt（数值近似）", 1)], "推荐适用范围 25–40 PSU。", 0.1),
        v("D", "D", "深度", "m", 1000, 0, 11000, [unit("m", 1), unit("km", 1000)], "推荐适用范围 0–8000 m。", 10)
      ],
      output: { name: "海水声速", unit: "m/s" },
      conditions: ["原始拟合推荐范围：T=2–30 °C，S=25–40，D=0–8000 m。", "超出拟合域仍可计算，但应视为外推。"],
      notes: ["工程上可用于构造声速剖面；高精度海洋学计算建议采用 TEOS-10。"],
      refs: ["Mackenzie, Nine-term equation for sound speed in the oceans, JASA 70(3), 1981."],
      validate: x => {
        const warnings = [];
        if (x.T < 2 || x.T > 30 || x.S < 25 || x.S > 40 || x.D > 8000) warnings.push("输入超出 Mackenzie 原始拟合推荐范围，结果属于外推。");
        return warnings;
      },
      calculate: x => {
        const { T, S, D } = x;
        const c = 1448.96 + 4.591*T - 5.304e-2*T*T + 2.374e-4*T*T*T + 1.340*(S-35) + 1.630e-2*D + 1.675e-7*D*D - 1.025e-2*T*(S-35) - 7.139e-13*T*D*D*D;
        return { value: c, details: "九项经验式逐项求和" };
      }
    },
    {
      id: "medwin-sound-speed", category: "propagation", name: "Medwin 浅海声速", en: "Medwin Sound Speed",
      type: "empirical", tags: ["声速", "浅海", "Medwin"],
      definition: "面向浅海和中等深度的简化海水声速经验式。",
      latex: "c=1449.2+4.6T-0.055T^2+0.00029T^3+(1.34-0.01T)(S-35)+0.016D",
      variables: [
        v("T", "T", "温度", "°C", 10, 0, 35, [unit("°C", 1)], "适用 0–35 °C。", 0.1),
        v("S", "S", "盐度", "PSU", 35, 0, 45, [unit("PSU", 1)], "适用 0–45 PSU。", 0.1),
        v("D", "D", "深度", "m", 100, 0, 1000, [unit("m", 1), unit("km", 1000)], "适用 0–1000 m。", 10)
      ],
      output: { name: "海水声速", unit: "m/s" },
      conditions: ["适用深度约 0–1000 m；深海计算建议改用 Mackenzie、Del Grosso 或 TEOS-10。"],
      notes: ["与 Mackenzie 并列提供，便于查看不同经验式的适用域差异。"],
      refs: ["Medwin, Speed of sound in water: a simple equation for realistic parameters, JASA 58(6), 1975."],
      calculate: x => ({ value: 1449.2 + 4.6*x.T - 0.055*x.T*x.T + 0.00029*x.T*x.T*x.T + (1.34 - 0.01*x.T)*(x.S-35) + 0.016*x.D, details: "Medwin 六项简化经验式" })
    },
    {
      id: "spreading-loss", category: "propagation", name: "几何扩展传播损失", en: "Geometric Spreading Loss",
      type: "theory", tags: ["TL", "球面扩展", "柱面扩展", "距离"],
      definition: "以 1 m 为参考距离的几何扩展损失，指数 N 可表示球面、实用和柱面扩展。",
      latex: "TL_s=N\\log_{10}\\left(\\frac{r}{1\\,\\mathrm{m}}\\right)",
      variables: [
        v("r", "r", "传播距离", "m", 1000, 1, 1e7, [unit("m", 1), unit("km", 1000), unit("nmi", 1852), unit("kyd", 914.4)], "对数内必须使用无量纲的 r/1 m。"),
        v("N", "N", "扩展系数", "dB/dec", 20, 10, 30, [unit("dB/dec", 1)], "20=球面，10=柱面，15=实用扩展。", 5)
      ],
      output: { name: "几何扩展损失", unit: "dB re 1 m" },
      conditions: ["均匀介质、忽略边界反射与吸收。", "N=15 是工程实用扩展，不是严格理论边界解。"],
      notes: ["总传播损失通常还需叠加吸收、边界反射、散射和异常传播项。"],
      refs: ["Urick, Principles of Underwater Sound, 3rd ed., Ch. 5."],
      calculate: x => ({ value: x.N * safeLog10(x.r), details: `${x.N}log10(${x.r}/1m)` })
    },
    {
      id: "passive-sonar", category: "sonar", name: "被动声呐探测余量", en: "Passive Sonar Margin",
      type: "theory", tags: ["声呐方程", "被动", "SL", "TL", "NL", "DI", "DT"],
      definition: "目标辐射信号经单程传播后，在阵增益和检测门限约束下的探测余量。",
      latex: "M=SL-TL-(NL-DI+DT)",
      variables: [
        v("SL", "SL", "目标源级", "dB re 1 μPa @ 1 m", 140, 0, 260),
        v("TL", "TL", "单程传播损失", "dB", 70, 0, 250),
        v("NL", "NL", "接收噪声级", "dB re 1 μPa", 80, 0, 220, null, "若输入的是谱级，必须先加 10log10(BW)。"),
        v("DI", "DI", "接收指向性指数", "dB", 15, 0, 60),
        v("DT", "DT", "检测阈", "dB", 10, -20, 40)
      ],
      output: { name: "探测余量", unit: "dB" },
      conditions: ["各声级必须使用一致的水声参考基准。", "NL 必须明确是谱级还是带宽内总噪声级。"],
      notes: ["M≥0 表示达到门限；工程设计通常还应留出环境、建模和设备裕量。"],
      refs: ["Urick, Principles of Underwater Sound, 3rd ed., Ch. 2."],
      calculate: x => ({ value: x.SL - x.TL - (x.NL - x.DI + x.DT), details: `SL − TL − NL + DI − DT` })
    },
    {
      id: "active-sonar", category: "sonar", name: "主动声呐探测余量（噪声限制）", en: "Active Sonar Margin",
      type: "theory", tags: ["声呐方程", "主动", "双程", "TS"],
      definition: "单基地主动声呐在噪声限制条件下的探测余量，传播损失为双程。",
      latex: "M=SL-2TL+TS-(NL-DI+DT)",
      variables: [
        v("SL", "SL", "发射源级", "dB re 1 μPa @ 1 m", 210, 0, 260),
        v("TL", "TL", "单程传播损失", "dB", 80, 0, 250),
        v("TS", "TS", "目标强度", "dB re 1 m²", 10, -80, 80),
        v("NL", "NL", "接收噪声级", "dB re 1 μPa", 70, 0, 220),
        v("DI", "DI", "接收指向性指数", "dB", 20, 0, 60),
        v("DT", "DT", "检测阈", "dB", 10, -20, 40)
      ],
      output: { name: "探测余量", unit: "dB" },
      conditions: ["单基地主动声呐、噪声掩蔽；混响限制时应改用 RL+DT。", "必须使用 2TL，不能把单程传播损失漏乘 2。"],
      notes: ["若噪声与混响同时存在，应先按能量相加得到等效背景级，而不是直接取算术和。"],
      refs: ["Urick, Principles of Underwater Sound, 3rd ed., Ch. 2."],
      calculate: x => ({ value: x.SL - 2*x.TL + x.TS - (x.NL - x.DI + x.DT), details: `SL − 2TL + TS − NL + DI − DT` })
    },
    {
      id: "noise-band", category: "noise", name: "噪声谱级转带宽级", en: "Spectral Level to Band Level",
      type: "theory", tags: ["NL", "PSD", "带宽", "噪声谱级"],
      definition: "白噪声或带内谱级近似平坦时，将 1 Hz 归一化谱级积分到给定带宽。",
      latex: "NL_{band}=NL_{1Hz}+10\\log_{10}\\left(\\frac{B}{1\\,\\mathrm{Hz}}\\right)",
      variables: [
        v("NSL", "NL_{1Hz}", "噪声谱级", "dB re 1 μPa²/Hz", 50, -50, 220),
        v("B", "B", "等效噪声带宽", "Hz", 1000, 1e-6, 1e9, [unit("Hz", 1), unit("kHz", 1000), unit("MHz", 1e6)])
      ],
      output: { name: "带宽内噪声级", unit: "dB re 1 μPa" },
      conditions: ["带内谱级近似平坦；若谱形明显变化，应在线性功率域积分。"],
      notes: ["噪声谱级是功率谱密度，带宽项使用 10log10。"],
      refs: ["Urick, Principles of Underwater Sound, 3rd ed., Ch. 7."],
      calculate: x => ({ value: x.NSL + 10*safeLog10(x.B), details: `NSL + 10log10(${x.B}/1Hz)` })
    },
    {
      id: "thermal-noise", category: "noise", name: "海水热噪声谱级", en: "Thermal Noise Spectral Level",
      type: "empirical", tags: ["Wenz", "热噪声", "高频", "谱级"],
      definition: "高频海洋环境噪声中的热噪声近似，频率以 kHz 输入。",
      latex: "N_T=-15+20\\log_{10}(f_{kHz})",
      variables: [v("f", "f", "频率", "kHz", 100, 0.001, 1000, [unit("kHz", 1), unit("Hz", 0.001), unit("MHz", 1000)])],
      output: { name: "热噪声谱级", unit: "dB re 1 μPa²/Hz" },
      conditions: ["主要用于约 50–100 kHz 以上的热噪声主导区域；低频处仅作分量参考。"],
      notes: ["斜率为 +20 dB/dec，即约 +6 dB/oct。"],
      refs: ["Wenz, Acoustic ambient noise in the ocean, JASA 34(12), 1962."],
      calculate: x => ({ value: -15 + 20*safeLog10(x.f), details: `−15 + 20log10(${x.f} kHz)` })
    },
    {
      id: "surface-reverb", category: "reverberation", name: "面混响级基础估算", en: "Surface Reverberation Level",
      type: "theory", tags: ["混响", "RL", "散射强度", "脉宽"],
      definition: "将有效散射面积内的独立散射贡献按能量叠加得到面混响级。",
      latex: "RL_s=SL-2TL+S_s+10\\log_{10}A,\\quad A\\approx\\frac{c\\tau}{2}r\\psi",
      variables: [
        v("SL", "SL", "发射源级", "dB re 1 μPa @ 1 m", 210, 0, 260),
        v("TL", "TL", "单程传播损失", "dB", 70, 0, 250),
        v("Ss", "S_s", "面散射强度", "dB re 1 m²", -30, -80, 10),
        v("c", "c", "声速", "m/s", 1500, 1000, 2000),
        v("tau", "\\tau", "脉宽", "s", 0.01, 1e-6, 100, [unit("s", 1), unit("ms", 0.001), unit("μs", 1e-6)]),
        v("r", "r", "斜距", "m", 5000, 1, 1e7, [unit("m", 1), unit("km", 1000)]),
        v("psi", "\\psi", "等效波束宽", "rad", 0.1, 1e-4, Math.PI, [unit("rad", 1), unit("°", Math.PI/180)])
      ],
      output: { name: "面混响级", unit: "dB re 1 μPa" },
      conditions: ["远场、窄脉冲、均匀散射面近似。", "等效双程波束宽不应直接机械等同于单程 −3 dB 波束宽。"],
      notes: ["海面/海底散射强度模型需根据频率、掠射角和海况/底质另行确定。"],
      refs: ["Urick, Principles of Underwater Sound, 3rd ed., Ch. 8."],
      calculate: x => {
        const area = (x.c*x.tau/2)*x.r*x.psi;
        return { value: x.SL - 2*x.TL + x.Ss + 10*safeLog10(area), details: `有效散射面积 A=${area.toPrecision(5)} m²` };
      }
    },
    {
      id: "rigid-sphere-ts", category: "target", name: "高频刚性球目标强度", en: "Rigid Sphere Target Strength",
      type: "theory", tags: ["TS", "散射截面", "球", "ka"],
      definition: "高频几何散射区（ka≫1）刚性球的单站反向散射目标强度近似。",
      latex: "TS=10\\log_{10}\\left(\\frac{a^2}{4\\,\\mathrm{m}^2}\\right)",
      variables: [
        v("a", "a", "球半径", "m", 0.5, 1e-6, 1e4, [unit("m", 1), unit("cm", 0.01), unit("mm", 0.001)]),
        v("f", "f", "频率（用于 ka 校验）", "Hz", 10000, 1, 1e9, [unit("Hz", 1), unit("kHz", 1000), unit("MHz", 1e6)]),
        v("c", "c", "声速", "m/s", 1500, 1000, 2000)
      ],
      output: { name: "目标强度", unit: "dB re 1 m²" },
      conditions: ["刚性、光滑球；ka≫1 的几何散射区。", "ka<3 时该近似精度不足，ka<1 时应使用瑞利散射模型。"],
      notes: ["目标强度是强度比定义，使用 10log10；不能因为长度平方就改用 20log10。"],
      refs: ["Urick, Principles of Underwater Sound, 3rd ed., Ch. 9."],
      validate: x => {
        const ka = 2*Math.PI*x.f*x.a/x.c;
        return ka < 3 ? [`当前 ka=${ka.toFixed(2)}，不满足高频几何散射条件。`] : [];
      },
      calculate: x => ({ value: 10*safeLog10(x.a*x.a/4), details: `σ_bs=a²/4=${(x.a*x.a/4).toPrecision(5)} m²` })
    },
    {
      id: "source-level-power", category: "transducer", name: "声功率换算声源级", en: "Acoustic Power to Source Level",
      type: "theory", tags: ["SL", "声功率", "效率", "DI", "换能器"],
      definition: "由电输入功率、电声效率、介质阻抗和发射指向性指数估算轴向声源级。",
      latex: "SL=109+10\\log_{10}(\\rho c)+10\\log_{10}(\\eta P_e)+DI",
      variables: [
        v("Pe", "P_e", "电输入功率", "W", 1000, 1e-9, 1e9, [unit("W", 1), unit("kW", 1000)]),
        v("eta", "\\eta", "电声效率", "1", 0.5, 1e-6, 1, [unit("比例", 1), unit("%", 0.01)]),
        v("rho", "\\rho", "介质密度", "kg/m³", 1025, 900, 1300),
        v("c", "c", "声速", "m/s", 1500, 1000, 2000),
        v("DI", "DI", "发射指向性指数", "dB", 10, 0, 60)
      ],
      output: { name: "轴向声源级", unit: "dB re 1 μPa @ 1 m" },
      conditions: ["远场等效点源定义；忽略匹配、线路和波形峰均比等额外损失。", "效率 η 必须使用 0–1 的线性比例。"],
      notes: ["ρc=1.5×10⁶ Rayl 时，1 W 全向声功率约对应 170.8 dB re 1 μPa @1m。"],
      refs: ["Urick, Principles of Underwater Sound, 3rd ed., Ch. 4."],
      calculate: x => {
        const Wa = x.eta*x.Pe;
        return { value: 109 + 10*safeLog10(x.rho*x.c) + 10*safeLog10(Wa) + x.DI, details: `声功率 Wa=ηPe=${Wa.toPrecision(5)} W` };
      }
    },
    {
      id: "hydrophone-voltage", category: "transducer", name: "水听器灵敏度换算输出电压", en: "Hydrophone Sensitivity to Voltage",
      type: "theory", tags: ["灵敏度", "水听器", "M", "电压"],
      definition: "利用接收电压灵敏度（dB re 1 V/μPa）把入射声压换算为开路输出电压。",
      latex: "V=p_{\\mu Pa}\\,10^{M/20}",
      variables: [
        v("p", "p", "入射声压", "μPa", 1e6, 1e-9, 1e15, [unit("μPa", 1), unit("Pa", 1e6)]),
        v("M", "M", "接收电压灵敏度", "dB re 1 V/μPa", -180, -300, -50)
      ],
      output: { name: "开路输出电压", unit: "V" },
      conditions: ["使用开路接收电压灵敏度；接入前置放大器后需考虑负载、增益和频响。"],
      notes: ["M 是幅度比的 dB 表达，线性换算使用 20log 对应的 10^(M/20)。"],
      refs: ["IEC 60565: Underwater acoustics — Hydrophones — Calibration."],
      calculate: x => ({ value: x.p * Math.pow(10, x.M/20), details: `p(μPa)×10^(M/20)` })
    },
    {
      id: "piston-beamwidth", category: "beamforming", name: "圆形活塞 −3 dB 波束宽度", en: "Circular Piston Beamwidth",
      type: "empirical", tags: ["波束宽度", "圆形活塞", "孔径", "指向性"],
      definition: "均匀激励圆形活塞在远场且 D/λ 足够大时的半功率全波束宽度近似。",
      latex: "\\Theta_{-3dB}\\approx58^\\circ\\frac{\\lambda}{D}=58^\\circ\\frac{c}{fD}",
      variables: [
        v("f", "f", "工作频率", "Hz", 30000, 1, 1e9, [unit("Hz", 1), unit("kHz", 1000), unit("MHz", 1e6)]),
        v("D", "D", "活塞直径", "m", 0.5, 1e-6, 1e4, [unit("m", 1), unit("cm", 0.01), unit("mm", 0.001)]),
        v("c", "c", "声速", "m/s", 1500, 1000, 2000)
      ],
      output: { name: "−3 dB 全波束宽", unit: "°" },
      conditions: ["均匀振速分布、刚性无限障板、远场。", "D/λ<1 时近似失效。"],
      notes: ["第一零点全角约为 2asin(1.22λ/D)，其定义与 −3 dB 波束宽不同。"],
      refs: ["Kinsler et al., Fundamentals of Acoustics, 4th ed."],
      validate: x => (x.D/(x.c/x.f) < 1 ? ["D/λ<1，活塞近似不能形成清晰主瓣。"] : []),
      calculate: x => ({ value: 58*x.c/(x.f*x.D), details: `λ=${(x.c/x.f).toPrecision(5)} m, D/λ=${(x.D*x.f/x.c).toFixed(2)}` })
    },
    {
      id: "array-gain", category: "beamforming", name: "理想阵增益", en: "Ideal Array Gain",
      type: "theory", tags: ["阵列", "AG", "阵元数", "白噪声"],
      definition: "独立同分布空间白噪声下，N 个等灵敏度阵元相干叠加的理想阵增益。",
      latex: "AG_{ideal}=10\\log_{10}N",
      variables: [
        v("N", "N", "阵元数", "1", 64, 1, 1e6, [unit("个", 1)], "应输入整数。", 1),
        v("loss", "L", "工程损失", "dB", 2, 0, 60, [unit("dB", 1)], "幅相误差、空间相关和电路损失的合计。")
      ],
      output: { name: "实际阵增益估算", unit: "dB" },
      conditions: ["理想项要求噪声在阵元间不相关、信号完全相干。"],
      notes: ["强相干干扰或扩展噪声场中，实际阵增益可能显著偏离 10log10N。"],
      refs: ["Urick, Principles of Underwater Sound, 3rd ed., Ch. 4."],
      calculate: x => ({ value: 10*safeLog10(Math.max(1, Math.round(x.N))) - x.loss, details: `理想 AG=${(10*safeLog10(Math.max(1, Math.round(x.N)))).toFixed(3)} dB，扣除损失 ${x.loss} dB` })
    },
    {
      id: "grating-lobe-spacing", category: "beamforming", name: "扫描阵列无栅瓣间距", en: "Grating-lobe-free Spacing",
      type: "theory", tags: ["栅瓣", "阵元间距", "扫描角", "线阵"],
      definition: "给定最大扫描角时，均匀线阵在可见区内不出现栅瓣的阵元间距上限。",
      latex: "d_{max}=\\frac{\\lambda}{1+|\\sin\\theta_{max}|}",
      variables: [
        v("f", "f", "最高工作频率", "Hz", 30000, 1, 1e9, [unit("Hz", 1), unit("kHz", 1000)]),
        v("theta", "\\theta_{max}", "最大扫描角", "°", 60, 0, 90),
        v("c", "c", "声速", "m/s", 1500, 1000, 2000)
      ],
      output: { name: "阵元间距上限", unit: "m" },
      conditions: ["一维均匀线阵，扫描角相对阵列法线定义。", "宽带阵列按最高频率校核。"],
      notes: ["全可见区扫描到 ±90° 时退化为 d≤λ/2。"],
      refs: ["Van Trees, Optimum Array Processing."],
      calculate: x => ({ value: (x.c/x.f)/(1+Math.abs(Math.sin(rad(x.theta)))), details: `λ=${(x.c/x.f).toPrecision(5)} m` })
    },
    {
      id: "particle-velocity", category: "vector", name: "平面波质点振速", en: "Plane-wave Particle Velocity",
      type: "theory", tags: ["矢量水听器", "质点振速", "声压", "声强"],
      definition: "远场平面行波中，质点振速幅值与声压幅值通过介质特性阻抗关联。",
      latex: "u=\\frac{p}{\\rho c}",
      variables: [
        v("p", "p", "声压 RMS", "Pa", 1, 1e-12, 1e8, [unit("Pa", 1), unit("μPa", 1e-6)]),
        v("rho", "\\rho", "密度", "kg/m³", 1025, 900, 1300),
        v("c", "c", "声速", "m/s", 1500, 1000, 2000)
      ],
      output: { name: "质点振速 RMS", unit: "m/s" },
      conditions: ["平面行波、远场、声压与质点振速同相。", "近场中应使用复声强并保留相位。"],
      notes: ["矢量水听器方向估计通常由声压与质点振速互谱得到有功声强矢量。"],
      refs: ["Nehorai & Paldi, Acoustic vector-sensor array processing, IEEE TSP, 1994."],
      calculate: x => ({ value: x.p/(x.rho*x.c), details: `p/(ρc)` })
    },
    {
      id: "swath-width", category: "imaging", name: "多波束海底覆盖宽度", en: "Multibeam Swath Width",
      type: "theory", tags: ["多波束", "覆盖宽度", "水深", "开角"],
      definition: "平坦海底、垂直安装条件下，由水深和全覆盖开角估算横向覆盖宽度。",
      latex: "W=2H\\tan\\left(\\frac{\\Theta}{2}\\right)",
      variables: [
        v("H", "H", "水深", "m", 100, 0.01, 12000, [unit("m", 1), unit("km", 1000)]),
        v("theta", "\\Theta", "全覆盖开角", "°", 120, 0.1, 179)
      ],
      output: { name: "理论覆盖宽度", unit: "m" },
      conditions: ["平坦海底、无姿态误差、无折射弯曲、边缘波束可用。"],
      notes: ["实际有效覆盖受声速剖面、底质、噪声、姿态和边缘波束质量限制。"],
      refs: ["Lurton, An Introduction to Underwater Acoustics, 2nd ed."],
      calculate: x => ({ value: 2*x.H*Math.tan(rad(x.theta/2)), details: `2Htan(Θ/2)` })
    },
    {
      id: "range-resolution", category: "imaging", name: "宽带距离分辨率", en: "Range Resolution",
      type: "theory", tags: ["距离分辨率", "带宽", "脉冲压缩", "声呐"],
      definition: "匹配滤波后的理论距离分辨率由有效信号带宽决定。",
      latex: "\\Delta R=\\frac{c}{2B}",
      variables: [
        v("c", "c", "声速", "m/s", 1500, 1000, 2000),
        v("B", "B", "有效带宽", "Hz", 10000, 1e-6, 1e9, [unit("Hz", 1), unit("kHz", 1000), unit("MHz", 1e6)])
      ],
      output: { name: "距离分辨率", unit: "m" },
      conditions: ["宽带脉冲经匹配滤波；B 为有效占用带宽。"],
      notes: ["未压缩矩形脉冲常用 ΔR=cτ/2；两种表达的控制量不同。"],
      refs: ["Burdic, Underwater Acoustic System Analysis, 2nd ed."],
      calculate: x => ({ value: x.c/(2*x.B), details: `c/(2B)` })
    },
    {
      id: "normal-reflection", category: "materials", name: "正入射界面反射损失", en: "Normal-incidence Reflection Loss",
      type: "theory", tags: ["水声材料", "阻抗匹配", "反射系数", "透射"],
      definition: "两种无耗流体介质界面正入射时的压力反射系数和功率反射损失。",
      latex: "R_p=\\frac{Z_2-Z_1}{Z_2+Z_1},\\quad RL=-10\\log_{10}|R_p|^2",
      variables: [
        v("Z1", "Z_1", "介质1声阻抗", "MRayl", 1.54, 1e-9, 1e6, [unit("MRayl", 1), unit("Rayl", 1e-6)]),
        v("Z2", "Z_2", "介质2声阻抗", "MRayl", 3.0, 1e-9, 1e6, [unit("MRayl", 1), unit("Rayl", 1e-6)])
      ],
      output: { name: "功率反射损失", unit: "dB" },
      conditions: ["正入射、平面波、无限平面界面、无耗流体。", "固体介质、斜入射时需考虑纵横波转换和复阻抗。"],
      notes: ["Z1=Z2 时理论上无反射，RL→∞；界面反射功率为 |Rp|²。"],
      refs: ["Brekhovskikh & Lysanov, Fundamentals of Ocean Acoustics."],
      calculate: x => {
        const Rp = (x.Z2-x.Z1)/(x.Z2+x.Z1);
        const power = Rp*Rp;
        if (power === 0) return { value: Infinity, details: "阻抗完全匹配，理论反射损失为无穷大" };
        return { value: -10*safeLog10(power), details: `压力反射系数 Rp=${Rp.toFixed(6)}，功率反射率=${power.toPrecision(5)}` };
      }
    },
    {
      id: "cavitation-number", category: "cavitation", name: "空化数", en: "Cavitation Number",
      type: "theory", tags: ["空化", "空化数", "流速", "蒸汽压"],
      definition: "表征局部静压裕量与流动动压之比的无量纲参数。",
      latex: "\\sigma=\\frac{p_\\infty-p_v}{\\tfrac{1}{2}\\rho V^2}",
      variables: [
        v("pInf", "p_\\infty", "环境绝对压力", "Pa", 201325, 1, 1e9, [unit("Pa", 1), unit("kPa", 1000), unit("MPa", 1e6)]),
        v("pv", "p_v", "水蒸气压", "Pa", 2339, 0, 1e7, [unit("Pa", 1), unit("kPa", 1000)]),
        v("rho", "\\rho", "水密度", "kg/m³", 1025, 500, 2000),
        v("V", "V", "特征流速", "m/s", 10, 1e-9, 1e4, [unit("m/s", 1), unit("kn", 0.514444)])
      ],
      output: { name: "空化数", unit: "1" },
      conditions: ["必须使用绝对压力；蒸汽压随温度变化。", "空化起始临界值依赖几何、粗糙度和气核，不能仅凭统一阈值判断。"],
      notes: ["σ 越小通常越易空化，但工程判定应与具体构型的 σ_i 数据对比。"],
      refs: ["Brennen, Cavitation and Bubble Dynamics."],
      validate: x => x.pInf <= x.pv ? ["环境绝对压力不高于蒸汽压，输入对应强空化/沸腾条件。"] : [],
      calculate: x => ({ value: (x.pInf-x.pv)/(0.5*x.rho*x.V*x.V), details: `(p∞−pv)/(0.5ρV²)` })
    },
    {
      id: "thorp-absorption", category: "attenuation", name: "Thorp 海水吸收系数", en: "Thorp Absorption",
      type: "empirical", tags: ["吸收系数", "Thorp", "频率", "dB/km"],
      definition: "不显式考虑温度、盐度、深度和 pH 的经典快速估算式，频率以 kHz 输入。",
      latex: "\\alpha=\\frac{0.11f^2}{1+f^2}+\\frac{44f^2}{4100+f^2}+2.75\\times10^{-4}f^2+0.003",
      variables: [v("f", "f", "频率", "kHz", 10, 0.001, 1000, [unit("kHz", 1), unit("Hz", 0.001), unit("MHz", 1000)], "约 0.1–10 kHz 最常用。")],
      output: { name: "吸收系数", unit: "dB/km" },
      conditions: ["快速估算式，不反映温盐深和 pH 变化。", "高频或环境敏感计算建议使用 Francois–Garrison。"],
      notes: ["式中 f 单位必须是 kHz；错用 Hz 会导致灾难性的量级错误。"],
      refs: ["Thorp, Analytic description of the low-frequency attenuation coefficient, JASA, 1967."],
      validate: x => x.f > 50 ? ["频率高于 50 kHz，Thorp 简化式误差可能较大。"] : [],
      calculate: x => {
        const f2 = x.f*x.f;
        return { value: 0.11*f2/(1+f2) + 44*f2/(4100+f2) + 2.75e-4*f2 + 0.003, details: "硼酸、硫酸镁与纯水项的简化合成" };
      }
    },
    {
      id: "francois-garrison", category: "attenuation", name: "Francois–Garrison 海水吸收系数", en: "Francois–Garrison Absorption",
      type: "empirical", tags: ["吸收系数", "FG", "温度", "盐度", "pH", "深度"],
      definition: "综合硼酸弛豫、硫酸镁弛豫和纯水粘滞损耗的宽频海水吸收经验模型。",
      latex: "\\alpha=\\frac{A_1P_1f_1f^2}{f_1^2+f^2}+\\frac{A_2P_2f_2f^2}{f_2^2+f^2}+A_3P_3f^2",
      variables: [
        v("f", "f", "频率", "kHz", 10, 0.01, 1000, [unit("kHz", 1), unit("Hz", 0.001), unit("MHz", 1000)]),
        v("T", "T", "温度", "°C", 10, -2, 35, [unit("°C", 1)], "模型分段点为 20 °C。", 0.1),
        v("S", "S", "盐度", "PSU", 35, 0, 45, [unit("PSU", 1)], "开阔海洋常见约 30–37 PSU。", 0.1),
        v("D", "D", "深度", "m", 100, 0, 11000, [unit("m", 1), unit("km", 1000)]),
        v("pH", "pH", "酸碱度", "1", 8.0, 6, 9, [unit("pH", 1)], "海水常见约 7.7–8.3。", 0.01)
      ],
      output: { name: "吸收系数", unit: "dB/km" },
      conditions: ["经验拟合，常用于约 0.1 kHz–1 MHz。", "A1/A2 中声速采用原模型内部的简化声速式。"],
      notes: ["低频对 pH 很敏感，中频受硫酸镁弛豫影响，高频纯水粘滞项占主导。"],
      refs: ["Francois & Garrison, Sound absorption based on ocean measurements, JASA 72(6), 1982, Parts I–II."],
      validate: x => {
        const warnings = [];
        if (x.pH < 7 || x.pH > 8.5) warnings.push("pH 超出常见海水范围，结果属于外推。");
        if (x.D > 8000) warnings.push("深度超过 8000 m，压力修正项的不确定性增大。");
        return warnings;
      },
      calculate: x => {
        const f = x.f, T = x.T, S = x.S, D = x.D, pH = x.pH;
        const theta = T + 273;
        const c = 1412 + 3.21*T + 1.19*S + 0.0167*D;
        const A1 = (8.86/c) * Math.pow(10, 0.78*pH - 5);
        const f1 = 2.8 * Math.sqrt(S/35) * Math.pow(10, 4 - 1245/theta);
        const A2 = 21.44*S/c * (1 + 0.025*T);
        const P2 = 1 - 1.37e-4*D + 6.2e-9*D*D;
        const f2 = 8.17 * Math.pow(10, 8 - 1990/theta) / (1 + 0.0018*(S-35));
        const A3 = T <= 20 ? 4.937e-4 - 2.59e-5*T + 9.11e-7*T*T - 1.5e-8*T*T*T : 3.964e-4 - 1.146e-5*T + 1.45e-7*T*T - 6.5e-10*T*T*T;
        const P3 = 1 - 3.83e-5*D + 4.9e-10*D*D;
        const boric = A1*f1*f*f/(f1*f1+f*f);
        const magnesium = A2*P2*f2*f*f/(f2*f2+f*f);
        const pureWater = A3*P3*f*f;
        return { value: boric + magnesium + pureWater, details: `硼酸=${boric.toPrecision(4)}，MgSO₄=${magnesium.toPrecision(4)}，纯水=${pureWater.toPrecision(4)} dB/km` };
      }
    },
    {
      id: "absorption-distance", category: "attenuation", name: "吸收累积损失", en: "Absorption Loss over Distance",
      type: "theory", tags: ["吸收", "衰减", "距离", "dB/km"],
      definition: "吸收系数沿均匀传播路径的线性距离累积。",
      latex: "TL_{abs}=\\alpha r",
      variables: [
        v("alpha", "\\alpha", "吸收系数", "dB/km", 1, 0, 1e6, [unit("dB/km", 1), unit("dB/m", 1000), unit("dB/kyd", 1.093613)]),
        v("r", "r", "传播距离", "km", 10, 0, 1e6, [unit("km", 1), unit("m", 0.001), unit("nmi", 1.852), unit("kyd", 0.9144)])
      ],
      output: { name: "吸收损失", unit: "dB" },
      conditions: ["沿程环境和吸收系数近似不变；环境变化显著时应分段积分。"],
      notes: ["α 的 dB/km 与距离 km 必须配套；这是常见 1000 倍单位错误来源。"],
      refs: ["Ainslie, Principles of Sonar Performance Modelling, 2010."],
      calculate: x => ({ value: x.alpha*x.r, details: `αr=${x.alpha}×${x.r}` })
    },
    {
      id: "critical-grazing", category: "propagation", name: "流体海底临界掠射角", en: "Critical Grazing Angle",
      type: "theory", tags: ["海底", "临界角", "全反射", "掠射角"],
      definition: "水中声速低于海底流体声速时，界面全反射对应的临界掠射角。",
      latex: "\\theta_c=\\arccos\\left(\\frac{c_w}{c_b}\\right)",
      variables: [
        v("cw", "c_w", "水中声速", "m/s", 1500, 1000, 2000),
        v("cb", "c_b", "海底声速", "m/s", 1700, 500, 6000)
      ],
      output: { name: "临界掠射角", unit: "°" },
      conditions: ["流体—流体平面界面、忽略衰减；要求 cb>cw。"],
      notes: ["若 cb≤cw，则不存在该形式的全反射临界掠射角。"],
      refs: ["Brekhovskikh & Lysanov, Fundamentals of Ocean Acoustics."],
      validate: x => x.cb <= x.cw ? ["海底声速不高于水中声速，不存在本公式定义的临界掠射角。"] : [],
      calculate: x => ({ value: x.cb <= x.cw ? NaN : deg(Math.acos(x.cw/x.cb)), details: `acos(cw/cb)` })
    },
    {
      id: "monostatic-doppler", category: "measurement", name: "单基地窄带多普勒频移", en: "Monostatic Doppler Shift",
      type: "theory", tags: ["多普勒", "速度", "频移", "单基地"],
      definition: "目标径向速度远小于声速时，单基地主动声呐回波的窄带一阶多普勒近似。",
      latex: "\\Delta f\\approx\\frac{2v_r}{c}f_0",
      variables: [
        v("f0", "f_0", "发射频率", "Hz", 30000, 1, 1e9, [unit("Hz", 1), unit("kHz", 1000), unit("MHz", 1e6)]),
        v("vr", "v_r", "径向速度", "m/s", 5, -500, 500, [unit("m/s", 1), unit("kn", 0.514444)], "约定接近为正。"),
        v("c", "c", "声速", "m/s", 1500, 1000, 2000)
      ],
      output: { name: "回波频移", unit: "Hz" },
      conditions: ["窄带、|vr|≪c、单基地、收发平台静止或平台速度已并入 vr。"],
      notes: ["高速或宽带情况下应采用时间尺度伸缩而非固定频移模型。"],
      refs: ["Burdic, Underwater Acoustic System Analysis, 2nd ed."],
      calculate: x => ({ value: 2*x.vr*x.f0/x.c, details: `2vr f0/c` })
    },
    {
      id: "measurement-uncertainty", category: "measurement", name: "独立不确定度合成", en: "Root-sum-square Uncertainty",
      type: "theory", tags: ["测量", "不确定度", "RSS", "校准"],
      definition: "多个相互独立、以同一单位表达的标准不确定度分量的平方和开方。",
      latex: "u_c=\\sqrt{u_1^2+u_2^2+u_3^2+u_4^2}",
      variables: [
        v("u1", "u_1", "校准不确定度", "dB", 0.5, 0, 100),
        v("u2", "u_2", "环境修正不确定度", "dB", 0.8, 0, 100),
        v("u3", "u_3", "重复性不确定度", "dB", 0.4, 0, 100),
        v("u4", "u_4", "仪器不确定度", "dB", 0.3, 0, 100)
      ],
      output: { name: "合成标准不确定度", unit: "dB" },
      conditions: ["各分量应相互独立、均已换算为标准不确定度且使用同一单位。"],
      notes: ["若存在相关性，应加入协方差项；扩展不确定度通常还需乘覆盖因子 k。"],
      refs: ["JCGM 100:2008, Evaluation of measurement data — Guide to the expression of uncertainty in measurement."],
      calculate: x => ({ value: Math.sqrt(x.u1*x.u1+x.u2*x.u2+x.u3*x.u3+x.u4*x.u4), details: "各独立标准不确定度分量 RSS 合成" })
    }
  ];

  const converters = [
    {
      id: "distance", name: "距离", kind: "linear", base: "m",
      units: { "m": 1, "km": 1000, "nmi": 1852, "kyd": 914.4, "yd": 0.9144, "ft": 0.3048, "fathom": 1.8288 }
    },
    {
      id: "frequency", name: "频率", kind: "linear", base: "Hz",
      units: { "Hz": 1, "kHz": 1000, "MHz": 1e6, "GHz": 1e9 }
    },
    {
      id: "time", name: "时间", kind: "linear", base: "s",
      units: { "s": 1, "ms": 1e-3, "μs": 1e-6, "min": 60, "h": 3600 }
    },
    {
      id: "density", name: "密度", kind: "linear", base: "kg/m³",
      units: { "kg/m³": 1, "g/cm³": 1000 }
    },
    {
      id: "impedance", name: "声阻抗", kind: "linear", base: "Rayl",
      units: { "Rayl": 1, "kRayl": 1e3, "MRayl": 1e6, "Pa·s/m": 1 }
    },
    {
      id: "attenuation", name: "吸收系数", kind: "linear", base: "dB/m",
      units: { "dB/m": 1, "dB/km": 1e-3, "dB/kyd": 1/914.4, "Np/m": 8.685889638 }
    },
    {
      id: "pressure-linear", name: "线性声压", kind: "linear", base: "Pa",
      units: { "Pa": 1, "kPa": 1e3, "MPa": 1e6, "μPa": 1e-6, "μbar": 0.1 }
    },
    {
      id: "pressure-db", name: "声压 ↔ 声压级", kind: "pressureDb", base: "Pa",
      units: { "Pa": 1, "μPa": 1e-6, "dB re 1 μPa": "db" }
    },
    {
      id: "power-db", name: "功率比 ↔ dB", kind: "powerDb", base: "ratio",
      units: { "功率比": 1, "dB (10log)": "db" }
    },
    {
      id: "amplitude-db", name: "幅度比 ↔ dB", kind: "amplitudeDb", base: "ratio",
      units: { "幅度比": 1, "dB (20log)": "db" }
    },
    {
      id: "dynamic-range", name: "动态范围", kind: "powerDb", base: "ratio",
      units: { "功率比": 1, "dB": "db" }
    }
  ];

  const constants = [
    { group: "海水参考", name: "水下参考声压", symbol: "p₀", value: 1, unit: "μPa", range: "固定定义", note: "水声声压级基准；不得与空气声学 20 μPa 混用。", source: "ISO 18405" },
    { group: "海水参考", name: "标准海水密度（工程值）", symbol: "ρ₀", value: 1025, unit: "kg/m³", range: "约 1020–1030", note: "实际值随温度、盐度和压力变化。", source: "常用工程参考" },
    { group: "海水参考", name: "海水声速（工程值）", symbol: "c₀", value: 1500, unit: "m/s", range: "约 1400–1570", note: "精确值应按温盐深模型计算。", source: "常用工程参考" },
    { group: "海水参考", name: "海水特性声阻抗", symbol: "ρ₀c₀", value: 1.5375, unit: "MRayl", range: "约 1.45–1.62", note: "按 ρ=1025 kg/m³、c=1500 m/s 计算。", source: "推导值" },
    { group: "海水参考", name: "海水定压比热容", symbol: "cₚ", value: 3990, unit: "J/(kg·K)", range: "约 3850–4100", note: "随温盐压变化，本值仅作工程参考。", source: "海水物性参考" },
    { group: "压电材料典型值", name: "PZT-5H 压电应变常数", symbol: "d₃₃", value: 593, unit: "pC/N", range: "厂商/批次相关", note: "典型值，不可替代具体材料数据手册。", source: "常见材料手册典型值" },
    { group: "压电材料典型值", name: "PZT-5H 压电电压常数", symbol: "g₃₃", value: 19.7, unit: "mV·m/N", range: "厂商/批次相关", note: "典型值；与介电常数和 d₃₃ 一致性需按同一数据表校核。", source: "常见材料手册典型值" },
    { group: "压电材料典型值", name: "PZT-5A 压电应变常数", symbol: "d₃₃", value: 374, unit: "pC/N", range: "厂商/批次相关", note: "典型值，不同极化工艺差异明显。", source: "常见材料手册典型值" },
    { group: "测量", name: "1 海里", symbol: "nmi", value: 1852, unit: "m", range: "固定定义", note: "航海距离换算。", source: "SI accepted unit" },
    { group: "测量", name: "1 千码", symbol: "kyd", value: 914.4, unit: "m", range: "固定定义", note: "历史水声资料常用。", source: "精确定义" }
  ];

  const glossary = [
    { term: "声压级", en: "Sound Pressure Level, SPL", compare: "幅度量，定义为 20log10(p/p₀)。水下参考声压 p₀=1 μPa。", mistake: "易错：把空气声学 20 μPa 基准带入水声，结果相差约 26 dB。" },
    { term: "声强级", en: "Sound Intensity Level, SIL", compare: "功率量，定义为 10log10(I/I₀)。平面行波远场中可与 SPL 数值对应。", mistake: "易错：近场、驻波和强反射环境仍假设 SPL=SIL。" },
    { term: "传播损失 TL", en: "Transmission Loss", compare: "从 1 m 参考距离到接收点的传播衰减总量，可含扩展、吸收、边界与异常传播。", mistake: "易错：把 TL 与吸收系数 α 混为一谈；α 是每单位距离的损失。" },
    { term: "吸收系数 α", en: "Absorption Coefficient", compare: "介质吸收造成的距离衰减率，水声常用 dB/km。", mistake: "易错：公式频率要求 kHz 却输入 Hz；或 α 用 dB/km、距离用 m 直接相乘。" },
    { term: "目标强度 TS", en: "Target Strength", compare: "目标后向散射能力的对数度量，常写 dB re 1 m²。", mistake: "易错：不同文献对散射截面是否含 4π 的约定不同，可能相差约 11 dB。" },
    { term: "源级 SL", en: "Source Level", compare: "以距声源 1 m 的等效远场声压级定义，单位通常 dB re 1 μPa @ 1 m。", mistake: "易错：把实际近场 1 m 测量值不经修正直接当作源级。" },
    { term: "噪声谱级与带宽级", en: "Spectral Level vs Band Level", compare: "谱级按 1 Hz 归一；带宽级是给定带宽内的总噪声。", mistake: "易错：漏加或重复加入 10log10(BW)。" },
    { term: "指向性因子与指向性指数", en: "Directivity Factor / Directivity Index", compare: "指向性因子是线性比值 Q，指向性指数 DI=10log10Q。", mistake: "易错：把波束宽度的角度值直接作为 DI。" },
    { term: "远场与近场", en: "Far Field / Near Field", compare: "远场中波前局部近似平面、角向方向图基本与距离无关；近场包含显著相位和幅度结构。", mistake: "易错：在近场直接套用 1/r、固定方向图或 p=ρcu。" },
    { term: "PSU 与 ppt", en: "Practical Salinity / parts per thousand", compare: "工程数值常近似相同，但 PSU 是实用盐标无量纲值，ppt 是质量分数旧表达。", mistake: "易错：在高精度海洋学计算中把二者视为完全等价定义。" }
  ];

  window.HYDRO_DATA = { categories, formulas, converters, constants, glossary, utils: { safeLog10, deg, rad, fmt } };
})();

/* =============================================================
   formulas.js —— 公式手册：全量公式数据 + 六类检索页面

   全局命名空间：window.DSP.formulas

   数据契约（每条公式）：
     {
       id:    'T-01',        // 编号：B=基础 T=变换 F=滤波 S=谱估计 A=阵列 R=雷达声呐
       cat:   'transform',   // basic | transform | filter | spectrum | array | radar
       name:  '中文名',
       en:    'English Name',
       tex:   'LaTeX',       // 反斜杠在 JS 字符串里必须写成 \\
       plain: '通俗解读',
       vars:  [['$符号$','含义与单位'], ...],
       usage: '适用条件 + 代入步骤 + 单位标定',
       assume:'前提假设',
       fail:  '工程失效场景（真实、具体）',
       tags:  ['关键词'],
       see:   'theory/xxx'   // 关联知识页路由，可省略
     }

   对外接口：
     DSP.formulas.list     全量数组
     DSP.formulas.byCat    按分类索引 { basic:[...], ... }
     DSP.formulas.byId     按编号索引
     DSP.formulas.cats     分类元信息
     DSP.formulas.search(q, opt)  检索
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  /* ============================================================
     一、公式数据
     ============================================================ */
  const F = [

    /* ===================== 基础 basic ===================== */
    {
      id: 'B-01', cat: 'basic',
      name: '奈奎斯特—香农采样定理',
      en: 'Nyquist-Shannon Sampling Theorem',
      tex: 'f_s > 2 f_{\\max} \\quad\\Longleftrightarrow\\quad \\omega_s > 2\\,\\omega_{\\max}',
      plain: '要从样点无失真地恢复原信号，采样率必须大于信号最高频率的两倍。注意是严格大于：取 $f_s = 2 f_{\\max}$ 时，若最高频率恰好落在奈奎斯特边界上，采到的可能全是零点，恢复不出任何东西。',
      vars: [
        ['$f_s$', '采样率（Hz），如音频 48 kHz、水声 100 kHz'],
        ['$f_{\\max}$', '信号最高频率（Hz），必须包含噪声与干扰的带宽'],
        ['$T_s = 1/f_s$', '采样间隔（s）'],
        ['$f_s/2$', '奈奎斯特频率（Hz），折叠轴']
      ],
      usage: '适用条件：带限信号。代入步骤：① 确定带宽上限 $f_{\\max}$（别只看有用信号，噪声和干扰也算）② 取 $f_s > 2 f_{\\max}$，工程上留 20%—30% 余量 ③ 采样前串抗混叠模拟低通，通带截止 $f_{\\max}$、阻带起点 $f_s - f_{\\max}$。单位统一用 Hz。',
      assume: '信号严格带限；采样是理想冲激串；重构用理想 sinc 内插（非因果、无限长）。',
      fail: '真实信号没有一个是严格带限的：矩形脉冲、方波、LFM 都有无限长的频谱尾巴，任何固定 $f_s$ 下都存在残余混叠，只是量级不同。抗混叠滤波器也不是砖墙——用 5 阶巴特沃斯把带外压到 −60 dB，过渡带会吃掉约 30% 的奈奎斯特带宽，等效可用带宽大幅缩水。更要命的是，雷达/声呐里常故意用带通采样（欠采样）让频谱折叠，此时"必须 $f_s > 2 f_{\\max}$"这个判据根本不适用，要改用带通采样的允许区间公式。',
      tags: ['采样', '奈奎斯特', '混叠', '基础'],
      see: 'theory/basic/sampling'
    },
    {
      id: 'B-02', cat: 'basic',
      name: '混叠频率（折叠频率）',
      en: 'Aliased / Folded Frequency',
      tex: 'f_a = \\bigl|\\, f - N f_s \\,\\bigr|,\\qquad N = \\mathrm{round}\\!\\left(\\frac{f}{f_s}\\right)',
      plain: '任何高于 $f_s/2$ 的频率，采样后都会被"折"回 $[0,\\,f_s/2]$ 里，折叠后出现的那个假频率就是 $f_a$。频谱是关于 $f_s/2$ 这面镜子对称复制的。',
      vars: [
        ['$f$', '真实频率（Hz）'],
        ['$f_s$', '采样率（Hz）'],
        ['$f_a$', '折叠后出现在基带里的假频率（Hz）'],
        ['$N$', '折叠次数（非负整数）']
      ],
      usage: '① 算 $f/f_s$ ② 四舍五入取整数 $N$ ③ 相减取绝对值。例：$f_s = 1000$ Hz、$f = 1200$ Hz → $N = 1$ → $f_a = 200$ Hz，即 1.2 kHz 的正弦采样后看起来就是 200 Hz。单位 Hz。',
      assume: '理想均匀采样；采样前未加抗混叠滤波；信号为单频。',
      fail: '工程里最贵的错误就是把混叠当成真目标：被动声呐里螺旋桨轴频若超过 $f_s/2$，折叠后会落进别人的频段，被误判成另一艘船；雷达上则表现为距离或速度假目标。更隐蔽的是混叠分量与真实分量叠在一起只改变幅度和相位，看频谱根本分辨不出来——唯一可靠的办法是在模拟前端就把带外压掉，事后用数字处理救不回来。',
      tags: ['混叠', '采样', '假目标', '雷达', '声呐'],
      see: 'theory/basic/sampling'
    },
    {
      id: 'B-03', cat: 'basic',
      name: '冲激串采样与频谱周期延拓',
      en: 'Impulse-Train Sampling and Spectral Replication',
      tex: 'X_s(\\omega) = \\frac{1}{T_s}\\sum_{k=-\\infty}^{\\infty} X_a\\!\\left(\\omega - k\\,\\omega_s\\right),\\qquad \\omega_s = \\frac{2\\pi}{T_s}',
      plain: '时域乘以冲激串，等价于频域以 $\\omega_s$ 为周期把原频谱复制无穷多份再叠加，整体幅度乘 $1/T_s$。混叠就是相邻两份副本撞在了一起。',
      vars: [
        ['$X_a(\\omega)$', '原连续时间信号的频谱'],
        ['$\\omega_s$', '采样角频率（rad/s）'],
        ['$T_s$', '采样间隔（s），$1/T_s$ 为幅度比例因子'],
        ['$k$', '副本序号（整数）']
      ],
      usage: '画图用法：把基带频谱向左右各复制一份，间隔 $\\omega_s$，幅度乘 $1/T_s$；只要相邻副本不重叠，就能用理想低通把原谱完整取回。单位：rad/s。',
      assume: '理想冲激采样；实际电路是窄脉冲采样加保持。',
      fail: '实际 ADC 不是冲激采样：采样保持有孔径时间和有限带宽，等效于在冲激串之后再串一个零阶保持（见 B-15），会给频谱乘上 $\\mathrm{sinc}(f/f_s)$ 包络，在 $f_s/2$ 处约衰减 3.92 dB。直接用"周期延拓"模型标定幅度，高频端会系统性偏低近 4 dB，宽带信号尤其明显。',
      tags: ['采样', '频谱', '周期延拓'],
      see: 'theory/basic/sampling'
    },
    {
      id: 'B-04', cat: 'basic',
      name: '量化步长与量化噪声功率',
      en: 'Quantization Step and Quantization Noise Power',
      tex: '\\Delta = \\frac{X_{\\mathrm{FS}}}{2^{B}},\\qquad e_q \\in \\Bigl[-\\tfrac{\\Delta}{2},\\ \\tfrac{\\Delta}{2}\\Bigr],\\qquad \\sigma_q^{2} = \\frac{\\Delta^{2}}{12}',
      plain: 'B 位 ADC 把满量程切成 $2^{B}$ 个台阶，台阶宽度就是量化步长 $\\Delta$。舍入误差近似为均匀分布的白噪声，其方差等于 $\\Delta^{2}/12$。',
      vars: [
        ['$\\Delta$', '量化步长（与输入同单位，如 V）'],
        ['$B$', 'ADC 标称位数（bit）'],
        ['$X_{\\mathrm{FS}}$', '满量程峰峰值（V）'],
        ['$\\sigma_q^{2}$', '量化噪声功率（$\\mathrm{V^{2}}$），全带均匀分布']
      ],
      usage: '① 查手册拿到 $B$ 与 $X_{\\mathrm{FS}}$ ② 算 $\\Delta = X_{\\mathrm{FS}}/2^{B}$ ③ 算 $\\sigma_q = \\Delta/\\sqrt{12} \\approx 0.289\\Delta$。例：16 bit、$X_{\\mathrm{FS}} = 2$ V → $\\Delta = 30.5\\ \\mu$V，$\\sigma_q = 8.8\\ \\mu$V。',
      assume: '误差在 $[-\\Delta/2,\\ \\Delta/2]$ 内均匀分布，且与输入信号统计独立（白噪声近似）。',
      fail: '白噪声近似只在输入足够复杂、幅度足够大时成立。若输入是慢变直流或幅度只有几个码字的小正弦，量化误差与输入强相关，能量集中到信号频率的各次谐波上，表现为**谐波失真**而不是宽带噪声——用 $\\Delta^{2}/12$ 估噪声底会严重低估失真。水声前放增益调得太低（怕饱和）时经常踩这个坑，表现为频谱上莫名其妙的一串谐波线。',
      tags: ['量化', 'ADC', '噪声', '谐波失真'],
      see: 'theory/basic/quant'
    },
    {
      id: 'B-05', cat: 'basic',
      name: '理想 ADC 信噪比 6.02B + 1.76',
      en: 'Ideal ADC SQNR',
      tex: '\\mathrm{SQNR_{dB}} = 6.02\\,B + 1.76 + 10\\log_{10}\\!\\left(\\frac{P_{\\mathrm{sig}}}{P_{\\mathrm{FS}}/2}\\right)',
      plain: '每多一位，量化噪声底下降约 6 dB。输入为满量程正弦时，括号项为零，SQNR 就等于 $6.02B + 1.76$ dB。',
      vars: [
        ['$B$', '位数（bit）'],
        ['$P_{\\mathrm{sig}}$', '实际输入信号功率（$\\mathrm{V^{2}}$）'],
        ['$P_{\\mathrm{FS}}$', '满量程正弦功率（$\\mathrm{V^{2}}$）'],
        ['$6.02$', '每位对应的 dB 数，$20\\log_{10}2$'],
        ['$1.76$', '正弦峰值因数 3 dB 与均匀噪声修正的合并常数']
      ],
      usage: '① 查位数 ② 若是满量程正弦直接代 $6.02B+1.76$ ③ 否则加 $10\\log_{10}$ 的"相对满量程电平"修正（通常为负）。例：16 bit 满量程 → 98.1 dB；若只用到 −12 dBFS → 86.1 dB。单位 dBFS。',
      assume: '输入为满量程正弦；量化误差白、均匀、与信号无关；无孔径抖动与非线性。',
      fail: '手册上那个 $6.02B+1.76$ 是理论天花板，实测必须用 ENOB（见 B-12）。最典型的失效是**时钟抖动**：抖动标准差 $\\sigma_t$ 给出的 SNR 上限约为 $-20\\log_{10}(2\\pi f_{\\mathrm{in}}\\sigma_t)$，100 kHz 输入配 1 ps 抖动只有约 64 dB，此时再加位数毫无意义，钱花在时钟上才有效。此外 ADC 的积分非线性（INL）会产生与信号相关的杂散，直接吃掉 SFDR。',
      tags: ['量化', 'ADC', '信噪比', 'ENOB'],
      see: 'theory/basic/quant'
    },
    {
      id: 'B-06', cat: 'basic',
      name: '过采样信噪比增益',
      en: 'Oversampling SNR Gain',
      tex: '\\Delta\\mathrm{SNR} = 10\\log_{10}(\\mathrm{OSR}),\\qquad \\mathrm{OSR} = \\frac{f_s}{2 f_{\\max}}',
      plain: '量化噪声的总功率是固定的，均匀铺在 $[0,\\,f_s/2]$ 上。把采样率提高 OSR 倍、再用数字低通把带外滤掉并抽取，带内噪声就只剩 1/OSR。**每 4 倍过采样换 6 dB，等价于多 1 位。**',
      vars: [
        ['$\\mathrm{OSR}$', '过采样率（无量纲），如 64、128、256'],
        ['$f_s$', '实际采样率（Hz）'],
        ['$f_{\\max}$', '有用信号带宽上限（Hz）'],
        ['$\\Delta\\mathrm{SNR}$', '带内信噪比改善量（dB）']
      ],
      usage: '① 算 $\\mathrm{OSR} = f_s/(2 f_{\\max})$ ② 取 $10\\log_{10}$。例：$f_{\\max} = 20$ kHz、$f_s = 6.144$ MHz（128 倍）→ 改善约 21 dB，约合 3.5 bit。单位 dB。',
      assume: '量化噪声为白噪声且在 $[0,\\,f_s/2]$ 内均匀分布；抽取用的数字滤波器接近理想。',
      fail: '白噪声假设一破坏（见 B-04，小信号时误差与输入相关），过采样就换不来 SNR——采样再快，谐波还是那几根。另外 $\\Delta\\Sigma$ 调制器靠噪声整形把斜率从 3 dB/倍频程提到 $(6L+3)$ dB/倍频程（$L$ 为环路阶数），但高阶环路在输入接近满量程时会**过载自激**，工程上必须回退输入电平 3—6 dB，把理论增益又吐回去一部分。',
      tags: ['过采样', '量化', '信噪比', '抽取'],
      see: 'theory/basic/quant'
    },
    {
      id: 'B-07', cat: 'basic',
      name: '信噪比与分贝定义',
      en: 'Signal-to-Noise Ratio and Decibel',
      tex: '\\mathrm{SNR_{dB}} = 10\\log_{10}\\!\\left(\\frac{P_{\\mathrm{sig}}}{P_{\\mathrm{noise}}}\\right) = 20\\log_{10}\\!\\left(\\frac{A_{\\mathrm{sig}}}{A_{\\mathrm{noise}}}\\right)',
      plain: 'SNR 是信号功率与噪声功率之比。取对数后**功率比乘 10、幅度比乘 20**，这是最容易记反的一条规则。',
      vars: [
        ['$P_{\\mathrm{sig}}$', '信号功率（W 或 $\\mathrm{V^{2}}$）'],
        ['$P_{\\mathrm{noise}}$', '噪声功率（同单位、同带宽）'],
        ['$A_{\\mathrm{sig}},\\,A_{\\mathrm{noise}}$', '信号与噪声的幅度（V 或 Pa）']
      ],
      usage: '① 保证分子分母在**同一带宽、同一点**测量 ② 用功率就乘 10、用幅度就乘 20。例：噪声底比信号低 100 倍功率 → SNR = 20 dB。单位 dB。',
      assume: '功率可加；噪声与信号统计独立；测量带宽明确。',
      fail: '三个高频翻车点：① 拿幅度比去乘 10（或功率比乘 20），凭空差出一倍 dB 数；② 分子分母带宽不一致——用 1 Hz 噪声谱级去比整个奈奎斯特带的信号功率，SNR 会虚高几十 dB，这是声呐链路预算最常见的错误；③ 把 SINR 当 SNR，干扰没计进去，实际检测性能远低于仿真。写报告时务必注明是"带内 SNR"还是"宽带 SNR"。',
      tags: ['信噪比', '分贝', 'dB', '基础'],
      see: 'theory/basic/snr'
    },
    {
      id: 'B-08', cat: 'basic',
      name: '热噪声功率 kTB 与噪声谱级',
      en: 'Thermal Noise Power and Noise Spectrum Level',
      tex: 'P_n = k\\,T\\,B,\\qquad N_0 = kT,\\qquad \\mathrm{NL} = 10\\log_{10}\\!\\left(\\frac{N_0}{1\\ \\mu\\mathrm{Pa}^{2}/\\mathrm{Hz}}\\right)\\ \\mathrm{dB}',
      plain: '电阻热噪声功率正比于绝对温度与带宽，比例系数是玻尔兹曼常数。电域习惯用 dBm/Hz，声学域用"谱级"，基准是 1 μPa²/Hz。',
      vars: [
        ['$k$', '玻尔兹曼常数 $1.38\\times10^{-23}$ J/K'],
        ['$T$', '绝对温度（K），常温取 290 K'],
        ['$B$', '噪声等效带宽（Hz，注意不是 −3 dB 带宽）'],
        ['$kT$', '常温下约 $4.0\\times10^{-21}$ W/Hz，即 −174 dBm/Hz'],
        ['$\\mathrm{NL}$', '噪声谱级（dB re 1 μPa²/Hz）']
      ],
      usage: '① 用 −174 dBm/Hz 作起点 ② 加上 $10\\log_{10}B$（$B$ 取 ENBW）③ 再加噪声系数 NF。例：$B = 1$ MHz、NF = 3 dB → 噪声功率 = −174 + 60 + 3 = −111 dBm。单位 dBm 或 dB re 1 μPa²/Hz。',
      assume: '噪声为白高斯；带宽取等效噪声带宽；系统温度均匀。',
      fail: '最大的坑是"带宽"取错：滤波器手册上的截止频率不是 ENBW，切比雪夫或凯泽窗的 ENBW 可能是 −3 dB 带宽的 1.1—1.5 倍，直接代入会低估噪声几 dB。声学里还常把"谱级"和"频带级"混为一谈，两者相差 $10\\log_{10}B$，1 kHz 带宽就是 30 dB，差一个就全错。海洋环境噪声还随海况按 Knudsen 谱变化，用单一数值做链路预算偏十几 dB 很正常。',
      tags: ['噪声', 'kTB', '谱级', '声呐'],
      see: 'theory/basic/snr'
    },
    {
      id: 'B-09', cat: 'basic',
      name: '噪声系数与级联 Friis 公式',
      en: 'Noise Figure and Friis Cascade Formula',
      tex: 'F = F_1 + \\frac{F_2-1}{G_1} + \\frac{F_3-1}{G_1 G_2} + \\cdots,\\qquad \\mathrm{NF} = 10\\log_{10} F',
      plain: '多级链路的总噪声系数几乎由第一级决定，因为后面各级的噪声都要除以前面的增益才折算到输入端。所以第一级要"低噪声 + 高增益"。',
      vars: [
        ['$F_i$', '第 i 级噪声系数（**线性值**，不是 dB）'],
        ['$G_i$', '第 i 级功率增益（线性值）'],
        ['$\\mathrm{NF}$', '总噪声系数（dB）']
      ],
      usage: '① 把所有 dB 值换成线性值 ② 逐级累加 ③ 结果再取 $10\\log_{10}$。单位 dB。',
      assume: '各级阻抗匹配；源阻抗等于参考阻抗（通常 50 Ω）；各级噪声带宽相同。',
      fail: '公式隐含"各级噪声带宽相同"这一条。若第一级之后有窄带滤波器，后级噪声其实被滤掉了，Friis 公式会**高估**总噪声（保守，可接受）；但若前级增益很低（如水声换能器直接拖长电缆、或加了无源衰减器/限幅器），第二项就不能忽略，漏掉它会低估噪声系数好几 dB，实测灵敏度对不上。另外混频器会同时把镜像频段噪声搬下来，双边带噪声系数比手册标的值高 3 dB，做接收机预算时必须补上。',
      tags: ['噪声系数', 'Friis', '接收机', '射频'],
      see: 'theory/basic/snr'
    },
    {
      id: 'B-10', cat: 'basic',
      name: '处理增益 10log(BT)',
      en: 'Processing Gain',
      tex: 'G_p = 10\\log_{10}(B\\,T)\\ \\mathrm{dB},\\qquad B\\,T = \\frac{\\text{信号带宽}}{\\text{带宽为 }1/T\\text{ 的噪声带宽}}',
      plain: '匹配滤波或相参积累时，信号是**相干**叠加（幅度相加、功率按 $N^{2}$ 涨），噪声是**非相干**叠加（功率只按 $N$ 涨），于是输出 SNR 相对输入提升 $BT$ 倍。$BT$ 就是时间带宽积。',
      vars: [
        ['$B$', '信号带宽（Hz）'],
        ['$T$', '信号持续时间 / 积累时间（s）'],
        ['$G_p$', '处理增益（dB）']
      ],
      usage: '① 算 $BT$ ② 取 $10\\log_{10}$。例：LFM 脉宽 100 ms、带宽 2 kHz → $BT = 200$ → 23 dB；若输入 SNR = −10 dB，输出约 13 dB，足以检测。单位 dB。',
      assume: '信号波形完全已知（相参）；噪声为白噪声；无多普勒失配；通道幅相在积累时间内稳定。',
      fail: '多普勒会让匹配滤波器**失配**：LFM 的距离—多普勒耦合使压缩增益随频移下降，目标速度大时可能损失十几 dB，必须用多普勒补偿组（多路并联匹配滤波）覆盖速度域。水声信道时变、平台晃动会让回波在积累时间内相位漂移，相参积累达不到 $BT$，甚至越积累越差（这时改用非相参积累，但会有积累损失）。宽带信号的 $BT$ 很大但对多途扩展极敏感，实测增益常比理论低 5—10 dB。',
      tags: ['处理增益', '匹配滤波', '时间带宽积', '雷达', '声呐'],
      see: 'theory/random/matched'
    },
    {
      id: 'B-11', cat: 'basic',
      name: '动态范围与满量程余量',
      en: 'Dynamic Range and Full-Scale Margin',
      tex: 'DR_{\\mathrm{FS}} = 6.02\\,B + 1.76\\ \\mathrm{dB},\\qquad DR_{\\mathrm{inst}} = 6.02\\,(B-1) + 20\\log_{10}\\!\\left(\\frac{A_{\\mathrm{FS}}}{A_{\\min}}\\right)',
      plain: '动态范围是系统能同时处理的最强与最弱信号之比。注意它至少有两种口径：满量程比噪底（理论上限）、以及"最强不失真"与"最弱可分辨"之比。',
      vars: [
        ['$A_{\\mathrm{FS}}$', '满量程幅度（V 或 Pa）'],
        ['$A_{\\min}$', '最小可分辨幅度，通常取 1 LSB 或噪底'],
        ['$B$', 'ADC 位数（bit）']
      ],
      usage: '① 确定最强信号（含混响、近场强回波）② 确定最弱信号（检测门限）③ 取 $20\\log_{10}$ 比值 ④ 与 ADC 的 $6.02B+1.76$ 比较，留出至少 6—10 dB 余量防削波。单位 dB。',
      assume: '系统线性；噪声为白高斯；增益不随时间漂移。',
      fail: '"动态范围"至少有四种口径：满量程比噪底、瞬时动态范围、无杂散动态范围（SFDR）、自动增益控制下的可用范围。不注明口径的两个数字根本没法比，系统联调时经常因此扯皮。更实际的坑是：主动声呐近场混响可能比远场目标回波强 60—80 dB，若按远场目标定增益，发射后放大器直接饱和，整段数据报废——必须上时间增益控制（TVC/TVG）。',
      tags: ['动态范围', 'ADC', '增益控制', '声呐'],
      see: 'theory/basic/snr'
    },
    {
      id: 'B-12', cat: 'basic',
      name: '有效位数 ENOB',
      en: 'Effective Number of Bits',
      tex: '\\mathrm{ENOB} = \\frac{\\mathrm{SINAD} - 1.76}{6.02},\\qquad \\mathrm{SINAD} = -10\\log_{10}\\!\\left(\\frac{P_{\\mathrm{noise}} + P_{\\mathrm{dist}}}{P_{\\mathrm{sig}}}\\right)',
      plain: 'ENOB 是"把实测信纳比反解出来的等效位数"，比标称位数诚实得多。它把噪声、谐波失真、抖动、非线性全算进去了。',
      vars: [
        ['$\\mathrm{SINAD}$', '信纳比（信号与噪声加失真之比，dB）'],
        ['$\\mathrm{ENOB}$', '有效位数（bit）'],
        ['$P_{\\mathrm{dist}}$', '各次谐波与杂散的总功率（$\\mathrm{V^{2}}$）']
      ],
      usage: '① 输入满量程正弦，加窗做 FFT ② 去掉直流与基波后，把所有其余谱线能量加起来当噪声加失真 ③ 算 SINAD ④ 反解 ENOB。单位 bit。',
      assume: '输入为满量程正弦；失真计入"噪声"；测试在单一采样率与单一频率下进行。',
      fail: 'ENOB 随输入频率升高单调下降（孔径抖动与前端压摆率限制），只在某一个频点测出来的值不能外推到全频带——这是 ADC 手册只给一个典型值的原因，看曲线比看数字靠谱。另外测试时的信号源谐波、时钟杂散会混进 SINAD，测出来"ADC 不好"其实是信号源不好；用窄带带通滤波器净化输入是必做的一步。',
      tags: ['ENOB', 'ADC', '失真', '信噪比'],
      see: 'theory/basic/quant'
    },
    {
      id: 'B-13', cat: 'basic',
      name: '无杂散动态范围 SFDR',
      en: 'Spurious-Free Dynamic Range',
      tex: '\\mathrm{SFDR} = 10\\log_{10}\\!\\left(\\frac{P_{\\mathrm{sig}}}{P_{\\mathrm{spur,max}}}\\right)\\ \\mathrm{dBc}',
      plain: 'SFDR 衡量的是"最坏情况"下的干净程度：信号与频谱中**最大那根杂散**（谐波或互调产物）之比，而不是与总噪声之比。',
      vars: [
        ['$P_{\\mathrm{sig}}$', '基波功率（$\\mathrm{V^{2}}$）'],
        ['$P_{\\mathrm{spur,max}}$', '除直流与基波外最高的那根谱线功率'],
        ['dBc', '相对载波的 dB；若对满量程则称 dBFS']
      ],
      usage: '① 相干采样后加窗做 FFT ② 定位基波 ③ 找除直流与基波外最高的谱线（远端杂散）④ 取 $10\\log_{10}$。近端 SFDR 需限定一个频偏窗口。单位 dBc 或 dBFS。',
      assume: '频谱中能明确区分信号与杂散；加窗后杂散不被窗旁瓣掩盖；采样相干。',
      fail: '加窗会掩盖近端杂散：矩形窗旁瓣只有 −13 dB，换布莱克曼窗后旁瓣降到 −58 dB，近端小杂散直接被窗旁瓣吞掉，SFDR 看起来"变好"其实是假象。另外非相干采样时能量泄漏到别的 bin，测出的 SFDR 会随机波动 5—10 dB，不同人测同一块板子得出不同结论极常见——必须固定窗型、固定相干采样，结果才可比。',
      tags: ['SFDR', '杂散', 'ADC', '失真'],
      see: 'theory/basic/snr'
    },
    {
      id: 'B-14', cat: 'basic',
      name: '等效噪声带宽 ENBW',
      en: 'Equivalent Noise Bandwidth',
      tex: '\\mathrm{ENBW} = \\frac{f_s}{N}\\cdot\\frac{\\sum_{n=0}^{N-1} w^{2}[n]}{\\left(\\sum_{n=0}^{N-1} w[n]\\right)^{2}} \\quad(\\text{bin}),\\qquad \\mathrm{ENBW} = \\frac{\\int |W(f)|^{2} df}{|W(0)|^{2}}\\quad(\\text{Hz})',
      plain: '一个窗（或滤波器）让白噪声通过的能力，折合成"理想矩形窗的等效宽度"。换窗后噪声底会跟着 ENBW 变，做功率谱必须按它归一化，否则电平对不上。',
      vars: [
        ['$w[n]$', '窗序列（无量纲）'],
        ['$f_s/N$', '一个 bin 的宽度（Hz）'],
        ['$\\mathrm{ENBW}$（bin）', '典型值：矩形 1.00、汉宁 1.50、汉明 1.36、布莱克曼 1.73、凯泽 β=8 约 1.87'],
        ['$\\mathrm{ENBW}$（Hz）', '上式 bin 值乘 $f_s/N$']
      ],
      usage: '① 算窗的能量和 $\\sum w^{2}$ 与幅度和 $\\sum w$ ② 代入求 bin 值 ③ 乘 $f_s/N$ 得 Hz ④ 功率谱除以 ENBW 完成噪声归一化。单位 bin 或 Hz。',
      assume: '输入为白噪声；窗为实序列（对任意实窗公式成立，不要求非负）。',
      fail: '做功率谱估计时**必须**用 ENBW 归一化，否则换窗后噪声底会跳 1—3 dB，不同窗测出的绝对声压级对不上，水声计量标定直接不合格。反过来，测正弦线谱幅度时要用相干增益 $\\sum w[n]/N$ 归一化，是另一个系数——把 ENBW 用到正弦幅度标定上是常见错误，会差出几 dB。还要注意：DFT 的 bin 数与实际分辨率不同，ENBW 才是噪声带宽口径。',
      tags: ['ENBW', '窗函数', '功率谱', '标定'],
      see: 'theory/basic/window'
    },
    {
      id: 'B-15', cat: 'basic',
      name: '零阶保持（ZOH）频响与孔径损失',
      en: 'Zero-Order Hold Frequency Response',
      tex: 'H_{\\mathrm{ZOH}}(f) = \\mathrm{sinc}\\!\\left(\\frac{f}{f_s}\\right)\\,e^{-j\\pi f/f_s},\\qquad \\mathrm{sinc}(x)=\\frac{\\sin(\\pi x)}{\\pi x}',
      plain: 'DAC 把每个样本保持整整一个采样周期，等效于先做冲激重建、再过一个宽度 $T_s$ 的矩形脉冲。频谱因此被 sinc 包络加权，并带来半个样本的群延迟。',
      vars: [
        ['$f_s$', '采样率（Hz）'],
        ['$f$', '模拟频率（Hz）'],
        ['$H_{\\mathrm{ZOH}}(f_s/2)$', '幅度为 $\\mathrm{sinc}(0.5)=0.637$，即 **−3.92 dB**'],
        ['$\\pi f/f_s$', '相位项，对应 $T_s/2$ 的延迟']
      ],
      usage: '① 算目标频率处的 $\\mathrm{sinc}(f/f_s)$ ② 若要求带内平坦，在数字域预加重 $1/\\mathrm{sinc}(f/f_s)$（FIR 补偿器）或在 DAC 后加模拟均衡 ③ 群延迟按 $T_s/2$ 计入系统时延。单位：无量纲幅度与 rad 相位。',
      assume: '理想矩形保持脉冲；后级无重建滤波器；$\\mathrm{sinc}$ 定义为 $\\sin(\\pi x)/(\\pi x)$。',
      fail: '高频端 −3.92 dB 的滚降经常被忽略，导致宽带信号（尤其是 LFM 发射波形）频谱被"整形"：脉压旁瓣抬高、距离分辨率变差、主瓣展宽。做发射预失真补偿时若只按中心频率补一点，带两端仍残留 ±1 dB 幅度误差，对 40 dB 动态范围的脉压系统来说已经不可接受。此外多数 DAC 在 $\\sin(x)/x$ 之外还有输出缓冲与重建滤波器的额外滚降，必须按**实测**频响补偿，不能只套理论公式。',
      tags: ['DAC', '零阶保持', '孔径损失', '预失真'],
      see: 'theory/basic/quant'
    },

    /* ===================== 变换 transform ===================== */
    {
      id: 'T-01', cat: 'transform',
      name: '离散傅里叶变换 DFT',
      en: 'Discrete Fourier Transform',
      tex: 'X[k] = \\sum_{n=0}^{N-1} x[n]\\,e^{-j2\\pi kn/N},\\qquad k = 0,1,\\dots,N-1',
      plain: '把长度 $N$ 的序列投影到 $N$ 个等间隔的复正弦基上，$X[k]$ 就是第 $k$ 个基的"含量"，是一个复数，同时携带幅度与相位。',
      vars: [
        ['$x[n]$', '输入序列，$n = 0,\\dots,N-1$'],
        ['$X[k]$', '第 $k$ 个频点的复谱值'],
        ['$N$', '变换长度，决定频率分辨率 $f_s/N$'],
        ['$k$', '频点序号，对应真实频率 $f_k = k f_s/N$']
      ],
      usage: '适用条件：有限长序列（DFT 隐含周期延拓）。代入步骤：① 取 $N$ 点数据 ② 可选加窗抑制泄漏 ③ 算 $X[k]$ ④ 取 $|X[k]|$ 或 $20\\log_{10}$。单位与标定：看幅度用 $2|X[k]|/N$（单边谱，除直流与奈奎斯特点）；看功率谱密度用 $|X[k]|^{2}/(f_s \\cdot \\mathrm{ENBW})$，并注意单边谱要把非直流、非奈奎斯特的 bin 乘 2。',
      assume: '序列在 DFT 长度上隐含周期延拓；信号平稳；采样满足奈奎斯特。',
      fail: '工程上"隐含周期性"几乎从不成立：非整数周期截断时波形首尾不连续，能量泄漏到全部频点（见 T-10）。加窗能压旁瓣但会加宽主瓣并改变噪声带宽，必须按 ENBW 修正电平（见 B-14）。另外 DFT 输出的是"频率采样"而非连续频谱，落在两个 bin 之间的信号幅度会被低估最多 3.92 dB（扇贝损失），功率估计也会偏。',
      tags: ['DFT', 'FFT', '频谱', '雷达', '声呐'],
      see: 'theory/transform/dft'
    },
    {
      id: 'T-02', cat: 'transform',
      name: '离散傅里叶逆变换 IDFT',
      en: 'Inverse Discrete Fourier Transform',
      tex: 'x[n] = \\frac{1}{N}\\sum_{k=0}^{N-1} X[k]\\,e^{j2\\pi kn/N},\\qquad n = 0,1,\\dots,N-1',
      plain: '把 $N$ 个复谱值重新合成回时域序列。注意归一化系数 $1/N$ 全放在正变换还是逆变换，各软件约定不同，这是幅度标定出错的头号原因。',
      vars: [
        ['$X[k]$', '频域复谱'],
        ['$x[n]$', '重建的时域序列'],
        ['$1/N$', '归一化因子，本书约定放在逆变换']
      ],
      usage: '① 确认所用库的归一化约定（NumPy 的 `numpy.fft` 把 $1/N$ 放在逆变换；MATLAB 同）② 直接调用库函数 ③ 若自己实现，注意正逆变换的指数符号相反。单位：与输入一致。',
      assume: '正逆变换使用一致的归一化约定；$X[k]$ 来自同一长度 $N$ 的 DFT。',
      fail: '跨语言/跨库搬代码时最常翻车：把 Python 的 FFT 结果直接拿去和 C 语言自写 FFT 比幅度，差一个 $N$ 或 $\\sqrt{N}$ 因子。另一个坑是只做正变换做"频谱分析"却忘了补零会改变密度口径——补零只加密栅格、不提高真实分辨率，但会改变每个 bin 代表的带宽，做 PSD 时必须同步修正。',
      tags: ['IDFT', 'DFT', '频谱'],
      see: 'theory/transform/dft'
    },
    {
      id: 'T-03', cat: 'transform',
      name: '旋转因子及其性质',
      en: 'Twiddle Factor',
      tex: 'W_N = e^{-j2\\pi/N},\\qquad W_N^{kn} = W_N^{(kn \\bmod N)},\\qquad W_N^{N/2} = -1',
      plain: '旋转因子就是单位圆上等分的那个复数。它的周期性（模 $N$）与半周期取反（$W_N^{N/2}=-1$）正是 FFT 蝶形运算能省计算量的全部依据。',
      vars: [
        ['$W_N$', '旋转因子，模为 1、幅角 $-2\\pi/N$'],
        ['$N$', '变换长度'],
        ['$k,\\,n$', '频点与样点序号']
      ],
      usage: '① 手写 FFT 时用 $W_N^{kn}$ 的周期性把指数范围压到 $[0,\\,N-1]$ ② 用对称性 $W_N^{k+N/2} = -W_N^{k}$ 让一个蝶形只算一次复乘 ③ 用查表法预存 $W_N^{k}$ 避免重复调用三角函数。',
      assume: '$N$ 通常取 2 的整数次幂（基 2 FFT）；运算为复数。',
      fail: '直接用 `pow(exp(...), kn)` 逐点算旋转因子会在 $N$ 大时累积相位误差，并且慢一到两个数量级；正确做法是递推或查表。另一个隐蔽 bug 是正变换与逆变换的旋转因子共轭关系搞反，结果频谱左右翻转——对实信号而言看幅度看不出来，但做复数解调、波束形成时会得到镜像方位。',
      tags: ['FFT', '旋转因子', '蝶形运算'],
      see: 'theory/transform/fft'
    },
    {
      id: 'T-04', cat: 'transform',
      name: 'DFT 是对 DTFT 的等间隔采样',
      en: 'DFT as Sampled DTFT',
      tex: 'X[k] = X(e^{j\\omega})\\Big|_{\\omega = 2\\pi k/N},\\qquad \\Delta\\omega = \\frac{2\\pi}{N},\\quad \\Delta f = \\frac{f_s}{N}',
      plain: '连续频谱 $X(e^{j\\omega})$ 在一周之内被均匀取 $N$ 个点，就是 DFT。所以 DFT 看到的永远是"纱窗后面的频谱"，纱窗的孔距就是 $f_s/N$。',
      vars: [
        ['$X(e^{j\\omega})$', 'DTFT 连续频谱'],
        ['$\\Delta f$', '频率采样间隔（Hz），等于 $f_s/N$'],
        ['$N$', '变换长度'],
        ['$f_s$', '采样率（Hz）']
      ],
      usage: '① 想提高**真实**分辨率就要增加**有效数据长度**（不是补零）② 补零只加密栅格，减轻栅栏效应、便于找峰，但不增加信息。单位 Hz。',
      assume: '序列有限长；DTFT 存在。',
      fail: '"补零提高分辨率"是最普遍的误解：在 1 ms 数据后补到 8192 点，看起来谱线很密，但两个相隔 300 Hz 的谱峰照样分不开，因为决定分辨率的是 1 ms 的窗长（约 1 kHz）。补零还会让人误判噪声带宽：bin 宽度变窄了，如果 PSD 归一化系数没同步改，功率会差一个比例因子。',
      tags: ['DFT', 'DTFT', '分辨率', '补零'],
      see: 'theory/transform/dft'
    },
    {
      id: 'T-05', cat: 'transform',
      name: '离散时间傅里叶变换 DTFT',
      en: 'Discrete-Time Fourier Transform',
      tex: 'X(e^{j\\omega}) = \\sum_{n=-\\infty}^{\\infty} x[n]\\,e^{-j\\omega n},\\qquad X(e^{j(\\omega+2\\pi)}) = X(e^{j\\omega})',
      plain: 'DTFT 给出连续、以 $2\\pi$ 为周期的频谱。它是理解采样、混叠、滤波器频率响应的理论工具，但因为无限长，工程上必须用 DFT 近似。',
      vars: [
        ['$x[n]$', '离散时间序列，可无限长'],
        ['$\\omega$', '归一化角频率（rad/样本），真实频率 $f = \\omega f_s/(2\\pi)$'],
        ['$2\\pi$ 周期性', '离散时间频谱的固有周期']
      ],
      usage: '① 求频谱时先看序列是否绝对可和（保证收敛）② 工程上取有限长截断 + 窗，用 DFT 数值计算 ③ 读数时记得换算回 Hz。单位：rad/样本。',
      assume: '序列绝对可和或平方可和；否则频谱含 $\\delta$ 冲激（如周期信号）。',
      fail: '对功率信号（周期正弦、平稳噪声）DTFT 不按普通函数收敛，频谱里含冲激，直接"画频谱"会得不到正确结果，必须改用功率谱密度（维纳—辛钦，见 S-08）。另一个坑是只画 $[0,\\,\\pi]$ 就以为看全了：离散频谱是周期的，负频率部分对实信号是共轭对称，但做复数解调时丢掉负频率就丢失了相位信息。',
      tags: ['DTFT', '频谱', '离散时间'],
      see: 'theory/transform/dtft'
    },
    {
      id: 'T-06', cat: 'transform',
      name: 'DTFT 逆变换',
      en: 'Inverse DTFT',
      tex: 'x[n] = \\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi} X(e^{j\\omega})\\,e^{j\\omega n}\\,d\\omega',
      plain: '把连续频谱在一个 $2\\pi$ 周期内积分回来，得到原序列。积分只取一个周期，因为频谱是周期的。',
      vars: [
        ['$X(e^{j\\omega})$', 'DTFT 频谱'],
        ['$x[n]$', '重建序列'],
        ['$1/(2\\pi)$', '归一化因子']
      ],
      usage: '① 理论推导用 ② 数值实现时把积分换成 DFT 求和。单位：与输入一致。',
      assume: '频谱可积；无吉布斯收敛问题（或按均方意义收敛）。',
      fail: '在频谱有跳变（如理想低通）处，有限项逆变换会出现吉布斯振荡，振荡幅度不随项数增加而衰减，只是集中在跳变附近（见 F-21）。用它去"设计"滤波器冲激响应时，必须加窗截断，否则阻带衰减只有 21 dB 左右。',
      tags: ['DTFT', '逆变换', '频谱'],
      see: 'theory/transform/dtft'
    },
    {
      id: 'T-07', cat: 'transform',
      name: '连续时间傅里叶变换 CTFT',
      en: 'Continuous-Time Fourier Transform',
      tex: 'X_a(\\Omega) = \\int_{-\\infty}^{\\infty} x_a(t)\\,e^{-j\\Omega t}\\,dt,\\qquad x_a(t) = \\frac{1}{2\\pi}\\int_{-\\infty}^{\\infty} X_a(\\Omega)\\,e^{j\\Omega t}\\,d\\Omega',
      plain: '连续信号的频谱，自变量是真实角频率 $\\Omega$（rad/s）。DTFT 与 CTFT 的桥梁就是采样：$X(e^{j\\omega}) = \\frac{1}{T_s}\\sum_k X_a\\!\\left(\\frac{\\omega - 2\\pi k}{T_s}\\right)$。',
      vars: [
        ['$x_a(t)$', '连续时间信号'],
        ['$\\Omega$', '真实角频率（rad/s），$\\Omega = 2\\pi f$'],
        ['$X_a(\\Omega)$', '连续频谱']
      ],
      usage: '① 用于推导采样、调制、脉压等机理 ② 与 DTFT 换算时注意 $\\omega = \\Omega T_s$ ③ 单位 rad/s。',
      assume: '信号绝对可积；否则需引入冲激函数或分布理论。',
      fail: '最常见的错误是混用 $\\Omega$（rad/s）与 $\\omega$（rad/样本），两者差一个 $T_s$。在雷达/声呐里这个错误会直接导致距离或速度估计错的离谱——例如把归一化频率 0.2π 当成 0.2π Hz 报上去。第二个坑是忘记 CTFT 与 DTFT 之间的 $1/T_s$ 幅度因子，做绝对声压标定时会差 $10\\log_{10} f_s$ 这么大的量（几十 dB）。',
      tags: ['CTFT', '傅里叶变换', '连续时间'],
      see: 'theory/transform/overview'
    },
    {
      id: 'T-08', cat: 'transform',
      name: '离散傅里叶级数 DFS',
      en: 'Discrete Fourier Series',
      tex: '\\tilde{x}[n] = \\frac{1}{N}\\sum_{k=0}^{N-1} \\tilde{X}[k]\\,e^{j2\\pi kn/N},\\qquad \\tilde{X}[k] = \\sum_{n=0}^{N-1} \\tilde{x}[n]\\,e^{-j2\\pi kn/N}',
      plain: '周期序列可以精确展开成有限个谐波之和，系数就是 DFS。DFT 在数学上就是"取周期序列的一个主值周期做 DFS"，这也是 DFT 隐含周期延拓的由来。',
      vars: [
        ['$\\tilde{x}[n]$', '周期为 $N$ 的序列'],
        ['$\\tilde{X}[k]$', '第 $k$ 次谐波的复系数'],
        ['$N$', '周期长度']
      ],
      usage: '① 处理真正的周期信号（如电机轴频、螺旋桨叶频）时用 DFS 视角更自然 ② 数值实现时就是一次 DFT ③ 单位与输入一致。',
      assume: '序列严格周期且周期恰为 $N$。',
      fail: '真实世界没有严格周期：转速会漂移，所以"周期" $N$ 与 DFT 长度永远对不齐，表现为谱线展宽（不是一根线而是一个包），此时用 DFS 的线谱模型估计幅度会偏低。工程上要么做转速跟踪重采样（阶次分析），要么接受泄漏并按窗的 ENBW 做能量修正。',
      tags: ['DFS', '周期序列', '线谱'],
      see: 'theory/transform/dft'
    },
    {
      id: 'T-09', cat: 'transform',
      name: '栅栏效应与频谱采样',
      en: 'Picket-Fence Effect',
      tex: 'X[k] = X(e^{j\\omega})\\Big|_{\\omega = 2\\pi k/N},\\qquad \\text{最大幅度偏差 } \\approx -3.92\\ \\mathrm{dB}',
      plain: 'DFT 只在离散栅格上看频谱，若信号频率落在两根栅格之间，就像透过栅栏看风景——最坏情况下峰值被低估约 3.92 dB（即 $\\mathrm{sinc}(0.5)$），功率低估约 36%。',
      vars: [
        ['$f_s/N$', '栅格间距（Hz）'],
        ['$3.92\\ \\mathrm{dB}$', '信号恰好落在两 bin 正中时的幅度损失，又称扇贝损失'],
        ['$N$', '变换长度']
      ],
      usage: '① 估计粗测频率 ② 补零（如补到 4—8 倍）加密栅格，把损失压到 0.1 dB 以内 ③ 或用插值（如三点 sinc 插值、相位差法）精估频率与幅度。单位 Hz。',
      assume: '单频信号；窗函数已知且固定。',
      fail: '补零能消除扇贝损失，但**不能**提高分辨两个邻近频率的能力——这一点在验收指标里经常被混淆，导致"分辨率达标"的假结论。另一个坑是在有噪声时用补零后的最高谱线当频率估计，误差虽小但不会降到零，真正要提高精度得靠相位信息或最大似然估计。',
      tags: ['栅栏效应', 'DFT', '补零', '扇贝损失'],
      see: 'theory/transform/dft'
    },
    {
      id: 'T-10', cat: 'transform',
      name: '频谱泄漏与窗函数',
      en: 'Spectral Leakage and Windowing',
      tex: 'x_w[n] = x[n]\\,w[n] \\quad\\Longleftrightarrow\\quad X_w(e^{j\\omega}) = \\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi} X(e^{j\\theta})\\,W(e^{j(\\omega-\\theta)})\\,d\\theta',
      plain: '截断一段数据等价于乘矩形窗，频域就是与窗的频谱卷积。矩形窗旁瓣只低 13 dB，于是强信号的能量"泄漏"到整个频带，把旁边的弱信号淹掉。加窗就是换个旁瓣更低、主瓣更宽的核。',
      vars: [
        ['$w[n]$', '窗序列，长度 $N$'],
        ['$W(e^{j\\omega})$', '窗的频谱，决定泄漏形状'],
        ['$13.26\\ \\mathrm{dB}$', '矩形窗第一旁瓣相对主瓣的电平'],
        ['$0.886\\,f_s/N$', '矩形窗 −3 dB 主瓣半宽（单边）']
      ],
      usage: '① 看动态范围需求选窗：矩形 −13 dB、汉宁 −31 dB、汉明 −43 dB、布莱克曼 −58 dB ② 记住主瓣越宽分辨率越差：汉宁主瓣约为矩形的 2 倍 ③ 功率谱必须按 ENBW 归一化。',
      assume: '信号平稳；窗长等于数据长度。',
      fail: '加窗降低了泄漏却牺牲了分辨率和信噪比：主瓣展宽会把邻近的两根谱线糊成一根，ENBW 变大则让噪声底抬高 1—3 dB。更隐蔽的是，加窗会让每个 bin 的噪声不再独立，基于独立假设的 CFAR 门限和检测概率公式全部偏乐观。工程上的折中通常是：检测用矩形窗（保 SNR），测频测幅用汉宁/平顶窗（保精度）。',
      tags: ['泄漏', '窗函数', '加窗', 'FFT'],
      see: 'theory/transform/dft'
    },
    {
      id: 'T-11', cat: 'transform',
      name: 'DTFT 时移性质',
      en: 'DTFT Time-Shifting Property',
      tex: 'x[n-n_0] \\;\\Longleftrightarrow\\; e^{-j\\omega n_0}\\,X(e^{j\\omega}),\\qquad |X(e^{j\\omega})|\\ \\text{不变}',
      plain: '序列整体延迟 $n_0$ 个样本，频谱幅度完全不变，只是多了一个线性相位 $e^{-j\\omega n_0}$。这就是为什么"延迟不损失信息，但会移动相位"。',
      vars: [
        ['$n_0$', '延迟样本数（整数，可为负表示超前）'],
        ['$e^{-j\\omega n_0}$', '线性相位项，斜率正比于 $n_0$'],
        ['$|X(e^{j\\omega})|$', '幅度谱，与时移无关']
      ],
      usage: '① 用相位斜率估计时延（群延迟）② 波束形成的相移等价于时移 ③ 单位：rad 相位。',
      assume: '整数样本延迟；$x[n]$ 的 DTFT 存在。',
      fail: '若需要**分数**样本延迟，整数移位公式给出的相位只在采样点上正确，宽带信号会出现幅度失真（分数延迟滤波器在不同频率上延迟不一致）。另外在 DFT 域，时移只有在"循环移位"意义下才严格成立——线性移位会造成首尾数据被搬走，产生与泄漏类似的边缘效应，必须用足够长的缓冲或重叠保留处理。',
      tags: ['DTFT', '时移', '相位', '性质'],
      see: 'theory/transform/dtft'
    },
    {
      id: 'T-12', cat: 'transform',
      name: 'DTFT 频移（调制）性质',
      en: 'DTFT Frequency-Shifting (Modulation) Property',
      tex: 'e^{j\\omega_0 n} x[n] \\;\\Longleftrightarrow\\; X\\!\\left(e^{j(\\omega-\\omega_0)}\\right),\\qquad \\cos(\\omega_0 n)x[n] \\;\\Longleftrightarrow\\; \\tfrac{1}{2}\\bigl[X(e^{j(\\omega-\\omega_0)})+X(e^{j(\\omega+\\omega_0)})\\bigr]',
      plain: '时域乘复正弦，频谱整体搬移 $\\omega_0$。乘余弦则一分为二，各搬 $\\pm\\omega_0$ 并幅度减半——这就是调制的数学本质，也是带通采样的依据。',
      vars: [
        ['$\\omega_0$', '搬移量（rad/样本）'],
        ['$1/2$', '余弦分解带来的幅度因子'],
        ['$x[n]$', '基带复信号']
      ],
      usage: '① 数字下变频（DDC）：乘 $e^{-j2\\pi f_c n/f_s}$ 再低通 ② 搬移后要注意频谱是否越过 $\\pm\\pi$ 造成混叠 ③ 单位 rad/样本。',
      assume: '搬移后仍在 $[-\\pi,\\,\\pi]$ 内，或已用足够采样率避免折叠。',
      fail: '实信号乘余弦会同时产生正频与负频两份镜像，若不滤掉镜像就直接降采样，两半会互相混叠，解调出来的基带是"两个边带之和"，正交解调必须用复混频（I/Q）。I/Q 通道的幅度不一致与相位不正交（镜像抑制比有限）会在镜像频率处留下残留，宽带系统中通常要求镜像抑制优于 40 dB。',
      tags: ['DTFT', '调制', '频移', '下变频'],
      see: 'theory/transform/dtft'
    },
    {
      id: 'T-13', cat: 'transform',
      name: '卷积定理',
      en: 'Convolution Theorem',
      tex: 'y[n] = x[n] \\ast h[n] \\;\\Longleftrightarrow\\; Y(e^{j\\omega}) = X(e^{j\\omega})\\,H(e^{j\\omega})',
      plain: '时域卷积 = 频域相乘。这条性质是"快速卷积"（用 FFT 做 FIR 滤波）和"频域波束形成"的全部理论基础。',
      vars: [
        ['$x[n]$', '输入信号'],
        ['$h[n]$', '系统冲激响应（滤波器系数）'],
        ['$\\ast$', '线性卷积运算符'],
        ['$H(e^{j\\omega})$', '系统频率响应']
      ],
      usage: '① 直接卷积复杂度 $O(NM)$，用 FFT 降为 $O(N\\log N)$ ② 长序列必须分段（重叠相加/保留，见 F-24、F-25）③ 用 DFT 实现时点数取 $L \\ge N + M - 1$，否则是循环卷积。单位：与输入一致。',
      assume: '卷积为线性卷积；用 DFT 实现时已补零到足够长度。',
      fail: '最经典的错误：直接用 $N$ 点 FFT 相乘再做 IFFT，得到的是**循环卷积**，时域会有混叠（首尾绕回）。必须补零到 $N+M-1$。另一个坑是以为 FFT 一定更快：当滤波器很短（$M < 20$ 左右）时，直接 FIR 卷积反而更快，而且没有 FFT 的块延迟。',
      tags: ['卷积定理', 'FFT', '快速卷积', '滤波'],
      see: 'theory/filter/conv'
    },
    {
      id: 'T-14', cat: 'transform',
      name: '相乘性质（加窗定理）',
      en: 'Multiplication (Windowing) Property',
      tex: 'x[n]\\,w[n] \\;\\Longleftrightarrow\\; \\frac{1}{2\\pi}\\bigl[X(e^{j\\omega}) \\circledast W(e^{j\\omega})\\bigr]',
      plain: '时域相乘 = 频域周期卷积。加窗就是拿窗的频谱去"抹"原频谱，抹的宽度就是主瓣宽度，抹不干净的部分就是旁瓣泄漏。',
      vars: [
        ['$w[n]$', '窗序列'],
        ['$\\circledast$', '周期卷积'],
        ['$1/(2\\pi)$', '归一化因子']
      ],
      usage: '① 评估泄漏：看窗频谱旁瓣电平 ② 评估分辨率损失：看主瓣宽度 ③ 两者不可兼得，按需求权衡。',
      assume: '窗为有限长实序列；原频谱存在。',
      fail: '工程上最常见的后果是：加了窗之后，原本刚好够用的两个频率分量被主瓣糊在一起了，于是"泄漏没了、分辨率也没了"。此外，加窗会让相邻 FFT bin 的噪声相关，若检测算法假设 bin 间独立（多数 CFAR 推导的默认前提），实际虚警率会显著高于设计值。',
      tags: ['相乘性质', '加窗', '泄漏', 'DTFT'],
      see: 'theory/basic/window'
    },
    {
      id: 'T-15', cat: 'transform',
      name: '帕塞瓦尔定理（能量守恒，DTFT 形式）',
      en: "Parseval's Theorem (DTFT Energy)",
      tex: '\\sum_{n=-\\infty}^{\\infty} |x[n]|^{2} = \\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi} |X(e^{j\\omega})|^{2}\\,d\\omega',
      plain: '时域总能量等于频域总能量。换个说法：无论你怎么变换，能量不会凭空增减。这是校验 FFT 程序、核对能量归一化的第一工具。',
      vars: [
        ['$|x[n]|^{2}$', '第 $n$ 个样本的能量（$\\mathrm{V^{2}}$ 或 $\\mathrm{Pa^{2}}$）'],
        ['$|X(e^{j\\omega})|^{2}$', '能量谱密度'],
        ['$1/(2\\pi)$', '归一化因子，来自 $\\omega$ 的周期长度']
      ],
      usage: '① 算时域 $\\sum |x|^{2}$ ② 算频域积分 ③ 两者应相等，不等就是归一化错了。单位：$\\mathrm{V^{2}}$ 或 $\\mathrm{Pa^{2}}$。',
      assume: '序列平方可和（能量信号）；DTFT 存在。',
      fail: '对功率信号（噪声、周期信号）这个积分发散，必须用功率谱密度形式（见 S-08）。另一个常见错误是拿单边谱直接套公式：单边谱已把能量乘 2，若再用双边公式的系数就会差 3 dB。',
      tags: ['帕塞瓦尔', '能量守恒', 'DTFT'],
      see: 'theory/transform/dtft'
    },
    {
      id: 'T-16', cat: 'transform',
      name: '帕塞瓦尔定理（DFT 形式）',
      en: "Parseval's Theorem (DFT Form)",
      tex: '\\sum_{n=0}^{N-1} |x[n]|^{2} = \\frac{1}{N}\\sum_{k=0}^{N-1} |X[k]|^{2}',
      plain: '有限长序列的时域能量等于频域能量除以 $N$。这条式子常用于"某个频段的能量占总能量多少"的计算。',
      vars: [
        ['$N$', 'DFT 长度'],
        ['$x[n]$', '时域序列'],
        ['$X[k]$', 'DFT 结果']
      ],
      usage: '① 分别算时域与频域能量 ② 检查是否相等，用于验证自写 FFT ③ 算带内能量占比时把对应 $k$ 的项求和再除总能量。单位与输入一致。',
      assume: '使用与 IDFT 一致的归一化约定（本书 $1/N$ 在逆变换）。',
      fail: '若把归一化放在正变换（很多教材如此），这条式子会变成 $\\sum|x|^{2} = \\sum|X|^{2}$，系数完全不同。搬代码时最常见的 bug 就是混用两套约定，导致能量差 $N$ 倍（几十 dB）。建议项目内统一写死一个约定并在注释里标出。',
      tags: ['帕塞瓦尔', 'DFT', '能量', '归一化'],
      see: 'theory/transform/dft'
    },
    {
      id: 'T-17', cat: 'transform',
      name: 'FFT 计算量对比',
      en: 'FFT Computational Complexity',
      tex: '\\text{DFT: } N^{2}\\ \\text{次复乘},\\qquad \\text{基 2 FFT: } \\frac{N}{2}\\log_{2} N\\ \\text{次复乘},\\qquad \\text{加速比 } \\approx \\frac{2N}{\\log_{2}N}',
      plain: '直接算 DFT 要 $N^{2}$ 次复乘，FFT 利用旋转因子的周期与对称性降到 $(N/2)\\log_{2}N$。$N = 1024$ 时约快 200 倍，$N$ 越大优势越明显。',
      vars: [
        ['$N$', '变换长度，基 2 FFT 要求 $N = 2^{m}$'],
        ['$N^{2}$', '直接 DFT 的复乘次数'],
        ['$\\frac{N}{2}\\log_{2}N$', '基 2 FFT 的复乘次数'],
        ['$N \\log_2 N$', 'FFT 复加次数，同样远小于 $N^{2}$']
      ],
      usage: '① 估算实时性：$N = 4096$ 时 FFT 约 2.5 万次复乘，直接 DFT 约 1678 万次 ② $N$ 不是 2 的幂时用混合基或补零到最近的 2 的幂。单位：浮点运算次数。',
      assume: '$N$ 为 2 的整数次幂；只统计复乘主导项。',
      fail: '理论加速比在实测中往往打折扣：FFT 的内存访问是跳跃的（位反转 + 蝶形跨距），缓存命中率远低于直接 DFT 的顺序访问；在带 SIMD 的库里，短长度（$N \\le 64$）直接 DFT 可能更快。另外实时系统的瓶颈常常不是乘法次数而是内存带宽与功耗，一味追求大 $N$ 得不偿失。',
      tags: ['FFT', '计算量', '复杂度', '实时'],
      see: 'theory/transform/fft'
    },
    {
      id: 'T-18', cat: 'transform',
      name: 'Goertzel 算法',
      en: 'Goertzel Algorithm',
      tex: 's[n] = x[n] + 2\\cos\\!\\left(\\tfrac{2\\pi k}{N}\\right) s[n-1] - s[n-2],\\qquad X[k] = s[N] - e^{-j2\\pi k/N}\\,s[N-1]',
      plain: '只想算 DFT 的**一个**频点时，跑整轮 FFT 太浪费。Goertzel 用一个二阶 IIR 递推就把第 $k$ 个频点算出来，复杂度 $O(N)$、只需存两个数。',
      vars: [
        ['$k$', '目标频点序号'],
        ['$N$', '递推长度（样本数）'],
        ['$s[n]$', '递推状态，$s[-1] = s[-2] = 0$'],
        ['$2\\cos(2\\pi k/N)$', '唯一的递推系数']
      ],
      usage: '① 确定目标频率 $f_0$ 与采样率 $f_s$ ② 取 $N$ 使 $k = N f_0/f_s$ 尽量接近整数 ③ 递推 $N$ 步 ④ 只需功率时用 $|X[k]|^{2} = s[N]^{2} + s[N-1]^{2} - 2\\cos(2\\pi k/N)s[N]s[N-1]$（免开根号）。',
      assume: '只需要少数几个频点；递推长度 $N$ 固定。',
      fail: '当需要的频点数超过约 $\\log_{2}N$ 个时，Goertzel 的总开销就超过一次 FFT 了，此时应改用 FFT。另外 Goertzel 是 IIR 结构，对定点实现的系数量化敏感：$2\\cos(2\\pi k/N)$ 量化后极点会偏离单位圆，递推可能缓慢发散或衰减，长序列下误差累积明显，需要用浮点或做误差反馈补偿。',
      tags: ['Goertzel', 'DFT', '单频检测', 'DTMF'],
      see: 'theory/transform/fft'
    },
    {
      id: 'T-19', cat: 'transform',
      name: '短时傅里叶变换 STFT',
      en: 'Short-Time Fourier Transform',
      tex: 'X[m,\\,k] = \\sum_{n=0}^{N-1} x[n + mR]\\,w[n]\\,e^{-j2\\pi kn/N}',
      plain: '把长信号切成一帧一帧，每帧加窗做 DFT，得到一个二维的时频图。核心矛盾是：窗越长频率分辨率越好、时间分辨率越差。',
      vars: [
        ['$m$', '帧序号'],
        ['$R$', '帧移（样本数），通常取 $N/4$—$N/2$ 保证帧间重叠'],
        ['$w[n]$', '分析窗，长度 $N$'],
        ['$N$', '帧长，决定频率分辨率 $f_s/N$']
      ],
      usage: '① 按时间分辨率需求选帧长 $N$ ② 按冗余度选帧移 $R$（重叠 50%—75% 常见）③ 若要完美重建（STFT 逆变），需满足 OLA/COLA 条件 $\\sum_m w[n-mR] = \\text{const}$。单位：样本。',
      assume: '信号在每一帧内近似平稳；窗与帧移固定。',
      fail: '固定窗长意味着固定的时频分辨率，遇到"快变 + 慢变"混合的信号（如水声瞬态叠加稳态线谱）必然顾此失彼，这时该上小波或自适应时频分布。做 STFT 逆变换时若窗不满足 COLA 条件，重建信号会有周期性的幅度起伏（"呼吸"失真），做降噪再重建时尤其明显。',
      tags: ['STFT', '时频分析', '加窗', '声呐'],
      see: 'theory/transform/stft'
    },
    {
      id: 'T-20', cat: 'transform',
      name: '时频不确定原理',
      en: 'Time-Frequency Uncertainty Principle',
      tex: '\\Delta t \\cdot \\Delta f \\ \\ge\\ \\frac{1}{4\\pi},\\qquad \\Delta t = \\sqrt{\\frac{\\int t^{2}|x(t)|^{2}dt}{\\int |x(t)|^{2}dt}}',
      plain: '一个信号不可能同时在时间和频率上都被压缩到任意窄。时间宽度与带宽的乘积有个下限。这不是仪器不够好，是数学上的硬限制。',
      vars: [
        ['$\\Delta t$', '时域有效宽度（s），按能量二阶矩定义'],
        ['$\\Delta f$', '频域有效带宽（Hz）'],
        ['$1/(4\\pi)$', '乘积下限，高斯窗取等号'],
        ['$1/2$', '若用 $\\Delta\\omega=2\\pi\\Delta f$，则 $\\Delta t\\Delta\\omega \\ge 1/2$']
      ],
      usage: '① 定时间分辨率 $\\Delta t$ 后，频率分辨率最好也只有 $1/(4\\pi\\Delta t)$ ② 设计 STFT 时明确接受这个权衡 ③ 单位：s 与 Hz。',
      assume: '信号能量有限；宽度按二阶矩（标准差）定义；信号已做时间/频率中心化。',
      fail: '这条界限只对二阶矩定义的"有效宽度"成立。工程上更常用 −3 dB 主瓣宽度，其乘积常数不同，直接套 $1/(4\\pi)$ 会得出错误的量化结论。另外它只限制**单一**时频原子，并不意味着不能设计出自适应、多分辨率、或参数化的超分辨方法——MUSIC、ESPRIT 就是绕开了傅里叶基的分辨率限制。',
      tags: ['不确定原理', '时频分析', '分辨率', '高斯窗'],
      see: 'theory/transform/stft'
    },
    {
      id: 'T-21', cat: 'transform',
      name: '连续小波变换 CWT',
      en: 'Continuous Wavelet Transform',
      tex: 'W_x(a,\\,b) = \\frac{1}{\\sqrt{|a|}}\\int_{-\\infty}^{\\infty} x(t)\\,\\psi^{*}\\!\\left(\\frac{t-b}{a}\\right) dt,\\qquad \\int \\psi(t)\\,dt = 0',
      plain: '把信号与一组"伸缩平移"的小波做内积。尺度 $a$ 大 → 小波被拉长 → 看低频、频率分辨率好；$a$ 小 → 看高频、时间分辨率好。这就是"变焦"。',
      vars: [
        ['$a$', '尺度参数（无量纲），$a>1$ 拉伸对应低频'],
        ['$b$', '平移参数（s），对应时间位置'],
        ['$\\psi(t)$', '母小波，必须满足零均值（容许性条件）'],
        ['$1/\\sqrt{|a|}$', '能量归一化因子']
      ],
      usage: '① 按分析频段选母小波（ Morlet 适合振荡信号，db4 适合瞬态）② 尺度与频率换算 $f \\approx f_c/(a\\,\\Delta t)$，$f_c$ 为小波中心频率 ③ 画尺度图时注意纵轴应取对数。单位：s 与 Hz。',
      assume: '母小波满足容许性条件 $C_\\psi = \\int |\\Psi(\\Omega)|^{2}/|\\Omega|\\,d\\Omega < \\infty$；信号能量有限。',
      fail: '尺度 $a$ 不等于频率：两者是反比关系、且换算常数依赖母小波的中心频率，直接把尺度轴当频率轴读数是常见错误。另外 CWT 高度冗余、相邻尺度强相关，把它当成"独立测量"去做统计检测会使虚警概率严重失真；工程上要么抽取尺度、要么用统计独立的检验。',
      tags: ['CWT', '小波', '时频分析', '尺度图'],
      see: 'theory/transform/wavelet'
    },
    {
      id: 'T-22', cat: 'transform',
      name: '离散小波变换与二尺度方程',
      en: 'Discrete Wavelet Transform and Two-Scale Relation',
      tex: '\\phi(t) = \\sqrt{2}\\sum_n h[n]\\,\\phi(2t-n),\\qquad \\psi(t) = \\sqrt{2}\\sum_n g[n]\\,\\phi(2t-n),\\quad g[n]=(-1)^{n} h[1-n]',
      plain: '尺度函数 $\\phi$ 与小波函数 $\\psi$ 都由自身二倍缩放的平移组合生成，这就是"二尺度方程"。系数 $h$ 是低通（尺度）滤波器，$g$ 是高通（小波）滤波器，DWT 就是用这对滤波器反复做二抽取。',
      vars: [
        ['$\\phi(t)$', '尺度函数（低通平滑核）'],
        ['$\\psi(t)$', '小波函数（带通细节核）'],
        ['$h[n]$', '低通分解滤波器系数'],
        ['$g[n]$', '高通分解滤波器系数，由 $h$ 交替翻转得到']
      ],
      usage: '① 选小波族（db4、sym8、coif）② 确定分解层数（通常 3—6 层）③ 每层做卷积 + 二抽取，得到近似系数与细节系数。单位：无量纲系数。',
      assume: '滤波器组满足完全重建条件；信号长度为 2 的整数次幂（或做边界延拓）。',
      fail: 'DWT 不具备平移不变性：信号平移一个样本，小波系数能量会发生明显抖动，做阈值降噪时会出现"伪吉布斯"振铃。解决办法是用非抽取小波（à trous）或循环平移平均。另外边界延拓方式（零延拓/对称延拓/周期延拓）会显著影响首尾若干样本的系数，短数据分析时必须说明。',
      tags: ['DWT', '二尺度方程', '小波', '滤波器组'],
      see: 'theory/transform/wavelet'
    },
    {
      id: 'T-23', cat: 'transform',
      name: 'Z 变换与收敛域 ROC',
      en: 'Z-Transform and Region of Convergence',
      tex: 'X(z) = \\sum_{n=-\\infty}^{\\infty} x[n]\\,z^{-n},\\qquad \\text{ROC: } \\sum_n |x[n]\\,z^{-n}| < \\infty',
      plain: 'Z 变换是离散信号的"生成函数"，$z$ 是复变量。同一个代数表达式配上不同收敛域代表完全不同的时域序列——所以**只写 $X(z)$ 不写 ROC 是不完整的**。',
      vars: [
        ['$z$', '复变量，$z = r e^{j\\omega}$'],
        ['$X(z)$', 'Z 变换结果'],
        ['ROC', '收敛域，使级数绝对收敛的 $z$ 区域'],
        ['$r$', '半径，ROC 的边界由 $|z| = r$ 给出']
      ],
      usage: '① 求 $X(z)$ 的同时一定要标 ROC ② 右边序列 ROC 在最外极点之外，左边序列在最内极点之内，双边序列为环状 ③ 单位圆在 ROC 内 ⟺ DTFT 存在 ⟺ 系统稳定。',
      assume: '级数收敛；系统为线性时不变（LTI）。',
      fail: '常见错误是只给 $X(z)$ 的分式就去做逆变换，忽略了"是因果还是反因果"这一信息，结果时域序列完全反了。判断稳定性时只看"极点在单位圆内"是不够的：还必须要求 ROC 包含单位圆，对非因果系统前者成立而后者不成立。数值实现中，逆 Z 变换的部分分式展开在重极点附近对舍入极敏感。',
      tags: ['Z变换', 'ROC', '收敛域', '稳定性'],
      see: 'theory/transform/ztrans'
    },
    {
      id: 'T-24', cat: 'transform',
      name: 'Z 变换性质：时移、卷积与差分',
      en: 'Z-Transform Properties: Shift, Convolution',
      tex: 'x[n-n_0] \\;\\Longleftrightarrow\\; z^{-n_0}X(z),\\qquad x[n]\\ast h[n] \\;\\Longleftrightarrow\\; X(z)H(z),\\qquad x[n-1] \\;\\Longleftrightarrow\\; z^{-1}X(z)+x[-1]',
      plain: 'Z 变换把时域的移位、卷积变成代数运算。第三条是**单边** Z 变换的移位公式，多出来的 $x[-1]$ 项正是初始条件——用 Z 变换解差分方程时全靠它。',
      vars: [
        ['$n_0$', '移位样本数'],
        ['$z^{-1}$', '单位延迟算子'],
        ['$x[-1]$', '单边 Z 变换下的初始条件'],
        ['$H(z)$', '系统函数']
      ],
      usage: '① 由差分方程取 Z 变换 → 代数方程 → 解出 $Y(z)$ → 逆变换 ② 零初始条件下 $H(z) = Y(z)/X(z)$ ③ 极点位置决定稳定性与暂态。',
      assume: 'LTI 系统；ROC 在运算后已重新确定（零极点相消会改变 ROC）。',
      fail: '最隐蔽的坑是**零极点相消**：两个系统级联时若零点与极点恰好抵消，代数上 ROC 变大，但实际系统可能内部不稳定（有界输入有界输出意义下稳定、但内部状态发散）。定点实现中极点位置被量化后永远不会精确相消，隐藏的不稳定模态会慢慢冒出来，表现为输出缓慢增长的极限环振荡。',
      tags: ['Z变换', '性质', '差分方程', '零极点'],
      see: 'theory/transform/ztrans'
    },
    {
      id: 'T-25', cat: 'transform',
      name: 's 平面到 z 平面映射',
      en: 's-to-z Plane Mapping',
      tex: 'z = e^{s T_s},\\qquad s = \\sigma + j\\Omega \\;\\mapsto\\; z = e^{\\sigma T_s} e^{j\\Omega T_s}',
      plain: '采样把 s 平面的虚轴 $\\Omega$ 一对一地卷到 z 平面的单位圆上，并且沿虚轴每隔 $2\\pi/T_s$ 重复一次——这就是离散频谱周期性的根源，也是混叠的几何解释。',
      vars: [
        ['$s$', '拉普拉斯变量（$\\mathrm{s^{-1}}$）'],
        ['$T_s$', '采样间隔（s）'],
        ['$\\sigma$', '衰减率，$\\sigma<0$ 映射到单位圆内'],
        ['$\\Omega$', '模拟角频率（rad/s）']
      ],
      usage: '① 判断连续系统离散化后的稳定性：s 左半平面 → z 单位圆内 ② 理解为什么采样会带来频谱重复 ③ 单位 rad/s。',
      assume: '均匀采样；无保持电路（若有 ZOH 需乘 $H_{\\mathrm{ZOH}}$）。',
      fail: '$z = e^{sT_s}$ 是多对一映射，s 平面上相距 $2\\pi/T_s$ 的点会映射到同一个 $z$，导致离散化后无法区分高频与低频——这正是混叠，设计时必须在离散化前就把带外能量压掉。此外，若系统含 ZOH，只做 $z = e^{sT_s}$ 而不补 $(1-e^{-sT_s})/s$ 的保持环节，离散模型与实际响应会有明显偏差。',
      tags: ['s平面', 'z平面', '映射', '离散化'],
      see: 'theory/transform/ztrans'
    },
    {
      id: 'T-26', cat: 'transform',
      name: '希尔伯特变换定义',
      en: 'Hilbert Transform',
      tex: '\\hat{x}(t) = \\frac{1}{\\pi}\\,\\mathrm{p.v.}\\!\\int_{-\\infty}^{\\infty} \\frac{x(\\tau)}{t-\\tau}\\,d\\tau \\;\\Longleftrightarrow\\; \\hat{X}(f) = -j\\,\\mathrm{sgn}(f)\\,X(f)',
      plain: '希尔伯特变换就是把所有正频率分量移相 −90°、负频率分量移相 +90°，幅度一点不变。它不改变能量，只改相位。',
      vars: [
        ['$\\hat{x}(t)$', '希尔伯特变换结果，与 $x(t)$ 正交'],
        ['$\\mathrm{sgn}(f)$', '符号函数，$f>0$ 取 1、$f<0$ 取 −1'],
        ['p.v.', '柯西主值积分（避开 $t = \\tau$ 的奇点）']
      ],
      usage: '① 实际实现用频域：$X(f) \\to$ 乘 $-j\\,\\mathrm{sgn}(f) \\to$ IFFT ② 或用 FIR 近似（阶数 32—128）③ 单位与输入一致。',
      assume: '信号平稳、无直流分量；$f = 0$ 处符号函数取 0。',
      fail: '希尔伯特变换对**信号的端点**非常敏感：有限长序列做 FFT 实现时，卷积核是无限长的，首尾会出现明显的"边缘效应"，瞬态信号尤其严重。此外对宽带信号（不是窄带带通信号），解析信号的"瞬时频率"会失去物理意义，甚至出现负值，必须先用带通滤波限定分析频段。',
      tags: ['希尔伯特变换', '解析信号', '正交', '相位'],
      see: 'theory/transform/hilbert'
    },
    {
      id: 'T-27', cat: 'transform',
      name: '解析信号与复包络',
      en: 'Analytic Signal and Complex Envelope',
      tex: 'z(t) = x(t) + j\\,\\hat{x}(t),\\qquad Z(f) = \\begin{cases} 2X(f), & f>0 \\\\ X(0), & f=0 \\\\ 0, & f<0 \\end{cases}',
      plain: '解析信号只保留正频率（加倍），负频率置零。好处是可以直接取模得到包络、取相位导数得到瞬时频率，还把采样率需求从 $2f_{\\max}$ 降到 $2B$（$B$ 为带宽）。',
      vars: [
        ['$z(t)$', '解析信号（复）'],
        ['$\\hat{x}(t)$', '希尔伯特变换结果'],
        ['$|z(t)|$', '瞬时包络，单位与输入一致'],
        ['$2X(f)$', '正频率加倍，保证能量守恒']
      ],
      usage: '① FFT → 正频率乘 2、负频率置零、直流不变 → IFFT ② 窄带信号可再下变频到基带得到复包络 ③ 单位与输入一致。',
      assume: '实信号；无直流与奈奎斯特频率分量歧义（偶数点 FFT 的 $f_s/2$ 点要小心处理）。',
      fail: '偶数点 FFT 时奈奎斯特频率点（$k = N/2$）既不属于正频率也不属于负频率，处理方式不统一会导致包络出现 2 倍频纹波。对多分量信号（多个频率靠得很近），解析信号的包络会出现"拍"，瞬时频率在两分量间跳变，此时应改用经验模态分解或时频重排。',
      tags: ['解析信号', '复包络', '希尔伯特变换', '窄带'],
      see: 'theory/transform/hilbert'
    },
    {
      id: 'T-28', cat: 'transform',
      name: '瞬时频率',
      en: 'Instantaneous Frequency',
      tex: 'f_i(t) = \\frac{1}{2\\pi}\\,\\frac{d}{dt}\\arg\\{z(t)\\} = \\frac{1}{2\\pi}\\,\\mathrm{Im}\\!\\left\\{\\frac{z\'(t)}{z(t)}\\right\\}',
      plain: '解析信号相位的导数就是瞬时频率。注意两个前提：必须是**单分量**窄带信号，且要用**解缠相位**（去掉 $2\\pi$ 跳变）。',
      vars: [
        ['$z(t)$', '解析信号'],
        ['$\\arg\\{z(t)\\}$', '瞬时相位（rad），需解缠'],
        ['$f_i(t)$', '瞬时频率（Hz）']
      ],
      usage: '① 求解析信号 ② 用 `unwrap` 解缠相位 ③ 数值差分求导 ④ 必要时平滑。单位 Hz。',
      assume: '信号为窄带单分量；幅度不为零（否则相位无定义）。',
      fail: '最常见失效：信号过零点或幅度趋于零时，相位噪声被放大，瞬时频率出现尖峰甚至负值——这不是"负频率"，是数值假象。多分量信号（如两艘船的线谱）叠加后瞬时频率会在两者之间来回跳，物理上无意义。工程做法是先用窄带滤波把分量分开再各自求瞬时频率。',
      tags: ['瞬时频率', '解析信号', '相位解缠', '多普勒'],
      see: 'theory/transform/hilbert'
    },
    {
      id: 'T-29', cat: 'transform',
      name: '分数阶傅里叶变换 FRFT',
      en: 'Fractional Fourier Transform',
      tex: 'X_\\alpha(u) = \\mathcal{F}^{\\alpha}\\{x\\}(u) = \\int_{-\\infty}^{\\infty} x(t)\\,K_\\alpha(t,\\,u)\\,dt,\\qquad \\alpha = \\frac{p\\pi}{2}',
      plain: 'FRFT 把信号在时频平面上旋转角度 $\\alpha$。$\\alpha = 0$ 是时域本身，$\\alpha = \\pi/2$ 就是普通傅里叶变换，中间角度是"介于两者之间"的表示。LFM 信号在某个角度上会聚焦成一个尖峰。',
      vars: [
        ['$p$', '变换阶次，$p=1$ 对应标准傅里叶变换'],
        ['$\\alpha$', '时频平面旋转角（rad）'],
        ['$K_\\alpha(t,\\,u)$', 'FRFT 核函数，含 $\\cot\\alpha$ 的二次相位'],
        ['$\\mathcal{F}^{\\alpha}$', 'α 阶分数阶傅里叶算子']
      ],
      usage: '① 对 LFM 信号，阶次 $p$ 与调频率 $\\mu$ 的关系为 $\\alpha = -\\arctan(1/\\mu)$（归一化坐标下）② 在 $p$ 域搜索能量最集中的角度即为参数估计 ③ 单位 rad。',
      assume: '信号为单分量 LFM；坐标已归一化使时间与频率量纲一致。',
      fail: '归一化坐标是 FRFT 工程应用的头号陷阱：时间轴与频率轴必须先按 $\\sqrt{N/f_s}$ 之类的因子归一，否则旋转角与调频率的换算差一个尺度因子，估出来的调频率错几十个百分点。多分量 LFM 会在不同角度各成峰，但强分量的旁瓣会掩盖弱分量，需要 CLEAN 类的迭代剔除。',
      tags: ['FRFT', 'LFM', '时频分析', '参数估计'],
      see: 'theory/transform/frft'
    },

    /* ===================== 滤波 filter ===================== */
    {
      id: 'F-01', cat: 'filter',
      name: '线性卷积',
      en: 'Linear Convolution',
      tex: 'y[n] = \\sum_{m=-\\infty}^{\\infty} h[m]\\,x[n-m] = \\sum_{m=0}^{M-1} h[m]\\,x[n-m],\\qquad L_y = N + M - 1',
      plain: 'FIR 滤波的本质：输出每一个点都是输入的一段与滤波器系数的加权求和。输出长度为 $N + M - 1$，比输入长。',
      vars: [
        ['$x[n]$', '输入序列，长度 $N$'],
        ['$h[m]$', '滤波器冲激响应，长度 $M$'],
        ['$y[n]$', '输出序列，长度 $N+M-1$'],
        ['$L_y$', '输出长度（样本数）']
      ],
      usage: '① 系数与数据对齐（注意下标从 0 开始）② 逐点乘加 ③ 输出比输入长 $M-1$ 个样本，实时系统要处理这个"尾效应"。单位与输入一致。',
      assume: 'LTI 系统；滤波器为 FIR（或截断后的 IIR）。',
      fail: '长滤波器直接卷积的实时性问题是主要痛点：$M = 512$ 时每输出一点要 512 次乘加，采样率 100 kHz 就是 51 M 次/秒，单片 DSP 算不过来，必须转 FFT 快速卷积或分段处理。另外定点实现时累加器的动态范围要留足 $\\log_2 M$ 位的余量，否则容易溢出。',
      tags: ['线性卷积', 'FIR', '滤波'],
      see: 'theory/filter/conv'
    },
    {
      id: 'F-02', cat: 'filter',
      name: '循环卷积',
      en: 'Circular Convolution',
      tex: 'y_c[n] = \\sum_{m=0}^{N-1} x[m]\\,h[(n-m)\\bmod N],\\qquad y_c[n] \\;\\Longleftrightarrow\\; X[k]\\,H[k]',
      plain: '两个长度都为 $N$ 的序列在"环形"上做卷积，超出头尾的部分会绕回来。它正好对应 DFT 域的逐点相乘——这是好事也是陷阱。',
      vars: [
        ['$x[m],\\,h[m]$', '两个长度均为 $N$ 的序列'],
        ['$\\bmod N$', '循环移位，超出的样本绕回开头'],
        ['$X[k],\\,H[k]$', '各自的 N 点 DFT']
      ],
      usage: '① 计算时先把两序列补零到相同长度 $N$ ② 分别做 DFT ③ 逐点相乘 ④ IFFT。单位与输入一致。',
      assume: '两序列等长 $N$；运算定义在循环群上。',
      fail: '用 DFT 做滤波时若忘了补零到 $N + M - 1$，得到的就是循环卷积，时域混叠会让输出首尾各 $M-1$ 个样本出错——这个错误在离线批处理里极难发现，因为中间部分是对的。重叠相加/重叠保留（F-24、F-25）就是专门解决这个问题的。',
      tags: ['循环卷积', 'DFT', '混叠'],
      see: 'theory/filter/conv'
    },
    {
      id: 'F-03', cat: 'filter',
      name: '循环卷积等价于线性卷积的条件',
      en: 'Condition for Circular-Linear Convolution Equivalence',
      tex: 'L \\;\\ge\\; N + M - 1 \\quad\\Longrightarrow\\quad y_c[n] = y[n]\\ (0 \\le n < L)',
      plain: '只要 DFT 点数（或圆周长度）不小于 $N + M - 1$，循环卷积的结果就和线性卷积一模一样。多出来的位置填零即可。',
      vars: [
        ['$N$', '输入序列长度'],
        ['$M$', '滤波器长度'],
        ['$L$', 'DFT 点数，取 $L \\ge N+M-1$（通常取 2 的整数次幂）']
      ],
      usage: '① 取 $L = 2^{\\lceil \\log_2(N+M-1)\\rceil}$ ② 两序列各补零到 $L$ ③ FFT → 相乘 → IFFT ④ 取前 $N+M-1$ 个有效点。单位：样本。',
      assume: '两序列长度分别为 $N$、$M$；线性卷积长度为 $N+M-1$。',
      fail: '工程上常为了"凑 FFT 长度"而把 $L$ 取得不够，特别是在流式处理里每块长度变化时容易算错。另一个坑是分块频域滤波时，补零长度必须按块长加滤波器长度来算，而不是只按块长。',
      tags: ['循环卷积', '补零', '快速卷积'],
      see: 'theory/filter/conv'
    },
    {
      id: 'F-04', cat: 'filter',
      name: '线性常系数差分方程',
      en: 'Linear Constant-Coefficient Difference Equation',
      tex: 'y[n] = -\\sum_{k=1}^{N_a} a_k\\,y[n-k] + \\sum_{k=0}^{N_b} b_k\\,x[n-k]',
      plain: '递归滤波器（IIR）的时域写法：当前输出由过去的输入和过去的输出共同决定。"过去的输出"这一项带来了反馈，也带来了无限长冲激响应和不稳定风险。',
      vars: [
        ['$a_k$', '反馈（递归）系数，$a_0 = 1$'],
        ['$b_k$', '前馈（非递归）系数'],
        ['$N_a,\\,N_b$', '递归与前馈的阶数'],
        ['$y[n-k]$', '过去的输出（反馈项）']
      ],
      usage: '① 由设计方法得到 $a_k$、$b_k$ ② 初始化状态为零（或上次的状态）③ 逐点递推 ④ 注意累加顺序以减少定点舍入误差。',
      assume: 'LTI；初始状态已知（通常为零）；系数为常数。',
      fail: '高阶 IIR 直接用差分方程（直接型）实现，在定点下极易因极点密集而产生数值不稳定和极限环。工程上必须拆成二阶节（SOS，见 F-26）级联。另外直接型的系数对量化极敏感：6 阶以上巴特沃斯低通在窄带时，直接型的系数微小扰动就能把极点推出单位圆。',
      tags: ['差分方程', 'IIR', '递推', '稳定性'],
      see: 'theory/filter/iir'
    },
    {
      id: 'F-05', cat: 'filter',
      name: '系统函数 H(z)',
      en: 'System Function',
      tex: 'H(z) = \\frac{Y(z)}{X(z)} = \\frac{\\sum_{k=0}^{N_b} b_k z^{-k}}{1 + \\sum_{k=1}^{N_a} a_k z^{-k}} = g\\,\\frac{\\prod_{m}(1 - z_m z^{-1})}{\\prod_{n}(1 - p_n z^{-1})}',
      plain: '系统函数是冲激响应的 Z 变换，也是滤波器的"身份证"：零点决定哪些频率被抑制，极点决定哪些频率被放大和暂态如何振荡。',
      vars: [
        ['$H(z)$', '系统函数（传递函数）'],
        ['$z_m$', '第 m 个零点'],
        ['$p_n$', '第 n 个极点'],
        ['$g$', '增益常数']
      ],
      usage: '① 由差分方程系数写出分子分母 ② 分解因式找零极点 ③ 检查极点是否全在单位圆内判定稳定性。',
      assume: 'LTI 系统；零初始条件；ROC 包含单位圆则有界输入有界输出稳定。',
      fail: '只检查"极点在单位圆内"而忽略 ROC，对非因果系统会得出错误结论。另一个工程陷阱：级联实现时零极点配对与排序会影响定点噪声与溢出，随便排会把信噪比搞差 10 dB 以上，需要按"极点靠近单位圆的节放后面、零点靠近极点的配对"这类经验规则优化。',
      tags: ['系统函数', '传递函数', '零极点', '稳定性'],
      see: 'theory/filter/iir'
    },
    {
      id: 'F-06', cat: 'filter',
      name: '频率响应与幅相表示',
      en: 'Frequency Response',
      tex: 'H(e^{j\\omega}) = H(z)\\big|_{z=e^{j\\omega}} = |H(e^{j\\omega})|\\,e^{j\\angle H(e^{j\\omega})},\\qquad H_{\\mathrm{dB}} = 20\\log_{10}|H|',
      plain: '把系统函数限制在单位圆上，就得到频率响应。它告诉每个频率分量被放大多少（幅度）、延迟多少（相位）。',
      vars: [
        ['$\\omega$', '归一化角频率（rad/样本）'],
        ['$|H(e^{j\\omega})|$', '幅度响应（线性值）'],
        ['$H_{\\mathrm{dB}}$', '幅度响应（dB）'],
        ['$\\angle H$', '相位响应（rad）']
      ],
      usage: '① 代入 $z = e^{j\\omega}$ ② 取模得幅度、取辐角得相位 ③ dB 用 $20\\log_{10}$（幅度比）。单位：rad/样本。',
      assume: '系统稳定（ROC 含单位圆）。',
      fail: '只看幅度响应不看相位，是最常见的设计疏漏：滤波器幅度达标但群延迟起伏大，脉冲信号通过后被严重畸变（振铃、前导振荡）。另外用 `freqz` 只看 $[0,\\ \\pi]$ 就下结论，会漏掉多速率系统里镜像频段的响应。',
      tags: ['频率响应', '幅度响应', '相位响应', 'dB'],
      see: 'theory/filter/fir'
    },
    {
      id: 'F-07', cat: 'filter',
      name: 'FIR 系统函数与横截结构',
      en: 'FIR System Function',
      tex: 'H(z) = \\sum_{n=0}^{M-1} b_n\\,z^{-n},\\qquad h[n] = b_n\\ (0 \\le n < M)',
      plain: 'FIR 滤波器没有反馈，分母为 1，冲激响应就是系数本身、长度有限。因此它**永远稳定**，而且可以做成严格线性相位。',
      vars: [
        ['$b_n$', '滤波器系数，共 $M$ 个'],
        ['$M$', '滤波器阶数加一，即抽头数'],
        ['$h[n]$', '冲激响应，等于系数序列']
      ],
      usage: '① 由设计方法（窗函数法、等波纹法）求出 $b_n$ ② 直接卷积或转置型实现 ③ 群延迟恒为 $(M-1)/2$ 个样本。单位：样本。',
      assume: 'LTI；系数恒定；无反馈。',
      fail: 'FIR 永远稳定是真的，但"永远线性相位"只在系数对称或反对称时成立，随便设计（如最小二乘拟合任意响应）会破坏对称性。另一个实际问题是延迟：512 抽头 FIR 在 100 kHz 采样下带来 2.56 ms 的固定延迟，在声呐测距链路里必须计入距离偏差，否则定位结果整体偏移。',
      tags: ['FIR', '冲激响应', '线性相位', '稳定性'],
      see: 'theory/filter/fir'
    },
    {
      id: 'F-08', cat: 'filter',
      name: 'IIR 系统函数',
      en: 'IIR System Function',
      tex: 'H(z) = \\frac{\\sum_{k=0}^{N_b} b_k z^{-k}}{1 + \\sum_{k=1}^{N_a} a_k z^{-k}},\\qquad \\text{稳定条件：}\\ |p_n| < 1\\ \\forall n',
      plain: 'IIR 有反馈（分母多项式），冲激响应无限长。优点是达到同样选择性所需阶数远低于 FIR；代价是可能不稳定、相位非线性。',
      vars: [
        ['$a_k$', '反馈系数，决定极点'],
        ['$b_k$', '前馈系数，决定零点'],
        ['$p_n$', '极点，必须全在单位圆内才稳定']
      ],
      usage: '① 由模拟原型经双线性变换或脉冲响应不变法得到数字系数 ② 检查极点模值 ③ 拆成二阶节级联实现。',
      assume: 'LTI；极点在单位圆内；ROC 为最外极点之外（因果）。',
      fail: '定点实现时极点靠近单位圆（窄带滤波器）会放大舍入噪声，输出出现极限环振荡；必须增加字长或改用 SOS + 噪声整形。阶数高时直接型结构系数量化敏感度呈指数上升，6 阶以上就应避免。另外 IIR 无法做严格线性相位，做脉冲压缩或波形保真时要用 filtfilt（F-23）或全通相位均衡。',
      tags: ['IIR', '极点', '稳定性', '递归'],
      see: 'theory/filter/iir'
    },
    {
      id: 'F-09', cat: 'filter',
      name: '线性相位 FIR 的四种类型',
      en: 'Four Types of Linear-Phase FIR',
      tex: '\\begin{aligned} &\\text{I 型：} h[n]=h[M-1-n],\\ M\\ \\text{奇} &&\\to\\ H(\\omega)=A(\\omega)e^{-j\\omega\\frac{M-1}{2}},\\ \\text{任意}\\ \\\\ &\\text{II 型：} h[n]=h[M-1-n],\\ M\\ \\text{偶} &&\\to\\ H(\\pi)=0,\\ \\text{不能做高通} \\\\ &\\text{III 型：} h[n]=-h[M-1-n],\\ M\\ \\text{奇} &&\\to\\ H(0)=H(\\pi)=0,\\ \\text{只能做带通} \\\\ &\\text{IV 型：} h[n]=-h[M-1-n],\\ M\\ \\text{偶} &&\\to\\ H(0)=0,\\ \\text{不能做低通} \\end{aligned}',
      plain: '只要系数对称（I、II 型）或反对称（III、IV 型），相位就是严格线性的，群延迟恒为 $(M-1)/2$ 个样本。但不同类型在 $\\omega = 0$ 和 $\\pi$ 处有固定的零点，限制了能做的滤波器种类。',
      vars: [
        ['$M$', '抽头数（系数个数）'],
        ['$(M-1)/2$', '群延迟（样本数），整数或半整数'],
        ['$A(\\omega)$', '实幅度函数，可正可负'],
        ['$\\omega = 0,\\ \\pi$', '固定零点出现的位置']
      ],
      usage: '① 低通/带阻优先用 I 型 ② 高通/带通不要用 II 型（$\\pi$ 处强制为零）③ 需要 90° 移相（希尔伯特变换器）用 III、IV 型。单位：样本。',
      assume: 'FIR；系数严格对称或反对称。',
      fail: '最常踩的坑是用 II 型（偶数抽头对称）去设计高通，结果 $\\omega = \\pi$ 处必然为零，高频怎么都提不上去。另外系数对称在定点实现中被量化破坏后，线性相位会有微小偏差，对相位敏感的相参处理（如波束形成）会引入阵元间相位误差，抬高旁瓣。',
      tags: ['线性相位', 'FIR', '群延迟', '对称性'],
      see: 'theory/filter/linear-phase'
    },
    {
      id: 'F-10', cat: 'filter',
      name: '理想低通的冲激响应',
      en: 'Ideal Low-Pass Impulse Response',
      tex: 'h_d[n] = \\frac{\\sin\\!\\bigl(\\omega_c (n-\\alpha)\\bigr)}{\\pi\\,(n-\\alpha)},\\quad n \\neq \\alpha;\\qquad h_d[\\alpha] = \\frac{\\omega_c}{\\pi},\\quad \\alpha = \\frac{M-1}{2}',
      plain: '理想"砖墙"低通对应的冲激响应是无限长的 sinc 函数，向两侧缓慢衰减（$1/n$）。要用 FIR 实现就必须截断——截断就是加窗，于是产生了吉布斯现象。',
      vars: [
        ['$\\omega_c$', '归一化截止角频率（rad/样本），$\\omega_c = 2\\pi f_c / f_s$'],
        ['$\\alpha = (M-1)/2$', '群延迟（样本数），保证因果与对称'],
        ['$M$', '抽头数，应为奇数以取 I 型']
      ],
      usage: '① 由截止频率算 $\\omega_c$ ② 取 $M$ 为奇数、中心 $\\alpha$ 为整数 ③ 逐点代入 sinc ④ $n = \\alpha$ 处单独用极限值 $\\omega_c/\\pi$。单位：rad/样本。',
      assume: '理想矩形频响；线性相位；FIR。',
      fail: '直接截断（矩形窗）得到的滤波器阻带衰减只有约 21 dB，过渡带宽度约 $4\\pi/M$，两边都常常不达标。而且 sinc 的 $1/n$ 衰减很慢，即使取 200 抽头也压不住远端旁瓣。工程上必须用非矩形窗或 Parks–McClellan 等波纹设计。',
      tags: ['理想低通', 'sinc', '吉布斯现象', 'FIR'],
      see: 'theory/filter/win-design'
    },
    {
      id: 'F-11', cat: 'filter',
      name: '窗函数法设计 FIR',
      en: 'Windowed FIR Design',
      tex: 'h[n] = h_d[n]\\,w[n],\\qquad 0 \\le n < M',
      plain: '把理想的无限长冲激响应乘以一个有限长窗，就得到可用的 FIR 系数。窗的形状决定阻带衰减，窗的长度决定过渡带宽度。',
      vars: [
        ['$h_d[n]$', '理想冲激响应（无限长）'],
        ['$w[n]$', '窗序列，长度 $M$'],
        ['$M$', '抽头数，过渡带宽度约 $\\Delta\\omega \\approx A/M$（$A$ 由窗型定，汉宁约 3.1、布莱克曼约 5.5）']
      ],
      usage: '① 由阻带衰减要求选窗（汉宁 −44 dB、汉明 −53 dB、布莱克曼 −74 dB）② 由过渡带要求定 $M$ ③ 相乘得系数 ④ 验证对称性与通带纹波。单位：样本。',
      assume: '理想响应已知；窗为对称有限长序列。',
      fail: '窗函数法无法独立控制通带纹波与阻带衰减，也无法指定不同频段的不同权重——这两点只能靠 Parks–McClellan（remez）等波纹设计。另外窗函数法对"截止频率取在 −6 dB 点"这一约定依赖很强，若设计规格写的是 −3 dB 截止，直接套用会差出百分之几的带宽。',
      tags: ['窗函数法', 'FIR设计', '凯泽窗', '滤波器设计'],
      see: 'theory/filter/win-design'
    },
    {
      id: 'F-12', cat: 'filter',
      name: '凯泽窗表达式',
      en: 'Kaiser Window',
      tex: 'w[n] = \\frac{I_0\\!\\left(\\beta\\sqrt{1-\\left(\\frac{2n}{M-1}-1\\right)^{2}}\\right)}{I_0(\\beta)},\\qquad 0 \\le n < M',
      plain: '凯泽窗用一个参数 $\\beta$ 在"主瓣宽度"与"旁瓣电平"之间连续调节：$\\beta$ 越大旁瓣越低、主瓣越宽。它近似最优，是窗函数法的默认选择。',
      vars: [
        ['$I_0(\\cdot)$', '第一类零阶修正贝塞尔函数'],
        ['$\\beta$', '形状参数，典型 0—10（0 退化为矩形窗）'],
        ['$M$', '窗长（抽头数）']
      ],
      usage: '① 由阻带指标算 $\\beta$ 与 $M$（见 F-13、F-14）② 数值计算 $I_0$（级数展开即可，收敛很快）③ 与理想冲激响应相乘。',
      assume: '窗为对称序列；$I_0$ 用级数或查表求值。',
      fail: '$I_0$ 在大 $\\beta$ 时自变量可能溢出：分子分母都很大，直接算会丢精度，工程做法是取对数或归一化后计算。另外凯泽窗的设计公式是经验拟合，在极窄过渡带或极高衰减（> 80 dB）时估算的阶数偏乐观，必须迭代验证。',
      tags: ['凯泽窗', '窗函数', 'FIR设计', '贝塞尔'],
      see: 'theory/filter/win-design'
    },
    {
      id: 'F-13', cat: 'filter',
      name: '凯泽窗形状参数 β',
      en: 'Kaiser Beta Parameter',
      tex: '\\beta = \\begin{cases} 0, & A \\le 21 \\\\ 0.5842(A-21)^{0.4} + 0.07886(A-21), & 21 < A \\le 50 \\\\ 0.1102(A-8.7), & A > 50 \\end{cases}',
      plain: '直接从阻带衰减指标 $A$（单位 dB）反解出凯泽窗的 $\\beta$。$A \\le 21$ 用矩形窗就够了，衰减要求越高 $\\beta$ 越大。',
      vars: [
        ['$A$', '阻带衰减（dB），$A = -20\\log_{10}\\delta_s$'],
        ['$\\beta$', '凯泽窗形状参数'],
        ['$\\delta_s$', '阻带纹波（线性值）']
      ],
      usage: '① 由指标得 $A$ ② 按分段公式算 $\\beta$ ③ 若 $\\beta$ 略超要求可向上取整到 0.5 的倍数。例：$A = 60$ dB → $\\beta = 0.1102(60-8.7) = 5.65$。',
      assume: '使用凯泽经验设计公式；过渡带宽度另行确定。',
      fail: '分段公式在 $A = 21$ 与 $A = 50$ 附近存在轻微不连续（两段算出的 $\\beta$ 差 0.1—0.2），跨段设计时应取较大值并做仿真验证。另外 $\\beta > 10$ 后窗的两端趋近零，首尾若干抽头几乎不起作用，等效阶数被浪费，此时不如改用等波纹设计。',
      tags: ['凯泽窗', 'β参数', 'FIR设计', '阻带衰减'],
      see: 'theory/filter/win-design'
    },
    {
      id: 'F-14', cat: 'filter',
      name: '凯泽窗阶数估计',
      en: 'Kaiser Order Estimation',
      tex: 'M \\;\\approx\\; \\frac{A - 8}{2.285\\,\\Delta\\omega} + 1,\\qquad \\Delta\\omega = \\omega_s - \\omega_p',
      plain: '过渡带越窄、阻带衰减越高，所需抽头数越多，且与过渡带宽度成反比。这是估算 FIR 计算量的第一步。',
      vars: [
        ['$A$', '阻带衰减（dB）'],
        ['$\\Delta\\omega$', '归一化过渡带宽度（rad/样本）'],
        ['$M$', '所需抽头数（向上取整，通常取奇数）']
      ],
      usage: '① 把指标换成归一化角频率：$\\Delta\\omega = 2\\pi(f_s^{\\mathrm{spec}} - f_p^{\\mathrm{spec}})/f_s$ ② 代入公式 ③ 向上取整并调成奇数（I 型）。例：$A=60$ dB、$\\Delta f = 100$ Hz、$f_s = 1000$ Hz → $\\Delta\\omega = 0.2\\pi \\approx 0.628$ → $M \\approx 37$。',
      assume: '采用凯泽经验公式；滤波器为 I 型（奇数抽头对称）。',
      fail: '估算结果通常偏乐观 10%—20%，必须仿真验证后再定阶。更要紧的是：当 $\\Delta\\omega$ 很小时（窄过渡带），$M$ 会急剧膨胀，可能出现几百甚至上千抽头，此时直接卷积不现实，要改用多相/多速率结构或 IIR。',
      tags: ['凯泽窗', '阶数估计', 'FIR设计', '计算量'],
      see: 'theory/filter/win-design'
    },
    {
      id: 'F-15', cat: 'filter',
      name: '双线性变换',
      en: 'Bilinear Transformation',
      tex: 's = \\frac{2}{T_s}\\,\\frac{1 - z^{-1}}{1 + z^{-1}},\\qquad H(z) = H_a(s)\\Big|_{s = \\frac{2}{T_s}\\frac{1-z^{-1}}{1+z^{-1}}}',
      plain: '把整个 s 左半平面一一对应地压进 z 平面单位圆内，因此**稳定模拟滤波器变换后必然稳定**，而且不会有混叠（代价是频率轴被非线性压缩）。',
      vars: [
        ['$T_s$', '采样间隔（s），常取 $2/T_s$ 为归一化常数'],
        ['$s$', '拉普拉斯变量'],
        ['$z^{-1}$', '单位延迟']
      ],
      usage: '① 对关键频率做预畸变（见 F-16）② 代入 $s$ ③ 整理成 $z^{-1}$ 的有理式 ④ 得 IIR 系数。单位无量纲。',
      assume: '模拟原型稳定；采用预畸变补偿频率压缩。',
      fail: '频率轴的非线性压缩（$\\Omega = (2/T_s)\\tan(\\omega/2)$）会让宽带或多频点指标全部偏移：一个在模拟域等纹波的滤波器，变换后纹波不再等距。工程上只能对最关键的一两个频率点做预畸变，其余点必然有偏差。另外它不适合做微分器或需要线性频率映射的场合。',
      tags: ['双线性变换', 'IIR设计', '预畸变', '离散化'],
      see: 'theory/filter/bilinear'
    },
    {
      id: 'F-16', cat: 'filter',
      name: '双线性变换的频率预畸变',
      en: 'Frequency Prewarping',
      tex: '\\Omega_c = \\frac{2}{T_s}\\tan\\!\\left(\\frac{\\omega_c}{2}\\right),\\qquad \\omega_c = 2\\arctan\\!\\left(\\frac{\\Omega_c T_s}{2}\\right)',
      plain: '因为双线性变换会把频率轴压缩，所以要先把数字域的关键频率 $\\omega_c$ 用正切"拉伸"成模拟频率 $\\Omega_c$，再去设计模拟原型——这样变换回来，$\\omega_c$ 处才刚好落在指标上。',
      vars: [
        ['$\\omega_c$', '数字域关键角频率（rad/样本）'],
        ['$\\Omega_c$', '预畸变后的模拟角频率（rad/s）'],
        ['$T_s$', '采样间隔（s）']
      ],
      usage: '① 把数字截止频率 $f_c$ 换成 $\\omega_c = 2\\pi f_c/f_s$ ② 用正切公式求 $\\Omega_c$ ③ 按 $\\Omega_c$ 设计模拟原型 ④ 做双线性变换。单位 rad。',
      assume: '只在指定频点预畸变；其余频点仍有偏差。',
      fail: '预畸变只能保证**一个**频点精确。带通滤波器有上下两个截止频率，预畸变后两者的绝对带宽会与数字域设计值不一致（高频端压缩更严重），必须在数字域直接优化或用双线性后再迭代修正。另外 $\\omega$ 接近 $\\pi$ 时正切趋于无穷，预畸变数值爆炸，此时应降低采样率或改用其他设计法。',
      tags: ['预畸变', '双线性变换', 'IIR设计', '频率映射'],
      see: 'theory/filter/bilinear'
    },
    {
      id: 'F-17', cat: 'filter',
      name: '脉冲响应不变法',
      en: 'Impulse Invariance Method',
      tex: 'h[n] = T_s\\,h_a(nT_s),\\qquad H(z) = \\sum_{k} \\frac{A_k}{1 - e^{s_k T_s} z^{-1}}',
      plain: '让数字滤波器的冲激响应等于模拟冲激响应的采样值（乘 $T_s$ 保持增益）。优点是频率映射线性，缺点是存在频谱混叠。',
      vars: [
        ['$h_a(t)$', '模拟滤波器冲激响应'],
        ['$T_s$', '采样间隔（s）'],
        ['$s_k$', '模拟滤波器第 k 个极点'],
        ['$A_k$', '部分分式展开的留数']
      ],
      usage: '① 把 $H_a(s)$ 展开成部分分式 $\\sum_k A_k/(s - s_k)$ ② 逐极点映射 $e^{s_k T_s}$ ③ 合并。单位无量纲。',
      assume: '模拟滤波器带限（严格说不可能）；采样率足够高。',
      fail: '因为模拟滤波器不可能严格带限，混叠必然存在：高通、带阻滤波器在高频端有增益，混叠后阻带指标彻底失效，所以脉冲响应不变法**只适合低通和带通**。即使对低通，若截止频率接近 $f_s/2$，混叠也会把阻带抬高十几 dB。',
      tags: ['脉冲响应不变法', 'IIR设计', '混叠', '离散化'],
      see: 'theory/filter/impulse-inv'
    },
    {
      id: 'F-18', cat: 'filter',
      name: '巴特沃斯滤波器幅度平方',
      en: 'Butterworth Magnitude Response',
      tex: '|H_a(j\\Omega)|^{2} = \\frac{1}{1 + \\left(\\frac{\\Omega}{\\Omega_c}\\right)^{2N}},\\qquad H_a(s) = \\frac{1}{\\prod_{k} (s - s_k)/\\Omega_c}',
      plain: '巴特沃斯是"最大平坦"：在 $\\Omega = 0$ 处尽可能多的导数等于零，代价是过渡带最宽。极点均匀分布在半径为 $\\Omega_c$ 的圆上。',
      vars: [
        ['$N$', '滤波器阶数，$-3\\,\\mathrm{dB}$ 点在 $\\Omega = \\Omega_c$'],
        ['$\\Omega_c$', '截止角频率（rad/s）'],
        ['$s_k$', '极点，$s_k = \\Omega_c e^{j\\pi(2k+N-1)/(2N)}$']
      ],
      usage: '① 由通带、阻带指标解 $N = \\frac{\\log_{10}\\sqrt{(10^{A_s/10}-1)/(10^{A_p/10}-1)}}{\\log_{10}(\\Omega_s/\\Omega_p)}$ ② 求极点 ③ 查表或展开得 $H_a(s)$。',
      assume: '单调下降响应；无纹波要求；幅度平方可实现。',
      fail: '巴特沃斯要达到同样的阻带衰减，阶数远高于切比雪夫或椭圆滤波器，在实时系统里意味着更高的计算量和更大的群延迟。另外高阶巴特沃斯的极点非常靠近单位圆，定点实现时数值稳定性差，通常要拆成二阶节并仔细分配增益。',
      tags: ['巴特沃斯', 'IIR设计', '最大平坦', '滤波器'],
      see: 'theory/filter/iir'
    },
    {
      id: 'F-19', cat: 'filter',
      name: '切比雪夫 I 型滤波器',
      en: 'Chebyshev Type-I Filter',
      tex: '|H_a(j\\Omega)|^{2} = \\frac{1}{1 + \\varepsilon^{2}\\,T_N^{2}\\!\\left(\\frac{\\Omega}{\\Omega_p}\\right)},\\qquad T_N(x)=\\cos\\!\\bigl(N\\arccos x\\bigr)',
      plain: '切比雪夫 I 型把纹波全放在通带（等纹波），换来更窄的过渡带。$\\varepsilon$ 控制通带纹波大小。',
      vars: [
        ['$\\varepsilon$', '纹波参数，$\\varepsilon = \\sqrt{10^{R_p/10} - 1}$'],
        ['$R_p$', '通带纹波（dB），典型 0.5—1 dB'],
        ['$T_N(x)$', 'N 阶切比雪夫多项式'],
        ['$\\Omega_p$', '通带截止角频率（rad/s）']
      ],
      usage: '① 由 $R_p$ 算 $\\varepsilon$ ② 由 $\\varepsilon$ 与阻带指标求 $N$ ③ 由切比雪夫极点公式得 $H_a(s)$ ④ 双线性变换离散化。',
      assume: '通带等纹波、阻带单调；幅度平方可实现。',
      fail: '通带纹波会让通过的信号幅度随频率起伏，对宽带信号（如 LFM 发射波形）引入频谱失真，脉压后旁瓣抬高。若系统要求通带平坦，应选巴特沃斯或切比雪夫 II 型。另外阶数很高时极点分布极不均匀，定点实现的系数量化误差会被严重放大。',
      tags: ['切比雪夫', 'IIR设计', '等纹波', '滤波器'],
      see: 'theory/filter/iir'
    },
    {
      id: 'F-20', cat: 'filter',
      name: '椭圆（考尔）滤波器',
      en: 'Elliptic (Cauer) Filter',
      tex: '|H_a(j\\Omega)|^{2} = \\frac{1}{1 + \\varepsilon^{2}\\,R_N^{2}(\\Omega/\\Omega_p)}',
      plain: '椭圆滤波器在通带和阻带都等纹波，因此**在给定阶数下过渡带最窄**——它是"选择性最优"的选择，代价是两带都有纹波、相位高度非线性。',
      vars: [
        ['$R_N(\\cdot)$', 'N 阶椭圆有理函数（雅可比椭圆函数构造）'],
        ['$\\varepsilon$', '通带纹波参数'],
        ['$N$', '阶数，同时决定通带与阻带纹波']
      ],
      usage: '① 给定通带纹波、阻带衰减与过渡带宽度 ② 用椭圆函数阶数公式求最小 $N$ ③ 查表或用 `ellip` 直接设计。',
      assume: '允许通带与阻带同时存在纹波；幅度平方可实现。',
      fail: '椭圆滤波器的相位非线性极强，群延迟在过渡带附近会出现大幅尖峰，脉冲信号通过后严重畸变——做脉冲压缩、时延估计时必须用 filtfilt 或全通均衡。阻带纹波意味着某些频点衰减不足，若干扰恰好落在那些频点上，抑制效果会比平均值差十几 dB。',
      tags: ['椭圆滤波器', '考尔', 'IIR设计', '等纹波'],
      see: 'theory/filter/iir'
    },
    {
      id: 'F-21', cat: 'filter',
      name: '吉布斯现象与 8.95% 过冲',
      en: 'Gibbs Phenomenon',
      tex: '\\text{过冲量} \\to 0.08949\\ldots \\times (\\text{跳变幅度}),\\qquad \\text{约 } 8.95\\%\\ \\approx 0.82\\ \\mathrm{dB}',
      plain: '用有限项傅里叶级数去逼近一个有跳变的函数，跳变附近会出现固定幅度的过冲。项数增加只会让过冲**变窄**，不会让它变小——极限过冲约为跳变幅度的 8.95%。',
      vars: [
        ['$8.95\\%$', '过冲幅度相对跳变量的比例（单边）'],
        ['$0.82\\ \\mathrm{dB}$', '过冲折算成 dB 约为 0.82 dB'],
        ['$9\\%$', '两侧的"振铃"总摆动量约 18%']
      ],
      usage: '① 出现在理想砖墙滤波器的截断冲激响应上 ② 表现为通带边缘附近的纹波与阻带第一旁瓣（矩形窗时约 −21 dB）③ 加窗可把过冲"摊平"成更宽、更低的纹波。',
      assume: '被逼近函数有第一类间断点；用有限项傅里叶部分和。',
      fail: '很多人以为增加滤波器阶数能消除纹波——不能，只会把纹波挤到更靠近边缘的地方（这是等波纹设计与窗函数法的根本差异）。窗函数法靠加窗把过冲能量摊开，换来更低的旁瓣但更宽的过渡带。吉布斯现象在图像处理里表现为边缘振铃，在谱估计里表现为强信号旁的假峰。',
      tags: ['吉布斯现象', '过冲', 'FIR', '截断'],
      see: 'theory/filter/linear-phase'
    },
    {
      id: 'F-22', cat: 'filter',
      name: '群延迟与相位延迟',
      en: 'Group Delay and Phase Delay',
      tex: '\\tau_g(\\omega) = -\\frac{d\\theta(\\omega)}{d\\omega}\\ \\text{(样本)},\\qquad \\tau_p(\\omega) = -\\frac{\\theta(\\omega)}{\\omega},\\qquad \\tau_{g,\\mathrm{sec}} = \\frac{\\tau_g}{f_s}',
      plain: '相位延迟回答"这个频率的正弦被延后了多少"，群延迟回答"这个频率附近的**包络**被延后了多少"。做波形保真与脉冲压缩，关心的是群延迟。',
      vars: [
        ['$\\theta(\\omega)$', '相位响应（rad）'],
        ['$\\tau_g$', '群延迟（样本，除以 $f_s$ 得秒）'],
        ['$\\tau_p$', '相位延迟（样本）'],
        ['$f_s$', '采样率（Hz）']
      ],
      usage: '① 取相位响应（务必先解缠）② 数值差分求负导数 ③ 检查在通带内是否平坦 ④ 线性相位 FIR 的群延迟恒为 $(M-1)/2$ 样本。单位：样本或秒。',
      assume: '相位可微；无相位跳变（已解缠）；系统稳定。',
      fail: '未解缠的相位直接差分会在 $\\pm\\pi$ 跳变处出现巨大的假尖峰，这是最常见的"群延迟异常"。另外在系统有深零点（如陷波器）处，相位变化极快，群延迟出现尖峰，宽带信号通过的瞬态响应会拉得很长——这在声呐里表现为回波拖尾、距离分辨力下降。',
      tags: ['群延迟', '相位延迟', '线性相位', '失真'],
      see: 'theory/filter/linear-phase'
    },
    {
      id: 'F-23', cat: 'filter',
      name: '零相位滤波 filtfilt',
      en: 'Zero-Phase Filtering',
      tex: 'y[n] = \\mathrm{filter}\\bigl(\\mathrm{reverse}(\\mathrm{filter}(\\mathrm{reverse}(x),\\,b,\\,a)),\\,b,\\,a\\bigr),\\qquad |H_{\\mathrm{eff}}(e^{j\\omega})| = |H(e^{j\\omega})|^{2}',
      plain: '正反各滤波一遍，相位一去一回正好抵消，总相位为零。代价是幅度响应变成原来的平方（阻带衰减翻倍、通带纹波也翻倍），且必须离线处理（需要未来的数据）。',
      vars: [
        ['$H(e^{j\\omega})$', '原滤波器频率响应'],
        ['$|H_{\\mathrm{eff}}|$', '有效幅度响应，等于 $|H|^{2}$（dB 值翻倍）'],
        ['$b,\\,a$', 'IIR/FIR 系数']
      ],
      usage: '① 确认可以离线批处理 ② 对数据首尾做适当延拓（如镜像延拓）以抑制边缘瞬态 ③ 直接调用库函数。注意：dB 指标要按平方重算。',
      assume: '允许非因果（离线）处理；滤波器稳定。',
      fail: 'filtfilt 让幅度平方，若按原指标设计滤波器，实际通带纹波和阻带衰减都会翻倍，通带纹波可能超标（例如原 0.5 dB 变 1 dB）。另一个坑是边缘效应：从零状态开始正反向滤波会在数据首尾产生虚假瞬态，短数据尤其明显，必须先做去趋势或延拓。实时系统完全用不了这个办法。',
      tags: ['零相位', 'filtfilt', '离线处理', '滤波'],
      see: 'theory/filter/fir'
    },
    {
      id: 'F-24', cat: 'filter',
      name: '重叠相加法',
      en: 'Overlap-Add Method',
      tex: 'y[n] = \\sum_{m} y_m[n - mR],\\qquad y_m = \\mathrm{IFFT}\\bigl(\\mathrm{FFT}(x_m)\\,H\\bigr),\\quad L \\ge R + M - 1',
      plain: '把长输入切成重叠为 0 的块，每块补零做 FFT 卷积，输出按块位置错位相加。因为线性卷积输出比输入长 $M-1$，相邻块的输出尾巴正好叠在一起。',
      vars: [
        ['$R$', '分块长度（样本）'],
        ['$M$', '滤波器长度'],
        ['$L$', 'FFT 点数，$L \\ge R + M - 1$（取 2 的整数次幂）'],
        ['$y_m$', '第 m 块的卷积输出，长度 $R + M - 1$']
      ],
      usage: '① 取 $L = 2^{\\lceil \\log_2(R+M-1)\\rceil}$ ② 每块取 $R$ 点补零到 $L$ ③ FFT → 乘 $H$ → IFFT ④ 输出按 $mR$ 错位累加。单位：样本。',
      assume: 'LTI 系统；$H$ 为 $L$ 点 FFT；块间无重叠输入。',
      fail: '最常犯的错是 $L$ 取成 $R$（忘了加 $M-1$），结果块尾出现循环卷积混叠，且这种错误只在块边界 $M-1$ 个样本上显现，肉眼很难发现。另一个工程问题是延迟：分块处理引入至少一个块的延迟，对闭环控制系统可能是致命的。',
      tags: ['重叠相加', '快速卷积', '分块', 'FIR'],
      see: 'theory/filter/conv'
    },
    {
      id: 'F-25', cat: 'filter',
      name: '重叠保留法',
      en: 'Overlap-Save Method',
      tex: 'x_m[n] = x[mR - (M-1) + n],\\ 0 \\le n < L;\\qquad y[mR + n] = y_m[n],\\ M-1 \\le n < L',
      plain: '输入块之间重叠 $M-1$ 个样本，做 $L$ 点循环卷积后**丢弃**每块前 $M-1$ 个被混叠污染的样本，只保留后面干净的部分。',
      vars: [
        ['$M-1$', '重叠样本数，也是每块要丢弃的样本数'],
        ['$L$', 'FFT 点数，通常取 $R + M - 1$ 向上到 2 的幂'],
        ['$R$', '每块新推进的样本数，$R = L - M + 1$']
      ],
      usage: '① 取 $L$ 为 2 的幂 ② 每块取 $L$ 点，其中前 $M-1$ 点来自上一块尾部 ③ FFT → 乘 $H$ → IFFT ④ 丢弃前 $M-1$ 点，输出其余 $R$ 点。单位：样本。',
      assume: '循环卷积长度 $L$；$H$ 为 $L$ 点 FFT；丢弃部分恰好覆盖混叠区。',
      fail: '丢弃点数记错（丢成 $M$ 而不是 $M-1$）会导致输出少一个样本、后续全部错位，这是流式处理里最难查的 bug 之一。另外第一块没有"上一块尾部"，必须补 $M-1$ 个零，若忘记会使开头 $M-1$ 个输出错误。',
      tags: ['重叠保留', '快速卷积', '分块', 'FIR'],
      see: 'theory/filter/conv'
    },
    {
      id: 'F-26', cat: 'filter',
      name: '级联二阶节 SOS',
      en: 'Cascaded Second-Order Sections',
      tex: 'H(z) = \\prod_{k=1}^{K} \\frac{b_{0k} + b_{1k}z^{-1} + b_{2k}z^{-2}}{1 + a_{1k}z^{-1} + a_{2k}z^{-2}},\\qquad y_k[n] \\to \\text{下一节}',
      plain: '把高阶 IIR 拆成一串二阶节级联。每一节只有两个极点，对系数量化不敏感，数值稳定性好得多。这是所有 IIR 工程实现的标配。',
      vars: [
        ['$K$', '二阶节个数，$K = \\lceil N/2 \\rceil$'],
        ['$b_{ik},\\,a_{ik}$', '第 k 节的分子分母系数'],
        ['$g$', '总增益，有时单独提出以改善定点动态范围']
      ],
      usage: '① 用 `tf2sos` 把直接型转成 SOS ② 按"极点靠近单位圆的节放后面"排序 ③ 每节内部做增益归一化 ④ 逐级滤波。无量纲。',
      assume: '系统可分解为一阶/二阶因子的级联；系数可精确表示或已量化。',
      fail: '零极点配对与节顺序对定点实现的信噪比影响巨大：随便配对可能比最优配对差 20 dB 以上。在极窄带滤波器中，极点极靠近单位圆，即使 SOS 也可能不够，需要提高字长或改用状态空间/格型结构。转 SOS 时若忘记把增益正确分配，滤波器整体增益会出错。',
      tags: ['SOS', '二阶节', 'IIR实现', '定点', '稳定性'],
      see: 'theory/filter/iir'
    }

    ,/* ===================== 谱估计 spectrum ===================== */
    {
      id: 'S-01', cat: 'spectrum',
      name: '周期图（直接法）',
      en: 'Periodogram',
      tex: '\\hat{P}_{xx}(e^{j\\omega}) = \\frac{1}{N}\\left|\\sum_{n=0}^{N-1} x[n]\\,e^{-j\\omega n}\\right|^{2}',
      plain: '最朴素的功率谱估计：把一段数据的 DFT 取模平方再除以 $N$。它快、直观，但有个致命毛病——方差不随数据量下降。',
      vars: [
        ['$x[n]$', '一段观测数据，长度 $N$'],
        ['$N$', '数据长度，决定栅格 $f_s/N$（不是分辨率极限）'],
        ['$\\hat{P}_{xx}$', '功率谱估计值（$\\mathrm{V^{2}}$ 或 $\\mathrm{Pa^{2}}$）']
      ],
      usage: '① 去均值（去直流）② 可选加窗 ③ 算 DFT 取模平方除 $N$ ④ 若要功率谱密度再除以 $f_s$ 或按 ENBW 归一化。单位：$\\mathrm{V^{2}}$（功率谱）或 $\\mathrm{V^{2}/Hz}$（功率谱密度）。',
      assume: '数据平稳、各态历经；单次实现；噪声高斯。',
      fail: '周期图不是一致估计：把 $N$ 加大十倍，谱线的随机起伏幅度**一点都不会变小**，只是变密。这是初学者最大的困惑——"为什么我加了这么多数据，谱还是这么毛"。正确做法是分段平均（Bartlett/Welch）或加滞后窗（BT 法），用分辨率换方差。',
      tags: ['周期图', '功率谱', '经典谱估计'],
      see: 'theory/spectrum/classical'
    },
    {
      id: 'S-02', cat: 'spectrum',
      name: '周期图的方差',
      en: 'Variance of the Periodogram',
      tex: '\\mathrm{Var}\\{\\hat{P}_{xx}(e^{j\\omega})\\} \\approx P_{xx}^{2}(e^{j\\omega}),\\qquad \\frac{\\mathrm{std}}{\\mathrm{mean}} \\approx 100\\%',
      plain: '周期图在每个频点上的标准差约等于它自己的均值，也就是说起伏幅度跟信号本身一样大。',
      vars: [
        ['$\\mathrm{Var}$', '估计方差（$\\mathrm{V^{4}}$）'],
        ['$P_{xx}$', '真实功率谱'],
        ['$100\\%$', '相对标准差，χ² 分布自由度 2 的结果']
      ],
      usage: '① 用它判断"要不要平均" ② 平均 K 段后相对标准差降到 $1/\\sqrt{K}$ ③ 要压到 10% 需约 100 段。',
      assume: '高斯白噪声；相邻频点近似独立。',
      fail: '加窗后相邻频点相关，实际方差略小于此式，但仍是"肉眼可见的毛刺"量级。另一个坑：人们常以为"毛刺"是信号特征（尤其是被动声呐里），把噪声起伏当成线谱报上去——必须靠多次观测的稳定性和统计门限来区分。',
      tags: ['周期图', '方差', 'χ²分布', '谱估计'],
      see: 'theory/spectrum/classical'
    },
    {
      id: 'S-03', cat: 'spectrum',
      name: 'Bartlett 平均周期图',
      en: 'Bartlett Averaged Periodogram',
      tex: '\\hat{P}_{B}(e^{j\\omega}) = \\frac{1}{K}\\sum_{k=0}^{K-1}\\hat{P}_{k}(e^{j\\omega}),\\qquad \\mathrm{Var}\\approx\\frac{1}{K}P_{xx}^{2}',
      plain: '把数据切成 K 段互不重叠的小段，各算周期图再平均。方差降为 1/K，代价是每段只有 $N/K$ 点，分辨率也降为 1/K。',
      vars: [
        ['$K$', '分段数，常用 4—8'],
        ['$\\hat{P}_{k}$', '第 k 段的周期图'],
        ['$N/K$', '每段长度（样本）']
      ],
      usage: '① 选 K ② 分段 ③ 每段去均值、加窗、算周期图 ④ 平均 ⑤ 按段长与窗的 ENBW 归一化。单位：$\\mathrm{V^{2}/Hz}$。',
      assume: '各段统计独立；段间不重叠。',
      fail: '段间独立性假设在相邻段有相关时（数据过采样、做过滤波、强线谱）不成立，实际方差下降达不到 K 倍。分段变短后两个靠得近的频率就分不开——这是"用分辨率换方差"的必然代价，不是调参能绕过的。',
      tags: ['Bartlett', '平均周期图', '谱估计'],
      see: 'theory/spectrum/classical'
    },
    {
      id: 'S-04', cat: 'spectrum',
      name: 'Welch 法（分段加窗平均）',
      en: "Welch's Method",
      tex: '\\hat{P}_{W}(e^{j\\omega}) = \\frac{1}{K}\\sum_{k=0}^{K-1}\\frac{1}{N U}\\left|\\sum_{n=0}^{N-1} x_k[n]\\,w[n]\\,e^{-j\\omega n}\\right|^{2},\\qquad U = \\frac{1}{N}\\sum_{n=0}^{N-1} w^{2}[n]',
      plain: 'Welch = 分段 + 加窗 + 段间重叠（通常 50%）。重叠让段数变多、方差更小，同时段长不至于太短。这是工程上用得最多的经典谱估计。',
      vars: [
        ['$K$', '有效段数（含重叠带来的增量）'],
        ['$N$', '每段长度（样本）'],
        ['$U$', '窗的均方值，用于功率归一化'],
        ['重叠比例', '常用 50%（汉宁窗下最优），75% 收益已很小']
      ],
      usage: '① 定段长 $N$（由分辨率需求决定）② 定重叠（50%）③ 逐段加窗算周期图 ④ 平均 ⑤ 除以 $U$ 完成 PSD 归一化。单位：$\\mathrm{V^{2}/Hz}$。',
      assume: '段间近似独立；窗已知；信号在段内平稳。',
      fail: '重叠越多段间越相关，方差下降会饱和，超过 50% 后收益很小。段长是分辨率的硬约束，Welch 无法突破——要更高分辨率得上参数模型或子空间方法。另外忘记除以 $U$ 会让绝对电平错 1—3 dB，水声计量标定直接不合格。',
      tags: ['Welch', '功率谱', '分段平均', '声呐'],
      see: 'theory/spectrum/classical'
    },
    {
      id: 'S-05', cat: 'spectrum',
      name: 'Blackman-Tukey 法（间接法）',
      en: 'Blackman-Tukey Method',
      tex: '\\hat{P}_{BT}(e^{j\\omega}) = \\sum_{m=-(M-1)}^{M-1} \\hat{R}_{xx}[m]\\,w[m]\\,e^{-j\\omega m}',
      plain: '先估自相关，再给它加一个"滞后窗"后做傅里叶变换。本质是对周期图做一次频域平滑。',
      vars: [
        ['$M$', '最大滞后（样本），决定平滑程度'],
        ['$\\hat{R}_{xx}[m]$', '自相关估计（用有偏估计）'],
        ['$w[m]$', '滞后窗，必须保证功率谱非负']
      ],
      usage: '① 估自相关到 $M-1$ ② 加滞后窗（Bartlett 窗可保证非负）③ 做 DTFT ④ 检查谱是否出现负值。单位：$\\mathrm{V^{2}/Hz}$。',
      assume: '自相关估计可靠；滞后窗选择合适。',
      fail: '自相关在大滞后处估计方差极大，若 $M$ 取得过大会把噪声放大，出现假的谱峰。更要命的是滞后窗选得不好（如矩形滞后窗）会让功率谱出现**负值**，物理上无意义，且后续做积分或对数运算时会出错；必须用 Bartlett（三角）等正定滞后窗。',
      tags: ['BT法', '自相关', '滞后窗', '谱估计'],
      see: 'theory/spectrum/classical'
    },
    {
      id: 'S-06', cat: 'spectrum',
      name: '分辨率与方差的权衡',
      en: 'Resolution-Variance Tradeoff',
      tex: '\\Delta f \\approx k_w\\,\\frac{f_s}{N_{\\mathrm{seg}}},\\qquad \\frac{\\mathrm{std}}{\\mathrm{mean}} \\approx \\frac{1}{\\sqrt{K}},\\qquad N_{\\mathrm{seg}}\\,K \\approx N',
      plain: '分辨率由段长决定，方差由段数决定，而段长乘段数约等于总数据量。所以数据总量固定时，分辨率与方差只能二选一——这是谱估计版的"不确定原理"。',
      vars: [
        ['$N_{\\mathrm{seg}}$', '每段长度（样本），决定分辨率'],
        ['$K$', '段数，决定方差'],
        ['$k_w$', '窗的主瓣展宽系数（矩形 0.886、汉宁约 1.5）']
      ],
      usage: '① 先定能接受的最粗分辨率 → 定 $N_{\\mathrm{seg}}$ ② 算 $K = N/N_{\\mathrm{seg}}$ ③ 检查 $1/\\sqrt{K}$ 是否满足方差要求 ④ 不满足只能加数据。单位：Hz。',
      assume: '总数据量固定；过程平稳。',
      fail: '很多人试图"既要又要"，反复调重叠比例和窗型，结果只是把误差从一个地方挪到另一个地方。真正的出路只有三条：加数据量（延长观测）、换模型（参数化方法）、或接受分辨率损失。这在验收指标谈判阶段必须提前说清楚，否则后期无法收场。',
      tags: ['分辨率', '方差', '权衡', '谱估计'],
      see: 'theory/spectrum/classical'
    },
    {
      id: 'S-07', cat: 'spectrum',
      name: '自相关函数估计（有偏/无偏）',
      en: 'Autocorrelation Estimate',
      tex: '\\hat{R}_{xx}[m] = \\frac{1}{N}\\sum_{n=|m|}^{N-1} x[n]\\,x^{*}[n-|m|]\\ \\text{(有偏)};\\qquad \\hat{R}_{\\mathrm{unb}}[m] = \\frac{1}{N-|m|}\\sum_{n=|m|}^{N-1} x[n]\\,x^{*}[n-|m|]',
      plain: '有偏估计（除以固定的 $N$）保证正定、方差小；无偏估计（除以 $N-|m|$）在大滞后处方差爆炸。工程上一律用有偏估计。',
      vars: [
        ['$N$', '数据长度（样本）'],
        ['$m$', '滞后（样本），$|m| < N$'],
        ['$x[n]$', '去均值后的序列']
      ],
      usage: '① 去均值 ② 用 FFT 快速算（补零到至少 $2N-1$）③ 一般只信任 $m \\le N/10$ 的结果。单位：$\\mathrm{V^{2}}$。',
      assume: '过程平稳、各态历经。',
      fail: '用无偏估计得到的自相关序列不保证正定，做谱估计会出现负功率；做矩阵求逆（如 MVDR）时更会直接数值崩溃。另外 $m$ 接近 $N$ 时只剩极少样本参与平均，图上那条"缓慢起伏的长尾"往往是纯噪声，拿它做周期检测会得到假线谱。',
      tags: ['自相关', '估计', '有偏', '随机信号'],
      see: 'theory/random/correlation'
    },
    {
      id: 'S-08', cat: 'spectrum',
      name: '维纳—辛钦定理',
      en: 'Wiener-Khinchin Theorem',
      tex: 'P_{xx}(e^{j\\omega}) = \\sum_{m=-\\infty}^{\\infty} R_{xx}[m]\\,e^{-j\\omega m},\\qquad R_{xx}[m] = \\frac{1}{2\\pi}\\int_{-\\pi}^{\\pi} P_{xx}(e^{j\\omega})\\,e^{j\\omega m}\\,d\\omega',
      plain: '平稳随机过程的自相关函数与功率谱密度恰好构成一对傅里叶变换。这是全部谱估计的理论基石。',
      vars: [
        ['$R_{xx}[m]$', '自相关函数（$\\mathrm{V^{2}}$）'],
        ['$P_{xx}(e^{j\\omega})$', '功率谱密度（$\\mathrm{V^{2}}$ 每 rad/样本）'],
        ['$m$', '滞后（样本）']
      ],
      usage: '① 估自相关 → 变换得 PSD（BT 法）② 或反过来由 PSD 求自相关 ③ 单位：$\\mathrm{V^{2}}$ 与 $\\mathrm{V^{2}/Hz}$。',
      assume: '过程宽平稳（均值常数、自相关只依赖滞后）。',
      fail: '只适用于**平稳**过程。水声信道、目标回波、海面混响都是非平稳或起伏的，此时"功率谱"严格说不定义，只能做时变谱（谱图/STFT）或对短时段近似平稳处理。把非平稳数据硬套平稳谱估计，得到的是"时间平均谱"，会掩盖真实的时变特征——这正是瞬态目标检测失败的原因之一。',
      tags: ['维纳辛钦', '功率谱', '自相关', '随机信号'],
      see: 'theory/random/psd'
    },
    {
      id: 'S-09', cat: 'spectrum',
      name: 'AR(p) 模型功率谱',
      en: 'AR(p) Spectral Estimate',
      tex: 'P_{AR}(f) = \\frac{\\sigma_{w}^{2}}{\\left|\\,1 + \\sum_{k=1}^{p} a_{k}\\,e^{-j2\\pi f k}\\,\\right|^{2}}',
      plain: '假设信号由白噪声激励一个 p 阶全极点滤波器产生，功率谱就等于滤波器频响模平方乘激励方差。极点越靠近单位圆，谱峰越尖锐——这就是"超分辨"的来源。',
      vars: [
        ['$a_k$', 'AR 系数，$k = 1,\\dots,p$'],
        ['$\\sigma_{w}^{2}$', '激励白噪声方差'],
        ['$p$', '模型阶数'],
        ['$f$', '归一化频率（$0 \\le f \\le 1$，对应 $f_s$）']
      ],
      usage: '① 定阶 p（用 AIC/MDL 或经验）② 用 Yule-Walker / Burg / 协方差法估 $a_k$ ③ 估 $\\sigma_w^{2}$ ④ 代入算谱并取 dB。单位：$\\mathrm{V^{2}/Hz}$。',
      assume: '信号确实是 AR 过程（或可用 AR 很好近似）；阶数合适；噪声白。',
      fail: '阶数选错是最大风险：p 过小谱峰被抹平（分辨率损失），p 过大会产生**虚假谱峰**——把噪声当成信号。被动声呐线谱检测里这是灾难性的，会报出根本不存在的目标。AR 谱还对信噪比敏感，低 SNR 下谱峰位置漂移、甚至分裂。另外 AR 不擅长刻画有深零点的谱（那需要 MA 部分）。',
      tags: ['AR模型', '参数模型', '超分辨', '声呐'],
      see: 'theory/spectrum/parametric'
    },
    {
      id: 'S-10', cat: 'spectrum',
      name: 'ARMA 模型功率谱',
      en: 'ARMA Spectral Estimate',
      tex: 'P_{ARMA}(f) = \\sigma_{w}^{2}\\left|\\frac{1 + \\sum_{k=1}^{q} b_{k}\\,e^{-j2\\pi f k}}{1 + \\sum_{k=1}^{p} a_{k}\\,e^{-j2\\pi f k}}\\right|^{2}',
      plain: '既有极点（产生峰）又有零点（产生谷），表达能力比纯 AR 强，能刻画"既有尖峰又有深谷"的真实谱形。',
      vars: [
        ['$p,\\,q$', 'AR 与 MA 的阶数'],
        ['$a_k,\\,b_k$', 'AR 与 MA 系数'],
        ['$\\sigma_{w}^{2}$', '激励方差']
      ],
      usage: '① 定阶 (p, q) ② 先拟合高阶 AR 得到残差序列，再对残差拟合 MA；或直接用最大似然/迭代最小二乘 ③ 估参数 ④ 代入算谱。单位：$\\mathrm{V^{2}/Hz}$。',
      assume: '阶数已知或已由 AIC/MDL 确定；过程平稳且可逆。',
      fail: 'ARMA 参数估计不再是线性问题，需要迭代非线性优化，存在**局部极小**与收敛失败；MA 部分的估计方差大，容易给出不可靠的零点位置。工程上若只需谱峰，通常先上 AR；确实需要刻画谱谷（如海面混响的多普勒凹槽）才动用 ARMA。',
      tags: ['ARMA', '参数模型', '谱估计'],
      see: 'theory/spectrum/parametric'
    },
    {
      id: 'S-11', cat: 'spectrum',
      name: 'Yule-Walker 方程',
      en: 'Yule-Walker Equations',
      tex: '\\sum_{k=1}^{p} a_{k}\\,R_{xx}[m-k] = -R_{xx}[m],\\quad m = 1,\\dots,p;\\qquad \\sigma_{w}^{2} = R_{xx}[0] + \\sum_{k=1}^{p} a_{k}\\,R_{xx}[k]',
      plain: 'AR 系数与自相关之间的一组线性方程，系数矩阵是 Toeplitz 矩阵（每条对角线元素相同），因此有 $O(p^{2})$ 的快速解法。',
      vars: [
        ['$a_k$', '待求 AR 系数'],
        ['$R_{xx}[m]$', '自相关函数'],
        ['$p$', '模型阶数']
      ],
      usage: '① 估出自相关 $R_{xx}[0..p]$ ② 列 Toeplitz 方程组 ③ 用 Levinson-Durbin 求解（不要直接高斯消元）④ 代回求 $\\sigma_w^{2}$。',
      assume: '自相关估计已知；过程为 AR(p)。',
      fail: 'Yule-Walker 使用有偏自相关估计，在**短数据**下谱峰有明显偏差，分辨率不如 Burg 与协方差法；对窄带正弦，谱峰位置会随初相漂移。另外若数据含噪声，Yule-Walker 会把噪声一同建模，谱峰被"拉宽"，看起来像宽带分量。',
      tags: ['Yule-Walker', 'AR模型', 'Toeplitz'],
      see: 'theory/spectrum/parametric'
    },
    {
      id: 'S-12', cat: 'spectrum',
      name: 'Levinson-Durbin 递推',
      en: 'Levinson-Durbin Recursion',
      tex: 'k_{m} = \\frac{R[m] + \\sum_{i=1}^{m-1} a_{m-1}[i]\\,R[m-i]}{E_{m-1}},\\qquad a_{m}[i] = a_{m-1}[i] + k_{m}\\,a_{m-1}^{*}[m-i],\\qquad E_{m} = (1-|k_{m}|^{2})\\,E_{m-1}',
      plain: '从 m−1 阶到 m 阶的递推，每步只需 $O(m)$ 运算，整体 $O(p^{2})$。反射系数 $k_m$ 的模必须小于 1，这恰好保证了滤波器稳定。',
      vars: [
        ['$k_{m}$', '第 m 阶反射系数（$|k_{m}| < 1$）'],
        ['$E_{m}$', '第 m 阶预测误差功率'],
        ['$a_{m}[i]$', '第 m 阶预测（AR）系数']
      ],
      usage: '① 初始化 $E_{0} = R[0]$ ② 对 $m = 1,\\dots,p$ 递推 ③ 每步检查 $|k_{m}| < 1$ ④ 输出 $a_{p}[i]$ 与 $E_{p} = \\sigma_{w}^{2}$。无量纲。',
      assume: '自相关矩阵为正定 Toeplitz 矩阵；实数或复数序列均适用。',
      fail: '递推对舍入误差有累积效应，阶数很高（$p > 50$）时反射系数可能突破单位圆、滤波器失稳，需要改用格型结构或提高字长。若自相关是从很短的数据估出来的，Toeplitz 矩阵接近奇异，解出的参数极不可靠，谱上会出现随机乱峰。',
      tags: ['Levinson-Durbin', '递推', 'AR模型', 'Toeplitz'],
      see: 'theory/spectrum/parametric'
    },
    {
      id: 'S-13', cat: 'spectrum',
      name: 'Burg 法与反射系数',
      en: "Burg's Method and Reflection Coefficients",
      tex: 'k_{m} = \\frac{-2\\sum_{n=m}^{N-1} f_{m-1}[n]\\,b_{m-1}^{*}[n-1]}{\\sum_{n=m}^{N-1}\\left(|f_{m-1}[n]|^{2} + |b_{m-1}[n-1]|^{2}\\right)},\\qquad f_{m}[n] = f_{m-1}[n] + k_{m}\\,b_{m-1}[n-1]',
      plain: 'Burg 法直接在前向与后向预测误差上最小化，不经过自相关估计。它对短数据友好、谱峰锐利，是被动声呐线谱分析的主力方法。',
      vars: [
        ['$f_{m}[n]$', '第 m 阶前向预测误差'],
        ['$b_{m}[n]$', '第 m 阶后向预测误差'],
        ['$k_{m}$', '第 m 阶反射系数']
      ],
      usage: '① 初始化 $f_{0}[n] = b_{0}[n] = x[n]$ ② 逐阶求 $k_{m}$ ③ 更新误差 ④ 用 Levinson-Durbin 得 AR 系数。',
      assume: '数据平稳；$|k_{m}| < 1$。',
      fail: 'Burg 法有著名的**谱峰分裂**（line splitting）问题：对纯正弦且数据长度接近整数周期时，一个谱峰会裂成两个；还有**谱峰偏移**（频率随初相变化）。高阶时这些问题更明显。缓解办法是改用改进的协方差法或人为加一点噪声。',
      tags: ['Burg法', '反射系数', 'AR模型', '声呐'],
      see: 'theory/spectrum/parametric'
    },
    {
      id: 'S-14', cat: 'spectrum',
      name: 'AIC 定阶准则',
      en: 'Akaike Information Criterion',
      tex: '\\mathrm{AIC}(p) = N\\ln\\hat{\\sigma}_{p}^{2} + 2p,\\qquad \\hat{p} = \\arg\\min_{p}\\mathrm{AIC}(p)',
      plain: '在"拟合残差变小"与"参数变多"之间做惩罚平衡，用来自动选 AR 阶数。惩罚项是 $2p$。',
      vars: [
        ['$N$', '样本数'],
        ['$\\hat{\\sigma}_{p}^{2}$', 'p 阶模型的残差方差'],
        ['$p$', '候选阶数']
      ],
      usage: '① 对 $p = 0,\\dots,P_{\\max}$ 依次拟合 ② 算 AIC ③ 取最小者。无量纲。',
      assume: '数据来自 AR 过程；残差近似高斯；样本较多。',
      fail: 'AIC **不是一致估计**——样本再多也会以一定概率过估阶数，在被动声呐里表现为额外的假谱峰。样本量小或信噪比低时，AIC 与 MDL 给出的答案经常不一样，此时必须结合物理先验（例如已知目标最多几根线谱、轴频与叶频的倍数关系）做人工干预，不能盲信准则。',
      tags: ['AIC', '定阶', 'AR模型', '模型选择'],
      see: 'theory/spectrum/parametric'
    },
    {
      id: 'S-15', cat: 'spectrum',
      name: 'MDL 定阶准则',
      en: 'Minimum Description Length',
      tex: '\\mathrm{MDL}(p) = N\\ln\\hat{\\sigma}_{p}^{2} + p\\,\\ln N,\\qquad \\hat{p} = \\arg\\min_{p}\\mathrm{MDL}(p)',
      plain: '与 AIC 思路相同，但惩罚项是 $p\\ln N$ 而非 $2p$，惩罚更重，因此是**一致**的（样本趋于无穷时收敛到真阶），代价是小样本下容易欠估。',
      vars: [
        ['$N$', '样本数'],
        ['$\\hat{\\sigma}_{p}^{2}$', 'p 阶模型残差方差'],
        ['$p$', '候选阶数']
      ],
      usage: '用法同 AIC；工程中常两条准则一起算，结果不同时取较大阶数并做人工核验。',
      assume: '同 AIC。',
      fail: '小样本下 MDL 可能把真实谱峰"抹掉"（欠估），在只有几百个点的数据上尤其明显。实际做法是：AIC 给出上限、MDL 给出下限，再做阶数扫描看谱是否稳定——若某几根谱峰在很宽的阶数范围内都稳定存在，那才是可信的；只在某个特定阶数下出现的峰一定要打折。',
      tags: ['MDL', '定阶', '模型选择', 'AR模型'],
      see: 'theory/spectrum/parametric'
    },
    {
      id: 'S-16', cat: 'spectrum',
      name: '阵列协方差与子空间分解',
      en: 'Covariance Matrix and Subspace Decomposition',
      tex: '\\mathbf{R} = E\\{\\mathbf{x}\\mathbf{x}^{H}\\} = \\mathbf{A}\\,\\mathbf{R}_{ss}\\,\\mathbf{A}^{H} + \\sigma_{n}^{2}\\mathbf{I} = \\mathbf{U}_{s}\\mathbf{\\Lambda}_{s}\\mathbf{U}_{s}^{H} + \\mathbf{U}_{n}\\mathbf{\\Lambda}_{n}\\mathbf{U}_{n}^{H}',
      plain: '把协方差矩阵特征分解，大特征值张成信号子空间，与它正交的剩下部分就是噪声子空间。所有子空间类方法都建立在这条正交性上。',
      vars: [
        ['$\\mathbf{R}$', '阵列协方差矩阵（$M \\times M$，$M$ 为阵元数）'],
        ['$\\mathbf{A}$', '阵列流形矩阵，列为各方向导向矢量'],
        ['$\\mathbf{U}_s$', '信号子空间，维数等于信源数 $D$'],
        ['$\\mathbf{U}_n$', '噪声子空间，维数 $M - D$'],
        ['$\\sigma_n^{2}$', '噪声功率']
      ],
      usage: '① 由 K 个快拍估 $\\hat{\\mathbf{R}} = \\frac{1}{K}\\sum_{k} \\mathbf{x}_k \\mathbf{x}_k^{H}$ ② 特征分解 ③ 按特征值大小（或用 AIC/MDL）定信号子空间维数 $D$。',
      assume: '噪声空间白；信源数 $D < M$；快拍数足够；信源不相干。',
      fail: '若信源相干（多途传播、镜像反射是水声常态），$\\mathbf{R}_{ss}$ 奇异，信号子空间维数塌缩，MUSIC/ESPRIT 直接失效，必须先做空间平滑。另外有限快拍下特征值有散布，靠"看特征值跳变"定 D 极不可靠，尤其低信噪比时信号特征值可能淹没在噪声特征值里。',
      tags: ['子空间', '协方差', '特征分解', '阵列'],
      see: 'theory/spectrum/subspace'
    },
    {
      id: 'S-17', cat: 'spectrum',
      name: 'MUSIC 伪谱',
      en: 'MUSIC Pseudo-Spectrum',
      tex: 'P_{\\mathrm{MUSIC}}(\\theta) = \\frac{1}{\\mathbf{a}^{H}(\\theta)\\,\\mathbf{U}_{n}\\mathbf{U}_{n}^{H}\\,\\mathbf{a}(\\theta)} = \\frac{1}{\\|\\mathbf{U}_{n}^{H}\\mathbf{a}(\\theta)\\|^{2}}',
      plain: '扫描所有方向：若导向矢量落在信号子空间里，它与噪声子空间正交，分母趋于零，谱上出现尖峰。因为它不是真正的功率谱（不满足能量守恒），所以叫"伪谱"。',
      vars: [
        ['$\\mathbf{a}(\\theta)$', '扫描方向的导向矢量（$M \\times 1$）'],
        ['$\\mathbf{U}_{n}$', '噪声子空间特征向量矩阵'],
        ['$D$', '信源数，决定 $\\mathbf{U}_{n}$ 的列数']
      ],
      usage: '① 估 $\\hat{\\mathbf{R}}$ ② 特征分解取后 $M - D$ 个特征向量组成 $\\mathbf{U}_{n}$ ③ 在角度网格上算 $P(\\theta)$ ④ 取前 $D$ 个峰作为 DOA。单位：dB（相对值）。',
      assume: '信源数 D 已知；噪声空间白；信源不相干；阵列已校准。',
      fail: '信源数猜错就全盘皆输：D 估大了出现假峰，估小了真实目标消失。阵列幅相误差、互耦、阵元位置偏差会直接破坏正交性——MUSIC 的超高精度在实际系统上往往只兑现一小部分，这就是"实验室 0.1 度、海上 3 度"的由来。相干源必须先做空间平滑。',
      tags: ['MUSIC', '子空间', '超分辨', 'DOA', '声呐'],
      see: 'theory/spectrum/subspace'
    },
    {
      id: 'S-18', cat: 'spectrum',
      name: 'ESPRIT 旋转不变估计',
      en: 'ESPRIT (Estimation of Signal Parameters via Rotational Invariance)',
      tex: '\\mathbf{U}_{s2} = \\mathbf{U}_{s1}\\,\\mathbf{\\Psi},\\qquad \\mathbf{\\Psi} = \\mathbf{T}^{-1}\\mathbf{\\Phi}\\,\\mathbf{T},\\qquad \\mathbf{\\Phi} = \\mathrm{diag}\\!\\left\\{e^{j\\frac{2\\pi d}{\\lambda}\\sin\\theta_{1}},\\dots,e^{j\\frac{2\\pi d}{\\lambda}\\sin\\theta_{D}}\\right\\}',
      plain: '把阵列分成两个完全相同的子阵，它们只差一个由波程决定的相位旋转。信号子空间的这个旋转矩阵的特征值直接给出各目标的空间相位，无需角度搜索，计算量远低于 MUSIC。',
      vars: [
        ['$\\mathbf{U}_{s1},\\,\\mathbf{U}_{s2}$', '上下两个子阵的信号子空间'],
        ['$\\mathbf{\\Psi}$', '旋转矩阵，由两子阵信号子空间的最小二乘解得到'],
        ['$\\mathbf{\\Phi}$', '对角矩阵，对角元即各信源的空间相位因子'],
        ['$d,\\ \\lambda$', '子阵间距（m）与波长（m）']
      ],
      usage: '① 构造两个平移不变子阵 ② 分别特征分解取信号子空间 ③ 用最小二乘或总体最小二乘（TLS）解 $\\mathbf{\\Psi}$ ④ 求特征值 $\\phi_i$，再反解 $\\theta_i = \\arcsin\\!\\bigl(\\tfrac{\\lambda}{2\\pi d}\\angle\\phi_{i}\\bigr)$。单位 rad。',
      assume: '阵列具有平移不变结构（如均匀线阵）；两子阵已校准一致。',
      fail: 'ESPRIT 要求严格的平移不变性，阵元位置误差与互耦会直接破坏这个结构，性能下降比 MUSIC 更明显。子阵间距 $d$ 若超过 λ/2，$ \\angle\\phi_i$ 会出现 $2\\pi$ 模糊（$\\arcsin$ 多值），必须用长短基线组合或参差阵来解模糊。',
      tags: ['ESPRIT', '子空间', '旋转不变', 'DOA'],
      see: 'theory/spectrum/subspace'
    },
    {
      id: 'S-19', cat: 'spectrum',
      name: 'Pisarenko 谐波分解',
      en: 'Pisarenko Harmonic Decomposition',
      tex: 'P_{\\mathrm{Pis}}(f) = \\frac{1}{\\left|\\,\\mathbf{e}_{\\min}^{H}\\,\\mathbf{a}(f)\\,\\right|^{2}},\\qquad \\mathbf{R}\\,\\mathbf{e}_{\\min} = \\lambda_{\\min}\\,\\mathbf{e}_{\\min}',
      plain: '取协方差矩阵最小特征值对应的特征向量当作噪声子空间，构造类似 MUSIC 的谱。它是子空间方法的历史起点，也可看作 MUSIC 在 $D = M - 1$ 时的特例。',
      vars: [
        ['$\\mathbf{e}_{\\min}$', '最小特征值对应的特征向量'],
        ['$\\lambda_{\\min}$', '最小特征值，即噪声功率估计'],
        ['$\\mathbf{a}(f)$', '频率扫描矢量']
      ],
      usage: '① 估 $\\mathbf{R}$ ② 求最小特征值与特征向量 ③ 代入算谱 ④ 谱峰给出频率估计。',
      assume: '噪声为空间白噪声且功率等于最小特征值；模型阶数正确。',
      fail: 'Pisarenko 只用一个特征向量，统计效率很低，有限快拍下方差远大于 MUSIC 与 ESPRIT；而且它假设噪声方差恰等于最小特征值，一旦模型阶数或噪声假设有偏差，频率估计会明显偏移。工程上已被 MUSIC 取代，主要作为理解子空间方法的教学阶梯。',
      tags: ['Pisarenko', '子空间', '谐波分解', '频率估计'],
      see: 'theory/spectrum/subspace'
    },
    {
      id: 'S-20', cat: 'spectrum',
      name: '空间平滑（解相干预处理）',
      en: 'Spatial Smoothing',
      tex: '\\bar{\\mathbf{R}} = \\frac{1}{L}\\sum_{l=1}^{L} \\mathbf{R}_{l},\\qquad \\mathbf{R}_{l} = \\mathbf{Z}_{l}\\,\\mathbf{R}\\,\\mathbf{Z}_{l}^{H}',
      plain: '把阵列分成 L 个互相重叠的子阵，各自求协方差再平均。相干源在不同子阵上的相位关系不同，平均后协方差矩阵恢复满秩，MUSIC 之类的方法才能工作。',
      vars: [
        ['$L$', '子阵个数'],
        ['$\\mathbf{Z}_{l}$', '选择矩阵，取出第 l 个子阵对应的若干行'],
        ['$\\mathbf{R}_{l}$', '第 l 个子阵的协方差矩阵（$m \\times m$）']
      ],
      usage: '① 定子阵长度 $m$ 与子阵数 $L$（满足 $M = m + L - 1$）② 取各子阵协方差 ③ 平均 ④ 再跑 MUSIC。',
      assume: '阵列为均匀线阵（ULA）；子阵间平移不变；相干源数不超过可解上限。',
      fail: '空间平滑把有效孔径从 $M$ 降到 $m$，分辨率与可分辨信源数都随之下降——解相干是用孔径换来的。前向平滑最多解 $L/2$ 个相干源，必须用前后向平滑（FBSS）才能用满自由度。对非均匀阵要先做阵列插值，否则平滑无效。',
      tags: ['空间平滑', '解相干', 'MUSIC', '阵列'],
      see: 'theory/spectrum/subspace'
    },

    /* ===================== 阵列 array ===================== */
    {
      id: 'A-01', cat: 'array',
      name: '相邻阵元相位差',
      en: 'Inter-Element Phase Difference',
      tex: '\\Delta\\phi = \\frac{2\\pi d}{\\lambda}\\,\\sin\\theta',
      plain: '平面波斜入射时，相邻阵元接收到的信号之间差一个相位，这个相位由路程差 $d\\sin\\theta$ 决定。整个阵列信号处理的数学都从这里出发。',
      vars: [
        ['$d$', '阵元间距（m），常取 $\\lambda/2$'],
        ['$\\lambda$', '波长（m），$\\lambda = c/f$'],
        ['$\\theta$', '入射方向角（rad 或 deg），本书以阵列正横方向为 $0^{\\circ}$'],
        ['$\\Delta\\phi$', '相邻阵元相位差（rad）']
      ],
      usage: '① 统一角度基准（以正横为 0 还是以阵轴为 0）② 换算 $\\Delta\\phi$ ③ 检查 $d$ 与 $\\lambda$ 的关系防栅瓣。单位：rad。',
      assume: '远场平面波；阵元全向且幅相一致。',
      fail: '角度基准混乱是最常见的低级错误：有的文献以阵轴方向为 0 度，有的以正横为 0 度，混用会让 $\\sin$ 与 $\\cos$ 互换，指向偏 90 度，排查起来极其耗时。近场时波前是球面，"相位差正比于 sinθ"不再成立，必须做近场聚焦（球面波导向矢量）。',
      tags: ['阵列', '相位差', '波程差', '基础'],
      see: 'theory/array/beamforming'
    },
    {
      id: 'A-02', cat: 'array',
      name: '均匀线阵导向矢量',
      en: 'Uniform Linear Array Steering Vector',
      tex: '\\mathbf{a}(\\theta) = \\Bigl[\\,1,\\ e^{j\\frac{2\\pi d}{\\lambda}\\sin\\theta},\\ \\dots,\\ e^{j\\frac{2\\pi d (N-1)}{\\lambda}\\sin\\theta}\\,\\Bigr]^{T}',
      plain: '把所有阵元相对参考阵元的相位因子排成一列，就是导向矢量。它完整描述了"来自 θ 方向的信号在各阵元上呈现什么样子"。',
      vars: [
        ['$N$', '阵元个数'],
        ['$d$', '阵元间距（m）'],
        ['$\\mathbf{a}(\\theta)$', '导向矢量（$N \\times 1$），与信号幅度无关'],
        ['$\\theta$', '来波方向（相对正横）']
      ],
      usage: '① 确定阵列几何（ULA：等间距共线）② 对每个扫描角构造 $\\mathbf{a}(\\theta)$ ③ 供 CBF / MVDR / MUSIC 使用。',
      assume: '阵元等间距、共线；各阵元幅相一致（已校准）；远场窄带。',
      fail: '阵元位置公差、互耦、通道幅相不一致都会让真实的导向矢量偏离理论值，后果是主瓣指向偏移、旁瓣抬高；自适应波束形成更严重——它会把真实目标当成干扰，在主瓣方向打出深零陷，目标直接消失。实际系统必须做阵列校准测量，且要定期复校。',
      tags: ['导向矢量', 'ULA', '阵列', '波束形成'],
      see: 'theory/array/steering'
    },
    {
      id: 'A-03', cat: 'array',
      name: '阵列流形与阵因子',
      en: 'Array Manifold and Array Factor',
      tex: 'B(\\theta) = \\mathbf{w}^{H}\\mathbf{a}(\\theta) = \\sum_{n=0}^{N-1} w_{n}^{*}\\ e^{j\\frac{2\\pi d n}{\\lambda}\\sin\\theta}',
      plain: '波束响应就是权向量与导向矢量的内积。按相位因子加权求和，本质是在空间上做一次定向的傅里叶变换。',
      vars: [
        ['$\\mathbf{w}$', '权向量（$N \\times 1$）'],
        ['$\\mathbf{a}(\\theta)$', '导向矢量'],
        ['$B(\\theta)$', '复波束响应，取模得方向图'],
        ['$w_n$', '第 n 个阵元的复权']
      ],
      usage: '① 设计权向量（均匀加权、切比雪夫加权、自适应）② 在角度网格上扫描并画方向图 ③ 检查主瓣宽度、旁瓣电平、零陷位置。',
      assume: '窄带（阵元间延时可用相移近似）；远场。',
      fail: '窄带假设在宽带信号下失效：不同频率对应的相位差不同，用一套固定权向量会得到随频率变化的波束（波束斜视），宽带能量被散开、增益下降。宽带信号必须做频域或时域宽带波束形成（见 A-16）。',
      tags: ['阵因子', '方向图', '阵列', '波束形成'],
      see: 'theory/array/beamforming'
    },
    {
      id: 'A-04', cat: 'array',
      name: '均匀线阵方向图（Dirichlet 核）',
      en: 'ULA Beam Pattern',
      tex: '|B(\\theta)| = \\left|\\frac{\\sin\\!\\bigl[N\\pi\\tfrac{d}{\\lambda}(\\sin\\theta - \\sin\\theta_{0})\\bigr]}{N\\,\\sin\\!\\bigl[\\pi\\tfrac{d}{\\lambda}(\\sin\\theta - \\sin\\theta_{0})\\bigr]}\\right|',
      plain: '均匀加权时，ULA 的方向图就是 Dirichlet 核（离散版的 sinc）。取 $d = \\lambda/2$ 且正横指向时，第一旁瓣约 −13.26 dB。',
      vars: [
        ['$N$', '阵元数，主瓣宽度约与 $1/N$ 成正比'],
        ['$d$', '阵元间距（m）'],
        ['$\\theta_0$', '波束指向角（相对正横）'],
        ['$\\theta$', '扫描角']
      ],
      usage: '① 用弧度作图 ② 关注 −3 dB 主瓣宽度与第一旁瓣电平 ③ 需要压旁瓣时用切比雪夫或泰勒加权（代价是主瓣变宽）。',
      assume: 'ULA、均匀加权、远场窄带。',
      fail: '实际阵元的指向性、互耦、位置误差会把旁瓣抬高 5—10 dB，理论 −13 dB 常常只能做到 −8 dB；自适应零陷深度也远达不到理论值。另外在大角度扫描时，阵元指向性与互耦随角度变化，方向图会明显畸变，必须用实测或全波仿真修正。',
      tags: ['方向图', 'ULA', '旁瓣', '阵列'],
      see: 'theory/array/directivity'
    },
    {
      id: 'A-05', cat: 'array',
      name: '波束宽度',
      en: 'Beamwidth',
      tex: '\\Delta\\theta_{3\\,\\mathrm{dB}} \\approx 0.886\\,\\frac{\\lambda}{N\\,d\\,\\cos\\theta_{0}}\\ \\mathrm{rad} \\;=\\; 50.8\\,\\frac{\\lambda}{N\\,d\\,\\cos\\theta_{0}}\\ \\mathrm{deg}',
      plain: '波束宽度与总孔径成反比：孔径越大波束越窄。取 $d = \\lambda/2$ 且正横指向时约为 $102/N$ 度。偏离正横越远，波束越宽（$\\cos\\theta_0$ 因子）。',
      vars: [
        ['$N\\,d$', '总孔径 $D$（m）'],
        ['$\\lambda$', '波长（m）'],
        ['$\\theta_{0}$', '波束指向角，$0^{\\circ}$ 为正横'],
        ['$0.886$', '矩形（均匀）加权的常数，等于 $0.886$ rad ≈ 50.8 deg']
      ],
      usage: '① 把 $Nd$ 当作总孔径 ② 代入 $\\theta_{0}$ 得该方向上的波束宽度 ③ 扫描到 ±60 度时波束约展宽 2 倍。单位 rad 或 deg。',
      assume: 'ULA、均匀加权、远场、$N$ 较大。',
      fail: '这是均匀加权的 −3 dB 宽度；一旦加窗压旁瓣，主瓣会按窗的主瓣展宽系数变宽（汉宁约 1.5 倍、布莱克曼约 1.7 倍），很多人按 $0.886\\lambda/D$ 报分辨率却实际做不到。另外 $N$ 很小（小于 4）或接近端射（$\\theta_0$ 趋于 90 度）时公式严重失准，必须用数值计算。',
      tags: ['波束宽度', '分辨率', '阵列', '孔径'],
      see: 'theory/array/directivity'
    },
    {
      id: 'A-06', cat: 'array',
      name: '栅瓣条件与阵元间距',
      en: 'Grating Lobe Condition',
      tex: 'd \\;<\\; \\frac{\\lambda}{1 + |\\sin\\theta_{\\max}|} \\quad\\Longrightarrow\\quad \\text{扫描范围内无栅瓣}',
      plain: '阵元间距太大时，除了主瓣还会在别的方向出现一样高的"栅瓣"，导致方位模糊。要在最大扫描角内避免栅瓣，间距必须小于这个值。',
      vars: [
        ['$d$', '阵元间距（m）'],
        ['$\\lambda$', '波长（m）'],
        ['$\\theta_{\\max}$', '最大扫描角（相对正横），全向扫描取 $90^{\\circ}$']
      ],
      usage: '① 确定最大扫描角 ② 代入求 $d_{\\max}$ ③ 全向扫描（±90 度）要求 $d < \\lambda/2$；只扫 ±30 度时 $d < 0.67\\lambda$ 即可。',
      assume: '均匀线阵；窄带单频；阵元全向。',
      fail: '宽带系统里 λ 随频率变化：按最高频率设计的间距在低频端非常保守（浪费孔径、栅瓣虽无但波束变宽），按中心频率设计则高频端必出栅瓣。工程上用非均匀（稀疏/随机）阵把栅瓣能量打散成低旁瓣，代价是整体旁瓣基底抬高、弱目标检测能力下降。',
      tags: ['栅瓣', '阵元间距', '阵列', '欠采样'],
      see: 'theory/array/steering'
    },
    {
      id: 'A-07', cat: 'array',
      name: '指向性 D',
      en: 'Directivity',
      tex: 'D = \\frac{|B(\\theta_{0})|^{2}}{\\dfrac{1}{4\\pi}\\displaystyle\\int_{4\\pi} |B(\\theta,\\,\\phi)|^{2}\\,d\\Omega},\\qquad D_{\\mathrm{ULA}} \\approx \\frac{2\\,N\\,d}{\\lambda}\\;(d \\ge \\lambda/2)',
      plain: '指向性是"主瓣方向的响应与全空间平均响应之比"，衡量阵列抑制各向同性噪声的能力。均匀线阵正横指向时约等于两倍孔径除以波长。',
      vars: [
        ['$B(\\theta,\\,\\phi)$', '三维波束响应'],
        ['$\\theta_{0}$', '主瓣指向'],
        ['$d\\Omega$', '立体角元，$d\\Omega = \\sin\\theta\\,d\\theta\\,d\\phi$'],
        ['$D$', '指向性（线性值，常转 dB）']
      ],
      usage: '① 求三维方向图 ② 数值积分全空间功率 ③ 归一化取比值 ④ 常用 dB 表示，$10\\log_{10}D$。',
      assume: '远场；阵元无指向性；无互耦；各向同性噪声场。',
      fail: '实际阵元总有指向性，且安装在平台上会被遮挡、散射，实测 DI 常常比理论低 3—6 dB。另外在高频段若间距远大于 λ，理论 D 会算得很大但栅瓣也同时出现，公式在此区间失效。',
      tags: ['指向性', 'DI', '阵列', '孔径'],
      see: 'theory/array/directivity'
    },
    {
      id: 'A-08', cat: 'array',
      name: '指向性指数 DI',
      en: 'Directivity Index',
      tex: '\\mathrm{DI} = 10\\log_{10} D,\\qquad \\mathrm{DI_{ULA}} \\approx 10\\log_{10}\\!\\left(\\frac{2\\,N\\,d}{\\lambda}\\right)',
      plain: '指向性的 dB 形式，直接代入声呐方程。对孔径为 $L$ 的均匀线阵，正横指向时约为 $10\\log_{10}(2L/\\lambda)$。',
      vars: [
        ['$D$', '指向性（线性值）'],
        ['$N$', '阵元数'],
        ['$d$', '阵元间距（m）'],
        ['$\\lambda$', '波长（m）']
      ],
      usage: '① 由方向图算 $D$ ② 取 $10\\log_{10}$ ③ 代入主动或被动声呐方程（见 R-02、R-03）。单位 dB。',
      assume: '同 D；噪声场各向同性。',
      fail: 'DI 的定义基准是**各向同性噪声场**。实际海洋噪声集中在海面方向（垂直指向性明显），各向同性假设不成立，用理论 DI 做作用距离预报会系统性偏乐观。另外 DI 随频率强相关，宽带系统必须分频段计算而不能只取中心频率。',
      tags: ['DI', '指向性', '声呐方程', '阵列'],
      see: 'theory/array/directivity'
    },
    {
      id: 'A-09', cat: 'array',
      name: '阵列增益',
      en: 'Array Gain',
      tex: '\\mathrm{AG} = 10\\log_{10}\\!\\left(\\frac{\\mathrm{SNR}_{\\mathrm{out}}}{\\mathrm{SNR}_{\\mathrm{elem}}}\\right) \\approx 10\\log_{10} N\\ \\ (\\text{白噪声场})',
      plain: '阵列增益是"合成后 SNR 相对单元 SNR 的提升"，是阵列最核心的收益指标。在理想白噪声场中等于 $10\\log_{10}N$。',
      vars: [
        ['$N$', '阵元数'],
        ['$\\mathrm{SNR}_{\\mathrm{out}}$', '波束输出信噪比（线性值）'],
        ['$\\mathrm{SNR}_{\\mathrm{elem}}$', '单元信噪比（线性值）']
      ],
      usage: '① 测单元 SNR ② 测波束输出 SNR ③ 取 $10\\log_{10}$ 比值 ④ 与理论 $10\\log_{10}N$ 对比评估校准状态。单位 dB。',
      assume: '噪声场空间白；通道完全校准；信号完全相干。',
      fail: '实际海况下噪声空间相关（远处航运噪声、风成噪声都有明显方向性），实测 AG 常常只有 $10\\log_{10}N$ 的一半甚至更低。通道幅相误差、本振相位噪声也会直接吃掉阵列增益——理论与实测差 3—6 dB 是常态，验收指标必须留余量，否则外场试验必然不达标。',
      tags: ['阵列增益', 'SNR', '波束形成', '声呐'],
      see: 'theory/array/beamforming'
    },
    {
      id: 'A-10', cat: 'array',
      name: '近远场判据',
      en: 'Near-Field / Far-Field Criterion',
      tex: 'r \\;>\\; \\frac{2\\,D^{2}}{\\lambda} \\;\\Rightarrow\\; \\text{远场（平面波近似成立）}',
      plain: '距离大于两倍孔径平方除以波长时，波前曲率带来的相位误差小于八分之一波长，可以当平面波处理。',
      vars: [
        ['$D$', '阵列孔径（m）'],
        ['$\\lambda$', '波长（m）'],
        ['$r$', '目标距离（m）']
      ],
      usage: '① 算孔径 ② 代入求远场起始距离 ③ 近场目标改用球面波聚焦导向矢量。单位 m。',
      assume: '孔径远大于波长；相位误差容限取 λ/8。',
      fail: '这是最宽松的判据。做高分辨波束形成（尤其 MVDR、MUSIC）时，残留的波前曲率误差会严重破坏性能，应按 λ/16 甚至更严的容限取距离——远场距离会变为四倍。大孔径低频声呐的远场距离可达几百米，港池试验里目标的近场效应必须补偿，否则会误以为算法失效。',
      tags: ['近场', '远场', '孔径', '阵列'],
      see: 'theory/array/beamforming'
    },
    {
      id: 'A-11', cat: 'array',
      name: '常规波束形成 CBF',
      en: 'Conventional Beamforming',
      tex: 'y(t) = \\mathbf{w}^{H}\\mathbf{x}(t),\\qquad \\mathbf{w} = \\frac{1}{N}\\,\\mathbf{a}(\\theta_{0});\\qquad \\mathrm{SNR}_{\\mathrm{out}} = N\\,\\mathrm{SNR}_{\\mathrm{elem}}',
      plain: '把各阵元信号按方向补偿相位后相加：目标方向同相叠加，其他方向部分抵消。这是最稳健、也最容易实现的波束形成器，但分辨率最低。',
      vars: [
        ['$\\mathbf{x}(t)$', '快拍向量（$N \\times 1$）'],
        ['$\\mathbf{w}$', '权向量，这里取归一化导向矢量'],
        ['$y(t)$', '波束输出（复）'],
        ['$N$', '阵元数']
      ],
      usage: '① 构造目标方向导向矢量 ② 相位补偿（取共轭后内积）③ 求和并除以 $N$ ④ 输出取模或功率。单位与输入一致。',
      assume: '窄带、远场；各通道噪声独立等功率；阵列已校准。',
      fail: 'CBF 的 −3 dB 波束宽度约 $0.886\\lambda/(Nd\\cos\\theta_0)$，夹角小于此值的两个目标分不开。实际系统的通道幅相误差会抬高旁瓣、降低输出 SNR；若某方向有强干扰，CBF 无法像自适应方法那样主动形成零陷，只能被动承受。',
      tags: ['CBF', '波束形成', '阵列', '常规'],
      see: 'theory/array/beamforming'
    },
    {
      id: 'A-12', cat: 'array',
      name: 'MVDR 波束形成器',
      en: 'MVDR Beamformer',
      tex: '\\mathbf{w}_{\\mathrm{MVDR}} = \\frac{\\mathbf{R}^{-1}\\mathbf{a}(\\theta_{0})}{\\mathbf{a}^{H}(\\theta_{0})\\,\\mathbf{R}^{-1}\\,\\mathbf{a}(\\theta_{0})},\\qquad P_{\\mathrm{out}} = \\frac{1}{\\mathbf{a}^{H}(\\theta_{0})\\,\\mathbf{R}^{-1}\\,\\mathbf{a}(\\theta_{0})}',
      plain: '在保证目标方向增益为 1 的约束下，让输出总功率（干扰加噪声）最小。它会自动在干扰方向形成零陷，分辨率与干扰抑制能力都远好于 CBF。',
      vars: [
        ['$\\mathbf{R}$', '接收数据协方差矩阵（$N \\times N$）'],
        ['$\\mathbf{a}(\\theta_{0})$', '期望方向的导向矢量'],
        ['$P_{\\mathrm{out}}$', '最小输出功率，即对干扰加噪声的估计']
      ],
      usage: '推导要点：构造拉格朗日函数 $\\mathcal{L} = \\mathbf{w}^{H}\\mathbf{R}\\mathbf{w} + \\lambda(\\mathbf{w}^{H}\\mathbf{a} - 1)$，对 $\\mathbf{w}^{*}$ 求导令其为零得 $\\mathbf{R}\\mathbf{w} = -\\lambda\\mathbf{a}$，即 $\\mathbf{w} \\propto \\mathbf{R}^{-1}\\mathbf{a}$，再由约束定出比例系数。实现时用 Cholesky 分解或 SVD 求逆，别直接算逆矩阵。',
      assume: '$\\mathbf{R}$ 可逆（快拍数 $K \\ge N$，工程上常取 $K \\ge 2N$）；导向矢量准确；期望信号与干扰不相关。',
      fail: '**导向矢量失配**是 MVDR 的头号杀手：目标实际方向与假设不一致、阵列未校准、存在多途时，MVDR 会把目标当成干扰，在主瓣方向打出一个深零陷，输出 SNR 反而远低于 CBF——这是"自适应算法不如普通波束形成"的最常见原因。其次，快拍不足时 $\\hat{\\mathbf{R}}$ 估计不准甚至奇异，必须做对角加载（见 A-15）。',
      tags: ['MVDR', 'Capon', '自适应波束形成', '阵列', '声呐'],
      see: 'theory/array/beamforming'
    },
    {
      id: 'A-13', cat: 'array',
      name: 'Capon 空间谱',
      en: 'Capon Spatial Spectrum',
      tex: 'P_{\\mathrm{Capon}}(\\theta) = \\frac{1}{\\mathbf{a}^{H}(\\theta)\\,\\hat{\\mathbf{R}}^{-1}\\,\\mathbf{a}(\\theta)}',
      plain: '把 MVDR 的输出功率当作角度的函数画出来，就是 Capon 谱。它比 CBF 主瓣窄、旁瓣低，但对模型误差更敏感。',
      vars: [
        ['$\\mathbf{a}(\\theta)$', '扫描方向导向矢量'],
        ['$\\hat{\\mathbf{R}}$', '由 K 个快拍估出的样本协方差矩阵'],
        ['$P_{\\mathrm{Capon}}$', '空间谱（功率量纲）']
      ],
      usage: '① 估 $\\hat{\\mathbf{R}} = \\frac{1}{K}\\sum_{k} \\mathbf{x}_{k}\\mathbf{x}_{k}^{H}$ ② 求逆 ③ 在角度网格上算 $P(\\theta)$ ④ 取峰得 DOA。',
      assume: '快拍数足够；无相干源；噪声协方差可估。',
      fail: '相干源（水声多途、雷达多径）下 Capon 谱会把相关源"合并"，只出一个峰，且 DOA 估计有偏，必须做空间平滑。快拍数不足时矩阵求逆数值不稳定，谱上出现乱七八糟的假峰，看起来像多目标。',
      tags: ['Capon', 'MVDR', '空间谱', 'DOA', '声呐'],
      see: 'theory/spectrum/subspace'
    },
    {
      id: 'A-14', cat: 'array',
      name: 'LCMV 线性约束最小方差波束形成',
      en: 'LCMV Beamformer',
      tex: '\\min_{\\mathbf{w}}\\ \\mathbf{w}^{H}\\mathbf{R}\\mathbf{w}\\ \\ \\text{s.t.}\\ \\mathbf{C}^{H}\\mathbf{w} = \\mathbf{f};\\qquad \\mathbf{w} = \\mathbf{R}^{-1}\\mathbf{C}\\bigl(\\mathbf{C}^{H}\\mathbf{R}^{-1}\\mathbf{C}\\bigr)^{-1}\\mathbf{f}',
      plain: 'MVDR 的推广：不只约束一个方向，而是同时满足多个线性约束（例如几个方向增益为 1、几个干扰方向为零）。',
      vars: [
        ['$\\mathbf{C}$', '约束矩阵（$N \\times L$），列为各约束方向的导向矢量'],
        ['$\\mathbf{f}$', '期望响应向量（$L \\times 1$），例如全 1'],
        ['$L$', '约束个数，必须小于阵元数 $N$']
      ],
      usage: '① 列出约束 $\\mathbf{C} = [\\mathbf{a}(\\theta_1),\\dots,\\mathbf{a}(\\theta_L)]$、$\\mathbf{f} = [1,\\dots,1]^{T}$ ② 按闭式解算权 ③ 检查约束是否相容、$\\mathbf{C}^{H}\\mathbf{R}^{-1}\\mathbf{C}$ 是否可逆。',
      assume: '$\\mathbf{R}$ 正定；约束相容且线性无关；$L < N$。',
      fail: '约束太多会耗尽自由度，剩下的零陷能力不够，结果是主瓣畸变、旁瓣全面抬高，甚至不如 CBF。工程上常见错误是把约束方向设得太密（例如 1 度间隔扫一片区域以"保主瓣"），此时应改用稳健波束形成、加对角加载，或改用二阶锥规划形式的稳健约束。',
      tags: ['LCMV', '约束', '自适应波束形成', '阵列'],
      see: 'theory/array/beamforming'
    },
    {
      id: 'A-15', cat: 'array',
      name: '白噪声增益与对角加载',
      en: 'White Noise Gain and Diagonal Loading',
      tex: '\\mathrm{WNG} = \\frac{|\\mathbf{w}^{H}\\mathbf{a}(\\theta_{0})|^{2}}{\\mathbf{w}^{H}\\mathbf{w}},\\qquad \\mathbf{R}_{\\mathrm{DL}} = \\hat{\\mathbf{R}} + \\delta\\,\\frac{\\mathrm{tr}(\\hat{\\mathbf{R}})}{N}\\,\\mathbf{I}',
      plain: '白噪声增益衡量权向量对通道噪声的放大程度，WNG 太低说明波束形成器处于"超增益"状态、极其敏感。对角加载是给协方差矩阵加一个单位阵，牺牲一点分辨率换取稳健性——这是自适应阵列走向实用的关键一步。',
      vars: [
        ['$\\mathrm{WNG}$', '白噪声增益（无量纲，理想约等于 $N$）'],
        ['$\\delta$', '加载量，通常取噪声功率的 10 倍左右或 $10\\sigma_n^2$'],
        ['$\\mathrm{tr}(\\hat{\\mathbf{R}})/N$', '协方差矩阵的平均特征值'],
        ['$\\mathbf{I}$', '单位矩阵']
      ],
      usage: '① 算 WNG，若远低于 $10\\log_{10}N$ 说明需要加载 ② 取 $\\delta$ 为噪声功率的 10 倍量级 ③ 用 $\\mathbf{R}_{\\mathrm{DL}}$ 重算权 ④ 检查主瓣是否畸变。',
      assume: '通道噪声为白噪声；导向矢量存在误差；快拍数有限。',
      fail: '加载量 $\\delta$ 过大会让 MVDR 退化成 CBF（白噪声增益上去了，零陷能力没了）；过小则起不到稳健作用。工程上的最优取值随信噪比、快拍数、失配程度变化，需要实测标定，直接抄论文里的 $\\delta$ 常常不适用。',
      tags: ['对角加载', '白噪声增益', '稳健波束形成', '阵列'],
      see: 'theory/array/beamforming'
    },
    {
      id: 'A-16', cat: 'array',
      name: '宽带频域波束形成',
      en: 'Wideband Frequency-Domain Beamforming',
      tex: '\\mathbf{a}(\\theta,\\,f_k) = \\Bigl[\\,1,\\ e^{j2\\pi f_k\\frac{d\\sin\\theta}{c}},\\ \\dots,\\ e^{j2\\pi f_k\\frac{(N-1)d\\sin\\theta}{c}}\\,\\Bigr]^{T},\\qquad y(f_k) = \\mathbf{w}^{H}(f_k)\\,\\mathbf{x}(f_k)',
      plain: '宽带信号无法用一个固定相移近似所有频率的延时。办法是分频段处理：每个频点用自己的导向矢量和权，最后把各频点输出合成。',
      vars: [
        ['$f_k$', '第 k 个频点（Hz）'],
        ['$c$', '传播速度（m/s），水中约 1500'],
        ['$\\mathbf{x}(f_k)$', '该频点的快拍向量（各通道 FFT 值）'],
        ['$d$', '阵元间距（m）']
      ],
      usage: '① 分帧加窗做 FFT ② 对每个频点按实际频率构造 $\\mathbf{a}(\\theta,\\,f_{k})$ ③ 逐频点算波束输出 ④ 需要宽带相参时按频率做相位对齐再合成。',
      assume: '阵列响应随频率的变化已知；帧内信号平稳；各通道已做时延对齐。',
      fail: '若直接用窄带权处理宽带信号，会出现波束斜视——不同频率的主瓣指向不同，宽带能量被散开，阵列增益随相对带宽增大而显著下降。另外各通道的群延迟不一致（电缆长度差、滤波器差异）会在高频引入显著相位误差，必须先做通道均衡校准，否则高频段波束畸变、旁瓣抬高。',
      tags: ['宽带', '频域波束形成', '阵列', '声呐'],
      see: 'theory/array/beamforming'
    },
    {
      id: 'A-17', cat: 'array',
      name: '孔径与角分辨率',
      en: 'Aperture and Angular Resolution',
      tex: '\\Delta\\theta \\approx \\frac{\\lambda}{D\\,\\cos\\theta_{0}},\\qquad D \\approx N\\,d\\;(\\text{ULA 总孔径})',
      plain: '角分辨率由波长除以孔径决定，与阵元数没有直接关系——孔径不变，用 8 个还是 64 个阵元，分辨率上限差不多（差别在栅瓣与增益）。',
      vars: [
        ['$D$', '阵列孔径（m）'],
        ['$\\lambda$', '波长（m）'],
        ['$\\theta_{0}$', '波束指向角（相对正横）'],
        ['$N,\\,d$', '阵元数与间距']
      ],
      usage: '① 换算孔径与波长的比值 ② 正横指向时直接用 $\\lambda/D$ ③ 偏离正横时除以 $\\cos\\theta_{0}$ ④ 想提高分辨率只能加大孔径或提高频率。单位 rad。',
      assume: '远场、窄带；均匀加权；$D$ 远大于 $\\lambda$。',
      fail: '很多项目把"阵元数"当分辨率指标，结果布了 128 元阵却发现分辨率没提升——因为孔径没变。反过来，加大孔径而不增加阵元数会出现栅瓣。低频声呐想要高分辨率只能加大孔径，这是物理约束，不是算法能绕过的（子空间方法可以改善，但仍受信噪比与阵列误差限制）。',
      tags: ['角分辨率', '孔径', '阵列', '波束形成'],
      see: 'theory/array/directivity'
    },
    {
      id: 'A-18', cat: 'array',
      name: '稀疏阵与差分共阵',
      en: 'Sparse Arrays and Difference Co-Array',
      tex: '\\mathcal{D} = \\{\\, d_{i} - d_{j} \\;:\\; d_{i},\\, d_{j} \\in \\mathbb{S}\\,\\},\\qquad |\\mathcal{D}_{\\mathrm{nested}}| = O(N_{1}N_{2})',
      plain: '稀疏（非均匀）阵通过"位置两两相减"构造出一个虚拟的、阵元数远多于物理阵元的差分共阵，从而用少数物理阵元获得大孔径与更多自由度。',
      vars: [
        ['$\\mathbb{S}$', '物理阵元位置集合（通常归一化到半波长）'],
        ['$\\mathcal{D}$', '差分共阵，即可用的虚拟阵元位置集合'],
        ['$N_{1},\\,N_{2}$', '嵌套阵两级的阵元数']
      ],
      usage: '① 选阵型（嵌套阵、最小冗余阵、互质阵）② 由位置集合构造差分共阵 ③ 对共阵做空间平滑后跑 MUSIC ④ 可分辨源数可达 $O(N_1N_2)$。',
      assume: '差分共阵连续（无空洞）；需配合空间平滑使用；窄带。',
      fail: '稀疏阵的代价是旁瓣基底抬高与互耦加剧：阵元间距大导致方向图旁瓣统计升高，弱目标被强目标的旁瓣淹没，在大动态范围场景（近强远弱）尤其致命。差分共阵若有"空洞"则不连续，部分 DOA 算法失效，需要阵型优化或补空洞。实际加工与布放误差对稀疏阵的影响比均匀阵更敏感。',
      tags: ['稀疏阵', '差分共阵', '嵌套阵', '阵列', 'DOA'],
      see: 'theory/array/steering'
    },

    /* ===================== 雷达声呐 radar ===================== */
    {
      id: 'R-01', cat: 'radar',
      name: '雷达方程',
      en: 'Radar Range Equation',
      tex: '\\mathrm{SNR} = \\frac{P_{t}\\,G^{2}\\,\\lambda^{2}\\,\\sigma}{(4\\pi)^{3}\\,R^{4}\\,k\\,T_{0}\\,B\\,F_{n}\\,L}',
      plain: '接收信噪比与发射功率、天线增益平方、波长平方、目标截面积成正比，与作用距离的**四次方**成反比。那个 $R^{4}$ 是雷达最残酷的现实：想让距离翻倍，功率要涨 16 倍。',
      vars: [
        ['$P_{t}$', '发射功率（W）'],
        ['$G$', '天线增益（线性值，不是 dB），单基地雷达取平方'],
        ['$\\lambda$', '波长（m）'],
        ['$\\sigma$', '雷达截面积 RCS（$\\mathrm{m^{2}}$）'],
        ['$R$', '目标距离（m）'],
        ['$k\\,T_{0}$', '噪声谱密度，290 K 时约 $4\\times10^{-21}$ W/Hz'],
        ['$B$', '噪声等效带宽（Hz）'],
        ['$F_{n}$', '噪声系数（线性值）'],
        ['$L$', '系统损耗（线性值，$L > 1$）']
      ],
      usage: 'dB 形式：$\\mathrm{SNR_{dB}} = P_{t,\\mathrm{dBm}} + 2G_{\\mathrm{dB}} + 20\\log_{10}\\lambda + \\sigma_{\\mathrm{dBsm}} - 40\\log_{10}R - 10\\log_{10}(kT_0 B) - \\mathrm{NF} - L_{\\mathrm{dB}}$。注意距离项是 $40\\log_{10}R$。单位：m、Hz、W。',
      assume: '单基地；自由空间传播；点目标；目标非起伏；匹配滤波；天线波束完全照射目标。',
      fail: '实际链路里最常漏的是损耗项 $L$：大气吸收、波导损耗、扫描损耗、波束形状损耗、目标起伏损耗、CFAR 损失、匹配滤波失配损失、量化损失累加起来常有 10—20 dB。距离四次方还意味着作用距离指标差 1 dB，距离就差 6%——谈判时"差 3 dB"看似很小，实际是 19% 的距离，足以让验收不通过。多径、杂波、遮挡更会让实际检测距离远低于方程预报。',
      tags: ['雷达方程', '作用距离', 'RCS', '雷达'],
      see: 'cases/radar/pulse-compression'
    },
    {
      id: 'R-02', cat: 'radar',
      name: '主动声呐方程',
      en: 'Active Sonar Equation',
      tex: '\\mathrm{SE} = \\mathrm{SL} - 2\\,\\mathrm{TL} + \\mathrm{TS} - (\\mathrm{NL} - \\mathrm{DI}) \\;\\ge\\; \\mathrm{D_{T}}',
      plain: '主动声呐的一本账：发射声源级减去**往返**传播损失，加目标强度，再减去背景（噪声级减指向性指数），余量要超过检测阈。传播损失要乘 2，因为声音走了个来回。',
      vars: [
        ['$\\mathrm{SL}$', '声源级（dB re 1 μPa，参考距离 1 m）'],
        ['$\\mathrm{TL}$', '单程传播损失（dB），往返故乘 2'],
        ['$\\mathrm{TS}$', '目标强度（dB re 1 $\\mathrm{m^{2}}$）'],
        ['$\\mathrm{NL}$', '噪声级（dB），注意是频带级还是谱级'],
        ['$\\mathrm{DI}$', '接收指向性指数（dB）'],
        ['$\\mathrm{D_{T}}$', '检测阈（dB），由 $P_d$ 与 $P_{fa}$ 决定']
      ],
      usage: '① 统一基准：声压量一律用 dB re 1 μPa ② TL 按 R-04 计算 ③ 若 NL 给的是谱级要加 $10\\log_{10}B$ 转成频带级 ④ 余量一般要求 10—15 dB。单位 dB。',
      assume: '单基地；传播模型已知；点目标；噪声限制（而非混响限制）。',
      fail: '两个高频错误：一是把谱级当频带级用（差 $10\\log_{10}B$，1 kHz 带宽就是 30 dB），这是声呐预报出错的头号原因；二是忽略混响——浅海主动声呐往往是混响限制而非噪声限制，此时要把 $NL - DI$ 换成混响级 RL，两者距离依赖完全不同（噪声与距离无关，混响随距离下降）。混响限制下加发射功率毫无用处，只能靠波形设计与空时处理。',
      tags: ['声呐方程', '主动声呐', '作用距离', '声呐'],
      see: 'cases/sonar/pulse-compression'
    },
    {
      id: 'R-03', cat: 'radar',
      name: '被动声呐方程',
      en: 'Passive Sonar Equation',
      tex: '\\mathrm{SL} - \\mathrm{TL} \\;\\ge\\; \\mathrm{NL} - \\mathrm{DI} + \\mathrm{D_{T}}',
      plain: '被动声呐只有单程传播损失，信号只走一趟。于是作用距离主要由"目标辐射噪声有多强"与"本舰自噪声和海洋噪声有多低"决定——这是纯粹的"听"的艺术。',
      vars: [
        ['$\\mathrm{SL}$', '目标辐射噪声声源级（dB re 1 μPa @ 1 m），与航速强相关'],
        ['$\\mathrm{TL}$', '单程传播损失（dB）'],
        ['$\\mathrm{NL}$', '背景噪声级（dB）'],
        ['$\\mathrm{DI}$', '接收指向性指数（dB）'],
        ['$\\mathrm{D_{T}}$', '检测阈（dB）']
      ],
      usage: '① 由目标类型与航速查辐射噪声 SL ② 按传播模型算 TL ③ 与 $NL - DI + D_T$ 比较 ④ 余量即为可用传播损失余量。单位 dB。',
      assume: '目标为点声源；噪声限制；信道无显著多途扩展损失。',
      fail: '被动方程最大的不确定性在 SL：同一艘船 6 节和 18 节的辐射噪声可差 20 dB 以上，用手册典型值预报距离误差极大。其次，浅海多途会让信号能量在时间上扩展、相干性下降，宽带检测的实际距离常比方程预报低 30%—50%。本舰自噪声（流噪声、机械噪声）在高速航行时往往成为主要限制，减速听测是被动声呐的常规战术动作。',
      tags: ['声呐方程', '被动声呐', '作用距离', '声呐'],
      see: 'cases/sonar/passive'
    },
    {
      id: 'R-04', cat: 'radar',
      name: '传播损失 TL',
      en: 'Transmission Loss',
      tex: '\\mathrm{TL} = 20\\log_{10} r + \\alpha\\,r\\ \\ (\\text{球面扩展});\\qquad \\mathrm{TL} = 10\\log_{10} r + \\alpha\\,r\\ \\ (\\text{柱面扩展})',
      plain: '传播损失分两部分：几何扩展（球面 20log r、柱面 10log r）与介质吸收（正比于距离）。深海远距离是球面扩展，浅海远距离通常近似柱面扩展。',
      vars: [
        ['$r$', '传播距离（m），公式中常数项隐含参考距离 1 m'],
        ['$\\alpha$', '吸收系数（dB/m），由频率决定，见 R-05'],
        ['$20$ 或 $10$', '扩展指数对应的 dB 系数']
      ],
      usage: '① 判断扩展模型（深海球面、浅海柱面，浅海近场也可能先球面后柱面）② 由频率查 α ③ 代入。单位 dB。',
      assume: '均匀介质；无多途干涉；无视影区与汇聚区效应。',
      fail: '真实海洋传播有强烈的多途干涉、影区与汇聚区，TL 随距离可出现 20—30 dB 的起伏，单点公式完全无法描述。工程上必须跑声传播模型（射线、简正波或抛物方程），且 TL 随水文剖面（声速梯度）季节变化。把 20log r 当设计依据，浅海预报误差十几 dB 很正常，这也是"声呐作用距离预报不准"的根源。',
      tags: ['传播损失', 'TL', '声传播', '声呐'],
      see: 'cases/sonar/passive'
    },
    {
      id: 'R-05', cat: 'radar',
      name: 'Thorp 海水吸收系数',
      en: "Thorp's Absorption Coefficient",
      tex: '\\alpha(f) = \\frac{0.11\\,f^{2}}{1 + f^{2}} + \\frac{44\\,f^{2}}{4100 + f^{2}} + 2.75\\times10^{-4} f^{2} + 0.003 \\ \\mathrm{dB/km}',
      plain: '海水对声的吸收来自三种化学弛豫机制（硼酸、硫酸镁）加纯水的黏性吸收。Thorp 给出了一个便于手算的经验拟合，是声呐链路预算的标准工具。',
      vars: [
        ['$f$', '频率（**kHz**，必须换算）'],
        ['第一项', '硼酸弛豫，主导低频（约 < 1 kHz）'],
        ['第二项', '硫酸镁弛豫，主导中频（约 1—100 kHz）'],
        ['第三、四项', '纯水黏性吸收与常数项，高频才显著']
      ],
      usage: '① 把频率换算成 kHz（例如 5 kHz 代入 f = 5）② 逐项计算求和得 α（dB/km）③ 乘距离（km）得吸收损失。例：f = 10 kHz 时 α 约 1.0 dB/km，10 km 往返吸收约 20 dB。',
      assume: '标准海水（盐度约 35、温度约 4 ℃、pH 约 8）；适用频率约 0.1—100 kHz。',
      fail: '这是经验拟合，误差约 ±10%；在 100 Hz 以下 Thorp 会**高估**吸收，浅海 pH 与温度偏离标准值时偏差明显（低频段可差数 dB）。含气泡水层、浑浊海域、冰下环境的吸收机制完全不同，公式彻底失效。低频远距离传播项目应改用 Francois–Garrison 公式，并按实测声速剖面与海底参数输入。',
      tags: ['吸收系数', 'Thorp', '声传播', '声呐'],
      see: 'cases/sonar/passive'
    },
    {
      id: 'R-06', cat: 'radar',
      name: '目标强度 TS',
      en: 'Target Strength',
      tex: '\\mathrm{TS} = 10\\log_{10}\\!\\left(\\frac{\\sigma_{\\mathrm{bs}}}{1\\ \\mathrm{m}^{2}}\\right)\\ \\mathrm{dB},\\qquad \\sigma_{\\mathrm{bs}} = \\frac{|p_{\\mathrm{scat}}|^{2}\\,r^{2}}{|p_{\\mathrm{inc}}|^{2}}',
      plain: '目标强度是目标反向散射能力的 dB 化表示：等于"距目标声中心 1 m 处的散射声强与入射声强之比"取对数。它是目标本身的属性，但强烈依赖频率与入射方位。',
      vars: [
        ['$\\sigma_{\\mathrm{bs}}$', '反向散射截面（$\\mathrm{m^{2}}$）'],
        ['$p_{\\mathrm{inc}}$', '入射声压（Pa）'],
        ['$p_{\\mathrm{scat}}$', '距离 $r$ 处的散射声压（Pa）'],
        ['$r$', '散射测量距离（m）']
      ],
      usage: '① 明确所用定义口径（本书用反向散射截面 $\\sigma_{\\mathrm{bs}}$）② 换算成 dB ③ 查表时注意测量频率与入射方位，潜艇正横与首尾可差 15—25 dB。单位 dB re 1 $\\mathrm{m^{2}}$。',
      assume: '远场；单基地；目标为刚性、姿态固定。',
      fail: '最大的坑是**定义不统一**：有的文献用反向散射截面 $\\sigma_{\\mathrm{bs}}$，有的用总散射截面再除以 $4\\pi$，两者相差 $10\\log_{10} 4\\pi \\approx 11\\,\\mathrm{dB}$，抄错口径会让整条链路预算作废。TS 还随频率、姿态、表面状态（消声瓦）大幅变化，手册单值只能做粗略估算，重要项目必须靠实测或缩比模型测量。',
      tags: ['目标强度', 'TS', '散射截面', '声呐'],
      see: 'cases/sonar/pulse-compression'
    },
    {
      id: 'R-07', cat: 'radar',
      name: '匹配滤波器',
      en: 'Matched Filter',
      tex: 'h(t) = k\\,s^{*}(T - t),\\qquad \\mathrm{SNR}_{\\mathrm{out}} = \\frac{2E}{N_{0}},\\qquad E = \\int_{0}^{T} |s(t)|^{2}\\,dt',
      plain: '匹配滤波器的冲激响应就是发射信号的时间反折再取共轭。它在白噪声背景下使输出信噪比最大，而且最大值只取决于信号能量 $E$ 与噪声谱密度 $N_0$，与波形形状无关。',
      vars: [
        ['$s(t)$', '已知发射信号（复包络）'],
        ['$T$', '信号持续时间（s）'],
        ['$E$', '信号能量（J）'],
        ['$N_{0}$', '单边噪声功率谱密度（W/Hz）'],
        ['$k$', '任意复常数，不影响信噪比']
      ],
      usage: '① 取发射波形 $s(t)$ ② 时间反折并取共轭 ③ 与回波卷积（工程上多用 FFT 相关实现）④ 峰值处输出 SNR 为 $2E/N_0$。单位 J、W/Hz。',
      assume: '加性白高斯噪声；信号完全已知；无多普勒失配；无多途。',
      fail: '多普勒失配是匹配滤波的致命伤：目标径向速度产生的频移会让滤波器失配，在 LFM 上表现为距离—多普勒耦合，速度大时增益损失可达十几 dB，必须跑多普勒补偿组。水声多途信道让"匹配"变成部分匹配，实测处理增益常比理论低 5—10 dB。另外强目标的匹配滤波旁瓣会掩盖邻近弱目标，必须加权，而加权又损失 1—2 dB 信噪比。',
      tags: ['匹配滤波', '信噪比', '脉冲压缩', '雷达', '声呐'],
      see: 'theory/random/matched'
    },
    {
      id: 'R-08', cat: 'radar',
      name: '广义匹配滤波器（色噪声）',
      en: 'Generalized Matched Filter',
      tex: '\\mathbf{w} = \\mathbf{R}_{n}^{-1}\\mathbf{s}^{*},\\qquad \\mathrm{SNR}_{\\mathrm{out}} = \\mathbf{s}^{H}\\mathbf{R}_{n}^{-1}\\,\\mathbf{s}',
      plain: '当噪声不再是白的（有混响、有干扰），先用噪声协方差的逆把噪声"白化"，再做匹配。这个预白化步骤就是它与普通匹配滤波唯一的差别。',
      vars: [
        ['$\\mathbf{R}_{n}$', '噪声加干扰的协方差矩阵（$N \\times N$）'],
        ['$\\mathbf{s}$', '已知信号向量（$N \\times 1$）'],
        ['$\\mathbf{w}$', '最优权向量']
      ],
      usage: '① 从无目标的数据段估 $\\hat{\\mathbf{R}}_n$ ② 求逆（注意条件数，必要时对角加载）③ 与信号共轭相乘得权 ④ 输出 SNR 由二次型给出。',
      assume: '噪声为高斯分布；协方差已知或可估；信号已知。',
      fail: '从有限样本估 $\\hat{\\mathbf{R}}_n$ 时，若快拍数不够（$K < 2N$），估计的逆矩阵极不准，输出 SNR 反而可能**低于**简单匹配滤波——这就是对角加载必须存在的理由。混响的协方差还随距离与时间变化，用一段数据估出的 $\\hat{\\mathbf{R}}_n$ 不能直接搬到另一个距离单元，必须分单元自适应估计。',
      tags: ['广义匹配滤波', '预白化', '色噪声', '混响', '声呐'],
      see: 'theory/random/matched'
    },
    {
      id: 'R-09', cat: 'radar',
      name: 'LFM 线性调频信号',
      en: 'Linear Frequency Modulated Waveform',
      tex: 's(t) = \\mathrm{rect}\\!\\left(\\frac{t}{T}\\right) e^{\\,j2\\pi\\left(f_{0} t + \\tfrac{\\mu}{2} t^{2}\\right)},\\qquad \\mu = \\frac{B}{T}',
      plain: '频率随时间线性变化的信号（chirp）。带宽 $B$ 决定距离分辨率，时宽 $T$ 决定能量，两者解耦——这就是 LFM 成为雷达与声呐主力波形的根本原因。',
      vars: [
        ['$T$', '脉冲宽度（s），典型 1 ms—1 s'],
        ['$B$', '调频带宽（Hz），典型 100 Hz—10 MHz'],
        ['$\\mu$', '调频率（Hz/s），符号决定上扫或下扫'],
        ['$f_{0}$', '载频（Hz）']
      ],
      usage: '① 由距离分辨率定 B ② 由能量与作用距离定 T ③ 检查 BT 是否满足处理增益要求 ④ 注意 $\\mu$ 符号（上扫/下扫）会影响距离—多普勒耦合的符号。单位 s、Hz。',
      assume: '大时宽带宽积（$BT$ 远大于 1）；用驻定相位原理近似频谱。',
      fail: 'BT 不够大时，LFM 的频谱不再近似矩形，脉压后的旁瓣结构会偏离理论并出现菲涅耳纹波，主瓣也可能展宽。多普勒会引入距离—多普勒耦合，测距出现系统偏差。发射端功放非线性会让 chirp 的幅度与相位失真，脉压旁瓣抬高 5—10 dB，必须做预失真补偿。',
      tags: ['LFM', 'chirp', '波形设计', '雷达', '声呐'],
      see: 'cases/radar/pulse-compression'
    },
    {
      id: 'R-10', cat: 'radar',
      name: '脉冲压缩增益',
      en: 'Pulse Compression Gain',
      tex: 'G_{\\mathrm{pc}} = B\\,T = \\frac{T}{\\tau_{c}},\\qquad G_{\\mathrm{pc,dB}} = 10\\log_{10}(BT)',
      plain: '压缩前的等效脉宽是 $1/B$，压缩后是脉冲宽度 $T$，于是 SNR 改善 $BT$ 倍——这就是"发射长脉冲、拿到短脉冲分辨率"的收支表。',
      vars: [
        ['$B$', '信号带宽（Hz）'],
        ['$T$', '脉冲宽度（s）'],
        ['$\\tau_{c} \\approx 1/B$', '压缩后的脉冲宽度（s）']
      ],
      usage: '① 算 $BT$ ② 取 $10\\log_{10}$ ③ 若加权压旁瓣，要扣掉约 1—2 dB 的失配损失，并接受主瓣展宽。单位 dB。',
      assume: '匹配滤波；白噪声；大 $BT$；无多普勒失配。',
      fail: '加权压旁瓣是有代价的：典型汉宁加权让主瓣展宽约 1.3—1.5 倍、损失约 1.7 dB 信噪比，同时距离分辨率相应变差。多普勒失配会进一步吃掉压缩增益。多途信道下主瓣会被"复制"成多个峰，测距出现模糊，表现为一个目标变成一串等间距假目标。',
      tags: ['脉冲压缩', '处理增益', '时宽带宽积', '雷达', '声呐'],
      see: 'cases/radar/pulse-compression'
    },
    {
      id: 'R-11', cat: 'radar',
      name: '距离分辨率',
      en: 'Range Resolution',
      tex: '\\Delta R = \\frac{c}{2B} = \\frac{c\\,\\tau_{c}}{2}',
      plain: '距离分辨率只由信号带宽决定，与脉冲宽度无关。所以窄脉冲（大带宽）分辨率好但能量小，LFM 用长脉冲解决了这个矛盾。',
      vars: [
        ['$c$', '传播速度（m/s），空气中约 $3\\times10^{8}$、水中约 1500'],
        ['$B$', '信号带宽（Hz）'],
        ['$\\tau_{c}$', '压缩后脉冲宽度（s）']
      ],
      usage: '① 由指标定带宽：$B = c/(2\\Delta R)$ ② 雷达/主动声呐用 $c/2B$（往返），被动声呐不涉及往返，只谈方位与时间分辨率 ③ 单位 m。',
      assume: '匹配滤波；主瓣宽度按 $1/B$ 计；未加权。',
      fail: '加权后主瓣展宽 1.3—1.5 倍，实际分辨率比 $c/2B$ 差，投标文件里写理论值而验收按实测是常见纠纷。另外"分辨率"与"精度"是两回事：信噪比足够高时靠插值可以把测距精度做到远小于分辨率，但两个等强目标能否分开仍受主瓣宽度限制。多途会让同一个目标出现多个峰，被误判成多个目标。',
      tags: ['距离分辨率', '带宽', '脉冲压缩', '雷达', '声呐'],
      see: 'cases/radar/pulse-compression'
    },
    {
      id: 'R-12', cat: 'radar',
      name: '多普勒频率',
      en: 'Doppler Frequency',
      tex: 'f_{d} = \\frac{2\\,v}{\\lambda} = \\frac{2\\,v\\,f_{0}}{c},\\qquad v = \\frac{f_{d}\\,\\lambda}{2}',
      plain: '目标径向运动使回波载频偏移 $f_d$，正比于径向速度、反比于波长。雷达是双程（发射加接收），所以有系数 2；被动声呐单程，系数为 1。',
      vars: [
        ['$v$', '径向速度（m/s），远离为正'],
        ['$\\lambda$', '波长（m）'],
        ['$f_{0}$', '载频（Hz）'],
        ['$c$', '传播速度（m/s）']
      ],
      usage: '① 明确是双程（雷达/主动声呐）还是单程（被动声呐）② 由测得的 $f_d$ 反解 $v$ ③ 单位 m/s、Hz。',
      assume: '匀速径向运动；$v$ 远小于 $c$；窄带信号。',
      fail: '最常犯的是忘记"径向"二字：只有速度在视线方向的分量才产生多普勒，切向运动的多普勒为零，用 $\\cos$ 投影时角度基准要和方位估计严格一致。此外高速目标（弹道目标、高速鱼雷）的相对论修正虽可忽略，但回波的时间伸缩效应（宽带信号被压缩或展宽）不能忽略，窄带多普勒近似会失效。',
      tags: ['多普勒', '速度', '雷达', '声呐'],
      see: 'cases/radar/mti-mtd'
    },
    {
      id: 'R-13', cat: 'radar',
      name: '距离—多普勒耦合',
      en: 'Range-Doppler Coupling',
      tex: '\\Delta\\tau = -\\frac{f_{d}}{\\mu},\\qquad \\Delta R = \\frac{c\\,\\Delta\\tau}{2} = -\\frac{c\\,f_{d}\\,T}{2B}',
      plain: '多普勒频移会让 LFM 的匹配滤波输出在时间上平移，于是距离测量出现与速度成正比的系统偏差。这就是距离—多普勒耦合，LFM 波形最著名的副作用。',
      vars: [
        ['$\\Delta\\tau$', '压缩峰的时间偏移（s）'],
        ['$f_{d}$', '多普勒频率（Hz）'],
        ['$\\mu = B/T$', '调频率（Hz/s）'],
        ['$\\Delta R$', '距离偏差（m）']
      ],
      usage: '① 估计或测得 $f_d$ ② 算时间偏移 $\\Delta\\tau$ ③ 乘 $c/2$ 得距离偏差 ④ 系统层面用上扫/下扫交替或跑多普勒补偿组来消除。',
      assume: '大 $BT$；匹配滤波未做多普勒补偿；频移远小于带宽。',
      fail: '工程上最常用的补救是发射上扫与下扫交替的脉冲：耦合偏移符号相反，两次求平均即可解耦。若只有单扫频，就必须并行跑多普勒补偿组，通道数正比于速度搜索范围，计算量与存储显著上升。忽略耦合会让高速目标的测距出现几百米的固定偏差，而且这个偏差不随信噪比提高而消失。',
      tags: ['距离多普勒耦合', 'LFM', '测距误差', '雷达', '声呐'],
      see: 'cases/radar/pulse-compression'
    },
    {
      id: 'R-14', cat: 'radar',
      name: '模糊函数',
      en: 'Ambiguity Function',
      tex: '\\chi(\\tau,\\,f_{d}) = \\int_{-\\infty}^{\\infty} u(t)\\,u^{*}(t+\\tau)\\,e^{\\,j2\\pi f_{d} t}\\,dt,\\qquad |\\chi(0,\\,0)| = 1',
      plain: '模糊函数是波形自身的二维自相关图：时延维刻画距离分辨率与旁瓣，多普勒维刻画速度分辨率，形状还揭示两者的耦合。理想是图钉形，实际常是刀刃形。',
      vars: [
        ['$u(t)$', '归一化复包络（能量为 1）'],
        ['$\\tau$', '时延（s）'],
        ['$f_{d}$', '多普勒频移（Hz）'],
        ['$|\\chi|^{2}$', '常称为模糊度图']
      ],
      usage: '① 归一化信号 ② 在 $(\\tau,\\,f_{d})$ 网格上数值计算 ③ 取模平方画图 ④ 主瓣宽度给分辨率，旁瓣结构给遮挡特性。',
      assume: '点目标；白噪声；窄带近似。',
      fail: '模糊函数只描述**单个波形**在白噪声下的固有分辨能力，它不含信道多途、混响、杂波的影响——水声里真正决定分辨力的往往是信道而不是波形。另外它无法体现 CFAR 检测、遮挡、强弱目标共存等系统级因素，把这些都归咎于"波形不好"是常见误判，会导致错误的方案决策。',
      tags: ['模糊函数', '波形设计', '分辨率', '雷达', '声呐'],
      see: 'cases/radar/pulse-compression'
    },
    {
      id: 'R-15', cat: 'radar',
      name: 'MTI 改善因子',
      en: 'MTI Improvement Factor',
      tex: 'I = \\frac{(S/C)_{\\mathrm{out}}}{(S/C)_{\\mathrm{in}}} \\approx \\frac{1}{1 - |\\rho(T)|},\\qquad \\rho(T) = e^{-2\\pi^{2}\\sigma_{c}^{2}T^{2}}',
      plain: '改善因子衡量 MTI 滤波器把信杂比提升了多少。杂波时间相关性越强（谱越窄），改善越大；杂波完全白噪化（$\\rho = 0$）时改善因子为 1，即毫无收益——这正说明 MTI 的全部价值来自"杂波是相关的"。',
      vars: [
        ['$I$', '改善因子（无量纲，常用 dB）'],
        ['$\\rho(T)$', '杂波在脉冲重复间隔 $T$ 处的归一化相关系数'],
        ['$\\sigma_{c}$', '杂波谱的标准差（Hz）'],
        ['$T$', '脉冲重复周期（s），等于 1/PRF']
      ],
      usage: '① 估计杂波谱宽 $\\sigma_{c}$ ② 算 $\\rho(T)$ ③ 代入求 $I$ ④ 取 $10\\log_{10}$ 得 dB。单位 dB。',
      assume: '杂波谱为高斯形；目标多普勒在 [0, PRF) 上均匀分布；单延迟对消。',
      fail: '不同教材对"是否把目标平均增益计入"约定不同，数值会差 3 dB，引用时必须核对定义，否则验收对比时对不上。更实际的坑是：平台运动（机载、舰载）会让杂波谱中心偏移并展宽，必须做杂波锁定或位移相位中心补偿，否则改善因子从 40 dB 掉到十几 dB，动目标被杂波淹没。',
      tags: ['MTI', '改善因子', '杂波', '雷达'],
      see: 'cases/radar/mti-mtd'
    },
    {
      id: 'R-16', cat: 'radar',
      name: 'MTD 相参积累增益',
      en: 'MTD Coherent Integration Gain',
      tex: 'G_{\\mathrm{MTD}} = N\\;(\\text{理想相参}),\\qquad G_{\\mathrm{dB}} = 10\\log_{10}N - L_{\\mathrm{win}} - L_{\\mathrm{scan}}',
      plain: '对 N 个脉冲回波做多普勒 FFT，信号相干叠加、噪声非相干叠加，理想增益为 N。实际还要扣掉加权损失与扫描损失。',
      vars: [
        ['$N$', '积累脉冲数'],
        ['$L_{\\mathrm{win}}$', '多普勒加权损失，约 1—2 dB'],
        ['$L_{\\mathrm{scan}}$', '波束扫描损失，约 1—3 dB']
      ],
      usage: '① 定 N（受目标驻留时间与信道/目标相干时间限制）② 算理想增益 $10\\log_{10}N$ ③ 扣除加权、扫描、起伏、CFAR 及走动损失 ④ 单位 dB。',
      assume: '回波在 N 个脉冲内相位相干；目标匀速；无跨距离单元走动。',
      fail: '目标在积累时间内跨越距离或多普勒单元（距离走动、多普勒走动）会让积累增益大幅下降，必须做补偿（keystone 变换、Radon 变换）。水声信道相干时间常常只有几秒，N 不能无限加——这是主动声呐积累的硬上限。平台晃动还会引入额外相位调制，进一步破坏相参性。',
      tags: ['MTD', '相参积累', 'FFT', '雷达', '声呐'],
      see: 'cases/radar/mti-mtd'
    },
    {
      id: 'R-17', cat: 'radar',
      name: '盲速与脉冲重复频率',
      en: 'Blind Speed and PRF',
      tex: 'v_{\\mathrm{blind}} = \\frac{n\\,\\lambda\\,\\mathrm{PRF}}{2},\\quad n = 1,2,\\dots;\\qquad \\mathrm{PRF} > 2\\,f_{d,\\max}',
      plain: '当目标的多普勒频移恰好等于脉冲重复频率的整数倍时，相邻回波相位差为零，MTI 会把它当成静止杂波一起滤掉——这就是盲速。',
      vars: [
        ['$v_{\\mathrm{blind}}$', '第 n 个盲速（m/s）'],
        ['$\\lambda$', '波长（m）'],
        ['$\\mathrm{PRF}$', '脉冲重复频率（Hz）'],
        ['$f_{d,\\max}$', '最大期望多普勒频率（Hz）']
      ],
      usage: '① 列出关注的速度范围 ② 检查是否落入盲速 ③ 用参差 PRF（多个重复周期交替）把第一个盲速推到关注范围之外。单位 m/s。',
      assume: '单延迟对消或简单 MTI；目标匀速。',
      fail: '参差 PRF 会破坏脉冲间的均匀采样，使多普勒 FFT（MTD）出现杂波残余与虚假谱线；若同时要做相参积累，必须先在脉冲间做相位补偿。另外提高 PRF 可以推远盲速，但会缩短最大不模糊距离（见 R-18）——这一对矛盾是脉冲多普勒体制设计的核心，没有两全方案。',
      tags: ['盲速', 'PRF', 'MTI', '雷达'],
      see: 'cases/radar/mti-mtd'
    },
    {
      id: 'R-18', cat: 'radar',
      name: '最大不模糊距离',
      en: 'Maximum Unambiguous Range',
      tex: 'R_{\\max} = \\frac{c}{2\\,\\mathrm{PRF}} = \\frac{c\\,T_{r}}{2},\\qquad R_{\\max}\\,v_{\\max} = \\frac{c\\,\\lambda}{4}',
      plain: '下一个脉冲发射之前，上一个脉冲的回波必须已经回来，否则分不清回波属于哪个脉冲。更妙的是：最大不模糊距离与最大不模糊速度的乘积是常数，这是脉冲多普勒雷达最基本的权衡。',
      vars: [
        ['$c$', '传播速度（m/s）'],
        ['$\\mathrm{PRF}$', '脉冲重复频率（Hz）'],
        ['$T_{r}$', '脉冲重复周期（s）'],
        ['$v_{\\max}$', '最大不模糊速度（m/s）']
      ],
      usage: '① 由最远作用距离定 PRF 上限 ② 由最大速度定 PRF 下限 ③ 若两者冲突，用多重 PRF 或参差 PRF 解模糊。单位 m、Hz。',
      assume: '均匀 PRF；点目标；忽略二次回波与遮挡效应。',
      fail: '提高 PRF 解速度模糊必然引入距离模糊：二次回波（来自上一个 PRF 周期的远目标）会被误显示成近目标，产生"幽灵目标"。多重 PRF 解模糊要求目标在多个 PRF 上一致可见，对起伏目标（Swerling）与机动目标容易解错，严重时目标一会出现一会消失。水声里声速低、PRF 天然很低，距离模糊压力小，但多普勒采样严重不足，测速精度反而受限。',
      tags: ['最大不模糊距离', 'PRF', '距离模糊', '雷达'],
      see: 'cases/radar/mti-mtd'
    },
    {
      id: 'R-19', cat: 'radar',
      name: 'CA-CFAR 单元平均门限',
      en: 'CA-CFAR Threshold',
      tex: '\\hat{P}_{n} = \\frac{1}{N}\\sum_{i=1}^{N} x_{i},\\qquad T = \\alpha\\,\\hat{P}_{n},\\qquad \\alpha = N\\bigl(P_{fa}^{-1/N} - 1\\bigr)',
      plain: '单元平均 CFAR：用检测单元两侧参考窗内 $N$ 个单元估计背景功率，再乘一个由虚警概率决定的系数 α 作为门限。它假设背景是均匀的高斯噪声。',
      vars: [
        ['$N$', '参考单元总数，常用 16—32'],
        ['$x_{i}$', '第 i 个参考单元的功率（$\\mathrm{V^{2}}$）'],
        ['$P_{fa}$', '设定的虚警概率'],
        ['$\\alpha$', '门限因子，随 $N$ 增大而减小']
      ],
      usage: '① 定系统级 $P_{fa}$ ② 定 $N$ ③ 算 $\\alpha = N(P_{fa}^{-1/N} - 1)$ ④ 门限 $T = \\alpha\\hat{P}_{n}$。例：$N = 16$、$P_{fa} = 10^{-4}$ → $\\alpha \\approx 11.4$（约 10.6 dB）。',
      assume: '参考单元独立同分布；背景为高斯噪声（功率服从指数分布）；参考窗内无杂波边缘、无其他目标。',
      fail: '两个经典失效：① **杂波边缘**——参考窗跨越杂波边界时，门限被抬高或压低，边缘处出现漏检或虚警暴增，这在海陆交界、雨区边缘天天发生；② **多目标遮蔽**——参考窗里混入邻近强目标，门限被抬高，弱目标直接被吃掉。此外参考单元之间若相关（加窗、过采样、做过脉冲压缩），实际 $P_{fa}$ 会显著偏离设计值，通常偏高一到两个量级。',
      tags: ['CFAR', 'CA-CFAR', '恒虚警', '检测', '雷达', '声呐'],
      see: 'cases/radar/cfar'
    },
    {
      id: 'R-20', cat: 'radar',
      name: 'OS / GO / SO-CFAR 门限',
      en: 'OS / GO / SO-CFAR Thresholds',
      tex: 'T_{\\mathrm{OS}} = \\alpha_{\\mathrm{OS}}\\,x_{(k)},\\qquad T_{\\mathrm{GO}} = \\alpha\\,\\max(\\bar{X},\\,\\bar{Y}),\\qquad T_{\\mathrm{SO}} = \\alpha\\,\\min(\\bar{X},\\,\\bar{Y})',
      plain: '有序统计 CFAR 取参考单元排序后的第 k 个值；GO 取前后窗均值的较大者（抗杂波边缘）；SO 取较小者（抗多目标遮蔽）。三者各有各的失效模式，没有万能解。',
      vars: [
        ['$x_{(k)}$', '排序后第 k 个参考单元值，k 常取 $3N/4$'],
        ['$\\bar{X},\\,\\bar{Y}$', '检测单元前、后半窗的均值'],
        ['$\\alpha_{\\mathrm{OS}}$', 'OS-CFAR 门限因子，无简单闭式，需数值求解或查表']
      ],
      usage: '① 按场景选：杂波边缘用 GO，多目标用 SO，折中用 OS ② OS 的 α 需数值求解（由 $P_{fa}$、$N$、$k$ 决定）③ 单元数与保护单元要兼顾分辨率与污染风险。单位与功率一致。',
      assume: '参考单元独立同分布；杂波统计特性已知（瑞利、韦布尔或对数正态）。',
      fail: 'GO-CFAR 在多目标环境下会把邻近目标当成杂波边缘、大幅抬高门限，导致弱目标丢失；SO-CFAR 在杂波边缘处虚警率完全失控。OS-CFAR 的 α 需要数值求解，且在非瑞利杂波（海尖峰、地物）下不再对应设计 $P_{fa}$，实测虚警率可能差一个量级。所有 CFAR 都假设参考窗"干净"，而实际环境里这个假设恰恰最常不成立。',
      tags: ['CFAR', 'OS-CFAR', 'GO-CFAR', 'SO-CFAR', '检测', '雷达'],
      see: 'cases/radar/cfar'
    },
    {
      id: 'R-21', cat: 'radar',
      name: '虚警概率与检测门限',
      en: 'Probability of False Alarm and Threshold',
      tex: 'P_{fa} = \\exp\\!\\left(-\\frac{T}{\\sigma_{n}^{2}}\\right)\\ \\text{(包络平方)},\\qquad T = -\\sigma_{n}^{2}\\,\\ln P_{fa}',
      plain: '高斯噪声经包络检波后，功率服从指数分布，于是虚警概率与门限之间是一个干净的对数关系。',
      vars: [
        ['$T$', '功率检测门限（$\\mathrm{V^{2}}$ 或 $\\mathrm{Pa^{2}}$）'],
        ['$\\sigma_{n}^{2}$', '噪声功率'],
        ['$P_{fa}$', '单次独立检测的虚警概率']
      ],
      usage: '① 定系统级虚警率（如每帧不超过 0.1 次）② 除以独立检测单元数得单次 $P_{fa}$ ③ 由 $T = -\\sigma_n^2 \\ln P_{fa}$ 反解门限。单位与功率一致。',
      assume: '噪声为高斯分布、功率已知；各次检测相互独立。',
      fail: '最普遍的错误是**不除以检测单元数**：一个 $10^{6}$ 单元的二维检测面，若按单次 $P_{fa} = 10^{-6}$ 设门限，每帧约 1 次虚警看着还行；但若单元数是 $10^{8}$，虚警就有几十上百次，系统根本不可用。另外噪声功率是估出来的，估计本身有方差，用估计值代替真值会让实际 $P_{fa}$ 与标称差几倍——这就是 CFAR 损失的物理来源。',
      tags: ['虚警概率', '检测门限', 'CFAR', '雷达'],
      see: 'cases/radar/cfar'
    },
    {
      id: 'R-22', cat: 'radar',
      name: 'FMCW 差拍频率与测距',
      en: 'FMCW Beat Frequency and Ranging',
      tex: 'f_{b} = \\mu\\,\\tau = \\mu\\,\\frac{2R}{c},\\qquad R = \\frac{c\\,f_{b}}{2\\mu} = \\frac{c\\,f_{b}\\,T_{\\mathrm{sw}}}{2B}',
      plain: '回波与当前发射信号混频后得到的差拍频率，正比于往返延时，于是"测频即测距"。这是 FMCW 雷达测距的全部原理。',
      vars: [
        ['$\\mu = B/T_{\\mathrm{sw}}$', '调频率（Hz/s）'],
        ['$\\tau = 2R/c$', '往返延时（s）'],
        ['$R$', '目标距离（m）'],
        ['$B$', '扫频带宽（Hz）'],
        ['$T_{\\mathrm{sw}}$', '扫频周期（s）']
      ],
      usage: '① 由距离分辨率定 $B$（$\\Delta R = c/2B$）② 由最大距离定差拍采样率：$f_{b,\\max} = 2\\mu R_{\\max}/c$ ③ 对每帧差拍信号做 FFT 得距离谱。单位 m、Hz。',
      assume: '目标静止；扫频严格线性；无相位噪声。',
      fail: '扫频非线性（压控振荡器的电调特性不是理想直线）会直接展宽差拍谱线，使距离分辨率远差于 $c/2B$，这是 FMCW 工程化的头号难题，必须做线性化校正（开环预失真或闭环锁相）。运动目标的距离与速度在差拍频率里耦合在一起，必须靠上/下扫频或二维 FFT 解耦。相位噪声还会抬高近距离强目标的噪声基底，掩盖远距弱目标。',
      tags: ['FMCW', '差拍频率', '测距', '雷达'],
      see: 'cases/radar/fmcw'
    },
    {
      id: 'R-23', cat: 'radar',
      name: 'FMCW 二维 FFT 测距测速',
      en: 'FMCW 2D FFT for Range and Velocity',
      tex: 'f_{b,\\mathrm{up}} = f_{R} - f_{d},\\quad f_{b,\\mathrm{down}} = f_{R} + f_{d};\\qquad R = \\frac{c\\,T_{\\mathrm{sw}}}{4B}\\bigl(f_{b,\\mathrm{up}} + f_{b,\\mathrm{down}}\\bigr),\\quad v = \\frac{\\lambda}{4}\\bigl(f_{b,\\mathrm{down}} - f_{b,\\mathrm{up}}\\bigr)',
      plain: '一个扫频周期内做 FFT 得距离（快时间维），跨多个周期做 FFT 得速度（慢时间维）。这就是"距离—多普勒二维处理"。若用三角波（上扫加下扫），两个差拍频率的和给距离、差给速度，可直接解耦。',
      vars: [
        ['$f_{b,\\mathrm{up}}$', '上扫段的差拍频率（Hz）'],
        ['$f_{b,\\mathrm{down}}$', '下扫段的差拍频率（Hz）'],
        ['$f_{R}$', '距离引起的差拍频率（Hz）'],
        ['$f_{d}$', '多普勒频率（Hz）'],
        ['$T_{\\mathrm{sw}}$', '扫频周期（s）']
      ],
      usage: '① 对每个扫频周期的差拍信号做距离 FFT ② 对同一距离单元跨周期做多普勒 FFT ③ 由峰位置解出 $R$ 与 $v$ ④ 高速目标要补距离走动。单位 m、m/s。',
      assume: '目标在积累帧数内匀速直线运动；帧间相位相干；无距离—多普勒耦合残差。',
      fail: '目标速度较大时，跨帧期间距离变化超过一个距离单元会产生"距离走动"，多普勒维能量散开、积累增益下降，必须做走动补偿。另外在多目标场景下，上扫与下扫的差拍频率需要正确配对，配对错误会产生完全不存在的"幽灵目标"——车载毫米波雷达的经典失效模式。扫频带宽小时距离与速度几乎无法分离。',
      tags: ['FMCW', '二维FFT', '距离多普勒', '雷达'],
      see: 'cases/radar/fmcw'
    },
    {
      id: 'R-24', cat: 'radar',
      name: '最小可检测信号',
      en: 'Minimum Detectable Signal',
      tex: 'S_{\\min} = k\\,T_{0}\\,B\\,F_{n}\\,\\mathrm{SNR}_{\\min},\\qquad \\mathrm{SNR}_{\\min} = \\frac{E}{N_{0}}\\cdot\\frac{1}{B\\,T}',
      plain: '把热噪声、噪声系数与检测所需的最小信噪比乘起来，就是接收机输入端能"看得见"的最小信号功率。它是灵敏度指标的直接来源。',
      vars: [
        ['$k\\,T_{0}$', '噪声谱密度，290 K 时为 −174 dBm/Hz'],
        ['$B$', '噪声等效带宽（Hz）'],
        ['$F_{n}$', '噪声系数（线性值）'],
        ['$\\mathrm{SNR}_{\\min}$', '达到指定 $P_d$、$P_{fa}$ 所需的单脉冲信噪比']
      ],
      usage: '① 由检测指标（$P_d$、$P_{fa}$）定 $\\mathrm{SNR}_{\\min}$ ② 算 $kT_0 B$ ③ 乘 $F_n$ 得最小可检测功率 ④ 换算成 dBm 便于对账。单位 W 或 dBm。',
      assume: '接收机内部噪声主导；匹配滤波；白高斯噪声。',
      fail: '若系统受外部噪声或干扰限制（城市电磁环境、海洋环境噪声、混响、工业干扰），用热噪声算出的灵敏度完全不成立，实际灵敏度可能差 20—30 dB——这是"实验室灵敏度达标、外场什么都看不见"的根本原因。另外噪声系数随频率、增益、温度变化，手册典型值不能直接用于全频段预算，必须逐点测量。',
      tags: ['灵敏度', '最小可检测信号', '噪声系数', '雷达', '声呐'],
      see: 'theory/basic/snr'
    },
    {
      id: 'R-25', cat: 'radar',
      name: '单脉冲检测概率（非起伏目标）',
      en: 'Single-Pulse Detection Probability',
      tex: 'P_{d} = Q_{1}\\!\\left(\\sqrt{2\\,\\mathrm{SNR}},\\ \\sqrt{-2\\ln P_{fa}}\\,\\right)',
      plain: '非起伏（Swerling 0）目标在单次观测下的检测概率，用 Marcum Q 函数表示。它是所有检测曲线的起点。',
      vars: [
        ['$Q_{1}(\\cdot,\\ \\cdot)$', '一阶 Marcum Q 函数'],
        ['$\\mathrm{SNR}$', '单脉冲信噪比（**线性值**，不是 dB）'],
        ['$P_{fa}$', '虚警概率']
      ],
      usage: '① 定 $P_{fa}$ ② 由雷达/声呐方程得 SNR（换算成线性值）③ 查 Marcum Q 表或数值积分得 $P_d$ ④ 反查可得所需 SNR。无量纲。',
      assume: '目标截面积恒定；噪声为高斯；平方律检波；单次脉冲。',
      fail: '真实目标几乎都会起伏（姿态变化导致 RCS/TS 起伏），用非起伏模型算出的 SNR 需求偏乐观——要达到同样的 $P_d$，起伏目标往往需要多 5—15 dB 信噪比。此外平方律检波的假设在线性检波或小信号时不成立，检测曲线会整体偏移；多目标与杂波残留还会让实际 $P_{fa}$ 高于设定值，进一步压缩可用检测性能。',
      tags: ['检测概率', 'Marcum Q', '非起伏', '雷达'],
      see: 'cases/radar/cfar'
    },
    {
      id: 'R-26', cat: 'radar',
      name: 'Marcum Q 函数',
      en: 'Marcum Q Function',
      tex: 'Q_{1}(a,\\,b) = \\int_{b}^{\\infty} x\\,\\exp\\!\\left(-\\frac{x^{2} + a^{2}}{2}\\right) I_{0}(a\\,x)\\,dx',
      plain: 'Marcum Q 是莱斯分布（正弦加高斯）的补累积分布函数，它决定了"有信号时超过门限"的概率。参数 a 反映信号幅度，b 是归一化门限。',
      vars: [
        ['$a$', '信号幅度参数，检测中取 $a = \\sqrt{2\\,\\mathrm{SNR}}$'],
        ['$b$', '归一化门限，取 $b = \\sqrt{-2\\ln P_{fa}}$'],
        ['$I_{0}(\\cdot)$', '第一类零阶修正贝塞尔函数']
      ],
      usage: '① 用级数或数值积分计算（Marcum Q 有稳定的递推算法）② 多数通用数值库没有内置，需自行实现或用近似 ③ 无量纲。',
      assume: '正弦信号加窄带高斯噪声；包络服从莱斯分布。',
      fail: '直接数值积分在大 a、b 时会出现严重的数值下溢与溢出，必须使用归一化递推（如 Shnidman 或 Cantrell 算法），否则算出的 $P_d$ 会莫名其妙地跳变或恒为 0/1。另一个常见错误是把 a 当成电压信噪比而不是 $\\sqrt{2\\,\\mathrm{SNR}}$，结果整条检测曲线横向偏移 3 dB。',
      tags: ['Marcum Q', '检测理论', '莱斯分布', '雷达'],
      see: 'cases/radar/cfar'
    },
    {
      id: 'R-27', cat: 'radar',
      name: 'Albersheim 检测近似',
      en: "Albersheim's Approximation",
      tex: '\\mathrm{SNR_{dB}} = -5\\log_{10}N + \\left(6.2 + \\frac{4.54}{\\sqrt{N + 0.44}}\\right)\\log_{10}\\!\\bigl(A + 0.12\\,A\\,B + 1.7\\,B\\bigr)',
      plain: '不做数值积分，用一个闭式经验公式直接算出"N 个脉冲非相参积累达到给定 $P_d$、$P_{fa}$ 所需的单脉冲 SNR"。工程上极其好用，是所有雷达预算表的常客。',
      vars: [
        ['$N$', '非相参积累脉冲数'],
        ['$A$', '$A = \\ln(0.62/P_{fa})$'],
        ['$B$', '$B = \\ln\\!\\bigl(P_{d}/(1 - P_{d})\\bigr)$'],
        ['$\\mathrm{SNR_{dB}}$', '所需单脉冲信噪比（dB）']
      ],
      usage: '① 由 $P_d$、$P_{fa}$ 算 $A$、$B$ ② 代入求 $\\mathrm{SNR_{dB}}$ ③ 适用区间：$10^{-7} \\le P_{fa} \\le 10^{-3}$、$0.1 \\le P_{d} \\le 0.9$、$1 \\le N \\le 8096$。单位 dB。',
      assume: '线性检波器；非起伏目标；非相参积累；脉冲间统计独立。',
      fail: '超出适用区间（尤其 $P_d > 0.9$ 或起伏目标）误差可达数 dB。公式针对非起伏目标，用于 Swerling I/II 起伏目标时需额外加起伏损失，直接套用会低估所需 SNR。另外它给的是理想积累，实际还有 CFAR 损失、扫描损失、距离/多普勒走动损失要另加，累加后常常比 Albersheim 结果差 5 dB 以上。',
      tags: ['Albersheim', '检测概率', '非相参积累', '雷达'],
      see: 'cases/radar/cfar'
    },
    {
      id: 'R-28', cat: 'radar',
      name: 'Swerling 起伏模型',
      en: 'Swerling Target Models',
      tex: 'p(\\sigma) = \\frac{2\\sigma}{\\bar{\\sigma}^{2}}\\,e^{-\\sigma^{2}/\\bar{\\sigma}^{2}}\\ \\text{(I/II)};\\qquad p(\\sigma) = \\frac{8\\sigma^{3}}{\\bar{\\sigma}^{4}}\\,e^{-2\\sigma^{2}/\\bar{\\sigma}^{2}}\\ \\text{(III/IV)}',
      plain: 'Swerling 用四种模型描述目标截面积的起伏：I/II 是指数分布（起伏大），III/IV 是四自由度卡方分布（起伏小）；I/III 是扫描间起伏（脉冲间相关），II/IV 是脉冲间起伏（脉冲间独立）。',
      vars: [
        ['$\\sigma$', '瞬时截面积的平方根'],
        ['$\\bar{\\sigma}^{2}$', '平均截面积'],
        ['I / II', '指数分布：由许多独立散射体组成、无主导散射点'],
        ['III / IV', '四自由度卡方分布：有一个主导散射点加若干小散射体']
      ],
      usage: '① 判断目标类型（民航机、导弹、舰船、潜艇）与起伏速率 ② 选对应检测曲线或近似公式 ③ 计算所需 SNR ④ 无先验时按最保守的 Swerling I 设计。',
      assume: '截面积服从指定分布；脉冲间相关特性符合模型；噪声高斯。',
      fail: '真实目标的起伏往往介于模型之间，且随频率、极化、姿态变化，用错模型会导致 SNR 预算偏差 5 dB 以上——这在作用距离指标上是致命的。现代目标（隐身飞机、敷瓦潜艇）的起伏特性与经典模型差别很大，直接用 Swerling I/II 会得出过于乐观或过于保守的结论。工程惯例是：无先验时按最保守的 Swerling I 设计，再用外场实测修正。',
      tags: ['Swerling', '起伏', '检测概率', '雷达', '声呐'],
      see: 'cases/radar/cfar'
    },
    {
      id: 'R-29', cat: 'radar',
      name: '积累损失与 CFAR 损失',
      en: 'Integration Loss and CFAR Loss',
      tex: 'L_{\\mathrm{int}} = \\frac{\\mathrm{SNR}_{1}}{\\mathrm{SNR}_{N}/N},\\qquad L_{\\mathrm{CFAR}} = \\mathrm{SNR}_{\\mathrm{CFAR,dB}} - \\mathrm{SNR}_{\\mathrm{opt,dB}}',
      plain: '非相参积累达不到理想的 N 倍增益，差额叫积累损失；用有限参考单元估计噪声再设门限（而非噪声功率已知）带来的额外需求叫 CFAR 损失。两者都是几 dB 量级，却最常被漏算。',
      vars: [
        ['$\\mathrm{SNR}_{1}$', '单脉冲检测所需信噪比（线性值）'],
        ['$\\mathrm{SNR}_{N}$', 'N 脉冲积累检测所需信噪比'],
        ['$L_{\\mathrm{int}}$', '积累损失（dB），通常 1—3 dB'],
        ['$L_{\\mathrm{CFAR}}$', 'CFAR 损失（dB），$N=16$ 时约 1—3 dB']
      ],
      usage: '① 用 Albersheim 或检测曲线算 $\\mathrm{SNR}_{N}$ ② 与 $\\mathrm{SNR}_{1}/N$ 比较得积累损失 ③ 加 CFAR 损失 ④ 全部计入链路预算。单位 dB。',
      assume: '非相参积累；脉冲独立；瑞利目标或指定起伏模型。',
      fail: '系统联调时"实测比理论差 5 dB"往往就差在这些被漏算的损失项上：积累损失、CFAR 损失、扫描损失、波束形状损失、起伏损失、走动损失、匹配滤波失配损失、量化损失。每一项都不大，累加起来却常常超过 10 dB，足以让作用距离指标彻底不达标。建议做预算表时单列"损失预算"一栏，逐项登记，避免遗漏。',
      tags: ['积累损失', 'CFAR损失', '链路预算', '雷达', '声呐'],
      see: 'cases/radar/cfar'
    }

  ];

  /* ============================================================
     二、索引与检索
     ============================================================ */
  const CATS = {
    basic: {
      key: 'basic', title: '基础公式', short: '基础', icon: '∑',
      lede: '采样、量化、噪声与增益口径。这部分是整套公式的"单位与基准"——dB 基准、单边/双边、噪声带宽一旦搞错，后面算得再准也白搭。',
      tags: ['基础', '采样', '量化', '噪声']
    },
    transform: {
      key: 'transform', title: '变换公式', short: '变换', icon: '🔁',
      lede: '从 CTFT、DTFT、DFT 一路到 STFT、小波、Z 变换、希尔伯特与 FRFT。每张卡都写明"它到底把信号投影到什么基上"。',
      tags: ['变换', 'DFT', 'FFT', '时频']
    },
    filter: {
      key: 'filter', title: '滤波公式', short: '滤波', icon: '🔧',
      lede: '卷积、差分方程、FIR/IIR 设计与实现。重点区分"设计指标"与"实现后的实际指标"这两个经常被混为一谈的东西。',
      tags: ['滤波', 'FIR', 'IIR', '卷积']
    },
    spectrum: {
      key: 'spectrum', title: '谱估计公式', short: '谱估计', icon: '📊',
      lede: '周期图、Welch、参数模型与子空间方法。核心矛盾只有一条：分辨率与方差不可兼得。',
      tags: ['谱估计', '功率谱', 'AR', 'MUSIC']
    },
    array: {
      key: 'array', title: '阵列公式', short: '阵列', icon: '📡',
      lede: '阵因子、波束宽度、栅瓣、指向性与自适应波束形成。水声与雷达共用的空间滤波数学。',
      tags: ['阵列', '波束形成', 'MVDR', '孔径']
    },
    radar: {
      key: 'radar', title: '雷达/声呐专用公式', short: '雷达声呐', icon: '🎯',
      lede: '雷达方程、声呐方程、匹配滤波、脉冲压缩、多普勒、MTI/MTD、CFAR 与检测概率。全部标注 dB 基准与适用口径。',
      tags: ['雷达', '声呐', 'CFAR', '多普勒']
    }
  };

  const CAT_ORDER = ['basic', 'transform', 'filter', 'spectrum', 'array', 'radar'];

  const byCat = {};
  const byId = {};
  CAT_ORDER.forEach(k => { byCat[k] = []; });
  F.forEach(f => {
    (byCat[f.cat] || (byCat[f.cat] = [])).push(f);
    byId[f.id] = f;
  });

  /** 简单中文友好的小写化（保留英文/数字） */
  const lower = s => String(s == null ? '' : s).toLowerCase();

  /**
   * 检索
   * @param {string} q  关键字
   * @param {object} opt { cat: 限定分类 }
   * @returns {Array} 命中条目，按相关度排序
   */
  function search(q, opt) {
    opt = opt || {};
    const s = lower(String(q || '')).trim();
    if (!s) {
      return opt.cat ? (byCat[opt.cat] || []).slice() : F.slice();
    }
    const pool = opt.cat ? (byCat[opt.cat] || []) : F;
    const terms = s.split(/\s+/).filter(Boolean);
    const out = [];
    pool.forEach(f => {
      let score = 0;
      const id = lower(f.id), name = lower(f.name), en = lower(f.en);
      const tagStr = lower((f.tags || []).join(' '));
      const body = lower([f.plain, f.usage, f.assume, f.fail].join(' '));
      let ok = true;
      terms.forEach(t => {
        let sc = 0;
        if (id === t) sc += 100;
        else if (id.indexOf(t) >= 0) sc += 60;
        if (name.indexOf(t) >= 0) sc += 50;
        if (en.indexOf(t) >= 0) sc += 40;
        if (tagStr.indexOf(t) >= 0) sc += 30;
        if (body.indexOf(t) >= 0) sc += 10;
        if (!sc) ok = false;
        score += sc;
      });
      if (ok) out.push({ f: f, score: score });
    });
    out.sort((a, b) => b.score - a.score || (a.f.id < b.f.id ? -1 : 1));
    return out.map(x => x.f);
  }

  DSP.formulas = {
    list: F, byCat: byCat, byId: byId, cats: CATS, order: CAT_ORDER,
    search: search,
    get: id => byId[id] || null,
    count: F.length
  };

  /* ============================================================
     三、页面
     ============================================================ */

  /** 安全地把关键字高亮（先转义再做纯文本替换，绝不破坏 DOM） */
  function mark(text, terms) {
    let s = U.esc(String(text == null ? '' : text));
    terms.forEach(t => {
      const tt = U.esc(t);
      if (!tt) return;
      const re = new RegExp(tt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      s = s.replace(re, m => '<em class="k hit">' + m + '</em>');
    });
    return s;
  }

  const HIT_CSS = '.formula-card .hit{background:var(--warn-soft);color:var(--text-strong);'
    + 'border-radius:2px;padding:0 2px;font-style:normal;font-weight:700;box-shadow:0 0 0 1px var(--border) inset}'
    + '.fm-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:var(--sp-3)}'
    + '.fm-search{flex:1 1 260px;min-width:200px}'
    + '.fm-empty{padding:28px 12px;text-align:center;color:var(--text-dim);font-size:var(--fs-sm)}'
    + '.fm-var{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:var(--fs-sm);line-height:1.6}'
    + '.fm-var .vk{font-family:var(--font-mono);color:var(--accent);white-space:nowrap}'
    + '.fm-var .vv{color:var(--text-dim)}'
    + '.fm-tags{margin-top:var(--sp-3);display:flex;gap:5px;flex-wrap:wrap}'
    + '.fm-catbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--sp-3)}';

  function ensureStyle() {
    if (document.getElementById('fm-style')) return;
    const st = document.createElement('style');
    st.id = 'fm-style';
    st.textContent = HIT_CSS;
    document.head.appendChild(st);
  }

  /** 构造一个分类的视图 */
  function makeView(catKey) {
    const M = CATS[catKey];
    return {
      title: M.title,
      lede: M.lede,
      tags: M.tags.concat(['共 ' + F.length + ' 条']),
      render: function (el, params) {
        ensureStyle();
        params = params || {};

        const st = {
          q: String(params.q || ''),
          scope: (params.scope === 'all') ? 'all' : 'cat'
        };

        /* ---------- 分类快捷跳转 ---------- */
        const catbar = h('div.fm-catbar.no-print', {}, CAT_ORDER.map(k => {
          const c = CATS[k];
          const on = k === catKey;
          return h('a.chip.' + (on ? 'blue' : 'clickable'), {
            href: '#/formula/' + k + (st.q ? '?q=' + encodeURIComponent(st.q) : ''),
            style: on ? { fontWeight: '700' } : null,
            text: c.short + ' ' + (byCat[k] ? byCat[k].length : 0)
          });
        }));

        /* ---------- 搜索框 ---------- */
        const inp = h('input.fm-search', {
          type: 'text',
          value: st.q,
          placeholder: '搜索：公式名 / 英文名 / 标签 / 编号，例如 FFT、CFAR、多普勒、T-01',
          oninput: function () { schedule(this.value); },
          onkeydown: function (e) { if (e.key === 'Escape') { this.value = ''; schedule(''); } }
        });

        const note = h('div.small.dim', { style: { flex: '1 1 100%' }, text: '' });

        const scopeSeg = UI.seg({
          label: '范围',
          options: [
            { label: '本类（' + (byCat[catKey] ? byCat[catKey].length : 0) + '）', value: 'cat' },
            { label: '全部公式（' + F.length + '）', value: 'all' }
          ],
          value: st.scope,
          onChange: function (v) { st.scope = v; sync(); draw(); }
        });

        const btnClear = UI.button('清空', function () {
          inp.value = ''; st.q = ''; sync(); draw(); inp.focus();
        }, 'sm ghost');

        const toolbar = h('div.fm-toolbar.no-print', {}, [inp, scopeSeg.el, btnClear, note]);

        const listEl = h('div', { id: 'fm-list' });

        el.appendChild(catbar);
        el.appendChild(toolbar);
        el.appendChild(listEl);

        /* ---------- 状态同步 ---------- */
        const syncNow = function () {
          try { DSP.share.syncParams({ q: st.q, scope: st.scope === 'cat' ? '' : 'all' }); }
          catch (e) { /* file:// 下部分浏览器禁用 history API，忽略即可 */ }
        };
        const sync = U.debounce(syncNow, 220);

        const sched = function (v) { st.q = String(v || ''); sync(); draw(); };
        const schedule = U.debounce(sched, 140);

        /* ---------- 列表绘制 ---------- */
        function draw() {
          const terms = st.q.toLowerCase().split(/\s+/).filter(Boolean);
          const cat = st.scope === 'all' ? null : catKey;
          const rows = search(st.q, { cat: cat });

          U.clear(listEl);

          if (!rows.length) {
            listEl.appendChild(h('div.card', {}, h('div.card-bd', {},
              h('div.fm-empty', { html: '没有匹配的公式。试试 <code>FFT</code>、<code>CFAR</code>、<code>多普勒</code>、<code>MVDR</code>，或切换到「全部公式」。' }))));
            note.textContent = '命中 0 条';
            return;
          }

          const frag = document.createDocumentFragment();
          rows.forEach(f => frag.appendChild(card(f, terms)));
          listEl.appendChild(frag);

          note.textContent = '命中 ' + rows.length + ' 条'
            + (terms.length ? '　关键词：' + terms.join(' / ') : '')
            + '　（当前范围：' + (st.scope === 'all' ? '全部公式' : CATS[catKey].short) + '）';
        }

        draw();
        return function cleanup() {};
      }
    };
  }

  /** 单条公式卡片 */
  function card(f, terms) {
    const c = h('div.formula-card', { dataset: { anchor: f.id, cat: f.cat } });

    const acts = h('span.fc-actions', {}, [
      f.see ? h('a.btn.sm', { href: '#/' + f.see, text: '关联知识页' }) : null,
      UI.button('复制链接', function () {
        let url;
        try { url = DSP.share.link({ s: f.id }); }
        catch (e) { url = location.href.split('#')[0] + '#/formula/' + f.cat + '?s=' + f.id; }
        U.copy(url).then(() => UI.toast('已复制「' + f.name + '」的链接'));
      }, 'sm'),
      UI.button('复制公式源码', function () {
        U.copy('$$' + f.tex + '$$').then(() => UI.toast('已复制 LaTeX 源码'));
      }, 'sm ghost')
    ]);

    const hd = h('div.fc-hd', {}, [
      h('span.fc-name', { html: mark(f.name, terms) }),
      h('span.fc-id', { text: f.id }),
      h('span.chip.teal', { text: CATS[f.cat] ? CATS[f.cat].short : f.cat }),
      acts
    ]);

    const bd = h('div.fc-bd');

    // 公式：走 KaTeX（标记 texDone，避免二次渲染把编号冲掉）
    const mb = UI.mathBlock(f.tex, f.id);
    mb.dataset.texDone = '1';
    bd.appendChild(h('div.math-scroll', {}, mb));

    bd.appendChild(sec('通俗解读', h('div.prose', { html: U.md(f.plain) })));

    // 变量说明
    if (f.vars && f.vars.length) {
      const grid = h('div.fm-var', {}, f.vars.map(v => [
        h('div.vk', { html: U.md(String(v[0])) }),
        h('div.vv', { html: U.md(String(v[1])) })
      ]).reduce((a, b) => a.concat(b), []));
      bd.appendChild(sec('变量说明（逐个）', grid));
    }

    bd.appendChild(sec('怎么用', h('div.prose', { html: U.md(f.usage) })));
    bd.appendChild(sec('前提假设', h('div.prose', { html: U.md(f.assume) })));

    // 失效场景：本软件的差异化重点
    const failBody = h('div.prose', { html: U.md(f.fail) });
    bd.appendChild(sec('工程失效场景', UI.callout('pit', '什么时候这条公式会坑你', failBody)));

    if (f.tags && f.tags.length) {
      const tg = h('div.fm-tags', {}, f.tags.map(t =>
        h('span.chip.' + (terms.indexOf(String(t).toLowerCase()) >= 0 ? 'orange' : 'blue'), {
          text: '#' + t
        })));
      bd.appendChild(tg);
    }

    c.appendChild(hd);
    c.appendChild(bd);
    return c;
  }

  /** 卡片内的小节 */
  function sec(label, body) {
    return h('div.fc-sec', {}, [h('div.lbl', { text: label }), body]);
  }

  /* ---------- 注册六个路由 ---------- */
  CAT_ORDER.forEach(k => {
    DSP.router.register('formula/' + k, makeView(k));
  });

})(window);

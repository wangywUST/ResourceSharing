/* =============================================================
   data/code-examples.js —— Python / MATLAB 代码示例库（纯数据层）
   全局命名空间：window.DSP.codeLib

   每条示例结构：
     {
       id:   '唯一标识',
       cat:  '分类 id（见 CATS）',
       name: '示例标题',
       desc: '一段话说明：对应网页哪个模块、用什么参数复现网页默认状态',
       py:   '可直接运行的 Python 脚本（numpy / scipy / matplotlib）',
       ml:   '可直接运行的 MATLAB 脚本（Signal Processing Toolbox）',
       see:  '对应的网页交互路由（不含 #/ 前缀）'
     }

   书写约定：
     1) Python 依赖 numpy / scipy / matplotlib；若用到 scipy.signal 会在注释中写明。
     2) MATLAB 若需要 Signal Processing Toolbox / Phased Array System Toolbox，会在首行注明。
     3) 所有注释使用中文，尽量做到「每一行为什么这样写」。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});

  /* ============================================================
     分类表（左侧导航用）
     ============================================================ */
  const CATS = [
    { id: 'basic', name: '基础', icon: '①' },
    { id: 'transform', name: '核心变换', icon: '②' },
    { id: 'filter', name: '滤波', icon: '③' },
    { id: 'spectrum', name: '谱估计', icon: '④' },
    { id: 'array', name: '阵列处理', icon: '⑤' },
    { id: 'radar', name: '雷达', icon: '⑥' },
    { id: 'sonar', name: '声呐', icon: '⑦' }
  ];

  /* ============================================================
     示例条目
     ============================================================ */
  const items = [];

  function add(o) { items.push(o); return o; }

  /* ==================================================================
     一、基础（信号生成 / 加噪 / 混叠 / 量化）
     ================================================================== */

  add({
    id: 'signal-gen-sample',
    cat: 'basic',
    name: '信号生成与采样：从连续到离散',
    desc: '对应网页「① 采样定理交互实验台」的默认状态：采样率 2 kHz、时长 0.5 s、50 Hz + 120 Hz 双正弦。示例演示如何正确产生时间轴、如何做奈奎斯特核查、以及如何画出幅度标定正确的单边谱。',
    py: `import numpy as np
import matplotlib.pyplot as plt

# ===== 1. 采样参数（与网页「采样定理交互实验台」默认状态一致） =====
fs = 2000                 # 采样率 Hz：决定频谱能表示的最高频率 fs/2
T  = 0.5                  # 观测时长 s
N  = int(T * fs)          # 采样点数 = 时长 × 采样率 = 1000
t  = np.arange(N) / fs    # 时间轴：第 n 个样点对应 t = n/fs，注意不含终点

# ===== 2. 构造双正弦信号 =====
f1, A1 = 50.0, 1.0        # 分量一：50 Hz，幅度 1
f2, A2 = 120.0, 0.5       # 分量二：120 Hz，幅度 0.5
phi2 = 0.8                # 分量二初相 (rad)：初相不改变幅度谱，只改变相位谱
x = A1 * np.sin(2 * np.pi * f1 * t) + A2 * np.sin(2 * np.pi * f2 * t + phi2)

# ===== 3. 采样定理核查：必须 fs > 2*fmax，否则混叠 =====
fmax = max(f1, f2)
print('奈奎斯特频率 fs/2 =', fs / 2, 'Hz；信号最高频率 =', fmax, 'Hz')
print('是否满足 fs > 2*fmax :', fs > 2 * fmax)

# ===== 4. 单边幅度谱：注意幅度标定 =====
# Δf = fs/N = 2 Hz，50 Hz 与 120 Hz 都落在整数谱线上，因此没有泄漏
X = np.fft.rfft(x)                     # 实信号用 rfft 只取正频率，长度 N/2+1
freq = np.fft.rfftfreq(N, 1 / fs)      # 频率轴 (Hz)
amp = 2 * np.abs(X) / N                # 乘 2 把负频能量并到正频
amp[0] = amp[0] / 2                    # 直流分量不应乘 2，单独修正
if N % 2 == 0:
    amp[-1] = amp[-1] / 2              # Nyquist 点同样不乘 2

# ===== 5. 绘图 =====
plt.figure(figsize=(9, 6))
plt.subplot(2, 1, 1)
plt.plot(t[:200] * 1000, x[:200], lw=1.2)   # 只画前 200 点，否则波形挤成一团
plt.xlabel('时间 t / ms'); plt.ylabel('幅度 x(t)')
plt.title('时域波形（fs = 2 kHz，50 Hz + 120 Hz）'); plt.grid(alpha=0.3)

plt.subplot(2, 1, 2)
plt.plot(freq, amp, lw=1.2)
plt.plot([f1, f2], [A1, A2], 'ro')          # 真值标定：谱峰应落在 (50, 1.0) 与 (120, 0.5)
plt.xlabel('频率 f / Hz'); plt.ylabel('单边幅度')
plt.title('单边幅度谱（Δf = fs/N = 2 Hz）'); plt.grid(alpha=0.3)
plt.tight_layout(); plt.show()
`,
    ml: `%% MATLAB —— 信号生成与采样（需要 MATLAB 基础版即可）
clear; clc; close all;

fs = 2000;                % 采样率 Hz
T  = 0.5;                 % 观测时长 s
N  = round(T * fs);       % 采样点数
t  = (0:N-1) / fs;        % 时间轴：MATLAB 下标从 1 开始，第 n 个点为 (n-1)/fs

f1 = 50;  A1 = 1.0;       % 分量一
f2 = 120; A2 = 0.5;       % 分量二
phi2 = 0.8;               % 初相 rad
x = A1*sin(2*pi*f1*t) + A2*sin(2*pi*f2*t + phi2);

fmax = max([f1 f2]);
fprintf('奈奎斯特频率 fs/2 = %.1f Hz，信号最高频率 = %.1f Hz\\n', fs/2, fmax);
fprintf('是否满足 fs > 2*fmax : %d\\n', fs > 2*fmax);

%% 单边幅度谱
X = fft(x);
P2 = abs(X) / N;          % 双边谱，除以 N 做长度归一化
P1 = P2(1:N/2+1);         % 取单边
P1(2:end-1) = 2*P1(2:end-1);  % 除直流与 Nyquist 外，乘 2 并回负频能量
f = fs*(0:(N/2))/N;       % 频率轴

subplot(2,1,1); plot(t(1:200)*1000, x(1:200)); grid on;
xlabel('时间 t / ms'); ylabel('幅度 x(t)');
title('时域波形（fs = 2 kHz，50 Hz + 120 Hz）');

subplot(2,1,2); plot(f, P1); grid on; hold on;
plot([f1 f2], [A1 A2], 'ro');
xlabel('频率 f / Hz'); ylabel('单边幅度');
title('单边幅度谱（Δf = fs/N = 2 Hz）');
`,
    see: 'lab/sampling'
  });

  add({
    id: 'noise-snr',
    cat: 'basic',
    name: '加噪与信噪比：SNR 的正确算法',
    desc: '对应网页「信噪比与动态范围」一节与「⑨ 匹配滤波」实验台：1024 点、2 kHz 采样、100 Hz 单频、目标 SNR = 6 dB。示例给出加噪公式、实测 SNR 的两种算法，以及"处理增益 10log10(N/2)"为何让谱峰远高于噪声底。',
    py: `import numpy as np
import matplotlib.pyplot as plt

# ===== 1. 干净信号 =====
rng = np.random.default_rng(20240921)      # 固定随机种子：结果可复现
fs, N = 2000, 1024
t = np.arange(N) / fs
f_sig = 100.0
s = np.sin(2 * np.pi * f_sig * t)

# ===== 2. 按给定 SNR 加噪 =====
snr_db = 6.0                               # 目标信噪比 dB
Ps = np.mean(s ** 2)                       # 信号功率：实信号用均方值
Pn = Ps / (10 ** (snr_db / 10))            # 由 SNR = Ps/Pn 反解噪声功率
noise = np.sqrt(Pn) * rng.standard_normal(N)   # 乘标准差得到所需功率
x = s + noise

# ===== 3. 实测 SNR：用 (干净 - 含噪) 的差估计噪声，而不是直接假设已知噪声 =====
err = x - s
snr_meas = 10 * np.log10(np.mean(s ** 2) / np.mean(err ** 2))
print('设定 SNR = %.2f dB，实测 SNR = %.3f dB' % (snr_db, snr_meas))

# ===== 4. FFT 处理增益：单点 SNR 提高约 10log10(N/2) =====
w = np.hanning(N)                          # 汉宁窗抑制泄漏
X = np.fft.rfft(x * w)
f = np.fft.rfftfreq(N, 1 / fs)
# 谱峰附近的功率
k = np.argmax(np.abs(X))
Pk = np.sum(np.abs(X[max(0, k - 5):k + 6]) ** 2)
Pnoise = np.sum(np.abs(X) ** 2) - Pk
gain = 10 * np.log10(N / 2)                # 处理增益理论值 ≈ 27.1 dB
print('FFT 点数 N = %d，理论处理增益 10log10(N/2) = %.1f dB' % (N, gain))

# ===== 5. 绘图：时域看不出 SNR=6dB 的谱峰，频域一眼可见 =====
plt.figure(figsize=(9, 6))
plt.subplot(2, 1, 1)
plt.plot(t * 1000, x, lw=0.8, label='含噪观测')
plt.plot(t * 1000, s, lw=1.2, label='干净信号')
plt.xlabel('时间 t / ms'); plt.ylabel('幅度'); plt.legend(); plt.grid(alpha=0.3)
plt.title('时域：SNR = 6 dB 时波形已明显失真')

plt.subplot(2, 1, 2)
Xdb = 20 * np.log10(np.abs(X) / np.abs(X).max() + 1e-12)
plt.plot(f, Xdb, lw=1.0)
plt.xlabel('频率 f / Hz'); plt.ylabel('归一化幅度 / dB'); plt.grid(alpha=0.3)
plt.title('频域：能量集中到 100 Hz 一个点上，高出背景约 ' + format(gain, '.1f') + ' dB')
plt.tight_layout(); plt.show()
`,
    ml: `%% MATLAB —— 加噪与信噪比（基础版即可）
clear; clc; close all;

rng(20240921);            % 固定随机种子
fs = 2000; N = 1024;
t = (0:N-1)'/fs;          % 用列向量，与 MATLAB 内置函数习惯一致
f_sig = 100;
s = sin(2*pi*f_sig*t);

snr_db = 6;                        % 目标信噪比 dB
% MATLAB 的 awgn 默认按"信号功率"归一化加噪，直接可用（需 Communications Toolbox）
% x = awgn(s, snr_db, 'measured');
% 这里手写一遍，便于看清公式：
Ps = mean(s.^2);
Pn = Ps / (10^(snr_db/10));
x  = s + sqrt(Pn)*randn(N,1);

err = x - s;
snr_meas = 10*log10(mean(s.^2)/mean(err.^2));
fprintf('设定 SNR = %.2f dB，实测 SNR = %.3f dB\\n', snr_db, snr_meas);

%% FFT 处理增益
w = hann(N);                       % 汉宁窗（对称，末端为 0）
X = fft(x.*w);
X = X(1:N/2+1);
f = fs*(0:N/2)'/N;
gain = 10*log10(N/2);
fprintf('理论处理增益 10log10(N/2) = %.1f dB\\n', gain);

subplot(2,1,1); plot(t*1000, x, 'Color', [0.5 0.5 0.5]); hold on;
plot(t*1000, s, 'r', 'LineWidth', 1.2); grid on;
xlabel('时间 t / ms'); ylabel('幅度'); legend('含噪观测','干净信号');
title('时域：SNR = 6 dB 时波形已明显失真');

subplot(2,1,2); plot(f, 20*log10(abs(X)/max(abs(X))+1e-12)); grid on;
xlabel('频率 f / Hz'); ylabel('归一化幅度 / dB');
title('频域：单点 SNR 被处理增益抬高');
`,
    see: 'lab/matched'
  });

  add({
    id: 'aliasing-demo',
    cat: 'basic',
    name: '混叠演示：欠采样如何让高频"伪装"成低频',
    desc: '对应网页「采样定理与混叠机理」与「欠采样与带通采样」两节。真实频率 700 Hz，用 4 kHz / 1.4 kHz / 1 kHz / 600 Hz 四档采样率分别采集，观察观测频率如何按 |f − k·fs| 折叠到 [0, fs/2]。',
    py: `import numpy as np
import matplotlib.pyplot as plt

f_true = 700.0                       # 真实信号频率 Hz
fs_list = [4000, 1400, 1000, 600]    # 四档采样率：只有 4000 Hz 满足 Nyquist
T = 0.006                            # 画 6 ms，足够看清波形

def alias_freq(f, fs):
    """由真实频率与采样率求观测频率：折叠到 [0, fs/2]"""
    fa = np.abs(((f + fs / 2) % fs) - fs / 2)   # 先折到 [-fs/2, fs/2]，再取绝对值
    return fa

# ===== 1. 细致连续波形（画图参考线，采样率远高于信号） =====
tc = np.linspace(0, T, 4000)
xc = np.sin(2 * np.pi * f_true * tc)

plt.figure(figsize=(10, 8))
for i, fs in enumerate(fs_list, 1):
    n = int(T * fs)
    t = np.arange(n) / fs
    x = np.sin(2 * np.pi * f_true * t)          # 以 fs 采样；注意相位被样点位置约束

    # FFT 找观测到的频率
    Nfft = 4096
    X = np.abs(np.fft.rfft(x * np.hanning(n), Nfft))
    f_grid = np.fft.rfftfreq(Nfft, 1 / fs)
    f_obs = f_grid[np.argmax(X)]

    plt.subplot(len(fs_list), 1, i)
    plt.plot(tc * 1000, xc, color='#bbbbbb', lw=1)          # 灰色：真实连续波形
    plt.stem(t * 1000, x, linefmt='C0-', markerfmt='C0o', basefmt=' ')
    plt.title('fs = %d Hz：观测频率 %.1f Hz（理论折叠值 %.1f Hz）'
              % (fs, f_obs, alias_freq(f_true, fs)))
    plt.xlabel('时间 t / ms'); plt.ylabel('幅度'); plt.grid(alpha=0.3)
plt.tight_layout(); plt.show()

# ===== 2. 打印折叠关系 =====
print('真实频率 %g Hz 在各采样率下的观测频率：' % f_true)
for fs in fs_list:
    print('  fs = %5d Hz  ->  观测 %7.1f Hz   （%s）'
          % (fs, alias_freq(f_true, fs), '无混叠' if fs > 2 * f_true else '发生混叠'))
`,
    ml: `%% MATLAB —— 混叠演示（基础版即可）
clear; clc; close all;

f_true = 700;                       % 真实频率 Hz
fs_list = [4000 1400 1000 600];     % 四档采样率
T = 0.006;                          % 观测时长 s
tc = linspace(0, T, 4000);          % 参考的"密集"时间轴
xc = sin(2*pi*f_true*tc);

alias_freq = @(f, fs) abs(mod(f + fs/2, fs) - fs/2);   % 折叠公式

figure;
for i = 1:length(fs_list)
    fs = fs_list(i);
    n  = round(T*fs);
    t  = (0:n-1)/fs;
    x  = sin(2*pi*f_true*t);

    Nfft = 4096;
    X = abs(fft(x.*hann(n)', Nfft));
    X = X(1:Nfft/2+1);
    fg = fs*(0:Nfft/2)/Nfft;
    [~, idx] = max(X);
    f_obs = fg(idx);

    subplot(length(fs_list), 1, i);
    plot(tc*1000, xc, 'Color', [0.75 0.75 0.75]); hold on;
    stem(t*1000, x, 'filled', 'MarkerSize', 4);
    grid on; xlabel('时间 t / ms'); ylabel('幅度');
    status = '无混叠';
    if fs <= 2*f_true, status = '发生混叠'; end
    title(sprintf('fs = %d Hz：观测 %.1f Hz（理论 %.1f Hz，%s）', ...
          fs, f_obs, alias_freq(f_true, fs), status));
end

fprintf('真实频率 %g Hz 的折叠结果：\\n', f_true);
for fs = fs_list
    fprintf('  fs = %5d Hz -> 观测 %7.1f Hz\\n', fs, alias_freq(f_true, fs));
end
`,
    see: 'lab/sampling'
  });

  add({
    id: 'quantization-sqnr',
    cat: 'basic',
    name: '量化与 SQNR：位数到底换来多少 dB',
    desc: '对应网页「量化、A/D 与 D/A 转换」一节。满量程正弦输入，分别用 4 / 8 / 12 / 16 位均匀量化，验证 SQNR ≈ 6.02b + 1.76 dB，并观察量化噪声底的形状与谐波失真。',
    py: `import numpy as np
import matplotlib.pyplot as plt

fs, N = 8000, 4096
t = np.arange(N) / fs
A = 0.8                                   # 信号幅度（满量程设为 1.0，留 20% 防削波）
x = A * np.sin(2 * np.pi * 440 * t)

FS_LOW, FS_HIGH = -1.0, 1.0               # 量化器满量程范围
results = []

plt.figure(figsize=(9, 6))
for i, bits in enumerate([4, 8, 12, 16], 1):
    L = 2 ** bits                         # 量化电平数
    q = (FS_HIGH - FS_LOW) / L            # 量化步长 Δ = 满量程 / 电平数
    idx = np.floor((x - FS_LOW) / q)      # 下取整得到量化下标
    idx = np.clip(idx, 0, L - 1)          # 削波保护：超出范围的样本压到边界电平
    xq = FS_LOW + (idx + 0.5) * q         # 反量化：取每个区间的中点重建

    e = xq - x                            # 量化误差（噪声）
    Ps = np.mean(x ** 2)
    Pn = np.mean(e ** 2)
    sqnr = 10 * np.log10(Ps / Pn)
    sqnr_th = 6.02 * bits + 1.76 + 20 * np.log10(A)   # 理论值含相对幅度修正项
    results.append((bits, sqnr, sqnr_th))
    print('b = %2d 位：实测 SQNR = %6.2f dB，理论 6.02b+1.76 = %6.2f dB'
          % (bits, sqnr, sqnr_th))

    plt.subplot(2, 2, i)
    plt.plot(t[:120] * 1000, x[:120], lw=1.2, label='原始')
    plt.step(t[:120] * 1000, xq[:120], where='mid', lw=1.0, label='量化后')
    plt.title('b = %d 位，SQNR = %.1f dB' % (bits, sqnr))
    plt.xlabel('时间 t / ms'); plt.ylabel('幅度'); plt.legend(fontsize=8); plt.grid(alpha=0.3)
plt.tight_layout(); plt.show()

# ===== 结论：每增加 1 位，SQNR 提升约 6 dB =====
print('每多 1 位带来的 SQNR 增量：')
for k in range(1, len(results)):
    print('  %2d -> %2d 位：%+.2f dB' % (results[k-1][0], results[k][0],
                                        results[k][1] - results[k-1][1]))
`,
    ml: `%% MATLAB —— 量化与 SQNR（基础版即可）
clear; clc; close all;

fs = 8000; N = 4096;
t = (0:N-1)/fs;
A = 0.8;                            % 幅度：满量程为 1，留余量防削波
x = A*sin(2*pi*440*t);

FS_LOW = -1; FS_HIGH = 1;
bits_list = [4 8 12 16];
fprintf('位数   实测 SQNR     理论 6.02b+1.76\\n');
figure;
for i = 1:length(bits_list)
    bits = bits_list(i);
    L = 2^bits;                     % 电平数
    q = (FS_HIGH - FS_LOW)/L;       % 量化步长
    idx = floor((x - FS_LOW)/q);
    idx = max(0, min(L-1, idx));    % 削波保护
    xq  = FS_LOW + (idx + 0.5)*q;   % 取区间中点重建

    e = xq - x;
    sqnr    = 10*log10(mean(x.^2)/mean(e.^2));
    sqnr_th = 6.02*bits + 1.76 + 20*log10(A);
    fprintf('  %2d     %8.2f dB     %8.2f dB\\n', bits, sqnr, sqnr_th);

    subplot(2,2,i);
    plot(t(1:120)*1000, x(1:120)); hold on;
    stairs(t(1:120)*1000, xq(1:120)); grid on;
    xlabel('时间 t / ms'); ylabel('幅度');
    legend('原始','量化后'); title(sprintf('b = %d 位，SQNR = %.1f dB', bits, sqnr));
end
`,
    see: 'theory/basic/quant'
  });

  add({
    id: 'multirate-resample',
    cat: 'basic',
    name: '多速率处理：抽取、内插与抗混叠',
    desc: '对应网页「基础模块」抽取与内插的工程做法：先抗混叠滤波再抽取（decimate），先内插再镜像抑制（interp）。示例对比"直接抽取"与"滤波后抽取"的频谱，直观展示混叠与镜像频谱的来龙去脉。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import firwin, lfilter, freqz, decimate, resample_poly

# ===== 1. 原始信号：宽带（含 30 Hz 与 180 Hz 两个分量）+ fs = 1200 Hz =====
fs = 1200
N = 4096
t = np.arange(N) / fs
x = np.sin(2 * np.pi * 30 * t) + 0.6 * np.sin(2 * np.pi * 180 * t)

M = 4                                    # 抽取倍数 4 -> 新采样率 300 Hz
# 注意：300 Hz 的奈奎斯特频率是 150 Hz，180 Hz 分量必须被抗混叠滤波器滤掉

# ===== 2. 错误做法：直接隔点抽取，180 Hz 会折叠到 |180-300| = 120 Hz =====
x_bad = x[::M]
fs_new = fs // M

# ===== 3. 正确做法：先用 FIR 低通把带宽限制到 fs_new/2 以内，再抽取 =====
h = firwin(101, 0.9 / M, window='hamming')    # 截止频率 0.9*(fs_new/2) 归一化到 fs/2
x_lp = lfilter(h, 1, x)
x_good = x_lp[::M]

# scipy 的一步到位版本内部就是"滤波 + 抽取"，且用多相结构提高效率
x_dec = decimate(x, M, ftype='fir')

def spectrum(sig, fsx, nfft=4096):
    """返回归一化到峰值 0 dB 的单边幅度谱"""
    S = np.abs(np.fft.rfft(sig * np.hanning(len(sig)), nfft))
    S = S / S.max()
    return np.fft.rfftfreq(nfft, 1 / fsx), 20 * np.log10(S + 1e-12)

plt.figure(figsize=(9, 7))
plt.subplot(3, 1, 1)
f0, d0 = spectrum(x, fs)
plt.plot(f0, d0); plt.title('原始信号（fs = 1200 Hz）：30 Hz 与 180 Hz'); plt.grid(alpha=0.3)

plt.subplot(3, 1, 2)
f1, d1 = spectrum(x_bad, fs_new)
plt.plot(f1, d1, 'r'); plt.title('直接抽取后的频谱：180 Hz 混叠成 %d Hz 的假影' % int(np.round(f1[np.argsort(d1)[-2]])))
plt.grid(alpha=0.3)

plt.subplot(3, 1, 3)
f2, d2 = spectrum(x_good, fs_new)
plt.plot(f2, d2, 'g'); plt.title('先抗混叠滤波再抽取：只保留 30 Hz，无混叠'); plt.grid(alpha=0.3)
plt.xlabel('频率 f / Hz'); plt.tight_layout(); plt.show()

# ===== 4. 有理数倍重采样（先内插 L 倍再抽取 M 倍） =====
x_rs = resample_poly(x, 3, 2)            # 采样率变为 1.5 倍
print('重采样前后样点数：%d -> %d（倍率 %.2f）' % (len(x), len(x_rs), len(x_rs) / len(x)))
`,
    ml: `%% MATLAB —— 多速率处理（需要 Signal Processing Toolbox）
clear; clc; close all;

fs = 1200; N = 4096;
t = (0:N-1)/fs;
% 30 Hz 保留组分 + 180 Hz 会被抽取后混叠的组分
x = sin(2*pi*30*t) + 0.6*sin(2*pi*180*t);

M = 4;                      % 抽取倍数 -> 新采样率 300 Hz，Nyquist = 150 Hz
fs_new = fs/M;

%% 1) 错误：直接隔点抽取
x_bad = x(1:M:end);

%% 2) 正确：先低通抗混叠再抽取（MATLAB 的 decimate 已内部完成）
h = fir1(100, 0.9/M, 'low');   % 归一化截止 = 0.9*(fs_new/2)/(fs/2)
x_lp = filter(h, 1, x);
x_good = x_lp(1:M:end);

%% 3) 一步到位：decimate 自带抗混叠；interp 自带镜像抑制
x_dec = decimate(x, M, 'fir');
x_int = interp(x, 3);          % 3 倍内插，内部自动补镜像抑制滤波

%% 频谱对比
subplot(3,1,1); pwelch(x, hann(512), 256, 2048, fs, 'onesided');
title('原始信号（fs = 1200 Hz）');
subplot(3,1,2); pwelch(x_bad, hann(128), 64, 512, fs_new, 'onesided');
title('直接抽取：180 Hz 混叠成假影');
subplot(3,1,3); pwelch(x_good, hann(128), 64, 512, fs_new, 'onesided');
title('滤波后抽取：只保留 30 Hz');

fprintf('decimate 后长度 %d -> %d；interp 后长度 %d -> %d\\n', ...
        N, length(x_dec), N, length(x_int));
`,
    see: 'theory/basic/bandpass'
  });

  /* ==================================================================
     二、核心变换（FFT / STFT / Hilbert / Z / FRFT）
     ================================================================== */

  add({
    id: 'fft-window-compare',
    cat: 'transform',
    name: 'FFT 频谱与加窗对比：泄漏、栅栏与幅度标定',
    desc: '对应网页「② DFT/FFT 交互实验台」默认状态：1024 点、汉宁窗、2 kHz 采样、100 Hz + 250 Hz 双音。示例把矩形/汉宁/汉明/布莱克曼/凯泽五种窗放在一起比较，并演示"用窗的和而不是 N 做归一化"才能让幅度读数正确。',
    py: `import numpy as np
import matplotlib.pyplot as plt

# ===== 1. 参数：与网页「DFT/FFT 交互实验台」默认一致 =====
fs, N = 2000, 1024
t = np.arange(N) / fs
f1, A1 = 100.0, 1.0
f2, A2 = 250.0, 0.5
# 关键：让两个频率刻意偏离整数谱线（Δf = fs/N = 1.953 Hz），以暴露泄漏与栅栏效应
x = A1 * np.sin(2 * np.pi * f1 * t) + A2 * np.sin(2 * np.pi * f2 * t)

windows = {
    '矩形窗': np.ones(N),
    '汉宁窗': np.hanning(N),
    '汉明窗': np.hamming(N),
    '布莱克曼窗': np.blackman(N),
    '凯泽窗(β=8.6)': np.kaiser(N, 8.6),
}

nfft = 8192                                  # 补零 8 倍：只加密频谱网格，不提高真实分辨率
freq = np.fft.rfftfreq(nfft, 1 / fs)

plt.figure(figsize=(10, 8))
for i, (name, w) in enumerate(windows.items(), 1):
    xw = x * w
    X = np.abs(np.fft.rfft(xw, nfft))
    # 幅度归一化：除以窗的和（相干增益），矩形窗时 sum(w)=N，与教科书公式一致
    amp = 2 * X / np.sum(w)
    amp_db = 20 * np.log10(amp / A1 + 1e-12)  # 以强信号的理论幅度为 0 dB 参考

    plt.subplot(len(windows), 1, i)
    plt.plot(freq, amp_db, lw=1.0)
    plt.xlim(0, 500); plt.ylim(-120, 5)
    plt.axvline(f1, color='r', ls='--', lw=0.8)
    plt.axvline(f2, color='g', ls='--', lw=0.8)
    plt.title(name + '：看 100 Hz 附近的泄漏底与 250 Hz 弱信号的可见性')
    plt.ylabel('dB'); plt.grid(alpha=0.3)
plt.xlabel('频率 f / Hz'); plt.tight_layout(); plt.show()

# ===== 2. 定量结论：主瓣宽度与旁瓣高度的取舍 =====
print('窗函数'.ljust(16), '相干增益', '  等效噪声带宽(bin)')
for name, w in windows.items():
    enbw = N * np.sum(w ** 2) / np.sum(w) ** 2     # ENBW 单位：FFT bin
    print(name.ljust(16), '%.4f' % (np.sum(w) / N), '   %.3f' % enbw)
print('说明：ENBW 越大，噪声功率被"收集"得越多，白噪声背景下的检测 SNR 越差（处理损失）。')
`,
    ml: `%% MATLAB —— FFT 频谱与加窗对比（基础版即可，Kaiser 窗需 Signal Processing Toolbox）
clear; clc; close all;

fs = 2000; N = 1024;
t = (0:N-1)/fs;
f1 = 100; A1 = 1.0;
f2 = 250; A2 = 0.5;
x = A1*sin(2*pi*f1*t) + A2*sin(2*pi*f2*t);   % Δf = fs/N，两个频率都不落在整数谱线上

nfft = 8192;                                  % 补零细化网格（不提高真分辨率）
f = fs*(0:nfft/2)/nfft;

win = {'矩形窗', ones(N,1); ...
       '汉宁窗', hann(N); ...
       '汉明窗', hamming(N); ...
       '布莱克曼窗', blackman(N); ...
       '凯泽窗 b=8.6', kaiser(N, 8.6)};

figure;
for i = 1:size(win,1)
    w = win{i,2}; w = w(:);
    X = abs(fft(x(:).*w, nfft));
    X = X(1:nfft/2+1);
    amp = 2*X/sum(w);                         % 用窗的和归一化，幅度才准
    ampdb = 20*log10(amp/A1 + 1e-12);

    subplot(size(win,1),1,i);
    plot(f, ampdb); grid on; xlim([0 500]); ylim([-120 5]);
    hold on; plot([f1 f1], ylim, 'r--'); plot([f2 f2], ylim, 'g--');
    ylabel('dB'); title(win{i,1});
end
xlabel('频率 f / Hz');

%% ENBW 与相干增益
fprintf('窗函数            相干增益   ENBW(bin)\\n');
for i = 1:size(win,1)
    w = win{i,2}(:);
    enbw = N*sum(w.^2)/sum(w)^2;
    fprintf('%-16s %8.4f %9.3f\\n', win{i,1}, sum(w)/N, enbw);
end
`,
    see: 'lab/dft'
  });

  add({
    id: 'stft-spectrogram',
    cat: 'transform',
    name: 'STFT 时频图：窗长决定分辨率天平倒向哪一边',
    desc: '对应网页「⑤ STFT 时频分辨率权衡」实验台。同一段 chirp + CW 混合信号，用 64 / 256 / 1024 点汉宁窗分别做 STFT：窗短则时间分辨率好、频率糊；窗长则相反。这是海森堡不确定性在信号处理里的直接体现。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import stft

fs = 2000
T = 1.0
N = int(T * fs)
t = np.arange(N) / fs

# ===== 1. 构造信号：前 0.5 s 为 100 Hz CW，后 0.5 s 为 chirp（100->600 Hz） =====
x = np.zeros(N)
mask1 = t < 0.5
x[mask1] = np.sin(2 * np.pi * 100 * t[mask1])
t2 = t[~mask1] - 0.5
f_start, f_end = 100.0, 600.0
k = (f_end - f_start) / 0.5                       # 调频斜率 Hz/s
x[~mask1] = np.sin(2 * np.pi * (f_start * t2 + 0.5 * k * t2 ** 2))

win_lens = [64, 256, 1024]
plt.figure(figsize=(10, 8))
for i, wl in enumerate(win_lens, 1):
    noverlap = wl // 2                            # 50% 重叠：兼顾平滑与时频采样密度
    f, tt, Z = stft(x, fs=fs, window='hann', nperseg=wl,
                    noverlap=noverlap, nfft=wl)
    S = 20 * np.log10(np.abs(Z) + 1e-12)
    plt.subplot(len(win_lens), 1, i)
    # 动态范围限制在峰值下 60 dB，否则噪声底会把色标压平
    plt.pcolormesh(tt, f, S, shading='auto', vmin=S.max() - 60, vmax=S.max(), cmap='viridis')
    plt.ylabel('频率 / Hz')
    plt.title('窗长 %d 点（%.1f ms）：Δf ≈ %.1f Hz，Δt ≈ %.1f ms'
              % (wl, wl / fs * 1000, fs / wl, wl / fs * 1000))
    plt.colorbar(label='dB')
plt.xlabel('时间 / s'); plt.tight_layout(); plt.show()

print('时间-频率分辨率乘积近似守恒：Δt·Δf ≈ 1（海森堡约束）')
for wl in win_lens:
    print('  窗长 %4d：Δt = %6.1f ms，Δf = %6.1f Hz，乘积 = %.3f'
          % (wl, wl / fs * 1000, fs / wl, wl / fs * (fs / wl)))
`,
    ml: `%% MATLAB —— STFT 时频图（需要 Signal Processing Toolbox）
clear; clc; close all;

fs = 2000; T = 1; N = T*fs;
t = (0:N-1)/fs;
x = zeros(1, N);
m1 = t < 0.5;
x(m1) = sin(2*pi*100*t(m1));

t2 = t(~m1) - 0.5;
fs_ = 100; fe = 600; k = (fe - fs_)/0.5;
x(~m1) = sin(2*pi*(fs_*t2 + 0.5*k*t2.^2));

win_lens = [64 256 1024];
figure;
for i = 1:length(win_lens)
    wl = win_lens(i);
    noverlap = wl/2;
    nfft = max(256, wl);
    [s, f, tt] = spectrogram(x, hann(wl), noverlap, nfft, fs, 'yaxis');
    subplot(length(win_lens), 1, i);
    imagesc(tt, f, 20*log10(abs(s)+1e-12));
    axis xy; colormap jet; colorbar; clim([max(20*log10(abs(s)+1e-12),[],'all')-60, max(20*log10(abs(s)+1e-12),[],'all')]);
    ylabel('频率 / Hz');
    title(sprintf('窗长 %d 点：Δf ≈ %.1f Hz，Δt ≈ %.1f ms', wl, fs/wl, wl/fs*1000));
end
xlabel('时间 / s');

fprintf('时间-频率分辨率乘积近似守恒：\\n');
for wl = win_lens
    fprintf('  窗长 %4d：Δt = %6.1f ms，Δf = %6.1f Hz，乘积 = %.3f\\n', ...
            wl, wl/fs*1000, fs/wl, (wl/fs)*(fs/wl));
end
`,
    see: 'lab/stft'
  });

  add({
    id: 'hilbert-envelope-instfreq',
    cat: 'transform',
    name: '希尔伯特变换：包络、瞬时频率与解调',
    desc: '对应网页「希尔伯特变换与解析信号」一节与「工具箱·信号上传分析」的滤波后处理。示例构造 AM-FM 信号，求出解析信号后取包络与瞬时频率，并指出工程上的两个坑：端点效应与多分量信号的瞬时频率无物理意义。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import hilbert, butter, filtfilt

fs = 4000
N = 4096
t = np.arange(N) / fs

# ===== 1. 构造 AM-FM 信号：载波 600 Hz，幅度按 5 Hz 起伏，频率按三角波摆动 =====
fc = 600.0
env_true = 0.5 + 0.4 * np.cos(2 * np.pi * 5 * t)          # 包络：5 Hz 调幅
fm_true = fc + 80 * (2 * np.abs((t * 2) % 1 - 0.5) - 0.5) * 2   # 瞬时频率：三角波 ±80 Hz
phase = 2 * np.pi * np.cumsum(fm_true) / fs               # 频率积分成瞬时相位
x = env_true * np.cos(phase)

# ===== 2. 求解析信号 z = x + j·H[x]，正频分量加倍、负频置零 =====
z = hilbert(x)
env = np.abs(z)                                           # 包络 = 解析信号的模
inst_phase = np.unwrap(np.angle(z))                       # 去卷绕，否则相位跳变 ±π
inst_freq = np.diff(inst_phase) / (2 * np.pi) * fs        # 瞬时频率 = 相位导数 / 2π
inst_freq = np.append(inst_freq, inst_freq[-1])           # 补一个点保持长度一致

# ===== 3. 端点效应：希尔伯特变换用 FFT 实现，隐含周期延拓，两端必然失真 =====
trim = 200                                                # 丢弃首尾各 200 点
err_env = np.max(np.abs(env[trim:-trim] - env_true[trim:-trim]))
err_freq = np.max(np.abs(inst_freq[trim:-trim] - fm_true[trim:-trim]))
print('包络最大误差（去端点后）= %.4f' % err_env)
print('瞬时频率最大误差（去端点后）= %.2f Hz' % err_freq)

# ===== 4. 工程提示：先用带通滤掉带外噪声，再求包络，鲁棒性大不一样 =====
b, a = butter(4, [(fc - 250) / (fs / 2), (fc + 250) / (fs / 2)], btype='band')
x_f = filtfilt(b, a, x + 0.05 * np.random.default_rng(1).standard_normal(N))
env_noisy = np.abs(hilbert(x_f))

plt.figure(figsize=(9, 9))
plt.subplot(3, 1, 1)
plt.plot(t, x, lw=0.8); plt.plot(t, env, 'r', lw=1.5, label='估计包络')
plt.plot(t, env_true, 'k--', lw=1.0, label='真实包络')
plt.legend(); plt.ylabel('幅度'); plt.title('AM-FM 信号与希尔伯特包络'); plt.grid(alpha=0.3)

plt.subplot(3, 1, 2)
plt.plot(t, inst_freq, lw=1.2, label='估计瞬时频率')
plt.plot(t, fm_true, 'k--', lw=1.0, label='真实瞬时频率')
plt.legend(); plt.ylabel('Hz'); plt.title('瞬时频率'); plt.grid(alpha=0.3)

plt.subplot(3, 1, 3)
plt.plot(t, env_noisy, lw=1.0)
plt.ylabel('幅度'); plt.xlabel('时间 / s')
plt.title('带通滤波后再取包络（含噪观测，SNR 很低时仍能稳定）'); plt.grid(alpha=0.3)
plt.tight_layout(); plt.show()
`,
    ml: `%% MATLAB —— 希尔伯特变换与解析信号（需要 Signal Processing Toolbox）
clear; clc; close all;

fs = 4000; N = 4096;
t = (0:N-1)/fs;
fc = 600;
env_true = 0.5 + 0.4*cos(2*pi*5*t);                 % 5 Hz 调幅
fm_true  = fc + 160*(abs((t*2) - floor(t*2) - 0.5) - 0.25);   % 三角波调频
phase    = 2*pi*cumsum(fm_true)/fs;                 % 频率积分 -> 瞬时相位
x        = env_true .* cos(phase);

%% 解析信号
z = hilbert(x);
env = abs(z);
inst_phase = unwrap(angle(z));
inst_freq  = [diff(inst_phase) inst_phase(end)-inst_phase(end-1)]/(2*pi)*fs;

trim = 200;
fprintf('包络最大误差（去端点）= %.4f\\n', max(abs(env(trim:end-trim) - env_true(trim:end-trim))));
fprintf('瞬时频率最大误差（去端点）= %.2f Hz\\n', max(abs(inst_freq(trim:end-trim) - fm_true(trim:end-trim))));

%% 带通 + 取包络（抗噪版本）
[b, a] = butter(4, [(fc-250) (fc+250)]/(fs/2), 'band');
rng(1);
x_noisy = x + 0.05*randn(size(x));
x_f = filtfilt(b, a, x_noisy);
env_noisy = abs(hilbert(x_f));

subplot(3,1,1); plot(t, x); hold on;
plot(t, env, 'r', 'LineWidth', 1.5); plot(t, env_true, 'k--'); grid on;
legend('信号','估计包络','真实包络'); title('AM-FM 信号与希尔伯特包络');

subplot(3,1,2); plot(t, inst_freq); hold on; plot(t, fm_true, 'k--'); grid on;
legend('估计瞬时频率','真实瞬时频率'); ylabel('Hz');

subplot(3,1,3); plot(t, env_noisy); grid on;
xlabel('时间 / s'); title('带通滤波后取包络（抗噪版本）');
`,
    see: 'theory/transform/hilbert'
  });

  add({
    id: 'zplane-impulse-response',
    cat: 'transform',
    name: 'Z 变换：零极点、稳定性与冲激响应',
    desc: '对应网页「⑥ Z 平面零极点拖动」实验台：在单位圆附近放一对共轭极点得到谐振器，再在单位圆上放一对零点形成陷波器。示例完整画出零极点图、频率响应与冲激响应，并做稳定性判定。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import tf2zpk, freqz, lfilter

# ===== 1. 设计一个"谐振 + 陷波"混合系统 =====
# 一对靠近单位圆的共轭极点 -> 谐振峰（角度决定峰频率，半径决定带宽与衰减）
r_p, th_p = 0.92, 2 * np.pi * 0.2        # 归一化频率 0.2 -> 实际频率 0.2*fs
poles = [r_p * np.exp(1j * th_p), r_p * np.exp(-1j * th_p)]
# 一对落在单位圆上的共轭零点 -> 该频率处出现深陷波（衰减无穷大）
th_z = 2 * np.pi * 0.35
zeros = [np.exp(1j * th_z), np.exp(-1j * th_z)]
b = np.poly(zeros).real                  # 由零点求多项式系数（降幂）
a = np.poly(poles).real
b = b / np.sum(b)                        # 增益归一化：使谐振峰附近增益约为 1

# ===== 2. 零极点图 =====
z, p, k = tf2zpk(b, a)
fig, ax = plt.subplots(1, 3, figsize=(13, 4))
unit = np.exp(1j * np.linspace(0, 2 * np.pi, 400))
ax[0].plot(unit.real, unit.imag, 'k--', lw=0.8, label='单位圆 |z|=1')
ax[0].plot(z.real, z.imag, 'o', ms=9, mfc='none', color='C0', label='零点 o')
ax[0].plot(p.real, p.imag, 'x', ms=9, color='C3', label='极点 x')
ax[0].set_aspect('equal'); ax[0].grid(alpha=0.3); ax[0].legend()
ax[0].set_title('零极点图（极点在圆内 -> 稳定）')

# ===== 3. 频率响应 =====
w, H = freqz(b, a, worN=2048, fs=1.0)
ax[1].plot(w, 20 * np.log10(np.abs(H) + 1e-12))
ax[1].set_xlabel('归一化频率 (×fs)'); ax[1].set_ylabel('幅度 / dB')
ax[1].set_title('幅频响应：0.2 处谐振峰，0.35 处深陷波'); ax[1].grid(alpha=0.3)

# ===== 4. 冲激响应（对 δ 输入做递推） =====
n = np.arange(120)
imp = np.zeros(120); imp[0] = 1.0
h = lfilter(b, a, imp)
ax[2].stem(n, h, linefmt='C2-', markerfmt='C2o', basefmt=' ')
ax[2].set_xlabel('n'); ax[2].set_ylabel('h[n]')
ax[2].set_title('冲激响应：极点半径 0.92 -> 缓慢衰减振荡'); ax[2].grid(alpha=0.3)
plt.tight_layout(); plt.show()

# ===== 5. 稳定性判定：所有极点的模必须严格小于 1 =====
print('极点模：', np.round(np.abs(p), 4))
print('系统是否稳定：', bool(np.all(np.abs(p) < 1.0)))
print('陷波深度受极点半径控制：半径越接近 1，带宽越窄，暂态越长。')
`,
    ml: `%% MATLAB —— Z 变换零极点与冲激响应（需要 Signal Processing Toolbox）
clear; clc; close all;

%% 1) 由零极点直接构造二阶节：谐振器 + 陷波器
rp = 0.92; thp = 2*pi*0.2;      % 极点：靠近单位圆 -> 尖锐谐振
thz = 2*pi*0.35;                % 零点：落在单位圆上 -> 完美陷波
poles = [rp*exp(1j*thp), rp*exp(-1j*thp)]';
zeros = [exp(1j*thz), exp(-1j*thz)]';
b = real(poly(zeros));
a = real(poly(poles));
b = b/sum(b)*0.05;              % 增益调整，使通带增益量级合理

%% 2) 零极点图
figure; subplot(1,3,1); zplane(zeros, poles); title('零极点图');

%% 3) 频率响应
[H, w] = freqz(b, a, 2048);
subplot(1,3,2); plot(w/(2*pi), 20*log10(abs(H)+1e-12)); grid on;
xlabel('归一化频率'); ylabel('幅度 / dB'); title('幅频响应');

%% 4) 冲激响应
imp = zeros(120,1); imp(1) = 1;
h = filter(b, a, imp);
subplot(1,3,3); stem(0:119, h); grid on;
xlabel('n'); ylabel('h[n]'); title('冲激响应');

%% 5) 稳定性
fprintf('极点模 = %s\\n', mat2str(abs(poles)', 4));
fprintf('系统是否稳定（极点全部在单位圆内）：%d\\n', all(abs(poles) < 1));
`,
    see: 'lab/zplane'
  });

  add({
    id: 'frft-order-search',
    cat: 'transform',
    name: '分数阶傅里叶变换：chirp 信号的最佳阶次搜索',
    desc: '对应网页「分数阶傅里叶变换」一节。FRFT 是时频平面旋转 α 角度的广义傅里叶变换；对 LFM（chirp）信号存在一个最优旋转角使能量最集中。本例用数值积分实现 FRFT，先以高斯函数自反演性质校验实现正确性，再对 chirp 做阶次扫描。',
    py: `import numpy as np
import matplotlib.pyplot as plt

# ===== 1. 数值积分型 FRFT 定义 =====
# f_a(u) = A * ∫ x(t) exp[jπ(t²+u²)cotφ - j2πut·cscφ] dt ，  φ = a·π/2
# a = 1 时 A = 1、cotφ = 0、cscφ = 1，核退化为 exp(-j2πut)，即标准傅里叶变换
def frft(x, t, u, a):
    phi = a * np.pi / 2
    sn = np.sin(phi)
    if abs(sn) < 1e-6:                       # 整数阶（a 为偶数）时核退化，单独处理
        if abs(np.cos(phi) - 1) < 1e-6: return x.copy()
        return x[::-1].copy()
    cot = np.cos(phi) / sn                   # cot φ
    csc = 1.0 / sn                           # csc φ
    A = np.exp(-1j * np.pi * np.sign(sn) / 4 + 1j * phi / 2) / np.sqrt(abs(sn))
    # 核矩阵 K[m, n] = A·exp[jπ(u_m²+t_n²)cotφ]·exp(-j2π u_m t_n cscφ)
    K = A * np.exp(1j * np.pi * cot * (u[:, None] ** 2 + t[None, :] ** 2))
    K = K * np.exp(-1j * 2 * np.pi * csc * np.outer(u, t))
    return K.dot(x) * (t[1] - t[0])          # 乘步长把求和变成积分

# ===== 2. 网格：[-4, 4] 对称区间，512 点，步长足够小以满足相位采样要求 =====
Np = 512
L = 4.0
u = t = np.linspace(-L, L, Np)

# ===== 3. 正确性校验：高斯函数 exp(-πt²) 是 FRFT 的本征函数（任意阶都自反演） =====
g = np.exp(-np.pi * t ** 2)
for a in [0.3, 0.7, 1.0, 1.3]:
    G = frft(g, t, u, a)
    err = np.max(np.abs(np.abs(G) - np.abs(g)))
    print('a = %.1f：高斯自反演误差 max||F_a[g]| - |g|| = %.2e' % (a, err))

# ===== 4. chirp 信号：x(t) = exp(jπ μ t²)，理论最优旋转角满足 cotφ = -μ =====
mu = 1.2                                     # 调频率（Hz/s 意义下的归一化 chirp 率）
x = np.exp(1j * np.pi * mu * t ** 2) * np.exp(-np.pi * (t / 3.0) ** 2)   # 加 taper 抑制边缘

a_grid = np.linspace(0.4, 1.6, 241)          # 阶次扫描范围
peak = np.array([np.max(np.abs(frft(x, t, u, a))) for a in a_grid])
a_opt = a_grid[np.argmax(peak)]

phi_th = np.arctan(-1.0 / mu)                # 理论最优角（主值）
a_th = 2 * phi_th / np.pi                    # 换算成阶次，注意 +2 的周期等价
while a_th < 0.4: a_th += 2.0                # FRFT 以 4 为周期，取落在扫描区内的等价解
print('搜索得到最优阶次 a = %.3f；理论值 = %.3f' % (a_opt, a_th))

plt.figure(figsize=(9, 5))
plt.subplot(1, 2, 1)
plt.plot(a_grid, peak / peak.max(), lw=1.2)
plt.axvline(a_opt, color='r', ls='--', label='峰值阶次 %.3f' % a_opt)
plt.xlabel('FRFT 阶次 a'); plt.ylabel('归一化峰值幅度'); plt.legend(); plt.grid(alpha=0.3)
plt.title('chirp 的 FRFT 阶次谱')

plt.subplot(1, 2, 2)
X_opt = np.abs(frft(x, t, u, a_opt))
X_fft = np.abs(frft(x, t, u, 1.0))
plt.plot(u, 20 * np.log10(X_fft / X_fft.max() + 1e-12), label='a = 1（普通 FFT）')
plt.plot(u, 20 * np.log10(X_opt / X_opt.max() + 1e-12), label='a = %.2f（最优阶）' % a_opt)
plt.ylim(-60, 5); plt.legend(); plt.grid(alpha=0.3)
plt.xlabel('u'); plt.ylabel('dB'); plt.title('最优阶次上的能量聚集')
plt.tight_layout(); plt.show()
`,
    ml: `%% MATLAB —— FRFT 阶次搜索（基础版即可，无需工具箱）
clear; clc; close all;

%% 1) 数值积分型 FRFT
% 说明：MATLAB 无内置 frft，此处用矩阵核实现，便于理解原理
Np = 512; L = 4;
t = linspace(-L, L, Np); u = t;
dt = t(2) - t(1);

% 2) 正确性校验：高斯函数是 FRFT 本征函数，任意阶都应自反演
g = exp(-pi*t.^2);
for a = [0.3 0.7 1.0 1.3]
    G = frft_matrix(g(:), t, u, a);
    fprintf('a = %.1f：高斯自反演误差 = %.2e\\n', a, max(abs(abs(G.') - abs(g))));
end

%% 3) chirp 信号与阶次扫描
mu = 1.2;
x = (exp(1j*pi*mu*t.^2) .* exp(-pi*(t/3).^2)).';

a_grid = linspace(0.4, 1.6, 121);
peak = zeros(size(a_grid));
for i = 1:length(a_grid)
    X = frft_matrix(x, t, u, a_grid(i));
    peak(i) = max(abs(X));
end
[~, idx] = max(peak); a_opt = a_grid(idx);

phi_th = atan(-1/mu); a_th = 2*phi_th/pi;
while a_th < a_grid(1), a_th = a_th + 2; end
fprintf('搜索得到最优阶次 a = %.3f；理论值 = %.3f\\n', a_opt, a_th);

subplot(1,2,1); plot(a_grid, peak/max(peak)); grid on; hold on;
plot([a_opt a_opt], ylim, 'r--');
xlabel('FRFT 阶次 a'); ylabel('归一化峰值'); title('chirp 的 FRFT 阶次谱');

subplot(1,2,2);
X1 = abs(frft_matrix(x, t, u, 1.0));
Xo = abs(frft_matrix(x, t, u, a_opt));
plot(u, 20*log10(X1/max(X1)+1e-12)); hold on; plot(u, 20*log10(Xo/max(Xo)+1e-12)); grid on;
ylim([-60 5]); legend('a = 1（普通 FFT）', sprintf('a = %.2f（最优阶）', a_opt));
xlabel('u'); ylabel('dB'); title('最优阶次上的能量聚集');

%% 子函数：矩阵核实现的 FRFT
function X = frft_matrix(x, t, u, a)
    phi = a*pi/2; sn = sin(phi);
    if abs(sn) < 1e-6
        X = x; return;
    end
    cotv = cos(phi)/sn; cscv = 1/sn;
    A = exp(-1j*pi*sign(sn)/4 + 1j*phi/2)/sqrt(abs(sn));
    K = A*exp(1j*pi*cotv*((u(:).^2) + (t(:).^2)')) .* exp(-1j*2*pi*cscv*(u(:)*t(:)'));
    X = K*x*(t(2)-t(1));
end
`,
    see: 'theory/transform/frft'
  });

  /* ==================================================================
     三、滤波（FIR 窗函数法 / IIR 双线性 / 卷积 / 零相位）
     ================================================================== */

  add({
    id: 'fir-window-design',
    cat: 'filter',
    name: 'FIR 窗函数法设计：幅频、相频与群延迟',
    desc: '对应网页「窗函数法设计 FIR」一节与「⑧ FIR 滤波器设计」实验台。示例用同一 64 阶低通，比较汉明/布莱克曼/凯泽三种窗的过渡带与阻带衰减，并画出线性相位 FIR 特有的恒定群延迟。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import firwin, freqz

fs = 2000
order = 64                     # FIR 阶数（抽头数 = order + 1）
fc = 300.0                     # 截止频率 Hz
fc_norm = fc / (fs / 2)        # scipy 的归一化：1 对应 Nyquist

wins = ['hamming', 'blackman', ('kaiser', 8.6)]
labels = ['汉明窗', '布莱克曼窗', '凯泽窗 beta=8.6']
colors = ['C0', 'C1', 'C2']

plt.figure(figsize=(10, 8))
for lab, w, c in zip(labels, wins, colors):
    # 注意：一旦给了 fs 参数，firwin 的截止频率单位就是 Hz（不要再预先归一化）
    h = firwin(order + 1, fc, window=w, fs=fs)
    w_ax, H = freqz(h, worN=2048, fs=fs)
    mag = 20 * np.log10(np.abs(H) + 1e-12)
    ph = np.unwrap(np.angle(H))
    # 群延迟 = -dφ/dω；线性相位 FIR 在通带内应恒等于 order/2 个样点
    dw = 2 * np.pi * (w_ax[1] - w_ax[0]) / fs
    gd = -np.diff(ph) / dw / fs * fs            # 单位：样点
    gd = np.append(gd, gd[-1])

    plt.subplot(3, 1, 1)
    plt.plot(w_ax, mag, color=c, label=lab)
    plt.subplot(3, 1, 2)
    plt.plot(w_ax, ph, color=c, label=lab)
    plt.subplot(3, 1, 3)
    plt.plot(w_ax, gd, color=c, label=lab)

    # 定量：通带波纹与阻带衰减
    pb = w_ax <= fc * 0.9
    sb = w_ax >= fc * 1.3
    print('%s：通带起伏 %.2f dB，阻带最高 %.1f dB' % (lab, mag[pb].max() - mag[pb].min(), mag[sb].max()))

plt.subplot(3, 1, 1); plt.axvline(fc, color='k', ls='--', lw=0.8)
plt.ylabel('幅度 / dB'); plt.ylim(-120, 5); plt.legend(); plt.grid(alpha=0.3)
plt.title('64 阶 FIR 低通：三种窗的对比（fc = 300 Hz，fs = 2 kHz）')
plt.subplot(3, 1, 2); plt.ylabel('相位 / rad'); plt.legend(); plt.grid(alpha=0.3)
plt.subplot(3, 1, 3); plt.axhline(order / 2, color='k', ls=':', lw=0.8)
plt.xlabel('频率 / Hz'); plt.ylabel('群延迟 / 样点'); plt.legend(); plt.grid(alpha=0.3)
plt.tight_layout(); plt.show()

# ===== 工程要点：窗函数法不需要"设计截止频率"的迭代，但过渡带宽度由阶数与窗决定 =====
print('阶数 %d 时，过渡带近似宽度 ≈ %.1f Hz（汉明窗 Δω ≈ 3.3·2π/阶数 的对应值）'
      % (order, 3.3 * fs / (order + 1)))
`,
    ml: `%% MATLAB —— FIR 窗函数法设计（需要 Signal Processing Toolbox）
clear; clc; close all;

fs = 2000; order = 64; fc = 300;
wins = {'汉明窗', 'hamming'; '布莱克曼窗', 'blackman'; '凯泽窗', 'kaiser'};

figure;
for i = 1:size(wins,1)
    switch wins{i,1}
        case '汉明窗'
            win = hamming(order+1); h = fir1(order, fc/(fs/2), 'low', win);
        case '布莱克曼窗'
            win = blackman(order+1); h = fir1(order, fc/(fs/2), 'low', win);
        otherwise
            win = kaiser(order+1, 8.6); h = fir1(order, fc/(fs/2), 'low', win);
    end

    [H, wa] = freqz(h, 1, 2048, fs);
    mag = 20*log10(abs(H)+1e-12);
    ph  = unwrap(angle(H));
    gd  = -diff(ph)/(2*pi*(wa(2)-wa(1))/fs)/fs; gd(end+1) = gd(end);

    pb = wa <= fc*0.9; sb = wa >= fc*1.3;
    fprintf('%s：通带起伏 %.2f dB，阻带最高 %.1f dB\\n', ...
        wins{i,1}, max(mag(pb))-min(mag(pb)), max(mag(sb)));

    subplot(3,1,1); plot(wa, mag); hold on; grid on;
    subplot(3,1,2); plot(wa, ph); hold on; grid on;
    subplot(3,1,3); plot(wa, gd); hold on; grid on;
end
subplot(3,1,1); xline(fc, 'k--'); ylim([-120 5]); ylabel('幅度 / dB');
legend(wins(:,1)); title('64 阶 FIR 低通：三种窗对比');
subplot(3,1,2); ylabel('相位 / rad'); legend(wins(:,1));
subplot(3,1,3); yline(order/2, 'k:'); xlabel('频率 / Hz'); ylabel('群延迟 / 样点');
legend(wins(:,1));
`,
    see: 'lab/fir'
  });

  add({
    id: 'iir-bilinear-prewarp',
    cat: 'filter',
    name: 'IIR 双线性变换设计：为什么必须预畸变',
    desc: '对应网页「双线性变换法」一节。示例手工走完"预畸变 → 巴特沃斯阶数 → 模拟极点 → 双线性映射"四步，并与 scipy.signal.butter 的结果逐项比对，量化"不做预畸变"时截止频率会偏多少。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import butter, buttord, freqz, bilinear, tf2zpk

fsamp = 8000
fp, fst = 1000.0, 1500.0        # 通带边界 / 阻带边界 Hz
Ap, As = 1.0, 40.0              # 通带最大衰减 / 阻带最小衰减 dB

# ===== 1. 预畸变：把数字频率 ω 映射成模拟角频率 Ω = 2fs·tan(ω/2) =====
# 双线性把 s 平面的整个虚轴压缩到 z 平面单位圆的一圈，若不预畸变，
# 数字截止频率会被"拉向"高频方向，fc 越高偏差越大。
wp = 2 * fsamp * np.tan(np.pi * fp / fsamp)
wst = 2 * fsamp * np.tan(np.pi * fst / fsamp)

# ===== 2. 巴特沃斯最低阶数 =====
N = int(np.ceil(np.log10((10 ** (0.1 * As) - 1) / (10 ** (0.1 * Ap) - 1))
                / (2 * np.log10(wst / wp))))
print('所需阶数 N =', N)

# ===== 3. 模拟原型极点（左半平面，均匀分布在半径 wc 的圆弧上） =====
wc = wp / (10 ** (0.1 * Ap) - 1) ** (1 / (2 * N))
k_ang = np.arange(N)
poles = wc * np.exp(1j * (np.pi / 2 + (2 * k_ang + 1) * np.pi / (2 * N)))
a_s = np.poly(poles).real           # 模拟分母多项式
b_s = np.array([wc ** N])           # 巴特沃斯分子是常数

# ===== 4. 双线性映射到数字域 =====
bd, ad = bilinear(b_s, a_s, fs=fsamp)
w1, H1 = freqz(bd, ad, worN=2048, fs=fsamp)

# ===== 5. 与 scipy 一行版本对比（buttord 同样做预畸变，并把截止点取在 -Ap dB 处） =====
N2, Wn = buttord(fp, fst, Ap, As, fs=fsamp)
b2, a2 = butter(N2, Wn, btype='low', fs=fsamp)
w2, H2 = freqz(b2, a2, worN=2048, fs=fsamp)
print('手工设计阶数 N = %d，scipy.buttord 阶数 = %d' % (N, N2))
print('与 scipy.signal.butter 的最大幅度偏差 = %.2e dB'
      % np.max(np.abs(20 * np.log10(np.abs(H1) + 1e-12) - 20 * np.log10(np.abs(H2) + 1e-12))))

# ===== 6. 不做预畸变会怎样：模拟截止频率直接用线性映射值 Ω = 2πf =====
wc_naive = 2 * np.pi * fp
poles_n = wc_naive * np.exp(1j * (np.pi / 2 + (2 * k_ang + 1) * np.pi / (2 * N)))
bd_n, ad_n = bilinear(np.array([wc_naive ** N]), np.poly(poles_n).real, fs=fsamp)
w3, H3 = freqz(bd_n, ad_n, worN=2048, fs=fsamp)

# 找出各条曲线实际的 -Ap dB 点与 -3 dB 点
def fcross(w, H, att):
    m = 20 * np.log10(np.abs(H) + 1e-12)
    i = np.argmax(m < m[0] - att)
    return w[i]

print('预畸变后 -Ap(%.0f dB) 点 = %.0f Hz（目标 %.0f Hz，吻合）' % (Ap, fcross(w1, H1, Ap), fp))
print('预畸变后 -3 dB 点 = %.0f Hz（通带内有 %.0f dB 衰减是正常的）' % (fcross(w1, H1, 3.0), Ap))
print('未预畸变 -Ap 点 = %.0f Hz（相对目标偏移 %.0f Hz）'
      % (fcross(w3, H3, Ap), fcross(w3, H3, Ap) - fp))

plt.figure(figsize=(9, 5))
plt.plot(w1, 20 * np.log10(np.abs(H1) + 1e-12), label='手工 + 预畸变')
plt.plot(w2, 20 * np.log10(np.abs(H2) + 1e-12), 'k--', lw=0.8, label='scipy.butter')
plt.plot(w3, 20 * np.log10(np.abs(H3) + 1e-12), 'r', alpha=0.7, label='未预畸变（截止偏移）')
plt.axvline(fp, color='g', ls=':', label='目标 fc')
plt.ylim(-80, 5); plt.xlabel('频率 / Hz'); plt.ylabel('幅度 / dB')
plt.legend(); plt.grid(alpha=0.3)
plt.title('N = %d 巴特沃斯低通：预畸变的作用' % N)
plt.tight_layout(); plt.show()

# ===== 7. 稳定性检查 =====
z, p, k = tf2zpk(bd, ad)
print('极点最大模 = %.4f（<1 才稳定）' % np.abs(p).max())
`,
    ml: `%% MATLAB —— IIR 双线性变换设计（需要 Signal Processing Toolbox）
clear; clc; close all;

fsamp = 8000; fp = 1000; fst = 1500; Ap = 1; As = 40;

%% 1) 预畸变 + 阶数估计（MATLAB 的 buttord 已自动完成）
[N, Wn] = buttord(fp/(fsamp/2), fst/(fsamp/2), Ap, As);
[b, a]  = butter(N, Wn, 'low');
fprintf('所需阶数 N = %d，3 dB 截止 = %.1f Hz\\n', N, Wn*fsamp/2);

%% 2) 手工复现：预畸变 -> 模拟极点 -> bilinear
wp  = 2*fsamp*tan(pi*fp/fsamp);      % 预畸变后的模拟通带边界
wst = 2*fsamp*tan(pi*fst/fsamp);
N2  = ceil(log10((10^(0.1*As)-1)/(10^(0.1*Ap)-1)) / (2*log10(wst/wp)));
wc  = wp/(10^(0.1*Ap)-1)^(1/(2*N2));
k   = 0:N2-1;
poles = wc*exp(1j*(pi/2 + (2*k+1)*pi/(2*N2)));   % 左半平面极点
a_s = real(poly(poles)); b_s = wc^N2;
[bd, ad] = bilinear(b_s, a_s, fsamp);

[H1, w1] = freqz(bd, ad, 2048, fsamp);
[H2, w2] = freqz(b, a, 2048, fsamp);
fprintf('手工设计与 butter 的最大偏差 = %.2e dB\\n', ...
        max(abs(20*log10(abs(H1)+1e-12) - 20*log10(abs(H2)+1e-12))));

%% 3) 不做预畸变的后果
wc_n = 2*pi*fp;                                  % 错误：直接用线性映射的频率
poles_n = wc_n*exp(1j*(pi/2 + (2*k+1)*pi/(2*N2)));
[bd_n, ad_n] = bilinear(wc_n^N2, real(poly(poles_n)), fsamp);
[H3, w3] = freqz(bd_n, ad_n, 2048, fsamp);

semilogx(w1, 20*log10(abs(H1)+1e-12)); hold on;
semilogx(w2, 20*log10(abs(H2)+1e-12), 'k--');
semilogx(w3, 20*log10(abs(H3)+1e-12), 'r');
xline(fp, 'g:'); grid on; ylim([-80 5]);
legend('手工 + 预畸变', 'butter', '未预畸变（截止偏移）');
xlabel('频率 / Hz'); ylabel('幅度 / dB'); title('双线性变换中的预畸变');

fprintf('极点最大模 = %.4f（<1 才稳定）\\n', max(abs(roots(ad))));
`,
    see: 'lab/fir'
  });

  add({
    id: 'linear-vs-circular-conv',
    cat: 'filter',
    name: '线性卷积 vs 循环卷积：什么时候可以用 FFT 加速',
    desc: '对应网页「⑦ 线性卷积 vs 循环卷积」实验台。同一组 x、h，改变循环卷积长度 N：N ≥ L+M−1 时两者完全一致，N 更小时发生"圆周混叠"（尾部折回头部）。示例用误差曲线把结论量化，并给出重叠相加（overlap-add）的正确做法。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import fftconvolve

L, M = 40, 25                                  # x 长 L，h 长 M
x = np.random.default_rng(7).standard_normal(L)
h = np.hanning(M)                              # 用平滑窗做 h，混叠时看得更清楚

y_lin = np.convolve(x, h)                      # 线性卷积：长度 L+M-1 = 64
N_full = L + M - 1

errs, Ns = [], []
for N in range(max(L, M), N_full + 12):
    # 循环卷积 = IDFT(DFT(x_N) · DFT(h_N))，先把两个序列补零/截断到 N 点
    xp = np.zeros(N); xp[:min(N, L)] = x[:min(N, L)]
    hp = np.zeros(N); hp[:min(N, M)] = h[:min(N, M)]
    y_cyc = np.fft.ifft(np.fft.fft(xp) * np.fft.fft(hp)).real
    ref = np.zeros(max(N, len(y_lin))); ref[:len(y_lin)] = y_lin   # 参考：线性卷积补零
    y_ext = np.zeros(max(N, len(y_lin))); y_ext[:N] = y_cyc
    errs.append(np.max(np.abs(y_ext - ref)))
    Ns.append(N)

plt.figure(figsize=(9, 6))
plt.subplot(2, 1, 1)
plt.stem(np.arange(len(y_lin)), y_lin, linefmt='C0-', markerfmt='C0o', basefmt=' ')
plt.title('线性卷积结果（长度 %d = L+M-1）' % len(y_lin))
plt.xlabel('n'); plt.ylabel('y[n]'); plt.grid(alpha=0.3)

plt.subplot(2, 1, 2)
plt.plot(Ns, 20 * np.log10(np.array(errs) + 1e-16), lw=1.2)
plt.axvline(N_full, color='r', ls='--', label='L+M-1 = %d' % N_full)
plt.xlabel('循环卷积长度 N'); plt.ylabel('与线性卷积的误差 / dB')
plt.title('N ≥ L+M-1 时误差降到数值噪声（-300 dB 量级）')
plt.legend(); plt.grid(alpha=0.3)
plt.tight_layout(); plt.show()

# ===== 用短循环卷积做长序列滤波：重叠相加法 =====
x_long = np.random.default_rng(11).standard_normal(1000)
y_oa = fftconvolve(x_long, h)                  # scipy 内部就是 overlap-add
y_ref = np.convolve(x_long, h)
print('overlap-add 与直接线性卷积的最大偏差 = %.2e' % np.max(np.abs(y_oa - y_ref)))
print('结论：块长取 2 的幂（如 256/512）时 FFT 卷积最快；块太小时 FFT 开销反而占主导。')
`,
    ml: `%% MATLAB —— 线性卷积 vs 循环卷积（基础版即可）
clear; clc; close all;

L = 40; M = 25;
rng(7); x = randn(1, L);
h = hann(M)';

y_lin = conv(x, h);              % 线性卷积
N_full = L + M - 1;

Ns = max(L,M):N_full+11;
errs = zeros(size(Ns));
for i = 1:length(Ns)
    N = Ns(i);
    xp = zeros(1,N); xp(1:min(N,L)) = x(1:min(N,L));
    hp = zeros(1,N); hp(1:min(N,M)) = h(1:min(N,M));
    y_cyc = ifft(fft(xp).*fft(hp));
    ref = zeros(1,N); ref(1:length(y_lin)) = y_lin;
    errs(i) = max(abs(y_cyc - ref));
end

subplot(2,1,1); stem(0:length(y_lin)-1, y_lin); grid on;
xlabel('n'); ylabel('y[n]'); title(sprintf('线性卷积结果（长度 %d = L+M-1）', N_full));

subplot(2,1,2); plot(Ns, 20*log10(errs+1e-16)); hold on;
xline(N_full, 'r--'); grid on;
xlabel('循环卷积长度 N'); ylabel('与线性卷积的误差 / dB');
legend('误差曲线', sprintf('L+M-1 = %d', N_full));

%% 长序列的快速卷积验证
x_long = randn(1, 1000);
y_ref = conv(x_long, h);
% MATLAB 无内置 fftfilt 时可用 Signal Processing Toolbox 的 fftfilt
fprintf('fftfilt 与 conv 的最大偏差 = %.2e\\n', max(abs(fftfilt(h, x_long) - y_ref)));
`,
    see: 'lab/conv'
  });

  add({
    id: 'filtfilt-zerophase',
    cat: 'filter',
    name: '零相位滤波 filtfilt：消除相位失真的代价',
    desc: '对应网页「工具箱·信号上传分析」中滤波对比所用的算法。示例对比 lfilter / filtfilt：前者有 (N−1)/2 个样点的群延迟且 chirp 波形畸变，后者完全无延迟但幅频响应被平方（阻带衰减翻倍），且必须离线使用。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import butter, lfilter, filtfilt, freqz

fs = 2000
N = 2000
t = np.arange(N) / fs

#  chirp 信号：频率线性上升，最容易暴露群延迟失真
f0, f1 = 20.0, 400.0
k = (f1 - f0) / (N / fs)
x = np.sin(2 * np.pi * (f0 * t + 0.5 * k * t * t))
x += 0.05 * np.random.default_rng(3).standard_normal(N)

b, a = butter(4, 300 / (fs / 2), btype='low')     # 4 阶巴特沃斯低通

y_causal = lfilter(b, a, x)                       # 因果滤波：有群延迟
y_zero = filtfilt(b, a, x)                        # 前后各滤一次：相位抵消
y_zero2 = filtfilt(b, a, filtfilt(b, a, x))       # 再做一次：幅频被平方到 4 次方

# 幅频响应：filtfilt 相当于 |H|²，因此截止特性更陡、阻带衰减翻倍
w, H = freqz(b, a, worN=1024, fs=fs)
plt.figure(figsize=(9, 7))

plt.subplot(3, 1, 1)
plt.plot(t * 1000, x, color='#bbbbbb', lw=0.8, label='输入')
plt.plot(t * 1000, y_causal, 'C0', lw=1.0, label='lfilter（有延迟）')
plt.plot(t * 1000, y_zero, 'C1', lw=1.0, label='filtfilt（零相位）')
plt.legend(); plt.ylabel('幅度'); plt.grid(alpha=0.3)
plt.title('零相位滤波：波形整体对齐，不再被群延迟拖后')

plt.subplot(3, 1, 2)
plt.plot(t[600:900] * 1000, x[600:900], color='#bbbbbb', lw=0.8)
plt.plot(t[600:900] * 1000, y_causal[600:900], 'C0')
plt.plot(t[600:900] * 1000, y_zero[600:900], 'C1')
plt.title('放大看：lfilter 的输出明显右移（群延迟），filtfilt 与输入对齐')
plt.ylabel('幅度'); plt.grid(alpha=0.3)

plt.subplot(3, 1, 3)
plt.plot(w, 20 * np.log10(np.abs(H) + 1e-12), label='单次 |H|')
plt.plot(w, 40 * np.log10(np.abs(H) + 1e-12), label='filtfilt：|H|²')
plt.xlabel('频率 / Hz'); plt.ylabel('dB'); plt.legend(); plt.grid(alpha=0.3)
plt.title('代价：幅度响应被平方，通带波纹也翻倍')
plt.tight_layout(); plt.show()

print('群延迟参考：4 阶巴特沃斯的 (N-1)/2 ≈ 2 个样点 @ 低频，实际随频率变化。')
print('注意：filtfilt 需要知道整段数据，实时系统（雷达/声呐在线处理）只能用 lfilter。')
`,
    ml: `%% MATLAB —— 零相位滤波 filtfilt（需要 Signal Processing Toolbox）
clear; clc; close all;

fs = 2000; N = 2000;
t = (0:N-1)/fs;
f0 = 20; f1 = 400; k = (f1-f0)/(N/fs);
rng(3);
x = sin(2*pi*(f0*t + 0.5*k*t.^2)) + 0.05*randn(1, N);

[b, a] = butter(4, 300/(fs/2), 'low');
y_causal = filter(b, a, x);
y_zero   = filtfilt(b, a, x);

[H, w] = freqz(b, a, 1024, fs);

subplot(3,1,1); plot(t*1000, x, 'Color', [0.75 0.75 0.75]); hold on;
plot(t*1000, y_causal); plot(t*1000, y_zero); grid on;
legend('输入','lfilter（有延迟）','filtfilt（零相位）'); ylabel('幅度');

subplot(3,1,2); idx = 600:900;
plot(t(idx)*1000, x(idx), 'Color', [0.75 0.75 0.75]); hold on;
plot(t(idx)*1000, y_causal(idx)); plot(t(idx)*1000, y_zero(idx)); grid on;
title('放大：lfilter 输出右移，filtfilt 对齐'); ylabel('幅度');

subplot(3,1,3);
plot(w, 20*log10(abs(H)+1e-12)); hold on; plot(w, 40*log10(abs(H)+1e-12)); grid on;
legend('单次 |H|', 'filtfilt：|H|^2'); xlabel('频率 / Hz'); ylabel('dB');

fprintf('提示：实时处理只能用 filter；filtfilt 仅用于离线分析。\\n');
`,
    see: 'toolbox/upload'
  });

  /* ==================================================================
     四、谱估计（周期图 / 参数模型 / 子空间）
     ================================================================== */

  add({
    id: 'periodogram-vs-welch',
    cat: 'spectrum',
    name: '周期图 vs Bartlett vs Welch：方差与分辨率的交换',
    desc: '对应网页「经典谱估计」一节与「④ 对比实验·谱估计对比」卡片。数据长度 1024、两个相隔 1.5 个瑞利限的频率、SNR = 0 dB：周期图分辨率最高但起伏剧烈，Welch 平滑但会把双峰糊成一个。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import welch, periodogram

rng = np.random.default_rng(42)
fs = 1000
N = 1024
n = np.arange(N)

# 两个靠近的频率：瑞利限 Δf = fs/N ≈ 0.977 Hz，这里给 1.5 倍间距以看清差异
f1, f2 = 200.0, 201.5
snr_db = 0.0
s = np.sin(2 * np.pi * f1 * n / fs) + np.sin(2 * np.pi * f2 * n / fs)
Ps_sig = np.mean(s ** 2)
x = s + np.sqrt(Ps_sig / (10 ** (snr_db / 10))) * rng.standard_normal(N)
print('Δf = %.3f Hz，瑞利限 fs/N = %.3f Hz，归一化间距 = %.2f bin'
      % (f2 - f1, fs / N, (f2 - f1) * N / fs))

# ===== 1. 周期图（矩形窗，无平均）：方差约为均值的平方，不会随 N 收敛 =====
f_p, P_p = periodogram(x, fs=fs, window='boxcar', nfft=4096)
# ===== 2. Bartlett：K 段不重叠、矩形窗，方差降到 1/K，代价是分辨率降到 1/(N/K) =====
K = 8
seg = N // K
acc = np.zeros(seg // 2 + 1)
for k in range(K):
    _, pk = periodogram(x[k * seg:(k + 1) * seg], fs=fs, window='boxcar', nfft=seg)
    acc += pk
P_b = acc / K
f_b = np.fft.rfftfreq(seg, 1 / fs)
# ===== 3. Welch：50% 重叠 + 汉宁窗，段数更多，方差再降，但每段更短 =====
f_w, P_w = welch(x, fs=fs, window='hann', nperseg=256, noverlap=128, nfft=4096)

plt.figure(figsize=(9, 7))
for ax, (f_, P_, name) in enumerate([(f_p, P_p, '周期图'), (f_b, P_b, 'Bartlett K=8'), (f_w, P_w, 'Welch 256/50%')]):
    plt.subplot(3, 1, ax + 1)
    plt.plot(f_, 10 * np.log10(P_ + 1e-20), lw=1.0)
    plt.xlim(190, 215); plt.grid(alpha=0.3)
    plt.title(name)
    plt.ylabel('dB/Hz')
plt.xlabel('频率 / Hz'); plt.tight_layout(); plt.show()

# ===== 4. 定量：噪声区的方差（越平整越稳定）与双峰可见性 =====
band = (f_p > 400) & (f_p < 450)
for f_, P_, name in [(f_p, P_p, '周期图'), (f_b, P_b, 'Bartlett'), (f_w, P_w, 'Welch')]:
    b = (f_ > 400) & (f_ < 450)
    ratio = np.std(10 * np.log10(P_[b] + 1e-20))
    print('%s：噪声区谱起伏标准差 = %.2f dB' % (name, ratio))
print('结论：周期图起伏约 5.6 dB（不随 N 下降）；Welch 通过牺牲频率分辨率换取方差下降。')
`,
    ml: `%% MATLAB —— 周期图 / Bartlett / Welch 对比（需要 Signal Processing Toolbox）
clear; clc; close all;

rng(42);
fs = 1000; N = 1024; n = 0:N-1;
f1 = 200; f2 = 201.5; snr_db = 0;
s = sin(2*pi*f1*n/fs) + sin(2*pi*f2*n/fs);
Ps = mean(s.^2);
x = s + sqrt(Ps/(10^(snr_db/10)))*randn(1, N);
fprintf('Δf = %.3f Hz，瑞利限 fs/N = %.3f Hz\\n', f2-f1, fs/N);

%% 1) 周期图
[Pp, fp] = periodogram(x, rectwin(N), 4096, fs);
%% 2) Bartlett：分为 8 段，逐段周期图后平均
K = 8; seg = floor(N/K); acc = 0;
for k = 0:K-1
    [pk, fk] = periodogram(x(k*seg+1:(k+1)*seg), rectwin(seg), seg, fs);
    acc = acc + pk;
end
Pb = acc/K; fb = fk;
%% 3) Welch
[Pw, fw] = pwelch(x, hann(256), 128, 4096, fs);

subplot(3,1,1); plot(fp, 10*log10(Pp+1e-20)); grid on; xlim([190 215]);
title('周期图'); ylabel('dB/Hz');
subplot(3,1,2); plot(fb, 10*log10(Pb+1e-20)); grid on; xlim([190 215]);
title('Bartlett K=8'); ylabel('dB/Hz');
subplot(3,1,3); plot(fw, 10*log10(Pw+1e-20)); grid on; xlim([190 215]);
title('Welch 256/50%'); ylabel('dB/Hz'); xlabel('频率 / Hz');

%% 定量：噪声区起伏
b1 = fp > 400 & fp < 450; b3 = fw > 400 & fw < 450;
fprintf('周期图：噪声区起伏 std = %.2f dB\\n', std(10*log10(Pp(b1)+1e-20)));
fprintf('Welch ：噪声区起伏 std = %.2f dB\\n', std(10*log10(Pw(b3)+1e-20)));
`,
    see: 'toolbox/compare'
  });

  add({
    id: 'ar-burg-yulewalker',
    cat: 'spectrum',
    name: 'AR 谱估计：Burg 与 Yule-Walker 的分峰能力',
    desc: '对应网页「参数模型谱估计：AR/MA/ARMA」一节。只用 64 个样点估计两个紧邻频率：周期图因 Δf < fs/N 完全无法分辨，而 12 阶 AR 模型能给出两个尖峰。示例手写 Burg 递推，并与 scipy.signal.lpc（Yule-Walker 型）对照。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import freqz

rng = np.random.default_rng(7)
fs = 1000
N = 64                                    # 故意用很短的数据：经典方法的短板在这里暴露无遗
n = np.arange(N)
f1, f2 = 200.0, 212.0                     # 间距 12 Hz，仅 0.77 个 bin，低于瑞利限
s = np.sin(2 * np.pi * f1 * n / fs) + np.sin(2 * np.pi * f2 * n / fs)
x = s + 0.2 * rng.standard_normal(N)
print('数据长度 N = %d，瑞利限 Δf = fs/N = %.1f Hz，两频率间距 = %.1f Hz（%.2f bin）'
      % (N, fs / N, f2 - f1, (f2 - f1) * N / fs))

def burg(x, order):
    """Burg 递推：逐级增大阶数，每一步只优化反射系数 μ_k，保证模型稳定"""
    N = len(x)
    a = np.array([1.0])
    f = np.array(x, dtype=float)          # 前向预测误差
    b = np.array(x, dtype=float)          # 后向预测误差
    for k in range(order):
        num = 2.0 * np.dot(f[k + 1:], b[k:-1])            # 分子：前后向误差的互相关
        den = np.dot(f[k + 1:], f[k + 1:]) + np.dot(b[k:-1], b[k:-1])   # 分母：两者能量和
        mu = num / den
        a_new = np.concatenate((a, [0.0])) - mu * np.concatenate(([0.0], a[::-1]))
        fs_new = f[k + 1:] - mu * b[k:-1]                 # 前向误差更新
        fb_new = b[k:-1] - mu * f[k + 1:]                 # 后向误差更新
        f = np.concatenate((f[:k + 1], fs_new))
        b = np.concatenate((b[:k + 1], fb_new))
        a = a_new
    # 激励方差估计
    sigma = np.mean(f[order:] ** 2)
    return a, sigma

def yule_walker(x, order):
    """自相关法：先估计有偏自相关，再用 Levinson-Durbin 解 Yule-Walker 方程"""
    N = len(x)
    full = np.correlate(x, x, mode='full')
    r = full[N - 1:N + order + 1] / N              # 有偏估计（除以 N），保证 Toeplitz 正定
    a = np.array([1.0])
    e = r[0]
    for k in range(1, order + 1):
        acc = r[k] + np.dot(a[1:], r[k - 1:0:-1])  # Σ a_i·r[k-i]
        lam = -acc / e                             # 反射系数
        a_new = np.zeros(k + 1)
        a_new[0] = 1.0
        for i in range(1, k):
            a_new[i] = a[i] + lam * a[k - i]
        a_new[k] = lam
        a = a_new
        e = e * (1 - lam * lam)
    return a, e

def ar_psd(a, sigma, nfft, fs):
    """AR 功率谱：P(f) = σ²/|A(f)|²，A(f) = 1 + Σ a_k e^{-j2πfk}"""
    w, H = freqz(np.sqrt(sigma), a, worN=nfft, fs=fs)
    return w, np.abs(H) ** 2

order = 12
a_burg, sig_burg = burg(x, order)
a_yw, e_yw = yule_walker(x, order)

nfft = 4096
f_grid = np.fft.rfftfreq(nfft, 1 / fs)
w1, P_burg = ar_psd(a_burg, sig_burg, nfft, fs)
w2, P_yw = ar_psd(a_yw, e_yw, nfft, fs)

# 周期图作对照
Xp = np.abs(np.fft.rfft(x, nfft)) ** 2
P_per = Xp / (N * fs)

plt.figure(figsize=(9, 6))
plt.plot(f_grid, 10 * np.log10(P_per / P_per.max() + 1e-20), color='#bbbbbb', label='周期图（无法分辨）')
plt.plot(w1, 10 * np.log10(P_burg / P_burg.max() + 1e-20), 'C0', label='Burg AR(%d)' % order)
plt.plot(w2, 10 * np.log10(P_yw / P_yw.max() + 1e-20), 'C1', label='Yule-Walker AR(%d)' % order)
plt.axvline(f1, color='k', ls='--', lw=0.8); plt.axvline(f2, color='k', ls='--', lw=0.8)
plt.xlabel('频率 / Hz'); plt.ylabel('归一化 PSD / dB'); plt.legend(); plt.grid(alpha=0.3)
plt.title('短数据（N=64）下的 AR 谱：外推带来超分辨，但也容易出假峰')
plt.tight_layout(); plt.show()

print('极点最小模半径 = %.4f（<1 稳定；越接近 1，谱峰越尖锐）'
      % np.min(np.abs(np.roots(a_burg))))
print('工程提示：阶数过高会出现虚假谱峰；可用 AIC / MDL 准则定阶。')
`,
    ml: `%% MATLAB —— AR 谱估计：Burg 与 Yule-Walker（需要 Signal Processing Toolbox）
clear; clc; close all;

rng(7);
fs = 1000; N = 64; n = 0:N-1;
f1 = 200; f2 = 230;
s = sin(2*pi*f1*n/fs) + sin(2*pi*f2*n/fs);
x = s + 0.2*randn(1, N);
fprintf('N = %d，Δf = %.1f Hz，两频率间距 = %.1f Hz\\n', N, fs/N, f2-f1);

order = 12;
%% Burg 法（aryule 是自相关法/Yule-Walker；arburg 为 Burg）
[a_burg, e_burg] = arburg(x, order);          % 返回 [1 a1 ... ap]
[a_yw,   e_yw]   = aryule(x, order);

nfft = 4096;
[H1, w1] = freqz(sqrt(e_burg), a_burg, nfft, fs);
[H2, w2] = freqz(sqrt(e_yw),   a_yw,   nfft, fs);
Pp = abs(fft(x, nfft)).^2 / (N*fs);
fg = fs*(0:nfft/2)/nfft;

plot(fg, 10*log10(Pp(1:nfft/2+1)/max(Pp)+1e-20), 'Color', [0.75 0.75 0.75]); hold on;
plot(w1, 10*log10(abs(H1).^2/max(abs(H1).^2)+1e-20), 'LineWidth', 1.2);
plot(w2, 10*log10(abs(H2).^2/max(abs(H2).^2)+1e-20), 'LineWidth', 1.2);
xline(f1, 'k--'); xline(f2, 'k--'); grid on;
legend('周期图', sprintf('Burg AR(%d)', order), sprintf('Yule-Walker AR(%d)', order));
xlabel('频率 / Hz'); ylabel('归一化 PSD / dB');

fprintf('极点最小模 = %.4f（<1 稳定）\\n', min(abs(roots(a_burg))));
`,
    see: 'toolbox/compare'
  });

  add({
    id: 'music-esprit',
    cat: 'spectrum',
    name: 'MUSIC 与 ESPRIT：突破瑞利限的子空间方法',
    desc: '对应网页「子空间方法：Pisarenko/MUSIC/ESPRIT」与「⑩ MUSIC 超分辨」实验台。复正弦 + 白噪声模型，两个靠近的频率以 200 次蒙特卡洛比较周期图、MUSIC 谱峰搜索与 ESPRIT 闭式解的估计均方根误差，验证阈效应（低 SNR 下子空间方法会崩）。',
    py: `import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(2024)
fs = 1000.0
N = 128                       # 数据点数
K = 2                         # 复正弦个数
f_true = np.array([180.0, 196.0])        # 间距 16 Hz，约 2.05 个 FFT bin
amps = np.exp(1j * 2 * np.pi * rng.random(K))

def make_data(snr_db):
    # 复正弦模型 x[n] = Σ A_k·exp(+j·2π·f_k·n/fs)：这样 FFT 谱峰直接落在正频率上
    n = np.arange(N)
    S = np.sum(amps[:, None] * np.exp(1j * 2 * np.pi * np.outer(f_true, n) / fs), axis=0)
    Ps = np.mean(np.abs(S) ** 2)
    w = (rng.standard_normal(N) + 1j * rng.standard_normal(N)) / np.sqrt(2)
    return S + np.sqrt(Ps / (10 ** (snr_db / 10))) * w

def cov_matrix(x, M):
    """样本协方差矩阵：X 的每一列是一个长度为 M 的快照，R = Σ x_s·x_s^H / L"""
    X = np.array([x[i:i + M] for i in range(len(x) - M + 1)]).T
    return X @ X.conj().T / X.shape[1]

def music(x, K, nfft=2048):
    """MUSIC 伪谱：P(f) = 1 / (a(f)^H · En · En^H · a(f))，En 为噪声子空间"""
    M = 48                                   # 子阵长度（等价于自相关滞后阶数）
    R = cov_matrix(x, M)
    w_, V = np.linalg.eigh(R)                # 特征值升序：小特征值对应噪声子空间
    En = V[:, :M - K]
    f_grid = np.linspace(0, fs / 2, nfft)
    n_vec = np.arange(M)
    # 一次性构造全部频率的导向矩阵，避免 Python 逐频循环（提速百倍）
    A = np.exp(1j * 2 * np.pi * np.outer(f_grid, n_vec) / fs)     # nfft × M
    # 注意是 a(f)^H·En，因此要用 A 的共轭（行向量取共轭转置）
    T = A.conj() @ En                                             # nfft × (M-K)
    P = 1.0 / (np.sum(np.abs(T) ** 2, axis=1) + 1e-30)            # 逐行取能量即为分母
    return f_grid, 10 * np.log10(P / P.max() + 1e-20)

def esprit(x, K):
    """ESPRIT：利用信号子空间的平移不变性 U2 = U1·Φ，Φ 的特征值相角即频率"""
    M = 48
    R = cov_matrix(x, M)
    _, V = np.linalg.eigh(R)
    Us = V[:, M - K:]                        # 大特征值对应信号子空间
    U1 = Us[:-1, :]; U2 = Us[1:, :]          # 相差一个时延的两个子阵
    Phi = np.linalg.pinv(U1) @ U2
    ev = np.linalg.eigvals(Phi)
    return np.sort(np.angle(ev) * fs / (2 * np.pi))

# ===== 单次实验：画出三种谱 =====
x = make_data(10.0)
fg, Pm = music(x, K)
nfft_plot = 4096
Xp = np.abs(np.fft.fft(x, nfft_plot)[:nfft_plot // 2 + 1]) ** 2   # 复数据用 fft，不能用 rfft
fp = np.arange(nfft_plot // 2 + 1) * fs / nfft_plot
plt.figure(figsize=(9, 5))
plt.plot(fp, 10 * np.log10(Xp / Xp.max() + 1e-20), color='#bbbbbb', label='周期图')
plt.plot(fg, Pm, 'C0', label='MUSIC 伪谱')
plt.axvline(f_true[0], color='k', ls='--'); plt.axvline(f_true[1], color='k', ls='--')
plt.xlabel('频率 / Hz'); plt.ylabel('归一化 / dB'); plt.legend(); plt.grid(alpha=0.3)
plt.title('SNR=10 dB：周期图糊成一个包，MUSIC 给出两个尖峰')
plt.tight_layout(); plt.show()

# ===== 蒙特卡洛：比较 RMSE 随 SNR 的变化 =====
snrs = np.arange(-5, 26, 5)
rmse_mu, rmse_es, rmse_per = [], [], []
def pick_peaks(faxis, P, K, guard):
    """在谱上取 K 个谱峰：相邻 bins 只算一个峰，guard 为峰间最小间隔"""
    idx = np.argsort(P)[::-1]
    out = []
    for i in idx:
        if all(abs(i - j) > guard for j in out):
            out.append(i)
        if len(out) == K:
            break
    return np.sort(faxis[out] if len(out) == K else np.array([np.nan] * K))

for snr in snrs:
    err_mu, err_es, err_per = [], [], []
    for _ in range(100):
        xd = make_data(snr)
        fg_, Pm_ = music(xd, K)
        est_mu = pick_peaks(fg_, Pm_, K, guard=20)         # MUSIC 谱峰很窄，允许较大保护间隔
        est_es = esprit(xd, K)                            # ESPRIT 闭式解，无网格限制
        Xf = np.abs(np.fft.fft(xd, nfft_plot)[:nfft_plot // 2 + 1]) ** 2
        est_per = pick_peaks(fp, Xf, K, guard=8)           # 周期图峰很宽，用较小保护间隔
        err_mu.append(np.sqrt(np.mean((est_mu - f_true) ** 2)) if np.all(np.isfinite(est_mu)) else 100)
        err_es.append(np.sqrt(np.mean((est_es - f_true) ** 2)) if np.all(np.isfinite(est_es)) else 100)
        err_per.append(np.sqrt(np.mean((est_per - f_true) ** 2)) if np.all(np.isfinite(est_per)) else 100)
    rmse_mu.append(np.median(err_mu)); rmse_es.append(np.median(err_es))
    rmse_per.append(np.median(err_per))
    print('SNR=%3d dB：MUSIC RMSE=%6.2f Hz，ESPRIT RMSE=%6.2f Hz，周期图 RMSE=%6.2f Hz'
          % (snr, rmse_mu[-1], rmse_es[-1], rmse_per[-1]))

plt.figure(figsize=(7, 4))
plt.semilogy(snrs, rmse_per, 'o-', label='周期图')
plt.semilogy(snrs, rmse_mu, 's-', label='MUSIC')
plt.semilogy(snrs, rmse_es, '^-', label='ESPRIT')
plt.xlabel('SNR / dB'); plt.ylabel('频率估计 RMSE / Hz'); plt.legend(); plt.grid(alpha=0.3)
plt.title('阈效应：SNR 低于某值后子空间方法迅速失效')
plt.tight_layout(); plt.show()
`,
    ml: `%% MATLAB —— MUSIC 与 ESPRIT（需要 Signal Processing Toolbox）
clear; clc; close all;

rng(2024);
fs = 1000; N = 128; K = 2;
f_true = [180 196];
amps = exp(1j*2*pi*rand(1, K));
n = 0:N-1;
S = amps * exp(1j*2*pi*f_true'*n/fs);
Ps = mean(abs(S).^2);
x = S + sqrt(Ps/10)*((randn(1,N)+1j*randn(1,N))/sqrt(2));   % SNR = 10 dB

%% 1) MUSIC 伪谱（pmusic 内部使用特征分解）
pmusic(x, K, 4096, fs, 'corr'); hold on;
xline(f_true(1), 'k--'); xline(f_true(2), 'k--');
title('MUSIC 伪谱（pmusic，K=2）');

%% 2) rootmusic：把谱峰搜索换成多项式求根，规避网格限制
figure;
rootmusic(x, K, 'corr', fs); title('ROOT-MUSIC');

%% 3) ESPRIT 闭式解
% 由自相关矩阵的特征向量构造信号子空间，再利用平移不变性求 Φ
M = 48;
R = corrmtx(x, M-1, 'autocorrelation');       % Toeplitz 型数据矩阵
R = R'*R/size(R,2);
[V, D] = eig(R);
[~, idx] = sort(diag(D), 'descend');
Us = V(:, idx(1:K));
U1 = Us(1:end-1, :); U2 = Us(2:end, :);
Phi = pinv(U1)*U2;
f_est = sort(angle(eig(Phi))*fs/(2*pi));
fprintf('真实频率：%s\\n', mat2str(f_true));
fprintf('ESPRIT 估计：%s\\n', mat2str(f_est, 4));
`,
    see: 'lab/music'
  });

  /* ==================================================================
     五、阵列（CBF / MVDR）
     ================================================================== */

  add({
    id: 'cbf-beampattern',
    cat: 'array',
    name: 'CBF 常规波束形成与波束扫描',
    desc: '对应网页「⑥ 阵列信号处理基础」与「⑩ 波束形成」实验台。16 元均匀线阵、间距 λ/2，写一遍导向矢量与加权求和，画出 −90°…90° 的波束图，并演示阵元间距超过半波长时出现栅瓣（方位模糊）。',
    py: `import numpy as np
import matplotlib.pyplot as plt

c = 1500.0                    # 水中声速 m/s；空气中常用 340 m/s
f0 = 3000.0                   # 工作频率 Hz
lam = c / f0                  # 波长
Ne = 16                       # 阵元数
d_list = [0.5, 1.0]           # 阵元间距（以波长为单位）：0.5 无栅瓣，1.0 出现栅瓣

theta = np.linspace(-90, 90, 1801)
theta_rad = np.deg2rad(theta)

def steering(d_lam, steer_deg):
    """导向矢量 a(θ) = exp(-j·2π·(d/λ)·m·sin θ)，m = 0..Ne-1"""
    m = np.arange(Ne)
    # 相位共轭加权：使阵列在 steer_deg 方向上同相叠加
    return np.exp(-1j * 2 * np.pi * d_lam * m * np.sin(np.deg2rad(steer_deg)))

plt.figure(figsize=(9, 7))
for i, d_lam in enumerate(d_list, 1):
    w = steering(d_lam, 20.0)          # 波束指向 20°
    # 遍历所有方位计算阵列响应
    A = np.exp(-1j * 2 * np.pi * d_lam * np.outer(np.sin(theta_rad), np.arange(Ne)))  # [方位 × 阵元]
    resp = np.abs(A @ w.conj()) / Ne
    resp_db = 20 * np.log10(resp + 1e-12)

    plt.subplot(2, 1, i)
    plt.plot(theta, resp_db, lw=1.2)
    plt.ylim(-40, 2); plt.grid(alpha=0.3)
    plt.xlabel('方位 θ / 度'); plt.ylabel('归一化响应 / dB')
    plt.title('d = %.1f λ：%s' % (d_lam, '无栅瓣' if d_lam <= 0.5 else '出现栅瓣（多个等高峰）'))

    # 定量：-3 dB 波束宽度
    main = resp_db > -3
    bw = theta[main].max() - theta[main].min()
    print('d = %.1f λ：主瓣指向 %.1f°，−3 dB 波束宽度 %.1f°，理论 0.886λ/(Nd) = %.1f°'
          % (d_lam, theta[np.argmax(resp_db)], bw, np.rad2deg(0.886 / (Ne * d_lam))))
plt.tight_layout(); plt.show()

print('栅瓣判据：sin θ_grating = sin θ0 + m·λ/d，只要 λ/d ≤ 2（即 d ≥ λ/2）就可能出现第二个解。')
`,
    ml: `%% MATLAB —— CBF 常规波束形成（需要 Phased Array System Toolbox，或用基础函数手写）
clear; clc; close all;

c = 1500; f0 = 3000; lam = c/f0; Ne = 16;
theta = linspace(-90, 90, 1801);
d_list = [0.5 1.0];
steer = 20;

figure;
for i = 1:length(d_list)
    d = d_list(i)*lam;
    array = phased.ULA('NumElements', Ne, 'ElementSpacing', d);
    array.Taper = exp(-1j*2*pi*(d/lam)*(0:Ne-1)'*sind(steer));   % 相移使主瓣指向 steer
    resp = abs(array(f0, [theta; zeros(size(theta))]));          % 只考虑方位维
    resp = resp/max(resp);
    resp_db = 20*log10(resp+1e-12);

    subplot(2,1,i); plot(theta, resp_db); grid on; ylim([-40 2]);
    xlabel('方位 / 度'); ylabel('归一化响应 / dB');
    if d_list(i) <= 0.5
        title(sprintf('d = %.1f 波长：无栅瓣', d_list(i)));
    else
        title(sprintf('d = %.1f 波长：出现栅瓣', d_list(i)));
    end
    hold on; xline(steer, 'r--');
end

fprintf('理论 −3 dB 波束宽度 ≈ %.1f°（0.886λ/(Nd)，d=λ/2）\\n', rad2deg(0.886/(Ne*0.5)));
fprintf('栅瓣判据：sinθg = sinθ0 + m·λ/d\\n');
`,
    see: 'toolbox/compare'
  });

  add({
    id: 'mvdr-spatial-smoothing',
    cat: 'array',
    name: 'MVDR 自适应波束形成与空间平滑',
    desc: '对应网页「⑥ 阵列」的 MVDR 一节。对比 CBF 与 MVDR 在强干扰下的分辨能力，然后演示相干信源（多径）导致 MVDR 自相消失效，再用前向-后向空间平滑把秩恢复回来。',
    py: `import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(9)
Ne = 12                      # 阵元数
d_lam = 0.5                  # 阵元间距 / 波长
snapshots = 300              # 快拍数
snr_db = 10.0

angles = [-20.0, 12.0]       # 目标方位 + 强干扰方位
pows_db = [0.0, 30.0]        # 干扰比目标强 30 dB
theta = np.linspace(-90, 90, 1801)
th = np.deg2rad(theta)

def steer(ang):
    m = np.arange(Ne)
    return np.exp(-1j * 2 * np.pi * d_lam * m * np.sin(np.deg2rad(ang)))

X = np.zeros((Ne, snapshots), dtype=complex)
for ang, pd in zip(angles, pows_db):
    a = steer(ang)
    s = (rng.standard_normal(snapshots) + 1j * rng.standard_normal(snapshots)) / np.sqrt(2)
    X += np.sqrt(10 ** (pd / 10)) * np.outer(a, s)
noise = (rng.standard_normal((Ne, snapshots)) + 1j * rng.standard_normal((Ne, snapshots))) / np.sqrt(2)
X += np.sqrt(10 ** (-snr_db / 10)) * noise

R = X @ X.conj().T / snapshots                    # 样本协方差矩阵
R_inv = np.linalg.inv(R + 1e-6 * np.eye(Ne))      # 加对角加载防止病态

def mvdr_pattern(R_inv, scan=True):
    w = None
    out = np.zeros(len(theta))
    for i, t in enumerate(theta):
        a = steer(t)
        w = R_inv @ a / (a.conj() @ R_inv @ a)     # MVDR 权：约束增益 1，输出功率最小
        out[i] = np.abs(w.conj() @ R @ w)
    return 10 * np.log10(out / out.max() + 1e-20)

def cbf_pattern(target):
    w = steer(target)
    out = np.zeros(len(theta))
    for i, t in enumerate(theta):
        out[i] = np.abs(w.conj() @ steer(t)) / Ne
    return 20 * np.log10(out + 1e-12)

p_cbf = cbf_pattern(angles[0])
p_mvdr = mvdr_pattern(R_inv)

# ===== 相干信源：目标经多径形成两个完全相关的到达方向，协方差矩阵秩亏 =====
a1 = steer(-20.0); a2 = steer(35.0)
s = (rng.standard_normal(snapshots) + 1j * rng.standard_normal(snapshots)) / np.sqrt(2)
Xc = np.outer(a1, s) + 0.9 * np.outer(a2, s)      # 同一个信号复本，完全相干
Xc += np.sqrt(10 ** (-snr_db / 10)) * noise
Rc = Xc @ Xc.conj().T / snapshots
p_mvdr_coh = mvdr_pattern(np.linalg.inv(Rc + 1e-4 * np.eye(Ne)))

# ===== 空间平滑：把阵列切成 L 个子阵，各自求协方差后平均，恢复秩 =====
L = 6                                             # 子阵长度 6 -> 可分辨 L-1 = 5 个相干源
sub_len = Ne - L + 1
Rs = np.zeros((L, L), dtype=complex)
for k in range(sub_len):
    Xk = Xc[k:k + L, :]
    Rs += Xk @ Xk.conj().T / snapshots
    Rs += np.flipud(np.fliplr(Xk.conj())) @ np.flipud(np.fliplr(Xk.conj())).conj().T / snapshots  # 后向
Rs /= (2 * sub_len)
# 注意：平滑后协方差的维数降为 L×L，因此只能在"子阵列"尺度上形成波束图，
# 代价是有效孔径变小、主瓣变宽；换来的是协方差矩阵秩恢复，能够分辨相干源。
p_smooth = np.zeros(len(theta))
for i, t in enumerate(theta):
    a = np.exp(-1j * 2 * np.pi * d_lam * np.arange(L) * np.sin(th[i]))
    w = np.linalg.solve(Rs, a) / (a.conj() @ np.linalg.solve(Rs, a))
    p_smooth[i] = np.abs(w.conj() @ Rs @ w)
p_smooth = 10 * np.log10(p_smooth / p_smooth.max() + 1e-20)

plt.figure(figsize=(9, 7))
plt.subplot(3, 1, 1)
plt.plot(theta, p_cbf, label='CBF'); plt.plot(theta, p_mvdr, label='MVDR')
plt.legend(); plt.grid(alpha=0.3); plt.ylim(-60, 2); plt.ylabel('dB')
plt.title('独立信源：MVDR 在 12° 干扰方向形成深零陷')
plt.subplot(3, 1, 2)
plt.plot(theta, p_mvdr_coh, 'r'); plt.grid(alpha=0.3); plt.ylim(-60, 2); plt.ylabel('dB')
plt.title('相干信源：MVDR 把目标当作干扰自相消（目标峰消失）')
plt.subplot(3, 1, 3)
plt.plot(theta, p_smooth, 'g'); plt.grid(alpha=0.3); plt.ylim(-60, 2); plt.ylabel('dB')
plt.title('空间平滑后：协方差矩阵秩恢复，可以分辨 -20° 与 35°')
plt.xlabel('方位 / 度'); plt.tight_layout(); plt.show()
`,
    ml: `%% MATLAB —— MVDR 自适应波束形成与空间平滑（需要 Phased Array System Toolbox）
clear; clc; close all;

rng(9);
Ne = 12; d = 0.5; snapshots = 300; snr_db = 10;
angles = [-20 12]; pows_db = [0 30];
theta = linspace(-90, 90, 1801);

%% 1) 构造数据：两个信源 + 空间白噪声
ula = phased.ULA('NumElements', Ne, 'ElementSpacing', d);
steer = @(ang) exp(-1j*2*pi*d*(0:Ne-1)'*sind(ang));
X = zeros(Ne, snapshots);
for j = 1:length(angles)
    s = (randn(1, snapshots)+1j*randn(1, snapshots))/sqrt(2);
    X = X + sqrt(10^(pows_db(j)/10))*(steer(angles(j))*s);
end
noise = (randn(Ne, snapshots)+1j*randn(Ne, snapshots))/sqrt(2);
X = X + sqrt(10^(-snr_db/10))*noise;
R = X*X'/snapshots;

%% CBF 与 MVDR
beam_cbf  = phased.PhaseShiftBeamformer('SensorArray', ula, 'OperatingFrequency', 1500, ...
            'Direction', [angles(1); 0], 'PropagationSpeed', 1500);
beam_mvdr = phased.MVDRBeamformer('SensorArray', ula, ...
            'OperatingFrequency', 1500, 'Direction', [angles(1); 0], ...
            'PropagationSpeed', 1500, 'DiagonalLoadingFactor', 1e-6, ...
            'TrainingInputPort', true);
[y1, ~] = beam_cbf(X);
[y2, ~] = beam_mvdr(X);

%% 波束图
pcare = patternAzimuth(beam_mvdr, 1500, -90:0.1:90, 0, 'PropagationSpeed', 1500, 'Type', 'powerdb');
figure; plot(-90:0.1:90, pcare, 'DisplayName', 'MVDR'); hold on; grid on;
pcare2 = patternAzimuth(beam_cbf, 1500, -90:0.1:90, 0, 'PropagationSpeed', 1500, 'Type', 'powerdb');
plot(-90:0.1:90, pcare2, 'DisplayName', 'CBF'); legend; ylim([-60 5]);
xlabel('方位 / 度'); ylabel('dB'); title('CBF 与 MVDR 波束图');

fprintf('提示：相干信源需先做空间平滑，否则 MVDR 会自相消。\\n');
`,
    see: 'theory/array/beamforming'
  });

  /* ==================================================================
     六、雷达（脉冲压缩 / MTD / CFAR）
     ================================================================== */

  add({
    id: 'lfm-pulse-compression',
    cat: 'radar',
    name: 'LFM 脉冲压缩：加窗如何换旁瓣',
    desc: '对应网页「⑨ 匹配滤波与脉冲压缩」实验台与「主动声呐 LFM 脉冲压缩」案例。脉宽 20 μs、带宽 5 MHz（时宽带宽积 100），给出矩形窗 / 汉宁窗 / 泰勒窗三种参考信号下的 PSL、ISLR 与零点间主瓣宽度，并用蒙特卡洛演示双目标的分辨极限（加权抑制旁瓣的代价就是分辨力下降）。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import correlate, windows

c = 3e8                     # 电磁波传播速度 m/s
fs = 20e6                   # 采样率 20 MHz（复数基带，实带通需满足带通采样定理）
T = 20e-6                   # 脉宽 20 μs
B = 5e6                     # 带宽 5 MHz -> 时宽带宽积 BT = 100
Np = int(T * fs)            # 脉内采样点数
t = np.arange(Np) / fs
k = B / T                   # 调频斜率 Hz/s

# ===== 1. 发射的复基带 LFM：瞬时频率从 -B/2 线性扫到 +B/2 =====
s_tx = np.exp(1j * 2 * np.pi * (0.5 * k * (t - T / 2) ** 2))

def matched_filter(rx, win):
    """匹配滤波 = 与"加权后的发射副本"做相关。

    correlate(rx, ref, 'full') 的长度是 Nrx + Np - 1，第 n 点对应滞后 n - (Np-1)。
    丢掉前 Np-1 个"还没对齐"的输出后，第 n 点就正好对应回波延迟 n，
    便于直接与真实目标距离门对照（否则峰位会整体偏移 Np/2）。
    """
    ref = s_tx if win is None else s_tx * win        # 加权参考信号
    return correlate(rx, ref, mode='full')[Np - 1:]

def metrics(y):
    """压缩指标：峰值旁瓣电平 PSL、积分旁瓣比 ISLR、零点间主瓣宽度"""
    a = np.abs(y)
    pk = int(np.argmax(a))
    db = 20 * np.log10(a / a.max() + 1e-12)
    # 零点间宽度：由峰值向两侧找到第一个局部极小
    i = pk
    while i > 1 and a[i - 1] < a[i]: i -= 1
    j = pk
    while j < len(a) - 2 and a[j + 1] < a[j]: j += 1
    nn = j - i                                        # 零点-零点宽度（样点）
    h0 = max(2, int(nn / 2))                          # 主瓣半宽
    m_p = np.ones(len(a), bool); m_p[max(0, pk - h0):pk + h0] = False
    psl = db[m_p].max()                               # 峰值旁瓣电平
    # ISLR：分母取主瓣能量（±3 倍零点宽度以内），分子取其余全部能量
    g = 3 * nn
    m_i = np.ones(len(a), bool); m_i[max(0, pk - g):pk + g] = False
    islr = 10 * np.log10(np.sum(a[m_i] ** 2) / np.sum(a[~m_i] ** 2))
    return psl, islr, nn

# ===== 2. 单个目标回波 + 噪声 =====
Nrx = 4096
rx = np.zeros(Nrx, dtype=complex)
delay = 1200                                        # 回波到达的样点序号
rx[delay:delay + Np] = s_tx
rng = np.random.default_rng(5)
snr_in = 5.0                                        # 单个脉内采样点的输入 SNR (dB)
sigma = np.sqrt(10 ** (-snr_in / 10))
rx += sigma * (rng.standard_normal(Nrx) + 1j * rng.standard_normal(Nrx)) / np.sqrt(2)

cases = [('矩形窗（无加权）', None),
         ('汉宁窗', np.hanning(Np)),
         ('泰勒窗 nbar=4', windows.taylor(Np, nbar=4, sll=35))]

plt.figure(figsize=(9, 7))
for i, (name, win) in enumerate(cases, 1):
    y = matched_filter(rx, win)
    psl, islr, nn = metrics(y)
    print('%-16s PSL = %6.2f dB，ISLR = %6.2f dB，零点间主瓣 = %d 样点（理论 2/B = %.1f）'
          % (name, psl, islr, nn, 2 * fs / B))

    plt.subplot(3, 1, i)
    plt.plot(20 * np.log10(np.abs(y) / np.abs(y).max() + 1e-12), lw=1.0)
    plt.axhline(psl, color='r', ls='--', lw=0.8)
    plt.ylim(-70, 5); plt.grid(alpha=0.3); plt.ylabel('dB')
    plt.title('%s：PSL = %.1f dB，ISLR = %.1f dB' % (name, psl, islr))
plt.xlabel('距离门序号'); plt.tight_layout(); plt.show()

# ===== 3. 双目标分辨：间距小于 1/B 时两个回波会糊成一个峰 =====
# 注意：两个回波必须用 += 叠加（线性叠加原理），用 = 会把前一个脉冲截断。
# 又因为两个回波是相干的，合成峰形取决于它们的相对相位，所以这里用
# 蒙特卡洛（随机相对相位）统计"能看出两个峰"的概率，而不是给一次确定的结论。
cell = fs / B                                        # 一个距离分辨单元 = 1/B 对应的样点数
MC = 60                                              # 蒙特卡洛次数
rng2 = np.random.default_rng(7)

def dip_db(a, sep):
    """两个真实峰位之间凹陷了多少 dB —— 凹陷越深越像"两个目标"。"""
    d2 = delay + sep
    return 20 * np.log10(a[delay:d2 + 1].min() / min(a[delay], a[d2]) + 1e-12)

print('\\n双目标分辨（第二目标幅度 0.8，随机相对相位 %d 次）' % MC)
for win_name, win in [('矩形窗', None), ('汉宁窗', np.hanning(Np))]:
    for ratio in [0.5, 1.0, 1.5, 2.5]:
        sep = int(round(ratio * cell))               # 以"分辨单元"为单位的间距
        dips = []
        for _ in range(MC):
            ph = np.exp(1j * 2 * np.pi * rng2.random())   # 目标 2 的随机初相
            rx2 = np.zeros(Nrx, dtype=complex)
            rx2[delay:delay + Np] += s_tx                 # 目标 1
            rx2[delay + sep:delay + sep + Np] += 0.8 * ph * s_tx   # 目标 2（叠加！）
            dips.append(dip_db(np.abs(matched_filter(rx2, win)), sep))
        dips = np.array(dips)
        rate = 100.0 * np.mean(dips < -2.0)          # 凹陷深于 2 dB 判为"能看出两个峰"
        print('  %s 间距 %.1f 单元（%2d 样点）：凹陷均值 %6.2f dB，双峰率 %3.0f%%'
              % (win_name, ratio, sep, dips.mean(), rate))

print('\\n距离分辨率 ΔR = c/(2B) = %.1f m，对应 %.1f 个采样点' % (c / (2 * B), fs / B))
print('处理增益 = 10log10(B·T) = %.1f dB' % (10 * np.log10(B * T)))
`,
    ml: `%% MATLAB —— LFM 脉冲压缩（需要 Signal Processing Toolbox）
clear; clc; close all;

c = 3e8; fs = 20e6; T = 20e-6; B = 5e6;
Np = round(T*fs);
t = (0:Np-1)/fs;
k = B/T;
s_tx = exp(1j*2*pi*(0.5*k*(t-T/2).^2));      % 复基带 LFM

%% 接收回波 + 噪声
Nrx = 4096;
rx = zeros(Nrx,1);
delay = 1200;
rx(delay+1:delay+Np) = s_tx.';
rng(5);
snr_in = 5;
rx = rx + sqrt(10^(-snr_in/10))*(randn(Nrx,1)+1j*randn(Nrx,1))/sqrt(2);

%% 匹配滤波器系数 = 参考信号翻转取共轭；分别用三种窗加权
wins = {'矩形窗（无加权）', ones(Np,1); '汉宁窗', hann(Np); '泰勒窗', taylorwin(Np, 4, -35)};

figure;
for i = 1:size(wins,1)
    h = zeros(Nrx,1);
    h(1:Np) = conj(flipud(s_tx(:).*wins{i,2}));     % 匹配滤波器（时域翻转共轭）
    y = conv(rx, h, 'same');
    a = abs(y); db = 20*log10(a/max(a)+1e-12);
    [~, pk] = max(a);
    % 零点间主瓣宽度：峰值两侧第一个局部极小
    idx = pk; while idx > 1 && a(idx-1) < a(idx), idx = idx - 1; end
    jdx = pk; while jdx < length(a)-1 && a(jdx+1) < a(jdx), jdx = jdx + 1; end
    nn = jdx - idx;
    h0 = max(2, floor(nn/2));
    mp = true(size(a)); mp(max(1,pk-h0):pk+h0) = false;
    psl = max(db(mp));                              % 峰值旁瓣电平
    g = 3*nn; mi = true(size(a)); mi(max(1,pk-g):pk+g) = false;
    islr = 10*log10(sum(a(mi).^2)/sum(a(~mi).^2));  % 积分旁瓣比
    fprintf('%-16s PSL = %6.2f dB，ISLR = %6.2f dB，零点间主瓣 = %d 样点\\n', ...
            wins{i,1}, psl, islr, nn);

    subplot(3,1,i); plot(db); grid on; ylim([-70 5]);
    hold on; yline(psl, 'r--'); ylabel('dB');
    title(sprintf('%s：PSL = %.1f dB，ISLR = %.1f dB', wins{i,1}, psl, islr));
end
xlabel('距离门序号');

%% 双目标分辨：第二目标幅度 0.8，间距用"分辨单元" c/(2B) 的倍数表示
%% 注意两个回波要「叠加」而不是「赋值」—— 直接赋值会把前一个脉冲的样点覆盖掉
h_ref = zeros(Nrx,1);
h_ref(1:Np) = conj(flipud(s_tx(:).*hann(Np)));      % 汉宁加权匹配滤波器
cellw = fs/B;
fprintf('\\n双目标分辨（第二目标 0.8，汉宁加权）\\n');
for ratio = [0.5 1.0 1.5 2.5]
    sep = round(ratio*cellw);
    rx2 = zeros(Nrx,1);
    rx2(delay+1:delay+Np) = rx2(delay+1:delay+Np) + s_tx.';
    rx2(delay+sep+1:delay+sep+Np) = rx2(delay+sep+1:delay+sep+Np) + 0.8*s_tx.';
    a2 = abs(conv(rx2, h_ref, 'same'));
    [~, pk2] = max(a2);
    dip = 20*log10(min(a2(pk2:pk2+sep))/min(a2(pk2), a2(pk2+sep)) + 1e-12);
    if dip < -2, verdict = '可分辨'; else, verdict = '糊成一个峰'; end
    fprintf('  间距 %.1f 单元（%2d 样点）：两峰间凹陷 %6.2f dB -> %s\\n', ratio, sep, dip, verdict);
end

fprintf('距离分辨率 ΔR = c/(2B) = %.1f m\\n', c/(2*B));
fprintf('处理增益 = 10log10(BT) = %.1f dB\\n', 10*log10(B*T));
`,
    see: 'lab/matched'
  });

  add({
    id: 'mtd-range-doppler',
    cat: 'radar',
    name: 'MTD 距离-多普勒二维处理与 MTI 杂波抑制',
    desc: '对应网页「MTI 动目标显示与 MTD 相参积累」案例。64 个脉冲 × 256 个距离门的数据矩阵，先在慢时间维用三脉冲对消器抑制零频地杂波，再做多普勒 FFT，得到距离-多普勒二维图；同时量化改善因子与盲速。',
    py: `import numpy as np
import matplotlib.pyplot as plt

c = 3e8
fc = 3e9                       # 载频 3 GHz
lam = c / fc                   # 波长 0.1 m
PRF = 2000.0                   # 脉冲重复频率 Hz
Np = 64                        # 脉冲数（慢时间维）
Nr = 256                       # 距离门数（快时间维）
rng = np.random.default_rng(11)

# ===== 1. 构造 data cube：目标 + 强静止杂波 + 热噪声 =====
rbin_t = 60                    # 目标所在距离门
v_t = 25.0                     # 目标径向速度 m/s
fd_t = 2 * v_t / lam           # 多普勒频率 Hz = 500 Hz
cube = np.zeros((Np, Nr), dtype=complex)
p = np.arange(Np)
# 静止杂波：所有距离门都有，多普勒为零（相位不随脉冲变化）
clutter_amp = np.sqrt(10 ** (40 / 10)) * np.exp(1j * 2 * np.pi * rng.random(Nr))
cube += clutter_amp[None, :] * (rng.standard_normal((Np, 1)) + 1j * rng.standard_normal((Np, 1))) / np.sqrt(2)
# 运动目标：距离-dim 上占一个距离门，慢时间维有线性相位步进
cube[:, rbin_t] += 1.0 * np.exp(1j * 2 * np.pi * fd_t * p / PRF)
cube[:, rbin_t + 1] += 0.7 * np.exp(1j * 2 * np.pi * fd_t * p / PRF)
# 热噪声
cube += (rng.standard_normal(cube.shape) + 1j * rng.standard_normal(cube.shape)) / np.sqrt(2)

def snr_of(mat, rb):
    """在某距离门上估计目标 SNR：多普勒峰值功率 / 其余多普勒单元平均功率"""
    S = np.abs(np.fft.fftshift(np.fft.fft(mat[:, rb] * np.hanning(Np), 256))) ** 2
    return 10 * np.log10(S.max() / np.median(S))

print('处理前目标 SNR = %.1f dB' % snr_of(cube, rbin_t))

# ===== 2. MTI：三脉冲对消（二项式加权 [1,-2,1]），在零频形成深陷 =====
mti = np.zeros_like(cube)
mti[2:, :] = cube[2:, :] - 2 * cube[1:-1, :] + cube[:-2, :]
print('MTI 后目标 SNR = %.1f dB' % snr_of(mti, rbin_t))

# ===== 3. MTD：慢时间维加窗后做 FFT，得到距离-多普勒图 =====
w = np.hanning(Np)[:, None]
RD = np.fft.fftshift(np.fft.fft(mti * w, n=128, axis=0), axes=0)
dop = np.fft.fftshift(np.fft.fftfreq(128, 1 / PRF))
vel = dop * lam / 2                             # fd = 2v/λ -> v = fd·λ/2

plt.figure(figsize=(9, 6))
plt.imshow(20 * np.log10(np.abs(RD) / np.abs(RD).max() + 1e-12),
           aspect='auto', origin='lower', cmap='jet',
           extent=[0, Nr, vel[0], vel[-1]], vmin=-60, vmax=0)
plt.colorbar(label='dB'); plt.xlabel('距离门'); plt.ylabel('速度 / (m/s)')
plt.title('距离-多普勒图：静止杂波已被 MTI 抑制，目标出现在 %d 号距离门 / %.0f m/s'
          % (rbin_t, v_t))
plt.tight_layout(); plt.show()

# ===== 4. 盲速与改善因子 =====
v_blind = lam * PRF / 2
print('第一盲速 PRF·λ/2 = %.0f m/s（超过后多普勒频率混叠，测速模糊）' % v_blind)
print('相参积累理论改善因子 = 10log10(Np) = %.1f dB' % (10 * np.log10(Np)))
`,
    ml: `%% MATLAB —— MTD 距离-多普勒处理（需要 Phased Array System Toolbox 或基础 FFT 即可）
clear; clc; close all;

c = 3e8; fc = 3e9; lam = c/fc; PRF = 2000;
Np = 64; Nr = 256;
rng(11);

%% 1) 数据矩阵：静止杂波 + 运动目标 + 噪声
rbin_t = 60; v_t = 25; fd_t = 2*v_t/lam;
cube = zeros(Np, Nr);
p = (0:Np-1)';
clutter = sqrt(10^(40/10))*exp(1j*2*pi*rand(1, Nr));
cube = cube + clutter.*((randn(Np,1)+1j*randn(Np,1))/sqrt(2));
cube(:, rbin_t)   = cube(:, rbin_t)   + 1.0*exp(1j*2*pi*fd_t*p/PRF);
cube(:, rbin_t+1) = cube(:, rbin_t+1) + 0.7*exp(1j*2*pi*fd_t*p/PRF);
cube = cube + (randn(Np, Nr)+1j*randn(Np, Nr))/sqrt(2);

%% 2) MTI 三脉冲对消
mti = zeros(size(cube));
mti(3:end, :) = cube(3:end, :) - 2*cube(2:end-1, :) + cube(1:end-2, :);

%% 3) 慢时间维 FFT
RD = fftshift(fft(mti.*hann(Np), 128, 1), 1);
dop = fftshift((-64:63)*PRF/128);
vel = dop*lam/2;
imagesc(1:Nr, vel, 20*log10(abs(RD)/max(abs(RD),[],'all')+1e-12));
set(gca, 'YDir', 'normal'); clim([-60 0]); colorbar; colormap jet;
xlabel('距离门'); ylabel('速度 / (m/s)'); title('距离-多普勒图（MTI + FFT）');

fprintf('第一盲速 PRF*λ/2 = %.0f m/s\\n', lam*PRF/2);
fprintf('相参积累理论改善因子 = %.1f dB\\n', 10*log10(Np));
`,
    see: 'cases/radar/mti-mtd'
  });

  add({
    id: 'cfar-detector',
    cat: 'radar',
    name: 'CFAR 恒虚警检测：CA / GO / SO / OS 谁怕什么',
    desc: '对应网页「CFAR 恒虚警检测（CA/OS/GO/SO）」案例。同一段含杂波边缘与三个目标的功率序列，四种 CFAR 各自的门限曲线画在一起：CA 在杂波边缘虚警、多目标时互相遮蔽；GO 抗边缘虚警；SO 抗遮蔽；OS 两者兼顾。',
    py: `import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(2024)
Ncell = 400                       # 距离单元数
Nref = 16                         # 每侧参考单元数
Nguard = 2                        # 每侧保护单元数（防止目标能量泄漏进参考窗）
Pfa = 1e-3                        # 设计虚警概率

def alpha_ca(N, Pfa):
    """CA-CFAR 的门限因子：α = N·(Pfa^{-1/N} − 1)，N 为参考单元总数"""
    return N * (Pfa ** (-1.0 / N) - 1.0)
alpha_os = 8.0                    # OS-CFAR 的门限因子来自 Order Statistics 分布，此处取常用值

# ===== 1. 构造功率序列：低杂波区 -> 杂波边缘 -> 高杂波区，并放三个目标 =====
clutter = np.zeros(Ncell)
clutter[:200] = 1.0
clutter[200:] = 30.0              # 杂波边缘：功率跳变 30 倍（约 15 dB）
power = rng.exponential(clutter)  # Rayleigh 幅度 -> 功率服从指数分布

targets = [(80, 60.0), (85, 40.0), (300, 25.0)]   # (距离单元, 信噪比倍数)
for idx, snr_mul in targets:
    power[idx] = snr_mul * clutter[idx]

# ===== 2. 四种 CFAR =====
def run_cfar(power, kind):
    thr = np.zeros(Ncell)
    for i in range(Ncell):
        left = power[max(0, i - Nguard - Nref):max(0, i - Nguard)]
        right = power[min(Ncell, i + Nguard + 1):min(Ncell, i + Nguard + 1 + Nref)]
        if len(left) < 2 or len(right) < 2:
            thr[i] = np.nan
            continue
        if kind == 'CA':
            est = np.mean(np.concatenate([left, right]))
            thr[i] = alpha_ca(len(left) + len(right), Pfa) * est
        elif kind == 'GO':
            thr[i] = alpha_ca(Nref, Pfa) * max(np.mean(left), np.mean(right))
        elif kind == 'SO':
            thr[i] = alpha_ca(Nref, Pfa) * min(np.mean(left), np.mean(right))
        elif kind == 'OS':
            k = int(0.75 * (len(left) + len(right)))      # 取第 75% 分位的参考单元
            est = np.sort(np.concatenate([left, right]))[k - 1]
            thr[i] = alpha_os * est
    return thr

t_bins = [idx for idx, _ in targets]
plt.figure(figsize=(10, 9))
for i, kind in enumerate(['CA', 'GO', 'SO', 'OS'], 1):
    thr = run_cfar(power, kind)
    det = np.where(power > thr)[0]
    plt.subplot(4, 1, i)
    plt.plot(power, color='C0', lw=0.9, label='单元功率')
    plt.plot(thr, color='C3', lw=1.1, label='自适应门限')
    plt.plot(det, power[det], 'k*', ms=7, label='检测')
    plt.plot(t_bins, power[t_bins], 'g^', ms=7, label='真目标')
    plt.yscale('log'); plt.legend(fontsize=8); plt.grid(alpha=0.3)
    hit = sum(1 for b in t_bins if b in det)
    fake = sum(1 for d in det if d not in t_bins)
    plt.title('%s-CFAR：检出 %d/%d 个真目标，虚警 %d 个' % (kind, hit, len(t_bins), fake))
    print('%s-CFAR：检出 %d/%d 个真目标，虚警 %d 个' % (kind, hit, len(t_bins), fake))
plt.xlabel('距离单元'); plt.tight_layout(); plt.show()

print('CA 怕杂波边缘（此处会虚警）与多目标遮蔽；')
print('GO 取两侧较大值，专治边缘虚警；SO 取较小值，专治遮蔽；OS 取有序统计量，两者兼顾。')
`,
    ml: `%% MATLAB —— CFAR 恒虚警检测（基础版即可）
clear; clc; close all;

rng(2024);
Ncell = 400; Nref = 16; Nguard = 2; Pfa = 1e-3;
alpha_ca = @(N) N*(Pfa^(-1/N) - 1);       % CA 门限因子
alpha_os = 8;                              % OS 常用门限因子

%% 1) 杂波 + 目标
clutter = zeros(Ncell, 1);
clutter(1:200) = 1; clutter(201:end) = 30; % 杂波边缘
power = exprnd(clutter);                   % Rayleigh 幅度对应指数分布功率
targets = [80 60; 85 40; 300 25];
for i = 1:size(targets,1)
    power(targets(i,1)) = targets(i,2)*clutter(targets(i,1));
end

%% 2) 四种 CFAR
kinds = {'CA','GO','SO','OS'};
figure;
for i = 1:length(kinds)
    kind = kinds{i};
    thr = nan(Ncell, 1);
    for k = 1:Ncell
        lo = max(1, k-Nguard-Nref); hi = max(0, k-Nguard-1);
        r1 = max(k+Nguard+1, 1); r2 = min(Ncell, k+Nguard+Nref);
        left  = power(lo:max(hi,lo-1));
        right = power(r1:r2);
        if numel(left) < 2 || numel(right) < 2, continue; end
        switch kind
            case 'CA', est = mean([left; right]); thr(k) = alpha_ca(numel(left)+numel(right))*est;
            case 'GO', thr(k) = alpha_ca(numel(left))*max(mean(left), mean(right));
            case 'SO', thr(k) = alpha_ca(numel(left))*min(mean(left), mean(right));
            case 'OS', allref = sort([left; right]); thr(k) = alpha_os*allref(round(0.75*numel(allref)));
        end
    end
    det = power > thr;
    subplot(4,1,i); semilogy(power); hold on; semilogy(thr, 'r');
    plot(find(det), power(det), 'k*'); plot(targets(:,1), power(targets(:,1)), 'g^');
    legend('单元功率','自适应门限','检测','真目标'); grid on;
    title(sprintf('%s-CFAR', kind));
end
xlabel('距离单元');
`,
    see: 'cases/radar/cfar'
  });

  /* ==================================================================
     七、声呐（LOFAR / DEMON / 图像去噪 / 多普勒补偿）
     ================================================================== */

  add({
    id: 'passive-lofar-demon',
    cat: 'sonar',
    name: '被动声呐 LOFAR 谱与 DEMON 谱',
    desc: '对应网页「被动声呐谱检测与线谱提取」案例。合成一段含螺旋桨噪声的接收信号：宽带连续谱 + 轴频谐波线谱 + 叶频调制的包络起伏。LOFAR 看的是"载波"（几百 Hz 以上），DEMON 看的是"包络"（0~30 Hz），两者共同给出转速与叶片数。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import welch, butter, filtfilt, hilbert, resample_poly

rng = np.random.default_rng(3)
fs = 8000                      # 采样率 Hz
dur = 10.0                     # 观测时长 s
N = int(fs * dur)
t = np.arange(N) / fs

# ===== 1. 目标参数：轴频 7 Hz（420 rpm），4 叶桨 -> 叶频 28 Hz =====
shaft = 7.0
blades = 4
blade_rate = shaft * blades

# ===== 2. 宽带连续谱：白噪声经低通塑形（模拟螺旋桨空化噪声，能量集中在低频） =====
b, a = butter(4, 2000 / (fs / 2), btype='low')
x = filtfilt(b, a, rng.standard_normal(N))
x = x / np.std(x)

# ===== 3. 轴频及其谐波：机械振动产生的稳定线谱 =====
for h in range(1, 9):
    x += 0.35 / h * np.sin(2 * np.pi * shaft * h * t + rng.random() * 6.28)

# ===== 4. 叶频调制：目标本体的宽带噪声被桨叶周期性遮挡 -> 幅度调制 =====
mod = 1.0 + 0.45 * np.cos(2 * np.pi * blade_rate * t) + 0.2 * np.cos(2 * np.pi * 2 * blade_rate * t)
x = x * mod
x += 0.15 * rng.standard_normal(N)            # 海洋环境噪声

# ===== 5. LOFAR 谱：长时间平均的功率谱（显示线谱） =====
f_lo, P_lo = welch(x, fs=fs, window='hann', nperseg=8192, noverlap=4096, nfft=16384)
# ===== 6. DEMON 谱：先取宽带包络，再对包络做谱分析 =====
bb = (x - np.mean(x))
env = np.abs(hilbert(bb))
env = env - np.mean(env)
# 包络的有效带宽只有几十 Hz，直接降采样到 200 Hz，减少计算量
fs_env = 200
env_ds = resample_poly(env, 1, fs // fs_env)
f_de, P_de = welch(env_ds, fs=fs_env, window='hann', nperseg=2048, noverlap=1024, nfft=4096)

plt.figure(figsize=(10, 8))
plt.subplot(3, 1, 1)
plt.specgram(x, NFFT=1024, Fs=fs, noverlap=512, cmap='viridis')
plt.title('瀑布图（LOFARGRAM）：横轴时间、纵轴频率，水平亮线就是线谱')
plt.ylabel('频率 / Hz'); plt.ylim(0, 2000)

plt.subplot(3, 1, 2)
plt.semilogx(f_lo, 10 * np.log10(P_lo + 1e-20), lw=0.9)
for h in range(1, 9):
    plt.axvline(shaft * h, color='r', ls=':', lw=0.6)
plt.xlim(5, 3000); plt.xlabel('频率 / Hz'); plt.ylabel('dB/Hz')
plt.title('LOFAR 谱：轴频 %g Hz 的前 8 次谐波清晰可见' % shaft)

plt.subplot(3, 1, 3)
plt.plot(f_de, 10 * np.log10(P_de / P_de.max() + 1e-20), lw=1.0)
plt.axvline(blade_rate, color='r', ls='--', label='叶频 %g Hz' % blade_rate)
plt.axvline(shaft, color='g', ls='--', label='轴频 %g Hz' % shaft)
plt.xlim(0, 60); plt.legend(fontsize=8); plt.grid(alpha=0.3)
plt.xlabel('包络频率 / Hz'); plt.ylabel('归一化 dB')
plt.title('DEMON 谱：包络频率给出桨叶通过频率')
plt.tight_layout(); plt.show()

print('轴频 = %g Hz（%.0f rpm），叶频 = %g Hz -> 推算叶片数 = %d'
      % (shaft, shaft * 60, blade_rate, round(blade_rate / shaft)))
`,
    ml: `%% MATLAB —— LOFAR 与 DEMON 谱（需要 Signal Processing Toolbox）
clear; clc; close all;

rng(3);
fs = 8000; dur = 10; N = fs*dur;
t = (0:N-1)/fs;
shaft = 7; blades = 4; blade_rate = shaft*blades;

%% 1) 宽带连续谱（低通塑形）
[b, a] = butter(4, 2000/(fs/2), 'low');
x = filtfilt(b, a, randn(1, N));
x = x/std(x);

%% 2) 轴频谐波
for h = 1:8
    x = x + 0.35/h*sin(2*pi*shaft*h*t + rand*6.28);
end

%% 3) 叶频调制 + 海洋环境噪声
mod = 1 + 0.45*cos(2*pi*blade_rate*t) + 0.2*cos(2*pi*2*blade_rate*t);
x = x.*mod + 0.15*randn(1, N);

%% 4) LOFAR 谱
[P_lo, f_lo] = pwelch(x, hann(8192), 4096, 16384, fs);
%% 5) DEMON 谱：取包络 -> 降采样 -> 谱分析
env = abs(hilbert(x - mean(x)));
env = env - mean(env);
fs_env = 200;
env_ds = resample(env, fs_env, fs);
[P_de, f_de] = pwelch(env_ds, hann(2048), 1024, 4096, fs_env);

subplot(3,1,1); spectrogram(x, 1024, 512, 1024, fs, 'yaxis');
title('瀑布图（LOFARGRAM）'); ylim([0 2]);
subplot(3,1,2); semilogx(f_lo, 10*log10(P_lo+1e-20)); hold on;
for h = 1:8, xline(shaft*h, 'r:'); end
xlim([5 3000]); xlabel('频率 / Hz'); ylabel('dB/Hz'); title('LOFAR 谱');
subplot(3,1,3); plot(f_de, 10*log10(P_de/max(P_de)+1e-20)); hold on;
xline(blade_rate, 'r--'); xline(shaft, 'g--'); xlim([0 60]); grid on;
legend('DEMON', '叶频', '轴频'); xlabel('包络频率 / Hz'); title('DEMON 谱');

fprintf('轴频 = %g Hz（%.0f rpm），叶频 = %g Hz -> 叶片数 = %d\\n', ...
        shaft, shaft*60, blade_rate, round(blade_rate/shaft));
`,
    see: 'cases/sonar/passive'
  });

  add({
    id: 'mbes-despeckle',
    cat: 'sonar',
    name: '侧扫/多波束图像斑点去噪：中值、多视与小波',
    desc: '对应网页「多波束测深与侧扫图像去噪」案例。先给干净底质图乘上 Rayleigh 斑点噪声，再用 3×3 中值滤波、2×2 多视平均、Haar 小波软阈值三种方法去噪，用等效视数 ENL（斑点抑制能力）与边缘保持度两个指标定量比较。',
    py: `import numpy as np
import matplotlib.pyplot as plt
from scipy.ndimage import median_filter, uniform_filter

rng = np.random.default_rng(8)
H, W = 256, 256

# ===== 1. 构造"真实"底质：平缓背景 + 两条明暗条带 + 一块方形目标 =====
yy, xx = np.mgrid[0:H, 0:W]
truth = 0.5 + 0.15 * np.sin(2 * np.pi * yy / 60)
truth[80:100, :] += 0.25
truth[150:175, 60:200] -= 0.3
truth = np.clip(truth, 0.05, None)
truth[40:70, 40:70] = 1.2                      # 一块强反射目标
truth = np.clip(truth, 0.05, None)

# ===== 2. 斑点噪声：单视 SAR/侧扫的强度服从指数分布（幅度 Rayleigh） =====
L0 = 1
speckle = rng.exponential(1.0, size=truth.shape)
noisy = truth * speckle

def enl(patch):
    """等效视数 ENL = μ²/σ²：越大说明斑点越被平滑"""
    return np.mean(patch) ** 2 / np.var(patch)

def edge_keep(rec):
    """边缘保持度：重建图梯度与真值梯度的相关系数，越接近 1 越好"""
    gy, gx = np.gradient(truth)
    ry, rx = np.gradient(rec)
    return np.corrcoef(np.concatenate([gx.ravel(), gy.ravel()]),
                       np.concatenate([rx.ravel(), ry.ravel()]))[0, 1]

# ===== 3. 方法一：3×3 中值滤波（保护边缘、抑制孤立亮点） =====
med = median_filter(noisy, size=3)
# ===== 4. 方法二：2×2 多视平均（牺牲分辨率换 ENL） =====
look = uniform_filter(noisy, size=2)
# ===== 5. 方法三：单层 Haar 小波软阈值 =====
def haar2(a):
    """单层 2D Haar 分解，返回 LL 与三个高频子带"""
    L = (a[:, 0::2] + a[:, 1::2]) / np.sqrt(2)
    Hh = (a[:, 0::2] - a[:, 1::2]) / np.sqrt(2)
    LL = (L[0::2, :] + L[1::2, :]) / np.sqrt(2)
    LH = (L[0::2, :] - L[1::2, :]) / np.sqrt(2)
    HL = (Hh[0::2, :] + Hh[1::2, :]) / np.sqrt(2)
    HH = (Hh[0::2, :] - Hh[1::2, :]) / np.sqrt(2)
    return LL, (LH, HL, HH)

def ihaar2(LL, sub):
    LH, HL, HH = sub
    L = np.zeros((LL.shape[0] * 2, LL.shape[1]))
    L[0::2, :] = (LL + LH) / np.sqrt(2)
    L[1::2, :] = (LL - LH) / np.sqrt(2)
    Hh = np.zeros((LL.shape[0] * 2, LL.shape[1]))
    Hh[0::2, :] = (HL + HH) / np.sqrt(2)
    Hh[1::2, :] = (HL - HH) / np.sqrt(2)
    out = np.zeros((LL.shape[0] * 2, LL.shape[1] * 2))
    out[:, 0::2] = (L + Hh) / np.sqrt(2)
    out[:, 1::2] = (L - Hh) / np.sqrt(2)
    return out

def soft(x, th):
    return np.sign(x) * np.maximum(np.abs(x) - th, 0.0)

LL, sub = haar2(np.log(noisy + 1e-6))            # 对数变换把乘性噪声变成加性
# 噪声标准差估计：用最高频子带的中位数绝对值 / 0.6745
sigma = np.median(np.abs(sub[2])) / 0.6745
thr = sigma * np.sqrt(2 * np.log(LL.size))
sub_t = tuple(soft(s, thr) for s in sub)
wl = np.exp(ihaar2(LL, sub_t)) - 1e-6

methods = [('含噪图像', noisy), ('3×3 中值', med), ('2×2 多视', look), ('小波软阈值', wl)]
plt.figure(figsize=(10, 8))
for i, (name, img) in enumerate(methods, 1):
    plt.subplot(2, 2, i)
    plt.imshow(img, cmap='gray', vmin=0, vmax=1.3)
    plt.title(name); plt.axis('off')
plt.tight_layout(); plt.show()

patch = (slice(10, 60), slice(10, 60))           # 均匀区，用于统计 ENL
print('%-12s %-10s %-10s' % ('方法', 'ENL', '边缘保持度'))
for name, img in methods:
    print('%-12s %-10.2f %-10.3f' % (name, enl(img[patch]), edge_keep(img)))
print('结论：多视最平滑但最糊；中值保边最好但 ENL 提升有限；小波折中，且可以通过层数与阈值调节。')
`,
    ml: `%% MATLAB —— 侧扫图像斑点去噪（需要 Image Processing Toolbox / Wavelet Toolbox）
clear; clc; close all;

rng(8);
H = 256; W = 256;
[yy, xx] = meshgrid(1:W, 1:H);
truth = 0.5 + 0.15*sin(2*pi*yy/60);
truth(80:100, :) = truth(80:100, :) + 0.25;
truth(150:175, 60:200) = truth(150:175, 60:200) - 0.3;
truth(40:70, 40:70) = 1.2;
truth = max(truth, 0.05);

%% 斑点噪声（强度服从指数分布）
noisy = truth.*exprnd(1, size(truth));

%% 三种去噪方法
med  = medfilt2(noisy, [3 3]);                       % 中值滤波
kernel = ones(2)/4; look = imfilter(noisy, kernel);  % 多视平均
% 小波软阈值（Wavelet Toolbox）
[C, S] = wavedec2(log(noisy+1e-6), 2, 'haar');
detcoef = detcoef2('all', C, S, 2);
sigma = median(abs(detcoef))/0.6745;
thr = sigma*sqrt(2*log(H*W));
C2 = wthresh(C, 's', thr);
wl = exp(waverec2(C2, S, 'haar')) - 1e-6;

%% 指标
imgs = {noisy, med, look, wl}; names = {'含噪图像','3×3 中值','2×2 多视','小波软阈值'};
figure;
for i = 1:4
    subplot(2,2,i); imshow(imgs{i}, [0 1.3]); title(names{i}); colormap gray;
    patch = imgs{i}(10:60, 10:60);
    enlv = mean(patch(:))^2/var(patch(:));
    fprintf('%-12s ENL = %.2f\\n', names{i}, enlv);
end
`,
    see: 'cases/sonar/mbes'
  });

  add({
    id: 'doppler-comp-pulse-integration',
    cat: 'sonar',
    name: '多普勒补偿与脉冲串积累：跨距离走动怎么办',
    desc: '对应网页「水下多普勒补偿与回波积累」案例。目标在相参处理间隔内移动了若干个距离分辨单元，直接相参积累会把能量涂抹成一串；先做距离对齐（包络相关）再补偿多普勒相位，才能真正拿到 10log10(Np) 的积累增益。',
    py: `import numpy as np
import matplotlib.pyplot as plt
rng = np.random.default_rng(21)
c = 1500.0                       # 水中声速 m/s
fs = 100000.0                    # 采样率 Hz
T_win = 0.05                     # 每个脉冲的接收窗长度 s
Nw = int(T_win * fs)
Np = 32                          # 脉冲数
PRF = 20.0                       # 脉冲重复频率 Hz（fd 必须小于 PRF/2 才不模糊）
Tr = 1.0 / PRF
v = 0.6                          # 目标径向速度 m/s
f0 = 8000.0                      # 发射频率 Hz
lam = c / f0                     # 波长 0.1875 m
fd = 2 * v / lam                 # 多普勒频率 = 6.4 Hz < PRF/2 = 10 Hz，满足采样定理
tau = 0.2e-3                     # CW 脉冲宽度 s -> 距离分辨率 c·tau/2 = 0.15 m
dR = c * tau / 2
print('目标速度 %.2f m/s -> 多普勒 %.2f Hz；每帧走动 %.3f m = %.2f 个距离分辨单元'
      % (v, fd, v * Tr, v * Tr / dR))

# 单脉冲回波的解析信号：高斯包络 × 载波
t_win = np.arange(Nw) / fs
env = np.exp(-((t_win - T_win / 2) ** 2) / (2 * (tau / 3) ** 2))
pulse = env * np.exp(1j * 2 * np.pi * f0 * t_win)

def build(doppler=True, moving=True):
    """构造回波矩阵：行 = 脉冲，列 = 距离样点"""
    cube = np.zeros((Np, Nw), dtype=complex)
    for p in range(Np):
        # 走动：每帧比上一帧晚 2vTr/c 秒到达，折算成样点数
        dp = int(round(2 * v * Tr * p / c * fs)) if moving else 0
        cube[p, :] = np.roll(pulse, dp)
        if doppler:
            # 多普勒：整段回波附加随脉冲线性增长的相位 exp(+j·2π·fd·p·Tr)
            cube[p, :] = cube[p, :] * np.exp(1j * 2 * np.pi * fd * p * Tr)
    return cube

rx_clean = build(doppler=True, moving=True)
rx = rx_clean + 0.25 * (rng.standard_normal(rx_clean.shape)
                        + 1j * rng.standard_normal(rx_clean.shape)) / np.sqrt(2)

def integrate_coherent(mat):
    """直接跨脉冲相参求和（不做补偿）：距离走动 + 相位旋转会让增益大打折扣"""
    return np.sum(mat, axis=0)

def integrate_align(mat):
    """先用包络互相关对齐距离，再逐脉冲补偿多普勒相位，最后相参积累"""
    ref_env = np.abs(mat[0])
    out = np.zeros(mat.shape[1], dtype=complex)
    for p in range(mat.shape[0]):
        corr = np.correlate(np.abs(mat[p]), ref_env, mode='same')
        lag = np.argmax(corr) - (len(ref_env) // 2)
        aligned = np.roll(mat[p], -lag)                      # 距离对齐
        out += aligned * np.exp(-1j * 2 * np.pi * fd * p * Tr)  # 相位补偿
    return out

def integrate_noncoherent(mat):
    """非相参积累：先取包络再累加，不需要相位信息，增益低于相参但更稳健"""
    return np.sum(np.abs(mat), axis=0)

def snr_out(sig):
    pk = np.max(np.abs(sig))
    med = np.median(np.abs(sig))
    return 20 * np.log10(pk / med + 1e-12)

results = [
    ('单脉冲（基准）', np.abs(rx[0])),
    ('直接相参积累', np.abs(integrate_coherent(rx))),
    ('对齐 + 补偿后积累', np.abs(integrate_align(rx))),
    ('非相参积累', integrate_noncoherent(rx)),
]
plt.figure(figsize=(9, 7))
for i, (name, y) in enumerate(results, 1):
    plt.subplot(4, 1, i)
    plt.plot(np.abs(y), lw=1.0)
    plt.title('%s：峰值/中位 = %.1f dB' % (name, snr_out(np.abs(y))))
    plt.ylabel('幅度'); plt.grid(alpha=0.3)
plt.xlabel('距离样点'); plt.tight_layout(); plt.show()

print('理论上完全对齐且补偿后，积累增益 = 10log10(Np) = %.1f dB' % (10 * np.log10(Np)))
print('非相参积累的增益明显更低，但它不需要知道多普勒相位，工程上更稳健。')
`,
    ml: `%% MATLAB —— 多普勒补偿与脉冲串积累（需要 Signal Processing Toolbox）
clear; clc; close all;

rng(21);
c = 1500; fs = 100000; T_win = 0.05; Nw = round(T_win*fs);
Np = 32; PRF = 20; Tr = 1/PRF; v = 0.6; f0 = 8000; lam = c/f0; fd = 2*v/lam;
tau = 0.2e-3; dR = c*tau/2;
fprintf('目标速度 %.2f m/s -> 多普勒 %.2f Hz，每帧走动 %.2f 个距离分辨单元\\n', ...
        v, fd, v*Tr/dR);

t_win = (0:Nw-1)/fs;
env = exp(-((t_win-T_win/2).^2)/(2*(tau/3)^2));
pulse = env.*exp(1j*2*pi*f0*t_win);      % 解析信号形式的回波

%% 构造回波矩阵：整体平移（距离走动）+ 多普勒相位步进
rx = zeros(Np, Nw);
for p = 0:Np-1
    dp = round(2*v*Tr*p/c*fs);
    rx(p+1, :) = circshift(pulse, dp).*exp(1j*2*pi*fd*p*Tr);
end
rx = rx + 0.25*(randn(Np, Nw)+1j*randn(Np, Nw))/sqrt(2);

%% 三种积累方式
coh  = abs(sum(rx, 1));                  % 直接相参求和
ncoh = sum(abs(rx), 1);                  % 非相参积累
ref = abs(rx(1, :)); acc = zeros(1, Nw);
for p = 1:Np
    [c1, lags] = xcov(abs(rx(p, :)), ref);
    [~, im] = max(c1);
    lag = lags(im);
    acc = acc + circshift(rx(p, :), -lag).*exp(-1j*2*pi*fd*(p-1)*Tr);
end
acc = abs(acc);

subplot(4,1,1); plot(abs(rx(1,:))); title('单脉冲（基准）');
subplot(4,1,2); plot(coh); title('直接相参积累（跨距离走动导致能量涂抹）');
subplot(4,1,3); plot(acc); title('距离对齐 + 多普勒补偿后积累');
subplot(4,1,4); plot(ncoh); title('非相参积累');
xlabel('距离样点');
fprintf('理论积累增益 = 10log10(Np) = %.1f dB\\n', 10*log10(Np));
`,
    see: 'cases/sonar/doppler'
  });

  /* @@INSERT@@ */

  /* ============================================================
     索引与检索
     ============================================================ */
  const byId = Object.create(null);
  items.forEach(function (it) { byId[it.id] = it; });

  /** 按 id 取一条 */
  function by(id) { return byId[id] || null; }

  /** 分类计数 */
  function count(cat) {
    return items.filter(function (it) { return !cat || it.cat === cat; }).length;
  }

  /**
   * 检索：关键词同时匹配「标题 / 说明 / Python 代码 / MATLAB 代码」
   * @returns {Array} 命中的示例数组
   */
  function search(q, cat) {
    const s = String(q || '').trim().toLowerCase();
    return items.filter(function (it) {
      if (cat && cat !== 'all' && it.cat !== cat) return false;
      if (!s) return true;
      return (it.name && it.name.toLowerCase().indexOf(s) >= 0) ||
        (it.desc && it.desc.toLowerCase().indexOf(s) >= 0) ||
        (it.id && it.id.toLowerCase().indexOf(s) >= 0) ||
        (it.py && it.py.toLowerCase().indexOf(s) >= 0) ||
        (it.ml && it.ml.toLowerCase().indexOf(s) >= 0);
    });
  }

  DSP.codeLib = {
    items: items,
    cats: CATS,
    by: by,
    search: search,
    count: count,
    catName: function (id) {
      const c = CATS.filter(function (x) { return x.id === id; })[0];
      return c ? c.name : id;
    }
  };
})(window);

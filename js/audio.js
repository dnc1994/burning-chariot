/* 燃烧战车 — 合成音效（不依赖任何外部音频文件）
 *
 * 声音跟画面是一套：画面是鞭炮包装纸，声音就是「锣鼓 + 鞭炮」。
 *   · 界面的点按是梆子；轮到你是小锣（音往上挑），击破是大锣（音往下坠）
 *   · 喝彩是镲；捡东西、拿金币是碰铃；胜负是一段锣鼓点配五声音阶
 *   · 爆炸 = 一声鼓 + 一道炸裂 + 一串噼里啪啦的鞭炮尾巴
 *   · 蓄力不是一根越来越尖的音，而是越敲越密、越敲越高的鼓点
 * 全部用振荡器和噪声现场合成。加新声音时先看下面那几件「乐器」，尽量拿它们拼。
 */
(function (RZ) {
  'use strict';

  var ctx = null, out = null, noiseBuf = null, muted = false;
  var gates = {};                 // 每种声音上一次响的时间，用来防止同一帧里叠十几遍
  var charge = { on: false, last: 0 };

  function makeNoise(c) {
    var len = Math.floor(c.sampleRate * 1.5);
    var buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 总线：总音量 → 压限器 → 输出。好几发炮弹同时落地时靠压限器兜住，不爆音 */
  function wire(c) {
    var g = c.createGain();
    g.gain.value = 0.7;
    var comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    g.connect(comp); comp.connect(c.destination);
    return g;
  }

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = wire(ctx);
    noiseBuf = makeNoise(ctx);
    return ctx;
  }
  function ready() { return !muted && !!ensure(); }

  /** 同一种声音在 sec 秒内只响一次 */
  function gate(name, sec) {
    var t = ctx.currentTime;
    if (gates[name] != null && t - gates[name] < sec && t >= gates[name]) return false;
    gates[name] = t;
    return true;
  }
  /** 每次都差一点点，连着响才不像复读机 */
  function vary(x, amt) { return x * (1 + (Math.random() * 2 - 1) * (amt || 0.04)); }

  // ================= 两块积木：一个振荡器音、一段滤过的噪声 =================
  /** 一个音：f0 滑到 f1（glide 秒内滑完，默认整段），a 秒起音，之后指数衰减到 dur */
  function osc(type, f0, f1, t, dur, vol, glide, a) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    a = a || 0.004;
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (glide || dur));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + a + dur + 0.03);
  }
  /** 一段噪声：过一个从 f0 扫到 f1 的滤波器 */
  function hit(t, dur, vol, type, f0, f1, q) {
    var s = ctx.createBufferSource(); s.buffer = noiseBuf;
    var f = ctx.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    if (q) f.Q.value = q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.03);
  }

  // ================= 乐器 =================
  /** 梆子：又短又脆的一声木头 */
  function block(t, f, vol) {
    osc('sine', f, f * 0.82, t, 0.05, vol);
    osc('triangle', f * 2.7, f * 2.7, t, 0.022, vol * 0.5);
    hit(t, 0.018, vol * 0.5, 'bandpass', f * 2, f * 2, 2);
  }
  /** 鼓：音高一落到底的「咚」 */
  function drum(t, f, vol, dur) {
    osc('sine', f * 1.9, f, t, dur, vol, 0.05);
    osc('triangle', f * 2.6, f * 1.3, t, dur * 0.4, vol * 0.25, 0.04);
    hit(t, 0.045, vol * 0.5, 'lowpass', 1100, 200);
  }
  /**
   * 锣：几个不成倍数的分音一起响，音高整体滑动。
   * bend > 0 往上挑（小锣「锵~」），bend < 0 往下坠（大锣「哐……」）。
   */
  var GONG = [1, 1.48, 2.09, 2.76, 3.9], GONG_AMP = [1, 0.6, 0.45, 0.3, 0.2];
  function gong(t, f, vol, dur, bend) {
    var from = bend > 0 ? 0.9 : 1.07, to = bend > 0 ? 1.04 : 0.93, slide = bend > 0 ? 0.22 : 0.5;
    for (var i = 0; i < GONG.length; i++) {
      osc('sine', f * GONG[i] * from, f * GONG[i] * to, t, dur / (1 + i * 0.45), vol * GONG_AMP[i] * 0.55, slide, 0.006);
    }
    hit(t, 0.035, vol * 0.5, 'bandpass', f * 4.2, f * 3, 1.2);
  }
  /** 镲：一片亮闪闪的金属噪声 */
  function cymbal(t, vol, dur) {
    hit(t, dur, vol, 'highpass', 5200, 3200);
    hit(t, dur * 0.6, vol * 0.7, 'bandpass', 7400, 6000, 1);
    var p = [2310, 3170, 4120, 5390];
    for (var i = 0; i < p.length; i++) osc('square', p[i], p[i], t, dur * 0.7, vol * 0.06);
  }
  /** 碰铃：清亮的一声「叮」 */
  function bell(t, f, vol, dur) {
    osc('sine', f, f, t, dur, vol, 0, 0.003);
    osc('sine', f * 2.76, f * 2.76, t, dur * 0.5, vol * 0.4, 0, 0.003);
    osc('sine', f * 5.4, f * 5.4, t, dur * 0.25, vol * 0.2, 0, 0.003);
  }
  /** 扬琴似的一拨：两根稍微跑调的弦 */
  function pluck(t, f, vol, dur) {
    osc('triangle', f, f, t, dur, vol);
    osc('triangle', f * 1.004, f * 1.004, t, dur, vol * 0.8);
    osc('square', f * 2, f * 2, t, dur * 0.35, vol * 0.12);
  }
  /** 一个鞭炮：一下极短的炸裂 */
  function pop(t, vol) {
    hit(t, 0.016 + Math.random() * 0.02, vol, 'highpass', 2400 + Math.random() * 2600, 1800);
    osc('sine', 230, 90, t, 0.035, vol * 0.5);
  }
  /** 一串鞭炮：n 个，散在 span 秒里 */
  function crackle(t, n, span, vol) {
    for (var i = 0; i < n; i++) pop(t + Math.random() * span, vol * (0.4 + Math.random() * 0.6));
  }

  // 五声音阶，够用了
  var A4 = 440, C5 = 523, D5 = 587, E5 = 659, G5 = 784, A5 = 880, C6 = 1047, D6 = 1175, E6 = 1319;

  // ================= 一个个声音 =================
  // 每个都是 function (t, 参数…)，t 是开始时间。下面统一包一层「静音 / 没有音频环境就不响」。
  var SOUNDS = {
    click: function (t) { block(t, 1050, 0.36); },
    aim: function (t) { block(t, 1500, 0.16); },
    tick: function (t) { block(t, 1800, 0.34); block(t, 900, 0.2); },
    move: function (t) {                       // 车轮「咕噜」一下
      if (!gate('move', 0.07)) return;
      hit(t, 0.05, 0.14, 'lowpass', 520, 200);
      block(t, vary(320, 0.1), 0.1);
    },

    fire: function (t) {                       // 「嗵」一声出膛，后面拖一道嗤
      drum(t, 85, 0.75, 0.22);
      hit(t, 0.25, 0.3, 'bandpass', 600, 3200, 0.8);
      pop(t, 0.32);
    },
    explode: function (t, big) {               // 鼓 + 炸裂 + 鞭炮尾巴
      if (!gate('explode', 0.04)) return;
      drum(t, vary(big ? 48 : 62), big ? 0.85 : 0.65, big ? 0.8 : 0.45);
      hit(t, big ? 0.5 : 0.3, big ? 0.45 : 0.32, 'lowpass', big ? 2600 : 3200, 120);
      crackle(t + 0.05, big ? 9 : 5, big ? 0.55 : 0.32, big ? 0.22 : 0.18);
    },
    bounce: function (t) { block(t, vary(700, 0.08), 0.32); osc('sine', 500, 300, t, 0.06, 0.16); },
    thunder: function (t) {
      hit(t, 0.12, 0.6, 'highpass', 3000, 1500);
      hit(t + 0.03, 1.1, 0.45, 'lowpass', 900, 60);
      cymbal(t, 0.25, 0.7);
      drum(t + 0.02, 40, 0.5, 0.9);
    },
    hurt: function (t) {                       // 闷闷的一下，带一点铁皮声
      if (!gate('hurt', 0.06)) return;
      drum(t, vary(120, 0.08), 0.5, 0.12);
      osc('square', vary(420, 0.08), 300, t, 0.05, 0.1);
    },
    ko: function (t) {                         // 大锣一声「哐」，往下坠
      gong(t, 196, 0.5, 1.6, -1);
      drum(t, 45, 0.6, 0.7);
      crackle(t + 0.1, 8, 0.6, 0.2);
    },
    fall: function (t) {                       // 掉出地图：一声往下滑的哨
      osc('sine', 1150, 170, t, 0.7, 0.24, 0.7, 0.02);
      osc('triangle', 1160, 172, t, 0.7, 0.06, 0.7, 0.02);
    },
    fuse: function (t) {                       // 油桶点着了：「嗤——」
      if (!gate('fuse', 0.05)) return;
      hit(t, 0.22, 0.2, 'highpass', 3000, 7000);
    },

    pickup: function (t) { bell(t, 1568, 0.16, 0.3); bell(t + 0.09, 2093, 0.16, 0.45); },
    supply: function (t) { bell(t, E6, 0.18, 0.35); },
    coin: function (t) { bell(t, 2093, 0.14, 0.18); bell(t + 0.07, 2637, 0.14, 0.3); },
    heal: function (t) {
      if (!gate('heal', 0.15)) return;
      pluck(t, E5, 0.1, 0.18); pluck(t + 0.07, G5, 0.1, 0.18); pluck(t + 0.14, C6, 0.11, 0.3);
    },
    relic: function (t) {                      // 拿到遗物 / 改造：小锣起头，一串上行
      gong(t, 740, 0.2, 0.6, 1);
      [C5, E5, G5, C6].forEach(function (f, i) { pluck(t + 0.05 + i * 0.07, f, 0.14, 0.3); });
    },

    turn: function (t, mine) {                 // 轮到你：小锣「锵~」；轮到对面：两下闷鼓
      if (mine === false) { drum(t, 110, 0.22, 0.14); drum(t + 0.13, 95, 0.18, 0.14); return; }
      gong(t, 740, 0.34, 0.7, 1);
      block(t, 900, 0.16);
    },
    stinger: function (t) {                    // 开战：咚、咚、锵！
      drum(t, 90, 0.4, 0.2); drum(t + 0.16, 90, 0.42, 0.2);
      cymbal(t + 0.32, 0.32, 0.6); gong(t + 0.32, 300, 0.3, 1.0, -1); drum(t + 0.32, 70, 0.4, 0.3);
    },
    cheer: function (t) {                      // 打得漂亮：一声镲，两个上行音
      cymbal(t, 0.2, 0.45);
      pluck(t, G5, 0.14, 0.2); pluck(t + 0.09, C6, 0.16, 0.35);
    },
    crit: function (t) { cymbal(t, 0.22, 0.25); bell(t, 2637, 0.14, 0.25); },
    revive: function (t) {
      osc('sine', 300, 1200, t, 0.4, 0.14, 0.4, 0.02);
      gong(t + 0.35, 740, 0.28, 0.8, 1); cymbal(t + 0.35, 0.2, 0.5);
    },
    overheat: function (t) {                   // 战场过热：大锣垫底，鼓点越敲越急
      gong(t, 147, 0.4, 1.8, -1);
      var at = 0;
      for (var i = 0; i < 7; i++) { drum(t + at, 80, 0.2 + i * 0.03, 0.1); at += 0.2 - i * 0.022; }
    },

    win: function (t) {                        // 咚咚锵 咚咚锵 …… 锵！配一句往上走的五声
      var beat = [[0, 'd'], [0.15, 'd'], [0.3, 'c'], [0.6, 'd'], [0.75, 'd'], [0.9, 'c']];
      beat.forEach(function (b) {
        if (b[1] === 'd') drum(t + b[0], 95, 0.36, 0.16);
        else { cymbal(t + b[0], 0.26, 0.28); gong(t + b[0], 620, 0.16, 0.4, 1); }
      });
      [[0, G5], [0.15, A5], [0.3, C6], [0.6, A5], [0.75, C6], [0.9, D6]].forEach(function (n) { pluck(t + n[0], n[1], 0.18, 0.28); });
      pluck(t + 1.2, E6, 0.24, 0.9); pluck(t + 1.2, C6, 0.16, 0.9);
      drum(t + 1.2, 70, 0.5, 0.4); cymbal(t + 1.2, 0.36, 0.9); gong(t + 1.2, 300, 0.32, 1.6, -1);
    },
    lose: function (t) {                       // 一句往下掉的五声，大锣收尾
      drum(t, 70, 0.4, 0.5);
      [[0, E5, 0.4], [0.3, D5, 0.4], [0.6, C5, 0.4], [0.9, A4, 1.1]].forEach(function (n) { pluck(t + n[0], n[1], 0.18, n[2]); });
      pluck(t + 0.9, A4 / 2, 0.1, 1.1);
      gong(t + 0.9, 165, 0.4, 2.0, -1);
    }
  };

  var SFX = {
    resume: function () { var c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    setMuted: function (m) { muted = m; if (m) SFX.stopCharge(); },
    isMuted: function () { return muted; },

    // 蓄力：鼓点。力度越大敲得越密、音越高、声越响——不看蓄力条也听得出蓄到哪了。
    // 没有常驻的振荡器，所以不存在「卡住一直响」这回事，stopCharge 只是把开关关掉。
    startCharge: function () {
      if (!ready()) return;
      charge.on = true; charge.last = 0;
    },
    updateCharge: function (p) {
      if (!charge.on || muted || !ctx) return;
      var t = ctx.currentTime, gap = 0.16 - 0.115 * (p / 100);
      if (t - charge.last < gap) return;
      charge.last = t;
      block(t, 300 + p * 7, 0.07 + p * 0.0009);
      osc('sine', (90 + p) * 1.8, 90 + p, t, 0.08, 0.06 + p * 0.0006, 0.04);
    },
    stopCharge: function () { charge.on = false; },

    /** 声音的名字清单，自检页用 */
    names: function () { return Object.keys(SOUNDS); },

    /**
     * 离线把一个声音渲染成 AudioBuffer（自检页用来量峰值、时长，不用真的出声）。
     * 临时把总线换成离线环境的，画完再换回来。
     */
    _offline: function (name, arg, seconds) {
      var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC || !SOUNDS[name]) return null;
      var oc = new OAC(1, Math.floor(44100 * (seconds || 3)), 44100);
      var keep = { ctx: ctx, out: out, noise: noiseBuf, gates: gates };
      ctx = oc; out = wire(oc); noiseBuf = makeNoise(oc); gates = {};
      try { SOUNDS[name](0.01, arg); }
      finally { ctx = keep.ctx; out = keep.out; noiseBuf = keep.noise; gates = keep.gates; }
      return oc.startRendering();
    }
  };

  // 对外的每个声音：静音或没有音频环境时什么都不做
  Object.keys(SOUNDS).forEach(function (name) {
    SFX[name] = function (arg) {
      if (!ready()) return;
      SOUNDS[name](ctx.currentTime, arg);
    };
  });

  RZ.SFX = SFX;
})(window.RZ || (window.RZ = {}));

/* 燃烧战车 — 绘制层：背景、战车造型、弹体、粒子特效
 *
 * 画风是「火花贴画」——老火柴盒 / 鞭炮包装纸那种套色印刷品：
 *   1. 所有东西都有一圈粗墨线（INK），里面是平涂的专色，不用渐变、不用发光叠加；
 *   2. 明暗靠「再叠一块更深的平涂」和网点来表达，而不是半透明过渡；
 *   3. 东西消失时是「缩小」而不是「淡出」——印刷品不会变透明。
 * 加新东西时照这三条画，画面才是一套。规则判断一律不放在这里。
 */
(function (RZ) {
  'use strict';

  var INK = '#1b1410';        // 墨：所有描边
  var PAPER = '#f1e2bd';      // 纸：最亮的颜色，代替纯白
  var RED = '#d8361f';        // 朱
  var YELLOW = '#f5b921';     // 黄
  var TAU = 6.2832;

  RZ.INK = INK; RZ.PAPER = PAPER;
  // 画布上的字全用美术字；字体还没加载完时自然退回系统黑体
  RZ.FONT = '"RZ Display","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

  // ================= 小工具 =================
  /** 给当前路径平涂 + 描墨线 */
  function ink(ctx, fill, lw) {
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = lw || 2.5; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.stroke();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
  }
  function disc(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function oval(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }
  /** 漫画爆炸星：n 个尖角，内外半径交替 */
  function star(ctx, x, y, rOut, rIn, n, rot) {
    ctx.beginPath();
    for (var i = 0; i < n * 2; i++) {
      var a = rot + i * Math.PI / n, r = i % 2 ? rIn : rOut;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }
  /** 描边字：先墨线后填色 */
  function inkText(ctx, s, x, y, fill, lw) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw || 4; ctx.strokeStyle = INK;
    ctx.strokeText(s, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
  }

  // ================= 粒子 =================
  function Particles() { this.list = []; this.texts = []; this.bursts = []; }

  Particles.prototype.add = function (p) { if (this.list.length < 900) this.list.push(p); };

  /**
   * 一次爆炸 = 一个漫画爆炸星 + 一圈烟团 + 飞溅的碎片。
   * colors 来自武器的弹体配色：[亮色, 主色, …]。
   */
  Particles.prototype.burst = function (x, y, r, colors) {
    this.bursts.push({
      x: x, y: y, r: r, life: 16, max: 16, rot: Math.random() * TAU, n: 9 + ((r / 12) | 0),
      c1: colors[1] || RED, c2: colors[0] || YELLOW
    });
    if (this.bursts.length > 24) this.bursts.shift();
    var n = Math.min(26, 8 + (r * 0.22) | 0), i;
    for (i = 0; i < n; i++) {                          // 碎片：带墨线的小方块
      var a = Math.random() * TAU, s = Math.random() * (r * 0.14) + 1.6;
      this.add({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.8,
        life: 20 + Math.random() * 22, max: 42, size: 3 + Math.random() * (r * 0.07),
        c: colors[(Math.random() * colors.length) | 0], grav: 0.12, kind: 'chip', rot: Math.random() * TAU
      });
    }
    var m = Math.min(12, 4 + (r * 0.1) | 0);
    for (i = 0; i < m; i++) {                          // 烟团：一坨连在一起的圆
      var a2 = Math.random() * TAU, d = Math.random() * r * 0.45;
      this.add({
        x: x + Math.cos(a2) * d, y: y + Math.sin(a2) * d,
        vx: Math.cos(a2) * 0.5, vy: Math.sin(a2) * 0.4 - 0.7,
        life: 30 + Math.random() * 26, max: 56, size: r * (0.2 + Math.random() * 0.2),
        c: i % 3 ? '#cbb994' : PAPER, grav: -0.012, kind: 'smoke'
      });
    }
  };

  Particles.prototype.debris = function (x, y, n, color) {
    n = Math.min(n, 16);
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, s = 1.5 + Math.random() * 5;
      this.add({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 30 + Math.random() * 30, max: 60, size: 3 + Math.random() * 4,
        c: color, grav: 0.22, kind: 'chip', rot: Math.random() * TAU
      });
    }
  };

  Particles.prototype.trailPuff = function (x, y, color) {
    this.add({
      x: x, y: y, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4 - 0.1,
      life: 14 + Math.random() * 10, max: 24, size: 3 + Math.random() * 2.5,
      c: color, grav: -0.004, kind: 'puff'
    });
  };

  Particles.prototype.text = function (x, y, str, color, big) {
    this.texts.push({ x: x, y: y, s: str, c: color, life: 62, max: 62, big: !!big });
  };

  Particles.prototype.update = function () {
    var l = this.list, j = 0, i;
    for (i = 0; i < l.length; i++) {
      var p = l[i];
      p.vy += p.grav; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.life--;
      if (p.life > 0) l[j++] = p;
    }
    l.length = j;
    var t = this.texts; j = 0;
    for (i = 0; i < t.length; i++) {
      t[i].y -= 0.62; t[i].life--;
      if (t[i].life > 0) t[j++] = t[i];
    }
    t.length = j;
    var b = this.bursts; j = 0;
    for (i = 0; i < b.length; i++) { if (--b[i].life > 0) b[j++] = b[i]; }
    b.length = j;
  };

  Particles.prototype.draw = function (ctx) {
    var l = this.list, i, p, k, r;
    ctx.save();
    // 烟团分两遍画：先把所有圆放大一圈涂成墨色，再涂本色——
    // 重叠的圆就只剩最外面一圈轮廓，看起来是一整朵云，而不是一堆圈圈。
    ctx.fillStyle = INK;
    ctx.beginPath();
    for (i = 0; i < l.length; i++) {
      p = l[i];
      if (p.kind !== 'smoke') continue;
      r = p.size * Math.min(1, p.life / p.max * 2.2);
      ctx.moveTo(p.x + r + 2.5, p.y); ctx.arc(p.x, p.y, r + 2.5, 0, TAU);
    }
    ctx.fill();
    for (i = 0; i < l.length; i++) {
      p = l[i];
      if (p.kind !== 'smoke') continue;
      r = p.size * Math.min(1, p.life / p.max * 2.2);
      ctx.fillStyle = p.c;
      disc(ctx, p.x, p.y, r); ctx.fill();
    }

    // 爆炸星：三层套色，头几帧猛地弹大，然后缩回去
    var b = this.bursts;
    for (i = 0; i < b.length; i++) {
      var o = b[i], age = o.max - o.life;
      var sc = age < 4 ? 0.55 + age * 0.17 : 1.15 * (o.life / (o.max - 4));
      r = o.r * 1.15 * Math.max(0.05, sc);
      star(ctx, o.x, o.y, r, r * 0.62, o.n, o.rot); ink(ctx, o.c1, 3);
      star(ctx, o.x, o.y, r * 0.72, r * 0.42, o.n, o.rot + 0.3); ctx.fillStyle = o.c2; ctx.fill();
      star(ctx, o.x, o.y, r * 0.4, r * 0.22, o.n - 2, o.rot + 0.6); ctx.fillStyle = PAPER; ctx.fill();
    }

    for (i = 0; i < l.length; i++) {
      p = l[i];
      if (p.kind === 'smoke') continue;
      k = Math.min(1, p.life / p.max * 2);            // 越到后面越小，而不是越淡
      if (p.kind === 'puff') {
        ctx.fillStyle = p.c;
        disc(ctx, p.x, p.y, p.size * k); ctx.fill();
        continue;
      }
      var s = p.size * k;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot + p.life * 0.2);
      ctx.fillStyle = INK; ctx.fillRect(-s / 2 - 1.5, -s / 2 - 1.5, s + 3, s + 3);
      ctx.fillStyle = p.c; ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.restore();
  };

  Particles.prototype.drawTexts = function (ctx) {
    var t = this.texts;
    ctx.save();
    ctx.textAlign = 'center';
    for (var i = 0; i < t.length; i++) {
      var o = t[i], age = o.max - o.life;
      var pop = age < 6 ? 0.6 + age * 0.08 : 1;
      var shrink = o.life < 10 ? o.life / 10 : 1;       // 收尾时缩小消失
      var px = Math.round((o.big ? 34 : 24) * pop * shrink);
      if (px < 6) continue;
      ctx.font = px + 'px ' + RZ.FONT;
      inkText(ctx, o.s, o.x, o.y, o.c, o.big ? 6 : 5);
    }
    ctx.restore();
  };

  RZ.Particles = Particles;

  // ================= 背景 =================
  // 每张图一套海报配色：三条硬边色带的天空、一个大圆（日 / 月 / 行星）、放射线、两层剪影。
  // 整张底图只在开局画一次存进离屏画布，之后每帧一次 drawImage。
  var POSTER = {
    dry:    { sky: ['#e2432a', '#f08a2c', '#f6cf6b'], disc: PAPER, far: '#b5482a', near: '#7d2f1f', kind: 'mesa' },
    sea:    { sky: ['#0d3f4c', '#17656b', '#2c8d85'], disc: '#5cc0ad', far: '#0f4a55', near: '#0a3540', kind: 'ruins' },
    sky:    { sky: ['#5db4dc', '#9dd6e6', '#f6e7bd'], disc: YELLOW, far: '#7fb9d6', near: '#5a9cc2', kind: 'isles' },
    star:   { sky: ['#17153a', '#2a2560', '#4d3c84'], disc: '#f08a2c', far: '#221e4f', near: '#15123a', kind: 'planet' },
    canyon: { sky: ['#3a0f14', '#8a2318', RED], disc: YELLOW, far: '#5a1a16', near: '#2a0c10', kind: 'volcano' }
  };

  function Background(mapDef) {
    this.map = mapDef;
    this.poster = POSTER[mapDef.id] || POSTER.dry;
    this.backdrop = null;
    this.clouds = [];
    this.motes = [];
    var i;
    for (i = 0; i < 9; i++) {
      this.clouds.push({ x: Math.random() * RZ.WORLD_W, y: 70 + Math.random() * 380, s: 0.6 + Math.random() * 1.1, v: 0.08 + Math.random() * 0.16 });
    }
    for (i = 0; i < 46; i++) {
      this.motes.push({ x: Math.random() * RZ.WORLD_W, y: Math.random() * RZ.WORLD_H, r: 2 + Math.random() * 3, v: 0.25 + Math.random() * 0.7, p: Math.random() * 6.28 });
    }
  }

  Background.prototype.update = function (t) {
    var m = this.map, i;
    if (m.clouds) for (i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i]; c.x += c.v; if (c.x > RZ.WORLD_W + 200) c.x = -200;
    }
    if (m.bubbles || m.embers) for (i = 0; i < this.motes.length; i++) {
      var o = this.motes[i]; o.y -= o.v; o.x += Math.sin(t * 0.002 + o.p) * 0.3;
      if (o.y < -10) { o.y = RZ.WORLD_H + 10; o.x = Math.random() * RZ.WORLD_W; }
    }
  };

  /** 两条色带交界处的网点过渡：下面那条的颜色往上「溅」几排越来越小的点 */
  function halftoneEdge(g, y, color, x0, x1) {
    g.fillStyle = color;
    for (var row = 0; row < 6; row++) {
      var r = 6.5 - row * 1.05, yy = y - 8 - row * 15, off = row % 2 ? 8 : 0;
      g.beginPath();
      for (var x = x0 + off; x < x1; x += 16) { g.moveTo(x + r, yy); g.arc(x, yy, r, 0, TAU); }
      g.fill();
    }
  }

  /** 一条带墨线的剪影山脊；fn(x) 给出每个 x 的高度 */
  function ridge(g, x0, x1, base, step, fn, fill) {
    g.beginPath();
    g.moveTo(x0, base + 900);
    for (var x = x0; x <= x1; x += step) g.lineTo(x, fn(x));
    g.lineTo(x1, base + 900);
    g.closePath();
    ink(g, fill, 3);
  }

  function cloudShape(g, x, y, r) {
    g.beginPath();
    g.arc(x, y, r * 0.55, Math.PI, 0);
    g.arc(x + r * 0.62, y + r * 0.1, r * 0.36, -Math.PI * 0.6, Math.PI * 0.5);
    g.lineTo(x - r * 0.7, y + r * 0.46);
    g.arc(x - r * 0.62, y + r * 0.12, r * 0.34, Math.PI * 0.5, Math.PI * 1.6);
    g.closePath();
  }

  Background.prototype.render = function (night) {
    var W = RZ.WORLD_W, H = RZ.WORLD_H, P = this.poster, pad = 400;
    var c = document.createElement('canvas');
    c.width = W + pad * 2; c.height = H + pad * 2;
    var g = c.getContext('2d');
    if (!g || !g.drawImage) return null;
    g.translate(pad, pad);
    var x0 = -pad, x1 = W + pad, i;

    // 天空：三条硬边色带 + 交界处的网点
    var b1 = H * 0.34, b2 = H * 0.6;
    g.fillStyle = P.sky[0]; g.fillRect(x0, -pad, x1 - x0, b1 + pad);
    g.fillStyle = P.sky[1]; g.fillRect(x0, b1, x1 - x0, b2 - b1);
    g.fillStyle = P.sky[2]; g.fillRect(x0, b2, x1 - x0, H + pad - b2);
    halftoneEdge(g, b1, P.sky[1], x0, x1);
    halftoneEdge(g, b2, P.sky[2], x0, x1);
    if (night > 0) {                                   // 夜晚：只把天空压一层靛蓝专色，日月和剪影照旧鲜亮
      g.globalAlpha = night * 0.55;
      g.fillStyle = '#141a44';
      g.fillRect(x0, -pad, x1 - x0, H + pad * 2);
      g.globalAlpha = 1;
    }

    // 大圆与放射线：每张图的「图眼」
    var cx = W * 0.5, cy = H * 0.56, R = 150;
    if (P.kind === 'planet') { cx = W * 0.72; cy = H * 0.3; R = 120; }
    if (P.kind === 'ruins') { cx = W * 0.5; cy = -80; R = 0; }
    if (P.kind === 'isles') { cx = W * 0.24; cy = H * 0.22; R = 86; }
    if (P.kind !== 'planet') {
      g.save();
      g.globalAlpha = P.kind === 'ruins' ? 0.16 : 0.22;
      g.fillStyle = PAPER;
      var rays = P.kind === 'ruins' ? 9 : 18, a0 = P.kind === 'ruins' ? 0.25 : 0, span = P.kind === 'ruins' ? Math.PI * 0.5 : TAU;
      for (i = 0; i < rays; i++) {
        var ra = a0 + i / rays * span, rw = span / rays * 0.5;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(ra) * 3000, cy + Math.sin(ra) * 3000);
        g.lineTo(cx + Math.cos(ra + rw) * 3000, cy + Math.sin(ra + rw) * 3000);
        g.closePath(); g.fill();
      }
      g.restore();
    }
    if (R) {
      disc(g, cx, cy, R); ink(g, P.disc, 4);
      if (P.kind === 'planet') {                      // 行星环 + 几颗印刷星
        g.save();
        g.translate(cx, cy); g.rotate(-0.35);
        g.beginPath(); g.ellipse(0, 0, R * 1.75, R * 0.34, 0, 0, TAU);
        g.lineWidth = 16; g.strokeStyle = INK; g.stroke();
        g.lineWidth = 9; g.strokeStyle = PAPER; g.stroke();
        g.beginPath(); g.arc(0, 0, R, Math.PI, 0); g.closePath(); ink(g, P.disc, 4);
        g.fillStyle = '#c96a1c'; g.beginPath(); g.ellipse(0, -R * 0.45, R * 0.72, R * 0.1, 0, 0, TAU); g.fill();
        g.restore();
      }
    }
    if (P.kind === 'planet' || night > 0.5) {
      for (i = 0; i < 70; i++) {
        var sx = x0 + Math.random() * (x1 - x0), sy = -pad * 0.4 + Math.random() * H * 0.75, sr = 3 + Math.random() * 6;
        star(g, sx, sy, sr, sr * 0.32, 4, 0); g.fillStyle = PAPER; g.fill();
      }
    }

    // 两层剪影
    var seed = Math.random() * 100;
    if (P.kind === 'mesa') {
      ridge(g, x0, x1, H, 40, function (x) {
        var s = Math.sin(x * 0.004 + seed);
        return H * 0.6 - (s > 0.25 ? 90 : s > -0.3 ? 30 : 0) + Math.sin(x * 0.05) * 3;
      }, P.far);
      ridge(g, x0, x1, H, 50, function (x) {
        var s = Math.sin(x * 0.0027 + seed * 2);
        return H * 0.72 - (s > 0.4 ? 70 : 0) + Math.sin(x * 0.03) * 4;
      }, P.near);
    } else if (P.kind === 'ruins') {
      for (i = 0; i < 16; i++) {                      // 断柱
        var px = x0 + (i + Math.random() * 0.6) * ((x1 - x0) / 16), ph = 130 + Math.random() * 260, pw = 34 + Math.random() * 26;
        g.beginPath(); g.rect(px, H * 0.78 - ph, pw, ph + 400); ink(g, i % 2 ? P.far : P.near, 3);
        g.beginPath(); g.rect(px - 8, H * 0.78 - ph - 14, pw + 16, 14); ink(g, i % 2 ? P.far : P.near, 3);
      }
      ridge(g, x0, x1, H, 60, function (x) { return H * 0.8 + Math.sin(x * 0.006 + seed) * 26; }, P.near);
    } else if (P.kind === 'isles') {
      for (i = 0; i < 7; i++) {                       // 远处的浮岛
        var ix = x0 + (i + 0.5) * ((x1 - x0) / 7) + (Math.random() - 0.5) * 120, iy = H * (0.62 + Math.random() * 0.26), iw = 46 + Math.random() * 60;
        poly(g, [ix - iw, iy, ix + iw, iy, ix + iw * 0.5, iy + iw * 0.5, ix, iy + iw * 0.85, ix - iw * 0.55, iy + iw * 0.45]);
        ink(g, i % 2 ? P.far : P.near, 3);
        g.beginPath(); g.rect(ix - iw, iy - 10, iw * 2, 12); ink(g, '#9fd06a', 3);
      }
    } else if (P.kind === 'planet') {
      ridge(g, x0, x1, H, 46, function (x) { return H * 0.74 + Math.abs(Math.sin(x * 0.011 + seed)) * -60 + Math.sin(x * 0.04) * 8; }, P.far);
      ridge(g, x0, x1, H, 60, function (x) { return H * 0.84 + Math.sin(x * 0.007 + seed) * 22; }, P.near);
    } else {                                           // 火山
      ridge(g, x0, x1, H, 30, function (x) {
        var d = Math.abs(x - cx);
        return H * 0.78 - Math.max(0, 300 - d * 0.62) + (d < 70 ? 40 : 0) + Math.sin(x * 0.05) * 4;
      }, P.far);
      ridge(g, x0, x1, H, 44, function (x) { return H * 0.8 + Math.abs(Math.sin(x * 0.006 + seed)) * -70; }, P.near);
    }

    return c;
  };

  Background.prototype.draw = function (ctx, cam, t, night) {
    var m = this.map, P = this.poster, i;
    if (this.backdrop === null) this.backdrop = this.render(night) || false;
    if (this.backdrop) ctx.drawImage(this.backdrop, -400, -400);
    else { ctx.fillStyle = P.sky[1]; ctx.fillRect(-400, -400, RZ.WORLD_W + 800, RZ.WORLD_H + 800); }

    if (m.clouds) {
      for (i = 0; i < this.clouds.length; i++) {
        var c = this.clouds[i];
        cloudShape(ctx, c.x, c.y, 62 * c.s); ink(ctx, PAPER, 3);
      }
    }
    if (m.bubbles || m.embers) {
      for (i = 0; i < this.motes.length; i++) {
        var o = this.motes[i];
        if (m.embers) {                               // 火星：歪着的小方块
          ctx.fillStyle = i % 3 ? YELLOW : '#f08a2c';
          ctx.fillRect(o.x, o.y, o.r, o.r);
        } else {                                      // 气泡：空心圈
          disc(ctx, o.x, o.y, o.r + 1);
          ctx.lineWidth = 2; ctx.strokeStyle = '#9fe0d0'; ctx.stroke();
        }
      }
    }
  };

  RZ.Background = Background;
  RZ.POSTER = POSTER;

  // ================= 战车造型 =================
  // 所有造型以「双脚落地点」为原点绘制，朝右；face=-1 时整体镜像。
  // p = [主色, 暗部, 点缀, 最深]；u 在图鉴 / 选车界面里是 null。
  var ART = {};

  /** 带辐条的车轮，会跟着战车的位移转 */
  function wheel(ctx, x, y, r, spin, hub) {
    disc(ctx, x, y, r); ink(ctx, '#3a2c22', 2.5);
    disc(ctx, x, y, r * 0.42); ink(ctx, hub, 2);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (var i = 0; i < 3; i++) {
      var a = spin + i * Math.PI / 3;
      ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.lineTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
    }
    ctx.stroke();
  }
  /** 排气口的火苗：燃烧战车嘛。朝左喷 */
  function flame(ctx, x, y, s, t) {
    var f = 0.8 + 0.2 * Math.sin(t * 0.03) + 0.12 * Math.sin(t * 0.071);
    poly(ctx, [x, y - 3.5 * s, x - 13 * s * f, y - 1.5 * s, x - 8 * s * f, y, x - 15 * s * f, y + 2.5 * s, x, y + 3.5 * s]);
    ink(ctx, RED, 2);
    poly(ctx, [x, y - 2 * s, x - 7 * s * f, y, x, y + 2 * s]);
    ctx.fillStyle = YELLOW; ctx.fill();
  }
  function spinOf(u) { return u ? u.x / 7 : 0.5; }

  ART.tank = function (ctx, p, u, t) {
    flame(ctx, -21, -17, 1, t);
    // 车身：前高后低的楔形
    poly(ctx, [-22, -12, 20, -12, 24, -22, 12, -27, -18, -25]); ink(ctx, p[0]);
    poly(ctx, [-22, -12, 20, -12, 21.5, -16, -22, -16]); ctx.fillStyle = p[1]; ctx.fill();
    ctx.fillStyle = p[2]; ctx.fillRect(-14, -22, 20, 2.5);
    // 排气管
    roundRect(ctx, -25, -20, 7, 6, 2); ink(ctx, p[3], 2);
    // 炮塔
    ctx.beginPath(); ctx.arc(0, -26, 11, Math.PI, 0); ctx.closePath(); ink(ctx, p[0]);
    ctx.beginPath(); ctx.arc(0, -26, 11, Math.PI * 1.55, 0); ctx.lineTo(0, -26); ctx.closePath(); ctx.fillStyle = p[1]; ctx.fill();
    disc(ctx, -4, -31, 2.2); ink(ctx, p[2], 1.6);
    // 轮子压在车身前面
    wheel(ctx, -13, -8, 8, spinOf(u), p[2]);
    wheel(ctx, 13, -8, 8, spinOf(u), p[2]);
    disc(ctx, 0, -6, 5); ink(ctx, '#3a2c22', 2);
  };

  ART.heavy = function (ctx, p, u, t) {
    flame(ctx, -25, -22, 1.15, t);
    // 履带
    roundRect(ctx, -28, -16, 56, 16, 8); ink(ctx, p[3]);
    for (var i = -20; i <= 20; i += 10) { disc(ctx, i, -8, 4.6); ink(ctx, '#3a2c22', 2); }
    // 车体：一块厚铁板
    roundRect(ctx, -24, -31, 48, 17, 3); ink(ctx, p[0]);
    ctx.fillStyle = p[1]; ctx.fillRect(-23, -19, 46, 4);
    for (i = -18; i <= 18; i += 9) { disc(ctx, i, -27, 1.5); ctx.fillStyle = INK; ctx.fill(); }
    // 撞角
    poly(ctx, [24, -30, 34, -22, 24, -16]); ink(ctx, p[2]);
    // 炮塔 + 牛角盔
    roundRect(ctx, -13, -41, 27, 12, 4); ink(ctx, p[1]);
    poly(ctx, [-11, -40, -19, -52, -5, -42]); ink(ctx, p[2], 2);
    poly(ctx, [12, -40, 21, -52, 6, -42]); ink(ctx, p[2], 2);
  };

  ART.mech = function (ctx, p, u, t) {
    var step = u ? Math.sin(u.x / 5) * 2 : 0;
    // 腿：大腿 + 小腿 + 脚掌
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var legs = [[-9, -step], [10, step]];
    for (var i = 0; i < 2; i++) {
      var lx = legs[i][0], ly = legs[i][1];
      ctx.beginPath(); ctx.moveTo(lx * 0.5, -20); ctx.lineTo(lx * 1.4, -11 + ly); ctx.lineTo(lx, -3);
      ctx.lineWidth = 9; ctx.strokeStyle = INK; ctx.stroke();
      ctx.lineWidth = 4.5; ctx.strokeStyle = p[1]; ctx.stroke();
      roundRect(ctx, lx - 7, -5, 14, 5, 2); ink(ctx, p[3], 2);
    }
    // 躯干
    roundRect(ctx, -15, -36, 30, 18, 4); ink(ctx, p[0]);
    ctx.fillStyle = p[1]; ctx.fillRect(-14, -23, 28, 4);
    disc(ctx, 0, -29, 4); ink(ctx, p[2], 2);
    // 肩甲
    roundRect(ctx, -22, -38, 10, 12, 3); ink(ctx, p[1]);
    roundRect(ctx, 12, -38, 10, 12, 3); ink(ctx, p[1]);
    // 头：一条目镜
    roundRect(ctx, -8, -47, 17, 12, 3); ink(ctx, p[0]);
    ctx.fillStyle = INK; ctx.fillRect(-4, -44, 12, 4.5);
    ctx.fillStyle = p[2]; ctx.fillRect(1, -43.5, 6, 3);
    // 天线
    ctx.beginPath(); ctx.moveTo(-5, -47); ctx.lineTo(-9, -56); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    disc(ctx, -9, -56, 2); ctx.fillStyle = RED; ctx.fill();
  };

  ART.dragon = function (ctx, p, u, t) {
    var flap = Math.sin(t * 0.008) * 3;
    // 尾巴
    ctx.beginPath();
    ctx.moveTo(-12, -12); ctx.quadraticCurveTo(-36, -8, -31, -32);
    ctx.quadraticCurveTo(-25, -19, -11, -22); ctx.closePath(); ink(ctx, p[1]);
    poly(ctx, [-31, -32, -37, -40, -27, -36]); ink(ctx, p[2], 2);
    // 翅膀
    poly(ctx, [-4, -28, -24, -50 + flap, -15, -36, -8, -40 + flap, -1, -34]); ink(ctx, p[2]);
    // 脚
    roundRect(ctx, -13, -9, 10, 9, 3); ink(ctx, p[1]);
    roundRect(ctx, 4, -9, 10, 9, 3); ink(ctx, p[1]);
    // 身体 + 肚皮
    oval(ctx, 0, -19, 18, 14); ink(ctx, p[0]);
    ctx.save();
    oval(ctx, 0, -19, 18, 14); ctx.clip();
    oval(ctx, 5, -11, 11, 9); ctx.fillStyle = p[2]; ctx.fill();
    ctx.restore();
    // 头
    oval(ctx, 15, -31, 12, 10, -0.25); ink(ctx, p[0]);
    poly(ctx, [7, -39, 3, -50, 13, -42]); ink(ctx, p[2], 2);
    disc(ctx, 19, -34, 3.2); ink(ctx, PAPER, 1.6);
    disc(ctx, 20, -34, 1.5); ctx.fillStyle = INK; ctx.fill();
    disc(ctx, 25, -28, 1); ctx.fill();                 // 鼻孔
  };

  ART.spider = function (ctx, p, u, t) {
    var crawl = u ? u.x / 5 : 0;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var i = 0; i < 4; i++) {
      var lift = Math.sin(crawl + i * 1.6) * 2;
      var bx = -12 + i * 8, up = 16 + (i % 2) * 6;
      var legsPts = [
        [bx, -16, bx - 12 + i * 5, -16 - up, bx - 20 + i * 7, lift < 0 ? 0 : -lift],
        [bx + 4, -16, bx + 14 - i * 3, -14 - up, bx + 22 - i * 4, lift > 0 ? 0 : lift]
      ];
      for (var k = 0; k < 2; k++) {
        var L = legsPts[k];
        ctx.beginPath(); ctx.moveTo(L[0], L[1]); ctx.lineTo(L[2], L[3]); ctx.lineTo(L[4], L[5]);
        ctx.lineWidth = 6.5; ctx.strokeStyle = INK; ctx.stroke();
        ctx.lineWidth = 2.8; ctx.strokeStyle = p[1]; ctx.stroke();
      }
    }
    // 腹部 + 骷髅似的花纹
    oval(ctx, -5, -20, 16, 12); ink(ctx, p[0]);
    poly(ctx, [-12, -26, -5, -29, 2, -26, -5, -15]); ctx.fillStyle = p[1]; ctx.fill();
    disc(ctx, -5, -24, 2); ctx.fillStyle = p[2]; ctx.fill();
    // 头
    oval(ctx, 12, -22, 9, 8); ink(ctx, p[0]);
    disc(ctx, 15, -25, 2.6); ink(ctx, RED, 1.5);
    disc(ctx, 16, -19, 2); ink(ctx, RED, 1.5);
    poly(ctx, [19, -18, 25, -14, 19, -15]); ink(ctx, PAPER, 1.5);   // 毒牙
  };

  ART.saucer = function (ctx, p, u, t) {
    var hover = Math.sin(t * 0.004) * 2.5;
    ctx.save(); ctx.translate(0, hover - 6);
    // 底下的推进火焰
    var f = 0.75 + 0.25 * Math.sin(t * 0.03);
    poly(ctx, [-7, -6, 0, 6 * f, 7, -6]); ink(ctx, RED, 2);
    poly(ctx, [-3.5, -6, 0, 1 * f, 3.5, -6]); ctx.fillStyle = YELLOW; ctx.fill();
    // 碟身
    oval(ctx, 0, -12, 25, 8); ink(ctx, p[1]);
    oval(ctx, 0, -15, 19, 7.5); ink(ctx, p[0]);
    // 舱罩
    ctx.beginPath(); ctx.arc(0, -20, 10, Math.PI, 0); ctx.closePath(); ink(ctx, p[2]);
    ctx.beginPath(); ctx.arc(-3, -23, 4, Math.PI * 1.1, Math.PI * 1.7); ctx.lineWidth = 2; ctx.strokeStyle = PAPER; ctx.stroke();
    // 舷灯轮流亮
    for (var i = -14; i <= 14; i += 7) {
      var on = (((t / 220) | 0) + (i + 14) / 7) % 5 === 0;
      disc(ctx, i, -11, 2.2); ink(ctx, on ? YELLOW : p[3], 1.4);
    }
    ctx.restore();
  };

  /** 炮管：压在车体下面，所以要先画 */
  function barrel(ctx, p, aimDeg) {
    ctx.save();
    ctx.translate(0, -24);
    ctx.rotate(-aimDeg * Math.PI / 180);
    roundRect(ctx, 0, -4, 30, 8, 2); ink(ctx, p[1]);
    roundRect(ctx, 24, -5.5, 8, 11, 2); ink(ctx, p[2], 2);
    ctx.restore();
  }

  /** 画一辆不在战场上的车（选车界面、图鉴、标题画面）：炮管 + 车体，朝右 */
  RZ.drawArt = function (ctx, vehicle, t, aimDeg) {
    ctx.lineJoin = 'round';
    barrel(ctx, vehicle.pal, aimDeg == null ? 28 : aimDeg);
    (ART[vehicle.art] || ART.tank)(ctx, vehicle.pal, null, t || 0);
  };
  RZ.drawStar = function (ctx, x, y, rOut, rIn, n, rot, fill, lw) { star(ctx, x, y, rOut, rIn, n, rot); ink(ctx, fill, lw); };

  /** 画一辆战车：阴影、炮管、车体、状态、血条、名牌 */
  RZ.drawUnit = function (ctx, u, t, opts) {
    opts = opts || {};
    var v = u.vehicle, p = v.pal, team = RZ.TEAM_COLORS[u.team];
    ctx.save();
    ctx.translate(u.x, u.y);
    if (u.scale && u.scale !== 1) ctx.scale(u.scale, u.scale);
    ctx.lineJoin = 'round';

    // 脚下的阵营色块（2v2 时一眼分清敌我）+ 墨影
    oval(ctx, 0, 1, 27, 6); ctx.fillStyle = team; ctx.fill();
    ctx.lineWidth = opts.active ? 3 : 2; ctx.strokeStyle = INK; ctx.stroke();

    // 炮管压在车体下面，先画
    ctx.save();
    ctx.scale(u.face, 1);
    barrel(ctx, p, u.aim);
    if (u.muzzleFlash > 0) {                          // 炮口火光：一颗小爆炸星
      var mf = u.muzzleFlash / 8, ma = u.aim * Math.PI / 180, md = 38 + 6 * mf;
      star(ctx, Math.cos(ma) * md, -24 - Math.sin(ma) * md, 16 * mf + 4, 7 * mf + 2, 7, t * 0.01); ink(ctx, YELLOW, 2.5);
    }
    (ART[v.art] || ART.tank)(ctx, p, u, t);
    ctx.restore();

    if (u.hitFlash > 0 && (u.hitFlash & 2)) {         // 受击：车身外闪一圈纸色的星（闪烁，不是半透明）
      star(ctx, 0, -22, 34, 22, 8, t * 0.02);
      ctx.lineWidth = 3; ctx.strokeStyle = PAPER; ctx.stroke();
    }

    // 状态：中毒 / 燃烧 / 加强 / 麻痹，一排带墨线的小徽记
    var badge = 0, bx;
    for (var i = 0; i < u.dots.length && badge < 5; i++) {
      bx = -20 + badge * 10;
      disc(ctx, bx, -56 + Math.sin(t * 0.006 + i) * 2, 3.6);
      ink(ctx, u.dots[i].type === 'poison' ? '#8fd13f' : '#f08a2c', 1.8);
      badge++;
    }
    if (u.buffPower > 0) {                            // 加强攻击：小闪电
      bx = -20 + badge * 10;
      poly(ctx, [bx, -62, bx - 4, -54, bx, -54, bx - 3, -47, bx + 5, -57, bx + 1, -57]);
      ink(ctx, YELLOW, 1.8);
      badge++;
    }
    if (u.stunned > 0) {                              // 麻痹：紫色四角星
      bx = -20 + badge * 10;
      star(ctx, bx, -56, 5.5, 2.2, 4, t * 0.004); ink(ctx, '#b98cff', 1.8);
      badge++;
    }

    // 正在用道具：只亮一个通用标记，不说用的是哪个
    if (u.usedItemFlash > 0 && (u.usedItemFlash > 14 || (u.usedItemFlash & 2))) {
      roundRect(ctx, -21, -98, 42, 18, 3); ink(ctx, YELLOW, 2.5);
      ctx.font = '14px ' + RZ.FONT;
      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      ctx.fillText('道具', 0, -84);
    }

    // 血条与名牌
    var bw = 48, bh = 6, by = -72;
    ctx.beginPath(); ctx.rect(-bw / 2, by, bw, bh); ink(ctx, '#3a2c22', 2.5);
    var ratio = Math.max(0, u.hp / u.maxHp);
    ctx.fillStyle = ratio > 0.5 ? '#6cc04a' : ratio > 0.22 ? YELLOW : RED;
    ctx.fillRect(-bw / 2 + 1, by + 1, (bw - 2) * ratio, bh - 2);

    ctx.font = (u.boss ? 17 : 15) + 'px ' + RZ.FONT;
    ctx.textAlign = 'center';
    inkText(ctx, u.name, 0, by - 6, u.team === 0 ? '#ff9d7d' : '#8fe3d6', 4);

    if (opts.active) {                               // 当前操作中的战车
      var bob = Math.sin(t * 0.006) * 3;
      poly(ctx, [0, by - 26 + bob, -8, by - 38 + bob, 8, by - 38 + bob]);
      ink(ctx, YELLOW, 2.5);
    }
    ctx.restore();
  };

  /** 弹体：一串越来越小的尾迹点 + 带火尾的弹头 */
  RZ.drawProjectile = function (ctx, p, t) {
    var s = p.w.shell, tr = p.trail;
    if (tr && tr.length > 3) {
      ctx.fillStyle = s.trail;
      var n = tr.length / 2;
      for (var i = 0; i < n; i += 2) {
        disc(ctx, tr[i * 2], tr[i * 2 + 1], 1 + 3 * (i / n)); ctx.fill();
      }
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.lineJoin = 'round';
    var f = 0.8 + 0.2 * Math.sin(t * 0.05 + p.age);
    poly(ctx, [-s.r * 0.6, -s.r * 0.9, -s.r * 3.4 * f, 0, -s.r * 0.6, s.r * 0.9]); ink(ctx, s.glow, 2);
    oval(ctx, 0, 0, s.r * 1.5, s.r); ink(ctx, s.color, 2.2);
    ctx.restore();
  };

  /** 落雷特效：墨线里包着一道黄 */
  RZ.drawBolt = function (ctx, x, y0, y1, life) {
    if (life < 6 && (life & 1)) return;              // 收尾时闪两下
    ctx.save();
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(x, y0);
    var steps = 12, side = 1;
    for (var i = 1; i <= steps; i++) {
      var k = i / steps;
      side = -side;
      ctx.lineTo(x + side * (10 + Math.random() * 16) * (1 - k * 0.7), y0 + (y1 - y0) * k);
    }
    ctx.lineWidth = 13; ctx.strokeStyle = INK; ctx.stroke();
    ctx.lineWidth = 7; ctx.strokeStyle = YELLOW; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = PAPER; ctx.stroke();
    ctx.restore();
  };

  /** 炮口指示线：只表示角度，与力度无关 */
  RZ.drawAimRay = function (ctx, u, color) {
    var a = u.aim * Math.PI / 180;
    var dx = Math.cos(a) * u.face, dy = -Math.sin(a);
    var m = RZ.muzzle(u, 34);
    var len = 132;

    ctx.save();
    // 水平基准线 + 角度圆弧，方便读出仰角
    ctx.strokeStyle = PAPER;
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x + u.face * 58, m.y);
    ctx.stroke();
    ctx.beginPath();
    if (u.face > 0) ctx.arc(m.x, m.y, 42, -a, 0);
    else ctx.arc(m.x, m.y, 42, Math.PI, Math.PI + a, true);
    ctx.stroke();

    // 指向线：墨线打底，上面压一道纸色虚线
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x + dx * len, m.y + dy * len);
    ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = PAPER; ctx.stroke();

    ctx.setLineDash([]);
    ctx.translate(m.x + dx * (len + 4), m.y + dy * (len + 4));
    ctx.rotate(Math.atan2(dy, dx));
    poly(ctx, [10, 0, -6, -6.5, -6, 6.5]); ink(ctx, color || PAPER, 2.5);
    ctx.restore();
  };

  /** 弹道预览：一串沿轨迹缓缓流动、越来越小的墨点 */
  RZ.drawPreview = function (ctx, pts, color, t) {
    var n = pts.length / 2, step = 3, shift = Math.floor(t / 60) % step;
    ctx.save();
    // 纸色芯 + 墨线：亮沙地、暗星空上都要看得清
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    for (var i = shift; i < n; i += step) {
      disc(ctx, pts[i * 2], pts[i * 2 + 1], 4 - 2.2 * (i / n));
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  };

  /** 油桶 */
  RZ.drawBarrel = function (ctx, b, t) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.lineJoin = 'round';
    if (b.lit) ctx.translate(Math.sin(t * 0.09) * 1.5, 0);
    roundRect(ctx, -9, -24, 18, 24, 3); ink(ctx, b.lit ? YELLOW : RED);
    ctx.fillStyle = INK;
    ctx.fillRect(-9, -18, 18, 2); ctx.fillRect(-9, -8, 18, 2);
    poly(ctx, [0, -17, -4.5, -9.5, 4.5, -9.5]); ink(ctx, b.lit ? RED : YELLOW, 1.6);
    if (b.lit) { star(ctx, 0, -28, 8, 3.5, 6, t * 0.02); ink(ctx, PAPER, 2); }   // 引信着了
    ctx.restore();
  };

  /**
   * 画面上方的喝彩字：弹出来、停一下、缩回去。画在屏幕坐标里，不跟镜头走。
   * 红色错版影 + 墨线 + 黄字，套色印刷没对准的那种味道。
   */
  RZ.drawBanner = function (ctx, b, viewW, viewH) {
    var age = b.max - b.life;
    var pop = age < 6 ? 0.5 + age * 0.11 : 1.1 - Math.min(0.1, (age - 6) * 0.02);
    if (b.life < 10) pop *= b.life / 10;
    ctx.save();
    ctx.translate(viewW / 2, viewH * 0.24);
    ctx.rotate(-0.05);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.font = '62px ' + RZ.FONT;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10; ctx.strokeStyle = INK;
    ctx.strokeText(b.text, 5, 5);
    ctx.fillStyle = RED; ctx.fillText(b.text, 5, 5);
    inkText(ctx, b.text, 0, 0, YELLOW, 10);
    if (b.sub) {
      ctx.font = '28px ' + RZ.FONT;
      inkText(ctx, b.sub, 0, 38, PAPER, 6);
    }
    ctx.restore();
  };

  /** 补给箱 */
  RZ.drawSupply = function (ctx, s, t) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.lineJoin = 'round';
    if (!s.landed) {                        // 降落伞
      ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(-9, -12); ctx.lineTo(-16, -28); ctx.moveTo(9, -12); ctx.lineTo(16, -28); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -28, 17, Math.PI, 0); ctx.closePath(); ink(ctx, PAPER);
      ctx.beginPath(); ctx.moveTo(0, -28); ctx.arc(0, -28, 17, Math.PI * 1.33, Math.PI * 1.67); ctx.closePath(); ink(ctx, s.def.color, 2);
    }
    var bob = s.landed ? Math.sin(t * 0.005) * 1.5 : 0;
    roundRect(ctx, -12, -23 + bob, 24, 23, 2); ink(ctx, '#d9b676');
    ctx.fillStyle = s.def.color; ctx.fillRect(-11, -15 + bob, 22, 7);
    ctx.fillStyle = INK; ctx.fillRect(-12, -16 + bob, 24, 1.5); ctx.fillRect(-12, -8 + bob, 24, 1.5);
    ctx.restore();
  };
})(window.RZ || (window.RZ = {}));

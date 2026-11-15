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
  function Particles() { this.list = []; this.texts = []; this.bursts = []; this.marks = []; }

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
    for (i = 0; i < b.length; i++) {
      if (b[i].delay > 0) { b[i].delay--; b[j++] = b[i]; continue; }   // 还没轮到它响
      if (--b[i].life > 0) b[j++] = b[i];
    }
    b.length = j;
    var m = this.marks; j = 0;
    for (i = 0; i < m.length; i++) { if (--m[i].life > 0) m[j++] = m[i]; }
    m.length = j;
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
      if (o.delay > 0) continue;
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
      if (p.kind === 'drop') {                         // 往下滴的一滴：带墨线的小圆
        disc(ctx, p.x, p.y, p.size * k + 1.5); ctx.fillStyle = INK; ctx.fill();
        disc(ctx, p.x, p.y, p.size * k); ctx.fillStyle = p.c; ctx.fill();
        continue;
      }
      if (p.kind === 'bubble') {                       // 往上冒的泡：空心
        disc(ctx, p.x, p.y, p.size * k);
        ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
        ctx.lineWidth = 1.8; ctx.strokeStyle = p.c; ctx.stroke();
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

  // ================= 武器的样子 =================
  // 每把武器在 data.js 里有一个 look。这里按 look 决定三件事：
  //   SHOTS[look]  弹体长什么样（画在以弹体为原点的坐标里）
  //   PRE[look]    弹体身后拖着什么（光束、丝线、电弧——画在世界坐标里，用 p.trail）
  //   Particles.trail / boom  飞行时掉什么渣、落地时炸成什么样
  // 目标是「看一眼就知道是谁打的、打的是什么」：激光是一道光，毒液是一坨会滴的黏液，
  // 龙蛋落地是一摊蛋黄，蛛网落地真的结一张网。
  var SHOTS = {}, PRE = {};

  function vel(p) { return Math.atan2(p.vy, p.vx); }
  function sizeOf(w) { return Math.max(1.05, Math.min(1.8, 1.0 + (w.radius || 40) / 130)); }
  /** 弹尾的火：朝 -x 方向喷 */
  function tailFlame(ctx, x, h, len, t) {
    var f = 0.78 + 0.22 * Math.sin(t * 0.05);
    poly(ctx, [x, -h, x - len * f, 0, x, h]); ink(ctx, RED, 2);
    poly(ctx, [x, -h * 0.55, x - len * 0.55 * f, 0, x, h * 0.55]); ctx.fillStyle = YELLOW; ctx.fill();
  }
  /** 一团火的轮廓：头圆尾尖，尾巴上有几撮火舌 */
  function fireShape(ctx, r, len, t) {
    var a = Math.sin(t * 0.06) * r * 0.25, b = Math.cos(t * 0.045) * r * 0.25;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.quadraticCurveTo(r, -r, -r * 0.2, -r);
    ctx.lineTo(-len * 0.55, -r * 0.75 + a); ctx.lineTo(-len * 0.45, -r * 0.25);
    ctx.lineTo(-len, b); ctx.lineTo(-len * 0.45, r * 0.3);
    ctx.lineTo(-len * 0.6, r * 0.8 - a); ctx.lineTo(-r * 0.2, r);
    ctx.quadraticCurveTo(r, r, r, 0);
    ctx.closePath();
  }
  /** 沿 p.trail 最近 n 个点（加上弹体当前位置）走一条折线 */
  function trailPath(ctx, p, n) {
    var tr = p.trail, len = tr.length / 2, from = Math.max(0, len - n);
    ctx.beginPath();
    if (from >= len) { ctx.moveTo(p.x - p.vx * 2, p.y - p.vy * 2); }
    else {
      ctx.moveTo(tr[from * 2], tr[from * 2 + 1]);
      for (var i = from + 1; i < len; i++) ctx.lineTo(tr[i * 2], tr[i * 2 + 1]);
    }
    ctx.lineTo(p.x, p.y);
  }
  /** 一道锯齿电弧，从 (x0,y0) 到 (x1,y1)，每次调用形状都不一样——所以会闪 */
  function zig(ctx, x0, y0, x1, y1, amp, steps) {
    var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, side = 1;
    ctx.moveTo(x0, y0);
    for (var i = 1; i < steps; i++) {
      var k = i / steps; side = -side;
      var off = side * amp * (0.5 + Math.random() * 0.5);
      ctx.lineTo(x0 + dx * k + nx * off, y0 + dy * k + ny * off);
    }
    ctx.lineTo(x1, y1);
  }
  /** 先粗墨线、再细一点的颜色：给「线」类的东西描边 */
  function inkLine(ctx, color, w) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = w + 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
  }

  // ---- 烈火：火药 ----
  SHOTS.shell = function (ctx, p, t, s, k) {              // 烈火弹：拖着火的黑铁炮弹
    ctx.rotate(vel(p));
    tailFlame(ctx, -4 * k, 5 * k, 17 * k, t + p.age * 40);
    disc(ctx, 0, 0, 6.5 * k); ink(ctx, '#3a2c22', 2.2);
    ctx.beginPath(); ctx.arc(-1 * k, -1.5 * k, 3 * k, 3.5, 4.9); ctx.lineWidth = 1.8; ctx.strokeStyle = PAPER; ctx.stroke();
  };
  SHOTS.cracker = function (ctx, p, t, s, k) {            // 三连爆：三根翻着跟头的大炮仗
    ctx.rotate(p.age * 0.33);
    roundRect(ctx, -8 * k, -4 * k, 16 * k, 8 * k, 1.5); ink(ctx, RED, 2.2);
    ctx.fillStyle = YELLOW; ctx.fillRect(-5.5 * k, -4 * k, 2.4 * k, 8 * k); ctx.fillRect(3 * k, -4 * k, 2.4 * k, 8 * k);
    ctx.beginPath(); ctx.moveTo(8 * k, 0); ctx.quadraticCurveTo(12 * k, -4 * k, 14 * k, -1 * k); ctx.lineWidth = 1.8; ctx.strokeStyle = INK; ctx.stroke();
    star(ctx, 14.5 * k, -1 * k, 4.5 * k, 1.8 * k, 5, t * 0.03); ink(ctx, PAPER, 1.5);
  };
  SHOTS.meteor = function (ctx, p, t, s, k) {             // 焦土怒射：一整团烧着的火球
    ctx.rotate(vel(p));
    fireShape(ctx, 10 * k, 34 * k, t + p.age * 30); ink(ctx, RED, 3);
    fireShape(ctx, 6.5 * k, 20 * k, t * 1.3 + p.age * 30); ctx.fillStyle = YELLOW; ctx.fill();
    disc(ctx, 1.5 * k, 0, 3.5 * k); ctx.fillStyle = PAPER; ctx.fill();
  };

  // ---- 红龙：龙焰 ----
  SHOTS.dragonfire = function (ctx, p, t, s, k) {         // 龙焰弹：一口吐出来的火
    ctx.rotate(vel(p));
    fireShape(ctx, 6.5 * k, 22 * k, t + p.age * 30); ink(ctx, '#e2432a', 2.5);
    fireShape(ctx, 3.8 * k, 12 * k, t * 1.4); ctx.fillStyle = YELLOW; ctx.fill();
  };
  SHOTS.dragonhead = function (ctx, p, t, s, k) {         // 双头龙：两颗追着人咬的龙头，后面甩着身子
    ctx.rotate(vel(p));
    for (var i = 3; i >= 1; i--) {
      disc(ctx, -6 * k - i * 6.5 * k, Math.sin(t * 0.03 + i * 1.3 + p.age * 0.2) * 3.5 * k, (5 - i) * k); ink(ctx, i % 2 ? '#a5230e' : RED, 2);
    }
    poly(ctx, [-6 * k, -6 * k, -11 * k, -11 * k, -2 * k, -6.5 * k]); ink(ctx, YELLOW, 1.8);      // 角
    poly(ctx, [11 * k, -1 * k, 4 * k, -6.5 * k, -6 * k, -6.5 * k, -9 * k, 0, -6 * k, 6 * k, 4 * k, 6 * k, 9 * k, 2.5 * k, 4 * k, 1.5 * k]);
    ink(ctx, RED, 2.2);
    disc(ctx, 1.5 * k, -3 * k, 2 * k); ink(ctx, PAPER, 1.4);
    disc(ctx, 2.2 * k, -3 * k, 0.9 * k); ctx.fillStyle = INK; ctx.fill();
    poly(ctx, [7.5 * k, 1.8 * k, 6 * k, 4.4 * k, 5 * k, 1.8 * k]); ctx.fillStyle = PAPER; ctx.fill();   // 牙
  };
  PRE.breath = function (ctx, p, t, s, k) {               // 灭世龙息：一路烧过去的火带
    trailPath(ctx, p, 13); inkLine(ctx, RED, 13 * k);
    trailPath(ctx, p, 8); ctx.lineWidth = 6 * k; ctx.strokeStyle = YELLOW; ctx.stroke();
  };
  SHOTS.breath = function (ctx, p, t, s, k) {
    ctx.rotate(vel(p));
    fireShape(ctx, 12 * k, 30 * k, t + p.age * 30); ink(ctx, RED, 3);
    fireShape(ctx, 8 * k, 18 * k, t * 1.3); ctx.fillStyle = YELLOW; ctx.fill();
    fireShape(ctx, 4 * k, 9 * k, t * 1.7); ctx.fillStyle = PAPER; ctx.fill();
  };

  // ---- 铁金刚：钢铁 ----
  SHOTS.fist = function (ctx, p, t, s, k) {               // 铁拳弹：飞出去的一只铁拳头
    ctx.rotate(vel(p));
    tailFlame(ctx, -11 * k, 3.5 * k, 12 * k, t + p.age * 40);
    roundRect(ctx, -12 * k, -4.5 * k, 8 * k, 9 * k, 1.5); ink(ctx, '#5b7fa6', 2.2);              // 袖口
    roundRect(ctx, -5 * k, -6.5 * k, 13 * k, 13 * k, 3.5 * k); ink(ctx, '#e8edf2', 2.4);         // 拳
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (var i = -1; i <= 1; i++) { ctx.moveTo(4 * k, i * 3.6 * k - 1.2 * k); ctx.lineTo(8 * k, i * 3.6 * k - 1.2 * k); }
    ctx.stroke();
    roundRect(ctx, -3 * k, 3 * k, 7 * k, 5 * k, 2); ink(ctx, '#c3d1de', 1.8);                    // 拇指
  };
  function hammer(ctx, k, head, big) {
    roundRect(ctx, -10 * k, -1.8 * k, 17 * k, 3.6 * k, 1); ink(ctx, '#b78b4f', 2);
    roundRect(ctx, 4 * k, -7.5 * k, (big ? 11 : 9) * k, 15 * k, 2); ink(ctx, head, 2.4);
    ctx.fillStyle = INK; ctx.fillRect(4 * k, -2.6 * k, (big ? 11 : 9) * k, 1.5);
    ctx.fillRect(4 * k, 1.4 * k, (big ? 11 : 9) * k, 1.5);
  }
  SHOTS.hammer = function (ctx, p, t, s, k) {             // 跳弹锤：打着旋的锤子
    ctx.rotate(p.age * 0.42 * (p.vx < 0 ? -1 : 1));
    hammer(ctx, k, '#c3d1de', false);
  };
  SHOTS.thunderhammer = function (ctx, p, t, s, k) {      // 电击锤：带电的大锤
    ctx.save();
    ctx.rotate(p.age * 0.3 * (p.vx < 0 ? -1 : 1));
    hammer(ctx, k * 1.25, YELLOW, true);
    ctx.restore();
    ctx.beginPath();
    for (var i = 0; i < 3; i++) {
      var a = Math.random() * TAU, r0 = 9 * k, r1 = 20 * k;
      zig(ctx, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a + 0.5) * r1, Math.sin(a + 0.5) * r1, 4 * k, 4);
    }
    inkLine(ctx, PAPER, 2);
  };

  // ---- 贝贝龙：蛋 ----
  SHOTS.egg = function (ctx, p, t, s, k) {                // 龙蛋：带斑点、翻着滚
    ctx.rotate(p.age * 0.16);
    oval(ctx, 0, 0, 5.6 * k, 7.4 * k); ink(ctx, PAPER, 2.2);
    ctx.fillStyle = '#f2a0c0';
    disc(ctx, -1.8 * k, -2.6 * k, 1.6 * k); ctx.fill();
    disc(ctx, 2 * k, 0.6 * k, 1.9 * k); ctx.fill();
    disc(ctx, -1.2 * k, 3.6 * k, 1.3 * k); ctx.fill();
  };
  SHOTS.goldegg = function (ctx, p, t, s, k) {            // 万蛋齐发：领头的大金蛋
    ctx.rotate(p.age * 0.12);
    oval(ctx, 0, 0, 7.5 * k, 10 * k); ink(ctx, YELLOW, 2.6);
    ctx.save();
    oval(ctx, 0, 0, 7.5 * k, 10 * k); ctx.clip();
    ctx.fillStyle = RED; ctx.fillRect(-9 * k, -2 * k, 18 * k, 4 * k);
    ctx.restore();
    ctx.beginPath(); ctx.arc(-1.5 * k, -3 * k, 4.5 * k, 3.5, 4.8); ctx.lineWidth = 2; ctx.strokeStyle = PAPER; ctx.stroke();
  };

  // ---- 毒蜘蛛：毒与丝 ----
  SHOTS.venom = function (ctx, p, t, s, k) {              // 毒液弹：一坨会晃的黏液
    ctx.beginPath();
    for (var i = 0; i <= 10; i++) {
      var a = i / 10 * TAU, r = 6.8 * k * (1 + 0.2 * Math.sin(t * 0.02 + i * 1.9 + p.age * 0.3));
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ink(ctx, '#8fd13f', 2.4);
    disc(ctx, -2 * k, -2 * k, 1.8 * k); ctx.fillStyle = PAPER; ctx.fill();
    disc(ctx, 2 * k, 1.5 * k, 1.2 * k); ctx.fillStyle = '#3f7f1f'; ctx.fill();
  };
  SHOTS.spit = function (ctx, p, t, s, k) {               // 腐蚀三射：三根细长的毒针
    ctx.rotate(vel(p));
    poly(ctx, [11 * k, 0, 0, -3.2 * k, -10 * k, 0, 0, 3.2 * k]); ink(ctx, '#8fd13f', 2);
    ctx.beginPath(); ctx.moveTo(-6 * k, 0); ctx.lineTo(7 * k, 0); ctx.lineWidth = 1.5; ctx.strokeStyle = PAPER; ctx.stroke();
  };
  PRE.web = function (ctx, p, t, s, k) {                  // 剧毒之网：丝球后面一直连着一根丝
    trailPath(ctx, p, 60); inkLine(ctx, PAPER, 1.6);
  };
  SHOTS.web = function (ctx, p, t, s, k) {
    ctx.rotate(p.age * 0.1);
    disc(ctx, 0, 0, 8 * k); ink(ctx, PAPER, 2.4);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (var i = 0; i < 3; i++) { ctx.moveTo(-8 * k, (i - 1) * 4 * k); ctx.quadraticCurveTo(0, (i - 1) * 4 * k + 3 * k, 8 * k, (i - 1) * 4 * k); }
    ctx.moveTo(-3 * k, -7 * k); ctx.lineTo(-3 * k, 7 * k); ctx.moveTo(3 * k, -7 * k); ctx.lineTo(3 * k, 7 * k);
    ctx.stroke();
  };

  // ---- 旋风：风 ----
  function swirl(ctx, k, rot, arms, r) {
    ctx.beginPath();
    for (var j = 0; j < arms; j++) {
      for (var i = 0; i <= 8; i++) {
        var u = i / 8, a = rot + j * TAU / arms + u * 3.4, rr = (1.5 + u * r) * k;
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
    }
  }
  SHOTS.cyclone = function (ctx, p, t, s, k) {            // 气旋弹：一团转个不停的风
    swirl(ctx, k, -t * 0.02, 3, 9); inkLine(ctx, '#dff6ff', 2.6);
  };
  SHOTS.drill = function (ctx, p, t, s, k) {              // 穿地钻：一枚带螺纹的钻头
    ctx.rotate(vel(p));
    roundRect(ctx, -11 * k, -5 * k, 6 * k, 10 * k, 1.5); ink(ctx, '#1d6b7d', 2);
    poly(ctx, [13 * k, 0, -5 * k, -6.5 * k, -5 * k, 6.5 * k]); ink(ctx, '#c3d1de', 2.4);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var x = -4 * k + ((i * 4.5 + p.age * 1.2) % 18) * k, h = (13 * k - x) / (18 * k) * 6.5 * k;
      ctx.moveTo(x, -h); ctx.lineTo(x + 2.5 * k, h);
    }
    ctx.stroke();
  };
  function funnel(ctx, k, t, h, top, seed) {
    for (var i = 0; i < 5; i++) {
      var u = i / 4, rx = (top * (1 - u) + 1.6 * u) * k;
      oval(ctx, Math.sin(t * 0.025 + i * 0.9 + seed) * 2.2 * k * (1 - u * 0.4), (-h / 2 + u * h) * k, rx, Math.max(1.6, rx * 0.42));
      ink(ctx, i % 2 ? '#a8e6ff' : '#dff6ff', 2);
    }
  }
  SHOTS.tornado = function (ctx, p, t, s, k) {            // 龙卷风暴：四个歪歪扭扭的小龙卷
    funnel(ctx, k, t, 20, 9, p.vx * 3);
  };

  // ---- 托尔：雷 ----
  PRE.spark = PRE.storm = PRE.dart = function (ctx, p, t, s, k) {   // 身后是一截乱跳的电弧
    var tr = p.trail, n = tr.length / 2;
    if (n < 2) return;
    var from = Math.max(0, n - 5);
    ctx.beginPath();
    zig(ctx, tr[from * 2], tr[from * 2 + 1], p.x, p.y, 7 * k, 7);
    inkLine(ctx, YELLOW, 2.6);
  };
  SHOTS.spark = function (ctx, p, t, s, k) {              // 雷霆弹：一颗球状闪电
    star(ctx, 0, 0, 9.5 * k, 4 * k, 7, Math.random() * TAU); ink(ctx, YELLOW, 2.2);
    star(ctx, 0, 0, 5 * k, 2.2 * k, 5, Math.random() * TAU); ctx.fillStyle = PAPER; ctx.fill();
  };
  SHOTS.storm = function (ctx, p, t, s, k) {              // 神罚之雷：外面套着一圈电环的雷球
    ctx.save(); ctx.rotate(t * 0.006);
    ctx.beginPath(); ctx.ellipse(0, 0, 15 * k, 6 * k, 0, 0, TAU); inkLine(ctx, '#8fb8ff', 2);
    ctx.restore();
    SHOTS.spark(ctx, p, t, s, k * 1.15);
    ctx.save(); ctx.rotate(-t * 0.008);
    ctx.beginPath(); ctx.ellipse(0, 0, 6 * k, 15 * k, 0, -0.6, 0.6); inkLine(ctx, PAPER, 1.6);
    ctx.restore();
  };
  SHOTS.dart = function (ctx, p, t, s, k) {               // 裂空雷的子弹：一支闪电形的标枪
    ctx.rotate(vel(p));
    poly(ctx, [12 * k, 0, 2 * k, -5 * k, 3 * k, -1.2 * k, -11 * k, -3.5 * k, -2 * k, 2.5 * k, -3 * k, -0.5 * k]);
    ink(ctx, YELLOW, 2.2);
  };

  // ---- 赤焰：燃油 ----
  SHOTS.oilcan = function (ctx, p, t, s, k) {             // 燃油弹：一只翻滚的油壶
    ctx.rotate(p.age * 0.2);
    roundRect(ctx, 1 * k, -11 * k, 4.5 * k, 5 * k, 1); ink(ctx, YELLOW, 1.8);
    roundRect(ctx, -6.5 * k, -7.5 * k, 13 * k, 15 * k, 2); ink(ctx, '#e2432a', 2.4);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-4 * k, -4.5 * k); ctx.lineTo(4 * k, 4.5 * k); ctx.moveTo(4 * k, -4.5 * k); ctx.lineTo(-4 * k, 4.5 * k); ctx.stroke();
  };
  SHOTS.ember = function (ctx, p, t, s, k) {              // 四散火种：几簇小火苗
    ctx.rotate(vel(p));
    fireShape(ctx, 4.6 * k, 14 * k, t + p.age * 50 + p.vx * 20); ink(ctx, '#f08a2c', 2);
    disc(ctx, 0.5 * k, 0, 2.2 * k); ctx.fillStyle = PAPER; ctx.fill();
  };
  SHOTS.napalm = function (ctx, p, t, s, k) {             // 烈焰地毯：一整桶烧着的油
    ctx.rotate(vel(p));
    tailFlame(ctx, -8 * k, 7 * k, 24 * k, t + p.age * 40);
    roundRect(ctx, -9 * k, -7 * k, 18 * k, 14 * k, 2.5); ink(ctx, '#e2432a', 2.6);
    ctx.fillStyle = INK; ctx.fillRect(-3.6 * k, -7 * k, 1.6, 14 * k); ctx.fillRect(3 * k, -7 * k, 1.6, 14 * k);
    poly(ctx, [0.2 * k, -3.6 * k, -2.6 * k, 2.6 * k, 3 * k, 2.6 * k]); ctx.fillStyle = YELLOW; ctx.fill();
  };

  // ---- 兰登：光 ----
  // 激光没有「弹体」：它就是一道光。光束沿着飞过的轨迹画，墨线里包着紫，紫里包着一道纸色的芯。
  PRE.beam = function (ctx, p, t, s, k) {                 // 能量束：一截飞行的光
    trailPath(ctx, p, 10); inkLine(ctx, '#9b5cff', 6 * k);
    trailPath(ctx, p, 10); ctx.lineWidth = 2.2 * k; ctx.strokeStyle = PAPER; ctx.stroke();
  };
  SHOTS.beam = function (ctx, p, t, s, k) {
    star(ctx, 0, 0, 10 * k, 2.4 * k, 4, vel(p)); ink(ctx, PAPER, 2);
  };
  PRE.lance = function (ctx, p, t, s, k) {                // 双子光矛：矛后留一道残影
    trailPath(ctx, p, 3); ctx.lineWidth = 3 * k; ctx.lineCap = 'round'; ctx.strokeStyle = '#c39bff'; ctx.stroke();
  };
  SHOTS.lance = function (ctx, p, t, s, k) {
    ctx.rotate(vel(p));
    poly(ctx, [20 * k, 0, 2 * k, -4 * k, -16 * k, 0, 2 * k, 4 * k]); ink(ctx, '#c39bff', 2.2);
    poly(ctx, [15 * k, 0, 2 * k, -1.5 * k, -10 * k, 0, 2 * k, 1.5 * k]); ctx.fillStyle = PAPER; ctx.fill();
  };
  PRE.rail = function (ctx, p, t, s, k) {                 // 轨道炮：整条弹道都亮着，上面套着一串环
    trailPath(ctx, p, 60); inkLine(ctx, '#9b5cff', 9 * k);
    trailPath(ctx, p, 60); ctx.lineWidth = 3.5 * k; ctx.strokeStyle = PAPER; ctx.stroke();
    var tr = p.trail, n = tr.length / 2;
    for (var i = n - 3; i > 1; i -= 5) {
      var a = Math.atan2(tr[i * 2 + 1] - tr[i * 2 - 1], tr[i * 2] - tr[i * 2 - 2]);
      ctx.beginPath(); ctx.ellipse(tr[i * 2], tr[i * 2 + 1], 4 * k, 11 * k, a, 0, TAU); inkLine(ctx, PAPER, 1.8);
    }
  };
  SHOTS.rail = function (ctx, p, t, s, k) {
    star(ctx, 0, 0, 20 * k, 4 * k, 4, vel(p)); ink(ctx, PAPER, 2.4);
    star(ctx, 0, 0, 11 * k, 3 * k, 4, vel(p) + 0.785); ink(ctx, '#c39bff', 2);
  };

  // ---- 奥丁：重炮与陨石 ----
  SHOTS.mortar = SHOTS.bomblet = function (ctx, p, t, s, k) {   // 重迫击：带尾翼的胖炸弹
    ctx.rotate(vel(p));
    poly(ctx, [-8 * k, 0, -15 * k, -7 * k, -11 * k, -7 * k, -6 * k, -3 * k]); ink(ctx, '#c9a227', 2);
    poly(ctx, [-8 * k, 0, -15 * k, 7 * k, -11 * k, 7 * k, -6 * k, 3 * k]); ink(ctx, '#c9a227', 2);
    oval(ctx, 0, 0, 10 * k, 6.5 * k); ink(ctx, '#6b6b3a', 2.4);
    ctx.save(); oval(ctx, 0, 0, 10 * k, 6.5 * k); ctx.clip();
    ctx.fillStyle = '#3a2c22'; ctx.fillRect(5 * k, -8 * k, 8 * k, 16 * k);
    ctx.fillStyle = YELLOW; ctx.fillRect(-1.5 * k, -8 * k, 2.4 * k, 16 * k);
    ctx.restore();
  };
  SHOTS.rock = function (ctx, p, t, s, k) {               // 陨石审判：刻着符文、拖着火的石头
    ctx.save(); ctx.rotate(vel(p));
    tailFlame(ctx, -5 * k, 8 * k, 30 * k, t + p.age * 40);
    ctx.restore();
    ctx.rotate(p.age * 0.07);
    poly(ctx, [10 * k, -2 * k, 5 * k, -9 * k, -4 * k, -10 * k, -10 * k, -3 * k, -8 * k, 6 * k, 0, 10 * k, 8 * k, 6 * k]);
    ink(ctx, '#8f6f4a', 2.6);
    poly(ctx, [-8 * k, 6 * k, 0, 10 * k, 8 * k, 6 * k, 2 * k, 4 * k, -4 * k, 5 * k]); ctx.fillStyle = '#5c4630'; ctx.fill();
    ctx.strokeStyle = YELLOW; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-3 * k, -6 * k); ctx.lineTo(-3 * k, 2 * k); ctx.moveTo(-3 * k, -5 * k); ctx.lineTo(3 * k, -2 * k); ctx.lineTo(-3 * k, 0); ctx.stroke();
  };

  // ---- 道具弹 ----
  SHOTS.beacon = function (ctx, p, t, s, k) {             // 定位炮：一枚一闪一闪的信标
    ctx.rotate(vel(p));
    poly(ctx, [11 * k, 0, 0, -5 * k, -9 * k, -5 * k, -6 * k, 0, -9 * k, 5 * k, 0, 5 * k]); ink(ctx, '#2fd0ff', 2.2);
    disc(ctx, 1 * k, 0, 2.6 * k); ink(ctx, ((t / 120) | 0) % 2 ? PAPER : YELLOW, 1.5);
  };
  SHOTS.orb = function (ctx, p, t, s, k) {                // 麻痹弹：套着环的紫球
    disc(ctx, 0, 0, 6.5 * k); ink(ctx, '#a86bff', 2.4);
    ctx.save(); ctx.rotate(t * 0.01);
    ctx.beginPath(); ctx.ellipse(0, 0, 12 * k, 4 * k, 0, 0, TAU); inkLine(ctx, PAPER, 1.6);
    ctx.restore();
  };

  /** 弹体：先画它身后拖着的东西，再画它自己 */
  RZ.drawProjectile = function (ctx, p, t) {
    var w = p.w, s = w.shell, look = SHOTS[w.look] ? w.look : 'shell', k = sizeOf(w);
    ctx.save();
    ctx.lineJoin = 'round';
    if (PRE[look]) PRE[look](ctx, p, t, s, k);
    ctx.translate(p.x, p.y);
    SHOTS[look](ctx, p, t, s, k);
    ctx.restore();
  };

  // ================= 飞行时掉的渣 =================
  var TRAILS = {
    smoke: function (fx, p) { if ((p.age & 3) === 0) fx.add({ x: p.x, y: p.y, vx: 0, vy: -0.15, life: 20, max: 20, size: 4.5, c: '#cbb994', grav: -0.004, kind: 'puff' }); },
    ember: function (fx, p) {
      if (p.age & 1) return;
      fx.add({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2, life: 16, max: 16, size: 4, c: Math.random() < 0.5 ? YELLOW : '#f08a2c', grav: 0.03, kind: 'chip', rot: Math.random() * TAU });
    },
    drip: function (fx, p, color) {
      if ((p.age % 3) !== 0) return;
      fx.add({ x: p.x, y: p.y + 3, vx: p.vx * 0.15, vy: 0.6, life: 22, max: 22, size: 3.4, c: color, grav: 0.16, kind: 'drop' });
    },
    gust: function (fx, p) { if ((p.age & 3) === 0) fx.add({ x: p.x, y: p.y, vx: -p.vx * 0.1, vy: -p.vy * 0.1, life: 14, max: 14, size: 5, c: '#dff6ff', grav: 0, kind: 'puff' }); }
  };
  var TRAIL_OF = {
    shell: 'smoke', cracker: 'smoke', fist: 'smoke', mortar: 'smoke', bomblet: 'smoke', beacon: 'smoke',
    meteor: 'ember', dragonfire: 'ember', dragonhead: 'ember', breath: 'ember', ember: 'ember', napalm: 'ember', rock: 'ember',
    venom: 'drip', spit: 'drip', oilcan: 'drip',
    cyclone: 'gust', tornado: 'gust'
  };
  Particles.prototype.trail = function (p) {
    var kind = TRAIL_OF[p.w.look || 'shell'];
    if (!kind) return;                                  // 蛋、锤子、光束、电弧：干干净净，什么都不掉
    TRAILS[kind](this, p, p.w.look === 'oilcan' ? INK : '#8fd13f');
  };

  // ================= 落地 =================
  /** 留在场上一小会儿的效果：蛛网、地上的火、龙卷、光环…… */
  Particles.prototype.mark = function (m) {
    m.max = m.life;
    this.marks.push(m);
    if (this.marks.length > 40) this.marks.shift();
  };
  function chips(fx, x, y, n, speed, colors, size) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, sp = speed * (0.4 + Math.random() * 0.6);
      fx.add({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 20 + Math.random() * 20, max: 40,
        size: size * (0.6 + Math.random() * 0.6), c: colors[(Math.random() * colors.length) | 0], grav: 0.14, kind: 'chip', rot: Math.random() * TAU });
    }
  }
  function smoke(fx, x, y, r, n, color) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, d = Math.random() * r * 0.45;
      fx.add({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * 0.5, vy: Math.sin(a) * 0.4 - 0.7,
        life: 30 + Math.random() * 26, max: 56, size: r * (0.2 + Math.random() * 0.2), c: i % 3 ? color : PAPER, grav: -0.012, kind: 'smoke' });
    }
  }
  /** 沿弹坑下半圈摆一排火苗的位置 */
  function rimFire(x, y, r, n) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = 0.25 + (i + Math.random() * 0.6) / n * (Math.PI - 0.5);
      pts.push(x + Math.cos(a) * r * 1.02, y + Math.sin(a) * r * 1.02, 0.6 + Math.random() * 0.7, Math.random() * TAU);
    }
    return pts;
  }

  var BOOMS = {
    fire: function (fx, x, y, r, s) { fx.burst(x, y, r, [s.color, s.glow, PAPER, s.trail]); },
    crackers: function (fx, x, y, r) {                  // 三连爆：连着三声，一地红纸屑
      for (var i = 0; i < 3; i++) {
        var a = Math.random() * TAU, d = i ? r * 0.5 : 0;
        fx.bursts.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r: r * (i ? 0.6 : 0.9), life: 14, max: 14, delay: i * 5, rot: Math.random() * TAU, n: 8, c1: RED, c2: YELLOW });
      }
      chips(fx, x, y, 16, r * 0.14, [RED, RED, YELLOW, PAPER], 5);
      smoke(fx, x, y, r, 5, '#cbb994');
    },
    flame: function (fx, x, y, r) {                     // 龙焰：一朵火开出来
      fx.mark({ type: 'flower', x: x, y: y, r: r, life: 22, seed: Math.random() * TAU });
      fx.mark({ type: 'fire', x: x, y: y, r: r, life: 70, pts: rimFire(x, y, r, 5) });
      chips(fx, x, y, 8, r * 0.12, [YELLOW, '#f08a2c'], 4);
    },
    inferno: function (fx, x, y, r) {                   // 必杀级的火：大火花 + 烧很久的一圈
      fx.burst(x, y, r, [YELLOW, RED, PAPER, '#f08a2c']);
      fx.mark({ type: 'flower', x: x, y: y, r: r * 0.9, life: 26, seed: Math.random() * TAU });
      fx.mark({ type: 'fire', x: x, y: y, r: r, life: 130, pts: rimFire(x, y, r, 9), tall: 1.5 });
    },
    groundfire: function (fx, x, y, r) {                // 燃油：炸得不大，但地上一直烧
      fx.bursts.push({ x: x, y: y, r: r * 0.7, life: 14, max: 14, rot: Math.random() * TAU, n: 8, c1: RED, c2: YELLOW });
      fx.mark({ type: 'fire', x: x, y: y, r: r, life: 120, pts: rimFire(x, y, r, 7), tall: 1.2 });
      chips(fx, x, y, 8, r * 0.1, [INK, '#3a2c22', YELLOW], 4);
      smoke(fx, x, y, r, 5, '#4a392c');
    },
    steel: function (fx, x, y, r) {                     // 钢铁：一记「砰」，溅出铁屑，没有火
      fx.mark({ type: 'pow', x: x, y: y, r: r, life: 15, seed: Math.random() * TAU });
      fx.mark({ type: 'ring', x: x, y: y, r: r, life: 16, c: '#c3d1de' });
      chips(fx, x, y, 14, r * 0.16, ['#e8edf2', '#9fb3c8', '#5b7fa6'], 4.5);
    },
    yolk: function (fx, x, y, r) {                      // 蛋：一摊蛋清蛋黄，碎壳乱飞
      fx.mark({ type: 'splat', x: x, y: y, r: r, life: 44, seed: Math.random() * TAU, c: PAPER, c2: YELLOW });
      chips(fx, x, y, 12, r * 0.15, [PAPER, PAPER, '#f2a0c0'], 5);
    },
    venom: function (fx, x, y, r) {                     // 毒：溅开一摊，冒着泡
      fx.mark({ type: 'splat', x: x, y: y, r: r, life: 50, seed: Math.random() * TAU, c: '#8fd13f', c2: '#3f7f1f' });
      for (var i = 0; i < 9; i++) {
        fx.add({ x: x + (Math.random() - 0.5) * r * 1.2, y: y + (Math.random() - 0.3) * r * 0.6, vx: 0, vy: -0.5 - Math.random() * 0.8,
          life: 26 + Math.random() * 30, max: 56, size: 3 + Math.random() * 4, c: '#c8ff7a', grav: -0.01, kind: 'bubble' });
      }
    },
    web: function (fx, x, y, r) {                       // 剧毒之网：真的结一张网
      fx.mark({ type: 'web', x: x, y: y, r: r, life: 120, seed: Math.random() * TAU });
      BOOMS.venom(fx, x, y, r * 0.5);
    },
    whirl: function (fx, x, y, r) {                     // 气旋：一圈圈卷开的风，带起尘土
      fx.mark({ type: 'whirl', x: x, y: y, r: r, life: 26, seed: Math.random() * TAU });
      smoke(fx, x, y, r, 4, '#dff6ff');
    },
    tornado: function (fx, x, y, r) {                   // 龙卷：落点立起一根龙卷
      fx.mark({ type: 'twister', x: x, y: y, r: r, life: 56, seed: Math.random() * TAU });
      fx.mark({ type: 'whirl', x: x, y: y, r: r * 0.8, life: 22, seed: Math.random() * TAU });
    },
    volt: function (fx, x, y, r) {                      // 雷：朝四面八方窜的电弧
      fx.mark({ type: 'zap', x: x, y: y, r: r, life: 14 });
      fx.bursts.push({ x: x, y: y, r: r * 0.5, life: 10, max: 10, rot: Math.random() * TAU, n: 7, c1: YELLOW, c2: PAPER });
      chips(fx, x, y, 8, r * 0.16, [YELLOW, PAPER], 3.5);
    },
    energy: function (fx, x, y, r, s) {                 // 光：两道扩开的光环 + 十字闪光，没有烟
      fx.mark({ type: 'ring', x: x, y: y, r: r, life: 18, c: s.glow });
      fx.mark({ type: 'ring', x: x, y: y, r: r * 0.6, life: 24, c: PAPER });
      fx.mark({ type: 'cross', x: x, y: y, r: r, life: 14, c: s.glow });
    },
    dust: function (fx, x, y, r, s, ground) {           // 重炮：炸起来的是土和石头
      fx.bursts.push({ x: x, y: y, r: r * 0.75, life: 14, max: 14, rot: Math.random() * TAU, n: 9, c1: ground.body, c2: ground.top });
      fx.mark({ type: 'ring', x: x, y: y, r: r, life: 16, c: ground.top, flat: true });
      chips(fx, x, y, 16, r * 0.17, [ground.body, ground.deep, ground.top], 7);
      smoke(fx, x, y, r, 8, ground.top);
    }
  };

  /** 一发武器落地。w 是武器，ground 是这张图的地面配色（重炮炸起来的土要用） */
  Particles.prototype.boom = function (x, y, r, w, ground) {
    var fam = RZ.lookOf ? RZ.lookOf(w) : null;
    var kind = fam && BOOMS[fam.boom] ? fam.boom : 'fire';
    BOOMS[kind](this, x, y, r, w.shell, ground || { top: '#edc06a', body: '#cf8f3f', deep: '#96592a' });
  };

  // ---- 留场效果怎么画 ----
  var MARKS = {
    ring: function (ctx, m, u) {                        // 扩开的环；flat 的是贴地的椭圆
      var R = m.r * (0.3 + u * 1.0), lw = 1 + 6 * (1 - u);
      ctx.beginPath(); ctx.ellipse(m.x, m.y, R, m.flat ? R * 0.32 : R, 0, 0, TAU);
      inkLine(ctx, m.c, lw);
    },
    cross: function (ctx, m, u) {
      var sc = u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 0.7;
      star(ctx, m.x, m.y, m.r * 1.7 * sc + 2, m.r * 0.1 * sc + 1, 4, 0); ink(ctx, PAPER, 2.4);
      star(ctx, m.x, m.y, m.r * 0.9 * sc + 1, m.r * 0.1 * sc + 1, 4, 0.785); ink(ctx, m.c, 2);
    },
    zap: function (ctx, m, u) {                         // 每帧重画一遍，所以一直在跳
      ctx.beginPath();
      for (var i = 0; i < 7; i++) {
        var a = i / 7 * TAU + Math.random() * 0.5, R = m.r * (0.7 + Math.random() * 0.6) * (1 - u * 0.4);
        zig(ctx, m.x, m.y, m.x + Math.cos(a) * R, m.y + Math.sin(a) * R, 7, 5);
      }
      inkLine(ctx, YELLOW, 3);
    },
    flower: function (ctx, m, u, t) {                   // 一圈往外窜的火舌
      var sc = u < 0.25 ? 0.4 + u * 2.4 : 1 - (u - 0.25) / 0.75 * 0.9;
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < 8; i++) {
          var a = m.seed + i / 8 * TAU, L = m.r * (0.75 + 0.3 * Math.sin(i * 2.3 + t * 0.03)) * sc * (pass ? 0.6 : 1), wd = m.r * 0.2 * sc * (pass ? 0.55 : 1);
          var cx = Math.cos(a), cy = Math.sin(a);
          ctx.beginPath();
          ctx.moveTo(m.x - cy * wd, m.y + cx * wd);
          ctx.quadraticCurveTo(m.x + cx * L * 0.5 - cy * wd * 1.3, m.y + cy * L * 0.5 + cx * wd * 1.3, m.x + cx * L, m.y + cy * L);
          ctx.quadraticCurveTo(m.x + cx * L * 0.5 + cy * wd * 1.3, m.y + cy * L * 0.5 - cx * wd * 1.3, m.x + cy * wd, m.y - cx * wd);
          ctx.closePath();
          if (pass) { ctx.fillStyle = YELLOW; ctx.fill(); } else ink(ctx, RED, 2.4);
        }
      }
    },
    fire: function (ctx, m, u, t) {                     // 地上的火：沿坑边一排火苗，慢慢烧矮
      var p = m.pts, left = 1 - u, tall = m.tall || 1;
      for (var i = 0; i < p.length; i += 4) {
        var h = (9 + m.r * 0.22) * p[i + 2] * tall * Math.min(1, left * 1.6), wd = 4 + h * 0.22;
        if (h < 3) continue;
        var sway = Math.sin(t * 0.02 + p[i + 3]) * wd * 0.7, f = 0.8 + 0.2 * Math.sin(t * 0.05 + p[i + 3] * 3);
        poly(ctx, [p[i] - wd, p[i + 1], p[i] - wd * 0.4 + sway * 0.4, p[i + 1] - h * 0.5 * f, p[i] + sway, p[i + 1] - h * f, p[i] + wd * 0.5 + sway * 0.3, p[i + 1] - h * 0.45 * f, p[i] + wd, p[i + 1]]);
        ink(ctx, RED, 2);
        poly(ctx, [p[i] - wd * 0.5, p[i + 1], p[i] + sway * 0.5, p[i + 1] - h * 0.55 * f, p[i] + wd * 0.5, p[i + 1]]);
        ctx.fillStyle = YELLOW; ctx.fill();
      }
    },
    splat: function (ctx, m, u) {                       // 一摊：中间一块，周围甩出几滴
      var sc = u < 0.15 ? 0.3 + u / 0.15 * 0.7 : u > 0.75 ? 1 - (u - 0.75) / 0.25 : 1, R = m.r * 0.5 * sc, i, a, d;
      if (R < 2) return;
      ctx.fillStyle = INK; ctx.beginPath();
      ctx.ellipse(m.x, m.y, R + 2.5, R * 0.8 + 2.5, 0, 0, TAU);
      for (i = 0; i < 7; i++) {
        a = m.seed + i * 0.9; d = R * (1.05 + (i % 3) * 0.28);
        ctx.moveTo(m.x + Math.cos(a) * d + R * 0.26 + 2.5, m.y + Math.sin(a) * d * 0.8);
        ctx.arc(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d * 0.8, R * (0.14 + (i % 2) * 0.12) + 2.5, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = m.c; ctx.beginPath();
      ctx.ellipse(m.x, m.y, R, R * 0.8, 0, 0, TAU);
      for (i = 0; i < 7; i++) {
        a = m.seed + i * 0.9; d = R * (1.05 + (i % 3) * 0.28);
        ctx.moveTo(m.x + Math.cos(a) * d + R * 0.26, m.y + Math.sin(a) * d * 0.8);
        ctx.arc(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d * 0.8, R * (0.14 + (i % 2) * 0.12), 0, TAU);
      }
      ctx.fill();
      if (m.c2) { ctx.beginPath(); ctx.ellipse(m.x, m.y - R * 0.05, R * 0.5, R * 0.42, 0, 0, TAU); ink(ctx, m.c2, 2); }
    },
    web: function (ctx, m, u) {                         // 蛛网：十根辐条 + 三圈下垂的丝
      var sc = u < 0.08 ? u / 0.08 : u > 0.88 ? (1 - u) / 0.12 : 1, R = m.r * sc, n = 10, i, k;
      if (R < 4) return;
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        var a = m.seed + i / n * TAU;
        ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + Math.cos(a) * R, m.y + Math.sin(a) * R);
      }
      for (k = 1; k <= 3; k++) {
        var rr = R * (0.3 * k + 0.02);
        for (i = 0; i < n; i++) {
          var a0 = m.seed + i / n * TAU, a1 = m.seed + (i + 1) / n * TAU, am = (a0 + a1) / 2;
          ctx.moveTo(m.x + Math.cos(a0) * rr, m.y + Math.sin(a0) * rr);
          ctx.quadraticCurveTo(m.x + Math.cos(am) * rr * 0.86, m.y + Math.sin(am) * rr * 0.86, m.x + Math.cos(a1) * rr, m.y + Math.sin(a1) * rr);
        }
      }
      inkLine(ctx, PAPER, 1.8);
    },
    whirl: function (ctx, m, u, t) {
      ctx.save(); ctx.translate(m.x, m.y);
      swirl(ctx, 1, m.seed - u * 5, 3, m.r * (0.4 + u * 0.9));
      inkLine(ctx, '#dff6ff', 1 + 3.5 * (1 - u));
      ctx.restore();
    },
    twister: function (ctx, m, u, t) {                  // 立在落点上的龙卷：先长高，再缩回去
      var sc = u < 0.2 ? u / 0.2 : u > 0.7 ? (1 - u) / 0.3 : 1, h = m.r * 2.4 * sc;
      if (h < 6) return;
      ctx.save(); ctx.translate(m.x, m.y - h / 2);
      // funnel 以自己的中心为原点、上宽下窄
      funnel(ctx, 1, t * 2, h, m.r * 0.8 * sc, m.seed);
      ctx.restore();
    },
    pow: function (ctx, m, u) {                         // 钢铁撞击：一颗白星 + 一圈冲击线
      var sc = u < 0.3 ? 0.5 + u / 0.3 * 0.6 : 1.1 * (1 - (u - 0.3) / 0.7);
      star(ctx, m.x, m.y, m.r * 0.95 * sc, m.r * 0.5 * sc, 8, m.seed); ink(ctx, PAPER, 3);
      star(ctx, m.x, m.y, m.r * 0.5 * sc, m.r * 0.26 * sc, 8, m.seed + 0.4); ctx.fillStyle = '#9fb3c8'; ctx.fill();
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = m.seed + (i + 0.5) / 8 * TAU, r0 = m.r * (1.0 + u * 0.5), r1 = r0 + m.r * 0.35 * (1 - u);
        ctx.moveTo(m.x + Math.cos(a) * r0, m.y + Math.sin(a) * r0); ctx.lineTo(m.x + Math.cos(a) * r1, m.y + Math.sin(a) * r1);
      }
      ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.stroke();
    }
  };
  MARKS.skyfall = function (ctx, m, u) {                // Boss 的预告打击落地：一道从天上砸下来的黄线
    ctx.beginPath(); ctx.moveTo(m.x, m.y - 900); ctx.lineTo(m.x, m.y);
    inkLine(ctx, YELLOW, Math.max(2, m.r * 0.3 * (1 - u)));
  };

  // ================= 留在场上的区域 / Boss 的警戒线 =================
  // 规则在 field.js；这里只管把它们画出来。区域头顶有个小牌子：名字 + 还剩几轮。
  var HAZARD_NAME = { fire: '地火', pool: '毒池', web: '蛛网', twister: '龙卷' };
  RZ.drawHazard = function (ctx, h, t) {
    var p = h.pts, i, top = h.y - 30;
    ctx.save();
    ctx.lineJoin = 'round';
    if (h.type === 'fire') {                            // 一排一直烧着的火苗
      for (i = 0; i < p.length; i += 2) {
        var ph = h.seed + i * 1.7, hgt = 15 + (i % 3) * 4, wd = 6.5;
        var sway = Math.sin(t * 0.02 + ph) * 4, f = 0.78 + 0.22 * Math.sin(t * 0.05 + ph * 3);
        poly(ctx, [p[i] - wd, p[i + 1], p[i] - wd * 0.4 + sway * 0.4, p[i + 1] - hgt * 0.5 * f, p[i] + sway, p[i + 1] - hgt * f,
          p[i] + wd * 0.5 + sway * 0.3, p[i + 1] - hgt * 0.45 * f, p[i] + wd, p[i + 1]]);
        ink(ctx, RED, 2);
        poly(ctx, [p[i] - wd * 0.5, p[i + 1], p[i] + sway * 0.5, p[i + 1] - hgt * 0.55 * f, p[i] + wd * 0.5, p[i + 1]]);
        ctx.fillStyle = YELLOW; ctx.fill();
      }
      top = h.y - 44;
    } else if (h.type === 'pool') {                     // 贴着地面的一道绿，上面冒泡
      ctx.beginPath();
      for (i = 0; i < p.length; i += 2) { if (i === 0) ctx.moveTo(p[i], p[i + 1] + 1); else ctx.lineTo(p[i], p[i + 1] + 1); }
      inkLine(ctx, '#8fd13f', 6);
      for (i = 0; i < 4; i++) {
        var cyc = ((t * 0.0006 + i * 0.27 + h.seed) % 1), k = (i * 2) % Math.max(2, p.length);
        k -= k % 2;
        disc(ctx, p[k] + Math.sin(h.seed + i * 2) * 8, p[k + 1] - 4 - cyc * 26, 2 + (1 - cyc) * 3);
        ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
        ctx.lineWidth = 1.8; ctx.strokeStyle = '#c8ff7a'; ctx.stroke();
      }
      top = h.y - 40;
    } else if (h.type === 'web') {
      MARKS.web(ctx, { x: h.x, y: h.y - h.r * 0.25, r: h.r, seed: h.seed }, 0.5);
      top = h.y - h.r * 1.25 - 8;
    } else if (h.type === 'twister') {
      MARKS.twister(ctx, { x: h.x, y: h.y + 24, r: h.r * 0.62, seed: h.seed }, 0.45, t);
      top = h.y - h.r * 1.5;
    }
    ctx.font = '15px ' + RZ.FONT; ctx.textAlign = 'center';
    inkText(ctx, HAZARD_NAME[h.type] + ' ' + h.rounds, h.x, top, h.type === 'pool' ? '#c8ff7a' : h.type === 'fire' ? YELLOW : PAPER, 4);
    ctx.restore();
  };

  /**
   * Boss 圈出来的地：沿地面拉一道黄黑相间的警戒线，上面悬着一块警告牌，
   * 一根虚线指向天上——东西是从上面落下来的。
   */
  RZ.drawTelegraph = function (ctx, tg, terrain, t) {
    var n = 8, i, x, y, cy = 0;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    ctx.beginPath();
    for (i = 0; i <= n; i++) {
      x = Math.max(2, Math.min(RZ.WORLD_W - 2, tg.x - tg.r + i / n * tg.r * 2));
      y = terrain.groundBelow(x, 0);
      if (y >= RZ.WORLD_H - 4) y = RZ.WORLD_H * 0.6;
      if (i === n / 2) cy = y;
      if (i === 0) ctx.moveTo(x, y - 3); else ctx.lineTo(x, y - 3);
    }
    ctx.lineWidth = 13; ctx.strokeStyle = INK; ctx.stroke();
    ctx.lineWidth = 8; ctx.strokeStyle = YELLOW; ctx.stroke();
    ctx.setLineDash([9, 9]); ctx.lineDashOffset = -(t * 0.03) % 18;
    ctx.strokeStyle = INK; ctx.stroke();
    // 指向天上的虚线
    ctx.setLineDash([6, 10]); ctx.lineDashOffset = (t * 0.06) % 16;
    ctx.beginPath(); ctx.moveTo(tg.x, cy - 62); ctx.lineTo(tg.x, cy - 420);
    ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = YELLOW; ctx.stroke();
    ctx.setLineDash([]);
    // 警告牌
    var bob = Math.sin(t * 0.008 + tg.seed) * 3, sy = cy - 34 + bob;
    poly(ctx, [tg.x, sy - 26, tg.x - 20, sy + 6, tg.x + 20, sy + 6]); ink(ctx, YELLOW, 3);
    ctx.fillStyle = INK; ctx.fillRect(tg.x - 2, sy - 14, 4, 11); ctx.fillRect(tg.x - 2, sy - 1, 4, 4);
    ctx.restore();
  };

  Particles.prototype.drawMarks = function (ctx, t) {
    var ms = this.marks;
    ctx.save();
    ctx.lineJoin = 'round';
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (MARKS[m.type]) MARKS[m.type](ctx, m, 1 - m.life / m.max, t || 0);
    }
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

  /** 连锁闪电：两点之间一道折线，和落雷同一套墨 + 黄 + 纸三层 */
  RZ.drawZap = function (ctx, x0, y0, x1, y1, life) {
    if (life < 6 && (life & 1)) return;
    ctx.save();
    ctx.beginPath();
    zig(ctx, x0, y0, x1, y1, 14, 9);
    ctx.lineJoin = 'miter';
    ctx.lineWidth = 11; ctx.strokeStyle = INK; ctx.stroke();
    ctx.lineWidth = 6; ctx.strokeStyle = YELLOW; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = PAPER; ctx.stroke();
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

/* 燃烧战车 — 可破坏地形
 * 地形用一张 1bit 掩码 (Uint8Array) 表示实心/空气，另有一张同尺寸的
 * ImageData 负责显示。爆炸时同时抠掉掩码与像素，只回写脏矩形。
 */
(function (RZ) {
  'use strict';

  var WORLD_W = 1900, WORLD_H = 800;
  RZ.WORLD_W = WORLD_W;
  RZ.WORLD_H = WORLD_H;

  function rnd(a, b) { return a + Math.random() * (b - a); }

  // --- 一维值噪声 ------------------------------------------------------
  function makeNoise(scale) {
    var n = Math.ceil(WORLD_W / scale) + 3, pts = new Float32Array(n);
    for (var i = 0; i < n; i++) pts[i] = Math.random();
    return function (x) {
      var t = x / scale, i0 = Math.floor(t), f = t - i0;
      var a = pts[(i0 % n + n) % n], b = pts[((i0 + 1) % n + n) % n];
      var s = f * f * (3 - 2 * f);
      return a + (b - a) * s;
    };
  }

  function fbm(scales, weights) {
    var fns = scales.map(makeNoise);
    return function (x) {
      var v = 0, tot = 0;
      for (var i = 0; i < fns.length; i++) { v += fns[i](x) * weights[i]; tot += weights[i]; }
      return v / tot;
    };
  }

  // --- 地形生成器 ------------------------------------------------------
  // 每个生成器往 mask 里写 1，坐标系原点在左上角。
  var GENERATORS = {
    hills: function (mask) {
      var f = fbm([420, 170, 62], [1, 0.45, 0.18]);
      for (var x = 0; x < WORLD_W; x++) {
        var h = 300 + f(x) * 260;
        fillColumn(mask, x, Math.floor(h), WORLD_H);
      }
    },

    ruins: function (mask) {
      var f = fbm([520, 190, 70], [1, 0.4, 0.14]);
      var x, h;
      for (x = 0; x < WORLD_W; x++) {
        h = 470 + f(x) * 190;
        fillColumn(mask, x, Math.floor(h), WORLD_H);
      }
      // 沉没的神殿立柱与残破平台
      var n = 7 + Math.floor(Math.random() * 3);
      for (var i = 0; i < n; i++) {
        var px = Math.floor(rnd(120, WORLD_W - 160));
        var top = Math.floor(rnd(180, 380));
        var wid = Math.floor(rnd(34, 62));
        var bot = surfaceY(mask, px + (wid >> 1));
        fillRect(mask, px, top, wid, bot - top);
        fillRect(mask, px - 16, top, wid + 32, 20);      // 柱头
      }
      for (i = 0; i < 4; i++) {
        var bx = Math.floor(rnd(140, WORLD_W - 260));
        fillRect(mask, bx, Math.floor(rnd(200, 320)), Math.floor(rnd(140, 240)), 26);
      }
    },

    islands: function (mask) {
      var count = 9;
      var slot = WORLD_W / count;
      for (var i = 0; i < count; i++) {
        var cx = slot * (i + 0.5) + rnd(-40, 40);
        var cy = rnd(330, 610);
        var rx = rnd(95, 175), ry = rnd(34, 62);
        blob(mask, cx, cy, rx, ry);
        if (Math.random() < 0.45) blob(mask, cx + rnd(-90, 90), cy - rnd(120, 210), rx * 0.55, ry * 0.7);
      }
      // 底部薄云台，避免一开局就掉光
      for (var k = 0; k < 3; k++) blob(mask, rnd(200, WORLD_W - 200), rnd(660, 720), rnd(120, 200), 30);
    },

    asteroids: function (mask) {
      for (var i = 0; i < 16; i++) {
        var cx = rnd(90, WORLD_W - 90), cy = rnd(260, 700);
        var r = rnd(48, 128);
        blob(mask, cx, cy, r, r * rnd(0.55, 0.85));
      }
      var f = fbm([600, 200], [1, 0.35]);
      for (var x = 0; x < WORLD_W; x++) {
        var h = 690 + f(x) * 90;
        if (h < WORLD_H - 6) fillColumn(mask, x, Math.floor(h), WORLD_H);
      }
    },

    canyon: function (mask) {
      var f = fbm([380, 140, 55], [1, 0.4, 0.16]);
      var gapC = rnd(WORLD_W * 0.38, WORLD_W * 0.62), gapW = rnd(150, 230);
      for (var x = 0; x < WORLD_W; x++) {
        var h = 290 + f(x) * 190;
        var d = Math.abs(x - gapC) / gapW;
        if (d < 1) h += (1 - d * d) * 330;              // 中间劈开一条深谷
        fillColumn(mask, x, Math.floor(Math.min(h, WORLD_H - 40)), WORLD_H);
      }
    }
  };

  function fillColumn(mask, x, y0, y1) {
    if (y0 < 0) y0 = 0;
    for (var y = y0; y < y1; y++) mask[y * WORLD_W + x] = 1;
  }
  function fillRect(mask, x0, y0, w, h) {
    for (var y = Math.max(0, y0); y < Math.min(WORLD_H, y0 + h); y++)
      for (var x = Math.max(0, x0); x < Math.min(WORLD_W, x0 + w); x++) mask[y * WORLD_W + x] = 1;
  }
  function blob(mask, cx, cy, rx, ry) {
    var wob = makeNoise(38);
    for (var y = Math.max(0, Math.floor(cy - ry * 1.4)); y < Math.min(WORLD_H, cy + ry * 1.6); y++) {
      for (var x = Math.max(0, Math.floor(cx - rx * 1.3)); x < Math.min(WORLD_W, cx + rx * 1.3); x++) {
        var dx = (x - cx) / rx, dy = (y - cy) / ry;
        var edge = 1 + (wob(x + y * 0.4) - 0.5) * 0.32;
        if (dx * dx + dy * dy <= edge) mask[y * WORLD_W + x] = 1;
      }
    }
  }
  function surfaceY(mask, x) {
    x = Math.max(0, Math.min(WORLD_W - 1, Math.floor(x)));
    for (var y = 0; y < WORLD_H; y++) if (mask[y * WORLD_W + x]) return y;
    return WORLD_H;
  }

  // --- 上色 ------------------------------------------------------------
  // 印刷品的画法：一圈墨线 + 表层平涂 + 往深处越来越密的网点。没有渐变、没有随机噪点。
  var INK = [27, 20, 16];
  var CELL = 9;                                      // 网点的格距

  /** 这个像素离空气不到 3px 吗？是的话它属于轮廓墨线 */
  function nearAir(mask, x, y) {
    if (y < 3) return y < 1 ? false : !mask[(y - 1) * WORLD_W + x];
    var i = y * WORLD_W + x;
    if (!mask[i - WORLD_W * 3] || !mask[i - WORLD_W]) return true;
    if (y + 3 < WORLD_H && !mask[i + WORLD_W * 3]) return true;
    if (x >= 3 && !mask[i - 3]) return true;
    if (x + 3 < WORLD_W && !mask[i + 3]) return true;
    if (x >= 2 && !mask[i - WORLD_W * 2 - 2]) return true;
    if (x + 2 < WORLD_W && !mask[i - WORLD_W * 2 + 2]) return true;
    return false;
  }

  /** (x, y) 落在半径 r 的网点里吗？网点按世界坐标排成错位的格子 */
  function inDot(x, y, r) {
    var row = (y / CELL) | 0;
    var dx = ((x + (row & 1 ? CELL / 2 : 0)) % CELL) - CELL / 2;
    var dy = (y % CELL) - CELL / 2;
    return dx * dx + dy * dy < r * r;
  }

  function paint(mask, img, mapDef) {
    var g = mapDef.ground;
    var top = hex(g.top), body = hex(g.body), deep = hex(g.deep);
    var d = img.data;
    var depth = new Int16Array(WORLD_W);
    for (var x = 0; x < WORLD_W; x++) depth[x] = -1;
    for (var y = 0; y < WORLD_H; y++) {
      for (x = 0; x < WORLD_W; x++) {
        var i = y * WORLD_W + x, o = i * 4;
        if (!mask[i]) { d[o + 3] = 0; depth[x] = -1; continue; }
        depth[x] = depth[x] < 0 ? 0 : depth[x] + 1;
        var dep = depth[x], c;
        if (nearAir(mask, x, y)) c = INK;
        else if (dep < 16) c = top;                                   // 表层：一条平涂的色带
        else if (dep < 19) c = deep;                                  // 表层下面压一道细线
        else c = inDot(x, y, Math.min(4.3, 1.1 + (dep - 19) / 150 * 3.2)) ? deep : body;   // 网点由小到大，到底也留着格子
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
  }
  function hex(h) { var v = parseInt(h.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

  // --- Terrain 对象 -----------------------------------------------------
  function Terrain(mapDef) {
    this.map = mapDef;
    this.w = WORLD_W; this.h = WORLD_H;
    this.mask = new Uint8Array(WORLD_W * WORLD_H);
    (GENERATORS[mapDef.gen] || GENERATORS.hills)(this.mask);

    this.canvas = document.createElement('canvas');
    this.canvas.width = WORLD_W; this.canvas.height = WORLD_H;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(WORLD_W, WORLD_H);
    paint(this.mask, this.img, mapDef);
    this.ctx.putImageData(this.img, 0, 0);
    this.dirty = null;
    this.embers = [];                                 // 还在烧的弹坑边
  }

  Terrain.prototype.solid = function (x, y) {
    x |= 0; y |= 0;
    if (x < 0 || x >= WORLD_W || y < 0) return false;
    if (y >= WORLD_H) return false;
    return this.mask[y * WORLD_W + x] === 1;
  };

  /** 从 fromY 向下找到第一格实心地面的 y；找不到返回 WORLD_H+999 */
  Terrain.prototype.groundBelow = function (x, fromY) {
    x |= 0;
    if (x < 0 || x >= WORLD_W) return WORLD_H + 999;
    var y = Math.max(0, fromY | 0);
    var m = this.mask;
    for (; y < WORLD_H; y++) if (m[y * WORLD_W + x]) return y;
    return WORLD_H + 999;
  };

  /** 战车落脚点：取车身宽度内最高的地面 */
  Terrain.prototype.supportY = function (x, halfW, fromY) {
    var best = WORLD_H + 999;
    for (var i = -halfW; i <= halfW; i += 3) {
      var y = this.groundBelow(x + i, fromY);
      if (y < best) best = y;
    }
    return best;
  };

  Terrain.prototype._touch = function (x0, y0, x1, y1) {
    var d = this.dirty;
    if (!d) { this.dirty = { x0: x0, y0: y0, x1: x1, y1: y1 }; return; }
    if (x0 < d.x0) d.x0 = x0; if (y0 < d.y0) d.y0 = y0;
    if (x1 > d.x1) d.x1 = x1; if (y1 > d.y1) d.y1 = y1;
  };

  // 弹坑边缘的余烬：刚炸开是亮黄，慢慢烧成红、暗红，最后剩一圈焦黑。
  // 这是整个画面的「签名」——燃烧战车，被炸过的地方真的会烧一会儿。
  var EMBER = [[245, 185, 33], [226, 67, 42], [122, 31, 23], [52, 34, 26]];
  var EMBER_AT = [0, 22, 60, 130];                    // 每一段颜色从第几帧开始
  var CHAR = EMBER[3];

  /**
   * 炸出一个圆坑。坑壁重新描一圈墨线，墨线外面是一圈余烬（小坑直接是焦痕）。
   * 只改掩码和像素，不碰规则——无头测试里照常能跑。
   */
  Terrain.prototype.carve = function (cx, cy, r) {
    cx |= 0; cy |= 0;
    var rim = r + 9;
    var x0 = Math.max(0, cx - rim), x1 = Math.min(WORLD_W - 1, cx + rim);
    var y0 = Math.max(0, cy - rim), y1 = Math.min(WORLD_H - 1, cy + rim);
    if (x0 > x1 || y0 > y1) return;
    var hot = r >= 20;                                 // 穿地钻那种小洞不烧，省得满屏都是
    var glow = hot ? EMBER[0] : CHAR;
    var d = this.img.data, m = this.mask, r2 = r * r, ink2 = (r + 3) * (r + 3), rim2 = rim * rim;
    for (var y = y0; y <= y1; y++) {
      var dy = y - cy, dy2 = dy * dy;
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx, dd = dx * dx + dy2;
        if (dd > rim2) continue;
        var i = y * WORLD_W + x, o = i * 4;
        if (dd <= r2) {
          m[i] = 0; d[o + 3] = 0;
        } else if (m[i]) {
          var c = dd <= ink2 ? INK : glow;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
        }
      }
    }
    this._touch(x0, y0, x1, y1);
    if (hot) {
      this.embers.push({ cx: cx, cy: cy, r: r, age: 0, stage: 0 });
      if (this.embers.length > 28) this.cool(this.embers.shift(), 3);   // 太多了就让最老的直接烧完
    }
  };

  /** 把一圈余烬重涂成第 stage 段的颜色；只涂还在的地面，已经被别的坑挖掉的不管 */
  Terrain.prototype.cool = function (e, stage) {
    var c = EMBER[stage], rim = e.r + 9;
    var x0 = Math.max(0, e.cx - rim), x1 = Math.min(WORLD_W - 1, e.cx + rim);
    var y0 = Math.max(0, e.cy - rim), y1 = Math.min(WORLD_H - 1, e.cy + rim);
    var d = this.img.data, m = this.mask, ink2 = (e.r + 3) * (e.r + 3), rim2 = rim * rim;
    for (var y = y0; y <= y1; y++) {
      var dy = y - e.cy, dy2 = dy * dy;
      for (var x = x0; x <= x1; x++) {
        var dx = x - e.cx, dd = dx * dx + dy2;
        if (dd <= ink2 || dd > rim2) continue;
        var i = y * WORLD_W + x, o = i * 4;
        // 只动仍是余烬色的像素：后来的爆炸可能已经在这里描了新的墨线
        if (!m[i] || d[o] === INK[0]) continue;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
      }
    }
    this._touch(x0, y0, x1, y1);
  };

  /** 沿线段挖一条隧道（穿地弹） */
  Terrain.prototype.tunnel = function (x0, y0, x1, y1, r) {
    var steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r * 0.5)));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      this.carve(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r);
    }
  };

  /** 把脏矩形回写到离屏画布，每帧调用一次 */
  Terrain.prototype.flush = function () {
    // 余烬降温放在这里：flush 只在真正绘制时才跑，无头模拟不用为它花一个周期
    var es = this.embers;
    for (var k = es.length - 1; k >= 0; k--) {
      var e = es[k];
      e.age++;
      if (e.stage < 3 && e.age >= EMBER_AT[e.stage + 1]) {
        e.stage++;
        this.cool(e, e.stage);
        if (e.stage === 3) es.splice(k, 1);
      }
    }
    var d = this.dirty;
    if (!d) return;
    this.ctx.putImageData(this.img, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
    this.dirty = null;
  };

  /** 为 n 个战车挑选互相分开、且脚下有地的出生点 */
  Terrain.prototype.spawnPoints = function (n) {
    var margin = 110, span = WORLD_W - margin * 2;
    var slot = span / n, pts = [], i;
    for (i = 0; i < n; i++) {
      var base = margin + slot * (i + 0.5);
      var x = base, y = this.groundBelow(x, 0), tries = 0;
      while ((y > WORLD_H - 30 || y > 740) && tries < 60) {   // 避开虚空与深坑
        x = base + (Math.random() - 0.5) * slot * 0.9;
        x = Math.max(40, Math.min(WORLD_W - 40, x));
        y = this.groundBelow(x, 0);
        tries++;
      }
      pts.push({ x: Math.round(x), y: y });
    }
    return pts;
  };

  RZ.Terrain = Terrain;
})(window.RZ || (window.RZ = {}));

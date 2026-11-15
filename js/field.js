/* 燃烧战车 — 战场上「留下来的东西」：地火、毒池、蛛网、龙卷，以及 Boss 的预告打击
 *
 * 只在爽快规则下生效（game.arc 非空）。经典规则里 hazards / telegraphs 永远是空数组，
 * 这个文件里的每个入口都先判 this.arc。
 *
 * 两个概念：
 *   区域 hazard   一发武器落地后留在场上的一块地，按「轮」计时。
 *                 任何战车在自己回合开始时站在里面就吃效果——包括放它的人自己。
 *   预告 telegraph Boss 在自己回合圈出的一块地（画成警戒线），到它下一回合才真的挨打。
 *                 玩家有一整个回合的时间挪开；这是 Boss 战的核心节奏。
 *
 * 规则放在这里，画法在 render.js（RZ.drawHazard / RZ.drawTelegraph）。
 */
(function (RZ) {
  'use strict';

  var Game = RZ.Game;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ================= 区域 =================
  // 哪种武器留下什么，写在 data.js 的 RZ.LOOKS[look].field 里：[类型, 留几轮, 强度]
  var FIELD = {
    fire:    { name: '地火', harmful: true, needsGround: true },
    pool:    { name: '毒池', harmful: true, needsGround: true },
    web:     { name: '蛛网', harmful: false, needsGround: false },
    twister: { name: '龙卷', harmful: true, needsGround: false }
  };
  RZ.FIELD = FIELD;
  var MAX_HAZARDS = 14;

  /** 一发武器落地：看它的 look 要不要在这留点什么 */
  Game.prototype.spawnField = function (x, y, radius, w, attacker) {
    if (!this.arc || w.isAfter) return;
    var def = RZ.lookOf(w).field;
    if (!def) return;
    this.addHazard(def[0], x, y, Math.max(34, radius * 0.9), def[1], def[2], attacker);
  };

  Game.prototype.addHazard = function (type, x, y, r, rounds, power, owner) {
    var i, h;
    // 赤焰「燎原」：它留下的地火多烧一轮、伤害 +50%
    if (type === 'fire' && this.arc && owner && owner.perks && owner.perks.pyro) { rounds += 1; power = Math.round(power * 1.5); }
    // 同一种东西落在一起就并成一块（散射、地毯轰炸一落就是好几发），取更久、更大的
    for (i = 0; i < this.hazards.length; i++) {
      h = this.hazards[i];
      if (h.type === type && Math.abs(h.x - x) < (h.r + r) * 0.6 && Math.abs(h.y - y) < 90) {
        var left = Math.min(h.x - h.r, x - r), right = Math.max(h.x + h.r, x + r);
        h.x = (left + right) / 2; h.r = Math.min(150, (right - left) / 2);
        h.rounds = Math.max(h.rounds, rounds); h.power = Math.max(h.power, power);
        h.owner = owner || h.owner;
        this.placeHazard(h);
        return h;
      }
    }
    h = { type: type, x: x, y: y, r: r, rounds: rounds, power: power, owner: owner || null, born: this.t, seed: Math.random() * 6.28, pts: [] };
    this.hazards.push(h);
    if (this.hazards.length > MAX_HAZARDS) this.hazards.shift();
    this.placeHazard(h);
    return h;
  };

  /**
   * 把区域贴到地面上：地被炸没了，火和毒池跟着掉下去；底下彻底空了就没了。
   * pts 是画火苗 / 毒池用的一排落脚点 [x, y, …]。返回 false 表示这块区域该消失了。
   */
  Game.prototype.placeHazard = function (h) {
    var def = FIELD[h.type];
    var g = this.terrain.groundBelow(clamp(h.x, 2, RZ.WORLD_W - 2), Math.max(0, h.y - h.r - 30));
    if (g < RZ.WORLD_H - 4) h.y = def.needsGround ? g : Math.min(h.y, g);
    else if (def.needsGround) return false;
    h.pts.length = 0;
    if (def.needsGround) {
      var n = Math.max(3, Math.round(h.r / 13));
      for (var i = 0; i < n; i++) {
        var px = clamp(h.x - h.r + (i + 0.5) / n * h.r * 2, 2, RZ.WORLD_W - 2);
        var py = this.terrain.groundBelow(px, Math.max(0, h.y - h.r - 30));
        if (py < RZ.WORLD_H - 4 && Math.abs(py - h.y) < h.r * 1.6) h.pts.push(px, py);
      }
      if (!h.pts.length) return false;
    }
    return true;
  };

  Game.prototype.inHazard = function (h, u) {
    return Math.abs(u.x - h.x) < h.r && Math.abs((u.y - 12) - h.y) < h.r * 1.2 + 26;
  };
  Game.prototype.hazardsAt = function (u, type) {
    for (var i = 0; i < this.hazards.length; i++) {
      var h = this.hazards[i];
      if ((!type || h.type === type) && this.inHazard(h, u)) return h;
    }
    return null;
  };

  /** 新的一轮开始：所有区域少一轮 */
  Game.prototype.fieldRoundStart = function () {
    for (var i = this.hazards.length - 1; i >= 0; i--) {
      if (--this.hazards[i].rounds <= 0) this.hazards.splice(i, 1);
    }
  };

  /** 地形会变，每隔一会儿把区域重新贴一次地 */
  Game.prototype.updateField = function () {
    if ((this.t / 16) % 20 > 1) return;
    for (var i = this.hazards.length - 1; i >= 0; i--) {
      if (!this.placeHazard(this.hazards[i])) this.hazards.splice(i, 1);
    }
  };

  /** 轮到 u 了：它站在哪块区域里，就吃哪块的效果。每种只吃一次 */
  Game.prototype.fieldTurnStart = function (u) {
    var seen = {}, i;
    for (i = 0; i < this.hazards.length && u.alive; i++) {
      var h = this.hazards[i];
      if (seen[h.type] || !this.inHazard(h, u)) continue;
      seen[h.type] = true;
      if (h.type === 'fire') {
        if (u.perks.pyro) continue;                     // 赤焰站在火里不受伤
        this.fx.text(u.x, u.y - 100, '地火', '#ff9d3d');
        this.damage(u, h.power, null, '#ff9d3d');
        this.turnsSinceDamage = 0;
      } else if (h.type === 'pool') {
        this.fx.text(u.x, u.y - 100, '毒池', '#9cff5a');
        u.dots.push({ type: 'poison', turns: 2, damage: h.power });
      } else if (h.type === 'web') {
        this.fx.text(u.x, u.y - 100, '被网粘住了', RZ.PAPER);
      } else if (h.type === 'twister') {
        this.toss(u, h.owner);
      }
    }
  };

  /** 被龙卷卷起来：顺着当前风向甩出去。带磁力底盘的纹丝不动 */
  Game.prototype.toss = function (u, by) {
    if (!u.alive || u.perks.anchor) return;
    var dir = this.wind > 0.5 ? 1 : this.wind < -0.5 ? -1 : (Math.random() < 0.5 ? -1 : 1);
    var strength = Math.abs(this.wind) / Math.max(1, this.map.windMax);
    u.vx += dir * (3.2 + strength * 3) / u.scale;
    u.vy = -7.5 / u.scale;
    u.airborne = true; u.fallFrom = u.y;
    if (by) u.lastHitBy = by;
    this.fx.text(u.x, u.y - 100, '被卷走了！', '#dff6ff', true);
    this.fx.mark({ type: 'whirl', x: u.x, y: u.y - 20, r: 50, life: 24, seed: Math.random() * 6.28 });
    RZ.SFX.explode({ kind: 'wind' });
  };

  /** 在蛛网里：移动耗油 ×3，被击飞的距离只剩三成 */
  Game.prototype.moveMul = function (u) { return this.hazardsAt(u, 'web') ? 3 : 1; };
  Game.prototype.pushMul = function (u) { return this.hazardsAt(u, 'web') ? 0.3 : 1; };

  // ================= 危险地带（给电脑用） =================
  /** x 这个位置现在站不得吗？会伤人的区域和 Boss 圈出来的地都算 */
  Game.prototype.dangerAt = function (x, y) {
    var i;
    for (i = 0; i < this.hazards.length; i++) {
      var h = this.hazards[i];
      if (FIELD[h.type].harmful && Math.abs(x - h.x) < h.r + 6 && Math.abs((y - 12) - h.y) < h.r * 1.2 + 26) return true;
    }
    for (i = 0; i < this.telegraphs.length; i++) {
      if (Math.abs(x - this.telegraphs[i].x) < this.telegraphs[i].r + 10) return true;
    }
    return false;
  };

  /**
   * 电脑站在危险地带里：往哪边走、走多远能出去？两边各探一遍，挑近的、脚下有地的那边。
   * 返回 {dir, steps}（steps 是 moveActive 的调用次数），没危险或走不出去返回 null。
   */
  Game.prototype.escapePlan = function (u) {
    if (!this.arc || u.airborne || u.stunned > 0 || !this.dangerAt(u.x, u.y)) return null;
    var best = null;
    for (var dir = -1; dir <= 1; dir += 2) {
      for (var d = 16; d <= 300; d += 16) {
        var x = u.x + dir * d;
        if (x < 30 || x > RZ.WORLD_W - 30) break;
        var g = this.terrain.groundBelow(x, Math.max(0, u.y - 120));
        if (g >= RZ.WORLD_H - 4) break;                 // 前面没地了，别往下跳
        if (Math.abs(g - u.y) > 110) break;             // 悬崖或峭壁，过不去
        if (!this.dangerAt(x, g)) {
          if (!best || d < best.d) best = { dir: dir, d: d + 14 };
          break;
        }
      }
    }
    if (!best) return null;
    var cost = best.d * u.vehicle.moveCost * this.moveMul(u) * 1.3;
    if (u.fuel - cost < 0) return null;                 // 油不够，认了
    return { dir: best.dir, steps: Math.ceil(best.d / 1.7) };
  };

  // ================= Boss =================
  // 每个 Boss 一套「招式表」。phases 按血量从高到低排，below 是进入这一阶段的血量比例。
  //   every   每隔几个自己的回合圈一次地
  //   zones   一次圈几块；spread 是相邻两块的间距；line=true 时排成一排，否则左右随机
  //   strike  圈的地到时候落下什么：mortar 炮击 / bolt 落雷 / fire 喷火（留地火）/ twister 龙卷
  //   enter   进入这一阶段时发生的事：say 喊话、quake 地震、barrels 天降油桶、atk 攻击倍率
  // wind：每回合把风拧向玩家（0~1，占最大风力的比例）。guard：护卫在场时的减伤。
  RZ.BOSS_KITS = {
    crusher: {
      intro: '碾压者会先圈地、下一回合才炮击——看到警戒线就挪开',
      phases: [
        { below: 2, every: 2, zones: 2, spread: 150, strike: 'mortar', power: 150, r: 62 },
        { below: 0.5, every: 2, zones: 3, spread: 140, strike: 'mortar', power: 165, r: 62,
          enter: { say: '碾压者暴怒了！', quake: 40, barrels: 3, atk: 1.15 } }
      ]
    },
    queen: {
      intro: '风暴女王每回合都会把风拧向你，还会圈地放龙卷',
      wind: 0.5,
      phases: [
        { below: 2, every: 2, zones: 1, spread: 0, strike: 'twister', power: 0, r: 74 },
        { below: 0.5, every: 2, zones: 3, spread: 86, line: true, strike: 'bolt', power: 125, r: 30,
          enter: { say: '风暴女王召来了雷云！' } }
      ]
    },
    doom: {
      intro: '护卫还活着时，终焉战车受到的伤害会被挡掉一部分——先清护卫',
      guard: 0.75,
      phases: [
        { below: 2, every: 2, zones: 2, spread: 150, strike: 'fire', power: 90, r: 56 },
        { below: 0.66, every: 2, zones: 3, spread: 130, strike: 'fire', power: 100, r: 56,
          enter: { say: '终焉战车的炉心开始过载' } },
        { below: 0.33, every: 1, zones: 3, spread: 150, strike: 'fire', power: 110, r: 60,
          enter: { say: '终焉战车进入狂暴！', atk: 1.2, quake: 30 } }
      ]
    }
  };

  // 预告落地时用的几把「武器」。走的是普通的 explode()，所以击飞、油桶连锁、地火全都照常生效。
  // ================= 地图词条 =================
  // 远征里的战斗节点可能带一条。规则在 game.js（大风 / 低重力 / 夜战）和下面的 meteorRound()。
  RZ.MAP_MODS = {
    gale: { name: '大风', desc: '风力上限接近翻倍，一回合能变的幅度也跟着变大。' },
    lowg: { name: '低重力', desc: '炮弹飞得更久，被击飞的车也飘得更远。' },
    night: { name: '夜战', desc: '看不见敌人，除非它被炸到、被火光照到，或者离你很近。对面也一样。' },
    meteor: { name: '陨石雨', desc: '每一轮开头圈出两块地，下一轮开头陨石落下，砸到谁算谁。' }
  };

  /**
   * 陨石雨：每一轮开头，上一轮圈的先落，再圈两块新的。一轮里每辆车正好出手一次，
   * 所以圈到谁头上，谁都有一个回合挪开。一块压在随机一辆车附近，一块纯随机——不偏袒哪一边。
   */
  Game.prototype.meteorRound = function () {
    this.resolveTelegraphs(null);
    var alive = this.units.filter(function (u) { return u.alive; });
    if (!alive.length) return;
    var near = alive[(Math.random() * alive.length) | 0];
    var xs = [near.x + (Math.random() - 0.5) * 120, 120 + Math.random() * (RZ.WORLD_W - 240)];
    for (var i = 0; i < xs.length; i++) {
      this.telegraphs.push({ x: clamp(xs[i], 40, RZ.WORLD_W - 40), r: 62, owner: null, armed: true,
        strike: 'meteor', power: 95, born: this.t, seed: Math.random() * 6.28 });
    }
    this.say('陨石要来了——看警戒线', '#ffd166');
    RZ.SFX.tick();
  };

  var STRIKES = {
    meteor: { name: '陨石', look: 'meteor', count: 1, digMul: 1.25, kb: 1.2, shell: { r: 9, color: '#ffd9a0', glow: '#ff5b2a', trail: '#ff7a3d' } },
    mortar: { name: '炮击', look: 'mortar', count: 1, digMul: 1.1, shell: { r: 7, color: '#ffe9b0', glow: '#c9a227', trail: '#e8c060' } },
    bolt:   { name: '落雷', look: 'storm', count: 1, digMul: 1.2, onImpact: 'lightning', shell: { r: 5, color: '#fff7a8', glow: '#ffd21f', trail: '#ffe870' } },
    fire:   { name: '喷火', look: 'napalm', count: 1, digMul: 0.8, shell: { r: 6, color: '#ffe08a', glow: '#ff3b1f', trail: '#ff5b2a' },
              dot: { type: 'fire', turns: 1, damage: 30 } }
  };

  Game.prototype.bossPhase = function (u) {
    var kit = RZ.BOSS_KITS[u.kit], ratio = u.hp / u.maxHp, idx = 0;
    for (var i = 0; i < kit.phases.length; i++) if (ratio <= kit.phases[i].below) idx = i;
    return idx;
  };

  /** 护卫在场时 Boss 的减伤（damage() 里调用）。返回伤害倍率 */
  Game.prototype.guardMul = function (target) {
    var kit = target.kit && RZ.BOSS_KITS[target.kit];
    if (!kit || !kit.guard) return 1;
    for (var i = 0; i < this.units.length; i++) {
      var o = this.units[i];
      if (o !== target && o.alive && o.team === target.team) return kit.guard;
    }
    return 1;
  };

  /** Boss 的回合开始：先让上回合圈的地落下来，再看要不要换阶段、要不要圈新的 */
  Game.prototype.bossTurnStart = function (u) {
    var kit = RZ.BOSS_KITS[u.kit];
    if (!kit) return;
    var landed = this.resolveTelegraphs(u);

    var idx = this.bossPhase(u), ph = kit.phases[idx];
    if (idx > (u.kitPhase || 0)) {
      u.kitPhase = idx;
      u.kitTurn = 0;                                   // 换阶段后立刻出一次新招
      if (ph.enter) this.bossEnter(u, ph.enter);
    }
    if (kit.wind) {
      var foe = this.bossTarget(u);
      if (foe) {
        var want = (foe.x >= u.x ? 1 : -1) * this.map.windMax * kit.wind;
        if (Math.abs(this.wind - want) > 1) {
          this.wind = want;
          this.say(u.name + '把风拧向了你', '#dff6ff');
        }
      }
    }
    u.kitTurn = (u.kitTurn || 0);
    // 上一批还没落（对手还没轮到过）：这回合不圈新的，也不推进节拍，免得警戒线越叠越多
    var waiting = false;
    for (var q = 0; q < this.telegraphs.length; q++) if (this.telegraphs[q].owner === u) waiting = true;
    if (!waiting) {
      if (u.kitTurn % ph.every === 0) this.bossMark(u, ph);
      u.kitTurn++;
    }
    // 有东西正在落地：等它炸完电脑再瞄，不然它算弹道时用的还是炸之前的地形
    if (landed) this.aiTimer = Math.max(this.aiTimer, 50 + landed * 12);
  };

  Game.prototype.bossTarget = function (u) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.units.length; i++) {
      var o = this.units[i];
      if (!o.alive || o.team === u.team) continue;
      var d = Math.abs(this.knownPos(u.team, o).x - u.x);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };

  Game.prototype.bossEnter = function (u, e) {
    var i;
    if (e.say) { this.say(e.say, '#ff5a5a'); this.banner = { text: e.say, sub: '', life: 80, max: 80 }; }
    if (e.atk) u.atk = Math.round(u.atk * e.atk);
    if (e.quake) {                                      // 地震：全场站在地上的车都被震起来
      this.cam.shake = Math.max(this.cam.shake, 22);
      RZ.SFX.explode({ big: true, kind: 'heavy' });
      for (i = 0; i < this.units.length; i++) {
        var o = this.units[i];
        if (!o.alive || o === u || o.airborne) continue;
        if (!o.perks.anchor) { o.vy = -6.5; o.airborne = true; o.fallFrom = o.y; }
        this.damage(o, e.quake, null, '#ffd166');
      }
    }
    if (e.barrels) {                                    // 天上掉油桶
      for (i = 0; i < e.barrels; i++) {
        var bx = clamp(u.x + (Math.random() < 0.5 ? -1 : 1) * (160 + Math.random() * 420), 60, RZ.WORLD_W - 60);
        this.props.push({ x: Math.round(bx), y: -40 - i * 60, vy: 0, lit: false });
      }
    }
    RZ.SFX.overheat();
  };

  /** 圈地：第一块压在目标脚下，其余的往两边摆 */
  Game.prototype.bossMark = function (u, ph) {
    var foe = this.bossTarget(u);
    if (!foe) return;
    var p = this.knownPos(u.team, foe), side = Math.random() < 0.5 ? -1 : 1;
    for (var i = 0; i < ph.zones; i++) {
      var off;
      if (ph.line) off = (i - (ph.zones - 1) / 2) * ph.spread;                       // 一字排开，中间那块压在目标上
      else off = i === 0 ? 0 : side * (i % 2 ? 1 : -1) * Math.ceil(i / 2) * ph.spread * (0.8 + Math.random() * 0.4);
      var x = clamp(p.x + off + (Math.random() - 0.5) * 24, 30, RZ.WORLD_W - 30);
      this.telegraphs.push({ x: x, r: ph.r, owner: u, strike: ph.strike, power: ph.power, born: this.t, seed: Math.random() * 6.28 });
    }
    var what = { mortar: '炮击', bolt: '落雷', fire: '喷火', twister: '龙卷' }[ph.strike];
    this.say(u.name + '圈定了' + what + '区域——挪开！', '#ffd166');
    RZ.SFX.tick();
  };

  /** 让 owner 上回合圈的地全部落下来。返回落了几块 */
  /**
   * 警戒线要等「对手真的有过一个能动的回合」才算数。
   * 轮次规则允许同一辆车连着出手两次（上一轮压轴 + 下一轮打头），Boss 赶上连动时，
   * 刚圈的地下一手就落——玩家根本没机会挪。所以落不落看的是对手轮到过没有，不是 Boss 自己过了几回合。
   * 被麻痹的回合不算：动不了等于没轮到。
   */
  Game.prototype.armTelegraphs = function (u) {
    if (u.stunned > 0) return;
    for (var i = 0; i < this.telegraphs.length; i++) {
      var tg = this.telegraphs[i];
      if (tg.owner && tg.owner.team !== u.team) tg.armed = true;      // 陨石（owner 为 null）按轮落，不走这条
    }
  };

  Game.prototype.resolveTelegraphs = function (owner) {
    var n = 0;
    for (var i = this.telegraphs.length - 1; i >= 0; i--) {
      var tg = this.telegraphs[i];
      if (tg.owner !== owner || !tg.armed) continue;
      this.telegraphs.splice(i, 1);
      var gy = this.terrain.groundBelow(clamp(tg.x, 2, RZ.WORLD_W - 2), 0);
      if (gy >= RZ.WORLD_H - 4) gy = RZ.WORLD_H * 0.6;          // 底下是空的：在半空炸（龙卷也立得住）
      if (tg.strike === 'twister') {
        var h = this.addHazard('twister', tg.x, gy - 20, tg.r, 2, 0, owner);
        this.fx.mark({ type: 'twister', x: tg.x, y: gy, r: tg.r * 0.7, life: 50, seed: tg.seed });
        for (var k = 0; k < this.units.length; k++) {
          if (this.units[k].alive && this.units[k] !== owner && this.inHazard(h, this.units[k])) this.toss(this.units[k], owner);
        }
      } else {
        var w = Object.create(STRIKES[tg.strike]);
        w.damage = tg.power; w.radius = tg.r * (tg.strike === 'bolt' ? 1.2 : 1);
        // 一块一块地落，间隔十几帧，看得清也听得清
        this.pendingBlasts.push({ wait: 6 + n * 12, x: tg.x, y: gy - 4, w: w, attacker: owner, mul: 1, skyfall: true });
      }
      n++;
    }
    return n;
  };

  /** Boss 死了：它圈的地作废 */
  Game.prototype.clearTelegraphs = function (owner) {
    for (var i = this.telegraphs.length - 1; i >= 0; i--) {
      if (this.telegraphs[i].owner === owner) this.telegraphs.splice(i, 1);
    }
  };
})(window.RZ || (window.RZ = {}));

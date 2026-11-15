/* 燃烧战车 — 对战核心：回合、延迟出手顺序、伤害结算、镜头 */
(function (RZ) {
  'use strict';

  var TURN_TIME = 30;          // 每回合秒数
  var PASS_DELAY = 480;        // 超时未开火的延迟惩罚
  var FALL_SAFE = 130;         // 安全落差
  var CHARGE_RATE = 0.8;       // 每帧蓄力增幅：满条约 2 秒，留出微调余地
  var HALF_W = 8;              // 落脚检测的车身半宽：太宽会让车悬在凸坡上方
  var MAX_WIND_STEP = 0.3;     // 单回合风力最多变动 windMax 的三成

  // 「爽快」规则集的旋钮：远征模式和经典对战里的可选规则都用它。
  // 经典规则下 game.arc 是 null，下面所有带 this.arc 的分支都不会走到，
  // 所以原版的数值、轮次、信息隐藏一条都没动。
  var ARCADE = {
    startFuel: 60,             // 开局就摸得到二号武器，三四回合一发必杀
    regenMul: 1.6,
    charge: 1.0,               // 满条约 1.7 秒。1.3 太快：一帧就是 1.3 点力度，落点差出几十像素
    markDefault: 55,           // 还没打过、也没标过时，预览线按这个力度画
    aiWait: 12,
    settle: 20,
    overheatRound: 9           // 第几轮开始「战场过热」，逼着双方分出胜负
  };
  // 油桶：谁炸到算谁的，连锁也算
  var BARREL = {
    name: '油桶', fuel: 0, damage: 170, radius: 84, digMul: 0.9, count: 1, isBarrel: true,
    shell: { r: 6, color: '#ffe08a', glow: '#ff3b1f', trail: '#ff5b2a' },
    dot: { type: 'fire', turns: 2, damage: 30 }
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ================= 战车实例 =================
  function Unit(cfg, index, arc) {
    var v = cfg.vehicle;
    // perks 是远征遗物折算出来的一组数值加成；经典模式下是空对象，读出来全是 undefined
    this.perks = cfg.perks || {};
    this.scale = cfg.scale || 1;       // Boss 画得更大、也更好打中
    this.boss = !!cfg.boss;
    this.aiLevel = cfg.aiLevel || null;
    this.kit = cfg.kit || null;         // Boss 的招式表，见 field.js 的 RZ.BOSS_KITS
    this.kitPhase = 0; this.kitTurn = 0;
    this.vx = 0;                       // 被爆炸击飞时的水平速度（仅爽快规则）
    this.streak = 0;                   // 连续命中的回合数
    this.firstShot = true;
    this.turnsTaken = 0;
    this.reviveLeft = this.perks.revive || 0;
    this.safeX = 0;                              // 最近一次站稳的位置
    this.revived = false;
    this.index = index;
    this.vehicle = v;
    this.name = cfg.name;
    this.team = cfg.team;
    this.ai = !!cfg.ai;
    this.maxHp = v.hp; this.hp = cfg.hp != null ? Math.min(v.hp, cfg.hp) : v.hp;
    this.atk = v.atk; this.def = v.def;
    this.maxFuel = RZ.MAX_FUEL;
    this.fuel = arc ? (this.perks.noStartFuel ? 0 : Math.min(RZ.MAX_FUEL, arc.startFuel + (this.perks.startFuel || 0))) : RZ.START_FUEL;
    this.spentThisTurn = 0;      // 本回合总耗油，决定这一手的延迟
    this.moveSpent = 0;          // 其中花在移动上的部分，跑太多要扣回油
    this.dealtThisTurn = 0;      // 本回合打出的伤害，打中人有回油奖励
    this.firedThisTurn = false;
    this.items = (cfg.items || []).slice(0, RZ.MAX_ITEMS);
    this.usedItemFlash = 0;      // 车身上「正在用道具」的提示，不暴露用的是哪个
    // 增益：本回合限定的用完即清，带回合数的按「自己的回合」递减
    this.buffDouble = false;     // 双倍攻击：这一发打两枚
    this.buffPower = 0;          // 加强攻击：剩余回合数，开火时消耗
    this.shotMode = null;        // 'fly' | 'stun'：这一发换成道具炮弹
    this.stunned = 0;            // 麻痹：剩余回合数，动不了
    this.stealth = 0;            // 隐身：剩余回合数
    this.noFire = false;         // 飞行之后本回合不能再开火
    this.climb = v.climb;
    this.x = 0; this.y = 0; this.vy = 0;
    this.face = 1; this.aim = 45; this.power = 0;
    this.lastSeenX = 0; this.lastSeenY = 0;   // 隐身前最后被看到的位置
    this.lastPower = 0;          // 上一发用的力度，作为蓄力条上的参考刻度
    this.markPower = 0;          // 玩家在蓄力条上标的力度（爽快规则）；0 = 没标，跟着上一发走
    this.weaponIdx = 0;
    this.delay = 0;              // 上一次出手的延迟值，只用来排下一轮的先后
    // 位次用负的 index 起头：开局第一轮仍按出场顺序，之后才轮到「上轮靠后者先动」
    this.roundPos = -index;      // 本轮的出手位次
    this.lastPos = -index;       // 上一轮的位次，用来打破平局
    this.alive = true;
    this.airborne = false; this.fallFrom = 0;
    this.dots = [];
    this.hitFlash = 0; this.muzzleFlash = 0;
  }

  Unit.prototype.weapon = function () {
    var v = this.vehicle;
    return this.weaponIdx === 0 ? v.w1 : this.weaponIdx === 1 ? v.w2 : v.ss;
  };
  /** 燃料够不够开这一炮 */
  Unit.prototype.canAfford = function (weapon) { return this.fuel >= weapon.fuel; };

  // ================= 对局 =================
  function Game(opts) {
    this.opts = opts;
    this.map = RZ.mapById(opts.mapId);
    this.terrain = new RZ.Terrain(this.map);
    this.bg = new RZ.Background(this.map);
    this.fx = new RZ.Particles();
    this.night = opts.night != null ? opts.night : Math.random() * 0.85;
    this.guide = !!opts.guide;
    this.log = [];

    this.arc = opts.arcade ? ARCADE : null;
    this.hardcore = !!opts.hardcore;     // 爽快规则下的硬核开关：不给弹道预览和出手队列
    this.props = [];                     // 油桶
    this.hazards = [];                   // 留在场上的区域：地火、毒池、蛛网、龙卷（field.js）
    this.telegraphs = [];                // Boss 圈出来、下回合才落地的打击（field.js）
    this.pendingBlasts = [];             // 延迟引爆：油桶连锁、余震
    this.hitstop = 0;                    // 顿帧
    this.preShow = 0;                    // 电脑回合里玩家动了角度 / 标记 / 武器：预览线再亮多少帧
    this.slowmo = 0;                     // 击破时的慢动作
    this.banner = null;                  // 画面中央的喝彩字
    this.style = { gold: 0, tags: {} };  // 花式命中攒下的赏金，远征结算时用
    this.killsThisTurn = 0;

    this.units = [];
    var i;
    for (i = 0; i < opts.roster.length; i++) this.units.push(new Unit(opts.roster[i], i, this.arc));

    var pts = this.terrain.spawnPoints(this.units.length);
    // 让同队战车不要挤在一起：红队占奇数位，蓝队占偶数位
    var order = pts.map(function (p, idx) { return idx; });
    for (i = 0; i < this.units.length; i++) {
      var p = pts[order[i]];
      this.units[i].x = p.x;
      this.units[i].y = Math.min(p.y, RZ.WORLD_H - 20);
      this.units[i].face = p.x < RZ.WORLD_W / 2 ? 1 : -1;
      this.units[i].lastSeenX = this.units[i].x;
      this.units[i].lastSeenY = this.units[i].y;
    }

    this.projectiles = [];
    this.pendingSpawn = [];
    this.effects = [];
    this.supplies = [];
    this.wind = Math.round((Math.random() - 0.5) * this.map.windMax * 0.8);
    this.turnNo = 0;
    this.round = 0;
    this.roundQueue = [];
    this.phase = 'aim';
    this.settleTimer = 0;
    this.timeLeft = TURN_TIME;
    this.lastTick = -1;
    this.charging = false;
    this.timedOut = false;
    this.repeatShot = null;
    this.flyBack = false;
    this.turnsSinceDamage = 0;   // 连续多少回合没人掉血，用来识别僵局
    this.result = null;
    this.messages = [];
    this.t = 0;

    this.viewW = 1100; this.viewH = 620;   // draw() 每帧会覆盖成真实视口
    this.cam = { x: 0, y: 0, tx: 0, ty: 0, shake: 0 };
    this.active = null;
    this.aiPlan = null;
    this.aiTimer = 0;

    if (this.arc) this.placeProps();
    this.beginTurn(true);
    for (i = 0; i < this.units.length; i++) {            // Boss 战开场先说清楚它的规矩
      var kit = this.units[i].kit && RZ.BOSS_KITS[this.units[i].kit];
      if (kit && kit.intro) this.say(kit.intro, '#ffd166');
    }
  }

  Game.prototype.aliveOf = function (team) {
    return this.units.filter(function (u) { return u.alive && u.team === team; });
  };

  /** 本轮（或下一轮）的出手顺序：延迟小的先动，平局时上一轮排在后面的优先 */
  function orderBy(list) {
    return list.slice().sort(function (a, b) {
      return (a.delay - b.delay) || (b.lastPos - a.lastPos) || (a.index - b.index);
    });
  }

  Game.prototype.turnOrder = function () {
    return orderBy(this.units.filter(function (u) { return u.alive; }));
  };

  /**
   * 开新一轮。这是全局的核心规则：**每一轮里每辆车都恰好出手一次**，
   * 延迟只决定这一轮内部的先后，不会让谁整轮消失。
   * 所以同一辆车最多连着出手两次（上一轮压轴 + 下一轮打头），不可能三次。
   */
  Game.prototype.startRound = function () {
    var i, alive = [];
    for (i = 0; i < this.units.length; i++) {
      this.units[i].lastPos = this.units[i].roundPos;
      if (this.units[i].alive) alive.push(this.units[i]);
    }
    var ordered = orderBy(alive);
    for (i = 0; i < ordered.length; i++) ordered[i].roundPos = i;
    this.round++;
    this.roundQueue = ordered;
    this.roundQueueFirst = ordered[0];
    if (this.arc) this.fieldRoundStart();
  };

  /**
   * 下方面板该显示哪辆车。轮到玩家自己时就是当前战车；轮到电脑（或 2v2 里的
   * 电脑队友）时退回玩家自己的车——否则角度、力度、选中的武器全被提前看光。
   * 同屏双人时行动的那位就坐在键盘前，照常显示当前战车。
   */
  Game.prototype.viewUnit = function () {
    var a = this.active, i;
    if (a && !a.ai) return a;
    for (i = 0; i < this.units.length; i++) {
      if (!this.units[i].ai && this.units[i].alive) return this.units[i];
    }
    for (i = 0; i < this.units.length; i++) {          // 自己的车已被击破
      if (!this.units[i].ai) return this.units[i];
    }
    return null;
  };

  /**
   * 下方面板该显示的一组读数。刻意做成与 DOM 无关的纯函数：
   * 「不是自己的回合就不能显示对方的力度/角度/武器」这条规则要能被直接测到。
   */
  Game.prototype.hudState = function () {
    var view = this.viewUnit();
    var live = !!view && view === this.active;
    if (!view) return { unit: null, live: false };
    return {
      unit: view,
      live: live,
      name: view.name,
      tag: live ? (this.opts.humanTeam == null ? RZ.TEAM_NAMES[view.team] : '你的战车') : '待命中',
      hp: Math.max(0, Math.round(view.hp)),
      hpPct: Math.max(0, view.hp / view.maxHp * 100),
      fuel: Math.round(view.fuel),
      fuelPct: view.fuel / view.maxFuel * 100,
      maxFuel: view.maxFuel,
      spent: Math.round(view.spentThisTurn),
      aim: Math.round(view.aim),
      power: live ? Math.round(view.power) : 0,     // 别人的蓄力不给看
      lastPower: view.lastPower,
      // 预览线是按哪个力度画的。经典 / 硬核没有预览，也就没有标记（null）
      mark: this.markOf(view),
      pre: !live && view === this.preUnit(),            // 电脑的回合，但角度 / 标记 / 武器可以先摆好
      markSet: view.markPower > 0,
      weaponIdx: view.weaponIdx,
      weaponFuel: view.weapon().fuel,
      canSS: view.canAfford(view.vehicle.ss),
      queue: this.queueView()
    };
  };

  /**
   * 出手队列：只有爽快规则、且没开硬核时才给。经典规则永远返回 null——
   * 「不显示出手顺序」那条不变量靠这里守着。
   */
  Game.prototype.queueView = function () {
    if (!this.arc || this.hardcore) return null;
    var out = [], i;
    if (this.active && this.active.alive) out.push(this.active);
    for (i = 0; i < this.roundQueue.length; i++) if (this.roundQueue[i].alive) out.push(this.roundQueue[i]);
    return out.map(function (u) { return { name: u.name, team: u.team, index: u.index }; });
  };

  /** 界面替谁在看：单人是玩家那一队，同屏双人就是当前行动的那一队 */
  Game.prototype.viewerTeam = function () {
    if (this.opts.humanTeam != null) return this.opts.humanTeam;
    return this.active ? this.active.team : 0;
  };

  /** 这辆车对某一队是不是隐身的 */
  Game.prototype.hiddenFrom = function (team, u) {
    return u.stealth > 0 && u.team !== team;
  };

  /**
   * 某一队「以为」这辆车在哪。隐身期间只知道它消失前的位置——
   * 电脑也用这个函数瞄准，不许偷看真坐标。
   */
  Game.prototype.knownPos = function (team, u) {
    if (this.hiddenFrom(team, u)) return { x: u.lastSeenX, y: u.lastSeenY };
    return { x: u.x, y: u.y };
  };

  Game.prototype.say = function (text, color) {
    this.messages.push({ text: text, color: color || '#ffe6a8', life: 150 });
    if (this.messages.length > 4) this.messages.shift();
  };

  /** 取出本轮下一个还活着的；本轮打完就开新一轮 */
  Game.prototype.nextInRound = function () {
    for (var guard = 0; guard < 2; guard++) {
      while (this.roundQueue && this.roundQueue.length) {
        var cand = this.roundQueue.shift();
        if (cand.alive) return cand;
      }
      this.startRound();
    }
    return null;
  };

  // ---- 回合开始 ----
  Game.prototype.beginTurn = function (first) {
    if (this.result !== null) return;
    var u = this.nextInRound();
    if (!u) return;

    this.active = u;
    this.turnNo++;
    this.turnsSinceDamage++;
    u.power = 0;
    u.spentThisTurn = 0;
    u.moveSpent = 0;
    u.firedThisTurn = false;
    u.dealtThisTurn = 0;
    u.noFire = false;
    u.buffDouble = false;        // 双倍只在用它的那个回合有效
    u.shotMode = null;
    this.killsThisTurn = 0;
    if (this.arc) this.arcadeTurnStart(u);
    if (!u.canAfford(u.weapon())) u.weaponIdx = 0;   // 油不够就退回一号武器
    this.charging = false;
    this.phase = 'aim';
    this.timeLeft = TURN_TIME;
    this.aiPlan = null;
    this.aiTimer = this.arc ? this.arc.aiWait : 24;

    if (!first) this.stepWind();      // 开局那阵风用构造时定的，不再多走一步
    if (this.arc) {
      this.fieldTurnStart(u);                           // 站在地火 / 毒池 / 龙卷里
      this.armTelegraphs(u);                            // 轮到过对手的警戒线才算数（见 field.js）
      if (u.kit && u.alive) this.bossTurnStart(u);      // Boss：上回合圈的地落下来，再圈新的
      if (u.alive && !u.ai && this.dangerAt(u.x, u.y)) this.say('你脚下有危险——挪开！', '#ff5a5a');
    }

    this.applyDots(u);
    if (u.alive && !u.ai && !u.canAfford(u.vehicle.w1)) {
      this.say('燃料不足，按 Enter 跳过本回合攒油', '#ffb4b4');
    }
    if (!first) RZ.SFX.turn(!u.ai);
    if (this.turnNo % 4 === 0) this.dropSupply();
    this.checkWin();
    // 回合一开头就被持续伤害 / 过热烧死：直接交出回合，别让一辆残骸占着三十秒
    if (!u.alive && this.result === null) { this.phase = 'settle'; this.settleTimer = 12; }
  };

  /** 爽快规则下每回合开头要结算的东西：遗物、过热 */
  Game.prototype.arcadeTurnStart = function (u) {
    var pk = u.perks;
    u.turnsTaken++;
    u.braced = false;                                    // 铁壁只护到再次轮到自己
    if (pk.ambushDouble && u.firstShot) {                // 联动「首轮齐射」
      u.buffDouble = true;
      this.fx.text(u.x, u.y - 118, '首轮齐射', '#ff7a3d');
    }
    if (pk.repair && u.hp < u.maxHp) this.heal(u, u.maxHp * pk.repair);
    if (pk.autoDouble && u.turnsTaken % 3 === 0) {
      u.buffDouble = true;
      this.fx.text(u.x, u.y - 104, '自动装填', '#ff7a3d');
    }
    // 战场过热：拖得越久烧得越狠，按最大耐久的百分比扣，对谁都一样
    var over = this.round - this.arc.overheatRound;
    if (over >= 0) {
      if (over === 0 && u === this.roundQueueFirst) { this.say('战场过热！所有战车每回合持续受损', '#ff7b3d'); RZ.SFX.overheat(); }
      this.damage(u, Math.round(u.maxHp * 0.04 * (over + 1)), null, '#ff7b3d');
    }
  };

  /**
   * 风向按回合演化，两条原则：
   *   1. 单回合变化幅度有上限，不会从 +10 一步跳到 -1；
   *   2. 越靠近 ±windMax，往回拉的力越强（三次方），所以极端风撑不了几个回合。
   * 结果是风大部分时间在中段游走，偶尔摸一下边就被拽回来。
   */
  Game.prototype.stepWind = function () {
    var wm = this.map.windMax;
    if (!wm) { this.wind = 0; return; }
    var t = this.wind / wm;                                  // -1 ~ 1，极端程度
    var pull = -(t * t * t) * wm * 0.60;                     // 越极端回拉越猛
    var drift = (Math.random() * 2 - 1) * wm * 0.32;         // 小幅随机游走
    var step = wm * MAX_WIND_STEP;
    this.wind = Math.round(clamp(this.wind + clamp(pull + drift, -step, step), -wm, wm));
  };

  Game.prototype.applyDots = function (u) {
    if (!u.alive || !u.dots.length) return;
    var total = 0, kinds = {};
    for (var i = u.dots.length - 1; i >= 0; i--) {
      var d = u.dots[i];
      total += d.damage;
      kinds[d.type] = true;
      d.turns--;
      if (d.turns <= 0) u.dots.splice(i, 1);
    }
    if (total > 0) {
      this.damage(u, total, null, kinds.poison ? '#9cff5a' : '#ff7b3d');
      this.fx.burst(u.x, u.y - 16, 22, kinds.poison ? ['#9cff5a', '#4bbf2f'] : ['#ff9a3d', '#ffd166']);
    }
  };

  // ---- 结束回合 ----
  Game.prototype.endTurn = function () {
    if (this.result !== null) return;
    var u = this.active;
    if (u) {
      u.delay = this.timedOut ? PASS_DELAY : this.delayFor(u);   // 决定下一轮的位次
      if (this.arc && u.firedThisTurn) {
        u.streak = u.dealtThisTurn > 0 ? Math.min(5, u.streak + 1) : 0;
        if (u.perks.combo && u.streak >= 2 && u.alive) this.fx.text(u.x, u.y - 104, '连击 ×' + u.streak, '#ffd166');
      }
      u.buffDouble = false;
      u.shotMode = null;
      // 铁金刚「铁壁」：这一回合一步没挪，到下次轮到它之前少吃伤害
      if (this.arc && u.perks.brace && u.alive) {
        u.braced = u.moveSpent === 0;
        if (u.braced) this.fx.text(u.x, u.y - 100, '架盾', '#8fe3d6');
      }
      if (this.thunderFor === u) this.thunderFor = null;
      // 按回合计的状态在「自己这一回合结束时」才递减。放在回合开始会少算一回合：
      // 挂 3 回合的麻痹，实际只能困住对方 2 个回合。
      if (u.buffPower > 0) u.buffPower--;
      if (u.stunned > 0) u.stunned--;
      if (u.stealth > 0) {
        u.stealth--;
        if (u.stealth === 0) this.say(u.name + ' 的隐身失效了', '#9fb3c8');
      }
      this.refuel(u);
    }
    this.timedOut = false;
    this.checkWin();
    if (this.result === null) this.beginTurn(false);
  };

  Game.prototype.checkWin = function () {
    if (this.result !== null) return;
    var red = this.aliveOf(0).length, blue = this.aliveOf(1).length;
    if (red && blue) return;
    this.result = red ? 0 : blue ? 1 : -1;
    this.phase = 'over';
    var human = this.opts.humanTeam;
    if (human == null) RZ.SFX.win();
    else if (this.result === human) RZ.SFX.win();
    else RZ.SFX.lose();
  };

  // ---- 燃料经济 ----
  // 燃料是唯一的资源：开炮、移动都从这一条槽里扣，扣得越多这一手的延迟越长，
  // 回合结束再按「省着用 / 打中人 / 少乱跑」结算回油。
  Game.prototype.delayFor = function (u, extraFuel) {
    var d = RZ.DELAY_BASE + (u.spentThisTurn + (extraFuel || 0)) * RZ.DELAY_PER_FUEL;
    return Math.round(d);
  };

  Game.prototype.refuel = function (u) {
    var v = u.vehicle;
    var thrift = Math.max(0, (20 - u.spentThisTurn) * 0.3);   // 这回合省着用
    var battle = Math.min(6, u.dealtThisTurn * 0.03);         // 打中了人
    var roam = Math.min(10, u.moveSpent * 0.3);               // 满地图乱跑
    var gain = Math.max(8, Math.round(v.regen + thrift + battle - roam));
    if (this.arc) gain = Math.round(gain * this.arc.regenMul);
    var before = u.fuel;
    u.fuel = Math.min(u.maxFuel, u.fuel + gain);
    if (u.alive && u.fuel > before) {
      this.fx.text(u.x, u.y - 92, '+' + Math.round(u.fuel - before) + ' 油', '#ffd166');
    }
    return gain;
  };

  /** 扣油，顺便记账 */
  Game.prototype.spend = function (u, amount, kind) {
    u.fuel = Math.max(0, u.fuel - amount);
    u.spentThisTurn += amount;
    if (kind === 'move') u.moveSpent += amount;
  };

  // ---- 道具 ----
  /** 道具只能在自己回合、开炮之前用；飞行之后回合还没结束，也还能用 */
  Game.prototype.canUseItems = function (u) {
    return this.result === null && this.phase === 'aim' && u === this.active;
  };

  Game.prototype.useItem = function (index) {
    var u = this.active;
    if (!u || !this.canUseItems(u)) return false;
    var id = u.items[index];
    var def = id && RZ.itemById(id);
    if (!def) return false;
    if (def.kind === 'shot' && u.noFire) { this.say('这回合已经不能再开火了'); return false; }
    if (def.kind === 'shot' && u.shotMode) { this.say('这一发已经换过炮弹了'); return false; }

    u.items.splice(index, 1);
    u.usedItemFlash = 70;          // 车身上只说「在用道具」，不说用的是哪个
    this.applyItem(u, def);
    RZ.SFX.pickup();
    if (def.endsTurn) this.passTurn();
    return true;
  };

  Game.prototype.applyItem = function (u, def) {
    switch (def.id) {
      case 'double': u.buffDouble = true; break;
      case 'power': u.buffPower = 3; break;
      case 'fly': u.shotMode = 'fly'; break;
      case 'stun': u.shotMode = 'stun'; break;
      case 'heal1': this.heal(u, u.maxHp * 0.25); break;
      case 'heal2': this.heal(u, u.maxHp * 0.5); break;
      case 'fuel1': this.refill(u, u.maxFuel * 0.2); break;
      case 'fuel2': this.refill(u, u.maxFuel * 0.4); break;
      case 'stealth': u.stealth = 3; break;
    }
  };

  Game.prototype.heal = function (u, amount) {
    var before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + amount);
    this.fx.text(u.x, u.y - 84, '+' + Math.round(u.hp - before), '#5ad27a');
    RZ.SFX.heal();
  };

  Game.prototype.refill = function (u, amount) {
    var before = u.fuel;
    u.fuel = Math.min(u.maxFuel, u.fuel + amount);
    this.fx.text(u.x, u.y - 84, '+' + Math.round(u.fuel - before) + ' 油', '#ffd166');
  };

  // ---- 开火 ----
  /** 真正把一组炮弹推出去；mul 是这一发的伤害倍率（加强攻击） */
  Game.prototype.launchVolley = function (u, w, power, mul) {
    var shots = RZ.launch(u, w, u.aim, power, this.map.gravity);
    for (var i = 0; i < shots.length; i++) {
      shots[i].dmgMul = mul || 1;
      this.projectiles.push(shots[i]);
    }
    u.muzzleFlash = 8;
    this.cam.shake = Math.max(this.cam.shake, 4);
    RZ.SFX.fire(RZ.lookOf(w).snd);
  };

  Game.prototype.fire = function () {
    var u = this.active;
    if (!u || this.phase !== 'aim') return;
    if (u.noFire) { this.say('飞行之后这一回合不能再开火'); this.charging = false; RZ.SFX.stopCharge(); return; }

    // 道具会把这一发换成定位炮 / 麻痹弹，不管你选的是哪把武器
    var mode = u.shotMode;
    var w = mode === 'fly' ? RZ.LOCATOR : mode === 'stun' ? RZ.STUN_SHELL : u.weapon();
    if (!u.canAfford(w)) {
      this.say('燃料不足，打不出 ' + w.name);
      this.charging = false;
      RZ.SFX.stopCharge();
      return;
    }
    this.spend(u, w.fuel, 'weapon');
    u.firedThisTurn = true;
    var power = Math.max(4, u.power);
    u.lastPower = Math.round(power);      // 下一回合的蓄力参考刻度

    // 加强攻击：这一发 +50%，对必杀也算；定位炮不打伤害，就不消耗它
    var mul = 1;
    if (u.buffPower > 0 && w.damage > 0) { mul = 1.5; u.buffPower = 0; }
    if (this.arc && w.damage > 0) mul *= this.perkMul(u, mode ? -1 : u.weaponIdx);
    if (this.arc && w.damage > 0) {
      var pk = u.perks;
      // 托尔「雷鸣」：数开火次数，第三发的第一个落点引雷（见 explode）
      if (pk.thunderEvery && !mode) {
        u.shotsFired = (u.shotsFired || 0) + 1;
        if (u.shotsFired % pk.thunderEvery === 0) { this.thunderFor = u; this.fx.text(u.x, u.y - 132, '雷鸣', '#f5b921'); }
      }
      // 诅咒「血契弹匣」：开火就掉血，但不会因此阵亡。直接扣，不走护甲 / 架盾
      if (pk.selfHarm) {
        var loss = Math.min(Math.floor(u.hp) - 1, Math.round(u.maxHp * pk.selfHarm));
        if (loss > 0) { u.hp -= loss; this.fx.text(u.x, u.y - 64, '-' + loss, '#c8a0ff'); }
      }
    }

    // 双倍攻击：普通武器连打两发（必杀和道具弹除外）
    var twice = u.buffDouble && !mode && u.weaponIdx !== 2;
    u.buffDouble = false;

    this.launchVolley(u, w, power, mul);
    this.repeatShot = twice ? { u: u, w: w, power: power, mul: mul, left: 1, wait: 0 } : null;
    this.flyBack = mode === 'fly';        // 定位炮落地后回到瞄准状态，不结束回合
    this.phase = 'fly';
    this.charging = false;
    RZ.SFX.stopCharge();
    if (!mode && u.weaponIdx === 2) this.say(u.name + ' 发动必杀 ' + w.name + '！', '#ffd166');
  };

  /**
   * 遗物和战车被动给这一发的伤害倍率：先发制人、连击、狂战士、多面手、嗜血、乘风、暴击 / 哑火。
   * idx 是这一发用的武器（0/1/2），道具弹是 -1——换不换手只看真武器。
   */
  Game.prototype.perkMul = function (u, idx) {
    var pk = u.perks, m = 1;
    if (pk.ambush && u.firstShot) { m *= 2; this.fx.text(u.x, u.y - 104, '先发制人 ×2', '#ffd166'); }
    u.firstShot = false;
    if (pk.combo) m *= 1 + pk.combo * u.streak;
    if (pk.berserk) m *= 1 + pk.berserk * (1 - Math.max(0, u.hp) / u.maxHp);
    if (pk.variety && idx >= 0) {                        // 烈火「多面手」
      if (u.lastWeaponIdx != null && idx !== u.lastWeaponIdx) { m *= 1 + pk.variety; this.fx.text(u.x, u.y - 146, '换手', '#ffd166'); }
      u.lastWeaponIdx = idx;
    }
    if (u.bloodBuff) { m *= 1.4; u.bloodBuff = false; }  // 红龙「嗜血」：击破之后的下一发
    if (pk.windRider && this.map.windMax) m *= 1 + pk.windRider * Math.abs(this.wind) / this.map.windMax;
    // 暴击和哑火（诅咒「赌徒骰子」）掷同一颗骰子：小的一头是暴击，大的一头是哑火
    var crit = (pk.crit || 0) + (pk.critPerStreak || 0) * u.streak, roll = Math.random();
    if (crit && roll < crit) {
      m *= 1.6;
      this.fx.text(u.x, u.y - 120, '暴击！', '#ff5a5a', true);
      RZ.SFX.crit();
    } else if (pk.dud && roll >= 1 - pk.dud) {
      m *= 0.3;
      this.fx.text(u.x, u.y - 120, '哑火', '#9fb3c8', true);
    }
    return m;
  };

  /** 放弃出手，按已花掉的油结算延迟 */
  Game.prototype.passTurn = function () {
    if (this.phase !== 'aim' || this.result !== null) return;
    this.charging = false;
    RZ.SFX.stopCharge();
    this.phase = 'settle';
    this.settleTimer = 12;
  };

  // ---- 爆炸 ----
  Game.prototype.explode = function (x, y, w, attacker, directTarget, dmgMul) {
    if (w.locator) { this.teleport(attacker, x, y); return; }   // 定位炮：不炸，人过去
    var radius = w.radius;
    var arc = this.arc, apk = attacker ? attacker.perks : {};
    if (arc && apk.blast) radius *= 1 + apk.blast;
    var damage = w.damage * (dmgMul || 1);
    if (arc && w.isBarrel && apk.barrel) damage *= 2;
    var dig = radius * (w.digMul || 1) * (arc && apk.dig ? 1 + apk.dig : 1);   // 奥丁「镇地」
    this.terrain.carve(x, y, dig);
    this.fx.boom(x, y, radius, w, this.map.ground);        // 每种武器落地的样子都不一样，见 render.js 的 BOOMS
    if (arc) this.spawnField(x, y, radius, w, attacker);   // 有些武器会在落点留下一块区域
    this.fx.debris(x, y, Math.min(26, radius * 0.35), this.map.ground.body);
    this.cam.shake = Math.max(this.cam.shake, Math.min(16, radius * 0.16) * (arc ? 1.5 : 1));
    RZ.SFX.explode({ big: radius > 64, kind: w.isBarrel ? 'gun' : RZ.lookOf(w).snd });

    var fake = { damage: damage, radius: radius }, hitFoes = 0, hitList = [];
    for (var i = 0; i < this.units.length; i++) {
      var t = this.units[i];
      if (!t.alive) continue;
      var d = Math.hypot(t.x - x, (t.y - 16) - y);
      var dmg = RZ.explosionDamage(fake, attacker, t, d, radius);
      if (dmg <= 0) continue;
      if (t === directTarget) dmg = Math.round(dmg * RZ.DIRECT_BONUS);
      var foe = attacker && t.team !== attacker.team;
      if (arc && foe) {
        hitFoes++; hitList.push(t);
        if (t === directTarget && apk.precise) {         // 兰登「精准」
          dmg = Math.round(dmg * (1 + apk.precise));
          attacker.fuel = Math.min(attacker.maxFuel, attacker.fuel + 8);
        }
        if (apk.snipeCrit && Math.abs(t.x - attacker.x) > 1000) {   // 联动「狙击手」
          dmg = Math.round(dmg * (1 + apk.snipeCrit));
          this.fx.text(t.x, t.y - 132, '狙杀', '#ff5a5a', true);
        }
        if (apk.goldPerHit && !attacker.ai) this.style.gold += apk.goldPerHit;   // 联动「回收专家」
        if (t === directTarget) this.cheer(attacker, 'direct', '直击！', 5);
        if (Math.abs(t.x - attacker.x) > 1000 && !w.isBarrel) this.cheer(attacker, 'snipe', '超远狙击！', 8);
        if (w.isBarrel) this.cheer(attacker, 'barrel', '借桶杀人！', 6);
      }
      this.damage(t, dmg, attacker, null, t === directTarget);
      if (w.dot) t.dots.push({ type: w.dot.type, turns: w.dot.turns, damage: w.dot.damage });
      if (w.dot2) t.dots.push({ type: w.dot2.type, turns: w.dot2.turns, damage: w.dot2.damage });
      if (arc && t.alive && !t.perks.anchor) {
        // 横向击飞：离爆心越近、挨得越重飞得越远。悬崖边、浮岛上，这就是另一种杀法
        var dirX = t.x >= x ? 1 : -1;
        if (Math.abs(t.x - x) < 3 && attacker) dirX = t.x >= attacker.x ? 1 : -1;
        var push = Math.min(9, 1.2 + dmg * 0.028) * (w.kb || 1) * (1 + (apk.kb || 0)) / t.scale * this.pushMul(t);
        // 稀有改造「引力坍缩」：往爆心吸。按离爆心多远封顶，免得吸过头甩到另一边
        if (w.pull && !w.isChild) push = -Math.min(push, Math.abs(t.x - x) / 14);
        t.vx += dirX * push;
        t.vy = Math.min(t.vy, -Math.min(7, 2 + push * 0.7));
        t.lastHitBy = attacker;
      }
      if (w.stun && t.team !== (attacker ? attacker.team : -1) && !(arc && t.kit)) {   // Boss 不吃麻痹（稀有改造「电磁脉冲」）
        t.stunned = Math.max(t.stunned, w.stun);
        this.fx.text(t.x, t.y - 60, '麻痹', '#b98cff');
      }
      // 击退：小幅弹起，可能把车震下悬崖
      t.vy = Math.min(t.vy, -Math.min(6, dmg * 0.02));
      t.airborne = true;
      if (!t.fallFrom) t.fallFrom = t.y;
    }

    // 补给箱被炸到就归开火方所有
    for (i = this.supplies.length - 1; i >= 0; i--) {
      var sup = this.supplies[i];
      if (Math.hypot(sup.x - x, sup.y - y) < radius + 12) {
        if (this.collect(sup, attacker)) this.supplies.splice(i, 1);
      }
    }

    if (w.onImpact === 'lightning') this.strikeLightning(x, y, w, attacker, damage);
    if (w.onImpact === 'carpet' && w.carpet) this.carpet(x, y, w, attacker, dmgMul);

    if (!arc) return;
    if (hitFoes >= 2) this.cheer(attacker, 'multi', '一炮双响！', 8);
    // 托尔「雷鸣」：这一发的第一个落点引雷，六成威力
    if (this.thunderFor && this.thunderFor === attacker && !w.isChild && !w.isAfter && !w.isBarrel) {
      this.thunderFor = null;
      this.strikeLightning(x, y, w, attacker, damage * 0.6);
    }
    // 稀有改造「连锁闪电」：从被炸到的敌人跳向最近的另一个
    if (w.chain && hitList.length && !w.isChild) this.chainZap(hitList, w, attacker, damage);
    // 油桶：被波及就点着，隔几帧再炸，连锁才看得清
    for (i = 0; i < this.props.length; i++) {
      var pr = this.props[i];
      if (!pr.lit && Math.hypot(pr.x - x, (pr.y - 10) - y) < radius + 16) {
        pr.lit = true;
        RZ.SFX.fuse();
        this.pendingBlasts.push({ wait: 9, prop: pr, w: BARREL, attacker: attacker, mul: 1 });
      }
    }
    if (w.cluster && !w.isChild) this.cluster(x, y, w, attacker, dmgMul);
    // 余震：同一个落点紧跟着再来一下。范围比原爆炸大（人已经被掀开了，小了够不着），
    // 威力只有四成。余震本身不再触发余震
    if (apk.aftershock && !w.isAfter && !w.isBarrel && w.damage > 0) {
      var aw = Object.create(w);
      aw.isAfter = true; aw.isChild = true; aw.onImpact = null; aw.cluster = 0;
      aw.damage = w.damage * apk.aftershock; aw.radius = w.radius * 1.5; aw.digMul = 0.4;
      this.pendingBlasts.push({ wait: 6, x: x, y: y, w: aw, attacker: attacker, mul: dmgMul || 1 });
    }
  };

  /**
   * 连锁闪电：电流从最后一个被打到的敌人跳向最近的、这一下还没挨过的敌人，五成威力，
   * 跳的次数 = 装了几个这个改造。700px 外的够不着。
   */
  Game.prototype.chainZap = function (hit, w, attacker, damage) {
    var from = hit[hit.length - 1], done = hit.slice();
    for (var n = 0; n < w.chain; n++) {
      var best = null, bd = 700;
      for (var i = 0; i < this.units.length; i++) {
        var t = this.units[i];
        if (!t.alive || done.indexOf(t) >= 0 || (attacker && t.team === attacker.team)) continue;
        var d = Math.hypot(t.x - from.x, t.y - from.y);
        if (d < bd) { bd = d; best = t; }
      }
      if (!best) break;
      this.effects.push({ type: 'zap', x0: from.x, y0: from.y - 20, x1: best.x, y1: best.y - 20, life: 16 });
      this.fx.text(best.x, best.y - 110, '连锁闪电', '#f5b921');
      RZ.SFX.thunder();
      this.damage(best, RZ.explosionDamage({ damage: damage * 0.5, radius: 1 }, attacker, best, 0, 1), attacker);
      done.push(best); from = best;
    }
  };

  /** 集束改造：落点再蹦出几颗小炸弹 */
  Game.prototype.cluster = function (x, y, w, attacker, dmgMul) {
    var cw = Object.create(w);
    cw.isChild = true; cw.cluster = 0; cw.onImpact = null; cw.count = 1; cw.splitAt = null;
    cw.damage = w.damage * (w.clusterMul || 0.35);
    cw.radius = Math.max(24, w.radius * (w.clusterMul ? 0.7 : 0.6));
    var n = Math.min(9, w.cluster);
    for (var i = 0; i < n; i++) {
      var a = (i + 0.5) / n * Math.PI;                 // 朝上半圆撒开
      this.projectiles.push({
        x: x, y: y - 8, vx: Math.cos(a) * (2.2 + Math.random() * 1.6), vy: -3.5 - Math.random() * 2.5,
        w: cw, owner: attacker, team: attacker ? attacker.team : 0, dmgMul: dmgMul || 1,
        age: 30, alive: true, bounceLeft: 0, pierceLeft: 0, didSplit: true, trail: []
      });
    }
  };

  /**
   * 喝彩 + 赏金。只奖励真人玩家：这是给「打得漂亮」的反馈，电脑不需要。
   * 同一个名目一回合只算一次，免得散射武器刷屏。
   */
  Game.prototype.cheer = function (attacker, tag, text, gold) {
    if (!this.arc || !attacker || attacker.ai) return;
    var key = tag + '@' + this.turnNo;
    if (this.style.tags[key]) return;
    this.style.tags[key] = true;
    this.style.gold += gold;
    this.banner = { text: text, sub: '+' + gold + ' 金', life: 70, max: 70 };
    RZ.SFX.cheer();
  };

  /**
   * 牵引回收：远征里玩家的车掉出地图不会直接出局——一局四十分钟的远征
   * 不该断送在一次失足上。**不限次数**，每次扣两成耐久：掉下去是「贵」，不是「死」。
   * （原来每场只救一次。浮岛图上两三个敌人轮流削你脚下那块地，一场掉两回很平常，第二回就直接出局了。）
   * 从最后站稳的位置往两边找最近的一块「够宽的」地——拖回一根快断的尖上等于白救；实在没有才将就。
   */
  Game.prototype.rescue = function (u) {
    var spot = null, fallback = null, t = this.terrain;
    for (var off = 0; off < 900 && !spot; off += 12) {
      for (var sign = -1; sign <= 1 && !spot; sign += 2) {
        var x = clamp(Math.round(u.safeX + off * sign), 30, RZ.WORLD_W - 30);
        var y = t.groundBelow(x, 0);
        if (y > RZ.WORLD_H - 30) continue;
        if (!fallback) fallback = { x: x, y: y };
        // 左右各 26px 都有差不多高的地、脚下至少 30px 厚、而且不在地火 / 警戒线里
        var l = t.groundBelow(x - 26, 0), r = t.groundBelow(x + 26, 0);
        if (Math.abs(l - y) < 40 && Math.abs(r - y) < 40 && t.solid(x, y + 30) && !this.dangerAt(x, y)) spot = { x: x, y: y };
      }
    }
    spot = spot || fallback;
    if (!spot) return false;
    u.x = spot.x; u.y = spot.y - 60; u.vx = 0; u.vy = 0;
    u.airborne = true; u.fallFrom = u.y;
    this.fx.burst(spot.x, spot.y - 40, 50, ['#bff6ff', '#2fd0ff', '#ffffff']);
    this.fx.text(spot.x, spot.y - 110, '牵引回收', '#2fd0ff', true);
    RZ.SFX.revive();
    this.damage(u, Math.round(u.maxHp * 0.2), null, '#ffb4b4');
    return u.alive;
  };

  /** 开局在地面上撒几个油桶，避开战车脚下 */
  Game.prototype.placeProps = function () {
    var want = this.opts.barrels != null ? this.opts.barrels : 5, tries = 0;
    while (this.props.length < want && tries++ < 80) {
      var x = 90 + Math.random() * (RZ.WORLD_W - 180), ok = true, i;
      for (i = 0; i < this.units.length; i++) if (Math.abs(this.units[i].x - x) < 130) ok = false;
      for (i = 0; i < this.props.length; i++) if (Math.abs(this.props[i].x - x) < 90) ok = false;
      var y = this.terrain.groundBelow(x, 0);
      if (!ok || y > RZ.WORLD_H - 30) continue;
      this.props.push({ x: Math.round(x), y: y, vy: 0, lit: false });
    }
  };

  /** 油桶下落、延迟引爆的倒计时 */
  Game.prototype.updateProps = function () {
    var i;
    for (i = this.props.length - 1; i >= 0; i--) {
      var pr = this.props[i];
      var g = this.terrain.groundBelow(pr.x, Math.max(0, pr.y - 6));
      if (g > pr.y + 1) { pr.vy += this.map.gravity * 0.85; pr.y = Math.min(g, pr.y + pr.vy); }
      else { pr.vy = 0; if (g < pr.y) pr.y = g; }
      if (pr.y > RZ.WORLD_H + 60) this.props.splice(i, 1);
    }
    for (i = this.pendingBlasts.length - 1; i >= 0; i--) {
      var b = this.pendingBlasts[i];
      if (--b.wait > 0) continue;
      this.pendingBlasts.splice(i, 1);
      if (b.prop) {
        var k = this.props.indexOf(b.prop);
        if (k < 0) continue;
        this.props.splice(k, 1);
        this.explode(b.prop.x, b.prop.y - 10, b.w, b.attacker, null, b.mul);
      } else {
        if (b.skyfall) this.fx.mark({ type: 'skyfall', x: b.x, y: b.y, r: b.w.radius, life: 12 });
        this.explode(b.x, b.y, b.w, b.attacker, null, b.mul);
      }
    }
  };

  /**
   * 弹道预览（爽快规则、非硬核）。跑的就是真实物理，所以风、重力、武器系数全算在内；
   * 但默认只画前 45%——落点还得自己估。带「激光测距仪」才给全程。
   * 返回 [x0,y0,x1,y1,...]，不该显示时返回 null。
   */
  Game.prototype.previewPath = function () {
    var u = this.active;
    if (!this.arc || this.hardcore || !this.guide) return null;
    // 电脑的回合里玩家刚动过角度 / 标记 / 武器：按现在的风把他那条线亮一会儿
    // （到他出手时风还会再变一步，所以只是参考）
    if (u && u.ai && this.preShow > 0) u = this.preUnit();
    else if (!u || u.ai || this.phase !== 'aim' || u.noFire) return null;
    if (!u) return null;
    // 始终按标记的力度画，蓄力时也不跟着条走：线是「目标」，条是「现在」，
    // 蓄到标记处松手，打出去的就是这条线。
    var power = this.markOf(u);
    var mode = u.shotMode;
    var w = mode === 'fly' ? RZ.LOCATOR : mode === 'stun' ? RZ.STUN_SHELL : u.weapon();
    var shots = RZ.launch(u, w, u.aim, power, this.map.gravity);
    var p = shots[(shots.length / 2) | 0];
    var team = u.team, self = this;
    var env = {
      terrain: this.terrain, gravity: this.map.gravity, wind: this.wind, recordTrail: false, spawn: [],
      // 隐身的敌人不能被预览线「撞」出来
      units: this.units.filter(function (o) { return !self.hiddenFrom(team, o); })
    };
    var pts = [], n = 0;
    while (n++ < 420) {
      var ev = RZ.step(p, env);
      pts.push(p.x, p.y);
      if (ev && ev.type !== 'bounce') break;
    }
    var keep = u.perks.scope ? 1 : 0.45;
    if (u.perks.blind) keep = u.perks.scope ? 0.45 : 0.18;     // 诅咒「短视镜片」；带测距仪等于抵消
    pts.length = Math.max(2, ((pts.length / 2 * keep) | 0) * 2);
    return pts;
  };

  /**
   * 这辆车的预览线 / 蓄力停顿用的力度：自己标的 > 上一发 > 默认值。
   * 经典规则和硬核下没有这回事，返回 null——蓄力条上那条线仍然只是「上一发」。
   */
  Game.prototype.markOf = function (u) {
    if (!this.arc || this.hardcore || !u) return null;
    return u.markPower || u.lastPower || this.arc.markDefault;
  };

  /** 在蓄力条上标力度。自己的瞄准阶段（还没开始蓄力）能改；电脑的回合里也能先标好 */
  Game.prototype.setMark = function (p) {
    var u = this.preUnit();
    if (u) this.preShow = 150;
    else {
      u = this.active;
      if (!u || u.ai || this.phase !== 'aim' || this.charging) return false;
    }
    if (this.markOf(u) === null) return false;
    u.markPower = clamp(Math.round(p), 4, 100);
    return true;
  };

  Game.prototype.nudgeMark = function (d) {
    var m = this.markOf(this.preUnit() || this.active);
    return m === null ? false : this.setMark(m + d);
  };

  Game.prototype.strikeLightning = function (x, y, w, attacker, damage) {
    this.effects.push({ type: 'bolt', x: x, y0: Math.max(0, y - 620), y1: y, life: 16 });
    this.cam.shake = Math.max(this.cam.shake, 12);
    RZ.SFX.thunder();
    for (var i = 0; i < this.units.length; i++) {
      var t = this.units[i];
      if (!t.alive) continue;
      if (Math.abs(t.x - x) > 30) continue;
      if (t.y - 16 > y + 20 || t.y < y - 620) continue;
      var extra = Math.round(damage * 0.32 * (attacker ? attacker.atk / 100 : 1));
      this.damage(t, extra, attacker, '#cfe4ff');
    }
  };

  Game.prototype.carpet = function (x, y, w, attacker, dmgMul) {
    var c = w.carpet;
    var cw = Object.create(w);
    cw.onImpact = null; cw.count = 1; cw.damage = c.damage; cw.radius = c.radius;
    cw.dot = w.dot;
    if (w.childLook) cw.look = w.childLook;
    for (var i = 0; i < c.count; i++) {
      var off = (i - (c.count - 1) / 2) * c.spacing;
      this.projectiles.push({
        x: x + off, y: y - 520 - Math.abs(off) * 0.5 - Math.random() * 60,
        vx: (Math.random() - 0.5) * 0.6, vy: 2 + Math.random(),
        w: cw, owner: attacker, team: attacker ? attacker.team : 0, dmgMul: dmgMul || 1,
        age: 30, alive: true, bounceLeft: 0, pierceLeft: 0, didSplit: true, trail: []
      });
    }
  };

  /** 定位炮落点：把车挪过去，落地交给重力 */
  Game.prototype.teleport = function (u, x, y) {
    if (!u || !u.alive) return;
    this.fx.burst(u.x, u.y - 16, 40, ['#bff6ff', '#2fd0ff', '#ffffff']);
    u.x = clamp(Math.round(x), 14, RZ.WORLD_W - 14);
    u.y = Math.max(0, Math.round(y));
    u.vy = 0;
    u.airborne = true;
    u.fallFrom = u.y;              // 传送不算摔落
    u.noFire = true;               // 飞完这回合不能再开火，但还能继续挪
    this.fx.burst(u.x, u.y - 16, 46, ['#bff6ff', '#2fd0ff', '#ffffff']);
    this.fx.text(u.x, u.y - 84, '飞行', '#2fd0ff');
    RZ.SFX.pickup();
  };

  Game.prototype.damage = function (target, amount, attacker, color, direct) {
    if (!target.alive || amount <= 0) return;
    var arc = this.arc, tpk = target.perks;
    // 毒蜘蛛「蚀甲」：目标身上挂着灼烧 / 中毒时多吃伤害
    if (arc && attacker && attacker.perks.corrode && target.dots.length) amount = Math.round(amount * (1 + attacker.perks.corrode));
    if (arc && tpk.armor) amount = Math.max(1, Math.round(amount * (1 - tpk.armor)));
    if (arc && tpk.brace && target.braced) amount = Math.max(1, Math.round(amount * (1 - tpk.brace)));
    if (arc && target.kit) {                            // 护卫在场：Boss 只吃一部分伤害
      var gm = this.guardMul(target);
      if (gm < 1) { amount = Math.max(1, Math.round(amount * gm)); this.fx.text(target.x, target.y - 118, '护卫替它挡了一部分', '#8fe3d6'); }
    }
    target.hp -= amount;
    target.hitFlash = 14;
    this.fx.text(target.x, target.y - 76, '-' + amount, color || (direct ? '#fff1a8' : '#ffffff'), direct);
    if (attacker && attacker !== target && attacker.team !== target.team) {
      attacker.dealtThisTurn += amount;      // 打中人，回合结束多回一点油
      this.log.push({ by: attacker.index, dmg: amount });
      this.turnsSinceDamage = 0;
      if (arc) {
        var apk = attacker.perks;
        if (apk.siphon) attacker.fuel = Math.min(attacker.maxFuel, attacker.fuel + apk.siphon);
        if (apk.vamp && attacker.alive) attacker.hp = Math.min(attacker.maxHp, attacker.hp + amount * apk.vamp);
        // 荆棘：反弹回去的伤害不带攻击者，不会再弹回来
        if (tpk.thorns && attacker.alive) this.damage(attacker, Math.max(1, Math.round(amount * tpk.thorns)), null, '#c8a0ff');
      }
    }
    if (arc && amount >= 110) this.hitstop = Math.max(this.hitstop, amount >= 260 ? 7 : 4);
    RZ.SFX.hurt();
    if (target.hp <= 0) this.kill(target, null, attacker);
  };

  Game.prototype.kill = function (u, silent, attacker) {
    if (!u.alive) return;
    // 应急核心：只救得了被打死的，掉出地图救不回来
    if (this.arc && !silent && u.reviveLeft > 0) {
      u.reviveLeft--; u.revived = true;
      u.hp = Math.round(u.maxHp * (u.perks.phoenix ? 1 : 0.4));   // 联动「浴火重生」直接满血
      u.dots.length = 0;
      this.fx.burst(u.x, u.y - 18, 60, ['#bff6ff', '#ffffff', '#5ad27a']);
      this.fx.text(u.x, u.y - 96, '应急核心启动！', '#5ad27a', true);
      RZ.SFX.revive();
      return;
    }
    u.hp = 0; u.alive = false;
    if (this.arc) {
      if (u.kit) this.clearTelegraphs(u);
      this.slowmo = 44;
      this.hitstop = Math.max(this.hitstop, 8);
      var by = attacker || u.lastHitBy;
      if (by && by.team !== u.team) {
        this.killsThisTurn++;
        if (silent) this.cheer(by, 'ringout', '击飞出界！', 15 + (by.perks.ringGold || 0));
        if (by.perks.bloodlust && by.alive) {            // 红龙「嗜血」
          this.heal(by, by.maxHp * 0.15);
          by.bloodBuff = true;
          this.fx.text(by.x, by.y - 118, '嗜血', '#ff5a5a', true);
        }
        if (this.killsThisTurn >= 2) this.cheer(by, 'double', '双杀！', 12);
        if (u.boss) this.cheer(by, 'boss', 'BOSS 击破！', 30);
      }
    }
    this.fx.burst(u.x, u.y - 18, 84, ['#ffd166', '#ff6a1f', '#ffffff', '#8b2f10']);
    this.fx.debris(u.x, u.y - 12, 26, u.vehicle.pal[0]);
    this.fx.text(u.x, u.y - 90, silent || '击破！', '#ff8a5c', true);
    this.cam.shake = Math.max(this.cam.shake, 12);
    if (silent) RZ.SFX.fall();              // 掉出地图的，先来一声往下滑的哨
    RZ.SFX.ko();
    this.say(u.name + ' 被击破', RZ.TEAM_COLORS[u.team]);
  };

  // ---- 补给 ----
  Game.prototype.dropSupply = function () {
    var def = RZ.ITEMS[(Math.random() * RZ.ITEMS.length) | 0];
    var x = 120 + Math.random() * (RZ.WORLD_W - 240);
    this.supplies.push({ x: x, y: -40, vy: 0, def: def, landed: false });
    this.say('空投了一个道具', def.color);
    RZ.SFX.supply();      // 具体是什么，捡到才知道
  };

  Game.prototype.collect = function (sup, u) {
    if (!u || !u.alive) return false;
    if (u.items.length >= RZ.MAX_ITEMS) {         // 道具满了就先放着，回头再来捡
      if (u === this.active) this.say(u.name + ' 道具已满，捡不了', '#ff9a9a');
      return false;
    }
    u.items.push(sup.def.id);
    this.fx.text(u.x, u.y - 84, '+' + sup.def.name, sup.def.color);
    RZ.SFX.pickup();
    this.say(u.name + ' 捡到道具', sup.def.color);
    return true;
  };

  // ---- 移动 / 瞄准 ----
  Game.prototype.moveActive = function (dir) {
    var u = this.active;
    if (!u || this.phase !== 'aim' || u.airborne || u.fuel <= 0) return;
    if (u.stunned > 0) { if ((this.t & 31) === 0) this.say('被麻痹了，动不了'); return; }
    u.face = dir;
    if (!u.ai) this.cam.free = false;                 // 自己开车了，镜头跟回来
    var cost = u.vehicle.moveCost;
    if (this.arc) cost *= this.moveMul(u);            // 陷在蛛网里
    // 还打得出一号武器就给它留着，已经打不出了就随便走——总不能把人钉在原地
    var floor = u.fuel >= u.vehicle.w1.fuel ? u.vehicle.w1.fuel : 0;
    var stepsLeft = 1.7;
    while (stepsLeft > 0 && u.fuel > floor) {
      var nx = clamp(u.x + dir, 12, RZ.WORLD_W - 12);
      if (nx === u.x) break;
      var probe = this.terrain.supportY(nx, HALF_W, u.y - u.climb - 4);
      if (probe >= RZ.WORLD_H + 900) {           // 前面是虚空，走过去会掉下去
        if (u.fuel - cost * 2 < floor) break;
        u.x = nx; u.airborne = true; u.fallFrom = u.y;
        this.spend(u, cost * 2, 'move');
        break;
      }
      var rise = u.y - probe;
      if (rise > u.climb) break;                 // 爬不上去
      var step = rise > 2 ? cost * 1.8 : cost;   // 爬坡更费油
      if (u.fuel - step < floor) break;          // 迈出去就打不出炮了，停在这
      u.x = nx;
      u.y = probe;
      this.spend(u, step, 'move');
      stepsLeft--;
    }
    if ((this.t & 7) === 0) RZ.SFX.move();
  };

  /** 每帧处理「按住不放」的按键；keys 是 {按键名: 布尔} */
  Game.prototype.applyHeld = function (keys) {
    var u = this.active;
    // WASD 挪镜头：谁的回合都能用（看的是公开的战场，不算规则）。认 code 也认 key，输入法开着时 key 不可靠
    var px = (keys.KeyD || keys.d || keys.D ? 1 : 0) - (keys.KeyA || keys.a || keys.A ? 1 : 0);
    var py = (keys.KeyS || keys.s || keys.S ? 1 : 0) - (keys.KeyW || keys.w || keys.W ? 1 : 0);
    if (px || py) this.panCamera(px * 18, py * 18);
    if (u && u.ai && this.preUnit()) {                 // 电脑的回合：只许预先调角度
      if (keys.ArrowUp) this.adjustAim(1);
      if (keys.ArrowDown) this.adjustAim(-1);
      return;
    }
    if (!u || u.ai || this.phase !== 'aim' || this.result !== null) return;
    if (keys.ArrowLeft) this.moveActive(-1);
    if (keys.ArrowRight) this.moveActive(1);
    if (keys.ArrowUp) this.adjustAim(1);
    if (keys.ArrowDown) this.adjustAim(-1);
  };

  /**
   * 爽快规则：轮到电脑时，玩家可以先把自己那辆车的角度、力度标记、武器摆好，不用干等。
   * 返回这时候归玩家摆弄的那辆车；经典规则、或者本来就轮到玩家时返回 null。
   * 只许动这三样——移动、道具、开火都得等到自己的回合。
   */
  Game.prototype.preUnit = function () {
    var a = this.active;
    if (!this.arc || !a || !a.ai || this.result !== null) return null;
    var v = this.viewUnit();
    return v && v.alive && !v.ai ? v : null;
  };

  Game.prototype.adjustAim = function (d) {
    var u = this.active;
    if (!u || this.phase !== 'aim' || u.ai) {
      var pre = this.preUnit();
      if (pre) { pre.aim = clamp(pre.aim + d, -25, 90); this.preShow = 150; return; }
    }
    if (!u || this.phase !== 'aim') return;
    u.aim = clamp(u.aim + d, -25, 90);
  };

  Game.prototype.setWeapon = function (idx) {
    var u = this.active;
    var pre = this.preUnit();
    if (pre) {
      // 这时候不看油够不够：回合开始还会回油；到时真不够，beginTurn 会退回一号武器
      pre.weaponIdx = idx; this.preShow = 150;
      RZ.SFX.click();
      return;
    }
    if (!u || u.ai || this.phase !== 'aim') return;      // 电脑的武器不归键盘管（它自己直接写 weaponIdx）
    var w = idx === 0 ? u.vehicle.w1 : idx === 1 ? u.vehicle.w2 : u.vehicle.ss;
    if (!u.canAfford(w)) { this.say('燃料不足：' + w.name + ' 需要 ' + w.fuel); return; }
    u.weaponIdx = idx;
    RZ.SFX.click();
  };

  Game.prototype.startCharge = function () {
    if (!this.active || this.phase !== 'aim' || this.charging) return;
    this.charging = true;
    this.active.power = 0;
    this.cam.free = false;               // 要开炮了，镜头回到自己车上
    RZ.SFX.startCharge();
  };

  Game.prototype.releaseCharge = function () {
    if (!this.charging) return;
    this.fire();
  };

  /** 放弃这一发蓄力（暂停时玩家松手、切走窗口等） */
  Game.prototype.cancelCharge = function () {
    if (!this.charging) return;
    this.charging = false;
    if (this.active) this.active.power = 0;
    RZ.SFX.stopCharge();
  };

  // ---- 主循环 ----
  Game.prototype.update = function (dtms) {
    if (this.arc) {
      // 顿帧：重击那一下整个世界停几帧；慢动作：击破后隔帧推进
      if (this.banner && --this.banner.life <= 0) this.banner = null;
      if (this.hitstop > 0) { this.hitstop--; return; }
      if (this.slowmo > 0) { this.slowmo--; if (this.slowmo & 1) return; }
    }
    this.t += 16;
    if (this.preShow > 0) this.preShow--;
    var i;
    this.fx.update();
    this.bg.update(this.t);

    for (i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.hitFlash > 0) u.hitFlash--;
      if (u.muzzleFlash > 0) u.muzzleFlash--;
      if (u.usedItemFlash > 0) u.usedItemFlash--;
      if (u.stealth <= 0) { u.lastSeenX = u.x; u.lastSeenY = u.y; }
      if (!u.airborne) u.safeX = u.x;
    }

    if (this.result !== null) { this.updateCamera(); return; }

    // 蓄力
    if (this.charging && this.active) {
      var cu = this.active;
      var rate = this.arc ? this.arc.charge : CHARGE_RATE;
      // 蓄力条永远匀速走，经过标记时什么都不发生——不停顿、不吸附，也没有专门的声音或变色
      // （都试过，都被否了：前者锁死了标记附近的手动微调，后者干扰）。标记只是条上的一根刻度。
      cu.power = Math.min(100, cu.power + rate);
      RZ.SFX.updateCharge(cu.power);
    }

    // 回合倒计时
    if (this.phase === 'aim') {
      this.timeLeft -= dtms / 1000;
      var sec = Math.ceil(this.timeLeft);
      if (sec <= 5 && sec !== this.lastTick && sec > 0) { this.lastTick = sec; RZ.SFX.tick(); }
      if (this.timeLeft <= 0) {
        this.charging = false; RZ.SFX.stopCharge();
        this.say('时间到！', '#ff8a8a');
        this.timedOut = true;
        this.phase = 'settle';
        this.settleTimer = 20;
      }
      if (this.active && this.active.ai) this.updateAI(dtms);
    }

    this.updatePhysics();
    this.updateSupplies();
    if (this.arc) { this.updateProps(); this.updateField(); }

    for (i = this.effects.length - 1; i >= 0; i--) {
      if (--this.effects[i].life <= 0) this.effects.splice(i, 1);
    }
    for (i = this.messages.length - 1; i >= 0; i--) {
      if (--this.messages[i].life <= 0) this.messages.splice(i, 1);
    }

    // 飞行阶段结束判定
    if (this.phase === 'fly' && this.projectiles.length === 0 && this.pendingBlasts.length === 0) {
      var rs = this.repeatShot;
      if (rs && rs.left > 0 && rs.u.alive) {
        // 双倍攻击的第二发：等第一发的坑炸完再打，所以两发会互相影响地形
        if (rs.wait++ === 0) this.say('双倍攻击 · 第二发', '#ff7a3d');
        if (rs.wait > 26) { rs.left--; this.launchVolley(rs.u, rs.w, rs.power, rs.mul); }
      } else if (this.flyBack) {
        this.flyBack = false;
        this.repeatShot = null;
        this.phase = 'aim';                 // 飞行不结束回合，还能接着挪
      } else {
        this.repeatShot = null;
        this.phase = 'settle';
        this.settleTimer = this.arc ? this.arc.settle : 34;
      }
    }
    if (this.phase === 'settle') {
      var moving = false;
      for (i = 0; i < this.units.length; i++) if (this.units[i].alive && this.units[i].airborne) moving = true;
      if (!moving) this.settleTimer--;
      if (this.settleTimer <= 0 && this.projectiles.length === 0 && this.pendingBlasts.length === 0) this.endTurn();
    }

    this.updateCamera();
  };

  Game.prototype.updatePhysics = function () {
    var env = {
      terrain: this.terrain, gravity: this.map.gravity, wind: this.wind,
      units: this.units, recordTrail: true, spawn: this.pendingSpawn,
      dig: (function (g) {
        return function (x0, y0, x1, y1, r) { g.terrain.tunnel(x0, y0, x1, y1, r); };
      })(this)
    };

    for (var i = this.projectiles.length - 1; i >= 0; i--) {
      var p = this.projectiles[i];
      var ev = RZ.step(p, env);
      this.fx.trail(p);
      if (!ev && this.arc && p.w.damage > 0) {
        // 炮弹直接撞上油桶：就地起爆
        for (var k = 0; k < this.props.length; k++) {
          var pr = this.props[k];
          if (Math.abs(p.x - pr.x) < 11 && p.y > pr.y - 24 && p.y < pr.y + 2) {
            ev = { type: 'hit', x: p.x, y: p.y, target: null };
            break;
          }
        }
      }
      if (!ev) continue;
      if (ev.type === 'bounce') { RZ.SFX.bounce(); continue; }
      if (ev.type === 'split') {
        this.fx.burst(ev.x, ev.y, 16, [p.w.shell.color, '#ffffff']);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (ev.type === 'hit') this.explode(ev.x, ev.y, p.w, p.owner, ev.target, p.dmgMul);
      this.projectiles.splice(i, 1);
    }
    while (this.pendingSpawn.length) {
      var kid = this.pendingSpawn.pop();
      if (kid.w.childLook) kid.w.look = kid.w.childLook;   // 分裂出来的子弹可以换一副样子（只影响外观）
      this.projectiles.push(kid);
    }

    // 开火方的强化只作用于这一发
    // 战车重力与落地
    for (i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.alive) continue;
      var support = this.terrain.supportY(u.x, HALF_W, Math.max(0, u.y - 26));
      if (u.airborne || support > u.y + 1.2) {
        if (!u.airborne) { u.airborne = true; u.fallFrom = u.y; u.vy = Math.max(0, u.vy); }
        u.vy += this.map.gravity * 0.85;
        u.y += u.vy;
        if (u.vx) {
          // 击飞中的横向位移：撞到墙就弹回一点，撞到世界边缘就停
          var nx = clamp(u.x + u.vx, 12, RZ.WORLD_W - 12);
          if (this.terrain.solid(nx, u.y - 14) || this.terrain.solid(nx, u.y - 26)) u.vx *= -0.3;
          else { if (nx !== u.x + u.vx) u.vx = 0; u.x = nx; }
          u.vx *= 0.985;
        }
        if (u.y > RZ.WORLD_H + 90) {
          if (this.arc && u.perks.rescue && this.rescue(u)) continue;
          this.kill(u, this.map.voidBottom ? '坠入虚空！' : '沉没！', u.lastHitBy);
          continue;
        }
        var s2 = this.terrain.supportY(u.x, HALF_W, Math.max(0, u.y - 26));
        if (u.vy >= 0 && u.y >= s2) {
          u.y = s2; u.airborne = false;
          var drop = u.y - u.fallFrom;
          u.vx = 0;
          if (drop > FALL_SAFE && !(this.arc && u.perks.anchor)) {
            var d = Math.round((drop - FALL_SAFE) * 0.42);
            this.damage(u, d, null, '#ffb4b4');
            this.fx.debris(u.x, u.y, 12, this.map.ground.top);
          }
          u.vy = 0; u.fallFrom = 0;
        }
      } else if (support < u.y) {
        u.y = support;                        // 地面被抬高（理论上不会发生）
      }
    }
  };

  Game.prototype.updateSupplies = function () {
    for (var i = this.supplies.length - 1; i >= 0; i--) {
      var s = this.supplies[i];
      if (!s.landed) {
        s.vy = Math.min(1.5, s.vy + 0.04);
        s.y += s.vy;
        s.x += Math.sin(this.t * 0.002 + i) * 0.25 + this.wind * 0.01;
        var g = this.terrain.groundBelow(s.x, Math.max(0, s.y - 4));
        if (s.y >= g) { s.y = g; s.landed = true; }
        if (s.y > RZ.WORLD_H + 40) { this.supplies.splice(i, 1); continue; }
      }
      for (var k = 0; k < this.units.length; k++) {
        var u = this.units[k];
        if (u.alive && Math.abs(u.x - s.x) < 22 && Math.abs(u.y - s.y) < 34) {
          if (this.collect(s, u)) this.supplies.splice(i, 1);
          break;
        }
      }
    }
  };

  /**
   * 玩家手动挪镜头。挪过之后镜头就停在那儿不再跟车，直到「该看别处了」：
   * 换人出手、炮弹出膛 / 落定（阶段变了），或者玩家自己开始移动、蓄力。
   */
  Game.prototype.panCamera = function (dx, dy) {
    if (this.result !== null) return;
    this.cam.free = true;
    this.cam.tx += dx; this.cam.ty += dy;
  };

  Game.prototype.updateCamera = function () {
    var target = null;
    var sig = (this.active ? this.active.index : -1) + '|' + this.phase;
    if (sig !== this.cam.sig) { this.cam.sig = sig; this.cam.free = false; }
    if (this.phase === 'fly' && this.projectiles.length) {
      var best = this.projectiles[0];
      for (var i = 1; i < this.projectiles.length; i++) {
        if (this.projectiles[i].y < best.y) best = this.projectiles[i];
      }
      target = { x: best.x, y: Math.max(best.y, 60) };
    } else if (this.active) {
      target = { x: this.active.x, y: this.active.y - 60 };
    }
    if (target && !this.cam.free) {
      this.cam.tx = target.x - this.viewW / 2;
      this.cam.ty = target.y - this.viewH / 2;
    }
    this.cam.tx = clamp(this.cam.tx, 0, Math.max(0, RZ.WORLD_W - this.viewW));
    this.cam.ty = clamp(this.cam.ty, -60, Math.max(0, RZ.WORLD_H - this.viewH));
    var k = this.phase === 'fly' ? 0.16 : 0.09;
    this.cam.x += (this.cam.tx - this.cam.x) * k;
    this.cam.y += (this.cam.ty - this.cam.y) * k;
    if (this.cam.shake > 0) this.cam.shake *= 0.88;
    if (this.cam.shake < 0.3) this.cam.shake = 0;
  };

  // ---- 电脑的道具策略 ----
  function itemSlot(u, id) { return u.items.indexOf(id); }

  /** 回血 / 回油 / 隐身：开打之前先把自己收拾好 */
  Game.prototype.aiUseSupportItems = function (u) {
    var hpRatio = u.hp / u.maxHp, i;
    if (hpRatio < 0.32) {
      i = itemSlot(u, 'heal2');
      if (i >= 0) { this.useItem(i); return; }           // 结束回合
    }
    if (hpRatio < 0.6) {
      i = itemSlot(u, 'heal1');
      if (i >= 0) this.useItem(i);
    }
    if (!u.canAfford(u.vehicle.w1)) {
      i = itemSlot(u, 'fuel2');
      if (i >= 0) { this.useItem(i); return; }           // 结束回合
    }
    if (u.fuel < u.maxFuel * 0.25) {
      i = itemSlot(u, 'fuel1');
      if (i >= 0) this.useItem(i);
    }
    if (u.stealth === 0 && u.hp / u.maxHp < 0.5) {
      i = itemSlot(u, 'stealth');
      if (i >= 0 && Math.random() < 0.5) this.useItem(i);
    }
  };

  /** 加强 / 双倍 / 麻痹：算出这一发能打中人，才值得砸道具 */
  Game.prototype.aiUseOffenseItems = function (u, plan) {
    if (!plan || this.phase !== 'aim') return;
    var expect = plan.expect || 0, i;
    if (expect >= 70) {
      i = itemSlot(u, 'power');
      if (i >= 0) this.useItem(i);
    }
    if (expect >= 50 && plan.weaponIdx !== 2) {
      i = itemSlot(u, 'double');
      if (i >= 0) this.useItem(i);
    }
    if (expect >= 40 && !u.shotMode) {
      i = itemSlot(u, 'stun');
      if (i >= 0 && Math.random() < 0.4) this.useItem(i);
    }
  };

  // ---- AI 驱动 ----
  Game.prototype.updateAI = function () {
    var u = this.active;
    if (!u || !u.ai) return;
    if (this.aiTimer > 0) { this.aiTimer--; return; }

    if (!this.aiPlan) {
      this.aiUseSupportItems(u);            // 可能直接结束回合（大回血 / 大回燃料）
      if (this.phase !== 'aim') return;
      this.aiPlan = RZ.aiThink(this, u);
      this.aiUseOffenseItems(u, this.aiPlan);
      this.aiPhase = this.aiPlan.moveDir ? 'move' : 'aim';
      this.aiMoveLeft = this.aiPlan.moveSteps || 0;
      return;
    }
    var plan = this.aiPlan;

    if (this.aiPhase === 'move') {
      if (this.aiMoveLeft > 0 && u.fuel > 0) { this.moveActive(plan.moveDir); this.aiMoveLeft--; return; }
      this.aiPlan = RZ.aiThink(this, u, true);   // 换位后重新计算
      this.aiPhase = 'aim';
      return;
    }

    if (this.aiPhase === 'aim') {
      if (u.weaponIdx !== plan.weaponIdx) { u.weaponIdx = plan.weaponIdx; }
      if (u.face !== plan.face) u.face = plan.face;
      var da = plan.aim - u.aim;
      if (Math.abs(da) > 0.8) { u.aim += clamp(da, -2.2, 2.2); return; }
      u.aim = plan.aim;
      this.aiPhase = 'charge';
      this.startCharge();
      return;
    }

    if (this.aiPhase === 'charge') {
      // 暂停、切窗口等外部原因可能把蓄力标志掐掉，这里自愈重来一次，
      // 否则电脑会一直举着炮站到回合超时。
      if (!this.charging) { this.startCharge(); return; }
      if (u.power < plan.power) return;
      this.releaseCharge();
      if (this.phase === 'aim') {          // 油不够没打出去：退回一号武器，再不行就过
        u.weaponIdx = 0;
        if (u.canAfford(u.vehicle.w1)) { this.charging = true; this.fire(); }
        if (this.phase === 'aim') this.passTurn();
      }
      this.aiPhase = 'done';
    }
  };

  // ---- 绘制 ----
  Game.prototype.draw = function (ctx, viewW, viewH) {
    this.viewW = viewW; this.viewH = viewH;
    var shakeX = (Math.random() - 0.5) * this.cam.shake * 2;
    var shakeY = (Math.random() - 0.5) * this.cam.shake * 2;

    ctx.save();
    ctx.translate(-Math.round(this.cam.x + shakeX), -Math.round(this.cam.y + shakeY));

    this.bg.draw(ctx, this.cam, this.t, this.night);
    this.terrain.flush();
    ctx.drawImage(this.terrain.canvas, 0, 0);

    // 水下 / 熔岩氛围
    if (this.map.haze) {
      ctx.fillStyle = this.map.haze;
      ctx.fillRect(-400, -400, RZ.WORLD_W + 800, RZ.WORLD_H + 800);
    }

    var i;
    for (i = 0; i < this.supplies.length; i++) RZ.drawSupply(ctx, this.supplies[i], this.t);
    for (i = 0; i < this.props.length; i++) RZ.drawBarrel(ctx, this.props[i], this.t);
    for (i = 0; i < this.hazards.length; i++) RZ.drawHazard(ctx, this.hazards[i], this.t);
    for (i = 0; i < this.telegraphs.length; i++) RZ.drawTelegraph(ctx, this.telegraphs[i], this.terrain, this.t);

    var viewer = this.viewerTeam();
    for (i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.alive || this.hiddenFrom(viewer, u)) continue;   // 隐身：整辆车都不画
      RZ.drawUnit(ctx, u, this.t, { active: u === this.active && this.result === null });
    }

    // 只提示炮口指向，不预测落点——预测线会随蓄力乱跳，反而干扰手感
    var path = this.previewPath();
    if (path) {
      RZ.drawPreview(ctx, path, RZ.TEAM_COLORS[(this.preUnit() || this.active).team], this.t);
    } else if (this.guide && this.phase === 'aim' && this.active && !this.active.ai) {
      RZ.drawAimRay(ctx, this.active, RZ.TEAM_COLORS[this.active.team]);
    }

    for (i = 0; i < this.projectiles.length; i++) RZ.drawProjectile(ctx, this.projectiles[i], this.t);
    for (i = 0; i < this.effects.length; i++) {
      var e = this.effects[i];
      if (e.type === 'bolt') RZ.drawBolt(ctx, e.x, e.y0, e.y1, e.life);
      else if (e.type === 'zap') RZ.drawZap(ctx, e.x0, e.y0, e.x1, e.y1, e.life);
    }

    this.fx.drawMarks(ctx, this.t);
    this.fx.draw(ctx);
    this.fx.drawTexts(ctx);

    // 屏幕外战车的方向指示
    for (i = 0; i < this.units.length; i++) {
      var o = this.units[i];
      if (!o.alive || this.hiddenFrom(viewer, o)) continue;
      var sx = o.x - this.cam.x;
      if (sx < 26 || sx > viewW - 26) {
        var cx = clamp(sx, 18, viewW - 18) + this.cam.x;
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = RZ.TEAM_COLORS[o.team];
        ctx.beginPath();
        var dir = sx < 26 ? -1 : 1;
        var cy = clamp(o.y - 40 - this.cam.y, 30, viewH - 30) + this.cam.y;
        ctx.moveTo(cx + dir * 10, cy);
        ctx.lineTo(cx - dir * 6, cy - 8);
        ctx.lineTo(cx - dir * 6, cy + 8);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
    if (this.banner) RZ.drawBanner(ctx, this.banner, viewW, viewH);
  };

  RZ.Game = Game;
  RZ.ARCADE = ARCADE;
  RZ.BARREL = BARREL;
  RZ.TURN_TIME = TURN_TIME;
})(window.RZ || (window.RZ = {}));

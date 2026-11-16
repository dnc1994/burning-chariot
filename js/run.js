/* 燃烧战车 — 远征模式（肉鸽）的规则与数据
 * 这一层只管「一局远征」的状态机：路线、遭遇、奖励、商店、局外成长。
 * 不碰 DOM、不碰 Game 内部——它只负责造出 Game 的 opts，再读回战斗结果，
 * 所以整局远征可以在 Node 里无头跑完（见 test/run-mode.js）。
 *
 * 状态 state 是纯 JSON（没有函数、没有对象引用），可以直接进 localStorage。
 */
(function (RZ) {
  'use strict';

  var Run = {};
  var rand = Math.random;
  var forced = false;            // 测试用 setRandom 接管了随机源：这时种子不插手
  Run.setRandom = function (fn) { rand = fn || Math.random; forced = !!fn; };

  // ================= 种子 =================
  // 一局远征的路线、敌人、奖励、商店、事件都由 state.seed 决定：同一个种子 + 同样的选择 = 同一局。
  // 战斗里的风、暴击、地形不在内（那些走 Math.random）。
  // 做法是「无状态」的：每个要掷骰子的地方用「种子 + 这是哪一步」现算一个随机源（seeded()），
  // 不存随机数发生器的状态——所以在商店里多刷新几次，不会把后面的路线带偏。
  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** 在「种子 + tag」定下的随机源里跑 fn。老存档没有种子、或者测试接管了随机源时，原样跑 */
  function seeded(state, tag, fn) {
    if (forced || !state || !state.seed) return fn();
    var prev = rand;
    rand = mulberry32(hashStr(state.seed + '|' + tag));
    try { return fn(); } finally { rand = prev; }
  }
  function at(state) { return state.act + '.' + state.step; }

  var SEED_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';    // 去掉了 0/O、1/I 这些容易看错的
  Run.randomSeed = function () {
    var out = '';
    for (var i = 0; i < 6; i++) out += SEED_CHARS.charAt((Math.random() * SEED_CHARS.length) | 0);
    return out;
  };
  /** 玩家手敲的种子码：去空白、转大写、只留字母数字，最长 16 位。空的返回 '' */
  Run.cleanSeed = function (text) {
    return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  };
  /** 每日挑战：种子按本地日期定，所有人同一天拿到同一局；连开哪辆车也由种子定（顺便让人试试没解锁的车） */
  Run.dateKey = function (d) {
    d = d || new Date();
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  };
  Run.dailySeed = function (dateKey) { return 'D' + (dateKey || Run.dateKey()).replace(/-/g, ''); };
  Run.dailyVehicle = function (dateKey) {
    return RZ.VEHICLES[hashStr(Run.dailySeed(dateKey) + '|V') % RZ.VEHICLES.length].id;
  };
  Run.newDaily = function (dateKey) {
    dateKey = dateKey || Run.dateKey();
    return Run.newRun(Run.dailyVehicle(dateKey), { seed: Run.dailySeed(dateKey), daily: dateKey });
  };

  function pick(arr) { return arr[(rand() * arr.length) | 0]; }
  function sample(arr, n) {
    var pool = arr.slice(), out = [];
    while (pool.length && out.length < n) out.push(pool.splice((rand() * pool.length) | 0, 1)[0]);
    return out;
  }
  function copy(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  // ================= 武器改造 =================
  // 每个改造都能重复装，叠出来的东西越离谱越好。apply 直接改武器副本上的字段，
  // 用的全是 physics.js / game.js 已经认识的字段，所以电脑搜弹道时也算得进去。
  // 一把武器最多挂两种持续伤害（dot / dot2）：同类叠在一起，异类各占一格
  function addDot(w, type, turns, dmg, stack) {
    var slot = (!w.dot || w.dot.type === type) ? 'dot' : 'dot2';
    var cur = w[slot];
    w[slot] = cur && cur.type === type
      ? { type: type, turns: cur.turns + 1, damage: cur.damage + stack }
      : { type: type, turns: turns, damage: dmg };
  }

  Run.MODS = [
    { id: 'split', name: '分裂弹头', desc: '多打一发，单发威力 -15%。',
      apply: function (w) { w.count += 1; w.spread = Math.max(w.spread, 3) + 1; w.damage *= 0.85; } },
    { id: 'heavy', name: '重型装药', desc: '威力 +22%。',
      apply: function (w) { w.damage *= 1.22; } },
    { id: 'blast', name: '高爆战斗部', desc: '爆炸范围 +22%，坑也更大。',
      apply: function (w) { w.radius *= 1.22; w.digMul *= 1.1; } },
    { id: 'bounce', name: '弹跳外壳', desc: '多弹跳一次，威力 +6%。',
      apply: function (w) { w.bounce = (w.bounce || 0) + 1; w.damage *= 1.06; } },
    { id: 'drill', name: '穿地钻头', desc: '能钻穿更厚的地形再爆炸。',
      apply: function (w) { w.pierce = (w.pierce || 0) + 70; } },
    { id: 'burn', name: '燃烧剂', desc: '命中后点燃目标，每回合灼烧。可叠加。',
      apply: function (w) { addDot(w, 'fire', 2, 30, 18); } },
    { id: 'venom', name: '腐蚀毒液', desc: '命中后中毒三回合。可叠加。',
      apply: function (w) { addDot(w, 'poison', 3, 22, 14); } },
    { id: 'cluster', name: '集束子弹药', desc: '落点再蹦出 3 颗小炸弹。',
      apply: function (w) { w.cluster = (w.cluster || 0) + 3; } },
    { id: 'thunder', name: '引雷针', desc: '落点引下一道落雷，贯穿整列。已有特殊效果的武器改为威力 +15%。',
      apply: function (w) { if (!w.onImpact) w.onImpact = 'lightning'; else w.damage *= 1.15; } },
    { id: 'apex', name: '顶点分裂', desc: '飞到最高点裂成三颗（单颗威力 -40%）。再装一个多裂一颗。',
      apply: function (w) {
        if (w.splitAt) { w.splitCount = (w.splitCount || 3) + 1; return; }
        w.splitAt = 'apex'; w.splitCount = 3; w.splitSpread = 10; w.damage *= 0.6;
      } },
    { id: 'light', name: '轻量化', desc: '耗油 -25%，出手也跟着变快。',
      apply: function (w) { w.fuel = Math.max(3, Math.round(w.fuel * 0.75)); } },
    { id: 'knock', name: '冲击波', desc: '击退力 +80%，把人掀下悬崖。',
      apply: function (w) { w.kb = (w.kb || 1) + 0.8; } },

    // ---- 稀有改造：只在精英 / Boss 奖励、商店里出现（普通战斗偶尔掉一件）。每件都改变武器「怎么用」，不只是加数 ----
    { id: 'nuke', rare: true, name: '微型核芯', desc: '威力 +45%、范围 +35%，但耗油 +60%。',
      apply: function (w) { w.damage *= 1.45; w.radius *= 1.35; w.digMul *= 1.2; w.fuel = Math.round(w.fuel * 1.6); } },
    { id: 'chain', rare: true, name: '连锁闪电', desc: '炸到敌人后，电流跳向最近的另一个敌人，造成五成伤害。再装一个多跳一次。',
      apply: function (w) { w.chain = (w.chain || 0) + 1; } },
    { id: 'gravity', rare: true, name: '引力坍缩', desc: '爆炸不再把人推开，而是往爆心吸——把一群敌人拢到一起。',
      apply: function (w) { w.pull = 1; w.kb = Math.max(w.kb || 1, 1.3); } },
    { id: 'mirv', rare: true, name: '子母弹头', desc: '落点撒出 5 颗子弹，每颗有母弹一半的威力。',
      apply: function (w) { w.cluster = (w.cluster || 0) + 5; w.clusterMul = 0.5; } },
    { id: 'shock', rare: true, name: '电磁脉冲', desc: '被炸到的敌人麻痹一回合（动不了），威力 -10%。Boss 不吃麻痹。',
      apply: function (w) { w.stun = Math.max(w.stun || 0, 1); w.damage *= 0.9; } }
  ];
  Run.modById = function (id) { return byId(Run.MODS, id); };

  /** 基础武器 + 一串改造 = 一把新武器（不改原对象） */
  Run.modWeapon = function (base, modIds) {
    var w = copy(base), tags = [];
    for (var i = 0; i < (modIds || []).length; i++) {
      var m = Run.modById(modIds[i]);
      if (m) { m.apply(w); tags.push(m.name); }
    }
    w.damage = Math.round(w.damage);
    w.radius = Math.round(w.radius);
    w.mods = tags;
    return w;
  };

  /** 改造池：普通 / 稀有分开抽 */
  function modPool(rare) { return Run.MODS.filter(function (m) { return !!m.rare === !!rare; }); }
  Run.modPool = modPool;

  // ================= 战车的远征被动 =================
  // 每辆车一个，只在远征（爽快规则）里生效，用来把「选哪辆车开局」变成流派的起点。
  // perks 跟遗物一样并进 Run.perks()；weapon(w) 是改武器副本的（在改造之后跑）。
  Run.PASSIVES = {
    liehuo: { name: '多面手', desc: '这一发换了一把和上一发不同的武器，伤害 +25%。', perks: { variety: 0.25 } },
    honglong: { name: '嗜血', desc: '击破敌人时回复 15% 耐久，下一发伤害 +40%。', perks: { bloodlust: 1 } },
    tiejingang: { name: '铁壁', desc: '一回合没挪窝，到下次轮到你之前受到的伤害 -30%。', perks: { brace: 0.3 } },
    beibeilong: { name: '一窝蛋', desc: '所有多发武器多撒一发。', perks: {},
      weapon: function (w) { if (w.count > 1) w.count += 1; } },
    duzhizhu: { name: '蚀甲', desc: '敌人身上带着灼烧或中毒时，你对它的伤害 +30%。', perks: { corrode: 0.3 } },
    xuanfeng: { name: '乘风', desc: '炮弹受风影响减半；风越大伤害越高，满风 +30%。', perks: { windRider: 0.3 },
      weapon: function (w) { w.windMul = (w.windMul == null ? 1 : w.windMul) * 0.5; } },
    tuoer: { name: '雷鸣', desc: '每第三次开火，落点额外引下一道落雷。', perks: { thunderEvery: 3 } },
    chiyan: { name: '燎原', desc: '你留下的地火多烧一轮、伤害 +50%；你自己站在火里不受伤。', perks: { pyro: 1 } },
    landeng: { name: '精准', desc: '直接命中再 +30% 伤害，并回 8 点燃料。', perks: { precise: 0.3 } },
    aodin: { name: '镇地', desc: '不会被击飞；炸出的坑大 40%。', perks: { anchor: 1, dig: 0.4 } }
  };
  Run.passiveOf = function (vid) { return Run.PASSIVES[vid] || null; };

  // ================= 遗物 =================
  // perks 是一组可相加的数值，Game 里按名字读；gain 是拿到那一刻的一次性效果。
  Run.RELICS = [
    { id: 'turbo', name: '涡轮增压器', rarity: 'common', desc: '每回合多回 8 点燃料。', perks: { regen: 8 } },
    { id: 'tank', name: '备用油箱', rarity: 'common', desc: '每场战斗开局多 45 点燃料。', perks: { startFuel: 45 } },
    { id: 'plate', name: '反应装甲', rarity: 'common', desc: '受到的伤害 -15%。', perks: { armor: 0.15 } },
    { id: 'nano', name: '纳米修复', rarity: 'common', desc: '每回合开始恢复 3% 耐久。', perks: { repair: 0.03 } },
    { id: 'jet', name: '喷气履带', rarity: 'common', desc: '移动耗油减半，爬坡能力 +8。', perks: { jet: 0.5, climb: 8 } },
    { id: 'crit', name: '暴击芯片', rarity: 'common', desc: '每一发有 25% 概率暴击，伤害 ×1.6。', perks: { crit: 0.25 } },
    { id: 'siphon', name: '虹吸管', rarity: 'common', desc: '每次打中敌人回 5 点燃料。', perks: { siphon: 5 } },
    { id: 'bounty', name: '赏金合同', rarity: 'common', desc: '战斗获得的金币 +40%。', perks: { gold: 0.4 } },
    { id: 'hull', name: '加厚底盘', rarity: 'common', desc: '最大耐久 +150，并立刻补上。',
      gain: function (s) { s.hpBonus += 150; s.hp += 150; } },
    { id: 'demo', name: '爆破专家', rarity: 'common', desc: '所有爆炸范围 +15%，你引爆的油桶伤害翻倍。', perks: { blast: 0.15, barrel: 1 } },
    { id: 'magnet', name: '磁力底盘', rarity: 'common', desc: '不会被击飞，也不会摔伤。', perks: { anchor: 1 } },
    { id: 'ram', name: '冲击弹头', rarity: 'common', desc: '所有武器击退力 +80%。', perks: { kb: 0.8 } },

    { id: 'scope', name: '激光测距仪', rarity: 'rare', desc: '弹道预览从「前半段」变成「全程」。', perks: { scope: 1 } },
    { id: 'ambush', name: '先发制人', rarity: 'rare', desc: '每场战斗的第一发伤害 ×2。', perks: { ambush: 1 } },
    { id: 'combo', name: '连击引擎', rarity: 'rare', desc: '连续命中的每个回合伤害 +15%（最多五层），打空清零。', perks: { combo: 0.15 } },
    { id: 'berserk', name: '狂战士核心', rarity: 'rare', desc: '耐久越低伤害越高，濒死时 +60%。', perks: { berserk: 0.6 } },
    { id: 'after', name: '余震装置', rarity: 'rare', desc: '每次爆炸后在原地追加一次范围更大、40% 威力的余震。', perks: { aftershock: 0.4 } },
    { id: 'auto', name: '自动装填机', rarity: 'rare', desc: '每第三个回合免费获得一次双倍攻击。', perks: { autoDouble: 1 } },
    { id: 'thorns', name: '荆棘电网', rarity: 'rare', desc: '把受到伤害的 30% 反弹给开火者。', perks: { thorns: 0.3 } },
    { id: 'vamp', name: '吸能装甲', rarity: 'rare', desc: '造成伤害的 10% 转化为自己的耐久。', perks: { vamp: 0.1 } },
    { id: 'glass', name: '玻璃大炮', rarity: 'rare', desc: '攻击 +40%，但最大耐久 -25%。', perks: { atk: 0.4, glass: 0.25 } },
    { id: 'revive', name: '应急核心', rarity: 'rare', desc: '被击破时以 40% 耐久复活一次（用掉就没了）。', perks: { revive: 1 } },

    { id: 'ultra', name: '过载电容', rarity: 'boss', desc: '每场战斗开局燃料直接加满——第一手就能放必杀。', perks: { startFuel: 200 } },
    { id: 'twin', name: '双联炮塔', rarity: 'boss', desc: '一号、二号武器各免费装上一个「分裂弹头」。',
      gain: function (s) { s.mods.w1.push('split'); s.mods.w2.push('split'); } },
    { id: 'titan', name: '泰坦骨架', rarity: 'boss', desc: '最大耐久 +300，并把耐久补满。',
      gain: function (s) { s.hpBonus += 300; s.hp = 99999; } },

    // ---- 诅咒遗物：好处比稀有遗物还大，代价一直跟着你。只从事件和商店的黑市角落来，修整时可以「净化」掉 ----
    { id: 'bloodmag', name: '血契弹匣', rarity: 'curse', desc: '攻击 +35%。代价：每次开火失去 3% 最大耐久（不会因此阵亡）。',
      perks: { atk: 0.35, selfHarm: 0.03 } },
    { id: 'leaky', name: '无底油箱', rarity: 'curse', desc: '每回合多回 15 点燃料。代价：每场战斗开局燃料清零。',
      perks: { regen: 15, noStartFuel: 1 } },
    { id: 'dice', name: '赌徒骰子', rarity: 'curse', desc: '暴击率 +35%。代价：每一发有 20% 概率哑火，只剩三成伤害。',
      perks: { crit: 0.35, dud: 0.2 } },
    { id: 'greed', name: '贪婪之心', rarity: 'curse', desc: '金币 +80%。代价：受到的伤害 +20%。',
      perks: { gold: 0.8, armor: -0.2 } },
    { id: 'lead', name: '铅制装甲', rarity: 'curse', desc: '最大耐久 +350 并立刻补上。代价：移动耗油翻倍。',
      perks: { jet: -1 }, gain: function (s) { s.hpBonus += 350; s.hp += 350; },
      lose: function (s) { s.hpBonus -= 350; } },
    { id: 'myopia', name: '短视镜片', rarity: 'curse', desc: '攻击 +25%。代价：弹道预览只剩开头一小段。',
      perks: { atk: 0.25, blind: 1 } }
  ];
  Run.relicById = function (id) { return byId(Run.RELICS, id); };

  // ================= 联动 =================
  // 两件遗物都在手里时额外生效。数值型的直接并进 perks；带新行为的 perks 名字 game.js 认得。
  // 手里已经有一半时，另一半在奖励里出现的机会翻三倍（见 relicWeight）。
  Run.SYNERGIES = [
    { id: 'chainblast', name: '连环爆破', needs: ['after', 'demo'], desc: '余震威力再 +20%，范围再 +10%。', perks: { aftershock: 0.2, blast: 0.1 } },
    { id: 'weakspot', name: '弱点分析', needs: ['crit', 'combo'], desc: '连击每一层再加 6% 暴击率。', perks: { critPerStreak: 0.06 } },
    { id: 'hedgehog', name: '刺猬', needs: ['thorns', 'plate'], desc: '反弹比例再 +30%。', perks: { thorns: 0.3 } },
    { id: 'cycle', name: '再生循环', needs: ['vamp', 'nano'], desc: '吸能再 +10%，每回合修复再 +2%。', perks: { vamp: 0.1, repair: 0.02 } },
    { id: 'salvo', name: '首轮齐射', needs: ['ambush', 'auto'], desc: '每场战斗的第一发自动变成双倍攻击。', perks: { ambushDouble: 1 } },
    { id: 'edge', name: '刀尖舞者', needs: ['glass', 'berserk'], desc: '攻击再 +20%。', perks: { atk: 0.2 } },
    { id: 'dozer', name: '推土机', needs: ['ram', 'magnet'], desc: '击退力再 +60%，把敌人打下地图多拿 15 金币赏金。', perks: { kb: 0.6, ringGold: 15 } },
    { id: 'recycle', name: '回收专家', needs: ['bounty', 'siphon'], desc: '每炸到一个敌人 +3 金币。', perks: { goldPerHit: 3 } },
    { id: 'sniper', name: '狙击手', needs: ['scope', 'crit'], desc: '隔着 1000px 以上命中，伤害 ×1.6。', perks: { snipeCrit: 0.6 } },
    { id: 'guzzler', name: '油老虎', needs: ['turbo', 'tank'], desc: '每回合再多回 6 点燃料，开局再多 30 点。', perks: { regen: 6, startFuel: 30 } },
    { id: 'phoenix', name: '浴火重生', needs: ['revive', 'berserk'], desc: '应急核心复活时直接满血，而不是四成。', perks: { phoenix: 1 } }
  ];
  Run.synergyById = function (id) { return byId(Run.SYNERGIES, id); };
  /** 手里这些遗物凑成了哪些联动 */
  Run.activeSynergies = function (state) {
    return Run.SYNERGIES.filter(function (sy) {
      return state.relics.indexOf(sy.needs[0]) >= 0 && state.relics.indexOf(sy.needs[1]) >= 0;
    });
  };
  /** 这件遗物参与的联动，以及另一半是谁 */
  Run.synergiesOf = function (relicId) {
    var out = [];
    Run.SYNERGIES.forEach(function (sy) {
      var k = sy.needs.indexOf(relicId);
      if (k >= 0) out.push({ syn: sy, partner: sy.needs[1 - k] });
    });
    return out;
  };

  /** 把战车被动、手里所有遗物、凑成的联动的 perks 加起来 */
  Run.perks = function (state) {
    var out = {}, i, k;
    var add = function (pk) { for (k in pk) out[k] = (out[k] || 0) + pk[k]; };
    var ps = Run.passiveOf(state.vehicleId);
    if (ps) add(ps.perks);
    for (i = 0; i < state.relics.length; i++) {
      var r = Run.relicById(state.relics[i]);
      if (r && r.perks) add(r.perks);
    }
    Run.activeSynergies(state).forEach(function (sy) { add(sy.perks); });
    if (state.fuelBonus) add({ startFuel: state.fuelBonus });    // 事件「黑市加油站」
    return out;
  };

  // ================= 三个区域 =================
  // Boss 都带磁力底盘（anchor）：不然在浮岛图上一炮掀下去就没了，太便宜。
  Run.ACTS = [
    {
      name: '锈蚀前线', maps: ['dry', 'canyon', 'forest', 'city'],
      boss: { vid: 'aodin', name: '碾压者', kit: 'crusher', hp: 1080, atk: 82, scale: 1.5, map: 'canyon',
              mods: { w1: ['cluster'], w2: ['blast'] }, perks: { anchor: 1, armor: 0.1 }, escorts: 0 }
    },
    {
      name: '风暴航道', maps: ['sky', 'sea', 'ice', 'bridge'],
      boss: { vid: 'xuanfeng', name: '风暴女王', kit: 'queen', hp: 1150, atk: 84, scale: 1.45, map: 'sky',
              mods: { w1: ['apex', 'thunder'], w2: ['split'] }, perks: { anchor: 1 }, escorts: 1 }
    },
    {
      name: '星环终点', maps: ['star', 'canyon', 'sea', 'spires', 'city'],
      boss: { vid: 'honglong', name: '终焉战车', kit: 'doom', hp: 1350, atk: 76, scale: 1.7, map: 'star',
              mods: { w1: ['burn', 'cluster'], w2: ['apex'] },
              perks: { anchor: 1, armor: 0.1 }, escorts: 2 }
    }
  ];
  Run.LAYERS_PER_ACT = 5;

  Run.STARTERS = ['liehuo', 'tiejingang', 'beibeilong'];   // 一开始就能用的三辆
  Run.UNLOCK_COST = 6;                                      // 其余每辆花 6 枚勋章
  Run.MAX_ASC = 5;
  Run.HISTORY_MAX = 20;                                     // 历史只留最近 20 局（进度码里带着它，太长了网址放不下）

  // ================= 局外存档 =================
  var memStore = {};
  function storeGet(key) {
    try { if (window.localStorage) return window.localStorage.getItem(key); } catch (e) { /* 隐私模式等 */ }
    return memStore[key] || null;
  }
  function storeSet(key, val) {
    memStore[key] = val;
    try { if (window.localStorage) window.localStorage.setItem(key, val); } catch (e) { /* 存不了就只留在内存里 */ }
  }
  function storeDel(key) {
    delete memStore[key];
    try { if (window.localStorage) window.localStorage.removeItem(key); } catch (e) { /* 同上 */ }
  }

  // 局外存档写两份：每次写入前把上一份挪到 rz-meta-bak。主档读不出来（写到一半断电、
  // 被别的东西改坏）就退回备份那份，最多丢最近一次远征的结算。
  function readMeta(key) {
    try {
      var m = JSON.parse(storeGet(key) || 'null');
      return m && typeof m === 'object' ? m : null;
    } catch (e) { return null; }
  }
  /** 把一份可能残缺、可能来自旧版本的局外存档补齐成当前版本的样子 */
  function normalizeMeta(m) {
    if (!m || typeof m !== 'object') m = {};
    var ok = function (id) { return !!RZ.vehicleById(id) && RZ.vehicleById(id).id === id; };
    m.v = 1;                       // 存档格式版本；以后改格式就在这里按旧版本号做迁移
    m.medals = Math.max(0, m.medals | 0);
    m.unlocked = (m.unlocked && m.unlocked.length ? m.unlocked : Run.STARTERS).filter(ok);
    Run.STARTERS.forEach(function (id) { if (m.unlocked.indexOf(id) < 0) m.unlocked.push(id); });
    m.asc = Math.max(0, Math.min(Run.MAX_ASC, m.asc | 0));      // 已解锁的最高进阶
    m.wins = Math.max(0, m.wins | 0);
    m.runs = Math.max(0, m.runs | 0);
    m.best = Math.max(0, m.best | 0);          // 打赢过的最多场数
    m.lastBackup = m.lastBackup || 0;          // 上次导出进度的时间
    m.sinceBackup = Math.max(0, m.sinceBackup | 0);   // 上次导出之后又打完了几次远征
    // ---- v1.5：图鉴、成就、历史、每日挑战。老存档里没有，补成空的 ----
    var list = function (x) { return Array.isArray(x) ? x.filter(function (v) { return typeof v === 'string'; }) : []; };
    var sn = m.seen && typeof m.seen === 'object' ? m.seen : {};
    m.seen = { relics: list(sn.relics), mods: list(sn.mods), foes: list(sn.foes), mapMods: list(sn.mapMods) };
    m.ach = m.ach && typeof m.ach === 'object' && !Array.isArray(m.ach) ? m.ach : {};     // { 成就 id: 达成时间 }
    m.history = Array.isArray(m.history) ? m.history.filter(function (h) { return h && typeof h === 'object'; }).slice(0, Run.HISTORY_MAX) : [];
    m.wonWith = list(m.wonWith).filter(ok);                                              // 用哪些车通关过
    m.daily = m.daily && typeof m.daily === 'object' && typeof m.daily.date === 'string' ? m.daily : null;   // 最近一天的每日挑战成绩
    m.dailyWins = Math.max(0, m.dailyWins | 0);
    m.endlessBest = Math.max(0, m.endlessBest | 0);                                      // 无尽模式最多额外打穿几个区域
    return m;
  }
  Run._storeSet = storeSet;      // 测试用：直接往存储里塞东西，模拟存档被写坏
  Run.loadMeta = function () { return normalizeMeta(readMeta('rz-meta') || readMeta('rz-meta-bak')); };
  Run.saveMeta = function (m) {
    var prev = storeGet('rz-meta');
    if (prev && readMeta('rz-meta')) storeSet('rz-meta-bak', prev);
    storeSet('rz-meta', JSON.stringify(normalizeMeta(m)));
  };
  Run.unlock = function (meta, vid) {
    if (meta.unlocked.indexOf(vid) >= 0 || meta.medals < Run.UNLOCK_COST) return false;
    meta.medals -= Run.UNLOCK_COST;
    meta.unlocked.push(vid);
    Run.saveMeta(meta);
    return true;
  };

  // 两个存档位：普通远征一个（rz-run），每日挑战一个（rz-daily）。
  // 只有一个位置的时候，打到一半的远征会把每日挑战挡在外面——想打今天的就得先放弃手里这局。
  function slotOf(state) { return state && state.daily ? 'rz-daily' : 'rz-run'; }
  Run.save = function (state) { storeSet(slotOf(state), JSON.stringify(state)); };
  /** 一份远征存档看起来是不是完整的（导入别处来的进度时用） */
  function validRun(r) {
    return !!r && r.v === 1 && !r.over && !!RZ.vehicleById(r.vehicleId) && RZ.vehicleById(r.vehicleId).id === r.vehicleId &&
      Array.isArray(r.layers) && r.layers.length > 0 && Array.isArray(r.relics) && !!r.mods && typeof r.hp === 'number';
  }
  function readRun(key) {
    try {
      var s = JSON.parse(storeGet(key) || 'null');
      return s && s.v === 1 && !s.over ? s : null;
    } catch (e) { return null; }
  }
  /** 打到一半的普通远征 */
  Run.load = function () {
    var s = readRun('rz-run');
    if (s && s.daily) {            // v1.5 刚出时每日挑战也存在这个位置：挪到它自己的位置去
      storeDel('rz-run');
      if (s.daily === Run.dateKey()) storeSet('rz-daily', JSON.stringify(s));
      return null;
    }
    return s;
  };
  /** 打到一半的每日挑战。只认今天的——昨天那局过了零点就作废 */
  Run.loadDaily = function () {
    var s = readRun('rz-daily');
    if (s && s.daily !== Run.dateKey()) { storeDel('rz-daily'); return null; }
    return s;
  };
  /** 清掉存档。传 state 就清它所在的那个位置；不传清普通远征的 */
  Run.clear = function (state) { storeDel(slotOf(state)); };

  // ================= 进度码：不做账号，也能把进度带走 =================
  // 进度只存在这台设备的浏览器里：清数据、换设备、Safari 七天不来都会丢。
  // 所以给玩家一串「进度码」——勋章、解锁、进行中的远征全在里面，复制走、存成文件、
  // 或者拼在网址 # 后面发到另一台设备上，都能原样读回来。
  // 格式：RZ1.<8 位校验>.<base64url(JSON 的 UTF-8)>。校验只为了发现「粘贴时少了一截」，
  // 不防篡改——单机游戏改存档只影响自己。
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function fromUtf8(b) {
    var s = '';
    for (var i = 0; i < b.length;) {
      var c = b[i++];
      if (c >= 0xf0) c = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
      else if (c >= 0xe0) c = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
      else if (c >= 0xc0) c = ((c & 31) << 6) | (b[i++] & 63);
      if (c >= 0x10000) { c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); }
      else s += String.fromCharCode(c);
    }
    return s;
  }
  function b64enc(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '') + (i + 2 < bytes.length ? B64[n & 63] : '');
    }
    return s;
  }
  function b64dec(s) {
    var out = [], acc = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      var v = B64.indexOf(s[i]);
      if (v < 0) return null;
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    }
    return out;
  }
  function checksum(s) {                       // FNV-1a，32 位
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  /** 把当前全部进度打成一串进度码 */
  Run.exportCode = function () {
    var body = b64enc(utf8(JSON.stringify({ v: 1, game: RZ.VERSION, meta: Run.loadMeta(), run: Run.load() })));
    return 'RZ1.' + checksum(body) + '.' + body;
  };

  /**
   * 读一串进度码（也接受带 #save= 的整条链接）。不写入任何东西，只告诉你里面是什么：
   * { ok: true, meta, run } 或 { ok: false, error: '给玩家看的原因' }。
   */
  Run.parseCode = function (text) {
    var code = String(text || '').replace(/\s+/g, '');
    var at = code.indexOf('RZ1.');
    if (at < 0) return { ok: false, error: '这不是一串进度码——它应该以 RZ1. 开头。' };
    var parts = code.slice(at).split('.');
    if (parts.length !== 3 || checksum(parts[2]) !== parts[1]) return { ok: false, error: '进度码不完整，可能复制时少了一截。请重新复制整串。' };
    var bytes = b64dec(parts[2]), data = null;
    try { data = bytes && JSON.parse(fromUtf8(bytes)); } catch (e) { data = null; }
    if (!data || typeof data !== 'object' || !data.meta) return { ok: false, error: '进度码读不出来，可能已经损坏。' };
    return { ok: true, meta: normalizeMeta(data.meta), run: validRun(data.run) ? data.run : null };
  };

  /** 用进度码覆盖这台设备上的进度 */
  Run.importCode = function (text) {
    var r = Run.parseCode(text);
    if (!r.ok) return r;
    r.meta.lastBackup = Date.now(); r.meta.sinceBackup = 0;     // 刚从备份恢复，等于刚备份过
    Run.saveMeta(r.meta);
    if (r.run) Run.save(r.run); else Run.clear();
    return r;
  };

  /** 记一笔：玩家刚刚把进度带走了 */
  Run.markBackup = function () {
    var m = Run.loadMeta();
    m.lastBackup = Date.now(); m.sinceBackup = 0;
    Run.saveMeta(m);
  };
  /** 该提醒备份了吗：攒了三次远征没导出，或者已经解锁过东西却从没导出过 */
  Run.needsBackup = function (meta) {
    return meta.sinceBackup >= 3 || (!meta.lastBackup && (meta.unlocked.length > Run.STARTERS.length || meta.wins > 0));
  };

  // ================= 开局 =================
  Run.newRun = function (vehicleId, opts) {
    opts = opts || {};
    var base = RZ.vehicleById(vehicleId);
    var state = {
      v: 1,
      vehicleId: base.id,
      hp: base.hp, hpBonus: 0,
      gold: 30,
      relics: [],
      mods: { w1: [], w2: [], ss: [] },
      items: ['heal1', 'double'],
      act: 0, step: 0, layers: null,
      node: null,                 // 正在打的那个节点
      pending: null,              // 等玩家处理的界面：奖励 / 商店 / 修整 / 事件
      asc: opts.asc || 0,
      hardcore: !!opts.hardcore,
      battles: 0, bosses: 0, earned: 0,
      over: false, won: false,
      seed: Run.cleanSeed(opts.seed) || Run.randomSeed(),
      daily: opts.daily || null,   // 每日挑战的日期（'2026-11-15'），不是每日挑战就是 null
      endless: 0,                  // 通关后进了无尽模式：已经额外打穿了几个区域
      t0: Date.now()
    };
    state.layers = Run.genLayers(state);
    return state;
  };

  /** 远征里玩家实际开的那辆车：基础车 + 遗物 + 改造 */
  Run.playerVehicle = function (state) {
    var base = RZ.vehicleById(state.vehicleId), pk = Run.perks(state);
    var v = copy(base);
    v.hp = Math.round((base.hp + state.hpBonus) * (1 - (pk.glass || 0)));
    v.atk = Math.round(base.atk * (1 + (pk.atk || 0)));
    v.moveCost = base.moveCost * (1 - (pk.jet || 0));
    v.climb = base.climb + (pk.climb || 0);
    v.regen = base.regen + (pk.regen || 0);
    v.atk = Math.round(v.atk * (1 + (state.atkBonus || 0)));     // 事件「训练场」攒下的
    v.w1 = Run.modWeapon(base.w1, state.mods.w1);
    v.w2 = Run.modWeapon(base.w2, state.mods.w2);
    v.ss = Run.modWeapon(base.ss, state.mods.ss);
    var ps = Run.passiveOf(base.id);
    if (ps && ps.weapon) { ps.weapon(v.w1); ps.weapon(v.w2); ps.weapon(v.ss); }
    return v;
  };
  Run.maxHp = function (state) { return Run.playerVehicle(state).hp; };
  function clampHp(state) { state.hp = Math.max(1, Math.min(Run.maxHp(state), Math.round(state.hp))); }

  // ================= 路线 =================
  function depthOf(state, step) { return state.act * Run.LAYERS_PER_ACT + step; }
  /** 当前区域的定义。无尽模式里 act 一直往上涨，三个区域轮着来 */
  Run.actOf = function (state) { return Run.ACTS[state.act % Run.ACTS.length]; };
  /** 无尽模式的第几圈（0 = 还在正常的三个区域里） */
  Run.loopOf = function (state) { return Math.floor(state.act / Run.ACTS.length); };
  /**
   * 无尽模式里敌人的额外倍率：通关后每打穿一个区域乘一次（指数涨），不是每圈。
   * 玩家的流派是乘出来的，敌人只按层数线性涨的话，通关时「糊了」的一身能平推好几圈——试玩时就是这样。
   * 普通敌人每个区域耐久 ×1.5、攻击 ×1.25；Boss 耐久涨得更快（×1.9），不然必杀两轮就没了。
   * 拿一身很强的流派让代打去打：第 1 个区域还算轻松，第 3 个开始吃力，第 5 个基本过不去。
   */
  Run.ENDLESS = { hp: 1.5, atk: 1.25, bossHp: 1.9 };
  Run.endlessDepth = function (state) { return Math.max(0, state.act - Run.ACTS.length + 1); };   // 无尽里的第几个区域（0 = 还没通关）
  Run.endlessMul = function (state) {
    var n = Run.endlessDepth(state);
    return { hp: Math.pow(Run.ENDLESS.hp, n), atk: Math.pow(Run.ENDLESS.atk, n), bossHp: Math.pow(Run.ENDLESS.bossHp, n) };
  };

  function enemyDef(state, step, kind) {
    var d = depthOf(state, step), asc = state.asc;
    var pool = RZ.VEHICLES.filter(function (v) { return v.id !== state.vehicleId; });
    var v = pick(pool);
    var e = {
      vid: v.id, name: v.name,
      hpMul: (0.44 + 0.045 * d) * (1 + asc * 0.08) * Run.endlessMul(state).hp,
      atkMul: (0.52 + 0.03 * d) * (1 + asc * 0.06) * Run.endlessMul(state).atk,
      mods: { w1: [], w2: [], ss: [] }, perks: {}
    };
    if (kind === 'elite') {
      e.name = '精英·' + v.name;
      e.hpMul *= 1.5; e.atkMul += 0.1;
      e.mods.w1 = sample(['split', 'heavy', 'blast', 'burn', 'cluster', 'bounce'], 2);
      e.perks = pick([{ armor: 0.2 }, { thorns: 0.25 }, { repair: 0.04 }, { crit: 0.3 }]);
      e.scale = 1.2;
    }
    return e;
  }

  // ---- 特殊敌人（v1.4）：在普通敌人定义上换一副样子、加一条规矩 ----
  // art / pal 换画法（render.js 的 ART.turret / ART.bomb），perks 里的 rooted / kamikaze 是 game.js 认的。
  Run.FOE_KINDS = {
    turret: { name: '炮台', tag: '固定炮台', note: '不会移动，也不会被击飞。血厚炮重——挖掉它脚下的地。',
      art: 'turret', pal: ['#8a8f7a', '#4f5546', '#d8361f', '#b89b62'] },
    swarm: { name: '游骑', tag: '小车', note: '成群出动，每辆都脆，只会打一号武器。' },
    bomber: { name: '自爆车', tag: '自爆车', note: '不开炮，一路朝你开过来，贴上就炸。打死它会原地殉爆——炸到它的同伙正好。',
      art: 'bomb', pal: ['#d8361f', '#8f2618', '#f5b921', '#4a3a2c'] }
  };

  function turretDef(state, step) {
    var e = enemyDef(state, step, 'fight');
    e.kind = 'turret'; e.name = '炮台·' + e.name;
    e.hpMul *= 1.2;                              // 血厚，但炮和别人一样——它已经占了「打不动、掀不走」的便宜
    e.perks = { rooted: 1, anchor: 1 };
    return e;
  }
  function swarmDef(state, step) {
    var e = enemyDef(state, step, 'fight');
    e.kind = 'swarm'; e.name = '游骑·' + e.name;
    e.hpMul *= 0.26; e.atkMul *= 0.55; e.scale = 0.72;
    return e;
  }
  function bomberDef(state, step) {
    var e = enemyDef(state, step, 'fight');
    e.kind = 'bomber'; e.vid = 'liehuo'; e.name = '自爆车';
    e.hpMul *= 0.34; e.atkMul *= 0.9; e.scale = 0.85;
    e.perks = { kamikaze: 1 };
    return e;
  }

  // 地图词条：哪些图上不该出（本来就低重力的图不再叠低重力，没风的图刮不起大风）
  function rollMods(mapId, chance) {
    if (rand() >= chance) return [];
    var map = RZ.mapById(mapId);
    var pool = ['night', 'meteor'];
    if (map.windMax >= 6) pool.push('gale');
    if (map.gravity >= 0.34) pool.push('lowg');
    return [pick(pool)];
  }

  // 带词条的仗更难打，得值得选：多 25 金币，战后奖励还多一个稀有选项（见 rewardChoices）
  Run.MOD_GOLD = 25;
  function setMods(node, mods) {
    if (node.mods && node.mods.length) node.gold -= Run.MOD_GOLD;
    node.mods = mods;
    if (mods.length) node.gold += Run.MOD_GOLD;
  }

  function fightNode(state, step, kind) {
    var act = Run.actOf(state), d = depthOf(state, step), i, e;
    var node = { type: kind, mapId: pick(act.maps), enemies: [], gold: kind === 'elite' ? 70 + d * 4 : 32 + d * 3 };
    var roll = kind === 'fight' ? rand() : 1;
    if (d >= 1 && roll < 0.14) {
      // 一群小车：三辆，最后一个区域四辆
      for (i = 0; i < (state.act >= 2 ? 4 : 3); i++) node.enemies.push(swarmDef(state, step));
      node.gold += 12;
    } else if (d >= 1 && roll < 0.28) {
      // 炮台 + 一辆护着它的小车
      node.enemies.push(turretDef(state, step));
      e = enemyDef(state, step, 'fight'); e.hpMul *= 0.4; e.atkMul *= 0.75;
      node.enemies.push(e);
      node.gold += 12;
    } else if (d >= 3 && roll < 0.42) {
      // 两辆自爆车 + 一辆正常开炮的
      e = enemyDef(state, step, 'fight'); e.hpMul *= 0.7; e.atkMul *= 0.9;
      node.enemies.push(e);
      node.enemies.push(bomberDef(state, step)); node.enemies.push(bomberDef(state, step));
      node.gold += 12;
    } else if (kind === 'fight' && d >= 2 && roll < 0.68) {
      // 两辆小的：每辆更脆，但要挨两份炮
      for (i = 0; i < 2; i++) {
        e = enemyDef(state, step, 'fight');
        e.hpMul *= 0.6; e.atkMul *= 0.85;
        node.enemies.push(e);
      }
      node.gold += 10;
    } else {
      node.enemies.push(enemyDef(state, step, kind));
    }
    // 地图词条：整局的头一场不出，之后普通战斗四成、精英六成
    // 无尽模式里每一场都带词条
    if (d >= 1) setMods(node, rollMods(node.mapId, Run.endlessDepth(state) ? 1 : kind === 'elite' ? 0.6 : 0.4));
    return node;
  }

  /** 限回合挑战：一辆比平时壮一点的敌人，规定轮数内打掉拿精英级奖励；超时它就跑了，什么都没有 */
  function trialNode(state, step) {
    var node = fightNode(state, step, 'elite');
    node.type = 'trial';
    node.enemies = [enemyDef(state, step, 'fight')];
    node.enemies[0].hpMul *= 1.1;
    node.enemies[0].name = '逃兵·' + node.enemies[0].name;
    node.mods = [];
    node.limit = 5;
    node.gold = 60 + depthOf(state, step) * 4;
    return node;
  }

  function bossNode(state) {
    var act = Run.actOf(state), b = act.boss, asc = state.asc;
    var loop = Run.endlessDepth(state), em = Run.endlessMul(state);   // 无尽模式：Boss 跟着每个区域的倍率一起涨
    var node = { type: 'boss', mapId: b.map, enemies: [], gold: 120 + state.act * 40 };
    node.enemies.push({
      vid: b.vid, name: (loop ? '狂暴·' : '') + b.name, boss: true, kit: b.kit, scale: b.scale,
      hp: Math.round(b.hp * (1 + asc * 0.08) * em.bossHp), atk: Math.round(b.atk * (1 + asc * 0.05) * em.atk),
      mods: { w1: (b.mods.w1 || []).slice(), w2: (b.mods.w2 || []).slice(), ss: (b.mods.ss || []).slice() },
      perks: copy(b.perks)
    });
    for (var i = 0; i < b.escorts; i++) {
      var e = enemyDef(state, Run.LAYERS_PER_ACT - 1, 'fight');
      e.hpMul *= 0.35; e.atkMul *= 0.62; e.name = '护卫·' + e.name;
      node.enemies.push(e);
    }
    return node;
  }

  /**
   * 一个区域五层：开场必打 → 自由选 → 精英 / 商店 / 修整 → 自由选 → Boss。
   * 每层给两三个选项。打得越多拿得越多，也掉得越多血——这就是每一步要权衡的东西。
   */
  Run.genLayers = function (state) {
    return seeded(state, 'L' + state.act, function () { return genLayersRaw(state); });
  };
  function genLayersRaw(state) {
    var L = [], other = function () { return { type: pick(['shop', 'rest', 'event', 'event', 'chest']) }; };
    L.push([fightNode(state, 0, 'fight'), fightNode(state, 0, 'fight')]);
    L.push([fightNode(state, 1, 'fight'), other(), fightNode(state, 1, 'fight')]);
    // 每个区域的第二层保证有一场带词条的仗摆在面前——不然运气差的时候一整个区域都见不到新东西
    if (!L[1][0].mods.length && !L[1][2].mods.length) setMods(L[1][0], rollMods(L[1][0].mapId, 1));
    L.push([fightNode(state, 2, 'elite'), { type: 'shop' }, { type: 'rest' }]);
    // Boss 前一层：普通战斗有四成换成限回合挑战；不想打的那一格偶尔是诅咒祭坛
    L.push([rand() < 0.4 ? trialNode(state, 3) : fightNode(state, 3, 'fight'), fightNode(state, 3, 'elite'),
      { type: pick(['rest', 'shop', 'altar']) }]);
    L.push([bossNode(state)]);
    return L;
  }

  Run.choices = function (state) { return state.layers[state.step]; };

  var AI_BY_ACT = ['easy', 'normal', 'hard'];

  Run.enemyVehicle = enemyVehicle;
  function enemyVehicle(e) {
    var base = RZ.vehicleById(e.vid), v = copy(base);
    v.hp = e.hp || Math.round(base.hp * e.hpMul);
    v.atk = e.atk || Math.round(base.atk * e.atkMul);
    v.w1 = Run.modWeapon(base.w1, e.mods.w1);
    v.w2 = Run.modWeapon(base.w2, e.mods.w2);
    v.ss = Run.modWeapon(base.ss, e.mods.ss);
    if (e.boss) v.regen = base.regen + 3;       // Boss 回油快，必杀放得勤
    var kind = e.kind && Run.FOE_KINDS[e.kind];
    if (kind) {
      v.tag = kind.tag;
      if (kind.art) { v.art = kind.art; v.pal = kind.pal.slice(); }
      if (e.kind === 'swarm') { v.w2.fuel = 999; v.ss.fuel = 999; }            // 小车只会打一号武器
      if (e.kind === 'bomber') { v.name = kind.name; v.moveCost = 0.01; v.w1.fuel = 0; v.climb = Math.max(v.climb, 16); }   // 油不是它的问题
    }
    return v;
  }

  /** 这个节点是不是要打一场 */
  Run.isBattle = function (node) {
    return !!node && (node.type === 'fight' || node.type === 'elite' || node.type === 'boss' || node.type === 'trial');
  };

  /** 选一个节点：战斗类返回 true（界面该去开打了），其余的把 pending 填好 */
  Run.enter = function (state, index) {
    if (state.pending || state.over) return false;
    var node = Run.choices(state)[index];
    if (!node) return false;
    state.node = node;
    if (Run.isBattle(node)) return true;
    if (node.type === 'shop') state.pending = { kind: 'shop', stock: Run.genStock(state) };
    else if (node.type === 'rest') state.pending = { kind: 'rest' };
    else if (node.type === 'chest') {
      // 宝箱：白拿一笔钱，再从两样东西里挑一样。不用打
      var g = 30 + Math.round(rand() * 30) + depthOf(state, state.step) * 2;
      state.gold += g;
      state.pending = { kind: 'reward', from: 'chest', gold: g, style: 0, choices: rewardChoices(state, 'chest') };
    }
    else if (node.type === 'altar') state.pending = { kind: 'event', id: 'altar' };
    else state.pending = { kind: 'event', id: pickEvent(state) };
    return false;
  };

  /** 同名的敌人按出场顺序编号：第一辆不带，后面的 ·2 ·3 …… */
  function dupSuffix(list, i) {
    var n = 0;
    for (var k = 0; k < i; k++) if (list[k].name === list[i].name) n++;
    return n ? '·' + (n + 1) : '';
  }

  /** 把当前节点变成 Game 的 opts。playerAI 只给无头测试 / 平衡模拟用 */
  Run.battleOpts = function (state, playerAI) {
    var node = state.node, roster = [], i;
    var pv = Run.playerVehicle(state), pk = Run.perks(state);
    pk.rescue = 1;                              // 牵引回收：掉出地图被拖回来，不限次数，每次扣两成耐久（见 game.js 的 rescue()）
    roster.push({
      vehicle: pv, team: 0, ai: !!playerAI, aiLevel: typeof playerAI === 'string' ? playerAI : null, name: pv.name,
      items: state.items.slice(), perks: pk, hp: Math.min(pv.hp, state.hp)
    });
    for (i = 0; i < node.enemies.length; i++) {
      var e = node.enemies[i], ev = enemyVehicle(e);
      roster.push({
        vehicle: ev, team: 1, ai: true, name: e.name + dupSuffix(node.enemies, i),
        items: [], perks: e.perks || {}, scale: e.scale || 1, boss: !!e.boss, kit: e.kit || null,
        aiLevel: node.type === 'boss' && !e.boss ? 'normal' : null      // Boss 的护卫打得没那么准，不然三门炮一起点名太狠
      });
    }
    return {
      mapId: node.mapId, roster: roster, arcade: true, hardcore: state.hardcore, guide: true,
      mods: (node.mods || []).slice(), roundLimit: node.limit || 0,
      difficulty: AI_BY_ACT[Math.min(2, state.act + (state.asc >= 3 ? 1 : 0))],
      humanTeam: playerAI ? null : 0
    };
  };

  // ================= 战后 =================
  /** 抽遗物的权重：能和手里某件凑成联动的，机会翻三倍——流派要「抓得到」才成型 */
  function relicWeight(state, r) {
    var w = 1;
    Run.synergiesOf(r.id).forEach(function (x) { if (state.relics.indexOf(x.partner) >= 0) w = 3; });
    return w;
  }
  function pickWeighted(state, list) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += relicWeight(state, list[i]);
    var x = rand() * total;
    for (i = 0; i < list.length; i++) { x -= relicWeight(state, list[i]); if (x < 0) return list[i]; }
    return list[list.length - 1];
  }
  /** 还没拿到的某个稀有度的遗物（taken 里的也排除）。诅咒遗物永远不进普通奖励池 */
  function relicPool(state, rarity, taken) {
    return Run.RELICS.filter(function (r) {
      return r.rarity === rarity && state.relics.indexOf(r.id) < 0 && (!taken || taken.indexOf(r.id) < 0);
    });
  }
  Run.relicPool = relicPool;

  function rewardChoices(state, kind, extraRare) {
    var out = [];
    var taken = function () { return out.map(function (c) { return c.id; }); };
    var relic = function (rarity) {
      var p = relicPool(state, rarity, taken());
      if (!p.length) p = relicPool(state, 'common', taken());
      return p.length ? { type: 'relic', id: pickWeighted(state, p).id } : mod(false);
    };
    var mod = function (rare) {
      var p = modPool(rare).filter(function (m) { return taken().indexOf(m.id) < 0; });
      return { type: 'mod', id: pick(p).id };
    };
    if (kind === 'boss') { out.push(relic('boss')); out.push(relic('rare')); out.push(relic('rare')); }
    else if (kind === 'elite' || kind === 'trial') { out.push(relic('rare')); out.push(relic('rare')); out.push(mod(true)); }
    else if (kind === 'chest') { out.push(relic(rand() < 0.35 ? 'rare' : 'common')); out.push(mod(rand() < 0.3)); }
    else {
      out.push(mod(rand() < 0.1));
      out.push(relic(rand() < 0.18 ? 'rare' : 'common'));
      out.push(rand() < 0.5 ? mod(false) : relic('common'));
    }
    // 事件「拾荒小孩」给的好运：下一次奖励多一个选项
    if (state.luck > 0) { state.luck--; out.push(rand() < 0.5 ? relic('rare') : mod(true)); }
    // 带词条的仗：再多一个稀有选项（稀有遗物或稀有改造）
    if (extraRare) out.push(rand() < 0.5 ? relic('rare') : mod(true));
    return out;
  }

  /**
   * 战斗打完，把结果写回 state。game 是打完的那局 RZ.Game。
   * 赢了：记血、记道具、发钱、摆出三选一；输了：远征结束，结算勋章。
   */
  Run.afterBattle = function (state, game) {
    var me = game.units[0], node = state.node;
    if (game.result !== 0 || !me.alive) { Run.finish(state, false); return; }
    var hpBefore = state.hp;
    var pk = Run.perks(state);
    state.items = me.items.slice(0, RZ.MAX_ITEMS);
    if (me.revived) {                                  // 应急核心是一次性的
      var k = state.relics.indexOf('revive');
      if (k >= 0) state.relics.splice(k, 1);
    }
    state.hp = me.hp + Run.maxHp(state) * 0.18;        // 战后简单抢修
    clampHp(state);
    if (game.trialFailed) {                            // 限回合挑战超时：人没事，但什么也没捞着
      state.battles++;
      var m0 = Run.loadMeta(); noteSeen(m0, state); Run.saveMeta(m0);
      state.pending = { kind: 'note', title: '时间到', text: '规定的轮数里没能全歼，敌人趁乱撤走了。没有奖励，接着赶路。' };
      return;
    }
    var gold = Math.round((node.gold + game.style.gold) * (1 + (pk.gold || 0)) * (state.nextGoldMul || 1));
    state.nextGoldMul = 1;                             // 事件「赏金公告」只管一场
    state.gold += gold;
    state.battles++;
    if (node.type === 'boss') {
      state.bosses++;
      state.hp = Run.maxHp(state);                    // 打完 Boss 彻底大修
      clampHp(state);
    }
    state.pending = { kind: 'reward', from: node.type, gold: gold, style: game.style.gold, choices: rewardChoices(state, node.type, !!(node.mods && node.mods.length)) };
    // 图鉴和成就：每打完一场记一次（远征中途关掉网页也不丢）
    var meta = Run.loadMeta();
    noteSeen(meta, state);
    var got = Run.checkAch(meta, state, { game: game, node: node, hpBefore: hpBefore, hpAfter: me.hp });
    if (got.length) state.pending.ach = got;
    Run.saveMeta(meta);
  };

  function grantRelic(state, id) {
    var r = Run.relicById(id);
    if (!r || state.relics.indexOf(id) >= 0) return;
    state.relics.push(id);
    (state.everRelics || (state.everRelics = [])).push(id);      // 图鉴用：之后被熔掉 / 换走的也算见过
    if (r.gain) r.gain(state);
    clampHp(state);
  }
  /** 拿走一件遗物（净化、熔掉、交换）。有 lose 的把 gain 加的东西退回去 */
  function dropRelic(state, id) {
    var k = state.relics.indexOf(id), r = Run.relicById(id);
    if (k < 0) return false;
    state.relics.splice(k, 1);
    if (r && r.lose) r.lose(state);
    clampHp(state);
    return true;
  }
  function curses(state) {
    return state.relics.filter(function (id) { var r = Run.relicById(id); return r && r.rarity === 'curse'; });
  }
  Run.curses = curses;
  function grantItem(state, id) {
    if (state.items.length >= RZ.MAX_ITEMS) return false;
    state.items.push(id);
    return true;
  }

  /** 三选一。index < 0 表示跳过（折成一点金币）；改造要说明装在哪把武器上 */
  Run.takeReward = function (state, index, slot) {
    var p = state.pending;
    if (!p || p.kind !== 'reward') return false;
    if (index < 0) state.gold += 15;
    else {
      var c = p.choices[index];
      if (!c) return false;
      if (c.type === 'relic') grantRelic(state, c.id);
      else {
        if (!state.mods[slot]) return false;
        state.mods[slot].push(c.id);
      }
    }
    state.pending = null;
    Run.advance(state);
    return true;
  };

  /** 往前走一层；走完一个区域换下一个，走完三个就通关。无尽模式里没有尽头，每打穿一个区域记一笔 */
  Run.advance = function (state) {
    state.node = null;
    state.step++;
    if (state.step >= state.layers.length) {
      state.act++;
      state.step = 0;
      if (state.endless) state.endless = state.act - Run.ACTS.length + 1;   // 1 = 刚进无尽；2 = 已经额外打穿一个区域……
      else if (state.act >= Run.ACTS.length) { Run.finish(state, true); return; }
      state.layers = Run.genLayers(state);
    }
  };

  /** 这局远征的分数：历史记录和每日挑战比的就是它。打得深、打得多、带得多都加分 */
  Run.score = function (state) {
    var won = state.won ? 1 : 0;
    return state.battles * 100 + state.bosses * 500 + won * 1500 + won * state.asc * 300 +
      state.relics.length * 25 + Math.floor(state.gold / 2);
  };

  /**
   * 远征结束（赢或输）：结算勋章、历史、成就，写进局外存档。
   * 通关后进了无尽模式的那一局会结算两次——通关一次，倒在无尽里又一次：
   * 第二次只补发多出来的勋章，历史里改的也是同一条，仍然算「通关」。
   */
  Run.finish = function (state, won) {
    if (state.over) return;
    if (state.endless) won = true;                    // 无尽里倒下不算失败：已经通关了
    state.over = true; state.won = won; state.pending = null;
    var meta = Run.loadMeta();
    var total = state.battles + state.bosses * 3 + (won ? 10 + state.asc * 2 : 0);
    state.earned = total - (state.paid || 0);
    state.paid = total;
    meta.medals += state.earned;
    meta.sinceBackup++;
    meta.best = Math.max(meta.best, state.battles);
    var first = !state.histId;                        // 这一局第一次结算
    if (first) {
      meta.runs++;
      if (won) {
        meta.wins++;
        if (state.asc >= meta.asc && meta.asc < Run.MAX_ASC) meta.asc = state.asc + 1;
        if (meta.wonWith.indexOf(state.vehicleId) < 0) meta.wonWith.push(state.vehicleId);
      }
    }
    var depth = Math.max(0, (state.endless || 0) - 1);            // 无尽里额外打穿了几个区域
    meta.endlessBest = Math.max(meta.endlessBest, depth);
    state.score = Run.score(state);
    // 每日挑战：同一天可以反复打，记最好的一次
    if (state.daily) {
      if (!meta.daily || meta.daily.date !== state.daily) meta.daily = { date: state.daily, best: 0, tries: 0, won: false };
      if (first) meta.daily.tries++;
      meta.daily.best = Math.max(meta.daily.best, state.score);
      if (won && !meta.daily.won) { meta.daily.won = true; meta.dailyWins++; }
    }
    // 历史
    state.histId = state.histId || (Date.now() + '-' + ((Math.random() * 1e6) | 0));
    var rec = {
      id: state.histId, t: Date.now(), vid: state.vehicleId, won: won, act: state.act, step: state.step, asc: state.asc,
      battles: state.battles, bosses: state.bosses, relics: state.relics.slice(), seed: state.seed || '', daily: state.daily || null,
      hardcore: !!state.hardcore, endless: depth, score: state.score
    };
    var k = -1;
    for (var i = 0; i < meta.history.length; i++) if (meta.history[i].id === rec.id) k = i;
    if (k >= 0) meta.history[k] = rec; else meta.history.unshift(rec);
    meta.history = meta.history.slice(0, Run.HISTORY_MAX);
    noteSeen(meta, state);
    state.endAch = Run.checkAch(meta, state, { end: true });
    state.earned += state.achMedals || 0;             // 这一局里达成的成就给的勋章（已经发过了，这里只是一起显示）
    Run.saveMeta(meta);
    Run.clear(state);
  };

  /** 通关之后接着打：三个区域轮着来，敌人一路变强，直到倒下。只有刚通关的那一局能进 */
  Run.canEndless = function (state) { return !!state && state.over && state.won && !state.endless; };
  Run.goEndless = function (state) {
    if (!Run.canEndless(state)) return false;
    state.over = false;
    state.endless = 1;
    state.endAch = null; state.achMedals = 0;
    state.act = Run.ACTS.length; state.step = 0; state.node = null; state.pending = null;
    state.hp = Run.maxHp(state);
    state.layers = Run.genLayers(state);
    Run.save(state);
    return true;
  };

  // ================= 图鉴 =================
  /** 把这一局见过的东西并进局外存档：拿到过的遗物、装过的改造、打过的特殊敌人和词条 */
  function noteSeen(meta, state) {
    var add = function (arr, id) { if (id && arr.indexOf(id) < 0) arr.push(id); };
    state.relics.concat(state.everRelics || []).forEach(function (id) { if (Run.relicById(id)) add(meta.seen.relics, id); });
    ['w1', 'w2', 'ss'].forEach(function (slot) { state.mods[slot].forEach(function (id) { if (Run.modById(id)) add(meta.seen.mods, id); }); });
    var node = state.node;
    if (node && node.enemies) {
      node.enemies.forEach(function (e) { add(meta.seen.foes, e.boss ? 'boss:' + e.kit : e.kind ? 'kind:' + e.kind : null); });
      (node.mods || []).forEach(function (id) { add(meta.seen.mapMods, id); });
    }
  }
  Run.noteSeen = noteSeen;

  // ================= 成就 =================
  // test(meta, state, ctx)：ctx.game / ctx.node 只在刚打完一场时有，ctx.end 只在远征结束时为真。
  // 达成一次就永久记在 meta.ach 里，各给几枚勋章——勋章是解锁战车用的，所以成就也是一条攒车的路。
  function won(c, s) { return c.end && s.won; }
  function tag(c, k) { return !!(c.game && c.game.style && c.game.style.tags && c.game.style.tags[k]); }
  Run.ACHIEVEMENTS = [
    { id: 'first', name: '初战告捷', desc: '打赢第一场远征战斗。', medals: 1, test: function (m, s, c) { return !!c.game; } },
    { id: 'ringout', name: '一脚踢出界', desc: '把敌人打下地图。', medals: 1, test: function (m, s, c) { return tag(c, 'ringout'); } },
    { id: 'barrel', name: '借桶杀人', desc: '用油桶炸死敌人。', medals: 1, test: function (m, s, c) { return tag(c, 'barrel'); } },
    { id: 'multi', name: '一炮双响', desc: '一发炮弹同时炸到两个敌人。', medals: 1, test: function (m, s, c) { return tag(c, 'multi'); } },
    { id: 'flawless', name: '毫发无伤', desc: '打赢一场战斗，耐久一点没掉。', medals: 2, test: function (m, s, c) { return !!c.game && c.hpAfter >= c.hpBefore; } },
    { id: 'quick', name: '速战速决', desc: '两轮之内打赢一场战斗。', medals: 2, test: function (m, s, c) { return !!c.game && c.game.round <= 2; } },
    { id: 'night', name: '夜猫子', desc: '打赢一场夜战。', medals: 1, test: function (m, s, c) { return !!c.node && (c.node.mods || []).indexOf('night') >= 0; } },
    { id: 'meteor', name: '流星之下', desc: '打赢一场陨石雨。', medals: 1, test: function (m, s, c) { return !!c.node && (c.node.mods || []).indexOf('meteor') >= 0; } },
    { id: 'trial', name: '分秒必争', desc: '在限时挑战里按时全歼敌人。', medals: 2, test: function (m, s, c) { return !!c.node && c.node.type === 'trial'; } },
    { id: 'boss1', name: '碾碎碾压者', desc: '击破第一个区域的 Boss。', medals: 2, test: function (m, s) { return s.bosses >= 1; } },
    { id: 'boss2', name: '风暴止息', desc: '击破第二个区域的 Boss。', medals: 3, test: function (m, s) { return s.bosses >= 2; } },
    { id: 'win', name: '远征通关', desc: '打穿三个区域。', medals: 5, test: function (m, s, c) { return won(c, s); } },
    { id: 'asc3', name: '越战越勇', desc: '在进阶 3 或更高的难度通关。', medals: 5, test: function (m, s, c) { return won(c, s) && s.asc >= 3; } },
    { id: 'asc5', name: '登峰造极', desc: '在进阶 5 通关。', medals: 8, test: function (m, s, c) { return won(c, s) && s.asc >= 5; } },
    { id: 'hardcore', name: '盲打高手', desc: '开着硬核规则通关（没有弹道预览和出手顺序）。', medals: 5, test: function (m, s, c) { return won(c, s) && s.hardcore; } },
    { id: 'garage', name: '车库主人', desc: '用五辆不同的战车通关。', medals: 8, test: function (m) { return m.wonWith.length >= 5; } },
    { id: 'syn3', name: '环环相扣', desc: '同时凑成三个联动。', medals: 3, test: function (m, s) { return Run.activeSynergies(s).length >= 3; } },
    { id: 'curse', name: '与魔共舞', desc: '背着两件诅咒遗物击破一个 Boss。', medals: 3,
      test: function (m, s, c) { return !!c.node && c.node.type === 'boss' && curses(s).length >= 2; } },
    { id: 'mods5', name: '改到认不出', desc: '给同一把武器装上五个改造。', medals: 2,
      test: function (m, s) { return Math.max(s.mods.w1.length, s.mods.w2.length, s.mods.ss.length) >= 5; } },
    { id: 'relic12', name: '收藏家', desc: '一局里同时带着十二件遗物。', medals: 3, test: function (m, s) { return s.relics.length >= 12; } },
    { id: 'rich', name: '腰缠万贯', desc: '手里攒到 400 金币。', medals: 2, test: function (m, s) { return s.gold >= 400; } },
    { id: 'daily', name: '今日事今日毕', desc: '通关一次每日挑战。', medals: 5, test: function (m, s, c) { return won(c, s) && !!s.daily; } },
    { id: 'endless1', name: '意犹未尽', desc: '在无尽模式里再打穿一个区域。', medals: 5, test: function (m, s) { return (s.endless || 0) >= 2; } },
    { id: 'endless3', name: '永不熄火', desc: '在无尽模式里再打穿三个区域。', medals: 10, test: function (m, s) { return (s.endless || 0) >= 4; } },
    { id: 'codex', name: '见多识广', desc: '图鉴里的遗物全部见过。', medals: 5, test: function (m) { return m.seen.relics.length >= Run.RELICS.length; } }
  ];
  Run.achById = function (id) { return byId(Run.ACHIEVEMENTS, id); };
  /** 查一遍成就。新达成的记进 meta（勋章当场发），返回它们的 id。调用的人负责 saveMeta */
  Run.checkAch = function (meta, state, ctx) {
    var got = [];
    Run.ACHIEVEMENTS.forEach(function (a) {
      if (meta.ach[a.id]) return;
      var ok = false;
      try { ok = !!a.test(meta, state, ctx || {}); } catch (e) { ok = false; }
      if (!ok) return;
      meta.ach[a.id] = Date.now();
      meta.medals += a.medals;
      state.achMedals = (state.achMedals || 0) + a.medals;
      got.push(a.id);
    });
    return got;
  };

  // ================= 商店 =================
  var ITEM_PRICE = { double: 28, power: 26, fly: 22, stun: 22, heal1: 24, heal2: 40, fuel1: 16, fuel2: 26, stealth: 24 };

  Run.genStock = function (state) {
    var owned = state.relics, stock = [];
    var pool = Run.RELICS.filter(function (r) { return (r.rarity === 'common' || r.rarity === 'rare') && owned.indexOf(r.id) < 0; });
    var relics = [];
    for (var i = 0; i < 3 && pool.length; i++) {                   // 能凑联动的更容易上架
      var r = pickWeighted(state, pool);
      relics.push(r); pool.splice(pool.indexOf(r), 1);
    }
    relics.forEach(function (r) { stock.push({ type: 'relic', id: r.id, cost: r.rarity === 'rare' ? 120 : 70 }); });
    sample(modPool(false), 1).concat(sample(modPool(true), 1)).forEach(function (m) {
      stock.push({ type: 'mod', id: m.id, cost: m.rare ? 95 : 55 });
    });
    sample(RZ.ITEMS, 3).forEach(function (it) { stock.push({ type: 'item', id: it.id, cost: ITEM_PRICE[it.id] || 25 }); });
    // 黑市角落：一件诅咒遗物，便宜，好处大，代价一直跟着你
    var cursed = relicPool(state, 'curse');
    if (cursed.length) stock.push({ type: 'relic', id: pick(cursed).id, cost: 45, black: true });
    stock.push({ type: 'repair', id: 'repair', cost: 40 });
    return stock;
  };

  /** 刷新货架：已经买走的也换掉。每家店第一次 15 金币，之后每次再贵 10 */
  Run.rerollCost = function (state) {
    var p = state.pending;
    return p && p.kind === 'shop' ? 15 + 10 * (p.rerolls || 0) : 0;
  };
  Run.reroll = function (state) {
    var p = state.pending;
    if (!p || p.kind !== 'shop') return false;
    var cost = Run.rerollCost(state);
    if (state.gold < cost) return false;
    state.gold -= cost;
    p.rerolls = (p.rerolls || 0) + 1;
    p.stock = Run.genStock(state);
    return true;
  };

  Run.buy = function (state, index, slot) {
    var p = state.pending;
    if (!p || p.kind !== 'shop') return false;
    var it = p.stock[index];
    if (!it || it.sold || state.gold < it.cost) return false;
    if (it.type === 'relic') grantRelic(state, it.id);
    else if (it.type === 'mod') { if (!state.mods[slot]) return false; state.mods[slot].push(it.id); }
    else if (it.type === 'item') { if (!grantItem(state, it.id)) return false; }
    else if (it.type === 'repair') {
      if (state.hp >= Run.maxHp(state)) return false;
      state.hp += Run.maxHp(state) * 0.3; clampHp(state);
    }
    state.gold -= it.cost;
    if (it.type !== 'repair') it.sold = true;
    return true;
  };

  // ================= 修整 =================
  Run.REST = [
    { id: 'repair', name: '全面检修', desc: '恢复 40% 耐久。' },
    { id: 'forge', name: '加固底盘', desc: '最大耐久永久 +90（并补上这 90）。' },
    { id: 'supply', name: '整备弹药', desc: '获得两件随机道具，外加 25 金币。' }
  ];
  /** 手里有诅咒遗物时，修整多一个「净化」选项 */
  Run.restOptions = function (state) {
    var list = Run.REST.slice(), c = curses(state);
    if (c.length) list.push({ id: 'purify', name: '净化', desc: '拆掉「' + Run.relicById(c[c.length - 1]).name + '」，连同它的好处和代价一起。' });
    return list;
  };

  Run.rest = function (state, id) {
    var p = state.pending;
    if (!p || p.kind !== 'rest') return false;
    if (id === 'purify') {
      var c = curses(state);
      if (!c.length) return false;
      dropRelic(state, c[c.length - 1]);
    }
    else if (id === 'repair') { state.hp += Run.maxHp(state) * 0.4; }
    else if (id === 'forge') { state.hpBonus += 90; state.hp += 90; }
    else if (id === 'supply') { grantItem(state, pick(RZ.ITEMS).id); grantItem(state, pick(RZ.ITEMS).id); state.gold += 25; }
    else return false;
    clampHp(state);
    state.pending = null;
    Run.advance(state);
    return true;
  };

  // ================= 事件 =================
  // run(state) 返回一句结果给界面显示；返回 { fight: 'fight' | 'elite', text } 表示要打一场（打完照常领奖励）。
  // need(state) 返回 false 时这个选项灰掉，界面上照样显示，玩家知道「差点什么」。
  function slotName(slot) { return slot === 'w1' ? '一号武器' : slot === 'w2' ? '二号武器' : '必杀'; }
  function loseMax(s, f) { var n = Math.round(Run.maxHp(s) * f); s.hp = Math.max(1, s.hp - n); return n; }
  function gainMax(s, f) { s.hp += Run.maxHp(s) * f; clampHp(s); }
  function randomItems(s, n) {
    var got = [];
    for (var i = 0; i < n; i++) { var it = pick(RZ.ITEMS); if (grantItem(s, it.id)) got.push(it.name); }
    return got;
  }
  function randomRelic(s, rarity) {
    var p = relicPool(s, rarity);
    if (!p.length) return null;
    var r = rarity === 'curse' ? pick(p) : pickWeighted(s, p);
    grantRelic(s, r.id);
    return r;
  }
  function anyMods(s) { return s.mods.w1.length + s.mods.w2.length + s.mods.ss.length > 0; }

  Run.EVENTS = [
    { id: 'depot', title: '废弃补给站', text: '沙尘里露出半截集装箱，锁早就锈穿了。',
      options: [
        { label: '搬走值钱的', desc: '+60 金币', run: function (s) { s.gold += 60; return '你拆下一堆还能卖的零件。金币 +60。'; } },
        { label: '翻找弹药', desc: '两件随机道具', run: function (s) {
          var got = randomItems(s, 2);
          return got.length ? '找到了：' + got.join('、') + '。' : '道具栏已经满了，只能空手离开。';
        } }
      ] },
    { id: 'tuner', title: '黑市改装师', text: '「好东西有，就是装的时候得拆你几块装甲。」',
      options: [
        { label: '成交', desc: '失去 25% 当前耐久，获得一件稀有遗物', run: function (s) {
          if (!relicPool(s, 'rare').length) { s.gold += 80; return '他翻遍了仓库也没有你没见过的货，赔了你 80 金币。'; }
          s.hp = Math.max(1, Math.round(s.hp * 0.75));
          var r = randomRelic(s, 'rare');
          return '装甲被拆走一截，换来了「' + r.name + '」：' + r.desc;
        } },
        { label: '算了', desc: '什么都不发生', run: function () { return '你摆摆手，把车开走了。'; } }
      ] },
    { id: 'chip', title: '来历不明的芯片', text: '路边残骸的火控电脑还亮着，里面有一份改造图纸。',
      options: [
        { label: '直接刷进火控', desc: '随机一把武器获得随机改造', run: function (s) {
          var slot = pick(['w1', 'w2', 'ss']), m = pick(modPool(false));
          s.mods[slot].push(m.id);
          return slotName(slot) + '装上了「' + m.name + '」。';
        } },
        { label: '拆了当备件', desc: '恢复 25% 耐久', run: function (s) { gainMax(s, 0.25); return '用拆下来的零件补了补车体。'; } }
      ] },
    { id: 'gamble', title: '废土赌局', text: '几个拾荒者围着一箱金币：「猜对了全归你，猜错了挨我们一炮。」',
      options: [
        { label: '赌一把', desc: '一半概率 +110 金币，一半概率失去 15% 耐久', run: function (s) {
          if (rand() < 0.5) { s.gold += 110; return '你赢了！金币 +110。'; }
          loseMax(s, 0.15);
          return '猜错了。一发冷炮砸在车顶上。';
        } },
        { label: '不赌', desc: '什么都不发生', run: function () { return '你没理他们。'; } }
      ] },
    { id: 'shrine', title: '锈蚀神龛', text: '沙地中央立着一座焊满弹壳的神龛，供桌上摆着一件还在发烫的零件。',
      options: [
        { label: '拿走供品', desc: '获得一件诅咒遗物，外加 60 金币', run: function (s) {
          s.gold += 60;
          var r = randomRelic(s, 'curse');
          return r ? '零件烫得你龇牙咧嘴。「' + r.name + '」：' + r.desc : '供桌上的东西你都有了。顺走了 60 金币的香火钱。';
        } },
        { label: '拜一拜就走', desc: '恢复 10% 耐久', run: function (s) { gainMax(s, 0.1); return '不知道是不是心理作用，车好像顺了一点。'; } }
      ] },
    { id: 'ambush', title: '沙丘伏击', text: '侦察无人机传回画面：前面那道沙丘后面，趴着一辆改装过的精英战车。',
      options: [
        { label: '迎战', desc: '打一场精英战，赢了照常拿精英奖励', run: function () { return { fight: 'elite', text: '你按下了战斗警报。' }; } },
        { label: '绕远路', desc: '失去 12% 耐久', run: function (s) { loseMax(s, 0.12); return '绕了一大圈，被流弹蹭掉一层漆。'; } }
      ] },
    { id: 'convoy', title: '军火车队', text: '一列军火车队停在路边加油，押车的人朝你招手：「要货吗？」',
      options: [
        { label: '买一件遗物', desc: '60 金币，随机一件普通遗物', need: function (s) { return s.gold >= 60 && relicPool(s, 'common').length > 0; },
          run: function (s) { s.gold -= 60; var r = randomRelic(s, 'common'); return '成交。「' + r.name + '」：' + r.desc; } },
        { label: '拿装甲换稀有改造', desc: '失去 20% 当前耐久，一号或二号武器随机装上一件稀有改造', run: function (s) {
          s.hp = Math.max(1, Math.round(s.hp * 0.8));
          var slot = pick(['w1', 'w2']), m = pick(modPool(true));
          s.mods[slot].push(m.id);
          return '他们拆走一块装甲，给' + slotName(slot) + '装上了「' + m.name + '」。';
        } },
        { label: '不要', desc: '什么都不发生', run: function () { return '车队轰隆隆地开走了。'; } }
      ] },
    { id: 'oilfire', title: '油田大火', text: '一整片油井烧成了火海，火光里隐约能看见几个没烧到的补给箱。',
      options: [
        { label: '冲进去抢', desc: '失去 15% 耐久，得两件道具和 40 金币', run: function (s) {
          loseMax(s, 0.15); s.gold += 40;
          var got = randomItems(s, 2);
          return '车壳烤得发红，抢出来 40 金币' + (got.length ? '和' + got.join('、') : '（道具栏满了，别的没带走）') + '。';
        } },
        { label: '绕开', desc: '什么都不发生', run: function () { return '你远远地看了一会儿火。'; } }
      ] },
    { id: 'graveyard', title: '战车坟场', text: '一片烧焦的残骸，有几辆的火控还在一闪一闪。',
      options: [
        { label: '致敬', desc: '恢复 20% 耐久', run: function (s) { gainMax(s, 0.2); return '你在坟场边停了一会儿，顺手捡了些还能用的装甲片。'; } },
        { label: '翻找', desc: '一半概率稀有遗物，一半概率诅咒遗物', run: function (s) {
          var good = rand() < 0.5, r = randomRelic(s, good ? 'rare' : 'curse');
          if (!r) { s.gold += 50; return '翻来翻去只找到 50 金币的废铁。'; }
          return (good ? '运气不错。' : '这东西不太干净……') + '「' + r.name + '」：' + r.desc;
        } }
      ] },
    { id: 'foundry', title: '废弃熔炉', text: '炉膛还热着，可以熔掉点东西换钱，也能顺手补补车。',
      options: [
        { label: '熔掉最新的遗物', desc: '+130 金币（诅咒遗物也熔得掉）', need: function (s) { return s.relics.length > 0; }, run: function (s) {
          var id = s.relics[s.relics.length - 1], r = Run.relicById(id);
          dropRelic(s, id); s.gold += 130;
          return '「' + r.name + '」化成了一摊铁水。金币 +130。';
        } },
        { label: '修车', desc: '35 金币，恢复 45% 耐久', need: function (s) { return s.gold >= 35; }, run: function (s) {
          s.gold -= 35; gainMax(s, 0.45); return '借炉子把车体重新焊了一遍。';
        } },
        { label: '离开', desc: '什么都不发生', run: function () { return '炉火映着你开远的车。'; } }
      ] },
    { id: 'storm', title: '雷暴', text: '天边压过来一团铁灰色的云，电流在车身上噼啪作响。',
      options: [
        { label: '竖起天线', desc: '必杀装上「引雷针」', run: function (s) { s.mods.ss.push('thunder'); return '一道雷劈在天线上，必杀的火控从此带电。'; } },
        { label: '躲进峡谷', desc: '恢复 10% 耐久，得一件道具', run: function (s) {
          gainMax(s, 0.1); var got = randomItems(s, 1);
          return '在峡谷里等雷暴过去' + (got.length ? '，还捡到一件' + got[0] : '') + '。';
        } }
      ] },
    { id: 'bounty', title: '赏金公告', text: '加油站门口贴着一张通缉令，上面那辆车就在附近出没。',
      options: [
        { label: '接单', desc: '下一场战斗的金币翻倍', run: function (s) { s.nextGoldMul = 2; return '你把通缉令折好塞进了口袋。下一场的金币翻倍。'; } },
        { label: '不接', desc: '什么都不发生', run: function () { return '跟你没关系。'; } }
      ] },
    { id: 'mirror', title: '镜面盐湖', text: '盐湖平得像一面镜子，车的倒影一清二楚——连火控里的改装都看得见。',
      options: [
        { label: '照着倒影复刻', desc: '把一件已装的改造复制到另一把随机武器上', need: anyMods, run: function (s) {
          var have = [];
          ['w1', 'w2', 'ss'].forEach(function (k) { s.mods[k].forEach(function (m) { have.push({ slot: k, id: m }); }); });
          var src = pick(have), to = pick(['w1', 'w2', 'ss'].filter(function (k) { return k !== src.slot; }));
          s.mods[to].push(src.id);
          return slotName(to) + '也装上了「' + Run.modById(src.id).name + '」。';
        } },
        { label: '喝口凉水', desc: '恢复 15% 耐久', run: function (s) { gainMax(s, 0.15); return '盐湖边的泉水居然是甜的。'; } }
      ] },
    { id: 'kid', title: '拾荒小孩', text: '一个小孩拦住车，手里攥着一块亮晶晶的零件：「三十块，不贵。」',
      options: [
        { label: '买下', desc: '30 金币，下一次战后奖励多一个选项', need: function (s) { return s.gold >= 30; }, run: function (s) {
          s.gold -= 30; s.luck = (s.luck || 0) + 1; return '零件是个幸运符。下一次战后奖励多一个选项。';
        } },
        { label: '摆摆手', desc: '什么都不发生', run: function () { return '小孩朝你做了个鬼脸。'; } }
      ] },
    { id: 'minefield', title: '雷区', text: '前面的路上插满了褪色的骷髅牌。',
      options: [
        { label: '小心开过去', desc: '失去 8% 耐久', run: function (s) { loseMax(s, 0.08); return '还是踩响了一颗。'; } },
        { label: '扔道具引爆', desc: '用掉一件道具，捡回 55 金币的废铁', need: function (s) { return s.items.length > 0; }, run: function (s) {
          var it = RZ.itemById(s.items.pop()); s.gold += 55;
          return '扔出去的「' + it.name + '」炸响了一串地雷，满地都是能卖钱的弹片。';
        } }
      ] },
    { id: 'range', title: '野外靶场', text: '一座废弃的军用靶场，靶子还立着，弹药箱里还有货。',
      options: [
        { label: '练一下午', desc: '40 金币，攻击永久 +6%', need: function (s) { return s.gold >= 40; }, run: function (s) {
          s.gold -= 40; s.atkBonus = (s.atkBonus || 0) + 0.06; return '打空了三箱弹药，手感回来了。攻击永久 +6%。';
        } },
        { label: '拆靶子当装甲', desc: '最大耐久永久 +60', run: function (s) { s.hpBonus += 60; s.hp += 60; clampHp(s); return '焊了一圈靶板在车身上。最大耐久 +60。'; } }
      ] },
    { id: 'trader', title: '流浪商人', text: '一个背着大包的商人围着你的车转了三圈：「你那件我看上了，换我这件？」',
      options: [
        { label: '换', desc: '最早拿到的一件普通 / 稀有遗物，换一件同稀有度的随机遗物', need: function (s) {
          return s.relics.some(function (id) { var r = Run.relicById(id); return r.rarity === 'common' || r.rarity === 'rare'; });
        }, run: function (s) {
          var id = s.relics.filter(function (x) { var r = Run.relicById(x); return r.rarity === 'common' || r.rarity === 'rare'; })[0];
          var old = Run.relicById(id), p = relicPool(s, old.rarity);
          if (!p.length) return '他翻了翻包：「算了，我这儿的你都有。」';
          dropRelic(s, id);
          var r = pickWeighted(s, p); grantRelic(s, r.id);
          return '「' + old.name + '」换成了「' + r.name + '」：' + r.desc;
        } },
        { label: '不换', desc: '什么都不发生', run: function () { return '「再考虑考虑嘛。」'; } }
      ] },
    { id: 'blood', title: '黑市加油站', text: '「抽一点你车里的冷却液，换一箱高标号燃料。不会出事的，大概。」',
      options: [
        { label: '成交', desc: '失去 12% 耐久，之后每场开局燃料 +30', run: function (s) {
          loseMax(s, 0.12); s.fuelBonus = (s.fuelBonus || 0) + 30; return '发动机咳了两声，然后转得比以前还欢。之后每场开局燃料 +30。';
        } },
        { label: '不了', desc: '什么都不发生', run: function () { return '你看了一眼那根脏兮兮的管子，走了。'; } }
      ] },
    { id: 'spring', title: '清泉', text: '一眼冒着气泡的泉水，据说能洗掉不干净的东西。',
      options: [
        { label: '净化', desc: '拆掉一件诅咒遗物（最新的那件）', need: function (s) { return curses(s).length > 0; }, run: function (s) {
          var c = curses(s), r = Run.relicById(c[c.length - 1]);
          dropRelic(s, r.id);
          return '「' + r.name + '」沉进了泉底。';
        } },
        { label: '洗洗车', desc: '恢复 20% 耐久', run: function (s) { gainMax(s, 0.2); return '车洗干净了，连锈都少了几块。'; } }
      ] },
    { id: 'twins', title: '成对的箱子', text: '两只一模一样的箱子，标签上写着「配套出售」。',
      options: [
        { label: '买一对', desc: '50 金币：能和你手里某件凑成联动的遗物；凑不成就是随机普通遗物', need: function (s) { return s.gold >= 50; }, run: function (s) {
          s.gold -= 50;
          var want = [];
          s.relics.forEach(function (id) {
            Run.synergiesOf(id).forEach(function (x) { if (s.relics.indexOf(x.partner) < 0) want.push(x.partner); });
          });
          var r = want.length ? Run.relicById(pick(want)) : null;
          if (r) { grantRelic(s, r.id); return '正好配上。「' + r.name + '」：' + r.desc; }
          r = randomRelic(s, 'common');
          if (r) return '配不上你手里的东西，不过也不赖。「' + r.name + '」：' + r.desc;
          s.gold += 50;
          return '箱子是空的。商人退了你 50 金币。';
        } },
        { label: '只拆一只卖掉', desc: '+35 金币', run: function (s) { s.gold += 35; return '拆开一看是一堆螺丝，卖了 35 金币。'; } }
      ] },
    { id: 'wreck', title: '坠毁的运输机', text: '一架运输机栽在沙里，货舱门半开着。',
      options: [
        { label: '搜货舱', desc: '随机一把武器获得随机改造', run: function (s) {
          var slot = pick(['w1', 'w2', 'ss']), m = pick(modPool(false));
          s.mods[slot].push(m.id);
          return '货舱里有一套改装件。' + slotName(slot) + '装上了「' + m.name + '」。';
        } },
        { label: '拆发动机', desc: '得到「涡轮增压器」（已有就换 60 金币）', run: function (s) {
          if (s.relics.indexOf('turbo') >= 0) { s.gold += 60; return '这台发动机你车上已经有一样的了，拆下来卖了 60 金币。'; }
          grantRelic(s, 'turbo'); return '装上了运输机的涡轮。每回合多回 8 点燃料。';
        } }
      ] }
  ];
  // 不进随机池的事件：只从专门的节点来
  Run.SPECIAL_EVENTS = [
    { id: 'altar', title: '诅咒祭坛', text: '黑铁垒成的祭坛上刻满了弹痕。它什么都肯给——只要你也肯给它点什么。',
      options: [
        { label: '献上装甲', desc: '最大耐久永久 -80，获得一件稀有遗物', need: function (s) { return relicPool(s, 'rare').length > 0 && Run.maxHp(s) > 300; },
          run: function (s) {
            s.hpBonus -= 80; clampHp(s);
            var r = randomRelic(s, 'rare');
            return '祭坛吞掉了一整块装甲板，吐出「' + r.name + '」：' + r.desc;
          } },
        { label: '接受诅咒', desc: '获得一件诅咒遗物；一号或二号武器装上一件稀有改造，外加 50 金币', need: function (s) { return relicPool(s, 'curse').length > 0; },
          run: function (s) {
            var r = randomRelic(s, 'curse'), slot = pick(['w1', 'w2']), m = pick(modPool(true));
            s.mods[slot].push(m.id); s.gold += 50;
            return '你背上了「' + r.name + '」（' + r.desc + '）。作为交换，' + slotName(slot) + '装上了「' + m.name + '」，还有 50 金币。';
          } },
        { label: '净化', desc: '拆掉一件诅咒遗物（最新的那件），并恢复 15% 耐久', need: function (s) { return curses(s).length > 0; },
          run: function (s) {
            var c = curses(s), r = Run.relicById(c[c.length - 1]);
            dropRelic(s, r.id); gainMax(s, 0.15);
            return '「' + r.name + '」在祭坛上化成了灰。';
          } },
        { label: '转身离开', desc: '什么都不发生', run: function () { return '你没有回头。'; } }
      ] }
  ];
  Run.eventById = function (id) { return byId(Run.EVENTS, id) || byId(Run.SPECIAL_EVENTS, id); };

  /** 抽一个这局还没见过的事件；都见过了就从头再来 */
  function pickEvent(state) {
    var seen = state.seenEvents || (state.seenEvents = []);
    var left = Run.EVENTS.filter(function (e) { return seen.indexOf(e.id) < 0; });
    if (!left.length) { seen.length = 0; left = Run.EVENTS.slice(); }
    var ev = pick(left);
    seen.push(ev.id);
    return ev.id;
  }

  /** 这个选项现在能不能选 */
  Run.canChoose = function (state, opt) { return !opt.need || !!opt.need(state); };

  /**
   * 选了事件的某个选项。返回 'fight' 表示要打一场（state.node 已经换成战斗节点），
   * 返回 true 表示有结果文字要看，false 表示没选成。
   */
  Run.eventChoose = function (state, optIndex) {
    var p = state.pending;
    if (!p || p.kind !== 'event') return false;
    var ev = Run.eventById(p.id), opt = ev && ev.options[optIndex];
    if (!opt || !Run.canChoose(state, opt)) return false;
    var res = opt.run(state);
    clampHp(state);
    if (res && res.fight) {
      state.node = fightNode(state, state.step, res.fight);
      state.node.fromEvent = ev.id;
      state.pending = null;
      return 'fight';
    }
    state.pending = { kind: 'note', title: ev.title, text: res };
    return true;
  };

  /** 离开商店 / 看完事件结果 */
  Run.leave = function (state) {
    var p = state.pending;
    if (!p || (p.kind !== 'shop' && p.kind !== 'note')) return false;
    state.pending = null;
    Run.advance(state);
    return true;
  };

  // 会掷骰子的入口都包进「种子 + 这是哪一步」的随机源里（见文件开头的 seeded()）。
  // tag 在调用前按当时的 state 算好；同一步里重复掷（刷新货架）要把次数算进 tag。
  function wrapSeed(name, tagOf) {
    var fn = Run[name];
    Run[name] = function (state) {
      var args = arguments;
      return seeded(state, tagOf.apply(null, args), function () { return fn.apply(Run, args); });
    };
  }
  wrapSeed('enter', function (s, i) { return 'N' + at(s) + '.' + i; });
  wrapSeed('afterBattle', function (s) { return 'B' + at(s) + (s.node && s.node.fromEvent ? '.e' : ''); });
  wrapSeed('reroll', function (s) { return 'S' + at(s) + '.' + (((s.pending && s.pending.rerolls) || 0) + 1); });
  wrapSeed('eventChoose', function (s, i) { return 'E' + at(s) + '.' + i; });
  wrapSeed('rest', function (s, id) { return 'R' + at(s) + '.' + id; });

  RZ.Run = Run;
})(window.RZ || (window.RZ = {}));

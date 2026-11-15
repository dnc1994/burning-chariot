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
  Run.setRandom = function (fn) { rand = fn || Math.random; };

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
      apply: function (w) { w.kb = (w.kb || 1) + 0.8; } }
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
      gain: function (s) { s.hpBonus += 300; s.hp = 99999; } }
  ];
  Run.relicById = function (id) { return byId(Run.RELICS, id); };

  /** 把手里所有遗物的 perks 加起来 */
  Run.perks = function (state) {
    var out = {};
    for (var i = 0; i < state.relics.length; i++) {
      var r = Run.relicById(state.relics[i]);
      if (!r || !r.perks) continue;
      for (var k in r.perks) out[k] = (out[k] || 0) + r.perks[k];
    }
    return out;
  };

  // ================= 三个区域 =================
  // Boss 都带磁力底盘（anchor）：不然在浮岛图上一炮掀下去就没了，太便宜。
  Run.ACTS = [
    {
      name: '锈蚀前线', maps: ['dry', 'canyon'],
      boss: { vid: 'aodin', name: '碾压者', kit: 'crusher', hp: 1080, atk: 82, scale: 1.5, map: 'canyon',
              mods: { w1: ['cluster'], w2: ['blast'] }, perks: { anchor: 1, armor: 0.1 }, escorts: 0 }
    },
    {
      name: '风暴航道', maps: ['sky', 'sea'],
      boss: { vid: 'xuanfeng', name: '风暴女王', kit: 'queen', hp: 1150, atk: 84, scale: 1.45, map: 'sky',
              mods: { w1: ['apex', 'thunder'], w2: ['split'] }, perks: { anchor: 1 }, escorts: 1 }
    },
    {
      name: '星环终点', maps: ['star', 'canyon', 'sea'],
      boss: { vid: 'honglong', name: '终焉战车', kit: 'doom', hp: 1350, atk: 76, scale: 1.7, map: 'star',
              mods: { w1: ['burn', 'cluster'], w2: ['apex'] },
              perks: { anchor: 1, armor: 0.1 }, escorts: 2 }
    }
  ];
  Run.LAYERS_PER_ACT = 5;

  Run.STARTERS = ['liehuo', 'tiejingang', 'beibeilong'];   // 一开始就能用的三辆
  Run.UNLOCK_COST = 6;                                      // 其余每辆花 6 枚勋章
  Run.MAX_ASC = 5;

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

  Run.save = function (state) { storeSet('rz-run', JSON.stringify(state)); };
  /** 一份远征存档看起来是不是完整的（导入别处来的进度时用） */
  function validRun(r) {
    return !!r && r.v === 1 && !r.over && !!RZ.vehicleById(r.vehicleId) && RZ.vehicleById(r.vehicleId).id === r.vehicleId &&
      Array.isArray(r.layers) && r.layers.length > 0 && Array.isArray(r.relics) && !!r.mods && typeof r.hp === 'number';
  }
  Run.load = function () {
    try {
      var s = JSON.parse(storeGet('rz-run') || 'null');
      return s && s.v === 1 && !s.over ? s : null;
    } catch (e) { return null; }
  };
  Run.clear = function () { storeDel('rz-run'); };

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
      over: false, won: false
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
    v.w1 = Run.modWeapon(base.w1, state.mods.w1);
    v.w2 = Run.modWeapon(base.w2, state.mods.w2);
    v.ss = Run.modWeapon(base.ss, state.mods.ss);
    return v;
  };
  Run.maxHp = function (state) { return Run.playerVehicle(state).hp; };
  function clampHp(state) { state.hp = Math.max(1, Math.min(Run.maxHp(state), Math.round(state.hp))); }

  // ================= 路线 =================
  function depthOf(state, step) { return state.act * Run.LAYERS_PER_ACT + step; }

  function enemyDef(state, step, kind) {
    var d = depthOf(state, step), asc = state.asc;
    var pool = RZ.VEHICLES.filter(function (v) { return v.id !== state.vehicleId; });
    var v = pick(pool);
    var e = {
      vid: v.id, name: v.name,
      hpMul: (0.44 + 0.045 * d) * (1 + asc * 0.08),
      atkMul: (0.52 + 0.03 * d) * (1 + asc * 0.06),
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

  function fightNode(state, step, kind) {
    var act = Run.ACTS[state.act], d = depthOf(state, step);
    var node = { type: kind, mapId: pick(act.maps), enemies: [], gold: kind === 'elite' ? 70 + d * 4 : 32 + d * 3 };
    if (kind === 'fight' && d >= 2 && rand() < 0.45) {
      // 两辆小的：每辆更脆，但要挨两份炮
      for (var i = 0; i < 2; i++) {
        var e = enemyDef(state, step, 'fight');
        e.hpMul *= 0.6; e.atkMul *= 0.85;
        node.enemies.push(e);
      }
      node.gold += 10;
    } else {
      node.enemies.push(enemyDef(state, step, kind));
    }
    return node;
  }

  function bossNode(state) {
    var act = Run.ACTS[state.act], b = act.boss, asc = state.asc;
    var node = { type: 'boss', mapId: b.map, enemies: [], gold: 120 + state.act * 40 };
    node.enemies.push({
      vid: b.vid, name: b.name, boss: true, kit: b.kit, scale: b.scale,
      hp: Math.round(b.hp * (1 + asc * 0.08)), atk: Math.round(b.atk * (1 + asc * 0.05)),
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
    var L = [], other = function () { return { type: pick(['shop', 'rest', 'event', 'event']) }; };
    L.push([fightNode(state, 0, 'fight'), fightNode(state, 0, 'fight')]);
    L.push([fightNode(state, 1, 'fight'), other(), fightNode(state, 1, 'fight')]);
    L.push([fightNode(state, 2, 'elite'), { type: 'shop' }, { type: 'rest' }]);
    L.push([fightNode(state, 3, 'fight'), fightNode(state, 3, 'elite'), { type: rand() < 0.5 ? 'rest' : 'shop' }]);
    L.push([bossNode(state)]);
    return L;
  };

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
    return v;
  }

  /** 选一个节点：战斗类返回 true（界面该去开打了），其余的把 pending 填好 */
  Run.enter = function (state, index) {
    if (state.pending || state.over) return false;
    var node = Run.choices(state)[index];
    if (!node) return false;
    state.node = node;
    if (node.type === 'fight' || node.type === 'elite' || node.type === 'boss') return true;
    if (node.type === 'shop') state.pending = { kind: 'shop', stock: Run.genStock(state) };
    else if (node.type === 'rest') state.pending = { kind: 'rest' };
    else state.pending = { kind: 'event', id: pick(Run.EVENTS).id };
    return false;
  };

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
        vehicle: ev, team: 1, ai: true, name: e.name + (i && !e.boss && node.enemies[0].name === e.name ? '·2' : ''),
        items: [], perks: e.perks || {}, scale: e.scale || 1, boss: !!e.boss, kit: e.kit || null,
        aiLevel: node.type === 'boss' && !e.boss ? 'normal' : null      // Boss 的护卫打得没那么准，不然三门炮一起点名太狠
      });
    }
    return {
      mapId: node.mapId, roster: roster, arcade: true, hardcore: state.hardcore, guide: true,
      difficulty: AI_BY_ACT[Math.min(2, state.act + (state.asc >= 3 ? 1 : 0))],
      humanTeam: playerAI ? null : 0
    };
  };

  // ================= 战后 =================
  function rewardChoices(state, kind) {
    var owned = state.relics, out = [];
    var pool = function (rarity) {
      return Run.RELICS.filter(function (r) { return r.rarity === rarity && owned.indexOf(r.id) < 0; });
    };
    var relic = function (rarity) {
      var p = pool(rarity);
      if (!p.length) p = pool('common');
      var taken = out.map(function (c) { return c.id; });
      p = p.filter(function (r) { return taken.indexOf(r.id) < 0; });
      return p.length ? { type: 'relic', id: pick(p).id } : { type: 'mod', id: pick(Run.MODS).id };
    };
    var mod = function () {
      var taken = out.map(function (c) { return c.id; });
      var p = Run.MODS.filter(function (m) { return taken.indexOf(m.id) < 0; });
      return { type: 'mod', id: pick(p).id };
    };
    if (kind === 'boss') { out.push(relic('boss')); out.push(relic('rare')); out.push(relic('rare')); }
    else if (kind === 'elite') { out.push(relic('rare')); out.push(relic('rare')); out.push(mod()); }
    else {
      out.push(mod());
      out.push(relic(rand() < 0.18 ? 'rare' : 'common'));
      out.push(rand() < 0.5 ? mod() : relic('common'));
    }
    return out;
  }

  /**
   * 战斗打完，把结果写回 state。game 是打完的那局 RZ.Game。
   * 赢了：记血、记道具、发钱、摆出三选一；输了：远征结束，结算勋章。
   */
  Run.afterBattle = function (state, game) {
    var me = game.units[0], node = state.node;
    if (game.result !== 0 || !me.alive) { Run.finish(state, false); return; }
    var pk = Run.perks(state);
    state.items = me.items.slice(0, RZ.MAX_ITEMS);
    if (me.revived) {                                  // 应急核心是一次性的
      var k = state.relics.indexOf('revive');
      if (k >= 0) state.relics.splice(k, 1);
    }
    state.hp = me.hp + Run.maxHp(state) * 0.18;        // 战后简单抢修
    clampHp(state);
    var gold = Math.round((node.gold + game.style.gold) * (1 + (pk.gold || 0)));
    state.gold += gold;
    state.battles++;
    if (node.type === 'boss') {
      state.bosses++;
      state.hp = Run.maxHp(state);                    // 打完 Boss 彻底大修
      clampHp(state);
    }
    state.pending = { kind: 'reward', from: node.type, gold: gold, style: game.style.gold, choices: rewardChoices(state, node.type) };
  };

  function grantRelic(state, id) {
    var r = Run.relicById(id);
    if (!r || state.relics.indexOf(id) >= 0) return;
    state.relics.push(id);
    if (r.gain) r.gain(state);
    clampHp(state);
  }
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

  /** 往前走一层；走完一个区域换下一个，走完三个就通关 */
  Run.advance = function (state) {
    state.node = null;
    state.step++;
    if (state.step >= state.layers.length) {
      state.act++;
      state.step = 0;
      if (state.act >= Run.ACTS.length) { Run.finish(state, true); return; }
      state.layers = Run.genLayers(state);
    }
  };

  /** 远征结束（赢或输）：结算勋章，写进局外存档 */
  Run.finish = function (state, won) {
    if (state.over) return;
    state.over = true; state.won = won; state.pending = null;
    var meta = Run.loadMeta();
    state.earned = state.battles + state.bosses * 3 + (won ? 10 + state.asc * 2 : 0);
    meta.medals += state.earned;
    meta.runs++;
    meta.sinceBackup++;
    meta.best = Math.max(meta.best, state.battles);
    if (won) {
      meta.wins++;
      if (state.asc >= meta.asc && meta.asc < Run.MAX_ASC) meta.asc = state.asc + 1;
    }
    Run.saveMeta(meta);
    Run.clear();
  };

  // ================= 商店 =================
  var ITEM_PRICE = { double: 28, power: 26, fly: 22, stun: 22, heal1: 24, heal2: 40, fuel1: 16, fuel2: 26, stealth: 24 };

  Run.genStock = function (state) {
    var owned = state.relics, stock = [];
    var relics = sample(Run.RELICS.filter(function (r) { return r.rarity !== 'boss' && owned.indexOf(r.id) < 0; }), 3);
    relics.forEach(function (r) { stock.push({ type: 'relic', id: r.id, cost: r.rarity === 'rare' ? 120 : 70 }); });
    sample(Run.MODS, 2).forEach(function (m) { stock.push({ type: 'mod', id: m.id, cost: 55 }); });
    sample(RZ.ITEMS, 3).forEach(function (it) { stock.push({ type: 'item', id: it.id, cost: ITEM_PRICE[it.id] || 25 }); });
    stock.push({ type: 'repair', id: 'repair', cost: 40 });
    return stock;
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
  Run.rest = function (state, id) {
    var p = state.pending;
    if (!p || p.kind !== 'rest') return false;
    if (id === 'repair') { state.hp += Run.maxHp(state) * 0.4; }
    else if (id === 'forge') { state.hpBonus += 90; state.hp += 90; }
    else if (id === 'supply') { grantItem(state, pick(RZ.ITEMS).id); grantItem(state, pick(RZ.ITEMS).id); state.gold += 25; }
    else return false;
    clampHp(state);
    state.pending = null;
    Run.advance(state);
    return true;
  };

  // ================= 事件 =================
  // run(state) 返回一句结果，界面拿去显示
  Run.EVENTS = [
    { id: 'depot', title: '废弃补给站', text: '沙尘里露出半截集装箱，锁早就锈穿了。',
      options: [
        { label: '搬走值钱的', desc: '+60 金币', run: function (s) { s.gold += 60; return '你拆下一堆还能卖的零件。金币 +60。'; } },
        { label: '翻找弹药', desc: '两件随机道具', run: function (s) {
          var a = pick(RZ.ITEMS), b = pick(RZ.ITEMS), got = [];
          if (grantItem(s, a.id)) got.push(a.name);
          if (grantItem(s, b.id)) got.push(b.name);
          return got.length ? '找到了：' + got.join('、') + '。' : '道具栏已经满了，只能空手离开。';
        } }
      ] },
    { id: 'tuner', title: '黑市改装师', text: '「好东西有，就是装的时候得拆你几块装甲。」',
      options: [
        { label: '成交', desc: '失去 25% 当前耐久，获得一件稀有遗物', run: function (s) {
          var p = Run.RELICS.filter(function (r) { return r.rarity === 'rare' && s.relics.indexOf(r.id) < 0; });
          if (!p.length) { s.gold += 80; return '他翻遍了仓库也没有你没见过的货，赔了你 80 金币。'; }
          s.hp = Math.max(1, Math.round(s.hp * 0.75));
          var r = pick(p); grantRelic(s, r.id);
          return '装甲被拆走一截，换来了「' + r.name + '」：' + r.desc;
        } },
        { label: '算了', desc: '什么都不发生', run: function () { return '你摆摆手，把车开走了。'; } }
      ] },
    { id: 'chip', title: '来历不明的芯片', text: '路边残骸的火控电脑还亮着，里面有一份改造图纸。',
      options: [
        { label: '直接刷进火控', desc: '随机一把武器获得随机改造', run: function (s) {
          var slot = pick(['w1', 'w2', 'ss']), m = pick(Run.MODS);
          s.mods[slot].push(m.id);
          return (slot === 'w1' ? '一号武器' : slot === 'w2' ? '二号武器' : '必杀') + '装上了「' + m.name + '」。';
        } },
        { label: '拆了当备件', desc: '恢复 25% 耐久', run: function (s) { s.hp += Run.maxHp(s) * 0.25; clampHp(s); return '用拆下来的零件补了补车体。'; } }
      ] },
    { id: 'gamble', title: '废土赌局', text: '几个拾荒者围着一箱金币：「猜对了全归你，猜错了挨我们一炮。」',
      options: [
        { label: '赌一把', desc: '一半概率 +110 金币，一半概率失去 15% 耐久', run: function (s) {
          if (rand() < 0.5) { s.gold += 110; return '你赢了！金币 +110。'; }
          s.hp = Math.max(1, Math.round(s.hp - Run.maxHp(s) * 0.15));
          return '猜错了。一发冷炮砸在车顶上。';
        } },
        { label: '不赌', desc: '什么都不发生', run: function () { return '你没理他们。'; } }
      ] }
  ];
  Run.eventById = function (id) { return byId(Run.EVENTS, id); };

  Run.eventChoose = function (state, optIndex) {
    var p = state.pending;
    if (!p || p.kind !== 'event') return false;
    var ev = Run.eventById(p.id), opt = ev && ev.options[optIndex];
    if (!opt) return false;
    var text = opt.run(state);
    clampHp(state);
    state.pending = { kind: 'note', title: ev.title, text: text };
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

  RZ.Run = Run;
})(window.RZ || (window.RZ = {}));

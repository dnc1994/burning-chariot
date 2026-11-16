/* 燃烧战车 — 远征模式的界面
 * 跟 main.js 一样是个「哑」渲染层：规则全在 run.js（RZ.Run），这里只把 state 画出来、
 * 把点击翻译成 Run.xxx() 调用，然后整块重画。远征界面不是每帧刷新的，整块重画足够。
 */
(function (RZ) {
  'use strict';

  var Run = RZ.Run, App = RZ.App;
  var $ = function (id) { return document.getElementById(id); };

  var state = null;                 // 当前远征；null 表示在营地
  var meta = null;
  var hub = { pick: Run.STARTERS[0], asc: 0, hardcore: false, view: 'go', seed: '' };   // view：营地的哪一页（go 出发 / codex 图鉴 / ach 成就 / hist 历史）
  var note = '';                    // 结算画面上「已复制」之类的一句话
  var slotPick = null;              // 正在给哪个改造挑武器：{from:'reward'|'shop', index}
  var quitArmed = false;
  // 进度备份面板：mode 是 null / 'export' / 'import'；pending 是读出来、等玩家确认要不要覆盖的那份进度
  var bk = { mode: null, text: '', msg: '', pending: null, raw: '' };

  var SLOT_NAMES = { w1: '一号武器', w2: '二号武器', ss: '必杀' };
  var NODE_NAMES = { fight: '战斗', elite: '精英战', boss: 'BOSS', shop: '商店', rest: '修整', event: '未知事件',
    trial: '限时挑战', chest: '宝箱', altar: '诅咒祭坛' };
  var PERK_TAGS = { armor: '厚甲', thorns: '反伤', repair: '自修复', crit: '暴击', anchor: '不可击飞', aftershock: '余震' };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mapName(id) { return RZ.mapById(id).name; }

  // ================= 营地（还没出发） =================
  function hubTabs() {
    var tabs = [['go', '出发'], ['codex', '图鉴'], ['ach', '成就'], ['hist', '历史']], out = '';
    tabs.forEach(function (t) {
      var extra = t[0] === 'ach' ? ' ' + Object.keys(meta.ach).length + ' / ' + Run.ACHIEVEMENTS.length : '';
      out += '<button class="chip' + (hub.view === t[0] ? ' active' : '') + '" data-act="view" data-id="' + t[0] + '">' + t[1] + extra + '</button>';
    });
    return '<div class="chips hub-tabs">' + out + '</div>';
  }

  /** 每日挑战：今天的种子、今天开哪辆车、今天打得怎么样 */
  function dailyHTML() {
    var key = Run.dateKey(), v = RZ.vehicleById(Run.dailyVehicle(key));
    var d = meta.daily && meta.daily.date === key ? meta.daily : null;
    return '<div class="daily"><span data-portrait="' + v.id + '"></span><div><u>每日挑战</u><b>' + key + '　' + v.name + '</b>' +
      '<small>所有人今天都是同一条路线、同一辆车（不管你解没解锁）。标准难度，可以反复打，记最高分。</small>' +
      '<small class="daily-rec">' + (d ? '今天打了 ' + d.tries + ' 次 · 最高 ' + d.best + ' 分' + (d.won ? ' · 已通关' : '') : '今天还没打过') +
        (meta.dailyWins ? ' · 累计通关 ' + meta.dailyWins + ' 天' : '') + '</small></div>' +
      '<button class="btn btn-primary" data-act="daily">开始</button></div>';
  }

  function hubHTML() {
    if (hub.view === 'codex') return '<div class="run-page">' + hubTabs() + codexHTML() + '</div>';
    if (hub.view === 'ach') return '<div class="run-page">' + hubTabs() + achHTML() + '</div>';
    if (hub.view === 'hist') return '<div class="run-page">' + hubTabs() + histHTML() + '</div>';
    var cards = '';
    RZ.VEHICLES.forEach(function (v) {
      var open = meta.unlocked.indexOf(v.id) >= 0;
      cards += '<div class="veh-card' + (v.id === hub.pick ? ' active' : '') + (open ? '' : ' locked') +
        '" data-act="pick" data-id="' + v.id + '"><span data-portrait="' + v.id + '"></span><b>' + v.name +
        '</b><i>' + (open ? v.tag : '未解锁') + '</i></div>';
    });
    var v = RZ.vehicleById(hub.pick), open = meta.unlocked.indexOf(v.id) >= 0;
    var ascChips = '';
    for (var a = 0; a <= meta.asc; a++) {
      ascChips += '<button class="chip' + (a === hub.asc ? ' active' : '') + '" data-act="asc" data-i="' + a + '">' +
        (a === 0 ? '标准' : '进阶 ' + a) + '</button>';
    }
    var go = open
      ? '<button class="btn btn-primary run-go" data-act="start">出　发</button>'
      : '<button class="btn run-go" data-act="unlock"' + (meta.medals < Run.UNLOCK_COST ? ' disabled' : '') + '>解锁 ' +
        v.name + '（' + Run.UNLOCK_COST + ' 勋章）</button>';
    return '<div class="run-page">' + hubTabs() + '<div class="run-hub">' +
      '<div class="panel">' + dailyHTML() + '<h3 class="panel-h">车库</h3><div class="veh-grid">' + cards + '</div>' +
        '<h3 class="panel-h">远征怎么打</h3><ul class="rules run-brief">' +
        '<li>三个区域，每个区域五层，最后一层是 <b>Boss</b>。耐久带进下一场，输一场就结束。</li>' +
        '<li>每场打赢<b>三选一</b>：武器改造可以反复叠，遗物是全局被动——叠出你自己的流派。</li>' +
        '<li>每辆车有一个只在远征里生效的<b>被动</b>；成对的遗物凑齐会触发<b>联动</b>。</li>' +
        '<li>有的战场带<b>词条</b>（大风、夜战、陨石雨……），有的敌人不是战车——选去处时卡片上都写着。</li>' +
        '<li>爆炸会把战车<b>掀飞</b>，油桶一点就<b>连锁</b>；打得漂亮有额外赏金。</li></ul></div>' +
      '<div class="panel"><div class="veh-detail">' + App.detailHTML(v) + '</div>' + passiveHTML(v.id) +
        '<h3 class="panel-h">难度</h3><div class="chips">' + ascChips + '</div>' +
        (meta.asc === 0 ? '<p class="run-tip">通关一次后开放进阶难度。</p>'
          : '<p class="run-tip">每级进阶：敌人耐久 +8%、攻击 +6%。通关当前最高级解锁下一级。</p>') +
        '<h3 class="panel-h">硬核</h3><div class="chips">' +
          '<button class="chip' + (hub.hardcore ? '' : ' active') + '" data-act="hard" data-i="0">关（有弹道预览和出手顺序）</button>' +
          '<button class="chip' + (hub.hardcore ? ' active' : '') + '" data-act="hard" data-i="1">开（全靠自己记）</button></div>' +
        '<h3 class="panel-h">种子码</h3>' +
        '<input class="seed-in" id="seed-in" maxlength="16" spellcheck="false" autocomplete="off" placeholder="留空就随机" value="' + esc(hub.seed) + '">' +
        '<p class="run-tip">种子决定路线、敌人、奖励、商店和事件。填别人给你的种子码，就能打跟他一模一样的一局。</p>' +
        '<div class="run-go-row">' + go + '</div>' +
        '<p class="run-tip">战绩：远征 ' + meta.runs + ' 次 · 通关 ' + meta.wins + ' 次 · 单次最多打赢 ' + meta.best + ' 场' +
          (meta.endlessBest ? ' · 无尽最多再打穿 ' + meta.endlessBest + ' 个区域' : '') + '</p>' +
        backupHTML() +
      '</div></div></div>';
  }

  // ---- 图鉴 ----
  var RARITY_NAMES = { common: '普通遗物', rare: '稀有遗物', boss: 'Boss 遗物', curse: '诅咒遗物' };
  function codexCard(cls, kind, name, desc, seen, extra) {
    return '<div class="offer cx ' + cls + (seen ? '' : ' unseen') + '"><u>' + kind + '</u><b>' + (seen ? name : '？？？') + '</b><p>' +
      (seen ? desc : '还没见过。') + '</p>' + (seen && extra ? '<div class="syns">' + extra + '</div>' : '') + '</div>';
  }
  function codexHTML() {
    var sn = meta.seen, h = '';
    var section = function (title, got, total, body) {
      return '<h3 class="panel-h">' + title + ' <em>' + got + ' / ' + total + '</em></h3><div class="offers cx-grid">' + body + '</div>';
    };
    ['common', 'rare', 'boss', 'curse'].forEach(function (rar) {
      var list = Run.RELICS.filter(function (r) { return r.rarity === rar; }), got = 0, body = '';
      list.forEach(function (r) {
        var seen = sn.relics.indexOf(r.id) >= 0; if (seen) got++;
        body += codexCard('relic ' + rar, RARITY_NAMES[rar], r.name, r.desc, seen);
      });
      h += section(RARITY_NAMES[rar], got, list.length, body);
    });
    // 联动：两半都见过才亮出来
    var sg = 0, sb = '';
    Run.SYNERGIES.forEach(function (sy) {
      var seen = sn.relics.indexOf(sy.needs[0]) >= 0 && sn.relics.indexOf(sy.needs[1]) >= 0; if (seen) sg++;
      sb += codexCard('relic syn-card', '联动', sy.name, sy.desc, seen,
        '<em class="syn on">' + Run.relicById(sy.needs[0]).name + ' + ' + Run.relicById(sy.needs[1]).name + '</em>');
    });
    h += section('联动（两件遗物都见过才显示）', sg, Run.SYNERGIES.length, sb);
    var mg = 0, mb = '';
    Run.MODS.forEach(function (m) {
      var seen = sn.mods.indexOf(m.id) >= 0; if (seen) mg++;
      mb += codexCard('mod' + (m.rare ? ' rare' : ''), m.rare ? '稀有改造' : '武器改造', m.name, m.desc, seen);
    });
    h += section('武器改造', mg, Run.MODS.length, mb);
    // 敌人：三个 Boss + 三种特殊敌人
    var fg = 0, fb = '';
    Run.ACTS.forEach(function (a) {
      var seen = sn.foes.indexOf('boss:' + a.boss.kit) >= 0; if (seen) fg++;
      fb += codexCard('relic boss', 'Boss', a.boss.name, '「' + a.name + '」的守关者。', seen);
    });
    Object.keys(Run.FOE_KINDS).forEach(function (k) {
      var seen = sn.foes.indexOf('kind:' + k) >= 0; if (seen) fg++;
      fb += codexCard('mod', '特殊敌人', Run.FOE_KINDS[k].name, Run.FOE_KINDS[k].note, seen);
    });
    h += section('敌人', fg, Run.ACTS.length + Object.keys(Run.FOE_KINDS).length, fb);
    var wg = 0, wb = '';
    Object.keys(RZ.MAP_MODS).forEach(function (k) {
      var seen = sn.mapMods.indexOf(k) >= 0; if (seen) wg++;
      wb += codexCard('mod', '地图词条', RZ.MAP_MODS[k].name, RZ.MAP_MODS[k].desc, seen);
    });
    h += section('地图词条', wg, Object.keys(RZ.MAP_MODS).length, wb);
    return '<div class="panel"><p class="run-tip">拿到过的遗物、装过的改造、打过的敌人和词条会记在这里。打一场记一次，中途关掉也不丢。</p>' + h + '</div>';
  }

  // ---- 成就 ----
  function achLine(a, when) {
    return '<div class="ach' + (when ? ' done' : '') + '"><i>' + (when ? '✓' : '') + '</i><div><b>' + a.name + '</b><span>' + a.desc + '</span></div>' +
      '<em>+' + a.medals + ' 勋章</em></div>';
  }
  function achHTML() {
    var done = '', todo = '';
    Run.ACHIEVEMENTS.forEach(function (a) { if (meta.ach[a.id]) done += achLine(a, meta.ach[a.id]); else todo += achLine(a, 0); });
    return '<div class="panel"><p class="run-tip">每个成就只算一次，达成时当场发勋章——勋章可以回「出发」那一页解锁战车。</p>' +
      (done ? '<h3 class="panel-h">已达成 <em>' + Object.keys(meta.ach).length + '</em></h3><div class="ach-list">' + done + '</div>' : '') +
      (todo ? '<h3 class="panel-h">还没达成</h3><div class="ach-list">' + todo + '</div>' : '') + '</div>';
  }
  /** 这一场 / 这一局里新达成的成就：一条黄色的横幅 */
  function achBanner(ids) {
    if (!ids || !ids.length) return '';
    var out = '';
    ids.forEach(function (id) { var a = Run.achById(id); if (a) out += '<div class="ach-new"><u>成就达成</u><b>' + a.name + '</b><span>' + a.desc + '</span><em>+' + a.medals + ' 勋章</em></div>'; });
    return out;
  }

  // ---- 历史 ----
  function whereText(h) {
    if (h.endless) return '通关　无尽再打穿 ' + h.endless + ' 个区域';
    if (h.won) return '通关';
    return '止步「' + Run.ACTS[h.act % Run.ACTS.length].name + '」第 ' + (h.step + 1) + ' 层';
  }
  function histHTML() {
    if (!meta.history.length) return '<div class="panel"><p class="run-tip">还没有打完过一局远征。打完的每一局（最近 ' + Run.HISTORY_MAX + ' 局）都会记在这里。</p></div>';
    var rows = '';
    meta.history.forEach(function (h, i) {
      var v = RZ.vehicleById(h.vid), d = new Date(h.t);
      var tags = (h.daily ? '<i>每日 ' + h.daily + '</i>' : '') + (h.asc ? '<i>进阶 ' + h.asc + '</i>' : '') + (h.hardcore ? '<i>硬核</i>' : '');
      var relics = (h.relics || []).map(function (id) { var r = Run.relicById(id); return r ? r.name : ''; }).filter(Boolean).join('、');
      rows += '<div class="hist' + (h.won ? ' won' : '') + '"><span data-portrait="' + v.id + '"></span>' +
        '<div><b>' + v.name + '　' + whereText(h) + '</b>' + tags +
        '<small>' + Run.dateKey(d) + ' · 打赢 ' + h.battles + ' 场 · Boss ' + h.bosses + ' 个 · ' + (h.relics || []).length + ' 件遗物' + (relics ? '：' + relics : '') + '</small></div>' +
        '<div class="hist-r"><em>' + h.score + ' 分</em>' +
        (h.seed && !h.daily ? '<button class="btn btn-ghost" data-act="reseed" data-i="' + i + '">用这个种子再来（' + esc(h.seed) + '）</button>' : '') + '</div></div>';
    });
    return '<div class="panel"><div class="hist-list">' + rows + '</div></div>';
  }

  /** 战车的远征被动：营地详情和侧栏都用这一块 */
  function passiveHTML(vid) {
    var ps = Run.passiveOf(vid);
    return ps ? '<div class="passive"><u>远征被动</u><b>' + ps.name + '</b><span>' + ps.desc + '</span></div>' : '';
  }

  /**
   * 遗物和联动的关系，写在遗物卡 / 侧栏遗物条下面。
   * on：手里已经有另一半（拿了就凑成）；否则只提一句「和谁凑」。
   */
  function synergyHint(id, owned) {
    var out = '';
    Run.synergiesOf(id).forEach(function (x) {
      var partner = Run.relicById(x.partner), on = owned.indexOf(x.partner) >= 0;
      out += '<em class="syn' + (on ? ' on' : '') + '">' + (on ? '凑成联动「' + x.syn.name + '」：' + x.syn.desc
        : '联动：配「' + partner.name + '」→「' + x.syn.name + '」') + '</em>';
    });
    return out;
  }

  // ---- 进度备份 ----
  function backupHTML() {
    var h = '<h3 class="panel-h">进度备份</h3>' +
      '<p class="run-tip">进度只存在这台设备的浏览器里，清理浏览器数据、换设备或太久没来都可能丢。' +
      '导出一串进度码存好，随时能原样读回来，也能带到别的设备上。</p>';
    if (Run.needsBackup(meta)) {
      h += '<p class="bk-nag">' + (meta.sinceBackup >= 3 ? '已经 ' + meta.sinceBackup + ' 次远征没有备份了' : '你已经解锁了新东西，但还没备份过') + '</p>';
    }
    h += '<div class="chips"><button class="chip' + (bk.mode === 'export' ? ' active' : '') + '" data-act="bk-export">导出进度</button>' +
      '<button class="chip' + (bk.mode === 'import' ? ' active' : '') + '" data-act="bk-import">导入进度</button></div>';
    if (bk.mode === 'export') {
      h += '<textarea class="bk-code" id="bk-code" readonly spellcheck="false">' + esc(bk.text) + '</textarea>' +
        '<div class="chips"><button class="chip" data-act="bk-copy">复制进度码</button>' +
        '<button class="chip" data-act="bk-file">下载成文件</button>' +
        '<button class="chip" data-act="bk-link">复制带进度的链接</button></div>';
    } else if (bk.mode === 'import') {
      h += '<textarea class="bk-code" id="bk-in" spellcheck="false" placeholder="把进度码（或带进度的链接）粘贴到这里">' + esc(bk.text) + '</textarea>' +
        '<div class="chips"><button class="chip" data-act="bk-read">读取</button>' +
        '<label class="chip">从文件读取<input type="file" id="bk-pick" accept=".txt,text/plain" hidden></label></div>';
    }
    if (bk.msg) h += '<p class="bk-msg">' + esc(bk.msg) + '</p>';
    return h;
  }

  /** 读出来一份进度，覆盖之前先让玩家看清楚里面是什么、会盖掉什么 */
  function importHTML() {
    var p = bk.pending, cur = meta;
    var line = function (m, r) {
      return '勋章 ' + m.medals + ' 枚，解锁 ' + m.unlocked.length + ' 辆战车，通关 ' + m.wins + ' 次' +
        (r ? '，另有一局打到一半的远征（' + RZ.vehicleById(r.vehicleId).name + '，' + Run.actOf(r).name + '第 ' + (r.step + 1) + ' 层）' : '');
    };
    return '<div class="run-over"><div class="dialog wide">' +
      '<h3>导入进度</h3>' +
      '<div class="result-body">' +
        '<div class="rrow bonus"><span></span><span>要导入的</span><span>' + line(p.meta, p.run) + '</span><span></span></div>' +
        '<div class="rrow"><span></span><span>这台设备上的</span><span>' + line(cur, state && !state.over ? state : null) + '</span><span></span></div>' +
      '</div>' +
      '<p class="over-line">导入会覆盖这台设备上现在的进度，不能撤销。</p>' +
      '<div class="row"><button class="btn btn-primary" data-act="bk-apply">覆盖并导入</button>' +
      '<button class="btn" data-act="bk-cancel">不导入</button></div></div></div>';
  }

  function copyText(text, done) {
    var fallback = function () {
      var ta = $('bk-code');
      try { if (ta) { ta.focus(); ta.select(); document.execCommand('copy'); } } catch (e) { /* 复制不了就让玩家自己选中复制 */ }
      done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function tryRead(text) {
    var r = Run.parseCode(text);
    if (r.ok) { bk.pending = r; bk.raw = text; bk.msg = ''; }
    else bk.msg = r.error;
  }

  // ================= 远征进行中 =================
  function weaponLine(tag, w) {
    var mods = '';
    (w.mods || []).forEach(function (m) { mods += '<em>' + m + '</em>'; });
    return '<div class="rw"><u>' + tag + '</u><b>' + w.name + '</b><s>威力 ' + w.damage + (w.count > 1 ? '×' + w.count : '') +
      ' · 范围 ' + w.radius + ' · 耗油 ' + w.fuel + '</s>' + (mods ? '<div class="rw-mods">' + mods + '</div>' : '') + '</div>';
  }

  function sideHTML() {
    var v = Run.playerVehicle(state), hpMax = v.hp, i;
    var pips = '', loop = Run.loopOf(state), cycle = state.act % Run.ACTS.length;
    if (loop) pips += '<div class="act-row cur endless"><span>无尽 第 ' + loop + ' 圈</span></div>';
    for (var a = 0; a < Run.ACTS.length; a++) {
      pips += '<div class="act-row' + (a === cycle ? ' cur' : '') + '"><span>' + Run.ACTS[a].name + '</span>';
      for (i = 0; i < Run.LAYERS_PER_ACT; i++) {
        var done = a < cycle || (a === cycle && i < state.step);
        var cur = a === cycle && i === state.step;
        pips += '<i class="' + (done ? 'done' : cur ? 'cur' : '') + (i === Run.LAYERS_PER_ACT - 1 ? ' boss' : '') + '"></i>';
      }
      pips += '</div>';
    }
    var relics = '', syns = '';
    state.relics.forEach(function (id) {
      var r = Run.relicById(id);
      relics += '<div class="relic ' + r.rarity + '"><b>' + r.name + (r.rarity === 'curse' ? '<i>诅咒</i>' : '') + '</b><span>' + r.desc + '</span></div>';
    });
    Run.activeSynergies(state).forEach(function (sy) {
      syns += '<div class="relic syn"><b>' + sy.name + '<i>联动</i></b><span>' + sy.desc + '</span></div>';
    });
    var items = '';
    for (i = 0; i < RZ.MAX_ITEMS; i++) {
      var d = state.items[i] ? RZ.itemById(state.items[i]) : null;
      items += '<span class="ritem' + (d ? '' : ' empty') + '"' + (d ? ' title="' + esc(d.desc) + '"' : '') + '>' +
        (d ? '<i style="background:' + d.color + '"></i>' + d.short : '空') + '</span>';
    }
    return '<div class="panel run-side">' +
      '<div class="rs-head"><span data-portrait="' + v.id + '"></span><div><b>' + v.name + '</b>' +
        '<div class="mbar"><div class="mfill hp" style="width:' + Math.round(state.hp / hpMax * 100) + '%"></div></div>' +
        '<small>耐久 ' + state.hp + ' / ' + hpMax + '　攻击 ' + v.atk + '</small></div></div>' +
      passiveHTML(state.vehicleId) +
      '<div class="act-pips">' + pips + '</div>' +
      (state.seed ? '<p class="seed-line">' + (state.daily ? '每日挑战 ' + state.daily : '种子 <b>' + esc(state.seed) + '</b>') + '</p>' : '') +
      '<h3 class="panel-h">武器</h3>' + weaponLine('1', v.w1) + weaponLine('2', v.w2) + weaponLine('必杀', v.ss) +
      '<h3 class="panel-h">道具</h3><div class="ritems">' + items + '</div>' +
      '<h3 class="panel-h">遗物 <em>' + state.relics.length + '</em></h3>' + syns +
      (relics || '<p class="run-tip">还没有遗物。打赢战斗、逛商店、碰运气都能拿到。</p>') +
      '<button class="btn btn-ghost run-quit" data-act="quit">' + (quitArmed ? '再点一次确认放弃' : '放弃远征') + '</button>' +
      '</div>';
  }

  function enemyLine(e) {
    var v = Run.enemyVehicle(e), tags = [];
    ['w1', 'w2', 'ss'].forEach(function (k) {
      (e.mods[k] || []).forEach(function (m) { var d = Run.modById(m); if (d && tags.indexOf(d.name) < 0) tags.push(d.name); });
    });
    for (var k in (e.perks || {})) if (PERK_TAGS[k] && k !== 'anchor') tags.push(PERK_TAGS[k]);
    return '<div class="foe"><span data-portrait="' + e.vid + '"' + (e.kind ? ' data-kind="' + e.kind + '"' : '') + '></span><div><b>' + esc(e.name) + '</b>' +
      '<small>' + v.tag + ' · 耐久 ' + v.hp + ' · 攻击 ' + v.atk + '</small>' +
      (tags.length ? '<small class="foe-tags">' + tags.join(' · ') + '</small>' : '') + '</div></div>';
  }

  /** 一个节点里的敌人：同名同款的并成一行「× 3」，特殊敌人后面跟一句它的规矩 */
  function foesHTML(node) {
    var out = '', seen = {}, notes = '';
    node.enemies.forEach(function (e) {
      var key = e.kind === 'swarm' || e.kind === 'bomber' ? e.kind : null;
      if (key && seen[key]) return;
      if (key) {
        seen[key] = true;
        var n = node.enemies.filter(function (x) { return x.kind === key; }).length;
        var kd = Run.FOE_KINDS[key], v = Run.enemyVehicle(e);
        out += '<div class="foe"><span data-portrait="' + e.vid + '" data-kind="' + key + '"></span><div><b>' + kd.name + ' × ' + n + '</b>' +
          '<small>每辆耐久 ' + v.hp + ' · 攻击 ' + v.atk + '</small></div></div>';
      } else out += enemyLine(e);
      if (e.kind && notes.indexOf(Run.FOE_KINDS[e.kind].note) < 0) notes += '<p class="foe-note">' + Run.FOE_KINDS[e.kind].note + '</p>';
    });
    return out + notes;
  }

  /** 节点上的地图词条 / 限时：一排小标签 + 一句说明 */
  function modsHTML(node) {
    var out = '';
    (node.mods || []).forEach(function (id) {
      var m = RZ.MAP_MODS[id];
      if (m) out += '<p class="node-mod"><b>' + m.name + '</b>' + m.desc + '</p>';
    });
    if (node.limit) out += '<p class="node-mod hot"><b>限 ' + node.limit + ' 轮</b>' + node.limit + ' 轮之内全歼才有奖励；超时敌人撤走，不算输。</p>';
    return out;
  }

  function nodeCard(node, i) {
    var body = '', foot = '';
    if (node.enemies) {
      body = foesHTML(node) + modsHTML(node);
      foot = mapName(node.mapId) + ' · 金币 ' + node.gold + '+ · ' +
        (node.type === 'boss' ? 'Boss 遗物 + 大修' : node.type === 'elite' || node.type === 'trial' ? '稀有遗物二选一 + 稀有改造' : '改造 / 遗物三选一') +
        (node.mods && node.mods.length ? '<b class="mod-bonus">词条奖励：多 ' + Run.MOD_GOLD + ' 金币（已算在内），战后多一个稀有选项</b>' : '');
    } else if (node.type === 'chest') {
      body = '<p>一只没人看着的箱子。白拿一笔金币，再从两样东西里挑一样。</p>';
      foot = '不用打';
    } else if (node.type === 'altar') {
      body = '<p>拿装甲换稀有遗物，背一件诅咒换稀有改造，或者把身上的诅咒洗掉。</p>';
      foot = '不用打 · 也可以什么都不做';
    } else if (node.type === 'shop') {
      body = '<p>花金币买遗物、改造、道具，或者修车。</p>';
      foot = '你有 ' + state.gold + ' 金币';
    } else if (node.type === 'rest') {
      body = '<p>检修回血、加固底盘、整备弹药，三选一。</p>';
      foot = '不用打';
    } else {
      body = '<p>不知道会碰上什么。可能是便宜，也可能是坑。</p>';
      foot = '不用打';
    }
    return '<div class="node ' + node.type + '" data-act="enter" data-i="' + i + '">' +
      '<h4>' + NODE_NAMES[node.type] + '</h4><div class="node-body">' + body + '</div>' +
      '<div class="node-foot">' + foot + '</div></div>';
  }

  function choiceHTML() {
    var list = Run.choices(state), cards = '';
    list.forEach(function (n, i) { cards += nodeCard(n, i); });
    return '<div class="run-main"><h3 class="run-title">' + (Run.loopOf(state) ? '无尽 · ' : '') + Run.actOf(state).name + ' · 第 ' + (state.step + 1) + ' / ' +
      Run.LAYERS_PER_ACT + ' 层<small>选一个去处</small></h3><div class="nodes n' + list.length + '">' + cards + '</div></div>';
  }

  // ---- 奖励 / 商店里的一张卡 ----
  function slotButtons(from, index) {
    var v = Run.playerVehicle(state), out = '<div class="slot-pick"><small>装到哪把武器上？</small>';
    ['w1', 'w2', 'ss'].forEach(function (k) {
      out += '<button class="btn" data-act="slot" data-from="' + from + '" data-i="' + index + '" data-slot="' + k + '">' +
        SLOT_NAMES[k] + '<small>' + v[k].name + '</small></button>';
    });
    return out + '</div>';
  }

  function offerCard(c, i, from, cost, sold) {
    var kind, name, desc, cls = c.type, picking = slotPick && slotPick.from === from && slotPick.index === i;
    var extra = '';
    if (c.type === 'relic') {
      var r = Run.relicById(c.id);
      kind = r.rarity === 'boss' ? 'Boss 遗物' : r.rarity === 'rare' ? '稀有遗物' : r.rarity === 'curse' ? (c.black ? '黑市　诅咒遗物' : '诅咒遗物') : '遗物';
      name = r.name; desc = r.desc; cls += ' ' + r.rarity;
      extra = synergyHint(c.id, state.relics);
    } else if (c.type === 'mod') {
      var m = Run.modById(c.id);
      kind = m.rare ? '稀有改造' : '武器改造'; name = m.name; desc = m.desc;
      if (m.rare) cls += ' rare';
    } else if (c.type === 'item') {
      var it = RZ.itemById(c.id);
      kind = '道具'; name = it.name; desc = it.desc;
    } else {
      kind = '维修'; name = '战地修理'; desc = '恢复 30% 耐久。可以反复买。';
    }
    var cant = cost != null && state.gold < cost;
    var full = c.type === 'item' && state.items.length >= RZ.MAX_ITEMS;
    var btn = sold ? '<span class="sold">已买走</span>'
      : picking ? slotButtons(from, i)
      : '<button class="btn btn-primary" data-act="take" data-from="' + from + '" data-i="' + i + '"' +
        (cant || full ? ' disabled' : '') + '>' + (cost != null ? (full ? '道具栏已满' : cost + ' 金币') : '拿这个') + '</button>';
    return '<div class="offer ' + cls + (sold ? ' gone' : '') + '"><u>' + kind + '</u><b>' + name + '</b><p>' + desc + '</p>' +
      (extra ? '<div class="syns">' + extra + '</div>' : '') + btn + '</div>';
  }

  function pendingHTML() {
    var p = state.pending, h = '', i;
    if (p.kind === 'reward') {
      for (i = 0; i < p.choices.length; i++) h += offerCard(p.choices[i], i, 'reward');
      return '<div class="run-main"><h3 class="run-title">' + (p.from === 'boss' ? 'Boss 击破！' : p.from === 'chest' ? '宝箱' : p.from === 'trial' ? '挑战成功' : '战斗胜利') +
        '<small>金币 +' + p.gold + (p.style ? '（含花式赏金 ' + p.style + '）' : '') + ' · ' + ['', '', '二', '三', '四', '五'][p.choices.length] + '选一</small></h3>' + achBanner(p.ach) +
        '<div class="offers' + (p.choices.length > 3 ? ' four' : '') + '">' + h + '</div>' +
        '<button class="btn btn-ghost run-skip" data-act="skip">都不要（换 15 金币）</button></div>';
    }
    if (p.kind === 'shop') {
      for (i = 0; i < p.stock.length; i++) h += offerCard(p.stock[i], i, 'shop', p.stock[i].cost, p.stock[i].sold);
      return '<div class="run-main"><h3 class="run-title">商店<small>你有 ' + state.gold + ' 金币</small></h3>' +
        '<div class="offers shop-grid">' + h + '</div>' +
        '<div class="row run-skip"><button class="btn" data-act="reroll"' + (state.gold < Run.rerollCost(state) ? ' disabled' : '') + '>刷新货架（' +
          Run.rerollCost(state) + ' 金币）</button><button class="btn" data-act="leave">离开商店</button></div></div>';
    }
    if (p.kind === 'rest') {
      var restOpts = Run.restOptions(state);
      restOpts.forEach(function (o) {
        h += '<div class="offer rest' + (o.id === 'purify' ? ' curse' : '') + '"><u>' + (o.id === 'purify' ? '净化' : '修整') + '</u><b>' + o.name + '</b><p>' + o.desc + '</p>' +
          '<button class="btn btn-primary" data-act="rest" data-id="' + o.id + '">选这个</button></div>';
      });
      return '<div class="run-main"><h3 class="run-title">修整<small>' + (restOpts.length > 3 ? '四选一' : '三选一') + '</small></h3><div class="offers' +
        (restOpts.length > 3 ? ' four' : '') + '">' + h + '</div></div>';
    }
    if (p.kind === 'event') {
      var ev = Run.eventById(p.id);
      ev.options.forEach(function (o, k) {
        h += '<button class="btn event-opt" data-act="event" data-i="' + k + '"' + (Run.canChoose(state, o) ? '' : ' disabled') +
          '><b>' + o.label + '</b><small>' + o.desc + '</small></button>';
      });
      return '<div class="run-main"><div class="event"><h3>' + ev.title + '</h3><p>' + ev.text + '</p>' + h + '</div></div>';
    }
    return '<div class="run-main"><div class="event"><h3>' + p.title + '</h3><p>' + p.text + '</p>' +
      '<button class="btn btn-primary" data-act="leave">继续前进</button></div></div>';
  }

  /** 一段能贴给别人的战报 */
  function shareText() {
    var v = RZ.vehicleById(state.vehicleId), depth = Math.max(0, (state.endless || 0) - 1);
    var where = depth ? '通关，无尽再打穿 ' + depth + ' 个区域' : state.won ? '通关' : '止步「' + Run.actOf(state).name + '」第 ' + (state.step + 1) + ' 层';
    return '燃烧战车 ' + (state.daily ? '每日挑战 ' + state.daily : '远征') + '｜' + v.name + '｜' + where + '｜' + state.score + ' 分' +
      (state.daily ? '' : '｜种子 ' + state.seed) + '\n' + location.href.split('#')[0] + (state.daily ? '' : '#seed=' + state.seed);
  }

  function overHTML() {
    var relics = state.relics.map(function (id) { return Run.relicById(id).name; }).join('、') || '无';
    var depth = Math.max(0, (state.endless || 0) - 1);
    var title = state.endless ? '无尽远征结束' : state.won ? '远征通关' : '远征失败';
    var line = state.endless ? '通关之后又打穿了 ' + depth + ' 个区域，倒在「' + Run.actOf(state).name + '」第 ' + (state.step + 1) + ' 层。'
      : state.won ? '三个区域全部打穿。' : '倒在了「' + Run.actOf(state).name + '」第 ' + (state.step + 1) + ' 层。';
    var row = function (k, v, cls) { return '<div class="rrow"><span></span><span>' + k + '</span><span></span><span class="' + (cls || '') + '">' + v + '</span></div>'; };
    return '<div class="run-over"><div class="dialog wide">' +
      '<h3 style="color:' + (state.won ? '#f5b921' : '#d8361f') + '">' + title + '</h3>' +
      '<p class="over-line">' + line + '</p>' + achBanner(state.endAch) +
      '<div class="result-body">' +
        row('得分', state.score + ' 分', 'dmg') +
        row('打赢的战斗', state.battles + ' 场', 'dmg') +
        row('击破的 Boss', state.bosses + ' 个', 'dmg') +
        row('带着的遗物', relics) +
        (state.seed ? row(state.daily ? '每日挑战' : '种子码', state.daily || esc(state.seed)) : '') +
        row('获得勋章', '+' + state.earned, 'dmg') +
      '</div>' +
      (state.won && !state.endless && state.asc < Run.MAX_ASC ? '<p class="over-line">已开放进阶 ' + (state.asc + 1) + '。</p>' : '') +
      (Run.canEndless(state) ? '<p class="over-line">还没打够？带着现在这一身接着打——三个区域轮着来，敌人一路变强，直到倒下。倒下也算通关。</p>' : '') +
      (note ? '<p class="over-line over-note">' + note + '</p>' : '') +
      '<textarea id="bk-code" class="share-box" readonly>' + esc(shareText()) + '</textarea>' +
      '<div class="row over-btns">' +
        (Run.canEndless(state) ? '<button class="btn btn-primary" data-act="endless">进入无尽模式</button>' : '') +
        '<button class="btn" data-act="share">复制战报</button>' +
        '<button class="btn' + (Run.canEndless(state) ? '' : ' btn-primary') + '" data-act="home">回到营地</button></div></div></div>';
  }

  // ================= 重画 =================
  function render() {
    var root = $('run-root');
    if (!root) return;
    meta = Run.loadMeta();
    if (!state) state = Run.load();
    if (hub.asc > meta.asc) hub.asc = meta.asc;
    var html;
    if (bk.pending) html = importHTML();
    else if (!state) html = hubHTML();
    else if (state.over) html = overHTML();
    else html = '<div class="run-grid">' + sideHTML() + (state.pending ? pendingHTML() : choiceHTML()) + '</div>';
    root.innerHTML = html;
    $('run-purse').innerHTML = (state && !state.over ? '<b>' + state.gold + '</b> 金币　' : '') + '<b>' + meta.medals + '</b> 勋章';

    // 立绘占位换成真正的 canvas
    var spots = root.querySelectorAll('[data-portrait]');
    for (var i = 0; i < spots.length; i++) {
      var v = RZ.vehicleById(spots[i].getAttribute('data-portrait'));
      var fk = Run.FOE_KINDS[spots[i].getAttribute('data-kind')];
      if (fk && fk.art) { v = Object.create(v); v.art = fk.art; v.pal = fk.pal; }   // 炮台 / 自爆车有自己的画法
      var big = spots[i].parentNode.classList.contains('veh-card');
      spots[i].appendChild(big ? App.portrait(v, 100, 62, 0.82) : App.portrait(v, 64, 44, 0.56));
    }
  }

  function startBattle() {
    Run.save(state);
    App.startBattle(Run.battleOpts(state), function (game) {
      Run.afterBattle(state, game);
      if (!state.over) Run.save(state);
      App.show('run');
    });
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t || t.disabled) return;
    var act = t.getAttribute('data-act'), i = +t.getAttribute('data-i'), id = t.getAttribute('data-id');
    RZ.SFX.resume(); RZ.SFX.click();
    if (act !== 'quit') quitArmed = false;

    if (act.indexOf('bk-') === 0) { onBackup(act); render(); return; }
    if ($('seed-in')) hub.seed = Run.cleanSeed($('seed-in').value);     // 整块重画之前先把输入框里的字收起来
    if (act === 'pick') hub.pick = id;
    else if (act === 'view') hub.view = id;
    else if (act === 'daily') {
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e0) { /* 不支持就算了 */ }
      state = Run.newDaily(); note = '';
      Run.save(state);
    }
    else if (act === 'reseed') { var hr = meta.history[i]; if (hr) { hub.seed = hr.seed; hub.view = 'go'; if (meta.unlocked.indexOf(hr.vid) >= 0) hub.pick = hr.vid; } }
    else if (act === 'share') { copyText(shareText(), function () { note = '战报已复制，贴给朋友吧。'; render(); }); return; }
    else if (act === 'endless') { if (Run.goEndless(state)) { note = ''; RZ.SFX.relic(); } }
    else if (act === 'asc') hub.asc = i;
    else if (act === 'hard') hub.hardcore = i === 1;
    else if (act === 'unlock') { if (Run.unlock(meta, hub.pick)) RZ.SFX.relic(); }
    else if (act === 'start') {
      // 请浏览器别自动清理本站的数据。不是所有浏览器都认，认了也挡不住玩家自己清——所以才有进度码
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e2) { /* 不支持就算了 */ }
      state = Run.newRun(hub.pick, { asc: hub.asc, hardcore: hub.hardcore, seed: hub.seed });
      note = '';
      Run.save(state);
    }
    else if (act === 'home') { state = null; note = ''; hub.view = 'go'; }
    else if (!state) return;
    else if (act === 'quit') {
      if (!quitArmed) quitArmed = true;
      else { quitArmed = false; Run.finish(state, false); }
    }
    else if (act === 'enter') {
      slotPick = null;
      if (Run.enter(state, i)) { startBattle(); return; }
      Run.save(state);
    }
    else if (act === 'take') {
      var from = t.getAttribute('data-from');
      var c = from === 'reward' ? state.pending.choices[i] : state.pending.stock[i];
      if (c.type === 'mod') slotPick = { from: from, index: i };       // 改造还要再挑一把武器
      else if (from === 'reward') { if (Run.takeReward(state, i)) RZ.SFX.relic(); }
      else if (Run.buy(state, i)) { if (c.type === 'relic') RZ.SFX.relic(); else RZ.SFX.coin(); }
    }
    else if (act === 'slot') {
      var slot = t.getAttribute('data-slot');
      var okSlot = t.getAttribute('data-from') === 'reward' ? Run.takeReward(state, i, slot) : Run.buy(state, i, slot);
      if (okSlot) RZ.SFX.relic();
      slotPick = null;
    }
    else if (act === 'skip') { slotPick = null; if (Run.takeReward(state, -1)) RZ.SFX.coin(); }
    else if (act === 'leave') { slotPick = null; Run.leave(state); }
    else if (act === 'rest') { if (Run.rest(state, id)) RZ.SFX.heal(); }
    else if (act === 'event') { if (Run.eventChoose(state, i) === 'fight') { startBattle(); return; } }
    else if (act === 'reroll') { if (Run.reroll(state)) RZ.SFX.coin(); }

    if (state && !state.over) Run.save(state);
    render();
  }

  function onBackup(act) {
    var done = function (what) { Run.markBackup(); bk.msg = what; render(); };
    if (act === 'bk-export') { bk.mode = bk.mode === 'export' ? null : 'export'; bk.text = Run.exportCode(); bk.msg = ''; }
    else if (act === 'bk-import') { bk.mode = bk.mode === 'import' ? null : 'import'; bk.text = ''; bk.msg = ''; }
    else if (act === 'bk-copy') copyText(bk.text, function () { done('进度码已复制。找个地方存好它。'); });
    else if (act === 'bk-link') {
      var link = location.href.split('#')[0] + '#save=' + bk.text;
      copyText(link, function () { done('链接已复制。在另一台设备上打开它就能导入。'); });
    }
    else if (act === 'bk-file') {
      try {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([bk.text], { type: 'text/plain' }));
        a.download = '燃烧战车进度.txt';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        done('已下载「燃烧战车进度.txt」。');
      } catch (e) { bk.msg = '这个浏览器下载不了文件，请改用「复制进度码」。'; }
    }
    else if (act === 'bk-read') { bk.text = $('bk-in') ? $('bk-in').value : ''; tryRead(bk.text); }
    else if (act === 'bk-apply') {
      var r = Run.importCode(bk.raw);
      bk.pending = null; bk.mode = null; bk.text = '';
      bk.msg = r.ok ? '进度已导入。' : r.error;
      state = null;                                   // 重新从存档里读
    }
    else if (act === 'bk-cancel') { bk.pending = null; }
  }

  window.addEventListener('DOMContentLoaded', function () {
    var root = $('run-root');
    root.addEventListener('click', onClick);
    root.addEventListener('change', function (e) {      // 「从文件读取」
      var f = e.target && e.target.id === 'bk-pick' && e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { bk.text = String(fr.result || ''); tryRead(bk.text); render(); };
      fr.readAsText(f);
    });
    // 网址里带着进度（#save=…）：读出来等玩家确认，然后把它从地址栏里拿掉，免得刷新时再问一遍
    // 网址里带着种子（#seed=…）：填进种子码那一栏，等玩家自己点出发
    if (location.hash.indexOf('#seed=') === 0) {
      hub.seed = Run.cleanSeed(decodeURIComponent(location.hash.slice(6)));
      try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e3) { location.hash = ''; }
    }
    if (location.hash.indexOf('#save=') === 0) {
      tryRead(location.hash.slice(6));
      try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) { location.hash = ''; }
      bk.mode = bk.pending ? null : 'import';
      App.show('run');
    }
  });

  RZ.RunUI = {
    render: render,
    // 自检页用：直接塞一个状态进来看界面
    _set: function (s) { state = s; render(); },
    _state: function () { return state; }
  };
})(window.RZ || (window.RZ = {}));

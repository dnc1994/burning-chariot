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
  var hub = { pick: Run.STARTERS[0], asc: 0, hardcore: false };
  var slotPick = null;              // 正在给哪个改造挑武器：{from:'reward'|'shop', index}
  var quitArmed = false;

  var SLOT_NAMES = { w1: '一号武器', w2: '二号武器', ss: '必杀' };
  var NODE_NAMES = { fight: '战斗', elite: '精英战', boss: 'BOSS', shop: '商店', rest: '修整', event: '未知事件' };
  var PERK_TAGS = { armor: '厚甲', thorns: '反伤', repair: '自修复', crit: '暴击', anchor: '不可击飞', aftershock: '余震' };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mapName(id) { return RZ.mapById(id).name; }

  // ================= 营地（还没出发） =================
  function hubHTML() {
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
    return '<div class="run-hub">' +
      '<div class="panel"><h3 class="panel-h">车库</h3><div class="veh-grid">' + cards + '</div>' +
        '<h3 class="panel-h">远征怎么打</h3><ul class="rules run-brief">' +
        '<li>三个区域，每个区域五层，最后一层是 <b>Boss</b>。耐久带进下一场，输一场就结束。</li>' +
        '<li>每场打赢<b>三选一</b>：武器改造可以反复叠，遗物是全局被动——叠出你自己的流派。</li>' +
        '<li>爆炸会把战车<b>掀飞</b>，油桶一点就<b>连锁</b>；打得漂亮有额外赏金。</li></ul></div>' +
      '<div class="panel"><div class="veh-detail">' + App.detailHTML(v) + '</div>' +
        '<h3 class="panel-h">难度</h3><div class="chips">' + ascChips + '</div>' +
        (meta.asc === 0 ? '<p class="run-tip">通关一次后开放进阶难度。</p>'
          : '<p class="run-tip">每级进阶：敌人耐久 +8%、攻击 +6%。通关当前最高级解锁下一级。</p>') +
        '<h3 class="panel-h">硬核</h3><div class="chips">' +
          '<button class="chip' + (hub.hardcore ? '' : ' active') + '" data-act="hard" data-i="0">关（有弹道预览和出手顺序）</button>' +
          '<button class="chip' + (hub.hardcore ? ' active' : '') + '" data-act="hard" data-i="1">开（全靠自己记）</button></div>' +
        '<div class="run-go-row">' + go + '</div>' +
        '<p class="run-tip">战绩：远征 ' + meta.runs + ' 次 · 通关 ' + meta.wins + ' 次 · 单次最多打赢 ' + meta.best + ' 场</p>' +
      '</div></div>';
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
    var pips = '';
    for (var a = 0; a < Run.ACTS.length; a++) {
      pips += '<div class="act-row' + (a === state.act ? ' cur' : '') + '"><span>' + Run.ACTS[a].name + '</span>';
      for (i = 0; i < Run.LAYERS_PER_ACT; i++) {
        var done = a < state.act || (a === state.act && i < state.step);
        var cur = a === state.act && i === state.step;
        pips += '<i class="' + (done ? 'done' : cur ? 'cur' : '') + (i === Run.LAYERS_PER_ACT - 1 ? ' boss' : '') + '"></i>';
      }
      pips += '</div>';
    }
    var relics = '';
    state.relics.forEach(function (id) {
      var r = Run.relicById(id);
      relics += '<div class="relic ' + r.rarity + '"><b>' + r.name + '</b><span>' + r.desc + '</span></div>';
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
      '<div class="act-pips">' + pips + '</div>' +
      '<h3 class="panel-h">武器</h3>' + weaponLine('1', v.w1) + weaponLine('2', v.w2) + weaponLine('必杀', v.ss) +
      '<h3 class="panel-h">道具</h3><div class="ritems">' + items + '</div>' +
      '<h3 class="panel-h">遗物 <em>' + state.relics.length + '</em></h3>' +
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
    return '<div class="foe"><span data-portrait="' + e.vid + '"></span><div><b>' + esc(e.name) + '</b>' +
      '<small>' + RZ.vehicleById(e.vid).tag + ' · 耐久 ' + v.hp + ' · 攻击 ' + v.atk + '</small>' +
      (tags.length ? '<small class="foe-tags">' + tags.join(' · ') + '</small>' : '') + '</div></div>';
  }

  function nodeCard(node, i) {
    var body = '', foot = '';
    if (node.enemies) {
      node.enemies.forEach(function (e) { body += enemyLine(e); });
      foot = mapName(node.mapId) + ' · 金币 ' + node.gold + '+ · ' +
        (node.type === 'boss' ? 'Boss 遗物 + 大修' : node.type === 'elite' ? '稀有遗物二选一 + 改造' : '改造 / 遗物三选一');
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
    return '<div class="run-main"><h3 class="run-title">' + Run.ACTS[state.act].name + ' · 第 ' + (state.step + 1) + ' / ' +
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
    if (c.type === 'relic') {
      var r = Run.relicById(c.id);
      kind = r.rarity === 'boss' ? 'Boss 遗物' : r.rarity === 'rare' ? '稀有遗物' : '遗物';
      name = r.name; desc = r.desc; cls += ' ' + r.rarity;
    } else if (c.type === 'mod') {
      var m = Run.modById(c.id);
      kind = '武器改造'; name = m.name; desc = m.desc;
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
    return '<div class="offer ' + cls + (sold ? ' gone' : '') + '"><u>' + kind + '</u><b>' + name + '</b><p>' + desc + '</p>' + btn + '</div>';
  }

  function pendingHTML() {
    var p = state.pending, h = '', i;
    if (p.kind === 'reward') {
      for (i = 0; i < p.choices.length; i++) h += offerCard(p.choices[i], i, 'reward');
      return '<div class="run-main"><h3 class="run-title">' + (p.from === 'boss' ? 'Boss 击破！' : '战斗胜利') +
        '<small>金币 +' + p.gold + (p.style ? '（含花式赏金 ' + p.style + '）' : '') + ' · 三选一</small></h3>' +
        '<div class="offers">' + h + '</div>' +
        '<button class="btn btn-ghost run-skip" data-act="skip">都不要（换 15 金币）</button></div>';
    }
    if (p.kind === 'shop') {
      for (i = 0; i < p.stock.length; i++) h += offerCard(p.stock[i], i, 'shop', p.stock[i].cost, p.stock[i].sold);
      return '<div class="run-main"><h3 class="run-title">商店<small>你有 ' + state.gold + ' 金币</small></h3>' +
        '<div class="offers shop-grid">' + h + '</div>' +
        '<button class="btn run-skip" data-act="leave">离开商店</button></div>';
    }
    if (p.kind === 'rest') {
      Run.REST.forEach(function (o) {
        h += '<div class="offer rest"><u>修整</u><b>' + o.name + '</b><p>' + o.desc + '</p>' +
          '<button class="btn btn-primary" data-act="rest" data-id="' + o.id + '">选这个</button></div>';
      });
      return '<div class="run-main"><h3 class="run-title">修整<small>三选一</small></h3><div class="offers">' + h + '</div></div>';
    }
    if (p.kind === 'event') {
      var ev = Run.eventById(p.id);
      ev.options.forEach(function (o, k) {
        h += '<button class="btn event-opt" data-act="event" data-i="' + k + '"><b>' + o.label + '</b><small>' + o.desc + '</small></button>';
      });
      return '<div class="run-main"><div class="event"><h3>' + ev.title + '</h3><p>' + ev.text + '</p>' + h + '</div></div>';
    }
    return '<div class="run-main"><div class="event"><h3>' + p.title + '</h3><p>' + p.text + '</p>' +
      '<button class="btn btn-primary" data-act="leave">继续前进</button></div></div>';
  }

  function overHTML() {
    var relics = state.relics.map(function (id) { return Run.relicById(id).name; }).join('、') || '无';
    return '<div class="run-over"><div class="dialog wide">' +
      '<h3 style="color:' + (state.won ? '#ffb033' : '#ff5f5f') + '">' + (state.won ? '远征通关' : '远征失败') + '</h3>' +
      '<p class="over-line">' + (state.won ? '三个区域全部打穿。' : '倒在了「' + Run.ACTS[Math.min(state.act, 2)].name + '」第 ' + (state.step + 1) + ' 层。') + '</p>' +
      '<div class="result-body">' +
        '<div class="rrow"><span></span><span>打赢的战斗</span><span></span><span class="dmg">' + state.battles + ' 场</span></div>' +
        '<div class="rrow"><span></span><span>击破的 Boss</span><span></span><span class="dmg">' + state.bosses + ' 个</span></div>' +
        '<div class="rrow"><span></span><span>带着的遗物</span><span></span><span>' + relics + '</span></div>' +
        '<div class="rrow"><span></span><span>获得勋章</span><span></span><span class="dmg">+' + state.earned + '</span></div>' +
      '</div>' +
      (state.won && state.asc < Run.MAX_ASC ? '<p class="over-line">已开放进阶 ' + (state.asc + 1) + '。</p>' : '') +
      '<button class="btn btn-primary" data-act="home">回到营地</button></div></div>';
  }

  // ================= 重画 =================
  function render() {
    var root = $('run-root');
    if (!root) return;
    meta = Run.loadMeta();
    if (!state) state = Run.load();
    if (hub.asc > meta.asc) hub.asc = meta.asc;
    var html;
    if (!state) html = hubHTML();
    else if (state.over) html = overHTML();
    else html = '<div class="run-grid">' + sideHTML() + (state.pending ? pendingHTML() : choiceHTML()) + '</div>';
    root.innerHTML = html;
    $('run-purse').innerHTML = (state && !state.over ? '<b>' + state.gold + '</b> 金币　' : '') + '<b>' + meta.medals + '</b> 勋章';

    // 立绘占位换成真正的 canvas
    var spots = root.querySelectorAll('[data-portrait]');
    for (var i = 0; i < spots.length; i++) {
      var v = RZ.vehicleById(spots[i].getAttribute('data-portrait'));
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

    if (act === 'pick') hub.pick = id;
    else if (act === 'asc') hub.asc = i;
    else if (act === 'hard') hub.hardcore = i === 1;
    else if (act === 'unlock') Run.unlock(meta, hub.pick);
    else if (act === 'start') {
      state = Run.newRun(hub.pick, { asc: hub.asc, hardcore: hub.hardcore });
      Run.save(state);
    }
    else if (act === 'home') { state = null; }
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
      else if (from === 'reward') Run.takeReward(state, i);
      else Run.buy(state, i);
    }
    else if (act === 'slot') {
      var slot = t.getAttribute('data-slot');
      if (t.getAttribute('data-from') === 'reward') Run.takeReward(state, i, slot);
      else Run.buy(state, i, slot);
      slotPick = null;
    }
    else if (act === 'skip') { slotPick = null; Run.takeReward(state, -1); }
    else if (act === 'leave') { slotPick = null; Run.leave(state); }
    else if (act === 'rest') Run.rest(state, id);
    else if (act === 'event') Run.eventChoose(state, i);

    if (state && !state.over) Run.save(state);
    render();
  }

  window.addEventListener('DOMContentLoaded', function () {
    $('run-root').addEventListener('click', onClick);
  });

  RZ.RunUI = {
    render: render,
    // 自检页用：直接塞一个状态进来看界面
    _set: function (s) { state = s; render(); },
    _state: function () { return state; }
  };
})(window.RZ || (window.RZ = {}));

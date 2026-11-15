/* 燃烧战车 — 界面装配与主循环 */
(function (RZ) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var canvas, ctx, game = null, paused = false, raf = 0;
  var lastTurn = -1, lastWeaponSig = '';
  // 远征模式接管结算：打完把这一局交回去，而不是「再来一局」
  var battleHook = null;
  // 敌方回合加速（F 键 / 右上角「快」），记在本地，下次还在
  var fast = false;
  try { fast = window.localStorage.getItem('rz-fast') === '1'; } catch (e) { /* 隐私模式 */ }

  var setup = {
    mode: '1v1',
    rules: 'classic',
    difficulty: 'normal',
    guide: true,
    mapId: RZ.MAPS[0].id,
    picks: [RZ.VEHICLES[0].id, RZ.VEHICLES[1].id],
    pickSlot: 0,
    loadout: [['double', 'power', 'heal1', 'fuel1'], ['double', 'power', 'heal1', 'fuel1']]
  };

  // ================= 画面切换 =================
  function show(name) {
    var list = document.querySelectorAll('.screen');
    for (var i = 0; i < list.length; i++) list[i].classList.remove('active');
    $('screen-' + name).classList.add('active');
    if (name === 'game') resize();
    if (name === 'run' && RZ.RunUI) RZ.RunUI.render();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-go]') : null;
    if (!t) return;
    RZ.SFX.resume(); RZ.SFX.click();
    var to = t.getAttribute('data-go');
    if (to !== 'game') stopGame();
    show(to);
  });

  // ================= 出战准备 =================
  function buildMaps() {
    var box = $('map-list');
    box.innerHTML = '';
    RZ.MAPS.forEach(function (m) {
      var el = document.createElement('div');
      el.className = 'map-card' + (m.id === setup.mapId ? ' active' : '');
      // 缩成一枚小海报：三条天空色带 + 表层 + 地面，全是硬边
      var ps = (RZ.POSTER[m.id] || RZ.POSTER.dry).sky;
      el.style.background = 'linear-gradient(' + ps[0] + ' 0 30%,' + ps[1] + ' 30% 52%,' + ps[2] + ' 52% 66%,#1b1410 66% 70%,' +
        m.ground.top + ' 70% 82%,' + m.ground.body + ' 82%)';
      el.textContent = m.name;
      el.onclick = function () {
        setup.mapId = m.id;
        RZ.SFX.click();
        buildMaps();
      };
      box.appendChild(el);
    });
  }

  function portrait(v, w, h, scale) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.save();
    g.translate(w / 2, h - 6);
    g.scale(scale, scale);
    RZ.drawArt(g, v, 0);
    g.restore();
    return c;
  }

  function buildVehicles() {
    var grid = $('veh-grid');
    grid.innerHTML = '';
    RZ.VEHICLES.forEach(function (v) {
      var el = document.createElement('div');
      el.className = 'veh-card' + (v.id === setup.picks[setup.pickSlot] ? ' active' : '');
      el.appendChild(portrait(v, 100, 62, 0.82));
      var b = document.createElement('b'); b.textContent = v.name;
      var i = document.createElement('i'); i.textContent = v.tag;
      el.appendChild(b); el.appendChild(i);
      el.onclick = function () {
        setup.picks[setup.pickSlot] = v.id;
        RZ.SFX.click();
        buildVehicles();
        showDetail(v);
      };
      grid.appendChild(el);
    });
    showDetail(RZ.vehicleById(setup.picks[setup.pickSlot]));
    $('pick-title').textContent = setup.mode === 'hotseat'
      ? (setup.pickSlot === 0 ? '玩家一 选择战车' : '玩家二 选择战车')
      : '选择你的战车';
  }

  // 移动耗油越低越灵活，换算成 0~100 的分数好读一些
  function mobility(v) {
    var t = (0.16 - v.moveCost) / (0.16 - 0.06);
    return Math.round(Math.max(0, Math.min(1, t)) * 100);
  }

  function statRow(label, val, max) {
    return '<div class="stat"><span>' + label + '</span><div class="track"><i style="width:' +
      Math.round(Math.min(1, val / max) * 100) + '%"></i></div><em>' + val + '</em></div>';
  }

  function weaponRow(tag, w) {
    return '<div class="wpn"><u>' + tag + '</u><b>' + w.name +
      '</b><s>威力 ' + w.damage + (w.count > 1 ? '×' + w.count : '') +
      ' · 范围 ' + w.radius + ' · 耗油 ' + w.fuel + '</s></div>';
  }

  function detailHTML(v) {
    return '<div class="vd-top"><b>' + v.name + '</b><i>' + v.tag + '</i></div>' +
      '<p class="vd-desc">' + v.desc + '</p>' +
      '<div class="stat-rows">' +
        statRow('耐久', v.hp, 1000) + statRow('攻击', v.atk, 130) +
        statRow('防御', v.def, 130) + statRow('机动', mobility(v), 100) +
      '</div>' +
      '<div class="wpn-rows">' +
        weaponRow('武器一', v.w1) + weaponRow('武器二', v.w2) + weaponRow('必　杀', v.ss) +
      '</div>';
  }

  function showDetail(v) { $('veh-detail').innerHTML = detailHTML(v); }

  function buildCodex() {
    var box = $('codex-list');
    box.innerHTML = '';
    RZ.VEHICLES.forEach(function (v) {
      var el = document.createElement('div');
      el.className = 'panel';
      var head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;gap:14px;margin-bottom:6px';
      head.appendChild(portrait(v, 110, 68, 0.9));
      var d = document.createElement('div');
      d.innerHTML = detailHTML(v);
      el.appendChild(head);
      el.appendChild(d);
      box.appendChild(el);
    });
  }

  // ================= 道具选购 =================
  function currentLoadout() { return setup.loadout[setup.mode === 'hotseat' ? setup.pickSlot : 0]; }

  function buildShop() {
    var bag = currentLoadout();
    $('shop-count').textContent = bag.length + ' / ' + RZ.MAX_ITEMS;

    var slots = $('loadout');
    slots.innerHTML = '';
    for (var i = 0; i < RZ.MAX_ITEMS; i++) {
      var el = document.createElement('div');
      var def = bag[i] ? RZ.itemById(bag[i]) : null;
      el.className = 'lslot' + (def ? ' filled' : '');
      el.innerHTML = def
        ? '<span class="pip" style="background:' + def.color + '"></span>' + def.name
        : '空';
      if (def) {
        el.title = '点一下拿掉';
        el.onclick = (function (idx) {
          return function () { bag.splice(idx, 1); RZ.SFX.click(); buildShop(); };
        })(i);
      }
      slots.appendChild(el);
    }

    var box = $('shop');
    box.innerHTML = '';
    RZ.ITEMS.forEach(function (def) {
      var b = document.createElement('button');
      b.className = 'shop-item';
      b.disabled = bag.length >= RZ.MAX_ITEMS;
      b.title = def.desc;
      b.innerHTML = '<span class="pip" style="background:' + def.color + '"></span><b>' + def.name + '</b>';
      b.onmouseenter = function () { $('shop-hint').innerHTML = '<b>' + def.name + '</b>　' + def.desc; };
      b.onclick = function () {
        if (bag.length >= RZ.MAX_ITEMS) return;
        bag.push(def.id);
        RZ.SFX.click();
        buildShop();
      };
      box.appendChild(b);
    });
    if (!$('shop-hint')) {
      var hint = document.createElement('div');
      hint.className = 'shop-hint';
      hint.id = 'shop-hint';
      hint.textContent = '鼠标停在道具上看说明；栏位满了就点上面的格子拿掉一个。';
      box.parentNode.appendChild(hint);
    }
  }

  function chipGroup(id, key, cast) {
    var box = $(id);
    box.addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      var kids = box.querySelectorAll('.chip');
      for (var i = 0; i < kids.length; i++) kids[i].classList.remove('active');
      c.classList.add('active');
      setup[key] = cast(c.getAttribute('data-' + (key === 'difficulty' ? 'diff' : key)));
      RZ.SFX.click();
      if (key === 'mode') { setup.pickSlot = 0; buildVehicles(); buildShop(); }
    });
  }

  // ================= 组队 =================
  function pickRandomVehicle(exclude) {
    var pool = RZ.VEHICLES.filter(function (v) { return exclude.indexOf(v.id) < 0; });
    if (!pool.length) pool = RZ.VEHICLES;
    return pool[(Math.random() * pool.length) | 0];
  }

  function buildRoster() {
    var used = [], roster = [];
    function randomItems() {                      // 电脑随机带四个
      var bag = [];
      for (var i = 0; i < RZ.MAX_ITEMS; i++) bag.push(RZ.ITEMS[(Math.random() * RZ.ITEMS.length) | 0].id);
      return bag;
    }
    function add(vehicle, team, ai, items) {
      used.push(vehicle.id);
      var n = 0;
      roster.forEach(function (r) { if (r.vehicle.id === vehicle.id) n++; });
      roster.push({
        vehicle: vehicle, team: team, ai: ai,
        name: vehicle.name + (n ? '·' + (n + 1) : ''),
        items: items || randomItems()
      });
    }
    var mine = RZ.vehicleById(setup.picks[0]);
    if (setup.mode === '1v1') {
      add(mine, 0, false, setup.loadout[0].slice());
      add(pickRandomVehicle(used), 1, true);
    } else if (setup.mode === '2v2') {
      add(mine, 0, false, setup.loadout[0].slice());
      add(pickRandomVehicle(used), 1, true);
      add(pickRandomVehicle(used), 0, true);
      add(pickRandomVehicle(used), 1, true);
    } else {
      add(mine, 0, false, setup.loadout[0].slice());
      add(RZ.vehicleById(setup.picks[1]), 1, false, setup.loadout[1].slice());
    }
    return roster;
  }

  // ================= 开始 / 结束对局 =================
  function startGame() {
    battleHook = null;
    launch({
      mapId: setup.mapId,
      roster: buildRoster(),
      difficulty: setup.difficulty,
      guide: setup.guide,
      arcade: setup.rules === 'arcade',
      humanTeam: setup.mode === 'hotseat' ? null : 0
    });
  }

  function launch(opts) {
    RZ.SFX.resume();
    stopGame();
    game = new RZ.Game(opts);
    setup.guide = !!opts.guide;
    var inRun = !!battleHook;
    $('btn-restart').hidden = inRun;            // 远征里不能重打，输了就是输了
    $('btn-quit').textContent = inRun ? '放弃这场战斗' : '返回大厅';
    $('pause-note').textContent = inRun ? '放弃等于战败，这次远征会就此结束。' : '';
    $('btn-continue').hidden = !inRun;
    $('btn-again').hidden = inRun;
    $('btn-lobby').hidden = inRun;
    window.__game = game;                       // 调试/自检用的句柄
    game.viewW = canvas.clientWidth; game.viewH = canvas.clientHeight;
    game.cam.x = game.cam.tx = Math.max(0, game.active.x - game.viewW / 2);
    game.cam.y = game.cam.ty = Math.max(0, game.active.y - game.viewH / 2);
    lastTurn = -1; lastWeaponSig = ''; lastItemSig = ''; armedItem = -1;
    resetHUDCache();
    paused = false;
    $('overlay-pause').classList.remove('show');
    $('overlay-result').classList.remove('show');
    $('btn-guide').classList.toggle('on', setup.guide);
    $('btn-mute').classList.toggle('on', !RZ.SFX.isMuted());
    show('game');
    RZ.SFX.stinger();                           // 开战：咚、咚、锵
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function stopGame() {
    game = null;
    RZ.SFX.stopCharge();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  // ================= 输入 =================
  var keys = Object.create(null);

  window.addEventListener('keydown', function (e) {
    if ($('screen-game').classList.contains('active')) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar'].indexOf(e.key) >= 0) e.preventDefault();
    }
    var k = e.key;
    if (k === ' ' || k === 'Spacebar') k = 'Space';
    if (keys[k]) return;                        // 屏蔽系统按键重复
    keys[k] = true;
    onKeyDown(k);
  });

  window.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === ' ' || k === 'Spacebar') k = 'Space';
    keys[k] = false;
    onKeyUp(k);
  });

  window.addEventListener('blur', function () {
    for (var k in keys) keys[k] = false;
    if (!game) return;
    // 玩家的蓄力作废（松手事件收不到了）；电脑的蓄力不能动，否则它会僵住
    if (game.active && game.active.ai) RZ.SFX.stopCharge();
    else game.cancelCharge();
  });

  function onKeyDown(k) {
    RZ.SFX.resume();
    if (!game || !$('screen-game').classList.contains('active')) return;
    if (k === 'Escape') { togglePause(); return; }
    if (paused || game.result !== null) return;
    if (k === 'Space' && canControl()) game.startCharge();
    if (k === '1') game.setWeapon(0);
    if (k === '2') game.setWeapon(1);
    if (k === '3') game.setWeapon(2);
    if (k === 'Enter') { game.passTurn(); RZ.SFX.click(); }
    if (k === 'q' || k === 'Q') { if (game.nudgeMark(-1)) RZ.SFX.click(); }
    if (k === 'e' || k === 'E') { if (game.nudgeMark(1)) RZ.SFX.click(); }
    if (k === 'g' || k === 'G') toggleGuide();
    if (k === 'f' || k === 'F') toggleFast();
    if (k === 'm' || k === 'M') toggleMute();
  }

  function onKeyUp(k) {
    if (!game || paused || game.result !== null) return;
    if (k === 'Space' && canControl()) game.releaseCharge();
  }

  function canControl() {
    return game && game.active && !game.active.ai && game.phase === 'aim';
  }

  // 蓄力条：点 / 拖动标力度，滚轮微调。规则判断全在 game.setMark() 里（经典规则下它什么都不做）
  (function bindPowerBar() {
    var bar = $('power-bar'), dragging = false;
    function at(e) {
      var r = bar.getBoundingClientRect();
      if (!game || paused || !r.width) return;
      game.setMark((e.clientX - r.left) / r.width * 100);
    }
    bar.addEventListener('pointerdown', function (e) {
      if (e.button) return;                       // 只认左键 / 触摸
      e.preventDefault();
      dragging = true;
      if (bar.setPointerCapture) bar.setPointerCapture(e.pointerId);
      at(e); RZ.SFX.click();
    });
    bar.addEventListener('pointermove', function (e) { if (dragging) at(e); });
    var end = function () { dragging = false; };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    $('screen-game').addEventListener('wheel', function (e) {
      if (!game || paused) return;
      if (game.nudgeMark(e.deltaY < 0 ? 1 : -1)) e.preventDefault();
    }, { passive: false });
  })();

  // 触屏按钮映射到同一套虚拟按键
  (function bindTouch() {
    var box = $('touch');
    box.addEventListener('pointerdown', function (e) {
      var b = e.target.closest('.tbtn'); if (!b) return;
      e.preventDefault();
      var k = b.getAttribute('data-k');
      keys[k] = true; onKeyDown(k);
    });
    var up = function (e) {
      var b = e.target.closest ? e.target.closest('.tbtn') : null; if (!b) return;
      var k = b.getAttribute('data-k');
      keys[k] = false; onKeyUp(k);
    };
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
    box.addEventListener('pointerleave', up);
    if (matchMedia('(hover: none)').matches) document.body.classList.add('touch-mode');
  })();

  function toggleGuide() {
    setup.guide = !setup.guide;
    if (game) game.guide = setup.guide;
    $('btn-guide').classList.toggle('on', setup.guide);
    RZ.SFX.click();
  }
  function toggleMute() {
    RZ.SFX.setMuted(!RZ.SFX.isMuted());
    $('btn-mute').classList.toggle('on', !RZ.SFX.isMuted());
  }
  function togglePause() {
    if (!game || game.result !== null) return;
    paused = !paused;
    $('overlay-pause').classList.toggle('show', paused);

    if (paused) {
      RZ.SFX.stopCharge();          // 只掐掉声音，蓄力状态原样留着
      return;
    }
    RZ.SFX.resume();
    if (game.charging) {
      // 暂停期间玩家把空格松了，这一发就作废；还按着（或者是电脑）就接着蓄
      if (game.active && (game.active.ai || keys.Space)) RZ.SFX.startCharge();
      else game.cancelCharge();
    } else if (keys.Space && canControl()) {
      game.startCharge();           // 暂停时按下的空格，恢复后才开始生效
    }
  }

  // ================= HUD =================
  // 这一层每帧都会被调用，所以所有写入都先比对缓存：值没变就一个字节都不碰 DOM。
  // 之前是每帧无条件写 28 处（含两次 innerHTML 重建和一次风向仪重绘），
  // 叠上待命面板的 CSS filter 会让整块 HUD 每帧重新栅格化，直接拖垮帧率。
  var hudCache = Object.create(null);

  function resetHUDCache() { hudCache = Object.create(null); }

  function setText(id, val) {
    var k = 't' + id;
    if (hudCache[k] === val) return;
    hudCache[k] = val;
    $(id).textContent = val;
  }
  function setStyle(id, prop, val) {
    var k = 's' + id + prop;
    if (hudCache[k] === val) return;
    hudCache[k] = val;
    $(id).style[prop] = val;
  }
  function setHTML(id, val) {
    var k = 'h' + id;
    if (hudCache[k] === val) return;
    hudCache[k] = val;
    $(id).innerHTML = val;
  }
  function setClass(id, cls, on) {
    var k = 'c' + id + cls;
    if (hudCache[k] === on) return;
    hudCache[k] = on;
    $(id).classList.toggle(cls, on);
  }
  function setHidden(id, on) {
    var k = 'v' + id;
    if (hudCache[k] === on) return;
    hudCache[k] = on;
    $(id).hidden = on;
  }

  function updateHUD() {
    if (!game) return;
    var u = game.active, i;

    // 出手顺序刻意不画在界面上：谁先谁后、还剩几手，是玩家自己该记的东西。

    // 风力：一回合才变一次，没必要每帧重画表盘
    setText('wind-val', (game.wind > 0 ? '+' : '') + game.wind);
    if (hudCache.wind !== game.wind) {
      hudCache.wind = game.wind;
      drawWindDial(game.wind, game.map.windMax);
    }

    var tl = Math.max(0, Math.ceil(game.timeLeft));
    setText('timer', tl);
    setClass('timer', 'warn', tl <= 5 && game.phase === 'aim');

    // 显示什么由 game.hudState() 决定，这里只负责画上去
    var h = game.hudState();
    setClass('unit-card', 'standby', !h.live);
    setClass('panel-action', 'standby', !h.live && !h.pre);

    if (h.unit) {
      setText('uc-name', h.name);
      setText('uc-tag', h.tag);
      setStyle('bar-hp', 'width', h.hpPct + '%');
      setText('txt-hp', h.hp);
      setStyle('bar-fu', 'width', h.fuelPct + '%');
      setText('txt-fu', h.fuel);
      // 选中的武器要吃掉燃料条右端的这一截
      var costPct = Math.min(h.fuelPct, h.weaponFuel / h.maxFuel * 100);
      setStyle('bar-cost', 'left', (h.fuelPct - costPct) + '%');
      setStyle('bar-cost', 'width', costPct + '%');
      setText('txt-spent', h.spent);

      var sig = h.unit.index + '|' + h.weaponIdx + '|' + Math.round(h.fuel / 5) + '|' + (h.live ? 1 : h.pre ? 2 : 0);
      if (sig !== lastWeaponSig) { lastWeaponSig = sig; buildWeaponButtons(h.unit, h.live, h.pre); }

      setText('aim-val', h.aim);
      setText('pow-val', h.power);
      setStyle('power-fill', 'width', h.power + '%');

      // 道具栏
      var canUse = h.live && game.canUseItems(game.active);
      var itemSig = h.unit.index + '|' + h.unit.items.join(',') + '|' + armedItem + '|' + (canUse ? 1 : 0);
      if (itemSig !== lastItemSig) {
        lastItemSig = itemSig;
        buildItemBar({ unit: h.unit, canUse: canUse });
      }
      if (!canUse && armedItem >= 0) { armedItem = -1; $('item-tip').innerHTML = ''; }

      // 蓄力条上的刻度。爽快规则：粗线是标记（预览线就按它画），细线是上一发实际的力度；
      // 经典 / 硬核没有预览（h.mark 为 null），粗线仍然只是「上一发」。
      var marked = h.mark !== null && h.mark !== undefined;
      var at = marked ? h.mark : h.lastPower;
      setClass('power-bar', 'markable', marked && (h.live || h.pre));
      setHidden('power-mark', !(at > 0));
      if (at > 0) setStyle('power-mark', 'left', at + '%');
      var showLast = marked && h.lastPower > 0 && h.lastPower !== h.mark;
      setHidden('power-last', !showLast);
      if (showLast) setStyle('power-last', 'left', h.lastPower + '%');
      setText('pow-last', marked
        ? '　预览按 ' + h.mark + (showLast ? '　上次 ' + h.lastPower : '')
        : (h.lastPower > 0 ? '（上次 ' + h.lastPower + '）' : ''));
    }

    // 播报
    var tick = '';
    for (i = 0; i < game.messages.length; i++) {
      var msg = game.messages[i];
      // 透明度量化到 0.1，避免淡出期间每帧都重建这块 innerHTML
      var fade = Math.min(1, Math.round(msg.life / 40 * 10) / 10);
      tick += '<div style="color:' + msg.color + ';opacity:' + fade + '">' + msg.text + '</div>';
    }
    setHTML('ticker', tick);

    setText('hint', u && u.ai ? (h.pre ? '电脑的回合　可以先调 ↑ ↓ 角度、标力度、选武器' : '电脑正在瞄准…')
      : (h.live && !h.unit.canAfford(h.unit.vehicle.w1) ? '燃料不足　Enter 跳过本回合攒油'
        : '← → 移动　↑ ↓ 角度　空格 蓄力发射　Enter 跳过'));

    // 出手队列（经典规则下 h.queue 恒为 null，这块始终隐藏）
    setHidden('queue', !h.queue);
    if (h.queue) {
      var qh = '<i>出手顺序</i>';
      for (i = 0; i < h.queue.length; i++) {
        qh += '<span class="' + (i === 0 ? 'now' : '') + '" style="border-color:' +
          RZ.TEAM_COLORS[h.queue[i].team] + '">' + h.queue[i].name + '</span>';
      }
      setHTML('queue', qh);
    }

    if (game.turnNo !== lastTurn) {
      lastTurn = game.turnNo;
      armedItem = -1;
      $('item-tip').innerHTML = '';
      if (u) {
        var flash = $('turn-flash');
        flash.textContent = u.ai ? '敌方回合' : (game.opts.humanTeam == null ? RZ.TEAM_NAMES[u.team] + '回合' : '你的回合');
        flash.style.color = RZ.TEAM_COLORS[u.team];
        flash.classList.remove('go');
        void flash.offsetWidth;
        flash.classList.add('go');
      }
    }
  }

  function buildWeaponButtons(u, live, pre) {
    var v = u.vehicle;
    var defs = [
      { tag: '1 · 武器一', w: v.w1 },
      { tag: '2 · 武器二', w: v.w2 },
      { tag: '3 · 必杀', w: v.ss }
    ];
    var box = $('weapons');
    box.innerHTML = '';
    defs.forEach(function (d, i) {
      var b = document.createElement('button');
      var afford = u.canAfford(d.w);
      b.className = 'wbtn' + (u.weaponIdx === i ? ' active' : '') + (afford ? '' : ' locked');
      // 只写耗油：延迟、还能轮到谁，都归玩家自己盘算
      b.innerHTML = '<u>' + d.tag + '</u><b>' + d.w.name + '</b><s>耗油 ' + d.w.fuel + '</s>';
      // 电脑的回合里可以先选好武器；油够不够到自己回合再算（那时还会回油）
      b.disabled = pre ? false : (!live || !afford);
      b.onclick = function () { if (live || pre) game.setWeapon(i); };
      box.appendChild(b);
    });
  }

  // 点一次选中、再点一次才真的用掉——道具太贵重，不能手滑
  var armedItem = -1;
  var lastItemSig = '';

  function buildItemBar(h) {
    var u = h.unit;
    var bag = u ? u.items : [];
    var box = $('item-bar');
    box.innerHTML = '';
    for (var i = 0; i < RZ.MAX_ITEMS; i++) {
      var def = bag[i] ? RZ.itemById(bag[i]) : null;
      var b = document.createElement('button');
      if (!def) {
        b.className = 'islot empty';
        b.innerHTML = '<i>空</i>';
        box.appendChild(b);
        continue;
      }
      b.className = 'islot' + (armedItem === i ? ' armed' : '');
      b.disabled = !h.canUse;
      b.innerHTML = '<span class="pip" style="background:' + def.color + '"></span>' +
        '<b>' + def.short + '</b><i>' + (i + 1) + '</i>';
      b.onclick = (function (idx, d) {
        return function () {
          if (!game || !game.canUseItems(game.active)) return;
          if (armedItem !== idx) {                  // 第一下：选中并给出说明
            armedItem = idx;
            RZ.SFX.aim();
            $('item-tip').innerHTML = '<b>' + d.name + '</b>　' + d.desc +
              (d.endsTurn ? '　<b>（用完立刻结束回合）</b>' : '');
          } else {                                  // 第二下：确认使用
            armedItem = -1;
            $('item-tip').innerHTML = '';
            game.useItem(idx);
          }
          lastItemSig = '';                          // 强制重画
        };
      })(i, def);
      box.appendChild(b);
    }
  }

  var windCtx = null;
  function drawWindDial(wind, max) {
    if (!windCtx) windCtx = $('wind-dial').getContext('2d');
    var g = windCtx, s = 112, c = s / 2;
    g.clearRect(0, 0, s, s);
    g.save();
    g.translate(c, c);
    drawDialFace(g, wind, max);
    g.restore();
    return;
    // 底盘：地图背景可能很亮，仪表需要自己的暗底
    g.fillStyle = 'rgba(10,13,18,0.72)';
    g.beginPath(); g.arc(0, 0, 50, 0, 6.2832); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, 50, 0, 6.2832); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, 44, 0, 6.2832); g.stroke();
    // 刻度
    for (var i = 0; i < 24; i++) {
      var a = i / 24 * 6.2832;
      var long = i % 6 === 0;
      g.strokeStyle = long ? 'rgba(255,176,51,0.55)' : 'rgba(255,255,255,0.14)';
      g.beginPath();
      g.moveTo(Math.cos(a) * 44, Math.sin(a) * 44);
      g.lineTo(Math.cos(a) * (long ? 34 : 39), Math.sin(a) * (long ? 34 : 39));
      g.stroke();
    }
    // 风向箭头：向右为正
    var ratio = Math.min(1, Math.abs(wind) / Math.max(1, max));
    var dir = wind >= 0 ? 1 : -1;
    var len = 12 + ratio * 26;
    g.strokeStyle = ratio > 0.66 ? '#ff6a1f' : ratio > 0.33 ? '#ffb033' : '#8fd0ff';
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-dir * len * 0.5, 34); g.lineTo(dir * len * 0.5, 34); g.stroke();
    g.beginPath();
    g.moveTo(dir * (len * 0.5 + 9), 34);
    g.lineTo(dir * len * 0.5, 29);
    g.lineTo(dir * len * 0.5, 39);
    g.closePath(); g.fill();
    g.restore();
  }

  /** 风向仪的表盘：纸色圆牌、墨线刻度、一支朱红的箭 */
  function drawDialFace(g, wind, max) {
    var INK = RZ.INK, PAPER = RZ.PAPER, i;
    g.lineJoin = 'round';
    g.fillStyle = INK; g.beginPath(); g.arc(4, 4, 48, 0, 6.2832); g.fill();          // 墨影
    g.fillStyle = PAPER; g.beginPath(); g.arc(0, 0, 48, 0, 6.2832); g.fill();
    g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
    g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, 42, 0, 6.2832); g.stroke();
    for (i = 0; i < 24; i++) {
      var a = i / 24 * 6.2832, long = i % 6 === 0;
      g.lineWidth = long ? 3 : 1.5;
      g.beginPath();
      g.moveTo(Math.cos(a) * 42, Math.sin(a) * 42);
      g.lineTo(Math.cos(a) * (long ? 34 : 38), Math.sin(a) * (long ? 34 : 38));
      g.stroke();
    }
    // 风向箭头：向右为正，越长风越大
    var ratio = Math.min(1, Math.abs(wind) / Math.max(1, max));
    var dir = wind >= 0 ? 1 : -1, len = 10 + ratio * 24, y = 26;
    if (wind === 0) return;
    g.beginPath();
    g.moveTo(-dir * len * 0.5, y - 3); g.lineTo(dir * len * 0.5, y - 3);
    g.lineTo(dir * len * 0.5, y - 8); g.lineTo(dir * (len * 0.5 + 11), y);
    g.lineTo(dir * len * 0.5, y + 8); g.lineTo(dir * len * 0.5, y + 3);
    g.lineTo(-dir * len * 0.5, y + 3); g.closePath();
    g.fillStyle = ratio > 0.66 ? '#d8361f' : ratio > 0.33 ? '#f5b921' : '#1f8f89';
    g.fill(); g.lineWidth = 2.5; g.stroke();
  }

  /**
   * 标题画面的主图：三辆战车一字排开，中间那辆正在开炮。
   * 用的就是战场上那套造型函数，所以战车改了造型这里自动跟着变。
   */
  function drawTitleArt(t) {
    var cv = $('title-art');
    if (!cv || !cv.getContext) return;
    var g = cv.getContext('2d'), W = 760, H = 230;
    if (!g || !g.setTransform) return;
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, W, H);
    g.lineJoin = 'round';
    var ground = 196;
    // 身后升起来的大太阳
    g.beginPath(); g.arc(W / 2, ground, 150, Math.PI, 0); g.closePath();
    g.fillStyle = '#f5b921'; g.fill(); g.lineWidth = 5; g.strokeStyle = RZ.INK; g.stroke();
    g.beginPath(); g.arc(W / 2, ground, 112, Math.PI, 0); g.lineWidth = 3; g.stroke();
    // 地面：一条纸色带，压一道粗墨线
    g.fillStyle = RZ.PAPER; g.fillRect(30, ground, W - 60, 22);
    g.lineWidth = 5; g.strokeRect(30, ground, W - 60, 22);
    g.fillStyle = RZ.INK;
    for (var x = 44; x < W - 40; x += 14) { g.beginPath(); g.arc(x, ground + 11, 2.2, 0, 6.2832); g.fill(); }

    var cast = [
      { id: 'honglong', x: 150, s: 2.5, face: 1, aim: 40 },
      { id: 'tiejingang', x: 612, s: 2.5, face: -1, aim: 46 },
      { id: 'liehuo', x: 372, s: 3.7, face: 1, aim: 34 }
    ];
    cast.forEach(function (c) {
      g.save();
      g.translate(c.x, ground);
      g.scale(c.s * c.face, c.s);
      g.lineWidth = 2.5;
      RZ.drawArt(g, RZ.vehicleById(c.id), t, c.aim);
      g.restore();
    });
    // 中间那辆的炮口：一颗爆炸星，一明一灭
    var big = 30 + 7 * Math.sin(t * 0.012);
    var ma = 34 * Math.PI / 180, md = 3.7 * 40;
    RZ.drawStar(g, 372 + Math.cos(ma) * md, ground - 3.7 * 24 - Math.sin(ma) * md, big, big * 0.5, 9, t * 0.0015, '#f1e2bd', 4);
    RZ.drawStar(g, 372 + Math.cos(ma) * md, ground - 3.7 * 24 - Math.sin(ma) * md, big * 0.55, big * 0.3, 7, -t * 0.002, '#d8361f', 3);
  }

  function toggleFast() {
    fast = !fast;
    $('btn-fast').classList.toggle('on', fast);
    try { window.localStorage.setItem('rz-fast', fast ? '1' : '0'); } catch (e) { /* 存不了就只管这一局 */ }
    RZ.SFX.click();
  }

  // ================= 结算 =================
  function showResult() {
    var tally = {};
    game.log.forEach(function (e) { tally[e.by] = (tally[e.by] || 0) + e.dmg; });
    var human = game.opts.humanTeam;
    var title = $('result-title');
    if (game.result === -1) { title.textContent = '同归于尽'; title.style.color = '#e2cd9c'; }
    else if (human == null) { title.textContent = RZ.TEAM_NAMES[game.result] + '获胜'; title.style.color = RZ.TEAM_COLORS[game.result]; }
    else if (game.result === human) { title.textContent = '胜　利'; title.style.color = '#f5b921'; }
    else { title.textContent = '战　败'; title.style.color = '#d8361f'; }

    var body = '';
    game.units.forEach(function (u) {
      body += '<div class="rrow' + (u.alive ? '' : ' out') + '">' +
        '<span class="dot" style="background:' + RZ.TEAM_COLORS[u.team] + '"></span>' +
        '<span>' + u.name + '<b class="dim" style="font-weight:400">　' + u.vehicle.tag + '</b></span>' +
        '<span class="dim">剩余 ' + Math.max(0, Math.round(u.hp)) + '</span>' +
        '<span class="dmg">输出 ' + Math.round(tally[u.index] || 0) + '</span>' +
        '</div>';
    });
    if (battleHook && game.style.gold > 0 && game.result === human) {
      body += '<div class="rrow bonus"><span></span><span>花式赏金</span><span></span>' +
        '<span class="dmg">+' + game.style.gold + ' 金</span></div>';
    }
    $('result-body').innerHTML = body;
    $('overlay-result').classList.add('show');
  }

  // ================= 主循环 =================
  var last = 0;
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    var dt = last ? Math.min(50, ts - last) : 16;
    last = ts;
    if (!game || !$('screen-game').classList.contains('active')) return;

    if (!paused && game.result === null) {
      game.applyHeld(keys);
      game.update(dt);
      // 敌方回合加速：轮到电脑时（包括它的炮弹飞行和结算）一帧多推进两步
      if (fast && game.active && game.active.ai) {
        for (var k = 0; k < 2 && game.result === null && game.active && game.active.ai; k++) game.update(dt);
      }
    }

    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    game.draw(ctx, w, h);
    updateHUD();

    if (game.result != null && !$('overlay-result').classList.contains('show')) {
      if (game.projectiles.length === 0) showResult();
    }
  }

  function resize() {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    if (game) { game.viewW = canvas.clientWidth; game.viewH = canvas.clientHeight; }
  }
  window.addEventListener('resize', resize);

  /** 远征的一场打完（或中途放弃）：把这局交还给远征界面 */
  function finishBattle() {
    var hook = battleHook, g = game;
    battleHook = null;
    stopGame();
    $('overlay-pause').classList.remove('show');
    $('overlay-result').classList.remove('show');
    if (hook) hook(g);
  }

  // 给远征界面（runui.js）用的出口
  RZ.App = {
    show: show,
    portrait: portrait,
    detailHTML: detailHTML,
    startBattle: function (opts, hook) { battleHook = hook; launch(opts); }
  };

  // ================= 启动 =================
  window.addEventListener('DOMContentLoaded', function () {
    canvas = $('stage');
    ctx = canvas.getContext('2d');
    $('ver').textContent = 'v' + RZ.VERSION;
    // 标题主图：只在标题画面显示着的时候动（排气口的火苗、炮口的星）
    drawTitleArt(0);
    if (typeof setInterval === 'function') {          // 无头测试的沙箱里没有定时器
      setInterval(function () {
        if ($('screen-title').classList.contains('active')) drawTitleArt(Date.now() % 1e7);
      }, 90);
    }
    if (document.fonts && document.fonts.load) document.fonts.load('20px "RZ Display"');   // 让画布上的字尽早用上美术字
    buildMaps();
    buildVehicles();
    buildShop();
    buildCodex();
    chipGroup('mode-chips', 'mode', String);
    chipGroup('rules-chips', 'rules', String);
    chipGroup('diff-chips', 'difficulty', String);
    chipGroup('guide-chips', 'guide', function (v) { return v === '1'; });

    $('btn-start').onclick = function () {
      if (setup.mode === 'hotseat' && setup.pickSlot === 0) {
        setup.pickSlot = 1;
        buildVehicles();
        buildShop();
        $('btn-start').textContent = '进入战场';
        RZ.SFX.click();
        return;
      }
      setup.pickSlot = 0;
      startGame();
    };
    $('btn-resume').onclick = togglePause;
    $('btn-restart').onclick = startGame;
    $('btn-quit').onclick = function () {
      if (battleHook && game) { game.result = 1; finishBattle(); return; }
      stopGame(); show('title');
    };
    $('btn-continue').onclick = finishBattle;
    $('btn-again').onclick = startGame;
    $('btn-lobby').onclick = function () { stopGame(); show('title'); };
    $('btn-pause').onclick = togglePause;
    $('btn-fast').onclick = toggleFast;
    $('btn-fast').classList.toggle('on', fast);
    $('btn-guide').onclick = toggleGuide;
    $('btn-mute').onclick = toggleMute;
    $('btn-mute').classList.add('on');
    resize();
  });
})(window.RZ || (window.RZ = {}));

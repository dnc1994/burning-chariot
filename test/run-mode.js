/* 远征模式与爽快规则的回归测试。由 test/run.js 末尾调用，也可以单独跑：
 *   node test/run-mode.js
 * 经典规则的不变量仍由 run.js 前面那些节负责；这里只管新加的东西，
 * 以及「新东西没有漏进经典规则」。
 */
const { loadRZ, flatten } = require('./harness');

module.exports = function runModeTests(RZ, check, head) {
  const Run = RZ.Run;
  const V = (id) => RZ.vehicleById(id);
  const mk = (extra, a, b) => new RZ.Game(Object.assign({
    mapId: 'dry', difficulty: 'normal', guide: true, humanTeam: 0,
    roster: [
      Object.assign({ vehicle: V('liehuo'), team: 0, ai: false, name: '烈火' }, a || {}),
      Object.assign({ vehicle: V('honglong'), team: 1, ai: true, name: '红龙' }, b || {})
    ]
  }, extra || {}));
  /** 平地、无风、无油桶、两车摆好位置的爽快对局 */
  const arena = (a, b, gap) => {
    const g = mk({ arcade: true, barrels: 0 }, a, b);
    const floor = flatten(g);
    g.wind = 0;
    g.units[0].x = 500; g.units[1].x = 500 + (gap || 600);
    g.units.forEach((u) => { u.y = floor; u.airborne = false; u.vy = 0; });
    return g;
  };
  const settle = (g, n) => { for (let i = 0; i < (n || 400); i++) g.update(16); };

  // ---------- 版本号 ----------
  head('版本号');
  {
    const log = require('fs').readFileSync(require('path').join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
    check(/^\d+\.\d+\.\d+$/.test(RZ.VERSION), 'RZ.VERSION 是 x.y.z 的形式', RZ.VERSION);
    check(log.indexOf('## v' + RZ.VERSION) >= 0, 'CHANGELOG.md 里有当前版本的小节');
  }

  // ---------- 经典规则没被污染 ----------
  head('爽快规则没有漏进经典规则');
  {
    const g = mk();
    check(g.arc === null, '不传 arcade 就是经典规则');
    check(g.units[0].fuel === RZ.START_FUEL, '经典开局油量不变', `=${g.units[0].fuel}`);
    check(g.props.length === 0, '经典规则没有油桶');
    check(g.previewPath() === null, '经典规则没有弹道预览');
    check(g.hudState().queue === null, '经典规则不给出手队列');
    {
      // 经典的蓄力手感不变：满条约 2 秒，途中不在任何地方停顿
      const c = mk(); c.units[0].lastPower = 40; c.startCharge();
      for (let i = 0; i < 60; i++) c.update(16);
      check(Math.abs(c.units[0].power - 48) < 0.01, '经典蓄力速度不变、经过上一发的刻度也不停', `60 帧 → ${c.units[0].power.toFixed(1)}`);
    }
    const x0 = g.units[1].x;
    flatten(g); g.units[1].y = 600;
    g.explode(g.units[1].x - 20, 590, V('liehuo').w1, g.units[0], null, 1);
    settle(g, 120);
    check(g.units[1].x === x0, '经典规则爆炸不会横向击飞');
  }

  // ---------- 带小数的爆炸半径也要能挖坑 ----------
  head('地形：任何半径都挖得动');
  {
    const solid = (t) => { let n = 0; for (let i = 0; i < t.mask.length; i++) n += t.mask[i]; return n; };
    const g = arena();
    const y = g.terrain.groundBelow(900, 0), n0 = solid(g.terrain);
    g.terrain.carve(900, y, 52.8);
    const dug = n0 - solid(g.terrain);
    check(dug > 3000, '半径带小数（52.8）照样挖出坑', `挖掉 ${dug} 像素`);
    // 每辆车的每把武器，配上「爆破专家」的 +15%，都得真的把地炸掉
    const dead = [];
    RZ.VEHICLES.forEach((v) => ['w1', 'w2', 'ss'].forEach((k) => {
      const a = arena(null, null, 1200);
      a.units[0].perks = { blast: 0.15 };
      const gy = a.terrain.groundBelow(900, 0), b0 = solid(a.terrain);
      a.explode(900, gy, v[k], a.units[0], null, 1);
      if (b0 - solid(a.terrain) < 300) dead.push(v[k].name);
    }));
    check(dead.length === 0, '三十把武器 + 爆破专家：每一把都炸得动地', dead.join('、') || '全部通过');
  }

  // ---------- 节奏 ----------
  head('爽快规则：节奏');
  {
    const g = mk({ arcade: true });
    check(g.units[0].fuel === RZ.ARCADE.startFuel, '开局 60 油', `=${g.units[0].fuel}`);
    check(g.props.length > 0, '场上有油桶', `${g.props.length} 个`);
    const u = g.units[0];
    u.spentThisTurn = 9;
    const classic = mk();
    classic.units[0].spentThisTurn = 9;
    check(g.refuel(u) > classic.refuel(classic.units[0]), '回油比经典快');
    const q = g.hudState().queue;
    check(Array.isArray(q) && q.length === 2 && q[0].name === g.active.name, '给出手队列，当前行动者排第一');
    check(mk({ arcade: true, hardcore: true }).hudState().queue === null, '硬核开关关掉出手队列');
  }
  {
    let turns = 0, n = 0;
    for (const m of RZ.MAPS) {
      const g = new RZ.Game({
        mapId: m.id, difficulty: 'normal', arcade: true, humanTeam: null,
        roster: [{ vehicle: V('liehuo'), team: 0, ai: true, name: 'A' }, { vehicle: V('aodin'), team: 1, ai: true, name: 'B' }]
      });
      let f = 0;
      while (g.result === null && f < 60 * 60 * 12) { g.update(16); f++; }
      check(g.result !== null, `${m.name} 爽快规则能打完`, `回合=${g.turnNo} 轮=${g.round}`);
      turns += g.turnNo; n++;
    }
    check(turns / n < 30, '平均回合数明显短于经典', `均值 ${(turns / n).toFixed(1)}`);
  }
  {
    // 两辆车都不开火：过热必须把对局烧完
    const g = arena({ ai: false }, { ai: false });
    g.opts.humanTeam = null;
    let f = 0;
    while (g.result === null && f < 200000) { if (g.phase === 'aim') g.passTurn(); g.update(16); f++; }
    check(g.result !== null, '谁都不开火也会被「过热」烧出胜负', `轮=${g.round}`);
  }

  // ---------- 击飞 ----------
  head('爽快规则：击飞');
  {
    const g = arena();
    const foe = g.units[1], x0 = foe.x;
    g.explode(foe.x - 22, foe.y - 14, V('liehuo').w1, g.units[0], null, 1);
    settle(g, 200);
    check(foe.x > x0 + 15, '爆炸把车往远离爆心的方向掀出去', `位移 ${Math.round(foe.x - x0)}px`);
    check(!foe.airborne && foe.vx === 0, '落地后停稳');

    const g2 = arena(null, { perks: { anchor: 1 } });
    const f2 = g2.units[1], x2 = f2.x;
    g2.explode(f2.x - 22, f2.y - 14, V('liehuo').w1, g2.units[0], null, 1);
    settle(g2, 200);
    check(f2.x === x2, '磁力底盘不会被击飞');
  }
  {
    // 天空之城：把人掀出浮岛算击杀，还有赏金
    const g = mk({ arcade: true, barrels: 0, mapId: 'sky' });
    const foe = g.units[1];
    foe.x = 300; foe.y = RZ.WORLD_H + 80; foe.airborne = true; foe.vy = 2; foe.lastHitBy = g.units[0];
    settle(g, 30);
    check(!foe.alive, '掉出地图即出局');
    check(g.style.tags['ringout@' + g.turnNo] && g.style.gold >= 15, '击飞出界有赏金', `金=${g.style.gold}`);
  }
  {
    const g = mk({ arcade: true, barrels: 0, mapId: 'sky' }, { perks: { rescue: 1 } });
    const me = g.units[0], hp0 = me.hp;
    me.safeX = me.x;
    me.y = RZ.WORLD_H + 80; me.airborne = true; me.vy = 2;
    settle(g, 300);
    check(me.alive && me.y < RZ.WORLD_H, '牵引回收：掉出地图被拖回来');
    check(Math.abs((hp0 - me.hp) - Math.round(me.maxHp * 0.2)) < 1, '回收扣两成耐久', `${hp0}→${Math.round(me.hp)}`);
    const l = g.terrain.groundBelow(me.x - 26, 0), r = g.terrain.groundBelow(me.x + 26, 0);
    check(Math.abs(l - me.y) < 60 && Math.abs(r - me.y) < 60, '拖回来的落点左右都有地，不是一根尖');
    me.y = RZ.WORLD_H + 80; me.airborne = true; me.vy = 2;
    settle(g, 300);
    check(me.alive && me.y < RZ.WORLD_H, '再掉一次照样拖回来：不限次数');
    me.hp = me.maxHp * 0.1;
    me.y = RZ.WORLD_H + 80; me.airborne = true; me.vy = 2;
    settle(g, 300);
    check(!me.alive, '耐久不够扣了，掉下去才出局');
    const c = mk({ barrels: 0, mapId: 'sky' }, { perks: { rescue: 1 } });
    c.units[0].y = RZ.WORLD_H + 80; c.units[0].airborne = true; c.units[0].vy = 2;
    settle(c, 60);
    check(!c.units[0].alive, '经典规则没有牵引回收');
  }

  // ---------- 油桶 ----------
  head('爽快规则：油桶');
  {
    const g = arena();
    const foe = g.units[1], hp0 = foe.hp;
    g.props.push({ x: foe.x - 40, y: foe.y, vy: 0, lit: false });
    g.props.push({ x: foe.x - 130, y: foe.y, vy: 0, lit: false });
    g.props.push({ x: foe.x - 220, y: foe.y, vy: 0, lit: false });
    g.explode(foe.x - 270, foe.y - 6, V('liehuo').w1, g.units[0], null, 1);   // 只够得着最远那个桶
    check(foe.hp === hp0, '第一下爆炸本身打不到人');
    settle(g, 120);
    check(g.props.length === 0, '三个油桶连锁炸光');
    check(foe.hp < hp0, '连锁到最后炸到了人', `-${Math.round(hp0 - foe.hp)}`);
    check(foe.dots.some((d) => d.type === 'fire'), '油桶会点燃目标');
  }
  {
    const g = arena(null, null, 700);
    const me = g.units[0];
    g.props.push({ x: 800, y: me.y, vy: 0, lit: false });
    // 一颗贴着地面平飞的炮弹，路上正好有个油桶
    const p = RZ.launch(me, me.vehicle.w1, 0, 60, g.map.gravity)[0];
    p.x = 760; p.y = me.y - 12; p.vx = 6; p.vy = 0; p.dmgMul = 1;
    g.projectiles.push(p); g.phase = 'fly';
    settle(g, 200);
    check(g.props.length === 0, '炮弹直接撞上油桶会引爆');
  }

  // ---------- 弹道预览 ----------
  head('爽快规则：弹道预览');
  {
    const g = arena();
    g.units[0].aim = 45; g.units[0].lastPower = 70;
    const half = g.previewPath();
    check(half && half.length >= 8, '默认给一段预览', `${half ? half.length / 2 : 0} 点`);
    g.units[0].perks = { scope: 1 };
    const full = g.previewPath();
    check(full.length > half.length * 1.8, '激光测距仪给全程', `${half.length / 2} → ${full.length / 2}`);
    check(Math.abs(full[full.length - 1] - 600) < 30, '全程预览的终点就是落点（平地）');
    g.guide = false;
    check(g.previewPath() === null, '按 G 可以关掉');
    g.guide = true; g.hardcore = true;
    check(g.previewPath() === null, '硬核开关关掉预览');
  }

  // ---------- 力度标记 ----------
  head('爽快规则：力度标记');
  {
    const g = arena();
    const u = g.units[0];
    u.aim = 50; u.perks = { scope: 1 };
    check(g.hudState().mark === 55, '没打过也没标过时，预览按默认力度画，并且界面上写明', `${g.hudState().mark}`);
    check(g.setMark(62.4) && u.markPower === 62 && g.hudState().mark === 62, '点蓄力条标出力度');
    g.nudgeMark(1); g.nudgeMark(1); g.nudgeMark(-1);
    check(u.markPower === 63, 'Q / E 一次挪 1 点', `${u.markPower}`);
    g.setMark(62);
    const line = g.previewPath();
    u.markPower = 80;
    const far = g.previewPath();
    check(far[far.length - 2] - line[line.length - 2] > 100, '标记不同，预览线跟着变');
    u.markPower = 62;

    // 蓄力：匀速走过标记，不停顿不吸附；正好在标记上松手，打出去的就是标记值
    g.startCharge();
    const seen = [];
    for (let i = 0; i < 70; i++) { g.update(16); seen.push(u.power); }
    const steps = seen.slice(1).map((v, i) => v - seen[i]);
    check(seen[69] > 62 && Math.max(...steps) - Math.min(...steps) < 1e-9, '蓄力条匀速走过标记，不停顿不吸附', `70 帧 → ${seen[69]}`);
    const during = g.previewPath();
    check(during.length === line.length && during[during.length - 2] === line[line.length - 2], '蓄力过程中预览线不动');
    g.cancelCharge();
    g.startCharge();
    while (u.power < 62) g.update(16);
    g.releaseCharge();
    const shot = g.projectiles[0];
    check(u.lastPower === 62, '在标记上松手，打出去的正是标记的力度', `${u.lastPower}`);
    // 预览跑的是同一套物理：实际弹道逐点重合
    let worst = 0;
    const env = { terrain: g.terrain, gravity: g.map.gravity, wind: g.wind, recordTrail: false, spawn: [], units: g.units };
    for (let i = 0; i < line.length / 2; i++) {
      const ev = RZ.step(shot, env);
      worst = Math.max(worst, Math.abs(shot.x - line[i * 2]) + Math.abs(shot.y - line[i * 2 + 1]));
      if (ev && ev.type !== 'bounce') break;
    }
    check(worst < 0.001, '实际弹道和预览线完全重合', `最大偏差 ${worst.toFixed(4)}px`);
  }
  {
    // 不在标记上松手照样能打；越过标记继续涨
    const g = arena();
    const u = g.units[0];
    g.setMark(30);
    g.startCharge();
    for (let i = 0; i < 80; i++) g.update(16);
    check(u.power > 50, '越过标记继续往上蓄', `${u.power}`);
    g.cancelCharge();
    check(u.markPower === 30, '标记留着，下一发还在');
    g.startCharge();
    check(g.setMark(70) === false, '蓄力中不能改标记');
    g.cancelCharge();
    g.hardcore = true;
    check(g.hudState().mark === null && g.setMark(40) === false, '硬核下没有标记');
  }
  {
    const g = mk();
    check(g.hudState().mark === null && g.setMark(40) === false && g.units[0].markPower === 0, '经典规则没有力度标记');
  }

  // ---------- WASD 挪镜头 ----------
  head('镜头：WASD 看别处');
  for (const arcade of [true, false]) {
    const g = mk({ arcade, barrels: 0 });
    const tag = arcade ? '爽快' : '经典';
    g.viewW = 1100; g.viewH = 620;
    g.units[0].x = 300; g.active = g.units[0]; g.phase = 'aim';
    for (let i = 0; i < 80; i++) g.updateCamera();
    const home = g.cam.x, x0 = g.units[0].x, fuel0 = g.units[0].fuel;
    for (let i = 0; i < 40; i++) { g.applyHeld({ KeyD: true }); g.updateCamera(); }
    check(g.cam.x > home + 300 && g.units[0].x === x0 && g.units[0].fuel === fuel0, `${tag}：按 D 镜头往右走，车不动、不花油`, `${Math.round(home)} → ${Math.round(g.cam.x)}`);
    const there = g.cam.tx;                            // 镜头有缓动，松手后还会滑到目标位置
    for (let i = 0; i < 120; i++) g.updateCamera();
    check(Math.abs(g.cam.x - there) < 2 && g.cam.x > home + 300, `${tag}：松手后镜头停在挪到的地方，不弹回去`, `${Math.round(g.cam.x)}`);
    for (let i = 0; i < 400; i++) { g.applyHeld({ d: true }); g.updateCamera(); }
    check(g.cam.x <= RZ.WORLD_W - g.viewW + 1, `${tag}：挪不出地图`);
    g.applyHeld({ ArrowLeft: true });
    for (let i = 0; i < 120; i++) g.updateCamera();
    check(Math.abs(g.cam.x - home) < 60, `${tag}：自己一移动，镜头就跟回来`, `${Math.round(g.cam.x)}`);
    g.applyHeld({ KeyD: true }); g.applyHeld({ KeyD: true });
    g.active = g.units[1];
    g.updateCamera();
    check(g.cam.free === false, `${tag}：换人出手，镜头不再停留`);
    g.applyHeld({ KeyA: true }); g.updateCamera();
    check(g.cam.free === true, `${tag}：电脑的回合里也能挪镜头`);
  }

  // ---------- 电脑回合里预先调整 ----------
  head('爽快规则：电脑行动时可以先摆好角度 / 标记 / 武器');
  {
    const g = arena();
    const me = g.units[0], foe = g.units[1];
    me.aim = 40; me.fuel = 30; me.weaponIdx = 0;
    g.active = foe; g.phase = 'aim';
    check(g.preUnit() === me && g.hudState().pre === true && g.hudState().live === false, '轮到电脑时，面板仍是自己的车，并标明可以预调');
    const x0 = me.x, foeAim = foe.aim, foeW = foe.weaponIdx;
    g.applyHeld({ ArrowUp: true, ArrowLeft: true });
    check(me.aim === 41 && me.x === x0, '能调角度，但不能移动', `角度 ${me.aim}`);
    check(g.setMark(73) && me.markPower === 73 && g.nudgeMark(-1) && me.markPower === 72, '能标力度、能微调');
    g.setWeapon(2);
    check(me.weaponIdx === 2, '能先选好武器（这时不查油量）');
    check(foe.aim === foeAim && foe.weaponIdx === foeW && !foe.markPower, '动的是自己的车，不是电脑的');
    const line = g.previewPath();
    check(line && Math.abs(line[0] - me.x) < 80, '动过之后预览线亮起来，画的是自己那条');
    for (let i = 0; i < 200; i++) { if (g.preShow > 0) g.preShow--; }
    check(g.previewPath() === null, '过一会儿预览线自己收起来');
    g.charging = true;                                 // 电脑正在蓄力
    check(g.setMark(60) && me.markPower === 60, '电脑蓄力时照样能标');
    g.charging = false;
    const f0 = me.fuel;
    check(me.fuel === f0 && !me.firedThisTurn, '不花油、不开火');
    g.hardcore = true;
    g.adjustAim(1);
    check(me.aim === 42 && g.setMark(50) === false, '硬核下仍能预调角度和武器，但没有标记');
  }
  {
    const g = mk();
    const me = g.units[0];
    g.active = g.units[1]; g.phase = 'aim';
    const a0 = me.aim;
    g.applyHeld({ ArrowUp: true }); g.setWeapon(1);
    check(g.preUnit() === null && me.aim === a0 && me.weaponIdx === 0 && !g.hudState().pre, '经典规则：电脑回合里什么都动不了');
  }

  // ---------- 遗物 ----------
  head('遗物效果');
  {
    const base = arena(); const armored = arena(null, { perks: { armor: 0.2 } });
    base.damage(base.units[1], 100, base.units[0]);
    armored.damage(armored.units[1], 100, armored.units[0]);
    check(base.units[1].hp === 780 - 100 && armored.units[1].hp === 780 - 80, '反应装甲按比例减伤');
  }
  {
    const g = arena(null, { perks: { thorns: 0.3 } });
    const me = g.units[0], hp0 = me.hp;
    g.damage(g.units[1], 100, me);
    check(me.hp === hp0 - 30, '荆棘电网反弹 30%');
  }
  {
    const g = arena({ perks: { siphon: 5, vamp: 0.1 } });
    const me = g.units[0]; me.hp = 500; const f0 = me.fuel;
    g.damage(g.units[1], 100, me);
    check(me.fuel === f0 + 5 && me.hp === 510, '虹吸回油、吸能回血');
  }
  {
    const g = arena({ perks: { ambush: 1 } });
    const me = g.units[0];
    check(g.perkMul(me) === 2 && g.perkMul(me) === 1, '先发制人只管每场第一发');
  }
  {
    const g = arena({ perks: { combo: 0.15, berserk: 0.6 } });
    const me = g.units[0]; me.streak = 3; me.hp = me.maxHp / 2;
    const m = g.perkMul(me);
    check(Math.abs(m - 1.45 * 1.3) < 1e-6, '连击与狂战士相乘', m.toFixed(3));
  }
  {
    const g = arena(null, { perks: { revive: 1 } });
    const foe = g.units[1];
    g.damage(foe, 5000, g.units[0]);
    check(foe.alive && foe.hp === Math.round(foe.maxHp * 0.4) && foe.revived, '应急核心复活一次');
    g.damage(foe, 5000, g.units[0]);
    check(!foe.alive, '第二次就救不回来了');
  }
  {
    const g = arena({ perks: { aftershock: 0.4 } });
    const foe = g.units[1];
    g.explode(foe.x, foe.y - 14, V('liehuo').w1, g.units[0], foe, 1);
    const afterFirst = foe.hp;
    settle(g, 60);
    check(foe.hp < afterFirst, '余震装置追加一次爆炸', `${afterFirst} → ${foe.hp}`);
    check(g.pendingBlasts.length === 0, '余震不会再触发余震');
  }
  {
    const g = arena({ perks: { autoDouble: 1 } });
    const me = g.units[0];
    me.turnsTaken = 2; g.arcadeTurnStart(me);
    check(me.buffDouble === true, '自动装填：第三回合送一次双倍');
  }

  // ---------- 改造 ----------
  head('武器改造');
  {
    const w1 = V('liehuo').w1;
    const snapshot = JSON.stringify(w1);
    for (const m of Run.MODS) {
      const w = Run.modWeapon(w1, [m.id, m.id]);
      const g = arena(null, null, 500);
      const me = g.units[0], foe = g.units[1], hp0 = foe.hp;
      g.explode(foe.x, foe.y - 14, w, me, foe, 1);
      settle(g, 500);
      check(foe.hp < hp0 && g.projectiles.length === 0, `「${m.name}」叠两层仍能正常结算`, `-${Math.round(hp0 - foe.hp)}`);
    }
    check(JSON.stringify(w1) === snapshot, '改造不会改动原始武器数据');
    const s3 = Run.modWeapon(w1, ['split', 'split']);
    check(s3.count === 3, '分裂弹头叠两层 = 三发', `count=${s3.count}`);
    const mix = Run.modWeapon(V('duzhizhu').w1, ['burn', 'venom']);
    check(mix.dot && mix.dot2 && mix.dot.type !== mix.dot2.type, '火与毒可以挂在同一把武器上');
    const g = arena();
    g.explode(g.units[1].x - 200, 590, Run.modWeapon(w1, ['cluster']), g.units[0], null, 1);
    check(g.projectiles.length === 3, '集束：落点蹦出三颗子弹药');
  }

  // ---------- 留在场上的区域 ----------
  head('场地区域：地火 / 毒池 / 蛛网 / 龙卷');
  {
    const oil = V('chiyan').w1;
    const c = mk();
    flatten(c);
    c.explode(900, 590, oil, c.units[0], null, 1);
    check(c.hazards.length === 0, '经典规则下武器不留任何区域');

    const g = arena();
    const me = g.units[0], foe = g.units[1];
    g.explode(foe.x, foe.y - 4, oil, me, null, 1);
    check(g.hazards.length === 1 && g.hazards[0].type === 'fire' && g.hazards[0].rounds === 2, '燃油弹落地留下两轮地火');
    settle(g, 200);
    foe.x = g.hazards[0].x; foe.y = g.terrain.groundBelow(foe.x, 0); foe.airborne = false;
    const hp0 = foe.hp;
    g.fieldTurnStart(foe);
    check(foe.hp === hp0 - 34, '回合开始时站在地火里挨烧', `-${hp0 - foe.hp}`);
    const mine = me.hp; me.x = foe.x + 10; me.y = foe.y;
    g.fieldTurnStart(me);
    check(me.hp < mine, '放火的人自己站进去也烧');
    me.x = foe.x + 400; me.y = g.terrain.groundBelow(me.x, 0);
    const safe = me.hp;
    g.fieldTurnStart(me);
    check(me.hp === safe, '站在火外面没事');
    g.fieldRoundStart(); check(g.hazards.length === 1 && g.hazards[0].rounds === 1, '每过一轮少一轮');
    g.fieldRoundStart(); check(g.hazards.length === 0, '到时间就熄了');
  }
  {
    const g = arena();
    g.addHazard('fire', 800, 600, 50, 2, 30, null);
    g.addHazard('fire', 840, 600, 50, 3, 20, null);
    check(g.hazards.length === 1 && g.hazards[0].rounds === 3 && g.hazards[0].power === 30, '落在一起的同类区域并成一块');
    g.addHazard('pool', 840, 600, 40, 3, 24, null);
    check(g.hazards.length === 2, '不同类的各算各的');
    const y0 = g.hazards[0].y;
    g.terrain.carve(820, 600, 70);
    g.placeHazard(g.hazards[0]);
    check(g.hazards[0].y > y0 + 20, '地被炸低了，火跟着掉下去', `${Math.round(y0)} → ${Math.round(g.hazards[0].y)}`);
  }
  {
    const g = arena();
    const foe = g.units[1];
    g.addHazard('pool', foe.x, foe.y, 44, 3, 24, null);
    g.fieldTurnStart(foe);
    check(foe.dots.some((d) => d.type === 'poison' && d.damage === 24), '站在毒池里会中毒');

    const w = arena();
    const u = w.units[0];
    const out = u.fuel; w.moveActive(1); const costOut = out - u.fuel;
    w.addHazard('web', u.x, u.y, 80, 3, 0, null);
    const inn = u.fuel; w.moveActive(1); const costIn = inn - u.fuel;
    check(Math.abs(costIn / costOut - 3) < 0.01, '蛛网里移动耗油 ×3', `${costOut.toFixed(3)} → ${costIn.toFixed(3)}`);
    const a = arena(), b = arena();
    b.addHazard('web', b.units[1].x, b.units[1].y, 80, 3, 0, null);
    a.explode(a.units[1].x - 22, a.units[1].y - 14, V('liehuo').w1, a.units[0], null, 1);
    b.explode(b.units[1].x - 22, b.units[1].y - 14, V('liehuo').w1, b.units[0], null, 1);
    check(Math.abs(b.units[1].vx) < Math.abs(a.units[1].vx) * 0.35, '蛛网里被击飞的力道只剩三成');
  }
  {
    const g = arena(null, null, 600);
    const foe = g.units[1], x0 = foe.x;
    g.wind = g.map.windMax * 0.8;
    g.addHazard('twister', foe.x, foe.y - 20, 52, 2, 0, g.units[0]);
    g.fieldTurnStart(foe);
    check(foe.airborne && foe.vx > 3 && foe.vy < 0, '龙卷把人卷起来，顺风甩出去');
    settle(g, 300);
    check(foe.x > x0 + 60, '落到了下风处', `位移 ${Math.round(foe.x - x0)}px`);
    const h = arena(null, { perks: { anchor: 1 } });
    h.addHazard('twister', h.units[1].x, h.units[1].y - 20, 52, 2, 0, null);
    h.fieldTurnStart(h.units[1]);
    check(!h.units[1].airborne, '磁力底盘卷不动');
  }
  {
    const g = arena();
    const ai = g.units[1];
    check(g.escapePlan(ai) === null, '脚下没危险时电脑不用躲');
    g.addHazard('fire', ai.x + 10, ai.y, 60, 2, 34, null);
    const esc = g.escapePlan(ai);
    check(esc && esc.steps > 20 && esc.dir === -1, '电脑站在地火里：知道往近的那边走出去', esc ? `方向 ${esc.dir} · ${esc.steps} 步` : '');
    const plan = RZ.aiThink(g, ai);
    check(plan.moveDir === esc.dir && plan.moveSteps === esc.steps, '逃离危险优先于其它走位');
    for (let i = 0; i < esc.steps; i++) { g.active = ai; g.phase = 'aim'; g.moveActive(esc.dir); }
    check(!g.dangerAt(ai.x, ai.y), '走完就出了危险地带');
  }

  // ---------- Boss ----------
  head('Boss：预告打击与阶段');
  const bossArena = (kit, extra) => {
    const g = arena(null, Object.assign({ kit, boss: true, scale: 1.5 }, extra || {}), 900);
    g.telegraphs.length = 0; g.units[1].kitTurn = 0; g.units[1].kitPhase = 0;
    return g;
  };
  {
    const g = bossArena('crusher');
    const me = g.units[0], boss = g.units[1], hp0 = me.hp;
    g.bossTurnStart(boss);
    check(g.telegraphs.length === 2 && Math.abs(g.telegraphs[0].x - me.x) < 20, '碾压者圈两块地，第一块压在玩家脚下');
    check(me.hp === hp0, '圈地当回合不伤人');
    check(g.dangerAt(me.x, me.y), '警戒线算危险地带（电脑会躲）');
    g.bossTurnStart(boss);
    check(g.telegraphs.length === 2 && g.pendingBlasts.length === 0 && me.hp === hp0,
      'Boss 连着出手两次：玩家还没轮到，警戒线不落、也不叠新的');
    me.stunned = 1; g.armTelegraphs(me); me.stunned = 0;
    g.bossTurnStart(boss);
    check(g.telegraphs.length === 2 && g.pendingBlasts.length === 0, '玩家被麻痹的回合不算轮到过');
    g.armTelegraphs(me);
    g.bossTurnStart(boss);
    check(g.telegraphs.length === 0 && g.pendingBlasts.length === 2, '玩家轮到过之后，Boss 的下一回合：圈的地开始落下');
    settle(g, 120);
    check(me.hp < hp0 - 60, '没挪开就挨炸', `-${Math.round(hp0 - me.hp)}`);

    const d = bossArena('crusher');
    const you = d.units[0], b2 = d.units[1], h1 = you.hp;
    d.bossTurnStart(b2);
    you.x -= 220; you.y = d.terrain.groundBelow(you.x, 0);
    const far = d.telegraphs.every((t) => Math.abs(t.x - you.x) > t.r + 60);
    d.armTelegraphs(you);
    d.bossTurnStart(b2); settle(d, 120);
    check(!far || you.hp === h1, '挪开了就毫发无伤');
  }
  {
    const g = bossArena('crusher');
    const me = g.units[0], boss = g.units[1], atk0 = boss.atk, props0 = g.props.length, hp0 = me.hp;
    boss.hp = boss.maxHp * 0.45;
    g.bossTurnStart(boss);
    check(boss.kitPhase === 1 && boss.atk > atk0, '血量过半：进入第二阶段，攻击上升');
    check(me.hp === hp0 - 40 && me.airborne, '地震把玩家震起来并扣血');
    check(g.props.length === props0 + 3, '天上掉下三个油桶');
    check(g.telegraphs.length === 3, '换阶段当回合就出新招：圈三块');
    g.kill(boss);
    check(g.telegraphs.length === 0, 'Boss 一死，它圈的地作废');
  }
  {
    const g = bossArena('queen');
    const me = g.units[0], boss = g.units[1];
    g.wind = 0;
    g.bossTurnStart(boss);
    const toward = me.x < boss.x ? -1 : 1;
    check(Math.sign(g.wind) === toward && Math.abs(g.wind) >= g.map.windMax * 0.49, '风暴女王把风拧向玩家', `风 ${g.wind.toFixed(1)}`);
    check(g.telegraphs.length === 1 && g.telegraphs[0].strike === 'twister', '第一阶段圈地放龙卷');
    g.armTelegraphs(me);
    g.bossTurnStart(boss);
    check(g.hazards.some((h) => h.type === 'twister'), '龙卷落在圈的地上');
    check(me.airborne, '没挪开的玩家被当场卷起');
    boss.hp = boss.maxHp * 0.4; settle(g, 200);
    g.bossTurnStart(boss);
    check(g.telegraphs.length === 3 && g.telegraphs.every((t) => t.strike === 'bolt'), '第二阶段改成一排三道落雷');
    const xs = g.telegraphs.map((t) => t.x).sort((a, b) => a - b);
    check(xs[1] - xs[0] > 50 && xs[2] - xs[1] > 50, '三道雷一字排开');
  }
  {
    const g = new RZ.Game({
      mapId: 'dry', arcade: true, barrels: 0, humanTeam: 0, roster: [
        { vehicle: V('liehuo'), team: 0, ai: false, name: '我' },
        { vehicle: V('honglong'), team: 1, ai: true, name: '终焉战车', kit: 'doom', boss: true },
        { vehicle: V('tuoer'), team: 1, ai: true, name: '护卫' }]
    });
    const boss = g.units[1], guard = g.units[2], hp0 = boss.hp;
    g.damage(boss, 100, g.units[0]);
    check(boss.hp === hp0 - 75, '护卫在场：终焉战车只吃四分之三的伤害');
    g.kill(guard);
    g.damage(boss, 100, g.units[0]);
    check(boss.hp === hp0 - 175, '护卫倒下后吃满');
    boss.hp = boss.maxHp * 0.3;
    check(g.bossPhase(boss) === 2, '血量 30% 时是第三阶段');
  }
  {
    const s = Run.newRun('liehuo');
    check(s.layers[4][0].enemies[0].kit === 'crusher', '远征的 Boss 节点带着招式表');
    s.step = 4; Run.enter(s, 0);
    check(Run.battleOpts(s).roster[1].kit === 'crusher', '招式表传进了战斗');
    check(Run.ACTS.every((a) => RZ.BOSS_KITS[a.boss.kit]), '三个 Boss 都有招式表');
  }

  // ---------- 存档 ----------
  head('进度码与存档安全');
  {
    Run.clear();
    Run.saveMeta({ medals: 17, unlocked: ['liehuo', 'tiejingang', 'beibeilong', 'honglong'], wins: 2, asc: 1, runs: 9, best: 12 });
    const s = Run.newRun('honglong'); s.act = 1; s.step = 2; s.relics = ['crit']; Run.save(s);
    const code = Run.exportCode();
    check(/^RZ1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+$/.test(code), '进度码是一串可以放进网址的文本', `${code.length} 字符`);
    const p = Run.parseCode('https://example.com/#save=' + code + '\n ');
    check(p.ok && p.meta.medals === 17 && p.run && p.run.act === 1 && p.run.relics[0] === 'crit', '带进度的链接能读出同样的内容');
    check(p.run.layers[4][0].enemies[0].name === s.layers[4][0].enemies[0].name, '中文原样往返');
    check(!Run.parseCode(code.slice(0, -7)).ok, '少了一截会被发现');
    check(!Run.parseCode(code.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))).ok, '改了一个字符会被发现');
    check(!Run.parseCode('随便一段话').ok && Run.parseCode('随便一段话').error.length > 0, '不是进度码时给出原因');

    Run.clear(); Run.saveMeta({});
    check(Run.loadMeta().medals === 0 && Run.load() === null, '（清空这台设备）');
    const r = Run.importCode(code);
    check(r.ok && Run.loadMeta().medals === 17 && Run.loadMeta().unlocked.length === 4 && Run.load().vehicleId === 'honglong', '导入后进度原样回来');
    check(Run.loadMeta().sinceBackup === 0 && Run.loadMeta().lastBackup > 0, '导入等于刚备份过');
  }
  {
    Run.saveMeta({ medals: 5 }); Run.saveMeta({ medals: 8 });
    Run._storeSet('rz-meta', '{写到一半断电了');
    check(Run.loadMeta().medals === 5, '主档写坏了：退回上一份，只丢最近一次改动');
    const junk = Run.parseCode(Run.exportCode());
    check(junk.ok, '（基线）');
    Run.saveMeta({ medals: -3, unlocked: ['liehuo', '不存在的车'], asc: 99 });
    const n = Run.loadMeta();
    check(n.medals === 0 && n.unlocked.indexOf('不存在的车') < 0 && n.unlocked.length === 3 && n.asc === Run.MAX_ASC, '残缺 / 离谱的存档会被补齐成合法的');
    check(n.v === 1, '存档带格式版本号');
  }
  {
    Run.saveMeta({});
    check(!Run.needsBackup(Run.loadMeta()), '新玩家不催备份');
    for (let i = 0; i < 3; i++) Run.finish(Run.newRun('liehuo'), false);
    check(Run.loadMeta().sinceBackup === 3 && Run.needsBackup(Run.loadMeta()), '三次远征没备份就提醒');
    Run.markBackup();
    check(!Run.needsBackup(Run.loadMeta()), '导出之后不再提醒');
  }

  // ---------- 远征流程 ----------
  head('远征：状态机');
  {
    const s = Run.newRun('liehuo');
    check(s.layers.length === Run.LAYERS_PER_ACT && s.layers[4][0].type === 'boss', '每个区域五层，最后一层是 Boss');
    check(s.layers.every((L) => L.length >= 1 && L.length <= 3), '每层一到三个选项');
    const back = JSON.parse(JSON.stringify(s));
    check(JSON.stringify(back) === JSON.stringify(s), '状态是纯 JSON，可以原样存取');
    Run.save(s);
    check(Run.load() && Run.load().vehicleId === 'liehuo', '存档能读回来');

    check(Run.enter(s, 0) === true && s.node.type === 'fight', '选战斗节点 → 该开打了');
    const o = Run.battleOpts(s);
    check(o.arcade && o.roster[0].team === 0 && !o.roster[0].ai && o.roster.length >= 2, '战斗参数：爽快规则、玩家在红队');
    check(o.roster[1].vehicle.hp < V(o.roster[1].vehicle.id).hp, '第一层的敌人比原版脆', `${o.roster[1].vehicle.hp}`);

    // 假装打赢了
    const g = new RZ.Game(o);
    g.units[0].hp = 500; g.units[0].items = ['fly'];
    g.units.slice(1).forEach((u) => { u.alive = false; });
    g.result = 0; g.style.gold = 10;
    const gold0 = s.gold;
    Run.afterBattle(s, g);
    check(s.pending && s.pending.kind === 'reward' && s.pending.choices.length === 3, '打赢后三选一');
    check(s.gold === gold0 + s.pending.gold && s.pending.gold >= 40, '发了金币（含花式赏金）', `+${s.pending.gold}`);
    check(s.hp > 500 && s.hp <= Run.maxHp(s), '耐久带回来，外加一点战后抢修', `${s.hp}`);
    check(s.items.length === 1 && s.items[0] === 'fly', '道具带回来');
    check(Run.enter(s, 0) === false, '奖励没领完不能走下一步');

    s.pending.choices[0] = { type: 'mod', id: 'split' };
    check(Run.takeReward(s, 0) === false, '改造必须指定装在哪把武器上');
    check(Run.takeReward(s, 0, 'w1') && s.mods.w1[0] === 'split' && s.step === 1, '装上改造，前进一层');
    check(Run.playerVehicle(s).w1.count === 2, '改造体现在实际开的车上');
  }
  {
    const s = Run.newRun('liehuo');
    s.pending = { kind: 'reward', from: 'fight', gold: 0, choices: [{ type: 'relic', id: 'hull' }, { type: 'relic', id: 'glass' }, { type: 'relic', id: 'turbo' }] };
    Run.takeReward(s, 0);
    check(Run.maxHp(s) === 860 + 150 && s.hp === 860 + 150, '加厚底盘：上限和当前耐久一起涨');
    s.relics.push('glass');
    check(Run.maxHp(s) === Math.round(1010 * 0.75) && Run.playerVehicle(s).atk === 140, '玻璃大炮：攻击 +40%、上限 -25%');
    s.relics.push('turbo', 'jet');
    const v = Run.playerVehicle(s), b = V('liehuo');
    check(v.regen === b.regen + 8 && v.moveCost === b.moveCost / 2 && v.climb === b.climb + 8, '涡轮 / 喷气履带折进车辆数值');
    check(b.hp === 860 && b.atk === 100, '基础车辆数据没被改动');
  }
  {
    const s = Run.newRun('liehuo'); s.gold = 500; s.step = 2;
    Run.enter(s, 1);
    check(s.pending.kind === 'shop' && s.pending.stock.length >= 8, '商店有货', `${s.pending.stock.length} 件`);
    const i = s.pending.stock.findIndex((x) => x.type === 'relic');
    const cost = s.pending.stock[i].cost;
    check(Run.buy(s, i) && s.gold === 500 - cost && s.relics.length === 1, '买遗物扣钱');
    check(Run.buy(s, i) === false, '同一件不能买两次');
    s.gold = 0;
    check(Run.buy(s, s.pending.stock.findIndex((x) => x.type === 'item')) === false, '没钱买不了');
    check(Run.leave(s) && s.step === 3 && !s.pending, '离开商店，前进一层');
  }
  {
    const s = Run.newRun('liehuo'); s.hp = 300; s.step = 2;
    Run.enter(s, 2);
    check(Run.rest(s, 'repair') && s.hp === 300 + 344, '修整回 40% 耐久', `${s.hp}`);
    // 每个事件的每个选项：家底厚的时候都能选，选完状态还是合法的纯 JSON
    const rich = () => {
      const t = Run.newRun('liehuo');
      t.gold = 500; t.relics = ['turbo', 'after', 'leaky']; t.mods.w1 = ['heavy']; t.items = ['heal1'];
      return t;
    };
    let fightsFromEvents = 0;
    for (const ev of Run.EVENTS) {
      check(ev.options.some((o) => !o.need), `事件「${ev.title}」至少有一个不设门槛的选项（不会卡住）`);
      for (let k = 0; k < ev.options.length; k++) {
        const t = rich();
        t.pending = { kind: 'event', id: ev.id };
        const r = Run.eventChoose(t, k);
        let ok;
        if (r === 'fight') {
          fightsFromEvents++;
          const g = new RZ.Game(Run.battleOpts(t));
          ok = !t.pending && t.node && t.node.enemies.length > 0 && g.units.length >= 2;
        } else {
          ok = r === true && t.pending.kind === 'note' && t.pending.text.length > 0 && t.hp >= 1 && Run.leave(t) && t.step === 1;
        }
        const clean = JSON.stringify(t) === JSON.stringify(JSON.parse(JSON.stringify(t)));
        check(ok && clean, `事件「${ev.title}」选项 ${k + 1}`);
      }
    }
    check(fightsFromEvents >= 1, '有事件会转成一场战斗');
  }

  // ================= v1.3 流派成型 =================
  head('v1.3：战车被动');
  {
    check(RZ.VEHICLES.every((v) => Run.passiveOf(v.id) && Run.passiveOf(v.id).desc), '十辆车每辆都有远征被动');
    const pk = (vid) => Run.perks(Run.newRun(vid));
    check(pk('honglong').bloodlust === 1 && pk('aodin').anchor === 1, '被动并进 Run.perks');
    check(mk().units[0].perks.variety === undefined, '经典对局里没有被动');

    // 烈火：换手 +25%
    {
      const g = arena({ perks: { variety: 0.25 } });
      const u = g.units[0];
      const a = g.perkMul(u, 0), b = g.perkMul(u, 0), c = g.perkMul(u, 1);
      check(a === 1 && b === 1 && Math.abs(c - 1.25) < 1e-9, '烈火「多面手」：换一把武器才 +25%', `${a} ${b} ${c}`);
    }
    // 红龙：击破回血 + 下一发 +40%
    {
      const g = arena({ perks: { bloodlust: 1 } });
      const me = g.units[0], foe = g.units[1];
      me.hp = me.maxHp * 0.5;
      g.damage(foe, 99999, me);
      check(foe.alive === false && Math.round(me.hp) === Math.round(me.maxHp * 0.65), '红龙「嗜血」：击破回 15% 耐久', `${Math.round(me.hp)}`);
      check(Math.abs(g.perkMul(me, 0) - 1.4) < 1e-9 && g.perkMul(me, 0) === 1, '下一发 +40%，只管一发');
    }
    // 铁金刚：没挪窝就架盾
    {
      const g = arena({ perks: { brace: 0.3 } });
      const me = g.units[0];
      g.active = me; me.moveSpent = 0; g.endTurn();
      const hp0 = me.hp;
      g.damage(me, 100, g.units[1]);
      check(me.braced && Math.round(hp0 - me.hp) === 70, '铁金刚「铁壁」：一步没挪，少吃 30%', `-${Math.round(hp0 - me.hp)}`);
      g.arcadeTurnStart(me);
      check(!me.braced, '再轮到自己时盾就放下了');
      g.active = me; me.moveSpent = 3; g.endTurn();
      check(!me.braced, '挪过就不架盾');
    }
    // 贝贝龙：多发武器多一发
    {
      const v = Run.playerVehicle(Run.newRun('beibeilong'));
      check(v.w2.count === V('beibeilong').w2.count + 1 && v.w1.count === V('beibeilong').w1.count, '贝贝龙「一窝蛋」：散射多一发，单发不变', `${v.w2.count}`);
      check(V('beibeilong').w2.count === 5, '原始数据没被改');
    }
    // 毒蜘蛛：带持续伤害时 +30%
    {
      const g = arena({ perks: { corrode: 0.3 } });
      const me = g.units[0], foe = g.units[1];
      let h = foe.hp; g.damage(foe, 100, me); const plain = h - foe.hp;
      foe.dots.push({ type: 'poison', turns: 2, damage: 10 });
      h = foe.hp; g.damage(foe, 100, me); const hurt = h - foe.hp;
      check(plain === 100 && hurt === 130, '毒蜘蛛「蚀甲」：目标中毒时 +30%', `${plain} → ${hurt}`);
    }
    // 旋风：风影响减半，满风 +30%
    {
      const v = Run.playerVehicle(Run.newRun('xuanfeng'));
      check(v.w1.windMul === (V('xuanfeng').w1.windMul == null ? 1 : V('xuanfeng').w1.windMul) * 0.5, '旋风「乘风」：受风影响减半');
      const g = mk({ arcade: true, barrels: 0, mapId: 'dry' }, { perks: { windRider: 0.3 } });
      g.wind = g.map.windMax;
      check(Math.abs(g.perkMul(g.units[0], 0) - 1.3) < 1e-9, '满风伤害 +30%');
    }
    // 托尔：第三发引雷
    {
      const g = arena({ perks: { thunderEvery: 3 } });
      const me = g.units[0];
      for (let n = 0; n < 3; n++) {
        g.active = me; g.phase = 'aim'; me.fuel = 200; me.aim = 50; me.power = 60;
        g.fire();
        settle(g, 300);
      }
      check(me.shotsFired === 3, '托尔「雷鸣」：数着开火次数');
      const g2 = arena({ perks: { thunderEvery: 3 } });
      const u2 = g2.units[0], f2 = g2.units[1];
      g2.thunderFor = u2;
      const hp0 = f2.hp;
      g2.explode(f2.x + 300, f2.y - 5, V('tuoer').w1, u2, null, 1);
      check(g2.effects.some((e) => e.type === 'bolt') && g2.thunderFor === null, '第三发的落点引下落雷');
      check(f2.hp === hp0, '落雷只劈落点那一列，打不到别处的人');
    }
    // 赤焰：地火更久更烫，自己不怕火
    {
      const g = arena({ perks: { pyro: 1 } });
      const me = g.units[0], foe = g.units[1];
      g.addHazard('fire', foe.x, foe.y, 60, 2, 40, me);
      const h = g.hazards[0];
      check(h.rounds === 3 && h.power === 60, '赤焰「燎原」：自己留的地火多一轮、伤害 +50%', `${h.rounds} 轮 ${h.power}`);
      g.addHazard('fire', me.x, me.y, 60, 2, 40, foe);
      const hp0 = me.hp;
      g.fieldTurnStart(me);
      check(me.hp === hp0, '站在火里不受伤');
    }
    // 兰登：直击 +30%、回 8 油
    {
      const a = arena(), b = arena({ perks: { precise: 0.3 } });
      [a, b].forEach((g) => { g.units[0].fuel = 50; g.explode(g.units[1].x, g.units[1].y - 14, V('landeng').w1, g.units[0], g.units[1], 1); });
      const da = a.units[1].maxHp - a.units[1].hp, db = b.units[1].maxHp - b.units[1].hp;
      check(db / da > 1.25 && db / da < 1.35 && b.units[0].fuel === 58, '兰登「精准」：直击再 +30%，回 8 点燃料', `${Math.round(da)} → ${Math.round(db)}`);
    }
    // 奥丁：坑大 40%、不被击飞
    {
      const solid = (t) => { let n = 0; for (let i = 0; i < t.mask.length; i++) n += t.mask[i]; return n; };
      const a = arena(), b = arena({ perks: { dig: 0.4, anchor: 1 } });
      const dug = [a, b].map((g) => { const y = g.terrain.groundBelow(1200, 0), n = solid(g.terrain); g.explode(1200, y, V('aodin').w1, g.units[0], null, 1); return n - solid(g.terrain); });
      check(dug[1] > dug[0] * 1.6, '奥丁「镇地」：坑大一圈', `${dug[0]} → ${dug[1]} 像素`);
    }
  }

  head('v1.3：联动遗物');
  {
    const s = Run.newRun('liehuo');
    s.relics = ['after'];
    check(Run.activeSynergies(s).length === 0, '只有一半时不生效');
    s.relics.push('demo');
    const pk = Run.perks(s);
    check(Run.activeSynergies(s).map((x) => x.id).join() === 'chainblast' && Math.abs(pk.aftershock - 0.6) < 1e-9, '凑齐「余震装置 + 爆破专家」→「连环爆破」', `余震 ${pk.aftershock}`);
    check(Run.SYNERGIES.every((sy) => sy.needs.every((id) => Run.relicById(id))), '每个联动的两半都是存在的遗物');
    check(Run.synergiesOf('crit').length >= 2, '一件遗物可以参与好几个联动');
    // 手里有一半时，另一半更容易抽到
    Run.setRandom(null);
    const count = (owned) => {
      let n = 0;
      for (let i = 0; i < 1500; i++) {
        const t = Run.newRun('liehuo'); t.relics = owned.slice();
        // 直接看奖励：普通战斗的三选一
        t.pending = null; t.node = { type: 'fight', gold: 10 };
        const g = { units: [{ alive: true, items: [], hp: 500 }], result: 0, style: { gold: 0 } };
        Run.afterBattle(t, g);
        if (t.pending.choices.some((x) => x.id === 'demo')) n++;
      }
      return n;
    };
    const base = count([]), boosted = count(['after']);
    check(boosted > base * 1.8, '有「余震装置」时「爆破专家」出现得明显更多', `${base} → ${boosted} / 1500`);
    // 首轮齐射 / 浴火重生 / 回收专家 / 狙击手
    {
      const g = arena({ perks: { ambushDouble: 1 } });
      g.arcadeTurnStart(g.units[0]);
      check(g.units[0].buffDouble === true, '「首轮齐射」：第一发自动双倍');
      g.units[0].firstShot = false; g.units[0].buffDouble = false; g.arcadeTurnStart(g.units[0]);
      check(g.units[0].buffDouble === false, '只管第一发');
    }
    {
      const g = arena({ perks: { phoenix: 1 } });
      const me = g.units[0]; me.reviveLeft = 1;
      g.damage(me, 99999, g.units[1]);
      check(me.alive && me.hp === me.maxHp, '「浴火重生」：应急核心直接满血复活');
    }
    {
      const g = arena({ perks: { goldPerHit: 3 } });
      g.explode(g.units[1].x, g.units[1].y - 14, V('liehuo').w1, g.units[0], g.units[1], 1);
      check(g.style.gold >= 3, '「回收专家」：炸到敌人给金币', `${g.style.gold}`);
    }
    {
      const a = arena(null, null, 1200), b = arena({ perks: { snipeCrit: 0.6 } }, null, 1200);
      [a, b].forEach((g) => g.explode(g.units[1].x, g.units[1].y - 14, V('liehuo').w1, g.units[0], null, 1));
      const da = a.units[1].maxHp - a.units[1].hp, db = b.units[1].maxHp - b.units[1].hp;
      check(Math.abs(db / da - 1.6) < 0.05, '「狙击手」：1000px 外命中 ×1.6', `${Math.round(da)} → ${Math.round(db)}`);
    }
  }

  head('v1.3：诅咒遗物');
  {
    const curseIds = Run.RELICS.filter((r) => r.rarity === 'curse').map((r) => r.id);
    check(curseIds.length >= 5, '有一组诅咒遗物', curseIds.join(' '));
    let leaked = 0;
    for (let i = 0; i < 400; i++) {
      const t = Run.newRun('liehuo');
      t.node = { type: ['fight', 'elite', 'boss'][i % 3], gold: 10 };
      Run.afterBattle(t, { units: [{ alive: true, items: [], hp: 500 }], result: 0, style: { gold: 0 } });
      if (t.pending.choices.some((c) => c.type === 'relic' && curseIds.indexOf(c.id) >= 0)) leaked++;
    }
    check(leaked === 0, '诅咒遗物不会出现在战后奖励里');
    const shop = Run.genStock(Run.newRun('liehuo'));
    check(shop.filter((x) => x.black).length === 1 && curseIds.indexOf(shop.find((x) => x.black).id) >= 0, '商店的黑市角落有一件诅咒遗物');

    // 血契弹匣：开火掉血但不致死
    {
      const g = arena({ perks: { selfHarm: 0.03 } });
      const me = g.units[0];
      g.active = me; g.phase = 'aim'; me.fuel = 100; me.aim = 50; me.power = 50;
      const hp0 = me.hp; g.fire();
      check(Math.round(hp0 - me.hp) === Math.round(me.maxHp * 0.03), '「血契弹匣」：开火失去 3% 最大耐久');
      settle(g, 400);
      me.hp = 5; g.active = me; g.phase = 'aim'; me.fuel = 100; g.fire();
      check(me.alive && me.hp >= 1, '不会因此阵亡', `${me.hp}`);
    }
    {
      const g = arena({ perks: { noStartFuel: 1, startFuel: 200 } });
      check(g.units[0].fuel === 0, '「无底油箱」：开局燃料清零（连过载电容也盖不住）');
    }
    {
      const g = arena({ perks: { crit: 0, dud: 0.2 } });
      let duds = 0;
      for (let i = 0; i < 400; i++) if (g.perkMul(g.units[0], 0) < 0.5) duds++;
      check(duds > 50 && duds < 120, '「赌徒骰子」：大约两成哑火', `${duds} / 400`);
    }
    {
      const g = arena({ perks: { armor: -0.2 } });
      const hp0 = g.units[0].hp; g.damage(g.units[0], 100, g.units[1]);
      check(Math.round(hp0 - g.units[0].hp) === 120, '「贪婪之心」：受到的伤害 +20%');
    }
    {
      const g = arena({ perks: { blind: 1 } }), h = arena(), k = arena({ perks: { blind: 1, scope: 1 } });
      [g, h, k].forEach((x) => { x.active = x.units[0]; x.phase = 'aim'; x.units[0].aim = 50; });
      const a = g.previewPath().length, b = h.previewPath().length, c = k.previewPath().length;
      check(a < b * 0.5 && Math.abs(c - b) <= 2, '「短视镜片」：预览只剩一小段；带测距仪等于抵消', `${a} / ${b} / ${c}`);
    }
    // 铅制装甲：拿到加血，净化时退回
    {
      const t = Run.newRun('liehuo');
      const base = Run.maxHp(t);
      t.pending = { kind: 'shop', stock: [{ type: 'relic', id: 'lead', cost: 0 }] };
      Run.buy(t, 0);
      check(Run.maxHp(t) === base + 350 && Run.playerVehicle(t).moveCost === V('liehuo').moveCost * 2, '「铅制装甲」：+350 耐久、移动耗油翻倍');
      t.pending = { kind: 'rest' };
      const opts = Run.restOptions(t).map((o) => o.id);
      check(opts.indexOf('purify') >= 0, '手里有诅咒时，修整多一个「净化」');
      check(Run.rest(t, 'purify') && t.relics.indexOf('lead') < 0 && Run.maxHp(t) === base && t.hp <= base, '净化拆掉诅咒，连它加的耐久一起退回');
      t.pending = { kind: 'rest' };
      check(Run.restOptions(t).every((o) => o.id !== 'purify') && Run.rest(t, 'purify') === false, '没有诅咒就没有净化');
    }
  }

  head('v1.3：稀有改造');
  {
    const rare = Run.modPool(true).map((m) => m.id);
    check(rare.length >= 5, '有一组稀有改造', rare.join(' '));
    let eliteHas = 0, fightHas = 0;
    for (let i = 0; i < 300; i++) {
      const t = Run.newRun('liehuo');
      t.node = { type: 'elite', gold: 10 };
      Run.afterBattle(t, { units: [{ alive: true, items: [], hp: 500 }], result: 0, style: { gold: 0 } });
      if (t.pending.choices.some((c) => c.type === 'mod' && rare.indexOf(c.id) >= 0)) eliteHas++;
      const f = Run.newRun('liehuo');
      f.node = { type: 'fight', gold: 10 };
      Run.afterBattle(f, { units: [{ alive: true, items: [], hp: 500 }], result: 0, style: { gold: 0 } });
      if (f.pending.choices.some((c) => c.type === 'mod' && rare.indexOf(c.id) >= 0)) fightHas++;
    }
    check(eliteHas === 300 && fightHas > 10 && fightHas < 70, '精英战必给一件稀有改造，普通战斗偶尔掉', `精英 ${eliteHas} / 普通 ${fightHas}`);
    // 连锁闪电
    {
      const g = new RZ.Game({ mapId: 'dry', arcade: true, barrels: 0, humanTeam: 0, roster: [
        { vehicle: V('liehuo'), team: 0, ai: false, name: 'a' },
        { vehicle: V('honglong'), team: 1, ai: true, name: 'b' },
        { vehicle: V('tuoer'), team: 1, ai: true, name: 'c' }] });
      const floor = flatten(g); g.wind = 0;
      [400, 1000, 1400].forEach((x, i) => { const u = g.units[i]; u.x = x; u.y = floor; u.airborne = false; });
      const w = Run.modWeapon(V('liehuo').w1, ['chain']);
      const far = g.units[2], hp0 = far.hp;
      g.explode(g.units[1].x, g.units[1].y - 14, w, g.units[0], g.units[1], 1);
      check(far.hp < hp0 && g.effects.some((e) => e.type === 'zap'), '「连锁闪电」：跳到 400px 外的另一个敌人', `-${Math.round(hp0 - far.hp)}`);
    }
    // 引力坍缩
    {
      const g = arena(null, null, 600);
      const foe = g.units[1], x0 = foe.x;
      g.explode(foe.x - 30, foe.y - 10, Run.modWeapon(V('liehuo').w1, ['gravity']), g.units[0], null, 1);
      settle(g, 120);
      check(foe.x < x0 - 5, '「引力坍缩」：往爆心吸，不是往外推', `${x0} → ${Math.round(foe.x)}`);
      const h = arena(null, null, 600), x1 = h.units[1].x;
      h.explode(h.units[1].x - 30, h.units[1].y - 10, V('liehuo').w1, h.units[0], null, 1);
      settle(h, 120);
      check(h.units[1].x > x1, '没装的照样往外推');
    }
    // 子母弹头
    {
      const w = Run.modWeapon(V('liehuo').w1, ['mirv']);
      const g = arena();
      g.explode(1500, g.terrain.groundBelow(1500, 0), w, g.units[0], null, 1);
      const kids = g.projectiles.filter((p) => p.w.isChild);
      check(kids.length === 5 && Math.abs(kids[0].w.damage - w.damage * 0.5) < 1, '「子母弹头」：撒 5 颗、每颗半个母弹', `${kids.length} 颗`);
    }
    // 电磁脉冲：Boss 不吃
    {
      const w = Run.modWeapon(V('liehuo').w1, ['shock']);
      const g = arena();
      g.explode(g.units[1].x, g.units[1].y - 14, w, g.units[0], g.units[1], 1);
      check(g.units[1].stunned === 1, '「电磁脉冲」：炸到就麻痹一回合');
      const b = arena(null, { kit: 'crusher', boss: true });
      b.explode(b.units[1].x, b.units[1].y - 14, w, b.units[0], b.units[1], 1);
      check(!b.units[1].stunned, 'Boss 不吃麻痹');
    }
  }

  head('v1.3：商店刷新与事件');
  {
    const s = Run.newRun('liehuo'); s.gold = 100; s.step = 2;
    Run.enter(s, 1);
    const before = JSON.stringify(s.pending.stock);
    check(Run.rerollCost(s) === 15 && Run.reroll(s) && s.gold === 85, '刷新货架：第一次 15 金币');
    check(Run.rerollCost(s) === 25 && Run.reroll(s) && s.gold === 60 && Run.rerollCost(s) === 35, '每刷一次贵 10');
    check(JSON.stringify(s.pending.stock) !== before, '货架真的换了');
    s.gold = 10;
    check(Run.reroll(s) === false && s.gold === 10, '钱不够刷不了');
    check(Run.EVENTS.length >= 20, '事件扩到 20 个左右', `${Run.EVENTS.length} 个`);
    const t = Run.newRun('liehuo');
    const seen = new Set();
    for (let i = 0; i < Run.EVENTS.length; i++) {
      t.pending = null; t.layers[t.step] = [{ type: 'event' }];
      Run.enter(t, 0); seen.add(t.pending.id);
    }
    check(seen.size === Run.EVENTS.length, '一局里事件不重样，全见过一遍才会重复', `${seen.size} / ${Run.EVENTS.length}`);
    const poor = Run.newRun('liehuo'); poor.gold = 0; poor.relics = []; poor.items = [];
    poor.pending = { kind: 'event', id: 'foundry' };
    check(Run.eventChoose(poor, 0) === false && Run.eventChoose(poor, 1) === false && poor.pending.kind === 'event', '条件不够的选项选不了（没遗物熔、没钱修）');
    // 赏金公告：下一场金币翻倍，只管一场
    const b = Run.newRun('liehuo'); b.pending = { kind: 'event', id: 'bounty' };
    Run.eventChoose(b, 0); Run.leave(b);
    b.node = { type: 'fight', gold: 40 };
    Run.afterBattle(b, { units: [{ alive: true, items: [], hp: 500 }], result: 0, style: { gold: 0 } });
    const g1 = b.pending.gold; b.pending = null;
    b.node = { type: 'fight', gold: 40 };
    Run.afterBattle(b, { units: [{ alive: true, items: [], hp: 500 }], result: 0, style: { gold: 0 } });
    check(g1 === 80 && b.pending.gold === 40, '「赏金公告」：下一场金币翻倍，之后恢复', `${g1} → ${b.pending.gold}`);
    // 老存档（没有 v1.3 的新字段）照样能读、能打
    const old = Run.newRun('liehuo');
    delete old.seenEvents; delete old.atkBonus; delete old.fuelBonus; delete old.luck; delete old.nextGoldMul;
    const ok = (() => { try { Run.playerVehicle(old); Run.perks(old); old.layers[old.step] = [{ type: 'event' }]; Run.enter(old, 0); return !!old.pending; } catch (e) { return false; } })();
    check(ok, 'v1.2 的老存档缺新字段也能接着玩');
  }
  {
    Run.saveMeta({ medals: 0, unlocked: Run.STARTERS.slice(), asc: 0, wins: 0, runs: 0, best: 0 });
    const s = Run.newRun('liehuo'); s.battles = 5; s.bosses = 1;
    Run.finish(s, false);
    const m = Run.loadMeta();
    check(s.over && !s.won && s.earned === 8 && m.medals === 8 && m.runs === 1, '失败也按战绩发勋章', `+${s.earned}`);
    check(Run.load() === null, '远征结束后清掉存档');
    check(Run.unlock(m, 'honglong') && m.medals === 2 && m.unlocked.indexOf('honglong') >= 0, '勋章解锁新战车');
    check(Run.unlock(m, 'aodin') === false, '勋章不够不能解锁');
    const w = Run.newRun('liehuo'); w.act = 2; w.step = 4;
    Run.advance(w);
    check(w.over && w.won && Run.loadMeta().asc === 1, '打穿三个区域 = 通关，开放进阶 1');
  }

  // ================= v1.4 世界变大 =================
  // 直接给 Game 一份词条 / 限时，不经过远征
  const modGame = (mods, extra) => {
    const g = new RZ.Game(Object.assign({ mapId: 'dry', arcade: true, barrels: 0, humanTeam: 0, mods, roster: [
      { vehicle: V('liehuo'), team: 0, ai: false, name: '我', perks: {} },
      { vehicle: V('honglong'), team: 1, ai: true, name: '敌', perks: {} }] }, extra || {}));
    const floor = flatten(g); g.wind = 0;
    g.units[0].x = 300; g.units[1].x = 1500;
    g.units.forEach((u) => { u.y = floor; u.airborne = false; u.lastSeenX = u.x; u.lastSeenY = u.y; });
    return g;
  };
  const foe = (over) => Object.assign({ vid: 'honglong', name: '红龙', hpMul: 0.6, atkMul: 0.6, mods: { w1: [], w2: [], ss: [] }, perks: {} }, over || {});
  const runBattle = (enemies, node) => {
    const s = Run.newRun('liehuo');
    s.node = Object.assign({ type: 'fight', mapId: 'dry', enemies, gold: 20 }, node || {});
    return { s, g: new RZ.Game(Run.battleOpts(s)) };
  };

  head('v1.4：地图词条');
  {
    const dry = RZ.mapById('dry'), w0 = dry.windMax, g0 = dry.gravity;
    const gale = modGame(['gale']), low = modGame(['lowg']), plain = modGame([]);
    check(gale.map.windMax === Math.max(8, Math.round(w0 * 1.8)) && low.map.gravity < g0 * 0.7, '大风抬高风力上限，低重力压低重力');
    check(dry.windMax === w0 && dry.gravity === g0 && plain.map === dry, '改的是这一局的副本，RZ.MAPS 原件没动');
    const classic = new RZ.Game({ mapId: 'dry', mods: ['gale', 'night', 'meteor'], roster: [
      { vehicle: V('liehuo'), team: 0, ai: false, name: 'a' }, { vehicle: V('honglong'), team: 1, ai: true, name: 'b' }] });
    check(classic.mods.length === 0 && classic.map === dry && !classic.dark && classic.hudState().tags.length === 0, '经典规则不吃词条');
    check(gale.hudState().tags.map((t) => t.text).join() === '大风', '词条显示在战斗界面上');
    // 低重力：射程差不多，滞空明显变长（预览线跑的就是真实弹道，拿它量）
    const fly = (g) => {
      const u = g.units[0];
      g.guide = true; g.active = u; g.phase = 'aim'; u.aim = 45; u.markPower = 60; u.perks = { scope: 1 };
      const path = g.previewPath();
      return { frames: path.length / 2, range: path[path.length - 2] - path[0] };
    };
    const a = fly(plain), b = fly(low);
    check(b.frames > a.frames * 1.2 && Math.abs(b.range - a.range) / a.range < 0.15, '低重力：飞得更久，射程基本不变', `${a.frames}→${b.frames} 帧，${Math.round(a.range)}→${Math.round(b.range)}px`);
    // 大风：风真的刮得更大
    let peak = 0;
    for (let i = 0; i < 400; i++) { gale.stepWind(); peak = Math.max(peak, Math.abs(gale.wind)); }
    check(peak > w0 * 1.1, '大风：刮得出平时没有的风', `峰值 ${peak.toFixed(1)}，平时上限 ${w0}`);
    check(Object.keys(RZ.MAP_MODS).length === 4, '四种词条', Object.keys(RZ.MAP_MODS).join(' '));
  }

  head('v1.4：夜战');
  {
    const g = modGame(['night']);
    const me = g.units[0], en = g.units[1];
    check(g.dark && g.hiddenFrom(0, en) && g.hiddenFrom(1, me), '离得远、没被照亮：双方互相看不见');
    check(!g.hiddenFrom(0, me), '自己人永远看得见');
    en.x = 1200; g.update(16);
    check(g.knownPos(0, en).x === 1500, '它挪了位置，我只知道最后看见它的地方', `以为在 ${g.knownPos(0, en).x}，其实在 ${en.x}`);
    // 火光照亮
    g.explode(en.x + 120, en.y - 10, V('liehuo').w1, me, null, 1);
    g.update(16);
    check(!g.hiddenFrom(0, en) && g.knownPos(0, en).x === en.x, '炮弹落在它附近：火光照出了它');
    const litX = en.x;
    g.turnNo++;
    check(g.hiddenFrom(0, en), '过了这一回合又看不见了');
    en.x = litX - 200; g.update(16);
    check(g.knownPos(0, en).x === litX, '但记住了它被照亮时的位置');
    // 靠近
    en.x = me.x + 300; g.update(16);
    check(!g.hiddenFrom(0, en) && !g.hiddenFrom(1, me), '离得近（420px 内）互相看得见');
    en.x = 1500; g.update(16); g.turnNo++;
    check(g.hiddenFrom(0, en), '拉开距离又丢了');
    // 地火
    g.addHazard('fire', en.x + 40, en.y, 60, 2, 30, me);
    check(!g.hiddenFrom(0, en), '站在地火旁边会被照亮');
    g.hazards.length = 0;
    // 挨打
    g.turnNo++;
    check(g.hiddenFrom(0, en), '火灭了又看不见');
    g.damage(en, 10, me);
    check(!g.hiddenFrom(0, en), '挨了打就暴露');
    // 开炮不暴露
    const h = modGame(['night']);
    h.active = h.units[1]; h.phase = 'aim'; h.units[1].fuel = 100; h.units[1].aim = 80; h.units[1].power = 30;
    h.fire();
    check(h.hiddenFrom(0, h.units[1]), '开炮不会暴露位置（只看得到炮弹从哪飞出来）');
  }

  head('v1.4：陨石雨');
  {
    const g = modGame(['meteor']);
    const marks = g.telegraphs.filter((t) => t.strike === 'meteor');
    check(marks.length === 2 && marks.every((t) => t.owner === null), '每一轮开头圈两块地', `${marks.length} 块`);
    check(g.dangerAt(marks[0].x, 300), '陨石的警戒线算危险地带（电脑会躲）');
    const xs = marks.map((t) => t.x);
    g.armTelegraphs(g.units[0]);
    check(g.pendingBlasts.length === 0, '这一轮里不会落');
    const solid = (t) => { let n = 0; for (let i = 0; i < t.mask.length; i++) n += t.mask[i]; return n; };
    const before = solid(g.terrain);
    g.startRound();
    check(g.pendingBlasts.length === 2 && g.telegraphs.length === 2 && g.telegraphs.every((t) => xs.indexOf(t.x) < 0), '下一轮开头：上一轮圈的落下来，再圈两块新的');
    settle(g, 200);
    check(solid(g.terrain) < before, '陨石真的砸出了坑');
    // 砸到谁算谁
    const k = modGame(['meteor']);
    k.telegraphs.length = 0;
    k.telegraphs.push({ x: k.units[1].x, r: 62, owner: null, armed: true, strike: 'meteor', power: 95, born: 0, seed: 0 });
    const hp0 = k.units[1].hp;
    k.resolveTelegraphs(null); settle(k, 200);
    check(k.units[1].hp < hp0, '陨石不分敌我，砸到谁算谁', `-${Math.round(hp0 - k.units[1].hp)}`);
  }

  head('v1.4：新敌人');
  {
    const st = Run.newRun('liehuo'); st.act = 1; st.step = 3;
    const find = (kind) => { for (let i = 0; i < 800; i++) for (const layer of Run.genLayers(st)) for (const n of layer) if (n.enemies && n.enemies.some((e) => e.kind === kind)) return n; };
    const tn = find('turret'), sn = find('swarm'), bn = find('bomber');
    check(tn && sn && bn, '路线上会刷出炮台、小车群、自爆车');
    check(sn.enemies.length >= 3 && sn.enemies.every((e) => e.kind === 'swarm'), '小车群至少三辆', `${sn.enemies.length} 辆`);

    // 炮台
    {
      const { g } = runBattle(tn.enemies);
      const t = g.units.find((u) => u.perks.rooted);
      check(t.vehicle.art === 'turret' && t.vehicle.tag === '固定炮台', '炮台有自己的样子');
      g.active = t; g.phase = 'aim'; t.fuel = 100;
      const x0 = t.x; for (let i = 0; i < 30; i++) g.moveActive(1);
      check(t.x === x0, '炮台挪不动');
      const vx0 = t.vx || 0;
      g.explode(t.x - 20, t.y - 10, V('liehuo').w1, g.units[0], null, 1);
      check((t.vx || 0) === vx0, '炮台掀不走');
      check(V(tn.enemies[0].vid).art !== 'turret', '原始战车数据没被改');
    }
    // 小车：只打一号武器、个头小
    {
      const { g } = runBattle(sn.enemies);
      const c = g.units[1];
      c.fuel = 200;
      check(!c.canAfford(c.vehicle.w2) && !c.canAfford(c.vehicle.ss) && c.canAfford(c.vehicle.w1) && c.scale < 1, '小车只打得出一号武器，个头也小');
      const same = [foe({ kind: 'swarm' }), foe({ kind: 'swarm' }), foe({ kind: 'swarm' })];
      const names = runBattle(same).g.units.slice(1).map((u) => u.name);
      check(names.join() === '红龙,红龙·2,红龙·3', '同名的敌人按顺序编号', names.join(' '));
    }
    // 自爆车
    {
      const { g } = runBattle([foe({ kind: 'bomber', vid: 'liehuo', name: '自爆车', perks: { kamikaze: 1 } })]);
      const floor = flatten(g); g.wind = 0;
      const me = g.units[0], b = g.units[1];
      me.x = 400; b.x = 900; [me, b].forEach((u) => { u.y = floor; u.airborne = false; });
      check(b.vehicle.art === 'bomb', '自爆车有自己的样子');
      g.active = b; g.phase = 'aim'; g.aiTimer = 0;
      let n = 0; while (g.phase === 'aim' && n++ < 400) g.updateAI();
      const d1 = b.x;
      check(d1 < 900 - 150 && d1 > 400 && b.alive && !b.firedThisTurn, '自爆车不开炮，一回合朝玩家开一大段', `900 → ${Math.round(d1)}`);
      // 接下来几个回合：贴上就炸
      const hp0 = me.hp;
      for (let turn = 0; turn < 4 && b.alive; turn++) {
        g.active = b; g.phase = 'aim'; g.aiTimer = 0; b.kamiLeft = null;
        n = 0; while (g.phase === 'aim' && b.alive && n++ < 400) g.updateAI();
      }
      check(!b.alive && me.hp < hp0, '贴上玩家就引爆，自己也没了', `玩家 -${Math.round(hp0 - me.hp)}`);
      check(g.pendingBlasts.every((p) => p.w.name !== '殉爆'), '自己引爆的不会再殉爆一次');
    }
    {
      // 打死自爆车：原地殉爆，炸到它的同伙
      const { g } = runBattle([foe({ kind: 'bomber', vid: 'liehuo', name: '自爆车', perks: { kamikaze: 1 } }), foe()]);
      const floor = flatten(g); g.wind = 0;
      const me = g.units[0], b = g.units[1], pal = g.units[2];
      me.x = 300; b.x = 1200; pal.x = 1250; g.units.forEach((u) => { u.y = floor; u.airborne = false; });
      const hp0 = pal.hp;
      g.damage(b, 99999, me);
      settle(g, 120);
      check(!b.alive && pal.hp < hp0, '打死自爆车会原地殉爆，炸到它旁边的同伙', `同伙 -${Math.round(hp0 - pal.hp)}`);
    }
    {
      // 自爆车不往悬崖下开
      const { g } = runBattle([foe({ kind: 'bomber', vid: 'liehuo', name: '自爆车', perks: { kamikaze: 1 } })], { mapId: 'sky' });
      const b = g.units[1];
      for (let turn = 0; turn < 6 && b.alive; turn++) {
        g.active = b; g.phase = 'aim'; g.aiTimer = 0; b.kamiLeft = null;
        let n = 0; while (g.phase === 'aim' && b.alive && n++ < 400) { g.updateAI(); g.update(16); }
        settle(g, 60);
      }
      check(b.alive || b.bombed, '浮岛上的自爆车不会自己开下悬崖（要么还活着，要么是贴上去炸的）');
    }
  }

  head('v1.4：新节点');
  {
    // 限回合挑战
    const { s, g } = runBattle([foe()], { type: 'trial', limit: 3 });
    check(g.roundLimit === 3 && g.hudState().tags[0].text.indexOf('限时') === 0, '限时挑战显示打到第几轮', g.hudState().tags[0].text);
    for (let f = 0; f < 40000 && g.result === null; f++) {
      g.update(16);
      if (g.phase === 'aim') { g.aiTimer = 9999; g.passTurn(); }
    }
    check(g.trialFailed && g.result === 0 && g.round === 4, '轮数打完没全歼：战斗结束，不算输', `第 ${g.round} 轮`);
    const gold0 = s.gold, relics0 = s.relics.length;
    Run.afterBattle(s, g);
    check(!s.over && s.pending.kind === 'note' && s.gold === gold0 && s.relics.length === relics0, '超时没有奖励，远征继续');
    check(Run.leave(s) && s.step === 1, '看完提示往前走一层');
    const win = runBattle([foe()], { type: 'trial', limit: 3 });
    win.g.units[1].alive = false; win.g.units[1].hp = 0; win.g.checkWin();
    Run.afterBattle(win.s, win.g);
    const ch = win.s.pending.choices;
    check(win.s.pending.kind === 'reward' && ch.filter((c) => c.type === 'relic').length === 2 && Run.modById(ch[2].id).rare, '限时内打赢：拿精英级奖励（两件稀有遗物 + 稀有改造）');
    check(Run.isBattle({ type: 'trial' }) && !Run.isBattle({ type: 'chest' }) && !Run.isBattle({ type: 'altar' }), '限时挑战要打，宝箱和祭坛不用');

    // 宝箱
    const c = Run.newRun('liehuo');
    c.layers[c.step] = [{ type: 'chest' }];
    const g0 = c.gold;
    check(Run.enter(c, 0) === false && c.pending.kind === 'reward' && c.pending.from === 'chest' && c.gold > g0 && c.pending.choices.length === 2, '宝箱：白拿一笔金币，再二选一', `+${c.gold - g0} 金币`);
    const pickIdx = c.pending.choices.findIndex((x) => x.type === 'relic');
    check(Run.takeReward(c, pickIdx) && c.relics.length === 1 && c.step === 1, '拿了东西往前走');

    // 诅咒祭坛
    const a = Run.newRun('liehuo');
    a.layers[a.step] = [{ type: 'altar' }];
    Run.enter(a, 0);
    const ev = Run.eventById(a.pending.id);
    check(a.pending.kind === 'event' && ev.id === 'altar' && Run.EVENTS.indexOf(ev) < 0, '祭坛是专门的节点，不进随机事件池');
    check(!Run.canChoose(a, ev.options[2]) && Run.canChoose(a, ev.options[3]), '没有诅咒时不能净化；随时可以转身走');
    const hpMax = Run.maxHp(a);
    Run.eventChoose(a, 0);
    check(Run.maxHp(a) <= hpMax - 80 && a.relics.length === 1 && Run.relicById(a.relics[0]).rarity === 'rare', '献上装甲：最大耐久 -80，换一件稀有遗物');
    const b2 = Run.newRun('liehuo'); b2.pending = { kind: 'event', id: 'altar' };
    Run.eventChoose(b2, 1);
    const mods = b2.mods.w1.concat(b2.mods.w2);
    check(Run.curses(b2).length === 1 && mods.length === 1 && Run.modById(mods[0]).rare && b2.gold === 80, '接受诅咒：一件诅咒遗物，换稀有改造 + 50 金币');
    b2.pending = { kind: 'event', id: 'altar' };
    Run.eventChoose(b2, 2);
    check(Run.curses(b2).length === 0, '净化：把诅咒洗掉');

    // 路线生成
    const types = {};
    for (let i = 0; i < 300; i++) { const t = Run.newRun('liehuo'); t.layers.forEach((L) => L.forEach((n) => { types[n.type] = (types[n.type] || 0) + 1; })); }
    check(types.trial > 20 && types.chest > 5 && types.altar > 20, '路线上会出现限时挑战、宝箱、祭坛', JSON.stringify(types));
    let early = 0, bossMods = 0;
    for (let i = 0; i < 200; i++) {
      const t = Run.newRun('liehuo');
      t.layers[0].forEach((n) => { if ((n.mods && n.mods.length) || n.enemies.some((e) => e.kind)) early++; });
      if (t.layers[4][0].mods && t.layers[4][0].mods.length) bossMods++;
    }
    check(early === 0 && bossMods === 0, '开局第一层没有词条和特殊敌人；Boss 战不带词条');
    let second = 0, goldOk = true;
    for (let i = 0; i < 200; i++) {
      const t = Run.newRun('liehuo');
      if (t.layers[1].some((n) => n.mods && n.mods.length)) second++;
      t.layers.forEach((L) => L.forEach((n) => { if (n.type === 'fight' && n.enemies.length === 1 && !n.enemies[0].kind && n.gold !== 32 + (L === t.layers[0] ? 0 : t.layers.indexOf(L)) * 3 + (n.mods && n.mods.length ? 10 : 0)) goldOk = false; }));
    }
    check(second === 200, '每个区域的第二层一定有一场带词条的仗', `${second} / 200`);
    check(goldOk, '补上去的词条照样多给 10 金币，不多不少');
    // 低重力的图不叠低重力
    let bad = 0;
    for (let i = 0; i < 300; i++) {
      const t = Run.newRun('liehuo'); t.act = 1 + (i % 2); t.layers = Run.genLayers(t);
      t.layers.forEach((L) => L.forEach((n) => { if (n.mods && n.mods.indexOf('lowg') >= 0 && RZ.mapById(n.mapId).gravity < 0.34) bad++; }));
    }
    check(bad === 0, '本来就低重力的图不会再叠「低重力」');
    // 老存档的节点没有 mods / limit / kind
    const old = Run.newRun('liehuo');
    old.node = { type: 'fight', mapId: 'dry', enemies: [foe()], gold: 10 };
    const og = new RZ.Game(Run.battleOpts(old));
    check(og.mods.length === 0 && og.roundLimit === 0, 'v1.3 存档里的节点（没有词条字段）照样能打');
  }

  head('远征：电脑代打跑完整局');
  {
    Run.saveMeta({ medals: 0, unlocked: Run.STARTERS.slice(), asc: 0, wins: 0, runs: 0, best: 0 });
    let fights = 0, err = null, s = null;
    for (let r = 0; r < 2 && !err; r++) {
      s = Run.newRun(Run.STARTERS[r]);
      let guard = 0;
      try {
        while (!s.over && guard++ < 300) {
          const p = s.pending;
          if (p) {
            if (p.kind === 'event') {
              if (Run.eventChoose(s, guard % 2) !== 'fight') continue;   // 事件转成战斗就接着往下打
            } else {
              if (p.kind === 'reward') Run.takeReward(s, guard % 3, ['w1', 'w2', 'ss'][guard % 3]);
              else if (p.kind === 'shop') { p.stock.forEach((x, i) => Run.buy(s, i, 'w1')); Run.leave(s); }
              else if (p.kind === 'rest') Run.rest(s, 'repair');
              else Run.leave(s);
              continue;
            }
          } else if (!Run.enter(s, guard % Run.choices(s).length)) continue;
          const g = new RZ.Game(Run.battleOpts(s, 'hard'));
          let f = 0;
          while (g.result === null && f < 60 * 60 * 12) { g.update(16); f++; }
          if (g.result === null) throw new Error('战斗没打完');
          Run.afterBattle(s, g);
          fights++;
        }
      } catch (e) { err = e; }
      check(!err && s.over, `第 ${r + 1} 次远征跑到了结局`, err ? String(err.stack || err) : `${s.won ? '通关' : '倒在区域 ' + (s.act + 1)} · 打赢 ${s.battles} 场`);
    }
    check(fights >= 4, '中途确实打了不少场', `${fights} 场`);
    check(Run.loadMeta().runs === 2, '局外存档记下了这两次远征');
  }
};

if (require.main === module) {
  const RZ = loadRZ();
  let pass = 0, fail = 0;
  module.exports(RZ, (ok, label, extra) => {
    if (ok) pass++; else fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
  }, (t) => console.log(`\n${t}`));
  console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}

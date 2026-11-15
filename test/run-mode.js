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
    check(me.hp < hp0 && me.rescueLeft === 0, '回收要掉血，且每场只有一次', `${hp0}→${Math.round(me.hp)}`);
    me.y = RZ.WORLD_H + 80; me.airborne = true; me.vy = 2;
    settle(g, 60);
    check(!me.alive, '第二次掉下去就真的出局');
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
    for (const ev of Run.EVENTS) {
      for (let k = 0; k < ev.options.length; k++) {
        const t = Run.newRun('liehuo');
        t.pending = { kind: 'event', id: ev.id };
        const ok = Run.eventChoose(t, k) && t.pending.kind === 'note' && t.pending.text.length > 0 && t.hp >= 1;
        check(ok && Run.leave(t) && t.step === 1, `事件「${ev.title}」选项 ${k + 1}`);
      }
    }
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
            if (p.kind === 'reward') Run.takeReward(s, guard % 3, ['w1', 'w2', 'ss'][guard % 3]);
            else if (p.kind === 'shop') { p.stock.forEach((x, i) => Run.buy(s, i, 'w1')); Run.leave(s); }
            else if (p.kind === 'rest') Run.rest(s, 'repair');
            else if (p.kind === 'event') Run.eventChoose(s, guard % 2);
            else Run.leave(s);
            continue;
          }
          if (!Run.enter(s, guard % Run.choices(s).length)) continue;
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

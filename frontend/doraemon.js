(() => {
  "use strict";

  const canvas = document.getElementById("office-canvas");
  const ctx = canvas.getContext("2d");

  const params = new URLSearchParams(window.location.search);
  const IS_URL_SCREENSAVER = params.get("screensaver") === "1";

  let currentView = params.get("room") ? "room" : "hub"; // 'hub' | 'room'
  let activeRoomSessionCid = params.get("room") || null;
  let activeRoomObj = null;
  let allRoomsCatalog = [
    { id: "nobita",     name: "大雄的榻榻米开发室", bg: "/assets/doraemon/rooms/room_nobita.jpg",     door: [0.285, 0.565], accent: "#009fe8" },
    { id: "future_lab", name: "22世纪未来道具实验室", bg: "/assets/doraemon/rooms/room_future_lab.jpg", door: [0.18, 0.56],   accent: "#06b6d4" },
    { id: "shizuka",    name: "静香的暖阳花房书房",   bg: "/assets/doraemon/rooms/room_shizuka.jpg",    door: [0.16, 0.56],   accent: "#ec4899" },
    { id: "treehouse",  name: "后山秘密树屋基地",     bg: "/assets/doraemon/rooms/room_treehouse.jpg",  door: [0.22, 0.56],   accent: "#22c55e" },
    { id: "time_space", name: "时光机·次元控制台",    bg: "/assets/doraemon/rooms/room_time_space.jpg", door: [0.22, 0.56],   accent: "#a855f7" },
    { id: "cloud",      name: "云之王国·天空工作室",  bg: "/assets/doraemon/rooms/room_cloud.jpg",      door: [0.22, 0.56],   accent: "#eab308" },
  ];

  let mode = params.get("demo") === "1" ? "demo" : "live"; // 'live' | 'demo'
  let fitMode = "cover";
  let lightingMode = "day";
  let inspectedAgentId = null;
  let hoveredActorId = null;

  // User manual room override per session (persisted in localStorage)
  const roomOverrides = JSON.parse(localStorage.getItem("doraemon_room_overrides") || "{}");

  // Preload all 7 environment backgrounds
  const HUB_BG_URL = "/assets/doraemon/rooms/hub_plaza.jpg";
  const bgCache = new Map();
  function getBgImage(url) {
    if (!bgCache.has(url)) {
      const img = new Image();
      img.src = url;
      bgCache.set(url, img);
    }
    return bgCache.get(url);
  }
  getBgImage(HUB_BG_URL);
  allRoomsCatalog.forEach((r) => getBgImage(r.bg));

  // Preload all 5 character skins × 4 poses (ALL 5 work poses use computers!)
  const SKINS = ["leader", "coder", "researcher", "engineer", "scout"];
  const POSES = ["idle", "work", "walk", "eureka"];
  const sprites = {};
  for (const s of SKINS) {
    sprites[s] = {};
    for (const p of POSES) {
      const img = new Image();
      img.src = `/assets/doraemon/sprites/${s}_${p}.png`;
      sprites[s][p] = img;
    }
  }

  // Spacious Hub Plaza slots (8 well-separated positions kept safely inside visible viewport!)
  const HUB_SLOTS = [
    { x: 0.50, y: 0.69 }, // Center spotlight (most active session!)
    { x: 0.29, y: 0.65 }, // Left-mid grass
    { x: 0.71, y: 0.65 }, // Right-mid grass
    { x: 0.37, y: 0.80 }, // Front-left plaza
    { x: 0.63, y: 0.78 }, // Front-right plaza
    { x: 0.24, y: 0.76 }, // Lower-left plaza
    { x: 0.76, y: 0.73 }, // Lower-right plaza
    { x: 0.58, y: 0.58 }, // Upper-right near wooden fence (clear of center!)
  ];

  // Spacious Private Room computer workstation slots (balanced left/center/right, clear of ticker!)
  const ROOM_SLOTS = {
    leader: { x: 0.49, y: 0.69 },
    work: [
      { x: 0.22, y: 0.72 }, // Left desk side
      { x: 0.77, y: 0.70 }, // Right workstation side
      { x: 0.35, y: 0.81 }, // Front-left floor
      { x: 0.64, y: 0.76 }, // Mid-right floor
      { x: 0.28, y: 0.62 }, // Upper-left near door
      { x: 0.70, y: 0.60 }, // Upper-right near window/shelf
      { x: 0.50, y: 0.82 }, // Front-center floor
    ],
    huddle: [
      { x: 0.50, y: 0.68 },
      { x: 0.34, y: 0.72 },
      { x: 0.66, y: 0.72 },
      { x: 0.40, y: 0.82 },
      { x: 0.60, y: 0.80 },
      { x: 0.24, y: 0.78 },
      { x: 0.75, y: 0.68 },
    ],
    idle: [
      { x: 0.37, y: 0.67 },
      { x: 0.50, y: 0.72 },
      { x: 0.63, y: 0.67 },
      { x: 0.25, y: 0.76 },
      { x: 0.74, y: 0.71 },
      { x: 0.41, y: 0.82 },
      { x: 0.59, y: 0.80 },
    ],
  };

  // Every working state uses 'work' (laptop/computer typing pose!)
  const STATE_META = {
    delegating:  { pose: "walk",   color: "#e83828", label: "派发任务", icon: "🚪" },
    writing:     { pose: "work",   color: "#009fe8", label: "敲电脑中", icon: "💻" },
    researching: { pose: "work",   color: "#ec4899", label: "电脑调研", icon: "💻" },
    executing:   { pose: "work",   color: "#f97316", label: "电脑执行", icon: "💻" },
    browsing:    { pose: "work",   color: "#06b6d4", label: "电脑探索", icon: "💻" },
    eureka:      { pose: "eureka", color: "#eab308", label: "搞定啦",   icon: "💡" },
    error:       { pose: "eureka", color: "#ef4444", label: "需支援",   icon: "💦" },
    idle:        { pose: "idle",   color: "#22c55e", label: "休息中",   icon: "🍩" },
  };

  const actors = new Map();
  let doorGlow = 0;
  let delegationBeam = null;
  let overrideActionUntil = 0;
  let overrideActionType = null;
  let lastPatrolCheck = 0;
  let particles = [];
  let dustMotes = [];

  for (let i = 0; i < 24; i++) {
    dustMotes.push({
      x: 0.2 + Math.random() * 0.6,
      y: 0.18 + Math.random() * 0.66,
      vx: (Math.random() - 0.5) * 0.008,
      vy: 0.004 + Math.random() * 0.007,
      r: 1.5 + Math.random() * 2.4,
      phase: Math.random() * Math.PI * 2,
    });
  }

  // Demo Data: 6 distinct sessions (each owns 1 of the 6 unique rooms!)
  const DEMO_SESSIONS = [
    { id: "demo-1", name: "小八19集云端制片", title: "1124小八 19集云端并发制片", skin: "leader",     room_id: "nobita",     state: "executing",   detail: "带 19 位组员用电脑云端渲染中!", child_count: 19, working_count: 12 },
    { id: "demo-2", name: "未来道具实验室",   title: "AI 自动化视频剪辑管线研发",  skin: "coder",      room_id: "future_lab", state: "writing",     detail: "正在电脑前写核心推理引擎代码!", child_count: 4,  working_count: 4 },
    { id: "demo-3", name: "花房视觉设计室",   title: "二次元角色立绘与分镜调研",   skin: "researcher", room_id: "shizuka",    state: "researching", detail: "正在粉色笔记本检索美术参考!",   child_count: 3,  working_count: 3 },
    { id: "demo-4", name: "后山树屋运维站",   title: "Colab GPU 集群调度与压测",   skin: "engineer",   room_id: "treehouse",  state: "executing",   detail: "正在用电脑监控多卡显存并发!",   child_count: 4,  working_count: 3 },
    { id: "demo-5", name: "次元浏览器侦探社", title: "全自动网页数据抓取与验收",   skin: "scout",      room_id: "time_space", state: "browsing",    detail: "正在电脑前跑自动化视觉走查!",   child_count: 3,  working_count: 2 },
    { id: "demo-6", name: "云之王国灵感库",   title: "新爆款剧本脑暴与策划",       skin: "leader",     room_id: "cloud",      state: "eureka",      detail: "刚灵光一闪写完 5 集大纲💡",     child_count: 2,  working_count: 1 },
  ];

  function getRoomById(rid) {
    return allRoomsCatalog.find((r) => r.id === rid) || allRoomsCatalog[0];
  }

  function createActor(data, spawnAtDoor = false) {
    const door = activeRoomObj?.door || [0.24, 0.56];
    const sx = spawnAtDoor ? door[0] : 0.5;
    const sy = spawnAtDoor ? door[1] : 0.7;
    return {
      ...data,
      x: sx,
      y: sy,
      tx: sx,
      ty: sy,
      facing: 1,
      scalePop: spawnAtDoor ? 0.15 : 1.0,
      flyingCopter: spawnAtDoor ? 2.0 : 0,
      bobPhase: Math.random() * Math.PI * 2,
      manualPose: null,
      manualPoseUntil: 0,
      screenRect: { x: 0, y: 0, w: 0, h: 0 },
    };
  }

  function spawnSparkles(nx, ny, count = 10, color = "#ffd43b", glyph = null) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.025 + Math.random() * 0.055;
      particles.push({
        x: nx,
        y: ny,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 0.04,
        life: 0.7 + Math.random() * 0.65,
        size: 6 + Math.random() * 6,
        color,
        glyph,
      });
    }
  }

  function assignHubTargets(list, isInitialLoad) {
    // Clamp hub coordinates within the actually visible horizontal viewport (even on narrow windows!)
    const visMinX = Math.max(0.16, (-stageRect.x + 84) / Math.max(1, stageRect.w));
    const visMaxX = Math.min(0.84, (window.innerWidth - stageRect.x - 84) / Math.max(1, stageRect.w));
    const span = Math.max(0.2, visMaxX - visMinX);

    list.forEach((a, idx) => {
      const raw = HUB_SLOTS[idx % HUB_SLOTS.length];
      // Remap [0.24..0.76] smoothly into [visMinX..visMaxX]
      const norm = Math.max(0, Math.min(1, (raw.x - 0.24) / 0.52));
      const tx = visMinX + norm * span;
      const ty = raw.y;
      a.tx = tx;
      a.ty = ty;
      if (isInitialLoad) {
        a.x = tx;
        a.y = ty;
        a.facing = tx > 0.55 ? -1 : 1;
      }
    });
  }

  function assignRoomTargets(list, isInitialLoad) {
    let workerIdx = 0;
    const overrideNow = overrideActionUntil > performance.now();

    list.forEach((a, idx) => {
      let slot;
      if (overrideNow && overrideActionType === "huddle") {
        slot = ROOM_SLOTS.huddle[idx % ROOM_SLOTS.huddle.length];
      } else if (overrideNow && overrideActionType === "dorayaki") {
        slot = ROOM_SLOTS.idle[idx % ROOM_SLOTS.idle.length];
      } else if (overrideNow && overrideActionType === "celebrate") {
        slot = ROOM_SLOTS.huddle[idx % ROOM_SLOTS.huddle.length];
      } else if (a.is_leader) {
        slot = ROOM_SLOTS.leader;
      } else if (a.state === "idle") {
        slot = ROOM_SLOTS.idle[(workerIdx++ + 1) % ROOM_SLOTS.idle.length];
      } else {
        slot = ROOM_SLOTS.work[workerIdx++ % ROOM_SLOTS.work.length];
      }

      if (isInitialLoad) {
        a.x = slot.x;
        a.y = slot.y;
        a.tx = slot.x;
        a.ty = slot.y;
        a.facing = slot.x > 0.55 ? -1 : 1;
      } else {
        const dist = Math.hypot(slot.x - a.tx, slot.y - a.ty);
        if (dist > 0.28 && !a.is_leader) a.flyingCopter = Math.max(a.flyingCopter, 1.5);
        a.tx = slot.x;
        a.ty = slot.y;
      }
    });

    // Soft pairwise repulsion so characters & nameplates stay cleanly separated
    for (let iter = 0; iter < 6; iter++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const dx = b.tx - a.tx;
          const dy = b.ty - a.ty;
          const minX = 0.135;
          const minY = 0.082;
          if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
            const px = (dx >= 0 ? 1 : -1) * (minX - Math.abs(dx)) * 0.55;
            const py = (dy >= 0 ? 1 : -1) * (minY - Math.abs(dy)) * 0.45;
            if (!a.is_leader) { a.tx -= px; a.ty -= py; }
            if (!b.is_leader) { b.tx += px; b.ty += py; }
            else { a.tx -= px; a.ty -= py; }
          }
        }
      }
      for (const a of list) {
        a.tx = Math.max(0.16, Math.min(0.81, a.tx));
        const maxY = a.tx > 0.62 ? 0.75 : 0.84;
        a.ty = Math.max(0.57, Math.min(maxY, a.ty));
        if (isInitialLoad) { a.x = a.tx; a.y = a.ty; }
      }
    }
  }

  function syncActors(incomingList, eventsList, headerInfo) {
    const isInitialLoad = actors.size === 0;
    const alive = new Set(incomingList.map((x) => x.id));
    for (const id of Array.from(actors.keys())) {
      if (!alive.has(id)) actors.delete(id);
    }

    let newlySpawned = null;
    incomingList.forEach((item) => {
      let a = actors.get(item.id);
      if (!a) {
        const fromDoor = !isInitialLoad && currentView === "room" && !item.is_leader;
        a = createActor(item, fromDoor);
        actors.set(item.id, a);
        if (fromDoor) {
          doorGlow = 1.0;
          const door = activeRoomObj?.door || [0.24, 0.56];
          spawnSparkles(door[0], door[1] - 0.05, 14, "#ff80bf", "✦");
          newlySpawned = a;
        }
      } else {
        Object.assign(a, {
          name: item.name,
          title: item.title || a.title,
          role: item.role || a.role,
          skin: item.skin || a.skin,
          state: item.state,
          detail: item.detail || "",
          prompt: item.prompt || a.prompt,
          room_id: item.room_id || a.room_id,
          room_name: item.room_name || a.room_name,
          room_accent: item.room_accent || a.room_accent,
          child_count: item.child_count ?? a.child_count,
          working_count: item.working_count ?? a.working_count,
          last_tool: item.last_tool || "",
          steps: item.steps || 0,
          updated_at: item.updated_at || "",
        });
      }
    });

    const list = Array.from(actors.values());
    if (currentView === "hub") {
      assignHubTargets(list, isInitialLoad);
    } else {
      assignRoomTargets(list, isInitialLoad);
      if (newlySpawned) {
        const leader = list.find((x) => x.is_leader);
        if (leader) {
          delegationBeam = { fromId: leader.id, toId: newlySpawned.id, text: `派发任务给 ${newlySpawned.name}!`, until: performance.now() + 4200 };
        }
      }
    }

    updateHudChrome(eventsList || [], list.length, headerInfo);
    updateInspectorIfOpen();
  }

  function updateHudChrome(events, count, headerInfo) {
    const isHub = currentView === "hub";
    document.getElementById("btn-back-hub")?.classList.toggle("hidden", isHub);
    document.getElementById("btn-switch-room")?.classList.toggle("hidden", isHub);

    if (isHub) {
      document.getElementById("brand-icon").textContent = "🌳";
      document.getElementById("brand-title").textContent = "哆啦A梦 · 秘密空地主广场";
      document.getElementById("status-subtitle").textContent =
        `共 ${count} 个 Antigravity 会话 · 点击任意小人进入他的专属房间`;
      document.getElementById("ticker-title").textContent = "空地广场实时会话";
      document.getElementById("squad-count").textContent = `${count} 个会话`;
      const busyTotal = Array.from(actors.values()).reduce((s, a) => s + (a.working_count || (a.state !== "idle" ? 1 : 0)), 0);
      document.getElementById("saver-squad").textContent =
        busyTotal > 0 ? `秘密基地 · ${count} 个会话 · ${busyTotal} 位正在敲电脑` : `秘密空地广场 · ${count} 个会话`;
    } else {
      const rName = activeRoomObj?.name || "秘密开发室";
      document.getElementById("brand-icon").textContent = "🚪";
      document.getElementById("brand-title").textContent = `🏠 ${rName}`;
      document.getElementById("status-subtitle").textContent = headerInfo?.subtitle || "组长与子 Agent 正在用电脑协作中…";
      document.getElementById("ticker-title").textContent = `${rName} · 实时动态`;
      document.getElementById("squad-count").textContent = `${count} 位成员`;
      const busy = Array.from(actors.values()).filter((a) => a.state !== "idle").length;
      document.getElementById("saver-squad").textContent = `${rName} · ${busy}/${count} 正在电脑前干活`;
    }

    const ul = document.getElementById("ticker-list");
    if (!events.length) {
      ul.innerHTML = "<li>💻 大家都在各自岗位待命中~</li>";
      return;
    }
    ul.innerHTML = events
      .slice(0, 4)
      .map(
        (ev) =>
          `<li><span class="t-time">${escapeHtml(ev.time || "")}</span><strong>${escapeHtml(
            ev.who || ""
          )}</strong> ${escapeHtml(ev.text || "")}</li>`
      )
      .join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Smooth Anywhere Door Portal Transition
  function runPortalTransition(labelText, onSwitch) {
    const overlay = document.getElementById("portal-overlay");
    document.getElementById("portal-label").textContent = labelText;
    overlay.classList.add("active");
    setTimeout(() => {
      closeInspector();
      actors.clear();
      delegationBeam = null;
      overrideActionUntil = 0;
      onSwitch();
      setTimeout(() => {
        overlay.classList.remove("active");
      }, 240);
    }, 260);
  }

  function enterRoom(sessionCid, sessionTitle, roomObj) {
    const resolvedRoom = roomOverrides[sessionCid]
      ? getRoomById(roomOverrides[sessionCid])
      : roomObj || allRoomsCatalog[0];
    runPortalTransition(`🚪 穿过任意门 · 进入「${resolvedRoom.name}」`, () => {
      currentView = "room";
      activeRoomSessionCid = sessionCid;
      activeRoomObj = resolvedRoom;
      doorGlow = 1.0;
      if (mode === "demo") {
        renderDemoRoom(sessionCid);
      } else {
        pollBackend();
      }
    });
  }

  function returnToHub() {
    if (currentView === "hub") return;
    runPortalTransition("🚪 穿过任意门 · 返回野比社区空地广场", () => {
      currentView = "hub";
      activeRoomSessionCid = null;
      activeRoomObj = null;
      if (mode === "demo") {
        renderDemoHub();
      } else {
        pollBackend();
      }
    });
  }

  // Backend Polling
  async function pollBackend() {
    if (mode !== "live") return;
    try {
      if (currentView === "hub") {
        const resp = await fetch("/api/antigravity/hub");
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.rooms?.length) {
          allRoomsCatalog = data.rooms;
          allRoomsCatalog.forEach((r) => getBgImage(r.bg));
        }
        const sessions = (data.sessions || []).map((s) => {
          const ov = roomOverrides[s.id];
          if (ov) {
            const rm = getRoomById(ov);
            return { ...s, room_id: rm.id, room_name: rm.name, room_accent: rm.accent };
          }
          return s;
        });
        syncActors(sessions, data.events || [], {});
      } else if (activeRoomSessionCid) {
        const resp = await fetch(`/api/antigravity/room/${encodeURIComponent(activeRoomSessionCid)}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.rooms?.length) allRoomsCatalog = data.rooms;
        const ov = roomOverrides[activeRoomSessionCid];
        activeRoomObj = ov ? getRoomById(ov) : data.room || allRoomsCatalog[0];
        const combined = [];
        if (data.leader) combined.push(data.leader);
        for (const m of data.members || []) combined.push(m);
        syncActors(combined, data.events || [], {
          subtitle: `会话: ${(data.leader?.title || "").slice(0, 34)} · 组长 + ${(data.members || []).length} 位组员`,
        });
      }
    } catch (e) {
      // ignore transient network errors
    }
  }

  // Demo Mode Builders
  function renderDemoHub() {
    const nowStr = new Date().toTimeString().slice(0, 8);
    const list = DEMO_SESSIONS.map((s) => {
      const rm = getRoomById(roomOverrides[s.id] || s.room_id);
      return {
        ...s,
        is_leader: true,
        is_session_card: true,
        room_id: rm.id,
        room_name: rm.name,
        room_accent: rm.accent,
        role: `房间: ${rm.name}`,
        updated_at: nowStr,
      };
    });
    const events = list.map((s) => ({ who: s.name, text: `[${s.room_name}] ${s.detail}`, time: nowStr }));
    syncActors(list, events, {});
  }

  function renderDemoRoom(sessionCid) {
    const sess = DEMO_SESSIONS.find((s) => s.id === sessionCid) || DEMO_SESSIONS[0];
    const rm = getRoomById(roomOverrides[sess.id] || sess.room_id);
    activeRoomObj = rm;
    const nowStr = new Date().toTimeString().slice(0, 8);
    const otherSkins = SKINS.filter((s) => s !== sess.skin);
    const leader = {
      id: sess.id,
      name: `组长·${sess.name.slice(0, 6)}`,
      role: `${rm.name} · 主控组长`,
      skin: sess.skin,
      is_leader: true,
      state: "writing",
      detail: `在「${rm.name}」用电脑统筹全队!`,
      title: sess.title,
      updated_at: nowStr,
    };
    const subRoles = [
      { name: "代码组员-1", state: "writing",     detail: "正在笔记本狂敲核心逻辑!" },
      { name: "调研组员-2", state: "researching", detail: "正在用电脑翻查 API 文档!" },
      { name: "执行组员-3", state: "executing",   detail: "正在电脑终端跑自动化测试!" },
      { name: "验收组员-4", state: "browsing",    detail: "正在电脑屏核验渲染画质!" },
    ];
    const members = subRoles.map((sr, i) => ({
      id: `${sess.id}-sub-${i}`,
      name: sr.name,
      role: "子 Agent 组员",
      skin: otherSkins[i % otherSkins.length],
      is_leader: false,
      state: sr.state,
      detail: sr.detail,
      updated_at: nowStr,
    }));
    const events = [leader, ...members].map((x) => ({ who: x.name, text: x.detail, time: nowStr }));
    syncActors([leader, ...members], events, {
      subtitle: `🎭 演示会话: ${sess.title} · 组长 + ${members.length} 位组员全员用电脑干活`,
    });
  }

  // Canvas stage projection
  let stageRect = { x: 0, y: 0, w: 1280, h: 720 };
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const imgAspect = 16 / 9;
    const viewAspect = vw / vh;
    let rw, rh;
    if (fitMode === "cover") {
      if (viewAspect > imgAspect) { rw = vw; rh = vw / imgAspect; }
      else { rh = vh; rw = vh * imgAspect; }
    } else {
      if (viewAspect > imgAspect) { rh = vh; rw = vh * imgAspect; }
      else { rw = vw; rh = vw / imgAspect; }
    }
    stageRect = { x: (vw - rw) / 2, y: (vh - rh) / 2, w: rw, h: rh };
  }

  function toScreen(nx, ny) {
    return { x: stageRect.x + nx * stageRect.w, y: stageRect.y + ny * stageRect.h };
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawTakeCopter(cx, topY, scale, t) {
    ctx.save();
    ctx.translate(cx, topY);
    ctx.fillStyle = "#ffd43b";
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 6 * scale, 5.5 * scale, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 1 * scale);
    ctx.lineTo(0, -10 * scale);
    ctx.stroke();
    const bladeW = (18 + Math.sin(t * 36) * 14) * scale;
    ctx.fillStyle = "rgba(255, 224, 102, 0.9)";
    ctx.beginPath();
    ctx.ellipse(0, -10 * scale, Math.abs(bladeW), 3.2 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawSpeechBubble(cx, topY, text, accentColor) {
    if (!text) return;
    ctx.save();
    ctx.font = "700 12px 'PingFang SC', 'Hiragino Sans GB', sans-serif";
    const maxTextW = 205;
    let clipped = text;
    while (clipped.length > 4 && ctx.measureText(clipped).width > maxTextW) {
      clipped = clipped.slice(0, -2) + "…";
    }
    const tw = ctx.measureText(clipped).width;
    const bw = tw + 30;
    const bh = 30;
    const bx = Math.max(14, Math.min(window.innerWidth - bw - 14, cx - bw / 2));
    const by = Math.max(66, topY - bh - 10);

    ctx.fillStyle = "rgba(31, 41, 55, 0.22)";
    roundRect(ctx, bx + 2, by + 3, bw, bh, 14);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 253, 245, 0.97)";
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 2.2;
    roundRect(ctx, bx, by, bw, bh, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.arc(bx + 12, by + bh / 2, 4, 0, Math.PI * 2);
    ctx.fill();

    const tipX = Math.max(bx + 16, Math.min(bx + bw - 16, cx));
    ctx.fillStyle = "rgba(255, 253, 245, 0.97)";
    ctx.beginPath();
    ctx.moveTo(tipX - 6, by + bh - 1);
    ctx.lineTo(tipX + 6, by + bh - 1);
    ctx.lineTo(tipX, by + bh + 8);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tipX - 6, by + bh);
    ctx.lineTo(tipX, by + bh + 8);
    ctx.lineTo(tipX + 6, by + bh);
    ctx.stroke();

    ctx.fillStyle = "#1f2937";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(clipped, bx + 21, by + bh / 2 + 0.5);
    ctx.restore();
  }

  function drawLightingTint() {
    let activeLight = lightingMode;
    if (activeLight === "auto") {
      const hr = new Date().getHours();
      if (hr >= 17 && hr < 20) activeLight = "sunset";
      else if (hr >= 20 || hr < 6) activeLight = "night";
      else activeLight = "day";
    }
    if (activeLight === "sunset") {
      const g = ctx.createLinearGradient(0, 0, 0, window.innerHeight);
      g.addColorStop(0, "rgba(255, 132, 68, 0.20)");
      g.addColorStop(1, "rgba(120, 48, 86, 0.14)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    } else if (activeLight === "night") {
      const g = ctx.createLinearGradient(0, 0, 0, window.innerHeight);
      g.addColorStop(0, "rgba(18, 34, 74, 0.42)");
      g.addColorStop(1, "rgba(12, 20, 46, 0.34)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  // Main 60fps render loop
  let lastFrameTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    const t = now / 1000;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const bgUrl = currentView === "hub" ? HUB_BG_URL : activeRoomObj?.bg || allRoomsCatalog[0].bg;
    const bgImg = getBgImage(bgUrl);
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
      ctx.drawImage(bgImg, stageRect.x, stageRect.y, stageRect.w, stageRect.h);
    } else {
      ctx.fillStyle = "#f4e6c4";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }

    // Anywhere Door glow
    if (doorGlow > 0.01) {
      doorGlow = Math.max(0, doorGlow - dt * 0.42);
      const door = activeRoomObj?.door || [0.22, 0.54];
      const dp = toScreen(door[0], door[1] - 0.1);
      const rg = ctx.createRadialGradient(dp.x, dp.y, 10, dp.x, dp.y, stageRect.w * 0.14);
      rg.addColorStop(0, `rgba(255, 135, 205, ${0.65 * doorGlow})`);
      rg.addColorStop(1, "rgba(255, 135, 205, 0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, stageRect.w * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }

    const list = Array.from(actors.values());

    // Inside a Room: Leader periodically patrols to check in on busy computer-working teammates!
    if (currentView === "room" && overrideActionUntil <= now && now - lastPatrolCheck > 9000) {
      lastPatrolCheck = now;
      const leader = list.find((a) => a.is_leader);
      const busyMembers = list.filter((a) => !a.is_leader && a.state !== "idle");
      if (leader && busyMembers.length > 0) {
        const pick = busyMembers[Math.floor(Math.random() * busyMembers.length)];
        leader.tx = Math.max(0.24, Math.min(0.74, pick.x + (pick.x > 0.5 ? -0.13 : 0.13)));
        leader.ty = Math.max(0.60, Math.min(0.78, pick.y));
        delegationBeam = { fromId: leader.id, toId: pick.id, text: `巡视 ${pick.name}`, until: now + 3600 };
      }
    }

    // Update actor positions & emit computer-typing particles
    for (const a of list) {
      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const dist = Math.hypot(dx, dy);
      const speed = a.flyingCopter > 0 ? 0.28 : 0.16;
      if (dist > 0.004) {
        const step = Math.min(dist, speed * dt);
        a.x += (dx / dist) * step;
        a.y += (dy / dist) * step;
        if (Math.abs(dx) > 0.003) a.facing = dx >= 0 ? 1 : -1;
        a._moving = true;
      } else {
        a._moving = false;
      }
      if (a.scalePop < 1) a.scalePop = Math.min(1, a.scalePop + dt * 3.8);
      if (a.flyingCopter > 0) a.flyingCopter = Math.max(0, a.flyingCopter - dt);

      if (!a._moving && a.state !== "idle" && Math.random() < dt * 1.9) {
        const glyphs = ["{ }", "</>", "⚡", "✦", "01"];
        const g = glyphs[Math.floor(Math.random() * glyphs.length)];
        spawnSparkles(a.x + (Math.random() - 0.5) * 0.04, a.y - 0.15, 1, (STATE_META[a.state] || STATE_META.writing).color, g);
      }
    }

    // Delegation beam inside room
    if (delegationBeam && now < delegationBeam.until) {
      const f = actors.get(delegationBeam.fromId);
      const to = actors.get(delegationBeam.toId);
      if (f && to) {
        const p1 = toScreen(f.x, f.y - 0.11);
        const p2 = toScreen(to.x, to.y - 0.11);
        ctx.save();
        ctx.strokeStyle = "#ffd43b";
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 8]);
        ctx.lineDashOffset = -t * 50;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.quadraticCurveTo((p1.x + p2.x) / 2, Math.min(p1.y, p2.y) - 52, p2.x, p2.y);
        ctx.stroke();
        ctx.restore();
      }
    } else {
      delegationBeam = null;
    }

    list.sort((a, b) => a.y - b.y);
    const baseSpriteH = Math.max(108, Math.min(200, stageRect.h * (currentView === "hub" ? 0.215 : 0.22)));
    const bubbleQueue = [];

    for (const a of list) {
      const pos = toScreen(a.x, a.y);
      const depthScale = 0.86 + (a.y - 0.54) * 0.40;
      const isHovered = a.id === hoveredActorId;
      const spriteSize = baseSpriteH * depthScale * (a.is_leader && currentView === "room" ? 1.07 : 1.0) * a.scalePop * (isHovered ? 1.06 : 1.0);

      let pose = (STATE_META[a.state] || STATE_META.idle).pose;
      if (a.manualPose && now < a.manualPoseUntil) pose = a.manualPose;
      else if (overrideActionUntil > now && overrideActionType === "celebrate") pose = "eureka";
      else if (overrideActionUntil > now && overrideActionType === "dorayaki") pose = "idle";
      else if (a._moving) pose = "walk";

      const img = sprites[a.skin]?.[pose] || sprites.coder.work;

      let hopY = 0, tilt = 0, sx = 1, sy = 1;
      if (a.flyingCopter > 0 && a._moving) {
        hopY = -28 - Math.sin(t * 8 + a.bobPhase) * 6;
        tilt = a.facing * 0.08;
      } else if (a._moving) {
        hopY = -Math.abs(Math.sin(t * 10 + a.bobPhase)) * 10;
        tilt = Math.sin(t * 10 + a.bobPhase) * 0.055;
      } else if (pose === "work") {
        // Energetic computer-typing rhythm!
        const pulse = Math.sin(t * 11 + a.bobPhase);
        hopY = -Math.abs(pulse) * 4.5;
        tilt = Math.sin(t * 5.5 + a.bobPhase) * 0.035;
        sy = 1 + pulse * 0.03;
        sx = 1 - pulse * 0.02;
      } else if (pose === "eureka") {
        hopY = -Math.abs(Math.sin(t * 5.5 + a.bobPhase)) * 11;
      } else {
        const breath = Math.sin(t * 2.5 + a.bobPhase);
        sy = 1 + breath * 0.02;
        sx = 1 - breath * 0.012;
      }

      const stMeta = STATE_META[a.state] || STATE_META.idle;
      const shadowScale = Math.max(0.55, 1 + hopY / 90);

      // Ground shadow + glowing active computer-work ring + hover halo
      ctx.save();
      if (isHovered) {
        ctx.strokeStyle = "#ff6fb5";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y + 2, spriteSize * 0.39, spriteSize * 0.13, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (a.state !== "idle") {
        const rp = 1 + 0.13 * Math.sin(t * 5 + a.bobPhase);
        ctx.strokeStyle = stMeta.color;
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 5 + a.bobPhase);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y + 2, spriteSize * 0.34 * rp, spriteSize * 0.11 * rp, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "rgba(31, 41, 55, 0.22)";
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + 2, spriteSize * 0.29 * shadowScale, spriteSize * 0.095 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Draw character sprite
      ctx.save();
      ctx.translate(pos.x, pos.y + hopY);
      ctx.rotate(tilt);
      ctx.scale(a.facing * sx, sy);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, -spriteSize / 2, -spriteSize + 8, spriteSize, spriteSize);
      }
      ctx.restore();

      if (a.flyingCopter > 0 && a._moving) {
        drawTakeCopter(pos.x, pos.y + hopY - spriteSize + 14, depthScale, t);
      }

      a.screenRect = {
        x: pos.x - spriteSize * 0.42,
        y: pos.y + hopY - spriteSize * 0.94,
        w: spriteSize * 0.84,
        h: spriteSize * 1.15,
      };

      // Nameplate Pill (+ Room Tag when on Hub Plaza!)
      ctx.save();
      ctx.font = "800 12px 'PingFang SC', 'Hiragino Sans GB', sans-serif";
      let tagText = a.name;
      if (currentView === "hub") {
        const badge = a.child_count > 0 ? ` (+${a.child_count}员)` : "";
        tagText = `${a.working_count > 0 ? "🔥" : ""}${a.name}${badge}`;
      } else if (a.is_leader) {
        tagText = `★ ${a.name}`;
      }
      const tw = ctx.measureText(tagText).width;
      const pw = tw + 24;
      const ph = 22;
      const px = pos.x - pw / 2;
      const py = pos.y + 7;

      const pillBg =
        currentView === "hub"
          ? isHovered ? "#ff6fb5" : "rgba(255, 253, 245, 0.95)"
          : a.is_leader ? "#009fe8" : "rgba(255, 253, 245, 0.94)";

      ctx.fillStyle = pillBg;
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 2;
      roundRect(ctx, px, py, pw, ph, 11);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = stMeta.color;
      ctx.beginPath();
      ctx.arc(px + 10, py + ph / 2, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = (currentView === "hub" && isHovered) || (currentView === "room" && a.is_leader) ? "#ffffff" : "#1f2937";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(tagText, px + 18, py + ph / 2 + 0.5);

      // In Hub Plaza: show each person's unique room sub-badge right underneath!
      if (currentView === "hub" && a.room_name) {
        ctx.font = "700 10.5px 'PingFang SC', sans-serif";
        const rTag = `🚪 ${a.room_name}`;
        const rtw = ctx.measureText(rTag).width;
        const rpw = rtw + 14;
        const rpx = pos.x - rpw / 2;
        const rpy = py + ph + 3;
        ctx.fillStyle = a.room_accent || "#009fe8";
        ctx.strokeStyle = "#1f2937";
        ctx.lineWidth = 1.6;
        roundRect(ctx, rpx, rpy, rpw, 18, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText(rTag, pos.x, rpy + 9.5);
      }
      ctx.restore();

      // Queue speech bubbles
      const spotlightIdx = Math.floor(t / 4.2) % Math.max(1, list.length);
      const isSpotlight = list[spotlightIdx] && list[spotlightIdx].id === a.id;
      if (isHovered && currentView === "hub") {
        bubbleQueue.push({
          cx: pos.x,
          topY: pos.y + hopY - spriteSize * 0.92,
          text: `🚪 点击进入「${a.room_name}」看他和组员干活 →`,
          color: "#ff6fb5",
          priority: 10,
        });
      } else if (a.id === inspectedAgentId || (currentView === "room" && a.is_leader) || isSpotlight) {
        if (a.detail) {
          bubbleQueue.push({
            cx: pos.x,
            topY: pos.y + hopY - spriteSize * 0.92,
            text: `${stMeta.icon} ${a.detail}`,
            color: stMeta.color,
            priority: a.id === inspectedAgentId ? 5 : a.is_leader ? 3 : 1,
          });
        }
      }
    }

    bubbleQueue.sort((a, b) => b.priority - a.priority);
    const placed = [];
    for (const b of bubbleQueue.slice(0, 3)) {
      let y = b.topY;
      for (const prev of placed) {
        if (Math.abs(prev.cx - b.cx) < 215 && Math.abs(prev.y - y) < 42) y = prev.y - 44;
      }
      drawSpeechBubble(b.cx, y, b.text, b.color);
      placed.push({ cx: b.cx, y });
    }

    // Floating sunlight dust motes
    ctx.save();
    for (const d of dustMotes) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y > 0.88) { d.y = 0.18; d.x = 0.2 + Math.random() * 0.6; }
      const p = toScreen(d.x, d.y);
      ctx.fillStyle = `rgba(255, 248, 210, ${0.2 + 0.2 * Math.sin(t * 2 + d.phase)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Comic FX particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const sp = toScreen(p.x, p.y);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.6));
      if (p.glyph) {
        ctx.font = `900 ${Math.round(p.size + 5)}px sans-serif`;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = "#1f2937";
        ctx.lineWidth = 2.4;
        ctx.strokeText(p.glyph, sp.x, sp.y);
        ctx.fillText(p.glyph, sp.x, sp.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, p.size * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawLightingTint();
    requestAnimationFrame(loop);
  }

  // Hit-testing helper
  function findActorAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const sorted = Array.from(actors.values()).sort((a, b) => b.y - a.y);
    for (const a of sorted) {
      const r = a.screenRect;
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return a;
    }
    return null;
  }

  canvas.addEventListener("mousemove", (e) => {
    pokeHud();
    const hit = findActorAt(e.clientX, e.clientY);
    hoveredActorId = hit ? hit.id : null;
    canvas.style.cursor = hit ? "pointer" : "default";
  });

  canvas.addEventListener("click", (e) => {
    const hit = findActorAt(e.clientX, e.clientY);
    if (!hit) {
      closeInspector();
      return;
    }
    if (currentView === "hub") {
      // Clicking any person on the Hub Plaza enters their unique room!
      const rm = getRoomById(hit.room_id);
      enterRoom(hit.id, hit.title || hit.name, rm);
    } else {
      openInspector(hit);
      spawnSparkles(hit.x, hit.y - 0.14, 6, "#009fe8", "✦");
    }
  });

  // Inspector Drawer
  function openInspector(actor) {
    inspectedAgentId = actor.id;
    document.getElementById("inspector-card").classList.add("open");
    updateInspectorIfOpen();
  }

  function updateInspectorIfOpen() {
    if (!inspectedAgentId) return;
    const actor = actors.get(inspectedAgentId);
    if (!actor) { closeInspector(); return; }
    const stMeta = STATE_META[actor.state] || STATE_META.idle;
    document.getElementById("insp-avatar").src = `/assets/doraemon/sprites/${actor.skin}_${stMeta.pose}.png`;
    document.getElementById("insp-name").textContent = actor.is_leader ? `★ ${actor.name}` : actor.name;
    document.getElementById("insp-role").textContent = `${actor.role} · ID: ${actor.id.slice(0, 8)}`;
    document.getElementById("insp-state").textContent = `${stMeta.icon} 状态: ${stMeta.label} — ${actor.detail}`;
    document.getElementById("insp-meta").textContent =
      actor.prompt
        ? `任务指令: ${actor.prompt}`
        : `最近工具: ${actor.last_tool || "无"} · 步数: ${actor.steps || 0} · 更新: ${actor.updated_at || "实时"}`;
  }

  function closeInspector() {
    inspectedAgentId = null;
    document.getElementById("inspector-card").classList.remove("open");
  }

  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // Fullscreen & Auto-hide HUD
  let idleHudTimer = null;
  function pokeHud() {
    if (IS_URL_SCREENSAVER) return;
    document.body.classList.remove("hud-hidden");
    clearTimeout(idleHudTimer);
    if (document.fullscreenElement) {
      idleHudTimer = setTimeout(() => document.body.classList.add("hud-hidden"), 3000);
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      showToast("✨ 已进入全屏屏保模式 · 静止 3 秒自动隐藏按钮 (按 Esc 退出)");
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  document.addEventListener("fullscreenchange", () => {
    const btn = document.getElementById("btn-fullscreen");
    if (document.fullscreenElement) {
      btn.textContent = "↙️ 退出全屏";
      document.body.classList.add("screensaver-mode");
      pokeHud();
    } else {
      btn.textContent = "🖥️ 全屏屏保";
      document.body.classList.remove("screensaver-mode", "hud-hidden");
      clearTimeout(idleHudTimer);
    }
    setTimeout(resizeCanvas, 80);
  });

  window.addEventListener("keydown", (e) => {
    pokeHud();
    if (e.key === "f" || e.key === "F") toggleFullscreen();
    if (e.key === "Escape") {
      if (inspectedAgentId) closeInspector();
      else if (currentView === "room" && !document.fullscreenElement) returnToHub();
    }
    if (e.key === "Backspace" && currentView === "room") returnToHub();
  });

  // Minimal display-only button bindings (null-safe!)
  document.getElementById("btn-back-hub")?.addEventListener("click", returnToHub);

  document.getElementById("btn-switch-room")?.addEventListener("click", () => {
    if (!activeRoomObj || !activeRoomSessionCid) return;
    const idx = allRoomsCatalog.findIndex((r) => r.id === activeRoomObj.id);
    const nextRoom = allRoomsCatalog[(idx + 1) % allRoomsCatalog.length];
    roomOverrides[activeRoomSessionCid] = nextRoom.id;
    localStorage.setItem("doraemon_room_overrides", JSON.stringify(roomOverrides));
    runPortalTransition(`🏠 切换主题房 ·「${nextRoom.name}」`, () => {
      activeRoomObj = nextRoom;
      doorGlow = 1.0;
      if (mode === "demo") renderDemoRoom(activeRoomSessionCid);
      else pollBackend();
    });
  });

  const LIGHT_SEQ = [
    { id: "day", label: "☀️" },
    { id: "sunset", label: "🌇" },
    { id: "night", label: "🌙" },
    { id: "auto", label: "⏰" },
  ];
  document.getElementById("btn-lighting")?.addEventListener("click", (e) => {
    const idx = (LIGHT_SEQ.findIndex((x) => x.id === lightingMode) + 1) % LIGHT_SEQ.length;
    lightingMode = LIGHT_SEQ[idx].id;
    e.target.textContent = LIGHT_SEQ[idx].label;
  });

  document.getElementById("btn-fullscreen")?.addEventListener("click", toggleFullscreen);
  document.getElementById("insp-close")?.addEventListener("click", closeInspector);

  // Live clock
  function updateClock() {
    const d = new Date();
    document.getElementById("saver-time").textContent =
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    document.getElementById("saver-date").textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${days[d.getDay()]}`;
  }
  updateClock();
  setInterval(updateClock, 1000);

  if (IS_URL_SCREENSAVER) {
    document.body.classList.add("screensaver-mode", "hud-hidden");
    lightingMode = "auto";
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Boot!
  if (mode === "demo") {
    if (currentView === "hub") renderDemoHub();
    else renderDemoRoom(activeRoomSessionCid || "demo-1");
  } else {
    pollBackend();
  }
  setInterval(pollBackend, 2500);
  requestAnimationFrame(loop);
})();

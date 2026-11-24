"""
Real-time Google Antigravity Brain Transcript & Swarm Watcher.

Scans ~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl
and .system_generated/tasks/* to automatically discover:
  - Lead / Coordinator Agent (parent conversation)
  - Spawned Subagents (via invoke_subagent)
  - Spawned Swarm Workers (via sender=<coordinator_cid> & @<worker_name>)
  - Accurate real-time working state (including active LLM thinking, running tools,
    background task logs, and Swarm board communication).
"""

from __future__ import annotations

import glob
import json
import os
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


BRAIN_DIR = os.path.expanduser("~/.gemini/antigravity/brain")

# File parse cache: path -> (mtime, size, parsed_summary)
_PARSE_CACHE: Dict[str, Tuple[float, int, Dict[str, Any]]] = {}

# Map tool names to friendly Chinese status & zone
TOOL_TO_STATE = {
    "write_file": ("writing", "正在写文件代码"),
    "edit_file": ("writing", "正在修改代码"),
    "replace_file_content": ("writing", "正在重构代码"),
    "multi_replace_file_content": ("writing", "正在批量改代码"),
    "read_file": ("researching", "正在翻阅文件"),
    "search_web": ("researching", "正在全网查资料"),
    "grep_search": ("researching", "正在检索代码库"),
    "find_by_name": ("researching", "正在翻找文件"),
    "list_dir": ("researching", "正在查看目录"),
    "read_board": ("researching", "正在查看团队公告板"),
    "run_command": ("executing", "正在执行终端命令"),
    "run_workflow": ("executing", "正在跑自动化流水线"),
    "manage_task": ("executing", "正在盯着后台任务"),
    "schedule": ("executing", "正在等定时唤醒"),
    "invoke_subagent": ("delegating", "打开任意门派发子任务!"),
    "swarm": ("delegating", "正在调度蜂群小队!"),
    "post_message": ("delegating", "正在公告板同步进度!"),
    "send_message": ("delegating", "正在给队友传话!"),
    "ask_question": ("idle", "正在等主人做决定~"),
    "update_steps": ("writing", "正在更新任务进度"),
    "update_focus": ("researching", "正在推进当前阶段"),
}

TEAMMATE_SKINS = ["coder", "researcher", "engineer", "scout"]
HUB_SKINS = ["leader", "coder", "researcher", "engineer", "scout"]

ROOMS = [
    {
        "id": "nobita",
        "name": "大雄的榻榻米开发室",
        "bg": "/assets/doraemon/rooms/room_nobita.jpg",
        "door": [0.285, 0.565],
        "accent": "#009fe8",
    },
    {
        "id": "future_lab",
        "name": "22世纪未来道具实验室",
        "bg": "/assets/doraemon/rooms/room_future_lab.jpg",
        "door": [0.18, 0.56],
        "accent": "#06b6d4",
    },
    {
        "id": "shizuka",
        "name": "静香的暖阳花房书房",
        "bg": "/assets/doraemon/rooms/room_shizuka.jpg",
        "door": [0.16, 0.56],
        "accent": "#ec4899",
    },
    {
        "id": "treehouse",
        "name": "后山秘密树屋基地",
        "bg": "/assets/doraemon/rooms/room_treehouse.jpg",
        "door": [0.22, 0.56],
        "accent": "#22c55e",
    },
    {
        "id": "time_space",
        "name": "时光机·次元控制台",
        "bg": "/assets/doraemon/rooms/room_time_space.jpg",
        "door": [0.22, 0.56],
        "accent": "#a855f7",
    },
    {
        "id": "cloud",
        "name": "云之王国·天空工作室",
        "bg": "/assets/doraemon/rooms/room_cloud.jpg",
        "door": [0.22, 0.56],
        "accent": "#eab308",
    },
]

# Stable per-conversation assignment cache so a session keeps its same room & character across polls
_SESSION_ROOM_MAP: Dict[str, int] = {}
_SESSION_SKIN_MAP: Dict[str, str] = {}


def _assign_session_identity(cid: str, rank_idx: int) -> Tuple[Dict[str, Any], str]:
    if cid not in _SESSION_ROOM_MAP:
        used = set(_SESSION_ROOM_MAP.values())
        chosen_idx = None
        for i in range(len(ROOMS)):
            cand = (rank_idx + i) % len(ROOMS)
            if cand not in used:
                chosen_idx = cand
                break
        if chosen_idx is None:
            chosen_idx = sum(ord(c) for c in cid[:8]) % len(ROOMS)
        _SESSION_ROOM_MAP[cid] = chosen_idx

    if cid not in _SESSION_SKIN_MAP:
        _SESSION_SKIN_MAP[cid] = HUB_SKINS[len(_SESSION_SKIN_MAP) % len(HUB_SKINS)]

    return ROOMS[_SESSION_ROOM_MAP[cid]], _SESSION_SKIN_MAP[cid]


def _parse_iso_ts(ts_str: Optional[str]) -> float:
    if not ts_str:
        return 0.0
    try:
        s = ts_str.replace("Z", "+00:00")
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return 0.0


def _unquote(val: Any) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    if len(s) >= 2 and ((s[0] == '"' and s[-1] == '"') or (s[0] == "'" and s[-1] == "'")):
        try:
            return json.loads(s)
        except Exception:
            return s[1:-1]
    return s


def _pick_skin(role: str, type_name: str, fallback_idx: int) -> str:
    text = f"{role} {type_name}".lower()
    if any(k in text for k in ("browser", "scout", "qa", "浏览", "侦探")):
        return "scout"
    if any(k in text for k in ("research", "analyst", "explore", "doc", "调研", "研究", "分析", "资料", "分镜")):
        return "researcher"
    if any(k in text for k in ("exec", "build", "test", "gpu", "colab", "ops", "shell", "render", "engineer", "渲染", "测试", "部署", "实干")):
        return "engineer"
    if any(k in text for k in ("code", "dev", "front", "back", "代码", "开发")):
        return "coder"
    return TEAMMATE_SKINS[fallback_idx % len(TEAMMATE_SKINS)]


def _short_display_name(raw: str, max_len: int = 15) -> str:
    s = raw.strip()
    if len(s) <= max_len:
        return s
    cut = s[:max_len]
    if " " in cut and cut[-1].isascii():
        trimmed = cut.rsplit(" ", 1)[0].strip()
        if len(trimmed) >= 5:
            return trimmed
    return cut.rstrip() + "…"


def _extract_short_target(tool_name: str, args: Dict[str, Any]) -> str:
    for key in ("Path", "path", "CommandLine", "query", "Role", "focus", "Description", "name", "title", "toolSummary"):
        if key in args and args[key]:
            val = _unquote(args[key])
            if key in ("Path", "path"):
                val = os.path.basename(val)
            val = val.replace("\n", " ").strip()
            return val[:22] + ("…" if len(val) > 22 else "")
    return ""


def _newest_task_log_mtime(conv_dir: str) -> float:
    tasks_dir = os.path.join(conv_dir, ".system_generated", "tasks")
    newest = 0.0
    if os.path.isdir(tasks_dir):
        try:
            for entry in os.scandir(tasks_dir):
                try:
                    m = entry.stat().st_mtime
                    if m > newest:
                        newest = m
                except OSError:
                    pass
        except OSError:
            pass
    return newest


def _parse_transcript(path: str) -> Dict[str, Any]:
    st = os.stat(path)
    conv_dir = os.path.dirname(os.path.dirname(os.path.dirname(path)))
    task_mtime = _newest_task_log_mtime(conv_dir)

    cached = _PARSE_CACHE.get(path)
    if cached and cached[0] == st.st_mtime and cached[1] == st.st_size:
        res = dict(cached[2])
        res["task_mtime"] = task_mtime
        res["effective_mtime"] = max(res["mtime"], task_mtime)
        return res

    cid = os.path.basename(conv_dir)
    first_user_prompt = ""
    swarm_title = ""
    swarm_parent_cid = ""
    swarm_worker_name = ""
    swarm_worker_brief = ""

    children: Dict[str, Dict[str, Any]] = {}  # child_cid -> {role, type_name, prompt, spawned_at}
    pending_invokes: List[Dict[str, Any]] = []

    last_step_type = ""
    last_status = ""
    last_has_tools = False
    last_ts = st.st_mtime
    last_tool_name = ""
    last_tool_target = ""
    last_tool_ts = 0.0
    last_focus = ""
    step_count = 0
    recent_actions: List[Dict[str, Any]] = []

    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            for line_idx, line in enumerate(fh):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                step_count += 1
                stype = obj.get("type", "")
                status = obj.get("status", "")
                ts = _parse_iso_ts(obj.get("created_at")) or st.st_mtime
                last_step_type = stype
                last_status = status
                tcs = obj.get("tool_calls") or []
                last_has_tools = bool(tcs)
                if ts > 0:
                    last_ts = ts

                content = str(obj.get("content", ""))

                # Detect Swarm worker identity & parent coordinator in first 3 steps
                if line_idx < 4 and stype == "SYSTEM_MESSAGE" and "sender=" in content:
                    m_sender = re.search(r"sender=([a-f0-9-]{36})", content)
                    if m_sender and m_sender.group(1) != cid:
                        swarm_parent_cid = m_sender.group(1)
                    m_worker = re.search(r"for @([a-zA-Z0-9_-]+)", content)
                    if m_worker:
                        swarm_worker_name = m_worker.group(1)
                    m_slice = re.search(r"JOB_SLUG=([a-zA-Z0-9_-]+)", content)
                    if m_slice:
                        swarm_worker_brief = m_slice.group(1)
                    elif not swarm_worker_brief and "assignment" in content.lower():
                        swarm_worker_brief = content[content.lower().find("assignment"):][:80].replace("\n", " ")

                if not first_user_prompt and stype == "USER_INPUT":
                    m = re.search(r"<USER_REQUEST>\s*(.*?)\s*</USER_REQUEST>", content, re.S)
                    clean = (m.group(1) if m else content).strip().replace("\n", " ")
                    first_user_prompt = clean[:60] + ("…" if len(clean) > 60 else "")

                # Parse tool calls
                if tcs:
                    for tc in tcs:
                        tname = tc.get("name", "")
                        targs = tc.get("args") or {}
                        target = _extract_short_target(tname, targs)
                        if tname == "update_focus" and targs.get("focus"):
                            last_focus = _unquote(targs.get("focus"))[:34]
                        last_tool_name = tname
                        last_tool_target = target
                        last_tool_ts = ts
                        recent_actions.append({
                            "tool": tname,
                            "target": target,
                            "ts": ts,
                        })
                        if len(recent_actions) > 12:
                            recent_actions.pop(0)

                        if tname == "invoke_subagent":
                            pending_invokes.append({
                                "role": _unquote(targs.get("Role")) or _unquote(targs.get("TypeName")) or "秘密组员",
                                "type_name": _unquote(targs.get("TypeName")) or "self",
                                "prompt": _unquote(targs.get("Prompt"))[:90],
                                "spawned_at": ts,
                            })
                        elif tname == "swarm":
                            act = _unquote(targs.get("action"))
                            if act == "title" and targs.get("title"):
                                swarm_title = _unquote(targs.get("title"))[:45]

                # Capture child conversationId from invoke_subagent tool result
                if stype in ("GENERIC", "TOOL_RESPONSE") and "conversationId" in content:
                    cids_found = re.findall(r'"conversationId"\s*:\s*"([a-f0-9-]{36})"', content)
                    for child_cid in cids_found:
                        if child_cid != cid:
                            info = pending_invokes.pop(0) if pending_invokes else {
                                "role": "秘密组员",
                                "type_name": "self",
                                "prompt": "",
                                "spawned_at": ts,
                            }
                            children[child_cid] = info
    except Exception:
        pass

    result = {
        "cid": cid,
        "mtime": st.st_mtime,
        "task_mtime": task_mtime,
        "effective_mtime": max(st.st_mtime, task_mtime),
        "first_user_prompt": first_user_prompt,
        "swarm_title": swarm_title,
        "swarm_parent_cid": swarm_parent_cid,
        "swarm_worker_name": swarm_worker_name,
        "swarm_worker_brief": swarm_worker_brief,
        "children": children,
        "last_step_type": last_step_type,
        "last_status": last_status,
        "last_has_tools": last_has_tools,
        "last_ts": last_ts,
        "last_tool_name": last_tool_name,
        "last_tool_target": last_tool_target,
        "last_tool_ts": last_tool_ts,
        "last_focus": last_focus,
        "step_count": step_count,
        "recent_actions": recent_actions[-6:],
    }
    _PARSE_CACHE[path] = (st.st_mtime, st.st_size, result)
    return result


def _compute_agent_state(parsed: Dict[str, Any], now: float, role_hint: str = "") -> Tuple[str, str, bool]:
    """
    Returns (state_name, detail_text, is_actively_working).
    Understands Antigravity transcript mechanics:
      - Last step is GENERIC / USER_INPUT / SYSTEM_MESSAGE -> agent is thinking/working right now!
      - Last step is PLANNER_RESPONSE with tool_calls -> tool is executing right now!
      - Recent background task log write (task_age < 90s) -> background GPU/shell job running!
    """
    t_age = max(0.0, now - parsed["mtime"])
    task_age = max(0.0, now - parsed["task_mtime"]) if parsed["task_mtime"] > 0 else 99999.0
    eff_age = min(t_age, task_age)

    stype = parsed["last_step_type"]
    status = parsed["last_status"]
    tool = parsed["last_tool_name"]
    target = parsed["last_tool_target"]
    focus = parsed["last_focus"]

    if status == "ERROR" and t_age < 180:
        return "error", f"哎呀出错啦! ({tool or '任务异常'})", True

    # Mid-turn active signals: waiting on LLM or tool execution!
    mid_turn = (
        status == "RUNNING"
        or stype in ("GENERIC", "USER_INPUT", "SYSTEM_MESSAGE", "TOOL_RESPONSE")
        or (stype == "PLANNER_RESPONSE" and parsed["last_has_tools"])
    )

    is_working = (
        (mid_turn and t_age < 240)
        or (task_age < 110)
        or (t_age < 45)
    )

    if is_working:
        if task_age < 110 and task_age < t_age:
            return "executing", f"后台任务全力跑动中… ({focus or target or '云端/终端任务'})", True

        if tool in TOOL_TO_STATE:
            st_name, label = TOOL_TO_STATE[tool]
            if "browser" in role_hint.lower() or "image" in role_hint.lower():
                if st_name not in ("delegating", "error"):
                    st_name = "browsing"
            if focus and st_name in ("researching", "writing", "executing") and not target:
                detail = f"{label}: {focus}"
            elif target:
                detail = f"{label}: {target}"
            else:
                detail = label
            return st_name, detail, True

        if "image" in role_hint.lower():
            return "browsing", "正在用画笔魔法生图中…", True
        if "browser" in role_hint.lower():
            return "browsing", "正在浏览器里操作中…", True
        if focus:
            return "writing", f"正在推进: {focus}", True
        return "writing", "正在高速思考推进任务…", True

    # Recently wrapped up a turn (45s..150s)
    if eff_age < 150 and parsed["step_count"] > 1:
        return "eureka", f"刚跑完一步! ({target or focus or '等待下一轮'})", False

    # Idle / resting
    if eff_age < 420:
        return "idle", "刚刚忙完，先吃口铜锣烧歇会儿~", False
    return "idle", "摸鱼喝茶中，随时待命!", False


def scan_antigravity_teams(selected_leader_cid: Optional[str] = None, max_scan: int = 80) -> Dict[str, Any]:
    """Scan local Antigravity transcripts and return leader + subagent/swarm teams."""
    now = time.time()
    pattern = os.path.join(BRAIN_DIR, "*", ".system_generated", "logs", "transcript.jsonl")
    paths = sorted(glob.glob(pattern), key=lambda p: os.path.getmtime(p), reverse=True)[:max_scan]

    parsed_by_cid: Dict[str, Dict[str, Any]] = {}
    child_to_parent: Dict[str, str] = {}

    for p in paths:
        info = _parse_transcript(p)
        parsed_by_cid[info["cid"]] = info

    # Link invoke_subagent children AND Swarm worker children!
    for cid, info in list(parsed_by_cid.items()):
        for child_cid in info["children"]:
            child_to_parent[child_cid] = cid

        parent_cid = info.get("swarm_parent_cid")
        if parent_cid and parent_cid in parsed_by_cid:
            child_to_parent[cid] = parent_cid
            parent_info = parsed_by_cid[parent_cid]
            if cid not in parent_info["children"]:
                wname = info.get("swarm_worker_name") or f"worker-{cid[:4]}"
                parent_info["children"][cid] = {
                    "role": wname,
                    "type_name": "swarm",
                    "prompt": info.get("swarm_worker_brief") or "",
                    "spawned_at": info["mtime"],
                }

    # Build root (leader) conversations
    leaders: List[Dict[str, Any]] = []
    for cid, info in parsed_by_cid.items():
        if cid in child_to_parent:
            continue
        _, _, leader_working = _compute_agent_state(info, now)
        child_list = []
        working_children = 0
        latest_activity = info["effective_mtime"]

        for child_cid, meta in info["children"].items():
            c_parsed = parsed_by_cid.get(child_cid)
            c_working = False
            if c_parsed:
                latest_activity = max(latest_activity, c_parsed["effective_mtime"])
                _, _, c_working = _compute_agent_state(c_parsed, now, role_hint=f"{meta.get('role','')} {meta.get('type_name','')}")
                if c_working:
                    working_children += 1
            child_list.append((child_cid, meta, c_parsed, c_working))

        display_title = info["swarm_title"] or info["first_user_prompt"] or f"会话 {cid[:8]}"
        total_working = (1 if leader_working else 0) + working_children

        leaders.append({
            "cid": cid,
            "title": display_title,
            "mtime": latest_activity,
            "child_count": len(child_list),
            "working_count": total_working,
            "working_children": working_children,
            "age_sec": int(max(0, now - latest_activity)),
            "is_active": total_working > 0 or (now - latest_activity) < 180,
            "info": info,
            "children_resolved": child_list,
        })

    # Sort: prefer teams with actively working subagents/swarm workers first!
    leaders.sort(
        key=lambda x: (
            1 if x["working_children"] > 0 else 0,
            x["working_count"],
            1 if x["is_active"] else 0,
            x["mtime"],
        ),
        reverse=True,
    )

    team_list = [
        {
            "cid": ld["cid"],
            "short_id": ld["cid"][:8],
            "title": ld["title"],
            "child_count": ld["child_count"],
            "working_count": ld["working_count"],
            "is_active": ld["is_active"],
            "age_sec": ld["age_sec"],
        }
        for ld in leaders[:15]
    ]

    # Special mode: "__ALL__" shows every actively working agent across all sessions!
    if selected_leader_cid == "__ALL__":
        return _build_all_active_view(leaders, team_list, now)

    chosen = None
    if selected_leader_cid:
        for ld in leaders:
            if ld["cid"] == selected_leader_cid:
                chosen = ld
                break
    if not chosen and leaders:
        # Prefer the team with the most actively working members (especially subagents/swarm!)
        chosen = leaders[0]

    if not chosen:
        return {
            "ok": True,
            "source": "antigravity",
            "teams": [],
            "active_team": None,
            "leader": None,
            "members": [],
            "events": [],
            "updated_at": datetime.now().strftime("%H:%M:%S"),
        }

    leader_info = chosen["info"]
    leader_state, leader_detail, _ = _compute_agent_state(leader_info, now)

    leader_obj = {
        "id": chosen["cid"],
        "short_id": chosen["cid"][:8],
        "name": "哆啦组长",
        "role": "主控组长 (Lead Agent)",
        "skin": "leader",
        "is_leader": True,
        "state": leader_state,
        "detail": leader_detail,
        "title": chosen["title"],
        "last_tool": leader_info["last_tool_name"],
        "last_target": leader_info["last_tool_target"],
        "steps": leader_info["step_count"],
        "age_sec": int(max(0, now - leader_info["effective_mtime"])),
        "updated_at": datetime.fromtimestamp(leader_info["effective_mtime"]).strftime("%H:%M:%S"),
    }

    members: List[Dict[str, Any]] = []
    # Sort children: actively working first, then most recently touched! Cap at 7 visible so room stays neat.
    children_sorted = sorted(
        chosen["children_resolved"],
        key=lambda item: (
            1 if item[3] else 0,
            item[2]["effective_mtime"] if item[2] else item[1].get("spawned_at", 0),
        ),
        reverse=True,
    )

    for idx, (child_cid, meta, c_parsed, _) in enumerate(children_sorted[:7]):
        role = meta.get("role") or "秘密组员"
        tname = meta.get("type_name") or "self"
        skin = _pick_skin(role, tname, idx)

        if c_parsed:
            c_state, c_detail, _ = _compute_agent_state(c_parsed, now, role_hint=f"{role} {tname}")
            c_age = int(max(0, now - c_parsed["effective_mtime"]))
            c_steps = c_parsed["step_count"]
            c_tool = c_parsed["last_tool_name"]
            c_updated = datetime.fromtimestamp(c_parsed["effective_mtime"]).strftime("%H:%M:%S")
        else:
            spawn_age = int(max(0, now - meta.get("spawned_at", now)))
            c_state = "writing" if spawn_age < 40 else "idle"
            c_detail = "刚从任意门钻出来准备干活!" if spawn_age < 40 else "已完成任务回屋待命~"
            c_age = spawn_age
            c_steps = 1
            c_tool = ""
            c_updated = datetime.fromtimestamp(meta.get("spawned_at", now)).strftime("%H:%M:%S")

        members.append({
            "id": child_cid,
            "short_id": child_cid[:8],
            "name": _short_display_name(role, 15),
            "role": f"{tname} 组员",
            "type_name": tname,
            "skin": skin,
            "is_leader": False,
            "state": c_state,
            "detail": c_detail,
            "prompt": meta.get("prompt", ""),
            "last_tool": c_tool,
            "steps": c_steps,
            "age_sec": c_age,
            "updated_at": c_updated,
        })

    # Build recent activity ticker events
    events: List[Dict[str, Any]] = []
    for act in leader_info["recent_actions"][-3:]:
        _, label = TOOL_TO_STATE.get(act["tool"], ("writing", act["tool"]))
        events.append({
            "who": "哆啦组长",
            "text": f"{label}" + (f" ({act['target']})" if act["target"] else ""),
            "time": datetime.fromtimestamp(act["ts"]).strftime("%H:%M:%S"),
            "ts": act["ts"],
        })
    for m in members[:5]:
        events.append({
            "who": m["name"],
            "text": m["detail"],
            "time": m["updated_at"],
            "ts": now - m["age_sec"],
        })
    events.sort(key=lambda e: e["ts"], reverse=True)

    return {
        "ok": True,
        "source": "antigravity",
        "teams": team_list,
        "active_team": chosen["cid"],
        "leader": leader_obj,
        "members": members,
        "events": events[:8],
        "updated_at": datetime.now().strftime("%H:%M:%S"),
    }


def _build_all_active_view(leaders: List[Dict[str, Any]], team_list: List[Dict[str, Any]], now: float) -> Dict[str, Any]:
    """Aggregate the top actively working sessions & workers across the whole Mac into one bustling room."""
    primary = leaders[0] if leaders else None
    if not primary:
        return {
            "ok": True, "source": "antigravity", "teams": team_list, "active_team": "__ALL__",
            "leader": None, "members": [], "events": [], "updated_at": datetime.now().strftime("%H:%M:%S"),
        }

    l_info = primary["info"]
    l_state, l_detail, _ = _compute_agent_state(l_info, now)
    leader_obj = {
        "id": primary["cid"],
        "short_id": primary["cid"][:8],
        "name": "哆啦组长",
        "role": f"总控 ({primary['title'][:16]})",
        "skin": "leader",
        "is_leader": True,
        "state": l_state,
        "detail": l_detail,
        "title": "全基地活跃 Agent 总览",
        "last_tool": l_info["last_tool_name"],
        "last_target": l_info["last_tool_target"],
        "steps": l_info["step_count"],
        "age_sec": int(max(0, now - l_info["effective_mtime"])),
        "updated_at": datetime.fromtimestamp(l_info["effective_mtime"]).strftime("%H:%M:%S"),
    }

    candidates = []
    # Include other active root conversations + active children
    for ld in leaders:
        if ld["cid"] != primary["cid"] and ld["age_sec"] < 600:
            st, det, wk = _compute_agent_state(ld["info"], now)
            candidates.append((wk, ld["mtime"], {
                "id": ld["cid"],
                "name": _short_display_name(ld["title"], 12),
                "role": "独立主线 Agent",
                "type_name": "lead",
                "state": st,
                "detail": det,
                "prompt": ld["title"],
                "last_tool": ld["info"]["last_tool_name"],
                "steps": ld["info"]["step_count"],
                "age_sec": ld["age_sec"],
                "updated_at": datetime.fromtimestamp(ld["mtime"]).strftime("%H:%M:%S"),
            }))
        for child_cid, meta, c_parsed, c_wk in ld["children_resolved"]:
            if not c_parsed:
                continue
            age = int(max(0, now - c_parsed["effective_mtime"]))
            if age > 600:
                continue
            st, det, wk = _compute_agent_state(c_parsed, now, role_hint=f"{meta.get('role','')} {meta.get('type_name','')}")
            candidates.append((wk, c_parsed["effective_mtime"], {
                "id": child_cid,
                "name": _short_display_name(meta.get("role") or "组员", 14),
                "role": f"{meta.get('type_name', 'sub')} 组员",
                "type_name": meta.get("type_name", "sub"),
                "state": st,
                "detail": det,
                "prompt": meta.get("prompt", ""),
                "last_tool": c_parsed["last_tool_name"],
                "steps": c_parsed["step_count"],
                "age_sec": age,
                "updated_at": datetime.fromtimestamp(c_parsed["effective_mtime"]).strftime("%H:%M:%S"),
            }))

    candidates.sort(key=lambda x: (1 if x[0] else 0, x[1]), reverse=True)
    members = []
    for idx, (_, _, item) in enumerate(candidates[:7]):
        item["short_id"] = item["id"][:8]
        item["skin"] = _pick_skin(item["name"] + " " + item["role"], item["type_name"], idx)
        item["is_leader"] = False
        members.append(item)

    events = [
        {"who": "哆啦组长", "text": leader_obj["detail"], "time": leader_obj["updated_at"], "ts": now - leader_obj["age_sec"]}
    ]
    for m in members[:6]:
        events.append({"who": m["name"], "text": m["detail"], "time": m["updated_at"], "ts": now - m["age_sec"]})
    events.sort(key=lambda e: e["ts"], reverse=True)

    return {
        "ok": True,
        "source": "antigravity",
        "teams": team_list,
        "active_team": "__ALL__",
        "leader": leader_obj,
        "members": members,
        "events": events[:8],
        "updated_at": datetime.now().strftime("%H:%M:%S"),
    }


def _collect_leaders(now: float, max_scan: int = 80) -> List[Dict[str, Any]]:
    pattern = os.path.join(BRAIN_DIR, "*", ".system_generated", "logs", "transcript.jsonl")
    paths = sorted(glob.glob(pattern), key=lambda p: os.path.getmtime(p), reverse=True)[:max_scan]

    parsed_by_cid: Dict[str, Dict[str, Any]] = {}
    child_to_parent: Dict[str, str] = {}

    for p in paths:
        info = _parse_transcript(p)
        parsed_by_cid[info["cid"]] = info

    for cid, info in list(parsed_by_cid.items()):
        for child_cid in info["children"]:
            child_to_parent[child_cid] = cid
        parent_cid = info.get("swarm_parent_cid")
        if parent_cid and parent_cid in parsed_by_cid:
            child_to_parent[cid] = parent_cid
            parent_info = parsed_by_cid[parent_cid]
            if cid not in parent_info["children"]:
                wname = info.get("swarm_worker_name") or f"worker-{cid[:4]}"
                parent_info["children"][cid] = {
                    "role": wname,
                    "type_name": "swarm",
                    "prompt": info.get("swarm_worker_brief") or "",
                    "spawned_at": info["mtime"],
                }

    leaders: List[Dict[str, Any]] = []
    for cid, info in parsed_by_cid.items():
        if cid in child_to_parent:
            continue
        l_state, l_detail, leader_working = _compute_agent_state(info, now)
        child_list = []
        working_children = 0
        latest_activity = info["effective_mtime"]

        for child_cid, meta in info["children"].items():
            c_parsed = parsed_by_cid.get(child_cid)
            c_working = False
            if c_parsed:
                latest_activity = max(latest_activity, c_parsed["effective_mtime"])
                _, _, c_working = _compute_agent_state(c_parsed, now, role_hint=f"{meta.get('role','')} {meta.get('type_name','')}")
                if c_working:
                    working_children += 1
            child_list.append((child_cid, meta, c_parsed, c_working))

        display_title = info["swarm_title"] or info["first_user_prompt"] or f"会话 {cid[:8]}"
        total_working = (1 if leader_working else 0) + working_children

        leaders.append({
            "cid": cid,
            "title": display_title,
            "mtime": latest_activity,
            "child_count": len(child_list),
            "working_count": total_working,
            "working_children": working_children,
            "leader_state": l_state,
            "leader_detail": l_detail,
            "leader_working": leader_working,
            "age_sec": int(max(0, now - latest_activity)),
            "is_active": total_working > 0 or (now - latest_activity) < 180,
            "info": info,
            "children_resolved": child_list,
        })

    leaders.sort(
        key=lambda x: (
            1 if x["working_count"] > 0 else 0,
            x["working_count"],
            1 if x["is_active"] else 0,
            x["mtime"],
        ),
        reverse=True,
    )
    return leaders


def scan_antigravity_hub(max_sessions: int = 8) -> Dict[str, Any]:
    """Main Hub Plaza: each character on the plaza represents one Antigravity conversation/session."""
    now = time.time()
    leaders = _collect_leaders(now)

    sessions = []
    events = []
    for idx, ld in enumerate(leaders[:max_sessions]):
        room, skin = _assign_session_identity(ld["cid"], idx)
        # If any subagent in this session is actively working, the session avatar in the Hub looks busy on computer too!
        hub_state = ld["leader_state"]
        hub_detail = ld["leader_detail"]
        if hub_state == "idle" and ld["working_children"] > 0:
            hub_state = "writing"
            hub_detail = f"正带着 {ld['working_children']} 位组员用电脑全力推进中!"

        short_title = _short_display_name(ld["title"], 12)
        sessions.append({
            "id": ld["cid"],
            "short_id": ld["cid"][:8],
            "name": short_title,
            "title": ld["title"],
            "role": f"房间: {room['name']}",
            "skin": skin,
            "is_leader": True,
            "is_session_card": True,
            "room_id": room["id"],
            "room_name": room["name"],
            "room_accent": room["accent"],
            "state": hub_state,
            "detail": hub_detail,
            "child_count": ld["child_count"],
            "working_count": ld["working_count"],
            "is_working": ld["working_count"] > 0,
            "last_tool": ld["info"]["last_tool_name"],
            "steps": ld["info"]["step_count"],
            "age_sec": ld["age_sec"],
            "updated_at": datetime.fromtimestamp(ld["mtime"]).strftime("%H:%M:%S"),
        })
        events.append({
            "who": short_title,
            "text": f"[{room['name']}] {hub_detail}",
            "time": datetime.fromtimestamp(ld["mtime"]).strftime("%H:%M:%S"),
            "ts": ld["mtime"],
        })

    events.sort(key=lambda e: e["ts"], reverse=True)
    return {
        "ok": True,
        "view": "hub",
        "hub_bg": "/assets/doraemon/rooms/hub_plaza.jpg",
        "rooms": ROOMS,
        "sessions": sessions,
        "events": events[:8],
        "updated_at": datetime.now().strftime("%H:%M:%S"),
    }


def scan_antigravity_room(cid: str) -> Dict[str, Any]:
    """Private Room view for one conversation: host character + all their subagents/swarm workers."""
    now = time.time()
    leaders = _collect_leaders(now)

    chosen = None
    chosen_idx = 0
    for idx, ld in enumerate(leaders):
        _assign_session_identity(ld["cid"], idx)
        if ld["cid"] == cid:
            chosen = ld
            chosen_idx = idx
            break
    if not chosen and leaders:
        chosen = leaders[0]
        chosen_idx = 0

    if not chosen:
        return {
            "ok": True, "view": "room", "room": ROOMS[0], "rooms": ROOMS,
            "leader": None, "members": [], "events": [], "updated_at": datetime.now().strftime("%H:%M:%S"),
        }

    room, host_skin = _assign_session_identity(chosen["cid"], chosen_idx)
    leader_info = chosen["info"]
    l_state = chosen["leader_state"]
    l_detail = chosen["leader_detail"]
    if l_state == "idle" and chosen["working_children"] > 0:
        l_state = "writing"
        l_detail = f"正在电脑前统筹 {chosen['working_children']} 位活跃组员!"

    leader_obj = {
        "id": chosen["cid"],
        "short_id": chosen["cid"][:8],
        "name": f"组长·{_short_display_name(chosen['title'], 8)}",
        "role": f"{room['name']} · 主控会话",
        "skin": host_skin,
        "is_leader": True,
        "state": l_state,
        "detail": l_detail,
        "title": chosen["title"],
        "last_tool": leader_info["last_tool_name"],
        "steps": leader_info["step_count"],
        "age_sec": int(max(0, now - leader_info["effective_mtime"])),
        "updated_at": datetime.fromtimestamp(leader_info["effective_mtime"]).strftime("%H:%M:%S"),
    }

    # Pick diverse teammate skins excluding or rotating around host_skin
    other_skins = [s for s in HUB_SKINS if s != host_skin] or TEAMMATE_SKINS
    children_sorted = sorted(
        chosen["children_resolved"],
        key=lambda item: (1 if item[3] else 0, item[2]["effective_mtime"] if item[2] else item[1].get("spawned_at", 0)),
        reverse=True,
    )

    members = []
    for idx, (child_cid, meta, c_parsed, _) in enumerate(children_sorted[:7]):
        role = meta.get("role") or "秘密组员"
        tname = meta.get("type_name") or "self"
        skin = other_skins[idx % len(other_skins)]

        if c_parsed:
            c_state, c_detail, _ = _compute_agent_state(c_parsed, now, role_hint=f"{role} {tname}")
            c_age = int(max(0, now - c_parsed["effective_mtime"]))
            c_steps = c_parsed["step_count"]
            c_tool = c_parsed["last_tool_name"]
            c_updated = datetime.fromtimestamp(c_parsed["effective_mtime"]).strftime("%H:%M:%S")
        else:
            spawn_age = int(max(0, now - meta.get("spawned_at", now)))
            c_state = "writing" if spawn_age < 40 else "idle"
            c_detail = "刚打开电脑准备干活!" if spawn_age < 40 else "已完成任务休息中~"
            c_age = spawn_age
            c_steps = 1
            c_tool = ""
            c_updated = datetime.fromtimestamp(meta.get("spawned_at", now)).strftime("%H:%M:%S")

        members.append({
            "id": child_cid,
            "short_id": child_cid[:8],
            "name": _short_display_name(role, 14),
            "role": f"{tname} 组员",
            "type_name": tname,
            "skin": skin,
            "is_leader": False,
            "state": c_state,
            "detail": c_detail,
            "prompt": meta.get("prompt", ""),
            "last_tool": c_tool,
            "steps": c_steps,
            "age_sec": c_age,
            "updated_at": c_updated,
        })

    events = []
    for act in leader_info["recent_actions"][-3:]:
        _, label = TOOL_TO_STATE.get(act["tool"], ("writing", act["tool"]))
        events.append({
            "who": leader_obj["name"],
            "text": f"{label}" + (f" ({act['target']})" if act["target"] else ""),
            "time": datetime.fromtimestamp(act["ts"]).strftime("%H:%M:%S"),
            "ts": act["ts"],
        })
    for m in members[:5]:
        events.append({
            "who": m["name"],
            "text": m["detail"],
            "time": m["updated_at"],
            "ts": now - m["age_sec"],
        })
    events.sort(key=lambda e: e["ts"], reverse=True)

    return {
        "ok": True,
        "view": "room",
        "room": room,
        "rooms": ROOMS,
        "session_cid": chosen["cid"],
        "leader": leader_obj,
        "members": members,
        "events": events[:8],
        "updated_at": datetime.now().strftime("%H:%M:%S"),
    }


if __name__ == "__main__":
    data = scan_antigravity_teams()
    print(json.dumps({
        "active_team": data["active_team"],
        "leader": data["leader"],
        "members": [(m["name"], m["skin"], m["state"], m["detail"], m["age_sec"]) for m in data["members"]],
        "teams_top5": [(t["short_id"], t["working_count"], t["child_count"], t["title"][:22]) for t in data["teams"][:5]],
    }, ensure_ascii=False, indent=2))

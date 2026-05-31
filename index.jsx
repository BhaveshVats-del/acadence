import { useState, useEffect, useCallback, useMemo } from "react";

const STORAGE_KEY = "acadence_data";

const defaultData = {
  subjects: [],
  topics: [],
  exams: [],
  sessions: [],
  progress: {},
  streak: { current: 0, longest: 0, lastActiveDate: null, history: {} },
  settings: { theme: "light", studyStart: "16:00", studyEnd: "21:00" },
};

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate()-1);
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

function computeStreak(streak) {
  const today = todayStr();
  const yesterday = yesterdayStr();
  // If already active today, nothing to recalculate
  if (streak.lastActiveDate === today) return streak;
  // If last active was yesterday, streak is intact but today not yet done
  if (streak.lastActiveDate === yesterday) return streak;
  // If last active was before yesterday (or null), streak is broken
  if (streak.lastActiveDate && streak.lastActiveDate < yesterday) {
    return { ...streak, current: 0 };
  }
  return streak;
}

function recordActivityToday(streak) {
  const today = todayStr();
  const yesterday = yesterdayStr();
  if (streak.lastActiveDate === today) return streak; // already recorded
  const newCurrent = (streak.lastActiveDate === yesterday || streak.lastActiveDate === today)
    ? streak.current + 1
    : 1;
  const newLongest = Math.max(streak.longest || 0, newCurrent);
  return {
    ...streak,
    current: newCurrent,
    longest: newLongest,
    lastActiveDate: today,
    history: { ...(streak.history||{}), [today]: true },
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultData, ...JSON.parse(raw) };
  } catch {}
  return defaultData;
}

function saveData(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const STATUS = { NOT_STARTED: "not_started", IN_PROGRESS: "in_progress", COMPLETED: "completed" };
const STATUS_LABELS = { not_started: "Not Started", in_progress: "In Progress", completed: "Completed" };
const STATUS_COLORS = {
  not_started: "#888",
  in_progress: "#f59e0b",
  completed: "#10b981",
};

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  return Math.ceil((d - today) / 86400000);
}

function formatTime(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24, nm = total % 60;
  return `${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}`;
}

function timeToMins(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function generateTimetable(subjects, topics, settings, dayName) {
  const slots = [];
  let current = settings.studyStart || "16:00";
  const endMins = timeToMins(settings.studyEnd || "21:00");

  const dayTopics = topics.filter(t => t.days && t.days.includes(dayName));
  const subjectMap = {};
  subjects.forEach(s => { subjectMap[s.id] = s; });

  const scheduled = [];
  dayTopics.forEach(topic => {
    const subj = subjectMap[topic.subjectId];
    if (subj) scheduled.push({ label: `${subj.name} – ${topic.name}`, duration: topic.duration || subj.duration || 60, type: "study", topicId: topic.id, subjectId: subj.id });
  });

  const scheduledSubjectIds = new Set(dayTopics.map(t => t.subjectId));
  subjects.forEach(s => {
    if (!scheduledSubjectIds.has(s.id)) {
      scheduled.push({ label: s.name, duration: s.duration || 60, type: "study", subjectId: s.id });
    }
  });

  subjects.forEach(s => {
    if (s.revisionTime && s.revisionTime > 0) {
      scheduled.push({ label: `${s.name} Revision`, duration: s.revisionTime, type: "revision", subjectId: s.id });
    }
  });

  let breakCount = 0;
  scheduled.forEach((item, i) => {
    if (timeToMins(current) + item.duration > endMins) return;
    slots.push({ ...item, start: current, end: addMinutes(current, item.duration) });
    current = addMinutes(current, item.duration);
    if (i < scheduled.length - 1 && breakCount < 3) {
      const breakDur = 15;
      if (timeToMins(current) + breakDur <= endMins) {
        slots.push({ label: "Break", duration: breakDur, type: "break", start: current, end: addMinutes(current, breakDur) });
        current = addMinutes(current, breakDur);
        breakCount++;
      }
    }
  });

  return slots;
}

const SUBJECTS_COLORS = ["#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#14b8a6"];

export default function Acadence() {
  const [data, setData] = useState(loadData);
  const [view, setView] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const { subjects, topics, exams, settings, progress } = data;
  const streak = data.streak || defaultData.streak;

  useEffect(() => { saveData(data); }, [data]);

  useEffect(() => {
    if (settings.theme === "dark") {
      document.documentElement.setAttribute("data-theme","dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [settings.theme]);

  // On load, check if streak should be broken (missed a day)
  useEffect(() => {
    const updated = computeStreak(streak);
    if (updated.current !== streak.current) {
      setData(d => ({ ...d, streak: updated }));
    }
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  const update = useCallback((key, val) => {
    setData(d => ({ ...d, [key]: val }));
  }, []);

  // Call this whenever user completes a task
  const recordStreak = useCallback(() => {
    setData(d => {
      const updated = recordActivityToday(d.streak || defaultData.streak);
      return { ...d, streak: updated };
    });
  }, []);

  const todayName = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
  const todaySlots = useMemo(() => generateTimetable(subjects, topics, settings, todayName), [subjects, topics, settings, todayName]);

  const upcomingExams = useMemo(() =>
    exams.filter(e => daysUntil(e.date) >= 0).sort((a,b) => new Date(a.date) - new Date(b.date)),
    [exams]
  );

  const completedTopics = useMemo(() =>
    topics.filter(t => progress[t.id] === STATUS.COMPLETED).length,
    [topics, progress]
  );

  function getSubjectColor(id) {
    const idx = subjects.findIndex(s => s.id === id);
    return SUBJECTS_COLORS[idx % SUBJECTS_COLORS.length] || "#6366f1";
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'Outfit', 'Nunito', system-ui, sans-serif", transition: "background 0.3s, color 0.3s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
        :root {
          --bg: #f0f4ff;
          --surface: #ffffff;
          --surface2: #f7f8fc;
          --border: rgba(99,102,241,0.12);
          --text: #1e1b4b;
          --text2: #6366f1;
          --text3: #94a3b8;
          --accent: #6366f1;
          --accent2: #818cf8;
          --shadow: 0 2px 16px rgba(99,102,241,0.1);
          --card-r: 16px;
        }
        [data-theme="dark"] {
          --bg: #0f0e1a;
          --surface: #1a1830;
          --surface2: #211f38;
          --border: rgba(129,140,248,0.15);
          --text: #e2e0ff;
          --text2: #818cf8;
          --text3: #6366f1;
          --accent: #818cf8;
          --accent2: #6366f1;
          --shadow: 0 2px 20px rgba(0,0,0,0.4);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input, select, textarea {
          font-family: inherit;
          background: var(--surface2);
          border: 1.5px solid var(--border);
          color: var(--text);
          border-radius: 10px;
          padding: 9px 14px;
          font-size: 14px;
          width: 100%;
          outline: none;
          transition: border-color 0.2s;
        }
        input:focus, select:focus, textarea:focus { border-color: var(--accent); }
        button { cursor: pointer; font-family: inherit; }
        .btn {
          padding: 10px 20px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          border: none;
          transition: opacity 0.15s, transform 0.1s;
        }
        .btn:active { transform: scale(0.97); }
        .btn-primary { background: var(--accent); color: #fff; }
        .btn-secondary { background: var(--surface2); color: var(--text); border: 1.5px solid var(--border); }
        .btn-danger { background: #fef2f2; color: #ef4444; border: 1.5px solid #fecaca; }
        .card {
          background: var(--surface);
          border-radius: var(--card-r);
          border: 1px solid var(--border);
          padding: 20px;
          box-shadow: var(--shadow);
        }
        .nav-item {
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          padding: 8px 14px; border-radius: 12px; font-size: 11px; font-weight: 500;
          color: var(--text3); background: none; border: none;
          transition: background 0.15s, color 0.15s;
        }
        .nav-item.active { background: var(--accent); color: #fff; }
        .nav-item svg { width: 22px; height: 22px; }
        .badge {
          display: inline-block; padding: 2px 10px; border-radius: 20px;
          font-size: 11px; font-weight: 600;
        }
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.45);
          display: flex; align-items: flex-end; justify-content: center;
          z-index: 100; animation: fadeIn 0.2s;
        }
        .modal-sheet {
          background: var(--surface); border-radius: 20px 20px 0 0;
          padding: 24px; width: 100%; max-width: 560px;
          max-height: 90vh; overflow-y: auto;
          animation: slideUp 0.25s cubic-bezier(0.32,0.72,0,1);
        }
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        .progress-bar {
          height: 7px; border-radius: 10px;
          background: var(--surface2);
          overflow: hidden;
        }
        .progress-fill {
          height: 100%; border-radius: 10px;
          background: linear-gradient(90deg, var(--accent), var(--accent2));
          transition: width 0.4s;
        }
        .toast {
          position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
          background: var(--surface); border: 1px solid var(--border);
          padding: 10px 20px; border-radius: 30px; font-size: 13px; font-weight: 500;
          box-shadow: var(--shadow); z-index: 200; white-space: nowrap;
          animation: fadeIn 0.2s;
        }
        .slot-card {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 16px; border-radius: 12px;
          border-left: 4px solid;
          background: var(--surface2);
          margin-bottom: 8px;
        }
        .chip-group { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip {
          padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500;
          cursor: pointer; user-select: none; transition: opacity 0.15s;
          border: 1.5px solid transparent;
        }
        .chip.active { opacity: 1; }
        .chip.inactive { opacity: 0.45; }
        label { font-size: 13px; font-weight: 500; color: var(--text3); display: block; margin-bottom: 5px; margin-top: 12px; }
        .section-title { font-size: 13px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
        .exam-countdown {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;
        }
        .list-item {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 0; border-bottom: 1px solid var(--border);
        }
        .list-item:last-child { border-bottom: none; }
        .icon-btn {
          background: none; border: none; color: var(--text3);
          padding: 6px; border-radius: 8px; font-size: 18px; line-height: 1;
          transition: background 0.15s, color 0.15s;
        }
        .icon-btn:hover { background: var(--surface2); color: var(--text); }
        @media (max-width: 500px) {
          .modal-sheet { padding: 20px 16px; }
          .card { padding: 16px; }
        }
      `}</style>

      {/* Main content */}
      <div style={{ maxWidth: 560, margin: "0 auto", paddingBottom: 90 }}>
        {/* Header */}
        <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>Acadence</div>
            <div style={{ fontSize: 13, color: "var(--text3)" }}>{new Date().toLocaleDateString("en-US", { weekday:"long", month:"short", day:"numeric" })}</div>
          </div>
          <button className="btn btn-secondary" style={{ padding: "8px 14px", fontSize: 13 }}
            onClick={() => update("settings", { ...settings, theme: settings.theme === "dark" ? "light" : "dark" })}>
            {settings.theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>

        {/* Views */}
        <div style={{ padding: "16px 16px 0" }}>
          {view === "dashboard" && <Dashboard subjects={subjects} topics={topics} exams={upcomingExams} todaySlots={todaySlots} progress={progress} completedTopics={completedTopics} getSubjectColor={getSubjectColor} todayName={todayName} streak={streak} />}
          {view === "subjects" && <SubjectsView subjects={subjects} topics={topics} progress={progress} update={update} setModal={setModal} showToast={showToast} getSubjectColor={getSubjectColor} recordStreak={recordStreak} />}
          {view === "timetable" && <TimetableView subjects={subjects} topics={topics} settings={settings} getSubjectColor={getSubjectColor} />}
          {view === "exams" && <ExamsView exams={exams} subjects={subjects} update={update} setModal={setModal} showToast={showToast} getSubjectColor={getSubjectColor} />}
          {view === "progress" && <ProgressView subjects={subjects} topics={topics} progress={progress} update={update} getSubjectColor={getSubjectColor} recordStreak={recordStreak} />}
          {view === "settings" && <SettingsView settings={settings} update={update} showToast={showToast} />}
        </div>
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "var(--surface)", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-around", padding: "8px 0 12px", zIndex: 50 }}>
        {[
          { id: "dashboard", label: "Home", icon: <HomeIcon /> },
          { id: "subjects", label: "Subjects", icon: <BookIcon /> },
          { id: "timetable", label: "Schedule", icon: <CalIcon /> },
          { id: "exams", label: "Exams", icon: <StarIcon /> },
          { id: "progress", label: "Progress", icon: <ChartIcon /> },
        ].map(n => (
          <button key={n.id} className={`nav-item ${view === n.id ? "active" : ""}`} onClick={() => setView(n.id)}>
            {n.icon}{n.label}
          </button>
        ))}
      </div>

      {/* Modal */}
      {modal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="modal-sheet">
            {modal.type === "add_subject" && <SubjectModal data={data} update={update} setModal={setModal} showToast={showToast} editing={modal.editing} />}
            {modal.type === "add_topic" && <TopicModal data={data} update={update} setModal={setModal} showToast={showToast} editing={modal.editing} subjectId={modal.subjectId} />}
            {modal.type === "add_exam" && <ExamModal data={data} update={update} setModal={setModal} showToast={showToast} editing={modal.editing} />}
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" style={{ color: toast.type === "error" ? "#ef4444" : "#10b981" }}>
          {toast.type === "error" ? "⚠️" : "✓"} {toast.msg}
        </div>
      )}
    </div>
  );
}

function Dashboard({ subjects, topics, exams, todaySlots, progress, completedTopics, getSubjectColor, todayName, streak }) {
  const totalTopics = topics.length;
  const pct = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;
  const str = streak || { current: 0, longest: 0, history: {} };

  // Last 7 days for activity grid
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    const label = d.toLocaleDateString("en-US", { weekday: "short" });
    return { key, label, active: !!(str.history||{})[key] };
  });

  const flameColor = str.current >= 7 ? "#f59e0b" : str.current >= 3 ? "#f97316" : str.current >= 1 ? "#ef4444" : "#94a3b8";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {[
          { label: "Subjects", val: subjects.length, color: "#6366f1" },
          { label: "Topics", val: topics.length, color: "#10b981" },
          { label: "Exams", val: exams.length, color: "#f59e0b" },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: "center", padding: "14px 10px" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Streak card */}
      <div className="card" style={{ background: str.current > 0 ? `linear-gradient(135deg, ${flameColor}18, ${flameColor}08)` : "var(--surface)", border: str.current > 0 ? `1px solid ${flameColor}40` : "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>{str.current >= 7 ? "🔥" : str.current >= 3 ? "⚡" : str.current >= 1 ? "✨" : "💤"}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 22, color: flameColor, lineHeight: 1 }}>{str.current} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text3)" }}>day{str.current !== 1 ? "s" : ""}</span></div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>Current streak</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: "var(--text)" }}>{str.longest || 0}</div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>Best streak</div>
          </div>
        </div>
        {/* 7-day activity dots */}
        <div style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
          {last7.map(day => (
            <div key={day.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <div style={{ width: "100%", aspectRatio: "1", borderRadius: 6, background: day.active ? flameColor : "var(--surface2)", border: `1px solid ${day.active ? flameColor : "var(--border)"}`, transition: "background 0.3s", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {day.active && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="1.5,5 4,7.5 8.5,2" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 500 }}>{day.label}</div>
            </div>
          ))}
        </div>
        {str.current === 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)", textAlign: "center" }}>Complete a topic today to start your streak 🎯</div>
        )}
        {str.current > 0 && str.lastActiveDate !== todayStr() && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#f97316", textAlign: "center", fontWeight: 500 }}>⚠️ Complete a topic today to keep your streak!</div>
        )}
      </div>

      {/* Progress */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Overall Progress</span>
          <span style={{ fontWeight: 700, color: "var(--accent)" }}>{pct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>{completedTopics} of {totalTopics} topics completed</div>
      </div>

      {/* Today's schedule */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Today – {todayName}</span>
          <span className="badge" style={{ background: "var(--surface2)", color: "var(--accent)", fontSize: 12 }}>{todaySlots.filter(s => s.type !== "break").length} sessions</span>
        </div>
        {todaySlots.length === 0 && subjects.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 14, padding: "20px 0" }}>Add subjects to generate your timetable</div>
        )}
        {todaySlots.slice(0, 5).map((slot, i) => (
          <div key={i} className="slot-card" style={{ borderLeftColor: slot.type === "break" ? "#e2e8f0" : (slot.subjectId ? getSubjectColor(slot.subjectId) : "#6366f1") }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{slot.label}</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>{slot.start} – {slot.end}</div>
            </div>
            <span className="badge" style={{ background: slot.type === "break" ? "#f1f5f9" : slot.type === "revision" ? "#fef3c7" : "#ede9fe", color: slot.type === "break" ? "#64748b" : slot.type === "revision" ? "#d97706" : "#7c3aed", fontSize: 11, whiteSpace: "nowrap" }}>
              {slot.type === "break" ? "Break" : slot.type === "revision" ? "Revision" : formatTime(slot.duration)}
            </span>
          </div>
        ))}
        {todaySlots.length > 5 && <div style={{ fontSize: 12, color: "var(--text3)", textAlign: "center", marginTop: 8 }}>+{todaySlots.length - 5} more sessions</div>}
      </div>

      {/* Upcoming exams */}
      {exams.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Upcoming Exams</div>
          {exams.slice(0,3).map(exam => {
            const days = daysUntil(exam.date);
            return (
              <div key={exam.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{exam.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)" }}>{exam.subject} · {new Date(exam.date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                </div>
                <span className="exam-countdown" style={{ background: days === 0 ? "#fef2f2" : days <= 3 ? "#fffbeb" : "#f0fdf4", color: days === 0 ? "#ef4444" : days <= 3 ? "#d97706" : "#16a34a" }}>
                  {days === 0 ? "Today!" : days === 1 ? "Tomorrow" : `${days}d`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubjectsView({ subjects, topics, progress, update, setModal, showToast, getSubjectColor }) {
  const [expanded, setExpanded] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { type: "subject"|"topic", id }
  const [confirmDeleteTopic, setConfirmDeleteTopic] = useState(null);

  function doDeleteSubject(id) {
    update("subjects", subjects.filter(s => s.id !== id));
    update("topics", topics.filter(t => t.subjectId !== id));
    setConfirmDelete(null);
    showToast("Subject deleted");
  }

  function doDeleteTopic(id) {
    update("topics", topics.filter(t => t.id !== id));
    setConfirmDeleteTopic(null);
    showToast("Topic deleted");
  }

  function toggleTopicDone(topicId) {
    const current = progress[topicId] || STATUS.NOT_STARTED;
    const next = current === STATUS.COMPLETED ? STATUS.NOT_STARTED : STATUS.COMPLETED;
    update("progress", { ...progress, [topicId]: next });
  }

  function toggleSubjectDone(subjectId) {
    const subTopics = topics.filter(t => t.subjectId === subjectId);
    const allDone = subTopics.every(t => (progress[t.id] || STATUS.NOT_STARTED) === STATUS.COMPLETED);
    const newProgress = { ...progress };
    subTopics.forEach(t => { newProgress[t.id] = allDone ? STATUS.NOT_STARTED : STATUS.COMPLETED; });
    update("progress", newProgress);
  }

  const getTopics = (sid) => topics.filter(t => t.subjectId === sid);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Subjects</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ fontSize: 13, padding: "8px 14px" }} onClick={() => setModal({ type: "add_topic" })}>+ Topic</button>
          <button className="btn btn-primary" style={{ fontSize: 13, padding: "8px 14px" }} onClick={() => setModal({ type: "add_subject" })}>+ Subject</button>
        </div>
      </div>

      {subjects.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "40px 20px", color: "var(--text3)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No subjects yet</div>
          <div style={{ fontSize: 13 }}>Add your first subject to get started</div>
        </div>
      )}

      {subjects.map(subj => {
        const subTopics = getTopics(subj.id);
        const done = subTopics.filter(t => progress[t.id] === STATUS.COMPLETED).length;
        const pct = subTopics.length > 0 ? Math.round((done / subTopics.length) * 100) : 0;
        const color = getSubjectColor(subj.id);
        const isExp = expanded === subj.id;
        const isConfirming = confirmDelete === subj.id;

        return (
          <div key={subj.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", cursor: isConfirming ? "default" : "pointer" }} onClick={() => { if (!isConfirming) setExpanded(isExp ? null : subj.id); }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  onClick={e => { e.stopPropagation(); toggleSubjectDone(subj.id); }}
                  style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${color}`, background: subTopics.length > 0 && subTopics.every(t => (progress[t.id]||STATUS.NOT_STARTED) === STATUS.COMPLETED) ? color : "transparent", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.2s" }}
                >
                  {subTopics.length > 0 && subTopics.every(t => (progress[t.id]||STATUS.NOT_STARTED) === STATUS.COMPLETED) && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{subj.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                    {formatTime(subj.duration || 60)} study · {subj.revisionTime > 0 ? formatTime(subj.revisionTime) + " revision" : "No revision"} · {subTopics.length} topics
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="icon-btn" onClick={e => { e.stopPropagation(); setModal({ type: "add_subject", editing: subj }); }}>✏️</button>
                  <button className="icon-btn" style={{ color: isConfirming ? "#ef4444" : undefined }} onClick={e => { e.stopPropagation(); setConfirmDelete(isConfirming ? null : subj.id); }}>🗑️</button>
                </div>
              </div>
              {isConfirming && (
                <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "#991b1b", fontWeight: 500 }}>Delete "{subj.name}" and all its topics?</span>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button className="btn" style={{ padding: "6px 14px", fontSize: 12, background: "white", border: "1px solid #fecaca", color: "#64748b", borderRadius: 8 }} onClick={e => { e.stopPropagation(); setConfirmDelete(null); }}>Cancel</button>
                    <button className="btn" style={{ padding: "6px 14px", fontSize: 12, background: "#ef4444", color: "white", border: "none", borderRadius: 8 }} onClick={e => { e.stopPropagation(); doDeleteSubject(subj.id); }}>Delete</button>
                  </div>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)", marginBottom: 4 }}>
                  <span>{done}/{subTopics.length} completed</span><span>{pct}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            </div>

            {isExp && (
              <div style={{ borderTop: "1px solid var(--border)", padding: "0 20px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0 10px" }}>
                  <span className="section-title" style={{ margin: 0 }}>Topics</span>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => setModal({ type: "add_topic", subjectId: subj.id })}>+ Topic</button>
                </div>
                {subTopics.length === 0 && <div style={{ fontSize: 13, color: "var(--text3)", textAlign: "center", padding: "12px 0" }}>No topics yet</div>}
                {subTopics.map(topic => (
                  <div key={topic.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
                      <div
                        onClick={() => toggleTopicDone(topic.id)}
                        style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${(progress[topic.id]||STATUS.NOT_STARTED) === STATUS.COMPLETED ? "#10b981" : "var(--border)"}`, background: (progress[topic.id]||STATUS.NOT_STARTED) === STATUS.COMPLETED ? "#10b981" : "transparent", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}
                      >
                        {(progress[topic.id]||STATUS.NOT_STARTED) === STATUS.COMPLETED && (
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
                      </div>
                      <div style={{ flex: 1, opacity: (progress[topic.id]||STATUS.NOT_STARTED) === STATUS.COMPLETED ? 0.5 : 1, transition: "opacity 0.2s" }}>
                        <div style={{ fontWeight: 500, fontSize: 14, textDecoration: (progress[topic.id]||STATUS.NOT_STARTED) === STATUS.COMPLETED ? "line-through" : "none" }}>{topic.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text3)" }}>{(topic.days||[]).join(", ") || "All days"}{topic.duration ? ` · ${topic.duration}m` : ""}</div>
                      </div>
                      <button className="icon-btn" onClick={() => setModal({ type: "add_topic", editing: topic, subjectId: subj.id })}>✏️</button>
                      <button className="icon-btn" style={{ color: confirmDeleteTopic === topic.id ? "#ef4444" : undefined }} onClick={() => setConfirmDeleteTopic(confirmDeleteTopic === topic.id ? null : topic.id)}>🗑️</button>
                    </div>
                    {confirmDeleteTopic === topic.id && (
                      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontSize: 12, color: "#991b1b", fontWeight: 500 }}>Delete "{topic.name}"?</span>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button className="btn" style={{ padding: "5px 12px", fontSize: 12, background: "white", border: "1px solid #fecaca", color: "#64748b", borderRadius: 8 }} onClick={() => setConfirmDeleteTopic(null)}>Cancel</button>
                          <button className="btn" style={{ padding: "5px 12px", fontSize: 12, background: "#ef4444", color: "white", border: "none", borderRadius: 8 }} onClick={() => doDeleteTopic(topic.id)}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TimetableView({ subjects, topics, settings, getSubjectColor }) {
  const [selectedDay, setSelectedDay] = useState(DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1]);
  const slots = useMemo(() => generateTimetable(subjects, topics, settings, selectedDay), [subjects, topics, settings, selectedDay]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 18 }}>Schedule</div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {DAYS.map(d => (
          <button key={d} onClick={() => setSelectedDay(d)}
            style={{ padding: "8px 14px", borderRadius: 20, fontSize: 13, fontWeight: 500, border: "none", whiteSpace: "nowrap", background: selectedDay === d ? "var(--accent)" : "var(--surface)", color: selectedDay === d ? "#fff" : "var(--text3)", cursor: "pointer", transition: "all 0.15s" }}>
            {d.slice(0,3)}
          </button>
        ))}
      </div>

      {subjects.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "40px 20px", color: "var(--text3)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No schedule yet</div>
          <div style={{ fontSize: 13 }}>Add subjects to auto-generate your timetable</div>
        </div>
      )}

      {slots.length === 0 && subjects.length > 0 && (
        <div className="card" style={{ textAlign: "center", padding: "30px 20px", color: "var(--text3)" }}>
          <div style={{ fontSize: 13 }}>No sessions fit in today's study window. Adjust your study hours in Settings.</div>
        </div>
      )}

      {slots.map((slot, i) => {
        const color = slot.subjectId ? getSubjectColor(slot.subjectId) : "#94a3b8";
        return (
          <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ minWidth: 70, textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{slot.start}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>{slot.end}</div>
            </div>
            <div style={{ flex: 1, padding: "14px 16px", borderRadius: 12, background: slot.type === "break" ? "var(--surface2)" : "var(--surface)", border: `1px solid ${slot.type === "break" ? "var(--border)" : color + "40"}`, borderLeft: `4px solid ${color}` }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: slot.type === "break" ? "var(--text3)" : "var(--text)" }}>{slot.label}</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>
                {formatTime(slot.duration)} · {slot.type === "break" ? "Rest" : slot.type === "revision" ? "Revision" : "Study"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExamsView({ exams, subjects, update, setModal, showToast, getSubjectColor }) {
  const [confirmDeleteExam, setConfirmDeleteExam] = useState(null);

  function doDeleteExam(id) {
    update("exams", exams.filter(e => e.id !== id));
    setConfirmDeleteExam(null);
    showToast("Exam deleted");
  }

  const sorted = [...exams].sort((a,b) => new Date(a.date) - new Date(b.date));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Exams</div>
        <button className="btn btn-primary" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => setModal({ type: "add_exam" })}>+ Add Exam</button>
      </div>

      {exams.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "40px 20px", color: "var(--text3)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No exams scheduled</div>
          <div style={{ fontSize: 13 }}>Add your upcoming exams to track countdowns</div>
        </div>
      )}

      {sorted.map(exam => {
        const days = daysUntil(exam.date);
        const passed = days < 0;
        return (
          <div key={exam.id} className="card" style={{ opacity: passed ? 0.55 : 1 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={{ width: 50, height: 50, borderRadius: 12, background: passed ? "#f1f5f9" : days === 0 ? "#fef2f2" : days <= 3 ? "#fffbeb" : "#ede9fe", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: passed ? "#94a3b8" : days === 0 ? "#ef4444" : days <= 3 ? "#d97706" : "#7c3aed" }}>
                  {passed ? "✓" : days === 0 ? "!" : days === 1 ? "1" : days}
                </div>
                <div style={{ fontSize: 10, color: "var(--text3)" }}>{passed ? "done" : days === 0 ? "today" : days === 1 ? "day" : "days"}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{exam.name}</div>
                <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 3 }}>{exam.subject}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                  {new Date(exam.date).toLocaleDateString("en-US",{weekday:"long", year:"numeric", month:"long", day:"numeric"})}
                  {exam.time && ` · ${exam.time}`}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button className="icon-btn" onClick={() => setModal({ type: "add_exam", editing: exam })}>✏️</button>
                <button className="icon-btn" style={{ color: confirmDeleteExam === exam.id ? "#ef4444" : undefined }} onClick={() => setConfirmDeleteExam(confirmDeleteExam === exam.id ? null : exam.id)}>🗑️</button>
              </div>
            </div>
            {confirmDeleteExam === exam.id && (
              <div style={{ marginTop: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 13, color: "#991b1b", fontWeight: 500 }}>Delete this exam?</span>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button className="btn" style={{ padding: "6px 14px", fontSize: 12, background: "white", border: "1px solid #fecaca", color: "#64748b", borderRadius: 8 }} onClick={() => setConfirmDeleteExam(null)}>Cancel</button>
                  <button className="btn" style={{ padding: "6px 14px", fontSize: 12, background: "#ef4444", color: "white", border: "none", borderRadius: 8 }} onClick={() => doDeleteExam(exam.id)}>Delete</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProgressView({ subjects, topics, progress, update, getSubjectColor, recordStreak }) {
  function setStatus(topicId, status) {
    update("progress", { ...progress, [topicId]: status });
    if (status === STATUS.COMPLETED) recordStreak();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 18 }}>Progress</div>

      {subjects.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "40px 20px", color: "var(--text3)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Nothing to track yet</div>
          <div style={{ fontSize: 13 }}>Add subjects and topics to track your progress</div>
        </div>
      )}

      {subjects.map(subj => {
        const subTopics = topics.filter(t => t.subjectId === subj.id);
        if (subTopics.length === 0) return null;
        const color = getSubjectColor(subj.id);
        const done = subTopics.filter(t => progress[t.id] === STATUS.COMPLETED).length;
        const pct = Math.round((done / subTopics.length) * 100);

        return (
          <div key={subj.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
                <span style={{ fontWeight: 600, fontSize: 15 }}>{subj.name}</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: color }}>{pct}%</span>
            </div>
            <div className="progress-bar" style={{ marginBottom: 14 }}>
              <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            {subTopics.map(topic => {
              const s = progress[topic.id] || STATUS.NOT_STARTED;
              return (
                <div key={topic.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: STATUS_COLORS[s], flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{topic.name}</div>
                  <select value={s} onChange={e => setStatus(topic.id, e.target.value)}
                    style={{ width: "auto", padding: "5px 8px", fontSize: 12 }}>
                    {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function SettingsView({ settings, update, showToast }) {
  const [start, setStart] = useState(settings.studyStart || "16:00");
  const [end, setEnd] = useState(settings.studyEnd || "21:00");

  function saveStudyHours() {
    if (start >= end) { showToast("End time must be after start time", "error"); return; }
    update("settings", { ...settings, studyStart: start, studyEnd: end });
    showToast("Study hours saved");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 18 }}>Settings</div>

      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Study Hours</div>
        <label>Study Start Time</label>
        <input type="time" value={start} onChange={e => setStart(e.target.value)} />
        <label>Study End Time</label>
        <input type="time" value={end} onChange={e => setEnd(e.target.value)} />
        <button className="btn btn-primary" style={{ marginTop: 14, width: "100%" }} onClick={saveStudyHours}>Save Hours</button>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Appearance</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14 }}>Theme</span>
          <div style={{ display: "flex", gap: 8 }}>
            {["light","dark"].map(t => (
              <button key={t} className={`btn ${settings.theme === t ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "8px 16px", fontSize: 13 }}
                onClick={() => update("settings", { ...settings, theme: t })}>
                {t === "light" ? "☀️ Light" : "🌙 Dark"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>About</div>
        <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.7 }}>
          Acadence helps you manage your study sessions, track topics, and stay prepared for exams. All data is stored locally on your device.
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--text3)" }}>Version 1.0.0 · No AI · No external services</div>
      </div>
    </div>
  );
}

// ---- Modals ----

function SubjectModal({ data, update, setModal, showToast, editing }) {
  const [name, setName] = useState(editing?.name || "");
  const [duration, setDuration] = useState(editing?.duration || 60);
  const [revisionTime, setRevisionTime] = useState(editing?.revisionTime || 0);

  function save() {
    if (!name.trim()) { showToast("Subject name required", "error"); return; }
    if (editing) {
      update("subjects", data.subjects.map(s => s.id === editing.id ? { ...s, name: name.trim(), duration: Number(duration), revisionTime: Number(revisionTime) } : s));
      showToast("Subject updated");
    } else {
      update("subjects", [...data.subjects, { id: uid(), name: name.trim(), duration: Number(duration), revisionTime: Number(revisionTime) }]);
      showToast("Subject added");
    }
    setModal(null);
  }

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>{editing ? "Edit Subject" : "Add Subject"}</div>
      <label>Subject Name</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mathematics" autoFocus />
      <label>Daily Study Duration (minutes)</label>
      <input type="number" value={duration} onChange={e => setDuration(e.target.value)} min={10} max={300} />
      <label>Daily Revision Time (minutes, 0 to skip)</label>
      <input type="number" value={revisionTime} onChange={e => setRevisionTime(e.target.value)} min={0} max={120} />
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setModal(null)}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={save}>{editing ? "Save" : "Add Subject"}</button>
      </div>
    </div>
  );
}

function TopicModal({ data, update, setModal, showToast, editing, subjectId }) {
  const [name, setName] = useState(editing?.name || "");
  const [selSubjectId, setSelSubjectId] = useState(editing?.subjectId || subjectId || (data.subjects[0]?.id || ""));
  const [duration, setDuration] = useState(editing?.duration ?? "");
  const [selectedDays, setSelectedDays] = useState(editing?.days || []);

  function toggleDay(d) {
    setSelectedDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }

  function save() {
    if (!name.trim()) { showToast("Topic name required", "error"); return; }
    if (!selSubjectId) { showToast("Please select a subject", "error"); return; }
    const dur = duration === "" ? null : Number(duration);
    if (dur !== null && (isNaN(dur) || dur < 5)) { showToast("Time limit must be at least 5 minutes", "error"); return; }
    if (editing) {
      update("topics", data.topics.map(t => t.id === editing.id ? { ...t, name: name.trim(), subjectId: selSubjectId, duration: dur, days: selectedDays } : t));
      showToast("Topic updated");
    } else {
      update("topics", [...data.topics, { id: uid(), name: name.trim(), subjectId: selSubjectId, duration: dur, days: selectedDays }]);
      showToast("Topic added");
    }
    setModal(null);
  }

  const selSubj = data.subjects.find(s => s.id === selSubjectId);

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>{editing ? "Edit Topic" : "Add Topic"}</div>

      <label>Subject</label>
      {data.subjects.length === 0 ? (
        <div style={{ fontSize: 13, color: "#ef4444", padding: "10px 0" }}>No subjects yet — add a subject first.</div>
      ) : (
        <select value={selSubjectId} onChange={e => setSelSubjectId(e.target.value)}>
          {data.subjects.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}

      <label>Topic Name</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Quadratic Equations" autoFocus />

      <label>Time Limit (minutes)</label>
      <input
        type="number"
        value={duration}
        onChange={e => setDuration(e.target.value)}
        min={5} max={300}
        placeholder={selSubj ? `Default: ${selSubj.duration || 60} min (from subject)` : "e.g. 45"}
      />
      <div style={{ fontSize: 11, color: duration === "" ? "var(--text3)" : "var(--accent)", marginTop: 4 }}>
        {duration === ""
          ? `Leave blank to inherit the subject duration (${selSubj?.duration || 60} min)`
          : `This topic will be scheduled for ${duration} min in the timetable`}
      </div>

      <label>Assign to Days (leave empty for all days)</label>
      <div className="chip-group" style={{ marginTop: 8 }}>
        {DAYS.map(d => (
          <button key={d} className={`chip ${selectedDays.includes(d) ? "active" : "inactive"}`}
            style={{ background: selectedDays.includes(d) ? "var(--accent)" : "var(--surface2)", color: selectedDays.includes(d) ? "#fff" : "var(--text)", border: "1.5px solid " + (selectedDays.includes(d) ? "var(--accent)" : "var(--border)") }}
            onClick={() => toggleDay(d)}>
            {d.slice(0,3)}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setModal(null)}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={data.subjects.length === 0}>
          {editing ? "Save Changes" : "Add Topic"}
        </button>
      </div>
    </div>
  );
}

function ExamModal({ data, update, setModal, showToast, editing }) {
  const [name, setName] = useState(editing?.name || "");
  const [subject, setSubject] = useState(editing?.subject || "");
  const [date, setDate] = useState(editing?.date || "");
  const [time, setTime] = useState(editing?.time || "");

  function save() {
    if (!name.trim()) { showToast("Exam name required", "error"); return; }
    if (!date) { showToast("Exam date required", "error"); return; }
    if (editing) {
      update("exams", data.exams.map(e => e.id === editing.id ? { ...e, name: name.trim(), subject: subject.trim(), date, time } : e));
      showToast("Exam updated");
    } else {
      update("exams", [...data.exams, { id: uid(), name: name.trim(), subject: subject.trim(), date, time }]);
      showToast("Exam added");
    }
    setModal(null);
  }

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>{editing ? "Edit Exam" : "Add Exam"}</div>
      <label>Exam Name</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mathematics Final" autoFocus />
      <label>Subject</label>
      {data.subjects.length > 0 ? (
        <select value={subject} onChange={e => setSubject(e.target.value)}>
          <option value="">Select subject</option>
          {data.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          <option value="Other">Other</option>
        </select>
      ) : (
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Mathematics" />
      )}
      <label>Exam Date</label>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} min={todayStr} />
      <label>Exam Time (optional)</label>
      <input type="time" value={time} onChange={e => setTime(e.target.value)} />
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setModal(null)}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={save}>{editing ? "Save" : "Add Exam"}</button>
      </div>
    </div>
  );
}

// ---- Icons ----
function HomeIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>; }
function BookIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>; }
function CalIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>; }
function StarIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>; }
function ChartIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>; }

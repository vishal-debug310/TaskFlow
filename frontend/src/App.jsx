import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Activity, AlertCircle, ArrowRight, Bell, CalendarDays, Check, CheckCircle2,
  Circle, Clock3, Download, FileText, Filter, FolderKanban, LayoutDashboard,
  ListTodo, Loader2, MessageSquare, MoreHorizontal, Plus, RefreshCw, Search,
  Settings, Sparkles, Trash2, Users, X, ChartNoAxesColumn,
} from "lucide-react";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1").replace(/\/$/, "");
const columns = [
  { key: "TODO", label: "To do", hint: "Ready when you are", icon: Circle, tone: "todo" },
  { key: "IN_PROGRESS", label: "In progress", hint: "Work currently underway", icon: Clock3, tone: "progress" },
  { key: "DONE", label: "Done", hint: "Successfully completed", icon: CheckCircle2, tone: "done" },
];
const priorityTone = { HIGH: "priority-high", MEDIUM: "priority-medium", LOW: "priority-low" };

export default function App() {
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [assignee, setAssignee] = useState("Vishal");
  const [blockedById, setBlockedById] = useState("");
  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState("ALL");
  const [errorMsg, setErrorMsg] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyTask, setBusyTask] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [exportStatus, setExportStatus] = useState("IDLE");
  const [downloadFile, setDownloadFile] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const pollTimer = useRef(null);
  const pollCancelled = useRef(false);

  const fetchTasks = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/tasks`);
      setTasks(Array.isArray(data) ? data : []);
      setErrorMsg("");
    } catch (error) {
      setErrorMsg(error.response?.data?.detail || "Could not load tasks. Check that the API is running.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    return () => {
      pollCancelled.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [fetchTasks]);

  const counts = useMemo(() => ({
    total: tasks.length,
    TODO: tasks.filter((task) => task.status === "TODO").length,
    IN_PROGRESS: tasks.filter((task) => task.status === "IN_PROGRESS").length,
    DONE: tasks.filter((task) => task.status === "DONE").length,
  }), [tasks]);

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${task.title || ""} ${task.description || ""} ${task.assignee || ""} ${task.id}`.toLowerCase().includes(query);
    const matchesPriority = filterPriority === "ALL" || task.priority === filterPriority;
    return matchesSearch && matchesPriority;
  }), [tasks, search, filterPriority]);

  const handleSuggestAssignee = async () => {
    setSuggesting(true);
    try {
      const { data } = await axios.get(`${API_URL}/tasks/suggest-assignee`);
      if (data.recommended_assignee) {
        setAssignee(data.recommended_assignee);
        setNotice(`Suggested teammate: ${data.recommended_assignee}`);
      }
    } catch (error) {
      setErrorMsg(error.response?.data?.detail || "Unable to get an assignee suggestion.");
    } finally {
      setSuggesting(false);
    }
  };

  const handleCreateTask = async (event) => {
    event.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setErrorMsg("");
    setNotice("");
    try {
      await axios.post(`${API_URL}/tasks`, {
        title: title.trim(), description: description.trim() || null,
        priority, assignee: assignee.trim() || "Unassigned",
        blocked_by_id: blockedById ? Number(blockedById) : null,
      });
      setTitle(""); setDescription(""); setBlockedById("");
      setNotice("Task created successfully.");
      await fetchTasks(true);
    } catch (error) {
      setErrorMsg(error.response?.data?.detail || "Failed to create task.");
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (taskId, status) => {
    setBusyTask(taskId); setErrorMsg(""); setNotice("");
    try {
      await axios.patch(`${API_URL}/tasks/${taskId}`, { status });
      await fetchTasks(true);
      setNotice(status === "DONE" ? "Task marked as complete." : "Task moved to in progress.");
    } catch (error) {
      setErrorMsg(error.response?.data?.detail || "Could not update this task.");
    } finally {
      setBusyTask(null);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm(`Delete task #${taskId}? This action cannot be undone.`)) return;
    setBusyTask(taskId); setErrorMsg(""); setNotice("");
    try {
      await axios.delete(`${API_URL}/tasks/${taskId}`);
      await fetchTasks(true);
      setNotice(`Task #${taskId} deleted.`);
    } catch (error) {
      setErrorMsg(error.response?.data?.detail || "Could not delete this task. It may be a dependency of another task.");
    } finally {
      setBusyTask(null);
    }
  };

  const handleTriggerExport = async () => {
    setExportStatus("PENDING"); setDownloadFile(null); setErrorMsg("");
    pollCancelled.current = false;
    try {
      const { data } = await axios.post(`${API_URL}/jobs/export`);
      const jobId = data.job_id;
      const startedAt = Date.now();
      const poll = async () => {
        if (pollCancelled.current) return;
        try {
          const { data: statusData } = await axios.get(`${API_URL}/jobs/${jobId}`);
          if (statusData.status === "SUCCESS") {
            setExportStatus("SUCCESS");
            setDownloadFile(statusData.result?.filename || null);
            if (!statusData.result?.filename) setErrorMsg("Export completed, but the API did not return a filename.");
            return;
          }
          if (["FAILURE", "REVOKED"].includes(statusData.status)) {
            setExportStatus("IDLE");
            setErrorMsg(statusData.error || "The CSV export job failed.");
            return;
          }
          if (Date.now() - startedAt > 120000) {
            setExportStatus("IDLE");
            setErrorMsg("Export is taking longer than expected. Check the worker logs and try again.");
            return;
          }
          pollTimer.current = setTimeout(poll, 1800);
        } catch {
          setExportStatus("IDLE");
          setErrorMsg("Lost connection while checking the export job.");
        }
      };
      pollTimer.current = setTimeout(poll, 1000);
    } catch (error) {
      setExportStatus("IDLE");
      setErrorMsg(error.response?.data?.detail || "Failed to start the CSV export.");
    }
  };


  const completion = counts.total ? Math.round((counts.DONE / counts.total) * 100) : 0;
  const highPriority = tasks.filter((task) => task.priority === "HIGH").length;
  const mediumPriority = tasks.filter((task) => task.priority === "MEDIUM").length;
  const lowPriority = tasks.filter((task) => task.priority === "LOW").length;
  const recentTasks = [...tasks].sort((a, b) => b.id - a.id).slice(0, 5);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="TaskFlow home">
          <span className="brand-mark"><Activity size={21} /></span>
          <span>TaskFlow<span className="brand-dot">.</span><small>WORKSPACE</small></span>
        </a>
        <div className="side-label">WORKSPACE</div>
        <a className="side-link active" href="#top"><LayoutDashboard size={18} /> Overview</a>
        <a className="side-link" href="#board"><FolderKanban size={18} /> Projects</a>
        <a className="side-link" href="#board"><ListTodo size={18} /> Tasks</a>
        <a className="side-link" href="#insights"><CalendarDays size={18} /> Calendar</a>
        <a className="side-link" href="#insights"><ChartNoAxesColumn size={18} /> Analytics</a>
        <a className="side-link" href="#insights"><FileText size={18} /> Reports</a>
        <div className="side-label side-label-spaced">PREFERENCES</div>
        <a className="side-link" href="#insights"><Users size={18} /> Team</a>
        <a className="side-link" href="#insights"><Settings size={18} /> Settings</a>
        <div className="sidebar-promo">
          <span className="promo-icon"><Sparkles size={20} /></span>
          <strong>Make work flow</strong>
          <p>Keep every task, teammate and dependency in sync.</p>
          <a href="#board">Explore workspace <ArrowRight size={14} /></a>
        </div>
        <div className="sidebar-bottom">
          <div className="profile-avatar">TF</div>
          <div><strong>TaskFlow workspace</strong><small>Project operations</small></div>
          <MoreHorizontal size={18} />
        </div>
      </aside>

      <main className="main-area" id="top">
        <header className="topbar">
          <div className="page-heading"><span className="mobile-brand">TaskFlow</span><div className="breadcrumb">Workspace <span>/</span> <strong>Overview</strong></div></div>
          <div className="topbar-actions">
            <label className="global-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..." /></label>
            <button className="icon-top-button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <button className="icon-top-button" aria-label="Messages"><MessageSquare size={18} /></button>
            <button className="icon-top-button" aria-label="Settings"><Settings size={18} /></button>
            <div className="top-profile"><span className="profile-avatar">TF</span><span className="profile-chevron">⌄</span></div>
          </div>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div><div className="eyebrow">THURSDAY, NOVEMBER 12, 2026 · WORKSPACE</div><h1>Good afternoon <span>👋</span></h1><p>Here's what's happening with your tasks today.</p></div>
            <button className="button button-primary add-task-top" onClick={() => setShowCreateTask((value) => !value)}><Plus size={17} /> Add task</button>
          </section>

          {(errorMsg || notice) && <div className={`alert ${errorMsg ? "alert-error" : "alert-success"}`}>
            {errorMsg ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
            <span>{errorMsg || notice}</span>
            <button onClick={() => { setErrorMsg(""); setNotice(""); }} aria-label="Dismiss notification"><X size={16} /></button>
          </div>}

          <section className="overview-grid" aria-label="Task overview">
            <StatCard label="Total tasks" value={counts.total} icon={<CalendarDays size={21} />} accent="blue" detail="Across this workspace" />
            <StatCard label="In progress" value={counts.IN_PROGRESS} icon={<Activity size={21} />} accent="green" detail="Currently underway" />
            <StatCard label="Completed" value={counts.DONE} icon={<CheckCircle2 size={21} />} accent="purple" detail="Successfully finished" />
            <article className="completion-card">
              <div><strong>Task completion</strong><small>Overall progress</small></div>
              <div className="completion-content"><div className="donut" style={{ "--progress": `${completion}%` }}><span>{completion}%</span></div><div className="legend"><span><i className="legend-done" />Completed <b>{completion}%</b></span><span><i className="legend-progress" />In progress <b>{counts.total ? Math.round(counts.IN_PROGRESS / counts.total * 100) : 0}%</b></span><span><i className="legend-todo" />To do <b>{counts.total ? Math.round(counts.TODO / counts.total * 100) : 0}%</b></span></div></div>
            </article>
          </section>

          {showCreateTask && <section className="panel create-panel" id="create-task">
            <div className="panel-heading"><div><div className="eyebrow">GET THINGS MOVING</div><h2>Create a task</h2><p>Add work to your board and assign ownership.</p></div><button className="icon-button" onClick={() => setShowCreateTask(false)} aria-label="Close form"><X size={18} /></button></div>
            <form onSubmit={handleCreateTask} className="task-form">
              <label className="field field-title"><span>Task title <b>*</b></span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Build authentication API" maxLength={150} required /></label>
              <label className="field"><span>Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
              <label className="field"><span>Assignee</span><div className="input-with-action"><input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Teammate name" /><button type="button" onClick={handleSuggestAssignee} disabled={suggesting} title="Suggest a teammate">{suggesting ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}</button></div></label>
              <label className="field"><span>Blocked by</span><select value={blockedById} onChange={(e) => setBlockedById(e.target.value)}><option value="">No dependency</option>{tasks.map((task) => <option key={task.id} value={task.id}>#{task.id} · {task.title}</option>)}</select></label>
              <label className="field field-description"><span>Description <small>Optional</small></span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add a little more context…" /></label>
              <div className="form-submit"><button className="button button-primary" type="submit" disabled={creating || !title.trim()}>{creating ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} {creating ? "Adding task…" : "Add task"}</button></div>
            </form>
          </section>}

          <div className="dashboard-layout">
            <section className="board-panel" id="board">
              <div className="board-toolbar"><div><div className="eyebrow">PLAN · TRACK · DELIVER</div><h2>My tasks <span className="total-pill">{visibleTasks.length}</span></h2></div>
                <div className="board-filters"><label className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" /></label><label className="filter-select"><Filter size={14} /><select aria-label="Filter by priority" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}><option value="ALL">All priorities</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label></div>
              </div>
              {loading ? <div className="loading-state"><Loader2 className="spin" size={22} /> Loading your tasks…</div> : (
                <div className="kanban-grid">
                  {columns.map((column) => {
                    const Icon = column.icon;
                    const columnTasks = visibleTasks.filter((task) => task.status === column.key);
                    return <section className={`kanban-column ${column.tone}`} key={column.key}>
                      <div className="column-heading"><div className="column-title"><span className="column-icon"><Icon size={16} /></span><h3>{column.label}</h3><span className="column-count">{columnTasks.length}</span></div></div>
                      <div className="task-list">
                        {columnTasks.length === 0 ? <div className="empty-column"><span><Plus size={17} /></span><p>{search || filterPriority !== "ALL" ? "No matching tasks" : "No tasks here yet"}</p></div> : columnTasks.map((task) => (
                          <article className="task-card" key={task.id}>
                            <div className="task-card-top"><span className="task-id">TASK-{String(task.id).padStart(3, "0")}</span><span className={`priority-tag ${priorityTone[task.priority] || "priority-low"}`}>{task.priority || "LOW"}</span></div>
                            <h4>{task.title}</h4>
                            {task.description && <p className="task-description">{task.description}</p>}
                            {task.blocked_by_id && <div className="dependency-tag"><AlertCircle size={13} /> Depends on #{task.blocked_by_id}</div>}
                            <div className="task-card-footer"><div className="assignee"><span className="assignee-avatar">{(task.assignee || "?").slice(0, 1).toUpperCase()}</span><span>{task.assignee || "Unassigned"}</span></div><div className="task-actions">
                              {column.key === "TODO" && <button className="text-action action-blue" onClick={() => handleStatusChange(task.id, "IN_PROGRESS")} disabled={busyTask === task.id}>{busyTask === task.id ? <Loader2 size={14} className="spin" /> : <>Start <ArrowRight size={14} /></>}</button>}
                              {column.key === "IN_PROGRESS" && <button className="text-action action-green" onClick={() => handleStatusChange(task.id, "DONE")} disabled={busyTask === task.id}>{busyTask === task.id ? <Loader2 size={14} className="spin" /> : <>Complete <Check size={14} /></>}</button>}
                              <button className="icon-button delete-button" onClick={() => handleDeleteTask(task.id)} disabled={busyTask === task.id} aria-label={`Delete task ${task.id}`} title="Delete task"><Trash2 size={15} /></button>
                            </div></div>
                          </article>
                        ))}
                      </div>
                    </section>;
                  })}
                </div>
              )}
            </section>

            <aside className="right-rail" id="insights">
              <section className="rail-card">
                <div className="rail-heading"><div><h3>Recent tasks</h3><p>Latest activity in your workspace</p></div><button className="icon-button" onClick={() => { setRefreshing(true); fetchTasks(true); }} disabled={refreshing} aria-label="Refresh tasks"><RefreshCw size={16} className={refreshing ? "spin" : ""} /></button></div>
                {recentTasks.length ? <div className="recent-list">{recentTasks.map((task) => <div className="recent-item" key={task.id}><span className={`recent-status status-${task.status.toLowerCase()}`} /> <div><strong>{task.title}</strong><small>{task.assignee || "Unassigned"} · #{task.id}</small></div><span className={`mini-priority ${priorityTone[task.priority] || "priority-low"}`}>{(task.priority || "LOW").toLowerCase()}</span></div>)}</div> : <p className="rail-empty">Your latest tasks will appear here.</p>}
              </section>
              <section className="rail-card priority-overview">
                <div className="rail-heading"><div><h3>Priority overview</h3><p>Distribution across all tasks</p></div><ChartNoAxesColumn size={18} /></div>
                <div className="priority-stats"><div className="priority-box high-box"><small>High</small><strong>{highPriority}</strong></div><div className="priority-box medium-box"><small>Medium</small><strong>{mediumPriority}</strong></div><div className="priority-box low-box"><small>Low</small><strong>{lowPriority}</strong></div></div>
                <div className="priority-bar"><span style={{ width: `${counts.total ? highPriority / counts.total * 100 : 0}%` }} /><span style={{ width: `${counts.total ? mediumPriority / counts.total * 100 : 0}%` }} /><span style={{ width: `${counts.total ? lowPriority / counts.total * 100 : 0}%` }} /></div>
                <small className="rail-footnote">Total: {counts.total} tasks</small>
              </section>
              <section className="rail-card export-card">
                <div className="export-icon"><Download size={18} /></div><div><h3>Workspace report</h3><p>Export your tasks and dependencies as a CSV file.</p></div>
                {exportStatus === "SUCCESS" && downloadFile ? <a className="button button-success" href={`${API_URL}/exports/${encodeURIComponent(downloadFile)}`}><Check size={15} /> Download CSV</a> : <button className="button button-primary" onClick={handleTriggerExport} disabled={exportStatus === "PENDING"}>{exportStatus === "PENDING" ? <Loader2 size={15} className="spin" /> : <Download size={15} />}{exportStatus === "PENDING" ? "Generating…" : "Export report"}</button>}
              </section>
            </aside>
          </div>
          <footer className="footer"><span>TaskFlow · Keep work moving.</span><span><Users size={14} /> Built for collaborative teams</span></footer>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, icon, accent, detail }) {
  return <article className="stat-card"><div className={`stat-icon ${accent}`}>{icon}</div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

const state = {
  token: localStorage.getItem("ttm_token"),
  user: JSON.parse(localStorage.getItem("ttm_user") || "null"),
  view: "dashboard",
  authMode: "login",
  taskFilter: "All",
  projectFormOpen: true,
  taskFormOpen: true,
  projects: [],
  tasks: [],
  users: [],
  dashboard: null
};

const app = document.querySelector("#app");

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed");
  return data;
};

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const isAdmin = () => state.user?.role === "Admin";
const today = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const isOverdue = (task) => task.status !== "Done" && task.due_date < today();

function setSession(user, token) {
  state.user = user;
  state.token = token;
  localStorage.setItem("ttm_user", JSON.stringify(user));
  localStorage.setItem("ttm_token", token);
}

function logout() {
  localStorage.removeItem("ttm_user");
  localStorage.removeItem("ttm_token");
  state.user = null;
  state.token = null;
  render();
}

function renderAuth() {
  app.innerHTML = `
    <section class="auth-shell">
      <div class="auth-visual">
        <div class="brand">Team Task Manager</div>
        <h1>Plan work, assign clearly, and keep every project moving.</h1>
      </div>
      <div class="auth-panel">
        <div class="auth-card">
          <div class="auth-tabs">
            <button class="${state.authMode === "login" ? "active" : ""}" data-auth-tab="login">Login</button>
            <button class="${state.authMode === "signup" ? "active" : ""}" data-auth-tab="signup">Signup</button>
          </div>
          <form id="authForm">
            ${state.authMode === "signup" ? `
              <label>Name<input name="name" autocomplete="name" required minlength="2" /></label>
            ` : ""}
            <label>Email<input name="email" type="email" autocomplete="email" required /></label>
            <label>Password<input name="password" type="password" autocomplete="${state.authMode === "login" ? "current-password" : "new-password"}" required minlength="6" /></label>
            <button class="btn" type="submit">${state.authMode === "login" ? "Login" : "Create account"}</button>
            <div class="error" id="authError"></div>
          </form>
        </div>
      </div>
    </section>
  `;

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authTab;
      renderAuth();
    });
  });

  document.querySelector("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const error = document.querySelector("#authError");
    error.textContent = "";
    try {
      const data = await api(`/api/auth/${state.authMode}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setSession(data.user, data.token);
      await loadData();
      render();
    } catch (err) {
      error.textContent = err.message;
    }
  });
}

async function loadData() {
  if (!state.token) return;
  const requests = [
    api("/api/projects"),
    api("/api/tasks"),
    api("/api/dashboard")
  ];
  if (isAdmin()) requests.splice(2, 0, api("/api/users"));
  const results = await Promise.all(requests);
  const [projects, tasks, third, fourth] = results;
  const users = isAdmin() ? third : { users: [] };
  const dashboard = isAdmin() ? fourth : third;
  state.projects = projects.projects;
  state.tasks = tasks.tasks;
  state.users = users.users;
  state.dashboard = dashboard;
}

function shell(content) {
  app.innerHTML = `
    <section class="app-shell">
      <aside class="sidebar">
        <div class="brand">Team Task Manager</div>
        <div class="user-chip">
          <strong>${escapeHtml(state.user.name)}</strong>
          <span class="muted">${escapeHtml(state.user.email)}</span>
          <span class="role">${state.user.role}</span>
        </div>
        <nav class="nav">
          ${["dashboard", "projects", "tasks", ...(isAdmin() ? ["team"] : [])].map((view) => `
            <button class="${state.view === view ? "active" : ""}" data-view="${view}">${view[0].toUpperCase()}${view.slice(1)}</button>
          `).join("")}
        </nav>
        <button class="btn secondary" id="logoutBtn">Logout</button>
      </aside>
      <section class="content">${content}</section>
    </section>
  `;

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      render();
    });
  });
  document.querySelector("#logoutBtn").addEventListener("click", logout);
}

function dashboardView() {
  const summary = state.dashboard?.summary || {};
  const overdueTasks = state.tasks.filter(isOverdue);
  const stats = [
    ["Total", summary.total || 0],
    ["Todo", summary.todo || 0],
    ["In Progress", summary.inProgress || 0],
    ["Done", summary.done || 0],
    ["Overdue", summary.overdue || 0]
  ];
  shell(`
    <div class="topbar">
      <h1>Dashboard</h1>
      <button class="btn secondary" id="refreshDashboard">Refresh</button>
    </div>
    <div class="grid stats">
      ${stats.map(([label, value]) => `<div class="stat"><span class="muted">${label}</span><strong>${value}</strong></div>`).join("")}
    </div>
    <div class="workspace">
      <div class="panel">
        <h3>Task status</h3>
        <div class="list">
          ${statusSummaryCards()}
        </div>
        <h3 class="section-title">Project progress</h3>
        <div class="list">
          ${state.projects.map(projectProgressCard).join("") || `<div class="empty">Create a project to start tracking progress</div>`}
        </div>
      </div>
      <div class="panel">
        <h3>Overdue tasks</h3>
        <div class="list">
          ${overdueTasks.map(taskCard).join("") || `<div class="empty">No overdue tasks</div>`}
        </div>
        <h3 class="section-title">Upcoming work</h3>
        <div class="list">
          ${(state.dashboard?.upcoming || []).map(taskCard).join("") || `<div class="empty">No tasks yet</div>`}
        </div>
      </div>
    </div>
  `);
  document.querySelector("#refreshDashboard").addEventListener("click", async () => {
    await loadData();
    render();
  });
  bindTaskStatusEvents(() => render());
}

function statusSummaryCards() {
  return ["Todo", "In Progress", "Done"].map((status) => {
    const tasks = state.tasks.filter((task) => task.status === status);
    const percent = state.tasks.length ? Math.round((tasks.length / state.tasks.length) * 100) : 0;
    return `
      <div class="card">
        <div class="card-head"><strong>${status}</strong><span class="pill">${tasks.length}</span></div>
        <div class="progress"><span style="width: ${percent}%"></span></div>
      </div>
    `;
  }).join("");
}

function projectProgressCard(project) {
  const progress = project.task_count ? Math.round((project.done_count / project.task_count) * 100) : 0;
  return `
    <div class="card">
      <div class="card-head">
        <strong>${escapeHtml(project.name)}</strong>
        <span class="pill">${progress}% done</span>
      </div>
      <div class="progress"><span style="width: ${progress}%"></span></div>
      <div class="meta"><span>${project.done_count} done</span><span>${project.task_count} total</span></div>
    </div>
  `;
}

function projectsView() {
  shell(`
    <div class="topbar">
      <h1>Projects</h1>
      ${isAdmin() ? `<button class="btn" id="toggleProjectForm">+ New Project</button>` : ""}
    </div>
    <div class="workspace">
      ${isAdmin()
        ? (state.projectFormOpen ? projectForm() : creationHint("Project creation", "Click New Project to open the project creation form."))
        : memberNotice("Project creation is Admin-only. Login with an Admin account to create projects.")}
      <div class="panel">
        <h3>Project list</h3>
        <div class="list">
          ${state.projects.map(projectCard).join("") || `<div class="empty">No projects yet</div>`}
        </div>
      </div>
    </div>
  `);
  document.querySelector("#toggleProjectForm")?.addEventListener("click", () => {
    state.projectFormOpen = !state.projectFormOpen;
    projectsView();
  });
  bindProjectEvents();
}

function creationHint(title, text) {
  return `<div class="panel"><h3>${title}</h3><p class="muted">${text}</p></div>`;
}

function memberNotice(text) {
  return `<div class="panel"><h3>Member access</h3><p class="muted">${text}</p></div>`;
}

function projectForm() {
  return `
    <div class="panel">
      <h3>New project</h3>
      <form id="projectForm">
        <label>Name<input name="name" required minlength="2" /></label>
        <label>Description<textarea name="description"></textarea></label>
        <button class="btn" type="submit">Create project</button>
        <div class="error" id="projectError"></div>
      </form>
    </div>
  `;
}

function projectCard(project) {
  const progress = project.task_count ? Math.round((project.done_count / project.task_count) * 100) : 0;
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h3>${escapeHtml(project.name)}</h3>
          <p class="muted">${escapeHtml(project.description || "No description")}</p>
        </div>
        <span class="pill">${progress}%</span>
      </div>
      <div class="meta">
        <span>${project.member_count} members</span>
        <span>${project.task_count} tasks</span>
        <span>Owner: ${escapeHtml(project.owner_name || "Admin")}</span>
      </div>
      <div class="member-list">
        ${(project.members || []).map((member) => `
          <span class="member">${escapeHtml(member.name)}
            ${isAdmin() && member.id !== state.user.id ? `<button class="btn icon danger" title="Remove member" data-remove-member="${project.id}:${member.id}">x</button>` : ""}
          </span>
        `).join("")}
      </div>
      ${isAdmin() ? `
        <form class="row" data-member-form="${project.id}">
          <select name="userId" required>
            <option value="">Add member</option>
            ${state.users
              .filter((user) => !(project.members || []).some((member) => member.id === user.id))
              .map((user) => `<option value="${user.id}">${escapeHtml(user.name)} (${user.role})</option>`)
              .join("")}
          </select>
          <button class="btn secondary" type="submit">Add</button>
        </form>
      ` : ""}
    </article>
  `;
}

function tasksView() {
  shell(`
    <div class="topbar">
      <h1>Tasks</h1>
      <div class="row">
        ${isAdmin() ? `<button class="btn" id="toggleTaskForm">+ New Task</button>` : ""}
        <select id="taskProjectFilter">
          <option value="All">All projects</option>
          ${state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="workspace">
      ${isAdmin()
        ? (state.taskFormOpen ? taskForm() : creationHint("Task creation", "Click New Task to open the task creation and assignment form."))
        : memberNotice("Task creation is Admin-only. Members can update the status of tasks assigned to them.")}
      <div class="panel">
        <div class="tabs">
          ${["All", "Todo", "In Progress", "Done", "Overdue"].map((status) => `<button class="${state.taskFilter === status ? "active" : ""}" data-filter="${status}">${status}</button>`).join("")}
        </div>
        <div class="board" id="taskBoard"></div>
      </div>
    </div>
  `);
  document.querySelector("#toggleTaskForm")?.addEventListener("click", () => {
    state.taskFormOpen = !state.taskFormOpen;
    tasksView();
  });
  renderTaskBoard();
  bindTaskEvents();
}

function taskForm() {
  return `
    <div class="panel">
      <h3>New task</h3>
      <form id="taskForm">
        <label>Title<input name="title" required minlength="2" /></label>
        <label>Description<textarea name="description"></textarea></label>
        <label>Project<select name="projectId" id="taskProjectSelect" required>${projectOptions()}</select></label>
        <label>Assign to<select name="assignedTo" id="taskAssigneeSelect"><option value="">Unassigned</option>${userOptions()}</select></label>
        <div class="split-fields">
          <label>Status<select name="status">${["Todo", "In Progress", "Done"].map(option).join("")}</select></label>
          <label>Priority<select name="priority">${["Low", "Medium", "High"].map(option).join("")}</select></label>
        </div>
        <label>Due date<input name="dueDate" type="date" required value="${today()}" /></label>
        <button class="btn" type="submit">Create task</button>
        <div class="error" id="taskError"></div>
      </form>
    </div>
  `;
}

function option(value) {
  return `<option value="${value}">${value}</option>`;
}

function projectOptions() {
  return `<option value="">Select project</option>${state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("")}`;
}

function userOptions() {
  return state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)} (${user.role})</option>`).join("");
}

function projectMemberOptions(projectId) {
  const project = state.projects.find((item) => item.id === Number(projectId));
  const projectMembers = project ? project.members || [] : [];
  const merged = [...projectMembers];
  state.users.forEach((user) => {
    if (!merged.some((member) => member.id === user.id)) merged.push(user);
  });
  const users = project ? merged : state.users;
  return users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)} (${user.role})</option>`).join("");
}

function taskCard(task) {
  const overdue = isOverdue(task);
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <p class="muted">${escapeHtml(task.description || "No description")}</p>
        </div>
        <span class="pill ${task.status === "Done" ? "done" : ""}">${task.status}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(task.project_name || "Project")}</span>
        <span>${escapeHtml(task.assignee_name || "Unassigned")}</span>
        <span class="pill ${String(task.priority).toLowerCase()}">${task.priority}</span>
        <span class="pill ${overdue ? "overdue" : ""}">${overdue ? "Overdue" : "Due"} ${task.due_date}</span>
        <span>Updated ${escapeHtml(task.updated_at || task.created_at || "")}</span>
      </div>
      <div class="row">
        <select data-status="${task.id}" ${!isAdmin() && task.assigned_to !== state.user.id ? "disabled" : ""}>
          ${["Todo", "In Progress", "Done"].map((status) => `<option value="${status}" ${task.status === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        ${isAdmin() ? `<button class="btn icon danger" title="Delete task" data-delete-task="${task.id}">x</button>` : ""}
      </div>
    </article>
  `;
}

function visibleTasks() {
  const projectFilter = document.querySelector("#taskProjectFilter")?.value || "All";
  return state.tasks.filter((task) => {
    const matchesProject = projectFilter === "All" || String(task.project_id) === projectFilter;
    const matchesStatus = state.taskFilter === "All"
      || (state.taskFilter === "Overdue" ? isOverdue(task) : task.status === state.taskFilter);
    return matchesProject && matchesStatus;
  });
}

function renderTaskBoard() {
  const board = document.querySelector("#taskBoard");
  const tasks = visibleTasks();
  const statuses = state.taskFilter === "Overdue" ? ["Overdue"] : ["Todo", "In Progress", "Done"];
  board.innerHTML = statuses.map((status) => {
    const columnTasks = status === "Overdue" ? tasks.filter(isOverdue) : tasks.filter((task) => task.status === status);
    return `
      <section class="board-column">
        <div class="column-head">
          <h3>${status}</h3>
          <span class="pill">${columnTasks.length}</span>
        </div>
        <div class="list">
          ${columnTasks.map(taskCard).join("") || `<div class="empty">No tasks</div>`}
        </div>
      </section>
    `;
  }).join("");

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.taskFilter);
    button.onclick = () => {
      state.taskFilter = button.dataset.filter;
      renderTaskBoard();
    };
  });
  document.querySelector("#taskProjectFilter")?.addEventListener("change", renderTaskBoard);
  bindTaskStatusEvents(renderTaskBoard);
}

function bindTaskStatusEvents(afterUpdate) {
  document.querySelectorAll("[data-status]").forEach((select) => {
    select.onchange = async () => {
      await api(`/api/tasks/${select.dataset.status}`, {
        method: "PATCH",
        body: JSON.stringify({ status: select.value })
      });
      await loadData();
      afterUpdate();
    };
  });
  document.querySelectorAll("[data-delete-task]").forEach((button) => {
    button.onclick = async () => {
      await api(`/api/tasks/${button.dataset.deleteTask}`, { method: "DELETE" });
      await loadData();
      render();
    };
  });
}

function bindProjectEvents() {
  const projectFormEl = document.querySelector("#projectForm");
  if (projectFormEl) {
    projectFormEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(projectFormEl).entries());
      try {
        await api("/api/projects", { method: "POST", body: JSON.stringify(payload) });
        await loadData();
        render();
      } catch (err) {
        document.querySelector("#projectError").textContent = err.message;
      }
    });
  }

  document.querySelectorAll("[data-member-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const userId = Number(new FormData(form).get("userId"));
      if (!userId) return;
      await api(`/api/projects/${form.dataset.memberForm}/members`, {
        method: "POST",
        body: JSON.stringify({ userId })
      });
      await loadData();
      render();
    });
  });

  document.querySelectorAll("[data-remove-member]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [projectId, userId] = button.dataset.removeMember.split(":");
      await api(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" });
      await loadData();
      render();
    });
  });
}

function bindTaskEvents() {
  const taskFormEl = document.querySelector("#taskForm");
  if (!taskFormEl) return;
  const projectSelect = document.querySelector("#taskProjectSelect");
  const assigneeSelect = document.querySelector("#taskAssigneeSelect");
  projectSelect.addEventListener("change", () => {
    assigneeSelect.innerHTML = `<option value="">Unassigned</option>${projectMemberOptions(projectSelect.value)}`;
  });

  taskFormEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(taskFormEl);
    const payload = Object.fromEntries(form.entries());
    payload.projectId = Number(payload.projectId);
    payload.assignedTo = payload.assignedTo ? Number(payload.assignedTo) : null;
    try {
      await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
      await loadData();
      render();
    } catch (err) {
      document.querySelector("#taskError").textContent = err.message;
    }
  });
}

function render() {
  if (!state.token || !state.user) return renderAuth();
  if (state.view === "projects") return projectsView();
  if (state.view === "tasks") return tasksView();
  if (state.view === "team" && isAdmin()) return teamView();
  return dashboardView();
}

function teamView() {
  shell(`
    <div class="topbar"><h1>Team</h1></div>
    <div class="panel">
      <h3>Users and roles</h3>
      <div class="list">
        ${state.users.map((user) => `
          <article class="card">
            <div class="card-head">
              <div>
                <h3>${escapeHtml(user.name)}</h3>
                <p class="muted">${escapeHtml(user.email)}</p>
              </div>
              <select data-role-user="${user.id}" ${user.id === state.user.id ? "disabled" : ""}>
                ${["Admin", "Member"].map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${role}</option>`).join("")}
              </select>
            </div>
          </article>
        `).join("") || `<div class="empty">No users yet</div>`}
      </div>
    </div>
  `);

  document.querySelectorAll("[data-role-user]").forEach((select) => {
    select.addEventListener("change", async () => {
      await api(`/api/users/${select.dataset.roleUser}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: select.value })
      });
      await loadData();
      teamView();
    });
  });
}

(async function boot() {
  if (state.token) {
    try {
      const me = await api("/api/me");
      state.user = me.user;
      localStorage.setItem("ttm_user", JSON.stringify(me.user));
      await loadData();
    } catch {
      logout();
      return;
    }
  }
  render();
})();

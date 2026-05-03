const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();
const { z } = require("zod");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "team-task-manager.sqlite");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

async function initDb() {
  await run("PRAGMA foreign_keys = ON");
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Admin', 'Member')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY(project_id, user_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Todo' CHECK(status IN ('Todo', 'In Progress', 'Done')),
      priority TEXT NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low', 'Medium', 'High')),
      due_date TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      assigned_to INTEGER,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(assigned_to) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  password: z.string().min(6).max(100)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const projectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional().default("")
});

const memberSchema = z.object({
  userId: z.number().int().positive()
});

const roleSchema = z.object({
  role: z.enum(["Admin", "Member"])
});

const taskSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(800).optional().default(""),
  status: z.enum(["Todo", "In Progress", "Done"]).optional().default("Todo"),
  priority: z.enum(["Low", "Medium", "High"]).optional().default("Medium"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD"),
  projectId: z.number().int().positive(),
  assignedTo: z.number().int().positive().nullable().optional()
});

const taskPatchSchema = taskSchema.partial().extend({
  assignedTo: z.number().int().positive().nullable().optional()
});

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "8h" });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Authentication required" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await get("SELECT id, name, email, role FROM users WHERE id = ?", [payload.id]);
    if (!user) return res.status(401).json({ message: "Invalid session" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "Admin") return res.status(403).json({ message: "Admin access required" });
  next();
}

async function canAccessProject(user, projectId) {
  if (user.role === "Admin") return true;
  const membership = await get(
    "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
    [projectId, user.id]
  );
  return Boolean(membership);
}

async function ensureAssigneeIsProjectMember(projectId, userId) {
  if (!userId) return;
  const membership = await get(
    "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
    [projectId, userId]
  );
  if (!membership) {
    const error = new Error("Assignee must be a member of the selected project");
    error.status = 400;
    throw error;
  }
}

async function addProjectMember(projectId, userId) {
  if (!userId) return;
  await run("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)", [projectId, userId]);
}

app.post("/api/auth/signup", asyncHandler(async (req, res) => {
  const input = signupSchema.parse(req.body);
  const existing = await get("SELECT id FROM users WHERE email = ?", [input.email.toLowerCase()]);
  if (existing) return res.status(409).json({ message: "Email already registered" });

  const userCount = await get("SELECT COUNT(*) AS count FROM users");
  const role = userCount.count === 0 ? "Admin" : "Member";
  const passwordHash = await bcrypt.hash(input.password, 10);
  const created = await run(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
    [input.name, input.email.toLowerCase(), passwordHash, role]
  );
  const user = await get("SELECT id, name, email, role FROM users WHERE id = ?", [created.id]);
  res.status(201).json({ user: publicUser(user), token: signToken(user) });
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await get("SELECT * FROM users WHERE email = ?", [input.email.toLowerCase()]);
  if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
    return res.status(401).json({ message: "Invalid email or password" });
  }
  res.json({ user: publicUser(user), token: signToken(user) });
}));

app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/users", auth, requireAdmin, asyncHandler(async (req, res) => {
  const users = await all("SELECT id, name, email, role FROM users ORDER BY name");
  res.json({ users });
}));

app.patch("/api/users/:id/role", auth, requireAdmin, asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  const input = roleSchema.parse(req.body);
  const user = await get("SELECT id, role FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ message: "User not found" });

  if (user.id === req.user.id && input.role !== "Admin") {
    return res.status(400).json({ message: "You cannot remove your own Admin role" });
  }

  await run("UPDATE users SET role = ? WHERE id = ?", [input.role, userId]);
  const updated = await get("SELECT id, name, email, role FROM users WHERE id = ?", [userId]);
  res.json({ user: updated });
}));


app.get("/api/projects", auth, asyncHandler(async (req, res) => {
  const where = req.user.role === "Admin"
    ? ""
    : "WHERE p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)";
  const params = req.user.role === "Admin" ? [] : [req.user.id];
  const projects = await all(`
    SELECT p.*, u.name AS owner_name,
      COUNT(DISTINCT pm.user_id) AS member_count,
      COUNT(DISTINCT t.id) AS task_count,
      COALESCE(SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END), 0) AS done_count
    FROM projects p
    JOIN users u ON u.id = p.created_by
    LEFT JOIN project_members pm ON pm.project_id = p.id
    LEFT JOIN tasks t ON t.project_id = p.id
    ${where}
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `, params);

  const projectIds = projects.map((project) => project.id);
  const members = projectIds.length
    ? await all(`
        SELECT pm.project_id, u.id, u.name, u.email, u.role
        FROM project_members pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id IN (${projectIds.map(() => "?").join(",")})
        ORDER BY u.name
      `, projectIds)
    : [];

  res.json({
    projects: projects.map((project) => ({
      ...project,
      members: members.filter((member) => member.project_id === project.id)
    }))
  });
}));

app.post("/api/projects", auth, requireAdmin, asyncHandler(async (req, res) => {
  const input = projectSchema.parse(req.body);
  const created = await run(
    "INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)",
    [input.name, input.description, req.user.id]
  );
  await run("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)", [created.id, req.user.id]);
  const project = await get("SELECT * FROM projects WHERE id = ?", [created.id]);
  res.status(201).json({ project });
}));

app.post("/api/projects/:id/members", auth, requireAdmin, asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id);
  const input = memberSchema.parse(req.body);
  const project = await get("SELECT id FROM projects WHERE id = ?", [projectId]);
  const user = await get("SELECT id FROM users WHERE id = ?", [input.userId]);
  if (!project || !user) return res.status(404).json({ message: "Project or user not found" });
  await run("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)", [projectId, input.userId]);
  res.status(201).json({ message: "Member added" });
}));

app.delete("/api/projects/:id/members/:userId", auth, requireAdmin, asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id);
  const userId = Number(req.params.userId);
  await run("UPDATE tasks SET assigned_to = NULL WHERE project_id = ? AND assigned_to = ?", [projectId, userId]);
  await run("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", [projectId, userId]);
  res.json({ message: "Member removed" });
}));

app.get("/api/tasks", auth, asyncHandler(async (req, res) => {
  const projectFilter = req.query.projectId ? Number(req.query.projectId) : null;
  const params = [];
  const clauses = [];

  if (req.user.role !== "Admin") {
    clauses.push("(t.assigned_to = ? OR t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))");
    params.push(req.user.id, req.user.id);
  }
  if (projectFilter) {
    clauses.push("t.project_id = ?");
    params.push(projectFilter);
  }

  const tasks = await all(`
    SELECT t.*, p.name AS project_name, assignee.name AS assignee_name, creator.name AS creator_name
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    JOIN users creator ON creator.id = t.created_by
    LEFT JOIN users assignee ON assignee.id = t.assigned_to
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY
      CASE t.status WHEN 'Todo' THEN 1 WHEN 'In Progress' THEN 2 ELSE 3 END,
      t.due_date ASC
  `, params);
  res.json({ tasks });
}));

app.post("/api/tasks", auth, requireAdmin, asyncHandler(async (req, res) => {
  const input = taskSchema.parse(req.body);
  const project = await get("SELECT id FROM projects WHERE id = ?", [input.projectId]);
  if (!project) return res.status(404).json({ message: "Project not found" });
  await addProjectMember(input.projectId, input.assignedTo);

  const created = await run(`
    INSERT INTO tasks (title, description, status, priority, due_date, project_id, assigned_to, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.title,
    input.description,
    input.status,
    input.priority,
    input.dueDate,
    input.projectId,
    input.assignedTo || null,
    req.user.id
  ]);
  const task = await get("SELECT * FROM tasks WHERE id = ?", [created.id]);
  res.status(201).json({ task });
}));

app.patch("/api/tasks/:id", auth, asyncHandler(async (req, res) => {
  const taskId = Number(req.params.id);
  const task = await get("SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!task) return res.status(404).json({ message: "Task not found" });

  const memberCanUpdate = req.user.role === "Member" && task.assigned_to === req.user.id;
  if (req.user.role !== "Admin" && !memberCanUpdate) {
    return res.status(403).json({ message: "You can only update tasks assigned to you" });
  }

  const input = taskPatchSchema.parse(req.body);
  const next = {
    title: req.user.role === "Admin" && input.title !== undefined ? input.title : task.title,
    description: req.user.role === "Admin" && input.description !== undefined ? input.description : task.description,
    status: input.status !== undefined ? input.status : task.status,
    priority: req.user.role === "Admin" && input.priority !== undefined ? input.priority : task.priority,
    dueDate: req.user.role === "Admin" && input.dueDate !== undefined ? input.dueDate : task.due_date,
    projectId: req.user.role === "Admin" && input.projectId !== undefined ? input.projectId : task.project_id,
    assignedTo: req.user.role === "Admin" && Object.prototype.hasOwnProperty.call(input, "assignedTo")
      ? input.assignedTo
      : task.assigned_to
  };

  if (!(await canAccessProject(req.user, next.projectId))) {
    return res.status(403).json({ message: "Project access denied" });
  }
  if (req.user.role === "Admin") await addProjectMember(next.projectId, next.assignedTo);

  await run(`
    UPDATE tasks
    SET title = ?, description = ?, status = ?, priority = ?, due_date = ?,
        project_id = ?, assigned_to = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    next.title,
    next.description,
    next.status,
    next.priority,
    next.dueDate,
    next.projectId,
    next.assignedTo || null,
    taskId
  ]);
  const updated = await get("SELECT * FROM tasks WHERE id = ?", [taskId]);
  res.json({ task: updated });
}));

app.delete("/api/tasks/:id", auth, requireAdmin, asyncHandler(async (req, res) => {
  await run("DELETE FROM tasks WHERE id = ?", [Number(req.params.id)]);
  res.json({ message: "Task deleted" });
}));

app.get("/api/dashboard", auth, asyncHandler(async (req, res) => {
  const params = [];
  const visibility = req.user.role === "Admin"
    ? ""
    : "WHERE t.assigned_to = ? OR t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)";
  if (req.user.role !== "Admin") params.push(req.user.id, req.user.id);

  const summary = await get(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'Todo' THEN 1 ELSE 0 END) AS todo,
      SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status != 'Done' AND date(due_date) < date('now', 'localtime') THEN 1 ELSE 0 END) AS overdue
    FROM tasks t
    ${visibility}
  `, params);

  const upcoming = await all(`
    SELECT t.*, p.name AS project_name, u.name AS assignee_name
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN users u ON u.id = t.assigned_to
    ${visibility}
    ORDER BY date(t.due_date) ASC
    LIMIT 6
  `, params);

  res.json({
    summary: {
      total: summary.total || 0,
      todo: summary.todo || 0,
      inProgress: summary.in_progress || 0,
      done: summary.done || 0,
      overdue: summary.overdue || 0
    },
    upcoming
  });
}));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, req, res, next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ message: error.errors[0]?.message || "Invalid request" });
  }
  res.status(error.status || 500).json({ message: error.message || "Server error" });
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Team Task Manager running on http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});

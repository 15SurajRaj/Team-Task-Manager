# Team Task Manager

A full-stack web app for project teams with authentication, role-based access, projects, task assignment, progress tracking, and dashboard metrics.

## Tech Stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js, Express REST APIs
- Database: SQLite
- Auth: JWT + bcrypt password hashing
- Validation: Zod

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Do not open `public/index.html` directly. The frontend is served by Express and uses REST APIs backed by SQLite, so it must run through `npm start`.

The first user who signs up becomes an `Admin`. Later users become `Member`.

## Dynamic Features

- Admins create projects and add team members.
- Admins use `Projects -> + New Project` to create projects.
- Admins use `Tasks -> + New Task` to create tasks, select a project, assign the task to a project member, set due date, priority, and status.
- When an Admin assigns a task to a user, that user is automatically added to the task's project so they can see it.
- Admins use `Team` to change users between `Admin` and `Member`.
- Members can view tasks assigned to them and tasks in projects where they are team members.
- The dashboard reads live database data for total tasks, Todo, In Progress, Done, overdue tasks, upcoming work, and project progress.
- Task status changes immediately persist to SQLite through `PATCH /api/tasks/:id`.

## Roles

- `Admin`: create projects, manage project team members, create/update/delete tasks, assign tasks, view all users.
- `Member`: view projects they belong to, view assigned/project tasks, update task status.

## REST API Overview

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/me`
- `GET /api/users`
- `PATCH /api/users/:id/role`
- `GET /api/projects`
- `POST /api/projects`
- `POST /api/projects/:id/members`
- `DELETE /api/projects/:id/members/:userId`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `GET /api/dashboard`

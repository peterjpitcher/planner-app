-- Performance indexes for Planner application
-- Run these in your Supabase SQL editor to improve query performance

-- Indexes for projects table
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_due_date ON projects(due_date);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_user_status ON projects(user_id, status);

-- Indexes for tasks table
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_is_completed ON tasks(is_completed);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user_project ON tasks(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_completed ON tasks(project_id, is_completed);

-- Indexes for notes table
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_project_id ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_task_id ON notes(task_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at);
CREATE INDEX IF NOT EXISTS idx_notes_user_project ON notes(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_task ON notes(user_id, task_id);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_projects_user_status_due ON projects(user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_user_completed_due ON tasks(user_id, is_completed, due_date);

-- Note: After creating these indexes, run ANALYZE on each table to update statistics
ANALYZE projects;
ANALYZE tasks;
ANALYZE notes;
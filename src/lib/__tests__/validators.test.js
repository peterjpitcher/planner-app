// Validators test suite
import { describe, it, expect } from 'vitest';
import {
  validateProject,
  validateTask,
  validateNote,
  validateIdea,
} from '../validators.js';

// ---------------------------------------------------------------------------
// validateTask
// ---------------------------------------------------------------------------
describe('validateTask', () => {
  const baseTask = { name: 'My task' };

  it('accepts a task with null project_id (no error)', () => {
    const result = validateTask({ ...baseTask, project_id: null });
    expect(result.isValid).toBe(true);
    expect(result.errors.project_id).toBeUndefined();
  });

  it('accepts a task with no project_id at all', () => {
    const result = validateTask({ name: 'Standalone task' });
    expect(result.isValid).toBe(true);
  });

  it('rejects invalid state value', () => {
    const result = validateTask({ ...baseTask, state: 'invalid_state' });
    expect(result.isValid).toBe(false);
    expect(result.errors.state).toBeDefined();
  });

  it('accepts valid state values', () => {
    const validStates = ['today', 'this_week', 'backlog', 'waiting', 'done'];
    for (const state of validStates) {
      const result = validateTask({ ...baseTask, state });
      expect(result.errors.state).toBeUndefined();
    }
  });

  it('accepts task with no state', () => {
    const result = validateTask({ ...baseTask });
    expect(result.errors.state).toBeUndefined();
  });

  it('accepts valid today_section values', () => {
    const validSections = ['must_do', 'good_to_do', 'quick_wins'];
    for (const today_section of validSections) {
      const result = validateTask({ ...baseTask, today_section });
      expect(result.errors.today_section).toBeUndefined();
    }
  });

  it('rejects invalid today_section value', () => {
    const result = validateTask({ ...baseTask, today_section: 'bad_section' });
    expect(result.isValid).toBe(false);
    expect(result.errors.today_section).toBeDefined();
  });

  it('rejects chips that is not an array', () => {
    const result = validateTask({ ...baseTask, chips: 'urgent' });
    expect(result.isValid).toBe(false);
    expect(result.errors.chips).toBeDefined();
  });

  it('rejects chips with more than 5 items', () => {
    const result = validateTask({
      ...baseTask,
      chips: ['high_impact', 'urgent', 'blocks_others', 'stress_relief', 'only_i_can', 'high_impact'],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.chips).toBeDefined();
  });

  it('rejects chips containing an invalid value', () => {
    const result = validateTask({ ...baseTask, chips: ['urgent', 'not_a_chip'] });
    expect(result.isValid).toBe(false);
    expect(result.errors.chips).toBeDefined();
  });

  it('rejects chips with duplicates', () => {
    const result = validateTask({ ...baseTask, chips: ['urgent', 'urgent'] });
    expect(result.isValid).toBe(false);
    expect(result.errors.chips).toBeDefined();
  });

  it('accepts valid chips array', () => {
    const result = validateTask({ ...baseTask, chips: ['urgent', 'high_impact'] });
    expect(result.errors.chips).toBeUndefined();
  });

  it('accepts empty chips array', () => {
    const result = validateTask({ ...baseTask, chips: [] });
    expect(result.errors.chips).toBeUndefined();
  });

  it('rejects invalid task_type', () => {
    const result = validateTask({ ...baseTask, task_type: 'not_a_type' });
    expect(result.isValid).toBe(false);
    expect(result.errors.task_type).toBeDefined();
  });

  it('accepts valid task_type', () => {
    const validTypes = ['admin', 'reply_chase', 'fix', 'planning', 'content', 'deep_work', 'personal'];
    for (const task_type of validTypes) {
      const result = validateTask({ ...baseTask, task_type });
      expect(result.errors.task_type).toBeUndefined();
    }
  });

  it('rejects area exceeding 100 chars', () => {
    const result = validateTask({ ...baseTask, area: 'a'.repeat(101) });
    expect(result.isValid).toBe(false);
    expect(result.errors.area).toBeDefined();
  });

  it('accepts area within 100 chars', () => {
    const result = validateTask({ ...baseTask, area: 'a'.repeat(100) });
    expect(result.errors.area).toBeUndefined();
  });

  it('rejects waiting_reason exceeding 500 chars', () => {
    const result = validateTask({ ...baseTask, waiting_reason: 'a'.repeat(501) });
    expect(result.isValid).toBe(false);
    expect(result.errors.waiting_reason).toBeDefined();
  });

  it('accepts waiting_reason within 500 chars', () => {
    const result = validateTask({ ...baseTask, waiting_reason: 'a'.repeat(500) });
    expect(result.errors.waiting_reason).toBeUndefined();
  });

  it('requires task name', () => {
    const result = validateTask({ name: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBeDefined();
  });

  it('rejects task name over 255 chars', () => {
    const result = validateTask({ name: 'a'.repeat(256) });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBeDefined();
  });

  it('rejects invalid due_date', () => {
    const result = validateTask({ ...baseTask, due_date: 'not-a-date' });
    expect(result.isValid).toBe(false);
    expect(result.errors.due_date).toBeDefined();
  });

  it('accepts valid due_date', () => {
    const result = validateTask({ ...baseTask, due_date: '2026-06-01' });
    expect(result.errors.due_date).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateProject
// ---------------------------------------------------------------------------
describe('validateProject', () => {
  const baseProject = { name: 'My Project' };

  it('does not error when priority field is absent', () => {
    const result = validateProject({ ...baseProject });
    expect(result.isValid).toBe(true);
    expect(result.errors.priority).toBeUndefined();
  });

  it('does not error when priority has any value (priority removed from schema)', () => {
    const result = validateProject({ ...baseProject, priority: 'High' });
    expect(result.errors.priority).toBeUndefined();
  });

  it('requires project name', () => {
    const result = validateProject({ name: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBeDefined();
  });

  it('rejects project name over 255 chars', () => {
    const result = validateProject({ name: 'a'.repeat(256) });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBeDefined();
  });

  it('validates project status', () => {
    const result = validateProject({ ...baseProject, status: 'BadStatus' });
    expect(result.isValid).toBe(false);
    expect(result.errors.status).toBeDefined();
  });

  it('accepts valid project status', () => {
    const result = validateProject({ ...baseProject, status: 'Open' });
    expect(result.isValid).toBe(true);
  });

  it('rejects too many stakeholders', () => {
    const result = validateProject({
      ...baseProject,
      stakeholders: Array(11).fill('Alice'),
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.stakeholders).toBeDefined();
  });

  it('accepts valid stakeholders', () => {
    const result = validateProject({ ...baseProject, stakeholders: ['Alice', 'Bob'] });
    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateNote
// ---------------------------------------------------------------------------
describe('validateNote', () => {
  it('accepts note with idea_id as parent', () => {
    const result = validateNote({ content: 'Great thought', idea_id: 'some-uuid' });
    expect(result.isValid).toBe(true);
    expect(result.errors.parent).toBeUndefined();
  });

  it('accepts note with project_id as parent', () => {
    const result = validateNote({ content: 'Project note', project_id: 'proj-uuid' });
    expect(result.isValid).toBe(true);
  });

  it('accepts note with task_id as parent', () => {
    const result = validateNote({ content: 'Task note', task_id: 'task-uuid' });
    expect(result.isValid).toBe(true);
  });

  it('rejects note with no parent at all', () => {
    const result = validateNote({ content: 'Orphan note' });
    expect(result.isValid).toBe(false);
    expect(result.errors.parent).toBeDefined();
  });

  it('requires note content', () => {
    const result = validateNote({ content: '', project_id: 'proj-uuid' });
    expect(result.isValid).toBe(false);
    expect(result.errors.content).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// validateIdea
// ---------------------------------------------------------------------------
describe('validateIdea', () => {
  it('requires title', () => {
    const result = validateIdea({ title: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.title).toBeDefined();
  });

  it('rejects title over 255 chars', () => {
    const result = validateIdea({ title: 'a'.repeat(256) });
    expect(result.isValid).toBe(false);
    expect(result.errors.title).toBeDefined();
  });

  it('accepts valid title', () => {
    const result = validateIdea({ title: 'My Idea' });
    expect(result.isValid).toBe(true);
  });

  it('rejects invalid idea_state', () => {
    const result = validateIdea({ title: 'My Idea', idea_state: 'not_a_state' });
    expect(result.isValid).toBe(false);
    expect(result.errors.idea_state).toBeDefined();
  });

  it('accepts valid idea_state values', () => {
    const validStates = ['captured', 'exploring', 'ready_later', 'promoted'];
    for (const idea_state of validStates) {
      const result = validateIdea({ title: 'My Idea', idea_state });
      expect(result.errors.idea_state).toBeUndefined();
    }
  });

  it('rejects area over 100 chars', () => {
    const result = validateIdea({ title: 'My Idea', area: 'a'.repeat(101) });
    expect(result.isValid).toBe(false);
    expect(result.errors.area).toBeDefined();
  });

  it('accepts area within 100 chars', () => {
    const result = validateIdea({ title: 'My Idea', area: 'a'.repeat(100) });
    expect(result.errors.area).toBeUndefined();
  });

  it('rejects why_it_matters over 1000 chars', () => {
    const result = validateIdea({ title: 'My Idea', why_it_matters: 'a'.repeat(1001) });
    expect(result.isValid).toBe(false);
    expect(result.errors.why_it_matters).toBeDefined();
  });

  it('accepts why_it_matters within 1000 chars', () => {
    const result = validateIdea({ title: 'My Idea', why_it_matters: 'a'.repeat(1000) });
    expect(result.errors.why_it_matters).toBeUndefined();
  });

  it('rejects smallest_step over 1000 chars', () => {
    const result = validateIdea({ title: 'My Idea', smallest_step: 'a'.repeat(1001) });
    expect(result.isValid).toBe(false);
    expect(result.errors.smallest_step).toBeDefined();
  });

  it('rejects notes field over 1000 chars', () => {
    const result = validateIdea({ title: 'My Idea', notes: 'a'.repeat(1001) });
    expect(result.isValid).toBe(false);
    expect(result.errors.notes).toBeDefined();
  });

  it('accepts a fully valid idea', () => {
    const result = validateIdea({
      title: 'Build something great',
      idea_state: 'exploring',
      area: 'Product',
      why_it_matters: 'It solves a real problem',
      smallest_step: 'Write a one-pager',
      notes: 'Some notes here',
    });
    expect(result.isValid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });
});

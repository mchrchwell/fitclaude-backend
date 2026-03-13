const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// List sessions (optionally by plan_day_id)
router.get('/', async (req, res) => {
  try {
    const { plan_day_id } = req.query;
    let query = 'SELECT id, plan_day_id, started_at, finished_at, notes, perceived_effort, created_at FROM workout_sessions WHERE user_id = $1';
    const params = [req.user.id];
    if (plan_day_id) {
      query += ' AND plan_day_id = $2';
      params.push(plan_day_id);
    }
    query += ' ORDER BY started_at DESC';
    const result = await pool.query(query, params);
    res.json({ sessions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { plan_day_id, started_at, finished_at, notes, perceived_effort, sets } = req.body;
    const result = await pool.query(
      'INSERT INTO workout_sessions (user_id, plan_day_id, started_at, finished_at, notes, perceived_effort) VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), $4::timestamptz, $5, $6) RETURNING id, plan_day_id, started_at, finished_at, notes, perceived_effort, created_at',
      [req.user.id, plan_day_id || null, started_at, finished_at, notes ?? null, perceived_effort ?? null]
    );
    const session = result.rows[0];

    // Insert sets if provided
    if (sets && Array.isArray(sets) && sets.length > 0) {
      for (const set of sets) {
        const { exerciseName, planExerciseId, setNumber, repsCompleted, weightKg, durationSeconds, isCompleted, performanceData } = set;
        if (!exerciseName || setNumber == null) continue;
        await pool.query(
          'INSERT INTO logged_sets (session_id, plan_exercise_id, exercise_name, set_number, reps_completed, weight_kg, duration_seconds, is_completed, performance_data) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, false), COALESCE($9::jsonb, \'{}\'))',
          [session.id, planExerciseId || null, exerciseName, setNumber, repsCompleted ?? null, weightKg ?? null, durationSeconds ?? null, isCompleted ?? false, performanceData ? JSON.stringify(performanceData) : null]
        );
      }
    }

    res.status(201).json({ session });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const sessionResult = await pool.query(
      'SELECT id, plan_day_id, started_at, finished_at, notes, perceived_effort, created_at FROM workout_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = sessionResult.rows[0];
    const setsResult = await pool.query(
      'SELECT id, plan_exercise_id, exercise_name, set_number, reps_completed, weight_kg, duration_seconds, is_completed, performance_data, created_at FROM logged_sets WHERE session_id = $1 ORDER BY set_number',
      [session.id]
    );
    res.json({ session: { ...session, sets: setsResult.rows } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get session' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { finished_at, notes, perceived_effort } = req.body;
    const result = await pool.query(
      'UPDATE workout_sessions SET finished_at = COALESCE($1::timestamptz, finished_at), notes = COALESCE($2, notes), perceived_effort = COALESCE($3, perceived_effort) WHERE id = $4 AND user_id = $5 RETURNING id, plan_day_id, started_at, finished_at, notes, perceived_effort',
      [finished_at, notes, perceived_effort, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ session: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update session' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM workout_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Log a set for a session
router.post('/:id/sets', async (req, res) => {
  try {
    const { plan_exercise_id, exercise_name, set_number, reps_completed, weight_kg, duration_seconds, is_completed, performance_data } = req.body;
    if (!exercise_name || set_number == null) {
      return res.status(400).json({ error: 'exercise_name and set_number required' });
    }
    const sessionCheck = await pool.query('SELECT id FROM workout_sessions WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (sessionCheck.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    const result = await pool.query(
      'INSERT INTO logged_sets (session_id, plan_exercise_id, exercise_name, set_number, reps_completed, weight_kg, duration_seconds, is_completed, performance_data) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, false), COALESCE($9::jsonb, \'{}\')) RETURNING id, session_id, plan_exercise_id, exercise_name, set_number, reps_completed, weight_kg, duration_seconds, is_completed, performance_data, created_at',
      [req.params.id, plan_exercise_id || null, exercise_name, set_number, reps_completed ?? null, weight_kg ?? null, duration_seconds ?? null, is_completed, performance_data ? JSON.stringify(performance_data) : null]
    );
    res.status(201).json({ set: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log set' });
  }
});

module.exports = router;

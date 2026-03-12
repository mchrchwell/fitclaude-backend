const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// List plans (optionally with days + exercises)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, raw_claude_json, is_active, created_at, updated_at FROM workout_plans WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ plans: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list plans' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, raw_claude_json, is_active } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name required' });
    }
    const result = await pool.query(
      'INSERT INTO workout_plans (user_id, name, description, raw_claude_json, is_active) VALUES ($1, $2, $3, $4, COALESCE($5, true)) RETURNING id, name, description, raw_claude_json, is_active, created_at, updated_at',
      [req.user.id, name, description || null, raw_claude_json ? JSON.stringify(raw_claude_json) : null, is_active]
    );
    res.status(201).json({ plan: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const planResult = await pool.query(
      'SELECT id, name, description, raw_claude_json, is_active, created_at, updated_at FROM workout_plans WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    const plan = planResult.rows[0];
    const daysResult = await pool.query(
      'SELECT id, day_label, name, focus, sort_order, created_at FROM plan_days WHERE plan_id = $1 ORDER BY sort_order, created_at',
      [plan.id]
    );
    const days = daysResult.rows;
    const dayIds = days.map((d) => d.id);
    const exercisesByDay = {};
    if (dayIds.length > 0) {
      const exResult = await pool.query(
        'SELECT id, plan_day_id, name, prescribed_sets, prescribed_reps, start_weight_kg, notes, sort_order FROM plan_exercises WHERE plan_day_id = ANY($1) ORDER BY plan_day_id, sort_order',
        [dayIds]
      );
      for (const ex of exResult.rows) {
        if (!exercisesByDay[ex.plan_day_id]) exercisesByDay[ex.plan_day_id] = [];
        exercisesByDay[ex.plan_day_id].push(ex);
      }
    }
    const planWithDays = {
      ...plan,
      days: days.map((d) => ({ ...d, exercises: exercisesByDay[d.id] || [] })),
    };
    res.json({ plan: planWithDays });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get plan' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description, raw_claude_json, is_active } = req.body;
    const result = await pool.query(
      'UPDATE workout_plans SET name = COALESCE($1, name), description = COALESCE($2, description), raw_claude_json = COALESCE($3, raw_claude_json), is_active = COALESCE($4, is_active), updated_at = NOW() WHERE id = $5 AND user_id = $6 RETURNING id, name, description, raw_claude_json, is_active, updated_at',
      [name, description, raw_claude_json != null ? JSON.stringify(raw_claude_json) : null, is_active, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    res.json({ plan: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM workout_plans WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

// Plan days
router.post('/:planId/days', async (req, res) => {
  try {
    const { day_label, name, focus, sort_order } = req.body;
    if (!day_label || !name) {
      return res.status(400).json({ error: 'day_label and name required' });
    }
    const planCheck = await pool.query('SELECT id FROM workout_plans WHERE id = $1 AND user_id = $2', [req.params.planId, req.user.id]);
    if (planCheck.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
    const result = await pool.query(
      'INSERT INTO plan_days (plan_id, day_label, name, focus, sort_order) VALUES ($1, $2, $3, $4, COALESCE($5, 0)) RETURNING id, plan_id, day_label, name, focus, sort_order, created_at',
      [req.params.planId, day_label, name, focus || null, sort_order]
    );
    res.status(201).json({ day: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create plan day' });
  }
});

// Plan exercises (under a day)
router.post('/:planId/days/:dayId/exercises', async (req, res) => {
  try {
    const { name, prescribed_sets, prescribed_reps, start_weight_kg, notes, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const dayCheck = await pool.query(
      'SELECT pd.id FROM plan_days pd JOIN workout_plans wp ON wp.id = pd.plan_id WHERE pd.id = $1 AND wp.user_id = $2',
      [req.params.dayId, req.user.id]
    );
    if (dayCheck.rows.length === 0) return res.status(404).json({ error: 'Plan day not found' });
    const result = await pool.query(
      'INSERT INTO plan_exercises (plan_day_id, name, prescribed_sets, prescribed_reps, start_weight_kg, notes, sort_order) VALUES ($1, $2, COALESCE($3, 3), COALESCE($4, \'10\'), $5, $6, COALESCE($7, 0)) RETURNING id, plan_day_id, name, prescribed_sets, prescribed_reps, start_weight_kg, notes, sort_order, created_at',
      [req.params.dayId, name, prescribed_sets, prescribed_reps, start_weight_kg ?? null, notes ?? null, sort_order]
    );
    res.status(201).json({ exercise: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create exercise' });
  }
});

module.exports = router;

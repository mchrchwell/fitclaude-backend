const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');
const { generatePlan } = require('../services/claude');

const router = express.Router();
router.use(auth);

// POST /plans/generate — generate a Claude plan from user profile
router.post('/generate', async (req, res) => {
  try {
    const profileResult = await pool.query(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (profileResult.rows.length === 0) {
      return res.status(400).json({ error: 'Complete your profile before generating a plan' });
    }
    const profile = profileResult.rows[0];
    if (!profile.age || !profile.goals || profile.goals.length === 0) {
      return res.status(400).json({ error: 'Profile needs at least age and goals to generate a plan' });
    }

    // Deactivate existing active plan
    await pool.query(
      'UPDATE workout_plans SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE',
      [req.user.id]
    );

    const { plan, rawContent } = await generatePlan({
      age: profile.age,
      heightCm: profile.height_cm,
      weightKg: profile.weight_kg,
      equipment: profile.equipment,
      injuries: profile.injuries,
      goals: profile.goals,
      notes: profile.notes,
    });

    const planResult = await pool.query(
      'INSERT INTO workout_plans (user_id, name, description, raw_claude_json, is_active) VALUES ($1, $2, $3, $4, TRUE) RETURNING id',
      [req.user.id, plan.name, plan.description, JSON.stringify(plan)]
    );
    const planId = planResult.rows[0].id;

    for (let i = 0; i < plan.days.length; i++) {
      const day = plan.days[i];
      const dayResult = await pool.query(
        'INSERT INTO plan_days (plan_id, day_label, name, focus, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [planId, day.dayLabel, day.name, day.focus || null, i]
      );
      const dayId = dayResult.rows[0].id;
      for (let j = 0; j < day.exercises.length; j++) {
        const ex = day.exercises[j];
        await pool.query(
          'INSERT INTO plan_exercises (plan_day_id, name, prescribed_sets, prescribed_reps, start_weight_kg, notes, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [dayId, ex.name, ex.prescribedSets || 3, ex.prescribedReps || '10', ex.startWeightKg || null, ex.notes || null, j]
        );
      }
    }

    await pool.query('UPDATE users SET active_plan_id = $1 WHERE id = $2', [planId, req.user.id]);

    // Return full plan with days and exercises
    const fullPlan = await pool.query('SELECT * FROM workout_plans WHERE id = $1', [planId]);
    const days = await pool.query('SELECT * FROM plan_days WHERE plan_id = $1 ORDER BY sort_order', [planId]);
    for (const day of days.rows) {
      const exercises = await pool.query('SELECT * FROM plan_exercises WHERE plan_day_id = $1 ORDER BY sort_order', [day.id]);
      day.exercises = exercises.rows.map(ex => ({
        id: ex.id,
        name: ex.name,
        prescribedSets: ex.prescribed_sets,
        prescribedReps: ex.prescribed_reps,
        startWeightKg: ex.start_weight_kg,
        notes: ex.notes,
      }));
    }

    res.status(201).json({
      id: planId,
      name: plan.name,
      description: plan.description,
      isActive: true,
      days: days.rows.map(d => ({
        id: d.id,
        dayLabel: d.day_label,
        name: d.name,
        focus: d.focus,
        exercises: d.exercises,
      })),
    });
  } catch (err) {
    console.error('Generate plan error:', err);
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'Claude returned malformed JSON — please retry' });
    }
    res.status(500).json({ error: 'Failed to generate plan' });
  }
});

// GET /plans/active — get the user's active plan
router.get('/active', async (req, res) => {
  try {
    const planResult = await pool.query(
      'SELECT * FROM workout_plans WHERE user_id = $1 AND is_active = TRUE',
      [req.user.id]
    );
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active plan' });
    }
    const plan = planResult.rows[0];
    const days = await pool.query('SELECT * FROM plan_days WHERE plan_id = $1 ORDER BY sort_order', [plan.id]);
    for (const day of days.rows) {
      const exercises = await pool.query('SELECT * FROM plan_exercises WHERE plan_day_id = $1 ORDER BY sort_order', [day.id]);
      day.exercises = exercises.rows.map(ex => ({
        id: ex.id,
        name: ex.name,
        prescribedSets: ex.prescribed_sets,
        prescribedReps: ex.prescribed_reps,
        startWeightKg: ex.start_weight_kg,
        notes: ex.notes,
      }));
    }
    res.json({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      isActive: plan.is_active,
      days: days.rows.map(d => ({
        id: d.id,
        dayLabel: d.day_label,
        name: d.name,
        focus: d.focus,
        exercises: d.exercises,
      })),
    });
  } catch (err) {
    console.error('Get active plan error:', err);
    res.status(500).json({ error: 'Failed to get active plan' });
  }
});

// PUT /plans/active — replace days and exercises of the active plan
router.put('/active', async (req, res) => {
  try {
    const { name, description, days } = req.body;
    if (!days || !Array.isArray(days)) {
      return res.status(400).json({ error: 'days array required' });
    }

    // Get current active plan
    const planResult = await pool.query(
      'SELECT id FROM workout_plans WHERE user_id = $1 AND is_active = true LIMIT 1',
      [req.user.id]
    );
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active plan found' });
    }
    const planId = planResult.rows[0].id;

    // Build updated raw_claude_json
    const updatedJson = { name, description, days };

    // Update the plan
    await pool.query(
      'UPDATE workout_plans SET name = $1, description = $2, raw_claude_json = $3, updated_at = NOW() WHERE id = $4',
      [name, description, JSON.stringify(updatedJson), planId]
    );

    // Delete existing days and exercises, re-insert
    const existingDays = await pool.query(
      'SELECT id FROM plan_days WHERE plan_id = $1', [planId]
    );
    for (const day of existingDays.rows) {
      await pool.query('DELETE FROM plan_exercises WHERE plan_day_id = $1', [day.id]);
    }
    await pool.query('DELETE FROM plan_days WHERE plan_id = $1', [planId]);

    // Re-insert days and exercises
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const dayResult = await pool.query(
        'INSERT INTO plan_days (plan_id, day_label, name, muscle_groups, day_order) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [planId, day.dayLabel, day.name, day.focus ? [day.focus] : [], i]
      );
      const dayId = dayResult.rows[0].id;
      if (day.exercises) {
        for (let j = 0; j < day.exercises.length; j++) {
          const ex = day.exercises[j];
          await pool.query(
            'INSERT INTO plan_exercises (plan_day_id, name, sets, reps, start_weight_kg, notes, exercise_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [dayId, ex.name, ex.prescribedSets || 3, ex.prescribedReps || '10', ex.startWeightKg || 0, ex.notes || '', j]
          );
        }
      }
    }

    res.json({ success: true, message: 'Plan updated successfully' });
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

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

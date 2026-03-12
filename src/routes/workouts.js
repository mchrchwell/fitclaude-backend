const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  try {
    const { plan_id } = req.query;
    let query = 'SELECT id, plan_id, name, notes, completed_at, created_at, updated_at FROM workouts WHERE user_id = $1';
    const params = [req.user.id];
    if (plan_id) {
      query += ' AND plan_id = $2';
      params.push(plan_id);
    }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json({ workouts: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list workouts' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, notes, plan_id, completed_at } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name required' });
    }
    const result = await pool.query(
      'INSERT INTO workouts (user_id, plan_id, name, notes, completed_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, plan_id, name, notes, completed_at, created_at, updated_at',
      [req.user.id, plan_id || null, name, notes || null, completed_at || null]
    );
    res.status(201).json({ workout: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create workout' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, plan_id, name, notes, completed_at, created_at, updated_at FROM workouts WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }
    res.json({ workout: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get workout' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, notes, completed_at } = req.body;
    const result = await pool.query(
      'UPDATE workouts SET name = COALESCE($1, name), notes = COALESCE($2, notes), completed_at = COALESCE($3, completed_at), updated_at = NOW() WHERE id = $4 AND user_id = $5 RETURNING id, plan_id, name, notes, completed_at, updated_at',
      [name, notes, completed_at, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }
    res.json({ workout: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update workout' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM workouts WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete workout' });
  }
});

module.exports = router;

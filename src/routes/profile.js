const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, user_id, age, height_cm, weight_kg, equipment, injuries, goals, notes, created_at, updated_at FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );
    const profile = result.rows[0] || null;
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

router.put('/', async (req, res) => {
  try {
    const { age, height_cm, weight_kg, equipment, injuries, goals, notes } = req.body;
    const toJson = (v) => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(Array.isArray(v) ? v : [v]));
    const equipmentJson = toJson(equipment);
    const injuriesJson = toJson(injuries);
    const goalsJson = toJson(goals);

    await pool.query(
      `INSERT INTO user_profiles (user_id, age, height_cm, weight_kg, equipment, injuries, goals, notes, updated_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '[]'), COALESCE($6::jsonb, '[]'), COALESCE($7::jsonb, '[]'), $8, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         age = COALESCE(EXCLUDED.age, user_profiles.age),
         height_cm = COALESCE(EXCLUDED.height_cm, user_profiles.height_cm),
         weight_kg = COALESCE(EXCLUDED.weight_kg, user_profiles.weight_kg),
         equipment = COALESCE(EXCLUDED.equipment, user_profiles.equipment),
         injuries = COALESCE(EXCLUDED.injuries, user_profiles.injuries),
         goals = COALESCE(EXCLUDED.goals, user_profiles.goals),
         notes = COALESCE(EXCLUDED.notes, user_profiles.notes),
         updated_at = NOW()`,
      [req.user.id, age ?? null, height_cm ?? null, weight_kg ?? null, equipmentJson, injuriesJson, goalsJson, notes ?? null]
    );
    const result = await pool.query(
      'SELECT id, user_id, age, height_cm, weight_kg, equipment, injuries, goals, notes, updated_at FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ profile: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;

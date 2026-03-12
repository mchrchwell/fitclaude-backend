const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, user_id, age, weight_kg, height_cm, goals, activity_level, created_at, updated_at FROM profiles WHERE user_id = $1',
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
    const { age, weight_kg, height_cm, goals, activity_level } = req.body;
    await pool.query(
      `INSERT INTO profiles (user_id, age, weight_kg, height_cm, goals, activity_level, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         age = COALESCE(EXCLUDED.age, profiles.age),
         weight_kg = COALESCE(EXCLUDED.weight_kg, profiles.weight_kg),
         height_cm = COALESCE(EXCLUDED.height_cm, profiles.height_cm),
         goals = COALESCE(EXCLUDED.goals, profiles.goals),
         activity_level = COALESCE(EXCLUDED.activity_level, profiles.activity_level),
         updated_at = NOW()`,
      [req.user.id, age ?? null, weight_kg ?? null, height_cm ?? null, goals ?? null, activity_level ?? null]
    );
    const result = await pool.query(
      'SELECT id, user_id, age, weight_kg, height_cm, goals, activity_level, updated_at FROM profiles WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ profile: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;

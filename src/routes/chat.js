const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');
const { chat } = require('../services/claude');

const router = express.Router();
router.use(auth);

// List conversations
router.get('/conversations', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, context_type, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ conversations: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// Get or create default conversation and send message (simple flow: one "general" conversation per user for now)
router.post('/', async (req, res) => {
  try {
    const { message, conversation_id } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message required' });
    }

    let convId = conversation_id;
    if (!convId) {
      const convResult = await pool.query(
        'SELECT id FROM conversations WHERE user_id = $1 AND context_type = $2 ORDER BY updated_at DESC LIMIT 1',
        [req.user.id, 'general']
      );
      if (convResult.rows.length > 0) {
        convId = convResult.rows[0].id;
      } else {
        const insertConv = await pool.query(
          'INSERT INTO conversations (user_id, context_type) VALUES ($1, $2) RETURNING id',
          [req.user.id, 'general']
        );
        convId = insertConv.rows[0].id;
      }
    }

    const convCheck = await pool.query('SELECT id FROM conversations WHERE id = $1 AND user_id = $2', [convId, req.user.id]);
    if (convCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Fetch user profile
    const profileResult = await pool.query(
      'SELECT age, height_cm, weight_kg, goals, equipment, injuries, notes FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );
    const profile = profileResult.rows[0];

    // Fetch active plan from raw_claude_json
    const planResult = await pool.query(
      'SELECT name, description, raw_claude_json FROM workout_plans WHERE user_id = $1 AND is_active = true LIMIT 1',
      [req.user.id]
    );
    const plan = planResult.rows[0];

    // Build context string
    let context = '';
    if (profile) {
      context += `USER PROFILE:\n`;
      if (profile.age) context += `- Age: ${profile.age}\n`;
      if (profile.goals?.length) context += `- Goals: ${profile.goals.join(', ')}\n`;
      if (profile.equipment?.length) context += `- Available equipment: ${profile.equipment.join(', ')}\n`;
      if (profile.injuries?.length) context += `- Injuries/limitations: ${profile.injuries.join(', ')}\n`;
      if (profile.notes) context += `- Notes: ${profile.notes}\n`;
    }
    if (plan) {
      context += `\nACTIVE WORKOUT PLAN: ${plan.name}\n`;
      if (plan.description) context += `${plan.description}\n`;
      const days = plan.raw_claude_json?.days;
      if (days?.length) {
        context += `\nDays:\n`;
        for (const day of days) {
          context += `\n${day.dayLabel} - ${day.name} (${day.focus})\n`;
          if (day.exercises) {
            for (const ex of day.exercises) {
              context += `  - ${ex.name}: ${ex.prescribedSets}x${ex.prescribedReps}`;
              if (ex.startWeightKg) context += ` @ ${ex.startWeightKg}kg`;
              if (ex.notes) context += ` (${ex.notes})`;
              context += '\n';
            }
          }
        }
      }
    }

    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [convId, 'user', message]
    );

    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 30',
      [convId]
    );
    const messages = historyResult.rows.map((row) => ({ role: row.role, content: row.content }));

    const reply = await chat(messages, context || null);

    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [convId, 'assistant', reply]
    );

    res.json({ reply, conversation_id: convId });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

// History for a conversation
router.get('/history', async (req, res) => {
  try {
    const { conversation_id } = req.query;
    if (conversation_id) {
      const convCheck = await pool.query('SELECT id FROM conversations WHERE id = $1 AND user_id = $2', [conversation_id, req.user.id]);
      if (convCheck.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
      const result = await pool.query(
        'SELECT id, role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 100',
        [conversation_id]
      );
      return res.json({ messages: result.rows });
    }
    const result = await pool.query(
      'SELECT id, role, content, created_at FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = $1 ORDER BY m.created_at ASC LIMIT 100',
      [req.user.id]
    );
    res.json({ messages: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get history' });
  }
});

module.exports = router;

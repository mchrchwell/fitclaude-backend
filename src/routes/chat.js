const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');
const { chat } = require('../services/claude');

const router = express.Router();
router.use(auth);

router.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message required' });
    }

    await pool.query(
      'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
      [req.user.id, 'user', message]
    );

    const historyResult = await pool.query(
      'SELECT role, content FROM chat_messages WHERE user_id = $1 ORDER BY created_at ASC LIMIT 30',
      [req.user.id]
    );
    const messages = historyResult.rows.map((row) => ({
      role: row.role,
      content: row.content,
    }));

    const reply = await chat(messages);

    await pool.query(
      'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
      [req.user.id, 'assistant', reply]
    );

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, role, content, created_at FROM chat_messages WHERE user_id = $1 ORDER BY created_at ASC LIMIT 100',
      [req.user.id]
    );
    res.json({ messages: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get chat history' });
  }
});

module.exports = router;

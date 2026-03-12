require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const plansRoutes = require('./routes/plans');
const workoutsRoutes = require('./routes/workouts');
const chatRoutes = require('./routes/chat');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);
app.use('/plans', plansRoutes);
app.use('/workouts', workoutsRoutes);
app.use('/chat', chatRoutes);

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`FitClaude API listening on ${HOST}:${PORT}`);
});

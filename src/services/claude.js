const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are FitClaude, an expert personal trainer and strength coach. You help users with personalized workout plans, exercise form, programming, and fitness questions. Be specific, practical, and always account for injuries and limitations.`;

async function generatePlan(profile) {
  const profileText = `
Age: ${profile.age || 'not provided'}
Height: ${profile.heightCm ? `${profile.heightCm} cm` : 'not provided'}
Weight: ${profile.weightKg ? `${profile.weightKg} kg` : 'not provided'}
Equipment available: ${profile.equipment?.join(', ') || 'not specified'}
Injuries / limitations: ${profile.injuries?.join(', ') || 'none reported'}
Goals: ${profile.goals?.join(', ') || 'general fitness'}
Additional notes: ${profile.notes || 'none'}`.trim();

  const prompt = `Based on this user profile, generate a complete personalized workout plan.

USER PROFILE:
${profileText}

Return ONLY a JSON object in this exact structure — no prose before or after:
{
  "name": "Plan name (e.g. 4-Day Push/Pull/Legs/Cardio)",
  "description": "2-3 sentence summary of the plan and why it suits this user",
  "days": [
    {
      "dayLabel": "A",
      "name": "Day name (e.g. Push + Core)",
      "focus": "Muscle groups (e.g. Chest · Shoulders · Triceps)",
      "exercises": [
        {
          "name": "Exercise name",
          "prescribedSets": 3,
          "prescribedReps": "8-10",
          "startWeightKg": 20,
          "notes": "Coaching cue or safety note"
        }
      ]
    }
  ]
}

Rules:
- 3-5 workout days depending on goals and schedule
- 5-8 exercises per day
- startWeightKg should be a conservative starting point
- Explicitly address each injury in exercise selection and notes`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawContent = message.content[0].text;
  const jsonStr = rawContent.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const plan = JSON.parse(jsonStr);
  return { plan, rawContent };
}

async function chat(messages, systemContext) {
  const system = systemContext
    ? `${SYSTEM_PROMPT}\n\n---\n${systemContext}`
    : SYSTEM_PROMPT;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system,
    messages,
  });
  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text : '';
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

module.exports = { generatePlan, chat, estimateTokens };

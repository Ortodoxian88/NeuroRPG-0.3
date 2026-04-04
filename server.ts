import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.post("/api/gemini/join", async (req, res) => {
    try {
      const { characterName, characterProfile } = req.body;
      const prompt = `Проанализируй анкету RPG персонажа и извлеки логичный стартовый инвентарь и список навыков/способностей.
Имя персонажа: ${characterName}
Анкета: ${characterProfile}

Верни JSON объект с двумя массивами строк: "inventory" и "skills". Названия предметов и навыков должны быть на РУССКОМ языке. Будь краток.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              inventory: { type: Type.ARRAY, items: { type: Type.STRING } },
              skills: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["inventory", "skills"]
          }
        }
      });

      const parsed = JSON.parse(response.text || '{"inventory":[], "skills":[]}');
      res.json(parsed);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate" });
    }
  });

  app.post("/api/gemini/gm", async (req, res) => {
    try {
      const { playersContext, recentMessages, turn, actionsText } = req.body;
      
      const prompt = `
Ты опытный ИИ Гейм-мастер для многопользовательской текстовой RPG. Твоя цель - реалистично симулировать мир, управлять NPC и реагировать на действия игроков.
ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ.

ИГРОКИ В МИРЕ:
${playersContext}

НЕДАВНИЙ КОНТЕКСТ ИСТОРИИ:
${recentMessages}

ТЕКУЩИЙ ХОД: ${turn}
ИГРОКИ ТОЛЬКО ЧТО ОТПРАВИЛИ ЭТИ ДЕЙСТВИЯ:
${actionsText}

ИНСТРУКЦИИ:
1. Проанализируй состояние мира и то, как действия игроков взаимодействуют с ним и друг с другом.
2. Если игроки используют предметы или навыки, проверь, есть ли они у них в инвентаре/навыках.
3. Управляй NPC реалистично. Давай им диалоги и мотивацию.
4. Опиши результат действий и новую ситуацию, в которой оказались игроки.
5. Держи повествование увлекательным, атмосферным и заканчивай крючком или новым вызовом для следующего хода.
6. Если игрок использует команду /drop, /transfer, /eat, обнови его инвентарь в своем понимании и опиши результат.

ВАЖНО: Если инвентарь, навыки, HP или Мана игроков изменились (например, они получили урон, потратили ману, съели предмет, передали предмет), ИЛИ если нужно добавить статью в Бестиарий (о новом монстре, магии, лоре), добавь в САМЫЙ КОНЕЦ своего ответа блок JSON в строгом формате:
\`\`\`json
{
  "stateUpdates": [
    { "uid": "UID_ИГРОКА", "hp": 20, "mana": 10, "inventory": ["предмет1"], "skills": ["навык1"] }
  ],
  "bestiary": [
    { "title": "Название", "content": "Описание для энциклопедии" }
  ]
}
\`\`\`
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
        }
      });

      res.json({ text: response.text });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate GM response" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

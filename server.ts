import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import path from "path";
import admin from 'firebase-admin';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';

// Initialize Firebase Admin for token verification
const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
if (fs.existsSync(firebaseConfigPath)) {
  const config = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
  admin.initializeApp({
    projectId: config.projectId
  });
} else {
  console.warn("firebase-applet-config.json not found, admin not initialized");
}

const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    return;
  }
  
  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying auth token:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // limit each IP to 20 requests per windowMs
  message: { error: "Too many requests, please try again later." }
});

function getAIClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY environment variable is missing. Please check your secrets in AI Studio.");
  }
  return new GoogleGenAI({ apiKey: key });
}

async function generateWithFallback(prompt: string, baseConfig: any, models: string[] = ["gemini-3-flash-preview", "gemini-3.1-flash-lite-preview"]) {
  let lastError;
  const ai = getAIClient();

  for (const model of models) {
    try {
      console.log(`[AI] Attempting generation with model: ${model}`);
      const config = { ...baseConfig };
      
      // ThinkingLevel is only for Gemini 3 series. 
      // Lite defaults to MINIMAL, Pro/Flash support HIGH/LOW.
      if (model === "gemini-3.1-flash-lite-preview" && config.thinkingConfig) {
        delete config.thinkingConfig;
      }

      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: config
      });
      
      console.log(`[AI] Successfully generated with ${model}`);
      return response;
    } catch (error: any) {
      console.warn(`[AI] Model ${model} failed: ${error.message || error}`);
      lastError = error;
      // If it's an API key error, don't bother with other models
      if (error.message?.includes("API key not valid")) throw error;
    }
  }

  throw lastError;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));
  app.use('/api/', apiLimiter);

  // Fix for Firebase Auth popup Cross-Origin-Opener-Policy issues
  app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
    next();
  });

  // API routes FIRST
  app.post("/api/gemini/join", requireAuth, async (req, res) => {
    try {
      const { characterName, characterProfile, roomId } = req.body;
      const prompt = `Проанализируй анкету RPG персонажа и извлеки логичный стартовый инвентарь и список навыков/способностей.
Имя персонажа: ${characterName}
Анкета: ${characterProfile}

Верни JSON объект с двумя массивами строк: "inventory" и "skills". Названия предметов и навыков должны быть на РУССКОМ языке. Будь краток.`;

      const response = await generateWithFallback(prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            inventory: { type: Type.ARRAY, items: { type: Type.STRING } },
            skills: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["inventory", "skills"]
        }
      });

      let text = response.text || '{"inventory":[], "skills":[]}';
      const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (match) {
        text = match[1];
      }
      
      const parsed = JSON.parse(text);
      
      // Also post a system message to the room
      if (roomId) {
        const db = admin.firestore();
        await db.collection('rooms').doc(roomId).collection('messages').add({
          role: 'system',
          content: `Игрок **${characterName}** присоединился к игре.`,
          turn: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      res.json(parsed);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate" });
    }
  });

  app.post("/api/gemini/summarize", requireAuth, async (req, res) => {
    try {
      const { currentSummary, recentMessages, roomId } = req.body;
      const uid = (req as any).user.uid;
      
      // Verify host
      const db = admin.firestore();
      const roomDoc = await db.collection('rooms').doc(roomId).get();
      if (!roomDoc.exists || roomDoc.data()?.hostId !== uid) {
        return res.status(403).json({ error: "Only host can summarize" });
      }

      const prompt = `Ты летописец RPG игры. Твоя задача - обновить краткое содержание сюжета.
Текущее содержание: ${currentSummary || "Начало приключения."}
Новые события: ${recentMessages}

Напиши обновленное краткое содержание (не более 3-4 абзацев), сохраняя ключевые события и текущую цель героев. Пиши художественно, но емко.`;

      const response = await generateWithFallback(prompt, {
        // Use low thinking for summarization to save time if supported
      });

      res.json({ text: response.text });
    } catch (error) {
      console.error("Summarize error:", error);
      res.status(500).json({ error: "Failed to summarize" });
    }
  });

  app.post("/api/gemini/generate", requireAuth, async (req, res) => {
    try {
      const { playersContext, recentMessages, turn, actionsText, currentQuests } = req.body;
      
      const prompt = `
Ты опытный ИИ Гейм-мастер для многопользовательской текстовой RPG. Твоя цель - реалистично симулировать мир, управлять NPC и реагировать на действия игроков.
ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ.

ИГРОКИ В МИРЕ:
${playersContext}

НЕДАВНИЙ КОНТЕКСТ ИСТОРИИ:
${recentMessages}

ТЕКУЩИЙ ХОД: ${turn}
ТЕКУЩИЕ КВЕСТЫ: ${currentQuests ? JSON.stringify(currentQuests) : '[]'}

ИГРОКИ ТОЛЬКО ЧТО ОТПРАВИЛИ ЭТИ ДЕЙСТВИЯ:
${actionsText}

ИНСТРУКЦИИ:
1. Проанализируй действия КАЖДОГО игрока.
2. Если игрок бросил кубик (команда /roll), используй результат для определения успеха/провала.
3. Если действие секретное (команда /secret), опиши его результат так, чтобы другие игроки не поняли деталей, но почувствовали последствия (или вообще не упоминай в общем чате, если это уместно).
4. Опиши результат действий и новую ситуацию, в которой оказались игроки.
5. Описывай происходящее ДЕТАЛЬНО, ГЛУБОКО и ХУДОЖЕСТВЕННО. Используй богатый литературный язык. Описывай запахи, звуки, эмоции персонажей, атмосферу и мелкие детали окружения. Сделай так, чтобы игроки почувствовали себя внутри живого мира. Заканчивай ход интригой или новым вызовом.
6. Если игрок использует команду /drop, /transfer, /eat, обнови его инвентарь в своем понимании и опиши результат.
7. Обновляй список квестов (добавляй новые, удаляй выполненные). Если квест выполнен, добавь к нему пометку [Выполнено].
8. Если игроки получили урон или восстановили силы, обнови их HP и Ману.
9. Если в мире появилось что-то новое (монстр, артефакт, локация), добавь запись в Бестиарий.
`;

      const response = await generateWithFallback(prompt, {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            story: { type: Type.STRING, description: "Художественный текст ответа Гейм-мастера" },
            stateUpdates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  uid: { type: Type.STRING },
                  hp: { type: Type.NUMBER },
                  mana: { type: Type.NUMBER },
                  inventory: { type: Type.ARRAY, items: { type: Type.STRING } },
                  skills: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["uid", "hp", "mana", "inventory", "skills"]
              }
            },
            bestiary: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.STRING }
                },
                required: ["title", "content"]
              }
            },
            quests: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Актуальный список активных квестов"
            }
          },
          required: ["story", "stateUpdates", "bestiary", "quests"]
        }
      }, ["gemini-3-flash-preview", "gemini-3.1-flash-lite-preview"]);

      let text = response.text || '{}';
      
      let parsed;
      try {
        const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (match) {
          text = match[1];
        }
        parsed = JSON.parse(text);
      } catch (e) {
        console.error("Failed to parse JSON, attempting fallback extraction", e);
        // Fallback: try to find the first { and last }
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          try {
            parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1));
          } catch (innerError) {
            console.error("Fallback JSON parsing failed", innerError);
            throw new Error("Failed to parse AI response as JSON");
          }
        } else {
          throw new Error("No JSON object found in AI response");
        }
      }
      
      res.json(parsed);
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

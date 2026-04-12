import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ 
  apiKey: (process as any).env.GEMINI_API_KEY 
});

export const aiService = {
  async generateTurn(payload: any) {
    const { room, players, messages, bestiary } = payload;
    
    const prompt = `
      You are the Game Master for a dark, gritty RPG called NeuroRPG.
      Current Room State: ${JSON.stringify(room)}
      Players: ${JSON.stringify(players)}
      Recent Messages: ${JSON.stringify(messages.slice(-10))}
      Bestiary Context: ${JSON.stringify(bestiary)}

      Based on the players' actions in the last turn, describe what happens next.
      Be descriptive, maintain the dark atmosphere, and update player states accordingly.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            story: { type: Type.STRING, description: "The narrative description of the turn results." },
            reasoning: { type: Type.STRING, description: "Hidden reasoning for the GM." },
            stateUpdates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  uid: { type: Type.STRING },
                  hp: { type: Type.NUMBER },
                  mana: { type: Type.NUMBER },
                  stress: { type: Type.NUMBER },
                  alignment: { type: Type.STRING },
                  inventory: { type: Type.ARRAY, items: { type: Type.STRING } },
                  skills: { type: Type.ARRAY, items: { type: Type.STRING } },
                  injuries: { type: Type.ARRAY, items: { type: Type.STRING } },
                  statuses: { type: Type.ARRAY, items: { type: Type.STRING } },
                  mutations: { type: Type.ARRAY, items: { type: Type.STRING } },
                  reputation: { type: Type.NUMBER }
                },
                required: ["uid", "hp", "mana", "stress"]
              }
            },
            worldUpdates: { type: Type.STRING },
            factionUpdates: { type: Type.OBJECT },
            hiddenTimersUpdates: { type: Type.OBJECT },
            quests: { type: Type.ARRAY, items: { type: Type.OBJECT } }
          },
          required: ["story", "stateUpdates"]
        }
      }
    });

    return JSON.parse(response.text);
  },

  async generateJoin(characterName: string, characterProfile: string, roomScenario?: string) {
    const prompt = `
      Create a starting equipment and initial stats for a character in NeuroRPG.
      Character Name: ${characterName}
      Profile: ${characterProfile}
      Room Scenario: ${roomScenario || 'Dark fantasy world'}

      Return JSON with: hp, mana, stress, alignment, inventory (array), skills (array).
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hp: { type: Type.NUMBER },
            mana: { type: Type.NUMBER },
            stress: { type: Type.NUMBER },
            alignment: { type: Type.STRING },
            inventory: { type: Type.ARRAY, items: { type: Type.STRING } },
            skills: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["hp", "mana", "stress", "inventory", "skills"]
        }
      }
    });

    return JSON.parse(response.text);
  },

  async summarize(currentSummary: string, recentMessages: string) {
    const prompt = `
      Summarize the current state of the RPG story.
      Previous Summary: ${currentSummary}
      Recent Events: ${recentMessages}

      Return a concise summary of the overall plot and key character developments.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt
    });

    return response.text;
  }
};

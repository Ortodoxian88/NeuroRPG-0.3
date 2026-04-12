import { Router } from 'express';
import { query, withTransaction } from '../database/client';
import { authMiddleware } from '../middleware/auth.middleware';
import { sseService } from '../services/sse.service';
import { messagesRepository } from '../database/repositories/messages.repository';
import { roomsRepository } from '../database/repositories/rooms.repository';
import { playersRepository } from '../database/repositories/players.repository';
import { bestiaryRepository } from '../database/repositories/bestiary.repository';
import { z } from 'zod';

console.log('[API] Registering routes...');

export const apiRouter = Router();

apiRouter.use((req, res, next) => {
  console.log(`[API] Request: ${req.method} ${req.path}`);
  next();
});

// --- SMOKE TESTS ---

apiRouter.get('/health/db', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, message: 'Database connection is healthy' });
  } catch (error: any) {
    console.error('DB Healthcheck failed:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

apiRouter.get('/health/auth', authMiddleware, (req, res) => {
  res.json({ 
    ok: true, 
    message: 'Authentication successful',
    user: req.user 
  });
});

// --- REPORTING ---

apiRouter.post('/report', async (req, res) => {
  const { type, message, userEmail, roomId, turn, version } = req.body;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) return res.status(500).json({ error: 'Reporting service unavailable' });

  const escapeHtml = (unsafe: string) => unsafe.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#039;"}[m]!));
  const text = `<b>🚀 Новый репорт: ${escapeHtml(type.toUpperCase())}</b>\n<b>От:</b> ${escapeHtml(userEmail || 'Аноним')}\n<b>Комната:</b> ${roomId || 'N/A'}\n<b>Ход:</b> ${turn || 0}\n<b>Версия:</b> ${version || '0.3.0'}\n\n<b>Сообщение:</b>\n<i>${escapeHtml(message)}</i>`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send report' });
  }
});

// --- ROOMS API ---

async function resolveRoom(identifier: string) {
  // Try finding by join_code first
  let room = await roomsRepository.findByJoinCode(identifier);
  if (!room) {
    // If it's a valid UUID, try finding by ID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
      room = await roomsRepository.findById(identifier);
    }
  }
  return room;
}

apiRouter.post('/rooms', authMiddleware, async (req, res) => {
  try {
    const { scenario } = req.body;
    const room = await roomsRepository.createRoom(req.user!.id, { scenario });
    res.status(201).json(room);
  } catch (error) {
    console.error('[API] Error in POST /rooms:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

apiRouter.get('/rooms', authMiddleware, async (req, res) => {
  try {
    const userId = req.user!.id;
    // Get rooms where user is host OR player
    const result = await query(
      `SELECT DISTINCT r.* FROM rooms r
       LEFT JOIN room_players rp ON rp.room_id = r.id
       WHERE r.host_user_id::text = $1 OR rp.user_id::text = $1
       ORDER BY r.created_at DESC LIMIT 20`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[API] Error in GET /rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

apiRouter.get('/rooms/:roomId', authMiddleware, async (req, res) => {
  try {
    const room = await resolveRoom(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (error) {
    console.error(`[API] Error in GET /rooms/${req.params.roomId}:`, error);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

apiRouter.post('/rooms/:roomId/start', authMiddleware, async (req, res) => {
  try {
    const { roomId: roomIdentifier } = req.params;
    const room = await resolveRoom(roomIdentifier);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.host_user_id !== req.user!.id) return res.status(403).json({ error: 'Only host can start' });
    
    await roomsRepository.updateStatus(room.id, 'playing');
    await roomsRepository.updateTurn(room.id, 1, 'waiting', '');
    
    sseService.broadcast(room.id, 'room.updated', { ...room, status: 'playing', turn_number: 1 });
    res.json({ success: true });
  } catch (error) {
    console.error(`[API] Error in POST /rooms/${req.params.roomId}/start:`, error);
    res.status(500).json({ error: 'Failed to start room' });
  }
});

apiRouter.post('/rooms/join', authMiddleware, async (req, res) => {
  try {
    const { joinCode, characterName, characterProfile, stats, inventory, skills, alignment } = req.body;
    
    const room = await resolveRoom(joinCode);
    
    if (!room) return res.status(404).json({ error: 'Room not found or invalid code' });
    
    // Check if player already exists
    const existingPlayer = await playersRepository.findByRoomAndUser(room.id, req.user!.id);
    if (existingPlayer) {
      return res.json({ room, player: existingPlayer });
    }

    // Create player
    const player = await playersRepository.create({
      room_id: room.id,
      user_id: req.user!.id,
      character_name: characterName,
      character_profile: characterProfile,
      hp: 100, hp_max: 100,
      mana: 50, mana_max: 50,
      stress: 0, stress_max: 100,
      stat_strength: stats?.strength || 10,
      stat_dexterity: stats?.speed || 10,
      stat_constitution: stats?.durability || 10,
      stat_intelligence: stats?.reaction || 10,
      stat_wisdom: stats?.power || 10,
      stat_charisma: stats?.stamina || 10,
      inventory: inventory || [],
      skills: skills || [],
      statuses: [],
      injuries: [],
      alignment: alignment || null,
      mutations: [],
      reputation: {},
      current_action: null,
      is_ready: false,
      is_online: true,
      last_active_at: new Date()
    });

    // Notify room
    sseService.broadcast(room.id, 'player.joined', player);
    
    res.json({ room, player });
  } catch (error) {
    console.error('[API] Error in POST /rooms/join:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// --- PLAYERS API ---

apiRouter.get('/rooms/:roomId/players', authMiddleware, async (req, res) => {
  try {
    const room = await resolveRoom(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const players = await playersRepository.findByRoom(room.id);
    res.json(players);
  } catch (error) {
    console.error(`[API] Error in GET /rooms/${req.params.roomId}/players:`, error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

apiRouter.post('/rooms/:roomId/players/action', authMiddleware, async (req, res) => {
  try {
    const { action, isHidden } = req.body;
    const { roomId: roomIdentifier } = req.params;
    
    const room = await resolveRoom(roomIdentifier);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const player = await playersRepository.findByRoomAndUser(room.id, req.user!.id);
    if (!player) return res.status(404).json({ error: 'Player not found in room' });

    const updatedPlayer = await playersRepository.updateAction(player.id, action, true);
    
    // Broadcast player update
    sseService.broadcast(room.id, 'player.updated', updatedPlayer);
    
    res.json(updatedPlayer);
  } catch (error) {
    console.error(`[API] Error in POST /rooms/${req.params.roomId}/players/action:`, error);
    res.status(500).json({ error: 'Failed to submit action' });
  }
});

apiRouter.post('/rooms/:roomId/players/update', authMiddleware, async (req, res) => {
  try {
    const { roomId: roomIdentifier } = req.params;
    const updates = req.body;
    
    const room = await resolveRoom(roomIdentifier);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const player = await playersRepository.findByRoomAndUser(room.id, req.user!.id);
    if (!player) return res.status(404).json({ error: 'Player not found in room' });

    const updatedPlayer = await playersRepository.updateState(player.id, updates);
    
    // Broadcast player update
    sseService.broadcast(room.id, 'player.updated', updatedPlayer);
    
    res.json(updatedPlayer);
  } catch (error) {
    console.error(`[API] Error in POST /rooms/${req.params.roomId}/players/update:`, error);
    res.status(500).json({ error: 'Failed to update player' });
  }
});

// --- SSE REALTIME ---

apiRouter.get('/rooms/:roomId/events', authMiddleware, async (req, res) => {
  const { roomId: roomIdentifier } = req.params;
  const room = await resolveRoom(roomIdentifier);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  
  // Security check: Only host or players in the room can subscribe
  const player = await playersRepository.findByRoomAndUser(room.id, req.user!.id);
  if (!player && room.host_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'Not authorized to view this room' });
  }
  
  sseService.subscribe(room.id, res);
});

// --- BESTIARY API ---

apiRouter.get('/bestiary', authMiddleware, async (req, res) => {
  try {
    const { search = '', category } = req.query;
    const entries = await bestiaryRepository.search(String(search), category ? String(category) : undefined);
    res.json(entries);
  } catch (error) {
    console.error('[API] Error in GET /bestiary:', error);
    res.status(500).json({ error: 'Failed to fetch bestiary' });
  }
});

// --- AI ENDPOINTS (DEPRECATED - MOVED TO FRONTEND) ---

apiRouter.post("/gemini/join", authMiddleware, async (req, res) => {
  res.status(410).json({ error: "Endpoint moved to frontend" });
});

apiRouter.post("/gemini/summarize", authMiddleware, async (req, res) => {
  res.status(410).json({ error: "Endpoint moved to frontend" });
});

apiRouter.post("/gemini/generate", authMiddleware, async (req, res) => {
  res.status(410).json({ error: "Endpoint moved to frontend" });
});

apiRouter.post("/rooms/:roomId/apply-turn", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { result } = req.body;
    const uid = req.user!.id;

    const room = await roomsRepository.findById(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.host_user_id !== uid) return res.status(403).json({ error: 'Only host can apply turn' });

    console.log(`[API] Applying turn for room ${roomId}, turn ${room.turn_number}`);

    await withTransaction(async (client) => {
      // Save AI message
      const aiMessage = await messagesRepository.create({
        room_id: roomId,
        user_id: null,
        type: 'ai_response',
        content: result.story,
        turn_number: room.turn_number,
        metadata: { reasoning: result.reasoning }
      }, client);
      sseService.broadcast(roomId, 'message.new', aiMessage);

      // Update players
      if (result.stateUpdates && Array.isArray(result.stateUpdates)) {
        for (const update of result.stateUpdates) {
          const player = await playersRepository.findByRoomAndUser(roomId, update.uid, client);
          if (player) {
            const updatedPlayer = await playersRepository.updateState(player.id, {
              hp: update.hp,
              mana: update.mana,
              stress: update.stress,
              alignment: update.alignment,
              inventory: update.inventory,
              skills: update.skills,
              injuries: update.injuries,
              statuses: update.statuses,
              mutations: update.mutations,
              reputation: update.reputation
            }, client);
            if (updatedPlayer) {
              sseService.broadcast(roomId, 'player.updated', updatedPlayer);
            }
          }
        }
      }

      // Reset player readiness
      const players = await playersRepository.findByRoom(roomId, client);
      for (const p of players) {
        const updatedPlayer = await playersRepository.updateAction(p.id, '', false, client);
        if (updatedPlayer) {
          sseService.broadcast(roomId, 'player.updated', updatedPlayer);
        }
      }

      // Update room
      const newTurn = room.turn_number + 1;
      const worldSettings = room.world_settings || {};
      worldSettings.worldState = result.worldUpdates || worldSettings.worldState;
      worldSettings.factions = result.factionUpdates || worldSettings.factions;
      worldSettings.hiddenTimers = result.hiddenTimersUpdates || worldSettings.hiddenTimers;

      const activeQuests = result.quests || room.active_quests || [];

      await client.query(
        'UPDATE rooms SET turn_number = $1, turn_status = $2, active_quests = $3, world_settings = $4 WHERE id = $5',
        [newTurn, 'waiting', JSON.stringify(activeQuests), JSON.stringify(worldSettings), roomId]
      );

      const updatedRoom = await roomsRepository.findById(roomId, client);
      sseService.broadcast(roomId, 'room.updated', updatedRoom);
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[API] Apply turn error:', error);
    res.status(500).json({ error: "Failed to apply turn", details: error.message });
  }
});

apiRouter.post("/rooms/:roomId/summary", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { summary, turn } = req.body;
    const uid = req.user!.id;

    const room = await roomsRepository.findById(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.host_user_id !== uid) return res.status(403).json({ error: 'Only host can update summary' });

    await query(
      'UPDATE rooms SET story_summary = $1, last_summary_turn = $2 WHERE id = $3',
      [summary, turn, roomId]
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('[API] Update summary error:', error);
    res.status(500).json({ error: "Failed to update summary", details: error.message });
  }
});

apiRouter.post("/rooms/:roomId/reset-status", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const uid = req.user!.id;

    const room = await roomsRepository.findById(roomId);
    if (!room || room.host_user_id !== uid) {
      return res.status(403).json({ error: "Only host can reset status" });
    }

    await query('UPDATE rooms SET turn_status = $1 WHERE id = $2', ['waiting', roomId]);
    const updatedRoom = await roomsRepository.findById(roomId);
    sseService.broadcast(roomId, 'room.updated', updatedRoom);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to reset status" });
  }
});

apiRouter.post("/gemini/archivist", authMiddleware, async (req, res) => {
  res.status(410).json({ error: "Endpoint moved to frontend" });
});

// --- ROOM MESSAGES ---

apiRouter.get('/rooms/:roomId/messages', authMiddleware, async (req, res) => {
  try {
    const { roomId: roomIdentifier } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const room = await resolveRoom(roomIdentifier);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const messages = await messagesRepository.findByRoom(room.id, Number(limit), Number(offset));
    res.json(messages);
  } catch (error) {
    console.error(`[API] Error in GET /rooms/${req.params.roomId}/messages:`, error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

apiRouter.post('/rooms/:roomId/messages', authMiddleware, async (req, res) => {
  try {
    const { roomId: roomIdentifier } = req.params;
    const { content, type, turn_number, metadata } = req.body;
    const validTypes = ['player_action', 'ai_response', 'dice_roll', 'system', 'secret'];
    const messageType = validTypes.includes(type) ? type : 'system';

    const room = await resolveRoom(roomIdentifier);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const message = await messagesRepository.create({
      room_id: room.id,
      user_id: req.user!.id,
      type: messageType,
      content,
      metadata: metadata || {},
      turn_number: turn_number || 0
    });

    sseService.broadcast(room.id, 'message.new', message);
    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: 'Internal Error' });
  }
});
